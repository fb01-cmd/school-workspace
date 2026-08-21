"use client";

import { useEffect, useState, useRef, useMemo } from "react";
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
  ConsentStatus,
  SwapDraft,
  SwapSourceSlot,
} from "@/lib/timetable/types";
import {
  DAY_LABEL,
  formatSlotWithDate,
  formatCoordinationText,
  formatCandidateSlotLabel,
  getCoordinationOccupants,
  getCoordinationParties,
  CoordinationParty,
} from "@/lib/timetable/utils";

import MiniPreviewGrid from "./MiniPreviewGrid";
import CoordinationNoticeBlock from "./CoordinationNoticeBlock";
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
  consentStatus?: ConsentStatus;
  consentNote?: string;
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

  // 최근 반영된 주차 하이라이트
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
    simul?: string;
    venueKey?: string;
  } | null>(null);

  const [swapCandidateWeeks, setSwapCandidateWeeks] = useState<WeekCandidateGroup[]>([]);
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [activeCandidateType, setActiveCandidateType] = useState<"swap" | "substitute">("swap");

  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [selectedPartyEmail, setSelectedPartyEmail] = useState<string>("");
  const weekGridRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const candidateParties = useMemo<CoordinationParty[]>(() => {
    if (!selectedCandidate?.coordination?.simul) return [];
    return getCoordinationParties(selectedCandidate.coordination);
  }, [selectedCandidate]);

  const currentParty = useMemo(() => {
    if (!candidateParties.length) return null;
    return (
      candidateParties.find((p) => p.email.toLowerCase() === selectedPartyEmail.toLowerCase()) ||
      candidateParties[0]
    );
  }, [candidateParties, selectedPartyEmail]);

  useEffect(() => {
    if (selectedCandidate?.coordination?.simul) {
      const parties = getCoordinationParties(selectedCandidate.coordination);
      const sel = (selectedTeacherEmail || "").trim().toLowerCase();
      const selectable = parties.filter((p) => p.email.toLowerCase() !== sel);
      const target = selectable[0] || parties[0];
      setSelectedPartyEmail(target?.email || "");
    } else {
      setSelectedPartyEmail(selectedCandidate?.counterpartEmail || "");
    }
  }, [selectedCandidate, selectedTeacherEmail]);

  const [previewCells, setPreviewCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartSourceCells, setCounterpartSourceCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartTargetCells, setCounterpartTargetCells] = useState<TeacherTimetableCell[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCacheRef = useRef<Map<string, TeacherTimetableCell[]>>(new Map());

  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // 직권 양해 요청 (notification_center_spec §4 직권 동등성)
  const [sendingConsentDraftId, setSendingConsentDraftId] = useState<string | null>(null);
  const [requestingConsentDraft, setRequestingConsentDraft] = useState<CartItem | null>(null);
  const [requestingConsentGroup, setRequestingConsentGroup] = useState<{ name: string; email: string; drafts: CartItem[] } | null>(null);
  const [consentMessageInput, setConsentMessageInput] = useState<string>("");

  const [consolidatedShareData, setConsolidatedShareData] = useState<ConsolidatedShareData | null>(null);
  const consolidatedCardRef = useRef<HTMLDivElement>(null);
  const [generatingShareFor, setGeneratingShareFor] = useState<string | null>(null);

  const [reasonType, setReasonType] = useState<SwapReasonType>("기타");
  const [reasonNote, setReasonNote] = useState("일과계 직권 배정");

  // 징검다리 체인 탐색
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

  const [cartBatchModalOpen, setCartBatchModalOpen] = useState(false);
  const [cartBatchConsentConfirmed, setCartBatchConsentConfirmed] = useState(false);
  const [cartBatchConsentNote, setCartBatchConsentNote] = useState("");

  const [pendingCoordinationSelect, setPendingCoordinationSelect] = useState<{ candidate: any; weekId: string; startDate?: string } | null>(null);
  const [singleCommitConsentModalOpen, setSingleCommitConsentModalOpen] = useState(false);
  const [singleCommitConsentConfirmed, setSingleCommitConsentConfirmed] = useState(false);
  const [singleCommitConsentNote, setSingleCommitConsentNote] = useState("");

  const getInitialWeekId = (weeksList: TimetableWeek[]): string => {
    if (!weeksList || weeksList.length === 0) return "";
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
        const effectiveTeacher =
          selectedTeacherEmail ||
          sessionStorage.getItem("direct_substitute_teacher_email") ||
          "";
        if (effectiveTeacher) {
          fetchTeacherTimetablesForAllWeeks(effectiveTeacher, data.weeks);
        }
      }
    } catch {}
  };

  const fetchCartDrafts = async (allWeeksList?: TimetableWeek[]) => {
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list", directOnly: true }),
      });
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.drafts)) {
        const loaded: CartItem[] = data.drafts.map((d: SwapDraft) => ({
          id: d.id,
          weekId: d.sourceWeekId,
          targetWeekId: d.targetWeekId,
          type: (d.candidate as any)?.type === "substitute" ? "substitute" : "swap",
          source: d.source,
          candidate: d.candidate,
          sourceTeacherEmail: (d as any).sourceTeacherEmail,
          sourceTeacherName: (d as any).sourceTeacherName,
          counterpartEmail: d.candidate?.counterpartEmail,
          counterpartName: d.candidate?.counterpartName,
          counterpartSubjectName: d.candidate?.counterpartSubjectName,
          consentStatus: d.consentStatus,
          consentNote: d.consentNote,
        }));
        setCartItems(loaded);

        // 지시서 35번: 장바구니 draft가 있으면 해당 교사로 상태 복원
        const targetWeeks = allWeeksList || weeks;
        if (loaded.length > 0 && loaded[0].sourceTeacherEmail) {
          const draftTeacherEmail = loaded[0].sourceTeacherEmail;
          const draftTeacherName = loaded[0].sourceTeacherName || "";
          setSelectedTeacherEmail(draftTeacherEmail);
          setSelectedTeacherName(draftTeacherName);
          sessionStorage.setItem("direct_substitute_teacher_email", draftTeacherEmail);
          sessionStorage.setItem("direct_substitute_teacher_name", draftTeacherName);
          if (targetWeeks.length > 0) {
            fetchTeacherTimetablesForAllWeeks(draftTeacherEmail, targetWeeks, loaded);
          }
        } else {
          // draft가 없을 때는 sessionStorage에서 이전 선택 교사 복원 시도
          const savedEmail = sessionStorage.getItem("direct_substitute_teacher_email");
          const savedName = sessionStorage.getItem("direct_substitute_teacher_name") || "";
          if (savedEmail && !selectedTeacherEmail) {
            setSelectedTeacherEmail(savedEmail);
            setSelectedTeacherName(savedName);
            if (targetWeeks.length > 0) {
              fetchTeacherTimetablesForAllWeeks(savedEmail, targetWeeks, []);
            }
          }
        }
        return loaded;
      }
    } catch (err) {
      console.error("Failed to load direct cart drafts:", err);
    }
    return [];
  };

  const handleSendConsentRequest = async (draftId: string, consentMessage?: string) => {
    setSendingConsentDraftId(draftId);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "consent_request",
          draftId,
          consentMessage: consentMessage?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "양해 요청 전송에 실패했습니다.");
      }
      alert("상대 선생님께 양해 요청 알림을 보냈습니다.");
      setRequestingConsentDraft(null);
      setRequestingConsentGroup(null);
      setConsentMessageInput("");
      await fetchCartDrafts();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSendingConsentDraftId(null);
    }
  };

  const handleSendConsentGroupRequest = async (
    group: { name: string; email: string; drafts: CartItem[] },
    consentMessage?: string
  ) => {
    setSendingConsentDraftId("group");
    try {
      for (const d of group.drafts) {
        if (d.consentStatus !== "CONSENTED") {
          await fetch("/api/timetable/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "consent_request",
              draftId: d.id,
              consentMessage: consentMessage?.trim() || undefined,
            }),
          });
        }
      }
      alert(`${group.name} 선생님께 양해 요청 알림을 보냈습니다.`);
      setRequestingConsentDraft(null);
      setRequestingConsentGroup(null);
      setConsentMessageInput("");
      await fetchCartDrafts();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSendingConsentDraftId(null);
    }
  };

  useEffect(() => {
    fetchTeachers();
    fetchWeeks();
    fetchCartDrafts();
  }, [activeTermId]);

  const toPendingPayload = (items: CartItem[]): DirectPendingOverlayItem[] => {
    return items.map((it) => ({
      weekId: it.weekId,
      targetWeekId: it.targetWeekId,
      type: it.type,
      source: it.source,
      candidate: it.candidate,
      sourceTeacherEmail: it.sourceTeacherEmail,
      sourceTeacherName: it.sourceTeacherName,
    }));
  };

  const fetchTeacherTimetablesForAllWeeks = async (
    teacherEmail: string,
    _allWeeks: TimetableWeek[] = weeks,
    currentCart: CartItem[] = cartItems,
    currentExtraWeeks: number = extraWeeks
  ) => {
    if (!teacherEmail) return;
    setLoadingTimetable(true);
    setTimetableError(null);
    try {
      const pendingPayload = toPendingPayload(currentCart);
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_projected",
          teacherEmail,
          pendingItems: pendingPayload,
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

  const handleSelectTeacher = async (email: string, name?: string) => {
    let effectiveCart = cartItems;
    const knownOwner = cartItems[0]?.sourceTeacherEmail || "";

    // 주인을 아는 경우만 다른 교사 선택 시 확인 후 비움 (주인을 모르는 옛 초안은 자동 삭제 금지)
    if (cartItems.length > 0 && email && knownOwner && email.toLowerCase() !== knownOwner.toLowerCase()) {
      if (!confirm(`담아둔 배정안 ${cartItems.length}건이 있습니다. 다른 교사를 선택하면 담아둔 내용이 비워집니다. 변경하시겠습니까?`)) {
        return;
      }
      try {
        await Promise.all(
          cartItems.map((item) =>
            fetch("/api/timetable/requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "draft_delete", draftId: item.id }),
            })
          )
        );
      } catch (err) {
        console.error("Failed to delete drafts on teacher change:", err);
      }
      setCartItems([]);
      effectiveCart = [];
    }

    if (!email) {
      setSelectedTeacherEmail("");
      setSelectedTeacherName("");
      sessionStorage.removeItem("direct_substitute_teacher_email");
      sessionStorage.removeItem("direct_substitute_teacher_name");
      setTeacherWeekCellsMap({});
      setSelectedSlot(null);
      setSwapCandidateWeeks([]);
      setSubstituteCandidates([]);
      setSelectedCandidate(null);
      setChainSourceSlot(null);
      setChainTargetSlot(null);
      setChainModalOpen(false);
      return;
    }

    // 동일 교사 재선택 시 장바구니 유지하고 리턴
    if (selectedTeacherEmail && email.toLowerCase() === selectedTeacherEmail.toLowerCase()) {
      return;
    }

    const finalName = name || teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase())?.name || email.split("@")[0];
    setSelectedTeacherEmail(email);
    setSelectedTeacherName(finalName);
    sessionStorage.setItem("direct_substitute_teacher_email", email);
    sessionStorage.setItem("direct_substitute_teacher_name", finalName);

    setRecentTeachers((prev) => {
      const filtered = prev.filter((t) => t.email.toLowerCase() !== email.toLowerCase());
      return [{ email, name: finalName }, ...filtered].slice(0, 5);
    });

    setSelectedSlot(null);
    setSourceLessonInfo(null);
    setSwapCandidateWeeks([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setCandidateError(null);
    setSuccessMsg(null);
    setSubmitError(null);
    setChainSourceSlot(null);
    setChainTargetSlot(null);
    setChainModalOpen(false);
    setChainResults([]);
    setChainSearchError(null);

    fetchTeacherTimetablesForAllWeeks(email, weeks, effectiveCart);
    const initWeekId = getInitialWeekId(weeks);
    if (initWeekId) {
      setTimeout(() => {
        weekGridRefs.current[initWeekId]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
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

  const fetchPreviewForCandidate = async (
    cand: any,
    srcSlot: typeof selectedSlot,
    partyEmail?: string
  ) => {
    const email = partyEmail || cand?.counterpartEmail;
    if (!cand || !srcSlot || !email) {
      setPreviewCells(null);
      setCounterpartSourceCells(null);
      setCounterpartTargetCells(null);
      return;
    }
    const srcWeekId = srcSlot.weekId;
    const tgtWeekId = cand.targetWeekId || srcWeekId;
    const isCross = srcWeekId !== tgtWeekId;
    setPreviewLoading(true);
    try {
      const fetchCellsForWeek = async (wId: string) => {
        const cacheKey = `${email}_${wId}`;
        if (previewCacheRef.current.has(cacheKey)) return previewCacheRef.current.get(cacheKey)!;
        const res = await fetch("/api/timetable/view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "teacher", teacherEmail: email, weekId: wId }),
        });
        if (res.ok) {
          const data = await res.json();
          const cells: TeacherTimetableCell[] = data.data?.cells || [];
          previewCacheRef.current.set(cacheKey, cells);
          return cells;
        }
        return [];
      };
      if (!isCross) {
        const cells = await fetchCellsForWeek(tgtWeekId);
        setPreviewCells(cells);
        setCounterpartSourceCells(null);
        setCounterpartTargetCells(null);
      } else {
        const [srcCells, tgtCells] = await Promise.all([
          fetchCellsForWeek(srcWeekId),
          fetchCellsForWeek(tgtWeekId),
        ]);
        setPreviewCells(null);
        setCounterpartSourceCells(srcCells);
        setCounterpartTargetCells(tgtCells);
      }
    } catch {} finally {
      setPreviewLoading(false);
    }
  };

  const handleSelectCandidate = (cand: any, wId: string, startDate?: string) => {
    const candidateObj = { ...cand, targetWeekId: wId, targetWeekStartDate: startDate };
    setSelectedCandidate(candidateObj);
    setActiveCandidateType("swap");
    setSubmitError(null);

    let targetPartyEmail = cand.counterpartEmail;
    if (cand.coordination?.simul) {
      const parties = getCoordinationParties(cand.coordination);
      const sel = (selectedTeacherEmail || "").trim().toLowerCase();
      const selectable = parties.filter((p) => p.email.toLowerCase() !== sel);
      targetPartyEmail = selectable[0]?.email || parties[0]?.email || cand.counterpartEmail;
    }
    setSelectedPartyEmail(targetPartyEmail || "");

    if (selectedSlot) fetchPreviewForCandidate(candidateObj, selectedSlot, targetPartyEmail);
  };

  // 징검다리 체인 탐색 실행
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

  const handleAddChainToCart = async (chain: any) => {
    if (!chain || !chain.steps || chain.steps.length === 0) return;

    try {
      const addedItems: CartItem[] = [];
      for (const step of chain.steps) {
        const sourceSlot: SwapSourceSlot = {
          grade: step.source.grade,
          classNum: step.source.classNum,
          day: step.source.day,
          period: step.source.period,
          subjectName: step.source.subjectName,
        };
        const teacherName = step.sourceTeacherName || selectedTeacherName;
        const res = await fetch("/api/timetable/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "draft_save",
            draft: {
              direct: true,
              sourceTeacherEmail: step.sourceTeacherEmail || selectedTeacherEmail,
              sourceTeacherName: step.sourceTeacherName || selectedTeacherName,
              termId: activeTermId || "",
              sourceWeekId: step.weekId,
              ...(step.targetWeekId ? { targetWeekId: step.targetWeekId } : {}),
              source: sourceSlot,
              candidate: step.candidate,
              note: `[직권 체인] ${teacherName} → ${step.candidate?.counterpartName || ""}`,
            },
          }),
        });
        const data = await res.json();
        if (res.ok && data.success && data.draft) {
          const d: SwapDraft = data.draft;
          addedItems.push({
            id: d.id,
            weekId: step.weekId,
            ...(step.targetWeekId ? { targetWeekId: step.targetWeekId } : {}),
            type: step.type || "swap",
            source: sourceSlot,
            candidate: step.candidate,
            sourceTeacherEmail: step.sourceTeacherEmail || selectedTeacherEmail,
            sourceTeacherName: step.sourceTeacherName || selectedTeacherName,
            counterpartEmail: step.candidate?.counterpartEmail,
            counterpartName: step.candidate?.counterpartName,
            counterpartSubjectName: step.candidate?.counterpartSubjectName,
            consentStatus: d.consentStatus || "NONE",
            consentNote: d.consentNote,
          });
        }
      }

      const updatedCart = [...cartItems, ...addedItems];
      setCartItems(updatedCart);
      setSuccessMsg(`🔗 징검다리 체인 (${addedItems.length}단계)이 담기 목록에 순서대로 추가되었습니다.`);
      setChainModalOpen(false);
      setChainSourceSlot(null);
      setChainTargetSlot(null);

      fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
      setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]);
      setSelectedCandidate(null); setCandidateError(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null);
    } catch (err: any) {
      alert(`체인 담기 오류: ${err.message}`);
    }
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

    if (!cell) {
      // 이중 방어: 원본이 현재 선택 교사의 수업이 아니면 무효화 (묵은 원본으로 탐색 방지)
      if (chainSourceSlot && chainSourceSlot.teacherEmail.toLowerCase() !== selectedTeacherEmail.toLowerCase()) {
        setChainSourceSlot(null);
      }
      setChainTargetSlot({ weekId, day, period });
      setChainResults([]);
      setChainSearchError(null);
      setChainModalOpen(true);
      return;
    }

    if (
      selectedSlot?.weekId === weekId &&
      selectedSlot?.grade === cell.grade &&
      selectedSlot?.classNum === cell.classNum &&
      selectedSlot?.day === cell.day &&
      selectedSlot?.period === cell.period
    ) {
      setSelectedSlot(null);
      setSourceLessonInfo(null);
      setSwapCandidateWeeks([]);
      setSubstituteCandidates([]);
      setSelectedCandidate(null);
      setCandidateError(null);
      setPreviewCells(null);
      setCounterpartSourceCells(null);
      setCounterpartTargetCells(null);
      setChainSourceSlot(null); // 선택 해제 시 체인 원본도 함께 해제 (묵은 원본 방지)
      return;
    }

    setSelectedSlot({
      weekId,
      grade: cell.grade,
      classNum: cell.classNum,
      day: cell.day,
      period: cell.period,
    });
    setSourceLessonInfo({
      subjectName: cell.subjectName,
      teacherName: selectedTeacherName,
      simul: cell.simul,
    });
    // 체인 원본 수업으로 자동 지정 — 수업을 고른 뒤 빈 교시를 누르면 그 수업을 가져오는 것이 기본 동선.
    // (이 지정이 빠지면 빈 교시 클릭 시 원본을 다시 고르라는 목록이 뜬다)
    setChainSourceSlot({
      weekId,
      grade: cell.grade,
      classNum: cell.classNum,
      day: cell.day,
      period: cell.period,
      subjectName: cell.subjectName,
      teacherEmail: selectedTeacherEmail,
      teacherName: selectedTeacherName,
    });
    fetchCandidates(weekId, cell.grade, cell.classNum, cell.day, cell.period, cell.subjectName);
  };

  const handleAddToCart = async () => {
    if (!selectedCandidate || !selectedSlot || !sourceLessonInfo) return;

    const sourceWeekId = selectedSlot.weekId;
    const targetWeekId = activeCandidateType === "swap" ? (selectedCandidate as any)?.targetWeekId : undefined;
    const counterpartEmail = activeCandidateType === "swap" ? selectedCandidate.counterpartEmail : (selectedCandidate as SubstituteCandidate).teacherEmail;
    const counterpartName = activeCandidateType === "swap" ? selectedCandidate.counterpartName : (selectedCandidate as SubstituteCandidate).teacherName;
    const counterpartSubjectName = activeCandidateType === "swap" ? selectedCandidate.counterpartSubjectName : undefined;

    let candidateSnapshot: any;
    if (activeCandidateType === "swap") {
      candidateSnapshot = {
        targetWeekId: targetWeekId || sourceWeekId,
        targetDay: selectedCandidate.targetDay,
        targetPeriod: selectedCandidate.targetPeriod,
        counterpartEmail: selectedCandidate.counterpartEmail,
        counterpartName: selectedCandidate.counterpartName,
        counterpartSubjectName: selectedCandidate.counterpartSubjectName,
        score: selectedCandidate.score,
        penalties: selectedCandidate.penalties || [],
        coordination: selectedCandidate.coordination,
      };
    } else {
      candidateSnapshot = {
        type: "substitute",
        counterpartEmail: (selectedCandidate as SubstituteCandidate).teacherEmail,
        counterpartName: (selectedCandidate as SubstituteCandidate).teacherName,
        score: 0,
        penalties: [],
      };
    }
    const sourceSlot: SwapSourceSlot = {
      grade: selectedSlot.grade,
      classNum: selectedSlot.classNum,
      day: selectedSlot.day,
      period: selectedSlot.period,
      subjectName: sourceLessonInfo.subjectName,
    };

    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_save",
          draft: {
            direct: true,
            sourceTeacherEmail: selectedTeacherEmail,
            sourceTeacherName: selectedTeacherName,
            termId: activeTermId || "",
            sourceWeekId,
            ...(targetWeekId ? { targetWeekId } : {}),
            source: sourceSlot,
            candidate: candidateSnapshot,
            note: `[직권] ${selectedTeacherName} → ${counterpartName || ""}`,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "담기 저장에 실패했습니다.");
      }

      const savedDraft: SwapDraft = data.draft;
      const newItem: CartItem = {
        id: savedDraft.id,
        weekId: sourceWeekId,
        ...(activeCandidateType === "swap" && targetWeekId ? { targetWeekId } : {}),
        type: activeCandidateType,
        source: sourceSlot,
        candidate: candidateSnapshot,
        sourceTeacherEmail: selectedTeacherEmail,
        sourceTeacherName: selectedTeacherName,
        counterpartEmail,
        counterpartName,
        counterpartSubjectName,
        consentStatus: savedDraft.consentStatus || "NONE",
        consentNote: savedDraft.consentNote,
      };

      const updatedCart = [...cartItems, newItem];
      setCartItems(updatedCart);
      setSuccessMsg(`🛒 [담기 완료] ${selectedSlot.grade}학년 ${selectedSlot.classNum}반 ${formatSlotWithDate(sourceWeekId, selectedSlot.day, selectedSlot.period)} 수업이 장바구니에 담겼습니다.`);

      fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
      setSelectedSlot(null);
      setSourceLessonInfo(null);
      setSwapCandidateWeeks([]);
      setSubstituteCandidates([]);
      setSelectedCandidate(null);
      setPreviewCells(null);
      setCounterpartSourceCells(null);
      setCounterpartTargetCells(null);
    } catch (err: any) {
      alert(`담기 오류: ${err.message}`);
    }
  };

  // 담기 이탈 경고 (UX 스캔 §6-6 / backlog A2) — 담긴 항목이 있는 채로 페이지를 벗어나면 브라우저 확인
  useEffect(() => {
    if (cartItems.length === 0) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [cartItems.length]);

  const handleRemoveCartItem = async (id: string) => {
    try {
      await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId: id }),
      });
    } catch (err) {
      console.error("Failed to delete draft:", err);
    }
    const updatedCart = cartItems.filter((item) => item.id !== id);
    setCartItems(updatedCart);
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
  };

  const handleClearCart = async () => {
    if (cartItems.length === 0) return;
    if (!confirm("담기 목록을 모두 비우시겠습니까?")) return;
    try {
      await Promise.all(
        cartItems.map((item) =>
          fetch("/api/timetable/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "draft_delete", draftId: item.id }),
          })
        )
      );
    } catch (err) {
      console.error("Failed to clear drafts:", err);
    }
    setCartItems([]);
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, []);
  };

  interface NetMoveSummary {
    grade: number;
    classNum: number;
    subjectName: string;
    from: { weekId: string; day: number; period: number };
    to: { weekId: string; day: number; period: number };
    ownerEmail?: string;
    ownerName: string;
  }

  const foldCartNetMoves = (items: CartItem[]): NetMoveSummary[] => {
    const swapItems = items.filter((it) => it.type !== "substitute");
    if (swapItems.length === 0) return [];

    type Segment = {
      id: string;
      subjectName: string;
      grade: number;
      classNum: number;
      from: { weekId: string; day: number; period: number };
      to: { weekId: string; day: number; period: number };
      ownerEmail?: string;
      ownerName: string;
    };

    const segments: Segment[] = [];
    swapItems.forEach((it, i) => {
      if (!it.candidate.targetDay || !it.candidate.targetPeriod) return;
      const srcEmail = (it.sourceTeacherEmail || selectedTeacherEmail).toLowerCase();
      const srcName = it.sourceTeacherName || (srcEmail === selectedTeacherEmail.toLowerCase() ? selectedTeacherName : srcEmail.split("@")[0]);
      segments.push({
        id: `${it.id}-req-${i}`,
        subjectName: it.source.subjectName || "수업",
        grade: it.source.grade,
        classNum: it.source.classNum,
        from: { weekId: it.weekId, day: it.source.day, period: it.source.period },
        to: { weekId: it.targetWeekId || it.weekId, day: it.candidate.targetDay, period: it.candidate.targetPeriod },
        ownerEmail: srcEmail,
        ownerName: srcName,
      });

      if (it.counterpartEmail) {
        const cpEmail = it.counterpartEmail.toLowerCase();
        const cpName = it.counterpartName || cpEmail.split("@")[0];
        segments.push({
          id: `${it.id}-cp-${i}`,
          subjectName: it.counterpartSubjectName || it.candidate.counterpartSubjectName || "수업",
          grade: it.source.grade,
          classNum: it.source.classNum,
          from: { weekId: it.targetWeekId || it.weekId, day: it.candidate.targetDay, period: it.candidate.targetPeriod },
          to: { weekId: it.weekId, day: it.source.day, period: it.source.period },
          ownerEmail: cpEmail,
          ownerName: cpName,
        });
      }
    });

    const sameSlot = (a: { weekId: string; day: number; period: number }, b: { weekId: string; day: number; period: number }) =>
      a.weekId === b.weekId && a.day === b.day && a.period === b.period;

    const chains: Segment[][] = [];
    const used = new Set<string>();

    for (const startSeg of segments) {
      if (used.has(startSeg.id)) continue;
      const isIntermediate = segments.some(
        (prev) => prev.id !== startSeg.id && !used.has(prev.id) && prev.ownerEmail === startSeg.ownerEmail && sameSlot(prev.to, startSeg.from)
      );
      if (isIntermediate) continue;

      const chain: Segment[] = [startSeg];
      used.add(startSeg.id);
      let curr = startSeg;
      while (true) {
        const next = segments.find(
          (cand) => !used.has(cand.id) && cand.ownerEmail === curr.ownerEmail && sameSlot(curr.to, cand.from)
        );
        if (!next) break;
        used.add(next.id);
        chain.push(next);
        curr = next;
      }
      chains.push(chain);
    }

    for (const seg of segments) {
      if (!used.has(seg.id)) {
        used.add(seg.id);
        chains.push([seg]);
      }
    }

    return chains
      .filter((chain) => chain.length > 0)
      .map((chain) => {
        const first = chain[0];
        const last = chain[chain.length - 1];
        return {
          grade: first.grade,
          classNum: first.classNum,
          subjectName: first.subjectName,
          from: first.from,
          to: last.to,
          ownerEmail: first.ownerEmail,
          ownerName: first.ownerName,
        };
      })
      .filter((m) => !sameSlot(m.from, m.to));
  };

  const myCartNetMoves = foldCartNetMoves(cartItems).filter(
    (m) => !!m.ownerEmail && m.ownerEmail === selectedTeacherEmail.toLowerCase()
  );

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
      if (ci.type === "substitute" && ci.counterpartEmail) {
        const email = ci.counterpartEmail.toLowerCase();
        if (email === sel) continue;
        const cur = map.get(email) || { name: ci.counterpartName || email.split("@")[0], count: 0 };
        cur.count += 1;
        map.set(email, cur);
      }
      if (ci.candidate?.coordination?.simul) {
        const parties = getCoordinationParties(ci.candidate.coordination);
        for (const p of parties) {
          const email = p.email.toLowerCase();
          if (email === sel) continue;
          const cur = map.get(email) || { name: p.name, count: 0 };
          cur.count += 1;
          map.set(email, cur);
        }
      }
    }
    return Array.from(map, ([email, v]) => ({ email, ...v }));
  })();

  const handleGenerateConsolidatedCard = async (teacherEmail: string) => {
    const email = teacherEmail.toLowerCase();
    const subItems = cartItems.filter((ci) => ci.type === "substitute" && ci.counterpartEmail?.toLowerCase() === email);
    const swapItemCount = cartItems.filter((ci) => ci.type !== "substitute").length;
    // §5c-9-3: 묶음 항목은 접기(foldCartNetMoves)가 반별 전개를 모른다 — steps에서 당사자별
    // 이동을 직접 전개하고, 접기 입력에서는 제외한다(클릭 반 이동의 이중 계상 방지).
    // 방향은 클릭 수업의 그룹 소속 여부로 판별(§5c-10 — 역방향이면 그룹이 후보 칸→클릭 칸).
    const simulMoves: NonNullable<ConsolidatedShareData["netMoves"]> = [];
    for (const ci of cartItems) {
      const simul = ci.candidate?.coordination?.simul;
      if (!simul || ci.candidate?.targetDay == null || ci.candidate?.targetPeriod == null) continue;
      const isRev = !simul.steps.some(
        (s: any) => s.classNum === ci.source.classNum && s.groupLesson?.subjectName === ci.source.subjectName
      );
      const clickSlot = { weekId: ci.weekId, day: ci.source.day, period: ci.source.period };
      const candSlot = { weekId: ci.targetWeekId || ci.weekId, day: ci.candidate.targetDay, period: ci.candidate.targetPeriod };
      const groupFrom = isRev ? candSlot : clickSlot; // 그룹 수업이 빠지는 곳
      const groupTo = isRev ? clickSlot : candSlot; // 그룹 수업이 들어가는 곳
      for (const s of simul.steps) {
        if (s.groupLesson?.teacherEmail)
          simulMoves.push({
            ownerName: s.groupLesson.teacherName, isRecipient: s.groupLesson.teacherEmail.toLowerCase() === email,
            grade: simul.grade, classNum: s.classNum, subjectName: s.groupLesson.subjectName,
            from: groupFrom, to: groupTo,
          });
        if (s.counterpart?.teacherEmail)
          simulMoves.push({
            ownerName: s.counterpart.teacherName, isRecipient: s.counterpart.teacherEmail.toLowerCase() === email,
            grade: simul.grade, classNum: s.classNum, subjectName: s.counterpart.subjectName,
            from: groupTo, to: groupFrom, // 치워지는 상대는 그룹과 반대 방향
          });
      }
    }
    const netMoves: NonNullable<ConsolidatedShareData["netMoves"]> = [
      ...foldCartNetMoves(cartItems.filter((ci) => !ci.candidate?.coordination?.simul))
        .map((m) => ({
          ownerName: m.ownerName, isRecipient: m.ownerEmail === email,
          grade: m.grade, classNum: m.classNum, subjectName: m.subjectName, from: m.from, to: m.to,
        })),
      ...simulMoves,
    ].sort((x, y) => (y.isRecipient ? 1 : 0) - (x.isRecipient ? 1 : 0));
    const recipientMoves = netMoves.filter((m) => m.isRecipient);
    const hasSimulParty = cartItems.some((ci) => {
      if (!ci.candidate?.coordination?.simul) return false;
      return getCoordinationParties(ci.candidate.coordination).some(
        (p) => p.email.toLowerCase() === email
      );
    });
    if (recipientMoves.length === 0 && subItems.length === 0 && !hasSimulParty) return;
    setGeneratingShareFor(teacherEmail);
    try {
      const counterpartName =
        affectedTeachers.find((t) => t.email === email)?.name ||
        cartItems.find((ci) => ci.counterpartEmail?.toLowerCase() === email)?.counterpartName ||
        "선생님";

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
        subItems.forEach((item) => {
          if (wId === item.weekId) markers.push({ day: item.source.day, period: item.source.period, kind: "in", label: `${item.source.grade}-${item.source.classNum}반 ${item.source.subjectName}` });
        });
        (netMoves || []).filter((m) => m.isRecipient).forEach((m) => {
          if (m.from.weekId === wId) markers.push({ day: m.from.day, period: m.from.period, kind: "out", label: `${m.grade}-${m.classNum}` });
          if (m.to.weekId === wId) markers.push({ day: m.to.day, period: m.to.period, kind: "in", label: `${m.grade}-${m.classNum}반 ${m.subjectName}` });
        });
        return { weekId: wId, startDate: wObj?.startDate || wId, cells, markers };
      }));

      const resolvedOperator = user?.email
        ? resolveDisplayName(user.email, teacherProfile ?? undefined).name
        : "";
      const operatorName =
        resolvedOperator && !isFrozenLocalPartName(resolvedOperator, user?.email || "")
          ? resolvedOperator
          : "일과 담당자";
      const shareData: ConsolidatedShareData = {
        requesterName: operatorName,
        senderLabel: operatorName,
        ownerLabel: selectedTeacherName ? `${selectedTeacherName} 선생님의` : "해당",
        counterpartName,
        counterpartEmail: email,
        items: subItems.map((ci) => ({ id: ci.id, type: ci.type, sourceWeekId: ci.weekId, targetWeekId: ci.targetWeekId, source: ci.source, candidate: ci.candidate })),
        netMoves,
        swapStepCount: swapItemCount,
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

  const executeBatchCommit = async (consentNoteInput?: string) => {
    setSubmitting(true); setSubmitError(null);
    try {
      const payload = {
        action: "direct_commit_batch",
        items: cartItems.map((item) => ({
          draftId: item.id,
          weekId: item.weekId,
          ...(item.targetWeekId ? { targetWeekId: item.targetWeekId } : {}),
          type: item.type,
          source: item.source,
          candidate: item.candidate,
          reason: { type: reasonType, note: reasonNote.trim() || undefined },
          consent: item.consentStatus === "CONSENTED"
            ? { confirmed: true }
            : (item.candidate?.coordination
              ? { confirmed: true, note: consentNoteInput || undefined }
              : undefined),
        })),
        reason: { type: reasonType, note: reasonNote.trim() || undefined },
      };
      const res = await fetch("/api/timetable/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "일괄 반영 처리 중 오류가 발생했습니다.");
      const results: DirectCommitBatchItemResult[] = data.results || [];
      const successIndices = new Set(results.filter((r) => r.ok).map((r) => r.index));

      // 성공한 항목들의 서버 초안 삭제 정리
      const successfulItems = cartItems.filter((_, idx) => successIndices.has(idx));
      await Promise.all(
        successfulItems.map((item) =>
          fetch("/api/timetable/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "draft_delete", draftId: item.id }),
          }).catch(() => {})
        )
      );

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

    const hasUnconsentedCoordination = cartItems.some((item) => !!item.candidate?.coordination && item.consentStatus !== "CONSENTED");
    if (hasUnconsentedCoordination) {
      setCartBatchModalOpen(true);
      setCartBatchConsentConfirmed(false);
      setCartBatchConsentNote("");
      return;
    }

    if (!confirm(`담긴 ${cartItems.length}건의 직권 배정/수업교환을 승인 및 일괄 반영하시겠습니까?`)) return;
    executeBatchCommit();
  };

  const executeDirectCommitSingle = async (consentNoteInput?: string) => {
    if (!selectedCandidate || !selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const sourceWeekId = selectedSlot.weekId;
      const targetWeekId = activeCandidateType === "swap" ? (selectedCandidate as any)?.targetWeekId : undefined;
      const isCoordination = activeCandidateType === "swap" && !!(selectedCandidate as any)?.coordination;
      const isSimul = activeCandidateType === "swap" && !!(selectedCandidate as any)?.coordination?.simul;

      let commitRes: Response;
      if (isSimul) {
        const sc = selectedCandidate as any;
        const simul = sc.coordination.simul;
        commitRes = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "simul_move_commit",
            weekId: sourceWeekId,
            targetWeekId, // 다른 주로 옮기는 후보 (없으면 같은 주)
            simulGroupId: simul.groupId,
            simulMoveSource: { day: selectedSlot.day, period: selectedSlot.period },
            simulMoveTarget: { day: sc.targetDay, period: sc.targetPeriod },
            reason: { type: reasonType, note: reasonNote.trim() || undefined },
            consent: { confirmed: true, note: consentNoteInput || undefined },
          }),
        });
      } else {
        let candidateSnapshot: any;
        if (activeCandidateType === "swap") {
          const sc = selectedCandidate as any;
          candidateSnapshot = {
            targetWeekId: targetWeekId || sourceWeekId,
            targetDay: sc.targetDay,
            targetPeriod: sc.targetPeriod,
            counterpartEmail: sc.counterpartEmail,
            counterpartName: sc.counterpartName,
            counterpartSubjectName: sc.counterpartSubjectName,
            score: sc.score,
            penalties: sc.penalties || [],
            coordination: sc.coordination,
          };
        } else {
          const subc = selectedCandidate as SubstituteCandidate;
          candidateSnapshot = {
            counterpartEmail: subc.teacherEmail,
            counterpartName: subc.teacherName,
            score: 0,
            penalties: [],
          };
        }
        commitRes = await fetch("/api/timetable/manage", {
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
      }

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
            여러 건을 [담기]로 모아 한 번에 반영할 수 있고, 상대 선생님께 보낼 양해 이미지도 만들 수 있습니다.
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>✅ {successMsg}</span>
          {recentlyUpdatedWeeks.length > 0 && <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-extrabold">✨ 변경된 주간 그리드 재조회 완료</span>}
        </div>
      )}
      {submitError && <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">⚠️ {submitError}</div>}

      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">👤 대상 교사 선택 (가나다순)</label>
            <select value={selectedTeacherEmail} onChange={(e) => { const email = e.target.value; const found = teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase()); handleSelectTeacher(email, found?.name); }} disabled={teacherListLoading} className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white text-xs disabled:opacity-60">
              <option value="">-- 교사를 선택해 주세요 --</option>
              {teacherListLoading && <option value="">교사 목록 불러오는 중...</option>}
              {!teacherListLoading && teacherList.map((t) => (<option key={t.email} value={t.email}>{t.name}</option>))}
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-6">
            {selectedTeacherEmail ? (
              <>
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
                      {selectedSlot && activeCandidateType === "swap" && <span className="text-[11px] text-gray-500 font-semibold">맞교환 후보 {candidateListInWeek.length}건</span>}
                    </div>
                    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                      <table className="w-full table-fixed border-collapse text-xs">
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
                                  const cartMatch = myCartNetMoves.find((m) => m.from.weekId === w.id && m.from.day === d.num && m.from.period === period);
                                  const inlineCand = activeCandidateType === "swap" && !hasLesson && !isOutPeriod && selectedSlot ? candidateListInWeek.find((cand) => cand.targetDay === d.num && cand.targetPeriod === period) : null;
                                  return (
                                    <td key={d.num} className={`p-1 border-r border-gray-100 text-center align-top transition-all ${isOutPeriod ? "bg-gray-100/50" : hasLesson ? "bg-indigo-50/30" : inlineCand ? (inlineCand.coordination ? "bg-red-50/70" : "bg-emerald-50/50") : ""}`}>
                                      {isOutPeriod ? (
                                        <div className="text-gray-300 text-xs font-semibold font-mono text-center py-2 select-none">-</div>
                                      ) : hasLesson ? (
                                        <div className="space-y-1">
                                          {matchedCells.map((cell, cIdx) => {
                                            const isVirtualMoved = Boolean(cell.changed?.changeId?.startsWith("virtual-direct"));
                                            if (isVirtualMoved) {
                                              return (
                                                <div key={cIdx} title="담기 가상 반영 — 일괄 반영 전까지는 실제 시간표가 아닙니다" className="w-full p-1.5 rounded-lg text-left border bg-amber-100 border-amber-400 text-amber-950">
                                                  <div className="font-black text-xs text-amber-950">{cell.subjectShort || cell.subjectName}</div>
                                                  <div className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5 bg-amber-200 text-amber-900">{cell.grade}-{cell.classNum}반</div>
                                                  <div className="text-[10px] bg-amber-200 text-amber-900 font-extrabold px-1 rounded mt-0.5 inline-block">🛒 담김 이동</div>
                                                </div>
                                              );
                                            }
                                            const isSelected = selectedSlot?.weekId === w.id && selectedSlot?.grade === cell.grade && selectedSlot?.classNum === cell.classNum && selectedSlot?.day === cell.day && selectedSlot?.period === cell.period;
                                            const subjName = cell.subjectShort || cell.subjectName || "";
                                            const simulCheck = { hit: !!cell.simul, groupLabel: cell.simul };

                                            return (
                                              <button key={cIdx} type="button" onClick={() => handleSlotClick(w.id, cell)} className={`w-full p-1.5 rounded-lg text-left transition-all cursor-pointer border ${isSelected ? "bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-300 scale-[1.02]" : simulCheck.hit ? "bg-purple-50 hover:bg-purple-100 border-purple-300 text-purple-950 shadow-2xs" : "bg-white hover:bg-indigo-100/60 border-indigo-200 hover:border-indigo-400 text-gray-900 shadow-2xs"}`}>
                                                <div className={`font-black text-xs ${isSelected ? "text-white" : simulCheck.hit ? "text-purple-950 font-black" : "text-indigo-950"}`}>{subjName}</div>
                                                <div className="flex items-center justify-between gap-1 flex-wrap mt-0.5">
                                                  <div className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${isSelected ? "bg-indigo-800 text-indigo-100" : simulCheck.hit ? "bg-purple-200 text-purple-900" : "bg-indigo-100 text-indigo-800"}`}>{cell.grade}-{cell.classNum}반</div>
                                                  {simulCheck.hit && (
                                                    <span className="text-[10px] bg-purple-700 text-white font-extrabold px-1 rounded" title={simulCheck.groupLabel || "이동수업 그룹"}>🔀 이동수업</span>
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
                                          <div className="flex items-center justify-between gap-1 min-w-0">
                                            <span className="font-black text-[11px] truncate flex items-center gap-0.5 min-w-0" title={inlineCand.counterpartName}>
                                              {inlineCand.coordination && <span className="shrink-0">⚠️</span>}
                                              <span className="truncate">{formatCandidateSlotLabel(inlineCand)}</span>
                                            </span>
                                            <span className={`px-1 py-0.5 rounded text-[10px] font-extrabold shrink-0 ${
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
                                          <div className="text-[10px] font-extrabold text-amber-800">🛒 담김 (이동됨)</div>
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
                                          <span className="hidden group-hover:inline text-xs bg-indigo-100 text-indigo-800 px-1 py-0.2 rounded font-extrabold">
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
            </>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-gray-500 space-y-2">
              <div className="text-3xl">👤</div>
              <div className="font-bold text-sm text-gray-700">시간표를 조회할 교사를 먼저 선택해 주세요.</div>
              <div className="text-xs text-gray-400">교사를 선택하면 해당 교사의 전 주 시간표가 주차별로 배치됩니다.</div>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 space-y-6 sticky top-4">
          {selectedTeacherEmail && selectedSlot && sourceLessonInfo && (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5"><span>3️⃣ 후보 상세 및 미리보기</span></h3>
                    <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg text-[11px] font-bold">
                      <button type="button" onClick={() => { setActiveCandidateType("swap"); setSelectedCandidate(null); setPreviewCells(null); }} className={`px-2 py-1 rounded transition-all ${activeCandidateType === "swap" ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-600 hover:text-gray-900"}`}>↔️ 맞교환</button>
                      <button type="button" onClick={() => { setActiveCandidateType("substitute"); setSelectedCandidate(null); setPreviewCells(null); }} className={`px-2 py-1 rounded transition-all ${activeCandidateType === "substitute" ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-600 hover:text-gray-900"}`}>👤 보강 ({substituteCandidates.length})</button>
                    </div>
                  </div>

                  <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-lg space-y-1 text-xs">
                    <div className="font-bold text-indigo-950 flex items-center justify-between">
                      <span>{selectedSlot.grade}학년 {selectedSlot.classNum}반 {sourceLessonInfo.subjectName}</span>
                      <span className="text-[11px] font-normal text-indigo-800">{sourceLessonInfo.teacherName} 교사</span>
                    </div>
                    <div className="text-indigo-800 font-semibold">{formatSlotWithDate(selectedSlot.weekId, selectedSlot.day, selectedSlot.period)}</div>
                  </div>

                  {loadingCandidates && <div className="py-8 text-center text-xs text-indigo-600 font-semibold animate-pulse">후보 탐색 중...</div>}
                  {candidateError && <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg">{candidateError}</div>}

                  {selectedCandidate ? (
                    <div className="space-y-4 pt-2 border-t border-gray-100">
                      {activeCandidateType === "swap" && (
                        <div className="space-y-2">
                          <div className="text-xs font-bold text-gray-800">선택된 맞교환 후보:</div>
                          <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs space-y-1">
                            <div className="font-bold text-emerald-950 flex items-center justify-between">
                              <span className="flex items-center gap-1">
                                {selectedCandidate.coordination && <span className="text-red-600">⚠️</span>}
                                <span>{selectedCandidate.counterpartName} 교사</span>
                                {selectedCandidate.counterpartSubjectName && `(${selectedCandidate.counterpartSubjectName})`}
                              </span>
                              {selectedCandidate.coordination ? (
                                <span className="px-1.5 py-0.5 rounded text-xs font-black bg-red-200 text-red-950 border border-red-400">
                                  ⚠️ 양해 필수
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-200 text-emerald-900">
                                  {selectedCandidate.score > 0 ? `감점 ${selectedCandidate.score}` : "0점"}
                                </span>
                              )}
                            </div>
                            <div className="text-emerald-800 font-medium">
                              교환 위치: {formatSlotWithDate(selectedCandidate.targetWeekId, selectedCandidate.targetDay, selectedCandidate.targetPeriod)}
                            </div>
                          </div>

                          {selectedCandidate.coordination && (
                            <CoordinationNoticeBlock
                              coordination={selectedCandidate.coordination}
                              isReverse={!sourceLessonInfo?.simul && !!selectedCandidate.coordination.simul}
                            />
                          )}
                        </div>
                      )}

                      {activeCandidateType === "substitute" && (
                        <div className="space-y-2">
                          <div className="text-xs font-bold text-gray-800">선택된 보강 후보:</div>
                          <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-xs space-y-1">
                            <div className="font-bold text-indigo-950 flex items-center gap-2">
                              <span>{selectedCandidate.teacherName} 선생님</span>
                              {(selectedCandidate as any).sameSubject && (
                                <span className="text-[11px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded font-extrabold">동일 과목</span>
                              )}
                              <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold">
                                보강 누계 {(selectedCandidate as any).substituteCount ?? 0}회
                              </span>
                            </div>
                            <div className="text-indigo-800 font-medium">{selectedCandidate.reason || "해당 교시 수업 없음 (보강 가능)"}</div>
                          </div>
                        </div>
                      )}

                      {activeCandidateType === "swap" && (
                        <div className="space-y-2 pt-2 border-t border-gray-100">
                          <div className="text-xs font-bold text-gray-800 flex items-center justify-between">
                            <span>🔍 상대 시간표 미리보기</span>
                            {previewLoading && <span className="text-[11px] text-indigo-500 animate-pulse font-semibold">조회 중...</span>}
                          </div>
                          {candidateParties.length > 1 && (
                            <div className="flex items-center gap-1.5 p-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                              <label className="text-[11px] font-bold text-gray-600 shrink-0">당사자:</label>
                              <select
                                value={selectedPartyEmail}
                                onChange={(e) => {
                                  const partyEmail = e.target.value;
                                  setSelectedPartyEmail(partyEmail);
                                  if (selectedSlot) {
                                    fetchPreviewForCandidate(selectedCandidate, selectedSlot, partyEmail);
                                  }
                                }}
                                className="w-full text-xs font-semibold bg-white border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500"
                              >
                                {candidateParties.map((p) => (
                                  <option key={p.email} value={p.email}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          <MiniPreviewGrid
                            isCrossWeek={isCrossWeek}
                            sourceWeekId={selectedSlot.weekId}
                            targetWeekId={targetWeekId}
                            sourceWeekObj={sourceWeekObj}
                            targetWeekObj={targetWeekObj}
                            selectedCell={{
                              grade: selectedSlot.grade,
                              classNum: selectedSlot.classNum,
                              day: selectedSlot.day,
                              period: selectedSlot.period,
                              subjectName: sourceLessonInfo.subjectName,
                              simul: sourceLessonInfo.simul,
                            }}
                            applyingCandidate={selectedCandidate}
                            periodsPerDay={7}
                            previewCells={previewCells}
                            counterpartSourceCells={counterpartSourceCells}
                            counterpartTargetCells={counterpartTargetCells}
                            counterpartTitle={`${currentParty?.name || selectedCandidate.counterpartName || "상대"} 선생님`}
                            partyRole={currentParty?.role}
                            reverse={!sourceLessonInfo?.simul && !!selectedCandidate.coordination?.simul}
                          />
                        </div>
                      )}

                      <div className="space-y-2 pt-2 border-t border-gray-100">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleAddToCart}
                            className="flex-1 py-2.5 px-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                          >
                            🛒 [담기]에 모으기
                          </button>
                          <button
                            type="button"
                            onClick={handleDirectCommitSingle}
                            disabled={submitting}
                            className="flex-1 py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {submitting ? "반영 중..." : "⚡ 단건 즉시 반영"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : activeCandidateType === "substitute" ? (
                    /* 보강 후보는 그리드에 하이라이트되지 않는다(대체 교사 선택이지 자리 이동이 아니므로) — 목록에서 고른다.
                       재배선(dbb999e)에서 이 목록이 통째로 빠져 보강 직권 배정 자체가 불가능했다. */
                    substituteCandidates.length === 0 ? (
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs text-gray-500">
                        해당 시간에 공강인 보강 가능 교사가 없습니다.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-gray-700 flex items-center justify-between">
                          <span>보강 가능 교사 목록 ({substituteCandidates.length}명)</span>
                          <span className="text-[11px] text-gray-400 font-normal">누계 적은 순</span>
                        </div>
                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                          {substituteCandidates.map((cand) => (
                            <button
                              key={cand.teacherEmail}
                              type="button"
                              onClick={() => {
                                setSelectedCandidate(cand as any);
                                setActiveCandidateType("substitute");
                                setSubmitError(null);
                              }}
                              className="w-full p-2.5 bg-gray-50 hover:bg-indigo-50/80 border border-gray-200 hover:border-indigo-300 rounded-xl text-left transition-all flex items-center justify-between text-xs group cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-900 group-hover:text-indigo-900">👤 {cand.teacherName}</span>
                                {cand.sameSubject && (
                                  <span className="text-[11px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded font-extrabold">동일 과목</span>
                                )}
                              </div>
                              <span className="text-xs bg-gray-200 group-hover:bg-indigo-100 text-gray-700 group-hover:text-indigo-800 font-bold px-2 py-0.5 rounded">
                                누계 {cand.substituteCount ?? 0}회
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="py-6 text-center text-xs text-gray-400">
                      좌측 시간표에서 초록색 또는 빨간색 후보 슬롯을 클릭해 주세요.
                    </div>
                  )}
                </div>
              )}

              {/* 담기 목록 (장바구니) */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🛒 담기 목록 ({cartItems.length}건)</span>
                  </h3>
                  {cartItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearCart}
                      className="text-[11px] text-red-600 hover:text-red-800 font-bold cursor-pointer"
                    >
                      전체 비우기
                    </button>
                  )}
                </div>

                {!selectedTeacherEmail && cartItems.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed font-medium">
                    {cartItems[0]?.sourceTeacherName || cartItems[0]?.sourceTeacherEmail ? (
                      <span>
                        💡 이 배정안은 <strong>{cartItems[0].sourceTeacherName || cartItems[0].sourceTeacherEmail}</strong> 선생님 시간표에서 담은 것입니다. 이어서 작업하려면 위에서 그 선생님을 선택하세요.
                      </span>
                    ) : (
                      <span>
                        ⚠️ 담긴 항목이 있으나 어느 선생님 시간표에서 담은 것인지 확인할 수 없습니다. 내용을 확인하고 직접 비워 주세요.
                      </span>
                    )}
                  </div>
                )}

                {cartItems.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400">
                    담긴 항목이 없습니다. 여러 수업을 골라 [담기]로 모아 일괄 처리할 수 있습니다.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {cartItems.map((item, idx) => (
                        <div key={item.id} className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1.5 relative group">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-gray-900">
                                #{idx + 1} [{item.type === "swap" ? "맞교환" : "특별보강"}]
                              </span>
                              {item.candidate.coordination && item.consentStatus !== "CONSENTED" && (
                                <span className="text-sm text-red-600 font-black bg-red-100 px-1 rounded">⚠️ 양해 필요</span>
                              )}
                              {item.consentStatus === "REQUESTED" && (
                                <span className="text-sm bg-blue-100 text-blue-900 border border-blue-300 font-bold px-1.5 py-0.5 rounded">
                                  📨 양해 대기 중
                                </span>
                              )}
                              {item.consentStatus === "CONSENTED" && (
                                <span className="text-sm bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold px-1.5 py-0.5 rounded">
                                  ✓ 알림으로 양해 받음
                                </span>
                              )}
                              {item.consentStatus === "DECLINED" && (
                                <span className="text-sm bg-rose-100 text-rose-900 border border-rose-300 font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                  <span>❌ 어렵다고 답함</span>
                                  {item.consentNote && <span className="font-normal text-rose-800">(사유: {item.consentNote})</span>}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveCartItem(item.id)}
                              className="text-gray-400 hover:text-red-600 text-xs font-bold cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="text-gray-700">
                            {formatSlotWithDate(item.weekId, item.source.day, item.source.period)} ({item.source.grade}-{item.source.classNum} {item.source.subjectName})
                          </div>
                          <div className="text-indigo-800 font-medium flex items-center justify-between">
                            <span>➔ {item.type === "swap" ? `${formatSlotWithDate(item.targetWeekId || item.weekId, item.candidate.targetDay, item.candidate.targetPeriod)} (${item.counterpartName})` : `${item.counterpartName} 교사 보강`}</span>
                          </div>
                          {item.lastError && <div className="text-[11px] text-red-600 bg-red-50 p-1 rounded font-semibold">⚠️ {item.lastError}</div>}

                          {/* 양해 요청 버튼 */}
                          {item.counterpartEmail && item.consentStatus !== "CONSENTED" && (
                            <div className="pt-1 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setRequestingConsentDraft(item);
                                  setConsentMessageInput("");
                                }}
                                disabled={sendingConsentDraftId === item.id}
                                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold rounded text-[11px] border border-amber-300 transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                              >
                                <span>📨</span>
                                <span>{item.consentStatus === "REQUESTED" ? "양해 다시 요청" : "양해 요청 보내기"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 양해 이미지 공유 및 양해 요청 (상대 교사별) */}
                    {affectedTeachers.length > 0 && (
                      <div className="pt-2 border-t border-gray-100 space-y-2">
                        <div className="text-[11px] font-bold text-gray-700 flex items-center gap-1">
                          <span>📸</span>
                          <span>양해 이미지 카드 복사 / 알림 요청 (상대 교사별):</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {affectedTeachers.map((t) => {
                            const groupDrafts = cartItems.filter((ci) => ci.counterpartEmail?.toLowerCase() === t.email.toLowerCase());
                            const allConsented = groupDrafts.length > 0 && groupDrafts.every((d) => d.consentStatus === "CONSENTED");
                            const anyRequested = groupDrafts.some((d) => d.consentStatus === "REQUESTED");
                            return (
                              <div key={t.email} className="inline-flex items-center gap-1 bg-sky-50 border border-sky-200 rounded-lg p-1">
                                <button
                                  type="button"
                                  onClick={() => handleGenerateConsolidatedCard(t.email)}
                                  disabled={generatingShareFor === t.email}
                                  title="양해 이미지 복사"
                                  className="px-2 py-0.5 hover:bg-sky-100 border border-transparent text-sky-900 rounded text-xs font-bold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  <span>📋</span>
                                  <span>{t.name} ({t.count}건)</span>
                                  {generatingShareFor === t.email && <span className="animate-spin text-xs">⏳</span>}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRequestingConsentGroup({ name: t.name, email: t.email, drafts: groupDrafts });
                                    setConsentMessageInput("");
                                  }}
                                  disabled={!!sendingConsentDraftId || allConsented || groupDrafts.length === 0}
                                  title="양해 요청 알림 보내기"
                                  className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded text-xs font-bold transition-colors disabled:opacity-50 flex items-center gap-0.5 cursor-pointer"
                                >
                                  <span>📨</span>
                                  <span>{allConsented ? "수락됨" : anyRequested ? "다시 요청" : "요청"}</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 사유 구분 & 일괄 반영 버튼 */}
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-bold text-gray-600 mb-1">신청 사유 구분</label>
                          <select value={reasonType} onChange={(e) => setReasonType(e.target.value as SwapReasonType)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                            {SWAP_REASON_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-gray-600 mb-1">사유 상세 메모</label>
                          <input type="text" maxLength={100} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="사유 메모 (선택)" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white" />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleBatchCommit}
                        disabled={submitting}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {submitting ? "일괄 반영 처리 중..." : `⚡ 담긴 ${cartItems.length}건 직권 일괄 반영`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* 체인 탐색 모달 */}
      {chainModalOpen && chainTargetSlot && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-4 animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-extrabold text-purple-950 flex items-center gap-1.5">
                <span>🔗</span>
                <span>징검다리 체인 탐색 (빈 교시로 가져오기)</span>
              </h3>
              <button type="button" onClick={() => setChainModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm font-bold cursor-pointer">✕</button>
            </div>

            <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl text-xs space-y-1 text-purple-950">
              <div className="font-bold">🎯 목적지: {formatSlotWithDate(chainTargetSlot.weekId, chainTargetSlot.day, chainTargetSlot.period)}</div>
              <div className="text-[11px] text-purple-800">이 빈 교시로 가져올 수 있는 수업의 징검다리 교환 경로를 탐색합니다.</div>
            </div>

            {chainSourceSlot ? (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
                <div className="font-bold text-gray-900 flex items-center justify-between">
                  <span>출발 수업: {chainSourceSlot.grade}학년 {chainSourceSlot.classNum}반 {chainSourceSlot.subjectName} ({chainSourceSlot.teacherName})</span>
                  <button type="button" onClick={() => setChainSourceSlot(null)} className="text-indigo-600 font-bold hover:underline">변경</button>
                </div>
                <div className="text-gray-600">{formatSlotWithDate(chainSourceSlot.weekId, chainSourceSlot.day, chainSourceSlot.period)}</div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700">이동시킬 원본 수업 선택:</label>
                <div className="max-h-40 overflow-y-auto space-y-1 border border-gray-200 rounded-xl p-2 bg-gray-50">
                  {Object.entries(teacherWeekCellsMap).flatMap(([wId, cells]) =>
                    cells.map((c, cIdx) => (
                      <button
                        key={`${wId}-${c.day}-${c.period}-${cIdx}`}
                        type="button"
                        onClick={() => setChainSourceSlot({ weekId: wId, grade: c.grade, classNum: c.classNum, day: c.day, period: c.period, subjectName: c.subjectName, teacherEmail: selectedTeacherEmail, teacherName: selectedTeacherName })}
                        className="w-full text-left p-2 rounded-lg bg-white hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 text-xs flex items-center justify-between transition-all"
                      >
                        <span className="font-bold text-gray-900">{c.grade}-{c.classNum}반 {c.subjectName}</span>
                        <span className="text-indigo-700 font-semibold">{formatSlotWithDate(wId, c.day, c.period)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => handleRunChainSearch()}
                disabled={!chainSourceSlot || chainSearchLoading}
                className="flex-1 py-2.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {chainSearchLoading ? "체인 탐색 중..." : "🔍 징검다리 경로 탐색 (최대 2단계)"}
              </button>
            </div>

            {chainSearchError && (
              <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg font-semibold space-y-2">
                <p>{chainSearchError}</p>
                {chainMaxDepth < 3 && (
                  <button
                    type="button"
                    onClick={() => handleRunChainSearch(3)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs shadow-xs cursor-pointer"
                  >
                    🔄 3단계까지 넓혀 다시 탐색
                  </button>
                )}
              </div>
            )}

            {chainResults.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="text-xs font-bold text-purple-950 flex items-center justify-between">
                  <span>발견된 체인 경로 ({chainResults.length}건):</span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {chainResults.map((chain, cIdx) => (
                    <div key={cIdx} className="p-3 bg-purple-50/60 border border-purple-200 rounded-xl space-y-2 text-xs">
                      <div className="font-extrabold text-purple-950 flex items-center justify-between">
                        <span>경로 #{cIdx + 1} ({chain.steps?.length || 2}단계 교환)</span>
                        <button
                          type="button"
                          onClick={() => handleAddChainToCart(chain)}
                          className="px-3 py-1 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-lg text-xs shadow-2xs cursor-pointer"
                        >
                          🛒 이 체인 담기
                        </button>
                      </div>
                      <div className="space-y-1 font-mono text-[11px] text-purple-900">
                        {chain.steps?.map((step: any, sIdx: number) => (
                          <div key={sIdx} className="bg-white p-1.5 rounded border border-purple-200">
                            단계 {sIdx + 1}: {step.stepSummary || `${step.sourceTeacherName || ""} → ${step.candidate?.counterpartName || ""} (${step.targetDay}요일 ${step.targetPeriod}교시)`}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 직권 일괄 반영 모달 */}
      {cartBatchModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-lg w-full p-6 space-y-4 animate-scale-up max-h-[90vh] overflow-y-auto font-sans">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <h4 className="text-sm font-bold text-red-950 flex items-center gap-2">
                <span className="text-red-600 font-extrabold text-base">⚠️</span>
                <span>직권 일괄 반영 전 양해 확인</span>
              </h4>
              <button
                type="button"
                onClick={() => setCartBatchModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {/* 건수 요약 문장 삭제 (2026-08-16 사용자) — "N건 중 M건이 양해 필요"는 나머지 교환은
                  양해 없이 해도 된다는 뜻으로 읽힌다. 양해 관행은 전 교환의 전제고, 시스템이 확인
                  기록을 강제하는 범위만 다를 뿐이다 (AGENTS.md 화면 문구 규칙 4). */}
              {cartItems.filter((d) => !!d.candidate?.coordination).map((item, iIdx) => (
                <div key={item.id || iIdx} className="space-y-1">
                  <div className="text-[11px] font-bold text-gray-900 flex items-center justify-between">
                    <span>
                      항목 #{iIdx + 1}: {item.source.grade}-{item.source.classNum}반 {item.source.subjectName} ➔ {item.counterpartName}
                    </span>
                    {item.consentStatus === "CONSENTED" && (
                      <span className="text-xs text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        ✓ 알림으로 양해 받음
                      </span>
                    )}
                  </div>
                  <CoordinationNoticeBlock
                    coordination={item.candidate.coordination}
                    isReverse={!sourceLessonInfo?.simul && !!item.candidate.coordination?.simul}
                  />
                </div>
              ))}
            </div>

            {cartItems.some((d) => !!d.candidate?.coordination && d.consentStatus !== "CONSENTED") ? (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <label className="flex items-start gap-2 cursor-pointer bg-red-50/60 p-2.5 rounded-lg border border-red-200">
                  <input
                    type="checkbox"
                    checked={cartBatchConsentConfirmed}
                    onChange={(e) => setCartBatchConsentConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-red-950">
                    위 항목의 관련 선생님들께 사전 양해를 완료하였습니다 (필수)
                  </span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={cartBatchConsentNote}
                  onChange={(e) => setCartBatchConsentNote(e.target.value)}
                  placeholder="양해 메모 (선택, 예: 시간표 조정 사전 합의)"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            ) : (
              <div className="pt-2 border-t border-gray-100">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 text-xs font-bold text-emerald-900">
                  <span className="text-emerald-600 font-extrabold">✓</span>
                  <span>모든 양해 대상 항목의 양해가 알림으로 완료되었습니다.</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setCartBatchModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => executeBatchCommit(cartBatchConsentNote.trim())}
                disabled={
                  submitting ||
                  (cartItems.some((d) => !!d.candidate?.coordination && d.consentStatus !== "CONSENTED") && !cartBatchConsentConfirmed)
                }
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {submitting ? "일괄 반영 중..." : `양해 확인 및 ${cartItems.length}건 직권 반영`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📨 직권 양해 요청 모달 (부탁 말씀 한 줄 입력 다이얼로그) */}
      {(requestingConsentDraft || requestingConsentGroup) && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md p-6 space-y-4 font-sans">
            <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>📨</span>
                <span>양해 요청 보내기</span>
              </h4>
              <button
                type="button"
                onClick={() => {
                  setRequestingConsentDraft(null);
                  setRequestingConsentGroup(null);
                  setConsentMessageInput("");
                }}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              상대 선생님께 알림을 보내 사전 양해를 요청합니다. 전하실 부탁 말씀을 남기실 수 있습니다.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                <label htmlFor="direct-consent-message-input">부탁 말씀 (선택)</label>
                <span className="text-[11px] text-gray-400 font-normal">{consentMessageInput.length}/200자</span>
              </div>
              <textarea
                id="direct-consent-message-input"
                maxLength={200}
                rows={3}
                value={consentMessageInput}
                onChange={(e) => setConsentMessageInput(e.target.value)}
                placeholder="예: 학사 일정에 따른 수업 시간표 조정을 위해 양해를 부탁드립니다."
                className="w-full border border-gray-200 rounded-xl p-3 text-xs focus:ring-2 focus:ring-indigo-500 resize-none bg-white text-gray-900"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setRequestingConsentDraft(null);
                  setRequestingConsentGroup(null);
                  setConsentMessageInput("");
                }}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  if (requestingConsentDraft) {
                    handleSendConsentRequest(requestingConsentDraft.id, consentMessageInput);
                  } else if (requestingConsentGroup) {
                    handleSendConsentGroupRequest(requestingConsentGroup, consentMessageInput);
                  }
                }}
                disabled={!!sendingConsentDraftId}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {sendingConsentDraftId ? "전송 중..." : "양해 요청 보내기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 조율 필요 후보 클릭 시 2단 경고 다이얼로그 */}
      {pendingCoordinationSelect && pendingCoordinationSelect.candidate.coordination && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-lg w-full p-6 space-y-4 animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 text-red-600 font-extrabold text-base border-b border-red-100 pb-3">
              <span className="text-xl">⚠️</span>
              <span>
                {pendingCoordinationSelect.candidate.coordination.simul
                  ? "당사자 양해 필요 (동시수업 묶음 이동)"
                  : "당사자 양해 필요 (장소 조율)"}
              </span>
            </div>
            
            <CoordinationNoticeBlock
              coordination={pendingCoordinationSelect.candidate.coordination}
              isReverse={!sourceLessonInfo?.simul && !!pendingCoordinationSelect.candidate.coordination?.simul}
            />

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

      {/* 조율 필요 후보 단건 즉시 반영 시 양해 확인 다이얼로그 */}
      {singleCommitConsentModalOpen && selectedCandidate?.coordination && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-red-200 max-w-lg w-full p-6 space-y-4 animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 text-red-600 font-extrabold text-base border-b border-red-100 pb-3">
              <span className="text-xl">⚡</span>
              <span>직권 즉시 반영 전 양해 확인</span>
            </div>

            <CoordinationNoticeBlock
              coordination={selectedCandidate.coordination}
              isReverse={!sourceLessonInfo?.simul && !!selectedCandidate.coordination?.simul}
            />

            <div className="space-y-2 pt-1 border-t border-gray-100">
              <label className="flex items-start gap-2 cursor-pointer bg-red-50/60 p-2.5 rounded-lg border border-red-200">
                <input
                  type="checkbox"
                  checked={singleCommitConsentConfirmed}
                  onChange={(e) => setSingleCommitConsentConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                />
                <span className="text-xs font-bold text-red-950">
                  위 선생님들께 사전 양해를 완료하였습니다 (필수)
                </span>
              </label>
              <input
                type="text"
                maxLength={200}
                value={singleCommitConsentNote}
                onChange={(e) => setSingleCommitConsentNote(e.target.value)}
                placeholder="양해 메모 (선택, 예: 시간표 조정 사전 합의)"
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
  );
}
