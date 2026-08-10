/**
 * 양해 기반 교체 개방 Phase 1 검증 (consent_swap_opening_spec §2·§3) — 읽기 위주,
 * 마지막 단계만 swap_requests에 검증용 문서 1건 생성 후 즉시 삭제 (알림 스킵).
 *
 * [1] 엔진 출력 불변: 옵션 꺼짐 결과 == 옵션 켠 결과에서 coordination 후보 제거한 것 (JSON 대조)
 * [2] 조율 필요 후보 산출: 특별실(room) 수업 소스에서 coordination 후보·occupants 실측
 * [3] create 거부: coordination 후보를 consent 없이 신청 → 400성 오류 (문서 생성 전 차단)
 * [4] create 통과: consent.confirmed로 신청 → 원장 consent.parties 서버 도출 확인 → 즉시 삭제
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_consent_swap.ts
 */
import {
  createSwapRequest,
  listWeeks,
  loadBaseGridsByWeek,
  loadTimetableSettings,
  loadWeekChanges,
  swapRequestsColRef,
} from "../src/lib/timetable/server";
import { synthesizeWeeklyGrids } from "../src/lib/timetable/weekly";
import { findSwapCandidates } from "../src/lib/timetable/swap";
import { SwapCandidate, SwapSourceSlot, WeeklyClassGrid } from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";

const stripCoord = (cands: SwapCandidate[]) => cands.filter((c) => !c.coordination);
const key = (c: SwapCandidate) => `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail}`;

