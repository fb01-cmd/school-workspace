/**
 * Phase 9c-I 동치성 회귀 검증 스크립트 (phase9c_i_spec §9-2)
 *
 * 2026-2 그리드에서 파생한 시수 계획으로 hoursFromPlanRows를 거친 hours와
 * solve_blank.ts의 뭉텅이 필터 방식 hours가 행 단위로 정확히 일치하는지 검증한다.
 *
 * 사용법: npx tsx --env-file=.env.local scripts/test_phase9c_i_equivalence.ts
 */
import { deriveGradeDayPeriods, deriveHoursFromGrids } from "../src/lib/timetable/validate";
import { expandCohortFixedBlocks, impliedHoursFromFixedBlocks, hoursFromPlanRows } from "../src/lib/timetable/cohort";
import { CurriculumCohort, HoursPlanRow, HoursRequirement } from "../src/lib/timetable/types";

const TRANSCRIBED_COHORTS: CurriculumCohort[] = [
  {
    id: "adm2024",
    label: "2026-2 현행 교육과정 (전사)",
    startAdmissionYear: 2024,
    fixedSlots: [
      { displayName: "SLAT", day: 3, period: 6 },
      { displayName: "SLAT", day: 3, period: 7 },
      { displayName: "창체", day: 5, period: 5 },
      { displayName: "창체", day: 5, period: 6 },
    ],
    active: true,
    createdBy: "test",
    updatedBy: "test",
    updatedAt: 0,
  },
];
const SCHOOL_YEAR = 2026;
const DOMAIN = "hmh.or.kr";

async function main() {
  const { loadActiveTerm, loadAllClassGrids } = await import("../src/lib/timetable/server");
  const term = await loadActiveTerm(DOMAIN);
  if (!term) throw new Error("활성 학기가 없습니다.");
  const grids = await loadAllClassGrids(DOMAIN, term.id);
  if (grids.length === 0) throw new Error("그리드가 없습니다.");

  console.log(`학기 ${term.id} (${grids.length}학급) 로드 완료`);

  // 1. solve_blank.ts 방식 (뭉텅이 필터)
  const derivedHours = deriveHoursFromGrids(grids);
  const classList = grids
    .map((g) => ({ grade: g.grade, classNum: g.classNum }))
    .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum);
  const fixedBlocks = expandCohortFixedBlocks(TRANSCRIBED_COHORTS, SCHOOL_YEAR, classList, term.id);

  const isVirtualRow = (tk: string) => !tk || tk.startsWith("name:");
  const uploadHours = derivedHours.filter((h) => !isVirtualRow(h.teacherKey));
  const impliedHours = impliedHoursFromFixedBlocks(fixedBlocks);
  const blankHours = [...uploadHours, ...impliedHours];

  // 2. phase9c_i_spec §3 방식 (deriveHoursPlanFromGrids -> hoursFromPlanRows)
  const planRows: HoursPlanRow[] = derivedHours.map((r) => {
    let teacherEmail = "";
    let teacherName = "";
    if (r.teacherKey.startsWith("name:")) {
      teacherName = r.teacherKey.slice(5);
    } else {
      teacherEmail = r.teacherKey;
    }
    return {
      id: "test",
      grade: r.grade,
      classNum: r.classNum,
      subjectName: r.subjectName,
      teacherEmail,
      teacherName,
      hours: r.hours,
    };
  });

  const { hours: iHours, droppedVirtual } = hoursFromPlanRows(planRows, fixedBlocks);

  console.log(`solve_blank 방식 시수: ${blankHours.length}행`);
  console.log(`phase9c-I 방식 시수: ${iHours.length}행 (가상 행 제거 ${droppedVirtual}건)`);

  // 3. 행 단위 정렬 후 비교
  const sortKey = (h: HoursRequirement) =>
    `${h.grade}-${h.classNum}|${h.subjectName}|${h.teacherKey}|${h.hours}`;

  const sortedBlank = [...blankHours].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const sortedI = [...iHours].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  if (sortedBlank.length !== sortedI.length) {
    console.error(`❌ 행 수 불일치: blank=${sortedBlank.length} vs I=${sortedI.length}`);
    process.exit(1);
  }

  let mismatchCount = 0;
  for (let i = 0; i < sortedBlank.length; i++) {
    const a = sortedBlank[i];
    const b = sortedI[i];
    const keyA = sortKey(a);
    const keyB = sortKey(b);
    if (keyA !== keyB) {
      console.error(`❌ [행 ${i}] 불일치:\n  blank: ${keyA}\n  I:     ${keyB}`);
      mismatchCount++;
    }
  }

  if (mismatchCount === 0) {
    console.log(`✅ 동치성 회귀 전수 통과: 총 ${sortedBlank.length}개 행이 완벽하게 일치합니다!`);
    process.exit(0);
  } else {
    console.error(`❌ 총 ${mismatchCount}건 불일치 발생`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
