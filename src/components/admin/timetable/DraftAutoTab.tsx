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
} from "@/lib/timetable/types";
import type { BlankCompileIssue } from "@/lib/timetable/solver";
import { findFixCandidates, FixCandidate } from "@/lib/timetable/fixFinder";
import type { AiDiagnoseResult, AiExplainResult, AiCritiqueResult } from "@/lib/timetable/ai";
import { solveTimetableInWorker, SolverDone, SolverRun } from "@/lib/timetable/solverClient";
import {
  checkPlaceholderOp,
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  findPlaceholderLesson,
  hardViolationKey,
  validateTimetable,
} from "@/lib/timetable/validate";
import { applyRevisionOps, cloneClassGrids } from "@/lib/timetable/utils";
import { buildSimulMatcher } from "@/lib/timetable/simul";
import { HARD_CODE_LABELS, SOFT_CODE_LABELS } from "@/lib/timetable/labels";

interface DraftAutoTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
  isDraftTerm?: boolean;
}

const DAYS = ["월", "화", "수", "목", "금"];

// ── 유틸 ──
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

export default function DraftAutoTab({
  activeTermId,
  periodsPerDay = 7,
  isDraftTerm = false,
}: DraftAutoTabProps) {
  // ── 목록 상태 ──
  const [drafts, setDrafts] = useState<TimetableDraft[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── 시작 방법 & 시수 계획 상태 (phase9c_i_spec §6·§7) ──
  const [startMethod, setStartMethod] = useState<"grid" | "plan">("plan");
  const [plans, setPlans] = useState<HoursPlanSummary[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [hasBaseGrids, setHasBaseGrids] = useState<boolean | null>(null);
  const [cachedDraftModel, setCachedDraftModel] = useState<{
    model: TimetableConstraintModel;
    baseGrids: ClassGrid[];
  } | null>(null);

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
    };
    planLabel: string;
    termId: string;
  } | null>(null);

  // ── 솔버 실행 상태 ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [solverError, setSolverError] = useState<string | null>(null);
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

  // F-1 위반·감점 상세 패널 접힘/펼침 상태
  const [showHardDetails, setShowHardDetails] = useState(false);
  const [showSoftDetails, setShowSoftDetails] = useState(false);

  // 선택 셀 A 상태 (이동 소스)
  const [selectedSlotA, setSelectedSlotA] = useState<{
    day: number;
    period: number;
  } | null>(null);

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
    () => (openDraft?.model?.simulGroups ? buildSimulMatcher(openDraft.model.simulGroups) : () => null),
    [openDraft?.model?.simulGroups]
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

  // ── AI 정성 비평 상태 (E-4) ──
  const [aiCritique, setAiCritique] = useState<AiCritiqueResult | null>(null);
  const [aiCritiquing, setAiCritiquing] = useState(false);
  const [aiCritiqueError, setAiCritiqueError] = useState<string | null>(null);
  const [aiCritiqueCardOpen, setAiCritiqueCardOpen] = useState(false);

  // ── F-2 해결안 탐색 상태 ──
  /** 현재 [해결안 찾기]가 열려 있는 감점 항목 */
  const [activeFindDetail, setActiveFindDetail] = useState<TermPenaltyDetail | null>(null);
  /** findFixCandidates 결과 (동기) */
  const [fixCandidates, setFixCandidates] = useState<FixCandidate[] | null>(null);
  /** 탐색 중 여부 — 동기지만 state 전환 전 render를 위해 */
  const [findingFix, setFindingFix] = useState(false);

  // 초안 전환·닫기 시 AI 상태 초기화 — 이전 초안의 결과가 다른 초안에 붙어 보이는 오귀속 방지.
  // 같은 초안 내 조정(draft_op·undo·redo)에는 유지 — 제안을 따라가며 적용하는 흐름 보존.
  const openDraftId = openDraft?.meta.id;
  useEffect(() => {
    setAiDiagnosis(null);
    setAiDiagError(null);
    setAiCardOpen(false);
    setAiExplain(null);
    setAiExplainError(null);
    setAiExplainCardOpen(false);
    setAiCritique(null);
    setAiCritiqueError(null);
    setAiCritiqueCardOpen(false);
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
      setCachedDraftModel(null);
      setStartMethod("plan");
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
      if (count > 0 && data.model) {
        setCachedDraftModel({ model: data.model, baseGrids: data.baseGrids });
      } else {
        setCachedDraftModel(null);
        setStartMethod("plan");
      }
    } catch {
      setHasBaseGrids(false);
      setCachedDraftModel(null);
      setStartMethod("plan");
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
      setSolverError(err.message || "시간표 자동 작성 중 오류가 발생했습니다.");
      setRunning(false);
      return;
    }

    if (!result.grids || result.grids.length === 0) {
      setSolverError("짤 수 있는 수업이 없습니다. 시수 계획 및 고정 시간을 확인해 주세요.");
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
      setSolverError(err.message);
    } finally {
      setRunning(false);
      setProgress(null);
      runRef.current = null;
    }
  };

  // ── 솔버 실행 ──
  const handleSolve = async () => {
    setSolverError(null);
    setProgress(null);

    let model: TimetableConstraintModel;
    let baseGrids: ClassGrid[];
    if (cachedDraftModel && cachedDraftModel.baseGrids.length > 0) {
      model = cachedDraftModel.model;
      baseGrids = cachedDraftModel.baseGrids;
    } else {
      try {
        const res = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "draft_model", termId: activeTermId }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "제약 모델 로드에 실패했습니다.");
        model = data.model as TimetableConstraintModel;
        baseGrids = data.baseGrids as ClassGrid[];
        setCachedDraftModel({ model, baseGrids });
      } catch (err: any) {
        setSolverError(err.message);
        return;
      }
    }

    if (!baseGrids || baseGrids.length === 0) {
      setSolverError("기초 시간표가 없습니다. 먼저 가져오기 탭에서 시간표를 가져와 주세요.");
      return;
    }

    setRunning(true);
    const run = solveTimetableInWorker({ grids: baseGrids, model }, (phase, done, total) => {
      setProgress({ phase, done, total });
    });
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
      setSolverError(err.message || "솔버 실행 중 오류가 발생했습니다.");
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
          termId: activeTermId,
          draftOrigin: origin,
          draftGrids: result.grids,
          draftUnplaced: unplaced,
          draftReport: report,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "초안 저장에 실패했습니다.");

      await fetchDrafts();
    } catch (err: any) {
      setSolverError(err.message);
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
    setSelectedSlotA(null);
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
      setSelectedSlotA(null);
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
      setSelectedSlotA(null);
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
    setAiCritiqueError(null);
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

  // ── AI 정성 비평 호출 (E-4) ──
  const handleAiCritique = async () => {
    if (!openDraft) return;
    setAiCritiquing(true);
    clearAiErrors();
    setAiCritique(null);
    setAiCritiqueCardOpen(false);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_critique", draftId: openDraft.meta.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "AI 개선 제안 생성 중 오류가 발생했습니다.");
      if (data.enabled === false) {
        setAiEnabled(false);
        return;
      }
      setAiEnabled(true);
      setAiCritique(data.result ?? null);
      setAiCritiqueCardOpen(true);
    } catch (err: any) {
      setAiCritiqueError(err.message);
    } finally {
      setAiCritiquing(false);
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
      alert(`🔒 ${placeholderBlock}`);
      setSelectedSlotA(null);
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

  // ── 셀 클릭 핸들러 (학급 그리드) ──
  const handleCellClick = (day: number, period: number) => {
    if (!openDraft) return;
    const { currentGrids } = openDraft;
    const grid = currentGrids.find((g) => g.grade === viewGrade && g.classNum === viewClass);
    const cell = grid?.cells?.find((c) => c.day === day && c.period === period);
    const lesson = cell?.lessons?.[0];

    // Case 1: 미배정 항목 배정 모드인 경우
    if (selectedUnplaced) {
      const targetSimulLabel = getSimulLabel(viewGrade, viewClass, day, period, lesson);
      if (targetSimulLabel) {
        alert(`🔒 동시수업(분반 이동수업 그룹 '${targetSimulLabel}')은 밴드 묶음 수업으로 수동 교시 이동이 금지되어 있습니다.`);
        return;
      }
      // 미배정 항목을 이 셀에 배정 (edit_cell op)
      // label 형태: "2-3반 통합과학 김○○"
      const desc = `${viewGrade}학년 ${viewClass}반 ${DAYS[day - 1]}${period}교시에 [${selectedUnplaced.label}] 배정`;
      const op: BaseRevisionOp = {
        type: "edit_cell",
        grade: viewGrade,
        classNum: viewClass,
        day,
        period,
        lessons: [
          {
            subjectName: selectedUnplaced.label.split(" ")[1] || "미배정과목",
            subjectShort: selectedUnplaced.label.split(" ")[1] || "미배정",
            teachers: [{ email: "", name: selectedUnplaced.label.split(" ")[2] || "" }],
          },
        ],
      };
      analyzeOpImpact(op, desc);
      return;
    }

    // Case 2: 셀 A가 선택된 상태에서 셀 B(이동/맞교환 목적지) 클릭
    if (selectedSlotA) {
      if (selectedSlotA.day === day && selectedSlotA.period === period) {
        // 동일 셀 클릭 시 선택 해제
        setSelectedSlotA(null);
        return;
      }

      const targetSimulLabel = getSimulLabel(viewGrade, viewClass, day, period, lesson);
      if (targetSimulLabel) {
        alert(`🔒 동시수업(분반 이동수업 그룹 '${targetSimulLabel}')은 밴드 묶음 수업으로 수동 교시 이동이 금지되어 있습니다.`);
        return;
      }

      const cellA = grid?.cells?.find((c) => c.day === selectedSlotA.day && c.period === selectedSlotA.period);
      const lessonA = cellA?.lessons?.[0];

      const slotAName = `${DAYS[selectedSlotA.day - 1]}${selectedSlotA.period}교시(${lessonA?.subjectShort || lessonA?.subjectName || "빈교시"})`;
      const slotBName = `${DAYS[day - 1]}${period}교시(${lesson?.subjectShort || lesson?.subjectName || "빈교시"})`;
      const desc = `${viewGrade}학년 ${viewClass}반 ${slotAName} ↔ ${slotBName} 이동/맞교환`;

      const op: BaseRevisionOp = {
        type: "swap",
        grade: viewGrade,
        classNum: viewClass,
        a: { day: selectedSlotA.day, period: selectedSlotA.period },
        b: { day, period },
      };

      analyzeOpImpact(op, desc);
      return;
    }

    // Case 3: 소스 셀 A 선택
    if (!lesson) {
      // 빈 셀 클릭 시 조용히 무시
      return;
    }

    // 고정 밴드 셀(동시수업 simul) 방어 🔒
    const simulLabel = getSimulLabel(viewGrade, viewClass, day, period, lesson);
    if (simulLabel) {
      alert(`🔒 동시수업(분반 이동수업 그룹 '${simulLabel}')은 밴드 묶음 수업으로 수동 교시 이동이 금지되어 있습니다.`);
      return;
    }

    // 자리표시(창체·SLAT) 셀 방어 🔒 — 목적지 클릭까지 기다리지 않고 선택 시점에 알린다
    const placeholder = findPlaceholderLesson(currentGrids, viewGrade, viewClass, day, period);
    if (placeholder) {
      alert(
        `🔒 '${placeholder.subjectName}'은 담당 선생님이 지정되지 않은 수업이라 학교 전체가 같은 시간에 묶여 있습니다. 한 학급만 옮기거나 맞바꿀 수 없습니다.`
      );
      return;
    }

    // 셀 A 선택 완료
    setSelectedSlotA({ day, period });

    // 해당 수업 교사가 존재하면 우측 교사 그리드 자동 선택
    if (lesson.teachers?.[0]?.email) {
      setSelectedTeacherEmail(lesson.teachers[0].email);
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
      setSelectedSlotA(null);
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
            {/* 배지 */}
            <button
              onClick={() => setShowHardDetails((o) => !o)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border font-extrabold cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${hardBadgeColor(report.hard.length)}`}
              title="클릭하여 하드 위반 상세를 확인하거나 접습니다"
            >
              <span>하드 위반 {report.hard.length}건</span>
              <span className="text-[10px]">{showHardDetails ? "▲" : "▼"}</span>
            </button>
            <button
              onClick={() => setShowSoftDetails((o) => !o)}
              className="text-[11px] px-2.5 py-0.5 rounded-full border font-extrabold bg-amber-100 text-amber-900 border-amber-300 cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1"
              title="클릭하여 소프트 감점 상세를 확인하거나 접습니다"
            >
              <span>소프트 {report.soft.total}점</span>
              <span className="text-[10px]">{showSoftDetails ? "▲" : "▼"}</span>
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
                disabled={aiExplaining || aiCritiquing}
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

            {/* E-4 개선 제안 버튼 — 키 설정 시에만 노출 */}
            {aiEnabled !== false && (
              <button
                onClick={handleAiCritique}
                disabled={aiCritiquing || aiExplaining}
                className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-emerald-800 font-bold rounded-lg text-xs border border-emerald-300 transition-all flex items-center gap-1.5"
                title="이 시간표의 개선 여지를 제안합니다 (참고용)"
              >
                {aiCritiquing ? (
                  <>
                    <span className="animate-spin rounded-full h-3 w-3 border-2 border-emerald-600 border-t-transparent" />
                    <span>제안 생성 중...</span>
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    <span>개선 제안 (AI 도움)</span>
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
              disabled={!canUndo || loadingDraft}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 font-bold rounded-lg text-xs transition-all flex items-center gap-1"
              title="실행 취소 (Undo)"
            >
              <span>↩ 실행취소</span>
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo || loadingDraft}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 font-bold rounded-lg text-xs transition-all flex items-center gap-1"
              title="다시 실행 (Redo)"
            >
              <span>↪ 다시실행</span>
            </button>
            <button
              onClick={() => setShowOpsHistory(true)}
              className="px-3 py-1 bg-purple-50 hover:bg-purple-100 text-purple-800 font-bold rounded-lg text-xs border border-purple-200 transition-all"
            >
              📋 작업기록 ({meta.opCursor}/{meta.ops.length})
            </button>

            {/* 기초시간표로 채택 버튼 (spec §5) — 초안 학기(status: draft)에서만 노출 */}
            {isDraftTerm && (
              <button
                onClick={handleAdoptDraft}
                disabled={adopting || loadingDraft || report.hard.length > 0}
                className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold rounded-lg text-xs shadow-xs transition-all flex items-center gap-1.5"
                title={report.hard.length > 0 ? "하드 위반이 남아 있어 채택할 수 없습니다" : "이 결과를 정식 기초시간표로 채택합니다"}
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

        {/* AI 에러 배너 (E-1b / E-3 / E-4 공용) */}
        {(aiDiagError || aiExplainError || aiCritiqueError) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold flex items-start gap-2">
            <span>⚠️</span>
            <span>{aiDiagError || aiExplainError || aiCritiqueError}</span>
          </div>
        )}

        {/* F-1 하드 위반 상세 패널 (E-1b AI 진단 카드와 동일 접이식 디자인) */}
        {showHardDetails && openDraft && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between bg-red-100/70 border-b border-red-200">
              <div className="flex items-center gap-2">
                <span className="text-base">🔴</span>
                <span className="text-xs font-bold text-red-950">하드 위반 상세 (총 {report.hard.length}건)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-200 text-red-900 font-bold border border-red-300">
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
                          <span className="text-[10px] font-extrabold px-2 py-0.2 rounded-full bg-red-200 text-red-900">
                            {items.length}건
                          </span>
                        </div>
                        {regularItems.map(renderItem)}

                        {gapItems.length > 0 && (
                          <details className="mt-2 text-xs group">
                            <summary className="cursor-pointer text-[11px] font-bold text-gray-600 hover:text-gray-900 py-1 flex items-center gap-1.5 select-none">
                              <span>📋</span>
                              <span>등록부 미비로 추정 ({gapItems.length}건)</span>
                              <span className="text-[10px] text-gray-400 group-open:rotate-180 transition-transform">▼</span>
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
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold border border-amber-300">
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
                            <span className="text-[10px] font-extrabold px-2 py-0.2 rounded-full bg-amber-200 text-amber-900">
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
                                {/* 항목 행 */}
                                <div className="bg-white rounded-lg border border-amber-100 p-3 flex items-center justify-between gap-3 shadow-2xs">
                                  <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-amber-900 shrink-0">[{item.label}]</span>
                                    {item.day && (
                                      <span className="text-[11px] px-1.5 py-0.2 rounded bg-gray-100 text-gray-700 font-semibold shrink-0">
                                        {DAYS[item.day - 1]}요일
                                      </span>
                                    )}
                                    <span className="text-gray-800">{item.text}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-extrabold text-amber-800 text-xs">−{item.points}점</span>
                                    <button
                                      onClick={() => handleFindFix(item)}
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
                                                ? `이 수업을 다른 요일로 옮기려면 그 날의 빈 교시가 필요합니다. 같은 학급 안에서 비어 있는 자리는 대부분 창체·SLAT 자리표시 칸이라, 규칙상 옮길 수 없습니다. 학급 간 교환(현재 미지원)이나 학급 전체 편성 조정이 필요합니다.`
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
                                              <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-extrabold flex items-center justify-center mt-0.5">
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
                                                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
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
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-200 text-violet-800 font-bold border border-violet-300">
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
                          <span className="shrink-0 w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-extrabold flex items-center justify-center mt-0.5">
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
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-200 text-sky-800 font-bold border border-sky-300">
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

        {/* AI 개선 제안 카드 (E-4) — 접이식, 결과 있을 때만 */}
        {aiCritique && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 overflow-hidden">
            <button
              onClick={() => setAiCritiqueCardOpen((o) => !o)}
              className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-emerald-100/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">✨</span>
                <span className="text-xs font-bold text-emerald-900">개선 제안</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-bold border border-emerald-300">
                  AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
                </span>
              </div>
              <span className="text-emerald-500 text-xs font-bold">
                {aiCritiqueCardOpen ? "▲ 접기" : "▼ 펼치기"}
              </span>
            </button>
            {aiCritiqueCardOpen && (
              <div className="px-5 pb-5 space-y-4">
                {aiCritique.suggestions.length === 0 ? (
                  <div className="bg-white rounded-xl border border-emerald-100 p-4 text-xs text-gray-500 italic">
                    AI가 뚜렷한 개선점을 찾지 못했습니다.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {aiCritique.suggestions.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 bg-white rounded-lg border border-emerald-100 px-3.5 py-2.5 text-xs text-gray-800 font-medium"
                      >
                        <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-emerald-700 font-semibold text-center pt-1">
                  ⚠️ AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
                </p>
              </div>
            )}
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

        {/* 3면 IA 레이아웃: 좌=학급 그리드(8 col), 우=교사 파생 그리드 + 미배정 목록(4 col) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* 좌: 학급 그리드 */}
          <div className="xl:col-span-8 space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-700">학년:</span>
                  {[1, 2, 3].map((g) => (
                    <button
                      key={g}
                      onClick={() => {
                        setViewGrade(g);
                        setViewClass(1);
                        setSelectedSlotA(null);
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
                  {Array.from({ length: 12 }, (_, i) => i + 1)
                    .filter((c) =>
                      openDraft.currentGrids.some((g) => g.grade === viewGrade && g.classNum === c)
                    )
                    .map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setViewClass(c);
                          setSelectedSlotA(null);
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

                {selectedSlotA && (
                  <span className="text-xs font-bold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200">
                    선택: {DAYS[selectedSlotA.day - 1]}요일 {selectedSlotA.period}교시 (이동할 목적지 셀을 선택하세요)
                  </span>
                )}
              </div>
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
                      {DAYS.map((d) => (
                        <th key={d} className="py-2.5 px-1 border-r border-gray-200 min-w-[5.5rem]">
                          {d}
                        </th>
                      ))}
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

                          const isSelectedA = selectedSlotA?.day === day && selectedSlotA?.period === period;
                          const isCandidateB = !!selectedSlotA && !isSelectedA;
                          const simulLabel = getSimulLabel(viewGrade, viewClass, day, period, lesson);
                          const isBandLocked = !!simulLabel;

                          // 하드 위반 셀 체크 (현재 그리드 기준, 좌표가 존재하는 항목만 대조하여 H8·H9 사각지대 해소)
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
                              className={`p-2 border-r border-gray-200 align-top transition-all cursor-pointer select-none ${
                                isSelectedA
                                  ? "bg-sky-100 border-2 border-sky-500 ring-2 ring-sky-400/50 shadow-sm"
                                  : isCandidateB
                                  ? "bg-emerald-50 hover:bg-emerald-100/90 border border-emerald-300 font-semibold"
                                  : hasHardError
                                  ? "bg-red-100 text-red-950 font-bold border-2 border-red-400"
                                  : isBandLocked
                                  ? "bg-gray-100/80 text-gray-400 cursor-not-allowed"
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
                                    <div className="text-[9px] text-purple-700 font-extrabold mt-0.5">
                                      🔒 {simulLabel}
                                    </div>
                                  )}
                                  {isCandidateB && (
                                    <div className="text-[10px] text-emerald-700 font-black mt-1">
                                      ⇄ 맞교환
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="py-1">
                                  {isCandidateB ? (
                                    <span className="text-[10px] text-emerald-700 font-bold">📥 이동</span>
                                  ) : (
                                    <span className="text-[10px] text-gray-300">—</span>
                                  )}
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

          {/* 우: 교사 파생 그리드 + 미배정 목록 */}
          <div className="xl:col-span-4 space-y-4">
            {/* 교사 파생 그리드 카드 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <span>👤 교사 주간 시간표 파생</span>
                </h4>
                {selectedTeacherEmail && (
                  <span className="text-[11px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded">
                    {selectedTeacherEmail}
                  </span>
                )}
              </div>

              {!selectedTeacherEmail ? (
                <div className="py-6 text-center text-xs text-gray-400">
                  시간표 셀을 클릭하면 해당 교사의 주간 시간표가 자동 표시됩니다.
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-100 rounded-lg text-[11px]">
                  <table className="w-full text-center border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600">
                        <th className="py-1 px-1 border-r border-gray-200 w-7">교시</th>
                        {DAYS.map((d) => (
                          <th key={d} className="py-1 px-1 border-r border-gray-200">
                            {d}
                          </th>
                        ))}
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
                    return (
                      <div
                        key={u.sectionId}
                        className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                          isSelected
                            ? "bg-indigo-100 border-indigo-500 ring-2 ring-indigo-400/50"
                            : "bg-red-50/80 border-red-200 hover:border-red-300"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-xs text-red-950 truncate">{u.label}</p>
                          <p className="text-[10px] text-red-700 font-semibold mt-0.5">
                            잔여 {u.remaining}시수 미배정
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedUnplaced(isSelected ? null : u)}
                          className={`px-2.5 py-1 rounded text-xs font-bold shadow-xs shrink-0 transition-all ${
                            isSelected
                              ? "bg-indigo-600 text-white"
                              : "bg-red-600 hover:bg-red-700 text-white"
                          }`}
                        >
                          {isSelected ? "선택됨" : "배정하기"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

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
                            #{idx + 1} {op.type === "swap" ? "맞교환/이동" : "셀 통째 수정"} ({op.grade}학년 {op.classNum}반)
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] bg-purple-700 text-white font-extrabold px-1.5 py-0.5 rounded">
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
          <span>자동 작성 & 수동 조정</span>
        </div>
        <p>
          솔버가 작성한 초안을 기반으로 셀 이동·맞교환 및 연쇄 영향 미리보기를 수행하여 하드 위반 0건 완성을 진행합니다.
        </p>
        <p className="text-[11px] text-indigo-700 font-semibold">
          💡 중대한 문제가 생기는 이동은 실행이 자동으로 차단됩니다.
        </p>
      </div>

      {/* ── 어떻게 짤까요? 시작 방법 선택 (phase9c_i_spec §7) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 shadow-xs">
        <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
          <span>🎯</span>
          <span>어떻게 짤까요?</span>
        </h4>
        <div className="space-y-2.5 text-xs">
          {/* 방법 1: 현행 시간표에서 다시 짜기 */}
          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border transition-all cursor-pointer ${
              startMethod === "grid"
                ? "bg-indigo-50/70 border-indigo-300 text-indigo-950 font-semibold ring-1 ring-indigo-200"
                : hasBaseGrids === false
                ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
                : "border-gray-200 hover:bg-gray-50 text-gray-700"
            }`}
            title={hasBaseGrids === false ? "이 학기에는 아직 시간표가 없어 이 방법을 쓸 수 없습니다." : undefined}
          >
            <input
              type="radio"
              name="startMethod"
              value="grid"
              checked={startMethod === "grid"}
              disabled={hasBaseGrids === false}
              onChange={() => setStartMethod("grid")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold">현행 시간표에서 다시 짜기</span>
                {hasBaseGrids === false && (
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-normal">
                    기초 시간표 없음
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 font-normal">
                등록된 기초 시간표의 수업 구성과 교사를 기준으로 시간표를 다시 배치합니다.
              </p>
            </div>
          </label>

          {/* 방법 2: 시수 계획으로 새로 짜기 */}
          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border transition-all cursor-pointer ${
              startMethod === "plan"
                ? "bg-indigo-50/70 border-indigo-300 text-indigo-950 font-semibold ring-1 ring-indigo-200"
                : "border-gray-200 hover:bg-gray-50 text-gray-700"
            }`}
          >
            <input
              type="radio"
              name="startMethod"
              value="plan"
              checked={startMethod === "plan"}
              onChange={() => setStartMethod("plan")}
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">시수 계획으로 새로 짜기</span>
                {plans.length > 0 && (
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    disabled={startMethod !== "plan"}
                    onClick={(e) => e.stopPropagation()}
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
                신학기 주당 수업 시간 계획과 교육과정 고정 시간을 결합해 시간표를 백지에서 새로 짭니다.
              </p>
              {plans.length === 0 && !loadingPlans && (
                <div className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
                  이 학기로 지정된 시수 계획이 없습니다. 「선생님별 주당 수업 시간」에서 먼저 만들어 주세요.
                </div>
              )}
            </div>
          </label>
        </div>
      </div>

      {/* 실행 버튼 */}
      <div className="flex flex-wrap gap-3">
        {!running ? (
          startMethod === "grid" ? (
            <>
              <button
                onClick={handleSolve}
                disabled={hasBaseGrids === false}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2"
              >
                <span>🤖 자동 작성 실행</span>
              </button>
              <button
                onClick={handleCopy}
                disabled={hasBaseGrids === false}
                className="px-4 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-bold rounded-xl text-xs border border-gray-300 shadow-sm transition-all flex items-center gap-2"
              >
                <span>📋 현행 시간표 복제로 시작</span>
              </button>
            </>
          ) : (
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
                  <span>시수 계획으로 자동 작성 시작</span>
                </>
              )}
            </button>
          )
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
                  {preflightData.stats.cohortMissingGrades.join(", ")}학년의 교육과정 고정 시간이 등록돼 있지 않습니다. 창체·SLAT 자리가 비게 됩니다.
                </p>
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
            <span>⚙️ {progress.phase}</span>
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
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold">
          ⚠️ {solverError}
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
            <p>위 버튼으로 자동 작성을 실행하거나 현행 시간표를 복제해 시작하세요.</p>
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
                          ? `🤖 자동 작성 (시드 ${draft.origin.seed ?? "—"})`
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

                  <div className="text-[10px] text-gray-400">
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
