import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단 (읽기 전용)
import { computeCandidates, computeCandidatesAllWeeks } from "../src/lib/timetable/server";

/**
 * §14-2 v2.1 candidates_all 실측 (읽기 전용).
 * 검증: ① 전 주 반환 ② 같은-주·교차 주 결과가 기존 단건 computeCandidates(오버레이 동일)와 일치
 *      ③ counterpartScore 색 구간 분포 출력 (UI 임계값 참고용)
 */
async function run() {
  const domain = "hmh.or.kr";
  const email = "tteacher@hmh.or.kr";
  const srcWeek = "2026-08-10";
  const source = { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" };
  const whatIf = { includeMyPending: true, includeDrafts: true };

  const all = await computeCandidatesAllWeeks(domain, email, srcWeek, source, whatIf);
  if (all.error) throw new Error(all.error);
  console.log(`과목: ${all.sourceSubjectName}, 가상 반영: 신청 ${all.assumedPendingCount}·초안 ${all.assumedDraftCount}`);
  for (const w of all.weeks) {
    const buckets = { green: 0, orange: 0, red: 0 };
    for (const c of w.swapCandidates) {
      if (c.counterpartScore === 0) buckets.green++;
      else if (c.counterpartScore <= 2) buckets.orange++;
      else buckets.red++;
    }
    console.log(`  ${w.weekId}: 후보 ${w.swapCandidates.length}건 (초록 ${buckets.green}·주황 ${buckets.orange}·빨강 ${buckets.red})`);
  }

  const key = (c: { targetDay: number; targetPeriod: number; counterpartEmail: string }) =>
    `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail}`;

  // 같은-주 일치 검증
  const single = await computeCandidates(domain, email, srcWeek, source, undefined, whatIf);
  const allSame = all.weeks.find((w) => w.weekId === srcWeek)!.swapCandidates.map(key).sort().join("|");
  const singleSame = single.swapCandidates.map(key).sort().join("|");
  console.log(`\n같은-주(${srcWeek}) 단건 계산과 일치: ${allSame === singleSame ? "✅" : "❌"} (${single.swapCandidates.length}건)`);

  // 교차 주 일치 검증 (8/17)
  const tgt = "2026-08-17";
  const singleCross = await computeCandidates(domain, email, srcWeek, source, tgt, whatIf);
  const allCross = all.weeks.find((w) => w.weekId === tgt)!.swapCandidates.map(key).sort().join("|");
  const singleCrossKeys = singleCross.swapCandidates.map(key).sort().join("|");
  console.log(`교차 주(${tgt}) 단건 계산과 일치: ${allCross === singleCrossKeys ? "✅" : "❌"} (${singleCross.swapCandidates.length}건)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
