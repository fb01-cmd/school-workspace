"use client";

import { useEffect, useState } from "react";
import { SwapRequest, SwapRequestStatus, TimetableWeek } from "@/lib/timetable/types";

interface SwapRequestLedgerTabProps {
  activeTermId: string | null;
}

export default function SwapRequestLedgerTab({ activeTermId }: SwapRequestLedgerTabProps) {
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 필터 상태
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // 반려 모달 상태
  const [rejectingReq, setRejectingReq] = useState<SwapRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // 승인 처리 중 상태
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // 취소(revert) 처리 중 상태
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertedReqIds, setRevertedReqIds] = useState<Set<string>>(new Set());

  // 주 목록 조회 (필터용)
  const fetchWeeks = async () => {
    if (!activeTermId) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "week_list", termId: activeTermId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWeeks(data.weeks || []);
      }
    } catch {
      // 무시
    }
  };

  // 수업교환 신청 요청대장 조회
  const fetchRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: any = { action: "request_list" };
      if (selectedWeekId) payload.weekId = selectedWeekId;
      if (selectedStatus !== "ALL") payload.status = selectedStatus as SwapRequestStatus;

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRequests(data.requests || []);
        setReadOnly(!!data.readOnly);
      } else {
        setError(data.error || "수업교환 신청 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeeks();
  }, [activeTermId]);

  useEffect(() => {
    fetchRequests();
  }, [selectedWeekId, selectedStatus]);

  // 승인 처리
  const handleApprove = async (req: SwapRequest) => {
    if (!confirm(`[${req.requesterName}] 선생님의 수업교환 신청을 승인하시겠습니까?`)) {
      return;
    }

    setApprovingId(req.id);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", requestId: req.id }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`수업교환 신청이 성공적으로 승인되었습니다.`);
        fetchRequests();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setError(data.error || "승인 처리 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setApprovingId(null);
    }
  };

  // 반려 모달 제출 처리
  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingReq) return;
    if (!rejectReason.trim()) {
      setRejectError("반려 사유를 작성해 주세요.");
      return;
    }

    setRejectSubmitting(true);
    setRejectError(null);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          requestId: rejectingReq.id,
          decisionNote: rejectReason.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`수업교환 신청이 반려되었습니다.`);
        setRejectingReq(null);
        setRejectReason("");
        fetchRequests();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setRejectError(data.error || "반려 처리 실패");
      }
    } catch (err: any) {
      setRejectError(`네트워크 오류: ${err.message}`);
    } finally {
      setRejectSubmitting(false);
    }
  };

  // 승인 취소 (revert) 처리
  const handleRevert = async (req: SwapRequest) => {
    const changeId = req.appliedChangeIds?.[0];
    if (!changeId) {
      setError("취소할 수 있는 승인 변경 ID를 찾을 수 없습니다.");
      return;
    }

    if (
      !confirm(
        `승인된 수업교환을 취소(revert)하시겠습니까?\n취소 기록이 불변 로그로 작성되며 원래 시간표로 원복됩니다.`
      )
    ) {
      return;
    }

    setRevertingId(req.id);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert_change", changeId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`승인된 수업교환이 성공적으로 취소(revert)되었습니다.`);
        setRevertedReqIds((prev) => new Set(prev).add(req.id));
        fetchRequests();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setError(data.error || "승인 취소 실패");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setRevertingId(null);
    }
  };

  const DAY_NAMES = ["", "월", "화", "수", "목", "금"];

  // PENDING 상태를 상단으로 정렬
  const pendingRequests = requests.filter((r) => r.status === "PENDING");
  const otherRequests = requests.filter((r) => r.status !== "PENDING");
  const sortedRequests = [...pendingRequests, ...otherRequests];

  return (
    <div className="space-y-6">
      {/* 헤더 & 필터 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📋</span>
              <span>수업교환 신청 요청대장</span>
              {readOnly && (
                <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-bold">
                  👀 열람 전용 (참관자)
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              교사들이 제출한 수업교환 및 특별보강 신청을 검토하고 승인·반려·취소를 처리합니다.
            </p>
          </div>

          <button
            onClick={fetchRequests}
            className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 self-start md:self-auto"
          >
            <span>🔄</span>
            <span>새로고침</span>
          </button>
        </div>

        {/* 필터 컨트롤 */}
        <div className="flex flex-wrap items-center gap-3 text-xs pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-gray-600">주선택:</span>
            <select
              value={selectedWeekId}
              onChange={(e) => setSelectedWeekId(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">전체 주간</option>
              {weeks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.startDate} 주간 ({w.note || w.id})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-bold text-gray-600">상태:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white font-semibold text-gray-800 focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">전체 상태</option>
              <option value="PENDING">대기 중 (PENDING)</option>
              <option value="APPROVED">승인됨 (APPROVED)</option>
              <option value="REJECTED">반려됨 (REJECTED)</option>
              <option value="CANCELED">취소됨 (CANCELED)</option>
            </select>
          </div>

          {pendingRequests.length > 0 && (
            <span className="ml-auto font-bold text-xs bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-full animate-pulse">
              🔔 대기 중 신청 {pendingRequests.length}건
            </span>
          )}
        </div>
      </div>

      {/* 메시지 알림 */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold">
          ✅ {successMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">
          ⚠️ {error}
        </div>
      )}

      {/* 요청대장 리스트 */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-xs font-semibold text-gray-500">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-indigo-600 border-t-transparent mb-2"></div>
            <p>수업교환 신청 목록을 불러오는 중입니다...</p>
          </div>
        ) : sortedRequests.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center text-xs text-gray-500">
            <p className="font-semibold mb-1">조회된 수업교환 신청이 없습니다.</p>
            <p className="text-gray-400">필터 조건을 변경하거나 교사들의 신청을 기다려 주세요.</p>
          </div>
        ) : (
          sortedRequests.map((req) => {
            const isPending = req.status === "PENDING";
            const isApproved = req.status === "APPROVED";
            const isRejected = req.status === "REJECTED";

            return (
              <div
                key={req.id}
                className={`bg-white rounded-xl shadow-sm border transition-all p-5 space-y-4 ${
                  isPending
                    ? "border-amber-300 ring-2 ring-amber-100"
                    : "border-gray-200"
                }`}
              >
                {/* 상단 뱃지 & 신청자 정보 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                        isPending
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : isApproved
                          ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                          : isRejected
                          ? "bg-red-100 text-red-900 border border-red-300"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {isPending
                        ? "⏳ 대기 중"
                        : isApproved
                        ? "✅ 승인됨"
                        : isRejected
                        ? "❌ 반려됨"
                        : "⚪ 취소됨"}
                    </span>

                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold text-[11px] rounded border border-indigo-100">
                      {req.type === "cross_swap" || (req.targetWeekId && req.targetWeekId !== req.weekId)
                        ? "↔️ 교차 주 맞교환"
                        : req.type === "swap"
                        ? "↔️ 맞교환"
                        : "👤 특별보강"}
                    </span>

                    <span className="text-xs font-bold text-gray-900">
                      {req.requesterName} ({req.requesterEmail})
                    </span>
                  </div>

                  <span className="text-[11px] text-gray-400">
                    신청일시: {new Date(req.createdAt).toLocaleString("ko-KR")} (주: {req.weekId}{req.targetWeekId && req.targetWeekId !== req.weekId ? ` ↔ ${req.targetWeekId}` : ""})
                  </span>
                </div>

                {/* 변경 내역 비교 그리드 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* 원래 수업 (Source) */}
                  <div className="bg-gray-50 rounded-lg p-3.5 border border-gray-200 space-y-1">
                    <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                      📌 변경 대상 원래 수업
                    </div>
                    <div className="font-bold text-gray-900 text-sm">
                      {req.source.grade}학년 {req.source.classNum}반{" "}
                      <span className="text-indigo-700">
                        {DAY_NAMES[req.source.day]}요일 {req.source.period}교시
                      </span>
                    </div>
                    <div className="text-gray-600 font-medium">
                      과목: {req.source.subjectName} ({req.requesterName} 교사)
                    </div>
                  </div>

                  {/* 교체안 (Candidate) */}
                  <div className="bg-indigo-50/50 rounded-lg p-3.5 border border-indigo-100 space-y-1">
                    <div className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">
                      🎯 신청 교체안 (엔진 계산 결과)
                    </div>
                    {req.type === "swap" ? (
                      <>
                        <div className="font-bold text-gray-900 text-sm">
                          옮겨갈 교시:{" "}
                          <span className="text-indigo-700">
                            {DAY_NAMES[req.candidate.targetDay || 0]}요일{" "}
                            {req.candidate.targetPeriod}교시
                          </span>
                        </div>
                        <div className="text-gray-700 font-medium">
                          상대 교사: <strong>{req.candidate.counterpartName}</strong> (
                          {req.candidate.counterpartEmail}) — {req.candidate.counterpartSubjectName || ""}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-bold text-gray-900 text-sm">
                          보강 담당 교사:{" "}
                          <span className="text-indigo-700">
                            {req.candidate.counterpartName} 선생님
                          </span>
                        </div>
                        <div className="text-gray-700 font-medium">
                          보강 교사 이메일: {req.candidate.counterpartEmail}
                        </div>
                      </>
                    )}

                    {/* 감점 및 사유 표시 */}
                    {req.candidate.penalties && req.candidate.penalties.length > 0 && (
                      <div className="pt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                          주의 감점 ({req.candidate.score}점):
                        </span>
                        {req.candidate.penalties.map((p, pIdx) => (
                          <span
                            key={pIdx}
                            className="text-[10px] bg-red-100 text-red-800 font-medium px-1.5 py-0.5 rounded"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 사유 & 처리 결과 정보 */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs bg-gray-50/70 p-3 rounded-lg border border-gray-100">
                  <div>
                    <span className="font-bold text-gray-700">신청 사유: </span>
                    <span className="font-semibold text-indigo-900">
                      [{req.reason.type}]
                    </span>{" "}
                    <span className="text-gray-700">{req.reason.note || ""}</span>
                  </div>

                  {req.decidedBy && (
                    <div className="text-gray-500 text-[11px]">
                      처리: <strong>{req.decidedBy}</strong> (
                      {req.decidedAt ? new Date(req.decidedAt).toLocaleString("ko-KR") : ""})
                      {req.decisionNote && (
                        <span className="ml-1 text-red-700 font-bold">
                          — 사유: {req.decisionNote}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 결재 버튼 영역 */}
                {!readOnly && (
                  <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                    {isPending && (
                      <>
                        <button
                          onClick={() => {
                            setRejectingReq(req);
                            setRejectReason("");
                            setRejectError(null);
                          }}
                          className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold rounded-lg text-xs transition-colors"
                        >
                          ❌ 반려
                        </button>
                        <button
                          onClick={() => handleApprove(req)}
                          disabled={approvingId === req.id}
                          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-sm transition-colors disabled:opacity-50"
                        >
                          {approvingId === req.id ? "승인 처리 중..." : "✅ 승인 확정"}
                        </button>
                      </>
                    )}

                    {isApproved && req.appliedChangeIds?.[0] && (
                      revertedReqIds.has(req.id) ? (
                        <span className="px-3.5 py-2 bg-gray-100 text-gray-500 font-bold rounded-lg text-xs border border-gray-200 cursor-not-allowed">
                          ↩️ 승인 취소 완료
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRevert(req)}
                          disabled={revertingId === req.id}
                          className="px-4 py-2 bg-gray-100 hover:bg-amber-100 text-gray-700 hover:text-amber-900 border border-gray-300 font-bold rounded-lg text-xs transition-colors disabled:opacity-50"
                        >
                          {revertingId === req.id ? "취소 처리 중..." : "↩️ 승인 취소 (revert)"}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 반려 사유 입력 모달 */}
      {rejectingReq && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>❌</span>
                <span>수업교환 신청 반려</span>
              </h3>
              <button
                onClick={() => setRejectingReq(null)}
                className="text-gray-400 hover:text-gray-600 p-1 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-600">
              <strong>{rejectingReq.requesterName}</strong> 선생님의 신청을 반려합니다. 반려 사유를 작성해 주세요 (신청자에게 전달됩니다).
            </p>

            {rejectError && (
              <div className="bg-red-50 border border-red-200 text-red-900 p-3 rounded-lg text-xs font-bold">
                ⚠️ {rejectError}
              </div>
            )}

            <form onSubmit={handleRejectSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  반려 사유 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="예: 해당 교시 평가고사 일정으로 맞교환 불가"
                  rows={3}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingReq(null)}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={rejectSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {rejectSubmitting ? "반려 처리 중..." : "반려 확정"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
