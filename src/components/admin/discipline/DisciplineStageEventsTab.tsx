import { useState, useEffect } from "react";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { DisciplineConfig, DisciplineStageEvent } from "@/lib/discipline/types";
import { getClientCache } from "@/lib/cache/clientCache";

interface DisciplineStageEventsTabProps {
  domain: string;
  config: DisciplineConfig;
}

export default function DisciplineStageEventsTab({ domain, config }: DisciplineStageEventsTabProps) {
  const [filterTab, setFilterTab] = useState<"unresolved" | "resolved">("unresolved");
  const [events, setEvents] = useState<DisciplineStageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 조치(Resolve) 모달 상태
  const [resolveEvent, setResolveEvent] = useState<DisciplineStageEvent | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // 수동 단계 지정(Manual Event) 모달 상태
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualStudentInput, setManualStudentInput] = useState("");
  const [manualStudentEmail, setManualStudentEmail] = useState("");
  const [manualStudentName, setManualStudentName] = useState("");
  const [manualStageId, setManualStageId] = useState("");
  const [manualReason, setManualReason] = useState("");

  const stageMap = new Map((config.stages || []).map((s) => [s.id, s.label]));

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discipline/stage-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // onlyPending:false — 미처리/조치완료 탭 분리는 클라이언트에서 수행
        body: JSON.stringify({ action: "list", onlyPending: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "조치 처리함 데이터를 불러오지 못했습니다.");
      }

      setEvents(data.events || []);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveEvent || !resolutionText.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch("/api/discipline/stage-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          eventId: resolveEvent.id,
          resolution: resolutionText.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "단계 조치 처리에 실패했습니다.");
      }

      setResolveEvent(null);
      setResolutionText("");
      await fetchEvents();
    } catch (err: any) {
      alert(err.message || "오류가 발생했습니다.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualStudentEmail || !manualStageId || !manualReason.trim()) return;

    // 학번 해석: 이메일 앞자리가 아니라 명단 데이터의 학번(familyName)이 단일 원본이다.
    // (학생 실계정 이메일은 입학년도 기반(예: 26027@)이라 학번과 다름 — 이메일 파싱 금지, bbbb1be·산출물 D 참조)
    const lower = manualStudentEmail.trim().toLowerCase();
    const users: any[] = getClientCache("users:all") || [];
    const matched = users.find((x) => (x.primaryEmail || x.email || "").toLowerCase() === lower);
    const fam = typeof matched?.name === "object" ? (matched.name?.familyName || "").trim() : "";
    if (!/^\d{5}$/.test(fam)) {
      alert("명단에서 학생의 학번을 확인하지 못했습니다. 자동완성 목록에서 학생을 선택해 주세요.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/discipline/stage-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_manual",
          studentId: fam,
          studentEmail: manualStudentEmail.trim(),
          studentName: manualStudentName,
          stageId: manualStageId,
          reason: manualReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "수동 단계 부여 실패");
      }

      setShowManualModal(false);
      setManualStudentInput("");
      setManualStudentEmail("");
      setManualStudentName("");
      setManualStageId("");
      setManualReason("");
      await fetchEvents();
    } catch (err: any) {
      alert(err.message || "오류가 발생했습니다.");
    } finally {
      setActionLoading(false);
    }
  };

  const filteredEvents = events.filter((ev) =>
    filterTab === "unresolved" ? !ev.resolved : ev.resolved
  );

  return (
    <div className="space-y-6 pb-10">
      {/* 헤더 & 액션 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">📥 조치 처리함</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            지도 단계에 도달한 학생의 조치를 입력하거나 수동으로 단계를 지정합니다.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowManualModal(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition-all flex items-center space-x-1.5"
          >
            <span>➕ 수동 단계 지정</span>
          </button>

          <button
            onClick={fetchEvents}
            className="p-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 탭 버튼 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setFilterTab("unresolved")}
          className={`pb-3 px-4 font-bold text-sm border-b-2 transition-all ${
            filterTab === "unresolved"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
          }`}
        >
          미처리 사안 (
          {events.filter((e) => !e.resolved).length}건)
        </button>
        <button
          onClick={() => setFilterTab("resolved")}
          className={`pb-3 px-4 font-bold text-sm border-b-2 transition-all ${
            filterTab === "resolved"
              ? "border-blue-600 text-blue-600 dark:text-blue-400"
              : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
          }`}
        >
          조치 완료 (
          {events.filter((e) => e.resolved).length}건)
        </button>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="py-20 text-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          조치 처리함 데이터를 가져오는 중...
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-center">
          {error}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          {filterTab === "unresolved" ? "미처리 상태인 단계 사안이 없습니다." : "조치 완료된 사안이 없습니다."}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((ev) => {
            const stageLabel = stageMap.get(ev.stageId) || ev.stageId;
            return (
              <div
                key={ev.id}
                className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center space-x-3">
                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded">
                      {ev.studentId} {ev.studentName}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {ev.grade}학년 {ev.classNum}반
                    </span>
                    <span className="text-xs font-bold text-white bg-blue-600 px-2.5 py-0.5 rounded-full">
                      {stageLabel}
                    </span>
                    {ev.cause === "manual" && (
                      <span className="text-xs font-bold text-amber-800 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded">
                        [수동 지정]
                      </span>
                    )}
                  </div>

                  <div className="text-sm text-gray-800 dark:text-gray-200">
                    {ev.cause === "manual" ? (
                      <span className="font-medium text-amber-900 dark:text-amber-200">
                        수동 지정 사유: {ev.manualReason}
                      </span>
                    ) : (
                      <span>
                        자동 규칙 도달 (발생 일시: {new Date(ev.enteredAt).toLocaleString("ko-KR")})
                      </span>
                    )}
                  </div>

                  {ev.resolved && ev.resolution && (
                    <div className="text-xs bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 p-2.5 rounded-lg border border-green-100 dark:border-green-800">
                      <strong>조치 내용:</strong> {ev.resolution} ({ev.resolvedBy})
                    </div>
                  )}
                </div>

                <div>
                  {!ev.resolved ? (
                    <button
                      onClick={() => setResolveEvent(ev)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all"
                    >
                      ✅ 조치 완료 처리
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                      {new Date(ev.resolvedAt || 0).toLocaleDateString("ko-KR")} 완료
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 1. 조치 모달 */}
      {resolveEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              단계 조치 결과 작성
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              [{resolveEvent.studentName}] 학생의 [{stageMap.get(resolveEvent.stageId) || resolveEvent.stageId}] 단계에 대한 지도 및 조치 내용을 기록합니다.
            </p>

            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  조치 사항 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  rows={4}
                  placeholder="예: 학부모 상담 완료 및 생활교육위원회 안건 제출"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResolveEvent(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !resolutionText.trim()}
                  className="px-4 py-2 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow disabled:opacity-50"
                >
                  {actionLoading ? "저장 중..." : "조치 저장"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. 수동 단계 지정 모달 */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              수동 지도 단계 지정
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              회차 자동 계산과 별개로 특정 학생에게 수동으로 조치 단계를 부여합니다.
            </p>

            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  대상 학생 <span className="text-red-500">*</span>
                </label>
                <AutocompleteInput
                  type="user"
                  domain={domain}
                  value={manualStudentInput}
                  onChange={(val) => {
                    setManualStudentInput(val);
                    setManualStudentEmail(val);
                  }}
                  onSelect={(email, name) => {
                    setManualStudentEmail(email);
                    setManualStudentName(name || email);
                    setManualStudentInput(email);
                  }}
                  placeholder="학생 이름 또는 학번 검색"
                  className="w-full"
                />
                {manualStudentEmail && (
                  <div className="mt-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
                    선택: {manualStudentName} ({manualStudentEmail})
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  부여할 단계 <span className="text-red-500">*</span>
                </label>
                <select
                  value={manualStageId}
                  onChange={(e) => setManualStageId(e.target.value)}
                  className="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                >
                  <option value="">단계 선택...</option>
                  {(config.stages || []).map((st) => (
                    <option key={st.id} value={st.id}>
                      [{st.order}단계] {st.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  수동 부여 사유 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  rows={3}
                  placeholder="예: 중대 지도 사안으로 선도위 직권 상정"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !manualStudentEmail || !manualStageId || !manualReason.trim()}
                  className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow disabled:opacity-50"
                >
                  {actionLoading ? "부여 중..." : "단계 부여"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
