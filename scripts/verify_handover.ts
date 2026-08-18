/**
 * 기간제 담당 일괄 이관 — 순수 산출 로직 셀프테스트 (substitute_handover_spec §7)
 * 실행: npx tsx scripts/verify_handover.ts  (네트워크·Firestore 0회)
 */
import {
  buildHandoverRevisionOps,
  computeHandoverWeekIntents,
  dayOfWeekFromDateStr,
  mondayOfDateStr,
  nextMondayAfter,
  planHandoverDates,
} from "../src/lib/timetable/handover";
import { applyRevisionOps, cloneClassGrids } from "../src/lib/timetable/utils";
import type { ClassGrid } from "../src/lib/timetable/types";

let fails = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const pass = g === w;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}${pass ? "" : `\n   got:  ${g}\n   want: ${w}`}`);
};

const A = { email: "a@hmh.or.kr", name: "김휴직" };
const B = { email: "b@hmh.or.kr", name: "박기간" };
const C = { email: "c@hmh.or.kr", name: "이동료" };

const lesson = (subject: string, ...teachers: { email: string; name: string }[]) => ({
  subjectName: subject,
  subjectShort: subject.slice(0, 2),
  teachers,
});

// 시험 그리드: 1-1반 (월1 A영어, 수3 A영어, 금5 A·C 공동수업, 화2 C수학), 2-3반 (목4 A영어)
const makeGrids = (): ClassGrid[] => [
  {
    grade: 1,
    classNum: 1,
    cells: [
      { day: 1, period: 1, lessons: [lesson("영어", A)] },
      { day: 2, period: 2, lessons: [lesson("수학", C)] },
      { day: 3, period: 3, lessons: [lesson("영어", A)] },
      { day: 5, period: 5, lessons: [lesson("공동영어", A, C)] },
    ],
  },
  {
    grade: 2,
    classNum: 3,
    cells: [{ day: 4, period: 4, lessons: [lesson("영어", A)] }],
  },
];

// ── ① 날짜 산술 ──
check("① 요일: 2026-08-19(수)=3", dayOfWeekFromDateStr("2026-08-19"), 3);
check("① 요일: 2026-08-23(일)=7", dayOfWeekFromDateStr("2026-08-23"), 7);
check("① 주 월요일", mondayOfDateStr("2026-08-19"), "2026-08-17");
check("① 다음 주 월요일", nextMondayAfter("2026-08-19"), "2026-08-24");

// ── ② 잔여 요일 의도 산출 — 수요일 인수: 수·목·금의 A 수업만, 정렬 보장 ──
check(
  "② 수요일 인수 → 수·목·금 A 수업만",
  computeHandoverWeekIntents(makeGrids(), A.email, 3),
  [
    { grade: 1, classNum: 1, day: 3, period: 3, subjectName: "영어" },
    { grade: 2, classNum: 3, day: 4, period: 4, subjectName: "영어" },
    { grade: 1, classNum: 1, day: 5, period: 5, subjectName: "공동영어" },
  ]
);
check("② 월요일 인수 → 전 요일", computeHandoverWeekIntents(makeGrids(), A.email, 1).length, 4);
check("② 주말 인수일 → 0건", computeHandoverWeekIntents(makeGrids(), A.email, 6), []);
check("② 타 교사 수업 미포함", computeHandoverWeekIntents(makeGrids(), C.email, 1).length, 2);

// ── ③ 치환 개정판 ops — A 셀만 edit_cell, 공동수업은 A만 치환, 스탬프 필드 미기록 ──
{
  const ops = buildHandoverRevisionOps(makeGrids(), A, B);
  check("③ A가 담긴 셀 수만큼 ops", ops.length, 4);
  const joint = ops.find((o) => o.type === "edit_cell" && o.day === 5) as any;
  check("③ 공동수업: A만 B로, C 불변", joint.lessons[0].teachers, [
    { email: B.email, name: B.name },
    { email: C.email, name: C.name },
  ]);
  check(
    "③ C 단독 셀(화2)은 손대지 않음",
    ops.some((o: any) => o.day === 2 && o.period === 2),
    false
  );
  check("③ 스탬프 필드(simul·room) 미기록", "simul" in joint.lessons[0] || "room" in joint.lessons[0], false);
}

// ── ④ 역방향 대칭 — A→B 적용 후 B→A 적용 = 원본 ──
{
  const grids = makeGrids();
  const forward = cloneClassGrids(grids);
  applyRevisionOps(forward, buildHandoverRevisionOps(grids, A, B));
  check("④ 적용 후 A 수업 0건", computeHandoverWeekIntents(forward, A.email, 1), []);
  check("④ 적용 후 B 수업 4건", computeHandoverWeekIntents(forward, B.email, 1).length, 4);
  const back = cloneClassGrids(forward);
  applyRevisionOps(back, buildHandoverRevisionOps(forward, B, A));
  check("④ 역이관 후 원상 (A 수업 위치 동일)", computeHandoverWeekIntents(back, A.email, 1), computeHandoverWeekIntents(grids, A.email, 1));
}

// ── 실행 계획 (planHandoverDates) ──
check(
  "계획: 주 중간 인수 → 걸치는 주 + 다음 주 개정",
  planHandoverDates("2026-08-19", "2026-08-17"),
  { weekId: "2026-08-17", fromDay: 3, effectiveFrom: "2026-08-24", weekIntentsNeeded: true }
);
check(
  "계획: 미래 주 월요일 인수 → 개정판 단독",
  planHandoverDates("2026-08-24", "2026-08-17"),
  { weekId: "2026-08-24", fromDay: 1, effectiveFrom: "2026-08-24", weekIntentsNeeded: false }
);
check(
  "계획: 현재 주 월요일 인수 → 소급 불가라 걸치는 주 전체 + 다음 주 개정",
  planHandoverDates("2026-08-17", "2026-08-17"),
  { weekId: "2026-08-17", fromDay: 1, effectiveFrom: "2026-08-24", weekIntentsNeeded: true }
);
check(
  "계획: 주말 인수일 → 걸치는 주 없음, 다음 주 개정",
  planHandoverDates("2026-08-22", "2026-08-17"),
  { weekId: "2026-08-17", fromDay: 6, effectiveFrom: "2026-08-24", weekIntentsNeeded: false }
);

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
