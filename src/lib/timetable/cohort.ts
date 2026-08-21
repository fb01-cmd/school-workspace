/**
 * 교육과정 코호트 → 학년 역산 + 고정 슬롯 전개 (9c-H §2-3)
 *
 * 「학년」은 해마다 뜻이 바뀌는 축이다 — 등록은 교육과정(입학년도) 단위로 하고,
 * 학년은 여기서만 파생한다. **이 파일 밖에서 학년 = 학년도 − 입학년도 + 1 을 계산하지 않는다.**
 *
 * 컴파일러(compileSectionsFromHours)는 학년 축을 모른다 — 전개 결과(학급 단위 FixedBlock)만
 * 넘긴다. 그 경계를 지켜야 코호트 축 변경이 솔버로 번지지 않는다.
 */
import {
  CohortFixedSlot,
  CurriculumCohort,
  FixedBlock,
  FixedSlotOverride,
  HoursPlanRow,
  HoursRequirement,
} from "./types";

/** 학년도 계산의 단일 소재지 (fixed_slot_override_spec §3) — KST 기준, 3월 1일 시작.
 *  1~2월은 전년도 학년도다. new Date().getFullYear()를 학년도로 쓰지 않는다. */
export function schoolYearOfDate(d: Date): number {
  // KST = UTC+9. 서버(UTC)·클라이언트(KST) 어디서 돌아도 같은 답이 나오게 UTC로 환산한다.
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  return kst.getUTCMonth() + 1 >= 3 ? year : year - 1;
}

/** 특정 학년도의 특정 학년이 따르는 교육과정 — 적용 시작 입학년도가 그 이하인 것 중 가장 최근 것 */
export function cohortForGrade(
  cohorts: CurriculumCohort[],
  schoolYear: number,
  grade: number
): CurriculumCohort | null {
  const admissionYear = schoolYear - grade + 1;
  return (
    cohorts
      .filter((c) => c.active && c.startAdmissionYear <= admissionYear)
      .sort((a, b) => b.startAdmissionYear - a.startAdmissionYear)[0] ?? null
  );
}

/** 화면 안내문용 — 특정 학년도에 이 교육과정을 따르는 학년 목록 (오름차순).
 *  "2026학년도 기준: 1학년 · 2학년이 이 교육과정을 따릅니다"의 단일 출처. */
export function gradesForCohort(
  cohorts: CurriculumCohort[],
  cohortId: string,
  schoolYear: number,
  maxGrade = 3
): number[] {
  const grades: number[] = [];
  for (let g = 1; g <= maxGrade; g++) {
    if (cohortForGrade(cohorts, schoolYear, g)?.id === cohortId) grades.push(g);
  }
  return grades;
}

/** (학년도, 학년)의 최종 고정 슬롯과 그 출처 (fixed_slot_override_spec §2) */
export interface ResolvedGradeSlots {
  slots: CohortFixedSlot[];
  source:
    | { kind: "override"; overrideId: string; label: string }
    | { kind: "cohort"; cohortId: string; label: string }
    | { kind: "none" };
  /** 최신 재정의가 있었으나 교육과정 불일치로 적용하지 않은 경우 — 화면·사전점검 안내용 */
  skippedOverride?: { overrideId: string; label: string };
}

/** 재정의 적용 판정의 단일 소재지 (fixed_slot_override_spec §2) —
 *  이 함수 밖에서 재정의 적용 여부를 판정하지 않는다.
 *  ① active·effectiveFromSchoolYear ≤ 학년도·해당 학년 키 보유인 재정의 중 가장 최근 것 하나를 고른다
 *    (같은 학년도·같은 학년의 중복은 validateOverrideInput이 저장에서 막으므로 유일하다).
 *  ② 작성 당시 교육과정(basedOnCohortId)이 지금과 다르면 적용하지 않는다 — 더 오래된
 *    재정의로 내려가지도 않고(그쪽은 더 낡았다) 코호트로 폴백하며 skippedOverride에 남긴다. */
