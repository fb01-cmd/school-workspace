"use client";

// 모바일 내 할 일 섹션 — docs/phase8_tasks_spec.md §7
// 열람 + 완료 체크 + 모바일 파일/사진 제출 (사진 제출 실수요 대응)

import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import type { TaskDoc, TaskRecipientStatus, TaskSubmission } from "@/lib/tasks/logic";
import MemoRichBody from "@/components/common/MemoRichBody";

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
    return { text: pastDays === 0 ? "오늘 마감" : `${pastDays}일 지남`, isPast: true, isUrgent: false };
  }
  const hours = Math.floor(diff / (3600 * 1000));
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return { text: `D-${days}`, isPast: false, isUrgent: days <= 1 };
  }
  return { text: `${hours}시간 남음`, isPast: false, isUrgent: true };
}

export default function MobileTasksSection() {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";
  const notEligible = !!userData && !(teacherProfile?.departments?.length);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 액션 상태
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 내 할 일 구독
  useEffect(() => {
    if (!myEmail || !domain || notEligible) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "tasks", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      orderBy("dueAt", "asc"),
      limit(30)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TaskItem[] = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as TaskDoc),
          }))
          .filter((t) => !t.canceledAt); // 철회된 항목 제외

        // 미완료 항목 우선 정렬
        list.sort((a, b) => {
          const aDone = a.statuses?.[myEmail]?.state === "DONE" ? 1 : 0;
          const bDone = b.statuses?.[myEmail]?.state === "DONE" ? 1 : 0;
          if (aDone !== bDone) return aDone - bDone;
          return a.dueAt - b.dueAt;
        });

        setTasks(list);
        setLoading(false);
      },
      (err) => {
        console.error("[tasks] 모바일 할 일 구독 실패", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  const pendingCount = useMemo(() => {
    return tasks.filter((t) => {
      const st = t.statuses?.[myEmail]?.state || "PENDING";
      return st === "PENDING" || st === "ACCEPTED";
    }).length;
  }, [tasks, myEmail]);

  // 상태 전이 액션
  const handleTransition = async (taskId: string, action: "accept" | "done" | "undone" | "decline", note?: string) => {
    setActionLoadingId(taskId);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transition",
          taskId,
          transition: action,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "처리에 실패했습니다.");
      }
      if (action === "decline") {
        setDecliningId(null);
        setDeclineReason("");
      }
    } catch (err: any) {
      alert(err.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setActionLoadingId(null);
    }
  };

  // 모바일 파일/사진 제출
  const handleMobileSubmit = async (taskId: string, file: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("파일 크기는 10MB 이하로 올려 주세요.");
      return;
    }

    setSubmittingId(taskId);
    setUploadProgress("업로드 중…");
    try {
      if (file.size <= 4 * 1024 * 1024) {
        const formData = new FormData();
        formData.append("action", "submit");
        formData.append("taskId", taskId);
        formData.append("file", file);

        const res = await fetch("/api/tasks", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "제출에 실패했습니다.");
        }
        alert("제출이 완료되었습니다.");
      } else {
        // >4MB 세션 업로드
        setUploadProgress("대용량 세션 연결 중…");
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
          throw new Error(startData.error || "업로드 세션 생성 실패");
        }

        setUploadProgress("전송 중…");
        const driveRes = await fetch(startData.sessionUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const driveData = await driveRes.json();
        if (!driveRes.ok || !driveData.id) {
          throw new Error("드라이브 전송 실패");
        }

        setUploadProgress("완료 확인 중…");
        const finishRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit_session_finish",
            taskId,
            driveFileId: driveData.id,
          }),
        });
        const finishData = await finishRes.json();
        if (!finishRes.ok || !finishData.success) {
          throw new Error(finishData.error || "제출 완료 검증 실패");
        }

        alert("제출이 완료되었습니다.");
      }
    } catch (err: any) {
      alert(err.message || "제출 실패");
    } finally {
      setSubmittingId(null);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (notEligible) return null;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-base">📌</span>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">내 할 일</h2>
          {pendingCount > 0 && (
            <span className="text-[10px] font-black bg-indigo-500 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {pendingCount}
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          미완료 {pendingCount} / 전체 {tasks.length}건
        </span>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400 animate-pulse">
          할 일을 불러오는 중…
        </div>
      ) : tasks.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">
          남은 할 일이 없습니다.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {tasks.map((task) => {
            const isOpen = expandedId === task.id;
            const myStatus: TaskRecipientStatus = task.statuses?.[myEmail] || { state: "PENDING", at: 0 };
            const mySubmission: TaskSubmission | undefined = task.submissions?.[myEmail];
            const isDone = myStatus.state === "DONE";
            const isPending = myStatus.state === "PENDING";
            const remaining = formatRemainingTime(task.dueAt);

            return (
              <li key={task.id} className={isPending ? "bg-indigo-50/20 dark:bg-indigo-950/20" : "bg-white dark:bg-slate-900"}>
                {/* 목록 헤더 행 */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : task.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <span
                    className={`flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ${
                      isDone
                        ? "bg-emerald-500"
                        : isPending
                        ? "bg-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-800"
                        : "bg-blue-400"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5 text-[11px] mb-0.5">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">
                        {task.senderName} 선생님
                      </span>
                      <span
                        className={`font-bold ${
                          isDone
                            ? "text-emerald-600"
                            : remaining.isPast
                            ? "text-slate-400"
                            : remaining.isUrgent
                            ? "text-rose-500 font-extrabold"
                            : "text-indigo-600 dark:text-indigo-400"
                        }`}
                      >
                        {isDone ? "완료됨" : remaining.text}
                      </span>
                    </div>
                    <p className={`text-sm truncate ${isDone ? "text-slate-500 dark:text-slate-400 line-through" : "font-bold text-slate-900 dark:text-white"}`}>
                      {task.title}
                    </p>
                  </div>
                  <svg
                    className={`flex-shrink-0 w-4 h-4 text-slate-400 transition-transform mt-1.5 ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 상세 펼침 */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-2 bg-slate-50 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between flex-wrap gap-1">
                      <span>기한: {formatFull(task.dueAt)}</span>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        {task.kind === "submit" ? "📁 파일 제출 필요" : "✅ 확인 완료 필요"}
                      </span>
                    </div>

                    {/* 지시 본문 */}
                    {task.body && (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-700/80 p-3 text-xs text-slate-800 dark:text-slate-200">
                        {task.contentFormat === "md1" ? (
                          <MemoRichBody body={task.body} className="text-xs space-y-1.5" />
                        ) : (
                          <p className="whitespace-pre-wrap leading-relaxed">{task.body}</p>
                        )}
                      </div>
                    )}

                    {/* 양식 파일 */}
                    {task.formFiles && task.formFiles.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          양식 파일 내려받기
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {task.formFiles.map((f, i) => (
                            <a
                              key={i}
                              href={`/api/tasks/file?taskId=${task.id}&fileId=${f.driveFileId}`}
                              download
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300"
                            >
                              <span>📄</span>
                              <span className="truncate max-w-[150px]">{f.name}</span>
                              <span>↓</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 모바일 액션 컨트롤 */}
                    <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
                      {myStatus.state === "PENDING" && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleTransition(task.id, "accept")}
                            disabled={actionLoadingId === task.id}
                            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                          >
                            {actionLoadingId === task.id ? "처리 중…" : "🤝 수락하기"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDecliningId(task.id)}
                            disabled={actionLoadingId === task.id}
                            className="px-3 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-xs cursor-pointer"
                          >
                            거절
                          </button>
                        </div>
                      )}

                      {myStatus.state === "ACCEPTED" && (
                        <div>
                          {task.kind === "confirm" ? (
                            <button
                              type="button"
                              onClick={() => handleTransition(task.id, "done")}
                              disabled={actionLoadingId === task.id}
                              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                            >
                              <span>✅</span>
                              <span>{actionLoadingId === task.id ? "처리 중…" : "완료 체크"}</span>
                            </button>
                          ) : (
                            <div className="space-y-1.5">
                              <input
                                ref={fileInputRef}
                                type="file"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleMobileSubmit(task.id, f);
                                }}
                                className="hidden"
                                id={`mobile-submit-${task.id}`}
                              />
                              <label
                                htmlFor={`mobile-submit-${task.id}`}
                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                              >
                                <span>📁</span>
                                <span>{submittingId === task.id ? uploadProgress || "제출 중…" : "파일/사진 선택하여 제출"}</span>
                              </label>
                            </div>
                          )}
                        </div>
                      )}

                      {myStatus.state === "DONE" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                            <span>✅ 완료 처리됨</span>
                            {task.kind === "confirm" ? (
                              <button
                                type="button"
                                onClick={() => handleTransition(task.id, "undone")}
                                disabled={actionLoadingId === task.id}
                                className="text-[11px] text-slate-400 hover:text-slate-600 underline"
                              >
                                완료 취소
                              </button>
                            ) : (
                              <div>
                                <input
                                  type="file"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f && confirm("이전 제출본은 교체됩니다. 다시 제출하시겠습니까?")) {
                                      handleMobileSubmit(task.id, f);
                                    }
                                  }}
                                  className="hidden"
                                  id={`mobile-resubmit-${task.id}`}
                                />
                                <label
                                  htmlFor={`mobile-resubmit-${task.id}`}
                                  className="text-[11px] text-indigo-500 font-bold underline cursor-pointer"
                                >
                                  다시 제출 (교체)
                                </label>
                              </div>
                            )}
                          </div>
                          {mySubmission && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              내 제출: {mySubmission.name}
                            </div>
                          )}
                        </div>
                      )}

                      {myStatus.state === "DECLINED" && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-rose-600 font-medium">거절됨</span>
                          <button
                            type="button"
                            onClick={() => handleTransition(task.id, "accept")}
                            disabled={actionLoadingId === task.id}
                            className="text-xs text-indigo-600 font-bold underline"
                          >
                            다시 수락하기
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 거절 사유 모달 */}
      {decliningId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 max-w-xs w-full space-y-3 animate-in fade-in zoom-in-95">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">거절 사유 입력</h4>
            <input
              type="text"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="사유를 입력해 주세요"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDecliningId(null);
                  setDeclineReason("");
                }}
                className="px-3 py-1.5 text-xs text-slate-500"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!declineReason.trim()) {
                    alert("사유를 입력해 주세요.");
                    return;
                  }
                  handleTransition(decliningId, "decline", declineReason.trim());
                }}
                className="px-3 py-1.5 text-xs bg-rose-600 text-white font-bold rounded-lg"
              >
                거절 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
