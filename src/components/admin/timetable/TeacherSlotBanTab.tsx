"use client";

import { useEffect, useState } from "react";
import { TeacherSlotBan, SimulSlot, SlotBanKind } from "@/lib/timetable/types";

interface TeacherSlotBanTabProps {
  activeTermId?: string | null;
}

export default function TeacherSlotBanTab({ activeTermId }: TeacherSlotBanTabProps) {
  const [rules, setRules] = useState<TeacherSlotBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Form states
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [kind, setKind] = useState<SlotBanKind>("assign");
  const [slots, setSlots] = useState<SimulSlot[]>([]);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(true);

  // Slot selector helper states
  const [slotDay, setSlotDay] = useState<number>(1);
  const [slotPeriod, setSlotPeriod] = useState<number>(1);

  const DAYS = [
    { num: 1, label: "월" },
    { num: 2, label: "화" },
    { num: 3, label: "수" },
    { num: 4, label: "목" },
    { num: 5, label: "금" },
  ];

  const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

  const fetchRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "slot_ban_list", termId: activeTermId }),
      });

      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || data.data || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "특별교사 금지 목록을 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [activeTermId]);

  const resetForm = () => {
    setEditingRuleId(null);
    setTeacherEmail("");
    setTeacherName("");
    setKind("assign");
    setSlots([]);
    setNote("");
    setActive(true);
  };

  const handleToggleSlot = (day: number, period: number) => {
    const exists = slots.some((s) => s.day === day && s.period === period);
    if (exists) {
      setSlots(slots.filter((s) => !(s.day === day && s.period === period)));
    } else {
      setSlots([...slots, { day, period }].sort((a, b) => a.day - b.day || a.period - b.period));
    }
  };

  const handleAddSlotExplicit = () => {
    const exists = slots.some((s) => s.day === slotDay && s.period === slotPeriod);
    if (!exists) {
      setSlots([...slots, { day: slotDay, period: slotPeriod }].sort((a, b) => a.day - b.day || a.period - b.period));
    }
  };

  const handleQuickAddDay = (day: number) => {
    const newSlots = [...slots];
    for (let p = 1; p <= 7; p++) {
      if (!newSlots.some((s) => s.day === day && s.period === p)) {
        newSlots.push({ day, period: p });
      }
    }
    setSlots(newSlots.sort((a, b) => a.day - b.day || a.period - b.period));
  };

  const handleQuickAddPeriod = (period: number) => {
    const newSlots = [...slots];
    for (let d = 1; d <= 5; d++) {
      if (!newSlots.some((s) => s.day === d && s.period === period)) {
        newSlots.push({ day: d, period });
      }
    }
    setSlots(newSlots.sort((a, b) => a.day - b.day || a.period - b.period));
  };

  const handleEditClick = (rule: TeacherSlotBan) => {
    setEditingRuleId(rule.id || null);
    setTeacherEmail(rule.teacherEmail);
    setTeacherName(rule.teacherName || "");
    setKind(rule.kind || "assign");
    setSlots(rule.slots || []);
    setNote(rule.note || "");
    setActive(rule.active !== false);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacherEmail.trim()) {
      alert("교사 이메일을 입력해 주세요.");
      return;
    }
    if (slots.length === 0) {
      alert("금지 요시/교시를 최소 1개 이상 선택해 주세요.");
      return;
    }

    setSaving(true);
    try {
      const payload: TeacherSlotBan = {
        id: editingRuleId || undefined,
        termId: activeTermId || "2026-2",
        teacherEmail: teacherEmail.trim().toLowerCase(),
        teacherName: teacherName.trim() || undefined,
        kind,
        slots,
        note: note.trim() || undefined,
        active,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "slot_ban_save",
          rule: payload,
          ...(editingRuleId ? { ruleId: editingRuleId } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "저장에 실패했습니다.");
      }

      alert("특별교사 금지 규칙이 성공적으로 저장되었습니다.");
      resetForm();
      fetchRules();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string, labelText: string) => {
    if (!confirm(`'${labelText}' 특별교사 금지 규칙을 삭제하시겠습니까?`)) return;
    setDeletingId(ruleId);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "slot_ban_delete", ruleId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "삭제에 실패했습니다.");

      alert("규칙이 삭제되었습니다.");
      if (editingRuleId === ruleId) resetForm();
      fetchRules();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredRules = rules.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.teacherEmail.toLowerCase().includes(q) ||
      (r.teacherName && r.teacherName.toLowerCase().includes(q)) ||
      (r.note && r.note.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 font-sans">
      {/* 안내 박스 */}
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 text-rose-900 text-xs leading-relaxed space-y-1">
        <div className="font-bold text-sm flex items-center gap-1.5 text-rose-900">
          <span>🚫</span>
          <span>특별교사 금지 등록부 (매뉴얼 §6-가)</span>
        </div>
        <p>
          특정 교사의 특정 요일·교시 수업 배정을 금지(<strong>assign</strong>)하거나 솔버 자동 이동을 금지(<strong>move</strong>)합니다.
        </p>
        <div className="flex flex-wrap gap-4 pt-1 font-semibold text-[11px] text-rose-800">
          <span>• 배정금지(assign): 해당 슬롯에 수업 배치 시 검사기 H3 하드 위반</span>
          <span>• 이동금지(move): 솔버가 기본 배정을 다른 슬롯으로 옮기지 못함</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 등록/수정 폼 */}
        <div className="lg:col-span-5 bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>{editingRuleId ? "✏️ 금지 규칙 수정" : "➕ 금지 규칙 등록"}</span>
            </h3>
            {editingRuleId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-gray-500 hover:text-gray-700 underline font-semibold"
              >
                취소하고 신규 등록
              </button>
            )}
          </div>

          <form onSubmit={handleSaveRule} className="space-y-4 text-xs">
            {/* 구분 (Kind) 선택 */}
            <div>
              <label className="block font-bold text-gray-700 mb-1.5">
                금지 속성 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind("assign")}
                  className={`py-2 px-3 rounded-lg font-bold border text-center transition-all ${
                    kind === "assign"
                      ? "bg-rose-600 text-white border-rose-600 shadow-sm"
                      : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  🚫 배정금지 (assign)
                </button>
                <button
                  type="button"
                  onClick={() => setKind("move")}
                  className={`py-2 px-3 rounded-lg font-bold border text-center transition-all ${
                    kind === "move"
                      ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                      : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  🔒 이동금지 (move)
                </button>
              </div>
            </div>

            {/* 교사 이메일 & 이름 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  교사 이메일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={teacherEmail}
                  onChange={(e) => setTeacherEmail(e.target.value)}
                  placeholder="teacher@hmh.or.kr"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-gray-700 mb-1">교사 성명 (선택)</label>
                <input
                  type="text"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="예: 홍길동"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>
            </div>

            {/* 슬롯 선택 (요일 x 교시 그리드 및 퀵 버튼) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-gray-700">
                  금지 슬롯 (요일·교시) <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] font-semibold text-rose-600">선택됨: {slots.length}개</span>
              </div>

              {/* 요일/교시 선택 그리드 */}
              <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 space-y-2">
                <div className="grid grid-cols-6 gap-1 text-center font-bold text-[11px] text-gray-600 border-b border-gray-200 pb-1">
                  <div>교시</div>
                  {DAYS.map((d) => (
                    <div key={d.num}>{d.label}</div>
                  ))}
                </div>
                {[1, 2, 3, 4, 5, 6, 7].map((p) => (
                  <div key={p} className="grid grid-cols-6 gap-1 items-center text-center">
                    <span className="font-bold text-gray-500 text-[11px]">{p}교시</span>
                    {DAYS.map((d) => {
                      const selected = slots.some((s) => s.day === d.num && s.period === p);
                      return (
                        <button
                          key={d.num}
                          type="button"
                          onClick={() => handleToggleSlot(d.num, p)}
                          className={`py-1.5 rounded text-[11px] font-bold transition-all ${
                            selected
                              ? kind === "assign"
                                ? "bg-rose-600 text-white shadow-xs"
                                : "bg-amber-600 text-white shadow-xs"
                              : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {selected ? "✕" : "+"}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* 퀵 추가 버튼들 */}
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="font-bold text-gray-500 self-center mr-1">일괄:</span>
                {DAYS.map((d) => (
                  <button
                    key={d.num}
                    type="button"
                    onClick={() => handleQuickAddDay(d.num)}
                    className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded font-semibold text-gray-700"
                  >
                    {d.label}전체
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleQuickAddPeriod(6)}
                  className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded font-semibold text-gray-700"
                >
                  6교시전체
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickAddPeriod(7)}
                  className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded font-semibold text-gray-700"
                >
                  7교시전체
                </button>
                <button
                  type="button"
                  onClick={() => setSlots([])}
                  className="px-2 py-0.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded font-semibold text-red-700 ml-auto"
                >
                  전체 해제
                </button>
              </div>

              {/* 선택된 슬롯 칩 */}
              {slots.length > 0 && (
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-2 bg-white border border-gray-200 rounded-lg">
                  {slots.map((s, idx) => {
                    const dayLabel = DAYS.find((d) => d.num === s.day)?.label || `${s.day}`;
                    return (
                      <span
                        key={idx}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                          kind === "assign" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {dayLabel}{s.period}교시
                        <button
                          type="button"
                          onClick={() => handleToggleSlot(s.day, s.period)}
                          className="hover:opacity-75 font-black"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 비고 (사유) */}
            <div>
              <label className="block font-bold text-gray-700 mb-1">사유 / 비고 (선택)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 육아시간(7교시), 외부 강의"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
            </div>

            {/* 사용 여부 */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="rule-active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-4 h-4 text-rose-600 rounded border-gray-300 focus:ring-rose-500"
              />
              <label htmlFor="rule-active" className="font-bold text-gray-700 cursor-pointer">
                이 규칙 활성화 (검사기 및 솔버에 즉시 적용)
              </label>
            </div>

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-gray-400 text-white font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 text-xs"
            >
              {saving && <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />}
              <span>{editingRuleId ? "특별교사 금지 규칙 수정 저장" : "특별교사 금지 규칙 등록"}</span>
            </button>
          </form>
        </div>

        {/* 우측: 규칙 목록 */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <span>📋 등록된 특별교사 금지 목록</span>
                  <span className="bg-rose-100 text-rose-800 text-xs px-2 py-0.5 rounded-full font-bold">
                    {filteredRules.length}건
                  </span>
                </h3>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="교사명/이메일/비고 검색..."
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs w-full sm:w-48 focus:ring-2 focus:ring-rose-500"
              />
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs font-semibold text-gray-500">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-rose-600 border-t-transparent mb-2" />
                <p>특별교사 금지 규칙 목록을 불러오는 중입니다...</p>
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 text-red-800 rounded-lg text-xs font-semibold border border-red-200">
                {error}
              </div>
            ) : filteredRules.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                등록된 특별교사 금지 규칙이 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRules.map((rule) => {
                  const sortedSlots = [...(rule.slots || [])].sort((a, b) => a.day - b.day || a.period - b.period);
                  const isAssign = rule.kind === "assign";

                  return (
                    <div
                      key={rule.id}
                      className={`p-4 rounded-xl border transition-all ${
                        rule.active === false
                          ? "bg-gray-50 border-gray-200 opacity-60"
                          : isAssign
                          ? "bg-white border-rose-200 hover:border-rose-300 shadow-xs"
                          : "bg-white border-amber-200 hover:border-amber-300 shadow-xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-black ${
                                isAssign ? "bg-rose-600 text-white" : "bg-amber-600 text-white"
                              }`}
                            >
                              {isAssign ? "🚫 배정금지" : "🔒 이동금지"}
                            </span>
                            <span className="font-bold text-sm text-gray-900">
                              {rule.teacherName ? `${rule.teacherName} (${rule.teacherEmail})` : rule.teacherEmail}
                            </span>
                            {rule.active === false && (
                              <span className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.5 rounded font-bold">
                                비활성
                              </span>
                            )}
                          </div>
                          {rule.note && <p className="text-xs text-gray-600 mt-1">💡 {rule.note}</p>}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 text-xs">
                          <button
                            onClick={() => handleEditClick(rule)}
                            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded"
                          >
                            수정
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteRule(
                                rule.id!,
                                rule.teacherName ? `${rule.teacherName}(${rule.teacherEmail})` : rule.teacherEmail
                              )
                            }
                            disabled={deletingId === rule.id}
                            className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded disabled:opacity-50"
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {/* 슬롯 나열 */}
                      <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap gap-1 text-xs">
                        <span className="font-bold text-gray-500 mr-1 self-center">금지 슬롯 ({sortedSlots.length}개):</span>
                        {sortedSlots.map((s, idx) => {
                          const dayLabel = DAYS.find((d) => d.num === s.day)?.label || `${s.day}`;
                          return (
                            <span
                              key={idx}
                              className={`px-1.5 py-0.5 rounded font-semibold text-[11px] ${
                                isAssign ? "bg-rose-50 text-rose-800 border border-rose-200" : "bg-amber-50 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {dayLabel}{s.period}교시
                            </span>
                          );
                        })}
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
