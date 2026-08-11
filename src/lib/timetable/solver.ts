/**
 * Phase 9c-C: 기초시간표 솔버 코어 — 순수 함수, Firestore·브라우저 API 무의존
 *
 * 상위 스펙: docs/phase9c_spec.md §5 (컴시간 부분 자동배정 → 자동 시간표작성 → [자동 조정하여라]의 재현)
 * Web Worker 탑재를 전제로 한 순수 모듈 — Node(tsx) 스크립트로도 그대로 실측한다.
 *
 * 배치 순서 (컴시간 계승, §5): ① 고정(일괄 배정·가상 교사 자리표시) 선반영 ② 동시수업 그룹(가장 경직)
 * ③ 특별실 ④ 연속 블록 ⑤ 일반 — MRV(잔여 후보 최소 우선) 그리디 ⑥ 막힌 섹션은 ejection chain
 * (매뉴얼 §8-라 "걸림돌 배정을 삭제해 다른 곳으로 옮기고 재배정"의 자동화, 깊이 2)
 * ⑦ 국소 탐색으로 소프트 점수 개선(이동·학급 내 교환) — 반복 예산제.
 *
 * 결정론 (§5): 시드 고정 mulberry32 — 같은 입력 = 같은 출력. 시간 예산 대신 반복 예산을 쓰는 것도
 * 결정론 때문 (벽시계 기준 중단은 기기마다 다른 결과를 낳는다).
 *
 * 산출 (§5): 완성 그리드 + 미배정 잔여 목록. 미배정은 실패가 아니라 수동 조정 대상.
 * 소프트 가중치는 검사기(validate.ts S1~S6)와 동일 — 최종 판정은 반드시 validateTimetable 관문.
 */

import { buildSimulMatcher } from "./simul";
import { buildVenueMatcher } from "./venue";
import {
  ClassGrid,
  TimetableConstraintModel,
  TimetableLesson,
} from "./types";
import { deriveGradeDayPeriods, teacherKeyOf } from "./validate";

const norm = (e: string) => (e || "").trim().toLowerCase();
const normSubject = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();

// ── 결정론 RNG (mulberry32) ───────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 섹션 모델 (배치 단위) ─────────────────────────────────────

/** 한 슬롯 점유 1회에 함께 묶이는 수업 단위 — 일반 1수업, 동시수업 그룹은 학급 전체 묶음 */
export interface SolverSection {
  id: string;
  kind: "fixed" | "simul" | "plain";
  label: string; // 사람이 읽는 표시 (미배정 리포트용)
  grade: number;
  classKeys: string[]; // "grade-classNum" — 점유 학급
  /** 실교사 키(이메일) — 교사 점유·소프트 대상. 가상 교사는 미포함(자리표시) */
  teacherKeys: string[];
  /** 출력 템플릿: classKey → 그 학급 셀에 넣을 lessons */
  lessonsByClass: Record<string, TimetableLesson[]>;
  /** 점유 횟수 (블록 포함 총 슬롯 아님 — 블록 1개 = 1회) */
  occurrences: number;
  /** 각 occurrence의 연속 길이 — 길이 occurrences 배열. 기본 전부 1. "2,2"+잔여1 = [2,2,1] */
  blockLens: number[];
  /** 특별실명 (배치 슬롯마다 점유). null = 특별실 아님 */
  room: string | null;
  /** 허용 슬롯 제한 ("day-period" 집합) — 등록부 slots 지정 그룹·고정 섹션 */
  allowedSlots: Set<string> | null;
  /** 배정금지 슬롯 (교사 assign-ban 합집합) */
  bannedSlots: Set<string>;
  /** kind=fixed 전용: 선반영 위치 */
  fixedSlots?: Array<{ day: number; period: number }>;
}

export interface SolverInput {
  sections: SolverSection[];
  gradeDayPeriods: Record<number, Record<number, number>>;
  lunchAfterPeriod: number;
  seed: number;
  /** 국소 탐색 반복 예산 (기본 30000) — 시간이 아니라 횟수 = 결정론 */
  localSearchIterations?: number;
  onProgress?: (phase: string, done: number, total: number) => void;
}

export interface SolverResult {
  grids: ClassGrid[];
  unplaced: Array<{ sectionId: string; label: string; remaining: number }>;
  stats: {
    sections: number;
    occurrencesTotal: number;
    placedGreedy: number;
    placedByEjection: number;
    localSearchAccepted: number;
    softScoreEstimate: number; // 내부 추정치 — 공식 점수는 validateTimetable
  };
}

// ── 섹션 컴파일 (그리드 역산 — Phase B 역산기의 구조화판) ──────
//
// 현행 그리드 + 등록부 → 섹션 목록. 신학기(그리드 없는) 경로는 시수표+등록부 컴파일러를
// Phase C-2에서 추가한다 (독립 시수표 입력 UI와 함께 — phase9c_spec §2-1ⓑ).

