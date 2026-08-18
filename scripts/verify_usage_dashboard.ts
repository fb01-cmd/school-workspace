/**
 * 사용량 보기 검증 (docs/usage_dashboard_spec.md §5)
 *
 * 1부 — 구간 경계 순수 검증(서머타임 포함). **여기서 틀리면 화면 숫자가 통째로 틀린다.**
 * 2부 — 실계정 스냅샷: 세 구간이 실제로 채워지는지, 값이 서로 정합한지
 * 3부 — 교차 대조: 일별 시리즈의 어제 값 == 일일 경보가 보는 값 (자료원 일치 증명)
 * 4부 — 캐시 동작
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_usage_dashboard.ts
 */
import {
  currentPacificDayStart,
  lastCompletePacificDay,
  pacificDayLabel,
  pacificDayStartDaysAgo,
} from "../src/lib/ops/usage_logic";
import { clearUsageCache, getUsageSnapshot } from "../src/lib/ops/usage_query";
import { fetchTotal } from "../src/lib/ops/monitoring";
import { fetchDailyUsage } from "../src/lib/ops/usage_alert";

let failed = 0;
function expect(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const H = 3_600_000;

async function main() {
  console.log("\n=== 1부. 구간 경계 (틀리면 화면 전체가 틀린다) ===\n");
  {
    const now = new Date("2026-08-18T18:00:00Z"); // 태평양 08-18 11:00 (PDT)
    const todayStart = currentPacificDayStart(now);
    expect("오늘 시작 = 태평양 자정", new Date(todayStart).toISOString() === "2026-08-18T07:00:00.000Z", new Date(todayStart).toISOString());
    expect("오늘 라벨", pacificDayLabel(todayStart) === "2026-08-18", pacificDayLabel(todayStart));
    expect("어제 완결 구간의 끝 == 오늘 시작", lastCompletePacificDay(now).endMs === todayStart);
  }
  {
    // 30일 전 경계도 자정이어야 한다 (버킷 정렬의 전제)
    const now = new Date("2026-08-18T18:00:00Z");
    const start = pacificDayStartDaysAgo(now, 30);
    expect("30일 전도 태평양 자정", new Date(start).toISOString() === "2026-07-19T07:00:00.000Z", new Date(start).toISOString());
    expect("30일 전 라벨", pacificDayLabel(start) === "2026-07-19", pacificDayLabel(start));
  }
  {
    // ⚠️ 서머타임 종료(2026-11-01)를 건너뛰는 구간 — 고정 86400초 산술이 깨지는 자리
    const now = new Date("2026-11-10T20:00:00Z"); // 태평양 11-10 12:00 (PST)
    const start = pacificDayStartDaysAgo(now, 30);
    expect("서머타임 건너뛴 30일 전도 자정", new Date(start).toISOString() === "2026-10-11T07:00:00.000Z", new Date(start).toISOString());
    const naive = currentPacificDayStart(now) - 30 * 24 * H;
    expect(
      "고정 86400초 산술이었다면 1시간 어긋났음을 확인(회귀 감시)",
      naive !== start && Math.abs(naive - start) === H,
      `차이 ${(start - naive) / H}시간`
    );
  }

  console.log("\n=== 2부. 실계정 스냅샷 ===\n");
  clearUsageCache();
  const now = new Date();
  const snap = await getUsageSnapshot({ days: 30 });
  if (!snap.available) {
    console.log(`  ⚠️  지표 읽기 불가 — reason=${snap.reason}`);
    console.log(`     ${snap.detail || ""}`);
    console.log("     (설계상 정상: 화면은 0이 아니라 안내 카드를 그린다.)");
    expect("권한 없을 때 today·daily를 0으로 채우지 않음", !snap.today && !snap.daily);
    console.log(`\n${failed === 0 ? "✅ 통과(권한 대기)" : `❌ 실패 ${failed}건`}\n`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const t = snap.today!;
  console.log(`  오늘(${t.day}, 진행 중): 조회 ${t.reads.toLocaleString()} / 저장 ${t.writes.toLocaleString()} / 삭제 ${t.deletes.toLocaleString()}`);
  console.log(`     최대 지표 ${t.topMetric} ${Math.round(t.topPercent)}% → 단계 ${t.level}`);
  console.log(`  일별 ${snap.daily!.length}일 · 시간별 ${snap.hourly!.length}시간`);

  expect("한도 상수 동봉(화면이 자체 정의하지 않도록)", !!snap.limits && snap.limits.reads === 50000);
  expect("일별 구간이 요청한 30일 이하", snap.daily!.length <= 30);
  expect("일별 라벨이 날짜 형식", snap.daily!.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.label)));
  expect("일별에 진행 중인 오늘이 섞이지 않음", !snap.daily!.some((p) => p.label === t.day), t.day);
  expect("일별이 시간순 정렬", snap.daily!.every((p, i, a) => i === 0 || a[i - 1].label <= p.label));
  expect("시간별 라벨이 00~23", snap.hourly!.every((p) => /^\d{2}$/.test(p.label) && Number(p.label) < 24));
  expect("시간별 합계 ≤ 오늘 누계 (완결 시간만 담으므로)", snap.hourly!.reduce((a, p) => a + p.reads, 0) <= t.reads);
  expect("음수 없음", [...snap.daily!, ...snap.hourly!].every((p) => p.reads >= 0 && p.writes >= 0 && p.deletes >= 0));
  expect("생성 시각이 현재", Math.abs(Date.now() - snap.generatedAt) < 120_000);

  {
    // 회귀 감시 — 진행 중인 하루의 합계가 물을 때마다 달라지면 안 된다.
    // 구간 길이를 그대로 alignmentPeriod로 주던 시절 13,577 ↔ 47,477로 튀었고,
    // 화면의 "오늘 사용량"이 경고와 정상을 오갔다(2026-08-18 사용자 신고).
    const t0 = currentPacificDayStart(now);
    const a = await fetchTotal("reads", t0, Date.now());
    const b = await fetchTotal("reads", t0, Date.now());
    expect("진행 중 하루 합계가 연속 호출에 안정", Math.abs(a - b) <= 50, `${a} vs ${b}`);
  }

  console.log("\n=== 3부. 교차 대조 — 화면과 경보가 같은 숫자를 보는가 ===\n");
  const alert = await fetchDailyUsage();
  if (alert.available && alert.usage) {
    const row = snap.daily!.find((p) => p.label === alert.usage!.day);
    console.log(`  경보(${alert.usage.day}) 조회 ${alert.usage.reads.toLocaleString()} / 화면 일별 ${row ? row.reads.toLocaleString() : "없음"}`);
    expect("어제 값이 경보와 일치 (구간 정렬 증명)", !!row && row.reads === alert.usage.reads);
    expect("저장·삭제도 일치", !!row && row.writes === alert.usage.writes && row.deletes === alert.usage.deletes);
  } else {
    console.log("  ⚠️  경보 쪽 조회 불가 — 대조 생략");
  }

  console.log("\n=== 4부. 캐시 ===\n");
  const t0 = Date.now();
  const again = await getUsageSnapshot({ days: 30 });
  const elapsed = Date.now() - t0;
  expect("60초 내 재요청은 캐시 반환(동일 generatedAt)", again.generatedAt === snap.generatedAt);
  expect("캐시 응답은 즉시(<50ms)", elapsed < 50, `${elapsed}ms`);
  const forced = await getUsageSnapshot({ days: 30, force: true });
  expect("force는 캐시를 우회", forced.generatedAt !== snap.generatedAt);

  console.log(`\n${failed === 0 ? "✅ 전판 통과" : `❌ 실패 ${failed}건`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
