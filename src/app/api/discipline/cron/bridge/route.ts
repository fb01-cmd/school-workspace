import { NextRequest, NextResponse } from "next/server";
import { runDisciplineSheetBridge } from "@/lib/discipline/bridge";

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Phase 6b 후속 — 기존 시트 실대체 전환 브리지 크론 API
 *
 * GET /api/discipline/cron/bridge
 * - Vercel Cron 또는 외부 스케줄러에서 매일 1회 호출.
 * - Authorization: Bearer ${CRON_SECRET} 인증 검증 (프로덕션 fail-closed).
 * - discipline_config.sheetBridgeEnabled 킬 스위치 (기본값 꺼짐) 미활성 시 no-op.
 * - 쿼리 파라미터 ?dryRun=true 지원 (미리보기/테스트).
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !CRON_SECRET) {
    console.error("[Discipline Bridge Cron] CRON_SECRET이 설정되지 않아 실행을 거부합니다.");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "true";

  try {
    const result = await runDisciplineSheetBridge({ dryRun });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Discipline Bridge Cron Error]:", error);
    return NextResponse.json(
      { error: `시트 브리지 크론 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
