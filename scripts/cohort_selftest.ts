/**
 * 교육과정 코호트 역산·전개 자가 테스트 (9c-H §3 항목 1)
 *
 * 사용법: npx tsx scripts/cohort_selftest.ts   ← Firestore 무의존 (순수 함수만)
 *
 * 핵심 검증: 교육과정 개정은 1학년부터 들어와 두 교육과정이 2년간 공존한다 —
 * 사용자 확정 표현으로 "1/2,3인 해와 1,2/3인 해"가 모두 맞게 갈라져야 한다.
 */
import { CurriculumCohort, FixedSlotOverride } from "../src/lib/timetable/types";
import {
  cohortForGrade,
  expandCohortFixedBlocks,
  gradesForCohort,
  impliedHoursFromFixedBlocks,
  overrideSkipsForYear,
  resolveFixedSlots,
  schoolYearOfDate,
  validateCohortInput,
  validateOverrideInput,
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

console.log("④-b 함의 시수 행 — 업로드 시수표(창체·SLAT 행 없음) 보강용");
{
  // 신 교육과정 1학년 1반: 창체 금5 + SLAT 수6·수7 → 창체 1시간·SLAT 2시간
  const blocks = expandCohortFixedBlocks([NEW], 2026, [{ grade: 1, classNum: 1 }], "t1");
  const implied = impliedHoursFromFixedBlocks(blocks);
  check("행 수 2 (과목별 집계)", implied.length === 2, JSON.stringify(implied));
  const changhe = implied.find((r) => r.subjectName === "창체");
  const slat = implied.find((r) => r.subjectName === "SLAT");
  check("창체 1시간", changhe?.hours === 1);
  check("SLAT 2시간", slat?.hours === 2);
  check(
    "가상 교사 규약 name:이름",
    implied.every((r) => r.teacherKey === `name:${r.subjectName}`)
  );
  check(
    "비활성 블록 제외",
    impliedHoursFromFixedBlocks(blocks.map((b) => ({ ...b, active: false }))).length === 0
  );
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

// ── 학년도 재정의 층 (fixed_slot_override_spec §8 케이스) ──────────

function override(
  id: string,
  effectiveFromSchoolYear: number,
  gradeSlots: FixedSlotOverride["gradeSlots"],
  active = true
): FixedSlotOverride {
  return {
    id,
    label: id,
    effectiveFromSchoolYear,
    gradeSlots,
    active,
    createdBy: "t@x.kr",
    updatedBy: "t@x.kr",
    updatedAt: 0,
  };
}

console.log("⑥ 재정의 해석 — resolveFixedSlots");
{
  // 재정의 없음 = 현행 동일 (코호트 폴백)
  const base = resolveFixedSlots(cohorts, [], 2026, 1);
  check("재정의 없음 → 코호트 슬롯 그대로", JSON.stringify(base.slots) === JSON.stringify(NEW.fixedSlots));
  check("재정의 없음 → 출처 cohort", base.source.kind === "cohort");

  // 전 학년 재정의 적용 (2026: 1·2학년 신, 3학년 구 — 각자 자기 교육과정 스탬프)
  const allGrades = override("chg-2026", 2026, {
    1: { basedOnCohortId: "new-2022", slots: [{ displayName: "창체", day: 3, period: 5 }] },
    2: { basedOnCohortId: "new-2022", slots: [{ displayName: "창체", day: 3, period: 5 }] },
    3: { basedOnCohortId: "old-2015", slots: [{ displayName: "창체", day: 3, period: 5 }] },
  });
  for (const g of [1, 2, 3]) {
    const r = resolveFixedSlots(cohorts, [allGrades], 2026, g);
    check(
      `전 학년 재정의 — ${g}학년 수5 창체`,
      r.source.kind === "override" && r.slots.length === 1 && r.slots[0].day === 3 && r.slots[0].period === 5
    );
  }

  // 학년 한정 — 담지 않은 학년은 코호트 폴백
  const only3 = override("g3-only", 2026, {
    3: { basedOnCohortId: "old-2015", slots: [] },
  });
  const r1 = resolveFixedSlots(cohorts, [only3], 2026, 1);
  check("학년 한정 — 1학년은 코호트 폴백", r1.source.kind === "cohort" && r1.slots.length === 3);
  // 빈 배열 = "고정 슬롯 없음"이라는 유효한 답 (none이 아니다)
  const r3 = resolveFixedSlots(cohorts, [only3], 2026, 3);
  check("빈 배열 — 슬롯 0이지만 출처는 override", r3.source.kind === "override" && r3.slots.length === 0);

  // 나중 학년도 재정의가 이전 것을 대체
  const older = override("chg-2026b", 2026, {
    1: { basedOnCohortId: "new-2022", slots: [{ displayName: "창체", day: 1, period: 1 }] },
  });
  const newer = override("chg-2028", 2028, {
    1: { basedOnCohortId: "new-2022", slots: [{ displayName: "창체", day: 2, period: 2 }] },
  });
  const r2028 = resolveFixedSlots(cohorts, [older, newer], 2028, 1);
  check("나중 재정의 우선 (2028)", r2028.source.kind === "override" && r2028.slots[0].day === 2);
  const r2027 = resolveFixedSlots(cohorts, [older, newer], 2027, 1);
  check("그 전 학년도(2027)는 이전 재정의", r2027.source.kind === "override" && r2027.slots[0].day === 1);
  // 비활성 무시
  const rInactive = resolveFixedSlots(cohorts, [override("x", 2026, older.gradeSlots, false)], 2026, 1);
  check("비활성 재정의 무시", rInactive.source.kind === "cohort");
}

console.log("⑦ 재정의 — 교육과정 불일치 부적용 (fail-loud)");
{
  // 2025학년도 2학년은 구(입학 2024)인데, 신 기준으로 만든 재정의가 굴러오면 비켜나야 한다
  const stale = override("stale", 2025, {
    2: { basedOnCohortId: "new-2022", slots: [{ displayName: "창체", day: 1, period: 1 }] },
  });
  const r = resolveFixedSlots(cohorts, [stale], 2025, 2);
  check(
    "불일치 → 코호트 폴백 (구 교육과정 슬롯)",
    r.source.kind === "cohort" && JSON.stringify(r.slots) === JSON.stringify(OLD.fixedSlots)
  );
  check("불일치 → skippedOverride 기록", r.skippedOverride?.overrideId === "stale");
  const skips = overrideSkipsForYear(cohorts, [stale], 2025, [1, 2, 3]);
  check("skips 수집 — 2학년 1건", skips.length === 1 && skips[0].grade === 2);
  // 코호트 없는 학년: null 스탬프면 적용, 아니면 none + skip
  const noCohortMatch = override("nc", 2014, {
    3: { basedOnCohortId: null, slots: [{ displayName: "창체", day: 1, period: 1 }] },
  });
  const rn = resolveFixedSlots(cohorts, [noCohortMatch], 2015, 3);
  check("코호트 없는 학년 + null 스탬프 → 적용", rn.source.kind === "override");
  const noCohortMismatch = override("ncm", 2014, {
    3: { basedOnCohortId: "new-2022", slots: [{ displayName: "창체", day: 1, period: 1 }] },
  });
  const rm = resolveFixedSlots(cohorts, [noCohortMismatch], 2015, 3);
  check("코호트 없고 스탬프 불일치 → none + skip", rm.source.kind === "none" && !!rm.skippedOverride);
}

console.log("⑧ 재정의 — 전개 통합");
{
  const classList = [
    { grade: 1, classNum: 1 },
    { grade: 3, classNum: 1 },
  ];
  // 3학년만 SL을 비우는 재정의 (고3 실사례 모양)
  const g3empty = override("g3-empty", 2026, {
    3: { basedOnCohortId: "old-2015", slots: [] },
  });
  const blocks = expandCohortFixedBlocks(cohorts, 2026, classList, "t1", [g3empty]);
  check(
    "3학년 빈 배열 → 3학년 엔트리 0",
    blocks.every((b) => b.entries.every((e) => e.grade !== 3))
  );
  check(
    "1학년은 코호트 전개 유지 (3칸)",
    blocks.filter((b) => b.entries.some((e) => e.grade === 1)).length === 3
  );
  // 재정의 인자 생략 = 현행 동일 (기존 시그니처 회귀 없음)
  const legacy = expandCohortFixedBlocks(cohorts, 2026, classList, "t1");
  const withEmpty = expandCohortFixedBlocks(cohorts, 2026, classList, "t1", []);
  check("overrides 생략 = [] = 현행 동일", JSON.stringify(legacy) === JSON.stringify(withEmpty));
}

console.log("⑨ 재정의 서버 검증 — validateOverrideInput");
{
  const okSlots = { slots: [{ displayName: "창체", day: 3, period: 5 }] };
  const ok = { label: "2027 변경", effectiveFromSchoolYear: 2027, gradeSlots: { 1: okSlots } };
  check("정상 통과", validateOverrideInput(ok, 2026) === null);
  check("빈 배열 학년 통과", validateOverrideInput({ ...ok, gradeSlots: { 3: { slots: [] } } }, 2026) === null);
  check("지난 학년도 거부", validateOverrideInput({ ...ok, effectiveFromSchoolYear: 2025 }, 2026) !== null);
  check("현재 학년도 허용", validateOverrideInput({ ...ok, effectiveFromSchoolYear: 2026 }, 2026) === null);
  check("학년 키 없음 거부", validateOverrideInput({ ...ok, gradeSlots: {} }, 2026) !== null);
  check("학년 범위 거부", validateOverrideInput({ ...ok, gradeSlots: { 4: okSlots } }, 2026) !== null);
  check(
    "학년 내 (요일,교시) 중복 거부",
    validateOverrideInput(
      {
        ...ok,
        gradeSlots: {
          1: { slots: [{ displayName: "창체", day: 3, period: 5 }, { displayName: "SLAT", day: 3, period: 5 }] },
        },
      },
      2026
    ) !== null
  );
  // 같은 학년도·같은 학년 충돌 거부 / 학년이 다르면 허용
  const other = override("other", 2027, { 1: { basedOnCohortId: null, slots: [] } });
  check("같은 학년도 학년 겹침 거부", validateOverrideInput(ok, 2026, [other]) !== null);
  check(
    "같은 학년도라도 학년이 다르면 허용",
    validateOverrideInput({ ...ok, gradeSlots: { 2: okSlots } }, 2026, [other]) === null
  );
  check(
    "비활성 기존 건과는 충돌 아님",
    validateOverrideInput(ok, 2026, [{ ...other, active: false }]) === null
  );
}

console.log("⑩ 학년도 계산 — 3월 시작 (KST)");
{
  check("3월 1일 → 그해", schoolYearOfDate(new Date("2026-03-01T00:00:00+09:00")) === 2026);
  check("2월 28일 → 전년도", schoolYearOfDate(new Date("2026-02-28T23:59:59+09:00")) === 2025);
  check("8월 → 그해", schoolYearOfDate(new Date("2026-08-21T12:00:00+09:00")) === 2026);
  // UTC로 같은 순간을 넣어도 같은 답 (서버는 UTC로 돈다)
  check(
    "KST 자정 경계 — UTC 표기와 동일",
    schoolYearOfDate(new Date("2026-02-28T15:00:00Z")) === 2026,
    "KST 3/1 00:00"
  );
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
