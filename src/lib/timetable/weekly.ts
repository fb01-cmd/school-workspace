/**
 * Phase 9b: 주간 시간표 합성 (기초 + 변경 오버레이) — 순수 함수, Firestore 의존 없음
 *
 * 상위 스펙: phase9b_spec.md §3
 * 원칙: 주간 실제 시간표 = 기초(classGrids) + 그 주 changes를 appliedAt 순서로 적용.
 *       합성본은 어디에도 저장하지 않는다. 적용 불능 change는 건너뛰고 경고로 수집한다.
 */

import {
  ClassGrid,
  SwapChangeSlot,
  TimetableChange,
  TimetableSettings,
  TimetableWeek,
  WeeklyCell,
  WeeklyClassGrid,
  WeeklyLesson,
  WeeklySynthesisResult,
} from "./types";

// ── 슬롯 유효성 ───────────────────────────────────────────────

/** 해당 주·학년·요일의 실제 교시 수 (휴업일 0, 축소 시수 반영) */
export function periodsForGradeDay(
  week: TimetableWeek,
  settings: TimetableSettings,
  grade: number,
  day: number
): number {
  const wd = (week.days || []).find((d) => d.day === day);
  if (!wd) return 0; // 주 등록에 없는 요일은 운영하지 않음
  if (wd.holiday) return 0;
  const override = wd.periodsByGrade?.[String(grade)];
  if (override !== undefined && Number.isFinite(Number(override))) return Number(override);
  return settings.periodsPerDay;
}

export function isSlotWithinWeek(
  week: TimetableWeek,
  settings: TimetableSettings,
  grade: number,
  day: number,
  period: number
): boolean {
  return period >= 1 && period <= periodsForGradeDay(week, settings, grade, day);
}

// ── 합성 내부 헬퍼 ────────────────────────────────────────────

function deepCopyGrids(grids: ClassGrid[]): WeeklyClassGrid[] {
  return grids.map((g) => ({
    grade: g.grade,
    classNum: g.classNum,
    cells: (g.cells || []).map((c) => ({
      day: c.day,
      period: c.period,
      lessons: (c.lessons || []).map((l) => ({
        subjectName: l.subjectName,
        subjectShort: l.subjectShort,
        teachers: (l.teachers || []).map((t) => ({ email: t.email, name: t.name })),
        ...(l.room ? { room: l.room } : {}),
      })),
    })),
  }));
}

function findGrid(grids: WeeklyClassGrid[], grade: number, classNum: number): WeeklyClassGrid | undefined {
  return grids.find((g) => g.grade === grade && g.classNum === classNum);
}

/** 셀을 찾고, 없으면(기초에서 빈 슬롯) 새로 만들어 반환 */
function ensureCell(grid: WeeklyClassGrid, day: number, period: number): WeeklyCell {
  let cell = grid.cells.find((c) => c.day === day && c.period === period);
  if (!cell) {
    cell = { day, period, lessons: [] };
    grid.cells.push(cell);
  }
  return cell;
}

/** 슬롯에서 특정 과목·교사의 lesson을 찾음 */
function findLesson(
  grid: WeeklyClassGrid,
  slot: SwapChangeSlot
): { cell: WeeklyCell; lesson: WeeklyLesson; index: number } | null {
  const cell = grid.cells.find((c) => c.day === slot.day && c.period === slot.period);
  if (!cell) return null;
  const idx = cell.lessons.findIndex(
    (l) =>
      l.subjectName === slot.subjectName &&
      (l.teachers || []).some(
        (t) => (t.email || "").trim().toLowerCase() === slot.teacherEmail.trim().toLowerCase()
      )
  );
  if (idx < 0) return null;
  return { cell, lesson: cell.lessons[idx], index: idx };
}

function removeEmptyCell(grid: WeeklyClassGrid, cell: WeeklyCell): void {
  if (cell.lessons.length === 0) {
    const i = grid.cells.indexOf(cell);
    if (i >= 0) grid.cells.splice(i, 1);
  }
}

