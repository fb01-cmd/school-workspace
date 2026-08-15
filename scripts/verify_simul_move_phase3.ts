/**
 * 양해 개방 Phase 3 검증 — 동시수업 묶음 통 이동 전 사이클 실측 (consent_swap_opening_spec §5b-6 항목 3
 * + §5c-6 완료 판정). verify_chain_phase2.ts 양식 계승: 알림 전부 억제(skipNotify), 마지막에 원장 흔적
 * (신청·change·revert 문서) 완전 삭제 + 캐시 범프 + 합성본 최초 상태 대조.
 *
 * [1] 후보 실측: 활성 그룹 × 현행 슬롯 전수 엔진 실행(순수 함수 — 추가 Firestore 읽기 0)
 *     — kind 분포(swap/move/혼합)·조율 후보·자기맞물림 검출을 정직하게 집계 (미검출도 보고)
 * [2] consent 게이트: 양해 확인 없이 커밋 → 거부
 * [3] 위조·원자성: 후보에 없는 목적지로 커밋 → 거부 + change 0건 (부분 성공 금지 확인)
 * [4] 원자 커밋(직권 보조 경로): APPROVED 즉시 + 반별 change(kind 일치·appliedAt 순서·requestId 연결)
 *     + parties 서버 도출 대조 + 합성본에 전 반 이동 실반영 확인
 * [5] revert: change 1건 지정 → 전량 취소 + 신청 CANCELED + 합성 원복
 * [6] 정리: 하드 삭제 → 최초 상태 대조 → 캐시 범프
 * [7] §5c 교사 신청 주 경로: 후보 혼입(computeCandidates에 coordination.simul 후보) → 일반 swap
 *     우회 방어 → consent 게이트 → 신청(PENDING·parties 신청자 제외·steps 서버값) → 그룹·슬롯 단위
 *     중복 차단 → validatePending 진짜 재검증 → 승인(공용 조립부 원자 커밋) → revert 전량 원복
 * [8] 기존 출력 불변: 비묶음 소스에서 computeCandidates(분기 신설 후) ≡ 엔진 직접 호출(분기 이전
 *     경로) 바이트 동등 + simul 혼입 0건 + 체인 탐색 스모크 — §5c-6 완료 판정 ⑤
 *
 * 읽기 예산: 합성 ~12회 + 커밋·승인 경로 ≈ 600 reads 추산 (전수조사 아님).
 * 실행: npx tsx --env-file=.env.local scripts/verify_simul_move_phase3.ts
 */
import {
  approveSwapRequest,
  commitSimulGroupMove,
  computeCandidates,
  computeChainSearch,
  createSimulMoveRequest,
  createSwapRequest,
  listWeeks,
  loadBaseGridsByWeek,
  loadSimulGroups,
  loadTimetableSettings,
  loadWeekChanges,
  revertTimetableChange,
  swapRequestsColRef,
  timetableChangesColRef,
  validatePendingSwapRequests,
} from "../src/lib/timetable/server";
import { bumpTimetableCacheVersion } from "../src/lib/timetable/cacheVersion";
import { synthesizeWeeklyGrids } from "../src/lib/timetable/weekly";
import { findSimulGroupMoveCandidates, findSwapCandidates } from "../src/lib/timetable/swap";
import {
  SimulGroup,
  SimulGroupMoveCandidate,
  SwapRequest,
  TimetableChange,
  WeeklyClassGrid,
} from "../src/lib/timetable/types";

const D = "hmh.or.kr";
const MANAGER = "verify-script@hmh.or.kr"; // appliedBy 표기용 (실 계정 아님 — 삭제 전 잠깐 존재)
const DAYS = ["", "월", "화", "수", "목", "금"];

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
  return { grids: synthesizeWeeklyGrids(base, week, changes, settings).grids, week, settings };
}

