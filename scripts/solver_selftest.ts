/**
 * Phase 9c-C 솔버 자가 테스트 — 실데이터가 발화시키지 못하는 경로 검증 (Firestore 무의존)
 *
 * 사용법: npx tsx scripts/solver_selftest.ts
 *
 * 커버: 연속 블록(2연속) 배치·배정금지 회피·동시수업 동기 배치·특별실 회피·결정론 —
 * 산출은 전부 validateTimetable 관문으로 판정한다 (§0-1 철칙).
 */
import { ClassGrid, TimetableConstraintModel, TimetableLesson } from "../src/lib/timetable/types";
import { deriveHoursFromGrids, validateTimetable } from "../src/lib/timetable/validate";
import { compileSectionsFromGrids, solveTimetable } from "../src/lib/timetable/solver";

const A = { email: "a@x.kr", name: "가교사" };
const B = { email: "b@x.kr", name: "나교사" };
const C = { email: "c@x.kr", name: "다교사" };

function lesson(subject: string, ...teachers: { email: string; name: string }[]): TimetableLesson {
  return { subjectName: subject, subjectShort: subject.slice(0, 2), teachers };
}
function grid(grade: number, classNum: number, cells: Array<[number, number, TimetableLesson[]]>): ClassGrid {
  return { grade, classNum, cells: cells.map(([day, period, lessons]) => ({ day, period, lessons })) };
}

let failed = 0;
function expect(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 기준 데이터: 2학급 × 주 15교시 (월~금 3교시), 과목 3종 — 재배치 여지가 있는 소형 세계
// 1-1: 국어(가)×5, 수학(나)×5, 과학(다)×5 / 1-2: 국어(가)×5 … 교사 공유로 충돌 압력 형성
function buildBase(): ClassGrid[] {
  const cells1: Array<[number, number, TimetableLesson[]]> = [];
  const cells2: Array<[number, number, TimetableLesson[]]> = [];
  const subjects = [
    ["국어", A],
    ["수학", B],
    ["과학", C],
  ] as const;
  for (let d = 1; d <= 5; d++) {
    for (let p = 1; p <= 3; p++) {
      const s1 = subjects[(d + p) % 3];
      const s2 = subjects[(d + p + 1) % 3]; // 같은 슬롯에 다른 교사 — 교사 충돌 없음
      cells1.push([d, p, [lesson(s1[0], s1[1])]]);
      cells2.push([d, p, [lesson(s2[0], s2[1])]]);
    }
  }
  return [grid(1, 1, cells1), grid(1, 2, cells2)];
}

const baseModel = (over: Partial<TimetableConstraintModel> = {}): TimetableConstraintModel => ({
  lunchAfterPeriod: 2,
  periodsPerDay: 3,
  gradeDayPeriods: { 1: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 } },
  ...over,
});

function solveAndValidate(grids: ClassGrid[], model: TimetableConstraintModel, seed = 7) {
  const withHours = { ...model, hours: deriveHoursFromGrids(grids) };
  const sections = compileSectionsFromGrids(grids, withHours);
  const result = solveTimetable({
    sections,
    gradeDayPeriods: withHours.gradeDayPeriods!,
    lunchAfterPeriod: withHours.lunchAfterPeriod,
    seed,
    localSearchIterations: 2000,
  });
  return { result, report: validateTimetable(result.grids, withHours) };
}

console.log("── 솔버 자가 테스트 ──");

// 1) 기본: 하드 0·전 배치
{
  const grids = buildBase();
  const { result, report } = solveAndValidate(grids, baseModel());
  expect("기본 세계 하드 0·전 배치", report.hard.length === 0 && result.unplaced.length === 0,
    JSON.stringify({ hard: report.hard.slice(0, 3), unplaced: result.unplaced }));
}

