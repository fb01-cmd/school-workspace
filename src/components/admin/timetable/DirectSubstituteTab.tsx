"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  SubstituteCandidate,
  SwapCandidate,
  SwapReasonType,
  TeacherTimetableCell,
  TimetableWeek,
  DirectPendingOverlayItem,
  DirectCommitBatchItemResult,
} from "@/lib/timetable/types";
import { DAY_LABEL, formatSlotWithDate } from "@/lib/timetable/utils";
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
  consentChecked?: boolean;
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

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const getInitialWeekId = (weeksList: TimetableWeek[]): string => {
    if (!weeksList || weeksList.length === 0) return "";
    const todayStr = new Date().toISOString().slice(0, 10);
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
        setWeeks(data.weeks || []);
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
        if (selectedTeacherEmail) fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, data.weeks);
      }
    } catch {}
  };

  useEffect(() => {
    fetchTeachers();
    fetchWeeks();
  }, [activeTermId]);

  const toPendingPayload = (cart: CartItem[]) =>
    cart.map((item) => ({ weekId: item.weekId, ...(item.targetWeekId ? { targetWeekId: item.targetWeekId } : {}), type: item.type, source: item.source, candidate: item.candidate }));

  // §14-4: 그리드는 "담긴 상태의 예상 시간표" — 담기 누적분을 가상 적용한 direct_projected로 로드한다.
  // cart 인자를 명시하는 이유: setCartItems 직후에는 cartItems 바인딩이 구값이라 갱신분을 못 싣는다.
  const fetchTeacherTimetablesForAllWeeks = async (email: string, targetWeeks: TimetableWeek[] = weeks, cart: CartItem[] = cartItems) => {
    if (!email || targetWeeks.length === 0) return;
    setLoadingTimetable(true);
    setTimetableError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "direct_projected", teacherEmail: email, pendingItems: toPendingPayload(cart) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const newMap: Record<string, TeacherTimetableCell[]> = {};
        (data.weeks || []).forEach((w: { weekId: string; cells: TeacherTimetableCell[] }) => { newMap[w.weekId] = w.cells || []; });
        setTeacherWeekCellsMap(newMap);
      } else {
        setTimetableError(data.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (err: any) { setTimetableError(`네트워크 오류: ${err.message}`); } finally { setLoadingTimetable(false); }
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
      setSelectedTeacherEmail(""); setSelectedTeacherName(""); setTeacherWeekCellsMap({}); setSelectedSlot(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setSelectedCandidate(null); return;
    }
    const finalName = name || teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase())?.name || email.split("@")[0];
    setSelectedTeacherEmail(email); setSelectedTeacherName(finalName);
    setRecentTeachers((prev) => { const filtered = prev.filter((t) => t.email.toLowerCase() !== email.toLowerCase()); return [{ email, name: finalName }, ...filtered].slice(0, 5); });
    setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setSelectedCandidate(null); setCandidateError(null); setSuccessMsg(null); setSubmitError(null);
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

  const handleSlotClick = (weekId: string, cell: TeacherTimetableCell) => {
    const subj = cell.subjectShort || cell.subjectName || "수업";
    // 판정 단일 통로: 서버가 교사 그리드 응답에 실어 보낸 동시수업 라벨 (서버 커밋 검증이 최종 방어)
    if (cell.simul) {
      alert(`여러 반이 함께 듣는 이동수업이라 교체할 수 없습니다.\n묶음: ${cell.simul}`);
      return;
    }

    const slot = { weekId, grade: cell.grade, classNum: cell.classNum, day: cell.day, period: cell.period };
    setSelectedSlot(slot); setSelectedWeekId(weekId);
    setSourceLessonInfo({ subjectName: subj, teacherName: selectedTeacherName });
    fetchCandidates(weekId, cell.grade, cell.classNum, cell.day, cell.period, subj);
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
      candidate: { ...(activeCandidateType === "swap" ? { targetWeekId: targetWId || selectedSlot.weekId, targetDay: (selectedCandidate as any).targetDay, targetPeriod: (selectedCandidate as any).targetPeriod, counterpartEmail: (selectedCandidate as any).counterpartEmail, counterpartName: (selectedCandidate as any).counterpartName, counterpartSubjectName: (selectedCandidate as any).counterpartSubjectName, score: (selectedCandidate as any).score, penalties: (selectedCandidate as any).penalties || [] } : { counterpartEmail: (selectedCandidate as SubstituteCandidate).teacherEmail, counterpartName: (selectedCandidate as SubstituteCandidate).teacherName, score: 0, penalties: [] }) },
      counterpartName: activeCandidateType === "swap" ? (selectedCandidate as any).counterpartName : (selectedCandidate as SubstituteCandidate).teacherName,
      counterpartSubjectName: activeCandidateType === "swap" ? (selectedCandidate as any).counterpartSubjectName : "보강",
      counterpartEmail: activeCandidateType === "swap" ? (selectedCandidate as any).counterpartEmail : (selectedCandidate as SubstituteCandidate).teacherEmail,
      consentChecked: false,
    };
    const updatedCart = [...cartItems, newItem]; setCartItems(updatedCart); setSelectedCandidate(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null); setSuccessMsg(`🛒 담기 완료! 목록에 추가되었습니다. (총 ${updatedCart.length}건)`);
    // 담기 후에는 아이들 상태로 — 같은 슬롯 재탐색은 서버가 그 항목을 자기 충돌 방지로 제외해
    // 담기 전과 동일한 결과(선택·후보 하이라이트 잔존)만 재현한다. 재탐색은 다음 셀 클릭 때 cart 반영으로 수행.
    setSelectedSlot(null); setSourceLessonInfo(null); setSwapCandidateWeeks([]); setSubstituteCandidates([]); setCandidateError(null);
    // 그리드를 "담긴 상태의 예상 시간표"로 갱신 — 담긴 수업이 옮겨간 자리에 가상 마킹으로 나타난다
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
  };

  const handleClearCart = () => {
    setCartItems([]);
    setSuccessMsg(null); setSubmitError(null); // 담기 완료 등 이전 메시지도 함께 정리
    // 가상 반영 그리드를 빈 cart 기준으로 되돌린다 — 상태만 비우면 "담김 이동" 셀이 화면에 잔존
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, []);
    if (selectedSlot) fetchCandidates(selectedSlot.weekId, selectedSlot.grade, selectedSlot.classNum, selectedSlot.day, selectedSlot.period, sourceLessonInfo?.subjectName || "", []);
  };

  const handleRemoveFromCart = (id: string) => {
    const updatedCart = cartItems.filter((ci) => ci.id !== id);
    setCartItems(updatedCart);
    setSuccessMsg(null); setSubmitError(null); // 담기 완료 등 이전 메시지도 함께 정리
    fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, updatedCart);
    if (selectedSlot) fetchCandidates(selectedSlot.weekId, selectedSlot.grade, selectedSlot.classNum, selectedSlot.day, selectedSlot.period, sourceLessonInfo?.subjectName || "", updatedCart);
  };

  const handleGenerateConsolidatedCard = async (counterpartEmail: string) => {
    const counterpartItems = cartItems.filter((ci) => ci.counterpartEmail?.toLowerCase() === counterpartEmail.toLowerCase());
    if (counterpartItems.length === 0) return;
    setGeneratingShareFor(counterpartEmail);
    try {
      const counterpartName = counterpartItems[0].counterpartName || "선생님";
      const weekIds = Array.from(new Set(counterpartItems.flatMap((item) => [item.weekId, item.targetWeekId].filter(Boolean) as string[])));
      const weekBlocks = await Promise.all(weekIds.map(async (wId) => {
        const wObj = weeks.find((w) => w.id === wId);
        const cacheKey = `${counterpartEmail}_${wId}`;
        let cells: TeacherTimetableCell[] = [];
        if (previewCacheRef.current.has(cacheKey)) cells = previewCacheRef.current.get(cacheKey)!;
        else {
          const res = await fetch("/api/timetable/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "teacher", teacherEmail: counterpartEmail, weekId: wId }) });
          if (res.ok) { const data = await res.json(); cells = data.data?.cells || []; previewCacheRef.current.set(cacheKey, cells); }
        }
        const markers: ConsolidatedShareData["weekBlocks"][number]["markers"] = [];
        counterpartItems.forEach((item) => {
          // out(빠짐) 라벨도 반 코드로 — 맞교환은 같은 반 안에서 일어나므로 source의 반이 곧 상대 수업의 반
          const outLabel = `${item.source.grade}-${item.source.classNum}`;
          if (item.targetWeekId && item.targetWeekId !== item.weekId) {
            if (wId === item.weekId) markers.push({ day: item.source.day, period: item.source.period, kind: "in", label: `${item.source.grade}-${item.source.classNum}반 ${item.source.subjectName}` });
            if (wId === item.targetWeekId && item.candidate.targetDay && item.candidate.targetPeriod) markers.push({ day: item.candidate.targetDay, period: item.candidate.targetPeriod, kind: "out", label: outLabel });
          } else {
            if (wId === item.weekId) { markers.push({ day: item.source.day, period: item.source.period, kind: "in", label: `${item.source.grade}-${item.source.classNum}반 ${item.source.subjectName}` }); if (item.candidate.targetDay && item.candidate.targetPeriod) markers.push({ day: item.candidate.targetDay, period: item.candidate.targetPeriod, kind: "out", label: outLabel }); }
          }
        });
        return { weekId: wId, startDate: wObj?.startDate || wId, cells, markers };
      }));
      // 양해를 구하는 주체는 화면을 조작 중인 일과계/어드민 본인 — 수업 당사자(선택 교사) 명의가 아니다 (2026-08-06 사용자 확정).
      // 교환 목록의 수업 소유자 표기는 선택 교사 이름으로 명시해 "제 수업"으로 오독되지 않게 한다.
      const operatorName = teacherProfile?.name || user?.displayName || "일과 담당자";
      const shareData: ConsolidatedShareData = {
        requesterName: operatorName,
        senderLabel: operatorName, // 직책 없이 이름만 — "○○○입니다" (2026-08-06 사용자 확정: "일과계" 표기도 제외)
        ownerLabel: selectedTeacherName ? `${selectedTeacherName} 선생님의` : "해당",
        counterpartName,
        items: counterpartItems.map((ci) => ({ id: ci.id, sourceWeekId: ci.weekId, targetWeekId: ci.targetWeekId, source: ci.source, candidate: ci.candidate })),
        weekBlocks,
        periodsPerDay: 7,
      };
      setConsolidatedShareData(shareData);
      setTimeout(() => { copyShareImageElement(consolidatedCardRef.current).finally(() => setGeneratingShareFor(null)); }, 100);
    } catch (err: any) { alert(`양해 이미지 생성 실패: ${err.message}`); setGeneratingShareFor(null); }
  };

  const handleBatchCommit = async () => {
    if (cartItems.length === 0) { setSubmitError("담긴 항목이 없습니다."); return; }
    if (reasonType === "기타" && !reasonNote.trim()) { setSubmitError("사유가 '기타'인 경우 상세 메모를 입력해 주세요."); return; }
    if (!confirm(`담긴 ${cartItems.length}건의 직권 배정/수업교환을 승인 및 일괄 반영하시겠습니까?`)) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const payload = { action: "direct_commit_batch", items: cartItems.map((item) => ({ weekId: item.weekId, ...(item.targetWeekId ? { targetWeekId: item.targetWeekId } : {}), type: item.type, source: item.source, candidate: item.candidate, reason: { type: reasonType, note: reasonNote.trim() || undefined } })), reason: { type: reasonType, note: reasonNote.trim() || undefined } };
      const res = await fetch("/api/timetable/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "일괄 반영 처리 중 오류가 발생했습니다.");
      const results: DirectCommitBatchItemResult[] = data.results || [];
      const successIndices = new Set(results.filter((r) => r.ok).map((r) => r.index));
      // 실패 항목의 오류 사유는 원본 배열 인덱스로 대조해야 함 — filter 후 인덱스는 어긋난다
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
      // 성공분은 실 반영됐으므로 남은(실패) 항목만 가상 적용해 갱신 — 구 cartItems를 넘기면 이중 반영된다
      if (selectedTeacherEmail) await fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks, remainingCart);
    } catch (err: any) { setSubmitError(err.message || "일괄 반영 실패"); } finally { setSubmitting(false); }
  };

  const handleDirectCommitSingle = async () => {
    if (!selectedCandidate || !selectedSlot) { setSubmitError("배정할 후보(맞교환 또는 특별보강)를 선택해 주세요."); return; }
    if (reasonType === "기타" && !reasonNote.trim()) { setSubmitError("사유가 '기타'인 경우 상세 메모를 입력해 주세요."); return; }
    if (!confirm("선택한 후보로 직권 수업교환/특별보강을 즉시 승인 및 적용하시겠습니까?")) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const sourceWeekId = selectedSlot.weekId;
      const targetWeekId = activeCandidateType === "swap" ? (selectedCandidate as any)?.targetWeekId : undefined;
      let candidateSnapshot: any;
      if (activeCandidateType === "swap") {
        const sc = selectedCandidate as any;
        candidateSnapshot = { targetWeekId: targetWeekId || sourceWeekId, targetDay: sc.targetDay, targetPeriod: sc.targetPeriod, counterpartEmail: sc.counterpartEmail, counterpartName: sc.counterpartName, counterpartSubjectName: sc.counterpartSubjectName, score: sc.score, penalties: sc.penalties || [] };
      } else {
        const subc = selectedCandidate as SubstituteCandidate;
        candidateSnapshot = { counterpartEmail: subc.teacherEmail, counterpartName: subc.teacherName, score: 0, penalties: [] };
      }
      const commitRes = await fetch("/api/timetable/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "direct_commit", weekId: sourceWeekId, ...(activeCandidateType === "swap" && targetWeekId ? { targetWeekId } : {}), type: activeCandidateType, source: { grade: selectedSlot.grade, classNum: selectedSlot.classNum, day: selectedSlot.day, period: selectedSlot.period, subjectName: sourceLessonInfo?.subjectName || "" }, candidate: candidateSnapshot, reason: { type: reasonType, note: reasonNote.trim() || undefined } }) });
      const commitData = await commitRes.json();
      if (!commitRes.ok || !commitData.success) throw new Error(commitData.error || "직권 배정 처리 중 오류가 발생했습니다.");
      setSuccessMsg(`⚡ 직권 배정 완료! ${selectedSlot.grade}학년 ${selectedSlot.classNum}반 ${formatSlotWithDate(sourceWeekId, selectedSlot.day, selectedSlot.period)} 수업이 성공적으로 처리 및 반영되었습니다.`);
      const updatedWeeks = [sourceWeekId, targetWeekId].filter((wId): wId is string => Boolean(wId));
      setRecentlyUpdatedWeeks(updatedWeeks);
      setSelectedCandidate(null); setPreviewCells(null); setCounterpartSourceCells(null); setCounterpartTargetCells(null);
      if (selectedTeacherEmail) await fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks);
    } catch (err: any) { setSubmitError(err.message || "직권 배정 실패"); } finally { setSubmitting(false); }
  };

  const getCellForSlotInWeek = (wId: string, d: number, p: number) => { const cells = teacherWeekCellsMap[wId] || []; return cells.filter((c) => c.day === d && c.period === p); };
  const totalSwapCount = swapCandidateWeeks.reduce((acc, w) => acc + (w.swapCandidates?.length || 0), 0);
  const DAYS = [{ num: 1, label: "월요일" }, { num: 2, label: "화요일" }, { num: 3, label: "수요일" }, { num: 4, label: "목요일" }, { num: 5, label: "금요일" }];

  const groupedCartByCounterpart = cartItems.reduce((acc, item) => { const email = item.counterpartEmail || "unknown"; if (!acc[email]) acc[email] = []; acc[email].push(item); return acc; }, {} as Record<string, CartItem[]>);
  const sourceWeekObj = weeks.find((w) => w.id === selectedSlot?.weekId);
  const targetWeekId = selectedCandidate?.targetWeekId || selectedSlot?.weekId || "";
  const targetWeekObj = weeks.find((w) => w.id === targetWeekId);
  const isCrossWeek = !!(targetWeekId && selectedSlot?.weekId && targetWeekId !== selectedSlot.weekId);

  return (
    <div className="space-y-6">
      <OffscreenConsolidatedShareCard cardRef={consolidatedCardRef} data={consolidatedShareData} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <span>⚡</span>
          <span>일과계 직권 배정</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          교사를 선택하면 그 교사의 모든 주 시간표가 함께 표시됩니다. 수업을 고르고 후보를 선택해 여러 건을 [담기]로 모은 뒤 한 번에 반영할 수 있으며, 상대 선생님께 보낼 양해 이미지도 만들 수 있습니다.
        </p>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>✅ {successMsg}</span>
          {recentlyUpdatedWeeks.length > 0 && <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-extrabold">✨ 변경된 주간 그리드 재조회 완료</span>}
        </div>
      )}
      {submitError && <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">⚠️ {submitError}</div>}

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

            {weeks.map((w) => {
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
                    {selectedSlot && <span className="text-[11px] text-gray-500 font-semibold">맞교환 후보 {candidateListInWeek.length}건</span>}
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
                                const matchedCells = getCellForSlotInWeek(w.id, d.num, period);
                                const hasLesson = matchedCells.length > 0;
                                const cartMatch = cartItems.find((ci) => ci.weekId === w.id && ci.source.day === d.num && ci.source.period === period);
                                const inlineCand = !hasLesson && selectedSlot ? candidateListInWeek.find((cand) => cand.targetDay === d.num && cand.targetPeriod === period) : null;
                                return (
                                  <td key={d.num} className={`p-1 border-r border-gray-100 text-center align-top transition-all ${hasLesson ? "bg-indigo-50/30" : inlineCand ? "bg-emerald-50/50" : ""}`}>
                                    {hasLesson ? (
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
                                      <button type="button" onClick={() => handleSelectCandidate(inlineCand, w.id, w.startDate)} className={`w-full p-1.5 rounded-lg text-left transition-all cursor-pointer border ${activeCandidateType === "swap" && selectedCandidate?.targetWeekId === w.id && selectedCandidate?.targetDay === inlineCand.targetDay && selectedCandidate?.targetPeriod === inlineCand.targetPeriod && selectedCandidate?.counterpartEmail === inlineCand.counterpartEmail ? "bg-emerald-600 text-white border-emerald-700 shadow-md ring-2 ring-emerald-300 scale-[1.02]" : "bg-emerald-50 hover:bg-emerald-100/90 border-emerald-300 hover:border-emerald-500 text-emerald-950 shadow-2xs"}`}>
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-black text-[11px] truncate">{inlineCand.counterpartName}</span>
                                          <span className={`px-1 py-0.5 rounded text-[9px] font-extrabold shrink-0 ${inlineCand.score > 0 || (inlineCand.penalties && inlineCand.penalties.length > 0) ? "bg-amber-100 text-amber-900 border border-amber-300" : "bg-emerald-200 text-emerald-900"}`}>{inlineCand.score > 0 || (inlineCand.penalties && inlineCand.penalties.length > 0) ? `감점 ${inlineCand.score}` : "0점"}</span>
                                        </div>
                                        <div className="text-[10px] mt-0.5 font-bold truncate text-emerald-800">{inlineCand.counterpartSubjectName}</div>
                                      </button>
                                    ) : cartMatch ? (
                                      /* 담긴 수업이 빠져나간 원래 자리 — 이동 사실만 흐리게 남긴다 */
                                      <div className="w-full p-1.5 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 text-center">
                                        <div className="text-[9px] font-extrabold text-amber-800">🛒 담김 (이동됨)</div>
                                        <div className="text-[10px] font-bold text-amber-900 truncate">{cartMatch.source.subjectName || "수업"}</div>
                                      </div>
                                    ) : (<span className="text-[11px] text-gray-300 font-light block py-2">-</span>)}
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
          </div>

          <div className="lg:col-span-4 space-y-6 sticky top-4">
            {selectedSlot && sourceLessonInfo && (
              <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5"><span>3️⃣ 후보 상세 및 미리보기</span></h3>
                  <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg text-[11px] font-bold">
                    <button type="button" onClick={() => { setActiveCandidateType("swap"); setSelectedCandidate(null); setPreviewCells(null); }} className={`px-2 py-1 rounded transition-all ${activeCandidateType === "swap" ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-600 hover:text-gray-900"}`}>↔️ 맞교환</button>
                    <button type="button" onClick={() => { setActiveCandidateType("substitute"); setSelectedCandidate(null); setPreviewCells(null); }} className={`px-2 py-1 rounded transition-all ${activeCandidateType === "substitute" ? "bg-white text-indigo-700 shadow-2xs" : "text-gray-600 hover:text-gray-900"}`}>👤 보강</button>
                  </div>
                </div>
                {loadingCandidates && <div className="p-4 text-center text-xs text-indigo-600 font-semibold animate-pulse">🔍 맞교환/보강 후보 탐색 중...</div>}
                {selectedCandidate && (
                  <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                    <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-xs text-indigo-950">{activeCandidateType === "swap" ? `🔄 ${selectedCandidate.counterpartName} 교사 (${selectedCandidate.counterpartSubjectName})` : `👤 ${selectedCandidate.teacherName} 선생님`}</span>
                      </div>
                      {activeCandidateType === "swap" && (
                        (selectedCandidate.penalties?.length ?? 0) > 0 || selectedCandidate.score > 0 ? (
                          <div className="text-[11px] space-y-0.5 pt-1 border-t border-indigo-100">
                            <div className="font-extrabold text-amber-900">⚠️ 감점 {selectedCandidate.score}점 — 사유</div>
                            <ul className="list-disc list-inside text-amber-800 space-y-0.5">
                              {(selectedCandidate.penalties || []).map((p: string, i: number) => (<li key={i}>{p}</li>))}
                              {(selectedCandidate.penalties?.length ?? 0) === 0 && <li>사유 정보 없음</li>}
                            </ul>
                          </div>
                        ) : (
                          <div className="text-[11px] font-bold text-emerald-700 pt-1 border-t border-indigo-100">✨ 감점 없음 (0점) — 상대 교사 부담 없는 교환입니다.</div>
                        )
                      )}
                    </div>
                    {activeCandidateType === "swap" && (
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-gray-700 flex items-center justify-between"><span>🗓️ 상대 교사 시간표 미리보기</span>{previewLoading && <span className="text-[10px] text-indigo-600 animate-pulse">로딩 중...</span>}</div>
                        <MiniPreviewGrid isCrossWeek={isCrossWeek} sourceWeekId={selectedSlot.weekId} targetWeekId={targetWeekId} sourceWeekObj={sourceWeekObj} targetWeekObj={targetWeekObj} selectedCell={{ grade: selectedSlot.grade, classNum: selectedSlot.classNum, day: selectedSlot.day, period: selectedSlot.period, subjectName: sourceLessonInfo.subjectName }} applyingCandidate={{ targetDay: selectedCandidate.targetDay, targetPeriod: selectedCandidate.targetPeriod, counterpartName: selectedCandidate.counterpartName, counterpartSubjectName: selectedCandidate.counterpartSubjectName }} periodsPerDay={7} previewCells={previewCells} counterpartSourceCells={counterpartSourceCells} counterpartTargetCells={counterpartTargetCells} counterpartTitle={selectedCandidate.counterpartName} />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      <button type="button" onClick={handleAddToCart} className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-1"><span>🛒</span><span>담기</span></button>
                      <button type="button" onClick={handleDirectCommitSingle} disabled={submitting} className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-1 disabled:opacity-50"><span>⚡</span><span>즉시 1건 반영</span></button>
                    </div>
                  </div>
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
                        <div className="text-[11px] text-gray-700">➔ 상대: <strong className="text-gray-900">{item.counterpartName}</strong> ({item.counterpartSubjectName})</div>
                        {item.lastError && <div className="text-[10px] text-red-700 font-bold bg-red-50 border border-red-200 rounded px-1.5 py-1">⚠️ 반영 실패: {item.lastError}</div>}
                        <label className="flex items-center gap-1.5 text-[10px] text-gray-600 cursor-pointer pt-1 border-t border-gray-100">
                          <input type="checkbox" checked={item.consentChecked === true} onChange={(e) => { const checked = e.target.checked; setCartItems((prev) => prev.map((ci) => (ci.id === item.id ? { ...ci, consentChecked: checked } : ci))); }} />
                          <span>사전 양해 확인</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-gray-100 space-y-2">
                    <div className="text-[11px] font-bold text-gray-700">📨 양해 구하기 (상대별 이미지 복사):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.keys(groupedCartByCounterpart).map((cpEmail) => (
                        <button key={cpEmail} type="button" onClick={() => handleGenerateConsolidatedCard(cpEmail)} disabled={generatingShareFor === cpEmail} className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-bold text-[11px] rounded-lg disabled:opacity-60">
                          {generatingShareFor === cpEmail ? "이미지 생성 중…" : `📸 ${groupedCartByCounterpart[cpEmail][0]?.counterpartName} 선생님 (${groupedCartByCounterpart[cpEmail].length}건)`}
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
    </div>
  );
}

