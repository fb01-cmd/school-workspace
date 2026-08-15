/**
 * 읽기 다이어트 ① 검증 (2026-08-16) — 후보 경로 advisory 캐시.
 *
 * [1] 동등성: 킬스위치 off(전부 fresh) 출력 ≡ 캐시 콜드 ≡ 캐시 웜 — 바이트 대조.
 * [2] 무효화 즉시성: 웜 캐시 상태에서 실제 커밋(승인) → 즉시 재조회가 변경을 반영해야
 *     한다(버전 bump가 키를 갈아끼움). revert 후 원상 대조·문서 하드 삭제까지.
 * 알림 전량 억제(skip 옵션). 같은 프로세스 안에서 돌아야 캐시가 공유된다.
 */
import {
  approveSwapRequest,
  computeCandidates,
  computeCandidatesAllWeeks,
  createSwapRequest,
  loadWeek,
  revertTimetableChange,
  swapRequestsColRef,
  timetableChangesColRef,
  synthesizeWeek,
} from "../src/lib/timetable/server";
import { bumpTimetableCacheVersion } from "../src/lib/timetable/cacheVersion";

const D = "hmh.or.kr";
const WEEK = "2026-08-10";
// 실측 고정 자리: 권성민(2-2 금1 영Ⅱ) — 일반·역방향 묶음·교차 주 후보가 모두 나오는 소스
const SRC = { grade: 2, classNum: 2, day: 5, period: 1, subjectName: "" };

async function snapAll(email: string): Promise<string> {
  const r = await computeCandidatesAllWeeks(D, email, WEEK, SRC as any);
  return JSON.stringify(r);
}
async function snapOne(email: string): Promise<string> {
  const r = await computeCandidates(D, email, WEEK, SRC as any);
  return JSON.stringify(r);
}

async function main() {
  const week = (await loadWeek(D, WEEK))!;
  const { grids } = await synthesizeWeek(D, week);
  const lesson = grids
    .find((g) => g.grade === 2 && g.classNum === 2)!
    .cells.find((c) => c.day === 5 && c.period === 1)!.lessons[0];
  const email = lesson.teachers[0].email!.trim().toLowerCase();
  console.log(`소스: 2-2 금1 ${lesson.subjectName} <${email}>`);

  // [1] 동등성 — off(전부 fresh) ≡ 콜드 ≡ 웜
  process.env.TIMETABLE_VIEW_CACHE = "off";
  const offAll = await snapAll(email);
  const offOne = await snapOne(email);
  delete process.env.TIMETABLE_VIEW_CACHE;
  await bumpTimetableCacheVersion(D); // 새 버전에서 콜드 시작 (이전 실행 잔재 격리)
  const coldAll = await snapAll(email);
  const warmAll = await snapAll(email);
  const warmOne = await snapOne(email);
  const eqAll = offAll === coldAll && coldAll === warmAll;
  const eqOne = offOne === warmOne;
  console.log(
    `[1] 동등성 ${eqAll && eqOne ? "✅" : "❌"} — 전주 조회 off≡콜드≡웜 ${eqAll ? "✅" : "❌"} (${(offAll.length / 1024).toFixed(0)}KB) · 단주 조회 ${eqOne ? "✅" : "❌"}`
  );
  if (!eqAll || !eqOne) process.exit(1);

  // [2] 무효화 즉시성 — 웜 상태에서 깨끗한 후보 1건을 실제 승인 → 즉시 재조회에 반영돼야
  const one = JSON.parse(warmOne);
  const clean = (one.swapCandidates || []).find((c: any) => !c.coordination && c.counterpartEmail);
  if (!clean) {
    console.log("[2] 깨끗한 같은 주 후보 0건 — 무효화 검사 미실행 (미검증)");
    process.exit(1);
  }
  const req = await createSwapRequest(
    D,
    email,
    {
      weekId: WEEK,
      type: "swap",
      source: { ...SRC, subjectName: "" },
      candidate: {
        targetDay: clean.targetDay,
        targetPeriod: clean.targetPeriod,
        counterpartEmail: clean.counterpartEmail,
        counterpartName: clean.counterpartName,
        score: clean.score,
        penalties: clean.penalties,
      },
      reason: { type: "기타", note: "읽기 다이어트 검증 (즉시 정리)" },
    },
    { skipManagerNotify: true }
  );
  const cleanup: Array<{ col: "req" | "chg"; id: string }> = [{ col: "req", id: req.id }];
  let failed = false;
  try {
    const { changes } = (await approveSwapRequest(D, "fb01@hmh.or.kr", req.id, {
      skipNotify: true,
    })) as any;
    const applied: any[] = Array.isArray(changes) ? changes : [changes].filter(Boolean);
    applied.forEach((c) => cleanup.push({ col: "chg", id: c.id }));

    const afterCommit = await snapAll(email);
    const invalidated = afterCommit !== warmAll;
    console.log(`[2] 커밋 직후 재조회가 변경 반영 ${invalidated ? "✅" : "❌ (낡은 캐시!)"}`);
    if (!invalidated) failed = true;

    await revertTimetableChange(D, "fb01@hmh.or.kr", applied[0].id, { skipNotify: true });
    for (const c of applied) {
      const snap = await timetableChangesColRef(D).where("revertOf", "==", c.id).get();
      snap.docs.forEach((d) => cleanup.push({ col: "chg", id: d.id }));
    }
    const afterRevert = await snapAll(email);
    const restored = afterRevert === warmAll;
    console.log(`[3] revert 후 재조회 원상 대조 ${restored ? "✅" : "❌"}`);
    if (!restored) failed = true;
  } finally {
    for (const d of cleanup)
      await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
    await bumpTimetableCacheVersion(D); // 하드 삭제는 bump를 안 타므로 수동 무효화
    const final = await snapAll(email);
    console.log(`[4] 정리 완료 — 문서 ${cleanup.length}건 삭제, 최초 스냅샷 대조 ${final === warmAll ? "✅" : "❌"}`);
    if (final !== warmAll) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
