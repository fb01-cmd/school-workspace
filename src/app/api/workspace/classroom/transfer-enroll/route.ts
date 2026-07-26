import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess, getStudentOUPaths } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  listStudentCourses,
  listClassroomStudents,
  getClassroomUserProfile,
  addStudentToClassroom,
  listUsersInOUs,
  isMock
} from "@/lib/google/workspace";
import { parseStudentUser } from "@/lib/roster";

// Vercel serverless function max duration (60 seconds)
export const maxDuration = 60;

// ==========================================
// 학급 클래스룸 매칭 판정 알고리즘 상수 (v2.0)
// ==========================================
const MIN_CLASS_SIZE = 3;         // 신뢰할 수 있는 매칭을 위한 학급 재적 최소 인원 (3명 이상)
const COVERAGE_THRESHOLD = 0.8;   // 우리 반 학생 중 코스 가입 비율 (80% 이상)
const PURITY_THRESHOLD = 0.7;     // 코스 수강생 중 우리 반 학생 비율 (70% 이상)
const MIN_COURSE_SIZE = 5;        // 소규모 특강/소그룹 배제를 위한 코스 최소 수강생 (5명 이상)
const MEMBER_CONCURRENCY = 3;     // Google API 쿼터 보호를 위한 멤버별 코스 조회 동시성 제한

