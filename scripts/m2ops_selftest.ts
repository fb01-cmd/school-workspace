/**
 * 직접 조정 M2 — 연쇄·잠깐 빼두기 op 자가 테스트 (Firestore 무의존, 합성 소세계)
 *
 * 검사하는 것:
 *  1. park: 칸 비움 + 트레이 등재 / 빈 칸 park는 경고 후 건너뜀(관용)
 *  2. unpark: 같은 학급 빈 칸에 복귀 + 트레이 제거 / 점유 칸·타 학급·없는 parkId는 건너뜀(트레이 유지)
 *  3. chain: 여러 수가 op 1건으로 재생(undo 원자 단위) — 결과 = 낱개 수의 순차 적용과 동일
 *  4. deriveTray: base+ops에서 잔여 트레이 파생 (grids 비파괴)
 *  5. isParkExemptHard: 빼둔 수업이 만든 H1만 면제 — 다른 H1·타 코드는 면제 안 됨
 *  6. checkPlaceholderOp: chain 안의 수가 자리표시 칸을 건드리면 차단 / park·unpark 단건도 차단
 *  7. 되돌리기 동형성: ops.slice(0, n-1) 재생 = op n 적용 전 상태 (opCursor undo 규약)
 *
 * 실행: npx tsx scripts/m2ops_selftest.ts
 */
import {
  applyRevisionOps,
  replayRevisionOps,
  deriveTray,
  cloneClassGrids,
} from "../src/lib/timetable/utils";
import { checkPlaceholderOp, isParkExemptHard } from "../src/lib/timetable/validate";
import {
  BaseRevisionOp,
  ClassGrid,
  HardViolation,
  TimetableLesson,
} from "../src/lib/timetable/types";

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

const makeGrids = (): ClassGrid[] => [
  {
    grade: 1,
    classNum: 1,
    cells: [
      { day: 1, period: 1, lessons: [L("수학", "김가", "a@t")] },
      { day: 1, period: 2, lessons: [L("국어", "이나", "b@t")] },
      // 월3 빈 칸
      { day: 2, period: 1, lessons: [{ subjectName: "창체", subjectShort: "창체", teachers: [{ name: "창체", email: "" }] }] },
    ],
  },
  { grade: 1, classNum: 2, cells: [{ day: 1, period: 1, lessons: [L("미술", "최라", "d@t")] }] },
];

const lessonAt = (grids: ClassGrid[], g: number, c: number, d: number, p: number) =>
  grids.find((x) => x.grade === g && x.classNum === c)?.cells?.find((x) => x.day === d && x.period === p)
    ?.lessons?.[0]?.subjectName || null;

console.log("── M2 op(연쇄·잠깐 빼두기) 자가 테스트 ──");

// 1·2·4: park → 트레이, unpark → 복귀
{
  const grids = makeGrids();
  const ops: BaseRevisionOp[] = [
    { type: "park", parkId: "p1", grade: 1, classNum: 1, day: 1, period: 1 },
  ];
  const r = replayRevisionOps(grids, ops);
  check("park: 칸이 비워진다", lessonAt(grids, 1, 1, 1, 1) === null);
  check("park: 트레이 등재(원위치 포함)", r.tray.length === 1 && r.tray[0].parkId === "p1" && r.tray[0].from.day === 1);
  // 이어서 unpark — 빈 칸(월3)으로
  const r2 = replayRevisionOps(makeGrids(), [
    ...ops,
    { type: "unpark", parkId: "p1", grade: 1, classNum: 1, day: 1, period: 3 },
  ]);
  check("unpark: 빈 칸에 복귀 + 트레이 소거", r2.tray.length === 0);
  // 점유 칸으로 unpark → 건너뜀·트레이 유지
  const r3 = replayRevisionOps(makeGrids(), [
    ...ops,
    { type: "unpark", parkId: "p1", grade: 1, classNum: 1, day: 1, period: 2 },
  ]);
  check("unpark 점유 칸 = 건너뜀(경고)·트레이 유지", r3.tray.length === 1 && r3.warnings.length > 0);
  // 타 학급 unpark → 건너뜀
  const r4 = replayRevisionOps(makeGrids(), [
    ...ops,
    { type: "unpark", parkId: "p1", grade: 1, classNum: 2, day: 1, period: 3 },
  ]);
  check("unpark 타 학급 = 건너뜀·트레이 유지", r4.tray.length === 1);
  // 빈 칸 park → 건너뜀
  const r5 = replayRevisionOps(makeGrids(), [
    { type: "park", parkId: "px", grade: 1, classNum: 1, day: 1, period: 3 },
  ]);
  check("빈 칸 park = 건너뜀(경고)", r5.tray.length === 0 && r5.warnings.length > 0);
  // deriveTray 비파괴
  const base = makeGrids();
  const tray = deriveTray(base, ops);
  check("deriveTray: 파생 정확 + base 비파괴", tray.length === 1 && lessonAt(base, 1, 1, 1, 1) === "수학");
}

