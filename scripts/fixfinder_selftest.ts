/**
 * F-2 해결안 탐색기 자가 테스트 (timetable_fix_assist_spec.md §6)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/fixfinder_selftest.ts
 *
 * 읽기 전용 (Firestore 쓰기 0건). 읽기량 ≈ 90건 — fixfinder_cost_probe.ts와 동일.
 *
 * 검증 3종:
 *  ① 반환된 안이 **신규 하드 0**인가 — 엔진 내부가 아니라 스크립트가 직접 op을 적용해 재검사한다.
 *  ② 카드에 적을 점수(newSoftTotal·deltaScore·resolvesTarget)가 **실제 적용 결과와 정확히 일치**하는가.
 *     (엔진과 화면이 다른 값을 말하면 신뢰가 무너진다 — §6)
 *  ③ 사전 걸러내기(isDoomed)가 **좋은 안을 삼키지 않는가** — 걸러내기를 끄고 전수 평가한 결과와
 *     기본 실행 결과가 동일한지 대조한다. 이 설계에서 유일하게 위험한 최적화라 등가성을 증명한다.
 *
 * 아울러 §2-4 비용 판정에 쓸 실제 소요(감점 항목 1건당 탐색 시간)를 함께 잰다.
 */
import {
  getDraft,
  listDrafts,
  loadActiveTerm,
  loadCoTeachingRules,
  loadConsecutiveRules,
  loadSimulGroups,
  loadTeacherSlotBans,
  loadTimetableSettings,
  loadVenueGroups,
} from "../src/lib/timetable/server";
import { findFixCandidates, FixCandidate } from "../src/lib/timetable/fixFinder";
import { applyRevisionOps, cloneClassGrids } from "../src/lib/timetable/utils";
import {
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  diffNewHardViolations,
  validateTimetable,
} from "../src/lib/timetable/validate";
import {
  BaseRevisionOp,
  TermPenaltyDetail,
  TimetableConstraintModel,
} from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";
const detailKey = (d: TermPenaltyDetail) => `${d.code}|${d.scope}|${d.key}|${d.day}`;

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, extra?: string) {
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`    ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const settings = await loadTimetableSettings(DOMAIN);
  const term = await loadActiveTerm(DOMAIN);
  if (!term) throw new Error("활성 학기가 없습니다.");
  const drafts = await listDrafts(DOMAIN);
  if (!drafts.length) throw new Error("초안이 없습니다.");
  const meta0 = drafts[0];
  if (!meta0.id) throw new Error("초안 id가 없습니다.");
  const termId = meta0.sourceTermId || term.id;

  const [draft, simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
    await Promise.all([
      getDraft(DOMAIN, meta0.id),
      loadSimulGroups(DOMAIN, termId),
      loadVenueGroups(DOMAIN, termId),
      loadTeacherSlotBans(DOMAIN, termId),
      loadConsecutiveRules(DOMAIN, termId),
      loadCoTeachingRules(DOMAIN, termId),
    ]);

  const baseGrids = draft.baseGrids;
  const ops: BaseRevisionOp[] = draft.meta.ops.slice(0, draft.meta.opCursor);
  const hours =
    draft.hours && draft.hours.length > 0
      ? draft.hours
      : draft.meta.hoursSnapshot && draft.meta.hoursSnapshot.length > 0
        ? draft.meta.hoursSnapshot
        : deriveHoursFromGrids(baseGrids);
  const model: TimetableConstraintModel = {
    lunchAfterPeriod: settings.lunchAfterPeriod,
    periodsPerDay: settings.periodsPerDay,
    gradeDayPeriods: deriveGradeDayPeriods(baseGrids),
    hours,
    simulGroups,
    venueGroups,
    teacherSlotBans,
    fixedBlocks: [],
    consecutiveRules,
    coTeaching,
  };

  const currentGrids = cloneClassGrids(baseGrids);
  applyRevisionOps(currentGrids, ops);
  const report = validateTimetable(currentGrids, model);
  console.log(`초안: "${draft.meta.label}" — ${baseGrids.length}학급, ops ${ops.length}건`);
  console.log(
    `기준: 하드 ${report.hard.length}건 / 소프트 ${report.soft.total}점, 감점 상세 ${report.soft.details.length}건\n`
  );

  // 감점 상세 **전부**를 돈다. 일부만 표본으로 뽑으면 "안이 0건인 항목"만 걸려
  // 검증할 안이 없는 채로 통과해 버린다(2026-08-12 실제로 겪음 — 공허한 통과).
  const targets = report.soft.details;
  console.log(`검증 대상 감점 ${targets.length}건 (전수)\n`);

  const timings: number[] = [];
  let withCandidates = 0;

  for (const target of targets) {
    const t0 = performance.now();
    const found = findFixCandidates({ baseGrids, ops, currentGrids, model, target });
    const ms = performance.now() - t0;
    timings.push(ms);
    if (!found.length) continue;
    withCandidates++;
    console.log(`── [${target.code}] ${target.text} (−${target.points}점)`);
    console.log(`    탐색 ${ms.toFixed(0)}ms → 안 ${found.length}건`);

    // ①② 각 안을 스크립트가 직접 적용해 재검사 — 엔진이 예고한 값과 대조
    for (const c of found) {
      const g = cloneClassGrids(baseGrids);
      applyRevisionOps(g, [...ops, c.op]);
      const rep = validateTimetable(g, model);
      const newHards = diffNewHardViolations(report.hard, rep.hard);

      check(newHards.length === 0, `${c.desc}: 신규 하드`, newHards.map((h) => `[${h.code}] ${h.text}`).join(" / "));
      check(
        rep.soft.total === c.newSoftTotal,
        `${c.desc}: 점수 불일치`,
        `엔진 ${c.newSoftTotal} vs 실제 ${rep.soft.total}`
      );
      check(
        c.deltaScore === c.newSoftTotal - c.oldSoftTotal,
        `${c.desc}: 델타 불일치`,
        `${c.deltaScore} vs ${c.newSoftTotal - c.oldSoftTotal}`
      );
      check(c.deltaScore < 0, `${c.desc}: 개선이 아닌 안이 반환됨`, `델타 ${c.deltaScore}`);
      // 해소 판정은 건수 비교 — detailKey는 S2·S4에서 중복될 수 있다
      const cnt = (ds: TermPenaltyDetail[]) => ds.filter((d) => detailKey(d) === detailKey(target)).length;
      const resolved = cnt(rep.soft.details) < cnt(report.soft.details);
      check(
        c.resolvesTarget === resolved,
        `${c.desc}: resolvesTarget 오기재`,
        `엔진 ${c.resolvesTarget} vs 실제 ${resolved}`
      );

      console.log(
        `      ${c.resolvesTarget ? "✅해소" : "🔽완화"} ${c.oldSoftTotal}→${c.newSoftTotal}점 (${c.deltaScore}) ${c.desc}` +
          (c.sideEffects.length ? `\n         ↳ 부작용: ${c.sideEffects.join(" / ")}` : "")
      );
    }
  }

  console.log(`\n안이 나온 항목 ${withCandidates} / ${targets.length}건`);
  check(withCandidates > 0, "전 항목에서 안이 0건 — 검증할 대상이 없어 통과가 공허하다");

  // ③ 사전 걸러내기 등가성 — 실제로 안이 나오는 항목으로 전수 대조 (0건짜리로 대조하면 의미가 없다)
  const heaviest =
    targets.find((t) => findFixCandidates({ baseGrids, ops, currentGrids, model, target: t }).length > 0) ||
    targets[0];
  console.log(`\n── ③ 사전 걸러내기 등가성 대조 — [${heaviest.code}] ${heaviest.text}`);
  const tf0 = performance.now();
  const filtered = findFixCandidates({
    baseGrids, ops, currentGrids, model, target: heaviest, maxCandidates: 5000, maxResults: 50,
  });
  const tFiltered = performance.now() - tf0;
  const tb0 = performance.now();
  const brute = findFixCandidates({
    baseGrids, ops, currentGrids, model, target: heaviest,
    maxCandidates: 5000, maxResults: 50, includeDoomed: true,
  });
  const tBrute = performance.now() - tb0;

  const sig = (c: FixCandidate) => `${c.desc}|${c.newSoftTotal}`;
  const fSet = new Set(filtered.map(sig));
  const missed = brute.filter((c) => !fSet.has(sig(c)));
  console.log(
    `    걸러내기 적용 ${filtered.length}건 (${tFiltered.toFixed(0)}ms) vs 전수 ${brute.length}건 (${tBrute.toFixed(0)}ms)`
  );
  check(missed.length === 0, "걸러내기가 좋은 안을 삼킴", missed.map(sig).join(" / "));
  if (missed.length === 0)
    console.log(`    ✅ 전수 결과와 동일 — 걸러내기는 검사기가 어차피 버릴 안만 지운다 (속도 ${(tBrute / Math.max(tFiltered, 0.01)).toFixed(1)}배)`);

  console.log("\n══ 비용 (감점 1건 탐색, §2-4) ══");
  const sorted = [...timings].sort((a, b) => a - b);
  console.log(
    `  최소 ${sorted[0].toFixed(0)}ms / 중앙 ${sorted[Math.floor(sorted.length / 2)].toFixed(0)}ms / 최대 ${sorted[sorted.length - 1].toFixed(0)}ms`
  );

  console.log(`\n══ 결과 ══\n  통과 ${pass} / 실패 ${fail}`);
  if (fail > 0) process.exit(1);
  console.log("  ✅ 전항목 통과");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
