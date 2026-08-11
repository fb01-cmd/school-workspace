"use client";

import { useState } from "react";
import { useTimetableSettings } from "./useTimetableSettings";
import TimetableImportTab from "./TimetableImportTab";
import SimulGroupTab from "./SimulGroupTab";
import VenueGroupTab from "./VenueGroupTab";
import TeacherSlotBanTab from "./TeacherSlotBanTab";
import ConsecutiveRuleTab from "./ConsecutiveRuleTab";
import CoTeachingRuleTab from "./CoTeachingRuleTab";
import DraftAutoTab from "./DraftAutoTab";
import BaseRevisionTab from "./BaseRevisionTab";
import NeisBatchExportTab from "./NeisBatchExportTab";

export default function TimetableCreationSection() {
  const {
    settings,
    terms,
    loading,
    error,
    isManager,
    periodsPerDay,
    activeTermId,
    refreshSettings,
  } = useTimetableSettings();

  const [activeTab, setActiveTab] = useState<
    | "import"
    | "simul"
    | "venue"
    | "slot_ban"
    | "consecutive"
    | "coteaching"
    | "draft"
    | "revision"
    | "neis_batch_export"
  >("draft");

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4"></div>
        <p className="text-sm font-semibold text-gray-600">시간표 작성 데이터를 불러오는 중입니다...</p>
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

  if (!isManager) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900 space-y-2">
        <h3 className="text-base font-bold">🔒 시간표 작성 접근 제한</h3>
        <p className="text-xs text-amber-800">
          시간표 작성 및 학기 관리 기능은 일과계 담당 교직원 및 수퍼어드민만 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 작성 네비게이션 탭 */}
      <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-200 flex flex-wrap gap-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "import"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>⚙️ 가져오기 & 학기 관리</span>
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
          onClick={() => setActiveTab("slot_ban")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "slot_ban"
              ? "bg-rose-700 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🚫 특별교사 금지</span>
        </button>

        <button
          onClick={() => setActiveTab("consecutive")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "consecutive"
              ? "bg-sky-700 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🔁 연속수업</span>
        </button>

        <button
          onClick={() => setActiveTab("coteaching")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "coteaching"
              ? "bg-purple-700 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>👥 복수교사</span>
        </button>

        <button
          onClick={() => setActiveTab("draft")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "draft"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🧩 자동 작성</span>
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
          onClick={() => setActiveTab("neis_batch_export")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "neis_batch_export"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📤 나이스 일괄 내보내기</span>
        </button>
      </div>

      {/* 탭 뷰 */}
      {activeTab === "import" && (
        <TimetableImportTab
          settings={settings}
          terms={terms}
          onRefreshData={refreshSettings}
        />
      )}

      {activeTab === "simul" && <SimulGroupTab activeTermId={activeTermId} />}

      {activeTab === "venue" && <VenueGroupTab activeTermId={activeTermId} />}

      {activeTab === "slot_ban" && (
        <TeacherSlotBanTab activeTermId={activeTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "consecutive" && (
        <ConsecutiveRuleTab activeTermId={activeTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "coteaching" && (
        <CoTeachingRuleTab activeTermId={activeTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "draft" && (
        <DraftAutoTab activeTermId={activeTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "revision" && <BaseRevisionTab activeTermId={activeTermId} />}

      {activeTab === "neis_batch_export" && (
        <NeisBatchExportTab activeTermId={activeTermId} />
      )}
    </div>
  );
}
