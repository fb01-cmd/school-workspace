import { NextRequest, NextResponse } from "next/server";
import { runDisciplineSheetBridge } from "@/lib/discipline/bridge";
import { runNeisCalendarSync } from "@/lib/timetable/server";
import { adminDb } from "@/lib/firebase/admin";

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * 일일 수집 통합 크론 — 생활지도 시트 브리지 + 나이스 학사일정 동기화.
 *
 * 왜 하나로 묶였나 (2026-08-13): Vercel Hobby의 크론 한도는 **2개**다. 이 한도는
 * 브리지 스펙에 "기존 1개+신규 1개=한도 2개 정확히 소진"으로 적혀 있었는데, 그 뒤
 * 나이스 수집기가 세 번째 크론으로 들어가면서 초과됐다 — 감사 로그 실측으로
 * 브리지가 8/11을 마지막으로 조용히 멈춰 있었다(크론은 실패해도 화면에 아무
 * 표시가 없다). 그래서 하루 1회 수집 성격이 같은 두 작업을 이 엔드포인트로 합쳐
 * 전체 크론을 2개(lifecycle + 이것)로 되돌렸다.
 *
 * 실행 규약:
 * - 두 작업은 **서로 독립** — 한쪽이 던져도 다른 쪽은 반드시 실행된다.
 * - 브리지는 킬 스위치(discipline_config.sheetBridgeEnabled)를 자체 확인하므로
 *   일몰(9/10) 후 스위치를 끄면 이 크론은 자연히 나이스 전용이 된다.
 * - ?dryRun=true 는 브리지에만 전달된다(나이스 동기화는 dryRun 미지원 — upsert 멱등).
 * - 개별 수동 실행은 기존 경로가 그대로 담당한다:
 *   /api/discipline/cron/bridge, /api/timetable/cron/neis-calendar (스케줄만 여기로 이동).
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !CRON_SECRET) {
    console.error("[Daily-Sync Cron] CRON_SECRET이 설정되지 않아 실행을 거부합니다.");
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

  const results: {
    bridge: { ok: boolean; detail: unknown };
    neis: { ok: boolean; detail: unknown };
  } = {
    bridge: { ok: false, detail: null },
    neis: { ok: false, detail: null },
  };

  // ── 1. 생활지도 시트 브리지 ──
  try {
    results.bridge = { ok: true, detail: await runDisciplineSheetBridge({ dryRun }) };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 시트 브리지 실패:", error);
    results.bridge = { ok: false, detail: error.message };
  }

  // ── 2. 나이스 학사일정 동기화 (브리지 실패와 무관하게 실행) ──
  try {
    const settingsSnap = await adminDb.collection("timetable_settings").get();
    const targetDomain = settingsSnap.docs.map((d) => d.id)[0] || "hmh.or.kr";
    results.neis = { ok: true, detail: await runNeisCalendarSync(targetDomain) };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 나이스 학사일정 동기화 실패:", error);
    results.neis = { ok: false, detail: error.message };
  }

  const anyFailed = !results.bridge.ok || !results.neis.ok;
  return NextResponse.json(
    { ...results, processedAt: new Date().toISOString() },
    { status: anyFailed ? 500 : 200 }
  );
}