/**
 * 제한된 동시성(limit)으로 비동기 함수 매핑 실행 헬퍼
 */
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * POST /api/workspace/classroom/transfer-enroll
 * action: "scan_init" — 반 재적 명단 초기화 (v2.0)
 * action: "scan_members" — 역방향 멤버십 집계 스캔 (v2.0)
 * action: "enroll" — 선택한 학급 클래스룸 일괄 수강 등록
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuthAccess(req);
    if (!authResult) {
      return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
    }
    const { email: operatorEmail, role } = authResult;

    // 관리자 특권 기능 (Impersonation 사용)
    if (role !== "super_admin") {
      return NextResponse.json({ error: "super_admin 권한이 필요합니다." }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body;

    // ==========================================
    // Action 1: "scan_init" — 학급 명단 초기화 (v2.0)
    // ==========================================
    if (action === "scan_init") {
      const { grade, classNum, studentEmail } = body;
      if (!grade || !classNum || !studentEmail) {
        return NextResponse.json({ error: "grade, classNum, studentEmail 필수 항목이 누락되었습니다." }, { status: 400 });
      }

      const domain = operatorEmail.split("@")[1] || "hmh.or.kr";
      const targetGrade = Number(grade);
      const targetClassNum = Number(classNum);
      const targetStudentEmail = String(studentEmail).toLowerCase().trim();

      // 1. 반 재적 명단 집합 구성 (Firestore settings 컬렉션의 ouMapping 조회)
      const studentOUs = await getStudentOUPaths(domain);
      const rawUsers = await listUsersInOUs(studentOUs);
      const parsedStudents = rawUsers.map(parseStudentUser);

      // 해당 학년·반 재적생 필터링 (미정지 계정이면서 전입생 본인 제외)
      const classMembers = parsedStudents.filter(s =>
        s.isParsed &&
        s.grade === targetGrade &&
        s.classNum === targetClassNum &&
        !s.suspended &&
        s.email.toLowerCase() !== targetStudentEmail
      );

      const classEmails = Array.from(new Set(classMembers.map(s => s.email.toLowerCase())));

      if (classEmails.length < MIN_CLASS_SIZE) {
        return NextResponse.json({
          error: `신뢰할 만한 학급 인원 데이터가 부족합니다 (${targetGrade}학년 ${targetClassNum}반 미정지 학생 ${classEmails.length}명 / 최소 ${MIN_CLASS_SIZE}명 필요).`,
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        grade: targetGrade,
        classNum: targetClassNum,
        studentEmail: targetStudentEmail,
        classEmails,
        totalClassCount: classEmails.length,
        isMock,
      });
    }

    // ==========================================
    // Action 2: "scan_members" — 역방향 멤버십 집계 스캔 (v2.0)
    // ==========================================
    if (action === "scan_members") {
      const { studentEmail, classEmails } = body;
      if (!studentEmail || !Array.isArray(classEmails)) {
        return NextResponse.json({ error: "studentEmail 및 classEmails 배열이 누락되었습니다." }, { status: 400 });
      }

      if (classEmails.length < MIN_CLASS_SIZE || classEmails.length > 40) {
        return NextResponse.json({
          error: `classEmails 수량 오류 (${classEmails.length}명). 3명 이상 40명 이하만 지원됩니다.`,
        }, { status: 400 });
      }

      const targetStudentEmail = String(studentEmail).toLowerCase().trim();
      const cleanClassEmails = Array.from(new Set(classEmails.map((e: any) => String(e).toLowerCase().trim())));
      const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || operatorEmail;

      const failedMemberEmails: string[] = [];

      // 1. 멤버별 수강 코스 목록을 동시성 3으로 조회
      const memberCoursesResults = await mapConcurrent(cleanClassEmails, MEMBER_CONCURRENCY, async (email: string) => {
        try {
          const courses = await listStudentCourses(email, adminEmail);
          return { email, courses, success: true };
        } catch (err: any) {
          console.warn(`[scan_members] Failed to list courses for member ${email}:`, err?.message || err);
          failedMemberEmails.push(email);
          return { email, courses: [], success: false };
        }
      });

      const successfulResults = memberCoursesResults.filter(r => r.success);
      const checkedMemberCount = successfulResults.length;

      if (checkedMemberCount === 0) {
        return NextResponse.json({
          error: "학급 멤버의 클래스룸 수강 정보 조회가 모두 실패하였습니다.",
          failedMemberEmails,
        }, { status: 500 });
      }

      // 2. 코스별 가입 멤버 수 집계
      const courseMap = new Map<string, { count: number; courseInfo: any }>();
      for (const res of successfulResults) {
        // 한 멤버가 같은 코스에 중복 등록되어 있을 경우 1회만 카운트
        const seenCourseIds = new Set<string>();
        for (const c of res.courses) {
          const cId = String(c.id);
          if (seenCourseIds.has(cId)) continue;
          seenCourseIds.add(cId);

          const existing = courseMap.get(cId);
          if (existing) {
            existing.count += 1;
          } else {
            courseMap.set(cId, {
              count: 1,
              courseInfo: {
                id: cId,
                name: String(c.name || ""),
                section: String(c.section || ""),
                ownerId: String(c.ownerId || ""),
              },
            });
          }
        }
      }

      // 3. 1차 후보 선정: coverage >= 0.8 (가입수 / checkedMemberCount >= 0.8)
      const primaryCandidates: { courseId: string; count: number; courseInfo: any; coverage: number }[] = [];
      courseMap.forEach((val, courseId) => {
        const coverage = val.count / checkedMemberCount;
        if (coverage >= COVERAGE_THRESHOLD) {
          primaryCandidates.push({
            courseId,
            count: val.count,
            courseInfo: val.courseInfo,
            coverage,
          });
        }
      });

      // 4. 전입생 본인 가입 코스 목록 1회 조회 (alreadyEnrolled 판정용)
      let enrolledCourseSet = new Set<string>();
      try {
        const targetCourses = await listStudentCourses(targetStudentEmail, adminEmail);
        enrolledCourseSet = new Set(targetCourses.map((c: any) => String(c.id)));
      } catch (e) {
        console.warn(`[scan_members] Failed to check enrollment for target student ${targetStudentEmail}:`, e);
      }

      // 5. 1차 후보 코스들에 대해 전체 수강생 수(courseSize), purity >= 0.7, minSize >= 5 판정 및 교사 프로필 해석
      const candidates: any[] = [];

      for (const item of primaryCandidates) {
        const { courseId, count, courseInfo, coverage } = item;
        try {
          const students = await listClassroomStudents(courseId, adminEmail);
          const courseSize = students.length;
          const purity = courseSize > 0 ? count / courseSize : 0;

          if (purity >= PURITY_THRESHOLD && courseSize >= MIN_COURSE_SIZE) {
            const alreadyEnrolled = enrolledCourseSet.has(courseId);

            // 소유 교사 프로필 해석
            let ownerName = courseInfo.ownerId;
            let ownerEmail = courseInfo.ownerId;
            if (courseInfo.ownerId) {
              try {
                const ownerProfile = await getClassroomUserProfile(courseInfo.ownerId);
                if (ownerProfile) {
                  ownerEmail = ownerProfile.emailAddress || courseInfo.ownerId;
                  if (ownerProfile.name) {
                    const fName = ownerProfile.name.familyName || "";
                    const gName = ownerProfile.name.givenName || "";
                    ownerName = `${fName}${gName}`.trim() || ownerEmail;
                  }
                }
              } catch (e) {}
            }

            candidates.push({
              courseId,
              name: courseInfo.name,
              section: courseInfo.section,
              ownerName,
              ownerEmail,
              coverage: Math.round(coverage * 100) / 100,
              purity: Math.round(purity * 100) / 100,
              classMemberCount: count,
              totalClassCount: checkedMemberCount,
              courseSize,
              alreadyEnrolled,
            });
          }
        } catch (cErr) {
          console.warn(`[scan_members] Failed to fetch student list for course ${courseId}:`, cErr);
        }
      }

      candidates.sort((a, b) => b.coverage - a.coverage);

      return NextResponse.json({
        success: true,
        candidates,
        failedMemberEmails,
        checkedMemberCount,
      });
    }

    // ==========================================
    // Action 2: "enroll" — 선택한 학급 클래스룸 일괄 가입
    // ==========================================
    if (action === "enroll") {
      const { studentEmail, courseIds, courseNames } = body;
      if (!studentEmail || !courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
        return NextResponse.json({ error: "studentEmail 및 courseIds 배열이 누락되었습니다." }, { status: 400 });
      }

      if (courseIds.length > 30) {
        return NextResponse.json({ error: "한 번에 최대 30개 코스까지만 선택할 수 있습니다." }, { status: 400 });
      }

      const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || operatorEmail;
      const targetStudentEmail = String(studentEmail).trim();
      const results: { courseId: string; courseName?: string; success: boolean; alreadyEnrolled?: boolean; error?: string }[] = [];

      for (let i = 0; i < courseIds.length; i++) {
        const cId = courseIds[i];
        const cName = courseNames?.[i] || cId;
        try {
          await addStudentToClassroom(cId, targetStudentEmail, adminEmail);
          results.push({ courseId: cId, courseName: cName, success: true, alreadyEnrolled: false });
        } catch (err: any) {
          const errMsg = String(err?.message || err);
          const errCode = err?.code || err?.status;

          // 409 ALREADY_EXISTS 처리: 이미 가입된 경우 성공으로 간주 (§5)
          if (errCode === 409 || errMsg.includes("409") || errMsg.includes("already exists") || errMsg.includes("ALREADY_EXISTS")) {
            results.push({ courseId: cId, courseName: cName, success: true, alreadyEnrolled: true });
          } else if (errCode === 404 || errMsg.includes("404") || errMsg.includes("not found")) {
            // 계정 디렉터리 전파 지연 404 (§8)
            results.push({
              courseId: cId,
              courseName: cName,
              success: false,
              error: "구글 계정이 아직 디렉터리에 전파되지 않았습니다. 잠시 후 재시도해 주세요.",
            });
          } else {
            results.push({ courseId: cId, courseName: cName, success: false, error: errMsg });
          }
        }
      }

      const successfulNames = results.filter(r => r.success).map(r => r.courseName || r.courseId);
      if (successfulNames.length > 0) {
        await writeAuditLog({
          operatorEmail,
          action: "CLASSROOM_TRANSFER_ENROLL",
          targetEmail: targetStudentEmail,
          details: `전입생 학급 클래스룸 배정 (${successfulNames.join(", ")})`,
          status: "success",
        });
      }

      return NextResponse.json({
        success: true,
        studentEmail: targetStudentEmail,
        results,
      });
    }

    return NextResponse.json({ error: "올바르지 않은 action입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("Error in POST /api/workspace/classroom/transfer-enroll:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
