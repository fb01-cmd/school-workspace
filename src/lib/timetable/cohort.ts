/**
 * 교육과정 코호트 → 학년 역산 + 고정 슬롯 전개 (9c-H §2-3)
 *
 * 「학년」은 해마다 뜻이 바뀌는 축이다 — 등록은 교육과정(입학년도) 단위로 하고,
 * 학년은 여기서만 파생한다. **이 파일 밖에서 학년 = 학년도 − 입학년도 + 1 을 계산하지 않는다.**
 *
 * 컴파일러(compileSectionsFromHours)는 학년 축을 모른다 — 전개 결과(학급 단위 FixedBlock)만
 * 넘긴다. 그 경계를 지켜야 코호트 축 변경이 솔버로 번지지 않는다.
 */
import { CohortFixedSlot, CurriculumCohort, FixedBlock, HoursPlanRow, HoursRequirement } from "./types";

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

/** 컴파일러 입력용 — 학급 단위 FixedBlock 전개.
 *  같은 (요일, 교시)의 여러 학급은 한 블록의 entries로 묶는다(컴시간 §6-나 일괄 배정과 동형).
 *  교육과정이 다른 학년이 같은 칸을 쓰면 displayName이 달라도 entries가 각자의 이름을 갖으므로 안전하다.
 *  entries의 subjectName = displayName — 컴파일러가 이 이름으로 시수표 행을 찾는다(표기 일치 필수).
 *  코호트가 없는 학년은 조용히 비운다 — 그 학년의 자리표시 시수는 컴파일러 fixed-missing 이슈로 드러난다. */
export function expandCohortFixedBlocks(
  cohorts: CurriculumCohort[],
  schoolYear: number,
  classList: Array<{ grade: number; classNum: number }>,
  termId = ""
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
    const cohort = cohortForGrade(cohorts, schoolYear, grade);
    if (!cohort) continue;
    for (const slot of cohort.fixedSlots) {
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
