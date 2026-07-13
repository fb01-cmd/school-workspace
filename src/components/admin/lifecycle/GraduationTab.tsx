"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { callAPI, Btn, ErrBox } from "./shared";

interface StudentGradTask {
  email: string;
  name: string;
  studentId: string;
  originalOU: string;
  status: "PENDING" | "CONSENTED" | "SUSPENDED" | "DELETED";
  registeredAt: any;
  consentSubmitted: boolean;
  consentedAt: any;
  acknowledgedDeletion: boolean;
  acknowledgedDownload: boolean;
  suspendedAt: any;
  deletedAt: any;
  warnedCount: number;
  lastWarnedAt: any;
  isTest?: boolean;
}

const DEFAULT_EMAIL_SUBJECT = "[중요] 구글 워크스페이스 계정 삭제 사전 안내 — 안내 확인 서명이 필요합니다";

const DEFAULT_EMAIL_BODY = `안녕하세요, {name}님.

효명고등학교 구글 워크스페이스 계정 관리 시스템에서 안내드립니다.

학교에서 사용 중인 구글 계정(학교 이메일)은 학교 전체가 드라이브 용량을 공유하는 교육용 계정으로, 졸업 이후에는 해당 계정을 삭제해야 합니다. 아래 내용을 확인하고 서명을 완료해 주세요.

━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  계정 처리 예정 일정
━━━━━━━━━━━━━━━━━━━━━━━━━
  📅 계정 일시정지 예정일 : {suspendDate}
  🗑️  계정 영구 삭제 예정일 : {deleteDate}

※ 계정이 일시정지되면 구글 드라이브, Gmail, 구글 포토 등 모든 데이터에 접근할 수 없게 됩니다.

━━━━━━━━━━━━━━━━━━━━━━━━━
✅  안내 확인 서명 (필수 — 정지 예정일 이전까지 완료)
━━━━━━━━━━━━━━━━━━━━━━━━━
학교는 위 계정 삭제 일정 및 아래 데이터 이전·다운로드 방법을 학생에게 안내하였습니다.
아래 학생 포털에 접속하여 '안내 확인 서명'을 완료해 주세요.

  → {portalUrl}

이 서명은 '데이터 백업을 완료했다'는 의미가 아니라,
'학교로부터 계정 삭제 안내 및 방법을 전달받았음'을 확인하는 것입니다.

※ 계정이 정지되면 포털 접속 자체가 불가능하므로, 반드시 정지 예정일 이전에 서명해 주세요.

━━━━━━━━━━━━━━━━━━━━━━━━━
📦  데이터 이전 및 다운로드 방법
━━━━━━━━━━━━━━━━━━━━━━━━━
다른 구글 계정으로의 데이터 이전 방법과 다운로드 방법 모두 아래 가이드에 상세히 안내되어 있습니다.

  → https://gw.googleforeducation.org/관리하기/학년을-마무리-하며-할-일/졸업생을-위한-안내자료

궁금하신 점은 학교 정보부에 문의해 주세요.
감사합니다.

효명고등학교 드림`;


const DEFAULT_CHAT_BODY = `📢 *[효명고등학교 구글 계정 삭제 사전 안내]*

안녕하세요, *{name}*님.
학교 구글 계정이 아래 일정에 따라 처리될 예정입니다.

📅 *계정 일시정지 예정:* {suspendDate}
🗑️ *계정 영구삭제 예정:* {deleteDate}

━━━━━━━━━━━━━━━━━━━
⚠️ 계정이 정지되면 드라이브·Gmail·포토 등 모든 데이터에 접근할 수 없습니다.

✅ *[필수] 정지 예정일 전까지 학생 포털에서 안내 확인 서명을 완료해 주세요.*
서명은 '백업 완료' 확인이 아니라, 학교로부터 계정 삭제 안내를 받았음을 확인하는 것입니다.
계정이 정지되면 서명도 불가능합니다!

  → {portalUrl}

📦 *데이터 이전 및 다운로드 방법*
  → https://gw.googleforeducation.org/관리하기/학년을-마무리-하며-할-일/졸업생을-위한-안내자료`;


