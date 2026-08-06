"use client";

import { TeacherTimetableCell, TimetableWeek } from "@/lib/timetable/types";
import { getDayDateLabel, getWeekRangeLabel } from "@/lib/timetable/utils";

export const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

export interface MiniPreviewGridProps {
  isCrossWeek: boolean;
  sourceWeekId: string;
  targetWeekId: string;
  sourceWeekObj?: TimetableWeek | null;
  targetWeekObj?: TimetableWeek | null;
  selectedCell: { grade: number; classNum: number; day: number; period: number; subjectName: string };
  applyingCandidate: {
    targetDay?: number;
    targetPeriod?: number;
    counterpartName?: string;
    counterpartSubjectName?: string;
  };
  periodsPerDay: number;
  previewCells?: TeacherTimetableCell[] | null;
  counterpartSourceCells?: TeacherTimetableCell[] | null;
  counterpartTargetCells?: TeacherTimetableCell[] | null;
  counterpartTitle?: string;
}

/**
 * 공용 미니 시간표 미리보기 그리드 (화면 후보 선택 및 오프스크린 양해 공유 카드 양쪽에서 공용 렌더링)
 * - 같은-주: 1단 그리드 (상대 실수업 + ➕/➖ 배지)
 * - 교차 주: 2단 그리드 ([상단] 소스 주 ➕들어옴 / [하단] 대상 주 ➖빠짐, 날짜 헤더 포함)
 */
