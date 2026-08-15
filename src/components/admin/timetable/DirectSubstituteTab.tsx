"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { resolveDisplayName, isFrozenLocalPartName } from "@/lib/org/displayName";
import {
  SubstituteCandidate,
  SwapCandidate,
  SwapReasonType,
  SWAP_REASON_TYPES,
  TeacherTimetableCell,
  TimetableWeek,
  DirectPendingOverlayItem,
  DirectCommitBatchItemResult,
  SimulGroupMoveCandidate,
  SimulMoveStep,
} from "@/lib/timetable/types";
import { SimulGroup } from "@/lib/timetable/simul";
import { DAY_LABEL, formatSlotWithDate, formatCoordinationText, getCoordinationOccupants } from "@/lib/timetable/utils";

import MiniPreviewGrid from "./MiniPreviewGrid";
import {
  ConsolidatedShareData,
  OffscreenConsolidatedCard as OffscreenConsolidatedShareCard,
  copyShareImageElement,
} from "./OffscreenShareCard";

interface DirectSubstituteTabProps {
  activeTermId: string | null;
}

interface WeekCandidateGroup {
  weekId: string;
  startDate: string;
  note?: string;
  swapCandidates: SwapCandidate[];
}

export interface CartItem extends DirectPendingOverlayItem {
  id: string;
  counterpartEmail?: string;
  counterpartName?: string;
  counterpartSubjectName?: string;
  lastError?: string;
}

