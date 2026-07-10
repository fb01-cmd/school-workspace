"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchAuditLogs, AuditLog } from "@/lib/firebase/audit";
import { useAuth } from "@/context/AuthContext";

export default function AuditLogViewer() {
  const { userData } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const loadLogs = async () => {
    setLoading(true);
    // Fetch a generous buffer size (500 logs) to filter instantly on client side.
    const data = await fetchAuditLogs(500); 
    setLogs(data);
    setLoading(false);
    setCurrentPage(1); // Reset page on refresh
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const formatTimestamp = (ts: any) => {
    if (!ts) return "-";
    const date = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  // Memory filtering including Date Range Checks
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const query = searchQuery.toLowerCase().trim();
      const matchQuery =
        log.operatorEmail.toLowerCase().includes(query) ||
        (log.operatorName && log.operatorName.toLowerCase().includes(query)) ||
        log.targetEmail.toLowerCase().includes(query) ||
        log.details.toLowerCase().includes(query);

      const matchAction = actionFilter === "all" || log.action === actionFilter;

      // Date parsing
      let matchDate = true;
      if (log.timestamp) {
        const logDate = log.timestamp.seconds ? new Date(log.timestamp.seconds * 1000) : new Date(log.timestamp);
        
        if (startDate) {
          const startLimit = new Date(`${startDate}T00:00:00`);
          if (logDate < startLimit) matchDate = false;
        }
        if (endDate) {
          const endLimit = new Date(`${endDate}T23:59:59`);
          if (logDate > endLimit) matchDate = false;
        }
      }

      return matchQuery && matchAction && matchDate;
    });
  }, [logs, searchQuery, actionFilter, startDate, endDate]);

  // Handle filter changes to reset page count
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, actionFilter, startDate, endDate, itemsPerPage]);

  // Paginated selection slice
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLogs.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLogs, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  }, [filteredLogs, itemsPerPage]);

  // Extract unique actions for filters
  const uniqueActions = useMemo(() => {
    return Array.from(new Set(logs.map((l) => l.action)));
  }, [logs]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">🛡️ 작업 감사 로그 (Audit Logs)</h2>
          <p className="text-slate-500 text-xs mt-1">
            수퍼관리자가 학교 계정 및 조직단위에 수행한 모든 실시간 변경 이력입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={loadLogs}
          disabled={loading}
          className="self-start sm:self-center bg-slate-50 hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold px-3 py-2 rounded-md transition-colors shadow-sm flex items-center gap-1.5"
        >
          🔄 {loading ? "불러오는 중..." : "실시간 새로고침"}
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg">
        {/* Search */}
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">통합 검색</label>
          <input
            type="text"
            placeholder="관리자 이름/이메일, 대상 이메일, 세부 내용 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          />
        </div>

        {/* Action filter */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">작업 유형</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          >
            <option value="all">전체 작업</option>
            {uniqueActions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
        </div>

        {/* Page size controller */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">표시 개수</label>
          <select
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(Number(e.target.value))}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          >
            <option value={10}>10개씩 보기</option>
            <option value={20}>20개씩 보기</option>
            <option value={50}>50개씩 보기</option>
            <option value={100}>100개씩 보기</option>
          </select>
        </div>

        {/* Date Ranges */}
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">시작일</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">종료일</label>
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="px-2 py-1.5 text-xs text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded font-semibold transition-colors whitespace-nowrap"
              >
                지우기
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Logs Table Container */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-xs border-collapse">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left font-bold w-48">작업 일시</th>
              <th className="px-4 py-3 text-left font-bold w-48">관리자 (행위자)</th>
              <th className="px-4 py-3 text-left font-bold w-36">작업 종류</th>
              <th className="px-4 py-3 text-left font-bold w-48">대상 계정</th>
              <th className="px-4 py-3 text-left font-bold">상세 내용</th>
              <th className="px-4 py-3 text-center font-bold w-24">상태</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <span className="text-[11px]">로그 데이터를 읽어오는 중...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-slate-400">
                  검색 조건에 맞는 감사 로그가 없습니다.
                </td>
              </tr>
            ) : (
              paginatedLogs.map((log) => {
                const isSuccess = log.status === "success";
                return (
                  <tr key={log.id} className="hover:bg-slate-50/50">
                    {/* Timestamp */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    
                    {/* Actor (Admin) */}
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-700">
                      <div>{log.operatorName || "이름없음"}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{log.operatorEmail}</div>
                    </td>

                    {/* Action Category */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {log.action}
                      </span>
                    </td>

                    {/* Target User */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-mono">
                      {log.targetEmail}
                    </td>

                    {/* Details */}
                    <td className="px-4 py-3 text-slate-600 leading-relaxed font-sans max-w-md break-words">
                      {log.details}
                      {log.error && (
                        <div className="text-[10px] text-red-500 mt-1 font-mono">
                          ❌ 에러: {log.error}
                        </div>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {isSuccess ? (
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          성공
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                          실패
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {!loading && filteredLogs.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200 text-xs text-slate-500">
          <div>
            전체 <span className="font-semibold text-slate-800">{filteredLogs.length}</span>건 중{" "}
            <span className="font-semibold text-slate-800">
              {Math.min(filteredLogs.length, (currentPage - 1) * itemsPerPage + 1)}
            </span>{" "}
            -{" "}
            <span className="font-semibold text-slate-800">
              {Math.min(filteredLogs.length, currentPage * itemsPerPage)}
            </span>{" "}
            표시 중
          </div>
          
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-slate-50 font-semibold"
            >
              처음
            </button>
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-slate-50 font-semibold"
            >
              이전
            </button>
            
            <span className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded text-indigo-700 font-bold font-mono">
              {currentPage} / {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-slate-50 font-semibold"
            >
              다음
            </button>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-slate-50 font-semibold"
            >
              끝
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
