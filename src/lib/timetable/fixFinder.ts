/**
 * F-2 해결안 후보 탐색기 (docs/timetable_fix_assist_spec.md §2)
 *
 * 감점 항목 1건을 지목하면, 그 감점의 **원인 셀만** 후보로 좁혀 맞교환 안을 만들고
 * 기존 검사기(validateTimetable)로 전수 채점해 "새 하드 0 + 실제로 개선되는" 안만 남긴다.
 *
 * ── 설계의 핵심 두 가지 ──
 *
 * ① **AI를 쓰지 않는다** (§2-1). AI는 그리드 전문을 못 보고(요약만 받는다), 자기 제안이 새
 *    하드를 만드는지 검증할 수 없으며, 무료 등급이 하루 20회다. 검사기가 진실의 원본이므로
 *    후보를 만들고 검사기로 채점하면 결과가 **검증된 사실**이 된다. 이 파일은 AI 호출 0회다.
 *
 * ② **적용 경로를 새로 만들지 않는다** (§2-5). 여기는 op 후보만 돌려준다. 미리보기는 기존
 *    analyzeOpImpact + 연쇄 영향 모달, 적용은 기존 draft_op 경로를 그대로 쓴다.
 *
 * Firestore 무의존 순수 모듈 — 검사기·솔버와 같은 규약(이메일 없음 = 자리표시).
 */
import { SOFT_CODE_LABELS } from "./labels";
import { buildSimulMatcher } from "./simul";
import type {
  BaseRevisionOp,
  ClassGrid,
  HardViolation,
  SoftPenaltyCode,
  TermPenaltyDetail,
  TimetableAuditReport,
  TimetableCell,
  TimetableConstraintModel,
  TimetableLesson,
} from "./types";
import { applyRevisionOps, cloneClassGrids } from "./utils";
import {
  checkPlaceholderOp,
  deriveGradeDayPeriods,
  diffNewHardViolations,
  isAllVirtual,
  normSubject,
  validateTimetable,
} from "./validate";

const DAY_LABEL = ["", "월", "화", "수", "목", "금"];
const norm = (e: string) => (e || "").trim().toLowerCase();

/** 한 번에 몇 건을 평가하고 UI에 제어를 돌려줄지 — 실측 5.4ms/건 기준 청크당 약 135ms */
const CHUNK_SIZE = 25;

export interface FixCandidate {
  /** type:"swap"(같은 학급 이동·맞교환) 또는 type:"swap_pair"(학급 간 교환, v2 — 두 학급이
   *  같은 두 슬롯을 동시에 맞바꿔 교사 겹침을 상쇄). 미리보기·적용 경로는 op 종류를 모른다 */
  op: BaseRevisionOp;
  /** "2학년 5반 화요일 2교시(수학Ⅰ·김한별) ↔ 수요일 3교시(빈 교시)" */
  desc: string;
  oldSoftTotal: number;
  newSoftTotal: number;
  /** 음수 = 개선 */
  deltaScore: number;
  /** 지목한 감점 항목이 사라졌는가 */
  resolvesTarget: boolean;
  /** 새로 생기거나 커진 다른 감점 문장 (최대 3건) */
  sideEffects: string[];
}

export interface FixSearchProgress {
  /** 지금까지 검사기를 돌린 후보 수 */
  evaluated: number;
  /** 평가 대상 후보 총수 (사전 걸러내기 통과분) */
  total: number;
}

export interface FixSearchParams {
  baseGrids: ClassGrid[];
  /** meta.ops.slice(0, opCursor) — 현재 그리드를 만드는 연산들 */
  ops: BaseRevisionOp[];
  /** base + ops 재생 결과. 원인 셀 탐색·자리표시/동시수업 판정의 입력 */
  currentGrids: ClassGrid[];
  model: TimetableConstraintModel;
  /** F-1 목록에서 사용자가 지목한 감점 한 건 */
  target: TermPenaltyDetail;
  /** 검사기를 돌릴 최대 후보 수 (기본 300) */
  maxCandidates?: number;
  /** 돌려줄 최대 안 수 (기본 5) */
  maxResults?: number;
  /**
   * 자가 테스트 전용 — 사전 걸러내기(isDoomed)를 끄고 전수 평가한다.
   * 걸러내기가 "검사기가 어차피 버릴 안"만 지우는지(= 좋은 안을 삼키지 않는지) 증명하는 데 쓴다.
   * 화면에서는 절대 켜지 말 것: 평가 수가 몇 배로 늘어난다.
   */
  includeDoomed?: boolean;
}

// ── 내부 자료구조 ────────────────────────────────────────────

interface Slot {
  day: number;
  period: number;
}

interface SourceCell extends Slot {
  grade: number;
  classNum: number;
}

const slotKey = (s: Slot) => `${s.day}-${s.period}`;
const classKey = (grade: number, classNum: number) => `${grade}-${classNum}`;
const detailKey = (d: TermPenaltyDetail) => `${d.code}|${d.scope}|${d.key}|${d.day}`;

/** 후보 op의 정규화 키 — 같은 두 슬롯·같은 학급 조합을 순서만 바꾼 중복 후보를 제거한다 */
const opKey = (op: BaseRevisionOp): string => {
  if (op.type === "swap") {
    const [x, y] = [slotKey(op.a), slotKey(op.b)].sort();
    return `${op.grade}-${op.classNum}|${x}|${y}`;
  }
  if (op.type === "swap_pair") {
    const [x, y] = [slotKey(op.a), slotKey(op.b)].sort();
    const cls = op.classes.map((c) => `${c.grade}-${c.classNum}`).sort().join("+");
    return `pair|${cls}|${x}|${y}`;
  }
  return `edit|${op.grade}-${op.classNum}|${op.day}-${op.period}`;
};

const findCell = (grid: ClassGrid | undefined, day: number, period: number) =>
  grid?.cells?.find((c) => c.day === day && c.period === period);

const findGrid = (grids: ClassGrid[], grade: number, classNum: number) =>
  grids.find((g) => g.grade === grade && g.classNum === classNum);

// ── 원인 셀 탐색 (§2-3 후보 생성 규칙 표) ─────────────────────

/** 대상 교사가 target.day에 수업하는 셀 전부 (학급을 가로질러 수집 — op은 학급별이므로 셀마다 학급이 붙는다) */
function teacherCellsOnDay(grids: ClassGrid[], email: string, day: number): SourceCell[] {
  const out: SourceCell[] = [];
  for (const g of grids) {
    for (const c of g.cells || []) {
      if (c.day !== day) continue;
      const hit = (c.lessons || []).some((l) =>
        (l.teachers || []).some((t) => norm(t.email) === email)
      );
      if (hit) out.push({ grade: g.grade, classNum: g.classNum, day: c.day, period: c.period });
    }
  }
  return out;
}

