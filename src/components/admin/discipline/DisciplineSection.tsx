import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { DisciplineConfig, DisciplineGrant } from "@/lib/discipline/types";
import { getClientCache, setClientCache, invalidateClientCache } from "@/lib/cache/clientCache";
import DisciplineRecordTab from "./DisciplineRecordTab";
import DisciplineStatusTab from "./DisciplineStatusTab";
import DisciplineVoidedTab from "./DisciplineVoidedTab";
import DisciplineStageEventsTab from "./DisciplineStageEventsTab";
import DisciplineConfigTab from "./DisciplineConfigTab";
import DisciplinePermissionsTab from "./DisciplinePermissionsTab";
import HomeroomAssignmentTab from "./HomeroomAssignmentTab";

interface UserPermissions {
  canView: boolean;
  canRecord: boolean;
  canResolve: boolean;
  canManageRules: boolean;
  canManagePermissions: boolean;
  isHomeroom: boolean;
  homeroomClasses?: Array<{ grade: number; classNum: number }>;
  myGrants: DisciplineGrant[];
}

export default function DisciplineSection() {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [config, setConfig] = useState<DisciplineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabInitialized, setTabInitialized] = useState(false);

  const [activeTab, setActiveTab] = useState<
    "record" | "status" | "voided" | "stage_events" | "config" | "permissions" | "homeroom"
  >("record");

  const canSeeResolveTab = (perm: UserPermissions, cfg?: DisciplineConfig | null) =>
    perm.canResolve || (perm.isHomeroom && Boolean((cfg?.stages || []).some((s) => s.homeroomResolvable === true)));

  const setInitialTabIfNeeded = (permData: UserPermissions, cfg?: DisciplineConfig | null) => {
    if (tabInitialized) return;
    if (permData.canRecord) setActiveTab("record");
    else if (permData.canView) setActiveTab("status");
    else if (canSeeResolveTab(permData, cfg)) setActiveTab("stage_events");
    else if (permData.canManageRules) setActiveTab("config");
    else if (permData.canManagePermissions) setActiveTab("permissions");
    setTabInitialized(true);
  };

  const fetchData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);

    // forceRefresh가 없으면 인메모리 클라이언트 캐시 우선 사용
    if (!forceRefresh) {
      const cached = getClientCache("discipline:my");
      if (cached) {
        setPermissions(cached);
        if (cached.config) {
          setConfig(cached.config);
        }
        setInitialTabIfNeeded(cached, cached.config);
        setLoading(false);
        return;
      }
    } else {
      invalidateClientCache("discipline:my");
    }

    try {
      // 내 권한 + 규정 통합 조회 (my 응답에 config 동봉 — 왕복 1회로 마운트)
      const permRes = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my" }),
      });

      const permData = await permRes.json();
      if (!permRes.ok) {
        throw new Error(permData.error || "생활지도 권한 조회를 실패했습니다.");
      }

      setClientCache("discipline:my", permData);
      setPermissions(permData);
      if (permData.config) {
        setConfig(permData.config);
      }

      setInitialTabIfNeeded(permData, permData.config);
    } catch (err: any) {
      setError(err.message || "데이터 로딩 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="py-20 text-center text-gray-500 dark:text-gray-400">
        <svg className="animate-spin h-8 w-8 mx-auto mb-4 text-blue-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        생활지도 모듈 권한 및 규정 정보를 가져오는 중...
      </div>
    );
  }

  if (error || !permissions) {
    return (
      <div className="p-8 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl border border-red-200 dark:border-red-800 text-center">
        {error || "생활지도 권한 정보를 읽어올 수 없습니다."}
      </div>
    );
  }

  const showResolveTab = canSeeResolveTab(permissions, config);

  const hasAnyAccess =
    permissions.canView ||
    permissions.canRecord ||
    showResolveTab ||
    permissions.canManageRules ||
    permissions.canManagePermissions;

  if (!hasAnyAccess) {
    return (
      <div className="p-12 text-center bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
        <div className="text-4xl">🔒</div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">생활지도 메뉴 접근 권한이 없습니다</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          담임 교사이시거나 관리자로부터 생활지도 권한을 부여받아야 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 탭 네비게이션 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {permissions.canRecord && (
          <button
            onClick={() => setActiveTab("record")}
            className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
              activeTab === "record"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            <span>📝 기록 입력</span>
          </button>
        )}

        {permissions.canView && (
          <>
            <button
              onClick={() => setActiveTab("status")}
              className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                activeTab === "status"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              <span>📊 지도 현황</span>
            </button>

            <button
              onClick={() => setActiveTab("voided")}
              className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                activeTab === "voided"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              <span>🗑️ 무효화 보관함</span>
            </button>
          </>
        )}

        {showResolveTab && (
          <button
            onClick={() => setActiveTab("stage_events")}
            className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
              activeTab === "stage_events"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            <span>📥 조치 처리함</span>
          </button>
        )}

        {permissions.canManageRules && (
          <button
            onClick={() => setActiveTab("config")}
            className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
              activeTab === "config"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            <span>⚙️ 규정 편집기</span>
          </button>
        )}

        {permissions.canManagePermissions && (
          <>
            <button
              onClick={() => setActiveTab("permissions")}
              className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                activeTab === "permissions"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              <span>🔑 권한 관리</span>
            </button>

            <button
              onClick={() => setActiveTab("homeroom")}
              className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                activeTab === "homeroom"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              <span>🏫 담임 현황</span>
            </button>
          </>
        )}
      </div>

      {/* 탭 콘텐츠 렌더링 */}
      <div>
        {activeTab === "record" && permissions.canRecord && (
          <DisciplineRecordTab
            domain={domain}
            configItems={config?.items || []}
            permissions={permissions}
          />
        )}

        {activeTab === "status" && permissions.canView && config && (
          <DisciplineStatusTab
            config={config}
            canManageRules={permissions.canManageRules}
            homeroomClasses={permissions.homeroomClasses}
          />
        )}

        {activeTab === "voided" && permissions.canView && config && (
          <DisciplineVoidedTab config={config} />
        )}

        {activeTab === "stage_events" && showResolveTab && config && (
          <DisciplineStageEventsTab domain={domain} config={config} canResolve={permissions.canResolve} />
        )}

        {activeTab === "config" && permissions.canManageRules && config && (
          <DisciplineConfigTab initialConfig={config} onConfigUpdated={() => fetchData(true)} />
        )}

        {activeTab === "permissions" && permissions.canManagePermissions && (
          <DisciplinePermissionsTab domain={domain} onPermissionsUpdated={() => fetchData(true)} />
        )}

        {activeTab === "homeroom" && permissions.canManagePermissions && (
          <HomeroomAssignmentTab domain={domain} />
        )}
      </div>
    </div>
  );
}