export function compileSectionsFromGrids(
  grids: ClassGrid[],
  model: TimetableConstraintModel
): SolverSection[] {
  const simulGroups = (model.simulGroups || []).filter((g) => g.active);
  const venueGroups = (model.venueGroups || []).filter((g) => g.active);
  const simulMatch = buildSimulMatcher(simulGroups);
  const venueMatch = buildVenueMatcher(venueGroups);
  const sections: SolverSection[] = [];

  // 교사 assign-ban 색인: 교사키 → 금지 슬롯 집합
  const banByTeacher = new Map<string, Set<string>>();
  for (const ban of (model.teacherSlotBans || []).filter(
    (b) => b.active && b.kind === "assign"
  )) {
    const key = norm(ban.teacherEmail);
    if (!banByTeacher.has(key)) banByTeacher.set(key, new Set());
    for (const s of ban.slots) banByTeacher.get(key)!.add(`${s.day}-${s.period}`);
  }
  const bansFor = (teacherKeys: string[]): Set<string> => {
    const out = new Set<string>();
    for (const tk of teacherKeys)
      for (const slot of banByTeacher.get(tk) || []) out.add(slot);
    return out;
  };

  // ── ① 동시수업 그룹 → simul 섹션 ──
  // 그룹의 슬롯마다 수업 구성이 다를 수 있다 (실측: 수과탐 분반 — 월5=수탐A·금3=수탐B).
  // 같은 구성(시그니처)끼리 묶어 섹션을 나눈다 — 섹션 내 occurrence는 서로 교환 가능 단위.
  const simulSlotOwner = new Map<string, string>(); // "g-c|d-p|subj" → 그룹 라벨 (일반 섹션에서 제외용)
  for (const g of simulGroups) {
    const oneMatch = buildSimulMatcher([g]);
    // 슬롯 → 학급별 수업 구성 수집
    const bySlot = new Map<string, Record<string, TimetableLesson[]>>();
    for (const grid of grids) {
      if (grid.grade !== g.grade || !g.classNums.includes(grid.classNum)) continue;
      const ck = `${grid.grade}-${grid.classNum}`;
      for (const cell of grid.cells || []) {
        for (const lesson of cell.lessons || []) {
          if (!oneMatch(grid.grade, grid.classNum, cell.day, cell.period, lesson.subjectName))
            continue;
          const slotKey = `${cell.day}-${cell.period}`;
          simulSlotOwner.set(`${ck}|${slotKey}|${normSubject(lesson.subjectName)}`, g.label);
          if (!bySlot.has(slotKey)) bySlot.set(slotKey, {});
          const slotLessons = bySlot.get(slotKey)!;
          if (!slotLessons[ck]) slotLessons[ck] = [];
          // room·simul 스탬프는 제거 — 산출 그리드의 특별실·동시수업 판정은 등록부(matcher)가 단일 원본
          const { room: _r, simul: _s, ...rest } = lesson;
          slotLessons[ck].push({ ...rest, teachers: [...(lesson.teachers || [])] });
        }
      }
    }
    if (!bySlot.size) continue; // 그리드에 없는 그룹 (비활성 학기 등)
    // 시그니처: 학급별 (과목·교사) 구성 — 같은 구성 슬롯끼리 한 섹션
    const signatureOf = (lc: Record<string, TimetableLesson[]>) =>
      JSON.stringify(
        Object.keys(lc)
          .sort()
          .map((ck) => [
            ck,
            lc[ck]
              .map(
                (l) =>
                  `${normSubject(l.subjectName)}:${(l.teachers || [])
                    .map((t) => teacherKeyOf(t))
                    .sort()
                    .join(",")}`
              )
              .sort(),
          ])
      );
    const bySignature = new Map<string, { lessonsByClass: Record<string, TimetableLesson[]>; slots: string[] }>();
    for (const [slotKey, lc] of [...bySlot.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const sig = signatureOf(lc);
      if (!bySignature.has(sig)) bySignature.set(sig, { lessonsByClass: lc, slots: [] });
      bySignature.get(sig)!.slots.push(slotKey);
    }
    let sigIdx = 0;
    for (const { lessonsByClass, slots } of bySignature.values()) {
      const teacherKeys = new Set<string>();
      for (const lessons of Object.values(lessonsByClass))
        for (const l of lessons)
          for (const t of l.teachers || []) if (norm(t.email)) teacherKeys.add(norm(t.email));
      // 특별실: 구성 (학급,과목)이 특별실 판정이면 그룹 전체가 그 실 사용 (슬롯 제한형은 상시 점유로 보수 처리)
      let room: string | null = null;
      for (const [ck, lessons] of Object.entries(lessonsByClass)) {
        const [gr, cn] = ck.split("-").map(Number);
        for (const l of lessons) {
          for (const slot of slots) {
            const [d, p] = slot.split("-").map(Number);
            const r = venueMatch(gr, cn, d, p, l.subjectName);
            if (r) room = r;
          }
        }
      }
      const tk = [...teacherKeys].sort();
      const blockLens = parseBlockLens(g.consecutive, slots.length); // slots.length = 주당 총 교시
      sections.push({
        id: `simul:${g.label}#${sigIdx++}`,
        kind: "simul",
        label: `동시수업 "${g.label}"`,
        grade: g.grade,
        // 시그니처에 실제 등장한 학급만 점유 (등록부 classNums와 다르면 그리드가 진실)
        classKeys: Object.keys(lessonsByClass).sort(),
        teacherKeys: tk,
        lessonsByClass,
        occurrences: blockLens.length,
        blockLens,
        room,
        allowedSlots: g.slots?.length
          ? new Set(g.slots.map((s) => `${s.day}-${s.period}`))
          : null,
        bannedSlots: bansFor(tk),
      });
    }
  }

  // ── ② 잔여 수업 → (학급, 과목, 교사집합) 단위 일반/고정 섹션 ──
  interface Bucket {
    grade: number;
    classNum: number;
    lesson: TimetableLesson;
    teacherKeys: string[]; // 실교사만
    allVirtual: boolean;
    slots: Array<{ day: number; period: number }>;
    roomSlots: Map<string, string>; // "d-p" → roomName (특별실 판정 슬롯)
  }
  const buckets = new Map<string, Bucket>();
  for (const grid of grids) {
    const ck = `${grid.grade}-${grid.classNum}`;
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const subj = normSubject(lesson.subjectName);
        if (simulSlotOwner.has(`${ck}|${cell.day}-${cell.period}|${subj}`)) continue; // 그룹 소유
        const tks = (lesson.teachers || []).map((t) => norm(t.email)).filter(Boolean).sort();
        const allVirtual = tks.length === 0;
        const teacherSig = allVirtual
          ? (lesson.teachers || []).map((t) => teacherKeyOf(t)).sort().join(",")
          : tks.join(",");
        const key = `${ck}|${subj}|${teacherSig}`;
        if (!buckets.has(key)) {
          const { room: _r, simul: _s, ...rest } = lesson; // 스탬프 제거 — 판정은 등록부가 단일 원본
          buckets.set(key, {
            grade: grid.grade,
            classNum: grid.classNum,
            lesson: { ...rest, teachers: [...(lesson.teachers || [])] },
            teacherKeys: tks,
            allVirtual,
            slots: [],
            roomSlots: new Map(),
          });
        }
        const b = buckets.get(key)!;
        b.slots.push({ day: cell.day, period: cell.period });
        const room = venueMatch(grid.grade, grid.classNum, cell.day, cell.period, lesson.subjectName);
        if (room) b.roomSlots.set(`${cell.day}-${cell.period}`, room);
      }
    }
  }

  const consecutiveRules = (model.consecutiveRules || []).filter((r) => r.active);
  for (const [key, b] of [...buckets.entries()].sort((a, c) => a[0].localeCompare(c[0]))) {
    const ck = `${b.grade}-${b.classNum}`;
    const label = `${ck}반 ${b.lesson.subjectName}`;
    if (b.allVirtual) {
      // 가상 교사 자리표시(창체·SLAT) = 일괄 배정 실데이터 — 컴시간 순서 ①대로 원위치 선반영 고정
      sections.push({
        id: `fixed:${key}`,
        kind: "fixed",
        label,
        grade: b.grade,
        classKeys: [ck],
        teacherKeys: [],
        lessonsByClass: { [ck]: [b.lesson] },
        occurrences: b.slots.length,
        blockLens: b.slots.map(() => 1),
        room: null,
        allowedSlots: null,
        bannedSlots: new Set(),
        fixedSlots: b.slots,
      });
      continue;
    }
    const rule = consecutiveRules.find(
      (r) =>
        r.grade === b.grade &&
        r.classNums.includes(b.classNum) &&
        normSubject(r.subjectName) === normSubject(b.lesson.subjectName) &&
        (!r.teacherEmail || b.teacherKeys.includes(norm(r.teacherEmail)))
    );
    // 슬롯 제한 특별실(과탐 실험형): 특별실 시수와 일반 시수를 별도 섹션으로 분리
    const roomNames = new Set(b.roomSlots.values());
    const roomAlways = b.roomSlots.size === b.slots.length && roomNames.size === 1;
    const makeSection = (
      suffix: string,
      hours: number, // 주당 총 교시 수 — 블록 분해는 여기서 한 번만
      room: string | null,
      pattern?: string,
      allowedSlots: Set<string> | null = null
    ): SolverSection => {
      const blockLens = parseBlockLens(pattern, hours);
      return {
        id: `plain:${key}${suffix}`,
        kind: "plain",
        label: room && !roomAlways ? `${label} (${room})` : label,
        grade: b.grade,
        classKeys: [ck],
        teacherKeys: b.teacherKeys,
        lessonsByClass: { [ck]: [b.lesson] },
        occurrences: blockLens.length,
        blockLens,
        room,
        allowedSlots,
        bannedSlots: bansFor(b.teacherKeys),
      };
    };
    if (roomAlways || b.roomSlots.size === 0) {
      const room = roomAlways ? [...roomNames][0] : null;
      sections.push(makeSection("", b.slots.length, room, rule?.pattern));
    } else {
      // 분리: 특별실 회차 + 일반 회차. 연속 규칙은 일반 쪽에만.
      // 슬롯 제한 특별실(과탐 실험형)의 실 사용은 등록부 슬롯에서만 성립하므로(검사기 판정도 동일)
      // 특별실 회차는 그 슬롯 집합 안에서만 배치한다 — 검사기·솔버 판정 단일화.
      const roomCount = b.roomSlots.size;
      const room = [...roomNames][0];
      sections.push(makeSection(":room", roomCount, room, undefined, new Set(b.roomSlots.keys())));
      const rest = b.slots.length - roomCount;
      if (rest > 0) sections.push(makeSection("", rest, null, rule?.pattern));
    }
  }

  return sections.sort((a, b) => a.id.localeCompare(b.id));
}

