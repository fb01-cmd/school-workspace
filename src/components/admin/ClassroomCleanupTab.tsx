"use client";

import { useEffect, useState } from "react";
import HelpTip from "@/components/common/HelpTip";

interface CourseTarget {
  id: string;
  name: string;
  section?: string;
  courseState: string;
  creationTime: string | null;
  schoolYear: number;
  isTarget: boolean;
  hasYearPrefix: boolean;
  suggestedName: string;
  teacherFolder: { id: string; alternateLink: string } | null;
  calendarId: string | null;
  ownerId: string;
  isOwner: boolean;
}

interface CleanupLog {
  id: string;
  courseId: string;
  originalName: string;
  newName: string;
  calendarId?: string | null;
  driveFolderId?: string | null;
  mode?: string | null;   // "orphan" | "residual" | undefined(cleanup)
  results?: {
    rename?: { success: boolean; name?: string; error?: string };
    archive?: { success: boolean; state?: string; error?: string };
    calendar?: { success: boolean; error?: string; hiddenInsteadOfUnsubscribed?: boolean };
    drive?: { success: boolean; error?: string; targetParentFolderId?: string; originalParentFolderId?: string | null };
  };
  timestamp: string;
  restored: boolean;
}

interface ResidualCourse {
  id: string;
  name: string;
  section: string;
  courseState: string;
  creationTime: string | null;
  schoolYear: number;
  teacherFolder: { id: string } | null;
  calendarId: string | null;
  ownerId: string;
  isOwner: boolean;
  calendarResidual: boolean;
  driveResidual: boolean;
  hasResidual: boolean;
}

interface OrphanFolder {
  folderId: string;
  name: string;
  webViewLink: string;
  modifiedTime: string;
}