/** 연속 블록(길이 ≥3)의 양 끝 교시 — S2의 원인 셀 */
function consecutiveBlockEnds(periods: number[]): Set<number> {
  const sorted = [...periods].sort((a, b) => a - b);
  const ends = new Set<number>();
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const broken = i === sorted.length || sorted[i] !== sorted[i - 1] + 1;
    if (!broken) continue;
    const run = i - start;
    if (run >= 3) {
      ends.add(sorted[start]);
      ends.add(sorted[i - 1]);
    }
    start = i;
  }
  return ends;
}

/**
 * 감점 코드별 원인 셀. 전역 탐색은 비용상 금지 — 그 감점을 만든 셀만 후보로 삼는다.
 *
 * S6(오후 쏠림)은 스펙 표에 없지만 검사기가 실제로 만들어 F-1 목록에 뜨는 코드다.
 * 버튼이 항상 0건을 돌려주는 막다른 길을 만들지 않으려고 S1과 같은 규칙으로 다룬다.
 */
function collectSourceCells(
  target: TermPenaltyDetail,
  grids: ClassGrid[],
  model: TimetableConstraintModel
): SourceCell[] {
  if (target.scope === "class") {
    const [grade, classNum] = target.key.split("-").map(Number);
    const grid = findGrid(grids, grade, classNum);
    if (!grid) return [];
    if (target.code === "S7") {
      // S7 — 그 학급에서 "3회 이상 전부 같은 교시"인 과목의 셀 전부.
      // 어느 한 회차만 다른 교시로 옮겨도 회전이 생기므로 전 회차가 이동 후보다.
      const bySubj = new Map<string, { periods: Set<number>; cells: SourceCell[] }>();
      for (const c of grid.cells || []) {
        for (const l of c.lessons || []) {
          if (!(l.teachers || []).some((t) => norm(t.email))) continue; // 자리표시 제외 (검사기 규약)
          const s = normSubject(l.subjectName);
          if (!bySubj.has(s)) bySubj.set(s, { periods: new Set(), cells: [] });
          const e = bySubj.get(s)!;
          e.periods.add(c.period);
          e.cells.push({ grade, classNum, day: c.day, period: c.period });
        }
      }
      const out: SourceCell[] = [];
      for (const { periods, cells } of bySubj.values()) {
        if (cells.length >= 3 && periods.size === 1) out.push(...cells);
      }
      return out;
    }
    // S4 — 그 학급 그 요일의 중복 과목 셀 (첫 건 제외)
    const seen = new Set<string>();
    const out: SourceCell[] = [];
    const cells = (grid.cells || [])
      .filter((c) => c.day === target.day)
      .sort((a, b) => a.period - b.period);
    for (const c of cells) {
      for (const l of c.lessons || []) {
        const s = normSubject(l.subjectName);
        if (!seen.has(s)) {
          seen.add(s);
          continue; // 첫 건은 남긴다 — 옮겨야 하는 것은 두 번째 이후
        }
        out.push({ grade, classNum, day: c.day, period: c.period });
      }
    }
    return out;
  }

  const email = norm(target.key);
  const cells = teacherCellsOnDay(grids, email, target.day);
  if (target.code === "S3") {
    const L = model.lunchAfterPeriod;
    return cells.filter((c) => c.period === L || c.period === L + 1);
  }
  if (target.code === "S2") {
    const ends = consecutiveBlockEnds(cells.map((c) => c.period));
    return cells.filter((c) => ends.has(c.period));
  }
  if (target.code === "S8") {
    // 그 교사가 "되도록 비워 달라"고 한 교시에 서 있는 셀만 — 그 셀을 옮기면 감점이 사라진다
    const wanted = new Set<number>();
    for (const ban of (model.teacherSlotBans || []).filter(
      (b) => b.active && b.soft && b.kind === "assign" && norm(b.teacherEmail) === email
    ))
      for (const s of ban.slots) if (s.day === target.day) wanted.add(s.period);
    return cells.filter((c) => wanted.has(c.period));
  }
  // S1 · S5 · S6 — 그 요일 수업 셀 전부
  return cells;
}

// ── 사전 걸러내기 (검사기를 돌리기 전에 확실히 탈락하는 후보 제거) ──

/**
 * 교사 점유 색인 — (교사 이메일 → 슬롯 → 그 슬롯에서 맡은 수업 수).
 *
 * 맞교환은 학급 하나 안에서만 일어나지만 교사는 학급을 가로지르므로, 옮긴 자리에 그 교사가
 * 이미 다른 반 수업을 갖고 있으면 H2(교사 중복)가 확정이다. 검사기를 돌리기 전에 지울 수 있다.
 */
type Occupancy = Map<string, Map<string, number>>;

function buildOccupancy(grids: ClassGrid[]): Occupancy {
  const occ: Occupancy = new Map();
  for (const g of grids) {
    for (const c of g.cells || []) {
      const sk = slotKey(c);
      for (const l of c.lessons || []) {
        for (const t of l.teachers || []) {
          const email = norm(t.email);
          if (!email) continue; // 가상 교사는 H2 대상이 아니다 — 검사기와 같은 규약
          let bySlot = occ.get(email);
          if (!bySlot) occ.set(email, (bySlot = new Map()));
          bySlot.set(sk, (bySlot.get(sk) || 0) + 1);
        }
      }
    }
  }
  return occ;
}

/** 교사 위치 색인 — (교사 이메일 → 슬롯 → 그 시간에 수업하는 학급키 집합).
 *  학급 간 교환(v2)의 상대 학급 탐색용: "이 교사가 그 시간에 어느 반에 있나"를 답한다 */
type OccupancyWhere = Map<string, Map<string, Set<string>>>;

function buildOccupancyWhere(grids: ClassGrid[]): OccupancyWhere {
  const where: OccupancyWhere = new Map();
  for (const g of grids) {
    const ck = classKey(g.grade, g.classNum);
    for (const c of g.cells || []) {
      const sk = slotKey(c);
      for (const l of c.lessons || []) {
        for (const t of l.teachers || []) {
          const email = norm(t.email);
          if (!email) continue;
          let bySlot = where.get(email);
          if (!bySlot) where.set(email, (bySlot = new Map()));
          let set = bySlot.get(sk);
          if (!set) bySlot.set(sk, (set = new Set()));
          set.add(ck);
        }
      }
    }
  }
  return where;
}

