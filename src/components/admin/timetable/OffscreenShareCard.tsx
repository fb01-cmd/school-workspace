"use client";

import { CandidateCoordination, SwapDraft, TeacherTimetableCell, TimetableWeek } from "@/lib/timetable/types";
import { formatSlotWithDate, getDayDateLabel, getWeekRangeLabel } from "@/lib/timetable/utils";
import MiniPreviewGrid, { DAYS } from "./MiniPreviewGrid";

export interface ShareCardData {
  variant?: "occupant" | "counterpart";
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
    coordination?: CandidateCoordination;
  };
  previewCells?: TeacherTimetableCell[] | null;
  counterpartSourceCells?: TeacherTimetableCell[] | null;
  counterpartTargetCells?: TeacherTimetableCell[] | null;
  periodsPerDay?: number;
}

/** 체인 접기 결과: 한 수업의 (시작 → 최종) 순 이동. 경유 슬롯은 접혀서 나타나지 않는다 */
export interface ConsolidatedNetMove {
  ownerName: string;
  /** 이 수업의 소유자가 카드 수신자(상대 교사) 본인인지 — 본인 이동은 앰버 강조·마커 대상 */
  isRecipient: boolean;
  grade: number;
  classNum: number;
  subjectName: string;
  from: { weekId: string; day: number; period: number };
  to: { weekId: string; day: number; period: number };
}

