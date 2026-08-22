"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BaseRevisionOp,
  ClassGrid,
  SoftPenaltyCode,
  TimetableBaseRevision,
  TimetableConstraintModel,
  TimetableLesson,
} from "@/lib/timetable/types";
import { useAvailableClasses } from "./useAvailableClasses";
import { applyRevisionOps, cloneClassGrids } from "@/lib/timetable/utils";
import { validateTimetable } from "@/lib/timetable/validate";
import { evaluateMoveCandidates, MoveCandidatesResult } from "@/lib/timetable/moveCandidates";
import { SOFT_CODE_LABELS } from "@/lib/timetable/labels";

interface BaseRevisionTabProps {
  activeTermId?: string | null;
}

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

export default function BaseRevisionTab({ activeTermId }: BaseRevisionTabProps) {
  const [revisions, setRevisions] = useState<TimetableBaseRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getClassesForGrade } = useAvailableClasses(activeTermId, { fallbackOnEmpty: true });

  // 학급 선택 상태
  const [selectedGrade, setSelectedGrade] = useState<number>(1);
  const [selectedClassNum, setSelectedClassNum] = useState<number>(1);

  // draft_model 기반 전체 기초 그리드 + 제약 모델
  const [baseGrids, setBaseGrids] = useState<ClassGrid[] | null>(null);
  const [model, setModel] = useState<TimetableConstraintModel | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);

  const currentClasses = getClassesForGrade(selectedGrade);

  useEffect(() => {
    if (currentClasses.length > 0 && !currentClasses.includes(selectedClassNum)) {
      setSelectedClassNum(currentClasses[0]);
    }
  }, [currentClasses, selectedClassNum]);

  // 개정 편집 연산 (Draft ops) State
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [ops, setOps] = useState<BaseRevisionOp[]>([]);
  const [revisionNote, setRevisionNote] = useState<string>("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // 직접 조정 (집기 → 3색 신호등 → 이동) State
  const [pickedSlot, setPickedSlot] = useState<{
    grade: number;
    classNum: number;
    day: number;
    period: number;
    lesson: TimetableLesson;
  } | null>(null);
  const [candidatesResult, setCandidatesResult] = useState<MoveCandidatesResult | null>(null);
  const [blockedBubble, setBlockedBubble] = useState<{ day: number; period: number; message: string } | null>(null);

  // 셀 통째 편집 모달 (edit_cell op 생성용)
  const [editModalSlot, setEditModalSlot] = useState<{ day: number; period: number } | null>(null);
  const [editSubjectName, setEditSubjectName] = useState("");
  const [editTeacherName, setEditTeacherName] = useState("");

  // 적용 확정 모달 (revision_apply)
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [effectiveFromDate, setEffectiveFromDate] = useState("");
  const [applying, setApplying] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const DAYS = [
    { num: 1, label: "월요일" },
    { num: 2, label: "화요일" },
    { num: 3, label: "수요일" },
    { num: 4, label: "목요일" },
    { num: 5, label: "금요일" },
  ];

  // 다음 주 월요일 YYYY-MM-DD 기본값 계산 헬퍼
  const getNextMondayKST = (): string => {
    const d = new Date();
    const currentDay = d.getDay(); // 0(일)..6(토)
    const daysUntilNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
    const nextMon = new Date(d.getTime() + daysUntilNextMonday * 24 * 60 * 60 * 1000);
    const kst = new Date(nextMon.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().split("T")[0];
  };

  // 1) 개정 이력 목록 로드 (화면 진입 시 1회)
  const fetchRevisions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revision_list", termId: activeTermId }),
      });

      if (res.ok) {
        const data = await res.json();
        const revs: TimetableBaseRevision[] = data.revisions || [];
        setRevisions(revs);

        // 기존 draft가 존재하면 에디터에 로드
        const draft = revs.find((r) => r.status === "draft");
        if (draft) {
          setCurrentDraftId(draft.id || null);
          setOps(draft.ops || []);
          setRevisionNote(draft.note || "");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "기초시간표 개정 목록을 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 2) 전 학급 기초 그리드 + 제약 모델 로드 (화면 진입 시 1회 — draft_model)
  const fetchModelAndBaseGrids = async () => {
    setLoadingModel(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft_model",
          termId: activeTermId || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setBaseGrids(data.baseGrids || []);
        setModel(data.model || null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "기초시간표 및 제약 모델을 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoadingModel(false);
    }
  };

  useEffect(() => {
    fetchRevisions();
    fetchModelAndBaseGrids();
  }, [activeTermId]);

  // 학급 변경 시 집기 상태 초기화
  useEffect(() => {
    setPickedSlot(null);
    setCandidatesResult(null);
    setBlockedBubble(null);
  }, [selectedGrade, selectedClassNum]);

  // Esc 키로 집기 해제
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickedSlot) {
        setPickedSlot(null);
        setCandidatesResult(null);
        setBlockedBubble(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pickedSlot]);

  // 현재 판 계산 (baseGrids + ops)
  const currentGrids = useMemo(() => {
    if (!baseGrids || baseGrids.length === 0) return [];
    const cloned = cloneClassGrids(baseGrids);
    applyRevisionOps(cloned, ops);
    return cloned;
  }, [baseGrids, ops]);

  // 현재 선택된 학급의 그리드
  const currentBaseGrid = useMemo(() => {
    return (
      currentGrids.find((g) => g.grade === selectedGrade && g.classNum === selectedClassNum) || null
    );
  }, [currentGrids, selectedGrade, selectedClassNum]);

  // 전역 검사기 채점 결과 (중대 문제 건수 · 감점 총점)
  const auditReport = useMemo(() => {
    if (!currentGrids.length || !model) return null;
    return validateTimetable(currentGrids, model);
  }, [currentGrids, model]);

  // 하루 교시 수
  const periodsPerDay = model?.periodsPerDay || 7;

  // 감점 증가 사유 포맷팅
  const formatWorseReasons = (worseByCode?: Partial<Record<SoftPenaltyCode, number>>): string => {
    if (!worseByCode) return "";
    const parts: string[] = [];
    for (const [code, delta] of Object.entries(worseByCode)) {
      if (!delta || delta <= 0) continue;
      const label = SOFT_CODE_LABELS[code as SoftPenaltyCode] || code;
      parts.push(`${label} (+${delta}점)`);
    }
    return parts.join(", ");
  };

  // 셀 클릭 핸들러 (집기 → 3색 신호등 → 이동)
  const handleCellClick = (day: number, period: number) => {
    if (!currentBaseGrid || !model) return;
    const cell = currentBaseGrid.cells?.find((c) => c.day === day && c.period === period);
    const lesson = cell?.lessons?.[0];

    // 1) 아직 아무것도 집지 않은 상태
    if (!pickedSlot) {
      if (!lesson) {
        setBlockedBubble({ day, period, message: "빈 칸입니다 — 옮길 수업이 없습니다." });
        return;
      }
      const res = evaluateMoveCandidates({
        grids: currentGrids,
        model,
        pick: { grade: selectedGrade, classNum: selectedClassNum, day, period },
      });
      if (res.pickBlocked) {
        setBlockedBubble({ day, period, message: res.pickBlocked });
        return;
      }
      setPickedSlot({
        grade: selectedGrade,
        classNum: selectedClassNum,
        day,
        period,
        lesson,
      });
      setCandidatesResult(res);
      setBlockedBubble(null);
      return;
    }

    // 2) 이미 집은 상태에서 동일 셀 재클릭 -> 집기 해제
    if (
      pickedSlot.grade === selectedGrade &&
      pickedSlot.classNum === selectedClassNum &&
      pickedSlot.day === day &&
      pickedSlot.period === period
    ) {
      setPickedSlot(null);
      setCandidatesResult(null);
      setBlockedBubble(null);
      return;
    }

    // 3) 후보 셀 클릭
    const cand = candidatesResult?.candidates.find((c) => c.day === day && c.period === period);
    if (!cand || cand.verdict === "blocked") {
      // 차단 칸: 클릭 무반응 (스펙 §2-3)
      return;
    }

    // 이동 (move 또는 swap) op 추가
    const newSwapOp: BaseRevisionOp = {
      type: "swap",
      grade: selectedGrade,
      classNum: selectedClassNum,
      a: { day: pickedSlot.day, period: pickedSlot.period },
      b: { day, period },
    };

    setOps((prev) => [...prev, newSwapOp]);
    setPickedSlot(null);
    setCandidatesResult(null);
    setBlockedBubble(null);
  };

  // 셀 상세 편집 op 추가 (edit_cell)
  const handleSaveEditCell = () => {
    if (!editModalSlot) return;
    const lessons: TimetableLesson[] = editSubjectName.trim()
      ? [
          {
            subjectName: editSubjectName.trim(),
            subjectShort: editSubjectName.trim(),
            teachers: editTeacherName.trim() ? [{ email: "", name: editTeacherName.trim() }] : [],
          },
        ]
      : [];

    const newEditOp: BaseRevisionOp = {
      type: "edit_cell",
      grade: selectedGrade,
      classNum: selectedClassNum,
      day: editModalSlot.day,
      period: editModalSlot.period,
      lessons,
    };

    setOps((prev) => [...prev, newEditOp]);
    setEditModalSlot(null);
    setEditSubjectName("");
    setEditTeacherName("");
  };

  const handleRemoveOp = (index: number) => {
    setOps(ops.filter((_, idx) => idx !== index));
  };

  // Draft 임시저장 및 검증 (warnings 경고 표시)
  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setWarnings([]);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revision_save_draft",
          termId: activeTermId || undefined,
          revisionId: currentDraftId || undefined,
          revisionOps: ops,
          revisionNote,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "개정안 임시저장에 실패했습니다.");
      }

      if (data.revision?.id) {
        setCurrentDraftId(data.revision.id);
      }

      // ⚠️ 경고 메시지 존재 시 수집 및 노출
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setWarnings(data.warnings);
      } else {
        setWarnings([]);
      }

      alert("개정 임시안이 저장되었습니다. (저장된 편집 연산: " + ops.length + "건)");
      fetchRevisions();
    } catch (err: any) {
      alert(`저장 오류: ${err.message}`);
    } finally {
      setSavingDraft(false);
    }
  };

  // 개정 적용 확정 버튼 클릭 (모달 열기)
  const handleOpenApplyModal = () => {
    if (ops.length === 0) {
      alert("적용할 개정 연산(ops)이 없습니다. 먼저 변경사항을 편집해 주세요.");
      return;
    }
    setEffectiveFromDate(getNextMondayKST());
    setShowApplyModal(true);
  };

  // 적용 확정 액션 (revision_apply)
  const handleConfirmApply = async () => {
    if (!effectiveFromDate) {
      alert("적용 시작주(월요일) 날짜를 지정해 주세요.");
      return;
    }
    if (!currentDraftId) {
      alert("먼저 임시저장을 진행한 후 적용 확정을 실행해 주세요.");
      return;
    }

    setApplying(true);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revision_apply",
          revisionId: currentDraftId,
          effectiveFrom: effectiveFromDate,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "개정 적용에 실패했습니다.");
      }

      alert(`✅ 기초시간표 개정이 성공적으로 적용되었습니다.\n적용 시작일: ${effectiveFromDate}`);
      setShowApplyModal(false);
      setCurrentDraftId(null);
      setOps([]);
      setRevisionNote("");
      setWarnings([]);
      fetchRevisions();
      fetchModelAndBaseGrids();
    } catch (err: any) {
      alert(`적용 오류: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  const handleDeleteDraft = async (revId: string) => {
    if (!confirm("임시저장된 개정안을 삭제하시겠습니까?")) return;
    setDeletingId(revId);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revision_delete", revisionId: revId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "삭제 실패");

      alert("개정 임시안이 삭제되었습니다.");
      if (currentDraftId === revId) {
        setCurrentDraftId(null);
        setOps([]);
        setRevisionNote("");
        setWarnings([]);
      }
      fetchRevisions();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 카드 헤더 안내 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>🛠️ 기초시간표 개정 (학기 중 원본 수정)</span>
            </h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              <strong>지정된 다음 주 월요일부터 효력이 발생</strong>합니다. 진행 중인 이번 주 시간표는 건드리지 않습니다.
            </p>
          </div>
        </div>
      </div>

      {/* ⚠️ Warnings Alert Box (revision_save_draft 경고 표시 요구사항) */}
      {warnings.length > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-950 animate-fade-in shadow-xs">
          <div className="flex items-center gap-2 font-bold text-amber-900 text-sm">
            <span>⚠️ 개정 연산 적용 검증 경고 ({warnings.length}건)</span>
          </div>
          <p className="text-amber-800">
            임시저장된 개정 연산을 기존 기초시간표에 적용 시 아래 경고/오류가 감지되었습니다. 연산 항목을 확인해 주세요.
          </p>
          <ul className="list-disc list-inside space-y-1 pl-1 font-mono text-[11px] text-amber-900 bg-amber-100/60 p-2.5 rounded-lg border border-amber-200">
            {warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 학급 선택 & 기초시간표 그리드 편집기 (lg:col-span-8) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6 space-y-4">
            {/* 학급 선택 바 */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-700">학년:</span>
                {[1, 2, 3].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setSelectedGrade(g);
                      const classes = getClassesForGrade(g);
                      if (classes.length > 0 && !classes.includes(selectedClassNum)) {
                        setSelectedClassNum(classes[0]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      selectedGrade === g
                        ? "bg-amber-600 text-white shadow-xs"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {g}학년
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs font-bold text-gray-700 mr-1">반 선택:</span>
                {currentClasses.length === 0 ? (
                  <span className="text-xs text-gray-400 py-1">등록된 반이 없습니다.</span>
                ) : (
                  currentClasses.map((cNum) => (
                    <button
                      key={cNum}
                      type="button"
                      onClick={() => {
                        setSelectedClassNum(cNum);
                      }}
                      className={`w-7 h-7 rounded text-xs font-bold transition-all cursor-pointer ${
                        selectedClassNum === cNum
                          ? "bg-gray-800 text-white shadow-xs"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {cNum}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* 상단 검사기 검증 바 (BB-1) */}
            {auditReport && (
              <div className="flex items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-700">전체 시간표 검증:</span>
                  {auditReport.hard.length === 0 ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-1">
                      <span>✅</span>
                      <span>중대 문제 0건</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold border border-red-200 flex items-center gap-1">
                      <span>⚠️</span>
                      <span>중대 문제 {auditReport.hard.length}건</span>
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-gray-200/80 text-gray-800 font-bold">
                    감점 {auditReport.soft.total}점
                  </span>
                </div>

                <div className="text-[11px] text-gray-500">
                  {pickedSlot ? (
                    <span className="text-amber-900 font-bold flex items-center gap-1 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-300">
                      <span>📌</span>
                      <span>
                        {DAY_LABEL[pickedSlot.day]} {pickedSlot.period}교시 ({pickedSlot.lesson.subjectName}) 집음 — 목적지 클릭 (취소: 재클릭 또는 Esc)
                      </span>
                    </span>
                  ) : (
                    <span>수업을 클릭하면 이동 가능한 위치(3색 신호등)가 표시됩니다.</span>
                  )}
                </div>
              </div>
            )}

            {/* 5일 x N교시 그리드 */}
            {loadingModel ? (
              <div className="py-12 text-center text-xs text-gray-500 font-semibold">
                기초시간표 및 제약 모델을 불러오는 중입니다...
              </div>
            ) : !currentBaseGrid ? (
              <div className="py-12 text-center text-xs text-gray-400">
                시간표 데이터를 불러올 수 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full border-collapse text-xs text-center table-fixed">
                  <thead>
                    <tr className="bg-gray-800 text-white font-bold">
                      <th className="py-2.5 px-2 border-r border-gray-700 w-14">교시</th>
                      {DAYS.map((d) => (
                        <th key={d.num} className="py-2.5 px-2 border-r border-gray-700">
                          {d.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {Array.from({ length: periodsPerDay }).map((_, pIdx) => {
                      const period = pIdx + 1;
                      return (
                        <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                          <td className="py-2 px-1.5 border-r border-gray-200 font-bold text-gray-500 bg-gray-50 text-[11px]">
                            {period}교시
                          </td>
                          {DAYS.map((d) => {
                            const cell = currentBaseGrid.cells?.find(
                              (c) => c.day === d.num && c.period === period
                            );
                            const lesson = cell?.lessons?.[0];

                            const isPicked =
                              pickedSlot?.grade === selectedGrade &&
                              pickedSlot?.classNum === selectedClassNum &&
                              pickedSlot?.day === d.num &&
                              pickedSlot?.period === period;

                            const cand = candidatesResult?.candidates.find(
                              (c) => c.day === d.num && c.period === period
                            );

                            const hasOp = ops.some((op) => {
                              if (op.type === "swap_pair") {
                                return (
                                  op.classes.some(
                                    (c) => c.grade === selectedGrade && c.classNum === selectedClassNum
                                  ) &&
                                  ((op.a.day === d.num && op.a.period === period) ||
                                    (op.b.day === d.num && op.b.period === period))
                                );
                              }
                              if (op.type === "chain" || op.type === "park" || op.type === "unpark")
                                return false;
                              if (op.grade !== selectedGrade || op.classNum !== selectedClassNum)
                                return false;
                              return op.type === "swap"
                                ? (op.a.day === d.num && op.a.period === period) ||
                                    (op.b.day === d.num && op.b.period === period)
                                : op.day === d.num && op.period === period;
                            });

                            const isBubbleThis =
                              blockedBubble?.day === d.num && blockedBubble?.period === period;

                            // 1) 집은 셀
                            if (isPicked) {
                              return (
                                <td
                                  key={d.num}
                                  onClick={() => handleCellClick(d.num, period)}
                                  title="집은 수업 (클릭 또는 Esc로 해제)"
                                  className="h-16 min-h-[4rem] max-h-[4rem] p-1.5 border-r border-gray-200 bg-amber-100 text-amber-950 align-top cursor-pointer select-none relative ring-2 ring-amber-500 font-bold overflow-hidden shadow-xs"
                                >
                                  <div className="h-full flex flex-col justify-between">
                                    <div className="flex items-start justify-between gap-0.5">
                                      <span className="font-bold text-[11px] truncate leading-tight">
                                        {lesson?.subjectShort || lesson?.subjectName || "-"}
                                      </span>
                                      <span className="shrink-0 text-[10px] leading-none" title="집은 수업">
                                        📌
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-amber-800 truncate leading-tight text-left">
                                      {lesson?.teachers?.map((t) => t.name).join(", ") || "—"}
                                    </div>
                                  </div>
                                </td>
                              );
                            }

                            // 2) 집기 상태에서의 후보 셀들
                            if (cand) {
                              if (cand.verdict === "ok") {
                                return (
                                  <td
                                    key={d.num}
                                    onClick={() => handleCellClick(d.num, period)}
                                    title={
                                      cand.kind === "swap"
                                        ? `${lesson?.subjectShort || "수업"}과 맞교환 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                        : `빈 칸으로 이동 (${cand.softDelta < 0 ? `${cand.softDelta}점 개선` : "점수 유지"})`
                                    }
                                    className="h-16 min-h-[4rem] max-h-[4rem] p-1.5 border-r border-gray-200 bg-emerald-50/90 hover:bg-emerald-100 border-emerald-300 text-gray-800 align-top cursor-pointer select-none transition-colors relative overflow-hidden"
                                  >
                                    <div className="h-full flex flex-col justify-between">
                                      <div className="flex items-start justify-between gap-0.5">
                                        <span className="font-bold text-[11px] truncate leading-tight text-emerald-950">
                                          {lesson ? (lesson.subjectShort || lesson.subjectName) : "—"}
                                        </span>
                                        <span
                                          className={`shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none ${
                                            cand.softDelta < 0
                                              ? "bg-emerald-600 text-white shadow-2xs"
                                              : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                          }`}
                                        >
                                          {cand.softDelta < 0 ? cand.softDelta : "0"}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                                        {lesson?.teachers?.map((t) => t.name).join(", ") || "—"}
                                      </div>
                                    </div>
                                  </td>
                                );
                              }

                              if (cand.verdict === "worse") {
                                const worseReason = formatWorseReasons(cand.worseByCode);
                                return (
                                  <td
                                    key={d.num}
                                    onClick={() => handleCellClick(d.num, period)}
                                    title={
                                      worseReason
                                        ? `감점 (+${cand.softDelta}점): ${worseReason}`
                                        : `감점 +${cand.softDelta}점`
                                    }
                                    className="h-16 min-h-[4rem] max-h-[4rem] p-1.5 border-r border-gray-200 bg-amber-50/90 hover:bg-amber-100 border-amber-300 text-gray-800 align-top cursor-pointer select-none transition-colors relative overflow-hidden"
                                  >
                                    <div className="h-full flex flex-col justify-between">
                                      <div className="flex items-start justify-between gap-0.5">
                                        <span className="font-bold text-[11px] truncate leading-tight text-amber-950">
                                          {lesson ? (lesson.subjectShort || lesson.subjectName) : "—"}
                                        </span>
                                        <span className="shrink-0 px-1 py-0.2 rounded font-mono text-[9px] font-extrabold leading-none bg-amber-500 text-white shadow-2xs">
                                          +{cand.softDelta}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                                        {lesson?.teachers?.map((t) => t.name).join(", ") || "—"}
                                      </div>
                                    </div>
                                  </td>
                                );
                              }

                              // blocked
                              return (
                                <td
                                  key={d.num}
                                  title={cand.blockedReason ? `이동 불가: ${cand.blockedReason}` : "이동 불가"}
                                  className="h-16 min-h-[4rem] max-h-[4rem] p-1.5 border-r border-gray-200 bg-gray-100/90 text-gray-400 align-top cursor-not-allowed select-none relative opacity-70 overflow-hidden"
                                >
                                  <div className="h-full flex flex-col justify-between">
                                    <div className="flex items-start justify-between gap-0.5">
                                      <span className="font-bold text-[11px] truncate leading-tight text-gray-400">
                                        {lesson ? (lesson.subjectShort || lesson.subjectName) : "—"}
                                      </span>
                                      <span className="shrink-0 text-[10px] text-gray-400 leading-none">🔒</span>
                                    </div>
                                    <div className="text-[10px] text-gray-400 truncate leading-tight text-left">
                                      {lesson?.teachers?.map((t) => t.name).join(", ") || "—"}
                                    </div>
                                  </div>
                                </td>
                              );
                            }

                            // 3) 대기 상태 (일반 모드)
                            return (
                              <td
                                key={d.num}
                                onClick={() => handleCellClick(d.num, period)}
                                title={
                                  lesson
                                    ? `${lesson.subjectName} (${lesson.teachers?.map((t) => t.name).join(", ") || ""})`
                                    : undefined
                                }
                                className={`h-16 min-h-[4rem] max-h-[4rem] p-1.5 border-r border-gray-200 align-top transition-colors cursor-pointer select-none text-gray-800 relative overflow-hidden group ${
                                  hasOp
                                    ? "bg-amber-50/70 border-amber-300 font-semibold"
                                    : "bg-white hover:bg-indigo-50/50"
                                }`}
                              >
                                {isBubbleThis && (
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-30 bg-gray-900 text-white text-[11px] font-semibold px-2 py-1 rounded shadow-lg whitespace-nowrap pointer-events-none flex items-center gap-1">
                                    <span>⚠️</span>
                                    <span>{blockedBubble.message}</span>
                                  </div>
                                )}
                                {lesson ? (
                                  <div className="h-full flex flex-col justify-between">
                                    <div className="flex items-start justify-between gap-0.5">
                                      <span className="font-bold text-[11px] truncate leading-tight text-gray-900">
                                        {lesson.subjectShort || lesson.subjectName}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditModalSlot({ day: d.num, period });
                                          setEditSubjectName(lesson?.subjectName || "");
                                          setEditTeacherName(lesson?.teachers?.[0]?.name || "");
                                        }}
                                        title="셀 내용 직접 수정"
                                        className="opacity-0 group-hover:opacity-100 text-[10px] text-amber-800 hover:text-amber-950 font-bold px-1 rounded bg-amber-100/80 transition-opacity cursor-pointer"
                                      >
                                        ✏️
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-gray-500 truncate leading-tight text-left">
                                      {lesson.teachers?.map((t) => t.name).join(", ") || "—"}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="h-full flex flex-col justify-between">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-gray-300">—</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditModalSlot({ day: d.num, period });
                                          setEditSubjectName("");
                                          setEditTeacherName("");
                                        }}
                                        title="셀 내용 직접 수정"
                                        className="opacity-0 group-hover:opacity-100 text-[10px] text-amber-800 hover:text-amber-950 font-bold px-1 rounded bg-amber-100/80 transition-opacity cursor-pointer"
                                      >
                                        ✏️
                                      </button>
                                    </div>
                                    <div className="text-[10px] text-transparent select-none">—</div>
                                  </div>
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
        </div>

        {/* 우측: 변경 연산(Ops) 편집 패널 & 개정 이력 (lg:col-span-4) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Ops 편집 및 저장/적용 패널 */}
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>📝 편집 연산 목록 ({ops.length}건)</span>
              </h4>
              {ops.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOps([]);
                    setPickedSlot(null);
                    setCandidatesResult(null);
                    setBlockedBubble(null);
                  }}
                  className="text-xs text-red-600 hover:underline font-semibold cursor-pointer"
                >
                  전체 초기화
                </button>
              )}
            </div>

            {/* 연산 리스트 */}
            {ops.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400 space-y-1">
                <p className="font-semibold">추가된 개정 연산이 없습니다.</p>
                <p className="text-[11px]">좌측 시간표에서 수업을 클릭해 이동하거나 수정하세요.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {ops.map((op, idx) => {
                  if (op.type === "chain" || op.type === "park" || op.type === "unpark") return null;
                  return (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 text-xs flex items-center justify-between gap-2"
                    >
                      <div>
                        {op.type === "swap_pair" ? (
                          <>
                            <span className="font-bold text-amber-900">
                              {op.classes.map((c) => `${c.grade}학년 ${c.classNum}반`).join("·")}:
                            </span>{" "}
                            <span>
                              {DAY_LABEL[op.a.day]} {op.a.period}교시 ↔ {DAY_LABEL[op.b.day]} {op.b.period}교시 함께 맞바꿈 (학급 간 교환)
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-bold text-amber-900">
                              {op.grade}학년 {op.classNum}반:
                            </span>{" "}
                            {op.type === "swap" ? (
                              <span>
                                {DAY_LABEL[op.a.day]} {op.a.period}교시 ↔ {DAY_LABEL[op.b.day]} {op.b.period}교시 맞바꿈
                              </span>
                            ) : (
                              <span>
                                {DAY_LABEL[op.day]} {op.period}교시 내용 변경 (
                                {op.lessons?.[0]?.subjectName || "공강"})
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveOp(idx)}
                        className="text-amber-700 hover:text-red-700 font-bold text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 메모 입력 */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                개정 메모 / 사유
              </label>
              <input
                type="text"
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="예: 2학기 2주차 교과 시수 조정"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>

            {/* 버튼들 */}
            <div className="space-y-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={savingDraft}
                className="w-full py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-lg text-xs disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                {savingDraft ? "저장 중..." : "💾 개정안 임시저장 및 검증"}
              </button>

              <button
                type="button"
                onClick={handleOpenApplyModal}
                disabled={ops.length === 0}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs disabled:opacity-50 transition-colors shadow-xs cursor-pointer"
              >
                ✨ 적용 확정 (다음 주 월요일부터 적용)
              </button>
            </div>
          </div>

          {/* 개정 이력 목록 */}
          <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-6 space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <h4 className="text-xs font-bold text-gray-800">📜 개정 이력 목록 ({revisions.length}건)</h4>
              <button
                onClick={fetchRevisions}
                disabled={loading}
                className="text-[11px] text-amber-700 hover:underline font-bold"
              >
                새로고침
              </button>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-gray-400">이력 로딩 중...</div>
            ) : revisions.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">개정 이력이 없습니다.</div>
            ) : (
              <div className="space-y-2">
                {revisions.map((rev) => (
                  <div
                    key={rev.id || rev.createdAt}
                    className={`p-3 rounded-lg border text-xs space-y-1 ${
                      rev.status === "applied"
                        ? "bg-emerald-50/60 border-emerald-200 text-emerald-950"
                        : "bg-amber-50/60 border-amber-200 text-amber-950"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                          rev.status === "applied"
                            ? "bg-emerald-200 text-emerald-900"
                            : "bg-amber-200 text-amber-900"
                        }`}
                      >
                        {rev.status === "applied" ? "적용완료" : "임시저장(Draft)"}
                      </span>

                      {rev.status === "draft" && rev.id && (
                        <button
                          onClick={() => handleDeleteDraft(rev.id!)}
                          disabled={deletingId === rev.id}
                          className="text-[11px] text-red-600 hover:underline font-bold"
                        >
                          삭제
                        </button>
                      )}
                    </div>

                    <div className="font-bold">
                      {rev.status === "applied"
                        ? `적용 시작주: ${rev.effectiveFrom || "미지정"}`
                        : `편집 연산: ${rev.ops?.length || 0}건`}
                    </div>

                    {rev.note && <div className="text-gray-600 text-[11px]">{rev.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 셀 통째 편집 모달 (edit_cell) */}
      {editModalSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl border border-gray-200">
            <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-2">
              <span>✏️ 셀 내용 직접 편집</span>
              <span className="text-xs text-gray-500 font-normal">
                ({DAY_LABEL[editModalSlot.day]}요일 {editModalSlot.period}교시)
              </span>
            </h4>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">과목명</label>
                <input
                  type="text"
                  value={editSubjectName}
                  onChange={(e) => setEditSubjectName(e.target.value)}
                  placeholder="예: 수학"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">담당 교사 성명</label>
                <input
                  type="text"
                  value={editTeacherName}
                  onChange={(e) => setEditTeacherName(e.target.value)}
                  placeholder="예: 홍길동"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditModalSlot(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-100"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveEditCell}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700"
              >
                연산 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 개정 적용 확정 모달 (revision_apply — 적용 시작일 명시 요구사항) */}
      {showApplyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl border border-gray-200 animate-scale-up">
            <div className="bg-amber-500 text-white p-4 rounded-xl -mx-6 -mt-6 mb-2 flex items-center gap-2">
              <span className="text-2xl">✨</span>
              <div>
                <h4 className="font-extrabold text-base">기초시간표 개정 적용 확정</h4>
                <p className="text-xs text-amber-100">적용 시작 주 월요일을 확인해 주세요</p>
              </div>
            </div>

            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 space-y-2 leading-relaxed">
              <p className="font-bold">⚠️ 이번 주 운영 꼬임 방지 안전 원칙</p>
              <p>
                이번 주 이미 실행된 시간표 교체와의 충돌을 막기 위해, 지정된 <strong>적용 시작주(월요일)부터</strong> 새로운 기초시간표가 적용됩니다.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-800 mb-1">
                📅 적용 시작주 월요일 선택 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={effectiveFromDate}
                onChange={(e) => setEffectiveFromDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                required
              />
              <p className="text-[11px] text-gray-500 mt-1">
                기본값: 차주 월요일 ({getNextMondayKST()})
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                disabled={applying}
                className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-sm disabled:opacity-50 transition-colors"
              >
                {applying ? "적용 중..." : "🚀 확정 및 개정 적용"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
