"use client";

import { useEffect, useState } from "react";
import { SwapRequest, SwapRequestStatus, TimetableWeek } from "@/lib/timetable/types";
import { formatSlotWithDate } from "@/lib/timetable/utils";
import PaginationControls from "./PaginationControls";

interface SwapRequestLedgerTabProps {
  activeTermId: string | null;
}

function formatDateTimeCompact(timestamp: number | string | Date): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dayStr = days[d.getDay()];
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${date}(${dayStr}) ${hours}:${minutes}`;
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

export default function SwapRequestLedgerTab({ activeTermId }: SwapRequestLedgerTabProps) {
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  // PENDING 사전 검증 결과 — 먼저 승인된 건 때문에 이미 성립 불가한 신청 표시용
  const [validity, setValidity] = useState<Record<string, { ok: boolean; reason?: string }>>({});
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 필터 상태
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // 페이지네이션 상태 (처리 완료 목록용)
  const [completedPage, setCompletedPage] = useState(1);
  const [completedPageSize, setCompletedPageSize] = useState(20);

  // 반려 모달 상태
  const [rejectingReq, setRejectingReq] = useState<SwapRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // 승인 처리 중 상태
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [batchApprovingId, setBatchApprovingId] = useState<string | null>(null);

  // 묶음 일괄 승인 처리 (phase9b_spec §14-3)
  const handleBatchApprove = async (batchId: string, allReqs: SwapRequest[]) => {
    if (readOnly) return;
    const requesterName = allReqs[0]?.requesterName || "교사";
    // 사전 검증 실패 건은 승인 시도 자체를 건너뛴다 (서버 트랜잭션에서도 어차피 거부됨)
    const invalidReqs = allReqs.filter((r) => validity[r.id]?.ok === false);
    const reqs = allReqs.filter((r) => validity[r.id]?.ok !== false);
    if (reqs.length === 0) {
      alert("이 묶음의 모든 신청이 성립 불가 상태입니다. 개별 반려 처리해 주세요.");
      return;
    }
    if (
      !confirm(
        invalidReqs.length > 0
          ? `[${requesterName}] 선생님의 묶음 신청 중 ${invalidReqs.length}건은 성립 불가 상태로 건너뜁니다.\n나머지 ${reqs.length}건만 일괄 승인하시겠습니까?`
          : `[${requesterName}] 선생님의 묶음 신청 (${reqs.length}건)을 한 번에 일괄 승인하시겠습니까?`
      )
    ) {
      return;
    }

    setBatchApprovingId(batchId);
    setError(null);
    let successCount = 0;
    let failCount = 0;

    for (const req of reqs) {
      try {
        const res = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", requestId: req.id }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      setSuccessMsg(
        `🚀 묶음 신청 ${successCount}건이 성공적으로 일괄 승인되었습니다.${
          failCount > 0 ? ` (${failCount}건 실패)` : ""
        }`
      );
      fetchRequests();
      setTimeout(() => setSuccessMsg(null), 4000);
    } else {
      setError("일괄 승인 처리 중 오류가 발생했습니다.");
    }

    setBatchApprovingId(null);
  };

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
        setValidity(data.validity || {});
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

  // 주간·상태 필터 변경 시 1페이지로 리셋
  useEffect(() => {
    setCompletedPage(1);
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

  // 데이터 분류
  // 1) PENDING (대기 중): 오래된 신청 먼저 (createdAt 오름차순) - 작업 큐 형태
  const pendingRequests = requests
    .filter((r) => r.status === "PENDING")
    .sort((a, b) => a.createdAt - b.createdAt);

  const pendingBatchGroups: Record<string, SwapRequest[]> = {};
  const ungroupedPendingRequests: SwapRequest[] = [];

  pendingRequests.forEach((req) => {
    if (req.batchId) {
      if (!pendingBatchGroups[req.batchId]) {
        pendingBatchGroups[req.batchId] = [];
      }
      pendingBatchGroups[req.batchId].push(req);
    } else {
      ungroupedPendingRequests.push(req);
    }
  });

  // 2) 처리 완료 목록 (PENDING 제외): 최신순 (createdAt 내림차순)
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

  const renderRequestRow = (req: SwapRequest) => {
    const isPending = req.status === "PENDING";
    const isApproved = req.status === "APPROVED";
    const isRejected = req.status === "REJECTED";
    const invalid = isPending && validity[req.id]?.ok === false;
    const invalidReason = invalid ? validity[req.id]?.reason : undefined;

    return (
      <div
        key={req.id}
        className={`p-2.5 space-y-1 rounded-lg border transition-all text-xs ${
          invalid
            ? "border-red-300 bg-red-50/30"
            : isPending
            ? "border-amber-200 bg-amber-50/20"
            : "border-gray-200 bg-white hover:bg-gray-50/50"
        }`}
      >
        {/* 1줄째: 신청일시(맨 앞 진하게) -> 상태 뱃지 -> 유형 뱃지 -> 신청자 이름 */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold text-gray-900 text-xs shrink-0">
              {formatDateTimeCompact(req.createdAt)}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-bold border shrink-0 ${
                isPending
                  ? "bg-amber-100 text-amber-900 border-amber-300"
                  : isApproved
                  ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                  : isRejected
                  ? "bg-red-100 text-red-900 border-red-300"
                  : "bg-gray-100 text-gray-700 border-gray-300"
              }`}
            >
              {isPending ? "⏳ 대기" : isApproved ? "✅ 승인됨" : isRejected ? "❌ 반려됨" : "⚪ 취소됨"}
            </span>

            <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 font-semibold text-[11px] rounded border border-indigo-100 shrink-0">
              {req.type === "cross_swap" || (req.targetWeekId && req.targetWeekId !== req.weekId)
                ? "↔️ 교차주"
                : req.type === "swap"
                ? "↔️ 맞교환"
                : "👤 보강"}
            </span>

            <span className="text-xs font-bold text-gray-900 truncate">
              {req.requesterName} <span className="text-gray-500 font-normal text-[11px]">({req.requesterEmail})</span>
            </span>
          </div>

          <span className="text-[11px] text-gray-400 shrink-0">
            주: {req.weekId}{req.targetWeekId && req.targetWeekId !== req.weekId ? ` ↔ ${req.targetWeekId}` : ""}
          </span>
        </div>

        {/* 2줄째: 교환 내용 한 줄 + 처리결과 인라인 + 반려/승인 버튼 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-1.5 text-xs text-gray-700">
          <div className="flex items-center gap-1 flex-wrap font-medium">
            <span className="font-bold text-gray-900">
              {req.source.grade}-{req.source.classNum}반 {req.source.subjectName}
            </span>
            <span className="text-indigo-700 font-bold">
              {formatSlotWithDate(req.weekId, req.source.day, req.source.period)}
            </span>
            <span className="text-gray-400 font-bold px-0.5">→</span>
            {req.type === "swap" || req.type === "cross_swap" ? (
              <>
                <span className="font-bold text-indigo-800">
                  {formatSlotWithDate(
                    req.targetWeekId || (req.candidate as any).targetWeekId || req.weekId,
                    req.candidate.targetDay,
                    req.candidate.targetPeriod
                  )}
                </span>
                <span className="text-gray-600">
                  · 상대 <strong className="text-gray-900">{req.candidate.counterpartName}</strong>
                  {req.candidate.counterpartSubjectName ? `(${req.candidate.counterpartSubjectName})` : ""}
                </span>
              </>
            ) : (
              <>
                <span className="font-bold text-indigo-800">특별보강</span>
                <span className="text-gray-600">
                  · 보강 <strong className="text-gray-900">{req.candidate.counterpartName}</strong>
                </span>
              </>
            )}
            <span className="text-indigo-900 font-semibold">
              + 사유 [{req.reason.type}]
            </span>
            {req.reason.note && <span className="text-gray-600">({req.reason.note})</span>}

            {/* 처리 완료 건 인라인 정보 */}
            {req.decidedBy && (
              <span className="text-gray-500 text-[11px] ml-1">
                · 처리: <strong className="text-gray-700">{req.decidedBy}</strong>
                {req.decidedAt ? ` (${formatShortDate(req.decidedAt)})` : ""}
                {req.decisionNote && (
                  <span className="text-red-700 font-bold ml-1">
                    — 사유: {req.decisionNote}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* 결재 버튼 영역 */}
          {!readOnly && (
            <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
              {isPending && (
                <>
                  <button
                    onClick={() => {
                      setRejectingReq(req);
                      setRejectReason("");
                      setRejectError(null);
                    }}
                    className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold rounded text-xs transition-colors cursor-pointer"
                  >
                    ❌ 반려
                  </button>
                  <button
                    onClick={() => handleApprove(req)}
                    disabled={approvingId === req.id || invalid}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {invalid ? "🚫 승인 불가" : approvingId === req.id ? "승인 중..." : "✅ 승인"}
                  </button>
                </>
              )}

              {isApproved && req.appliedChangeIds?.[0] && (
                revertedReqIds.has(req.id) ? (
                  <span className="px-2.5 py-1 bg-gray-100 text-gray-500 font-bold rounded text-xs border border-gray-200 cursor-not-allowed">
                    ↩️ 취소됨
                  </span>
                ) : (
                  <button
                    onClick={() => handleRevert(req)}
                    disabled={revertingId === req.id}
                    className="px-2.5 py-1 bg-gray-100 hover:bg-amber-100 text-gray-700 hover:text-amber-900 border border-gray-300 font-bold rounded text-xs transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {revertingId === req.id ? "취소 중..." : "↩️ 승인 취소"}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* 성립 불가 경고 줄 */}
        {invalid && (
          <div className="mt-1 bg-red-50 border border-red-200 rounded px-2.5 py-1 text-[11px] font-bold text-red-800">
            ⚠️ <span className="font-extrabold text-red-900">승인 불가 상태</span> — {invalidReason} (반려 처리 후 재신청 안내 필요)
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* 헤더 & 필터 */}
      <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
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
            <p className="text-xs text-gray-500 mt-0.5">
              교사들의 수업교환 신청을 검토하고 승인·반려·취소를 처리합니다.
            </p>
          </div>

          <button
            onClick={fetchRequests}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 self-start md:self-auto cursor-pointer"
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
              className="px-2.5 py-1 border border-gray-300 rounded-lg bg-white font-semibold text-gray-800 focus:ring-1 focus:ring-indigo-500"
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
              className="px-2.5 py-1 border border-gray-300 rounded-lg bg-white font-semibold text-gray-800 focus:ring-1 focus:ring-indigo-500"
            >
              <option value="ALL">전체 상태</option>
              <option value="PENDING">대기 중 (PENDING)</option>
              <option value="APPROVED">승인됨 (APPROVED)</option>
              <option value="REJECTED">반려됨 (REJECTED)</option>
              <option value="CANCELED">취소됨 (CANCELED)</option>
            </select>
          </div>

          {pendingRequests.length > 0 && (
            <span className="ml-auto font-bold text-xs bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full animate-pulse">
              🔔 대기 중 신청 {pendingRequests.length}건
            </span>
          )}
        </div>
      </div>

      {/* 메시지 알림 */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3 rounded-xl text-xs font-bold">
          ✅ {successMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 p-3 rounded-xl text-xs font-bold">
          ⚠️ {error}
        </div>
      )}

      {/* 요청대장 리스트 */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-8 text-center text-xs font-semibold text-gray-500">
            <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent mb-2"></div>
            <p>수업교환 신청 목록을 불러오는 중입니다...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-8 text-center text-xs text-gray-500">
            <p className="font-semibold mb-1">조회된 수업교환 신청이 없습니다.</p>
            <p className="text-gray-400">필터 조건을 변경하거나 교사들의 신청을 기다려 주세요.</p>
          </div>
        ) : (
          <>
            {/* ① 대기 중(PENDING) 영역 - 작업 큐 (페이지네이션 없음) */}
            {pendingRequests.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <span>🔔 처리 대기 중 신청 ({pendingRequests.length}건)</span>
                    <span className="text-[10px] text-amber-700 font-normal">
                      · 오래된 신청순 (상단부터 순차 처리)
                    </span>
                  </h3>
                </div>

                {/* 묶음 일괄 그룹 렌더링 */}
                {Object.entries(pendingBatchGroups).map(([bId, bReqs]) => (
                  <div
                    key={`batch-${bId}`}
                    className="border-2 border-indigo-300 bg-indigo-50/20 rounded-xl p-2.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-black bg-indigo-600 text-white shadow-xs">
                          📦 묶음 신청 ({bReqs.length}건)
                        </span>
                        <span className="text-xs font-extrabold text-indigo-950">
                          {bReqs[0].requesterName} ({bReqs[0].requesterEmail})
                        </span>
                        {bReqs.some((r) => validity[r.id]?.ok === false) && (
                          <span className="text-[11px] font-black text-red-900 bg-red-100 border border-red-300 px-2 py-0.5 rounded-full">
                            ⚠️ 성립 불가 {bReqs.filter((r) => validity[r.id]?.ok === false).length}건 포함
                          </span>
                        )}
                      </div>

                      {!readOnly && (
                        <button
                          onClick={() => handleBatchApprove(bId, bReqs)}
                          disabled={batchApprovingId === bId}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs rounded transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                        >
                          <span>⚡</span>
                          <span>{batchApprovingId === bId ? "일괄 승인 중..." : "묶음 일괄 승인"}</span>
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {bReqs.map((req) => renderRequestRow(req))}
                    </div>
                  </div>
                ))}

                {/* 개별 대기 건 렌더링 */}
                {ungroupedPendingRequests.length > 0 && (
                  <div className="space-y-1.5">
                    {ungroupedPendingRequests.map((req) => renderRequestRow(req))}
                  </div>
                )}
              </div>
            )}

            {/* ② 처리 완료 목록 영역 (PENDING 제외 - 클라이언트 페이지네이션) */}
            {completedRequests.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold text-gray-700">
                    📜 처리 완료 내역 ({completedRequests.length}건)
                  </h3>
                </div>

                <div className="space-y-1.5">
                  {paginatedCompletedRequests.map((req) => renderRequestRow(req))}
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
          </>
        )}
      </div>

      {/* 반려 사유 입력 모달 */}
      {rejectingReq && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
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
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={rejectSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-xs disabled:opacity-50 cursor-pointer"
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
