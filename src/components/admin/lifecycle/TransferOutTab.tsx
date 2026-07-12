"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { Btn, ErrBox } from "./shared";

interface StudentUser {
  primaryEmail: string;
  name: {
    familyName: string; // studentId (e.g. 20512)
    givenName: string;  // name (e.g. 홍길동)
  };
  orgUnitPath: string;
  suspended: boolean;
}

interface TransferOutTask {
  email: string;
  name: string;
  studentId: string;
  originalOU: string;
  originalGroups: string[];
  status: "OU_MOVED" | "SUSPENDED";
  registeredAt: any;
  suspendDueDate: any;
  deleteDueDate: any;
  suspendedAt: any;
  deletedAt: any;
}

const DEFAULT_EMAIL_SUBJECT = "[안내] 전출/자퇴로 인한 구글 워크스페이스 계정 정지 및 데이터 백업 안내";
const DEFAULT_EMAIL_BODY = `[효명고등학교 계정관리시스템]

{name}님의 전출/자퇴 처리에 따른 구글 워크스페이스 계정 정지 및 데이터 백업 안내입니다.
학교를 떠나게 됨에 따라 사용 중이던 학교 구글 워크스페이스 계정({email})이 정리될 예정입니다.

■ 계정 일시정지 예정일: {suspendDate} ({suspendGraceDays}일 후)
■ 계정 영구삭제 예정일: {deleteDate} ({deleteGraceDays}일 후)

계정이 일시정지되면 로그인 및 메일, 드라이브 등의 모든 구글 서비스 이용이 차단되므로, 정지 예정일 전까지 구글 테이크아웃 등을 통해 중요 데이터(과제, 자료 등)를 반드시 백업해 주시기 바랍니다.

백업 및 계정 이전 방법은 아래 가이드(튜토리얼)를 참고하시기 바랍니다.
- 개인 기기로 데이터 다운로드 가이드: https://www.iorad.com/player/1765417/--------------#trysteps-1
- 타 구글 계정으로 데이터 전송 가이드: https://www.iorad.com/player/1813583/GW---------------------#trysteps-1
- 구글 테이크아웃 바로가기: https://takeout.google.com

감사합니다.`;

const DEFAULT_CHAT_BODY = `📢 [효명고등학교 계정관리시스템]
{name}님의 전출/자퇴 처리에 따라 사용 중이던 학교 계정({email})이 {suspendDate}에 일시정지 및 {deleteDate}에 영구 삭제될 예정입니다. 

아래 튜토리얼 가이드를 참고하여 중요한 자료는 그 전까지 반드시 개인 기기로 다운로드하거나 타 계정으로 전송하여 백업해 주시기 바랍니다.
- 데이터 다운로드 가이드: https://www.iorad.com/player/1765417/--------------#trysteps-1
- 타 계정 전송 가이드: https://www.iorad.com/player/1813583/GW---------------------#trysteps-1
- 구글 테이크아웃: https://takeout.google.com`;

