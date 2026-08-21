"use client";

import { useState, useEffect } from "react";
import { useTimetableSettings } from "./useTimetableSettings";
import WeekManageTab from "./WeekManageTab";
import SwapRequestLedgerTab from "./SwapRequestLedgerTab";
import DirectSubstituteTab from "./DirectSubstituteTab";
import ClassTimetableTab from "./ClassTimetableTab";
import NeisExportTab from "./NeisExportTab";
import HourTotalsTab from "./HourTotalsTab";
import CalendarManageTab from "./CalendarManageTab";

export default function TimetableOperationSection() {
  const {
    settings,
    loading,
    error,
    isManager,
    isObserver,
    periodsPerDay,
    activeTermId,
    refreshSettings,
  } = useTimetableSettings();

  const [activeTab, setActiveTab] = useState<
    | "weeks"
    | "calendar"
    | "ledger"
    | "direct"
    | "class"
    | "neis_export"
    | "hours"
  >("weeks");

  useEffect(() => {
    const handleNav = (e: any) => {
      if (e.detail?.opTab) {
        setActiveTab(e.detail.opTab);
      }
    };
    window.addEventListener("admin_navigate", handleNav);
    return () => window.removeEventListener("admin_navigate", handleNav);
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4"></div>
        <p className="text-sm font-semibold text-gray-600">시간표 운영 데이터를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-900">
        <h3 className="text-base font-bold mb-1">시간표 로드 오류</h3>
        <p className="text-xs opacity-80 mb-4">{error}</p>
        <button
          onClick={refreshSettings}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // 열람 전용 참관자는 수업교환 신청 요청대장(읽기 전용)만 접근 가능
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
        <h3 className="text-base font-bold">🔒 시간표 운영 접근 제한</h3>
        <p className="text-xs text-amber-800">
          시간표 운영 기능은 일과계 담당 교직원 및 관리자만 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 운영 네비게이션 탭 */}
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

        {/*
          「☕ 공강 교사」·「👤 교사별 시간표」 탭을 2026-08-21에 걷었다 (사용자 판단).
          둘 다 더 나은 화면이 이미 있었다 —
            공강 교사   → 직권 배정에서 결강 수업을 누르면 그 시간 빈 교사가 **보강 누계까지** 함께 나온다.
                          이 탭에는 누계가 없어 "누가 이미 많이 했는지" 모른 채 고르게 된다.
                          「결강과 무관하게 이 시간에 누가 비나」는 수요는 없다고 사용자가 확인(2026-08-21).
            교사별 시간표 → 교사 포털 「🔍 다른 시간표 조회」가 상위 집합이다(주 선택 + 요일별 날짜).
                          이쪽 사본에는 그 둘이 없어 **이번 주를 보여주면서 학기 고정 시간표처럼 읽혔다.**
          같은 것을 두 번 그리면서 한쪽만 못한 상태였다.
        */}
        <button
          onClick={() => setActiveTab("class")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "class"
              ? "bg-gray-800 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🏫 학급별 시간표</span>
        </button>

        <button
          onClick={() => setActiveTab("neis_export")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "neis_export"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📑 나이스 입력 목록</span>
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
      </div>

      {/* 탭 뷰 */}
      {activeTab === "weeks" && (
        <WeekManageTab
          activeTermId={activeTermId}
          periodsPerDay={periodsPerDay}
          publishWeeksAhead={settings?.publishWeeksAhead ?? 2}
          onSettingsChange={refreshSettings}
        />
      )}

      {activeTab === "calendar" && <CalendarManageTab activeTermId={activeTermId} />}

      {activeTab === "ledger" && <SwapRequestLedgerTab activeTermId={activeTermId} />}

      {activeTab === "direct" && <DirectSubstituteTab activeTermId={activeTermId} />}

      {activeTab === "class" && <ClassTimetableTab periodsPerDay={periodsPerDay} activeTermId={activeTermId} />}

      {activeTab === "neis_export" && <NeisExportTab activeTermId={activeTermId} />}

      {activeTab === "hours" && <HourTotalsTab activeTermId={activeTermId} />}
    </div>
  );
}
