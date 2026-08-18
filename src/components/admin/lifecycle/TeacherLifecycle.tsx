"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import AutocompleteInput from "@/components/admin/AutocompleteInput";
import { invalidateClientCache } from "@/lib/cache/clientCache";
import SubstituteHandoverWizard from "@/components/admin/lifecycle/SubstituteHandoverWizard";

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────
type SectionId = "enroll" | "transfer" | "ob" | "handover";

interface TeacherTransferTask {
  email: string;
  name: string;
  status: "PENDING_DEADLINE" | "DEADLINE_SET" | "SUSPENDED" | "DELETED";
  registeredAt: any;
  deadlineDate: any;
  suspendedAt: any;
  warnedCount: number;
}

// ─────────────────────────────────────────────────────
// Section Selector Button
// ─────────────────────────────────────────────────────
function SectionBtn({ active, onClick, icon, title, desc }: {
  active: boolean; onClick: () => void; icon: string; title: string; desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center text-center p-5 rounded-xl border-2 transition-all duration-200 ${
        active
          ? "border-indigo-600 bg-indigo-50 shadow-md"
          : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50"
      }`}
    >
      <span className="text-3xl mb-2">{icon}</span>
      <span className={`font-bold text-sm ${active ? "text-indigo-700" : "text-gray-800"}`}>{title}</span>
      <span className="text-xs text-gray-500 mt-1 leading-tight">{desc}</span>
    </button>
  );
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING_DEADLINE: { label: "기한 미설정", color: "bg-orange-100 text-orange-800" },
  DEADLINE_SET: { label: "기한 설정됨", color: "bg-blue-100 text-blue-800" },
  SUSPENDED: { label: "계정 정지됨", color: "bg-red-100 text-red-800" },
  DELETED: { label: "삭제 완료", color: "bg-gray-100 text-gray-500" },
};

// ─────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────
export default function TeacherLifecycle() {
  const { userData, schoolSettings } = useAuth();
  const domain = userData?.domain || "";
  const operatorEmail = userData?.email || "";
  const operatorName = userData?.email || "관리자";

  const [section, setSection] = useState<SectionId>("enroll");
  const settingsOBPath = schoolSettings?.ouMapping?.teachersOB || "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">교직원 계정 및 생애주기 관리</h2>
        <p className="text-sm text-gray-500 mt-1">교사 전입(계정 생성 및 자동 그룹 가입), 전출(보안 즉시 해제 및 기한 설정), 명예퇴임(OB 보존실 이동), 기간제 교사 수업·담임·클래스룸 일괄 이관을 담당합니다.</p>
      </div>

      {/* Section Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SectionBtn active={section === "enroll"} onClick={() => setSection("enroll")} icon="➕" title="교직원 전입 (신규 등록)" desc="계정 생성 + 지정 그룹 자동 가입" />
        <SectionBtn active={section === "transfer"} onClick={() => setSection("transfer")} icon="🚪" title="교직원 전출 관리" desc="보안 즉시 해제 + 기한 설정 관리" />
        <SectionBtn active={section === "ob"} onClick={() => setSection("ob")} icon="🏅" title="명예퇴임 처리" desc="OB 보존실 이동 + 계정 영구 보존" />
        <SectionBtn active={section === "handover"} onClick={() => setSection("handover")} icon="🔄" title="기간제 인수인계" desc="수업·시간표·담임·클래스룸 일괄 이관" />
      </div>

      {/* Content */}
      {section === "enroll" && (
        <EnrollTeacherPanel domain={domain} operatorEmail={operatorEmail} operatorName={operatorName} />
      )}
      {section === "transfer" && (
        <TransferTeacherPanel domain={domain} operatorEmail={operatorEmail} operatorName={operatorName} />
      )}
      {section === "ob" && (
        <OBTeacherPanel domain={domain} operatorEmail={operatorEmail} operatorName={operatorName} settingsOBPath={settingsOBPath} />
      )}
      {section === "handover" && (
        <SubstituteHandoverWizard domain={domain} operatorEmail={operatorEmail} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Panel: 교직원 전입 (신규 등록)
// ─────────────────────────────────────────────────────
function EnrollTeacherPanel({ domain, operatorEmail, operatorName }: { domain: string; operatorEmail: string; operatorName: string }) {
  const [familyName, setFamilyName] = useState("");
  const [givenName, setGivenName] = useState("");
  const [username, setUsername] = useState("");
  const [enrolledEmail, setEnrolledEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; tempPassword?: string; groupResults?: any[] } | null>(null);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !givenName || !familyName) return;
    
    // 아이디만 정제하고 도메인을 붙여 이메일 주소 조립
    const cleanUsername = username.trim().replace(/@.*$/, "");
    const fullEmail = `${cleanUsername}@${domain || "hmh.or.kr"}`;

    setLoading(true);
    setResult(null);
    setEnrolledEmail("");
    try {
      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enroll_teacher",
          operatorEmail,
          operatorName,
          domain,
          teacherEmail: fullEmail,
          teacherFamilyName: familyName,
          teacherGivenName: givenName,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        invalidateClientCache("users:all");
        setEnrolledEmail(fullEmail);
        setUsername("");
      }
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">교직원 전입 등록</h3>
        <p className="text-sm text-gray-500">GWS 계정을 생성하고 지정 연동 그룹들에 자동으로 가입시킵니다. (초기 비밀번호: <code className="bg-gray-100 px-1 rounded text-xs font-semibold">1234abcd!!!!</code>)</p>
      </div>

      <form onSubmit={handleEnroll} className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">성 (Family Name)</label>
            <input
              type="text"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder="예: 김"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이름 (Given Name)</label>
            <input
              type="text"
              value={givenName}
              onChange={(e) => setGivenName(e.target.value)}
              placeholder="예: 민수"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
              required
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">이메일 계정 아이디</label>
          <div className="flex rounded-lg shadow-sm">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/@.*$/, ""))}
              placeholder="예: teacher"
              className="flex-1 min-w-0 block w-full px-3 py-2 rounded-l-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 border-r-0"
              required
            />
            <span className="inline-flex items-center px-3 rounded-r-lg border border-l-0 border-gray-300 bg-gray-50 text-gray-500 text-sm font-medium select-none">
              @{domain || "hmh.or.kr"}
            </span>
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? "처리 중..." : "교직원 등록 및 그룹 가입"}
        </button>
      </form>

      {result && (
        <div className={`rounded-lg p-4 text-sm ${result.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          {result.success ? (
            <div className="space-y-4">
              <p className="font-semibold text-green-800">✅ 교직원 등록 완료!</p>

              {/* 클립보드 복사 영역 */}
              <div className="bg-white border border-green-200 rounded-lg p-4 text-xs text-gray-700 font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
{`효명고등학교에 오신 것을 환영합니다! 🎉

효명고등학교의 구글 워크스페이스 교직원 계정이 생성되어 안내해 드립니다.
아래 계정 정보로 구글(google.com)에 로그인하세요.

▪ 아이디(이메일): ${enrolledEmail}
▪ 초기 비밀번호: 1234abcd!!!!

━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  필수 보안 설정 안내 (중요!)
━━━━━━━━━━━━━━━━━━━━━━━━━
최초 로그인 및 비밀번호 재설정 완료 후, 아래 절차를 반드시 완료하셔야 정상적인 메일/클래스룸 등 교사 보안그룹 권한이 연동됩니다.

1. 구글 메인화면 우측 상단 프로필 클릭 ＞ [Google 계정 관리] 로 이동
2. 좌측 메뉴의 [보안] 탭 클릭
3. [2단계 인증] 설정을 완료하여 본인 휴대폰 번호 인증 등록

2단계 인증 미등록 시 보안그룹 정책에 의해 구글 서비스 접근이 자동 제한되니 꼭 등록해 주시기 바랍니다.

궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요.`}
              </div>

              <button
                type="button"
                onClick={() => {
                  const msg = `효명고등학교에 오신 것을 환영합니다! 🎉\n\n효명고등학교의 구글 워크스페이스 교직원 계정이 생성되어 안내해 드립니다.\n아래 계정 정보로 구글(google.com)에 로그인하세요.\n\n▪ 아이디(이메일): ${enrolledEmail}\n▪ 초기 비밀번호: 1234abcd!!!!\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️  필수 보안 설정 안내 (중요!)\n━━━━━━━━━━━━━━━━━━━━━━━━━\n최초 로그인 및 비밀번호 재설정 완료 후, 아래 절차를 반드시 완료하셔야 정상적인 메일/클래스룸 등 교사 보안그룹 권한이 연동됩니다.\n\n1. 구글 메인화면 우측 상단 프로필 클릭 ＞ [Google 계정 관리] 로 이동\n2. 좌측 메뉴의 [보안] 탭 클릭\n3. [2단계 인증] 설정을 완료하여 본인 휴대폰 번호 인증 등록\n\n2단계 인증 미등록 시 보안그룹 정책에 의해 구글 서비스 접근이 자동 제한되니 꼭 등록해 주시기 바랍니다.\n\n궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요.`;
                  navigator.clipboard.writeText(msg);
                  alert("안내 문구가 클립보드에 복사되었습니다.");
                }}
                className="w-full px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-sm"
              >
                📋 안내 문구 클립보드 복사
              </button>

              {result.groupResults && (
                <div className="mt-2 pt-3 border-t border-green-200">
                  <p className="font-medium text-green-800 mb-1">그룹 가입 결과:</p>
                  {result.groupResults.map((gr: any) => (
                    <p key={gr.group} className={`text-xs ${gr.success ? "text-green-700" : "text-orange-700"}`}>
                      {gr.success ? "✓" : "⚠"} {gr.group} 가입 {!gr.success && `(${gr.error})`}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-red-700">❌ 오류: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 교직원 전출 알림 템플릿 기본값 상수
// ─────────────────────────────────────────────────────
const DEFAULT_TEACHER_EMAIL_SUBJECT = "[중요] 학교 구글 계정 전출 처리 안내 - 데이터 백업 기한을 설정해 주세요";
const DEFAULT_TEACHER_EMAIL_BODY = `안녕하세요, {name}님.

학교 행정상 선생님의 구글 워크스페이스 계정이 전출 처리되었습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━
📋  조치 사항
━━━━━━━━━━━━━━━━━━━━━━━━━
선생님이 가입되어 있던 교사용 연동 그룹에서 즉시 탈퇴 처리되었습니다.
구글 계정 자체는 아직 유지되고 있으나, 아래 안내에 따라 데이터 백업 기한을 직접 설정하셔야 합니다.

━━━━━━━━━━━━━━━━━━━━━━━━━
📅  기한 설정 방법
━━━━━━━━━━━━━━━━━━━━━━━━━
학교 어드민 시스템에 접속하시면 데이터 백업 완료 후 계정 삭제를 희망하시는 날짜(최대 1년 이내)를 직접 입력하실 수 있습니다.

👉 어드민 시스템 바로가기:
{deadlineUrl}

📦  데이터 이전 및 다운로드 방법:
→ https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4

궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요. 감사합니다.

효명고등학교 드림`;
const DEFAULT_TEACHER_CHAT_BODY = `📢 *[효명고등학교 구글 계정 전출 처리 안내]*

안녕하세요, *{name}*님.
학교 행정상 선생님의 구글 워크스페이스 계정이 전출 처리되었습니다.

*📋  조치 사항*
선생님이 가입되어 있던 교사용 연동 그룹에서 즉시 탈퇴 처리되었습니다.
구글 계정 자체는 아직 유지되고 있으나, 아래 안내에 따라 데이터 백업 기한을 직접 설정하셔야 합니다.

*📅  기한 설정 방법*
학교 어드민 시스템에 접속하시면 데이터 백업 완료 후 계정 삭제를 희망하시는 날짜(최대 1년 이내)를 직접 입력하실 수 있습니다.

👉 어드민 시스템 바로가기:
{deadlineUrl}

*📦  데이터 이전 및 다운로드 방법:*
→ https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4

궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요. 감사합니다.`;
const DEFAULT_TEACHER_REMINDER_CHAT_BODY = `📢 *[효명고등학교 - 데이터 백업 기한 설정 안내 {warnedCount}차]*

안녕하세요, *{name}*님.
아직 데이터 백업 기한을 설정하지 않으셨습니다.

아래 주소에서 기한을 직접 설정해 주세요:
→ {deadlineUrl}

설정 기한은 최대 1년 이내로 지정 가능합니다.`;

// ─────────────────────────────────────────────────────
// Panel: 교직원 전출 관리
// ─────────────────────────────────────────────────────
function TransferTeacherPanel({ domain, operatorEmail, operatorName }: { domain: string; operatorEmail: string; operatorName: string }) {
  const [transferQuery, setTransferQuery] = useState("");
  const [transferEmail, setTransferEmail] = useState("");
  const [transferName, setTransferName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; groupResults?: any[] } | null>(null);
  const [queue, setQueue] = useState<TeacherTransferTask[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  // 템플릿 편집 상태
  const [showTemplateAccordion, setShowTemplateAccordion] = useState(false);
  const [emailTemplateSubject, setEmailTemplateSubject] = useState(DEFAULT_TEACHER_EMAIL_SUBJECT);
  const [emailTemplateBody, setEmailTemplateBody] = useState(DEFAULT_TEACHER_EMAIL_BODY);
  const [chatTemplateBody, setChatTemplateBody] = useState(DEFAULT_TEACHER_CHAT_BODY);
  const [reminderChatBody, setReminderChatBody] = useState(DEFAULT_TEACHER_REMINDER_CHAT_BODY);
  const [savingSettings, setSavingSettings] = useState(false);

  const handleCancelTransfer = async (email: string, name: string) => {
    if (!confirm(`${name || email} 선생님의 전출 등록을 취소하시겠습니까?\n전출 큐에서 제외되고 지정된 연동 그룹에 다시 가입 처리됩니다.`)) return;
    setCancelling(email);
    try {
      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel_teacher_transfer",
          operatorEmail,
          operatorName,
          domain,
          teacherEmail: email,
          teacherName: name,
        }),
      });
      const data = await res.json();
      if (data.success) {
        invalidateClientCache("users:all");
        alert("전출 취소 처리가 완료되었습니다.");
        loadQueue();
      } else {
        alert(`전출 취소 실패: ${data.error}`);
      }
    } catch (err: any) {
      alert(`오류 발생: ${err.message}`);
    } finally {
      setCancelling(null);
    }
  };

  const loadQueue = async () => {
    if (!domain) return;
    setQueueLoading(true);
    try {
      const snap = await getDocs(collection(db, "teacher_transfer_tasks", domain, "teachers"));
      const tasks = snap.docs
        .map((d) => d.data() as TeacherTransferTask)
        .filter((t) => t.status !== "DELETED");
      setQueue(tasks);
    } catch (err) {
      console.error("전출 큐 로딩 실패:", err);
    } finally {
      setQueueLoading(false);
    }
  };

  const loadSettings = async () => {
    if (!domain) return;
    try {
      const settingsSnap = await getDoc(doc(db, "settings", domain));
      if (settingsSnap.exists()) {
        const s = settingsSnap.data()?.teacherTransferSettings;
        if (s) {
          if (s.emailTemplateSubject) setEmailTemplateSubject(s.emailTemplateSubject);
          if (s.emailTemplateBody) setEmailTemplateBody(s.emailTemplateBody);
          if (s.chatTemplateBody) setChatTemplateBody(s.chatTemplateBody);
          if (s.reminderChatBody) setReminderChatBody(s.reminderChatBody);
        }
      }
    } catch (err) {
      console.error("템플릿 설정 로딩 실패:", err);
    }
  };

  const handleSaveSettings = async () => {
    if (!domain) return;
    setSavingSettings(true);
    try {
      const settingsRef = doc(db, "settings", domain);
      await setDoc(settingsRef, {
        teacherTransferSettings: {
          emailTemplateSubject,
          emailTemplateBody,
          chatTemplateBody,
          reminderChatBody,
        },
        updatedAt: new Date(),
      }, { merge: true });
      alert("설정이 성공적으로 저장되었습니다!");
    } catch (e: any) {
      alert(`설정 저장 실패: ${e.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => { loadQueue(); loadSettings(); }, [domain]);

  const handleRegisterTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferEmail) return;
    if (!confirm(`${transferName || transferEmail} 선생님을 전출로 등록하시겠습니까?\n지정된 연동 그룹에서 즉시 탈퇴 처리되고, 본인에게 안내 알림이 발송됩니다.`)) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register_teacher_transfer",
          operatorEmail,
          operatorName,
          domain,
          teacherEmail: transferEmail,
          teacherName: transferName,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        invalidateClientCache("users:all");
        setTransferQuery("");
        setTransferEmail("");
        setTransferName("");
        await loadQueue();
      }
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 📩 알림 템플릿 편집 아코디언 */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setShowTemplateAccordion(!showTemplateAccordion)}
          className="w-full px-5 py-4 flex items-center justify-between text-left font-bold text-gray-800 bg-slate-50/50 hover:bg-slate-50 transition-colors border-b border-gray-100"
        >
          <span className="flex items-center gap-2">📩 알림 템플릿 편집 (전출 등록 안내 · 리마인더)</span>
          <span className="text-gray-400 text-xs font-semibold">
            {showTemplateAccordion ? "접기 ▲" : "펼치기 ▼"}
          </span>
        </button>
        {showTemplateAccordion && (
          <div className="p-5 border-t border-gray-100 bg-white space-y-5">
            <div>
              <p className="text-[10px] text-gray-400 leading-relaxed font-medium mb-3">
                사용 가능한 치환자: <code>{'{name}'}</code> (이름), <code>{'{email}'}</code> (이메일),{" "}
                <code>{'{deadlineUrl}'}</code> (기한 설정 링크), <code>{'{maxDeadlineDate}'}</code> (최대 기한일),{" "}
                <code>{'{warnedCount}'}</code> (리마인더 차수)
              </p>
              <div className="flex items-center justify-between mb-4">
                <h5 className="text-xs font-bold text-gray-800">✉️ 전출 등록 안내 메시지</h5>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("작성 중인 내용을 지우고 기본 템플릿으로 초기화하시겠습니까?")) {
                      setEmailTemplateSubject(DEFAULT_TEACHER_EMAIL_SUBJECT);
                      setEmailTemplateBody(DEFAULT_TEACHER_EMAIL_BODY);
                      setChatTemplateBody(DEFAULT_TEACHER_CHAT_BODY);
                      setReminderChatBody(DEFAULT_TEACHER_REMINDER_CHAT_BODY);
                    }
                  }}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold"
                >
                  기본 템플릿 불러오기
                </button>
              </div>
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
                    rows={7}
                    value={emailTemplateBody}
                    onChange={(e) => setEmailTemplateBody(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 font-mono leading-relaxed"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">구글 챗 알림 본문 (전출 등록 시)</label>
                  <textarea
                    rows={4}
                    value={chatTemplateBody}
                    onChange={(e) => setChatTemplateBody(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-800 font-mono leading-relaxed"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-1">구글 챗 리마인더 본문 (기한 미설정 시 주기적 발송)</label>
                  <textarea
                    rows={4}
                    value={reminderChatBody}
                    onChange={(e) => setReminderChatBody(e.target.value)}
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

      {/* 전출 등록 폼 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">전출 교사 등록</h3>
        <p className="text-sm text-gray-500 mb-4">
          등록 즉시 OB 보존실 OU로 이동되어 조직도·배치 목록에서 제외되며, 지정된 연동 그룹에서 강제 탈퇴하고 교사 본인에게 데이터 백업 기한 선택 안내를 발송합니다.
        </p>
        <form onSubmit={handleRegisterTransfer} className="space-y-4 max-w-lg">
          <div className="w-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">전출 교사 이메일/이름 검색</label>
            <AutocompleteInput
              type="user"
              value={transferQuery}
              onChange={(val) => {
                setTransferQuery(val);
                setTransferEmail("");
                setTransferName("");
              }}
              domain={domain}
              onSelect={(email, name) => {
                setTransferEmail(email);
                setTransferName(name || "");
                setTransferQuery(`${name || ""} (${email})`);
              }}
              placeholder="이름 또는 이메일 검색..."
              className="w-full"
            />
            {transferEmail && (
              <p className="text-xs text-indigo-600 font-medium mt-1.5">
                🎯 선택된 교사: <span className="font-bold">{transferName || transferEmail}</span> ({transferEmail})
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !transferEmail}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? "처리 중..." : "⚠️ 전출 등록 (그룹 즉시 탈퇴 + 알림 발송)"}
          </button>
        </form>
        {result && (
          <div className={`mt-4 rounded-lg p-4 text-sm ${result.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            {result.success ? (
              <div>
                <p className="font-semibold text-green-800 mb-2">✅ 전출 등록 완료! 교사에게 안내 알림이 발송되었습니다.</p>
                {result.groupResults?.map((gr: any) => (
                  <p key={gr.group} className={`text-xs ${gr.success ? "text-green-700" : "text-orange-700"}`}>
                    {gr.success ? "✓" : "⚠"} {gr.group} 탈퇴 {!gr.success && `실패: ${gr.error}`}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-red-700">❌ 오류: {result.error}</p>
            )}
          </div>
        )}
      </div>

      {/* 전출 대기 큐 현황 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">전출 대기 현황</h3>
          <button onClick={loadQueue} className="text-xs text-indigo-600 hover:underline">🔄 새로고침</button>
        </div>
        {queueLoading ? (
          <p className="text-gray-500 text-sm text-center py-4">불러오는 중...</p>
        ) : queue.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">현재 전출 대기 중인 교직원이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="pb-3 pr-4 font-semibold">이름/이메일</th>
                  <th className="pb-3 pr-4 font-semibold">상태</th>
                  <th className="pb-3 pr-4 font-semibold">전출 등록일</th>
                  <th className="pb-3 pr-4 font-semibold">기한 선택일</th>
                  <th className="pb-3 pr-4 font-semibold">D-Day</th>
                  <th className="pb-3 font-semibold text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queue.map((task) => {
                  const getKSTDateString = (d: Date) => {
                    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
                    return kst.toISOString().split("T")[0];
                  };
                  const deadline = task.deadlineDate
                    ? (task.deadlineDate.toDate ? task.deadlineDate.toDate() : new Date(task.deadlineDate))
                    : null;
                  const suspendedAt = task.suspendedAt
                    ? (task.suspendedAt.toDate ? task.suspendedAt.toDate() : new Date(task.suspendedAt))
                    : null;
                  let deleteDueDate: Date | null = null;
                  if (task.status === "SUSPENDED" && suspendedAt) {
                    const d = new Date(suspendedAt);
                    d.setDate(d.getDate() + 30);
                    deleteDueDate = d;
                  }

                  const targetDate = task.status === "SUSPENDED" ? deleteDueDate : deadline;
                  let dDay: number | null = null;
                  if (targetDate) {
                    const todayStr = getKSTDateString(new Date());
                    const targetStr = getKSTDateString(targetDate);
                    const todayTime = new Date(todayStr).getTime();
                    const targetTime = new Date(targetStr).getTime();
                    dDay = Math.round((targetTime - todayTime) / (1000 * 60 * 60 * 24));
                  }
                  const st = STATUS_LABEL[task.status] || { label: task.status, color: "bg-gray-100 text-gray-600" };
                  return (
                    <tr key={task.email} className="py-2">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900">{task.name}</p>
                        <p className="text-xs text-gray-400">{task.email}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {task.registeredAt?.toDate
                          ? task.registeredAt.toDate().toLocaleDateString("ko-KR")
                          : "-"}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {deadline ? deadline.toLocaleDateString("ko-KR") : "미설정"}
                      </td>
                      <td className="py-3">
                        {task.status === "SUSPENDED" ? (
                          deleteDueDate ? (
                            <div className="space-y-0.5">
                              <div className="font-bold text-gray-700 flex items-center gap-1.5">
                                🛑 {dDay !== null ? (dDay > 0 ? `D-${dDay}` : dDay === 0 ? "D-Day" : `D+${Math.abs(dDay)}`) : "-"}
                              </div>
                              <div className="text-[10px] text-gray-500 font-medium">
                                삭제 예정: {deleteDueDate.toLocaleDateString("ko-KR")}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )
                        ) : dDay !== null ? (
                          <span className={`font-bold ${dDay <= 7 ? "text-red-600" : dDay <= 30 ? "text-orange-600" : "text-gray-600"}`}>
                            {dDay > 0 ? `D-${dDay}` : dDay === 0 ? "D-Day" : `D+${Math.abs(dDay)}`}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleCancelTransfer(task.email, task.name)}
                          disabled={cancelling === task.email}
                          className="text-xs bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-red-200 transition-colors focus:outline-none disabled:opacity-50"
                        >
                          {cancelling === task.email ? "취소 중..." : "전출 취소"}
                        </button>
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
  );
}

// ─────────────────────────────────────────────────────
// Panel: 명예퇴임 처리
// ─────────────────────────────────────────────────────
function OBTeacherPanel({ domain, operatorEmail, operatorName, settingsOBPath }: {
  domain: string; operatorEmail: string; operatorName: string; settingsOBPath: string;
}) {
  const [obQuery, setObQuery] = useState("");
  const [obEmail, setObEmail] = useState("");
  const [obName, setObName] = useState("");
  const [obPath, setObPath] = useState(settingsOBPath);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; groupResults?: any[] } | null>(null);

  useEffect(() => { setObPath(settingsOBPath); }, [settingsOBPath]);

  const handleOB = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!obEmail || !obPath) return;
    if (!confirm(`${obName || obEmail} 선생님을 명예퇴임 처리하시겠습니까?\n지정된 연동 그룹에서 탈퇴되고 OB 보존실(${obPath})로 OU가 이동됩니다.\n계정은 영구 보존됩니다.`)) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_teacher_ob",
          operatorEmail,
          operatorName,
          domain,
          teacherEmail: obEmail,
          teacherName: obName,
          teachersOBPath: obPath,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        invalidateClientCache("users:all");
        setObQuery("");
        setObEmail("");
        setObName("");
      }
    } catch (err: any) {
      setResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">명예퇴임 처리</h3>
        <p className="text-sm text-gray-500">
          정년 또는 명예퇴직하시는 교직원의 계정을 <strong>삭제 없이 영구 보존</strong>합니다.
          4개 교사 그룹에서 탈퇴하고, OB 보존실 OU로 이동시킵니다.
        </p>
      </div>

      {!settingsOBPath && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          ⚠️ <strong>조직단위 설정</strong>에서 <strong>OB 보존실 OU</strong>를 먼저 매핑해 주세요. 매핑된 경로가 자동으로 사용됩니다.
        </div>
      )}

      <form onSubmit={handleOB} className="space-y-4 max-w-lg">
        <div className="w-full">
          <label className="block text-sm font-medium text-gray-700 mb-1">퇴임 교사 이메일/이름 검색</label>
          <AutocompleteInput
            type="user"
            value={obQuery}
            onChange={(val) => {
              setObQuery(val);
              setObEmail("");
              setObName("");
            }}
            domain={domain}
            onSelect={(email, name) => {
              setObEmail(email);
              setObName(name || "");
              setObQuery(`${name || ""} (${email})`);
            }}
            placeholder="이름 또는 이메일 검색..."
            className="w-full"
          />
          {obEmail && (
            <p className="text-xs text-indigo-600 font-medium mt-1.5">
              🎯 선택된 교사: <span className="font-bold">{obName || obEmail}</span> ({obEmail})
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">OB 보존실 OU 경로</label>
          <input
            type="text"
            value={obPath}
            onChange={(e) => setObPath(e.target.value)}
            placeholder="/교직원/OB보존실"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
            required
          />
          <p className="text-xs text-gray-400 mt-1">조직단위 설정에서 OB 보존실이 매핑된 경우 자동으로 채워집니다.</p>
        </div>
        <button
          type="submit"
          disabled={loading || !obPath || !obEmail}
          className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? "처리 중..." : "🏅 명예퇴임 처리 (OB 보존실 이동)"}
        </button>
      </form>

      {result && (
        <div className={`rounded-lg p-4 text-sm ${result.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
          {result.success ? (
            <div>
              <p className="font-semibold text-green-800 mb-2">✅ 명예퇴임 처리 완료! 계정이 OB 보존실로 이동되었습니다.</p>
              {result.groupResults?.map((gr: any) => (
                <p key={gr.group} className={`text-xs ${gr.success ? "text-green-700" : "text-orange-700"}`}>
                  {gr.success ? "✓" : "⚠"} {gr.group} 탈퇴 {!gr.success && `실패: ${gr.error}`}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-red-700">❌ 오류: {result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
