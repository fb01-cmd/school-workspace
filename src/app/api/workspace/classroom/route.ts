import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { 
  listClassroomCourses, 
  createClassroomCourse, 
  addStudentToClassroom, 
  removeStudentFromClassroom,
  listClassroomStudents,
  isMock
} from "@/lib/google/workspace";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { writeAuditLog } from "@/lib/firebase/audit";

// GET handler
export async function GET(req: NextRequest) {
  try {
    // 1. Authentication Check
    const authResult = await verifyAuthAccess(req);
    if (!authResult) {
      return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
    }
    const { email, role } = authResult;

    // Only teachers or super_admins can access
    if (role !== "teacher" && role !== "super_admin") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // A. List courses owned by teacher
    if (action === "courses") {
      try {
        const courses = await listClassroomCourses(email);
        return NextResponse.json({ courses, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `클래스룸 조회 실패: ${err.message}` }, { status: 500 });
      }
    }

    // B. List classroom students
    if (action === "students") {
      const courseId = searchParams.get("courseId");
      if (!courseId) {
        return NextResponse.json({ error: "courseId가 누락되었습니다." }, { status: 400 });
      }
      try {
        const students = await listClassroomStudents(courseId, email);
        return NextResponse.json({ students });
      } catch (err: any) {
        return NextResponse.json({ error: `학생 목록 조회 실패: ${err.message}` }, { status: 500 });
      }
    }

    // C. Fetch historical classroom sync logs for the teacher
    if (action === "logs") {
      try {
        const logsRef = collection(db, "classroom_sync_logs");
        const q = query(
          logsRef,
          where("teacherEmail", "==", email),
          orderBy("timestamp", "desc"),
          limit(20)
        );
        const snap = await getDocs(q);
        const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return NextResponse.json({ logs });
      } catch (err: any) {
        // Fallback if index is building or query fails
        console.error("Failed to query classroom logs", err);
        return NextResponse.json({ logs: [] });
      }
    }

    return NextResponse.json({ error: "올바르지 않은 action입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

// POST handler
export async function POST(req: NextRequest) {
  try {
    // 1. Authentication Check
    const authResult = await verifyAuthAccess(req);
    if (!authResult) {
      return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
    }
    const { email: teacherEmail, role } = authResult;
    const teacherName = teacherEmail.split("@")[0];

    if (role !== "teacher" && role !== "super_admin") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body;

    // A. CREATE AND SYNC ROSTER (새 코스 생성하며 학생 배정)
    if (action === "create_and_sync") {
      const { courseName, sectionName, studentEmails } = body;
      if (!courseName || !Array.isArray(studentEmails)) {
        return NextResponse.json({ error: "필수 정보(courseName, studentEmails)가 누락되었습니다." }, { status: 400 });
      }

      try {
        // 1. Create Classroom Course
        const newCourse = await createClassroomCourse(courseName, sectionName || "", teacherEmail);
        const courseId = newCourse.id;

        // 2. Add students in parallel
        const results = await Promise.allSettled(
          studentEmails.map(studentEmail => addStudentToClassroom(courseId as string, studentEmail, teacherEmail))
        );

        const failures: { email: string; reason: string }[] = [];
        let successCount = 0;

        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            successCount++;
          } else {
            const rawMsg = res.reason?.message || "알 수 없는 에러";
            let friendlyReason = rawMsg;
            if (rawMsg.includes("already exists") || rawMsg.includes("409")) {
              friendlyReason = "이미 클래스룸에 가입된 학생입니다.";
            } else if (rawMsg.includes("404")) {
              friendlyReason = "존재하지 않는 구글 계정입니다.";
            }
            failures.push({
              email: studentEmails[idx],
              reason: friendlyReason
            });
          }
        });

        // 3. Write sync log in Firestore
        const logData = {
          action: "CREATE_AND_SYNC",
          courseId,
          courseName,
          sectionName: sectionName || "",
          teacherEmail,
          teacherName: teacherName,
          studentEmails,
          successCount,
          failures,
          timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
        };
        await addDoc(collection(db, "classroom_sync_logs"), logData);

        // Audit Log
        await writeAuditLog({
          operatorEmail: teacherEmail,
          operatorName: teacherName,
          action: "클래스룸 신규 개설 & 학생 배정",
          targetEmail: "복수 학생",
          details: `수업 [${courseName}] 개설 및 학생 ${successCount}명 배정 완료 (실패: ${failures.length}건)`,
          status: failures.length === 0 ? "success" : "failure"
        });

        return NextResponse.json({ success: true, courseId, successCount, failures, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `클래스룸 개설 및 배정 실패: ${err.message}` }, { status: 500 });
      }
    }

    // B. SYNC ROSTER TO EXISTING COURSE (기존 수업에 학생 배정)
    if (action === "existing_sync") {
      const { courseId, courseName, studentEmails } = body;
      if (!courseId || !courseName || !Array.isArray(studentEmails)) {
        return NextResponse.json({ error: "필수 정보(courseId, courseName, studentEmails)가 누락되었습니다." }, { status: 400 });
      }

      try {
        const results = await Promise.allSettled(
          studentEmails.map(studentEmail => addStudentToClassroom(courseId, studentEmail, teacherEmail))
        );

        const failures: { email: string; reason: string }[] = [];
        let successCount = 0;

        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            successCount++;
          } else {
            const rawMsg = res.reason?.message || "알 수 없는 에러";
            let friendlyReason = rawMsg;
            if (rawMsg.includes("already exists") || rawMsg.includes("409")) {
              friendlyReason = "이미 클래스룸에 가입된 학생입니다.";
            } else if (rawMsg.includes("404")) {
              friendlyReason = "존재하지 않는 구글 계정입니다.";
            }
            failures.push({
              email: studentEmails[idx],
              reason: friendlyReason
            });
          }
        });

        // Write sync log in Firestore
        const logData = {
          action: "EXISTING_SYNC",
          courseId,
          courseName,
          sectionName: "",
          teacherEmail,
          teacherName: teacherName,
          studentEmails,
          successCount,
          failures,
          timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
        };
        await addDoc(collection(db, "classroom_sync_logs"), logData);

        // Audit Log
        await writeAuditLog({
          operatorEmail: teacherEmail,
          operatorName: teacherName,
          action: "클래스룸 기존 수업 배정",
          targetEmail: "복수 학생",
          details: `수업 [${courseName}]에 학생 ${successCount}명 배정 완료 (실패: ${failures.length}건)`,
          status: failures.length === 0 ? "success" : "failure"
        });

        return NextResponse.json({ success: true, successCount, failures, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `클래스룸 학생 배정 실패: ${err.message}` }, { status: 500 });
      }
    }

    // C. REMOVE STUDENT FROM COURSE (실수 취소 지원)
    if (action === "remove_student") {
      const { courseId, courseName, studentEmail } = body;
      if (!courseId || !studentEmail) {
        return NextResponse.json({ error: "courseId와 studentEmail은 필수입니다." }, { status: 400 });
      }

      try {
        await removeStudentFromClassroom(courseId, studentEmail, teacherEmail);

        // Audit Log
        await writeAuditLog({
          operatorEmail: teacherEmail,
          operatorName: teacherName,
          action: "클래스룸 학생 제외",
          targetEmail: studentEmail,
          details: `수업 [${courseName || courseId}]에서 학생 계정을 가입 해제(제외) 처리`,
          status: "success"
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `학생 제외 실패: ${err.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "올바르지 않은 action입니다." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
