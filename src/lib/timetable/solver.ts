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

import { subjectMatches } from "./hoursAssignment";
import { buildSimulMatcher } from "./simul";
import { buildVenueMatcher } from "./venue";
import {
  ClassGrid,
  HoursRequirement,
  TimetableConstraintModel,
  TimetableLesson,
} from "./types";
import { deriveGradeDayPeriods, teacherKeyOf } from "./validate";

const norm = (e: string) => (e || "").trim().toLowerCase();
/** 결정론 문자열 비교 — localeCompare는 실행 환경 로케일(ICU)을 타서 같은 입력에
 *  Node와 브라우저가 다른 시간표를 냈다 (2026-08-15 실측: S4 3건 vs 2건).
 *  섹션·행 순서가 탐색 경로를 정하므로, 순서를 정하는 비교는 전부 코드포인트로 고정한다. */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
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
// 현행 그리드 + 등록부 → 섹션 목록. 신학기(그리드 없는) 경로는 아래
// compileSectionsFromHours (Phase C-2) — 시수표+등록부만으로 컴파일한다.

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
    for (const [slotKey, lc] of [...bySlot.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
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
  for (const [key, b] of [...buckets.entries()].sort((a, c) => cmpStr(a[0], c[0]))) {
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

  return sections.sort((a, b) => cmpStr(a.id, b.id));
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

// ── 섹션 컴파일 (백지 편성 — Phase C-2: 시수표+등록부만, 그리드를 보지 않는다) ──
//
// 그리드가 주던 정보 중 시수표(HoursRequirement)에 없는 것과 그 출처 (phase9c_spec §2-1ⓑ):
//  ① 자리표시(창체·SLAT) 수업의 고정 위치 — fixedBlocks 등록부가 원본 (§2-3②).
//     장래 교육과정 코호트 등록부(질의 결과 §2-2)는 이 형태(학급 단위 entries)로 전개해
//     넘긴다 — 컴파일러는 학년 축을 모른다 (학년 하드코딩 금지).
//  ② 동시수업 그룹의 슬롯별 구성 — 같은 셀 동시 분반(통사A+통사B)인지 슬롯별 교대
//     (월5=수탐A·금3=수탐B)인지 시수표만으로 구분 불능인 경우가 있다. 휴리스틱으로
//     추정하고 반드시 issues에 가정을 남긴다.
//  ③ 슬롯 제한형 특별실의 시수 배분 — 시수 중 몇 시간이 특별실인지 시수표는 모른다.
//     전 시수 실 점유로 보수 처리(H8은 확실히 방지, 대신 과제약) + issues.
//  ④ 교사 이름·과목 약칭 — 표시용. 계정 원장·term.subjects에서 주입(없어도 판정 무관).

export interface BlankCompileIssue {
  code:
    | "fixed-missing" // 자리표시 시수인데 고정 슬롯 등록부(fixedBlocks)에 없음 → H1로 드러난다
    | "fixed-mismatch" // 고정 슬롯 수 ≠ 시수
    | "fixed-standalone" // 등록부 슬롯인데 시수표 행 없음 → 자리표시 합성 점유 (업로드 경로 정상, §0-1a-③ⓒ)
    | "simul-assumed" // 동시수업 그룹 몫을 시수표에서 역산 — 가정을 명시
    | "simul-unsolved" // 그룹 구성 도출 실패 — 전 행 일반 섹션 강등 (H7로 드러난다)
    | "venue-slot-limited" // 슬롯 제한 특별실 — 배분 미상, 전 시수 점유 보수 처리
    | "class-slot-mismatch" // 학급 주간 슬롯 수요 ≠ 운영 교시수 (컴시간 §5-사 정합성)
    // 9c-I-2 (phase9c_i2_spec §4-3) — 계획 행 힌트 관련
    | "simul-tag-mismatch" // 태그 행 합 ≠ 그룹 교시수 → 그 학급만 태그 무시하고 추정 폴백
    | "simul-tag-unknown" // 태그가 가리키는 그룹이 이 학기 등록부에 없음 → 일반 취급
    | "venue-hours-no-group" // venueHours가 있는데 특별실 등록부 미매치 → 힌트 무시
    | "venue-hours-block-adjust"; // venueHours가 연속 블록 경계와 어긋나 올림 배분 (고지성)
  text: string;
}

export interface BlankCompileInput {
  hours: HoursRequirement[];
  model: TimetableConstraintModel;
  /** 학년별 요일별 운영 교시수 — 정합성 검사(§5-사)용. 백지에서는 설정·입력이 원본 */
  gradeDayPeriods: Record<number, Record<number, number>>;
  /** 표시 보강 (판정 무관): 이메일 → 이름 */
  teacherNames?: Record<string, string>;
  /** 표시 보강 (판정 무관): normSubject(과목명) → 약칭 */
  subjectShorts?: Record<string, string>;
}

export interface BlankCompileResult {
  sections: SolverSection[];
  issues: BlankCompileIssue[];
}

export function compileSectionsFromHours(input: BlankCompileInput): BlankCompileResult {
  const { hours, model, gradeDayPeriods: gdp } = input;
  const issues: BlankCompileIssue[] = [];
  const sections: SolverSection[] = [];

  const isVirtualKey = (tk: string) => !tk || tk.startsWith("name:");
  /** 시수표 행 → 출력 lesson 재구성. teacherKey가 그대로 왕복되어야 H1/H4 대조가 성립한다 */
  const lessonOf = (row: HoursRequirement): TimetableLesson => {
    const tk = row.teacherKey || "";
    const teachers = tk.startsWith("name:")
      ? [{ email: "", name: tk.slice(5) }]
      : tk
        ? [{ email: tk, name: input.teacherNames?.[tk] || tk }]
        : [];
    return {
      subjectName: row.subjectName,
      subjectShort: input.subjectShorts?.[normSubject(row.subjectName)] || row.subjectName,
      teachers,
    };
  };

  // 교사 assign-ban 색인 (compileSectionsFromGrids와 동일 규약)
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

  const venueGroups = (model.venueGroups || []).filter((g) => g.active);
  /** 슬롯 무관 특별실 조회 — 배치 전이라 (요일,교시)가 없으므로 매처를 못 쓴다 */
  const venueProbe = (
    grade: number,
    classNum: number,
    subjectName: string
  ): { roomName: string; restricted: boolean; slots: Array<{ day: number; period: number }> } | null => {
    const subj = normSubject(subjectName);
    // 등록부는 약칭("과탐"), 계획은 정식 명칭("과학탐구실험2")일 수 있다 — 완전 일치 →
    // 약칭 다리(term.subjects) → 줄임말 느슨 매칭 순으로 시도 (2026-08-16 실사고: 전부 미연결)
    const short = input.subjectShorts?.[subj];
    const nameHits = (s: string): boolean => {
      const ns = normSubject(s);
      if (ns === subj) return true;
      if (short && normSubject(short) === ns) return true;
      return subjectMatches(s, subjectName);
    };
    for (const g of venueGroups) {
      if (g.grade !== grade || !g.classNums.includes(classNum)) continue;
      if (!g.subjectNames.some(nameHits)) continue;
      return { roomName: g.roomName, restricted: !!g.slots?.length, slots: g.slots || [] };
    }
    return null;
  };
  /** 특별실 판정 + 슬롯 제한형 보수 처리 issue — 섹션 구성원 중 하나라도 걸리면 그 실 사용 */
  const roomFor = (
    members: Array<{ grade: number; classNum: number; subjectName: string }>,
    label: string
  ): string | null => {
    for (const m of members) {
      const v = venueProbe(m.grade, m.classNum, m.subjectName);
      if (!v) continue;
      if (v.restricted)
        issues.push({
          code: "venue-slot-limited",
          text: `${label} — 특별실 "${v.roomName}"이 슬롯 제한형이라 시수 중 몇 시간이 특별실인지 시수표로는 알 수 없습니다. 전 시수를 실 점유로 보수 처리합니다 (겹침은 확실히 막히지만 실제보다 빡빡해집니다)`,
        });
      return v.roomName;
    }
    return null;
  };

  interface Row extends HoursRequirement {
    consumed: boolean;
  }
  const rows: Row[] = hours.map((h) => ({ ...h, consumed: false }));
  const rowId = (r: HoursRequirement) =>
    `${r.grade}-${r.classNum}|${normSubject(r.subjectName)}|${r.teacherKey}`;

  // ── ① 동시수업 그룹 소비 ──
  //
  // 실데이터 구조 (2026-2 전 그룹 실측): 학급마다 **자기 과목 하나(또는 교대 두 개)**를 갖고,
  // 그룹의 전 학급이 같은 슬롯 집합에 동기화된다. 같은 셀에 여러 분반이 들어가는 구성은 없다.
  //
  // 시수표의 한계 (머리말 ②): 한 학급이 그룹 과목을 여러 개 가질 때(실측: 3-8 물Ⅱ3+화Ⅱ3)
  // **어느 쪽이 그룹 몫인지 시수표는 모른다.** 그룹은 전 학급 동시 진행이라 열(occurrence)마다
  // 교사가 겹칠 수 없다 — 이 제약으로 몫을 역산한다(소규모 백트래킹). 결과는 issues에 명시.
  const simulGroups = (model.simulGroups || []).filter((g) => g.active);

  // 9c-I-2 §4-1: 존재하지 않는 그룹을 가리키는 태그 정리 — 그 행은 무태그로 강등
  const activeGroupIds = new Set(simulGroups.map((g) => g.id));
  for (const r of rows) {
    if (r.simulGroupId && !activeGroupIds.has(r.simulGroupId)) {
      issues.push({
        code: "simul-tag-unknown",
        text: `${r.grade}-${r.classNum}반 ${r.subjectName} — 계획의 동시수업 소속이 가리키는 그룹이 이 학기 등록부에 없습니다. 등록부 승계 여부를 확인해 주세요 (일반 수업으로 배치합니다)`,
      });
      r.simulGroupId = null;
    }
  }

  for (const g of simulGroups) {
    const subjSet = new Set(g.subjectNames.map(normSubject));
    const byClass = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.consumed || r.grade !== g.grade || !g.classNums.includes(r.classNum)) continue;
      if (!subjSet.has(normSubject(r.subjectName))) continue;
      r.consumed = true;
      const ck = `${r.grade}-${r.classNum}`;
      if (!byClass.has(ck)) byClass.set(ck, []);
      byClass.get(ck)!.push(r);
    }
    if (!byClass.size) continue;
    const classKeys = [...byClass.keys()].sort();
    for (const list of byClass.values())
      list.sort((a, b) => cmpStr(rowId(a), rowId(b)));

    // 주당 그룹 교시수 h: 등록부 slots가 있으면 그 수, 없으면 학급별 합의 최소값
    // (합이 h보다 큰 학급은 초과분이 그룹 밖 일반 수업 — 부분집합 선택으로 가른다)
    const totals = classKeys.map((ck) =>
      byClass.get(ck)!.reduce((s, r) => s + r.hours, 0)
    );
    const h = g.slots?.length ? g.slots.length : Math.min(...totals);
    const allowedSlots = g.slots?.length
      ? new Set(g.slots.map((s) => `${s.day}-${s.period}`))
      : null;

    // 9c-I-2 §4-1: 태그 학급은 부분집합 탐색 생략 — 태그 행 전부가 그 학급의 그룹 몫.
    // 합 ≠ h면 그 학급만 태그를 무시하고 종전 추정으로 폴백한다 (그룹 전체를 죽이지 않는다).
    const fixedSubsetByClass = new Map<string, Row[] | null>();
    let allTagged = true;
    for (const ck of classKeys) {
      const tagged = byClass.get(ck)!.filter((r) => r.simulGroupId === g.id);
      if (tagged.length) {
        const sum = tagged.reduce((s, r) => s + r.hours, 0);
        if (sum === h) {
          fixedSubsetByClass.set(ck, tagged);
          continue;
        }
        issues.push({
          code: "simul-tag-mismatch",
          text: `동시수업 "${g.label}" ${ck}반 — 계획에 소속 표시된 수업 합(주 ${sum}시간)이 그룹 교시수(주 ${h}교시)와 다릅니다. 표시를 무시하고 추정으로 진행합니다`,
        });
      }
      fixedSubsetByClass.set(ck, null);
      allTagged = false;
    }

    // 열(occurrence) 배정: 학급마다 합=h인 행 부분집합을 골라, 행(시수 k)을 k개 열에 나눠
    // 싣는다. 제약 — 각 열은 학급당 정확히 수업 1개, 열 안에서 교사 중복 없음.
    interface BandCol {
      lessons: Map<string, Row>; // ck → row
      teachers: Set<string>;
    }
    const cols: BandCol[] = Array.from({ length: h }, () => ({
      lessons: new Map(),
      teachers: new Set(),
    }));
    const chosen = new Set<Row>();
    const tryClass = (ci: number): boolean => {
      if (ci === classKeys.length) return true;
      const ck = classKeys[ci];
      const list = byClass.get(ck)!;
      // 9c-I-2: 태그로 확정된 학급은 그 부분집합 하나만 시도
      const fixedSubset = fixedSubsetByClass.get(ck);
      const candidates: Row[][] = [];
      if (fixedSubset) {
        candidates.push([...fixedSubset]);
      } else {
        for (let mask = 1; mask < 1 << list.length; mask++) {
          let sum = 0;
          const subset: Row[] = [];
          for (let i = 0; i < list.length; i++)
            if (mask & (1 << i)) {
              sum += list[i].hours;
              subset.push(list[i]);
            }
          if (sum !== h) continue;
          candidates.push(subset);
        }
      }
      for (const subset of candidates) {
        subset.sort((a, b) => b.hours - a.hours || cmpStr(rowId(a), rowId(b)));
        const fill = (ri: number): boolean => {
          if (ri === subset.length) return tryClass(ci + 1);
          const r = subset[ri];
          const tk = isVirtualKey(r.teacherKey) ? null : r.teacherKey;
          const free = cols
            .map((_, idx) => idx)
            .filter((idx) => !cols[idx].lessons.has(ck) && (!tk || !cols[idx].teachers.has(tk)));
          const combo: number[] = [];
          const chooseFrom = (start: number): boolean => {
            if (combo.length === r.hours) {
              for (const idx of combo) {
                cols[idx].lessons.set(ck, r);
                if (tk) cols[idx].teachers.add(tk);
              }
              if (fill(ri + 1)) return true;
              for (const idx of combo) {
                cols[idx].lessons.delete(ck);
                if (tk) cols[idx].teachers.delete(tk);
              }
              return false;
            }
            for (let i = start; i < free.length; i++) {
              combo.push(free[i]);
              if (chooseFrom(i + 1)) return true;
              combo.pop();
            }
            return false;
          };
          return chooseFrom(0);
        };
        if (fill(0)) {
          for (const r of subset) chosen.add(r);
          return true;
        }
      }
      return false;
    };

    if (!tryClass(0)) {
      // 도출 실패 — 전 행을 일반 섹션으로 강등해 실패를 검사기(H7·H2)로 드러낸다
      issues.push({
        code: "simul-unsolved",
        text: `동시수업 "${g.label}" — 시수표에서 그룹 구성(주 ${h}교시, 열별 교사 중복 없음)을 도출하지 못했습니다. 전 행을 일반 배치로 강등합니다 (검사기 H7로 드러납니다). 시수표에 그룹 소속 표시가 필요한 사례입니다`,
      });
      for (const ck of classKeys) for (const r of byClass.get(ck)!) r.consumed = false;
      continue;
    }

    // 가정 보고 — 무엇을 그룹 몫으로 골랐고 무엇이 잔여인지.
    // 9c-I-2: 전 학급이 태그로 확정됐으면 추정이 없었으므로 이슈를 내지 않는다.
    // 일부만 태그면 추정한(무태그) 학급만 언급한다 (phase9c_i2_spec §4-1).
    const leftovers: Row[] = [];
    for (const ck of classKeys)
      for (const r of byClass.get(ck)!) if (!chosen.has(r)) leftovers.push(r);
    if (!allTagged) {
      const untaggedKeys = classKeys.filter((ck) => !fixedSubsetByClass.get(ck));
      const pickText = untaggedKeys
        .map((ck) => {
          const picked = byClass.get(ck)!.filter((r) => chosen.has(r));
          return `${ck}=${picked.map((r) => `${r.subjectName}(${r.hours})`).join("+")}`;
        })
        .join(", ");
      issues.push({
        code: "simul-assumed",
        text: `동시수업 "${g.label}" — 시수표에 그룹 소속 표시가 없어 교사 겹침 회피로 몫을 역산: 주 ${h}교시, ${pickText}${
          leftovers.length
            ? ` / 그룹 밖 일반: ${leftovers.map((r) => `${r.grade}-${r.classNum} ${r.subjectName}(${r.hours})`).join(", ")}`
            : ""
        }${
          leftovers.length && !g.slots?.length
            ? " ⚠️ 등록부에 슬롯 지정이 없어 일반 배치가 그룹 판정에 걸릴 수 있습니다(H7 위험)"
            : ""
        }`,
      });
    }

    // 열 구성 시그니처별로 섹션 병합 (그리드 역산 컴파일러와 동일 문법)
    const bySignature = new Map<string, { colIdxs: number[]; col: BandCol }>();
    cols.forEach((col, idx) => {
      const sig = classKeys.map((ck) => `${ck}:${rowId(col.lessons.get(ck)!)}`).join("|");
      if (!bySignature.has(sig)) bySignature.set(sig, { colIdxs: [], col });
      bySignature.get(sig)!.colIdxs.push(idx);
    });
    let sigIdx = 0;
    for (const { colIdxs, col } of [...bySignature.values()].sort((a, b) =>
      a.colIdxs[0] - b.colIdxs[0]
    )) {
      const lessonsByClass: Record<string, TimetableLesson[]> = {};
      const teacherKeys = new Set<string>();
      const members: Array<{ grade: number; classNum: number; subjectName: string }> = [];
      for (const ck of classKeys) {
        const r = col.lessons.get(ck)!;
        lessonsByClass[ck] = [lessonOf(r)];
        if (!isVirtualKey(r.teacherKey)) teacherKeys.add(r.teacherKey);
        members.push({ grade: r.grade, classNum: r.classNum, subjectName: r.subjectName });
      }
      const tk = [...teacherKeys].sort();
      const blockLens = parseBlockLens(g.consecutive, colIdxs.length);
      sections.push({
        id: `bsimul:${g.label}#${sigIdx++}`,
        kind: "simul",
        label: `동시수업 "${g.label}"`,
        grade: g.grade,
        classKeys,
        teacherKeys: tk,
        lessonsByClass,
        occurrences: blockLens.length,
        blockLens,
        room: roomFor(members, `동시수업 "${g.label}"`),
        allowedSlots,
        bannedSlots: bansFor(tk),
      });
    }
    // 그룹 밖 잔여 행은 소비 해제 — 아래 일반 경로가 집는다
    for (const r of leftovers) r.consumed = false;
  }

  // ── ② 고정 슬롯(fixedBlocks) 소비 — 자리표시(창체·SLAT)의 유일한 위치 출처 ──
  const fixedBlocks = (model.fixedBlocks || []).filter((b) => b.active);
  const fixedIndex = new Map<string, Array<{ day: number; period: number }>>();
  /** key → 대표 entry (시수표 행 없이 슬롯만 있을 때 합성 섹션의 표시 정보) */
  const fixedMeta = new Map<
    string,
    { grade: number; classNum: number; subjectName: string; teacherName?: string }
  >();
  const fixedConsumed = new Set<string>();
  for (const fb of fixedBlocks) {
    for (const e of fb.entries) {
      const key = `${e.grade}-${e.classNum}|${normSubject(e.subjectName)}`;
      if (!fixedIndex.has(key)) fixedIndex.set(key, []);
      fixedIndex.get(key)!.push({ day: fb.day, period: fb.period });
      if (!fixedMeta.has(key)) fixedMeta.set(key, e);
    }
  }
  for (const slots of fixedIndex.values())
    slots.sort((a, b) => a.day - b.day || a.period - b.period);

  for (const r of rows) {
    if (r.consumed) continue;
    const ck = `${r.grade}-${r.classNum}`;
    const fixedKey = `${ck}|${normSubject(r.subjectName)}`;
    const slots = fixedIndex.get(fixedKey);
    if (slots?.length) fixedConsumed.add(fixedKey);
    if (!slots?.length) {
      if (isVirtualKey(r.teacherKey)) {
        // 자리표시는 시수표에 위치 정보가 없다 — 등록부 없이는 배치 불능 (머리말 ①)
        r.consumed = true;
        issues.push({
          code: "fixed-missing",
          text: `${ck}반 ${r.subjectName} ${r.hours}시간 — 자리표시(담당 교사 없음) 수업인데 일괄 배정 등록부에 위치가 없습니다. 배치를 건너뜁니다 (검사기 H1로 드러납니다). 교육과정 코호트 고정 슬롯 등록부(질의 결과 §2-2)가 이 정보의 자리입니다`,
        });
      }
      continue;
    }
    r.consumed = true;
    const use = slots.slice(0, r.hours);
    if (use.length !== r.hours)
      issues.push({
        code: "fixed-mismatch",
        text: `${ck}반 ${r.subjectName} — 시수 ${r.hours}시간인데 일괄 배정 등록부 슬롯은 ${slots.length}개입니다. ${use.length}개만 고정 배치합니다`,
      });
    const tks = isVirtualKey(r.teacherKey) ? [] : [r.teacherKey];
    sections.push({
      id: `bfixed:${rowId(r)}`,
      kind: "fixed",
      label: `${ck}반 ${r.subjectName}`,
      grade: r.grade,
      classKeys: [ck],
      teacherKeys: tks,
      lessonsByClass: { [ck]: [lessonOf(r)] },
      occurrences: use.length,
      blockLens: use.map(() => 1),
      room: null,
      allowedSlots: null,
      bannedSlots: new Set(),
      fixedSlots: use,
    });
  }

  // ── ②-b 시수표 행 없는 고정 슬롯 → 합성 점유 섹션 ──
  //
  // 업로드 경로의 실물 시수표(2026-2 실측, 9c-H §0-1a-③ⓒ)에는 창체·SLAT 행이 아예 없다 —
  // 코호트 등록부의 슬롯이 시수표 행과 못 만나면 그냥 버려져 솔버가 그 칸에 수업을 넣는다.
  // 행이 없어도 슬롯 자체를 자리표시 섹션으로 세워 점유시킨다 (파생 경로는 가상 행이
  // 슬롯을 소비하므로 이 패스가 비어 기존 결과와 동일하다).
  for (const [key, slots] of [...fixedIndex.entries()].sort()) {
    if (fixedConsumed.has(key)) continue;
    const e = fixedMeta.get(key)!;
    const ck = `${e.grade}-${e.classNum}`;
    const label = `${ck}반 ${e.subjectName}`;
    issues.push({
      code: "fixed-standalone",
      text: `${label} — 고정 슬롯 ${slots.length}칸이 등록부에만 있고 시수표에는 해당 행이 없습니다. 자리표시로 점유시킵니다 (업로드 시수표에는 창체·SLAT 행이 없는 것이 정상입니다. 과목 표기가 어긋난 것이라면 등록부·시수표의 이름을 맞춰 주세요)`,
    });
    sections.push({
      id: `bfixedonly:${key}`,
      kind: "fixed",
      label,
      grade: e.grade,
      classKeys: [ck],
      teacherKeys: [],
      lessonsByClass: {
        [ck]: [
          {
            subjectName: e.subjectName,
            subjectShort:
              input.subjectShorts?.[normSubject(e.subjectName)] || e.subjectName,
            teachers: [{ email: "", name: e.teacherName || e.subjectName }],
          },
        ],
      },
      occurrences: slots.length,
      blockLens: slots.map(() => 1),
      room: null,
      allowedSlots: null,
      bannedSlots: new Set(),
      fixedSlots: slots,
    });
  }

  // ── ③ 잔여 일반 섹션 ──
  const consecutiveRules = (model.consecutiveRules || []).filter((c) => c.active);
  for (const r of rows) {
    if (r.consumed) continue;
    r.consumed = true;
    const ck = `${r.grade}-${r.classNum}`;
    const label = `${ck}반 ${r.subjectName}`;
    const rule = consecutiveRules.find(
      (c) =>
        c.grade === r.grade &&
        c.classNums.includes(r.classNum) &&
        normSubject(c.subjectName) === normSubject(r.subjectName) &&
        (!c.teacherEmail || norm(c.teacherEmail) === r.teacherKey)
    );
    const tks = isVirtualKey(r.teacherKey) ? [] : [r.teacherKey];
    const blockLens = parseBlockLens(rule?.pattern, r.hours);

    // 9c-I-2 §4-2: venueHours 힌트 — 있으면 보수 처리(전 시수 실 점유·이슈) 대신 정밀 배분
    const vh = r.venueHours ?? null;
    const v = vh != null ? venueProbe(r.grade, r.classNum, r.subjectName) : null;
    if (vh != null && vh > 0 && !v) {
      issues.push({
        code: "venue-hours-no-group",
        text: `${label} — 계획에 특별실 ${vh}시간이 적혀 있지만 이 학기 특별실 등록부에 해당 항목이 없습니다. 특별실 없이 배치합니다`,
      });
    }
    if (v && vh != null && vh > 0) {
      // 큰 블록부터 실 몫으로 배분 (실측 통례: 연속 수업 = 특별실). 경계 어긋나면 올림 + 고지.
      const venueLens: number[] = [];
      const freeLens: number[] = [];
      let acc = 0;
      for (const len of blockLens) {
        if (acc < vh) {
          venueLens.push(len);
          acc += len;
        } else freeLens.push(len);
      }
      if (acc !== vh)
        issues.push({
          code: "venue-hours-block-adjust",
          text: `${label} — 특별실 ${vh}시간이 연속수업 블록 경계와 어긋나 ${acc}시간을 실 배치로 배분합니다`,
        });
      sections.push({
        id: `bplain-v:${rowId(r)}`,
        kind: "plain",
        label,
        grade: r.grade,
        classKeys: [ck],
        teacherKeys: tks,
        lessonsByClass: { [ck]: [lessonOf(r)] },
        occurrences: venueLens.length,
        blockLens: venueLens,
        room: v.roomName,
        allowedSlots: v.slots.length ? new Set(v.slots.map((s) => `${s.day}-${s.period}`)) : null,
        bannedSlots: bansFor(tks),
      });
      if (freeLens.length)
        sections.push({
          id: `bplain-f:${rowId(r)}`,
          kind: "plain",
          label,
          grade: r.grade,
          classKeys: [ck],
          teacherKeys: tks,
          lessonsByClass: { [ck]: [lessonOf(r)] },
          occurrences: freeLens.length,
          blockLens: freeLens,
          room: null,
          allowedSlots: null,
          bannedSlots: bansFor(tks),
        });
      continue;
    }

    sections.push({
      id: `bplain:${rowId(r)}`,
      kind: "plain",
      label,
      grade: r.grade,
      classKeys: [ck],
      teacherKeys: tks,
      lessonsByClass: { [ck]: [lessonOf(r)] },
      occurrences: blockLens.length,
      // vh === 0 은 명시적 "특별실 안 씀" — 실 점유도 이슈도 내지 않는다
      blockLens,
      room: vh === 0 ? null : roomFor([r], label),
      allowedSlots: null,
      bannedSlots: bansFor(tks),
    });
  }

  // ── ④ 정합성 검사 (컴시간 §5-사: 학급 주간 슬롯 수요 = 운영 교시수) ──
  const demand = new Map<string, number>();
  for (const s of sections) {
    const occ = s.blockLens.reduce((a, b) => a + b, 0);
    for (const ck of s.classKeys) demand.set(ck, (demand.get(ck) || 0) + occ);
  }
  for (const [ck, d] of [...demand.entries()].sort()) {
    const grade = Number(ck.split("-")[0]);
    const cap = Object.values(gdp[grade] || {}).reduce((a, b) => a + b, 0);
    if (d !== cap)
      issues.push({
        code: "class-slot-mismatch",
        text: `${ck}반 — 주간 슬롯 수요 ${d} ≠ 운영 교시수 ${cap}. 시수 합이 틀렸거나 동시수업 구성 추정(위 simul-assumed)이 실제와 다릅니다`,
      });
  }

  return { sections: sections.sort((a, b) => cmpStr(a.id, b.id)), issues };
}

// ── 소프트 추정 점수 (validate.ts S1~S6 기반 — 국소 탐색 내부용) ──
//
// 내부 가중 교정 (2026-08-15): 공식 점수(validateTimetable)는 전 코드 1점 등가지만,
// 솔버가 그 등가로 최적화하면 S3·S5를 줄이는 대가로 S4(같은 반 같은 날 동일 과목 중복)를
// 지불한다 — 실측: 백지 편성 S4 16건·-17점 vs 현행(컴시간·사람 손) S4 1건. 사람은 같은 날
// 중복을 점심 전후 연속(현행 S3 28건 방치)보다 훨씬 심각하게 본다. 따라서 **내부 목적함수에서만**
// S4를 가중해 회피 우선순위를 사람 기준에 맞춘다. 화면·검사기의 공식 점수 정의는 불변.

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

/** S4 내부 가중 — 위 주석 참조. 공식 1점당 솔버 내부에서는 이만큼으로 취급한다.
 *  4 → 8 상향 (2026-08-15): 9c-I-2 힌트 직결로 탐색 공간이 좁아지자(동시수업 확정·특별실
 *  슬롯 제약) 가중 4로는 같은 교사 진짜 중복이 다시 새어 나왔다 (실측 1건→2~3건). */
const S4_INTERNAL_WEIGHT = 8;

function classDayPenalty(subjects: Map<string, number>): number {
  let pts = 0;
  for (const n of subjects.values()) if (n >= 2) pts += (n - 1) * S4_INTERNAL_WEIGHT; // S4 (내부 가중)
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
  /** 요일당 배치 한도 (2026-08-15 확장) — 패턴 섹션은 종전대로 1(H9 보호).
   *  단독 배치 일반(plain) 섹션도 원칙 1로 제한한다: 같은 반 같은 날 동일 과목 중복(S4)은
   *  가중만으로는 국소 탐색이 못 푸는 지형이 실측됐다(2-4 도탐, 가중 8·16 동일 결과).
   *  컴시간·사람 손의 통상 규칙(과목은 요일에 분산)을 배치 규칙으로 올린다.
   *  예외 — 고정 슬롯 섹션(창체 금5·6처럼 등록부가 같은 날을 지정)과 동시수업 섹션
   *  (등록부 슬롯이 같은 날 2개일 수 있음)은 무제한. 주당 시수 > 요일 수면 불가피분만 허용. */
  const dayLimit = sections.map((s, i) => {
    if (hasPattern[i]) return 1;
    if (s.kind !== "plain" || (s.fixedSlots && s.fixedSlots.length)) return Infinity;
    const days = Math.max(1, Object.keys(gdp[s.grade] || {}).length);
    return Math.max(1, Math.ceil(s.occurrences / days));
  });
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
    // 요일당 배치 한도 — 패턴 섹션 1회(연속 길이 붕괴 방지) + 일반 섹션 과목 분산 (위 dayLimit 주석)
    if ((sectionDayCount.get(sectionIdx)?.get(day) || 0) >= dayLimit[sectionIdx])
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

  /**
   * ejection 시도 저널 — 실패한 시도가 판을 바꿔 놓지 않게 하는 장치 (9c-G §3).
   *
   * 종전에는 실패 시 **자기가 뺀 걸림돌만** 되돌렸다. 그런데 재귀 호출이 성공하면
   * 안쪽에서 또 다른 걸림돌을 옮겼을 수 있고, 그것들은 바깥 롤백 대상이 아니었다.
   * 결과가 틀리지는 않았지만(점유 표는 항상 유효) **성과 없이 소프트 점수가 흔들리고
   * 시드 재현성이 약해졌다** — 포트폴리오로 여러 시드를 비교하는 설계에서 비교의
   * 전제가 깨진다.
   *
   * 해법: apply를 저널에 기록하고, 각 시도가 진입 시점의 길이(mark)를 잡아 실패 시
   * 그 지점까지 역순으로 되돌린다. 중첩은 mark가 스택처럼 동작해 자연히 처리된다.
   * 전체 판을 복사하지 않는다 — 되돌릴 것은 이번 시도가 실제로 건드린 몇 개뿐이다.
   */
  const ejectJournal: Array<{ occ: Occurrence; dir: 1 | -1 }> = [];
  function japply(occ: Occurrence, dir: 1 | -1) {
    apply(occ, dir);
    ejectJournal.push({ occ, dir });
  }
  function rollbackTo(mark: number) {
    for (let i = ejectJournal.length - 1; i >= mark; i--) {
      const j = ejectJournal[i];
      apply(j.occ, j.dir === 1 ? -1 : 1);
    }
    ejectJournal.length = mark;
  }

  // ── ⑥ ejection chain (깊이 2): 막힌 occurrence를 위해 걸림돌을 옮긴다 ──
  const unplacedFinal: Pending[] = [];
  progress("ejection", 0, stuck.length);
  for (const p of stuck) {
    if (tryPlaceWithEjection(p, 2)) placedByEjection++;
    else unplacedFinal.push(p);
  }

  function tryPlaceWithEjection(p: Pending, depth: number): boolean {
    const mark = ejectJournal.length;
    const direct = candidateSlots(p.sectionIdx, p.len);
    if (direct.length) {
      const c = direct[Math.floor(rng() * direct.length)];
      japply({ sectionIdx: p.sectionIdx, occIdx: p.occIdx, len: p.len, day: c.day, start: c.start }, 1);
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
        // 이 후보 슬롯 시도의 시작점 — 실패하면 여기까지 되돌린다
        const tryMark = ejectJournal.length;
        for (const occ of removedOccs) japply(occ, -1);
        if (!feasible(p.sectionIdx, day, start, p.len)) {
          rollbackTo(tryMark); // 다른 슬롯 겹침 등
          continue;
        }
        japply({ sectionIdx: p.sectionIdx, occIdx: p.occIdx, len: p.len, day, start }, 1);
        // 걸림돌 재배치 (재귀 — 깊이 감소). 안쪽 시도도 같은 저널을 쓰므로
        // 여기서 tryMark까지 되돌리면 **재귀가 옮긴 것까지 전부** 원위치한다.
        let allReplaced = true;
        for (const occ of removedOccs) {
          if (
            !tryPlaceWithEjection(
              { sectionIdx: occ.sectionIdx, occIdx: occ.occIdx, len: occ.len, tier: 0 },
              depth - 1
            )
          ) {
            allReplaced = false;
            break; // 하나라도 실패하면 이 후보 슬롯은 성립하지 않는다
          }
        }
        if (allReplaced) return true;
        rollbackTo(tryMark);
      }
    }
    // 방어선 — 정상 경로면 이미 mark 상태다. 훗날 편집으로 되돌리기가 새면 여기서 막힌다.
    rollbackTo(mark);
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

// ── 시드 포트폴리오 (Phase C-2) ───────────────────────────────
//
// 실측(2026-08-11): 시드별 소프트 38~47점 편차 — 고정 시드 목록을 전부 돌려 최적 해를 뽑는다.
// 시드별 결정론이 그대로 유지되므로 포트폴리오 전체도 결정론 (같은 입력·같은 목록 = 같은 출력).

export const DEFAULT_SEED_PORTFOLIO = [1, 2, 3, 5, 7, 11, 13, 42];

export interface PortfolioRanking {
  seed: number;
  soft: number; // 내부 추정치 (검사기 점수와 일치 실측 — 공식 판정은 validateTimetable)
  unplacedHours: number;
}

export interface PortfolioResult {
  best: SolverResult & { seed: number };
  /** 미배정 시간 → 소프트 → 시드 순 오름차순 */
  ranking: PortfolioRanking[];
}

/** 선발 기준: ① 미배정 시간 최소 ② 소프트 추정 최소 ③ 목록 앞 시드 (전 단계 결정론) */
export function solveTimetablePortfolio(
  input: Omit<SolverInput, "seed"> & { seeds?: number[] }
): PortfolioResult {
  const seeds = input.seeds?.length ? input.seeds : DEFAULT_SEED_PORTFOLIO;
  let best: (SolverResult & { seed: number }) | null = null;
  let bestUnplaced = Infinity;
  const ranking: PortfolioRanking[] = [];
  seeds.forEach((seed, i) => {
    const r = solveTimetable({
      ...input,
      seed,
      onProgress: input.onProgress
        ? (phase, done, total) =>
            input.onProgress!(`시드 ${seed} (${i + 1}/${seeds.length}) ${phase}`, done, total)
        : undefined,
    });
    const unplacedHours = r.unplaced.reduce((s, u) => s + u.remaining, 0);
    ranking.push({ seed, soft: r.stats.softScoreEstimate, unplacedHours });
    if (
      !best ||
      unplacedHours < bestUnplaced ||
      (unplacedHours === bestUnplaced &&
        r.stats.softScoreEstimate < best.stats.softScoreEstimate)
    ) {
      best = { ...r, seed };
      bestUnplaced = unplacedHours;
    }
  });
  ranking.sort((a, b) => a.unplacedHours - b.unplacedHours || a.soft - b.soft || a.seed - b.seed);
  return { best: best!, ranking };
}

// ── Web Worker 메시지 프로토콜 (solver.worker.ts ↔ solverClient.ts 공용) ──
//
// 타입만 여기 둔다 — 워커 파일을 클라이언트가 직접 import하면 self 핸들러가 SSR에서 터진다.

export interface SolverWorkerRequest {
  grids: ClassGrid[]; // 현행(참조) 그리드 — 워커 안에서 섹션 컴파일 (백지 모드 시 빈 배열)
  model: TimetableConstraintModel;
  seeds?: number[]; // 기본 DEFAULT_SEED_PORTFOLIO
  localSearchIterations?: number;
  teacherNames?: Record<string, string>;
  subjectShorts?: Record<string, string>;
}

export type SolverWorkerMessage =
  | { type: "progress"; phase: string; done: number; total: number }
  | {
      type: "done";
      seed: number;
      grids: ClassGrid[];
      unplaced: SolverResult["unplaced"];
      stats: SolverResult["stats"];
      ranking: PortfolioRanking[];
      /** 검사기 관문 리포트 — 워커 안에서 validateTimetable까지 마치고 동봉 (§0-1 철칙) */
      report: import("./types").TimetableAuditReport;
    }
  | { type: "error"; message: string };
