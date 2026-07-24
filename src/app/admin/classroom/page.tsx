"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getClientCache } from "@/lib/cache/clientCache";

import ClassroomCleanupTab from "@/components/admin/ClassroomCleanupTab";
import ClassroomCleanupBanner from "@/components/admin/ClassroomCleanupBanner";

interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
}

interface StudentInCourse {
  profile: {
    id: string;
    name: {
      familyName: string;
      givenName: string;
    };
    emailAddress: string;
  };
}

interface SyncLog {
  id: string;
  action: string;
  courseName: string;
  sectionName?: string;
  successCount: number;
  failures: { email: string; reason: string }[];
  timestamp: string;
}

export default function ClassroomPage() {
  const { user, userData, schoolSettings } = useAuth();
  const domain = userData?.domain || "";

  // UI Modes
  const [tabMode, setTabMode] = useState<"sync" | "manage" | "logs" | "cleanup">("sync");
  const [createMode, setCreateMode] = useState<"existing" | "new">("existing");

  // Classroom States
  const [courses, setCourses] = useState<ClassroomCourse[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courseNameInput, setCourseNameInput] = useState("");
  const [sectionNameInput, setSectionNameInput] = useState("");

  // Student list in selected course (for management)
  const [courseStudents, setCourseStudents] = useState<StudentInCourse[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Student Selection Basket
  const [studentBasket, setStudentBasket] = useState<string[]>([]);
  const [autoCompleteValue, setAutoCompleteValue] = useState("");

  // Class selection for batch insert
  const [batchGrade, setBatchGrade] = useState("1");
  const [batchClass, setBatchClass] = useState("1");
  const [batchLoading, setBatchLoading] = useState(false);
  const [availableClasses, setAvailableClasses] = useState<string[]>([]);

  // Process States
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    successCount: number;
    failures: { email: string; reason: string }[];
  } | null>(null);

  // History logs
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 1. Initial Load of Courses
  useEffect(() => {
    if (!domain) return;
    loadCoursesList();
  }, [domain]);

  useEffect(() => {
    if (tabMode === "logs") {
      loadSyncLogs();
    }
  }, [tabMode]);

  // Load registered course students when selectedCourseId changes in management tab
  useEffect(() => {
    if (tabMode === "manage" && selectedCourseId) {
      loadCourseStudents(selectedCourseId);
    } else {
      setCourseStudents([]);
    }
  }, [tabMode, selectedCourseId]);

  // Dynamically compute available classes in the selected grade (respecting classCounts first, fallback to user list cache)
  useEffect(() => {
    if (!domain) return;
    const config = schoolSettings?.classCounts || {};
    
    // 1. Check if classCounts has configuration for selected grade
    if (config[batchGrade]) {
      const count = config[batchGrade];
      setAvailableClasses(Array.from({ length: count }).map((_, i) => String(i + 1)));
      return;
    }

    // 2. Fallback to scanning cache if settings are not available
    const studOUs = schoolSettings?.ouMapping?.students || {};
    const ouPath = studOUs[String(batchGrade)];
    if (!ouPath) {
      setAvailableClasses([]);
      return;
    }

    const cachedUsers = getClientCache("users:all") || [];
    // Filter users belonging to the grade's OU
    const gradeStudents = cachedUsers.filter((u: any) => {
      const userOU = u.orgUnitPath || "";
      const matchesOU = userOU.toLowerCase() === ouPath.toLowerCase();

      // Check if familyName represents a student ID structure (e.g. starts with grade)
      const familyName = (u.name?.familyName || "").trim();
      const isNumeric = /^\d+$/.test(familyName);
      const startsWithGrade = familyName.startsWith(batchGrade);

      return matchesOU && isNumeric && startsWithGrade;
    });

    // Parse class number from familyName (10203 -> "2")
    const classNumbers = gradeStudents.map((u: any) => {
      const familyName = (u.name?.familyName || "").trim();
      if (familyName.length >= 3) {
        const classStr = familyName.substring(1, 3);
        const classNum = parseInt(classStr, 10);
        return isNaN(classNum) ? null : String(classNum);
      }
      return null;
    }).filter(Boolean) as string[];

    const uniqueClasses = Array.from(new Set(classNumbers)).sort((a, b) => parseInt(a) - parseInt(b));

    // Fallback to 1..10 if no students are found or cache not ready
    if (uniqueClasses.length === 0) {
      setAvailableClasses(Array.from({ length: 10 }).map((_, i) => String(i + 1)));
    } else {
      setAvailableClasses(uniqueClasses);
    }
  }, [batchGrade, schoolSettings?.ouMapping?.students, schoolSettings?.classCounts, domain]);

  // Adjust selected batchClass when availableClasses change
  useEffect(() => {
    if (availableClasses.length > 0 && !availableClasses.includes(batchClass)) {
      setBatchClass(availableClasses[0]);
    }
  }, [availableClasses, batchClass]);

  const loadCoursesList = async () => {
    setLoadingCourses(true);
    setError("");
    try {
      const res = await fetch("/api/workspace/classroom?action=courses");
      const data = await res.json();
      if (res.ok) {
        setCourses(data.courses || []);
        if (data.courses?.length > 0) {
          setSelectedCourseId(data.courses[0].id);
        }
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(`수업 목록 조회 실패: ${err.message}`);
    } finally {
      setLoadingCourses(false);
    }
  };

  // loadSchoolSettings is no longer needed since it's loaded in AuthContext

  const loadCourseStudents = async (courseId: string) => {
    setLoadingStudents(true);
    setError("");
    try {
      const res = await fetch(`/api/workspace/classroom?action=students&courseId=${courseId}`);
      const data = await res.json();
      if (res.ok) {
        setCourseStudents(data.students || []);
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(`학생 목록 로드 실패: ${err.message}`);
    } finally {
      setLoadingStudents(false);
    }
  };

  const loadSyncLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch("/api/workspace/classroom?action=logs");
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to load sync logs", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Helper: lookup display info from users:all cache
  const getUserInfo = (email: string): { studentId: string; givenName: string } => {
    const cached: any[] = getClientCache("users:all") || [];
    const u = cached.find((u: any) => u.primaryEmail === email);
    if (!u) return { studentId: "", givenName: "" };
    return {
      studentId: u.name?.familyName || "",
      givenName: u.name?.givenName || "",
    };
  };

  // 2. Student Selection Management
  const handleSelectStudent = (email: string) => {
    if (!email) return;
    if (studentBasket.includes(email)) {
      alert("이미 바구니에 담긴 학생입니다.");
      return;
    }
    setStudentBasket(prev => [...prev, email]);
    setAutoCompleteValue("");
  };

  const handleRemoveFromBasket = (email: string) => {
    setStudentBasket(prev => prev.filter(e => e !== email));
  };

  const handleClearBasket = () => {
    if (confirm("바구니를 비우시겠습니까?")) {
      setStudentBasket([]);
    }
  };

  // Batch insert whole class
  const handleAddClassBatch = async () => {
    if (!domain) return;
    setBatchLoading(true);
    setError("");
    try {
      // Find the corresponding OU Path from mappings
      // Keys are stored as grade numbers: "1", "2", "3" (not "grade_1")
      const studOUs = schoolSettings?.ouMapping?.students || {};
      const ouPath = studOUs[String(batchGrade)];
      if (!ouPath) {
        throw new Error(`${batchGrade}학년의 매핑된 조직단위(OU)가 없습니다. (OU 구성 탭에서 학년별 OU를 설정해주세요)`);
      }

      // Fetch all users inside that grade OU
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          orgUnitPaths: [ouPath]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Filter students of selected class from familyName format (e.g., 10203 -> Grade 1, Class 2, Number 3)
      const allUsers = data.users || [];
      const classPattern = `${batchGrade}${String(batchClass).padStart(2, "0")}`;
      
      const classStudents = allUsers.filter((u: any) => {
        const familyName = (u.name?.familyName || "").trim();
        return familyName.startsWith(classPattern);
      }).map((u: any) => u.primaryEmail);

      if (classStudents.length === 0) {
        alert(`${batchGrade}학년 ${batchClass}반 학생을 찾을 수 없습니다. (학번이 학년/반 포맷에 맞게 입력되었는지 확인하세요)`);
        return;
      }

      // Add to queue, avoiding duplicates
      setStudentBasket(prev => {
        const next = [...prev];
        classStudents.forEach((email: string) => {
          if (!next.includes(email)) {
            next.push(email);
          }
        });
        return next;
      });

      setSuccess(`${batchGrade}학년 ${batchClass}반 학생 ${classStudents.length}명을 배정 명단에 추가했습니다.`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(`학급 일괄 로드 실패: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  // 3. Execution (Sync)
  const handleSyncSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (studentBasket.length === 0) {
      alert("배정할 대상을 1명 이상 선택해 주세요.");
      return;
    }

    setSyncing(true);
    setSyncResult(null);
    setError("");
    setSuccess("");

    try {
      const payload: any = {
        studentEmails: studentBasket
      };

      if (createMode === "new") {
        if (!courseNameInput.trim()) {
          throw new Error("새로 생성할 수업 이름을 입력해 주세요.");
        }
        payload.action = "create_and_sync";
        payload.courseName = courseNameInput.trim();
        payload.sectionName = sectionNameInput.trim();
      } else {
        if (!selectedCourseId) {
          throw new Error("배정할 기존 수업을 선택해 주세요.");
        }
        const selectedObj = courses.find(c => c.id === selectedCourseId);
        payload.action = "existing_sync";
        payload.courseId = selectedCourseId;
        payload.courseName = selectedObj?.name || "";
      }

      const res = await fetch("/api/workspace/classroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok) {
        setSyncResult({
          success: true,
          successCount: data.successCount,
          failures: data.failures || []
        });
        setSuccess("구글 클래스룸 가입 및 배정 프로세스가 즉시 완료되었습니다.");
        setStudentBasket([]); // Clear queue on success
        
        // Reset new course inputs
        setCourseNameInput("");
        setSectionNameInput("");

        // Refresh courses list if a new course was created
        if (createMode === "new") {
          loadCoursesList();
        }
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setError(`클래스룸 동기화 실패: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Remove a single student from current course (Manage Tab)
  const handleRemoveStudentFromCourse = async (studentEmail: string, studentName: string) => {
    const courseObj = courses.find(c => c.id === selectedCourseId);
    if (!courseObj) return;

    if (!confirm(`정말로 ${studentName}(${studentEmail}) 학생을\n'${courseObj.name}' 수업에서 제외하시겠습니까?`)) {
      return;
    }

    setLoadingStudents(true);
    try {
      const res = await fetch("/api/workspace/classroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_student",
          courseId: selectedCourseId,
          courseName: courseObj.name,
          studentEmail
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("학생이 수업에서 성공적으로 제외되었습니다.");
        loadCourseStudents(selectedCourseId);
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      alert(`제외 실패: ${err.message}`);
      setLoadingStudents(false);
    }
  };

  return (
    <div className="space-y-4">
      <ClassroomCleanupBanner />
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">구글 클래스룸 학생 강제 배정 (즉시 가입)</h2>
          <p className="text-gray-500 text-xs mt-1">
            학생이 개별적으로 클래스룸 초대장을 수락하는 대기 과정 없이, 교사가 실시간으로 수업을 개설하고 학생들을 즉시 강제 가입(배정)시킵니다.
          </p>
        </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          <button
            onClick={() => { setTabMode("sync"); setSyncResult(null); }}
            className={`pb-3 px-1 border-b-2 font-bold text-sm transition-all ${
              tabMode === "sync"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            🚀 수업 개설 및 강제 배정
          </button>
          <button
            onClick={() => setTabMode("manage")}
            className={`pb-3 px-1 border-b-2 font-bold text-sm transition-all ${
              tabMode === "manage"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            📋 수업 인원 관리
          </button>
          <button
            onClick={() => setTabMode("logs")}
            className={`pb-3 px-1 border-b-2 font-bold text-sm transition-all ${
              tabMode === "logs"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            📜 배정 작업 이력
          </button>
          <button
            onClick={() => setTabMode("cleanup")}
            className={`pb-3 px-1 border-b-2 font-bold text-sm transition-all ${
              tabMode === "cleanup"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            📦 학기말 일괄 정리 (보관·캘린더)
          </button>
        </nav>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-4 text-sm font-medium">
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-md p-4 text-sm font-medium">
          ✅ {success}
        </div>
      )}

      {/* Tab Content 1: SYNC & CREATE */}
      {tabMode === "sync" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Panel: Course setup & Actions */}
          <form onSubmit={handleSyncSubmit} className="lg:col-span-7 space-y-6">
            
            {/* Create Mode Toggle */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">개설 방식 선택</label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  createMode === "existing"
                    ? "border-indigo-600 bg-indigo-50/30 text-indigo-900 font-semibold"
                    : "border-gray-200 hover:bg-gray-50 text-gray-600"
                }`}>
                  <input
                    type="radio"
                    name="createMode"
                    value="existing"
                    checked={createMode === "existing"}
                    onChange={() => setCreateMode("existing")}
                    className="sr-only"
                  />
                  <span>기존 클래스룸에 배정</span>
                </label>
                <label className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  createMode === "new"
                    ? "border-indigo-600 bg-indigo-50/30 text-indigo-900 font-semibold"
                    : "border-gray-200 hover:bg-gray-50 text-gray-600"
                }`}>
                  <input
                    type="radio"
                    name="createMode"
                    value="new"
                    checked={createMode === "new"}
                    onChange={() => setCreateMode("new")}
                    className="sr-only"
                  />
                  <span>새 수업 개설하며 배정</span>
                </label>
              </div>
            </div>

            {/* Course Inputs */}
            {createMode === "new" ? (
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-3">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">새 구글 클래스룸 정보</h4>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">수업 이름 (필수)</label>
                  <input
                    type="text"
                    value={courseNameInput}
                    onChange={(e) => setCourseNameInput(e.target.value)}
                    placeholder="예: 2026학년도 1학기 2학년 물리-A"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm text-gray-900"
                    required={createMode === "new"}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">분반 이름 (선택)</label>
                  <input
                    type="text"
                    value={sectionNameInput}
                    onChange={(e) => setSectionNameInput(e.target.value)}
                    placeholder="예: 2반"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm text-gray-900"
                  />
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-2">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">내 클래스룸 목록 선택</h4>
                  <button
                    type="button"
                    onClick={loadCoursesList}
                    className="text-[11px] text-indigo-600 hover:underline"
                  >
                    🔄 동기화 새로고침
                  </button>
                </div>
                {loadingCourses ? (
                  <div className="text-xs text-gray-400 py-2">수업 목록을 불러오는 중...</div>
                ) : courses.length === 0 ? (
                  <div className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded border border-amber-200">
                    현재 구글 계정에 활성화된 클래스룸 수업이 없습니다. 새 수업 개설 모드를 이용해 주세요.
                  </div>
                ) : (
                  <select
                    value={selectedCourseId}
                    onChange={(e) => setSelectedCourseId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm text-gray-900 bg-white"
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.section ? `(${c.section})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Batch Class Load Toolbar */}
            <div className="p-4 bg-indigo-50/30 rounded-xl border border-indigo-100/50 space-y-3">
              <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wide">반별 학생 일괄 추가</h4>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <select
                    value={batchGrade}
                    onChange={(e) => setBatchGrade(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 bg-white"
                  >
                    {Array.from({ length: schoolSettings?.gradesCount || 3 }).map((_, i) => (
                      <option key={i} value={String(i + 1)}>{i + 1}학년</option>
                    ))}
                  </select>
                  <select
                    value={batchClass}
                    onChange={(e) => setBatchClass(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs text-gray-800 bg-white"
                  >
                    {availableClasses.map((cls) => (
                      <option key={cls} value={cls}>{cls}반</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddClassBatch}
                  disabled={batchLoading}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs px-3.5 py-1.5 rounded transition-all shadow-sm"
                >
                  {batchLoading ? "조회 중..." : "⚡ 배정 명단에 추가"}
                </button>
              </div>
            </div>

            {/* Individual search input */}
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">개별 학생 검색 및 추가</label>
              <AutocompleteInput
                value={autoCompleteValue}
                onChange={setAutoCompleteValue}
                onSelect={(email) => handleSelectStudent(email)}
                placeholder="추가할 학생 이름 또는 이메일 검색..."
                type="user"
                domain={domain}
              />
            </div>

            {/* Submit Trigger Button */}
            <button
              type="submit"
              disabled={syncing || studentBasket.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold py-3 px-4 rounded-lg shadow transition-all flex items-center justify-center gap-2"
            >
              {syncing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>배정 처리 중...</span>
                </>
              ) : (
                <span>🚀 클래스룸 강제 배정 즉시 실행 ({studentBasket.length}명)</span>
              )}
            </button>

            {/* Live Sync Results feedback */}
            {syncResult && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-3 animate-fadeIn">
                <h3 className="text-sm font-bold text-gray-800 border-b pb-2 flex justify-between">
                  <span>📊 동기화 실행 결과</span>
                  <span className="text-green-600 font-extrabold">성공: {syncResult.successCount}명</span>
                </h3>
                {syncResult.failures.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-red-600">❌ 가입 실패/누락자 목록 ({syncResult.failures.length}명)</p>
                    <div className="max-h-36 overflow-y-auto space-y-1 border border-red-100 bg-white rounded p-3">
                      {syncResult.failures.map((f, i) => (
                        <div key={i} className="text-xs flex justify-between font-mono">
                          <span className="text-gray-700">{f.email}</span>
                          <span className="text-red-500 font-semibold">{f.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-green-700 font-medium">🎉 배정 대기 명단에 포함된 모든 학생이 정상 배정되었습니다.</p>
                )}
              </div>
            )}
          </form>

          {/* Right Panel: Selection Basket details */}
          <div className="lg:col-span-5 space-y-4">
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-[550px]">
              <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
                <div>
                  <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">강제 배정 대기 명단</h3>
                  <p className="text-[10px] text-gray-400">강제 배정 대상 임시 버퍼</p>
                </div>
                {studentBasket.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleClearBasket}
                      className="text-[10px] text-red-600 hover:underline font-bold"
                    >
                      전체 비우기
                    </button>
                  </div>
                )}
              </div>

              {/* Basket list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-1.5 bg-white">
                {studentBasket.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 text-xs text-center py-10">
                    <p className="text-2xl mb-2">📥</p>
                    <p>대기 명단이 비어 있습니다.</p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      반별 일괄 추가나 개별 학생 검색을 이용하여 대상을 추가해 주세요.
                    </p>
                  </div>
                ) : (
                  studentBasket.map((email, idx) => {
                    const info = getUserInfo(email);
                    const hasInfo = !!(info.studentId || info.givenName);
                    return (
                      <div
                        key={email}
                        className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-150 rounded-lg text-xs hover:bg-gray-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-gray-400 font-sans flex-shrink-0">{idx + 1}</span>
                          <div className="min-w-0">
                            {hasInfo ? (
                              <>
                                <span className="font-semibold text-gray-800">
                                  {info.studentId} {info.givenName}
                                </span>
                                <span className="ml-1.5 text-[10px] text-gray-400 font-mono truncate">{email}</span>
                              </>
                            ) : (
                              <span className="font-mono text-gray-700">{email}</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFromBasket(email)}
                          className="text-red-500 hover:text-red-700 font-bold px-1.5 flex-shrink-0"
                          title="제외"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Basket summary footer */}
              <div className="bg-gray-50 px-4 py-3 border-t text-xs flex justify-between font-semibold text-gray-600">
                <span>선택된 대상</span>
                <span className="text-indigo-600 font-extrabold">{studentBasket.length} 명</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content 2: MEMBER MANAGEMENT */}
      {tabMode === "manage" && (
        <div className="space-y-6">
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
            <label className="block text-sm font-semibold text-gray-700 mb-2">학생 목록을 조회할 수업 선택</label>
            <div className="flex gap-4">
              <select
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm text-gray-900 bg-white"
              >
                {courses.length === 0 ? (
                  <option value="">개설된 수업이 없습니다.</option>
                ) : (
                  courses.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.section ? `(${c.section})` : ""}
                    </option>
                  ))
                )}
              </select>
              <button
                onClick={() => selectedCourseId && loadCourseStudents(selectedCourseId)}
                className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-4 py-2 rounded-md transition-all shadow-sm"
              >
                🔄 목록 새로고침
              </button>
            </div>
          </div>

          {/* Members Table */}
          <div>
            <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-1.5">
              <span>👥 수업 소속 멤버 목록</span>
              <span className="bg-indigo-50 text-indigo-600 text-[10px] px-2 py-0.5 rounded-full font-extrabold">
                {courseStudents.length}명 가입됨
              </span>
            </h3>

            {loadingStudents ? (
              <div className="text-center py-12 text-gray-400 text-xs">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                수업의 학생 명단을 불러오는 중...
              </div>
            ) : courseStudents.length === 0 ? (
              <div className="text-center py-16 border border-dashed rounded-xl text-gray-400 text-xs">
                <p className="text-3xl mb-2">👥</p>
                현재 수업에 등록된 학생이 없거나 데이터 로드가 필요합니다.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {courseStudents.map((s) => {
                  const fullName = `${s.profile.name.familyName} ${s.profile.name.givenName}`;
                  return (
                    <div
                      key={s.profile.id}
                      className="group relative bg-white border border-gray-200 rounded-xl p-3.5 hover:border-red-300 hover:bg-red-50/30 transition-all shadow-sm"
                    >
                      {/* Remove button top-right */}
                      <button
                        onClick={() => handleRemoveStudentFromCourse(s.profile.emailAddress, fullName)}
                        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 group-hover:text-red-500 group-hover:bg-red-100 transition-all text-sm font-bold"
                        title="수업에서 제외"
                      >
                        ×
                      </button>

                      <div className="pr-6">
                        <p className="text-[13px] font-bold text-gray-900">
                          {s.profile.name.familyName}
                          <span className="ml-1 font-semibold text-gray-700">{s.profile.name.givenName}</span>
                        </p>
                        <p className="text-[11px] font-mono text-gray-400 mt-0.5 truncate">{s.profile.emailAddress}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content 3: HISTORICAL LOGS */}
      {tabMode === "logs" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-gray-800">최근 실행한 클래스룸 배정 이력 (최대 20건)</h3>
            <button onClick={loadSyncLogs} className="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
          </div>

          {loadingLogs ? (
            <div className="text-center py-12 text-gray-400 text-xs">불러오는 중...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-xs">최근 실행한 배정 로그가 존재하지 않습니다.</div>
          ) : (
            <div className="space-y-3.5">
              {logs.map((log) => (
                <div key={log.id} className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        log.action === "CREATE_AND_SYNC" 
                          ? "bg-purple-100 text-purple-800" 
                          : "bg-blue-100 text-blue-800"
                      }`}>
                        {log.action === "CREATE_AND_SYNC" ? "신규 개설" : "기존 배정"}
                      </span>
                      <strong className="text-sm text-gray-900">{log.courseName} {log.sectionName ? `(${log.sectionName})` : ""}</strong>
                    </div>
                    <span className="text-gray-400 font-mono text-[10px]">{log.timestamp}</span>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-gray-600">
                    <div>
                      <span className="font-semibold text-gray-500">배정 완료:</span>&nbsp;
                      <span className="text-green-600 font-bold">{log.successCount}명</span>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-500">배정 에러:</span>&nbsp;
                      <span className={`${log.failures?.length > 0 ? "text-red-500 font-bold" : "text-gray-400"}`}>
                        {log.failures?.length || 0}명
                      </span>
                    </div>
                  </div>

                  {log.failures && log.failures.length > 0 && (
                    <div className="bg-white rounded border border-red-100 p-2.5 space-y-1">
                      <p className="text-[10px] font-bold text-red-600">⚠️ 일부 미가입 사유:</p>
                      <div className="max-h-24 overflow-y-auto space-y-1">
                        {log.failures.map((f, i) => (
                          <div key={i} className="text-[10px] flex justify-between font-mono">
                            <span className="text-gray-500">{f.email}</span>
                            <span className="text-red-500 font-semibold">{f.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Classroom Cleanup & Restore */}
      {tabMode === "cleanup" && <ClassroomCleanupTab />}
    </div>
    </div>
  );
}