const realTeachersOf = (lessons: TimetableLesson[]) => {
  const out = new Set<string>();
  for (const l of lessons) for (const t of l.teachers || []) if (norm(t.email)) out.add(norm(t.email));
  return out;
};

/** 그 학급 그 슬롯에서 해당 교사가 맡은 수업 수 — 맞교환으로 함께 비켜나므로 충돌 계산에서 뺀다 */
function countInCell(cell: TimetableCell | undefined, email: string): number {
  let n = 0;
  for (const l of cell?.lessons || [])
    for (const t of l.teachers || []) if (norm(t.email) === email) n++;
  return n;
}

/**
 * 검사기가 반드시 탈락시킬 후보인가 — true면 평가를 건너뛴다.
 *
 * **보수적으로만 자른다**: 여기서 걸러지는 것은 검사기가 어차피 신규 하드로 떨어뜨릴 안뿐이고,
 * 살아남은 안의 최종 판정은 전적으로 검사기가 한다. 검사기를 복제하는 것이 아니라
 * 후보 생성 단계의 제약일 뿐이다.
 */
function isDoomed(
  grid: ClassGrid,
  a: Slot,
  b: Slot,
  occ: Occupancy,
  operatingPeriods: (grade: number, day: number) => number
): boolean {
  const cellA = findCell(grid, a.day, a.period);
  const cellB = findCell(grid, b.day, b.period);
  const lessonsA = cellA?.lessons || [];
  const lessonsB = cellB?.lessons || [];
  if (!lessonsA.length && !lessonsB.length) return true; // 양쪽 빈 교시 — applyRevisionOps가 건너뛴다

  // H11 — 운영하지 않는 교시로 수업을 밀어 넣는 안
  if (lessonsA.length && b.period > operatingPeriods(grid.grade, b.day)) return true;
  if (lessonsB.length && a.period > operatingPeriods(grid.grade, a.day)) return true;

  // H2 — 옮겨 간 자리에 그 교사가 이미 다른 반 수업을 갖고 있는 안
  for (const email of realTeachersOf(lessonsA)) {
    const elsewhere = (occ.get(email)?.get(slotKey(b)) || 0) - countInCell(cellB, email);
    if (elsewhere > 0) return true;
  }
  for (const email of realTeachersOf(lessonsB)) {
    const elsewhere = (occ.get(email)?.get(slotKey(a)) || 0) - countInCell(cellA, email);
    if (elsewhere > 0) return true;
  }
  return false;
}

// ── 설명 문장 ────────────────────────────────────────────────

function slotLabel(grid: ClassGrid | undefined, s: Slot): string {
  const lessons = findCell(grid, s.day, s.period)?.lessons || [];
  const head = `${DAY_LABEL[s.day]}요일 ${s.period}교시`;
  if (!lessons.length) return `${head}(빈 교시)`;
  const body = lessons
    .map((l) => {
      const names = (l.teachers || []).map((t) => t.name).filter(Boolean).join("·");
      return names ? `${l.subjectName}·${names}` : l.subjectName;
    })
    .join(" / ");
  return `${head}(${body})`;
}

function describeOp(grid: ClassGrid | undefined, op: Extract<BaseRevisionOp, { type: "swap" }>) {
  return `${op.grade}학년 ${op.classNum}반 ${slotLabel(grid, op.a)} ↔ ${slotLabel(grid, op.b)}`;
}

/** 학급 간 교환 설명 — 두 학급 각각 무엇이 오가는지 밝힌다 (첫 학급이 감점 원인 쪽) */
function describePairOp(
  grids: ClassGrid[],
  op: Extract<BaseRevisionOp, { type: "swap_pair" }>
) {
  return op.classes
    .map((c) => {
      const grid = findGrid(grids, c.grade, c.classNum);
      return `${c.grade}학년 ${c.classNum}반 ${slotLabel(grid, op.a)} ↔ ${slotLabel(grid, op.b)}`;
    })
    .join(" + ")
    .concat(" (두 학급이 같은 두 교시를 함께 맞바꿔 선생님 겹침을 상쇄)");
}

// ── 1수 후보 생성기 (v1·v2·v3 공용 단일 소재지) ────────────────

interface MoveGenOptions {
  /** 원인 셀 — 여기서 출발하는 이동·맞교환만 만든다 (전역 탐색은 비용상 금지) */
  sources: SourceCell[];
  /** 요일 단위 감점은 같은 요일 안에서 옮겨봐야 그대로다 — 그럴 때만 true */
  differentDayOnly: boolean;
  maxCandidates: number;
  /** 자가 테스트 전용 — 사전 걸러내기를 끄고 죽은 후보까지 담는다 */
  includeDoomed?: boolean;
}

/**
 * 주어진 그리드 상태에서 1수 후보를 만든다.
 *
 * **v1(감점 표적)·v3(체인 탐색)이 이 함수 하나를 공유한다.** 두 벌로 두면 자리표시 관문·
 * 동시수업 보호·H2/H11 사전 걸러내기·학급 간 교환 성립 조건이 서로 다르게 낡는다 —
 * 그러면 한쪽 경로로만 "검사기가 어차피 버릴 안"이 새거나 좋은 안이 삼켜진다.
 */
