/**
 * 「말로 묻는 시간표 해결사」 자가 테스트 — 목표 어휘·체인 탐색·S8 부탁성 희망
 * (docs/timetable_ask_fix_spec.md §8 말미 케이스 목록)
 *
 * 사용법: npx tsx scripts/askfix_selftest.ts
 *
 * **Firestore·네트워크 무의존.** 합성 시간표 하나로 전부 검증하므로 실서비스 읽기 할당량을
 * 쓰지 않는다(2026-08-08 읽기 소진 사고 이후의 규율). 실데이터 회귀는 fixfinder_selftest가 맡는다.
 *
 * 검증하는 것:
 *  ① 목표 어휘 5종의 성공 판정이 **순수 함수**로 맞는가 (AI 무관)
 *  ② 1수로 풀리는 목표는 체인이 1수에서 멈추는가
 *  ③ **모든 접두 상태가 신규 하드 0**인가 — 3수 계획의 1수만 적용된 순간에도 유효해야 한다
 *  ④ 예산 소진 시 부분 답 + resolvesGoal=false
 *  ⑤ soft 금지가 솔버 bannedSlots에 안 들어가는가 (하드 금지는 들어가는가)
 *  ⑥ S8 집계·표적 — H5가 아니라 감점으로 잡히고, 해결안 탐색기가 그 셀을 표적으로 삼는가
 */
import {
  buildGoalEvaluator,
  findFixCandidates,
  findFixPlan,
  type AskFixGoal,
} from "../src/lib/timetable/fixFinder";
import { compileSectionsFromGrids } from "../src/lib/timetable/solver";
import type {
  ClassGrid,
  TeacherSlotBan,
  TimetableConstraintModel,
} from "../src/lib/timetable/types";
import { applyRevisionOps, cloneClassGrids } from "../src/lib/timetable/utils";
import { diffNewHardViolations, validateTimetable } from "../src/lib/timetable/validate";

let failed = 0;
function expect(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 합성 시간표 ──────────────────────────────────────────────
// 1학년 1·2반, 월~금 6교시 운영.
//   1-1: 매일 1교시 국어(김국어) · 매일 2교시 수학(이수학)
//   1-2: 매일 1교시 영어(박영어)
// 3~6교시는 비어 있어 옮길 자리가 넉넉하다. 시수표를 안 주므로 H1·H4는 검사에서 빠진다.

const T1 = { email: "kim@hmh.or.kr", name: "김국어" };
const T2 = { email: "lee@hmh.or.kr", name: "이수학" };
const T3 = { email: "park@hmh.or.kr", name: "박영어" };

const lesson = (subjectName: string, t: { email: string; name: string }) => ({
  subjectName,
  subjectShort: subjectName,
  teachers: [t],
});

function buildGrids(): ClassGrid[] {
  const cellsFor = (
    plan: Array<{ period: number; subject: string; teacher: { email: string; name: string } }>
  ) => {
    const cells = [];
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 6; period++) {
        const hit = plan.find((p) => p.period === period);
        cells.push({
          day,
          period,
          lessons: hit ? [lesson(hit.subject, hit.teacher)] : [],
        });
      }
    }
    return cells;
  };
  return [
    {
      grade: 1,
      classNum: 1,
      cells: cellsFor([
        { period: 1, subject: "국어", teacher: T1 },
        { period: 2, subject: "수학", teacher: T2 },
      ]),
    },
    { grade: 1, classNum: 2, cells: cellsFor([{ period: 1, subject: "영어", teacher: T3 }]) },
  ];
}

const baseModel = (bans: TeacherSlotBan[] = []): TimetableConstraintModel => ({
  lunchAfterPeriod: 4,
  periodsPerDay: 6,
  // 명시하지 않으면 그리드에서 역산돼 "2교시까지 운영"이 되고, 3교시로 옮기는 안이 전부 H11이 된다
  gradeDayPeriods: { 1: { 1: 6, 2: 6, 3: 6, 4: 6, 5: 6 } },
  teacherSlotBans: bans,
});

const grids = buildGrids();
const model = baseModel();
const baseReport = validateTimetable(grids, model);
const common = { baseGrids: grids, ops: [], currentGrids: grids, model };

