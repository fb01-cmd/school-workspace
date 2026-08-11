"use client";

import { useEffect, useState } from "react";
import { VenueGroup, SimulSlot, ClassGrid } from "@/lib/timetable/types";
import { buildVenueMatcher } from "@/lib/timetable/venue";

interface VenueGroupTabProps {
  activeTermId?: string | null;
}

interface BaseConflict {
  day: number;
  period: number;
  roomName: string;
  users: string[];
}

export default function VenueGroupTab({ activeTermId }: VenueGroupTabProps) {
  const [groups, setGroups] = useState<VenueGroup[]>([]);
  const [baseConflicts, setBaseConflicts] = useState<BaseConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form states
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [label, setLabel] = useState("");
  const [grade, setGrade] = useState<number>(1);
  const [classNums, setClassNums] = useState<number[]>([1]);
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

  const PRESET_ROOMS = ["다윗관", "탁구장", "정보실", "생명과학실"];

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "venue_list", termId: activeTermId }),
      });

      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || data.data || []);
        setBaseConflicts(data.baseConflicts || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "특별실 배정 목록을 불러올 수 없습니다.");
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
    setRoomName("");
    setLabel("");
    setGrade(1);
    setClassNums([1]);
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
      if (classNums.length === 1) return; // 최소 1개 유지
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

  const handleEditClick = (group: VenueGroup) => {
    setEditingGroupId(group.id || null);
    setRoomName(group.roomName || "");
    setLabel(group.label || "");
    setGrade(group.grade || 1);
    setClassNums(group.classNums || [1]);
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

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) {
      alert("특별실명(장소)을 입력해 주세요.");
      return;
    }
    if (!label.trim()) {
      alert("설명/라벨을 입력해 주세요.");
      return;
    }
    if (classNums.length === 0) {
      alert("대상 학급(반)을 1개 이상 선택해 주세요.");
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

    setSaving(true);
    try {
      const payload: VenueGroup = {
        id: editingGroupId || undefined,
        termId: activeTermId || "2026-2",
        roomName: roomName.trim(),
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
          action: "venue_save",
          venueGroup: payload,
          ...(editingGroupId ? { venueGroupId: editingGroupId } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "저장에 실패했습니다.");
      }

      alert("특별실 배정이 성공적으로 저장되었습니다.");
      resetForm();
      fetchGroups();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, groupLabel: string) => {
    if (!confirm(`'${groupLabel}' 특별실 배정을 삭제하시겠습니까?`)) return;
    setDeletingId(groupId);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "venue_delete", venueGroupId: groupId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "삭제에 실패했습니다.");
      
      alert("배정이 삭제되었습니다.");
      if (editingGroupId === groupId) resetForm();
      fetchGroups();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // 현재 폼 작성 내용에 기반한 가상 그룹 객체 (미리보기 판정용)
  const currentFormGroup: VenueGroup = {
    termId: activeTermId || "2026-2",
    roomName: roomName || "특별실",
    label: label || "미리보기",
    grade,
    classNums,
    subjectNames: subjectNames.length > 0 ? subjectNames : [subjectInput.trim()].filter(Boolean),
    slots: useSlots ? slots : undefined,
    active: true,
  };

  // 폼 입력 기반 matcher
  const previewMatcher = buildVenueMatcher([currentFormGroup]);

  return (
    <div className="space-y-6">
      {/* 카드 헤더 안내 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>🏛️ 특별실(장소) 점유 제약 관리</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                공유 자원 점유 제약
              </span>
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              다윗관, 탁구장, 정보실, 생명과학실 등 한 교시에 한 수업만 사용 가능한 공유 공간을 등록합니다.<br />
              시간표 셀에 <strong>특별실명 뱃지</strong>가 표시되며, 수업 교체 시 <strong>같은 교시에 특별실 충돌이 발생하는 후보만 자동 제외</strong>됩니다.
            </p>
          </div>
        </div>
      </div>

      {/* 기초시간표 이중 점유 경고 앨럿 (baseConflicts) */}
      {baseConflicts.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-900 shadow-xs">
          <div className="font-extrabold flex items-center gap-1.5 text-amber-950 text-sm">
            <span>⚠️ 기초시간표 특별실 이중 점유 경고 ({baseConflicts.length}건)</span>
          </div>
          <p className="text-amber-800">
            동일 교시에 같은 특별실을 2개 이상의 수업이 동시에 사용하도록 등록되어 있습니다. 등록부 및 기초시간표 배정을 확인해 주세요.
          </p>
          <ul className="list-disc list-inside space-y-1 bg-amber-100/70 p-3 rounded-lg border border-amber-200/80">
            {baseConflicts.map((c, i) => {
              const dayLabel = DAYS.find((d) => d.num === c.day)?.label || `${c.day}요일`;
              return (
                <li key={i} className="font-medium text-[11px]">
                  <strong className="text-amber-950">{dayLabel} {c.period}교시 [{c.roomName}]</strong>:{" "}
                  <span className="text-amber-900">{c.users.join(" / ")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 등록/수정 폼 & 미리보기 (lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSaveGroup} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>{editingGroupId ? "✏️ 특별실 배정 수정" : "➕ 신규 특별실 배정 추가"}</span>
              </h4>
              {editingGroupId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-gray-500 hover:text-gray-700 underline font-medium"
                >
                  새 배정 작성으로 전환
                </button>
              )}
            </div>

            {/* 특별실명 및 빠른 입력 버튼 */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-700">
                특별실명 (장소) <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {PRESET_ROOMS.map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setRoomName(r)}
                    className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                      roomName === r
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
                    + {r}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="예: 다윗관 (위 버튼을 누르거나 직접 입력)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                required
              />
            </div>

            {/* 설명/라벨 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                배정 설명 (라벨) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 1학년 체육ⅠA 전체"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
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
                  onChange={(e) => setGrade(parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value={1}>1학년</option>
                  <option value={2}>2학년</option>
                  <option value={3}>3학년</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  대상 학급(반) 선택 <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                  {Array.from({ length: 12 }).map((_, idx) => {
                    const cNum = idx + 1;
                    const isSelected = classNums.includes(cNum);
                    return (
                      <button
                        type="button"
                        key={cNum}
                        onClick={() => handleToggleClassNum(cNum)}
                        className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                          isSelected
                            ? "bg-emerald-600 text-white shadow-xs"
                            : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {cNum}반
                      </button>
                    );
                  })}
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
                  placeholder="예: 체육ⅠA (입력 후 추가 버튼 클릭)"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
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
                      className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold px-2.5 py-1 rounded-md"
                    >
                      <span>{sName}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubject(sName)}
                        className="text-emerald-400 hover:text-emerald-700 text-xs font-black"
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
                    className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                  />
                  <span>특정 교시만 한정 지정 (선택 사항 - 과탐 실험 등)</span>
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
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors"
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
                  className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                />
                <span>이 배정 활성화 (체크 해제 시 특별실 점유 중단)</span>
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
                disabled={saving}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
              >
                {saving ? "저장 중..." : editingGroupId ? "💾 수정사항 저장" : "✨ 특별실 배정 등록"}
              </button>
            </div>
          </form>

          {/* 저장 전 미리보기 카드 */}
          {(editingGroupId !== null || roomName.trim() !== "" || subjectNames.length > 0) && (
            <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-emerald-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                    <span>🔍 특별실 점유 미리보기 대조</span>
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    현재 작성 중인 기준에 따라 특별실이 점유되는 수업 위치를 확인합니다.
                  </p>
                </div>

                {/* 반 선택 버튼 */}
                <div className="flex items-center gap-1 bg-emerald-50 p-1 rounded-lg">
                  <span className="text-[11px] font-bold text-emerald-800 px-1.5">미리보기 반:</span>
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
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "text-emerald-700 hover:bg-emerald-100"
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
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-900 leading-relaxed flex items-center justify-between">
                  <div>
                    🏫 <strong>{previewGrid.grade}학년 {previewGrid.classNum}반 시간표 대조</strong> — 하이라이트된 셀에 <strong>[{roomName || "특별실"}]</strong>이 점유 배정됩니다.
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
                              const matchedRoom = previewMatcher(
                                grade,
                                previewClassNum,
                                d.num,
                                period,
                                subjectName
                              );

                              return (
                                <td
                                  key={d.num}
                                  className={`p-2 border-r border-gray-200 transition-colors ${
                                    matchedRoom
                                      ? "bg-emerald-100/90 text-emerald-950 font-black ring-2 ring-emerald-400 ring-inset"
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
                                      {matchedRoom && (
                                        <span className="inline-block text-[9px] bg-emerald-700 text-white font-extrabold px-1.5 py-0.5 rounded mt-0.5">
                                          🏛️ {matchedRoom}
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

        {/* 우측: 등록된 특별실 배정 목록 (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>📋 등록된 특별실 배정 ({groups.length}건)</span>
              </h4>
              <button
                onClick={fetchGroups}
                disabled={loading}
                className="text-xs text-emerald-600 hover:text-emerald-800 font-bold transition-colors"
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
                <p className="font-semibold">등록된 특별실 배정이 없습니다.</p>
                <p className="text-[11px]">좌측 폼에서 신규 배정을 추가해 주세요.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((grp) => {
                  const isEditing = editingGroupId === grp.id;
                  return (
                    <div
                      key={grp.id || `${grp.roomName}-${grp.label}`}
                      className={`p-4 rounded-xl border transition-all space-y-2.5 ${
                        isEditing
                          ? "bg-emerald-50/80 border-emerald-400 shadow-xs"
                          : grp.active !== false
                          ? "bg-white border-gray-200 hover:border-emerald-200"
                          : "bg-gray-50 border-gray-200 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-200">
                              🏛️ {grp.roomName}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700">
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

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleEditClick(grp)}
                            className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors"
                          >
                            수정
                          </button>
                          {grp.id && (
                            <button
                              onClick={() => handleDeleteGroup(grp.id!, grp.label)}
                              disabled={deletingId === grp.id}
                              className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-colors"
                            >
                              {deletingId === grp.id ? "삭제중" : "삭제"}
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
                          <span className="text-emerald-900 font-semibold">
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
    </div>
  );
}
