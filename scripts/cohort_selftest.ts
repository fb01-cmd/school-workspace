/**
 * 교육과정 코호트 역산·전개 자가 테스트 (9c-H §3 항목 1)
 *
 * 사용법: npx tsx scripts/cohort_selftest.ts   ← Firestore 무의존 (순수 함수만)
 *
 * 핵심 검증: 교육과정 개정은 1학년부터 들어와 두 교육과정이 2년간 공존한다 —
 * 사용자 확정 표현으로 "1/2,3인 해와 1,2/3인 해"가 모두 맞게 갈라져야 한다.
 */
import { CurriculumCohort } from "../src/lib/timetable/types";
import {
  cohortForGrade,
  expandCohortFixedBlocks,
  gradesForCohort,
  validateCohortInput,
} from "../src/lib/timetable/cohort";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function cohort(
  id: string,
  startAdmissionYear: number,
  fixedSlots: CurriculumCohort["fixedSlots"],
  active = true
): CurriculumCohort {
  return {
    id,
    label: id,
    startAdmissionYear,
    fixedSlots,
    active,
    createdBy: "t@x.kr",
    updatedBy: "t@x.kr",
    updatedAt: 0,
  };
}

const OLD = cohort("old-2015", 2015, [
  { displayName: "창체", day: 5, period: 5 },
  { displayName: "창체", day: 5, period: 6 },
]);
const NEW = cohort("new-2022", 2025, [
  { displayName: "창체", day: 5, period: 5 },
  { displayName: "SLAT", day: 3, period: 6 },
  { displayName: "SLAT", day: 3, period: 7 },
]);
const cohorts = [OLD, NEW];

console.log("① 역산 — 공존 2년의 양쪽 해");
{
  // 2025학년도: 신교육과정 1학년만 (1 / 2,3)
  check("2025 1학년 → 신", cohortForGrade(cohorts, 2025, 1)?.id === "new-2022");
  check("2025 2학년 → 구", cohortForGrade(cohorts, 2025, 2)?.id === "old-2015");
  check("2025 3학년 → 구", cohortForGrade(cohorts, 2025, 3)?.id === "old-2015");
  // 2026학년도: 1,2 / 3
  check("2026 1학년 → 신", cohortForGrade(cohorts, 2026, 1)?.id === "new-2022");
  check("2026 2학년 → 신", cohortForGrade(cohorts, 2026, 2)?.id === "new-2022");
  check("2026 3학년 → 구", cohortForGrade(cohorts, 2026, 3)?.id === "old-2015");
  // 2027학년도: 전 학년 신 — 구는 자연 소멸 (삭제 불필요)
  check("2027 3학년 → 신", cohortForGrade(cohorts, 2027, 3)?.id === "new-2022");
}

console.log("② 역산 — 경계·부재·비활성");
{
  check("해당 없음 → null", cohortForGrade(cohorts, 2015, 3) === null, "입학 2013은 어느 시작년도에도 못 미침");
  check(
    "비활성 무시",
    cohortForGrade([cohort("x", 2025, [], false), OLD], 2026, 1)?.id === "old-2015"
  );
  check("빈 목록 → null", cohortForGrade([], 2026, 1) === null);
}

console.log("③ 화면 안내문용 학년 목록");
{
  check("2026 신 → [1,2]", JSON.stringify(gradesForCohort(cohorts, "new-2022", 2026)) === "[1,2]");
  check("2026 구 → [3]", JSON.stringify(gradesForCohort(cohorts, "old-2015", 2026)) === "[3]");
  check("2027 구 → []", JSON.stringify(gradesForCohort(cohorts, "old-2015", 2027)) === "[]");
}

console.log("④ 전개 — 학급 단위 FixedBlock");
{
  const classList = [
    { grade: 1, classNum: 1 },
    { grade: 1, classNum: 2 },
    { grade: 2, classNum: 1 },
    { grade: 3, classNum: 1 },
  ];
  const blocks = expandCohortFixedBlocks(cohorts, 2026, classList, "t1");
  // 슬롯 집합: 신(금5, 수6, 수7) ← 1·2학년 / 구(금5, 금6) ← 3학년 → 칸은 금5(공유)·금6·수6·수7 = 4
  check("블록 수 4", blocks.length === 4, `실제 ${blocks.length}`);
  const at = (d: number, p: number) => blocks.find((b) => b.day === d && b.period === p);
  const fri5 = at(5, 5);
  check("금5 공유 칸에 4개 학급 전부", fri5?.entries.length === 4, `실제 ${fri5?.entries.length}`);
  check(
    "금5 전부 창체 표기",
    !!fri5 && fri5.entries.every((e) => e.subjectName === "창체" && e.teacherName === "창체")
  );
  const fri6 = at(5, 6);
  check(
    "금6은 구 교육과정(3학년)만",
    fri6?.entries.length === 1 && fri6.entries[0].grade === 3
  );
  const wed6 = at(3, 6);
  check(
    "수6 SLAT은 신 교육과정(1·2학년) 3개 학급",
    wed6?.entries.length === 3 && wed6.entries.every((e) => e.subjectName === "SLAT" && e.grade < 3)
  );
  check("termId 전달", blocks.every((b) => b.termId === "t1"));
  check("active 기본 true", blocks.every((b) => b.active === true));
  // 결정론: 같은 입력을 뒤섞어 넣어도 같은 결과
  const shuffled = expandCohortFixedBlocks(cohorts, 2026, [...classList].reverse(), "t1");
  check("입력 순서 무관 결정론", JSON.stringify(blocks) === JSON.stringify(shuffled));
  // 코호트 없는 학년은 조용히 비움 (fixed-missing은 컴파일러 몫)
  const none = expandCohortFixedBlocks([NEW], 2026, [{ grade: 3, classNum: 1 }]);
  check("코호트 없는 학년 → 블록 0", none.length === 0);
}

console.log("⑤ 서버 검증");
{
  const ok = { label: "2022 개정", startAdmissionYear: 2025, fixedSlots: NEW.fixedSlots };
  check("정상 통과", validateCohortInput(ok) === null);
  check("연도 범위", validateCohortInput({ ...ok, startAdmissionYear: 1899 }) !== null);
  check("연도 정수", validateCohortInput({ ...ok, startAdmissionYear: 2025.5 }) !== null);
  check("빈 이름", validateCohortInput({ ...ok, label: " " }) !== null);
  check(
    "슬롯 상한 50",
    validateCohortInput({
      ...ok,
      fixedSlots: Array.from({ length: 51 }, (_, i) => ({
        displayName: "창체",
        day: 1 + (i % 5),
        period: 1 + Math.floor(i / 5),
      })),
    }) !== null
  );
  check(
    "중복 (요일,교시) 거부",
    validateCohortInput({
      ...ok,
      fixedSlots: [
        { displayName: "창체", day: 5, period: 5 },
        { displayName: "SLAT", day: 5, period: 5 },
      ],
    }) !== null
  );
  check(
    "요일 범위",
    validateCohortInput({ ...ok, fixedSlots: [{ displayName: "창체", day: 6, period: 1 }] }) !== null
  );
  check(
    "교시 범위",
    validateCohortInput({ ...ok, fixedSlots: [{ displayName: "창체", day: 1, period: 10 }] }) !== null
  );
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
