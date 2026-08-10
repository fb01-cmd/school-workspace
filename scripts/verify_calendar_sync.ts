import "./_force_notify_mock"; // 반드시 첫 import
// calendar_master_sync_spec §6 실측 — 프로덕션 실데이터, 종료 시 원상 복구
import {
  listWeeks,
  updateWeek,
  syncDerivedWeeksWithCalendar,
  timetableCalendarColRef,
} from "../src/lib/timetable/server";

const DOMAIN = "hmh.or.kr";
const TERM = "2026-2";
const TEST_WEEK = "2026-08-24";
const TEST_DATE = "2026-08-26"; // 수(day 3)
const OVERRIDE_DAY = 4; // 목

function fail(msg: string): never {
  console.error(`❌ 실패: ${msg}`);
  process.exit(1);
}

async function dump(label: string) {
  const ws = await listWeeks(DOMAIN, TERM);
  console.log(`--- ${label}`);
  for (const w of ws) {
    const dayStr = w.days
      .map((d) => `${d.day}${d.holiday ? "휴" : ""}${d.periodsByGrade ? `(${Object.values(d.periodsByGrade).join("/")})` : ""}`)
      .join(" ");
    console.log(`${w.id} days=[${dayStr}] overrides=${JSON.stringify(w.dayOverrides)} note=${w.note ?? "-"}`);
  }
  return ws;
}

async function run() {
  const baseline = await dump("0. 기준선");

  // 1. 첫 동기화 — 레거시 이행 기대
  const s1 = await syncDerivedWeeksWithCalendar(DOMAIN, TERM);
  console.log(`1. 첫 동기화(레거시 이행): updated=${s1.updatedCount} [${s1.updatedWeekIds.join(", ")}]`);
  const afterMig = await listWeeks(DOMAIN, TERM);
  for (const w of afterMig) {
    const base = baseline.find((b) => b.id === w.id)!;
    if (JSON.stringify(w.days.map((d) => [d.day, !!d.holiday, d.periodsByGrade || null])) !==
        JSON.stringify(base.days.map((d) => [d.day, !!d.holiday, d.periodsByGrade || null])))
      fail(`레거시 이행이 ${w.id}의 요일 값을 바꿈`);
    if (w.note !== base.note) fail(`레거시 이행이 ${w.id}의 note를 바꿈 (${base.note} → ${w.note})`);
    if (!Array.isArray(w.dayOverrides)) fail(`${w.id} dayOverrides 미기록`);
  }
  console.log("   ✓ 요일 값·note 불변, dayOverrides 기록됨");

  // 2. 두 번째 동기화 — 멱등성 (updated=0 이어야 함)
  const s2 = await syncDerivedWeeksWithCalendar(DOMAIN, TERM);
  console.log(`2. 재동기화 멱등성: updated=${s2.updatedCount}`);
  if (s2.updatedCount !== 0) fail(`무변경인데 ${s2.updatedCount}개 주가 다시 쓰임 (쓰기 생략 비교 결함)`);

  // 3. 학사일정 이벤트 추가 → 반영
  const evRef = await timetableCalendarColRef(DOMAIN).add({
    termId: TERM, type: "단축수업", startDate: TEST_DATE, endDate: TEST_DATE,
    periodsByGrade: { "1": 4, "2": 4, "3": 4 }, note: "동기화 검증 임시", createdBy: "claude-verify", createdAt: Date.now(),
  });
  const s3 = await syncDerivedWeeksWithCalendar(DOMAIN, TERM);
  let w = (await listWeeks(DOMAIN, TERM)).find((x) => x.id === TEST_WEEK)!;
  const wed = w.days.find((d) => d.day === 3)!;
  if (JSON.stringify(wed.periodsByGrade) !== JSON.stringify({ "1": 4, "2": 4, "3": 4 }))
    fail(`이벤트 추가가 수요일에 미반영: ${JSON.stringify(wed)}`);
  if ((w.dayOverrides || []).includes(3)) fail("파생 반영된 수요일이 오버라이드로 오기록");
  console.log(`3. 이벤트 추가 반영: updated=${s3.updatedCount}, ${TEST_WEEK} 수=4교시 ✓`);

  // 4. 수동 오버라이드 (목 5교시) → dayOverrides 기록
  await updateWeek(DOMAIN, TEST_WEEK, {
    days: w.days.map((d) => d.day === OVERRIDE_DAY ? { day: d.day, periodsByGrade: { "1": 5, "2": 5, "3": 5 } } : { day: d.day, holiday: d.holiday, periodsByGrade: d.periodsByGrade }),
  }, "claude-verify");
  w = (await listWeeks(DOMAIN, TERM)).find((x) => x.id === TEST_WEEK)!;
  if (JSON.stringify(w.dayOverrides) !== JSON.stringify([OVERRIDE_DAY]))
    fail(`오버라이드 판정 오류: ${JSON.stringify(w.dayOverrides)} (기대 [${OVERRIDE_DAY}])`);
  console.log(`4. 수동 조정: 목=5교시 → overrides=[${OVERRIDE_DAY}] ✓`);

  // 5. 이벤트 삭제 → 수요일 원복 + 목요일 오버라이드 보존
  await evRef.delete();
  const s5 = await syncDerivedWeeksWithCalendar(DOMAIN, TERM);
  w = (await listWeeks(DOMAIN, TERM)).find((x) => x.id === TEST_WEEK)!;
  const wed2 = w.days.find((d) => d.day === 3)!;
  const thu2 = w.days.find((d) => d.day === OVERRIDE_DAY)!;
  if (wed2.periodsByGrade) fail(`이벤트 삭제 후 수요일 미원복: ${JSON.stringify(wed2)}`);
  if (JSON.stringify(thu2.periodsByGrade) !== JSON.stringify({ "1": 5, "2": 5, "3": 5 }))
    fail(`오버라이드 요일이 동기화에 덮임: ${JSON.stringify(thu2)}`);
  console.log(`5. 이벤트 삭제: updated=${s5.updatedCount}, 수 원복 ✓ 목 오버라이드 보존 ✓`);

  // 6. 원상 복구 — 목요일을 파생값(평일)으로 되돌려 자가 치유 확인
  await updateWeek(DOMAIN, TEST_WEEK, {
    days: w.days.map((d) => d.day === OVERRIDE_DAY ? { day: d.day } : { day: d.day, holiday: d.holiday, periodsByGrade: d.periodsByGrade }),
  }, "claude-verify");
  w = (await listWeeks(DOMAIN, TERM)).find((x) => x.id === TEST_WEEK)!;
  if ((w.dayOverrides || []).length !== 0) fail(`자가 치유 실패: overrides=${JSON.stringify(w.dayOverrides)}`);
  console.log("6. 자가 치유: 파생값 복귀 → overrides=[] ✓");

  await dump("7. 종료 상태 (기준선과 요일 값 동일 + dayOverrides 재료화가 정상)");
  console.log("✅ 전 시나리오 통과");
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