/** 연속 패턴 → blockLens. 총 시수 hours에서 패턴 블록을 빼고 남는 시수는 단독 1교시.
 *  패턴 없음/불능(합이 시수 초과)이면 전부 1. */
function parseBlockLens(pattern: string | undefined, hours: number): number[] {
  const blocks = (pattern || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 2);
  const sum = blocks.reduce((s, n) => s + n, 0);
  if (!blocks.length || sum > hours) return Array.from({ length: hours }, () => 1);
  const singles = hours - sum;
  return [...blocks.sort((a, b) => b - a), ...Array.from({ length: singles }, () => 1)];
}

// ── 소프트 추정 점수 (validate.ts S1~S6과 동일 가중 — 국소 탐색 내부용) ──

interface SoftState {
  /** 교사키 → day → 교시 집합 */
  teacherDays: Map<string, Map<number, Map<number, number>>>; // period → 점유 수 (동시수업 중복 대비 카운트)
  /** 교사키 → day → 과목 카운트 */
  teacherSubjects: Map<string, Map<number, Map<string, number>>>;
  /** 학급키 → day → 과목 카운트 */
  classSubjects: Map<string, Map<number, Map<string, number>>>;
}

function teacherDayPenalty(
  periods: Set<number>,
  subjects: Map<string, number>,
  L: number
): number {
  let pts = 0;
  if (periods.size >= 5) pts += periods.size - 4; // S1
  // S2: 연속 블록마다 (len-2)
  const sorted = [...periods].sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === sorted[i - 1] + 1) run++;
    else {
      if (run >= 3) pts += run - 2;
      run = 1;
    }
  }
  if (periods.has(L) && periods.has(L + 1)) pts += 1; // S3
  const subjectCount = [...subjects.values()].filter((n) => n > 0).length;
  if (subjectCount >= 3) pts += subjectCount - 2; // S5
  const afternoon = sorted.filter((p) => p > L).length;
  if (afternoon >= 3 && afternoon === sorted.length) pts += 1; // S6
  return pts;
}