export default function TransferOutTab({ s, ud, ouList }: { s: any; ud: any; ouList: string[] }) {
  const domain = ud?.domain || "";

  const [students, setStudents] = useState<StudentUser[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentUser | null>(null);

  const [tasks, setTasks] = useState<TransferOutTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Settings states
  const [suspendGraceDays, setSuspendGraceDays] = useState<number>(7);
  const [deleteGraceDays, setDeleteGraceDays] = useState<number>(30);
  const [emailTemplateSubject, setEmailTemplateSubject] = useState<string>(DEFAULT_EMAIL_SUBJECT);
  const [emailTemplateBody, setEmailTemplateBody] = useState<string>(DEFAULT_EMAIL_BODY);
  const [chatTemplateBody, setChatTemplateBody] = useState<string>(DEFAULT_CHAT_BODY);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSettingsAccordion, setShowSettingsAccordion] = useState(false);

  // Load students and active tasks
  const loadData = async () => {
    if (!domain) return;
    setLoadingTasks(true);
    setErr("");
    try {
      // 1. Fetch active transfer out tasks from Firestore
      const tasksCol = collection(db, "transfer_out_tasks", domain, "students");
      const snap = await getDocs(tasksCol);
      // DELETED 상태는 감사 로그에 기록되므로 여기서는 표시 안 함 (레거시 데이터 포함)
      const taskList = snap.docs
        .map((doc) => doc.data() as TransferOutTask)
        .filter((t) => (t.status as string) !== "DELETED");
      
      // Sort tasks: SUSPENDED first (closer to deletion), then OU_MOVED, then by registration date descending
      taskList.sort((a, b) => {
        if (a.status !== b.status) {
          if (a.status === "SUSPENDED") return -1;
          if (b.status === "SUSPENDED") return 1;
        }
        const timeA = a.registeredAt?.toDate ? a.registeredAt.toDate().getTime() : new Date(a.registeredAt).getTime();
        const timeB = b.registeredAt?.toDate ? b.registeredAt.toDate().getTime() : new Date(b.registeredAt).getTime();
        return timeB - timeA;
      });
      setTasks(taskList);

      // 2. Fetch settings from Firestore
      const settingsSnap = await getDoc(doc(db, "settings", domain));
      if (settingsSnap.exists()) {
        const sData = settingsSnap.data();
        if (sData.transferOutSettings) {
          setSuspendGraceDays(sData.transferOutSettings.suspendGraceDays ?? 7);
          setDeleteGraceDays(sData.transferOutSettings.deleteGraceDays ?? 30);
          setEmailTemplateSubject(sData.transferOutSettings.emailTemplateSubject || "[안내] 전출/자퇴로 인한 구글 워크스페이스 계정 정지 및 데이터 백업 안내");
          setEmailTemplateBody(sData.transferOutSettings.emailTemplateBody ?? "");
          setChatTemplateBody(sData.transferOutSettings.chatTemplateBody ?? "");
        }
      }
    } catch (e: any) {
      setErr(`데이터 조회를 실패했습니다: ${e.message}`);
    } finally {
      setLoadingTasks(false);
    }
  };

  const loadStudentList = async () => {
    if (ouList.length === 0) return;
    setLoadingStudents(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", orgUnitPaths: ouList }),
      });
      const data = await res.json();
      if (res.ok) {
        setStudents(data.users || []);
      } else {
        throw new Error(data.error || "학생 목록 로드 실패");
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoadingStudents(false);
    }
  };

  useEffect(() => {
    loadData();
    loadStudentList();
  }, [domain, JSON.stringify(ouList)]);

  // Filter students based on search query
  const filteredStudents = searchQuery.trim() === ""
    ? []
    : students.filter((st) => {
        const query = searchQuery.toLowerCase();
        const fullName = `${st.name.familyName || ""}${st.name.givenName || ""}`.toLowerCase();
        const givenName = (st.name.givenName || "").toLowerCase();
        const familyName = (st.name.familyName || "").toLowerCase(); // Student ID
        const email = st.primaryEmail.toLowerCase();
        
        return fullName.includes(query) || givenName.includes(query) || familyName.includes(query) || email.includes(query);
      });

  // Call API for Transfer Out Lifecycle Actions
  const handleLifecycleAction = async (action: string, targetEmail: string, studentName?: string, studentId?: string, originalOU?: string) => {
    if (!confirm(`해당 요청(${action === "register_transfer_out" ? "전출 등록 및 격리" : action === "execute_transfer_out_suspend" ? "계정 일시정지" : action === "execute_transfer_out_delete" ? "계정 영구삭제" : "계정 정상 복구"})을 정말 진행하시겠습니까?`)) {
      return;
    }

    setRunningAction(targetEmail);
    setErr("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          email: targetEmail,
          studentName,
          studentId,
          originalOU,
          operatorEmail: ud?.email,
          operatorName: ud?.displayName || ud?.email,
          domain,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`성공적으로 처리되었습니다.`);
        setSelectedStudent(null);
        setSearchQuery("");
        loadData();
        loadStudentList();
      } else {
        throw new Error(data.error || "작업 수행 실패");
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRunningAction(null);
    }
  };

  const handleSaveSettings = async () => {
    if (!domain) return;
    setSavingSettings(true);
    setErr("");
    try {
      const settingsRef = doc(db, "settings", domain);
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        await setDoc(settingsRef, {
          ...settingsSnap.data(),
          transferOutSettings: {
            suspendGraceDays,
            deleteGraceDays,
            emailTemplateSubject,
            emailTemplateBody,
            chatTemplateBody,
          },
          updatedAt: new Date(),
        });
      } else {
        await setDoc(settingsRef, {
          transferOutSettings: {
            suspendGraceDays,
            deleteGraceDays,
            emailTemplateSubject,
            emailTemplateBody,
            chatTemplateBody,
          },
          updatedAt: new Date(),
        });
      }
      alert("설정이 성공적으로 저장되었습니다!");
    } catch (e: any) {
      setErr(`설정 저장 실패: ${e.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // Format date safely
  const formatDate = (ts: any) => {
    if (!ts) return "-";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get countdown string
  const getDDay = (ts: any) => {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
      return `D-${diffDays}`;
    } else if (diffDays === 0) {
      return "D-Day";
    } else {
      return `만료 (${Math.abs(diffDays)}일 경과)`;
    }
  };

  return (
    <div className="space-y-6">
      {/* Description Panel */}
      <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-900 leading-relaxed shadow-sm">
        <p className="font-bold text-sm mb-1 flex items-center gap-1.5">
          🚪 전출 및 학업중단 학생 계정 관리 안내
        </p>
        <p className="mt-1">
          1. 학생이 전출 또는 학업중단 처리될 시, <strong>즉시 전출자 전용 격리 OU로 이동</strong>하고 속한 <strong>모든 학급 그룹스에서 즉시 강제 탈퇴</strong>시킵니다. (신학기 진급/그룹 작업에서 원천 차단)
        </p>
        <p>
          2. 격리 직후 학생의 메일/구글챗 등으로 데이터 다운로드(백업)를 유도하는 <strong>안내 알림이 자동으로 전송</strong>됩니다.
        </p>
        <p>
          3. 설정된 유예일수 경과 후 **일시정지**, 이후 최종적으로 **계정 영구삭제** 프로세스가 진행됩니다. (어드민 설정에서 기간/문구 커스터마이징 가능)
        </p>
      </div>

      {/* Super Admin Settings Accordion */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <button
          onClick={() => setShowSettingsAccordion(!showSettingsAccordion)}
          className="w-full px-5 py-4 flex items-center justify-between text-left font-bold text-gray-800 bg-slate-50/50 hover:bg-slate-50 transition-colors border-b border-gray-100"
        >
          <span className="flex items-center gap-2">⚙️ 전출·학업중단 고급 설정 (유예 기간 및 안내 템플릿)</span>
          <span className="text-gray-400 text-xs font-semibold">
            {showSettingsAccordion ? "접기 ▲" : "펼치기 ▼"}
          </span>
        </button>

        {showSettingsAccordion && (
          <div className="p-5 border-t border-gray-100 bg-white space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  일시정지 유예 기간
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={suspendGraceDays}
                    onChange={(e) => setSuspendGraceDays(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-20 px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 font-medium"
                  />
                  <span className="text-xs text-gray-600">일 후 계정 정지</span>
                </div>
                <span className="text-[10px] text-gray-400 mt-1 block font-medium">전출 등록 직후 계정이 정지될 때까지의 자료 백업/이전 유예 기간입니다.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  영구삭제 유예 기간
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={deleteGraceDays}
                    onChange={(e) => setDeleteGraceDays(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-20 px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 font-medium"
                  />
                  <span className="text-xs text-gray-600">일 후 계정 삭제</span>
                </div>
                <span className="text-[10px] text-gray-400 mt-1 block font-medium">계정이 정지된 시점부터 계정이 영구 삭제(Delete)될 때까지의 유예 기간입니다.</span>
              </div>
            </div>

            <hr className="border-gray-100" />

            {/* Template Editors */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-bold text-gray-800">✉️ 안내 메시지 템플릿 설정</h5>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("작성 중인 내용을 지우고 기본 안내 템플릿(튜토리얼 가이드 링크 포함)으로 초기화하시겠습니까?")) {
                      setEmailTemplateSubject(DEFAULT_EMAIL_SUBJECT);
                      setEmailTemplateBody(DEFAULT_EMAIL_BODY);
                      setChatTemplateBody(DEFAULT_CHAT_BODY);
                    }
                  }}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold"
                >
                  기본 템플릿 불러오기
                </button>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed font-medium">
                사용 가능한 치환자: <code>{"{name}"}</code> (이름), <code>{"{email}"}</code> (이메일), <code>{"{suspendDate}"}</code> (정지예정일), <code>{"{deleteDate}"}</code> (삭제예정일), <code>{"{suspendGraceDays}"}</code> (정지유예일수), <code>{"{deleteGraceDays}"}</code> (삭제유예일수)
              </p>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">안내 메일 제목</label>
                  <input
                    type="text"
                    value={emailTemplateSubject}
                    onChange={(e) => setEmailTemplateSubject(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">안내 메일 본문</label>
                  <textarea
                    rows={6}
                    value={emailTemplateBody}
                    onChange={(e) => setEmailTemplateBody(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 font-mono leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">구글 챗 알림 본문</label>
                  <textarea
                    rows={3}
                    value={chatTemplateBody}
                    onChange={(e) => setChatTemplateBody(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 font-mono leading-relaxed"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
              >
                {savingSettings ? "저장 중..." : "설정 저장하기"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Search & Register */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs space-y-4">
          <h4 className="text-sm font-bold text-gray-800">👤 대상 학생 등록 및 OU 격리</h4>
          
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">학생 이름 또는 이메일 검색</label>
            <input
              type="text"
              placeholder="예: 홍길동 또는 25001"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedStudent(null);
              }}
              className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800"
            />
          </div>

          {/* Search Result Dropdown/List */}
          {filteredStudents.length > 0 && !selectedStudent && (
            <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-100 bg-white">
              {filteredStudents.map((st) => (
                <button
                  key={st.primaryEmail}
                  onClick={() => {
                    setSelectedStudent(st);
                    setSearchQuery(`${st.name.familyName || ""} ${st.name.givenName || ""}`);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between"
                >
                  <div>
                    <span className="font-semibold text-gray-700">{st.name.givenName || "이름없음"}</span>
                    <span className="text-gray-400 ml-1.5 font-mono">({st.name.familyName || "학번없음"})</span>
                  </div>
                  <span className="text-indigo-600 font-mono text-[10px]">{st.primaryEmail}</span>
                </button>
              ))}
            </div>
          )}

          {searchQuery.trim() !== "" && filteredStudents.length === 0 && !selectedStudent && !loadingStudents && (
            <p className="text-center text-xs text-gray-400 py-2">검색 결과가 없습니다.</p>
          )}

          {loadingStudents && (
            <p className="text-center text-xs text-gray-400 py-2">학생 목록을 불러오는 중...</p>
          )}

          {/* Selected Student Details Card */}
          {selectedStudent && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs text-slate-800">
              <p className="font-bold text-indigo-700 text-center text-sm border-b border-slate-200 pb-1.5">선택된 학생 정보</p>
              <div className="grid grid-cols-3 gap-y-1 text-slate-600">
                <span className="font-semibold">이름:</span>
                <span className="col-span-2 text-slate-800 font-bold">{selectedStudent.name.givenName}</span>
                
                <span className="font-semibold">학번:</span>
                <span className="col-span-2 text-slate-800 font-mono">{selectedStudent.name.familyName}</span>
                
                <span className="font-semibold">이메일:</span>
                <span className="col-span-2 text-slate-800 font-mono">{selectedStudent.primaryEmail}</span>
                
                <span className="font-semibold">현재 OU:</span>
                <span className="col-span-2 text-slate-800 text-[10px] break-all">{selectedStudent.orgUnitPath}</span>
              </div>
              
              <div className="pt-2">
                <button
                  onClick={() => handleLifecycleAction(
                    "register_transfer_out",
                    selectedStudent.primaryEmail,
                    selectedStudent.name.givenName,
                    selectedStudent.name.familyName,
                    selectedStudent.orgUnitPath
                  )}
                  disabled={runningAction !== null}
                  className="w-full text-xs font-semibold py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {runningAction === selectedStudent.primaryEmail ? "⌛ 격리 처리 중..." : "🚪 전출/자퇴 격리 및 처리 시작"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Processing Queue (2/3 width) */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <h4 className="text-sm font-bold text-gray-800">⏳ 전출·학업중단 처리 진행 현황</h4>
            <button
              onClick={loadData}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
            >
              🔄 새로고침
            </button>
          </div>

          <ErrBox msg={err} />
          {successMsg && (
            <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-xs mb-3 font-semibold">
              ✅ {successMsg}
            </div>
          )}

          {loadingTasks ? (
            <div className="text-center py-10 text-xs text-gray-400">데이터 로딩 중...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl bg-slate-50/50">
              현재 처리 중인 전출/자퇴 학생이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-[500px]">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-50 sticky top-0 border-b border-gray-200 text-gray-700">
                  <tr>
                    <th className="px-3 py-2.5 font-bold">학생 정보</th>
                    <th className="px-3 py-2.5 font-bold">진행 상태</th>
                    <th className="px-3 py-2.5 font-bold">D-Day 및 예정일</th>
                    <th className="px-3 py-2.5 font-bold text-right">제어 동작</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {tasks.map((task) => {
                    const isTaskRunning = runningAction === task.email;
                    
                    let statusBadge = null;
                    if (task.status === "OU_MOVED") {
                      statusBadge = <span className="inline-flex px-2 py-0.5 font-bold text-[10px] rounded-full bg-blue-100 text-blue-800">OU 격리됨</span>;
                    } else if (task.status === "SUSPENDED") {
                      statusBadge = <span className="inline-flex px-2 py-0.5 font-bold text-[10px] rounded-full bg-amber-100 text-amber-800">일시정지됨</span>;
                    } else {
                      statusBadge = <span className="inline-flex px-2 py-0.5 font-bold text-[10px] rounded-full bg-gray-100 text-gray-600">영구삭제됨</span>;
                    }

                    return (
                      <tr key={task.email} className="hover:bg-slate-50/30">
                        {/* Student Info */}
                        <td className="px-3 py-3">
                          <div className="font-bold text-gray-800">
                            {task.name} <span className="font-mono text-[10px] text-gray-400">({task.studentId})</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 break-all">{task.email}</div>
                          <div className="text-[9px] text-gray-400 mt-0.5">이전 OU: {task.originalOU}</div>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-3 font-medium">
                          <div className="space-y-1">
                            <div>{statusBadge}</div>
                            <div className="text-[9px] text-gray-400">등록: {formatDate(task.registeredAt)}</div>
                          </div>
                        </td>

                        {/* D-Day & Due Dates */}
                        <td className="px-3 py-3">
                          {task.status === "OU_MOVED" && (
                            <div className="space-y-0.5">
                              <div className="font-bold text-red-600 flex items-center gap-1.5">
                                🚨 {getDDay(task.suspendDueDate)}
                              </div>
                              <div className="text-[10px] text-gray-500 font-medium">정지 예정: {formatDate(task.suspendDueDate)}</div>
                            </div>
                          )}
                          {task.status === "SUSPENDED" && (
                            <div className="space-y-0.5">
                              <div className="font-bold text-gray-700 flex items-center gap-1.5">
                                🛑 {getDDay(task.deleteDueDate)}
                              </div>
                              <div className="text-[10px] text-gray-500 font-medium">삭제 예정: {formatDate(task.deleteDueDate)}</div>
                            </div>
                          )}

                        </td>

                         {/* Actions */}
                         <td className="px-3 py-3 text-right whitespace-nowrap">
                           <div className="flex justify-end gap-1.5">
                             {task.status === "OU_MOVED" && (
                               <>
                                 <button
                                   onClick={() => handleLifecycleAction("execute_transfer_out_suspend", task.email)}
                                   disabled={isTaskRunning || runningAction !== null}
                                   className="px-2 py-1 text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-md transition-colors whitespace-nowrap"
                                 >
                                   {isTaskRunning ? "..." : "즉시 정지"}
                                 </button>
                                 <button
                                   onClick={() => handleLifecycleAction("execute_transfer_out_delete", task.email)}
                                   disabled={isTaskRunning || runningAction !== null}
                                   className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors whitespace-nowrap"
                                 >
                                   {isTaskRunning ? "..." : "즉시 삭제"}
                                 </button>
                                 <button
                                   onClick={() => handleLifecycleAction("restore_transfer_out", task.email)}
                                   disabled={isTaskRunning || runningAction !== null}
                                   className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
                                 >
                                   복구 (취소)
                                 </button>
                               </>
                             )}
                             
                             {task.status === "SUSPENDED" && (
                               <>
                                 <button
                                   onClick={() => handleLifecycleAction("execute_transfer_out_delete", task.email)}
                                   disabled={isTaskRunning || runningAction !== null}
                                   className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors animate-pulse whitespace-nowrap"
                                 >
                                   {isTaskRunning ? "..." : "즉시 삭제"}
                                 </button>
                                 <button
                                   onClick={() => handleLifecycleAction("restore_transfer_out", task.email)}
                                   disabled={isTaskRunning || runningAction !== null}
                                   className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors whitespace-nowrap"
                                 >
                                   복구 (취소)
                                 </button>
                               </>
                             )}


                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
