"use client";

import { useEffect, useState } from "react";
import { ClassGrid } from "@/lib/timetable/types";

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

export default function StudentTimetableCard() {
  const [classGrid, setClassGrid] = useState<ClassGrid | null>(null);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [weekMeta, setWeekMeta] = useState<{ id: string; startDate: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const DAYS = [
    { num: 1, label: "월" },
    { num: 2, label: "화" },
    { num: 3, label: "수" },
    { num: 4, label: "목" },
    { num: 5, label: "금" },
  ];

  // 오늘 요일 (월=1..금=5, 토/일=1)
  const todayDayNum = (() => {
    const day = new Date().getDay();
    if (day >= 1 && day <= 5) return day;
    return 1;
  })();

  const [activeDay, setActiveDay] = useState<number>(todayDayNum);

  const fetchStudentTimetable = async () => {
    setLoading(true);
    setError(null);

    try {
      // 학생 API는 서버가 학번 기반으로 본인 반을 강제 도출하므로 action만 전달
      // weekId 미지정 시 서버가 현재 주(currentWeek)를 찾아 주간 합성본으로 반환함
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "class" }),
      });

      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        setWeekMeta(result.week || null);
        if (result.data && result.data.grade > 0) {
          setClassGrid(result.data);
        } else {
          setClassGrid(null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudentTimetable();
  }, []);

  const getLessonsForSlot = (day: number, period: number) => {
    if (!classGrid || !Array.isArray(classGrid.cells)) return [];
    const cell = classGrid.cells.find((c) => c.day === day && c.period === period);
    return cell ? cell.lessons || [] : [];
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs text-center space-y-2">
        <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-indigo-600 border-t-transparent"></div>
        <p className="text-xs text-slate-500 font-semibold">우리 반 주간 시간표를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error || !classGrid) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span>📅 우리 반 시간표</span>
        </h3>
        <p className="text-xs text-slate-500">
          {error || "등록되었거나 활성화된 시간표가 없습니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
              {termMeta?.name || "기초시간표"}
            </span>
            {weekMeta && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                🗓️ {weekMeta.startDate} 주간 합성본
              </span>
            )}
          </div>
          <h3 className="text-lg font-black text-slate-900 mt-1 flex items-center gap-2">
            <span>📅 {classGrid.grade}학년 {classGrid.classNum}반 시간표</span>
          </h3>
        </div>

        {/* 요일 선택 필터 */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
          {DAYS.map((d) => (
            <button
              key={d.num}
              onClick={() => setActiveDay(d.num)}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                activeDay === d.num
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* 일별/주간 시간표 표시 목록 */}
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, pIdx) => {
          const period = pIdx + 1;
          const lessons = getLessonsForSlot(activeDay, period);
          const hasLessons = lessons.length > 0;

          return (
            <div
              key={period}
              className={`p-3 rounded-xl border transition-all flex items-center justify-between ${
                hasLessons
                  ? "bg-slate-50/80 border-slate-200 hover:border-indigo-300"
                  : "bg-white border-slate-100 opacity-60"
              }`}
            >
              <div className="flex items-center gap-3 w-full">
                <span className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-900 font-black text-xs flex items-center justify-center shrink-0">
                  {period}교시
                </span>

                {hasLessons ? (
                  <div className="space-y-1 w-full">
                    {lessons.map((lesson: any, idx) => {
                      const isChanged = !!lesson.changed;
                      const changedType = lesson.changed?.type;
                      const origin = lesson.changed?.origin;

                      return (
                        <div key={idx} className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold text-sm ${isChanged ? "text-red-700" : "text-slate-900"}`}>
                              {lesson.subjectName}
                            </span>
                            <span className="text-xs text-slate-500">
                              ({lesson.teachers?.map((t: any) => t.name).join(", ")})
                            </span>
                            {lesson.room && (
                              <span className="text-[10px] bg-slate-200/60 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                                📍 {lesson.room}
                              </span>
                            )}
                          </div>

                          {/* 주간 변경 오버레이 마커 */}
                          {isChanged && (
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200"
                              title={
                                origin
                                  ? `${DAY_LABEL[origin.day]}요일 ${origin.period}교시에서 이동`
                                  : "수업 변경"
                              }
                            >
                              ▲ {changedType === "swap" ? "맞교환" : "보강"}
                              {origin && ` (${DAY_LABEL[origin.day]}${origin.period}에서 이동)`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 font-light">수업 없음 (공강)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
