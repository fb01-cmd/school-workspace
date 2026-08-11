/**
 * Phase 9c-A 검사기 자가 테스트 — 합성 그리드로 H1~H11·S1~S6 발화 확인 (위음성 방지)
 *
 * 사용법: npx tsx scripts/validate_selftest.ts   ← Firestore 무의존 (순수 함수만)
 *
 * 실데이터 실측(validate_current_timetable.ts)의 "하드 0"이 검출 능력 부재가 아님을 증명하는
 * 회귀 하네스. 검사기 로직을 고치면 이 스크립트부터 통과시킬 것.
 */
import {
  ClassGrid,
  TimetableConstraintModel,
  TimetableLesson,
} from "../src/lib/timetable/types";
import { deriveHoursFromGrids, validateTimetable } from "../src/lib/timetable/validate";

const A = { email: "a@x.kr", name: "가교사" };
const B = { email: "b@x.kr", name: "나교사" };
const V = { email: "", name: "창체" }; // 가상 교사

function lesson(subject: string, ...teachers: { email: string; name: string }[]): TimetableLesson {
  return { subjectName: subject, subjectShort: subject.slice(0, 2), teachers };
}

/** cells: [day, period, lessons] 나열로 학급 그리드 구성 */
function grid(
  grade: number,
  classNum: number,
  cells: Array<[number, number, TimetableLesson[]]>
): ClassGrid {
  return { grade, classNum, cells: cells.map(([day, period, lessons]) => ({ day, period, lessons })) };
}

const baseModel = (over: Partial<TimetableConstraintModel> = {}): TimetableConstraintModel => ({
  lunchAfterPeriod: 4,
  periodsPerDay: 7,
  gradeDayPeriods: { 1: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 } },
  ...over,
});

