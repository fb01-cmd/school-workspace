"use client";

import { useEffect, useState } from "react";
import { ClassGrid } from "@/lib/timetable/types";

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

export default function StudentTimetableCard() {
  const [classGrid, setClassGrid] = useState<ClassGrid | null>(null);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [weekMeta, setWeekMeta] = useState<{
    id: string;
    startDate: string;
    days?: { day: number; date: string; holiday?: boolean }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudentTimetable = async () => {
    setLoading(true);
    setError(null);

    try {
      // 학생 API는 서버가 학번 기반으로 본인 반을 강제 도출하므로 action만 전달
      // weekId 미지정 시 서버가 현재 주(currentWeek)를 찾아 주간 시간표로 반환함
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
          <span>📅 우리 반 주간 시간표</span>
        </h3>
        <p className="text-xs text-slate-500">
          {error || "등록되었거나 활성화된 시간표가 없습니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden transition-shadow hover:shadow-md">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 px-5 py-4 text-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🗓️</span>
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <span>{classGrid.grade}학년 {classGrid.classNum}반 주간 시간표</span>
              {termMeta && (
                <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-indigo-700/80 text-indigo-200 border border-indigo-600/50">
                  {termMeta.name}
                </span>
              )}
            </h3>
            {weekMeta?.startDate && (
              <p className="text-xs text-indigo-200 mt-0.5">
                🗓️ <span className="font-bold text-amber-300">{weekMeta.startDate}</span> 주간
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 월~금 주간 그리드 표 — min-width 없이 카드 폭에 맞춤 (금요일 잘림 방지, 2026-08-07 사용자 지시) */}
      <div className="p-4">
        <div className="border border-slate-200 rounded-xl text-xs">
          <table className="w-full table-fixed border-collapse text-center">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="py-2 px-1 w-9 border-r border-slate-200 bg-slate-200/60 text-[11px]">교시</th>
                {DAYS.map((d) => {
                  // 요일 아래 실제 날짜 병기 — 학생이 주 시작일에서 역산하지 않도록
                  const dateStr = weekMeta?.days?.find((x) => x.day === d.num)?.date;
                  const md = dateStr ? `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}` : null;
                  return (
                    <th key={d.num} className="py-1.5 px-1 text-[11px]">
                      <div>{d.label}</div>
                      {md && <div className="text-[10px] font-normal text-slate-500">{md}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {Array.from({ length: 7 }).map((_, pIdx) => {
                const period = pIdx + 1;
                return (
                  <tr key={period} className={period % 2 === 0 ? "bg-slate-50/40" : "bg-white"}>
                    <td className="py-2 px-1 border-r border-slate-200 font-bold text-slate-500 bg-slate-50 text-[11px]">
                      {period}
                    </td>
                    {DAYS.map((d) => {
                      const lessons = getLessonsForSlot(d.num, period);
                      const hasLessons = lessons.length > 0;
                      return (
                        <td
                          key={d.num}
                          className={`p-1.5 border-r border-slate-100 text-center align-top transition-colors ${
                            hasLessons ? "bg-indigo-50/30 hover:bg-indigo-100/50" : "hover:bg-slate-50"
                          }`}
                        >
                          {hasLessons ? (
                            <div className="space-y-1">
                              {lessons.map((lesson: any, idx: number) => {
                                const subj = lesson.subjectShort || lesson.subjectName || "";
                                const isChanged = !!lesson.changed;
                                const changedType = lesson.changed?.type;
                                const origin = lesson.changed?.origin;

                                // 가상교사 등 이메일 없는 교사는 서버에서 필터링됨
                                // validTeachers가 있을 때만 이름 표기 (빈 괄호 () 렌더 금지!)
                                const validTeachers = (lesson.teachers || []).filter(
                                  (t: any) => t && t.name && t.name.trim() !== ""
                                );
                                const teacherNames = validTeachers.map((t: any) => t.name).join(", ");

                                // 미니멀 셀 (2026-08-07 사용자 지시): 과목명 크게 + 교사명 작게만.
                                // 특별실·이동수업 배지는 학생이 이미 아는 정보라 제거.
                                // 변경(교체·보강)만 새 정보라 색+한 줄 라벨로 유지, 출처는 툴팁.
                                return (
                                  <div
                                    key={idx}
                                    title={
                                      isChanged
                                        ? origin
                                          ? `${changedType === "substitute" ? "보강" : "수업 교체"} — ${DAY_LABEL[origin.day]}요일 ${origin.period}교시에서 이동`
                                          : changedType === "substitute" ? "보강" : "수업 교체"
                                        : undefined
                                    }
                                    className={`py-1.5 px-0.5 rounded-lg border leading-tight ${
                                      isChanged
                                        ? "bg-amber-50 border-amber-300"
                                        : "bg-white border-slate-200"
                                    }`}
                                  >
                                    <div className="font-extrabold text-[13px] text-slate-900 truncate">{subj}</div>
                                    {validTeachers.length > 0 && (
                                      <div className="text-[10px] text-slate-400 font-normal truncate">{teacherNames}</div>
                                    )}
                                    {isChanged && (
                                      <div className="text-[9px] font-extrabold text-amber-800 mt-0.5">
                                        {changedType === "substitute" ? "보강" : "교체"}
                                        {origin && ` · ${DAY_LABEL[origin.day]}${origin.period}`}
                                      </div>
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
      </div>
    </div>
  );
}
