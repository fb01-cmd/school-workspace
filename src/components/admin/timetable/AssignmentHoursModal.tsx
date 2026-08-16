"use client";

import React, { useState, useMemo, useRef } from "react";
import { CurriculumCohort, HoursPlanRow } from "@/lib/timetable/types";
import { expandCohortFixedBlocks, impliedHoursFromFixedBlocks } from "@/lib/timetable/cohort";

export interface TeacherOption {
  email: string;
  name: string;
}

export interface AssignmentIssue {
  severity: "error" | "notice";
  code: string;
  dept?: string;
  text: string;
}

export interface AssembledHoursRow {
  grade: number;
  classNum: number;
  subjectName: string;
  teacherName: string;
  teacherEmail: string;
  hours: number;
}

interface AssignmentHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTermId?: string | null;
  teachers: TeacherOption[];
  cohorts: CurriculumCohort[];
  onApply: (params: {
    rows: HoursPlanRow[];
    targetYear: number;
    targetSemester: number;
    targetTermId: string;
  }) => void;
}

/**
 * 교직원 검색 자동완성 입력 컴포넌트
 */
function TeacherAutocompleteInput({
  value,
  teachers,
  onSelect,
  placeholder = "이름 또는 이메일 검색...",
}: {
  value: string;
  teachers: TeacherOption[];
  onSelect: (email: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const matchedTeacher = teachers.find((t) => t.email.toLowerCase() === (value || "").toLowerCase());
  const displayText = matchedTeacher ? `${matchedTeacher.name} (${matchedTeacher.email})` : value;

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return teachers.slice(0, 10);
    return teachers
      .filter((t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q))
      .slice(0, 15);
  }, [query, teachers]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={isOpen ? query : displayText}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setIsOpen(true);
          }}
          placeholder={placeholder}
          className="w-full px-2.5 py-1 text-xs bg-white border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-medium text-gray-900"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onSelect("");
              setQuery("");
              setIsOpen(false);
            }}
            className="text-gray-400 hover:text-red-500 font-bold px-1 text-xs"
            title="매칭 해제"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">일치하는 교직원 없음</div>
          ) : (
            suggestions.map((t) => (
              <button
                key={t.email}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(t.email);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 flex items-center justify-between ${
                  t.email.toLowerCase() === (value || "").toLowerCase()
                    ? "bg-indigo-50 font-bold text-indigo-900"
                    : "text-gray-800"
                }`}
              >
                <span>{t.name}</span>
                <span className="text-[11px] text-gray-400 font-mono">{t.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB 제한

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AssignmentHoursModal({
  isOpen,
  onClose,
  activeTermId,
  teachers,
  cohorts,
  onApply,
}: AssignmentHoursModalProps) {
  // 모달 단계: "input" (파일 선택) -> "extracting" (부서별 순차 추출) -> "result" (결과 검토 및 매칭)
  const [step, setStep] = useState<"input" | "extracting" | "result">("input");

  // 대상 학기 설정 (기본값: 활성 학기 또는 현재 연도/1학기)
  const initialYear = useMemo(() => {
    if (activeTermId) {
      const match = activeTermId.match(/^(\d{4})/);
      if (match) return parseInt(match[1], 10);
    }
    return new Date().getFullYear();
  }, [activeTermId]);

  const initialSemester = useMemo(() => {
    if (activeTermId) {
      const match = activeTermId.match(/-(\d)$/);
      if (match) return parseInt(match[1], 10);
    }
    return 1;
  }, [activeTermId]);

  const [targetYear, setTargetYear] = useState<number>(initialYear);
  const [targetSemester, setTargetSemester] = useState<number>(initialSemester);

  // 파일 상태
  const [assignFile, setAssignFile] = useState<File | null>(null);
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [simulFile, setSimulFile] = useState<File | null>(null);

  // 진행 상태 (extracting)
  const [deptsList, setDeptsList] = useState<Array<{ index: number; dept: string }>>([]);
  const [currentDeptIndex, setCurrentDeptIndex] = useState<number>(0);
  const [completedDepts, setCompletedDepts] = useState<string[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);

  // 결과 상태 (result)
  const [extractedRows, setExtractedRows] = useState<AssembledHoursRow[]>([]);
  const [creativeRows, setCreativeRows] = useState<AssembledHoursRow[]>([]);
  const [includeCreative, setIncludeCreative] = useState<boolean>(false);
  const [issues, setIssues] = useState<AssignmentIssue[]>([]);
  const [teacherMappings, setTeacherMappings] = useState<Record<string, string>>({}); // teacherName -> teacherEmail
  const [deptCount, setDeptCount] = useState<number>(0);

  // 결과 화면 필터
  const [previewGradeFilter, setPreviewGradeFilter] = useState<number | "all">("all");
  const [previewSearch, setPreviewSearch] = useState<string>("");

  // 모달 초기화
  const handleReset = () => {
    setStep("input");
    setAssignFile(null);
    setCreativeFile(null);
    setSimulFile(null);
    setDeptsList([]);
    setCurrentDeptIndex(0);
    setCompletedDepts([]);
    setExtractError(null);
    setExtractedRows([]);
    setCreativeRows([]);
    setIncludeCreative(false);
    setIssues([]);
    setTeacherMappings({});
    setDeptCount(0);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  // 분석 시작
  const handleStartExtraction = async () => {
    if (!assignFile) {
      alert("과목별 배정표 PDF 파일을 선택해 주세요.");
      return;
    }
    if (assignFile.size > MAX_FILE_BYTES) {
      alert("과목별 배정표 파일 용량이 3MB를 초과합니다.");
      return;
    }
    if (creativeFile && creativeFile.size > MAX_FILE_BYTES) {
      alert("창체 담당 파일 용량이 3MB를 초과합니다.");
      return;
    }
    if (simulFile && simulFile.size > MAX_FILE_BYTES) {
      alert("이동수업 현황 파일 용량이 3MB를 초과합니다.");
      return;
    }

    setStep("extracting");
    setExtractError(null);
    setCompletedDepts([]);

    try {
      // 1. 파일 Base64 변환
      const assignB64 = await fileToBase64(assignFile);
      const creativeB64 = creativeFile ? await fileToBase64(creativeFile) : undefined;
      const simulB64 = simulFile ? await fileToBase64(simulFile) : undefined;

      // 2. 작업 준비 (hours_assignment_prepare)
      const prepRes = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hours_assignment_prepare",
          assignmentPdfB64: assignB64,
          creativePdfB64: creativeB64,
          simulXlsxB64: simulB64,
          targetYear: Number(targetYear),
          targetSemester: Number(targetSemester),
        }),
      });

      const prepData = await prepRes.json();
      if (!prepRes.ok || !prepData.jobId) {
        throw new Error(prepData.error || "배정표 작업 준비에 실패했습니다.");
      }

      const jobId = prepData.jobId as string;
      const depts = (prepData.depts || []) as Array<{ index: number; dept: string }>;
      setDeptsList(depts);

      // 3. 부서별 순차 추출 (hours_assignment_extract)
      const finishedNames: string[] = [];
      for (let i = 0; i < depts.length; i++) {
        setCurrentDeptIndex(i);
        const deptItem = depts[i];

        const extRes = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "hours_assignment_extract",
            jobId,
            deptIndex: deptItem.index,
          }),
        });

        const extData = await extRes.json();
        if (!extRes.ok) {
          throw new Error(extData.error || `${deptItem.dept} 부서 내용을 읽는 중 오류가 발생했습니다.`);
        }

        finishedNames.push(deptItem.dept);
        setCompletedDepts([...finishedNames]);
      }

      // 4. 최종 취합 및 검증 (hours_assignment_finalize)
      const finRes = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hours_assignment_finalize",
          jobId,
        }),
      });

      const finData = await finRes.json();
      if (!finRes.ok) {
        throw new Error(finData.error || "분석 결과 취합에 실패했습니다.");
      }

      setExtractedRows(finData.rows || []);
      setCreativeRows(finData.creativeRows || []);
      setIssues(finData.issues || []);
      setDeptCount(finData.deptCount || depts.length);

      // 교사 매칭 초기 매핑 구축
      const allRows: AssembledHoursRow[] = [...(finData.rows || []), ...(finData.creativeRows || [])];
      const distinctNames = Array.from(new Set(allRows.map((r) => r.teacherName).filter(Boolean)));

      const initialMappings: Record<string, string> = {};
      for (const tName of distinctNames) {
        const rowWithEmail = allRows.find((r) => r.teacherName === tName && r.teacherEmail);
        if (rowWithEmail?.teacherEmail) {
          initialMappings[tName] = rowWithEmail.teacherEmail;
        } else {
          const matches = teachers.filter((t) => t.name === tName);
          if (matches.length === 1) {
            initialMappings[tName] = matches[0].email;
          } else {
            initialMappings[tName] = "";
          }
        }
      }
      setTeacherMappings(initialMappings);

      setStep("result");
    } catch (err: any) {
      setExtractError(err.message || String(err));
    }
  };

  // 이슈 분리 (9c-I 확인 모달 관례)
  const errorIssues = useMemo(() => issues.filter((i) => i.severity === "error"), [issues]);
  const noticeIssues = useMemo(() => issues.filter((i) => i.severity === "notice"), [issues]);

  // 전체 고유 교사 목록
  const distinctTeachersList = useMemo(() => {
    const combined = includeCreative ? [...extractedRows, ...creativeRows] : extractedRows;
    return Array.from(new Set(combined.map((r) => r.teacherName).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "ko")
    );
  }, [extractedRows, creativeRows, includeCreative]);

  // 미리보기 대상 행 목록
  const displayedPreviewRows = useMemo(() => {
    const combined = includeCreative ? [...extractedRows, ...creativeRows] : extractedRows;
    return combined.filter((r) => {
      if (previewGradeFilter !== "all" && r.grade !== previewGradeFilter) return false;
      if (previewSearch) {
        const q = previewSearch.toLowerCase();
        const sub = (r.subjectName || "").toLowerCase();
        const tName = (r.teacherName || "").toLowerCase();
        const tEmail = (teacherMappings[r.teacherName] || r.teacherEmail || "").toLowerCase();
        if (!sub.includes(q) && !tName.includes(q) && !tEmail.includes(q)) return false;
      }
      return true;
    });
  }, [extractedRows, creativeRows, includeCreative, previewGradeFilter, previewSearch, teacherMappings]);

  // 전체 주당 시수 합계
  const totalHours = useMemo(() => {
    const combined = includeCreative ? [...extractedRows, ...creativeRows] : extractedRows;
    return combined.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  }, [extractedRows, creativeRows, includeCreative]);

  // 시수 계획으로 적용 및 불러오기
  const handleApplyToPlan = () => {
    const sourceRows = includeCreative ? [...extractedRows, ...creativeRows] : extractedRows;
    if (sourceRows.length === 0) {
      alert("불러올 수업 데이터가 없습니다.");
      return;
    }

    // 미매칭 교사 확인
    const unmappedTeachers = distinctTeachersList.filter((tName) => !teacherMappings[tName]);
    if (unmappedTeachers.length > 0) {
      const confirmContinue = confirm(
        `다음 ${unmappedTeachers.length}명의 선생님이 아직 시스템 계정과 매칭되지 않았습니다:\n` +
          `${unmappedTeachers.slice(0, 10).join(", ")}${unmappedTeachers.length > 10 ? " 외" : ""}\n\n` +
          `매칭되지 않은 상태로 불러와도 화면에서 직접 지정할 수 있습니다. 계속 진행하시겠습니까?`
      );
      if (!confirmContinue) return;
    }

    // 교육과정 고정 시간 등록부 확인
    if (cohorts.length === 0) {
      const confirmNoCohort = confirm(
        "교육과정 고정 시간 등록부가 비어 있어 창체·SLAT 고정 시간이 추가되지 않습니다.\n\n이대로 계속 진행하시겠습니까?"
      );
      if (!confirmNoCohort) return;
    }

    // HoursPlanRow 변환
    const planRows: HoursPlanRow[] = sourceRows.map((r, idx) => {
      const email = teacherMappings[r.teacherName] !== undefined ? teacherMappings[r.teacherName] : (r.teacherEmail || "");
      return {
        id: `assign-${r.grade}-${r.classNum}-${r.subjectName}-${r.teacherName}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        grade: r.grade,
        classNum: r.classNum,
        subjectName: r.subjectName,
        teacherName: r.teacherName,
        teacherEmail: email,
        hours: r.hours,
      };
    });

    // 코호트 고정 블록 함의 행 보강
    const distinctClassKeys = Array.from(new Set(sourceRows.map((r) => `${r.grade}-${r.classNum}`)));
    const classList = distinctClassKeys.map((k) => {
      const [g, c] = k.split("-").map(Number);
      return { grade: g, classNum: c };
    });

    if (cohorts.length > 0 && classList.length > 0) {
      const fixedBlocks = expandCohortFixedBlocks(cohorts, targetYear, classList);
      const impliedHours = impliedHoursFromFixedBlocks(fixedBlocks);
      for (const imp of impliedHours) {
        const virtualName = imp.teacherKey.replace(/^name:/, "");
        planRows.push({
          id: `virtual-${imp.grade}-${imp.classNum}-${imp.subjectName}-${Math.random().toString(36).slice(2, 6)}`,
          grade: imp.grade,
          classNum: imp.classNum,
          subjectName: imp.subjectName,
          teacherEmail: "",
          teacherName: virtualName,
          hours: imp.hours,
        });
      }
    }

    const targetTermId = activeTermId || `${targetYear}-${targetSemester}`;
    onApply({
      rows: planRows,
      targetYear,
      targetSemester,
      targetTermId,
    });
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
        {/* ── 모달 상단 헤더 ── */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📄 배정표에서 주당 수업 시간 만들기</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              과목별 배정표 등의 문서에서 교과별 배정 내용을 자동으로 읽어 선생님별 수업 시간을 생성합니다.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-lg font-bold p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* ── 모달 본문 ── */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs flex-1">
          {/* STEP 1: 파일 업로드 및 대상 학기 설정 */}
          {step === "input" && (
            <div className="space-y-6">
              {/* 대상 연도 및 학기 입력 */}
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 space-y-2">
                <h4 className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <span>📅 대상 학년도 및 학기</span>
                </h4>
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-gray-700 font-medium">학년도:</label>
                    <input
                      type="number"
                      value={targetYear}
                      onChange={(e) => setTargetYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                      className="w-24 px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg font-bold text-gray-900 text-center"
                    />
                    <span className="text-gray-600">학년도</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="text-gray-700 font-medium">학기:</label>
                    <select
                      value={targetSemester}
                      onChange={(e) => setTargetSemester(parseInt(e.target.value, 10) || 1)}
                      className="px-3 py-1.5 bg-white border border-indigo-200 rounded-lg font-bold text-gray-900"
                    >
                      <option value={1}>1학기</option>
                      <option value={2}>2학기</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-indigo-700 mt-1">
                  * 문서 내부의 학년도·학기 표기가 대상과 다르면 점검 안내가 표시됩니다.
                </p>
              </div>

              {/* 파일 업로드 3칸 */}
              <div className="space-y-4">
                <h4 className="font-bold text-gray-900 flex items-center gap-1.5">
                  <span>📁 문서 파일 선택 (파일당 3MB 이하)</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. 과목별 배정표 (필수) */}
                  <div
                    className={`border-2 rounded-xl p-4 flex flex-col justify-between transition-all ${
                      assignFile
                        ? "border-indigo-400 bg-indigo-50/40"
                        : "border-dashed border-gray-300 hover:border-indigo-400 bg-gray-50/50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-gray-900 text-xs">① 과목별 배정표</span>
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[10px]">
                          필수
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mb-3">
                        한글(HWP)에서 PDF로 저장한 교과별 배정표 (8쪽 내외)
                      </p>
                    </div>

                    {assignFile ? (
                      <div className="bg-white border border-indigo-200 rounded-lg p-2.5 flex items-center justify-between">
                        <div className="overflow-hidden mr-2">
                          <p className="font-bold text-indigo-900 truncate text-[11px]">{assignFile.name}</p>
                          <p className="text-[10px] text-gray-400 font-mono">{formatFileSize(assignFile.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAssignFile(null)}
                          className="text-gray-400 hover:text-red-500 font-bold p-1 text-xs"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="w-full py-2.5 px-3 bg-white border border-gray-300 hover:border-indigo-500 rounded-lg text-center font-bold text-gray-700 cursor-pointer shadow-sm transition-colors text-xs flex items-center justify-center gap-1">
                        <span>📄 PDF 선택</span>
                        <input
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setAssignFile(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {/* 2. 창체 수업 담당교사 (선택) */}
                  <div
                    className={`border-2 rounded-xl p-4 flex flex-col justify-between transition-all ${
                      creativeFile
                        ? "border-indigo-400 bg-indigo-50/40"
                        : "border-dashed border-gray-300 hover:border-indigo-400 bg-gray-50/50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-gray-900 text-xs">② 창체 수업 담당교사</span>
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium text-[10px]">
                          선택
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mb-3">
                        학년·반별 진로/창체 담당 교사 배정표 (PDF)
                      </p>
                    </div>

                    {creativeFile ? (
                      <div className="bg-white border border-indigo-200 rounded-lg p-2.5 flex items-center justify-between">
                        <div className="overflow-hidden mr-2">
                          <p className="font-bold text-indigo-900 truncate text-[11px]">{creativeFile.name}</p>
                          <p className="text-[10px] text-gray-400 font-mono">{formatFileSize(creativeFile.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCreativeFile(null)}
                          className="text-gray-400 hover:text-red-500 font-bold p-1 text-xs"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="w-full py-2.5 px-3 bg-white border border-gray-300 hover:border-indigo-500 rounded-lg text-center font-medium text-gray-700 cursor-pointer shadow-sm transition-colors text-xs flex items-center justify-center gap-1">
                        <span>📄 PDF 선택</span>
                        <input
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setCreativeFile(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {/* 3. 이동수업 현황 (선택) */}
                  <div
                    className={`border-2 rounded-xl p-4 flex flex-col justify-between transition-all ${
                      simulFile
                        ? "border-indigo-400 bg-indigo-50/40"
                        : "border-dashed border-gray-300 hover:border-indigo-400 bg-gray-50/50"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-gray-900 text-xs">③ 이동수업 현황</span>
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-medium text-[10px]">
                          선택
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mb-3">
                        선택과목별 반 편성 및 수강 현황 (엑셀 .xlsx)
                      </p>
                    </div>

                    {simulFile ? (
                      <div className="bg-white border border-indigo-200 rounded-lg p-2.5 flex items-center justify-between">
                        <div className="overflow-hidden mr-2">
                          <p className="font-bold text-indigo-900 truncate text-[11px]">{simulFile.name}</p>
                          <p className="text-[10px] text-gray-400 font-mono">{formatFileSize(simulFile.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSimulFile(null)}
                          className="text-gray-400 hover:text-red-500 font-bold p-1 text-xs"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="w-full py-2.5 px-3 bg-white border border-gray-300 hover:border-indigo-500 rounded-lg text-center font-medium text-gray-700 cursor-pointer shadow-sm transition-colors text-xs flex items-center justify-center gap-1">
                        <span>📊 엑셀 선택</span>
                        <input
                          type="file"
                          accept=".xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setSimulFile(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* 안내 문구 */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-600 space-y-1">
                <p className="font-bold text-gray-800 flex items-center gap-1.5">
                  <span>💡 진행 안내</span>
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-600">
                  <li>과목별 배정표의 부서별 표를 순차적으로 읽어 교사별 주당 수업 시간을 자동으로 추출합니다.</li>
                  <li>추출된 교사 성명은 시스템에 등록된 계정과 1:1로 매칭되며, 결과 화면에서 자유롭게 수정할 수 있습니다.</li>
                  <li>창체 담당 파일 및 이동수업 현황을 함께 올리면 상호 불일치 여부를 자동으로 교차 점검합니다.</li>
                </ul>
              </div>
            </div>
          )}

          {/* STEP 2: 부서별 순차 추출 진행 상태 */}
          {step === "extracting" && (
            <div className="py-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="inline-block relative">
                  <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center font-bold text-indigo-700 text-xs">
                    {deptsList.length > 0
                      ? `${Math.round(((completedDepts.length) / deptsList.length) * 100)}%`
                      : "..."}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-gray-900">
                    {deptsList.length > 0 && currentDeptIndex < deptsList.length
                      ? `${deptsList[currentDeptIndex]?.dept} 과목별 배정표를 자동으로 읽는 중입니다...`
                      : "배정표 데이터를 종합 분석하고 있습니다..."}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    부서별로 상세 분석 및 무결성 검증을 순차적으로 진행합니다. 잠시만 기다려 주세요. (부서당 약 10~20초)
                  </p>
                </div>
              </div>

              {/* 진행률 바 */}
              {deptsList.length > 0 && (
                <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.max(5, (completedDepts.length / deptsList.length) * 100)}%`,
                    }}
                  ></div>
                </div>
              )}

              {/* 부서별 진행 리스트 */}
              {deptsList.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <h5 className="font-bold text-gray-800 text-xs mb-3 flex items-center justify-between">
                    <span>교과 부서별 분석 현황</span>
                    <span className="text-indigo-600 font-mono">
                      {completedDepts.length} / {deptsList.length} 완료
                    </span>
                  </h5>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {deptsList.map((d, idx) => {
                      const isDone = completedDepts.includes(d.dept);
                      const isCurrent = idx === currentDeptIndex && !isDone;
                      return (
                        <div
                          key={d.dept}
                          className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between transition-all ${
                            isDone
                              ? "bg-emerald-50 border-emerald-300 text-emerald-900 font-bold"
                              : isCurrent
                              ? "bg-indigo-50 border-indigo-400 text-indigo-900 font-bold shadow-sm ring-1 ring-indigo-400 animate-pulse"
                              : "bg-white border-gray-200 text-gray-400"
                          }`}
                        >
                          <span className="truncate">{d.dept}</span>
                          <span>{isDone ? "✅" : isCurrent ? "⏳" : "·"}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 오류 발생 시 안내 */}
              {extractError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <div className="font-bold text-red-900 flex items-center gap-1.5">
                    <span>⛔ 분석 중 오류가 발생했습니다</span>
                  </div>
                  <p className="text-xs text-red-800">{extractError}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleStartExtraction}
                      className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      다시 시도
                    </button>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="px-3.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-xs transition-colors"
                    >
                      처음으로 돌아가기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: 분석 결과 검토 및 계정 매칭 */}
          {step === "result" && (
            <div className="space-y-6">
              {/* 요약 바 */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-emerald-950 font-medium">
                <div>
                  📊 <strong>분석 완료:</strong> {deptCount}개 교과 부서 · 총 {displayedPreviewRows.length}개 수업 ({totalHours}시간)
                </div>
                <div className="text-xs text-emerald-800 font-bold">
                  {targetYear}학년도 {targetSemester}학기 기준
                </div>
              </div>

              {/* 점검 이슈 목록 (9c-I 확인 모달 분리 관례) */}
              <div className="space-y-3">
                {/* 1) 오류성 이슈: 짜기 전에 살펴볼 점 */}
                {errorIssues.length > 0 && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-2">
                    <div className="font-bold text-amber-950 flex items-center gap-1.5">
                      <span>⚠️ 짜기 전에 살펴볼 점 ({errorIssues.length}건)</span>
                    </div>
                    <p className="text-[11px] text-amber-800">
                      배정표 내부의 시수 합계가 어긋나거나 기준과 맞지 않는 항목입니다. 필요 시 확인해 주세요:
                    </p>
                    <div className="space-y-1.5 pt-1">
                      {errorIssues.map((iss, idx) => (
                        <div
                          key={idx}
                          className="bg-white/80 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-950 flex items-start gap-2"
                        >
                          <span className="text-amber-600 font-bold">·</span>
                          <div className="flex-1">
                            {iss.dept && <strong className="text-amber-900 mr-1.5">[{iss.dept}]</strong>}
                            <span>{iss.text}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2) 고지성 이슈: 확인해 두면 좋은 점 */}
                {noticeIssues.length > 0 && (
                  <div className="bg-slate-50 border border-slate-300 rounded-xl p-4 space-y-2">
                    <div className="font-bold text-slate-900 flex items-center gap-1.5">
                      <span>ℹ️ 확인해 두면 좋은 점 ({noticeIssues.length}건)</span>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {noticeIssues.map((iss, idx) => (
                        <div
                          key={idx}
                          className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 flex items-start gap-2"
                        >
                          <span className="text-slate-500 font-bold">·</span>
                          <div className="flex-1">
                            {iss.dept && <strong className="text-slate-900 mr-1.5">[{iss.dept}]</strong>}
                            <span>{iss.text}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {errorIssues.length === 0 && noticeIssues.length === 0 && (
                  <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-3 text-emerald-800 flex items-center gap-2">
                    <span>✨</span>
                    <span>배정표와 교차 파일의 모든 시수 합계와 대상 정보가 정상적으로 일치합니다.</span>
                  </div>
                )}
              </div>

              {/* 창체(진로) 수업 시간 포함 옵션 */}
              {creativeRows.length > 0 && (
                <div className="border border-purple-200 bg-purple-50/40 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 font-bold text-purple-950 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeCreative}
                        onChange={(e) => setIncludeCreative(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                      />
                      <span>창체 담당 파일의 진로 수업 시간 추가 ({creativeRows.length}개 반 · 반당 1시간)</span>
                    </label>
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-bold text-[11px]">
                      기본 미포함
                    </span>
                  </div>
                  <p className="text-[11px] text-purple-800 pl-6 leading-relaxed">
                    ⚠️ 과목별 배정표의 비고란(+N)에 이미 진로 시간이 포함되어 있을 경우 이중으로 계산될 위험이 있습니다.
                    배정표 자체에 창체 시간이 누락되어 있어 별도 추가가 필요한 경우에만 선택하세요.
                  </p>
                </div>
              )}

              {/* 선생님 성명 ↔ 시스템 계정 매칭 섹션 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <span>👤 선생님 성명 ↔ 시스템 계정 매칭 ({distinctTeachersList.length}명)</span>
                  </h4>
                  <span className="text-[11px] text-gray-500">
                    매칭되지 않은 계정은 검색하여 직접 지정할 수 있습니다.
                  </span>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">배정표 기재 교사명</th>
                        <th className="px-3 py-2">매칭할 시스템 계정</th>
                        <th className="px-3 py-2 text-center w-36">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {distinctTeachersList.map((tName) => {
                        const email = teacherMappings[tName] || "";
                        const matchingCount = teachers.filter((t) => t.name === tName).length;
                        const isAmbiguous = matchingCount > 1;

                        return (
                          <tr key={tName} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-bold text-gray-900">{tName}</td>
                            <td className="px-3 py-2">
                              <TeacherAutocompleteInput
                                value={email}
                                teachers={teachers}
                                onSelect={(selectedEmail) =>
                                  setTeacherMappings({ ...teacherMappings, [tName]: selectedEmail })
                                }
                                placeholder="이름 또는 이메일 검색..."
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              {email ? (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[11px]">
                                  매칭됨
                                </span>
                              ) : isAmbiguous ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded font-bold text-[11px] whitespace-nowrap">
                                  동명이인 — 직접 선택
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[11px]">
                                  미매칭
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 추출된 수업 목록 미리보기 */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <span>📋 추출된 수업 목록 미리보기 ({displayedPreviewRows.length}건)</span>
                  </h4>

                  <div className="flex items-center gap-2">
                    {/* 학년 필터 */}
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setPreviewGradeFilter("all")}
                        className={`px-2 py-0.5 rounded font-medium ${
                          previewGradeFilter === "all" ? "bg-white text-gray-900 shadow-xs font-bold" : "text-gray-600"
                        }`}
                      >
                        전체
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewGradeFilter(1)}
                        className={`px-2 py-0.5 rounded font-medium ${
                          previewGradeFilter === 1 ? "bg-white text-gray-900 shadow-xs font-bold" : "text-gray-600"
                        }`}
                      >
                        1학년
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewGradeFilter(2)}
                        className={`px-2 py-0.5 rounded font-medium ${
                          previewGradeFilter === 2 ? "bg-white text-gray-900 shadow-xs font-bold" : "text-gray-600"
                        }`}
                      >
                        2학년
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewGradeFilter(3)}
                        className={`px-2 py-0.5 rounded font-medium ${
                          previewGradeFilter === 3 ? "bg-white text-gray-900 shadow-xs font-bold" : "text-gray-600"
                        }`}
                      >
                        3학년
                      </button>
                    </div>

                    {/* 검색 */}
                    <input
                      type="text"
                      placeholder="과목 또는 교사 검색..."
                      value={previewSearch}
                      onChange={(e) => setPreviewSearch(e.target.value)}
                      className="px-2 py-1 bg-white border border-gray-300 rounded text-xs w-36 text-gray-900"
                    />
                  </div>
                </div>

                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">학급</th>
                        <th className="px-3 py-2">과목명</th>
                        <th className="px-3 py-2">담당 선생님</th>
                        <th className="px-3 py-2">시스템 매칭 계정</th>
                        <th className="px-3 py-2 text-center">시수</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {displayedPreviewRows.slice(0, 100).map((r, idx) => {
                        const email = teacherMappings[r.teacherName] !== undefined ? teacherMappings[r.teacherName] : r.teacherEmail;
                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-mono font-bold text-gray-800">
                              {r.grade}-{r.classNum}반
                            </td>
                            <td className="px-3 py-1.5 font-bold text-gray-900">{r.subjectName}</td>
                            <td className="px-3 py-1.5 text-gray-800">{r.teacherName}</td>
                            <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">
                              {email || <span className="text-red-500 font-sans font-bold">미매칭</span>}
                            </td>
                            <td className="px-3 py-1.5 text-center font-bold text-indigo-700">{r.hours}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {displayedPreviewRows.length > 100 && (
                    <div className="p-2 bg-gray-50 text-center text-gray-500 text-[11px]">
                      외 {displayedPreviewRows.length - 100}개 수업이 더 있습니다 (전체 {displayedPreviewRows.length}개)
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 모달 하단 푸터 ── */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            {step === "result" && (
              <button
                type="button"
                onClick={handleReset}
                className="px-3.5 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 font-bold rounded-lg text-xs transition-colors"
              >
                다시 분석하기
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-xs transition-colors"
            >
              취소
            </button>

            {step === "input" && (
              <button
                type="button"
                onClick={handleStartExtraction}
                disabled={!assignFile}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1.5"
              >
                <span>자동 분석 시작</span>
                <span>→</span>
              </button>
            )}

            {step === "result" && (
              <button
                type="button"
                onClick={handleApplyToPlan}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1.5"
              >
                <span>📥 시수 계획으로 불러오기</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
