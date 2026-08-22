"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { CurriculumCohort, CohortFixedSlot, FixedSlotOverride } from "@/lib/timetable/types";
import {
  cohortForGrade,
  gradesForCohort,
  resolveFixedSlots,
  schoolYearOfDate,
} from "@/lib/timetable/cohort";

interface CurriculumCohortTabProps {
  periodsPerDay?: number;
}

export default function CurriculumCohortTab({ periodsPerDay = 7 }: CurriculumCohortTabProps) {
  const { userData } = useAuth();

  const [cohorts, setCohorts] = useState<CurriculumCohort[]>([]);
  const [overrides, setOverrides] = useState<FixedSlotOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 현재 기준 학년도 (3월 1일 KST 기준)
  const [currentSchoolYear, setCurrentSchoolYear] = useState<number>(() =>
    schoolYearOfDate(new Date())
  );

  // 교육과정 편집 모달/폼 상태
  const [editingCohortId, setEditingCohortId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState<string>("");
  const [formStartYear, setFormStartYear] = useState<number>(() => schoolYearOfDate(new Date()));
  const [formSlots, setFormSlots] = useState<CohortFixedSlot[]>([]);
  const [formActive, setFormActive] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState(false);

  // 학년도별 변경 편집 모달/폼 상태
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  const [overrideFormLabel, setOverrideFormLabel] = useState<string>("");
  const [overrideFormYear, setOverrideFormYear] = useState<number>(() => schoolYearOfDate(new Date()));
  // 격자를 손으로 고친 적이 있는가 — 없을 때만 학년도 변경 시 미리 채움을 다시 계산한다 (편집 유실 방지)
  const [overrideFormTouched, setOverrideFormTouched] = useState<boolean>(false);
  const [overrideFormSelectedGrades, setOverrideFormSelectedGrades] = useState<number[]>([1, 2, 3]);
  const [overrideFormGradeSlots, setOverrideFormGradeSlots] = useState<Record<number, CohortFixedSlot[]>>({});
  const [overrideFormActive, setOverrideFormActive] = useState<boolean>(true);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);

  // 교육과정 슬롯 이름 편집 상태
  const [slotNameModal, setSlotNameModal] = useState<{ day: number; period: number; name: string } | null>(null);

  // 학년도별 변경 슬롯 이름 편집 상태
  const [overrideSlotNameModal, setOverrideSlotNameModal] = useState<{
    grade: number;
    day: number;
    period: number;
    name: string;
  } | null>(null);

  const DAYS = [
    { day: 1, label: "월" },
    { day: 2, label: "화" },
    { day: 3, label: "수" },
    { day: 4, label: "목" },
    { day: 5, label: "금" },
  ];

  const maxPeriod = Math.max(7, periodsPerDay || 7);
  const PERIOD_LIST = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cohortRes, overrideRes] = await Promise.all([
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cohort_list" }),
        }),
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cohort_override_list" }),
        }),
      ]);

      const cohortData = await cohortRes.json();
      const overrideData = await overrideRes.json();

      if (cohortRes.ok) {
        setCohorts(cohortData.cohorts || []);
      } else {
        setError(cohortData.error || "교육과정 배치 목록을 불러오지 못했습니다.");
      }

      if (overrideRes.ok) {
        setOverrides(overrideData.overrides || []);
      } else {
        setError(overrideData.error || "학년도별 변경 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`로드 오류: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadCohorts = loadData;

  // ── 교육과정 조작 핸들러 ──
  const handleOpenNew = () => {
    setEditingCohortId(null);
    setFormLabel("");
    setFormStartYear(schoolYearOfDate(new Date()));
    setFormSlots([
      { day: 5, period: 5, displayName: "창체" },
      { day: 5, period: 6, displayName: "창체" },
    ]);
    setFormActive(true);
    setModalOpen(true);
  };

  const handleOpenEdit = (c: CurriculumCohort) => {
    setEditingCohortId(c.id);
    setFormLabel(c.label);
    setFormStartYear(c.startAdmissionYear);
    setFormSlots([...(c.fixedSlots || [])]);
    setFormActive(c.active);
    setModalOpen(true);
  };

  const handleToggleSlot = (day: number, period: number) => {
    const existing = formSlots.find((s) => s.day === day && s.period === period);
    if (existing) {
      setFormSlots(formSlots.filter((s) => !(s.day === day && s.period === period)));
    } else {
      setFormSlots([...formSlots, { day, period, displayName: "창체" }]);
      setSlotNameModal({ day, period, name: "창체" });
    }
  };

  const handleSaveSlotName = () => {
    if (!slotNameModal) return;
    const trimmed = slotNameModal.name.trim() || "창체";
    setFormSlots(
      formSlots.map((s) =>
        s.day === slotNameModal.day && s.period === slotNameModal.period
          ? { ...s, displayName: trimmed }
          : s
      )
    );
    setSlotNameModal(null);
  };

  const handleSaveCohort = async () => {
    if (!formLabel.trim()) {
      alert("교육과정 명칭을 입력해주세요 (예: 2022 개정 교육과정).");
      return;
    }
    if (isNaN(formStartYear) || formStartYear < 1900 || formStartYear > 2200) {
      alert("적용 시작 입학년도를 올바르게 입력해주세요 (예: 2025).");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Partial<CurriculumCohort> = {
        id: editingCohortId || undefined,
        label: formLabel.trim(),
        startAdmissionYear: formStartYear,
        fixedSlots: formSlots,
        active: formActive,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cohort_save",
          cohort: payload,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setModalOpen(false);
        setSuccessMessage("창체·SLAT 배치가 안전하게 저장되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);
        await loadData();
      } else {
        setError(data.error || "창체·SLAT 배치 저장에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`저장 오류: ${err.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCohort = async (cohortId: string, label: string) => {
    if (!confirm(`정말 '${label}' 배치를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cohort_delete",
          cohortId,
        }),
      });
      if (res.ok) {
        setSuccessMessage("창체·SLAT 배치가 삭제되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);
        await loadData();
      } else {
        const errData = await res.json();
        setError(errData.error || "삭제에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`삭제 오류: ${err.message || String(err)}`);
    }
  };

  // ── 학년도별 변경 조작 핸들러 ──
  const handleOpenNewOverride = () => {
    setEditingOverrideId(null);
    setOverrideFormLabel("");
    const targetYear = currentSchoolYear;
    setOverrideFormYear(targetYear);
    setOverrideFormSelectedGrades([1, 2, 3]);
    const initialSlotsMap: Record<number, CohortFixedSlot[]> = {};
    for (const g of [1, 2, 3]) {
      const resolved = resolveFixedSlots(cohorts, overrides, targetYear, g);
      initialSlotsMap[g] = resolved.slots.map((s) => ({ ...s }));
    }
    setOverrideFormGradeSlots(initialSlotsMap);
    setOverrideFormActive(true);
    setOverrideFormTouched(false);
    setOverrideModalOpen(true);
  };

  const handleOpenEditOverride = (o: FixedSlotOverride) => {
    setEditingOverrideId(o.id);
    setOverrideFormLabel(o.label);
    setOverrideFormYear(o.effectiveFromSchoolYear);
    const presentGrades = [1, 2, 3].filter((g) => o.gradeSlots?.[g]);
    setOverrideFormSelectedGrades(presentGrades.length > 0 ? presentGrades : [1, 2, 3]);
    const initialSlotsMap: Record<number, CohortFixedSlot[]> = {};
    for (const g of [1, 2, 3]) {
      if (o.gradeSlots?.[g]) {
        initialSlotsMap[g] = (o.gradeSlots[g].slots || []).map((s) => ({ ...s }));
      } else {
        const resolved = resolveFixedSlots(cohorts, overrides, o.effectiveFromSchoolYear, g);
        initialSlotsMap[g] = resolved.slots.map((s) => ({ ...s }));
      }
    }
    setOverrideFormGradeSlots(initialSlotsMap);
    setOverrideFormActive(o.active);
    setOverrideFormTouched(false);
    setOverrideModalOpen(true);
  };

  const handleToggleOverrideSlot = (grade: number, day: number, period: number) => {
    setOverrideFormTouched(true);
    const currentSlots = overrideFormGradeSlots[grade] || [];
    const existing = currentSlots.find((s) => s.day === day && s.period === period);
    if (existing) {
      setOverrideFormGradeSlots({
        ...overrideFormGradeSlots,
        [grade]: currentSlots.filter((s) => !(s.day === day && s.period === period)),
      });
    } else {
      setOverrideFormGradeSlots({
        ...overrideFormGradeSlots,
        [grade]: [...currentSlots, { day, period, displayName: "창체" }],
      });
      setOverrideSlotNameModal({ grade, day, period, name: "창체" });
    }
  };

  const handleSaveOverrideSlotName = () => {
    if (!overrideSlotNameModal) return;
    setOverrideFormTouched(true);
    const trimmed = overrideSlotNameModal.name.trim() || "창체";
    const grade = overrideSlotNameModal.grade;
    const currentSlots = overrideFormGradeSlots[grade] || [];
    setOverrideFormGradeSlots({
      ...overrideFormGradeSlots,
      [grade]: currentSlots.map((s) =>
        s.day === overrideSlotNameModal.day && s.period === overrideSlotNameModal.period
          ? { ...s, displayName: trimmed }
          : s
      ),
    });
    setOverrideSlotNameModal(null);
  };

  const handleSaveOverride = async () => {
    if (!overrideFormLabel.trim()) {
      alert("변경 명칭을 입력해주세요 (예: 2027학년도 창체 수요일 이동).");
      return;
    }
    if (isNaN(overrideFormYear) || overrideFormYear < currentSchoolYear || overrideFormYear > 2200) {
      alert(`적용 시작 학년도를 올바르게 입력해주세요 (${currentSchoolYear}학년도 이상, 2200 이하).`);
      return;
    }
    if (overrideFormSelectedGrades.length === 0) {
      alert("적어도 한 개 이상의 학년을 선택해주세요.");
      return;
    }

    const gradeSlotsPayload: Record<number, { basedOnCohortId: null; slots: CohortFixedSlot[] }> = {};
    for (const g of overrideFormSelectedGrades) {
      gradeSlotsPayload[g] = {
        basedOnCohortId: null,
        slots: overrideFormGradeSlots[g] || [],
      };
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Partial<FixedSlotOverride> = {
        id: editingOverrideId || undefined,
        label: overrideFormLabel.trim(),
        effectiveFromSchoolYear: overrideFormYear,
        gradeSlots: gradeSlotsPayload,
        active: overrideFormActive,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cohort_override_save",
          override: payload,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setOverrideModalOpen(false);
        setSuccessMessage("학년도별 변경이 안전하게 저장되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);
        await loadData();
      } else {
        setError(data.error || "학년도별 변경 저장에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`저장 오류: ${err.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOverride = async (overrideId: string, label: string) => {
    if (!confirm(`정말 '${label}' 변경 항목을 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cohort_override_delete",
          overrideId,
        }),
      });
      if (res.ok) {
        setSuccessMessage("학년도별 변경이 삭제되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);
        await loadData();
      } else {
        const errData = await res.json();
        setError(errData.error || "삭제에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`삭제 오류: ${err.message || String(err)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── 상단 바: 기준 학년도 선택 ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>⏱️ 학교 공통 시간</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            창체·SLAT이 들어갈 요일·교시를 지정합니다. 기본 배치는 교육과정(입학년도)별로 등록하고, 특정 학년도부터의 변경은 학년도별 변경으로 등록합니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">기준 학년도:</span>
            <input
              type="number"
              value={currentSchoolYear}
              onChange={(e) =>
                setCurrentSchoolYear(
                  parseInt(e.target.value, 10) || schoolYearOfDate(new Date())
                )
              }
              className="w-16 px-1.5 py-0.5 bg-white border border-gray-300 rounded font-mono font-bold text-center text-xs text-gray-900"
            />
            <span className="text-gray-500">학년도</span>
          </div>

          {/*
            여기 있던 「+ 교육과정 추가」를 걷었다 (2026-08-21 사용자 지적 —
            *"위의 +교육과정 추가랑 아래의 +교육과정 추가는 뭔 차이야?"*).
            차이가 없었다 — 둘 다 handleOpenNew를 부르는 **같은 버튼**이었다.
            아래 「교육과정별 기본 배치」 머리의 것만 남긴다. 만드는 대상 바로 옆이 제자리이고,
            짝인 「학년도별 변경」도 자기 구역 머리에 자기 버튼을 갖는 대칭이 된다.
          */}
        </div>
      </div>

      {/* ── 알림 배너 ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-medium">
          ⚠️ {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-800 font-medium">
          ✅ {successMessage}
        </div>
      )}

      {/* ── ⑴ 맨 위: 지금은 어떻게 되나 (해석 결과 보기) ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📊 지금은 어떻게 되나</span>
              <span className="text-xs font-normal text-gray-500">
                ({currentSchoolYear}학년도 최종 적용 결과)
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              교육과정 기본 배치와 학년도별 변경을 종합하여 {currentSchoolYear}학년도 각 학년에 실제로 적용되는 시간표입니다.
            </p>
          </div>
          <div className="text-xs text-gray-500 font-medium">
            기준 학년도 변경 시 실시간 반영
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((grade) => {
            const resolved = resolveFixedSlots(cohorts, overrides, currentSchoolYear, grade);
            // 이름을 그대로 이어 붙이면 「현행 교육과정 **교육과정에** 따름」처럼 겹친다
            // (2026-08-21 사용자 캡처에서 실제로 그렇게 나왔다). 이름은 「」로 감싸고
            // 종류는 앞에 붙여, 이름에 무슨 글자가 들어 있든 겹치지 않게 한다.
            const sourceLabel =
              resolved.source.kind === "override"
                ? `「${resolved.source.label}」 변경 적용`
                : resolved.source.kind === "cohort"
                ? `교육과정 「${resolved.source.label}」`
                : "등록된 고정 시간 없음";

            return (
              <div
                key={grade}
                className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1 border-b border-gray-200 pb-2">
                    <span className="text-sm font-bold text-gray-900">{grade}학년</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-bold truncate max-w-[180px] ${
                        resolved.source.kind === "override"
                          ? "bg-purple-100 text-purple-800 border border-purple-200"
                          : resolved.source.kind === "cohort"
                          ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                          : "bg-gray-100 text-gray-600 border border-gray-200"
                      }`}
                      title={sourceLabel}
                    >
                      {sourceLabel}
                    </span>
                  </div>

                  {/* 교육과정 불일치로 건너뛴 항목이 있는 경우 안내 */}
                  {resolved.skippedOverride && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-900 font-medium space-y-0.5">
                      <div className="flex items-center gap-1 font-bold text-amber-800">
                        <span>⚠️ 변경 미적용 안내</span>
                      </div>
                      <p>
                        「{resolved.skippedOverride.label}」은 {grade}학년에 적용되지 않았습니다 — 만들 당시와 지금의 {grade}학년 교육과정이 다릅니다.
                      </p>
                    </div>
                  )}

                  {/* 미니 격자 */}
                  <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
                    <table className="w-full text-center text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100/80 text-gray-600 font-bold border-b border-gray-200">
                          <th className="py-1 px-1 w-10 text-[11px]">교시</th>
                          {DAYS.map((d) => (
                            <th key={d.day} className="py-1 px-1 text-[11px]">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {PERIOD_LIST.map((p) => (
                          <tr key={p} className="hover:bg-gray-50/50">
                            <td className="py-1 px-1 bg-gray-50 font-bold text-gray-500 text-[11px]">
                              {p}교시
                            </td>
                            {DAYS.map((d) => {
                              const hit = resolved.slots.find(
                                (s) => s.day === d.day && s.period === p
                              );
                              return (
                                <td key={d.day} className="py-1 px-0.5">
                                  {hit ? (
                                    <span
                                      className={`px-1 py-0.5 rounded font-bold text-[11px] block truncate ${
                                        resolved.source.kind === "override"
                                          ? "bg-purple-100 text-purple-900"
                                          : "bg-indigo-100 text-indigo-900"
                                      }`}
                                    >
                                      {hit.displayName}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">·</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500 text-right">
                  고정 슬롯: <strong>{resolved.slots.length}</strong>개
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ⑵ 가운데: 교육과정별 기본 배치 ── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📚 교육과정별 기본 배치</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              입학생을 기준으로 3년간 적용되는 기본 창체·SLAT 배치입니다.
            </p>
          </div>
          <button
            onClick={handleOpenNew}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1 self-start sm:self-auto"
          >
            <span>+ 교육과정 추가</span>
          </button>
        </div>

        {/* 코호트 수정 진입부 안내문 */}
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 flex items-start gap-2">
          <span className="text-base leading-none">💡</span>
          <div className="space-y-0.5">
            <p className="font-bold text-amber-950">교육과정 배치 수정 시 주의사항</p>
            <p className="text-amber-800">
              자리를 옮기기로 결정된 것이라면 여기서 고치지 말고 아래 <strong>「○○학년도부터 바꾸기」</strong>를 쓰세요 — 여기서 고치면 지난 학년도 화면 표시도 함께 바뀝니다.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4"></div>
            <p className="text-sm font-semibold text-gray-600">창체·SLAT 배치를 불러오는 중입니다...</p>
          </div>
        ) : cohorts.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center space-y-3">
            <span className="text-3xl">🗓️</span>
            <h3 className="text-sm font-bold text-gray-800">등록된 교육과정 배치가 없습니다</h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              창체·SLAT이 들어갈 요일·교시를 등록해 주세요.
            </p>
            <button
              onClick={handleOpenNew}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
            >
              + 첫 번째 배치 등록하기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {cohorts.map((c) => {
              const applicableGrades = gradesForCohort(cohorts, c.id, currentSchoolYear);
              const gradeText =
                applicableGrades.length > 0
                  ? `${currentSchoolYear}학년도 기준 ${applicableGrades.map((g) => `${g}학년`).join(" · ")}에 적용됩니다`
                  : `${currentSchoolYear}학년도에는 해당하는 학년이 없습니다`;

              return (
                <div
                  key={c.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* 카드 헤더 */}
                    <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-gray-900">{c.label}</h3>
                          {!c.active && (
                            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-bold">
                              비활성
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-indigo-700 font-semibold mt-0.5">
                          {c.startAdmissionYear}년 입학생부터 적용
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleOpenEdit(c)}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded text-xs transition-colors"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDeleteCohort(c.id, c.label)}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 font-bold rounded text-xs transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                    {/* 시간표 미니 그리드 */}
                    <div className="space-y-1.5">
                      <h4 className="text-[11px] font-bold text-gray-700">고정 수업 시간표:</h4>
                      <div className="overflow-x-auto border border-gray-200 rounded-lg">
                        <table className="w-full text-center text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-100/80 text-gray-600 font-bold border-b border-gray-200">
                              <th className="py-1 px-1.5 w-12 text-[11px]">교시</th>
                              {DAYS.map((d) => (
                                <th key={d.day} className="py-1 px-2 text-[11px]">
                                  {d.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {PERIOD_LIST.map((p) => (
                              <tr key={p} className="hover:bg-gray-50/50">
                                <td className="py-1 px-1.5 bg-gray-50 font-bold text-gray-500 text-[11px]">
                                  {p}교시
                                </td>
                                {DAYS.map((d) => {
                                  const hit = (c.fixedSlots || []).find(
                                    (s) => s.day === d.day && s.period === p
                                  );
                                  return (
                                    <td key={d.day} className="py-1 px-1.5">
                                      {hit ? (
                                        <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-900 rounded font-bold text-[11px] block truncate">
                                          {hit.displayName}
                                        </span>
                                      ) : (
                                        <span className="text-gray-300">·</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* 하단 역산 안내 문구 */}
                  <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-900 flex items-center gap-1.5 font-medium">
                    <span>ℹ️</span>
                    <span>
                      <strong>{currentSchoolYear}학년도 기준:</strong> {gradeText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── ⑶ 아래: 학년도별 변경 (○○학년도부터 바꾸기) ── */}
      <div className="space-y-4 pt-6 border-t border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>🔄 학년도별 변경 (○○학년도부터 바꾸기)</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              실무협의회 결정 등으로 특정 학년도부터 전 학년 또는 특정 학년의 배치를 바꿀 때 등록합니다. 지난 학년도 기록은 안전하게 보존됩니다.
            </p>
          </div>
          <button
            onClick={handleOpenNewOverride}
            className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 self-start sm:self-auto"
          >
            <span>+ {currentSchoolYear}학년도부터 바꾸기</span>
          </button>
        </div>

        {loading ? null : overrides.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center space-y-2">
            <span className="text-2xl">📋</span>
            <h4 className="text-sm font-bold text-gray-700">등록된 학년도별 변경이 없습니다</h4>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              특정 학년도부터 창체·SLAT 배치를 변경하려면 위 「+ {currentSchoolYear}학년도부터 바꾸기」 버튼을 눌러 등록하세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {overrides.map((o) => {
              const isPast = o.effectiveFromSchoolYear < currentSchoolYear;
              const gradeKeys = [1, 2, 3].filter((g) => o.gradeSlots?.[g]);

              return (
                <div
                  key={o.id}
                  className={`bg-white rounded-xl shadow-sm border p-5 space-y-4 ${
                    isPast ? "border-gray-200 bg-gray-50/30" : "border-purple-200"
                  }`}
                >
                  {/* 카드 헤더 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-bold text-gray-900">{o.label}</h4>
                        {!o.active && (
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-bold">
                            비활성
                          </span>
                        )}
                        {isPast && (
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-[11px] font-bold">
                            지난 기록 (이력 보존)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-purple-700 font-bold mt-0.5">
                        {o.effectiveFromSchoolYear}학년도부터 적용 · 대상: {gradeKeys.map((g) => `${g}학년`).join(" · ")}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      <button
                        onClick={() => handleOpenEditOverride(o)}
                        disabled={isPast}
                        className={`px-3 py-1.5 font-bold rounded text-xs transition-colors ${
                          isPast
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "bg-purple-50 hover:bg-purple-100 text-purple-700"
                        }`}
                        title={isPast ? "지난 학년도의 변경 기록은 수정할 수 없습니다" : "수정"}
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDeleteOverride(o.id, o.label)}
                        disabled={isPast}
                        className={`px-3 py-1.5 font-bold rounded text-xs transition-colors ${
                          isPast
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600"
                        }`}
                        title={isPast ? "지난 학년도의 변경 기록은 삭제할 수 없습니다" : "삭제"}
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {isPast && (
                    <p className="text-xs text-gray-500 bg-gray-100/80 px-3 py-1.5 rounded-lg font-medium">
                      🔒 지난 학년도의 변경 기록은 수정하거나 삭제할 수 없습니다.
                    </p>
                  )}

                  {/* 담긴 학년들의 미니 격자 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {gradeKeys.map((grade) => {
                      const entry = o.gradeSlots[grade];
                      const slots = entry?.slots || [];
                      const cohortObj = cohortForGrade(cohorts, o.effectiveFromSchoolYear, grade);
                      const cohortName = cohortObj?.label ?? "등록된 교육과정 없음";

                      return (
                        <div
                          key={grade}
                          className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-gray-800">
                            <span className="text-purple-900 font-bold">{grade}학년</span>
                            <span className="text-[11px] font-normal text-gray-500">
                              {slots.length}칸
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 truncate" title={cohortName}>
                            기반: {cohortName}
                          </div>
                          <div className="overflow-x-auto border border-gray-200 rounded bg-white">
                            <table className="w-full text-center text-xs border-collapse">
                              <thead>
                                <tr className="bg-gray-100/80 text-gray-600 font-bold border-b border-gray-200">
                                  <th className="py-0.5 px-1 w-8 text-[11px]">교시</th>
                                  {DAYS.map((d) => (
                                    <th key={d.day} className="py-0.5 px-1 text-[11px]">
                                      {d.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {PERIOD_LIST.map((p) => (
                                  <tr key={p}>
                                    <td className="py-0.5 px-1 bg-gray-50 text-gray-500 font-bold text-[11px]">
                                      {p}
                                    </td>
                                    {DAYS.map((d) => {
                                      const hit = slots.find(
                                        (s) => s.day === d.day && s.period === p
                                      );
                                      return (
                                        <td key={d.day} className="py-0.5 px-0.5">
                                          {hit ? (
                                            <span className="px-1 py-0.2 bg-purple-100 text-purple-900 rounded font-bold text-[11px] block truncate">
                                              {hit.displayName}
                                            </span>
                                          ) : (
                                            <span className="text-gray-300 text-[11px]">·</span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 교육과정 등록/수정 모달 ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {editingCohortId ? "창체·SLAT 배치 수정" : "새 창체·SLAT 배치 등록"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  이 배치를 어느 입학생부터 적용할지와, 창체·SLAT이 들어갈 요일·교시를 정합니다.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* 수정 시 안내 문구 */}
              {editingCohortId && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 font-medium">
                  💡 자리를 옮기기로 결정된 것이라면 여기서 고치지 말고 <strong>「○○학년도부터 바꾸기」</strong>를 쓰세요 — 여기서 고치면 지난 학년도 화면 표시도 함께 바뀝니다.
                </div>
              )}

              {/* 입력 폼 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">교육과정 명칭</label>
                  <input
                    type="text"
                    placeholder="예: 2022 개정 교육과정"
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">적용 시작 입학년도</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="예: 2025"
                      value={formStartYear}
                      onChange={(e) => setFormStartYear(parseInt(e.target.value, 10) || 2025)}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-indigo-600"
                    />
                    <span className="text-sm text-gray-600 font-bold whitespace-nowrap">년 입학생부터</span>
                  </div>
                </div>
              </div>

              {/* 고정 슬롯 선택 안내 */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-gray-800">
                    전교 고정 시간 선택 (격자를 클릭하여 켜고 끕니다):
                  </label>
                  <span className="text-gray-500 text-[11px]">
                    선택된 슬롯: <strong>{formSlots.length}</strong>개
                  </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-center text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                        <th className="py-2 px-2 w-14 text-xs">교시</th>
                        {DAYS.map((d) => (
                          <th key={d.day} className="py-2 px-2 text-xs">
                            {d.label}요일
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {PERIOD_LIST.map((p) => (
                        <tr key={p} className="divide-x divide-gray-100">
                          <td className="py-2 px-2 bg-gray-50 font-bold text-gray-600 text-xs">
                            {p}교시
                          </td>
                          {DAYS.map((d) => {
                            const hit = formSlots.find((s) => s.day === d.day && s.period === p);
                            return (
                              <td
                                key={d.day}
                                onClick={() => handleToggleSlot(d.day, p)}
                                className={`py-2 px-2 cursor-pointer transition-all text-xs ${
                                  hit
                                    ? "bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-inner"
                                    : "hover:bg-indigo-50/50 text-gray-300"
                                }`}
                              >
                                {hit ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <span>{hit.displayName}</span>
                                    <span
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSlotNameModal({ day: d.day, period: p, name: hit.displayName });
                                      }}
                                      className="text-[11px] bg-indigo-700/80 px-1 rounded hover:bg-indigo-800"
                                    >
                                      ✎
                                    </span>
                                  </div>
                                ) : (
                                  <span>+</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-sm transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveCohort}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm shadow-sm transition-colors"
              >
                {saving ? "저장 중..." : "저장하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 학년도별 변경 등록/수정 모달 ── */}
      {overrideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {editingOverrideId
                    ? "학년도별 변경 수정"
                    : `새 학년도별 변경 등록 (${overrideFormYear}학년도부터 바꾸기)`}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  특정 학년도부터 적용할 창체·SLAT 배치를 등록합니다. 지난 학년도 기록은 안전하게 보존됩니다.
                </p>
              </div>
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* 입력 폼 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    변경 명칭 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="예: 2027학년도 창체 수요일 이동"
                    value={overrideFormLabel}
                    onChange={(e) => setOverrideFormLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-purple-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    적용 시작 학년도 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={currentSchoolYear}
                      value={overrideFormYear}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || currentSchoolYear;
                        setOverrideFormYear(val);
                        // 격자를 아직 손대지 않았다면 바뀐 학년도 기준으로 미리 채움을 다시 계산한다
                        // — 전환기(두 교육과정 공존)에는 학년도에 따라 기본값이 달라진다 (Codex 검증 F② 지적)
                        if (!editingOverrideId && !overrideFormTouched) {
                          const remap: Record<number, CohortFixedSlot[]> = {};
                          for (const g of [1, 2, 3]) {
                            remap[g] = resolveFixedSlots(cohorts, overrides, val, g).slots.map(
                              (s) => ({ ...s })
                            );
                          }
                          setOverrideFormGradeSlots(remap);
                        }
                      }}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-purple-600"
                    />
                    <span className="text-sm text-gray-600 font-bold whitespace-nowrap">학년도부터</span>
                  </div>
                  {overrideFormYear < currentSchoolYear && (
                    <p className="text-[11px] text-red-600 mt-1">
                      ⚠️ 적용 학년도는 현재 학년도({currentSchoolYear}학년도) 이상이어야 합니다.
                    </p>
                  )}
                </div>
              </div>

              {/* 학년 선택 체크박스 */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-800">
                  적용 대상 학년 선택:
                </label>
                <div className="flex flex-wrap items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                  {[1, 2, 3].map((grade) => {
                    const checked = overrideFormSelectedGrades.includes(grade);
                    const cohortObj = cohortForGrade(cohorts, overrideFormYear, grade);
                    return (
                      <label key={grade} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const nextSelected = [...overrideFormSelectedGrades, grade].sort();
                              setOverrideFormSelectedGrades(nextSelected);
                              if (
                                !overrideFormGradeSlots[grade] ||
                                overrideFormGradeSlots[grade].length === 0
                              ) {
                                const resolved = resolveFixedSlots(
                                  cohorts,
                                  overrides,
                                  overrideFormYear,
                                  grade
                                );
                                setOverrideFormGradeSlots((prev) => ({
                                  ...prev,
                                  [grade]: resolved.slots.map((s) => ({ ...s })),
                                }));
                              }
                            } else {
                              setOverrideFormSelectedGrades(
                                overrideFormSelectedGrades.filter((g) => g !== grade)
                              );
                            }
                          }}
                          className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                        />
                        <span className="text-sm font-bold text-gray-900">{grade}학년</span>
                        <span className="text-[11px] text-gray-500">
                          ({cohortObj ? cohortObj.label : "교육과정 미등록"})
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 체크된 학년마다 배치 에디터 */}
              {overrideFormSelectedGrades.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center text-xs text-amber-800 font-medium">
                  적어도 1개 이상의 학년을 선택해주세요.
                </div>
              ) : (
                <div className="space-y-6">
                  {overrideFormSelectedGrades.map((grade) => {
                    const cohortObj = cohortForGrade(cohorts, overrideFormYear, grade);
                    const slots = overrideFormGradeSlots[grade] || [];
                    const cohortName = cohortObj?.label ?? "등록된 교육과정 없음";

                    return (
                      <div
                        key={grade}
                        className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-gray-200 pb-2">
                          <div>
                            <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-900 rounded font-bold text-xs">
                                {grade}학년
                              </span>
                              <span>고정 시간 배치</span>
                            </h4>
                            <p className="text-xs text-gray-600 mt-0.5">
                              이 학년도의 {grade}학년은 <strong>{cohortName}</strong> 교육과정을 따릅니다.
                            </p>
                          </div>
                          <div className="text-[11px] text-gray-500">
                            선택된 슬롯: <strong>{slots.length}</strong>개
                          </div>
                        </div>

                        {/* 격자 테이블 */}
                        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                          <table className="w-full text-center text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                                <th className="py-2 px-2 w-14 text-xs">교시</th>
                                {DAYS.map((d) => (
                                  <th key={d.day} className="py-2 px-2 text-xs">
                                    {d.label}요일
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {PERIOD_LIST.map((p) => (
                                <tr key={p} className="divide-x divide-gray-100">
                                  <td className="py-2 px-2 bg-gray-50 font-bold text-gray-600 text-xs">
                                    {p}교시
                                  </td>
                                  {DAYS.map((d) => {
                                    const hit = slots.find(
                                      (s) => s.day === d.day && s.period === p
                                    );
                                    return (
                                      <td
                                        key={d.day}
                                        onClick={() => handleToggleOverrideSlot(grade, d.day, p)}
                                        className={`py-2 px-2 cursor-pointer transition-all text-xs ${
                                          hit
                                            ? "bg-purple-600 text-white font-bold hover:bg-purple-700 shadow-inner"
                                            : "hover:bg-purple-50 text-gray-300"
                                        }`}
                                      >
                                        {hit ? (
                                          <div className="flex items-center justify-center gap-1">
                                            <span>{hit.displayName}</span>
                                            <span
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setOverrideSlotNameModal({
                                                  grade,
                                                  day: d.day,
                                                  period: p,
                                                  name: hit.displayName,
                                                });
                                              }}
                                              className="text-[11px] bg-purple-700/80 px-1 rounded hover:bg-purple-800"
                                            >
                                              ✎
                                            </span>
                                          </div>
                                        ) : (
                                          <span>+</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-sm transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveOverride}
                disabled={
                  saving ||
                  overrideFormYear < currentSchoolYear ||
                  overrideFormSelectedGrades.length === 0
                }
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm shadow-sm transition-colors"
              >
                {saving ? "저장 중..." : "저장하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 슬롯 이름 변경 모달 (교육과정용) ── */}
      {slotNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-xs w-full p-4 space-y-3">
            <h4 className="text-sm font-bold text-gray-900">
              {DAYS.find((d) => d.day === slotNameModal.day)?.label}요일 {slotNameModal.period}교시 명칭 설정
            </h4>
            <input
              type="text"
              placeholder="예: 창체, SLAT"
              value={slotNameModal.name}
              onChange={(e) => setSlotNameModal({ ...slotNameModal, name: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-indigo-600"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveSlotName();
              }}
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setSlotNameModal(null)}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded text-xs"
              >
                닫기
              </button>
              <button
                onClick={handleSaveSlotName}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-xs"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 슬롯 이름 변경 모달 (학년도별 변경용) ── */}
      {overrideSlotNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-xs w-full p-4 space-y-3">
            <h4 className="text-sm font-bold text-gray-900">
              {overrideSlotNameModal.grade}학년 {DAYS.find((d) => d.day === overrideSlotNameModal.day)?.label}요일 {overrideSlotNameModal.period}교시 명칭 설정
            </h4>
            <input
              type="text"
              placeholder="예: 창체, SLAT"
              value={overrideSlotNameModal.name}
              onChange={(e) => setOverrideSlotNameModal({ ...overrideSlotNameModal, name: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-purple-600"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveOverrideSlotName();
              }}
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setOverrideSlotNameModal(null)}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded text-xs"
              >
                닫기
              </button>
              <button
                onClick={handleSaveOverrideSlotName}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded text-xs"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