export default function MiniPreviewGrid({
  isCrossWeek,
  sourceWeekId,
  targetWeekId,
  sourceWeekObj,
  targetWeekObj,
  selectedCell,
  applyingCandidate,
  periodsPerDay,
  previewCells,
  counterpartSourceCells,
  counterpartTargetCells,
  counterpartTitle = "선생님",
}: MiniPreviewGridProps) {
  const maxPeriod = Math.max(7, periodsPerDay || 7);
  const sourceStartDate = sourceWeekObj?.startDate || sourceWeekId;
  const targetStartDate = targetWeekObj?.startDate || targetWeekId;

  return (
    <div className="space-y-3 font-sans text-gray-900">
      <div className="text-[10px] text-gray-500 flex flex-wrap gap-2.5">
        <span className="inline-flex items-center gap-1 font-bold text-amber-900">
          <span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400 inline-block" />
          ➖ 빠짐 (선생님 시간표에서 빠질 수업)
        </span>
        <span className="inline-flex items-center gap-1 font-bold text-emerald-900">
          <span className="w-2.5 h-2.5 rounded bg-emerald-200 border border-emerald-400 inline-block" />
          ➕ 들어옴 (선생님 시간표에 들어올 수업)
        </span>
      </div>

      {/* ① 같은 주 모드: 1단 미니 그리드 */}
      {!isCrossWeek && (
        <div className="border border-gray-200 rounded-lg overflow-hidden text-xs bg-white shadow-xs">
          <div className="bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 border-b border-gray-200 flex justify-between items-center">
            <span>🗓️ {getWeekRangeLabel(targetStartDate)} 시간표</span>
            <span className="text-[10px] font-semibold text-gray-500">{counterpartTitle} 주간 시간표</span>
          </div>
          <table className="w-full table-fixed border-collapse text-center">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
                <th className="py-1 px-0.5 border-r border-gray-200 w-8 text-xs">교시</th>
                {DAYS.map((d) => {
                  const dateLabel = getDayDateLabel(targetStartDate, d.num);
                  return (
                    <th key={d.num} className="py-1 px-0.5 w-1/5 text-xs">
                      <div>{d.label}</div>
                      {dateLabel && <div className="text-[10px] text-gray-400 font-normal">{dateLabel}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxPeriod }).map((_, idx) => {
                const period = idx + 1;
                return (
                  <tr key={period} className="border-b border-gray-100 last:border-0">
                    <td className="py-1 px-0.5 border-r border-gray-200 bg-gray-50 font-bold text-gray-500 text-xs align-middle w-8">{period}</td>
                    {DAYS.map((d) => {
                      const matched = (previewCells || []).filter((c) => c.day === d.num && c.period === period);
                      const isTargetSlot = applyingCandidate.targetDay === d.num && applyingCandidate.targetPeriod === period;
                      const isSourceSlot = selectedCell.day === d.num && selectedCell.period === period;
                      const hasLesson = matched.length > 0;

                      let cellStyle = "bg-white text-gray-400";
                      if (isTargetSlot) {
                        cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                      } else if (isSourceSlot) {
                        cellStyle = "bg-emerald-100 border border-emerald-400 font-bold text-emerald-900";
                      } else if (hasLesson) {
                        cellStyle = "bg-gray-100 text-gray-700 font-medium";
                      }

                      const cellTitle = hasLesson
                        ? `${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`
                        : undefined;

                      return (
                        <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`} title={cellTitle}>
                          {isTargetSlot ? (
                            <div className="space-y-0.5">
                              <div className="text-[9px] font-extrabold text-amber-900">➖ 빠짐</div>
                              <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                {hasLesson ? `${matched[0].grade}-${matched[0].classNum}` : "수업"}
                              </div>
                            </div>
                          ) : isSourceSlot ? (
                            <div className="space-y-0.5">
                              <div className="text-[9px] font-extrabold text-emerald-900">➕ 들어옴</div>
                              <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                {selectedCell.grade}-{selectedCell.classNum}
                              </div>
                            </div>
                          ) : hasLesson ? (
                            <div className="truncate max-w-[48px] mx-auto font-bold text-[11px]">
                              {matched[0].grade}-{matched[0].classNum}
                            </div>
                          ) : (
                            "-"
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

      {/* ② 교차 주 모드: 2단 미니 그리드 (상단: 소스 주 ➕들어옴 / 하단: 대상 주 ➖빠짐) */}
      {isCrossWeek && (
        <div className="space-y-2.5">
          {/* [상단] 소스 주 상대 시간표 (내 수업이 상대에게 들어옴 ➕) */}
          <div className="border border-emerald-200 rounded-lg overflow-hidden text-xs bg-white shadow-xs">
            <div className="bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-900 border-b border-emerald-200 flex justify-between items-center">
              <span>🗓️ {getWeekRangeLabel(sourceStartDate)} 주 시간표</span>
              <span className="text-[10px] text-emerald-800 font-extrabold">선생님 시간표에 들어옴 ➕</span>
            </div>
            <table className="w-full table-fixed border-collapse text-center">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
                  <th className="py-1 px-0.5 border-r border-gray-200 w-8 text-xs">교시</th>
                  {DAYS.map((d) => {
                    const dateLabel = getDayDateLabel(sourceStartDate, d.num);
                    return (
                      <th key={d.num} className="py-1 px-0.5 w-1/5 text-xs">
                        <div>{d.label}</div>
                        {dateLabel && <div className="text-[10px] text-gray-400 font-normal">{dateLabel}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxPeriod }).map((_, idx) => {
                  const period = idx + 1;
                  return (
                    <tr key={period} className="border-b border-gray-100 last:border-0">
                      <td className="py-1 px-0.5 border-r border-gray-200 bg-gray-50 font-bold text-gray-500 text-xs align-middle w-8">{period}</td>
                      {DAYS.map((d) => {
                        const matched = (counterpartSourceCells || []).filter((c) => c.day === d.num && c.period === period);
                        const isSourceSlot = selectedCell.day === d.num && selectedCell.period === period;
                        const hasLesson = matched.length > 0;

                        let cellStyle = "bg-white text-gray-400";
                        if (isSourceSlot) {
                          cellStyle = "bg-emerald-100 border border-emerald-400 font-bold text-emerald-900";
                        } else if (hasLesson) {
                          cellStyle = "bg-gray-100 text-gray-700 font-medium";
                        }

                        const cellTitle = hasLesson
                          ? `${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`
                          : undefined;

                        return (
                          <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`} title={cellTitle}>
                            {isSourceSlot ? (
                              <div className="space-y-0.5">
                                <div className="text-[9px] font-extrabold text-emerald-900">➕ 들어옴</div>
                                <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                  {selectedCell.grade}-{selectedCell.classNum}
                                </div>
                              </div>
                            ) : hasLesson ? (
                              <div className="truncate max-w-[48px] mx-auto font-bold text-[11px]">
                                {matched[0].grade}-{matched[0].classNum}
                              </div>
                            ) : (
                              "-"
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

          {/* [하단] 교체 대상 주 상대 시간표 (상대 원래 수업이 빠짐 ➖) */}
          <div className="border border-amber-200 rounded-lg overflow-hidden text-xs bg-white shadow-xs">
            <div className="bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-900 border-b border-amber-200 flex justify-between items-center">
              <span>🗓️ {getWeekRangeLabel(targetStartDate)} 주 시간표</span>
              <span className="text-[10px] text-amber-900 font-extrabold">선생님 수업 빠짐 ➖</span>
            </div>
            <table className="w-full table-fixed border-collapse text-center">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
                  <th className="py-1 px-0.5 border-r border-gray-200 w-8 text-xs">교시</th>
                  {DAYS.map((d) => {
                    const dateLabel = getDayDateLabel(targetStartDate, d.num);
                    return (
                      <th key={d.num} className="py-1 px-0.5 w-1/5 text-xs">
                        <div>{d.label}</div>
                        {dateLabel && <div className="text-[10px] text-gray-400 font-normal">{dateLabel}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxPeriod }).map((_, idx) => {
                  const period = idx + 1;
                  return (
                    <tr key={period} className="border-b border-gray-100 last:border-0">
                      <td className="py-1 px-0.5 border-r border-gray-200 bg-gray-50 font-bold text-gray-500 text-xs align-middle w-8">{period}</td>
                      {DAYS.map((d) => {
                        const matched = (counterpartTargetCells || []).filter((c) => c.day === d.num && c.period === period);
                        const isTargetSlot = applyingCandidate.targetDay === d.num && applyingCandidate.targetPeriod === period;
                        const hasLesson = matched.length > 0;

                        let cellStyle = "bg-white text-gray-400";
                        if (isTargetSlot) {
                          cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                        } else if (hasLesson) {
                          cellStyle = "bg-gray-100 text-gray-700 font-medium";
                        }

                        const cellTitle = hasLesson
                          ? `${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`
                          : undefined;

                        return (
                          <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`} title={cellTitle}>
                            {isTargetSlot ? (
                              <div className="space-y-0.5">
                                <div className="text-[9px] font-extrabold text-amber-900">➖ 빠짐</div>
                                <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                  {hasLesson ? `${matched[0].grade}-${matched[0].classNum}` : "수업"}
                                </div>
                              </div>
                            ) : hasLesson ? (
                              <div className="truncate max-w-[48px] mx-auto font-bold text-[11px]">
                                {matched[0].grade}-{matched[0].classNum}
                              </div>
                            ) : (
                              "-"
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
      )}
    </div>
  );
}
