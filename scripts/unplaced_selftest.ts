/**
 * 미배정 배치 대상 복원 자가 테스트 (2026-08-22)
 *
 * 겨냥하는 실사고: 화면이 표시 문자열 label을 잘라 세 번째 토막을 교사로 읽었는데
 * 솔버는 두 토막만 만들어서 교사가 **항상 빈 값**이었다. 아래 C1이 그 회귀를 잡는다.
 *
 * 실행: npx tsx scripts/unplaced_selftest.ts   (Firestore 무의존)
 */
import { resolveUnplacedTarget } from "../src/lib/timetable/unplaced";
import type { TimetableDraftUnplaced } from "../src/lib/timetable/types";
import { compileSectionsFromGrids, solveTimetable } from "../src/lib/timetable/solver";
import { deriveHoursFromGrids } from "../src/lib/timetable/validate";

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
}

const FB = { grade: 9, classNum: 9 }; // 폴백이 쓰였는지 눈에 띄게

// ── C1: 새 초안 — 구조화 필드가 있으면 교사가 살아 있어야 한다 (이번 결함의 본체) ──
const fresh: TimetableDraftUnplaced = {
  sectionId: "plain:2-3|통합과학",
  label: "2-3반 통합과학",
  remaining: 2,
  grade: 2,
  classNum: 3,
  lessons: [
    { subjectName: "통합과학", subjectShort: "통과", teachers: [{ email: "kim@hmh.or.kr", name: "김선생" }] },
  ],
};
const r1 = resolveUnplacedTarget(fresh, FB);
ok("C1 새 초안: 교사가 보존된다", r1.lessons[0].teachers[0]?.name === "김선생", JSON.stringify(r1.lessons));
ok("C1 새 초안: 이메일도 보존", r1.lessons[0].teachers[0]?.email === "kim@hmh.or.kr");
ok("C1 새 초안: 학급이 원본 그대로", r1.grade === 2 && r1.classNum === 3);
ok("C1 새 초안: 축약 과목명 보존", r1.lessons[0].subjectShort === "통과");
ok("C1 새 초안: fromLabel=false", r1.fromLabel === false);

// ── C2: 옛 초안(두 토막) — 학급·과목은 복원, 교사는 없다고 정직하게 ──
const legacy2: TimetableDraftUnplaced = {
  sectionId: "plain:1-4|수학",
  label: "1-4반 수학",
  remaining: 1,
};
const r2 = resolveUnplacedTarget(legacy2, FB);
ok("C2 옛 초안: 학급 복원", r2.grade === 1 && r2.classNum === 4);
ok("C2 옛 초안: 과목 복원", r2.lessons[0].subjectName === "수학");
ok(
  "C2 옛 초안: 교사 없으면 빈 배열 (이름없는 유령 교사 금지)",
  Array.isArray(r2.lessons[0].teachers) && r2.lessons[0].teachers.length === 0,
  JSON.stringify(r2.lessons[0].teachers)
);
ok("C2 옛 초안: fromLabel=true", r2.fromLabel === true);

// ── C3: 옛 라벨이 세 토막이던 경우 — 교사 이름 복원 ──
const legacy3: TimetableDraftUnplaced = {
  sectionId: "x",
  label: "3-1반 문학 박선생",
  remaining: 1,
};
const r3 = resolveUnplacedTarget(legacy3, FB);
ok("C3 세 토막 라벨: 교사 이름 복원", r3.lessons[0].teachers[0]?.name === "박선생");
ok("C3 세 토막 라벨: 이메일은 비어 있다(알 수 없음)", r3.lessons[0].teachers[0]?.email === "");

// ── C4: 이름에 공백이 있어도 잘리지 않는다 ──
const spaced: TimetableDraftUnplaced = { sectionId: "y", label: "2-1반 체육 김 철수", remaining: 1 };
ok(
  "C4 공백 있는 이름: 통째로 복원",
  resolveUnplacedTarget(spaced, FB).lessons[0].teachers[0]?.name === "김 철수"
);

// ── C5: 망가진 라벨 — 폴백 학급을 쓰되 터지지 않는다 ──
for (const [name, label] of [
  ["빈 문자열", ""],
  ["학급 토막 없음", "통합과학"],
  ["숫자 아님", "가-나반 미술"],
] as const) {
  const r = resolveUnplacedTarget({ sectionId: "z", label, remaining: 1 }, FB);
  ok(`C5 망가진 라벨(${name}): 폴백 학급 사용`, r.grade === 9 && r.classNum === 9, JSON.stringify(r));
}