console.log(`── 기준 시간표: 하드 ${baseReport.hard.length}건 / 감점 ${baseReport.soft.total}점 ──`);
expect("합성 시간표에 하드 위반 0건", baseReport.hard.length === 0,
  baseReport.hard.map((h) => `[${h.code}] ${h.text}`).join(" / "));

// ── ① 목표 어휘 5종의 성공 판정 (순수 함수) ──────────────────
console.log("── ① 목표 어휘 5종 성공 판정 ──");
{
  const ev = (goal: AskFixGoal) => buildGoalEvaluator(goal, grids, model, baseReport);

  // ⓐ teacher-period-days — 김국어의 1교시는 5일. 4일 이하 목표는 아직 미달, 5일 이하면 이미 충족
  const g1 = ev({ kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 4 });
  expect("ⓐ 교사 교시 몰림 — 5일은 목표(4일) 미달", g1.distance(grids, baseReport) === 1);
  expect(
    "ⓐ 이미 충족된 목표는 거리 0",
    ev({ kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 5 }).distance(
      grids,
      baseReport
    ) === 0
  );
  expect('ⓐ "reduce"(질문에 숫자 없음) → 지금보다 하나 적게',
    ev({ kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: "reduce" })
      .text.includes("주 4일"),
    ev({ kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: "reduce" }).text
  );
  expect("ⓐ 원인 셀 = 그 교시의 그 교사 셀 5건", g1.sources(grids).length === 5);

  // ⓑ teacher-day-hours — 김국어의 월요일은 1시간
  expect(
    "ⓑ 교사 요일 시수 — 1시간은 목표(0시간) 미달",
    ev({ kind: "teacher-day-hours", teacherEmail: T1.email, day: 1, maxHours: 0 }).distance(
      grids,
      baseReport
    ) === 1
  );
  expect(
    "ⓑ 1시간 ≤ 2시간 목표는 충족",
    ev({ kind: "teacher-day-hours", teacherEmail: T1.email, day: 1, maxHours: 2 }).distance(
      grids,
      baseReport
    ) === 0
  );

  // ⓒ subject-rotation — 1-1 국어 5회가 전부 1교시 (S7과 같은 판정)
  const g3 = ev({ kind: "subject-rotation", grade: 1, classNum: 1, subjectName: "국어" });
  expect("ⓒ 순배 — 전 회차 같은 교시는 거리 1", g3.distance(grids, baseReport) === 1);
  expect("ⓒ 원인 셀 = 그 과목 전 회차 5건", g3.sources(grids).length === 5);
  const moved = cloneClassGrids(grids);
  applyRevisionOps(moved, [
    { type: "swap", grade: 1, classNum: 1, a: { day: 1, period: 1 }, b: { day: 1, period: 3 } },
  ]);
  expect("ⓒ 한 회차만 옮겨도 회전이 생겨 거리 0",
    g3.distance(moved, validateTimetable(moved, model)) === 0);

  // ⓓ move-cell — 그 셀이 비거나 다른 수업이 되면 충족
  const g4 = ev({ kind: "move-cell", grade: 1, classNum: 1, day: 1, period: 1 });
  expect("ⓓ 셀 이동 — 그대로면 거리 1", g4.distance(grids, baseReport) === 1);
  expect("ⓓ 옮기면 거리 0", g4.distance(moved, validateTimetable(moved, model)) === 0);

  // ⓔ existing-detail — S7은 1-1에 국어·수학 2건이 같은 키다. 건수 비교로 판정해야 한다
  const s7 = baseReport.soft.details.find((d) => d.code === "S7" && d.key === "1-1");
  expect("ⓔ 표적으로 삼을 기존 감점(S7·1-1)이 있다", !!s7);
  const g5 = ev({ kind: "existing-detail", code: "S7", key: "1-1", day: s7!.day });
  expect("ⓔ 기존 감점 — 그대로면 거리 1", g5.distance(grids, baseReport) === 1);
  expect(
    "ⓔ 같은 키 2건 중 1건만 사라져도 해소로 센다 (형제 항목에 가려지지 않음)",
    g5.distance(moved, validateTimetable(moved, model)) === 0
  );
}

