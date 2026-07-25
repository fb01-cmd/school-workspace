import { useState, useEffect } from "react";
import { DisciplineConfig, DisciplineRecord, DisciplineStageEvent, StudentDisciplineStatus } from "@/lib/discipline/types";

interface StudentItem {
  studentId: string;
  studentEmail: string;
  studentName: string;
  grade: number;
  classNum: number;
  status: StudentDisciplineStatus;
  records: DisciplineRecord[];
  stageEvents: DisciplineStageEvent[];
}

interface DisciplineStatusTabProps {
  config: DisciplineConfig;
}

export default function DisciplineStatusTab({ config }: DisciplineStatusTabProps) {
  const [gradeFilter, setGradeFilter] = useState<number | "all">("all");
  const [classFilter, setClassFilter] = useState<number | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 모달 상태
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [voidModalRecord, setVoidModalRecord] = useState<DisciplineRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: any = { action: "list" };
      if (gradeFilter !== "all") payload.grade = gradeFilter;
      if (classFilter !== "all") payload.classNum = classFilter;

      const res = await fetch("/api/discipline/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "지도 현황을 불러오지 못했습니다.");
      }

      setStudents(data.students || []);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [gradeFilter, classFilter]);

  const handleVoidRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidModalRecord || !voidReason.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch("/api/discipline/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "void",
          recordId: voidModalRecord.id,
          voidReason: voidReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "기록 무효화 실패");
      }

      // 데이터 갱신
      setVoidModalRecord(null);
      setVoidReason("");
      await fetchRecords();

      // 모달 갱신
      if (selectedStudent) {
        const updatedRes = await fetch("/api/discipline/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", grade: selectedStudent.grade, classNum: selectedStudent.classNum }),
        });
        if (updatedRes.ok) {
          const updatedData = await updatedRes.json();
          const found = (updatedData.students || []).find((s: StudentItem) => s.studentId === selectedStudent.studentId);
          if (found) setSelectedStudent(found);
        }
      }
    } catch (err: any) {
      alert(err.message || "무효화 중 오류 발생");
    } finally {
      setActionLoading(false);
    }
  };

  // Stage id -> Stage label 맵
  const stageMap = new Map((config.stages || []).map((s) => [s.id, s.label]));
  const itemMap = new Map((config.items || []).map((it) => [it.id, it.label]));

  // 검색어 필터링
  const filteredStudents = students.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.studentName.toLowerCase().includes(q) ||
      s.studentId.includes(q) ||
      s.studentEmail.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 pb-10">
      {/* 헤더 및 필터 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">📊 생활지도 현황</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            학생별 생활지도 기록 횟수 및 실시간으로 계산된 조치 단계를 확인합니다.
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

          {/* 학생 검색 */}
          <input
            type="text"
            placeholder="이름 또는 학번 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white w-48"
          />

          <button
            onClick={fetchRecords}
            className="p-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 목록 콘텐츠 */}
      {loading ? (
        <div className="py-20 text-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          지도 현황을 불러오는 중...
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-center">
          {error}
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          조건에 일치하는 지도 기록 또는 학생이 없습니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredStudents.map((st) => {
            const currentStageLabel = st.status.currentStageId
              ? stageMap.get(st.status.currentStageId) || st.status.currentStageId
              : "정상 (1단계 미만)";

            const totalRecordsCount = (st.records || []).filter((r) => !r.voided).length;

            return (
              <div
                key={st.studentId}
                onClick={() => setSelectedStudent(st)}
                className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all cursor-pointer space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                      {st.studentId}
                    </span>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">
                      {st.studentName}
                    </h3>
                  </div>

                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      st.status.currentStageId
                        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                        : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                    }`}
                  >
                    {currentStageLabel}
                  </span>
                </div>

                <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between pt-1 border-t border-gray-100 dark:border-gray-700">
                  <span>유효 지도 기록: <strong className="text-gray-900 dark:text-white">{totalRecordsCount}건</strong></span>
                  <span className="text-blue-600 dark:text-blue-400 font-medium">상세 이력 보기 &rarr;</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 1. 학생 지도 상세 및 이력 타임라인 모달 */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            {/* 모달 헤더 */}
            <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/30">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold text-gray-500">{selectedStudent.studentId}</span>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {selectedStudent.studentName} 학생 지도 이력
                  </h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {selectedStudent.grade}학년 {selectedStudent.classNum}반 ({selectedStudent.studentEmail})
                </p>
              </div>
              <button
                onClick={() => setSelectedStudent(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg"
              >
                ✕
              </button>
            </div>

            {/* 모달 바디 */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* 단계 판정 상태 요약 카드 */}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">현재 자동 계산 단계</div>
                  <div className="text-lg font-bold text-blue-950 dark:text-blue-100 mt-0.5">
                    {selectedStudent.status.currentStageId
                      ? stageMap.get(selectedStudent.status.currentStageId) || selectedStudent.status.currentStageId
                      : "단계 미해당 (정상)"}
                  </div>
                </div>
                {selectedStudent.status.triggered.length > 0 && (
                  <div className="text-right">
                    <div className="text-xs text-blue-700 dark:text-blue-300 font-medium">충족 규칙</div>
                    <div className="text-xs text-blue-900 dark:text-blue-200 mt-0.5">
                      {selectedStudent.status.triggered.length}개 규칙 도달
                    </div>
                  </div>
                )}
              </div>

              {/* 기록 이력 목록 */}
              <div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center justify-between">
                  <span>지도 기록 (총 {selectedStudent.records.length}건)</span>
                </h4>

                {selectedStudent.records.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-500 border border-dashed rounded-lg">
                    등록된 지도 기록이 없습니다.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedStudent.records.map((rec) => (
                      <div
                        key={rec.id}
                        className={`p-4 rounded-xl border transition-all ${
                          rec.voided
                            ? "bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800 opacity-60"
                            : "bg-white dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 shadow-sm"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-sm text-gray-900 dark:text-white">
                                {itemMap.get(rec.itemId) || rec.itemId}
                              </span>
                              {rec.voided && (
                                <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded">
                                  [무효화됨]
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              발생 일시: {new Date(rec.occurredAt).toLocaleString("ko-KR")} | 작성자: {rec.recordedBy}
                            </div>
                          </div>

                          {!rec.voided && (
                            <button
                              onClick={() => setVoidModalRecord(rec)}
                              className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded"
                            >
                              무효화
                            </button>
                          )}
                        </div>

                        {rec.note && (
                          <div className="mt-2 text-xs bg-gray-50 dark:bg-gray-800 p-2.5 rounded-lg text-gray-700 dark:text-gray-300">
                            {rec.note}
                          </div>
                        )}

                        {rec.voided && rec.voidReason && (
                          <div className="mt-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                            무효화 사유: {rec.voidReason} ({rec.voidedBy})
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 무효화 사유 입력 모달 */}
      {voidModalRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              지도 기록 무효화
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              지도 기록은 삭제되지 않으며 무효화 처리되어 회차 계산에서 제외됩니다.
            </p>

            <form onSubmit={handleVoidRecord} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  무효화 사유 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  rows={3}
                  placeholder="예: 착오 입력으로 인한 무효화 처리"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVoidModalRecord(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !voidReason.trim()}
                  className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow disabled:opacity-50"
                >
                  {actionLoading ? "처리 중..." : "무효화 실행"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
