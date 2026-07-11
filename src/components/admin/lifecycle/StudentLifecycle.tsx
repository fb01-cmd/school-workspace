"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { doc, getDoc } from "firebase/firestore";

import OUTab from "./OUTab";
import { GroupDeleteTab, GroupCreateTab } from "./GroupTabs";
import PromoteTab from "./PromoteTab";
import EnrollTab from "./EnrollTab";
import TransferInTab from "./TransferInTab";
import GraduationTab from "./GraduationTab";

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────
type NewYearStep = "ou" | "groups_delete" | "promote" | "enroll" | "groups_create";
type MidYearTabId = "transfer_in" | "transfer_out" | "graduate";
type SectionId = "new_year" | "mid_year";

interface Settings {
  domain: string;
  ouMapping?: { students?: Record<string, string> };
}

// 신학기 준비 단계 순서 (앞 단계 완료 없이 뒤 단계 진입 불가)
const NEW_YEAR_STEPS: {
  id: NewYearStep;
  icon: string;
  label: string;
  desc: string;
}[] = [
  { id: "ou", icon: "🔄", label: "OU 전환", desc: "3학년→졸업생, 2→3, 1→2, 새 1학년 생성" },
  { id: "groups_delete", icon: "🗑️", label: "그룹 초기화", desc: "기존 반별 그룹 전체 삭제" },
  { id: "promote", icon: "📈", label: "진급 처리", desc: "CSV 업로드 → 학번 일괄 업데이트" },
  { id: "enroll", icon: "🎓", label: "신입생 입학", desc: "신입생 계정 일괄 생성" },
  { id: "groups_create", icon: "👥", label: "그룹 재생성", desc: "학번 기준 반별 그룹 재생성" },
];

const MID_YEAR_TABS: { id: MidYearTabId; icon: string; label: string }[] = [
  { id: "transfer_in", icon: "➕", label: "전입 처리" },
  { id: "transfer_out", icon: "🚪", label: "전출·학업중단" },
  { id: "graduate", icon: "🏫", label: "졸업생 처리" },
];

// ─────────────────────────────────────────────────────
// TransferOut Placeholder
// ─────────────────────────────────────────────────────
function TransferOutPlaceholder() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold">🚪 전출·학업중단 관리</h3>
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-10 text-center text-gray-400">
        <div className="text-4xl mb-3">🚧</div>
        <p className="font-semibold">개발 예정</p>
        <p className="text-sm mt-1">전출/학업중단 등록 → 안내 메일 → 계정 정지 → 삭제 3단계 워크플로우</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Section Selector Button
