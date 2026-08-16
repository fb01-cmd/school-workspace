/**
 * 특별실 배정 판정 — 순수 함수, Firestore 의존 없음
 *
 * 상위 스펙: docs/pre_opening_3features_spec.md §F
 * 특별실(다윗관·탁구장·정보실·생명과학실 …)은 한 교시에 한 수업만 쓸 수 있는 공유 자원이다.
 * 엔진(swap.ts)에는 lesson.room 기반 특별실 충돌 하드 제외가 이미 구현돼 있으나
 * (buildSlotIndex.roomUse + isRoomFree — 맞교환·교차 주 target 검사), 변환된 기초 그리드에
 * room 값이 없어 발화하지 않았다. 등록부(VenueGroup)가 판정 원본이며, 그리드 로드 시
 * 일치 lesson에 `room`(특별실명)을 스탬프해 기존 엔진 검사를 살린다 (판정 단일 통로).
 *
 * 동시수업(simul)과 달리 소스 차단은 하지 않는다 — 특별실 수업도 교체 가능하되,
 * 옮겨갈 교시에 같은 특별실 사용 수업이 있으면 그 후보만 제외된다 (2026-08-07 사용자 확정).
 */

import { buildSubjectIndex, sameSubjectExact } from "./subjectDict";
import { ClassGrid, SimulSlot, SubjectNameEntry, VenueGroup } from "./types";

export type { VenueGroup };

const normSubject = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();

export type VenueMatcher = (
  grade: number,
  classNum: number,
  day: number,
  period: number,
  subjectName: string
) => string | null;

/** 등록부에서 판정 함수 생성 — active 그룹만. 반환값은 특별실명(미해당 시 null).
 *  subjects(과목 사전)가 오면 확정 별칭까지 정확 일치로 잡는다 — 완전일치 전용이던 이
 *  경로와 느슨하던 solver venueProbe의 규칙 비대칭 해소 (subject_dictionary_spec §4).
 *  느슨 매칭 폴백은 여기엔 처음부터 없었고 지금도 넣지 않는다. */
export function buildVenueMatcher(groups: VenueGroup[], subjects?: SubjectNameEntry[]): VenueMatcher {
  const active = groups.filter((g) => g.active);
  const dict = buildSubjectIndex(subjects);
  const prepared = active.map((g) => ({
    roomName: g.roomName,
    grade: g.grade,
    classNums: new Set(g.classNums),
    subjects: new Set(g.subjectNames.map(normSubject)),
    subjectNamesRaw: g.subjectNames,
    slots: g.slots?.length ? new Set(g.slots.map((s: SimulSlot) => `${s.day}-${s.period}`)) : null,
  }));
  return (grade, classNum, day, period, subjectName) => {
    const subj = normSubject(subjectName);
    for (const g of prepared) {
      if (g.grade !== grade || !g.classNums.has(classNum)) continue;
      if (
        !g.subjects.has(subj) &&
        !g.subjectNamesRaw.some((s) => sameSubjectExact(dict, s, subjectName) === true)
      )
        continue;
      if (g.slots && !g.slots.has(`${day}-${period}`)) continue;
      return g.roomName;
    }
    return null;
  };
}

/**
 * 기초 그리드에 특별실명(room) 스탬프 (제자리 수정) — 로더가 호출. 판정은 기초 위치 기준.
 * simul 마크와 달리 미일치 lesson의 기존 room은 지우지 않는다 — room은 가져오기 원본이
 * 실을 수 있는 정식 저장 필드이므로 (등록부는 덮어쓰기만, 삭제 권한 없음).
 */
export function applyVenueMarks(grids: ClassGrid[], groups: VenueGroup[], subjects?: SubjectNameEntry[]): void {
  if (!groups.some((g) => g.active)) return;
  const match = buildVenueMatcher(groups, subjects);
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const room = match(grid.grade, grid.classNum, cell.day, cell.period, lesson.subjectName);
        if (room) lesson.room = room;
      }
    }
  }
}

export interface VenueCellListing {
  grade: number;
  classNum: number;
  day: number;
  period: number;
  subjectName: string;
  teacherNames: string[];
  roomName: string;
}

/** 판정에 걸리는 셀 전수 나열 — 등재 검증(눈 대조)·등록부 미리보기용 */
export function listVenueCells(grids: ClassGrid[], groups: VenueGroup[], subjects?: SubjectNameEntry[]): VenueCellListing[] {
  const match = buildVenueMatcher(groups, subjects);
  const out: VenueCellListing[] = [];
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const roomName = match(grid.grade, grid.classNum, cell.day, cell.period, lesson.subjectName);
        if (!roomName) continue;
        out.push({
          grade: grid.grade,
          classNum: grid.classNum,
          day: cell.day,
          period: cell.period,
          subjectName: lesson.subjectName,
          teacherNames: (lesson.teachers || []).map((t) => t.name),
          roomName,
        });
      }
    }
  }
  out.sort(
    (a, b) =>
      a.roomName.localeCompare(b.roomName, "ko") ||
      a.grade - b.grade || a.classNum - b.classNum || a.day - b.day || a.period - b.period
  );
  return out;
}

/**
 * 기초 그리드에서 특별실 이중 점유(같은 교시 같은 특별실 2수업 이상)를 찾는다 —
 * 등재 직후 무결성 검증용. 정상 기초라면 0건이어야 한다.
 */
export function findVenueBaseConflicts(
  grids: ClassGrid[],
  groups: VenueGroup[]
): Array<{ day: number; period: number; roomName: string; users: string[] }> {
  const cells = listVenueCells(grids, groups);
  const bySlotRoom = new Map<string, string[]>();
  for (const c of cells) {
    const key = `${c.day}-${c.period}|${c.roomName}`;
    if (!bySlotRoom.has(key)) bySlotRoom.set(key, []);
    bySlotRoom.get(key)!.push(`${c.grade}-${c.classNum} ${c.subjectName}`);
  }
  const out: Array<{ day: number; period: number; roomName: string; users: string[] }> = [];
  for (const [key, users] of bySlotRoom.entries()) {
    if (users.length < 2) continue;
    const [slot, roomName] = key.split("|");
    const [day, period] = slot.split("-").map(Number);
    out.push({ day, period, roomName, users });
  }
  return out.sort((a, b) => a.day - b.day || a.period - b.period);
}
