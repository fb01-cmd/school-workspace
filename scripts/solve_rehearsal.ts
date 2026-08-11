/**
 * Phase 9c-C 재현 실험 (phase9c_spec §9의 10월 항목 선행) — 역산 시수표로 재생성 →
 * 검사기 하드 0 + 소프트 점수를 컴시간 기준선(39점)과 비교.
 *
 * 사용법: npx tsx --env-file=.env.local scripts/solve_rehearsal.ts [seed]
 *
 * 읽기 전용 (Firestore 쓰기 0건). 흐름:
 *   현행 2026-2 그리드 로드 → 섹션 컴파일(역산) → 솔버 실행(시드 고정) →
 *   validateTimetable 관문 → 하드/소프트/미배정 리포트 + 결정론 확인(같은 시드 재실행 대조).
 */
import {
  loadActiveTerm,
  loadAllClassGrids,
  loadSimulGroups,
  loadTimetableSettings,
  loadVenueGroups,
  loadTeacherSlotBans,
  loadConsecutiveRules,
  loadCoTeachingRules,
} from "../src/lib/timetable/server";
import {
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  validateTimetable,
} from "../src/lib/timetable/validate";
import { compileSectionsFromGrids, solveTimetable } from "../src/lib/timetable/solver";
import { TimetableConstraintModel } from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";
const SEED = Number(process.argv[2]) || 42;

function hashOf(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

async function main() {
  const settings = await loadTimetableSettings(DOMAIN);
  const term = await loadActiveTerm(DOMAIN);
  if (!term) throw new Error("활성 학기가 없습니다.");
  const [grids, simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
    await Promise.all([
      loadAllClassGrids(DOMAIN, term.id),
      loadSimulGroups(DOMAIN, term.id),
      loadVenueGroups(DOMAIN, term.id),
      loadTeacherSlotBans(DOMAIN, term.id),
      loadConsecutiveRules(DOMAIN, term.id),
      loadCoTeachingRules(DOMAIN, term.id),
    ]);
  console.log(
    `학기 ${term.id} / 그리드 ${grids.length}학급 / 등록부: 동시 ${simulGroups.length}·특별실 ${venueGroups.length}·금지 ${teacherSlotBans.length}·연속 ${consecutiveRules.length}·복수 ${coTeaching.length}`
  );

  const model: TimetableConstraintModel = {
    lunchAfterPeriod: settings.lunchAfterPeriod,
    periodsPerDay: settings.periodsPerDay,
    gradeDayPeriods: deriveGradeDayPeriods(grids),
    hours: deriveHoursFromGrids(grids),
    simulGroups,
    venueGroups,
    teacherSlotBans,
    consecutiveRules,
    coTeaching,
    fixedBlocks: [],
  };

  // 기준선: 현행 그리드의 소프트 점수 (검사기 재실행 — 하드 0 재확인 포함)
  const baseline = validateTimetable(grids, model);
  console.log(
    `기준선(현행): 하드 ${baseline.hard.length} / 소프트 ${baseline.soft.total}점`
  );

  const sections = compileSectionsFromGrids(grids, model);
  const occTotal = sections.reduce((s, x) => s + x.blockLens.length, 0);
  const fixedCount = sections.filter((s) => s.kind === "fixed").length;
  const simulCount = sections.filter((s) => s.kind === "simul").length;
  console.log(
    `섹션 컴파일: 총 ${sections.length} (고정 ${fixedCount}·동시수업 ${simulCount}·일반 ${sections.length - fixedCount - simulCount}) / 배치 회차 ${occTotal}`
  );

  const t0 = Date.now();
  const result = solveTimetable({
    sections,
    gradeDayPeriods: model.gradeDayPeriods!,
    lunchAfterPeriod: model.lunchAfterPeriod,
    seed: SEED,
    onProgress: (phase, done, total) => {
      if (done === 0 || done === total)
        console.log(`  [${phase}] ${done}/${total}`);
    },
  });
  const elapsed = Date.now() - t0;
  console.log(
    `솔버 완료 (${(elapsed / 1000).toFixed(1)}s, seed=${SEED}): 그리디 ${result.stats.placedGreedy} + ejection ${result.stats.placedByEjection} / ${result.stats.occurrencesTotal}회차, 국소 탐색 수용 ${result.stats.localSearchAccepted}건`
  );
  if (result.unplaced.length) {
    console.log(`\n⚠️ 미배정 ${result.unplaced.length}건 (수동 조정 대상):`);
    for (const u of result.unplaced) console.log(`  - ${u.label}: ${u.remaining}시간`);
  } else {
    console.log("미배정 0건 — 전 시수 배치 완료");
  }

  // ── 검사기 관문 ──
  const report = validateTimetable(result.grids, model);
  const gaps = report.hard.filter((v) => v.registryGap);
  console.log(
    `\n══ 검사기 관문 ══\n하드 ${report.hard.length}건 (조치 대상 ${report.summary.actionableHard} + 등록부 미비 추정 ${gaps.length})`
  );
  if (report.hard.length) {
    const byCode = Object.entries(report.summary.hardByCode)
      .map(([c, n]) => `${c}=${n}`)
      .join(" ");
    console.log(`코드별: ${byCode}`);
    for (const v of report.hard.slice(0, 15)) console.log(`  [${v.code}] ${v.text}`);
    if (report.hard.length > 15) console.log(`  … 외 ${report.hard.length - 15}건`);
  }
  console.log(
    `소프트: ${report.soft.total}점 (내부 추정 ${result.stats.softScoreEstimate}점) vs 기준선 ${baseline.soft.total}점 → ${
      report.soft.total <= baseline.soft.total ? "✅ 기준선 이하" : "❌ 기준선 초과"
    }`
  );
  console.log(
    `코드별: ${Object.entries(report.soft.byCode).map(([c, n]) => `${c}=${n}`).join(" ") || "없음"}`
  );

  // ── 결정론 확인: 같은 시드 재실행 = 동일 출력 ──
  const rerun = solveTimetable({
    sections: compileSectionsFromGrids(grids, model),
    gradeDayPeriods: model.gradeDayPeriods!,
    lunchAfterPeriod: model.lunchAfterPeriod,
    seed: SEED,
  });
  const same = hashOf(result.grids) === hashOf(rerun.grids);
  console.log(`결정론: 같은 시드 재실행 ${same ? "✅ 동일 출력" : "❌ 불일치"}`);

  const pass =
    report.hard.length === 0 && result.unplaced.length === 0 && same;
  console.log(
    pass
      ? `\n✅ 재현 실험 통과 — 하드 0·전 시수 배치·결정론 (소프트 ${report.soft.total} vs 기준선 ${baseline.soft.total})`
      : "\n❌ 재현 실험 미통과 — 위 리포트 확인"
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