export function resolveFixedSlots(
  cohorts: CurriculumCohort[],
  overrides: FixedSlotOverride[],
  schoolYear: number,
  grade: number
): ResolvedGradeSlots {
  const cohort = cohortForGrade(cohorts, schoolYear, grade);
  const candidate = overrides
    .filter((o) => o.active && o.effectiveFromSchoolYear <= schoolYear && o.gradeSlots?.[grade])
    .sort((a, b) => b.effectiveFromSchoolYear - a.effectiveFromSchoolYear)[0];

  if (candidate) {
    const gradeEntry = candidate.gradeSlots[grade];
    if (gradeEntry.basedOnCohortId === (cohort?.id ?? null)) {
      return {
        slots: gradeEntry.slots,
        source: { kind: "override", overrideId: candidate.id, label: candidate.label },
      };
    }
    // 교육과정 불일치 — 조용히 틀리는 대신 소리 내며 비켜난다 (fail-loud)
    const skipped = { overrideId: candidate.id, label: candidate.label };
    if (cohort) {
      return {
        slots: cohort.fixedSlots,
        source: { kind: "cohort", cohortId: cohort.id, label: cohort.label },
        skippedOverride: skipped,
      };
    }
    return { slots: [], source: { kind: "none" }, skippedOverride: skipped };
  }

  if (cohort) {
    return {
      slots: cohort.fixedSlots,
      source: { kind: "cohort", cohortId: cohort.id, label: cohort.label },
    };
  }
  return { slots: [], source: { kind: "none" } };
}

/** 사전점검 안내용 — 교육과정 불일치로 적용되지 않은 재정의 수집 (학년 오름차순) */
export function overrideSkipsForYear(
  cohorts: CurriculumCohort[],
  overrides: FixedSlotOverride[],
  schoolYear: number,
  grades: number[]
): Array<{ grade: number; overrideId: string; label: string }> {
  const skips: Array<{ grade: number; overrideId: string; label: string }> = [];
  for (const grade of [...grades].sort((a, b) => a - b)) {
    const r = resolveFixedSlots(cohorts, overrides, schoolYear, grade);
    if (r.skippedOverride) skips.push({ grade, ...r.skippedOverride });
  }
  return skips;
}

/** 컴파일러 입력용 — 학급 단위 FixedBlock 전개.
 *  같은 (요일, 교시)의 여러 학급은 한 블록의 entries로 묶는다(컴시간 §6-나 일괄 배정과 동형).
 *  교육과정이 다른 학년이 같은 칸을 쓰면 displayName이 달라도 entries가 각자의 이름을 갖으므로 안전하다.
 *  entries의 subjectName = displayName — 컴파일러가 이 이름으로 시수표 행을 찾는다(표기 일치 필수).
 *  코호트가 없는 학년은 조용히 비운다 — 그 학년의 자리표시 시수는 컴파일러 fixed-missing 이슈로 드러난다.
 *  overrides가 있으면 학년별 슬롯을 resolveFixedSlots가 정한다(재정의 우선, 불일치 시 코호트 폴백).
 *  부적용 통지는 overrideSkipsForYear가 따로 뽑는다 — 반환형(FixedBlock[])은 그대로라 컴파일러는 이 층을 모른다. */
export function expandCohortFixedBlocks(
  cohorts: CurriculumCohort[],
  schoolYear: number,
  classList: Array<{ grade: number; classNum: number }>,
  termId = "",
  overrides: FixedSlotOverride[] = []
): FixedBlock[] {
  // (day|period) → entries. 결정론을 위해 학급 목록을 정렬해 소비한다.
  const sorted = [...classList].sort((a, b) => a.grade - b.grade || a.classNum - b.classNum);
  const byGrade = new Map<number, Array<{ grade: number; classNum: number }>>();
  for (const c of sorted) {
    if (!byGrade.has(c.grade)) byGrade.set(c.grade, []);
    byGrade.get(c.grade)!.push(c);
  }

  const blocks = new Map<
    string,
    { day: number; period: number; names: Set<string>; entries: FixedBlock["entries"] }
  >();
  for (const [grade, classes] of [...byGrade.entries()].sort((a, b) => a[0] - b[0])) {
    const resolved = resolveFixedSlots(cohorts, overrides, schoolYear, grade);
    for (const slot of resolved.slots) {
      const key = `${slot.day}|${slot.period}`;
      if (!blocks.has(key)) {
        blocks.set(key, { day: slot.day, period: slot.period, names: new Set(), entries: [] });
      }
      const b = blocks.get(key)!;
      b.names.add(slot.displayName);
      for (const c of classes) {
        b.entries.push({
          grade: c.grade,
          classNum: c.classNum,
          subjectName: slot.displayName,
          // 자리표시(가상 교사)는 이름으로 식별된다 — 검사기 H1의 교사 확인용
          teacherName: slot.displayName,
        });
      }
    }
  }

  return [...blocks.values()]
    .sort((a, b) => a.day - b.day || a.period - b.period)
    .map((b) => ({
      termId,
      label: `교육과정 고정: ${[...b.names].sort().join("·")}`,
      day: b.day,
      period: b.period,
      entries: b.entries,
      active: true,
    }));
}

