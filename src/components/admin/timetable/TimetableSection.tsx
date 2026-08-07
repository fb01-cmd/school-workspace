"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { TimetableSettings, TimetableTerm } from "@/lib/timetable/types";
import TimetableImportTab from "./TimetableImportTab";
import TeacherTimetableTab from "./TeacherTimetableTab";
import ClassTimetableTab from "./ClassTimetableTab";
import FreeTeacherTab from "./FreeTeacherTab";
import WeekManageTab from "./WeekManageTab";
import SwapRequestLedgerTab from "./SwapRequestLedgerTab";
import DirectSubstituteTab from "./DirectSubstituteTab";
import NeisExportTab from "./NeisExportTab";
import HourTotalsTab from "./HourTotalsTab";
import SimulGroupTab from "./SimulGroupTab";
import VenueGroupTab from "./VenueGroupTab";
import CalendarManageTab from "./CalendarManageTab";
import BaseRevisionTab from "./BaseRevisionTab";

export default function TimetableSection() {
  const { userData } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";

  const [settings, setSettings] = useState<TimetableSettings | null>(null);
  const [terms, setTerms] = useState<TimetableTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<
    "weeks" | "ledger" | "direct" | "simul" | "venue" | "calendar" | "revision" | "neis" | "hours" | "view" | "class" | "free" | "import"
  >("weeks");

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
  // 열람 전용 참관자 (교무부장 등): 요청대장 탭만 읽기 접근 (phase9b_spec §5)
  const isObserver =
    !isManager && (settings?.observerEmails || []).some((m) => m.toLowerCase() === userEmail);

  const periodsPerDay = settings?.periodsPerDay || 7;
  const activeTermId = settings?.activeTermId || null;

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

  // 참관자는 수업교환 신청 요청대장(읽기 전용)만 접근
  if (isObserver) {
    return (
      <div className="space-y-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-xs font-bold text-amber-900">
          👀 열람 전용 참관 계정입니다 — 수업교환 신청 요청대장을 읽기 전용으로 볼 수 있습니다.
        </div>
        <SwapRequestLedgerTab activeTermId={activeTermId} />
      </div>
    );
  }

  if (!isManager) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900 space-y-2">
        <h3 className="text-base font-bold">🔒 시간표 관리 접근 제한</h3>
        <p className="text-xs text-amber-800">
          시간표 기능은 일과계 담당 교직원 및 최고 관리자(super_admin)만 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 일과계 네비게이션 탭 (phase9b_spec.md §7 명시) */}
      <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-200 flex flex-wrap gap-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab("weeks")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "weeks"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🗓️ 주 운영 (휴업·단축)</span>
        </button>

        <button
          onClick={() => setActiveTab("ledger")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "ledger"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📋 수업교환 신청 요청대장</span>
        </button>

        <button
          onClick={() => setActiveTab("direct")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "direct"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>⚡ 직권 배정</span>
        </button>

        <button
          onClick={() => setActiveTab("simul")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "simul"
              ? "bg-purple-700 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🔀 이동수업 관리</span>
        </button>

        <button
          onClick={() => setActiveTab("venue")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "venue"
              ? "bg-emerald-700 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🏛️ 특별실 관리</span>
        </button>

        <button
          onClick={() => setActiveTab("calendar")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "calendar"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📅 학사일정</span>
        </button>

        <button
          onClick={() => setActiveTab("revision")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "revision"
              ? "bg-amber-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🛠️ 기초시간표 개정</span>
        </button>

        <button
          onClick={() => setActiveTab("neis")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "neis"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📑 NEIS 목록</span>
        </button>

        <button
          onClick={() => setActiveTab("hours")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "hours"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📊 시수 집계</span>
        </button>

        <div className="h-6 w-px bg-gray-200 my-auto mx-1"></div>

        <button
          onClick={() => setActiveTab("view")}
          className={`px-3 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "view"
              ? "bg-gray-800 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>👤 교사별 시간표</span>
        </button>

        <button
          onClick={() => setActiveTab("class")}
          className={`px-3 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "class"
              ? "bg-gray-800 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🏫 학급별 시간표</span>
        </button>

        <button
          onClick={() => setActiveTab("free")}
          className={`px-3 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "free"
              ? "bg-gray-800 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>☕ 공강 교사</span>
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
      {activeTab === "weeks" && <WeekManageTab activeTermId={activeTermId} periodsPerDay={periodsPerDay} />}

      {activeTab === "ledger" && <SwapRequestLedgerTab activeTermId={activeTermId} />}

      {activeTab === "direct" && <DirectSubstituteTab activeTermId={activeTermId} />}

      {activeTab === "simul" && <SimulGroupTab activeTermId={activeTermId} />}

      {activeTab === "venue" && <VenueGroupTab activeTermId={activeTermId} />}

      {activeTab === "calendar" && <CalendarManageTab activeTermId={activeTermId} />}

      {activeTab === "revision" && <BaseRevisionTab activeTermId={activeTermId} />}

      {activeTab === "neis" && <NeisExportTab activeTermId={activeTermId} />}

      {activeTab === "hours" && <HourTotalsTab activeTermId={activeTermId} />}

      {activeTab === "view" && <TeacherTimetableTab periodsPerDay={periodsPerDay} />}

      {activeTab === "class" && <ClassTimetableTab periodsPerDay={periodsPerDay} />}

      {activeTab === "free" && <FreeTeacherTab periodsPerDay={periodsPerDay} />}

      {activeTab === "import" && isManager && (
        <TimetableImportTab
          settings={settings}
          terms={terms}
          onRefreshData={() => fetchSettingsAndTerms(true)}
        />
      )}
    </div>
  );
}
