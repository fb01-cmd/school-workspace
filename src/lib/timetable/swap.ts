/**
 * Phase 9b: 수업교환 후보 탐색 엔진 — 순수 함수, Firestore 의존 없음
 *
 * 상위 스펙: phase9b_spec.md §4
 * 모든 계산은 "주간 합성본" 기준 (이미 승인된 변경 위에서 탐색해야 이중 배정이 원천 차단됨).
 *
 * 하드 제외 (§4-3 — 컴시간도 중대 속성 셀은 이동 자체를 차단):
 *   동시수업(한 셀 lessons 2+ 또는 등록부 판정 lesson.simul — pre_opening_3features_spec §A),
 *   복수교사(teachers 2+), 가상 교사(이메일 없음), 특별실 충돌.
 * 감점 (소프트 — 주간시간표설명서 p.27 정의 계승): 중복·최적·연속3·점심.
 *   '학년'·'오후'는 2026-08-04 파일럿 확정으로 삭제 (원배정 품질 조건 — 일회성 교체에 부적합).
 */

import { SIMUL_BLOCK_MESSAGE } from "./simul";
import { isSlotWithinWeek, periodsForGradeDay } from "./weekly";
import {
  CandidateCoordination,
  CoordinationOccupant,
  PenaltyDetail,
  SubstituteCandidate,
  SwapCandidate,
  SwapSourceSlot,
  TimetableSettings,
  TimetableTeacher,
  TimetableWeek,
  WeeklyClassGrid,
  WeeklyLesson,
} from "./types";

/** 후보 탐색 옵션 (consent_swap_opening_spec §2-2) — 기본 꺼짐 = 기존 출력 불변 (체인 탐색 보존) */
export interface SwapEngineOptions {
  includeCoordination?: boolean; // 특별실(§F) 충돌 후보를 버리지 않고 조율 필요 표시로 살린다
}

const norm = (e: string) => (e || "").trim().toLowerCase();

// ── 전 슬롯 인덱스 (교사 점유·특별실 점유·학급 과목) ──────────

interface SlotIndex {
  /** "day-period" → 그 교시에 수업 중인 교사 이메일 집합 (전 학급) */
  busyTeachers: Map<string, Set<string>>;
  /** "day-period" → 사용 중인 특별실 → 사용 학급 "grade-classNum" 집합 */
  roomUse: Map<string, Map<string, Set<string>>>;
  /** 교사 이메일 → "day-period" → 과목명 배열 (감점 계산용) */
  teacherSlots: Map<string, Map<string, string[]>>;
}

export function buildSlotIndex(grids: WeeklyClassGrid[]): SlotIndex {
  const busyTeachers = new Map<string, Set<string>>();
  const roomUse = new Map<string, Map<string, Set<string>>>();
  const teacherSlots = new Map<string, Map<string, string[]>>();

  for (const grid of grids) {
    const classKey = `${grid.grade}-${grid.classNum}`;
    for (const cell of grid.cells || []) {
      const slotKey = `${cell.day}-${cell.period}`;
      for (const lesson of cell.lessons || []) {
        for (const t of lesson.teachers || []) {
          const email = norm(t.email);
          if (!email) continue;
          if (!busyTeachers.has(slotKey)) busyTeachers.set(slotKey, new Set());
          busyTeachers.get(slotKey)!.add(email);
          if (!teacherSlots.has(email)) teacherSlots.set(email, new Map());
          const tm = teacherSlots.get(email)!;
          if (!tm.has(slotKey)) tm.set(slotKey, []);
          tm.get(slotKey)!.push(lesson.subjectName);
        }
        if (lesson.room) {
          if (!roomUse.has(slotKey)) roomUse.set(slotKey, new Map());
          const rm = roomUse.get(slotKey)!;
          if (!rm.has(lesson.room)) rm.set(lesson.room, new Set());
          rm.get(lesson.room)!.add(classKey);
        }
      }
    }
  }
  return { busyTeachers, roomUse, teacherSlots };
}

function isTeacherFree(idx: SlotIndex, email: string, day: number, period: number): boolean {
  return !idx.busyTeachers.get(`${day}-${period}`)?.has(norm(email));
}

