/**
 * Phase 9c-A: 기초시간표 검사기 — 순수 함수, Firestore 의존 없음
 *
 * 상위 스펙: docs/phase9c_spec.md §3 (컴시간 배정검색 §7의 재현)
 * 솔버·AI 제안·수동 편집 모두 이 관문을 통과해야 시간표에 반영된다 (§0-1 철칙).
 *
 * 하드 H1~H11 = 컴시간 "중대한 문제(이동 실행 비활성)" 대응 — 하나라도 있으면 완성본이 아니다.
 * 소프트 S1~S6 = 기존 감점 엔진(swap.ts teacherDayPenalties·classDuplicatePenalty)의 학기 전체 일반화 —
 *   가중치·문구 규약을 그대로 계승한다.
 *   S7(순배)은 미구현 — 만들 때 S6보다 낮은 가중치로 넣는다(2026-08-14 질의 4-2 확정,
 *   docs/phase9c_questionnaire_result_2026-08-14.md §3). 서열 S6 > S7은 고정.
 *
 * 판정 원칙:
 *  - 가상 교사(이메일 없음)는 자리표시이므로 교사 단위 검사(H2·H5·소프트)에서 제외한다.
 *  - 등록부 미비로 추정되는 위반은 registryGap으로 표시만 하고 버리지 않는다 —
 *    "어쩔 수 없는 것까지 다 보여주면 머리가 아프다"(§3-4)의 접힘 대상이자 9월 질문지 문항 후보.
 */

import { buildSimulMatcher } from "./simul";
import { buildVenueMatcher } from "./venue";
import {
  BaseRevisionOp,
  ClassGrid,
  ConsecutiveRule,
  FixedBlock,
  HardViolation,
  HardViolationCode,
  HoursRequirement,
  SimulGroup,
  SoftPenaltyCode,
  TermPenaltyDetail,
  TimetableAuditReport,
  TimetableConstraintModel,
  TimetableLesson,
  VenueGroup,
} from "./types";

const norm = (e: string) => (e || "").trim().toLowerCase();
/** 과목명 매칭 정규화 — NFC·공백 제거·소문자. NEIS 매핑(neis.ts)도 이 규약을 공유한다 (단일 소재지) */
export const normSubject = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();
const DAY_LABEL = ["", "월", "화", "수", "목", "금"];

/** 시수표·점유 키의 교사 식별자 — 이메일 우선, 가상 교사는 "name:이름" (HoursRequirement.teacherKey 규약) */
export function teacherKeyOf(t: { email?: string; name?: string }): string {
  const email = norm(t.email || "");
  if (email) return email;
  const name = (t.name || "").trim();
  return name ? `name:${name}` : "";
}

/** 수업의 담당 교사가 전원 가상(이메일 없음)인가 — 창체·SLAT 자리표시 수업 판별 */
export function isAllVirtual(lesson: TimetableLesson): boolean {
  const ts = lesson.teachers || [];
  return ts.length === 0 || ts.every((t) => !norm(t.email));
}

/**
 * 해당 셀에 자리표시(전원 가상 교사) 수업이 있으면 그 수업을 돌려준다 — 편집 경로 전용 판정.
 * 판정 기준은 위 isAllVirtual과 동일하므로 검사기·솔버·AI 층과 규약이 갈라지지 않는다.
 */
export function findPlaceholderLesson(
  grids: ClassGrid[],
  grade: number,
  classNum: number,
  day: number,
  period: number
): TimetableLesson | null {
  const grid = grids.find((g) => g.grade === grade && g.classNum === classNum);
  const cell = grid?.cells?.find((c) => c.day === day && c.period === period);
  for (const l of cell?.lessons || []) if (isAllVirtual(l)) return l;
  return null;
}

/**
 * 편집 연산(이동·맞교환·셀 덮어쓰기)이 자리표시 수업을 건드리는지 검사한다.
 *
 * 창체·SLAT는 담당 교사가 지정되지 않은 밴드로 학교 전체가 같은 교시에 묶여 움직이므로
 * 한 학급만 옮기면 학교 전체 편성이 어긋난다. 그런데 가상 교사는 H2(교사 중복) 대상이 아니고
 * 등록부(동시수업·일괄배정)에 올라 있지 않으면 H6·H7도 걸리지 않아 검사기가 잡아줄 수 없다 —
 * 그래서 "그리드 상태"가 아니라 "연산"을 막는 이 관문이 필요하다 (2026-08-12 실사용 발견).
 *
 * 과거 연산 재생(applyRevisionOps)에는 절대 걸지 않는다 — 이미 저장된 초안이 재생 불가가 되면 안 된다.
 * 연산이 새로 만들어지거나 접수되는 지점에서만 호출한다.
 *
 * @returns 막아야 하면 사람이 읽는 사유, 통과면 null
 */
