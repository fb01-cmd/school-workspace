"use client";

/**
 * Phase 9b 순서 4: 교사 신청 화면 — "내 시간표" 메뉴
 *
 * 스펙: phase9b_spec.md §7, §4-4
 * 탭 구성:
 *   ① 내 주간시간표  — 변경 셀 빨간 배경 + 텍스트 마커, 마우스오버 툴팁
 *                    셀 클릭 → 후보 초록 하이라이트 → 신청 플로우
 *   ② 내 신청 내역  — my_list, PENDING 취소 버튼
 *   ③ 다른 시간표 조회 — 주간 합성본 지원
 *
 * 노출 게이트: managerEmails·super_admin + teacherOpen 플래그 true 시 전 교사
 * 학생은 어떤 경우에도 미노출 (서버 라우트도 학생 차단)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { toBlob } from "html-to-image";
import {
  SWAP_REASON_TYPES,
  SwapCandidate,
  SwapCandidatesResult,
  SwapCandidatesAllResult,
  SwapDraft,
  SwapRequest,
  SwapRequestReason,
  SwapBatchItemResult,
  ProjectedDayLoad,
  SubstituteCandidate,
  TeacherTimetableCell,
  TimetableSettings,
  TimetableWeek,
} from "@/lib/timetable/types";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import {
  DAY_LABEL,
  getDayDateLabel,
  getWeekRangeLabel,
  formatSlotWithDate,
  buildShareCardMessage,
} from "@/lib/timetable/utils";

const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

/** 주 목록에서 기본 선택할 주 ID 계산 (현재 주 → 가장 가까운 미래 주 → 첫 주) */
function findDefaultWeekId(weeks: TimetableWeek[]): string {
  if (!weeks || weeks.length === 0) return "";

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayStr = `${year}-${month}-${day}`;

  // ① 오늘 날짜가 속한 주 (startDate ~ startDate + 6일)
  const currentWeek = weeks.find((w) => {
    if (!w.startDate) return false;
    const parts = w.startDate.split("-").map((v) => parseInt(v, 10));
    if (parts.length < 3 || isNaN(parts[0])) return false;
    const startObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const endObj = new Date(startObj);
    endObj.setDate(endObj.getDate() + 6); // 일요일까지

    const endY = endObj.getFullYear();
    const endM = String(endObj.getMonth() + 1).padStart(2, "0");
    const endD = String(endObj.getDate()).padStart(2, "0");
    const endStr = `${endY}-${endM}-${endD}`;

    return todayStr >= w.startDate && todayStr <= endStr;
  });

  if (currentWeek) return currentWeek.id;

  // ② 없으면 가장 가까운 미래 주 (startDate > todayStr 중 가장 빠른 날짜)
  const futureWeeks = weeks
    .filter((w) => w.startDate && w.startDate > todayStr)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (futureWeeks.length > 0) return futureWeeks[0].id;

  // ③ 그것도 없으면 첫 번째 주
  return weeks[0].id;
}

export interface ShareCardData {
  requesterName: string;
  sourceWeekId: string;
  targetWeekId?: string;
  sourceWeekObj?: TimetableWeek | null;
  targetWeekObj?: TimetableWeek | null;
  source: { grade: number; classNum: number; day: number; period: number; subjectName: string };
  candidate: {
    targetDay?: number;
    targetPeriod?: number;
    counterpartEmail?: string;
    counterpartName?: string;
    counterpartSubjectName?: string;
  };
  previewCells?: TeacherTimetableCell[] | null;
  counterpartSourceCells?: TeacherTimetableCell[] | null;
  counterpartTargetCells?: TeacherTimetableCell[] | null;
  periodsPerDay?: number;
}

