"use client";

import { useEffect, useState } from "react";
import { CalendarEventType, TimetableCalendarEvent } from "@/lib/timetable/types";
import CalendarSubscribeCard from "@/components/calendar/CalendarSubscribeCard";


interface CalendarManageTabProps {
  activeTermId?: string | null;
}

/** KST 기준 오늘 날짜 (YYYY-MM-DD) — 서버/클라이언트 KST 동기화 */
function getTodayKSTISO(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function CalendarManageTab({ activeTermId }: CalendarManageTabProps) {
  const [events, setEvents] = useState<TimetableCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingNeis, setSyncingNeis] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [lastNeisSyncAt, setLastNeisSyncAt] = useState<number | undefined>(undefined);

  // Form Tab State: "short" (시수 조정) vs "event" (행사 추가)
  const [formTab, setFormTab] = useState<"short" | "event">("short");

  // Show past events toggle state
  const [showPastEvents, setShowPastEvents] = useState(false);

  // Form states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<CalendarEventType>("단축수업");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState<string>(getTodayKSTISO());
  const [endDate, setEndDate] = useState<string>(getTodayKSTISO());
  const [note, setNote] = useState("");

  // Target grades (1, 2, 3)
  const [grade1, setGrade1] = useState(true);
  const [grade2, setGrade2] = useState(true);
  const [grade3, setGrade3] = useState(true);

  // Shortened periods for shortcut/exam type
  const [pGrade1, setPGrade1] = useState<number>(4);
  const [pGrade2, setPGrade2] = useState<number>(4);
  const [pGrade3, setPGrade3] = useState<number>(4);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resList, resSettings] = await Promise.all([
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "calendar_list", termId: activeTermId }),
        }),
        fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_settings" }),
        }),
      ]);

      if (resList.ok) {
        const data = await resList.json();
        setEvents(data.events || []);
      } else {
        const errData = await resList.json().catch(() => ({}));
        setError(errData.error || "학사일정을 불러올 수 없습니다.");
      }

      if (resSettings.ok) {
        const sData = await resSettings.json();
        setLastNeisSyncAt(sData.settings?.lastNeisSyncAt);
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

  const handleNeisSync = async () => {
    setSyncingNeis(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "calendar_neis_sync", termId: activeTermId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "나이스 학사일정 동기화에 실패했습니다.");
      }
      alert(data.message || "나이스 학사일정을 최신으로 가져왔습니다.");
      if (data.settings?.lastNeisSyncAt) {
        setLastNeisSyncAt(data.settings.lastNeisSyncAt);
      }
      fetchEvents();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSyncingNeis(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    if (formTab === "short") {
      setType("단축수업");
    } else {
      setType("행사");
    }
    setTitle("");
    const todayStr = getTodayKSTISO();
    setStartDate(todayStr);
    setEndDate(todayStr);
    setNote("");
    setGrade1(true);
    setGrade2(true);
    setGrade3(true);
    setPGrade1(4);
    setPGrade2(4);
    setPGrade3(4);
  };

  const switchFormTab = (tab: "short" | "event") => {
    setFormTab(tab);
    setEditingId(null);
    if (tab === "short") {
      setType("단축수업");
    } else {
      setType("행사");
    }
    setTitle("");
    const todayStr = getTodayKSTISO();
    setStartDate(todayStr);
    setEndDate(todayStr);
    setNote("");
  };

  const handleEditClick = (event: TimetableCalendarEvent) => {
    if (event.source === "neis") {
      alert("나이스에서 자동 수집된 일정은 수정할 수 없습니다.");
      return;
    }
    setEditingId(event.id || null);
    setType(event.type);
    setTitle(event.title || "");
    setStartDate(event.startDate);
    setEndDate(event.endDate || event.startDate);
    setNote(event.note || "");

    if (event.grades) {
      setGrade1(event.grades.includes(1));
      setGrade2(event.grades.includes(2));
      setGrade3(event.grades.includes(3));
    } else {
      setGrade1(true);
      setGrade2(true);
      setGrade3(true);
    }

    if (event.periodsByGrade) {
      setPGrade1(event.periodsByGrade["1"] ?? 4);
      setPGrade2(event.periodsByGrade["2"] ?? 4);
      setPGrade3(event.periodsByGrade["3"] ?? 4);
    }

    if (event.type === "단축수업" || event.type === "고사") {
      setFormTab("short");
    } else {
      setFormTab("event");
    }
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (type === "행사" && !title.trim()) {
      alert("행사 일정에는 일정 이름을 입력해 주세요.");
      return;
    }
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

      const selectedGrades: number[] = [];
      if (grade1) selectedGrades.push(1);
      if (grade2) selectedGrades.push(2);
      if (grade3) selectedGrades.push(3);
      const grades = selectedGrades.length > 0 && selectedGrades.length < 3 ? selectedGrades : undefined;

      const payload: Partial<TimetableCalendarEvent> = {
        termId: activeTermId || "2026-2",
        type,
        title: title.trim() || undefined,
        startDate,
        endDate: finalEndDate,
        grades,
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

  const handleDeleteEvent = async (eventId: string, eventTitle?: string) => {
    if (!confirm(`'${eventTitle || "해당 일정"}' 학사일정을 삭제하시겠습니까?`))
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

  const formatSyncTime = (ms?: number) => {
    if (!ms) return "수집 기록 없음";
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // KST 오늘 날짜 기준 과거/현재(미래) 일정 필터링
  const todayKST = getTodayKSTISO();
  const isPastEvent = (e: TimetableCalendarEvent) => {
    const end = e.endDate || e.startDate;
    return end < todayKST;
  };

  const pastEventsCount = events.filter(isPastEvent).length;
  const displayEvents = showPastEvents ? events : events.filter((e) => !isPastEvent(e));

  return (
    <div className="space-y-6">
      {/* 구독형 학사일정 캘린더 안내 카드 */}
      <CalendarSubscribeCard variant="full" />

      {/* 1. 상단 안내 카드 & 자동 수집 헤더 */}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📅 학사일정 수집 및 시수 조정 관리</span>
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              학사일정은 <strong>나이스(NEIS)에서 매일 자동으로 가져옵니다.</strong> 수동 입력은 시수 조정(단축수업·고사) 또는 미반영 행사 등록 시에 필요합니다.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <span className="block text-[11px] text-gray-500">마지막 가져옴 시각</span>
              <span className="text-xs font-bold text-gray-800">{formatSyncTime(lastNeisSyncAt)}</span>
            </div>
            <button
              onClick={handleNeisSync}
              disabled={syncingNeis}
              className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-colors border border-indigo-200 flex items-center gap-1.5 disabled:opacity-50"
            >
              <span>{syncingNeis ? "🔄 나이스 가져오는 중..." : "🔄 즉시 새로고침"}</span>
            </button>
          </div>
        </div>

        {/* 내장 법정 공휴일 안내 바 */}
        <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-950 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🇰🇷</span>
            <div>
              <span className="font-bold">내장 공휴일 표:</span>{" "}
              <span className="text-indigo-800 font-medium">
                광복절 대체(8/17), 추석 연휴(9/24~9/26), 개천절 대체(10/5), 한글날(10/9), 성탄절(12/25), 신정(1/1), 설날 대체(2/8)
              </span>
            </div>
          </div>
          <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded shrink-0">
            자동 파생 적용
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 직접 등록 폼 (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-4">
          <form
            onSubmit={handleSaveEvent}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5"
          >
            {/* 상단 등록 방식 2개 탭 버튼 */}
            <div className="flex border-b border-gray-200">
              <button
                type="button"
                onClick={() => switchFormTab("short")}
                className={`flex-1 py-2.5 text-xs font-bold border-b-2 text-center transition-all ${
                  formTab === "short"
                    ? "border-indigo-600 text-indigo-700 bg-indigo-50/50"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                ⚙️ 시수 조정 등록
              </button>
              <button
                type="button"
                onClick={() => switchFormTab("event")}
                className={`flex-1 py-2.5 text-xs font-bold border-b-2 text-center transition-all ${
                  formTab === "event"
                    ? "border-indigo-600 text-indigo-700 bg-indigo-50/50"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                🎉 행사 추가
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>{editingId ? "✏️ 학사일정 수정" : formTab === "short" ? "➕ 시수 조정 일정 추가" : "➕ 자체 행사 추가"}</span>
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

            {/* 탭별 💡 안내 문구 */}
            {formTab === "short" ? (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed space-y-1">
                <p className="font-bold flex items-center gap-1">
                  <span>💡 등록 안내</span>
                </p>
                <p>
                  모의고사처럼 정상 시수로 진행되는 시험은 등록 불필요합니다 (나이스 행사로 자동 수집됨).
                  <br />
                  <strong>교시 수가 변경되는 지필평가 및 단축수업만 이곳에 등록</strong>하세요.
                </p>
              </div>
            ) : (
              <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-lg text-xs text-blue-900 leading-relaxed space-y-1">
                <p className="font-bold flex items-center gap-1">
                  <span>💡 등록 안내</span>
                </p>
                <p>
                  나이스에 반영되지 않은 학교 자체 행사(광암제, 체육대회 등)를 추가하면 <strong>전체 학사일정에 함께 포함되어 배포</strong>됩니다.
                </p>
              </div>
            )}

            {/* 일정 종류 (Type) 선택 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                일정 종류 <span className="text-red-500">*</span>
              </label>
              {formTab === "short" ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {(["단축수업", "고사"] as CalendarEventType[]).map((t) => (
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
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {(["행사", "휴업일", "재량휴업"] as CalendarEventType[]).map((t) => (
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
                  ))}
                </div>
              )}
            </div>

            {/* 일정 이름 (행사는 필수, 기타는 선택) */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                일정 이름 {type === "행사" ? <span className="text-red-500">* (필수)</span> : <span className="text-gray-400 font-normal">(선택)</span>}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={type === "행사" ? "예: 광암제, 체육대회, 입학식" : `예: 2학기 1차 지필평가 (${type})`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                required={type === "행사"}
              />
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

            {/* 학년 선택 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                대상 학년
              </label>
              <div className="flex items-center gap-4 text-xs font-semibold text-gray-700 pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grade1}
                    onChange={(e) => setGrade1(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>1학년</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grade2}
                    onChange={(e) => setGrade2(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>2학년</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={grade3}
                    onChange={(e) => setGrade3(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>3학년</span>
                </label>
              </div>
              <span className="text-[11px] text-gray-500 mt-1 block">모두 선택 시 전 학년 대상이 됩니다.</span>
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
                      min={0}
                      max={8}
                      value={pGrade1}
                      onChange={(e) => setPGrade1(parseInt(e.target.value) || 0)}
                      className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-950 bg-white"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-amber-800 mb-1">
                      2학년 (교시)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      value={pGrade2}
                      onChange={(e) => setPGrade2(parseInt(e.target.value) || 0)}
                      className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-950 bg-white"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-semibold text-amber-800 mb-1">
                      3학년 (교시)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      value={pGrade3}
                      onChange={(e) => setPGrade3(parseInt(e.target.value) || 0)}
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
                placeholder="예: 4교시 후 하교 / 지필평가 1일차"
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
              <div>
                <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <span>📋 학사일정 목록 ({displayEvents.length}건{pastEventsCount > 0 && !showPastEvents ? ` / 지난 일정 ${pastEventsCount}건 숨김` : ""})</span>
                </h4>
              </div>
              <button
                onClick={fetchEvents}
                disabled={loading}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors shrink-0"
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
            ) : displayEvents.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400 space-y-2">
                <p className="font-semibold">
                  {events.length > 0 && !showPastEvents
                    ? "진행 예정인 학사일정이 없습니다 (과거 일정만 존재)."
                    : "등록된 학사일정이 없습니다."}
                </p>
                {pastEventsCount > 0 && !showPastEvents && (
                  <button
                    type="button"
                    onClick={() => setShowPastEvents(true)}
                    className="text-xs text-indigo-600 font-bold hover:underline"
                  >
                    ▼ 지난 일정 {pastEventsCount}건 보기
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {displayEvents.map((evt) => {
                  const isEditing = editingId === evt.id;
                  const isMultiDay = evt.endDate && evt.endDate !== evt.startDate;
                  const isNeis = evt.source === "neis";
                  const isPast = isPastEvent(evt);
                  const gradesText =
                    evt.grades && evt.grades.length > 0 && evt.grades.length < 3
                      ? `${evt.grades.join(", ")}학년`
                      : "전 학년";

                  return (
                    <div
                      key={evt.id || evt.startDate}
                      className={`p-4 rounded-xl border transition-all space-y-2 ${
                        isEditing
                          ? "bg-indigo-50/80 border-indigo-400 shadow-xs"
                          : isPast
                          ? "bg-gray-50/70 border-gray-200 opacity-75"
                          : "bg-white border-gray-200 hover:border-indigo-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 나이스 자동 vs 직접 등록 배지 */}
                            {isNeis ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                나이스 자동
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                직접 등록
                              </span>
                            )}

                            {/* 일정 타입 배지 */}
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                evt.type === "행사"
                                  ? "bg-gray-100 text-gray-700 border-gray-300"
                                  : evt.type === "휴업일" || evt.type === "재량휴업"
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : evt.type === "단축수업"
                                  ? "bg-amber-50 text-amber-800 border-amber-200"
                                  : "bg-purple-50 text-purple-800 border-purple-200"
                              }`}
                            >
                              {evt.type}
                            </span>

                            {/* 날짜 */}
                            <span className="font-bold text-xs text-gray-900 flex items-center gap-1">
                              🗓️ {evt.startDate}
                              {isMultiDay ? ` ~ ${evt.endDate}` : ""}
                              {isPast && (
                                <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.2 rounded">
                                  지난 일정
                                </span>
                              )}
                            </span>

                            {/* 대상 학년 */}
                            <span className="text-[11px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                              {gradesText}
                            </span>
                          </div>

                          {/* 일정 이름 */}
                          <div className="pt-0.5">
                            <span className="font-bold text-sm text-gray-900">
                              {evt.title || evt.type}
                            </span>
                          </div>

                          {evt.note && (
                            <p className="text-xs text-gray-600 mt-0.5">
                              {evt.note}
                            </p>
                          )}
                        </div>

                        {/* 작업 버튼 / 나이스 자동 표시 */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isNeis ? (
                            <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                              나이스 자동 관리
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEditClick(evt)}
                                className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors"
                              >
                                수정
                              </button>
                              {evt.id && (
                                <button
                                  onClick={() => handleDeleteEvent(evt.id!, evt.title || evt.note)}
                                  disabled={deletingId === evt.id}
                                  className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-colors"
                                >
                                  {deletingId === evt.id ? "삭제중" : "삭제"}
                                </button>
                              )}
                            </>
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

                {/* 지난 일정 토글 버튼 */}
                {pastEventsCount > 0 && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setShowPastEvents(!showPastEvents)}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 border border-gray-300"
                    >
                      <span>
                        {showPastEvents
                          ? `▲ 지난 일정 ${pastEventsCount}건 숨기기`
                          : `▼ 지난 일정 ${pastEventsCount}건 보기`}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
