"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { CoTeachingRule, ClassGrid } from "@/lib/timetable/types";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { useAvailableClasses } from "./useAvailableClasses";

interface CoTeachingRuleTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
}

// 클라이언트 전용 순수 판정 헬퍼 (서버 normSubject 규약 동일)
const normSubj = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();
const normEmail = (e: string) => (e || "").trim().toLowerCase();

/** 복수교사 판정: 과목명 일치 + 지정 교사 중 1명 이상 포함 여부 */
function isCoTeachingCell(
  lessonSubjectName: string,
  lessonTeacherEmails: string[],
  formSubjectName: string,
  formTeacherEmails: string[]
): boolean {
  if (!formSubjectName.trim()) return false;
  if (normSubj(lessonSubjectName) !== normSubj(formSubjectName)) return false;
  if (formTeacherEmails.length === 0) return true; // 교사 미지정이면 과목명만 매칭
  const lessonSet = new Set(lessonTeacherEmails.map(normEmail));
  return formTeacherEmails.some((e) => lessonSet.has(normEmail(e)));
}

export default function CoTeachingRuleTab({ activeTermId, periodsPerDay = 7 }: CoTeachingRuleTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  const { getClassesForGrade } = useAvailableClasses(activeTermId, { fallbackOnEmpty: true });

  const [rules, setRules] = useState<CoTeachingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Form states
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [grade, setGrade] = useState<number>(1);
  const [classNums, setClassNums] = useState<number[]>([1]);
  const [subjectName, setSubjectName] = useState("");
  const [teacherEmailInput, setTeacherEmailInput] = useState("");
  const [teacherEmails, setTeacherEmails] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  // Preview state (기초/주간 시간표 미리보기용)
  const [previewGrid, setPreviewGrid] = useState<ClassGrid | null>(null);
  const [previewClassNum, setPreviewClassNum] = useState<number>(1);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const DAYS = [
    { num: 1, label: "월" },
    { num: 2, label: "화" },
    { num: 3, label: "수" },
    { num: 4, label: "목" },
    { num: 5, label: "금" },
  ];

  const maxPeriod = Math.max(7, periodsPerDay || 7);

  const fetchRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "co_teaching_rule_list", termId: activeTermId || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || data.data || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "복수교사 규칙 목록을 불러올 수 없습니다.");
      }
    } catch (err: any) {
      setError(`네트워크 오류: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, [activeTermId]);

  // 미리보기 클래스 그리드 로드
  const fetchPreviewClassGrid = async (g: number, c: number) => {
    setLoadingPreview(true);
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
          setPreviewGrid(data.data as ClassGrid);
        } else if (Array.isArray(data.data) && data.data.length > 0) {
          setPreviewGrid(data.data[0] as ClassGrid);
        } else {
          setPreviewGrid(null);
        }
      }
    } catch {
      setPreviewGrid(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    const targetClass = classNums.length > 0 ? classNums[0] : 1;
    setPreviewClassNum(targetClass);
    if (subjectName.trim() || editingRuleId !== null) {
      fetchPreviewClassGrid(grade, targetClass);
    }
  }, [grade, classNums[0], activeTermId, subjectName, editingRuleId]);

  const resetForm = () => {
    setEditingRuleId(null);
    setGrade(1);
    setClassNums([1]);
    setSubjectName("");
    setTeacherEmailInput("");
    setTeacherEmails([]);
    setActive(true);
  };

  const handleAddTeacherEmail = (emailToAdd?: string) => {
    const target = (emailToAdd || teacherEmailInput).trim().toLowerCase();
    if (!target || !target.includes("@")) return;
    if (!teacherEmails.includes(target)) {
      setTeacherEmails([...teacherEmails, target]);
    }
    setTeacherEmailInput("");
  };

  const handleRemoveTeacherEmail = (email: string) => {
    setTeacherEmails(teacherEmails.filter((e) => e !== email));
  };

  const handleToggleClassNum = (num: number) => {
    if (classNums.includes(num)) {
      if (classNums.length === 1) return;
      setClassNums(classNums.filter((c) => c !== num));
    } else {
      setClassNums([...classNums, num].sort((a, b) => a - b));
    }
  };

  const handleSelectAllClasses = () => {
    const available = getClassesForGrade(grade);
    setClassNums(available.length > 0 ? [...available] : [1]);
  };

  const handleEditClick = (rule: CoTeachingRule) => {
    setEditingRuleId(rule.id || null);
    setGrade(rule.grade);
    setClassNums(rule.classNums || []);
    setSubjectName(rule.subjectName || "");
    setTeacherEmails(rule.teacherEmails || []);
    setTeacherEmailInput("");
    setActive(rule.active !== false);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim()) {
      alert("대상 과목명을 입력해 주세요.");
      return;
    }
    if (classNums.length === 0) {
      alert("대상 반을 1개 이상 선택해 주세요.");
      return;
    }

    // 저장 시 onSelect로 추가된 teacherEmails만 사용 — teacherEmailInput 원시 푸시 금지 (R1)
    const finalEmails = [...teacherEmails];

    if (finalEmails.length < 2) {
      alert("복수 교사는 2명 이상의 교사 이메일을 등록해야 합니다.");
      return;
    }

    setSaving(true);
    try {
      const payload: CoTeachingRule = {
        id: editingRuleId || undefined,
        termId: activeTermId || "",
        grade,
        classNums,
        subjectName: subjectName.trim(),
        teacherEmails: finalEmails,
        active,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "co_teaching_rule_save",
          rule: payload,
          ...(editingRuleId ? { ruleId: editingRuleId } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "저장에 실패했습니다.");
      }

      alert("복수교사 규칙이 성공적으로 저장되었습니다.");
      resetForm();
      fetchRules();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string, labelText: string) => {
    if (!confirm(`'${labelText}' 복수교사 규칙을 삭제하시겠습니까?`)) return;
    setDeletingId(ruleId);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "co_teaching_rule_delete", ruleId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "삭제에 실패했습니다.");

      alert("규칙이 삭제되었습니다.");
      if (editingRuleId === ruleId) resetForm();
      fetchRules();
    } catch (err: any) {
      alert(`삭제 오류: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const filteredRules = rules.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.subjectName.toLowerCase().includes(q) ||
      r.teacherEmails.some((e) => e.toLowerCase().includes(q)) ||
      `${r.grade}학년`.includes(q)
    );
  });

  // 미리보기 판정: 과목명 일치 + 교사 1명 이상 포함 — 현재 폼 기준
  const showPreview = subjectName.trim() !== "" || editingRuleId !== null;

  // 미리보기에 걸리는 셀 수
  const hitCount = previewGrid
    ? (previewGrid.cells || []).reduce((acc, cell) => {
        return (
          acc +
          (cell.lessons || []).filter((lesson) =>
            isCoTeachingCell(
              lesson.subjectName,
              (lesson.teachers || []).map((t) => t.email || ""),
              subjectName,
              teacherEmails
            )
          ).length
        );
      }, 0)
    : 0;

  return (
    <div className="space-y-6 font-sans">
      {/* 안내 박스 - 눈높이 문구로 정리 */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-purple-900 text-xs leading-relaxed space-y-1">
        <div className="font-bold text-sm flex items-center gap-1.5 text-purple-900">
          <span>👥</span>
          <span>복수교사 등록부</span>
        </div>
        <p>
          동일 학급의 동일 요일·교시 시간에 2명 이상의 교사가 함께 수업에 투입되는 형태를 지정합니다. (투입 교사 간 동일 교시수 배치 검사)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 등록/수정 폼 + 미리보기 (SimulGroupTab §A-5 문법) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>{editingRuleId ? "✏️ 복수교사 규칙 수정" : "➕ 복수교사 규칙 등록"}</span>
              </h3>
              {editingRuleId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-gray-500 hover:text-gray-700 underline font-semibold"
                >
                  취소하고 신규 등록
                </button>
              )}
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4 text-xs">
              {/* 학년 선택 */}
              <div>
                <label className="block font-bold text-gray-700 mb-1.5">
                  대상 학년 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        setGrade(g);
                        const nextClasses = getClassesForGrade(g);
                        setClassNums((prev) => {
                          const valid = prev.filter((c) => nextClasses.includes(c));
                          return valid.length > 0 ? valid : (nextClasses.length > 0 ? [nextClasses[0]] : []);
                        });
                      }}
                      className={`py-2 px-3 rounded-lg font-bold border text-center transition-all ${
                        grade === g
                          ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {g}학년
                    </button>
                  ))}
                </div>
              </div>

              {/* 반 선택 (multi select toggle buttons) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-gray-700">
                    대상 반 선택 <span className="text-red-500">*</span>
                  </label>
                  {getClassesForGrade(grade).length > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectAllClasses}
                      className="text-[11px] font-semibold text-purple-700 hover:underline"
                    >
                      {`${getClassesForGrade(grade)[0]}~${getClassesForGrade(grade)[getClassesForGrade(grade).length - 1]}반 전체 선택`}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {getClassesForGrade(grade).length === 0 ? (
                    <span className="text-xs text-gray-400 p-1">등록된 반이 없습니다.</span>
                  ) : (
                    getClassesForGrade(grade).map((num) => {
                      const isSelected = classNums.includes(num);
                      return (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleToggleClassNum(num)}
                          className={`w-9 h-9 rounded-lg font-bold text-xs transition-all flex items-center justify-center border ${
                            isSelected
                              ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {num}반
                        </button>
                      );
                    })
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  선택된 반: {classNums.length > 0 ? `${classNums.join(", ")}반` : "없음"}
                </p>
              </div>

              {/* 과목명 */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  대상 과목명 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  placeholder="예: 통합과학, 코딩기초"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  required
                />
              </div>

              {/* 공동 담당 교사 검색 및 추가 (AutocompleteInput 적용) */}
              <div className="space-y-1.5">
                <label className="block font-bold text-gray-700">
                  투입 교사 검색 및 추가 (최소 2명) <span className="text-red-500">*</span>
                </label>
                <AutocompleteInput
                  value={teacherEmailInput}
                  onChange={(val) => setTeacherEmailInput(val)}
                  onSelect={(email) => handleAddTeacherEmail(email)}
                  placeholder="교사 성명 또는 이메일 검색 후 선택..."
                  type="user"
                  domain={domain}
                />

                {/* 추가된 교사 이메일 태그 목록 */}
                {teacherEmails.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 p-2.5 bg-gray-50 border border-gray-200 rounded-lg max-h-32 overflow-y-auto mt-2">
                    {teacherEmails.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-100 text-purple-900 rounded font-semibold text-xs border border-purple-200"
                      >
                        <span>{email}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTeacherEmail(email)}
                          className="text-purple-700 hover:text-purple-950 font-bold ml-1"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400">교사 이메일을 2명 이상 추가해 주세요.</p>
                )}
              </div>

              {/* 활성화 여부 */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="coteach-active"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                />
                <label htmlFor="coteach-active" className="font-bold text-gray-700 cursor-pointer">
                  이 규칙 활성화 (검사기 및 자동 조정에 적용)
                </label>
              </div>

              {/* 제출 버튼 */}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 text-xs"
              >
                {saving && <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />}
                <span>{editingRuleId ? "복수교사 규칙 수정 저장" : "복수교사 규칙 등록"}</span>
              </button>
            </form>
          </div>

          {/* 판정 미리보기 카드 (SimulGroupTab §A-5 문법) */}
          {showPreview && (
            <div className="bg-white rounded-xl shadow-sm border border-purple-200 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-purple-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-purple-950 flex items-center gap-2">
                    <span>🔍 지정 수업 미리보기 검증</span>
                    {hitCount > 0 && (
                      <span className="text-[11px] bg-purple-600 text-white font-extrabold px-2 py-0.5 rounded-full">
                        {hitCount}셀 해당
                      </span>
                    )}
                    {subjectName.trim() && hitCount === 0 && !loadingPreview && (
                      <span className="text-[11px] bg-amber-500 text-white font-extrabold px-2 py-0.5 rounded-full">
                        일치 수업 없음 ⚠️
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-purple-700 mt-0.5">
                    현재 작성 중인 과목명·교사 기준으로 실제 시간표에서 복수교사 투입 수업 셀을 미리 확인합니다.
                    {subjectName.trim() && hitCount === 0 && !loadingPreview && (
                      <span className="text-amber-700 font-semibold"> 과목명 표기 불일치를 의심해 주세요.</span>
                    )}
                  </p>
                </div>

                {/* 반 선택 버튼 */}
                <div className="flex items-center gap-1 bg-purple-50 p-1 rounded-lg flex-wrap">
                  <span className="text-[11px] font-bold text-purple-800 px-1.5">미리보기 반:</span>
                  {classNums.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setPreviewClassNum(c);
                        fetchPreviewClassGrid(grade, c);
                      }}
                      className={`px-2 py-0.5 rounded text-xs font-bold transition-all ${
                        previewClassNum === c
                          ? "bg-purple-600 text-white shadow-xs"
                          : "text-purple-700 hover:bg-purple-100"
                      }`}
                    >
                      {c}반
                    </button>
                  ))}
                </div>
              </div>

              {loadingPreview ? (
                <div className="py-8 text-center text-xs text-gray-500 font-semibold">
                  {grade}학년 {previewClassNum}반 시간표를 불러오는 중입니다...
                </div>
              ) : !previewGrid ? (
                <div className="py-6 text-center text-xs text-gray-400">
                  시간표 데이터를 찾을 수 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-lg text-xs text-purple-900 leading-relaxed">
                    🏫 <strong>{previewGrid.grade}학년 {previewGrid.classNum}반 시간표 대조</strong> — 하이라이트된 셀이 <strong>복수교사 투입 수업</strong>으로 적용됩니다.
                    {teacherEmails.length > 0 && (
                      <span className="ml-1 font-semibold text-purple-700">
                        ({teacherEmails.join(", ")} 포함 수업)
                      </span>
                    )}
                  </div>

                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="w-full text-center text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-200 font-bold text-gray-700">
                          <th className="py-2 px-1 border-r border-gray-200 w-12">교시</th>
                          {DAYS.map((d) => (
                            <th key={d.num} className="py-2 px-1 border-r border-gray-200 min-w-[5.5rem]">
                              {d.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {Array.from({ length: maxPeriod }).map((_, pIdx) => {
                          const period = pIdx + 1;
                          return (
                            <tr key={period}>
                              <td className="py-2 px-1 font-bold bg-gray-50 border-r border-gray-200 text-gray-600">
                                {period}
                              </td>
                              {DAYS.map((d) => {
                                const cell = previewGrid.cells?.find(
                                  (c) => c.day === d.num && c.period === period
                                );
                                const lesson = cell?.lessons?.[0];
                                const hit = lesson
                                  ? isCoTeachingCell(
                                      lesson.subjectName,
                                      (lesson.teachers || []).map((t) => t.email || ""),
                                      subjectName,
                                      teacherEmails
                                    )
                                  : false;

                                return (
                                  <td
                                    key={d.num}
                                    className={`p-2 border-r border-gray-200 transition-colors ${
                                      hit
                                        ? "bg-purple-100/90 text-purple-950 font-black ring-2 ring-purple-400 ring-inset"
                                        : "bg-white text-gray-700"
                                    }`}
                                  >
                                    {lesson ? (
                                      <div className="space-y-0.5">
                                        <div className="font-bold text-[11px] truncate">
                                          {lesson.subjectName}
                                        </div>
                                        <div className="text-[10px] text-gray-500 truncate">
                                          {lesson.teachers?.map((t) => t.name).join(", ")}
                                        </div>
                                        {hit && (
                                          <span className="inline-block text-[9px] bg-purple-700 text-white font-extrabold px-1 rounded mt-0.5">
                                            👥 복수교사
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-gray-300">-</span>
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
          )}
        </div>

        {/* 우측: 규칙 목록 */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <span>📋 등록된 복수교사 규칙 목록</span>
                  <span className="bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full font-bold">
                    {filteredRules.length}건
                  </span>
                </h3>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="과목명/교사이메일 검색..."
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs w-full sm:w-48 focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs font-semibold text-gray-500">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-purple-600 border-t-transparent mb-2" />
                <p>복수교사 규칙 목록을 불러오는 중입니다...</p>
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 text-red-800 rounded-lg text-xs font-semibold border border-red-200">
                {error}
              </div>
            ) : filteredRules.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                등록된 복수교사 규칙이 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`p-4 rounded-xl border transition-all ${
                      rule.active === false
                        ? "bg-gray-50 border-gray-200 opacity-60"
                        : "bg-white border-purple-200 hover:border-purple-300 shadow-xs"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="px-2 py-0.5 rounded text-[11px] font-black bg-purple-600 text-white">
                            {rule.grade}학년
                          </span>
                          <span className="font-bold text-sm text-gray-900">{rule.subjectName}</span>
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                            투입 교사 {rule.teacherEmails?.length || 0}명
                          </span>
                          {rule.active === false && (
                            <span className="bg-gray-200 text-gray-700 text-[10px] px-1.5 py-0.5 rounded font-bold">
                              비활성
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-gray-600 space-y-1 mt-2">
                          <p>
                            <strong className="text-gray-700">적용 반:</strong> {rule.grade}학년 {rule.classNums?.join(", ")}반
                          </p>
                          <div>
                            <strong className="text-gray-700">공동 투입 교사:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {rule.teacherEmails?.map((e) => (
                                <span key={e} className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded text-[11px] font-semibold border border-gray-200">
                                  {e}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 text-xs">
                        <button
                          onClick={() => handleEditClick(rule)}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded"
                        >
                          수정
                        </button>
                        <button
                          onClick={() =>
                            handleDeleteRule(rule.id!, `${rule.grade}학년 ${rule.subjectName}`)
                          }
                          disabled={deletingId === rule.id}
                          className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded disabled:opacity-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
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
