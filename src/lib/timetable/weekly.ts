/**
 * Phase 9b: 주간 시간표 합성 (기초 + 변경 오버레이) — 순수 함수, Firestore 의존 없음
 *
 * 상위 스펙: phase9b_spec.md §3
 * 원칙: 주간 실제 시간표 = 기초(classGrids) + 그 주 changes를 appliedAt 순서로 적용.
 *       합성본은 어디에도 저장하지 않는다. 적용 불능 change는 건너뛰고 경고로 수집한다.
 */

import {
  ClassGrid,
  CrossSwapLessonRef,
  NeisRow,
  SwapChangeSlot,
  SwapRequestType,
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
        ...(l.simul ? { simul: l.simul } : {}),
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
  if (ch.type === "cross_swap" && ch.crossSwap) {
    const s = ch.crossSwap;
    return `cross_swap ${s.grade}-${s.classNum} (${s.day},${s.period}) ${s.out.teacherName}→${s.in.teacherName} (상대 주 ${s.otherWeekId})`;
  }
  if (ch.type === "move" && ch.move) {
    const m = ch.move;
    return `move ${m.grade}-${m.classNum} (${m.from.day},${m.from.period})→(${m.to.day},${m.to.period}) ${m.subjectName}`;
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

/**
 * 상대 없는 단순 이동 적용 (consent_swap_opening_spec §5b-1) — from 슬롯의 (과목·교사 일치)
 * lesson을 to 슬롯으로 재배치. reversed(취소)는 to→from 복원 + changed 제거.
 * 대상 불일치 시 기존과 동일하게 경고+건너뜀 (fail-soft).
 */
function applyMove(
  grids: WeeklyClassGrid[],
  ch: TimetableChange,
  reversed: boolean,
  warnings: string[]
): boolean {
  const m = ch.move!;
  const grid = findGrid(grids, m.grade, m.classNum);
  if (!grid) {
    warnings.push(`[${ch.id}] 학급 ${m.grade}-${m.classNum} 그리드 없음 — 건너뜀 (${changeLabel(ch)})`);
    return false;
  }
  const fromSlot = reversed ? m.to : m.from;
  const toSlot = reversed ? m.from : m.to;
  const found = findLesson(grid, {
    day: fromSlot.day,
    period: fromSlot.period,
    subjectName: m.subjectName,
    teacherEmail: m.teacherEmail,
    teacherName: m.teacherName,
  });
  if (!found) {
    warnings.push(
      `[${ch.id}] 대상 슬롯 상태 불일치 — 건너뜀 (${changeLabel(ch)}${reversed ? " 취소" : ""})`
    );
    return false;
  }
  found.cell.lessons.splice(found.index, 1);
  const dest = ensureCell(grid, toSlot.day, toSlot.period);
  if (reversed) {
    delete found.lesson.changed;
  } else {
    found.lesson.changed = { changeId: ch.id, type: "move", origin: { day: m.from.day, period: m.from.period } };
  }
  dest.lessons.push(found.lesson);
  removeEmptyCell(grid, found.cell);
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

/**
 * 교차 주 맞교환 적용 (phase9b_spec §4-3b) — 이 주(weekId) 문서의 셀 1개 치환.
 * 셀 현재 수업이 out과 일치할 때만 in으로 치환. reversed(취소)면 in→out으로 복원.
 */
function applyCrossSwap(
  grids: WeeklyClassGrid[],
  ch: TimetableChange,
  reversed: boolean,
  warnings: string[]
): boolean {
  const s = ch.crossSwap!;
  const grid = findGrid(grids, s.grade, s.classNum);
  if (!grid) {
    warnings.push(`[${ch.id}] 학급 ${s.grade}-${s.classNum} 그리드 없음 — 건너뜀 (${changeLabel(ch)})`);
    return false;
  }
  const outRef: CrossSwapLessonRef = reversed ? s.in : s.out;
  const inRef: CrossSwapLessonRef = reversed ? s.out : s.in;
  const found = findLesson(grid, {
    day: s.day,
    period: s.period,
    subjectName: outRef.subjectName,
    teacherEmail: outRef.teacherEmail,
    teacherName: outRef.teacherName,
  });
  if (!found) {
    warnings.push(
      `[${ch.id}] 대상 슬롯 상태 불일치 — 건너뜀 (${changeLabel(ch)}${reversed ? " 취소" : ""})`
    );
    return false;
  }
  found.cell.lessons.splice(found.index, 1);
  const replacement: WeeklyLesson = {
    subjectName: inRef.subjectName,
    subjectShort: inRef.subjectShort,
    teachers: [{ email: inRef.teacherEmail, name: inRef.teacherName }],
    ...(inRef.room ? { room: inRef.room } : {}),
    ...(reversed
      ? {}
      : { changed: { changeId: ch.id, type: "cross_swap" as const, otherWeekId: s.otherWeekId } }),
  };
  found.cell.lessons.push(replacement);
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
    } else if (ch.type === "cross_swap" && ch.crossSwap) {
      if (applyCrossSwap(grids, ch, false, warnings)) applied.set(ch.id, ch);
    } else if (ch.type === "move" && ch.move) {
      if (applyMove(grids, ch, false, warnings)) applied.set(ch.id, ch);
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
          : target.type === "cross_swap"
            ? applyCrossSwap(grids, target, true, warnings)
            : target.type === "move"
              ? applyMove(grids, target, true, warnings)
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

// ── 운영 도구 (phase9b_spec §8 — 순수 함수) ───────────────────

/**
 * NEIS 입력용 수업교환 목록 평탄화 — 컴시간 양식 계승 (§8).
 * revert된 변경·revert 기록 자체는 제외. swap 1건 = 교사별 2행, substitute 1건 = 1행.
 * 행의 날짜(변경 있는 교시 기준)가 [startDate, endDate] 안에 드는 것만 반환.
 */
export function flattenNeisChanges(
  weeks: TimetableWeek[],
  changes: TimetableChange[],
  filter: { startDate: string; endDate: string; type?: SwapRequestType }
): NeisRow[] {
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const reverted = new Set(
    changes.filter((c) => c.type === "revert" && c.revertOf).map((c) => c.revertOf as string)
  );
  const dateOf = (weekId: string, day: number): string =>
    weekById.get(weekId)?.days.find((d) => d.day === day)?.date || "";

  // 교차 주 문서쌍: exchangeId → 문서들 (자기 문서의 "변경전 교시"는 짝 문서의 슬롯 — §4-3b)
  const crossByExchange = new Map<string, TimetableChange[]>();
  for (const ch of changes) {
    if (ch.type === "cross_swap" && ch.crossSwap) {
      const list = crossByExchange.get(ch.crossSwap.exchangeId) || [];
      list.push(ch);
      crossByExchange.set(ch.crossSwap.exchangeId, list);
    }
  }

  const rows: NeisRow[] = [];
  for (const ch of changes) {
    if (reverted.has(ch.id)) continue;
    if (ch.type === "swap" && ch.swap && filter.type !== "substitute") {
      const { grade, classNum, a, b } = ch.swap;
      // a의 수업은 b 슬롯에서, b의 수업은 a 슬롯에서 진행된다
      const pairs: Array<[SwapChangeSlot, SwapChangeSlot]> = [
        [a, b],
        [b, a],
      ];
      for (const [moved, into] of pairs) {
        rows.push({
          changeId: ch.id,
          weekId: ch.weekId,
          type: "swap",
          grade,
          classNum,
          date: dateOf(ch.weekId, into.day),
          day: into.day,
          period: into.period,
          teacherName: moved.teacherName,
          teacherEmail: moved.teacherEmail,
          subjectName: moved.subjectName,
          prevDate: dateOf(ch.weekId, moved.day),
          prevDay: moved.day,
          prevPeriod: moved.period,
          note: "",
        });
      }
    } else if (ch.type === "cross_swap" && ch.crossSwap && filter.type !== "substitute") {
      // 교차 주 맞교환은 swap 계열 — 문서 1개 = 1행 (이 주 슬롯에서 진행되는 수업 in 기준),
      // 변경전 교시는 exchangeId 짝 문서(otherWeekId)의 슬롯 날짜로 표기 (§4-3b)
      const s = ch.crossSwap;
      const pair = (crossByExchange.get(s.exchangeId) || []).find((c) => c.id !== ch.id);
      const ps = pair?.crossSwap;
      rows.push({
        changeId: ch.id,
        weekId: ch.weekId,
        type: "cross_swap",
        grade: s.grade,
        classNum: s.classNum,
        date: dateOf(ch.weekId, s.day),
        day: s.day,
        period: s.period,
        teacherName: s.in.teacherName,
        teacherEmail: s.in.teacherEmail,
        subjectName: s.in.subjectName,
        prevDate: ps ? dateOf(pair!.weekId, ps.day) : "",
        prevDay: ps ? ps.day : s.day,
        prevPeriod: ps ? ps.period : s.period,
        note: `교차 주 맞교환 (${s.otherWeekId} 주와 교환)`,
      });
    } else if (ch.type === "move" && ch.move && filter.type !== "substitute") {
      // 통 이동의 빈 교시 반 — 상대 없는 이동 1행 (consent_swap_opening_spec §5b-6-1)
      const m = ch.move;
      rows.push({
        changeId: ch.id,
        weekId: ch.weekId,
        type: "move",
        grade: m.grade,
        classNum: m.classNum,
        date: dateOf(ch.weekId, m.to.day),
        day: m.to.day,
        period: m.to.period,
        teacherName: m.teacherName,
        teacherEmail: m.teacherEmail,
        subjectName: m.subjectName,
        prevDate: dateOf(ch.weekId, m.from.day),
        prevDay: m.from.day,
        prevPeriod: m.from.period,
        note: "이동수업 통 이동 (빈 교시로 이동)",
      });
    } else if (ch.type === "substitute" && ch.substitute && filter.type !== "swap") {
      const s = ch.substitute;
      const date = dateOf(ch.weekId, s.day);
      rows.push({
        changeId: ch.id,
        weekId: ch.weekId,
        type: "substitute",
        grade: s.grade,
        classNum: s.classNum,
        date,
        day: s.day,
        period: s.period,
        teacherName: s.absentTeacherName,
        teacherEmail: s.absentTeacherEmail,
        subjectName: s.subjectName,
        prevDate: date, // 특별보강은 교시 이동 없음 — 동일 슬롯
        prevDay: s.day,
        prevPeriod: s.period,
        note: `특별보강: ${s.subTeacherName}${s.subSubjectName ? ` (${s.subSubjectName})` : ""}`,
      });
    }
  }

  return rows
    .filter((r) => r.date && r.date >= filter.startDate && r.date <= filter.endDate)
    .sort(
      (x, y) =>
        x.date.localeCompare(y.date) ||
        x.period - y.period ||
        x.grade - y.grade ||
        x.classNum - y.classNum
    );
}

/**
 * 주 하나의 합성본을 시수 집계에 누적한다 (§8 — 실제 운영된 수업만, §12-3).
 * 합성 단계에서 휴업일·축소 시수 슬롯은 이미 제거되어 있으므로,
 * 여기서는 endDate 이후 요일만 추가로 걸러낸다 (주 중간까지 집계 지원).
 * 학급 시수는 교시(셀) 단위 1, 교사·과목 시수는 lesson 단위(동시수업 분반 각각 1).
 */
export function accumulateWeeklyHours(
  grids: WeeklyClassGrid[],
  week: TimetableWeek,
  endDate: string,
  acc: {
    byTeacher: Map<string, { name: string; total: number }>;
    bySubject: Map<string, number>;
    byClass: Map<string, number>;
  }
): void {
  const countableDays = new Set(
    (week.days || []).filter((d) => d.date <= endDate && !d.holiday).map((d) => d.day)
  );
  for (const grid of grids) {
    for (const cell of grid.cells) {
      if (!countableDays.has(cell.day) || cell.lessons.length === 0) continue;
      const classKey = `${grid.grade}-${grid.classNum}`;
      acc.byClass.set(classKey, (acc.byClass.get(classKey) || 0) + 1);
      for (const lesson of cell.lessons) {
        acc.bySubject.set(lesson.subjectName, (acc.bySubject.get(lesson.subjectName) || 0) + 1);
        for (const t of lesson.teachers || []) {
          const email = (t.email || "").trim().toLowerCase();
          if (!email) continue; // 이메일 없는 가상 교사는 교사별 집계 대상 아님
          const cur = acc.byTeacher.get(email);
          if (cur) cur.total += 1;
          else acc.byTeacher.set(email, { name: t.name || email.split("@")[0], total: 1 });
        }
      }
    }
  }
}
