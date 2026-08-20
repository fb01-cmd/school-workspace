"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { TeacherSlotBan, SimulSlot, SlotBanKind } from "@/lib/timetable/types";
import type { AiFormalizeResult } from "@/lib/timetable/ai";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import RegistryUnlockModal from "./RegistryUnlockModal";

interface TeacherSlotBanTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
  isOperating?: boolean;
  isArchived?: boolean;
}

export default function TeacherSlotBanTab({
  activeTermId,
  periodsPerDay = 7,
  isOperating = false,
  isArchived = false,
}: TeacherSlotBanTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  const [rules, setRules] = useState<TeacherSlotBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 잠금 해제 사유 모달 상태
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<((reason: string) => Promise<void>) | null>(null);

  // Form states
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [teacherSearchTerm, setTeacherSearchTerm] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [kind, setKind] = useState<SlotBanKind>("assign");
  const [slots, setSlots] = useState<SimulSlot[]>([]);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(true);

  // E-2 AI formalize (말하기 입력) states
  const [aiFormalizeOpen, setAiFormalizeOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiFormalizing, setAiFormalizing] = useState(false);
  const [aiFormalizeError, setAiFormalizeError] = useState<string | null>(null);
  const [aiFormalizeResult, setAiFormalizeResult] = useState<AiFormalizeResult | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [savingFormalizeEntries, setSavingFormalizeEntries] = useState(false);

  const DAYS = [
    { num: 1, label: "월" },
    { num: 2, label: "화" },
    { num: 3, label: "수" },
    { num: 4, label: "목" },
    { num: 5, label: "금" },
  ];

  const maxPeriod = Math.max(7, periodsPerDay || 7);
  const PERIOD_LIST = Array.from({ length: maxPeriod }, (_, i) => i + 1);

  const fetchRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "slot_ban_list", termId: activeTermId || undefined }),
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
    setTeacherSearchTerm("");
    setTeacherEmail("");
    setTeacherName("");
    setKind("assign");
    setSlots([]);
    setNote("");
    setActive(true);
  };

  const handleSelectTeacher = (email: string, name?: string) => {
    setTeacherEmail(email);
    setTeacherName(name || "");
    setTeacherSearchTerm(name ? `${name} (${email})` : email);
  };

  const handleToggleSlot = (day: number, period: number) => {
    const exists = slots.some((s) => s.day === day && s.period === period);
    if (exists) {
      setSlots(slots.filter((s) => !(s.day === day && s.period === period)));
    } else {
      setSlots([...slots, { day, period }].sort((a, b) => a.day - b.day || a.period - b.period));
    }
  };

  const handleQuickAddDay = (day: number) => {
    const newSlots = [...slots];
    for (let p = 1; p <= maxPeriod; p++) {
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
    setTeacherSearchTerm(rule.teacherName ? `${rule.teacherName} (${rule.teacherEmail})` : rule.teacherEmail);
    setKind(rule.kind || "assign");
    setSlots(rule.slots || []);
    setNote(rule.note || "");
    setActive(rule.active !== false);
  };

  const handleSaveRule = async (e: React.FormEvent, reasonOverride?: string) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    const finalEmail = teacherEmail.trim();
    if (!finalEmail) {
      alert("교사 검색에서 대상 교사를 반드시 선택해 주세요.");
      return;
    }
    if (slots.length === 0) {
      alert("금지 요일/교시를 최소 1개 이상 선택해 주세요.");
      return;
    }

    const unlockReason = reasonOverride;

    setSaving(true);
    try {
      const payload: TeacherSlotBan = {
        id: editingRuleId || undefined,
        termId: activeTermId || "",
        teacherEmail: finalEmail.toLowerCase(),
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
          await handleSaveRule(e, reason);
        });
        setUnlockModalOpen(true);
        return;
      }

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

  const handleDeleteRule = async (ruleId: string, labelText: string, reasonOverride?: string) => {
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    if (!reasonOverride && !confirm(`'${labelText}' 특별교사 금지 규칙을 삭제하시겠습니까?`)) return;
    setDeletingId(ruleId);
    const unlockReason = reasonOverride;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "slot_ban_delete",
          ruleId,
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
          await handleDeleteRule(ruleId, labelText, reason);
        });
        setUnlockModalOpen(true);
        return;
      }

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

  const handleRunAiFormalize = async () => {
    if (!aiText.trim()) return;
    setAiFormalizing(true);
    setAiFormalizeError(null);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_formalize",
          aiText: aiText.trim(),
          termId: activeTermId || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.enabled === false) {
          setAiEnabled(false);
          return;
        }
        setAiFormalizeResult(data.proposal || null);
      } else {
        setAiFormalizeError(data.error || "자연어 해석에 실패했습니다. 성명을 정확히 입력하셨는지 확인해 보세요.");
      }
    } catch (err: any) {
      setAiFormalizeError(`네트워크 오류: ${err.message}`);
    } finally {
      setAiFormalizing(false);
    }
  };

  const handleSaveFormalizeEntries = async (reasonOverride?: string) => {
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    if (!aiFormalizeResult || aiFormalizeResult.entries.length === 0) return;
    setSavingFormalizeEntries(true);
    let successCount = 0;
    let failError: string | null = null;
    let locked423 = false;
    let lockedTermState: "operating" | "archived" = "operating";
    // 부분 실패 시 실패 항목만 다이얼로그에 남긴다 — 전체 재시도는 성공분을 중복 등록시킴
    const failedEntries: typeof aiFormalizeResult.entries = [];
    const unlockReason = reasonOverride;

    for (const entry of aiFormalizeResult.entries) {
      try {
        const payload: TeacherSlotBan = {
          termId: activeTermId || "",
          teacherEmail: entry.teacherEmail.toLowerCase(),
          teacherName: entry.teacherName,
          kind: entry.kind,
          slots: entry.slots,
          note: "AI 말로 입력 반영",
          active: true,
        };

        const res = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "slot_ban_save",
            rule: payload,
            ...(unlockReason ? { unlockReason } : {}),
          }),
        });

        const data = await res.json();
        if (res.status === 423 || data.code === "registry-locked") {
          locked423 = true;
          lockedTermState = data.termState || "operating";
          failError = data.error;
          failedEntries.push(entry);
          continue;
        }

        if (res.ok && data.success) {
          successCount++;
        } else {
          failError = data.error || "규칙 저장에 실패했습니다.";
          failedEntries.push(entry);
        }
      } catch (err: any) {
        failError = err.message;
        failedEntries.push(entry);
      }
    }

    setSavingFormalizeEntries(false);

    if (locked423) {
      if (lockedTermState === "archived") {
        alert(failError || "지난 학기의 편성 등록 내용은 열람만 가능합니다.");
        return;
      }
      setPendingAction(() => async (reason: string) => {
        await handleSaveFormalizeEntries(reason);
      });
      setUnlockModalOpen(true);
      return;
    }

    if (failedEntries.length === 0) {
      alert(`${successCount}건의 특별교사 금지 규칙이 등록부에 저장되었습니다.`);
      setAiFormalizeResult(null);
      setAiText("");
      fetchRules();
    } else {
      // 부분 실패 보고 + 실패 항목만 남김 — 성공분 중복 재등록 방지, 실패 사실 무음 방지
      alert(
        `${successCount}건 저장 / ${failedEntries.length}건 실패${failError ? `: ${failError}` : ""}\n실패한 항목만 확인 창에 남겨두었습니다. 다시 시도하거나 취소하세요.`
      );
      setAiFormalizeResult({ ...aiFormalizeResult, entries: failedEntries });
      if (successCount > 0) fetchRules();
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* ㉯ 계열 탭 상단 안내 (스펙 §4 확정 문안) */}
      {isOperating && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 font-medium flex items-center gap-2 shadow-xs">
          <span className="text-base">ℹ️</span>
          <span>이 등록 내용은 시간표를 새로 짤 때 쓰입니다. 운영 중인 시간표에는 영향을 주지 않습니다.</span>
        </div>
      )}

      {/* 안내 박스 - 눈높이 문구로 정리 (개발용어/코드 오기 제거) */}
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 text-rose-900 text-xs leading-relaxed space-y-1">
        <div className="font-bold text-sm flex items-center gap-1.5 text-rose-900">
          <span>🚫</span>
          <span>특별교사 금지 등록부</span>
        </div>
        <p>
          특정 교사의 특정 요일·교시 수업 배정을 금지하거나 지정된 위치에 고정합니다.
        </p>
        <div className="flex flex-wrap gap-4 pt-1 font-semibold text-[11px] text-rose-800">
          <span>• 배정금지: 이 교시에는 수업을 아예 배치하지 않음 (위반 시 자동 검사에서 문제로 표시됩니다)</span>
          <span>• 이동금지: 시간표 자동 조정 시 지금 위치를 다른 교시로 옮기지 못하게 고정함</span>
        </div>
      </div>

      {/* AI 미설정 시 상자가 통째로 사라지면 고장으로 오해한다 — 사라진 자리에 이유를 한 줄 남긴다 */}
      {aiEnabled === false && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-xs text-gray-600 font-medium">
          🗣️ 말로 금지 규칙 입력하기 — AI 도움 기능이 아직 설정되지 않아 사용할 수 없습니다.
        </div>
      )}

      {/* ── AI 말로 입력하기 (E-2) 접힘 입력창 ── */}
      {aiEnabled !== false && (
        <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAiFormalizeOpen(!aiFormalizeOpen)}
              className="flex items-center gap-2 text-xs font-bold text-violet-900 hover:text-violet-700 transition-colors"
            >
              <span>🗣️ 말로 금지 규칙 입력하기 (AI 도움)</span>
              <span className="text-xs bg-violet-200 text-violet-800 px-2 py-0.5 rounded-full font-semibold">
                {aiFormalizeOpen ? "접기 ▲" : "펼치기 ▼"}
              </span>
            </button>
            <span className="text-[11px] text-violet-700 font-medium hidden sm:inline">
              💡 AI가 작성한 참고 의견입니다 — 반영 전 직접 확인하세요
            </span>
          </div>

          {aiFormalizeOpen && (
            <div className="space-y-3 pt-1 border-t border-violet-100">
              <p className="text-xs text-violet-800">
                원하는 금지/고정 규칙을 자연어로 입력하세요. 교사 성명을 정확히 입력해 주세요. (예: &quot;홍길동 선생님은 월요일 1교시 배정 금지&quot;)
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !aiFormalizing) {
                      e.preventDefault();
                      handleRunAiFormalize();
                    }
                  }}
                  placeholder="예: 홍길동 교사 금요일 전일 배정 금지, 김철수 교사 수요일 1~2교시 이동 금지"
                  className="flex-1 border border-violet-300 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 font-medium"
                />
                <button
                  type="button"
                  onClick={handleRunAiFormalize}
                  disabled={aiFormalizing || !aiText.trim()}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shadow-xs flex items-center justify-center gap-1.5 shrink-0"
                >
                  {aiFormalizing ? (
                    <>
                      <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                      <span>해석 중...</span>
                    </>
                  ) : (
                    <span>🤖 규칙 해석하기</span>
                  )}
                </button>
              </div>

              {aiFormalizeError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  {aiFormalizeError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 등록/수정 폼 */}
        <div className="lg:col-span-5 bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <span>{editingRuleId ? "✏️ 금지 규칙 수정" : "➕ 금지 규칙 등록"}</span>
              {isOperating && (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                  🔒 운영 학기 잠김
                </span>
              )}
              {isArchived && (
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                  🔒 열람 전용
                </span>
              )}
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
            {/* 구분 선택 */}
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
                  🚫 배정금지 (수업 배치 불가)
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
                  🔒 이동금지 (위치 고정)
                </button>
              </div>
            </div>

            {/* 교사 검색 AutocompleteInput (자동완성 규칙 4) */}
            <div className="space-y-1.5">
              <label className="block font-bold text-gray-700">
                대상 교사 검색 및 선택 <span className="text-red-500">*</span>
              </label>
              <AutocompleteInput
                value={teacherSearchTerm}
                onChange={(val) => {
                  setTeacherSearchTerm(val);
                  // onChange에서는 선택값을 절대 승격하지 않는다 (선택 강제 원칙 — AGENTS 규칙 4)
                  // 검색어 변경 시 이전 선택값 무효화
                  setTeacherEmail("");
                  setTeacherName("");
                }}
                onSelect={handleSelectTeacher}
                placeholder="교사 성명 또는 이메일 검색..."
                type="user"
                domain={domain}
              />
              {teacherEmail && (
                <div className="flex items-center justify-between p-2 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs font-semibold">
                  <span>
                    ✅ 선택된 교사: <strong>{teacherName || teacherEmail}</strong> ({teacherEmail})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTeacherEmail("");
                      setTeacherName("");
                      setTeacherSearchTerm("");
                    }}
                    className="text-rose-700 hover:text-rose-950 font-bold ml-2 underline"
                  >
                    변경
                  </button>
                </div>
              )}
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
                {PERIOD_LIST.map((p) => (
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
                이 규칙 활성화 (검사기 및 자동 조정에 적용)
              </label>
            </div>

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={saving || isArchived}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-gray-400 text-white font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 text-xs"
            >
              {saving && <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />}
              {isOperating && <span>🔒</span>}
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
                              <span className="bg-gray-200 text-gray-700 text-xs px-1.5 py-0.5 rounded font-bold">
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
                            disabled={deletingId === rule.id || isArchived}
                            className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded disabled:opacity-50 flex items-center gap-1"
                          >
                            {isOperating && <span>🔒</span>}
                            <span>삭제</span>
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

      {/* ── E-2 AI 해석 확인 다이얼로그 ── */}
      {aiFormalizeResult && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>🤖 금지 규칙 해석 결과 확인</span>
              </h3>
              <button
                type="button"
                onClick={() => setAiFormalizeResult(null)}
                className="text-gray-400 font-bold hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {/* AI 표식 상단 */}
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-2.5 text-center text-xs font-semibold text-violet-800">
              💡 AI가 작성한 참고 의견입니다 — 반영 전 내용과 대상을 직접 확인하세요.
            </div>

            {/* 해석 요약 */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-1.5">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">AI 해석 요약</span>
              <p className="text-xs font-bold text-gray-900 leading-relaxed">
                {aiFormalizeResult.interpretation}
              </p>
            </div>

            {/* 경고 사항 (있을 경우) */}
            {aiFormalizeResult.warnings && aiFormalizeResult.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1">
                  <span>⚠️ 주의 안내</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  {aiFormalizeResult.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 해석된 규칙 목록 */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                등록 예정 규칙 ({aiFormalizeResult.entries.length}건)
              </span>
              {aiFormalizeResult.entries.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
                  해석된 금지 규칙 항목이 없습니다. 성명과 요일·교시를 더 명확하게 입력해 보세요.
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {aiFormalizeResult.entries.map((entry, idx) => (
                    <div key={idx} className="p-3 border border-gray-200 rounded-lg bg-white text-xs space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-gray-900">
                          {entry.teacherName ? `${entry.teacherName} (${entry.teacherEmail})` : entry.teacherEmail}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            entry.kind === "assign"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {entry.kind === "assign" ? "배정금지" : "이동금지"}
                        </span>
                      </div>
                      <div className="text-gray-600 font-medium text-[11px]">
                        금지 요일/교시:{" "}
                        <span className="font-bold text-indigo-700">
                          {entry.slots
                            .map((s) => `${DAYS.find((d) => d.num === s.day)?.label || s.day}${s.period}교시`)
                            .join(", ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI 표식 하단 & 버튼 */}
            <div className="space-y-3 pt-2">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAiFormalizeResult(null)}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveFormalizeEntries()}
                  disabled={savingFormalizeEntries || aiFormalizeResult.entries.length === 0 || isArchived}
                  className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  {savingFormalizeEntries ? (
                    <>
                      <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                      <span>저장 중...</span>
                    </>
                  ) : (
                    <>
                      {isOperating && <span>🔒</span>}
                      <span>💾 규칙 등록부에 저장</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-400 text-center">
                💡 AI가 작성한 참고 의견입니다 — 반영 전 내용을 확인하셨습니까?
              </p>
            </div>
          </div>
        </div>
      )}

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
        loading={saving || deletingId !== null || savingFormalizeEntries}
      />
    </div>
  );
}