// 3·7: chain 원자성 + undo 동형성
{
  const chainOp: BaseRevisionOp = {
    type: "chain",
    steps: [
      { kind: "park", parkId: "c1", grade: 1, classNum: 1, day: 1, period: 1 },
      { kind: "swap", grade: 1, classNum: 1, a: { day: 1, period: 2 }, b: { day: 1, period: 1 } },
      { kind: "unpark", parkId: "c1", grade: 1, classNum: 1, day: 1, period: 2 },
    ],
  };
  const g1 = makeGrids();
  const r = replayRevisionOps(g1, [chainOp]);
  check(
    "chain: 3수 원자 재생 (빼기→밀기→되돌리기 = 두 수업 자리 맞바꿈)",
    lessonAt(g1, 1, 1, 1, 1) === "국어" && lessonAt(g1, 1, 1, 1, 2) === "수학" && r.tray.length === 0,
    JSON.stringify([lessonAt(g1, 1, 1, 1, 1), lessonAt(g1, 1, 1, 1, 2), r.tray.length])
  );
  // undo 동형성: slice(0,0) 재생 = 원판
  const g2 = makeGrids();
  applyRevisionOps(g2, ([] as BaseRevisionOp[]));
  check("undo 동형성: op 제거 재생 = 원판", lessonAt(g2, 1, 1, 1, 1) === "수학" && lessonAt(g2, 1, 1, 1, 2) === "국어");
}

// 5: H1 면제 판정
{
  const tray = deriveTray(makeGrids(), [
    { type: "park", parkId: "p1", grade: 1, classNum: 1, day: 1, period: 1 },
  ]);
  const h1Mine: HardViolation = {
    code: "H1",
    text: "",
    grade: 1,
    classNum: 1,
    subjectName: "수학",
    teacherEmail: "a@t",
  } as HardViolation;
  const h1Other: HardViolation = { ...h1Mine, subjectName: "국어", teacherEmail: "b@t" } as HardViolation;
  const h2: HardViolation = { ...h1Mine, code: "H2" } as HardViolation;
  check("면제: 빼둔 수업의 H1만", isParkExemptHard(h1Mine, tray) === true);
  check("비면제: 다른 수업의 H1", isParkExemptHard(h1Other, tray) === false);
  check("비면제: H1 아닌 코드", isParkExemptHard(h2, tray) === false);
}

// 6: 자리표시 가드 — chain·park 경로
{
  const grids = makeGrids();
  const blockedChain = checkPlaceholderOp(grids, {
    type: "chain",
    steps: [{ kind: "swap", grade: 1, classNum: 1, a: { day: 2, period: 1 }, b: { day: 1, period: 3 } }],
  });
  check("자리표시 가드: chain 안의 수도 차단", !!blockedChain);
  const blockedPark = checkPlaceholderOp(grids, {
    type: "park",
    parkId: "z",
    grade: 1,
    classNum: 1,
    day: 2,
    period: 1,
  });
  check("자리표시 가드: park 단건 차단", !!blockedPark);
  const okPark = checkPlaceholderOp(grids, {
    type: "park",
    parkId: "z2",
    grade: 1,
    classNum: 1,
    day: 1,
    period: 1,
  });
  check("자리표시 가드: 일반 칸 park 통과", okPark === null);
}

console.log(fail === 0 ? `\n✅ M2 op 자가 테스트 전부 통과 (${pass}건)` : `\n❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
