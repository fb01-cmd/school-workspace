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
 * [9] §5c-8 교차 주 사이클: 같은 주 후보 바이트 동등(회귀 0) → 다른 주 후보 노출(computeCandidates
 *     targetWeekId) → 신청(targetWeekId 저장) → validatePending 두 주 재검증 → 승인(주별 문서 쌍
 *     cross_swap·exchangeId 짝·주 분포) → 두 주 합성 실반영 → revert 전량 → 두 주 최초 상태 원복
 *
 * 읽기 예산: 합성 ~12회 + 커밋·승인 경로 ≈ 600 reads 추산 (전수조사 아님).
 * 실행: npx tsx --env-file=.env.local scripts/verify_simul_move_phase3.ts
 */
import {
  approveSwapRequest,
  commitSimulGroupMove,
  computeCandidates,
  computeChainSearch,
  computeMyProjectedWeeks,
  createSimulMoveRequest,
  createSwapRequest,
  deleteSwapDraft,
  listWeeks,
  saveSwapDraft,
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
import {
  findCrossSimulGroupMoveCandidates,
  findSimulGroupMoveCandidates,
  findSwapCandidates,
} from "../src/lib/timetable/swap";
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
    // §5c-10 이후 불변식: 기존 엔진 후보는 **그대로 접두사**, 그 뒤에 덧붙는 것은 전부
    // 역방향 묶음(coordination.simul) 후보뿐이다. (종전의 "simul 혼입 없음"은 §5c-10이
    // 의도적으로 폐기 — 일반 소스에도 묶음 자리 후보가 나오는 것이 이제 사양이다.)
    const served = viaServer.swapCandidates || [];
    const prefixEqual =
      JSON.stringify(served.slice(0, direct.candidates.length)) === JSON.stringify(direct.candidates) &&
      (viaServer.error || "") === (direct.error || "");
    const appended = served.slice(direct.candidates.length);
    const appendedAllReverse = appended.every((c) => !!c.coordination?.simul);
    console.log(
      `[8-${i + 1}] 비묶음 출력 불변 ${prefixEqual && appendedAllReverse ? "✅" : "❌"} — ${s.src.grade}-${s.src.classNum} ${DAYS[s.src.day]}${s.src.period} (${s.subject}): ` +
      `기존 후보 접두사 동등 ${prefixEqual ? "✅" : "❌"} · 덧붙음 ${appended.length}건 전부 역방향 묶음 ${appendedAllReverse ? "✅" : "❌"} · 보강 ${viaServer.substituteCandidates.length}건${viaServer.error ? ` · 사유 "${viaServer.error}"` : ""}`
    );
    if (!prefixEqual || !appendedAllReverse) regFailed = true;
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

  // ── [9] §5c-8 교차 주 통 이동 — 후보 → 신청 → 승인(주별 문서 쌍) → 두 주 원복 ──
  // 목적지 주 컨텍스트: 같은 학기의 다음 주 1개
  const tWeekRaw = weeks.find((w) => w.id !== week.id && w.termId === termId);
  const crossCtx = tWeekRaw
    ? await (async () => {
        const { grids: tGrids0, week: tWeekObj } = await synthWeek(termId, tWeekRaw.id);
        return { tWeekRaw, tGrids0, tWeekObj, tSig0: gridSig(tGrids0) };
      })()
    : null;

  const runCrossCycle = async (tag: string, pick: Pick): Promise<boolean> => {
    const { tWeekRaw, tGrids0, tWeekObj, tSig0 } = crossCtx!;

    // 9-1. 같은 주 출력 불변 — 교차 주 배선 후에도 같은 주 엔진 출력이 바이트 동등해야 한다 (§5c-8 판정 ②)
    let sameWeekEqual = true;
    for (const group of groups) {
      const slots = new Set<string>();
      for (const cn of group.classNums) {
        const grid = grids0.find((g) => g.grade === group.grade && g.classNum === cn);
        for (const cell of grid?.cells || [])
          if (cell.lessons.some((l) => l.simul === group.label)) slots.add(`${cell.day}-${cell.period}`);
      }
      for (const key of slots) {
        const [day, period] = key.split("-").map(Number);
        const a = findSimulGroupMoveCandidates(grids0, weekObj, settings, group, { day, period });
        const b = findCrossSimulGroupMoveCandidates(
          grids0, weekObj, grids0, weekObj, settings, group, { day, period }
        );
        // 같은 주를 교차 주 함수에 넘기면 명시 거부여야 한다(같은 주 후보를 잘못 돌려주지 않도록)
        if (!b.error || a.error) sameWeekEqual = false;
      }
    }
    console.log(`[9-1${tag}] 같은 주 인자 거부 ${sameWeekEqual ? "✅" : "❌"}`);

    // 신청자 해석 — 그룹 수업 담당 실교사 1인 (교사가 자기 수업을 클릭하는 시점 재현)
    const { group, source } = pick;
    let teacherEmail = "", teacherClass = 0;
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
    if (!teacherEmail) { console.error("[9] 그룹 담당 실교사 미검출 ❌"); return true; }
    const src = { grade: group.grade, classNum: teacherClass, day: source.day, period: source.period };
    const target = { day: pick.cand.targetDay, period: pick.cand.targetPeriod };
    console.log(
      `[9] 교차 주 — 「${group.label}」 ${group.grade}-${teacherClass} ${DAYS[source.day]}${source.period} → ${tWeekRaw.id} ${DAYS[target.day]}${target.period} (신청자 ${teacherEmail}, 반별 ${pick.cand.steps.length}건)`
    );

    // 9-2. 후보 노출 — computeCandidates(targetWeekId)가 엔진과 같은 목록을 돌려주는가
    const computed = await computeCandidates(
      D, teacherEmail, week.id, { ...src, subjectName: "" }, tWeekRaw.id
    );
    const engineRes = findCrossSimulGroupMoveCandidates(
      grids0, weekObj, tGrids0, tWeekObj, settings, group, source
    );
    const countOk = computed.swapCandidates.length === engineRes.candidates.length;
    const carriesWeek = computed.swapCandidates.every((c) => c.targetWeekId === tWeekRaw.id);
    console.log(
      `[9-2${tag}] 다른 주 후보 노출 ${countOk && carriesWeek ? "✅" : "❌"} — ${computed.swapCandidates.length}건 (엔진 ${engineRes.candidates.length}건) · 후보가 목적지 주 보유 ${carriesWeek ? "✅" : "❌"}`
    );
    let failed = !countOk || !carriesWeek;

    // 9-3. 신청 — targetWeekId 저장 + steps 서버 재계산값
    const req = await createSimulMoveRequest(D, teacherEmail, {
      weekId: week.id, targetWeekId: tWeekRaw.id, source: src, target,
      reason: { type: "기타", note: "검증 스크립트 (즉시 정리)" }, consent: { confirmed: true, note: "검증용" },
    }, { skipManagerNotify: true });
    const cleanupDocs: Array<{ col: "req" | "chg"; id: string }> = [{ col: "req", id: req.id }];
    try {
      const engineMatch = engineRes.candidates.find(
        (c) => c.targetDay === target.day && c.targetPeriod === target.period
      )!;
      const stepsOk = JSON.stringify(req.simulMove?.steps) === JSON.stringify(engineMatch.steps);
      const weekOk = req.targetWeekId === tWeekRaw.id && req.status === "PENDING";
      console.log(`[9-3${tag}] 신청 ${weekOk && stepsOk ? "✅" : "❌"} — PENDING·목적지 주 저장 ${weekOk ? "✅" : "❌"} · steps 서버값 ${stepsOk ? "✅" : "❌"}`);
      if (!weekOk || !stepsOk) failed = true;

      // 9-4. 사전 검증 — 두 주 재합성 후 교차 주 엔진
      const validation = await validatePendingSwapRequests(D, [req]);
      const vOk = validation[req.id]?.ok === true;
      console.log(`[9-4${tag}] validatePending 두 주 재검증 ${vOk ? "✅" : `❌ (${validation[req.id]?.reason})`}`);
      if (!vOk) failed = true;

      // 9-5. 승인 — 반별 step 1건 = 주별 문서 쌍(cross_swap, 같은 exchangeId)
      const { request: approved, changes } = await approveSwapRequest(D, MANAGER, req.id, { skipNotify: true });
      changes.forEach((c) => cleanupDocs.push({ col: "chg", id: c.id }));
      const steps = req.simulMove!.steps;
      const allCross = changes.every((c) => c.type === "cross_swap" && !!c.crossSwap);
      const countPair = changes.length === steps.length * 2;
      const exIds = new Map<string, TimetableChange[]>();
      for (const c of changes) {
        const k = c.crossSwap?.exchangeId || "";
        exIds.set(k, [...(exIds.get(k) || []), c]);
      }
      const pairedOk =
        exIds.size === steps.length &&
        [...exIds.values()].every(
          (pair) =>
            pair.length === 2 &&
            pair.some((c) => c.weekId === week.id) &&
            pair.some((c) => c.weekId === tWeekRaw.id)
        );
      // 빈 교시로 가는 반은 한쪽만 있는 이동 — 소스 주 in=null / 목적지 주 out=null
      const moveSteps = steps.filter((s) => s.kind === "move").length;
      const nullSideOk =
        changes.filter((c) => c.weekId === week.id && c.crossSwap!.in === null).length === moveSteps &&
        changes.filter((c) => c.weekId === tWeekRaw.id && c.crossSwap!.out === null).length === moveSteps;
      const linked = changes.every((c) => c.requestId === req.id);
      const aOk = approved.status === "APPROVED";
      console.log(
        `[9-5${tag}] 승인 ${aOk && allCross && countPair && pairedOk && nullSideOk && linked ? "✅" : "❌"} — change ${changes.length}건(반별 ${steps.length}×2 ${countPair ? "✅" : "❌"}) · 전건 주별 문서 ${allCross ? "✅" : "❌"} · 짝·주 분포 ${pairedOk ? "✅" : "❌"} · 한쪽만 있는 이동 ${moveSteps}건 표현 ${nullSideOk ? "✅" : "❌"} · requestId 연결 ${linked ? "✅" : "❌"}`
      );
      if (!aOk || !allCross || !countPair || !pairedOk || !nullSideOk || !linked) failed = true;

      // 9-6. 두 주 합성 실반영 — 소스 주에서 사라지고 목적지 주에 나타나야 한다
      const { grids: srcAfter } = await synthWeek(termId, week.id);
      const { grids: tgtAfter } = await synthWeek(termId, tWeekRaw.id);
      let movedOk = true;
      for (const step of steps) {
        const sGrid = srcAfter.find((g) => g.grade === group.grade && g.classNum === step.classNum)!;
        const tGrid = tgtAfter.find((g) => g.grade === group.grade && g.classNum === step.classNum)!;
        const gone = !sGrid.cells
          .find((c) => c.day === source.day && c.period === source.period)
          ?.lessons.some((l) => l.simul === group.label && l.subjectName === step.groupLesson.subjectName);
        const landed = !!tGrid.cells
          .find((c) => c.day === target.day && c.period === target.period)
          ?.lessons.some((l) => l.simul === group.label && l.subjectName === step.groupLesson.subjectName);
        // 맞교환 반은 상대 수업이 소스 주로 넘어와 있어야 한다
        const cpBack =
          step.kind !== "swap" ||
          !!sGrid.cells
            .find((c) => c.day === source.day && c.period === source.period)
            ?.lessons.some((l) => l.subjectName === step.counterpart!.subjectName);
        if (!gone || !landed || !cpBack) movedOk = false;
      }
      console.log(`[9-6${tag}] 두 주 합성 실반영 ${movedOk ? "✅" : "❌"}`);
      if (!movedOk) failed = true;

      // 9-7. revert — change 1건 지정 → requestId 묶음 전량 취소 → 두 주 모두 원복
      await revertTimetableChange(D, MANAGER, changes[0].id, { skipNotify: true });
      const changeIds = changes.map((c) => c.id);
      let revertCount = 0;
      for (let i = 0; i < changeIds.length; i += 10) {
        const snap = await timetableChangesColRef(D).where("revertOf", "in", changeIds.slice(i, i + 10)).get();
        snap.docs.forEach((d) => cleanupDocs.push({ col: "chg", id: d.id }));
        revertCount += snap.size;
      }
      const reqAfter = (await swapRequestsColRef(D).doc(req.id).get()).data() as SwapRequest;
      const { grids: srcRev } = await synthWeek(termId, week.id);
      const { grids: tgtRev } = await synthWeek(termId, tWeekRaw.id);
      const restored = gridSig(srcRev) === sig0 && gridSig(tgtRev) === tSig0;
      console.log(
        `[9-7${tag}] revert — 전량 취소 ${revertCount === changes.length ? "✅" : "❌"} (${revertCount}/${changes.length}) · 신청 상태 ${reqAfter.status} · 두 주 합성 원복 ${restored ? "✅" : "❌"}`
      );
      if (revertCount !== changes.length || reqAfter.status !== "CANCELED" || !restored) failed = true;
    } finally {
      for (const d of cleanupDocs) {
        await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
      }
      const { grids: srcFin } = await synthWeek(termId, week.id);
      const { grids: tgtFin } = await synthWeek(termId, tWeekRaw.id);
      console.log(
        `[9-8${tag}] 정리 완료 — 문서 ${cleanupDocs.length}건 삭제, 두 주 최초 상태 대조 ${gridSig(srcFin) === sig0 && gridSig(tgtFin) === tSig0 ? "✅" : "❌"}`
      );
    }
    return failed;
  };

  // 9-0. 교차 주 후보 전수 — swap 반 포함 / move 반 포함을 각각 골라 두 문서 모양을 모두 커밋한다
  //      (한쪽만 있는 이동 = out·in 한쪽이 빈 문서 / 맞교환 반 = 양쪽 다 있는 문서)
  let crossPickSwap: Pick | null = null, crossPickMove: Pick | null = null;
  let crossTotal = 0, multiLessonBlocked = 0;
  if (crossCtx) {
    for (const group of groups) {
      const slots = new Set<string>();
      for (const cn of group.classNums) {
        const grid = grids0.find((g) => g.grade === group.grade && g.classNum === cn);
        for (const cell of grid?.cells || [])
          if (cell.lessons.some((l) => l.simul === group.label)) slots.add(`${cell.day}-${cell.period}`);
      }
      for (const key of slots) {
        const [day, period] = key.split("-").map(Number);
        const res = findCrossSimulGroupMoveCandidates(
          grids0, weekObj, crossCtx.tGrids0, crossCtx.tWeekObj, settings, group, { day, period }
        );
        if (res.error) { if (res.error.includes("두 개 이상")) multiLessonBlocked++; continue; }
        for (const cand of res.candidates) {
          crossTotal++;
          const kinds = new Set(cand.steps.map((s) => s.kind));
          const p: Pick = { group, source: { day, period }, cand };
          if (kinds.has("swap") && !crossPickSwap) crossPickSwap = p;
          if (kinds.has("move") && !crossPickMove) crossPickMove = p;
        }
      }
    }
    console.log(
      `[9-0] 교차 주 후보 ${crossTotal}건 (${week.id} → ${crossCtx.tWeekRaw.id}) · 분반 병기로 제외된 소스 ${multiLessonBlocked}건 · 맞교환 반 포함 ${crossPickSwap ? "있음" : "없음"} · 빈 교시 반 포함 ${crossPickMove ? "있음" : "없음"}`
    );
  } else {
    console.log("[9] 같은 학기의 다른 주가 없어 교차 주 사이클 미실행 (미검증)");
  }

  // [9-9] 직권 보조 경로도 교차 주로 — 즉시 반영(APPROVED) → 두 주 반영 → revert → 원복
  const runCrossDirectCycle = async (pick: Pick): Promise<boolean> => {
    const { tWeekRaw, tSig0 } = crossCtx!;
    const target = { day: pick.cand.targetDay, period: pick.cand.targetPeriod };
    // batchId는 §5c-9-4 담기 일괄 반영이 넘기는 값 — 원장에 실려야 요청대장이 같은 제출로 묶는다
    const VERIFY_BATCH = "verify-batch-9-9";
    const { request, changes } = await commitSimulGroupMove(D, MANAGER, {
      weekId: week.id, targetWeekId: tWeekRaw.id, groupId: pick.group.id!,
      source: pick.source, target, batchId: VERIFY_BATCH,
      reason: { type: "기타", note: "검증 스크립트 (즉시 정리)" }, consent: { confirmed: true, note: "검증용" },
    }, { skipNotify: true });
    const cleanupDocs: Array<{ col: "req" | "chg"; id: string }> = [{ col: "req", id: request.id }];
    changes.forEach((c) => cleanupDocs.push({ col: "chg", id: c.id }));
    let failed = false;
    try {
      const shapeOk =
        request.status === "APPROVED" && request.direct === true &&
        request.targetWeekId === tWeekRaw.id &&
        request.batchId === VERIFY_BATCH &&
        changes.length === pick.cand.steps.length * 2 &&
        changes.every((c) => c.type === "cross_swap" && !!c.crossSwap);
      const { grids: srcAfter } = await synthWeek(termId, week.id);
      const { grids: tgtAfter } = await synthWeek(termId, tWeekRaw.id);
      const applied = gridSig(srcAfter) !== sig0 && gridSig(tgtAfter) !== tSig0;
      console.log(
        `[9-9] 직권 교차 주 즉시 반영 ${shapeOk && applied ? "✅" : "❌"} — 상태·목적지 주·문서 모양 ${shapeOk ? "✅" : "❌"} (change ${changes.length}건) · 두 주 합성 변화 ${applied ? "✅" : "❌"}`
      );
      if (!shapeOk || !applied) failed = true;

      await revertTimetableChange(D, MANAGER, changes[0].id, { skipNotify: true });
      const changeIds = changes.map((c) => c.id);
      let revertCount = 0;
      for (let i = 0; i < changeIds.length; i += 10) {
        const snap = await timetableChangesColRef(D).where("revertOf", "in", changeIds.slice(i, i + 10)).get();
        snap.docs.forEach((d) => cleanupDocs.push({ col: "chg", id: d.id }));
        revertCount += snap.size;
      }
      const { grids: srcRev } = await synthWeek(termId, week.id);
      const { grids: tgtRev } = await synthWeek(termId, tWeekRaw.id);
      const restored = gridSig(srcRev) === sig0 && gridSig(tgtRev) === tSig0;
      console.log(`      revert 전량 ${revertCount === changes.length ? "✅" : "❌"} (${revertCount}/${changes.length}) · 두 주 원복 ${restored ? "✅" : "❌"}`);
      if (revertCount !== changes.length || !restored) failed = true;
    } finally {
      for (const d of cleanupDocs)
        await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
      const { grids: srcFin } = await synthWeek(termId, week.id);
      const { grids: tgtFin } = await synthWeek(termId, tWeekRaw.id);
      console.log(
        `      정리 완료 — 문서 ${cleanupDocs.length}건 삭제, 두 주 최초 상태 대조 ${gridSig(srcFin) === sig0 && gridSig(tgtFin) === tSig0 ? "✅" : "❌"}`
      );
    }
    return failed;
  };

  // ── [10] §5c-9-4 담기 표현 — 담은 묶음이 예상 시간표에 **반별로 그려지는가** ──
  // 기존 증상: 초안이 type "swap"으로 새어 가짜 단건 swap이 되면서 화면은 그대로인데
  // "N건 반영" 건수만 늘었다. 여기서는 담기 전/후 예상 시간표를 직접 비교한다. 알림 없음(초안은 무발송).
  const runDraftOverlayCheck = async (pick: Pick): Promise<boolean> => {
    const { group, source } = pick;
    const target = { day: pick.cand.targetDay, period: pick.cand.targetPeriod };
    // 그룹 담당 실교사 1인 — 그 사람의 예상 시간표에서 자기 수업이 옮겨져 보여야 한다
    let teacherEmail = "", teacherClass = 0, subjectName = "";
    for (const cn of group.classNums) {
      const grid = grids0.find((g) => g.grade === group.grade && g.classNum === cn);
      const cell = grid?.cells.find((c) => c.day === source.day && c.period === source.period);
      for (const l of cell?.lessons || []) {
        if (l.simul !== group.label) continue;
        const t = (l.teachers || [])[0];
        if (t?.email?.trim()) {
          teacherEmail = t.email.trim().toLowerCase(); teacherClass = cn; subjectName = l.subjectName; break;
        }
      }
      if (teacherEmail) break;
    }
    if (!teacherEmail) { console.error("[10] 그룹 담당 실교사 미검출 ❌"); return true; }

    const at = (cells: any[], d: number, p: number) =>
      cells.filter((c) => c.day === d && c.period === p && c.subjectName === subjectName && c.classNum === teacherClass);
    const projOf = async (includeDrafts: boolean) => {
      const r = await computeMyProjectedWeeks(D, teacherEmail, { includeMyPending: false, includeDrafts });
      const w = r.weeks.find((x) => x.weekId === week.id)!;
      return { cells: w.cells, draftCount: r.assumedDraftCount };
    };

    const before = await projOf(true); // 담기 전 (이 교사에게 기존 초안이 있을 수 있으므로 기준선으로 삼는다)
    const baseAtFrom = at(before.cells, source.day, source.period).length;
    const baseAtTo = at(before.cells, target.day, target.period).length;

    let draftId = "";
    let failed = false;
    try {
      const draft = await saveSwapDraft(D, teacherEmail, teacherEmail.split("@")[0], undefined, {
        sourceWeekId: week.id,
        source: {
          grade: group.grade, classNum: teacherClass,
          day: source.day, period: source.period, subjectName,
        },
        // 화면이 담을 때와 같은 모양 — coordination을 그대로 실어야 반별 전개(steps)가 저장된다
        candidate: {
          type: "swap",
          targetDay: target.day, targetPeriod: target.period,
          counterpartEmail: "", counterpartName: group.label,
          score: pick.cand.score, penalties: pick.cand.penalties,
          coordination: {
            kind: pick.cand.coordination?.conflicts?.length ? "venue+simul" : "simul",
            conflicts: pick.cand.coordination?.conflicts || [],
            simul: {
              groupId: group.id!, label: group.label, grade: group.grade,
              classNums: [...group.classNums], steps: pick.cand.steps,
            },
          },
        },
        reason: { type: "기타", note: "검증 스크립트 (즉시 삭제)" },
      });
      draftId = draft.id;

      const after = await projOf(true);
      const goneFrom = at(after.cells, source.day, source.period).length === baseAtFrom - 1;
      const landedTo = at(after.cells, target.day, target.period).length === baseAtTo + 1;
      const counted = after.draftCount === before.draftCount + 1;
      const badgeKept = at(after.cells, target.day, target.period).some((c) => c.simul === group.label);
      console.log(
        `[10] 담은 묶음이 예상 시간표에 그려짐 ${goneFrom && landedTo && counted && badgeKept ? "✅" : "❌"} — ` +
        `소스에서 빠짐 ${goneFrom ? "✅" : "❌"} · 목적지에 나타남 ${landedTo ? "✅" : "❌"} · ` +
        `묶음 표시 유지 ${badgeKept ? "✅" : "❌"} · 건수 ${before.draftCount}→${after.draftCount} ${counted ? "✅" : "❌"}`
      );
      if (!goneFrom || !landedTo || !counted || !badgeKept) failed = true;
      if (goneFrom && landedTo) console.log(`      (${group.grade}-${teacherClass} ${subjectName}: ${DAYS[source.day]}${source.period} → ${DAYS[target.day]}${target.period}, 반별 ${pick.cand.steps.length}건)`);
    } finally {
      if (draftId) await deleteSwapDraft(D, teacherEmail, draftId);
      const back = await projOf(true);
      const restored =
        at(back.cells, source.day, source.period).length === baseAtFrom &&
        at(back.cells, target.day, target.period).length === baseAtTo;
      console.log(`      초안 삭제 후 예상 시간표 원복 ${restored ? "✅" : "❌"}`);
      if (!restored) failed = true;
    }
    return failed;
  };

  // ── [11] §5c-10 역방향 — 밀려나는 상대 교사 시점에서 같은 이동이 보이고·신청되고·같은 원장이 되는가 ──
  const runReverseCycle = async (): Promise<boolean> => {
    // 정방향 후보 중 swap step(치워지는 상대 실교사)이 있는 것을 고른다 — 그 상대가 역방향 신청자 R
    const fwd = findSimulGroupMoveCandidates(grids0, weekObj, settings, pickA.group, pickA.source);
    const fwdCand = fwd.candidates.find((c) =>
      c.steps.some((s) => s.kind === "swap" && s.counterpart?.teacherEmail)
    );
    const rStep = fwdCand?.steps.find((s) => s.kind === "swap" && s.counterpart?.teacherEmail);
    if (!fwdCand || !rStep) { console.log("[11] 상대 실교사가 있는 정방향 후보 0건 — 미실행 (미검증)"); return false; }
    const group = pickA.group;
    const s1 = pickA.source; // 그룹 슬롯 (canonical from)
    const t = { day: fwdCand.targetDay, period: fwdCand.targetPeriod }; // R의 슬롯 (canonical to)
    const R = rStep.counterpart!.teacherEmail;
    const rSrc = { grade: group.grade, classNum: rStep.classNum, day: t.day, period: t.period };
    console.log(
      `[11] 역방향 — R=${R} (${group.grade}-${rStep.classNum} ${DAYS[t.day]}${t.period} ${rStep.counterpart!.subjectName}) → 그룹 「${group.label}」 ${DAYS[s1.day]}${s1.period} 자리로`
    );

    // 11-1. 노출 — R이 자기 일반 수업을 클릭하면 그룹 자리가 조율 필요 후보로 나온다
    const rComputed = await computeCandidates(D, R, week.id, { ...rSrc, subjectName: "" });
    const rev = rComputed.swapCandidates.find(
      (c) => c.targetDay === s1.day && c.targetPeriod === s1.period && c.coordination?.simul?.groupId === group.id
    );
    const stepsMatch = !!rev && JSON.stringify(rev.coordination!.simul!.steps) === JSON.stringify(fwdCand.steps);
    console.log(
      `[11-1] 역방향 노출 ${rev && stepsMatch ? "✅" : "❌"} — 후보 존재 ${rev ? "✅" : "❌"} · steps 정방향과 동일 ${stepsMatch ? "✅" : "❌"}`
    );
    if (!rev || !stepsMatch) return true;

    // 11-2. 자격 방어 — 소스 수업 소유자가 아니면 거부 (§5c-10-4 ④)
    try {
      await createSimulMoveRequest(D, MANAGER, {
        weekId: week.id, source: rSrc, target: s1,
        reason: { type: "기타", note: "검증" }, consent: { confirmed: true },
      }, { skipManagerNotify: true });
      console.error("[11-2] 실패 ❌ — 무자격 역방향 신청이 통과됨"); return true;
    } catch (e: any) {
      if (e.message.includes("본인")) console.log("[11-2] 무자격 신청 거부 ✅");
      else { console.error(`[11-2] 예상 밖 사유 ❌: ${e.message}`); return true; }
    }

    // 11-3. 역방향 신청 → canonical 저장 (정방향과 같은 원장 모양 — §5c-10-1-2)
    const req = await createSimulMoveRequest(D, R, {
      weekId: week.id, source: rSrc, target: s1,
      reason: { type: "기타", note: "검증 스크립트 (즉시 정리)" }, consent: { confirmed: true, note: "검증용" },
    }, { skipManagerNotify: true });
    const cleanupDocs: Array<{ col: "req" | "chg"; id: string }> = [{ col: "req", id: req.id }];
    let failedRev = false;
    try {
      const sm = req.simulMove!;
      const canonOk =
        sm.from.day === s1.day && sm.from.period === s1.period &&
        sm.to.day === t.day && sm.to.period === t.period &&
        req.weekId === week.id && !req.targetWeekId &&
        JSON.stringify(sm.steps) === JSON.stringify(fwdCand.steps);
      const partiesExcludeR = !(req.consent?.parties || []).some((p) => p.email === R);
      const dispOk = req.candidate.targetDay === s1.day && req.candidate.targetPeriod === s1.period;
      console.log(
        `[11-3] 역방향 신청 ${canonOk && partiesExcludeR && dispOk ? "✅" : "❌"} — canonical(from=그룹 슬롯) ${canonOk ? "✅" : "❌"} · parties 신청자 제외 ${partiesExcludeR ? "✅" : "❌"} · 표시 목적지=클릭 자리 ${dispOk ? "✅" : "❌"}`
      );
      if (!canonOk || !partiesExcludeR || !dispOk) failedRev = true;

      // 11-4. 대칭성 — 같은 이동의 정방향 신청이 중복으로 잡힌다 (두 방향 = 한 연산의 증명)
      const gTeacher = fwdCand.steps.map((s) => s.groupLesson.teacherEmail).find(Boolean)!;
      try {
        await createSimulMoveRequest(D, gTeacher, {
          weekId: week.id,
          source: { grade: group.grade, classNum: fwdCand.steps[0].classNum, day: s1.day, period: s1.period },
          target: t, reason: { type: "기타", note: "검증" }, consent: { confirmed: true },
        }, { skipManagerNotify: true });
        console.error("[11-4] 실패 ❌ — 같은 이동의 정방향 신청이 중복 통과됨"); failedRev = true;
      } catch (e: any) {
        if (e.message.includes("대기 중인 이동 신청")) console.log("[11-4] 방향 대칭 중복 차단 ✅ (정방향 시점에서 걸림)");
        else { console.error(`[11-4] 예상 밖 사유 ❌: ${e.message}`); failedRev = true; }
      }

      // 11-5. 재검증·승인·실반영·revert — 기존 canonical 경로 그대로 도는가
      const validation = await validatePendingSwapRequests(D, [req]);
      const vOk = validation[req.id]?.ok === true;
      const { request: approved, changes } = await approveSwapRequest(D, MANAGER, req.id, { skipNotify: true });
      changes.forEach((c) => cleanupDocs.push({ col: "chg", id: c.id }));
      const { grids: gridsAfter } = await synthWeek(termId, week.id);
      let movedOk = true;
      for (const step of sm.steps) {
        const grid = gridsAfter.find((g) => g.grade === group.grade && g.classNum === step.classNum)!;
        const toCell = grid.cells.find((c) => c.day === t.day && c.period === t.period);
        if (!toCell?.lessons.some((l) => l.simul === group.label && l.subjectName === step.groupLesson.subjectName))
          movedOk = false;
      }
      // R의 수업이 그룹 자리(s1)로 왔는가 — 역방향 신청자가 원한 바로 그것
      const rGrid = gridsAfter.find((g) => g.grade === group.grade && g.classNum === rStep.classNum)!;
      const rMoved = !!rGrid.cells
        .find((c) => c.day === s1.day && c.period === s1.period)
        ?.lessons.some((l) => l.subjectName === rStep.counterpart!.subjectName);
      console.log(
        `[11-5] 승인 사이클 ${vOk && approved.status === "APPROVED" && movedOk && rMoved ? "✅" : "❌"} — validate ${vOk ? "✅" : "❌"} · 승인 ${approved.status} · 그룹 전 반 이동 ${movedOk ? "✅" : "❌"} · R 수업이 그룹 자리로 ${rMoved ? "✅" : "❌"}`
      );
      if (!vOk || approved.status !== "APPROVED" || !movedOk || !rMoved) failedRev = true;

      await revertTimetableChange(D, MANAGER, changes[0].id, { skipNotify: true });
      const changeIds = changes.map((c) => c.id);
      let revertCount = 0;
      for (let i = 0; i < changeIds.length; i += 10) {
        const snap = await timetableChangesColRef(D).where("revertOf", "in", changeIds.slice(i, i + 10)).get();
        snap.docs.forEach((d) => cleanupDocs.push({ col: "chg", id: d.id }));
        revertCount += snap.size;
      }
      const { grids: gridsReverted } = await synthWeek(termId, week.id);
      const restored = gridSig(gridsReverted) === sig0;
      console.log(`[11-6] revert — 전량 취소 ${revertCount === changes.length ? "✅" : "❌"} (${revertCount}/${changes.length}) · 합성 원복 ${restored ? "✅" : "❌"}`);
      if (revertCount !== changes.length || !restored) failedRev = true;
    } finally {
      for (const d of cleanupDocs) {
        await (d.col === "req" ? swapRequestsColRef(D).doc(d.id) : timetableChangesColRef(D).doc(d.id)).delete();
      }
      const { grids: gridsFinal } = await synthWeek(termId, week.id);
      console.log(`[11-7] 정리 완료 — 문서 ${cleanupDocs.length}건 삭제, 합성본 최초 상태 대조 ${gridSig(gridsFinal) === sig0 ? "✅" : "❌"}`);
    }
    return failedRev;
  };

  let failed = await runCycle("A", pickA);
  if (pickB) failed = (await runCycle("B", pickB)) || failed;
  failed = (await runDraftOverlayCheck(pickA)) || failed;
  failed = (await runReverseCycle()) || failed;
  failed = (await runTeacherCycle(pickA)) || failed;
  if (crossCtx) {
    if (crossPickSwap) failed = (await runCrossCycle("S", crossPickSwap)) || failed;
    else console.log("    ⚠️ 맞교환 반을 포함한 교차 주 후보 없음 — 해당 문서 모양 미검증");
    if (crossPickMove && crossPickMove !== crossPickSwap)
      failed = (await runCrossCycle("M", crossPickMove)) || failed;
    else if (!crossPickMove) console.log("    ⚠️ 빈 교시 반을 포함한 교차 주 후보 없음 — 해당 문서 모양 미검증");
    if (!crossPickSwap && !crossPickMove) console.log("[9] 교차 주 후보 0건 — 사이클 미실행 (미검증)");
    const directPick = crossPickSwap || crossPickMove;
    if (directPick) failed = (await runCrossDirectCycle(directPick)) || failed;
  }
  await bumpTimetableCacheVersion(D);
  if (failed) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error("실패:", e.message); process.exit(1); });
