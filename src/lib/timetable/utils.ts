/**
 * Phase 9b: 시간표 UI 및 날짜/슬롯 포맷터 공용 유틸 모듈
 */

export const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

/** weekStartDate(월요일 YYYY-MM-DD)와 요일 index(1~5)로 "8/13" 문자열 생성 */
export function getDayDateLabel(weekStartDate: string, day: number): string {
  if (!weekStartDate) return "";
  const parts = weekStartDate.split("-").map((v) => parseInt(v, 10));
  if (parts.length < 3 || isNaN(parts[0])) return "";
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + (day - 1));
  const m = d.getMonth() + 1;
  const dayNum = d.getDate();
  return `${m}/${dayNum}`;
}

/** weekStartDate(월요일 YYYY-MM-DD)로 "8/10(월)~8/14(금)" 문자열 생성 */
export function getWeekRangeLabel(weekStartDate: string): string {
  if (!weekStartDate) return "";
  const startMD = getDayDateLabel(weekStartDate, 1);
  const endMD = getDayDateLabel(weekStartDate, 5);
  return `${startMD}(월)~${endMD}(금)`;
}

/** weekId(월요일 YYYY-MM-DD), day(1~5), period(1~) 로 "8/13(목) 2교시" 형식 문자열 생성 */
export function formatSlotWithDate(weekId?: string, day?: number, period?: number): string {
  if (!day || !period) return "";
  const dayStr = DAY_LABEL[day] || `${day}`;
  if (!weekId) return `${dayStr}요일 ${period}교시`;

  const parts = weekId.split("-").map((v) => parseInt(v, 10));
  if (parts.length < 3 || isNaN(parts[0])) return `${dayStr}요일 ${period}교시`;

  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  dateObj.setDate(dateObj.getDate() + (day - 1));
  const m = dateObj.getMonth() + 1;
  const d = dateObj.getDate();

  return `${m}/${d}(${dayStr}) ${period}교시`;
}

/**
 * 사전 양해 요청 메시지 텍스트 생성 (13-1 공유 카드 텍스트 & 13-2 DM 본문 재사용)
 */
export function buildShareCardMessage(params: {
  requesterName: string;
  sourceWeekId: string;
  source: { day: number; period: number; grade: number; classNum: number; subjectName: string };
  targetWeekId?: string;
  candidate: {
    targetDay?: number;
    targetPeriod?: number;
    counterpartName?: string;
    counterpartSubjectName?: string;
  };
}): string {
  const sourceSlotStr = formatSlotWithDate(params.sourceWeekId, params.source.day, params.source.period);
  const targetWeek = params.targetWeekId || params.sourceWeekId;
  const targetSlotStr = formatSlotWithDate(targetWeek, params.candidate.targetDay, params.candidate.targetPeriod);

  const counterpartTitle = params.candidate.counterpartName
    ? `${params.candidate.counterpartName} 선생님`
    : "선생님";

  const counterpartLessonName = params.candidate.counterpartSubjectName
    ? `${params.source.grade}-${params.source.classNum}반 ${params.candidate.counterpartSubjectName}`
    : "수업";

  return `[수업교환 양해 요청]
안녕하세요, ${counterpartTitle}! 👋
${params.requesterName} 교사입니다. 이렇게 수업 교체가 가능할까요? 😊

• 선생님 수업: ${counterpartLessonName} (${targetSlotStr} → ${sourceSlotStr}로 이동)
• 제 수업: ${params.source.grade}-${params.source.classNum}반 ${params.source.subjectName} (${sourceSlotStr} → ${targetSlotStr}로 이동)

확인 부탁드립니다. 감사합니다!`;
}

import type { BaseRevisionOp, CandidateCoordination, ClassGrid, CoordinationOccupant } from "./types";

export function cloneClassGrids(grids: ClassGrid[]): ClassGrid[] {
  return grids.map((g) => ({
    grade: g.grade,
    classNum: g.classNum,
    cells: (g.cells || []).map((c) => ({
      day: c.day,
      period: c.period,
      lessons: (c.lessons || []).map((l) => ({
        ...l,
        teachers: (l.teachers || []).map((t) => ({ ...t })),
      })),
    })),
  }));
}

const DAY_KO = ["", "월", "화", "수", "목", "금"];