// 2) 연속수업 패턴 "2" — H9 관문 통과 (블록 배치 경로)
{
  const grids = buildBase();
  const model = baseModel({
    consecutiveRules: [
      { termId: "t", grade: 1, classNums: [1], subjectName: "과학", pattern: "2,2", active: true },
    ],
  });
  const { result, report } = solveAndValidate(grids, model);
  expect(
    "연속 '2,2' 배치 후 H9 0",
    result.unplaced.length === 0 && !report.hard.some((v) => v.code === "H9"),
    JSON.stringify(report.hard.filter((v) => v.code === "H9"))
  );
}

// 3) 배정금지 — 가교사 월요일 전체 금지 → H5 0
{
  const grids = buildBase();
  const model = baseModel({
    teacherSlotBans: [
      {
        termId: "t", teacherEmail: "a@x.kr", teacherName: "가교사", kind: "assign",
        slots: [{ day: 1, period: 1 }, { day: 1, period: 2 }, { day: 1, period: 3 }],
        active: true,
      },
    ],
  });
  const { result, report } = solveAndValidate(grids, model);
  expect(
    "배정금지 회피 (H5 0·전 배치)",
    result.unplaced.length === 0 && !report.hard.some((v) => v.code === "H5"),
    JSON.stringify(report.hard.filter((v) => v.code === "H5"))
  );
}

// 4) 동시수업 동기 배치 — 두 학급이 같은 슬롯에 함께 움직여야 (H7 0)
{
  const D = { email: "d@x.kr", name: "라교사" };
  const E = { email: "e@x.kr", name: "마교사" };
  // 원본부터 동기화된 분반 3슬롯 (컴시간 산출물이 H7-clean인 것과 동일 전제)
  const cells1: Array<[number, number, TimetableLesson[]]> = [];
  const cells2: Array<[number, number, TimetableLesson[]]> = [];
  const syncSlots = [[1, 1], [2, 1], [3, 1]];
  for (const [d, p] of syncSlots) {
    cells1.push([d, p, [lesson("분반국어", A)]]);
    cells2.push([d, p, [lesson("분반국어", A)]]);
  }
  let i = 0;
  for (let d = 1; d <= 5; d++) {
    for (let p = 1; p <= 3; p++) {
      if (syncSlots.some(([sd, sp]) => sd === d && sp === p)) continue;
      cells1.push([d, p, [lesson(i % 2 ? "수학" : "과학", i % 2 ? B : C)]]);
      cells2.push([d, p, [lesson(i % 2 ? "미술" : "체육", i % 2 ? D : E)]]);
      i++;
    }
  }
  const grids = [grid(1, 1, cells1), grid(1, 2, cells2)];
  const model = baseModel({
    simulGroups: [
      { termId: "t", label: "국어분반", grade: 1, classNums: [1, 2], subjectNames: ["분반국어"], active: true },
    ],
  });
  const { result, report } = solveAndValidate(grids, model);
  expect(
    "동시수업 동기 배치 (H7 0·전 배치)",
    result.unplaced.length === 0 && !report.hard.some((v) => v.code === "H7"),
    JSON.stringify(report.hard.filter((v) => v.code === "H7").slice(0, 3))
  );
}

// 5) 특별실 용량 1 — 양 학급 과학이 같은 실 → H8 0
{
  const grids = buildBase();
  const model = baseModel({
    venueGroups: [
      { termId: "t", roomName: "과학실", label: "과학실", grade: 1, classNums: [1, 2], subjectNames: ["과학"], active: true },
    ],
  });
  const { result, report } = solveAndValidate(grids, model);
  expect(
    "특별실 겹침 회피 (H8 0·전 배치)",
    result.unplaced.length === 0 && !report.hard.some((v) => v.code === "H8"),
    JSON.stringify(report.hard.filter((v) => v.code === "H8"))
  );
}

// 6) 결정론 — 같은 시드 동일, 다른 시드 허용 편차
{
  const grids = buildBase();
  const a = solveAndValidate(grids, baseModel(), 11);
  const b = solveAndValidate(grids, baseModel(), 11);
  expect("같은 시드 = 같은 출력", JSON.stringify(a.result.grids) === JSON.stringify(b.result.grids));
}

console.log(failed === 0 ? "\n✅ 솔버 자가 테스트 전부 통과" : `\n❌ 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
