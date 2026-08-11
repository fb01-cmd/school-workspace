/**
 * Phase 9c-F NEIS 사전 검증 자가 테스트 — B1·W1·W2·W3 발화와 소거 확인 (위음성 방지)
 *
 * 사용법: npx tsx scripts/neis_precheck_selftest.ts   ← Firestore 무의존 (순수 함수만)
 *
 * 실데이터 실측(verify_neis_precheck.ts)의 결과가 검출 능력 부재가 아님을 증명하는
 * 회귀 하네스. validate_selftest.ts와 동일 관행.
 */
import { ClassGrid, NeisMapRegistry, TimetableLesson } from "../src/lib/timetable/types";
import {
  buildNeisPrecheckReport,
  emptyNeisMapRegistry,
  neisPairKey,
  sanitizeNeisMapPayload,
} from "../src/lib/timetable/neis";

const A = { email: "a@x.kr", name: "가교사" };
const B = { email: "b@x.kr", name: "나교사" };
const V = { email: "", name: "창체" }; // 가상 교사

function lesson(subject: string, ...teachers: { email: string; name: string }[]): TimetableLesson {
  return { subjectName: subject, subjectShort: subject.slice(0, 2), teachers };
}

function grid(
  grade: number,
  classNum: number,
  cells: Array<[number, number, TimetableLesson[]]>
): ClassGrid {
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

const grids = [
  grid(1, 1, [
    [1, 1, [lesson("국어", A)]],
    [1, 2, [lesson("수학", B)]],
    [1, 3, [lesson("창체", V)]],
    [2, 1, [lesson("통합과학", A, B)]], // 복수교사 — 교사별 각각 pair
  ]),
  grid(1, 2, [
    [1, 1, [lesson("수학", B)]],
    [1, 2, [lesson("국어", A)]],
  ]),
];

console.log("── 빈 등록부 → B1 전과목·W 전건 발화 ──");
{
  const r = buildNeisPrecheckReport(grids, emptyNeisMapRegistry());
  expect("B1 = 4과목 (국어·수학·창체·통합과학)", r.blockers.unmappedSubjects.length === 4,
    `실제 ${r.blockers.unmappedSubjects.length}`);
  expect("readyForExport = false", r.readyForExport === false);
  expect("W1 가상 교사 1건 (창체)", r.warnings.virtualLessons.length === 1 &&
    r.warnings.virtualLessons[0].teacherName === "창체");
  expect("W2 실교사 2건", r.warnings.unconfirmedTeachers.length === 2);
  expect("W3 pair 4건 (가A 국어·나B 수학·가A 통과·나B 통과 — 가상 제외)",
    r.warnings.unconfirmedPairs.length === 4, `실제 ${r.warnings.unconfirmedPairs.length}`);
  expect("summary.lessons = 6", r.summary.lessons === 6, `실제 ${r.summary.lessons}`);
  expect("summary.teachers = 2 (실교사만)", r.summary.teachers === 2);
  expect("B1 정렬 = 사용 시수 내림차순", r.blockers.unmappedSubjects[0].platformName === "국어" ||
    r.blockers.unmappedSubjects[0].platformName === "수학"); // 국어·수학 각 2시간이 선두
}

console.log("── 과목 일부 매핑 → B1 차감·W3에 NEIS명 병기 ──");
{
  const registry: NeisMapRegistry = {
    subjects: [
      { platformName: "국어", neisName: "국어" },
      { platformName: "통합 과학", neisName: "통합과학(공통)" }, // 공백 정규화 매칭 확인
      { platformName: "체육", neisName: "체육Ⅰ" }, // 그리드 미사용 과목 — 리포트 무영향
    ],
    confirmedTeachers: [],
    confirmedPairs: [],
  };
  const r = buildNeisPrecheckReport(grids, registry);
  expect("B1 = 2과목 (수학·창체)", r.blockers.unmappedSubjects.length === 2,
    r.blockers.unmappedSubjects.map((s) => s.platformName).join(","));
  const pair = r.warnings.unconfirmedPairs.find((p) => p.platformName === "통합과학" && p.teacherKey === "a@x.kr");
  expect("W3 통합과학 pair에 neisName 병기", pair?.neisName === "통합과학(공통)");
}

console.log("── 전부 매핑·확인 → 차단 0·경고 0 (소거) ──");
{
  const base = buildNeisPrecheckReport(grids, emptyNeisMapRegistry());
  const registry: NeisMapRegistry = {
    subjects: ["국어", "수학", "창체", "통합과학"].map((n) => ({ platformName: n, neisName: n })),
    confirmedTeachers: ["a@x.kr", "b@x.kr"],
    confirmedPairs: base.warnings.unconfirmedPairs.map((p) => p.key), // 서버 산출 key 반송 규약
  };
  const r = buildNeisPrecheckReport(grids, registry);
  expect("B1 = 0 → readyForExport", r.readyForExport === true && r.blockers.unmappedSubjects.length === 0);
  expect("W2 = 0", r.warnings.unconfirmedTeachers.length === 0);
  expect("W3 = 0", r.warnings.unconfirmedPairs.length === 0);
  expect("W1은 확인 개념 없음 — 잔존", r.warnings.virtualLessons.length === 1);
  expect("summary 확인 수 일치", r.summary.mappedSubjects === 4 &&
    r.summary.confirmedTeachers === 2 && r.summary.confirmedPairs === 4);
}

console.log("── pair key 규약 ──");
{
  expect("neisPairKey 정규화 (공백·대소문자)", neisPairKey("a@x.kr", "통합 과학") === "a@x.kr|통합과학");
}

console.log("── sanitize (neis_map_save 방어선) ──");
{
  expect("본문 없음 → 오류", !!sanitizeNeisMapPayload(null).error);
  const ok = sanitizeNeisMapPayload({
    subjects: [
      { platformName: "  국어 ", neisName: " 국어 " },
      { platformName: "국어", neisName: "중복은 버림" },
      { platformName: "", neisName: "빈 행 버림" },
    ],
    confirmedTeachers: ["A@X.KR", "a@x.kr", ""],
    confirmedPairs: ["a@x.kr|국어"],
  });
  expect("정상 페이로드 통과", !ok.error && !!ok.registry);
  expect("trim + 과목 중복 제거", ok.registry!.subjects.length === 1 &&
    ok.registry!.subjects[0].platformName === "국어");
  expect("교사 소문자 dedupe", ok.registry!.confirmedTeachers.length === 1);
  expect("pair 형식 위반 → 오류", !!sanitizeNeisMapPayload({ confirmedPairs: ["형식위반"] }).error);
  expect("과목 상한 초과 → 오류", !!sanitizeNeisMapPayload({
    subjects: Array.from({ length: 301 }, (_, i) => ({ platformName: `과목${i}`, neisName: "x" })),
  }).error);
  expect("문자열 길이 상한 → 오류", !!sanitizeNeisMapPayload({
    subjects: [{ platformName: "가".repeat(61), neisName: "x" }],
  }).error);
}

console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