function classDayPenalty(subjects: Map<string, number>): number {
  let pts = 0;
  for (const n of subjects.values()) if (n >= 2) pts += n - 1; // S4
  return pts;
}

// ── 솔버 본체 ─────────────────────────────────────────────────

interface Occurrence {
  sectionIdx: number;
  occIdx: number;
  len: number;
  day: number;
  start: number; // 시작 교시 (len개 연속 점유)
}

export function solveTimetable(input: SolverInput): SolverResult {
  const { sections, gradeDayPeriods: gdp, lunchAfterPeriod: L } = input;
  const rng = mulberry32(input.seed);
  const progress = input.onProgress || (() => {});

  // ── 점유 상태 ──
  const classOcc = new Map<string, number>(); // "g-c|d-p" → sectionIdx
  const teacherOcc = new Map<string, number>(); // "tk|d-p" → sectionIdx
  const roomOcc = new Map<string, number>(); // "room|d-p" → sectionIdx
  const placed = new Map<string, Occurrence>(); // "sectionIdx:occIdx" → occurrence
  /** 연속 패턴 섹션의 요일별 배치 수 — 블록·단독이 같은 날 붙으면 연속 길이가 어긋나므로(H9)
   *  패턴 섹션은 요일당 1회로 제한한다 (컴시간 "2,2"의 통상 의미 = 서로 다른 요일 두 블록) */
  const sectionDayCount = new Map<number, Map<number, number>>();
  const hasPattern = sections.map((s) => s.blockLens.some((l) => l >= 2));
  const soft: SoftState = {
    teacherDays: new Map(),
    teacherSubjects: new Map(),
    classSubjects: new Map(),
  };
  let softScore = 0;

  // S4(학급 과목 중복) 집계 대상 과목 — 전원 가상 교사(창체·SLAT 자리표시) 수업은 검사기와 동일하게 제외
  const subjectsOf = (s: SolverSection, ck: string): string[] =>
    (s.lessonsByClass[ck] || [])
      .filter((l) => (l.teachers || []).some((t) => norm(t.email)))
      .map((l) => normSubject(l.subjectName));

  const bump = <K>(m: Map<K, number>, k: K, d: number) => {
    const v = (m.get(k) || 0) + d;
    if (v <= 0) m.delete(k);
    else m.set(k, v);
  };
  const nested = <A, B>(m: Map<A, Map<number, Map<B, number>>>, a: A, day: number) => {
    if (!m.has(a)) m.set(a, new Map());
    const dm = m.get(a)!;
    if (!dm.has(day)) dm.set(day, new Map());
    return dm.get(day)!;
  };
  const teacherDaySnapshot = (tk: string, day: number) => {
    const periods = new Set<number>();
    for (const [p, n] of soft.teacherDays.get(tk)?.get(day) || []) if (n > 0) periods.add(p);
    return {
      periods,
      subjects: soft.teacherSubjects.get(tk)?.get(day) || new Map<string, number>(),
    };
  };

  /** occurrence 반영/해제 — 점유 맵과 소프트 상태를 함께 갱신, softScore 증분 유지 */
  function apply(occ: Occurrence, dir: 1 | -1) {
    const s = sections[occ.sectionIdx];
    // 소프트 delta: 영향 받는 (교사,day)·(학급,day)의 전후 점수 차
    let before = 0;
    for (const tk of s.teacherKeys) {
      const snap = teacherDaySnapshot(tk, occ.day);
      before += teacherDayPenalty(snap.periods, snap.subjects, L);
    }
    for (const ck of s.classKeys)
      before += classDayPenalty(nested(soft.classSubjects, ck, occ.day));

    for (let p = occ.start; p < occ.start + occ.len; p++) {
      const slot = `${occ.day}-${p}`;
      for (const ck of s.classKeys) {
        if (dir === 1) classOcc.set(`${ck}|${slot}`, occ.sectionIdx);
        else classOcc.delete(`${ck}|${slot}`);
        for (const subj of subjectsOf(s, ck))
          bump(nested(soft.classSubjects, ck, occ.day), subj, dir);
      }
      for (const tk of s.teacherKeys) {
        if (dir === 1) teacherOcc.set(`${tk}|${slot}`, occ.sectionIdx);
        else teacherOcc.delete(`${tk}|${slot}`);
        bump(nested(soft.teacherDays, tk, occ.day) as Map<number, number>, p, dir);
        // 교사 과목: 그 교사가 맡은 lessons의 과목 (섹션 학급 전체에서 — 동시수업은 자기 분반 과목)
        for (const ck of s.classKeys) {
          for (const l of s.lessonsByClass[ck] || []) {
            if ((l.teachers || []).some((t) => norm(t.email) === tk))
              bump(nested(soft.teacherSubjects, tk, occ.day), normSubject(l.subjectName), dir);
          }
        }
      }
      if (s.room) {
        if (dir === 1) roomOcc.set(`${s.room}|${slot}`, occ.sectionIdx);
        else roomOcc.delete(`${s.room}|${slot}`);
      }
    }

    let after = 0;
    for (const tk of s.teacherKeys) {
      const snap = teacherDaySnapshot(tk, occ.day);
      after += teacherDayPenalty(snap.periods, snap.subjects, L);
    }
    for (const ck of s.classKeys)
      after += classDayPenalty(nested(soft.classSubjects, ck, occ.day));
    softScore += after - before;

    if (!sectionDayCount.has(occ.sectionIdx)) sectionDayCount.set(occ.sectionIdx, new Map());
    bump(sectionDayCount.get(occ.sectionIdx)!, occ.day, dir);

    const key = `${occ.sectionIdx}:${occ.occIdx}`;
    if (dir === 1) placed.set(key, occ);
    else placed.delete(key);
  }

  /** 슬롯 후보가 물리적으로 가능한가 (하드 전 항목) */
  function feasible(sectionIdx: number, day: number, start: number, len: number): boolean {
    const s = sections[sectionIdx];
    const maxP = gdp[s.grade]?.[day] || 0;
    if (start < 1 || start + len - 1 > maxP) return false;
    // 연속 패턴 섹션: 요일당 1회 (블록끼리·블록+단독 인접 시 연속 길이 붕괴 방지)
    if (hasPattern[sectionIdx] && (sectionDayCount.get(sectionIdx)?.get(day) || 0) > 0)
      return false;
    for (let p = start; p < start + len; p++) {
      const slot = `${day}-${p}`;
      if (s.bannedSlots.has(slot)) return false;
      if (s.allowedSlots && !s.allowedSlots.has(slot)) return false;
      for (const ck of s.classKeys) if (classOcc.has(`${ck}|${slot}`)) return false;
      for (const tk of s.teacherKeys) if (teacherOcc.has(`${tk}|${slot}`)) return false;
      if (s.room && roomOcc.has(`${s.room}|${slot}`)) return false;
    }
    return true;
  }

  function candidateSlots(sectionIdx: number, len: number): Array<{ day: number; start: number }> {
    const s = sections[sectionIdx];
    const out: Array<{ day: number; start: number }> = [];
    for (let day = 1; day <= 5; day++) {
      const maxP = gdp[s.grade]?.[day] || 0;
      for (let start = 1; start + len - 1 <= maxP; start++) {
        if (feasible(sectionIdx, day, start, len)) out.push({ day, start });
      }
    }
    return out;
  }

  /** 그리디 배치용 슬롯 평가 — 소프트 delta 추정 (배치해 보고 즉시 되돌리는 대신 직접 계산) */
  function slotCost(sectionIdx: number, day: number, start: number, len: number): number {
    const occ: Occurrence = { sectionIdx, occIdx: -1, len, day, start };
    apply(occ, 1);
    const cost = softScore;
    apply(occ, -1);
    return cost;
  }

  // ── ① 고정 선반영 ──
  const fixedIdx = sections
    .map((s, i) => i)
    .filter((i) => sections[i].kind === "fixed");
  for (const i of fixedIdx) {
    const s = sections[i];
    (s.fixedSlots || []).forEach((slot, j) => {
      apply({ sectionIdx: i, occIdx: j, len: 1, day: slot.day, start: slot.period }, 1);
    });
  }

  // ── ②~⑤ MRV 그리디 + ⑥ ejection ──
  // 배치 대기 목록: (sectionIdx, occIdx, len). 경직도 티어 = 동시수업(0) → 특별실(1) → 블록(2) → 일반(3)
  interface Pending {
    sectionIdx: number;
    occIdx: number;
    len: number;
    tier: number;
  }
  const pending: Pending[] = [];
  sections.forEach((s, i) => {
    if (s.kind === "fixed") return;
    s.blockLens.forEach((len, j) => {
      const tier = s.kind === "simul" ? 0 : s.room ? 1 : len >= 2 ? 2 : 3;
      pending.push({ sectionIdx: i, occIdx: j, len, tier });
    });
  });
  const totalToPlace = pending.length;
  let placedGreedy = 0;
  let placedByEjection = 0;
  const stuck: Pending[] = [];

  progress("greedy", 0, totalToPlace);
  while (pending.length) {
    // MRV: 후보 최소 (동률이면 티어 → 넓은 섹션 → id 순)
    let best = -1;
    let bestCands: Array<{ day: number; start: number }> = [];
    let bestScore = Infinity;
    for (let k = 0; k < pending.length; k++) {
      const p = pending[k];
      const cands = candidateSlots(p.sectionIdx, p.len);
      const score =
        cands.length * 100 +
        p.tier * 10 -
        sections[p.sectionIdx].classKeys.length;
      if (score < bestScore) {
        bestScore = score;
        best = k;
        bestCands = cands;
      }
      if (cands.length === 0) break; // 즉시 처리 (막힌 것 우선)
    }
    const p = pending.splice(best, 1)[0];
    if (!bestCands.length) {
      stuck.push(p);
      continue;
    }
    // 슬롯 선택: 소프트 delta 최소, 동률은 rng
    let chosen = bestCands[0];
    let minCost = Infinity;
    const ties: Array<{ day: number; start: number }> = [];
    for (const c of bestCands) {
      const cost = slotCost(p.sectionIdx, c.day, c.start, p.len);
      if (cost < minCost) {
        minCost = cost;
        ties.length = 0;
        ties.push(c);
      } else if (cost === minCost) ties.push(c);
    }
    chosen = ties[Math.floor(rng() * ties.length)];
    apply({ sectionIdx: p.sectionIdx, occIdx: p.occIdx, len: p.len, day: chosen.day, start: chosen.start }, 1);
    placedGreedy++;
    if (placedGreedy % 50 === 0) progress("greedy", placedGreedy, totalToPlace);
  }

  // ── ⑥ ejection chain (깊이 2): 막힌 occurrence를 위해 걸림돌을 옮긴다 ──
  const unplacedFinal: Pending[] = [];
  progress("ejection", 0, stuck.length);
  for (const p of stuck) {
    if (tryPlaceWithEjection(p, 2)) placedByEjection++;
    else unplacedFinal.push(p);
  }

  function tryPlaceWithEjection(p: Pending, depth: number): boolean {
    const direct = candidateSlots(p.sectionIdx, p.len);
    if (direct.length) {
      const c = direct[Math.floor(rng() * direct.length)];
      apply({ sectionIdx: p.sectionIdx, occIdx: p.occIdx, len: p.len, day: c.day, start: c.start }, 1);
      return true;
    }
    if (depth <= 0) return false;
    const s = sections[p.sectionIdx];
    // 후보 슬롯(점유 무시, 고정 제외 걸림돌 수 최소)을 훑는다
    for (let day = 1; day <= 5; day++) {
      const maxP = gdp[s.grade]?.[day] || 0;
      for (let start = 1; start + p.len - 1 <= maxP; start++) {
        // 금지·허용 제한은 절대 조건
        let legal = true;
        const blockerKeys = new Set<string>();
        for (let per = start; per < start + p.len && legal; per++) {
          const slot = `${day}-${per}`;
          if (s.bannedSlots.has(slot) || (s.allowedSlots && !s.allowedSlots.has(slot))) {
            legal = false;
            break;
          }
          for (const ck of s.classKeys) {
            const o = classOcc.get(`${ck}|${slot}`);
            if (o !== undefined) blockerKeys.add(String(o));
          }
          for (const tk of s.teacherKeys) {
            const o = teacherOcc.get(`${tk}|${slot}`);
            if (o !== undefined) blockerKeys.add(String(o));
          }
          if (s.room) {
            const o = roomOcc.get(`${s.room}|${slot}`);
            if (o !== undefined) blockerKeys.add(String(o));
          }
        }
        if (!legal || blockerKeys.size === 0 || blockerKeys.size > 2) continue;
        const blockerIdxs = [...blockerKeys].map(Number);
        if (blockerIdxs.some((bi) => sections[bi].kind === "fixed")) continue;
        // 걸림돌의 해당 슬롯 occurrence 수집
        const removedOccs: Occurrence[] = [];
        for (const [, occ] of placed) {
          if (!blockerIdxs.includes(occ.sectionIdx)) continue;
          const overlaps =
            occ.day === day && occ.start < start + p.len && start < occ.start + occ.len;
          if (overlaps) removedOccs.push(occ);
        }
        for (const occ of removedOccs) apply(occ, -1);
        if (!feasible(p.sectionIdx, day, start, p.len)) {
          for (const occ of removedOccs) apply(occ, 1); // 롤백 (다른 슬롯 겹침 등)
          continue;
        }
        apply({ sectionIdx: p.sectionIdx, occIdx: p.occIdx, len: p.len, day, start }, 1);
        // 걸림돌 재배치 (재귀 — 깊이 감소)
        const failed: Occurrence[] = [];
        for (const occ of removedOccs) {
          if (
            !tryPlaceWithEjection(
              { sectionIdx: occ.sectionIdx, occIdx: occ.occIdx, len: occ.len, tier: 0 },
              depth - 1
            )
          )
            failed.push(occ);
        }
        if (!failed.length) return true;
        // 실패 → 전체 롤백
        apply({ sectionIdx: p.sectionIdx, occIdx: p.occIdx, len: p.len, day, start }, -1);
        for (const occ of removedOccs) {
          const key = `${occ.sectionIdx}:${occ.occIdx}`;
          const cur = placed.get(key);
          if (cur) apply(cur, -1); // 재배치돼 있으면 회수
          apply(occ, 1); // 원위치
        }
      }
    }
    return false;
  }

  // ── ⑦ 국소 탐색: 이동 + 학급 내 맞교환 힐클라임 (소프트 개선, 하드 유지) ──
  // 학급 그리드가 만석이면(실측: 34/34) 빈 슬롯 이동은 성립하지 않는다 —
  // 같은 학급 두 수업의 슬롯 맞교환이 주력 이동이다 (컴시간 [자동 조정하여라]도 교환 기반).
  const iterations = input.localSearchIterations ?? 30000;
  let accepted = 0;
  progress("local", 0, iterations);
  const occKeys = [...placed.keys()].filter(
    (k) => sections[placed.get(k)!.sectionIdx].kind !== "fixed"
  );
  // 학급키 → 그 학급을 점유하는 occurrence 키 목록 (맞교환 상대 후보)
  const byClass = new Map<string, string[]>();
  for (const k of occKeys) {
    const occ = placed.get(k)!;
    for (const ck of sections[occ.sectionIdx].classKeys) {
      if (!byClass.has(ck)) byClass.set(ck, []);
      byClass.get(ck)!.push(k);
    }
  }
  for (let it = 0; it < iterations && occKeys.length; it++) {
    if (it % 2000 === 0) progress("local", it, iterations);
    const key = occKeys[Math.floor(rng() * occKeys.length)];
    const cur = placed.get(key);
    if (!cur) continue;
    const s = sections[cur.sectionIdx];
    const before = softScore;

    // 이동 시도 (빈 슬롯이 있을 때만 성립)
    apply(cur, -1);
    const cands = candidateSlots(cur.sectionIdx, cur.len).filter(
      (c) => !(c.day === cur.day && c.start === cur.start)
    );
    if (cands.length) {
      const c = cands[Math.floor(rng() * cands.length)];
      const next: Occurrence = { ...cur, day: c.day, start: c.start };
      apply(next, 1);
      if (softScore < before) {
        accepted++;
        continue;
      }
      apply(next, -1);
    }
    apply(cur, 1);

    // 맞교환 시도 — 단일 학급 섹션끼리, 같은 학급, 같은 길이
    if (s.classKeys.length !== 1) continue;
    const peers = byClass.get(s.classKeys[0]) || [];
    if (peers.length < 2) continue;
    const otherKey = peers[Math.floor(rng() * peers.length)];
    if (otherKey === key) continue;
    const other = placed.get(otherKey);
    if (!other || other.len !== cur.len) continue;
    const so = sections[other.sectionIdx];
    if (so.classKeys.length !== 1) continue;
    apply(cur, -1);
    apply(other, -1);
    if (
      feasible(cur.sectionIdx, other.day, other.start, cur.len) &&
      // cur을 other 자리에 먼저 앉힌 뒤 other 가능성 검사 (교사 겹침 상호 검증)
      (() => {
        const movedCur: Occurrence = { ...cur, day: other.day, start: other.start };
        apply(movedCur, 1);
        if (feasible(other.sectionIdx, cur.day, cur.start, other.len)) {
          apply({ ...other, day: cur.day, start: cur.start }, 1);
          return true;
        }
        apply(movedCur, -1);
        return false;
      })()
    ) {
      if (softScore < before) {
        accepted++;
        continue;
      }
      // 개선 없음 → 원복
      apply(placed.get(key)!, -1);
      apply(placed.get(otherKey)!, -1);
      apply(cur, 1);
      apply(other, 1);
    } else {
      apply(cur, 1);
      apply(other, 1);
    }
  }

  // ── 그리드 출력 ──
  const gridMap = new Map<string, ClassGrid>();
  const allClassKeys = new Set<string>();
  for (const s of sections) for (const ck of s.classKeys) allClassKeys.add(ck);
  for (const ck of [...allClassKeys].sort()) {
    const [grade, classNum] = ck.split("-").map(Number);
    gridMap.set(ck, { grade, classNum, cells: [] });
  }
  for (const occ of placed.values()) {
    const s = sections[occ.sectionIdx];
    for (let p = occ.start; p < occ.start + occ.len; p++) {
      for (const ck of s.classKeys) {
        const grid = gridMap.get(ck)!;
        let cell = grid.cells.find((c) => c.day === occ.day && c.period === p);
        if (!cell) {
          cell = { day: occ.day, period: p, lessons: [] };
          grid.cells.push(cell);
        }
        for (const l of s.lessonsByClass[ck] || [])
          cell.lessons.push({ ...l, teachers: [...(l.teachers || [])] });
      }
    }
  }
  for (const grid of gridMap.values())
    grid.cells.sort((a, b) => a.day - b.day || a.period - b.period);

  // 미배정 집계 (섹션 단위 remaining 합산)
  const unplacedBySection = new Map<number, number>();
  for (const p of unplacedFinal)
    unplacedBySection.set(p.sectionIdx, (unplacedBySection.get(p.sectionIdx) || 0) + p.len);
  const unplaced = [...unplacedBySection.entries()].map(([i, remaining]) => ({
    sectionId: sections[i].id,
    label: sections[i].label,
    remaining,
  }));

  return {
    grids: [...gridMap.values()],
    unplaced,
    stats: {
      sections: sections.length,
      occurrencesTotal: totalToPlace,
      placedGreedy,
      placedByEjection,
      localSearchAccepted: accepted,
      softScoreEstimate: softScore,
    },
  };
}
