"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  HoursPlan,
  HoursPlanReviewNote,
  HoursPlanRow,
  HoursPlanSummary,
  SimulGroup,
  CurriculumCohort,
} from "@/lib/timetable/types";
import { parseHoursExcel, ParsedHoursResult } from "@/lib/timetable/excelHoursParser";
import { expandCohortFixedBlocks, impliedHoursFromFixedBlocks } from "@/lib/timetable/cohort";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import AssignmentHoursModal, { parseIssueTarget, issueGuidance } from "./AssignmentHoursModal";
import { SubjectConfirmation } from "@/lib/timetable/subjectDict";
import { rankReferenceTerms } from "@/lib/timetable/utils";

interface HoursPlanTabProps {
  activeTermId?: string | null;
  periodsPerDay?: number;
}

interface TeacherOption {
  email: string;
  name: string;
}

/**
 * 교직원 검색 자동완성 입력 컴포넌트 (업로드 매칭 모달 및 인라인 편집용)
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

  useEffect(() => {
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

export default function HoursPlanTab({ activeTermId, periodsPerDay = 7 }: HoursPlanTabProps) {
  const { userData } = useAuth();
  const domain = userData?.domain || userData?.email?.split("@")[1] || "hmh.or.kr";

  // 목록 및 로드 상태
  const [plans, setPlans] = useState<HoursPlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<HoursPlan | null>(null);
  const [originalRowsSnapshot, setOriginalRowsSnapshot] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 학기 목록 및 동시수업 그룹 목록
  const [terms, setTerms] = useState<Array<{ id: string; name: string }>>([]);
  const [simulGroups, setSimulGroups] = useState<SimulGroup[]>([]);
  const [cohorts, setCohorts] = useState<CurriculumCohort[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);

  // 진입 경로 / 모달 상태
  const [deriveSourceTermId, setDeriveSourceTermId] = useState<string>("");
  const [sourceTermTouched, setSourceTermTouched] = useState<boolean>(false);
  const [deriveLabel, setDeriveLabel] = useState<string>("");
  const [deriving, setDeriving] = useState(false);

  // 엑셀 업로드 관련 상태
  const [excelResult, setExcelResult] = useState<ParsedHoursResult | null>(null);
  const [teacherMappings, setTeacherMappings] = useState<Record<string, string>>({}); // teacherName -> teacherEmail
  const [excelTargetYear, setExcelTargetYear] = useState<number>(new Date().getFullYear());
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 배정표 자동 생성 모달 상태
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [pendingSubjectConfirmations, setPendingSubjectConfirmations] = useState<SubjectConfirmation[] | null>(null);

  // 필터 상태 (기본값: 1학년 선택으로 초기 렌더 행 수 축소)
  const [filterGrade, setFilterGrade] = useState<number | "all">(1);
  const [filterClassNum, setFilterClassNum] = useState<number | "all">("all");
  const [filterSearch, setFilterSearch] = useState<string>("");

  // 배정표 자동 생성 확인 목록 접기/펼치기 상태 (null이면 미처리 건수 기준 자동 판정)
  const [reviewNotesExpanded, setReviewNotesExpanded] = useState<boolean | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // 편집 표의 인라인 교사 편집 활성 행 ID (화면 전체에 select 최대 1개만 마운트)
  const [editingTeacherRowId, setEditingTeacherRowId] = useState<string | null>(null);

  // 1. 초기 데이터 로드 (계획 목록, 학기 목록, 교사 목록, 동시수업 그룹, 코호트 목록)
  useEffect(() => {
    loadInitialData();
  }, [domain]);

  // 작업 대상 학기(activeTermId) 변경 시 참조 학기 우선순위(rankReferenceTerms) 1순위로 기본값 설정 (수동 변경 전일 때)
  useEffect(() => {
    if (terms.length > 0 && activeTermId && !sourceTermTouched) {
      const ranked = rankReferenceTerms(activeTermId, terms.map((t) => t.id));
      const fallback = terms.find((t) => t.id === activeTermId)?.id || terms[0]?.id || "";
      setDeriveSourceTermId(ranked[0] || fallback);
    }
  }, [activeTermId, terms, sourceTermTouched]);

  const loadInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) 계획 목록
      const resPlans = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hours_plan_list" }),
      });
      const dataPlans = await resPlans.json();
      if (resPlans.ok) {
        setPlans(dataPlans.plans || []);
        if (dataPlans.plans && dataPlans.plans.length > 0 && !selectedPlanId) {
          loadPlan(dataPlans.plans[0].id);
        }
      }

      // 2) 설정 & 학기 목록
      const resSettings = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      });
      if (resSettings.ok) {
        const dataSettings = await resSettings.json();
        const loadedTerms: Array<{ id: string; name: string }> = dataSettings.terms || [];
        setTerms(loadedTerms);
        if (!sourceTermTouched && loadedTerms.length > 0) {
          const targetTerm = activeTermId || dataSettings.settings?.activeTermId || "";
          const ranked = rankReferenceTerms(targetTerm, loadedTerms.map((t) => t.id));
          const fallback = dataSettings.settings?.activeTermId || loadedTerms[0].id;
          setDeriveSourceTermId(ranked[0] || fallback);
        }
      }

      // 3) 동시수업 그룹 목록 — termId 미명시 시 서버가 활성 학기로 대체하므로,
      // 초안 학기 편집 중에는 반드시 명시해야 한다 (term_transition_spec §2)
      const resSimul = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simul_list", ...(activeTermId ? { termId: activeTermId } : {}) }),
      });
      if (resSimul.ok) {
        const dataSimul = await resSimul.json();
        setSimulGroups(dataSimul.groups || []);
      }

      // 4) 코호트 목록
      const resCohorts = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cohort_list" }),
      });
      if (resCohorts.ok) {
        const dataCohorts = await resCohorts.json();
        setCohorts(dataCohorts.cohorts || []);
      }

      // 5) 교직원 목록 로드 (교직원 OU 한정 + users:staff 캐시)
      await loadTeachers();
    } catch (err: any) {
      setError(`데이터를 불러오는 중 오류가 발생했습니다: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // 교직원 계정 판정
  const isStaffAccount = (u: any): boolean =>
    String(u?.orgUnitPath || "").startsWith("/교직원");

  const loadTeachers = async () => {
    try {
      // 교직원 전용 캐시 키 분리
      const cached = getClientCache("users:staff");
      if (cached && Array.isArray(cached)) {
        const teacherList: TeacherOption[] = cached
          .map((u: any) => {
            const name = (u.name?.familyName || "") + (u.name?.givenName || "") || u.name?.fullName || "";
            return {
              email: (u.primaryEmail || u.email || "").toLowerCase(),
              name: name.trim() || (u.primaryEmail || "").split("@")[0],
            };
          })
          .filter((t: TeacherOption) => t.email && t.email.includes("@"));
        setTeachers(teacherList.sort((a, b) => a.name.localeCompare(b.name, "ko")));
        return;
      }

      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: ["/교직원"] }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.users && Array.isArray(data.users)) {
          // /교직원 OU만 엄격 필터링 (학생/기기 배제)
          const staffUsers = data.users.filter(isStaffAccount);
          setClientCache("users:staff", staffUsers);
          const teacherList: TeacherOption[] = staffUsers
            .map((u: any) => {
              const name = (u.name?.familyName || "") + (u.name?.givenName || "") || u.name?.fullName || "";
              return {
                email: (u.primaryEmail || u.email || "").toLowerCase(),
                name: name.trim() || (u.primaryEmail || "").split("@")[0],
              };
            })
            .filter((t: TeacherOption) => t.email && t.email.includes("@"));
          setTeachers(teacherList.sort((a, b) => a.name.localeCompare(b.name, "ko")));
        }
      }
    } catch (err) {
      console.error("교직원 목록 로드 실패:", err);
    }
  };

  const loadPlan = async (planId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hours_plan_get", planId }),
      });
      const data = await res.json();
      if (res.ok && data.plan) {
        setSelectedPlanId(planId);
        setCurrentPlan(data.plan);
        setOriginalRowsSnapshot(JSON.stringify(data.plan.rows || []));
        setPendingSubjectConfirmations(null);
      } else {
        setError(data.error || "선택한 계획을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setError(`계획 로드 오류: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // 2. 전 학기에서 가져오기 (파생)
  const handleDerive = async () => {
    if (!deriveSourceTermId) {
      alert("가져올 학기를 선택해주세요.");
      return;
    }
    setDeriving(true);
    setError(null);
    try {
      const label = deriveLabel.trim() || `${deriveSourceTermId} 기반 신학기 수업 시간`;
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hours_plan_derive",
          sourceTermId: deriveSourceTermId,
          targetTermId: activeTermId,
          planLabel: label,
        }),
      });
      const data = await res.json();
      if (res.ok && data.plan) {
        setCurrentPlan(data.plan);
        setSelectedPlanId(data.plan.id);
        setOriginalRowsSnapshot(JSON.stringify(data.plan.rows || []));
        setPendingSubjectConfirmations(null);
        setDeriveLabel("");
        const simulCount = (data.plan.rows || []).filter((r: any) => r.simulGroupId).length;
        const venueCount = (data.plan.rows || []).filter((r: any) => (r.venueHours || 0) > 0).length;
        let hintNotice = "";
        if (simulCount > 0 || venueCount > 0) {
          hintNotice = ` (동시수업 소속 ${simulCount}개 수업 · 특별실 시간 ${venueCount}개 수업을 자동 인식했습니다)`;
        }
        setSuccessMessage(`선택한 학기에서 성공적으로 가져왔습니다.${hintNotice}`);
        setTimeout(() => setSuccessMessage(null), 5000);
        // 계획 목록 갱신
        const resList = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "hours_plan_list" }),
        });
        if (resList.ok) {
          const listData = await resList.json();
          setPlans(listData.plans || []);
        }
      } else {
        setError(data.error || "학기 데이터 가져오기에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`가져오기 오류: ${err.message || String(err)}`);
    } finally {
      setDeriving(false);
    }
  };

  // 3. 엑셀 파일 선택 및 파싱
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const result = parseHoursExcel(buffer);
      setExcelResult(result);

      // 교사 자동 매칭 시도 (동명이인 판별)
      const initialMappings: Record<string, string> = {};
      for (const tName of result.distinctTeachers) {
        const matches = teachers.filter((t) => t.name === tName);
        if (matches.length === 1) {
          // 1명 정확 일치 시 자동 매칭
          initialMappings[tName] = matches[0].email;
        } else {
          // 동명이인(2명 이상) 또는 미존재(0명) 시 직접 선택하도록 빈값 처리
          initialMappings[tName] = "";
        }
      }
      setTeacherMappings(initialMappings);
      setUploadModalOpen(true);
    } catch (err: any) {
      alert(`엑셀 파일 분석 실패: ${err.message || String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 엑셀 업로드 적용
  const handleApplyUpload = () => {
    if (!excelResult) return;

    // 교육과정 고정 시간 등록부 확인
    if (cohorts.length === 0) {
      const confirmNoCohort = confirm(
        "교육과정 고정 시간 등록부가 비어 있어 창체·SLAT 시간이 추가되지 않습니다.\n\n이대로 계속 진행하시겠습니까?"
      );
      if (!confirmNoCohort) return;
    }

    // 미매칭 교사 확인
    const unmapped = excelResult.distinctTeachers.filter((tName) => !teacherMappings[tName]);
    if (unmapped.length > 0) {
      const confirmContinue = confirm(
        `다음 ${unmapped.length}명의 선생님이 아직 시스템 계정과 매칭되지 않았습니다:\n${unmapped.join(", ")}\n\n매칭되지 않은 상태로 적용하면 저장이 제한될 수 있습니다. 계속 진행하시겠습니까?`
      );
      if (!confirmContinue) return;
    }

    // 엑셀 데이터 -> HoursPlanRow 변환 (스펙 §0-1a-②': subjectName은 단축과목명 우선, 정식과목명은 neisName에 보존)
    // 단축명 충돌(같은 단축명 ↔ 여러 정식명, 실물: 체육1·체육2 모두 "체Ⅰ")이면 그 단축명은
    // 식별자로 못 쓴다 — 해당 과목만 정식명으로 식별 (같은 반·같은 교사 두 행이 합쳐지는 사고 방지)
    const shortToFull = new Map<string, Set<string>>();
    for (const pRow of excelResult.rows) {
      const s = (pRow.subjectShort || "").trim();
      const f = (pRow.subjectName || "").trim();
      if (!s || !f) continue;
      if (!shortToFull.has(s)) shortToFull.set(s, new Set());
      shortToFull.get(s)!.add(f);
    }
    const collidingShorts = new Set(
      [...shortToFull.entries()].filter(([, fulls]) => fulls.size > 1).map(([s]) => s)
    );

    const newRows: HoursPlanRow[] = [];
    for (const pRow of excelResult.rows) {
      const email = teacherMappings[pRow.teacherName] || "";
      const shortTrim = (pRow.subjectShort || "").trim();
      const effectiveSubject = (
        (shortTrim && !collidingShorts.has(shortTrim) ? shortTrim : pRow.subjectName) ||
        shortTrim ||
        ""
      ).trim();
      const shortName = (pRow.subjectShort || "").trim() || undefined;
      const neisName = (pRow.subjectName || "").trim() || undefined;

      for (const ch of pRow.classHours) {
        newRows.push({
          id: `${pRow.seq}-${ch.grade}-${ch.classNum}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          grade: ch.grade,
          classNum: ch.classNum,
          subjectName: effectiveSubject,
          subjectShort: shortName,
          neisName: neisName,
          teacherEmail: email,
          teacherName: pRow.teacherName,
          hours: ch.hours,
        });
      }
    }

    // 코호트 등록부의 고정 슬롯 함의 행 보강 (스펙 §0-1a-③ 및 cohort.ts)
    if (cohorts.length > 0 && excelResult.classList.length > 0) {
      const fixedBlocks = expandCohortFixedBlocks(cohorts, excelTargetYear, excelResult.classList);
      const impliedHours = impliedHoursFromFixedBlocks(fixedBlocks);
      for (const imp of impliedHours) {
        const virtualName = imp.teacherKey.replace(/^name:/, "");
        newRows.push({
          id: `virtual-${imp.grade}-${imp.classNum}-${imp.subjectName}-${Math.random().toString(36).slice(2, 6)}`,
          grade: imp.grade,
          classNum: imp.classNum,
          subjectName: imp.subjectName,
          teacherEmail: "", // 가상 교사
          teacherName: virtualName,
          hours: imp.hours,
        });
      }
    }

    // 학년별 기본 운영 교시수 (1~3학년 기본 7, 7, 7, 7, 6)
    const defaultGradeDayPeriods: Record<number, Record<number, number>> = {
      1: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 },
      2: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 },
      3: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 },
    };

    const newPlan: HoursPlan = {
      id: `plan-${Date.now()}`,
      label: `${excelTargetYear}학년도 신학기 선생님별 수업 시간`,
      sourceTermId: "upload",
      derivedAt: Date.now(),
      rows: newRows,
      gradeDayPeriods: defaultGradeDayPeriods,
      status: "draft",
      createdBy: userData?.email || "",
      updatedBy: userData?.email || "",
      updatedAt: Date.now(),
    };

    setCurrentPlan(newPlan);
    setSelectedPlanId(newPlan.id);
    setOriginalRowsSnapshot(JSON.stringify(newRows));
    setPendingSubjectConfirmations(null);
    setUploadModalOpen(false);
    setExcelResult(null);
    setSuccessMessage(`엑셀에서 ${newRows.length}개의 수업 시간을 성공적으로 불러왔습니다.`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  // 배정표 자동 생성 결과 적용
  const handleApplyAssignment = ({
    rows,
    targetYear,
    targetSemester,
    targetTermId,
    issues,
    subjectConfirmations,
  }: {
    rows: HoursPlanRow[];
    targetYear: number;
    targetSemester: number;
    targetTermId: string;
    issues: Array<{ severity: "error" | "notice"; text: string }>;
    subjectConfirmations: SubjectConfirmation[];
  }) => {
    const defaultGradeDayPeriods: Record<number, Record<number, number>> = {
      1: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 },
      2: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 },
      3: { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 },
    };

    const reviewNotes: HoursPlanReviewNote[] = (issues || []).map((iss) => ({
      severity: iss.severity,
      text: iss.text,
    }));

    const newPlan: HoursPlan = {
      id: `plan-${Date.now()}`,
      label: `${targetYear}학년도 ${targetSemester}학기 배정표 기반 수업 시간`,
      sourceTermId: "assignment_pdf",
      targetTermId: targetTermId || activeTermId || `${targetYear}-${targetSemester}`,
      derivedAt: Date.now(),
      rows: rows,
      gradeDayPeriods: defaultGradeDayPeriods,
      status: "draft",
      reviewNotes: reviewNotes.length > 0 ? reviewNotes : undefined,
      createdBy: userData?.email || "",
      updatedBy: userData?.email || "",
      updatedAt: Date.now(),
    };

    setCurrentPlan(newPlan);
    setSelectedPlanId(newPlan.id);
    setOriginalRowsSnapshot(JSON.stringify(rows));
    setPendingSubjectConfirmations(subjectConfirmations ?? []);
    setReviewNotesExpanded(null);
    setSuccessMessage(
      `배정표에서 ${rows.length}개의 수업 시간을 성공적으로 불러왔습니다. 확인 목록을 점검하고 우측 상단의 '💾 저장' 버튼을 눌러주세요.`
    );
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // 4. 계획 저장
  const handleSavePlan = async () => {
    if (!currentPlan) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hours_plan_save",
          planId: currentPlan.id.startsWith("plan-") ? undefined : currentPlan.id,
          planLabel: currentPlan.label,
          sourceTermId: currentPlan.sourceTermId,
          targetTermId: currentPlan.targetTermId || activeTermId,
          planRows: currentPlan.rows,
          gradeDayPeriods: currentPlan.gradeDayPeriods,
          planStatus: currentPlan.status,
          reviewNotes: currentPlan.reviewNotes,
          subjectConfirmations:
            pendingSubjectConfirmations !== null ? pendingSubjectConfirmations : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.plan) {
        setCurrentPlan(data.plan);
        setSelectedPlanId(data.plan.id);
        setOriginalRowsSnapshot(JSON.stringify(data.plan.rows || []));
        setPendingSubjectConfirmations(null);
        setSuccessMessage("선생님별 주당 수업 시간이 안전하게 저장되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);

        // 목록 갱신
        const resList = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "hours_plan_list" }),
        });
        if (resList.ok) {
          const listData = await resList.json();
          setPlans(listData.plans || []);
        }
      } else {
        setError(data.error || "저장에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`저장 오류: ${err.message || String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  // 확인 목록 항목 완료 토글 및 즉시 저장
  const handleToggleReviewNoteDone = async (noteIndex: number, done: boolean) => {
    if (!currentPlan || !currentPlan.reviewNotes) return;
    const updatedNotes: HoursPlanReviewNote[] = currentPlan.reviewNotes.map((note, idx) =>
      idx === noteIndex ? { ...note, done } : note
    );
    const updatedPlan = { ...currentPlan, reviewNotes: updatedNotes };
    setCurrentPlan(updatedPlan);

    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hours_plan_save",
          planId: currentPlan.id.startsWith("plan-") ? undefined : currentPlan.id,
          planLabel: currentPlan.label,
          sourceTermId: currentPlan.sourceTermId,
          targetTermId: currentPlan.targetTermId || activeTermId,
          planRows: currentPlan.rows,
          gradeDayPeriods: currentPlan.gradeDayPeriods,
          planStatus: currentPlan.status,
          reviewNotes: updatedNotes,
        }),
      });
      const data = await res.json();
      if (res.ok && data.plan) {
        setCurrentPlan(data.plan);
        setSelectedPlanId(data.plan.id);
        setPlans((prev) => prev.map((p) => (p.id === data.plan.id ? data.plan : p)));
      }
    } catch (err) {
      console.error("Failed to save review note status:", err);
    }
  };

  // 확인 목록 클릭 시 해당 수업으로 표 필터 이동
  const handleJumpToIssueTarget = (note: HoursPlanReviewNote) => {
    const target = parseIssueTarget(note);
    if (!target) return;
    if (target.grade !== undefined) {
      setFilterGrade(target.grade);
    } else {
      setFilterGrade("all");
    }
    if (target.classNum !== undefined) {
      setFilterClassNum(target.classNum);
    } else {
      setFilterClassNum("all");
    }
    if (target.subject) {
      setFilterSearch(target.subject);
    } else if (target.teacher) {
      setFilterSearch(target.teacher);
    } else {
      setFilterSearch("");
    }
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // 5. 계획 삭제
  const handleDeletePlan = async () => {
    if (!currentPlan || !confirm(`정말 '${currentPlan.label}' 계획을 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "hours_plan_delete",
          planId: currentPlan.id,
        }),
      });
      if (res.ok) {
        setSuccessMessage("계획이 삭제되었습니다.");
        setTimeout(() => setSuccessMessage(null), 3000);
        setCurrentPlan(null);
        setSelectedPlanId(null);
        // 목록 갱신
        const resList = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "hours_plan_list" }),
        });
        if (resList.ok) {
          const listData = await resList.json();
          setPlans(listData.plans || []);
          if (listData.plans && listData.plans.length > 0) {
            loadPlan(listData.plans[0].id);
          }
        }
      } else {
        const errData = await res.json();
        setError(errData.error || "삭제에 실패했습니다.");
      }
    } catch (err: any) {
      setError(`삭제 오류: ${err.message || String(err)}`);
    }
  };

  // 행 편집 헬퍼
  const handleRowChange = (id: string, field: keyof HoursPlanRow, value: any) => {
    if (!currentPlan) return;
    setCurrentPlan({
      ...currentPlan,
      rows: currentPlan.rows.map((r) => {
        if (r.id === id) {
          const updated = { ...r, [field]: value };
          // teacherEmail 변경 시 teacherName 스냅샷 갱신
          if (field === "teacherEmail") {
            const matched = teachers.find((t) => t.email.toLowerCase() === String(value).toLowerCase());
            updated.teacherName = matched ? matched.name : value ? String(value).split("@")[0] : "(담당 없음)";
          }
          return updated;
        }
        return r;
      }),
    });
  };

  // 행 추가
  const handleAddRow = () => {
    if (!currentPlan) return;
    const newRow: HoursPlanRow = {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      grade: filterGrade === "all" ? 1 : filterGrade,
      classNum: filterClassNum === "all" ? 1 : filterClassNum,
      subjectName: "",
      teacherEmail: teachers.length > 0 ? teachers[0].email : "",
      teacherName: teachers.length > 0 ? teachers[0].name : "",
      hours: 3,
    };
    setCurrentPlan({
      ...currentPlan,
      rows: [...currentPlan.rows, newRow],
    });
  };

  // 행 삭제
  const handleDeleteRow = (id: string) => {
    if (!currentPlan) return;
    setCurrentPlan({
      ...currentPlan,
      rows: currentPlan.rows.filter((r) => r.id !== id),
    });
  };

  // 학년별 요일별 운영 교시수 변경
  const handleGradeDayPeriodChange = (grade: number, day: number, value: number) => {
    if (!currentPlan) return;
    const gdp = { ...(currentPlan.gradeDayPeriods || {}) };
    if (!gdp[grade]) gdp[grade] = { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 };
    gdp[grade] = { ...gdp[grade], [day]: Math.max(1, Math.min(10, value)) };
    setCurrentPlan({
      ...currentPlan,
      gradeDayPeriods: gdp,
    });
  };

  // ── 변경된 행 판별 ──
  const originalRowsMap = useMemo(() => {
    if (!originalRowsSnapshot) return new Map<string, HoursPlanRow>();
    try {
      const parsed: HoursPlanRow[] = JSON.parse(originalRowsSnapshot);
      return new Map(parsed.map((r) => [r.id, r]));
    } catch {
      return new Map<string, HoursPlanRow>();
    }
  }, [originalRowsSnapshot]);

  const isRowModified = (row: HoursPlanRow) => {
    const orig = originalRowsMap.get(row.id);
    if (!orig) return true; // 신규 추가된 행
    return (
      orig.grade !== row.grade ||
      orig.classNum !== row.classNum ||
      orig.subjectName !== row.subjectName ||
      orig.teacherEmail !== row.teacherEmail ||
      orig.hours !== row.hours ||
      orig.simulGroupId !== row.simulGroupId ||
      orig.venueHours !== row.venueHours
    );
  };

  const modifiedCount = useMemo(() => {
    if (!currentPlan) return 0;
    return currentPlan.rows.filter(isRowModified).length;
  }, [currentPlan, originalRowsMap]);

  // ── 자체 점검 계산 (학급별 시수 합 vs 운영 교시수 합 비교) ──
  const { auditMismatches, auditSkippedGrades } = useMemo(() => {
    if (!currentPlan) return { auditMismatches: [], auditSkippedGrades: [] as number[] };
    const gdp = currentPlan.gradeDayPeriods || {};
    const mismatches: Array<{ grade: number; classNum: number; planSum: number; expectedSum: number }> = [];

    // "반별 합계 = 운영 교시수"는 이동수업이 없는 학년에서만 성립하는 잣대다.
    // 이동수업은 여러 반 학생이 개설 반으로 모이므로 개설 반은 크게, 보낸 반은 작게
    // 보이는 게 정상 — 일과계 수기 최종본 실측도 같은 구조였다(2026-08-16).
    // 이동수업이 얽힌 학년(등록부에 묶음이 있거나 계획에 이동수업 연결 행이 있는 학년)은
    // 검사를 걸지 않고 그 사실만 안내한다.
    const simulGrades = new Set<number>();
    for (const g of simulGroups) if ((g.classNums || []).length) simulGrades.add(g.grade);
    for (const r of currentPlan.rows) if (r.simulGroupId) simulGrades.add(r.grade);

    const classSums: Record<string, number> = {};
    for (const r of currentPlan.rows) {
      const key = `${r.grade}-${r.classNum}`;
      classSums[key] = (classSums[key] || 0) + (Number(r.hours) || 0);
    }

    for (const [key, sum] of Object.entries(classSums)) {
      const [gStr, cStr] = key.split("-");
      const g = parseInt(gStr, 10);
      const c = parseInt(cStr, 10);
      if (simulGrades.has(g)) continue;
      const gradeDays = gdp[g] || { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 };
      const expected = Object.values(gradeDays).reduce((acc, v) => acc + (Number(v) || 0), 0);
      if (expected > 0 && sum !== expected) {
        mismatches.push({ grade: g, classNum: c, planSum: sum, expectedSum: expected });
      }
    }

    return {
      auditMismatches: mismatches.sort((a, b) => a.grade - b.grade || a.classNum - b.classNum),
      auditSkippedGrades: Array.from(simulGrades).sort(),
    };
  }, [currentPlan, simulGroups]);

  // ── 필터링된 행 목록 ──
  const filteredRows = useMemo(() => {
    if (!currentPlan) return [];
    return currentPlan.rows.filter((r) => {
      if (filterGrade !== "all" && r.grade !== filterGrade) return false;
      if (filterClassNum !== "all" && r.classNum !== filterClassNum) return false;
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        const sub = (r.subjectName || "").toLowerCase();
        const sShort = (r.subjectShort || "").toLowerCase();
        const tName = (r.teacherName || "").toLowerCase();
        const tEmail = (r.teacherEmail || "").toLowerCase();
        if (!sub.includes(q) && !sShort.includes(q) && !tName.includes(q) && !tEmail.includes(q))
          return false;
      }
      return true;
    });
  }, [currentPlan, filterGrade, filterClassNum, filterSearch]);

  // 배정표 행(currentPlan.rows)에서 학년별 실존 classNum 추출
  const availableFilterClasses = useMemo(() => {
    if (!currentPlan || !Array.isArray(currentPlan.rows)) return [];
    const rows = currentPlan.rows;
    const filtered = filterGrade === "all" ? rows : rows.filter((r) => r.grade === filterGrade);
    const distinct = Array.from(
      new Set(
        filtered
          .map((r) => Number(r.classNum))
          .filter((c) => !isNaN(c) && c > 0)
      )
    ).sort((a, b) => a - b);
    return distinct;
  }, [currentPlan, filterGrade]);

  if (loading && !currentPlan) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent mb-4"></div>
        <p className="text-sm font-semibold text-gray-600">선생님별 주당 수업 시간 데이터를 불러오는 중입니다...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 안내 및 진입 경로 바 ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span>📋 선생님별 주당 수업 시간</span>
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              신학기 편성의 기초가 되는 선생님별·과목별 주당 수업 시간을 등록하고 조정합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* 1) 배정표에서 만들기 버튼 */}
            <button
              type="button"
              onClick={() => setAssignmentModalOpen(true)}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
            >
              <span>📄 배정표에서 만들기</span>
            </button>

            {/* 2) 엑셀 파일 불러오기 버튼 */}
            <label className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm cursor-pointer transition-colors flex items-center gap-1.5">
              <span>📥 엑셀 파일 불러오기</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            {/* 3) 저장된 계획 선택 드롭다운 */}
            {plans.length > 0 && (
              <select
                value={selectedPlanId || ""}
                onChange={(e) => loadPlan(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-800"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} {p.targetTermId ? `[${p.targetTermId}]` : ""} ({p.rowCount}행 · {p.status === "ready" ? "완료" : "작성 중"})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* ── 전 학기에서 가져오기 (파생 패널) ── */}
        <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-indigo-900">🔄 이전 학기에서 가져오기:</span>
            <select
              value={deriveSourceTermId}
              onChange={(e) => {
                setDeriveSourceTermId(e.target.value);
                setSourceTermTouched(true);
              }}
              className="px-2.5 py-1.5 bg-white border border-indigo-200 rounded text-gray-800 font-medium"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.id})
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="새 계획 명칭 (예: 2027-1 수업 시간)"
              value={deriveLabel}
              onChange={(e) => setDeriveLabel(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-indigo-200 rounded text-gray-800 w-48"
            />
          </div>
          <button
            onClick={handleDerive}
            disabled={deriving}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded shadow-sm transition-colors"
          >
            {deriving ? "가져오는 중..." : "가져오기"}
          </button>
        </div>
      </div>

      {/* ── 알림 배너 ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800 font-medium">
          ⚠️ {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-800 font-medium">
          ✅ {successMessage}
        </div>
      )}

      {/* ── 자체 점검: 이동수업 학년 제외 안내 ── */}
      {currentPlan && auditSkippedGrades.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[11px] text-slate-600">
          ℹ️ {auditSkippedGrades.join("·")}학년은 이동수업(여러 반이 모여 듣는 수업)이 있어 반별 합계가 34시간과 달라 보이는 게 정상입니다 — 반별 합계 검사는 이동수업이 없는 학년만 수행합니다. 시수 자체의 검증은 배정표를 불러올 때의 확인 목록이 담당합니다.
        </div>
      )}

      {/* ── 자체 점검 경고 배너 ── */}
      {auditMismatches.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-amber-950">
            <span>⚠️ 학급별 수업 시간 합계와 학년 운영 교시수가 일치하지 않는 학급이 있습니다 ({auditMismatches.length}개 반):</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {auditMismatches.map((m) => (
              <span key={`${m.grade}-${m.classNum}`} className="px-2 py-0.5 bg-amber-100/80 rounded border border-amber-300 font-mono">
                {m.grade}-{m.classNum}반: {m.planSum}시간 (운영기준 {m.expectedSum}시간)
              </span>
            ))}
          </div>
          <p className="text-[11px] text-amber-700 pt-1">
            * 시수 합계가 어긋나더라도 저장은 가능하나, 시간표 편성 전 반드시 확인하시기 바랍니다.
          </p>
        </div>
      )}

      {currentPlan && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          {/* ── 계획 메타 헤더 ── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={currentPlan.label}
                  onChange={(e) => setCurrentPlan({ ...currentPlan, label: e.target.value })}
                  className="text-base font-bold text-gray-900 border-b border-dashed border-gray-400 focus:border-indigo-600 focus:outline-none px-1 py-0.5"
                />
                <span className="text-xs text-gray-400 font-normal">
                  ({currentPlan.sourceTermId ? `${currentPlan.sourceTermId} 기반` : "신규"} · {new Date(currentPlan.derivedAt).toLocaleDateString()} 생성)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={currentPlan.status}
                onChange={(e) => setCurrentPlan({ ...currentPlan, status: e.target.value as any })}
                className="px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-xs font-bold text-gray-700"
              >
                <option value="draft">작성 중</option>
                <option value="ready">편성 준비 완료</option>
              </select>

              <button
                onClick={handleSavePlan}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                <span>💾 {saving ? "저장 중..." : "저장"}</span>
              </button>

              <button
                onClick={handleDeletePlan}
                className="px-3 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 text-xs font-bold rounded-lg transition-colors"
              >
                삭제
              </button>
            </div>
          </div>

          {/* ── 학년별 하루 교시 수 표 (부족정보 #5) ── */}
          <div className="bg-gray-50/70 border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              <span>📅 학년별 하루 교시 수 (운영 기준)</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs text-center border-collapse">
                <thead>
                  <tr className="bg-gray-100/80 text-gray-600 font-bold border-b border-gray-200">
                    <th className="px-3 py-1.5">학년</th>
                    <th className="px-3 py-1.5">월</th>
                    <th className="px-3 py-1.5">화</th>
                    <th className="px-3 py-1.5">수</th>
                    <th className="px-3 py-1.5">목</th>
                    <th className="px-3 py-1.5">금</th>
                    <th className="px-3 py-1.5 bg-indigo-50/50 text-indigo-900">주당 합계</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3].map((g) => {
                    const byDay = (currentPlan.gradeDayPeriods || {})[g] || { 1: 7, 2: 7, 3: 7, 4: 7, 5: 6 };
                    const weeklySum = [1, 2, 3, 4, 5].reduce((acc, d) => acc + (Number(byDay[d]) || 0), 0);
                    return (
                      <tr key={g} className="border-b border-gray-200/60 bg-white">
                        <td className="px-3 py-1.5 font-bold text-gray-700">{g}학년</td>
                        {[1, 2, 3, 4, 5].map((d) => (
                          <td key={d} className="px-2 py-1">
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={byDay[d] || 7}
                              onChange={(e) => handleGradeDayPeriodChange(g, d, parseInt(e.target.value, 10) || 7)}
                              className="w-12 px-1.5 py-1 text-center bg-gray-50 border border-gray-200 rounded font-mono font-bold text-xs"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-1.5 font-bold text-indigo-600 bg-indigo-50/30">
                          {weeklySum}시간
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 가져올 때 확인 목록 (reviewNotes 복기 및 출구) ── */}
          {currentPlan.reviewNotes && currentPlan.reviewNotes.length > 0 && (() => {
            const unprocessedCount = currentPlan.reviewNotes.filter((n) => !n.done).length;
            const isPanelOpen = reviewNotesExpanded !== null ? reviewNotesExpanded : unprocessedCount > 0;

            return (
              <div className="bg-slate-50 border border-slate-300 rounded-xl overflow-hidden shadow-xs">
                <div
                  onClick={() => setReviewNotesExpanded(!isPanelOpen)}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200/70 cursor-pointer flex items-center justify-between transition-colors select-none"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <span>📋 가져올 때 확인 목록</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          unprocessedCount > 0
                            ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        미처리 {unprocessedCount}건 / 전체 {currentPlan.reviewNotes.length}건
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-500 hidden sm:inline">
                      — 배정표 자동 생성 시 발견된 점검 사항입니다. 항목을 클릭하면 해당 수업으로 이동합니다.
                    </span>
                  </div>
                  <span className="text-xs text-slate-600 font-bold">
                    {isPanelOpen ? "▲ 접기" : "▼ 펼치기"}
                  </span>
                </div>

                {isPanelOpen && (
                  <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto divide-y divide-slate-100 bg-white">
                    {currentPlan.reviewNotes.map((note, idx) => {
                      const target = parseIssueTarget(note);
                      const isError = note.severity === "error";

                      return (
                        <div
                          key={idx}
                          className={`pt-1.5 first:pt-0 p-2 rounded-lg flex items-start justify-between gap-3 text-xs transition-colors ${
                            note.done
                              ? "bg-gray-50/60 opacity-60"
                              : isError
                              ? "bg-amber-50/70 border border-amber-200 hover:bg-amber-100/50"
                              : "bg-slate-50/70 border border-slate-200 hover:bg-slate-100/50"
                          }`}
                        >
                          <div className="flex items-start gap-2.5 flex-1 min-w-0">
                            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={!!note.done}
                                onChange={(e) => handleToggleReviewNoteDone(idx, e.target.checked)}
                                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                              />
                              <span className="text-[11px] text-gray-500 select-none">
                                {note.done ? "완료됨" : "확인"}
                              </span>
                            </label>

                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                isError
                                  ? "bg-amber-200 text-amber-950"
                                  : "bg-slate-200 text-slate-800"
                              }`}
                            >
                              {isError ? "살펴볼 점" : "확인"}
                            </span>

                            <div className="flex-1 min-w-0">
                              <span
                                onClick={() => target && handleJumpToIssueTarget(note)}
                                className={`block whitespace-normal break-words ${
                                  note.done
                                    ? "line-through text-gray-400"
                                    : isError
                                    ? "font-medium text-amber-950"
                                    : "text-slate-800"
                                } ${target ? "cursor-pointer hover:underline" : ""}`}
                              >
                                {note.text}
                              </span>
                              {!note.done && issueGuidance(note.text) && (
                                <p className="mt-1 text-[11px] leading-relaxed text-slate-500 whitespace-normal break-words">
                                  → {issueGuidance(note.text)}
                                </p>
                              )}
                            </div>
                          </div>

                          {target && (
                            <button
                              type="button"
                              onClick={() => handleJumpToIssueTarget(note)}
                              className="shrink-0 px-2 py-0.5 bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-indigo-700 font-bold rounded text-[11px] transition-colors"
                            >
                              🔍 해당 수업 확인 →
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 필터 및 작업 바 ── */}
          <div ref={tableContainerRef} className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 scroll-mt-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={filterGrade}
                onChange={(e) => {
                  const nextGrade = e.target.value === "all" ? "all" : parseInt(e.target.value, 10);
                  setFilterGrade(nextGrade);
                  if (filterClassNum !== "all" && currentPlan?.rows) {
                    const validClasses = currentPlan.rows
                      .filter((r) => nextGrade === "all" || r.grade === nextGrade)
                      .map((r) => Number(r.classNum));
                    if (!validClasses.includes(filterClassNum)) {
                      setFilterClassNum("all");
                    }
                  }
                }}
                className="px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-700 font-medium"
              >
                <option value="all">학년 전체</option>
                <option value={1}>1학년</option>
                <option value={2}>2학년</option>
                <option value={3}>3학년</option>
              </select>

              <select
                value={filterClassNum}
                onChange={(e) => setFilterClassNum(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
                className="px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-700 font-medium"
              >
                <option value="all">반 전체</option>
                {availableFilterClasses.length === 0
                  ? Array.from({ length: 12 }, (_, i) => i + 1).map((c) => (
                      <option key={c} value={c}>{c}반</option>
                    ))
                  : availableFilterClasses.map((c) => (
                      <option key={c} value={c}>{c}반</option>
                    ))}
              </select>

              <input
                type="text"
                placeholder="과목 또는 선생님 검색..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                className="px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 placeholder-gray-400 w-44"
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 font-medium">
                총 <strong className="text-gray-900">{currentPlan.rows.length}</strong>행 · 변경 <strong className="text-indigo-600">{modifiedCount}</strong>행
              </span>
              <button
                onClick={handleAddRow}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
              >
                <span>+ 행 추가</span>
              </button>
            </div>
          </div>

          {/* ── 선생님별 수업 시간 테이블 ── */}
          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-gray-100/80 text-gray-700 font-bold border-b border-gray-200">
                  <th className="px-3 py-2.5 w-20">학급</th>
                  <th className="px-3 py-2.5 min-w-[140px]">과목</th>
                  <th className="px-3 py-2.5 min-w-[200px]">선생님</th>
                  <th className="px-3 py-2.5 w-20">주당 시간</th>
                  <th className="px-3 py-2.5 min-w-[140px]">동시수업</th>
                  <th className="px-3 py-2.5 min-w-[110px]">특별실</th>
                  <th className="px-3 py-2.5 w-16 text-center">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredRows.map((row) => {
                  const isVirtual = !row.teacherEmail;
                  const isModified = isRowModified(row);
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        isVirtual
                          ? "bg-gray-50/90 text-gray-500"
                          : isModified
                          ? "bg-indigo-50/40 hover:bg-indigo-50/60"
                          : "hover:bg-gray-50/60"
                      }`}
                    >
                      {/* 학급 */}
                      <td className="px-3 py-2">
                        {isVirtual ? (
                          <span className="font-bold text-gray-600">{row.grade}-{row.classNum}</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={1}
                              max={3}
                              value={row.grade}
                              onChange={(e) => handleRowChange(row.id, "grade", parseInt(e.target.value, 10) || 1)}
                              className="w-8 px-1 py-0.5 text-center bg-white border border-gray-300 rounded font-bold"
                            />
                            <span>-</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={row.classNum}
                              onChange={(e) => handleRowChange(row.id, "classNum", parseInt(e.target.value, 10) || 1)}
                              className="w-10 px-1 py-0.5 text-center bg-white border border-gray-300 rounded font-bold"
                            />
                          </div>
                        )}
                      </td>

                      {/* 과목명 */}
                      <td className="px-3 py-2">
                        {isVirtual ? (
                          <span className="font-bold text-gray-700">{row.subjectName}</span>
                        ) : (
                          <input
                            type="text"
                            value={row.subjectName}
                            onChange={(e) => handleRowChange(row.id, "subjectName", e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-gray-300 rounded font-medium text-gray-900"
                          />
                        )}
                      </td>

                      {/* 선생님 드롭다운 (활성 행 1개만 select 마운트하여 DOM 폭발 방지) */}
                      <td className="px-3 py-2">
                        {isVirtual ? (
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-[11px] font-medium">
                              (담당 없음 — {row.teacherName || "가상"})
                            </span>
                            <span className="text-[11px] text-gray-400">
                              위치는 「교육과정 고정 시간」에서 정함
                            </span>
                          </div>
                        ) : editingTeacherRowId === row.id ? (
                          <select
                            autoFocus
                            value={row.teacherEmail}
                            onBlur={() => setEditingTeacherRowId(null)}
                            onChange={(e) => {
                              handleRowChange(row.id, "teacherEmail", e.target.value);
                              setEditingTeacherRowId(null);
                            }}
                            className="w-full px-2 py-1 bg-white border-2 border-indigo-500 rounded font-medium text-gray-900 shadow-sm"
                          >
                            <option value="">(담당 없음)</option>
                            {teachers.map((t) => (
                              <option key={t.email} value={t.email}>
                                {t.name} ({t.email})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingTeacherRowId(row.id)}
                            className={`w-full text-left px-2.5 py-1 rounded border text-xs font-medium transition-colors flex items-center justify-between group ${
                              row.teacherEmail
                                ? "bg-gray-50/80 border-gray-200 text-gray-900 hover:bg-indigo-50/50 hover:border-indigo-300"
                                : "bg-red-50/50 border-red-200 text-red-600 hover:bg-red-100/50"
                            }`}
                          >
                            <span className="truncate">
                              {teachers.find((t) => t.email.toLowerCase() === (row.teacherEmail || "").toLowerCase())?.name ||
                                row.teacherName ||
                                (row.teacherEmail ? row.teacherEmail.split("@")[0] : "(선생님 선택)")}
                            </span>
                            <span className="text-[10px] text-gray-400 group-hover:text-indigo-600 ml-1">
                              ✎
                            </span>
                          </button>
                        )}
                      </td>

                      {/* 주당 시수 */}
                      <td className="px-3 py-2">
                        {isVirtual ? (
                          <span className="font-bold text-gray-700 px-2">{row.hours}</span>
                        ) : (
                          <input
                            type="number"
                            min={1}
                            max={40}
                            value={row.hours}
                            onChange={(e) => handleRowChange(row.id, "hours", parseInt(e.target.value, 10) || 1)}
                            className="w-14 px-2 py-1 bg-white border border-gray-300 rounded font-mono font-bold text-gray-900 text-center"
                          />
                        )}
                      </td>

                      {/* 동시수업 그룹 */}
                      <td className="px-3 py-2">
                        {isVirtual ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <select
                            value={row.simulGroupId || ""}
                            onChange={(e) => handleRowChange(row.id, "simulGroupId", e.target.value || null)}
                            className="w-full px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-[11px]"
                          >
                            <option value="">(해당 없음)</option>
                            {simulGroups
                              .filter((g) => g.grade === row.grade)
                              .map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.label}
                                </option>
                              ))}
                          </select>
                        )}
                      </td>

                      {/* 특별실 */}
                      <td className="px-3 py-2">
                        {isVirtual ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={row.hours}
                            placeholder="전체"
                            value={row.venueHours ?? ""}
                            onChange={(e) => {
                              const v = e.target.value === "" ? null : parseInt(e.target.value, 10);
                              handleRowChange(row.id, "venueHours", v);
                            }}
                            className="w-20 px-2 py-1 bg-white border border-gray-300 rounded text-gray-800 text-center"
                          />
                        )}
                      </td>

                      {/* 작업 */}
                      <td className="px-3 py-2 text-center">
                        {!isVirtual && (
                          <button
                            onClick={() => handleDeleteRow(row.id)}
                            className="text-gray-400 hover:text-red-600 font-bold p-1 transition-colors"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 엑셀 업로드 & 성명-이메일 매칭 모달 ── */}
      {uploadModalOpen && excelResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-gray-900">📥 선생님별 주당 수업 시간 엑셀 불러오기</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  엑셀의 교사 성명을 시스템 계정과 1:1로 매칭합니다.
                </p>
              </div>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* 무결성 검증 요약 배너 */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2 text-emerald-900 font-medium">
                <div>
                  📊 <strong>분석 완료:</strong> 총 {excelResult.rows.length}개 과목 행 · {excelResult.classList.length}개 반 · 고유 교사 {excelResult.distinctTeachers.length}명 (총 {excelResult.grandTotal}시간)
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold">적용 학년도:</span>
                  <input
                    type="number"
                    value={excelTargetYear}
                    onChange={(e) => setExcelTargetYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                    className="w-16 px-1.5 py-0.5 bg-white border border-emerald-300 rounded font-mono font-bold text-center"
                  />
                </div>
              </div>

              {excelResult.issues.length > 0 && (
                <div className="space-y-1">
                  {excelResult.issues.map((iss, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded text-xs ${
                        iss.severity === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {iss.severity === "error" ? "⛔" : "⚠️"} {iss.message}
                    </div>
                  ))}
                </div>
              )}

              {/* 교사 매칭 테이블 */}
              <div className="space-y-2">
                <h4 className="font-bold text-gray-800">선생님 성명 ↔ 시스템 계정 매칭:</h4>
                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-100 text-gray-700 font-bold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">엑셀 기재 교사명</th>
                        <th className="px-3 py-2">매칭할 시스템 계정</th>
                        <th className="px-3 py-2 text-center w-36">상태</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {excelResult.distinctTeachers.map((tName) => {
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
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
              <button
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg text-xs transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleApplyUpload}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-sm transition-colors"
              >
                매칭 적용하고 불러오기
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 배정표 자동 생성 모달 ── */}
      <AssignmentHoursModal
        isOpen={assignmentModalOpen}
        onClose={() => setAssignmentModalOpen(false)}
        activeTermId={activeTermId}
        teachers={teachers}
        cohorts={cohorts}
        onApply={handleApplyAssignment}
      />
    </div>
  );
}
