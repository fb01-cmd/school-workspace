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
  selectedCell: { grade: number; classNum: number; day: number; period: number; subjectName: string; simul?: string };
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
  partyRole?: "group_teacher" | "counterpart" | "venue_occupant";
  /** §5c-10 역방향 묶음 후보: 클릭한 칸(selectedCell)이 그룹 자리가 아니라 신청자의 일반 수업일 때.
   *  그룹의 출발·도착 칸이 정방향과 반대이므로 ➖➕ 앵커를 뒤집는다. 비묶음 후보는 항상 false. */
  reverse?: boolean;
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
  partyRole = "counterpart",
  reverse = false,
}: MiniPreviewGridProps) {
  const maxPeriod = Math.max(7, periodsPerDay || 7);
  const sourceStartDate = sourceWeekObj?.startDate || sourceWeekId;
  const targetStartDate = targetWeekObj?.startDate || targetWeekId;

  // 교차 주 패널 의미 (§5c-10): 상단 = 선택 칸의 주. 정방향에서는 그룹의 출발지이고
  // 역방향에서는 도착지다. 보는 사람(partyRole)별 빠짐·들어옴은 이 사실에서 도출한다.
  const topGroupOut = !reverse; // 상단 패널의 앵커 칸에서 그룹 수업이 빠져나가는가
  const topIsOut = partyRole === "group_teacher" ? topGroupOut : partyRole === "counterpart" ? !topGroupOut : false;
  const topIsIn = partyRole === "group_teacher" ? !topGroupOut : partyRole === "counterpart" ? topGroupOut : false;
  const topIsVenue = partyRole === "venue_occupant" && !topGroupOut; // 장소 겹침은 그룹 도착지에서
  const bottomIsOut = partyRole === "group_teacher" ? !topGroupOut : partyRole === "counterpart" ? topGroupOut : false;
  const bottomIsIn = partyRole === "group_teacher" ? topGroupOut : partyRole === "counterpart" ? !topGroupOut : false;
  const bottomIsVenue = partyRole === "venue_occupant" && topGroupOut;
  const panelChrome = (out: boolean, venue: boolean) => ({
    border: venue ? "border-red-300" : out ? "border-amber-200" : "border-emerald-200",
    head: venue
      ? "bg-red-50 text-red-950 border-red-200"
      : out
        ? "bg-amber-50 text-amber-900 border-amber-200"
        : "bg-emerald-50 text-emerald-900 border-emerald-200",
    tag: venue ? "text-red-900" : out ? "text-amber-900" : "text-emerald-800",
    label: venue ? "특별실 장소 겹침 ⚠️" : out ? "선생님 수업 빠짐 ➖" : "선생님 시간표에 들어옴 ➕",
  });
  const topChrome = panelChrome(topIsOut, topIsVenue);
  const bottomChrome = panelChrome(bottomIsOut, bottomIsVenue);

  return (
    <div className="space-y-3 font-sans text-gray-900">
      <div className="text-[11px] text-gray-500 flex flex-wrap gap-2.5">
        {partyRole === "venue_occupant" ? (
          <span className="inline-flex items-center gap-1 font-bold text-red-950">
            <span className="w-2.5 h-2.5 rounded bg-red-100 border border-red-500 inline-block" />
            ⚠️ 장소 겹침 (특별실 사용 시간 겹침)
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 font-bold text-amber-900">
              <span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400 inline-block" />
              ➖ 빠짐 (선생님 시간표에서 빠질 수업)
            </span>
            <span className="inline-flex items-center gap-1 font-bold text-emerald-900">
              <span className="w-2.5 h-2.5 rounded bg-emerald-200 border border-emerald-400 inline-block" />
              ➕ 들어옴 (선생님 시간표에 들어올 수업)
            </span>
          </>
        )}
      </div>

      {/* ① 같은 주 모드: 1단 미니 그리드 */}
      {!isCrossWeek && (
        <div className="border border-gray-200 rounded-lg overflow-hidden text-xs bg-white shadow-xs">
          <div className="bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 border-b border-gray-200 flex justify-between items-center">
            <span>🗓️ {getWeekRangeLabel(targetStartDate)} 시간표</span>
            <span className="text-[11px] font-semibold text-gray-500">{counterpartTitle} 주간 시간표</span>
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
                      {dateLabel && <div className="text-[11px] text-gray-400 font-normal">{dateLabel}</div>}
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
                      const isTargetRaw = applyingCandidate.targetDay === d.num && applyingCandidate.targetPeriod === period;
                      const isSourceRaw = selectedCell.day === d.num && selectedCell.period === period;
                      const hasLesson = matched.length > 0;

                      // 그룹 수업이 빠지는 칸·들어가는 칸 — 정방향은 (선택 칸→후보 칸), 역방향은 반대 (§5c-10)
                      const groupOutRaw = reverse ? isTargetRaw : isSourceRaw;
                      const groupInRaw = reverse ? isSourceRaw : isTargetRaw;
                      const isOutSlot = partyRole === "group_teacher" ? groupOutRaw : partyRole === "counterpart" ? groupInRaw : false;
                      const isInSlot = partyRole === "group_teacher" ? groupInRaw : partyRole === "counterpart" ? groupOutRaw : false;
                      const isVenueSlot = partyRole === "venue_occupant" && groupInRaw;

                      let cellStyle = "bg-white text-gray-400";
                      if (isOutSlot) {
                        cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                      } else if (isInSlot) {
                        cellStyle = "bg-emerald-100 border border-emerald-400 font-bold text-emerald-900";
                      } else if (isVenueSlot) {
                        cellStyle = "bg-red-50 border-2 border-red-500 font-bold text-red-950";
                      } else if (hasLesson) {
                        cellStyle = "bg-gray-100 text-gray-700 font-medium";
                      }

                      const cellTitle = hasLesson
                        ? `${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`
                        : undefined;

                      return (
                        <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`} title={cellTitle}>
                          {isOutSlot ? (
                            <div className="space-y-0.5">
                              <div className="text-[10px] font-extrabold text-amber-900">➖ 빠짐</div>
                              <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                {hasLesson ? `${matched[0].grade}-${matched[0].classNum}` : "수업"}
                              </div>
                            </div>
                          ) : isInSlot ? (
                            <div className="space-y-0.5">
                              <div className="text-[10px] font-extrabold text-emerald-900">➕ 들어옴</div>
                              <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                {selectedCell.grade}-{selectedCell.classNum}
                              </div>
                            </div>
                          ) : isVenueSlot ? (
                            <div className="space-y-0.5">
                              <div className="text-[10px] font-extrabold text-red-900">⚠️ 장소 겹침</div>
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
      )}

      {/* ② 교차 주 모드: 2단 미니 그리드 (상단: 소스 주 ➕들어옴 / 하단: 대상 주 ➖빠짐) */}
      {isCrossWeek && (
        <div className="space-y-2.5">
          {/* [상단] 소스 주(선택 칸의 주) 상대 시간표 */}
          <div className={`border rounded-lg overflow-hidden text-xs bg-white shadow-xs ${topChrome.border}`}>
            <div className={`px-2 py-1 text-[11px] font-bold border-b flex justify-between items-center ${topChrome.head}`}>
              <span>🗓️ {getWeekRangeLabel(sourceStartDate)} 주 시간표</span>
              <span className={`text-[11px] font-extrabold ${topChrome.tag}`}>{topChrome.label}</span>
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
                        {dateLabel && <div className="text-[11px] text-gray-400 font-normal">{dateLabel}</div>}
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

                        const isOut = topIsOut && isSourceSlot;
                        const isIn = topIsIn && isSourceSlot;
                        const isVenue = topIsVenue && isSourceSlot;

                        let cellStyle = "bg-white text-gray-400";
                        if (isOut) {
                          cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                        } else if (isIn) {
                          cellStyle = "bg-emerald-100 border border-emerald-400 font-bold text-emerald-900";
                        } else if (isVenue) {
                          cellStyle = "bg-red-50 border-2 border-red-500 font-bold text-red-950";
                        } else if (hasLesson) {
                          cellStyle = "bg-gray-100 text-gray-700 font-medium";
                        }

                        const cellTitle = hasLesson
                          ? `${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`
                          : undefined;

                        return (
                          <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`} title={cellTitle}>
                            {isOut ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-extrabold text-amber-900">➖ 빠짐</div>
                                <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                  {hasLesson ? `${matched[0].grade}-${matched[0].classNum}` : "수업"}
                                </div>
                              </div>
                            ) : isIn ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-extrabold text-emerald-900">➕ 들어옴</div>
                                <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                  {selectedCell.grade}-{selectedCell.classNum}
                                </div>
                              </div>
                            ) : isVenue ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-extrabold text-red-900">⚠️ 장소 겹침</div>
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

          {/* [하단] 교체 대상 주(후보 칸의 주) 상대 시간표 */}
          <div className={`border rounded-lg overflow-hidden text-xs bg-white shadow-xs ${bottomChrome.border}`}>
            <div className={`px-2 py-1 text-[11px] font-bold border-b flex justify-between items-center ${bottomChrome.head}`}>
              <span>🗓️ {getWeekRangeLabel(targetStartDate)} 주 시간표</span>
              <span className={`text-[11px] font-extrabold ${bottomChrome.tag}`}>{bottomChrome.label}</span>
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
                        {dateLabel && <div className="text-[11px] text-gray-400 font-normal">{dateLabel}</div>}
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

                        const isOut = bottomIsOut && isTargetSlot;
                        const isIn = bottomIsIn && isTargetSlot;
                        const isVenue = bottomIsVenue && isTargetSlot;

                        let cellStyle = "bg-white text-gray-400";
                        if (isOut) {
                          cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                        } else if (isIn) {
                          cellStyle = "bg-emerald-100 border border-emerald-400 font-bold text-emerald-900";
                        } else if (isVenue) {
                          cellStyle = "bg-red-50 border-2 border-red-500 font-bold text-red-950";
                        } else if (hasLesson) {
                          cellStyle = "bg-gray-100 text-gray-700 font-medium";
                        }

                        const cellTitle = hasLesson
                          ? `${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`
                          : undefined;

                        return (
                          <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`} title={cellTitle}>
                            {isOut ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-extrabold text-amber-900">➖ 빠짐</div>
                                <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                  {hasLesson ? `${matched[0].grade}-${matched[0].classNum}` : "수업"}
                                </div>
                              </div>
                            ) : isIn ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-extrabold text-emerald-900">➕ 들어옴</div>
                                <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                                  {selectedCell.grade}-{selectedCell.classNum}
                                </div>
                              </div>
                            ) : isVenue ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] font-extrabold text-red-900">⚠️ 장소 겹침</div>
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
