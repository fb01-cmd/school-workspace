import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { DisciplineConfig, DisciplineGrant } from "@/lib/discipline/types";
import DisciplineRecordTab from "./DisciplineRecordTab";
import DisciplineStatusTab from "./DisciplineStatusTab";
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
  myGrants: DisciplineGrant[];
}

export default function DisciplineSection() {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  const [config, setConfig] = useState<DisciplineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<
    "record" | "status" | "stage_events" | "config" | "permissions" | "homeroom"
  >("record");

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 내 권한 조회
      const permRes = await fetch("/api/discipline/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my" }),
      });

      const permData = await permRes.json();
      if (!permRes.ok) {
        throw new Error(permData.error || "생활지도 권한 조회를 실패했습니다.");
      }

      setPermissions(permData);

      // 2. 규정 데이터 조회
      const configRes = await fetch("/api/discipline/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get" }),
      });

      const configData = await configRes.json();
      if (configRes.ok && configData.config) {
        setConfig(configData.config);
      }

      // 첫 탭 자동 선택
      if (permData.canRecord) setActiveTab("record");
      else if (permData.canView) setActiveTab("status");
      else if (permData.canResolve) setActiveTab("stage_events");
      else if (permData.canManageRules) setActiveTab("config");
      else if (permData.canManagePermissions) setActiveTab("permissions");
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

  const hasAnyAccess =
    permissions.canView ||
    permissions.canRecord ||
    permissions.canResolve ||
    permissions.canManageRules ||
    permissions.canManagePermissions;

  if (!hasAnyAccess) {
    return (
      <div className="p-12 text-center bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
        <div className="text-4xl">🔒</div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">생활지도 메뉴 접근 권한이 없습니다</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          담임 교사이시거나 관리자로부터 생활지도 권한(Grant)을 부여받아야 접근할 수 있습니다.
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
        )}

        {permissions.canResolve && (
          <button
            onClick={() => setActiveTab("stage_events")}
            className={`pb-3 px-5 font-bold text-sm border-b-2 whitespace-nowrap transition-all flex items-center space-x-1.5 ${
              activeTab === "stage_events"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            <span>📥 단계 처리함</span>
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
              <span>🏫 담임 배정표</span>
            </button>
          </>
        )}
      </div>

      {/* 탭 콘텐츠 렌더링 */}
      <div>
        {activeTab === "record" && permissions.canRecord && (
          <DisciplineRecordTab domain={domain} configItems={config?.items || []} />
        )}

        {activeTab === "status" && permissions.canView && config && (
          <DisciplineStatusTab config={config} />
        )}

        {activeTab === "stage_events" && permissions.canResolve && config && (
          <DisciplineStageEventsTab domain={domain} config={config} />
        )}

        {activeTab === "config" && permissions.canManageRules && config && (
          <DisciplineConfigTab initialConfig={config} onConfigUpdated={fetchData} />
        )}

        {activeTab === "permissions" && permissions.canManagePermissions && (
          <DisciplinePermissionsTab domain={domain} />
        )}

        {activeTab === "homeroom" && permissions.canManagePermissions && (
          <HomeroomAssignmentTab domain={domain} />
        )}
      </div>
    </div>
  );
}