export function applyRevisionOps(grids: ClassGrid[], ops: BaseRevisionOp[]): string[] {
  const warnings: string[] = [];
  const findGrid = (grade: number, classNum: number) =>
    grids.find((g) => g.grade === grade && g.classNum === classNum);
  const getOrCreateCell = (grid: ClassGrid, day: number, period: number) => {
    let cell = grid.cells.find((c) => c.day === day && c.period === period);
    if (!cell) {
      cell = { day, period, lessons: [] };
      grid.cells.push(cell);
    }
    return cell;
  };
  for (const op of ops) {
    const grid = findGrid(op.grade, op.classNum);
    if (!grid) {
      warnings.push(`${op.grade}-${op.classNum}반 시간표가 없어 편집 1건을 건너뜀`);
      continue;
    }
    if (op.type === "swap") {
      const cellA = getOrCreateCell(grid, op.a.day, op.a.period);
      const cellB = getOrCreateCell(grid, op.b.day, op.b.period);
      if (cellA.lessons.length === 0 && cellB.lessons.length === 0) {
        warnings.push(
          `${op.grade}-${op.classNum}반 ${DAY_KO[op.a.day]}${op.a.period}·${DAY_KO[op.b.day]}${op.b.period}교시 모두 빈 교시라 맞바꿈을 건너뜀`
        );
        continue;
      }
      const tmp = cellA.lessons;
      cellA.lessons = cellB.lessons;
      cellB.lessons = tmp;
    } else {
      const cell = getOrCreateCell(grid, op.day, op.period);
      cell.lessons = op.lessons.map((l) => ({
        ...l,
        teachers: (l.teachers || []).map((t) => ({ ...t })),
      }));
    }
  }
  return warnings;
}


/**
 * 조율 필요 후보의 충돌 내용을 수신자 눈높이 문장으로 변환 (consent_swap_opening_spec §3-2d U1: 처방/지시 표현 제거 및 사실 서술)
 * 예: "교체하면 이 시간 탁구장 사용이 겹칩니다 ─ 사용 중: 정동희 선생님(2-3 체Ⅱ)"
 */
export function formatCoordinationText(coordination?: CandidateCoordination): string {
  if (!coordination || !coordination.conflicts || coordination.conflicts.length === 0) return "";
  return coordination.conflicts
    .map((c) => {
      const occupantsStr = c.occupants
        .map((o) => `${o.teacherName} 선생님(${o.grade}-${o.classNum} ${o.subjectName})`)
        .join(", ");
      return `교체하면 이 시간 ${c.roomName} 사용이 겹칩니다 ─ 사용 중: ${occupantsStr}`;
    })
    .join(" / ");
}

/** 조율 필요 후보의 occupants 전체 목록 추출 (중복 제거) */
export function getCoordinationOccupants(coordination?: CandidateCoordination): CoordinationOccupant[] {
  if (!coordination || !coordination.conflicts) return [];
  const map = new Map<string, CoordinationOccupant>();
  for (const c of coordination.conflicts) {
    for (const o of c.occupants) {
      if (o.teacherEmail) {
        map.set(o.teacherEmail.toLowerCase(), o);
      }
    }
  }
  return Array.from(map.values());
}

/** 조율 필요 후보의 모든 양해 대상 교사/점유자 목록 추출 (동시수업 + 특별실) */
export function getCoordinationAllParties(coordination?: CandidateCoordination): string[] {
  if (!coordination) return [];
  // 사람 단위로 묶는다 — 한 교사가 그룹 수업 담당이면서 동시에 치워지는 상대일 수 있어(실데이터 확인),
  // 표시 문자열로 중복 제거하면 같은 사람이 두 번 세어져 양해 인원이 부풀려진다.
  // 서버 도출(deriveSimulMoveParties)과 같은 축(이메일)으로 묶고, 역할은 한 줄에 합친다.
  const people = new Map<string, { name: string; roles: string[] }>();
  const add = (email: string | undefined, name: string | undefined, role: string) => {
    if (!name) return;
    const key = (email || "").trim().toLowerCase() || `name:${name}`;
    const entry = people.get(key) || { name, roles: [] };
    if (!entry.roles.includes(role)) entry.roles.push(role);
    people.set(key, entry);
  };

  if (coordination.simul?.steps) {
    for (const step of coordination.simul.steps) {
      add(step.groupLesson?.teacherEmail, step.groupLesson?.teacherName, `${step.classNum}반 ${step.groupLesson?.subjectName}`);
      if (step.counterpart) add(step.counterpart.teacherEmail, step.counterpart.teacherName, step.counterpart.subjectName);
    }
  }

  if (coordination.conflicts) {
    for (const c of coordination.conflicts) {
      for (const o of c.occupants) {
        add(o.teacherEmail, o.teacherName, `${o.grade}-${o.classNum}반 ${o.subjectName}`);
      }
    }
  }

  return Array.from(people.values()).map((p) => `${p.name} 선생님(${p.roles.join("·")})`);
}