interface MiniPreviewGridProps {
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
function MiniPreviewGrid({
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
              <span>🗓️ 소스 주 ({getWeekRangeLabel(sourceStartDate)}) 시간표</span>
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
              <span>🗓️ 대상 주 ({getWeekRangeLabel(targetStartDate)}) 시간표</span>
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

/**
 * 사전 양해 요청 공유 카드 DOM (offscreen 렌더링 — display:none 금지, position:absolute; left:-9999px 사용)
 * 공유 카드 v2: 수신자(상대 교사) 관점으로 문구 및 일정 전면 반전 + 공용 MiniPreviewGrid 수록
 */
function OffscreenShareCard({
  cardRef,
  data,
}: {
  cardRef: React.RefObject<HTMLDivElement | null>;
  data: ShareCardData | null;
}) {
  if (!data) {
    return <div ref={cardRef} style={{ position: "absolute", left: "-9999px", top: "-9999px", pointerEvents: "none" }} />;
  }

  const sourceSlotStr = formatSlotWithDate(data.sourceWeekId, data.source.day, data.source.period);
  const targetWeek = data.targetWeekId || data.sourceWeekId;
  const targetSlotStr = formatSlotWithDate(targetWeek, data.candidate.targetDay, data.candidate.targetPeriod);

  const counterpartTitle = data.candidate.counterpartName
    ? `${data.candidate.counterpartName} 선생님`
    : "선생님";

  const counterpartLessonName = data.candidate.counterpartSubjectName
    ? `${data.source.grade}-${data.source.classNum}반 ${data.candidate.counterpartSubjectName}`
    : "수업";

  const isCrossWeek = !!(data.targetWeekId && data.targetWeekId !== data.sourceWeekId);

  return (
    <div style={{ position: "absolute", left: "-9999px", top: "-9999px", pointerEvents: "none" }}>
      <div
        ref={cardRef}
        className="w-[520px] bg-white border border-indigo-200 rounded-2xl p-5 shadow-xl space-y-4 font-sans text-gray-900"
      >
        <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-800 text-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-[10px] font-bold text-indigo-200 tracking-wider">HYOMYUNG HIGH SCHOOL</div>
          <div className="text-lg font-black mt-0.5 tracking-tight">수업교환 양해 요청</div>
        </div>

        <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3.5 space-y-1 text-xs">
          <div className="font-extrabold text-indigo-950 text-sm">
            안녕하세요, {counterpartTitle}! 👋
          </div>
          <div className="text-gray-700 leading-relaxed text-xs">
            <span className="font-bold text-indigo-900">{data.requesterName} 교사</span>입니다.<br />
            아래 일정으로 수업 교체가 가능할까요? 😊
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl p-3.5 space-y-2.5 text-xs bg-gray-50/40">
          <div className="font-bold text-gray-800 border-b border-gray-200 pb-1.5 flex items-center justify-between">
            <span>🔄 수업교환 상세 일정 (선생님 기준)</span>
            {data.targetWeekId && data.targetWeekId !== data.sourceWeekId && (
              <span className="text-[10px] bg-indigo-100 text-indigo-800 font-extrabold px-2 py-0.5 rounded-full border border-indigo-200">
                ↔ {data.targetWeekId} 주 교차 주
              </span>
            )}
          </div>
          <div className="space-y-2 pt-0.5">
            {/* 1행: 상대 교사의 수업 이동 */}
            <div className="flex items-start justify-between bg-amber-50/90 border border-amber-200 rounded-lg p-2.5">
              <div>
                <div className="text-[11px] font-extrabold text-amber-800">
                  선생님의 수업 (이동)
                </div>
                <div className="font-bold text-gray-900 text-sm mt-0.5">
                  선생님의 {counterpartLessonName}
                </div>
                <div className="text-amber-900 font-bold text-xs mt-0.5">
                  {targetSlotStr} → {sourceSlotStr}로 이동
                </div>
              </div>
              <span className="text-amber-800 font-extrabold text-[11px] bg-amber-100 border border-amber-300 px-2 py-1 rounded shrink-0">
                선생님 수업
              </span>
            </div>

            {/* 2행: 신청자 교사의 수업 이동 */}
            <div className="flex items-start justify-between bg-emerald-50/90 border border-emerald-200 rounded-lg p-2.5">
              <div>
                <div className="text-[11px] font-extrabold text-emerald-800">
                  제 수업 (이동)
                </div>
                <div className="font-bold text-gray-900 text-sm mt-0.5">
                  제 {data.source.grade}-{data.source.classNum}반 {data.source.subjectName}
                </div>
                <div className="text-emerald-900 font-bold text-xs mt-0.5">
                  {sourceSlotStr} → {targetSlotStr}로 이동
                </div>
              </div>
              <span className="text-emerald-800 font-extrabold text-[11px] bg-emerald-100 border border-emerald-300 px-2 py-1 rounded shrink-0">
                제 수업
              </span>
            </div>
          </div>
        </div>

        {/* 상대 시간표 미리보기 미니 그리드 (공용 MiniPreviewGrid 컴포넌트 사용) */}
        <MiniPreviewGrid
          isCrossWeek={isCrossWeek}
          sourceWeekId={data.sourceWeekId}
          targetWeekId={data.targetWeekId || data.sourceWeekId}
          sourceWeekObj={data.sourceWeekObj}
          targetWeekObj={data.targetWeekObj}
          selectedCell={data.source}
          applyingCandidate={data.candidate}
          periodsPerDay={data.periodsPerDay || 7}
          previewCells={data.previewCells}
          counterpartSourceCells={data.counterpartSourceCells}
          counterpartTargetCells={data.counterpartTargetCells}
          counterpartTitle={counterpartTitle}
        />

        <div className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-2 font-medium">
          효명고등학교 학적 & 일과진행 시스템
        </div>
      </div>
    </div>
  );
}

/**
 * 오프스크린 공유 카드 DOM을 PNG 이미지로 복사/다운로드하는 공용 헬퍼 함수
 * 1. navigator.clipboard.write 지원 시 클립보드 직접 복사 시도
 * 2. 권한 거부(NotAllowedError) 또는 미지원 시 생성된 blob으로 PNG 자동 다운로드 폴백 실행
 */
async function copyShareImageElement(node: HTMLDivElement | null): Promise<void> {
  if (!node) return;
  let blob: Blob | null = null;
  try {
    blob = await toBlob(node, { pixelRatio: 2, cacheBust: true });
    if (!blob) throw new Error("이미지 생성 실패");

    if (typeof window !== "undefined" && navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      alert("양해 요청 이미지가 클립보드에 복사되었습니다! 메신저나 구글 챗에 Ctrl+V로 붙여넣으세요. 😊");
      return;
    }
  } catch (clipboardErr: any) {
    console.warn("[copyShareImageElement] Clipboard write failed, trying PNG download fallback:", clipboardErr);
  }

  // 폴백: 클립보드 쓰기 실패(NotAllowedError 포함) 또는 API 미지원 시 PNG 파일 다운로드
  if (blob) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `수업교환_양해요청_${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      URL.revokeObjectURL(url);
      alert("클립보드 직접 복사가 제한되어 PNG 이미지 파일로 자동 다운로드되었습니다.");
      return;
    } catch (downloadErr: any) {
      alert(`이미지 파일 다운로드 실패: ${downloadErr.message}`);
      return;
    }
  }

  alert("양해 요청 이미지를 생성하지 못했습니다.");
}

// ── ① 내 주간시간표 탭 (v2.1: 전 주 인라인 후보 하이라이트 & candidates_all 연동) ─────
interface MyTimetableTabProps {
  periodsPerDay: number;
  settings: TimetableSettings | null;
}

interface ProjectedWeek {
  weekId: string;
  startDate: string;
  days: { num: number; label: string }[];
  cells: TeacherTimetableCell[];
  dayLoads: ProjectedDayLoad[];
}

function MyTimetableTab({ periodsPerDay, settings }: MyTimetableTabProps) {
  const { user, userData, teacherProfile } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";
  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);

  // 주 목록
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [targetWeekId, setTargetWeekId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §14-2 v2: 등록 전 주 예상 내 시간표 상태 (my_projected)
  const [projectedData, setProjectedData] = useState<{
    termId: string;
    weeks: ProjectedWeek[];
    assumedPendingCount: number;
    assumedDraftCount: number;
  } | null>(null);

  // §14-2 v2.1: 전 주 후보 일괄 결과 상태 (candidates_all)
  const [candidatesAllResult, setCandidatesAllResult] = useState<SwapCandidatesAllResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // 유효 대상 주 계산 (교차 주 지원)
  const effectiveTargetWeekId = targetWeekId || selectedWeekId;
  const isCrossWeek = effectiveTargetWeekId !== "" && effectiveTargetWeekId !== selectedWeekId;

  const sourceWeekObj = weeks.find((w) => w.id === selectedWeekId);
  const targetWeekObj = weeks.find((w) => w.id === effectiveTargetWeekId);

  // 소스 셀 클릭 상태 (선택된 셀 + 속한 주 ID)
  const [selectedCell, setSelectedCell] = useState<(TeacherTimetableCell & { weekId: string }) | null>(null);

  // 호버/선택 후보 및 신청 사유
  const [applyingCandidate, setApplyingCandidate] = useState<SwapCandidate | null>(null);
  const [reason, setReason] = useState<SwapRequestReason>({ type: "출장" });
  const [batchReason, setBatchReason] = useState<SwapRequestReason>({ type: "출장" });
  const [submitting, setSubmitting] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  const [shareCardData, setShareCardData] = useState<ShareCardData | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);

  // 상대 교사 시간표 미리보기 상태
  const [previewCells, setPreviewCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartSourceCells, setCounterpartSourceCells] = useState<TeacherTimetableCell[] | null>(null);
  const [counterpartTargetCells, setCounterpartTargetCells] = useState<TeacherTimetableCell[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewCacheRef = useRef<Map<string, TeacherTimetableCell[]>>(new Map());

  // §14-2 v2: my_projected 전 주 예상 시간표 로드
  const fetchMyProjected = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "my_projected",
          includeMyPending: true,
          includeDrafts: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectedData({
          termId: data.termId || "",
          weeks: data.weeks || [],
          assumedPendingCount: data.assumedPendingCount || 0,
          assumedDraftCount: data.assumedDraftCount || 0,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "예상 시간표를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyProjected();
  }, [fetchMyProjected]);

  useEffect(() => {
    const termId = settings?.activeTermId;
    if (!termId) return;
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) {
          const loadedWeeks: TimetableWeek[] = data.weeks || [];
          setWeeks(loadedWeeks);
          if (loadedWeeks.length > 0) {
            const defaultId = findDefaultWeekId(loadedWeeks);
            if (defaultId) {
              setSelectedWeekId((prev) => (prev ? prev : defaultId));
            }
          }
        }
      })
      .catch(() => {});
  }, [settings?.activeTermId]);

  // §14-2 v2.1: candidates_all 1회 호출로 전 주 맞교환 후보 계산
  const fetchCandidatesAll = useCallback(async (cell: TeacherTimetableCell, srcWeekId: string) => {
    setCandidatesAllResult(null);
    setCandidatesError(null);
    setCandidatesLoading(true);
    setApplyingCandidate(null);
    setSubmitResult(null);
    setPreviewCells(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "candidates_all",
          weekId: srcWeekId,
          includeMyPending: true,
          includeDrafts: true,
          source: {
            grade: cell.grade,
            classNum: cell.classNum,
            day: cell.day,
            period: cell.period,
            subjectName: cell.subjectName,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCandidatesAllResult(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setCandidatesError(err.error || "전 주 맞교환 후보를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setCandidatesError(`오류: ${e.message}`);
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  const handleCellClick = (cell: TeacherTimetableCell, srcWeekId: string) => {
    setSelectedCell({ ...cell, weekId: srcWeekId });
    setSelectedWeekId(srcWeekId);
    setTargetWeekId(srcWeekId);
    fetchCandidatesAll(cell, srcWeekId);
  };

  // 초안 셀 삭제 (draft_delete -> my_projected 원복)
  const handleDeleteDraftById = async (draftId: string) => {
    if (!confirm("이 임시저장 초안을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId }),
      });
      if (res.ok) {
        await fetchMyProjected();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`초안 삭제 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    }
  };

  // §14-2 v2.1: 인라인 후보 클릭 = draft_save 실행 ➔ my_projected 갱신
  const handleSelectCandidateAndSave = async (sc: SwapCandidate, tgtWeekId: string) => {
    if (!selectedCell) return;
    setApplyingCandidate(sc);
    setTargetWeekId(tgtWeekId);
    setSavingDraft(true);
    try {
      const srcWeekId = selectedCell.weekId;
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_save",
          draft: {
            sourceWeekId: srcWeekId,
            targetWeekId: tgtWeekId !== srcWeekId ? tgtWeekId : undefined,
            source: {
              grade: selectedCell.grade,
              classNum: selectedCell.classNum,
              day: selectedCell.day,
              period: selectedCell.period,
              subjectName: selectedCell.subjectName,
            },
            candidate: {
              type: "swap",
              targetDay: sc.targetDay,
              targetPeriod: sc.targetPeriod,
              targetWeekId: tgtWeekId !== srcWeekId ? tgtWeekId : undefined,
              counterpartEmail: sc.counterpartEmail,
              counterpartName: sc.counterpartName,
              counterpartSubjectName: sc.counterpartSubjectName,
              score: sc.score,
              penalties: sc.penalties,
            },
            reason: reason,
          },
        }),
      });
      if (res.ok) {
        await fetchMyProjected();
        setApplyingCandidate(null);
        setSelectedCell(null);
        setCandidatesAllResult(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`초안 저장 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    } finally {
      setSavingDraft(false);
    }
  };

  // 상단 일괄 제출 (create_batch -> my_projected 갱신)
  const handleBatchSubmitFromHeader = async () => {
    if (batchReason.type === "기타" && !batchReason.note?.trim()) {
      alert("신청 사유(기타) 상세 내용을 입력해 주세요.");
      return;
    }

    try {
      const draftRes = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list" }),
      });
      if (!draftRes.ok) throw new Error("초안 목록을 불러올 수 없습니다.");
      const draftData = await draftRes.json();
      const activeDrafts: SwapDraft[] = draftData.drafts || [];
      if (activeDrafts.length === 0) {
        alert("일괄 신청할 임시저장 초안이 없습니다. 시간표 셀을 클릭하여 교환안을 임시저장해 주세요.");
        return;
      }

      if (!confirm(`등록된 주간 전체의 임시저장 초안 ${activeDrafts.length}건을 한 번에 일괄 신청(일과계 제출)하시겠습니까?`)) {
        return;
      }

      setSubmittingBatch(true);
      setSubmitResult(null);

      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_batch",
          items: activeDrafts.map((d) => ({
            draftId: d.id,
            weekId: d.sourceWeekId,
            targetWeekId: d.targetWeekId,
            type: "swap",
            source: d.source,
            candidate: d.candidate,
          })),
          reason: batchReason,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const okCount = data.createdCount || 0;
        const results: SwapBatchItemResult[] = data.results || [];
        const failCount = results.filter((r) => !r.ok).length;

        setSubmitResult(`🚀 ${okCount}건의 수업교환 신청이 성공적으로 일괄 접수되었습니다.${failCount > 0 ? ` (${failCount}건 거부됨)` : ""}`);
        await fetchMyProjected();
      } else {
        setSubmitResult(`❌ 일괄 신청 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } catch (e: any) {
      setSubmitResult(`❌ 오류: ${e.message}`);
    } finally {
      setSubmittingBatch(false);
    }
  };

  const handleSingleSubmit = async () => {
    if (!applyingCandidate || !selectedCell) return;
    if (reason.type === "기타" && !reason.note?.trim()) {
      alert("\"기타\" 사유는 내용을 반드시 입력해야 합니다.");
      return;
    }
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const swapC = applyingCandidate;
      const candidate = {
        targetDay: swapC.targetDay,
        targetPeriod: swapC.targetPeriod,
        counterpartEmail: swapC.counterpartEmail,
        counterpartName: swapC.counterpartName,
        counterpartSubjectName: swapC.counterpartSubjectName,
        score: swapC.score,
        penalties: swapC.penalties,
      };

      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          weekId: selectedCell.weekId,
          targetWeekId: isCrossWeek ? effectiveTargetWeekId : undefined,
          type: "swap",
          source: {
            grade: selectedCell.grade,
            classNum: selectedCell.classNum,
            day: selectedCell.day,
            period: selectedCell.period,
            subjectName: selectedCell.subjectName,
          },
          candidate,
          reason,
        }),
      });
      if (res.ok) {
        setSubmitResult("✅ 수업교환 신청이 완료되었습니다. 일과계에서 검토 후 처리됩니다.");
        await fetchMyProjected();
        setApplyingCandidate(null);
        setSelectedCell(null);
        setCandidatesAllResult(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setSubmitResult(`❌ 신청 실패: ${err.error || "알 수 없는 오류"}`);
      }
    } catch (e: any) {
      setSubmitResult(`❌ 오류: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyShareImage = (data: ShareCardData) => {
    setShareCardData(data);
    setTimeout(() => {
      copyShareImageElement(shareCardRef.current);
    }, 100);
  };

  // 후보 선택 시 상대 교사 시간표 미리보기 로드
  useEffect(() => {
    if (!applyingCandidate) {
      setPreviewCells(null);
      setCounterpartSourceCells(null);
      setCounterpartTargetCells(null);
      setPreviewError(null);
      return;
    }
    const counterpartEmail = applyingCandidate.counterpartEmail;
    if (!counterpartEmail) return;

    const fetchTeacherWeek = async (wId: string) => {
      const cacheKey = `${counterpartEmail}_${wId}`;
      if (previewCacheRef.current.has(cacheKey)) {
        return previewCacheRef.current.get(cacheKey)!;
      }
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "teacher",
          teacherEmail: counterpartEmail,
          weekId: wId || undefined,
        }),
      });
      if (!res.ok) throw new Error("시간표를 불러올 수 없습니다.");
      const data = await res.json();
      const fetched: TeacherTimetableCell[] = data.data?.cells || [];
      previewCacheRef.current.set(cacheKey, fetched);
      return fetched;
    };

    setPreviewLoading(true);
    setPreviewError(null);

    if (!isCrossWeek) {
      fetchTeacherWeek(effectiveTargetWeekId)
        .then((fetched) => setPreviewCells(fetched))
        .catch((e: any) => setPreviewError(e?.message || "상대 시간표를 불러올 수 없습니다."))
        .finally(() => setPreviewLoading(false));
    } else {
      Promise.all([
        fetchTeacherWeek(selectedWeekId),
        fetchTeacherWeek(effectiveTargetWeekId),
      ])
        .then(([srcCells, tgtCells]) => {
          setCounterpartSourceCells(srcCells);
          setCounterpartTargetCells(tgtCells);
        })
        .catch((e: any) => setPreviewError(e?.message || "상대 시간표를 불러올 수 없습니다."))
        .finally(() => setPreviewLoading(false));
    }
  }, [applyingCandidate, effectiveTargetWeekId, selectedWeekId, isCrossWeek]);

  return (
    <div className="space-y-4">
      {/* 🚀 상단 컨트롤 바 (v2.1: 전 주 일괄 제출 및 인라인 하이라이트 현황) */}
      <div className="bg-white rounded-xl shadow-sm border border-indigo-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-extrabold text-indigo-950 flex items-center gap-1.5">
              <span>🗓️ 등록 주간 전체 예상 시간표</span>
              <span className="text-xs text-indigo-500 font-medium">(v2.1 전 주 인라인 후보 하이라이트)</span>
            </h2>

            {projectedData && (
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <span className="bg-indigo-100 text-indigo-900 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                  📁 초안 {projectedData.assumedDraftCount}건
                </span>
                <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full">
                  ⏳ 검토 중 신청 {projectedData.assumedPendingCount}건
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={batchReason.type}
              onChange={(e) => setBatchReason({ type: e.target.value as any, note: batchReason.note })}
              className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              {SWAP_REASON_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <button
              onClick={handleBatchSubmitFromHeader}
              disabled={submittingBatch || (projectedData?.assumedDraftCount || 0) === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
            >
              <span>🚀</span>
              <span>{submittingBatch ? "일괄 제출 중..." : `등록 주간 초안 일괄 신청 (${projectedData?.assumedDraftCount || 0}건)`}</span>
            </button>
          </div>
        </div>

        {batchReason.type === "기타" && (
          <textarea
            value={batchReason.note || ""}
            onChange={(e) => setBatchReason({ ...batchReason, note: e.target.value })}
            placeholder="일괄 신청 사유(기타)를 입력해 주세요 (필수)"
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        )}

        <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-emerald-100 border border-emerald-300 inline-block" />
            <b className="text-emerald-950">초록 배지</b>: 상대 부담 0점 (좋은 교체)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300 inline-block" />
            <b className="text-amber-950">주황 배지</b>: 상대 부담 1~2점
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-rose-100 border border-rose-300 inline-block" />
            <b className="text-rose-950">빨간 배지</b>: 상대 부담 3+점
          </span>
          <span className="flex items-center gap-1 border-l pl-2 border-gray-200">
            <span className="w-2.5 h-2.5 rounded bg-indigo-50 border border-dashed border-indigo-400 inline-block" />
            <b className="text-indigo-900">점선 파란 배경</b>: 클릭 반영 초안
          </span>
        </div>
      </div>

      {submitResult && (
        <div className={`rounded-xl p-4 text-sm font-semibold border ${
          submitResult.startsWith("🚀") || submitResult.startsWith("✅")
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {submitResult}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 text-center">{error}</div>
      )}

      <div className="flex gap-4 items-start">
        {/* 주간 시간표 그리드 (등록된 주간 전체 세로 일렬 나열 — §14-2 v2.1 인라인 하이라이트) */}
        <div className="flex-1 space-y-6">
          {loading && !projectedData && (
            <div className="bg-white rounded-xl p-12 text-center text-xs font-semibold text-indigo-500 border border-gray-200 shadow-sm animate-pulse">
              예상 시간표를 불러오는 중...
            </div>
          )}

          {projectedData?.weeks.map((week) => {
            // §14-2 v2.1: 현재 주간에 해당하는 candidates_all 맞교환 후보 목록 조회
            const weekCandidates = candidatesAllResult?.weeks.find((w) => w.weekId === week.weekId)?.swapCandidates || [];

            return (
              <div key={week.weekId} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-950 to-indigo-800 px-5 py-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>🗓️ {week.startDate} 주간시간표 ({week.weekId})</span>
                      {selectedCell?.weekId === week.weekId && (
                        <span className="text-[10px] bg-amber-300 text-amber-950 px-2 py-0.5 rounded font-black">
                          선택한 소스 수업 주
                        </span>
                      )}
                    </h3>
                  </div>
                </div>

                <table className="w-full table-fixed border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2.5 px-1 border-r border-gray-200 w-14 text-center text-gray-500 font-bold text-xs">교시</th>
                      {DAYS.map((d) => {
                        const dateLabel = getDayDateLabel(week.startDate, d.num);
                        return (
                          <th key={d.num} className="py-2 px-1 text-center text-gray-800 font-bold text-sm w-1/5">
                            <div>{d.label}</div>
                            {dateLabel && <div className="text-xs text-gray-500 font-normal mt-0.5">{dateLabel}</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, idx) => {
                      const period = idx + 1;
                      return (
                        <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                          <td className="py-2 px-1 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50 text-xs align-middle w-14">{period}</td>
                          {DAYS.map((d) => {
                            const matched = week.cells.filter((c) => c.day === d.num && c.period === period);
                            const hasLesson = matched.length > 0;
                            const isSelected = selectedCell?.weekId === week.weekId && selectedCell?.day === d.num && selectedCell?.period === period;

                            // §14-2 v2.1: 내 공강 칸(!hasLesson)이고 소스 셀이 선택되었을 때 인라인 맞교환 후보 매칭
                            const candidate = !hasLesson && selectedCell
                              ? weekCandidates.find((c) => c.targetDay === d.num && c.targetPeriod === period)
                              : null;

                            return (
                              <td
                                key={d.num}
                                className={`p-1 border-r border-gray-100 text-center align-middle h-16 transition-all ${
                                  isSelected ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50" : ""
                                } ${hasLesson && !isSelected ? "hover:bg-indigo-50/60 cursor-pointer" : ""}`}
                                onClick={() => {
                                  if (hasLesson) handleCellClick(matched[0], week.weekId);
                                }}
                              >
                                {hasLesson ? (
                                  matched.map((cell, ci) => {
                                    const changed = (cell as any).changed;
                                    const changeId: string = changed?.changeId || "";
                                    const isVirtualDraft = changeId.startsWith("virtual-draft-");
                                    const isVirtualReq = changeId.startsWith("virtual-req-");
                                    const isApprovedChange = !!changed && !isVirtualDraft && !isVirtualReq;

                                    // 교차 주 초안은 서버 가상 문서가 방향별 "-a"/"-b" 접미어를 붙이므로 함께 제거해야 실제 초안 문서 ID가 된다 (Firestore 자동 ID에는 하이픈이 없음)
                                    const draftId = isVirtualDraft ? changeId.replace("virtual-draft-", "").replace(/-(a|b)$/, "") : "";

                                    let cellStyle = "bg-white border border-indigo-200 shadow-2xs";
                                    if (isVirtualDraft) cellStyle = "bg-indigo-50/90 border-2 border-dashed border-indigo-400 text-indigo-950 shadow-xs";
                                    else if (isVirtualReq) cellStyle = "bg-amber-50/90 border-2 border-amber-300 text-amber-950 shadow-xs";
                                    else if (isApprovedChange) cellStyle = "bg-red-100 border border-red-300 text-red-950";

                                    return (
                                      <div key={ci} className={`p-1.5 rounded-lg text-center space-y-0.5 ${cellStyle}`}>
                                        <div className="font-black text-sm flex items-center justify-center gap-1">
                                          <span>{cell.grade}-{cell.classNum}반</span>
                                          {isApprovedChange && <span className="text-red-600 font-bold text-xs">▲</span>}
                                        </div>

                                        <div className="text-[11px] text-gray-600 font-medium">{cell.subjectName}</div>

                                        {isVirtualDraft && (
                                          <div className="flex items-center justify-between gap-1 pt-0.5">
                                            <span className="text-[10px] font-extrabold text-indigo-900 bg-indigo-200 px-1 py-0.5 rounded">
                                              📁 초안
                                            </span>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteDraftById(draftId);
                                              }}
                                              className="text-[10px] font-bold text-red-600 hover:text-red-800 bg-white px-1 py-0.5 rounded border border-red-200"
                                            >
                                              취소
                                            </button>
                                          </div>
                                        )}

                                        {isVirtualReq && (
                                          <div className="text-[10px] font-extrabold text-amber-900 bg-amber-200 px-1 py-0.5 rounded mt-0.5">
                                            ⏳ 검토 대기
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })
                                ) : candidate ? (
                                  /* §14-2 v2.1: 공강 칸 인라인 후보 카딩 (클릭 = draft_save 실행) */
                                  (() => {
                                    const cpScore = candidate.counterpartScore ?? 0;
                                    const counterpartPenalties = (candidate.penaltyDetails || []).filter((p) => p.scope === "counterpart");
                                    const tooltipText = `[${candidate.counterpartSubjectName}] ${candidate.counterpartName} 교사 · 상대 감점 ${cpScore}점${
                                      counterpartPenalties.length > 0 ? ` (${counterpartPenalties.map((p) => p.text).join(", ")})` : ""
                                    }`;

                                    let badgeStyle = "bg-emerald-100 border-emerald-300 text-emerald-950";
                                    if (cpScore >= 3) badgeStyle = "bg-rose-100 border-rose-300 text-rose-950";
                                    else if (cpScore >= 1) badgeStyle = "bg-amber-100 border-amber-300 text-amber-950";

                                    return (
                                      <div
                                        title={tooltipText}
                                        onMouseEnter={() => {
                                          setApplyingCandidate(candidate);
                                          setTargetWeekId(week.weekId);
                                        }}
                                        onClick={() => handleSelectCandidateAndSave(candidate, week.weekId)}
                                        className={`p-1.5 rounded-lg border text-center transition-all cursor-pointer shadow-2xs hover:scale-102 ${badgeStyle}`}
                                      >
                                        <div className="font-extrabold text-xs truncate">
                                          {candidate.counterpartName}
                                        </div>
                                        <div className="text-[10px] font-black underline mt-0.5">
                                          {cpScore === 0 ? "✓ 0점" : `⚠ ${cpScore}점`}
                                        </div>
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <span className="text-xs text-gray-300 block py-1">-</span>
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
            );
          })}
        </div>

        {/* 우측 사이드바: 선택 정보 & 상대 교사 시간표 미리보기만 유지 (§14-2 v2.1) */}
        {selectedCell && (
          <div className="w-80 shrink-0 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden sticky top-4">
            <div className="bg-gradient-to-r from-indigo-900 to-indigo-700 px-4 py-3">
              <div className="text-xs font-bold text-white">
                수업교환 소스 — {formatSlotWithDate(selectedCell.weekId, selectedCell.day, selectedCell.period)}
              </div>
              <div className="text-[11px] text-indigo-300 mt-0.5">
                {selectedCell.subjectName} · {selectedCell.grade}-{selectedCell.classNum}반 ({selectedCell.weekId} 주)
              </div>
            </div>

            <div className="p-4 space-y-4">
              {candidatesLoading && (
                <div className="text-center py-4 text-xs text-indigo-500 animate-pulse font-semibold">전 주 맞교환 후보 계산 중...</div>
              )}
              {candidatesError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{candidatesError}</div>
              )}

              {!candidatesLoading && !applyingCandidate && (
                <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-900 space-y-1">
                  <p className="font-bold">💡 인라인 후보 선택 안내</p>
                  <p className="text-[11px] text-indigo-800">
                    좌측 전 주 시간표 그리드의 <b>공강 칸(초록/주황/빨간 배지)</b>을 직접 클릭하면 해당 교시로 교체안이 자동 저장됩니다.
                  </p>
                </div>
              )}

              {/* 상대 교사 시간표 미리보기 미니 그리드 */}
              {applyingCandidate && (
                <div className="space-y-3">
                  <div className="text-xs font-bold text-gray-800 flex items-center justify-between">
                    <span>
                      🔍 {applyingCandidate.counterpartName} 교사 시간표 미리보기
                    </span>
                    {previewLoading && <span className="text-[10px] text-indigo-500 animate-pulse font-semibold">조회 중...</span>}
                  </div>

                  {previewError && <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded">{previewError}</div>}

                  <MiniPreviewGrid
                    isCrossWeek={isCrossWeek}
                    sourceWeekId={selectedCell.weekId}
                    targetWeekId={effectiveTargetWeekId}
                    sourceWeekObj={sourceWeekObj}
                    targetWeekObj={targetWeekObj}
                    selectedCell={selectedCell}
                    applyingCandidate={applyingCandidate}
                    periodsPerDay={periodsPerDay}
                    previewCells={previewCells}
                    counterpartSourceCells={counterpartSourceCells}
                    counterpartTargetCells={counterpartTargetCells}
                    counterpartTitle={`${applyingCandidate.counterpartName || "상대"} 선생님`}
                  />

                  {/* 사유 선택 */}
                  <div className="pt-1 space-y-1.5">
                    <div className="text-[11px] font-bold text-gray-600">신청 사유</div>
                    <select
                      value={reason.type}
                      onChange={(e) => setReason({ type: e.target.value as any, note: reason.note })}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      {SWAP_REASON_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        if (!selectedCell || !applyingCandidate) return;
                        const currentUserName = user?.displayName || teacherProfile?.name || userEmail?.split("@")[0] || "교사";
                        handleCopyShareImage({
                          requesterName: currentUserName,
                          sourceWeekId: selectedCell.weekId,
                          targetWeekId: isCrossWeek ? effectiveTargetWeekId : undefined,
                          source: {
                            grade: selectedCell.grade,
                            classNum: selectedCell.classNum,
                            day: selectedCell.day,
                            period: selectedCell.period,
                            subjectName: selectedCell.subjectName,
                          },
                          candidate: {
                            targetDay: applyingCandidate.targetDay,
                            targetPeriod: applyingCandidate.targetPeriod,
                            counterpartEmail: applyingCandidate.counterpartEmail,
                            counterpartName: applyingCandidate.counterpartName,
                            counterpartSubjectName: applyingCandidate.counterpartSubjectName,
                          },
                          previewCells,
                          counterpartSourceCells,
                          counterpartTargetCells,
                          sourceWeekObj,
                          targetWeekObj,
                          periodsPerDay,
                        });
                      }}
                      className="py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg text-xs transition-colors shadow-sm flex items-center justify-center gap-1"
                    >
                      <span>📋</span>
                      <span>양해 이미지 복사</span>
                    </button>

                    <button
                      onClick={handleSingleSubmit}
                      disabled={submitting || (reason.type === "기타" && !reason.note?.trim())}
                      className="py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-200 rounded-lg text-xs transition-colors shadow-2xs disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <span>⚡</span>
                      <span>{submitting ? "신청 중..." : "단건 즉시 신청"}</span>
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setApplyingCandidate(null);
                      setSelectedCell(null);
                      setPreviewCells(null);
                    }}
                    className="w-full py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    닫기
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 오프스크린 사전 양해 공유 카드 DOM (클립보드 복사용) */}
      <OffscreenShareCard cardRef={shareCardRef} data={shareCardData} />
    </div>
  );
}

// ── ② 내 신청 내역 탭 ────────────────────────────────────────────
interface MyRequestsTabProps {
  settings: TimetableSettings | null;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:  { label: "검토 중",  className: "bg-amber-100 text-amber-800 border-amber-200" },
  APPROVED: { label: "승인됨",   className: "bg-green-100 text-green-800 border-green-200" },
  REJECTED: { label: "반려됨",   className: "bg-red-100 text-red-800 border-red-200" },
  CANCELED: { label: "취소됨",   className: "bg-gray-100 text-gray-600 border-gray-200" },
};

function MyRequestsTab({ settings }: MyRequestsTabProps) {
  const { user, userData, teacherProfile } = useAuth();
  const userEmail = userData?.email || "";

  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 사전 양해 임시저장함 상태 (phase9b_spec §13-1)
  const [drafts, setDrafts] = useState<SwapDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(true);
  const [confirmingDraft, setConfirmingDraft] = useState<SwapDraft | null>(null);
  const [draftReason, setDraftReason] = useState<SwapRequestReason>({ type: "출장" });
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [submittingDraftId, setSubmittingDraftId] = useState<string | null>(null);

  // 장바구니 일괄 제출 상태 (phase9b_spec §14-2)
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [batchReason, setBatchReason] = useState<SwapRequestReason>({ type: "출장" });
  const [submittingBatch, setSubmittingBatch] = useState(false);

  // 초안 이미지 복사용 ref & state
  const [draftShareData, setDraftShareData] = useState<ShareCardData | null>(null);
  const draftShareRef = useRef<HTMLDivElement>(null);

  const fetchDrafts = useCallback(async () => {
    setDraftsLoading(true);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list" }),
      });
      if (res.ok) {
        const data = await res.json();
        const loadedDrafts: SwapDraft[] = data.drafts || [];
        setDrafts(loadedDrafts);
        setSelectedDraftIds(loadedDrafts.map((d) => d.id));
      }
    } catch (e) {
      console.error("fetchDrafts error:", e);
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  const handleBatchSubmit = async () => {
    const itemsToSubmit = drafts.filter((d) => selectedDraftIds.includes(d.id));
    if (itemsToSubmit.length === 0) {
      alert("일괄 제출할 초안 항목을 선택해 주세요.");
      return;
    }
    if (batchReason.type === "기타" && !batchReason.note?.trim()) {
      alert("신청 사유(기타) 상세 내용을 입력해 주세요.");
      return;
    }

    if (!confirm(`선택한 ${itemsToSubmit.length}건의 수업교환 초안을 한 번에 일괄 신청(일과계 제출)하시겠습니까?`)) {
      return;
    }

    setSubmittingBatch(true);
    setSuccessMsg(null);
    setError(null);

    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_batch",
          items: itemsToSubmit.map((d) => ({
            draftId: d.id,
            weekId: d.sourceWeekId,
            targetWeekId: d.targetWeekId,
            type: "swap",
            source: d.source,
            candidate: d.candidate,
          })),
          reason: batchReason,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const results: SwapBatchItemResult[] = data.results || [];
        const okCount = data.createdCount || 0;
        const failResults = results.filter((r) => !r.ok);

        if (failResults.length > 0) {
          const newErrors = { ...draftErrors };
          failResults.forEach((fr) => {
            if (fr.draftId) {
              newErrors[fr.draftId] = fr.error || "신청 거부";
            }
          });
          setDraftErrors(newErrors);
        }

        if (okCount > 0) {
          setSuccessMsg(`🚀 ${okCount}건의 수업교환 신청이 성공적으로 일괄 접수되었습니다. (배치 ID: ${data.batchId || ""})`);
        }

        if (failResults.length > 0) {
          alert(`일괄 신청 처리 완료: ${okCount}건 성공, ${failResults.length}건 거부.\n거부된 항목은 초안 카드에 사유가 표시되니 확인 후 [삭제]해 주세요.`);
        }

        fetchDrafts();
        fetchMyList();
      } else {
        setError(data.error || "일괄 신청 처리에 실패했습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setSubmittingBatch(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const handleDeleteDraft = async (draftId: string) => {
    if (!confirm("이 임시저장 초안을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId }),
      });
      if (res.ok) {
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
        setDraftErrors((prev) => {
          const next = { ...prev };
          delete next[draftId];
          return next;
        });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`초안 삭제 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    }
  };

  const handleSubmitDraftConfirm = async () => {
    if (!confirmingDraft) return;
    const draft = confirmingDraft;
    setSubmittingDraftId(draft.id);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          weekId: draft.sourceWeekId,
          targetWeekId: draft.targetWeekId,
          type: "swap",
          source: draft.source,
          candidate: draft.candidate,
          reason: draftReason,
        }),
      });
      if (res.ok) {
        // 성공 시 초안 삭제 및 리스트 갱신
        await fetch("/api/timetable/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "draft_delete", draftId: draft.id }),
        });
        setSuccessMsg("초안으로 수업교환 신청이 완료되었고 해당 초안은 임시저장함에서 자동으로 정리되었습니다.");
        setConfirmingDraft(null);
        fetchMyList();
        fetchDrafts();
      } else {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.error || "신청에 실패했습니다.";
        setDraftErrors((prev) => ({ ...prev, [draft.id]: errMsg }));
        setConfirmingDraft(null);
        alert(`신청 거부: ${errMsg}\n시간표 변경 등으로 신청이 불가합니다. 초안 카드에 표기된 사유를 확인하시고 [이 초안 삭제] 버튼으로 정리해 주세요.`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    } finally {
      setSubmittingDraftId(null);
    }
  };

  const handleCopyDraftShareImage = async (draft: SwapDraft) => {
    let fetchedCells: TeacherTimetableCell[] | null = null;
    let fetchedSourceCells: TeacherTimetableCell[] | null = null;
    let fetchedTargetCells: TeacherTimetableCell[] | null = null;

    const sourceWeek = draft.sourceWeekId;
    const targetWeek = draft.targetWeekId || draft.sourceWeekId;
    const isCross = !!(draft.targetWeekId && draft.targetWeekId !== draft.sourceWeekId);
    const counterpartEmail = draft.candidate.counterpartEmail;

    if (counterpartEmail) {
      try {
        if (isCross) {
          const [resSource, resTarget] = await Promise.all([
            fetch("/api/timetable/view", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "teacher", weekId: sourceWeek, teacherEmail: counterpartEmail }),
            }),
            fetch("/api/timetable/view", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "teacher", weekId: targetWeek, teacherEmail: counterpartEmail }),
            }),
          ]);
          if (resSource.ok) {
            const d = await resSource.json();
            fetchedSourceCells = d.cells || [];
          }
          if (resTarget.ok) {
            const d = await resTarget.json();
            fetchedTargetCells = d.cells || [];
          }
        } else {
          const res = await fetch("/api/timetable/view", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "teacher", weekId: targetWeek, teacherEmail: counterpartEmail }),
          });
          if (res.ok) {
            const d = await res.json();
            fetchedCells = d.cells || [];
          }
        }
      } catch (e) {
        console.error("Fetch counterpart timetable error:", e);
      }
    }

    const sourceWeekObj = weeks.find((w) => w.id === sourceWeek) || null;
    const targetWeekObj = weeks.find((w) => w.id === targetWeek) || null;

    setDraftShareData({
      requesterName: user?.displayName || teacherProfile?.name || userEmail.split("@")[0] || "교사",
      sourceWeekId: draft.sourceWeekId,
      targetWeekId: draft.targetWeekId,
      sourceWeekObj,
      targetWeekObj,
      source: draft.source,
      candidate: draft.candidate,
      previewCells: fetchedCells,
      counterpartSourceCells: fetchedSourceCells,
      counterpartTargetCells: fetchedTargetCells,
    });

    setTimeout(() => {
      copyShareImageElement(draftShareRef.current);
    }, 100);
  };

  useEffect(() => {
    const termId = settings?.activeTermId;
    if (!termId) return;
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.success) setWeeks(data.weeks || []); })
      .catch(() => {});
  }, [settings?.activeTermId]);

  const fetchMyList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my_list", weekId: selectedWeekId || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "내 신청 목록을 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedWeekId]);

  useEffect(() => { fetchMyList(); }, [fetchMyList]);

  const handleCancel = async (requestId: string) => {
    if (!confirm("신청을 취소하시겠습니까?")) return;
    setCancellingId(requestId);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", requestId }),
      });
      if (res.ok) {
        setSuccessMsg("신청이 취소되었습니다.");
        fetchMyList();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`취소 실패: ${err.error}`);
      }
    } catch (e: any) {
      alert(`오류: ${e.message}`);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
      {/* 📁 사전 양해 임시저장함 (phase9b_spec §13-1) */}
      <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setDraftsOpen(!draftsOpen)}
            className="flex items-center gap-2 font-bold text-sm text-indigo-950 hover:text-indigo-700 transition-colors"
          >
            <span>📁 사전 양해 임시저장함</span>
            <span className="text-xs bg-indigo-200 text-indigo-900 font-extrabold px-2 py-0.5 rounded-full">
              {drafts.length}건
            </span>
            <span className="text-xs text-indigo-500 font-medium">{draftsOpen ? "▲ 접기" : "▼ 펼치기"}</span>
          </button>
          <button
            onClick={fetchDrafts}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold underline"
          >
            초안 새로고침
          </button>
        </div>

        {draftsOpen && (
          <div className="space-y-3 pt-1">
            {draftsLoading && <div className="text-xs text-indigo-500 animate-pulse">초안 불러오는 중...</div>}
            {!draftsLoading && drafts.length === 0 && (
              <div className="text-xs text-gray-500 py-3 text-center bg-white/70 rounded-lg border border-dashed border-indigo-200">
                임시저장된 교체안 초안이 없습니다. 시간표 셀을 선택 후 [목록에 담기]할 수 있습니다.
              </div>
            )}
            {!draftsLoading && drafts.length > 0 && (
              <div className="bg-white border border-indigo-200 rounded-xl p-3.5 space-y-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedDraftIds.length === drafts.length && drafts.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDraftIds(drafts.map((d) => d.id));
                        else setSelectedDraftIds([]);
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-bold text-gray-800">
                      전체 선택 ({selectedDraftIds.length}/{drafts.length}건 선택됨)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-600">일괄 신청 사유:</span>
                    <select
                      value={batchReason.type}
                      onChange={(e) => setBatchReason({ type: e.target.value as any, note: batchReason.note })}
                      className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs focus:ring-2 focus:ring-indigo-500"
                    >
                      {SWAP_REASON_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {batchReason.type === "기타" && (
                  <textarea
                    value={batchReason.note || ""}
                    onChange={(e) => setBatchReason({ ...batchReason, note: e.target.value })}
                    placeholder="사유(기타)를 입력해 주세요 (필수)"
                    rows={2}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                )}

                <button
                  onClick={handleBatchSubmit}
                  disabled={submittingBatch || selectedDraftIds.length === 0}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-lg text-xs transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  <span>🚀</span>
                  <span>{submittingBatch ? "일괄 신청 제출 중..." : `선택 항목 ${selectedDraftIds.length}건 한 번에 일괄 신청하기 (일과계 제출)`}</span>
                </button>
              </div>
            )}
            {!draftsLoading &&
              drafts.map((draft) => {
                const errorMsg = draftErrors[draft.id];
                const sourceSlotStr = formatSlotWithDate(draft.sourceWeekId, draft.source.day, draft.source.period);
                const targetWeekVal = draft.targetWeekId || draft.sourceWeekId;
                const targetSlotStr = formatSlotWithDate(
                  targetWeekVal,
                  draft.candidate.targetDay,
                  draft.candidate.targetPeriod
                );

                return (
                  <div
                    key={draft.id}
                    className={`bg-white border rounded-xl p-3.5 space-y-2.5 shadow-sm transition-colors ${
                      errorMsg ? "border-red-300 bg-red-50/30" : "border-indigo-150 hover:border-indigo-300"
                    }`}
                  >
                    {/* 재검증 거부 시 경고 배너 */}
                    {errorMsg && (
                      <div className="bg-red-100/90 border border-red-300 text-red-900 rounded-lg p-2.5 text-xs font-bold space-y-1">
                        <div className="flex items-center gap-1 text-red-700">
                          <span>⚠️ 교환 신청 불가 (시간표 상태 변경 등)</span>
                        </div>
                        <div className="text-[11px] font-medium text-red-800">{errorMsg}</div>
                        <div className="text-[10px] text-red-700 font-normal">
                          상태가 변경되었으므로 아래 <b>[이 초안 삭제]</b> 버튼을 눌러 초안을 정리해 주세요.
                        </div>
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 text-xs">
                        <div className="font-bold text-gray-900 flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedDraftIds.includes(draft.id)}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedDraftIds((prev) => [...prev, draft.id]);
                              else setSelectedDraftIds((prev) => prev.filter((id) => id !== draft.id));
                            }}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                          />
                          <span className="text-indigo-900">{draft.sourceWeekId} 주</span>
                          {draft.targetWeekId && draft.targetWeekId !== draft.sourceWeekId && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold border border-indigo-200">
                              ↔ {draft.targetWeekId} 주 교차 주
                            </span>
                          )}
                          <span className="text-gray-400 text-[10px]">
                            · {new Date(draft.updatedAt).toLocaleDateString("ko-KR")} 저장
                          </span>
                        </div>
                        <div className="text-gray-800">
                          <span className="font-semibold text-gray-500">내 수업:</span> {sourceSlotStr} ({draft.source.grade}-{draft.source.classNum}반 {draft.source.subjectName})
                        </div>
                        <div className="text-gray-800">
                          <span className="font-semibold text-gray-500">교환 희망:</span> {targetSlotStr} ({draft.candidate.counterpartName || "상대 교사"})
                        </div>
                        {draft.reason && (
                          <div className="text-gray-500 text-[11px]">
                            저장 사유: {draft.reason.type}{draft.reason.note ? ` (${draft.reason.note})` : ""}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 버튼들 */}
                    <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                      <button
                        onClick={() => {
                          setConfirmingDraft(draft);
                          setDraftReason(draft.reason || { type: "출장" });
                        }}
                        disabled={submittingDraftId === draft.id}
                        className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors shadow-sm disabled:opacity-50"
                      >
                        {submittingDraftId === draft.id ? "신청 중..." : "이 안으로 신청"}
                      </button>

                      <button
                        onClick={() => handleCopyDraftShareImage(draft)}
                        className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs border border-indigo-200 transition-colors shrink-0"
                      >
                        📋 양해 이미지 복사
                      </button>

                      <button
                        onClick={() => handleDeleteDraft(draft.id)}
                        className={`py-1.5 px-3 font-bold rounded-lg text-xs transition-colors shrink-0 ${
                          errorMsg
                            ? "bg-red-600 hover:bg-red-700 text-white shadow-sm ring-2 ring-red-400 animate-pulse"
                            : "bg-gray-100 hover:bg-gray-200 text-gray-600"
                        }`}
                      >
                        {errorMsg ? "이 초안 삭제 권장" : "삭제"}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* 오프스크린 초안 이미지 복사용 DOM */}
      <OffscreenShareCard cardRef={draftShareRef} data={draftShareData} />

      {/* 사유 선택 및 제출 확인 모달 (사유 필수 수집 흐름) */}
      {confirmingDraft && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
            <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
              <h4 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                <span>📝 수업교환 최종 신청</span>
              </h4>
              <button
                onClick={() => setConfirmingDraft(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3.5 space-y-1 text-xs">
              <div className="font-bold text-indigo-950">초안 교환 정보 확인</div>
              <div className="text-gray-700">
                • <b>내 수업:</b> {formatSlotWithDate(confirmingDraft.sourceWeekId, confirmingDraft.source.day, confirmingDraft.source.period)} ({confirmingDraft.source.grade}-{confirmingDraft.source.classNum}반 {confirmingDraft.source.subjectName})
              </div>
              <div className="text-gray-700">
                • <b>교환 상대:</b> {formatSlotWithDate(confirmingDraft.targetWeekId || confirmingDraft.sourceWeekId, confirmingDraft.candidate.targetDay, confirmingDraft.candidate.targetPeriod)} ({confirmingDraft.candidate.counterpartName || "상대 교사"})
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-800">신청 사유 선택 (필수)</label>
              <select
                value={draftReason.type}
                onChange={(e) => setDraftReason({ type: e.target.value as any, note: draftReason.note })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
              >
                {SWAP_REASON_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {draftReason.type === "기타" && (
                <textarea
                  value={draftReason.note || ""}
                  onChange={(e) => setDraftReason({ ...draftReason, note: e.target.value })}
                  placeholder="사유를 상세히 입력해 주세요 (필수)"
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setConfirmingDraft(null)}
                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700"
              >
                취소
              </button>
              <button
                onClick={handleSubmitDraftConfirm}
                disabled={submittingDraftId === confirmingDraft.id || (draftReason.type === "기타" && !draftReason.note?.trim())}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-sm disabled:opacity-50 transition-colors"
              >
                {submittingDraftId === confirmingDraft.id ? "제출 중..." : "확인 및 수업교환 신청"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pb-2 border-b border-gray-100">
        <h3 className="text-base font-bold text-gray-900">📋 내 수업교환 신청 내역</h3>
        <select
          value={selectedWeekId}
          onChange={(e) => setSelectedWeekId(e.target.value)}
          className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs"
        >
          <option value="">전체 주</option>
          {weeks.map((w) => <option key={w.id} value={w.id}>{w.startDate} 주</option>)}
        </select>
        <button
          onClick={fetchMyList}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
        >
          새로고침
        </button>
      </div>

      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs font-semibold text-green-800">
          {successMsg}
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{error}</div>}
      {loading && <div className="text-center py-6 text-xs text-indigo-500 animate-pulse">불러오는 중...</div>}

      {!loading && requests.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">수업교환 신청 내역이 없습니다.</div>
      )}

      {!loading && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req) => {
            const statusInfo = STATUS_LABELS[req.status] || { label: req.status, className: "bg-gray-100 text-gray-600 border-gray-200" };
            const isCross = req.type === "cross_swap" || (req.targetWeekId && req.targetWeekId !== req.weekId) || !!(req.candidate as any).targetWeekId;
            const targetWeekVal = req.targetWeekId || (req.candidate as any).targetWeekId;

            return (
              <div key={req.id} className="border border-gray-200 rounded-xl p-4 space-y-2 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                      <span>{req.weekId} 주</span>
                      {isCross ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold border border-indigo-200">
                          ↔ {targetWeekVal ? `${targetWeekVal} 주` : ""} 교차 주 맞교환
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-500 font-normal">
                          — {req.type === "swap" ? "맞교환" : "특별보강"}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      원 수업: {formatSlotWithDate(req.weekId, req.source.day, req.source.period)} ({req.source.subjectName}, {req.source.grade}-{req.source.classNum}반)
                    </div>
                    {(req.type === "swap" || req.type === "cross_swap") && req.candidate.targetDay != null && (
                      <div className="text-[11px] text-gray-600">
                        교환: {formatSlotWithDate(targetWeekVal || req.weekId, req.candidate.targetDay!, req.candidate.targetPeriod!)} ({req.candidate.counterpartName})
                      </div>
                    )}
                    {req.type === "substitute" && (
                      <div className="text-[11px] text-gray-600">보강 교사: {req.candidate.counterpartName}</div>
                    )}
                    <div className="text-[11px] text-gray-500">
                      사유: {req.reason.type}{req.reason.note && ` — ${req.reason.note}`}
                    </div>
                    {req.decisionNote && (
                      <div className="text-[11px] text-red-700 font-medium">결정 사유: {req.decisionNote}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${statusInfo.className}`}>
                      {statusInfo.label}
                    </span>
                    {req.status === "PENDING" && (
                      <button
                        onClick={() => handleCancel(req.id)}
                        disabled={cancellingId === req.id}
                        className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-[11px] transition-colors disabled:opacity-50 border border-red-200"
                      >
                        {cancellingId === req.id ? "취소 중..." : "신청 취소"}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-[10px] text-gray-400">
                  신청일: {new Date(req.createdAt).toLocaleString("ko-KR")}
                  {req.decidedAt && ` · 결정일: ${new Date(req.decidedAt).toLocaleString("ko-KR")}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ③ 다른 시간표 조회 탭 ─────────────────────────────────────────
interface OtherTimetableTabProps {
  periodsPerDay: number;
  settings: TimetableSettings | null;
}

function OtherTimetableTab({ periodsPerDay, settings }: OtherTimetableTabProps) {
  const { userData } = useAuth();
  const myEmail = userData?.email?.toLowerCase() || "";
  const userEmail = myEmail;
  const isSuperAdmin = userData?.role === "super_admin";
  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [targetEmail, setTargetEmail] = useState(myEmail);
  const [teacherName, setTeacherName] = useState("");
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ② 교사 목록 드롭다운용
  const [teacherList, setTeacherList] = useState<{ email: string; name: string }[]>([]);
  const [teacherListLoading, setTeacherListLoading] = useState(false);

  useEffect(() => {
    const termId = settings?.activeTermId;
    if (!termId) return;
    // 주 목록 로드
    fetch("/api/timetable/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "week_list", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) {
          const loadedWeeks: TimetableWeek[] = data.weeks || [];
          setWeeks(loadedWeeks);
          if (loadedWeeks.length > 0) {
            const defaultId = findDefaultWeekId(loadedWeeks);
            if (defaultId) {
              setSelectedWeekId((prev) => (prev ? prev : defaultId));
            }
          }
        }
      })
      .catch(() => {});
    // 교사 목록 로드 (가나다순 드롭다운)
    setTeacherListLoading(true);
    fetch("/api/timetable/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "teachers", termId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.data) setTeacherList(data.data as { email: string; name: string }[]);
      })
      .catch(() => {})
      .finally(() => setTeacherListLoading(false));
  }, [settings?.activeTermId]);

  const fetchTimetable = useCallback(async (email: string, weekId?: string) => {
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
          weekId: weekId || undefined,
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        setCells(result.data?.cells || []);
        setTeacherName(result.data?.teacherName || email.split("@")[0]);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [myEmail]);

  useEffect(() => {
    fetchTimetable(targetEmail, selectedWeekId || undefined);
  }, [targetEmail, selectedWeekId, fetchTimetable]);

  const getCellFor = (day: number, period: number) =>
    cells.filter((c) => c.day === day && c.period === period);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            🔍 다른 교사 시간표 조회
            {termMeta && (
              <span className="text-xs px-2 py-0.5 rounded-full font-normal bg-indigo-100 text-indigo-800">{termMeta.name}</span>
            )}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
          >
            {isManager && <option value="">기초시간표</option>}
            {weeks.map((w) => <option key={w.id} value={w.id}>{w.startDate} 주</option>)}
          </select>
          {/* ② 교사 드롭다운 — action:teachers 가나다순 */}
          <select
            value={targetEmail}
            onChange={(e) => {
              const email = e.target.value;
              setTargetEmail(email);
              const found = teacherList.find((t) => t.email === email);
              if (found) setTeacherName(found.name);
            }}
            disabled={teacherListLoading}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs min-w-[10rem] max-w-xs disabled:opacity-60"
          >
            {teacherListLoading && <option value="">불러오는 중...</option>}
            {/* ③ '내 시간표' 옵션 상시 고정 (본인이 시간표에 없어도 value 불일치 방지) */}
            {!teacherListLoading && (
              <option value={myEmail}>내 시간표</option>
            )}
            {/* 본인 중복 제거 후 가나다순 렌더 */}
            {!teacherListLoading && teacherList
              .filter((t) => t.email !== myEmail)
              .map((t) => (
                <option key={t.email} value={t.email}>
                  {t.name}
                </option>
              ))
            }
          </select>
        </div>
      </div>

      <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-900 flex justify-between items-center">
        <div>
          <span className="font-bold text-indigo-950 text-sm">{teacherName || targetEmail.split("@")[0]}</span>
          {" "}교사님 — 총 <span className="font-black text-indigo-700">{cells.length}</span>시간
        </div>
        {loading && <span className="text-xs text-indigo-600 animate-pulse font-semibold">조회 중...</span>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{error}</div>}

      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-indigo-950 text-white font-bold">
              <th className="py-2.5 px-1 border-b border-r border-indigo-800 w-14 text-center text-xs">교시</th>
              {DAYS.map((d) => {
                const targetWeekObj = weeks.find((w) => w.id === selectedWeekId);
                const dateLabel = getDayDateLabel(targetWeekObj?.startDate || selectedWeekId, d.num);
                return (
                  <th key={d.num} className="py-2 px-1 border-b border-indigo-800 text-center w-1/5 text-sm">
                    <div>{d.label}요일</div>
                    {dateLabel && <div className="text-xs text-indigo-300 font-normal mt-0.5">{dateLabel}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, pIdx) => {
              const period = pIdx + 1;
              return (
                <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                  <td className="py-2 px-1 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50 text-xs align-middle w-14">{period}교시</td>
                  {DAYS.map((d) => {
                    const matched = getCellFor(d.num, period);
                    const hasLesson = matched.length > 0;
                    return (
                      <td key={d.num} className={`p-1.5 border-r border-gray-100 text-center align-middle h-16 transition-colors ${hasLesson ? "bg-indigo-50/40 hover:bg-indigo-100/50" : ""}`}>
                        {hasLesson ? (
                          <div className="space-y-1">
                            {matched.map((cell, cIdx) => {
                              const isChanged = !!(cell as any).changed;
                              const tooltip = `${cell.subjectName} · ${cell.grade}-${cell.classNum}반${cell.room ? ` (${cell.room})` : ""}`;
                              return (
                                <div key={cIdx} title={tooltip} className={`p-1.5 rounded-lg space-y-0.5 ${isChanged ? "bg-red-50 border border-red-300" : "bg-white border border-indigo-200 shadow-2xs"}`}>
                                  <div className={`font-black text-sm ${isChanged ? "text-red-800" : "text-indigo-950"}`}>
                                    {cell.grade}-{cell.classNum}반
                                    {isChanged && <span className="ml-1 text-red-500 text-xs">▲</span>}
                                  </div>
                                  {cell.room && <div className="text-xs text-gray-500 truncate">📍 {cell.room}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 font-light block py-1">-</span>
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
  );
}

// ── 메인 섹션 ──────────────────────────────────────────────────
export default function TeacherPortalSection() {
  const { userData } = useAuth();
  const userEmail = userData?.email?.toLowerCase() || "";
  const isSuperAdmin = userData?.role === "super_admin";
  const isStudent = userData?.role === "student";

  const [settings, setSettings] = useState<TimetableSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"my_tt" | "my_requests" | "other">("my_tt");

  useEffect(() => {
    const cached = getClientCache("timetable:settings");
    if (cached?.settings) {
      setSettings(cached.settings);
      setLoading(false);
    } else {
      fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.settings) {
            setSettings(data.settings);
            setClientCache("timetable:settings", { settings: data.settings, terms: data.terms || [] });
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, []);

  // 학생 전면 차단
  if (isStudent) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900 space-y-2">
        <h3 className="text-base font-bold">🔒 접근 제한</h3>
        <p className="text-xs text-amber-800">학생은 이 메뉴에 접근할 수 없습니다.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4" />
        <p className="text-sm font-semibold text-gray-600">시간표 설정을 불러오는 중...</p>
      </div>
    );
  }

  // 노출 게이트 (phase9b_spec §7)
  const isManager =
    isSuperAdmin ||
    (settings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);
  // teacherOpen(전 교사 오픈) 또는 파일럿 명단(오픈 게이트 전 테스트·실무사) — 2026-08-04 정식화
  const teacherOpen = !!settings?.teacherOpen;
  const isPilot = (settings?.teacherPilotEmails || []).some(
    (e) => e.toLowerCase() === userEmail
  );
  const canView = isManager || teacherOpen || isPilot;

  if (!canView) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-900 space-y-2">
        <h3 className="text-base font-bold">🔒 수업교환 신청 준비 중</h3>
        <p className="text-xs text-amber-800">
          현재 교사 신청 기능은 준비 중입니다. 일과계 검토 완료 후 오픈될 예정입니다.
        </p>
      </div>
    );
  }

  const periodsPerDay = settings?.periodsPerDay || 7;

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-blue-900 rounded-xl p-5 text-white shadow-md border border-indigo-700/40">
        <h2 className="text-lg font-bold">📅 내 시간표 &amp; 수업교환 신청</h2>
        <p className="text-sm text-indigo-200/80 mt-1">
          주간 합성 시간표를 확인하고 수업교환을 신청합니다. 후보는 엔진이 제시한 슬롯만 선택 가능합니다.
        </p>
      </div>

      <div className="bg-white rounded-xl p-2 shadow-sm border border-gray-200 flex flex-wrap gap-2 text-xs font-bold">
        <button
          onClick={() => setActiveTab("my_tt")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "my_tt" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🗓️ 내 주간시간표</span>
        </button>
        <button
          onClick={() => setActiveTab("my_requests")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "my_requests" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>📋 내 신청 내역</span>
        </button>
        <button
          onClick={() => setActiveTab("other")}
          className={`px-4 py-2.5 rounded-lg transition-all flex items-center gap-1.5 ${
            activeTab === "other" ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          <span>🔍 다른 시간표 조회</span>
        </button>
      </div>

      {activeTab === "my_tt" && <MyTimetableTab periodsPerDay={periodsPerDay} settings={settings} />}
      {activeTab === "my_requests" && <MyRequestsTab settings={settings} />}
      {activeTab === "other" && <OtherTimetableTab periodsPerDay={periodsPerDay} settings={settings} />}
    </div>
  );
}
