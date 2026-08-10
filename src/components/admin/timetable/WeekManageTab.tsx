"use client";

import { useEffect, useState } from "react";
import { TimetableWeek, TimetableWeekDay } from "@/lib/timetable/types";

interface WeekManageTabProps {
  activeTermId: string | null;
  periodsPerDay?: number;
  publishWeeksAhead?: number;
  onSettingsChange?: () => void;
}

export default function WeekManageTab({
  activeTermId,
  periodsPerDay = 7,
  publishWeeksAhead = 2,
  onSettingsChange,
}: WeekManageTabProps) {
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 공개 범위 설정 상태 (선택값 1~8주 = 오늘 주 포함 총 주수 / publishWeeksAhead = 선택값 - 1)
  const [selectedTotalWeeks, setSelectedTotalWeeks] = useState(publishWeeksAhead + 1);
  const [savingPublishAhead, setSavingPublishAhead] = useState(false);

  useEffect(() => {
    setSelectedTotalWeeks(publishWeeksAhead + 1);
  }, [publishWeeksAhead]);

  const handleSavePublishAhead = async () => {
    const ahead = selectedTotalWeeks - 1;
    setSavingPublishAhead(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_publish_weeks_ahead",
          publishWeeksAhead: ahead,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`시간표 공개 범위가 오늘 주 포함 총 ${selectedTotalWeeks}주로 설정되었습니다.`);
        if (onSettingsChange) onSettingsChange();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setError(data.error || "공개 범위 설정 저장 실패");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setSavingPublishAhead(false);
    }
  };

  // 등록 모달 상태
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [regStartDate, setRegStartDate] = useState("");
  const [regNote, setRegNote] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // 수정 모달 상태
  const [editingWeek, setEditingWeek] = useState<TimetableWeek | null>(null);
  const [editDays, setEditDays] = useState<TimetableWeekDay[]>([]);
  const [editNote, setEditNote] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchWeeks = async () => {
    if (!activeTermId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "week_list", termId: activeTermId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWeeks(data.weeks || []);
      } else {
        setError(data.error || "주 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeeks();
  }, [activeTermId]);

  // 주 등록 처리
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTermId) {
      setRegError("활성 학기가 설정되어 있지 않습니다.");
      return;
    }
    if (!regStartDate) {
      setRegError("시작 월요일 날짜를 선택해주세요.");
      return;
    }

    const d = new Date(regStartDate);
    if (isNaN(d.getTime())) {
      setRegError("유효한 날짜가 아닙니다.");
      return;
    }

    // 월요일 검증 (d.getDay() === 1)
    // local date format comparison
    const dayOfWeek = d.getUTCDay();
    // UTC 또는 Local 날짜 처리
    const localDay = new Date(regStartDate + "T00:00:00").getDay();
    if (localDay !== 1) {
      setRegError("선택한 날짜가 월요일이 아닙니다. 주의 시작일은 월요일이어야 합니다.");
      return;
    }

    setRegSubmitting(true);
    setRegError(null);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "week_register",
          week: {
            termId: activeTermId,
            startDate: regStartDate,
            note: regNote.trim(),
          },
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`주(${data.week.id})가 성공적으로 등록되었습니다.`);
        setIsRegisterOpen(false);
        setRegStartDate("");
        setRegNote("");
        fetchWeeks();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setRegError(data.error || "주 등록 실패");
      }
    } catch (err: any) {
      setRegError(`네트워크 오류: ${err.message}`);
    } finally {
      setRegSubmitting(false);
    }
  };

  // 주 수정 모달 열기
  const openEditModal = (week: TimetableWeek) => {
    setEditingWeek(week);
    setEditDays(JSON.parse(JSON.stringify(week.days || [])));
    setEditNote(week.note || "");
    setEditError(null);
  };

  // 주 수정 처리
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWeek) return;

    setEditSubmitting(true);
    setEditError(null);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "week_update",
          weekId: editingWeek.id,
          week: {
            days: editDays.map((d) => ({
              day: d.day,
              holiday: d.holiday,
              periodsByGrade: d.periodsByGrade,
            })),
            note: editNote.trim(),
          },
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`주(${editingWeek.id}) 설정이 수정되었습니다.`);
        setEditingWeek(null);
        fetchWeeks();
        setTimeout(() => setSuccessMsg(null), 4000);
      } else {
        setEditError(data.error || "주 수정 실패");
      }
    } catch (err: any) {
      setEditError(`네트워크 오류: ${err.message}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const DAY_NAMES = ["", "월", "화", "수", "목", "금"];

  if (!activeTermId) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900">
        <h3 className="text-base font-bold mb-2">⚠️ 활성 학기 미설정</h3>
        <p className="text-xs text-amber-800">
          주 운영을 관리하려면 먼저 &apos;가져오기 & 학기 관리&apos; 탭에서 정식 학기를 활성화해야 합니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 & 주 등록 버튼 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>🗓️</span>
            <span>주 운영 관리 (휴업일 & 요일별 시수)</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            활성 학기({activeTermId})의 주 단위 운영 일정, 공휴일/재량휴업일 및 단축 수업 시수를 관리합니다.
          </p>
        </div>
        <button
          onClick={() => setIsRegisterOpen(true)}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 self-start md:self-auto"
        >
          <span>➕</span>
          <span>새 주 등록</span>
        </button>
      </div>

      {/* 시간표 공개 범위 설정 카드 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <span>👁️</span>
            <span>교사 시간표 공개 범위 설정</span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            교사 및 학생 화면에 오늘 기준으로 몇 주 앞까지 시간표를 공개할지 설정합니다.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start md:self-auto">
          <div className="flex items-center gap-2">
            <label htmlFor="publish-weeks-select" className="text-xs font-bold text-gray-700 whitespace-nowrap">
              공개 범위:
            </label>
            <select
              id="publish-weeks-select"
              value={selectedTotalWeeks}
              onChange={(e) => setSelectedTotalWeeks(Number(e.target.value))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-bold text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
                <option key={w} value={w}>
                  총 {w}주 ({w === 1 ? "오늘 주만" : `오늘 주 + ${w - 1}주`})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSavePublishAhead}
            disabled={savingPublishAhead || selectedTotalWeeks === publishWeeksAhead + 1}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
              selectedTotalWeeks === publishWeeksAhead + 1
                ? "bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
            }`}
          >
            {savingPublishAhead ? "저장 중..." : "설정 저장"}
          </button>
        </div>
      </div>

      {/* 성공/오류 메시지 */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-4 rounded-xl text-xs font-bold">
          ✅ {successMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-xl text-xs font-bold">
          ⚠️ {error}
        </div>
      )}

      {/* 주 목록 테이블 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-gray-500">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-indigo-600 border-t-transparent mb-2"></div>
            <p>주 목록을 불러오는 중입니다...</p>
          </div>
        ) : weeks.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-500">
            <p className="font-semibold mb-1">등록된 주가 없습니다.</p>
            <p className="text-gray-400">상단의 &apos;새 주 등록&apos; 버튼을 눌러 수업 주간을 등록해 주세요.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
                  <th className="py-3 px-4">주 ID (시작 월요일)</th>
                  <th className="py-3 px-4">운영 요일 및 휴업일 / 시수</th>
                  <th className="py-3 px-4">메모</th>
                  <th className="py-3 px-4">등록자</th>
                  <th className="py-3 px-4 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {weeks.map((w) => {
                  const holidayCount = (w.days || []).filter((d) => d.holiday).length;
                  return (
                    <tr key={w.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-indigo-900">
                        {w.startDate} ({w.id})
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(w.days || []).map((d) => {
                            const reduced =
                              d.periodsByGrade &&
                              Object.values(d.periodsByGrade).some((p) => p < periodsPerDay);
                            return (
                              <span
                                key={d.day}
                                className={`px-2 py-1 rounded text-[11px] font-semibold border ${
                                  d.holiday
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : reduced
                                    ? "bg-amber-50 text-amber-800 border-amber-200"
                                    : "bg-gray-100 text-gray-700 border-gray-200"
                                }`}
                              >
                                {DAY_NAMES[d.day]} ({d.date.slice(5)})
                                {d.holiday ? " [휴업]" : ""}
                                {reduced ? ` [단축]` : ""}
                              </span>
                            );
                          })}
                          {holidayCount > 0 && (
                            <span className="ml-1 text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-bold">
                              휴업 {holidayCount}일
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-gray-600">
                        {w.note || <span className="text-gray-300">-</span>}
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 text-[11px]">
                        {w.createdBy}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => openEditModal(w)}
                          className="px-3 py-1.5 bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-700 rounded-lg text-xs font-bold transition-colors"
                        >
                          ⚙️ 휴업·시수 수정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 새 주 등록 모달 */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>🗓️</span>
                <span>새 주 등록</span>
              </h3>
              <button
                onClick={() => setIsRegisterOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {regError && (
              <div className="bg-red-50 border border-red-200 text-red-900 p-3 rounded-lg text-xs font-bold">
                ⚠️ {regError}
              </div>
            )}

            <form onSubmit={handleRegister} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  시작 월요일 날짜 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={regStartDate}
                  onChange={(e) => setRegStartDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  주의 시작일은 반드시 <strong>월요일</strong>이어야 합니다. 선택된 월요일 날짜가 주 ID(예: 2026-09-07)가 됩니다.
                </p>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">메모 (선택사항)</label>
                <input
                  type="text"
                  value={regNote}
                  onChange={(e) => setRegNote(e.target.value)}
                  placeholder="예: 2학기 1주차 / 개학주"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={regSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {regSubmitting ? "등록 중..." : "주 등록 완료"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 주 수정 모달 (휴업일 & 단축 시수 설정) */}
      {editingWeek && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-xl p-6 space-y-5 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>⚙️</span>
                <span>주 운영 설정 수정 ({editingWeek.id})</span>
              </h3>
              <button
                onClick={() => setEditingWeek(null)}
                className="text-gray-400 hover:text-gray-600 p-1 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-900 p-3 rounded-lg text-xs font-bold">
                ⚠️ {editError}
              </div>
            )}

            <form onSubmit={handleUpdate} className="space-y-5 text-xs">
              <div>
                <label className="block font-bold text-gray-700 mb-1">메모</label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="예: 추석 연휴 주간"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-gray-800 text-xs border-b pb-1">
                  📅 요일별 휴업일 및 학년별 운영 교시 지정
                </h4>

                <div className="space-y-3">
                  {editDays.map((dayItem, idx) => (
                    <div
                      key={dayItem.day}
                      className={`p-3.5 rounded-xl border transition-colors space-y-2 ${
                        dayItem.holiday
                          ? "bg-red-50/50 border-red-200"
                          : "bg-gray-50/60 border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900">
                          {DAY_NAMES[dayItem.day]}요일 ({dayItem.date})
                        </span>
                        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-red-700 select-none">
                          <input
                            type="checkbox"
                            checked={dayItem.holiday || false}
                            onChange={(e) => {
                              const updated = [...editDays];
                              updated[idx].holiday = e.target.checked;
                              setEditDays(updated);
                            }}
                            className="rounded border-gray-300 text-red-600 focus:ring-red-500 h-4 w-4"
                          />
                          <span>🔴 휴업일 (공휴일/재량휴업)</span>
                        </label>
                      </div>

                      {!dayItem.holiday && (
                        <div className="pt-2 border-t border-gray-200/60 flex flex-wrap items-center gap-4 text-gray-700">
                          <span className="font-bold text-[11px] text-gray-600">학년별 최대 교시:</span>
                          {[1, 2, 3].map((g) => {
                            const currentVal = dayItem.periodsByGrade?.[String(g)] ?? periodsPerDay;
                            return (
                              <div key={g} className="flex items-center gap-1">
                                <span className="font-semibold">{g}학년:</span>
                                <select
                                  value={currentVal}
                                  onChange={(e) => {
                                    const updated = [...editDays];
                                    const val = parseInt(e.target.value, 10);
                                    const pbg = { ...(updated[idx].periodsByGrade || {}) };
                                    if (val === periodsPerDay) {
                                      delete pbg[String(g)];
                                    } else {
                                      pbg[String(g)] = val;
                                    }
                                    updated[idx].periodsByGrade =
                                      Object.keys(pbg).length > 0 ? pbg : undefined;
                                    setEditDays(updated);
                                  }}
                                  className="px-2 py-1 border border-gray-300 rounded bg-white font-bold"
                                >
                                  <option value={periodsPerDay}>{periodsPerDay}교시 (정상)</option>
                                  <option value={6}>6교시 (단축)</option>
                                  <option value={5}>5교시 (단축)</option>
                                  <option value={4}>4교시 (단축)</option>
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingWeek(null)}
                  className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-lg"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  {editSubmitting ? "저장 중..." : "설정 저장 완료"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
