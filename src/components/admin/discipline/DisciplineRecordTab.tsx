import { useState, useEffect } from "react";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { DisciplineItem } from "@/lib/discipline/types";

interface DisciplineRecordTabProps {
  domain: string;
  configItems: DisciplineItem[];
}

export default function DisciplineRecordTab({ domain, configItems }: DisciplineRecordTabProps) {
  const [studentInput, setStudentInput] = useState("");
  const [selectedStudentEmail, setSelectedStudentEmail] = useState("");
  const [selectedStudentName, setSelectedStudentName] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [occurredAtStr, setOccurredAtStr] = useState(() => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  });
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // active인 항목만 필터링
  const activeItems = configItems.filter((it) => it.active !== false);

  // 카테고리별 그룹화
  const categories = Array.from(new Set(activeItems.map((it) => it.category || "기타")));

  const handleSelectStudent = (email: string, name?: string) => {
    setSelectedStudentEmail(email);
    setSelectedStudentName(name || email);
    setStudentInput(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!selectedStudentEmail) {
      setMessage({ type: "error", text: "학생을 선택해주세요." });
      return;
    }
    // 서버는 학번(5자리)만 신뢰한다 — 학생 계정 이메일(학번@도메인)에서 학번을 추출
    const studentIdMatch = selectedStudentEmail.trim().match(/^(\d{5})@/);
    if (!studentIdMatch) {
      setMessage({
        type: "error",
        text: "학생 계정(학번@도메인 형식)만 선택할 수 있습니다. 자동완성 목록에서 학생을 선택해주세요.",
      });
      return;
    }
    if (!selectedItemId) {
      setMessage({ type: "error", text: "지도 항목을 선택해주세요." });
      return;
    }

    const occurredAtDate = new Date(occurredAtStr);
    if (isNaN(occurredAtDate.getTime())) {
      setMessage({ type: "error", text: "올바른 발생 일시를 입력해주세요." });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/discipline/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          studentId: studentIdMatch[1],
          studentName: selectedStudentName,
          itemId: selectedItemId,
          occurredAt: occurredAtDate.toISOString(),
          note: note.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "지도 기록 입력에 실패했습니다.");
      }

      setMessage({
        type: "success",
        text: `[${selectedStudentName || selectedStudentEmail}] 지도 기록이 성공적으로 등록되었습니다.${
          data.stageEventCreated ? " (단계 도달 — 처리함에 사안이 생성되었습니다)" : ""
        }`,
      });

      // 폼 초기화
      setStudentInput("");
      setSelectedStudentEmail("");
      setSelectedStudentName("");
      setSelectedItemId("");
      setNote("");
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">📝 지도 기록 입력</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          학생의 생활지도 항목 및 발생 사실을 기록합니다. 입력된 사안은 실시간으로 단계 조건이 자동 계산됩니다.
        </p>

        {message && (
          <div
            className={`p-4 mb-6 rounded-lg text-sm font-medium ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
                : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800"
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. 대상 학생 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              대상 학생 <span className="text-red-500">*</span>
            </label>
            <AutocompleteInput
              type="user"
              domain={domain}
              value={studentInput}
              onChange={(val) => {
                setStudentInput(val);
                setSelectedStudentEmail(val);
              }}
              onSelect={handleSelectStudent}
              placeholder="학생 이름 또는 이메일/학번 검색"
              className="w-full"
            />
            {selectedStudentEmail && (
              <div className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-md inline-block">
                선택된 학생: {selectedStudentName} ({selectedStudentEmail})
              </div>
            )}
          </div>

          {/* 2. 지도 항목 선택 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              지도 항목 선택 <span className="text-red-500">*</span>
            </label>
            {activeItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500 border border-dashed rounded-lg">
                등록되어 활성화된 지도 항목이 없습니다. (규정 편집기에서 항목을 추가하세요)
              </div>
            ) : (
              <div className="space-y-4">
                {categories.map((cat) => {
                  const catItems = activeItems.filter((it) => (it.category || "기타") === cat);
                  return (
                    <div key={cat} className="space-y-2">
                      <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {cat}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {catItems.map((item) => {
                          const isSelected = selectedItemId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setSelectedItemId(item.id)}
                              className={`p-3.5 text-left rounded-xl border text-sm font-medium transition-all min-h-[52px] flex items-center justify-between ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/20 dark:bg-blue-900/40 dark:text-blue-100 dark:border-blue-500"
                                  : "border-gray-200 bg-white hover:bg-gray-50 text-gray-700 dark:bg-gray-700/50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                              }`}
                            >
                              <span>{item.label}</span>
                              {isSelected && (
                                <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400"></span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. 발생 일시 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              발생 일시 <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={occurredAtStr}
              onChange={(e) => setOccurredAtStr(e.target.value)}
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* 4. 비고 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              비고 / 상세 내용
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="예: 1교시 생활지도 사복 착용 지적 (구체적 상황 기재)"
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            ></textarea>
          </div>

          {/* 제출 버튼 */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !selectedStudentEmail || !selectedItemId}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all text-base flex items-center justify-center space-x-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>기록 등록 중...</span>
                </>
              ) : (
                <span>📝 생활지도 기록 등록</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
