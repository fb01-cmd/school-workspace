/**
 * Phase 9b: 시간표 UI 및 날짜/슬롯 포맷터 공용 유틸 모듈
 */

export const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

/** KST 기준 오늘 날짜 (YYYY-MM-DD) — 단일 소재지. 컴포넌트에 사본을 두지 않는다 (사본 3곳 → 여기로 단일화, 2026-08-21) */
export function getTodayKSTISO(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

import type { BaseRevisionOp, CandidateCoordination, ClassGrid, CoordinationOccupant, TrayEntry } from "./types";

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
  return replayRevisionOps(grids, ops).warnings;
}

/**
 * 재생 + 트레이 파생 (직접 조정 M2). 트레이는 저장하지 않는다 — park/unpark op를 재생한
 * 결과가 곧 트레이다(Codex R3 처방). 관용 규약 유지: 이미 저장된 초안이 재생 불가가 되면
 * 안 되므로, 성립하지 않는 수는 경고를 남기고 건너뛴다(반쪽 적용 없음 — 수 단위 원자).
 */
export function replayRevisionOps(
  grids: ClassGrid[],
  ops: BaseRevisionOp[]
): { warnings: string[]; tray: TrayEntry[] } {
  const warnings: string[] = [];
  const tray: TrayEntry[] = [];
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
  const swapInGrid = (
    grid: ClassGrid,
    a: { day: number; period: number },
    b: { day: number; period: number }
  ): boolean => {
    const cellA = getOrCreateCell(grid, a.day, a.period);
    const cellB = getOrCreateCell(grid, b.day, b.period);
    if (cellA.lessons.length === 0 && cellB.lessons.length === 0) return false;
    const tmp = cellA.lessons;
    cellA.lessons = cellB.lessons;
    cellB.lessons = tmp;
    return true;
  };
  /** park 한 수 — 칸의 수업을 트레이로 (빈 칸·중복 parkId는 경고 후 건너뜀) */
  const doPark = (s: { parkId: string; grade: number; classNum: number; day: number; period: number }) => {
    const grid = findGrid(s.grade, s.classNum);
    if (!grid) {
      warnings.push(`${s.grade}-${s.classNum}반 시간표가 없어 빼두기를 건너뜀`);
      return;
    }
    const cell = getOrCreateCell(grid, s.day, s.period);
    if (cell.lessons.length === 0) {
      warnings.push(`${s.grade}-${s.classNum}반 ${DAY_KO[s.day]}${s.period}교시가 빈 칸이라 빼두기를 건너뜀`);
      return;
    }
    if (tray.some((t) => t.parkId === s.parkId)) {
      warnings.push(`빼두기 식별자(${s.parkId})가 중복되어 건너뜀`);
      return;
    }
    tray.push({
      parkId: s.parkId,
      grade: s.grade,
      classNum: s.classNum,
      lessons: cell.lessons,
      from: { day: s.day, period: s.period },
    });
    cell.lessons = [];
  };
  /** unpark 한 수 — 같은 학급의 빈 칸에만 (아니면 경고 후 건너뜀, 트레이 유지) */
  const doUnpark = (s: { parkId: string; grade: number; classNum: number; day: number; period: number }) => {
    const idx = tray.findIndex((t) => t.parkId === s.parkId);
    if (idx < 0) {
      warnings.push(`빼둔 수업(${s.parkId})이 트레이에 없어 되돌리기를 건너뜀`);
      return;
    }
    const entry = tray[idx];
    if (entry.grade !== s.grade || entry.classNum !== s.classNum) {
      warnings.push(`빼둔 수업은 ${entry.grade}-${entry.classNum}반 것이라 다른 학급에 되돌릴 수 없어 건너뜀`);
      return;
    }
    const grid = findGrid(s.grade, s.classNum);
    if (!grid) {
      warnings.push(`${s.grade}-${s.classNum}반 시간표가 없어 되돌리기를 건너뜀`);
      return;
    }
    const cell = getOrCreateCell(grid, s.day, s.period);
    if (cell.lessons.length > 0) {
      warnings.push(`${s.grade}-${s.classNum}반 ${DAY_KO[s.day]}${s.period}교시가 비어 있지 않아 되돌리기를 건너뜀`);
      return;
    }
    cell.lessons = entry.lessons;
    tray.splice(idx, 1);
  };

  for (const op of ops) {
    if (op.type === "park") {
      doPark(op);
      continue;
    }
    if (op.type === "unpark") {
      doUnpark(op);
      continue;
    }
    if (op.type === "chain") {
      // 연쇄 한 판 — 수 단위로 관용 재생 (op 자체가 undo의 원자 단위)
      for (const step of op.steps) {
        if (step.kind === "swap") {
          const grid = findGrid(step.grade, step.classNum);
          if (!grid) {
            warnings.push(`${step.grade}-${step.classNum}반 시간표가 없어 연쇄 수 1건을 건너뜀`);
            continue;
          }
          if (!swapInGrid(grid, step.a, step.b)) {
            warnings.push(
              `${step.grade}-${step.classNum}반 ${DAY_KO[step.a.day]}${step.a.period}·${DAY_KO[step.b.day]}${step.b.period}교시 모두 빈 교시라 연쇄 수 1건을 건너뜀`
            );
          }
        } else if (step.kind === "park") doPark(step);
        else doUnpark(step);
      }
      continue;
    }
    if (op.type === "swap_pair") {
      // 학급 간 교환 — 담긴 학급 전부가 같은 두 슬롯을 맞바꾼다 (원자: 한 연산이 전부 수행)
      for (const cls of op.classes) {
        const grid = findGrid(cls.grade, cls.classNum);
        if (!grid) {
          warnings.push(`${cls.grade}-${cls.classNum}반 시간표가 없어 학급 간 교환 일부를 건너뜀`);
          continue;
        }
        if (!swapInGrid(grid, op.a, op.b)) {
          warnings.push(
            `${cls.grade}-${cls.classNum}반 ${DAY_KO[op.a.day]}${op.a.period}·${DAY_KO[op.b.day]}${op.b.period}교시 모두 빈 교시라 맞바꿈을 건너뜀`
          );
        }
      }
      continue;
    }
    const grid = findGrid(op.grade, op.classNum);
    if (!grid) {
      warnings.push(`${op.grade}-${op.classNum}반 시간표가 없어 편집 1건을 건너뜀`);
      continue;
    }
    if (op.type === "swap") {
      if (!swapInGrid(grid, op.a, op.b)) {
        warnings.push(
          `${op.grade}-${op.classNum}반 ${DAY_KO[op.a.day]}${op.a.period}·${DAY_KO[op.b.day]}${op.b.period}교시 모두 빈 교시라 맞바꿈을 건너뜀`
        );
      }
    } else {
      const cell = getOrCreateCell(grid, op.day, op.period);
      cell.lessons = op.lessons.map((l) => ({
        ...l,
        teachers: (l.teachers || []).map((t) => ({ ...t })),
      }));
    }
  }
  return { warnings, tray };
}

