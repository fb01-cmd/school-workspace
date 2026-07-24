"use client";

import { useEffect, useState } from "react";

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
  timestamp: string;
  restored: boolean;
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

  useEffect(() => {
    // Load stored excluded IDs from localStorage
    const savedExcludes = localStorage.getItem("classroom_cleanup_excluded_ids");
    if (savedExcludes) {
      try { setExcludedIds(JSON.parse(savedExcludes)); } catch (e) {}
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
        if (c.isTarget && c.isOwner) {
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
    let successCount = 0;
    let failCount = 0;

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
            originalName: targetCourse.name,
            newName: editedNames[courseId] || targetCourse.suggestedName,
            calendarId: targetCourse.calendarId,
            driveFolderId: targetCourse.teacherFolder?.id,
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

    setSubmitting(false);
    setMessage({
      type: failCount === 0 ? "success" : "error",
      text: `학기말 정리 완료: 성공 ${successCount}건 ${failCount > 0 ? `, 실패 ${failCount}건` : ""}`,
    });

    loadData();
  };

  // Restore an archived course
  const handleRestore = async (log: CleanupLog) => {
    if (!confirm(`'${log.newName || log.originalName}' 클래스룸을 다시 활성화(ACTIVE) 상태로 복원하시겠습니까?`)) {
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
          logId: log.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "복원 실패");

      setMessage({ type: "success", text: `'${log.originalName}' 클래스룸이 복원되었습니다.` });
      loadData();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const targetCourses = courses.filter(c => c.isTarget && !excludedIds.includes(c.id));

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
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-700 text-white rounded-xl p-6 shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/30 backdrop-blur-md rounded-full text-xs font-bold text-indigo-200 border border-indigo-400/30 mb-2">
              <span>📅 {currentSchoolYear}학년도 학기말 정리</span>
            </div>
            <h2 className="text-xl font-bold">클래스룸·캘린더 학기말 일괄 정리</h2>
            <p className="text-indigo-200 text-sm mt-1 max-w-2xl">
              지난 학년도 클래스룸을 연도 접두어(`2025 클래스명`)와 함께 보관 처리하고 캘린더 구독을 정돈합니다. 언제든지 원클릭으로 복원할 수 있습니다.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleSnooze}
              className="px-3.5 py-2 bg-indigo-800/80 hover:bg-indigo-700 text-indigo-100 rounded-lg text-xs font-semibold backdrop-blur border border-indigo-500/40 transition-colors"
            >
              ⏰ 1주일 스누즈
            </button>
            <button
              onClick={loadData}
              className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold backdrop-blur border border-white/20 transition-colors"
            >
              🔄 새로고침
            </button>
          </div>
        </div>
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
                        checked={selectedIds.length > 0 && selectedIds.length === targetCourses.length}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedIds(targetCourses.map(c => c.id));
                          } else {
                            setSelectedIds([]);
                          }
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
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
                  {courses.map(course => {
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
                            disabled={isExcluded || !course.isOwner}
                            checked={isSelected}
                            onChange={() => toggleSelect(course.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="p-3.5 font-medium text-gray-900">
                          <div>{course.name}</div>
                          {course.section && <div className="text-xs text-gray-400 font-normal">{course.section}</div>}
                          {!course.isOwner && (
                            <span className="inline-block px-1.5 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-semibold rounded mt-1">
                              공동 교사 (소유자만 보관 가능)
                            </span>
                          )}
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
                  {courses.length === 0 && (
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
                  <th className="p-3.5">원래 클래스룸 이름</th>
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
                    <td className="p-3.5 font-medium text-gray-900">{log.originalName}</td>
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
