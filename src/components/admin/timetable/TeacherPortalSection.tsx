"use client";

/**
 * Phase 9b 순서 4: 교사 신청 화면 — "내 시간표" 메뉴
 *
 * 스펙: phase9b_spec.md §7, §4-4
 * 탭 구성:
 *   ① 내 주간시간표  — 변경 셀 빨간 배경 + 텍스트 마커, 마우스오버 툴팁
 *                    셀 클릭 → 후보 초록 하이라이트 → 신청 플로우
 *   ② 내 신청 내역  — my_list, PENDING 취소 버튼
 *   ③ 다른 시간표 조회 — 주간 합성본 지원
 *
 * 노출 게이트: managerEmails·super_admin + teacherOpen 플래그 true 시 전 교사
 * 학생은 어떤 경우에도 미노출 (서버 라우트도 학생 차단)
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { toBlob } from "html-to-image";
import {
  SWAP_REASON_TYPES,
  SwapCandidate,
  SwapCandidatesResult,
  SwapCandidatesAllResult,
  SwapDraft,
  SwapRequest,
  SwapRequestReason,
  SwapBatchItemResult,
  ProjectedDayLoad,
  SubstituteCandidate,
  TeacherTimetableCell,
  TimetableSettings,
  TimetableWeek,
  ChainSearchChain,
  ChainStepItem,
} from "@/lib/timetable/types";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import {
  DAY_LABEL,
  getDayDateLabel,
  getWeekRangeLabel,
  formatSlotWithDate,
  buildShareCardMessage,
  formatCoordinationText,
  formatCandidateSlotLabel,
  getCoordinationOccupants,
} from "@/lib/timetable/utils";

import PaginationControls from "./PaginationControls";
import MiniPreviewGrid from "./MiniPreviewGrid";
import CoordinationNoticeBlock from "./CoordinationNoticeBlock";
import {
  ShareCardData,
  ConsolidatedShareData,
  OffscreenShareCard,
  OffscreenConsolidatedCard as OffscreenConsolidatedShareCard,
  copyShareImageElement,
} from "./OffscreenShareCard";
import CalendarSubscribeCard from "@/components/calendar/CalendarSubscribeCard";

const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

/** 주 목록에서 기본 선택할 주 ID 계산 (현재 주 → 가장 가까운 미래 주 → 첫 주) */
function findDefaultWeekId(weeks: TimetableWeek[]): string {
  if (!weeks || weeks.length === 0) return "";

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayStr = `${year}-${month}-${day}`;

  // ① 오늘 날짜가 속한 주 (startDate ~ startDate + 6일)
  const currentWeek = weeks.find((w) => {
    if (!w.startDate) return false;
    const parts = w.startDate.split("-").map((v) => parseInt(v, 10));
    if (parts.length < 3 || isNaN(parts[0])) return false;
    const startObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const endObj = new Date(startObj);
    endObj.setDate(endObj.getDate() + 6); // 일요일까지

    const endY = endObj.getFullYear();
    const endM = String(endObj.getMonth() + 1).padStart(2, "0");
    const endD = String(endObj.getDate()).padStart(2, "0");
    const endStr = `${endY}-${endM}-${endD}`;

    return todayStr >= w.startDate && todayStr <= endStr;
  });

  if (currentWeek) return currentWeek.id;

  // ② 없으면 가장 가까운 미래 주 (startDate > todayStr 중 가장 빠른 날짜)
  const futureWeeks = weeks
    .filter((w) => w.startDate && w.startDate > todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (futureWeeks.length > 0) return futureWeeks[0].id;

  // ③ 그것도 없으면 첫 번째 주
  return weeks[0].id;
}

// ── ① 내 주간시간표 탭 (v2.1: 전 주 인라인 후보 하이라이트 & candidates_all 연동) ─────

interface MyTimetableTabProps {
  periodsPerDay: number;
  settings: TimetableSettings | null;
}

interface ProjectedWeek {
  weekId: string;
  startDate: string;
  days: { num: number; label: string }[];
  cells: TeacherTimetableCell[];
  dayLoads: ProjectedDayLoad[];
  commonActivitySlots?: Array<{ day: number; period: number }>; // §3-2d S1 — U4 체인 목적지 제외 재료
  dayPeriodCounts?: Array<{ day: number; periods: number }>; // 수집 20 — 그 요일의 실제 운영 교시 수(금7 등 미편성 제외)
}

function MyTimetableTab({ periodsPerDay, settings }: MyTimetableTabProps) {
  const { user, userData, teacherProfile } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";
  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);

  // 주 목록
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [targetWeekId, setTargetWeekId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §14-2 v2: 등록 전 주 예상 내 시간표 상태 (my_projected)
  const [projectedData, setProjectedData] = useState<{
    termId: string;
    weeks: ProjectedWeek[];
    assumedPendingCount: number;
    assumedDraftCount: number;
  } | null>(null);

  // §14-2 v2.1: 전 주 후보 일괄 결과 상태 (candidates_all)
  const [candidatesAllResult, setCandidatesAllResult] = useState<SwapCandidatesAllResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // 유효 대상 주 계산 (교차 주 지원)
  const effectiveTargetWeekId = targetWeekId || selectedWeekId;
  const isCrossWeek = effectiveTargetWeekId !== "" && effectiveTargetWeekId !== selectedWeekId;

  const sourceWeekObj = weeks.find((w) => w.id === selectedWeekId);
  const targetWeekObj = weeks.find((w) => w.id === effectiveTargetWeekId);

  // 소스 셀 클릭 상태 (선택된 셀 + 속한 주 ID)
  const [selectedCell, setSelectedCell] = useState<(TeacherTimetableCell & { weekId: string }) | null>(null);

  // 호버/선택 후보 및 신청 사유
  const [applyingCandidate, setApplyingCandidate] = useState<SwapCandidate | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [reason, setReason] = useState<SwapRequestReason>({ type: "출장" });
  const [batchReason, setBatchReason] = useState<SwapRequestReason>({ type: "출장" });

  // 임시저장함 단건/일괄 신청 양해 확인 상태 (반려 4건 반영)
  const [draftConsentConfirmed, setDraftConsentConfirmed] = useState(false);
  const [draftConsentNote, setDraftConsentNote] = useState("");
  const [batchConfirmingDrafts, setBatchConfirmingDrafts] = useState<SwapDraft[] | null>(null);
  const [batchConsentConfirmed, setBatchConsentConfirmed] = useState(false);
  const [batchConsentNote, setBatchConsentNote] = useState("");

  // §3-2b v1.1: 조율 필요 후보 인라인 클릭 시 2단 경고 다이얼로그 상태
  const [pendingCoordinationSave, setPendingCoordinationSave] = useState<{ candidate: SwapCandidate; weekId: string } | null>(null);

  // 본인의 대기 중인 묶음 이동(simul_move) 신청 목록 (그리드 배지용)
  const [myPendingSimulMoves, setMyPendingSimulMoves] = useState<SwapRequest[]>([]);

  // §4-2 교사 체인 탐색 & 신청 관련 상태 (consent_swap_opening_spec §4-2·§4-3)
  const [isChainMode, setIsChainMode] = useState(false);
  const [chainTarget, setChainTarget] = useState<{ weekId?: string; day: number; period: number } | null>(null);
  const [chainSearching, setChainSearching] = useState(false);
  const [chainSearchError, setChainSearchError] = useState<string | null>(null);
  const [chainSearchResults, setChainSearchResults] = useState<ChainSearchChain[] | null>(null);
  const [chainSearchReason, setChainSearchReason] = useState<string | null>(null);
  const [selectedChainForSubmit, setSelectedChainForSubmit] = useState<ChainSearchChain | null>(null);
  const [chainConsentModalOpen, setChainConsentModalOpen] = useState(false);
  const [chainConsentConfirmed, setChainConsentConfirmed] = useState(false);
  const [chainConsentNote, setChainConsentNote] = useState("");
  const [chainReasonType, setChainReasonType] = useState<any>("출장"); // SWAP_REASON_TYPES 내 값이어야 — 목록 밖 초기값이면 기본 경로 제출이 서버 400
  const [chainReasonNote, setChainReasonNote] = useState("");
  const [submittingChain, setSubmittingChain] = useState(false);

  useEffect(() => {
    setConsentConfirmed(false);
    setConsentNote("");
  }, [applyingCandidate]);

  const handleExecuteChainSearch = async (tgtWeekId: string, day: number, period: number) => {
    if (!selectedCell) return;
    setIsChainMode(true);
    setApplyingCandidate(null);
    setChainTarget({ weekId: tgtWeekId, day, period });
    setChainSearching(true);
    setChainSearchError(null);
    setChainSearchResults(null);
    setChainSearchReason(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chain_search",
          weekId: selectedCell.weekId,
          source: {
            grade: selectedCell.grade,
            classNum: selectedCell.classNum,
            day: selectedCell.day,
            period: selectedCell.period,
            subjectName: selectedCell.subjectName,
          },
          chainTarget: {
            weekId: tgtWeekId || selectedCell.weekId,
            day,
            period,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "체인 경로 탐색에 실패했습니다.");
      }
      setChainSearchResults(data.chains || []);
      setChainSearchReason(data.reason || null);
    } catch (e: any) {
      setChainSearchError(e.message || "체인 탐색 중 오류가 발생했습니다.");
    } finally {
      setChainSearching(false);
    }
  };

  const handleOpenChainConsentModal = (chain: ChainSearchChain) => {
    setSelectedChainForSubmit(chain);
    setChainConsentConfirmed(false);
    setChainConsentNote("");
    setChainReasonType("출장");
    setChainReasonNote("");
    setChainConsentModalOpen(true);
  };

  const handleExecuteChainCreate = async () => {
    if (!selectedCell || !chainTarget || !selectedChainForSubmit) return;
    if (!chainConsentConfirmed) {
      alert("관련 선생님 전원에게 사전 양해를 받았음을 확인해 주세요.");
      return;
    }
    if (chainReasonType === "기타" && !chainReasonNote.trim()) {
      alert("사유가 '기타'인 경우 상세 사유를 입력해 주세요.");
      return;
    }

    setSubmittingChain(true);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chain_create",
          weekId: selectedCell.weekId,
          source: {
            grade: selectedCell.grade,
            classNum: selectedCell.classNum,
            day: selectedCell.day,
            period: selectedCell.period,
            subjectName: selectedCell.subjectName,
          },
          chainTarget: {
            weekId: chainTarget.weekId || selectedCell.weekId,
            day: chainTarget.day,
            period: chainTarget.period,
          },
          chainSteps: selectedChainForSubmit.steps,
          reason: {
            type: chainReasonType,
            note: chainReasonNote.trim() || undefined,
          },
          consent: {
            confirmed: true,
            note: chainConsentNote.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "체인 신청 제출에 실패했습니다.");
      }
      setFlash("⚡ 징검다리 체인 교체 신청이 접수되었습니다! 관련 선생님 전원에게 통지가 발송되었습니다.");
      setChainConsentModalOpen(false);
      setSelectedChainForSubmit(null);
      setIsChainMode(false);
      setChainTarget(null);
      setChainSearchResults(null);
      setApplyingCandidate(null);
      setSelectedCell(null);
      await fetchMyProjected();
    } catch (e: any) {
      alert(`체인 신청 오류: ${e.message}`);
    } finally {
      setSubmittingChain(false);
    }
  };


  const [submitting, setSubmitting] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  // 진행 중 표시·완료 토스트 — 서버 왕복이 길 때 클릭이 반영 중임을 화면에 보여준다
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [shareCardData, setShareCardData] = useState<ShareCardData | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);

  // §13-1b: 상대 교사별 융합 양해 카드 & 사전 양해 임시저장함 (MyTimetableTab 소유)
  const [myDrafts, setMyDrafts] = useState<SwapDraft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(true);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [confirmingDraft, setConfirmingDraft] = useState<SwapDraft | null>(null);
  const [draftReason, setDraftReason] = useState<SwapRequestReason>({ type: "출장" });
  const [submittingDraftId, setSubmittingDraftId] = useState<string | null>(null);
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false);
  const [deletingAllDrafts, setDeletingAllDrafts] = useState(false);
  const [draftShareData, setDraftShareData] = useState<ShareCardData | null>(null);
  const draftShareRef = useRef<HTMLDivElement>(null);
  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedShareData | null>(null);
  const consolidatedCardRef = useRef<HTMLDivElement>(null);
  const [generatingShareFor, setGeneratingShareFor] = useState<string | null>(null);

  // 상대 교사 시간표 미리보기 상태
  const [previewCells, setPreviewCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartSourceCells, setCounterpartSourceCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartTargetCells, setCounterpartTargetCells] = useState<TeacherTimetableCell[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewCacheRef = useRef<Map<string, TeacherTimetableCell[]>>(new Map());

  /** 상대 교사의 특정 주 시간표 셀 조회 (세션 캐시) — 사이드바 미리보기·융합 양해 카드 공용 */
  const fetchTeacherWeekCells = useCallback(async (email: string, wId: string) => {
    const cacheKey = `${email}_${wId}`;
    if (previewCacheRef.current.has(cacheKey)) {
      return previewCacheRef.current.get(cacheKey)!;
    }
    const res = await fetch("/api/timetable/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "teacher", teacherEmail: email, weekId: wId || undefined }),
    });
    if (!res.ok) throw new Error("시간표를 불러올 수 없습니다.");
    const data = await res.json();
    const fetched: TeacherTimetableCell[] = data.data?.cells || [];
    previewCacheRef.current.set(cacheKey, fetched);
    return fetched;
  }, []);

  // §14-2 v2: my_projected 전 주 예상 시간표 로드
  const fetchMyProjected = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "my_projected",
          includeMyPending: true,
          includeDrafts: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectedData({
          termId: data.termId || "",
          weeks: data.weeks || [],
          assumedPendingCount: data.assumedPendingCount || 0,
          assumedDraftCount: data.assumedDraftCount || 0,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "예상 시간표를 불러올 수 없습니다.");
      }

      // 본인의 대기 중 묶음 이동 목록 조회 (그리드 뱃지용)
      try {
        const reqRes = await fetch("/api/timetable/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "my_list" }),
        });
        if (reqRes.ok) {
          const reqData = await reqRes.json();
          const list: SwapRequest[] = reqData.requests || [];
          setMyPendingSimulMoves(list.filter((r) => r.status === "PENDING" && r.type === "simul_move"));
        }
      } catch {}
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyProjected();
  }, [fetchMyProjected]);

  // 완료 토스트 자동 숨김
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const termId = settings?.activeTermId;
    if (!termId) return;
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) {
          const loadedWeeks: TimetableWeek[] = data.weeks || [];
          setWeeks(loadedWeeks);
          if (loadedWeeks.length > 0) {
            const defaultId = findDefaultWeekId(loadedWeeks);
            if (defaultId) {
              setSelectedWeekId((prev) => (prev ? prev : defaultId));
            }
          }
        }
      })
      .catch(() => {});
  }, [settings?.activeTermId]);

  // §14-2 v2.1: candidates_all 1회 호출로 전 주 맞교환 후보 계산
  const fetchCandidatesAll = useCallback(async (cell: TeacherTimetableCell, srcWeekId: string) => {
    setCandidatesAllResult(null);
    setCandidatesError(null);
    setCandidatesLoading(true);
    setApplyingCandidate(null);
    setSubmitResult(null);
    setPreviewCells(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "candidates_all",
          weekId: srcWeekId,
          includeMyPending: true,
          includeDrafts: true,
          source: {
            grade: cell.grade,
            classNum: cell.classNum,
            day: cell.day,
            period: cell.period,
            subjectName: cell.subjectName,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCandidatesAllResult(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setCandidatesError(err.error || "전 주 맞교환 후보를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setCandidatesError(`오류: ${e.message}`);
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  const handleCellClick = (cell: TeacherTimetableCell, srcWeekId: string) => {
    if (savingDraft || deletingDraftId) return; // 반영 중 추가 클릭으로 상태가 꼬이는 것 방지
    // §3-2d U6ⓑ: 소스가 바뀌면 이전 소스 기준의 체인 목적지·결과는 무효 — 잔존 표시 방지 (체인 모드 자체는 유지)
    setChainTarget(null);
    setChainSearchResults(null);
    setChainSearchError(null);
    setChainSearchReason(null);
    setSelectedCell({ ...cell, weekId: srcWeekId });
    setSelectedWeekId(srcWeekId);
    setTargetWeekId(srcWeekId);
    fetchCandidatesAll(cell, srcWeekId);
  };

  // 초안 셀 삭제 (draft_delete -> my_projected 원복)
  const handleDeleteDraftById = async (draftId: string) => {
    if (deletingDraftId || savingDraft) return;
    if (!confirm("이 임시저장 초안을 삭제하시겠습니까?")) return;
    setDeletingDraftId(draftId);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId }),
      });
      if (res.ok) {
        await fetchMyProjected();
        setFlash("🗑️ 초안이 삭제되었습니다.");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`초안 삭제 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    } finally {
      setDeletingDraftId(null);
    }
  };

  // §13-1b: 초안 목록 로드 — my_projected의 초안 수가 변할 때마다 동기화
  const refreshDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list" }),
      });
      if (res.ok) {
        const data = await res.json();
        const loadedDrafts: SwapDraft[] = data.drafts || [];
        setMyDrafts(loadedDrafts);
        setSelectedDraftIds(loadedDrafts.filter((d) => !d.conditional).map((d) => d.id));
      }
    } catch {
      // 융합 카드 버튼이 안 뜰 뿐 — 치명적이지 않으므로 무시
    }
  }, []);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts, projectedData?.assumedDraftCount]);

  // §3-2d U3: 초안 전체 비우기 (draft_delete_all)
  const handleDeleteAllDrafts = async () => {
    setDeletingAllDrafts(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete_all" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "초안 전체 삭제에 실패했습니다.");
      }
      setDeleteAllModalOpen(false);
      setSubmitResult(`🚀 초안 ${data.deletedCount || myDrafts.length}건을 전량 삭제했습니다.`);
      await Promise.all([refreshDrafts(), fetchMyProjected()]);
    } catch (e: any) {
      setError(e.message || "초안 전체 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingAllDrafts(false);
    }
  };

  const handleDeleteDraft = async (draftId: string) => {
    if (!confirm("이 임시저장 초안을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId }),
      });
      if (res.ok) {
        setDraftErrors((prev) => {
          const next = { ...prev };
          delete next[draftId];
          return next;
        });
        await Promise.all([refreshDrafts(), fetchMyProjected()]);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`초안 삭제 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    }
  };

  const handleCopyDraftShareImage = async (draft: SwapDraft) => {
    try {
      const isCrossWeek = !!(draft.targetWeekId && draft.targetWeekId !== draft.sourceWeekId);
      const effTargetWeekId = draft.targetWeekId || draft.sourceWeekId;

      let srcWeekObj: TimetableWeek | null = null;
      let tgtWeekObj: TimetableWeek | null = null;
      if (weeks && weeks.length > 0) {
        srcWeekObj = weeks.find((w) => w.id === draft.sourceWeekId) || null;
        tgtWeekObj = weeks.find((w) => w.id === effTargetWeekId) || null;
      }

      let pCells: TeacherTimetableCell[] | null = null;
      let cpSrcCells: TeacherTimetableCell[] | null = null;
      let cpTgtCells: TeacherTimetableCell[] | null = null;

      if (draft.candidate.counterpartEmail) {
        if (!isCrossWeek) {
          pCells = await fetchTeacherWeekCells(draft.candidate.counterpartEmail, draft.sourceWeekId);
        } else {
          cpSrcCells = await fetchTeacherWeekCells(draft.candidate.counterpartEmail, draft.sourceWeekId);
          cpTgtCells = await fetchTeacherWeekCells(draft.candidate.counterpartEmail, effTargetWeekId);
        }
      }

      const currentUserName = user?.displayName || teacherProfile?.name || userEmail.split("@")[0] || "교사";
      setDraftShareData({
        variant: "counterpart",
        requesterName: currentUserName,
        sourceWeekId: draft.sourceWeekId,
        targetWeekId: isCrossWeek ? effTargetWeekId : undefined,
        source: draft.source,
        candidate: draft.candidate,
        previewCells: pCells,
        counterpartSourceCells: cpSrcCells,
        counterpartTargetCells: cpTgtCells,
        sourceWeekObj: srcWeekObj,
        targetWeekObj: tgtWeekObj,
        periodsPerDay,
      });

      setTimeout(() => {
        copyShareImageElement(draftShareRef.current);
      }, 100);
    } catch (e: any) {
      alert(`공유 이미지 생성 실패: ${e.message}`);
    }
  };

  const executeCreateBatchInTab = async (itemsToSubmit: SwapDraft[], consentNoteInput?: string) => {
    setSubmittingBatch(true);
    setSubmitResult(null);
    setError(null);

    try {
      const simulDrafts = itemsToSubmit.filter((d) => !!d.candidate?.coordination?.simul);
      const swapDrafts = itemsToSubmit.filter((d) => !d.candidate?.coordination?.simul);

      let okCount = 0;
      let failCount = 0;
      const newErrors = { ...draftErrors };

      // 1) 동시수업 묶음 이동 초안은 simul_move_create로 개별 처리
      for (const d of simulDrafts) {
        try {
          const simRes = await fetch("/api/timetable/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "simul_move_create",
              weekId: d.sourceWeekId,
              targetWeekId: d.targetWeekId, // 다른 주로 담아 둔 초안 (없으면 같은 주)
              source: {
                grade: d.source.grade,
                classNum: d.source.classNum,
                day: d.source.day,
                period: d.source.period,
              },
              simulMoveTarget: {
                day: d.candidate.targetDay,
                period: d.candidate.targetPeriod,
              },
              reason: batchReason,
              consent: { confirmed: true, note: consentNoteInput || undefined },
            }),
          });
          const simData = await simRes.json();
          if (simRes.ok && simData.success) {
            okCount++;
            try {
              await fetch("/api/timetable/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "draft_delete", draftId: d.id }),
              });
            } catch {}
          } else {
            failCount++;
            newErrors[d.id] = simData.error || "신청 거부";
          }
        } catch (e: any) {
          failCount++;
          newErrors[d.id] = e.message || "신청 오류";
        }
      }

      // 2) 일반 맞교환 초안은 create_batch로 일괄 처리
      if (swapDrafts.length > 0) {
        const res = await fetch("/api/timetable/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_batch",
            items: swapDrafts.map((d) => ({
              draftId: d.id,
              weekId: d.sourceWeekId,
              targetWeekId: d.targetWeekId,
              type: "swap",
              source: d.source,
              candidate: d.candidate,
              consent: d.candidate?.coordination
                ? { confirmed: true, note: consentNoteInput || undefined }
                : undefined,
            })),
            reason: batchReason,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          okCount += (data.createdCount || 0);
          const results: SwapBatchItemResult[] = data.results || [];
          const failResults = results.filter((r) => !r.ok);
          failCount += failResults.length;
          failResults.forEach((fr) => {
            if (fr.draftId) {
              newErrors[fr.draftId] = fr.error || "신청 거부";
            }
          });
        } else {
          failCount += swapDrafts.length;
          swapDrafts.forEach((d) => {
            newErrors[d.id] = data.error || "일괄 신청 실패";
          });
        }
      }

      setDraftErrors(newErrors);

      if (okCount > 0) {
        setSubmitResult(`🚀 ${okCount}건의 수업교환 신청이 성공적으로 일괄 접수되었습니다.`);
      }

      if (failCount > 0) {
        alert(`일괄 신청 처리 완료: ${okCount}건 성공, ${failCount}건 거부.\n거부된 항목은 초안 카드에 사유가 표시되니 확인 후 [삭제]해 주세요.`);
      }

      await Promise.all([refreshDrafts(), fetchMyProjected()]);
      setBatchConfirmingDrafts(null);
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setSubmittingBatch(false);
    }
  };

  const handleBatchSubmit = async () => {
    const itemsToSubmit = myDrafts.filter((d) => selectedDraftIds.includes(d.id));
    if (itemsToSubmit.length === 0) {
      alert("일괄 제출할 초안 항목을 선택해 주세요.");
      return;
    }
    if (batchReason.type === "기타" && !batchReason.note?.trim()) {
      alert("신청 사유(기타) 상세 내용을 입력해 주세요.");
      return;
    }

    const hasCoordination = itemsToSubmit.some((d) => !!d.candidate?.coordination);
    if (hasCoordination) {
      setBatchConfirmingDrafts(itemsToSubmit);
      setBatchConsentConfirmed(false);
      setBatchConsentNote("");
      return;
    }

    if (!confirm(`선택한 ${itemsToSubmit.length}건의 수업교환 초안을 한 번에 일괄 신청(일과계 제출)하시겠습니까?`)) {
      return;
    }

    executeCreateBatchInTab(itemsToSubmit);
  };

  const handleSubmitDraftConfirm = async () => {
    if (!confirmingDraft) return;
    const draft = confirmingDraft;
    const isCoordination = !!draft.candidate?.coordination;
    const isSimul = !!draft.candidate?.coordination?.simul;
    if (isCoordination && !draftConsentConfirmed) {
      alert("당사자 사전 양해 확인란을 체크해 주세요.");
      return;
    }

    setSubmittingDraftId(draft.id);
    setSubmitResult(null);
    try {
      const payload = isSimul
        ? {
            action: "simul_move_create",
            weekId: draft.sourceWeekId,
            targetWeekId: draft.targetWeekId, // 다른 주로 담아 둔 초안 (없으면 같은 주)
            source: draft.source,
            simulMoveTarget: {
              day: draft.candidate.targetDay,
              period: draft.candidate.targetPeriod,
            },
            reason: draftReason,
            consent: { confirmed: true, note: draftConsentNote.trim() || undefined },
          }
        : {
            action: "create",
            weekId: draft.sourceWeekId,
            targetWeekId: draft.targetWeekId,
            type: "swap",
            source: draft.source,
            candidate: draft.candidate,
            reason: draftReason,
            consent: isCoordination
              ? { confirmed: true, note: draftConsentNote.trim() || undefined }
              : undefined,
          };

      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (isSimul) {
          try {
            await fetch("/api/timetable/requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "draft_delete", draftId: draft.id }),
            });
          } catch {}
        }
        setSubmitResult(isSimul ? "🚀 동시수업 묶음 이동 신청이 성공적으로 제출되었습니다." : "🚀 수업교환 신청이 성공적으로 제출되었습니다.");
        setConfirmingDraft(null);
        await Promise.all([refreshDrafts(), fetchMyProjected()]);
      } else {
        alert(data.error || "신청에 실패했습니다.");
      }
    } catch (e: any) {
      alert(`네트워크 오류: ${e.message}`);
    } finally {
      setSubmittingDraftId(null);
    }
  };

  // 상대 교사별 초안 묶음 (융합 양해 카드 단위)
  const draftGroups = useMemo(() => {
    const m = new Map<string, { name: string; drafts: SwapDraft[] }>();
    for (const d of myDrafts) {
      const email = (d.candidate?.counterpartEmail || "").toLowerCase();
      if (!email) continue;
      const g = m.get(email) || { name: d.candidate?.counterpartName || email.split("@")[0], drafts: [] };
      g.drafts.push(d);
      m.set(email, g);
    }
    return m;
  }, [myDrafts]);

  // §13-1b: 같은 상대에게 가는 초안 전부를 한 장의 양해 이미지로 융합 복사
  const handleCopyConsolidatedShare = async (email: string) => {
    const group = draftGroups.get(email);
    if (!group || group.drafts.length === 0 || generatingShareFor) return;
    setGeneratingShareFor(email);
    try {
      const weekIds = Array.from(
        new Set(group.drafts.flatMap((d) => [d.sourceWeekId, d.targetWeekId || d.sourceWeekId]))
      );
      const cellsByWeek = new Map<string, TeacherTimetableCell[]>();
      await Promise.all(
        weekIds.map(async (wid) => {
          cellsByWeek.set(wid, await fetchTeacherWeekCells(email, wid));
        })
      );

      const weekBlocks = weekIds
        .map((wid) => {
          const weekObj = weeks.find((w) => w.id === wid);
          const markers: ConsolidatedShareData["weekBlocks"][number]["markers"] = [];
          for (const d of group.drafts) {
            const outWeek = d.targetWeekId || d.sourceWeekId;
            if (outWeek === wid && d.candidate?.targetDay != null && d.candidate?.targetPeriod != null) {
              markers.push({
                day: d.candidate.targetDay,
                period: d.candidate.targetPeriod,
                kind: "out",
                label: `${d.source.grade}-${d.source.classNum}`,
              });
            }
            if (d.sourceWeekId === wid) {
              markers.push({
                day: d.source.day,
                period: d.source.period,
                kind: "in",
                label: `${d.source.grade}-${d.source.classNum}`,
              });
            }
          }
          return {
            weekId: wid,
            startDate: weekObj?.startDate || wid,
            cells: cellsByWeek.get(wid) || [],
            markers,
          };
        })
        .filter((b) => b.markers.length > 0)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      setConsolidatedData({
        requesterName: user?.displayName || teacherProfile?.name || userEmail?.split("@")[0] || "교사",
        counterpartName: group.name,
        items: group.drafts,
        weekBlocks,
        periodsPerDay,
      });
      // 오프스크린 렌더 완료를 기다렸다가 이미지 복사 (기존 단건 카드와 동일 패턴)
      setTimeout(() => {
        copyShareImageElement(consolidatedCardRef.current).finally(() => setGeneratingShareFor(null));
      }, 150);
    } catch (e: any) {
      alert(`양해 이미지 생성 실패: ${e.message}`);
      setGeneratingShareFor(null);
    }
  };

  // §14-2 v2.1: 인라인 후보 클릭 = draft_save 실행 ➔ my_projected 갱신
  const handleSelectCandidateAndSave = async (sc: SwapCandidate, tgtWeekId: string) => {
    if (!selectedCell || savingDraft || deletingDraftId) return;
    setApplyingCandidate(sc);
    setTargetWeekId(tgtWeekId);
    setSavingDraft(true);
    try {
      const srcWeekId = selectedCell.weekId;
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_save",
          draft: {
            sourceWeekId: srcWeekId,
            targetWeekId: tgtWeekId !== srcWeekId ? tgtWeekId : undefined,
            source: {
              grade: selectedCell.grade,
              classNum: selectedCell.classNum,
              day: selectedCell.day,
              period: selectedCell.period,
              subjectName: selectedCell.subjectName,
            },
            candidate: {
              type: "swap",
              targetDay: sc.targetDay,
              targetPeriod: sc.targetPeriod,
              targetWeekId: tgtWeekId !== srcWeekId ? tgtWeekId : undefined,
              counterpartEmail: sc.counterpartEmail,
              counterpartName: sc.counterpartName,
              counterpartSubjectName: sc.counterpartSubjectName,
              score: sc.score,
              penalties: sc.penalties,
              coordination: sc.coordination, // 조율 필요 표시 보존 — 임시저장함·일괄 제출 양해 흐름의 재료
            },
            reason: reason,
            conditional: !!sc.conditional,
          },
        }),
      });
      if (res.ok) {
        await fetchMyProjected();
        setApplyingCandidate(null);
        setSelectedCell(null);
        setCandidatesAllResult(null);
        setFlash("📁 초안으로 저장되었습니다. 점선 칸에서 확인하세요.");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`초안 저장 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    } finally {
      setSavingDraft(false);
    }
  };

  const executeCreateBatchFromHeader = async (itemsToSubmit: SwapDraft[], consentNoteInput?: string) => {
    setSubmittingBatch(true);
    setSubmitResult(null);

    try {
      const simulDrafts = itemsToSubmit.filter((d) => !!d.candidate?.coordination?.simul);
      const swapDrafts = itemsToSubmit.filter((d) => !d.candidate?.coordination?.simul);

      let okCount = 0;
      let failCount = 0;

      for (const d of simulDrafts) {
        try {
          const simRes = await fetch("/api/timetable/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "simul_move_create",
              weekId: d.sourceWeekId,
              targetWeekId: d.targetWeekId, // 다른 주로 담아 둔 초안 (없으면 같은 주)
              source: {
                grade: d.source.grade,
                classNum: d.source.classNum,
                day: d.source.day,
                period: d.source.period,
              },
              simulMoveTarget: {
                day: d.candidate.targetDay,
                period: d.candidate.targetPeriod,
              },
              reason: batchReason,
              consent: { confirmed: true, note: consentNoteInput || undefined },
            }),
          });
          const simData = await simRes.json();
          if (simRes.ok && simData.success) {
            okCount++;
            try {
              await fetch("/api/timetable/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "draft_delete", draftId: d.id }),
              });
            } catch {}
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      }

      if (swapDrafts.length > 0) {
        const res = await fetch("/api/timetable/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_batch",
            items: swapDrafts.map((d) => ({
              draftId: d.id,
              weekId: d.sourceWeekId,
              targetWeekId: d.targetWeekId,
              type: "swap",
              source: d.source,
              candidate: d.candidate,
              consent: d.candidate?.coordination
                ? { confirmed: true, note: consentNoteInput || undefined }
                : undefined,
            })),
            reason: batchReason,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          okCount += (data.createdCount || 0);
          const results: SwapBatchItemResult[] = data.results || [];
          failCount += results.filter((r) => !r.ok).length;
        } else {
          failCount += swapDrafts.length;
        }
      }

      setSubmitResult(`🚀 ${okCount}건의 수업교환 신청이 성공적으로 일괄 접수되었습니다.${failCount > 0 ? ` (${failCount}건 거부됨)` : ""}`);
      await Promise.all([refreshDrafts(), fetchMyProjected()]);
      setBatchConfirmingDrafts(null);
    } catch (e: any) {
      setSubmitResult(`❌ 오류: ${e.message}`);
    } finally {
      setSubmittingBatch(false);
    }
  };

  // 상단 일괄 제출 (create_batch -> my_projected 갱신)
  const handleBatchSubmitFromHeader = async () => {
    if (batchReason.type === "기타" && !batchReason.note?.trim()) {
      alert("신청 사유(기타) 상세 내용을 입력해 주세요.");
      return;
    }

    try {
      const draftRes = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list" }),
      });
      if (!draftRes.ok) throw new Error("초안 목록을 불러올 수 없습니다.");
      const draftData = await draftRes.json();
      const activeDrafts: SwapDraft[] = draftData.drafts || [];
      if (activeDrafts.length === 0) {
        alert("일괄 신청할 임시저장 초안이 없습니다. 시간표 셀을 클릭하여 교환안을 임시저장해 주세요.");
        return;
      }

      const hasCoordination = activeDrafts.some((d) => !!d.candidate?.coordination);
      if (hasCoordination) {
        setBatchConfirmingDrafts(activeDrafts);
        setBatchConsentConfirmed(false);
        setBatchConsentNote("");
        return;
      }

      if (!confirm(`등록된 주간 전체의 임시저장 초안 ${activeDrafts.length}건을 한 번에 일괄 신청(일과계 제출)하시겠습니까?`)) {
        return;
      }

      executeCreateBatchFromHeader(activeDrafts);
    } catch (e: any) {
      setSubmitResult(`❌ 오류: ${e.message}`);
    }
  };

  const handleSingleSubmit = async () => {
    if (!applyingCandidate || !selectedCell) return;
    if (reason.type === "기타" && !reason.note?.trim()) {
      alert("\"기타\" 사유는 내용을 반드시 입력해야 합니다.");
      return;
    }
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const swapC = applyingCandidate;
      const isSimul = !!swapC.coordination?.simul;

      const requestPayload = isSimul
        ? {
            action: "simul_move_create",
            weekId: selectedCell.weekId,
            // 다른 주로 옮기는 후보는 후보 자체가 목적지 주를 들고 있다
            targetWeekId: swapC.targetWeekId || (isCrossWeek ? effectiveTargetWeekId : undefined),
            source: {
              grade: selectedCell.grade,
              classNum: selectedCell.classNum,
              day: selectedCell.day,
              period: selectedCell.period,
            },
            simulMoveTarget: {
              day: swapC.targetDay,
              period: swapC.targetPeriod,
            },
            reason,
            consent: { confirmed: consentConfirmed, note: consentNote.trim() || undefined },
          }
        : {
            action: "create",
            weekId: selectedCell.weekId,
            targetWeekId: isCrossWeek ? effectiveTargetWeekId : undefined,
            type: "swap",
            source: {
              grade: selectedCell.grade,
              classNum: selectedCell.classNum,
              day: selectedCell.day,
              period: selectedCell.period,
              subjectName: selectedCell.subjectName,
            },
            candidate: {
              targetDay: swapC.targetDay,
              targetPeriod: swapC.targetPeriod,
              counterpartEmail: swapC.counterpartEmail,
              counterpartName: swapC.counterpartName,
              counterpartSubjectName: swapC.counterpartSubjectName,
              score: swapC.score,
              penalties: swapC.penalties,
            },
            reason,
            // 조율 필요 후보는 양해 확인 필수 — 서버가 coordination 재계산으로 판정·명단 도출
            ...(swapC.coordination
              ? { consent: { confirmed: consentConfirmed, note: consentNote.trim() || undefined } }
              : {}),
          };

      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      if (res.ok) {
        setSubmitResult(
          isSimul
            ? "✅ 동시수업 묶음 이동 신청이 완료되었습니다. 일과계에서 검토 후 처리됩니다."
            : "✅ 수업교환 신청이 완료되었습니다. 일과계에서 검토 후 처리됩니다."
        );
        await fetchMyProjected();
        setApplyingCandidate(null);
        setSelectedCell(null);
        setCandidatesAllResult(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setSubmitResult(`❌ 신청 실패: ${err.error || "알 수 없는 오류"}`);
      }
    } catch (e: any) {
      setSubmitResult(`❌ 오류: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyShareImage = (data: ShareCardData) => {
    setShareCardData({ ...data, variant: "counterpart" });
    setTimeout(() => {
      copyShareImageElement(shareCardRef.current);
    }, 100);
  };

  // 후보 선택 시 상대 교사 시간표 미리보기 로드
  useEffect(() => {
    if (!applyingCandidate) {
      setPreviewCells(null);
      setCounterpartSourceCells(null);
      setCounterpartTargetCells(null);
      setPreviewError(null);
      return;
    }
    const counterpartEmail = applyingCandidate.counterpartEmail;
    if (!counterpartEmail) return;

    const fetchTeacherWeek = (wId: string) => fetchTeacherWeekCells(counterpartEmail, wId);

    setPreviewLoading(true);
    setPreviewError(null);

    if (!isCrossWeek) {
      fetchTeacherWeek(effectiveTargetWeekId)
        .then((fetched) => setPreviewCells(fetched))
        .catch((e: any) => setPreviewError(e?.message || "상대 시간표를 불러올 수 없습니다."))
        .finally(() => setPreviewLoading(false));
    } else {
      Promise.all([
        fetchTeacherWeek(selectedWeekId),
        fetchTeacherWeek(effectiveTargetWeekId),
      ])
        .then(([srcCells, tgtCells]) => {
          setCounterpartSourceCells(srcCells);
          setCounterpartTargetCells(tgtCells);
        })
        .catch((e: any) => setPreviewError(e?.message || "상대 시간표를 불러올 수 없습니다."))
        .finally(() => setPreviewLoading(false));
    }
  }, [applyingCandidate, effectiveTargetWeekId, selectedWeekId, isCrossWeek, fetchTeacherWeekCells]);

  return (
    <div className="space-y-4">
      {/* 🚀 상단 컨트롤 바 (v2.1: 전 주 일괄 제출 및 인라인 하이라이트 현황) */}
      <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-extrabold text-indigo-950 flex items-center gap-1.5">
              <span>🗓️ 등록 주간 전체 예상 시간표</span>
            </h2>

            {projectedData && (
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <span className="bg-indigo-100 text-indigo-900 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                  📁 초안 {projectedData.assumedDraftCount}건
                </span>
                <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full">
                  ⏳ 검토 중 신청 {projectedData.assumedPendingCount}건
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={batchReason.type}
              onChange={(e) => setBatchReason({ type: e.target.value as any, note: batchReason.note })}
              className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {SWAP_REASON_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <button
              onClick={handleBatchSubmitFromHeader}
              disabled={submittingBatch || (projectedData?.assumedDraftCount || 0) === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
            >
              <span>🚀</span>
              <span>{submittingBatch ? "일괄 제출 중..." : `등록 주간 초안 일괄 신청 (${projectedData?.assumedDraftCount || 0}건)`}</span>
            </button>
          </div>
        </div>

        {/* §13-1b: 상대 교사별 융합 양해 이미지 — 같은 상대에게 가는 초안 전부를 한 장으로 */}
        {draftGroups.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
            <span className="text-[11px] font-bold text-gray-500">📨 신청 전 양해 구하기 (상대별 이미지 복사):</span>
            {Array.from(draftGroups.entries()).map(([email, g]) => (
              <button
                key={email}
                onClick={() => handleCopyConsolidatedShare(email)}
                disabled={!!generatingShareFor}
                className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 disabled:opacity-50 border border-sky-200 text-sky-800 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
              >
                <span>📋</span>
                <span>
                  {generatingShareFor === email ? "이미지 생성 중…" : `${g.name} 선생님 (${g.drafts.length}건)`}
                </span>
              </button>
            ))}
          </div>
        )}

        {batchReason.type === "기타" && (
          <textarea
            value={batchReason.note || ""}
            onChange={(e) => setBatchReason({ ...batchReason, note: e.target.value })}
            placeholder="일괄 신청 사유(기타)를 입력해 주세요 (필수)"
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        )}

        <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100 font-medium">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-emerald-100 border border-emerald-300 inline-block" />
            <b className="text-emerald-950">초록 배지</b>: 상대 감점 0점
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300 inline-block" />
            <b className="text-amber-950">주황 배지</b>: 상대 감점 1~2점
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-rose-100 border border-rose-300 inline-block" />
            <b className="text-rose-950">빨간 배지</b>: 상대 감점 3+점
          </span>
          <span className="flex items-center gap-1 border-l pl-2 border-gray-200">
            <span className="w-2.5 h-2.5 rounded bg-red-50 border-2 border-red-500 inline-block" />
            <b className="text-red-950">빨간 테두리</b>: ⚠️ 양해 필수
          </span>
          <span className="flex items-center gap-1 border-l pl-2 border-gray-200">
            <span className="w-2.5 h-2.5 rounded bg-purple-100 border border-purple-300 inline-block" />
            <b className="text-purple-950">보라 배경</b>: 🔗 체인 경로
          </span>
          <span className="flex items-center gap-1 border-l pl-2 border-gray-200">
            <span className="w-2.5 h-2.5 rounded bg-indigo-50 border border-dashed border-indigo-400 inline-block" />
            <b className="text-indigo-900">점선 파란 배경</b>: 클릭 반영 초안
          </span>
          <span className="flex items-center gap-1 border-l pl-2 border-gray-200">
            <span className="w-2.5 h-2.5 rounded bg-sky-100 border border-sky-300 inline-block" />
            <b className="text-sky-950">하늘색 배경 ▲</b>: 확정 변경 교체
          </span>
        </div>
      </div>

      {submitResult && (
        <div className={`rounded-xl p-4 text-sm font-semibold border ${
          submitResult.startsWith("🚀") || submitResult.startsWith("✅")
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {submitResult}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 text-center">{error}</div>
      )}

      {/* 진행 중 고정 배너 — 클릭이 반영되는 동안 화면 어디서든 보이도록 */}
      {(savingDraft || deletingDraftId || candidatesLoading) && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-indigo-950 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-xl animate-pulse">
          {savingDraft
            ? "⏳ 초안 저장 반영 중… 잠시만 기다려 주세요"
            : deletingDraftId
              ? "⏳ 초안 삭제 중… 잠시만 기다려 주세요"
              : "🔍 전 주 맞교환 후보 계산 중…"}
        </div>
      )}

      {/* 완료 토스트 (3.5초 후 자동 숨김) */}
      {flash && !savingDraft && !deletingDraftId && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white text-sm font-bold px-5 py-2.5 rounded-full shadow-xl">
          {flash}
        </div>
      )}


      <div className="flex gap-4 items-start">
        {/* 주간 시간표 그리드 (등록된 주간 전체 세로 일렬 나열 — §14-2 v2.1 인라인 하이라이트) */}
        <div className="flex-1 space-y-6">
          {loading && !projectedData && (
            <div className="bg-white rounded-xl p-12 text-center text-xs font-semibold text-indigo-500 border border-gray-200 shadow-sm animate-pulse">
              예상 시간표를 불러오는 중...
            </div>
          )}

          {projectedData?.weeks.map((week) => {
            // §14-2 v2.1: 현재 주간에 해당하는 candidates_all 맞교환 후보 목록 조회
            const weekCandidates = candidatesAllResult?.weeks.find((w) => w.weekId === week.weekId)?.swapCandidates || [];

            return (
              <div key={week.weekId} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-950 to-indigo-800 px-5 py-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>🗓️ {week.startDate} 주간시간표 ({week.weekId})</span>
                      {selectedCell?.weekId === week.weekId && (
                        <span className="text-[10px] bg-amber-300 text-amber-950 px-2 py-0.5 rounded font-black">
                          선택한 소스 수업 주
                        </span>
                      )}
                    </h3>
                  </div>
                </div>

                <table className="w-full table-fixed border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2.5 px-1 border-r border-gray-200 w-14 text-center text-gray-500 font-bold text-xs">교시</th>
                      {DAYS.map((d) => {
                        const dateLabel = getDayDateLabel(week.startDate, d.num);
                        return (
                          <th key={d.num} className="py-2 px-1 text-center text-gray-800 font-bold text-sm w-1/5">
                            <div>{d.label}</div>
                            {dateLabel && <div className="text-xs text-gray-500 font-normal mt-0.5">{dateLabel}</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, idx) => {
                      const period = idx + 1;
                      return (
                        <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                          <td className="py-2 px-1 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50 text-xs align-middle w-14">{period}</td>
                          {DAYS.map((d) => {
                            const dayMaxPeriods = week.dayPeriodCounts?.find((dp) => dp.day === d.num)?.periods ?? periodsPerDay;
                            const isOutPeriod = period > dayMaxPeriods;

                            const matched = week.cells.filter((c) => c.day === d.num && c.period === period);
                            const hasLesson = matched.length > 0;
                            const isSelected = selectedCell?.weekId === week.weekId && selectedCell?.day === d.num && selectedCell?.period === period;

                            // §3-2d U4: 공통 활동 교시(SLAT·창체 등) 판정 — 체인 목적지 지정 대상에서 제외
                            const isCommonActivitySlot = week.commonActivitySlots?.some(
                              (s) => s.day === d.num && s.period === period
                            );

                            // §14-2 v2.1: 내 공강 칸(!hasLesson)이고 소스 셀이 선택되었을 때 인라인 맞교환 후보 매칭 (미편성 교시는 제외)
                            const candidate = !hasLesson && !isOutPeriod && selectedCell
                              ? weekCandidates.find((c) => c.targetDay === d.num && c.targetPeriod === period)
                              : null;

                            const isChainTargetSlot = !hasLesson && !isOutPeriod && selectedCell && chainTarget?.weekId === week.weekId && chainTarget?.day === d.num && chainTarget?.period === period;

                            return (
                              <td
                                key={d.num}
                                className={`p-1 border-r border-gray-100 text-center align-middle h-16 transition-all ${
                                  isOutPeriod ? "bg-gray-100/50" : isSelected ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50" : ""
                                } ${hasLesson && !isSelected ? "hover:bg-indigo-50/60 cursor-pointer" : ""} ${
                                  !hasLesson && !isOutPeriod && selectedCell && isChainMode && !isCommonActivitySlot ? "hover:bg-purple-100/90 cursor-pointer border-2 border-dashed border-purple-400 bg-purple-50/40" : ""
                                } ${isChainTargetSlot ? "ring-2 ring-purple-600 bg-purple-100" : ""}`}
                                onClick={() => {
                                  if (isOutPeriod) return;
                                  if (hasLesson) {
                                    handleCellClick(matched[0], week.weekId);
                                  } else if (selectedCell && isChainMode) {
                                    if (isCommonActivitySlot) {
                                      alert("학교 공통 활동 시간(SLAT·동아리 등)은 체인 목적지로 지정할 수 없습니다.");
                                      return;
                                    }
                                    handleExecuteChainSearch(week.weekId, d.num, period);
                                  }
                                }}
                              >
                                {isOutPeriod ? (
                                  <div className="text-gray-300 text-xs font-semibold font-mono text-center select-none">-</div>
                                ) : hasLesson ? (
                                  matched.map((cell, ci) => {
                                    const changed = (cell as any).changed;
                                    const changeId: string = changed?.changeId || "";
                                    const isVirtualDraft = changeId.startsWith("virtual-draft-");
                                    const isVirtualReq = changeId.startsWith("virtual-req-");
                                    const isApprovedChange = !!changed && !isVirtualDraft && !isVirtualReq;

                                    // 교차 주 초안은 서버 가상 문서가 방향별 "-a"/"-b" 접미어를 붙이므로 함께 제거해야 실제 초안 문서 ID가 된다 (Firestore 자동 ID에는 하이픈이 없음)
                                    const draftId = isVirtualDraft ? changeId.replace("virtual-draft-", "").replace(/-(a|b)$/, "") : "";

                                    let cellStyle = "bg-white border border-indigo-200 shadow-2xs";
                                    if (isVirtualDraft) cellStyle = "bg-indigo-50/90 border-2 border-dashed border-indigo-400 text-indigo-950 shadow-xs";
                                    else if (isVirtualReq) cellStyle = "bg-amber-50/90 border-2 border-amber-300 text-amber-950 shadow-xs";
                                    else if (isApprovedChange) cellStyle = "bg-sky-100 border border-sky-300 text-sky-950 shadow-xs";

                                    return (
                                      <div key={ci} className={`p-1.5 rounded-lg text-center space-y-0.5 ${cellStyle}`}>
                                        <div className="font-black text-sm flex items-center justify-center gap-1">
                                          <span>{cell.grade}-{cell.classNum}반</span>
                                          {isApprovedChange && <span className="text-sky-600 font-bold text-xs">▲</span>}
                                        </div>

                                        <div className="text-[11px] text-gray-600 font-medium">{cell.subjectName}</div>

                                        {isVirtualDraft && (
                                          <div className="flex items-center justify-between gap-1 pt-0.5">
                                            <span className="text-[10px] font-extrabold text-indigo-900 bg-indigo-200 px-1 py-0.5 rounded">
                                              📁 초안
                                            </span>
                                            {deletingDraftId === draftId ? (
                                              <span className="text-[10px] font-bold text-gray-500 animate-pulse px-1 py-0.5">
                                                ⏳ 삭제 중…
                                              </span>
                                            ) : (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDeleteDraftById(draftId);
                                                }}
                                                disabled={!!deletingDraftId || savingDraft}
                                                className="text-[10px] font-bold text-red-600 hover:text-red-800 bg-white px-1 py-0.5 rounded border border-red-200 disabled:opacity-40"
                                              >
                                                취소
                                              </button>
                                            )}
                                          </div>
                                        )}

                                        {isVirtualReq && (
                                          <div className={`text-[10px] font-extrabold px-1 py-0.5 rounded mt-0.5 ${
                                            myPendingSimulMoves.some((req) => req.weekId === week.weekId && req.source.day === d.num && req.source.period === period)
                                              ? "bg-purple-200 text-purple-900"
                                              : "bg-amber-200 text-amber-900"
                                          }`}>
                                            {myPendingSimulMoves.some((req) => req.weekId === week.weekId && req.source.day === d.num && req.source.period === period)
                                              ? "⏳ 묶음 이동 대기"
                                              : "⏳ 검토 대기"}
                                          </div>
                                        )}

                                        {!isVirtualReq && !isVirtualDraft && myPendingSimulMoves.some((req) => req.weekId === week.weekId && req.source.day === d.num && req.source.period === period) && (
                                          <div className="text-[10px] font-extrabold bg-purple-200 text-purple-900 px-1 py-0.5 rounded mt-0.5" title="대기 중인 묶음 이동 신청 있음">
                                            ⏳ 묶음 이동 대기
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : candidate ? (
                                  /* §14-2 v2.1: 공강 칸 인라인 후보 카딩 (클릭 = draft_save 실행) */
                                  (() => {
                                    const isCoordination = !!candidate.coordination;
                                    const coordText = isCoordination ? formatCoordinationText(candidate.coordination) : "";
                                    const cpScore = candidate.counterpartScore ?? 0;
                                    const counterpartPenalties = (candidate.penaltyDetails || []).filter((p) => p.scope === "counterpart");
                                    const tooltipText = isCoordination
                                      ? `⚠️ [양해 필요 후보] ${coordText}`
                                      : `[${candidate.counterpartSubjectName}] ${candidate.counterpartName} 교사 · 상대 감점 ${cpScore}점${
                                          counterpartPenalties.length > 0 ? ` (${counterpartPenalties.map((p) => p.text).join(", ")})` : ""
                                        }${candidate.conditional ? " · ⏳ 조건부 — 내 대기 신청 승인 전제" : ""}`;

                                    let badgeStyle = "bg-emerald-100 border-emerald-300 text-emerald-950";
                                    if (cpScore >= 3) badgeStyle = "bg-rose-100 border-rose-300 text-rose-950";
                                    else if (cpScore >= 1) badgeStyle = "bg-amber-100 border-amber-300 text-amber-950";
                                    // §3-2b ①: 조율 필요 후보는 감점 색보다 명확히 강한 경고 스타일(빨간 계열·굵은 테두리, "⚠️ 양해 필수")
                                    if (isCoordination) badgeStyle = "bg-red-50 border-2 border-red-500 text-red-950 font-bold shadow-xs";

                                    const isSavingThis = savingDraft && applyingCandidate === candidate;

                                    const isSelectedCandidate = applyingCandidate === candidate || (applyingCandidate?.counterpartEmail === candidate.counterpartEmail && applyingCandidate?.targetDay === candidate.targetDay && applyingCandidate?.targetPeriod === candidate.targetPeriod);

                                    return (
                                      <div
                                        title={tooltipText}
                                        onClick={(e) => {
                                          // 셀(td) onClick으로 버블링되면 체인 모드 중 후보 선택과 chain_search가 동시 발화한다 (U6 상호 배타 위반)
                                          e.stopPropagation();
                                          setIsChainMode(false);
                                          setChainTarget(null);
                                          setChainSearchResults(null);
                                          setChainSearchError(null);
                                          setChainSearchReason(null);
                                          if (isCoordination) {
                                            setPendingCoordinationSave({ candidate, weekId: week.weekId });
                                          } else {
                                            setApplyingCandidate(candidate);
                                            setTargetWeekId(week.weekId);
                                          }
                                        }}
                                        className={`p-1.5 rounded-lg border text-center transition-all shadow-2xs ${badgeStyle} ${
                                          isSelectedCandidate
                                            ? "ring-2 ring-indigo-600 bg-indigo-100 font-extrabold shadow-md scale-102"
                                            : isSavingThis
                                              ? "animate-pulse ring-2 ring-indigo-500"
                                              : savingDraft
                                                ? "opacity-40 pointer-events-none"
                                                : "cursor-pointer hover:scale-102"
                                        }`}
                                      >
                                        {isSavingThis ? (
                                          <div className="font-extrabold text-xs">⏳ 반영 중…</div>
                                        ) : (
                                          <>
                                            <div className="font-extrabold text-xs truncate" title={candidate.counterpartName}>
                                              {isCoordination ? "⚠️ " : ""}{candidate.conditional ? "⏳ " : ""}{formatCandidateSlotLabel(candidate)}
                                            </div>
                                            <div className="text-[10px] font-black mt-0.5">
                                              {isCoordination ? (
                                                <span className="bg-red-200 text-red-950 px-1 py-0.2 rounded border border-red-400 font-black">⚠️ 양해 필수</span>
                                              ) : cpScore === 0 ? (
                                                <span className="underline">✓ 0점</span>
                                              ) : (
                                                <span className="underline">{`⚠ ${cpScore}점`}</span>
                                              )}
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <span className="text-xs text-gray-300 block py-1">-</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* 우측 사이드바: 선택 정보 & 상대 교사 시간표 미리보기만 유지 (§14-2 v2.1) */}
        {selectedCell && (
          <div className="w-80 shrink-0 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-4">
            <div className="bg-gradient-to-r from-indigo-900 to-indigo-700 px-4 py-3">
              <div className="text-xs font-bold text-white">
                수업교환 소스 — {formatSlotWithDate(selectedCell.weekId, selectedCell.day, selectedCell.period)}
              </div>
              <div className="text-[11px] text-indigo-300 mt-0.5">
                {selectedCell.subjectName} · {selectedCell.grade}-{selectedCell.classNum}반 ({selectedCell.weekId} 주)
              </div>
            </div>

            <div className="p-4 space-y-4">
              {candidatesLoading && (
                <div className="text-center py-4 text-xs text-indigo-500 animate-pulse font-semibold">전 주 맞교환 후보 계산 중...</div>
              )}
              {candidatesError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{candidatesError}</div>
              )}

              {!candidatesLoading && !applyingCandidate && (
                <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-900 space-y-1">
                  <p className="font-bold">💡 후보 선택 안내</p>
                  <p className="text-[11px] text-indigo-800 leading-relaxed">
                    좌측 시간표 그리드의 <b>공강 칸(초록/주황/빨간 배지)</b>을 클릭하여 교환 후보를 선택하세요. 우측 사이드바에서 상세 사유와 시간표를 확인한 뒤 <b>[🛒 담기]</b> 또는 <b>[⚡ 단건 즉시 신청]</b>을 진행합니다.
                  </p>
                </div>
              )}

              {/* 🔗 §4-2 교사 징검다리 체인 탐색 UI */}
              {!candidatesLoading && !applyingCandidate && (
                <div className="bg-purple-50/80 border border-purple-200 rounded-xl p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-extrabold text-purple-950 flex items-center gap-1.5 text-xs">
                      <span>🔗</span>
                      <span>원하는 자리로 보내기 (체인 탐색)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (isChainMode) {
                          setIsChainMode(false);
                          setChainSearchResults(null);
                          setChainSearchError(null);
                          setChainSearchReason(null);
                          setChainTarget(null);
                        } else {
                          setIsChainMode(true);
                          setApplyingCandidate(null);
                          setChainSearchResults(null);
                          setChainSearchError(null);
                          setChainSearchReason(null);
                          setChainTarget(null);
                        }
                      }}
                      className={`px-2.5 py-1 text-[11px] font-extrabold rounded-lg cursor-pointer transition-all ${
                        isChainMode
                          ? "bg-purple-700 text-white shadow-2xs"
                          : "bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300"
                      }`}
                    >
                      {isChainMode ? "탐색 해제" : "체인 탐색 모드"}
                    </button>
                  </div>

                  <details className="text-[11px] text-purple-900 cursor-pointer">
                    <summary className="font-bold text-purple-950 hover:underline">
                      💡 여러 선생님의 양해가 필요한 방법입니다
                    </summary>
                    <p className="mt-1 leading-relaxed bg-white/80 p-2 rounded-lg border border-purple-200 text-purple-950 text-[10px]">
                      1단계 직접 맞교환 후보가 없더라도 2~3단계 징검다리 경로(연속 수업 교환)를 통해 이 수업을 내 원하는 공강 교시로 보낼 수 있습니다.
                    </p>
                  </details>

                  {isChainMode && (
                    <div className="p-2.5 bg-purple-100/90 border border-purple-300 rounded-lg text-purple-950 font-bold text-[11px] text-center animate-pulse">
                      🎯 왼쪽 시간표 그리드에서 이 수업을 보내고 싶은 <span className="underline text-purple-900 font-extrabold">내 공강 교시</span>를 클릭하세요.
                    </div>
                  )}

                  {chainSearching && (
                    <div className="p-3 bg-white border border-purple-300 rounded-xl text-center space-y-1 animate-pulse">
                      <div className="text-xs font-extrabold text-purple-950">🔗 징검다리 체인 경로 탐색 중...</div>
                      <div className="text-[10px] text-purple-800">
                        목적지: {chainTarget ? formatSlotWithDate(chainTarget.weekId || selectedCell.weekId, chainTarget.day, chainTarget.period) : ""}
                      </div>
                    </div>
                  )}

                  {chainSearchError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 space-y-1">
                      <div className="font-bold">⚠️ 체인 탐색 오류</div>
                      <div className="text-[11px]">{chainSearchError}</div>
                    </div>
                  )}

                  {!chainSearching && chainSearchReason && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 space-y-1">
                      <div className="font-bold">💡 경로 탐색 실패 사유</div>
                      <div className="text-[11px] text-amber-900 leading-relaxed">{chainSearchReason}</div>
                    </div>
                  )}

                  {!chainSearching && chainSearchResults && chainSearchResults.length > 0 && (
                    <div className="space-y-2.5 pt-1 border-t border-purple-200">
                      <div className="text-xs font-extrabold text-purple-950 flex items-center justify-between">
                        <span>발견된 체인 경로 ({chainSearchResults.length}건)</span>
                        <span className="text-[10px] bg-purple-200 text-purple-900 px-1.5 py-0.5 rounded font-bold">
                          {chainTarget ? `${chainTarget.day}요일 ${chainTarget.period}교시` : ""}
                        </span>
                      </div>

                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {chainSearchResults.map((chain, cIdx) => {
                          const currentTeacherName = user?.displayName || teacherProfile?.name || "";
                          const uniqueTeachers = Array.from(
                            new Set(
                              chain.steps
                                .flatMap((s) => [s.sourceTeacherName, s.candidate.counterpartName])
                                .filter((n) => n && n !== currentTeacherName)
                            )
                          );

                          return (
                            <div key={cIdx} className="bg-white border border-purple-300 rounded-xl p-3 space-y-2 text-xs shadow-2xs hover:border-purple-500 transition-all">
                              <div className="flex items-center justify-between font-extrabold text-purple-950">
                                <span className="flex items-center gap-1">
                                  <span>🔗</span>
                                  <span>{chain.steps.length}단계 체인 경로</span>
                                </span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${chain.totalScore > 0 ? "bg-amber-100 text-amber-900 border border-amber-300" : "bg-purple-100 text-purple-900 font-extrabold border border-purple-200"}`}>
                                  {chain.totalScore > 0 ? `총 감점 ${chain.totalScore}점` : "0점 (시간표 감점 없음)"}
                                </span>
                              </div>

                              <div className="text-[11px] text-gray-700 font-medium">
                                👥 <strong>거치는 교사:</strong> <span className="font-extrabold text-indigo-900">{uniqueTeachers.join(", ")}</span>
                              </div>

                              <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-2 font-mono text-[10px] text-purple-950 space-y-1">
                                {chain.steps.map((step, sIdx) => (
                                  <div key={sIdx} className="leading-tight">
                                    Step {sIdx + 1}: {step.stepSummary || `${step.sourceTeacherName} → ${step.candidate?.counterpartName} (${step.candidate?.targetDay}요일 ${step.candidate?.targetPeriod}교시)`}
                                  </div>
                                ))}
                              </div>

                              <button
                                type="button"
                                onClick={() => handleOpenChainConsentModal(chain)}
                                className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1"
                              >
                                <span>🤝</span>
                                <span>이 체인 경로 선택 (양해 확인)</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 상대 교사 시간표 미리보기 미니 그리드 및 후보 상세/사이드바 액션 */}
              {applyingCandidate && (
                <div className="space-y-3">
                  {/* §3-2c ① / §3-2d U5: 선택된 후보 정보 요약 & 상대 교사 감점 사유 목록 (scope==="counterpart"만 표출) */}
                  {(() => {
                    const counterpartPenalties = (applyingCandidate.penaltyDetails || []).filter((pd) => pd.scope === "counterpart");
                    const cpScore = applyingCandidate.counterpartScore ?? applyingCandidate.score ?? 0;
                    const isCoord = !!applyingCandidate.coordination;

                    return (
                      <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 space-y-2 text-xs text-amber-950">
                        <div className="font-extrabold flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <span>📊</span>
                            <span>{applyingCandidate.counterpartName} 교사 교환안</span>
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-black ${
                            cpScore === 0
                              ? (isCoord ? "bg-red-100 text-red-950 border border-red-300" : "bg-emerald-100 text-emerald-900 border border-emerald-300")
                              : "bg-amber-100 text-amber-950 border border-amber-300"
                          }`}>
                            {cpScore === 0
                              ? (isCoord ? "시간표 감점 없음 · 특별실 겹침 조율 필요" : "✓ 0점 (시간표 감점 없음)")
                              : `총 감점 ${cpScore}점`}
                          </span>
                        </div>

                        {counterpartPenalties.length > 0 ? (
                          <div className="space-y-1 pt-1.5 border-t border-amber-200">
                            <div className="text-[11px] font-bold text-amber-950">상대 교사 감점 사유:</div>
                            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900 font-medium">
                              {counterpartPenalties.map((pd, pIdx) => (
                                <li key={pIdx}>{pd.text} ({pd.points}점)</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-800 font-bold pt-0.5">
                            {isCoord
                              ? "시간표 감점은 없으나, 특별실 겹침에 대한 양해가 필요합니다."
                              : "시간표 감점 사유가 없는 맞교환 경로입니다."}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {applyingCandidate.coordination && (
                    <div className="space-y-2">
                      <CoordinationNoticeBlock coordination={applyingCandidate.coordination} />
                      <div className="bg-red-50/60 border border-red-200 rounded-xl p-3 space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer bg-white p-2 rounded-lg border border-red-300 shadow-2xs">
                          <input
                            type="checkbox"
                            checked={consentConfirmed}
                            onChange={(e) => setConsentConfirmed(e.target.checked)}
                            className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                          />
                          <span className="text-xs font-bold text-gray-900">
                            위 선생님들께 사전 양해를 완료하였습니다 (필수)
                          </span>
                        </label>
                        <input
                          type="text"
                          maxLength={200}
                          value={consentNote}
                          onChange={(e) => setConsentNote(e.target.value)}
                          placeholder="양해 메모 (선택, 예: 시간표 조정 사전 합의)"
                          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                        />
                      </div>
                    </div>
                  )}

                  <div className="text-xs font-bold text-gray-800 flex items-center justify-between">
                    <span>
                      🔍 {applyingCandidate.counterpartName} 교사 시간표 미리보기
                    </span>
                    {previewLoading && <span className="text-[10px] text-indigo-500 animate-pulse font-semibold">조회 중...</span>}
                  </div>

                  {previewError && <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded">{previewError}</div>}

                  <MiniPreviewGrid
                    isCrossWeek={isCrossWeek}
                    sourceWeekId={selectedCell.weekId}
                    targetWeekId={effectiveTargetWeekId}
                    sourceWeekObj={sourceWeekObj}
                    targetWeekObj={targetWeekObj}
                    selectedCell={selectedCell}
                    applyingCandidate={applyingCandidate}
                    periodsPerDay={periodsPerDay}
                    previewCells={previewCells}
                    counterpartSourceCells={counterpartSourceCells}
                    counterpartTargetCells={counterpartTargetCells}
                    counterpartTitle={`${applyingCandidate.counterpartName || "상대"} 선생님`}
                  />

                  {/* 사유 선택 */}
                  <div className="pt-1 space-y-1.5">
                    <div className="text-[11px] font-bold text-gray-600">신청 사유</div>
                    <select
                      value={reason.type}
                      onChange={(e) => setReason({ type: e.target.value as any, note: reason.note })}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      {SWAP_REASON_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* §3-2c ②: 사이드바 액션 버튼 2개 ([🛒 담기] = draft_save 양해체크 불요 / [⚡ 단건 즉시 신청] = create 양해체크 필수) */}
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (applyingCandidate && selectedCell) {
                            handleSelectCandidateAndSave(applyingCandidate, targetWeekId || selectedCell.weekId);
                          }
                        }}
                        disabled={savingDraft || submitting}
                        className="py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition-colors shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>🛒</span>
                        <span>{savingDraft ? "담는 중..." : "담기 (임시저장)"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSingleSubmit}
                        disabled={
                          submitting ||
                          savingDraft ||
                          (reason.type === "기타" && !reason.note?.trim()) ||
                          (!!applyingCandidate.coordination && !consentConfirmed)
                        }
                        className="py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-xl text-xs transition-colors shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>⚡</span>
                        <span>{submitting ? "신청 중..." : "단건 즉시 신청"}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedCell || !applyingCandidate) return;
                        const currentUserName = user?.displayName || teacherProfile?.name || userEmail?.split("@")[0] || "교사";
                        handleCopyShareImage({
                          variant: "counterpart",
                          requesterName: currentUserName,
                          sourceWeekId: selectedCell.weekId,
                          targetWeekId: isCrossWeek ? effectiveTargetWeekId : undefined,
                          source: {
                            grade: selectedCell.grade,
                            classNum: selectedCell.classNum,
                            day: selectedCell.day,
                            period: selectedCell.period,
                            subjectName: selectedCell.subjectName,
                          },
                          candidate: {
                            targetDay: applyingCandidate.targetDay,
                            targetPeriod: applyingCandidate.targetPeriod,
                            counterpartEmail: applyingCandidate.counterpartEmail,
                            counterpartName: applyingCandidate.counterpartName,
                            counterpartSubjectName: applyingCandidate.counterpartSubjectName,
                            coordination: applyingCandidate.coordination,
                          },
                          previewCells,
                          counterpartSourceCells,
                          counterpartTargetCells,
                          sourceWeekObj,
                          targetWeekObj,
                          periodsPerDay,
                        });
                      }}
                      disabled={
                        previewLoading ||
                        (isCrossWeek ? !counterpartSourceCells || !counterpartTargetCells : !previewCells)
                      }
                      className="w-full py-2 bg-sky-50 hover:bg-sky-100 border border-sky-200 disabled:opacity-50 text-sky-800 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span>📋</span>
                      <span>{previewLoading ? "시간표 로딩 중…" : "사전 양해 카드 이미지 복사"}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setApplyingCandidate(null);
                      setSelectedCell(null);
                      setPreviewCells(null);
                    }}
                    className="w-full py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                  >
                    닫기
                  </button>
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      {/* 오프스크린 사전 양해 공유 카드 DOM (클립보드 복사용) */}
      <OffscreenShareCard cardRef={shareCardRef} data={shareCardData} />
      <OffscreenConsolidatedShareCard cardRef={consolidatedCardRef} data={consolidatedData} />

      {/* 🚀 상단 일괄 제출 사전 양해 확인 모달 (반려 4건 반영) */}
      {batchConfirmingDrafts && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="border-b border-gray-100 pb-3 flex items-center justify-between shrink-0">
              <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                <span>🤝 일괄 신청 사전 양해 확인</span>
              </h4>
              <button
                onClick={() => setBatchConfirmingDrafts(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 pr-1 shrink">
              <div className="text-xs font-semibold text-gray-700">
                신청 대상 초안 <strong>{batchConfirmingDrafts.length}건</strong> 중 사전 장소 양해가 필요한 교환 건이 포함되어 있습니다.
              </div>

              {batchConfirmingDrafts
                .filter((d) => !!d.candidate?.coordination)
                .map((d, i) => (
                  <div key={d.id || i} className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-1.5 text-xs">
                    <div className="font-extrabold text-amber-950 flex items-center justify-between">
                      <span>🔄 {d.source.subjectName}({d.source.grade}-{d.source.classNum}) ↔ {d.candidate.counterpartName} 선생님</span>
                      <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold">장소 조율</span>
                    </div>
                    <div className="text-amber-900 text-xs font-semibold">
                      {formatCoordinationText(d.candidate.coordination)}
                    </div>
                    <div className="text-[11px] text-gray-800 font-bold">
                      👥 양해 당사자:{" "}
                      <span className="text-indigo-900">
                        {getCoordinationOccupants(d.candidate.coordination)
                          .map((o) => `${o.teacherName} 선생님(${o.grade}-${o.classNum} ${o.subjectName})`)
                          .join(", ")}
                      </span>
                    </div>
                  </div>
                ))}

              <div className="pt-2 border-t border-gray-100 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer bg-amber-50 p-2.5 rounded-lg border border-amber-300 shadow-2xs">
                  <input
                    type="checkbox"
                    checked={batchConsentConfirmed}
                    onChange={(e) => setBatchConsentConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-bold text-gray-900">
                    위 조율 건에 대해 해당 선생님들께 사전 양해를 완료하였습니다 (필수)
                  </span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={batchConsentNote}
                  onChange={(e) => setBatchConsentNote(e.target.value)}
                  placeholder="일괄 양해 메모 (선택, 예: 특별실 사용 양해 완료)"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 shrink-0">
              <button
                onClick={() => setBatchConfirmingDrafts(null)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={() => executeCreateBatchFromHeader(batchConfirmingDrafts, batchConsentNote.trim())}
                disabled={submittingBatch || !batchConsentConfirmed}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                {submittingBatch ? "일괄 제출 중..." : `양해 확인 및 ${batchConfirmingDrafts.length}건 일괄 신청`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* §3-2b ②: 조율 필요 후보 인라인 클릭 시 2단 경고 다이얼로그 */}
      {pendingCoordinationSave && pendingCoordinationSave.candidate.coordination && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-lg w-full p-6 space-y-4 animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 text-red-600 font-extrabold text-base border-b border-red-100 pb-3">
              <span className="text-xl">⚠️</span>
              <span>
                {pendingCoordinationSave.candidate.coordination.simul
                  ? "당사자 양해 필요 (동시수업 묶음 이동)"
                  : "당사자 양해 필요 (장소 조율)"}
              </span>
            </div>

            <CoordinationNoticeBlock coordination={pendingCoordinationSave.candidate.coordination} />

            <p className="text-xs font-bold text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              💡 이 교환은 당사자 양해 없이는 반영할 수 없습니다. 그래도 검토하시겠습니까?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingCoordinationSave(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const { candidate, weekId } = pendingCoordinationSave;
                  setPendingCoordinationSave(null);
                  setApplyingCandidate(candidate);
                  setTargetWeekId(weekId);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-xl shadow-sm cursor-pointer"
              >
                양해 전제로 검토
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔗 §4-3: 교사 징검다리 체인 신청 전 당사자 양해 확인 모달 */}
      {chainConsentModalOpen && selectedChainForSubmit && selectedCell && chainTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-purple-200 max-w-lg w-full p-6 space-y-4 max-h-[90vh] flex flex-col animate-scale-up">
            <div className="border-b border-purple-100 pb-3 flex items-center justify-between shrink-0">
              <h4 className="text-base font-extrabold text-purple-950 flex items-center gap-2">
                <span>🔗</span>
                <span>징검다리 체인 교체 신청전 사전 양해 확인</span>
              </h4>
              <button
                type="button"
                onClick={() => setChainConsentModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-3.5 pr-1 shrink">
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3.5 space-y-2 text-xs text-purple-950">
                <div className="font-bold flex items-center justify-between">
                  <span>📌 신청 원 수업: {selectedCell.grade}-{selectedCell.classNum}반 {selectedCell.subjectName}</span>
                  <span>({formatSlotWithDate(selectedCell.weekId, selectedCell.day, selectedCell.period)})</span>
                </div>
                <div className="font-bold flex items-center justify-between border-t border-purple-200 pt-1 text-purple-900">
                  <span>🎯 목적지 교시: {formatSlotWithDate(chainTarget.weekId || selectedCell.weekId, chainTarget.day, chainTarget.period)}</span>
                  <span className="bg-purple-200 text-purple-950 px-2 py-0.5 rounded font-extrabold">{selectedChainForSubmit.steps.length}단계 체인</span>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="font-bold text-gray-800">📋 체인 단계 상세:</div>
                <div className="font-mono text-[11px] text-gray-700 space-y-1">
                  {selectedChainForSubmit.steps.map((step, idx) => (
                    <div key={idx} className="bg-white p-1.5 rounded border border-gray-200">
                      Step {idx + 1}: {step.stepSummary || `${step.sourceTeacherName} → ${step.candidate?.counterpartName} (${step.candidate?.targetDay}요일 ${step.candidate?.targetPeriod}교시)`}
                    </div>
                  ))}
                </div>
              </div>

              {/* 양해 당사자 목록 */}
              {(() => {
                const currentTeacherName = user?.displayName || teacherProfile?.name || "";
                const partyMap = new Map<string, string>();
                for (const s of selectedChainForSubmit.steps) {
                  const srcEmail = s.sourceTeacherEmail.trim().toLowerCase();
                  if (s.sourceTeacherName && s.sourceTeacherName !== currentTeacherName && !partyMap.has(srcEmail)) {
                    partyMap.set(srcEmail, s.sourceTeacherName);
                  }
                  const cpEmail = s.candidate.counterpartEmail.trim().toLowerCase();
                  if (s.candidate.counterpartName && s.candidate.counterpartName !== currentTeacherName && !partyMap.has(cpEmail)) {
                    partyMap.set(cpEmail, s.candidate.counterpartName);
                  }
                }
                const parties = Array.from(partyMap.entries()).map(([email, name]) => ({ email, name }));

                return (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-2 text-xs text-red-950">
                    <div className="font-bold flex items-center justify-between">
                      <span>👥 사전 양해 필요 당사자 선생님 ({parties.length}명)</span>
                      <span className="text-[10px] bg-red-200 text-red-950 px-2 py-0.5 rounded font-black">양해 필수</span>
                    </div>
                    <div className="font-extrabold text-red-900 text-xs">
                      {parties.map((p) => `${p.name} 선생님`).join(", ")}
                    </div>
                    <p className="text-[11px] text-red-800 leading-relaxed pt-1 border-t border-red-200">
                      💡 체인은 관련 선생님 전원의 수업이 연속 이동하므로 사전 양해 없이는 신청할 수 없습니다.
                    </p>
                  </div>
                );
              })()}

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 cursor-pointer bg-red-50/60 p-2.5 rounded-lg border border-red-200 shadow-2xs">
                  <input
                    type="checkbox"
                    checked={chainConsentConfirmed}
                    onChange={(e) => setChainConsentConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-red-950">
                    위 선생님들 전원에게 사전 양해를 받았음을 확인합니다 (필수)
                  </span>
                </label>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-700">신청 사유</label>
                  <select
                    value={chainReasonType}
                    onChange={(e) => setChainReasonType(e.target.value as any)}
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    {SWAP_REASON_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <input
                  type="text"
                  maxLength={200}
                  value={chainReasonNote}
                  onChange={(e) => setChainReasonNote(e.target.value)}
                  placeholder="상세 사유 (선택, '기타' 사유 선택 시 필수)"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />

                <input
                  type="text"
                  maxLength={200}
                  value={chainConsentNote}
                  onChange={(e) => setChainConsentNote(e.target.value)}
                  placeholder="사전 양해 메모 (선택, 예: 당사자 전원 카톡 양해 확인)"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => setChainConsentModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleExecuteChainCreate}
                disabled={submittingChain || !chainConsentConfirmed || (chainReasonType === "기타" && !chainReasonNote.trim())}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white font-extrabold text-xs rounded-xl shadow-sm disabled:opacity-50 transition-colors cursor-pointer"
              >
                {submittingChain ? "신청 제출 중..." : "양해 확인 및 체인 교체 신청 제출"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📁 사전 양해 임시저장함 (phase9b_spec §13-1, §3-2d U9: 내 시간표 탭 배치) */}
      <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3.5 space-y-3 mt-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setDraftsOpen(!draftsOpen)}
            className="flex items-center gap-2 font-bold text-sm text-indigo-950 hover:text-indigo-700 transition-colors cursor-pointer"
          >
            <span>📁 사전 양해 임시저장함</span>
            <span className="text-xs bg-indigo-200 text-indigo-900 font-extrabold px-2 py-0.5 rounded-full">
              {myDrafts.length}건
            </span>
            <span className="text-xs text-indigo-500 font-medium">{draftsOpen ? "▲ 접기" : "▼ 펼치기"}</span>
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={refreshDrafts}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
            >
              초안 새로고침
            </button>
            <button
              type="button"
              onClick={() => setDeleteAllModalOpen(true)}
              disabled={myDrafts.length === 0}
              className="text-xs text-red-600 hover:text-red-800 font-bold underline disabled:opacity-40 cursor-pointer"
            >
              🗑️ 초안 전체 비우기
            </button>
          </div>
        </div>

        {draftsOpen && (
          <div className="space-y-3 pt-1">
            {myDrafts.length === 0 && (
              <div className="text-xs text-gray-500 py-3 text-center bg-white/70 rounded-lg border border-dashed border-indigo-200">
                임시저장된 교체안 초안이 없습니다. 시간표 셀을 선택 후 [목록에 담기]할 수 있습니다.
              </div>
            )}
            {myDrafts.length > 0 && (
              <div className="bg-white border border-indigo-200 rounded-xl p-3.5 space-y-3 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={
                        myDrafts.filter((d) => !d.conditional).length > 0 &&
                        myDrafts.filter((d) => !d.conditional).every((d) => selectedDraftIds.includes(d.id))
                      }
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDraftIds(myDrafts.filter((d) => !d.conditional).map((d) => d.id));
                        else setSelectedDraftIds([]);
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-gray-800">
                      전체 선택 ({selectedDraftIds.length}/{myDrafts.length}건 선택됨)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-600">일괄 신청 사유:</span>
                    <select
                      value={batchReason.type}
                      onChange={(e) => setBatchReason({ type: e.target.value as any, note: batchReason.note })}
                      className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-2 focus:ring-indigo-500"
                    >
                      {SWAP_REASON_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {batchReason.type === "기타" && (
                  <textarea
                    value={batchReason.note || ""}
                    onChange={(e) => setBatchReason({ ...batchReason, note: e.target.value })}
                    placeholder="사유(기타)를 입력해 주세요 (필수)"
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                )}

                <button
                  type="button"
                  onClick={handleBatchSubmit}
                  disabled={submittingBatch || selectedDraftIds.length === 0}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-lg text-xs transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>🚀</span>
                  <span>{submittingBatch ? "일괄 신청 제출 중..." : `선택 항목 ${selectedDraftIds.length}건 한 번에 일괄 신청하기 (일과계 제출)`}</span>
                </button>
              </div>
            )}
            {myDrafts.map((draft) => {
              const errorMsg = draftErrors[draft.id];
              const sourceSlotStr = formatSlotWithDate(draft.sourceWeekId, draft.source.day, draft.source.period);
              const targetWeekVal = draft.targetWeekId || draft.sourceWeekId;
              const targetSlotStr = formatSlotWithDate(
                targetWeekVal,
                draft.candidate.targetDay,
                draft.candidate.targetPeriod
              );
              const isCoordination = !!draft.candidate?.coordination;

              return (
                <div
                  key={draft.id}
                  className={`bg-white border rounded-xl p-3.5 space-y-2.5 shadow-xs transition-colors ${
                    errorMsg ? "border-red-300 bg-red-50/30" : "border-indigo-150 hover:border-indigo-300"
                  }`}
                >
                  {errorMsg && !isConditionalError(errorMsg) && (
                    <div className="bg-red-100/90 border border-red-300 text-red-900 rounded-lg p-2.5 text-xs font-bold space-y-1">
                      <div className="flex items-center gap-1 text-red-700">
                        <span>⚠️ 교환 신청 불가 (시간표 상태 변경 등)</span>
                      </div>
                      <div className="text-[11px] font-medium text-red-800">{errorMsg}</div>
                      <div className="text-[10px] text-red-700 font-normal">
                        상태가 변경되었으므로 아래 <b>[이 초안 삭제]</b> 버튼을 눌러 초안을 정리해 주세요.
                      </div>
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 text-xs">
                      <div className="font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                        <input
                          type="checkbox"
                          checked={selectedDraftIds.includes(draft.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDraftIds((prev) => [...prev, draft.id]);
                            else setSelectedDraftIds((prev) => prev.filter((id) => id !== draft.id));
                          }}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
                        />
                        <span className="text-indigo-900">{draft.sourceWeekId} 주</span>
                        {draft.targetWeekId && draft.targetWeekId !== draft.sourceWeekId && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold border border-indigo-200">
                            ↔ {draft.targetWeekId} 주 교차 주
                          </span>
                        )}
                        {draft.conditional && (
                          <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 font-extrabold px-1.5 py-0.5 rounded">
                            ⏳ 조건부 — 내 대기 신청 승인 전제
                          </span>
                        )}
                        {isCoordination && (
                          <span className="text-[10px] bg-red-200 text-red-950 border border-red-400 font-black px-1.5 py-0.5 rounded">
                            ⚠️ 양해 필수
                          </span>
                        )}
                        <span className="text-gray-400 text-[10px]">
                          · {new Date(draft.updatedAt).toLocaleDateString("ko-KR")} 저장
                        </span>
                      </div>
                      <div className="text-gray-800">
                        <span className="font-semibold text-gray-500">내 수업:</span> {sourceSlotStr} ({draft.source.grade}-{draft.source.classNum}반 {draft.source.subjectName})
                      </div>
                      <div className="text-gray-800">
                        <span className="font-semibold text-gray-500">교환 희망:</span> {targetSlotStr} ({draft.candidate.counterpartName || "상대 교사"})
                      </div>
                      {draft.reason && (
                        <div className="text-gray-500 text-[11px]">
                          저장 사유: {draft.reason.type}{draft.reason.note ? ` (${draft.reason.note})` : ""}
                        </div>
                      )}
                      {draft.conditional && (
                        errorMsg && !isConditionalError(errorMsg) ? (
                          <div className="text-[11px] font-extrabold text-red-900 bg-red-50 border border-red-300 rounded px-2.5 py-1.5 mt-1 space-y-0.5">
                            <div>❌ 성립 불가 — 전제로 삼은 대기 신청이 취소·반려되었거나 시간표가 변경되었습니다.</div>
                            <div className="text-[10px] text-red-700 font-medium">더 이상 신청할 수 없는 안입니다. 이 초안을 삭제해 주세요.</div>
                          </div>
                        ) : (
                          <div className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mt-1 space-y-1">
                            <div>⏳ 내 대기 신청이 <span className="underline font-extrabold text-amber-950">승인되어야만</span> 가능한 안입니다. 그 신청을 취소하면 이 안도 함께 사라집니다.</div>
                            {errorMsg && (
                              <div className="text-[10px] text-amber-800 font-medium">아직 전제 신청이 승인되지 않아 지금은 신청할 수 없습니다. 승인된 뒤 다시 신청해 주세요.</div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  {/* 버튼들 */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingDraft(draft);
                        setDraftReason(draft.reason || { type: "출장" });
                      }}
                      disabled={submittingDraftId === draft.id}
                      className="flex-1 min-w-[120px] py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                      {submittingDraftId === draft.id ? "신청 중..." : "이 안으로 신청"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyDraftShareImage(draft)}
                      className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs border border-indigo-200 transition-colors shrink-0 cursor-pointer"
                    >
                      📋 양해 이미지 복사
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteDraft(draft.id)}
                      className={`py-1.5 px-3 font-bold rounded-lg text-xs transition-colors shrink-0 cursor-pointer ${
                        errorMsg && !isConditionalError(errorMsg)
                          ? "bg-red-600 hover:bg-red-700 text-white shadow-xs ring-2 ring-red-400 animate-pulse"
                          : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                      }`}
                    >
                      {errorMsg && !isConditionalError(errorMsg) ? "이 초안 삭제" : "삭제"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 🗑️ U3: 초안 전체 비우기 확인 모달 */}
      {deleteAllModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-md w-full p-6 space-y-4">
            <div className="font-extrabold text-base text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-3">
              <span>🗑️</span>
              <span>초안 전체 비우기</span>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed">
              저장된 초안 <strong className="text-red-700">{myDrafts.length}건</strong>을 전량 삭제하시겠습니까?
              <br />
              이 작업은 취소할 수 없으며 시간표 그리드의 점선 초안도 모두 제거됩니다.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteAllModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDeleteAllDrafts}
                disabled={deletingAllDrafts}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-xl shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {deletingAllDrafts ? "삭제 중..." : "전체 삭제"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사유 선택 및 제출 확인 모달 */}
      {confirmingDraft && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
            <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                <span>⚡</span>
                <span>수업교환 신청 제출 확인</span>
              </h4>
              <button
                type="button"
                onClick={() => setConfirmingDraft(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 text-xs space-y-1">
              <div>• <b>내 수업:</b> {formatSlotWithDate(confirmingDraft.sourceWeekId, confirmingDraft.source.day, confirmingDraft.source.period)} ({confirmingDraft.source.grade}-{confirmingDraft.source.classNum}반 {confirmingDraft.source.subjectName})</div>
              <div>• <b>교환 희망:</b> {formatSlotWithDate(confirmingDraft.targetWeekId || confirmingDraft.sourceWeekId, confirmingDraft.candidate.targetDay, confirmingDraft.candidate.targetPeriod)} ({confirmingDraft.candidate.counterpartName || "상대 교사"})</div>
            </div>

            {confirmingDraft.candidate?.coordination && (
              <div className="space-y-2">
                <CoordinationNoticeBlock coordination={confirmingDraft.candidate.coordination} />
                <div className="bg-red-50/60 border border-red-200 rounded-xl p-3 space-y-2 text-xs">
                  <label className="flex items-start gap-2 cursor-pointer bg-white p-2.5 rounded-lg border border-red-200">
                    <input
                      type="checkbox"
                      checked={draftConsentConfirmed}
                      onChange={(e) => setDraftConsentConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-red-950">
                      위 선생님들께 사전 양해를 완료하였음을 확인합니다 (필수)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={draftConsentNote}
                    onChange={(e) => setDraftConsentNote(e.target.value)}
                    placeholder="사전 양해 메모 (선택, 예: 시간표 조정 사전 합의)"
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">신청 사유 (필수 선택)</label>
              <select
                value={draftReason.type}
                onChange={(e) => setDraftReason({ type: e.target.value as any, note: draftReason.note })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {SWAP_REASON_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {draftReason.type === "기타" && (
              <textarea
                value={draftReason.note || ""}
                onChange={(e) => setDraftReason({ ...draftReason, note: e.target.value })}
                placeholder="사유(기타)를 입력해 주세요 (필수)"
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setConfirmingDraft(null)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSubmitDraftConfirm}
                disabled={submittingDraftId === confirmingDraft.id || (draftReason.type === "기타" && !draftReason.note?.trim()) || (!!confirmingDraft.candidate?.coordination && !draftConsentConfirmed)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                {submittingDraftId === confirmingDraft.id ? "제출 중..." : "양해 확인 및 제출"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 장바구니 일괄 제출 양해 확인 모달 */}
      {batchConfirmingDrafts && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-red-950 flex items-center gap-2">
                <span className="text-red-600 font-extrabold text-base">⚠️</span>
                <span>일괄 교환 신청 제출 사전 양해 확인</span>
              </h4>
              <button
                type="button"
                onClick={() => setBatchConfirmingDrafts(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-gray-700 font-semibold">
                일괄 신청 대상 {batchConfirmingDrafts.length}건 중 <strong>{batchConfirmingDrafts.filter((d) => !!d.candidate?.coordination).length}건</strong>이 당사자 양해가 필요한 항목입니다.
              </p>

              {batchConfirmingDrafts
                .filter((d) => !!d.candidate?.coordination)
                .map((d, dIdx) => (
                  <div key={d.id || dIdx} className="space-y-1">
                    <div className="text-[11px] font-bold text-gray-900">
                      항목 #{dIdx + 1}: {d.source.grade}-{d.source.classNum}반 {d.source.subjectName} ➔ {d.candidate.counterpartName}
                    </div>
                    <CoordinationNoticeBlock coordination={d.candidate.coordination} />
                  </div>
                ))}

              <div className="pt-2 border-t border-gray-100 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer bg-red-50/60 p-2.5 rounded-lg border border-red-200">
                  <input
                    type="checkbox"
                    checked={batchConsentConfirmed}
                    onChange={(e) => setBatchConsentConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-red-950">
                    위 양해 필요 항목들의 담당 선생님들께 사전 양해를 완료하였음을 확인합니다 (필수)
                  </span>
                </label>
                <input
                  type="text"
                  value={batchConsentNote}
                  onChange={(e) => setBatchConsentNote(e.target.value)}
                  placeholder="사전 양해 메모 (선택, 예: 시간표 조정 사전 합의)"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setBatchConfirmingDrafts(null)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => executeCreateBatchInTab(batchConfirmingDrafts, batchConsentNote)}
                disabled={submittingBatch || !batchConsentConfirmed}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
              >
                {submittingBatch ? "제출 중..." : "양해 확인 및 일괄 제출"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 오프스크린 초안 이미지 복사용 DOM */}
      <OffscreenShareCard cardRef={draftShareRef} data={draftShareData} />
    </div>
  );
}

// ── ② 내 신청 내역 탭 ────────────────────────────────────────────
interface MyRequestsTabProps {
  settings: TimetableSettings | null;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:  { label: "검토 중",  className: "bg-amber-100 text-amber-800 border-amber-200" },
  APPROVED: { label: "승인됨",   className: "bg-green-100 text-green-800 border-green-200" },
  REJECTED: { label: "반려됨",   className: "bg-red-100 text-red-800 border-red-200" },
  CANCELED: { label: "취소됨",   className: "bg-gray-100 text-gray-600 border-gray-200" },
};

function isConditionalError(msg?: string): boolean {
  if (!msg) return false;
  return msg.includes("조건부") || msg.includes("대기 신청이 승인되어야") || msg.includes("전제 사유");
}

function formatDateTimeCompact(timestamp: number | string | Date, showSeconds = false): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dayStr = days[d.getDay()];
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  const timeStr = showSeconds ? `${hours}:${minutes}:${seconds}` : `${hours}:${minutes}`;
  return `신청 ${month}/${date}(${dayStr}) ${timeStr}`;
}

function formatShortDate(timestamp: number | string | Date): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${date} ${hours}:${minutes}`;
}

function MyRequestsTab({ settings }: MyRequestsTabProps) {
  const { user, userData, teacherProfile } = useAuth();
  const userEmail = userData?.email || "";

  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 페이지네이션 상태 (처리 완료 내역용)
  const [completedPage, setCompletedPage] = useState(1);
  const [completedPageSize, setCompletedPageSize] = useState(20);

  // 주 선택 필터 변경 시 1페이지로 리셋
  useEffect(() => {
    setCompletedPage(1);
  }, [selectedWeekId]);

  const duplicateMinutesMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of requests) {
      if (!r.createdAt) continue;
      const d = new Date(r.createdAt);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [requests]);

  const isSameMinuteDuplicate = useCallback((timestamp: number | string | Date) => {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return false;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    return (duplicateMinutesMap[key] || 0) > 1;
  }, [duplicateMinutesMap]);

  useEffect(() => {
    const termId = settings?.activeTermId;
    if (!termId) return;
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.success) setWeeks(data.weeks || []); })
      .catch(() => {});
  }, [settings?.activeTermId]);

  const fetchMyList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my_list", weekId: selectedWeekId || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "내 신청 목록을 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedWeekId]);

  useEffect(() => { fetchMyList(); }, [fetchMyList]);

  const handleCancel = async (requestId: string) => {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    setCancellingId(requestId);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", requestId }),
      });
      if (res.ok) {
        setSuccessMsg("신청이 취소되었습니다.");
        fetchMyList();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`취소 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    } finally {
      setCancellingId(null);
    }
  };

  // 데이터 분류
  // 1) 대기 중 (PENDING) 신청: 오래된 것 먼저 (생성일시 오름차순) - 페이지네이션 없이 상단 전부
  const pendingRequests = requests
    .filter((r) => r.status === "PENDING")
    .sort((a, b) => a.createdAt - b.createdAt);

  // 2) 처리 완료 기록 (PENDING 제외): 최신순 (생성일시 내림차순) 정렬 후 클라이언트 페이지네이션
  const completedRequests = requests
    .filter((r) => r.status !== "PENDING")
    .sort((a, b) => b.createdAt - a.createdAt);

  const totalCompletedPages = Math.ceil(completedRequests.length / completedPageSize) || 1;
  const safeCompletedPage = Math.min(Math.max(1, completedPage), totalCompletedPages);
  const completedStartIndex = (safeCompletedPage - 1) * completedPageSize;
  const paginatedCompletedRequests = completedRequests.slice(
    completedStartIndex,
    completedStartIndex + completedPageSize
  );

  const renderMyRequestRow = (req: SwapRequest) => {
    const statusInfo = STATUS_LABELS[req.status] || {
      label: req.status,
      className: "bg-gray-100 text-gray-600 border-gray-200",
    };
    const isCross =
      req.type === "cross_swap" ||
      (req.targetWeekId && req.targetWeekId !== req.weekId) ||
      !!(req.candidate as any).targetWeekId;
    const targetWeekVal = req.targetWeekId || (req.candidate as any).targetWeekId;
    const isPending = req.status === "PENDING";

    return (
      <div
        key={req.id}
        className={`p-2.5 space-y-1 rounded-lg border transition-all text-xs ${
          isPending
            ? "border-amber-200 bg-amber-50/20"
            : "border-gray-200 bg-white hover:bg-gray-50/50"
        }`}
      >
        {/* 1줄째: 신청일시(진하게) -> 상태 뱃지 -> 유형 뱃지 -> 주 정보 */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold text-gray-900 text-xs shrink-0">
              {formatDateTimeCompact(req.createdAt, isSameMinuteDuplicate(req.createdAt))}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-bold border shrink-0 ${statusInfo.className}`}
            >
              {statusInfo.label}
            </span>
            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 font-semibold text-[11px] rounded border border-indigo-100 shrink-0">
              {req.type === "simul_move"
                ? "🧩 통 이동"
                : req.type === "chain"
                ? "🔗 체인교환"
                : isCross
                ? "↔️ 교차주"
                : req.type === "swap"
                ? "↔️ 맞교환"
                : "👤 보강"}
            </span>
            {req.consent?.confirmed && (
              <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 shrink-0 flex items-center gap-0.5">
                <span>🤝</span>
                <span>양해 확인됨</span>
              </span>
            )}
          </div>

          <span className="text-[11px] text-gray-400 shrink-0">
            신청 주: <strong className="text-gray-700">{req.weekId} 주</strong>
            {isCross && targetWeekVal ? ` ↔ ${targetWeekVal} 주` : ""}
          </span>
        </div>

        {/* 2줄째: 수업 정보 + 취소 버튼 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-1.5 text-xs text-gray-700">
          <div className="flex items-center gap-1 flex-wrap font-medium">
            <span className="text-gray-500">원 수업:</span>
            <span className="font-bold text-gray-900">
              {formatSlotWithDate(req.weekId, req.source.day, req.source.period)}
            </span>
            <span className="text-gray-600">
              {req.type === "simul_move"
                ? `(${req.simulMove?.label || req.source.subjectName}, ${req.source.grade}학년 ${req.simulMove?.classNums?.join("·") || req.source.classNum}반)`
                : `(${req.source.subjectName}, ${req.source.grade}-${req.source.classNum}반)`}
            </span>

            {req.type === "simul_move" && (
              <>
                <span className="text-gray-400 font-bold px-0.5">→</span>
                <span className="font-bold text-purple-800">
                  {formatSlotWithDate(
                    targetWeekVal || req.weekId,
                    req.candidate?.targetDay ?? req.simulMove?.to?.day ?? 0,
                    req.candidate?.targetPeriod ?? req.simulMove?.to?.period ?? 0
                  )} (목적지)
                </span>
                <span className="text-gray-600">
                  · {req.simulMove?.label || req.candidate?.counterpartName || "이동수업"} ({req.simulMove?.steps?.length || (req.candidate as any)?.steps?.length || 0}개 반)
                </span>
              </>
            )}

            {req.type === "chain" && (
              <>
                <span className="text-gray-400 font-bold px-0.5">→</span>
                <span className="font-bold text-purple-800">
                  {formatSlotWithDate(
                    targetWeekVal || req.chainTarget?.weekId || req.weekId,
                    req.candidate?.targetDay ?? req.chainTarget?.day ?? 0,
                    req.candidate?.targetPeriod ?? req.chainTarget?.period ?? 0
                  )} (목적지)
                </span>
                <span className="text-gray-600">
                  · 체인 경로 ({req.chainSteps?.length || (req.candidate as any)?.chainSteps?.length || 2}단계)
                </span>
              </>
            )}

            {(req.type === "swap" || req.type === "cross_swap") && req.candidate.targetDay != null && (
              <>
                <span className="text-gray-400 font-bold px-0.5">→</span>
                <span className="font-bold text-indigo-800">
                  {formatSlotWithDate(
                    targetWeekVal || req.weekId,
                    req.candidate.targetDay!,
                    req.candidate.targetPeriod!
                  )}
                </span>
                <span className="text-gray-600">
                  · 상대 <strong className="text-gray-900">{req.candidate.counterpartName}</strong>
                </span>
              </>
            )}

            {req.type === "substitute" && (
              <>
                <span className="text-gray-400 font-bold px-0.5">→</span>
                <span className="font-bold text-indigo-800">특별보강</span>
                <span className="text-gray-600">
                  · 보강 <strong className="text-gray-900">{req.candidate.counterpartName}</strong>
                </span>
              </>
            )}

            <span className="text-indigo-900 font-semibold ml-1">
              + 사유 [{req.reason.type}]
            </span>
            {req.reason.note && <span className="text-gray-600">({req.reason.note})</span>}

            {req.type === "simul_move" && req.simulMove?.steps && req.simulMove.steps.length > 0 && (
              <div className="w-full text-[11px] bg-purple-50 border border-purple-200 text-purple-950 rounded-lg p-2.5 space-y-1 mt-1.5 font-sans">
                <div className="font-bold text-[10px] text-purple-900 flex items-center gap-1">
                  <span>🧩</span>
                  <span>반별 이동 내역 ({req.simulMove.steps.length}개 반):</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1">
                  {req.simulMove.steps.map((step, idx) => (
                    <div key={`${step.classNum}-${idx}`} className="text-[10px] leading-tight text-purple-950 bg-white rounded p-1.5 border border-purple-200 flex items-center justify-between shadow-2xs">
                      <span>
                        <strong>{step.classNum}반</strong>: {step.groupLesson.subjectName} ({step.groupLesson.teacherName})
                      </span>
                      <span className="font-semibold text-purple-800 ml-1">
                        {step.kind === "swap" && step.counterpart
                          ? `↔ ${step.counterpart.teacherName} (${step.counterpart.subjectName})`
                          : "➔ 빈 교시 이동"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {req.type === "chain" && req.chainSteps && req.chainSteps.length > 0 && (
              <div className="w-full text-[11px] bg-purple-50 border border-purple-200 text-purple-950 rounded-lg p-2 font-mono space-y-1 mt-1.5">
                <div className="font-bold text-[10px] text-purple-900 flex items-center gap-1">
                  <span>🔗</span>
                  <span>체인 수열 ({req.chainSteps.length}단계):</span>
                </div>
                {req.chainSteps.map((step: any, idx: number) => (
                  <div key={idx} className="text-[10px] leading-tight text-purple-900">
                    Step {idx + 1}: {step.stepSummary || step.summary || `${step.sourceTeacherName || ""} → ${step.candidate?.counterpartName || ""} (${step.targetDay}요일 ${step.targetPeriod}교시)`}
                  </div>
                ))}
              </div>
            )}

            {/* 처리 정보 및 결정 사유 */}
            {req.decidedAt && (
              <span className="text-gray-500 text-[11px] ml-1">
                · 결정일: {formatShortDate(req.decidedAt)}
              </span>
            )}
            {req.decisionNote && (
              <span className="text-red-700 font-bold text-[11px] ml-1">
                — 사유: {req.decisionNote}
              </span>
            )}
          </div>

          {/* 대기 중 신청 취소 버튼 */}
          {isPending && (
            <button
              onClick={() => handleCancel(req.id)}
              disabled={cancellingId === req.id}
              className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded text-xs transition-colors disabled:opacity-50 border border-red-200 shrink-0 self-end md:self-auto cursor-pointer"
            >
              {cancellingId === req.id ? "취소 중..." : "신청 취소"}
            </button>
          )}
        </div>

        {/* 3줄째: 사전 양해 상세 정보 */}
        {req.consent?.confirmed && (
          <div className="text-[11px] bg-amber-50/80 border border-amber-200 rounded-lg p-2 space-y-0.5 text-amber-950 font-medium mt-1">
            <div className="font-bold flex items-center gap-1 text-amber-900">
              <span>🤝 당사자 사전 양해 확인 완료</span>
              {req.consent.confirmedAt && (
                <span className="text-[10px] text-amber-700 font-normal">
                  ({new Date(req.consent.confirmedAt).toLocaleDateString("ko-KR")} {new Date(req.consent.confirmedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})
                </span>
              )}
            </div>
            {req.consent.parties && req.consent.parties.length > 0 && (
              <div>
                • 양해 당사자: {req.consent.parties.map((p) => `${p.name} 선생님`).join(", ")}
              </div>
            )}
            {req.consent.note && <div>• 양해 메모: {req.consent.note}</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5 space-y-4">

      {/* 헤더 & 주선택 필터 */}
      <div className="flex flex-wrap items-center gap-3 pb-2 border-b border-gray-100">
        <h3 className="text-base font-bold text-gray-900">📋 내 수업교환 신청 내역</h3>
        <select
          value={selectedWeekId}
          onChange={(e) => setSelectedWeekId(e.target.value)}
          className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-800"
        >
          <option value="">전체 주</option>
          {weeks.map((w) => <option key={w.id} value={w.id}>{w.startDate} 주</option>)}
        </select>
        <button
          onClick={fetchMyList}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
        >
          새로고침
        </button>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs font-semibold text-emerald-800">
          ✅ {successMsg}
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">⚠️ {error}</div>}
      {loading && <div className="text-center py-6 text-xs text-indigo-500 animate-pulse">불러오는 중...</div>}

      {/* 내 신청 내역 리스트 */}
      {!loading && requests.length === 0 && (
        <div className="text-center py-8 text-xs text-gray-400 bg-white rounded-xl border border-gray-100">
          수업교환 신청 내역이 없습니다.
        </div>
      )}

      {!loading && requests.length > 0 && (
        <div className="space-y-4">
          {/* ① 대기 중 신청 (PENDING) - 페이지 없이 항상 상단 전부 표시 */}
          {pendingRequests.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-amber-900 px-1">
                ⏳ 대기 중 신청 ({pendingRequests.length}건)
              </h4>
              <div className="space-y-1.5">
                {pendingRequests.map((req) => renderMyRequestRow(req))}
              </div>
            </div>
          )}

          {/* ② 처리 완료 기록 (PENDING 제외 - 최신순 정렬 및 클라이언트 페이지네이션) */}
          {completedRequests.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <h4 className="text-xs font-bold text-gray-700 px-1">
                📜 처리 완료 기록 ({completedRequests.length}건)
              </h4>
              <div className="space-y-1.5">
                {paginatedCompletedRequests.map((req) => renderMyRequestRow(req))}
              </div>

              <PaginationControls
                currentPage={safeCompletedPage}
                totalPages={totalCompletedPages}
                pageSize={completedPageSize}
                totalCount={completedRequests.length}
                onPageChange={(page) => setCompletedPage(page)}
                onPageSizeChange={(size) => {
                  setCompletedPageSize(size);
                  setCompletedPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ③ 다른 시간표 조회 탭 ─────────────────────────────────────────
interface OtherTimetableTabProps {
  periodsPerDay: number;
  settings: TimetableSettings | null;
}

function OtherTimetableTab({ periodsPerDay, settings }: OtherTimetableTabProps) {
  const { userData } = useAuth();
  const myEmail = userData?.email?.toLowerCase() || "";
  const userEmail = myEmail;
  const isSuperAdmin = userData?.role === "super_admin";
  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [targetEmail, setTargetEmail] = useState(myEmail);
  const [teacherName, setTeacherName] = useState("");
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ② 교사 목록 드롭다운용
  const [teacherList, setTeacherList] = useState<{ email: string; name: string }[]>([]);
  const [teacherListLoading, setTeacherListLoading] = useState(false);

  useEffect(() => {
    const termId = settings?.activeTermId;
    if (!termId) return;
    // 주 목록 로드
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) {
          const loadedWeeks: TimetableWeek[] = data.weeks || [];
          setWeeks(loadedWeeks);
          if (loadedWeeks.length > 0) {
            const defaultId = findDefaultWeekId(loadedWeeks);
            if (defaultId) {
              setSelectedWeekId((prev) => (prev ? prev : defaultId));
            }
          }
        }
      })
      .catch(() => {});
    // 교사 목록 로드 (가나다순 드롭다운)
    setTeacherListLoading(true);
    fetch("/api/timetable/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "teachers", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.data) setTeacherList(data.data as { email: string; name: string }[]);
      })
      .catch(() => {})
      .finally(() => setTeacherListLoading(false));
  }, [settings?.activeTermId]);

  const fetchTimetable = useCallback(async (email: string, weekId?: string) => {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const isMe = email.toLowerCase() === myEmail;
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isMe ? "my" : "teacher",
          teacherEmail: email,
          weekId: weekId || undefined,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        setCells(result.data?.cells || []);
        setTeacherName(result.data?.teacherName || email.split("@")[0]);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [myEmail]);

  useEffect(() => {
    fetchTimetable(targetEmail, selectedWeekId || undefined);
  }, [targetEmail, selectedWeekId, fetchTimetable]);

  const getCellFor = (day: number, period: number) =>
    cells.filter((c) => c.day === day && c.period === period);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            🔍 다른 교사 시간표 조회
            {termMeta && (
              <span className="text-xs px-2 py-0.5 rounded-full font-normal bg-indigo-100 text-indigo-800">{termMeta.name}</span>
            )}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
          >
            {isManager && <option value="">기초시간표</option>}
            {weeks.map((w) => <option key={w.id} value={w.id}>{w.startDate} 주</option>)}
          </select>
          {/* ② 교사 드롭다운 — action:teachers 가나다순 */}
          <select
            value={targetEmail}
            onChange={(e) => {
              const email = e.target.value;
              setTargetEmail(email);
              const found = teacherList.find((t) => t.email === email);
              if (found) setTeacherName(found.name);
            }}
            disabled={teacherListLoading}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs min-w-[10rem] max-w-xs disabled:opacity-60"
          >
            {teacherListLoading && <option value="">불러오는 중...</option>}
            {/* ③ '내 시간표' 옵션 상시 고정 (본인이 시간표에 없어도 value 불일치 방지) */}
            {!teacherListLoading && (
              <option value={myEmail}>내 시간표</option>
            )}
            {/* 본인 중복 제거 후 가나다순 렌더 */}
            {!teacherListLoading && teacherList
              .filter((t) => t.email !== myEmail)
              .map((t) => (
                <option key={t.email} value={t.email}>
                  {t.name}
                </option>
              ))
            }
          </select>
        </div>
      </div>

      <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center">
        <div>
          <span className="font-bold text-indigo-950 text-sm">{teacherName || targetEmail.split("@")[0]}</span>
          {" "}교사님 — 총 <span className="font-black text-indigo-700">{cells.length}</span>시간
        </div>
        {loading && <span className="text-xs text-indigo-600 animate-pulse font-semibold">조회 중...</span>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{error}</div>}

      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-indigo-950 text-white font-bold">
              <th className="py-2.5 px-1 border-b border-r border-indigo-800 w-14 text-center text-xs">교시</th>
              {DAYS.map((d) => {
                const targetWeekObj = weeks.find((w) => w.id === selectedWeekId);
                const dateLabel = getDayDateLabel(targetWeekObj?.startDate || selectedWeekId, d.num);
                return (
                  <th key={d.num} className="py-2 px-1 border-b border-indigo-800 text-center w-1/5 text-sm">
                    <div>{d.label}요일</div>
                    {dateLabel && <div className="text-xs text-indigo-300 font-normal mt-0.5">{dateLabel}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, pIdx) => {
              const period = pIdx + 1;
              return (
                <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                  <td className="py-2 px-1 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50 text-xs align-middle w-14">{period}교시</td>
                  {DAYS.map((d) => {
                    const matched = getCellFor(d.num, period);
                    const hasLesson = matched.length > 0;
                    return (
                      <td key={d.num} className={`p-1.5 border-r border-gray-100 text-center align-middle h-16 transition-colors ${hasLesson ? "bg-indigo-50/40 hover:bg-indigo-100/50" : ""}`}>
                        {hasLesson ? (
                          <div className="space-y-1">
                            {matched.map((cell, cIdx) => {
                              const isChanged = !!(cell as any).changed;
                              const tooltip = `${cell.subjectName} · ${cell.grade}-${cell.classNum}반${cell.room ? ` (${cell.room})` : ""}`;
                              return (
                                <div key={cIdx} title={tooltip} className={`p-1.5 rounded-lg space-y-0.5 ${isChanged ? "bg-sky-100 border border-sky-300" : "bg-white border border-indigo-200 shadow-2xs"}`}>
                                  <div className={`font-black text-sm ${isChanged ? "text-sky-950" : "text-indigo-950"}`}>
                                    {cell.grade}-{cell.classNum}반
                                    {isChanged && <span className="ml-1 text-sky-600 text-xs">▲</span>}
                                  </div>
                                  {cell.room && <div className="text-xs text-gray-500 truncate">📍 {cell.room}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 font-light block py-1">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 메인 섹션 ──────────────────────────────────────────────────
export default function TeacherPortalSection() {
  const { userData } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";
  const isStudent = userData?.role === "student";

  const [settings, setSettings] = useState<TimetableSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"my_tt" | "my_requests" | "other">("my_tt");

  useEffect(() => {
    const cached = getClientCache("timetable:settings");
    if (cached?.settings) {
      setSettings(cached.settings);
      setLoading(false);
    } else {
      fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.settings) {
            setSettings(data.settings);
            setClientCache("timetable:settings", { settings: data.settings, terms: data.terms || [] });
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  // 학생 전면 차단
  if (isStudent) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900 space-y-2">
        <h3 className="text-base font-bold">🔒 접근 제한</h3>
        <p className="text-xs text-amber-800">학생은 이 메뉴에 접근할 수 없습니다.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4" />
        <p className="text-sm font-semibold text-gray-600">시간표 설정을 불러오는 중...</p>
      </div>
    );
  }

  // 노출 게이트 (phase9b_spec §7)
  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);
  // teacherOpen(전 교사 오픈) 또는 파일럿 명단(오픈 게이트 전 테스트·실무사) — 2026-08-04 정식화
  const teacherOpen = !!settings?.teacherOpen;
  const isPilot = (settings?.teacherPilotEmails || []).some(
    (e) => e.toLowerCase() === userEmail
  );
  const canView = isManager || teacherOpen || isPilot;

  if (!canView) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900 space-y-2">
        <h3 className="text-base font-bold">🔒 수업교환 신청 준비 중</h3>
        <p className="text-xs text-amber-800">
          현재 교사 신청 기능은 준비 중입니다. 일과계 검토 완료 후 오픈될 예정입니다.
        </p>
      </div>
    );
  }

  const periodsPerDay = settings?.periodsPerDay || 7;

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-blue-900 rounded-xl p-5 text-white shadow-md border border-indigo-700/40">
        <h2 className="text-lg font-bold">📅 내 시간표 &amp; 수업교환 신청</h2>
        <p className="text-sm text-indigo-200/80 mt-1">
          내 주간 시간표를 확인하고 수업교환을 신청합니다. 교체가 가능한 자리만 후보로 표시됩니다.
        </p>
      </div>

      <CalendarSubscribeCard variant="compact" />

      <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-200 flex flex-wrap gap-2 text-xs font-bold">

        <button
          onClick={() => setActiveTab("my_tt")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "my_tt" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🗓️ 내 주간시간표</span>
        </button>
        <button
          onClick={() => setActiveTab("my_requests")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "my_requests" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📋 내 신청 내역</span>
        </button>
        <button
          onClick={() => setActiveTab("other")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "other" ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🔍 다른 시간표 조회</span>
        </button>
      </div>

      {activeTab === "my_tt" && <MyTimetableTab periodsPerDay={periodsPerDay} settings={settings} />}
      {activeTab === "my_requests" && <MyRequestsTab settings={settings} />}
      {activeTab === "other" && <OtherTimetableTab periodsPerDay={periodsPerDay} settings={settings} />}
    </div>
  );
}
