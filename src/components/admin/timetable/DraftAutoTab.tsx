"use client";

/**
 * Phase 9c-D: 자동 작성 탭 (phase9c_d_spec §3 · §4 · §5 · §6)
 *
 * Phase D-2 구현:
 *  - 초안 목록 및 솔버 연동 (Phase D-1)
 *  - 3면 편집기 UX (학급 그리드, 교사 파생 그리드, 미배정 목록)
 *  - 셀 이동/교환 UX + What-if 검증 미리보기
 *  - 연쇄 영향 다이얼로그 (하드 위반 발생 시 [적용] 버튼 비활성화 차단 - 컴시간 §8-다)
 *  - draft_op (409 Conflict 관문), draft_undo (opCursor-1), draft_redo (opCursor+1)
 *  - 고정 밴드 셀(동시수업 simul) 수동 이동 차단 🔒
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  TimetableDraft,
  TimetableConstraintModel,
  ClassGrid,
  BaseRevisionOp,
  TimetableAuditReport,
  HardViolation,
  TimetableDraftUnplaced,
  TimetableCell,
  TimetableLesson,
  TermPenaltyDetail,
  HoursPlanSummary,
  SoftPenaltyCode,
  ChainStep,
  TrayEntry,
} from "@/lib/timetable/types";
import {
  evaluateMoveCandidates,
  evaluateHeldCandidates,
  type MoveCandidate,
  type MoveCandidatesResult,
} from "@/lib/timetable/moveCandidates";
import type { BlankCompileIssue } from "@/lib/timetable/solver";
import { solveTimetableInWorker, SolverDone, SolverRun } from "@/lib/timetable/solverClient";
import { resolveUnplacedTarget } from "@/lib/timetable/unplaced";
import {
  type LookaheadLine,
  type LookaheadResult,
  type LookaheadTarget,
} from "@/lib/timetable/lookahead";
import {
  searchLookaheadInWorker,
  type LookaheadRun,
} from "@/lib/timetable/lookaheadClient";
import {
  checkPlaceholderOp,
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  findPlaceholderLesson,
  hardViolationKey,
  validateTimetable,
} from "@/lib/timetable/validate";
import { applyRevisionOps, cloneClassGrids, deriveTray } from "@/lib/timetable/utils";
import { buildSimulMatcher } from "@/lib/timetable/simul";
import { HARD_CODE_LABELS, SOFT_CODE_LABELS } from "@/lib/timetable/labels";
import { HistoryMiniGrid } from "./MiniGrid";
import { getClientCache } from "@/lib/cache/clientCache";
import { resolveDisplayName } from "@/lib/org/displayName";
import { buildGwsNameMap } from "@/lib/org/roster";

interface DraftAutoTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
  isDraftTerm?: boolean;
}

const DAYS = ["월", "화", "수", "목", "금"];

// ── 유틸 ──
/**
 * 진행률에 뜨는 단계 이름을 사람 말로 (2026-08-21).
 * 솔버는 단계를 `greedy`·`ejection`·`local`이라는 **영어 내부 이름**으로 알려 주고,
 * 그것이 그대로 화면에 찍히고 있었다. 여러 시드로 돌 때는 앞에 「시드 2 (2/3) 」가
 * 붙으므로 문자열을 통째로 바꾸지 않고 **단어만 치환**한다.
 * 솔버 쪽 이름은 안 건드린다 — 로그·자가 테스트가 그 이름을 쓴다.
 */
const PHASE_LABELS: Record<string, string> = {
  greedy: "빈자리 채우는 중",
  ejection: "막힌 수업 밀어내는 중",
  local: "더 나은 자리 찾는 중",
};
function phaseLabel(phase: string): string {
  let out = phase;
  for (const [en, ko] of Object.entries(PHASE_LABELS)) {
    out = out.replace(new RegExp(`\\b${en}\\b`, "g"), ko);
  }
  return out;
}

function hardBadgeColor(n: number) {
  return n === 0 ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-red-100 text-red-800 border-red-300";
}
function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 초안 그리드에서 특정 교사의 주간 시간표 파생 (클라이언트 파생 — spec §4) */
function synthesizeTeacherGrid(
  grids: ClassGrid[],
  teacherEmail: string,
  maxPeriod: number
): { day: number; period: number; grade: number; classNum: number; subjectName: string }[] {
  if (!teacherEmail) return [];
  const target = teacherEmail.trim().toLowerCase();
  const result: { day: number; period: number; grade: number; classNum: number; subjectName: string }[] = [];

  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const matches = (lesson.teachers || []).some(
          (t) => (t.email || "").trim().toLowerCase() === target
        );
        if (matches) {
          result.push({
            day: cell.day,
            period: cell.period,
            grade: grid.grade,
            classNum: grid.classNum,
            subjectName: lesson.subjectName,
          });
        }
      }
    }
  }
  return result;
}



interface SolverErrorInfo {
  message: string;
  isChunkError?: boolean;
}

/** 워커 스크립트 / 동적 청크 로드 실패 여부 감지 (배포 직후 옛 버전 페이지 등) */
function isWorkerChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  return (
    msg.includes("networkerror") ||
    msg.includes("chunkloaderror") ||
    msg.includes("loading chunk") ||
    msg.includes("failed to fetch") ||
    msg.includes("importscripts") ||
    msg.includes("dynamically imported module") ||
    msg.includes("failed to load script") ||
    msg.includes("error loading worker") ||
    msg.includes("workerglobalscope") ||
    name.includes("chunkloaderror") ||
    name.includes("networkerror")
  );
}