function changeLabel(ch: TimetableChange): string {
  if (ch.type === "swap" && ch.swap) {
    const s = ch.swap;
    return `swap ${s.grade}-${s.classNum} (${s.a.day},${s.a.period})↔(${s.b.day},${s.b.period})`;
  }
  if (ch.type === "substitute" && ch.substitute) {
    const s = ch.substitute;
    return `substitute ${s.grade}-${s.classNum} (${s.day},${s.period}) ${s.absentTeacherName}→${s.subTeacherName}`;
  }
  if (ch.type === "revert") return `revert of ${ch.revertOf}`;
  return ch.type;
}

// ── swap / substitute 적용 (revert는 방향만 반대) ─────────────

function applySwap(
  grids: WeeklyClassGrid[],
  ch: TimetableChange,
  reversed: boolean,
  warnings: string[]
): boolean {
  const s = ch.swap!;
  const grid = findGrid(grids, s.grade, s.classNum);
  if (!grid) {
    warnings.push(`[${ch.id}] 학급 ${s.grade}-${s.classNum} 그리드 없음 — 건너뜀 (${changeLabel(ch)})`);
    return false;
  }
  // reversed(취소)면 현재 상태에서 a lesson이 b슬롯에, b lesson이 a슬롯에 있어야 함
  const slotA: SwapChangeSlot = reversed ? { ...s.a, day: s.b.day, period: s.b.period } : s.a;
  const slotB: SwapChangeSlot = reversed ? { ...s.b, day: s.a.day, period: s.a.period } : s.b;

  const foundA = findLesson(grid, slotA);
  const foundB = findLesson(grid, slotB);
  if (!foundA || !foundB) {
    warnings.push(
      `[${ch.id}] 대상 슬롯 상태 불일치 — 건너뜀 (${changeLabel(ch)}${reversed ? " 취소" : ""})`
    );
    return false;
  }

  // 각자 상대 슬롯으로 이동
  foundA.cell.lessons.splice(foundA.cell.lessons.indexOf(foundA.lesson), 1);
  foundB.cell.lessons.splice(foundB.cell.lessons.indexOf(foundB.lesson), 1);
  const destA = ensureCell(grid, slotB.day, slotB.period);
  const destB = ensureCell(grid, slotA.day, slotA.period);

  if (reversed) {
    // 원상 복구: changed 마킹 제거
    delete foundA.lesson.changed;
    delete foundB.lesson.changed;
  } else {
    foundA.lesson.changed = { changeId: ch.id, type: "swap", origin: { day: slotA.day, period: slotA.period } };
    foundB.lesson.changed = { changeId: ch.id, type: "swap", origin: { day: slotB.day, period: slotB.period } };
  }
  destA.lessons.push(foundA.lesson);
  destB.lessons.push(foundB.lesson);
  removeEmptyCell(grid, foundA.cell);
  removeEmptyCell(grid, foundB.cell);
  return true;
}

function applySubstitute(
  grids: WeeklyClassGrid[],
  ch: TimetableChange,
  reversed: boolean,
  warnings: string[]
): boolean {
  const s = ch.substitute!;
  const grid = findGrid(grids, s.grade, s.classNum);
  if (!grid) {
    warnings.push(`[${ch.id}] 학급 ${s.grade}-${s.classNum} 그리드 없음 — 건너뜀 (${changeLabel(ch)})`);
    return false;
  }
  // 정방향: 결강 교사의 lesson을 찾아 보강 교사로 교체 / 취소: 보강 교사 lesson을 원 교사로 복구
  const targetEmail = reversed ? s.subTeacherEmail : s.absentTeacherEmail;
  const targetSubject = reversed ? (s.subSubjectName || s.subjectName) : s.subjectName;
  const found = findLesson(grid, {
    day: s.day,
    period: s.period,
    subjectName: targetSubject,
    teacherEmail: targetEmail,
    teacherName: "",
  });
  if (!found) {
    warnings.push(
      `[${ch.id}] 대상 슬롯 상태 불일치 — 건너뜀 (${changeLabel(ch)}${reversed ? " 취소" : ""})`
    );
    return false;
  }
  if (reversed) {
    found.lesson.teachers = [{ email: s.absentTeacherEmail, name: s.absentTeacherName }];
    found.lesson.subjectName = s.subjectName;
    delete found.lesson.changed;
  } else {
    found.lesson.teachers = [{ email: s.subTeacherEmail, name: s.subTeacherName }];
    if (s.subSubjectName) found.lesson.subjectName = s.subSubjectName;
    found.lesson.changed = { changeId: ch.id, type: "substitute" };
  }
  return true;
}

