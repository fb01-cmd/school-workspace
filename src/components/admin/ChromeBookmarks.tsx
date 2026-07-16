"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import BookmarkTreeEditor, { BookmarkItem } from "@/components/admin/BookmarkTreeEditor";



// ─── Bookmark Diff Helpers ────────────────────────────────────────────────────

interface FlatItem {
  path: string;      // "폴더 > 하위폴더 > 이름"
  name: string;
  url?: string;
  isFolder: boolean;
}

function flattenBookmarks(items: BookmarkItem[], prefix = ""): FlatItem[] {
  const result: FlatItem[] = [];
  for (const item of items) {
    const p = prefix ? `${prefix} › ${item.name}` : item.name;
    result.push({ path: p, name: item.name, url: item.url, isFolder: !!item.children });
    if (item.children) result.push(...flattenBookmarks(item.children, p));
  }
  return result;
}

function computeBookmarkDiff(before: BookmarkItem[], after: BookmarkItem[]) {
  const fb = flattenBookmarks(before);
  const fa = flattenBookmarks(after);

  const pathsBefore = new Set(fb.map(i => i.path));
  const pathsAfter  = new Set(fa.map(i => i.path));
  const keyOf = (i: FlatItem) => `${i.isFolder ? "F" : "L"}|${i.name}|${i.url ?? ""}`;
  const keysBefore = new Set(fb.map(keyOf));
  const keysAfter  = new Set(fa.map(keyOf));

  const added   = fa.filter(i => !pathsBefore.has(i.path) && !keysBefore.has(keyOf(i)));
  const removed = fb.filter(i => !pathsAfter.has(i.path)  && !keysAfter.has(keyOf(i)));
  const moved   = fa.filter(i => !pathsBefore.has(i.path) && keysBefore.has(keyOf(i)));

  // Detect reordering: same item set but different sequence
  const orderedBefore = fb.map(i => i.path).join("|");
  const orderedAfter  = fa.map(i => i.path).join("|");
  const isReordered = added.length === 0 && removed.length === 0 && moved.length === 0 
                      && orderedBefore !== orderedAfter;

  return { added, removed, moved, isReordered,
           countBefore: fb.length, countAfter: fa.length };
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

export default function ChromeBookmarks() {

  const { userData, schoolSettings, orgUnits } = useAuth();
  const domain = userData?.domain || "";
  const isSuperAdmin = userData?.role === "super_admin";

  const [activeTab, setActiveTab] = useState<"edit" | "logs">("edit");
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
          크롬 브라우저 최상단 북마크바(Managed Bookmarks)를 조직단위별로 일괄 배포 및 제어합니다.
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
            스코프가 API 콘솔에 등록되지 않았거나 승인되지 않아 <strong>[로컬 DB 백업 모드]</strong>로 자동 전환하여 구동 중입니다.
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
                {orgUnits.length === 0 ? (
                  <p className="text-xs text-gray-400">조직 정보 로드 중...</p>
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
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white p-5">
              <div className="flex items-center gap-2 mb-4 border-b pb-3">
                <span className="text-base">📁</span>
                <h3 className="text-sm font-bold text-gray-800">{toplevelName} 북마크 목록</h3>
                {loadingConfig && (
                  <span className="text-xs text-gray-400 ml-auto">구글 크롬 정책 불러오는 중...</span>
                )}
              </div>

              {loadingConfig ? (
                <div className="py-16 text-center text-xs text-gray-400">
                  <div className="animate-spin text-2xl mb-3">⏳</div>
                  구글 크롬 정책 정보 조회 중...
                </div>
              ) : (
                <div className="max-h-[520px] overflow-y-auto">
                  <BookmarkTreeEditor
                    items={bookmarks}
                    onChange={setBookmarks}
                  />
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
                <li>배포를 적용하면, 해당 조직단위(OU)에 소속된 모든 계정이 로그인된 크롬 브라우저 상단에 북마크바 폴더가 <strong>강제로 생성</strong>되며 사용자가 삭제할 수 없습니다.</li>
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
              {logs.map((log) => {
                const before = log.beforeConfig?.bookmarks || [];
                const after  = log.afterConfig?.bookmarks  || [];
                const { added, removed, moved, isReordered, countBefore, countAfter } = computeBookmarkDiff(before, after);
                const hasChanges = added.length > 0 || removed.length > 0 || moved.length > 0 || isReordered;
                const totalAfter = countAfter;
                return (
                  <div key={log.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 text-xs shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-100 text-indigo-800">북마크 변경</span>
                        <strong className="text-sm text-gray-900">{log.orgUnitPath}</strong>
                      </div>
                      <span className="text-gray-400 font-mono text-[10px]">{log.timestamp}</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 items-center">
                      {added.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold text-[11px]">
                          ➕ {added.length}개 추가
                        </span>
                      )}
                      {removed.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold text-[11px]">
                          ➖ {removed.length}개 삭제
                        </span>
                      )}
                      {moved.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-[11px]">
                          ↕️ {moved.length}개 위치 변경
                        </span>
                      )}
                      {isReordered && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-[11px]">
                          🔄 순서 변경
                        </span>
                      )}
                      {!hasChanges && (
                        <span className="text-gray-400 italic text-[11px]">
                          변경 없음 (재배포) &mdash; before {countBefore}개 / after {countAfter}개
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-gray-400">전체 {totalAfter}개 항목</span>
                    </div>

                    {hasChanges && (
                      <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 space-y-1 max-h-44 overflow-y-auto">
                        {added.slice(0, 15).map((item, i) => (
                          <div key={`a${i}`} className="flex items-start gap-1.5 text-green-700">
                            <span className="flex-shrink-0">➕</span>
                            <span>
                              {item.isFolder ? "📁" : "🔗"} <span className="font-semibold">{item.name}</span>
                              {!item.isFolder && item.url && <span className="text-green-500 text-[10px] ml-1 font-mono"> {item.url}</span>}
                              {item.path.includes(" › ") && (
                                <span className="text-gray-400 text-[10px] ml-1">← {item.path.split(" › ").slice(0, -1).join(" › ")}</span>
                              )}
                            </span>
                          </div>
                        ))}
                        {removed.slice(0, 10).map((item, i) => (
                          <div key={`r${i}`} className="flex items-start gap-1.5 text-red-500">
                            <span className="flex-shrink-0">➖</span>
                            <span className="line-through opacity-70">
                              {item.isFolder ? "📁" : "🔗"} <span className="font-semibold">{item.name}</span>
                              {!item.isFolder && item.url && <span className="text-[10px] ml-1 font-mono"> {item.url}</span>}
                            </span>
                          </div>
                        ))}
                        {moved.slice(0, 10).map((item, i) => (
                          <div key={`m${i}`} className="flex items-start gap-1.5 text-amber-600">
                            <span className="flex-shrink-0">↕️</span>
                            <span>
                              {item.isFolder ? "📁" : "🔗"} <span className="font-semibold">{item.name}</span>
                              <span className="text-gray-400 text-[10px] ml-1">→ {item.path.includes(" › ") ? item.path.split(" › ").slice(0, -1).join(" › ") : "루트"}</span>
                            </span>
                          </div>
                        ))}
                        {(added.length + removed.length + moved.length) > 15 && (
                          <p className="text-gray-400 text-[10px] pt-1 border-t">외 {(added.length + removed.length + moved.length) - 15}개 변경...</p>
                        )}
                      </div>
                    )}

                    <div className="text-gray-500 text-[10px] text-right">
                      수정 작업: <span className="font-bold text-gray-800">{log.operatorName}</span> ({log.operatorEmail})
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
