"use client";

import { useEffect, useState } from "react";
import { TeacherTimetableCell, TimetableWeekDay } from "@/lib/timetable/types";

const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

function getKSTDate(d: Date = new Date()) {
  const kst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  kst.setHours(0, 0, 0, 0);
  return kst;
}

function formatDateLabel(prefix: "오늘" | "내일", dateObj: Date) {
  const month = dateObj.getMonth() + 1;
  const date = dateObj.getDate();
  const dayIndex = (dateObj.getDay() + 6) % 7; // 0=월, 6=일
  const dayName = DAY_NAMES[dayIndex] || "";
  return `${prefix} ${month}/${date}(${dayName})`;
}

export default function TodayTimetableCard() {
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [weekInfo, setWeekInfo] = useState<{ id?: string; startDate?: string; days?: TimetableWeekDay[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimetable = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my" }),
      });
      if (!res.ok) throw new Error("시간표 정보를 불러올 수 없습니다.");
      const json = await res.json();
      if (json.data && Array.isArray(json.data.cells)) {
        setCells(json.data.cells);
      } else {
        setCells([]);
      }
      if (json.week) {
        setWeekInfo(json.week);
      }
    } catch (err: any) {
      setError(err.message || "시간표 조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimetable();
  }, []);

  const renderDaySection = (targetDate: Date) => {
    if (!weekInfo?.startDate) {
      return (
        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">수업 정보를 확인할 수 없습니다</p>
        </div>
      );
    }

    // Parse monday startDate "YYYY-MM-DD"
    const [year, month, day] = weekInfo.startDate.split("-").map(Number);
    const mondayDate = new Date(year, month - 1, day);
    mondayDate.setHours(0, 0, 0, 0);

    const diffDays = Math.round((targetDate.getTime() - mondayDate.getTime()) / (1000 * 60 * 60 * 24));
    const dayNumber = diffDays + 1; // 1=월..5=금

    // 1. 해당 날짜가 이번 주(월~금) 밖 (주말 또는 다른 주)
    if (diffDays < 0 || diffDays > 4) {
      return (
        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 text-center">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">수업일이 아닙니다</p>
        </div>
      );
    }

    // 2. 휴업일 체크
    const dayMeta = weekInfo.days?.find((d) => d.day === dayNumber);
    if (dayMeta?.holiday) {
      return (
        <div className="bg-amber-50/60 dark:bg-amber-900/20 border border-amber-200/80 dark:border-amber-700/50 rounded-xl p-4 text-center">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">휴업일</p>
        </div>
      );
    }

    // 3. 수업 셀 필터링 및 정렬
    const dayCells = cells
      .filter((c) => c.day === dayNumber)
      .sort((a, b) => a.period - b.period);

    if (dayCells.length === 0) {
      return (
        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl p-4 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">수업이 없습니다</p>
        </div>
      );
    }

    // 4. 수업 셀 목록 렌더링
    return (
      <div className="space-y-2">
        {dayCells.map((cell, idx) => {
          const isChanged = !!cell.changed;
          const changeType = cell.changed?.type;
          const changeLabel = changeType === "substitute" ? "보강" : changeType === "move" ? "이동" : "교체";
          const isSimul = !!cell.simul;
          const subject = cell.subjectShort || cell.subjectName;

          return (
            <div
              key={`${cell.period}-${idx}`}
              className={`flex items-center justify-between p-3 rounded-xl border text-sm transition-colors ${
                isChanged
                  ? "bg-sky-100 border-sky-300 text-sky-950 dark:bg-sky-950/40 dark:border-sky-700 dark:text-sky-100"
                  : "bg-white border-slate-200 text-slate-900 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0 w-11 py-1 text-center font-bold text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg">
                  {cell.period}교시
                </span>
                <span className="shrink-0 font-extrabold text-slate-800 dark:text-slate-200">
                  {cell.grade}-{cell.classNum}
                </span>
                <span className="font-semibold truncate">
                  {subject}
                </span>
                {cell.room && (
                  <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500 font-normal">
                    ({cell.room})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {isSimul && (
                  <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" title="동시수업" />
                )}
                {isChanged && (
                  <span className="px-2 py-0.5 text-xs font-extrabold bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100 rounded-md shrink-0">
                    ▲ {changeLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const today = getKSTDate();
  const tomorrow = new Date(today.getTime() + 86400000);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <span>🗓️</span>
          <span>내 시간표</span>
        </h3>
        {weekInfo?.startDate && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800">
            {weekInfo.startDate} 주간
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-slate-400 font-medium animate-pulse flex items-center justify-center gap-2">
          <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
          <span>오늘·내일 시간표를 불러오는 중입니다...</span>
        </div>
      ) : error ? (
        <div className="py-6 text-center space-y-2">
          <p className="text-xs text-red-500 font-medium">{error}</p>
          <button
            onClick={fetchTimetable}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold rounded-lg text-slate-700 dark:text-slate-300 transition-colors"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 오늘 섹션 */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              {formatDateLabel("오늘", today)}
            </h4>
            {renderDaySection(today)}
          </div>

          {/* 내일 섹션 */}
          <div className="space-y-2 pt-1">
            <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 px-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              {formatDateLabel("내일", tomorrow)}
            </h4>
            {renderDaySection(tomorrow)}
          </div>
        </div>
      )}
    </div>
  );
}
