import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess, getStudentOUPaths } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  listAllDomainCourses,
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
// 학급 클래스룸 매칭 판정 알고리즘 상수
// ==========================================
const MIN_CLASS_SIZE = 3;         // 신뢰할 수 있는 매칭을 위한 학급 재적 최소 인원 (3명 이상)
const COVERAGE_THRESHOLD = 0.8;   // 우리 반 학생 중 코스 가입 비율 (80% 이상)
const PURITY_THRESHOLD = 0.7;     // 코스 수강생 중 우리 반 학생 비율 (70% 이상)
const MIN_COURSE_SIZE = 5;        // 소규모 특강/소그룹 배제를 위한 코스 최소 수강생 (5명 이상)
const BATCH_COURSE_LIMIT = 15;    // scan_batch 1회당 최대 코스 수 (쿼터 및 Vercel 타임아웃 방지)
const ROSTER_CONCURRENCY = 3;     // Google API per-minute 쿼터 보호를 위한 배치 내 동시성 제한

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
 * action: "scan_init" — 반 재적 명단 및 ACTIVE 코스 목록 초기화
 * action: "scan_batch" — 코스 로스터 배치 스캔 (≤15개 코스, 동시성 3)
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
    // Action 1: "scan_init" — 학급 명단 및 코스 목록 초기화 (v1.1)
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

      // 2. 도메인 전체 ACTIVE 코스 목록 조회 (로스터 조회 없음 — 빠름)
      const activeCourses = await listAllDomainCourses();
      const courses = activeCourses.map((c: any) => ({
        id: String(c.id),
        name: String(c.name || ""),
        section: String(c.section || ""),
        ownerId: String(c.ownerId || "")
      }));

      return NextResponse.json({
        success: true,
        grade: targetGrade,
        classNum: targetClassNum,
        studentEmail: targetStudentEmail,
        classEmails,
        courses,
        totalClassCount: classEmails.length,
        isMock,
      });
    }

    // ==========================================
    // Action 2: "scan_batch" — 코스 로스터 동시성 3 배치 스캔 (v1.1)
    // ==========================================
    if (action === "scan_batch") {
      const { studentEmail, classEmails, courses } = body;
      if (!studentEmail || !Array.isArray(classEmails) || !Array.isArray(courses)) {
        return NextResponse.json({ error: "studentEmail, classEmails, courses 배열이 누락되었습니다." }, { status: 400 });
      }

      if (courses.length > BATCH_COURSE_LIMIT) {
        return NextResponse.json({
          error: `1회 배치당 최대 ${BATCH_COURSE_LIMIT}개 코스까지만 검사할 수 있습니다.`,
        }, { status: 400 });
      }

      const targetStudentEmail = String(studentEmail).toLowerCase().trim();
      const classEmailSet = new Set(classEmails.map((e: any) => String(e).toLowerCase().trim()));
      const totalClassCount = classEmailSet.size;

      const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || operatorEmail;

      // 동시성 3으로 로스터 조회 및 판정 실행
      const batchResults = await mapConcurrent(courses, ROSTER_CONCURRENCY, async (course: any) => {
        try {
          const students = await listClassroomStudents(course.id, adminEmail);
          const courseEmails = students
            .map((s: any) => s.profile?.emailAddress?.toLowerCase())
            .filter(Boolean) as string[];

          const courseEmailSet = new Set(courseEmails);

          // 교집합 (|COURSE ∩ CLASS|) 계산
          let inBothCount = 0;
          classEmailSet.forEach(email => {
            if (courseEmailSet.has(email)) {
              inBothCount++;
            }
          });

          const courseSize = courseEmailSet.size;
          const coverage = totalClassCount > 0 ? inBothCount / totalClassCount : 0;
          const purity = courseSize > 0 ? inBothCount / courseSize : 0;

          // 매칭 판정 조건: coverage >= 0.8 && purity >= 0.7 && courseSize >= 5
          const isMatch = coverage >= COVERAGE_THRESHOLD && purity >= PURITY_THRESHOLD && courseSize >= MIN_COURSE_SIZE;

          if (!isMatch) {
            return { candidate: null, failedCourseId: null };
          }

          // 이미 전입생이 가입되어 있는지 여부
          const alreadyEnrolled = courseEmailSet.has(targetStudentEmail);

          // 코스 소유 교사 프로필 해석
          let ownerName = course.ownerId;
          let ownerEmail = course.ownerId;
          if (course.ownerId) {
            try {
              const ownerProfile = await getClassroomUserProfile(course.ownerId);
              if (ownerProfile) {
                ownerEmail = ownerProfile.emailAddress || course.ownerId;
                if (ownerProfile.name) {
                  const fName = ownerProfile.name.familyName || "";
                  const gName = ownerProfile.name.givenName || "";
                  ownerName = `${fName}${gName}`.trim() || ownerEmail;
                }
              }
            } catch (e) {}
          }

          return {
            candidate: {
              courseId: course.id,
              name: course.name,
              section: course.section || "",
              ownerName,
              ownerEmail,
              coverage: Math.round(coverage * 100) / 100,
              purity: Math.round(purity * 100) / 100,
              classMemberCount: inBothCount,
              totalClassCount,
              courseSize,
              alreadyEnrolled,
            },
            failedCourseId: null,
          };
        } catch (err: any) {
          console.warn(`[scan_batch] Error scanning roster for course ${course.id}:`, err?.message || err);
          // 429/오류 코스를 버리지 않고 failedCourseId로 반환
          return { candidate: null, failedCourseId: String(course.id) };
        }
      });

      const candidates = batchResults
        .map(r => r.candidate)
        .filter(Boolean)
        .sort((a: any, b: any) => b.coverage - a.coverage);

      const failedCourseIds = batchResults
        .map(r => r.failedCourseId)
        .filter(Boolean) as string[];

      return NextResponse.json({
        success: true,
        candidates,
        failedCourseIds,
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
