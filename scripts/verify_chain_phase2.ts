/**
 * 양해 개방 Phase 2 검증 — 교사 체인 전 사이클 실측 (consent_swap_opening_spec §4-2·§4-3).
 * 알림 전부 억제(skip 옵션), 마지막에 원장 흔적(신청·change·revert 문서) 완전 삭제 + 캐시 범프.
 *
 * [1] 소유 검증: 타인 이메일로 chain_search → 거부
 * [2] 체인 탐색: 실데이터에서 체인 확보 (2단계 우선, 없으면 1단계)
 * [3] 생성 게이트: consent 없이 → 거부 / 위조 단계열 → 거부
 * [4] 생성: consent 포함 → 원장 doc (chainSteps·parties 서버 도출) 확인
 * [5] 원자 승인: APPROVED + 단계 수만큼 change 생성(appliedAt 순서) + 합성본에 실제 이동 반영
 * [6] 체인 revert: change 1개 지정 → 전 단계 일괄 취소 + 합성본 원복
 * [7] 정리: 신청·change·revert 하드 삭제 → 합성본 최초 상태 대조 → 캐시 범프
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_chain_phase2.ts
 */
import {
  approveSwapRequest,
  computeChainSearch,
  createChainSwapRequest,
  listWeeks,
  loadBaseGridsByWeek,
  loadTimetableSettings,
  loadWeekChanges,
  revertTimetableChange,
  swapRequestsColRef,
  timetableChangesColRef,
} from "../src/lib/timetable/server";
import { bumpTimetableCacheVersion } from "../src/lib/timetable/cacheVersion";
import { synthesizeWeeklyGrids } from "../src/lib/timetable/weekly";
import { SwapRequest, TimetableChange, WeeklyClassGrid } from "../src/lib/timetable/types";

const D = "hmh.or.kr";
const MANAGER = "verify-script@hmh.or.kr"; // appliedBy 표기용 (실 계정 아님 — 삭제 전 잠깐 존재)

const gridSig = (grids: WeeklyClassGrid[]) =>
  JSON.stringify(
    grids.map((g) => ({
      g: g.grade, c: g.classNum,
      cells: g.cells.map((c) => ({
        d: c.day, p: c.period,
        l: c.lessons.map((l) => `${l.subjectName}|${(l.teachers || []).map((t) => t.email).join(",")}`),
      })),
    }))
  );

async function synthWeek(termId: string, weekId: string) {
  const settings = await loadTimetableSettings(D);
  const weeks = await listWeeks(D, termId);
  const week = weeks.find((w) => w.id === weekId)!;
  const base = (await loadBaseGridsByWeek(D, termId, [week.startDate])).get(week.startDate)!;
  const changes = await loadWeekChanges(D, weekId);
  return synthesizeWeeklyGrids(base, week, changes, settings).grids;
}