export function checkPlaceholderOp(grids: ClassGrid[], op: BaseRevisionOp): string | null {
  const slots =
    op.type === "swap" ? [op.a, op.b] : [{ day: op.day, period: op.period }];
  for (const s of slots) {
    const hit = findPlaceholderLesson(grids, op.grade, op.classNum, s.day, s.period);
    if (!hit) continue;
    return `${op.grade}학년 ${op.classNum}반 ${DAY_LABEL[s.day]}요일 ${s.period}교시는 '${hit.subjectName}' 자리입니다. 담당 선생님이 지정되지 않은 수업(창체·SLAT 등)은 학교 전체가 같은 시간에 묶여 있어 한 학급만 옮기거나 맞바꿀 수 없습니다.`;
  }
  return null;
}

// ── 역산 헬퍼 (phase9c_spec §2-1ⓐ·§2-2 — Phase B의 최소형) ────

/** 그리드 → 학년별 요일별 운영 교시수 역산 — "week.days가 비면 기초시간표가 진실" 원칙(수집 20)의 학년별 확장 */
export function deriveGradeDayPeriods(
  grids: ClassGrid[]
): Record<number, Record<number, number>> {
  const out: Record<number, Record<number, number>> = {};
  for (const grid of grids) {
    if (!out[grid.grade]) out[grid.grade] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const byDay = out[grid.grade];
    for (const cell of grid.cells || []) {
      if (!(cell.lessons || []).length) continue;
      byDay[cell.day] = Math.max(byDay[cell.day] || 0, cell.period);
    }
  }
  return out;
}

/** 그리드 → 시수표 역산 (teacher × subject × class → 주당 시수) — 검증 단계의 기본 획득 경로 */
export function deriveHoursFromGrids(grids: ClassGrid[]): HoursRequirement[] {
  const counts = new Map<string, HoursRequirement>();
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const teachers = (lesson.teachers || []).length
          ? lesson.teachers
          : [{ email: "", name: "" }];
        for (const t of teachers) {
          const tk = teacherKeyOf(t);
          const key = `${grid.grade}-${grid.classNum}|${normSubject(lesson.subjectName)}|${tk}`;
          const row = counts.get(key);
          if (row) row.hours += 1;
          else
            counts.set(key, {
              grade: grid.grade,
              classNum: grid.classNum,
              subjectName: lesson.subjectName,
              teacherKey: tk,
              hours: 1,
            });
        }
      }
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.grade - b.grade ||
      a.classNum - b.classNum ||
      a.subjectName.localeCompare(b.subjectName, "ko")
  );
}

// ── 내부 공용 구조 ────────────────────────────────────────────

interface Placement {
  grade: number;
  classNum: number;
  day: number;
  period: number;
  lesson: TimetableLesson;
}

function flatten(grids: ClassGrid[]): Placement[] {
  const out: Placement[] = [];
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        out.push({
          grade: grid.grade,
          classNum: grid.classNum,
          day: cell.day,
          period: cell.period,
          lesson,
        });
      }
    }
  }
  return out;
}

/** "2,2" → [2,2]. 1 이하·비숫자 항목은 무시 (연속 블록만 의미) */
function parsePattern(pattern: string): number[] {
  return (pattern || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 2)
    .sort((a, b) => a - b);
}

/** 요일별 슬롯 집합에서 연속 블록 길이 목록(길이 2 이상만) 계산 */
function consecutiveRuns(slots: Set<string>): number[] {
  const byDay = new Map<number, number[]>();
  for (const key of slots) {
    const [d, p] = key.split("-").map(Number);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(p);
  }
  const runs: number[] = [];
  for (const periods of byDay.values()) {
    periods.sort((a, b) => a - b);
    let run = 1;
    for (let i = 1; i <= periods.length; i++) {
      if (i < periods.length && periods[i] === periods[i - 1] + 1) run++;
      else {
        if (run >= 2) runs.push(run);
        run = 1;
      }
    }
  }
  return runs.sort((a, b) => a - b);
}

