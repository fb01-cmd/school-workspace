import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단 (읽기 전용)
import { computeCandidates, computeMyProjectedWeeks, listSwapDrafts } from "../src/lib/timetable/server";

/**
 * §14-2 v2 서버부 실측 (읽기 전용):
 * ① my_projected — 등록 전 주 나열·PENDING/초안 가상 반영·virtual 마커·요일 시수
 * ② 감점 분류 — penaltyDetails scope·counterpartScore·상대 부담 우선 정렬
 */
async function run() {
  const domain = "hmh.or.kr";
  const email = "tteacher@hmh.or.kr";

  const drafts = await listSwapDrafts(domain, email);
  console.log(`초안 보유: ${drafts.length}건`);

  const proj = await computeMyProjectedWeeks(domain, email, { includeMyPending: true, includeDrafts: true });
  console.log(`\n① my_projected — 학기 ${proj.termId}, 주 ${proj.weeks.length}개, 가상 반영: 신청 ${proj.assumedPendingCount}건·초안 ${proj.assumedDraftCount}건`);
  for (const w of proj.weeks) {
    const virtualCells = w.cells.filter((c) => c.changed?.changeId?.startsWith("virtual-"));
    const reqMarks = virtualCells.filter((c) => c.changed!.changeId!.startsWith("virtual-req-")).length;
    const draftMarks = virtualCells.filter((c) => c.changed!.changeId!.startsWith("virtual-draft-")).length;
    console.log(
      `  ${w.weekId}: 셀 ${w.cells.length}개, 요일시수 ${w.dayLoads.map((d) => d.count).join(" ")}, ` +
      `가상 마커 ${virtualCells.length}개 (신청 ${reqMarks}·초안 ${draftMarks})`
    );
  }

  // 초안 중 PENDING과 같은 소스 셀인 것은 이중 적용 방지로 건너뛰어야 함
  console.log(`  검증: assumedDraftCount(${proj.assumedDraftCount}) ≤ 보유 초안(${drafts.length}) ${proj.assumedDraftCount <= drafts.length ? "✅" : "❌"}`);

  // ② 감점 분류 — 아무 셀이나 후보 조회
  const cand = await computeCandidates(domain, email, "2026-08-10", { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" });
  if (cand.error || !cand.swapCandidates.length) throw new Error(`후보 조회 실패: ${cand.error}`);
  let sortOk = true;
  let scopeOk = true;
  for (let i = 0; i < cand.swapCandidates.length; i++) {
    const c = cand.swapCandidates[i];
    const cpSum = c.penaltyDetails.filter((p) => p.scope === "counterpart").reduce((s, p) => s + p.points, 0);
    const total = c.penaltyDetails.reduce((s, p) => s + p.points, 0);
    if (c.counterpartScore !== cpSum || c.score !== total) scopeOk = false;
    if (i > 0 && cand.swapCandidates[i - 1].counterpartScore > c.counterpartScore) sortOk = false;
  }
  console.log(`\n② 감점 분류 — 후보 ${cand.swapCandidates.length}건`);
  console.log(`  counterpartScore=상대 합계·score=전체 합계 일치: ${scopeOk ? "✅" : "❌"}`);
  console.log(`  상대 부담 우선 정렬: ${sortOk ? "✅" : "❌"}`);
  const sample = cand.swapCandidates.find((c) => c.penaltyDetails.length > 0);
  if (sample) {
    console.log(`  표본: ${sample.counterpartName} — 전체 ${sample.score}점 / 상대 ${sample.counterpartScore}점`);
    for (const p of sample.penaltyDetails) console.log(`    [${p.scope}] ${p.text} (${p.points}점)`);
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
