/**
 * 기간제 교사 담당 일괄 이관 — 순수 산출 로직 (docs/substitute_handover_spec.md §3)
 *
 * 날 단위 인수(§0-6)를 기존 장치 2개의 이어붙이기로 구현한다:
 *  1) 걸치는 주: 인수일 이후 요일의 원 교사 수업 → 직권 보강(substitute) 의도 목록 산출
 *     (커밋은 기존 directCommit 경로 — 검증·합성·알림·되돌리기 전부 상속)
 *  2) 다음 주부터: 기초시간표 개정판 ops 산출 — 원 교사 담당 셀만 edit_cell로 치환
 *
 * 이 파일은 네트워크·Firestore 무의존 — scripts/verify_handover.ts가 직접 임포트한다.
 */

import { BaseRevisionOp, ClassGrid, TimetableLesson } from "./types";

export interface HandoverTeacher {
  email: string;
  name: string;
}

export interface HandoverWeekIntent {
  grade: number;
  classNum: number;
  day: number; // 1=월..5=금
  period: number;
  subjectName: string;
}

// ── 날짜 산술 (YYYY-MM-DD 문자열, UTC 고정 — KST 시프트 함정 없음) ──

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 1=월 .. 7=일 */
export function dayOfWeekFromDateStr(dateStr: string): number {
  if (!DATE_RE.test(dateStr)) throw new Error(`날짜 형식 오류: ${dateStr}`);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일
  return dow === 0 ? 7 : dow;
}

export function addDaysToDateStr(dateStr: string, add: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + add);
  return t.toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 월요일 */
export function mondayOfDateStr(dateStr: string): string {
  return addDaysToDateStr(dateStr, 1 - dayOfWeekFromDateStr(dateStr));
}

/** 그 날짜가 속한 주의 다음 주 월요일 */
export function nextMondayAfter(dateStr: string): string {
  return addDaysToDateStr(mondayOfDateStr(dateStr), 7);
}

// ── 수업 판정 ────────────────────────────────────────────────

function lessonHasTeacher(lesson: TimetableLesson, email: string): boolean {
  const target = email.trim().toLowerCase();
  return (lesson.teachers || []).some((t) => (t.email || "").trim().toLowerCase() === target);
}

/**
 * 걸치는 주 의도 산출 — fromDay(포함)부터 금요일까지 원 교사의 수업 전부.
 * 신규 교사는 자기 시간표가 없으므로(전임자 시간표를 통째로 상속) 가용성 충돌이
 * 구조적으로 없다 — 원 교사 자신의 시간표에 겹침이 없기 때문 (spec §3-1).
 */
export function computeHandoverWeekIntents(
  grids: ClassGrid[],
  fromTeacherEmail: string,
  fromDay: number
): HandoverWeekIntent[] {
  const intents: HandoverWeekIntent[] = [];
  if (fromDay > 5) return intents; // 주말 인수일 — 걸치는 주 없음
  for (const grid of grids) {
    for (const cell of grid.cells) {
      if (cell.day < fromDay || cell.day > 5) continue;
      for (const lesson of cell.lessons) {
        if (!lessonHasTeacher(lesson, fromTeacherEmail)) continue;
        intents.push({
          grade: grid.grade,
          classNum: grid.classNum,
          day: cell.day,
          period: cell.period,
          subjectName: lesson.subjectName,
        });
      }
    }
  }
  intents.sort(
    (a, b) =>
      a.day - b.day || a.period - b.period || a.grade - b.grade || a.classNum - b.classNum
  );
  return intents;
}

/**
 * 치환 개정판 ops 산출 — 원 교사가 담긴 셀만 edit_cell로, teachers 배열에서 그 교사만
 * 새 교사로 바꾼다(공동수업의 다른 교사는 불변). 다른 셀·등록부는 손대지 않는다.
 *
 * 주의: 입력 grids는 로드 시 simul·room이 등록부 대조로 스탬프된 상태일 수 있다 —
 * 스탬프 필드를 개정판에 박제하면 등록부(단일 원본)와 이원화되므로 저장 필드만 남긴다.
 */
export function buildHandoverRevisionOps(
  grids: ClassGrid[],
  from: HandoverTeacher,
  to: HandoverTeacher
): BaseRevisionOp[] {
  const ops: BaseRevisionOp[] = [];
  for (const grid of grids) {
    for (const cell of grid.cells) {
      if (!cell.lessons.some((l) => lessonHasTeacher(l, from.email))) continue;
      const lessons: TimetableLesson[] = cell.lessons.map((l) => ({
        subjectName: l.subjectName,
        subjectShort: l.subjectShort,
        teachers: (l.teachers || []).map((t) =>
          (t.email || "").trim().toLowerCase() === from.email.trim().toLowerCase()
            ? { email: to.email.trim().toLowerCase(), name: to.name }
            : { email: t.email, name: t.name }
        ),
      }));
      ops.push({
        type: "edit_cell",
        grade: grid.grade,
        classNum: grid.classNum,
        day: cell.day,
        period: cell.period,
        lessons,
      });
    }
  }
  return ops;
}

/**
 * 인수일 → 실행 계획: 걸치는 주 범위와 개정판 적용 시작 주.
 * - 인수일이 미래 주의 월요일이면 개정판만으로 충분 (걸치는 주 없음, 그 월요일부터)
 * - 그 외(주 중간·현재 주 월요일·주말)는 걸치는 주 의도 + 다음 주 월요일 개정판
 *   (applyRevisionDraft가 운영 중인 주 소급을 거부하므로 현재 주 월요일도 이 갈래)
 */
export function planHandoverDates(
  takeoverDate: string,
  currentMonday: string
): { weekId: string; fromDay: number; effectiveFrom: string; weekIntentsNeeded: boolean } {
  const monday = mondayOfDateStr(takeoverDate);
  const dow = dayOfWeekFromDateStr(takeoverDate);
  if (dow === 1 && monday > currentMonday) {
    return { weekId: monday, fromDay: 1, effectiveFrom: monday, weekIntentsNeeded: false };
  }
  return {
    weekId: monday,
    fromDay: dow,
    effectiveFrom: nextMondayAfter(takeoverDate),
    weekIntentsNeeded: dow <= 5,
  };
}
