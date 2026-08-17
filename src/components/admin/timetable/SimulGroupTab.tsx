"use client";

import { useEffect, useState } from "react";
import { SimulGroup, SimulSlot, isSimulCell } from "@/lib/timetable/simul";
import { ClassGrid } from "@/lib/timetable/types";
import { useAvailableClasses } from "./useAvailableClasses";
import RegistryUnlockModal, { getStoredUnlockReason } from "./RegistryUnlockModal";

interface SimulGroupTabProps {
  activeTermId?: string | null;
  isOperating?: boolean;
  isArchived?: boolean;
}

export default function SimulGroupTab({ activeTermId, isOperating = false, isArchived = false }: SimulGroupTabProps) {
  const [groups, setGroups] = useState<SimulGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 잠금 해제 사유 모달 상태
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<((reason: string) => Promise<void>) | null>(null);

  const { getClassesForGrade } = useAvailableClasses(activeTermId, { fallbackOnEmpty: true });

  // Form states
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [grade, setGrade] = useState<number>(1);
  const [classNums, setClassNums] = useState<number[]>([1, 2, 3]);
  const [subjectInput, setSubjectInput] = useState("");
  const [subjectNames, setSubjectNames] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  // Slots restriction states
  const [useSlots, setUseSlots] = useState(false);
  const [slots, setSlots] = useState<SimulSlot[]>([]);
  const [slotDay, setSlotDay] = useState<number>(1);
  const [slotPeriod, setSlotPeriod] = useState<number>(1);

  // Preview state (기초/주간 시간표 미리보기용)
  const [previewGrid, setPreviewGrid] = useState<ClassGrid | null>(null);
  const [previewClassNum, setPreviewClassNum] = useState<number>(1);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const DAYS = [
    { num: 1, label: "월" },
    { num: 2, label: "화" },
    { num: 3, label: "수" },
    { num: 4, label: "목" },
    { num: 5, label: "금" },
  ];

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simul_list", termId: activeTermId }),
      });

      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || data.data || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "이동수업 그룹 목록을 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [activeTermId]);

  // 미리보기 클래스 그리드 로드
  const fetchPreviewClassGrid = async (g: number, c: number) => {
    setLoadingPreview(true);
    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "class",
          grade: g,
          classNum: c,
          termId: activeTermId || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data && !Array.isArray(data.data)) {
          setPreviewGrid(data.data as ClassGrid);
        } else if (Array.isArray(data.data) && data.data.length > 0) {
          setPreviewGrid(data.data[0] as ClassGrid);
        } else {
          setPreviewGrid(null);
        }
      }
    } catch {
      setPreviewGrid(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    const targetClass = classNums.length > 0 ? classNums[0] : 1;
    setPreviewClassNum(targetClass);
    fetchPreviewClassGrid(grade, targetClass);
  }, [grade, classNums[0], activeTermId]);

  const resetForm = () => {
    setEditingGroupId(null);
    setLabel("");
    setGrade(1);
    setClassNums([1, 2, 3]);
    setSubjectInput("");
    setSubjectNames([]);
    setActive(true);
    setUseSlots(false);
    setSlots([]);
  };

  const handleAddSubject = () => {
    const trimmed = subjectInput.trim();
    if (!trimmed) return;
    if (!subjectNames.includes(trimmed)) {
      setSubjectNames([...subjectNames, trimmed]);
    }
    setSubjectInput("");
  };

  const handleRemoveSubject = (name: string) => {
    setSubjectNames(subjectNames.filter((s) => s !== name));
  };

  const handleToggleClassNum = (num: number) => {
    if (classNums.includes(num)) {
      if (classNums.length === 1) return; // 최소 1개는 선택 유지
      setClassNums(classNums.filter((c) => c !== num));
    } else {
      setClassNums([...classNums, num].sort((a, b) => a - b));
    }
  };

  const handleAddSlot = () => {
    const exists = slots.some((s) => s.day === slotDay && s.period === slotPeriod);
    if (!exists) {
      setSlots([...slots, { day: slotDay, period: slotPeriod }].sort((a, b) => a.day - b.day || a.period - b.period));
    }
  };

  const handleRemoveSlot = (day: number, period: number) => {
    setSlots(slots.filter((s) => !(s.day === day && s.period === period)));
  };

  const handleEditClick = (group: SimulGroup) => {
    setEditingGroupId(group.id || null);
    setLabel(group.label);
    setGrade(group.grade);
    setClassNums(group.classNums || []);
    setSubjectNames(group.subjectNames || []);
    setActive(group.active !== false);
    if (group.slots && group.slots.length > 0) {
      setUseSlots(true);
      setSlots(group.slots);
    } else {
      setUseSlots(false);
      setSlots([]);
    }
  };

  const handleSaveGroup = async (e: React.FormEvent, reasonOverride?: string) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    if (!label.trim()) {
      alert("그룹명을 입력해 주세요.");
      return;
    }
    if (classNums.length < 2) {
      alert("묶인 반을 2개 이상 선택해 주세요 (이동수업은 여러 반이 함께 듣는 수업입니다).");
      return;
    }
    if (subjectNames.length === 0 && !subjectInput.trim()) {
      alert("대상 과목명을 최소 1개 이상 등록해 주세요.");
      return;
    }

    let finalSubjects = [...subjectNames];
    if (subjectInput.trim() && !finalSubjects.includes(subjectInput.trim())) {
      finalSubjects.push(subjectInput.trim());
    }

    const unlockReason = reasonOverride || getStoredUnlockReason(activeTermId);

    setSaving(true);
    try {
      const payload: SimulGroup = {
        id: editingGroupId || undefined,
        termId: activeTermId ?? "",
        label: label.trim(),
        grade,
        classNums,
        subjectNames: finalSubjects,
        slots: useSlots ? slots : undefined,
        active,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "simul_save",
          simulGroup: payload,
          ...(editingGroupId ? { simulGroupId: editingGroupId } : {}),
          ...(unlockReason ? { unlockReason } : {}),
        }),
      });

      const data = await res.json();
      if (res.status === 423 || data.code === "registry-locked") {
        if (data.termState === "archived") {
          alert(data.error || "지난 학기의 편성 등록 내용은 열람만 가능합니다.");
          return;
        }
        setPendingAction(() => async (reason: string) => {
          await handleSaveGroup(e, reason);
        });
        setUnlockModalOpen(true);
        return;
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || "저장에 실패했습니다.");
      }

      alert("이동수업(분반) 그룹이 성공적으로 저장되었습니다.");
      resetForm();
      fetchGroups();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, groupLabel: string, reasonOverride?: string) => {
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    if (!reasonOverride && !confirm(`'${groupLabel}' 이동수업 그룹을 삭제하시겠습니까?`)) return;
    setDeletingId(groupId);
    const unlockReason = reasonOverride || getStoredUnlockReason(activeTermId);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "simul_delete",
          simulGroupId: groupId,
          ...(unlockReason ? { unlockReason } : {}),
        }),
      });
      const data = await res.json();
      if (res.status === 423 || data.code === "registry-locked") {
        if (data.termState === "archived") {
          alert(data.error || "지난 학기의 편성 등록 내용은 열람만 가능합니다.");
          return;
        }
        setPendingAction(() => async (reason: string) => {
          await handleDeleteGroup(groupId, groupLabel, reason);
        });
        setUnlockModalOpen(true);
        return;
      }

      if (!res.ok || data.error) throw new Error(data.error || "삭제에 실패했습니다.");
      
      alert("그룹이 삭제되었습니다.");
      if (editingGroupId === groupId) resetForm();
      fetchGroups();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // 현재 폼 작성 내용에 기반한 가상 그룹 객체 (미리보기 판정용)
  const currentFormGroup: SimulGroup = {
    termId: activeTermId ?? "",
    label: label || "미리보기 그룹",
    grade,
    classNums,
    subjectNames: subjectNames.length > 0 ? subjectNames : [subjectInput.trim()].filter(Boolean),
    slots: useSlots ? slots : undefined,
    active: true,
  };

  return (
    <div className="space-y-6">
      {/* 카드 헤더 안내 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>🔀 동시수업(분반 이동수업) 그룹 관리</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-purple-100 text-purple-800 border border-purple-200">
                이동수업 그룹
              </span>
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              제2외국어(중국어·일본어)나 과학 이동수업 등 여러 반을 묶어 동시에 진행되는 분반 수업을 그룹으로 등록합니다.<br />
              지정된 이동수업 칸은 교사 포털·직권 배정·학생 카드 등에 <strong>연보라 배지</strong>로 표시되며, 맞교환 시 <strong>묶여 있는 모든 반이 함께 이동하는 조율 필요 후보(사전 양해 필수)</strong>로 안내되고 단독 교환·연쇄 이동·보강은 안전하게 차단됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 등록/수정 폼 & 미리보기 (lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSaveGroup} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>{editingGroupId ? "✏️ 이동수업 그룹 수정" : "➕ 신규 이동수업 그룹 추가"}</span>
                {isOperating && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    🔒 운영 학기 잠김
                  </span>
                )}
                {isArchived && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                    🔒 열람 전용
                  </span>
                )}
              </h4>
              {editingGroupId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-gray-500 hover:text-gray-700 underline font-medium"
                >
                  새 그룹 작성으로 전환
                </button>
              )}
            </div>

            {/* 그룹명 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                그룹 이름 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 1학년 제2외국어 (중국어Ⅰ/일본어Ⅰ)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                required
              />
            </div>

            {/* 학년 및 반 선택 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  학년 선택 <span className="text-red-500">*</span>
                </label>
                <select
                  value={grade}
                  onChange={(e) => {
                    const nextGrade = parseInt(e.target.value);
                    setGrade(nextGrade);
                    const nextClasses = getClassesForGrade(nextGrade);
                    setClassNums((prev) => {
                      const valid = prev.filter((c) => nextClasses.includes(c));
                      return valid.length > 0 ? valid : (nextClasses.length > 0 ? [nextClasses[0]] : []);
                    });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                >
                  <option value={1}>1학년</option>
                  <option value={2}>2학년</option>
                  <option value={3}>3학년</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  묶인 학급(반) 다중 선택 <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                  {getClassesForGrade(grade).length === 0 ? (
                    <span className="text-xs text-gray-400 p-1">등록된 반이 없습니다.</span>
                  ) : (
                    getClassesForGrade(grade).map((cNum) => {
                      const isSelected = classNums.includes(cNum);
                      return (
                        <button
                          type="button"
                          key={cNum}
                          onClick={() => handleToggleClassNum(cNum)}
                          className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                            isSelected
                              ? "bg-purple-600 text-white shadow-xs"
                              : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {cNum}반
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* 과목명 목록 입력 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                대상 과목명 등록 (기초 시간표 표기와 정확히 일치) <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={subjectInput}
                  onChange={(e) => setSubjectInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddSubject();
                    }
                  }}
                  placeholder="예: 중국어Ⅰ (입력 후 추가 버튼 클릭)"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddSubject}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  추가
                </button>
              </div>

              {/* 과목 태그 리스트 */}
              <div className="flex flex-wrap gap-1.5 min-h-[2rem] p-2 bg-slate-50 border border-slate-200 rounded-lg">
                {subjectNames.length === 0 ? (
                  <span className="text-xs text-gray-400 italic">등록된 과목이 없습니다.</span>
                ) : (
                  subjectNames.map((sName) => (
                    <span
                      key={sName}
                      className="inline-flex items-center gap-1.5 bg-purple-50 border border-purple-200 text-purple-800 text-xs font-bold px-2.5 py-1 rounded-md"
                    >
                      <span>{sName}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubject(sName)}
                        className="text-purple-400 hover:text-purple-700 text-xs font-black"
                      >
                        ✕
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* 교시 제한 (옵션) */}
            <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-800">
                  <input
                    type="checkbox"
                    checked={useSlots}
                    onChange={(e) => setUseSlots(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                  />
                  <span>특정 교시만 한정 지정 (선택 사항)</span>
                </label>
                <span className="text-[11px] text-gray-500">
                  미지정 시 대상 과목 수업 전체 적용
                </span>
              </div>

              {useSlots && (
                <div className="space-y-3 pt-2 border-t border-gray-200">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={slotDay}
                      onChange={(e) => setSlotDay(parseInt(e.target.value))}
                      className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none"
                    >
                      {DAYS.map((d) => (
                        <option key={d.num} value={d.num}>
                          {d.label}요일
                        </option>
                      ))}
                    </select>

                    <select
                      value={slotPeriod}
                      onChange={(e) => setSlotPeriod(parseInt(e.target.value))}
                      className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none"
                    >
                      {Array.from({ length: 7 }).map((_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {i + 1}교시
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={handleAddSlot}
                      className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      교시 추가
                    </button>
                  </div>

                  {/* 슬롯 태그 목록 */}
                  <div className="flex flex-wrap gap-1.5">
                    {slots.map((sl) => {
                      const dLabel = DAYS.find((d) => d.num === sl.day)?.label || `${sl.day}요일`;
                      return (
                        <span
                          key={`${sl.day}-${sl.period}`}
                          className="inline-flex items-center gap-1 bg-white border border-gray-300 text-gray-700 text-xs px-2 py-0.5 rounded font-bold"
                        >
                          <span>{dLabel} {sl.period}교시</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(sl.day, sl.period)}
                            className="text-gray-400 hover:text-red-600 font-bold ml-0.5"
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 활성화 상태 */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-800">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                />
                <span>이 그룹 활성화 (체크 해제 시 이동수업 판정 중단)</span>
              </label>
            </div>

            {/* 액션 버튼 */}
            <div className="flex justify-end gap-2 pt-2">
              {editingGroupId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  취소
                </button>
              )}
              <button
                type="submit"
                disabled={saving || isArchived}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-xs disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isOperating && <span>🔒</span>}
                <span>{saving ? "저장 중..." : editingGroupId ? "💾 수정사항 저장" : "✨ 이동수업 그룹 등록"}</span>
              </button>
            </div>
          </form>

          {/* 저장 전 미리보기 카드 */}
          {(editingGroupId !== null || label.trim() !== "" || subjectNames.length > 0) && (
            <div className="bg-white rounded-xl shadow-sm border border-purple-200 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-purple-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-purple-950 flex items-center gap-2">
                    <span>🔍 지정 수업 미리보기 검증</span>
                  </h4>
                  <p className="text-xs text-purple-700 mt-0.5">
                    현재 작성 중인 기준에 따라 교체 차단되는 실제 시간표 셀을 미리 확인합니다.
                  </p>
                </div>

                {/* 반 선택 버튼 */}
                <div className="flex items-center gap-1 bg-purple-50 p-1 rounded-lg">
                  <span className="text-[11px] font-bold text-purple-800 px-1.5">미리보기 반:</span>
                  {classNums.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setPreviewClassNum(c);
                        fetchPreviewClassGrid(grade, c);
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                        previewClassNum === c
                          ? "bg-purple-600 text-white shadow-xs"
                          : "text-purple-700 hover:bg-purple-100"
                      }`}
                    >
                      {c}반
                    </button>
                  ))}
                </div>
              </div>

            {loadingPreview ? (
              <div className="py-8 text-center text-xs text-gray-500 font-semibold">
                {grade}학년 {previewClassNum}반 시간표를 불러오는 중입니다...
              </div>
            ) : !previewGrid ? (
              <div className="py-6 text-center text-xs text-gray-400">
                시간표 데이터를 찾을 수 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-lg text-xs text-purple-900 leading-relaxed flex items-center justify-between">
                  <div>
                    🏫 <strong>{previewGrid.grade}학년 {previewGrid.classNum}반 시간표 대조</strong> — 하이라이트된 셀이 <strong>이동수업 교체 불가</strong>로 적용됩니다.
                  </div>
                </div>

                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                  <table className="w-full text-center text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-100 border-b border-gray-200 font-bold text-gray-700">
                        <th className="py-2 px-1 border-r border-gray-200 w-12">교시</th>
                        {DAYS.map((d) => (
                          <th key={d.num} className="py-2 px-1 border-r border-gray-200 min-w-[5.5rem]">
                            {d.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {Array.from({ length: 7 }).map((_, pIdx) => {
                        const period = pIdx + 1;
                        return (
                          <tr key={period}>
                            <td className="py-2 px-1 font-bold bg-gray-50 border-r border-gray-200 text-gray-600">
                              {period}
                            </td>
                            {DAYS.map((d) => {
                              const cell = previewGrid.cells?.find(
                                (c) => c.day === d.num && c.period === period
                              );
                              const lesson = cell?.lessons?.[0];
                              const subjectName = lesson?.subjectName || "";

                              // 미리보기 검증: 작성 중인 폼 기준 판정
                              const check = isSimulCell(
                                grade,
                                previewClassNum,
                                d.num,
                                period,
                                subjectName,
                                [currentFormGroup]
                              );

                              return (
                                <td
                                  key={d.num}
                                  className={`p-2 border-r border-gray-200 transition-colors ${
                                    check.hit
                                      ? "bg-purple-100/90 text-purple-950 font-black ring-2 ring-purple-400 ring-inset"
                                      : "bg-white text-gray-700"
                                  }`}
                                >
                                  {lesson ? (
                                    <div className="space-y-0.5">
                                      <div className="font-bold text-[11px] truncate">
                                        {lesson.subjectName}
                                      </div>
                                      <div className="text-[10px] text-gray-500 truncate">
                                        {lesson.teachers?.map((t) => t.name).join(", ")}
                                      </div>
                                      {check.hit && (
                                        <span className="inline-block text-[9px] bg-purple-700 text-white font-extrabold px-1 rounded mt-0.5">
                                          🔀 이동수업
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-gray-300">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          )}
        </div>

        {/* 우측: 등록된 이동수업 그룹 목록 (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>📋 등록된 이동수업 그룹 ({groups.length}건)</span>
              </h4>
              <button
                onClick={fetchGroups}
                disabled={loading}
                className="text-xs text-purple-600 hover:text-purple-800 font-bold transition-colors"
              >
                🔄 새로고침
              </button>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs text-gray-500 font-semibold">
                목록을 불러오는 중입니다...
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {error}
              </div>
            ) : groups.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 space-y-1">
                <p className="font-semibold">등록된 이동수업 그룹이 없습니다.</p>
                <p className="text-[11px]">좌측 폼에서 신규 그룹을 추가해 주세요.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((grp) => {
                  const isEditing = editingGroupId === grp.id;
                  return (
                    <div
                      key={grp.id || grp.label}
                      className={`p-4 rounded-xl border transition-all space-y-2.5 ${
                        isEditing
                          ? "bg-purple-50/80 border-purple-400 shadow-xs"
                          : grp.active !== false
                          ? "bg-white border-gray-200 hover:border-purple-200"
                          : "bg-gray-50 border-gray-200 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                              {grp.grade}학년
                            </span>
                            {grp.active === false && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                                비활성
                              </span>
                            )}
                          </div>
                          <h5 className="font-bold text-sm text-gray-900 mt-1">{grp.label}</h5>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleEditClick(grp)}
                            className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
                          >
                            수정
                          </button>
                          {grp.id && (
                            <button
                              onClick={() => handleDeleteGroup(grp.id!, grp.label)}
                              disabled={deletingId === grp.id || isArchived}
                              className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                            >
                              {isOperating && <span>🔒</span>}
                              <span>{deletingId === grp.id ? "삭제중" : "삭제"}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 세부 정보 */}
                      <div className="space-y-1 text-xs text-gray-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div>
                          <strong className="text-gray-700">대상 반:</strong>{" "}
                          {grp.classNums?.map((c) => `${c}반`).join(", ") || "전체"}
                        </div>
                        <div>
                          <strong className="text-gray-700">대상 과목:</strong>{" "}
                          <span className="text-purple-900 font-semibold">
                            {grp.subjectNames?.join(", ") || "미지정"}
                          </span>
                        </div>
                        {grp.slots && grp.slots.length > 0 && (
                          <div>
                            <strong className="text-gray-700">교시 한정:</strong>{" "}
                            {grp.slots
                              .map(
                                (s) =>
                                  `${DAYS.find((d) => d.num === s.day)?.label || s.day} ${s.period}교시`
                              )
                              .join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 잠금 해제 사유 입력 모달 */}
      <RegistryUnlockModal
        isOpen={unlockModalOpen}
        onClose={() => {
          setUnlockModalOpen(false);
          setPendingAction(null);
        }}
        onConfirm={async (reason) => {
          setUnlockModalOpen(false);
          if (pendingAction) {
            const actionToRun = pendingAction;
            setPendingAction(null);
            await actionToRun(reason);
          }
        }}
        termId={activeTermId}
        loading={saving || deletingId !== null}
      />
    </div>
  );
}
