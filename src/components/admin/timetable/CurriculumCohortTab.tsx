"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { CurriculumCohort, CohortFixedSlot } from "@/lib/timetable/types";
import { gradesForCohort } from "@/lib/timetable/cohort";

interface CurriculumCohortTabProps {
  periodsPerDay?: number;
}

export default function CurriculumCohortTab({ periodsPerDay = 7 }: CurriculumCohortTabProps) {
  const { userData } = useAuth();

  const [cohorts, setCohorts] = useState<CurriculumCohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 현재 기준 학년도 (역산 표시용)
  const [currentSchoolYear, setCurrentSchoolYear] = useState<number>(new Date().getFullYear());

  // 편집 모달/폼 상태
  const [editingCohortId, setEditingCohortId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState<string>("");
  const [formStartYear, setFormStartYear] = useState<number>(2025);
  const [formSlots, setFormSlots] = useState<CohortFixedSlot[]>([]);
  const [formActive, setFormActive] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState(false);

  // 슬롯 이름 편집 상태 (어느 슬롯을 클릭했는지)
  const [slotNameModal, setSlotNameModal] = useState<{ day: number; period: number; name: string } | null>(null);

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
    loadCohorts();
  }, []);

  const loadCohorts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cohort_list" }),
      });
      const data = await res.json();
      if (res.ok) {
        setCohorts(data.cohorts || []);
      } else {
        setError(data.error || "교육과정 등록부 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`로드 오류: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenNew = () => {
    setEditingCohortId(null);
    setFormLabel("");
    setFormStartYear(new Date().getFullYear());
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
      // 슬롯 제거
      setFormSlots(formSlots.filter((s) => !(s.day === day && s.period === period)));
    } else {
      // 기본값 창체로 슬롯 추가 후 이름 팝오버 열기
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
        await loadCohorts();
      } else {
        setError(data.error || "교육과정 저장에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`저장 오류: ${err.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCohort = async (cohortId: string, label: string) => {
    if (!confirm(`정말 '${label}' 교육과정 설정을 삭제하시겠습니까?`)) return;
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
        setSuccessMessage("교육과정이 삭제되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);
        await loadCohorts();
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
      {/* ── 상단 안내 바 ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>⏱️ 창체·SLAT 배치</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            교육과정별(입학년도 기준)로 고정되는 창체·SLAT 등의 전교 고정 교시를 등록합니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">기준 학년도:</span>
            <input
              type="number"
              value={currentSchoolYear}
              onChange={(e) => setCurrentSchoolYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
              className="w-16 px-1.5 py-0.5 bg-white border border-gray-300 rounded font-mono font-bold text-center text-xs"
            />
            <span className="text-gray-500">학년도</span>
          </div>

          <button
            onClick={handleOpenNew}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span>+ 교육과정 추가</span>
          </button>
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

      {/* ── 교육과정 카드 목록 ── */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4"></div>
          <p className="text-sm font-semibold text-gray-600">교육과정 데이터를 불러오는 중입니다...</p>
        </div>
      ) : cohorts.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center space-y-3">
          <span className="text-3xl">🗓️</span>
          <h3 className="text-sm font-bold text-gray-800">등록된 창체·SLAT 배치가 없습니다</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            새 교육과정을 추가하고 창체·SLAT 등 전교 고정 교시를 등록해보세요.
          </p>
          <button
            onClick={handleOpenNew}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            + 첫 번째 교육과정 등록하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {cohorts.map((c) => {
            // cohort.ts의 gradesForCohort 함수를 사용하여 해당 학년도에 적용되는 학년 역산
            const applicableGrades = gradesForCohort(cohorts, c.id, currentSchoolYear);
            const gradeText =
              applicableGrades.length > 0
                ? `${applicableGrades.map((g) => `${g}학년`).join(" · ")}이 이 교육과정을 따릅니다`
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
                            <th className="py-1 px-1.5 w-12">교시</th>
                            {DAYS.map((d) => (
                              <th key={d.day} className="py-1 px-2">
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

                {/* 하단 역산 안내 문구 (스펙 §2-5 핵심 안전장치) */}
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
                  해당 교육과정이 처음 적용된 입학생 연도와 전교 고정 교시를 설정합니다.
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
              {/* 입력 폼 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">교육과정 명칭</label>
                  <input
                    type="text"
                    placeholder="예: 2022 개정 교육과정"
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1">적용 시작 입학년도</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="예: 2025"
                      value={formStartYear}
                      onChange={(e) => setFormStartYear(parseInt(e.target.value, 10) || 2025)}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg font-mono font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-indigo-600"
                    />
                    <span className="text-gray-600 font-bold whitespace-nowrap">년 입학생부터</span>
                  </div>
                </div>
              </div>

              {/* 고정 슬롯 선택 안내 */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-gray-800">
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
                        <th className="py-2 px-2 w-14">교시</th>
                        {DAYS.map((d) => (
                          <th key={d.day} className="py-2 px-2">
                            {d.label}요일
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {PERIOD_LIST.map((p) => (
                        <tr key={p} className="divide-x divide-gray-100">
                          <td className="py-2 px-2 bg-gray-50 font-bold text-gray-600">
                            {p}교시
                          </td>
                          {DAYS.map((d) => {
                            const hit = formSlots.find((s) => s.day === d.day && s.period === p);
                            return (
                              <td
                                key={d.day}
                                onClick={() => handleToggleSlot(d.day, p)}
                                className={`py-2 px-2 cursor-pointer transition-all ${
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
                                      className="text-xs bg-indigo-700/80 px-1 rounded hover:bg-indigo-800"
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
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-xs transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSaveCohort}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs shadow-sm transition-colors"
              >
                {saving ? "저장 중..." : "저장하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 슬롯 이름 변경 모달 ── */}
      {slotNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-xs w-full p-4 space-y-3">
            <h4 className="text-xs font-bold text-gray-900">
              {DAYS.find((d) => d.day === slotNameModal.day)?.label}요일 {slotNameModal.period}교시 명칭 설정
            </h4>
            <input
              type="text"
              placeholder="예: 창체, SLAT"
              value={slotNameModal.name}
              onChange={(e) => setSlotNameModal({ ...slotNameModal, name: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded text-xs font-bold text-gray-900"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveSlotName();
              }}
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setSlotNameModal(null)}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded"
              >
                닫기
              </button>
              <button
                onClick={handleSaveSlotName}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded"
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