const slotText = (day: number, period: number) => `${DAY_LABEL[day]}${period}`;
const classText = (grade: number, classNum: number) => `${grade}-${classNum}반`;

// ── 하드 위반 동일성 판정 (편집 관문·해결안 탐색기 공용) ────────

/**
 * 하드 위반 1건의 동일성 키 — "이 연산이 새 위반을 만들었는가"를 가리는 단일 소재지.
 *
 * 서버 관문(applyDraftOp)·클라이언트 관문(analyzeOpImpact)·해결안 탐색기(fixFinder)가
 * 같은 문자열 규약을 써야 세 곳의 판정이 갈라지지 않는다. 원래 서버·클라에 같은 식이
 * 복붙돼 있던 것을 여기로 모았다 (2026-08-12).
 *
 * 알려진 한계: 구성 필드가 6개뿐이라 `subjectName`이 빠지고, day/period가 없는 코드
 * (H1·H4·H9)는 전부 `:0:0`으로 접힌다 — 같은 학급의 서로 다른 과목 위반이 한 키로
 * 충돌할 수 있고, 같은 키 위반이 1건→3건으로 늘어도 "신규 0건"으로 보인다.
 * 그래서 기계가 후보를 대량 생성하는 탐색기는 아래 diffNewHardViolations(건수 대조)를 쓴다.
 */
export function hardViolationKey(v: HardViolation): string {
  return `${v.code}:${v.grade ?? 0}:${v.classNum ?? 0}:${v.day ?? 0}:${v.period ?? 0}:${v.teacherEmail || ""}`;
}

/**
 * 연산 적용 전후를 비교해 "새로 생겼거나 늘어난" 하드 위반을 뽑는다.
 *
 * 키 집합 차집합만 쓰면 동일 키 위반의 건수 증가(1건→3건)를 놓치므로 **다중집합(건수)**으로
 * 센다. 후보를 수백 건 만들어 극단값을 고르는 탐색기에서는 이 구멍이 그대로 "하드를 만드는
 * 안이 통과되는" 결과가 되기 때문에 더 엄격한 쪽을 쓴다.
 */
export function diffNewHardViolations(
  before: HardViolation[],
  after: HardViolation[]
): HardViolation[] {
  const budget = new Map<string, number>();
  for (const v of before) {
    const k = hardViolationKey(v);
    budget.set(k, (budget.get(k) || 0) + 1);
  }
  const out: HardViolation[] = [];
  for (const v of after) {
    const k = hardViolationKey(v);
    const left = budget.get(k) || 0;
    if (left > 0) budget.set(k, left - 1);
    else out.push(v);
  }
  return out;
}

// ── 검사기 본체 ───────────────────────────────────────────────

