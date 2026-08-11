"use client";

/**
 * Phase 9c-D: 자동 작성 탭 (phase9c_d_spec §3 · §4 · §5)
 *
 * Phase D-1 범위:
 *  - 초안 목록 화면: 카드(라벨·출처·하드/소프트·수정시각·[열기][삭제]) + [🤖 자동 작성][현행 복제]
 *  - 자동 작성 실행: solverClient.solveTimetableInWorker → 진행률 바 → 완료 시 draft_create 저장
 *  - 초안 열기: draft_get → 3면 편집기 골격 (메타 표시 + 학급 그리드 뷰어 — 이동/교환 UX는 Phase D-2)
 *
 * 솔버 사용 규칙: solverClient.solveTimetableInWorker만 사용, solver.worker.ts 직접 import 금지.
 */

import { useEffect, useRef, useState } from "react";
import { TimetableDraft, TimetableConstraintModel, ClassGrid } from "@/lib/timetable/types";
import { solveTimetableInWorker, SolverDone, SolverRun } from "@/lib/timetable/solverClient";

interface DraftAutoTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
}

const DAYS = ["월", "화", "수", "목", "금"];

// ── 유틸 ──
function hardBadgeColor(n: number) {
  return n === 0 ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-red-100 text-red-800 border-red-300";
}
function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DraftAutoTab({ activeTermId, periodsPerDay = 7 }: DraftAutoTabProps) {
  // ── 상태: 목록 ──
  const [drafts, setDrafts] = useState<TimetableDraft[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── 상태: 솔버 실행 ──
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [solverError, setSolverError] = useState<string | null>(null);
  const runRef = useRef<SolverRun | null>(null);

  // ── 상태: 초안 편집기 ──
  const [openDraft, setOpenDraft] = useState<{
    meta: TimetableDraft;
    currentGrids: ClassGrid[];
  } | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // 편집기 내부 그리드 뷰어 상태
  const [viewGrade, setViewGrade] = useState(1);
  const [viewClass, setViewClass] = useState(1);

  // ── 목록 로드 ──
  const fetchDrafts = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_list" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "목록을 불러오지 못했습니다.");
      setDrafts(data.drafts || []);
    } catch (err: any) {
      setListError(err.message);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, [activeTermId]);

  // ── 솔버 실행 ──
  const handleSolve = async () => {
    setSolverError(null);
    setProgress(null);

    // 1) 제약 모델 + 기준 그리드 로드 (draft_model)
    let model: TimetableConstraintModel;
    let baseGrids: ClassGrid[];
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_model", termId: activeTermId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "제약 모델 로드에 실패했습니다.");
      model = data.model as TimetableConstraintModel;
      baseGrids = data.baseGrids as ClassGrid[];
    } catch (err: any) {
      setSolverError(err.message);
      return;
    }

    if (!baseGrids || baseGrids.length === 0) {
      setSolverError("기초 시간표가 없습니다. 먼저 가져오기 탭에서 시간표를 가져와 주세요.");
      return;
    }

    // 2) 워커 실행
    setRunning(true);
    const run = solveTimetableInWorker({ grids: baseGrids, model }, (phase, done, total) => {
      setProgress({ phase, done, total });
    });
    runRef.current = run;

    let result: SolverDone;
    try {
      result = await run.promise;
    } catch (err: any) {
      if (err.message === "cancelled") {
        setRunning(false);
        setProgress(null);
        return;
      }
      setSolverError(err.message || "솔버 실행 중 오류가 발생했습니다.");
      setRunning(false);
      return;
    }

    // 3) 결과 저장 (draft_create)
    try {
      setProgress({ phase: "초안 저장 중...", done: 0, total: 1 });
      const unplaced = (result.unplaced || []).map((u) => ({
        sectionId: u.sectionId,
        label: u.label,
        remaining: u.remaining,
      }));
      const report = result.report;
      const origin = { kind: "solver" as const, seed: result.seed, ranking: result.ranking?.[0]?.seed };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_create",
          termId: activeTermId,
          draftOrigin: origin,
          draftGrids: result.grids,
          draftUnplaced: unplaced,
          draftReport: report,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "초안 저장에 실패했습니다.");

      await fetchDrafts();
    } catch (err: any) {
      setSolverError(err.message);
    } finally {
      setRunning(false);
      setProgress(null);
      runRef.current = null;
    }
  };

  const handleCancelSolver = () => {
    runRef.current?.cancel();
    setRunning(false);
    setProgress(null);
    setSolverError(null);
  };

  // ── 현행 복제 ──
  const handleCopy = async () => {
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_create",
          termId: activeTermId,
          draftOrigin: { kind: "copy" },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "복제에 실패했습니다.");
      await fetchDrafts();
    } catch (err: any) {
      alert(`현행 복제 오류: ${err.message}`);
    }
  };

  // ── 초안 열기 ──
  const handleOpen = async (draft: TimetableDraft) => {
    setLoadingDraft(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_get", draftId: draft.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "초안을 열지 못했습니다.");
      setOpenDraft({ meta: data.meta, currentGrids: data.currentGrids });
      setViewGrade(1);
      setViewClass(1);
    } catch (err: any) {
      setDraftError(err.message);
    } finally {
      setLoadingDraft(false);
    }
  };

  // ── 초안 삭제 ──
  const handleDelete = async (draft: TimetableDraft) => {
    if (!confirm(`'${draft.label}' 초안을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft_delete", draftId: draft.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "삭제에 실패했습니다.");
      if (openDraft?.meta.id === draft.id) setOpenDraft(null);
      await fetchDrafts();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    }
  };

  // ── 편집기 뷰: 현재 선택 반 그리드 ──
  const currentGrid = openDraft?.currentGrids.find(
    (g) => g.grade === viewGrade && g.classNum === viewClass
  );

  // ── 편집기 화면 ──
  if (openDraft) {
    const { meta } = openDraft;
    const report = meta.lastReport;
    return (
      <div className="space-y-5">
        {/* 상단 바 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setOpenDraft(null)}
            className="text-xs text-gray-500 hover:text-gray-800 font-bold flex items-center gap-1"
          >
            ← 목록으로
          </button>
          <span className="font-bold text-sm text-gray-900 flex-1 min-w-0 truncate">
            🧩 {meta.label}
          </span>
          <div className="flex items-center gap-2">
            {report && (
              <>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full border font-extrabold ${hardBadgeColor(report.hardCount)}`}
                >
                  하드 {report.hardCount}건
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full border font-extrabold bg-amber-100 text-amber-800 border-amber-300">
                  소프트 {report.softTotal}점
                </span>
              </>
            )}
            <span className="text-[11px] text-gray-500">
              {meta.origin.kind === "solver"
                ? `🤖 자동 작성 (시드 ${meta.origin.seed ?? "—"})`
                : "📋 현행 복제"}
            </span>
          </div>
        </div>

        {draftError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold">
            {draftError}
          </div>
        )}

        {/* 3면 골격: 좌=학급 그리드, 우=미배정 목록 */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* 좌: 학급 그리드 뷰어 */}
          <div className="xl:col-span-8 space-y-4">
            {/* 학년/반 선택 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs font-bold text-gray-700">학년:</span>
                {[1, 2, 3].map((g) => (
                  <button
                    key={g}
                    onClick={() => { setViewGrade(g); setViewClass(1); }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                      viewGrade === g
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    {g}학년
                  </button>
                ))}
                <span className="text-xs font-bold text-gray-700 ml-3">반:</span>
                {Array.from({ length: 12 }, (_, i) => i + 1)
                  .filter((c) =>
                    openDraft.currentGrids.some((g) => g.grade === viewGrade && g.classNum === c)
                  )
                  .map((c) => (
                    <button
                      key={c}
                      onClick={() => setViewClass(c)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${
                        viewClass === c
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
              </div>
            </div>

            {/* 그리드 테이블 */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              {!currentGrid ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  {viewGrade}학년 {viewClass}반 시간표가 없습니다.
                </div>
              ) : (
                <table className="w-full text-center text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-700">
                      <th className="py-2 px-2 border-r border-gray-200 w-10">교시</th>
                      {DAYS.map((d) => (
                        <th key={d} className="py-2 px-1 border-r border-gray-200 min-w-[5.5rem]">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Array.from({ length: Math.max(7, periodsPerDay) }, (_, i) => i + 1).map((period) => (
                      <tr key={period}>
                        <td className="py-2 px-2 font-bold bg-gray-50 border-r border-gray-200 text-gray-600">
                          {period}
                        </td>
                        {[1, 2, 3, 4, 5].map((day) => {
                          const cell = currentGrid.cells.find(
                            (c) => c.day === day && c.period === period
                          );
                          const lesson = cell?.lessons?.[0];
                          return (
                            <td
                              key={day}
                              className="p-1.5 border-r border-gray-100 bg-white text-gray-700 align-top"
                            >
                              {lesson ? (
                                <div className="space-y-0.5">
                                  <div className="font-bold text-[11px] truncate leading-tight">
                                    {lesson.subjectShort || lesson.subjectName}
                                  </div>
                                  <div className="text-[10px] text-gray-500 truncate leading-tight">
                                    {lesson.teachers?.map((t) => t.name).join(", ")}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[10px] text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="text-[11px] text-gray-400 text-center">
              💡 Phase D-2에서 셀 이동·교환 UX 및 연쇄 영향 다이얼로그가 추가됩니다.
            </div>
          </div>

          {/* 우: 미배정 목록 */}
          <div className="xl:col-span-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 sticky top-4">
              <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>📭 미배정 수업</span>
                {meta.unplaced.length > 0 && (
                  <span className="bg-red-100 text-red-800 text-[11px] px-2 py-0.5 rounded-full font-extrabold border border-red-300">
                    {meta.unplaced.length}건
                  </span>
                )}
              </h4>
              {meta.unplaced.length === 0 ? (
                <div className="py-6 text-center text-xs text-emerald-700 font-semibold">
                  ✅ 미배정 수업이 없습니다
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {meta.unplaced.map((u, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-red-100 bg-red-50 text-xs space-y-0.5"
                    >
                      <div className="font-bold text-red-900">{u.label}</div>
                      <div className="text-[10px] text-red-500">{u.remaining}시수 미배정</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 화면 ──
  return (
    <div className="space-y-6">
      {/* 안내 박스 */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 text-indigo-900 text-xs leading-relaxed space-y-1">
        <div className="font-bold text-sm flex items-center gap-1.5">
          <span>🧩</span>
          <span>자동 작성 (Phase 9c-D)</span>
        </div>
        <p>
          솔버가 등록부 제약을 만족하는 기초시간표 초안을 자동으로 작성합니다. 초안을 저장·수정하며
          하드 위반 0건 완성본을 만들 수 있습니다.
        </p>
        <p className="text-[11px] text-indigo-700 font-semibold">
          💡 현행 시간표 복제 초안으로 소규모 수동 수정도 가능합니다.
        </p>
      </div>

      {/* 실행 버튼 */}
      <div className="flex flex-wrap gap-3">
        {!running ? (
          <>
            <button
              onClick={handleSolve}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2"
            >
              <span>🤖 자동 작성 실행</span>
            </button>
            <button
              onClick={handleCopy}
              className="px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs border border-gray-300 shadow-sm transition-all flex items-center gap-2"
            >
              <span>📋 현행 시간표 복제로 시작</span>
            </button>
          </>
        ) : (
          <button
            onClick={handleCancelSolver}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2"
          >
            <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
            <span>취소</span>
          </button>
        )}
      </div>

      {/* 진행률 바 */}
      {running && progress && (
        <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-3">
          <div className="flex justify-between items-center text-xs font-bold text-indigo-900">
            <span>⚙️ {progress.phase}</span>
            {progress.total > 0 && (
              <span>
                {progress.done} / {progress.total}
              </span>
            )}
          </div>
          {progress.total > 0 && (
            <div className="h-2 bg-indigo-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (progress.done / progress.total) * 100).toFixed(1)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {solverError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold">
          ⚠️ {solverError}
        </div>
      )}

      {/* 초안 목록 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <span>📂 저장된 초안 목록</span>
            <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full font-bold">
              {drafts.length}건
            </span>
          </h3>
          <button
            onClick={fetchDrafts}
            disabled={loadingList}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
          >
            🔄 새로고침
          </button>
        </div>

        {listError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-semibold">
            {listError}
          </div>
        )}

        {loadingList ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-xs text-gray-500 font-semibold">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-indigo-600 border-t-transparent mb-3" />
            <p>초안 목록을 불러오는 중...</p>
          </div>
        ) : drafts.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-12 text-center text-xs text-gray-400">
            <p className="font-semibold text-base mb-1">저장된 초안이 없습니다</p>
            <p>위 버튼으로 자동 작성을 실행하거나 현행 시간표를 복제해 시작하세요.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {drafts.map((draft) => {
              const report = draft.lastReport;
              return (
                <div
                  key={draft.id}
                  className="bg-white rounded-xl border border-gray-200 hover:border-indigo-300 p-5 space-y-3 shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">{draft.label}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {draft.origin.kind === "solver"
                          ? `🤖 자동 작성 (시드 ${draft.origin.seed ?? "—"})`
                          : "📋 현행 복제"}
                      </p>
                    </div>
                    {report && (
                      <span
                        className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border font-extrabold ${hardBadgeColor(report.hardCount)}`}
                      >
                        하드 {report.hardCount}
                      </span>
                    )}
                  </div>

                  {report && (
                    <div className="flex gap-2 text-[11px]">
                      <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded font-bold">
                        소프트 {report.softTotal}점
                      </span>
                      {draft.unplaced.length > 0 && (
                        <span className="px-2 py-0.5 bg-red-50 border border-red-200 text-red-800 rounded font-bold">
                          미배정 {draft.unplaced.length}건
                        </span>
                      )}
                    </div>
                  )}

                  <div className="text-[10px] text-gray-400">
                    최종 수정: {fmtTime(draft.updatedAt)}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleOpen(draft)}
                      disabled={loadingDraft}
                      className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-all disabled:opacity-50"
                    >
                      {loadingDraft ? "열기 중..." : "열기 →"}
                    </button>
                    <button
                      onClick={() => handleDelete(draft)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-lg text-xs transition-all border border-red-200"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