let failed = 0;
function expect(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function codes(grids: ClassGrid[], model: TimetableConstraintModel): string[] {
  return validateTimetable(grids, model).hard.map((v) => v.code);
}

console.log("── 하드 검사 발화 테스트 ──");

// 깨끗한 기준 그리드 → 하드 0
{
  const grids = [
    grid(1, 1, [[1, 1, [lesson("국어", A)]], [1, 2, [lesson("수학", B)]]]),
    grid(1, 2, [[1, 1, [lesson("수학", B)]], [1, 2, [lesson("국어", A)]]]),
  ];
  const r = validateTimetable(grids, baseModel({ hours: deriveHoursFromGrids(grids) }));
  expect("깨끗한 그리드 → 하드 0", r.hard.length === 0, JSON.stringify(r.hard));
}

// H2: 같은 교시 2학급 — 과목 다르면 조치 대상, 같으면 registryGap(합반 의심)
{
  const grids = [
    grid(1, 1, [[1, 1, [lesson("국어", A)]]]),
    grid(1, 2, [[1, 1, [lesson("수학", A)]]]),
  ];
  const r = validateTimetable(grids, baseModel());
  expect("H2 이과목 동시 배정", r.hard.some((v) => v.code === "H2" && !v.registryGap));
  const grids2 = [
    grid(1, 1, [[1, 1, [lesson("창체", A)]]]),
    grid(1, 2, [[1, 1, [lesson("창체", A)]]]),
  ];
  const r2 = validateTimetable(grids2, baseModel());
  expect("H2 동일과목 → 합반 의심(registryGap)", r2.hard.some((v) => v.code === "H2" && v.registryGap));
  // 일괄 배정 등록부 등재 시 면제
  const r3 = validateTimetable(grids2, baseModel({
    fixedBlocks: [{
      termId: "t", label: "창체", day: 1, period: 1, active: true,
      entries: [
        { grade: 1, classNum: 1, subjectName: "창체" },
        { grade: 1, classNum: 2, subjectName: "창체" },
      ],
    }],
  }));
  expect("H2 일괄 배정 등재 시 면제", !r3.hard.some((v) => v.code === "H2"));
  // 동시수업 그룹(같은 라벨) 면제
  const r4 = validateTimetable(grids2, baseModel({
    simulGroups: [{ termId: "t", label: "분반", grade: 1, classNums: [1, 2], subjectNames: ["창체"], active: true }],
  }));
  expect("H2 동시수업 그룹 면제", !r4.hard.some((v) => v.code === "H2"));
  // 가상 교사는 애초에 대상 아님
  const grids5 = [
    grid(1, 1, [[1, 1, [lesson("창체", V)]]]),
    grid(1, 2, [[1, 1, [lesson("창체", V)]]]),
  ];
  expect("H2 가상 교사 제외", !codes(grids5, baseModel()).includes("H2"));
}

// H3: 한 셀 다수업(비분반) / 셀 이중 기록
{
  const grids = [grid(1, 1, [[1, 1, [lesson("국어", A), lesson("수학", B)]]])];
  expect("H3 한 셀 2수업(비분반)", codes(grids, baseModel()).includes("H3"));
  const dup = grid(1, 1, [[1, 1, [lesson("국어", A)]], [1, 1, [lesson("수학", B)]]]);
  expect("H3 셀 이중 기록", codes([dup], baseModel()).includes("H3"));
  const r = validateTimetable(grids, baseModel({
    simulGroups: [{ termId: "t", label: "분반", grade: 1, classNums: [1], subjectNames: ["국어", "수학"], active: true }],
  }));
  expect("H3 분반 판정 시 면제", !r.hard.some((v) => v.code === "H3"));
}

// H1·H4: 시수표 대조
{
  const grids = [grid(1, 1, [[1, 1, [lesson("국어", A)]]])];
  const hours = [
    { grade: 1, classNum: 1, subjectName: "국어", teacherKey: "a@x.kr", hours: 3 },
  ];
  const r = validateTimetable(grids, baseModel({ hours }));
  expect("H1 미배정(3중 1만 배정)", r.hard.some((v) => v.code === "H1" && v.text.includes("2시간 미배정")));
  const hours2 = [{ grade: 1, classNum: 1, subjectName: "국어", teacherKey: "a@x.kr", hours: 1 }];
  const grids2 = [grid(1, 1, [[1, 1, [lesson("국어", A)]], [2, 1, [lesson("국어", A)]]])];
  expect("H4 초과 배정", codes(grids2, baseModel({ hours: hours2 })).includes("H4"));
  const grids3 = [grid(1, 1, [[1, 1, [lesson("국어", A)]], [2, 1, [lesson("영어", B)]]])];
  const r3 = validateTimetable(grids3, baseModel({ hours: deriveHoursFromGrids([grid(1, 1, [[1, 1, [lesson("국어", A)]]])]) }));
  expect("H4 시수표에 없는 배정", r3.hard.some((v) => v.code === "H4" && v.text.includes("시수표에 없는")));
}

// H5: 배정금지 / 이동금지는 정적 검사 비대상
{
  const grids = [grid(1, 1, [[1, 1, [lesson("국어", A)]]])];
  const r = validateTimetable(grids, baseModel({
    teacherSlotBans: [{ termId: "t", teacherEmail: "a@x.kr", teacherName: "가교사", kind: "assign", slots: [{ day: 1, period: 1 }], active: true }],
  }));
  expect("H5 배정금지 위반", r.hard.some((v) => v.code === "H5"));
  const r2 = validateTimetable(grids, baseModel({
    teacherSlotBans: [{ termId: "t", teacherEmail: "a@x.kr", kind: "move", slots: [{ day: 1, period: 1 }], active: true }],
  }));
  expect("H5 이동금지는 비대상", !r2.hard.some((v) => v.code === "H5"));
}

// H6: 일괄 배정 고정 위반
{
  const grids = [grid(1, 1, [[1, 1, [lesson("국어", A)]]])];
  const r = validateTimetable(grids, baseModel({
    fixedBlocks: [{ termId: "t", label: "창체", day: 1, period: 1, active: true, entries: [{ grade: 1, classNum: 1, subjectName: "창체" }] }],
  }));
  expect("H6 고정 슬롯에 지정 과목 없음", r.hard.some((v) => v.code === "H6"));
}

// H7: 동시수업 동시성 — 2반이 같은 슬롯에 없음
{
  const grids = [
    grid(1, 1, [[1, 1, [lesson("일본어", A)]]]),
    grid(1, 2, [[2, 3, [lesson("중국어", B)]]]),
  ];
  const r = validateTimetable(grids, baseModel({
    simulGroups: [{ termId: "t", label: "제2외", grade: 1, classNums: [1, 2], subjectNames: ["일본어", "중국어"], active: true }],
  }));
  expect("H7 그룹 동시성 위반(양방향)", r.hard.filter((v) => v.code === "H7").length === 2);
}

// H8: 특별실 이중 점유 / 분반 공동 사용은 면제
{
  const grids = [
    grid(1, 1, [[1, 1, [lesson("체육", A)]]]),
    grid(1, 2, [[1, 1, [lesson("체육", B)]]]),
  ];
  const venueGroups = [{ termId: "t", roomName: "탁구장", label: "체육", grade: 1, classNums: [1, 2], subjectNames: ["체육"], active: true }];
  expect("H8 특별실 이중 점유", codes(grids, baseModel({ venueGroups })).includes("H8"));
  const r2 = validateTimetable(grids, baseModel({
    venueGroups,
    simulGroups: [{ termId: "t", label: "체육분반", grade: 1, classNums: [1, 2], subjectNames: ["체육"], active: true }],
  }));
  expect("H8 같은 분반 공동 사용 면제", !r2.hard.some((v) => v.code === "H8"));
}

// H9: 연속수업 패턴
{
  const rule = { termId: "t", grade: 1, classNums: [1], subjectName: "과학", pattern: "2", active: true };
  const ok = [grid(1, 1, [[1, 1, [lesson("과학", A)]], [1, 2, [lesson("과학", A)]], [3, 5, [lesson("과학", A)]]])];
  expect("H9 2연속+단독 통과", !codes(ok, baseModel({ consecutiveRules: [rule] })).includes("H9"));
  const bad = [grid(1, 1, [[1, 1, [lesson("과학", A)]], [1, 3, [lesson("과학", A)]]])];
  expect("H9 연속 블록 없음 위반", codes(bad, baseModel({ consecutiveRules: [rule] })).includes("H9"));
  const tooLong = [grid(1, 1, [[1, 1, [lesson("과학", A)]], [1, 2, [lesson("과학", A)]], [1, 3, [lesson("과학", A)]]])];
  expect("H9 3연속(2 지정) 위반", codes(tooLong, baseModel({ consecutiveRules: [rule] })).includes("H9"));
  // 소유 규칙: 동시수업 그룹의 consecutive 필드로도 동일 검사
  const r = validateTimetable(bad, baseModel({
    simulGroups: [{ termId: "t", label: "과학분반", grade: 1, classNums: [1], subjectNames: ["과학"], consecutive: "2", active: true }],
  }));
  expect("H9 그룹 consecutive 소유 검사", r.hard.some((v) => v.code === "H9"));
}

// H10: 복수교사
{
  const grids = [grid(1, 1, [[1, 1, [lesson("실험", A)]]])];
  const r = validateTimetable(grids, baseModel({
    coTeaching: [{ termId: "t", grade: 1, classNums: [1], subjectName: "실험", teacherEmails: ["a@x.kr", "b@x.kr"], active: true }],
  }));
  expect("H10 지정 2인 중 1인 누락", r.hard.some((v) => v.code === "H10"));
  const grids2 = [grid(1, 1, [[1, 1, [lesson("실험", A, B)]]])];
  const r2 = validateTimetable(grids2, baseModel({
    coTeaching: [{ termId: "t", grade: 1, classNums: [1], subjectName: "실험", teacherEmails: ["a@x.kr", "b@x.kr"], active: true }],
  }));
  expect("H10 2인 동시 투입 통과", !r2.hard.some((v) => v.code === "H10"));
}

// H11: 미편성 교시
{
  const grids = [grid(1, 1, [[5, 7, [lesson("국어", A)]]])]; // 금요일은 6교시까지
  expect("H11 미편성 교시 배정", codes(grids, baseModel()).includes("H11"));
}

console.log("\n── 소프트 감점 발화 테스트 ──");
{
  // 가교사 월요일 1~5교시 5시간 연강 (5과목) → S1(1점)·S2(5연속=3점)·S3(4·5교시)·S5(5과목=3점)
  const grids = [
    grid(1, 1, [
      [1, 1, [lesson("국어", A)]], [1, 2, [lesson("수학", A)]], [1, 3, [lesson("영어", A)]],
      [1, 4, [lesson("사회", A)]], [1, 5, [lesson("과학", A)]],
      [2, 2, [lesson("국어", A)]], [2, 3, [lesson("국어", A)]], // 화요일 국어 2회 → S4(1점)
    ]),
  ];
  const r = validateTimetable(grids, baseModel());
  expect("S1 요일 쏠림 1점", r.soft.byCode.S1 === 1, JSON.stringify(r.soft.byCode));
  expect("S2 연속 5교시 3점", r.soft.byCode.S2 === 3);
  expect("S3 점심 전후 1점", r.soft.byCode.S3 === 1);
  expect("S4 동일 과목 2회 1점", r.soft.byCode.S4 === 1);
  expect("S5 5과목 3점", r.soft.byCode.S5 === 3);
  // 오후 쏠림: 나교사 5~7교시만
  const grids2 = [grid(1, 1, [[1, 5, [lesson("국어", B)]], [1, 6, [lesson("수학", B)]], [1, 7, [lesson("영어", B)]]])];
  const r2 = validateTimetable(grids2, baseModel());
  expect("S6 오후 쏠림 1점", r2.soft.byCode.S6 === 1, JSON.stringify(r2.soft.byCode));
  // 가상 교사 수업은 소프트 대상 아님
  const grids3 = [grid(1, 1, [[1, 1, [lesson("창체", V)]], [1, 2, [lesson("창체", V)]]])];
  const r3 = validateTimetable(grids3, baseModel());
  expect("가상 교사 소프트 제외", r3.soft.total === 0, JSON.stringify(r3.soft));
}

console.log(failed === 0 ? "\n✅ 자가 테스트 전부 통과" : `\n❌ 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