export default function DirectSubstituteTab({ activeTermId }: DirectSubstituteTabProps) {
  const { user, teacherProfile } = useAuth();

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");

  const [teacherList, setTeacherList] = useState<Array<{ email: string; name: string }>>([]);
  const [teacherListLoading, setTeacherListLoading] = useState(false);

  const [selectedTeacherEmail, setSelectedTeacherEmail] = useState("");
  const [selectedTeacherName, setSelectedTeacherName] = useState("");
  const [recentTeachers, setRecentTeachers] = useState<Array<{ email: string; name: string }>>([]);

  const [teacherWeekCellsMap, setTeacherWeekCellsMap] = useState<Record<string, TeacherTimetableCell[]>>({});
  const [projectedWeeks, setProjectedWeeks] = useState<Array<{
    weekId: string;
    startDate: string;
    cells: TeacherTimetableCell[];
    dayPeriodCounts?: Array<{ day: number; periods: number }>;
  }>>([]);
  const [hasMoreProjectedWeeks, setHasMoreProjectedWeeks] = useState(false);
  const [extraWeeks, setExtraWeeks] = useState(0);
  const [loadingTimetable, setLoadingTimetable] = useState(false);
  const [timetableError, setTimetableError] = useState<string | null>(null);

  const weekGridRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [recentlyUpdatedWeeks, setRecentlyUpdatedWeeks] = useState<string[]>([]);

  const [selectedSlot, setSelectedSlot] = useState<{
    weekId: string;
    grade: number;
    classNum: number;
    day: number;
    period: number;
  } | null>(null);

  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [sourceLessonInfo, setSourceLessonInfo] = useState<{
    subjectName: string;
    teacherName?: string;
  } | null>(null);

  const [swapCandidateWeeks, setSwapCandidateWeeks] = useState<WeekCandidateGroup[]>([]);
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [activeCandidateType, setActiveCandidateType] = useState<"swap" | "substitute">("swap");

  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);

  const [previewCells, setPreviewCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartSourceCells, setCounterpartSourceCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartTargetCells, setCounterpartTargetCells] = useState<TeacherTimetableCell[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCacheRef = useRef<Map<string, TeacherTimetableCell[]>>(new Map());

  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  const [consolidatedShareData, setConsolidatedShareData] = useState<ConsolidatedShareData | null>(null);
  const consolidatedCardRef = useRef<HTMLDivElement>(null);
  const [generatingShareFor, setGeneratingShareFor] = useState<string | null>(null);

  const [reasonType, setReasonType] = useState<SwapReasonType>("기타");
  const [reasonNote, setReasonNote] = useState("일과계 직권 배정");

  // 징검다리 체인 탐색 (pre_opening_3features_spec §C-3)
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [chainTargetSlot, setChainTargetSlot] = useState<{ weekId: string; day: number; period: number } | null>(null);
  const [chainSourceSlot, setChainSourceSlot] = useState<{
    weekId: string;
    grade: number;
    classNum: number;
    day: number;
    period: number;
    subjectName: string;
    teacherEmail: string;
    teacherName: string;
  } | null>(null);
  const [chainSearchLoading, setChainSearchLoading] = useState(false);
  const [chainSearchError, setChainSearchError] = useState<string | null>(null);
  const [chainResults, setChainResults] = useState<any[]>([]);
  const [chainMaxDepth, setChainMaxDepth] = useState<number>(2);

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── 직권 배정 모드 (교사별 직권 배정 | 이동수업 통 이동) ──
  const [directMode, setDirectMode] = useState<"teacher" | "simul_move">("teacher");

  // ── 이동수업 통 이동 상태 (consent_swap_opening_spec §5b) ──
  const [simulGroups, setSimulGroups] = useState<SimulGroup[]>([]);
  const [simulGroupsLoading, setSimulGroupsLoading] = useState(false);
  const [selectedSimulGroupId, setSelectedSimulGroupId] = useState<string>("");
  const [selectedSimulWeekId, setSelectedSimulWeekId] = useState<string>("");
  const [simulGroupSlots, setSimulGroupSlots] = useState<Array<{ day: number; period: number }>>([]);
  const [selectedSimulSourceSlot, setSelectedSimulSourceSlot] = useState<{ day: number; period: number } | null>(null);
  const [simulCandidates, setSimulCandidates] = useState<SimulGroupMoveCandidate[]>([]);
  const [loadingSimulCandidates, setLoadingSimulCandidates] = useState(false);
  const [simulCandidateError, setSimulCandidateError] = useState<string | null>(null);

  // 통 이동 확인 다이얼로그 (반별 전개 + 연속시수/특별실 경고 + 양해 확인)
  const [selectedCandidateForModal, setSelectedCandidateForModal] = useState<SimulGroupMoveCandidate | null>(null);
  const [simulConsentConfirmed, setSimulConsentConfirmed] = useState(false);
  const [simulConsentNote, setSimulConsentNote] = useState("");
  const [simulReasonType, setSimulReasonType] = useState<SwapReasonType>("기타");
  const [simulReasonNote, setSimulReasonNote] = useState("이동수업 통 이동");
  const [simulSubmitting, setSimulSubmitting] = useState(false);

  const getInitialWeekId = (weeksList: TimetableWeek[]): string => {
    if (!weeksList || weeksList.length === 0) return "";
    // KST 기준 오늘 — toISOString 단독은 UTC라 KST 00:00~08:59에 어제로 계산됨
    const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const active = weeksList.find((w) => {
      const start = w.startDate;
      const endDateObj = new Date(start);
      endDateObj.setDate(endDateObj.getDate() + 6);
      const end = endDateObj.toISOString().slice(0, 10);
      return todayStr >= start && todayStr <= end;
    });
    if (active) return active.id;
    const futureWeeks = weeksList
      .filter((w) => w.startDate > todayStr)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (futureWeeks.length > 0) return futureWeeks[0].id;
    return weeksList[0].id;
  };

  const fetchTeachers = async () => {
    setTeacherListLoading(true);
    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "teachers" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) setTeacherList(data.data);
      }
    } catch {} finally {
      setTeacherListLoading(false);
    }
  };

  const fetchWeeks = async () => {
    if (!activeTermId) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "week_list", termId: activeTermId }),
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.weeks)) {
        setWeeks(data.weeks);
        const initId = getInitialWeekId(data.weeks);
        setSelectedWeekId(initId);
        if (!selectedSimulWeekId) setSelectedSimulWeekId(initId);
        if (selectedTeacherEmail) fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, data.weeks);
      }
    } catch {}
  };

  const fetchSimulGroups = async () => {
    setSimulGroupsLoading(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simul_list", termId: activeTermId }),
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.groups)) {
        const activeGroups = data.groups.filter((g: SimulGroup) => g.active !== false);
        setSimulGroups(activeGroups);
        if (activeGroups.length > 0 && !selectedSimulGroupId) {
          const storedGroupId = typeof window !== "undefined" ? sessionStorage.getItem("direct_tab_simul_group_id") : null;
          const targetId = storedGroupId && activeGroups.some((g: SimulGroup) => g.id === storedGroupId) ? storedGroupId : activeGroups[0].id || "";
          setSelectedSimulGroupId(targetId);
        }
      }
    } catch {} finally {
      setSimulGroupsLoading(false);
    }
  };

  useEffect(() => {
    fetchTeachers();
    fetchWeeks();
    fetchSimulGroups();
  }, [activeTermId]);

  // SimulGroupTab에서 진입 시 자동 모드 전환
  useEffect(() => {
    const checkNav = (targetGroupId?: string) => {
      const gId = targetGroupId || (typeof window !== "undefined" ? sessionStorage.getItem("direct_tab_simul_group_id") : null);
      if (gId) {
        setDirectMode("simul_move");
        setSelectedSimulGroupId(gId);
        if (typeof window !== "undefined") sessionStorage.removeItem("direct_tab_simul_group_id");
      }
    };
    checkNav();
    const handleNav = (e: any) => {
      if (e.detail?.simulGroupId) {
        checkNav(e.detail.simulGroupId);
      }
    };
    window.addEventListener("admin_navigate", handleNav);
    return () => window.removeEventListener("admin_navigate", handleNav);
  }, []);

  // 통 이동 후보 및 현행 슬롯 조회 (simul_move_candidates API)
  const fetchSimulMoveCandidates = async (
    wId: string,
    gId: string,
    source?: { day: number; period: number } | null
  ) => {
    if (!wId || !gId) return;
    setLoadingSimulCandidates(true);
    setSimulCandidateError(null);
    if (!source) {
      setSimulCandidates([]);
    }
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "simul_move_candidates",
          weekId: wId,
          simulGroupId: gId,
          ...(source ? { simulMoveSource: { day: source.day, period: source.period } } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const slots: Array<{ day: number; period: number }> = Array.isArray(data.groupSlots) ? data.groupSlots : [];
        setSimulGroupSlots(slots);

        if (source) {
          setSimulCandidates(data.candidates || []);
          if (data.error) {
            setSimulCandidateError(data.error);
          }
        } else {
          // U1: 소스 없이 호출하여 그 주 시간표 기준 현행 교시(groupSlots)를 받은 경우
          if (slots.length > 0) {
            const firstSlot = slots[0];
            setSelectedSimulSourceSlot(firstSlot);
            // 첫 교시를 자동 선택하여 후보 조회 연속 실행
            const candRes = await fetch("/api/timetable/manage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "simul_move_candidates",
                weekId: wId,
                simulGroupId: gId,
                simulMoveSource: { day: firstSlot.day, period: firstSlot.period },
              }),
            });
            const candData = await candRes.json();
            if (candRes.ok && candData.success) {
              setSimulCandidates(candData.candidates || []);
              if (candData.error) setSimulCandidateError(candData.error);
            } else {
              setSimulCandidateError(candData.error || "이동 가능한 후보 교시를 찾을 수 없습니다.");
            }
          } else {
            setSelectedSimulSourceSlot(null);
            setSimulCandidates([]);
            setSimulCandidateError("해당 주간 시간표에서 이 이동수업 그룹의 수업 교시를 찾을 수 없습니다.");
          }
        }
      } else {
        setSimulCandidateError(data.error || "이동 가능한 후보 교시를 찾을 수 없습니다.");
      }
    } catch (err: any) {
      setSimulCandidateError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoadingSimulCandidates(false);
    }
  };

  // 그룹 또는 주 변경 시 슬롯 및 후보 자동 연동 (U1)
  useEffect(() => {
    if (!selectedSimulGroupId || !selectedSimulWeekId) {
      setSimulGroupSlots([]);
      setSelectedSimulSourceSlot(null);
      setSimulCandidates([]);
      return;
    }
    fetchSimulMoveCandidates(selectedSimulWeekId, selectedSimulGroupId, null);
  }, [selectedSimulGroupId, selectedSimulWeekId]);

  const handleSelectSimulSourceSlot = (slot: { day: number; period: number }) => {
    setSelectedSimulSourceSlot(slot);
    if (selectedSimulWeekId && selectedSimulGroupId) {
      fetchSimulMoveCandidates(selectedSimulWeekId, selectedSimulGroupId, slot);
    }
  };

  const handleOpenSimulCandidateModal = (cand: SimulGroupMoveCandidate) => {
    setSelectedCandidateForModal(cand);
    setSimulConsentConfirmed(false);
    setSimulConsentNote("");
    setSimulReasonType("기타");
    setSimulReasonNote("이동수업 통 이동");
    setSubmitError(null);
  };

  const executeSimulMoveCommit = async () => {
    if (!selectedCandidateForModal || !selectedSimulGroupId || !selectedSimulSourceSlot || !selectedSimulWeekId) return;
    setSimulSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "simul_move_commit",
          weekId: selectedSimulWeekId,
          simulGroupId: selectedSimulGroupId,
          simulMoveSource: { day: selectedSimulSourceSlot.day, period: selectedSimulSourceSlot.period },
          simulMoveTarget: {
            day: selectedCandidateForModal.targetDay,
            period: selectedCandidateForModal.targetPeriod,
          },
          reason: {
            type: simulReasonType,
            note: simulReasonNote.trim() || undefined,
          },
          consent: {
            confirmed: true,
            note: simulConsentNote.trim() || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "이동수업 통 이동 반영에 실패했습니다.");
      }
      const grp = simulGroups.find((g) => g.id === selectedSimulGroupId);
      setSuccessMsg(
        `⚡ 이동수업 「${grp?.label || "이동수업"}」 통 이동 반영 완료! (${DAY_LABEL[selectedSimulSourceSlot.day]}요일 ${selectedSimulSourceSlot.period}교시 → ${DAY_LABEL[selectedCandidateForModal.targetDay]}요일 ${selectedCandidateForModal.targetPeriod}교시)`
      );
      setSelectedCandidateForModal(null);
      setRecentlyUpdatedWeeks([selectedSimulWeekId]);
      fetchSimulMoveCandidates(selectedSimulWeekId, selectedSimulGroupId, null);
      if (selectedTeacherEmail) {
        fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, cartItems);
      }
    } catch (err: any) {
      setSubmitError(err.message || "통 이동 반영 실패");
    } finally {
      setSimulSubmitting(false);
    }
  };

  // 결보강 담기 이탈 경고 (UX 스캔 §6-6 / backlog A2)
  useEffect(() => {
    if (cartItems.length === 0) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [cartItems.length]);

  // sourceTeacherEmail/Name 필수 동봉 — §C 체인 단계는 선택 교사가 아닌 제3 교사의 수업일 수 있고,
  // 빠뜨리면 서버 오버레이가 선택 교사 소유로 간주해 합성기 무결성 검사에서 전 단계가 건너뛰어진다
  // (2026-08-08 실증: 담긴 체인이 예상 시간표에 반영되지 않고 원 수업이 그대로 남음)
  const toPendingPayload = (cart: CartItem[]) =>
    cart.map((item) => ({
      weekId: item.weekId,
      ...(item.targetWeekId ? { targetWeekId: item.targetWeekId } : {}),
      type: item.type,
      source: item.source,
      candidate: item.candidate,
      ...(item.sourceTeacherEmail ? { sourceTeacherEmail: item.sourceTeacherEmail } : {}),
      ...(item.sourceTeacherName ? { sourceTeacherName: item.sourceTeacherName } : {}),
    }));

  // §14-4: 그리드는 "담긴 상태의 예상 시간표" — 담기 누적분을 가상 적용한 direct_projected로 로드한다.
  // cart 인자를 명시하는 이유: setCartItems 직후에는 cartItems 바인딩이 구값이라 갱신분을 못 싣는다.
  const fetchTeacherTimetablesForAllWeeks = async (
    email: string,
    targetWeeks: TimetableWeek[] = weeks,
    cart: CartItem[] = cartItems,
    currentExtraWeeks: number = extraWeeks
  ) => {
    if (!email || targetWeeks.length === 0) return;
    setLoadingTimetable(true);
    setTimetableError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_projected",
          teacherEmail: email,
          pendingItems: toPendingPayload(cart),
          extraWeeks: currentExtraWeeks,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const rawWeeks: Array<{
          weekId: string;
          startDate: string;
          cells: TeacherTimetableCell[];
          dayPeriodCounts?: Array<{ day: number; periods: number }>;
        }> = data.weeks || [];
        const newMap: Record<string, TeacherTimetableCell[]> = {};
        rawWeeks.forEach((w) => { newMap[w.weekId] = w.cells || []; });
        setTeacherWeekCellsMap(newMap);
        setProjectedWeeks(rawWeeks);
        setHasMoreProjectedWeeks(Boolean(data.hasMore));
      } else {
        setTimetableError(data.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (err: any) { setTimetableError(`네트워크 오류: ${err.message}`); } finally { setLoadingTimetable(false); }
  };

  const handleLoadMoreWeeks = () => {
    const nextExtra = extraWeeks + 4;
    setExtraWeeks(nextExtra);
    if (selectedTeacherEmail) {
      fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, cartItems, nextExtra);
    }
  };

  const handleSelectTeacher = (email: string, name?: string) => {
    // 담기 목록은 선택 교사의 시간표를 전제로 누적된 상태 — 다른 교사로 전환하면
    // pendingItems 가상 반영·양해 카드 명의가 어긋나므로 반드시 비우고 시작한다.
    let effectiveCart = cartItems;
    if (cartItems.length > 0 && email.toLowerCase() !== selectedTeacherEmail.toLowerCase()) {
      if (!confirm(`담기 목록 ${cartItems.length}건은 현재 선택된 교사 기준입니다. 교사를 전환하면 목록이 비워집니다. 계속할까요?`)) return;
      setCartItems([]);
      effectiveCart = [];
    }
    if (!email) {
      setSelectedTeacherEmail(""); setSelectedTeacherName(""); setTeacherWeekCellsMap({}); setSelectedSlot(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setSelectedCandidate(null); setChainSourceSlot(null); setChainTargetSlot(null); setChainModalOpen(false); return;
    }
    const finalName = name || teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase())?.name || email.split("@")[0];
    setSelectedTeacherEmail(email); setSelectedTeacherName(finalName);
    setRecentTeachers((prev) => { const filtered = prev.filter((t) => t.email.toLowerCase() !== email.toLowerCase()); return [{ email, name: finalName }, ...filtered].slice(0, 5); });
    setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setSelectedCandidate(null); setCandidateError(null); setSuccessMsg(null); setSubmitError(null);
    // 체인 상태도 초기화 — 이전 교사의 수업이 원본으로 잔존해 "누르지 않은 수업"으로 탐색되는 사고 방지 (2026-08-07)
    setChainSourceSlot(null); setChainTargetSlot(null); setChainModalOpen(false); setChainResults([]); setChainSearchError(null);
    fetchTeacherTimetablesForAllWeeks(email, weeks, effectiveCart);
    // ref 존재 검사는 timeout 안에서 — 첫 선택 시점엔 그리드가 아직 렌더 전이라 밖에서 검사하면 스크롤이 무산된다
    const initWeekId = getInitialWeekId(weeks);
    if (initWeekId) {
      setTimeout(() => { weekGridRefs.current[initWeekId]?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 250);
    }
  };

  const fetchCandidates = async (weekId: string, grade: number, classNum: number, day: number, period: number, subjectName: string, currentCart: CartItem[] = cartItems) => {
    if (!weekId) { setCandidateError("주간(Week)을 선택해 주세요."); return; }
    setLoadingCandidates(true); setCandidateError(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setSelectedCandidate(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null); setSuccessMsg(null); setSubmitError(null);
    try {
      const pendingPayload = toPendingPayload(currentCart);
      const [res, subRes] = await Promise.all([
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "direct_candidates_all", weekId, source: { grade, classNum, day, period }, teacherEmail: selectedTeacherEmail, pendingItems: pendingPayload }),
        }),
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "direct_candidates", weekId, source: { grade, classNum, day, period } }),
        }),
      ]);
      const data = await res.json();
      const subData = await subRes.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSourceLessonInfo({ subjectName: data.sourceSubjectName || data.sourceTeacher?.subjectName || subjectName, teacherName: data.sourceTeacher?.teacherName || selectedTeacherName });
        setSwapCandidateWeeks(data.weeks || []);
        setSubstituteCandidates(subRes.ok && subData.success ? subData.substituteCandidates || [] : []);
      } else { setCandidateError(data.error || "후보를 탐색할 수 없습니다."); }
    } catch (err: any) { setCandidateError(`네트워크 오류: ${err.message}`); } finally { setLoadingCandidates(false); }
  };

  const fetchPreviewForCandidate = async (cand: any, srcSlot: typeof selectedSlot) => {
    if (!cand || !srcSlot || !cand.counterpartEmail) { setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null); return; }
    const email = cand.counterpartEmail;
    const srcWeekId = srcSlot.weekId;
    const tgtWeekId = cand.targetWeekId || srcWeekId;
    const isCross = srcWeekId !== tgtWeekId;
    setPreviewLoading(true);
    try {
      const fetchCellsForWeek = async (wId: string) => {
        const cacheKey = `${email}_${wId}`;
        if (previewCacheRef.current.has(cacheKey)) return previewCacheRef.current.get(cacheKey)!;
        const res = await fetch("/api/timetable/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "teacher", teacherEmail: email, weekId: wId }) });
        if (res.ok) { const data = await res.json(); const cells: TeacherTimetableCell[] = data.data?.cells || []; previewCacheRef.current.set(cacheKey, cells); return cells; }
        return [];
      };
      if (!isCross) { const cells = await fetchCellsForWeek(tgtWeekId); setPreviewCells(cells); setCounterpartSourceCells(null); setCounterpartTargetCells(null); }
      else { const [srcCells, tgtCells] = await Promise.all([fetchCellsForWeek(srcWeekId), fetchCellsForWeek(tgtWeekId)]); setPreviewCells(null); setCounterpartSourceCells(srcCells); setCounterpartTargetCells(tgtCells); }
    } catch {} finally { setPreviewLoading(false); }
  };

  const handleSelectCandidate = (cand: any, wId: string, startDate?: string) => {
    const candidateObj = { ...cand, targetWeekId: wId, targetWeekStartDate: startDate };
    setSelectedCandidate(candidateObj); setActiveCandidateType("swap"); setSubmitError(null);
    if (selectedSlot) fetchPreviewForCandidate(candidateObj, selectedSlot);
  };

  // §C-3: 징검다리 체인 탐색 실행
  const handleRunChainSearch = async (overrideDepth?: number) => {
    if (!chainSourceSlot || !chainTargetSlot) return;
    const depth = overrideDepth || chainMaxDepth || 2;
    setChainMaxDepth(depth);
    setChainSearchLoading(true);
    setChainSearchError(null);
    setChainResults([]);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chain_search",
          weekId: chainSourceSlot.weekId,
          source: {
            grade: chainSourceSlot.grade,
            classNum: chainSourceSlot.classNum,
            day: chainSourceSlot.day,
            period: chainSourceSlot.period,
          },
          chainTarget: {
            weekId: chainTargetSlot.weekId || chainSourceSlot.weekId,
            day: chainTargetSlot.day,
            period: chainTargetSlot.period,
          },
          chainMaxDepth: depth,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const chains = data.chains || [];
        setChainResults(chains);
        if (chains.length === 0) {
          const reasonText = data.reason ? ` (${data.reason})` : "";
          setChainSearchError(`${depth}단계 안에서는 경로(체인)가 없습니다.${reasonText}`);
        }
      } else {
        setChainSearchError(data.error || "체인 탐색 실패");
      }
    } catch (e: any) {
      setChainSearchError(`네트워크 오류: ${e.message}`);
    } finally {
      setChainSearchLoading(false);
    }
  };

  // §C-3: 선택한 체인 전체를 직권 담기 목록에 적재 (sourceTeacherEmail/Name 보존 필수)
  const handleAddChainToCart = (chain: any) => {
    if (!chain || !chain.steps || chain.steps.length === 0) return;

    const newItems: CartItem[] = chain.steps.map((step: any, idx: number) => ({
      id: `chain_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${idx}`,
      weekId: step.weekId,
      ...(step.targetWeekId ? { targetWeekId: step.targetWeekId } : {}),
      type: step.type || "swap",
      source: step.source,
      candidate: step.candidate,
      // ★ sourceTeacherEmail/Name 보존 ★
      sourceTeacherEmail: step.sourceTeacherEmail || selectedTeacherEmail,
      sourceTeacherName: step.sourceTeacherName || selectedTeacherName,
      counterpartEmail: step.candidate?.counterpartEmail,
      counterpartName: step.candidate?.counterpartName,
      counterpartSubjectName: step.candidate?.counterpartSubjectName,
    }));

    const updatedCart = [...cartItems, ...newItems];
    setCartItems(updatedCart);
    setSuccessMsg(`🔗 징검다리 체인 (${chain.steps.length}단계)이 담기 목록에 순서대로 추가되었습니다.`);
    setChainModalOpen(false);
    setChainSourceSlot(null); // 원본은 소진 — 다음 공강 클릭 시 깨끗한 선택 목록부터
    setChainTargetSlot(null);

    // 예상 시간표 갱신
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
    // 체인 담기는 하나의 작업 완료 — 이전 선택·후보판은 끝난 맥락이므로 재조회가 아니라 초기화한다.
    // (재조회로는 체인과 안 겹치는 후보가 유효하게 남아 배지가 잔존 — 2026-08-08 사용자 2회 지적)
    setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]);
    setSelectedCandidate(null); setCandidateError(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null);
  };

  const handleSlotClick = (
    weekId: string,
    cell?: TeacherTimetableCell | null,
    fallbackDay?: number,
    fallbackPeriod?: number
  ) => {
    const day = cell?.day ?? fallbackDay;
    const period = cell?.period ?? fallbackPeriod;
    if (!day || !period) return;

    // cell.subjectName 또는 cell.subjectShort 존재 여부 판단 (수업 있는 셀)
    const hasLesson = !!(cell && (cell.subjectName || cell.subjectShort));
    
    if (hasLesson && cell) {
      // 판정 단일 통로: 서버가 교사 그리드 응답에 실어 보낸 동시수업 라벨
      if (cell.simul) {
        alert(`여러 반이 함께 듣는 이동수업이라 교체할 수 없습니다.\n묶음: ${cell.simul}`);
        return;
      }

      const subj = cell.subjectShort || cell.subjectName || "수업";
      const grade = cell.grade || 1;
      const classNum = cell.classNum || 1;
      const slot = { weekId, grade, classNum, day, period };

      setSelectedSlot(slot);
      setSelectedWeekId(weekId);
      setSourceLessonInfo({ subjectName: subj, teacherName: selectedTeacherName });

      // 체인 원본 수업으로 자동 지정
      setChainSourceSlot({
        weekId,
        grade,
        classNum,
        day,
        period,
        subjectName: subj,
        teacherEmail: selectedTeacherEmail,
        teacherName: selectedTeacherName,
      });

      fetchCandidates(weekId, grade, classNum, day, period, subj);
    } else {
      // 순수 공강 셀 클릭 ➔ "이 자리에 수업 가져오기 (연쇄 이동 탐색 🔗)"
      // 이중 방어: 원본이 현재 선택 교사의 수업이 아니면 무효화 (묵은 원본으로 탐색 방지)
      if (chainSourceSlot && chainSourceSlot.teacherEmail.toLowerCase() !== selectedTeacherEmail.toLowerCase()) {
        setChainSourceSlot(null);
      }
      setChainTargetSlot({ weekId, day, period });
      setChainModalOpen(true);
      setChainSearchError(null);
      setChainResults([]);
    }
  };

  const handleAddToCart = () => {
    if (!selectedCandidate || !selectedSlot) { setSubmitError("담을 후보(맞교환 또는 특별보강)를 선택해 주세요."); return; }
    const isDuplicate = cartItems.some((ci) => ci.weekId === selectedSlot.weekId && ci.source.grade === selectedSlot.grade && ci.source.classNum === selectedSlot.classNum && ci.source.day === selectedSlot.day && ci.source.period === selectedSlot.period);
    if (isDuplicate) { setSubmitError("이미 담기 목록에 있는 수업입니다."); return; }
    if (cartItems.length >= 20) { setSubmitError("한 번에 최대 20건까지 담을 수 있습니다."); return; }
    const targetWId = activeCandidateType === "swap" ? (selectedCandidate as any).targetWeekId : undefined;
    const newItem: CartItem = {
      id: `cart_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      weekId: selectedSlot.weekId,
      ...(targetWId ? { targetWeekId: targetWId } : {}),
      type: activeCandidateType,
      source: { grade: selectedSlot.grade, classNum: selectedSlot.classNum, day: selectedSlot.day, period: selectedSlot.period, subjectName: sourceLessonInfo?.subjectName || "" },
      candidate: { ...(activeCandidateType === "swap" ? { targetWeekId: targetWId || selectedSlot.weekId, targetDay: (selectedCandidate as any).targetDay, targetPeriod: (selectedCandidate as any).targetPeriod, counterpartEmail: (selectedCandidate as any).counterpartEmail, counterpartName: (selectedCandidate as any).counterpartName, counterpartSubjectName: (selectedCandidate as any).counterpartSubjectName, score: (selectedCandidate as any).score, penalties: (selectedCandidate as any).penalties || [], coordination: (selectedCandidate as any).coordination } : { counterpartEmail: (selectedCandidate as SubstituteCandidate).teacherEmail, counterpartName: (selectedCandidate as SubstituteCandidate).teacherName, score: 0, penalties: [] }) },
      counterpartName: activeCandidateType === "swap" ? (selectedCandidate as any).counterpartName : (selectedCandidate as SubstituteCandidate).teacherName,
      counterpartSubjectName: activeCandidateType === "swap" ? (selectedCandidate as any).counterpartSubjectName : "보강",
      counterpartEmail: activeCandidateType === "swap" ? (selectedCandidate as any).counterpartEmail : (selectedCandidate as SubstituteCandidate).teacherEmail,
    };
    const updatedCart = [...cartItems, newItem]; setCartItems(updatedCart); setSelectedCandidate(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null); setSuccessMsg(`🛒 담기 완료! 목록에 추가되었습니다. (총 ${updatedCart.length}건)`);
    // 담기 후에는 아이들 상태로 — 같은 슬롯 재탐색은 서버가 그 항목을 자기 충돌 방지로 제외해
    // 담기 전과 동일한 결과(선택·후보 하이라이트 잔존)만 재현한다. 재탐색은 다음 셀 클릭 때 cart 반영으로 수행.
    setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setCandidateError(null); setChainSourceSlot(null);
    // 그리드를 "담긴 상태의 예상 시간표"로 갱신 — 담긴 수업이 옮겨간 자리에 가상 마킹으로 나타난다
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
  };

  const handleClearCart = () => {
    setCartItems([]);
    setSuccessMsg(null); setSubmitError(null); // 담기 완료 등 이전 메시지도 함께 정리
    // 전체 비우기 = 작업 처음부터 — 선택 셀·후보·미리보기·체인 상태까지 전부 초기화.
    // 선택을 유지한 채 후보만 재조회하면 비워진 뒤에도 선택 하이라이트·후보 배지가 잔존한다 (2026-08-08 실증)
    setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]);
    setSelectedCandidate(null); setCandidateError(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null);
    setChainSourceSlot(null); setChainTargetSlot(null); setChainModalOpen(false); setChainResults([]); setChainSearchError(null);
    // 가상 반영 그리드를 빈 cart 기준으로 되돌린다 — 상태만 비우면 "담김 이동" 셀이 화면에 잔존
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, []);
  };

  const handleRemoveFromCart = (id: string) => {
    const updatedCart = cartItems.filter((ci) => ci.id !== id);
    setCartItems(updatedCart);
    setSuccessMsg(null); setSubmitError(null); // 담기 완료 등 이전 메시지도 함께 정리
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
    if (selectedSlot) fetchCandidates(selectedSlot.weekId, selectedSlot.grade, selectedSlot.classNum, selectedSlot.day, selectedSlot.period, sourceLessonInfo?.subjectName || "", updatedCart);
  };

  // ── 담기 순 효과 접기 (net-fold) ──
  // 체인(§C)은 같은 수업이 여러 다리를 경유하므로, 다리별 나열은 경유 슬롯을 들어옴·빠짐으로
  // 이중 계상하고 제3 교사 수업을 선택 교사 명의로 오표기한다 (2026-08-08 실증: 최명수 카드).
  // 담기 순서(=반영 순서)대로 "전 항목"을 가상 적용해 수업별 (시작 → 최종) 위치만 남긴다 —
  // 부분 집합만 접으면 체인의 앞 단계가 빠져 상대 수업의 실제 위치가 어긋난다.
  type CartNetMove = {
    ownerName: string; ownerEmail?: string; grade: number; classNum: number; subjectName: string;
    from: { weekId: string; day: number; period: number };
    to: { weekId: string; day: number; period: number };
  };
  const foldCartNetMoves = (cart: CartItem[]): CartNetMove[] => {
    const swapItems = cart.filter((ci) => ci.type !== "substitute");
    const slotKey = (w: string, d: number, p: number) => `${w}|${d}|${p}`;
    type FoldLesson = CartNetMove & {
      initial: { weekId: string; day: number; period: number };
      current: { weekId: string; day: number; period: number };
    };
    const foldLessons: Array<Omit<FoldLesson, "from" | "to">> = [];
    const occupant = new Map<string, number>(); // slotKey → foldLessons index
    const ensureLesson = (
      w: string, d: number, p: number,
      seed: { ownerName: string; ownerEmail?: string; grade: number; classNum: number; subjectName: string }
    ): number => {
      const k = slotKey(w, d, p);
      const found = occupant.get(k);
      if (found !== undefined) return found;
      foldLessons.push({ ...seed, initial: { weekId: w, day: d, period: p }, current: { weekId: w, day: d, period: p } });
      occupant.set(k, foldLessons.length - 1);
      return foldLessons.length - 1;
    };
    for (const item of swapItems) {
      if (!item.candidate.targetDay || !item.candidate.targetPeriod) continue;
      const sW = item.weekId, tW = item.targetWeekId || item.weekId;
      // 맞교환은 같은 반 안에서 성립 — source의 반이 곧 상대 수업의 반
      const a = ensureLesson(sW, item.source.day, item.source.period, {
        ownerName: item.sourceTeacherName || selectedTeacherName || "담당 교사",
        ownerEmail: (item.sourceTeacherEmail || selectedTeacherEmail || "").toLowerCase() || undefined,
        grade: item.source.grade, classNum: item.source.classNum, subjectName: item.source.subjectName,
      });
      const b = ensureLesson(tW, item.candidate.targetDay, item.candidate.targetPeriod, {
        ownerName: item.counterpartName || "상대 교사",
        ownerEmail: item.counterpartEmail?.toLowerCase(),
        grade: item.source.grade, classNum: item.source.classNum, subjectName: item.counterpartSubjectName || "수업",
      });
      const slotA = { ...foldLessons[a].current };
      const slotB = { ...foldLessons[b].current };
      foldLessons[a].current = slotB;
      foldLessons[b].current = slotA;
      occupant.set(slotKey(slotA.weekId, slotA.day, slotA.period), b);
      occupant.set(slotKey(slotB.weekId, slotB.day, slotB.period), a);
    }
    return foldLessons
      .filter((l) => slotKey(l.initial.weekId, l.initial.day, l.initial.period) !== slotKey(l.current.weekId, l.current.day, l.current.period))
      .map((l) => ({
        ownerName: l.ownerName, ownerEmail: l.ownerEmail,
        grade: l.grade, classNum: l.classNum, subjectName: l.subjectName,
        from: l.initial, to: l.current,
      }));
  };

  // 선택 교사 본인 수업의 순 이동 — 그리드 "담김(이동됨)" 마커용. 다리별 source 슬롯 기준으로
  // 마킹하면 체인 경유지(본인 수업이 스쳐간 자리)에도 마커가 붙는다 (2026-08-08 사용자 실증: 월7)
  const myCartNetMoves = foldCartNetMoves(cartItems).filter(
    (m) => !!m.ownerEmail && m.ownerEmail === selectedTeacherEmail.toLowerCase()
  );

  // 양해 대상 = 담기로 시간표가 실제 바뀌는 모든 교사 (선택 교사 제외) — 맞교환 상대뿐 아니라
  // 체인이 움직인 제3 교사(수업 소유자)도 양해가 필요하다 (2026-08-08 사용자 지적: 김지현 국어 사례)
  const affectedTeachers: Array<{ email: string; name: string; count: number }> = (() => {
    const map = new Map<string, { name: string; count: number }>();
    const sel = selectedTeacherEmail.toLowerCase();
    for (const m of foldCartNetMoves(cartItems)) {
      if (!m.ownerEmail || m.ownerEmail === sel) continue;
      const cur = map.get(m.ownerEmail) || { name: m.ownerName, count: 0 };
      cur.count += 1;
      map.set(m.ownerEmail, cur);
    }
    for (const ci of cartItems) {
      if (ci.type !== "substitute" || !ci.counterpartEmail) continue;
      const email = ci.counterpartEmail.toLowerCase();
      if (email === sel) continue;
      const cur = map.get(email) || { name: ci.counterpartName || email.split("@")[0], count: 0 };
      cur.count += 1;
      map.set(email, cur);
    }
    return Array.from(map, ([email, v]) => ({ email, ...v }));
  })();

  const handleGenerateConsolidatedCard = async (teacherEmail: string) => {
    const email = teacherEmail.toLowerCase();
    // 보강은 수신자가 상대(받는 사람)인 항목만, 교환은 전 담기를 접은 뒤 소유 기준으로 본인/맥락 분리
    const subItems = cartItems.filter((ci) => ci.type === "substitute" && ci.counterpartEmail?.toLowerCase() === email);
    const swapItemCount = cartItems.filter((ci) => ci.type !== "substitute").length;
    const netMoves: NonNullable<ConsolidatedShareData["netMoves"]> = foldCartNetMoves(cartItems)
      .map((m) => ({
        ownerName: m.ownerName, isRecipient: m.ownerEmail === email,
        grade: m.grade, classNum: m.classNum, subjectName: m.subjectName, from: m.from, to: m.to,
      }))
      .sort((x, y) => (y.isRecipient ? 1 : 0) - (x.isRecipient ? 1 : 0));
    const recipientMoves = netMoves.filter((m) => m.isRecipient);
    if (recipientMoves.length === 0 && subItems.length === 0) return;
    setGeneratingShareFor(teacherEmail);
    try {
      const counterpartName =
        affectedTeachers.find((t) => t.email === email)?.name ||
        cartItems.find((ci) => ci.counterpartEmail?.toLowerCase() === email)?.counterpartName ||
        "선생님";

      // 그리드 주간: 수신자 본인 시간표가 바뀌는 주만
      const weekIds = Array.from(new Set([
        ...recipientMoves.flatMap((m) => [m.from.weekId, m.to.weekId]),
        ...subItems.flatMap((item) => [item.weekId, item.targetWeekId].filter(Boolean) as string[]),
      ]));
      const weekBlocks = await Promise.all(weekIds.map(async (wId) => {
        const wObj = weeks.find((w) => w.id === wId);
        const cacheKey = `${email}_${wId}`;
        let cells: TeacherTimetableCell[] = [];
        if (previewCacheRef.current.has(cacheKey)) cells = previewCacheRef.current.get(cacheKey)!;
        else {
          const res = await fetch("/api/timetable/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "teacher", teacherEmail: email, weekId: wId }) });
          if (res.ok) { const data = await res.json(); cells = data.data?.cells || []; previewCacheRef.current.set(cacheKey, cells); }
        }
        const markers: ConsolidatedShareData["weekBlocks"][number]["markers"] = [];
        // 보강: 요청측 수업이 상대 시간표로 들어옴 (넘겨받는 수업이므로 요청측 과목 라벨이 맞다)
        subItems.forEach((item) => {
          if (wId === item.weekId) markers.push({ day: item.source.day, period: item.source.period, kind: "in", label: `${item.source.grade}-${item.source.classNum}반 ${item.source.subjectName}` });
        });
        // 교환: 수신자 본인 수업의 순 이동만 마킹 — 경유 슬롯은 접혀서 마커 없음.
        // 들어옴 라벨은 본인 수업 과목(체인 이전엔 요청측 과목으로 오표기되던 결함 함께 교정)
        (netMoves || []).filter((m) => m.isRecipient).forEach((m) => {
          if (m.from.weekId === wId) markers.push({ day: m.from.day, period: m.from.period, kind: "out", label: `${m.grade}-${m.classNum}` });
          if (m.to.weekId === wId) markers.push({ day: m.to.day, period: m.to.period, kind: "in", label: `${m.grade}-${m.classNum}반 ${m.subjectName}` });
        });
        return { weekId: wId, startDate: wObj?.startDate || wId, cells, markers };
      }));
      // 양해를 구하는 주체는 화면을 조작 중인 일과계/어드민 본인 — 수업 당사자(선택 교사) 명의가 아니다 (2026-08-06 사용자 확정).
      // 교환 목록의 수업 소유자 표기는 선택 교사 이름으로 명시해 "제 수업"으로 오독되지 않게 한다.
      // GWS 이름 우선 + 굳어진 로컬부 가드 (§11-7). 이 이름은 상대 교사에게 가는 공유 카드에
      // "○○○입니다"로 찍히므로, 실명이 안 나오면 이메일 아이디 대신 직함 폴백을 쓴다.
      const resolvedOperator = user?.email
        ? resolveDisplayName(user.email, teacherProfile ?? undefined, user.displayName ?? undefined).name
        : "";
      const operatorName =
        resolvedOperator && !isFrozenLocalPartName(resolvedOperator, user?.email || "")
          ? resolvedOperator
          : "일과 담당자";
      const shareData: ConsolidatedShareData = {
        requesterName: operatorName,
        senderLabel: operatorName, // 직책 없이 이름만 — "○○○입니다" (2026-08-06 사용자 확정: "일과계" 표기도 제외)
        ownerLabel: selectedTeacherName ? `${selectedTeacherName} 선생님의` : "해당",
        counterpartName,
        // netMoves 경로: items는 보강만 전달 — 교환은 netMoves가 렌더를 대체한다
        items: subItems.map((ci) => ({ id: ci.id, type: ci.type, sourceWeekId: ci.weekId, targetWeekId: ci.targetWeekId, source: ci.source, candidate: ci.candidate })),
        netMoves,
        swapStepCount: swapItemCount,
        // 교환 담기의 특별실 겹침은 netMoves로 접히며 사라지므로 요약을 직접 동봉 (§3-2d 후속 3)
        coordinationConflicts: (() => {
          const conflicts = cartItems
            .filter((ci) => ci.type !== "substitute")
            .flatMap((ci) => ci.candidate?.coordination?.conflicts || []);
          return conflicts.length > 0 ? conflicts : undefined;
        })(),
        weekBlocks,
        periodsPerDay: 7,
      };
      setConsolidatedShareData(shareData);
      setTimeout(() => { copyShareImageElement(consolidatedCardRef.current).finally(() => setGeneratingShareFor(null)); }, 100);
    } catch (err: any) { alert(`양해 이미지 생성 실패: ${err.message}`); setGeneratingShareFor(null); }
  };

  const [cartBatchModalOpen, setCartBatchModalOpen] = useState(false);
  const [cartBatchConsentConfirmed, setCartBatchConsentConfirmed] = useState(false);
  const [cartBatchConsentNote, setCartBatchConsentNote] = useState("");

  const executeBatchCommit = async (consentNoteInput?: string) => {
    setSubmitting(true); setSubmitError(null);
    try {
      const payload = {
        action: "direct_commit_batch",
        items: cartItems.map((item) => ({
          weekId: item.weekId,
          ...(item.targetWeekId ? { targetWeekId: item.targetWeekId } : {}),
          type: item.type,
          source: item.source,
          candidate: item.candidate,
          reason: { type: reasonType, note: reasonNote.trim() || undefined },
          consent: item.candidate?.coordination
            ? { confirmed: true, note: consentNoteInput || undefined }
            : undefined,
        })),
        reason: { type: reasonType, note: reasonNote.trim() || undefined },
      };
      const res = await fetch("/api/timetable/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "일괄 반영 처리 중 오류가 발생했습니다.");
      const results: DirectCommitBatchItemResult[] = data.results || [];
      const successIndices = new Set(results.filter((r) => r.ok).map((r) => r.index));
      const remainingCart = cartItems
        .map((item, origIdx) => ({ item, origIdx }))
        .filter(({ origIdx }) => !successIndices.has(origIdx))
        .map(({ item, origIdx }) => ({ ...item, lastError: results.find((r) => r.index === origIdx)?.error || "반영 실패" }));
      setCartItems(remainingCart);
      const successCount = successIndices.size;
      const failCount = results.length - successCount;
      setSuccessMsg(`⚡ 일괄 반영 완료! (성공 ${successCount}건${failCount > 0 ? `, 실패 ${failCount}건` : ""})`);
      const affectedWeeks = Array.from(new Set(cartItems.filter((_, idx) => successIndices.has(idx)).flatMap((item) => [item.weekId, item.targetWeekId].filter(Boolean) as string[])));
      setRecentlyUpdatedWeeks(affectedWeeks);
      setCartBatchModalOpen(false);
      if (selectedTeacherEmail) await fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, remainingCart);
    } catch (err: any) { setSubmitError(err.message || "일괄 반영 실패"); } finally { setSubmitting(false); }
  };

  const handleBatchCommit = async () => {
    if (cartItems.length === 0) { setSubmitError("담긴 항목이 없습니다."); return; }
    if (reasonType === "기타" && !reasonNote.trim()) { setSubmitError("사유가 '기타'인 경우 상세 메모를 입력해 주세요."); return; }

    const hasCoordination = cartItems.some((item) => !!item.candidate?.coordination);
    if (hasCoordination) {
      setCartBatchModalOpen(true);
      setCartBatchConsentConfirmed(false);
      setCartBatchConsentNote("");
      return;
    }

    if (!confirm(`담긴 ${cartItems.length}건의 직권 배정/수업교환을 승인 및 일괄 반영하시겠습니까?`)) return;
    executeBatchCommit();
  };

  // §3-2b v1.1: 조율 필요 후보 관련 상태
  const [pendingCoordinationSelect, setPendingCoordinationSelect] = useState<{ candidate: any; weekId: string; startDate?: string } | null>(null);
  const [singleCommitConsentModalOpen, setSingleCommitConsentModalOpen] = useState(false);
  const [singleCommitConsentConfirmed, setSingleCommitConsentConfirmed] = useState(false);
  const [singleCommitConsentNote, setSingleCommitConsentNote] = useState("");

  const executeDirectCommitSingle = async (consentNoteInput?: string) => {
    if (!selectedCandidate || !selectedSlot) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const sourceWeekId = selectedSlot.weekId;
      const targetWeekId = activeCandidateType === "swap" ? (selectedCandidate as any)?.targetWeekId : undefined;
      const isCoordination = activeCandidateType === "swap" && !!(selectedCandidate as any)?.coordination;
      let candidateSnapshot: any;
      if (activeCandidateType === "swap") {
        const sc = selectedCandidate as any;
        candidateSnapshot = { targetWeekId: targetWeekId || sourceWeekId, targetDay: sc.targetDay, targetPeriod: sc.targetPeriod, counterpartEmail: sc.counterpartEmail, counterpartName: sc.counterpartName, counterpartSubjectName: sc.counterpartSubjectName, score: sc.score, penalties: sc.penalties || [], coordination: sc.coordination };
      } else {
        const subc = selectedCandidate as SubstituteCandidate;
        candidateSnapshot = { counterpartEmail: subc.teacherEmail, counterpartName: subc.teacherName, score: 0, penalties: [] };
      }
      const commitRes = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_commit",
          weekId: sourceWeekId,
          ...(activeCandidateType === "swap" && targetWeekId ? { targetWeekId } : {}),
          type: activeCandidateType,
          source: { grade: selectedSlot.grade, classNum: selectedSlot.classNum, day: selectedSlot.day, period: selectedSlot.period, subjectName: sourceLessonInfo?.subjectName || "" },
          candidate: candidateSnapshot,
          reason: { type: reasonType, note: reasonNote.trim() || undefined },
          consent: isCoordination ? { confirmed: true, note: consentNoteInput || undefined } : undefined,
        }),
      });
      const commitData = await commitRes.json();
      if (!commitRes.ok || !commitData.success) throw new Error(commitData.error || "직권 배정 처리 중 오류가 발생했습니다.");
      setSuccessMsg(`⚡ 직권 배정 완료! ${selectedSlot.grade}학년 ${selectedSlot.classNum}반 ${formatSlotWithDate(sourceWeekId, selectedSlot.day, selectedSlot.period)} 수업이 성공적으로 처리 및 반영되었습니다.`);
      const updatedWeeks = [sourceWeekId, targetWeekId].filter((wId): wId is string => Boolean(wId));
      setRecentlyUpdatedWeeks(updatedWeeks);
      setSelectedCandidate(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null); setChainSourceSlot(null);
      setSingleCommitConsentModalOpen(false);
      if (selectedTeacherEmail) await fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks);
    } catch (err: any) { setSubmitError(err.message || "직권 배정 실패"); } finally { setSubmitting(false); }
  };

  const handleDirectCommitSingle = async () => {
    if (!selectedCandidate || !selectedSlot) { setSubmitError("배정할 후보(맞교환 또는 특별보강)를 선택해 주세요."); return; }
    if (reasonType === "기타" && !reasonNote.trim()) { setSubmitError("사유가 '기타'인 경우 상세 메모를 입력해 주세요."); return; }
    const isCoordination = activeCandidateType === "swap" && !!(selectedCandidate as any)?.coordination;
    
    // §3-2b ③: 조율 필요 후보 직권 단건 즉시 반영 시 양해 확인 다이얼로그로 이동
    if (isCoordination) {
      setSingleCommitConsentConfirmed(false);
      setSingleCommitConsentNote("");
      setSingleCommitConsentModalOpen(true);
      return;
    }

    if (!confirm("선택한 후보로 직권 수업교환/특별보강을 즉시 승인 및 적용하시겠습니까?")) return;
    executeDirectCommitSingle();
  };

  const getCellForSlotInWeek = (wId: string, d: number, p: number) => { const cells = teacherWeekCellsMap[wId] || []; return cells.filter((c) => c.day === d && c.period === p); };
  const DAYS = [{ num: 1, label: "월요일" }, { num: 2, label: "화요일" }, { num: 3, label: "수요일" }, { num: 4, label: "목요일" }, { num: 5, label: "금요일" }];

  const sourceWeekObj = weeks.find((w) => w.id === selectedSlot?.weekId);
  const targetWeekId = selectedCandidate?.targetWeekId || selectedSlot?.weekId || "";
  const targetWeekObj = weeks.find((w) => w.id === targetWeekId);
  const isCrossWeek = !!(targetWeekId && selectedSlot?.weekId && targetWeekId !== selectedSlot.weekId);

  const currentSimulGroup = simulGroups.find((g) => g.id === selectedSimulGroupId);
  const cleanSimulCandidates = simulCandidates.filter((c) => !c.coordination);
  const coordinationSimulCandidates = simulCandidates.filter((c) => !!c.coordination);

  const modalGroupTeachers = Array.from(
    new Set(
      (selectedCandidateForModal?.steps || [])
        .map((s) => s.groupLesson?.teacherName)
        .filter(Boolean)
    )
  );
  const modalCounterpartTeachers = Array.from(
    new Set(
      (selectedCandidateForModal?.steps || [])
        .map((s) => s.counterpart?.teacherName)
        .filter(Boolean) as string[]
    )
  );
  const modalOccupantTeachers = selectedCandidateForModal?.coordination
    ? getCoordinationOccupants(selectedCandidateForModal.coordination).map((o) => o.teacherName)
    : [];
  const modalAllParties = Array.from(
    new Set([...modalGroupTeachers, ...modalCounterpartTeachers, ...modalOccupantTeachers])
  );

  return (
    <div className="space-y-6">
      <OffscreenConsolidatedShareCard cardRef={consolidatedCardRef} data={consolidatedShareData} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>⚡</span>
            <span>일과계 직권 배정</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {directMode === "teacher"
              ? "교사를 선택하면 그 교사의 모든 주 시간표가 함께 표시됩니다. 수업을 고르고 후보를 선택해 여러 건을 [담기]로 모은 뒤 한 번에 반영할 수 있으며, 상대 선생님께 보낼 양해 이미지도 만들 수 있습니다."
              : "동시수업(분반 이동수업) 그룹의 수업을 다른 요일·교시로 통째로 이동합니다. 묶인 모든 반의 이동 내역 및 상대 교사/장소 양해를 한 번에 확인하고 반영합니다."}
          </p>
        </div>

        {/* 모드 전환 탭 */}
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setDirectMode("teacher")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              directMode === "teacher"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <span>👤</span>
            <span>교사별 직권 배정</span>
          </button>
          <button
            type="button"
            onClick={() => setDirectMode("simul_move")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              directMode === "simul_move"
                ? "bg-purple-700 text-white shadow-xs ring-2 ring-purple-300"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <span>🔀</span>
            <span>이동수업 통 이동</span>
            <span className="text-[10px] bg-purple-200 text-purple-950 px-1.5 py-0.2 rounded-full font-black">
              묶음 이동
            </span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>✅ {successMsg}</span>
          {recentlyUpdatedWeeks.length > 0 && <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-extrabold">✨ 변경된 주간 그리드 재조회 완료</span>}
        </div>
      )}
      {submitError && <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">⚠️ {submitError}</div>}

      {directMode === "simul_move" ? (
        /* 🔀 이동수업 통 이동 화면 */
        <div className="space-y-6">
          {/* 상단 컨트롤: 주간 선택 + 이동수업 그룹 선택 + 그룹 정보 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">📅 대상 주간 선택</label>
                <select
                  value={selectedSimulWeekId}
                  onChange={(e) => setSelectedSimulWeekId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white text-xs"
                >
                  {weeks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.startDate} 주간 {w.note ? `(${w.note})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">🔀 이동수업 그룹 선택</label>
                <select
                  value={selectedSimulGroupId}
                  onChange={(e) => setSelectedSimulGroupId(e.target.value)}
                  disabled={simulGroupsLoading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white text-xs disabled:opacity-60"
                >
                  {simulGroupsLoading && <option value="">이동수업 그룹 불러오는 중...</option>}
                  {!simulGroupsLoading && simulGroups.length === 0 && (
                    <option value="">등록된 활성 이동수업 그룹이 없습니다.</option>
                  )}
                  {!simulGroupsLoading &&
                    simulGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        [{g.grade}학년] {g.label} ({g.classNums?.join("·")}반)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {currentSimulGroup && (
              <div className="p-4 bg-purple-50/70 border border-purple-200 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-200 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-purple-200 text-purple-900">
                      {currentSimulGroup.grade}학년
                    </span>
                    <strong className="text-sm text-purple-950">{currentSimulGroup.label}</strong>
                    <span className="text-xs text-purple-800 font-medium">
                      (대상: {currentSimulGroup.classNums?.map((c) => `${c}반`).join(", ")})
                    </span>
                  </div>
                  <div className="text-xs text-purple-900 font-semibold">
                    과목: {currentSimulGroup.subjectNames?.join(", ")}
                  </div>
                </div>

                {/* 현재 등록 슬롯 */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-bold text-purple-950 shrink-0">📍 이동할 원본 교시 선택:</span>
                  {simulGroupSlots.length > 0 ? (
                    simulGroupSlots.map((slot, sIdx) => {
                      const isSelected =
                        selectedSimulSourceSlot?.day === slot.day &&
                        selectedSimulSourceSlot?.period === slot.period;
                      return (
                        <button
                          key={sIdx}
                          type="button"
                          onClick={() => handleSelectSimulSourceSlot(slot)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                            isSelected
                              ? "bg-purple-800 text-white shadow-xs ring-2 ring-purple-300 scale-105"
                              : "bg-white text-purple-900 border border-purple-200 hover:bg-purple-100"
                          }`}
                        >
                          <span>{isSelected ? "📌" : "⏰"}</span>
                          <span>
                            {DAY_LABEL[slot.day]}요일 {slot.period}교시
                          </span>
                          {isSelected && (
                            <span className="text-[10px] ml-0.5 bg-purple-950 px-1 py-0.2 rounded font-black">
                              선택됨
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-xs text-gray-500">
                      이 주간의 시간표에서 슬롯을 조회하는 중입니다...
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 에러 메시지 표출 */}
          {simulCandidateError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-xl text-xs font-bold flex items-center gap-2">
              <span>⚠️</span>
              <span>{simulCandidateError}</span>
            </div>
          )}

          {/* 그리드 & 후보 목록 */}
          {currentSimulGroup && selectedSimulSourceSlot ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* 좌측 그리드 (lg:col-span-8) */}
              <div className="lg:col-span-8 space-y-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-purple-950 flex items-center gap-2">
                      <span>🗓️</span>
                      <span>
                        {selectedSimulWeekId} 주간 이동 가능 교시 배치도 (
                        {DAY_LABEL[selectedSimulSourceSlot.day]}요일 {selectedSimulSourceSlot.period}교시 이동)
                      </span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      초록색(이동 가능) 또는 빨간색(양해 필수) 셀을 클릭하면 반별 전개 내역을 확인하고 통 이동을 실행할 수 있습니다.
                    </p>
                  </div>
                  {loadingSimulCandidates && (
                    <span className="text-xs text-purple-600 font-semibold animate-pulse">
                      후보 탐색 중...
                    </span>
                  )}
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-purple-950 text-white font-bold">
                          <th className="py-2.5 px-2 border-b border-r border-purple-800 w-14 text-center">교시</th>
                          {DAYS.map((d) => (
                            <th key={d.num} className="py-2.5 px-2 border-b border-purple-800 text-center">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {Array.from({ length: 7 }).map((_, pIdx) => {
                          const period = pIdx + 1;
                          return (
                            <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                              <td className="py-3 px-2 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50">
                                {period}교시
                              </td>
                              {DAYS.map((d) => {
                                const isSource =
                                  selectedSimulSourceSlot.day === d.num &&
                                  selectedSimulSourceSlot.period === period;
                                const isOtherGroupSlot =
                                  !isSource &&
                                  simulGroupSlots.some(
                                    (s) => s.day === d.num && s.period === period
                                  );
                                const cand = simulCandidates.find(
                                  (c) => c.targetDay === d.num && c.targetPeriod === period
                                );

                                return (
                                  <td
                                    key={d.num}
                                    className={`p-1.5 border-r border-gray-100 text-center align-top transition-all ${
                                      isSource
                                        ? "bg-purple-100/70"
                                        : isOtherGroupSlot
                                        ? "bg-purple-50/40"
                                        : cand
                                        ? cand.coordination
                                          ? "bg-red-50/70"
                                          : "bg-emerald-50/50"
                                        : ""
                                    }`}
                                  >
                                    {isSource ? (
                                      <div className="w-full p-2 rounded-xl text-left bg-indigo-600 border-2 border-indigo-700 text-white shadow-md">
                                        <div className="font-black text-xs">📌 이동 대상</div>
                                        <div className="text-[10px] text-indigo-100 mt-0.5 truncate">
                                          {currentSimulGroup.label}
                                        </div>
                                        <div className="text-[9px] bg-indigo-800 text-indigo-200 font-extrabold px-1 rounded mt-1 inline-block">
                                          현재 위치
                                        </div>
                                      </div>
                                    ) : isOtherGroupSlot ? (
                                      <button
                                        type="button"
                                        onClick={() => handleSelectSimulSourceSlot({ day: d.num, period })}
                                        className="w-full p-2 rounded-xl text-left bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-950 cursor-pointer transition-all shadow-2xs"
                                        title="클릭 시 이 교시를 이동할 원본 수업으로 선택합니다"
                                      >
                                        <div className="font-extrabold text-[11px] text-purple-900">
                                          🔀 현재 수업 슬롯
                                        </div>
                                        <div className="text-[9px] text-purple-600 font-semibold mt-0.5">
                                          클릭하여 선택
                                        </div>
                                      </button>
                                    ) : cand ? (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenSimulCandidateModal(cand)}
                                        className={`w-full p-2 rounded-xl text-left cursor-pointer transition-all border ${
                                          cand.coordination
                                            ? "bg-red-50 hover:bg-red-100/90 border-2 border-red-500 text-red-950 shadow-xs"
                                            : "bg-emerald-50 hover:bg-emerald-100/90 border-2 border-emerald-400 text-emerald-950 shadow-2xs"
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-black text-[11px] truncate flex items-center gap-0.5">
                                            {cand.coordination && <span>⚠️</span>}
                                            <span>이동 가능</span>
                                          </span>
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold shrink-0 ${
                                              cand.coordination
                                                ? "bg-red-200 text-red-950 border border-red-400 font-black"
                                                : cand.score > 0
                                                ? "bg-amber-100 text-amber-900 border border-amber-300"
                                                : "bg-emerald-200 text-emerald-900"
                                            }`}
                                          >
                                            {cand.coordination
                                              ? "⚠️ 양해 필수"
                                              : cand.score > 0
                                              ? `감점 ${cand.score}`
                                              : "0점"}
                                          </span>
                                        </div>
                                        <div
                                          className={`text-[10px] mt-0.5 font-bold truncate ${
                                            cand.coordination ? "text-red-900" : "text-emerald-800"
                                          }`}
                                        >
                                          {cand.steps.filter((s) => s.kind === "swap").length}개 반 맞교환 ·{" "}
                                          {cand.steps.filter((s) => s.kind === "move").length}개 반 이동
                                        </div>
                                      </button>
                                    ) : (
                                      <div className="text-gray-300 text-xs font-semibold text-center py-3 select-none">
                                        -
                                      </div>
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
              </div>

              {/* 우측 후보 목록 (lg:col-span-4) */}
              <div className="lg:col-span-4 space-y-4 sticky top-4">
                <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>📋 이동 가능 후보 ({simulCandidates.length}건)</span>
                    </h3>
                  </div>

                  {loadingSimulCandidates ? (
                    <div className="py-8 text-center text-xs text-purple-600 font-semibold animate-pulse">
                      이동 가능한 교시를 계산 중입니다...
                    </div>
                  ) : simulCandidates.length === 0 ? (
                    <div className="p-6 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs text-gray-500 space-y-1">
                      <p className="font-bold text-gray-700">이동 가능한 교시가 없습니다.</p>
                      <p className="text-[11px] text-gray-400">
                        담당 교사들의 공강 및 상대 수업 이동 조건이 충족되는 시간이 없습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[calc(100vh-20rem)] overflow-y-auto pr-1">
                      {cleanSimulCandidates.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] font-bold text-emerald-800 flex items-center justify-between">
                            <span>✨ 바로 이동 가능 ({cleanSimulCandidates.length}건)</span>
                          </div>
                          <div className="space-y-1.5">
                            {cleanSimulCandidates.map((cand, cIdx) => (
                              <button
                                key={cIdx}
                                type="button"
                                onClick={() => handleOpenSimulCandidateModal(cand)}
                                className="w-full p-3 bg-emerald-50/60 hover:bg-emerald-100/80 border border-emerald-300 rounded-xl text-left transition-all space-y-1 cursor-pointer shadow-2xs group"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-extrabold text-xs text-emerald-950">
                                    {DAY_LABEL[cand.targetDay]}요일 {cand.targetPeriod}교시
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      cand.score > 0
                                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                                        : "bg-emerald-200 text-emerald-900"
                                    }`}
                                  >
                                    {cand.score > 0 ? `감점 ${cand.score}점` : "0점 (최적)"}
                                  </span>
                                </div>
                                <div className="text-[11px] text-emerald-900 font-medium">
                                  {cand.steps.filter((s) => s.kind === "swap").length}개 반 맞교환 ·{" "}
                                  {cand.steps.filter((s) => s.kind === "move").length}개 반 단순 이동
                                </div>
                                {cand.warnings && cand.warnings.length > 0 && (
                                  <div className="text-[10px] text-amber-800 font-semibold bg-amber-50 rounded p-1 border border-amber-200">
                                    ⚠️ {cand.warnings[0]}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {coordinationSimulCandidates.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-gray-100">
                          <div className="text-[11px] font-bold text-red-800 flex items-center justify-between">
                            <span>⚠️ 양해 필요 후보 ({coordinationSimulCandidates.length}건)</span>
                          </div>
                          <div className="space-y-1.5">
                            {coordinationSimulCandidates.map((cand, cIdx) => (
                              <button
                                key={cIdx}
                                type="button"
                                onClick={() => handleOpenSimulCandidateModal(cand)}
                                className="w-full p-3 bg-red-50/60 hover:bg-red-100/80 border border-red-300 rounded-xl text-left transition-all space-y-1 cursor-pointer shadow-2xs group"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-extrabold text-xs text-red-950 flex items-center gap-1">
                                    <span>⚠️</span>
                                    <span>
                                      {DAY_LABEL[cand.targetDay]}요일 {cand.targetPeriod}교시
                                    </span>
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-red-200 text-red-950 border border-red-400">
                                    양해 필수
                                  </span>
                                </div>
                                <div className="text-[10px] text-red-900 font-semibold leading-relaxed">
                                  {formatCoordinationText(cand.coordination)}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 space-y-2">
              <span className="text-3xl">👈</span>
              <p className="font-bold text-gray-800 text-sm">
                이동수업 그룹 및 원본 교시를 선택해 주세요.
              </p>
              <p className="text-xs text-gray-400">
                그룹과 원본 교시를 선택하면 이동 가능한 모든 시간대가 그리드에 하이라이트됩니다.
              </p>
            </div>
          )}

          {/* 🔀 통 이동 확인 및 사전 양해 다이얼로그 */}
          {selectedCandidateForModal && currentSimulGroup && selectedSimulSourceSlot && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl border border-purple-200 max-w-2xl w-full max-h-[90vh] flex flex-col p-6 space-y-4 animate-scale-up">
                {/* 헤더 */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 shrink-0">
                  <div>
                    <h4 className="text-base font-extrabold text-purple-950 flex items-center gap-2">
                      <span>🔀</span>
                      <span>이동수업 통 이동 확인 및 반영</span>
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      묶인 전 학급의 수업 이동 및 상대 교사/특별실 양해 사항을 최종 확인합니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCandidateForModal(null)}
                    className="text-gray-400 hover:text-gray-600 text-lg font-black cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="overflow-y-auto space-y-4 pr-1 shrink">
                  {/* 이동 요약 카드 */}
                  <div className="bg-purple-50/80 border border-purple-200 rounded-xl p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-purple-950 text-sm">
                        [{currentSimulGroup.grade}학년] {currentSimulGroup.label}
                      </span>
                      <span className="px-2 py-0.5 rounded font-extrabold bg-purple-200 text-purple-900">
                        {currentSimulGroup.classNums?.join("·")}반 ({currentSimulGroup.classNums?.length}개 반)
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm font-black text-indigo-950 pt-1">
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-purple-200">
                        {DAY_LABEL[selectedSimulSourceSlot.day]}요일 {selectedSimulSourceSlot.period}교시
                      </span>
                      <span>➔</span>
                      <span className="bg-white px-2.5 py-1 rounded-lg border border-purple-200 text-purple-900">
                        {DAY_LABEL[selectedCandidateForModal.targetDay]}요일 {selectedCandidateForModal.targetPeriod}교시
                      </span>
                    </div>

                    {/* 감점 사유 */}
                    {selectedCandidateForModal.score > 0 ? (
                      <div className="pt-2 border-t border-purple-200 text-amber-900 space-y-0.5 font-semibold">
                        <div>⚠️ 시간표 감점: {selectedCandidateForModal.score}점</div>
                        <ul className="list-disc list-inside text-[11px] text-amber-800">
                          {selectedCandidateForModal.penalties.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="pt-1 text-emerald-800 font-bold text-[11px]">
                        ✨ 시간표 감점 없음 (0점)
                      </div>
                    )}
                  </div>

                  {/* 연속시수 등 주의사항 */}
                  {selectedCandidateForModal.warnings && selectedCandidateForModal.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 space-y-1.5 text-xs text-amber-950">
                      <div className="font-extrabold flex items-center gap-1">
                        <span>⚠️</span>
                        <span>주의 사항 (연속 수업 확인)</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 font-semibold text-amber-900">
                        {selectedCandidateForModal.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 특별실(장소) 조율 필요 사항 */}
                  {selectedCandidateForModal.coordination && (
                    <div className="bg-red-50 border-2 border-red-500 rounded-xl p-3.5 space-y-2 text-xs text-red-950">
                      <div className="font-extrabold flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <span>⚠️</span>
                          <span>특별실(장소) 조율 필요</span>
                        </span>
                        <span className="text-[10px] bg-red-200 text-red-950 border border-red-400 px-2 py-0.5 rounded font-black">
                          ⚠️ 양해 필수
                        </span>
                      </div>
                      <div className="font-semibold leading-relaxed">
                        {formatCoordinationText(selectedCandidateForModal.coordination)}
                      </div>
                      <div className="pt-2 border-t border-red-200 text-gray-800">
                        <span className="font-bold">👥 양해 필요 당사자: </span>
                        <span className="font-extrabold text-red-900">
                          {getCoordinationOccupants(selectedCandidateForModal.coordination)
                            .map((o) => `${o.teacherName} 선생님(${o.grade}-${o.classNum}반 ${o.subjectName})`)
                            .join(", ")}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* 반별 이동 상세 내역 */}
                  <div className="space-y-2">
                    <div className="text-xs font-extrabold text-gray-800 flex items-center justify-between">
                      <span>반별 수업 이동 내역 ({selectedCandidateForModal.steps.length}개 반)</span>
                      <span className="text-[11px] text-gray-500 font-normal">
                        {selectedCandidateForModal.steps.filter((s) => s.kind === "swap").length}개 반 맞교환 ·{" "}
                        {selectedCandidateForModal.steps.filter((s) => s.kind === "move").length}개 반 단순 이동
                      </span>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                      {selectedCandidateForModal.steps.map((step, idx) => (
                        <div
                          key={`${step.classNum}-${idx}`}
                          className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[11px] font-extrabold bg-purple-100 text-purple-900 border border-purple-200">
                              {step.classNum}반
                            </span>
                            <span className="font-bold text-gray-900">
                              {step.groupLesson.subjectName}
                            </span>
                            <span className="text-gray-500 font-medium">
                              ({step.groupLesson.teacherName})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            {step.kind === "swap" && step.counterpart ? (
                              <>
                                <span className="text-indigo-600 font-extrabold">↔ 맞교환:</span>
                                <span className="font-bold text-gray-900">
                                  {step.counterpart.teacherName} 선생님
                                </span>
                                <span className="text-gray-600">
                                  ({step.counterpart.subjectName})
                                </span>
                              </>
                            ) : (
                              <span className="text-emerald-700 font-bold">
                                ➔ 빈 교시로 단순 이동 (상대 수업 없음)
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 양해 확인 섹션 (1곳만, 반영 직전) */}
                  <div className="p-4 bg-purple-50/50 border border-purple-200 rounded-xl space-y-3">
                    <div className="text-xs text-gray-800 font-bold">
                      👥 양해 대상 선생님 ({modalAllParties.length}명):{" "}
                      <span className="text-purple-950 font-extrabold">
                        {modalAllParties.join(", ")}
                      </span>
                    </div>

                    <label className="flex items-start gap-2 cursor-pointer bg-white p-3 rounded-xl border border-purple-300 shadow-2xs">
                      <input
                        type="checkbox"
                        checked={simulConsentConfirmed}
                        onChange={(e) => setSimulConsentConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                      />
                      <span className="text-xs font-bold text-gray-900 leading-snug">
                        위 담당 선생님들 및 상대 선생님들께 사전 양해를 완료하였습니다 (필수)
                      </span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-600 mb-1">
                          사유 구분
                        </label>
                        <select
                          value={simulReasonType}
                          onChange={(e) => setSimulReasonType(e.target.value as SwapReasonType)}
                          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                        >
                          {SWAP_REASON_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-600 mb-1">
                          사유 상세 메모
                        </label>
                        <input
                          type="text"
                          maxLength={100}
                          value={simulReasonNote}
                          onChange={(e) => setSimulReasonNote(e.target.value)}
                          placeholder="사유 메모 (선택)"
                          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                        />
                      </div>
                    </div>

                    <input
                      type="text"
                      maxLength={200}
                      value={simulConsentNote}
                      onChange={(e) => setSimulConsentNote(e.target.value)}
                      placeholder="양해 메모 (선택, 예: 이동수업 시간표 조정 사전 합의)"
                      className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                    />
                  </div>
                </div>

                {/* 다이얼로그 푸터 */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedCandidateForModal(null)}
                    className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={executeSimulMoveCommit}
                    disabled={simulSubmitting || !simulConsentConfirmed}
                    className="px-5 py-2.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <span>⚡</span>
                    <span>{simulSubmitting ? "통 이동 반영 중..." : "양해 확인 및 통 이동 반영"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 기존 교사별 직권 배정 화면 */
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">👤 대상 교사 선택 (가나다순)</label>
              <select value={selectedTeacherEmail} onChange={(e) => { const email = e.target.value; const found = teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase()); handleSelectTeacher(email, found?.name); }} disabled={teacherListLoading} className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white text-xs disabled:opacity-60">
                <option value="">-- 교사를 선택해 주세요 --</option>
                {teacherListLoading && <option value="">교사 목록 불러오는 중...</option>}
                {!teacherListLoading && teacherList.map((t) => (<option key={t.email} value={t.email}>{t.name} ({t.email})</option>))}
              </select>
            </div>
            {recentTeachers.length > 0 && (
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100 text-xs">
                <span className="text-gray-500 font-bold shrink-0">최근 선택:</span>
                <div className="flex flex-wrap gap-1.5">
                  {recentTeachers.map((t) => (
                    <button key={t.email} type="button" onClick={() => handleSelectTeacher(t.email, t.name)} className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${selectedTeacherEmail.toLowerCase() === t.email.toLowerCase() ? "bg-indigo-600 text-white font-bold shadow-xs" : "bg-gray-100 hover:bg-gray-200 text-gray-700"}`}>👤 {t.name}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selectedTeacherEmail ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                      <span>🗓️</span>
                      <span>{selectedTeacherName} 교사의 등록 주별 시간표 ({weeks.length}개 주간)</span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">수업 칸을 클릭하면 그 수업이 옮겨 갈 수 있는 자리가 모든 주의 빈 칸 위에 바로 표시됩니다.</p>
                  </div>
                  {loadingTimetable && <span className="text-xs text-indigo-600 font-semibold animate-pulse">시간표 로딩 중...</span>}
                </div>

                {timetableError && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center font-bold">{timetableError}</div>}

                {projectedWeeks.map((pw) => {
                  const w = weeks.find((item) => item.id === pw.weekId) || { id: pw.weekId, startDate: pw.startDate, note: "" };
                  const isSourceWeek = selectedSlot?.weekId === w.id;
                  const isRecentlyUpdated = recentlyUpdatedWeeks.includes(w.id);
                  const weekCandidateGroup = swapCandidateWeeks.find((gw) => gw.weekId === w.id);
                  const candidateListInWeek = weekCandidateGroup?.swapCandidates || [];
                  return (
                    <div key={w.id} ref={(el) => { weekGridRefs.current[w.id] = el; }} className={`bg-white rounded-xl shadow-sm border transition-all ${isSourceWeek ? "border-indigo-500 ring-2 ring-indigo-200" : isRecentlyUpdated ? "border-emerald-500 ring-2 ring-emerald-100" : "border-gray-200"} p-5 space-y-3`}>
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-xs bg-indigo-900 text-white px-2.5 py-1 rounded-md">📅 {w.startDate} 주간 {w.note ? `(${w.note})` : ""}</span>
                          {isSourceWeek && <span className="text-[11px] font-bold bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-full border border-indigo-200">📌 원 수업 소스 주간</span>}
                          {isRecentlyUpdated && <span className="text-[11px] font-bold bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-full border border-emerald-300">✨ 배정 결과 반영됨</span>}
                        </div>
                        {/* 맞교환 모드에서만 — 보강 모드에 교환 배지가 남는 혼선 방지 (2026-08-08) */}
                        {selectedSlot && activeCandidateType === "swap" && <span className="text-[11px] text-gray-500 font-semibold">맞교환 후보 {candidateListInWeek.length}건</span>}
                      </div>
                      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="bg-indigo-950 text-white font-bold">
                              <th className="py-2.5 px-2 border-b border-r border-indigo-800 w-14 text-center">교시</th>
                              {DAYS.map((d) => (<th key={d.num} className="py-2.5 px-2 border-b border-indigo-800 text-center">{d.label}</th>))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white">
                            {Array.from({ length: 7 }).map((_, pIdx) => {
                              const period = pIdx + 1;
                              return (
                                <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                                  <td className="py-3 px-2 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50">{period}교시</td>
                                  {DAYS.map((d) => {
                                    const dayMaxPeriods = pw.dayPeriodCounts?.find((dp) => dp.day === d.num)?.periods ?? 7;
                                    const isOutPeriod = period > dayMaxPeriods;

                                    const matchedCells = getCellForSlotInWeek(w.id, d.num, period);
                                    const hasLesson = matchedCells.length > 0;
                                    // 담김(이동됨) 마커는 본인 수업의 순 이동 출발지에만 — 경유지·제3 교사 수업 슬롯 제외
                                    const cartMatch = myCartNetMoves.find((m) => m.from.weekId === w.id && m.from.day === d.num && m.from.period === period);
                                    // 맞교환 모드에서만 후보 하이라이트 — 보강 탭 전환 시 맞교환 제안이 그리드에 잔존하던 혼선 방지 (2026-08-07)
                                    const inlineCand = activeCandidateType === "swap" && !hasLesson && !isOutPeriod && selectedSlot ? candidateListInWeek.find((cand) => cand.targetDay === d.num && cand.targetPeriod === period) : null;
                                    return (
                                      <td key={d.num} className={`p-1 border-r border-gray-100 text-center align-top transition-all ${isOutPeriod ? "bg-gray-100/50" : hasLesson ? "bg-indigo-50/30" : inlineCand ? (inlineCand.coordination ? "bg-red-50/70" : "bg-emerald-50/50") : ""}`}>
                                        {isOutPeriod ? (
                                          <div className="text-gray-300 text-xs font-semibold font-mono text-center py-2 select-none">-</div>
                                        ) : hasLesson ? (
                                          <div className="space-y-1">
                                            {matchedCells.map((cell, cIdx) => {
                                              // 담기 가상 반영으로 옮겨온 셀 — 실제 시간표가 아니므로 원 수업으로 선택(클릭) 불가
                                              const isVirtualMoved = Boolean(cell.changed?.changeId?.startsWith("virtual-direct"));
                                              if (isVirtualMoved) {
                                                return (
                                                  <div key={cIdx} title="담기 가상 반영 — 일괄 반영 전까지는 실제 시간표가 아닙니다" className="w-full p-1.5 rounded-lg text-left border bg-amber-100 border-amber-400 text-amber-950">
                                                    <div className="font-black text-xs text-amber-950">{cell.subjectShort || cell.subjectName}</div>
                                                    <div className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5 bg-amber-200 text-amber-900">{cell.grade}-{cell.classNum}반</div>
                                                    <div className="text-[9px] bg-amber-200 text-amber-900 font-extrabold px-1 rounded mt-0.5 inline-block">🛒 담김 이동</div>
                                                  </div>
                                                );
                                              }
                                              const isSelected = selectedSlot?.weekId === w.id && selectedSlot?.grade === cell.grade && selectedSlot?.classNum === cell.classNum && selectedSlot?.day === cell.day && selectedSlot?.period === cell.period;
                                              const subjName = cell.subjectShort || cell.subjectName || "";
                                              // 판정 단일 통로: 서버가 교사 그리드 응답에 실어 보낸 동시수업 라벨 (cell.simul)
                                              const simulCheck = { hit: !!cell.simul, groupLabel: cell.simul };

                                              return (
                                                <button key={cIdx} type="button" onClick={() => handleSlotClick(w.id, cell)} className={`w-full p-1.5 rounded-lg text-left transition-all cursor-pointer border ${isSelected ? "bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-300 scale-[1.02]" : simulCheck.hit ? "bg-purple-50 hover:bg-purple-100 border-purple-300 text-purple-950 shadow-2xs" : "bg-white hover:bg-indigo-100/60 border-indigo-200 hover:border-indigo-400 text-gray-900 shadow-2xs"}`}>
                                                  <div className={`font-black text-xs ${isSelected ? "text-white" : simulCheck.hit ? "text-purple-950 font-black" : "text-indigo-950"}`}>{subjName}</div>
                                                  <div className="flex items-center justify-between gap-1 flex-wrap mt-0.5">
                                                    <div className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${isSelected ? "bg-indigo-800 text-indigo-100" : simulCheck.hit ? "bg-purple-200 text-purple-900" : "bg-indigo-100 text-indigo-800"}`}>{cell.grade}-{cell.classNum}반</div>
                                                    {simulCheck.hit && (
                                                      <span className="text-[9px] bg-purple-700 text-white font-extrabold px-1 rounded" title={simulCheck.groupLabel || "이동수업 그룹"}>🔀 이동수업</span>
                                                    )}
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        ) : inlineCand ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (inlineCand.coordination) {
                                                setPendingCoordinationSelect({ candidate: inlineCand, weekId: w.id, startDate: w.startDate });
                                              } else {
                                                handleSelectCandidate(inlineCand, w.id, w.startDate);
                                              }
                                            }}
                                            className={`w-full p-1.5 rounded-lg text-left transition-all cursor-pointer border ${
                                              activeCandidateType === "swap" && selectedCandidate?.targetWeekId === w.id && selectedCandidate?.targetDay === inlineCand.targetDay && selectedCandidate?.targetPeriod === inlineCand.targetPeriod && selectedCandidate?.counterpartEmail === inlineCand.counterpartEmail
                                                ? "bg-emerald-600 text-white border-emerald-700 shadow-md ring-2 ring-emerald-300 scale-[1.02]"
                                                : inlineCand.coordination
                                                  ? "bg-red-50 hover:bg-red-100/90 border-2 border-red-500 text-red-950 shadow-xs"
                                                  : "bg-emerald-50 hover:bg-emerald-100/90 border-emerald-300 hover:border-emerald-500 text-emerald-950 shadow-2xs"
                                            }`}
                                          >
                                            <div className="flex items-center justify-between gap-1">
                                              <span className="font-black text-[11px] truncate flex items-center gap-0.5">
                                                {inlineCand.coordination && <span>⚠️</span>}
                                                <span>{inlineCand.counterpartName}</span>
                                              </span>
                                              <span className={`px-1 py-0.5 rounded text-[9px] font-extrabold shrink-0 ${
                                                inlineCand.coordination
                                                  ? "bg-red-200 text-red-950 border border-red-400 font-black"
                                                  : inlineCand.score > 0 || (inlineCand.penalties && inlineCand.penalties.length > 0)
                                                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                                                    : "bg-emerald-200 text-emerald-900"
                                              }`}>
                                                {inlineCand.coordination
                                                  ? "⚠️ 양해 필수"
                                                  : inlineCand.score > 0 || (inlineCand.penalties && inlineCand.penalties.length > 0)
                                                    ? `감점 ${inlineCand.score}`
                                                    : "0점"}
                                              </span>
                                            </div>
                                            <div className={`text-[10px] mt-0.5 font-bold truncate ${inlineCand.coordination ? "text-red-900" : "text-emerald-800"}`}>
                                              {inlineCand.counterpartSubjectName}
                                            </div>
                                          </button>
                                        ) : cartMatch ? (
                                          <div className="w-full p-1.5 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 text-center">
                                            <div className="text-[9px] font-extrabold text-amber-800">🛒 담김 (이동됨)</div>
                                            <div className="text-[10px] font-bold text-amber-900 truncate">{cartMatch.subjectName || "수업"}</div>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => handleSlotClick(w.id, null, d.num, period)}
                                            className="w-full h-full min-h-[3rem] p-1 rounded-lg border border-transparent hover:border-indigo-300 hover:bg-indigo-50/80 transition-all text-[11px] text-gray-400 hover:text-indigo-700 font-bold flex flex-col items-center justify-center gap-0.5 group cursor-pointer"
                                            title="이 빈 자리로 다른 수업 가져오기 (연쇄 이동 탐색)"
                                          >
                                            <span>-</span>
                                            <span className="hidden group-hover:inline text-[9px] bg-indigo-100 text-indigo-800 px-1 py-0.2 rounded font-extrabold">
                                              🔗 가져오기
                                            </span>
                                          </button>
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
                })}

                {hasMoreProjectedWeeks && (
                  <div className="text-center pt-2 pb-4">
                    <button
                      type="button"
                      onClick={handleLoadMoreWeeks}
                      disabled={loadingTimetable}
                      className="px-6 py-2.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-900 font-extrabold rounded-xl text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      ➕ 이후 주 더 보기
                    </button>
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 space-y-6 sticky top-4">
                {selectedSlot && sourceLessonInfo && (
                  <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5"><span>3️⃣ 후보 상세 및 미리보기</span></h3>
                      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg text-[11px] font-bold">
                        <button type="button" onClick={() => { setActiveCandidateType("swap"); setSelectedCandidate(null); setPreviewCells(null); }} className={`px-2 py-1 rounded transition-all ${activeCandidateType === "swap" ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-600 hover:text-gray-900"}`}>↔️ 맞교환</button>
                        <button type="button" onClick={() => { setActiveCandidateType("substitute"); setSelectedCandidate(null); setPreviewCells(null); }} className={`px-2 py-1 rounded transition-all ${activeCandidateType === "substitute" ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-600 hover:text-gray-900"}`}>👤 보강 ({substituteCandidates.length})</button>
                      </div>
                    </div>
                    {loadingCandidates && <div className="p-4 text-center text-xs text-indigo-600 font-semibold animate-pulse">🔍 맞교환/보강 후보 탐색 중...</div>}

                    {/* 👤 보강 모드일 때 보강 후보 목록 / 선택된 보강 후보 상세 */}
                    {activeCandidateType === "substitute" && !loadingCandidates && (
                      <div className="space-y-3">
                        {selectedCandidate ? (
                          <div className="space-y-3 pt-1 animate-in fade-in duration-200">
                            <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-extrabold text-xs text-indigo-950">👤 {selectedCandidate.teacherName} 선생님</span>
                                <button type="button" onClick={() => setSelectedCandidate(null)} className="text-[10px] text-indigo-600 hover:underline font-bold">변경</button>
                              </div>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold">보강 누계: {selectedCandidate.substituteCount ?? 0}회</span>
                                {selectedCandidate.sameSubject && (
                                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">동일 과목</span>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <button type="button" onClick={handleAddToCart} className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-1"><span>🛒</span><span>담기</span></button>
                              <button type="button" onClick={handleDirectCommitSingle} disabled={submitting} className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-50"><span>⚡</span><span>즉시 1건 반영</span></button>
                            </div>
                          </div>
                        ) : substituteCandidates.length === 0 ? (
                          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs text-gray-500">
                            해당 시간에 공강인 보강 가능 교사가 없습니다.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-[11px] font-bold text-gray-700 flex items-center justify-between">
                              <span>보강 가능 교사 목록 ({substituteCandidates.length}명)</span>
                              <span className="text-[10px] text-gray-400 font-normal">누계 적은 순</span>
                            </div>
                            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                              {substituteCandidates.map((cand) => (
                                <button
                                  key={cand.teacherEmail}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCandidate(cand);
                                    setActiveCandidateType("substitute");
                                    setSubmitError(null);
                                  }}
                                  className="w-full p-2.5 bg-gray-50 hover:bg-indigo-50/80 border border-gray-200 hover:border-indigo-300 rounded-xl text-left transition-all flex items-center justify-between text-xs group cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-900 group-hover:text-indigo-900">👤 {cand.teacherName}</span>
                                    {cand.sameSubject && (
                                      <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.2 rounded font-extrabold">동일 과목</span>
                                    )}
                                  </div>
                                  <span className="text-[10px] bg-gray-200 group-hover:bg-indigo-100 text-gray-700 group-hover:text-indigo-800 font-bold px-2 py-0.5 rounded">
                                    누계 {cand.substituteCount}회
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ↔️ 맞교환 모드일 때 */}
                    {activeCandidateType === "swap" && !loadingCandidates && (
                      <>
                        {selectedCandidate ? (
                          <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                            {selectedCandidate.coordination && (
                              <div className="bg-red-50 border-2 border-red-500 rounded-xl p-3.5 space-y-2 text-xs">
                                <div className="font-extrabold text-red-950 flex items-center justify-between">
                                  <span className="flex items-center gap-1">
                                    <span>⚠️</span>
                                    <span>양해 필요 후보 (장소 충돌)</span>
                                  </span>
                                  <span className="text-[10px] bg-red-200 text-red-950 border border-red-400 px-2 py-0.5 rounded font-black">
                                    ⚠️ 양해 필수
                                  </span>
                                </div>
                                <div className="text-red-900 text-xs leading-relaxed font-semibold">
                                  {formatCoordinationText(selectedCandidate.coordination)}
                                </div>
                                <div className="pt-2 border-t border-red-200">
                                  <div className="font-bold text-gray-800 text-[11px]">
                                    👥 양해 필요 당사자:{" "}
                                    <span className="text-red-900 font-extrabold">
                                      {getCoordinationOccupants(selectedCandidate.coordination)
                                        .map((o) => `${o.teacherName} 선생님(${o.grade}-${o.classNum} ${o.subjectName})`)
                                        .join(", ")}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-extrabold text-xs text-indigo-950">🔄 {selectedCandidate.counterpartName} 교사 ({selectedCandidate.counterpartSubjectName})</span>
                              </div>
                              {(selectedCandidate.penalties?.length ?? 0) > 0 || selectedCandidate.score > 0 ? (
                                <div className="text-[11px] space-y-0.5 pt-1 border-t border-indigo-100">
                                  <div className="font-extrabold text-amber-900">⚠️ 감점 {selectedCandidate.score}점 — 사유</div>
                                  <ul className="list-disc list-inside text-amber-800 space-y-0.5">
                                    {selectedCandidate.penaltyDetails && selectedCandidate.penaltyDetails.length > 0
                                      ? selectedCandidate.penaltyDetails.map((pd: any, i: number) => (
                                          <li key={i}>{pd.text} ({pd.points}점)</li>
                                        ))
                                      : (selectedCandidate.penalties || []).map((p: string, i: number) => (
                                          <li key={i}>{p}</li>
                                        ))}
                                    {(!selectedCandidate.penaltyDetails || selectedCandidate.penaltyDetails.length === 0) &&
                                      (selectedCandidate.penalties?.length ?? 0) === 0 && <li>사유 정보 없음</li>}
                                  </ul>
                                </div>
                              ) : (
                                <div className="text-[11px] font-bold text-emerald-700 pt-1 border-t border-indigo-100">
                                  {selectedCandidate.coordination
                                    ? "시간표 감점 없음 · 특별실 겹침 조율 필요"
                                    : "시간표 감점 없음 (0점)"}
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs font-bold text-gray-700 flex items-center justify-between"><span>🗓️ 상대 교사 시간표 미리보기</span>{previewLoading && <span className="text-[10px] text-indigo-600 animate-pulse">로딩 중...</span>}</div>
                              <MiniPreviewGrid isCrossWeek={isCrossWeek} sourceWeekId={selectedSlot.weekId} targetWeekId={targetWeekId} sourceWeekObj={sourceWeekObj} targetWeekObj={targetWeekObj} selectedCell={{ grade: selectedSlot.grade, classNum: selectedSlot.classNum, day: selectedSlot.day, period: selectedSlot.period, subjectName: sourceLessonInfo.subjectName }} applyingCandidate={{ targetDay: selectedCandidate.targetDay, targetPeriod: selectedCandidate.targetPeriod, counterpartName: selectedCandidate.counterpartName, counterpartSubjectName: selectedCandidate.counterpartSubjectName }} periodsPerDay={7} previewCells={previewCells} counterpartSourceCells={counterpartSourceCells} counterpartTargetCells={counterpartTargetCells} counterpartTitle={selectedCandidate.counterpartName} />
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                              <button type="button" onClick={handleAddToCart} className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"><span>🛒</span><span>담기</span></button>
                              <button type="button" onClick={handleDirectCommitSingle} disabled={submitting} className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-50 cursor-pointer"><span>⚡</span><span>즉시 1건 반영</span></button>
                            </div>
                          </div>
                        ) : (

                          <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl text-center text-xs text-indigo-900">
                            시간표 그리드에서 맞교환할 상대 셀(초록색 배지)을 클릭해 주세요.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5"><span>🛒 담기 목록 ({cartItems.length}건)</span></h3>
                    {cartItems.length > 0 && <button type="button" onClick={handleClearCart} className="text-[10px] text-gray-400 hover:text-red-600 font-bold">전체 비우기</button>}
                  </div>
                  {cartItems.length === 0 ? <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded-xl space-y-1"><p className="font-bold text-gray-600">담긴 항목이 없습니다.</p></div> : (
                    <div className="space-y-3">
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {cartItems.map((item, idx) => (
                          <div key={item.id} className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1.5">
                            <div className="flex items-center justify-between font-bold">
                              <span className="text-indigo-900">#{idx + 1} {item.source.grade}-{item.source.classNum}반 {DAY_LABEL[item.source.day]}요일 {item.source.period}교시</span>
                              <button type="button" onClick={() => handleRemoveFromCart(item.id)} className="text-gray-400 hover:text-red-600 text-xs">✕</button>
                            </div>
                            {item.sourceTeacherEmail && item.sourceTeacherEmail.toLowerCase() !== selectedTeacherEmail.toLowerCase() && (
                              <div className="text-[10px] text-purple-800 font-bold">🔗 체인 단계 — {item.sourceTeacherName || item.sourceTeacherEmail} 선생님의 {item.source.subjectName} 이동</div>
                            )}
                            <div className="text-[11px] text-gray-700">➔ 상대: <strong className="text-gray-900">{item.counterpartName}</strong> ({item.counterpartSubjectName})</div>
                            {item.lastError && <div className="text-[10px] text-red-700 font-bold bg-red-50 border border-red-200 rounded px-1.5 py-1">⚠️ 반영 실패: {item.lastError}</div>}
                          </div>
                        ))}
                      </div>
                      <div className="pt-2 border-t border-gray-100 space-y-2">
                        <div className="text-[11px] font-bold text-gray-700">📨 양해 구하기 (시간표가 바뀌는 선생님별 이미지 복사):</div>
                        <div className="flex flex-wrap gap-1.5">
                          {affectedTeachers.map((t) => (
                            <button key={t.email} type="button" onClick={() => handleGenerateConsolidatedCard(t.email)} disabled={generatingShareFor === t.email} className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold text-[11px] rounded-lg disabled:opacity-60">
                              {generatingShareFor === t.email ? "이미지 생성 중…" : `📸 ${t.name} 선생님 (${t.count}건)`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="pt-3 border-t border-gray-200 space-y-3">
                        <button type="button" onClick={handleBatchCommit} disabled={submitting} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-xs shadow-md">일괄 승인 및 반영</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 space-y-2">
              <span className="text-3xl">👈</span>
              <p className="font-bold text-gray-800 text-sm">위 드롭다운에서 직권 배정할 대상 교사를 선택해 주세요.</p>
              <p className="text-xs text-gray-400">교사를 선택하면 그 교사의 모든 주 시간표가 표시됩니다.</p>
            </div>
          )}

          {/* 🔗 징검다리 체인 탐색 모달 */}
          {chainModalOpen && chainTargetSlot && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-xl border border-indigo-200 max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 animate-scale-up">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h3 className="text-base font-extrabold text-indigo-950 flex items-center gap-2">
                      <span>🔗 징검다리 연쇄 이동 경로 탐색</span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-800">
                        연쇄 이동 탐색
                      </span>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      목적지 공강 위치: <strong>{DAY_LABEL[chainTargetSlot.day]}요일 {chainTargetSlot.period}교시</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChainModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 text-lg font-black"
                  >
                    ✕
                  </button>
                </div>

                {/* 원본 수업 선택 영역 */}
                <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 space-y-3">
                  <label className="block text-xs font-extrabold text-indigo-950">
                    📍 목적지로 가져올 원본 수업 선택:
                  </label>
                  {chainSourceSlot ? (
                    <div className="flex items-center justify-between bg-white border border-indigo-200 p-3 rounded-lg text-xs">
                      <div>
                        <span className="font-bold text-indigo-900">
                          {chainSourceSlot.grade}-{chainSourceSlot.classNum}반 {chainSourceSlot.subjectName}
                        </span>{" "}
                        <span className="text-gray-500">
                          ({DAY_LABEL[chainSourceSlot.day]}요일 {chainSourceSlot.period}교시)
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                        선택됨
                      </span>
                    </div>
                  ) : (
                    /* 원본 미지정 — 모달이 그리드를 가리므로 여기서 직접 고른다 (묵은 원본 자동 사용 금지, 2026-08-07) */
                    <div className="space-y-1.5">
                      <div className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                        이 자리로 옮겨올 수업을 아래에서 골라 주세요. (여러 반이 함께 듣는 이동수업은 제외)
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                        {(teacherWeekCellsMap[chainTargetSlot.weekId] || [])
                          .filter((c) => !c.simul && !c.changed?.changeId?.startsWith("virtual-direct"))
                          .sort((a, b) => a.day - b.day || a.period - b.period)
                          .map((c, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() =>
                                setChainSourceSlot({
                                  weekId: chainTargetSlot.weekId,
                                  grade: c.grade,
                                  classNum: c.classNum,
                                  day: c.day,
                                  period: c.period,
                                  subjectName: c.subjectShort || c.subjectName || "수업",
                                  teacherEmail: selectedTeacherEmail,
                                  teacherName: selectedTeacherName,
                                })
                              }
                              className="w-full flex items-center justify-between bg-white hover:bg-indigo-50 border border-indigo-100 hover:border-indigo-300 rounded-lg px-2.5 py-1.5 text-xs transition-colors"
                            >
                              <span className="font-bold text-indigo-950">
                                {DAY_LABEL[c.day]}요일 {c.period}교시 · {c.grade}-{c.classNum}반 {c.subjectShort || c.subjectName}
                              </span>
                              <span className="text-[10px] text-indigo-500 font-bold">선택</span>
                            </button>
                          ))}
                        {(teacherWeekCellsMap[chainTargetSlot.weekId] || []).filter((c) => !c.simul).length === 0 && (
                          <div className="text-[11px] text-gray-500 text-center py-2">이 주에 옮길 수 있는 수업이 없습니다.</div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleRunChainSearch(2)}
                      disabled={!chainSourceSlot || chainSearchLoading}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors"
                    >
                      {chainSearchLoading ? "경로 탐색 중..." : "🔍 연쇄 이동 탐색 (2단계)"}
                    </button>
                  </div>
                </div>

                {/* 탐색 결과 리스트 */}
                {chainSearchLoading ? (
                  <div className="py-12 text-center text-xs text-indigo-600 font-bold space-y-2">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-indigo-600 border-t-transparent" />
                    <p>목적지 도달 가능한 중간 교환 체인을 역방향 탐색 중입니다...</p>
                  </div>
                ) : chainSearchError ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-3">
                    <p className="font-bold">{chainSearchError}</p>
                    {chainMaxDepth < 3 && (
                      <button
                        type="button"
                        onClick={() => handleRunChainSearch(3)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs shadow-xs"
                      >
                        🔄 3단계까지 넓혀 다시 탐색
                      </button>
                    )}
                  </div>
                ) : chainResults.length > 0 ? (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-700">
                      도달 가능한 교환 체인 경로 ({chainResults.length}건 발견):
                    </h4>
                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                      {chainResults.map((chain, idx) => (
                        <div
                          key={idx}
                          className="p-4 bg-white border border-indigo-100 hover:border-indigo-300 rounded-xl shadow-xs space-y-3 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black px-2 py-0.5 rounded bg-indigo-950 text-white">
                                체인 {idx + 1}
                              </span>
                              <span className="text-xs font-bold text-gray-600">
                                총 {chain.steps.length}단계 교환
                              </span>
                            </div>
                            <span className={`text-xs font-extrabold px-2 py-0.5 rounded ${
                              chain.totalScore === 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
                            }`}>
                              {chain.totalScore === 0 ? "감점 없음 (0점)" : `총 감점 ${chain.totalScore}점`}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {chain.steps.map((step: any, sIdx: number) => (
                              <div
                                key={sIdx}
                                className="p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between font-bold">
                                  <span className="text-indigo-950">
                                    단계 {sIdx + 1}: {step.source.grade}-{step.source.classNum}반 ({step.source.subjectName})
                                  </span>
                                  <span className="text-[11px] text-gray-500">
                                    {DAY_LABEL[step.source.day]} {step.source.period}교시 ➔ {DAY_LABEL[step.candidate?.targetDay]} {step.candidate?.targetPeriod}교시
                                  </span>
                                </div>
                                <div className="text-[11px] text-gray-600 flex items-center justify-between">
                                  <span>
                                    담당: <strong>{step.sourceTeacherName || "담당 교사"}</strong> ↔ 상대: <strong>{step.candidate?.counterpartName}</strong> ({step.candidate?.counterpartSubjectName})
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => handleAddChainToCart(chain)}
                              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <span>🛒</span>
                              <span>체인 전체 담기 ({chain.steps.length}단계)</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ⚡ 직권 일괄 반영 사전 양해 확인 모달 (반려 4건 반영) */}
          {cartBatchModalOpen && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
                <div className="border-b border-gray-100 pb-3 flex items-center justify-between shrink-0">
                  <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                    <span>🤝 직권 일괄 반영 사전 양해 확인</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setCartBatchModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="overflow-y-auto space-y-3 pr-1 shrink">
                  <div className="text-xs font-semibold text-gray-700">
                    담김 목록 <strong>{cartItems.length}건</strong> 중 사전 장소 양해가 필요한 교환 건이 포함되어 있습니다.
                  </div>

                  {cartItems
                    .filter((item) => !!item.candidate?.coordination)
                    .map((item, i) => (
                      <div key={item.id || i} className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="font-extrabold text-amber-950 flex items-center justify-between">
                          <span>🔄 {item.source.subjectName}({item.source.grade}-{item.source.classNum}) ↔ {item.candidate.counterpartName} 선생님</span>
                          <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold">장소 조율</span>
                        </div>
                        <div className="text-amber-900 text-xs font-semibold">
                          {formatCoordinationText(item.candidate.coordination)}
                        </div>
                        <div className="text-[11px] text-gray-800 font-bold">
                          👥 양해 당사자:{" "}
                          <span className="text-indigo-900">
                            {getCoordinationOccupants(item.candidate.coordination)
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
                        checked={cartBatchConsentConfirmed}
                        onChange={(e) => setCartBatchConsentConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-bold text-gray-900">
                        위 조율 건에 대해 해당 선생님들께 사전 양해를 완료하였습니다 (필수)
                      </span>
                    </label>
                    <input
                      type="text"
                      maxLength={200}
                      value={cartBatchConsentNote}
                      onChange={(e) => setCartBatchConsentNote(e.target.value)}
                      placeholder="일괄 양해 메모 (선택, 예: 직권 배정 장소 사용 양해 완료)"
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCartBatchModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => executeBatchCommit(cartBatchConsentNote.trim())}
                    disabled={submitting || !cartBatchConsentConfirmed}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {submitting ? "일괄 반영 중..." : `양해 확인 및 ${cartItems.length}건 직권 반영`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* §3-2b ②: 조율 필요 후보 클릭 시 2단 경고 다이얼로그 */}
          {pendingCoordinationSelect && pendingCoordinationSelect.candidate.coordination && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-md w-full p-6 space-y-4 animate-scale-up">
                <div className="flex items-center gap-2 text-red-600 font-extrabold text-base border-b border-red-100 pb-3">
                  <span className="text-xl">⚠️</span>
                  <span>당사자 양해 필요 (장소 조율)</span>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-2 text-xs text-red-950">
                  <div className="font-bold leading-relaxed">
                    {formatCoordinationText(pendingCoordinationSelect.candidate.coordination)}
                  </div>
                  <div className="pt-2 border-t border-red-200 text-gray-800">
                    <span className="font-bold">👥 양해 필요 당사자: </span>
                    <span className="font-extrabold text-red-900">
                      {getCoordinationOccupants(pendingCoordinationSelect.candidate.coordination)
                        .map((o) => `${o.teacherName} 선생님(${o.grade}-${o.classNum}반 ${o.subjectName})`)
                        .join(", ")}
                    </span>
                  </div>
                </div>
                <p className="text-xs font-bold text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  💡 이 교환은 당사자 양해 없이는 반영할 수 없습니다. 그래도 검토하시겠습니까?
                </p>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPendingCoordinationSelect(null)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const { candidate, weekId, startDate } = pendingCoordinationSelect;
                      setPendingCoordinationSelect(null);
                      handleSelectCandidate(candidate, weekId, startDate);
                    }}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-xl shadow-sm cursor-pointer"
                  >
                    양해 전제로 검토
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* §3-2b ③: 조율 필요 후보 단건 즉시 반영 시 양해 확인 다이얼로그 */}
          {singleCommitConsentModalOpen && selectedCandidate?.coordination && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-md w-full p-6 space-y-4 animate-scale-up">
                <div className="flex items-center gap-2 text-red-600 font-extrabold text-base border-b border-red-100 pb-3">
                  <span className="text-xl">⚡</span>
                  <span>직권 즉시 반영 전 양해 확인</span>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-2 text-xs text-red-950">
                  <div className="font-bold leading-relaxed">
                    {formatCoordinationText(selectedCandidate.coordination)}
                  </div>
                  <div className="pt-2 border-t border-red-200 text-gray-800">
                    <span className="font-bold">👥 양해 필요 당사자: </span>
                    <span className="font-extrabold text-red-900">
                      {getCoordinationOccupants(selectedCandidate.coordination)
                        .map((o) => `${o.teacherName} 선생님(${o.grade}-${o.classNum}반 ${o.subjectName})`)
                        .join(", ")}
                    </span>
                  </div>
                </div>
                <div className="space-y-2 pt-1 border-t border-gray-100">
                  <label className="flex items-start gap-2 cursor-pointer bg-red-50/60 p-2.5 rounded-lg border border-red-200">
                    <input
                      type="checkbox"
                      checked={singleCommitConsentConfirmed}
                      onChange={(e) => setSingleCommitConsentConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                    />
                    <span className="text-xs font-bold text-red-950">
                      위 선생님들께 사전 양해를 받았습니다 (필수)
                    </span>
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={singleCommitConsentNote}
                    onChange={(e) => setSingleCommitConsentNote(e.target.value)}
                    placeholder="양해 메모 (선택, 예: 체육관 합반으로 양해)"
                    className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setSingleCommitConsentModalOpen(false)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => executeDirectCommitSingle(singleCommitConsentNote.trim())}
                    disabled={submitting || !singleCommitConsentConfirmed}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-sm cursor-pointer"
                  >
                    {submitting ? "반영 중..." : "양해 확인 및 즉시 반영"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

