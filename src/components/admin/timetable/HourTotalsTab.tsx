"use client";

import { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { HourTotalsResult } from "@/lib/timetable/types";

interface HourTotalsTabProps {
  activeTermId: string | null;
}

export default function HourTotalsTab({ activeTermId }: HourTotalsTabProps) {
  // 오늘 날짜 기본값
  const getTodayStr = () => new Date().toISOString().split("T")[0];

  const [endDate, setEndDate] = useState(getTodayStr());
  const [totals, setTotals] = useState<HourTotalsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 표 서브 탭 ("teacher" | "subject" | "class")
  const [activeSubTab, setActiveSubTab] = useState<"teacher" | "subject" | "class">("teacher");

  const fetchHourTotals = useCallback(async () => {
    if (!endDate) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hour_totals",
          termId: activeTermId || undefined,
          endDate,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTotals(data.totals || null);
      } else {
        setError(data.error || "시수 집계 데이터를 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [activeTermId, endDate]);

  useEffect(() => {
    fetchHourTotals();
  }, [fetchHourTotals]);

  // 엑셀 내보내기 (SheetJS) - 교사별/과목별/학급별 3개 시트를 단일 엑셀 파일로 결합
  const handleExportExcel = () => {
    if (!totals) {
      alert("다운로드할 집계 데이터가 없습니다.");
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: 교사별
    const teacherData = totals.byTeacher.map((t) => ({
      교사명: t.name,
      이메일: t.email,
      "실시수 (시간)": t.total,
      "특별보강 누계 (회)": t.substituteCount,
    }));
    const wsTeacher = XLSX.utils.json_to_sheet(teacherData);
    wsTeacher["!cols"] = [{ wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsTeacher, "교사별 시수");

    // Sheet 2: 과목별
    const subjectData = totals.bySubject.map((s) => ({
      과목명: s.subjectName,
      "실시수 (시간)": s.total,
    }));
    const wsSubject = XLSX.utils.json_to_sheet(subjectData);
    wsSubject["!cols"] = [{ wch: 22 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSubject, "과목별 시수");

    // Sheet 3: 학급별
    const classData = totals.byClass.map((c) => ({
      학년: `${c.grade}학년`,
      반: `${c.classNum}반`,
      "실시수 (시간)": c.total,
    }));
    const wsClass = XLSX.utils.json_to_sheet(classData);
    wsClass["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsClass, "학급별 시수");

    const filename = `수업시수집계_${endDate}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* 상단 헤더 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span>📊 주간 합성 수업시수 집계</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-800">
              실시수 집계
            </span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            저장된 값이 아니라, 등록된 주의 시간표에서 실제 운영된 시수를 그때그때 계산합니다.
          </p>
        </div>

        <button
          onClick={handleExportExcel}
          disabled={loading || !totals}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1.5 shadow-xs shrink-0"
        >
          <span>📊 시수 집계 엑셀 다운로드</span>
        </button>
      </div>

      {/* 필터 컨트롤러 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-700">집계 종료 기준일:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-xs text-slate-500">
            (해당 일자까지 등록된 주의 실제 수업만 카운트)
          </span>
        </div>

        <button
          onClick={fetchHourTotals}
          disabled={loading}
          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
        >
          {loading ? "집계 중..." : "집계 실행"}
        </button>
      </div>

      {/* 요약 현황 배너 */}
      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-indigo-950">
            <div className="text-xs font-bold text-indigo-700">집계 대상 주 수</div>
            <div className="text-xl font-black mt-1">{totals.weeksCounted}개 주</div>
          </div>
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-indigo-950">
            <div className="text-xs font-bold text-indigo-700">등록된 교사 수</div>
            <div className="text-xl font-black mt-1">{totals.byTeacher.length}명</div>
          </div>
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-indigo-950">
            <div className="text-xs font-bold text-indigo-700">등록된 과목 수</div>
            <div className="text-xl font-black mt-1">{totals.bySubject.length}개 과목</div>
          </div>
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-indigo-950">
            <div className="text-xs font-bold text-indigo-700">등록된 학급 수</div>
            <div className="text-xl font-black mt-1">{totals.byClass.length}개 학급</div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-xs text-red-800 text-center">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-2" />
          <p className="text-xs font-bold text-slate-500">실시간 수업시수를 집계하는 중입니다...</p>
        </div>
      )}

      {/* 3종류 서브 탭 뷰 */}
      {!loading && totals && (
        <div className="space-y-4">
          <div className="flex border-b border-gray-200 gap-4 text-xs font-bold">
            <button
              onClick={() => setActiveSubTab("teacher")}
              className={`pb-2.5 transition-colors border-b-2 ${
                activeSubTab === "teacher"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              👤 교사별 시수 ({totals.byTeacher.length}명)
            </button>
            <button
              onClick={() => setActiveSubTab("subject")}
              className={`pb-2.5 transition-colors border-b-2 ${
                activeSubTab === "subject"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              📚 과목별 시수 ({totals.bySubject.length}개)
            </button>
            <button
              onClick={() => setActiveSubTab("class")}
              className={`pb-2.5 transition-colors border-b-2 ${
                activeSubTab === "class"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              🏫 학급별 시수 ({totals.byClass.length}개)
            </button>
          </div>

          {/* ① 교사별 표 */}
          {activeSubTab === "teacher" && (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-indigo-950 text-white font-bold text-center">
                    <th className="py-3 px-4 border-b border-r border-indigo-800 w-16">순번</th>
                    <th className="py-3 px-4 border-b border-r border-indigo-800 w-36 text-left">교사명</th>
                    <th className="py-3 px-4 border-b border-r border-indigo-800 text-left">이메일</th>
                    <th className="py-3 px-4 border-b border-r border-indigo-800 w-32">총 실시수</th>
                    <th className="py-3 px-4 border-b border-indigo-800 w-36">특별보강 누계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {totals.byTeacher.map((t, idx) => (
                    <tr key={t.email || idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                      <td className="py-3 px-4 border-r border-gray-100 text-center font-semibold text-gray-400">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 border-r border-gray-100 font-bold text-gray-900">
                        {t.name}
                      </td>
                      <td className="py-3 px-4 border-r border-gray-100 font-mono text-gray-500">
                        {t.email}
                      </td>
                      <td className="py-3 px-4 border-r border-gray-100 text-center font-black text-indigo-900 text-sm">
                        {t.total} <span className="text-xs font-normal text-gray-500">시간</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {t.substituteCount > 0 ? (
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200">
                            {t.substituteCount}회
                          </span>
                        ) : (
                          <span className="text-gray-400">0회</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ② 과목별 표 */}
          {activeSubTab === "subject" && (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-indigo-950 text-white font-bold text-center">
                    <th className="py-3 px-4 border-b border-r border-indigo-800 w-16">순번</th>
                    <th className="py-3 px-4 border-b border-r border-indigo-800 text-left">과목명</th>
                    <th className="py-3 px-4 border-b border-indigo-800 w-40">총 실시수</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {totals.bySubject.map((s, idx) => (
                    <tr key={s.subjectName || idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                      <td className="py-3 px-4 border-r border-gray-100 text-center font-semibold text-gray-400">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 border-r border-gray-100 font-bold text-gray-900">
                        {s.subjectName}
                      </td>
                      <td className="py-3 px-4 text-center font-black text-indigo-900 text-sm">
                        {s.total} <span className="text-xs font-normal text-gray-500">시간</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ③ 학급별 표 */}
          {activeSubTab === "class" && (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-indigo-950 text-white font-bold text-center">
                    <th className="py-3 px-4 border-b border-r border-indigo-800 w-16">순번</th>
                    <th className="py-3 px-4 border-b border-r border-indigo-800 text-center w-36">학년 / 반</th>
                    <th className="py-3 px-4 border-b border-indigo-800 w-40">총 실시수</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {totals.byClass.map((c, idx) => (
                    <tr key={`${c.grade}-${c.classNum}`} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                      <td className="py-3 px-4 border-r border-gray-100 text-center font-semibold text-gray-400">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 border-r border-gray-100 text-center">
                        <span className="inline-flex px-3 py-1 rounded-lg font-bold bg-indigo-50 text-indigo-800 border border-indigo-100">
                          {c.grade}학년 {c.classNum}반
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-black text-indigo-900 text-sm">
                        {c.total} <span className="text-xs font-normal text-gray-500">시간</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