function createMoveGenerator(grids: ClassGrid[], model: TimetableConstraintModel) {
  const gdp = model.gradeDayPeriods || deriveGradeDayPeriods(grids);
  const operatingPeriods = (grade: number, day: number) =>
    gdp[grade]?.[day] ?? model.periodsPerDay;
  const occ = buildOccupancy(grids);
  const occWhere = buildOccupancyWhere(grids);
  const simulMatcher = buildSimulMatcher(model.simulGroups || [], model.subjects);

  /** 자리표시·동시수업 셀인가 — 편집 경로(handleCellClick·analyzeOpImpact)와 같은 기준 */
  const isLocked = (grid: ClassGrid, s: Slot): boolean => {
    for (const l of findCell(grid, s.day, s.period)?.lessons || []) {
      if (l.simul) return true;
      if (simulMatcher(grid.grade, grid.classNum, s.day, s.period, l.subjectName)) return true;
    }
    return false;
  };

  /**
   * 학급 간 교환(v2) 후보 완성 — 같은 학급 맞교환(X: a↔b)이 **교사 겹침(H2) 때문에만**
   * 죽을 때, 겹침 상대 학급 Y가 **같은 두 슬롯을 함께** 맞바꾸면 겹침이 정확히 상쇄된다
   * (X@a의 교사가 b 시간에 Y에서 수업 중이라면, Y의 b 수업도 a로 오므로 그 교사는 여전히
   * a·b에 한 번씩만 선다). 상대가 정확히 한 학급일 때만 성립 — 둘 이상이면 3중 연쇄.
   */
  const tryBuildPair = (
    gridX: ClassGrid,
    a: Slot,
    b: Slot
  ): Extract<BaseRevisionOp, { type: "swap_pair" }> | null => {
    const xKey = classKey(gridX.grade, gridX.classNum);
    const cellXa = findCell(gridX, a.day, a.period);
    const cellXb = findCell(gridX, b.day, b.period);
    const lessonsXa = cellXa?.lessons || [];
    const lessonsXb = cellXb?.lessons || [];
    // ① 겹침 상대 학급 수집 — X의 두 수업이 옮겨 갈 시간에 그 교사가 서 있는 다른 학급
    const partners = new Set<string>();
    for (const email of realTeachersOf(lessonsXa)) {
      if ((occ.get(email)?.get(slotKey(b)) || 0) - countInCell(cellXb, email) <= 0) continue;
      for (const ck of occWhere.get(email)?.get(slotKey(b)) || []) if (ck !== xKey) partners.add(ck);
    }
    for (const email of realTeachersOf(lessonsXb)) {
      if ((occ.get(email)?.get(slotKey(a)) || 0) - countInCell(cellXa, email) <= 0) continue;
      for (const ck of occWhere.get(email)?.get(slotKey(a)) || []) if (ck !== xKey) partners.add(ck);
    }
    if (partners.size !== 1) return null;
    const yKey = [...partners][0];
    const [gy, cy] = yKey.split("-").map(Number);
    const gridY = findGrid(grids, gy, cy);
    if (!gridY) return null;
    if (isLocked(gridY, a) || isLocked(gridY, b)) return null; // 상대 학급의 동시수업 칸 보호
    const cellYa = findCell(gridY, a.day, a.period);
    const cellYb = findCell(gridY, b.day, b.period);
    const lessonsYa = cellYa?.lessons || [];
    const lessonsYb = cellYb?.lessons || [];
    if (!lessonsYa.length && !lessonsYb.length) return null; // 상대가 양쪽 빈 교시면 상쇄가 성립 안 함
    // ② H11 — 수업이 운영 밖 교시로 밀리는 조합 제거 (학년이 다를 수 있어 학급별 판정)
    if (lessonsXa.length && b.period > operatingPeriods(gridX.grade, b.day)) return null;
    if (lessonsXb.length && a.period > operatingPeriods(gridX.grade, a.day)) return null;
    if (lessonsYa.length && b.period > operatingPeriods(gridY.grade, b.day)) return null;
    if (lessonsYb.length && a.period > operatingPeriods(gridY.grade, a.day)) return null;
    // ③ 짝 밖 겹침 사전 걸러내기 — 네 칸의 교사들이 새 시간에 (함께 비켜나는 네 칸을 빼고도)
    //    다른 반 수업을 갖고 있으면 검사기가 어차피 H2로 떨어뜨린다
    for (const email of new Set([...realTeachersOf(lessonsXa), ...realTeachersOf(lessonsYa)])) {
      const remain =
        (occ.get(email)?.get(slotKey(b)) || 0) -
        countInCell(cellXb, email) -
        countInCell(cellYb, email);
      if (remain > 0) return null;
    }
    for (const email of new Set([...realTeachersOf(lessonsXb), ...realTeachersOf(lessonsYb)])) {
      const remain =
        (occ.get(email)?.get(slotKey(a)) || 0) -
        countInCell(cellXa, email) -
        countInCell(cellYa, email);
      if (remain > 0) return null;
    }
    return {
      type: "swap_pair",
      a: { day: a.day, period: a.period },
      b: { day: b.day, period: b.period },
      classes: [
        { grade: gridX.grade, classNum: gridX.classNum },
        { grade: gy, classNum: cy },
      ],
    };
  };

  const generate = (opts: MoveGenOptions): { op: BaseRevisionOp; grid: ClassGrid }[] => {
    const { sources, differentDayOnly, maxCandidates, includeDoomed = false } = opts;
    const seenOps = new Set<string>();
    const candidates: { op: BaseRevisionOp; grid: ClassGrid }[] = [];

    outer: for (const src of sources) {
      const grid = findGrid(grids, src.grade, src.classNum);
      if (!grid) continue;
      if (isLocked(grid, src)) continue; // 창체·SLAT·동시수업은 원천 제외
      for (let day = 1; day <= 5; day++) {
        if (differentDayOnly && day === src.day) continue;
        for (let period = 1; period <= model.periodsPerDay; period++) {
          if (day === src.day && period === src.period) continue;
          const dst: Slot = { day, period };
          if (isLocked(grid, dst)) continue;
          const op = {
            type: "swap" as const,
            grade: src.grade,
            classNum: src.classNum,
            a: { day: src.day, period: src.period },
            b: dst,
          };
          const k = opKey(op);
          if (seenOps.has(k)) continue;
          // 자리표시 관문은 편집 경로와 **같은 함수**를 쓴다 — 규약이 갈라지지 않도록
          if (checkPlaceholderOp(grids, op)) continue;
          const doomed = isDoomed(grid, op.a, op.b, occ, operatingPeriods);
          if (doomed) {
            // v2 — 같은 학급 안이 죽은 자리에서 학급 간 교환을 시도한다.
            // includeDoomed(자가 테스트 등가 증명)와 무관하게 항상 같은 규칙으로 생성해야
            // 걸러내기 on/off 결과가 동일하다.
            const pairOp = tryBuildPair(grid, op.a, op.b);
            if (pairOp) {
              const pk = opKey(pairOp);
              if (!seenOps.has(pk) && !checkPlaceholderOp(grids, pairOp)) {
                seenOps.add(pk);
                candidates.push({ op: pairOp, grid });
                if (candidates.length >= maxCandidates) break outer;
              }
            }
          }
          if (doomed && !includeDoomed) continue;
          seenOps.add(k);
          candidates.push({ op, grid });
          if (candidates.length >= maxCandidates) break outer;
        }
      }
    }
    return candidates;
  };

  return { generate };
}

// ── 본체 ────────────────────────────────────────────────────

/**
 * 후보를 만들고 청크마다 진행률을 내주는 생성기. 동기·비동기 진입점이 이것을 공유한다.
 * (같은 탐색을 두 번 구현하지 않기 위한 구조 — 두 진입점의 결과는 항상 동일하다.)
 */