// ── ② 1수로 풀리는 목표는 1수에서 멈춘다 ─────────────────────
console.log("── ② 1수 해답 ──");
let onePlan: ReturnType<typeof findFixPlan>;
{
  onePlan = findFixPlan({
    ...common,
    goal: { kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 4 },
  });
  expect("목표 충족", onePlan.resolvesGoal, JSON.stringify(onePlan.steps.map((s) => s.desc)));
  expect("수순이 정확히 1수", onePlan.steps.length === 1, `${onePlan.steps.length}수`);
  expect("해석 확인 문장이 붙는다", onePlan.goalText.includes("김국어"), onePlan.goalText);
  expect("남은 거리 0", onePlan.remaining === 0);

  // 이미 충족된 목표에는 탐색을 돌리지 않는다
  const none = findFixPlan({
    ...common,
    goal: { kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 5 },
  });
  expect("이미 충족된 목표 → 빈 계획 + 검사기 호출 0회",
    none.resolvesGoal && none.steps.length === 0 && none.evaluated === 0);
}

// ── ③ 접두 상태 전부 신규 하드 0 ─────────────────────────────
console.log("── ③ 접두 하드 0 (3수 계획) ──");
{
  // 5일 → 2일 이하: 3수가 필요하다. 예산은 넉넉히 준다 (기본 600은 실사용 기준이고
  // 여기서는 "3수까지 갈 수 있는가"를 보는 것이 목적)
  const plan = findFixPlan({
    ...common,
    goal: { kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 2 },
    evalBudget: 20000,
  });
  expect("3수 계획을 찾았다", plan.resolvesGoal && plan.steps.length === 3,
    `resolves=${plan.resolvesGoal} steps=${plan.steps.length}`);

  for (let i = 1; i <= plan.steps.length; i++) {
    const g = cloneClassGrids(grids);
    applyRevisionOps(g, plan.steps.slice(0, i).map((s) => s.op));
    const rep = validateTimetable(g, model);
    const newHards = diffNewHardViolations(baseReport.hard, rep.hard);
    expect(`접두 ${i}수 — 신규 하드 0`, newHards.length === 0,
      newHards.map((h) => `[${h.code}] ${h.text}`).join(" / "));
    if (i === plan.steps.length) {
      expect("엔진이 예고한 최종 점수 = 실제 적용 결과",
        rep.soft.total === plan.finalSoftTotal,
        `엔진 ${plan.finalSoftTotal} vs 실제 ${rep.soft.total}`);
      // 부작용 고지는 요약이 아니라 전수다
      const realNew = rep.soft.details.filter(
        (d) => !baseReport.soft.details.some((o) => o.text === d.text && o.points === d.points)
      );
      expect("새 감점 고지가 전수 (빠뜨린 항목 0)",
        realNew.every((d) => plan.newPenalties.some((n) => n.text === d.text)),
        `실제 ${realNew.length}건 vs 고지 ${plan.newPenalties.length}건`);
    }
  }
  // 각 수의 예고 점수도 실제와 맞아야 한다 (엔진과 화면이 다른 값을 말하면 신뢰가 무너진다)
  let prev = baseReport.soft.total;
  let stepOk = true;
  for (let i = 1; i <= plan.steps.length; i++) {
    const g = cloneClassGrids(grids);
    applyRevisionOps(g, plan.steps.slice(0, i).map((s) => s.op));
    const rep = validateTimetable(g, model);
    const s = plan.steps[i - 1];
    if (s.oldSoftTotal !== prev || s.newSoftTotal !== rep.soft.total ||
        s.deltaScore !== rep.soft.total - prev) stepOk = false;
    prev = rep.soft.total;
  }
  expect("수순 각 단계의 점수 예고가 실제와 일치", stepOk);
}

// ── ④ 예산 소진 → 부분 답 + resolvesGoal=false ───────────────
console.log("── ④ 예산 소진 ──");
{
  const plan = findFixPlan({
    ...common,
    goal: { kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 1 },
    evalBudget: 5,
  });
  expect("목표 미충족을 명시", plan.resolvesGoal === false);
  expect("예산 소진 표시", plan.budgetExhausted === true);
  expect("검사기 호출이 예산을 넘지 않았다", plan.evaluated <= 5, `${plan.evaluated}회`);
  expect("어디까지 갔는지 말할 수 있다 (시작 거리 > 남은 거리 또는 진전 없음 명시)",
    plan.initialRemaining === 4 && plan.remaining <= plan.initialRemaining,
    `${plan.initialRemaining} → ${plan.remaining}`);
}

