import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import {
  listClassroomCourses,
  getClassroomUserId,
  getSchoolYearFromCreationTime,
  getCurrentSchoolYear,
  isCleanupTargetCourse,
  renameClassroomCourse,
  archiveClassroomCourse,
  unsubscribeClassroomCalendar,
  restoreClassroomCalendar,
  moveDriveFolderToArchive,
  findOrCreateArchiveFolder,
  restoreClassroomCourse,
  isMock
} from "@/lib/google/workspace";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, doc, updateDoc, getDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { writeAuditLog } from "@/lib/firebase/audit";

/**
 * GET /api/workspace/classroom/cleanup
 * 교사 소유 클래스룸 스캔 & 학기말 정리 대상 목록 및 제안 데이터 반환
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuthAccess(req);
    if (!authResult) {
      return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
    }
    const { email: teacherEmail, role } = authResult;

    if (role !== "teacher" && role !== "super_admin") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");

    // 정리 작업 이력 조회
    if (action === "logs") {
      try {
        const logsRef = collection(db, "classroom_cleanup_logs");
        let logs: any[] = [];
        try {
          const q = query(
            logsRef,
            where("teacherEmail", "==", teacherEmail),
            orderBy("timestamp", "desc"),
            limit(30)
          );
          const snap = await getDocs(q);
          logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (idxErr) {
          // Fallback if composite index is building or missing
          console.warn("Index query failed, falling back to in-memory filter & sort:", idxErr);
          const qFallback = query(logsRef, where("teacherEmail", "==", teacherEmail));
          const snapFallback = await getDocs(qFallback);
          logs = snapFallback.docs.map(d => ({ id: d.id, ...d.data() }));
          logs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
          logs = logs.slice(0, 30);
        }
        return NextResponse.json({ logs });
      } catch (err: any) {
        console.error("Failed to query classroom_cleanup_logs:", err);
        return NextResponse.json({ logs: [] });
      }
    }

    // 개발 환경 전용: ?asOf=YYYY-MM-DD 로 "현재 날짜"를 시뮬레이션해 학기말 정리 로직(2월 예외 등)을
    // 실제 2월/3월을 기다리지 않고도 브라우저에서 눈으로 검증할 수 있게 함. 프로덕션에서는 무시됨.
    const asOfParam = searchParams.get("asOf");
    const refDate = process.env.NODE_ENV !== "production" && asOfParam ? new Date(asOfParam) : new Date();

    // ownerId는 이메일이 아닌 Classroom 숫자 사용자 ID로 반환되므로, 본인 숫자 ID를 함께 조회해 비교
    const [courses, teacherUserId] = await Promise.all([
      listClassroomCourses(teacherEmail),
      getClassroomUserId(teacherEmail),
    ]);
    const currentSchoolYear = getCurrentSchoolYear(refDate);

    const courseDetails = courses.map((c: any) => {
      const creationTime = c.creationTime || null;
      const schoolYear = creationTime ? getSchoolYearFromCreationTime(creationTime) : currentSchoolYear;
      const isTarget = isCleanupTargetCourse(c, refDate);
      
      // 연도 접두어 여부 검사 (예: "2025 수학", "2025-수학", "[2025] 수학" 등)
      const hasYearPrefix = /^(20\d{2}[\s\-\[]|\[20\d{2}\])/.test(c.name || "");
      const suggestedName = !hasYearPrefix && schoolYear ? `${schoolYear} ${c.name}` : c.name;

      return {
        id: c.id,
        name: c.name,
        section: c.section,
        courseState: c.courseState,
        creationTime,
        schoolYear,
        isTarget,
        hasYearPrefix,
        suggestedName,
        teacherFolder: c.teacherFolder || null,
        calendarId: c.calendarId || null,
        ownerId: c.ownerId,
        isOwner: !c.ownerId || c.ownerId === teacherEmail || (teacherUserId !== null && c.ownerId === teacherUserId),
      };
    });

    const targetCourses = courseDetails.filter(c => c.isTarget);
    const activeCourses = courseDetails.filter(c => c.courseState === "ACTIVE");

    return NextResponse.json({
      success: true,
      currentSchoolYear,
      teacherEmail,
      stats: {
        totalActive: activeCourses.length,
        targetCount: targetCourses.length,
      },
      courses: courseDetails,
      isMock,
    });
  } catch (error: any) {
    console.error("Error in GET /api/workspace/classroom/cleanup:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

/**
 * POST /api/workspace/classroom/cleanup
 * 클래스룸 4단계 파이프라인 일괄/개별 정리 실행 및 원복
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuthAccess(req);
    if (!authResult) {
      return NextResponse.json({ error: "인증되지 않은 사용자입니다." }, { status: 401 });
    }
    const { email: teacherEmail, role } = authResult;

    if (role !== "teacher" && role !== "super_admin") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json();
    const { action, courseId, schoolYear, newName, originalName, calendarId, driveFolderId, targetParentFolderId, logId } = body;

    // 1. 원복 (Restore) 처리
    if (action === "restore") {
      if (!courseId) {
        return NextResponse.json({ error: "courseId가 누락되었습니다." }, { status: 400 });
      }

      // 로그 문서 소유자 검증
      let logDocData: any = null;
      if (logId) {
        try {
          const logRef = doc(db, "classroom_cleanup_logs", logId);
          const snap = await getDoc(logRef);
          if (snap.exists()) {
            logDocData = snap.data();
            if (logDocData.teacherEmail && logDocData.teacherEmail !== teacherEmail && role !== "super_admin") {
              return NextResponse.json({ error: "본인의 정리 기록만 원복할 수 있습니다." }, { status: 403 });
            }
          }
        } catch (e) {
          console.error("Failed to fetch cleanup log for restore verification:", e);
        }
      }

      const restoredCourse = await restoreClassroomCourse(teacherEmail, courseId, originalName);
      
      // 캘린더 되돌리기 시도 (숨김 해제 또는 재구독)
      const targetCalendarId = calendarId || logDocData?.calendarId;
      const hiddenInsteadOfUnsubscribed = logDocData?.results?.calendar?.hiddenInsteadOfUnsubscribed;
      let calendarRestored = false;

      if (targetCalendarId) {
        try {
          await restoreClassroomCalendar(teacherEmail, targetCalendarId, hiddenInsteadOfUnsubscribed);
          calendarRestored = true;
        } catch (cErr) {
          console.error("Failed to restore calendar:", cErr);
        }
      }

      // 드라이브 폴더 원래 위치 원복 시도 (driveFolderId & driveOriginalParentFolderId)
      const targetDriveId = driveFolderId || logDocData?.driveFolderId;
      const originalDriveParentId = logDocData?.driveOriginalParentFolderId;
      let driveRestored = false;

      if (targetDriveId && originalDriveParentId) {
        try {
          await moveDriveFolderToArchive(teacherEmail, targetDriveId, originalDriveParentId);
          driveRestored = true;
        } catch (dErr) {
          console.error("Failed to restore drive folder location:", dErr);
        }
      }

      // 로그 상태 업데이트
      if (logId) {
        try {
          const logRef = doc(db, "classroom_cleanup_logs", logId);
          await updateDoc(logRef, {
            restored: true,
            restoredAt: new Date().toISOString(),
            driveRestored,
            calendarRestored,
          });
        } catch (e) {
          console.error("Failed to update cleanup log restore status:", e);
        }
      }

      await writeAuditLog({
        operatorEmail: teacherEmail,
        action: "CLASSROOM_CLEANUP_RESTORE",
        targetEmail: courseId,
        details: `클래스룸 보관 해제 및 복원 (${originalName || courseId})`,
        status: "success",
      });

      return NextResponse.json({ success: true, restoredCourse, driveRestored, calendarRestored });
    }

    // 2. 정리 (Cleanup) 4단계 파이프라인 처리
    if (action === "cleanup") {
      if (!courseId) {
        return NextResponse.json({ error: "courseId가 누락되었습니다." }, { status: 400 });
      }

      const pipelineResults: {
        rename?: { success: boolean; name?: string; error?: string };
        archive?: { success: boolean; state?: string; error?: string };
        calendar?: { success: boolean; error?: string; hiddenInsteadOfUnsubscribed?: boolean };
        drive?: { success: boolean; error?: string; targetParentFolderId?: string; originalParentFolderId?: string | null };
      } = {};

      // 1단계: 이름 변경 (선택 또는 제안된 연도 접두어 이름)
      if (newName && newName !== originalName) {
        try {
          const renamed = await renameClassroomCourse(teacherEmail, courseId, newName);
          pipelineResults.rename = { success: true, name: renamed.name || undefined };
        } catch (err: any) {
          pipelineResults.rename = { success: false, error: err.message };
        }
      }

      // 2단계: 클래스룸 보관 처리 (ARCHIVED)
      try {
        const archived = await archiveClassroomCourse(teacherEmail, courseId);
        pipelineResults.archive = { success: true, state: archived.courseState || undefined };
      } catch (err: any) {
        pipelineResults.archive = { success: false, error: err.message };
      }

      // 3단계: 캘린더 구독 해제 (선택)
      if (calendarId) {
        try {
          const calResult = await unsubscribeClassroomCalendar(teacherEmail, calendarId);
          // 소유자 캘린더는 구독 취소 대신 숨김 처리됨 — 추후 캘린더 복원 시 hidden: false로 되돌려야 하므로 로그에 구분 저장
          pipelineResults.calendar = {
            success: true,
            hiddenInsteadOfUnsubscribed: (calResult as any)?.hiddenInsteadOfUnsubscribed || undefined,
          };
        } catch (err: any) {
          pipelineResults.calendar = { success: false, error: err.message };
        }
      }

      // 4단계: 드라이브 폴더 이동 ("이전년도 클래스룸/<schoolYear>학년도" 상위 폴더 찾기/생성 후 이동)
      let driveOriginalParentFolderId: string | null = null;
      if (driveFolderId) {
        try {
          let parentId = targetParentFolderId;
          if (!parentId) {
            const sYear = schoolYear || getCurrentSchoolYear() - 1;
            parentId = await findOrCreateArchiveFolder(teacherEmail, sYear);
          }

          const moveResult = await moveDriveFolderToArchive(teacherEmail, driveFolderId, parentId);
          driveOriginalParentFolderId = moveResult.originalParentFolderId ?? null;
          pipelineResults.drive = {
            success: true,
            targetParentFolderId: parentId,
            originalParentFolderId: driveOriginalParentFolderId,
          };
        } catch (err: any) {
          pipelineResults.drive = { success: false, error: err.message };
        }
      }

      // Firestore 감사/원복 로그 저장
      const logData = {
        teacherEmail,
        courseId,
        originalName: originalName || "",
        newName: newName || originalName || "",
        calendarId: calendarId || null,
        driveFolderId: driveFolderId || null,
        driveOriginalParentFolderId,
        results: pipelineResults,
        timestamp: new Date().toISOString(),
        restored: false,
      };

      try {
        const docRef = await addDoc(collection(db, "classroom_cleanup_logs"), logData);
        await writeAuditLog({
          operatorEmail: teacherEmail,
          action: "CLASSROOM_CLEANUP_EXECUTE",
          targetEmail: courseId,
          details: `클래스룸 학기말 보관 정리 (${logData.newName})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          logId: docRef.id,
          pipelineResults,
        });
      } catch (err: any) {
        console.error("Failed to save cleanup log:", err);
        return NextResponse.json({
          success: true,
          pipelineResults,
          logSaveError: err.message,
        });
      }
    }

    return NextResponse.json({ error: "올바르지 않은 action입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("Error in POST /api/workspace/classroom/cleanup:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
