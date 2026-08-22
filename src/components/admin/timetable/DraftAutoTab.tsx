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

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  findFixCandidates,
  FixCandidate,
  findFixPlanAsync,
  type FixPlan,
  type AskFixProgress,
} from "@/lib/timetable/fixFinder";
import {
  ASK_FIX_EXAMPLES,
  type AiDiagnoseResult,
  type AiExplainResult,
  type AiAskFixResult,
} from "@/lib/timetable/ai";
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

  // ── AI 불능 진단 상태 (E-1b) ──
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null); // null=미확인, false=키없음
  const [aiDiagnosis, setAiDiagnosis] = useState<AiDiagnoseResult | null>(null);
  const [aiDiagnosing, setAiDiagnosing] = useState(false);
  const [aiDiagError, setAiDiagError] = useState<string | null>(null);
  const [aiCardOpen, setAiCardOpen] = useState(false);

  // ── AI 결과 설명 상태 (E-3) ──
  const [aiExplain, setAiExplain] = useState<AiExplainResult | null>(null);
  const [aiExplaining, setAiExplaining] = useState(false);
  const [aiExplainError, setAiExplainError] = useState<string | null>(null);
  const [aiExplainCardOpen, setAiExplainCardOpen] = useState(false);

  // ── 물어보고 고치기 상태 (ask-fix) ──
  const [askFixCardOpen, setAskFixCardOpen] = useState(false);
  const [askFixText, setAskFixText] = useState("");
  const [askFixInterpreting, setAskFixInterpreting] = useState(false);
  const [findingPlan, setFindingPlan] = useState(false);
  const [askFixProgress, setAskFixProgress] = useState<AskFixProgress | null>(null);
  const [askFixResult, setAskFixResult] = useState<AiAskFixResult | null>(null);
  const [askFixPlan, setAskFixPlan] = useState<FixPlan | null>(null);
  const [askFixError, setAskFixError] = useState<string | null>(null);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const [appliedStepIndex, setAppliedStepIndex] = useState(0);
  const [applyPlanError, setApplyPlanError] = useState<string | null>(null);
  const [applyPlanSuccessMsg, setApplyPlanSuccessMsg] = useState<string | null>(null);

  // ── F-2 해결안 탐색 상태 ──
  /** 현재 [해결안 찾기]가 열려 있는 감점 항목 */
  const [activeFindDetail, setActiveFindDetail] = useState<TermPenaltyDetail | null>(null);
  /** findFixCandidates 결과 (동기) */
  const [fixCandidates, setFixCandidates] = useState<FixCandidate[] | null>(null);
  /** 탐색 중 여부 — 동기지만 state 전환 전 render를 위해 */
  const [findingFix, setFindingFix] = useState(false);

  // ── 직접 조정 모드 상태 (timetable_manual_move_spec §2 · §4 M1) ──
  const [manualMode, setManualMode] = useState(false);
  const [manualStartScore, setManualStartScore] = useState<number | null>(null);
  const [isLgScreen, setIsLgScreen] = useState(true);

  useEffect(() => {
    const checkWidth = () => {
      const isLg = typeof window !== "undefined" && window.innerWidth >= 1024;
      setIsLgScreen(isLg);
      if (!isLg) {
        setManualMode(false);
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

  // 초안 전환·닫기 시 AI 및 직접 조정 상태 초기화
  const openDraftId = openDraft?.meta.id;
  useEffect(() => {
    setAiDiagnosis(null);
    setAiDiagError(null);
    setAiCardOpen(false);
    setAiExplain(null);
    setAiExplainError(null);
    setAiExplainCardOpen(false);
    setAskFixText("");
    setAskFixInterpreting(false);
    setFindingPlan(false);
    setAskFixProgress(null);
    setAskFixResult(null);
    setAskFixPlan(null);
    setAskFixError(null);
    setApplyingPlan(false);
    setAppliedStepIndex(0);
    setApplyPlanError(null);
    setApplyPlanSuccessMsg(null);
    setAskFixCardOpen(false);
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
    setFixCandidates(null);
    setFindingFix(false);
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
    setSelectedUnplaced(null);
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
      alert(`하드 제약 위반이 ${report.hard.length}건 남아 있어 기초시간표로 채택할 수 없습니다. 위반 사항을 먼저 해결해주세요.`);
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
    if (!openDraft || openDraft.meta.opCursor <= 0) return;
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
    if (!openDraft || openDraft.meta.opCursor >= openDraft.meta.ops.length) return;
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

  // 세 AI 기능이 에러 배너 하나를 공유하는데 각자 자기 오류만 지우면, 한 기능에서 난 오류가
  // 다른 기능이 성공한 뒤에도 배너에 남아 "경고가 계속 뜬다"로 보인다 (2026-08-12 실사용 신고).
  // 어떤 AI 동작이든 시작할 때 세 오류를 함께 지운다.
  const clearAiErrors = () => {
    setAiDiagError(null);
    setAiExplainError(null);
    setAskFixError(null);
    setApplyPlanError(null);
  };

  // ── AI 불능 진단 호출 (E-1b) ──
  const handleAiDiagnose = async () => {
    if (!openDraft) return;
    setAiDiagnosing(true);
    clearAiErrors();
    setAiDiagnosis(null);
    setAiCardOpen(false);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_diagnose", draftId: openDraft.meta.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "AI 진단 중 오류가 발생했습니다.");
      if (data.enabled === false) {
        setAiEnabled(false);
        return;
      }
      setAiEnabled(true);
      setAiDiagnosis(data.result ?? null);
      setAiCardOpen(true);
    } catch (err: any) {
      setAiDiagError(err.message);
    } finally {
      setAiDiagnosing(false);
    }
  };

  // ── AI 결과 설명 호출 (E-3) ──
  const handleAiExplain = async () => {
    if (!openDraft) return;
    setAiExplaining(true);
    clearAiErrors();
    setAiExplain(null);
    setAiExplainCardOpen(false);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_explain", draftId: openDraft.meta.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "AI 설명 생성 중 오류가 발생했습니다.");
      if (data.enabled === false) {
        setAiEnabled(false);
        return;
      }
      setAiEnabled(true);
      setAiExplain(data.result ?? null);
      setAiExplainCardOpen(true);
    } catch (err: any) {
      setAiExplainError(err.message);
    } finally {
      setAiExplaining(false);
    }
  };

  // ── 물어보고 고치기 호출 (ask-fix) ──
  const handleAskFix = async (customText?: string) => {
    if (!openDraft) return;
    const textToAsk = (customText ?? askFixText).trim();
    if (!textToAsk) return;

    setAskFixText(textToAsk);
    setAskFixInterpreting(true);
    clearAiErrors();
    setAskFixResult(null);
    setAskFixPlan(null);
    setAskFixProgress(null);
    setApplyPlanSuccessMsg(null);

    try {
      // 1. 질문 해석 (서버 1회 호출)
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_ask_fix",
          draftId: openDraft.meta.id,
          aiText: textToAsk,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "질문 해석 중 오류가 발생했습니다.");
      }
      if (data.enabled === false) {
        setAiEnabled(false);
        return;
      }
      setAiEnabled(true);

      const result: AiAskFixResult = data.result;
      setAskFixResult(result);

      // 2. 수순 탐색 (화면에서 비동기 계산 — 서버 호출 없음)
      if (result.goal) {
        setFindingPlan(true);
        const { baseGrids, meta, model, currentGrids } = openDraft;
        const plan = await findFixPlanAsync(
          {
            baseGrids,
            ops: meta.ops.slice(0, meta.opCursor),
            currentGrids,
            model,
            goal: result.goal,
          },
          (p) => setAskFixProgress(p)
        );
        setAskFixPlan(plan);
      }
    } catch (err: any) {
      setAskFixError(err.message || String(err));
    } finally {
      setAskFixInterpreting(false);
      setFindingPlan(false);
    }
  };

  // ── 물어보고 고치기 수순 전체 순차 적용 ──
  const handleApplyFixPlan = async () => {
    if (!openDraft || !askFixPlan || askFixPlan.steps.length === 0) return;
    setApplyingPlan(true);
    setApplyPlanError(null);
    setApplyPlanSuccessMsg(null);

    let currentOpenDraft = openDraft;
    let appliedCount = 0;

    try {
      for (let i = 0; i < askFixPlan.steps.length; i++) {
        const step = askFixPlan.steps[i];
        const res = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "draft_op",
            draftId: currentOpenDraft.meta.id,
            draftOp: step.op,
            // 동시 편집 선행조건 — 단계 i는 시작 커서+i를 기준으로 만든 op다
            expectedOpCursor: currentOpenDraft.meta.opCursor + i,
          }),
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(
            `${i + 1}단계 적용 중 오류 발생: ${data.error || "적용에 실패했습니다."}`
          );
        }

        currentOpenDraft = {
          meta: data.meta,
          baseGrids: data.baseGrids,
          currentGrids: data.currentGrids,
          report: data.report,
          model: currentOpenDraft.model,
        };
        setOpenDraft(currentOpenDraft);
        appliedCount = i + 1;
        setAppliedStepIndex(appliedCount);
      }

      setApplyPlanSuccessMsg(
        `총 ${appliedCount}단계의 변경이 모두 적용되었습니다. 상단 [↩ 실행취소] 버튼으로 한 수씩 되돌릴 수 있습니다.`
      );
      setAskFixPlan(null);
    } catch (err: any) {
      setApplyPlanError(
        `${appliedCount > 0 ? `${appliedCount}단계까지 적용된 후 ` : ""}${err.message || String(err)}`
      );
    } finally {
      setApplyingPlan(false);
    }
  };

  // ── F-2 해결안 탐색 ──
  /**
   * 감점 항목 한 건을 지목해 findFixCandidates를 동기로 호출한다.
   * 같은 항목을 다시 누르면 닫힘 토글. 결과는 항목 아래에 인라인으로 표시.
   */
  const handleFindFix = (detail: TermPenaltyDetail) => {
    if (!openDraft) return;
    // 같은 항목 토글 — **객체 동일성**으로 판정한다. code+key+day는 유일하지 않다:
    // S2는 한 교사·한 요일에 연속 블록이 둘이면 2건(검사기 validate.ts 연속 블록 루프),
    // S4는 한 학급·한 요일에 중복 과목이 둘이면 2건이 나온다. 세 필드로 비교하면 둘째 항목의
    // 버튼이 첫째의 '닫기'로 동작해 **그 감점은 영영 탐색되지 않는다.**
    // 목록은 report.soft.details의 원본 참조를 그대로 렌더링하므로 참조 비교가 정확하다.
    if (activeFindDetail === detail) {
      setActiveFindDetail(null);
      setFixCandidates(null);
      return;
    }
    setActiveFindDetail(detail);
    setFixCandidates(null);
    setFindingFix(true);

    // 동기 실행 — 실측 중앙 64ms·최대 173ms (§2-6)
    const { baseGrids, meta, model, currentGrids } = openDraft;
    const ops = meta.ops.slice(0, meta.opCursor);
    const candidates = findFixCandidates({
      baseGrids,
      ops,
      currentGrids,
      model,
      target: detail,
    });
    setFixCandidates(candidates);
    setFindingFix(false);
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
        setBlockedBubble({
          message: "다른 창이 먼저 수정했습니다. 최신 초안을 다시 불러옵니다.",
        });
        await handleOpen(prevDraft.meta);
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
    const tokens = u.label.split(" ");
    const classToken = tokens[0] || "";
    const subjectToken = tokens[1] || "미배정과목";
    const teacherToken = tokens[2] || "";
    const [gStr, cStr] = classToken.replace(/반$/, "").split("-");
    const grade = parseInt(gStr, 10) || viewGrade;
    const classNum = parseInt(cStr, 10) || viewClass;

    const opToSend: BaseRevisionOp = {
      type: "edit_cell",
      grade,
      classNum,
      day: targetDay,
      period: targetPeriod,
      lessons: [
        {
          subjectName: subjectToken,
          subjectShort: subjectToken,
          teachers: [{ email: "", name: teacherToken }],
        },
      ],
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

  const handleCellRightClick = (day: number, period: number) => {
    if (!openDraft || savingOp) return;
    const grid = openDraft.currentGrids.find((g) => g.grade === viewGrade && g.classNum === viewClass);
    const cell = grid?.cells?.find((c) => c.day === day && c.period === period);
    const lesson = cell?.lessons?.[0];
    if (!lesson) return;

    handleParkCell(viewGrade, viewClass, day, period);
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
  const handleCellClick = async (day: number, period: number) => {
    if (!openDraft || savingOp) return;
    const { currentGrids } = openDraft;
    const grid = currentGrids.find((g) => g.grade === viewGrade && g.classNum === viewClass);
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
          pick: { grade: viewGrade, classNum: viewClass, day, period },
        });
        if (res.pickBlocked) {
          setBlockedBubble({ day, period, message: res.pickBlocked });
          return;
        }
        setPickedSlot({ grade: viewGrade, classNum: viewClass, day, period, lesson });
        setCandidatesResult(res);
        setChainSteps([]);
        setChainStartGrids(cloneClassGrids(currentGrids));
        setHeldParkId(null);
        setBlockedBubble(null);
        if (lesson.teachers?.[0]?.email) {
          setSelectedTeacherEmail(lesson.teachers[0].email);
        }
        return;
      }

      // 이미 집은 상태
      if (
        pickedSlot.grade === viewGrade &&
        pickedSlot.classNum === viewClass &&
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
      //    - 연쇄 비활성이면 단독 swap op 전송
      //    - 연쇄 중이면 마지막 unpark 합류 후 chain op 전송 (과제 Q-2 ③)
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
      //    - 연쇄 비활성 상태에서 즉시 swap op 전송 (M1 동작 복원 — 과제 Q-2 ①)
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
      const targetG = updatedGrids.find((g) => g.grade === viewGrade && g.classNum === viewClass);
      if (!targetG) return;

      const parkId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      let nextChainSteps: ChainStep[];

      if (chainSteps.length === 0) {
        // 최초 밀어내기 (연쇄 시작):
        // steps = [park(목적지), swap(원위치->목적지)]
        const stepPark: ChainStep = {
          kind: "park",
          parkId,
          grade: viewGrade,
          classNum: viewClass,
          day,
          period,
        };
        const stepSwap: ChainStep = {
          kind: "swap",
          grade: viewGrade,
          classNum: viewClass,
          a: { day: pickedSlot.day, period: pickedSlot.period },
          b: { day, period },
        };
        nextChainSteps = [stepPark, stepSwap];

        // 로컬 미리보기 그리드 갱신: 원위치 비우고 목적지에 내 수업 배치
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
        // steps = [...이전steps, park(새목적지), unpark(이전parkId->새목적지)]
        const stepPark: ChainStep = {
          kind: "park",
          parkId,
          grade: viewGrade,
          classNum: viewClass,
          day,
          period,
        };
        const stepUnpark: ChainStep = {
          kind: "unpark",
          parkId: heldParkId!,
          grade: viewGrade,
          classNum: viewClass,
          day,
          period,
        };
        nextChainSteps = [...chainSteps, stepPark, stepUnpark];

        // 로컬 미리보기 그리드 갱신: 새 목적지에 이전에 들고 있던 수업 배치
        let cellB = targetG.cells.find((c) => c.day === day && c.period === period);
        if (!cellB) {
          cellB = { day, period, lessons: [] };
          targetG.cells.push(cellB);
        }
        cellB.lessons = [pickedSlot.lesson];
      }

      const newPicked = {
        grade: viewGrade,
        classNum: viewClass,
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
        held: { grade: viewGrade, classNum: viewClass, lessons: [lesson] },
      });
      setCandidatesResult(newRes);
      setBlockedBubble(null);

      if (lesson.teachers?.[0]?.email) {
        setSelectedTeacherEmail(lesson.teachers[0].email);
      }
      return;
    }

    // ── 열람 모드 (manualMode 꺼짐: 교사 주간 시간표 연동 등 열람 동작만) ──
    if (lesson?.teachers?.[0]?.email) {
      setSelectedTeacherEmail(lesson.teachers[0].email);
    }
  };

  // ── 교사 그리드 셀 클릭 핸들러 (직접 조정 모드) ──
  const handleTeacherCellClick = async (day: number, period: number) => {
    if (!openDraft || !manualMode || savingOp) return;
    const { currentGrids } = openDraft;

    // 미배정 수업 배정 모드인 경우
    if (selectedUnplaced) {
      const tokens = selectedUnplaced.label.split(" ");
      const classToken = tokens[0] || "";
      const [gStr, cStr] = classToken.replace(/반$/, "").split("-");
      const unplacedGrade = parseInt(gStr, 10) || viewGrade;
      const unplacedClass = parseInt(cStr, 10) || viewClass;

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
      const hit = teacherSlots.find((s) => s.day === day && s.period === period);
      if (!hit) {
        setBlockedBubble({ day, period, message: "선택한 교사의 수업이 없는 빈 칸입니다." });
        return;
      }
      setViewGrade(hit.grade);
      setViewClass(hit.classNum);
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
    if (
      pickedSlot.grade === viewGrade &&
      pickedSlot.classNum === viewClass &&
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

    const targetGrid = currentGrids.find((g) => g.grade === viewGrade && g.classNum === viewClass);
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
    const targetG = updatedGrids.find((g) => g.grade === viewGrade && g.classNum === viewClass);
    if (!targetG) return;

    const parkId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let nextChainSteps: ChainStep[];

    if (chainSteps.length === 0) {
      const stepPark: ChainStep = {
        kind: "park",
        parkId,
        grade: viewGrade,
        classNum: viewClass,
        day,
        period,
      };
      const stepSwap: ChainStep = {
        kind: "swap",
        grade: viewGrade,
        classNum: viewClass,
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
        grade: viewGrade,
        classNum: viewClass,
        day,
        period,
      };
      const stepUnpark: ChainStep = {
        kind: "unpark",
        parkId: heldParkId!,
        grade: viewGrade,
        classNum: viewClass,
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
      grade: viewGrade,
      classNum: viewClass,
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
      held: { grade: viewGrade, classNum: viewClass, lessons: [targetLesson] },
    });
    setCandidatesResult(newRes);
    setBlockedBubble(null);
    if (targetLesson.teachers?.[0]?.email) {
      setSelectedTeacherEmail(targetLesson.teachers[0].email);
    }
  };

  // ── op 연쇄 영향 다이얼로그에서 [적용하기] 실행 ──
  const handleApplyOp = async () => {
    if (!openDraft || !proposedOp) return;
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
              title="클릭하여 하드 위반 상세를 확인하거나 접습니다"
            >
              <span>하드 위반 {report.hard.length}건</span>
              <span className="text-xs">{showHardDetails ? "▲" : "▼"}</span>
            </button>
            <button
              onClick={() => setShowSoftDetails((o) => !o)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border font-extrabold cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${
                manualMode
                  ? "bg-indigo-100 text-indigo-950 border-indigo-300"
                  : "bg-amber-100 text-amber-900 border-amber-300"
              }`}
              title="클릭하여 소프트 감점 상세를 확인하거나 접습니다"
            >
              <span>
                {manualMode && manualStartScore !== null
                  ? `총점 ${report.soft.total}점 (시작 ${manualStartScore} · ${
                      report.soft.total - manualStartScore > 0
                        ? `+${(report.soft.total - manualStartScore).toFixed(1).replace(/\.0$/, "")}`
                        : (report.soft.total - manualStartScore).toFixed(1).replace(/\.0$/, "")
                    })`
                  : `소프트 ${report.soft.total}점`}
              </span>
              <span className="text-xs">{showSoftDetails ? "▲" : "▼"}</span>
            </button>

            {/* AI 원인 진단 버튼 — 하드 > 0 이고 키 설정 시에만 노출 (E-1b) */}
            {report.hard.length > 0 && aiEnabled !== false && (
              <button
                onClick={handleAiDiagnose}
                disabled={aiDiagnosing}
                className="px-3 py-1 bg-violet-50 hover:bg-violet-100 disabled:opacity-60 text-violet-800 font-bold rounded-lg text-xs border border-violet-300 transition-all flex items-center gap-1.5"
                title="AI가 하드 위반 원인을 분석합니다 (참고용)"
              >
                {aiDiagnosing ? (
                  <>
                    <span className="animate-spin rounded-full h-3 w-3 border-2 border-violet-600 border-t-transparent" />
                    <span>분석 중...</span>
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    <span>원인 진단 (AI 도움)</span>
                  </>
                )}
              </button>
            )}

            {/* E-3 결과 설명 버튼 — 키 설정 시에만 노출 */}
            {aiEnabled !== false && (
              <button
                onClick={handleAiExplain}
                disabled={aiExplaining || askFixInterpreting || findingPlan}
                className="px-3 py-1 bg-sky-50 hover:bg-sky-100 disabled:opacity-60 text-sky-800 font-bold rounded-lg text-xs border border-sky-300 transition-all flex items-center gap-1.5"
                title="이 시간표가 어떻게 배치됐는지 설명합니다 (참고용)"
              >
                {aiExplaining ? (
                  <>
                    <span className="animate-spin rounded-full h-3 w-3 border-2 border-sky-600 border-t-transparent" />
                    <span>설명 생성 중...</span>
                  </>
                ) : (
                  <>
                    <span>💬</span>
                    <span>이 시간표 설명 (AI 도움)</span>
                  </>
                )}
              </button>
            )}

            {/* 물어보고 고치기 버튼 — 키 설정 시에만 노출 */}
            {aiEnabled !== false && (
              <button
                onClick={() => setAskFixCardOpen((o) => !o)}
                disabled={askFixInterpreting || findingPlan || aiExplaining || aiDiagnosing}
                className="px-3 py-1 bg-purple-50 hover:bg-purple-100 disabled:opacity-60 text-purple-800 font-bold rounded-lg text-xs border border-purple-300 transition-all flex items-center gap-1.5"
                title="시간표에서 해결하고 싶은 문제를 말로 질문하고 맞교환 수순을 찾습니다 (참고용)"
              >
                {askFixInterpreting ? (
                  <>
                    <span className="animate-spin rounded-full h-3 w-3 border-2 border-purple-600 border-t-transparent" />
                    <span>질문 해석 중...</span>
                  </>
                ) : findingPlan ? (
                  <>
                    <span className="animate-spin rounded-full h-3 w-3 border-2 border-purple-600 border-t-transparent" />
                    <span>방법 찾는 중...</span>
                  </>
                ) : (
                  <>
                    <span>💡</span>
                    <span>물어보고 고치기 (AI 도움)</span>
                  </>
                )}
              </button>
            )}

            {/* 버튼이 조용히 사라지면 고장으로 오해한다 — 사라진 자리에 이유를 한 줄 남긴다 */}
            {aiEnabled === false && (
              <span className="text-[11px] text-gray-500 font-medium">
                AI 도움 기능이 아직 설정되지 않아 사용할 수 없습니다.
              </span>
            )}

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

            {/* 직접 조정 모드 토글 (스펙 §0-4: 1024px 미만 화면에서는 미표시) */}
            <button
              disabled={savingOp}
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
              className={`hidden lg:flex items-center gap-1.5 px-3 py-1 font-bold rounded-lg text-xs transition-all border ${
                manualMode
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200"
              } ${savingOp ? "opacity-50 cursor-not-allowed" : ""}`}
              title="시간표 직접 조정 모드 (두 그리드 병치 및 신호등 이동)"
            >
              <span>직접 조정</span>
              <span>{manualMode ? "⏻ 켜짐" : "⏻"}</span>
            </button>

            {/* 기초시간표로 채택 버튼 (spec §5) — 초안 학기(status: draft)에서만 노출 */}
            {isDraftTerm && (
              <button
                onClick={handleAdoptDraft}
                disabled={adopting || loadingDraft || savingOp || report.hard.length > 0 || currentTray.length > 0}
                className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center gap-1.5"
                title={
                  report.hard.length > 0
                    ? "하드 위반이 남아 있어 채택할 수 없습니다"
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

        {/* AI 에러 배너 (E-1b / E-3 / ask-fix 공용) */}
        {(aiDiagError || aiExplainError || askFixError) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold flex items-start gap-2">
            <span>⚠️</span>
            <span>{aiDiagError || aiExplainError || askFixError}</span>
          </div>
        )}

        {/* F-1 하드 위반 상세 패널 (E-1b AI 진단 카드와 동일 접이식 디자인) */}
        {showHardDetails && openDraft && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between bg-red-100/70 border-b border-red-200">
              <div className="flex items-center gap-2">
                <span className="text-base">🔴</span>
                <span className="text-xs font-bold text-red-950">하드 위반 상세 (총 {report.hard.length}건)</span>
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
                  <span>하드 위반이 없습니다.</span>
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
                <span className="text-xs font-bold text-amber-950">소프트 감점 상세 (총 {report.soft.total}점)</span>
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

                                {/* F-2 결과 카드 — 항목 바로 아래 인라인 */}
                                {isActive && (
                                  <div className="mt-1.5 ml-3 border-l-2 border-amber-300 pl-3 space-y-1.5">
                                    {findingFix ? (
                                      <div className="py-3 flex items-center gap-2 text-xs text-amber-700 font-semibold">
                                        <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-amber-500 border-t-transparent" />
                                        <span>교환 후보를 검사하는 중...</span>
                                      </div>
                                    ) : fixCandidates === null ? null : fixCandidates.length === 0 ? (
                                      /* ── 해결안 없음 — 다수 경로(30/39), 성의 있게 작성 ── */
                                      <div className="bg-gray-50 rounded-lg border border-gray-200 p-3.5 text-xs space-y-2">
                                        <div className="flex items-start gap-2">
                                          <span className="text-base mt-0.5">🔒</span>
                                          <div className="space-y-1">
                                            <p className="font-bold text-gray-800">
                                              지금 구조에서는 이 감점을 자동으로 줄이기 어렵습니다.
                                            </p>
                                            <p className="text-gray-600 leading-relaxed">
                                              {item.code === "S1" || item.code === "S4" || item.code === "S6"
                                                ? `이 수업을 다른 요일로 옮기려면 그 날의 빈 교시가 필요합니다. 같은 학급 안의 이동·맞교환과 두 학급이 함께 맞바꾸는 학급 간 교환까지 찾아봤지만, 전부 다른 조건(창체·SLAT 자리, 선생님 겹침)에 막혀 있습니다. 학급 전체 편성 조정이 필요합니다.`
                                                : item.code === "S2"
                                                ? `이 교사의 연속 수업을 분산하려면 같은 요일 내 빈 교시가 필요합니다. 빈 자리가 있더라도 옮겼을 때 다른 조건(교사 중복·운영 교시 초과)이 새로 생기면 후보에서 제외됩니다.`
                                                : item.code === "S3"
                                                ? `점심시간 전후 교시를 분리하려면 점심 블록 양쪽에서 맞바꿀 교시가 있어야 합니다. 가능한 교환이 모두 다른 조건에 막혀 있습니다.`
                                                : item.code === "S5"
                                                ? `이 요일의 과목 밀집을 풀려면 해당 수업을 다른 요일로 이동할 수 있어야 합니다. 현재 구조에서는 같은 학급 내에 적합한 빈 자리가 없습니다.`
                                                : `이 감점은 다른 조건(창체·SLAT 자리표시, 교사 중복, 운영 교시 초과 등)에 묶여 있어 단일 교환으로는 줄이기 어렵습니다.`
                                              }
                                            </p>
                                            <p className="text-[11px] text-gray-400 pt-1">
                                              💡 AI 도움말("개선 제안")에서 구조적 원인을 더 자세히 설명받을 수 있습니다.
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      /* ── 해결안 목록 ── */
                                      fixCandidates.map((cand, ci) => (
                                        <div
                                          key={ci}
                                          className="bg-white rounded-lg border border-amber-200 p-3 space-y-1.5 shadow-2xs"
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-start gap-2 min-w-0">
                                              {/* 순위 배지 */}
                                              <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-extrabold flex items-center justify-center mt-0.5">
                                                {ci + 1}
                                              </span>
                                              <div className="space-y-0.5 min-w-0">
                                                <p className="font-semibold text-gray-900 text-xs leading-snug">{cand.desc}</p>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                  {/* 점수 개선 */}
                                                  <span className="text-[11px] font-bold text-emerald-700">
                                                    {cand.oldSoftTotal}점 → {cand.newSoftTotal}점&nbsp;&nbsp;{Math.abs(cand.deltaScore)}점 개선
                                                  </span>
                                                  {/* 지목 항목 해소 여부 */}
                                                  {cand.resolvesTarget && (
                                                    <span className="text-xs px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                                                      ✅ 이 감점 해소
                                                    </span>
                                                  )}
                                                </div>
                                                {/* 부작용 */}
                                                {cand.sideEffects.length > 0 && (
                                                  <p className="text-[11px] text-amber-700 mt-0.5">
                                                    ⚠️ 다른 감점 증가: {cand.sideEffects.join(" / ")}
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                            {/* 미리보기 버튼 — 기존 analyzeOpImpact 연결 */}
                                            <button
                                              onClick={() => analyzeOpImpact(cand.op, cand.desc)}
                                              className="shrink-0 px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold text-[11px] border border-blue-200 transition-colors flex items-center gap-1"
                                            >
                                              <span>👁</span>
                                              <span>미리보기</span>
                                            </button>
                                          </div>
                                        </div>
                                      ))
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

        {/* AI 진단 카드 (E-1b) — 접이식, 결과 있을 때만 */}
        {aiDiagnosis && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 overflow-hidden">
            <button
              onClick={() => setAiCardOpen((o) => !o)}
              className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-violet-100/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">🔍</span>
                <span className="text-xs font-bold text-violet-900">원인 진단 결과</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-200 text-violet-800 font-bold border border-violet-300">
                  AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
                </span>
              </div>
              <span className="text-violet-500 text-xs font-bold">
                {aiCardOpen ? "▲ 접기" : "▼ 펼치기"}
              </span>
            </button>
            {aiCardOpen && (
              <div className="px-5 pb-5 space-y-4">
                <div className="bg-white rounded-xl border border-violet-100 p-4 text-xs text-gray-800 leading-relaxed font-medium">
                  <p className="font-bold text-violet-900 mb-2 text-[11px] uppercase tracking-wide">진단 요약</p>
                  <p>{aiDiagnosis.diagnosis}</p>
                </div>
                {aiDiagnosis.suggestions.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-bold text-violet-900 text-[11px] uppercase tracking-wide">완화 제안</p>
                    <ul className="space-y-2">
                      {aiDiagnosis.suggestions.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 bg-white rounded-lg border border-violet-100 px-3.5 py-2.5 text-xs text-gray-800 font-medium"
                        >
                          <span className="shrink-0 w-5 h-5 rounded-full bg-violet-600 text-white text-xs font-extrabold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-violet-700 font-semibold text-center pt-1">
                  ⚠️ AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
                </p>
              </div>
            )}
          </div>
        )}

        {/* AI 결과 설명 카드 (E-3) — 접이식, 결과 있을 때만 */}
        {aiExplain && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 overflow-hidden">
            <button
              onClick={() => setAiExplainCardOpen((o) => !o)}
              className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-sky-100/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">💬</span>
                <span className="text-xs font-bold text-sky-900">이 시간표 설명</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-200 text-sky-800 font-bold border border-sky-300">
                  AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
                </span>
              </div>
              <span className="text-sky-500 text-xs font-bold">
                {aiExplainCardOpen ? "▲ 접기" : "▼ 펼치기"}
              </span>
            </button>
            {aiExplainCardOpen && (
              <div className="px-5 pb-5 space-y-4">
                <div className="bg-white rounded-xl border border-sky-100 p-4 text-xs text-gray-800 leading-relaxed font-medium whitespace-pre-line">
                  {aiExplain.explanation}
                </div>
                <p className="text-[11px] text-sky-700 font-semibold text-center pt-1">
                  ⚠️ AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
                </p>
              </div>
            )}
          </div>
        )}

        {/* 물어보고 고치기 카드 (ask-fix) — 접이식 */}
        {askFixCardOpen && (
          <div className="rounded-xl border border-purple-200 bg-purple-50/50 overflow-hidden shadow-xs">
            <div className="px-5 py-3 flex items-center justify-between bg-purple-100/70 border-b border-purple-200">
              <div className="flex items-center gap-2">
                <span className="text-base">💡</span>
                <span className="text-xs font-bold text-purple-950">물어보고 고치기</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-200 text-purple-900 font-bold border border-purple-300">
                  AI 질문 해석 + 자동 계산
                </span>
              </div>
              <button
                onClick={() => setAskFixCardOpen(false)}
                className="text-purple-700 hover:text-purple-950 text-xs font-bold px-2 py-1 rounded hover:bg-purple-200/60 transition-colors"
              >
                ✕ 닫기
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* 1. 질문 입력 영역 */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <label className="text-sm font-bold text-gray-800">
                    시간표에서 해결하고 싶은 문제를 말로 질문해 보세요:
                  </label>
                  <span className="text-[11px] text-gray-500">
                    교사명·학급·과목·교시를 지정할 수 있습니다
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={askFixText}
                    onChange={(e) => setAskFixText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !askFixInterpreting && !findingPlan && askFixText.trim()) {
                        handleAskFix();
                      }
                    }}
                    placeholder="예: 이경호 선생님 1교시가 5일 연속인데 해결할 방법은?"
                    className="flex-1 px-3.5 py-2 bg-white border border-purple-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 font-medium"
                    disabled={askFixInterpreting || findingPlan || applyingPlan}
                  />
                  <button
                    onClick={() => handleAskFix()}
                    disabled={askFixInterpreting || findingPlan || applyingPlan || !askFixText.trim()}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 shrink-0"
                  >
                    {askFixInterpreting ? (
                      <>
                        <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                        <span>해석 중...</span>
                      </>
                    ) : findingPlan ? (
                      <>
                        <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                        <span>방법 찾는 중...</span>
                      </>
                    ) : (
                      <span>해결 방법 찾기</span>
                    )}
                  </button>
                </div>

                {/* 질문 예시 칩 */}
                <div className="pt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-[11px] text-gray-500 font-semibold">예시:</span>
                  {ASK_FIX_EXAMPLES.map((ex, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setAskFixText(ex);
                        handleAskFix(ex);
                      }}
                      disabled={askFixInterpreting || findingPlan || applyingPlan}
                      className="px-2.5 py-1 bg-white hover:bg-purple-100/70 border border-purple-200 text-purple-900 rounded-md text-[11px] font-medium transition-colors text-left truncate max-w-full"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. 진행 상태 및 메시지 표시 */}
              {findingPlan && askFixProgress && (
                <div className="bg-white border border-purple-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-purple-900">
                    <span>여러 번 맞바꿔서 해결하는 방법을 찾는 중입니다...</span>
                    <span>{askFixProgress.evaluated} / {askFixProgress.budget}회</span>
                  </div>
                  <div className="w-full bg-purple-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-150"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((askFixProgress.evaluated / askFixProgress.budget) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {applyPlanSuccessMsg && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900 font-medium flex items-start gap-2">
                  <span className="text-base">✅</span>
                  <p>{applyPlanSuccessMsg}</p>
                </div>
              )}

              {applyPlanError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-900 font-medium flex items-start gap-2">
                  <span className="text-base">⚠️</span>
                  <p>{applyPlanError}</p>
                </div>
              )}

              {/* 3. 해석 불가 (result.goal === null) 시 안내 */}
              {askFixResult && !askFixResult.goal && !findingPlan && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="text-base">ℹ️</span>
                    <div>
                      <p className="text-sm font-bold text-amber-950">
                        질문을 명확한 목표로 해석하지 못했습니다.
                      </p>
                      <p className="text-xs text-amber-900 mt-0.5">
                        {askFixResult.interpretation ||
                          "등록된 교사명, 학급, 과목 또는 교시를 포함하여 다시 질문해 주세요."}
                      </p>
                    </div>
                  </div>

                  {askFixResult.warnings && askFixResult.warnings.length > 0 && (
                    <ul className="text-xs text-amber-800 list-disc list-inside space-y-0.5 pl-1">
                      {askFixResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}

                  <div className="pt-1 border-t border-amber-200">
                    <p className="text-[11px] font-bold text-amber-900 mb-1.5">
                      이런 형식으로 질문해 보세요:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {ASK_FIX_EXAMPLES.map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setAskFixText(ex);
                            handleAskFix(ex);
                          }}
                          className="px-2.5 py-1 bg-white border border-amber-300 text-amber-950 rounded text-xs hover:bg-amber-100/60 font-medium text-left"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 4. 탐색 계획 (FixPlan) 결과 표시 */}
              {askFixPlan && !findingPlan && (
                <div className="space-y-4">
                  {/* 해석 확인 문장 + AI 참고의견 딱지 (문구 규칙 3) */}
                  <div className="bg-white border border-purple-200 rounded-xl p-4 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-purple-100 pb-2">
                      <div className="text-sm font-bold text-purple-950">
                        <span>이렇게 이해했습니다: </span>
                        <span className="text-purple-800">「{askFixPlan.goalText}」</span>
                      </div>
                      <span className="text-[11px] text-purple-700 font-semibold">
                        ⚠️ AI가 질문을 해석한 결과입니다 — 아래 수순과 점수는 계산된 결과입니다
                      </span>
                    </div>

                    {/* 해결 여부 및 점수 변화 요약 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        {askFixPlan.steps.length > 0 ? (
                          askFixPlan.resolvesGoal ? (
                            askFixPlan.finalSoftTotal > openDraft.report.soft.total ? (
                              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold text-xs border border-amber-300">
                                ⚠ 해결 시 다른 감점이 더 커집니다 ({askFixPlan.steps.length}단계 맞교환)
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs border border-emerald-300">
                                ✅ 목표 해결 가능 ({askFixPlan.steps.length}단계 맞교환)
                              </span>
                            )
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold text-xs border border-amber-300">
                              ⚠️ 부분 개선 (시작 {askFixPlan.initialRemaining} → 남은{" "}
                              {askFixPlan.remaining}, {askFixPlan.steps.length}단계 맞교환)
                            </span>
                          )
                        ) : null}
                      </div>

                      {openDraft && (
                        <div className="flex items-center gap-2 text-xs font-bold text-gray-700 bg-gray-50 px-3 py-1 rounded-lg border border-gray-200">
                          <span>감점 점수 변화:</span>
                          <span className="text-gray-500 font-mono">
                            {openDraft.report.soft.total}점
                          </span>
                          <span>→</span>
                          <span className="font-mono text-purple-900 font-extrabold">
                            {askFixPlan.finalSoftTotal}점
                          </span>
                          <span
                            className={`text-[11px] font-mono ${
                              askFixPlan.finalSoftTotal - openDraft.report.soft.total <= 0
                                ? "text-emerald-600"
                                : "text-red-600"
                            }`}
                          >
                            (
                            {askFixPlan.finalSoftTotal - openDraft.report.soft.total > 0
                              ? "+"
                              : ""}
                            {(
                              askFixPlan.finalSoftTotal - openDraft.report.soft.total
                            ).toFixed(1)}
                            점)
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 미해결 출구 안내 문구 (문구 규칙 2) */}
                    {!askFixPlan.resolvesGoal && (
                      <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-2">
                        {askFixPlan.budgetExhausted ? (
                          <p>
                            시간 안에 찾지 못했습니다. 조건을 조금 낮춰서(예: 3일 이하 → 4일
                            이하) 다시 물어보시겠어요?
                          </p>
                        ) : (
                          <p>
                            세 번까지 바꿔 봐도 풀리지 않았습니다. 이 정도면 학급 전체 편성을
                            조정해야 할 수 있습니다.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 수순이 있는 경우 (plan.steps.length > 0) */}
                  {askFixPlan.steps.length > 0 ? (
                    <div className="space-y-4">
                      {/* 맞교환 수순 (steps[]) */}
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-gray-800">
                          바꿀 순서 (총 {askFixPlan.steps.length}단계):
                        </div>
                        <div className="space-y-2">
                          {askFixPlan.steps.map((step, idx) => (
                            <div
                              key={idx}
                              className="bg-white border border-purple-100 rounded-lg p-3 space-y-1.5 text-xs shadow-2xs"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-start gap-2">
                                  <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-xs font-extrabold flex items-center justify-center mt-0.5">
                                    {idx + 1}
                                  </span>
                                  <span className="text-sm font-bold text-gray-900">
                                    {step.desc}
                                  </span>
                                </div>
                                <button
                                  onClick={() => analyzeOpImpact(step.op, step.desc)}
                                  className="px-2.5 py-1 bg-gray-100 hover:bg-purple-100 text-purple-900 font-bold rounded text-xs transition-colors self-end sm:self-auto shrink-0 border border-gray-200"
                                >
                                  미리보기
                                </button>
                              </div>

                              {step.sideEffects && step.sideEffects.length > 0 && (
                                <div className="pl-7 text-[11px] text-gray-600 space-y-0.5">
                                  {step.sideEffects.map((se, seIdx) => (
                                    <div key={seIdx} className="flex items-center gap-1">
                                      <span className="text-purple-500">•</span>
                                      <span>{se}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* [가장 중요] 새로 생기는 감점 전부 고지 (newPenalties[]) */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-gray-800">
                            추가로 발생하는 감점 요소 (전수 고지):
                          </span>
                          <span className="text-[11px] text-gray-500">
                            총 {askFixPlan.newPenalties.length}건
                          </span>
                        </div>

                        {askFixPlan.newPenalties.length === 0 ? (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-900 font-bold flex items-center gap-1.5">
                            <span>✅</span>
                            <span>새로 추가되는 감점 요소가 없습니다.</span>
                          </div>
                        ) : (
                          <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3 space-y-2">
                            <p className="text-[11px] text-amber-900 font-bold">
                              ⚠️ 이 변경을 적용하면 아래의 새로운 감점이 발생합니다. 내용을
                              확인하고 수락해 주세요:
                            </p>
                            <div className="space-y-1.5">
                              {askFixPlan.newPenalties.map((pen, penIdx) => (
                                <div
                                  key={penIdx}
                                  className="bg-white border border-amber-200 rounded px-3 py-1.5 text-xs flex items-center justify-between gap-2"
                                >
                                  <div className="flex items-center gap-1.5 text-gray-800">
                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-bold">
                                      {SOFT_CODE_LABELS[pen.code] || pen.code}
                                    </span>
                                    <span className="font-medium">{pen.text}</span>
                                  </div>
                                  <span className="font-mono text-[11px] font-bold text-amber-800 shrink-0">
                                    +{pen.points}점
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 수락 및 적용 제어 버튼 */}
                      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-purple-200">
                        <p className="text-[11px] text-gray-500 font-medium">
                          💡 [모두 적용] 시 순서대로 반영되며, 상단 [↩ 실행취소]로 한 단계씩
                          되돌릴 수 있습니다.
                        </p>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            onClick={() => {
                              setAskFixPlan(null);
                              setAskFixResult(null);
                            }}
                            disabled={applyingPlan}
                            className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-sm transition-colors"
                          >
                            다시 질문하기
                          </button>
                          <button
                            onClick={handleApplyFixPlan}
                            disabled={applyingPlan}
                            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm shadow-xs transition-colors flex items-center gap-1.5"
                          >
                            {applyingPlan ? (
                              <>
                                <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                                <span>
                                  적용 중 ({appliedStepIndex}/{askFixPlan.steps.length})...
                                </span>
                              </>
                            ) : (
                              <span>모두 적용 ({askFixPlan.steps.length}단계)</span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 수순이 0건인 경우 */
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-xs text-gray-600 font-medium">
                      {askFixPlan.resolvesGoal
                        ? "이미 목표가 충족되어 있어 시간표를 변경할 필요가 없습니다."
                        : "가능한 교환 수순을 찾지 못했습니다."}
                    </div>
                  )}
                </div>
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
        <div className={`grid grid-cols-1 ${manualMode ? "lg:grid-cols-2" : "xl:grid-cols-12"} gap-5`}>
          {/* 좌: 학급 그리드 Ⓐ */}
          <div ref={classGridRef} className={`${manualMode ? "lg:col-span-1" : "xl:col-span-8"} space-y-4`}>
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
                  <div className="flex items-center gap-1.5 font-bold min-w-0">
                    <span className="text-sm">💬</span>
                    <span className="truncate">{blockedBubble.message}</span>
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
              {!currentGrid ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  {viewGrade}학년 {viewClass}반 시간표가 없습니다.
                </div>
              ) : (
                <table className="w-full text-center text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 border-b border-gray-200 font-bold text-gray-700">
                      <th className="py-2.5 px-2 border-r border-gray-200 w-10">교시</th>
                      {DAYS.map((d, dIdx) => {
                        const isHighlighted = highlightDay?.target === "class" && highlightDay.day === (dIdx + 1);
                        return (
                          <th
                            key={d}
                            className={`py-2.5 px-1 border-r border-gray-200 min-w-[5.5rem] transition-colors duration-500 ${
                              isHighlighted ? "bg-amber-200 text-amber-950 ring-2 ring-inset ring-amber-400" : ""
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
                          const cell = currentGrid.cells.find((c) => c.day === day && c.period === period);
                          const lesson = cell?.lessons?.[0];

                          // 직접 조정 모드일 때
                          if (manualMode) {
                            const isPicked =
                              pickedSlot?.grade === viewGrade &&
                              pickedSlot?.classNum === viewClass &&
                              pickedSlot?.day === day &&
                              pickedSlot?.period === period;
                            const cand = candidatesResult?.candidates.find(
                              (c) => c.day === day && c.period === period
                            );
                            const simulLabel = getSimulLabel(viewGrade, viewClass, day, period, lesson);
                            const placeholder = findPlaceholderLesson(openDraft.currentGrids, viewGrade, viewClass, day, period);
                            const isBandLocked = !!simulLabel;
                            const isPlaceholder = !!placeholder;
                            const canDragCell = manualMode && !savingOp && !!lesson && !isBandLocked && !isPlaceholder;
                            const isDragOverThis = dragOverCell?.day === day && dragOverCell?.period === period;

                            const dndProps = {
                              draggable: canDragCell,
                              onDragStart: (e: React.DragEvent) => {
                                if (!canDragCell) return;
                                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "cell", grade: viewGrade, classNum: viewClass, day, period }));
                                e.dataTransfer.effectAllowed = "move";
                                setDragSource({ type: "cell", grade: viewGrade, classNum: viewClass, day, period, lesson: lesson! });

                                if (!isPicked) {
                                  const res = evaluateMoveCandidates({
                                    grids: openDraft.currentGrids,
                                    model: openDraft.model,
                                    pick: { grade: viewGrade, classNum: viewClass, day, period },
                                  });
                                  if (!res.pickBlocked) {
                                    setPickedSlot({ grade: viewGrade, classNum: viewClass, day, period, lesson: lesson! });
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
                                const candItem = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
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
                                  setDragOverCell((prev) => (prev?.day === day && prev?.period === period ? null : prev));
                                }
                              },
                              onDrop: (e: React.DragEvent) => {
                                e.preventDefault();
                                setDragOverCell(null);
                                if (!dragSource || savingOp) return;

                                const candItem = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
                                if (!candItem || candItem.verdict === "blocked") return;

                                if (dragSource.type === "cell") {
                                  if (dragSource.grade === viewGrade && dragSource.classNum === viewClass && dragSource.day === day && dragSource.period === period) return;
                                  setDragSource(null);
                                  handleCellClick(day, period);
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
                                  onClick={() => handleCellClick(day, period)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    handleCellRightClick(day, period);
                                  }}
                                  title="집은 수업 (클릭 또는 Esc로 해제)"
                                  className={`p-2 border-r border-gray-200 bg-sky-100/90 text-sky-950 align-top cursor-pointer select-none relative ${
                                    isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                                  } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                                >
                                  {lesson ? (
                                    <div className="space-y-0.5">
                                      <div className="flex items-start justify-between gap-1">
                                        <span className="font-bold text-[11px] truncate leading-tight">
                                          {lesson.subjectShort || lesson.subjectName}
                                        </span>
                                        <span className="shrink-0 text-[10px] leading-none" title="집은 수업">📌</span>
                                      </div>
                                      <div className="text-[10px] text-sky-800 truncate leading-tight">
                                        {lesson.teachers?.map((t) => t.name).join(", ")}
                                      </div>
                                      {simulLabel && (
                                        <div className="text-[10px] text-purple-700 font-extrabold mt-0.5">
                                          🔒 {simulLabel}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="py-1">
                                      <span className="text-[10px] text-gray-300">—</span>
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
                                    onClick={() => handleCellClick(day, period)}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      handleCellRightClick(day, period);
                                    }}
                                    title={
                                      cand.kind === "swap"
                                        ? `${lesson?.subjectShort || "수업"}과 맞교환 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                        : cand.kind === "displace"
                                        ? `${lesson?.subjectShort || "수업"} 밀어내고 들기 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                        : `빈 칸으로 이동 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                    }
                                    className={`p-2 border-r border-gray-200 bg-emerald-50/80 hover:bg-emerald-100/80 text-gray-800 align-top cursor-pointer select-none transition-colors relative ${
                                      isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                                    } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                                  >
                                    {lesson ? (
                                      <div className="space-y-0.5">
                                        <div className="flex items-start justify-between gap-1">
                                          <span className="font-bold text-[11px] truncate leading-tight text-emerald-950 flex items-center gap-0.5">
                                            {cand.kind === "displace" && <span className="text-[10px]" title="밀어내고 들기">✋</span>}
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
                                        <div className="text-[10px] text-gray-500 truncate leading-tight">
                                          {lesson.teachers?.map((t) => t.name).join(", ")}
                                        </div>
                                        {simulLabel && (
                                          <div className="text-[10px] text-purple-700 font-extrabold mt-0.5">
                                            🔒 {simulLabel}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="py-1 flex items-center justify-between">
                                        <span className="text-[10px] text-gray-300">—</span>
                                        <span
                                          className={`px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none ${
                                            cand.softDelta < 0
                                              ? "bg-emerald-600 text-white shadow-2xs"
                                              : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                          }`}
                                        >
                                          {cand.softDelta < 0 ? cand.softDelta : "0"}
                                        </span>
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
                                    onClick={() => handleCellClick(day, period)}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      handleCellRightClick(day, period);
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
                                    className={`p-2 border-r border-gray-200 bg-amber-50/80 hover:bg-amber-100/80 text-gray-800 align-top cursor-pointer select-none transition-colors relative ${
                                      isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                                    } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                                  >
                                    {lesson ? (
                                      <div className="space-y-0.5">
                                        <div className="flex items-start justify-between gap-1">
                                          <span className="font-bold text-[11px] truncate leading-tight text-amber-950 flex items-center gap-0.5">
                                            {cand.kind === "displace" && <span className="text-[10px]" title="밀어내고 들기">✋</span>}
                                            <span>{lesson.subjectShort || lesson.subjectName}</span>
                                          </span>
                                          <span className="shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none bg-amber-500 text-white shadow-2xs">
                                            +{cand.softDelta}
                                          </span>
                                        </div>
                                        <div className="text-[10px] text-gray-500 truncate leading-tight">
                                          {lesson.teachers?.map((t) => t.name).join(", ")}
                                        </div>
                                        {simulLabel && (
                                          <div className="text-[10px] text-purple-700 font-extrabold mt-0.5">
                                            🔒 {simulLabel}
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="py-1 flex items-center justify-between">
                                        <span className="text-[10px] text-gray-300">—</span>
                                        <span className="px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none bg-amber-500 text-white shadow-2xs">
                                          +{cand.softDelta}
                                        </span>
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
                                    handleCellRightClick(day, period);
                                  }}
                                  title={cand.blockedReason ? `이동 불가: ${cand.blockedReason}` : "이동 불가"}
                                  className={`p-2 border-r border-gray-200 bg-gray-100/90 text-gray-400 align-top cursor-not-allowed select-none relative opacity-70 ${
                                    savingOp ? "cursor-wait" : ""
                                  }`}
                                >
                                  {lesson ? (
                                    <div className="space-y-0.5">
                                      <div className="flex items-start justify-between gap-1">
                                        <span className="font-bold text-[11px] truncate leading-tight text-gray-400">
                                          {lesson.subjectShort || lesson.subjectName}
                                        </span>
                                        <span className="shrink-0 text-[10px] text-gray-400 leading-none">🔒</span>
                                      </div>
                                      <div className="text-[10px] text-gray-400 truncate leading-tight">
                                        {lesson.teachers?.map((t) => t.name).join(", ")}
                                      </div>
                                      {simulLabel && (
                                        <div className="text-[10px] text-purple-700/60 font-extrabold mt-0.5">
                                          🔒 {simulLabel}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="py-1 flex items-center justify-between">
                                      <span className="text-[10px] text-gray-300">—</span>
                                      <span className="text-[10px] text-gray-400 leading-none">🔒</span>
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
                                onClick={() => handleCellClick(day, period)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  handleCellRightClick(day, period);
                                }}
                                onMouseEnter={() => {
                                  if (lesson?.teachers?.[0]?.email) {
                                    setSelectedTeacherEmail(lesson.teachers[0].email);
                                  }
                                }}
                                className={`p-2 border-r border-gray-200 align-top transition-colors cursor-pointer select-none bg-white hover:bg-indigo-50/50 text-gray-800 ${
                                  isDragOverThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                                } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                              >
                                {lesson ? (
                                  <div className="space-y-0.5">
                                    <div className="font-bold text-[11px] truncate leading-tight">
                                      {lesson.subjectShort || lesson.subjectName}
                                    </div>
                                    <div className="text-[10px] text-gray-500 truncate leading-tight">
                                      {lesson.teachers?.map((t) => t.name).join(", ")}
                                    </div>
                                    {simulLabel && (
                                      <div className="text-[10px] text-purple-700 font-extrabold mt-0.5">
                                        🔒 {simulLabel}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="py-1">
                                    <span className="text-[10px] text-gray-300">—</span>
                                  </div>
                                )}
                              </td>
                            );
                          }

                          // ── 열람 모드 (manualMode 꺼짐) ──
                          const simulLabel = getSimulLabel(viewGrade, viewClass, day, period, lesson);
                          const isBandLocked = !!simulLabel;

                          const hasHardError = report.hard.some((h) => {
                            const hasAnyCoord =
                              h.grade !== undefined ||
                              h.classNum !== undefined ||
                              h.day !== undefined ||
                              h.period !== undefined;
                            if (!hasAnyCoord) return false;
                            if (h.grade !== undefined && h.grade !== viewGrade) return false;
                            if (h.classNum !== undefined && h.classNum !== viewClass) return false;
                            if (h.day !== undefined && h.day !== day) return false;
                            if (h.period !== undefined && h.period !== period) return false;
                            return true;
                          });

                          return (
                            <td
                              key={day}
                              onClick={() => handleCellClick(day, period)}
                              onMouseEnter={() => {
                                if (lesson?.teachers?.[0]?.email) {
                                  setSelectedTeacherEmail(lesson.teachers[0].email);
                                }
                              }}
                              className={`p-2 border-r border-gray-200 align-top transition-colors cursor-pointer select-none ${
                                hasHardError
                                  ? "bg-red-100 text-red-950 font-bold border-2 border-red-400"
                                  : isBandLocked
                                  ? "bg-gray-100/80 text-gray-400"
                                  : "bg-white hover:bg-gray-50 text-gray-800"
                              }`}
                            >
                              {lesson ? (
                                <div className="space-y-0.5 relative">
                                  <div className="font-bold text-[11px] truncate leading-tight">
                                    {lesson.subjectShort || lesson.subjectName}
                                  </div>
                                  <div className="text-[10px] text-gray-500 truncate leading-tight">
                                    {lesson.teachers?.map((t) => t.name).join(", ")}
                                  </div>
                                  {simulLabel && (
                                    <div className="text-[10px] text-purple-700 font-extrabold mt-0.5">
                                      🔒 {simulLabel}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="py-1">
                                  <span className="text-[10px] text-gray-300">—</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 우: 교사 그리드 Ⓑ (+ 미배정 목록) */}
          <div ref={teacherGridRef} className={`${manualMode ? "lg:col-span-1" : "xl:col-span-4"} space-y-4`}>
            {/* 교사 파생 그리드 카드 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
                <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <span>👤 {selectedTeacherName ? `${selectedTeacherName} 선생님` : "교사"} 주간 시간표</span>
                </h4>
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

              {!selectedTeacherEmail ? (
                <div className="py-6 text-center text-xs text-gray-400">
                  {manualMode
                    ? "학급 시간표 셀을 가리키거나 위에서 교사를 선택하세요."
                    : "시간표 셀을 클릭하면 해당 교사의 주간 시간표가 자동 표시됩니다."}
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-100 rounded-lg text-[11px]">
                  <table className="w-full text-center border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600">
                        <th className="py-1 px-1 border-r border-gray-200 w-7">교시</th>
                        {DAYS.map((d, dIdx) => {
                          const isHighlighted = highlightDay?.target === "teacher" && highlightDay.day === (dIdx + 1);
                          return (
                            <th
                              key={d}
                              className={`py-1 px-1 border-r border-gray-200 transition-colors duration-500 ${
                                isHighlighted ? "bg-amber-200 text-amber-950 ring-2 ring-inset ring-amber-400" : ""
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
                            const hit = teacherSlots.find((s) => s.day === d && s.period === p);

                            if (manualMode) {
                              const cand = candidatesResult?.candidates.find(
                                (c) => c.day === d && c.period === p
                              );
                              const isDragOverTeacherThis = dragOverCell?.day === d && dragOverCell?.period === p;

                              const teacherDndProps = {
                                onDragOver: (e: React.DragEvent) => {
                                  if (!dragSource || savingOp) return;
                                  const candItem = candidatesResult?.candidates.find((c) => c.day === d && c.period === p);
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
                                    setDragOverCell((prev) => (prev?.day === d && prev?.period === p ? null : prev));
                                  }
                                },
                                onDrop: (e: React.DragEvent) => {
                                  e.preventDefault();
                                  setDragOverCell(null);
                                  if (!dragSource || savingOp) return;

                                  const candItem = candidatesResult?.candidates.find((c) => c.day === d && c.period === p);
                                  if (!candItem || candItem.verdict === "blocked") return;

                                  if (dragSource.type === "cell") {
                                    setDragSource(null);
                                    handleTeacherCellClick(d, p);
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
                                      onClick={() => handleTeacherCellClick(d, p)}
                                      className={`p-1 border-r border-gray-100 bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-950 font-bold cursor-pointer select-none text-[10px] transition-colors ${
                                        isDragOverTeacherThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
                                      } ${savingOp ? "opacity-75 cursor-wait" : ""}`}
                                      title={
                                        hit
                                          ? cand.kind === "displace"
                                            ? `${hit.grade}-${hit.classNum} ${hit.subjectName} 밀어내고 들기 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                            : `${hit.grade}-${hit.classNum} ${hit.subjectName}과 맞교환 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                          : `빈 칸으로 이동 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                      }
                                    >
                                      <div className="flex items-center justify-between gap-0.5">
                                        <span className="truncate flex items-center gap-0.5">
                                          {cand.kind === "displace" && <span className="text-[9px]" title="밀어내고 들기">✋</span>}
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
                                      onClick={() => handleTeacherCellClick(d, p)}
                                      className={`p-1 border-r border-gray-100 bg-amber-50/80 hover:bg-amber-100/80 text-amber-950 font-bold cursor-pointer select-none text-[10px] transition-colors ${
                                        isDragOverTeacherThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""
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
                                      <div className="flex items-center justify-between gap-0.5">
                                        <span className="truncate flex items-center gap-0.5">
                                          {cand.kind === "displace" && <span className="text-[9px]" title="밀어내고 들기">✋</span>}
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
                                    className={`p-1 border-r border-gray-100 bg-gray-100/90 text-gray-400 cursor-not-allowed select-none text-[10px] opacity-70 ${
                                      savingOp ? "cursor-wait" : ""
                                    }`}
                                    title={cand.blockedReason ? `이동 불가: ${cand.blockedReason}` : "이동 불가"}
                                  >
                                    <div className="flex items-center justify-between gap-0.5">
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
                                    if (hit) handleTeacherCellClick(d, p);
                                  }}
                                  onMouseEnter={() => {
                                    if (hit && !pickedSlot) {
                                      setViewGrade(hit.grade);
                                      setViewClass(hit.classNum);
                                    }
                                  }}
                                  className={`p-1 border-r border-gray-100 text-[10px] transition-colors cursor-pointer select-none ${
                                    hit
                                      ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-950 font-bold border border-indigo-200"
                                      : "bg-white text-gray-300"
                                  } ${isDragOverTeacherThis ? "ring-2 ring-indigo-500 shadow-md scale-[1.02] z-10" : ""} ${
                                    savingOp ? "opacity-75 cursor-wait" : ""
                                  }`}
                                  title={hit ? `${hit.grade}학년 ${hit.classNum}반 ${hit.subjectName}` : undefined}
                                >
                                  {hit ? `${hit.grade}-${hit.classNum}` : "—"}
                                </td>
                              );
                            }

                            // 일반 모드
                            return (
                              <td
                                key={d}
                                className={`p-1 border-r border-gray-100 text-[10px] ${
                                  hit ? "bg-indigo-100 text-indigo-950 font-bold" : "bg-white text-gray-300"
                                }`}
                              >
                                {hit ? `${hit.grade}-${hit.classNum}` : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 미배정 목록 카드 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <h4 className="text-xs font-bold text-gray-900 flex items-center justify-between">
                <span>📭 미배정 수업 목록</span>
                {meta.unplaced.length > 0 && (
                  <span className="bg-red-100 text-red-800 text-[11px] px-2 py-0.5 rounded-full font-extrabold border border-red-300">
                    {meta.unplaced.length}건
                  </span>
                )}
              </h4>

              {meta.unplaced.length === 0 ? (
                <div className="py-6 text-center text-xs text-emerald-700 font-bold bg-emerald-50/50 rounded-lg">
                  ✅ 모든 수업이 배정되었습니다!
                </div>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  {meta.unplaced.map((u) => {
                    const isSelected = selectedUnplaced?.sectionId === u.sectionId;
                    const tokens = u.label.split(" ");
                    const classToken = tokens[0] || "";
                    const subjectToken = tokens[1] || "미배정과목";
                    const teacherToken = tokens[2] || "";
                    const [gStr, cStr] = classToken.replace(/반$/, "").split("-");
                    const targetGrade = parseInt(gStr, 10) || viewGrade;
                    const targetClass = parseInt(cStr, 10) || viewClass;

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

                          const lesson: TimetableLesson = {
                            subjectName: subjectToken,
                            subjectShort: subjectToken,
                            teachers: [{ email: "", name: teacherToken }],
                          };

                          const res = evaluateHeldCandidates({
                            grids: openDraft.currentGrids,
                            model: openDraft.model,
                            held: { grade: targetGrade, classNum: targetClass, lessons: [lesson] },
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

                                const lesson: TimetableLesson = {
                                  subjectName: subjectToken,
                                  subjectShort: subjectToken,
                                  teachers: [{ email: "", name: teacherToken }],
                                };

                                const res = evaluateHeldCandidates({
                                  grids: openDraft.currentGrids,
                                  model: openDraft.model,
                                  held: { grade: targetGrade, classNum: targetClass, lessons: [lesson] },
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
          </div>
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
                      title="클릭하거나 드래그하여 학급 그리드의 빈 칸에 배치하거나, ✕를 눌러 원래 자리로 복귀를 시도합니다"
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
                    이 이동/맞교환을 적용하면 시간표에 해결할 수 없는 중대한 하드 위반이 새로 발생합니다:
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
                  <span>✅ 중대 문제(하드 위반) 없음 — 정상 적용 가능합니다.</span>
                </div>
              )}

              {/* 소프트 점수 변화 */}
              <div className="p-3.5 border border-gray-200 rounded-xl text-xs space-y-2 bg-white">
                <div className="flex justify-between items-center font-bold">
                  <span className="text-gray-700">소프트 감점 변화:</span>
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
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-md w-full p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <h3 className="text-sm font-bold text-gray-900">📋 초안 작업기록 열람</h3>
                <button onClick={() => setShowOpsHistory(false)} className="text-gray-400 font-bold">
                  ✕
                </button>
              </div>

              {meta.ops.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">기록된 수동 조정 연산이 없습니다.</p>
              ) : (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto text-xs pr-1">
                  {meta.ops.map((op, idx) => {
                    const isCurrent = idx === meta.opCursor - 1;
                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                          isCurrent
                            ? "bg-purple-100 border-purple-400 text-purple-950 font-bold ring-1 ring-purple-400"
                            : idx < meta.opCursor
                            ? "bg-gray-50 border-gray-200 text-gray-700"
                            : "bg-gray-100/50 border-gray-200 text-gray-400 line-through"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span>
                            #{idx + 1}{" "}
                            {op.type === "swap_pair"
                              ? `학급 간 교환 (${op.classes.map((c) => `${c.grade}학년 ${c.classNum}반`).join("·")})`
                              : op.type === "chain"
                                ? `연쇄 조정 (${op.steps.length}수)`
                                : op.type === "park"
                                  ? `잠깐 빼두기 (${op.grade}학년 ${op.classNum}반)`
                                  : op.type === "unpark"
                                    ? `빼둔 수업 되돌리기 (${op.grade}학년 ${op.classNum}반)`
                                    : `${op.type === "swap" ? "맞교환/이동" : "셀 통째 수정"} (${op.grade}학년 ${op.classNum}반)`}
                          </span>
                          {isCurrent && (
                            <span className="text-xs bg-purple-700 text-white font-extrabold px-1.5 py-0.5 rounded">
                              현재 지점
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                        하드 {report.hardCount}
                      </span>
                    )}
                  </div>

                  {report && (
                    <div className="flex gap-2 text-[11px]">
                      <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded font-bold">
                        소프트 {report.softTotal}점
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
