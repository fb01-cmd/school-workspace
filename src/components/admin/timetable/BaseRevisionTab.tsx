"use client";

import { useEffect, useState } from "react";
import {
  BaseRevisionOp,
  ClassGrid,
  TimetableBaseRevision,
  TimetableLesson,
} from "@/lib/timetable/types";
import { useAvailableClasses } from "./useAvailableClasses";

interface BaseRevisionTabProps {
  activeTermId?: string | null;
}

const DAY_LABEL: Record<number, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

export default function BaseRevisionTab({ activeTermId }: BaseRevisionTabProps) {
  const [revisions, setRevisions] = useState<TimetableBaseRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getClassesForGrade } = useAvailableClasses(activeTermId, { fallbackOnEmpty: true });

  // 학급 및 기초시간표 그리드 상태
  const [selectedGrade, setSelectedGrade] = useState<number>(1);
  const [selectedClassNum, setSelectedClassNum] = useState<number>(1);
  const [baseGrid, setBaseGrid] = useState<ClassGrid | null>(null);
  const [loadingGrid, setLoadingGrid] = useState(false);

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

  // 셀 선택 (맞교환 op 생성용)
  const [selectedSlotA, setSelectedSlotA] = useState<{ day: number; period: number } | null>(null);

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

  const fetchBaseClassGrid = async (g: number, c: number) => {
    setLoadingGrid(true);
    try {
      const res = await fetch("/api/timetable/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "class",
          grade: g,
          classNum: c,
          termId: activeTermId || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data && !Array.isArray(data.data)) {
          setBaseGrid(data.data as ClassGrid);
        } else if (Array.isArray(data.data) && data.data.length > 0) {
          setBaseGrid(data.data[0] as ClassGrid);
        } else {
          setBaseGrid(null);
        }
      }
    } catch {
      setBaseGrid(null);
    } finally {
      setLoadingGrid(false);
    }
  };

  useEffect(() => {
    fetchRevisions();
  }, [activeTermId]);

  useEffect(() => {
    fetchBaseClassGrid(selectedGrade, selectedClassNum);
  }, [selectedGrade, selectedClassNum, activeTermId]);

  // 셀 클릭 핸들러 (맞교환 op 생성)
  const handleCellClick = (day: number, period: number) => {
    if (!selectedSlotA) {
      setSelectedSlotA({ day, period });
    } else {
      if (selectedSlotA.day === day && selectedSlotA.period === period) {
        setSelectedSlotA(null); // 동일 셀 클릭 시 해제
        return;
      }

      // 맞교환 (swap) 연산 생성
      const newSwapOp: BaseRevisionOp = {
        type: "swap",
        grade: selectedGrade,
        classNum: selectedClassNum,
        a: { day: selectedSlotA.day, period: selectedSlotA.period },
        b: { day, period },
      };

      setOps([...ops, newSwapOp]);
      setSelectedSlotA(null);
    }
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

    setOps([...ops, newEditOp]);
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
      fetchBaseClassGrid(selectedGrade, selectedClassNum);
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
              개학 첫 주 학기 시간표 수정분을 편집하고 <strong>지정된 다음 주 월요일부터 효력이 발생</strong>하도록 적용합니다.<br />
              현재 진행 중인 이번 주 시간표 교체와 꼬이지 않도록 독립 개정판으로 운영됩니다.
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
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
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
                      setSelectedSlotA(null);
                      const classes = getClassesForGrade(g);
                      if (classes.length > 0 && !classes.includes(selectedClassNum)) {
                        setSelectedClassNum(classes[0]);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
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
                        setSelectedSlotA(null);
                      }}
                      className={`w-7 h-7 rounded text-xs font-bold transition-all ${
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

            {/* 안내 텍스트 */}
            <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-lg text-xs text-amber-900 flex justify-between items-center">
              <div>
                🏫 <strong>{selectedGrade}학년 {selectedClassNum}반 기초시간표 편집</strong>
                <span className="text-gray-500 ml-2">
                  (첫 번째 셀 클릭 후 두 번째 셀을 클릭하면 교시 맞교환 연산이 추가됩니다)
                </span>
              </div>
              {selectedSlotA && (
                <span className="text-[11px] font-bold bg-amber-200 text-amber-950 px-2 py-0.5 rounded animate-pulse">
                  📌 {DAY_LABEL[selectedSlotA.day]}요일 {selectedSlotA.period}교시 선택됨 (교체할 상대 셀 클릭)
                </span>
              )}
            </div>

            {/* 5일 x 7교시 그리드 */}
            {loadingGrid ? (
              <div className="py-12 text-center text-xs text-gray-500 font-semibold">
                기초시간표를 불러오는 중입니다...
              </div>
            ) : !baseGrid ? (
              <div className="py-12 text-center text-xs text-gray-400">
                시간표 데이터를 불러올 수 없습니다.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full border-collapse text-xs text-center">
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
                    {Array.from({ length: 7 }).map((_, pIdx) => {
                      const period = pIdx + 1;
                      return (
                        <tr key={period} className={period % 2 === 0 ? "bg-gray-50/40" : "bg-white"}>
                          <td className="py-3 px-2 border-r border-gray-200 font-bold text-gray-500 bg-gray-50">
                            {period}교시
                          </td>
                          {DAYS.map((d) => {
                            const cell = baseGrid.cells?.find(
                              (c) => c.day === d.num && c.period === period
                            );
                            const lesson = cell?.lessons?.[0];
                            const isSelectedA =
                              selectedSlotA?.day === d.num && selectedSlotA?.period === period;

                            // 이 셀과 관련된 현재 ops가 존재하는지 체크
                            const hasOp = ops.some(
                              (op) =>
                                op.grade === selectedGrade &&
                                op.classNum === selectedClassNum &&
                                (op.type === "swap"
                                  ? (op.a.day === d.num && op.a.period === period) ||
                                    (op.b.day === d.num && op.b.period === period)
                                  : op.day === d.num && op.period === period)
                            );

                            return (
                              <td
                                key={d.num}
                                className={`p-1.5 border-r border-gray-200 transition-all ${
                                  isSelectedA
                                    ? "bg-amber-500 text-white font-bold ring-2 ring-amber-300 shadow-md"
                                    : hasOp
                                    ? "bg-amber-100/80 border-amber-300 font-bold"
                                    : "hover:bg-amber-50/50"
                                }`}
                              >
                                <div className="group relative flex flex-col justify-between h-full min-h-[3.2rem]">
                                  <button
                                    type="button"
                                    onClick={() => handleCellClick(d.num, period)}
                                    className="w-full text-left p-1"
                                  >
                                    <div className={`font-bold text-xs truncate ${isSelectedA ? "text-white" : "text-gray-900"}`}>
                                      {lesson ? lesson.subjectName : "-"}
                                    </div>
                                    <div className={`text-[10px] truncate ${isSelectedA ? "text-amber-100" : "text-gray-500"}`}>
                                      {lesson?.teachers?.map((t) => t.name).join(", ") || "교사 미지정"}
                                    </div>
                                  </button>

                                  {/* 셀 직접 편집 모달 호출 버튼 */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditModalSlot({ day: d.num, period });
                                      setEditSubjectName(lesson?.subjectName || "");
                                      setEditTeacherName(lesson?.teachers?.[0]?.name || "");
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-xs text-amber-800 hover:underline text-right w-full pt-0.5"
                                  >
                                    ✏️ 내용 변경
                                  </button>
                                </div>
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <span>📝 편집 연산 목록 ({ops.length}건)</span>
              </h4>
              {ops.length > 0 && (
                <button
                  onClick={() => setOps([])}
                  className="text-xs text-red-600 hover:underline font-semibold"
                >
                  전체 초기화
                </button>
              )}
            </div>

            {/* 연산 리스트 */}
            {ops.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400 space-y-1">
                <p className="font-semibold">추가된 개정 연산이 없습니다.</p>
                <p className="text-[11px]">좌측 시간표에서 교시를 클릭해 맞교환 또는 편집하세요.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {ops.map((op, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg border border-amber-200 bg-amber-50/50 text-xs flex items-center justify-between gap-2"
                  >
                    <div>
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
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveOp(idx)}
                      className="text-amber-700 hover:text-red-700 font-bold text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}
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
                className="w-full py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-lg text-xs disabled:opacity-50 transition-colors shadow-xs"
              >
                {savingDraft ? "저장 중..." : "💾 개정안 임시저장 및 검증"}
              </button>

              <button
                type="button"
                onClick={handleOpenApplyModal}
                disabled={ops.length === 0}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs disabled:opacity-50 transition-colors shadow-xs"
              >
                ✨ 적용 확정 (다음 주 월요일부터 적용)
              </button>
            </div>
          </div>

          {/* 개정 이력 목록 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
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
