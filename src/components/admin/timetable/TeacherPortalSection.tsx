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
import {
  SWAP_REASON_TYPES,
  SwapCandidate,
  SwapCandidatesResult,
  SwapRequest,
  SwapRequestReason,
  SubstituteCandidate,
  TeacherTimetableCell,
  TimetableSettings,
  TimetableWeek,
} from "@/lib/timetable/types";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";

const DAYS = [
  { num: 1, label: "월" },
  { num: 2, label: "화" },
  { num: 3, label: "수" },
  { num: 4, label: "목" },
  { num: 5, label: "금" },
];

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

// ── ① 내 주간시간표 탭 ─────────────────────────────────────────
interface MyTimetableTabProps {
  periodsPerDay: number;
  settings: TimetableSettings | null;
}

function MyTimetableTab({ periodsPerDay, settings }: MyTimetableTabProps) {
  const { userData } = useAuth();

  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string>("");
  const [cells, setCells] = useState<TeacherTimetableCell[]>([]);
  const [termMeta, setTermMeta] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 셀 클릭 → 후보 조회 상태
  const [selectedCell, setSelectedCell] = useState<TeacherTimetableCell | null>(null);
  const [candidatesResult, setCandidatesResult] = useState<SwapCandidatesResult | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

  // ① 양방향 연동 상태: 카드 호버/선택 → 셀 강조
  const [hoveredCandidateKey, setHoveredCandidateKey] = useState<string | null>(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  // 후보 카드 컨테이너 ref (스크롤용)
  const candidateListRef = useRef<HTMLDivElement>(null);

  // 신청 상태
  const [applyingCandidate, setApplyingCandidate] = useState<SwapCandidate | null>(null);
  const [reason, setReason] = useState<SwapRequestReason>({ type: "출장" });
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // 상대 교사 시간표 미리보기 상태 및 캐시
  const [previewCells, setPreviewCells] = useState<TeacherTimetableCell[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewCacheRef = useRef<Map<string, TeacherTimetableCell[]>>(new Map());

  // 후보 카드(상대 교사) 선택 시 상대 교사 시간표 로드
  useEffect(() => {
    if (!applyingCandidate) {
      setPreviewCells(null);
      setPreviewError(null);
      return;
    }
    const counterpartEmail = applyingCandidate.counterpartEmail;
    if (!counterpartEmail) return;

    const cacheKey = `${counterpartEmail}_${selectedWeekId}`;
    if (previewCacheRef.current.has(cacheKey)) {
      setPreviewCells(previewCacheRef.current.get(cacheKey) || []);
      setPreviewError(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    fetch("/api/timetable/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "teacher",
        teacherEmail: counterpartEmail,
        weekId: selectedWeekId || undefined,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("시간표를 불러올 수 없습니다."))))
      .then((res) => {
        const fetchedCells: TeacherTimetableCell[] = res.data?.cells || [];
        previewCacheRef.current.set(cacheKey, fetchedCells);
        setPreviewCells(fetchedCells);
      })
      .catch((e: any) => {
        setPreviewError(e?.message || "상대 시간표를 불러올 수 없습니다.");
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  }, [applyingCandidate, selectedWeekId]);

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

  const fetchTimetable = useCallback(async (weekId?: string) => {
    setLoading(true);
    setError(null);
    setSelectedCell(null);
    setCandidatesResult(null);
    setHoveredCandidateKey(null);
    setSelectedCandidateKey(null);
    setPreviewCells(null);
    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "my", weekId: weekId || undefined }),
      });
      if (res.ok) {
        const result = await res.json();
        setTermMeta(result.term || null);
        setCells(result.data?.cells || []);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "시간표를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setError(`네트워크 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTimetable(selectedWeekId || undefined);
  }, [selectedWeekId, fetchTimetable]);

  /** 맞교환 후보 카드의 고유 키 (day·period·counterpartEmail) */
  const candidateKey = (sc: SwapCandidate) =>
    `${sc.targetDay}-${sc.targetPeriod}-${sc.counterpartEmail}`;

  /** 셀 클릭 후 해당 후보 카드로 스크롤·강조 */
  const scrollToCandidate = useCallback((key: string) => {
    setTimeout(() => {
      const el = document.getElementById(`candidate-card-${key}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.classList.add("ring-2", "ring-indigo-500");
        setTimeout(() => el.classList.remove("ring-2", "ring-indigo-500"), 1200);
      }
    }, 120);
  }, []);

  const handleCellClick = async (cell: TeacherTimetableCell) => {
    if (!selectedWeekId) {
      alert("먼저 조회할 주를 선택해 주세요. 주가 등록되어 있어야 교환 신청이 가능합니다.");
      return;
    }
    setSelectedCell(cell);
    setCandidatesResult(null);
    setCandidatesError(null);
    setCandidatesLoading(true);
    setApplyingCandidate(null);
    setSelectedCandidateKey(null);
    setHoveredCandidateKey(null);
    setSubmitResult(null);
    setPreviewCells(null);
    try {
      const res = await fetch("/api/timetable/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "candidates",
          weekId: selectedWeekId,
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
        setCandidatesResult(data);
        // 셀 클릭 후 첫 번째 맞교환 후보 카드로 자동 스크롤
        if ((data.swapCandidates?.length ?? 0) > 0) {
          const first = data.swapCandidates[0] as SwapCandidate;
          scrollToCandidate(candidateKey(first));
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setCandidatesError(err.error || "후보를 불러올 수 없습니다.");
      }
    } catch (e: any) {
      setCandidatesError(`오류: ${e.message}`);
    } finally {
      setCandidatesLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!applyingCandidate || !selectedCell || !selectedWeekId) return;
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
          weekId: selectedWeekId,
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
        setApplyingCandidate(null);
        setCandidatesResult(null);
        setSelectedCell(null);
        // ① 제출 성공 시 유령 강조 방지 — 두 키 초기화 및 미리보기 초기화
        setSelectedCandidateKey(null);
        setHoveredCandidateKey(null);
        setPreviewCells(null);
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

  const getCellFor = (day: number, period: number) =>
    cells.filter((c) => c.day === day && c.period === period);

  const isSwapTarget = (day: number, period: number) =>
    !!candidatesResult?.swapCandidates?.some(
      (sc) => sc.targetDay === day && sc.targetPeriod === period
    );

  /** 카드 호버/선택으로 해당 셀이 강조돼야 하는지 */
  const isCellHighlightedByCard = (day: number, period: number) => {
    const key = hoveredCandidateKey || selectedCandidateKey;
    if (!key) return false;
    const [d, p] = key.split("-");
    return Number(d) === day && Number(p) === period;
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-gray-700">조회할 주:</span>
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          >
            <option value="">기초시간표 (주 미지정)</option>
            {weeks.map((w) => (
              <option key={w.id} value={w.id}>{w.startDate} 주</option>
            ))}
          </select>
          {termMeta && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-medium">
              {termMeta.name}
            </span>
          )}
          {loading && <span className="text-xs text-indigo-500 animate-pulse font-semibold">조회 중...</span>}
          {selectedWeekId && (
            <span className="text-[11px] text-gray-400">
              💡 내 수업 셀을 클릭하면 교환 신청 가능한 슬롯을 확인할 수 있습니다.
            </span>
          )}
        </div>
      </div>

      {submitResult && (
        <div className={`rounded-xl p-4 text-sm font-semibold border ${
          submitResult.startsWith("✅")
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
        {/* 주간 시간표 그리드 */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-950 to-indigo-800 px-5 py-3">
            <h3 className="text-sm font-bold text-white">🗓️ 내 주간시간표</h3>
            <p className="text-[11px] text-indigo-300 mt-0.5">
              {selectedWeekId
                ? "변경된 셀은 빨간 배경으로 표시됩니다. 내 수업 셀 클릭 시 교환 신청 플로우가 시작됩니다."
                : "기초시간표 (주 선택 시 변경 반영)"}
            </p>
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-2 px-2 border-r border-gray-200 w-12 text-center text-gray-500 font-bold text-[10px]">교시</th>
                {DAYS.map((d) => (
                  <th key={d.num} className="py-2 px-1 text-center text-gray-700 font-bold text-[11px]">{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, idx) => {
                const period = idx + 1;
                return (
                  <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                    <td className="py-3 px-2 border-r border-gray-200 text-center font-bold text-gray-400 bg-gray-50 text-[11px]">{period}</td>
                    {DAYS.map((d) => {
                      const matched = getCellFor(d.num, period);
                      const hasLesson = matched.length > 0;
                      const isTarget = isSwapTarget(d.num, period);
                      const isSelected = selectedCell?.day === d.num && selectedCell?.period === period;

                      const isCardHighlighted = isCellHighlightedByCard(d.num, period);
                      return (
                        <td
                          key={d.num}
                          className={`p-1 border-r border-gray-100 text-center align-top transition-all
                            ${isSelected ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50" : ""}
                            ${isTarget && !isSelected && !isCardHighlighted ? "bg-green-50 ring-1 ring-inset ring-green-400" : ""}
                            ${isCardHighlighted && !isSelected ? "bg-amber-50 ring-2 ring-inset ring-amber-400" : ""}
                            ${hasLesson && !isSelected && !isTarget && !isCardHighlighted ? "hover:bg-indigo-50/60 cursor-pointer" : ""}
                          `}
                          onClick={() => { if (hasLesson) handleCellClick(matched[0]); }}
                        >
                          {hasLesson ? (
                            matched.map((cell, ci) => {
                              const changed = (cell as any).changed;
                              const isChanged = !!changed;
                              const tooltip = isChanged && changed?.origin
                                ? `${DAY_LABEL[cell.day]}${cell.period} ← ${DAY_LABEL[(changed.origin as any).day]}${(changed.origin as any).period}에서 이동`
                                : `${cell.subjectName} · ${cell.grade}-${cell.classNum}반`;
                              return (
                                <div
                                  key={ci}
                                  title={tooltip}
                                  className={`p-1.5 rounded text-center space-y-0.5 text-[10px] ${
                                    isChanged
                                      ? "bg-red-100 border border-red-300"
                                      : "bg-white border border-indigo-200 shadow-2xs"
                                  }`}
                                >
                                  <div className={`font-black ${isChanged ? "text-red-800" : "text-indigo-950"}`}>
                                    {cell.subjectShort || cell.subjectName}
                                    {isChanged && <span className="ml-0.5 text-red-600 font-bold text-[9px]">▲</span>}
                                  </div>
                                  <div className="text-[9px] text-gray-500">{cell.grade}-{cell.classNum}반</div>
                                  {isTarget && <div className="text-[9px] font-bold text-green-700">교환 가능 ✓</div>}
                                </div>
                              );
                            })
                          ) : isTarget ? (
                            <div className="py-2 text-[10px] font-bold text-green-700">🟢 공강</div>
                          ) : (
                            <span className="text-[10px] text-gray-200 block py-2">-</span>
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

        {/* 우측 패널: 후보 목록 및 신청 폼 */}
        {selectedCell && (
          <div className="w-80 shrink-0 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-900 to-indigo-700 px-4 py-3">
              <div className="text-xs font-bold text-white">
                수업교환 신청 — {DAY_LABEL[selectedCell.day]}요일 {selectedCell.period}교시
              </div>
              <div className="text-[11px] text-indigo-300 mt-0.5">
                {selectedCell.subjectName} · {selectedCell.grade}-{selectedCell.classNum}반
              </div>
            </div>

            <div className="p-4 space-y-4">
              {candidatesLoading && (
                <div className="text-center py-4 text-xs text-indigo-500 animate-pulse font-semibold">후보 계산 중...</div>
              )}
              {candidatesError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">{candidatesError}</div>
              )}

              {candidatesResult && !candidatesLoading && (
                <>
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-gray-700">
                      맞교환 후보 ({candidatesResult.swapCandidates?.length || 0}건)
                    </div>
                    {(candidatesResult.swapCandidates?.length ?? 0) === 0 ? (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                        <p className="font-semibold">⚠️ 맞교환 가능한 상대가 없습니다.</p>
                        <p className="text-[11px] text-amber-800">
                          결강 처리가 필요하면 일과계에 문의해 주세요 (특별보강은 일과계가 직권 배정).
                        </p>
                      </div>
                    ) : (
                      <div ref={candidateListRef} className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {candidatesResult.swapCandidates?.map((sc, i) => {
                          const ck = candidateKey(sc);
                          const isActive = applyingCandidate === sc;
                          const isHovered = hoveredCandidateKey === ck;
                          const isSelected2 = selectedCandidateKey === ck;
                          return (
                            <div
                              key={i}
                              id={`candidate-card-${ck}`}
                              className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                                isActive
                                  ? "bg-indigo-50 border-indigo-400 shadow-xs"
                                  : isHovered || isSelected2
                                  ? "bg-amber-50 border-amber-400"
                                  : "bg-white border-gray-200 hover:bg-indigo-50/50 hover:border-indigo-300"
                              }`}
                              onMouseEnter={() => setHoveredCandidateKey(ck)}
                              onMouseLeave={() => setHoveredCandidateKey(null)}
                              onClick={() => {
                                setApplyingCandidate(sc);
                                setSelectedCandidateKey(ck);
                              }}
                            >
                              <div className="font-bold text-gray-900">
                                {DAY_LABEL[sc.targetDay]}요일 {sc.targetPeriod}교시 ↔ {sc.counterpartName}
                              </div>
                              <div className="text-gray-500">{sc.counterpartSubjectName}</div>
                              {sc.score > 0 ? (
                                <div className="mt-1 text-orange-600 font-semibold text-[11px]">
                                  ⚠ 감점 {sc.score} — {sc.penalties.join(", ")}
                                </div>
                              ) : (
                                <div className="mt-1 text-green-600 font-semibold text-[11px]">✓ 최적</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 징검다리 — 자동 탐색은 미제공, 일과계 직권 순차 처리로 지원 */}
                  <details>
                    <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                      연쇄(징검다리) 교환이 필요한 경우 ▸
                    </summary>
                    <div className="mt-2 p-2 bg-gray-50 rounded-lg text-[11px] text-gray-500 space-y-1">
                      <p>
                        ⚠️ 통상은 위의 맞교환으로 충분하며, 연쇄 교환은 사용하지 않습니다.
                      </p>
                      <p>
                        다만 경조사 등으로 <b>직접 교환 상대가 없는데 꼭 옮겨야 하는 경우</b>, 일과계에
                        문의하시면 직권 배정을 두 번 이어 실행하는 방식(징검다리)으로 처리해 드릴 수
                        있습니다. 원하는 요일·교시를 함께 알려주세요.
                      </p>
                    </div>
                  </details>
                </>
              )}

              {/* 상대 교사 시간표 미리보기 미니 그리드 */}
              {applyingCandidate && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div className="text-xs font-bold text-gray-800 flex items-center justify-between">
                    <span>🔍 {applyingCandidate.counterpartName} 교사 시간표 미리보기</span>
                    {previewLoading && <span className="text-[10px] text-indigo-500 animate-pulse font-semibold">조회 중...</span>}
                  </div>
                  <div className="text-[10px] text-gray-500 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400 inline-block" />
                      상대 수업 (내게 넘어옴)
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-green-200 border border-green-400 inline-block" />
                      내 수업 시간 (상대 공강)
                    </span>
                  </div>
                  {previewError && <div className="text-[11px] text-red-600 bg-red-50 p-2 rounded">{previewError}</div>}
                  {previewCells && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden text-[10px]">
                      <table className="w-full border-collapse text-center">
                        <thead>
                          <tr className="bg-gray-100 border-b border-gray-200 text-gray-600 font-bold">
                            <th className="py-1 px-1 border-r border-gray-200 w-7">교시</th>
                            {DAYS.map((d) => (
                              <th key={d.num} className="py-1 px-0.5">{d.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, idx) => {
                            const period = idx + 1;
                            const sc = applyingCandidate;
                            return (
                              <tr key={period} className="border-b border-gray-100 last:border-0">
                                <td className="py-1 px-1 border-r border-gray-200 bg-gray-50 font-bold text-gray-400 text-[9px]">{period}</td>
                                {DAYS.map((d) => {
                                  const matched = previewCells.filter((c) => c.day === d.num && c.period === period);
                                  const isTargetSlot = sc.targetDay === d.num && sc.targetPeriod === period;
                                  const isSourceSlot = selectedCell.day === d.num && selectedCell.period === period;
                                  const hasLesson = matched.length > 0;

                                  let cellStyle = "bg-white text-gray-400";
                                  if (isTargetSlot) {
                                    cellStyle = "bg-amber-100 border border-amber-400 font-bold text-amber-900";
                                  } else if (isSourceSlot) {
                                    cellStyle = "bg-green-100 border border-green-400 font-bold text-green-900";
                                  } else if (hasLesson) {
                                    cellStyle = "bg-gray-100 text-gray-700";
                                  }

                                  return (
                                    <td key={d.num} className={`p-0.5 text-[9px] ${cellStyle}`}>
                                      {hasLesson ? (
                                        <div className="truncate max-w-[42px] mx-auto" title={`${matched[0].subjectName} (${matched[0].grade}-${matched[0].classNum}반)`}>
                                          {matched[0].subjectShort || matched[0].subjectName}
                                        </div>
                                      ) : isTargetSlot ? (
                                        <div className="text-[8px]">상대수업</div>
                                      ) : isSourceSlot ? (
                                        <div className="text-[8px]">상대공강</div>
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
                </div>
              )}

              {/* 신청 폼 */}
              {applyingCandidate && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="text-xs font-bold text-gray-800">신청 사유 (필수)</div>
                  <select
                    value={reason.type}
                    onChange={(e) => setReason({ type: e.target.value as any, note: reason.note })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {SWAP_REASON_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {reason.type === "기타" && (
                    <textarea
                      value={reason.note || ""}
                      onChange={(e) => setReason({ ...reason, note: e.target.value })}
                      placeholder="사유를 입력해 주세요 (필수)"
                      rows={2}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                    />
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || (reason.type === "기타" && !reason.note?.trim())}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shadow-sm"
                  >
                    {submitting ? "신청 중..." : "수업교환 신청하기"}
                  </button>
                  <button
                    onClick={() => {
                      setApplyingCandidate(null);
                      setPreviewCells(null);
                    }}
                    className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
  const [requests, setRequests] = useState<SwapRequest[]>([]);
  const [weeks, setWeeks] = useState<TimetableWeek[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
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
            return (
              <div key={req.id} className="border border-gray-200 rounded-xl p-4 space-y-2 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-gray-900">
                      {req.weekId} 주 — {req.type === "swap" ? "맞교환" : "특별보강"}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      원 수업: {DAY_LABEL[req.source.day]}요일 {req.source.period}교시 ({req.source.subjectName}, {req.source.grade}-{req.source.classNum}반)
                    </div>
                    {req.type === "swap" && req.candidate.targetDay != null && (
                      <div className="text-[11px] text-gray-600">
                        교환: {DAY_LABEL[req.candidate.targetDay!]}요일 {req.candidate.targetPeriod}교시 ({req.candidate.counterpartName})
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
      .then((data) => { if (data?.success) setWeeks(data.weeks || []); })
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
          <p className="text-xs text-gray-500 mt-0.5">교사를 검색하여 주간 합성 시간표를 조회합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs"
          >
            <option value="">기초시간표</option>
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
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-indigo-950 text-white font-bold">
              <th className="py-3 px-2 border-b border-r border-indigo-800 w-16 text-center">교시</th>
              {DAYS.map((d) => (
                <th key={d.num} className="py-3 px-2 border-b border-indigo-800 text-center">{d.label}요일</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {Array.from({ length: Math.max(7, periodsPerDay) }).map((_, pIdx) => {
              const period = pIdx + 1;
              return (
                <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                  <td className="py-4 px-2 border-r border-gray-200 text-center font-bold text-gray-500 bg-gray-50">{period}교시</td>
                  {DAYS.map((d) => {
                    const matched = getCellFor(d.num, period);
                    const hasLesson = matched.length > 0;
                    return (
                      <td key={d.num} className={`p-2 border-r border-gray-100 text-center align-top transition-colors ${hasLesson ? "bg-indigo-50/40 hover:bg-indigo-100/50" : ""}`}>
                        {hasLesson ? (
                          <div className="space-y-1.5">
                            {matched.map((cell, cIdx) => {
                              const isChanged = !!(cell as any).changed;
                              return (
                                <div key={cIdx} className={`p-2 rounded-lg space-y-1 ${isChanged ? "bg-red-50 border border-red-300" : "bg-white border border-indigo-200 shadow-2xs"}`}>
                                  <div className={`font-black text-xs ${isChanged ? "text-red-800" : "text-indigo-950"}`}>
                                    {cell.subjectShort || cell.subjectName}
                                    {isChanged && <span className="ml-0.5 text-red-500 text-[9px]">▲</span>}
                                  </div>
                                  <div className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">
                                    {cell.grade}-{cell.classNum}반
                                  </div>
                                  {cell.room && <div className="text-[10px] text-gray-500 truncate">📍 {cell.room}</div>}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-300 font-light block py-2">-</span>
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
