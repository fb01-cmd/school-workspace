"use client";

import { useEffect, useState } from "react";
import { FreeTeacher } from "@/lib/timetable/types";

interface FreeTeacherViewerProps {
  periodsPerDay?: number;
  className?: string;
}

export default function FreeTeacherViewer({
  periodsPerDay = 7,
  className = "",
}: FreeTeacherViewerProps) {
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [freeTeachers, setFreeTeachers] = useState<FreeTeacher[]>([]);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 전교 공통 활동 교시(SLAT·창체 등) — 공강 개념 미적용 (consent_swap_opening_spec §4-1b)
  const [commonActivitySlot, setCommonActivitySlot] = useState(false);

  const DAYS = [
    { num: 1, label: "월요일" },
    { num: 2, label: "화요일" },
    { num: 3, label: "수요일" },
    { num: 4, label: "목요일" },
    { num: 5, label: "금요일" },
  ];

  const fetchFreeTeachers = async (day: number, period: number) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "free",
          day,
          period,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        setCommonActivitySlot(!!result.commonActivitySlot);
        if (Array.isArray(result.data)) {
          setFreeTeachers(result.data);
        } else {
          setFreeTeachers([]);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "공강 교사 정보를 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFreeTeachers(selectedDay, selectedPeriod);
  }, [selectedDay, selectedPeriod]);

  // 검색어 필터링
  const filteredTeachers = freeTeachers.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
      t.email.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const selectedDayLabel = DAYS.find((d) => d.num === selectedDay)?.label || "월요일";

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6 ${className}`}>
      {/* 상단 컨트롤러: 요일 / 교시 선택 */}
      <div className="space-y-4 border-b border-gray-100 pb-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>☕ 공강 교사 조회</span>
              {termMeta && (
                <span className="text-xs px-2 py-0.5 rounded-full font-normal bg-indigo-100 text-indigo-800">
                  {termMeta.name}
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              특정 요일 및 교시에 수업이 없는(공강) 교직원 목록을 조회합니다. (보강/대강 배치 시 활용)
            </p>
          </div>
          {loading && <span className="text-xs text-indigo-600 font-semibold animate-pulse">조회 중...</span>}
        </div>

        {/* 요일 필터 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-700 mr-1">요일 선택:</span>
          {DAYS.map((d) => (
            <button
              key={d.num}
              onClick={() => setSelectedDay(d.num)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                selectedDay === d.num
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* 교시 필터 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-gray-700 mr-1">교시 선택:</span>
          {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, idx) => {
            const pNum = idx + 1;
            return (
              <button
                key={pNum}
                onClick={() => setSelectedPeriod(pNum)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center ${
                  selectedPeriod === pNum
                    ? "bg-indigo-800 text-white shadow-sm"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-200 border border-gray-200"
                }`}
              >
                {pNum}교시
              </button>
            );
          })}
        </div>
      </div>

      {/* 검색 바 및 요약 배너 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900">
        <div>
          <span className="font-black text-indigo-950 text-sm">
            {selectedDayLabel} {selectedPeriod}교시
          </span>{" "}
          공강 교사: <span className="font-black text-indigo-700 text-sm">{freeTeachers.length}명</span>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="교사 성명/이메일 검색"
          className="px-3 py-1.5 border border-gray-300 rounded-md text-xs text-gray-900 focus:ring-indigo-500 focus:border-indigo-500 w-full sm:w-60 bg-white"
        />
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center">
          {error}
        </div>
      ) : commonActivitySlot ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-5 text-xs text-indigo-900 text-center space-y-1">
          <div className="font-bold text-sm">🏫 이 교시는 학교 공통 활동 시간입니다</div>
          <div>
            자율활동·동아리 등 학교 공통 활동 시간에는 시간표에 수업이 없어 보여도
            선생님들이 담임·지도 등으로 참여하고 있어, 공강 조회 대상이 아닙니다.
          </div>
        </div>
      ) : (
        /* 공강 교사 리스트 그리드 */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filteredTeachers.length === 0 ? (
            <div className="col-span-full py-12 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              {searchQuery
                ? `'${searchQuery}' 검색 조건에 일치하는 공강 교사가 없습니다.`
                : `${selectedDayLabel} ${selectedPeriod}교시 공강 교사가 없습니다.`}
            </div>
          ) : (
            filteredTeachers.map((t) => (
              <div
                key={t.email}
                className="p-3 bg-white border border-gray-200 hover:border-indigo-300 rounded-xl shadow-2xs transition-all flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <span>👤</span>
                    <span>{t.name}</span>
                  </div>
                </div>
                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  공강
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
