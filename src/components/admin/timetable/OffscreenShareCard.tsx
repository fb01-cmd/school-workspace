"use client";

import React from "react";
import { SwapDraft, TeacherTimetableCell, TimetableWeek } from "@/lib/timetable/types";
import { formatSlotWithDate, getDayDateLabel, getWeekRangeLabel } from "@/lib/timetable/utils";
import MiniPreviewGrid, { DAYS } from "./MiniPreviewGrid";

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

export interface ConsolidatedShareData {
  requesterName: string;
  /** §14-4: 발신자 표기 재정의 (예: "일과계 ○○○") — 없으면 "{requesterName} 교사". 직권 카드는 조작자 명의로 양해를 구한다 */
  senderLabel?: string;
  /** §14-4: 교환 목록에서 수업 소유자 표기 — 없으면 "제"(교사 본인 발신). 직권 카드는 "○○○ 선생님의" */
  ownerLabel?: string;
  counterpartName: string;
  items: SwapDraft[] | Array<{
    id?: string;
    sourceWeekId: string;
    targetWeekId?: string;
    source: { grade: number; classNum: number; day: number; period: number; subjectName: string };
    candidate: { targetDay?: number; targetPeriod?: number; counterpartName?: string; counterpartSubjectName?: string };
  }>;
  weekBlocks: Array<{
    weekId: string;
    startDate: string;
    cells: TeacherTimetableCell[];
    markers: Array<{ day: number; period: number; kind: "in" | "out"; label: string }>;
  }>;
  periodsPerDay: number;
}

/**
 * 사전 양해 요청 공유 카드 DOM (offscreen 렌더링 — display:none 금지, position:absolute; left:-9999px 사용)
 * 공유 카드 v2: 수신자(상대 교사) 관점으로 문구 및 일정 전면 반전 + 공용 MiniPreviewGrid 수록
 */
