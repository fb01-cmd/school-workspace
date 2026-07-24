import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import {
  listClassroomCourses,
  getSchoolYearFromCreationTime,
  getCurrentSchoolYear,
  isCleanupTargetCourse,
  renameClassroomCourse,
  archiveClassroomCourse,
  unsubscribeClassroomCalendar,
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

    const courses = await listClassroomCourses(teacherEmail);
    const currentSchoolYear = getCurrentSchoolYear();

    const courseDetails = courses.map((c: any) => {
      const creationTime = c.creationTime || null;
      const schoolYear = creationTime ? getSchoolYearFromCreationTime(creationTime) : currentSchoolYear;
      const isTarget = isCleanupTargetCourse(c);
      
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
        isOwner: c.ownerId === teacherEmail || !c.ownerId,
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

      return NextResponse.json({ success: true, restoredCourse, driveRestored });
    }

    // 2. 정리 (Cleanup) 4단계 파이프라인 처리
    if (action === "cleanup") {
      if (!courseId) {
        return NextResponse.json({ error: "courseId가 누락되었습니다." }, { status: 400 });
      }

      const pipelineResults: {
        rename?: { success: boolean; name?: string; error?: string };
        archive?: { success: boolean; state?: string; error?: string };
        calendar?: { success: boolean; error?: string };
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
          await unsubscribeClassroomCalendar(teacherEmail, calendarId);
          pipelineResults.calendar = { success: true };
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
