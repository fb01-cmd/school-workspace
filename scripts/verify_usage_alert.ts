/**
 * Firestore 사용량 조기 경보 검증 (roadmap §2 「Firestore 사용량 조기 경보」)
 *
 * 1부 — 순수 판정 로직 (네트워크 없음): 임계 계산·발송 규칙·문구·태평양 날짜 경계
 * 2부 — 실계정 프로브: 지표를 실제로 읽을 수 있는지, 읽힌다면 어제 사용량은 얼마인지
 * 3부 — dryRun 전체 실행: 발송 없이 판정만 (상태 문서 무변경)
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_usage_alert.ts
 */
import {
  AlertState,
  DailyUsage,
  EMPTY_ALERT_STATE,
  REPEAT_REMINDER_MS,
  buildAlertText,
  computeLevel,
  decideEmit,
  lastCompletePacificDay,
} from "../src/lib/ops/usage_logic";
import { fetchDailyUsage, runUsageAlert } from "../src/lib/ops/usage_alert";

let failed = 0;
function expect(name: string, cond: boolean, extra?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const usage = (reads: number, writes = 0, deletes = 0, day = "2026-08-17"): DailyUsage => ({
  day,
  reads,
  writes,
  deletes,
});

async function main() {
  console.log("\n=== 1부. 순수 판정 로직 ===\n");

  console.log("[임계 계산 — 세 지표 중 최대치로 판정]");
  expect("한도의 40%는 조용함", computeLevel(usage(20_000)).level === 0);
  expect("읽기 50% 정확히 = 50단계", computeLevel(usage(25_000)).level === 50);
  expect("읽기 79.9%는 아직 50단계", computeLevel(usage(39_950)).level === 50);
  expect("읽기 80% 정확히 = 80단계", computeLevel(usage(40_000)).level === 80);
  expect("한도 초과(120%)도 80단계", computeLevel(usage(60_000)).level === 80);
  {
    // 읽기는 조용한데 쓰기가 많은 경우 — 읽기만 보면 놓치는 지점
    const { level, top } = computeLevel(usage(1_000, 17_000));
    expect("쓰기만 85%여도 경보 (읽기 편향 방지)", level === 80 && top.metric === "writes");
  }
  {
    const { top } = computeLevel(usage(30_000, 12_000));
    expect("가장 많이 쓴 지표를 근거로 지목", top.metric === "reads" && Math.round(top.percent) === 60);
  }

  console.log("\n[발송 규칙]");
  const T0 = Date.parse("2026-08-18T18:00:00Z");
  const fresh: AlertState = { ...EMPTY_ALERT_STATE };
  {
    const d = decideEmit(0, fresh, T0, "2026-08-17");
    expect("조용하면 발송 없음", !d.emit && d.nextState.lastLevel === 0);
  }
  {
    const d = decideEmit(50, fresh, T0, "2026-08-17");
    expect("0 → 50 상승 시 발송", d.emit && d.nextState.lastLevel === 50);
  }
  const at50: AlertState = { lastLevel: 50, lastEmittedAt: T0, lastDay: "2026-08-17" };
  {
    const d = decideEmit(50, at50, T0 + 86400_000, "2026-08-18");
    expect("같은 50 유지 — 이튿날 재발송 안 함(잔소리 방지)", !d.emit);
  }
  {
    const d = decideEmit(80, at50, T0 + 86400_000, "2026-08-18");
    expect("50 → 80 상승 시 발송", d.emit && d.nextState.lastLevel === 80);
  }
  {
    const d = decideEmit(50, at50, T0 + REPEAT_REMINDER_MS, "2026-08-24");
    expect("7일 유지되면 주간 재알림 1회", d.emit);
  }
  {
    const d = decideEmit(50, at50, T0 + REPEAT_REMINDER_MS - 1000, "2026-08-24");
    expect("7일 직전에는 아직 침묵", !d.emit);
  }
  {
    const d = decideEmit(0, at50, T0 + 86400_000, "2026-08-18");
    expect("50% 아래로 회복하면 상태 초기화", !d.emit && d.nextState.lastLevel === 0);
  }
  {
    // 초기화 후 다시 오르면 알려야 한다 (회복→재상승 경로가 조용해지면 경보 의미 없음)
    const recovered: AlertState = { lastLevel: 0, lastEmittedAt: T0, lastDay: "2026-08-18" };
    const d = decideEmit(50, recovered, T0 + 2 * 86400_000, "2026-08-19");
    expect("회복 뒤 재상승하면 다시 발송", d.emit);
  }
  {
    const d = decideEmit(80, at50, T0, "2026-08-17");
    expect("같은 날 재실행은 발송 안 함 (크론 중복 실행 방어)", !d.emit);
  }

  console.log("\n[알림 문구 — 개발 용어 금지]");
  {
    const { top } = computeLevel(usage(28_400));
    const { title, message } = buildAlertText(50, top, "2026-08-17");
    console.log(`     제목: ${title}`);
    console.log(`     본문: ${message}`);
    const joined = title + message;
    const jargon = ["Firestore", "쿼터", "quota", "API", "read", "쓰기 작업", "onSnapshot"];
    expect("기술 용어 미포함", !jargon.some((w) => joined.includes(w)), joined);
    expect("본문 200자 이내", message.length <= 200);
    expect("사용량·한도·비율이 문구에 있음", /28,400/.test(message) && /50,000/.test(message) && /57%/.test(message));
  }
  {
    const { top } = computeLevel(usage(41_200));
    const { title, message } = buildAlertText(80, top, "2026-08-17");
    console.log(`     제목: ${title}`);
    console.log(`     본문: ${message}`);
    expect("80단계는 요금 발생 가능성을 알림", message.includes("요금"));
  }

  console.log("\n[태평양 날짜 경계 — 무료 한도는 태평양 자정에 초기화된다]");
  {
    // KST 2026-08-19 03:00 (크론 시각) = UTC 08-18 18:00 = 태평양 08-18 11:00(PDT)
    // → 마지막 완결일은 08-17
    const w = lastCompletePacificDay(new Date("2026-08-18T18:00:00Z"));
    expect("KST 03시 크론의 대상일 = 태평양 전날", w.day === "2026-08-17", w.day);
    expect("구간 길이 24시간", w.endMs - w.startMs === 24 * 3600 * 1000);
    expect("구간 끝이 대상일 다음 자정", new Date(w.endMs).toISOString() === "2026-08-18T07:00:00.000Z", new Date(w.endMs).toISOString());
  }
  {
    // 서머타임 종료(2026-11-01 02:00 PDT→PST) 직후 — 그날은 25시간짜리 날이다
    const w = lastCompletePacificDay(new Date("2026-11-02T18:00:00Z"));
    expect("서머타임 전환일도 날짜 계산 정상", w.day === "2026-11-01", w.day);
    expect("전환일 구간은 25시간", w.endMs - w.startMs === 25 * 3600 * 1000, String((w.endMs - w.startMs) / 3600000));
  }
  {
    // 태평양 자정 직후에 실행돼도 전날이 완결일로 잡혀야 한다
    const w = lastCompletePacificDay(new Date("2026-08-18T07:00:30Z")); // 태평양 08-18 00:00:30
    expect("태평양 자정 직후 실행도 안전", w.day === "2026-08-17", w.day);
  }

  console.log("\n=== 2부. 실계정 프로브 — 지표를 읽을 수 있는가 ===\n");
  const probe = await fetchDailyUsage();
  if (probe.available && probe.usage) {
    const u = probe.usage;
    const { level, top } = computeLevel(u);
    console.log(`  ✅ 지표 읽기 성공 (${u.day})`);
    console.log(`     조회 ${u.reads.toLocaleString()} / 저장 ${u.writes.toLocaleString()} / 삭제 ${u.deletes.toLocaleString()}`);
    console.log(`     최대 지표 = ${top.metric} ${Math.round(top.percent)}% → 단계 ${level}`);
  } else {
    console.log(`  ⚠️  지표 읽기 불가 — reason=${probe.reason}`);
    if (probe.detail) console.log(`     ${probe.detail}`);
    console.log("     (설계상 정상 동작: 권한이 없으면 경보는 조용히 no-op이며 가짜 경보를 내지 않는다.)");
    console.log("     권한 부여 후 이 스크립트를 다시 돌리면 여기서 실제 사용량이 찍힌다.");
  }

  console.log("\n=== 3부. dryRun 전체 실행 (발송·상태 변경 없음) ===\n");
  const summary = await runUsageAlert("hmh.or.kr", { dryRun: true });
  console.log("  " + JSON.stringify(summary, null, 2).split("\n").join("\n  "));
  expect("dryRun은 실제 발송 0", summary.dryRun === true);
  expect(
    "권한 없으면 available=false (사용량 0으로 오인하지 않음)",
    probe.available ? summary.available === true : summary.available === false
  );

  console.log(`\n${failed === 0 ? "✅ 전판 통과" : `❌ 실패 ${failed}건`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