/**
 * 블록(전교 공통·동시수업) 교사 판별: 어느 한 교시라도 2개 학급 이상을 동시에 가르치면 true.
 * SLAT·창체 같은 가상 교사가 실이메일로 매핑된 경우를 잡는다 — 이런 수업은 학급 하나만
 * 떼어 옮길 수 없으므로 교환·보강 후보에서 원천 제외 (알리미 튜토리얼 "절대 교환 금지" 케이스).
 */
export function isBlockTeacher(idx: SlotIndex, email: string): boolean {
  const tm = idx.teacherSlots.get(norm(email));
  if (!tm) return false;
  for (const subjects of tm.values()) {
    if (subjects.length >= 2) return true;
  }
  return false;
}

/** 특별실이 해당 슬롯에서 (자기 학급 사용 제외하고) 비어 있는가 */
function isRoomFree(
  idx: SlotIndex,
  room: string,
  day: number,
  period: number,
  ownClassKey: string
): boolean {
  const users = idx.roomUse.get(`${day}-${period}`)?.get(room);
  if (!users) return true;
  return [...users].every((c) => c === ownClassKey);
}

/**
 * 특별실 충돌 슬롯의 점유 수업 역참조 (consent_swap_opening_spec §2-2) — 양해 필요 당사자 도출.
 * 이미 로드된 합성본만 사용(추가 읽기 0). 점유 수업의 교사가 가상(이메일 없음)이면 null —
 * 양해 당사자가 없어 조율 불가이므로 그 후보는 하드 제외를 유지한다.
 */
function roomOccupants(
  idx: SlotIndex,
  grids: WeeklyClassGrid[],
  room: string,
  day: number,
  period: number,
  ownClassKey: string
): CoordinationOccupant[] | null {
  const users = idx.roomUse.get(`${day}-${period}`)?.get(room);
  const others = [...(users || [])].filter((c) => c !== ownClassKey);
  if (others.length === 0) return null; // 자기 학급뿐 = 충돌 아님 (isRoomFree와 판정 일치)
  const occupants: CoordinationOccupant[] = [];
  for (const key of others) {
    const [g, cn] = key.split("-").map(Number);
    const cell = grids
      .find((x) => x.grade === g && x.classNum === cn)
      ?.cells.find((c) => c.day === day && c.period === period);
    for (const lesson of cell?.lessons || []) {
      if (lesson.room !== room) continue;
      for (const t of lesson.teachers || []) {
        if (!norm(t.email)) return null; // 가상 교사 점유 → 조율 불가
        occupants.push({
          grade: g,
          classNum: cn,
          subjectName: lesson.subjectName,
          teacherEmail: norm(t.email),
          teacherName: t.name,
        });
      }
      if ((lesson.teachers || []).length === 0) return null; // 교사 없는 점유 → 조율 불가
    }
  }
  return occupants.length ? occupants : null; // 역참조 실패 시 보수적으로 하드 유지
}

// ── 감점 계산 (주간시간표설명서 p.27 조건 계승 — 1차 근사 휴리스틱) ──

interface PenaltyCtx {
  idx: SlotIndex;
  settings: TimetableSettings;
  week: TimetableWeek;
}

/**
 * 교사의 하루 일정에 (day, addPeriod)가 추가되고 (day, removePeriod?)가 빠졌을 때의 감점.
 * 반환: 사람이 읽는 사유 목록.
 *
 * [2026-08-04 파일럿 확정] '학년'(같은 요일 3과목)·'오후'(오전·오후 균형) 감점은 삭제 —
 * 원배정 품질 조건이라 일회성 교체 감점으로는 과하고, 교사에게 사유가 전달되지 않음.
 */