// ── ⑤ soft 금지는 솔버의 하드 제약에 들어가지 않는다 ─────────
console.log("── ⑤ 부탁성 희망(soft)과 솔버 ──");
{
  const ban = (soft: boolean): TeacherSlotBan => ({
    termId: "t",
    teacherEmail: T1.email,
    teacherName: T1.name,
    kind: "assign",
    ...(soft ? { soft: true } : {}),
    slots: [{ day: 1, period: 1 }],
    active: true,
  });
  const hardSections = compileSectionsFromGrids(grids, baseModel([ban(false)]));
  const softSections = compileSectionsFromGrids(grids, baseModel([ban(true)]));
  const bannedOf = (secs: ReturnType<typeof compileSectionsFromGrids>) =>
    secs.filter((s) => s.teacherKeys.includes(T1.email)).flatMap((s) => [...s.bannedSlots]);
  expect("하드 금지는 솔버 제약에 들어간다", bannedOf(hardSections).includes("1-1"),
    JSON.stringify(bannedOf(hardSections)));
  expect("부탁(soft)은 솔버 제약에 **안** 들어간다", bannedOf(softSections).length === 0,
    JSON.stringify(bannedOf(softSections)));
}

// ── ⑥ S8 집계·표적 ─────────────────────────────────────────
console.log("── ⑥ S8 교사 희망 위반 ──");
{
  const softBan: TeacherSlotBan = {
    termId: "t",
    teacherEmail: T1.email,
    teacherName: T1.name,
    kind: "assign",
    soft: true,
    slots: [{ day: 1, period: 1 }],
    active: true,
  };
  const hardBan: TeacherSlotBan = { ...softBan, soft: false };
  const softModel = baseModel([softBan]);
  const softRep = validateTimetable(grids, softModel);
  const hardRep = validateTimetable(grids, baseModel([hardBan]));

  expect("soft — H5(배정금지 위반)로 잡지 않는다", softRep.hard.every((h) => h.code !== "H5"));
  const s8 = softRep.soft.details.filter((d) => d.code === "S8");
  expect("soft — S8 감점 1건 1점", s8.length === 1 && s8[0].points === 1, JSON.stringify(s8));
  expect("soft — 감점 문장이 눈높이(내부 코드·영문 없음)",
    !!s8[0] && /되도록 비워/.test(s8[0].text) && !/S8|soft|ban/i.test(s8[0].text), s8[0]?.text);
  expect("하드 금지는 종전대로 H5", hardRep.hard.some((h) => h.code === "H5"));
  expect("하드 금지에는 S8이 붙지 않는다", hardRep.soft.details.every((d) => d.code !== "S8"));

  // 표적 — [해결안 찾기]가 그 셀을 원인으로 잡아 실제로 안을 내는가
  const found = findFixCandidates({
    baseGrids: grids,
    ops: [],
    currentGrids: grids,
    model: softModel,
    target: s8[0],
  });
  expect("S8에 해결안이 나온다", found.length > 0);
  expect("나온 안이 실제로 S8을 없앤다", found.some((c) => c.resolvesTarget),
    found.map((c) => `${c.desc} resolves=${c.resolvesTarget}`).join(" / "));
}