export default function GraduationTab({ s, ud }: any) {
  const domain = ud?.domain || "";

  // Data states
  const [candidates, setCandidates] = useState<StudentGradTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  
  // Settings States (Month/Day dropdown values)
  const [suspendMonth, setSuspendMonth] = useState(6);
  const [suspendDay, setSuspendDay] = useState(1);
  const [deleteMonth, setDeleteMonth] = useState(6);
  const [deleteDay, setDeleteDay] = useState(30);
  
  const [emailTemplateSubject, setEmailTemplateSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailTemplateBody, setEmailTemplateBody] = useState(DEFAULT_EMAIL_BODY);
  const [chatTemplateBody, setChatTemplateBody] = useState(DEFAULT_CHAT_BODY);
  const [savingSettings, setSavingSettings] = useState(false);

  // Simulation / Testing States
  const [mockTestDate, setMockTestDate] = useState(new Date().toISOString().split("T")[0]);
  const [runningCronTest, setRunningCronTest] = useState(false);
  const [cronTestResult, setCronTestResult] = useState<any>(null);
  const [testEmailFilter, setTestEmailFilter] = useState("test");

  // Manual Test Student Form States
  const [testStudentName, setTestStudentName] = useState("");
  const [testStudentEmail, setTestStudentEmail] = useState("");
  const [testStudentId, setTestStudentId] = useState("");
  const [addingTestStudent, setAddingTestStudent] = useState(false);


  // UI States
  const [showSettings, setShowSettings] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  // Consent Details States
  const [selectedConsent, setSelectedConsent] = useState<any>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [loadingConsent, setLoadingConsent] = useState(false);

  const handleViewSignature = async (email: string) => {
    setLoadingConsent(true);
    setErr("");
    try {
      const consentDocRef = doc(db, "graduation_consents", `${domain}_${email}`);
      const consentSnap = await getDoc(consentDocRef);
      if (consentSnap.exists()) {
        setSelectedConsent(consentSnap.data());
        setShowConsentModal(true);
      } else {
        alert("해당 학생의 서명 동의서 기록이 존재하지 않습니다.");
      }
    } catch (e: any) {
      setErr(`서명 조회 실패: ${e.message}`);
    } finally {
      setLoadingConsent(false);
    }
  };

  const loadData = async () => {
    if (!domain) return;
    setLoading(true);
    setErr("");
    try {
      // 1. Fetch graduation tasks from Firestore
      const tasksCol = collection(db, "graduation_tasks", domain, "students");
      const snap = await getDocs(tasksCol);
      const list = snap.docs.map((doc) => doc.data() as StudentGradTask);
      
      // Sort: Pending first, then Consented, then Suspended, then Deleted
      list.sort((a, b) => {
        const order = { PENDING: 0, CONSENTED: 1, SUSPENDED: 2, DELETED: 3 };
        if (order[a.status] !== order[b.status]) {
          return order[a.status] - order[b.status];
        }
        return a.studentId.localeCompare(b.studentId);
      });
      setCandidates(list);

      // 2. Fetch graduation settings from Firestore
      const settingsSnap = await getDoc(doc(db, "settings", domain));
      if (settingsSnap.exists()) {
        const sData = settingsSnap.data();
        if (sData.graduationSettings) {
          const sDate = sData.graduationSettings.suspendDate || "06-01";
          const dDate = sData.graduationSettings.deleteDate || "06-30";

          const parseMMDD = (val: string) => {
            if (!val) return { m: 6, d: 1 };
            const parts = val.split("-");
            if (parts.length === 3) { // YYYY-MM-DD
              return { m: parseInt(parts[1]) || 6, d: parseInt(parts[2]) || 1 };
            }
            if (parts.length === 2) { // MM-DD
              return { m: parseInt(parts[0]) || 6, d: parseInt(parts[1]) || 1 };
            }
            return { m: 6, d: 1 };
          };

          const susp = parseMMDD(sDate);
          setSuspendMonth(susp.m);
          setSuspendDay(susp.d);

          const del = parseMMDD(dDate);
          setDeleteMonth(del.m);
          setDeleteDay(del.d);

          setEmailTemplateSubject(sData.graduationSettings.emailTemplateSubject || DEFAULT_EMAIL_SUBJECT);
          setEmailTemplateBody(sData.graduationSettings.emailTemplateBody || DEFAULT_EMAIL_BODY);
          setChatTemplateBody(sData.graduationSettings.chatTemplateBody || DEFAULT_CHAT_BODY);
        }
      }
    } catch (e: any) {
      setErr(`데이터 조회 실패: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (domain) {
      loadData();
    }
  }, [domain]);

  const handleSaveSettings = async () => {
    if (!domain) return;
    
    // 1. 순서 검증 (영구삭제일 > 일시정지일)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const getTargetDate = (m: number, d: number) => {
      let targetYear = currentYear;
      if (currentMonth === 11 && m < 11) {
        targetYear = currentYear + 1;
      }
      const date = new Date(targetYear, m - 1, d);
      date.setHours(0, 0, 0, 0);
      return date;
    };

    const sDateObj = getTargetDate(suspendMonth, suspendDay);
    const dDateObj = getTargetDate(deleteMonth, deleteDay);

    if (dDateObj.getTime() <= sDateObj.getTime()) {
      setErr("❌ 오류: 계정 영구삭제 예정일은 일시정지 예정일보다 나중이어야 합니다.");
      return;
    }

    // 2. 과거 날짜 경고 검증
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    if (sDateObj.getTime() < todayMidnight.getTime()) {
      if (!confirm(`⚠️ 경고: 설정하신 계정 일시정지일(${suspendMonth}월 ${suspendDay}일)이 이미 지났습니다.\n\n설정을 저장하면 오늘 밤 크론 스케줄러가 작동할 때 미동의 학생들 계정이 즉시 일시정지 처리됩니다. 정말 저장하시겠습니까?`)) {
        return;
      }
    }

    if (dDateObj.getTime() < todayMidnight.getTime()) {
      if (!confirm(`⚠️ 경고: 설정하신 계정 영구삭제일(${deleteMonth}월 ${deleteDay}일)이 이미 지났습니다.\n\n설정을 저장하면 오늘 밤 크론 스케줄러가 작동할 때 대상 계정들이 즉시 영구 삭제될 수 있습니다. 정말 저장하시겠습니까?`)) {
        return;
      }
    }

    setSavingSettings(true);
    setErr("");
    setSuccess("");
    try {
      const sDateStr = `${String(suspendMonth).padStart(2, "0")}-${String(suspendDay).padStart(2, "0")}`;
      const dDateStr = `${String(deleteMonth).padStart(2, "0")}-${String(deleteDay).padStart(2, "0")}`;

      const graduationSettings = {
        suspendDate: sDateStr,
        deleteDate: dDateStr,
        emailTemplateSubject,
        emailTemplateBody,
        chatTemplateBody,
      };

      await callAPI("save_graduation_settings", { graduationSettings }, ud);
      setSuccess("설정이 성공적으로 저장되었습니다.");
      loadData();
    } catch (e: any) {
      setErr(`설정 저장 실패: ${e.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSyncCandidates = async () => {
    if (!domain) return;
    if (!confirm("구글 워크스페이스에서 3학년 및 졸업생 OU 학생들을 가져와 데이터베이스를 동기화하시겠습니까? (기존 동의 내역은 그대로 유지됩니다)")) return;
    setSyncing(true);
    setErr("");
    setSuccess("");
    try {
      const res = await callAPI("sync_graduation_candidates", {}, ud);
      if (res.success) {
        setSuccess(`동기화 완료: 신규 추가 ${res.results.added}명, 기존 유지 ${res.results.skipped}명`);
        loadData();
      }
    } catch (e: any) {
      setErr(`동기화 실패: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleClearCandidates = async () => {
    if (!confirm("⚠️ 경고: 현재 등록된 모든 일반 졸업 대상자(동기화된 학생) 목록을 데이터베이스에서 비우시겠습니까?\n\n※ 직접 수동 등록한 테스트용 학생들은 삭제되지 않고 그대로 유지됩니다. 테스트를 종료하거나 목록을 깔끔하게 초기화할 때 유용합니다.")) return;
    setSyncing(true);
    setErr("");
    setSuccess("");
    try {
      const res = await callAPI("clear_graduation_candidates", {}, ud);
      if (res.success) {
        setSuccess(`동기화된 일반 졸업 대상자 목록을 비웠습니다. (삭제된 일반 학생 수: ${res.deletedCount}명)`);
        loadData();
      }
    } catch (e: any) {
      setErr(`목록 비우기 실패: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleConsent = async (email: string, currentConsent: boolean) => {
    const nextStatus = !currentConsent;
    if (!confirm(`이 학생의 동의 상태를 수동으로 [${nextStatus ? "동의 완료" : "미동의(대기)"}] 상태로 변경하시겠습니까?`)) return;

    setRunningAction(email);
    setErr("");
    setSuccess("");
    try {
      await callAPI("toggle_student_consent", { email, consentSubmitted: nextStatus }, ud);
      setSuccess(`${email} 학생의 상태를 성공적으로 변경했습니다.`);
      loadData();
    } catch (e: any) {
      setErr(`상태 변경 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleSendIndividualWarning = async (email: string) => {
    if (!confirm(`${email} 학생에게 이메일과 구글 챗 안내 리마인더를 지금 발송하시겠습니까?`)) return;
    setRunningAction(email);
    setErr("");
    setSuccess("");
    try {
      await callAPI("send_individual_graduation_warning", { email }, ud);
      setSuccess(`${email} 학생에게 안내 리마인더가 정상적으로 전송되었습니다.`);
      loadData();
    } catch (e: any) {
      setErr(`알림 발송 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleIndividualRestore = async (email: string) => {
    if (!confirm(`${email} 학생의 계정을 활성화하고 일시정지 상태를 해제하시겠습니까?`)) return;
    setRunningAction(email);
    setErr("");
    setSuccess("");
    try {
      await callAPI("execute_individual_graduation_restore", { email }, ud);
      setSuccess(`${email} 학생 계정이 정상적으로 활성화되었습니다.`);
      loadData();
    } catch (e: any) {
      setErr(`계정 활성화 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleExecuteSuspend = async () => {
    const pendingCount = candidates.filter(c => c.status === "PENDING" || c.status === "CONSENTED").length;
    if (pendingCount === 0) {
      alert("정지 처리할 수 있는 활성 학생이 존재하지 않습니다.");
      return;
    }
    if (!confirm(`⚠️ 경고: 동의서 제출 여부와 관계없이 대상자 명단 내의 모든 활성 상태인 학생 (${pendingCount}명) 계정을 구글 워크스페이스 상에서 즉시 일시정지(Suspend)하시겠습니까?\n\n이 작업은 되돌릴 수 있지만, 학생들의 계정 접속이 즉시 차단됩니다. 계속하시겠습니까?`)) return;

    setRunningAction("global_suspend");
    setErr("");
    setSuccess("");
    try {
      const res = await callAPI("execute_graduation_suspend", {}, ud);
      setSuccess(`일괄 일시정지 완료: ${res.results.suspended}명 성공, 에러: ${res.results.errors}건`);
      loadData();
    } catch (e: any) {
      setErr(`일괄 정지 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleExecuteRestore = async () => {
    const suspendedCount = candidates.filter(c => c.status === "SUSPENDED").length;
    if (suspendedCount === 0) {
      alert("일시정지 상태인 학생이 존재하지 않습니다.");
      return;
    }
    if (!confirm(`일정 조정 등으로 인해 현재 일시정지 상태인 학생 (${suspendedCount}명)의 구글 계정을 모두 다시 활성화(정지 해제)하시겠습니까?\n\n학생들은 원래 동의 완료/미동의 상태로 복원되며, 구글 접속 권한이 정상 복구됩니다.`)) return;

    setRunningAction("global_restore");
    setErr("");
    setSuccess("");
    try {
      const res = await callAPI("execute_graduation_restore", {}, ud);
      setSuccess(`일괄 활성화 완료: ${res.results.restored}명 성공, 에러: ${res.results.errors}건`);
      loadData();
    } catch (e: any) {
      setErr(`일괄 활성화 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleExecuteDelete = async () => {
    const suspendedCount = candidates.filter(c => c.status === "SUSPENDED").length;
    if (suspendedCount === 0) {
      alert("영구 삭제 처리할 수 있는 일시정지 상태의 학생이 존재하지 않습니다.");
      return;
    }
    if (!confirm(`⚠️ 치명적 경고: 일시정지 상태인 학생 (${suspendedCount}명)의 구글 워크스페이스 계정을 영구히 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 계정의 모든 데이터(드라이브, 이메일 등)가 완전히 소멸됩니다. 정말 삭제하시겠습니까?`)) return;

    setRunningAction("global_delete");
    setErr("");
    setSuccess("");
    try {
      const res = await callAPI("execute_graduation_delete", {}, ud);
      setSuccess(`일괄 삭제 완료: ${res.results.deleted}명 성공, 에러: ${res.results.errors}건`);
      loadData();
    } catch (e: any) {
      setErr(`일괄 삭제 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };

  const handleRunCronTest = async () => {
    const filterText = testEmailFilter.trim();
    if (!filterText) {
      if (!confirm("⚠️ 주의: 테스트 이메일 필터를 지정하지 않았습니다. 이 경우 모든 실제 고3 학생 계정에 대해 시뮬레이션 및 실제 알림이 발송될 수 있습니다. 계속하시겠습니까?")) {
        return;
      }
    } else {
      if (!confirm(`지정하신 가상 날짜(${mockTestDate}) 및 이메일 필터('${filterText}') 기준 졸업생 스케줄러 시뮬레이션을 실행하시겠습니까?\n\n※ 필터에 부합하는 이메일을 가진 테스트 계정들만 시뮬레이션 대상이 되며 실제 안내 리마인더 메일/챗이 발송됩니다.`)) return;
    }

    setRunningCronTest(true);
    setErr("");
    setSuccess("");
    setCronTestResult(null);
    try {
      const res = await callAPI("test_graduation_cron", { mockToday: mockTestDate, testEmailFilter: filterText }, ud);
      if (res.success) {
        setCronTestResult(res); // API returns { success: true, ...data } directly now
        setSuccess(`가상 크론 시뮬레이션이 성공적으로 완료되었습니다.`);
        loadData();
      }
    } catch (e: any) {
      setErr(`시뮬레이션 실행 실패: ${e.message}`);
    } finally {
      setRunningCronTest(false);
    }
  };

  const handleAddTestStudent = async () => {
    if (!testStudentName.trim() || !testStudentEmail.trim()) {
      alert("테스트 학생 이름과 이메일을 모두 입력해 주세요.");
      return;
    }
    setAddingTestStudent(true);
    setErr("");
    setSuccess("");
    try {
      await callAPI("add_test_graduation_student", {
        name: testStudentName,
        email: testStudentEmail,
        studentId: testStudentId || "39999",
      }, ud);
      setSuccess(`테스트 학생 ${testStudentName} 등록이 완료되었습니다. 이메일 필터에 '${testStudentEmail}'을(를) 포함하여 안전하게 실험해 보실 수 있습니다.`);
      setTestStudentName("");
      setTestStudentEmail("");
      setTestStudentId("");
      loadData();
    } catch (e: any) {
      setErr(`테스트 학생 등록 실패: ${e.message}`);
    } finally {
      setAddingTestStudent(false);
    }
  };

  const handleDeleteTestStudent = async (email: string) => {
    if (!confirm(`${email} 테스트 학생을 목록에서 삭제하시겠습니까?`)) return;
    setRunningAction(email);
    setErr("");
    setSuccess("");
    try {
      await callAPI("delete_test_graduation_student", { email }, ud);
      setSuccess(`${email} 테스트 학생이 정상적으로 삭제되었습니다.`);
      loadData();
    } catch (e: any) {
      setErr(`테스트 학생 삭제 실패: ${e.message}`);
    } finally {
      setRunningAction(null);
    }
  };


  // Status statistics helper
  const stats = {
    total: candidates.length,
    pending: candidates.filter((c) => c.status === "PENDING").length,
    consented: candidates.filter((c) => c.status === "CONSENTED").length,
    suspended: candidates.filter((c) => c.status === "SUSPENDED").length,
    deleted: candidates.filter((c) => c.status === "DELETED").length,
  };

  const consentRate = stats.total > 0 ? Math.round((stats.consented / stats.total) * 100) : 0;

  // Filter candidates list
  const filteredCandidates = candidates.filter((c) => {
    // 1. Search Query
    const query = searchQuery.trim().toLowerCase();
    const matchesQuery = query === ""
      ? true
      : c.name.toLowerCase().includes(query) ||
        c.studentId.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query);

    // 2. Status Filter
    if (statusFilter === "ALL") return matchesQuery;
    return matchesQuery && c.status === statusFilter;
  });

  const formatDate = (ts: any) => {
    if (!ts) return "-";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
  const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

  const getSuspendDueDate = () => {
    const now = mockTestDate ? new Date(mockTestDate) : new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    let targetYear = currentYear;
    // 현재 월이 7월 이후(currentMonth > 5)이고 정지월이 7월 이전이면 → 내년
    if (currentMonth > 5 && suspendMonth - 1 <= 5) {
      targetYear = currentYear + 1;
    }
    const date = new Date(targetYear, suspendMonth - 1, suspendDay);
    date.setHours(0, 0, 0, 0);
    return date;
  };


  const getDiffDays = () => {
    const now = mockTestDate ? new Date(mockTestDate) : new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const suspendDue = getSuspendDueDate();
    return Math.ceil((suspendDue.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
  };

  const diffDays = getDiffDays();
  const showBanner = stats.pending > 0 && diffDays <= 3;

  return (
    <div className="space-y-6">
      
      {/* Title */}
      <div>
        <h3 className="text-xl font-bold text-slate-800">🏫 졸업예정자 관리 및 동의서 현황</h3>
        <p className="text-sm text-slate-500 mt-1">
          졸업생 데이터 백업 안내 동의서 수집 상태를 실시간 모니터링하고 일정에 따라 정지/삭제 생애주기를 관리합니다.
        </p>
      </div>

      {/* Suspension Warning Banner */}
      {showBanner && (
        <div className={`border p-4 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-3 ${
          diffDays < 0 
            ? "bg-rose-50 border-rose-200 text-rose-800" 
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}>
          <div className="space-y-1">
            <h4 className="font-extrabold text-sm flex items-center gap-1.5">
              <span>⚠️</span>
              {diffDays < 0 ? "[일시정지 일정 경과 알림]" : `[일시정지 D-${diffDays} 임박 안내]`}
            </h4>
            <p className="text-xs font-semibold opacity-90 leading-relaxed">
              {diffDays < 0 
                ? `설정된 계정 일시정지일(${suspendMonth}월 ${suspendDay}일)이 지났으나 아직 동의하지 않은 학생이 ${stats.pending}명 존재합니다. 이 학생들은 스케줄러에 의해 계정이 일시정지될 예정이며, 정지 후에는 포털에 접속하여 서명할 수 없습니다.`
                : `${suspendMonth}월 ${suspendDay}일에 미동의 학생(${stats.pending}명)의 구글 계정이 자동으로 일시정지됩니다. 계정이 일시정지되면 학생이 포털에 로그인하여 백업 서명을 제출할 수 없게 되므로, 필요시 일정을 연장해 주십시오.`
              }
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs shrink-0 ${
              diffDays < 0
                ? "bg-rose-600 hover:bg-rose-700 text-white"
                : "bg-amber-600 hover:bg-amber-700 text-white"
            }`}
          >
            설정 변경하러 가기
          </button>
        </div>
      )}

      <ErrBox msg={err} />
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800 font-semibold">
          ✅ {success}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-50 border rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-500 uppercase">전체 대상자</span>
          <span className="text-2xl font-black text-slate-800 mt-2">{stats.total}명</span>
        </div>
        <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-600 uppercase">백업 서명 완료</span>
            <span className="text-xs font-black text-emerald-700 bg-emerald-100/50 px-2 py-0.5 rounded-lg">{consentRate}%</span>
          </div>
          <span className="text-2xl font-black text-emerald-800 mt-2">{stats.consented}명</span>
        </div>
        <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold text-amber-600 uppercase">서명 대기 (리마인더 대상)</span>
          <span className="text-2xl font-black text-amber-800 mt-2">{stats.pending}명</span>
        </div>
        <div className="bg-red-50/50 border border-red-100 rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <span className="text-xs font-bold text-red-600 uppercase">정지 / 삭제됨</span>
          <span className="text-2xl font-black text-red-800 mt-2">
            {stats.suspended}명 / {stats.deleted}명
          </span>
        </div>
      </div>

      {/* Accordion Setup for Graduation Settings */}
      <div className="bg-white border rounded-2xl overflow-hidden shadow-xs">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-full px-6 py-4 bg-slate-50 border-b flex justify-between items-center text-sm font-bold text-slate-700 hover:bg-slate-100/60 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span>⚙️</span>
            <span>졸업생 계정 정지/삭제 일정 및 안내 리마인더 설정 (고급 설정)</span>
          </div>
          <span className="text-xs">{showSettings ? "▲ 접기" : "▼ 펼치기"}</span>
        </button>

        {showSettings && (
          <div className="p-6 space-y-5 border-t border-slate-100 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600">계정 일시정지 예정일 (매년 반복)</label>
                <div className="flex gap-2 mt-1">
                  <select
                    value={suspendMonth}
                    onChange={(e) => setSuspendMonth(parseInt(e.target.value))}
                    className="border rounded-xl px-3.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white flex-1 text-slate-700 font-medium"
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>{m}월</option>
                    ))}
                  </select>
                  <select
                    value={suspendDay}
                    onChange={(e) => setSuspendDay(parseInt(e.target.value))}
                    className="border rounded-xl px-3.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white flex-1 text-slate-700 font-medium"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>{d}일</option>
                    ))}
                  </select>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">매년 지정된 월-일 새벽에 대상자의 계정이 자동으로 일시정지(접속차단) 됩니다.</span>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600">계정 영구삭제 예정일 (매년 반복)</label>
                <div className="flex gap-2 mt-1">
                  <select
                    value={deleteMonth}
                    onChange={(e) => setDeleteMonth(parseInt(e.target.value))}
                    className="border rounded-xl px-3.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white flex-1 text-slate-700 font-medium"
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>{m}월</option>
                    ))}
                  </select>
                  <select
                    value={deleteDay}
                    onChange={(e) => setDeleteDay(parseInt(e.target.value))}
                    className="border rounded-xl px-3.5 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white flex-1 text-slate-700 font-medium"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>{d}일</option>
                    ))}
                  </select>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">매년 지정된 월-일 새벽에 대상자의 구글 계정이 영구 삭제(소멸) 됩니다.</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600">안내/리마인더 메일 제목</label>
                <input
                  value={emailTemplateSubject}
                  onChange={(e) => setEmailTemplateSubject(e.target.value)}
                  className="w-full border rounded-xl px-3.5 py-2 text-sm mt-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder={DEFAULT_EMAIL_SUBJECT}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600">안내/리마인더 메일 본문 (치환문자: &#123;name&#125;, &#123;suspendDate&#125;, &#123;deleteDate&#125;)</label>
                  <textarea
                    rows={6}
                    value={emailTemplateBody}
                    onChange={(e) => setEmailTemplateBody(e.target.value)}
                    className="w-full border rounded-xl px-3.5 py-2 text-xs mt-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                    placeholder="이메일 템플릿 본문 (비워두면 기본 초안이 사용됩니다)"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600">안내/리마인더 구글 챗 본문 (치환문자 동일)</label>
                  <textarea
                    rows={6}
                    value={chatTemplateBody}
                    onChange={(e) => setChatTemplateBody(e.target.value)}
                    className="w-full border rounded-xl px-3.5 py-2 text-xs mt-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                    placeholder="구글 챗 DM 템플릿 본문을 입력하세요..."
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Btn onClick={handleSaveSettings} disabled={savingSettings}>
                {savingSettings ? "⏳ 저장 중..." : "💾 졸업생 설정 저장"}
              </Btn>
            </div>
          </div>
        )}
      </div>



      {/* Search and Table */}
      <div className="bg-white border rounded-2xl shadow-xs overflow-hidden">
        
        {/* Table Filters */}
        <div className="px-6 py-4 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex gap-2">
            {[
              { id: "ALL", label: "전체" },
              { id: "PENDING", label: "서명대기" },
              { id: "CONSENTED", label: "서명완료" },
              { id: "SUSPENDED", label: "일시정지됨" },
              { id: "DELETED", label: "영구삭제됨" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  statusFilter === tab.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="w-full md:w-72">
            <input
              type="text"
              placeholder="이름, 학번, 이메일로 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Student Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-xs">로딩 중...</div>
          ) : filteredCandidates.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">대상 학생이 없습니다.</div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b text-slate-500 uppercase font-semibold">
                  <th className="px-6 py-3.5 w-24">학번</th>
                  <th className="px-6 py-3.5 w-28">이름</th>
                  <th className="px-6 py-3.5">이메일</th>
                  <th className="px-6 py-3.5 w-32 text-center">동의 상태</th>
                  <th className="px-6 py-3.5 w-44">동의/처리 일시</th>
                  <th className="px-6 py-3.5 w-24 text-center">알림 횟수</th>
                  <th className="px-6 py-3.5 w-64 text-center">동작 제어</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredCandidates.map((c) => (
                  <tr key={c.email} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3.5 font-bold font-mono">{c.studentId || "-"}</td>
                    <td className="px-6 py-3.5 font-bold flex items-center gap-1.5">
                      <span>{c.name}</span>
                      {(c.isTest || c.originalOU === "/학생/테스트") && (
                        <span className="bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded text-[9px] border border-purple-200">테스트</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-slate-500">{c.email}</td>
                    <td className="px-6 py-3.5 text-center">
                      {c.status === "PENDING" && (
                        <span className="inline-block bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md font-bold border border-amber-100">대기</span>
                      )}
                      {c.status === "CONSENTED" && (
                        <span className="inline-block bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md font-bold border border-emerald-100">완료</span>
                      )}
                      {c.status === "SUSPENDED" && (
                        <span className="inline-block bg-red-50 text-red-700 px-2 py-0.5 rounded-md font-bold border border-red-100">정지됨</span>
                      )}
                      {c.status === "DELETED" && (
                        <span className="inline-block bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-bold border border-slate-200">삭제됨</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500 font-mono">
                      {c.status === "CONSENTED" && formatDate(c.consentedAt)}
                      {c.status === "SUSPENDED" && formatDate(c.suspendedAt)}
                      {c.status === "DELETED" && formatDate(c.deletedAt)}
                      {c.status === "PENDING" && "-"}
                    </td>
                    <td className="px-6 py-3.5 text-center font-bold font-mono text-slate-600">
                      {c.warnedCount || 0}회
                    </td>
                    <td className="px-6 py-3.5 text-center flex justify-center items-center gap-2 flex-wrap">
                      {/* View Signature permanent record if submitted */}
                      {c.consentSubmitted && (
                        <button
                          onClick={() => handleViewSignature(c.email)}
                          disabled={runningAction !== null || loadingConsent}
                          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-[10px] transition-colors"
                        >
                          서명 보기
                        </button>
                      )}

                      {/* Manual Consent Toggle */}
                      {c.status === "PENDING" && (
                        <button
                          onClick={() => handleToggleConsent(c.email, false)}
                          disabled={runningAction !== null}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] transition-colors"
                        >
                          수동 동의 완료
                        </button>
                      )}
                      {c.status === "CONSENTED" && (
                        <button
                          onClick={() => handleToggleConsent(c.email, true)}
                          disabled={runningAction !== null}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-[10px] transition-colors"
                        >
                          동의 취소
                        </button>
                      )}

                      {/* Nagging Alert Trigger */}
                      {c.status === "PENDING" && (
                        <button
                          onClick={() => handleSendIndividualWarning(c.email)}
                          disabled={runningAction !== null}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-[10px] transition-colors"
                        >
                          리마인더 발송
                        </button>
                      )}

                      {/* Individual Restore/Unsuspend Button */}
                      {c.status === "SUSPENDED" && (
                        <button
                          onClick={() => handleIndividualRestore(c.email)}
                          disabled={runningAction !== null}
                          className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-lg text-[10px] transition-colors"
                        >
                          일시정지 해제
                        </button>
                      )}

                      {/* Test Student Delete Trigger */}
                      {(c.isTest || c.originalOU === "/학생/테스트") && (
                        <button
                          onClick={() => handleDeleteTestStudent(c.email)}
                          disabled={runningAction !== null}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[10px] transition-colors"
                          title="테스트 학생을 목록에서 삭제합니다."
                        >
                          테스트 삭제
                        </button>
                      )}

                      {c.status === "DELETED" && (
                        <span className="text-[10px] text-slate-400 font-medium">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 🛠️ Developer Test & Simulation Collapsible Card */}
      <div className="bg-white border rounded-2xl shadow-xs overflow-hidden mt-6">
        <button
          type="button"
          onClick={() => setShowDevTools(!showDevTools)}
          className="w-full flex items-center justify-between p-4 bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-colors focus:outline-none"
        >
          <span className="flex items-center gap-1.5">
            <span>🛠️</span>
            <span>개발자 시뮬레이션 및 테스트 도구 (테스트 완료 후 운영 시 접어두세요)</span>
          </span>
          <span>{showDevTools ? "🔼 접기" : "🔽 펼치기"}</span>
        </button>

        {showDevTools && (
          <div className="p-5 border-t space-y-5 bg-slate-50/50">
            {/* Simulation A: Parameters */}
            <div className="space-y-3">
              <h5 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span>🔬</span>
                <span>졸업 예정자 스케줄러(크론) 및 데이터 가상 날짜 테스트</span>
              </h5>
              <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center gap-4 shadow-2xs">
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] font-bold text-slate-600">가상 오늘 날짜:</label>
                  <input
                    type="date"
                    value={mockTestDate}
                    onChange={(e) => setMockTestDate(e.target.value)}
                    className="border rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-slate-700 font-mono"
                  />
                </div>
                
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] font-bold text-slate-600">테스트 이메일 필터 (안전장치):</label>
                  <input
                    type="text"
                    placeholder="예: test"
                    value={testEmailFilter}
                    onChange={(e) => setTestEmailFilter(e.target.value)}
                    className="border rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white text-slate-700 w-32 font-mono"
                  />
                </div>

                <div className="flex gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={handleRunCronTest}
                    disabled={runningCronTest}
                    className="px-3.5 py-1.5 font-bold rounded-lg text-xs transition-colors shadow-sm shrink-0"
                    style={{ backgroundColor: '#4f46e5', color: '#ffffff' }}
                  >
                    {runningCronTest ? "⏳ 테스트 실행 중..." : "⚡ 시뮬레이션 크론 실행"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCandidates}
                    disabled={syncing}
                    className="px-3.5 py-1.5 bg-slate-600 hover:bg-slate-750 text-white font-bold rounded-lg text-xs transition-colors shadow-sm shrink-0"
                  >
                    {syncing ? "⏳ 처리 중..." : "🧹 동기화된 목록 비우기 (테스트 제외)"}
                  </button>
                </div>
              </div>
            </div>

            {/* Simulation B: Test student manual registration */}
            <div className="space-y-3">
              <h5 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span>🧪</span>
                <span>시뮬레이션 전용 가상/부계정 테스트 학생 수동 등록</span>
              </h5>
              <div className="bg-white border rounded-xl p-4 space-y-4 shadow-2xs">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
                  <div>
                    <label className="text-[10px] text-slate-400 block font-bold">테스트 이름</label>
                    <input
                      type="text"
                      placeholder="예: 홍길동(테스트)"
                      value={testStudentName}
                      onChange={(e) => setTestStudentName(e.target.value)}
                      className="w-full border rounded-lg px-2.5 py-1 text-xs focus:outline-none bg-white text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block font-bold">테스트 학번 (선택)</label>
                    <input
                      type="text"
                      placeholder="예: 39999"
                      value={testStudentId}
                      onChange={(e) => setTestStudentId(e.target.value)}
                      className="w-full border rounded-lg px-2.5 py-1 text-xs focus:outline-none bg-white text-slate-700"
                    />
                  </div>
                  <div className="sm:col-span-2 flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-400 block font-bold">수신 가능한 테스트 이메일</label>
                      <input
                        type="email"
                        placeholder="예: test-student@hyeomyung.hs.kr"
                        value={testStudentEmail}
                        onChange={(e) => setTestStudentEmail(e.target.value)}
                        className="w-full border rounded-lg px-2.5 py-1 text-xs focus:outline-none bg-white text-slate-700 font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddTestStudent}
                      disabled={addingTestStudent}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors shrink-0 h-[28px] flex items-center justify-center"
                    >
                      {addingTestStudent ? "⏳ 등록 중..." : "등록"}
                    </button>
                  </div>
                </div>
                <span className="text-[9px] text-slate-400 leading-relaxed block">
                  ※ 본인이 실제로 소유하거나 수신을 확인할 수 있는 이메일을 입력한 뒤 이메일 필터를 걸어 크론을 실행하면, 안내 리마인더 메일과 구글 챗 DM을 수신해볼 수 있습니다.
                </span>
              </div>
            </div>

            {/* Simulation C: Results box */}
            {cronTestResult && (
              <div className="bg-slate-800 text-slate-200 rounded-xl p-4 text-xs font-mono shadow-inner border border-slate-700 space-y-1">
                <div className="text-emerald-400 font-bold border-b border-slate-700 pb-1.5 mb-1.5 flex justify-between items-center">
                  <span>✨ 시뮬레이션 결과 ({cronTestResult.processedAt?.split("T")[0] || ""})</span>
                  <button type="button" onClick={() => setCronTestResult(null)} className="text-slate-400 hover:text-slate-200">❌</button>
                </div>
                <div>- 안내 리마인더 발송: {cronTestResult.warned?.length || 0}명 {cronTestResult.warned?.length > 0 && `(${cronTestResult.warned.join(", ")})`}</div>
                <div>- 일시정지 처리: {cronTestResult.suspended?.length || 0}명 {cronTestResult.suspended?.length > 0 && `(${cronTestResult.suspended.join(", ")})`}</div>
                <div>- 영구삭제 처리: {cronTestResult.deleted?.length || 0}명 {cronTestResult.deleted?.length > 0 && `(${cronTestResult.deleted.join(", ")})`}</div>
                <div>- 발생한 오류: {cronTestResult.errors?.length || 0}건 {cronTestResult.errors?.length > 0 && `(${JSON.stringify(cronTestResult.errors)})`}</div>
                {cronTestResult.debug?.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-yellow-400 hover:text-yellow-300 font-sans">🔍 실행 로그 ({cronTestResult.debug.length}줄) 펼치기</summary>
                    <div className="mt-1 max-h-60 overflow-y-auto space-y-0.5 border-t border-slate-700 pt-1">
                      {cronTestResult.debug.map((line: string, i: number) => (
                        <div key={i} className={`text-[10px] leading-relaxed ${line.includes("❌") ? "text-red-400" : line.includes("✅") ? "text-emerald-400" : line.includes("SKIP") ? "text-slate-500" : "text-slate-300"}`}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                <div className="text-[10px] text-slate-400 mt-2 font-sans leading-relaxed">※ 이 시뮬레이션은 구글 API 모크 환경에 상관없이 실제 Firestore 데이터 및 API 액션을 수행하므로, 실제로 지정한 테스트 대상 계정에 대해 정지/삭제/알림 발송이 수행됩니다.</div>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Signature & Consent Viewer Modal */}
      {showConsentModal && selectedConsent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden animate-scale-up flex flex-col">
            <div className="bg-indigo-700 text-white p-4 font-bold text-xs flex justify-between items-center">
              <span>✍️ 졸업 백업 안내 확인 서명</span>
              <button
                type="button"
                onClick={() => {
                  setShowConsentModal(false);
                  setSelectedConsent(null);
                }}
                className="text-white hover:text-slate-200 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border rounded-xl">
                <div>
                  <span className="text-[10px] text-slate-400 block font-medium">이름</span>
                  <span className="text-slate-800 font-bold mt-0.5 block">{selectedConsent.name}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-medium">학번</span>
                  <span className="text-slate-800 font-bold mt-0.5 block font-mono">{selectedConsent.studentId}</span>
                </div>
                <div className="col-span-2 border-t border-slate-100 pt-2 mt-1">
                  <span className="text-[10px] text-slate-400 block font-medium">이메일 계정</span>
                  <span className="text-slate-800 font-bold mt-0.5 block font-mono">{selectedConsent.email}</span>
                </div>
                <div className="col-span-2 border-t border-slate-100 pt-2">
                  <span className="text-[10px] text-slate-400 block font-medium">서명 일시</span>
                  <span className="text-slate-800 font-bold mt-0.5 block font-mono">
                    {selectedConsent.consentedAt?.toDate 
                      ? selectedConsent.consentedAt.toDate().toLocaleString("ko-KR") 
                      : new Date(selectedConsent.consentedAt || Date.now()).toLocaleString("ko-KR")}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-400 block font-medium">학생 친필 서명 (손가락/마우스 드로잉)</span>
                <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 h-32 flex items-center justify-center">
                  {selectedConsent.signature?.startsWith("data:image/") ? (
                    <img 
                      src={selectedConsent.signature} 
                      alt="Student signature" 
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-slate-400 font-bold text-[11px]">{selectedConsent.signature}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowConsentModal(false);
                  setSelectedConsent(null);
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-indigo-950 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