/** 고정 슬롯이 함의하는 시수표 행 (9c-H §0-1a-③ⓒ) — 업로드 실물 시수표에는 창체·SLAT 행이
 *  없으므로, 컴파일·검사(H1/H4 시수표 대조) 전에 이 행들을 시수표에 보태야 한다.
 *  teacherKey는 가상 교사 규약 "name:이름" (validate.ts teacherKeyOf와 동일 규약). */
export function impliedHoursFromFixedBlocks(blocks: FixedBlock[]): HoursRequirement[] {
  const counts = new Map<string, HoursRequirement>();
  for (const b of blocks) {
    if (!b.active) continue;
    for (const e of b.entries) {
      const name = e.teacherName || e.subjectName;
      const key = `${e.grade}-${e.classNum}|${e.subjectName}|${name}`;
      const row = counts.get(key);
      if (row) row.hours += 1;
      else
        counts.set(key, {
          grade: e.grade,
          classNum: e.classNum,
          subjectName: e.subjectName,
          teacherKey: `name:${name}`,
          hours: 1,
        });
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.grade - b.grade || a.classNum - b.classNum || a.subjectName.localeCompare(b.subjectName)
  );
}

/**
 * 계획 행 → 시수표 행 변환 (phase9c_i_spec §3)
 * 계획 행 + 코호트 함의 행 결합 및 가상 교사 이중 계상 방지
 */
export function hoursFromPlanRows(
  rows: HoursPlanRow[],
  fixedBlocks: FixedBlock[]
): { hours: HoursRequirement[]; droppedVirtual: number } {
  const implied = impliedHoursFromFixedBlocks(fixedBlocks);
  const impliedKeys = new Set(implied.map((r) => `${r.grade}-${r.classNum}|${r.subjectName}`));

  const toHoursRequirement = (row: HoursPlanRow): HoursRequirement => {
    const teacherKey = row.teacherEmail.trim()
      ? row.teacherEmail.trim()
      : `name:${row.teacherName}`;
    return {
      grade: row.grade,
      classNum: row.classNum,
      subjectName: row.subjectName,
      teacherKey,
      hours: row.hours,
      // 9c-I-2: 힌트 패스스루 — 컴파일러가 소속·특별실 추정 대신 쓴다 (phase9c_i2_spec §2)
      simulGroupId: row.simulGroupId ?? null,
      venueHours: row.venueHours ?? null,
    };
  };

  const planHours = rows
    .map(toHoursRequirement)
    .filter(
      (r) =>
        !(
          r.teacherKey.startsWith("name:") &&
          impliedKeys.has(`${r.grade}-${r.classNum}|${r.subjectName}`)
        )
    );

  return {
    hours: [...planHours, ...implied],
    droppedVirtual: rows.length - planHours.length,
  };
}

/** 서버 검증 (9c-H §2-4) — 통과하면 null, 아니면 첫 번째 문제 문구 */
export function validateCohortInput(cohort: {
  label?: unknown;
  startAdmissionYear?: unknown;
  fixedSlots?: unknown;
}): string | null {
  const label = cohort.label;
  if (typeof label !== "string" || !label.trim() || label.trim().length > 60) {
    return "교육과정 이름은 1~60자여야 합니다";
  }
  const y = cohort.startAdmissionYear;
  if (typeof y !== "number" || !Number.isInteger(y) || y < 1900 || y > 2200) {
    return "적용 시작 입학년도는 1900~2200 사이 정수여야 합니다";
  }
  const slots = cohort.fixedSlots;
  if (!Array.isArray(slots) || slots.length > 50) {
    return "고정 시간은 최대 50칸까지 등록할 수 있습니다";
  }
  const seen = new Set<string>();
  for (const s of slots as Array<Partial<CohortFixedSlot>>) {
    if (typeof s?.displayName !== "string" || !s.displayName.trim() || s.displayName.trim().length > 30) {
      return "고정 시간 이름은 1~30자여야 합니다";
    }
    if (!Number.isInteger(s.day) || (s.day as number) < 1 || (s.day as number) > 5) {
      return "요일은 월~금(1~5)이어야 합니다";
    }
    if (!Number.isInteger(s.period) || (s.period as number) < 1 || (s.period as number) > 9) {
      return "교시는 1~9여야 합니다";
    }
    const key = `${s.day}|${s.period}`;
    if (seen.has(key)) return "같은 요일·교시에 고정 시간이 중복 등록되었습니다";
    seen.add(key);
  }
  return null;
}

/** 학년도 재정의 서버 검증 (fixed_slot_override_spec §4) — 통과하면 null, 아니면 첫 번째 문제 문구.
 *  otherActiveOverrides = 저장 대상을 제외한 나머지 재정의 (충돌 검사용). */
export function validateOverrideInput(
  override: {
    label?: unknown;
    effectiveFromSchoolYear?: unknown;
    gradeSlots?: unknown;
  },
  currentSchoolYear: number,
  otherActiveOverrides: FixedSlotOverride[] = [],
  maxGrade = 3
): string | null {
  const label = override.label;
  if (typeof label !== "string" || !label.trim() || label.trim().length > 60) {
    return "이름은 1~60자여야 합니다";
  }
  const y = override.effectiveFromSchoolYear;
  if (typeof y !== "number" || !Number.isInteger(y) || y > 2200) {
    return "적용 학년도는 2200 이하의 정수여야 합니다";
  }
  if (y < currentSchoolYear) {
    return `지난 학년도(${y}학년도)부터 적용되는 변경은 만들거나 고칠 수 없습니다 — 지난 기록은 그대로 보존됩니다. 올해(${currentSchoolYear}학년도) 이후로 적용 학년도를 정해 주세요`;
  }
  const gradeSlots = override.gradeSlots;
  if (!gradeSlots || typeof gradeSlots !== "object" || Array.isArray(gradeSlots)) {
    return "학년별 배치 내용이 없습니다";
  }
  const gradeKeys = Object.keys(gradeSlots as object);
  if (gradeKeys.length === 0) {
    return "적어도 한 학년의 배치를 담아야 합니다";
  }
  for (const gk of gradeKeys) {
    const grade = Number(gk);
    if (!Number.isInteger(grade) || grade < 1 || grade > maxGrade) {
      return `학년은 1~${maxGrade}이어야 합니다`;
    }
    const entry = (gradeSlots as Record<string, { slots?: unknown }>)[gk];
    const slots = entry?.slots;
    // 빈 배열은 "이 학년은 고정 슬롯 없음"이라는 유효한 답이다 — 배열이기만 하면 된다
    if (!Array.isArray(slots) || slots.length > 50) {
      return "고정 시간은 학년마다 최대 50칸까지 등록할 수 있습니다";
    }
    const seen = new Set<string>();
    for (const s of slots as Array<Partial<CohortFixedSlot>>) {
      if (
        typeof s?.displayName !== "string" ||
        !s.displayName.trim() ||
        s.displayName.trim().length > 30
      ) {
        return "고정 시간 이름은 1~30자여야 합니다";
      }
      if (!Number.isInteger(s.day) || (s.day as number) < 1 || (s.day as number) > 5) {
        return "요일은 월~금(1~5)이어야 합니다";
      }
      if (!Number.isInteger(s.period) || (s.period as number) < 1 || (s.period as number) > 9) {
        return "교시는 1~9여야 합니다";
      }
      const key = `${s.day}|${s.period}`;
      if (seen.has(key)) return "같은 학년의 같은 요일·교시에 고정 시간이 중복 등록되었습니다";
      seen.add(key);
    }
  }
  // 해석 규칙(§2)의 "가장 최근 것 하나"가 항상 유일하도록 — 같은 학년도·같은 학년 충돌 금지
  for (const other of otherActiveOverrides) {
    if (!other.active || other.effectiveFromSchoolYear !== y) continue;
    const overlap = gradeKeys.filter((gk) => other.gradeSlots?.[Number(gk)]);
    if (overlap.length > 0) {
      return `「${other.label}」이 이미 ${y}학년도의 ${overlap.join("·")}학년을 담고 있습니다 — 같은 학년도의 같은 학년은 한 건에만 담을 수 있습니다`;
    }
  }
  return null;
}
