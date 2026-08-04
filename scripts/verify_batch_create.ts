import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단
import {
  cancelSwapRequest,
  computeCandidates,
  createSwapRequest,
  swapRequestsColRef,
} from "../src/lib/timetable/server";

/**
 * §14-2 batchId 일괄 접수 실측 (자가 정리 — 생성한 신청은 즉시 본인 취소).
 * 검증: ① batchId 저장 ② 같은 소스 중복 PENDING 차단(부분 실패 semantics) ③ 취소 정리.
 * 기존 tteacher@ 대기 신청(목2 교차 주)은 소스가 달라 간섭 없음 — 절대 승인/반려하지 않는다.
 */
async function run() {
  const domain = "hmh.or.kr";
  const email = "tteacher@hmh.or.kr";
  const weekId = "2026-08-10";
  const batchId = `verify-batch-${Date.now()}`;
  const createdIds: string[] = [];

  try {
    // 후보 2건 확보 (월1 1-1반, 화1 1-2반)
    const sources = [
      { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" },
      { grade: 1, classNum: 2, day: 2, period: 1, subjectName: "" },
    ];
    for (const source of sources) {
      const cand = await computeCandidates(domain, email, weekId, source);
      if (cand.error || !cand.swapCandidates.length) {
        console.log(`  (소스 ${source.day}-${source.period} 후보 없음 — 건너뜀: ${cand.error || "0건"})`);
        continue;
      }
      const c = cand.swapCandidates[0];
      const req = await createSwapRequest(
        domain, email,
        {
          weekId, type: "swap", source: { ...source, subjectName: cand.sourceSubjectName },
          candidate: { targetDay: c.targetDay, targetPeriod: c.targetPeriod, counterpartEmail: c.counterpartEmail, counterpartName: c.counterpartName, counterpartSubjectName: c.counterpartSubjectName, score: c.score, penalties: c.penalties },
          reason: { type: "기타", note: "batchId 실측 (자가 정리)" },
        },
        { batchId, skipManagerNotify: true }
      );
      createdIds.push(req.id);
      console.log(`① 접수: ${req.id} — batchId=${(req as any).batchId} ${(req as any).batchId === batchId ? "✅" : "❌"}`);
    }
    if (createdIds.length === 0) throw new Error("후보 확보 실패 — 실측 불가");

    // ② 같은 소스 중복 → 부분 실패 semantics 확인
    try {
      const cand = await computeCandidates(domain, email, weekId, sources[0]);
      const c = cand.swapCandidates[0];
      await createSwapRequest(domain, email, {
        weekId, type: "swap", source: { ...sources[0], subjectName: cand.sourceSubjectName },
        candidate: { targetDay: c.targetDay, targetPeriod: c.targetPeriod, counterpartEmail: c.counterpartEmail, counterpartName: c.counterpartName, counterpartSubjectName: c.counterpartSubjectName, score: c.score, penalties: c.penalties },
        reason: { type: "기타", note: "중복 차단 확인" },
      }, { batchId, skipManagerNotify: true });
      console.log("② 중복 소스 차단: ❌ (통과되면 안 됨)");
    } catch (e: any) {
      console.log(`② 중복 소스 차단: ✅ ("${e.message}")`);
    }

    // Firestore 재확인: batchId로 조회
    const snap = await swapRequestsColRef(domain).where("batchId", "==", batchId).get();
    console.log(`③ batchId 조회: ${snap.size}건 (기대 ${createdIds.length}) ${snap.size === createdIds.length ? "✅" : "❌"}`);
  } finally {
    // 자가 정리 — 생성한 신청 전부 본인 취소
    for (const id of createdIds) {
      try {
        await cancelSwapRequest(domain, email, id);
        console.log(`④ 정리: ${id} 취소 ✅`);
      } catch (e: any) {
        console.error(`④ 정리 실패: ${id} — ${e.message} (수동 취소 필요!)`);
      }
    }
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