function teacherDayPenalties(
  ctx: PenaltyCtx,
  teacherEmail: string,
  teacherLabel: string,
  day: number,
  addPeriod: number,
  removePeriod: number | null
): Array<{ message: string; points: number }> {
  const penalties: Array<{ message: string; points: number }> = [];
  const tm = ctx.idx.teacherSlots.get(norm(teacherEmail)) || new Map<string, string[]>();

  // 이동 후 그 요일의 교시 집합
  const periods = new Set<number>();
  for (const [slotKey] of tm.entries()) {
    const [d, p] = slotKey.split("-").map(Number);
    if (d !== day) continue;
    if (removePeriod !== null && p === removePeriod) continue;
    periods.add(p);
  }
  periods.add(addPeriod);

  // '최적': 요일 시수 쏠림 — 정도 비례 (5시간=1점, 1시간 초과당 +1점) [2026-08-04 가중]
  if (periods.size >= 5) {
    penalties.push({
      message: `${teacherLabel} 요일 시수 쏠림 (${periods.size}시간)`,
      points: periods.size - 4,
    });
  }

  // '연속3': 연속 3교시 이상 발생 (추가 교시가 포함된 연속 구간만 평가)
  let run = 0;
  let maxRunWithAdd = 0;
  const maxP = periodsForGradeDay(ctx.week, ctx.settings, 1, day) || ctx.settings.periodsPerDay;
  let runHasAdd = false;
  for (let p = 1; p <= maxP + 1; p++) {
    if (periods.has(p)) {
      run++;
      if (p === addPeriod) runHasAdd = true;
    } else {
      if (runHasAdd) maxRunWithAdd = Math.max(maxRunWithAdd, run);
      run = 0;
      runHasAdd = false;
    }
  }
  // 연속 길이 비례 (3교시=1점, 1교시 초과당 +1점) [2026-08-04 가중]
  if (maxRunWithAdd >= 3) {
    penalties.push({
      message: `${teacherLabel} 연속 ${maxRunWithAdd}교시 발생`,
      points: maxRunWithAdd - 2,
    });
  }

  // '점심': 점심 직전·직후 연속 (추가 교시가 그 쌍을 만들 때만) — 1점 고정
  const L = ctx.settings.lunchAfterPeriod;
  if (
    (addPeriod === L && periods.has(L + 1)) ||
    (addPeriod === L + 1 && periods.has(L))
  ) {
    penalties.push({ message: `${teacherLabel} 점심 전후 연속 수업 발생`, points: 1 });
  }

  return penalties;
}

/**
 * 학급이 같은 요일에 같은 과목을 여러 번 갖게 되는가 ('중복' — 최대 감점).
 * [2026-08-04] 횟수 비례 가중: 이동 결과 그 요일 총 n회면 (n−1)점 — 2회=1점, 3회=2점.
 */
function classDuplicatePenalty(
  grid: WeeklyClassGrid,
  day: number,
  subjectName: string,
  excludePeriods: number[]
): { message: string; points: number } | null {
  let existing = 0;
  for (const cell of grid.cells) {
    if (cell.day !== day || excludePeriods.includes(cell.period)) continue;
    existing += cell.lessons.filter((l) => l.subjectName === subjectName).length;
  }
  if (existing === 0) return null;
  const total = existing + 1; // 이동해 들어오는 1회 포함
  return {
    message: `${grid.grade}-${grid.classNum}반 ${["", "월", "화", "수", "목", "금"][day]}요일 ${subjectName} ${total}회`,
    points: existing,
  };
}

// ── 소스 슬롯 검증 (하드 규칙 공통) ───────────────────────────

export interface SourceLessonResult {
  ok: boolean;
  error?: string;
  lesson?: WeeklyLesson;
  grid?: WeeklyClassGrid;
}

