import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  DisciplineConfig,
  DisciplineRecord,
  DisciplineStage,
  DisciplineStageEvent,
  StudentDisciplineStatus,
} from "@/lib/discipline/types";

export interface StudentItem {
  studentId: string;
  studentEmail: string;
  studentName: string;
  grade: number;
  classNum: number;
  status: StudentDisciplineStatus;
  records: DisciplineRecord[];
  stageEvents: DisciplineStageEvent[];
}

interface DisciplineSummarySectionProps {
  students: StudentItem[];
  config: DisciplineConfig;
  onSelectClassFilter: (grade: number | "all", classNum: number | "all") => void;
  onSelectStudent: (student: StudentItem) => void;
}

type PeriodFilter = "all" | "30" | "90";
type ViewMode = "dashboard" | "pivot";

export default function DisciplineSummarySection({
  students,
  config,
  onSelectClassFilter,
  onSelectStudent,
}: DisciplineSummarySectionProps) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");

  // Stage & Item Maps
  const stages = useMemo(() => {
    return [...(config.stages || [])].sort((a, b) => a.order - b.order);
  }, [config.stages]);

  const stageMap = useMemo(() => {
    return new Map(stages.map((s) => [s.id, s]));
  }, [stages]);

  const items = useMemo(() => {
    return config.items || [];
  }, [config.items]);

  const itemMap = useMemo(() => {
    return new Map(items.map((it) => [it.id, it.label]));
  }, [items]);

  // 기간 기준 timestamp 계산
  const periodCutoff = useMemo(() => {
    if (periodFilter === "30") return Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (periodFilter === "90") return Date.now() - 90 * 24 * 60 * 60 * 1000;
    return 0;
  }, [periodFilter]);

  // 유효 기록(voided 제외 + 기간 내) 필터링된 학생별 데이터 집계
  const studentStats = useMemo(() => {
    return students.map((s) => {
      const validRecords = (s.records || []).filter((r) => {
        if (r.voided) return false;
        if (periodCutoff > 0 && r.occurredAt < periodCutoff) return false;
        return true;
      });

      const itemCountMap: Record<string, number> = {};
      let latestOccurredAt = 0;

      for (const r of validRecords) {
        itemCountMap[r.itemId] = (itemCountMap[r.itemId] || 0) + 1;
        if (r.occurredAt > latestOccurredAt) {
          latestOccurredAt = r.occurredAt;
        }
      }

      const currentStage = s.status.currentStageId
        ? stageMap.get(s.status.currentStageId)
        : null;
      const stageOrder = currentStage ? currentStage.order : 0;

      return {
        student: s,
        validRecords,
        validCount: validRecords.length,
        itemCountMap,
        latestOccurredAt,
        currentStage,
        stageOrder,
      };
    });
  }, [students, periodCutoff, stageMap]);

  // A. 학년 × 반 매트릭스 계산
  const { maxClassNum, matrixMap, gradeTotals, totalRecordCount } = useMemo(() => {
    let maxC = 10;
    for (const s of students) {
      if (s.classNum > maxC) maxC = s.classNum;
    }

    const matrix: Record<string, number> = {}; // `${grade}-${classNum}` -> count
    const gTotals: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    let total = 0;

    for (const st of studentStats) {
      const g = st.student.grade;
      const c = st.student.classNum;
      const count = st.validCount;
      if (count > 0 && g >= 1 && g <= 3) {
        const key = `${g}-${c}`;
        matrix[key] = (matrix[key] || 0) + count;
        gTotals[g] = (gTotals[g] || 0) + count;
        total += count;
      }
    }

    return {
      maxClassNum: maxC,
      matrixMap: matrix,
      gradeTotals: gTotals,
      totalRecordCount: total,
    };
  }, [students, studentStats]);

  // B. 항목별 분포 (건수 내림차순)
  const itemDistributions = useMemo(() => {
    const counts: Record<string, number> = {};
    let totalValid = 0;

    for (const st of studentStats) {
      for (const [itemId, cnt] of Object.entries(st.itemCountMap)) {
        counts[itemId] = (counts[itemId] || 0) + cnt;
        totalValid += cnt;
      }
    }

    const list = items.map((it) => ({
      item: it,
      count: counts[it.id] || 0,
    }));

    list.sort((a, b) => b.count - a.count);
    const maxItemCount = list[0]?.count || 1;

    return { list, maxItemCount, totalValid };
  }, [items, studentStats]);

  // C. 단계별 인원 현황 (단계는 기간 필터 무관 — 서버 판정 현 판정 표시)
  const stageBreakdown = useMemo(() => {
    const stageCounts: Record<string, number> = {};
    for (const s of students) {
      const stageId = s.status.currentStageId;
      if (stageId) stageCounts[stageId] = (stageCounts[stageId] || 0) + 1;
    }
    return { stageCounts };
  }, [students]);

  // D. 상위 학생 목록 (1. 현재 단계 order 내림차순 -> 2. 기간 내 유효 기록 수 내림차순)
  const topStudents = useMemo(() => {
    const activeStats = studentStats.filter(
      (st) => st.validCount > 0 || st.currentStage !== null
    );

    activeStats.sort((a, b) => {
      if (b.stageOrder !== a.stageOrder) {
        return b.stageOrder - a.stageOrder;
      }
      if (b.validCount !== a.validCount) {
        return b.validCount - a.validCount;
      }
      return b.latestOccurredAt - a.latestOccurredAt;
    });

    return activeStats.slice(0, 10);
  }, [studentStats]);

  // F. 피벗 데이터 (학생 x 항목 표)
  const pivotData = useMemo(() => {
    // 유효 기록이 1건 이상이거나 단계에 있는 학생들
    const list = studentStats.filter(
      (st) => st.validCount > 0 || st.currentStage !== null
    );

    list.sort((a, b) => b.validCount - a.validCount || b.stageOrder - a.stageOrder);
    return list;
  }, [studentStats]);

  // xlsx 내보내기 처리
  const handleExportXlsx = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const periodLabel =
      periodFilter === "all" ? "전체 기간" : periodFilter === "30" ? "최근 30일" : "최근 90일";

    // 엑셀 AOA 배열 생성
    const aoa: any[][] = [];

    // Header info rows
    aoa.push(["생활지도 종합 현황 (학교전용 관리 플랫폼)"]);
    aoa.push([`생성일자: ${todayStr}`, `기간: ${periodLabel}`, `총 기록 건수: ${totalRecordCount}건`]);
    aoa.push(["※ 개인정보가 포함된 파일입니다 — 업무 목적 외 사용·공유 금지"]);
    aoa.push([]); // blank line

    // Column headers
    const activeItems = items.filter((it) => {
      return studentStats.some((st) => (st.itemCountMap[it.id] || 0) > 0);
    });

    const headerRow = [
      "학번",
      "이름",
      "학년",
      "반",
      "현재 단계",
      ...activeItems.map((it) => it.label),
      "기간 내 총 건수",
      "최근 발생일",
    ];
    aoa.push(headerRow);

    // Student data rows
    for (const st of pivotData) {
      const stageLabel = st.currentStage ? st.currentStage.label : "정상 (조치 단계 없음)";
      const itemCountsRow = activeItems.map((it) => st.itemCountMap[it.id] || 0);
      const latestDateStr = st.latestOccurredAt
        ? new Date(st.latestOccurredAt).toLocaleDateString("ko-KR")
        : "-";

      aoa.push([
        st.student.studentId,
        st.student.studentName,
        st.student.grade,
        st.student.classNum,
        stageLabel,
        ...itemCountsRow,
        st.validCount,
        latestDateStr,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column width settings
    ws["!cols"] = [
      { wch: 10 }, // 학번
      { wch: 12 }, // 이름
      { wch: 8 },  // 학년
      { wch: 8 },  // 반
      { wch: 16 }, // 현재 단계
      ...activeItems.map(() => ({ wch: 14 })),
      { wch: 14 }, // 총 건수
      { wch: 14 }, // 최근 발생일
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "생활지도_현황");

    const filename = `생활지도_현황_${todayStr}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const handleCellClick = (grade: number, classNum: number) => {
    onSelectClassFilter(grade, classNum);
    const el = document.getElementById("discipline-student-cards");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 space-y-6">
      {/* ── 상단 헤더 & 컨트롤 바 ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              📊 생활지도 종합 현황
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              실시간 분석
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            권한 범위 내 실시간 지도 건수, 학년·반별 히트맵, 단계별 인원 및 상위 지도 학생 현황
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 기간 필터 버튼그룹 (Spec §1-E) */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 p-1 rounded-xl text-sm font-semibold">
            <button
              onClick={() => setPeriodFilter("all")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                periodFilter === "all"
                  ? "bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
              }`}
            >
              전체 기간
            </button>
            <button
              onClick={() => setPeriodFilter("30")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                periodFilter === "30"
                  ? "bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
              }`}
            >
              최근 30일
            </button>
            <button
              onClick={() => setPeriodFilter("90")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                periodFilter === "90"
                  ? "bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
              }`}
            >
              최근 90일
            </button>
          </div>

          {/* 뷰 모드 토글 (Spec §1-F) */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-700 p-1 rounded-xl text-sm font-semibold">
            <button
              onClick={() => setViewMode("dashboard")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === "dashboard"
                  ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
              }`}
            >
              📊 대시보드
            </button>
            <button
              onClick={() => setViewMode("pivot")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                viewMode === "pivot"
                  ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900"
              }`}
            >
              📋 표로 보기
            </button>
          </div>

          {/* 엑셀 내보내기 버튼 (Spec §1-F) */}
          <button
            onClick={handleExportXlsx}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all"
            title="현재 집계된 지도 현황 데이터를 엑셀로 내보냅니다."
          >
            <span>📥 엑셀 (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* 안내 문구 & PII 경고 (Spec §1-E, §1-F) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-sm gap-2 px-1 text-gray-500 dark:text-gray-400">
        <div className="flex items-center space-x-1 font-medium text-blue-600 dark:text-blue-400">
          <span>ℹ️ 단계는 현재 판정 기준, 건수는 선택 기간 기준입니다.</span>
        </div>
        <div className="flex items-center space-x-1 font-medium text-amber-600 dark:text-amber-400">
          <span>🔒 개인정보가 포함된 파일입니다 — 업무 목적 외 사용·공유 금지</span>
        </div>
      </div>

      {/* ── 뷰 1: 대시보드 뷰 ── */}
      {viewMode === "dashboard" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* A. 학년 × 반 매트릭스 (Col 7) */}
            <div className="lg:col-span-7 bg-gray-50/70 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                  <span>🏫 학년 × 반 지도 건수 (히트맵)</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    합계 {totalRecordCount}건
                  </span>
                </h3>
                <span className="text-xs text-gray-400">셀 클릭 시 해당 반 필터 적용</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-center text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                      <th className="py-2 px-1.5 text-left w-14">학년</th>
                      {Array.from({ length: maxClassNum }, (_, i) => i + 1).map((c) => (
                        <th key={c} className="py-2 px-1 text-center min-w-[28px]">
                          {c}반
                        </th>
                      ))}
                      <th className="py-2 px-1.5 text-right w-14">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3].map((g) => (
                      <tr key={g} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2.5 px-1.5 text-left font-bold text-gray-800 dark:text-gray-200">
                          {g}학년
                        </td>
                        {Array.from({ length: maxClassNum }, (_, i) => i + 1).map((c) => {
                          const count = matrixMap[`${g}-${c}`] || 0;
                          let bgClass =
                            "bg-gray-100/50 text-gray-400 dark:bg-gray-800/40 dark:text-gray-600";
                          if (count >= 6) {
                            bgClass =
                              "bg-red-100 text-red-900 dark:bg-red-950/70 dark:text-red-200 font-extrabold shadow-sm";
                          } else if (count >= 3) {
                            bgClass =
                              "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 font-bold";
                          } else if (count >= 1) {
                            bgClass =
                              "bg-blue-100/80 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200 font-semibold";
                          }

                          return (
                            <td key={c} className="py-1.5 px-1">
                              <button
                                onClick={() => handleCellClick(g, c)}
                                className={`w-full py-1.5 rounded-lg transition-transform hover:scale-105 cursor-pointer ${bgClass}`}
                                title={`${g}학년 ${c}반: ${count}건 (클릭 시 하단 필터)`}
                              >
                                {count}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-1.5 text-right font-bold text-blue-700 dark:text-blue-300">
                          {gradeTotals[g] || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* 반 번호별 세로 합계 행은 두지 않는다 — 학년이 다른 같은 반 번호끼리의
                      합(1-1+2-1+3-1)은 무의미한 숫자다 (2026-08-08 사용자 지적).
                      전체 합계는 제목 옆 배지로 표시. */}
                </table>
              </div>
            </div>

            {/* C. 단계별 인원 현황 (Col 5) */}
            <div className="lg:col-span-5 bg-gray-50/70 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                  <span>📌 조치 단계별 학생 현황</span>
                </h3>
                <span className="text-xs text-gray-400">현재 자동 계산 단계</span>
              </div>

              {/* "정상 N명" 줄은 두지 않는다 — 응답에는 기록 보유 학생만 오므로 여기서의
                  '정상'은 전교 정상 인원이 아니며(첫 기록부터 단계가 매겨져 사실상 상시 0명),
                  0명 표기는 "정상 학생이 없다"는 오독만 유발한다 (2026-08-08 사용자 지적). */}
              <div className="space-y-2.5 pt-1">
                {/* 설정된 단계들 */}
                {stages.map((st, idx) => {
                  const cnt = stageBreakdown.stageCounts[st.id] || 0;
                  const isHighStage = idx >= Math.max(1, stages.length - 2);

                  return (
                    <div
                      key={st.id}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                        cnt > 0
                          ? isHighStage
                            ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 shadow-sm"
                            : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 shadow-sm"
                          : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-80"
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isHighStage ? "bg-red-500" : "bg-amber-500"
                          }`}
                        ></span>
                        {/* 라벨은 학교 설정 자유 문자열("1단계" 같은 이름 실존) — 순번을 덧붙이면
                            "1단계 (3단계)"류 모순 표기가 되므로 라벨만 쓴다. 위계는 정렬 순서로 전달. */}
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                          {st.label}
                        </span>
                      </div>
                      <span
                        className={`text-sm font-extrabold ${
                          cnt > 0
                            ? isHighStage
                              ? "text-red-700 dark:text-red-300"
                              : "text-amber-700 dark:text-amber-300"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      >
                        {cnt}명
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* B. 항목별 분포 (Col 6) */}
            <div className="lg:col-span-6 bg-gray-50/70 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                  <span>📋 지도 항목별 발생 분포</span>
                </h3>
                <span className="text-xs text-gray-400">총 {itemDistributions.totalValid}건</span>
              </div>

              {itemDistributions.list.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-8">
                  등록된 지도 항목이 없습니다.
                </div>
              ) : (
                <div className="space-y-2.5 pt-1 max-h-[340px] overflow-y-auto pr-1">
                  {itemDistributions.list.map(({ item: it, count }) => {
                    const pct =
                      itemDistributions.maxItemCount > 0
                        ? Math.round((count / itemDistributions.maxItemCount) * 100)
                        : 0;

                    return (
                      <div
                        key={it.id}
                        className="p-2.5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center space-x-2">
                            <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                              {it.category || "기타"}
                            </span>
                            <span className="font-bold text-gray-900 dark:text-white">
                              {it.label}
                            </span>
                          </div>
                          <span className="font-extrabold text-blue-700 dark:text-blue-300">
                            {count}건
                          </span>
                        </div>

                        {/* 프로그레스 바 */}
                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(4, pct)}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* D. 주요 지도 대상 학생 (Col 6) */}
            <div className="lg:col-span-6 bg-gray-50/70 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center space-x-2">
                  <span>🚨 주요 지도 대상 학생 (상위 10명)</span>
                </h3>
                <span className="text-xs text-gray-400">단계 및 건수순</span>
              </div>

              {topStudents.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-8">
                  지정된 기간 내 지도 대상 학생이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[340px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-semibold">
                        <th className="py-2 px-2 text-center w-8">#</th>
                        <th className="py-2 px-2">학생 정보</th>
                        <th className="py-2 px-2">현재 단계</th>
                        <th className="py-2 px-2 text-center">건수</th>
                        <th className="py-2 px-2 text-right">최근 발생일</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {topStudents.map((st, idx) => {
                        const stageLabel = st.currentStage
                          ? st.currentStage.label
                          : "정상";
                        const dateStr = st.latestOccurredAt
                          ? new Date(st.latestOccurredAt).toLocaleDateString("ko-KR")
                          : "-";

                        return (
                          <tr
                            key={st.student.studentId}
                            onClick={() => onSelectStudent(st.student)}
                            className="hover:bg-blue-50/50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-2 text-center font-bold text-gray-400">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="font-bold text-sm text-gray-900 dark:text-white">
                                {st.student.studentName}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {st.student.grade}학년 {st.student.classNum}반 ({st.student.studentId})
                              </div>
                            </td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-bold inline-block ${
                                  st.currentStage
                                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                    : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                                }`}
                              >
                                {stageLabel}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-center font-extrabold text-blue-700 dark:text-blue-300 text-sm">
                              {st.validCount}건
                            </td>
                            <td className="py-2.5 px-2 text-right text-gray-600 dark:text-gray-300 text-xs">
                              {dateStr}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 뷰 2: 표로 보기 (피벗 테이블) ── */}
      {viewMode === "pivot" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
            <span>
              총 <strong>{pivotData.length}명</strong>의 학생 피벗 데이터 (행 클릭 시 상세 이력 모달)
            </span>
          </div>

          <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-xl max-h-[500px]">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 border-b border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold z-10">
                <tr>
                  <th className="p-3 w-20">학번</th>
                  <th className="p-3 w-24">이름</th>
                  <th className="p-3 w-16 text-center">학년</th>
                  <th className="p-3 w-16 text-center">반</th>
                  <th className="p-3 w-32">현재 단계</th>
                  {items.map((it) => (
                    <th key={it.id} className="p-3 text-center min-w-[90px]">
                      {it.label}
                    </th>
                  ))}
                  <th className="p-3 w-24 text-center font-extrabold text-blue-700 dark:text-blue-300">
                    기간 건수
                  </th>
                  <th className="p-3 w-28 text-right">최근 발생일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-800">
                {pivotData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6 + items.length}
                      className="p-8 text-center text-gray-400"
                    >
                      해당 조건에 해당하는 학생이 없습니다.
                    </td>
                  </tr>
                ) : (
                  pivotData.map((st) => {
                    const stageLabel = st.currentStage
                      ? st.currentStage.label
                      : "정상 (조치 단계 없음)";

                    const dateStr = st.latestOccurredAt
                      ? new Date(st.latestOccurredAt).toLocaleDateString("ko-KR")
                      : "-";

                    return (
                      <tr
                        key={st.student.studentId}
                        onClick={() => onSelectStudent(st.student)}
                        className="hover:bg-blue-50/50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors"
                      >
                        <td className="p-3 font-semibold text-gray-700 dark:text-gray-300">{st.student.studentId}</td>
                        <td className="p-3 font-bold text-gray-900 dark:text-white">
                          {st.student.studentName}
                        </td>
                        <td className="p-3 text-center">{st.student.grade}</td>
                        <td className="p-3 text-center">{st.student.classNum}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                              st.currentStage
                                ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                            }`}
                          >
                            {stageLabel}
                          </span>
                        </td>
                        {items.map((it) => {
                          const cnt = st.itemCountMap[it.id] || 0;
                          return (
                            <td
                              key={it.id}
                              className={`p-3 text-center font-medium ${
                                cnt > 0
                                  ? "text-blue-700 dark:text-blue-300 font-bold bg-blue-50/30 dark:bg-blue-900/10"
                                  : "text-gray-300 dark:text-gray-600"
                              }`}
                            >
                              {cnt > 0 ? `${cnt}건` : "-"}
                            </td>
                          );
                        })}
                        <td className="p-3 text-center font-extrabold text-blue-700 dark:text-blue-300 bg-blue-50/40 dark:bg-blue-900/20">
                          {st.validCount}건
                        </td>
                        <td className="p-3 text-right text-gray-600 dark:text-gray-300 text-xs">
                          {dateStr}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
