import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단 (주 등록은 알림 없음, 관례 유지)
import { listWeeks, registerWeek } from "../src/lib/timetable/server";

/**
 * 주 등록 유틸 — 교차 주 교환 테스트/운영 준비용.
 * 사용: npx tsx --env-file=.env.local scripts/register_weeks.ts 2026-08-17 2026-08-24 [--note "메모"]
 * 날짜는 월요일(주 시작일)이어야 하며, 이미 등록된 주는 건너뛴다.
 */
async function run() {
  const domain = "hmh.or.kr";
  const termId = "2026-2";
  const operator = "admin@hmh.or.kr";

  const args = process.argv.slice(2);
  const noteIdx = args.indexOf("--note");
  const note = noteIdx >= 0 ? args[noteIdx + 1] : "교차 주 교환 테스트 주 (테스트 종료 시 삭제)";
  const dates = (noteIdx >= 0 ? args.slice(0, noteIdx) : args).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

  if (dates.length === 0) {
    console.log("사용법: npx tsx --env-file=.env.local scripts/register_weeks.ts <월요일 YYYY-MM-DD>... [--note \"메모\"]");
    process.exit(1);
  }

  const existing = await listWeeks(domain, termId);
  console.log(`현재 등록된 주(${termId}): ${existing.map((w) => w.id).join(", ") || "(없음)"}`);

  for (const startDate of dates) {
    if (existing.some((w) => w.id === startDate)) {
      console.log(`- ${startDate}: 이미 등록됨 — 건너뜀`);
      continue;
    }
    const week = await registerWeek(domain, { termId, startDate, note }, operator);
    console.log(`- ${startDate}: ✅ 등록 완료 (${week.days[0].date} ~ ${week.days[4].date})`);
  }

  const after = await listWeeks(domain, termId);
  console.log(`등록 후 주 목록: ${after.map((w) => w.id).join(", ")}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(`❌ 실패: ${e.message}`);
  process.exit(1);
});