export function resolveSourceLesson(
  grids: WeeklyClassGrid[],
  requesterEmail: string,
  source: { grade: number; classNum: number; day: number; period: number }
): SourceLessonResult {
  const grid = grids.find((g) => g.grade === source.grade && g.classNum === source.classNum);
  if (!grid) return { ok: false, error: "해당 학급 시간표를 찾을 수 없습니다." };
  const cell = grid.cells.find((c) => c.day === source.day && c.period === source.period);
  if (!cell || cell.lessons.length === 0)
    return { ok: false, error: "해당 교시에 수업이 없습니다." };
  if (cell.lessons.length > 1)
    return { ok: false, error: "동시수업(분반) 교시는 교환할 수 없습니다. 일과계에 직접 요청하세요." };
  const lesson = cell.lessons[0];
  if (lesson.simul) return { ok: false, error: SIMUL_BLOCK_MESSAGE };
  if ((lesson.teachers || []).length > 1)
    return { ok: false, error: "복수교사 수업은 교환할 수 없습니다. 일과계에 직접 요청하세요." };
  const teacher = lesson.teachers[0];
  if (!teacher || !norm(teacher.email))
    return { ok: false, error: "가상 교사(학교 공통 활동) 수업은 교환 대상이 아닙니다." };
  if (norm(teacher.email) !== norm(requesterEmail))
    return { ok: false, error: "본인의 수업만 교환 신청할 수 있습니다." };
  return { ok: true, lesson, grid };
}

// ── 맞교환 후보 탐색 (§4-1) ───────────────────────────────────

export function findSwapCandidates(
  grids: WeeklyClassGrid[],
  week: TimetableWeek,
  settings: TimetableSettings,
  requesterEmail: string,
  source: SwapSourceSlot,
  opts?: SwapEngineOptions
): { candidates: SwapCandidate[]; error?: string } {
  const src = resolveSourceLesson(grids, requesterEmail, source);
  if (!src.ok) return { candidates: [], error: src.error };
  const grid = src.grid!;
  const myLesson = src.lesson!;
  const idx = buildSlotIndex(grids);
  const classKey = `${grid.grade}-${grid.classNum}`;
  const ctx: PenaltyCtx = { idx, settings, week };
  const me = norm(requesterEmail);
  if (isBlockTeacher(idx, me)) {
    return {
      candidates: [],
      error: "동시 진행 수업(전교 공통 활동 등)을 담당하는 계정은 교환 신청할 수 없습니다. 일과계에 직접 요청하세요.",
    };
  }
  const candidates: SwapCandidate[] = [];

  for (let d2 = 1; d2 <= 5; d2++) {
    const maxP = periodsForGradeDay(week, settings, grid.grade, d2);
    for (let p2 = 1; p2 <= maxP; p2++) {
      if (d2 === source.day && p2 === source.period) continue;
      // 조건 ①: 신청자가 목표 슬롯에 공강
      if (!isTeacherFree(idx, me, d2, p2)) continue;

      const targetCell = grid.cells.find((c) => c.day === d2 && c.period === p2);
      if (!targetCell || targetCell.lessons.length === 0) continue; // 학급도 비면 교환 상대 없음
      if (targetCell.lessons.length > 1) continue; // 하드: 동시수업
      const l2 = targetCell.lessons[0];
      if (l2.simul) continue; // 하드: 동시수업 그룹(분반 이동수업 — 등록부 판정, §A)
      if ((l2.teachers || []).length > 1) continue; // 하드: 복수교사
      const b = l2.teachers[0];
      if (!b || !norm(b.email) || norm(b.email) === me) continue; // 하드: 가상 교사·본인
      if (isBlockTeacher(idx, b.email)) continue; // 하드: 블록(전교 공통·동시수업) 교사

      // 조건 ③: 상대가 내 원 슬롯에 공강
      if (!isTeacherFree(idx, b.email, source.day, source.period)) continue;

      // 특별실 충돌 — 기본은 하드 제외, includeCoordination이면 조율 필요 후보로 살린다 (§2-2).
      // (내 수업 room은 목표 슬롯에서, 상대 room은 내 슬롯에서 사용 가능해야)
      const conflicts: CandidateCoordination["conflicts"] = [];
      if (myLesson.room && !isRoomFree(idx, myLesson.room, d2, p2, classKey)) {
        if (!opts?.includeCoordination) continue;
        const occ = roomOccupants(idx, grids, myLesson.room, d2, p2, classKey);
        if (!occ) continue; // 가상 교사 점유 등 조율 불가 → 하드 유지
        conflicts.push({
          roomName: myLesson.room,
          slot: { weekId: week.id, day: d2, period: p2 },
          occupants: occ,
        });
      }
      if (l2.room && !isRoomFree(idx, l2.room, source.day, source.period, classKey)) {
        if (!opts?.includeCoordination) continue;
        const occ = roomOccupants(idx, grids, l2.room, source.day, source.period, classKey);
        if (!occ) continue;
        conflicts.push({
          roomName: l2.room,
          slot: { weekId: week.id, day: source.day, period: source.period },
          occupants: occ,
        });
      }

      // 감점 계산 — 중복은 횟수 비례 가중, 나머지는 사유 1건당 1점.
      // §14-2 v2: scope 분류 — 교사 화면은 counterpart만 표시, 전체는 일과계 스냅샷용 유지
      const details: PenaltyDetail[] = [];
      const dup1 = classDuplicatePenalty(grid, d2, myLesson.subjectName, [p2, ...(d2 === source.day ? [source.period] : [])]);
      if (dup1) details.push({ scope: "class", text: dup1.message, points: dup1.points });
      const dup2 = classDuplicatePenalty(grid, source.day, l2.subjectName, [source.period, ...(source.day === d2 ? [p2] : [])]);
      if (dup2) details.push({ scope: "class", text: dup2.message, points: dup2.points });
      details.push(
        ...teacherDayPenalties(ctx, me, "내", d2, p2, source.day === d2 ? source.period : null)
          .map((p) => ({ scope: "mine" as const, text: p.message, points: p.points })),
        ...teacherDayPenalties(ctx, b.email, `${b.name} 선생님`, source.day, source.period,
          d2 === source.day ? p2 : null)
          .map((p) => ({ scope: "counterpart" as const, text: p.message, points: p.points }))
      );

      candidates.push({
        targetDay: d2,
        targetPeriod: p2,
        counterpartEmail: norm(b.email),
        counterpartName: b.name,
        counterpartSubjectName: l2.subjectName,
        score: details.reduce((sum, p) => sum + p.points, 0),
        penalties: details.map((p) => p.text),
        penaltyDetails: details,
        counterpartScore: details
          .filter((p) => p.scope === "counterpart")
          .reduce((sum, p) => sum + p.points, 0),
        ...(conflicts.length ? { coordination: { kind: "venue" as const, conflicts } } : {}),
      });
    }
  }

  candidates.sort(
    (a, b) =>
      (a.coordination ? 1 : 0) - (b.coordination ? 1 : 0) || // §2-2: 깨끗한 후보 전체 → 조율 필요 후보 전체
      a.counterpartScore - b.counterpartScore || // §14-2 v2: 상대 부담 우선 정렬
      a.score - b.score ||
      a.targetDay - b.targetDay || a.targetPeriod - b.targetPeriod
  );
  return { candidates };
}

