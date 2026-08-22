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

// 5: 부작용 보고 — 「어디서 감점이 늘어나는지」가 실제로 나오는가 (2026-08-22 사용자 요구)
//
// 총점만 보여 주면 「0.5점 개선」이 어디서 벌고 어디서 잃은 숫자인지 알 수 없어
// "이 감점을 늘리더라도 갈지"를 판단할 수 없다 — 그 판단 근거가 sideEffects다.
{
  const grids: ClassGrid[] = [
    {
      grade: 1,
      classNum: 1,
      cells: [
        { day: 1, period: 1, lessons: [L("수학", "김가", "a@t")] },
        { day: 1, period: 2, lessons: [L("과학", "김가", "a@t")] },
        { day: 1, period: 3, lessons: [L("국어", "김가", "a@t")] },
        { day: 2, period: 1, lessons: [L("도덕", "이나", "b@t")] },
        { day: 2, period: 2, lessons: [L("미술", "이나", "b@t")] },
        { day: 3, period: 1, lessons: [L("음악", "이나", "b@t")] },
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
  check("부작용: 기보가 나온다 (전제)", r.lines.length > 0, `evaluated=${r.evaluated}`);
  for (const line of r.lines) {
    check(
      "부작용: sideEffects 필드가 배열로 채워진다",
      Array.isArray(line.sideEffects),
      JSON.stringify(line.sideEffects)
    );
    // 나빠지는 항목이 위로 정렬돼 있어야 화면이 그대로 쓸 수 있다
    const deltas = line.sideEffects.map((e) => e.delta);
    check(
      "부작용: 나빠지는 것이 위로 정렬",
      deltas.every((d, i) => i === 0 || deltas[i - 1] >= d),
      JSON.stringify(deltas)
    );
    // 문구는 검사기 문장 그대로여야 한다 (화면이 따로 이름을 짓지 않게)
    check(
      "부작용: 각 항목에 사람이 읽는 문장이 있다",
      line.sideEffects.every((e) => typeof e.text === "string" && e.text.length > 0),
      JSON.stringify(line.sideEffects.map((e) => e.text))
    );
    // 목표 감점은 sideEffects에 섞이면 안 된다 (targetDelta가 따로 말한다)
    check(
      "부작용: 목표 감점은 제외된다",
      line.sideEffects.every((e) => !(e.code === "S2" && e.text.includes("김가") && e.text.includes("월"))),
      JSON.stringify(line.sideEffects.map((e) => e.text))
    );
    // delta 부호와 kind 가 어긋나면 화면이 초록/빨강을 거꾸로 칠한다
    check(
      "부작용: kind와 delta 부호가 일치",
      line.sideEffects.every((e) =>
        e.delta > 0 ? e.kind === "new" || e.kind === "worse" : e.kind === "gone" || e.kind === "better"
      ),
      JSON.stringify(line.sideEffects.map((e) => `${e.kind}:${e.delta}`))
    );
    // 총점 변화와 부작용 합의 정합 — 목표 변화 + 부작용 합 = 최종 총점 변화
    const sideSum = line.sideEffects.reduce((a, e) => a + e.delta, 0);
    check(
      "부작용: 목표 변화 + 부작용 합 = 총점 변화 (숫자가 서로 맞는다)",
      Math.abs(line.targetDelta + sideSum - line.finalDelta) < 1e-9,
      `target=${line.targetDelta} side=${sideSum} final=${line.finalDelta}`
    );
  }
}

// 6: 「더 깊이 읽기」가 실제로 더 깊이 읽는가 (2026-08-23 사용자 실기기 후 신설)
//
// 사용자: "더 깊이 생각했을 때 결과가 좋아지는 걸 본 적은 없어." 원인은 「더 깊이」가
// **budget만** 올리고 beamWidth를 그대로 뒀던 것 — 빔 탐색은 깊이마다 beamWidth개만
// 남기므로 트리 모양이 예산과 무관하게 고정된다. 이 케이스가 그 회귀를 잡는다.
{
  const T = (s: string, n: string, e: string) => L(s, n, e);
  const subjects = [
    ["국어", "가교사", "a@t"], ["수학", "나교사", "b@t"], ["영어", "다교사", "c@t"],
    ["과학", "라교사", "d@t"], ["사회", "마교사", "e@t"], ["체육", "바교사", "f@t"],
  ];
  const wideModel: TimetableConstraintModel = {
    lunchAfterPeriod: 3,
    periodsPerDay: 6,
    gradeDayPeriods: { 1: { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 } },
    hours: [], simulGroups: [], venueGroups: [], teacherSlotBans: [],
    consecutiveRules: [], coTeaching: [], fixedBlocks: [],
  } as any;
  const grids: ClassGrid[] = [];
  for (let c = 1; c <= 4; c++) {
    const cells: any[] = [];
    for (let d = 1; d <= 5; d++)
      for (let p = 1; p <= 6; p++) {
        const sj = subjects[(d + p + c) % subjects.length];
        cells.push({ day: d, period: p, lessons: [T(sj[0], sj[1], sj[2])] });
      }
    grids.push({ grade: 1, classNum: c, cells } as any);
  }
  const target = { scope: "teacher" as const, key: "a@t", day: 1, code: "S2" as const };

  const shallow = searchLookaheadLines({ grids, model: wideModel, target, budget: 1500 });
  // 화면의 「더 깊이 읽기」와 같은 설정 (DraftAutoTab: beamWidth 8 / budget 6000)
  const deep = searchLookaheadLines({ grids, model: wideModel, target, beamWidth: 8, budget: 6000 });

  const bestOf = (r: typeof shallow) =>
    r.lines.length ? Math.min(...r.lines.map((l) => l.finalDelta)) : Infinity;

  check("더 깊이: 탐색 수가 실제로 늘어난다", deep.evaluated > shallow.evaluated * 1.5,
    `기본 ${shallow.evaluated} → 깊이 ${deep.evaluated}`);
  check("더 깊이: 기보가 나빠지지 않는다", bestOf(deep) <= bestOf(shallow),
    `기본 ${bestOf(shallow)} → 깊이 ${bestOf(deep)}`);
  // ★ 이 결함의 본체 — 예산만 올리던 시절에는 여기가 동점이라 실패한다
  check("더 깊이 ★ 이 판에서는 실제로 더 나은 기보를 낸다", bestOf(deep) < bestOf(shallow),
    `기본 ${bestOf(shallow)} → 깊이 ${bestOf(deep)} (같으면 빔이 안 넓어진 것)`);

  // 예산만 올리는 옛 방식은 개선이 없음을 함께 못 박는다 (왜 빔이어야 하는지의 근거)
  const budgetOnly = searchLookaheadLines({ grids, model: wideModel, target, budget: 6000 });
  check("더 깊이: 예산만 올리는 것으로는 안 된다 (옛 방식 반증)",
    bestOf(budgetOnly) >= bestOf(shallow) && bestOf(budgetOnly) > bestOf(deep),
    `예산만 ${bestOf(budgetOnly)} vs 빔확대 ${bestOf(deep)}`);
}

console.log(fail === 0 ? `\n✅ 수읽기 엔진 자가 테스트 전부 통과 (${pass}건)` : `\n❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
