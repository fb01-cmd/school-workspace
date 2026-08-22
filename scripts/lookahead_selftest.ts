/**
 * 수읽기 엔진 L1 자가 테스트 (Firestore 무의존, 합성 소세계 — lookahead_spec §5)
 *
 * 검사하는 것:
 *  1. 1수 문제: 교사 연속 3교시를 한 수(이동)로 푸는 기보를 찾는가 + targetResolved
 *  2. 2수 문제: 목적지가 막혀 있어 블로커를 먼저 옮겨야 하는 판 — 2수 기보를 찾는가
 *  3. 결정론: 같은 입력 = 같은 기보 (두 번 실행 비교)
 *  4. 예산: 극소 예산에서 budgetExhausted 정직 표시 + 크래시 없음
 *  5. 기보 재생 파리티: ops를 재생기로 적용한 결과의 총점 = stepScores 마지막 값
 *
 * 실행: npx tsx scripts/lookahead_selftest.ts
 */
import { searchLookaheadLines } from "../src/lib/timetable/lookahead";
import { validateTimetable } from "../src/lib/timetable/validate";
import { applyRevisionOps, cloneClassGrids } from "../src/lib/timetable/utils";
import { ClassGrid, TimetableConstraintModel, TimetableLesson } from "../src/lib/timetable/types";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra?: string) => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const L = (subject: string, teacher: string, email: string): TimetableLesson => ({
  subjectName: subject,
  subjectShort: subject.slice(0, 2),
  teachers: [{ name: teacher, email }],
});

const model: TimetableConstraintModel = {
  lunchAfterPeriod: 2,
  periodsPerDay: 4,
  gradeDayPeriods: { 1: { 1: 4, 2: 4 } },
  hours: [],
  simulGroups: [],
  venueGroups: [],
  teacherSlotBans: [],
  consecutiveRules: [],
  coTeaching: [],
  fixedBlocks: [],
} as any;

console.log("── 수읽기 엔진 L1 자가 테스트 ──");

// 1: 1수 문제 — 김가 월1·2·3 연속(S2), 월4가 빈 칸 → 월2를 화로 옮기거나 맞바꾸면 해소
{
  const grids: ClassGrid[] = [
    {
      grade: 1,
      classNum: 1,
      cells: [
        { day: 1, period: 1, lessons: [L("수학", "김가", "a@t")] },
        { day: 1, period: 2, lessons: [L("과학", "김가", "a@t")] },
        { day: 1, period: 3, lessons: [L("국어", "김가", "a@t")] },
        // 월4 빈 칸, 화 전체 빈 칸
      ],
    },
  ];
  const r = searchLookaheadLines({
    grids,
    model,
    target: { scope: "teacher", key: "a@t", day: 1, code: "S2" },
  });
  check("1수 문제: 기보 발견", r.lines.length > 0, JSON.stringify(r).slice(0, 200));
  check("1수 문제: 목표 해소 + 1수", !!r.lines[0]?.targetResolved && r.lines[0].ops.length === 1, JSON.stringify(r.lines[0]?.ops));
  // 5: 재생 파리티
  if (r.lines[0]) {
    const trial = cloneClassGrids(grids);
    applyRevisionOps(trial, r.lines[0].ops);
    const total = validateTimetable(trial, model).soft.total;
    check("재생 파리티: 재생 총점 = stepScores 마지막", Math.abs(total - r.lines[0].stepScores[r.lines[0].stepScores.length - 1]) < 1e-9, `${total}`);
  }
  // 3: 결정론
  const r2 = searchLookaheadLines({ grids, model, target: { scope: "teacher", key: "a@t", day: 1, code: "S2" } });
  check("결정론: 같은 입력 = 같은 기보", JSON.stringify(r.lines) === JSON.stringify(r2.lines));
}

// 2: 2수 문제 — 김가 월1·2·3 연속. 화1~4는 이나 수업으로 만석(같은 반), 월4는 김가가 1-2반 수업이라 사용 불가.
//    한 수로는 해소 불가(이동할 빈 칸이 없음) → 이나 수업 하나와 맞바꿈은 가능하지만
//    이나가 월 슬롯으로 와야 함 → 맞바꿈 자체가 1수 해소가 되는 판이면 1수로 끝나므로,
//    맞바꿈이 막히게 이나도 월1~3에 1-2반 수업을 깔아 2수(이나 이동 → 김가 이동)를 강제한다.
{
  const grids: ClassGrid[] = [
    {
      grade: 1,
      classNum: 1,
      cells: [
        { day: 1, period: 1, lessons: [L("수학", "김가", "a@t")] },
        { day: 1, period: 2, lessons: [L("과학", "김가", "a@t")] },
        { day: 1, period: 3, lessons: [L("국어", "김가", "a@t")] },
        { day: 2, period: 1, lessons: [L("미술", "이나", "b@t")] },
        { day: 2, period: 2, lessons: [L("음악", "이나", "b@t")] },
        { day: 2, period: 3, lessons: [L("체육", "이나", "b@t")] },
        { day: 2, period: 4, lessons: [L("도덕", "이나", "b@t")] },
      ],
    },
    {
      grade: 1,
      classNum: 2,
      cells: [
        { day: 1, period: 4, lessons: [L("수학", "김가", "a@t")] }, // 김가 월4 봉쇄
        { day: 1, period: 1, lessons: [L("미술", "이나", "b@t")] }, // 이나 월1 봉쇄
        { day: 1, period: 2, lessons: [L("음악", "이나", "b@t")] }, // 이나 월2 봉쇄
        { day: 1, period: 3, lessons: [L("체육", "이나", "b@t")] }, // 이나 월3 봉쇄
      ],
    },
  ];
  const r = searchLookaheadLines({
    grids,
    model,
    target: { scope: "teacher", key: "a@t", day: 1, code: "S2" },
    depth: 3,
    budget: 3000,
  });
  check("2수 문제: 기보 발견", r.lines.length > 0, `evaluated=${r.evaluated}`);
  if (r.lines[0]) {
    check("2수 문제: 목표 해소", r.lines[0].targetResolved, JSON.stringify(r.lines[0].ops));
    check("2수 문제: 2수 이상 기보", r.lines[0].ops.length >= 2, `${r.lines[0].ops.length}수`);
  }
}

// 4: 예산 소진 정직 표시
{
  const grids: ClassGrid[] = [
    {
      grade: 1,
      classNum: 1,
      cells: [
        { day: 1, period: 1, lessons: [L("수학", "김가", "a@t")] },
        { day: 1, period: 2, lessons: [L("과학", "김가", "a@t")] },
        { day: 1, period: 3, lessons: [L("국어", "김가", "a@t")] },
      ],
    },
  ];
  const r = searchLookaheadLines({
    grids,
    model,
    target: { scope: "teacher", key: "a@t", day: 1, code: "S2" },
    budget: 30,
  });
  check("예산 소진: budgetExhausted 표시 + 크래시 없음", r.budgetExhausted === true);
}

console.log(fail === 0 ? `\n✅ 수읽기 엔진 자가 테스트 전부 통과 (${pass}건)` : `\n❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
