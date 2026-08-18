/**
 * 절약 모드 검증 (docs/saving_mode_spec.md §7)
 *
 * 1부 — 순수 판정: 손잡이 값·24시간 자동 해제 경계·배너 문구
 * 2부 — 실계정 사이클: 켜기 → 상태 확인 → 시간 경과 판정 → 크론 정리 → 원복 (흔적 0)
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_saving_mode.ts
 */
import {
  KNOBS_NORMAL,
  KNOBS_SAVING,
  SAVING_AUTO_OFF_MS,
  SAVING_MODE_OFF,
  SavingModeState,
  buildSavingBannerText,
  resolveSavingMode,
} from "../src/lib/ops/saving_logic";
import { MEMO_SEARCH_RANGE_DAYS, rangeFromDays } from "../src/lib/memo/search_logic";
import { createMemoStore } from "../src/lib/timetable/memoCache";
import {
  clearKnobCache,
  getKnobsCached,
  getSavingMode,
  readSavingModeState,
  savingModeRef,
  setSavingMode,
  sweepSavingMode,
} from "../src/lib/ops/saving_mode";

let failed = 0;
function expect(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const T0 = Date.parse("2026-08-18T12:00:00Z");
const ON = (at = T0): SavingModeState => ({ on: true, turnedOnAt: at, turnedOnBy: "fb01@hmh.or.kr" });

async function main() {
  console.log("\n=== 1부. 순수 판정 ===\n");

  console.log("[손잡이 값]");
  {
    const off = resolveSavingMode(SAVING_MODE_OFF, T0);
    expect("꺼져 있으면 평시 값", !off.active && off.knobs === KNOBS_NORMAL);
    const on = resolveSavingMode(ON(), T0 + 1000);
    expect("켜져 있으면 절약 값", on.active && on.knobs === KNOBS_SAVING);
  }
  expect("절약 시 클라 캐시가 더 길다", KNOBS_SAVING.clientCacheTtlMs > KNOBS_NORMAL.clientCacheTtlMs);
  expect("절약 시 시간표 캐시가 더 길다", KNOBS_SAVING.timetableCacheTtlMs > KNOBS_NORMAL.timetableCacheTtlMs);
  expect("절약 시 검색 기본 기간이 더 짧다", KNOBS_SAVING.memoSearchDefaultDays < KNOBS_NORMAL.memoSearchDefaultDays);
  expect("평시 검색 기본 = 현행 3개월(90일)", KNOBS_NORMAL.memoSearchDefaultDays === 90);

  console.log("\n[24시간 자동 해제]");
  {
    const almost = resolveSavingMode(ON(), T0 + SAVING_AUTO_OFF_MS - 1000);
    expect("23시간 59분엔 아직 켜짐", almost.active && !almost.staleOn);
    const exact = resolveSavingMode(ON(), T0 + SAVING_AUTO_OFF_MS);
    expect("정확히 24시간이면 꺼짐", !exact.active);
    expect("꺼진 뒤 손잡이는 평시", exact.knobs === KNOBS_NORMAL);
    expect("저장값은 켜짐이므로 정리 대상 표시", exact.staleOn);
    const after = resolveSavingMode(ON(), T0 + SAVING_AUTO_OFF_MS + 86400_000);
    expect("한참 지나도 평시 유지", !after.active && after.staleOn);
  }
  {
    const r = resolveSavingMode(ON(), T0 + 3600_000);
    expect("남은 시간이 23시간", r.remainingMs === 23 * 3600_000, String(r.remainingMs));
    expect("해제 예정 시각 = 켠 시각 + 24시간", r.expiresAt === T0 + SAVING_AUTO_OFF_MS);
  }
  {
    // 크론이 늦어도 사용자는 제때 평시로 — 읽는 쪽이 시간으로 판정한다는 설계의 핵심
    expect(
      "문서가 켜진 채 남아 있어도 24시간 뒤엔 적용되지 않음",
      resolveSavingMode(ON(), T0 + 30 * 3600_000).knobs === KNOBS_NORMAL
    );
  }
  {
    expect("깨진 상태(null)는 평시로 안전 처리", resolveSavingMode(null, T0).knobs === KNOBS_NORMAL);
    expect(
      "turnedOnAt 없는 문서도 평시로",
      resolveSavingMode({ on: true } as any, T0).knobs === KNOBS_NORMAL
    );
  }

  console.log("\n[배너 문구 — 개발 용어 금지]");
  {
    const text = buildSavingBannerText(resolveSavingMode(ON(), T0 + 3600_000))!;
    console.log(`     ${text}`);
    expect("남은 시간 표기", text.includes("23시간"));
    expect("자동 복귀를 알림", text.includes("자동"));
    const jargon = ["캐시", "TTL", "쿼터", "Firestore", "quota", "API"];
    expect("기술 용어 미포함", !jargon.some((w) => text.includes(w)), text);
    expect("꺼져 있으면 배너 없음", buildSavingBannerText(resolveSavingMode(SAVING_MODE_OFF, T0)) === null);
  }

  console.log("\n[결선 — 손잡이가 실제로 움직이는가 (순서 3)]");
  {
    // 시간표 후보 캐시: createMemoStore가 수명을 **매 조회 시** 평가해야 절약 모드가 먹는다
    let ttl = KNOBS_NORMAL.timetableCacheTtlMs;
    let calls = 0;
    const store = createMemoStore({ ttlMs: () => ttl, maxEntries: 8 });
    await store.memo("k", async () => ++calls);
    await store.memo("k", async () => ++calls);
    expect("평시: 두 번째 조회는 캐시 적중", calls === 1);
    ttl = 0; // 수명 0 = 즉시 만료 (동적 평가가 안 되면 계속 적중한다)
    await store.memo("k", async () => ++calls);
    expect("수명이 실행 중에 바뀌면 즉시 반영(동적 평가)", calls === 2, `calls=${calls}`);
  }
  {
    const range = rangeFromDays(KNOBS_SAVING.memoSearchDefaultDays);
    expect("절약 손잡이(30일)가 실재하는 범위로 매핑", range === "1m", range);
    expect("그 범위의 일수가 손잡이와 일치", MEMO_SEARCH_RANGE_DAYS[range] === KNOBS_SAVING.memoSearchDefaultDays);
    const normal = rangeFromDays(KNOBS_NORMAL.memoSearchDefaultDays);
    expect("평시 손잡이(90일)는 3개월", normal === "3m", normal);
    expect("중간값은 넘지 않는 가장 넓은 범위로", rangeFromDays(120) === "3m", rangeFromDays(120));
  }

  console.log("\n=== 2부. 실계정 사이클 ===\n");
  const before = await readSavingModeState();
  console.log(`  (시작 상태: on=${before.on})`);
  try {
    const { resolved } = await setSavingMode(true, "verify-script@hmh.or.kr");
    expect("켜기 성공", resolved.active);

    const readBack = await getSavingMode();
    expect("서버가 켜진 상태로 읽음", readBack.active && readBack.knobs === KNOBS_SAVING);
    expect("켠 사람이 기록됨", readBack.turnedOnBy === "verify-script@hmh.or.kr", readBack.turnedOnBy);

    // 24시간 지난 것처럼 백데이트 → 크론 정리 대상이 되어야 한다
    const stale = Date.now() - SAVING_AUTO_OFF_MS - 1000;
    await savingModeRef().set({ on: true, turnedOnAt: stale, turnedOnBy: "verify-script@hmh.or.kr" });
    const staleRead = await getSavingMode();
    expect("백데이트분은 이미 적용 안 됨(크론 전인데도)", !staleRead.active);

    const sweep = await sweepSavingMode();
    expect("크론이 문서를 끔", sweep.turnedOff === 1 && !sweep.active);
    expect("정리 후 문서가 꺼짐", (await readSavingModeState()).on === false);

    const sweep2 = await sweepSavingMode();
    expect("이미 꺼진 상태에서 크론은 no-op", sweep2.turnedOff === 0);

    await setSavingMode(false, "verify-script@hmh.or.kr");
    expect("끄기 후 평시 값", (await getSavingMode()).knobs === KNOBS_NORMAL);

    // 서버 동기 접근자 — 캐시 프라임과 안전 기본값
    clearKnobCache();
    expect("캐시가 비면 평시 값을 준다(모르면 평시)", getKnobsCached() === KNOBS_NORMAL);
    await setSavingMode(true, "verify-script@hmh.or.kr");
    expect("켠 직후 동기 접근자가 즉시 절약 값(5분 대기 없음)", getKnobsCached() === KNOBS_SAVING);
    await setSavingMode(false, "verify-script@hmh.or.kr");
    expect("끈 직후 동기 접근자가 즉시 평시 값", getKnobsCached() === KNOBS_NORMAL);
  } finally {
    // 흔적 0 — 시작 상태로 되돌린다
    if (before.on) await savingModeRef().set(before);
    else await savingModeRef().set({ ...SAVING_MODE_OFF });
    const after = await readSavingModeState();
    expect("정리 완료 — 시작 상태 복원", after.on === before.on);
  }

  console.log(`\n${failed === 0 ? "✅ 전판 통과" : `❌ 실패 ${failed}건`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