async function main() {
  const settings = await loadTimetableSettings(D);
  const termId = settings.activeTermId!;
  const weeks = (await listWeeks(D, termId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const week = weeks[0];
  const grids0 = await synthWeek(termId, week.id);
  const sig0 = gridSig(grids0);

  // 소스 후보: room 없는 단일 교사 수업 (체인은 clean 전용이라 특별실 소스는 경로가 잘 안 나옴)
  const sources: Array<{ grade: number; classNum: number; day: number; period: number; email: string; name: string }> = [];
  for (const g of grids0) for (const c of g.cells) {
    if (c.lessons.length !== 1) continue;
    const l = c.lessons[0];
    if (l.room || l.simul || (l.teachers || []).length !== 1) continue;
    const email = (l.teachers[0].email || "").trim().toLowerCase();
    if (!email || email === "playviolin@hmh.or.kr") continue;
    sources.push({ grade: g.grade, classNum: g.classNum, day: c.day, period: c.period, email, name: l.teachers[0].name });
  }

  // [1] 소유 검증 — 타인(다른 소스의 교사) 이메일로 탐색 시도
  const s0 = sources[0];
  const other = sources.find((s) => s.email !== s0.email)!;
  const denied = await computeChainSearch(D, {
    weekId: week.id, source: s0, target: { day: s0.day === 1 ? 2 : 1, period: 1 }, requesterEmail: other.email,
  });
  if (denied.error?.includes("본인의 수업만")) console.log(`[1] 타인 소스 탐색 거부 ✅ ("${denied.error}")`);
  else { console.error(`[1] 실패 ❌ — 거부 안 됨 (${denied.error || `체인 ${denied.chains.length}건 반환`})`); process.exit(1); }

  // [2] 체인 확보 — 점유 슬롯 목적지(2단계 유도) 우선, 폴백으로 아무 목적지 순회
  let found: { src: typeof s0; target: { day: number; period: number }; chains: NonNullable<Awaited<ReturnType<typeof computeChainSearch>>["chains"]> } | null = null;
  outer:
  for (const src of sources.slice(0, 40)) {
    const grid = grids0.find((g) => g.grade === src.grade && g.classNum === src.classNum)!;
    for (const cell of grid.cells) {
      if (cell.day === src.day && cell.period === src.period) continue;
      if (cell.lessons.length !== 1) continue; // 점유 슬롯 = 2단계(치우기) 후보
      const r = await computeChainSearch(D, {
        weekId: week.id, source: src, target: { day: cell.day, period: cell.period },
        maxDepth: 2, requesterEmail: src.email,
      });
      const multi = r.chains.find((c) => c.steps.length >= 2);
      if (multi) { found = { src, target: { day: cell.day, period: cell.period }, chains: r.chains }; break outer; }
      if (!found && r.chains.length) found = { src, target: { day: cell.day, period: cell.period }, chains: r.chains };
    }
  }
  if (!found) { console.error("[2] 체인 0건 — 데이터상 검증 불가 ❌"); process.exit(1); }
  const chain = found.chains.find((c) => c.steps.length >= 2) || found.chains[0];
  console.log(`[2] 체인 확보 ✅ — ${found.src.name}(${found.src.email}) ${found.src.day}/${found.src.period} → 목적지 ${found.target.day}/${found.target.period}, ${chain.steps.length}단계`);
  console.log(`    ${chain.summary}`);

  // [3] 생성 게이트 — consent 없이 / 위조 단계열
  const base = { weekId: week.id, source: found.src, chainTarget: found.target };
  try {
    await createChainSwapRequest(D, found.src.email, { ...base, steps: chain.steps, reason: { type: "기타", note: "검증" } }, { skipManagerNotify: true });
    console.error("[3] 실패 ❌ — consent 없이 생성됨"); process.exit(1);
  } catch (e: any) {
    if (e.message.includes("양해")) console.log(`[3a] consent 없는 생성 거부 ✅`);
    else { console.error(`[3a] 예상 밖 오류 ❌: ${e.message}`); process.exit(1); }
  }
  try {
    const forged = JSON.parse(JSON.stringify(chain.steps));
    forged[0].candidate.counterpartEmail = "forged@hmh.or.kr";
    await createChainSwapRequest(D, found.src.email, { ...base, steps: forged, reason: { type: "기타", note: "검증" }, consent: { confirmed: true } }, { skipManagerNotify: true });
    console.error("[3b] 실패 ❌ — 위조 단계열이 통과됨"); process.exit(1);
  } catch (e: any) {
    if (e.message.includes("유효하지")) console.log(`[3b] 위조 단계열 거부 ✅`);
    else { console.error(`[3b] 예상 밖 오류 ❌: ${e.message}`); process.exit(1); }
  }

  // [4] 생성 (알림 억제)
  const req = await createChainSwapRequest(
    D, found.src.email,
    { ...base, steps: chain.steps, reason: { type: "기타", note: "검증 스크립트 (즉시 정리)" }, consent: { confirmed: true, note: "검증용" } },
    { skipManagerNotify: true }
  );
  const expectedParties = new Set(
    chain.steps.flatMap((s) => [s.sourceTeacherEmail, s.candidate.counterpartEmail]).filter((e) => e !== found!.src.email)
  );
  const gotParties = new Set((req.consent?.parties || []).map((p) => p.email));
  const partiesOk = expectedParties.size === gotParties.size && [...expectedParties].every((e) => gotParties.has(e));
  console.log(`[4] 생성 ✅ req=${req.id} 단계 ${req.chainSteps?.length} / 양해 당사자 ${[...gotParties].join(",")} — 서버 도출 ${partiesOk ? "일치 ✅" : "불일치 ❌"}`);
  if (!partiesOk) process.exit(1);

  const cleanupDocs: Array<{ col: "req" | "chg"; id: string }> = [{ col: "req", id: req.id }];
  let failed = false; // try 안에서 process.exit 금지 — finally(원장 정리)가 반드시 돌아야 한다
  try {
    // [5] 원자 승인 (알림 억제) → change 생성·합성 반영 확인
    const { request: approved } = await approveSwapRequest(D, MANAGER, req.id, { skipNotify: true });
    const changeIds = approved.appliedChangeIds || [];
    changeIds.forEach((id) => cleanupDocs.push({ col: "chg", id }));
    const chgSnaps = await Promise.all(changeIds.map((id) => timetableChangesColRef(D).doc(id).get()));
    const chgs = chgSnaps.map((s) => s.data() as TimetableChange);
    const ordered = chgs.every((c, i) => i === 0 || c.appliedAt >= chgs[i - 1].appliedAt);
    const allLinked = chgs.every((c) => c.requestId === req.id);
    const gridsAfter = await synthWeek(termId, week.id);
    const moved = gridSig(gridsAfter) !== sig0;
    console.log(`[5] 승인 ✅ change ${changeIds.length}건 (appliedAt 순서 ${ordered ? "✅" : "❌"}, requestId 연결 ${allLinked ? "✅" : "❌"}, 합성 반영 ${moved ? "✅" : "❌"})`);
    if (!ordered || !allLinked || !moved) failed = true;

    // [6] 체인 revert — change 1개만 지정해도 전 단계 취소
    const revert = await revertTimetableChange(D, MANAGER, changeIds[0], { skipNotify: true });
    const revertSnap = await timetableChangesColRef(D).where("revertOf", "in", changeIds.slice(0, 10)).get();
    revertSnap.docs.forEach((d) => cleanupDocs.push({ col: "chg", id: d.id }));
    const allReverted = revertSnap.size === changeIds.length;
    const reqAfter = (await swapRequestsColRef(D).doc(req.id).get()).data() as SwapRequest;
    const gridsReverted = await synthWeek(termId, week.id);
    const restored = gridSig(gridsReverted) === sig0;
    console.log(`[6] revert — 전 단계 취소 ${allReverted ? `✅ (${revertSnap.size}/${changeIds.length})` : `❌ (${revertSnap.size}/${changeIds.length})`}, 신청 상태 ${reqAfter.status}, 합성 원복 ${restored ? "✅" : "❌"}`);
    if (!allReverted || !restored) failed = true;
    void revert;
  } finally {
    // [7] 원장 정리 — 검증 흔적 하드 삭제
    for (const d of cleanupDocs) {
      await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
    }
    const gridsFinal = await synthWeek(termId, week.id);
    console.log(`[7] 정리 완료 — 문서 ${cleanupDocs.length}건 삭제, 합성본 최초 상태 대조 ${gridSig(gridsFinal) === sig0 ? "✅" : "❌"}`);
    await bumpTimetableCacheVersion(D);
  }
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error("실패:", e.message); process.exit(1); });