function* searchGenerator(
  params: FixSearchParams
): Generator<FixSearchProgress, FixCandidate[], void> {
  const {
    baseGrids,
    ops,
    currentGrids,
    model,
    target,
    maxCandidates = 300,
    maxResults = 5,
    includeDoomed = false,
  } = params;

  // 기준 리포트는 후보와 **같은 파이프라인**으로 만든다 — 화면이 들고 있는 값을 그대로 믿으면
  // 엔진이 예고한 점수와 적용 후 점수가 어긋날 수 있다(§6 "엔진과 화면이 다른 값을 말하면 신뢰가 무너진다").
  const baseline = cloneClassGrids(baseGrids);
  applyRevisionOps(baseline, ops);
  const oldReport = validateTimetable(baseline, model);
  const oldSoftTotal = oldReport.soft.total;
  const oldDetails = new Map<string, TermPenaltyDetail>();
  for (const d of oldReport.soft.details) oldDetails.set(detailKey(d), d);
  const targetKey = detailKey(target);
  // 지목 항목의 "해소" 판정은 **건수 비교**로 한다. detailKey(code|scope|key|day)는 유일하지
  // 않기 때문이다 — S2는 한 교사·한 요일에 연속 블록이 둘이면 2건, S4는 한 학급·한 요일에
  // 중복 과목이 둘이면 2건이 나온다. "남아 있는가"로 보면 형제 항목 때문에 해소를 놓친다.
  const countByKey = (details: TermPenaltyDetail[]) => {
    let n = 0;
    for (const d of details) if (detailKey(d) === targetKey) n++;
    return n;
  };
  const oldTargetCount = countByKey(oldReport.soft.details);

  // ── 후보 생성 ──
  // S1·S4·S5·S6은 "다른 요일"로만 옮긴다(요일 단위 감점이라 같은 요일 안에서 옮겨봐야 그대로다).
  // S2·S3은 같은 요일 안에서 교시를 바꾸는 것만으로 풀리고, S7(순배)은 교시 축 감점이며
  // S8(희망 위반)은 슬롯 단위라 같은 요일의 다른 교시로 옮겨도 풀린다 — 넷은 모든 슬롯을 본다.
  const differentDayOnly = !["S2", "S3", "S7", "S8"].includes(target.code);

  const sources = collectSourceCells(target, currentGrids, model);
  const candidates = createMoveGenerator(currentGrids, model).generate({
    sources,
    differentDayOnly,
    maxCandidates,
    includeDoomed,
  });

  // ── 채점 ──
  const results: FixCandidate[] = [];
  let evaluated = 0;
  for (const { op, grid } of candidates) {
    const testGrids = cloneClassGrids(baseGrids);
    applyRevisionOps(testGrids, [...ops, op]);
    const rep: TimetableAuditReport = validateTimetable(testGrids, model);
    evaluated++;

    const newHards: HardViolation[] = diffNewHardViolations(oldReport.hard, rep.hard);
    if (newHards.length === 0) {
      const deltaScore = rep.soft.total - oldSoftTotal;
      if (deltaScore < 0) {
        const newDetails = new Map<string, TermPenaltyDetail>();
        for (const d of rep.soft.details) newDetails.set(detailKey(d), d);

        const sideEffects: string[] = [];
        for (const [k, d] of newDetails) {
          const before = oldDetails.get(k);
          if (!before) sideEffects.push(d.text);
          else if (d.points > before.points) sideEffects.push(`${d.text} (${before.points}→${d.points}점)`);
          if (sideEffects.length >= 3) break;
        }

        results.push({
          op,
          desc:
            op.type === "swap_pair"
              ? describePairOp(currentGrids, op)
              : op.type === "swap"
                ? describeOp(grid, op)
                : "",
          oldSoftTotal,
          newSoftTotal: rep.soft.total,
          deltaScore,
          resolvesTarget: countByKey(rep.soft.details) < oldTargetCount,
          sideEffects,
        });
      }
    }

    if (evaluated % CHUNK_SIZE === 0) yield { evaluated, total: candidates.length };
  }

  // 개선 큰 순 → 동점이면 지목한 문제를 실제로 없앤 안 우선 → 부작용 적은 순
  results.sort(
    (a, b) =>
      a.deltaScore - b.deltaScore ||
      Number(b.resolvesTarget) - Number(a.resolvesTarget) ||
      a.sideEffects.length - b.sideEffects.length
  );
  return results.slice(0, maxResults);
}

/**
 * 동기 실행 — 스크립트·자가 테스트용, 그리고 후보가 적을 때의 화면용.
 * 실측 기준 평가 1건 ≈ 5.4ms이므로 후보가 수십 건이면 체감되지 않는다.
 */
