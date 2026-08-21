"use client";

import { useEffect, useState } from "react";
import { ClassGrid, TimetableCell } from "@/lib/timetable/types";
import { useAvailableClasses } from "./useAvailableClasses";
import { getDayDateLabel } from "@/lib/timetable/utils";

interface ClassTimetableTabProps {
  periodsPerDay?: number;
  activeTermId?: string | null;
  /** 바깥에서 주를 정해 줄 때 (교사 포털처럼 한 화면에 주 선택기가 이미 있는 경우) */
  weekId?: string;
  /** 자체 주 선택기를 숨긴다 — 한 화면에 주 고르는 칸이 둘이면 어느 쪽이 미는지 헷갈린다 */
  hideWeekPicker?: boolean;
}

export default function ClassTimetableTab({
  periodsPerDay = 7,
  activeTermId,
  weekId: controlledWeekId,
  hideWeekPicker = false,
}: ClassTimetableTabProps) {
  // 이 화면은 **그 주에 실제로 돌아가는 시간표**를 보여준다 — 학기 고정표가 아니다.
  // 예전에는 주를 고를 수도, 날짜를 볼 수도 없어서 「학기 고정 시간표」로 읽혔고,
  // 공휴일이라 비어 있는 월요일이 "수업이 없는 것"으로 오해됐다 (2026-08-21 사용자 지적).
  // 교사 포털 「다른 시간표 조회」에는 이미 있던 것을 여기에도 맞춘다.
  const [weeks, setWeeks] = useState<{ id: string; startDate: string }[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [selectedGrade, setSelectedGrade] = useState<number>(1);
  const [selectedClassNum, setSelectedClassNum] = useState<number>(1);
  const [classGrid, setClassGrid] = useState<ClassGrid | null>(null);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 주 목록 — 고를 수 있어야 "지금 어느 주를 보는지"가 화면에 드러난다
  useEffect(() => {
    if (!activeTermId) return;
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId: activeTermId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.weeks)) setWeeks(d.weeks); })
      .catch(() => {});
  }, [activeTermId]);

  // 바깥이 주를 정해 주면 그것이 이긴다
  const effectiveWeekId = controlledWeekId ?? selectedWeekId;
  const isBaseView = effectiveWeekId === "base";
  const selectedWeek = weeks.find((w) => w.id === effectiveWeekId) || null;

  const { getClassesForGrade } = useAvailableClasses();
  const currentClasses = getClassesForGrade(selectedGrade, false);

  const DAYS = [
    { num: 1, label: "월요일" },
    { num: 2, label: "화요일" },
    { num: 3, label: "수요일" },
    { num: 4, label: "목요일" },
    { num: 5, label: "금요일" },
  ];

  const fetchClassTimetable = async (grade: number, classNum: number, weekId?: string) => {
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
          weekId: weekId || undefined,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        // 서버가 실제로 고른 주를 그대로 따른다 — 화면이 "무엇을 보고 있는지"의 단일 원본
        if (result.week?.id && !weekId && !controlledWeekId) setSelectedWeekId(result.week.id);
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
    if (currentClasses.length > 0) {
      if (!currentClasses.includes(selectedClassNum)) {
        setSelectedClassNum(currentClasses[0]);
      } else {
        fetchClassTimetable(selectedGrade, selectedClassNum, effectiveWeekId || undefined);
      }
    } else {
      setClassGrid(null);
    }
  }, [selectedGrade, selectedClassNum, currentClasses, effectiveWeekId]);

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
              {isBaseView
                ? "학기 기초시간표입니다 — 휴업일·수업교환·보강이 반영되지 않은 원본입니다."
                : "고른 주에 실제로 운영되는 시간표입니다 — 휴업일·수업교환·보강이 반영돼 있습니다."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {weeks.length > 0 && !hideWeekPicker && (
              <select
                value={selectedWeekId}
                onChange={(e) => setSelectedWeekId(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-medium bg-white focus:ring-2 focus:ring-indigo-500"
              >
                {weeks.map((w) => (
                  <option key={w.id} value={w.id}>{w.startDate} 주</option>
                ))}
              </select>
            )}
            {loading && <span className="text-xs text-indigo-600 font-semibold animate-pulse">조회 중...</span>}
          </div>
        </div>

        {/* 학년 버튼 필터 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-700 mr-1">학년 선택:</span>
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              onClick={() => {
                setSelectedGrade(g);
                const classes = getClassesForGrade(g, false);
                if (classes.length > 0 && !classes.includes(selectedClassNum)) {
                  setSelectedClassNum(classes[0]);
                }
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

        {/* 반 버튼 필터 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-gray-700 mr-1">반 선택:</span>
          {currentClasses.length === 0 ? (
            <span className="text-xs text-gray-400 py-1">등록된 반이 없습니다.</span>
          ) : (
            currentClasses.map((cNum) => (
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
            ))
          )}
        </div>
      </div>

      {/* 학급 표시 배너 */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center">
        <div>
          {currentClasses.length > 0 ? (
            <>
              <span className="font-black text-indigo-950 text-sm">
                {selectedGrade}학년 {selectedClassNum}반
              </span>{" "}
              {isBaseView ? "기초시간표" : selectedWeek ? `${selectedWeek.startDate} 주` : "이번 주"} 시간표
            </>
          ) : (
            <>
              <span className="font-black text-indigo-950 text-sm">
                {selectedGrade}학년
              </span>{" "}
              시간표 (등록된 반 없음)
            </>
          )}
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
                  /* 열 폭을 균등 고정한다 — 예전에는 폭 지정이 없어 **내용이 없는 요일(공휴일)이
                     좁아지는** 문제가 있었다 (2026-08-21 사용자 지적). */
                  <th key={d.num} className="py-3 px-2 border-b border-indigo-800 text-center w-1/5">
                    <div>{d.label}</div>
                    {selectedWeek && (
                      <div className="text-[10px] font-normal text-indigo-300 mt-0.5">
                        {getDayDateLabel(selectedWeek.startDate, d.num)}
                      </div>
                    )}
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
                              {cell.lessons.map((lesson, lIdx) => {
                                const subjName = lesson.subjectShort || lesson.subjectName || "";
                                // 판정 단일 통로: 서버가 시간표 응답에 실어 보낸 동시수업 라벨 (lesson.simul)
                                const simulCheck = { hit: !!lesson.simul, groupLabel: lesson.simul };
                                return (
                                  <div
                                    key={lIdx}
                                    className={`p-2 rounded-lg border shadow-2xs space-y-1 ${
                                      simulCheck.hit
                                        ? "bg-purple-50/90 border-purple-300"
                                        : "bg-white border-indigo-200"
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1 flex-wrap">
                                      <div className={`font-black text-xs ${simulCheck.hit ? "text-purple-950" : "text-indigo-950"}`}>
                                        {subjName}
                                      </div>
                                      {simulCheck.hit && (
                                        <span className="text-[10px] bg-purple-700 text-white font-extrabold px-1 rounded" title={simulCheck.groupLabel || "이동수업 그룹"}>
                                          🔀 이동수업
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-indigo-800 font-semibold truncate">
                                      👤 {lesson.teachers.map((t) => t.name).join(", ")}
                                    </div>
                                     {lesson.room && (
                                       <div className="text-[10px] font-extrabold text-emerald-900 bg-emerald-100/90 border border-emerald-300 rounded px-1.5 py-0.5 mt-0.5 truncate flex items-center gap-1" title={`특별실: ${lesson.room}`}>
                                         <span>🏛️</span>
                                         <span className="truncate">{lesson.room}</span>
                                       </div>
                                     )}
                                  </div>
                                );
                              })}
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
