"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────
type SectionId = "enroll" | "transfer" | "ob";

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
  const { userData } = useAuth();
  const domain = userData?.domain || "";
  const operatorEmail = userData?.email || "";
  const operatorName = userData?.email || "관리자";

  const [section, setSection] = useState<SectionId>("enroll");
  const [settingsOBPath, setSettingsOBPath] = useState("");

  // Load teachersOB OU path from settings
  useEffect(() => {
    if (!domain) return;
    getDoc(doc(db, "settings", domain)).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSettingsOBPath(data?.ouMapping?.teachersOB || "");
      }
    });
  }, [domain]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">교직원 계정 및 생애주기 관리</h2>
        <p className="text-sm text-gray-500 mt-1">교사 전입(계정 생성 및 자동 그룹 가입), 전출(보안 즉시 해제 및 기한 설정), 명예퇴임(OB 보존실 이동) 처리를 담당합니다.</p>
      </div>

      {/* Section Selector */}
      <div className="flex gap-4">
        <SectionBtn active={section === "enroll"} onClick={() => setSection("enroll")} icon="➕" title="교직원 전입 (신규 등록)" desc="계정 생성 + 4대 그룹 자동 가입" />
        <SectionBtn active={section === "transfer"} onClick={() => setSection("transfer")} icon="🚪" title="교직원 전출 관리" desc="보안 즉시 해제 + 기한 설정 관리" />
        <SectionBtn active={section === "ob"} onClick={() => setSection("ob")} icon="🏅" title="명예퇴임 처리" desc="OB 보존실 이동 + 계정 영구 보존" />
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

궁금하신 점은 정보부로 문의해 주세요.`}
              </div>

              <button
                type="button"
                onClick={() => {
                  const msg = `효명고등학교에 오신 것을 환영합니다! 🎉\n\n효명고등학교의 구글 워크스페이스 교직원 계정이 생성되어 안내해 드립니다.\n아래 계정 정보로 구글(google.com)에 로그인하세요.\n\n▪ 아이디(이메일): ${enrolledEmail}\n▪ 초기 비밀번호: 1234abcd!!!!\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️  필수 보안 설정 안내 (중요!)\n━━━━━━━━━━━━━━━━━━━━━━━━━\n최초 로그인 및 비밀번호 재설정 완료 후, 아래 절차를 반드시 완료하셔야 정상적인 메일/클래스룸 등 교사 보안그룹 권한이 연동됩니다.\n\n1. 구글 메인화면 우측 상단 프로필 클릭 ＞ [Google 계정 관리] 로 이동\n2. 좌측 메뉴의 [보안] 탭 클릭\n3. [2단계 인증] 설정을 완료하여 본인 휴대폰 번호 인증 등록\n\n2단계 인증 미등록 시 보안그룹 정책에 의해 구글 서비스 접근이 자동 제한되니 꼭 등록해 주시기 바랍니다.\n\n궁금하신 점은 정보부로 문의해 주세요.`;
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
// Panel: 교직원 전출 관리
// ─────────────────────────────────────────────────────
function TransferTeacherPanel({ domain, operatorEmail, operatorName }: { domain: string; operatorEmail: string; operatorName: string }) {
  const [transferEmail, setTransferEmail] = useState("");
  const [transferName, setTransferName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; groupResults?: any[] } | null>(null);
  const [queue, setQueue] = useState<TeacherTransferTask[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

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

  useEffect(() => { loadQueue(); }, [domain]);

  const handleRegisterTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferEmail) return;
    if (!confirm(`${transferName || transferEmail} 선생님을 전출로 등록하시겠습니까?\n4개 그룹에서 즉시 탈퇴 처리되고, 본인에게 안내 알림이 발송됩니다.`)) return;
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
      {/* 전출 등록 폼 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-1">전출 교사 등록</h3>
        <p className="text-sm text-gray-500 mb-4">
          등록 즉시 4개 보안·클래스룸 그룹에서 강제 탈퇴하고, 교사 본인에게 데이터 백업 기한 선택 안내를 발송합니다.
        </p>
        <form onSubmit={handleRegisterTransfer} className="space-y-4 max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">교사 이메일</label>
              <input
                type="email"
                value={transferEmail}
                onChange={(e) => setTransferEmail(e.target.value)}
                placeholder="teacher@hmh.or.kr"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">교사 이름 (선택)</label>
              <input
                type="text"
                value={transferName}
                onChange={(e) => setTransferName(e.target.value)}
                placeholder="예: 김민수 선생님"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
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
                  <th className="pb-3 font-semibold">D-Day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queue.map((task) => {
                  const deadline = task.deadlineDate
                    ? (task.deadlineDate.toDate ? task.deadlineDate.toDate() : new Date(task.deadlineDate))
                    : null;
                  const dDay = deadline
                    ? Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;
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
                        {dDay !== null ? (
                          <span className={`font-bold ${dDay <= 7 ? "text-red-600" : dDay <= 30 ? "text-orange-600" : "text-gray-600"}`}>
                            {dDay > 0 ? `D-${dDay}` : dDay === 0 ? "D-Day" : `D+${Math.abs(dDay)}`}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
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
  const [obEmail, setObEmail] = useState("");
  const [obName, setObName] = useState("");
  const [obPath, setObPath] = useState(settingsOBPath);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string; groupResults?: any[] } | null>(null);

  useEffect(() => { setObPath(settingsOBPath); }, [settingsOBPath]);

  const handleOB = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!obEmail || !obPath) return;
    if (!confirm(`${obName || obEmail} 선생님을 명예퇴임 처리하시겠습니까?\n4개 그룹에서 탈퇴되고 OB 보존실(${obPath})로 OU가 이동됩니다.\n계정은 영구 보존됩니다.`)) return;
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
      if (data.success) { setObEmail(""); setObName(""); }
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">교사 이메일</label>
            <input
              type="email"
              value={obEmail}
              onChange={(e) => setObEmail(e.target.value)}
              placeholder="teacher@hmh.or.kr"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">교사 이름 (선택)</label>
            <input
              type="text"
              value={obName}
              onChange={(e) => setObName(e.target.value)}
              placeholder="예: 박영호 선생님"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
            />
          </div>
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
          disabled={loading || !obPath}
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
