"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { TimetableSettings, TimetableTerm } from "@/lib/timetable/types";
import TimetableImportTab from "./TimetableImportTab";

export default function TimetableSection() {
  const { userData } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";

  const [settings, setSettings] = useState<TimetableSettings | null>(null);
  const [terms, setTerms] = useState<TimetableTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"view" | "class" | "free" | "import">("import");

  const fetchSettingsAndTerms = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      if (!forceRefresh) {
        const cached = getClientCache("timetable:settings");
        if (cached) {
          setSettings(cached.settings);
          setTerms(cached.terms);
          setLoading(false);
          return;
        }
      }

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      });

      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || null);
        setTerms(data.terms || []);
        setClientCache("timetable:settings", { settings: data.settings, terms: data.terms });
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "시간표 정보를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndTerms();
  }, []);

  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4"></div>
        <p className="text-sm font-semibold text-gray-600">시간표 데이터 및 설정을 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-900">
        <h3 className="text-base font-bold mb-1">시간표 로드 오류</h3>
        <p className="text-xs opacity-80 mb-4">{error}</p>
        <button
          onClick={() => fetchSettingsAndTerms(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 4종 네비게이션 탭 (phase9a_spec.md §5 명시) */}
      <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-200 flex flex-wrap gap-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab("view")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "view"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🗓️ 내/교사 시간표</span>
        </button>

        <button
          onClick={() => setActiveTab("class")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "class"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🏫 학급별 시간표</span>
        </button>

        <button
          onClick={() => setActiveTab("free")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "free"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>☕ 공강 교사 조회</span>
        </button>

        {isManager && (
          <button
            onClick={() => setActiveTab("import")}
            className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ml-auto ${
              activeTab === "import"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <span>⚙️ 가져오기 & 학기 관리</span>
          </button>
        )}
      </div>

      {/* 탭 액티브 뷰 */}
      {activeTab === "import" && isManager && (
        <TimetableImportTab
          settings={settings}
          terms={terms}
          onRefreshData={() => fetchSettingsAndTerms(true)}
        />
      )}

      {activeTab === "view" && (
        <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">🗓️ 시간표 열람 (준비 중)</h3>
          <p className="text-xs text-gray-500">
            Phase 9a-1 구현 순서 4번(열람 화면 3종)에서 구현될 예정입니다.
          </p>
        </div>
      )}

      {activeTab === "class" && (
        <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">🏫 학급별 시간표 (준비 중)</h3>
          <p className="text-xs text-gray-500">
            Phase 9a-1 구현 순서 4번(열람 화면 3종)에서 구현될 예정입니다.
          </p>
        </div>
      )}

      {activeTab === "free" && (
        <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
          <h3 className="text-base font-bold text-gray-900 mb-1">☕ 공강 교사 조회 (준비 중)</h3>
          <p className="text-xs text-gray-500">
            Phase 9a-1 구현 순서 4번(열람 화면 3종)에서 구현될 예정입니다.
          </p>
        </div>
      )}
    </div>
  );
}
