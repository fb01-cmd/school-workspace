/**
 * 직접 조정 M1 — 후보 일괄 채점 (timetable_manual_move_spec §2-3 · §3)
 *
 * 화면이 「집은 수업」에 대해 학급 그리드 전 칸의 3색(초록/노랑/회색)과 감점 변화 뱃지를
 * 그릴 수 있게, 후보 슬롯마다 [가능 여부, 공식 감점 변화, 사유]를 한 번에 계산한다.
 *
 * **정확성 원칙 — 자체 증분 추정을 하지 않는다.** 후보마다 그리드 사본에 실제 op(swap)를
 * 재생기(applyRevisionOps)로 적용하고 **본검사기(validateTimetable)로 채점**한다. 서버 관문
 * (applyDraftOp)과 판정 원천이 완전히 같아, 화면의 색·뱃지와 서버 수용이 어긋날 수 없다
 * (단일 소재지 — Codex 사전 검토 R1의 처방: 솔버 내부 클로저를 흉내 내지 않는다).
 * 성능: 후보 = 학급 1개 × 최대 35칸이고 칸당 사본+검사 1회 — selftest가 시간을 찍으며,
 * UI는 이 함수를 워커/비동기에서 부른다(수백 ms 허용 — 스펙 §5).
 *
 * 집기 단위 규약(스펙 §2-3): 동시수업(밴드)·자리표시 셀은 집기/목적지 양쪽 불가.
 * 연속수업 등록부에 걸리는 수업(블록)은 M1에서는 집기 불가 — 통째 이동은 연쇄 op(M2)와 함께.
 */
import {
  ClassGrid,
  TimetableConstraintModel,
  TimetableLesson,
  BaseRevisionOp,
  SoftPenaltyCode,
  TrayEntry,
} from "./types";
import { validateTimetable, hardViolationKey, findPlaceholderLesson, isParkExemptHard } from "./validate";
import { applyRevisionOps, cloneClassGrids } from "./utils";
import { buildSimulMatcher } from "./simul";

export interface MoveCandidate {
  day: number;
  period: number;
  /** move = 빈 칸으로 이동, swap = 그 칸 수업과 맞바꿈,
   *  displace = 맞바꿈은 불성립이지만 내 수업을 넣고 그 칸 수업을 들어올릴 수 있음(연쇄 시작 — M2) */
  kind: "move" | "swap" | "displace";
  /** ok = 초록(감점 비증가) · worse = 노랑(감점 증가, 감수 강행 가능) · blocked = 회색 */
  verdict: "ok" | "worse" | "blocked";
  /** 공식 총점 변화 (blocked면 0) — 음수가 개선 */
  softDelta: number;
  /** 회색 사유 한 줄 (hover 표시용) */
  blockedReason?: string;
  /** 증가한 감점 코드별 변화량 — 노랑 말풍선용 (예: { S2: 1, S1: 1 }) */
  worseByCode?: Partial<Record<SoftPenaltyCode, number>>;
}

export interface MoveCandidatesResult {
  /** 집기 자체가 불가하면 사유 (후보는 빈 배열) */
  pickBlocked?: string;
  candidates: MoveCandidate[];
  /** 집은 시점의 공식 총점 (상단 바 표시용) */
  baseSoftTotal: number;
}

const normSubject = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();

/** 집은 수업이 연속수업 등록부(블록)에 걸리는가 — M1 집기 불가 판정 */
function matchesConsecutiveRule(
  model: TimetableConstraintModel,
  grade: number,
  classNum: number,
  lesson: TimetableLesson
): boolean {
  const subj = normSubject(lesson.subjectName);
  for (const r of model.consecutiveRules || []) {
    if (!r.active) continue;
    if (r.grade !== grade) continue;
    if (r.classNums?.length && !r.classNums.includes(classNum)) continue;
    if (normSubject(r.subjectName) === subj) return true;
  }
  return false;
}