// ── 메인 합성 ─────────────────────────────────────────────────

/**
 * 주간 시간표 합성.
 * @param baseGrids 기초 학급 그리드 (9a import 결과)
 * @param week 주 등록 문서
 * @param changes 그 주의 변경 로그 (appliedAt 오름차순 정렬 필수 — 호출부 책임이지만 방어 정렬함)
 */
export function synthesizeWeeklyGrids(
  baseGrids: ClassGrid[],
  week: TimetableWeek,
  changes: TimetableChange[],
  settings: TimetableSettings
): WeeklySynthesisResult {
  const warnings: string[] = [];
  const grids = deepCopyGrids(baseGrids);

  // 1. 휴업일·축소 시수 슬롯 제거
  for (const grid of grids) {
    grid.cells = grid.cells.filter((c) =>
      isSlotWithinWeek(week, settings, grid.grade, c.day, c.period)
    );
  }

  // 2. changes 순차 적용
  const sorted = [...changes].sort((a, b) => a.appliedAt - b.appliedAt);
  const applied = new Map<string, TimetableChange>(); // 적용 성공한 change
  const reverted = new Set<string>(); // 취소된 changeId

  for (const ch of sorted) {
    if (ch.type === "swap" && ch.swap) {
      if (applySwap(grids, ch, false, warnings)) applied.set(ch.id, ch);
    } else if (ch.type === "substitute" && ch.substitute) {
      if (applySubstitute(grids, ch, false, warnings)) applied.set(ch.id, ch);
    } else if (ch.type === "revert" && ch.revertOf) {
      const target = applied.get(ch.revertOf);
      if (!target) {
        warnings.push(`[${ch.id}] 취소 대상(${ch.revertOf})이 미적용 상태 — 건너뜀`);
        continue;
      }
      if (reverted.has(ch.revertOf)) {
        warnings.push(`[${ch.id}] 이미 취소된 변경(${ch.revertOf})의 이중 취소 — 건너뜀`);
        continue;
      }
      const ok =
        target.type === "swap"
          ? applySwap(grids, target, true, warnings)
          : applySubstitute(grids, target, true, warnings);
      if (ok) reverted.add(ch.revertOf);
    } else {
      warnings.push(`[${ch.id}] 알 수 없는 변경 형식(${ch.type}) — 건너뜀`);
    }
  }

  // 3. 셀 정렬 (조회 안정성)
  for (const grid of grids) {
    grid.cells.sort((a, b) => a.day - b.day || a.period - b.period);
  }

  return { grids, integrityWarnings: warnings };
}

// ── 시수·집계 헬퍼 (엔진 정렬·9b-4 공유) ──────────────────────

/** 이번 학기 특별보강 누계 (취소 반영) — email(소문자) → 횟수 */
export function countSubstituteTotals(allChanges: TimetableChange[]): Map<string, number> {
  const reverted = new Set(
    allChanges.filter((c) => c.type === "revert" && c.revertOf).map((c) => c.revertOf as string)
  );
  const totals = new Map<string, number>();
  for (const ch of allChanges) {
    if (ch.type !== "substitute" || !ch.substitute || reverted.has(ch.id)) continue;
    const email = ch.substitute.subTeacherEmail.trim().toLowerCase();
    totals.set(email, (totals.get(email) || 0) + 1);
  }
  return totals;
}
