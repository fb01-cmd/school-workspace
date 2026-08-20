"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface RosterApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  createdBy: string;
}

export default function RosterApiKeyManager() {
  const { userData } = useAuth();
  const [keys, setKeys] = useState<RosterApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [issuedKey, setIssuedKey] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Master Sheet States (6a-2)
  const [masterSheetIdInput, setMasterSheetIdInput] = useState("");
  const [savingSheetId, setSavingSheetId] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [sheetSyncResult, setSheetSyncResult] = useState<{
    success: boolean;
    totalStudentsCount?: number;
    updatedGrades?: number[];
    error?: string;
    isScopeError?: boolean;
    isMock?: boolean;
  } | null>(null);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspace/roster-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      } else {
        const data = await res.json();
        console.error(`API 키 목록 조회 실패: ${data.error}`);
      }
    } catch (err: any) {
      console.error("API 키 목록 조회 오류:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSheetSettings = async () => {
    try {
      const res = await fetch("/api/workspace/roster-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      });
      if (res.ok) {
        const data = await res.json();
        setMasterSheetIdInput(data.masterSheetId || "");
      }
    } catch (err: any) {
      console.error("마스터 시트 설정 조회 실패:", err.message);
    }
  };

  useEffect(() => {
    fetchKeys();
    fetchSheetSettings();
  }, []);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      alert("연동 키 용도를 입력해 주세요. (예: 지필평가 현황판)");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/workspace/roster-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name: newKeyName.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setIssuedKey({ key: data.key, name: data.name });
        setNewKeyName("");
        fetchKeys();
      } else {
        alert(`연동 키 발급에 실패했습니다. (${data.error})`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`연동 키 발급 과정에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.`);
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string, keyName: string) => {
    if (
      !confirm(
        `정말로 연동 키 '${keyName}'을(를) 폐기하시겠습니까?\n\n이 키를 사용하는 외부 서비스·앱의 학생 명단 자동 공급이 즉시 차단됩니다.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch("/api/workspace/roster-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", keyId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert("연동 키가 성공적으로 폐기되었습니다.");
        fetchKeys();
      } else {
        alert(`연동 키 폐기 실패: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`연동 키 폐기 중 오류가 발생했습니다: ${err.message}`);
    }
  };

  const handleCopyKey = () => {
    if (!issuedKey) return;
    navigator.clipboard.writeText(issuedKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 6a-2: Master Sheet ID save handler
  const handleSaveSheetId = async () => {
    setSavingSheetId(true);
    try {
      const res = await fetch("/api/workspace/roster-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_sheet_id",
          masterSheetId: masterSheetIdInput.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMasterSheetIdInput(data.masterSheetId || "");
        alert("마스터 시트 ID가 성공적으로 저장되었습니다!");
      } else {
        alert(`시트 ID 저장 실패: ${data.error}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`시트 ID 저장 중 오류 발생: ${err.message}`);
    } finally {
      setSavingSheetId(false);
    }
  };

  // 6a-2: "지금 갱신" manual update handler
  const handleSyncSheetNow = async () => {
    setSyncingSheet(true);
    setSheetSyncResult(null);
    try {
      const res = await fetch("/api/workspace/roster-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_now" }),
      });

      const data = await res.json();
      const errMsg = data.error || "";
      const isScope =
        errMsg.includes("spreadsheets") ||
        errMsg.includes("OAuth 스코프") ||
        errMsg.includes("도메인 전체 위임") ||
        errMsg.includes("403");

      if (res.ok && data.success) {
        setSheetSyncResult({
          success: true,
          totalStudentsCount: data.totalStudentsCount,
          updatedGrades: data.updatedGrades,
          isMock: data.isMock,
        });
      } else {
        setSheetSyncResult({
          success: false,
          error: data.error || "갱신에 실패했습니다.",
          isScopeError: isScope,
        });
      }
    } catch (err: any) {
      console.error(err);
      setSheetSyncResult({
        success: false,
        error: `갱신 요청 통신 오류: ${err.message}`,
      });
    } finally {
      setSyncingSheet(false);
    }
  };

  const cleanSheetId = masterSheetIdInput.includes("/spreadsheets/d/")
    ? masterSheetIdInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || masterSheetIdInput.trim()
    : masterSheetIdInput.trim();

  const apiBaseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & API Usage Guide */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <span>🌐</span>
              <span>명단 자동 연동 관리</span>
            </h2>
            <p className="text-slate-500 text-xs mt-1">
              외부 서비스 및 스프레드시트에 최신 학생 명단을 공급합니다.
            </p>
          </div>
          <button
            onClick={() => {
              fetchKeys();
              fetchSheetSettings();
            }}
            disabled={loading}
            className="self-start sm:self-auto bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
          >
            🔄 전체 새로고침
          </button>
        </div>

        {/* Technical API Specification Collapsible Box */}
        <details className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-700 space-y-3">
          <summary className="font-bold text-slate-800 cursor-pointer hover:text-indigo-600 select-none">
            📡 연동 API 상세 규격 보기 (개발자용)
          </summary>
          <div className="pt-3 border-t border-slate-200/60 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <span className="font-semibold text-slate-500 block mb-1">연동 주소 (URL)</span>
                <code className="bg-white border border-slate-200 px-2 py-1 rounded font-mono text-indigo-600 block truncate">
                  {apiBaseUrl}/api/roster/feed
                </code>
              </div>
              <div>
                <span className="font-semibold text-slate-500 block mb-1">인증 방식 (요청 헤더에 연동 키 포함)</span>
                <code className="bg-white border border-slate-200 px-2 py-1 rounded font-mono text-emerald-600 block truncate">
                  Authorization: Bearer &lt;API키&gt;
                </code>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200">
              <span className="font-semibold text-slate-800 block mb-1">옵션 파라미터</span>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 text-[11px]">
                <li>
                  <code className="font-mono bg-white px-1 border rounded">?grade=1</code> — 특정 학년만 필터링 (예: 1학년 명단만)
                </li>
                <li>
                  <code className="font-mono bg-white px-1 border rounded">?format=csv</code> — 스프레드시트 직접 소비용 UTF-8 BOM CSV 출력
                </li>
                <li>
                  <code className="font-mono bg-white px-1 border rounded">?includeSuspended=true</code> — 정지 계정 포함 (기본값: false 미포함)
                </li>
              </ul>
            </div>
          </div>
        </details>
      </div>

      {/* 2. Master Spreadsheet Auto Sync Section */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>📊</span>
              <span>명렬표 마스터 시트 자동 갱신</span>
            </h3>
            <p className="text-slate-500 text-xs mt-1">
              구글 공유 드라이브의 스프레드시트에 매일 자정 학년별 탭(1~3학년)을 최신 명단으로 작성합니다.
            </p>
          </div>
          {cleanSheetId && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${cleanSheetId}`}
              target="_blank"
              rel="noreferrer"
              className="self-start sm:self-auto bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold px-3.5 py-2 rounded-md transition-colors flex items-center gap-1.5"
            >
              <span>🔗</span>
              <span>마스터 시트 열기</span>
            </a>
          )}
        </div>

        {/* Input & Action Bar */}
        <div className="space-y-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              마스터 스프레드시트 URL 또는 시트 ID
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={masterSheetIdInput}
                onChange={(e) => setMasterSheetIdInput(e.target.value)}
                placeholder="예: https://docs.google.com/spreadsheets/d/1BxiMVs0XRnt3B.../edit 또는 1BxiMVs0XRnt3B..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white font-mono"
              />
              <button
                type="button"
                onClick={handleSaveSheetId}
                disabled={savingSheetId}
                className="bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs px-4 py-2 rounded-md transition-colors disabled:opacity-50 shrink-0"
              >
                {savingSheetId ? "저장 중..." : "💾 시트 ID 저장"}
              </button>
              <button
                type="button"
                onClick={handleSyncSheetNow}
                disabled={syncingSheet}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
              >
                {syncingSheet ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>시트 갱신 중...</span>
                  </>
                ) : (
                  <>
                    <span>🔄</span>
                    <span>지금 갱신</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Sync Result & Friendly Error Alert Box */}
        {sheetSyncResult && (
          <div
            className={`p-4 rounded-lg border text-xs leading-relaxed ${
              sheetSyncResult.success
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            {sheetSyncResult.success ? (
              <div className="flex items-start gap-2">
                <span className="text-base">✅</span>
                <div>
                  <p className="font-bold">명렬표 마스터 시트 갱신 성공!</p>
                  <p className="mt-0.5 text-emerald-800">
                    총 {sheetSyncResult.totalStudentsCount}명의 학생 데이터를 {sheetSyncResult.updatedGrades?.join(", ")}학년 탭에 성공적으로 작성하였습니다.
                    {sheetSyncResult.isMock && " (테스트 모드)"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 font-bold text-rose-950">
                  <span className="text-base">⚠️</span>
                  <span>마스터 시트 갱신 에러</span>
                </div>
                <p className="text-rose-800">{sheetSyncResult.error}</p>

                {/* Friendly OAuth / Scope Registration Guide Banner if scope error occurs */}
                {sheetSyncResult.isScopeError && (
                  <div className="mt-3 bg-amber-50 border border-amber-300 rounded-md p-3.5 text-amber-950 text-xs space-y-1.5">
                    <p className="font-bold">💡 관리자 사전 설정 안내 (최초 1회)</p>
                    <p className="text-amber-900 leading-normal">
                      학교 관리 서비스가 공유 드라이브 스프레드시트에 자동 접근·쓰기를 하려면 아래 2가지 구글 권한 설정이 필요합니다:
                    </p>
                    <ol className="list-decimal pl-5 space-y-1 mt-1 font-medium text-amber-900">
                      <li>
                        <strong>Google Workspace 관리자 콘솔 (admin.google.com)</strong>: [보안] &gt; [API 제어] &gt; [도메인 전체 위임]에 
                        <code className="bg-white px-1.5 py-0.5 rounded border border-amber-300 font-mono text-[11px] text-amber-950 ml-1">https://www.googleapis.com/auth/spreadsheets</code> 접근 권한 추가
                      </li>
                      <li>
                        <strong>Google Cloud 콘솔 (console.cloud.google.com)</strong>: [API 및 서비스] &gt; [라이브러리]에서 
                        <strong>Google Sheets API</strong>를 <strong>[사용(ENABLE)]</strong> 상태로 활성화
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. New API Key Issuance Form */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
          <span>➕</span>
          <span>새 명단 연동 키 발급</span>
        </h3>
        <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              사용 용도 (앱/서비스 라벨)
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="예: 지필평가 현황판 시트, 교육과정 선택 웹앱, 생활지도 연동"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
          >
            {creating ? "발급 처리 중..." : "🔑 연동 키 발급하기"}
          </button>
        </form>
      </div>

      {/* 4. Single-time Plaintext Key Display Modal/Banner */}
      {issuedKey && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 shadow-lg space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
              <span className="text-xl">⚠️</span>
              <span>연동 키가 발급되었습니다 ({issuedKey.name})</span>
            </div>
            <button
              onClick={() => setIssuedKey(null)}
              className="text-amber-700 hover:text-amber-950 text-xs font-bold px-2 py-1 rounded hover:bg-amber-100 transition-colors"
            >
              닫기 ✕
            </button>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            보안을 위해 <strong>발급된 연동 키는 지금 단 1회만 표시</strong>되며, 시스템에는 암호화된 형태로만 저장됩니다. 이 창을 닫으면 키를 다시 확인할 수 없으니 <strong>지금 즉시 복사하여 외부 서비스 설정에 안전하게 보관</strong>해 주세요.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <div className="flex-1 bg-white border border-amber-300 rounded-lg p-2.5 font-mono text-xs text-slate-900 font-bold select-all break-all shadow-inner">
              {issuedKey.key}
            </div>
            <button
              onClick={handleCopyKey}
              className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 ${
                copied
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white"
              }`}
            >
              {copied ? "✅ 복사 완료!" : "📋 연동 키 복사하기"}
            </button>
          </div>
        </div>
      )}

      {/* 5. Issued API Keys Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">
            발급된 명단 연동 키 목록 ({keys.length}개)
          </h3>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            연동 키 목록을 불러오는 중입니다...
          </div>
        ) : keys.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            발급된 명단 연동 키가 없습니다. 위 입력란에서 새 연동 키를 발급해 주세요.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-700">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-800 font-bold">
                <tr>
                  <th className="px-4 py-3">용도 (라벨)</th>
                  <th className="px-4 py-3">키 앞자리</th>
                  <th className="px-4 py-3">발급 일시</th>
                  <th className="px-4 py-3">최근 사용 시각</th>
                  <th className="px-4 py-3 text-center">상태</th>
                  <th className="px-4 py-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {keys.map((k) => (
                  <tr
                    key={k.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      k.revoked ? "bg-slate-50/70 text-slate-400" : "text-slate-800"
                    }`}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {k.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {k.keyPrefix}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {k.createdAt ? new Date(k.createdAt).toLocaleString("ko-KR") : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("ko-KR") : "미사용"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {k.revoked ? (
                        <span className="inline-flex px-2 py-0.5 text-xs font-bold rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                          폐기됨
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          활성
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!k.revoked ? (
                        <button
                          onClick={() => handleRevokeKey(k.id, k.name)}
                          className="bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-[11px] font-bold px-2.5 py-1 rounded transition-colors"
                        >
                          사용 중단
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 select-none">사용 중단됨</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
