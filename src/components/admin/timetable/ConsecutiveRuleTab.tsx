"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ConsecutiveRule, ClassGrid } from "@/lib/timetable/types";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { useAvailableClasses } from "./useAvailableClasses";
import RegistryUnlockModal from "./RegistryUnlockModal";

interface ConsecutiveRuleTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
  isOperating?: boolean;
  isArchived?: boolean;
}

// 클라이언트 전용 순수 판정 헬퍼 (서버 normSubject 규약 동일)
const normSubj = (s: string) =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();
const normEmail = (e: string) => (e || "").trim().toLowerCase();

function isConsecutiveCell(
  lessonSubjectName: string,
  lessonTeacherEmails: string[],
  formSubjectName: string,
  formTeacherEmail: string
): boolean {
  if (!formSubjectName.trim()) return false;
  if (normSubj(lessonSubjectName) !== normSubj(formSubjectName)) return false;
  if (formTeacherEmail.trim()) {
    // 교사 한정이 지정된 경우: 해당 교사가 이 수업에 포함돼야 함
    return lessonTeacherEmails
      .map(normEmail)
      .includes(normEmail(formTeacherEmail));
  }
  return true;
}

export default function ConsecutiveRuleTab({
  activeTermId,
  periodsPerDay = 7,
  isOperating = false,
  isArchived = false,
}: ConsecutiveRuleTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  const { getClassesForGrade } = useAvailableClasses(activeTermId, { fallbackOnEmpty: true });

  const [rules, setRules] = useState<ConsecutiveRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // 잠금 해제 사유 모달 상태
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<((reason: string) => Promise<void>) | null>(null);

  // Form states
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [grade, setGrade] = useState<number>(1);
  const [classNums, setClassNums] = useState<number[]>([1]);
  const [subjectName, setSubjectName] = useState("");
  const [teacherSearchTerm, setTeacherSearchTerm] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [pattern, setPattern] = useState("2");
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
        body: JSON.stringify({ action: "consecutive_rule_list", termId: activeTermId || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || data.data || []);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "연속수업 규칙 목록을 불러올 수 없습니다.");
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
    setTeacherSearchTerm("");
    setTeacherEmail("");
    setPattern("2");
    setActive(true);
  };

  const handleSelectTeacher = (email: string, name?: string) => {
    setTeacherEmail(email);
    setTeacherSearchTerm(name ? `${name} (${email})` : email);
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

  const handleEditClick = (rule: ConsecutiveRule) => {
    setEditingRuleId(rule.id || null);
    setGrade(rule.grade);
    setClassNums(rule.classNums || []);
    setSubjectName(rule.subjectName || "");
    setTeacherEmail(rule.teacherEmail || "");
    setTeacherSearchTerm(rule.teacherEmail || "");
    setPattern(rule.pattern || "2");
    setActive(rule.active !== false);
  };

  const handleSaveRule = async (e: React.FormEvent, reasonOverride?: string) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    if (!subjectName.trim()) {
      alert("대상 과목명을 입력해 주세요.");
      return;
    }
    if (classNums.length === 0) {
      alert("대상 반을 1개 이상 선택해 주세요.");
      return;
    }

    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
      alert("연속패턴(예: 2, 2,2, 3)을 입력해 주세요.");
      return;
    }
    if (!/^\d+(\s*,\s*\d+)*$/.test(trimmedPattern)) {
      alert("연속패턴은 '2' 또는 '2,2'와 같이 숫자와 쉼표로만 작성해야 합니다.");
      return;
    }
    const blockNums = trimmedPattern.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
    if (!blockNums.some((n) => n >= 2)) {
      alert("연속 블록 길이(2 이상)가 1개 이상 포함되어야 합니다.");
      return;
    }

    const finalTeacherEmail = teacherEmail.trim();
    const unlockReason = reasonOverride;

    setSaving(true);
    try {
      const payload: ConsecutiveRule = {
        id: editingRuleId || undefined,
        termId: activeTermId || "",
        grade,
        classNums,
        subjectName: subjectName.trim(),
        teacherEmail: finalTeacherEmail ? finalTeacherEmail.toLowerCase() : undefined,
        pattern: trimmedPattern,
        active,
      };

      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "consecutive_rule_save",
          rule: payload,
          ...(editingRuleId ? { ruleId: editingRuleId } : {}),
          ...(unlockReason ? { unlockReason } : {}),
        }),
      });

      const data = await res.json();
      if (res.status === 423 || data.code === "registry-locked") {
        if (data.termState === "archived") {
          alert(data.error || "지난 학기의 편성 등록 내용은 열람만 가능합니다.");
          return;
        }
        setPendingAction(() => async (reason: string) => {
          await handleSaveRule(e, reason);
        });
        setUnlockModalOpen(true);
        return;
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || "저장에 실패했습니다.");
      }

      alert("연속수업 규칙이 성공적으로 저장되었습니다.");
      resetForm();
      fetchRules();
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string, labelText: string, reasonOverride?: string) => {
    if (isArchived) {
      alert("지난 학기의 편성 등록 내용은 열람만 가능합니다.");
      return;
    }
    if (!reasonOverride && !confirm(`'${labelText}' 연속수업 규칙을 삭제하시겠습니까?`)) return;
    setDeletingId(ruleId);
    const unlockReason = reasonOverride;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "consecutive_rule_delete",
          ruleId,
          ...(unlockReason ? { unlockReason } : {}),
        }),
      });
      const data = await res.json();
      if (res.status === 423 || data.code === "registry-locked") {
        if (data.termState === "archived") {
          alert(data.error || "지난 학기의 편성 등록 내용은 열람만 가능합니다.");
          return;
        }
        setPendingAction(() => async (reason: string) => {
          await handleDeleteRule(ruleId, labelText, reason);
        });
        setUnlockModalOpen(true);
        return;
      }

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
      (r.teacherEmail && r.teacherEmail.toLowerCase().includes(q)) ||
      r.pattern.toLowerCase().includes(q) ||
      `${r.grade}학년`.includes(q)
    );
  });

  // 미리보기 판정: 과목명 일치 + 교사 한정(옵셔널) — 현재 폼 기준
  const showPreview = subjectName.trim() !== "" || editingRuleId !== null;

  // 미리보기에 걸리는 셀 수 (선택된 반 중 현재 previewClassNum 기준)
  const hitCount = previewGrid
    ? (previewGrid.cells || []).reduce((acc, cell) => {
        return (
          acc +
          (cell.lessons || []).filter((lesson) =>
            isConsecutiveCell(
              lesson.subjectName,
              (lesson.teachers || []).map((t) => t.email || ""),
              subjectName,
              teacherEmail
            )
          ).length
        );
      }, 0)
    : 0;

  return (
    <div className="space-y-6 font-sans">
      {/* ㉯ 계열 탭 상단 안내 (스펙 §4 확정 문안) */}
      {isOperating && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 font-medium flex items-center gap-2 shadow-xs">
          <span className="text-base">ℹ️</span>
          <span>이 등록 내용은 시간표를 새로 짤 때 쓰입니다. 운영 중인 시간표에는 영향을 주지 않습니다.</span>
        </div>
      )}

      {/* 안내 박스 - 눈높이 문구로 정리 */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-5 text-sky-900 text-xs leading-relaxed space-y-1">
        <div className="font-bold text-sm flex items-center gap-1.5 text-sky-900">
          <span>🔁</span>
          <span>연속수업 등록부</span>
        </div>
        <p>
          과목별 주당 연속 배치 블록 규칙을 지정합니다 (예: <strong>2</strong> = 2시간 연속 1회, <strong>2,2</strong> = 2시간 연속 2회, <strong>3</strong> = 3시간 연속 1회).
        </p>
        <p className="text-[11px] text-sky-800 font-semibold">
          💡 <strong>소유 규칙</strong>: 이동수업(분반)이나 특별실 그룹에 속한 연속수업은 이 등록부가 아닌 해당 그룹 설정에서 연속을 소유해야 합니다 (이중 등재 금지).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 등록/수정 폼 + 미리보기 (SimulGroupTab §A-5 문법) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span>{editingRuleId ? "✏️ 연속수업 규칙 수정" : "➕ 연속수업 규칙 등록"}</span>
                {isOperating && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    🔒 운영 학기 잠김
                  </span>
                )}
                {isArchived && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-700">
                    🔒 열람 전용
                  </span>
                )}
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
                          ? "bg-sky-600 text-white border-sky-600 shadow-sm"
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
                      className="text-[11px] font-semibold text-sky-700 hover:underline"
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
                              ? "bg-sky-600 text-white border-sky-600 shadow-xs"
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
                  placeholder="예: 과학탐구실험, 체육, 미술"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  required
                />
              </div>

              {/* 연속패턴 (pattern) & 프리셋 */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">
                  연속 블록 패턴 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="예: 2 또는 2,2 또는 3"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 mb-2 font-mono font-bold"
                  required
                />
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="font-bold text-gray-500 self-center">추천 패턴:</span>
                  <button
                    type="button"
                    onClick={() => setPattern("2")}
                    className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded font-bold"
                  >
                    2 (2시간 연속 1회)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPattern("2,2")}
                    className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded font-bold"
                  >
                    2,2 (2시간 연속 2회)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPattern("3")}
                    className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded font-bold"
                  >
                    3 (3시간 연속 1회)
                  </button>
                </div>
              </div>

              {/* 특정 교사 이메일 (AutocompleteInput 적용) */}
              <div className="space-y-1.5">
                <label className="block font-bold text-gray-700">
                  특정 교사 한정 검색 (선택)
                </label>
                <AutocompleteInput
                  value={teacherSearchTerm}
                  onChange={(val) => {
                    setTeacherSearchTerm(val);
                    // onChange에서는 선택값을 절대 승격하지 않는다 (선택 강제 원칙 — AGENTS 규칙 4)
                    // 검색어 변경 시 이전 선택값 무효화
                    setTeacherEmail("");
                  }}
                  onSelect={handleSelectTeacher}
                  placeholder="지정 안함 (교사명/이메일 검색...)"
                  type="user"
                  domain={domain}
                />
                {teacherEmail && (
                  <div className="flex items-center justify-between p-2 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 text-xs font-semibold">
                    <span>
                      ✅ 선택된 교사: <strong>{teacherEmail}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setTeacherEmail("");
                        setTeacherSearchTerm("");
                      }}
                      className="text-sky-700 hover:text-sky-950 font-bold ml-2 underline"
                    >
                      제거 (전 교사 대상)
                    </button>
                  </div>
                )}
              </div>

              {/* 활성화 여부 */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="consec-active"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 text-sky-600 rounded border-gray-300 focus:ring-sky-500"
                />
                <label htmlFor="consec-active" className="font-bold text-gray-700 cursor-pointer">
                  이 규칙 활성화 (검사기 및 자동 조정에 적용)
                </label>
              </div>

              {/* 제출 버튼 */}
              <button
                type="submit"
                disabled={saving || isArchived}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 text-white font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 text-xs"
              >
                {saving && <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />}
                {isOperating && <span>🔒</span>}
                <span>{editingRuleId ? "연속수업 규칙 수정 저장" : "연속수업 규칙 등록"}</span>
              </button>
            </form>
          </div>

          {/* 판정 미리보기 카드 (SimulGroupTab §A-5 문법) */}
          {showPreview && (
            <div className="bg-white rounded-xl shadow-sm border border-sky-200 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-sky-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-sky-950 flex items-center gap-2">
                    <span>🔍 지정 수업 미리보기 검증</span>
                    {hitCount > 0 && (
                      <span className="text-[11px] bg-sky-600 text-white font-extrabold px-2 py-0.5 rounded-full">
                        {hitCount}셀 해당
                      </span>
                    )}
                    {subjectName.trim() && hitCount === 0 && !loadingPreview && (
                      <span className="text-[11px] bg-amber-500 text-white font-extrabold px-2 py-0.5 rounded-full">
                        일치 수업 없음 ⚠️
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-sky-700 mt-0.5">
                    현재 작성 중인 과목명 기준으로 실제 시간표에서 해당 수업 셀을 미리 확인합니다.
                    {subjectName.trim() && hitCount === 0 && !loadingPreview && (
                      <span className="text-amber-700 font-semibold"> 과목명 표기 불일치를 의심해 주세요.</span>
                    )}
                  </p>
                </div>

                {/* 반 선택 버튼 */}
                <div className="flex items-center gap-1 bg-sky-50 p-1 rounded-lg flex-wrap">
                  <span className="text-[11px] font-bold text-sky-800 px-1.5">미리보기 반:</span>
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
                          ? "bg-sky-600 text-white shadow-xs"
                          : "text-sky-700 hover:bg-sky-100"
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
                  <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-lg text-xs text-sky-900 leading-relaxed">
                    🏫 <strong>{previewGrid.grade}학년 {previewGrid.classNum}반 시간표 대조</strong> — 하이라이트된 셀이 <strong>이 규칙의 연속수업 대상</strong>으로 적용됩니다.
                    {teacherEmail && (
                      <span className="ml-1 font-semibold text-sky-700">({teacherEmail} 한정)</span>
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
                                  ? isConsecutiveCell(
                                      lesson.subjectName,
                                      (lesson.teachers || []).map((t) => t.email || ""),
                                      subjectName,
                                      teacherEmail
                                    )
                                  : false;

                                return (
                                  <td
                                    key={d.num}
                                    className={`p-2 border-r border-gray-200 transition-colors ${
                                      hit
                                        ? "bg-sky-100/90 text-sky-950 font-black ring-2 ring-sky-400 ring-inset"
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
                                          <span className="inline-block text-[10px] bg-sky-700 text-white font-extrabold px-1 rounded mt-0.5">
                                            🔁 연속대상
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
                  <span>📋 등록된 연속수업 규칙 목록</span>
                  <span className="bg-sky-100 text-sky-800 text-xs px-2 py-0.5 rounded-full font-bold">
                    {filteredRules.length}건
                  </span>
                </h3>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="과목명/교사/패턴 검색..."
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs w-full sm:w-48 focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs font-semibold text-gray-500">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-3 border-sky-600 border-t-transparent mb-2" />
                <p>연속수업 규칙 목록을 불러오는 중입니다...</p>
              </div>
            ) : error ? (
              <div className="p-4 bg-red-50 text-red-800 rounded-lg text-xs font-semibold border border-red-200">
                {error}
              </div>
            ) : filteredRules.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                등록된 연속수업 규칙이 없습니다.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`p-4 rounded-xl border transition-all ${
                      rule.active === false
                        ? "bg-gray-50 border-gray-200 opacity-60"
                        : "bg-white border-sky-200 hover:border-sky-300 shadow-xs"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="px-2 py-0.5 rounded text-[11px] font-black bg-sky-600 text-white">
                            {rule.grade}학년
                          </span>
                          <span className="font-bold text-sm text-gray-900">{rule.subjectName}</span>
                          <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded text-xs font-mono font-bold">
                            패턴: {rule.pattern}
                          </span>
                          {rule.active === false && (
                            <span className="bg-gray-200 text-gray-700 text-xs px-1.5 py-0.5 rounded font-bold">
                              비활성
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-gray-600 space-y-0.5 mt-2">
                          <p>
                            <strong className="text-gray-700">적용 반:</strong> {rule.grade}학년 {rule.classNums?.join(", ")}반
                          </p>
                          {rule.teacherEmail && (
                            <p>
                              <strong className="text-gray-700">한정 교사:</strong> {rule.teacherEmail}
                            </p>
                          )}
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
                            handleDeleteRule(rule.id!, `${rule.grade}학년 ${rule.subjectName} (${rule.pattern})`)
                          }
                          disabled={deletingId === rule.id || isArchived}
                          className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded disabled:opacity-50 flex items-center gap-1"
                        >
                          {isOperating && <span>🔒</span>}
                          <span>삭제</span>
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

      {/* 잠금 해제 사유 입력 모달 */}
      <RegistryUnlockModal
        isOpen={unlockModalOpen}
        onClose={() => {
          setUnlockModalOpen(false);
          setPendingAction(null);
        }}
        onConfirm={async (reason) => {
          setUnlockModalOpen(false);
          if (pendingAction) {
            const actionToRun = pendingAction;
            setPendingAction(null);
            await actionToRun(reason);
          }
        }}
        termId={activeTermId}
        loading={saving || deletingId !== null}
      />
    </div>
  );
}
