"use client";

import { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { NeisRow } from "@/lib/timetable/types";

interface NeisExportTabProps {
  activeTermId: string | null;
}

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

export default function NeisExportTab({ activeTermId }: NeisExportTabProps) {
  // 오늘 기준 주 시작일(월)과 종료일(일) 계산
  const getTodayRange = () => {
    const now = new Date();
    const day = now.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      start: mon.toISOString().split("T")[0],
      end: sun.toISOString().split("T")[0],
    };
  };

  const defaultRange = getTodayRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [onlySubstitute, setOnlySubstitute] = useState(false);

  const [rows, setRows] = useState<NeisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNeisList = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "neis_list",
          termId: activeTermId || undefined,
          startDate,
          endDate,
          type: onlySubstitute ? "substitute" : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRows(data.rows || []);
      } else {
        setError(data.error || "NEIS 수업교환 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [activeTermId, startDate, endDate, onlySubstitute]);

  useEffect(() => {
    fetchNeisList();
  }, [fetchNeisList]);

  // 엑셀 다운로드 (SheetJS)
  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }

    const excelData = rows.map((r) => ({
      "변경있는 교시(일자·교시)": `${r.date} (${DAY_LABEL[r.day] || ""} ${r.period}교시)`,
      "학년-반": `${r.grade}-${r.classNum}반`,
      교사: r.teacherName,
      과목: r.subjectName,
      "변경전 교시": `${r.prevDate} (${DAY_LABEL[r.prevDay] || ""} ${r.prevPeriod}교시)`,
      "비고(특별보강 대체교사)": r.note || "",
      구분:
        r.type === "cross_swap" ? "교차주맞교환"
        : r.type === "swap" ? "맞교환"
        : r.type === "move" ? "통이동" // 이동수업 묶음이 빈 교시로 옮겨간 행 — 보강이 아니다
        : "특별보강",
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    ws["!cols"] = [
      { wch: 22 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 22 },
      { wch: 20 },
      { wch: 10 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "NEIS_수업교환목록");
    const filename = `NEIS_수업교환목록_${startDate}_${endDate}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* 상단 제목 및 설명 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>📑 NEIS 입력용 수업교환 목록</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
              나이스 입력 양식
            </span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            실무사의 현행 수기 입력 흐름을 지원하기 위해 승인된 시간표 변경 사항을 NEIS 양식대로 조회 및
            엑셀 다운로드합니다.
          </p>
        </div>

        <button
          onClick={handleExportExcel}
          disabled={loading || rows.length === 0}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-xs shrink-0"
        >
          <span>📊 엑셀 다운로드 (.xlsx)</span>
        </button>
      </div>

      {/* 필터 컨트롤러 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">조회 기간:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-400">~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none ml-2">
            <input
              type="checkbox"
              checked={onlySubstitute}
              onChange={(e) => setOnlySubstitute(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
            />
            <span>특별보강만 보기</span>
          </label>
        </div>

        <button
          onClick={fetchNeisList}
          disabled={loading}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
        >
          {loading ? "조회 중..." : "조회"}
        </button>
      </div>

      {/* 정보 배너 */}
      <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center">
        <div>
          조회 기간: <span className="font-bold">{startDate} ~ {endDate}</span>
          {onlySubstitute && <span className="ml-1 text-orange-700 font-bold">(특별보강 전용)</span>}
          {" · "}총 <span className="font-black text-indigo-700">{rows.length}건</span>의 수업 변경 내역
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center">
          {error}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-xl">
          <p className="text-sm font-semibold text-gray-500">해당 기간 내에 승인된 수업 변경 내역이 없습니다.</p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-indigo-950 text-white font-bold text-center">
                <th className="py-3 px-3 border-b border-r border-indigo-800 w-36">변경있는 교시</th>
                <th className="py-3 px-2 border-b border-r border-indigo-800 w-20">학급</th>
                <th className="py-3 px-3 border-b border-r border-indigo-800 w-28">교사</th>
                <th className="py-3 px-3 border-b border-r border-indigo-800 w-32">과목</th>
                <th className="py-3 px-3 border-b border-r border-indigo-800 w-36">변경전 교시</th>
                <th className="py-3 px-3 border-b border-r border-indigo-800">비고 (대체 교사)</th>
                <th className="py-3 px-2 border-b border-indigo-800 w-20">구분</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((r, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                  <td className="py-3 px-3 border-r border-gray-100 text-center font-bold text-gray-800">
                    <div>{r.date}</div>
                    <div className="text-[11px] text-indigo-700 font-semibold">
                      {DAY_LABEL[r.day] || ""}요일 {r.period}교시
                    </div>
                  </td>
                  <td className="py-3 px-2 border-r border-gray-100 text-center">
                    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-100">
                      {r.grade}-{r.classNum}반
                    </span>
                  </td>
                  <td className="py-3 px-3 border-r border-gray-100 text-center font-bold text-gray-900">
                    {r.teacherName}
                  </td>
                  <td className="py-3 px-3 border-r border-gray-100 text-center font-semibold text-gray-800">
                    {r.subjectName}
                  </td>
                  <td className="py-3 px-3 border-r border-gray-100 text-center text-gray-600">
                    <div>{r.prevDate}</div>
                    <div className="text-[11px] text-gray-500">
                      {DAY_LABEL[r.prevDay] || ""}요일 {r.prevPeriod}교시
                    </div>
                  </td>
                  <td className="py-3 px-3 border-r border-gray-100 text-left font-medium text-gray-800">
                    {r.note ? (
                      <span className="text-indigo-900 font-semibold">{r.note}</span>
                    ) : (
                      <span className="text-gray-400 font-light">-</span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-center font-bold">
                    {r.type === "cross_swap" ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 border border-purple-200">
                        교차주맞교환
                      </span>
                    ) : r.type === "swap" ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
                        맞교환
                      </span>
                    ) : r.type === "move" ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-800 border border-purple-300">
                        통이동
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-700 border border-orange-200">
                        특별보강
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
