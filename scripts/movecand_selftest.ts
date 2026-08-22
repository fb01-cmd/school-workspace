/**
 * 직접 조정 M1 — 후보 일괄 채점기 자가 테스트 (Firestore 무의존, 합성 소세계)
 *
 * 검사하는 것:
 *  1. 교사 겹침이 생기는 목적지는 회색(blocked) + 하드 사유
 *  2. 빈 칸 이동(move)·맞바꿈(swap) 종별 판정과 softDelta 파리티
 *     (모듈 밖에서 직접 op 적용→본검사기 재채점한 값과 일치해야 한다 — op 조립 오류 방어)
 *  3. 자리표시(전원 가상 교사) 칸 — 집기·목적지 모두 차단
 *  4. 분반 이동수업(동시수업 그룹) — 집기 차단
 *  5. 연속수업 등록부(블록) 수업 — 집기 차단 (M1 규약)
 *  6. 빈 칸 집기 — pickBlocked
 * 부수: 채점 1회 시간 측정 (UI 예산 참고용 — 스펙 §5)
 *
 * 실행: npx tsx scripts/movecand_selftest.ts
 */
import { evaluateMoveCandidates, evaluateHeldCandidates } from "../src/lib/timetable/moveCandidates";
import { validateTimetable } from "../src/lib/timetable/validate";
import { applyRevisionOps, cloneClassGrids } from "../src/lib/timetable/utils";
import {
  ClassGrid,
  TimetableConstraintModel,
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

// ── 합성 소세계: 1학년 2개 반 × 월·화 × 3교시 ──
const makeGrids = (): ClassGrid[] => [
  {
    grade: 1,
    classNum: 1,
    cells: [
      { day: 1, period: 1, lessons: [L("수학", "김가", "a@t")] },
      { day: 1, period: 2, lessons: [L("국어", "이나", "b@t")] },
      // 월3 빈 칸
      { day: 2, period: 1, lessons: [L("분반과목", "박다", "c@t")] },
      // 화2 빈 칸
      { day: 2, period: 3, lessons: [{ subjectName: "창체", subjectShort: "창체", teachers: [{ name: "창체", email: "" }] }] },
    ],
  },
  {
    grade: 1,
    classNum: 2,
    cells: [
      { day: 1, period: 3, lessons: [L("수학", "김가", "a@t")] }, // 월3에 김가 점유 (겹침 유도)
      { day: 1, period: 1, lessons: [L("미술", "최라", "d@t")] }, // 연속수업 등록부 대상
    ],
  },
];

const model: TimetableConstraintModel = {
  lunchAfterPeriod: 2,
  periodsPerDay: 3,
  gradeDayPeriods: { 1: { 1: 3, 2: 3 } },
  hours: [],
  simulGroups: [
    {
      id: "sg1",
      termId: "t",
      label: "1학년 분반",
      grade: 1,
      classNums: [1],
      subjectNames: ["분반과목"],
      active: true,
    } as any,
  ],
  venueGroups: [],
  teacherSlotBans: [],
  consecutiveRules: [
    { termId: "t", grade: 1, classNums: [2], subjectName: "미술", pattern: "2", active: true } as any,
  ],
  coTeaching: [],
  fixedBlocks: [],
} as any;

console.log("── 직접 조정 후보 채점기 자가 테스트 ──");

// 1·2: 1-1 월1 수학(김가) 집기
{
  const grids = makeGrids();
  const r = evaluateMoveCandidates({ grids, model, pick: { grade: 1, classNum: 1, day: 1, period: 1 } });
  check("집기 성공 (pickBlocked 없음)", !r.pickBlocked, r.pickBlocked);
  const at = (d: number, p: number) => r.candidates.find((c) => c.day === d && c.period === p);

  // 월3: 빈 칸이지만 김가가 1-2 월3 수업 중 → 교사 겹침 하드 → 회색
  const m3 = at(1, 3);
  check("교사 겹침 목적지 = 회색", m3?.verdict === "blocked" && !!m3?.blockedReason, JSON.stringify(m3));

  // 화2: 빈 칸·김가 자유 → move, ok/worse 중 하나 + 파리티
  const t2 = at(2, 2);
  check("빈 칸 이동 = move 종별", t2?.kind === "move" && t2?.verdict !== "blocked", JSON.stringify(t2));
  if (t2 && t2.verdict !== "blocked") {
    const trial = cloneClassGrids(grids);
    applyRevisionOps(trial, [
      { type: "swap", grade: 1, classNum: 1, a: { day: 1, period: 1 }, b: { day: 2, period: 2 } },
    ]);
    const direct = validateTimetable(trial, model).soft.total - validateTimetable(grids, model).soft.total;
    check("softDelta 파리티 (모듈 = 직접 재채점)", Math.abs(t2.softDelta - direct) < 1e-9, `${t2.softDelta} vs ${direct}`);
  }

  // 월2: 국어(이나)와 맞바꿈 → swap 종별
  const m2 = at(1, 2);
  check("점유 칸 = swap 종별", m2?.kind === "swap", JSON.stringify(m2));

  // 화3: 자리표시(창체) 칸 → 회색
  const t3 = at(2, 3);
  check("자리표시 목적지 = 회색", t3?.verdict === "blocked", JSON.stringify(t3));

  // 화1: 분반(동시수업) 칸 → 회색
  const t1 = at(2, 1);
  check("동시수업 목적지 = 회색", t1?.verdict === "blocked", JSON.stringify(t1));
}

// 3: 자리표시 집기 차단
{
  const r = evaluateMoveCandidates({ grids: makeGrids(), model, pick: { grade: 1, classNum: 1, day: 2, period: 3 } });
  check("자리표시 집기 = pickBlocked", !!r.pickBlocked);
}
// 4: 동시수업 집기 차단
{
  const r = evaluateMoveCandidates({ grids: makeGrids(), model, pick: { grade: 1, classNum: 1, day: 2, period: 1 } });
  check("동시수업 집기 = pickBlocked", !!r.pickBlocked);
}
// 5: 연속수업 등록부 수업 집기 차단 (1-2 미술)
{
  const r = evaluateMoveCandidates({ grids: makeGrids(), model, pick: { grade: 1, classNum: 2, day: 1, period: 1 } });
  check("연속수업(블록) 집기 = pickBlocked (M1 규약)", !!r.pickBlocked);
}
// 6: 빈 칸 집기
{
  const r = evaluateMoveCandidates({ grids: makeGrids(), model, pick: { grade: 1, classNum: 1, day: 1, period: 3 } });
  check("빈 칸 집기 = pickBlocked", !!r.pickBlocked);
}

// 7 (M2): displace — 맞바꿈 불성립 점유 칸에 밀어내기 배치 후보가 뜨는지
{
  // 월2 국어(이나)를 집고 → 월1 수학(김가) 칸: 맞바꿈은 김가가 1-2 월3?… 이 소세계에서는
  // 맞바꿈이 성립하므로, 불성립을 만들기 위해 1-2반에 이나 수업을 월1에 둔다
  // (국어가 월1로 가는 건 OK, 수학이 월2로 오는 것도 OK → 성립. displace 검증에는
  //  "수학이 월2로 못 가는" 배치가 필요) — 1-2반 월2에 김가 수업 추가.
  const grids = makeGrids();
  grids[1].cells!.push({ day: 1, period: 2, lessons: [L("수학", "김가", "a@t")] });
  const r = evaluateMoveCandidates({ grids, model, pick: { grade: 1, classNum: 1, day: 1, period: 2 } });
  const m1 = r.candidates.find((c) => c.day === 1 && c.period === 1);
  check(
    "displace: 맞바꿈 불성립(상대가 내 자리로 못 옴) 점유 칸 = displace 후보",
    m1?.kind === "displace" && m1?.verdict !== "blocked",
    JSON.stringify(m1)
  );
}
// 8 (M2): held — 든 카드의 내려놓기·재밀어내기 채점
{
  const grids = makeGrids();
  // 월1 수학을 들었다 치고 판에서 제거
  const heldLessons = grids[0].cells!.find((c) => c.day === 1 && c.period === 1)!.lessons;
  grids[0].cells!.find((c) => c.day === 1 && c.period === 1)!.lessons = [];
  const r = evaluateHeldCandidates({ grids, model, held: { grade: 1, classNum: 1, lessons: heldLessons } });
  const back = r.candidates.find((c) => c.day === 1 && c.period === 1);
  check("held: 비운 원래 칸 = move 후보(내려놓기)", back?.kind === "move" && back?.verdict !== "blocked", JSON.stringify(back));
  const m3 = r.candidates.find((c) => c.day === 1 && c.period === 3);
  check("held: 다른 빈 칸도 후보 (김가 월3 겹침이면 회색이어야)", m3?.verdict === "blocked", JSON.stringify(m3));
  const occ = r.candidates.find((c) => c.day === 1 && c.period === 2);
  check("held: 점유 칸 = displace(다음 카드 들기)", occ?.kind === "displace", JSON.stringify(occ));
}

// 시간 측정 (참고)
{
  const grids = makeGrids();
  const t0 = performance.now();
  const N = 50;
  for (let i = 0; i < N; i++)
    evaluateMoveCandidates({ grids, model, pick: { grade: 1, classNum: 1, day: 1, period: 1 } });
  console.log(`  ⏱ 합성 소세계 채점 평균 ${((performance.now() - t0) / N).toFixed(1)}ms/회 (실데이터 30학급은 UI에서 실측)`);
}

console.log(fail === 0 ? `\n✅ 후보 채점기 자가 테스트 전부 통과 (${pass}건)` : `\n❌ 실패 ${fail}건 / 통과 ${pass}건`);
process.exit(fail === 0 ? 0 : 1);
