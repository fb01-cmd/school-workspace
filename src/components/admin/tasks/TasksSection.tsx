"use client";

// 업무 관리 메인 컴포넌트 — docs/phase8_tasks_spec.md §7
// 탭: [📥 내 할 일] · [📤 보낸 업무 현황] · 우측 상단 [+ 새 업무 보내기] 버튼

import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import {
  collection,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import type { TaskDoc, TaskRecipientStatus, TaskSubmission } from "@/lib/tasks/logic";
import MemoRichBody from "@/components/common/MemoRichBody";
import TaskComposerModal from "./TaskComposerModal";
import TaskStatusBoard from "./TaskStatusBoard";

interface TaskItem extends TaskDoc {
  id: string;
}

function formatFull(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRemainingTime(dueAtMs: number): { text: string; isPast: boolean; isUrgent: boolean } {
  const now = Date.now();
  const diff = dueAtMs - now;
  if (diff < 0) {
    const pastDays = Math.floor(-diff / (24 * 3600 * 1000));
    return { text: pastDays === 0 ? "오늘 기한 마감" : `${pastDays}일 지남`, isPast: true, isUrgent: false };
  }
  const hours = Math.floor(diff / (3600 * 1000));
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return { text: `D-${days}`, isPast: false, isUrgent: days <= 1 };
  }
  return { text: `${hours}시간 남음`, isPast: false, isUrgent: true };
}

interface Props {
  initialTaskId?: string | null;
}

export default function TasksSection({ initialTaskId }: Props) {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "hmh.or.kr";

  // 탭: "inbox" (내 할 일) | "sent" (보낸 업무 현황)
  const [activeTab, setActiveTab] = useState<"inbox" | "sent">("inbox");
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  // 내 할 일 목록
  const [inboxTasks, setInboxTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "done" | "canceled">("pending");

  // 상세 펼침 상태
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(initialTaskId || null);

  // 셀프 등록 ([내 할 일 추가] 미니 입력 — 피드백 15번)
  const [isSelfAddOpen, setIsSelfAddOpen] = useState(false);
  const [selfTitle, setSelfTitle] = useState("");
  const [selfDueDate, setSelfDueDate] = useState(() => {
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [selfDueTime, setSelfDueTime] = useState("17:00");
  const [selfBody, setSelfBody] = useState("");
  const [selfSubmitting, setSelfSubmitting] = useState(false);

  // 거절 모달
  const [decliningTaskId, setDecliningTaskId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [transitionLoading, setTransitionLoading] = useState(false);

  // 완료 체크 메모 모달 (피드백 27번)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState("");

  // 파일 제출 대기 상태 (피드백 26번, 27번)
  const [stagedSubmitMap, setStagedSubmitMap] = useState<Record<string, { file: File; note: string }>>({});
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null);
  const [submitProgress, setSubmitProgress] = useState<string | null>(null);
  const submitFileInputRef = useRef<HTMLInputElement>(null);

  // initialTaskId가 변경되면 해당 업무 탭/상태 자동 활성화
  useEffect(() => {
    if (initialTaskId) {
      setExpandedTaskId(initialTaskId);
      setFilter("all");
    }
  }, [initialTaskId]);

  // 내 할 일 목록 실시간 구독 (다이어트 3번: 90일 기한창 적용)
  useEffect(() => {
    if (!myEmail || !domain) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const windowStart = Date.now() - 90 * 24 * 3600 * 1000;
    const q = query(
      collection(db, "tasks", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      where("dueAt", ">=", windowStart)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TaskItem[] = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as TaskDoc),
          }))
          .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
        setInboxTasks(list);
        setLoading(false);
        setLoadError(null);
      },
      (err) => {
        console.error("[tasks] 내 할 일 구독 실패", err);
        setLoadError("할 일 목록을 불러오지 못했습니다. 새로고침해 주세요.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [myEmail, domain]);

  // 필터링된 목록
  const filteredTasks = useMemo(() => {
    return inboxTasks.filter((t) => {
      const isCanceled = !!t.canceledAt;
      const status = t.statuses?.[myEmail]?.state || "PENDING";

      if (filter === "canceled") return isCanceled;
      if (isCanceled) return false;
      if (filter === "all") return true;
      if (filter === "pending") return status === "PENDING" || status === "ACCEPTED";
      if (filter === "done") return status === "DONE";
      return true;
    });
  }, [inboxTasks, filter, myEmail]);

  // 미완료 할 일 건수
  const pendingCount = useMemo(() => {
    return inboxTasks.filter((t) => {
      if (t.canceledAt) return false;
      const st = t.statuses?.[myEmail]?.state || "PENDING";
      return st === "PENDING" || st === "ACCEPTED";
    }).length;
  }, [inboxTasks, myEmail]);

  // 셀프 등록 핸들러 (피드백 15번)
  const handleSelfAdd = async () => {
    if (!selfTitle.trim()) {
      alert("할 일 제목을 입력해 주세요.");
      return;
    }
    if (!selfDueDate || !selfDueTime) {
      alert("기한 날짜와 시각을 지정해 주세요.");
      return;
    }
    const [y, m, d] = selfDueDate.split("-").map(Number);
    const [hh, mm] = selfDueTime.split(":").map(Number);
    const dueAt = Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
    if (dueAt <= Date.now()) {
      alert("기한은 현재 시각보다 이후여야 합니다.");
      return;
    }

    setSelfSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "self_add",
          title: selfTitle.trim(),
          dueAt,
          body: selfBody.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "할 일을 추가하지 못했습니다.");
      }

      setSelfTitle("");
      setSelfBody("");
      setIsSelfAddOpen(false);
    } catch (err: any) {
      alert(err.message || "할 일 등록 중 오류가 발생했습니다.");
    } finally {
      setSelfSubmitting(false);
    }
  };

  // 상태 전이 액션 (accept, done, undone, decline) — 피드백 7번 즉시 낙관 갱신, 피드백 27번 메모 동반
  const handleTransition = async (taskId: string, action: "accept" | "done" | "undone" | "decline", note?: string) => {
    setTransitionLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transition",
          taskId,
          transition: action,
          note: note?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "상태 변경에 실패했습니다.");
      }

      // 피드백 7번: 응답의 status 즉시 로컬 반영
      if (data.status) {
        setInboxTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              statuses: {
                ...t.statuses,
                [myEmail]: data.status,
              },
            };
          })
        );
      }

      if (action === "decline") {
        setDecliningTaskId(null);
        setDeclineReason("");
      }
      if (action === "done") {
        setCompletingTaskId(null);
        setCompleteNote("");
      }
    } catch (err: any) {
      alert(err.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setTransitionLoading(false);
    }
  };

  // 파일 제출 처리 (<=4MB: multipart / >4MB: resumable session) — 피드백 26번, 27번 note 동반 및 대기 해제
  const handleSubmitFile = async (taskId: string, file: File, note?: string) => {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      alert("파일 크기는 최대 30MB까지 올릴 수 있습니다. 30MB가 넘는 파일은 내 드라이브에 올린 뒤 링크를 본문에 붙여 주세요.");
      return;
    }

    setSubmittingTaskId(taskId);
    setSubmitProgress("파일을 검증하고 업로드하는 중…");

    try {
      if (file.size <= 4 * 1024 * 1024) {
        // 서버 경유 multipart 경로
        const formData = new FormData();
        formData.append("action", "submit");
        formData.append("taskId", taskId);
        formData.append("file", file);
        if (note?.trim()) {
          formData.append("note", note.trim());
        }

        const res = await fetch("/api/tasks", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "파일 제출에 실패했습니다.");
        }

        if (data.submission) {
          const nextStatus: TaskRecipientStatus = data.status || {
            state: "DONE",
            at: Date.now(),
            note: note?.trim() || undefined,
          };
          setInboxTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    statuses: { ...t.statuses, [myEmail]: nextStatus },
                    submissions: { ...t.submissions, [myEmail]: data.submission },
                  }
                : t
            )
          );
        }
        // 대기 맵 정리
        setStagedSubmitMap((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        alert("제출이 완료되었습니다.");
      } else {
        // 4MB 초과: resumable session 경로 (§5-4)
        setSubmitProgress("대용량 업로드 세션을 연결하는 중…");
        const startRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit_session_start",
            taskId,
            fileName: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
          }),
        });
        const startData = await startRes.json();
        if (!startRes.ok || !startData.success) {
          throw new Error(startData.error || "대용량 업로드 세션 발급에 실패했습니다.");
        }

        setSubmitProgress("파일 데이터를 전송하는 중…");
        const driveRes = await fetch(startData.sessionUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const driveData = await driveRes.json();
        if (!driveRes.ok || !driveData.id) {
          throw new Error("드라이브 직접 전송에 실패했습니다.");
        }

        setSubmitProgress("제출 정보를 확인하고 완료 처리하는 중…");
        const finishRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit_session_finish",
            taskId,
            driveFileId: driveData.id,
            note: note?.trim() || undefined,
          }),
        });
        const finishData = await finishRes.json();
        if (!finishRes.ok || !finishData.success) {
          throw new Error(finishData.error || "제출 완료 검증에 실패했습니다.");
        }

        if (finishData.submission) {
          const nextStatus: TaskRecipientStatus = { state: "DONE", at: Date.now() };
          setInboxTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    statuses: { ...t.statuses, [myEmail]: nextStatus },
                    submissions: { ...t.submissions, [myEmail]: finishData.submission },
                  }
                : t
            )
          );
        }
        alert("대용량 파일 제출이 완료되었습니다.");
      }
    } catch (err: any) {
      alert(err.message || "제출 중 오류가 발생했습니다.");
    } finally {
      setSubmittingTaskId(null);
      setSubmitProgress(null);
      if (submitFileInputRef.current) submitFileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* 상단 타이틀 & 탭 전환 & 새 업무 작성 버튼 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <span>📌</span>
            <span>교직원 업무 관리</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            공지 확인 및 서식 파일 제출 업무를 전달하고, 실시간 처리 현황을 확인합니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* 탭 전환 */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab("inbox")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "inbox"
                  ? "bg-white text-indigo-700 shadow-2xs font-extrabold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📥 내 할 일</span>
              {pendingCount > 0 && (
                <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("sent")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "sent"
                  ? "bg-white text-indigo-700 shadow-2xs font-extrabold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📤 보낸 업무 현황</span>
            </button>
          </div>

          {/* 업무 등록 버튼 (피드백 15번 명칭) */}
          <button
            type="button"
            onClick={() => setIsComposerOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span>+ 업무 등록</span>
          </button>
        </div>
      </div>

      {/* ── 탭 1: 내 할 일 ── */}
      {activeTab === "inbox" && (
        <div className="space-y-4">
          {/* 구독 오류 안내 블록 (피드백 5번 조용한 실패 금지) */}
          {loadError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-center justify-between">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-rose-700 underline font-bold ml-2"
              >
                새로고침
              </button>
            </div>
          )}

          {/* 필터 칩 및 셀프 등록 버튼 */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`px-3 py-1.5 rounded-full font-bold transition-colors cursor-pointer ${
                  filter === "pending"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                미완료 할 일 ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("done")}
                className={`px-3 py-1.5 rounded-full font-bold transition-colors cursor-pointer ${
                  filter === "done"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                완료됨 / 거절
              </button>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 rounded-full font-bold transition-colors cursor-pointer ${
                  filter === "all"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                전체 보기 ({inboxTasks.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("canceled")}
                className={`px-3 py-1.5 rounded-full font-bold transition-colors cursor-pointer ${
                  filter === "canceled"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                철회된 업무
              </button>
            </div>

            {/* 내 할 일 추가 버튼 (피드백 15번) */}
            <button
              type="button"
              onClick={() => setIsSelfAddOpen(true)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-full transition-colors cursor-pointer border border-slate-200"
            >
              <span>+ 내 할 일 추가</span>
            </button>
          </div>

          {/* 할 일 목록 */}
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">할 일 목록을 불러오는 중…</div>
          ) : filteredTasks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-2">
              <span className="text-3xl block opacity-60">🎉</span>
              <h3 className="text-sm font-bold text-slate-800">
                {filter === "pending" ? "처리할 업무가 모두 끝났습니다!" : "해당하는 업무가 없습니다."}
              </h3>
              <p className="text-xs text-slate-500">
                새로운 업무가 배정되면 알림과 함께 이곳에 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => {
                const isExpanded = expandedTaskId === task.id;
                const isCanceled = !!task.canceledAt;
                const myStatus: TaskRecipientStatus = task.statuses?.[myEmail] || { state: "PENDING", at: 0 };
                const mySubmission: TaskSubmission | undefined = task.submissions?.[myEmail];
                const remaining = formatRemainingTime(task.dueAt);

                return (
                  <div
                    key={task.id}
                    className={`bg-white border rounded-2xl transition-all shadow-2xs overflow-hidden ${
                      isExpanded
                        ? "border-indigo-300 ring-1 ring-indigo-200"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* 카드 헤더 행 */}
                    <div
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="p-4 sm:p-5 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          {/* 상태 뱃지 */}
                          {isCanceled ? (
                            <span className="bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">
                              철회됨
                            </span>
                          ) : myStatus.state === "DONE" ? (
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-full">
                              ✓ 처리 완료
                            </span>
                          ) : myStatus.state === "ACCEPTED" ? (
                            <span className="bg-blue-50 text-blue-700 border border-blue-200 font-bold px-2 py-0.5 rounded-full">
                              ● 수락됨 (진행 중)
                            </span>
                          ) : myStatus.state === "DECLINED" ? (
                            <span className="bg-rose-50 text-rose-700 border border-rose-200 font-bold px-2 py-0.5 rounded-full">
                              ✕ 거절됨
                            </span>
                          ) : (
                            <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2 py-0.5 rounded-full animate-pulse">
                              수락 전
                            </span>
                          )}

                          {/* 내가 등록한 업무 뱃지 (피드백 15번) */}
                          {task.selfAssigned && (
                            <span className="bg-slate-100 text-slate-700 border border-slate-200 font-bold px-2 py-0.5 rounded-full text-[11px]">
                              내가 등록
                            </span>
                          )}

                          {/* 업무 유형 */}
                          <span
                            className={`font-semibold px-2 py-0.5 rounded-full text-[11px] ${
                              task.kind === "submit"
                                ? "bg-purple-50 text-purple-700 border border-purple-200"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {task.kind === "submit" ? "📁 제출형" : "✅ 확인형"}
                          </span>

                          {/* 기한 */}
                          {!isCanceled && (
                            <span
                              className={`font-bold text-[11px] ${
                                remaining.isPast
                                  ? "text-slate-400"
                                  : remaining.isUrgent
                                  ? "text-rose-600 font-extrabold"
                                  : "text-indigo-600"
                              }`}
                            >
                              기한: {formatFull(task.dueAt)} ({remaining.text})
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                          {task.title}
                        </h3>

                        <div className="text-xs text-slate-500">
                          {task.selfAssigned ? (
                            <span>본인 등록 · {formatFull(task.createdAt)}</span>
                          ) : (
                            <span>보낸 분: <strong className="text-slate-700">{task.senderName}</strong> 선생님 · {formatFull(task.createdAt)}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <svg
                          className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* 카드 펼침 세부 내용 및 액션 영역 */}
                    {isExpanded && (
                      <div className="px-4 sm:px-5 pb-5 pt-2 border-t border-slate-100 bg-slate-50/50 space-y-4">
                        {/* 본문 (피드백 8번 '내용'으로 통일 + 피드백 6,9번 MemoRichBody autolink) */}
                        {task.body && (
                          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5 shadow-2xs">
                            <div className="text-xs font-bold text-slate-500">내용</div>
                            <MemoRichBody
                              body={task.body}
                              isPlain={task.contentFormat !== "md1"}
                              className="text-xs text-slate-800 leading-relaxed font-sans"
                            />
                          </div>
                        )}

                        {/* 배포 양식 파일 다운로드 */}
                        {task.formFiles && task.formFiles.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-bold text-slate-700">작성 양식 파일 내려받기</div>
                            <div className="flex flex-wrap gap-2">
                              {task.formFiles.map((f, i) => (
                                <a
                                  key={i}
                                  href={`/api/tasks/file?taskId=${task.id}&fileId=${f.driveFileId}`}
                                  download
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-600 rounded-xl text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
                                >
                                  <span>📄</span>
                                  <span>{f.name}</span>
                                  <span className="text-slate-400 text-[10px]">
                                    ({(f.size / 1024).toFixed(0)} KB)
                                  </span>
                                  <span>↓</span>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 거절 사유 또는 완료 메모 표출 (피드백 27번) */}
                        {myStatus.state === "DECLINED" && myStatus.note && (
                          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800">
                            <strong>내가 입력한 거절 사유:</strong> {myStatus.note}
                          </div>
                        )}
                        {myStatus.state === "DONE" && myStatus.note && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
                            <strong>내가 남긴 완료 메모:</strong> {myStatus.note}
                          </div>
                        )}

                        {/* 액션 컨트롤 박스 */}
                        {!isCanceled && (
                          <div className="pt-2 border-t border-slate-200/80">
                            {/* 1) PENDING 상태: 수락 / 거절 */}
                            {myStatus.state === "PENDING" && (
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleTransition(task.id, "accept")}
                                  disabled={transitionLoading}
                                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
                                >
                                  {transitionLoading ? "처리 중…" : "🤝 업무 수락하기"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDecliningTaskId(task.id)}
                                  disabled={transitionLoading}
                                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                                >
                                  거절하기
                                </button>
                              </div>
                            )}

                            {/* 2) ACCEPTED 상태 (진행 중) */}
                            {myStatus.state === "ACCEPTED" && (
                              <div className="space-y-3">
                                {task.kind === "confirm" ? (
                                  /* 확인형: 완료 체크 (피드백 27번: 선택 메모 다이얼로그) */
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCompletingTaskId(task.id);
                                        setCompleteNote("");
                                      }}
                                      disabled={transitionLoading}
                                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
                                    >
                                      <span>✅</span>
                                      <span>{transitionLoading ? "처리 중…" : "업무 처리 완료 체크"}</span>
                                    </button>
                                  </div>
                                ) : (
                                  /* 제출형: 파일 선택 → 대기 카드 → 제출 버튼 2단계 흐름 (피드백 26번, 27번) */
                                  <div className="space-y-2">
                                    <div className="text-xs font-bold text-slate-800">
                                      과제/서식 파일 제출하기
                                    </div>
                                    {(() => {
                                      const staged = stagedSubmitMap[task.id];
                                      if (staged) {
                                        return (
                                          <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-2">
                                                <span className="text-base">📄</span>
                                                <div>
                                                  <p className="text-xs font-bold text-slate-900 truncate max-w-xs sm:max-w-md">
                                                    {staged.file.name}
                                                  </p>
                                                  <p className="text-[10px] text-slate-500">
                                                    {(staged.file.size / 1024).toFixed(0)} KB · 제출 준비 완료
                                                  </p>
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-1.5">
                                                <input
                                                  type="file"
                                                  onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    if (f) {
                                                      setStagedSubmitMap((prev) => ({
                                                        ...prev,
                                                        [task.id]: { file: f, note: staged.note },
                                                      }));
                                                    }
                                                  }}
                                                  className="hidden"
                                                  id={`change-file-${task.id}`}
                                                />
                                                <label
                                                  htmlFor={`change-file-${task.id}`}
                                                  className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors"
                                                >
                                                  파일 바꾸기
                                                </label>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setStagedSubmitMap((prev) => {
                                                      const n = { ...prev };
                                                      delete n[task.id];
                                                      return n;
                                                    });
                                                  }}
                                                  className="px-2 py-1 text-slate-400 hover:text-rose-600 font-bold text-xs cursor-pointer"
                                                  title="제거"
                                                >
                                                  ✕
                                                </button>
                                              </div>
                                            </div>

                                            {/* 전달 코멘트 한 줄 (피드백 27번) */}
                                            <div className="flex items-center gap-2">
                                              <input
                                                type="text"
                                                value={staged.note}
                                                onChange={(e) =>
                                                  setStagedSubmitMap((prev) => ({
                                                    ...prev,
                                                    [task.id]: { ...staged, note: e.target.value },
                                                  }))
                                                }
                                                placeholder="제출 시 남길 간단한 메모 (선택, 최대 500자)"
                                                maxLength={500}
                                                className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleSubmitFile(task.id, staged.file, staged.note)}
                                                disabled={submittingTaskId === task.id}
                                                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                                              >
                                                {submittingTaskId === task.id ? "제출 중…" : "🚀 제출 확정"}
                                              </button>
                                            </div>

                                            {submittingTaskId === task.id && submitProgress && (
                                              <p className="text-xs text-indigo-600 font-bold animate-pulse">
                                                {submitProgress}
                                              </p>
                                            )}
                                          </div>
                                        );
                                      }

                                      return (
                                        <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-white rounded-xl p-4 text-center space-y-2 transition-colors">
                                          <input
                                            ref={submitFileInputRef}
                                            type="file"
                                            onChange={(e) => {
                                              const file = e.target.files?.[0];
                                              if (file) {
                                                setStagedSubmitMap((prev) => ({
                                                  ...prev,
                                                  [task.id]: { file, note: "" },
                                                }));
                                              }
                                            }}
                                            className="hidden"
                                            id={`submit-file-${task.id}`}
                                          />
                                          <label
                                            htmlFor={`submit-file-${task.id}`}
                                            className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-xs"
                                          >
                                            📁 파일 선택하기
                                          </label>
                                          <p className="text-[11px] text-slate-400">
                                            한글, 오피스, PDF, 이미지 등 (최대 30MB) · 파일을 선택하면 확인 후 제출할 수 있습니다.
                                          </p>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 3) DONE 상태: 완료됨 */}
                            {myStatus.state === "DONE" && (
                              <div className="space-y-2">
                                {task.kind === "confirm" ? (
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-emerald-700 font-bold flex items-center gap-1">
                                      <span>✅</span>
                                      <span>완료 처리되었습니다. ({formatFull(myStatus.at)})</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleTransition(task.id, "undone")}
                                      disabled={transitionLoading}
                                      className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                                    >
                                      완료 취소 (다시 진행 중으로)
                                    </button>
                                  </div>
                                ) : (
                                  <div className="bg-white border border-emerald-200 rounded-xl p-3.5 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                                        <span>✅</span>
                                        <span>제출 완료 ({formatFull(myStatus.at)})</span>
                                      </div>
                                      <div>
                                        <input
                                          type="file"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                              setStagedSubmitMap((prev) => ({
                                                ...prev,
                                                [task.id]: { file, note: "" },
                                              }));
                                            }
                                          }}
                                          className="hidden"
                                          id={`resubmit-file-${task.id}`}
                                        />
                                        <label
                                          htmlFor={`resubmit-file-${task.id}`}
                                          className="text-xs text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
                                        >
                                          파일 다시 제출 (교체)
                                        </label>
                                      </div>
                                    </div>

                                    {/* 재제출 대기 카드 표출 (피드백 26번) */}
                                    {(() => {
                                      const staged = stagedSubmitMap[task.id];
                                      if (!staged) return null;
                                      return (
                                        <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3 space-y-2">
                                          <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-1.5">
                                              <span>📄</span>
                                              <span className="font-bold text-slate-900 truncate max-w-xs">
                                                {staged.file.name}
                                              </span>
                                              <span className="text-[10px] text-slate-500">
                                                ({(staged.file.size / 1024).toFixed(0)} KB)
                                              </span>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setStagedSubmitMap((prev) => {
                                                  const n = { ...prev };
                                                  delete n[task.id];
                                                  return n;
                                                });
                                              }}
                                              className="text-xs text-slate-400 hover:text-rose-600 font-bold"
                                            >
                                              취소
                                            </button>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={staged.note}
                                              onChange={(e) =>
                                                setStagedSubmitMap((prev) => ({
                                                  ...prev,
                                                  [task.id]: { ...staged, note: e.target.value },
                                                }))
                                              }
                                              placeholder="재제출 메모 (선택)"
                                              maxLength={500}
                                              className="flex-1 px-3 py-1 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => handleSubmitFile(task.id, staged.file, staged.note)}
                                              disabled={submittingTaskId === task.id}
                                              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold"
                                            >
                                              {submittingTaskId === task.id ? "교체 중…" : "교체 제출"}
                                            </button>
                                          </div>
                                          {submittingTaskId === task.id && submitProgress && (
                                            <p className="text-xs text-indigo-600 font-bold animate-pulse">
                                              {submitProgress}
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })()}

                                    {mySubmission && (
                                      <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
                                        <span className="font-semibold text-slate-800 truncate mr-2">
                                          📄 {mySubmission.name}
                                        </span>
                                        <a
                                          href={`/api/tasks/file?taskId=${task.id}&fileId=${mySubmission.driveFileId}`}
                                          download
                                          className="text-indigo-600 hover:text-indigo-800 font-bold flex-shrink-0"
                                        >
                                          내 제출물 확인 ↓
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 4) DECLINED 상태: 다시 수락하기 */}
                            {myStatus.state === "DECLINED" && (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-rose-700 font-semibold">
                                  거절 처리된 업무입니다.
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleTransition(task.id, "accept")}
                                  disabled={transitionLoading}
                                  className="px-4 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                >
                                  다시 수락하기
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 탭 2: 보낸 업무 현황판 ── */}
      {activeTab === "sent" && <TaskStatusBoard />}

      {/* 새 업무 작성 모달 */}
      <TaskComposerModal
        isOpen={isComposerOpen}
        onClose={() => setIsComposerOpen(false)}
        onSuccess={() => {
          setActiveTab("sent");
        }}
      />

      {/* [내 할 일 추가] 셀프 등록 모달 (피드백 15번) */}
      {isSelfAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <span>📝</span>
                <span>내 할 일 추가</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsSelfAddOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  할 일 제목 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={selfTitle}
                  onChange={(e) => setSelfTitle(e.target.value)}
                  placeholder="예: 2학기 교과진도표 작성"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 font-medium"
                  maxLength={100}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    마감 날짜 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={selfDueDate}
                    onChange={(e) => setSelfDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    마감 시각 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={selfDueTime}
                    onChange={(e) => setSelfDueTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">메모/내용 (선택)</label>
                <textarea
                  rows={3}
                  value={selfBody}
                  onChange={(e) => setSelfBody(e.target.value)}
                  placeholder="유의사항이나 메모를 자유롭게 적어두세요."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
                  maxLength={1000}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSelfAddOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSelfAdd}
                disabled={selfSubmitting || !selfTitle.trim()}
                className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                {selfSubmitting ? "등록 중…" : "등록하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거절 사유 입력 모달 */}
      {decliningTaskId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h4 className="text-sm font-bold text-slate-900">업무 거절 사유 입력</h4>
              <p className="text-xs text-slate-500 mt-1">
                업무를 수행하기 어려운 사유를 입력해 주세요. (발신 선생님께 전달됩니다)
              </p>
            </div>
            <textarea
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="예: 해당 기간 출장 일정으로 인하여 작성이 어렵습니다."
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 text-slate-900"
              maxLength={500}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setDecliningTaskId(null);
                  setDeclineReason("");
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!declineReason.trim()) {
                    alert("거절 사유를 입력해 주세요.");
                    return;
                  }
                  handleTransition(decliningTaskId, "decline", declineReason.trim());
                }}
                disabled={transitionLoading || !declineReason.trim()}
                className="px-4 py-1.5 text-xs font-bold bg-rose-600 text-white rounded-xl hover:bg-rose-700 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                {transitionLoading ? "처리 중…" : "거절 확정"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 완료 확인 및 선택 메모 모달 (피드백 27번) */}
      {completingTaskId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>✅</span>
                <span>업무 처리 완료</span>
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                업무를 완료 처리합니다. 발신 선생님께 남길 간단한 메모나 코멘트가 있다면 적어주세요. (선택 사항)
              </p>
            </div>
            <textarea
              rows={3}
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              placeholder="예: 요청하신 서류 확인 후 교무실 서랍에 비치해 두었습니다. (선택)"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-slate-900"
              maxLength={500}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setCompletingTaskId(null);
                  setCompleteNote("");
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  handleTransition(completingTaskId, "done", completeNote.trim());
                }}
                disabled={transitionLoading}
                className="px-4 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                {transitionLoading ? "처리 중…" : "완료 확정"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