async function main() {
  const settings = await loadTimetableSettings(DOMAIN);
  if (!settings.activeTermId) throw new Error("활성 학기 없음");
  const weeks = (await listWeeks(DOMAIN, settings.activeTermId)).sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );
  if (weeks.length === 0) throw new Error("등록된 주 없음");
  const week = weeks[0];
  console.log(`대상 주: ${week.id} (${week.startDate}) / 학기 ${settings.activeTermId}`);

  const baseByWeek = await loadBaseGridsByWeek(DOMAIN, settings.activeTermId, [week.startDate]);
  const changes = await loadWeekChanges(DOMAIN, week.id);
  const { grids } = synthesizeWeeklyGrids(baseByWeek.get(week.startDate)!, week, changes, settings);

  // 특별실(room) 수업 소스 수집 — 단일 교사·단일 lesson·simul 아님
  const sources: Array<{ src: SwapSourceSlot; email: string; room: string }> = [];
  for (const g of grids as WeeklyClassGrid[]) {
    for (const cell of g.cells) {
      if (cell.lessons.length !== 1) continue;
      const l = cell.lessons[0];
      if (!l.room || l.simul || (l.teachers || []).length !== 1) continue;
      const email = (l.teachers[0].email || "").trim().toLowerCase();
      if (!email) continue;
      sources.push({
        src: { grade: g.grade, classNum: g.classNum, day: cell.day, period: cell.period, subjectName: l.subjectName },
        email,
        room: l.room,
      });
    }
  }
  console.log(`특별실 수업 소스 후보: ${sources.length}건`);
  if (sources.length === 0) throw new Error("특별실 수업이 없어 검증 불가");

  // [1]+[2] 전 소스에 대해 불변성 검사, coordination 후보 통계
  let coordTotal = 0;
  let mismatch = 0;
  let example: { src: SwapSourceSlot; cand: SwapCandidate } | null = null;
  for (const s of sources) {
    const off = findSwapCandidates(grids, week, settings, s.email, s.src);
    const on = findSwapCandidates(grids, week, settings, s.email, s.src, { includeCoordination: true });
    if (off.error || on.error) {
      if (off.error !== on.error) { mismatch++; console.error(`오류 불일치: ${s.src.grade}-${s.src.classNum} ${s.src.day}/${s.src.period}`); }
      continue;
    }
    const onClean = stripCoord(on.candidates);
    if (JSON.stringify(off.candidates) !== JSON.stringify(onClean)) {
      mismatch++;
      console.error(`[1] 불변성 위반: ${s.src.grade}-${s.src.classNum} ${s.src.day}요일 ${s.src.period}교시 (off ${off.candidates.length} vs on-clean ${onClean.length})`);
    }
    // 정렬 검증: 조율 후보는 항상 깨끗한 후보 뒤
    const firstCoord = on.candidates.findIndex((c) => !!c.coordination);
    if (firstCoord >= 0 && on.candidates.slice(firstCoord).some((c) => !c.coordination)) {
      mismatch++;
      console.error(`[1] 정렬 위반(조율 후보 뒤에 깨끗한 후보): ${s.src.grade}-${s.src.classNum}`);
    }
    const coords = on.candidates.filter((c) => c.coordination);
    coordTotal += coords.length;
    if (!example && coords.length) example = { src: s.src, cand: coords[0] };
  }
  console.log(`[1] 엔진 출력 불변 검사: ${mismatch === 0 ? "통과 ✅" : `위반 ${mismatch}건 ❌`}`);
  console.log(`[2] 조율 필요 후보 총 ${coordTotal}건 (소스 ${sources.length}건 전수)`);
  if (example) {
    const c = example.cand;
    console.log(
      `    예시: ${example.src.grade}-${example.src.classNum} ${example.src.subjectName} ${example.src.day}/${example.src.period} → ` +
      `${c.targetDay}/${c.targetPeriod} (상대 ${c.counterpartName}) 충돌 ${c.coordination!.conflicts
        .map((f) => `${f.roomName}@${f.slot.day}/${f.slot.period} 점유 ${f.occupants.map((o) => `${o.grade}-${o.classNum} ${o.subjectName}(${o.teacherName})`).join("·")}`)
        .join(" | ")}`
    );
  }
  if (mismatch > 0) process.exit(1);
  if (!example) {
    console.log("[3][4] 조율 필요 후보가 0건이라 create 검증 생략 (엔진 불변성은 통과)");
    return;
  }

  // [3] consent 없이 신청 → 거부 (문서 생성 전 throw — 쓰기 0)
  const ex = example;
  const candPayload = { targetDay: ex.cand.targetDay, targetPeriod: ex.cand.targetPeriod, counterpartEmail: ex.cand.counterpartEmail, counterpartName: ex.cand.counterpartName, score: ex.cand.score, penalties: ex.cand.penalties };
  const srcEmail = sources.find((s) => s.src.grade === ex.src.grade && s.src.classNum === ex.src.classNum && s.src.day === ex.src.day && s.src.period === ex.src.period)!.email;
  try {
    await createSwapRequest(DOMAIN, srcEmail, {
      weekId: week.id, type: "swap", source: ex.src, candidate: candPayload, reason: { type: "기타", note: "검증" },
    }, { skipManagerNotify: true });
    console.error("[3] 실패 ❌ — consent 없이 신청이 통과됨");
    process.exit(1);
  } catch (e: any) {
    if (e.message.includes("양해")) console.log(`[3] consent 없는 신청 거부 통과 ✅ ("${e.message}")`);
    else { console.error(`[3] 예상 밖 오류 ❌: ${e.message}`); process.exit(1); }
  }

  // [4] consent 포함 신청 → parties 서버 도출 확인 → 즉시 삭제
  const req = await createSwapRequest(DOMAIN, srcEmail, {
    weekId: week.id, type: "swap", source: ex.src, candidate: candPayload,
    reason: { type: "기타", note: "검증 스크립트 (즉시 삭제)" },
    consent: { confirmed: true, note: "검증용" },
  }, { skipManagerNotify: true });
  try {
    const expected = new Set(ex.cand.coordination!.conflicts.flatMap((f) => f.occupants.map((o) => o.teacherEmail)));
    const got = new Set((req.consent?.parties || []).map((p) => p.email));
    const same = expected.size === got.size && [...expected].every((e) => got.has(e));
    console.log(`[4] consent 기록: confirmed=${req.consent?.confirmed}, parties=${[...got].join(",")} — 서버 도출 ${same ? "일치 ✅" : "불일치 ❌"}`);
    console.log(`    스냅샷 coordination 보존: ${req.candidate.coordination ? "✅" : "❌"}`);
    if (!same || !req.candidate.coordination) process.exit(1);
  } finally {
    await swapRequestsColRef(DOMAIN).doc(req.id).delete();
    console.log(`    검증 문서 삭제 완료 (${req.id})`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("실패:", e.message); process.exit(1); });