export function evaluateMoveCandidates(args: {
  grids: ClassGrid[];
  model: TimetableConstraintModel;
  pick: { grade: number; classNum: number; day: number; period: number };
}): MoveCandidatesResult {
  const { grids, model, pick } = args;
  const baseReport = validateTimetable(grids, model);
  const baseSoftTotal = baseReport.soft.total;
  const out: MoveCandidatesResult = { candidates: [], baseSoftTotal };

  const grid = grids.find((g) => g.grade === pick.grade && g.classNum === pick.classNum);
  const pickCell = grid?.cells?.find((c) => c.day === pick.day && c.period === pick.period);
  const pickLesson = pickCell?.lessons?.[0];
  if (!grid || !pickLesson) {
    out.pickBlocked = "빈 칸입니다 — 옮길 수업이 없습니다.";
    return out;
  }

  const simulMatch = buildSimulMatcher(model.simulGroups || [], model.subjects);
  const simulOf = (day: number, period: number, lesson?: TimetableLesson | null): string | null =>
    lesson ? simulMatch(pick.grade, pick.classNum, day, period, lesson.subjectName) : null;

  // ── 집기 가능 판정 (스펙 §2-3 집기 단위 규약) ──
  if (findPlaceholderLesson(grids, pick.grade, pick.classNum, pick.day, pick.period)) {
    out.pickBlocked =
      "학교 전체가 같은 시간에 묶인 수업이라 한 학급만 옮길 수 없습니다.";
    return out;
  }
  const pickSimul = simulOf(pick.day, pick.period, pickLesson);
  if (pickSimul) {
    out.pickBlocked = `분반 이동수업 묶음(${pickSimul})이라 여기서는 옮길 수 없습니다.`;
    return out;
  }
  if (matchesConsecutiveRule(model, pick.grade, pick.classNum, pickLesson)) {
    out.pickBlocked = "이어서 하는 묶음 수업이라 아직 여기서는 옮길 수 없습니다.";
    return out;
  }

  const baseHardKeys = new Set(baseReport.hard.map(hardViolationKey));
  const dayPeriods = model.gradeDayPeriods?.[pick.grade] || {};

  for (let day = 1; day <= 5; day++) {
    const maxP = dayPeriods[day] || 0;
    for (let period = 1; period <= maxP; period++) {
      if (day === pick.day && period === pick.period) continue;

      const targetCell = grid.cells?.find((c) => c.day === day && c.period === period);
      const targetLesson = targetCell?.lessons?.[0] || null;
      const kind: MoveCandidate["kind"] = targetLesson ? "swap" : "move";

      // 목적지 집기 규약 — 자리표시·동시수업 칸은 회색
      if (findPlaceholderLesson(grids, pick.grade, pick.classNum, day, period)) {
        out.candidates.push({
          day, period, kind, verdict: "blocked", softDelta: 0,
          blockedReason: "학교 전체가 같은 시간에 묶인 칸입니다.",
        });
        continue;
      }
      const targetSimul = simulOf(day, period, targetLesson);
      if (targetSimul) {
        out.candidates.push({
          day, period, kind, verdict: "blocked", softDelta: 0,
          blockedReason: `분반 이동수업 묶음(${targetSimul}) 칸입니다.`,
        });
        continue;
      }
      if (targetLesson && matchesConsecutiveRule(model, pick.grade, pick.classNum, targetLesson)) {
        out.candidates.push({
          day, period, kind, verdict: "blocked", softDelta: 0,
          blockedReason: "이어서 하는 묶음 수업이 있는 칸입니다.",
        });
        continue;
      }

      // 실제 op를 사본에 적용하고 본검사기로 채점 — 서버 관문과 동일 판정
      const op: BaseRevisionOp = {
        type: "swap",
        grade: pick.grade,
        classNum: pick.classNum,
        a: { day: pick.day, period: pick.period },
        b: { day, period },
      };
      const trial = cloneClassGrids(grids);
      applyRevisionOps(trial, [op]);
      const report = validateTimetable(trial, model);

      const newHard = report.hard.find((h) => !baseHardKeys.has(hardViolationKey(h)));
      if (newHard) {
        // 맞바꿈 불성립 — 점유 칸이면 「밀어내기 배치」(내 수업을 넣고 그 칸 수업을 들어올림)를
        // 시도한다 (M2 연쇄의 시작 수 — 컴시간 연쇄이동의 재현). 들린 수업의 시수 부족(H1)은
        // park와 같은 원리로 면제한다 — 연쇄가 끝나기 전의 중간 상태이기 때문.
        if (targetLesson) {
          const trial2 = cloneClassGrids(grids);
          const g2 = trial2.find((g) => g.grade === pick.grade && g.classNum === pick.classNum)!;
          const src = g2.cells!.find((c) => c.day === pick.day && c.period === pick.period)!;
          const dst = g2.cells!.find((c) => c.day === day && c.period === period)!;
          const heldLessons = dst.lessons;
          dst.lessons = src.lessons;
          src.lessons = [];
          const report2 = validateTimetable(trial2, model);
          const heldTray: TrayEntry[] = [
            { parkId: "_probe", grade: pick.grade, classNum: pick.classNum, lessons: heldLessons, from: { day, period } },
          ];
          const blocking2 = report2.hard.find(
            (h) => !baseHardKeys.has(hardViolationKey(h)) && !isParkExemptHard(h, heldTray)
          );
          if (!blocking2) {
            const delta2 = report2.soft.total - baseSoftTotal;
            const cand2: MoveCandidate = {
              day, period, kind: "displace",
              verdict: delta2 > 0 ? "worse" : "ok",
              softDelta: delta2,
            };
            // 「왜 나빠지는가」를 여기서도 채운다 (2026-08-23 사용자 실기기 발견).
            // 종전엔 이 분기만 worseByCode를 빼먹어 **밀어내기 후보에서만 사유 말풍선이 비었다**
            // — 실측 923개 worse 후보 중 385개(42%)가 그랬고, 42%는 정확히 displace 비율이었다.
            // 다른 두 분기(:202 일반 이동·:289 집은 수업)는 같은 계산을 이미 하고 있었다.
            if (delta2 > 0) {
              const worse2: Partial<Record<SoftPenaltyCode, number>> = {};
              for (const [code, pts] of Object.entries(report2.soft.byCode)) {
                const before = baseReport.soft.byCode[code as SoftPenaltyCode] || 0;
                const diff = (pts || 0) - before;
                if (diff > 0) worse2[code as SoftPenaltyCode] = diff;
              }
              cand2.worseByCode = worse2;
            }
            out.candidates.push(cand2);
            continue;
          }
        }
        out.candidates.push({
          day, period, kind, verdict: "blocked", softDelta: 0,
          blockedReason: newHard.text,
        });
        continue;
      }

      const softDelta = report.soft.total - baseSoftTotal;
      const cand: MoveCandidate = {
        day, period, kind,
        verdict: softDelta > 0 ? "worse" : "ok",
        softDelta,
      };
      if (softDelta > 0) {
        const worse: Partial<Record<SoftPenaltyCode, number>> = {};
        for (const [code, pts] of Object.entries(report.soft.byCode)) {
          const before = baseReport.soft.byCode[code as SoftPenaltyCode] || 0;
          const diff = (pts || 0) - before;
          if (diff > 0) worse[code as SoftPenaltyCode] = diff;
        }
        cand.worseByCode = worse;
      }
      out.candidates.push(cand);
    }
  }
  return out;
}

