"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClientCache } from "@/lib/cache/clientCache";
import OUTreeSelector from "@/components/admin/OUTreeSelector";

interface BookmarkItem {
  name: string;
  url?: string;
  children?: BookmarkItem[];
}

interface SyncLog {
  id: string;
  operatorEmail: string;
  operatorName: string;
  orgUnitPath: string;
  beforeConfig: { toplevel_name: string; bookmarks: BookmarkItem[] };
  afterConfig: { toplevel_name: string; bookmarks: BookmarkItem[] };
  timestamp: string;
}

interface OU {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
}

export default function ChromeBookmarks() {
  const { userData, schoolSettings } = useAuth();
  const domain = userData?.domain || "";
  const isSuperAdmin = userData?.role === "super_admin";

  const [activeTab, setActiveTab] = useState<"edit" | "logs">("edit");
  const [orgUnits, setOrgUnits] = useState<OU[]>([]);
  const [loadingOUs, setLoadingOUs] = useState(false);
  const [selectedOU, setSelectedOU] = useState("");
  
  // Bookmark Config States
  const toplevelName = "효명고등학교";
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [isLocalFallback, setIsLocalFallback] = useState(false);
  const [authWarning, setAuthWarning] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // A. Load OUs
  const loadOUs = async () => {
    setLoadingOUs(true);
    try {
      const cached = getClientCache("ou:all") as OU[];
      if (cached && cached.length > 0) {
        setOrgUnits(cached);
        return;
      }
      const res = await fetch("/api/workspace/ou");
      const data = await res.json();
      if (res.ok) {
        setOrgUnits(data.orgUnits || []);
      }
    } catch (err) {
      console.error("Failed to load OUs:", err);
    } finally {
      setLoadingOUs(false);
    }
  };

  useEffect(() => {
    loadOUs();
  }, []);

  // B. Compute Allowed OUs for dropdown - show ONLY OUs explicitly listed in allowedBookmarkOUs (exact match)
  // The cascade inheritance (parent allows children) is enforced on the backend for security,
  // but the dropdown should only show what the admin explicitly allowed.
  const filteredOUs = orgUnits.filter((ou) => {
    const allowedList: string[] = schoolSettings?.allowedBookmarkOUs || ["/교직원", "/학생"];
    const cleanTarget = ou.orgUnitPath.trim().toLowerCase();
    return allowedList.some((allowed: string) => cleanTarget === allowed.trim().toLowerCase());
  });

  // Set default selected OU
  useEffect(() => {
    if (filteredOUs.length > 0 && !selectedOU) {
      setSelectedOU(filteredOUs[0].orgUnitPath);
    }
  }, [filteredOUs, selectedOU]);

  // C. Load Current Bookmarks Configuration when selected OU changes
  const loadBookmarkConfig = async (ouPath: string) => {
    if (!ouPath) return;
    setLoadingConfig(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/workspace/bookmarks?action=get&orgUnitPath=${encodeURIComponent(ouPath)}`);
      const data = await res.json();
      if (res.ok) {
        // toplevelName is fixed as "효명고등학교" - no longer user-configurable
        setBookmarks(data.bookmarks || []);
        setIsLocalFallback(!!data.isLocalFallback);
        setAuthWarning(data.authWarning || "");
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(`북마크 조회 실패: ${err.message}`);
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    if (selectedOU && activeTab === "edit") {
      loadBookmarkConfig(selectedOU);
    }
  }, [selectedOU, activeTab]);

  // D. Load History Logs
  const loadHistoryLogs = async () => {
    setLoadingLogs(true);
    setError("");
    try {
      const res = await fetch("/api/workspace/bookmarks?action=logs");
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(`로그 로드 실패: ${err.message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (activeTab === "logs") {
      loadHistoryLogs();
    }
  }, [activeTab]);

  // E. Add Bookmark / Folder
  const addBookmarkNode = (parentList: BookmarkItem[], isFolder: boolean) => {
    const name = prompt(isFolder ? "새 폴더 이름을 입력하세요:" : "북마크 사이트 이름을 입력하세요:");
    if (!name || !name.trim()) return;

    let url = "";
    if (!isFolder) {
      url = prompt("북마크 URL 주소를 입력하세요 (http:// 또는 https:// 포함):", "https://") || "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        alert("올바른 프로토콜 형식이 아닙니다. http:// 또는 https://로 시작되어야 합니다.");
        return;
      }
    }

    const newNode: BookmarkItem = isFolder
      ? { name: name.trim(), children: [] }
      : { name: name.trim(), url: url.trim() };

    setBookmarks((prev) => [...prev, newNode]);
  };

  const removeBookmarkNode = (index: number) => {
    if (confirm("이 북마크(또는 폴더)를 제외하시겠습니까?")) {
      setBookmarks((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // F. Push Update to API
  const handleSaveConfig = async () => {
    if (!selectedOU) return;
    setSavingConfig(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/workspace/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          orgUnitPath: selectedOU,
          toplevel_name: toplevelName.trim(),
          bookmarks
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`[${selectedOU}] 조직단위 크롬 관리 북마크 설정이 반영되었습니다.${data.isLocalFallback ? " (구글 API 연동 불가로 로컬 DB 임시 저장)" : ""}`);
        setIsLocalFallback(!!data.isLocalFallback);
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(`배정 실패: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">구글 크롬 브라우저 관리 북마크 배정</h2>
        <p className="text-gray-500 text-xs mt-1">
          교사가 직접 학생들 크롬 브라우저의 최상단 북마크바(Managed Bookmarks)를 일괄 배포 및 제어합니다.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => setActiveTab("edit")}
            className={`pb-3 px-1 border-b-2 font-bold text-sm transition-all ${
              activeTab === "edit"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            📂 북마크 트리 편집 및 배포
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`pb-3 px-1 border-b-2 font-bold text-sm transition-all ${
              activeTab === "logs"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            📋 북마크 변경 히스토리 감사로그
          </button>
        </nav>
      </div>

      {isLocalFallback && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-4 text-xs font-semibold space-y-1">
          <p className="flex items-center gap-1.5 text-amber-800 font-bold text-sm">
            <span>⚠️</span>
            <span>구글 Workspace 크롬 정책 API 권한(DWD) 미활성 안내</span>
          </p>
          <p className="leading-relaxed">
            현재 구글 Workspace 최고관리자의 도메인 위임 권한 중 
            <span className="font-mono bg-amber-100 px-1 py-0.5 rounded text-[10px] mx-1">https://www.googleapis.com/auth/chrome.management.policy</span> 
            스코프가 API 콘솔에 등록되지 않았거나 승인되지 않아 **[로컬 DB 백업 모드]**로 자동 전환하여 구동 중입니다.
          </p>
          <p className="text-[10px] text-amber-600 font-medium">
            (북마크 편집 정보는 플랫폼 데이터베이스와 수정 이력에 정상 보관되나, 실제 학생 기기 크롬 브라우저 상단바에 즉시 배포되지는 않습니다. 도메인 위임이 활성화되면 실시간 동기화가 재개됩니다.)
          </p>
          {authWarning && (
            <p className="text-[10px] font-mono text-amber-500 mt-1.5 border-t border-amber-200/50 pt-1">
              API 반환 상세 오류: {authWarning}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-4 text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-md p-4 text-sm font-medium">
          ✅ {success}
        </div>
      )}

      {/* TAB 1: EDIT & SAVE */}
      {activeTab === "edit" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left panel: Bookmarks edit */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">수정할 배포 조직단위(OU) 선택</label>
                {loadingOUs ? (
                  <p className="text-xs text-gray-400">조직도 로드 중...</p>
                ) : (
                  <div className="max-w-md">
                    <OUTreeSelector
                      orgUnits={filteredOUs}
                      value={selectedOU}
                      onChange={(path) => setSelectedOU(path)}
                      placeholder="배포할 대상 조직단위를 선택하세요"
                    />
                  </div>
                )}
              </div>

              {/* toplevel_name is fixed as "효명고등학교" across all OUs - not user-editable */}
            </div>

            {/* Bookmarks Tree Container */}
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white p-6 space-y-4">
              <div className="flex justify-between items-center border-b pb-3">
                <h3 className="text-sm font-bold text-gray-800">
                  📁 {toplevelName || "크롬 북마크바"} 하위 항목 목록
                </h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => addBookmarkNode(bookmarks, false)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-3 py-1.5 rounded transition-all shadow-sm"
                  >
                    🔗 북마크 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => addBookmarkNode(bookmarks, true)}
                    className="bg-slate-700 hover:bg-slate-800 text-white font-semibold text-xs px-3 py-1.5 rounded transition-all shadow-sm"
                  >
                    📁 폴더 추가
                  </button>
                </div>
              </div>

              {loadingConfig ? (
                <div className="py-20 text-center text-xs text-gray-400">
                  구글 크롬 정책 정보 조회 중...
                </div>
              ) : bookmarks.length === 0 ? (
                <div className="py-20 text-center text-xs text-gray-400">
                  <p className="text-2xl mb-2">📌</p>
                  <p>설정된 북마크가 없습니다. [북마크 추가]를 눌러 링크를 채워주세요.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                  {bookmarks.map((node, index) => {
                    const isFolder = node.children !== undefined;
                    return (
                      <div
                        key={index}
                        className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border border-gray-150 rounded-lg text-xs hover:bg-gray-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-base">{isFolder ? "📁" : "🔗"}</span>
                          <div className="space-y-0.5">
                            <p className="font-bold text-gray-800">{node.name}</p>
                            {!isFolder && <p className="text-[10px] text-gray-400 font-mono">{node.url}</p>}
                            {isFolder && (
                              <p className="text-[10px] text-indigo-600 font-semibold">
                                폴더 (하위 노드 지원은 향후 순차 추가 가능)
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBookmarkNode(index)}
                          className="text-red-500 hover:text-red-700 font-bold px-1.5"
                          title="삭제"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action Trigger */}
            <button
              onClick={handleSaveConfig}
              disabled={savingConfig || !selectedOU || loadingConfig}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold py-3.5 px-4 rounded-lg shadow-sm transition-all flex items-center justify-center gap-2"
            >
              {savingConfig ? "크롬 브라우저 정책 배포 적용 중..." : `🚀 [${selectedOU}] 조직단위 크롬 북마크 실시간 배포 실행`}
            </button>
          </div>

          {/* Right panel: Tips & Warnings */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wide">💡 크롬 북마크 배포 가이드</h4>
              <ul className="list-disc pl-4 space-y-2 text-xs text-indigo-900 leading-relaxed">
                <li>배포를 적용하면, 해당 조직단위(OU)에 소속된 모든 학생/교사 계정이 로그인된 크롬 브라우저 상단에 북마크바 폴더가 **강제로 생성**되며 사용자가 삭제할 수 없습니다.</li>
                <li>적용 완료 후 반영까지 크롬 브라우저 수명 주기에 따라 최대 1~5분가량 소요될 수 있으며, 브라우저 주소창에 <span className="font-mono bg-indigo-150 px-1 py-0.5 rounded text-[10px]">chrome://policy</span>를 입력하여 [정책 새로고침]을 누르면 즉시 동기화됩니다.</li>
                <li>안전한 협업을 위해 모든 북마크 수정 이력은 백엔드 감사 로그에 실시간 기록되며, 수정 로그 열람실에서 즉시 조회가 가능합니다.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AUDIT LOGS */}
      {activeTab === "logs" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-800">최근 실행한 크롬 북마크 수정 이력 (최대 50건)</h3>
            <button onClick={loadHistoryLogs} className="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
          </div>

          {loadingLogs ? (
            <div className="text-center py-12 text-gray-400 text-xs">불러오는 중...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-xs">최근 변경된 크롬 북마크 이력이 존재하지 않습니다.</div>
          ) : (
            <div className="space-y-4 pr-1 max-h-[600px] overflow-y-auto">
              {logs.map((log) => (
                <div key={log.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-100 text-indigo-800">
                        북마크 변경
                      </span>
                      <strong className="text-sm text-gray-900">{log.orgUnitPath}</strong>
                    </div>
                    <span className="text-gray-400 font-mono text-[10px]">{log.timestamp}</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="font-semibold text-gray-500 block mb-1">수정 전 설정:</span>
                      <div className="bg-white border rounded p-2.5 font-mono text-[11px] text-gray-600 max-h-24 overflow-y-auto">
                        <p className="font-bold text-gray-800 mb-1">📂 {log.beforeConfig?.toplevel_name || "(없음)"}</p>
                        {Array.isArray(log.beforeConfig?.bookmarks) && log.beforeConfig.bookmarks.length > 0 ? (
                          log.beforeConfig.bookmarks.map((b, i) => (
                            <div key={i} className="truncate">
                              {b.children ? `📁 ${b.name}` : `🔗 ${b.name} (${b.url})`}
                            </div>
                          ))
                        ) : (
                          <p className="text-gray-400 italic">설정 없음</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="font-semibold text-gray-500 block mb-1 text-indigo-700">수정 후 설정:</span>
                      <div className="bg-indigo-50/20 border border-indigo-100 rounded p-2.5 font-mono text-[11px] text-gray-700 max-h-24 overflow-y-auto">
                        <p className="font-bold text-indigo-900 mb-1">📂 {log.afterConfig?.toplevel_name}</p>
                        {Array.isArray(log.afterConfig?.bookmarks) && log.afterConfig.bookmarks.map((b, i) => (
                          <div key={i} className="truncate">
                            {b.children ? `📁 ${b.name}` : `🔗 ${b.name} (${b.url})`}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="text-gray-500 text-[10px] text-right font-medium">
                    수정 작업 교사: <span className="text-gray-800 font-bold">{log.operatorName}</span> ({log.operatorEmail})
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