// ── C6: 구조화 필드가 반쯤만 있으면 신뢰하지 않는다 (lessons 비었음) ──
const half: TimetableDraftUnplaced = {
  sectionId: "w",
  label: "1-2반 영어",
  remaining: 1,
  grade: 1,
  classNum: 2,
  lessons: [],
};
const r6 = resolveUnplacedTarget(half, FB);
ok("C6 lessons 비면 라벨 경로로 되돌아간다", r6.fromLabel === true && r6.lessons.length === 1);

// ── C7: 배치 결과가 op에 그대로 실릴 수 있는 모양인가 ──
ok(
  "C7 lessons는 항상 1건 이상",
  [r1, r2, r3, r6].every((r) => r.lessons.length > 0)
);

// ─────────────────────────────────────────────────────────────────────────────
// C8: 통합 — 솔버가 실제로 만든 unplaced에 교사가 실려 있는가
//
// 위 C1~C7은 resolver 단위 테스트라 **fixture에 구조화 필드를 손으로 넣는다.**
// 그래서 solver.ts의 전파(unplaced에 grade·classNum·lessons를 싣는 부분)를 되돌려도
// 통과한다 — Codex U8이 지적한 구멍이고, 이 결함의 본체가 바로 그 전파였다.
// 여기서는 솔버를 실제로 돌려 **미배정을 강제로 만들고** 산출물을 검사한다.
// (Firestore 무의존 — solver_selftest와 같은 합성 세계 방식)
// ─────────────────────────────────────────────────────────────────────────────
{
  type Cell = { day: number; period: number; lessons: any[] };

  // 한 교사(가교사)가 두 학급에서 각각 5시간 — 그런데 슬롯은 요일당 1교시 × 5일 = 5칸뿐.
  // 두 학급이 같은 교시를 동시에 못 쓰므로 최소 5시간이 배치 불가가 된다.
  const T = { email: "a@x.kr", name: "가교사" };
  const mk = (grade: number, classNum: number) => {
    const cells: Cell[] = [];
    for (let d = 1; d <= 5; d++) {
      cells.push({
        day: d,
        period: 1,
        lessons: [{ subjectName: "국어", subjectShort: "국", teachers: [T] }],
      });
    }
    return { grade, classNum, cells };
  };
  const grids = [mk(1, 1), mk(1, 2)] as any[];
  const model: any = deriveHoursFromGrids(grids);
  model.gradeDayPeriods = { 1: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } };

  const sections = compileSectionsFromGrids(grids, model);
  const result = solveTimetable({
    sections,
    gradeDayPeriods: model.gradeDayPeriods,
    lunchAfterPeriod: model.lunchAfterPeriod,
    seed: 1,
    localSearchIterations: 200,
  });

  ok("C8 미배정이 실제로 발생했다 (테스트 전제)", result.unplaced.length > 0, `unplaced=${result.unplaced.length}`);

  if (result.unplaced.length > 0) {
    const u = result.unplaced[0];
    ok("C8 솔버 산출 unplaced에 grade가 실린다", typeof u.grade === "number" && u.grade > 0, JSON.stringify(u.grade));
    ok("C8 솔버 산출 unplaced에 classNum이 실린다", typeof u.classNum === "number" && u.classNum > 0, JSON.stringify(u.classNum));
    ok("C8 솔버 산출 unplaced에 lessons가 실린다", Array.isArray(u.lessons) && u.lessons.length > 0);
    // ★ 이 결함의 본체 — 되돌리면 여기서 터진다
    ok(
      "C8 ★ 솔버 산출 unplaced의 교사 이름이 비어 있지 않다",
      !!u.lessons?.[0]?.teachers?.[0]?.name,
      JSON.stringify(u.lessons?.[0]?.teachers)
    );
    // resolver를 태워도 교사가 살아남는가 (전파 → 복원 왕복)
    const round = resolveUnplacedTarget(u as any, FB);
    ok("C8 ★ resolver 왕복 후에도 교사 보존", round.lessons[0]?.teachers?.[0]?.name === "가교사", JSON.stringify(round.lessons));
    ok("C8 ★ 라벨 파싱으로 안 떨어졌다(fromLabel=false)", round.fromLabel === false);
  }
}

console.log(
  fails.length === 0
    ? `\n✅ 미배정 배치 대상 복원 자가 테스트 전부 통과 (단위 + 통합, 총 ${pass}건)`
    : `\n❌ 실패 ${fails.length}건: ${fails.join(", ")}`
);
process.exit(fails.length === 0 ? 0 : 1);