/**
 * 든 카드(held — 밀려나 들린 수업 또는 트레이 카드) 기준 후보 채점 (M2 연쇄 재계산용).
 * held 수업은 이미 판에서 빠져 있는 상태의 grids를 받는다. 같은 학급의 각 칸에 대해:
 *  - 빈 칸 = 내려놓기(move) · 점유 칸 = 또 밀어내기(displace — 그 칸 수업이 다음 held가 된다)
 * 채점·차단 원리는 evaluateMoveCandidates와 동일(본검사기 단일 소재지). held 자신과
 * 새로 들리는 수업의 시수 부족(H1)은 중간 상태이므로 면제한다(park와 같은 원리).
 */
export function evaluateHeldCandidates(args: {
  grids: ClassGrid[];
  model: TimetableConstraintModel;
  held: { grade: number; classNum: number; lessons: TimetableLesson[] };
}): MoveCandidatesResult {
  const { grids, model, held } = args;
  const baseReport = validateTimetable(grids, model);
  const baseSoftTotal = baseReport.soft.total;
  const out: MoveCandidatesResult = { candidates: [], baseSoftTotal };
  const grid = grids.find((g) => g.grade === held.grade && g.classNum === held.classNum);
  if (!grid || !held.lessons.length) {
    out.pickBlocked = "들고 있는 수업이 없습니다.";
    return out;
  }
  const simulMatch = buildSimulMatcher(model.simulGroups || [], model.subjects);
  // held 자신의 H1은 base에 이미 있어 "신규"가 아니므로 자동 무해 — 신규로 들릴 수업만 면제 대상
  const baseHardKeys = new Set(baseReport.hard.map(hardViolationKey));
  const dayPeriods = model.gradeDayPeriods?.[held.grade] || {};

  for (let day = 1; day <= 5; day++) {
    const maxP = dayPeriods[day] || 0;
    for (let period = 1; period <= maxP; period++) {
      const targetCell = grid.cells?.find((c) => c.day === day && c.period === period);
      const targetLesson = targetCell?.lessons?.[0] || null;
      const kind: MoveCandidate["kind"] = targetLesson ? "displace" : "move";

      if (findPlaceholderLesson(grids, held.grade, held.classNum, day, period)) {
        out.candidates.push({ day, period, kind, verdict: "blocked", softDelta: 0, blockedReason: "학교 전체가 같은 시간에 묶인 칸입니다." });
        continue;
      }
      const targetSimul = targetLesson
        ? simulMatch(held.grade, held.classNum, day, period, targetLesson.subjectName)
        : null;
      if (targetSimul) {
        out.candidates.push({ day, period, kind, verdict: "blocked", softDelta: 0, blockedReason: `분반 이동수업 묶음(${targetSimul}) 칸입니다.` });
        continue;
      }
      if (targetLesson && matchesConsecutiveRule(model, held.grade, held.classNum, targetLesson)) {
        out.candidates.push({ day, period, kind, verdict: "blocked", softDelta: 0, blockedReason: "이어서 하는 묶음 수업이 있는 칸입니다." });
        continue;
      }

      const trial = cloneClassGrids(grids);
      const g2 = trial.find((g) => g.grade === held.grade && g.classNum === held.classNum)!;
      let cell = g2.cells!.find((c) => c.day === day && c.period === period);
      if (!cell) {
        cell = { day, period, lessons: [] };
        g2.cells!.push(cell);
      }
      const nextHeld = cell.lessons;
      cell.lessons = held.lessons.map((l) => ({ ...l, teachers: (l.teachers || []).map((t) => ({ ...t })) }));
      const report = validateTimetable(trial, model);
      const exemptTray: TrayEntry[] = nextHeld.length
        ? [{ parkId: "_probe", grade: held.grade, classNum: held.classNum, lessons: nextHeld, from: { day, period } }]
        : [];
      const blocking = report.hard.find(
        (h) => !baseHardKeys.has(hardViolationKey(h)) && !isParkExemptHard(h, exemptTray)
      );
      if (blocking) {
        out.candidates.push({ day, period, kind, verdict: "blocked", softDelta: 0, blockedReason: blocking.text });
        continue;
      }
      const softDelta = report.soft.total - baseSoftTotal;
      const cand: MoveCandidate = { day, period, kind, verdict: softDelta > 0 ? "worse" : "ok", softDelta };
      if (softDelta > 0) {
        const worse: Partial<Record<SoftPenaltyCode, number>> = {};
        for (const [code, pts] of Object.entries(report.soft.byCode)) {
          const before = baseReport.soft.byCode[code as SoftPenaltyCode] || 0;
          const diff = (pts || 0) - before;
          if (diff > 0) worse[code as SoftPenaltyCode] = diff;
        }
        cand.worseByCode = worse;
      }
      out.candidates.push(cand);
    }
  }
  return out;
}
