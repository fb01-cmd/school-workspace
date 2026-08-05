import { useState, useEffect } from "react";
import { DisciplineConfig, DisciplineRecord } from "@/lib/discipline/types";

interface DisciplineVoidedTabProps {
  config: DisciplineConfig;
}

export default function DisciplineVoidedTab({ config }: DisciplineVoidedTabProps) {
  const [gradeFilter, setGradeFilter] = useState<number | "all">("all");
  const [classFilter, setClassFilter] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [voidedRecords, setVoidedRecords] = useState<DisciplineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVoidedRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: any = { action: "list", includeVoided: true };
      if (gradeFilter !== "all") payload.grade = gradeFilter;
      if (classFilter !== "all") payload.classNum = classFilter;

      const res = await fetch("/api/discipline/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "무효화 기록 목록을 불러오지 못했습니다.");
      }

      // includeVoided: true로 가져온 레코드 중 voided === true 인 항목만 추출
      const rawRecords: DisciplineRecord[] = data.records || [];
      const filtered = rawRecords.filter((r) => r.voided === true);

      // 무효화 일시 기준 최신순 정렬
      filtered.sort((a, b) => (b.voidedAt || b.occurredAt) - (a.voidedAt || a.occurredAt));
      setVoidedRecords(filtered);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVoidedRecords();
  }, [gradeFilter, classFilter]);

  const itemMap = new Map((config.items || []).map((it) => [it.id, it.label]));

  // 검색어 필터링 (학생 이름, 학번, 이메일, 항목명, 기록자, 사유)
  const filteredRecords = voidedRecords.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const itemLabel = (itemMap.get(r.itemId) || r.itemId).toLowerCase();
    return (
      (r.studentName && r.studentName.toLowerCase().includes(q)) ||
      (r.studentId && r.studentId.includes(q)) ||
      (r.studentEmail && r.studentEmail.toLowerCase().includes(q)) ||
      itemLabel.includes(q) ||
      (r.recordedBy && r.recordedBy.toLowerCase().includes(q)) ||
      (r.voidedBy && r.voidedBy.toLowerCase().includes(q)) ||
      (r.voidReason && r.voidReason.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 pb-10">
      {/* 헤더 및 필터 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center space-x-2">
            <span>🗑️ 무효화 보관함</span>
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            입력 착오 등으로 무효화 처리된 지도 기록 보관함입니다. (회차 계산 제외 및 읽기 전용)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 학년 필터 */}
          <select
            value={gradeFilter}
            onChange={(e) => {
              const val = e.target.value;
              setGradeFilter(val === "all" ? "all" : parseInt(val, 10));
            }}
            className="p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm font-medium text-gray-900 dark:text-white"
          >
            <option value="all">전체 학년</option>
            <option value={1}>1학년</option>
            <option value={2}>2학년</option>
            <option value={3}>3학년</option>
          </select>

          {/* 반 필터 */}
          <select
            value={classFilter}
            onChange={(e) => {
              const val = e.target.value;
              setClassFilter(val === "all" ? "all" : parseInt(val, 10));
            }}
            className="p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm font-medium text-gray-900 dark:text-white"
          >
            <option value="all">전체 반</option>
            {Array.from({ length: 15 }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>
                {c}반
              </option>
            ))}
          </select>

          {/* 검색 입력 */}
          <input
            type="text"
            placeholder="학생/기록자/사유 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white w-52"
          />

          <button
            onClick={fetchVoidedRecords}
            className="p-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 무효화 기록 목록 */}
      {loading ? (
        <div className="py-20 text-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          무효화 보관함을 불러오는 중...
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-center">
          {error}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          보관된 무효화 기록이 없습니다.
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-900/30">
            <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
              무효화 목록 (총 {filteredRecords.length}건)
            </span>
            <span className="text-xs text-gray-400">※ 이 목록은 읽기 전용입니다.</span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {filteredRecords.map((r) => {
              const itemLabel = itemMap.get(r.itemId) || r.itemId;
              const voidedAtStr = r.voidedAt
                ? new Date(r.voidedAt).toLocaleString("ko-KR", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "-";
              const occurredDateStr = r.occurredAt
                ? new Date(r.occurredAt).toLocaleDateString("ko-KR")
                : "-";

              return (
                <div key={r.id} className="p-5 hover:bg-gray-50/80 dark:hover:bg-gray-750/50 transition-colors space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-3">
                      <span className="text-xs font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-md">
                        {r.grade}학년 {r.classNum}반 ({r.studentId})
                      </span>
                      <h4 className="font-bold text-base text-gray-900 dark:text-white">
                        {r.studentName || r.studentId}
                      </h4>
                      <span className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2.5 py-0.5 rounded-full border border-red-200 dark:border-red-800">
                        무효화됨
                      </span>
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      발생일: <strong className="text-gray-700 dark:text-gray-300">{occurredDateStr}</strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-gray-50 dark:bg-gray-900/40 p-3.5 rounded-lg border border-gray-100 dark:border-gray-800">
                    <div>
                      <span className="text-gray-400 font-medium">지도 항목: </span>
                      <span className="font-bold text-gray-800 dark:text-gray-200">{itemLabel}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 font-medium">최초 작성자: </span>
                      <span className="text-gray-700 dark:text-gray-300">{r.recordedBy}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 font-medium">무효화 일시: </span>
                      <span className="text-gray-700 dark:text-gray-300">{voidedAtStr}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 font-medium">무효화 처리자: </span>
                      <span className="text-gray-700 dark:text-gray-300">{r.voidedBy || "-"}</span>
                    </div>
                  </div>

                  {r.note && (
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      <span className="font-semibold text-gray-500">원래 비고: </span>
                      {r.note}
                    </div>
                  )}

                  {r.voidReason && (
                    <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-900/40">
                      <span className="font-bold text-red-800 dark:text-red-200">무효화 사유: </span>
                      {r.voidReason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
