"use client";

import { useEffect, useState } from "react";
import { CalendarEventType, TimetableCalendarEvent } from "@/lib/timetable/types";

interface CalendarManageTabProps {
  activeTermId?: string | null;
}

export default function CalendarManageTab({ activeTermId }: CalendarManageTabProps) {
  const [events, setEvents] = useState<TimetableCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<CalendarEventType>("휴업일");
  const [startDate, setStartDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [note, setNote] = useState("");

  // Shortened periods for shortcut/exam type
  const [pGrade1, setPGrade1] = useState<number>(4);
  const [pGrade2, setPGrade2] = useState<number>(4);
  const [pGrade3, setPGrade3] = useState<number>(4);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calendar_list", termId: activeTermId }),
      });

      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "학사일정을 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [activeTermId]);

  const resetForm = () => {
    setEditingId(null);
    setType("휴업일");
    const todayStr = new Date().toISOString().split("T")[0];
    setStartDate(todayStr);
    setEndDate(todayStr);
    setNote("");
    setPGrade1(4);
    setPGrade2(4);
    setPGrade3(4);
  };

  const handleEditClick = (event: TimetableCalendarEvent) => {
    setEditingId(event.id || null);
    setType(event.type);
    setStartDate(event.startDate);
    setEndDate(event.endDate || event.startDate);
    setNote(event.note || "");
    if (event.periodsByGrade) {
      setPGrade1(event.periodsByGrade["1"] ?? 4);
      setPGrade2(event.periodsByGrade["2"] ?? 4);
      setPGrade3(event.periodsByGrade["3"] ?? 4);
    }
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate) {
      alert("시작일을 선택해 주세요.");
      return;
    }
    const finalEndDate = endDate || startDate;
    if (finalEndDate < startDate) {
      alert("종료일은 시작일보다 이전일 수 없습니다.");
      return;
    }

    setSaving(true);
    try {
      const periodsByGrade =
        type === "단축수업" || type === "고사"
          ? { "1": pGrade1, "2": pGrade2, "3": pGrade3 }
          : undefined;

      const payload: Partial<TimetableCalendarEvent> = {
        termId: activeTermId || "2026-2",
        type,
        startDate,
        endDate: finalEndDate,
        periodsByGrade,
        note: note.trim() || undefined,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "calendar_save",
          calendarEventId: editingId || undefined,
          calendarEvent: payload,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "저장에 실패했습니다.");
      }

      alert("학사일정이 성공적으로 저장되었습니다.");
      resetForm();
      fetchEvents();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: string, eventNote?: string) => {
    if (!confirm(`'${eventNote || "해당 일정"}' 학사일정을 삭제하시겠습니까?`))
      return;
    setDeletingId(eventId);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calendar_delete", calendarEventId: eventId }),
      });
      const data = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error || "삭제에 실패했습니다.");

      alert("일정이 삭제되었습니다.");
      if (editingId === eventId) resetForm();
      fetchEvents();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. 상단 안내 카드 및 내장 공휴일 표 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📅 학사일정 등록 및 주차 자동 파생 관리</span>
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              학사일정을 미리 등록하면 매주 주(Week) 문서를 일일이 수동 등록할 필요 없이 <strong>자동으로 휴업일·단축수업 주차가 파생</strong>됩니다.<br />
              법정 공휴일(광복절 대체공휴일 8/17, 추석, 개천절, 한글날 등)은 <strong>시스템 정적 표로 자동 반영</strong>되므로 별도 입력이 필요 없습니다.
            </p>
          </div>
        </div>

        {/* 내장 법정 공휴일 안내 바 */}
        <div className="p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-950 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🇰🇷</span>
            <div>
              <span className="font-bold">2026-2학기 내장 공휴일:</span>{" "}
              <span className="text-indigo-800 font-medium">
                광복절 대체공휴일(8/17 월), 추석 연휴(9/24~9/26), 개천절 대체(10/5 월), 한글날(10/9 금), 성탄절(12/25 금), 신정(1/1 금), 설날 대체(2/8 월)
              </span>
            </div>
          </div>
          <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded shrink-0">
            자동 적용됨
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 학사일정 등록/수정 폼 (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-6">
          <form
            onSubmit={handleSaveEvent}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>{editingId ? "✏️ 학사일정 수정" : "➕ 학사일정 추가"}</span>
              </h4>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-gray-500 hover:text-gray-700 underline font-medium"
                >
                  새 일정 작성
                </button>
              )}
            </div>

            {/* 구 분 (Type) */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                일정 구분 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(["휴업일", "재량휴업", "단축수업", "고사"] as CalendarEventType[]).map(
                  (t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                        type === t
                          ? "bg-indigo-600 text-white border-indigo-700 shadow-xs"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {t}
                    </button>
                  )
                )}
              </div>
            </div>

            {/* 날짜 범위 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  시작일 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  종료일
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white"
                />
              </div>
            </div>

            {/* 단축수업/고사 시 학년별 시수 지정 */}
            {(type === "단축수업" || type === "고사") && (
              <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2.5">
                <label className="block text-xs font-bold text-amber-900">
                  ⚙️ 학년별 수업 시수 지정 ({type})
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="block text-[11px] font-semibold text-amber-800 mb-1">
                      1학년 (교시)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={pGrade1}
                      onChange={(e) => setPGrade1(parseInt(e.target.value) || 4)}
                      className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-950 bg-white"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-amber-800 mb-1">
                      2학년 (교시)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={pGrade2}
                      onChange={(e) => setPGrade2(parseInt(e.target.value) || 4)}
                      className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-950 bg-white"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-amber-800 mb-1">
                      3학년 (교시)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={pGrade3}
                      onChange={(e) => setPGrade3(parseInt(e.target.value) || 4)}
                      className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-950 bg-white"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 비 고 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                비고 / 메모
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 개학식 및 청소 / 중간고사 1일차"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            {/* 저장 버튼 */}
            <div className="flex justify-end gap-2 pt-2">
              {editingId && (
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
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
              >
                {saving ? "저장 중..." : editingId ? "💾 일정 수정 저장" : "✨ 학사일정 등록"}
              </button>
            </div>
          </form>
        </div>

        {/* 우측: 등록된 학사일정 목록 (lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>📋 등록된 학사일정 ({events.length}건)</span>
              </h4>
              <button
                onClick={fetchEvents}
                disabled={loading}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
              >
                🔄 새로고침
              </button>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs text-gray-500 font-semibold">
                일정 목록을 불러오는 중입니다...
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {error}
              </div>
            ) : events.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 space-y-1">
                <p className="font-semibold">등록된 학사일정이 없습니다.</p>
                <p className="text-[11px]">좌측 폼에서 일정(재량휴업, 단축수업, 고사 등)을 추가해 주세요.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((evt) => {
                  const isEditing = editingId === evt.id;
                  const isMultiDay = evt.endDate && evt.endDate !== evt.startDate;
                  return (
                    <div
                      key={evt.id || evt.startDate}
                      className={`p-4 rounded-xl border transition-all space-y-2 ${
                        isEditing
                          ? "bg-indigo-50/80 border-indigo-400 shadow-xs"
                          : "bg-white border-gray-200 hover:border-indigo-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                evt.type === "휴업일" || evt.type === "재량휴업"
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : evt.type === "단축수업"
                                  ? "bg-amber-50 text-amber-800 border-amber-200"
                                  : "bg-purple-50 text-purple-800 border-purple-200"
                              }`}
                            >
                              {evt.type}
                            </span>
                            <span className="font-bold text-xs text-gray-900">
                              🗓️ {evt.startDate}
                              {isMultiDay ? ` ~ ${evt.endDate}` : ""}
                            </span>
                          </div>

                          {evt.note && (
                            <p className="text-xs text-gray-700 font-semibold mt-0.5">
                              {evt.note}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleEditClick(evt)}
                            className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors"
                          >
                            수정
                          </button>
                          {evt.id && (
                            <button
                              onClick={() => handleDeleteEvent(evt.id!, evt.note)}
                              disabled={deletingId === evt.id}
                              className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-colors"
                            >
                              {deletingId === evt.id ? "삭제중" : "삭제"}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 시수 정보 표시 (단축/고사) */}
                      {evt.periodsByGrade && (
                        <div className="text-[11px] text-amber-900 bg-amber-50 p-2 rounded-lg border border-amber-100 flex items-center gap-3">
                          <span className="font-bold">학년별 시수:</span>
                          <span>1학년: {evt.periodsByGrade["1"]}교시</span>
                          <span>2학년: {evt.periodsByGrade["2"]}교시</span>
                          <span>3학년: {evt.periodsByGrade["3"]}교시</span>
                        </div>
                      )}
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
