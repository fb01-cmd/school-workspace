import { NextRequest, NextResponse } from "next/server";
import { runDisciplineSheetBridge } from "@/lib/discipline/bridge";
import { runNeisCalendarSync } from "@/lib/timetable/server";
import { runMemoPurge } from "@/lib/memo/purge";
import { runUsageAlert } from "@/lib/ops/usage_alert";
import { sweepSavingMode } from "@/lib/ops/saving_mode";
import { recordCronRun } from "@/lib/ops/cron_heartbeat";
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
 * - ?dryRun=true 는 브리지·쪽지 파기에 전달된다(나이스 동기화는 dryRun 미지원 — upsert 멱등).
 * - 개별 수동 실행은 기존 경로가 그대로 담당한다:
 *   /api/discipline/cron/bridge, /api/timetable/cron/neis-calendar (스케줄만 여기로 이동).
 * - 쪽지 파기(2026-08-18 합류, memo_spec §6·attachment spec §6): 같은 "하루 1회" 성격이라
 *   세 번째 크론을 만들지 않고 여기 통합 — GitHub Actions 대안은 스케줄러 이원화라 기각.
 * - 사용량 조기 경보(2026-08-18 합류, roadmap §2): 전일(태평양) Firestore 사용량을 읽어
 *   무료 한도 50%·80% 초과 시 최고 관리자에게 알림. 지표 읽기 권한이 없으면 no-op이라
 *   현재는 아무 일도 하지 않는다(권한 부여 시 재배포 없이 켜진다 — usage_alert.ts 주석).
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
    memoPurge: { ok: boolean; detail: unknown };
    usageAlert: { ok: boolean; detail: unknown };
    savingSweep: { ok: boolean; detail: unknown };
  } = {
    bridge: { ok: false, detail: null },
    neis: { ok: false, detail: null },
    memoPurge: { ok: false, detail: null },
    usageAlert: { ok: false, detail: null },
    savingSweep: { ok: false, detail: null },
  };

  /** 알림 발신 도메인 — 나이스·사용량 경보가 공유한다 (없으면 학교 기본값) */
  let targetDomain = "hmh.or.kr";
  try {
    const settingsSnap = await adminDb.collection("timetable_settings").get();
    targetDomain = settingsSnap.docs.map((d) => d.id)[0] || targetDomain;
  } catch {
    // 설정 조회 실패는 치명적이지 않다 — 기본 도메인으로 진행
  }

  // ── 1. 생활지도 시트 브리지 ──
  try {
    results.bridge = { ok: true, detail: await runDisciplineSheetBridge({ dryRun }) };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 시트 브리지 실패:", error);
    results.bridge = { ok: false, detail: error.message };
  }

  // ── 2. 나이스 학사일정 동기화 (브리지 실패와 무관하게 실행) ──
  try {
    results.neis = { ok: true, detail: await runNeisCalendarSync(targetDomain) };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 나이스 학사일정 동기화 실패:", error);
    results.neis = { ok: false, detail: error.message };
  }

  // ── 3. 쪽지 파기 — 보존 만료 쪽지·첨부 Drive 파일·staging 고아·빈 월 폴더 (앞 작업 실패와 무관하게 실행) ──
  try {
    const domainRefs = await adminDb.collection("memos").listDocuments();
    const domains = domainRefs.map((r) => r.id);
    results.memoPurge = { ok: true, detail: await runMemoPurge(domains, { dryRun }) };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 쪽지 파기 실패:", error);
    results.memoPurge = { ok: false, detail: error.message };
  }

  // ── 4. Firestore 사용량 조기 경보 (앞 작업 실패와 무관하게 실행) ──
  // 지표 읽기 권한이 없으면 available:false로 조용히 지나간다 — 가짜 경보를 내지 않는다.
  try {
    results.usageAlert = { ok: true, detail: await runUsageAlert(targetDomain, { dryRun }) };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 사용량 경보 실패:", error);
    results.usageAlert = { ok: false, detail: error.message };
  }

  // ── 5. 절약 모드 자동 해제 (24시간 경과분 문서 정리) ──
  // 적용 자체는 읽는 쪽이 시간으로 판정하므로, 이 크론이 늦어도 사용자는 제때 평시로
  // 돌아간다 — 여기서는 문서만 정리한다(saving_mode.ts sweepSavingMode 주석).
  try {
    results.savingSweep = { ok: true, detail: dryRun ? { skipped: "dryRun" } : await sweepSavingMode() };
  } catch (error: any) {
    console.error("[Daily-Sync Cron] 절약 모드 정리 실패:", error);
    results.savingSweep = { ok: false, detail: error.message };
  }

  const anyFailed =
    !results.bridge.ok ||
    !results.neis.ok ||
    !results.memoPurge.ok ||
    !results.usageAlert.ok ||
    !results.savingSweep.ok;
  // 심박 — 성공·실패·무작업을 가리지 않고 남긴다(cron_heartbeat.ts 주석의 사고 2건)
  await recordCronRun("daily-sync", {
    summary: `브리지 ${results.bridge.ok ? "ok" : "실패"} · 나이스 ${results.neis.ok ? "ok" : "실패"} · 쪽지파기 ${results.memoPurge.ok ? "ok" : "실패"} · 사용량경보 ${results.usageAlert.ok ? "ok" : "실패"} · 절약정리 ${results.savingSweep.ok ? "ok" : "실패"}`,
    hadError: anyFailed,
  });

  return NextResponse.json(
    { ...results, processedAt: new Date().toISOString() },
    { status: anyFailed ? 500 : 200 }
  );
}