// ── 교차 주 맞교환 후보 탐색 (§4-3b) ──────────────────────────

/** 감점 사유에 붙일 주 표기 — "12/28 주" */
function weekLabel(week: TimetableWeek): string {
  const [, m, d] = week.startDate.split("-");
  return `${Number(m)}/${Number(d)} 주`;
}

/**
 * 교차 주 맞교환: 내 sourceWeek 수업 ↔ 같은 학급의 targetWeek 수업.
 * 조건 ① 상대가 sourceWeek의 내 슬롯 시간에 공강 ② 내가 targetWeek의 상대 슬롯 시간에 공강.
 * 하드 제외(동시·복수·가상·블록·특별실)는 각 주 기준으로 각각 적용, 감점은 두 주 합산 (§4-3b).
 */
export function findCrossSwapCandidates(
  sourceGrids: WeeklyClassGrid[],
  sourceWeek: TimetableWeek,
  targetGrids: WeeklyClassGrid[],
  targetWeek: TimetableWeek,
  settings: TimetableSettings,
  requesterEmail: string,
  source: SwapSourceSlot,
  opts?: SwapEngineOptions
): { candidates: SwapCandidate[]; error?: string } {
  if (sourceWeek.id === targetWeek.id) {
    return { candidates: [], error: "교차 주 교환은 서로 다른 주 사이에서만 가능합니다." };
  }
  const src = resolveSourceLesson(sourceGrids, requesterEmail, source);
  if (!src.ok) return { candidates: [], error: src.error };
  const myLesson = src.lesson!;
  const idxSrc = buildSlotIndex(sourceGrids);
  const idxTgt = buildSlotIndex(targetGrids);
  const me = norm(requesterEmail);
  if (isBlockTeacher(idxSrc, me) || isBlockTeacher(idxTgt, me)) {
    return {
      candidates: [],
      error: "동시 진행 수업(전교 공통 활동 등)을 담당하는 계정은 교환 신청할 수 없습니다. 일과계에 직접 요청하세요.",
    };
  }
  const targetGrid = targetGrids.find(
    (g) => g.grade === source.grade && g.classNum === source.classNum
  );
  if (!targetGrid) {
    return { candidates: [], error: "대상 주에서 해당 학급 시간표를 찾을 수 없습니다." };
  }
  const classKey = `${source.grade}-${source.classNum}`;
  const srcLabel = weekLabel(sourceWeek);
  const tgtLabel = weekLabel(targetWeek);
  const ctxSrc: PenaltyCtx = { idx: idxSrc, settings, week: sourceWeek };
  const ctxTgt: PenaltyCtx = { idx: idxTgt, settings, week: targetWeek };
  const candidates: SwapCandidate[] = [];

  for (let d2 = 1; d2 <= 5; d2++) {
    const maxP = periodsForGradeDay(targetWeek, settings, source.grade, d2);
    for (let p2 = 1; p2 <= maxP; p2++) {
      // 조건 ②: 내가 targetWeek의 상대 슬롯 시간에 공강
      if (!isTeacherFree(idxTgt, me, d2, p2)) continue;

      const targetCell = targetGrid.cells.find((c) => c.day === d2 && c.period === p2);
      if (!targetCell || targetCell.lessons.length === 0) continue;
      if (targetCell.lessons.length > 1) continue; // 하드: 동시수업
      const l2 = targetCell.lessons[0];
      if (l2.simul) continue; // 하드: 동시수업 그룹(분반 이동수업 — 등록부 판정, §A)
      if ((l2.teachers || []).length > 1) continue; // 하드: 복수교사
      const b = l2.teachers[0];
      if (!b || !norm(b.email) || norm(b.email) === me) continue; // 하드: 가상 교사·본인
      if (isBlockTeacher(idxTgt, b.email) || isBlockTeacher(idxSrc, b.email)) continue; // 하드: 블록 — 각 주 기준

      // 조건 ①: 상대가 sourceWeek의 내 슬롯 시간에 공강
      if (!isTeacherFree(idxSrc, b.email, source.day, source.period)) continue;

      // 특별실 충돌 — 내 수업 room은 targetWeek 슬롯에서, 상대 room은 sourceWeek 내 슬롯에서 (각 주 기준).
      // 기본 하드 제외, includeCoordination이면 조율 필요 후보로 살린다 (§2-2).
      const conflicts: CandidateCoordination["conflicts"] = [];
      if (myLesson.room && !isRoomFree(idxTgt, myLesson.room, d2, p2, classKey)) {
        if (!opts?.includeCoordination) continue;
        const occ = roomOccupants(idxTgt, targetGrids, myLesson.room, d2, p2, classKey);
        if (!occ) continue;
        conflicts.push({
          roomName: myLesson.room,
          slot: { weekId: targetWeek.id, day: d2, period: p2 },
          occupants: occ,
        });
      }
      if (l2.room && !isRoomFree(idxSrc, l2.room, source.day, source.period, classKey)) {
        if (!opts?.includeCoordination) continue;
        const occ = roomOccupants(idxSrc, sourceGrids, l2.room, source.day, source.period, classKey);
        if (!occ) continue;
        conflicts.push({
          roomName: l2.room,
          slot: { weekId: sourceWeek.id, day: source.day, period: source.period },
          occupants: occ,
        });
      }

      // 감점 — 두 주 각각 계산해 합산. 교차 주라 같은 주 내 제거 상쇄는 없음(removePeriod=null).
      // 중복은 횟수 비례 가중, 나머지는 사유 1건당 1점. §14-2 v2 scope 분류 동일 적용.
      const details: PenaltyDetail[] = [];
      const dupTgt = classDuplicatePenalty(targetGrid, d2, myLesson.subjectName, [p2]);
      if (dupTgt) details.push({ scope: "class", text: `${tgtLabel}: ${dupTgt.message}`, points: dupTgt.points });
      const dupSrc = classDuplicatePenalty(src.grid!, source.day, l2.subjectName, [source.period]);
      if (dupSrc) details.push({ scope: "class", text: `${srcLabel}: ${dupSrc.message}`, points: dupSrc.points });
      details.push(
        ...teacherDayPenalties(ctxTgt, me, "내", d2, p2, null)
          .map((p) => ({ scope: "mine" as const, text: `${tgtLabel}: ${p.message}`, points: p.points })),
        ...teacherDayPenalties(ctxSrc, b.email, `${b.name} 선생님`, source.day, source.period, null)
          .map((p) => ({ scope: "counterpart" as const, text: `${srcLabel}: ${p.message}`, points: p.points }))
      );

      candidates.push({
        targetDay: d2,
        targetPeriod: p2,
        counterpartEmail: norm(b.email),
        counterpartName: b.name,
        counterpartSubjectName: l2.subjectName,
        score: details.reduce((sum, p) => sum + p.points, 0),
        penalties: details.map((p) => p.text),
        penaltyDetails: details,
        counterpartScore: details
          .filter((p) => p.scope === "counterpart")
          .reduce((sum, p) => sum + p.points, 0),
        ...(conflicts.length ? { coordination: { kind: "venue" as const, conflicts } } : {}),
      });
    }
  }

  candidates.sort(
    (a, b) =>
      (a.coordination ? 1 : 0) - (b.coordination ? 1 : 0) || // §2-2: 깨끗한 후보 전체 → 조율 필요 후보 전체
      a.counterpartScore - b.counterpartScore || // §14-2 v2: 상대 부담 우선 정렬
      a.score - b.score ||
      a.targetDay - b.targetDay || a.targetPeriod - b.targetPeriod
  );
  return { candidates };
}

