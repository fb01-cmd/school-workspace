"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { TeacherTimetableCell } from "@/lib/timetable/types";

interface TeacherTimetableTabProps {
  periodsPerDay?: number;
}

export default function TeacherTimetableTab({ periodsPerDay = 7 }: TeacherTimetableTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";
  const myEmail = userData?.email?.toLowerCase() || "";

  const [targetEmail, setTargetEmail] = useState(myEmail);
  const [teacherName, setTeacherName] = useState(myEmail.split("@")[0]);
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
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

  const fetchTeacherTimetable = async (email: string) => {
    if (!email) return;
    setLoading(true);
    setError(null);

    try {
      const isMe = email.toLowerCase() === myEmail;
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isMe ? "my" : "teacher",
          teacherEmail: email,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        if (result.data && Array.isArray(result.data.cells)) {
          setCells(result.data.cells);
          setTeacherName(result.data.teacherName || email.split("@")[0]);
        } else {
          setCells([]);
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
    fetchTeacherTimetable(targetEmail);
  }, [targetEmail]);

  // 특정 요일·교시의 수업 찾기
  const getCellForSlot = (day: number, period: number) => {
    return cells.filter((c) => c.day === day && c.period === period);
  };

  const totalHours = cells.length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* 상단 컨트롤러 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>🗓️ 교사 주간시간표</span>
            {termMeta && (
              <span className="text-xs px-2 py-0.5 rounded-full font-normal bg-indigo-100 text-indigo-800">
                {termMeta.name}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            본인 또는 지정 교사의 주간 수업 일정 및 강의실 위치를 확인합니다.
          </p>
        </div>

        {/* 교사 검색 Autocomplete */}
        <div className="flex items-center gap-2 w-full md:w-80">
          <button
            onClick={() => setTargetEmail(myEmail)}
            className={`px-3 py-2 rounded-lg text-xs font-bold shrink-0 transition-colors ${
              targetEmail.toLowerCase() === myEmail
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            내 시간표
          </button>
          <AutocompleteInput
            value={targetEmail}
            onChange={(val) => setTargetEmail(val)}
            type="user"
            domain={domain}
            placeholder="다른 교사 검색 (이메일/성명)"
            onSelect={(email, name) => {
              setTargetEmail(email);
              if (name) setTeacherName(name);
            }}
          />
        </div>
      </div>

      {/* 요약 바 */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center">
        <div>
          <span className="font-bold text-indigo-950 text-sm">{teacherName}</span> 교사님의 주간 수업 시수:{" "}
          <span className="font-black text-indigo-700 text-sm">{totalHours}시간</span>
        </div>
        {loading && <span className="text-xs text-indigo-600 font-semibold animate-pulse">조회 중...</span>}
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
                      const matched = getCellForSlot(d.num, period);
                      const hasLesson = matched.length > 0;
                      return (
                        <td
                          key={d.num}
                          className={`p-2 border-r border-gray-100 text-center align-top transition-colors ${
                            hasLesson ? "bg-indigo-50/40 hover:bg-indigo-100/50" : ""
                          }`}
                        >
                          {hasLesson ? (
                            <div className="space-y-1.5">
                              {matched.map((cell, cIdx) => (
                                <div
                                  key={cIdx}
                                  className="p-2 rounded-lg bg-white border border-indigo-200 shadow-2xs space-y-1"
                                >
                                  <div className="font-black text-indigo-950 text-xs">
                                    {cell.subjectShort || cell.subjectName}
                                  </div>
                                  <div className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                                    {cell.grade}-{cell.classNum}반
                                  </div>
                                  {cell.room && (
                                    <div className="text-[10px] text-gray-500 truncate">
                                      📍 {cell.room}
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
