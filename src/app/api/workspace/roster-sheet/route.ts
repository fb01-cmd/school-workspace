import { NextRequest, NextResponse } from "next/server";
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { updateMasterRosterSheet, extractSpreadsheetId } from "@/lib/google/sheets";
import { writeAuditLog } from "@/lib/firebase/audit-server";

/**
 * Phase 6a-2: 명렬표 마스터 시트 설정 및 수동 갱신 API
 * 
 * POST /api/workspace/roster-sheet
 * 
 * Actions:
 * - action: "get_settings" -> 현재 마스터 시트 ID 조회
 * - action: "save_sheet_id" -> 마스터 시트 ID 저장
 * - action: "update_now"   -> 마스터 시트 수동 갱신 실행 ("지금 갱신" 버튼)
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 수퍼어드민 권한 검증
    const authData = await verifyAuthAccess(req);
    if (!authData || authData.role !== "super_admin") {
      return NextResponse.json(
        { error: "권한이 없습니다. 수퍼어드민 계정만 접근할 수 있습니다." },
        { status: 403 }
      );
    }

    const domain = authData.email.split("@")[1];
    if (!domain) {
      return NextResponse.json(
        { error: "올바른 관리자 도메인 정보를 확인할 수 없습니다." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { action } = body;

    // 2. 마스터 시트 설정 조회
    if (action === "get_settings") {
      const settingsSnap = await adminDb.collection("settings").doc(domain).get();
      const data = settingsSnap.exists ? settingsSnap.data() : {};
      return NextResponse.json({
        masterSheetId: data?.masterSheetId || data?.rosterMasterSheetId || "",
      });
    }

    // 3. 마스터 시트 ID 저장
    if (action === "save_sheet_id") {
      const rawInput = body.masterSheetId || "";
      const cleanId = extractSpreadsheetId(rawInput);

      await adminDb.collection("settings").doc(domain).set(
        {
          masterSheetId: cleanId,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      // 감사 로그 기록
      await writeAuditLog({
        operatorEmail: authData.email,
        operatorName: "관리자",
        action: "UPDATE_MASTER_ROSTER_SHEET_ID",
        targetEmail: domain,
        details: `명렬표 마스터 시트 ID 변경: ${cleanId || "(미설정)"}`,
        status: "success",
      });

      return NextResponse.json({
        success: true,
        masterSheetId: cleanId,
      });
    }

    // 4. 수동 갱신 실행 ("지금 갱신" 버튼)
    if (action === "update_now") {
      const result = await updateMasterRosterSheet(domain);

      if (result.success) {
        // 감사 로그 기록 (수동 갱신 성공)
        await writeAuditLog({
          operatorEmail: authData.email,
          operatorName: "관리자",
          action: "SYNC_MASTER_ROSTER_SHEET",
          targetEmail: domain,
          details: `명렬표 마스터 시트 수동 갱신 완료 (총 ${result.totalStudentsCount || 0}명)`,
          status: "success",
        });

        return NextResponse.json({
          ...result,
        });
      } else {
        // 감사 로그 기록 (수동 갱신 실패)
        await writeAuditLog({
          operatorEmail: authData.email,
          operatorName: "관리자",
          action: "SYNC_MASTER_ROSTER_SHEET",
          targetEmail: domain,
          details: `명렬표 마스터 시트 수동 갱신 실패: ${result.error}`,
          status: "failure",
          error: result.error,
        });

        return NextResponse.json(
          {
            success: false,
            error: result.error,
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "지원하지 않는 action 입니다." },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[Roster Sheet Route Error]:", error);
    return NextResponse.json(
      { error: `명렬표 시트 관리 처리 중 오류 발생: ${error.message}` },
      { status: 500 }
    );
  }
}
