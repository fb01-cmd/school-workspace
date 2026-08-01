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

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import {
  SWAP_REASON_TYPES,
  SwapCandidate,
  SwapCandidatesResult,
  SwapRequest,
  SwapRequestReason,
  SubstituteCandidate,
  TeacherTimetableCell,
  TimetableSettings,
  TimetableWeek,
} from "@/lib/timetable/types";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";

const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

// ── ① 내 주간시간표 탭 ─────────────────────────────────────────
interface MyTimetableTabProps {
  periodsPerDay: number;
  settings: TimetableSettings | null;
}

function MyTimetableTab({ periodsPerDay, settings }: MyTimetableTabProps) {
  const { userData } = useAuth();

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 셀 클릭 → 후보 조회 상태
  const [selectedCell, setSelectedCell] = useState<TeacherTimetableCell | null>(null);
  const [candidatesResult, setCandidatesResult] = useState<SwapCandidatesResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [subMode, setSubMode] = useState(false);

  // 신청 상태
  const [applyingCandidate, setApplyingCandidate] = useState<SwapCandidate | SubstituteCandidate | null>(null);
  const [applyingType, setApplyingType] = useState<"swap" | "substitute">("swap");
  const [reason, setReason] = useState<SwapRequestReason>({ type: "출장" });
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

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

  const fetchTimetable = useCallback(async (weekId?: string) => {
    setLoading(true);
    setError(null);
    setSelectedCell(null);
    setCandidatesResult(null);
    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my", weekId: weekId || undefined }),
      });
      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        setCells(result.data?.cells || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTimetable(selectedWeekId || undefined);
  }, [selectedWeekId, fetchTimetable]);

  const handleCellClick = async (cell: TeacherTimetableCell) => {
    if (!selectedWeekId) {
      alert("먼저 조회할 주를 선택해 주세요. 주가 등록되어 있어야 교환 신청이 가능합니다.");
      return;
    }
    setSelectedCell(cell);
    setCandidatesResult(null);
    setCandidatesError(null);
    setCandidatesLoading(true);
    setSubMode(false);
    setApplyingCandidate(null);
    setSubmitResult(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "candidates",
          weekId: selectedWeekId,
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
        setCandidatesResult(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setCandidatesError(err.error || "후보를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setCandidatesError(`오류: ${e.message}`);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!applyingCandidate || !selectedCell || !selectedWeekId) return;
    if (reason.type === "기타" && !reason.note?.trim()) {
      alert("\"기타\" 사유는 내용을 반드시 입력해야 합니다.");
      return;
    }
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const isSwap = applyingType === "swap";
      const swapC = applyingCandidate as SwapCandidate;
      const subC = applyingCandidate as SubstituteCandidate;
      const candidate = isSwap
        ? {
            targetDay: swapC.targetDay,
            targetPeriod: swapC.targetPeriod,
            counterpartEmail: swapC.counterpartEmail,
            counterpartName: swapC.counterpartName,
            counterpartSubjectName: swapC.counterpartSubjectName,
            score: swapC.score,
            penalties: swapC.penalties,
          }
        : {
            counterpartEmail: subC.teacherEmail,
            counterpartName: subC.teacherName,
            score: 0,
            penalties: [],
          };

      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          weekId: selectedWeekId,
          type: applyingType,
          source: {
            grade: selectedCell.grade,
            classNum: selectedCell.classNum,
            day: selectedCell.day,
            period: selectedCell.period,
            subjectName: selectedCell.subjectName,
          },
          candidate,
          reason,
        }),
      });
      if (res.ok) {
        setSubmitResult("✅ 수업교환 신청이 완료되었습니다. 일과계에서 검토 후 처리됩니다.");
        setApplyingCandidate(null);
        setCandidatesResult(null);
        setSelectedCell(null);
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

  const getCellFor = (day: number, period: number) =>
    cells.filter((c) => c.day === day && c.period === period);

  const isSwapTarget = (day: number, period: number) =>
    !subMode &&
    !!candidatesResult?.swapCandidates?.some(
      (sc) => sc.targetDay === day && sc.targetPeriod === period
    );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-gray-700">조회할 주:</span>
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">기초시간표 (주 미지정)</option>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>{w.startDate} 주</option>
            ))}
          </select>
          {termMeta && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-medium">
              {termMeta.name}
            </span>
          )}
          {loading && <span className="text-xs text-indigo-500 animate-pulse font-semibold">조회 중...</span>}
          {selectedWeekId && (
            <span className="text-[11px] text-gray-400">
              💡 내 수업 셀을 클릭하면 교환 신청 가능한 슬롯을 확인할 수 있습니다.
            </span>
          )}
        </div>
      </div>

      {submitResult && (
        <div className={`rounded-xl p-4 text-sm font-semibold border ${
          submitResult.startsWith("✅")
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {submitResult}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 text-center">{error}</div>
      )}

      <div className="flex gap-4 items-start">
        {/* 주간 시간표 그리드 */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-950 to-indigo-800 px-5 py-3">
            <h3 className="text-sm font-bold text-white">🗓️ 내 주간시간표</h3>
            <p className="text-[11px] text-indigo-300 mt-0.5">
              {selectedWeekId
                ? "변경된 셀은 빨간 배경으로 표시됩니다. 내 수업 셀 클릭 시 교환 신청 플로우가 시작됩니다."
                : "기초시간표 (주 선택 시 변경 반영)"}
            </p>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-2 px-2 border-r border-gray-200 w-12 text-center text-gray-500 font-bold text-[10px]">교시</th>
                {DAYS.map((d) => (
                  <th key={d.num} className="py-2 px-1 text-center text-gray-700 font-bold text-[11px]">{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, idx) => {
                const period = idx + 1;
                return (
                  <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                    <td className="py-3 px-2 border-r border-gray-200 text-center font-bold text-gray-400 bg-gray-50 text-[11px]">{period}</td>
                    {DAYS.map((d) => {
                      const matched = getCellFor(d.num, period);
                      const hasLesson = matched.length > 0;
                      const isTarget = isSwapTarget(d.num, period);
                      const isSelected = selectedCell?.day === d.num && selectedCell?.period === period;

                      return (
                        <td
                          key={d.num}
                          className={`p-1 border-r border-gray-100 text-center align-top transition-all
                            ${isSelected ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50" : ""}
                            ${isTarget && !isSelected ? "bg-green-50 ring-1 ring-inset ring-green-400" : ""}
                            ${hasLesson && !isSelected && !isTarget ? "hover:bg-indigo-50/60 cursor-pointer" : ""}
                          `}
                          onClick={() => { if (hasLesson) handleCellClick(matched[0]); }}
                        >
                          {hasLesson ? (
                            matched.map((cell, ci) => {
                              const changed = (cell as any).changed;
                              const isChanged = !!changed;
                              const tooltip = isChanged && changed?.origin
                                ? `${DAY_LABEL[cell.day]}${cell.period} ← ${DAY_LABEL[(changed.origin as any).day]}${(changed.origin as any).period}에서 이동`
                                : `${cell.subjectName} · ${cell.grade}-${cell.classNum}반`;
                              return (
                                <div
                                  key={ci}
                                  title={tooltip}
                                  className={`p-1.5 rounded text-center space-y-0.5 text-[10px] ${
                                    isChanged
                                      ? "bg-red-100 border border-red-300"
                                      : "bg-white border border-indigo-200 shadow-2xs"
                                  }`}
                                >
                                  <div className={`font-black ${isChanged ? "text-red-800" : "text-indigo-950"}`}>
                                    {cell.subjectShort || cell.subjectName}
                                    {isChanged && <span className="ml-0.5 text-red-600 font-bold text-[9px]">▲</span>}
                                  </div>
                                  <div className="text-[9px] text-gray-500">{cell.grade}-{cell.classNum}반</div>
                                  {isTarget && <div className="text-[9px] font-bold text-green-700">교환 가능 ✓</div>}
                                </div>
                              );
                            })
                          ) : isTarget ? (
                            <div className="py-2 text-[10px] font-bold text-green-700">🟢 공강</div>
                          ) : (
                            <span className="text-[10px] text-gray-200 block py-2">-</span>
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

        {/* 우측 패널: 후보 목록 및 신청 폼 */}
        {selectedCell && (
          <div className="w-80 shrink-0 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-900 to-indigo-700 px-4 py-3">
              <div className="text-xs font-bold text-white">
                수업교환 신청 — {DAY_LABEL[selectedCell.day]}요일 {selectedCell.period}교시
              </div>
              <div className="text-[11px] text-indigo-300 mt-0.5">
                {selectedCell.subjectName} · {selectedCell.grade}-{selectedCell.classNum}반
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* 모드 토글 */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSubMode(false)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                    !subMode
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  맞교환
                </button>
                <button
                  onClick={() => setSubMode(true)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                    subMode
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  교환 없이 보강
                </button>
              </div>

              {candidatesLoading && (
                <div className="text-center py-4 text-xs text-indigo-500 animate-pulse font-semibold">후보 계산 중...</div>
              )}
              {candidatesError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{candidatesError}</div>
              )}

              {candidatesResult && !candidatesLoading && (
                <>
                  {!subMode ? (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-gray-700">
                        맞교환 후보 ({candidatesResult.swapCandidates?.length || 0}건)
                      </div>
                      {(candidatesResult.swapCandidates?.length ?? 0) === 0 ? (
                        <p className="text-xs text-gray-400 py-2">조건을 충족하는 맞교환 후보가 없습니다.</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {candidatesResult.swapCandidates?.map((sc, i) => (
                            <div
                              key={i}
                              className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                                applyingCandidate === sc && applyingType === "swap"
                                  ? "bg-indigo-50 border-indigo-400"
                                  : "bg-white border-gray-200 hover:bg-indigo-50/50 hover:border-indigo-300"
                              }`}
                              onClick={() => { setApplyingCandidate(sc); setApplyingType("swap"); }}
                            >
                              <div className="font-bold text-gray-900">
                                {DAY_LABEL[sc.targetDay]}요일 {sc.targetPeriod}교시 ↔ {sc.counterpartName}
                              </div>
                              <div className="text-gray-500">{sc.counterpartSubjectName}</div>
                              {sc.score > 0 ? (
                                <div className="mt-1 text-orange-600 font-semibold">
                                  ⚠ 감점 {sc.score} — {sc.penalties.join(", ")}
                                </div>
                              ) : (
                                <div className="mt-1 text-green-600 font-semibold">✓ 최적</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-gray-700">
                        특별보강 후보 ({candidatesResult.substituteCandidates?.length || 0}명)
                      </div>
                      {(candidatesResult.substituteCandidates?.length ?? 0) === 0 ? (
                        <p className="text-xs text-gray-400 py-2">해당 교시에 공강인 교사가 없습니다.</p>
                      ) : (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {candidatesResult.substituteCandidates?.map((sc, i) => (
                            <div
                              key={i}
                              className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                                applyingCandidate === sc && applyingType === "substitute"
                                  ? "bg-orange-50 border-orange-400"
                                  : "bg-white border-gray-200 hover:bg-orange-50/50 hover:border-orange-300"
                              }`}
                              onClick={() => { setApplyingCandidate(sc); setApplyingType("substitute"); }}
                            >
                              <div className="font-bold text-gray-900">{sc.teacherName}</div>
                              <div className="text-gray-500">
                                보강 누계 {sc.substituteCount}회
                                {sc.sameSubject && <span className="ml-1 text-indigo-600 font-semibold">· 동일 과목 담당</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 징검다리 (1차 미구현) */}
                  <details>
                    <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                      연쇄(징검다리) 교환 ▸
                    </summary>
                    <div className="mt-2 p-2 bg-gray-50 rounded-lg text-[11px] text-gray-500">
                      ⚠️ 통상 사용하지 않습니다. 3인 이상 연쇄 이동이 필요한 경우 일과계에 직접 문의해 주세요.
                    </div>
                  </details>
                </>
              )}

              {/* 신청 폼 */}
              {applyingCandidate && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="text-xs font-bold text-gray-800">신청 사유 (필수)</div>
                  <select
                    value={reason.type}
                    onChange={(e) => setReason({ type: e.target.value as any, note: reason.note })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {SWAP_REASON_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {reason.type === "기타" && (
                    <textarea
                      value={reason.note || ""}
                      onChange={(e) => setReason({ ...reason, note: e.target.value })}
                      placeholder="사유를 입력해 주세요 (필수)"
                      rows={2}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    />
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || (reason.type === "기타" && !reason.note?.trim())}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shadow-sm"
                  >
                    {submitting ? "신청 중..." : "수업교환 신청하기"}
                  </button>
                  <button
                    onClick={() => setApplyingCandidate(null)}
                    className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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

function MyRequestsTab({ settings }: MyRequestsTabProps) {
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3 pb-2 border-b border-gray-100">
        <h3 className="text-base font-bold text-gray-900">📋 내 수업교환 신청 내역</h3>
        <select
          value={selectedWeekId}
          onChange={(e) => setSelectedWeekId(e.target.value)}
          className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
        >
          <option value="">전체 주</option>
          {weeks.map((w) => <option key={w.id} value={w.id}>{w.startDate} 주</option>)}
        </select>
        <button
          onClick={fetchMyList}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
        >
          새로고침
        </button>
      </div>

      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs font-semibold text-green-800">
          {successMsg}
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{error}</div>}
      {loading && <div className="text-center py-6 text-xs text-indigo-500 animate-pulse">불러오는 중...</div>}

      {!loading && requests.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">수업교환 신청 내역이 없습니다.</div>
      )}

      {!loading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req) => {
            const statusInfo = STATUS_LABELS[req.status] || { label: req.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
            return (
              <div key={req.id} className="border border-gray-200 rounded-xl p-4 space-y-2 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-gray-900">
                      {req.weekId} 주 — {req.type === "swap" ? "맞교환" : "특별보강"}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      원 수업: {DAY_LABEL[req.source.day]}요일 {req.source.period}교시 ({req.source.subjectName}, {req.source.grade}-{req.source.classNum}반)
                    </div>
                    {req.type === "swap" && req.candidate.targetDay != null && (
                      <div className="text-[11px] text-gray-600">
                        교환: {DAY_LABEL[req.candidate.targetDay!]}요일 {req.candidate.targetPeriod}교시 ({req.candidate.counterpartName})
                      </div>
                    )}
                    {req.type === "substitute" && (
                      <div className="text-[11px] text-gray-600">보강 교사: {req.candidate.counterpartName}</div>
                    )}
                    <div className="text-[11px] text-gray-500">
                      사유: {req.reason.type}{req.reason.note && ` — ${req.reason.note}`}
                    </div>
                    {req.decisionNote && (
                      <div className="text-[11px] text-red-700 font-medium">결정 사유: {req.decisionNote}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${statusInfo.className}`}>
                      {statusInfo.label}
                    </span>
                    {req.status === "PENDING" && (
                      <button
                        onClick={() => handleCancel(req.id)}
                        disabled={cancellingId === req.id}
                        className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-[11px] transition-colors disabled:opacity-50 border border-red-200"
                      >
                        {cancellingId === req.id ? "취소 중..." : "신청 취소"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-gray-400">
                  신청일: {new Date(req.createdAt).toLocaleString("ko-KR")}
                  {req.decidedAt && ` · 결정일: ${new Date(req.decidedAt).toLocaleString("ko-KR")}`}
                </div>
              </div>
            );
          })}
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
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";
  const myEmail = userData?.email?.toLowerCase() || "";

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [targetEmail, setTargetEmail] = useState(myEmail);
  const [teacherName, setTeacherName] = useState("");
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <p className="text-xs text-gray-500 mt-0.5">교사를 검색하여 주간 합성 시간표를 조회합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
          >
            <option value="">기초시간표</option>
            {weeks.map((w) => <option key={w.id} value={w.id}>{w.startDate} 주</option>)}
          </select>
          <button
            onClick={() => setTargetEmail(myEmail)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
              targetEmail.toLowerCase() === myEmail
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            내 시간표
          </button>
          <div className="w-64">
            <AutocompleteInput
              value={targetEmail}
              onChange={(val) => setTargetEmail(val)}
              type="user"
              domain={domain}
              placeholder="다른 교사 검색"
              onSelect={(email, name) => { setTargetEmail(email); if (name) setTeacherName(name); }}
            />
          </div>
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
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-indigo-950 text-white font-bold">
              <th className="py-3 px-2 border-b border-r border-indigo-800 w-16 text-center">교시</th>
              {DAYS.map((d) => (
                <th key={d.num} className="py-3 px-2 border-b border-indigo-800 text-center">{d.label}요일</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, pIdx) => {
              const period = pIdx + 1;
              return (
                <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                  <td className="py-4 px-2 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50">{period}교시</td>
                  {DAYS.map((d) => {
                    const matched = getCellFor(d.num, period);
                    const hasLesson = matched.length > 0;
                    return (
                      <td key={d.num} className={`p-2 border-r border-gray-100 text-center align-top transition-colors ${hasLesson ? "bg-indigo-50/40 hover:bg-indigo-100/50" : ""}`}>
                        {hasLesson ? (
                          <div className="space-y-1.5">
                            {matched.map((cell, cIdx) => {
                              const isChanged = !!(cell as any).changed;
                              return (
                                <div key={cIdx} className={`p-2 rounded-lg space-y-1 ${isChanged ? "bg-red-50 border border-red-300" : "bg-white border border-indigo-200 shadow-2xs"}`}>
                                  <div className={`font-black text-xs ${isChanged ? "text-red-800" : "text-indigo-950"}`}>
                                    {cell.subjectShort || cell.subjectName}
                                    {isChanged && <span className="ml-0.5 text-red-500 text-[9px]">▲</span>}
                                  </div>
                                  <div className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                                    {cell.grade}-{cell.classNum}반
                                  </div>
                                  {cell.room && <div className="text-[10px] text-gray-500 truncate">📍 {cell.room}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-300 font-light block py-2">-</span>
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
  // teacherOpen 플래그: TimetableSettings 확장 전 optional 처리
  const teacherOpen = !!(settings as any)?.teacherOpen;
  const canView = isManager || teacherOpen;

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
          주간 합성 시간표를 확인하고 수업교환을 신청합니다. 후보는 엔진이 제시한 슬롯만 선택 가능합니다.
        </p>
      </div>

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