// ── ⑥-2 목표엔 못 닿아도 점수가 좋아지면 부분 답을 낸다 ─────────
// 2026-08-21 사용자 시연에서 걸린 것: 「수요일 연속 4교시」 질문에 화면이 「0단계·점수 변화
// 없음」을 냈는데, 같은 항목의 [해결안 찾기]는 −2.5점 안을 5건 내놓고 있었다. 감점을 **건수**로
// 세기 때문에 4연속→3연속은 목표 거리가 그대로였고, 거리만 진전으로 치던 구현이 그 안을 버렸다.
// **한 화면의 두 버튼이 다른 답을 하면 안 된다.**
console.log("── ⑥-2 목표 미달이어도 점수 개선이면 부분 답 ──");
{
  // 전용 그리드: 한 교사가 수요일 1~4교시 연속. 연속 4교시를 **없애려면** 가운데 칸을 빼야
  // 하는데 S2의 원인 셀은 블록의 양 끝뿐이라, 한 수로는 4연속→3연속(점수만 개선)이 최선이다.
  // 사용자 시연에서 걸린 모양 그 자체다.
  const S1t = { email: "s1@hmh.or.kr", name: "연속교사" };
  const S2t = { email: "s2@hmh.or.kr", name: "옆반교사" };
  const runCells = [];
  for (let d = 1; d <= 5; d++)
    for (let p = 1; p <= 7; p++)
      runCells.push({
        day: d,
        period: p,
        lessons:
          d === 3 && p <= 4
            ? [lesson(`과목${p}`, S1t)]
            : d !== 3 && p === 6
              ? [lesson("타교과", S2t)]
              : [],
      });
  const runGrids: ClassGrid[] = [{ grade: 1, classNum: 1, cells: runCells }];
  const runModel: TimetableConstraintModel = {
    lunchAfterPeriod: 4,
    periodsPerDay: 7,
    gradeDayPeriods: { 1: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 7 } },
  };
  const runReport = validateTimetable(runGrids, runModel);
  const runCommon = { baseGrids: runGrids, ops: [], currentGrids: runGrids, model: runModel };
  const s2 = runReport.soft.details.find((d) => d.code === "S2");
  expect("연속 4교시 감점이 실제로 잡힌다 (케이스가 성립한다)", !!s2, JSON.stringify(runReport.soft.details));

  const v1 = findFixCandidates({ ...runCommon, target: s2! });
  const plan = findFixPlan({
    ...runCommon,
    goal: { kind: "existing-detail", code: "S2", key: s2!.key, day: s2!.day },
    maxDepth: 1,
    evalBudget: 3000,
  });
  expect("케이스 성립 — 한 수로는 목표에 못 닿고 v1은 안을 낸다",
    !plan.resolvesGoal && v1.length > 0, `resolvesGoal=${plan.resolvesGoal} v1=${v1.length}건`);
  expect("[해결안 찾기]가 안을 내면 [물어보고 고치기]도 빈손으로 끝나지 않는다",
    plan.steps.length > 0, `v1 ${v1.length}건 vs v3 ${plan.steps.length}단계`);
  expect("부분 답은 실제로 점수가 좋아진 상태다",
    plan.finalSoftTotal < runReport.soft.total,
    `${runReport.soft.total} → ${plan.finalSoftTotal}`);

  // 반대 방향 — 진전이 정말 없으면 없는 진전을 있는 것처럼 말하지 않는다
  const already = findFixPlan({
    ...common,
    goal: { kind: "teacher-period-days", teacherEmail: T1.email, period: 1, maxDays: 5 },
  });
  expect("진전이 없으면 빈 계획 그대로", already.steps.length === 0 && already.resolvesGoal);
}

// ── ⑦ 사전 걸러내기 등가성 (v1 회귀 — Firestore 없이도 도는 그물) ──
// 실데이터 판은 fixfinder_selftest ③이 하지만 그건 초안이 있어야 돈다. 1수 후보 생성기는
// v1·v3이 공유하므로, 여기가 깨지면 두 기능이 함께 깨진다.
console.log("── ⑦ 사전 걸러내기 등가성 ──");
{
  const sig = (c: { desc: string; newSoftTotal: number }) => `${c.desc}|${c.newSoftTotal}`;
  let mismatched = 0;
  let covered = 0;
  for (const target of baseReport.soft.details) {
    const args = { ...common, target, maxCandidates: 5000, maxResults: 50 };
    const filtered = findFixCandidates(args);
    const brute = findFixCandidates({ ...args, includeDoomed: true });
    const fSet = new Set(filtered.map(sig));
    if (brute.some((c) => !fSet.has(sig(c)))) mismatched++;
    if (filtered.length) covered++;
  }
  expect("걸러내기가 좋은 안을 삼키지 않는다 (전수 대조)", mismatched === 0, `${mismatched}건 불일치`);
  expect("대조가 공허하지 않다 (안이 나온 항목 있음)", covered > 0);
}

console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
