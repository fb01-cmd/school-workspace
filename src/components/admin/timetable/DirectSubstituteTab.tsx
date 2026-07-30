"use client";

import { useEffect, useState } from "react";
import {
  SubstituteCandidate,
  SwapCandidate,
  SwapReasonType,
  TimetableWeek,
} from "@/lib/timetable/types";

interface DirectSubstituteTabProps {
  activeTermId: string | null;
}

export default function DirectSubstituteTab({ activeTermId }: DirectSubstituteTabProps) {
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");

  // 1단계: 원 슬롯 선택 입력
  const [grade, setGrade] = useState<number>(1);
  const [classNum, setClassNum] = useState<number>(1);
  const [day, setDay] = useState<number>(1);
  const [period, setPeriod] = useState<number>(1);

  // 2단계: 후보 탐색 결과
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [sourceLessonInfo, setSourceLessonInfo] = useState<{
    subjectName: string;
    teacherName?: string;
  } | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [activeCandidateType, setActiveCandidateType] = useState<"swap" | "substitute">("swap");

  // 3단계: 선택된 후보 및 사유
  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [reasonType, setReasonType] = useState<SwapReasonType>("기타");
  const [reasonNote, setReasonNote] = useState("일과계 직권 배정");

  // 직권 승인 실행 상태
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

  // 후보 탐색 API 호출
  const handleSearchCandidates = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedWeekId) {
      setCandidateError("주간(Week)을 선택해 주세요.");
      return;
    }

    setLoadingCandidates(true);
    setCandidateError(null);
    setSourceLessonInfo(null);
    setSwapCandidates([]);
    setSubstituteCandidates([]);
    setSelectedCandidate(null);
    setSuccessMsg(null);
    setSubmitError(null);

    try {
      // 직권 배정은 관리자 전용 action 사용 — 교사용 requests 라우트는 "본인 수업만" 검증이라 사용 불가
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_candidates",
          weekId: selectedWeekId,
          source: { grade, classNum, day, period },
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSourceLessonInfo({
          subjectName: data.sourceSubjectName || data.sourceTeacher?.subjectName || "수업",
          teacherName: data.sourceTeacher?.teacherName,
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

  // 직권 배정 등록 및 연쇄 승인
  const handleDirectCommit = async () => {
    if (!selectedCandidate) {
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
      // 1) /api/timetable/requests action: "create"
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

      // 직권 배정은 서버가 신청 생성→승인을 한 번에 처리 (실패 시 유령 PENDING 자동 취소)
      const commitRes = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "direct_commit",
          weekId: selectedWeekId,
          type: activeCandidateType,
          source: { grade, classNum, day, period, subjectName: sourceLessonInfo?.subjectName || "" },
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
        `⚡ 직권 배정 완료! ${grade}학년 ${classNum}반 ${day}요일 ${period}교시 수업이 성공적으로 처리 및 반영되었습니다.`
      );
      setSelectedCandidate(null);
      // 리프레시
      handleSearchCandidates();
    } catch (err: any) {
      setSubmitError(err.message || "직권 배정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const DAY_NAMES = ["", "월", "화", "수", "목", "금"];

  return (
    <div className="space-y-6">
      {/* 헤더 안내 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <span>⚡</span>
          <span>일과계 직권 배정 (수업교환 & 특별보강)</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          교사의 사전 신청 없이 일과계 관리자가 수업 슬롯을 직접 지정하여 맞교환 또는 특별보강 교사를 선택하고 즉시 승인·반영합니다.
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

      {/* 1단계: 원 슬롯 선택 폼 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
          <span>1️⃣</span>
          <span>변경할 원래 수업 슬롯 선택</span>
        </h3>

        <form onSubmit={handleSearchCandidates} className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
          <div className="col-span-2 md:col-span-2">
            <label className="block font-bold text-gray-700 mb-1">대상 주간 (Week)</label>
            <select
              value={selectedWeekId}
              onChange={(e) => setSelectedWeekId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-semibold bg-white"
            >
              {weeks.length === 0 && <option value="">등록된 주가 없습니다</option>}
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.startDate} 주간 ({w.note || w.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-gray-700 mb-1">학년</label>
            <select
              value={grade}
              onChange={(e) => setGrade(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white font-bold"
            >
              <option value={1}>1학년</option>
              <option value={2}>2학년</option>
              <option value={3}>3학년</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-gray-700 mb-1">반</label>
            <select
              value={classNum}
              onChange={(e) => setClassNum(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white font-bold"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((c) => (
                <option key={c} value={c}>
                  {c}반
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-bold text-gray-700 mb-1">요일</label>
            <select
              value={day}
              onChange={(e) => setDay(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white font-bold"
            >
              <option value={1}>월요일</option>
              <option value={2}>화요일</option>
              <option value={3}>수요일</option>
              <option value={4}>목요일</option>
              <option value={5}>금요일</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-gray-700 mb-1">교시</label>
            <select
              value={period}
              onChange={(e) => setPeriod(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white font-bold"
            >
              {Array.from({ length: 7 }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>
                  {p}교시
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 md:col-span-6 flex justify-end pt-2">
            <button
              type="submit"
              disabled={loadingCandidates || !selectedWeekId}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <span>🔍</span>
              <span>{loadingCandidates ? "후보 탐색 중..." : "가능한 후보 탐색"}</span>
            </button>
          </div>
        </form>
      </div>

      {/* 2단계: 후보 선택 및 탐색 결과 */}
      {candidateError && (
        <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">
          ⚠️ {candidateError}
        </div>
      )}

      {sourceLessonInfo && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
              <span>2️⃣</span>
              <span>
                후보 선택 — {grade}학년 {classNum}반 {DAY_NAMES[day]}요일 {period}교시 ({sourceLessonInfo.subjectName}
                {sourceLessonInfo.teacherName ? ` · ${sourceLessonInfo.teacherName} 교사` : ""})
              </span>
            </h3>

            {/* 맞교환 / 특별보강 탭 전환 */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg text-xs font-bold">
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

          {/* 맞교환 후보 목록 */}
          {activeCandidateType === "swap" && (
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
                            {DAY_NAMES[cand.targetDay]}요일 {cand.targetPeriod}교시
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

          {/* 특별보강 후보 목록 */}
          {activeCandidateType === "substitute" && (
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

          {/* 3단계: 사유 선택 및 직권 승인 실행 */}
          {selectedCandidate && (
            <div className="pt-4 border-t border-gray-200 space-y-4 animate-in fade-in duration-200">
              <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                <span>3️⃣</span>
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
