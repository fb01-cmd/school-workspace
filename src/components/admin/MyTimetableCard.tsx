"use client";

import { useEffect, useState } from "react";
import { TeacherTimetableCell } from "@/lib/timetable/types";

interface MyTimetableCardProps {
  onNavigateToMyTimetable?: () => void;
}

const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

export default function MyTimetableCard({ onNavigateToMyTimetable }: MyTimetableCardProps) {
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [weekInfo, setWeekInfo] = useState<{ id?: string; startDate?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadMyTimetable() {
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
        if (isMounted) {
          if (json.data && Array.isArray(json.data.cells)) {
            setCells(json.data.cells);
          }
          if (json.week) {
            setWeekInfo(json.week);
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || "시간표 조회 실패");
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadMyTimetable();
    return () => {
      isMounted = false;
    };
  }, []);

  const getCellForSlot = (day: number, period: number) => {
    return cells.filter((c) => c.day === day && c.period === period);
  };

  const totalHours = cells.length;

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-800">이번 주 내 시간표</h3>
              {weekInfo?.startDate && (
                <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {weekInfo.startDate} 주간
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              이번 주 총 <span className="font-semibold text-slate-700">{totalHours}시간</span> 수업이 배정되어 있습니다.
            </p>
          </div>
          <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600 text-xl">
            🗓️
          </span>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-10 text-center text-xs text-indigo-500 font-medium animate-pulse flex items-center justify-center gap-2">
            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
            <span>이번 주 내 시간표를 불러오는 중입니다...</span>
          </div>
        ) : error ? (
          <div className="py-6 text-center text-xs text-red-600 bg-red-50 rounded-lg border border-red-100 p-4">
            <p className="font-semibold">{error}</p>
            {onNavigateToMyTimetable && (
              <button
                type="button"
                onClick={onNavigateToMyTimetable}
                className="mt-2 text-xs text-indigo-600 hover:underline font-bold cursor-pointer"
              >
                "내 시간표" 메뉴로 직접 이동하기 →
              </button>
            )}
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-x-auto text-xs">
            <table className="w-full border-collapse min-w-[500px] text-center">
              <thead>
                <tr className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                  <th className="py-2 px-1 w-12 border-r border-gray-200 bg-gray-200/60 text-[11px]">교시</th>
                  {DAYS.map((d) => (
                    <th key={d.num} className="py-2 px-1 text-[11px]">
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {Array.from({ length: 7 }).map((_, pIdx) => {
                  const period = pIdx + 1;
                  return (
                    <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                      <td className="py-2 px-1 border-r border-gray-200 font-bold text-gray-500 bg-gray-50 text-[11px]">
                        {period}
                      </td>
                      {DAYS.map((d) => {
                        const matched = getCellForSlot(d.num, period);
                        const hasLesson = matched.length > 0;
                        return (
                          <td
                            key={d.num}
                            onClick={onNavigateToMyTimetable}
                            className={`p-1 border-r border-gray-100 text-center align-top cursor-pointer transition-colors ${
                              hasLesson ? "bg-indigo-50/40 hover:bg-indigo-100/60" : "hover:bg-gray-50"
                            }`}
                          >
                            {hasLesson ? (
                              <div className="space-y-1">
                                {matched.map((cell, cIdx) => {
                                  const subj = cell.subjectShort || cell.subjectName || "";
                                  const isChanged = !!cell.changed;
                                  return (
                                    <div
                                      key={cIdx}
                                      className={`p-1.5 rounded-md border text-[11px] leading-tight transition-transform hover:scale-[1.02] ${
                                        isChanged
                                          ? "bg-amber-50 border-amber-300 text-amber-900 font-bold shadow-2xs"
                                          : cell.simul
                                          ? "bg-purple-50 border-purple-200 text-purple-950 font-bold shadow-2xs"
                                          : "bg-white border-indigo-200 text-indigo-950 font-bold shadow-2xs"
                                      }`}
                                    >
                                      <div className="truncate">{cell.grade}-{cell.classNum} {subj}</div>
                                      {cell.room && (
                                        <div className="text-[9px] font-normal text-gray-500 truncate mt-0.5">{cell.room}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="h-6"></div>
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
        )}
      </div>

      {/* Footer Link */}
      {onNavigateToMyTimetable && (
        <div className="pt-3">
          <button
            type="button"
            onClick={onNavigateToMyTimetable}
            className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1 cursor-pointer"
          >
            시간표 상세 · 맞교환 신청 →
          </button>
        </div>
      )}
    </div>
  );
}