export interface ConsolidatedShareData {
  requesterName: string;
  /** §14-4: 발신자 표기 재정의 (예: "일과계 ○○○") — 없으면 "{requesterName} 교사". 직권 카드는 조작자 명의로 양해를 구한다 */
  senderLabel?: string;
  /** §14-4: 교환 목록에서 수업 소유자 표기 — 없으면 "제"(교사 본인 발신). 직권 카드는 "○○○ 선생님의" */
  ownerLabel?: string;
  counterpartName: string;
  /** 교환(swap·cross_swap) 항목의 순 효과 접기 결과. 있으면 교환 목록을 이걸로 그린다 —
   *  체인은 다리(leg)별 나열 시 경유 슬롯이 들어옴·빠짐으로 이중 계상되고 제3 교사 수업의
   *  소유자가 ownerLabel로 오표기되므로, 최종 결과 기준으로만 보여준다 (2026-08-08 실증).
   *  이 필드가 없으면 기존 항목별 렌더(교사 신청 화면 등 비체인 경로) 유지 */
  netMoves?: ConsolidatedNetMove[];
  /** netMoves 경로에서 원 교환 항목 수 — 2건 이상이면 "단계적 반영·최종 결과 기준" 참고 문구 표시 */
  swapStepCount?: number;
  items: SwapDraft[] | Array<{
    id?: string;
    /** "substitute"면 보강 요청 서식 — 상대는 수업을 받기만 하므로 교환 문구를 쓰지 않는다 (2026-08-07) */
    type?: string;
    sourceWeekId: string;
    targetWeekId?: string;
    source: { grade: number; classNum: number; day: number; period: number; subjectName: string };
    candidate: { targetDay?: number; targetPeriod?: number; counterpartName?: string; counterpartSubjectName?: string; coordination?: CandidateCoordination };
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
 * (consent_swap_opening_spec §3-2: candidate.coordination 조율 당사자 변형 수록)
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

  // 조율 당사자 변형 (consent_swap_opening_spec §3-2d U2: variant prop으로 분기 구분)
  const coordination = data.candidate.coordination;
  const hasConflicts = !!(coordination && coordination.conflicts && coordination.conflicts.length > 0);
  const isOccupantVariant = data.variant ? data.variant === "occupant" : hasConflicts;
  const primaryConflict = hasConflicts ? coordination!.conflicts[0] : null;
  const roomName = primaryConflict?.roomName || "특별실";
  const occupants = primaryConflict?.occupants || [];
  const occupantTitle = occupants.length > 0
    ? occupants.map((o) => `${o.teacherName} 선생님`).join(", ")
    : counterpartTitle;
  const conflictSlotStr = primaryConflict
    ? formatSlotWithDate(primaryConflict.slot.weekId, primaryConflict.slot.day, primaryConflict.slot.period)
    : targetSlotStr;

  return (
    <div style={{ position: "absolute", left: "-9999px", top: "-9999px", pointerEvents: "none" }}>
      <div
        ref={cardRef}
        className="w-[520px] bg-white border border-indigo-200 rounded-2xl p-5 shadow-xl space-y-4 font-sans text-gray-900"
      >
        <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-800 text-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-[10px] font-bold text-indigo-200 tracking-wider">HYOMYUNG HIGH SCHOOL</div>
          <div className="text-lg font-black mt-0.5 tracking-tight">
            {isOccupantVariant ? "🤝 장소 양해 요청" : "수업교환 양해 요청"}
          </div>
        </div>

        {isOccupantVariant ? (
          /* 조율 당사자 변형 카드 (spec §3-2) */
          <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 space-y-1.5 text-xs">
            <div className="font-extrabold text-amber-950 text-sm">
              안녕하세요, {occupantTitle}! 👋
            </div>
            <div className="text-amber-900 leading-relaxed text-xs">
              <span className="font-bold text-indigo-900">{data.requesterName} 교사</span>입니다.<br />
              교체하면 <b>{conflictSlotStr}</b>에 <b>{roomName}</b> 사용이 겹칩니다 ─ 사용 중: <b>{occupantTitle}</b>
            </div>
          </div>
        ) : (
          /* 기존 수업교환 양해 카드 */
          <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3.5 space-y-1 text-xs">
            <div className="font-extrabold text-indigo-950 text-sm">
              안녕하세요, {counterpartTitle}! 👋
            </div>
            <div className="text-gray-700 leading-relaxed text-xs">
              <span className="font-bold text-indigo-900">{data.requesterName} 교사</span>입니다.<br />
              아래 일정으로 수업 교체가 가능할까요? 😊
            </div>
          </div>
        )}

        {isOccupantVariant ? (
          /* 조율 당사자 상세 내용 */
          <div className="border border-amber-200 rounded-xl p-3.5 space-y-2.5 text-xs bg-amber-50/30">
            <div className="font-bold text-amber-950 border-b border-amber-200 pb-1.5 flex items-center justify-between">
              <span>🤝 특별실 양해 요청 상세 (선생님 기준)</span>
              <span className="text-[10px] bg-amber-100 text-amber-900 font-extrabold px-2 py-0.5 rounded-full border border-amber-300">
                특별실 겹침
              </span>
            </div>
            <div className="space-y-1.5 pt-0.5 text-gray-800">
              <div>• <b>특별실:</b> <span className="font-bold text-amber-950">{roomName}</span></div>
              <div>• <b>요청 교시:</b> <span className="font-bold text-indigo-900">{conflictSlotStr}</span></div>
              <div>• <b>선생님 수업:</b> {occupants.map((o) => `${o.teacherName} 선생님 (${o.grade}-${o.classNum}반 ${o.subjectName})`).join(", ")}</div>
              <div>• <b>신청자 수업:</b> {data.requesterName} 교사 ({data.source.grade}-{data.source.classNum}반 {data.source.subjectName})</div>
            </div>
          </div>
        ) : (
          /* 기존 수업교환 상세 내용 */
          <div className="border border-gray-200 rounded-xl p-3.5 space-y-2.5 text-xs bg-gray-50/40">
            <div className="font-bold text-gray-800 border-b border-gray-200 pb-1.5 flex items-center justify-between">
              <span>🔄 수업교환 상세 일정 (선생님 기준)</span>
              {data.targetWeekId && data.targetWeekId !== data.sourceWeekId && (
                <span className="text-[10px] bg-indigo-100 text-indigo-800 font-extrabold px-2 py-0.5 rounded-full border border-indigo-200">
                  ↔ {data.targetWeekId} 주 교차 주
                </span>
              )}
            </div>

            {/* §3-2d U2: 맞교환 상대 교사 카드에 특별실 겹침 명시 */}
            {hasConflicts && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-2.5 space-y-0.5 text-xs text-amber-950 font-bold">
                <div className="text-amber-900 font-extrabold text-[11px] flex items-center gap-1">
                  <span>⚠️</span>
                  <span>특별실 겹침 (조율 필요)</span>
                </div>
                <div className="text-amber-900 text-xs font-semibold">
                  교체하면 {conflictSlotStr}에 {roomName} 사용이 겹칩니다 ─ 사용 중: {occupantTitle}
                </div>
              </div>
            )}

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
        )}

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

  // netMoves 경로: 교환은 순 효과(수신자 본인 이동 건수)로, 보강은 items로 계수한다
  const netMode = Array.isArray(data.netMoves);
  const recipientMoves = netMode ? data.netMoves!.filter((m) => m.isRecipient) : [];
  const contextMoves = netMode ? data.netMoves!.filter((m) => !m.isRecipient) : [];
  const subItems = data.items.filter((d: any) => d.type === "substitute");
  const n = netMode ? recipientMoves.length + subItems.length : data.items.length;
  // 보강 항목은 상대가 수업을 "받기만" 하므로 교환 서식을 쓰면 안 된다 (2026-08-07 실증: 보강 담기가 교환 양해로 출력)
  const kinds = new Set(
    netMode
      ? [...(recipientMoves.length || contextMoves.length ? ["swap"] : []), ...(subItems.length ? ["substitute"] : [])]
      : data.items.map((d: any) => (d.type === "substitute" ? "substitute" : "swap"))
  );
  const allSub = kinds.size === 1 && kinds.has("substitute");
  const allSwap = kinds.size === 1 && kinds.has("swap");
  const cardTitle = allSub ? "수업 보강 요청" : allSwap ? "수업교환 양해 요청" : "수업 교체·보강 요청";
  const greeting = allSub
    ? n > 1 ? `아래 ${n}건의 보강이 가능하실지 여쭙습니다. 😊` : "아래 일정으로 보강이 가능하실까요? 😊"
    : allSwap
    ? n > 1 ? `아래 ${n}건의 수업 교체가 가능할지 여쭙습니다. 😊` : "아래 일정으로 수업 교체가 가능할까요? 😊"
    : `아래 ${n}건의 수업 협조가 가능하실지 여쭙습니다. 😊`;
  const listHeader = allSub ? "🙏 보강 요청 목록 (선생님 기준)" : allSwap ? "🔄 교환 목록 (선생님 기준)" : "🔄 요청 목록 (선생님 기준)";
  const hasOutMarker = data.weekBlocks.some((b) => b.markers.some((m) => m.kind === "out"));

  return (
    <div style={{ position: "absolute", left: "-9999px", top: "-9999px", pointerEvents: "none" }}>
      <div
        ref={cardRef}
        className="w-[520px] bg-white border border-indigo-200 rounded-2xl p-5 shadow-xl space-y-4 font-sans text-gray-900"
      >
        <div className="bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-800 text-white rounded-xl p-3.5 text-center shadow-sm">
          <div className="text-[10px] font-bold text-indigo-200 tracking-wider">HYOMYUNG HIGH SCHOOL</div>
          <div className="text-lg font-black mt-0.5 tracking-tight">{cardTitle}{n > 1 ? ` (${n}건)` : ""}</div>
        </div>

        <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3.5 space-y-1 text-xs">
          <div className="font-extrabold text-indigo-950 text-sm">
            안녕하세요, {data.counterpartName} 선생님! 👋
          </div>
          <div className="text-gray-700 leading-relaxed text-xs">
            <span className="font-bold text-indigo-900">{data.senderLabel || `${data.requesterName} 교사`}</span>입니다.<br />
            {greeting}
          </div>
        </div>

        <div className="border border-gray-200 rounded-xl p-3.5 space-y-2 text-xs bg-gray-50/40">
          <div className="font-bold text-gray-800 border-b border-gray-200 pb-1.5">
            {listHeader}
          </div>
          {netMode && (
            <>
              {recipientMoves.map((m, i) => (
                <div key={`rm${i}`} className="flex items-start gap-2 bg-amber-50/90 border border-amber-200 rounded-lg p-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-amber-600 text-white text-[10px] font-black flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <div className="font-bold text-amber-900">
                    선생님의 {m.grade}-{m.classNum}반 {m.subjectName} : {formatSlotWithDate(m.from.weekId, m.from.day, m.from.period)} → {formatSlotWithDate(m.to.weekId, m.to.day, m.to.period)}
                  </div>
                </div>
              ))}
              {recipientMoves.length === 0 && subItems.length === 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-2.5 text-gray-600 font-medium">
                  선생님 시간표의 최종 변동은 없습니다. 아래 수업 재배치에 대한 확인 요청입니다.
                </div>
              )}
              {contextMoves.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-2.5 space-y-1">
                  <div className="text-[10px] font-extrabold text-gray-500">함께 바뀌는 수업</div>
                  {contextMoves.map((m, i) => (
                    <div key={`cm${i}`} className="font-semibold text-emerald-900">
                      {m.ownerName} 선생님의 {m.grade}-{m.classNum}반 {m.subjectName} : {formatSlotWithDate(m.from.weekId, m.from.day, m.from.period)} → {formatSlotWithDate(m.to.weekId, m.to.day, m.to.period)}
                    </div>
                  ))}
                </div>
              )}
              {(data.swapStepCount || 0) >= 2 && (
                <div className="text-[10px] text-gray-400 font-medium pt-0.5">
                  ※ 여러 단계로 나뉘어 처리되는 교환이지만, 위 내용과 아래 시간표는 최종 결과 기준입니다.
                </div>
              )}
            </>
          )}
          {(netMode ? subItems : data.items).map((d: any, i) => {
            const tgtWeek = d.targetWeekId || d.sourceWeekId;
            const srcSlot = formatSlotWithDate(d.sourceWeekId, d.source.day, d.source.period);
            const tgtSlot = formatSlotWithDate(tgtWeek, d.candidate.targetDay, d.candidate.targetPeriod);
            const isSub = d.type === "substitute";
            return (
              <div key={d.id || i} className="flex items-start gap-2 bg-white border border-gray-200 rounded-lg p-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center mt-0.5">
                  {(netMode ? recipientMoves.length : 0) + i + 1}
                </span>
                {isSub ? (
                  <div className="space-y-0.5">
                    <div className="font-bold text-emerald-900">
                      {srcSlot} {d.source.grade}-{d.source.classNum}반 {d.source.subjectName} — 보강을 부탁드립니다
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {data.ownerLabel || "해당"} 수업을 대신 맡아주시는 일정입니다
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <div className="font-bold text-amber-900">
                      선생님의 {d.source.grade}-{d.source.classNum}반 {d.candidate?.counterpartSubjectName || "수업"} : {tgtSlot} → {srcSlot}
                    </div>
                    <div className="font-bold text-emerald-900">
                      {data.ownerLabel || "제"} {d.source.grade}-{d.source.classNum}반 {d.source.subjectName} : {srcSlot} → {tgtSlot}
                    </div>
                    {d.candidate?.coordination?.conflicts && d.candidate.coordination.conflicts.length > 0 && (
                      <div className="text-[10px] text-amber-900 bg-amber-50 border border-amber-300 rounded p-1 font-bold mt-1">
                        ⚠️ 교체하면 {formatSlotWithDate(d.candidate.coordination.conflicts[0].slot.weekId, d.candidate.coordination.conflicts[0].slot.day, d.candidate.coordination.conflicts[0].slot.period)} {d.candidate.coordination.conflicts[0].roomName} 사용이 겹칩니다 (사용 중: {d.candidate.coordination.conflicts[0].occupants.map((o: any) => `${o.teacherName} 선생님`).join(", ")})
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="text-[10px] text-gray-500 flex flex-wrap gap-2.5">
            {hasOutMarker && (
              <span className="inline-flex items-center gap-1 font-bold text-amber-900">
                <span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400 inline-block" />
                ➖ 빠짐 (선생님 시간표에서 빠질 수업)
              </span>
            )}
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