export function validateTimetable(
  grids: ClassGrid[],
  model: TimetableConstraintModel
): TimetableAuditReport {
  const hard: HardViolation[] = [];
  const placements = flatten(grids);
  const gdp = model.gradeDayPeriods || deriveGradeDayPeriods(grids);
  const simulGroups = (model.simulGroups || []).filter((g) => g.active);
  const venueGroups = (model.venueGroups || []).filter((g) => g.active);
  const simulMatch = buildSimulMatcher(simulGroups);
  const venueMatch = buildVenueMatcher(venueGroups);

  /** lesson의 동시수업 라벨 — 로더 스탬프(simul) 우선, 없으면 등록부 직접 판정 (비스탬프 그리드 입력 대비) */
  const simulLabelOf = (p: Placement): string | null =>
    p.lesson.simul || simulMatch(p.grade, p.classNum, p.day, p.period, p.lesson.subjectName);
  /** lesson의 특별실명 — 등록부 판정 우선, 없으면 가져오기 원본 room */
  const roomOf = (p: Placement): string | null =>
    venueMatch(p.grade, p.classNum, p.day, p.period, p.lesson.subjectName) || p.lesson.room || null;

  // ── H11: 미편성 교시(요일별 교시수 밖) 배정 ──
  for (const p of placements) {
    const allowed = gdp[p.grade]?.[p.day] || 0;
    if (p.period >= 1 && p.period <= allowed) continue;
    hard.push({
      code: "H11",
      text: `${classText(p.grade, p.classNum)} ${slotText(p.day, p.period)}교시 ${p.lesson.subjectName} — ${p.grade}학년 ${DAY_LABEL[p.day]}요일은 ${allowed}교시까지 운영`,
      grade: p.grade,
      classNum: p.classNum,
      day: p.day,
      period: p.period,
      subjectName: p.lesson.subjectName,
    });
  }

  // ── H3: 학급 슬롯 중복 ──
  for (const grid of grids) {
    const seen = new Map<string, number>(); // "day-period" → cell 등장 횟수
    for (const cell of grid.cells || []) {
      const key = `${cell.day}-${cell.period}`;
      seen.set(key, (seen.get(key) || 0) + 1);
      if (seen.get(key) === 2) {
        hard.push({
          code: "H3",
          text: `${classText(grid.grade, grid.classNum)} ${slotText(cell.day, cell.period)}교시가 이중으로 기록되어 있습니다`,
          grade: grid.grade,
          classNum: grid.classNum,
          day: cell.day,
          period: cell.period,
        });
      }
      // 한 셀 여러 수업: 전원이 동시수업(분반) 판정이면 정상, 아니면 이중 배정
      if ((cell.lessons || []).length >= 2) {
        const allSimul = cell.lessons.every(
          (l) =>
            l.simul ||
            simulMatch(grid.grade, grid.classNum, cell.day, cell.period, l.subjectName)
        );
        if (!allSimul) {
          hard.push({
            code: "H3",
            text: `${classText(grid.grade, grid.classNum)} ${slotText(cell.day, cell.period)}교시에 수업 ${cell.lessons.length}개가 겹칩니다 (${cell.lessons.map((l) => l.subjectName).join("·")})`,
            grade: grid.grade,
            classNum: grid.classNum,
            day: cell.day,
            period: cell.period,
            registryGap: true,
            hint: "분반 이동수업이라면 동시수업 등록부에 등재하면 해소됩니다",
          });
        }
      }
    }
  }

  // ── H2: 교사 동시 2곳 배정 ──
  {
    const bySlotTeacher = new Map<string, Placement[]>(); // "day-period|email" → 배정 목록
    for (const p of placements) {
      for (const t of p.lesson.teachers || []) {
        const email = norm(t.email);
        if (!email) continue; // 가상 교사는 자리표시 — 동시 배정 개념 없음
        const key = `${p.day}-${p.period}|${email}`;
        if (!bySlotTeacher.has(key)) bySlotTeacher.set(key, []);
        bySlotTeacher.get(key)!.push(p);
      }
    }
    const fixedBlocks = (model.fixedBlocks || []).filter((b) => b.active);
    for (const [key, list] of bySlotTeacher.entries()) {
      const classes = new Set(list.map((p) => `${p.grade}-${p.classNum}`));
      if (classes.size < 2) continue;
      const [slot, email] = key.split("|");
      const [day, period] = slot.split("-").map(Number);
      // 면제 ①: 전원이 같은 동시수업 그룹(분반 라벨 동일) — 교사 1인이 여러 반 소속 학생을 한 분반으로 수업
      const labels = new Set(list.map((p) => simulLabelOf(p) || ""));
      if (labels.size === 1 && [...labels][0]) continue;
      // 면제 ②: 일괄 배정 등록부가 그 슬롯의 해당 학급 전부를 고정 — 합반(창체·SLAT) 정상 케이스
      const fb = fixedBlocks.find(
        (b) =>
          b.day === day &&
          b.period === period &&
          list.every((p) =>
            b.entries.some(
              (e) =>
                e.grade === p.grade &&
                e.classNum === p.classNum &&
                normSubject(e.subjectName) === normSubject(p.lesson.subjectName)
            )
          )
      );
      if (fb) continue;
      const name = list[0].lesson.teachers?.find((t) => norm(t.email) === email)?.name || email;
      const subjects = new Set(list.map((p) => normSubject(p.lesson.subjectName)));
      const uniform = subjects.size === 1;
      hard.push({
        code: "H2",
        text: `${name} 선생님이 ${slotText(day, period)}교시에 ${[...classes].sort().map((c) => `${c}반`).join("·")} ${classes.size}곳에 동시에 배정되어 있습니다 (${list[0].lesson.subjectName})`,
        day,
        period,
        teacherEmail: email,
        teacherName: name,
        subjectName: list[0].lesson.subjectName,
        ...(uniform
          ? {
              registryGap: true,
              hint: "전 학급 동일 과목 — 합반(일괄 배정) 수업이라면 일괄 배정 등록부에 등재하면 해소됩니다",
            }
          : {}),
      });
    }
  }

  // ── H8: 특별실 초과 점유 (용량 1) ──
  {
    const bySlotRoom = new Map<string, Map<string, string>>(); // "day-period|room" → 사용자ID → 표시문구
    for (const p of placements) {
      const room = roomOf(p);
      if (!room) continue;
      const key = `${p.day}-${p.period}|${room}`;
      // 같은 분반 그룹이 한 특별실을 함께 쓰는 것은 1개 수업 — simul 라벨로 사용자 병합
      const label = simulLabelOf(p);
      const userId = label ? `simul:${label}` : `${p.grade}-${p.classNum}`;
      if (!bySlotRoom.has(key)) bySlotRoom.set(key, new Map());
      bySlotRoom
        .get(key)!
        .set(userId, `${classText(p.grade, p.classNum)} ${p.lesson.subjectName}`);
    }
    for (const [key, users] of bySlotRoom.entries()) {
      if (users.size < 2) continue;
      const [slot, room] = key.split("|");
      const [day, period] = slot.split("-").map(Number);
      hard.push({
        code: "H8",
        text: `${room}이(가) ${slotText(day, period)}교시에 ${users.size}개 수업에 겹쳐 배정되어 있습니다 (${[...users.values()].join(" / ")})`,
        day,
        period,
      });
    }
  }

  // ── H1·H4: 시수표 대조 (시수표 없으면 생략) ──
  if (model.hours?.length) {
    const required = new Map<string, HoursRequirement>();
    for (const h of model.hours) {
      required.set(`${h.grade}-${h.classNum}|${normSubject(h.subjectName)}|${h.teacherKey}`, h);
    }
    const actual = new Map<string, { row: HoursRequirement; count: number }>();
    for (const p of placements) {
      const teachers = (p.lesson.teachers || []).length
        ? p.lesson.teachers
        : [{ email: "", name: "" }];
      for (const t of teachers) {
        const tk = teacherKeyOf(t);
        const key = `${p.grade}-${p.classNum}|${normSubject(p.lesson.subjectName)}|${tk}`;
        const cur = actual.get(key);
        if (cur) cur.count += 1;
        else
          actual.set(key, {
            row: {
              grade: p.grade,
              classNum: p.classNum,
              subjectName: p.lesson.subjectName,
              teacherKey: tk,
              hours: 0,
            },
            count: 1,
          });
      }
    }
    const teacherText = (tk: string) => (tk.startsWith("name:") ? tk.slice(5) : tk);
    for (const [key, h] of required.entries()) {
      const got = actual.get(key)?.count || 0;
      if (got < h.hours) {
        hard.push({
          code: "H1",
          text: `${classText(h.grade, h.classNum)} ${h.subjectName}(${teacherText(h.teacherKey)}) — 시수표 ${h.hours}시간 중 ${got}시간만 배정 (${h.hours - got}시간 미배정)`,
          grade: h.grade,
          classNum: h.classNum,
          subjectName: h.subjectName,
          teacherEmail: h.teacherKey.startsWith("name:") ? undefined : h.teacherKey,
        });
      } else if (got > h.hours) {
        hard.push({
          code: "H4",
          text: `${classText(h.grade, h.classNum)} ${h.subjectName}(${teacherText(h.teacherKey)}) — 시수표 ${h.hours}시간을 넘겨 ${got}시간 배정`,
          grade: h.grade,
          classNum: h.classNum,
          subjectName: h.subjectName,
          teacherEmail: h.teacherKey.startsWith("name:") ? undefined : h.teacherKey,
        });
      }
    }
    for (const [key, a] of actual.entries()) {
      if (required.has(key)) continue;
      hard.push({
        code: "H4",
        text: `${classText(a.row.grade, a.row.classNum)} ${a.row.subjectName}(${teacherText(a.row.teacherKey)}) — 시수표에 없는 배정 ${a.count}시간`,
        grade: a.row.grade,
        classNum: a.row.classNum,
        subjectName: a.row.subjectName,
      });
    }
  }

  // ── H5: 배정금지 교시 위반 (이동금지는 솔버 단계 제약 — 완성본 정적 검사 대상 아님) ──
  for (const ban of (model.teacherSlotBans || []).filter(
    (b) => b.active && b.kind === "assign"
  )) {
    const email = norm(ban.teacherEmail);
    const banned = new Set(ban.slots.map((s) => `${s.day}-${s.period}`));
    for (const p of placements) {
      if (!banned.has(`${p.day}-${p.period}`)) continue;
      if (!(p.lesson.teachers || []).some((t) => norm(t.email) === email)) continue;
      hard.push({
        code: "H5",
        text: `${ban.teacherName || ban.teacherEmail} 선생님의 배정금지 교시(${slotText(p.day, p.period)})에 ${classText(p.grade, p.classNum)} ${p.lesson.subjectName} 수업이 배정되어 있습니다`,
        grade: p.grade,
        classNum: p.classNum,
        day: p.day,
        period: p.period,
        teacherEmail: email,
        teacherName: ban.teacherName,
        subjectName: p.lesson.subjectName,
      });
    }
  }

  // ── H6: 일괄 배정 고정 위반 ──
  for (const fb of (model.fixedBlocks || []).filter((b) => b.active)) {
    for (const e of fb.entries) {
      const grid = grids.find((g) => g.grade === e.grade && g.classNum === e.classNum);
      const cell = grid?.cells?.find((c) => c.day === fb.day && c.period === fb.period);
      const found = (cell?.lessons || []).find(
        (l) =>
          normSubject(l.subjectName) === normSubject(e.subjectName) &&
          (!e.teacherName || (l.teachers || []).some((t) => t.name === e.teacherName))
      );
      if (found) continue;
      hard.push({
        code: "H6",
        text: `일괄 배정 "${fb.label}" — ${classText(e.grade, e.classNum)} ${slotText(fb.day, fb.period)}교시에 ${e.subjectName}${e.teacherName ? `(${e.teacherName})` : ""}이 없습니다`,
        grade: e.grade,
        classNum: e.classNum,
        day: fb.day,
        period: fb.period,
        subjectName: e.subjectName,
      });
    }
  }

  // ── H7: 동시수업 그룹 동시성 (그룹 전원이 같은 슬롯 집합) ──
  for (const g of simulGroups) {
    const oneGroupMatch = buildSimulMatcher([g]);
    const slotsByClass = new Map<number, Set<string>>();
    for (const cn of g.classNums) slotsByClass.set(cn, new Set());
    for (const p of placements) {
      if (p.grade !== g.grade || !slotsByClass.has(p.classNum)) continue;
      if (!oneGroupMatch(p.grade, p.classNum, p.day, p.period, p.lesson.subjectName)) continue;
      slotsByClass.get(p.classNum)!.add(`${p.day}-${p.period}`);
    }
    const union = new Set<string>();
    for (const s of slotsByClass.values()) for (const k of s) union.add(k);
    for (const key of union) {
      const missing = g.classNums.filter((cn) => !slotsByClass.get(cn)!.has(key));
      if (!missing.length) continue;
      const [day, period] = key.split("-").map(Number);
      hard.push({
        code: "H7",
        text: `동시수업 "${g.label}" — ${slotText(day, period)}교시에 ${missing.map((cn) => `${g.grade}-${cn}반`).join("·")}이 함께 배정되어 있지 않습니다`,
        grade: g.grade,
        day,
        period,
      });
    }
  }

  // ── H9: 연속수업 패턴 위반 (소유 규칙: 등록부 + 동시/특별실 그룹의 consecutive 필드) ──
  {
    interface EffectiveConsecutive {
      label: string;
      pattern: string;
      grade: number;
      classNums: number[];
      slotsOf: (classNum: number) => Set<string>;
    }
    const effective: EffectiveConsecutive[] = [];
    for (const r of (model.consecutiveRules || []).filter((r) => r.active)) {
      const subj = normSubject(r.subjectName);
      const email = norm(r.teacherEmail || "");
      effective.push({
        label: `${r.grade}학년 ${r.subjectName}`,
        pattern: r.pattern,
        grade: r.grade,
        classNums: r.classNums,
        slotsOf: (cn) => {
          const set = new Set<string>();
          for (const p of placements) {
            if (p.grade !== r.grade || p.classNum !== cn) continue;
            if (normSubject(p.lesson.subjectName) !== subj) continue;
            if (email && !(p.lesson.teachers || []).some((t) => norm(t.email) === email))
              continue;
            set.add(`${p.day}-${p.period}`);
          }
          return set;
        },
      });
    }
    const groupRule = (g: SimulGroup | VenueGroup, kind: "동시수업" | "특별실") => {
      if (!g.consecutive) return;
      const oneMatch =
        kind === "동시수업"
          ? buildSimulMatcher([g as SimulGroup])
          : buildVenueMatcher([g as VenueGroup]);
      effective.push({
        label: `${kind} "${g.label}"`,
        pattern: g.consecutive,
        grade: g.grade,
        classNums: g.classNums,
        slotsOf: (cn) => {
          const set = new Set<string>();
          for (const p of placements) {
            if (p.grade !== g.grade || p.classNum !== cn) continue;
            if (!oneMatch(p.grade, p.classNum, p.day, p.period, p.lesson.subjectName)) continue;
            set.add(`${p.day}-${p.period}`);
          }
          return set;
        },
      });
    };
    for (const g of simulGroups) groupRule(g, "동시수업");
    for (const g of venueGroups) groupRule(g, "특별실");

    for (const rule of effective) {
      const want = parsePattern(rule.pattern);
      if (!want.length) continue;
      for (const cn of rule.classNums) {
        const runs = consecutiveRuns(rule.slotsOf(cn));
        if (runs.length === want.length && runs.every((v, i) => v === want[i])) continue;
        hard.push({
          code: "H9",
          text: `연속수업 ${rule.label} ${rule.grade}-${cn}반 — 연속 ${rule.pattern} 필요, 실제 연속 블록은 ${runs.length ? runs.join(",") : "없음"}`,
          grade: rule.grade,
          classNum: cn,
        });
      }
    }
  }

  // ── H10: 복수교사 동시성 (동일 수업에 지정 교사 전원 동시 투입) ──
  for (const r of (model.coTeaching || []).filter((r) => r.active)) {
    const subj = normSubject(r.subjectName);
    const emails = r.teacherEmails.map(norm).filter(Boolean);
    for (const p of placements) {
      if (p.grade !== r.grade || !r.classNums.includes(p.classNum)) continue;
      if (normSubject(p.lesson.subjectName) !== subj) continue;
      const present = new Set((p.lesson.teachers || []).map((t) => norm(t.email)));
      const missing = emails.filter((e) => !present.has(e));
      if (!missing.length) continue;
      hard.push({
        code: "H10",
        text: `복수교사 ${classText(p.grade, p.classNum)} ${p.lesson.subjectName} ${slotText(p.day, p.period)}교시 — 지정 교사 ${emails.length}인 중 ${missing.length}인이 빠져 있습니다`,
        grade: p.grade,
        classNum: p.classNum,
        day: p.day,
        period: p.period,
        subjectName: p.lesson.subjectName,
      });
    }
  }

  // ── 소프트 S1~S6 (기존 감점 엔진 가중치 계승 — swap.ts teacherDayPenalties·classDuplicatePenalty) ──
  const details: TermPenaltyDetail[] = [];
  {
    // 교사별 요일별 점유 (실교사만 — 가상 교사는 사람이 아니다)
    interface TeacherDays {
      label: string;
      days: Map<number, { periods: Set<number>; subjects: string[] }>;
    }
    const byTeacher = new Map<string, TeacherDays>();
    for (const p of placements) {
      for (const t of p.lesson.teachers || []) {
        const email = norm(t.email);
        if (!email) continue;
        if (!byTeacher.has(email))
          byTeacher.set(email, { label: `${t.name} 선생님`, days: new Map() });
        const td = byTeacher.get(email)!;
        if (!td.days.has(p.day)) td.days.set(p.day, { periods: new Set(), subjects: [] });
        const d = td.days.get(p.day)!;
        d.periods.add(p.period);
        d.subjects.push(normSubject(p.lesson.subjectName));
      }
    }
    const L = model.lunchAfterPeriod;
    for (const [email, td] of byTeacher.entries()) {
      for (const [day, d] of td.days.entries()) {
        const push = (code: SoftPenaltyCode, text: string, points: number) =>
          details.push({ code, scope: "teacher", key: email, label: td.label, day, text, points });
        // S1 '최적': 요일 시수 쏠림 — 5시간=1점, 초과 1시간당 +1 (swap.ts 가중 계승)
        if (d.periods.size >= 5)
          push("S1", `${td.label} ${DAY_LABEL[day]}요일 시수 쏠림 (${d.periods.size}시간)`, d.periods.size - 4);
        // S2 '연속3': 연속 블록마다 3교시=1점, 초과 1교시당 +1
        for (const run of consecutiveRuns(
          new Set([...d.periods].map((p) => `${day}-${p}`))
        )) {
          if (run >= 3)
            push("S2", `${td.label} ${DAY_LABEL[day]}요일 연속 ${run}교시 발생`, run - 2);
        }
        // S3 '점심': 점심 직전·직후 연속 — 1점 고정
        if (d.periods.has(L) && d.periods.has(L + 1))
          push("S3", `${td.label} ${DAY_LABEL[day]}요일 점심 전후 연속 수업 발생`, 1);
        // S5 '학년': 같은 요일 3과목 이상 — 3과목=1점, 초과 과목당 +1
        const subjectCount = new Set(d.subjects).size;
        if (subjectCount >= 3)
          push("S5", `${td.label} ${DAY_LABEL[day]}요일 ${subjectCount}과목 수업`, subjectCount - 2);
        // S6 '오후': 오전 0시간·오후 3시간 이상 쏠림 — 1점
        //
        // ✅ 가중치 확정 (2026-08-14, 질의 4-1 회수 — phase9c_spec §11 미결정 2번 종결)
        //   일과계 답: "웬만하면 피하지만 어쩔 수 없으면 둔다" → 중간. 하드가 아니다.
        //   현행 1점(다른 소프트와 동급)을 유지한다. 답이 "중요하게 지킨다"였다면 올려야
        //   했지만 양보 가능이라 올릴 근거가 없다.
        //
        // ⚠️ S7(같은 과목의 반별 교시 순배)은 아직 구현되지 않았다(이 파일 머리말 참조).
        //   만들 때 반드시 S6보다 **낮은** 가중치로 넣는다 — 질의 4-2 답이
        //   "가능하면 좋지만 필수는 아니다"로 S6보다 한 단계 더 약했다.
        //   서열(S6 > S7)은 고정, 절대 수치는 11월 리허설에서 조정.
        //   근거: docs/phase9c_questionnaire_result_2026-08-14.md §3
        const afternoon = [...d.periods].filter((p) => p > L).length;
        if (afternoon >= 3 && afternoon === d.periods.size)
          push("S6", `${td.label} ${DAY_LABEL[day]}요일 오후 쏠림 (오전 수업 없음, 오후 ${afternoon}시간)`, 1);
      }
    }
    // S4 '중복': 같은 학급 같은 요일 동일 과목 n회 → (n−1)점. 창체·SLAT 자리표시(전원 가상) 수업은 제외.
    const byClassDaySubject = new Map<string, { count: number; sample: Placement }>();
    for (const p of placements) {
      if (isAllVirtual(p.lesson)) continue;
      const key = `${p.grade}-${p.classNum}|${p.day}|${normSubject(p.lesson.subjectName)}`;
      const cur = byClassDaySubject.get(key);
      if (cur) cur.count += 1;
      else byClassDaySubject.set(key, { count: 1, sample: p });
    }
    for (const { count, sample } of byClassDaySubject.values()) {
      if (count < 2) continue;
      details.push({
        code: "S4",
        scope: "class",
        key: `${sample.grade}-${sample.classNum}`,
        label: classText(sample.grade, sample.classNum),
        day: sample.day,
        text: `${classText(sample.grade, sample.classNum)} ${DAY_LABEL[sample.day]}요일 ${sample.lesson.subjectName} ${count}회`,
        points: count - 1,
      });
    }
  }

  // ── 집계 ──
  hard.sort(
    (a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }) ||
      (a.grade || 0) - (b.grade || 0) ||
      (a.classNum || 0) - (b.classNum || 0) ||
      (a.day || 0) - (b.day || 0) ||
      (a.period || 0) - (b.period || 0)
  );
  details.sort((a, b) => b.points - a.points || a.key.localeCompare(b.key));
  const hardByCode: Partial<Record<HardViolationCode, number>> = {};
  for (const v of hard) hardByCode[v.code] = (hardByCode[v.code] || 0) + 1;
  const byCode: Partial<Record<SoftPenaltyCode, number>> = {};
  for (const d of details) byCode[d.code] = (byCode[d.code] || 0) + d.points;
  const teacherEmails = new Set<string>();
  for (const p of placements)
    for (const t of p.lesson.teachers || []) if (norm(t.email)) teacherEmails.add(norm(t.email));

  return {
    hard,
    soft: {
      total: details.reduce((s, d) => s + d.points, 0),
      byCode,
      details,
    },
    summary: {
      classes: grids.length,
      lessons: placements.length,
      teachers: teacherEmails.size,
      hardByCode,
      actionableHard: hard.filter((v) => !v.registryGap).length,
    },
  };
}