export default function ClassroomCleanupTab() {
  const [loading, setLoading] = useState(true);
  const [currentSchoolYear, setCurrentSchoolYear] = useState<number>(new Date().getFullYear());
  const [courses, setCourses] = useState<CourseTarget[]>([]);
  const [logs, setLogs] = useState<CleanupLog[]>([]);
  
  // Custom edited names map: courseId -> newName
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});
  // Selected course IDs for cleanup
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Ignored / Excluded course IDs (e.g. clubs)
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [subTab, setSubTab] = useState<"targets" | "logs">("targets");

  const [isSnoozed, setIsSnoozed] = useState(false);

  // 역방향 잔여 정리 상태
  const [residualCourses, setResidualCourses] = useState<ResidualCourse[]>([]);
  const [residualLoading, setResidualLoading] = useState(false);
  const [residualSearched, setResidualSearched] = useState(false);
  const [selectedResidualIds, setSelectedResidualIds] = useState<string[]>([]);
  const [executingResidual, setExecutingResidual] = useState(false);
  const [residualMessage, setResidualMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 삭제된 클래스룸 고아 드라이브 폴더 상태
  const [orphanFolders, setOrphanFolders] = useState<OrphanFolder[]>([]);
  const [selectedOrphanIds, setSelectedOrphanIds] = useState<string[]>([]);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [orphanSearched, setOrphanSearched] = useState(false);
  const [executingOrphan, setExecutingOrphan] = useState(false);
  const [orphanMessage, setOrphanMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchOrphanFolders = async () => {
    setOrphanLoading(true);
    setOrphanMessage(null);
    try {
      const res = await fetch("/api/workspace/classroom/cleanup?mode=orphan");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "고아 폴더 목록을 불러올 수 없습니다.");

      const list: OrphanFolder[] = data.folders || [];
      setOrphanFolders(list);
      setSelectedOrphanIds(list.map(f => f.folderId));
      setOrphanSearched(true);
    } catch (err: any) {
      setOrphanMessage({ type: "error", text: err.message || "고아 폴더 조회 중 오류가 발생했습니다." });
    } finally {
      setOrphanLoading(false);
    }
  };

  const handleExecuteOrphan = async () => {
    const targets = orphanFolders.filter(f => selectedOrphanIds.includes(f.folderId));
    if (targets.length === 0) {
      alert("정돈할 고아 폴더를 1개 이상 선택해 주세요.");
      return;
    }

    if (!confirm(`선택한 ${targets.length}개 고아 폴더를 '이전년도 클래스룸/삭제된 클래스룸' 아카이브로 이동하시겠습니까?`)) {
      return;
    }

    setExecutingOrphan(true);
    setOrphanMessage(null);
    try {
      const res = await fetch("/api/workspace/classroom/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_orphan",
          folderIds: targets.map(t => ({ folderId: t.folderId, name: t.name })),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const succCount = (data.results || []).filter((r: any) => r.success).length;
        setOrphanMessage({ type: "success", text: `고아 폴더 정돈 완료: ${succCount}개 성공` });
      } else {
        throw new Error(data.error || "고아 폴더 정돈 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      setOrphanMessage({ type: "error", text: err.message || "고아 폴더 정돈 실행 실패" });
    } finally {
      setExecutingOrphan(false);
      fetchOrphanFolders();
      loadData();
    }
  };

  useEffect(() => {
    // Load stored excluded IDs and snooze status from localStorage
    const savedExcludes = localStorage.getItem("classroom_cleanup_excluded_ids");
    if (savedExcludes) {
      try { setExcludedIds(JSON.parse(savedExcludes)); } catch (e) {}
    }
    const snoozeUntil = localStorage.getItem("classroom_cleanup_snooze_until");
    if (snoozeUntil && Date.now() < Number(snoozeUntil)) {
      setIsSnoozed(true);
    }
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/workspace/classroom/cleanup");
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "데이터 로드 실패");

      setCurrentSchoolYear(data.currentSchoolYear);
      const fetchedCourses: CourseTarget[] = data.courses || [];
      setCourses(fetchedCourses);

      // Initialize edited names and selected IDs for cleanup targets
      const initialNames: Record<string, string> = {};
      const initialSelected: string[] = [];

      fetchedCourses.forEach(c => {
        initialNames[c.id] = c.suggestedName;
        if (c.isTarget && c.isOwner && c.courseState !== "ARCHIVED") {
          initialSelected.push(c.id);
        }
      });

      setEditedNames(initialNames);
      setSelectedIds(initialSelected);

      // Load logs
      loadLogs();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      const res = await fetch("/api/workspace/classroom/cleanup?action=logs");
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
      }
    } catch (e) {}
  };

  const toggleExclude = (courseId: string) => {
    let next: string[];
    if (excludedIds.includes(courseId)) {
      next = excludedIds.filter(id => id !== courseId);
    } else {
      next = [...excludedIds, courseId];
      // remove from selected
      setSelectedIds(prev => prev.filter(id => id !== courseId));
    }
    setExcludedIds(next);
    localStorage.setItem("classroom_cleanup_excluded_ids", JSON.stringify(next));
  };

  const toggleSelect = (courseId: string) => {
    if (selectedIds.includes(courseId)) {
      setSelectedIds(prev => prev.filter(id => id !== courseId));
    } else {
      setSelectedIds(prev => [...prev, courseId]);
    }
  };

  const handleSnooze = () => {
    const snoozeUntil = Date.now() + 7 * 24 * 60 * 60 * 1000; // 1 week
    localStorage.setItem("classroom_cleanup_snooze_until", String(snoozeUntil));
    setIsSnoozed(true);
    setMessage({ type: "success", text: "일주일 동안 학기말 정리 알림이 일시 중단(스누즈)됩니다." });
  };

  // Run cleanup pipeline for selected courses
  const handleExecuteCleanup = async () => {
    if (selectedIds.length === 0) {
      alert("정리할 클래스룸을 1개 이상 선택해 주세요.");
      return;
    }

    if (!confirm(`선택한 ${selectedIds.length}개의 클래스룸을 학기말 보관 처리(ARCHIVED)하시겠습니까?\n(언제든지 '정리 내역' 탭에서 복원할 수 있습니다)`)) {
      return;
    }

    setSubmitting(true);
    setMessage(null);
    let fullSuccessCount = 0;
    let partialFailCount = 0;
    let failCount = 0;
    const failureMessages: string[] = [];

    for (const courseId of selectedIds) {
      const targetCourse = courses.find(c => c.id === courseId);
      if (!targetCourse) continue;

      try {
        const res = await fetch("/api/workspace/classroom/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cleanup",
            courseId: targetCourse.id,
            schoolYear: targetCourse.schoolYear,
            originalName: targetCourse.name,
            newName: editedNames[courseId] || targetCourse.suggestedName,
            calendarId: targetCourse.calendarId,
            driveFolderId: targetCourse.teacherFolder?.id,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          const results = data.pipelineResults || {};
          const failedSteps: string[] = [];

          if (results.rename && results.rename.success === false) {
            failedSteps.push(`이름변경(${results.rename.error || "실패"})`);
          }
          if (results.archive && results.archive.success === false) {
            failedSteps.push(`보관(${results.archive.error || "실패"})`);
          }
          if (results.calendar && results.calendar.success === false) {
            failedSteps.push(`캘린더 해제(${results.calendar.error || "실패"})`);
          }
          if (results.drive && results.drive.success === false) {
            failedSteps.push(`드라이브 이동(${results.drive.error || "실패"})`);
          }

          if (failedSteps.length > 0) {
            partialFailCount++;
            failureMessages.push(`[${targetCourse.name}] ${failedSteps.join(", ")}`);
          } else {
            fullSuccessCount++;
          }
        } else {
          failCount++;
          failureMessages.push(`[${targetCourse.name}] ${data.error || "서버 응답 오류"}`);
        }
      } catch (err: any) {
        failCount++;
        failureMessages.push(`[${targetCourse.name}] 네트워크 오류 (${err.message})`);
      }
    }

    setSubmitting(false);

    if (partialFailCount === 0 && failCount === 0) {
      setMessage({
        type: "success",
        text: `학기말 정리 완료: 선택한 ${fullSuccessCount}개 클래스룸이 모두 완벽하게 보관·정리되었습니다.`,
      });
    } else {
      const summaryText = `학기말 정리 완료 (완전 성공 ${fullSuccessCount}건 / 부분 실패 ${partialFailCount}건 / 실패 ${failCount}건)`;
      const detailText = failureMessages.length > 0 ? ` — 상세 사유: ${failureMessages.join(" | ")}` : "";
      // 실패가 한 건이라도 있으면 항상 error 스타일로 — 성공 배너에 실패 사유가 묻히면 이 기능의 존재 이유가 없음
      setMessage({
        type: "error",
        text: `${summaryText}${detailText}`,
      });
    }

    loadData();
  };

  // Restore an archived course
  const handleRestore = async (log: CleanupLog) => {
    const isOrphanLog = log.mode === "orphan";
    // 🟡 2 수정: orphan 모드는 클래스룸 복원이 아닌 폴더 위치 원복 — confirm 문구 분기
    const confirmMsg = isOrphanLog
      ? `'${log.originalName}' 폴더를 원래 위치(Classroom)로 되돌리시겠습니까?`
      : `'${log.newName || log.originalName}' 클래스룸을 다시 활성화(ACTIVE) 상태로 복원하시겠습니까?`;
    if (!confirm(confirmMsg)) {
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/workspace/classroom/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore",
          courseId: log.courseId,
          originalName: log.originalName,
          calendarId: log.calendarId,
          driveFolderId: log.driveFolderId,
          logId: log.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "복원 실패");

      const restoredDetails: string[] = [];
      if (data.calendarRestored) restoredDetails.push("캘린더 복원");
      if (data.driveRestored) restoredDetails.push("드라이브 위치 원복");
      const detailStr = restoredDetails.length > 0 ? ` (${restoredDetails.join(", ")})` : "";

      setMessage({ type: "success", text: `'${log.originalName}' 클래스룸이 복원되었습니다.${detailStr}` });
      loadData();
      if (residualSearched) fetchResidualCourses();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // 역방향 잔여 정리 대상 조회
  const fetchResidualCourses = async () => {
    setResidualLoading(true);
    setResidualMessage(null);
    try {
      const res = await fetch("/api/workspace/classroom/cleanup?mode=residual");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "잔여 정리 항목을 불러올 수 없습니다.");

      const list: ResidualCourse[] = data.courses || [];
      setResidualCourses(list);
      setSelectedResidualIds(list.map(c => c.id));
      setResidualSearched(true);
    } catch (err: any) {
      setResidualMessage({ type: "error", text: err.message || "잔여 정리 조회 중 오류가 발생했습니다." });
    } finally {
      setResidualLoading(false);
    }
  };

  // 역방향 잔여 정리 실행
  const handleExecuteResidual = async () => {
    const targets = residualCourses.filter(c => selectedResidualIds.includes(c.id));
    if (targets.length === 0) {
      alert("정리할 잔여 항목을 1개 이상 선택해 주세요.");
      return;
    }

    if (!confirm(`선택한 ${targets.length}개 보관 코스의 잔여물(캘린더 구독 및 드라이브 폴더)을 정리하시겠습니까?`)) {
      return;
    }

    setExecutingResidual(true);
    setResidualMessage(null);
    let successCount = 0;
    let failCount = 0;

    for (const c of targets) {
      try {
        const res = await fetch("/api/workspace/classroom/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "execute_residual",
            courseId: c.id,
            originalName: c.name,
            schoolYear: c.schoolYear,
            calendarId: c.calendarResidual ? c.calendarId : null,
            driveFolderId: c.driveResidual && c.isOwner ? c.teacherFolder?.id : null,
            isOwner: c.isOwner,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    setExecutingResidual(false);
    setResidualMessage({
      type: failCount === 0 ? "success" : "error",
      text: `잔여 정리 완료: ${successCount}개 성공${failCount > 0 ? `, ${failCount}개 실패` : ""}`,
    });

    fetchResidualCourses();
    loadData();
  };

  const targetCourses = courses.filter(c => c.isTarget && c.isOwner && !excludedIds.includes(c.id));
  const ownerCourses = courses.filter(c => c.isOwner);
  const coTeacherCourses = courses.filter(c => !c.isOwner);
  const selectableCourses = ownerCourses.filter(c => !excludedIds.includes(c.id) && c.courseState !== "ARCHIVED");

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500 font-medium">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-500 border-t-transparent mb-3"></div>
        <p>클래스룸 및 학년도 데이터를 스캔하고 있습니다...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 제목 없음 — 상단 머리줄이 「학기말 클래스룸 정리」를 띄운다.
          남은 것은 대상 학년도 표시·도움말·조작 버튼이라 다른 화면과 같은 흰 카드로 둔다. */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 rounded-full text-xs font-bold text-indigo-700 border border-indigo-200">
                📅 {currentSchoolYear}학년도 학기말 정리
              </span>
              <HelpTip title="학기말 정리 상세 안내" variant="light">
                <p>지난 학년도 클래스룸을 연도 접두어('2025 클래스명')와 함께 보관 처리하고 캘린더 구독을 정돈합니다.</p>
                <p>언제든지 '최근 정리 내역 및 복원' 탭에서 원클릭으로 복원할 수 있습니다.</p>
                <p>공동 교사는 소유 권한이 없어 직접 보관할 수 없으며, 동아리 등 정리가 불필요한 클래스룸은 '정리 제외' 버튼으로 제외할 수 있습니다.</p>
              </HelpTip>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleSnooze}
              className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold border border-gray-200 transition-colors"
            >
              ⏰ 1주일 스누즈
            </button>
            <button
              onClick={loadData}
              className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold border border-gray-200 transition-colors"
            >
              🔄 새로고침
            </button>
          </div>
        </div>
      </div>

      {/* 3-Step Cleanup Description Card */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-950 space-y-2 shadow-xs">
        <div className="font-bold text-sm text-indigo-900 flex items-center gap-1.5">
          🗂 정리는 클래스룸당 3단계로 진행됩니다
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="bg-white/80 border border-indigo-100 rounded-lg p-2.5">
            <span className="font-bold text-indigo-800 block mb-0.5">① 클래스룸 보관</span>
            <span className="text-gray-600">이름에 학년도 접두어를 붙이고 보관(ARCHIVED) 상태로 전환</span>
          </div>
          <div className="bg-white/80 border border-indigo-100 rounded-lg p-2.5">
            <span className="font-bold text-indigo-800 block mb-0.5">② 캘린더 정리</span>
            <span className="text-gray-600">클래스룸 캘린더 구독 해제 (소유 캘린더는 숨김 처리)</span>
          </div>
          <div className="bg-white/80 border border-indigo-100 rounded-lg p-2.5">
            <span className="font-bold text-indigo-800 block mb-0.5">③ 드라이브 보관 이동</span>
            <span className="text-gray-600">클래스룸 드라이브 폴더를 &quot;이전년도 클래스룸/《학년도》학년도&quot; 폴더로 이동</span>
          </div>
        </div>
        <p className="text-[11px] text-indigo-700/80 font-medium pt-0.5">
          모든 단계는 &quot;최근 정리 내역 및 복원&quot; 탭에서 되돌릴 수 있습니다.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-lg text-sm font-semibold flex justify-between items-center ${
          message.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-xs opacity-60 hover:opacity-100">✕ 닫기</button>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex border-b border-gray-200 gap-6">
        <button
          onClick={() => setSubTab("targets")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors relative ${
            subTab === "targets"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          정리 대상 클래스룸 목록
          {targetCourses.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded-full">
              {targetCourses.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setSubTab("logs")}
          className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
            subTab === "logs"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          최근 정리 내역 및 복원
          {logs.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-bold rounded-full">
              {logs.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Target Courses */}
      {subTab === "targets" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-50 p-4 rounded-xl border border-gray-200">
            <div className="text-xs text-gray-600">
              <span className="font-semibold text-gray-800">미보관 코스 중 {targetCourses.length}개</span>가 정리 대상으로 권장됩니다.
              (연도 접두어가 없는 경우 생성연도 기반으로 자동 제안됩니다)
            </div>
            <button
              onClick={handleExecuteCleanup}
              disabled={submitting || selectedIds.length === 0}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow-xs transition-all flex items-center gap-2 shrink-0 cursor-pointer"
            >
              {submitting ? "보관 처리 진행 중..." : `선택한 ${selectedIds.length}개 클래스룸 보관 실행`}
            </button>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-700">
                <thead className="bg-gray-100/80 text-xs uppercase font-bold text-gray-600 border-b border-gray-200">
                  <tr>
                    <th className="p-3.5 w-10 text-center">
                      <input
                        type="checkbox"
                        ref={el => {
                          if (el) {
                            el.indeterminate =
                              selectableCourses.some(c => selectedIds.includes(c.id)) &&
                              !selectableCourses.every(c => selectedIds.includes(c.id));
                          }
                        }}
                        checked={selectableCourses.length > 0 && selectableCourses.every(c => selectedIds.includes(c.id))}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedIds(selectableCourses.map(c => c.id));
                          } else {
                            setSelectedIds([]);
                          }
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th className="p-3.5">클래스룸 이름 (기존)</th>
                    <th className="p-3.5">보관 시 변경될 이름 (제안)</th>
                    <th className="p-3.5 w-28">생성 연도</th>
                    <th className="p-3.5 w-24">상태</th>
                    <th className="p-3.5 w-28 text-center">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ownerCourses.map(course => {
                    const isExcluded = excludedIds.includes(course.id);
                    const isSelected = selectedIds.includes(course.id);

                    return (
                      <tr
                        key={course.id}
                        className={`transition-colors ${
                          isExcluded
                            ? "bg-gray-50/60 opacity-60"
                            : course.isTarget
                            ? "bg-amber-50/30 hover:bg-amber-50/60"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="p-3.5 text-center">
                          <input
                            type="checkbox"
                            disabled={isExcluded || !course.isOwner || course.courseState === "ARCHIVED"}
                            checked={isSelected && course.courseState !== "ARCHIVED"}
                            onChange={() => toggleSelect(course.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="p-3.5 font-medium text-gray-900">
                          <div>{course.name}</div>
                          {course.section && <div className="text-xs text-gray-400 font-normal">{course.section}</div>}
                        </td>
                        <td className="p-3.5">
                          <input
                            type="text"
                            disabled={isExcluded}
                            value={editedNames[course.id] || ""}
                            onChange={e => setEditedNames({ ...editedNames, [course.id]: e.target.value })}
                            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900 bg-white"
                          />
                        </td>
                        <td className="p-3.5 text-xs text-gray-600 font-semibold">
                          {course.schoolYear}학년도
                        </td>
                        <td className="p-3.5">
                          {course.courseState === "ARCHIVED" ? (
                            <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold">
                              보관됨
                            </span>
                          ) : course.isTarget ? (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">
                              정리 권장
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-semibold">
                              현재 학년도
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExclude(course.id)}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              isExcluded
                                ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {isExcluded ? "제외 취소" : "정리 제외"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {ownerCourses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400 text-sm">
                        소유한 클래스룸 코스가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 공동 교사 코스 서브섹션 (보관 권한 없음) */}
          {coTeacherCourses.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50/50">
              <details className="group">
                <summary className="p-3.5 flex items-center justify-between font-semibold text-xs text-gray-700 cursor-pointer hover:bg-gray-100/60 select-none">
                  <div className="flex items-center gap-2">
                    <span>👥</span>
                    <span>공동 교사 코스 ({coTeacherCourses.length}개 — 보관 권한 없음, 소유 교사에게 정리 배너가 표시됩니다)</span>
                  </div>
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="border-t border-gray-200 bg-white overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-700">
                    <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-500 border-b border-gray-200">
                      <tr>
                        <th className="p-3 w-10 text-center"></th>
                        <th className="p-3">클래스룸 이름</th>
                        <th className="p-3 w-28">생성 연도</th>
                        <th className="p-3 w-24">상태</th>
                        <th className="p-3 text-right pr-4">비고</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {coTeacherCourses.map(course => (
                        <tr key={course.id} className="hover:bg-gray-50/80">
                          <td className="p-3 text-center">
                            <input type="checkbox" disabled checked={false} className="rounded border-gray-300 opacity-40 cursor-not-allowed" />
                          </td>
                          <td className="p-3 font-medium text-gray-900">
                            <div>{course.name}</div>
                            {course.section && <div className="text-xs text-gray-400 font-normal">{course.section}</div>}
                          </td>
                          <td className="p-3 text-xs text-gray-600 font-semibold">{course.schoolYear}학년도</td>
                          <td className="p-3">
                            {course.courseState === "ARCHIVED" ? (
                              <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold">보관됨</span>
                            ) : course.isTarget ? (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">정리 권장</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-semibold">현재 학년도</span>
                            )}
                          </td>
                          <td className="p-3 text-right pr-4">
                            <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded">
                              공동 교사 (소유자만 보관 가능)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}

          {/* 보관된 클래스룸 잔여 정리 (역방향 정리) 섹션 */}
          <div className="mt-10 border-t border-gray-200 pt-6 space-y-4">
            <div className="bg-slate-900 text-white rounded-xl p-5 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-full text-xs font-bold">
                    역방향 정리
                  </span>
                  <h3 className="text-base font-bold">보관된 클래스룸 잔여 정리</h3>
                </div>
                <p className="text-xs text-slate-300">
                  교사가 클래스룸 앱에서 직접 보관해 캘린더·드라이브가 방치된 것을 찾아 정돈합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchResidualCourses}
                disabled={residualLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors shadow-xs shrink-0 cursor-pointer flex items-center gap-1.5"
              >
                {residualLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>검사 중...</span>
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    <span>잔여 정리 검사</span>
                  </>
                )}
              </button>
            </div>

            {residualMessage && (
              <div className={`p-3 rounded-lg text-xs font-semibold ${
                residualMessage.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
              }`}>
                {residualMessage.text}
              </div>
            )}

            {residualSearched && (
              <div className="space-y-3">
                {residualCourses.length === 0 ? (
                  <div className="p-8 text-center bg-white border border-gray-200 rounded-xl text-gray-500 text-xs font-medium">
                    ✅ 정리할 잔여 항목이 없습니다. (모든 보관 코스의 캘린더 및 드라이브 폴더가 완전히 정돈되었습니다)
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white space-y-3 p-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <div className="text-xs text-gray-600 font-medium">
                        탐지된 잔여 항목: <strong className="text-indigo-600 font-bold">{residualCourses.length}개</strong>
                      </div>
                      <button
                        type="button"
                        onClick={handleExecuteResidual}
                        disabled={executingResidual || selectedResidualIds.length === 0}
                        className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        {executingResidual ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>정리 중...</span>
                          </>
                        ) : (
                          <>
                            <span>🧹</span>
                            <span>선택 항목 잔여 정리 실행 ({selectedResidualIds.length}개)</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-gray-100 rounded-lg">
                      <table className="w-full text-left text-xs text-gray-700">
                        <thead className="bg-gray-50 uppercase font-bold text-gray-600 border-b border-gray-200">
                          <tr>
                            <th className="p-3 text-center w-10">
                              <input
                                type="checkbox"
                                checked={residualCourses.length > 0 && residualCourses.every(c => selectedResidualIds.includes(c.id))}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedResidualIds(residualCourses.map(c => c.id));
                                  } else {
                                    setSelectedResidualIds([]);
                                  }
                                }}
                                className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                              />
                            </th>
                            <th className="p-3">보관된 클래스룸 이름</th>
                            <th className="p-3 text-center w-24">생성 학년도</th>
                            <th className="p-3 text-center w-24">소유 권한</th>
                            <th className="p-3">잔여 상태 배지</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {residualCourses.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50">
                              <td className="p-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedResidualIds.includes(c.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedResidualIds([...selectedResidualIds, c.id]);
                                    } else {
                                      setSelectedResidualIds(selectedResidualIds.filter(id => id !== c.id));
                                    }
                                  }}
                                  className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                                />
                              </td>
                              <td className="p-3 font-semibold text-gray-900">
                                <div>{c.name} {c.section ? `(${c.section})` : ""}</div>
                              </td>
                              <td className="p-3 text-center font-mono font-medium text-gray-600">
                                {c.schoolYear}학년도
                              </td>
                              <td className="p-3 text-center">
                                {c.isOwner ? (
                                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-xs font-bold">
                                    소유자
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 border border-gray-200 rounded text-xs font-medium">
                                    공동 교사
                                  </span>
                                )}
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {c.calendarResidual && (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[11px] font-bold">
                                      📅 캘린더 구독 잔존
                                    </span>
                                  )}
                                  {c.driveResidual && (
                                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-900 border border-indigo-300 rounded text-[11px] font-bold">
                                      📁 폴더 미이동
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 삭제된 클래스룸 고아 드라이브 폴더 정리 섹션 */}
          <div className="mt-10 border-t border-gray-200 pt-6 space-y-4">
            <div className="bg-slate-900 text-white rounded-xl p-5 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-400/30 rounded-full text-xs font-bold">
                    고아 폴더 정리
                  </span>
                  <h3 className="text-base font-bold">삭제된 클래스룸 고아 폴더</h3>
                </div>
                <p className="text-xs text-slate-300">
                  교사가 클래스룸을 직접 지워 드라이브에만 남은 폴더를 찾아 &apos;이전년도 클래스룸/삭제된 클래스룸&apos;으로 옮깁니다.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchOrphanFolders}
                disabled={orphanLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors shadow-xs shrink-0 cursor-pointer flex items-center gap-1.5"
              >
                {orphanLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>검사 중...</span>
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    <span>고아 폴더 검사</span>
                  </>
                )}
              </button>
            </div>

            {orphanMessage && (
              <div className={`p-3 rounded-lg text-xs font-semibold ${
                orphanMessage.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
              }`}>
                {orphanMessage.text}
              </div>
            )}

            {orphanSearched && (
              <div className="space-y-3">
                {orphanFolders.length === 0 ? (
                  <div className="p-8 text-center bg-white border border-gray-200 rounded-xl text-gray-500 text-xs font-medium">
                    ✅ 정리할 고아 폴더가 없습니다. (Classroom 폴더 하위에 방치된 고아 드라이브 폴더가 없습니다)
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white space-y-3 p-4">
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 font-medium">
                      ⚠️ <strong>안내</strong>: 코스가 삭제되어 Classroom 폴더 아래 홀로 남은 폴더입니다. 만약 Classroom 폴더 안에 직접 만든 개인 폴더가 있다면 선택 해제해 주세요.
                    </div>

                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-1">
                      <div className="text-xs text-gray-600 font-medium">
                        탐지된 고아 폴더: <strong className="text-indigo-600 font-bold">{orphanFolders.length}개</strong>
                      </div>
                      <button
                        type="button"
                        onClick={handleExecuteOrphan}
                        disabled={executingOrphan || selectedOrphanIds.length === 0}
                        className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        {executingOrphan ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>이동 중...</span>
                          </>
                        ) : (
                          <>
                            <span>🧹</span>
                            <span>선택 항목 고아 폴더 정돈 ({selectedOrphanIds.length}개)</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-gray-100 rounded-lg">
                      <table className="w-full text-left text-xs text-gray-700">
                        <thead className="bg-gray-50 uppercase font-bold text-gray-600 border-b border-gray-200">
                          <tr>
                            <th className="p-3 text-center w-10">
                              <input
                                type="checkbox"
                                checked={orphanFolders.length > 0 && orphanFolders.every(f => selectedOrphanIds.includes(f.folderId))}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedOrphanIds(orphanFolders.map(f => f.folderId));
                                  } else {
                                    setSelectedOrphanIds([]);
                                  }
                                }}
                                className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                              />
                            </th>
                            <th className="p-3">고아 드라이브 폴더명</th>
                            <th className="p-3 text-center w-36">최종 수정일</th>
                            <th className="p-3 text-center w-24">미리보기</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {orphanFolders.map(f => (
                            <tr key={f.folderId} className="hover:bg-gray-50">
                              <td className="p-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedOrphanIds.includes(f.folderId)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedOrphanIds([...selectedOrphanIds, f.folderId]);
                                    } else {
                                      setSelectedOrphanIds(selectedOrphanIds.filter(id => id !== f.folderId));
                                    }
                                  }}
                                  className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                                />
                              </td>
                              <td className="p-3 font-semibold text-gray-900">
                                📁 {f.name}
                              </td>
                              <td className="p-3 text-center font-mono text-gray-500">
                                {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString("ko-KR") : "—"}
                              </td>
                              <td className="p-3 text-center">
                                {f.webViewLink ? (
                                  <a
                                    href={f.webViewLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-[11px] font-semibold inline-flex items-center gap-1"
                                  >
                                    <span>열기</span>
                                    <span>↗</span>
                                  </a>
                                ) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Logs & Restore */}
      {subTab === "logs" && (
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600">
            보관 처리된 클래스룸 감사 이력입니다. 필요 시 <strong>[되돌리기 (Restore)]</strong>를 클릭하여 클래스룸을 다시 활성화(ACTIVE) 상태로 원복할 수 있습니다.
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-xs bg-white">
            <table className="w-full text-left text-sm text-gray-700">
              <thead className="bg-gray-100/80 text-xs uppercase font-bold text-gray-600 border-b border-gray-200">
              <tr>
                  <th className="p-3.5">정리 일시</th>
                  <th className="p-3.5">원래 이름 / 종류</th>
                  <th className="p-3.5">보관 시 적용된 이름</th>
                  <th className="p-3.5 text-center w-28">복원 상태</th>
                  <th className="p-3.5 text-center w-28">복원 실행</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="p-3.5 text-xs text-gray-500 font-mono">
                      {new Date(log.timestamp).toLocaleString("ko-KR")}
                    </td>
                    <td className="p-3.5 font-medium text-gray-900">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{log.originalName}</span>
                        {/* 🟡 2 수정: orphan 모드 전용 배지 */}
                        {log.mode === "orphan" && (
                          <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[11px] font-bold rounded border border-orange-200">
                            고아 폴더
                          </span>
                        )}
                        {log.mode === "residual" && (
                          <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-semibold rounded border border-amber-200">
                            잔여 정리
                          </span>
                        )}
                      </div>
                      {log.results && (
                        <div className="flex flex-wrap gap-1 mt-1 text-[11px] font-medium">
                          {log.results.archive && (
                            <span className={log.results.archive.success ? "text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60" : "text-red-800 bg-red-50 px-1.5 py-0.5 rounded border border-red-200/60"}>
                              보관 {log.results.archive.success ? "성공" : "실패"}
                            </span>
                          )}
                          {log.results.calendar && (
                            <span className={log.results.calendar.success ? "text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/60" : "text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60"}>
                              캘린더 {log.results.calendar.success ? (log.results.calendar.hiddenInsteadOfUnsubscribed ? "숨김" : "해제") : "실패"}
                            </span>
                          )}
                          {log.results.drive && (
                            <span className={log.results.drive.success ? "text-purple-800 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200/60" : "text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60"}>
                              드라이브 {log.results.drive.success ? "이동" : "실패"}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3.5 text-xs font-semibold text-indigo-600">{log.newName}</td>
                    <td className="p-3.5 text-center">
                      {log.restored ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold">
                          복원 완료
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                          보관 유지 중
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={() => handleRestore(log)}
                        disabled={log.restored || submitting}
                        className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded text-xs font-bold transition-colors cursor-pointer"
                      >
                        {log.restored ? "복원됨" : "되돌리기"}
                      </button>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-400 text-sm">
                      최근 보관 정리 실행 이력이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