// ─────────────────────────────────────────────────────
function SectionBtn({ active, onClick, icon, title, desc }: {
  active: boolean; onClick: () => void; icon: string; title: string; desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
        active ? "border-indigo-600 bg-indigo-50" : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50"
      }`}
    >
      <span className="text-2xl">{icon}</span>
      <div>
        <p className={`text-sm font-bold ${active ? "text-indigo-700" : "text-gray-700"}`}>{title}</p>
        <p className={`text-xs mt-0.5 ${active ? "text-indigo-500" : "text-gray-400"}`}>{desc}</p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// New Year Step Progress Bar
// ─────────────────────────────────────────────────────
type StepState = "completed" | "active" | "locked";

function NewYearStepBar({
  steps,
  completed,
  activeStep,
  onSelect,
}: {
  steps: typeof NEW_YEAR_STEPS;
  completed: Set<NewYearStep>;
  activeStep: NewYearStep;
  onSelect: (id: NewYearStep) => void;
}) {
  return (
    <div className="flex items-stretch gap-0">
      {steps.map((step, idx) => {
        const isCompleted = completed.has(step.id);
        const isCurrent = activeStep === step.id;

        const baseClasses = "flex-1 relative flex flex-col items-center gap-1 px-2 py-3 transition-all text-center border-b-2";
        const stateClasses =
          isCompleted
            ? "border-green-500 bg-green-50 cursor-pointer hover:bg-green-100"
            : isCurrent
            ? "border-indigo-600 bg-indigo-50 cursor-pointer font-bold text-indigo-700"
            : "border-gray-200 bg-white cursor-pointer hover:bg-gray-50 text-gray-500";

        return (
          <button
            key={step.id}
            onClick={() => onSelect(step.id)}
            className={`${baseClasses} ${stateClasses}`}
            title={step.desc}
          >
            {/* Step number badge */}
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-0.5 ${
                isCompleted
                  ? "bg-green-500 text-white"
                  : isCurrent
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-400 border border-gray-200"
              }`}
            >
              {isCompleted ? "✓" : idx + 1}
            </div>
            <span className="text-lg">{step.icon}</span>
            <span className={`text-xs font-semibold leading-tight ${
              isCompleted ? "text-green-700" :
              isCurrent ? "text-indigo-700" : "text-gray-600"
            }`}>
              {step.label}
            </span>
            {isCompleted && (
              <span className="text-[10px] text-green-600 bg-green-100/50 px-1 py-0.2 rounded font-semibold mt-0.5">완료</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Mid Year Tab Button
// ─────────────────────────────────────────────────────
function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: string; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
        active ? "bg-indigo-700 text-white shadow" : "bg-white border border-gray-200 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────
export default function StudentLifecycle() {
  const { userData } = useAuth();
  const [section, setSection] = useState<SectionId>("new_year");
  const [activeStep, setActiveStep] = useState<NewYearStep>("ou");
  const [completedSteps, setCompletedSteps] = useState<Set<NewYearStep>>(new Set());
  const [midYearTab, setMidYearTab] = useState<MidYearTabId>("transfer_in");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  // Load wizard state from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedStep = localStorage.getItem("academic_lifecycle_active_step") as NewYearStep;
      const savedCompleted = localStorage.getItem("academic_lifecycle_completed_steps");
      
      if (savedStep) {
        setActiveStep(savedStep);
      }
      if (savedCompleted) {
        try {
          const parsed = JSON.parse(savedCompleted) as NewYearStep[];
          setCompletedSteps(new Set(parsed));
        } catch (e) {
          console.warn("Failed to parse saved completed steps", e);
        }
      }
    }
  }, []);

  // Save wizard state to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("academic_lifecycle_active_step", activeStep);
    }
  }, [activeStep]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "academic_lifecycle_completed_steps",
        JSON.stringify(Array.from(completedSteps))
      );
    }
  }, [completedSteps]);

  useEffect(() => {
    if (!userData?.domain) return;
    getDoc(doc(db, "settings", userData.domain))
      .then((snap) =>
        setSettings({ domain: userData.domain, ...(snap.exists() ? snap.data() : {}) } as Settings)
      )
      .finally(() => setLoading(false));
  }, [userData?.domain]);

  // Reset the lifecycle wizard state
  const resetWizardState = () => {
    if (confirm("⚠️ 신학기 준비 진행 단계를 초기화하고 1단계(OU 전환)부터 다시 시작하시겠습니까?\n(이미 구글 워크스페이스에 생성되거나 변경된 조직 및 사용자 계정 자체는 삭제되지 않으며, 화면 상의 진행 단계만 초기화됩니다.)")) {
      setActiveStep("ou");
      setCompletedSteps(new Set());
      if (typeof window !== "undefined") {
        localStorage.removeItem("academic_lifecycle_active_step");
        localStorage.removeItem("academic_lifecycle_completed_steps");
      }
    }
  };

  // 탭 전환 시 자동으로 다음 단계로 이동하는 콜백
  const markDone = (step: NewYearStep) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(step);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const studentOUPaths = settings?.ouMapping?.students || {};
  const allStudentOUs: string[] = Object.values(studentOUPaths);
  const allDone = completedSteps.size === NEW_YEAR_STEPS.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-700 to-indigo-800 rounded-xl text-white p-6 shadow-lg">
        <h2 className="text-xl font-bold mb-1">📚 학적 관리</h2>
        <p className="text-violet-200 text-sm">
          신입생 입학 · 진급 · 전입/전출 · 졸업 — 학생 계정 생애주기 전체 관리
        </p>
      </div>

      {/* Section Selector */}
      <div className="flex gap-3">
        <SectionBtn
          active={section === "new_year"}
          onClick={() => setSection("new_year")}
          icon="🗓️"
          title="신학기 준비"
          desc="학년 말~새학기: OU 전환 → 진급 → 신입생"
        />
        <SectionBtn
          active={section === "mid_year"}
          onClick={() => setSection("mid_year")}
          icon="📝"
          title="학기 중 학적 변동"
          desc="전입 처리 · 전출·학업중단 · 졸업생 관리"
        />
      </div>

      {/* ── 신학기 준비 ── */}
      {section === "new_year" && (
        <>
          {/* 진행 상황 바 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <p className="text-xs font-bold text-gray-600">📋 신학기 준비 단계 — 순서대로 진행해 주세요</p>
              <div className="flex items-center gap-3">
                {allDone && (
                  <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                    🎉 전체 완료!
                  </span>
                )}
                {completedSteps.size > 0 && !allDone && (
                  <span className="text-xs text-indigo-600 font-semibold">
                    {completedSteps.size} / {NEW_YEAR_STEPS.length} 단계 완료
                  </span>
                )}
                <button
                  onClick={resetWizardState}
                  className="text-xs text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-1 rounded transition-colors font-medium flex items-center gap-1"
                  title="신학기 준비 마법사 단계를 1단계(초기 상태)로 되돌립니다."
                >
                  🔄 단계 초기화
                </button>
              </div>
            </div>
            <NewYearStepBar
              steps={NEW_YEAR_STEPS}
              completed={completedSteps}
              activeStep={activeStep}
              onSelect={setActiveStep}
            />
          </div>

          {/* 잠금 안내 */}
          {(() => {
            const idx = NEW_YEAR_STEPS.findIndex((s) => s.id === activeStep);
            const prevStep = idx > 0 ? NEW_YEAR_STEPS[idx - 1] : null;
            const hasUnfinishedPrev = prevStep && !completedSteps.has(prevStep.id);
            if (!hasUnfinishedPrev) return null;
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 flex items-start gap-2.5 shadow-xs">
                <span>⚠️</span>
                <div>
                  <p className="font-bold">이전 단계 미완료 안내</p>
                  <p className="mt-0.5 leading-relaxed">
                    이전 단계(<strong>{prevStep!.label}</strong>)가 완료 처리되지 않은 상태입니다.
                    이미 Google Workspace Admin 콘솔 등에서 해당 작업을 직접 진행하셨다면 이 단계를 계속 진행하셔도 무방합니다.
                  </p>
                </div>
              </div>
            );
          })()}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            {activeStep === "ou" && (
              <OUTab s={settings} ud={userData} onDone={() => markDone("ou")} onNext={() => setActiveStep("groups_delete")} />
            )}
            {activeStep === "groups_delete" && (
              <GroupDeleteTab ud={userData} ouPaths={studentOUPaths} onDone={() => markDone("groups_delete")} onNext={() => setActiveStep("promote")} />
            )}
            {activeStep === "promote" && (
              <PromoteTab s={settings} ud={userData} ouList={allStudentOUs} onDone={() => markDone("promote")} onNext={() => setActiveStep("enroll")} />
            )}
            {activeStep === "enroll" && (
              <EnrollTab s={settings} ud={userData} onDone={() => markDone("enroll")} onNext={() => setActiveStep("groups_create")} />
            )}
            {activeStep === "groups_create" && (
              <GroupCreateTab
                ud={userData}
                ouPaths={studentOUPaths}
                onDone={() => markDone("groups_create")}
                onComplete={() => {
                  alert("🎉 신학기 준비 모든 단계가 성공적으로 완료되었습니다!\n이제 '학기 중 학적 변동' 탭에서 상시 업무(전입/전출 등)를 관리하실 수 있습니다.");
                  setSection("mid_year");
                }}
              />
            )}
          </div>
        </>
      )}

      {/* ── 학기 중 학적 변동 ── */}
      {section === "mid_year" && (
        <>
          <div className="flex gap-1 flex-wrap">
            {MID_YEAR_TABS.map((tab) => (
              <TabBtn
                key={tab.id}
                active={midYearTab === tab.id}
                onClick={() => setMidYearTab(tab.id)}
                icon={tab.icon}
                label={tab.label}
              />
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            {midYearTab === "transfer_in" && (
              <TransferInTab s={settings} ud={userData} ouList={allStudentOUs} ouPaths={studentOUPaths} />
            )}
            {midYearTab === "transfer_out" && <TransferOutPlaceholder />}
            {midYearTab === "graduate" && <GraduationTab s={settings} ud={userData} />}
          </div>
        </>
      )}
    </div>
  );
}