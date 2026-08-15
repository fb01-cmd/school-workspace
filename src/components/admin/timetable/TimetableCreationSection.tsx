"use client";

import { useState, useEffect } from "react";
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
import HoursPlanTab from "./HoursPlanTab";
import CurriculumCohortTab from "./CurriculumCohortTab";

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
    | "hours_plan"
    | "cohort"
    | "import"
    | "simul"
    | "venue"
    | "slot_ban"
    | "consecutive"
    | "coteaching"
    | "draft"
    | "revision"
    | "neis_batch_export"
  >("hours_plan");

  // 편집 대상 학기 상태 (term_transition_spec §2: 기본값 = 활성 학기)
  const [workingTermId, setWorkingTermId] = useState<string>("");
  const [inheriting, setInheriting] = useState(false);
  const [inheritMessage, setInheritMessage] = useState<string | null>(null);

  // terms나 activeTermId 로드 시 초기 workingTermId 설정
  useEffect(() => {
    if (!workingTermId && terms && terms.length > 0) {
      const active = activeTermId || terms.find((t) => t.status === "active")?.id;
      setWorkingTermId(active || terms[0].id);
    }
  }, [terms, activeTermId, workingTermId]);

  // 편집 대상 학기 객체
  const selectableTerms = terms.filter((t) => t.status !== "archived");
  const workingTerm =
    terms.find((t) => t.id === workingTermId) ||
    terms.find((t) => t.status === "active") ||
    terms[0];
  const activeTerm = terms.find((t) => t.id === activeTermId || t.status === "active");

  const isWorkingDraft = workingTerm?.status === "draft";
  const effectiveTermId = workingTerm?.id || activeTermId || "";

  // 등록부 승계 복사 실행 (spec §3)
  const handleInheritRegistries = async () => {
    if (!activeTerm || !workingTerm) return;
    if (activeTerm.id === workingTerm.id) {
      alert("현재 운영 중인 학기로는 가져올 수 없습니다.");
      return;
    }

    const confirmMsg = `현재 운영 중인 학기(${activeTerm.name || activeTerm.id})의 등록부 내용(이동수업, 특별실, 특별교사 금지, 연속수업, 복수교사, 고정시간)을 ${workingTerm.name || workingTerm.id} 초안으로 가져오시겠습니까?\n\n※ 대상 초안 학기에 기존 등록부가 1건이라도 있으면 안전을 위해 중단됩니다.`;
    if (!confirm(confirmMsg)) return;

    setInheriting(true);
    setInheritMessage(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "registry_inherit",
          fromTermId: activeTerm.id,
          toTermId: workingTerm.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const c = data.inheritedCounts || {};
        const total =
          (c.simulGroups || 0) +
          (c.venueGroups || 0) +
          (c.slotBans || 0) +
          (c.consecutiveRules || 0) +
          (c.coTeachingRules || 0) +
          (c.fixedBlocks || 0);
        setInheritMessage(
          `이동수업 ${c.simulGroups || 0}건, 특별실 ${c.venueGroups || 0}건, 특별교사 금지 ${c.slotBans || 0}건, 연속수업 ${c.consecutiveRules || 0}건, 복수교사 ${c.coTeachingRules || 0}건 (총 ${total}건)을 성공적으로 가져왔습니다.`
        );
        setTimeout(() => setInheritMessage(null), 6000);
        refreshSettings();
      } else {
        alert(data.error || "등록부 가져오기에 실패했습니다.");
      }
    } catch (err: any) {
      alert(`가져오기 오류: ${err.message || String(err)}`);
    } finally {
      setInheriting(false);
    }
  };

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
      {/* ── 학기 축 선택기 바 (term_transition_spec §2) ── */}
      <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-700">📌 작업 대상 학기:</span>
          <select
            value={effectiveTermId}
            onChange={(e) => setWorkingTermId(e.target.value)}
            className="px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg font-bold text-gray-900 text-xs focus:ring-2 focus:ring-indigo-500"
          >
            {selectableTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || t.id} {t.status === "active" ? "★ 현재 운영 중" : "(초안)"}
              </option>
            ))}
          </select>
        </div>

        {/* 초안 학기 승계 복사 버튼 (spec §3) */}
        {isWorkingDraft && activeTerm && activeTerm.id !== workingTerm?.id && (
          <button
            type="button"
            onClick={handleInheritRegistries}
            disabled={inheriting}
            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg border border-indigo-200 transition-colors flex items-center gap-1"
          >
            <span>📥 {inheriting ? "가져오는 중..." : `운영 학기(${activeTerm.name || activeTerm.id}) 등록 내용 가져오기`}</span>
          </button>
        )}
      </div>

      {/* 승계 성공 알림 */}
      {inheritMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-900 text-xs font-medium flex items-center justify-between">
          <span>✅ {inheritMessage}</span>
          <button onClick={() => setInheritMessage(null)} className="text-emerald-700 font-bold">✕</button>
        </div>
      )}

      {/* ── 비활성 초안 학기 편집 고정 배너 (term_transition_spec §2, 코호트 제외) ── */}
      {isWorkingDraft && activeTab !== "cohort" && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-blue-900 font-medium shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-base">ℹ️</span>
            <span>
              <strong>{workingTerm?.name || workingTermId} 초안</strong>을 편집하고 있습니다. 현재 운영 중인 시간표에는 영향이 없습니다.
            </span>
          </div>
          <span className="px-2 py-0.5 bg-blue-200/70 text-blue-800 rounded font-bold text-[11px]">
            초안 작업 중
          </span>
        </div>
      )}

      {/* 작성 네비게이션 탭 */}
      <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-200 flex flex-wrap gap-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab("hours_plan")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "hours_plan"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📋 선생님별 주당 수업 시간</span>
        </button>

        <button
          onClick={() => setActiveTab("cohort")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "cohort"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>⏱️ 교육과정 고정 시간</span>
        </button>

        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "import"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>⚙️ 학기 & 권한 관리</span>
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

      {/* 탭 뷰 (workingTermId 전달) */}
      {activeTab === "hours_plan" && (
        <HoursPlanTab activeTermId={effectiveTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "cohort" && (
        <CurriculumCohortTab periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "import" && (
        <TimetableImportTab
          settings={settings}
          terms={terms}
          onRefreshData={refreshSettings}
        />
      )}

      {activeTab === "simul" && <SimulGroupTab activeTermId={effectiveTermId} />}

      {activeTab === "venue" && <VenueGroupTab activeTermId={effectiveTermId} />}

      {activeTab === "slot_ban" && (
        <TeacherSlotBanTab activeTermId={effectiveTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "consecutive" && (
        <ConsecutiveRuleTab activeTermId={effectiveTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "coteaching" && (
        <CoTeachingRuleTab activeTermId={effectiveTermId} periodsPerDay={periodsPerDay} />
      )}

      {activeTab === "draft" && (
        <DraftAutoTab
          activeTermId={effectiveTermId}
          periodsPerDay={periodsPerDay}
          isDraftTerm={isWorkingDraft}
        />
      )}

      {activeTab === "revision" && <BaseRevisionTab activeTermId={effectiveTermId} />}

      {activeTab === "neis_batch_export" && (
        <NeisBatchExportTab activeTermId={effectiveTermId} />
      )}
    </div>
  );
}
