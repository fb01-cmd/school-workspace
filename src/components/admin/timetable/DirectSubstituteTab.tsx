"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  SubstituteCandidate,
  SwapCandidate,
  SwapReasonType,
  TeacherTimetableCell,
  TimetableWeek,
} from "@/lib/timetable/types";
import { DAY_LABEL, formatSlotWithDate } from "@/lib/timetable/utils";

interface DirectSubstituteTabProps {
  activeTermId: string | null;
}

interface WeekCandidateGroup {
  weekId: string;
  startDate: string;
  note?: string;
  swapCandidates: SwapCandidate[];
}

export default function DirectSubstituteTab({ activeTermId }: DirectSubstituteTabProps) {
  const { userData } = useAuth();

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");

  // 교사 목록 (action: "teachers" — 가나다순 교사 목록)
  const [teacherList, setTeacherList] = useState<Array<{ email: string; name: string }>>([]);
  const [teacherListLoading, setTeacherListLoading] = useState(false);

  // Step 1: 교사 선택 상태
  const [selectedTeacherEmail, setSelectedTeacherEmail] = useState("");
  const [selectedTeacherName, setSelectedTeacherName] = useState("");
  const [recentTeachers, setRecentTeachers] = useState<Array<{ email: string; name: string }>>([]);

  // Step 2: 등록된 주별 교사 시간표 상태 (view "teacher" + weekId 주별 병렬 호출 결과)
  const [teacherWeekCellsMap, setTeacherWeekCellsMap] = useState<Record<string, TeacherTimetableCell[]>>({});
  const [loadingTimetable, setLoadingTimetable] = useState(false);
  const [timetableError, setTimetableError] = useState<string | null>(null);

  // 최근 직권 배정으로 업데이트된 주간 ID (결과 시각 확인용)
  const [recentlyUpdatedWeeks, setRecentlyUpdatedWeeks] = useState<string[]>([]);

  // 선택된 원 수업 슬롯 (주간 ID 포함)
  const [selectedSlot, setSelectedSlot] = useState<{
    weekId: string;
    grade: number;
    classNum: number;
    day: number;
    period: number;
  } | null>(null);

  // Step 3: 후보 탐색 결과 및 승인 상태
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [sourceLessonInfo, setSourceLessonInfo] = useState<{
    subjectName: string;
    teacherName?: string;
  } | null>(null);

  // direct_candidates_all 응답의 주별 맞교환 후보 그룹
  const [swapCandidateWeeks, setSwapCandidateWeeks] = useState<WeekCandidateGroup[]>([]);
  // 특별보강 후보 (해당 주 한정)
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [activeCandidateType, setActiveCandidateType] = useState<"swap" | "substitute">("swap");

  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [reasonType, setReasonType] = useState<SwapReasonType>("기타");
  const [reasonNote, setReasonNote] = useState("일과계 직권 배정");

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 교사 목록 로딩 (action: "teachers")
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
        if (Array.isArray(data.data)) {
          setTeacherList(data.data);
        }
      }
    } catch {
      // 무시
    } finally {
      setTeacherListLoading(false);
    }
  };

  // 등록된 주 목록 조회
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
        if (data.weeks.length > 0 && !selectedWeekId) {
          setSelectedWeekId(data.weeks[0].id);
        }
        if (selectedTeacherEmail) {
          fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, data.weeks);
        }
      }
    } catch {
      // 무시
    }
  };

  useEffect(() => {
    fetchTeachers();
    fetchWeeks();
  }, [activeTermId]);

  // 선택 교사의 등록된 각 주 시간표를 주별 병렬 조회 (§14-2 requirement ①)
  const fetchTeacherTimetablesForAllWeeks = async (
    email: string,
    targetWeeks: TimetableWeek[] = weeks
  ) => {
    if (!email || targetWeeks.length === 0) return;
    setLoadingTimetable(true);
    setTimetableError(null);

    try {
      const results = await Promise.all(
        targetWeeks.map(async (w) => {
          const res = await fetch("/api/timetable/view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "teacher",
              teacherEmail: email,
              weekId: w.id,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            return {
              weekId: w.id,
              cells: (data.data?.cells || []) as TeacherTimetableCell[],
              teacherName: data.data?.teacherName as string | undefined,
            };
          }
          return { weekId: w.id, cells: [], teacherName: undefined };
        })
      );

      const newMap: Record<string, TeacherTimetableCell[]> = {};
      let foundName = "";
      results.forEach((r) => {
        newMap[r.weekId] = r.cells;
        if (r.teacherName) foundName = r.teacherName;
      });

      setTeacherWeekCellsMap(newMap);
      if (foundName) setSelectedTeacherName(foundName);
    } catch (err: any) {
      setTimetableError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoadingTimetable(false);
    }
  };

  // 교사 선택 처리
  const handleSelectTeacher = (email: string, name?: string) => {
    if (!email) {
      setSelectedTeacherEmail("");
      setSelectedTeacherName("");
      setTeacherWeekCellsMap({});
      setSelectedSlot(null);
      setSwapCandidateWeeks([]);
      setSubstituteCandidates([]);
      setSelectedCandidate(null);
      return;
    }

    const finalName =
      name ||
      teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase())?.name ||
      email.split("@")[0];
    setSelectedTeacherEmail(email);
    setSelectedTeacherName(finalName);

    // 최근 선택한 교사 목록 업데이트 (최대 5명 중복제거)
    setRecentTeachers((prev) => {
      const filtered = prev.filter((t) => t.email.toLowerCase() !== email.toLowerCase());
      return [{ email, name: finalName }, ...filtered].slice(0, 5);
    });

    // 슬롯 및 후보 목록 초기화
    setSelectedSlot(null);
    setSourceLessonInfo(null);
    setSwapCandidateWeeks([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setCandidateError(null);
    setSuccessMsg(null);
    setSubmitError(null);

    // 등록된 모든 주의 시간표 병렬 로딩
    fetchTeacherTimetablesForAllWeeks(email, weeks);
  };

  // 주간 변경 처리
  const handleWeekChange = (weekId: string) => {
    setSelectedWeekId(weekId);
    setSelectedSlot(null);
    setSourceLessonInfo(null);
    setSwapCandidateWeeks([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setSuccessMsg(null);
    setSubmitError(null);
    if (selectedTeacherEmail) {
      fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks);
    }
  };

  // 후보 탐색 API 호출 (direct_candidates_all + direct_candidates 병렬)
  const fetchCandidates = async (
    weekId: string,
    grade: number,
    classNum: number,
    day: number,
    period: number,
    subjectName: string
  ) => {
    if (!weekId) {
      setCandidateError("주간(Week)을 선택해 주세요.");
      return;
    }

    setLoadingCandidates(true);
    setCandidateError(null);
    setSwapCandidateWeeks([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setSuccessMsg(null);
    setSubmitError(null);

    try {
      // 맞교환은 전 주 일괄(direct_candidates_all), 특별보강은 해당 주 한정(direct_candidates) — 병렬 호출
      const [res, subRes] = await Promise.all([
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "direct_candidates_all",
            weekId,
            source: { grade, classNum, day, period },
            teacherEmail: selectedTeacherEmail,
          }),
        }),
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "direct_candidates",
            weekId,
            source: { grade, classNum, day, period },
          }),
        }),
      ]);

      const data = await res.json();
      const subData = await subRes.json().catch(() => ({} as any));
      if (res.ok && data.success) {
        setSourceLessonInfo({
          subjectName: data.sourceSubjectName || data.sourceTeacher?.subjectName || subjectName,
          teacherName: data.sourceTeacher?.teacherName || selectedTeacherName,
        });
        setSwapCandidateWeeks(data.weeks || []);
        setSubstituteCandidates(
          subRes.ok && subData.success ? subData.substituteCandidates || [] : []
        );
      } else {
        setCandidateError(data.error || "후보를 탐색할 수 없습니다.");
      }
    } catch (err: any) {
      setCandidateError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoadingCandidates(false);
    }
  };

  // 시간표 그리드 셀 클릭 핸들러 (원 수업 클릭)
  const handleSlotClick = (weekId: string, cell: TeacherTimetableCell) => {
    const slot = {
      weekId,
      grade: cell.grade,
      classNum: cell.classNum,
      day: cell.day,
      period: cell.period,
    };
    setSelectedSlot(slot);
    setSelectedWeekId(weekId);
    const subj = cell.subjectShort || cell.subjectName || "수업";
    setSourceLessonInfo({ subjectName: subj, teacherName: selectedTeacherName });

    fetchCandidates(weekId, cell.grade, cell.classNum, cell.day, cell.period, subj);
  };

  // 직권 배정 등록 및 즉시 승인 실행
  const handleDirectCommit = async () => {
    if (!selectedCandidate || !selectedSlot) {
      setSubmitError("배정할 후보(맞교환 또는 특별보강)를 선택해 주세요.");
      return;
    }
    if (reasonType === "기타" && !reasonNote.trim()) {
      setSubmitError("사유가 '기타'인 경우 상세 메모를 입력해 주세요.");
      return;
    }

    if (!confirm("선택한 후보로 직권 수업교환/특별보강을 즉시 승인 및 적용하시겠습니까?")) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const sourceWeekId = selectedSlot.weekId || selectedWeekId;
      const targetWeekId = activeCandidateType === "swap" ? (selectedCandidate as any)?.targetWeekId : undefined;

      let candidateSnapshot: any;
      if (activeCandidateType === "swap") {
        const sc = selectedCandidate as any;
        candidateSnapshot = {
          targetWeekId: targetWeekId || sourceWeekId, // 선택된 교차 주의 weekId 전달
          targetDay: sc.targetDay,
          targetPeriod: sc.targetPeriod,
          counterpartEmail: sc.counterpartEmail,
          counterpartName: sc.counterpartName,
          counterpartSubjectName: sc.counterpartSubjectName,
          score: sc.score,
          penalties: sc.penalties || [],
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

      const commitRes = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_commit",
          weekId: sourceWeekId,
          // 교차 주 맞교환 — 서버는 body.targetWeekId만 읽는다 (d9857c8 필수 유지 로직)
          ...(activeCandidateType === "swap" && targetWeekId
            ? { targetWeekId }
            : {}),
          type: activeCandidateType,
          source: {
            grade: selectedSlot.grade,
            classNum: selectedSlot.classNum,
            day: selectedSlot.day,
            period: selectedSlot.period,
            subjectName: sourceLessonInfo?.subjectName || "",
          },
          candidate: candidateSnapshot,
          reason: {
            type: reasonType,
            note: reasonNote.trim() || undefined,
          },
        }),
      });

      const commitData = await commitRes.json();
      if (!commitRes.ok || !commitData.success) {
        throw new Error(commitData.error || "직권 배정 처리 중 오류가 발생했습니다.");
      }

      setSuccessMsg(
        `⚡ 직권 배정 완료! ${selectedSlot.grade}학년 ${selectedSlot.classNum}반 ${formatSlotWithDate(
          sourceWeekId,
          selectedSlot.day,
          selectedSlot.period
        )} 수업이 성공적으로 처리 및 반영되었습니다.`
      );

      // 반영 성공 시 소스 주·대상 주 그리드 모두 변경 마킹 (§14-2 requirement ③)
      const updatedWeeks = [sourceWeekId, targetWeekId].filter((wId): wId is string => Boolean(wId));
      setRecentlyUpdatedWeeks(updatedWeeks);

      // 리프레시: 전체 주 그리드 병렬 재조회 및 후보 초기화/재탐색
      setSelectedCandidate(null);
      if (selectedTeacherEmail) {
        await fetchTeacherTimetablesForAllWeeks(selectedTeacherEmail, weeks);
      }
      fetchCandidates(
        sourceWeekId,
        selectedSlot.grade,
        selectedSlot.classNum,
        selectedSlot.day,
        selectedSlot.period,
        sourceLessonInfo?.subjectName || ""
      );
    } catch (err: any) {
      setSubmitError(err.message || "직권 배정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const getCellForSlotInWeek = (wId: string, d: number, p: number) => {
    const cells = teacherWeekCellsMap[wId] || [];
    return cells.filter((c) => c.day === d && c.period === p);
  };

  const totalSwapCount = swapCandidateWeeks.reduce(
    (acc, w) => acc + (w.swapCandidates?.length || 0),
    0
  );

  const DAYS = [
    { num: 1, label: "월요일" },
    { num: 2, label: "화요일" },
    { num: 3, label: "수요일" },
    { num: 4, label: "목요일" },
    { num: 5, label: "금요일" },
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 안내 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <span>⚡</span>
          <span>일과계 직권 배정 (주별 그리드 인라인 후보 방식)</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          교사를 선택하면 해당 교사의 등록된 전 주 시간표가 주별 스택으로 표시됩니다. 원 수업 셀을 클릭하면 모든 주의 공강 셀 위에 맞교환 후보가 인라인 하이라이트로 직접 표시됩니다.
        </p>
      </div>

      {/* 성공/오류 메시지 */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>✅ {successMsg}</span>
          {recentlyUpdatedWeeks.length > 0 && (
            <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-1 rounded font-extrabold">
              ✨ 변경된 주간 그리드 재조회 완료
            </span>
          )}
        </div>
      )}
      {submitError && (
        <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">
          ⚠️ {submitError}
        </div>
      )}

      {/* Step 1: 주간 및 교사 선택 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {/* 주요 대상 주간 선택 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">1️⃣ 주간 선택 (초기 강조)</label>
            <select
              value={selectedWeekId}
              onChange={(e) => handleWeekChange(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white text-xs"
            >
              {weeks.length === 0 && <option value="">등록된 주가 없습니다</option>}
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.startDate} 주간 ({w.note || w.id})
                </option>
              ))}
            </select>
          </div>

          {/* 교사 드롭다운 선택 (view "teachers" 액션 기반 가나다순) */}
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-gray-700 mb-1">2️⃣ 대상 교사 선택 (가나다순)</label>
            <select
              value={selectedTeacherEmail}
              onChange={(e) => {
                const email = e.target.value;
                const found = teacherList.find((t) => t.email.toLowerCase() === email.toLowerCase());
                handleSelectTeacher(email, found?.name);
              }}
              disabled={teacherListLoading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white text-xs disabled:opacity-60"
            >
              <option value="">-- 교사를 선택해 주세요 --</option>
              {teacherListLoading && <option value="">교사 목록 불러오는 중...</option>}
              {!teacherListLoading &&
                teacherList.map((t) => (
                  <option key={t.email} value={t.email}>
                    {t.name} ({t.email})
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* 최근 선택 교사 바로가기 버튼 */}
        {recentTeachers.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 text-xs">
            <span className="text-gray-500 font-bold shrink-0">최근 선택:</span>
            <div className="flex flex-wrap gap-1.5">
              {recentTeachers.map((t) => (
                <button
                  key={t.email}
                  type="button"
                  onClick={() => handleSelectTeacher(t.email, t.name)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                    selectedTeacherEmail.toLowerCase() === t.email.toLowerCase()
                      ? "bg-indigo-600 text-white font-bold shadow-xs"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  👤 {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step 2: 선택 교사의 등록된 주별 시간표 스택 (§14-2 requirement ①) */}
      {selectedTeacherEmail ? (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                <span>🗓️</span>
                <span>{selectedTeacherName} 교사의 등록 주별 시간표 ({weeks.length}개 주간)</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                원 수업 셀을 클릭하면 하단 각 주 그리드의 공강 위치에 맞교환 가능 후보가 인라인 하이라이트로 표시됩니다.
              </p>
            </div>
            {loadingTimetable && (
              <span className="text-xs text-indigo-600 font-semibold animate-pulse">전 주 시간표 병렬 로딩 중...</span>
            )}
          </div>

          {timetableError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center font-bold">
              {timetableError}
            </div>
          )}

          {/* 등록된 각 주 그리드를 주별 스택으로 표시 */}
          {weeks.map((w) => {
            const isSourceWeek = selectedSlot?.weekId === w.id;
            const isRecentlyUpdated = recentlyUpdatedWeeks.includes(w.id);
            const weekCandidateGroup = swapCandidateWeeks.find((gw) => gw.weekId === w.id);
            const candidateListInWeek = weekCandidateGroup?.swapCandidates || [];

            return (
              <div
                key={w.id}
                className={`bg-white rounded-xl shadow-sm border transition-all ${
                  isSourceWeek
                    ? "border-indigo-500 ring-2 ring-indigo-200"
                    : isRecentlyUpdated
                    ? "border-emerald-500 ring-2 ring-emerald-100"
                    : "border-gray-200"
                } p-5 space-y-3`}
              >
                {/* 주간 헤더 */}
                <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-xs bg-indigo-900 text-white px-2.5 py-1 rounded-md">
                      📅 {w.startDate} 주간 {w.note ? `(${w.note})` : ""}
                    </span>
                    {isSourceWeek && (
                      <span className="text-[11px] font-bold bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-full border border-indigo-200">
                        📌 원 수업 소스 주간
                      </span>
                    )}
                    {isRecentlyUpdated && (
                      <span className="text-[11px] font-bold bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-full border border-emerald-300">
                        ✨ 배정 결과 반영됨
                      </span>
                    )}
                  </div>

                  {selectedSlot && (
                    <span className="text-[11px] text-gray-500 font-semibold">
                      맞교환 후보 {candidateListInWeek.length}건
                    </span>
                  )}
                </div>

                {/* 그리드 테이블 */}
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-indigo-950 text-white font-bold">
                        <th className="py-2.5 px-2 border-b border-r border-indigo-800 w-16 text-center">교시</th>
                        {DAYS.map((d) => (
                          <th key={d.num} className="py-2.5 px-2 border-b border-indigo-800 text-center">
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
                              const matchedCells = getCellForSlotInWeek(w.id, d.num, period);
                              const hasLesson = matchedCells.length > 0;

                              // §14-2 requirement ②: 해당 주 그리드의 공강 셀 위에 인라인 하이라이트
                              const inlineCand =
                                !hasLesson && selectedSlot
                                  ? candidateListInWeek.find(
                                      (cand) => cand.targetDay === d.num && cand.targetPeriod === period
                                    )
                                  : null;

                              return (
                                <td
                                  key={d.num}
                                  className={`p-1.5 border-r border-gray-100 text-center align-top transition-all ${
                                    hasLesson ? "bg-indigo-50/30" : inlineCand ? "bg-emerald-50/50" : ""
                                  }`}
                                >
                                  {hasLesson ? (
                                    <div className="space-y-1">
                                      {matchedCells.map((cell, cIdx) => {
                                        const isSelected =
                                          selectedSlot?.weekId === w.id &&
                                          selectedSlot?.grade === cell.grade &&
                                          selectedSlot?.classNum === cell.classNum &&
                                          selectedSlot?.day === cell.day &&
                                          selectedSlot?.period === cell.period;

                                        return (
                                          <button
                                            key={cIdx}
                                            type="button"
                                            onClick={() => handleSlotClick(w.id, cell)}
                                            className={`w-full p-2 rounded-lg text-left transition-all cursor-pointer border ${
                                              isSelected
                                                ? "bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-300 scale-[1.02]"
                                                : "bg-white hover:bg-indigo-100/60 border-indigo-200 hover:border-indigo-400 text-gray-900 shadow-2xs"
                                            }`}
                                          >
                                            <div
                                              className={`font-black text-xs ${
                                                isSelected ? "text-white" : "text-indigo-950"
                                              }`}
                                            >
                                              {cell.subjectShort || cell.subjectName}
                                            </div>
                                            <div
                                              className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold mt-1 ${
                                                isSelected
                                                  ? "bg-indigo-800 text-indigo-100"
                                                  : "bg-indigo-100 text-indigo-800"
                                              }`}
                                            >
                                              {cell.grade}-{cell.classNum}반
                                            </div>
                                            {cell.room && (
                                              <div
                                                className={`text-[10px] mt-0.5 truncate ${
                                                  isSelected ? "text-indigo-200" : "text-gray-500"
                                                }`}
                                              >
                                                📍 {cell.room}
                                              </div>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : inlineCand ? (
                                    /* 인라인 후보 하이라이트 표시 (클릭=후보 선택) */
                                    (() => {
                                      const isSelectedCandidate =
                                        activeCandidateType === "swap" &&
                                        selectedCandidate?.targetWeekId === w.id &&
                                        selectedCandidate?.targetDay === inlineCand.targetDay &&
                                        selectedCandidate?.targetPeriod === inlineCand.targetPeriod &&
                                        selectedCandidate?.counterpartEmail === inlineCand.counterpartEmail;

                                      return (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSelectedCandidate({
                                              ...inlineCand,
                                              targetWeekId: w.id,
                                              targetWeekStartDate: w.startDate,
                                            });
                                            setActiveCandidateType("swap");
                                            setSubmitError(null);
                                          }}
                                          className={`w-full p-2 rounded-lg text-left transition-all cursor-pointer border ${
                                            isSelectedCandidate
                                              ? "bg-emerald-600 text-white border-emerald-700 shadow-md ring-2 ring-emerald-300 scale-[1.02]"
                                              : "bg-emerald-50 hover:bg-emerald-100/90 border-emerald-300 hover:border-emerald-500 text-emerald-950 shadow-2xs"
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-1">
                                            <span
                                              className={`font-black text-[11px] truncate ${
                                                isSelectedCandidate ? "text-white" : "text-emerald-950"
                                              }`}
                                            >
                                              🔄 {inlineCand.counterpartName}
                                            </span>
                                            <span
                                              className={`px-1 py-0.5 rounded text-[9px] font-extrabold shrink-0 ${
                                                isSelectedCandidate
                                                  ? "bg-emerald-800 text-white"
                                                  : inlineCand.score > 0 || (inlineCand.penalties && inlineCand.penalties.length > 0)
                                                  ? "bg-amber-100 text-amber-900 border border-amber-300"
                                                  : "bg-emerald-200 text-emerald-900"
                                              }`}
                                            >
                                              {inlineCand.score > 0 || (inlineCand.penalties && inlineCand.penalties.length > 0)
                                                ? `감점 ${inlineCand.score}`
                                                : "0점"}
                                            </span>
                                          </div>
                                          <div
                                            className={`text-[10px] mt-0.5 font-bold truncate ${
                                              isSelectedCandidate ? "text-emerald-100" : "text-emerald-800"
                                            }`}
                                          >
                                            {inlineCand.counterpartSubjectName}
                                          </div>
                                        </button>
                                      );
                                    })()
                                  ) : (
                                    <span className="text-[11px] text-gray-300 font-light block py-3">
                                      -
                                    </span>
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
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 space-y-2">
          <span className="text-3xl">👈</span>
          <p className="font-bold text-gray-800 text-sm">위 2단계 드롭다운에서 직권 배정할 대상 교사를 선택해 주세요.</p>
          <p className="text-xs text-gray-400">교사를 선택하면 해당 교사의 등록된 전 주 시간표가 주별 스택으로 표시됩니다.</p>
        </div>
      )}

      {/* Step 3: 후보 탐색 결과 축소 요약 카드 목록 및 직권 반영 패널 */}
      {candidateError && (
        <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">
          ⚠️ {candidateError}
        </div>
      )}

      {selectedSlot && sourceLessonInfo && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-100 pb-3 gap-3">
            <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
              <span>3️⃣</span>
              <span>
                후보 요약 — {selectedSlot.grade}학년 {selectedSlot.classNum}반 {DAY_LABEL[selectedSlot.day] || selectedSlot.day}요일 {selectedSlot.period}교시 ({sourceLessonInfo.subjectName}
                {sourceLessonInfo.teacherName ? ` · ${sourceLessonInfo.teacherName} 교사` : ""})
              </span>
            </h3>

            {/* 맞교환 / 특별보강 탭 전환 */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg text-xs font-bold self-start md:self-auto">
              <button
                type="button"
                onClick={() => {
                  setActiveCandidateType("swap");
                  setSelectedCandidate(null);
                }}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeCandidateType === "swap"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                ↔️ 맞교환 후보 ({totalSwapCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveCandidateType("substitute");
                  setSelectedCandidate(null);
                }}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeCandidateType === "substitute"
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                👤 특별보강 후보 ({substituteCandidates.length})
              </button>
            </div>
          </div>

          {loadingCandidates && (
            <div className="p-8 text-center text-xs text-indigo-600 font-semibold animate-pulse">
              🔍 선택한 슬롯의 전체 주간 맞교환 및 특별보강 후보를 탐색 중입니다...
            </div>
          )}

          {/* §14-2 requirement ②: 후보 카드 목록 축소 렌더링 */}
          {!loadingCandidates && activeCandidateType === "swap" && (
            <div className="space-y-4">
              {totalSwapCount === 0 ? (
                <div className="p-6 text-center text-xs text-gray-500 bg-gray-50 rounded-xl">
                  선택한 슬롯에 적용 가능한 맞교환 후보가 전 주간에 걸쳐 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                  {swapCandidateWeeks.flatMap((weekGroup) =>
                    (weekGroup.swapCandidates || []).map((cand, idx) => {
                      const isSelected =
                        selectedCandidate?.targetWeekId === weekGroup.weekId &&
                        selectedCandidate?.targetDay === cand.targetDay &&
                        selectedCandidate?.targetPeriod === cand.targetPeriod &&
                        selectedCandidate?.counterpartEmail === cand.counterpartEmail;

                      return (
                        <div
                          key={`${weekGroup.weekId}-${idx}`}
                          onClick={() =>
                            setSelectedCandidate({
                              ...cand,
                              targetWeekId: weekGroup.weekId,
                              targetWeekStartDate: weekGroup.startDate,
                            })
                          }
                          className={`p-3 rounded-xl border cursor-pointer transition-all space-y-1 ${
                            isSelected
                              ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200 shadow-xs"
                              : "bg-white border-gray-200 hover:border-indigo-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] bg-indigo-100 text-indigo-900 font-extrabold px-1.5 py-0.5 rounded">
                              {weekGroup.startDate.slice(5)} 주
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                cand.score > 0 || (cand.penalties && cand.penalties.length > 0)
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-emerald-100 text-emerald-900"
                              }`}
                            >
                              {cand.score > 0 || (cand.penalties && cand.penalties.length > 0)
                                ? `감점 ${cand.score}점`
                                : "✨ 0점"}
                            </span>
                          </div>

                          <div className="font-bold text-gray-900 flex items-center justify-between pt-0.5">
                            <span>
                              {formatSlotWithDate(weekGroup.weekId, cand.targetDay, cand.targetPeriod)}
                            </span>
                            <span className="text-indigo-700">
                              {cand.counterpartName} ({cand.counterpartSubjectName})
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {!loadingCandidates && activeCandidateType === "substitute" && (
            <div className="space-y-3">
              {substituteCandidates.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-500 bg-gray-50 rounded-xl">
                  해당 교시 공강인 보강 가능한 교사가 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
                  {substituteCandidates.map((cand, idx) => {
                    const isSelected = selectedCandidate?.teacherEmail === cand.teacherEmail;

                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedCandidate(cand)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all space-y-1 ${
                          isSelected
                            ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200"
                            : "bg-white border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-gray-900">{cand.teacherName} 선생님</span>
                          {cand.sameSubject && (
                            <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.5 rounded">
                              동일 과목
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-indigo-700 font-semibold">
                          보강 누계: {cand.substituteCount}회
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 사유 선택 및 직권 승인 실행 */}
          {selectedCandidate && (
            <div className="pt-4 border-t border-gray-200 space-y-4 animate-in fade-in duration-200">
              <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                <span>4️⃣</span>
                <span>사유 입력 및 직권 승인 실행</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">구분 사유</label>
                  <select
                    value={reasonType}
                    onChange={(e) => setReasonType(e.target.value as SwapReasonType)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg font-bold bg-white"
                  >
                    <option value="학교행사">학교행사</option>
                    <option value="출장">출장</option>
                    <option value="연수">연수</option>
                    <option value="병가">병가</option>
                    <option value="공가">공가</option>
                    <option value="기타">기타</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">상세 메모</label>
                  <input
                    type="text"
                    value={reasonNote}
                    onChange={(e) => setReasonNote(e.target.value)}
                    placeholder="예: 체육대회 참가로 직권 보강 배정"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleDirectCommit}
                  disabled={submitting}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-md transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <span>⚡</span>
                  <span>{submitting ? "직권 배정 및 승인 처리 중..." : "직권 배정 및 즉시 승인 실행"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