/** 트레이 파생 — base 그리드에 ops를 재생한 뒤 남아 있는 빼둔 수업 목록.
 *  UI 트레이 표시·게시(채택) 관문이 쓴다. grids는 건드리지 않는다(사본 재생). */
export function deriveTray(baseGrids: ClassGrid[], ops: BaseRevisionOp[]): TrayEntry[] {
  const clone = cloneClassGrids(baseGrids);
  return replayRevisionOps(clone, ops).tray;
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

/**
 * 시간표 그리드의 후보 칸에 쓸 짧은 이름.
 * 묶음 이동 후보의 counterpartName은 그룹 라벨 전체(예: "2학년 선택 밴드(4·5·7·8반) 일본어회화·중국어회화·기하·인공지능기초")여서
 * 칸에 그대로 넣으면 열 폭을 밀어내 표가 깨진다. 칸에는 요약만 쓰고, 전체 내용은 확인창의 반별 전개에서 본다.
 */
export function formatCandidateSlotLabel(candidate?: {
  counterpartName?: string;
  coordination?: CandidateCoordination;
}): string {
  const simul = candidate?.coordination?.simul;
  if (simul) return `묶음 이동 · ${simul.steps.length}개 반`;
  return candidate?.counterpartName || "";
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

export interface CoordinationParty {
  email: string;
  name: string;
  label: string;
  role: "group_teacher" | "counterpart" | "venue_occupant";
  roleType: "group_teacher" | "counterpart" | "venue_occupant";
}

/** 조율 필요 후보의 당사자 구조화 목록 추출 (미리보기 드롭다운 및 개별 양해 카드용, §5c-9-2·§5c-9-3) */
export function getCoordinationParties(coordination?: CandidateCoordination): CoordinationParty[] {
  if (!coordination) return [];
  const map = new Map<
    string,
    { name: string; roles: string[]; roleType: "group_teacher" | "counterpart" | "venue_occupant" }
  >();

  const add = (
    email: string | undefined,
    name: string | undefined,
    role: string,
    roleType: "group_teacher" | "counterpart" | "venue_occupant"
  ) => {
    if (!name) return;
    const key = (email || "").trim().toLowerCase() || `name:${name}`;
    const entry = map.get(key) || { name, roles: [], roleType };
    if (!entry.roles.includes(role)) entry.roles.push(role);
    if (roleType === "group_teacher") {
      entry.roleType = "group_teacher";
    } else if (roleType === "counterpart" && entry.roleType !== "group_teacher") {
      entry.roleType = "counterpart";
    }
    map.set(key, entry);
  };

  if (coordination.simul?.steps) {
    for (const step of coordination.simul.steps) {
      if (step.groupLesson?.teacherName) {
        add(
          step.groupLesson.teacherEmail,
          step.groupLesson.teacherName,
          `${step.classNum}반 ${step.groupLesson.subjectName}`,
          "group_teacher"
        );
      }
      if (step.counterpart?.teacherName) {
        add(
          step.counterpart.teacherEmail,
          step.counterpart.teacherName,
          `${step.classNum}반 ${step.counterpart.subjectName}`,
          "counterpart"
        );
      }
    }
  }

  if (coordination.conflicts) {
    for (const c of coordination.conflicts) {
      for (const o of c.occupants) {
        add(
          o.teacherEmail,
          o.teacherName,
          "장소 겹침",
          "venue_occupant"
        );
      }
    }
  }

  return Array.from(map.entries()).map(([email, item]) => {
    const rawEmail = email.startsWith("name:") ? "" : email;
    return {
      email: rawEmail,
      name: item.name,
      label: `${item.name} 선생님 (${item.roles.join(" · ")})`,
      role: item.roleType,
      roleType: item.roleType,
    };
  });
}




// ═════════════════════════════════════════════════════════════
// 참조 학기 우선순위 (development_roadmap §2, 2026-08-17 사용자 확정)
// ═════════════════════════════════════════════════════════════

/**
 * 대상 학기의 참조 학기 후보를 우선순위대로 나열한다 — **단일 소재지**.
 *
 * 교육과정은 1년 주기라 과목 구성은 전 학기보다 **전년도 같은 학기**와 닮는다
 * (사용자 원문: "교육과정이 같다면 사실 아예 과목명은 다 같을 거야").
 * ① 전년도 같은 학기(전전학기) → ② 나머지 과거 학기 최신순. 미래 학기·대상 자신은 제외.
 * 데이터 유무 검사는 호출자 몫이다(그리드·사전 등 요구 데이터가 소비처마다 다름) —
 * 이 함수는 순서만 정한다. 전전학기 데이터가 없으면 자연히 다음 후보(전 학기)로 넘어간다.
 */
export function rankReferenceTerms(targetTermId: string, availableTermIds: string[]): string[] {
  const m = (targetTermId || "").match(/^(\d{4})-([12])$/);
  if (!m) return [];
  const year = Number(m[1]);
  const semester = Number(m[2]);
  const ordinal = (id: string) => {
    const mm = id.match(/^(\d{4})-([12])$/);
    return mm ? Number(mm[1]) * 2 + Number(mm[2]) : NaN;
  };
  const targetOrd = ordinal(targetTermId);
  const past = [...new Set(availableTermIds)]
    .filter((id) => Number.isFinite(ordinal(id)) && ordinal(id) < targetOrd)
    .sort((a, b) => ordinal(b) - ordinal(a)); // 최신 과거부터
  const sameSeasonPrevYear = `${year - 1}-${semester}`;
  return [
    ...past.filter((id) => id === sameSeasonPrevYear),
    ...past.filter((id) => id !== sameSeasonPrevYear),
  ];
}
