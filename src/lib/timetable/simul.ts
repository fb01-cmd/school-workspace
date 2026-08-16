/**
 * 동시수업(분반 이동수업) 판정 — 순수 함수, Firestore 의존 없음
 *
 * 상위 스펙: docs/pre_opening_3features_spec.md §A
 * 제2외국어·일부 과학처럼 여러 반을 묶어 같은 교시에 진행하는 수업은 단일 반 교체가
 * 불가능하다. 변환된 기초 그리드에서는 반마다 평범한 단일 lesson으로 보여 기존
 * 하드 제외(한 셀 lessons 2+)에 걸리지 않으므로, 등록부(SimulGroup)가 유일한 판정 원본이다.
 *
 * 적용 방식: 그리드 로드 시 일치 lesson에 `simul`(그룹 라벨)을 스탬프하고,
 * 엔진·커밋 검증·화면은 이 필드 하나만 본다 (판정 단일 통로).
 */

import { subjectMatches, subjectStemLoose } from "./hoursAssignment";
import { buildSubjectIndex, sameSubjectExact } from "./subjectDict";
import { ClassGrid, SimulGroup, SimulSlot, SubjectNameEntry, TimetableLesson } from "./types";

export type { SimulGroup, SimulSlot };

const normSubject = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();

export type SimulMatcher = (
  grade: number,
  classNum: number,
  day: number,
  period: number,
  subjectName: string
) => string | null;

/** 등록부에서 판정 함수 생성 — active 그룹만. 반환값은 그룹 라벨(미해당 시 null).
 *  subjects(과목 사전)가 오면 사전 정확 일치가 1차 판정 (subject_dictionary_spec §4). */
export function buildSimulMatcher(groups: SimulGroup[], subjects?: SubjectNameEntry[]): SimulMatcher {
  const active = groups.filter((g) => g.active);
  const dict = buildSubjectIndex(subjects);
  const prepared = active.map((g) => ({
    label: g.label,
    grade: g.grade,
    classNums: new Set(g.classNums),
    subjects: new Set(g.subjectNames.map(normSubject)),
    subjectNamesRaw: g.subjectNames,
    slots: g.slots?.length ? new Set(g.slots.map((s) => `${s.day}-${s.period}`)) : null,
  }));
  // 등록부는 분반 차수 표기("중화"·"인공Ⅱ"), 배정표 유래 수업은 정식 명칭.
  // 1차 = 과목 사전 정확 일치(별칭 포함). 사전이 "서로 다른 과목"이라 확정하면 그걸로 끝 —
  // 느슨 폴백을 시도하지 않는다(물Ⅰ/Ⅱ류 오연결 방지). 사전이 판정 불능일 때만
  // 기존 느슨 매칭(약칭 부분열 → 그룹 한정 줄기)으로 폴백한다 — 전환 1단계 안전망
  // (2026-08-17 H7 실사고의 임시 다리, 사전 확정이 쌓이면 §5의 조건으로 제거).
  const nameHit = (g: (typeof prepared)[number], subj: string, subjectName: string) => {
    if (g.subjects.has(subj)) return true;
    for (const s of g.subjectNamesRaw) {
      const exact = sameSubjectExact(dict, s, subjectName);
      if (exact === true) return true;
      if (exact === false) continue;
      if (subjectMatches(s, subjectName) || subjectStemLoose(s, subjectName)) return true;
    }
    return false;
  };
  return (grade, classNum, day, period, subjectName) => {
    const subj = normSubject(subjectName);
    for (const g of prepared) {
      if (g.grade !== grade || !g.classNums.has(classNum)) continue;
      if (!nameHit(g, subj, subjectName)) continue;
      if (g.slots && !g.slots.has(`${day}-${period}`)) continue;
      return g.label;
    }
    return null;
  };
}

/** 기초 그리드에 simul 라벨 스탬프 (제자리 수정) — 로더가 호출. 판정은 기초 위치 기준(§A-2). */
export function applySimulMarks(grids: ClassGrid[], groups: SimulGroup[], subjects?: SubjectNameEntry[]): void {
  if (!groups.some((g) => g.active)) return;
  const match = buildSimulMatcher(groups, subjects);
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const label = match(grid.grade, grid.classNum, cell.day, cell.period, lesson.subjectName);
        if (label) lesson.simul = label;
        else if (lesson.simul) delete lesson.simul;
      }
    }
  }
}

export interface SimulCellListing {
  grade: number;
  classNum: number;
  day: number;
  period: number;
  subjectName: string;
  teacherNames: string[];
  groupLabel: string;
}

/** 판정에 걸리는 셀 전수 나열 — 등재 검증(눈 대조)·등록부 미리보기용 (§A-5) */
export function listSimulCells(grids: ClassGrid[], groups: SimulGroup[], subjects?: SubjectNameEntry[]): SimulCellListing[] {
  const match = buildSimulMatcher(groups, subjects);
  const out: SimulCellListing[] = [];
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const label = match(grid.grade, grid.classNum, cell.day, cell.period, lesson.subjectName);
        if (!label) continue;
        out.push({
          grade: grid.grade,
          classNum: grid.classNum,
          day: cell.day,
          period: cell.period,
          subjectName: lesson.subjectName,
          teacherNames: (lesson.teachers || []).map((t) => t.name),
          groupLabel: label,
        });
      }
    }
  }
  out.sort(
    (a, b) =>
      a.grade - b.grade || a.classNum - b.classNum || a.day - b.day || a.period - b.period
  );
  return out;
}

/** 교체 차단 안내 문구 (단일 원본 — 엔진·직권·커밋 검증 공용) */
export const SIMUL_BLOCK_MESSAGE =
  "여러 반이 함께 듣는 이동수업이라 교체할 수 없습니다. 부득이한 경우 일과계에 문의해 주세요.";

/** lesson이 동시수업인지 (스탬프 기준 판정 — 합성 이후 단계 공용) */
export function isSimulLesson(lesson: Pick<TimetableLesson, "simul">): boolean {
  return !!lesson.simul;
}

export interface SimulCheckResult {
  hit: boolean;
  groupLabel?: string;
}

/**
 * 단일 셀 판정 (클라이언트 미리보기 등 그룹 목록을 직접 쥔 화면용).
 * 서버가 그리드에 스탬프한 `lesson.simul`이 판정 단일 통로이므로, 셀 표시·차단은
 * 이 함수가 아니라 lesson.simul을 읽어야 한다 — 여기는 등록부 폼 미리보기 전용.
 */
export function isSimulCell(
  grade: number,
  classNum: number,
  day: number,
  period: number,
  subjectName: string,
  groups: SimulGroup[]
): SimulCheckResult {
  const label = buildSimulMatcher(groups)(grade, classNum, day, period, subjectName);
  return label ? { hit: true, groupLabel: label } : { hit: false };
}

/**
 * 이동수업 그룹 목록 조회 (일과계 등록부 화면 전용 — manage simul_list는 일과계·super_admin만 허용).
 * 교사·학생 화면은 이 함수를 쓰지 말 것: 권한이 없어 403이 나며, 애초에 필요 없다 —
 * 시간표 응답의 lesson.simul(교사 뷰는 cell.simul)에 서버가 라벨을 실어 보낸다.
 */
export async function fetchSimulGroups(termId?: string): Promise<SimulGroup[]> {
  try {
    const res = await fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simul_list", ...(termId ? { termId } : {}) }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.groups || [];
  } catch (err) {
    console.error("Failed to fetch simul groups:", err);
    return [];
  }
}