async function main() {
  const settings0 = await loadTimetableSettings(D);
  const termId = settings0.activeTermId!;
  const weeks = (await listWeeks(D, termId)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const week = weeks[0];
  const { grids: grids0, week: weekObj, settings } = await synthWeek(termId, week.id);
  const sig0 = gridSig(grids0);
  const groups = (await loadSimulGroups(D, termId)).filter((g) => g.active);
  if (groups.length === 0) { console.error("[0] 활성 이동수업 그룹 0건 — 데이터상 검증 불가 ❌"); process.exit(1); }
  console.log(`[0] 주 ${week.id} · 활성 그룹 ${groups.length}건 (${groups.map((g) => g.label).join(", ")})`);

  // [1] 후보 실측 — 그룹 × 현행 슬롯 전수 (엔진은 순수 함수, 로드된 합성본만 사용)
  type Pick = { group: SimulGroup; source: { day: number; period: number }; cand: SimulGroupMoveCandidate };
  let total = 0, mixed = 0, withMove = 0, coord = 0, selfLock = 0, sourceErrors = 0;
  let pickMixed: Pick | null = null, pickMove: Pick | null = null, pickAny: Pick | null = null;
  let pickSelfLock: Pick | null = null, pickSwap: Pick | null = null;
  for (const group of groups) {
    const slots = new Set<string>();
    for (const cn of group.classNums) {
      const grid = grids0.find((g) => g.grade === group.grade && g.classNum === cn);
      for (const cell of grid?.cells || [])
        if (cell.lessons.some((l) => l.simul === group.label)) slots.add(`${cell.day}-${cell.period}`);
    }
    const groupTeacherEmails = new Set<string>();
    for (const cn of group.classNums) {
      const grid = grids0.find((g) => g.grade === group.grade && g.classNum === cn);
      for (const cell of grid?.cells || [])
        for (const l of cell.lessons)
          if (l.simul === group.label)
            for (const t of l.teachers || []) if (t.email?.trim()) groupTeacherEmails.add(t.email.trim().toLowerCase());
    }
    for (const key of slots) {
      const [day, period] = key.split("-").map(Number);
      const res = findSimulGroupMoveCandidates(grids0, weekObj, settings, group, { day, period });
      if (res.error) { sourceErrors++; continue; }
      for (const cand of res.candidates) {
        total++;
        const kinds = new Set(cand.steps.map((s) => s.kind));
        const isMixed = kinds.size === 2;
        if (isMixed) mixed++;
        if (kinds.has("move")) withMove++;
        if (cand.coordination) coord++;
        const isSelfLock = cand.steps.some((s) => s.counterpart && groupTeacherEmails.has(s.counterpart.teacherEmail));
        if (isSelfLock) selfLock++;
        const pick: Pick = { group, source: { day, period }, cand };
        if (isMixed && !pickMixed) pickMixed = pick;
        if (kinds.has("move") && !pickMove) pickMove = pick;
        if (isSelfLock && !pickSelfLock) pickSelfLock = pick;
        if (kinds.has("swap") && !cand.coordination && !pickSwap) pickSwap = pick; // 조율 없는 swap 우선 (커밋 단순 경로)
        if (!pickAny) pickAny = pick;
      }
    }
  }
  console.log(
    `[1] 후보 실측 ✅ — 총 ${total}건 (혼합 swap+move ${mixed} · move 포함 ${withMove} · 조율 필요 ${coord} · 자기맞물림 ${selfLock} · 소스 오류 슬롯 ${sourceErrors})`
  );
  if (mixed === 0) console.log("    ⚠️ 혼합(swap+move) 후보 미검출 — 실데이터에 해당 지형 없음 (스펙 항목은 kind별 개별 커버로 대체)");
  if (selfLock === 0) console.log("    ⚠️ 자기맞물림 후보 미검출 — 실데이터에 해당 지형 없음 (판정식은 엔진 단위 검증 항목으로 남김)");
  // 커밋 검증 대상: (A) swap 반 포함 — 자기맞물림 우선 / (B) move 반 포함. 두 kind의 커밋 경로를 모두 실측.
  const pickA = pickMixed || pickSelfLock || pickSwap || pickAny;
  const pickB = pickMove && pickMove !== pickA ? pickMove : null;
  if (!pickA) { console.error("[1] 커밋 검증에 쓸 후보 0건 ❌"); process.exit(1); }
  if (!pickB) console.log("    ⚠️ move 포함 후보가 A와 동일하거나 없음 — 커밋 사이클 1회로 축소");

  // ── [8] 기존 출력 불변 (§5c-6 ⑤) — 비묶음 소스에서 신경로 ≡ 엔진 직접 호출.
  //    §5c-7 분기는 소스 셀에 simul 스탬프가 있을 때만 발동한다 — 비묶음 소스의 출력이
  //    분기 이전 경로(엔진 직접 호출)와 바이트 단위로 같으면 회귀 0이 실측으로 확인된다.
  type RegSrc = { src: { grade: number; classNum: number; day: number; period: number }; email: string; subject: string };
  const regressionSources: RegSrc[] = [];
  outer: for (const grid of grids0) {
    for (const cell of grid.cells) {
      if (cell.lessons.length !== 1) continue;
      const l = cell.lessons[0];
      if (l.simul || (l.teachers || []).length !== 1) continue;
      const t = l.teachers[0];
      if (!t.email?.trim()) continue;
      regressionSources.push({
        src: { grade: grid.grade, classNum: grid.classNum, day: cell.day, period: cell.period },
        email: t.email.trim().toLowerCase(),
        subject: l.subjectName,
      });
      if (regressionSources.length >= 3) break outer;
    }
  }
  let regFailed = false;
  for (const [i, s] of regressionSources.entries()) {
    const viaServer = await computeCandidates(D, s.email, week.id, { ...s.src, subjectName: "" });
    const direct = findSwapCandidates(
      grids0, weekObj, settings, s.email, { ...s.src, subjectName: s.subject }, { includeCoordination: true }
    );
    const equal =
      JSON.stringify(viaServer.swapCandidates) === JSON.stringify(direct.candidates) &&
      (viaServer.error || "") === (direct.error || "");
    const noSimul = (viaServer.swapCandidates || []).every((c) => !c.coordination?.simul);
    console.log(
      `[8-${i + 1}] 비묶음 출력 불변 ${equal && noSimul ? "✅" : "❌"} — ${s.src.grade}-${s.src.classNum} ${DAYS[s.src.day]}${s.src.period} (${s.subject}): ` +
      `맞교환 ${viaServer.swapCandidates.length}건 · 보강 ${viaServer.substituteCandidates.length}건${viaServer.error ? ` · 사유 "${viaServer.error}"` : ""} · simul 혼입 없음 ${noSimul ? "✅" : "❌"}`
    );
    if (!equal || !noSimul) regFailed = true;
  }
  // 체인 탐색 스모크 — computeChainSearch는 무수정이므로 예외 없이 구조가 돌아오는지만 확인
  if (regressionSources.length > 0) {
    const s = regressionSources[0];
    const chainRes = await computeChainSearch(D, {
      weekId: week.id,
      source: s.src,
      target: { day: s.src.day === 5 ? 1 : s.src.day + 1, period: s.src.period },
      requesterEmail: s.email,
    });
    const chainOk = Array.isArray(chainRes.chains);
    console.log(`[8-4] 체인 탐색 스모크 ${chainOk ? "✅" : "❌"} — 체인 ${chainRes.chains?.length ?? "?"}건${chainRes.error ? ` · 사유 "${chainRes.error}"` : ""}`);
    if (!chainOk) regFailed = true;
  }
  if (regFailed) { console.error("[8] 기존 출력 불변 실패 ❌"); process.exit(1); }

  const changeCount0 = (await loadWeekChanges(D, week.id)).length;

  // [2] consent 게이트 (pickA로 1회)
  try {
    await commitSimulGroupMove(D, MANAGER, {
      weekId: week.id, groupId: pickA.group.id!,
      source: pickA.source, target: { day: pickA.cand.targetDay, period: pickA.cand.targetPeriod },
      reason: { type: "기타", note: "검증" },
    }, { skipNotify: true });
    console.error("[2] 실패 ❌ — consent 없이 커밋됨"); process.exit(1);
  } catch (e: any) {
    if (e.message.includes("양해")) console.log(`[2] consent 없는 커밋 거부 ✅`);
    else { console.error(`[2] 예상 밖 오류 ❌: ${e.message}`); process.exit(1); }
  }

  // [3] 위조 목적지 → 거부 + change 0건 (원자성)
  try {
    await commitSimulGroupMove(D, MANAGER, {
      weekId: week.id, groupId: pickA.group.id!,
      source: pickA.source, target: pickA.source, // 소스 슬롯 = 후보에 없는 목적지
      reason: { type: "기타", note: "검증" }, consent: { confirmed: true },
    }, { skipNotify: true });
    console.error("[3] 실패 ❌ — 위조 목적지가 통과됨"); process.exit(1);
  } catch (e: any) {
    const changeCount1 = (await loadWeekChanges(D, week.id)).length;
    if (e.message.includes("유효하지") && changeCount1 === changeCount0)
      console.log(`[3] 위조 목적지 거부 ✅ + change 0건 (원자성 — ${changeCount0}건 유지)`);
    else { console.error(`[3] 실패 ❌ — 사유 "${e.message}" / change ${changeCount0}→${changeCount1}`); process.exit(1); }
  }

  // [4]~[6] 커밋 → 실반영 대조 → revert → 하드 정리, 사이클 단위
  const runCycle = async (tag: string, pick: Pick): Promise<boolean> => {
    const { group, source, cand } = pick;
    const target = { day: cand.targetDay, period: cand.targetPeriod };
    const hasSelfLock = cand.steps.some((s) => s.counterpart && cand.steps.some((g) => g.groupLesson.teacherEmail === s.counterpart!.teacherEmail));
    console.log(
      `[4${tag}] 「${group.label}」 ${DAYS[source.day]}${source.period} → ${DAYS[target.day]}${target.period} ` +
      `(steps ${cand.steps.length}: ${cand.steps.map((s) => `${s.classNum}반 ${s.kind}`).join(", ")}${cand.coordination ? " · 조율 필요" : ""}${hasSelfLock ? " · 자기맞물림" : ""}${cand.warnings?.length ? " · 경고 있음" : ""})`
    );
    const { request: req, changes } = await commitSimulGroupMove(D, MANAGER, {
      weekId: week.id, groupId: group.id!, source, target,
      reason: { type: "기타", note: "검증 스크립트 (즉시 정리)" }, consent: { confirmed: true, note: "검증용" },
    }, { skipNotify: true });
    const cleanupDocs: Array<{ col: "req" | "chg"; id: string }> = [
      { col: "req", id: req.id },
      ...changes.map((c) => ({ col: "chg" as const, id: c.id })),
    ];
    let failed = false; // try 안에서 process.exit 금지 — finally(원장 정리)가 반드시 돌아야 한다
    try {
      const steps = req.simulMove!.steps;
      const kindsOk =
        changes.length === steps.length &&
        changes.every((c, i) => (steps[i].kind === "swap" ? c.type === "swap" && !!c.swap : c.type === "move" && !!c.move));
      const ordered = changes.every((c, i) => i === 0 || c.appliedAt >= changes[i - 1].appliedAt);
      const linked = changes.every((c) => c.requestId === req.id);
      const stateOk = req.type === "simul_move" && req.status === "APPROVED" && req.direct === true;
      // parties 기대 집합: 그룹 교사 ∪ 상대 교사 ∪ 조율 당사자
      const expected = new Set(
        [
          ...steps.map((s) => s.groupLesson.teacherEmail),
          ...steps.filter((s) => s.counterpart).map((s) => s.counterpart!.teacherEmail),
          ...(cand.coordination?.conflicts || []).flatMap((c) => c.occupants.map((o) => o.teacherEmail)),
        ].filter(Boolean)
      );
      const got = new Set((req.consent?.parties || []).map((p) => p.email));
      const partiesOk = expected.size === got.size && [...expected].every((e) => got.has(e));
      console.log(
        `      커밋 ✅ req=${req.id} — 상태 ${stateOk ? "✅" : "❌"} · change ${changes.length}건 kind 일치 ${kindsOk ? "✅" : "❌"} · appliedAt 순서 ${ordered ? "✅" : "❌"} · requestId 연결 ${linked ? "✅" : "❌"} · parties(${[...got].join(",")}) 도출 ${partiesOk ? "✅" : "❌"}`
      );
      if (!stateOk || !kindsOk || !ordered || !linked || !partiesOk) failed = true;

      // 합성 실반영: 전 반 그룹 수업이 target에, swap 반은 상대가 source에
      const { grids: gridsAfter } = await synthWeek(termId, week.id);
      let movedOk = true;
      for (const step of steps) {
        const grid = gridsAfter.find((g) => g.grade === group.grade && g.classNum === step.classNum)!;
        const toCell = grid.cells.find((c) => c.day === target.day && c.period === target.period);
        if (!toCell?.lessons.some((l) => l.simul === group.label && l.subjectName === step.groupLesson.subjectName)) movedOk = false;
        const fromCell = grid.cells.find((c) => c.day === source.day && c.period === source.period);
        if (step.kind === "swap") {
          if (!fromCell?.lessons.some((l) => l.subjectName === step.counterpart!.subjectName)) movedOk = false;
        } else {
          if (fromCell?.lessons.some((l) => l.simul === group.label && l.subjectName === step.groupLesson.subjectName)) movedOk = false;
        }
      }
      const sigChanged = gridSig(gridsAfter) !== sig0;
      console.log(`      합성 실반영: 전 반 이동 대조 ${movedOk ? "✅" : "❌"} · 합성본 변화 ${sigChanged ? "✅" : "❌"}`);
      if (!movedOk || !sigChanged) failed = true;

      // [5] revert — change 1건 지정 → 전량 취소·신청 CANCELED·원복
      await revertTimetableChange(D, MANAGER, changes[0].id, { skipNotify: true });
      const changeIds = changes.map((c) => c.id);
      let revertCount = 0;
      for (let i = 0; i < changeIds.length; i += 10) {
        const snap = await timetableChangesColRef(D).where("revertOf", "in", changeIds.slice(i, i + 10)).get();
        snap.docs.forEach((d) => cleanupDocs.push({ col: "chg", id: d.id }));
        revertCount += snap.size;
      }
      const reqAfter = (await swapRequestsColRef(D).doc(req.id).get()).data() as SwapRequest;
      const { grids: gridsReverted } = await synthWeek(termId, week.id);
      const restored = gridSig(gridsReverted) === sig0;
      console.log(
        `[5${tag}] revert — 전량 취소 ${revertCount === changes.length ? `✅ (${revertCount}/${changes.length})` : `❌ (${revertCount}/${changes.length})`} · 신청 상태 ${reqAfter.status} · 합성 원복 ${restored ? "✅" : "❌"}`
      );
      if (revertCount !== changes.length || reqAfter.status !== "CANCELED" || !restored) failed = true;
    } finally {
      // [6] 원장 정리 — 검증 흔적 하드 삭제
      for (const d of cleanupDocs) {
        await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
      }
      const { grids: gridsFinal } = await synthWeek(termId, week.id);
      console.log(`[6${tag}] 정리 완료 — 문서 ${cleanupDocs.length}건 삭제, 합성본 최초 상태 대조 ${gridSig(gridsFinal) === sig0 ? "✅" : "❌"}`);
    }
    return failed;
  };

  // ── [7] §5c 교사 신청 주 경로 — 후보 혼입 → 우회 방어 → 신청 → 사전검증 → 승인 → revert ──
  const runTeacherCycle = async (pick: Pick): Promise<boolean> => {
    const { group, source } = pick;
    // 그룹 수업 담당 실교사 1인과 그 반 (합성본에서 해석 — 교사가 자기 수업을 클릭하는 시점 재현)
    let teacherEmail = "";
    let teacherClass = 0;
    for (const cn of group.classNums) {
      const grid = grids0.find((g) => g.grade === group.grade && g.classNum === cn);
      const cell = grid?.cells.find((c) => c.day === source.day && c.period === source.period);
      for (const l of cell?.lessons || []) {
        if (l.simul !== group.label) continue;
        const t = (l.teachers || [])[0];
        if (t?.email?.trim()) { teacherEmail = t.email.trim().toLowerCase(); teacherClass = cn; break; }
      }
      if (teacherEmail) break;
    }
    if (!teacherEmail) { console.error("[7] 그룹 담당 실교사 미검출 ❌"); return true; }
    const src = { grade: group.grade, classNum: teacherClass, day: source.day, period: source.period };
    console.log(`[7] 교사 경로 — 「${group.label}」 ${group.grade}-${teacherClass} ${DAYS[source.day]}${source.period} (신청자 ${teacherEmail})`);

    // 7-1. 후보 혼입 — computeCandidates가 통 이동 후보를 조율 필요 모양(coordination.simul)으로 반환
    const computed = await computeCandidates(D, teacherEmail, week.id, { ...src, subjectName: "" });
    const engineRes = findSimulGroupMoveCandidates(grids0, weekObj, settings, group, source);
    const allSimul =
      computed.swapCandidates.length > 0 &&
      computed.swapCandidates.every(
        (c) => c.coordination?.simul && (c.coordination.kind === "simul" || c.coordination.kind === "venue+simul")
      );
    const countOk = computed.swapCandidates.length === engineRes.candidates.length;
    const subsEmpty = computed.substituteCandidates.length === 0;
    console.log(
      `[7-1] 후보 혼입 ${allSimul && countOk && subsEmpty ? "✅" : "❌"} — ${computed.swapCandidates.length}건 (엔진 ${engineRes.candidates.length}건 일치 ${countOk ? "✅" : "❌"} · 전건 coordination.simul ${allSimul ? "✅" : "❌"} · 보강 0건 ${subsEmpty ? "✅" : "❌"})`
    );
    if (!allSimul || !countOk || !subsEmpty) return true;
    const cand = computed.swapCandidates[0];
    const target = { day: cand.targetDay, period: cand.targetPeriod };

    // 7-2. 우회 방어 — 묶음 후보를 일반 swap 신청(createSwapRequest)으로 밀어넣기
    try {
      await createSwapRequest(D, teacherEmail, {
        weekId: week.id, type: "swap", source: { ...src, subjectName: "" },
        candidate: {
          targetDay: target.day, targetPeriod: target.period,
          counterpartEmail: "", counterpartName: cand.counterpartName, score: 0, penalties: [],
        },
        reason: { type: "기타", note: "검증" }, consent: { confirmed: true },
      }, { skipManagerNotify: true });
      console.error("[7-2] 실패 ❌ — 묶음 후보가 일반 swap 신청으로 통과됨"); return true;
    } catch (e: any) {
      if (e.message.includes("묶음 이동 신청")) console.log("[7-2] 일반 swap 신청 우회 거부 ✅");
      else { console.error(`[7-2] 예상 밖 사유 ❌: ${e.message}`); return true; }
    }

    // 7-3. consent 게이트
    try {
      await createSimulMoveRequest(D, teacherEmail, {
        weekId: week.id, source: src, target, reason: { type: "기타", note: "검증" },
      }, { skipManagerNotify: true });
      console.error("[7-3] 실패 ❌ — consent 없이 신청됨"); return true;
    } catch (e: any) {
      if (e.message.includes("양해")) console.log("[7-3] consent 없는 신청 거부 ✅");
      else { console.error(`[7-3] 예상 밖 사유 ❌: ${e.message}`); return true; }
    }

    // 7-4. 신청 — PENDING + parties(신청자 제외, 서버 도출) + steps 서버 재계산값
    const req = await createSimulMoveRequest(D, teacherEmail, {
      weekId: week.id, source: src, target,
      reason: { type: "기타", note: "검증 스크립트 (즉시 정리)" }, consent: { confirmed: true, note: "검증용" },
    }, { skipManagerNotify: true });
    const cleanupDocs: Array<{ col: "req" | "chg"; id: string }> = [{ col: "req", id: req.id }];
    let failed = false;
    try {
      const engineMatch = engineRes.candidates.find(
        (c) => c.targetDay === target.day && c.targetPeriod === target.period
      )!;
      const expected = new Set(
        [
          ...engineMatch.steps.map((s) => s.groupLesson.teacherEmail),
          ...engineMatch.steps.filter((s) => s.counterpart).map((s) => s.counterpart!.teacherEmail),
          ...(engineMatch.coordination?.conflicts || []).flatMap((c) => c.occupants.map((o) => o.teacherEmail)),
        ].filter(Boolean)
      );
      expected.delete(teacherEmail); // 신청자 본인 제외 (§5c-2)
      const got = new Set((req.consent?.parties || []).map((p) => p.email));
      const partiesOk = expected.size === got.size && [...expected].every((e) => got.has(e));
      const stateOk = req.status === "PENDING" && req.type === "simul_move" && !req.direct;
      const stepsOk = JSON.stringify(req.simulMove?.steps) === JSON.stringify(engineMatch.steps);
      console.log(
        `[7-4] 신청 ${stateOk && partiesOk && stepsOk ? "✅" : "❌"} — PENDING ${stateOk ? "✅" : "❌"} · parties 신청자 제외 도출 ${partiesOk ? "✅" : "❌"} (${[...got].join(",") || "없음"}) · steps 서버값 ${stepsOk ? "✅" : "❌"}`
      );
      if (!stateOk || !partiesOk || !stepsOk) failed = true;

      // 7-5. 그룹·슬롯 단위 중복 차단 — 같은 그룹의 다른 교사 시점에서도 막혀야 한다 (§5c-2)
      const otherTeacher =
        [...new Set(engineMatch.steps.map((s) => s.groupLesson.teacherEmail))]
          .find((e) => e && e !== teacherEmail) || teacherEmail;
      try {
        await createSimulMoveRequest(D, otherTeacher, {
          weekId: week.id, source: src, target,
          reason: { type: "기타", note: "검증" }, consent: { confirmed: true },
        }, { skipManagerNotify: true });
        console.error("[7-5] 실패 ❌ — 그룹 중복 PENDING이 통과됨"); failed = true;
      } catch (e: any) {
        if (e.message.includes("대기 중인 이동 신청"))
          console.log(`[7-5] 그룹·슬롯 단위 중복 차단 ✅ (${otherTeacher === teacherEmail ? "동일 교사" : "다른 그룹 교사"} 시점)`);
        else { console.error(`[7-5] 예상 밖 사유 ❌: ${e.message}`); failed = true; }
      }

      // 7-6. 요청대장 사전 검증 — §5c-4의 "진짜 재검증" 경로 (조기 통과 아님)
      const validation = await validatePendingSwapRequests(D, [req]);
      const vOk = validation[req.id]?.ok === true;
      console.log(`[7-6] validatePending 재검증 ${vOk ? "✅" : `❌ (${validation[req.id]?.reason})`}`);
      if (!vOk) failed = true;

      // 7-7. 승인 — 공용 조립부(assembleSimulMoveChanges)로 반별 원자 커밋
      const { request: approved, changes } = await approveSwapRequest(D, MANAGER, req.id, { skipNotify: true });
      changes.forEach((c) => cleanupDocs.push({ col: "chg", id: c.id }));
      const steps = req.simulMove!.steps;
      const kindsOk =
        changes.length === steps.length &&
        changes.every((c, i) => (steps[i].kind === "swap" ? c.type === "swap" && !!c.swap : c.type === "move" && !!c.move));
      const ordered = changes.every((c, i) => i === 0 || c.appliedAt >= changes[i - 1].appliedAt);
      const linked = changes.every((c) => c.requestId === req.id);
      const aOk = approved.status === "APPROVED";
      console.log(
        `[7-7] 승인 ${aOk && kindsOk && ordered && linked ? "✅" : "❌"} — change ${changes.length}건 kind 일치 ${kindsOk ? "✅" : "❌"} · appliedAt 순서 ${ordered ? "✅" : "❌"} · requestId 연결 ${linked ? "✅" : "❌"}`
      );
      if (!aOk || !kindsOk || !ordered || !linked) failed = true;

      // 합성 실반영 — 전 반 그룹 수업이 target에 실재
      const { grids: gridsAfter } = await synthWeek(termId, week.id);
      let movedOk = true;
      for (const step of steps) {
        const grid = gridsAfter.find((g) => g.grade === group.grade && g.classNum === step.classNum)!;
        const toCell = grid.cells.find((c) => c.day === target.day && c.period === target.period);
        if (!toCell?.lessons.some((l) => l.simul === group.label && l.subjectName === step.groupLesson.subjectName))
          movedOk = false;
      }
      console.log(`      합성 실반영: 전 반 이동 대조 ${movedOk ? "✅" : "❌"}`);
      if (!movedOk) failed = true;

      // 7-8. revert — change 1건 지정 → 전량 취소·신청 CANCELED·합성 원복
      await revertTimetableChange(D, MANAGER, changes[0].id, { skipNotify: true });
      const changeIds = changes.map((c) => c.id);
      let revertCount = 0;
      for (let i = 0; i < changeIds.length; i += 10) {
        const snap = await timetableChangesColRef(D).where("revertOf", "in", changeIds.slice(i, i + 10)).get();
        snap.docs.forEach((d) => cleanupDocs.push({ col: "chg", id: d.id }));
        revertCount += snap.size;
      }
      const reqAfter = (await swapRequestsColRef(D).doc(req.id).get()).data() as SwapRequest;
      const { grids: gridsReverted } = await synthWeek(termId, week.id);
      const restored = gridSig(gridsReverted) === sig0;
      console.log(
        `[7-8] revert — 전량 취소 ${revertCount === changes.length ? "✅" : "❌"} (${revertCount}/${changes.length}) · 신청 상태 ${reqAfter.status} · 합성 원복 ${restored ? "✅" : "❌"}`
      );
      if (revertCount !== changes.length || reqAfter.status !== "CANCELED" || !restored) failed = true;
    } finally {
      for (const d of cleanupDocs) {
        await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
      }
      const { grids: gridsFinal } = await synthWeek(termId, week.id);
      console.log(`[7-9] 정리 완료 — 문서 ${cleanupDocs.length}건 삭제, 합성본 최초 상태 대조 ${gridSig(gridsFinal) === sig0 ? "✅" : "❌"}`);
    }
    return failed;
  };

  let failed = await runCycle("A", pickA);
  if (pickB) failed = (await runCycle("B", pickB)) || failed;
  failed = (await runTeacherCycle(pickA)) || failed;
  await bumpTimetableCacheVersion(D);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error("실패:", e.message); process.exit(1); });