// ── 특별보강 후보 탐색 (§4-2) ─────────────────────────────────

export function findSubstituteCandidates(
  grids: WeeklyClassGrid[],
  week: TimetableWeek,
  settings: TimetableSettings,
  requesterEmail: string,
  source: SwapSourceSlot,
  allTeachers: TimetableTeacher[],
  substituteTotals: Map<string, number>,
  subjectTeacherEmails: Set<string> // 결강 과목 담당 교사 (동일 과목 우선 표시용)
): { candidates: SubstituteCandidate[]; error?: string } {
  const src = resolveSourceLesson(grids, requesterEmail, source);
  if (!src.ok) return { candidates: [], error: src.error };
  if (!isSlotWithinWeek(week, settings, source.grade, source.day, source.period)) {
    return { candidates: [], error: "해당 슬롯은 이번 주 운영 교시가 아닙니다." };
  }
  const idx = buildSlotIndex(grids);
  const me = norm(requesterEmail);
  if (isBlockTeacher(idx, me)) {
    return {
      candidates: [],
      error: "동시 진행 수업(전교 공통 활동 등)은 보강 대상이 아닙니다. 일과계에 직접 요청하세요.",
    };
  }
  const candidates: SubstituteCandidate[] = [];
  const seen = new Set<string>();

  for (const t of allTeachers) {
    const email = norm(t.email);
    if (!email || email === me || seen.has(email)) continue;
    seen.add(email);
    if (!isTeacherFree(idx, email, source.day, source.period)) continue;
    if (isBlockTeacher(idx, email)) continue; // 블록(가상·동시수업) 계정은 보강 후보 아님
    candidates.push({
      teacherEmail: email,
      teacherName: t.name,
      substituteCount: substituteTotals.get(email) || 0,
      sameSubject: subjectTeacherEmails.has(email),
    });
  }

  // ① 보강 누계 오름차순 (부담 공평) → ② 이름순
  candidates.sort(
    (a, b) => a.substituteCount - b.substituteCount || a.teacherName.localeCompare(b.teacherName, "ko")
  );
  return { candidates };
}
