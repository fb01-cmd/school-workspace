import { useState, useEffect } from "react";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { HomeroomAssignmentMap } from "@/lib/discipline/types";

interface HomeroomAssignmentTabProps {
  domain: string;
}

export default function HomeroomAssignmentTab({ domain }: HomeroomAssignmentTabProps) {
  const [assignments, setAssignments] = useState<HomeroomAssignmentMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const fetchHomeroom = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_homeroom" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "담임 배정 데이터를 불러오지 못했습니다.");
      }

      setAssignments(data.assignments || {});
      setHasUnsavedChanges(false);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHomeroom();
  }, []);

  const handleUpdateAssignment = (classKey: string, email: string) => {
    setAssignments((prev) => ({
      ...prev,
      [classKey]: email,
    }));
    setHasUnsavedChanges(true);
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_homeroom",
          assignments,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "담임 배정표 저장에 실패했습니다.");
      }

      setHasUnsavedChanges(false);
      setMessage({
        type: "success",
        text: "담임 배정표가 성공적으로 저장되었습니다. (해당 학반 담임 교사에게 view & record 권한이 자동 부여됩니다)",
      });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "저장 중 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const grades = [1, 2, 3];
  const maxClassNum = 12;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
            🏫 학급 담임 배정표 (Homeroom Assignments)
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            각 학년·반별 담임 교사를 지정합니다. 담임 교사에게는 자기 반 학생의 생활지도 기록 작성 및 열람 권한이 자동 부여됩니다.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {hasUnsavedChanges && (
            <span className="text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 rounded-md animate-pulse border border-amber-200 dark:border-amber-800">
              ⚠️ 미저장 변경사항 있음
            </span>
          )}

          <button
            onClick={() => handleSave()}
            disabled={saving || !hasUnsavedChanges}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md disabled:opacity-50 transition-all flex items-center space-x-2"
          >
            {saving ? (
              <span>저장 중...</span>
            ) : (
              <span>💾 담임 배정표 저장</span>
            )}
          </button>

          <button
            onClick={fetchHomeroom}
            className="p-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm font-medium ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-300"
              : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          담임 배정 데이터를 로딩하는 중...
        </div>
      ) : (
        <div className="space-y-8">
          {grades.map((grade) => (
            <div
              key={grade}
              className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 space-y-4"
            >
              <h3 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3 flex items-center justify-between">
                <span>{grade}학년 담임 배정</span>
                <span className="text-xs font-normal text-gray-500">1반 ~ {maxClassNum}반</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: maxClassNum }, (_, i) => i + 1).map((classNum) => {
                  const classKey = `${grade}-${classNum}`;
                  const currentEmail = assignments[classKey] || "";

                  return (
                    <div
                      key={classKey}
                      className="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-900 dark:text-white bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-2.5 py-1 rounded">
                          {grade}학년 {classNum}반
                        </span>
                        {currentEmail && (
                          <button
                            type="button"
                            onClick={() => handleUpdateAssignment(classKey, "")}
                            className="text-[11px] text-red-500 hover:underline"
                          >
                            비우기
                          </button>
                        )}
                      </div>

                      <AutocompleteInput
                        type="user"
                        domain={domain}
                        value={currentEmail}
                        onChange={(val) => handleUpdateAssignment(classKey, val)}
                        onSelect={(email) => handleUpdateAssignment(classKey, email)}
                        placeholder="담임 교사 검색/선택"
                        className="w-full text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