export function findFixCandidates(params: FixSearchParams): FixCandidate[] {
  const it = searchGenerator(params);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * 청크 실행 — 후보가 많을 때 UI 스레드를 막지 않는다(§2-4 ③).
 * 25건마다 제어를 이벤트 루프에 돌려주므로 진행률 표시와 스크롤이 살아 있다.
 */
export async function findFixCandidatesAsync(
  params: FixSearchParams,
  onProgress?: (p: FixSearchProgress) => void
): Promise<FixCandidate[]> {
  const it = searchGenerator(params);
  let step = it.next();
  while (!step.done) {
    onProgress?.(step.value);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    step = it.next();
  }
  return step.value;
}

// ═══════════════════════════════════════════════════════════════
// v3 — 말로 묻는 해결사: 목표 어휘 + 체인 탐색 (docs/timetable_ask_fix_spec.md §2·§3)
// ═══════════════════════════════════════════════════════════════
//
// 대원칙 (스펙 §1): **AI는 질문을 해석만 하고, 교환 수는 절대 만들지 않는다.**
// 이 파일은 AI 호출 0회다. AI가 낼 수 있는 것은 아래 AskFixGoal 하나뿐이고, 수(手)는
// 여기서 만들어 검사기(validateTimetable)가 전수 채점한다 — 그래서 "추가로 생기는 감점"이
// 추정이 아니라 정확한 수치가 된다.

/**
 * 임계값 — 숫자이거나 "reduce".
 *
 * 질문이 목표치를 말하지 않는 경우가 흔하다(*"1교시가 5일 연속인데 너무 많은 것 같아"* —
 * 발안 원문에도 숫자가 없다). 그때 AI에게 숫자를 지어내게 하면 안 되고(그리드를 못 본다),
 * 해석 단계에서도 정할 수 없다. **"지금보다 하나 적게"는 그리드를 쥔 엔진이 정한다.**
 */
export type AskFixThreshold = number | "reduce";

/** 질문 해석의 도착점 — AI의 출력 공간은 이 다섯 가지가 전부다 (스펙 §2) */
export type AskFixGoal =
  /** "T의 p교시가 주 N일을 넘지 않게" — 발안 예시("1교시가 5일 연속")가 정확히 이것 */
  | { kind: "teacher-period-days"; teacherEmail: string; period: number; maxDays: AskFixThreshold }
  /** "T의 d요일 수업을 N시간 이하로" */
  | { kind: "teacher-day-hours"; teacherEmail: string; day: number; maxHours: AskFixThreshold }
  /** "c반 s과목이 매번 같은 교시인 것 좀" (S7과 동일 판정 재사용) */
  | { kind: "subject-rotation"; grade: number; classNum: number; subjectName: string }
  /** "c반 d요일 p교시 수업을 다른 데로" — 목표는 '그 셀이 비거나 다른 수업' */
  | { kind: "move-cell"; grade: number; classNum: number; day: number; period: number }
  /** 질문이 기존 감점과 일치하면 기존 표적 경로로 (F-1 목록과 같은 입력) */
  | { kind: "existing-detail"; code: SoftPenaltyCode; key: string; day: number };

/** 감점 코드의 대상 축 — existing-detail 목표가 detailKey를 복원할 때 쓴다 (검사기 규약과 1:1) */
export const SOFT_CODE_SCOPE: Record<SoftPenaltyCode, "teacher" | "class"> = {
  S1: "teacher",
  S2: "teacher",
  S3: "teacher",
  S4: "class",
  S5: "teacher",
  S6: "teacher",
  S7: "class",
  S8: "teacher",
};

export interface FixPlan {
  /** "이경호 선생님의 1교시를 주 3일 이하로" — 화면에 먼저 보여줄 해석 확인 문장 */
  goalText: string;
  /** 수순 — 각 수는 기존 FixCandidate 그대로 (desc·delta·sideEffects) */
  steps: FixCandidate[];
  resolvesGoal: boolean;
  /** 전 수 적용 후 공식 점수 */
  finalSoftTotal: number;
  /**
   * 적용 후 "새로 생기거나 커진" 감점 **전부** — 수락 전 고지용(요약 아님).
   * 발안 원문의 *"추가로 생기는 감점 요소들을 다 알려주고"* 가 요구 그 자체다.
   */
  newPenalties: TermPenaltyDetail[];
  /** 목표까지 남은 거리 (0 = 충족). 부분 답에서 "어디까지 갔는지" 말할 재료 */
  remaining: number;
  /** 시작 시점의 거리 — remaining과 함께 "5칸 중 3칸은 옮겼다"를 만든다 */
  initialRemaining: number;
  /** 검사기를 돌린 횟수 */
  evaluated: number;
  /** 예산을 다 써서 멈췄는가 (깊이 소진과 구분 — 실패 문구가 달라진다) */
  budgetExhausted: boolean;
}

export interface AskFixProgress {
  evaluated: number;
  budget: number;
  depth: number;
}

export interface AskFixParams {
  baseGrids: ClassGrid[];
  /** meta.ops.slice(0, opCursor) */
  ops: BaseRevisionOp[];
  currentGrids: ClassGrid[];
  model: TimetableConstraintModel;
  goal: AskFixGoal;
  /** 빔 폭 (기본 8) */
  beamWidth?: number;
  /** 최대 수순 길이 (기본 3). 스펙 §7-3 — 4수 이상은 예산이 제곱으로 는다 */
  maxDepth?: number;
  /** 검사기 평가 예산 (기본 600 ≈ 3.2초, 실측 5.4ms/건) */
  evalBudget?: number;
  /** 한 상태에서 펼칠 1수 후보 상한 */
  maxMovesPerState?: number;
}

// ── 감점 증감 대조 (다중집합) ────────────────────────────────

/**
 * "새로 생기거나 커진" 감점을 다중집합으로 뽑는다.
 *
 * detailKey는 유일하지 않다(S2는 한 교사·한 요일에 블록 둘이면 2건) — 단순 Map 대조는
 * 같은 키의 건수 증가를 놓친다. 하드 위반 쪽 diffNewHardViolations와 같은 이유의 같은 처방이다.
 */
function diffPenalties(
  before: TermPenaltyDetail[],
  after: TermPenaltyDetail[]
): Array<{ detail: TermPenaltyDetail; beforePoints: number | null }> {
  const group = (ds: TermPenaltyDetail[]) => {
    const m = new Map<string, TermPenaltyDetail[]>();
    for (const d of ds) {
      const k = detailKey(d);
      const arr = m.get(k);
      if (arr) arr.push(d);
      else m.set(k, [d]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.points - b.points);
    return m;
  };
  const beforeMap = group(before);
  const afterMap = group(after);
  const out: Array<{ detail: TermPenaltyDetail; beforePoints: number | null }> = [];
  for (const [k, news] of afterMap) {
    const olds = beforeMap.get(k) || [];
    for (let i = 0; i < news.length; i++) {
      if (i >= olds.length) out.push({ detail: news[i], beforePoints: null });
      else if (news[i].points > olds[i].points)
        out.push({ detail: news[i], beforePoints: olds[i].points });
    }
  }
  return out;
}

const penaltyLine = (e: { detail: TermPenaltyDetail; beforePoints: number | null }) =>
  e.beforePoints == null
    ? e.detail.text
    : `${e.detail.text} (${e.beforePoints}→${e.detail.points}점)`;

// ── 목표 판정 (순수 함수 — AI 무관) ──────────────────────────

/** 그 교사가 실제로 서 있는 슬롯 집합 ("day-period") — 한 슬롯 복수 수업은 1로 접힌다 */
function teacherSlotSet(grids: ClassGrid[], email: string): Set<string> {
  const out = new Set<string>();
  for (const g of grids)
    for (const c of g.cells || [])
      for (const l of c.lessons || [])
        for (const t of l.teachers || [])
          if (norm(t.email) === email) out.add(`${c.day}-${c.period}`);
  return out;
}

function teacherNameOf(grids: ClassGrid[], email: string): string {
  for (const g of grids)
    for (const c of g.cells || [])
      for (const l of c.lessons || [])
        for (const t of l.teachers || [])
          if (norm(t.email) === email && (t.name || "").trim()) return t.name;
  return email;
}

/** 그 학급 그 셀의 수업 지문 — move-cell 목표의 "다른 수업이 되었나" 판정용 */
function cellSignature(grids: ClassGrid[], grade: number, classNum: number, s: Slot): string {
  const lessons = findCell(findGrid(grids, grade, classNum), s.day, s.period)?.lessons || [];
  return lessons
    .map((l) => normSubject(l.subjectName))
    .sort()
    .join("+");
}

export interface GoalEvaluator {
  /** 화면에 먼저 보여줄 "이렇게 이해했습니다" 문장 (실명 그대로 — 역치환 완료 상태) */
  text: string;
  /** 0 = 목표 충족. 클수록 멀다 — 부분 답 순위와 실패 문구("몇 칸이 남았다")에 쓴다 */
  distance(grids: ClassGrid[], report: TimetableAuditReport): number;
  /** 이 상태에서 손댈 원인 셀 — 한 수 둘 때마다 원인이 바뀌므로 매번 다시 계산한다 */
  sources(grids: ClassGrid[]): SourceCell[];
}

/**
 * 목표별 성공 판정·원인 셀을 순수 함수로 묶는다.
 *
 * baseline은 "질문을 받은 시점의 그리드"다 — move-cell(그 셀이 **원래와 달라졌나**)과
 * existing-detail(그 감점이 **줄었나**)은 시작 상태를 알아야 판정할 수 있다.
 */
export function buildGoalEvaluator(
  goal: AskFixGoal,
  baseline: ClassGrid[],
  model: TimetableConstraintModel,
  baseReport: TimetableAuditReport
): GoalEvaluator {
  /** "reduce"(질문이 숫자를 말하지 않음) → 지금보다 하나 적게. 0 아래로는 내려가지 않는다 */
  const resolveThreshold = (t: AskFixThreshold, current: number) =>
    t === "reduce" ? Math.max(0, current - 1) : t;

  if (goal.kind === "teacher-period-days") {
    const email = norm(goal.teacherEmail);
    const name = teacherNameOf(baseline, email);
    const countDays = (grids: ClassGrid[]) => {
      const slots = teacherSlotSet(grids, email);
      let days = 0;
      for (let d = 1; d <= 5; d++) if (slots.has(`${d}-${goal.period}`)) days++;
      return days;
    };
    const maxDays = resolveThreshold(goal.maxDays, countDays(baseline));
    return {
      text: `${name} 선생님의 ${goal.period}교시를 주 ${maxDays}일 이하로`,
      distance: (grids) => Math.max(0, countDays(grids) - maxDays),
      sources: (grids) => {
        const out: SourceCell[] = [];
        for (const g of grids)
          for (const c of g.cells || []) {
            if (c.period !== goal.period) continue;
            if (!(c.lessons || []).some((l) => (l.teachers || []).some((t) => norm(t.email) === email)))
              continue;
            out.push({ grade: g.grade, classNum: g.classNum, day: c.day, period: c.period });
          }
        return out;
      },
    };
  }

  if (goal.kind === "teacher-day-hours") {
    const email = norm(goal.teacherEmail);
    const name = teacherNameOf(baseline, email);
    const countHours = (grids: ClassGrid[]) => {
      const slots = teacherSlotSet(grids, email);
      let hours = 0;
      for (let p = 1; p <= model.periodsPerDay; p++) if (slots.has(`${goal.day}-${p}`)) hours++;
      return hours;
    };
    const maxHours = resolveThreshold(goal.maxHours, countHours(baseline));
    return {
      text: `${name} 선생님의 ${DAY_LABEL[goal.day]}요일 수업을 ${maxHours}시간 이하로`,
      distance: (grids) => Math.max(0, countHours(grids) - maxHours),
      sources: (grids) => teacherCellsOnDay(grids, email, goal.day),
    };
  }

  if (goal.kind === "subject-rotation") {
    const subj = normSubject(goal.subjectName);
    // 판정은 S7(순배)과 **같은 규칙**을 쓴다 — 검사기와 다른 기준을 세우면 "풀었다"고
    // 말한 뒤 감점이 그대로 남는다. 자리표시(전원 가상 교사) 수업 제외까지 동일.
    const scan = (grids: ClassGrid[]) => {
      const periods = new Set<number>();
      const cells: SourceCell[] = [];
      const grid = findGrid(grids, goal.grade, goal.classNum);
      for (const c of grid?.cells || [])
        for (const l of c.lessons || []) {
          if (isAllVirtual(l)) continue;
          if (normSubject(l.subjectName) !== subj) continue;
          periods.add(c.period);
          cells.push({ grade: goal.grade, classNum: goal.classNum, day: c.day, period: c.period });
        }
      return { periods, cells };
    };
    return {
      text: `${goal.grade}학년 ${goal.classNum}반 ${goal.subjectName}이 매번 같은 교시가 되지 않게`,
      distance: (grids) => {
        const { periods, cells } = scan(grids);
        return cells.length >= 3 && periods.size === 1 ? 1 : 0;
      },
      sources: (grids) => scan(grids).cells,
    };
  }

  if (goal.kind === "move-cell") {
    const slot: Slot = { day: goal.day, period: goal.period };
    const before = cellSignature(baseline, goal.grade, goal.classNum, slot);
    const label = findCell(
      findGrid(baseline, goal.grade, goal.classNum),
      goal.day,
      goal.period
    )?.lessons?.map((l) => l.subjectName).join("·");
    return {
      text: `${goal.grade}학년 ${goal.classNum}반 ${DAY_LABEL[goal.day]}요일 ${goal.period}교시${label ? `(${label})` : ""} 수업을 다른 시간으로`,
      distance: (grids) =>
        before && cellSignature(grids, goal.grade, goal.classNum, slot) === before ? 1 : 0,
      sources: () => [{ grade: goal.grade, classNum: goal.classNum, ...slot }],
    };
  }

  // existing-detail — 기존 감점 표적. 해소 판정은 v1과 같은 **건수 비교**다
  // (detailKey는 유일하지 않다 — S2·S4는 같은 키로 여러 건이 나온다).
  const scope = SOFT_CODE_SCOPE[goal.code];
  const synthetic: TermPenaltyDetail = {
    code: goal.code,
    scope,
    key: goal.key,
    label: "",
    day: goal.day,
    text: "",
    points: 0,
  };
  const wantKey = detailKey(synthetic);
  const countOf = (report: TimetableAuditReport) =>
    report.soft.details.filter((d) => detailKey(d) === wantKey).length;
  const baseCount = countOf(baseReport);
  const sample = baseReport.soft.details.find((d) => detailKey(d) === wantKey);
  return {
    text: sample ? `「${sample.text}」 해소` : `${SOFT_CODE_LABELS[goal.code] || goal.code} 항목 해소`,
    // baseCount건이 baseCount-1건 이하로 줄면 충족 — v1 resolvesTarget과 같은 기준
    distance: (_grids, report) => Math.max(0, countOf(report) - Math.max(0, baseCount - 1)),
    sources: (grids) => collectSourceCells(synthetic, grids, model),
  };
}

// ── 체인 탐색 (빔 서치 + 예산 상한) ──────────────────────────

interface ChainState {
  /** 시작 그리드에 **추가로** 얹는 수순 */
  extra: BaseRevisionOp[];
  grids: ClassGrid[];
  report: TimetableAuditReport;
  distance: number;
  steps: FixCandidate[];
}

/** 상태 지문 — 순서만 다른 같은 수순 집합을 한 번만 본다 (스펙 §3-1) */
const stateKey = (extra: BaseRevisionOp[]) => extra.map(opKey).sort().join("|");

function* askFixGenerator(params: AskFixParams): Generator<AskFixProgress, FixPlan, void> {
  const {
    baseGrids,
    ops,
    currentGrids,
    model,
    goal,
    beamWidth = 8,
    maxDepth = 3,
    evalBudget = 600,
    maxMovesPerState = 200,
  } = params;

  // 기준 리포트는 후보와 같은 파이프라인으로 만든다 (v1과 같은 이유 — 화면 값 신뢰 0)
  const baseline = cloneClassGrids(baseGrids);
  applyRevisionOps(baseline, ops);
  const oldReport = validateTimetable(baseline, model);
  const evaluator = buildGoalEvaluator(goal, baseline, model, oldReport);

  const root: ChainState = {
    extra: [],
    grids: baseline,
    report: oldReport,
    distance: evaluator.distance(baseline, oldReport),
    steps: [],
  };

  const finish = (
    state: ChainState,
    resolvesGoal: boolean,
    evaluated: number,
    budgetExhausted: boolean
  ): FixPlan => ({
    goalText: evaluator.text,
    steps: state.steps,
    resolvesGoal,
    finalSoftTotal: state.report.soft.total,
    newPenalties: diffPenalties(oldReport.soft.details, state.report.soft.details).map(
      (e) => e.detail
    ),
    remaining: state.distance,
    initialRemaining: root.distance,
    evaluated,
    budgetExhausted,
  });

  // 이미 충족된 목표에 탐색을 돌리지 않는다 — "고칠 게 없습니다"가 정직한 답이다
  if (root.distance === 0) return finish(root, true, 0, false);

  const seen = new Set<string>([stateKey([])]);
  let beam: ChainState[] = [root];
  let best = root; // 목표에 가장 가까운 상태 (동률이면 점수가 낮은 쪽)
  let evaluated = 0;
  let budgetExhausted = false;

  // 더 나은 상태인가 — ① 목표에 가까울수록 ② 같으면 총점이 낮을수록
  const better = (a: ChainState, b: ChainState) =>
    a.distance !== b.distance ? a.distance < b.distance : a.report.soft.total < b.report.soft.total;

  for (let depth = 1; depth <= maxDepth && !budgetExhausted; depth++) {
    const next: ChainState[] = [];
    let solved: ChainState | null = null;

    for (const st of beam) {
      if (budgetExhausted) break;
      const sources = evaluator.sources(st.grids);
      if (!sources.length) continue;
      const moves = createMoveGenerator(st.grids, model).generate({
        sources,
        // 체인은 모든 슬롯을 본다 — 목표가 요일 축이라는 보장이 없다
        differentDayOnly: false,
        maxCandidates: maxMovesPerState,
      });

      for (const { op, grid } of moves) {
        if (evaluated >= evalBudget) {
          budgetExhausted = true;
          break;
        }
        const extra = [...st.extra, op];
        const k = stateKey(extra);
        if (seen.has(k)) continue;
        seen.add(k);

        const grids = cloneClassGrids(baseGrids);
        applyRevisionOps(grids, [...ops, ...extra]);
        const report = validateTimetable(grids, model);
        evaluated++;
        if (evaluated % CHUNK_SIZE === 0) yield { evaluated, budget: evalBudget, depth };

        // **모든 접두 상태가 신규 하드 0을 유지한다** (스펙 §3-1).
        // 적용이 기존 draft_op 순차라 3수 계획의 1수만 적용된 순간에도 유효해야 한다.
        // 접두 상태들은 이미 이 관문을 통과한 상태이므로, 누적 대조 한 번으로 전 접두가 보장된다.
        if (diffNewHardViolations(oldReport.hard, report.hard).length > 0) continue;

        const distance = evaluator.distance(grids, report);
        const effects = diffPenalties(st.report.soft.details, report.soft.details);
        const step: FixCandidate = {
          op,
          desc:
            op.type === "swap_pair"
              ? describePairOp(st.grids, op)
              : op.type === "swap"
                ? describeOp(grid, op)
                : "",
          oldSoftTotal: st.report.soft.total,
          newSoftTotal: report.soft.total,
          deltaScore: report.soft.total - st.report.soft.total,
          resolvesTarget: distance === 0,
          sideEffects: effects.slice(0, 3).map(penaltyLine),
        };
        const cand: ChainState = {
          extra,
          grids,
          report,
          distance,
          steps: [...st.steps, step],
        };

        if (better(cand, best)) best = cand;
        if (distance === 0 && (!solved || cand.report.soft.total < solved.report.soft.total)) {
          solved = cand;
        }
        next.push(cand);
      }
    }

    // 목표를 채운 수순이 나오면 거기서 멈춘다 — 1수로 풀리면 1수에서 끝난다
    if (solved) return finish(solved, true, evaluated, budgetExhausted);
    if (!next.length) break;

    next.sort((a, b) => a.distance - b.distance || a.report.soft.total - b.report.soft.total);
    beam = next.slice(0, beamWidth);
  }

  // 못 풀었다 — 목표에 가장 가까운 상태를 부분 답으로 내되 resolvesGoal:false를 명시한다.
  // 한 발짝도 가까워지지 않았으면 빈 계획이다 (없는 진전을 있는 것처럼 말하지 않는다).
  const partial = best.distance < root.distance ? best : root;
  return finish(partial, false, evaluated, budgetExhausted);
}

/** 동기 실행 — 스크립트·자가 테스트용 */
export function findFixPlan(params: AskFixParams): FixPlan {
  const it = askFixGenerator(params);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * 청크 실행 — 예산 600회 ≈ 3.2초라 동기로 돌리면 화면이 멈춘다 (스펙 §3-1).
 * 25건마다 제어를 이벤트 루프에 돌려주므로 진행률 표시와 스크롤이 살아 있다.
 */
export async function findFixPlanAsync(
  params: AskFixParams,
  onProgress?: (p: AskFixProgress) => void
): Promise<FixPlan> {
  const it = askFixGenerator(params);
  let step = it.next();
  while (!step.done) {
    onProgress?.(step.value);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    step = it.next();
  }
  return step.value;
}
