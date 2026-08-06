"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
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

export default function DirectSubstituteTab({ activeTermId }: DirectSubstituteTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");

  // Step 1: 교사 선택 상태
  const [teacherInput, setTeacherInput] = useState("");
  const [selectedTeacherEmail, setSelectedTeacherEmail] = useState("");
  const [selectedTeacherName, setSelectedTeacherName] = useState("");
  const [recentTeachers, setRecentTeachers] = useState<Array<{ email: string; name: string }>>([]);

  // Step 2: 교사 시간표 상태
  const [teacherCells, setTeacherCells] = useState<TeacherTimetableCell[]>([]);
  const [loadingTimetable, setLoadingTimetable] = useState(false);
  const [timetableError, setTimetableError] = useState<string | null>(null);

  // 선택된 원 수업 슬롯
  const [selectedSlot, setSelectedSlot] = useState<{
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

  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [activeCandidateType, setActiveCandidateType] = useState<"swap" | "substitute">("swap");

  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [reasonType, setReasonType] = useState<SwapReasonType>("기타");
  const [reasonNote, setReasonNote] = useState("일과계 직권 배정");

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 주 목록 조회
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
      }
    } catch {
      // 무시
    }
  };

  useEffect(() => {
    fetchWeeks();
  }, [activeTermId]);

  // 교사 주간 시간표 조회 — 대상 주간(weekId)을 반드시 함께 보낸다.
  // 미지정 시 서버가 "현재 주"로 폴백하므로, 일과계가 고른 주간과 그리드 내용이
  // 어긋난다 (이미 교체가 반영된 주간일수록 오배정 위험).
  const fetchTeacherTimetable = async (email: string, weekId?: string) => {
    if (!email) return;
    setLoadingTimetable(true);
    setTimetableError(null);

    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "teacher",
          teacherEmail: email,
          ...(weekId ? { weekId } : {}),
        }),
      });

      if (res.ok) {
        const result = await res.json();
        if (result.data && Array.isArray(result.data.cells)) {
          setTeacherCells(result.data.cells);
          if (result.data.teacherName) {
            setSelectedTeacherName(result.data.teacherName);
          }
        } else {
          setTeacherCells([]);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setTimetableError(errData.error || "교사 시간표를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setTimetableError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoadingTimetable(false);
    }
  };

  // 교사 선택 처리
  const handleSelectTeacher = (email: string, name?: string) => {
    const finalName = name || email.split("@")[0];
    setSelectedTeacherEmail(email);
    setSelectedTeacherName(finalName);
    setTeacherInput(finalName);

    // 최근 선택한 교사 목록 업데이트 (최대 5명 중복제거)
    setRecentTeachers((prev) => {
      const filtered = prev.filter((t) => t.email.toLowerCase() !== email.toLowerCase());
      return [{ email, name: finalName }, ...filtered].slice(0, 5);
    });

    // 슬롯 및 후보 목록 초기화
    setSelectedSlot(null);
    setSourceLessonInfo(null);
    setSwapCandidates([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setCandidateError(null);
    setSuccessMsg(null);
    setSubmitError(null);

    // 교사 시간표 조회 (선택된 대상 주간 기준)
    fetchTeacherTimetable(email, selectedWeekId);
  };

  // 주간 변경 시 선택 교사의 시간표 및 후보 초기화
  const handleWeekChange = (weekId: string) => {
    setSelectedWeekId(weekId);
    setSelectedSlot(null);
    setSourceLessonInfo(null);
    setSwapCandidates([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setSuccessMsg(null);
    setSubmitError(null);
    if (selectedTeacherEmail) {
      fetchTeacherTimetable(selectedTeacherEmail, weekId);
    }
  };

  // 후보 탐색 API 호출 (셀 클릭 시 실행)
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
    setSwapCandidates([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setSuccessMsg(null);
    setSubmitError(null);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_candidates",
          weekId,
          source: { grade, classNum, day, period },
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSourceLessonInfo({
          subjectName: data.sourceSubjectName || data.sourceTeacher?.subjectName || subjectName,
          teacherName: data.sourceTeacher?.teacherName || selectedTeacherName,
        });
        setSwapCandidates(data.swapCandidates || []);
        setSubstituteCandidates(data.substituteCandidates || []);
      } else {
        setCandidateError(data.error || "후보를 탐색할 수 없습니다.");
      }
    } catch (err: any) {
      setCandidateError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoadingCandidates(false);
    }
  };

  // 시간표 그리드 셀 클릭 핸들러
  const handleSlotClick = (cell: TeacherTimetableCell) => {
    const slot = {
      grade: cell.grade,
      classNum: cell.classNum,
      day: cell.day,
      period: cell.period,
    };
    setSelectedSlot(slot);
    const subj = cell.subjectShort || cell.subjectName || "수업";
    setSourceLessonInfo({ subjectName: subj, teacherName: selectedTeacherName });

    fetchCandidates(selectedWeekId, cell.grade, cell.classNum, cell.day, cell.period, subj);
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
      let candidateSnapshot: any;
      if (activeCandidateType === "swap") {
        const sc = selectedCandidate as SwapCandidate;
        candidateSnapshot = {
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
          weekId: selectedWeekId,
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
          selectedWeekId,
          selectedSlot.day,
          selectedSlot.period
        )} 수업이 성공적으로 처리 및 반영되었습니다.`
      );

      // 리프레시: 후보 및 시간표 재조회
      setSelectedCandidate(null);
      fetchCandidates(
        selectedWeekId,
        selectedSlot.grade,
        selectedSlot.classNum,
        selectedSlot.day,
        selectedSlot.period,
        sourceLessonInfo?.subjectName || ""
      );
      if (selectedTeacherEmail) {
        fetchTeacherTimetable(selectedTeacherEmail, selectedWeekId);
      }
    } catch (err: any) {
      setSubmitError(err.message || "직권 배정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const getCellForSlot = (d: number, p: number) => {
    return teacherCells.filter((c) => c.day === d && c.period === p);
  };

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
          <span>일과계 직권 배정 (교사 기점 흐름)</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          교사를 먼저 선택한 후 주간 시간표에서 변경할 수업 셀을 직접 클릭하여 직권으로 맞교환 또는 특별보강 교사를 선택하고 반영합니다.
        </p>
      </div>

      {/* 성공/오류 메시지 */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold">
          ✅ {successMsg}
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
          {/* 주간 선택 */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">1️⃣ 대상 주간 (Week)</label>
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

          {/* 교사 자동완성 선택 */}
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-gray-700 mb-1">2️⃣ 대상 교사 검색 및 선택</label>
            <AutocompleteInput
              type="user"
              domain={domain}
              value={teacherInput}
              onChange={(val) => setTeacherInput(val)}
              placeholder="교사 이름 또는 이메일 검색 (예: 홍길동)"
              onSelect={(email, name) => handleSelectTeacher(email, name)}
              className="text-xs"
            />
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

      {/* Step 2: 교사의 주간 시간표 그리드 */}
      {selectedTeacherEmail ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                <span>🗓️</span>
                <span>{selectedTeacherName} 교사의 주간 시간표</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                직권 배정할 원 수업 셀을 클릭하면 하단에 맞교환 및 특별보강 가능 후보가 즉시 탐색됩니다.
              </p>
            </div>
            {loadingTimetable && (
              <span className="text-xs text-indigo-600 font-semibold animate-pulse">시간표 로딩 중...</span>
            )}
          </div>

          {timetableError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center">
              {timetableError}
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-indigo-950 text-white font-bold">
                    <th className="py-3 px-2 border-b border-r border-indigo-800 w-16 text-center">교시</th>
                    {DAYS.map((d) => (
                      <th key={d.num} className="py-3 px-2 border-b border-indigo-800 text-center">
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
                        <td className="py-3.5 px-2 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50">
                          {period}교시
                        </td>
                        {DAYS.map((d) => {
                          const matched = getCellForSlot(d.num, period);
                          const hasLesson = matched.length > 0;

                          return (
                            <td
                              key={d.num}
                              className={`p-2 border-r border-gray-100 text-center align-top transition-all ${
                                hasLesson ? "bg-indigo-50/30" : ""
                              }`}
                            >
                              {hasLesson ? (
                                <div className="space-y-1.5">
                                  {matched.map((cell, cIdx) => {
                                    const isSelected =
                                      selectedSlot?.grade === cell.grade &&
                                      selectedSlot?.classNum === cell.classNum &&
                                      selectedSlot?.day === cell.day &&
                                      selectedSlot?.period === cell.period;

                                    return (
                                      <button
                                        key={cIdx}
                                        type="button"
                                        onClick={() => handleSlotClick(cell)}
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
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 space-y-2">
          <span className="text-3xl">👈</span>
          <p className="font-bold text-gray-800 text-sm">위 2단계 검색창에서 직권 배정할 대상 교사를 선택해 주세요.</p>
          <p className="text-xs text-gray-400">교사를 선택하면 해당 교사의 주간 시간표가 표시되고, 셀을 클릭해 직권 배정을 진행합니다.</p>
        </div>
      )}

      {/* Step 3: 후보 탐색 결과 및 직권 반영 패널 */}
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
                후보 선택 — {selectedSlot.grade}학년 {selectedSlot.classNum}반 {DAY_LABEL[selectedSlot.day] || selectedSlot.day}요일 {selectedSlot.period}교시 ({sourceLessonInfo.subjectName}
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
                ↔️ 맞교환 후보 ({swapCandidates.length})
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
              🔍 선택한 슬롯의 최적 맞교환 및 특별보강 후보를 탐색 중입니다...
            </div>
          )}

          {!loadingCandidates && activeCandidateType === "swap" && (
            <div className="space-y-3">
              {swapCandidates.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-xl">
                  선택한 슬롯에 적용 가능한 맞교환 후보가 없습니다. (동시수업/특별실 충돌 등 하드 차단 사유 확인)
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {swapCandidates.map((cand, idx) => {
                    const isSelected =
                      selectedCandidate?.targetDay === cand.targetDay &&
                      selectedCandidate?.targetPeriod === cand.targetPeriod &&
                      selectedCandidate?.counterpartEmail === cand.counterpartEmail;

                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedCandidate(cand)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all space-y-2 ${
                          isSelected
                            ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200"
                            : "bg-white border-gray-200 hover:border-indigo-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-gray-900">
                            {formatSlotWithDate(selectedWeekId, cand.targetDay, cand.targetPeriod)}
                          </span>
                          <span className="font-bold text-indigo-700">
                            상대: {cand.counterpartName} ({cand.counterpartSubjectName})
                          </span>
                        </div>

                        <div className="text-gray-500 text-[11px]">
                          상대 이메일: {cand.counterpartEmail}
                        </div>

                        {cand.penalties && cand.penalties.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1 text-[10px]">
                            <span className="font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                              감점 {cand.score}점:
                            </span>
                            {cand.penalties.map((p, pIdx) => (
                              <span key={pIdx} className="bg-red-100 text-red-800 px-1.5 py-0.5 rounded">
                                {p}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded w-max">
                            ✨ 감점 0점 (최적 교환)
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {!loadingCandidates && activeCandidateType === "substitute" && (
            <div className="space-y-3">
              {substituteCandidates.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-xl">
                  해당 교시 공강인 교사가 없습니다.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  {substituteCandidates.map((cand, idx) => {
                    const isSelected = selectedCandidate?.teacherEmail === cand.teacherEmail;

                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedCandidate(cand)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all space-y-1.5 ${
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

                        <div className="text-[11px] text-gray-500">{cand.teacherEmail}</div>

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
