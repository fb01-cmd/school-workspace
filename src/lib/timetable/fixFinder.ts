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
import { buildSimulMatcher } from "./simul";
import type {
  BaseRevisionOp,
  ClassGrid,
  HardViolation,
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
  normSubject,
  validateTimetable,
} from "./validate";

const DAY_LABEL = ["", "월", "화", "수", "목", "금"];
const norm = (e: string) => (e || "").trim().toLowerCase();

/** 한 번에 몇 건을 평가하고 UI에 제어를 돌려줄지 — 실측 5.4ms/건 기준 청크당 약 135ms */
const CHUNK_SIZE = 25;

export interface FixCandidate {
  /** 항상 type:"swap" (v1) — 빈 교시로의 이동도 swap으로 표현된다 */
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

/** 맞교환 op의 정규화 키 — 같은 두 슬롯을 순서만 바꾼 중복 후보를 제거한다 */
const opKey = (op: Extract<BaseRevisionOp, { type: "swap" }>) => {
  const [x, y] = [slotKey(op.a), slotKey(op.b)].sort();
  return `${op.grade}-${op.classNum}|${x}|${y}`;
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
    // S4 — 그 학급 그 요일의 중복 과목 셀 (첫 건 제외)
    const [grade, classNum] = target.key.split("-").map(Number);
    const grid = findGrid(grids, grade, classNum);
    if (!grid) return [];
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
  const gdp = model.gradeDayPeriods || deriveGradeDayPeriods(currentGrids);
  const operatingPeriods = (grade: number, day: number) =>
    gdp[grade]?.[day] ?? model.periodsPerDay;
  const occ = buildOccupancy(currentGrids);
  const simulMatcher = buildSimulMatcher(model.simulGroups || [], model.subjects);

  /** 자리표시·동시수업 셀인가 — 편집 경로(handleCellClick·analyzeOpImpact)와 같은 기준 */
  const isLocked = (grid: ClassGrid, s: Slot): boolean => {
    for (const l of findCell(grid, s.day, s.period)?.lessons || []) {
      if (l.simul) return true;
      if (simulMatcher(grid.grade, grid.classNum, s.day, s.period, l.subjectName)) return true;
    }
    return false;
  };

  // S1·S4·S5·S6은 "다른 요일"로만 옮긴다(요일 단위 감점이라 같은 요일 안에서 옮겨봐야 그대로다).
  // S2·S3은 같은 요일 안에서 교시를 바꾸는 것만으로 풀리므로 모든 슬롯을 본다.
  const differentDayOnly = target.code !== "S2" && target.code !== "S3";

  const sources = collectSourceCells(target, currentGrids, model);
  const seenOps = new Set<string>();
  const candidates: { op: Extract<BaseRevisionOp, { type: "swap" }>; grid: ClassGrid }[] = [];

  outer: for (const src of sources) {
    const grid = findGrid(currentGrids, src.grade, src.classNum);
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
        if (checkPlaceholderOp(currentGrids, op)) continue;
        if (!includeDoomed && isDoomed(grid, op.a, op.b, occ, operatingPeriods)) continue;
        seenOps.add(k);
        candidates.push({ op, grid });
        if (candidates.length >= maxCandidates) break outer;
      }
    }
  }

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
          desc: describeOp(grid, op),
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
