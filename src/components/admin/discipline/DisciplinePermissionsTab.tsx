import { useState, useEffect } from "react";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { DisciplineGrant, DisciplineRight, DisciplineScope, ALL_DISCIPLINE_RIGHTS } from "@/lib/discipline/types";
import { invalidateClientCache } from "@/lib/cache/clientCache";

interface DisciplinePermissionsTabProps {
  domain: string;
  onPermissionsUpdated?: () => void;
}

export default function DisciplinePermissionsTab({ domain, onPermissionsUpdated }: DisciplinePermissionsTabProps) {
  const [grants, setGrants] = useState<DisciplineGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Grant 추가 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [teacherInput, setTeacherInput] = useState("");
  const [selectedTeacherEmail, setSelectedTeacherEmail] = useState("");
  const [selectedTeacherName, setSelectedTeacherName] = useState("");

  const [scopeType, setScopeType] = useState<"all" | "grade" | "class">("all");
  const [scopeGrade, setScopeGrade] = useState<number>(1);
  const [scopeClassNum, setScopeClassNum] = useState<number>(1);

  const [selectedRights, setSelectedRights] = useState<DisciplineRight[]>(["view", "record"]);
  const [expiresAtDateStr, setExpiresAtDateStr] = useState("");

  const [actionLoading, setActionLoading] = useState(false);

  const fetchGrants = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_grants" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "권한 목록을 불러오지 못했습니다.");
      }

      setGrants(data.grants || []);
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGrants();
  }, []);

  const handleCreateGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacherEmail || selectedRights.length === 0) return;

    let scope: DisciplineScope = { type: "all" };
    if (scopeType === "grade") {
      scope = { type: "grade", grade: scopeGrade };
    } else if (scopeType === "class") {
      scope = { type: "class", grade: scopeGrade, classNum: scopeClassNum };
    }

    const expiresAt = expiresAtDateStr ? new Date(expiresAtDateStr).getTime() : null;

    setActionLoading(true);
    try {
      const res = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_grant",
          teacherEmail: selectedTeacherEmail,
          scope,
          rights: selectedRights,
          expiresAt,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "권한 부여 실패");
      }

      setShowAddModal(false);
      setTeacherInput("");
      setSelectedTeacherEmail("");
      setSelectedTeacherName("");
      setSelectedRights(["view", "record"]);
      setExpiresAtDateStr("");
      invalidateClientCache("discipline:my");
      onPermissionsUpdated?.();
      await fetchGrants();
    } catch (err: any) {
      alert(err.message || "오류가 발생했습니다.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!confirm("해당 권한 부여를 회수하시겠습니까?")) return;

    try {
      const res = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revoke_grant",
          grantId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "권한 회수 실패");
      }

      invalidateClientCache("discipline:my");
      onPermissionsUpdated?.();
      await fetchGrants();
    } catch (err: any) {
      alert(err.message || "오류가 발생했습니다.");
    }
  };

  const rightLabels: Record<DisciplineRight, string> = {
    view: "열람(view)",
    record: "기록(record)",
    resolve: "단계처리(resolve)",
    manage_rules: "규정관리(manage_rules)",
    manage_permissions: "권한관리(manage_permissions)",
  };

  return (
    <div className="space-y-6 pb-10">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">🔑 생활지도 특별 권한 관리 (Grants)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            담임 기본 권한 외에 특정 교직원(학년부장, 인성부장 등)에게 생활지도 개별 권한 및 범위를 지정 부여합니다.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center space-x-1.5"
          >
            <span>➕ 권한 부여 (Grant)</span>
          </button>

          <button
            onClick={fetchGrants}
            className="p-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="py-20 text-center text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          권한 부여 내역을 가져오는 중...
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-center">
          {error}
        </div>
      ) : grants.length === 0 ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          부여된 특별 권한 내역이 없습니다. (수퍼어드민 및 담임 교사의 기본 권한은 자동으로 적용됩니다)
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-left text-sm text-gray-800 dark:text-gray-200">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="p-4">교사 이메일</th>
                <th className="p-4">적용 범위 (Scope)</th>
                <th className="p-4">부여 권한 (Rights)</th>
                <th className="p-4">부여자 / 일시</th>
                <th className="p-4 text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {grants.map((g) => {
                let scopeStr = "전체 (All)";
                if (g.scope.type === "grade") scopeStr = `${g.scope.grade}학년 전체`;
                if (g.scope.type === "class") scopeStr = `${g.scope.grade}학년 ${g.scope.classNum}반`;

                return (
                  <tr key={g.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="p-4 font-bold text-gray-900 dark:text-white">{g.teacherEmail}</td>
                    <td className="p-4">
                      <span className="text-xs font-bold px-2.5 py-1 rounded bg-blue-50 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                        {scopeStr}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {g.rights.map((r) => (
                          <span
                            key={r}
                            className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                          >
                            {rightLabels[r] || r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-xs text-gray-500">
                      <div>{g.grantedBy}</div>
                      <div>{g.grantedAt ? new Date(g.grantedAt).toLocaleDateString("ko-KR") : "-"}</div>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleRevokeGrant(g.id)}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline font-bold px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded"
                      >
                        회수
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 권한 부여 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              새 특별 권한 부여 (Grant)
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              특정 교사에게 지정 범위 및 생활지도 실행 권한을 부여합니다.
            </p>

            <form onSubmit={handleCreateGrant} className="space-y-4">
              {/* 교사 선택 */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  대상 교사 <span className="text-red-500">*</span>
                </label>
                <AutocompleteInput
                  type="user"
                  domain={domain}
                  value={teacherInput}
                  onChange={(val) => {
                    setTeacherInput(val);
                    setSelectedTeacherEmail("");
                    setSelectedTeacherName("");
                  }}
                  onSelect={(email, name) => {
                    setSelectedTeacherEmail(email);
                    setSelectedTeacherName(name || email);
                    setTeacherInput(`${name || ""} (${email})`);
                  }}
                  placeholder="교사 이름 또는 이메일 검색"
                  className="w-full"
                />
                {selectedTeacherEmail && (
                  <div className="mt-1 text-xs text-blue-600 font-medium">
                    선택: {selectedTeacherName} ({selectedTeacherEmail})
                  </div>
                )}
              </div>

              {/* 범위 (Scope) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  권한 범위 (Scope) <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setScopeType("all")}
                    className={`py-2 text-xs font-bold rounded-lg border ${
                      scopeType === "all"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600"
                    }`}
                  >
                    학교 전체 (All)
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeType("grade")}
                    className={`py-2 text-xs font-bold rounded-lg border ${
                      scopeType === "grade"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600"
                    }`}
                  >
                    특정 학년
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeType("class")}
                    className={`py-2 text-xs font-bold rounded-lg border ${
                      scopeType === "class"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600"
                    }`}
                  >
                    특정 학반
                  </button>
                </div>

                {scopeType === "grade" && (
                  <select
                    value={scopeGrade}
                    onChange={(e) => setScopeGrade(parseInt(e.target.value, 10))}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value={1}>1학년</option>
                    <option value={2}>2학년</option>
                    <option value={3}>3학년</option>
                  </select>
                )}

                {scopeType === "class" && (
                  <div className="flex space-x-2">
                    <select
                      value={scopeGrade}
                      onChange={(e) => setScopeGrade(parseInt(e.target.value, 10))}
                      className="w-1/2 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value={1}>1학년</option>
                      <option value={2}>2학년</option>
                      <option value={3}>3학년</option>
                    </select>
                    <select
                      value={scopeClassNum}
                      onChange={(e) => setScopeClassNum(parseInt(e.target.value, 10))}
                      className="w-1/2 p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      {Array.from({ length: 15 }, (_, i) => i + 1).map((c) => (
                        <option key={c} value={c}>
                          {c}반
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* 권한 목록 (Rights) */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                  부여할 권한 목록 <span className="text-red-500">*</span>
                </label>
                <div className="space-y-1.5 bg-gray-50 dark:bg-gray-900/30 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  {ALL_DISCIPLINE_RIGHTS.map((r) => {
                    const checked = selectedRights.includes(r);
                    return (
                      <label key={r} className="flex items-center space-x-2 text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRights([...selectedRights, r]);
                            } else {
                              setSelectedRights(selectedRights.filter((x) => x !== r));
                            }
                          }}
                          className="rounded text-blue-600"
                        />
                        <span>{rightLabels[r]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 만료일 */}
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  만료일 (선택 - 미지정 시 영구)
                </label>
                <input
                  type="date"
                  value={expiresAtDateStr}
                  onChange={(e) => setExpiresAtDateStr(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !selectedTeacherEmail || selectedRights.length === 0}
                  className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow disabled:opacity-50"
                >
                  {actionLoading ? "부여 중..." : "권한 부여"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
