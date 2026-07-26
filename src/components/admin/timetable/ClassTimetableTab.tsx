"use client";

import { useEffect, useState } from "react";
import { ClassGrid, TimetableCell } from "@/lib/timetable/types";

interface ClassTimetableTabProps {
  periodsPerDay?: number;
}

export default function ClassTimetableTab({ periodsPerDay = 7 }: ClassTimetableTabProps) {
  const [selectedGrade, setSelectedGrade] = useState<number>(1);
  const [selectedClassNum, setSelectedClassNum] = useState<number>(1);

  const [classGrid, setClassGrid] = useState<ClassGrid | null>(null);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const DAYS = [
    { num: 1, label: "월요일" },
    { num: 2, label: "화요일" },
    { num: 3, label: "수요일" },
    { num: 4, label: "목요일" },
    { num: 5, label: "금요일" },
  ];

  const fetchClassTimetable = async (grade: number, classNum: number) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "class",
          grade,
          classNum,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        if (result.data) {
          setClassGrid(result.data);
        } else {
          setClassGrid(null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "학급 시간표를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClassTimetable(selectedGrade, selectedClassNum);
  }, [selectedGrade, selectedClassNum]);

  // 특정 요일·교시의 수업 셀 찾기
  const getCellForSlot = (day: number, period: number): TimetableCell | null => {
    if (!classGrid || !Array.isArray(classGrid.cells)) return null;
    return classGrid.cells.find((c) => c.day === day && c.period === period) || null;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* 상단 컨트롤러: 학년 / 반 선택 */}
      <div className="space-y-4 border-b border-gray-100 pb-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>🏫 학급별 시간표</span>
              {termMeta && (
                <span className="text-xs px-2 py-0.5 rounded-full font-normal bg-indigo-100 text-indigo-800">
                  {termMeta.name}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              각 학년 및 반별 주간 기초시간표를 확인합니다.
            </p>
          </div>
          {loading && <span className="text-xs text-indigo-600 font-semibold animate-pulse">조회 중...</span>}
        </div>

        {/* 학년 버튼 필터 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-700 mr-1">학년 선택:</span>
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              onClick={() => {
                setSelectedGrade(g);
                setSelectedClassNum(1);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedGrade === g
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {g}학년
            </button>
          ))}
        </div>

        {/* 반 버튼 필터 (1~12반) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-gray-700 mr-1">반 선택:</span>
          {Array.from({ length: 12 }).map((_, idx) => {
            const cNum = idx + 1;
            return (
              <button
                key={cNum}
                onClick={() => setSelectedClassNum(cNum)}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all flex items-center justify-center ${
                  selectedClassNum === cNum
                    ? "bg-indigo-800 text-white shadow-sm"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-200 border border-gray-200"
                }`}
              >
                {cNum}
              </button>
            );
          })}
        </div>
      </div>

      {/* 학급 표시 배너 */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center">
        <div>
          <span className="font-black text-indigo-950 text-sm">
            {selectedGrade}학년 {selectedClassNum}반
          </span>{" "}
          기초시간표
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center">
          {error}
        </div>
      ) : (
        /* 5일 x N교시 주간 시간표 그리드 */
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-indigo-950 text-white font-bold">
                <th className="py-3 px-2 border-b border-r border-indigo-800 w-16 text-center">교시</th>
                {DAYS.map((d) => (
                  <th key={d.num} className="py-3 px-2 border-b border-indigo-800 text-center">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, pIdx) => {
                const period = pIdx + 1;
                return (
                  <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                    <td className="py-4 px-2 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50">
                      {period}교시
                    </td>
                    {DAYS.map((d) => {
                      const cell = getCellForSlot(d.num, period);
                      const hasLessons = cell && cell.lessons && cell.lessons.length > 0;

                      return (
                        <td
                          key={d.num}
                          className={`p-2 border-r border-gray-100 text-center align-top transition-colors ${
                            hasLessons ? "bg-indigo-50/40 hover:bg-indigo-100/50" : ""
                          }`}
                        >
                          {hasLessons ? (
                            <div className="space-y-1.5">
                              {cell.lessons.map((lesson, lIdx) => (
                                <div
                                  key={lIdx}
                                  className="p-2 rounded-lg bg-white border border-indigo-200 shadow-2xs space-y-1"
                                >
                                  <div className="font-black text-indigo-950 text-xs">
                                    {lesson.subjectShort || lesson.subjectName}
                                  </div>
                                  <div className="text-[10px] text-indigo-800 font-semibold truncate">
                                    👤 {lesson.teachers.map((t) => t.name).join(", ")}
                                  </div>
                                  {lesson.room && (
                                    <div className="text-[10px] text-gray-500 truncate">
                                      📍 {lesson.room}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-300 font-light block py-2">
                              -
                            </span>
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
  );
}