export function OffscreenShareCard({
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

/** 융합 카드의 주 단위 그리드: 상대 교사 실제 시간표 + 전 건의 빠짐/들어옴 마커 일괄 표시 */
export function RecipientWeekBlock({
  block,
  periodsPerDay,
}: {
  block: ConsolidatedShareData["weekBlocks"][number];
  periodsPerDay: number;
}) {
  const maxPeriod = Math.max(7, periodsPerDay || 7);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden text-xs bg-white shadow-xs">
      <div className="bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-700 border-b border-gray-200">
        🗓️ {getWeekRangeLabel(block.startDate)} 주 선생님 시간표
      </div>
      <table className="w-full table-fixed border-collapse text-center">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold">
            <th className="py-1 px-0.5 border-r border-gray-200 w-8 text-xs">교시</th>
            {DAYS.map((d) => {
              const dateLabel = getDayDateLabel(block.startDate, d.num);
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
                  const matched = block.cells.filter((c) => c.day === d.num && c.period === period);
                  const marker = block.markers.find((m) => m.day === d.num && m.period === period);
                  const hasLesson = matched.length > 0;

                  let cellStyle = "bg-white text-gray-400";
                  if (marker?.kind === "out") cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                  else if (marker?.kind === "in") cellStyle = "bg-emerald-100 border border-emerald-400 font-bold text-emerald-900";
                  else if (hasLesson) cellStyle = "bg-gray-100 text-gray-700 font-medium";

                  return (
                    <td key={d.num} className={`p-0.5 h-10 text-xs align-middle ${cellStyle}`}>
                      {marker ? (
                        <div className="space-y-0.5">
                          <div className={`text-[9px] font-extrabold ${marker.kind === "out" ? "text-amber-900" : "text-emerald-900"}`}>
                            {marker.kind === "out" ? "➖ 빠짐" : "➕ 들어옴"}
                          </div>
                          <div className="font-bold text-[10px] truncate max-w-[48px] mx-auto">
                            {marker.label}
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
  );
}

export function OffscreenConsolidatedCard({
  cardRef,
  data,
}: {
  cardRef: React.RefObject<HTMLDivElement | null>;
  data: ConsolidatedShareData | null;
}) {
  if (!data) {
    return <div ref={cardRef} style={{ position: "absolute", left: "-9999px", top: "-9999px", pointerEvents: "none" }} />;
  }

  const n = data.items.length;

  return (
    <div style={{ position: "absolute", left: "-9999px", top: "-9999px", pointerEvents: "none" }}>
      <div
        ref={cardRef}
        className="w-[520px] bg-white border border-indigo-200 rounded-2xl p-5 shadow-xl space-y-4 font-sans text-gray-900"
      >
        <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-800 text-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-[10px] font-bold text-indigo-200 tracking-wider">HYOMYUNG HIGH SCHOOL</div>
          <div className="text-lg font-black mt-0.5 tracking-tight">수업교환 양해 요청{n > 1 ? ` (${n}건)` : ""}</div>
        </div>

        <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3.5 space-y-1 text-xs">
          <div className="font-extrabold text-indigo-950 text-sm">
            안녕하세요, {data.counterpartName} 선생님! 👋
          </div>
          <div className="text-gray-700 leading-relaxed text-xs">
            <span className="font-bold text-indigo-900">{data.senderLabel || `${data.requesterName} 교사`}</span>입니다.<br />
            {n > 1
              ? `아래 ${n}건의 수업 교체가 가능할지 여쭙습니다. 😊`
              : "아래 일정으로 수업 교체가 가능할까요? 😊"}
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl p-3.5 space-y-2 text-xs bg-gray-50/40">
          <div className="font-bold text-gray-800 border-b border-gray-200 pb-1.5">
            🔄 교환 목록 (선생님 기준)
          </div>
          {data.items.map((d, i) => {
            const tgtWeek = d.targetWeekId || d.sourceWeekId;
            const srcSlot = formatSlotWithDate(d.sourceWeekId, d.source.day, d.source.period);
            const tgtSlot = formatSlotWithDate(tgtWeek, d.candidate.targetDay, d.candidate.targetPeriod);
            return (
              <div key={d.id || i} className="flex items-start gap-2 bg-white border border-gray-200 rounded-lg p-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div className="space-y-0.5">
                  <div className="font-bold text-amber-900">
                    선생님의 {d.source.grade}-{d.source.classNum}반 {d.candidate.counterpartSubjectName || "수업"} : {tgtSlot} → {srcSlot}
                  </div>
                  <div className="font-bold text-emerald-900">
                    {data.ownerLabel || "제"} {d.source.grade}-{d.source.classNum}반 {d.source.subjectName} : {srcSlot} → {tgtSlot}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
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
          {data.weekBlocks.map((block) => (
            <RecipientWeekBlock key={block.weekId} block={block} periodsPerDay={data.periodsPerDay} />
          ))}
        </div>

        <div className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-2 font-medium">
          효명고등학교 학적 & 일과진행 시스템
        </div>
      </div>
    </div>
  );
}

/**
 * 오프스크린 공유 카드 DOM을 PNG 이미지로 복사/다운로드하는 공용 헬퍼 함수
 */
export async function copyShareImageElement(node: HTMLDivElement | null): Promise<void> {
  if (!node) return;
  try {
    const { toBlob, toPng } = await import("html-to-image");
    // 클립보드 직납 시도
    let blob: Blob | null = null;
    try {
      blob = await toBlob(node, { pixelRatio: 2, cacheBust: true });
    } catch {
      // toBlob 실패 시 toPng → fetch blob
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
      const res = await fetch(dataUrl);
      blob = await res.blob();
    }
    if (blob && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      alert("📋 수업교환 양해 이미지가 클립보드에 복사되었습니다!\n메신저(카카오톡, 구글 챗 등)에 바로 붙여넣기(Ctrl+V)하세요.");
      return;
    }
  } catch (clipboardErr) {
    console.warn("[copyShareImageElement] Clipboard write failed, trying PNG download fallback:", clipboardErr);
  }

  // 폴백: PNG 자동 다운로드
  try {
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true });
    const link = document.createElement("a");
    link.download = `수업교환_양해요청카드_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    alert("📥 클립보드 복사가 안 되는 환경이라 양해 이미지를 PNG 파일로 다운로드했습니다.");
  } catch (err: any) {
    alert(`양해 이미지를 만들 수 없습니다: ${err.message}`);
  }
}