export default function DraftAutoTab({
  activeTermId,
  periodsPerDay = 7,
  isDraftTerm = false,
}: DraftAutoTabProps) {
  // ── 목록 상태 ──
  const [drafts, setDrafts] = useState<TimetableDraft[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── 시수 계획 상태 (phase9c_i_spec §6·§7) ──
  const [plans, setPlans] = useState<HoursPlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [hasBaseGrids, setHasBaseGrids] = useState<boolean | null>(null);

  // ── 확인 화면 (Preflight) 상태 (phase9c_i_spec §6-2·§7) ──
  const [preflightModalOpen, setPreflightModalOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightData, setPreflightData] = useState<{
    model: TimetableConstraintModel;
    teacherNames: Record<string, string>;
    subjectShorts: Record<string, string>;
    issues: BlankCompileIssue[];
    stats: {
      classCount: number;
      rowCount: number;
      totalHours: number;
      fixedSlotCount: number;
      droppedVirtual: number;
      cohortMissingGrades: number[];
      overrideSkips?: Array<{ grade: number; overrideId: string; label: string }>;
    };
    planLabel: string;
    termId: string;
  } | null>(null);

  // ── 솔버 실행 상태 ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [solverError, setSolverError] = useState<SolverErrorInfo | null>(null);
  const runRef = useRef<SolverRun | null>(null);

  // ── 초안 편집기 상태 ──
  const [openDraft, setOpenDraft] = useState<{
    meta: TimetableDraft;
    baseGrids: ClassGrid[];
    currentGrids: ClassGrid[];
    model: TimetableConstraintModel;
    report: TimetableAuditReport;
  } | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // 뷰어 및 교사 선택
  const [viewGrade, setViewGrade] = useState(1);
  const [viewClass, setViewClass] = useState(1);
  const [selectedTeacherEmail, setSelectedTeacherEmail] = useState<string | null>(null);
  // 📌 고정 토글 상태 (스펙 §2-2: 고정 시 hover 연동 무시, 명시적 선택으로만 변경)
  const [isClassPinned, setIsClassPinned] = useState(false);
  const [isTeacherPinned, setIsTeacherPinned] = useState(false);

  // 추가 고정 시간표 패널 (스펙 §2-2: 최대 2개)
  const [extraPanels, setExtraPanels] = useState<
    {
      id: string;
      type: "class" | "teacher";
      grade: number;
      classNum: number;
      teacherEmail: string;
    }[]
  >([]);
  // GWS 이름 맵 — 렌더 중 캐시 직독 금지 원칙(AGENTS 「사람 이름 표시 원칙」)대로 마운트 시 state로 옮긴다.
  // 캐시가 비어 있어도 추가 조회는 안 한다 — 초안 그리드의 수업에 교사 이름이 이미 박혀 있어
  // 그쪽 폴백으로 충분하다 (읽기량: 추가 0건).
  const [gwsUsers, setGwsUsers] = useState<unknown[]>([]);
  useEffect(() => {
    const cached = getClientCache("users:all");
    if (Array.isArray(cached) && cached.length > 0) setGwsUsers(cached);
  }, []);
  const gwsNameMap = useMemo(() => buildGwsNameMap(gwsUsers), [gwsUsers]);

  // F-1 위반·감점 상세 패널 접힘/펼침 상태
  const [showHardDetails, setShowHardDetails] = useState(false);
  const [showSoftDetails, setShowSoftDetails] = useState(false);

  // 미배정 배정 모드 상태
  const [selectedUnplaced, setSelectedUnplaced] = useState<TimetableDraftUnplaced | null>(null);

  // 연쇄 영향 다이얼로그 (Impact Modal) 상태
  const [proposedOp, setProposedOp] = useState<BaseRevisionOp | null>(null);
  const [impactAnalysis, setImpactAnalysis] = useState<{
    newHards: HardViolation[];
    oldSoftTotal: number;
    newSoftTotal: number;
    deltaScore: number;
    opDescription: string;
  } | null>(null);
  const [savingOp, setSavingOp] = useState(false);
  const [opApiError, setOpApiError] = useState<string | null>(null);

  // ── 동시수업 밴드 판정 matcher (솔버 산출 그리드 스탬프 부재 방어) ──
  const simulMatcher = useMemo(
    () =>
      openDraft?.model?.simulGroups
        ? buildSimulMatcher(openDraft.model.simulGroups, openDraft.model.subjects)
        : () => null,
    [openDraft?.model?.simulGroups, openDraft?.model?.subjects]
  );

  const getSimulLabel = (grade: number, classNum: number, day: number, period: number, lesson?: TimetableLesson | null) => {
    if (!lesson) return null;
    if (lesson.simul) return lesson.simul;
    return simulMatcher(grade, classNum, day, period, lesson.subjectName);
  };

  // 작업기록 모달 상태
  const [showOpsHistory, setShowOpsHistory] = useState(false);

  // ── 수읽기 엔진 (Lookahead L1) 상태 — timetable_lookahead_spec §3·§4 ──
  /** 현재 [해결안 찾기]가 열려 있는 감점 항목 */
  const [activeFindDetail, setActiveFindDetail] = useState<TermPenaltyDetail | null>(null);
  /** 수읽기 엔진 탐색 결과 (기보 목록) */
  const [lookaheadResult, setLookaheadResult] = useState<LookaheadResult | null>(null);
  /** 탐색 중 여부 */
  const [findingFix, setFindingFix] = useState(false);
  /** 더 깊이 읽기(예산 3배) 여부 */
  const [isDeepSearch, setIsDeepSearch] = useState(false);
  /** 수읽기 탐색 실시간 진행 상황 (읽은 수, 예산) */
  const [lookaheadProgress, setLookaheadProgress] = useState<{ evaluated: number; budget: number } | null>(null);
  /** 수읽기 워커 취소용 ref */
  const lookaheadRunRef = useRef<LookaheadRun | null>(null);
  /** 수읽기 워커 청크 로드 오류 상태 */
  const [lookaheadChunkError, setLookaheadChunkError] = useState(false);

  // ── 직접 조정 모드 상태 (timetable_manual_move_spec §2 · §4 M1) ──
  const [manualMode, setManualMode] = useState(false);
  const [manualStartScore, setManualStartScore] = useState<number | null>(null);
  const [isLgScreen, setIsLgScreen] = useState(true);

  useEffect(() => {
    const checkWidth = () => {
      const isLg = typeof window !== "undefined" && window.innerWidth >= 1024;
      setIsLgScreen(isLg);
      if (!isLg) {
        setManualMode((prev) => {
          if (prev) {
            setBlockedBubble({
              message: "화면이 좁아져 직접 조정과 시간표 추가를 쓸 수 없습니다. 창을 넓히면 다시 쓸 수 있어요.",
            });
          }
          return false;
        });
      }
    };
    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);
  const [pickedSlot, setPickedSlot] = useState<{
    grade: number;
    classNum: number;
    day: number;
    period: number;
    lesson: TimetableLesson;
  } | null>(null);
  const [candidatesResult, setCandidatesResult] = useState<MoveCandidatesResult | null>(null);
  const [blockedBubble, setBlockedBubble] = useState<{
    day?: number;
    period?: number;
    message: string;
  } | null>(null);

  // ── 직접 조정 M2 상태 (연쇄·잠깐 빼두기 — 스펙 §2-4·§2-5) ──
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([]);
  const [chainStartGrids, setChainStartGrids] = useState<ClassGrid[] | null>(null);
  const [heldParkId, setHeldParkId] = useState<string | null>(null);
  const [selectedParkedEntry, setSelectedParkedEntry] = useState<TrayEntry | null>(null);

  // ── 직접 조정 D&D 드래그 앤 드롭 상태 ──
  const [dragSource, setDragSource] = useState<
    | {
        type: "cell";
        grade: number;
        classNum: number;
        day: number;
        period: number;
        lesson: TimetableLesson;
      }
    | {
        type: "tray";
        entry: TrayEntry;
      }
    | {
        type: "unplaced";
        unplaced: TimetableDraftUnplaced;
      }
    | null
  >(null);
  const [isTrayDragOver, setIsTrayDragOver] = useState(false);
  const [dragOverCell, setDragOverCell] = useState<{ day: number; period: number } | null>(null);

  // 트레이 (op 재생의 파생값)
  const currentTray = useMemo(() => {
    if (!openDraft) return [];
    return deriveTray(openDraft.baseGrids, openDraft.meta.ops.slice(0, openDraft.meta.opCursor));
  }, [openDraft]);

  // Esc 키 입력 시 집기 해제 / 연쇄 취소 / 빼둔 수업·미배정 선택 해제 (스펙 §2-3·§2-4)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedUnplaced) {
          setSelectedUnplaced(null);
          setCandidatesResult(null);
        }
        if (selectedParkedEntry) {
          setSelectedParkedEntry(null);
          setCandidatesResult(null);
        }
        if (chainSteps.length > 0 && chainStartGrids) {
          setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
          setChainSteps([]);
          setChainStartGrids(null);
          setHeldParkId(null);
        }
        if (pickedSlot) {
          setPickedSlot(null);
          setHeldParkId(null);
          setCandidatesResult(null);
          setBlockedBubble(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pickedSlot, chainSteps, chainStartGrids, selectedParkedEntry, selectedUnplaced]);

  // 감점 증가 사유 표시 문구 포맷팅 (노랑 후보 말풍선용)
  const formatWorseReasons = (worseByCode?: Partial<Record<SoftPenaltyCode, number>>): string => {
    if (!worseByCode) return "";
    const parts: string[] = [];
    for (const [code, delta] of Object.entries(worseByCode)) {
      if (!delta || delta <= 0) continue;
      const label = SOFT_CODE_LABELS[code as SoftPenaltyCode] || code;
      parts.push(`${label} (+${delta}점)`);
    }
    return parts.join(", ");
  };

  // ── 감점 항목 클릭 시 그리드 즉시 세팅 및 요일 하이라이트 (과제 P) ──
  const classGridRef = useRef<HTMLDivElement>(null);
  const teacherGridRef = useRef<HTMLDivElement>(null);
  const [highlightDay, setHighlightDay] = useState<{ day: number; target: "class" | "teacher" } | null>(null);
  const highlightTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handlePenaltyDetailClick = (item: TermPenaltyDetail) => {
    if (item.scope === "teacher") {
      // 1. 교사 축 항목: 교사 주간 시간표 패널을 그 교사(item.key = 이메일)로 즉시 전환
      setSelectedTeacherEmail(item.key);
      if (item.day) {
        setHighlightDay({ day: item.day, target: "teacher" });
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightDay(null), 2000);
      }
      teacherGridRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (item.scope === "class") {
      // 2. 학급 축 항목: 학년·반 선택을 그 학급(item.key = "학년-반")으로 즉시 전환
      const parts = item.key.split("-");
      const g = Number(parts[0]);
      const c = Number(parts[1]);
      if (!isNaN(g) && !isNaN(c)) {
        setViewGrade(g);
        setViewClass(c);
      }
      if (item.day) {
        setHighlightDay({ day: item.day, target: "class" });
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setHighlightDay(null), 2000);
      }
      classGridRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  // 현재 초안에 배정된 모든 교사 목록 (이름 가나다순 — 우측 교사 패널 드롭다운용)
  const allDraftTeachers = useMemo(() => {
    if (!openDraft) return [];
    const map = new Map<string, string>();
    for (const g of openDraft.currentGrids) {
      for (const c of g.cells || []) {
        for (const l of c.lessons || []) {
          for (const t of l.teachers || []) {
            const email = (t.email || "").trim().toLowerCase();
            if (!email) continue;
            if (!map.has(email)) {
              const name = resolveDisplayName(
                email,
                undefined,
                gwsNameMap.get(email) || t.name?.trim() || undefined
              ).name;
              map.set(email, name);
            }
          }
        }
      }
    }
    return Array.from(map.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [openDraft, gwsNameMap]);

  // ── 작업기록 항목별 시점 판(board) 누적 재생 및 셀/수업 상세 추출 (과제 W, M3) ──
  const historyDetails = useMemo(() => {
    if (!openDraft?.baseGrids || !openDraft.meta?.ops) return [];
    const currentBoard = cloneClassGrids(openDraft.baseGrids);
    const parkMap = new Map<string, TimetableLesson>();
    const result: Array<{
      op: BaseRevisionOp;
      idx: number;
      isCurrent: boolean;
      isApplied: boolean;
      title: string;
      gridCells: Array<{ day: number; period: number; color?: string; label?: string }>;
      lessonNode: React.ReactNode;
      chainSteps?: Array<{
        title: string;
        gridCells: Array<{ day: number; period: number; color?: string; label?: string }>;
        lessonNode: React.ReactNode;
      }>;
    }> = [];

    for (let idx = 0; idx < openDraft.meta.ops.length; idx++) {
      const op = openDraft.meta.ops[idx];
      const isCurrent = idx === openDraft.meta.opCursor - 1;
      const isApplied = idx < openDraft.meta.opCursor;

      if (op.type === "swap") {
        const g = currentBoard.find((x) => x.grade === op.grade && x.classNum === op.classNum);
        const c1 = g?.cells?.find((c) => c.day === op.a.day && c.period === op.a.period);
        const c2 = g?.cells?.find((c) => c.day === op.b.day && c.period === op.b.period);
        const l1 = c1?.lessons?.[0];
        const l2 = c2?.lessons?.[0];

        const t1 = l1?.teachers?.map((t) => t.name).join(", ") || (l1 ? "교사 미상" : "");
        const t2 = l2?.teachers?.map((t) => t.name).join(", ") || (l2 ? "교사 미상" : "");
        const s1 = l1?.subjectName || "빈 칸";
        const s2 = l2?.subjectName || "빈 칸";

        const name1 = t1 ? `${s1}(${t1})` : s1;
        const name2 = t2 ? `${s2}(${t2})` : s2;

        result.push({
          op,
          idx,
          isCurrent,
          isApplied,
          title: `맞교환/이동 (${op.grade}학년 ${op.classNum}반)`,
          gridCells: [
            { day: op.a.day, period: op.a.period, color: "bg-indigo-600 text-white", label: "1" },
            { day: op.b.day, period: op.b.period, color: "bg-amber-600 text-white", label: "2" },
          ],
          lessonNode: (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="font-bold text-indigo-900 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                ① {name1}
              </span>
              <span className="text-gray-400 font-bold">↔</span>
              <span className="font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                ② {name2}
              </span>
            </div>
          ),
        });
        applyRevisionOps(currentBoard, [op]);
      } else if (op.type === "edit_cell") {
        const g = currentBoard.find((x) => x.grade === op.grade && x.classNum === op.classNum);
        const c = g?.cells?.find((cell) => cell.day === op.day && cell.period === op.period);
        const beforeL = c?.lessons?.[0];
        const afterL = op.lessons?.[0];

        const tBefore = beforeL?.teachers?.map((t) => t.name).join(", ") || (beforeL ? "교사 미상" : "");
        const tAfter = afterL?.teachers?.map((t) => t.name).join(", ") || (afterL ? "교사 미상" : "");
        const sBefore = beforeL?.subjectName || "비어 있던 칸";
        const sAfter = afterL?.subjectName || "빈 칸";

        const nameBefore = tBefore ? `${sBefore}(${tBefore})` : sBefore;
        const nameAfter = tAfter ? `${sAfter}(${tAfter})` : sAfter;

        result.push({
          op,
          idx,
          isCurrent,
          isApplied,
          title: `수업 수정 (${op.grade}학년 ${op.classNum}반)`,
          gridCells: [
            { day: op.day, period: op.period, color: "bg-indigo-600 text-white", label: "✏" },
          ],
          lessonNode: (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded line-through">
                {nameBefore}
              </span>
              <span className="text-gray-400 font-bold">→</span>
              <span className="font-bold text-indigo-900 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                {nameAfter}
              </span>
            </div>
          ),
        });
        applyRevisionOps(currentBoard, [op]);
      } else if (op.type === "park") {
        const g = currentBoard.find((x) => x.grade === op.grade && x.classNum === op.classNum);
        const c = g?.cells?.find((cell) => cell.day === op.day && cell.period === op.period);
        const l = c?.lessons?.[0];
        if (l) {
          parkMap.set(op.parkId, l);
        }
        const t = l?.teachers?.map((tch) => tch.name).join(", ") || (l ? "교사 미상" : "");
        const s = l?.subjectName || "수업";
        const name = t ? `${s}(${t})` : s;

        result.push({
          op,
          idx,
          isCurrent,
          isApplied,
          title: `잠깐 빼두기 (${op.grade}학년 ${op.classNum}반)`,
          gridCells: [
            { day: op.day, period: op.period, color: "bg-amber-600 text-white", label: "P" },
          ],
          lessonNode: (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                빼둔 수업: {name}
              </span>
            </div>
          ),
        });
        applyRevisionOps(currentBoard, [op]);
      } else if (op.type === "unpark") {
        const l = parkMap.get(op.parkId);
        const t = l?.teachers?.map((tch) => tch.name).join(", ") || (l ? "교사 미상" : "");
        const s = l?.subjectName || "수업";
        const name = t ? `${s}(${t})` : s;

        result.push({
          op,
          idx,
          isCurrent,
          isApplied,
          title: `빼둔 수업 되돌리기 (${op.grade}학년 ${op.classNum}반)`,
          gridCells: [
            { day: op.day, period: op.period, color: "bg-emerald-600 text-white", label: "U" },
          ],
          lessonNode: (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="font-bold text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                되돌린 수업: {name}
              </span>
            </div>
          ),
        });
        applyRevisionOps(currentBoard, [op]);
      } else if (op.type === "chain") {
        const allGridCells: Array<{ day: number; period: number; color?: string; label?: string }> = [];
        const stepDetails: Array<{
          title: string;
          gridCells: Array<{ day: number; period: number; color?: string; label?: string }>;
          lessonNode: React.ReactNode;
        }> = [];

        const subBoard = cloneClassGrids(currentBoard);
        const subParkMap = new Map<string, TimetableLesson>(parkMap);

        for (let si = 0; si < op.steps.length; si++) {
          const step = op.steps[si];
          if (step.kind === "swap") {
            const g = subBoard.find((x) => x.grade === step.grade && x.classNum === step.classNum);
            const c1 = g?.cells?.find((c) => c.day === step.a.day && c.period === step.a.period);
            const c2 = g?.cells?.find((c) => c.day === step.b.day && c.period === step.b.period);
            const l1 = c1?.lessons?.[0];
            const l2 = c2?.lessons?.[0];
            const t1 = l1?.teachers?.map((t) => t.name).join(", ") || (l1 ? "교사 미상" : "");
            const t2 = l2?.teachers?.map((t) => t.name).join(", ") || (l2 ? "교사 미상" : "");
            const s1 = l1?.subjectName || "빈 칸";
            const s2 = l2?.subjectName || "빈 칸";
            const name1 = t1 ? `${s1}(${t1})` : s1;
            const name2 = t2 ? `${s2}(${t2})` : s2;

            const stepCells = [
              { day: step.a.day, period: step.a.period, color: "bg-indigo-600 text-white", label: `${si + 1}a` },
              { day: step.b.day, period: step.b.period, color: "bg-amber-600 text-white", label: `${si + 1}b` },
            ];
            allGridCells.push(...stepCells);

            stepDetails.push({
              title: `${si + 1}수: 맞교환 (${step.grade}-${step.classNum}반)`,
              gridCells: stepCells,
              lessonNode: (
                <div className="flex items-center gap-1 flex-wrap text-[11px]">
                  <span className="font-bold text-indigo-900 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-200">
                    {name1}
                  </span>
                  <span className="text-gray-400 font-bold">↔</span>
                  <span className="font-bold text-amber-900 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                    {name2}
                  </span>
                </div>
              ),
            });
            applyRevisionOps(subBoard, [{
              type: "swap",
              grade: step.grade,
              classNum: step.classNum,
              a: step.a,
              b: step.b,
            }]);
          } else if (step.kind === "park") {
            const g = subBoard.find((x) => x.grade === step.grade && x.classNum === step.classNum);
            const c = g?.cells?.find((cell) => cell.day === step.day && cell.period === step.period);
            const l = c?.lessons?.[0];
            if (l) subParkMap.set(step.parkId, l);
            const t = l?.teachers?.map((tch) => tch.name).join(", ") || (l ? "교사 미상" : "");
            const s = l?.subjectName || "수업";
            const name = t ? `${s}(${t})` : s;
            const stepCells = [{ day: step.day, period: step.period, color: "bg-amber-600 text-white", label: "P" }];
            allGridCells.push(...stepCells);
            stepDetails.push({
              title: `${si + 1}수: 잠깐 빼두기 (${step.grade}-${step.classNum}반)`,
              gridCells: stepCells,
              lessonNode: (
                <div className="text-[11px] font-bold text-amber-900 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                  빼둔 수업: {name}
                </div>
              ),
            });
            applyRevisionOps(subBoard, [{
              type: "park",
              parkId: step.parkId,
              grade: step.grade,
              classNum: step.classNum,
              day: step.day,
              period: step.period,
            }]);
          } else if (step.kind === "unpark") {
            const l = subParkMap.get(step.parkId);
            const t = l?.teachers?.map((tch) => tch.name).join(", ") || (l ? "교사 미상" : "");
            const s = l?.subjectName || "수업";
            const name = t ? `${s}(${t})` : s;
            const stepCells = [{ day: step.day, period: step.period, color: "bg-emerald-600 text-white", label: "U" }];
            allGridCells.push(...stepCells);
            stepDetails.push({
              title: `${si + 1}수: 되돌리기 (${step.grade}-${step.classNum}반)`,
              gridCells: stepCells,
              lessonNode: (
                <div className="text-[11px] font-bold text-emerald-900 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200">
                  되돌린 수업: {name}
                </div>
              ),
            });
            applyRevisionOps(subBoard, [{
              type: "unpark",
              parkId: step.parkId,
              grade: step.grade,
              classNum: step.classNum,
              day: step.day,
              period: step.period,
            }]);
          }
        }

        result.push({
          op,
          idx,
          isCurrent,
          isApplied,
          title: `연쇄 조정 (${op.steps.length}수)`,
          gridCells: allGridCells,
          chainSteps: stepDetails,
          lessonNode: (
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-indigo-900">
                총 {op.steps.length}단계 연쇄 이동
              </div>
              <div className="space-y-1 pl-1 border-l-2 border-indigo-200">
                {stepDetails.map((st, sti) => (
                  <div key={sti} className="space-y-0.5">
                    <div className="text-[10px] font-bold text-gray-500">{st.title}</div>
                    {st.lessonNode}
                  </div>
                ))}
              </div>
            </div>
          ),
        });
        applyRevisionOps(currentBoard, [op]);
      } else if (op.type === "swap_pair") {
        const allGridCells: Array<{ day: number; period: number; color?: string; label?: string }> = [
          { day: op.a.day, period: op.a.period, color: "bg-indigo-600 text-white", label: "1" },
          { day: op.b.day, period: op.b.period, color: "bg-amber-600 text-white", label: "2" },
        ];
        const pairNodes: React.ReactNode[] = [];

        for (let pi = 0; pi < op.classes.length; pi++) {
          const cls = op.classes[pi];
          const g = currentBoard.find((x) => x.grade === cls.grade && x.classNum === cls.classNum);
          const c1 = g?.cells?.find((c) => c.day === op.a.day && c.period === op.a.period);
          const c2 = g?.cells?.find((c) => c.day === op.b.day && c.period === op.b.period);
          const l1 = c1?.lessons?.[0];
          const l2 = c2?.lessons?.[0];
          const t1 = l1?.teachers?.map((t) => t.name).join(", ") || (l1 ? "교사 미상" : "");
          const t2 = l2?.teachers?.map((t) => t.name).join(", ") || (l2 ? "교사 미상" : "");
          const s1 = l1?.subjectName || "빈 칸";
          const s2 = l2?.subjectName || "빈 칸";
          const name1 = t1 ? `${s1}(${t1})` : s1;
          const name2 = t2 ? `${s2}(${t2})` : s2;

          pairNodes.push(
            <div key={pi} className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="font-semibold text-gray-700">{cls.grade}-{cls.classNum}반:</span>
              <span className="font-bold text-indigo-900 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-200">
                {name1}
              </span>
              <span className="text-gray-400 font-bold">↔</span>
              <span className="font-bold text-amber-900 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                {name2}
              </span>
            </div>
          );
        }

        result.push({
          op,
          idx,
          isCurrent,
          isApplied,
          title: `학급 간 교환 (${op.classes.map((c) => `${c.grade}-${c.classNum}반`).join(" · ")})`,
          gridCells: allGridCells,
          lessonNode: <div className="space-y-1">{pairNodes}</div>,
        });
        applyRevisionOps(currentBoard, [op]);
      } else {
        applyRevisionOps(currentBoard, [op]);
      }
    }
    return result;
  }, [openDraft?.baseGrids, openDraft?.meta?.ops, openDraft?.meta?.opCursor]);

  // 초안 전환·닫기 시 직접 조정 상태 초기화
  const openDraftId = openDraft?.meta.id;
  useEffect(() => {
    setManualMode(false);
    setManualStartScore(null);
    setPickedSlot(null);
    setCandidatesResult(null);
    setChainSteps([]);
    setChainStartGrids(null);
    setHeldParkId(null);
    setSelectedParkedEntry(null);
    setBlockedBubble(null);
  }, [openDraftId]);

  // 해결안 결과는 **그리드가 바뀌는 순간 무효**다 — 카드에 적힌 "39점 → 38점"은 계산 당시
  // 그리드 기준이고, 적용·실행취소·다시실행 뒤에는 배지 점수와 어긋난다. 남은 후보들도 이전
  // 상태에서 채점된 것이라 [미리보기]가 카드와 다른 값을 낼 수 있다(스펙 §6 — 엔진과 화면이
  // 다른 값을 말하면 신뢰가 무너진다). AI 결과와 달리 초안 내 조정에서도 유지하지 않는 이유다.
  // report 참조는 draft_op·undo·redo·초안 전환 때마다 새 객체로 갈리므로 이 하나로 전부 덮인다.
  const openDraftReport = openDraft?.report;
  useEffect(() => {
    setActiveFindDetail(null);
    setLookaheadResult(null);
    setFindingFix(false);
    setIsDeepSearch(false);
    setPickedSlot(null);
    setCandidatesResult(null);
    setChainSteps([]);
    setChainStartGrids(null);
    setHeldParkId(null);
    setSelectedParkedEntry(null);
  }, [openDraftReport]);

  // ── 목록 로드 ──
  const fetchDrafts = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "목록을 불러오지 못했습니다.");
      setDrafts(data.drafts || []);
    } catch (err: any) {
      setListError(err.message);
    } finally {
      setLoadingList(false);
    }
  };

  // ── 시수 계획 목록 및 기초 시간표 존재 여부 조회 ──
  const fetchPlans = async () => {
    setLoadingPlans(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hours_plan_list" }),
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.plans)) {
        const filtered = data.plans.filter((p: HoursPlanSummary) => p.targetTermId === activeTermId);
        setPlans(filtered);
        if (filtered.length > 0) {
          setSelectedPlanId((prev) => (filtered.some((p: HoursPlanSummary) => p.id === prev) ? prev : filtered[0].id));
        } else {
          setSelectedPlanId("");
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingPlans(false);
    }
  };

  const checkBaseGrids = async () => {
    if (!activeTermId) {
      setHasBaseGrids(false);
      return;
    }
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_model", termId: activeTermId }),
      });
      const data = await res.json();
      const count = Array.isArray(data.baseGrids) ? data.baseGrids.length : 0;
      setHasBaseGrids(count > 0);
    } catch {
      setHasBaseGrids(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
    fetchPlans();
    checkBaseGrids();
  }, [activeTermId]);

  // ── 시수 계획 백지 편성 사전 확인 (phase9c_i_spec §6-2) ──
  const handlePreflight = async () => {
    if (!selectedPlanId) {
      alert("시수 계획을 먼저 선택해 주세요.");
      return;
    }
    setPreflightLoading(true);
    setSolverError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hours_plan_solve_input", planId: selectedPlanId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "시수 계획 입력 구성에 실패했습니다.");
      }
      // spec §8-4: check termId
      if (data.termId !== activeTermId) {
        throw new Error(`이 계획은 ${data.termId} 학기용입니다. (현재 작업 학기: ${activeTermId || "없음"})`);
      }
      setPreflightData(data);
      setPreflightModalOpen(true);
    } catch (err: any) {
      alert(err.message || "확인 화면을 불러오지 못했습니다.");
    } finally {
      setPreflightLoading(false);
    }
  };

  // ── 시수 계획 기반 솔버 실행 (phase9c_i_spec §6-2) ──
  const handleSolveFromPlan = async () => {
    if (!preflightData) return;
    setPreflightModalOpen(false);
    setSolverError(null);
    setProgress(null);
    setRunning(true);

    const run = solveTimetableInWorker(
      {
        grids: [],
        model: preflightData.model,
        teacherNames: preflightData.teacherNames,
        subjectShorts: preflightData.subjectShorts,
      },
      (phase, done, total) => {
        setProgress({ phase, done, total });
      }
    );
    runRef.current = run;

    let result: SolverDone;
    try {
      result = await run.promise;
    } catch (err: any) {
      if (err.message === "cancelled") {
        setRunning(false);
        setProgress(null);
        return;
      }
      console.error("[솔버 워커 오류]", err);
      if (isWorkerChunkLoadError(err)) {
        setSolverError({
          message: "새 버전이 배포되었습니다 — 페이지를 새로고침한 뒤 다시 실행해 주세요",
          isChunkError: true,
        });
      } else {
        setSolverError({
          message: err.message || "시간표 편성 중 오류가 발생했습니다.",
        });
      }
      setRunning(false);
      return;
    }

    if (!result.grids || result.grids.length === 0) {
      setSolverError({
        message: "짤 수 있는 수업이 없습니다. 시수 계획 및 고정 시간을 확인해 주세요.",
      });
      setRunning(false);
      return;
    }

    try {
      setProgress({ phase: "초안 저장 중...", done: 0, total: 1 });
      const unplaced = (result.unplaced || []).map((u) => ({
        sectionId: u.sectionId,
        label: u.label,
        remaining: u.remaining,
      }));
      const report = result.report;
      const origin = { kind: "solver" as const, seed: result.seed, ranking: result.ranking?.[0]?.seed };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_create",
          termId: preflightData.termId, // spec §8-4: do not use activeTermId!
          draftOrigin: origin,
          draftGrids: result.grids,
          draftUnplaced: unplaced,
          draftReport: report,
          draftHours: preflightData.model.hours,
          draftFixedBlocks: preflightData.model.fixedBlocks,
          draftPlanId: selectedPlanId,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "초안 저장에 실패했습니다.");

      await fetchDrafts();
    } catch (err: any) {
      console.error("[초안 저장 오류]", err);
      if (isWorkerChunkLoadError(err)) {
        setSolverError({
          message: "새 버전이 배포되었습니다 — 페이지를 새로고침한 뒤 다시 실행해 주세요",
          isChunkError: true,
        });
      } else {
        setSolverError({ message: err.message || "초안 저장에 실패했습니다." });
      }
    } finally {
      setRunning(false);
      setProgress(null);
      runRef.current = null;
    }
  };

  const handleCancelSolver = () => {
    runRef.current?.cancel();
    setRunning(false);
    setProgress(null);
    setSolverError(null);
  };

  // ── 현행 복제 ──
  const handleCopy = async () => {
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_create",
          termId: activeTermId,
          draftOrigin: { kind: "copy" },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "복제에 실패했습니다.");
      await fetchDrafts();
    } catch (err: any) {
      alert(`현행 복제 오류: ${err.message}`);
    }
  };

  // ── 초안 열기 (getDraft + model 로드 + validate) ──
  const handleOpen = async (draft: TimetableDraft) => {
    setLoadingDraft(true);
    setDraftError(null);
    setPickedSlot(null);
    setCandidatesResult(null);
    setChainSteps([]);
    setChainStartGrids(null);
    setHeldParkId(null);
    setSelectedParkedEntry(null);
    setSelectedUnplaced(null);
    setBlockedBubble(null);
    try {
      const [getRes, modelRes] = await Promise.all([
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "draft_get", draftId: draft.id }),
        }),
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "draft_model", termId: draft.sourceTermId || activeTermId }),
        }),
      ]);

      const getData = await getRes.json();
      const modelData = await modelRes.json();

      if (!getRes.ok || getData.error) throw new Error(getData.error || "초안을 열지 못했습니다.");
      if (!modelRes.ok || modelData.error) throw new Error(modelData.error || "모델 로드 실패.");

      const meta: TimetableDraft = getData.meta;
      const baseGrids: ClassGrid[] = getData.baseGrids;
      const currentGrids: ClassGrid[] = getData.currentGrids;
      const model: TimetableConstraintModel = modelData.model;

      const gradeDayPeriods = deriveGradeDayPeriods(baseGrids);
      const hours = (getData.hours && getData.hours.length > 0)
        ? getData.hours
        : (meta.hoursSnapshot && meta.hoursSnapshot.length > 0)
        ? meta.hoursSnapshot
        : deriveHoursFromGrids(baseGrids);
      const fullModel = { ...model, gradeDayPeriods, hours };

      const report = validateTimetable(currentGrids, fullModel);

      setOpenDraft({
        meta,
        baseGrids,
        currentGrids,
        model: fullModel,
        report,
      });
      setViewGrade(1);
      setViewClass(1);
    } catch (err: any) {
      setDraftError(err.message || "다시 실행 중 오류가 발생했습니다.");
    } finally {
      setLoadingDraft(false);
    }
  };

  // ── 초안 채택 (draft_adopt, spec §5) ──
  const [adopting, setAdopting] = useState(false);
  const handleAdoptDraft = async () => {
    if (!openDraft || !activeTermId) return;
    const { meta, report } = openDraft;
    if (report.hard.length > 0) {
      alert(`중대 문제가 ${report.hard.length}건 남아 있어 기초시간표로 채택할 수 없습니다. 문제를 먼저 해결해주세요.`);
      return;
    }
    if (currentTray.length > 0) {
      alert(`잠깐 빼둔 수업이 ${currentTray.length}건 남아 있어 기초시간표로 채택할 수 없습니다. 빼둔 수업을 먼저 시간표에 배치해주세요.`);
      return;
    }

    const confirmMsg = `현재 초안(${meta.label})을 '${activeTermId}' 학기의 정식 기초시간표로 채택하시겠습니까?\n\n※ 대상 학기의 기존 기초시간표 그리드가 이 초안의 결과로 전량 교체됩니다.`;
    if (!confirm(confirmMsg)) return;

    setAdopting(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_adopt",
          draftId: meta.id,
          termId: activeTermId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`초안이 ${activeTermId} 학기의 기초시간표로 성공적으로 채택되었습니다 (총 ${data.adoptedGridCount || 0}개 학급).`);
      } else {
        alert(data.error || "채택에 실패했습니다.");
      }
    } catch (err: any) {
      alert(`오류: ${err.message || String(err)}`);
    } finally {
      setAdopting(false);
    }
  };

  // ── 초안 삭제 ──
  const handleDelete = async (draft: TimetableDraft) => {
    if (!confirm(`'${draft.label}' 초안을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId: draft.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "삭제에 실패했습니다.");
      if (openDraft?.meta.id === draft.id) setOpenDraft(null);
      await fetchDrafts();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    }
  };

  // ── Undo / Redo 실행 ──
  const handleUndo = async () => {
    if (!openDraft || openDraft.meta.opCursor <= 0 || loadingDraft || savingOp) return;
    setLoadingDraft(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_undo", draftId: openDraft.meta.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "실행 취소 실패.");
      setOpenDraft({
        meta: data.meta,
        baseGrids: data.baseGrids,
        currentGrids: data.currentGrids,
        model: openDraft.model,
        report: data.report,
      });
    } catch (err: any) {
      alert(`실행 취소 오류: ${err.message}`);
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleRedo = async () => {
    if (!openDraft || openDraft.meta.opCursor >= openDraft.meta.ops.length || loadingDraft || savingOp) return;
    setLoadingDraft(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_redo", draftId: openDraft.meta.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "다시 실행 실패.");
      setOpenDraft({
        meta: data.meta,
        baseGrids: data.baseGrids,
        currentGrids: data.currentGrids,
        model: openDraft.model,
        report: data.report,
      });
    } catch (err: any) {
      alert(`다시 실행 오류: ${err.message}`);
    } finally {
      setLoadingDraft(false);
    }
  };

  // ── 수읽기 엔진 L1 — 해결안 탐색 (timetable_lookahead_spec §2·§3·§4) ──
  const handleFindFix = async (detail: TermPenaltyDetail, deep: boolean = false) => {
    if (!openDraft || savingOp) return;
    // 이전 실행 중인 수읽기 워커 취소
    if (lookaheadRunRef.current) {
      lookaheadRunRef.current.cancel();
      lookaheadRunRef.current = null;
    }
    // 같은 항목 토글 — 객체 동일성으로 판정 (S2·S4 등 동일 code+key+day 중복 방어)
    if (activeFindDetail === detail && !deep) {
      setActiveFindDetail(null);
      setLookaheadResult(null);
      setIsDeepSearch(false);
      setFindingFix(false);
      setLookaheadProgress(null);
      setLookaheadChunkError(false);
      return;
    }
    setActiveFindDetail(detail);
    setLookaheadResult(null);
    setIsDeepSearch(deep);
    setFindingFix(true);
    setLookaheadChunkError(false);

    const { model, currentGrids } = openDraft;
    const target: LookaheadTarget = {
      scope: detail.scope,
      key: detail.key,
      day: detail.day || undefined,
      code: detail.code as SoftPenaltyCode,
    };
    // 「더 깊이 읽기」는 **빔 폭**을 넓힌다 — 예산이 아니다 (2026-08-23 실측).
    //
    // 종전에는 budget만 1500→4500으로 올렸는데 **기보가 전혀 나아지지 않았다**(사용자 실기기).
    // 원인: 빔 탐색은 깊이마다 beamWidth개만 남기므로 **트리 모양이 예산과 무관하게 고정**된다.
    // 예산은 「언제 멈추나」이고 「무엇을 보나」는 빔이 정한다. 실제로 관측된 탐색 수가
    // 1476·1485·1492·1474로 전부 1500 미만이라 **기본 예산조차 다 쓰지 않고 있었다.**
    //
    // 합성 세계 3표적 실측(빔만 바꾸고 나머지 고정):
    //   b4/1500(기본) 2947회 1.6초 delta합 −4.0
    //   b8/6000       7957회 3.1초 delta합 **−6.0**  ← 전 이득이 여기서 난다
    //   b12/6000     11773회 4.2초 delta합 −6.0     (개선 없음, 시간만 +36%)
    //   b24/20000    20059회 7.5초 delta합 −6.0     (개선 없음)
    // b12/6000과 b12/12000의 탐색 수가 **동일(11773)** — 예산이 병목이 아님을 재확증.
    // depth·movesPerNode·picksPerNode 증가도 이득 0이었으므로 건드리지 않는다.
    // 시간이 2배가 되지만 과제 Z에서 워커로 옮겨 **화면은 안 언다.**
    const beamWidth = deep ? 8 : undefined; // undefined = 엔진 기본값 4
    const budget = deep ? 6000 : 1500;
    setLookaheadProgress({ evaluated: 0, budget });

    try {
      const run = searchLookaheadInWorker(
        {
          grids: currentGrids,
          model,
          target,
          ...(beamWidth ? { beamWidth } : {}),
          budget,
        },
        (evaluated, b) => {
          setLookaheadProgress({ evaluated, budget: b });
        }
      );
      lookaheadRunRef.current = run;
      const result = await run.promise;
      lookaheadRunRef.current = null;
      setLookaheadResult(result);
    } catch (err) {
      lookaheadRunRef.current = null;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "cancelled") {
        return;
      }
      if (isWorkerChunkLoadError(err)) {
        setLookaheadChunkError(true);
      } else {
        console.error("Lookahead search error:", err);
      }
    } finally {
      setFindingFix(false);
      setLookaheadProgress(null);
    }
  };

  /** 기보 1수 적용 (한 수씩 밟기 — 기본) */
  const handleApplyLineStep = async (line: LookaheadLine, stepIdx: number = 0) => {
    if (!openDraft || savingOp || stepIdx >= line.ops.length) return;
    const op = line.ops[stepIdx];
    await executeOptimisticOp(op, undefined, undefined, "수읽기 기보 수 적용");
  };

  /** 기보 전체 적용 (M2 chain op로 원자적 적용) */
  const handleApplyLineAll = async (line: LookaheadLine) => {
    if (!openDraft || savingOp || line.ops.length === 0) return;
    if (line.ops.length === 1) {
      await executeOptimisticOp(line.ops[0], undefined, undefined, "수읽기 기보 적용");
      return;
    }
    const chainSteps: ChainStep[] = line.ops.map((op) => {
      if (op.type === "swap") {
        return {
          kind: "swap",
          grade: op.grade,
          classNum: op.classNum,
          a: op.a,
          b: op.b,
        };
      }
      throw new Error("Only swap ops supported in lookahead L1");
    });
    const chainOp: BaseRevisionOp = {
      type: "chain",
      steps: chainSteps,
    };
    await executeOptimisticOp(chainOp, undefined, undefined, "수읽기 기보 전체 적용");
  };

  // ── 셀 이동 / 맞교환 what-if 미리보기 ──
  const analyzeOpImpact = (op: BaseRevisionOp, desc: string) => {
    if (!openDraft) return;
    const { baseGrids, meta, model, report: oldReport, currentGrids } = openDraft;

    // 자리표시(창체·SLAT) 셀 보호 — 모든 편집이 이 함수를 거치므로 여기가 클라이언트 단일 관문.
    // 검사기는 이 종류를 잡을 수 없어(가상 교사는 교사 중복 대상 아님) 연산 자체를 막는다.
    const placeholderBlock = checkPlaceholderOp(currentGrids, op);
    if (placeholderBlock) {
      setBlockedBubble({ message: `🔒 ${placeholderBlock}` });
      return;
    }

    const testOps = [...meta.ops.slice(0, meta.opCursor), op];
    const testGrids = cloneClassGrids(baseGrids);
    applyRevisionOps(testGrids, testOps);
    const testReport = validateTimetable(testGrids, model);

    // 판정 키는 validate.ts의 hardViolationKey 단일 소재지 — 서버 관문(applyDraftOp)과 같은 규약
    const oldHardKeys = new Set(oldReport.hard.map(hardViolationKey));
    const newHards = testReport.hard.filter((h) => !oldHardKeys.has(hardViolationKey(h)));

    const deltaScore = testReport.soft.total - oldReport.soft.total;

    setProposedOp(op);
    setImpactAnalysis({
      newHards,
      oldSoftTotal: oldReport.soft.total,
      newSoftTotal: testReport.soft.total,
      deltaScore,
      opDescription: desc,
    });
    setOpApiError(null);
  };

  // ── 직접 조정: 낙관적 반영 헬퍼 (Task S) ──
  const executeOptimisticOp = async (
    opToSend: BaseRevisionOp,
    updatedUnplacedList?: TimetableDraftUnplaced[],
    onOptimisticSuccess?: () => void,
    errorMessagePrefix: string = "작업"
  ) => {
    if (!openDraft || savingOp) return;

    // 1. Snapshot previous state for rollback
    const prevDraft = openDraft;
    const prevPicked = pickedSlot;
    const prevCand = candidatesResult;
    const prevChainSteps = chainSteps;
    const prevChainStart = chainStartGrids;
    const prevHeldParkId = heldParkId;
    const prevSelectedParked = selectedParkedEntry;
    const prevSelectedUnplaced = selectedUnplaced;

    // 2. Optimistic calculation
    const nextOps = [...openDraft.meta.ops.slice(0, openDraft.meta.opCursor), opToSend];
    const nextGrids = cloneClassGrids(openDraft.baseGrids);
    applyRevisionOps(nextGrids, nextOps);
    const nextReport = validateTimetable(nextGrids, openDraft.model);
    const nextMeta: TimetableDraft = {
      ...openDraft.meta,
      ops: nextOps,
      opCursor: nextOps.length,
      updatedAt: Date.now(),
      ...(updatedUnplacedList !== undefined ? { unplaced: updatedUnplacedList } : {}),
    };

    // 3. Apply optimistic state immediately
    setSavingOp(true);
    setBlockedBubble(null);
    setOpenDraft({
      meta: nextMeta,
      baseGrids: openDraft.baseGrids,
      currentGrids: nextGrids,
      model: openDraft.model,
      report: nextReport,
    });
    if (onOptimisticSuccess) {
      onOptimisticSuccess();
    }

    // 4. Server roundtrip
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_op",
          draftId: openDraft.meta.id,
          draftOp: opToSend,
          expectedOpCursor: openDraft.meta.opCursor,
          ...(updatedUnplacedList !== undefined ? { draftUnplaced: updatedUnplacedList } : {}),
        }),
      });

      const data = await res.json();
      if (res.status === 409 || data.error?.includes("다른 창") || data.error?.includes("opCursor")) {
        await handleOpen(prevDraft.meta);
        setBlockedBubble({
          message: "다른 창이 먼저 수정했습니다. 최신 초안을 다시 불러옵니다.",
        });
        return;
      }
      if (!res.ok || data.error) {
        throw new Error(data.error || `${errorMessagePrefix} 적용에 실패했습니다.`);
      }

      // Authoritative update from server
      setOpenDraft({
        meta: data.meta,
        baseGrids: data.baseGrids,
        currentGrids: data.currentGrids,
        model: openDraft.model,
        report: data.report,
      });
    } catch (err: any) {
      // Rollback on failure
      setOpenDraft(prevDraft);
      setPickedSlot(prevPicked);
      setCandidatesResult(prevCand);
      setChainSteps(prevChainSteps);
      setChainStartGrids(prevChainStart);
      setHeldParkId(prevHeldParkId);
      setSelectedParkedEntry(prevSelectedParked);
      setSelectedUnplaced(prevSelectedUnplaced);
      setBlockedBubble({ message: `${errorMessagePrefix} 실패: ${err.message || String(err)}` });
    } finally {
      setSavingOp(false);
    }
  };

  // ── 직접 조정 M2: 잠깐 빼두기 (park op — 스펙 §2-5) ──
  const handleParkCell = async (grade: number, classNum: number, day: number, period: number) => {
    if (!openDraft || savingOp) return;

    if (chainSteps.length > 0) {
      // 연쇄 도중 트레이로 빼기 = 이미 들린 수업이 park되어 있으므로 지금까지의 steps를 chain op로 전송 (스펙 §2-4)
      const opToSend: BaseRevisionOp = { type: "chain", steps: chainSteps };
      await executeOptimisticOp(
        opToSend,
        undefined,
        () => {
          setPickedSlot(null);
          setCandidatesResult(null);
          setChainSteps([]);
          setChainStartGrids(null);
          setHeldParkId(null);
          setSelectedParkedEntry(null);
        },
        "빼두기"
      );
      return;
    }

    const grid = openDraft.currentGrids.find((g) => g.grade === grade && g.classNum === classNum);
    const cell = grid?.cells?.find((c) => c.day === day && c.period === period);
    const lesson = cell?.lessons?.[0];
    if (!lesson) {
      setBlockedBubble({ day, period, message: "빈 칸은 빼둘 수 없습니다." });
      return;
    }

    const simulLabel = getSimulLabel(grade, classNum, day, period, lesson);
    if (simulLabel) {
      setBlockedBubble({
        message: `🔒 동시수업('${simulLabel}')은 밴드 묶음 수업으로 개별 빼두기가 금지되어 있습니다.`,
      });
      return;
    }

    const placeholder = findPlaceholderLesson(openDraft.currentGrids, grade, classNum, day, period);
    if (placeholder) {
      setBlockedBubble({
        message: "🔒 학교 공통 시간은 시간표 틀이므로 판에서 뺄 수 없습니다.",
      });
      return;
    }

    const parkId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const opToSend: BaseRevisionOp = { type: "park", parkId, grade, classNum, day, period };
    await executeOptimisticOp(
      opToSend,
      undefined,
      () => {
        setPickedSlot(null);
        setCandidatesResult(null);
        setChainSteps([]);
        setChainStartGrids(null);
        setHeldParkId(null);
        setSelectedParkedEntry(null);
      },
      "빼두기"
    );
  };

  // ── 직접 조정 M2: 빼둔 수업 복귀 (unpark op — 스펙 §2-5) ──
  const handleUnparkCell = async (entry: TrayEntry, targetDay: number, targetPeriod: number) => {
    if (!openDraft || savingOp) return;
    const grid = openDraft.currentGrids.find((g) => g.grade === entry.grade && g.classNum === entry.classNum);
    const cell = grid?.cells?.find((c) => c.day === targetDay && c.period === targetPeriod);
    if (cell && cell.lessons.length > 0) {
      setBlockedBubble({
        day: targetDay,
        period: targetPeriod,
        message: "비어 있는 칸에만 되돌릴 수 있습니다. 먼저 그 칸을 비우거나 다른 빈 칸을 선택하세요.",
      });
      return;
    }

    const opToSend: BaseRevisionOp = {
      type: "unpark",
      parkId: entry.parkId,
      grade: entry.grade,
      classNum: entry.classNum,
      day: targetDay,
      period: targetPeriod,
    };

    await executeOptimisticOp(
      opToSend,
      undefined,
      () => {
        setSelectedParkedEntry(null);
        setPickedSlot(null);
        setHeldParkId(null);
        setCandidatesResult(null);
      },
      "되돌리기"
    );
  };

  // ── 직접 조정: 미배정 수업 배정 적용 ──
  const handleApplyUnplacedAssignment = async (
    u: TimetableDraftUnplaced,
    targetDay: number,
    targetPeriod: number
  ) => {
    if (!openDraft || savingOp) return;
    const target = resolveUnplacedTarget(u, { grade: viewGrade, classNum: viewClass });
    const { grade, classNum } = target;

    const opToSend: BaseRevisionOp = {
      type: "edit_cell",
      grade,
      classNum,
      day: targetDay,
      period: targetPeriod,
      lessons: target.lessons,
    };

    const updatedUnplacedList = openDraft.meta.unplaced
      .map((item) => {
        if (item.sectionId === u.sectionId) {
          return { ...item, remaining: item.remaining - 1 };
        }
        return item;
      })
      .filter((item) => item.remaining > 0);

    await executeOptimisticOp(
      opToSend,
      updatedUnplacedList,
      () => {
        setSelectedUnplaced(null);
        setCandidatesResult(null);
      },
      "미배정 수업 배정"
    );
  };

  const handleCellRightClick = (
    day: number,
    period: number,
    targetGrade: number = viewGrade,
    targetClass: number = viewClass
  ) => {
    if (!openDraft || savingOp) return;
    const grid = openDraft.currentGrids.find((g) => g.grade === targetGrade && g.classNum === targetClass);
    const cell = grid?.cells?.find((c) => c.day === day && c.period === period);
    const lesson = cell?.lessons?.[0];
    if (!lesson) return;

    handleParkCell(targetGrade, targetClass, day, period);
  };

  // ── 직접 조정 모드: 즉시 이동 / 연쇄 적용 (스펙 §2-3·§2-4) ──
  const handleApplyDirectMove = async (
    grade: number,
    classNum: number,
    fromDay: number,
    fromPeriod: number,
    toDay: number,
    toPeriod: number
  ) => {
    if (!openDraft || savingOp) return;
    let opToSend: BaseRevisionOp;

    if (chainSteps.length > 0 && heldParkId) {
      // 연쇄의 마지막 이동 (빈 칸 안착 — unpark로 종료)
      const lastStep: ChainStep = {
        kind: "unpark",
        parkId: heldParkId,
        grade,
        classNum,
        day: toDay,
        period: toPeriod,
      };
      opToSend = {
        type: "chain",
        steps: [...chainSteps, lastStep],
      };
    } else {
      // 단건 이동 또는 단독 맞교환
      opToSend = {
        type: "swap",
        grade,
        classNum,
        a: { day: fromDay, period: fromPeriod },
        b: { day: toDay, period: toPeriod },
      };
    }

    await executeOptimisticOp(
      opToSend,
      undefined,
      () => {
        setPickedSlot(null);
        setCandidatesResult(null);
        setChainSteps([]);
        setChainStartGrids(null);
        setHeldParkId(null);
        setSelectedParkedEntry(null);
      },
      "이동"
    );
  };

  // ── 셀 클릭 핸들러 (학급 그리드) ──
  const handleCellClick = async (
    day: number,
    period: number,
    targetGrade: number = viewGrade,
    targetClass: number = viewClass
  ) => {
    if (!openDraft || savingOp) return;
    const { currentGrids } = openDraft;
    const grid = currentGrids.find((g) => g.grade === targetGrade && g.classNum === targetClass);
    const cell = grid?.cells?.find((c) => c.day === day && c.period === period);
    const lesson = cell?.lessons?.[0];

    // ── 직접 조정 모드 (M2: 연쇄 루미큐브 + 빼두기 + 미배정 배정) ──
    if (manualMode) {
      // 미배정 수업 배정 모드인 경우
      if (selectedUnplaced) {
        const cand = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
        if (cand?.verdict === "blocked") {
          return;
        }
        if (lesson) {
          setBlockedBubble({
            day,
            period,
            message: "비어 있는 칸에만 배정할 수 있습니다. 먼저 그 칸을 비우거나 다른 빈 칸을 선택하세요.",
          });
          return;
        }
        await handleApplyUnplacedAssignment(selectedUnplaced, day, period);
        return;
      }

      // 빼둔 수업 배치 모드인 경우
      if (selectedParkedEntry) {
        const cand = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
        if (cand?.verdict === "blocked") {
          return;
        }
        if (lesson) {
          setBlockedBubble({
            day,
            period,
            message: "비어 있는 칸에만 되돌릴 수 있습니다. 먼저 그 칸을 비우거나 다른 빈 칸을 선택하세요.",
          });
          return;
        }
        await handleUnparkCell(selectedParkedEntry, day, period);
        return;
      }

      if (!pickedSlot) {
        if (!lesson) {
          setBlockedBubble({ day, period, message: "빈 칸입니다 — 옮길 수업이 없습니다." });
          return;
        }
        const res = evaluateMoveCandidates({
          grids: currentGrids,
          model: openDraft.model,
          pick: { grade: targetGrade, classNum: targetClass, day, period },
        });
        if (res.pickBlocked) {
          setBlockedBubble({ day, period, message: res.pickBlocked });
          return;
        }
        setPickedSlot({ grade: targetGrade, classNum: targetClass, day, period, lesson });
        setCandidatesResult(res);
        setChainSteps([]);
        setChainStartGrids(cloneClassGrids(currentGrids));
        setHeldParkId(null);
        setBlockedBubble(null);
        if (lesson.teachers?.[0]?.email && !isTeacherPinned) {
          setSelectedTeacherEmail(lesson.teachers[0].email);
        }
        return;
      }

      // 이미 집은 상태
      if (
        pickedSlot.grade === targetGrade &&
        pickedSlot.classNum === targetClass &&
        pickedSlot.day === day &&
        pickedSlot.period === period
      ) {
        // 동일 셀 재클릭 -> 집기 해제 / 연쇄 취소 롤백 (스펙 §2-3·§2-4)
        if (chainSteps.length > 0 && chainStartGrids) {
          setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
          setChainSteps([]);
          setChainStartGrids(null);
          setHeldParkId(null);
        }
        setPickedSlot(null);
        setHeldParkId(null);
        setCandidatesResult(null);
        setBlockedBubble(null);
        return;
      }

      const cand = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
      if (!cand || cand.verdict === "blocked") {
        // 차단 칸: 클릭 무반응 (스펙 §2-3)
        return;
      }

      // 1) 빈 칸으로 이동 (kind === "move" 또는 수업 없음):
      if (cand.kind === "move" || !lesson) {
        await handleApplyDirectMove(
          pickedSlot.grade,
          pickedSlot.classNum,
          pickedSlot.day,
          pickedSlot.period,
          day,
          period
        );
        return;
      }

      // 2) 맞바꿈 가능 점유 칸 (kind === "swap"):
      if (cand.kind === "swap") {
        await handleApplyDirectMove(
          pickedSlot.grade,
          pickedSlot.classNum,
          pickedSlot.day,
          pickedSlot.period,
          day,
          period
        );
        return;
      }

      // 3) 밀어내기 칸 (kind === "displace" — 맞바꿈 불성립 점유 칸에서 수업을 넣고 상대 수업을 듦 — 과제 Q-2 ②):
      const updatedGrids = cloneClassGrids(currentGrids);
      const targetG = updatedGrids.find((g) => g.grade === targetGrade && g.classNum === targetClass);
      if (!targetG) return;

      const parkId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let nextChainSteps: ChainStep[];

      if (chainSteps.length === 0) {
        // 최초 밀어내기 (연쇄 시작):
        const stepPark: ChainStep = {
          kind: "park",
          parkId,
          grade: targetGrade,
          classNum: targetClass,
          day,
          period,
        };
        const stepSwap: ChainStep = {
          kind: "swap",
          grade: targetGrade,
          classNum: targetClass,
          a: { day: pickedSlot.day, period: pickedSlot.period },
          b: { day, period },
        };
        nextChainSteps = [stepPark, stepSwap];

        let cellA = targetG.cells.find((c) => c.day === pickedSlot.day && c.period === pickedSlot.period);
        let cellB = targetG.cells.find((c) => c.day === day && c.period === period);
        if (!cellA) {
          cellA = { day: pickedSlot.day, period: pickedSlot.period, lessons: [] };
          targetG.cells.push(cellA);
        }
        if (!cellB) {
          cellB = { day, period, lessons: [] };
          targetG.cells.push(cellB);
        }
        cellA.lessons = [];
        cellB.lessons = [pickedSlot.lesson];
      } else {
        // 연쇄 진행 중 추가 밀어내기:
        const stepPark: ChainStep = {
          kind: "park",
          parkId,
          grade: targetGrade,
          classNum: targetClass,
          day,
          period,
        };
        const stepUnpark: ChainStep = {
          kind: "unpark",
          parkId: heldParkId!,
          grade: targetGrade,
          classNum: targetClass,
          day,
          period,
        };
        nextChainSteps = [...chainSteps, stepPark, stepUnpark];

        let cellB = targetG.cells.find((c) => c.day === day && c.period === period);
        if (!cellB) {
          cellB = { day, period, lessons: [] };
          targetG.cells.push(cellB);
        }
        cellB.lessons = [pickedSlot.lesson];
      }

      const newPicked = {
        grade: targetGrade,
        classNum: targetClass,
        day,
        period,
        lesson,
      };

      setOpenDraft((prev) => (prev ? { ...prev, currentGrids: updatedGrids } : null));
      setChainSteps(nextChainSteps);
      setHeldParkId(parkId);
      setPickedSlot(newPicked);

      // 든 카드 기준으로 evaluateHeldCandidates 3색 재계산 (과제 Q-2 ②)
      const newRes = evaluateHeldCandidates({
        grids: updatedGrids,
        model: openDraft.model,
        held: { grade: targetGrade, classNum: targetClass, lessons: [lesson] },
      });
      setCandidatesResult(newRes);
      setBlockedBubble(null);

      if (lesson.teachers?.[0]?.email && !isTeacherPinned) {
        setSelectedTeacherEmail(lesson.teachers[0].email);
      }
      return;
    }

    // ── 열람 모드 (manualMode 꺼짐: 교사 주간 시간표 연동 등 열람 동작만) ──
    if (lesson?.teachers?.[0]?.email && !isTeacherPinned) {
      setSelectedTeacherEmail(lesson.teachers[0].email);
    }
  };

  // ── 교사 그리드 셀 클릭 핸들러 (직접 조정 모드) ──
  const handleTeacherCellClick = async (
    day: number,
    period: number,
    targetTeacherEmail: string | null = selectedTeacherEmail
  ) => {
    if (!openDraft || !manualMode || savingOp || !targetTeacherEmail) return;
    const { currentGrids } = openDraft;
    const slots = synthesizeTeacherGrid(currentGrids, targetTeacherEmail, periodsPerDay);

    // 미배정 수업 배정 모드인 경우
    if (selectedUnplaced) {
      const { grade: unplacedGrade, classNum: unplacedClass } = resolveUnplacedTarget(
        selectedUnplaced,
        { grade: viewGrade, classNum: viewClass }
      );

      const targetGrid = currentGrids.find(
        (g) => g.grade === unplacedGrade && g.classNum === unplacedClass
      );
      const targetCell = targetGrid?.cells?.find((c) => c.day === day && c.period === period);
      if (targetCell && targetCell.lessons.length > 0) {
        setBlockedBubble({
          day,
          period,
          message: "비어 있는 칸에만 배정할 수 있습니다. 먼저 그 칸을 비우거나 다른 빈 칸을 선택하세요.",
        });
        return;
      }
      await handleApplyUnplacedAssignment(selectedUnplaced, day, period);
      return;
    }

    // 빼둔 수업 배치 모드인 경우
    if (selectedParkedEntry) {
      const targetGrid = currentGrids.find(
        (g) => g.grade === selectedParkedEntry.grade && g.classNum === selectedParkedEntry.classNum
      );
      const targetCell = targetGrid?.cells?.find((c) => c.day === day && c.period === period);
      if (targetCell && targetCell.lessons.length > 0) {
        setBlockedBubble({
          day,
          period,
          message: "비어 있는 칸에만 되돌릴 수 있습니다. 먼저 그 칸을 비우거나 다른 빈 칸을 선택하세요.",
        });
        return;
      }
      await handleUnparkCell(selectedParkedEntry, day, period);
      return;
    }

    if (!pickedSlot) {
      const hit = slots.find((s) => s.day === day && s.period === period);
      if (!hit) {
        setBlockedBubble({ day, period, message: "선택한 교사의 수업이 없는 빈 칸입니다." });
        return;
      }
      if (!isClassPinned) {
        setViewGrade(hit.grade);
        setViewClass(hit.classNum);
      }
      const targetGrid = currentGrids.find((g) => g.grade === hit.grade && g.classNum === hit.classNum);
      const targetCell = targetGrid?.cells?.find((c) => c.day === day && c.period === period);
      const targetLesson = targetCell?.lessons?.[0];
      if (!targetLesson) return;

      const res = evaluateMoveCandidates({
        grids: currentGrids,
        model: openDraft.model,
        pick: { grade: hit.grade, classNum: hit.classNum, day, period },
      });
      if (res.pickBlocked) {
        setBlockedBubble({ day, period, message: res.pickBlocked });
        return;
      }
      setPickedSlot({ grade: hit.grade, classNum: hit.classNum, day, period, lesson: targetLesson });
      setCandidatesResult(res);
      setChainSteps([]);
      setChainStartGrids(cloneClassGrids(currentGrids));
      setHeldParkId(null);
      setBlockedBubble(null);
      return;
    }

    // 이미 집은 상태
    const hit = slots.find((s) => s.day === day && s.period === period);
    if (
      hit &&
      pickedSlot.grade === hit.grade &&
      pickedSlot.classNum === hit.classNum &&
      pickedSlot.day === day &&
      pickedSlot.period === period
    ) {
      if (chainSteps.length > 0 && chainStartGrids) {
        setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
        setChainSteps([]);
        setChainStartGrids(null);
        setHeldParkId(null);
      }
      setPickedSlot(null);
      setHeldParkId(null);
      setCandidatesResult(null);
      setBlockedBubble(null);
      return;
    }

    const cand = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
    if (!cand || cand.verdict === "blocked") {
      return;
    }

    const targetGrid = currentGrids.find((g) => g.grade === pickedSlot.grade && g.classNum === pickedSlot.classNum);
    const targetCell = targetGrid?.cells?.find((c) => c.day === day && c.period === period);
    const targetLesson = targetCell?.lessons?.[0];

    // 1) 빈 칸 이동 (kind === "move" 또는 수업 없음):
    if (cand.kind === "move" || !targetLesson) {
      await handleApplyDirectMove(
        pickedSlot.grade,
        pickedSlot.classNum,
        pickedSlot.day,
        pickedSlot.period,
        day,
        period
      );
      return;
    }

    // 2) 맞바꿈 가능 점유 칸 (kind === "swap"):
    if (cand.kind === "swap") {
      await handleApplyDirectMove(
        pickedSlot.grade,
        pickedSlot.classNum,
        pickedSlot.day,
        pickedSlot.period,
        day,
        period
      );
      return;
    }

    // 3) 밀어내기 칸 (kind === "displace"):
    const updatedGrids = cloneClassGrids(currentGrids);
    const targetG = updatedGrids.find((g) => g.grade === pickedSlot.grade && g.classNum === pickedSlot.classNum);
    if (!targetG) return;

    const parkId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let nextChainSteps: ChainStep[];

    if (chainSteps.length === 0) {
      const stepPark: ChainStep = {
        kind: "park",
        parkId,
        grade: pickedSlot.grade,
        classNum: pickedSlot.classNum,
        day,
        period,
      };
      const stepSwap: ChainStep = {
        kind: "swap",
        grade: pickedSlot.grade,
        classNum: pickedSlot.classNum,
        a: { day: pickedSlot.day, period: pickedSlot.period },
        b: { day, period },
      };
      nextChainSteps = [stepPark, stepSwap];

      let cellA = targetG.cells.find((c) => c.day === pickedSlot.day && c.period === pickedSlot.period);
      let cellB = targetG.cells.find((c) => c.day === day && c.period === period);
      if (!cellA) {
        cellA = { day: pickedSlot.day, period: pickedSlot.period, lessons: [] };
        targetG.cells.push(cellA);
      }
      if (!cellB) {
        cellB = { day, period, lessons: [] };
        targetG.cells.push(cellB);
      }
      cellA.lessons = [];
      cellB.lessons = [pickedSlot.lesson];
    } else {
      const stepPark: ChainStep = {
        kind: "park",
        parkId,
        grade: pickedSlot.grade,
        classNum: pickedSlot.classNum,
        day,
        period,
      };
      const stepUnpark: ChainStep = {
        kind: "unpark",
        parkId: heldParkId!,
        grade: pickedSlot.grade,
        classNum: pickedSlot.classNum,
        day,
        period,
      };
      nextChainSteps = [...chainSteps, stepPark, stepUnpark];

      let cellB = targetG.cells.find((c) => c.day === day && c.period === period);
      if (!cellB) {
        cellB = { day, period, lessons: [] };
        targetG.cells.push(cellB);
      }
      cellB.lessons = [pickedSlot.lesson];
    }

    const newPicked = {
      grade: pickedSlot.grade,
      classNum: pickedSlot.classNum,
      day,
      period,
      lesson: targetLesson,
    };

    setOpenDraft((prev) => (prev ? { ...prev, currentGrids: updatedGrids } : null));
    setChainSteps(nextChainSteps);
    setHeldParkId(parkId);
    setPickedSlot(newPicked);

    const newRes = evaluateHeldCandidates({
      grids: updatedGrids,
      model: openDraft.model,
      held: { grade: pickedSlot.grade, classNum: pickedSlot.classNum, lessons: [targetLesson] },
    });
    setCandidatesResult(newRes);
    setBlockedBubble(null);

    if (targetLesson?.teachers?.[0]?.email && !isTeacherPinned) {
      setSelectedTeacherEmail(targetLesson.teachers[0].email);
    }
  };

  // ── op 연쇄 영향 다이얼로그에서 [적용하기] 실행 ──
  const handleApplyOp = async () => {
    if (!openDraft || !proposedOp || savingOp) return;
    setSavingOp(true);
    setOpApiError(null);

    try {
      // 미배정 배정 적용 시 unplaced 차감 업데이트
      let updatedUnplacedList: TimetableDraftUnplaced[] | undefined = undefined;
      if (selectedUnplaced) {
        updatedUnplacedList = openDraft.meta.unplaced
          .map((u) => {
            if (u.sectionId === selectedUnplaced.sectionId) {
              return { ...u, remaining: u.remaining - 1 };
            }
            return u;
          })
          .filter((u) => u.remaining > 0);
      }

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_op",
          draftId: openDraft.meta.id,
          draftOp: proposedOp,
          expectedOpCursor: openDraft.meta.opCursor,
          ...(updatedUnplacedList ? { draftUnplaced: updatedUnplacedList } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "이동/교환 적용에 실패했습니다.");
      }

      // 갱신 성공
      setOpenDraft({
        meta: data.meta,
        baseGrids: data.baseGrids,
        currentGrids: data.currentGrids,
        model: openDraft.model,
        report: data.report,
      });

      // 상태 초기화
      setProposedOp(null);
      setImpactAnalysis(null);
      setSelectedUnplaced(null);
    } catch (err: any) {
      setOpApiError(err.message);
    } finally {
      setSavingOp(false);
    }
  };

  // ── 현재 학급 그리드 ──
  const currentGrid = openDraft?.currentGrids.find(
    (g) => g.grade === viewGrade && g.classNum === viewClass
  );

  // ── 우측 파생 교사 그리드 ──
  const teacherSlots = openDraft && selectedTeacherEmail
    ? synthesizeTeacherGrid(openDraft.currentGrids, selectedTeacherEmail, periodsPerDay)
    : [];
  // 선택 교사의 표시 이름 — 이메일 아이디를 그대로 찍지 않는다 (2026-08-21 사용자 신고).
  // GWS 맵 우선, 없으면 초안 그리드에 박힌 이름(작성 시점 GWS 값) 폴백 — 프리페치 도착 전에도 아이디로 안 샌다.
  const selectedTeacherName = useMemo(() => {
    if (!selectedTeacherEmail) return null;
    const key = selectedTeacherEmail.trim().toLowerCase();
    let gridName = "";
    outer: for (const g of openDraft?.currentGrids || [])
      for (const c of g.cells || [])
        for (const l of c.lessons || [])
          for (const t of l.teachers || [])
            if ((t.email || "").trim().toLowerCase() === key && (t.name || "").trim()) {
              gridName = t.name.trim();
              break outer;
            }
    return resolveDisplayName(selectedTeacherEmail, undefined, gwsNameMap.get(key) || gridName || undefined).name;
  }, [selectedTeacherEmail, openDraft, gwsNameMap]);

  // ── 초안 편집기 화면 ──
  if (openDraft) {
    const { meta, report } = openDraft;
    const canUndo = meta.opCursor > 0;
    const canRedo = meta.opCursor < meta.ops.length;

    // ── 학급 그리드 테이블 렌더러 (셀 높이 상시 균일화: h-14 고정) ──
    const renderClassGridTable = (
      grade: number,
      classNum: number,
      isExtra: boolean = false
    ) => {
      const grid = openDraft.currentGrids.find((g) => g.grade === grade && g.classNum === classNum);
      if (!grid) {
        return (
          <div className="p-8 text-center text-xs text-gray-400">
            {grade}학년 {classNum}반 시간표가 없습니다.
          </div>
        );
      }

      return (
        <table className="w-full text-center text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b border-gray-200 font-bold text-gray-700">
              <th className="py-2.5 px-2 border-r border-gray-200 w-10">교시</th>
              {DAYS.map((d, dIdx) => {
                const isHighlighted =
                  !isExtra &&
                  highlightDay?.target === "class" &&
                  highlightDay.day === dIdx + 1;
                return (
                  <th
                    key={d}
                    className={`py-2.5 px-1 border-r border-gray-200 min-w-[5.5rem] transition-colors duration-500 ${
                      isHighlighted
                        ? "bg-amber-200 text-amber-950 ring-2 ring-inset ring-amber-400"
                        : ""
                    }`}
                  >
                    {d}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {Array.from({ length: Math.max(7, periodsPerDay) }, (_, i) => i + 1).map((period) => (
              <tr key={period}>
                <td className="py-2 px-2 font-bold bg-gray-50 border-r border-gray-200 text-gray-600">
                  {period}
                </td>
                {[1, 2, 3, 4, 5].map((day) => {
                  const cell = grid.cells.find((c) => c.day === day && c.period === period);
                  const lesson = cell?.lessons?.[0];

                  // 직접 조정 모드일 때
                  if (manualMode) {
                    const isPicked =
                      pickedSlot?.grade === grade &&
                      pickedSlot?.classNum === classNum &&
                      pickedSlot?.day === day &&
                      pickedSlot?.period === period;
                    const cand =
                      pickedSlot?.grade === grade && pickedSlot?.classNum === classNum
                        ? candidatesResult?.candidates.find(
                            (c) => c.day === day && c.period === period
                          )
                        : undefined;
                    const simulLabel = getSimulLabel(grade, classNum, day, period, lesson);
                    const placeholder = findPlaceholderLesson(openDraft.currentGrids, grade, classNum, day, period);
                    const isBandLocked = !!simulLabel;
                    const isPlaceholder = !!placeholder;
                    const canDragCell = manualMode && !savingOp && !!lesson && !isBandLocked && !isPlaceholder;
                    const isDragOverThis =
                      dragOverCell?.day === day &&
                      dragOverCell?.period === period &&
                      (!dragSource ||
                        dragSource.type !== "cell" ||
                        (dragSource.grade === grade && dragSource.classNum === classNum));

                    const dndProps = {
                      draggable: canDragCell,
                      onDragStart: (e: React.DragEvent) => {
                        if (!canDragCell) return;
                        e.dataTransfer.setData(
                          "text/plain",
                          JSON.stringify({ type: "cell", grade, classNum, day, period })
                        );
                        e.dataTransfer.effectAllowed = "move";
                        setDragSource({ type: "cell", grade, classNum, day, period, lesson: lesson! });

                        if (!isPicked) {
                          const res = evaluateMoveCandidates({
                            grids: openDraft.currentGrids,
                            model: openDraft.model,
                            pick: { grade, classNum, day, period },
                          });
                          if (!res.pickBlocked) {
                            setPickedSlot({ grade, classNum, day, period, lesson: lesson! });
                            setCandidatesResult(res);
                            setChainSteps([]);
                            setChainStartGrids(cloneClassGrids(openDraft.currentGrids));
                            setHeldParkId(null);
                          }
                        }
                      },
                      onDragEnd: () => {
                        setDragSource(null);
                        setDragOverCell(null);
                        setIsTrayDragOver(false);
                      },
                      onDragOver: (e: React.DragEvent) => {
                        if (!dragSource || savingOp) return;
                        if (
                          dragSource.type === "cell" &&
                          (dragSource.grade !== grade || dragSource.classNum !== classNum)
                        ) {
                          return;
                        }
                        const candItem = candidatesResult?.candidates.find(
                          (c) => c.day === day && c.period === period
                        );
                        if (candItem && candItem.verdict !== "blocked") {
                          if (dragSource.type === "cell") {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setDragOverCell({ day, period });
                          } else if (dragSource.type === "tray" || dragSource.type === "unplaced") {
                            if (!lesson) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverCell({ day, period });
                            }
                          }
                        }
                      },
                      onDragLeave: (e: React.DragEvent) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDragOverCell((prev) =>
                            prev?.day === day && prev?.period === period ? null : prev
                          );
                        }
                      },
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault();
                        setDragOverCell(null);
                        if (!dragSource || savingOp) return;

                        const candItem = candidatesResult?.candidates.find(
                          (c) => c.day === day && c.period === period
                        );
                        if (!candItem || candItem.verdict === "blocked") return;

                        if (dragSource.type === "cell") {
                          if (
                            dragSource.grade === grade &&
                            dragSource.classNum === classNum &&
                            dragSource.day === day &&
                            dragSource.period === period
                          )
                            return;
                          setDragSource(null);
                          handleCellClick(day, period, grade, classNum);
                        } else if (dragSource.type === "tray") {
                          if (lesson) return;
                          setDragSource(null);
                          handleUnparkCell(dragSource.entry, day, period);
                        } else if (dragSource.type === "unplaced") {
                          if (lesson) return;
                          setDragSource(null);
                          handleApplyUnplacedAssignment(dragSource.unplaced, day, period);
                        }
                      },
                    };

                    if (isPicked) {
                      return (
                        <td
                          key={day}
                          {...dndProps}
                          onClick={() => handleCellClick(day, period, grade, classNum)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            handleCellRightClick(day, period, grade, classNum);
                          }}
                          title="집은 수업 (클릭 또는 Esc로 해제)"
                          className={`h-14 min-h-[3.5rem] max-h-[3.5rem] p-1.5 border-r border-gray-200 bg-sky-100/90 text-sky-950 align-top cursor-pointer select-none relative overflow-hidden ${
                            isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                          } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                        >
                          {lesson ? (
                            <div className="h-full flex flex-col justify-between">
                              <div className="flex items-start justify-between gap-0.5">
                                <span className="font-bold text-[11px] truncate leading-tight">
                                  {lesson.subjectShort || lesson.subjectName}
                                </span>
                                <span className="shrink-0 text-[10px] leading-none" title="집은 수업">
                                  📌
                                </span>
                              </div>
                              <div className="text-[10px] text-sky-800 truncate leading-tight text-left">
                                {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col justify-between">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-gray-300">—</span>
                              </div>
                              <div className="text-[10px] text-transparent leading-tight select-none">—</div>
                            </div>
                          )}
                        </td>
                      );
                    }

                    if (cand) {
                      if (cand.verdict === "ok") {
                        return (
                          <td
                            key={day}
                            {...dndProps}
                            onClick={() => handleCellClick(day, period, grade, classNum)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handleCellRightClick(day, period, grade, classNum);
                            }}
                            title={
                              /* 여기는 delta <= 0 보장 */
                              cand.kind === "swap"
                                ? `${lesson?.subjectShort || "수업"}과 맞교환 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                : cand.kind === "displace"
                                ? `${lesson?.subjectShort || "수업"} 밀어내고 들기 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                : `빈 칸으로 이동 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                            }
                            className={`h-14 min-h-[3.5rem] max-h-[3.5rem] p-1.5 border-r border-gray-200 bg-emerald-50/80 hover:bg-emerald-100/80 text-gray-800 align-top cursor-pointer select-none transition-colors relative overflow-hidden ${
                              isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                            } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                          >
                            {lesson ? (
                              <div className="h-full flex flex-col justify-between">
                                <div className="flex items-start justify-between gap-0.5">
                                  <span className="font-bold text-[11px] truncate leading-tight text-emerald-950 flex items-center gap-0.5">
                                    {cand.kind === "displace" && (
                                      <span className="text-[9px]" title="밀어내고 들기">
                                        ✋
                                      </span>
                                    )}
                                    {isBandLocked && (
                                      <span className="text-[9px]" title={simulLabel ? `동시수업: ${simulLabel}` : "동시수업"}>
                                        🔒
                                      </span>
                                    )}
                                    <span>{lesson.subjectShort || lesson.subjectName}</span>
                                  </span>
                                  <span
                                    className={`shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none ${
                                      cand.softDelta < 0
                                        ? "bg-emerald-600 text-white shadow-2xs"
                                        : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    }`}
                                  >
                                    {cand.softDelta < 0 ? cand.softDelta : "0"}
                                  </span>
                                </div>
                                <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                                  {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                                </div>
                              </div>
                            ) : (
                              <div className="h-full flex flex-col justify-between">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-300">—</span>
                                  <span
                                    className={`shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none ${
                                      cand.softDelta < 0
                                        ? "bg-emerald-600 text-white shadow-2xs"
                                        : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    }`}
                                  >
                                    {cand.softDelta < 0 ? cand.softDelta : "0"}
                                  </span>
                                </div>
                                <div className="text-[10px] text-transparent leading-tight select-none">—</div>
                              </div>
                            )}
                          </td>
                        );
                      }

                      if (cand.verdict === "worse") {
                        const worseReason = formatWorseReasons(cand.worseByCode);
                        return (
                          <td
                            key={day}
                            {...dndProps}
                            onClick={() => handleCellClick(day, period, grade, classNum)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              handleCellRightClick(day, period, grade, classNum);
                            }}
                            title={
                              cand.kind === "displace"
                                ? worseReason
                                  ? `밀어내고 들기 감점 (+${cand.softDelta}점): ${worseReason}`
                                  : `밀어내고 들기 감점 +${cand.softDelta}점`
                                : worseReason
                                ? `감점 (+${cand.softDelta}점): ${worseReason}`
                                : `감점 +${cand.softDelta}점`
                            }
                            className={`h-14 min-h-[3.5rem] max-h-[3.5rem] p-1.5 border-r border-gray-200 bg-amber-50/80 hover:bg-amber-100/80 text-gray-800 align-top cursor-pointer select-none transition-colors relative overflow-hidden ${
                              isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                            } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                          >
                            {lesson ? (
                              <div className="h-full flex flex-col justify-between">
                                <div className="flex items-start justify-between gap-0.5">
                                  <span className="font-bold text-[11px] truncate leading-tight text-amber-950 flex items-center gap-0.5">
                                    {cand.kind === "displace" && (
                                      <span className="text-[9px]" title="밀어내고 들기">
                                        ✋
                                      </span>
                                    )}
                                    {isBandLocked && (
                                      <span className="text-[9px]" title={simulLabel ? `동시수업: ${simulLabel}` : "동시수업"}>
                                        🔒
                                      </span>
                                    )}
                                    <span>{lesson.subjectShort || lesson.subjectName}</span>
                                  </span>
                                  <span className="shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none bg-amber-500 text-white shadow-2xs">
                                    +{cand.softDelta}
                                  </span>
                                </div>
                                <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                                  {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                                </div>
                              </div>
                            ) : (
                              <div className="h-full flex flex-col justify-between">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-300">—</span>
                                  <span className="shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none bg-amber-500 text-white shadow-2xs">
                                    +{cand.softDelta}
                                  </span>
                                </div>
                                <div className="text-[10px] text-transparent leading-tight select-none">—</div>
                              </div>
                            )}
                          </td>
                        );
                      }

                      // blocked (하드 위반 등)
                      return (
                        <td
                          key={day}
                          {...dndProps}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            handleCellRightClick(day, period, grade, classNum);
                          }}
                          title={
                            cand.blockedReason
                              ? `이동 불가: ${cand.blockedReason}`
                              : isBandLocked
                              ? `동시수업 (${simulLabel})`
                              : isPlaceholder
                              ? "학교 공통 시간"
                              : "이동 불가"
                          }
                          className={`h-14 min-h-[3.5rem] max-h-[3.5rem] p-1.5 border-r border-gray-200 bg-gray-100/90 text-gray-400 align-top cursor-not-allowed select-none relative opacity-70 overflow-hidden ${
                            savingOp ? "cursor-wait" : ""
                          }`}
                        >
                          {lesson ? (
                            <div className="h-full flex flex-col justify-between">
                              <div className="flex items-start justify-between gap-0.5">
                                <span className="font-bold text-[11px] truncate leading-tight text-gray-400">
                                  {lesson.subjectShort || lesson.subjectName}
                                </span>
                                <span className="shrink-0 text-[10px] text-gray-400 leading-none">🔒</span>
                              </div>
                              <div className="text-[10px] text-gray-400 truncate leading-tight text-left">
                                {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col justify-between">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-gray-300">—</span>
                                <span className="text-[10px] text-gray-400 leading-none">🔒</span>
                              </div>
                              <div className="text-[10px] text-transparent leading-tight select-none">—</div>
                            </div>
                          )}
                        </td>
                      );
                    }

                    // pickedSlot이 없는 대기 상태
                    return (
                      <td
                        key={day}
                        {...dndProps}
                        onClick={() => handleCellClick(day, period, grade, classNum)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          handleCellRightClick(day, period, grade, classNum);
                        }}
                        onMouseEnter={() => {
                          if (!isExtra && !isTeacherPinned && !pickedSlot && lesson?.teachers?.[0]?.email) {
                            setSelectedTeacherEmail(lesson.teachers[0].email);
                          }
                        }}
                        title={
                          isBandLocked
                            ? `동시수업 (${simulLabel})`
                            : isPlaceholder
                            ? "학교 공통 시간"
                            : lesson
                            ? `${lesson.subjectName} (${lesson.teachers?.map((t) => t.name).join(", ") || ""})`
                            : undefined
                        }
                        className={`h-14 min-h-[3.5rem] max-h-[3.5rem] p-1.5 border-r border-gray-200 align-top transition-colors cursor-pointer select-none bg-white hover:bg-indigo-50/50 text-gray-800 relative overflow-hidden ${
                          isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                        } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                      >
                        {lesson ? (
                          <div className="h-full flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-0.5">
                              <span className="font-bold text-[11px] truncate leading-tight">
                                {lesson.subjectShort || lesson.subjectName}
                              </span>
                              {isBandLocked && (
                                <span className="shrink-0 text-[10px] text-purple-700 leading-none" title={`동시수업: ${simulLabel}`}>
                                  🔒
                                </span>
                              )}
                              {isPlaceholder && (
                                <span className="shrink-0 text-[10px] text-purple-700 leading-none" title="학교 공통 시간">
                                  🔒
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                              {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                            </div>
                          </div>
                        ) : (
                          <div className="h-full flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-gray-300">—</span>
                            </div>
                            <div className="text-[10px] text-transparent leading-tight select-none">—</div>
                          </div>
                        )}
                      </td>
                    );
                  }

                  // ── 열람 모드 (manualMode 꺼짐) ──
                  const simulLabel = getSimulLabel(grade, classNum, day, period, lesson);
                  const isBandLocked = !!simulLabel;

                  const hasHardError = report.hard.some((h) => {
                    const hasAnyCoord =
                      h.grade !== undefined ||
                      h.classNum !== undefined ||
                      h.day !== undefined ||
                      h.period !== undefined;
                    if (!hasAnyCoord) return false;
                    if (h.grade !== undefined && h.grade !== grade) return false;
                    if (h.classNum !== undefined && h.classNum !== classNum) return false;
                    if (h.day !== undefined && h.day !== day) return false;
                    if (h.period !== undefined && h.period !== period) return false;
                    return true;
                  });

                  return (
                    <td
                      key={day}
                      onClick={() => handleCellClick(day, period, grade, classNum)}
                      onMouseEnter={() => {
                        if (!isExtra && !isTeacherPinned && !pickedSlot && lesson?.teachers?.[0]?.email) {
                          setSelectedTeacherEmail(lesson.teachers[0].email);
                        }
                      }}
                      title={
                        hasHardError
                          ? "중대 문제 발생"
                          : isBandLocked
                          ? `동시수업 (${simulLabel})`
                          : lesson
                          ? `${lesson.subjectName} (${lesson.teachers?.map((t) => t.name).join(", ") || ""})`
                          : undefined
                      }
                      className={`h-14 min-h-[3.5rem] max-h-[3.5rem] p-1.5 border-r border-gray-200 align-top transition-colors cursor-pointer select-none overflow-hidden ${
                        hasHardError
                          ? "bg-red-100 text-red-950 font-bold border-2 border-red-400"
                          : isBandLocked
                          ? "bg-gray-100/80 text-gray-500"
                          : "bg-white hover:bg-gray-50 text-gray-800"
                      }`}
                    >
                      {lesson ? (
                        <div className="h-full flex flex-col justify-between">
                          <div className="flex items-start justify-between gap-0.5">
                            <span className="font-bold text-[11px] truncate leading-tight">
                              {lesson.subjectShort || lesson.subjectName}
                            </span>
                            {isBandLocked && (
                              <span className="shrink-0 text-[10px] text-purple-700 leading-none" title={`동시수업: ${simulLabel}`}>
                                🔒
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                            {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-300">—</span>
                          </div>
                          <div className="text-[10px] text-transparent leading-tight select-none">—</div>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    };

    // ── 교사 그리드 테이블 렌더러 (셀 높이 상시 균일화: h-8 고정) ──
    const renderTeacherGridTable = (
      teacherEmail: string | null,
      isExtra: boolean = false
    ) => {
      const slots = teacherEmail
        ? synthesizeTeacherGrid(openDraft.currentGrids, teacherEmail, periodsPerDay)
        : [];

      if (!teacherEmail) {
        return (
          <div className="py-6 text-center text-xs text-gray-400">
            {manualMode
              ? "학급 시간표 셀을 가리키거나 위에서 교사를 선택하세요."
              : "시간표 셀을 클릭하면 해당 교사의 주간 시간표가 자동 표시됩니다."}
          </div>
        );
      }

      return (
        <div className="overflow-x-auto border border-gray-100 rounded-lg text-[11px]">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600">
                <th className="py-1 px-1 border-r border-gray-200 w-7">교시</th>
                {DAYS.map((d, dIdx) => {
                  const isHighlighted =
                    !isExtra &&
                    highlightDay?.target === "teacher" &&
                    highlightDay.day === dIdx + 1;
                  return (
                    <th
                      key={d}
                      className={`py-1 px-1 border-r border-gray-200 transition-colors duration-500 ${
                        isHighlighted
                          ? "bg-amber-200 text-amber-950 ring-2 ring-inset ring-amber-400"
                          : ""
                      }`}
                    >
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Array.from({ length: Math.max(7, periodsPerDay) }, (_, i) => i + 1).map((p) => (
                <tr key={p}>
                  <td className="py-1 px-1 font-bold bg-gray-50 border-r border-gray-200 text-gray-500 text-[10px]">
                    {p}
                  </td>
                  {[1, 2, 3, 4, 5].map((d) => {
                    const hit = slots.find((s) => s.day === d && s.period === p);

                    if (manualMode) {
                      const cand = pickedSlot
                        ? candidatesResult?.candidates.find((c) => c.day === d && c.period === p)
                        : undefined;
                      const isDragOverTeacherThis =
                        dragOverCell?.day === d && dragOverCell?.period === p;

                      const canDragTeacherCell = manualMode && !savingOp && !!hit;
                      const teacherDndProps = {
                        draggable: canDragTeacherCell,
                        onDragStart: (e: React.DragEvent) => {
                          if (!canDragTeacherCell) return;
                          const targetGrid = openDraft.currentGrids.find(
                            (g) => g.grade === hit.grade && g.classNum === hit.classNum
                          );
                          const targetCell = targetGrid?.cells?.find((c) => c.day === d && c.period === p);
                          const targetLesson = targetCell?.lessons?.[0];
                          if (!targetLesson) return;

                          e.dataTransfer.setData(
                            "text/plain",
                            JSON.stringify({
                              type: "cell",
                              grade: hit.grade,
                              classNum: hit.classNum,
                              day: d,
                              period: p,
                            })
                          );
                          e.dataTransfer.effectAllowed = "move";
                          setDragSource({
                            type: "cell",
                            grade: hit.grade,
                            classNum: hit.classNum,
                            day: d,
                            period: p,
                            lesson: targetLesson,
                          });

                          if (
                            !pickedSlot ||
                            pickedSlot.grade !== hit.grade ||
                            pickedSlot.classNum !== hit.classNum ||
                            pickedSlot.day !== d ||
                            pickedSlot.period !== p
                          ) {
                            handleTeacherCellClick(d, p, teacherEmail);
                          }
                        },
                        onDragEnd: () => {
                          setDragSource(null);
                          setDragOverCell(null);
                        },
                        onDragOver: (e: React.DragEvent) => {
                          if (!dragSource || savingOp) return;
                          const candItem = candidatesResult?.candidates.find(
                            (c) => c.day === d && c.period === p
                          );
                          if (candItem && candItem.verdict !== "blocked") {
                            if (dragSource.type === "cell") {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverCell({ day: d, period: p });
                            } else if (dragSource.type === "tray" || dragSource.type === "unplaced") {
                              if (!hit) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDragOverCell({ day: d, period: p });
                              }
                            }
                          }
                        },
                        onDragLeave: (e: React.DragEvent) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            setDragOverCell((prev) =>
                              prev?.day === d && prev?.period === p ? null : prev
                            );
                          }
                        },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault();
                          setDragOverCell(null);
                          if (!dragSource || savingOp) return;

                          const candItem = candidatesResult?.candidates.find(
                            (c) => c.day === d && c.period === p
                          );
                          if (!candItem || candItem.verdict === "blocked") return;

                          if (dragSource.type === "cell") {
                            setDragSource(null);
                            handleTeacherCellClick(d, p, teacherEmail);
                          } else if (dragSource.type === "tray") {
                            if (hit) return;
                            setDragSource(null);
                            handleUnparkCell(dragSource.entry, d, p);
                          } else if (dragSource.type === "unplaced") {
                            if (hit) return;
                            setDragSource(null);
                            handleApplyUnplacedAssignment(dragSource.unplaced, d, p);
                          }
                        },
                      };

                      if (pickedSlot && cand) {
                        if (cand.verdict === "ok") {
                          return (
                            <td
                              key={d}
                              {...teacherDndProps}
                              onClick={() => handleTeacherCellClick(d, p, teacherEmail)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (hit) handleCellRightClick(d, p, hit.grade, hit.classNum);
                              }}
                              className={`h-8 min-h-[2rem] max-h-[2rem] p-1 border-r border-gray-100 bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-950 font-bold cursor-pointer select-none text-[10px] transition-colors overflow-hidden ${
                                isDragOverTeacherThis
                                  ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10"
                                  : ""
                              } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                              title={
                                /* 여기는 delta <= 0 보장 */
                                hit
                                  ? cand.kind === "displace"
                                    ? `${hit.grade}-${hit.classNum} ${hit.subjectName} 밀어내고 들기 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                    : `${hit.grade}-${hit.classNum} ${hit.subjectName}과 맞교환 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                  : `빈 칸으로 이동 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                              }
                            >
                              <div className="h-full flex items-center justify-between gap-0.5">
                                <span className="truncate flex items-center gap-0.5">
                                  {cand.kind === "displace" && (
                                    <span className="text-[9px]" title="밀어내고 들기">
                                      ✋
                                    </span>
                                  )}
                                  <span>{hit ? `${hit.grade}-${hit.classNum}` : "—"}</span>
                                </span>
                                <span
                                  className={`px-1 py-0.2 rounded font-mono text-[8px] font-extrabold leading-none ${
                                    cand.softDelta < 0
                                      ? "bg-emerald-600 text-white"
                                      : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  }`}
                                >
                                  {cand.softDelta < 0 ? cand.softDelta : "0"}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        if (cand.verdict === "worse") {
                          const worseReason = formatWorseReasons(cand.worseByCode);
                          return (
                            <td
                              key={d}
                              {...teacherDndProps}
                              onClick={() => handleTeacherCellClick(d, p, teacherEmail)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (hit) handleCellRightClick(d, p, hit.grade, hit.classNum);
                              }}
                              className={`h-8 min-h-[2rem] max-h-[2rem] p-1 border-r border-gray-100 bg-amber-50/80 hover:bg-amber-100/80 text-amber-950 font-bold cursor-pointer select-none text-[10px] transition-colors overflow-hidden ${
                                isDragOverTeacherThis
                                  ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10"
                                  : ""
                              } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                              title={
                                cand.kind === "displace"
                                  ? worseReason
                                    ? `밀어내고 들기 감점 (+${cand.softDelta}점): ${worseReason}`
                                    : `밀어내고 들기 감점 +${cand.softDelta}점`
                                  : worseReason
                                  ? `감점 (+${cand.softDelta}점): ${worseReason}`
                                  : `감점 +${cand.softDelta}점`
                              }
                            >
                              <div className="h-full flex items-center justify-between gap-0.5">
                                <span className="truncate flex items-center gap-0.5">
                                  {cand.kind === "displace" && (
                                    <span className="text-[9px]" title="밀어내고 들기">
                                      ✋
                                    </span>
                                  )}
                                  <span>{hit ? `${hit.grade}-${hit.classNum}` : "—"}</span>
                                </span>
                                <span className="px-1 py-0.2 rounded font-mono text-[8px] font-extrabold leading-none bg-amber-500 text-white">
                                  +{cand.softDelta}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={d}
                            {...teacherDndProps}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (hit) handleCellRightClick(d, p, hit.grade, hit.classNum);
                            }}
                            className={`h-8 min-h-[2rem] max-h-[2rem] p-1 border-r border-gray-100 bg-gray-100/90 text-gray-400 cursor-not-allowed select-none text-[10px] opacity-70 overflow-hidden ${
                              savingOp ? "cursor-wait" : ""
                            }`}
                            title={cand.blockedReason ? `이동 불가: ${cand.blockedReason}` : "이동 불가"}
                          >
                            <div className="h-full flex items-center justify-between gap-0.5">
                              <span className="truncate">{hit ? `${hit.grade}-${hit.classNum}` : "—"}</span>
                              <span className="text-[8px] text-gray-400 leading-none">🔒</span>
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={d}
                          {...teacherDndProps}
                          onClick={() => {
                            if (hit) handleTeacherCellClick(d, p, teacherEmail);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (hit) handleCellRightClick(d, p, hit.grade, hit.classNum);
                          }}
                          onMouseEnter={() => {
                            if (!isExtra && !isClassPinned && !pickedSlot && hit) {
                              setViewGrade(hit.grade);
                              setViewClass(hit.classNum);
                            }
                          }}
                          className={`h-8 min-h-[2rem] max-h-[2rem] p-1 border-r border-gray-100 text-[10px] transition-colors cursor-pointer select-none overflow-hidden ${
                            hit
                              ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-950 font-bold border border-indigo-200"
                              : "bg-white text-gray-300"
                          } ${
                            isDragOverTeacherThis
                              ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10"
                              : ""
                          } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                          title={hit ? `${hit.grade}학년 ${hit.classNum}반 ${hit.subjectName}` : undefined}
                        >
                          <div className="h-full flex items-center justify-center">
                            {hit ? `${hit.grade}-${hit.classNum}` : "—"}
                          </div>
                        </td>
                      );
                    }

                    // 일반 모드
                    return (
                      <td
                        key={d}
                        onClick={() => {
                          if (hit) {
                            setViewGrade(hit.grade);
                            setViewClass(hit.classNum);
                          }
                        }}
                        onMouseEnter={() => {
                          if (!isExtra && !isClassPinned && !pickedSlot && hit) {
                            setViewGrade(hit.grade);
                            setViewClass(hit.classNum);
                          }
                        }}
                        className={`h-8 min-h-[2rem] max-h-[2rem] p-1 border-r border-gray-100 text-[10px] overflow-hidden ${
                          hit ? "bg-indigo-100 hover:bg-indigo-200 text-indigo-950 font-bold cursor-pointer transition-colors" : "bg-white text-gray-300"
                        }`}
                        title={hit ? `${hit.grade}학년 ${hit.classNum}반 ${hit.subjectName}` : undefined}
                      >
                        <div className="h-full flex items-center justify-center">
                          {hit ? `${hit.grade}-${hit.classNum}` : "—"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    return (
      <div className="space-y-5 font-sans">
        {/* 상단 바 (컴시간 §8 재현: 명칭·배지·Undo/Redo·작업기록) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setOpenDraft(null)}
              className="text-xs text-gray-500 hover:text-gray-800 font-bold flex items-center gap-1"
            >
              ← 목록으로
            </button>
            <span className="font-extrabold text-sm text-gray-900 truncate">
              🧩 {meta.label}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* 배지 / 점수 */}
            <button
              onClick={() => setShowHardDetails((o) => !o)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border font-extrabold cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${hardBadgeColor(report.hard.length)}`}
              title="클릭하여 중대 문제 상세를 확인하거나 접습니다"
            >
              <span>중대 문제 {report.hard.length}건</span>
              <span className="text-xs">{showHardDetails ? "▲" : "▼"}</span>
            </button>
            <button
              onClick={() => setShowSoftDetails((o) => !o)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border font-extrabold cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${
                manualMode
                  ? "bg-indigo-100 text-indigo-950 border-indigo-300"
                  : "bg-amber-100 text-amber-900 border-amber-300"
              }`}
              title="클릭하여 감점 상세를 확인하거나 접습니다"
            >
              <span>
                {manualMode && manualStartScore !== null
                  ? `총점 ${report.soft.total}점 (시작 ${manualStartScore} · ${
                      report.soft.total - manualStartScore > 0
                        ? `+${(report.soft.total - manualStartScore).toFixed(1).replace(/\.0$/, "")}`
                        : (report.soft.total - manualStartScore).toFixed(1).replace(/\.0$/, "")
                    })`
                  : `감점 ${report.soft.total}점`}
              </span>
              <span className="text-xs">{showSoftDetails ? "▲" : "▼"}</span>
            </button>

            <div className="h-4 w-px bg-gray-200 mx-1" />

            {/* Undo / Redo / 작업기록 */}
            <button
              onClick={handleUndo}
              disabled={!canUndo || loadingDraft || savingOp}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 font-bold rounded-lg text-xs transition-all flex items-center gap-1"
              title="실행 취소 (Undo)"
            >
              <span>↩ 실행취소</span>
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo || loadingDraft || savingOp}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 font-bold rounded-lg text-xs transition-all flex items-center gap-1"
              title="다시 실행 (Redo)"
            >
              <span>↪ 다시실행</span>
            </button>
            <button
              onClick={() => setShowOpsHistory(true)}
              disabled={loadingDraft || savingOp}
              className="px-3 py-1 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 text-purple-800 font-bold rounded-lg text-xs border border-purple-200 transition-all"
            >
              📋 작업기록 ({meta.opCursor}/{meta.ops.length})
            </button>

            {/* 직접 조정 모드 토글 (스펙 §0-4: 1024px 미만 화면에서는 비활성 + 안내) */}
            <button
              disabled={savingOp || !isLgScreen}
              onClick={() => {
                if (!isLgScreen || savingOp) return;
                if (!manualMode) {
                  setManualMode(true);
                  setManualStartScore(report.soft.total);
                  setPickedSlot(null);
                  setCandidatesResult(null);
                  setBlockedBubble(null);
                } else {
                  setManualMode(false);
                  setPickedSlot(null);
                  setCandidatesResult(null);
                  setBlockedBubble(null);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1 font-bold rounded-lg text-xs transition-all border ${
                !isLgScreen
                  ? "bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed"
                  : manualMode
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200"
              } ${savingOp ? "opacity-50 cursor-not-allowed" : ""}`}
              title={
                !isLgScreen
                  ? "창을 넓히면 쓸 수 있어요"
                  : "시간표 직접 조정 모드 (두 시간표 나란히 보기 및 신호등 이동)"
              }
            >
              <span>직접 조정</span>
              <span>{!isLgScreen ? "🔒" : manualMode ? "⏻ 켜짐" : "⏻"}</span>
            </button>

            {/* 시간표 추가 버튼 (스펙 §2-2: 고정 전용 그리드 패널 최대 2개 추가, §0-6: 좁은 화면에서 사라지지 않고 비활성) */}
            <button
              disabled={!isLgScreen || !manualMode || savingOp || extraPanels.length >= 2}
              onClick={() => {
                if (!isLgScreen || !manualMode || savingOp || extraPanels.length >= 2 || !openDraft) return;
                const newId = `extra_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                const otherClass = viewClass === 1 ? 2 : 1;
                setExtraPanels((prev) => {
                  if (prev.length >= 2) return prev;
                  return [
                    ...prev,
                    {
                      id: newId,
                      type: "class",
                      grade: viewGrade,
                      classNum: otherClass,
                      teacherEmail: selectedTeacherEmail || allDraftTeachers[0]?.email || "",
                    },
                  ];
                });
              }}
              className={`flex items-center gap-1.5 px-3 py-1 font-bold rounded-lg text-xs transition-all border ${
                !isLgScreen
                  ? "bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed"
                  : !manualMode
                  ? "bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed"
                  : extraPanels.length >= 2
                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                  : "bg-white hover:bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs"
              } ${savingOp ? "opacity-50 cursor-not-allowed" : ""}`}
              title={
                !isLgScreen
                  ? "창을 넓히면 쓸 수 있어요"
                  : !manualMode
                  ? "직접 조정 모드를 켜면 시간표를 추가할 수 있습니다"
                  : extraPanels.length >= 2
                  ? "시간표는 최대 2개까지 추가할 수 있습니다"
                  : "비교하며 조정할 고정 시간표를 추가로 엽니다 (최대 2개)"
              }
            >
              <span>➕ 시간표 추가</span>
              {extraPanels.length > 0 && (
                <span className="bg-indigo-100 text-indigo-800 px-1.5 py-0.2 rounded-full text-[10px] font-extrabold">
                  {extraPanels.length}/2
                </span>
              )}
            </button>

            {/* 기초시간표로 채택 버튼 (spec §5) — 초안 학기(status: draft)에서만 노출 */}
            {isDraftTerm && (
              <button
                onClick={handleAdoptDraft}
                disabled={adopting || loadingDraft || savingOp || report.hard.length > 0 || currentTray.length > 0}
                className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center gap-1.5"
                title={
                  report.hard.length > 0
                    ? "중대 문제가 남아 있어 채택할 수 없습니다"
                    : currentTray.length > 0
                    ? `잠깐 빼둔 수업 ${currentTray.length}건이 남아 있어 채택할 수 없습니다`
                    : "이 결과를 정식 기초시간표로 채택합니다"
                }
              >
                <span>📥</span>
                <span>{adopting ? "채택 중..." : "기초시간표로 채택"}</span>
              </button>
            )}
          </div>
        </div>

        {draftError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold">
            {draftError}
          </div>
        )}



        {/* F-1 중대 문제 상세 패널 (E-1b AI 진단 카드와 동일 접이식 디자인) */}
        {showHardDetails && openDraft && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between bg-red-100/70 border-b border-red-200">
              <div className="flex items-center gap-2">
                <span className="text-base">🔴</span>
                <span className="text-xs font-bold text-red-950">중대 문제 상세 (총 {report.hard.length}건)</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-200 text-red-900 font-bold border border-red-300">
                  완성본을 위해 해결이 권장되는 위반 항목입니다
                </span>
              </div>
              <button
                onClick={() => setShowHardDetails(false)}
                className="text-red-700 hover:text-red-950 text-xs font-bold"
              >
                ▲ 접기
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              {report.hard.length === 0 ? (
                <div className="bg-white rounded-lg p-4 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-2">
                  <span>✅</span>
                  <span>중대 문제가 없습니다.</span>
                </div>
              ) : (
                (() => {
                  const grouped: Record<string, HardViolation[]> = {};
                  for (const h of report.hard) {
                    if (!grouped[h.code]) grouped[h.code] = [];
                    grouped[h.code].push(h);
                  }
                  return Object.entries(grouped).map(([code, items]) => {
                    const label = HARD_CODE_LABELS[code] || code;
                    const regularItems = items.filter((it) => !it.registryGap);
                    const gapItems = items.filter((it) => it.registryGap);

                    const renderItem = (item: HardViolation, idx: number) => {
                      const coordLabel = [
                        item.grade && item.classNum ? `${item.grade}-${item.classNum}반` : "",
                        item.day ? `${DAYS[item.day - 1]}요일` : "",
                        item.period ? `${item.period}교시` : "",
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <div
                          key={idx}
                          className="bg-white rounded-lg border border-red-100 p-3 flex flex-wrap items-start justify-between gap-2 shadow-2xs"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <p className="font-medium text-gray-900 leading-snug">{item.text}</p>
                            {item.hint && (
                              <p className="text-[11px] text-gray-500 font-normal">💡 {item.hint}</p>
                            )}
                          </div>
                          {coordLabel && (
                            <button
                              onClick={() => {
                                if (item.grade) setViewGrade(item.grade);
                                if (item.classNum) setViewClass(item.classNum);
                              }}
                              className="shrink-0 px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-900 font-bold text-[11px] border border-red-300 transition-colors flex items-center gap-1"
                              title="해당 위치로 이동"
                            >
                              <span>📍</span>
                              <span>{coordLabel}</span>
                            </button>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div key={code} className="space-y-2">
                        <div className="flex items-center gap-2 border-b border-red-200 pb-1">
                          <span className="font-extrabold text-red-900 text-xs">{code} ({label})</span>
                          <span className="text-xs font-extrabold px-2 py-0.2 rounded-full bg-red-200 text-red-900">
                            {items.length}건
                          </span>
                        </div>
                        {regularItems.map(renderItem)}

                        {gapItems.length > 0 && (
                          <details className="mt-2 text-xs group">
                            <summary className="cursor-pointer text-[11px] font-bold text-gray-600 hover:text-gray-900 py-1 flex items-center gap-1.5 select-none">
                              <span>📋</span>
                              <span>등록부 미비로 추정 ({gapItems.length}건)</span>
                              <span className="text-xs text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                            </summary>
                            <div className="mt-2 space-y-2 pl-3 border-l-2 border-amber-300">
                              {gapItems.map(renderItem)}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        )}

        {/* F-1 소프트 감점 상세 패널 */}
        {showSoftDetails && openDraft && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between bg-amber-100/70 border-b border-amber-200">
              <div className="flex items-center gap-2">
                <span className="text-base">🟡</span>
                <span className="text-xs font-bold text-amber-950">감점 상세 (총 {report.soft.total}점)</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold border border-amber-300">
                  시간표의 가독성 및 균형 감점 현황입니다
                </span>
              </div>
              <button
                onClick={() => setShowSoftDetails(false)}
                className="text-amber-700 hover:text-amber-950 text-xs font-bold"
              >
                ▲ 접기
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              {report.soft.details.length === 0 ? (
                <div className="bg-white rounded-lg p-4 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-2">
                  <span>✨</span>
                  <span>감점 항목이 없습니다.</span>
                </div>
              ) : (
                (() => {
                  const grouped: Record<string, typeof report.soft.details> = {};
                  for (const d of report.soft.details) {
                    if (!grouped[d.code]) grouped[d.code] = [];
                    grouped[d.code].push(d);
                  }

                  return Object.entries(grouped).map(([code, items]) => {
                    const label = SOFT_CODE_LABELS[code] || code;
                    const codeScore = (report.soft.byCode as Record<string, number>)[code] || items.reduce((acc, it) => acc + it.points, 0);
                    const sortedItems = [...items].sort((a, b) => b.points - a.points);

                    return (
                      <div key={code} className="space-y-2">
                        <div className="flex items-center justify-between border-b border-amber-200 pb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-amber-950 text-xs">{code} ({label})</span>
                            <span className="text-xs font-extrabold px-2 py-0.2 rounded-full bg-amber-200 text-amber-900">
                              {sortedItems.length}건
                            </span>
                          </div>
                          <span className="font-extrabold text-amber-800 text-xs">소계 -{codeScore}점</span>
                        </div>
                        <div className="space-y-1.5">
                          {sortedItems.map((item, idx) => {
                            // 객체 동일성 — code+key+day는 S2·S4에서 중복될 수 있다(handleFindFix 주석)
                            const isActive = activeFindDetail === item;
                            return (
                              <div key={idx}>
                                {/* 항목 행 (클릭 시 아래 그리드 즉시 세팅 — 과제 P) */}
                                <div
                                  onClick={() => handlePenaltyDetailClick(item)}
                                  className="bg-white hover:bg-amber-50/80 rounded-lg border border-amber-100 hover:border-amber-300 p-3 flex items-center justify-between gap-3 shadow-2xs cursor-pointer transition-all group"
                                  title="클릭하면 아래 시간표에서 해당 교사/학급으로 즉시 이동합니다"
                                >
                                  <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-amber-900 shrink-0">[{item.label}]</span>
                                    {item.day && (
                                      <span className="text-[11px] px-1.5 py-0.2 rounded bg-gray-100 group-hover:bg-amber-100 text-gray-700 group-hover:text-amber-900 font-semibold shrink-0 transition-colors">
                                        {DAYS[item.day - 1]}요일
                                      </span>
                                    )}
                                    <span className="text-gray-800">{item.text}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-extrabold text-amber-800 text-xs">−{item.points}점</span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleFindFix(item);
                                      }}
                                      disabled={findingFix}
                                      className={`px-2.5 py-1 rounded-md font-bold text-[11px] border transition-colors flex items-center gap-1 ${
                                        isActive
                                          ? "bg-amber-700 text-white border-amber-700"
                                          : "bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-300"
                                      } disabled:opacity-50`}
                                    >
                                      <span>🔍</span>
                                      <span>{isActive ? "닫기" : "해결안 찾기"}</span>
                                    </button>
                                  </div>
                                </div>

                                {/* 수읽기 엔진 (Lookahead L1) 기보 카드 — 항목 바로 아래 인라인 */}
                                {isActive && (
                                  <div className="mt-1.5 ml-3 border-l-2 border-amber-300 pl-3 space-y-2">
                                    {findingFix ? (
                                      <div className="py-3 flex items-center gap-2 text-xs text-amber-700 font-semibold">
                                        <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-amber-500 border-t-transparent" />
                                        <span>
                                          {lookaheadProgress && lookaheadProgress.evaluated > 0
                                            ? `${lookaheadProgress.evaluated}가지 수 탐색 중... (${isDeepSearch ? "더 깊이 읽기" : "수읽기"})`
                                            : isDeepSearch
                                            ? "더 깊은 수순(예산 3배)을 탐색하는 중..."
                                            : "수순(기보)을 탐색하는 중..."}
                                        </span>
                                      </div>
                                    ) : lookaheadChunkError ? (
                                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-900 space-y-1">
                                        <div className="font-bold flex items-center gap-1">
                                          <span>⚠️</span>
                                          <span>새 버전 배포로 수읽기 모듈을 불러오지 못했습니다.</span>
                                        </div>
                                        <p className="text-[11px] text-red-700">
                                          브라우저를 새로고침(F5)한 뒤 다시 시도해 주세요.
                                        </p>
                                      </div>
                                    ) : lookaheadResult === null ? null : lookaheadResult.lines.length === 0 ? (
                                      /* ── 해결안 없음 ── */
                                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-3.5 text-xs space-y-2.5">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="flex items-start gap-2 min-w-0">
                                            <span className="text-base mt-0.5 shrink-0">🔒</span>
                                            <div className="space-y-1">
                                              <p className="font-bold text-gray-800">
                                                {lookaheadResult.evaluated}가지 수를 읽었지만 이 감점을 줄이는 수순이 없습니다.
                                              </p>
                                              <p className="text-gray-600 leading-relaxed text-[11px]">
                                                {item.code === "S1" || item.code === "S4" || item.code === "S6"
                                                  ? `이 수업을 다른 요일로 옮기려면 그 날의 빈 교시가 필요합니다. 같은 학급 안의 이동·맞교환을 모두 탐색했지만, 전부 다른 조건(창체·SLAT 자리, 선생님 겹침)에 막혀 있습니다.`
                                                  : item.code === "S2"
                                                  ? `이 교사의 연속 수업을 분산하려면 같은 요일 내 빈 교시가 필요합니다. 빈 자리가 있더라도 옮겼을 때 다른 조건(교사 중복·운영 교시 초과)이 새로 생기면 후보에서 제외됩니다.`
                                                  : item.code === "S3"
                                                  ? `점심시간 전후 교시를 분리하려면 점심 블록 양쪽에서 맞바꿀 교시가 있어야 합니다. 가능한 교환이 모두 다른 조건에 막혀 있습니다.`
                                                  : item.code === "S5"
                                                  ? `이 요일의 과목 밀집을 풀려면 해당 수업을 다른 요일로 이동할 수 있어야 합니다. 현재 구조에서는 같은 학급 내에 적합한 빈 자리가 없습니다.`
                                                  : `이 감점은 다른 조건(창체·SLAT 자리표시, 교사 중복, 운영 교시 초과 등)에 묶여 있어 단일/다단 교환으로는 줄이기 어렵습니다.`}
                                              </p>
                                            </div>
                                          </div>
                                          {!isDeepSearch && (
                                            <button
                                              onClick={() => handleFindFix(item, true)}
                                              disabled={findingFix || savingOp}
                                              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-2xs transition-colors flex items-center gap-1 disabled:opacity-50"
                                              title="탐색 범위를 3배로 늘려 더 깊은 수순을 탐색합니다"
                                            >
                                              <span>🔍</span>
                                              <span>더 깊이 읽기</span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      /* ── 기보(Line) 목록 — 상위 최대 3개 ── */
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between text-xs text-amber-900 px-1">
                                          <span className="font-semibold text-[11px]">
                                            총 {lookaheadResult.lines.length}개 기보 제안 ({lookaheadResult.evaluated}가지 수 탐색 완료)
                                          </span>
                                          {!isDeepSearch && lookaheadResult.budgetExhausted && (
                                            <button
                                              onClick={() => handleFindFix(item, true)}
                                              disabled={findingFix || savingOp}
                                              className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-[11px] border border-amber-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                                              title="탐색 범위를 3배로 늘려 추가 수순을 탐색합니다"
                                            >
                                              <span>🔍 더 깊이 읽기</span>
                                            </button>
                                          )}
                                        </div>

                                        {lookaheadResult.lines.slice(0, 3).map((line, li) => {
                                          const isSingleStep = line.ops.length === 1;
                                          return (
                                            <div
                                              key={li}
                                              className="bg-white rounded-lg border border-amber-200 p-3 space-y-2.5 shadow-2xs hover:border-amber-400 transition-all"
                                            >
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                                  <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0">
                                                    {li + 1}
                                                  </span>
                                                  <span className="text-xs font-bold text-gray-900">
                                                    기보 {li + 1} ({line.ops.length}수)
                                                  </span>
                                                  {/* §0-5: 순증(나빠짐)이면 총점 경고 딱지가 가장 먼저 오고, 해소/감소 딱지는 뒤로 배치 */}
                                                  {line.finalDelta > 0 && (
                                                    <span className="text-[11px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                                      총점 {line.finalDelta}점 나빠짐
                                                    </span>
                                                  )}
                                                  <span className="text-[11px] font-bold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                                                    이 감점 {line.targetDelta < 0 ? `${line.targetDelta}점` : `+${line.targetDelta}점`}
                                                  </span>
                                                  {line.finalDelta <= 0 && (
                                                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                                      {line.finalDelta < 0
                                                        ? `총점 ${Math.abs(line.finalDelta)}점 개선`
                                                        : "점수 유지"}
                                                    </span>
                                                  )}
                                                  {line.targetResolved && (
                                                    <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                                                      ✅ 이 감점 해소
                                                    </span>
                                                  )}
                                                </div>

                                                {/* 조작 버튼 */}
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                  {/* 1. 한 수씩 밟기 (기본) */}
                                                  <button
                                                    disabled={savingOp}
                                                    onClick={() => handleApplyLineStep(line, 0)}
                                                    className="px-2.5 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-xs border border-indigo-200 transition-colors disabled:opacity-50 flex items-center gap-1"
                                                    title={isSingleStep ? "이 수순을 적용합니다" : "첫 번째 수를 적용하고 다음 수를 확인합니다"}
                                                  >
                                                    <span>▶</span>
                                                    <span>{isSingleStep ? "적용하기" : "1수 적용"}</span>
                                                  </button>

                                                  {/* 2. 전체 적용 (2수 이상일 때) */}
                                                  {!isSingleStep && (
                                                    <button
                                                      disabled={savingOp}
                                                      onClick={() => handleApplyLineAll(line)}
                                                      className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1"
                                                      title={`${line.ops.length}수 전체를 한 번에 적용합니다`}
                                                    >
                                                      <span>⏩</span>
                                                      <span>전체 적용 ({line.ops.length}수)</span>
                                                    </button>
                                                  )}
                                                </div>
                                              </div>

                                              {/* 상세 정보 컨테이너 */}
                                              <div className="bg-gray-50 rounded-md p-2.5 space-y-2 border border-gray-100">
                                                {/* 변경 위치 (수별 미니 그리드 + 과목/교사 연쇄 시각화 — 스펙 §0-1) */}
                                                <div className="flex items-center gap-2.5 flex-wrap">
                                                  {(() => {
                                                    if (!openDraft?.currentGrids) return null;
                                                    const simBoard = cloneClassGrids(openDraft.currentGrids);
                                                    const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

                                                    return (
                                                      <div className="flex items-center gap-2 flex-wrap">
                                                        {line.ops.map((op, opIdx) => {
                                                          if (op.type !== "swap") return null;

                                                          const g = simBoard.find((x) => x.grade === op.grade && x.classNum === op.classNum);
                                                          const c1 = g?.cells?.find((c) => c.day === op.a.day && c.period === op.a.period);
                                                          const c2 = g?.cells?.find((c) => c.day === op.b.day && c.period === op.b.period);
                                                          const l1 = c1?.lessons?.[0];
                                                          const l2 = c2?.lessons?.[0];

                                                          const t1 = l1?.teachers?.map((t) => t.name).join(", ") || (l1 ? "교사 미상" : "");
                                                          const t2 = l2?.teachers?.map((t) => t.name).join(", ") || (l2 ? "교사 미상" : "");
                                                          const s1 = l1?.subjectName || "빈 칸";
                                                          const s2 = l2?.subjectName || "빈 칸";

                                                          const name1 = t1 ? `${s1}(${t1})` : s1;
                                                          const name2 = t2 ? `${s2}(${t2})` : s2;

                                                          const num1 = opIdx * 2 + 1;
                                                          const num2 = opIdx * 2 + 2;
                                                          const c1Label = circled[num1 - 1] || `${num1}.`;
                                                          const c2Label = circled[num2 - 1] || `${num2}.`;

                                                          const stepCells = [
                                                            { day: op.a.day, period: op.a.period, label: String(num1), color: "bg-indigo-600 text-white" },
                                                            { day: op.b.day, period: op.b.period, label: String(num2), color: "bg-amber-600 text-white" },
                                                          ];

                                                          // 다음 수를 위해 현재 수를 simBoard에 적용
                                                          applyRevisionOps(simBoard, [op]);

                                                          return (
                                                            <Fragment key={opIdx}>
                                                              {opIdx > 0 && (
                                                                <span className="text-amber-500 font-extrabold text-sm shrink-0">→</span>
                                                              )}
                                                              <div className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs flex-wrap">
                                                                {line.ops.length > 1 && (
                                                                  <span className="text-[10px] font-extrabold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                                                                    {opIdx + 1}수
                                                                  </span>
                                                                )}
                                                                <span className="text-[11px] font-bold text-gray-700 shrink-0">
                                                                  {op.grade}학년 {op.classNum}반
                                                                </span>
                                                                <HistoryMiniGrid
                                                                  highlightCells={stepCells}
                                                                  periods={periodsPerDay}
                                                                />
                                                                <div className="flex items-center gap-1 flex-wrap text-xs">
                                                                  <span className="font-bold text-indigo-900 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                                                    {c1Label} {name1}
                                                                  </span>
                                                                  <span className="text-gray-400 font-bold">↔</span>
                                                                  <span className="font-bold text-amber-900 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                                                    {c2Label} {name2}
                                                                  </span>
                                                                </div>
                                                              </div>
                                                            </Fragment>
                                                          );
                                                        })}
                                                      </div>
                                                    );
                                                  })()}
                                                </div>

                                                {/* 총점 변화 추이 (1수 및 다수 기보 공통) */}
                                                <div className="flex items-center gap-1 text-[11px] text-gray-600 font-medium flex-wrap">
                                                  <span className="font-bold text-gray-500">총점 변화:</span>
                                                  <span className="font-mono font-bold text-gray-700">
                                                    {openDraft?.report.soft.total}점
                                                  </span>
                                                  {line.stepScores.map((score, si) => (
                                                    <span key={si} className="font-mono font-bold text-indigo-700 flex items-center gap-0.5">
                                                      <span>→</span>
                                                      <span>{score}점</span>
                                                    </span>
                                                  ))}
                                                  <span className="ml-1 text-[11px] font-bold text-emerald-700 font-mono">
                                                    ({line.finalDelta < 0 ? `${line.finalDelta}점` : line.finalDelta === 0 ? "0점" : `+${line.finalDelta}점`})
                                                  </span>
                                                </div>

                                                {/* 대가 줄 (다른 감점 변화) */}
                                                <div className="pt-1.5 border-t border-gray-200/80 space-y-1">
                                                  <div className="text-[11px] font-bold text-gray-700">
                                                    이 수를 두면 다른 감점이 이렇게 바뀝니다:
                                                  </div>
                                                  {line.sideEffects && line.sideEffects.length > 0 ? (
                                                    <div className="space-y-1">
                                                      {line.sideEffects.map((se, sei) => {
                                                        const isWorse = se.kind === "new" || se.kind === "worse";
                                                        return (
                                                          <div
                                                            key={sei}
                                                            className={`flex items-center justify-between gap-2 px-2 py-1 rounded text-[11px] ${
                                                              isWorse
                                                                ? "bg-amber-50 text-amber-950 border border-amber-200"
                                                                : "bg-emerald-50 text-emerald-950 border border-emerald-200"
                                                            }`}
                                                          >
                                                            <span className="flex items-center gap-1 min-w-0">
                                                              <span className="shrink-0">{isWorse ? "⚠️" : "✅"}</span>
                                                              <span className="font-semibold text-gray-800 truncate">{se.text}</span>
                                                            </span>
                                                            <span
                                                              className={`font-mono font-bold shrink-0 ${
                                                                isWorse ? "text-amber-800" : "text-emerald-700"
                                                              }`}
                                                            >
                                                              {se.delta > 0 ? `+${se.delta}점` : `${se.delta}점`}
                                                            </span>
                                                          </div>
                                                        );
                                                      })}
                                                      {!line.sideEffects.some((s) => s.kind === "new" || s.kind === "worse") && (
                                                        <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 flex items-center gap-1">
                                                          <span>✅</span>
                                                          <span>다른 감점이 늘어나지 않습니다</span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  ) : (
                                                    <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 flex items-center gap-1">
                                                      <span>✅</span>
                                                      <span>다른 감점이 늘어나지 않습니다</span>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        )}



        {/* 미배정 배정 알림 팁 */}
        {selectedUnplaced && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 text-xs text-indigo-900 flex items-center justify-between font-bold">
            <span>
              🎯 미배정 수업 [<strong>{selectedUnplaced.label}</strong>] 배정 모드 — 시간표 상 원하는 셀을 클릭해 배정하세요.
            </span>
            <button
              onClick={() => setSelectedUnplaced(null)}
              className="text-indigo-600 hover:underline text-[11px]"
            >
              배정 취소 ✕
            </button>
          </div>
        )}

        {/* 그리드 레이아웃: 일반 모드는 8:4 분할, 직접 조정 모드는 1:1 동급 병치 (스펙 §2-2) */}
        <div className={`grid grid-cols-1 ${manualMode || extraPanels.length > 0 ? "lg:grid-cols-2" : "xl:grid-cols-12"} gap-5`}>
          {/* 좌: 학급 그리드 Ⓐ */}
          <div ref={classGridRef} className={`${manualMode || extraPanels.length > 0 ? "lg:col-span-1" : "xl:col-span-8"} space-y-4`}>
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-700">학년:</span>
                  {[1, 2, 3].map((g) => (
                    <button
                      key={g}
                      onClick={() => {
                        setViewGrade(g);
                        const available = Array.from(
                          new Set(
                            openDraft.currentGrids
                              .filter((grid) => grid.grade === g)
                              .map((grid) => grid.classNum)
                          )
                        ).sort((a, b) => a - b);
                        if (available.length > 0 && !available.includes(viewClass)) {
                          setViewClass(available[0]);
                        }
                        setPickedSlot(null);
                        setCandidatesResult(null);
                        setBlockedBubble(null);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                        viewGrade === g
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {g}학년
                    </button>
                  ))}
                  <span className="text-xs font-bold text-gray-700 ml-3">반:</span>
                  {Array.from(
                    new Set(
                      openDraft.currentGrids
                        .filter((g) => g.grade === viewGrade)
                        .map((g) => g.classNum)
                    )
                  )
                    .sort((a, b) => a - b)
                    .map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setViewClass(c);
                          setPickedSlot(null);
                          setCandidatesResult(null);
                          setBlockedBubble(null);
                        }}
                        className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${
                          viewClass === c
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {c}
                      </button>
                    ))}

                  {/* 📌 학급 고정 토글 버튼 */}
                  <button
                    type="button"
                    onClick={() => setIsClassPinned((prev) => !prev)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ml-1 ${
                      isClassPinned
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-300"
                        : "bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600"
                    }`}
                    title={
                      isClassPinned
                        ? "학급 시간표가 고정돼 있어 마우스를 올려도 바뀌지 않습니다 (누르면 해제)"
                        : "누르면 현재 학급 시간표를 고정합니다 (교사 시간표에 마우스를 올려도 유지)"
                    }
                  >
                    <span>📌</span>
                    <span>{isClassPinned ? "학급 고정됨" : "학급 고정"}</span>
                  </button>
                </div>

                {/* 상태 문구 / 집은 수업 표시 */}
                {manualMode ? (
                  selectedParkedEntry ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200">
                      <span>
                        📌 [빼둔 수업 복귀] {selectedParkedEntry.grade}-{selectedParkedEntry.classNum}반{" "}
                        {selectedParkedEntry.lessons[0]?.subjectShort || selectedParkedEntry.lessons[0]?.subjectName}
                        {selectedParkedEntry.lessons[0]?.teachers?.[0]?.name
                          ? ` (${selectedParkedEntry.lessons[0].teachers[0].name})`
                          : ""}
                      </span>
                      <button
                        onClick={() => setSelectedParkedEntry(null)}
                        className="text-sky-600 hover:text-sky-950 ml-1 font-extrabold"
                        title="선택 해제 (Esc)"
                      >
                        ✕
                      </button>
                    </div>
                  ) : pickedSlot ? (
                    <div className="flex items-center gap-1.5 text-xs font-bold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200">
                      <span>
                        📌 {chainSteps.length > 0 ? `[연쇄 ${chainSteps.length + 1}수째] ` : ""}집은 수업:{" "}
                        {pickedSlot.lesson.subjectShort || pickedSlot.lesson.subjectName}
                        {pickedSlot.lesson.teachers?.[0]?.name ? ` (${pickedSlot.lesson.teachers[0].name})` : ""}
                      </span>
                      <button
                        onClick={() => {
                          if (chainSteps.length > 0 && chainStartGrids) {
                            setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
                            setChainSteps([]);
                            setChainStartGrids(null);
                            setHeldParkId(null);
                          }
                          setPickedSlot(null);
                          setHeldParkId(null);
                          setCandidatesResult(null);
                          setBlockedBubble(null);
                        }}
                        className="text-sky-600 hover:text-sky-950 ml-1 font-extrabold"
                        title={chainSteps.length > 0 ? "연쇄 취소 (원상 복원, Esc)" : "집기 해제 (Esc)"}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
                      직접 조정 모드: 옮길 수업을 클릭하거나 우클릭으로 빼두세요
                    </span>
                  )
                ) : (
                  <span className="text-[11px] font-bold text-gray-500 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200">
                    열람 모드: 셀을 가리키거나 클릭하면 교사 주간 시간표가 표시됩니다
                  </span>
                )}
              </div>

              {/* 말풍선 안내 (alert 대체 — 스펙 §2-3) */}
              {blockedBubble && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-2.5 text-xs flex items-center justify-between gap-2 shadow-2xs animate-fade-in">
                  <div className="flex items-start gap-1.5 font-bold min-w-0 flex-1">
                    <span className="text-sm shrink-0">💬</span>
                    <span className="break-keep leading-snug">{blockedBubble.message}</span>
                  </div>
                  <button
                    onClick={() => setBlockedBubble(null)}
                    className="text-amber-700 hover:text-amber-950 font-bold px-1.5 py-0.5 rounded text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* 그리드 테이블 */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto shadow-xs">
              {renderClassGridTable(viewGrade, viewClass, false)}
            </div>
          </div>

          {/* 우: 교사 그리드 Ⓑ */}
          <div ref={teacherGridRef} className={`${manualMode || extraPanels.length > 0 ? "lg:col-span-1" : "xl:col-span-4"} space-y-4`}>
            {/* 교사 파생 그리드 카드 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
                <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <span>👤 {selectedTeacherName ? `${selectedTeacherName} 선생님` : "교사"} 주간 시간표</span>
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTeacherPinned((prev) => !prev)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 shrink-0 ${
                      isTeacherPinned
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700 ring-1 ring-indigo-300"
                        : "bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600"
                    }`}
                    title={
                      isTeacherPinned
                        ? "교사 시간표가 고정돼 있어 마우스를 올려도 바뀌지 않습니다 (누르면 해제)"
                        : "누르면 현재 교사 시간표를 고정합니다 (학급 시간표에 마우스를 올려도 유지)"
                    }
                  >
                    <span>📌</span>
                    <span>{isTeacherPinned ? "교사 고정됨" : "교사 고정"}</span>
                  </button>
                  {manualMode ? (
                    <select
                      value={selectedTeacherEmail || ""}
                      onChange={(e) => setSelectedTeacherEmail(e.target.value || null)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white font-bold text-gray-700 max-w-[12rem] truncate"
                    >
                      <option value="">교사 선택...</option>
                      {allDraftTeachers.map((t) => (
                        <option key={t.email} value={t.email}>
                          {t.name} ({t.email.split("@")[0]})
                        </option>
                      ))}
                    </select>
                  ) : (
                    selectedTeacherEmail && (
                      <span className="text-[11px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                        {selectedTeacherName} 선생님
                      </span>
                    )
                  )}
                </div>
              </div>

              {renderTeacherGridTable(selectedTeacherEmail, false)}
            </div>
          </div>

          {/* 추가 고정 시간표 패널 (스펙 §2-2: 최대 2개) */}
          {manualMode &&
            extraPanels.map((panel) => {
              return (
                <div key={panel.id} className="lg:col-span-1 space-y-4">
                  <div className="bg-white rounded-xl border border-indigo-200 p-4 space-y-3 shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* 학급 / 교사 전환 탭 */}
                        <div className="flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-[11px] font-bold">
                          <button
                            type="button"
                            onClick={() =>
                              setExtraPanels((prev) =>
                                prev.map((p) => (p.id === panel.id ? { ...p, type: "class" } : p))
                              )
                            }
                            className={`px-2 py-0.5 rounded-md transition-all ${
                              panel.type === "class"
                                ? "bg-white text-indigo-700 shadow-2xs"
                                : "text-gray-600 hover:text-gray-900"
                            }`}
                          >
                            학급
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExtraPanels((prev) =>
                                prev.map((p) => (p.id === panel.id ? { ...p, type: "teacher" } : p))
                              )
                            }
                            className={`px-2 py-0.5 rounded-md transition-all ${
                              panel.type === "teacher"
                                ? "bg-white text-indigo-700 shadow-2xs"
                                : "text-gray-600 hover:text-gray-900"
                            }`}
                          >
                            교사
                          </button>
                        </div>

                        {panel.type === "class" ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={panel.grade}
                              onChange={(e) => {
                                const newG = parseInt(e.target.value, 10);
                                setExtraPanels((prev) =>
                                  prev.map((p) => (p.id === panel.id ? { ...p, grade: newG } : p))
                                );
                              }}
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white font-bold text-gray-700"
                            >
                              {[1, 2, 3].map((g) => (
                                <option key={g} value={g}>
                                  {g}학년
                                </option>
                              ))}
                            </select>
                            <select
                              value={panel.classNum}
                              onChange={(e) => {
                                const newC = parseInt(e.target.value, 10);
                                setExtraPanels((prev) =>
                                  prev.map((p) => (p.id === panel.id ? { ...p, classNum: newC } : p))
                                );
                              }}
                              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white font-bold text-gray-700"
                            >
                              {Array.from(
                                new Set(
                                  openDraft.currentGrids
                                    .filter((g) => g.grade === panel.grade)
                                    .map((g) => g.classNum)
                                )
                              )
                                .sort((a, b) => a - b)
                                .map((c) => (
                                  <option key={c} value={c}>
                                    {c}반
                                  </option>
                                ))}
                            </select>
                          </div>
                        ) : (
                          <select
                            value={panel.teacherEmail}
                            onChange={(e) => {
                              const newEmail = e.target.value;
                              setExtraPanels((prev) =>
                                prev.map((p) => (p.id === panel.id ? { ...p, teacherEmail: newEmail } : p))
                              );
                            }}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white font-bold text-gray-700 max-w-[12rem] truncate"
                          >
                            <option value="">교사 선택...</option>
                            {allDraftTeachers.map((t) => (
                              <option key={t.email} value={t.email}>
                                {t.name} ({t.email.split("@")[0]})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg flex items-center gap-1">
                          <span>📌</span>
                          <span>고정됨</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setExtraPanels((prev) => prev.filter((p) => p.id !== panel.id))}
                          className="text-gray-400 hover:text-gray-700 font-bold px-2 py-1 rounded-lg hover:bg-gray-100 text-xs transition-colors"
                          title="추가 시간표 닫기"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {panel.type === "class"
                      ? renderClassGridTable(panel.grade, panel.classNum, true)
                      : renderTeacherGridTable(panel.teacherEmail, true)}
                  </div>
                </div>
              );
            })}
        </div>

        {/* 미배정 목록 카드 (스펙 §2-2: 그리드 컬럼 밖 독립 배치 — 추가 패널 개수와 무관하게 자리가 고정됨) */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                <span>📭 편성 미배정 수업 목록</span>
              </h4>
              <span className="text-[11px] text-gray-500 font-normal">
                편성할 때 자리를 찾지 못한 수업입니다 (직접 뺀 수업은 아래 「잠깐 빼둔 수업」 트레이에 보관됩니다).
              </span>
            </div>
            {meta.unplaced.length > 0 && (
              <span className="bg-red-100 text-red-800 text-[11px] px-2 py-0.5 rounded-full font-extrabold border border-red-300">
                {meta.unplaced.length}건
              </span>
            )}
          </div>

          {meta.unplaced.length === 0 ? (
            <div className="py-3 text-center text-xs text-emerald-700 font-bold bg-emerald-50/50 rounded-lg">
              ✅ 편성 시 미배정된 수업이 없습니다 (모든 수업이 시간표에 배정되었습니다).
            </div>
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {meta.unplaced.map((u) => {
                const isSelected = selectedUnplaced?.sectionId === u.sectionId;
                const unplacedTarget = resolveUnplacedTarget(u, {
                  grade: viewGrade,
                  classNum: viewClass,
                });
                const targetGrade = unplacedTarget.grade;
                const targetClass = unplacedTarget.classNum;

                return (
                  <div
                    key={u.sectionId}
                    draggable={manualMode && isLgScreen && !savingOp}
                    onDragStart={(e) => {
                      if (!isLgScreen || savingOp) return;
                      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "unplaced", unplaced: u }));
                      e.dataTransfer.effectAllowed = "move";
                      setDragSource({ type: "unplaced", unplaced: u });
                      if (chainSteps.length > 0 && chainStartGrids) {
                        setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
                        setChainSteps([]);
                        setChainStartGrids(null);
                        setHeldParkId(null);
                      }
                      setSelectedParkedEntry(null);
                      setPickedSlot(null);
                      setHeldParkId(null);
                      setManualMode(true);
                      setSelectedUnplaced(u);

                      setViewGrade(targetGrade);
                      setViewClass(targetClass);

                      const res = evaluateHeldCandidates({
                        grids: openDraft.currentGrids,
                        model: openDraft.model,
                        held: {
                          grade: targetGrade,
                          classNum: targetClass,
                          lessons: unplacedTarget.lessons,
                        },
                      });
                      setCandidatesResult(res);
                      setBlockedBubble(null);
                    }}
                    onDragEnd={() => {
                      setDragSource(null);
                      setDragOverCell(null);
                    }}
                    className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? "bg-indigo-100 border-indigo-500 ring-2 ring-indigo-400/50"
                        : "bg-red-50/80 border-red-200 hover:border-red-300"
                    } ${savingOp ? "opacity-60" : ""}`}
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-red-950 truncate">{u.label}</p>
                      <p className="text-[11px] text-red-700 font-semibold mt-0.5">
                        잔여 {u.remaining}시수 미배정
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <button
                        disabled={!isLgScreen || savingOp}
                        onClick={() => {
                          if (!isLgScreen || savingOp) return;
                          if (isSelected) {
                            setSelectedUnplaced(null);
                            setCandidatesResult(null);
                          } else {
                            if (chainSteps.length > 0 && chainStartGrids) {
                              setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
                              setChainSteps([]);
                              setChainStartGrids(null);
                              setHeldParkId(null);
                            }
                            setSelectedParkedEntry(null);
                            setPickedSlot(null);
                            setHeldParkId(null);
                            setManualMode(true);
                            setSelectedUnplaced(u);

                            setViewGrade(targetGrade);
                            setViewClass(targetClass);

                            const res = evaluateHeldCandidates({
                              grids: openDraft.currentGrids,
                              model: openDraft.model,
                              held: {
                                grade: targetGrade,
                                classNum: targetClass,
                                lessons: unplacedTarget.lessons,
                              },
                            });
                            setCandidatesResult(res);
                            setBlockedBubble(null);
                          }
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-bold shadow-xs transition-all ${
                          !isLgScreen || savingOp
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                            : isSelected
                            ? "bg-indigo-600 text-white"
                            : "bg-red-600 hover:bg-red-700 text-white"
                        }`}
                      >
                        {isSelected ? "선택됨" : "배정하기"}
                      </button>
                      {!isLgScreen && (
                        <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                          넓은 화면에서 쓸 수 있어요
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Ⓒ 잠깐 빼둔 수업 트레이 (스펙 §2-5) */}
        {manualMode && (
          <div
            onDragOver={(e) => {
              if (dragSource?.type === "cell" && !savingOp) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (!isTrayDragOver) setIsTrayDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsTrayDragOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsTrayDragOver(false);
              if (dragSource?.type === "cell" && !savingOp) {
                const { grade, classNum, day, period } = dragSource;
                setDragSource(null);
                handleParkCell(grade, classNum, day, period);
              }
            }}
            onClick={() => {
              if (savingOp) return;
              if (pickedSlot) {
                handleParkCell(pickedSlot.grade, pickedSlot.classNum, pickedSlot.day, pickedSlot.period);
              }
            }}
            className={`rounded-xl border transition-all p-3.5 ${
              isTrayDragOver
                ? "bg-amber-100/90 border-2 border-dashed border-amber-500 ring-2 ring-amber-400 scale-[1.005]"
                : pickedSlot
                ? "bg-amber-50/80 border-amber-300 ring-2 ring-amber-300/60 cursor-pointer hover:bg-amber-100/80"
                : currentTray.length > 0
                ? "bg-amber-50/40 border-amber-200"
                : "bg-gray-50/80 border-dashed border-gray-200"
            } ${savingOp ? "opacity-75" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <span>📥</span>
                  <span>잠깐 빼둔 수업</span>
                </span>
                {isTrayDragOver ? (
                  <span className="text-xs font-bold text-amber-900 bg-amber-200 px-2 py-0.5 rounded-full animate-pulse">
                    📥 놓아서 잠깐 빼두기
                  </span>
                ) : currentTray.length > 0 ? (
                  <span className="text-[11px] px-2 py-0.2 rounded-full bg-amber-200 text-amber-900 font-extrabold border border-amber-300">
                    {currentTray.length}건
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-400 font-normal">
                    {pickedSlot
                      ? "여기를 클릭하거나 드래그해 놓으면 지금 집은 수업을 보관합니다"
                      : "수업 셀을 우클릭하거나 여기로 드래그하면 임시로 보관합니다"}
                  </span>
                )}
              </div>
              {selectedParkedEntry && (
                <div className="flex items-center gap-1.5 text-xs text-sky-800 bg-sky-100 px-2 py-0.5 rounded-lg font-bold">
                  <span>
                    선택: {selectedParkedEntry.grade}-{selectedParkedEntry.classNum}반{" "}
                    {selectedParkedEntry.lessons[0]?.subjectShort || selectedParkedEntry.lessons[0]?.subjectName} (시간표의 빈 칸을 클릭하거나 드래그해 배치하세요)
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedParkedEntry(null);
                    }}
                    className="text-sky-700 hover:text-sky-950 font-bold ml-1"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {currentTray.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2.5">
                {currentTray.map((entry) => {
                  const lesson = entry.lessons[0];
                  const isSelected = selectedParkedEntry?.parkId === entry.parkId;
                  return (
                    <div
                      key={entry.parkId}
                      draggable={manualMode && !savingOp}
                      onDragStart={(e) => {
                        if (savingOp) return;
                        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "tray", entry }));
                        e.dataTransfer.effectAllowed = "move";
                        setDragSource({ type: "tray", entry });
                        if (chainSteps.length > 0 && chainStartGrids) {
                          setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
                          setChainSteps([]);
                          setChainStartGrids(null);
                          setHeldParkId(null);
                        }
                        setSelectedParkedEntry(entry);
                        setViewGrade(entry.grade);
                        setViewClass(entry.classNum);
                        setPickedSlot(null);
                        setHeldParkId(null);
                        const res = evaluateHeldCandidates({
                          grids: openDraft.currentGrids,
                          model: openDraft.model,
                          held: { grade: entry.grade, classNum: entry.classNum, lessons: entry.lessons },
                        });
                        setCandidatesResult(res);
                        setBlockedBubble(null);
                      }}
                      onDragEnd={() => {
                        setDragSource(null);
                        setDragOverCell(null);
                      }}
                      onClick={(e) => {
                        if (savingOp) return;
                        e.stopPropagation();
                        if (isSelected) {
                          setSelectedParkedEntry(null);
                          setCandidatesResult(null);
                        } else {
                          if (chainSteps.length > 0 && chainStartGrids) {
                            setOpenDraft((prev) => (prev ? { ...prev, currentGrids: chainStartGrids } : null));
                            setChainSteps([]);
                            setChainStartGrids(null);
                            setHeldParkId(null);
                          }
                          setSelectedParkedEntry(entry);
                          setViewGrade(entry.grade);
                          setViewClass(entry.classNum);
                          setPickedSlot(null);
                          setHeldParkId(null);
                          const res = evaluateHeldCandidates({
                            grids: openDraft.currentGrids,
                            model: openDraft.model,
                            held: { grade: entry.grade, classNum: entry.classNum, lessons: entry.lessons },
                          });
                          setCandidatesResult(res);
                          setBlockedBubble(null);
                        }
                      }}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-2xs ${
                        isSelected
                          ? "bg-sky-100 text-sky-950 border-sky-400 ring-2 ring-sky-300"
                          : "bg-white hover:bg-amber-100/80 text-gray-800 border-amber-200"
                      } ${savingOp ? "opacity-60 pointer-events-none" : ""}`}
                      title="클릭하거나 드래그하여 학급 시간표의 빈 칸에 배치하거나, ✕를 눌러 원래 자리로 복귀를 시도합니다"
                    >
                      <span className="cursor-grab active:cursor-grabbing">
                        {entry.grade}-{entry.classNum}반 {lesson?.subjectShort || lesson?.subjectName || "수업"}
                        {lesson?.teachers?.[0]?.name ? ` (${lesson.teachers[0].name})` : ""}
                      </span>
                      <button
                        disabled={savingOp}
                        onClick={async (e) => {
                          if (savingOp) return;
                          e.stopPropagation();
                          // 원래 자리로 unpark 시도
                          await handleUnparkCell(entry, entry.from.day, entry.from.period);
                        }}
                        className="text-gray-400 hover:text-red-600 font-bold px-1 py-0.2 rounded hover:bg-red-50 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
                        title="원래 자리로 되돌리기"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 연쇄 영향 다이얼로그 모달 (Impact Modal - 컴시간 §8-다 재현) */}
        {impactAnalysis && proposedOp && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-4 font-sans">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <span>⚡ 연쇄 영향 미리보기 및 확인</span>
                </h3>
                <button
                  onClick={() => {
                    setImpactAnalysis(null);
                    setProposedOp(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 font-bold text-sm"
                >
                  ✕
                </button>
              </div>

              {/* 변경 내용 요약 */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
                <span className="font-bold text-gray-700">작업 내용:</span>
                <p className="font-semibold text-indigo-900">{impactAnalysis.opDescription}</p>
              </div>

              {/* 중대 문제 (하드 위반) 경고 — 차단 조건 */}
              {impactAnalysis.newHards.length > 0 ? (
                <div className="p-4 bg-red-50 border-2 border-red-300 rounded-xl space-y-2 text-xs">
                  <div className="font-extrabold text-red-900 flex items-center gap-1.5 text-sm">
                    <span>🛑 중대 문제 발생 (이동 실행 비활성)</span>
                  </div>
                  <p className="text-red-700 leading-relaxed font-semibold">
                    이 이동/맞교환을 적용하면 시간표에 해결할 수 없는 중대 문제가 새로 발생합니다:
                  </p>
                  <ul className="list-disc pl-5 text-red-800 space-y-1 font-bold">
                    {impactAnalysis.newHards.map((h, idx) => (
                      <li key={idx}>
                        [{h.code}] {h.text}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-red-600 font-semibold pt-1">
                    💡 중대한 문제가 생기는 이동은 실행할 수 없습니다.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 font-bold flex items-center gap-2">
                  <span>✅ 중대 문제 없음 — 정상 적용 가능합니다.</span>
                </div>
              )}

              {/* 소프트 점수 변화 */}
              <div className="p-3.5 border border-gray-200 rounded-xl text-xs space-y-2 bg-white">
                <div className="flex justify-between items-center font-bold">
                  <span className="text-gray-700">감점 변화:</span>
                  <div className="space-x-2">
                    <span className="text-gray-500">{impactAnalysis.oldSoftTotal}점</span>
                    <span>→</span>
                    <span className="text-indigo-900 font-black">{impactAnalysis.newSoftTotal}점</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${
                        impactAnalysis.deltaScore <= 0
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {impactAnalysis.deltaScore <= 0
                        ? `${Math.abs(impactAnalysis.deltaScore)}점 개선`
                        : `${impactAnalysis.deltaScore}점 증가`}
                    </span>
                  </div>
                </div>
              </div>

              {opApiError && (
                <div className="p-3 bg-red-100 text-red-900 border border-red-300 rounded-lg text-xs font-bold">
                  ⚠️ {opApiError}
                </div>
              )}

              {/* 버튼 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setImpactAnalysis(null);
                    setProposedOp(null);
                  }}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition-all"
                >
                  취소
                </button>
                <button
                  onClick={handleApplyOp}
                  disabled={impactAnalysis.newHards.length > 0 || savingOp}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-xs transition-all shadow-sm flex items-center justify-center gap-1.5"
                >
                  {savingOp && (
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                  )}
                  <span>
                    {impactAnalysis.newHards.length > 0
                      ? "중대 문제로 실행 비활성"
                      : "이동/교환 적용"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 작업기록 열람 모달 */}
        {showOpsHistory && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-xl w-full p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-900">📋 초안 작업기록 열람</h3>
                  <span className="text-xs text-gray-500 font-medium">
                    (총 {meta.ops.length}건 중 {meta.opCursor}건 반영됨)
                  </span>
                </div>
                <button onClick={() => setShowOpsHistory(false)} className="text-gray-400 hover:text-gray-600 font-bold">
                  ✕
                </button>
              </div>

              {meta.ops.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">기록된 수동 조정 연산이 없습니다.</p>
              ) : (
                <div className="space-y-2.5 max-h-[60vh] overflow-y-auto text-xs pr-1">
                  {historyDetails.map((item) => (
                    <div
                      key={item.idx}
                      className={`p-3 rounded-xl border transition-all ${
                        item.isCurrent
                          ? "bg-purple-50/80 border-purple-400 ring-1 ring-purple-400 shadow-2xs"
                          : item.isApplied
                          ? "bg-white border-gray-200 hover:border-gray-300 shadow-2xs"
                          : "bg-gray-50/70 border-gray-200 opacity-60 line-through"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {/* 미니 그리드 (위치 시각화) */}
                          <HistoryMiniGrid highlightCells={item.gridCells} periods={periodsPerDay} />

                          {/* 내용 (제목 + 수업 과목 및 교사) */}
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-xs text-gray-900">
                                #{item.idx + 1} {item.title}
                              </span>
                              {item.isCurrent && (
                                <span className="text-[10px] bg-purple-700 text-white font-extrabold px-1.5 py-0.5 rounded-full">
                                  현재 지점
                                </span>
                              )}
                            </div>
                            <div>{item.lessonNode}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowOpsHistory(false)}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 font-bold rounded-xl text-xs text-gray-700"
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 초안 목록 화면 ──
  return (
    <div className="space-y-6 font-sans">
      {/* 안내 박스 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 text-indigo-900 text-xs leading-relaxed space-y-1">
        <div className="font-bold text-sm flex items-center gap-1.5">
          <span>🧩</span>
          <span>시간표 편성 및 직접 조정</span>
        </div>
        <p>
          작성된 초안을 바탕으로 수업을 직접 옮기거나 연쇄 조정을 거쳐 충돌 없는 완성본을 만듭니다.
        </p>
        <p className="text-[11px] text-indigo-700 font-semibold">
          💡 선생님 수업 시간이 겹치거나 규칙에 어긋나는 이동은 실행이 자동으로 차단됩니다.
        </p>
      </div>

      {/* ── 시수 계획 기반 자동 작성 ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
            <span>🎯</span>
            <span>시수 계획으로 새로 짜기</span>
          </h4>
          {plans.length > 0 && (
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="text-xs px-2.5 py-1 bg-white border border-gray-300 rounded-md font-medium text-gray-800 shadow-xs focus:ring-1 focus:ring-indigo-500"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.rowCount}개 수업)
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-[11px] text-gray-500 font-normal">
          신학기 수업 시수 계획과 학교 공통 시간을 결합해 시간표를 백지에서 새로 짭니다.
        </p>
        {plans.length === 0 && !loadingPlans && (
          <div className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
            이 학기로 지정된 시수 계획이 없습니다. 「수업 시수」에서 먼저 만들어 주세요.
          </div>
        )}
      </div>

      {/* 실행 버튼 */}
      <div className="flex flex-wrap gap-3">
        {!running ? (
          <>
            <button
              onClick={handlePreflight}
              disabled={plans.length === 0 || preflightLoading}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2"
            >
              {preflightLoading ? (
                <>
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                  <span>확인 중...</span>
                </>
              ) : (
                <>
                  <span>✨</span>
                  <span>시수 계획으로 자동으로 초안 만들기</span>
                </>
              )}
            </button>
            <button
              onClick={handleCopy}
              disabled={hasBaseGrids === false}
              className="px-4 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-bold rounded-xl text-xs border border-gray-300 shadow-sm transition-all flex items-center gap-2"
              title={hasBaseGrids === false ? "이 학기에는 아직 기초 시간표가 없어 복제할 수 없습니다." : undefined}
            >
              <span>📋 현행 시간표 복제로 시작</span>
            </button>
          </>
        ) : (
          <button
            onClick={handleCancelSolver}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2"
          >
            <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
            <span>취소</span>
          </button>
        )}
      </div>

      {/* 시수 계획 백지 편성 사전 확인 모달 (phase9c_i_spec §7) */}
      {preflightModalOpen && preflightData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h3 className="text-sm font-bold text-gray-900">짜기 전에 확인해 주세요</h3>
              </div>
              <button
                onClick={() => setPreflightModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-base"
              >
                ✕
              </button>
            </div>

            {/* 기본 요약 */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-xs text-indigo-950 font-medium space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-sm text-indigo-900">
                <span>📊</span>
                <span>{preflightData.planLabel}</span>
              </div>
              <p className="text-xs font-semibold text-indigo-800">
                {preflightData.stats.classCount}개 학급 · 주 {preflightData.stats.totalHours}시간 · 교육과정 고정 {preflightData.stats.fixedSlotCount}칸
              </p>
              {preflightData.stats.droppedVirtual > 0 && (
                <p className="text-[11px] text-indigo-700 bg-white/70 p-2 rounded-lg border border-indigo-200/60">
                  ℹ️ 교육과정에서 자동으로 채우는 시간 {preflightData.stats.droppedVirtual}개는 계획 대신 교육과정 등록 내용을 씁니다.
                </p>
              )}
            </div>

            {/* 코호트 누락 학년 경고 */}
            {preflightData.stats.cohortMissingGrades.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>교육과정 미등록 학년 안내</span>
                </div>
                <p className="text-[11px] text-amber-800">
                  {preflightData.stats.cohortMissingGrades.join(", ")}학년의 학교 공통 시간이 등록돼 있지 않습니다. 창체·SLAT 자리가 비게 됩니다.
                </p>
              </div>
            )}

            {/* 학년도별 변경 부적용 안내 (fixed_slot_override_spec §2 — 교육과정이 바뀌어 옛 변경이 비켜난 경우) */}
            {(preflightData.stats.overrideSkips?.length ?? 0) > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>학교 공통 시간 학년도별 변경이 적용되지 않은 학년</span>
                </div>
                {preflightData.stats.overrideSkips!.map((s) => (
                  <p key={`${s.overrideId}-${s.grade}`} className="text-[11px] text-amber-800">
                    「{s.label}」은 {s.grade}학년에 적용되지 않았습니다 — 만들 당시와 지금의 {s.grade}학년
                    교육과정이 다릅니다. 이 학년은 교육과정에 등록된 배치를 따랐습니다. 학교 공통 시간
                    화면에서 확인해 주세요.
                  </p>
                ))}
              </div>
            )}

            {/* 이슈 목록 분리 렌더링 (로드맵 9c-I 2026-08-15 사용자 피드백) */}
            {(() => {
              const handlingCodes = new Set([
                "simul-assumed",
                "venue-slot-limited",
                "fixed-standalone",
                "venue-hours-block-adjust",
              ]);
              const handlingIssues = preflightData.issues.filter((i) => handlingCodes.has(i.code));
              const warningIssues = preflightData.issues.filter((i) => !handlingCodes.has(i.code));

              return (
                <div className="space-y-3">
                  {/* 1. 시스템 처리 안내 ("이렇게 처리합니다 N건") */}
                  {handlingIssues.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                        <span className="flex items-center gap-1.5">
                          <span>ℹ️</span>
                          <span>이렇게 처리합니다 {handlingIssues.length}건</span>
                        </span>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1 text-xs">
                        {handlingIssues.map((issue, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded-lg border bg-slate-50 border-slate-200 text-slate-700 text-xs leading-relaxed"
                          >
                            <p className="font-medium">{issue.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 2. 조치 필요 점검 ("짜기 전에 살펴볼 점 N건") */}
                  {warningIssues.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                        <span className="flex items-center gap-1.5">
                          <span>⚠️</span>
                          <span>짜기 전에 살펴볼 점 {warningIssues.length}건</span>
                        </span>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1 pr-1 text-xs">
                        {warningIssues.map((issue, idx) => {
                          const isError =
                            issue.code === "fixed-missing" ||
                            issue.code === "simul-unsolved" ||
                            issue.code === "class-slot-mismatch";
                          return (
                            <div
                              key={idx}
                              className={`p-2 rounded-lg border text-xs leading-relaxed ${
                                isError
                                  ? "bg-red-50 border-red-200 text-red-900"
                                  : "bg-amber-50 border-amber-200 text-amber-900"
                              }`}
                            >
                              <p className="font-medium">{issue.text}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {preflightData.issues.length === 0 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 font-semibold flex items-center gap-2">
                      <span>✅</span>
                      <span>특이사항 없이 바로 시간표를 짤 수 있는 상태입니다.</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setPreflightModalOpen(false)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition-all"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSolveFromPlan}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center justify-center gap-1.5"
              >
                <span>이대로 짜기</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 진행률 바 */}
      {running && progress && (
        <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-3">
          <div className="flex justify-between items-center text-xs font-bold text-indigo-900">
            <span>⚙️ {phaseLabel(progress.phase)}</span>
            {progress.total > 0 && (
              <span>
                {progress.done} / {progress.total}
              </span>
            )}
          </div>
          {progress.total > 0 && (
            <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (progress.done / progress.total) * 100).toFixed(1)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {solverError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">⚠️</span>
            <span>{solverError.message}</span>
          </div>
          {solverError.isChunkError && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xs shrink-0 transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              <span>🔄</span>
              <span>새로고침</span>
            </button>
          )}
        </div>
      )}

      {/* 초안 목록 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <span>📂 저장된 초안 목록</span>
            <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full font-bold">
              {drafts.length}건
            </span>
          </h3>
          <button
            onClick={fetchDrafts}
            disabled={loadingList}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
          >
            🔄 새로고침
          </button>
        </div>

        {listError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold">
            {listError}
          </div>
        )}

        {loadingList ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-xs text-gray-500 font-semibold">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-indigo-600 border-t-transparent mb-3" />
            <p>초안 목록을 불러오는 중...</p>
          </div>
        ) : drafts.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-12 text-center text-xs text-gray-400">
            <p className="font-semibold text-base mb-1">저장된 초안이 없습니다</p>
            <p>시수 계획으로 새로 시간표를 작성하거나, 등록된 기초 시간표를 복제해 시작하세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {drafts.map((draft) => {
              const report = draft.lastReport;
              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl border border-gray-200 hover:border-indigo-300 p-5 space-y-3 shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">{draft.label}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {draft.origin.kind === "solver"
                          ? `🤖 자동 편성 (시드 ${draft.origin.seed ?? "—"})`
                          : "📋 현행 복제"}
                      </p>
                    </div>
                    {report && (
                      <span
                        className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border font-extrabold ${hardBadgeColor(report.hardCount)}`}
                      >
                        중대 문제 {report.hardCount}
                      </span>
                    )}
                  </div>

                  {report && (
                    <div className="flex gap-2 text-[11px]">
                      <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded font-bold">
                        감점 {report.softTotal}점
                      </span>
                      {draft.unplaced.length > 0 && (
                        <span className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-800 rounded font-bold">
                          미배정 {draft.unplaced.length}건
                        </span>
                      )}
                    </div>
                  )}

                  <div className="text-[11px] text-gray-400">
                    최종 수정: {fmtTime(draft.updatedAt)}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleOpen(draft)}
                      disabled={loadingDraft}
                      className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-all disabled:opacity-50"
                    >
                      {loadingDraft ? "열기 중..." : "열기 →"}
                    </button>
                    <button
                      onClick={() => handleDelete(draft)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg text-xs transition-all border border-red-200"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
