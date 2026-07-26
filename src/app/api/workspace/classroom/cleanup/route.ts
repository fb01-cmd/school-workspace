import { NextRequest, NextResponse } from "next/server";
import { verifyAuthAccess, adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
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
  findArchiveFolder,
  restoreClassroomCourse,
  checkCalendarResidual,
  checkDriveFolderResidual,
  isMock
} from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit-server";

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
        const logsRef = adminDb.collection("classroom_cleanup_logs");
        let logs: any[] = [];
        try {
          const snap = await logsRef
            .where("teacherEmail", "==", teacherEmail)
            .orderBy("timestamp", "desc")
            .limit(30)
            .get();
          logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (idxErr) {
          // Fallback if composite index is building or missing
          console.warn("Index query failed, falling back to in-memory filter & sort:", idxErr);
          const snapFallback = await logsRef.where("teacherEmail", "==", teacherEmail).get();
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
    const mode = searchParams.get("mode");

    // 역방향 잔여 정리 대상 조회: 교사가 직접 ARCHIVED 처리한 코스 중 캘린더 잔존 또는 드라이브 미이동 항목 탐지
    if (mode === "residual") {
      const currentSchoolYear = getCurrentSchoolYear(refDate);
      const [archivedCourses, teacherUserId] = await Promise.all([
        listClassroomCourses(teacherEmail, ["ARCHIVED"]),
        getClassroomUserId(teacherEmail),
      ]);

      // 최근 2개 학년도 생성분만 검사 (currentSchoolYear - 1 이상)
      const recentArchived = archivedCourses.filter((c: any) => {
        if (!c.creationTime) return true;
        const sYear = getSchoolYearFromCreationTime(c.creationTime);
        return sYear >= currentSchoolYear - 1;
      });

      // 학년도별 상위 아카이브 폴더 ID를 사전 1회 순수 조회 (생성 없음 — 중복 생성 및 미생성 시 드라이브 자동 생성 방지)
      const uniqueSchoolYears = Array.from(
        new Set(recentArchived.map((c: any) => (c.creationTime ? getSchoolYearFromCreationTime(c.creationTime) : currentSchoolYear)))
      );
      const archiveFolderMap: Record<number, string | null> = {};
      for (const sYear of uniqueSchoolYears) {
        archiveFolderMap[sYear] = await findArchiveFolder(teacherEmail, sYear);
      }

      const residualCourseDetails = await Promise.all(
        recentArchived.map(async (c: any) => {
          const creationTime = c.creationTime || null;
          const schoolYear = creationTime ? getSchoolYearFromCreationTime(creationTime) : currentSchoolYear;
          const isOwner = !c.ownerId || c.ownerId === teacherEmail || (teacherUserId !== null && c.ownerId === teacherUserId);
          const archiveFolderId = archiveFolderMap[schoolYear] ?? null;

          const [calendarResidual, driveResidual] = await Promise.all([
            c.calendarId ? checkCalendarResidual(teacherEmail, c.calendarId) : Promise.resolve(false),
            c.teacherFolder?.id ? checkDriveFolderResidual(teacherEmail, c.teacherFolder.id, archiveFolderId) : Promise.resolve(false),
          ]);

          return {
            id: c.id,
            name: c.name,
            section: c.section,
            courseState: c.courseState,
            creationTime,
            schoolYear,
            teacherFolder: c.teacherFolder || null,
            calendarId: c.calendarId || null,
            ownerId: c.ownerId,
            isOwner,
            calendarResidual,
            driveResidual,
            hasResidual: calendarResidual || driveResidual,
          };
        })
      );

      const residualCourses = residualCourseDetails.filter(c => c.hasResidual);

      return NextResponse.json({
        success: true,
        currentSchoolYear,
        teacherEmail,
        courses: residualCourses,
        isMock,
      });
    }

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
          const logRef = adminDb.collection("classroom_cleanup_logs").doc(logId);
          const snap = await logRef.get();
          if (snap.exists) {
            logDocData = snap.data() || {};
            if (logDocData.teacherEmail && logDocData.teacherEmail !== teacherEmail && role !== "super_admin") {
              return NextResponse.json({ error: "본인의 정리 기록만 원복할 수 있습니다." }, { status: 403 });
            }
          }
        } catch (e) {
          console.error("Failed to fetch cleanup log for restore verification:", e);
        }
      }

      // residual 모드 로그인지 판별: 교사가 직접 보관(ARCHIVED)했던 코스의 잔여 정리 로그면 코스 보관 해제를 건너뛴다
      const isResidual = logDocData?.mode === "residual";
      let restoredCourse: any = null;
      if (!isResidual) {
        restoredCourse = await restoreClassroomCourse(teacherEmail, courseId, originalName);
      } else {
        restoredCourse = { id: courseId, courseState: "ARCHIVED", name: originalName, isResidual: true };
      }
      
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
          const logRef = adminDb.collection("classroom_cleanup_logs").doc(logId);
          await logRef.update({
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
        details: isResidual
          ? `잔여 정돈 원복(보관 유지) (${originalName || courseId})`
          : `클래스룸 보관 해제 및 복원 (${originalName || courseId})`,
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
        const docRef = await adminDb.collection("classroom_cleanup_logs").add(logData);
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

    // 3. 역방향 잔여 정리 (execute_residual) 처리: 이미 ARCHIVED된 코스의 캘린더 구독 해제 & 드라이브 폴더 이동만 실행 (rename/archive 건너뜀)
    if (action === "execute_residual") {
      if (!courseId) {
        return NextResponse.json({ error: "courseId가 누락되었습니다." }, { status: 400 });
      }

      const pipelineResults: {
        rename?: { success: boolean; skipped: boolean };
        archive?: { success: boolean; skipped: boolean };
        calendar?: { success: boolean; error?: string; hiddenInsteadOfUnsubscribed?: boolean };
        drive?: { success: boolean; error?: string; targetParentFolderId?: string; originalParentFolderId?: string | null };
      } = {
        rename: { success: true, skipped: true },
        archive: { success: true, skipped: true },
      };

      // 캘린더 구독 해제 (본인 것이므로 공동 교사도 허용)
      if (calendarId) {
        try {
          const calResult = await unsubscribeClassroomCalendar(teacherEmail, calendarId);
          pipelineResults.calendar = {
            success: true,
            hiddenInsteadOfUnsubscribed: (calResult as any)?.hiddenInsteadOfUnsubscribed || undefined,
          };
        } catch (err: any) {
          pipelineResults.calendar = { success: false, error: err.message };
        }
      }

      // 드라이브 폴더 이동 (isOwner만)
      let driveOriginalParentFolderId: string | null = null;
      if (driveFolderId) {
        const isOwner = body.isOwner !== false;
        if (!isOwner) {
          pipelineResults.drive = { success: false, error: "공동 교사는 드라이브 폴더 이동 권한이 없습니다." };
        } else {
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
      }

      // Firestore 감사/원복 로그 저장 (mode: "residual" 필드 포함해 기존 복원 기능 호환)
      const logData = {
        teacherEmail,
        courseId,
        originalName: originalName || "",
        newName: originalName || "",
        calendarId: calendarId || null,
        driveFolderId: driveFolderId || null,
        driveOriginalParentFolderId,
        results: pipelineResults,
        timestamp: new Date().toISOString(),
        restored: false,
        mode: "residual",
      };

      try {
        const docRef = await adminDb.collection("classroom_cleanup_logs").add(logData);
        await writeAuditLog({
          operatorEmail: teacherEmail,
          action: "CLASSROOM_CLEANUP_RESIDUAL",
          targetEmail: courseId,
          details: `보관된 클래스룸 잔여 정돈 (${logData.originalName})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          logId: docRef.id,
          pipelineResults,
        });
      } catch (err: any) {
        console.error("Failed to save residual cleanup log:", err);
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
