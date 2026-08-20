import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
import { toTransportSafeFile } from "@/lib/tasks/logic";
import { isMessagingIneligible } from "@/lib/org/eligibility";
import MemoRichBody from "@/components/common/MemoRichBody";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting } from "@/lib/memo/richtext";

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

function formatRemainingTime(dueAtMs: number, noDue?: boolean): { text: string; isPast: boolean; isUrgent: boolean } {
  if (noDue) {
    return { text: "기한 없음", isPast: false, isUrgent: false };
  }
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

function getYearMonthKey(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms + 9 * 3600 * 1000); // KST
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}년 ${m}월`;
}

export default function MobileTasksSection() {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";
  const notEligible = isMessagingIneligible(userData, teacherProfile);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 필터 및 클라이언트 페이지네이션 (지시서 33번)
  const [filter, setFilter] = useState<"pending" | "done" | "all">("pending");
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPageSize(20);
  }, [filter]);

  // 셀프 등록 ([내 할 일 추가] 미니 입력 — 피드백 15번, 피드백 32번 서식+참고파일)
  const [isSelfAddOpen, setIsSelfAddOpen] = useState(false);
  const [selfTitle, setSelfTitle] = useState("");
  const [selfNoDue, setSelfNoDue] = useState(false);
  const [selfDueDate, setSelfDueDate] = useState(() => {
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [selfDueTime, setSelfDueTime] = useState("17:00");
  const [selfBody, setSelfBody] = useState("");
  const [selfFiles, setSelfFiles] = useState<File[]>([]);
  const [selfSubmitting, setSelfSubmitting] = useState(false);
  const [selfUploadProgress, setSelfUploadProgress] = useState<string | null>(null);

  const selfEditorRef = useRef<HTMLDivElement>(null);
  const selfFileInputRef = useRef<HTMLInputElement>(null);

  const syncSelfBodyMd1 = useCallback(() => {
    if (selfEditorRef.current) {
      const md1 = serializeDomToMd1(selfEditorRef.current);
      setSelfBody(md1);
    }
  }, []);

  // 액션 상태
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  // 완료 체크 메모 모달 (피드백 27번)
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState("");

  // 모바일 제출 대기 상태 (피드백 26번, 27번)
  const [stagedSubmitMap, setStagedSubmitMap] = useState<Record<string, { file: File; displayName: string; note: string }>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 내 할 일 구독 (다이어트 3번: 90일 기한창 적용)
  useEffect(() => {
    if (!myEmail || !domain || notEligible) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    // 90일 기한창 + 서버 정렬 + 상한 (복합 색인 2026-08-19 콘솔 생성·probe 확인 후 재적용 —
    // TasksSection 동일 주석 참조. 90일 이전 열람은 PC 전체 탭의 [지난 업무 보기] 사용)
    const windowStart = Date.now() - 90 * 24 * 3600 * 1000;
    const q = query(
      collection(db, "tasks", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      where("dueAt", ">=", windowStart),
      orderBy("dueAt", "asc"),
      limit(100)
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

        // 미완료 항목 우선, 그 다음 기한 오름차순 정렬
        list.sort((a, b) => {
          const aDone = a.statuses?.[myEmail]?.state === "DONE" ? 1 : 0;
          const bDone = b.statuses?.[myEmail]?.state === "DONE" ? 1 : 0;
          if (aDone !== bDone) return aDone - bDone;
          return (a.dueAt || 0) - (b.dueAt || 0);
        });

        setTasks(list);
        setLoading(false);
        setLoadError(null);
      },
      (err) => {
        console.error("[tasks] 모바일 할 일 구독 실패", err);
        setLoadError("할 일 목록을 불러오지 못했습니다. 새로고침해 주세요.");
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

  // 필터링 및 페이지네이션
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.canceledAt) return false;
      const st = t.statuses?.[myEmail]?.state || "PENDING";
      if (filter === "pending") return st === "PENDING" || st === "ACCEPTED";
      if (filter === "done") return st === "DONE" || st === "DECLINED";
      return true; // "all"
    });
  }, [tasks, filter, myEmail]);

  // A안 정렬: 기한 있는 업무(기한 임박순) + 기한 없는 업무(최근 추가순)
  const dueTasks = useMemo(() => {
    return filteredTasks.filter((t) => !t.noDue);
  }, [filteredTasks]);

  const noDueTasks = useMemo(() => {
    return filteredTasks
      .filter((t) => !!t.noDue)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [filteredTasks]);

  const sortedFilteredTasks = useMemo(() => {
    return [...dueTasks, ...noDueTasks];
  }, [dueTasks, noDueTasks]);

  const visibleTasks = useMemo(() => {
    if (filter === "pending") return sortedFilteredTasks;
    return sortedFilteredTasks.slice(0, pageSize);
  }, [sortedFilteredTasks, filter, pageSize]);

  const visibleDueTasks = useMemo(() => {
    return visibleTasks.filter((t) => !t.noDue);
  }, [visibleTasks]);

  const visibleNoDueTasks = useMemo(() => {
    return visibleTasks.filter((t) => !!t.noDue);
  }, [visibleTasks]);

  const hasMoreTasks = filter !== "pending" && sortedFilteredTasks.length > visibleTasks.length;

  // 셀프 등록 핸들러 (피드백 15번, 피드백 32번 서식+참고파일, task_no_due_spec §3-1)
  const handleSelfAdd = async () => {
    if (!selfTitle.trim()) {
      alert("할 일 제목을 입력해 주세요.");
      return;
    }
    let dueAt: number | undefined;
    if (!selfNoDue) {
      if (!selfDueDate || !selfDueTime) {
        alert("기한 날짜와 시각을 지정해 주세요.");
        return;
      }
      const [y, m, d] = selfDueDate.split("-").map(Number);
      const [hh, mm] = selfDueTime.split(":").map(Number);
      dueAt = Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
      if (dueAt <= Date.now()) {
        alert("기한은 현재 시각보다 이후여야 합니다.");
        return;
      }
    }

    setSelfSubmitting(true);
    setSelfUploadProgress(null);
    try {
      const finalBody = selfBody.trim();
      const hasMd1 = bodyHasMd1Formatting(finalBody);

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "self_add",
          title: selfTitle.trim(),
          ...(selfNoDue ? { noDue: true } : { dueAt }),
          body: finalBody || undefined,
          contentFormat: hasMd1 ? "md1" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.taskId) {
        throw new Error(data.error || "할 일을 추가하지 못했습니다.");
      }

      const createdTaskId = data.taskId;

      // 참고 파일 순차 업로드 (피드백 32-ⓑ)
      if (selfFiles.length > 0) {
        const failedFiles: { name: string; reason: string }[] = [];
        for (let i = 0; i < selfFiles.length; i++) {
          const file = selfFiles[i];
          setSelfUploadProgress(`참고 파일 업로드 중… (${i + 1}/${selfFiles.length})`);
          try {
            if (file.size <= 4 * 1024 * 1024) {
              const formData = new FormData();
              formData.append("action", "form_upload");
              formData.append("taskId", createdTaskId);
              formData.append("file", file);

              const upRes = await fetch("/api/tasks", {
                method: "POST",
                body: formData,
              });
              const upData = await upRes.json();
              if (!upRes.ok || !upData.success) {
                throw new Error(upData.error || "업로드 실패");
              }
            } else {
              // >4MB 세션 업로드
              const startRes = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "form_session_start",
                  taskId: createdTaskId,
                  fileName: file.name,
                  size: file.size,
                  mimeType: file.type || "application/octet-stream",
                }),
              });
              const startData = await startRes.json();
              if (!startRes.ok || !startData.success) {
                throw new Error(startData.error || "세션 생성 실패");
              }

              const driveRes = await fetch(startData.sessionUrl, {
                method: "PUT",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: file,
              });
              const driveData = await driveRes.json();
              if (!driveRes.ok || !driveData.id) {
                throw new Error("드라이브 전송 실패");
              }

              const finishRes = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "form_session_finish",
                  taskId: createdTaskId,
                  driveFileId: driveData.id,
                }),
              });
              const finishData = await finishRes.json();
              if (!finishRes.ok || !finishData.success) {
                throw new Error(finishData.error || "업로드 검증 실패");
              }
            }
          } catch (fileErr: any) {
            failedFiles.push({ name: file.name, reason: fileErr.message || "오류" });
          }
        }

        if (failedFiles.length > 0) {
          alert(`할 일은 등록되었으나, 참고 파일 ${failedFiles.length}개 업로드에 실패했습니다:\n` +
            failedFiles.map((f) => `- ${f.name} (${f.reason})`).join("\n"));
        }
      }

      setSelfTitle("");
      setSelfNoDue(false);
      setSelfBody("");
      setSelfFiles([]);
      if (selfEditorRef.current) selfEditorRef.current.innerHTML = "";
      if (selfFileInputRef.current) selfFileInputRef.current.value = "";
      setIsSelfAddOpen(false);
    } catch (err: any) {
      alert(err.message || "할 일 등록 중 오류가 발생했습니다.");
    } finally {
      setSelfSubmitting(false);
      setSelfUploadProgress(null);
    }
  };

  // 상태 전이 액션 — 피드백 7번 즉시 낙관 갱신, 피드백 27번 메모 동반
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
          note: note?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "처리에 실패했습니다.");
      }

      if (data.status) {
        setTasks((prev) =>
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
        setDecliningId(null);
        setDeclineReason("");
      }
      if (action === "done") {
        setCompletingId(null);
        setCompleteNote("");
      }
    } catch (err: any) {
      alert(err.message || "처리 중 오류가 발생했습니다.");
    } finally {
      setActionLoadingId(null);
    }
  };

  // 모바일 파일/사진 제출 — 피드백 7번 즉시 낙관 갱신, 피드백 26/27번 2단계 제출 및 메모 동반
  const handleMobileSubmit = async (taskId: string, file: File, note?: string) => {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      alert("파일 크기는 최대 30MB까지 올릴 수 있습니다. 30MB가 넘는 파일은 내 드라이브에 올린 뒤 링크를 본문에 붙여 주세요.");
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
        if (note?.trim()) {
          formData.append("note", note.trim());
        }

        const res = await fetch("/api/tasks", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "제출에 실패했습니다.");
        }

        if (data.submission) {
          const nextStatus: TaskRecipientStatus = data.status || {
            state: "DONE",
            at: Date.now(),
            note: note?.trim() || undefined,
          };
          setTasks((prev) =>
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
        setStagedSubmitMap((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
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
            note: note?.trim() || undefined,
          }),
        });
        const finishData = await finishRes.json();
        if (!finishRes.ok || !finishData.success) {
          throw new Error(finishData.error || "제출 완료 검증 실패");
        }

        if (finishData.submission) {
          const nextStatus: TaskRecipientStatus = finishData.status || {
            state: "DONE",
            at: Date.now(),
            note: note?.trim() || undefined,
          };
          setTasks((prev) =>
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

  if (notEligible) {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs px-4 py-4 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <span className="text-base mt-0.5">🔒</span>
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">내 할 일</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              조직 정보가 등록되면 업무를 쓸 수 있습니다.
            </p>
          </div>
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent("openMyProfileModal"))}
            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            내 조직 정보 신청 →
          </button>
        </div>
      </section>
    );
  }

  const renderTaskItem = (task: TaskItem, showMonthDivider: boolean, currentMonthKey: string | null) => {
    const isOpen = expandedId === task.id;
    const myStatus: TaskRecipientStatus = task.statuses?.[myEmail] || { state: "PENDING", at: 0 };
    const mySubmission: TaskSubmission | undefined = task.submissions?.[myEmail];
    const isDone = myStatus.state === "DONE";
    const isPending = myStatus.state === "PENDING";
    const remaining = formatRemainingTime(task.dueAt, task.noDue);

    const renderStagedCard = () => {
      const staged = stagedSubmitMap[task.id];
      if (!staged) return null;
      return (
        <div className="bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span>📄</span>
              <span className="font-bold text-slate-900 dark:text-white truncate">
                {staged.displayName}
              </span>
              <span className="text-[11px] text-slate-500">
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
              className="text-xs text-slate-400 hover:text-rose-600 font-bold ml-1"
            >
              취소
            </button>
          </div>

          <input
            type="text"
            value={staged.note}
            onChange={(e) =>
              setStagedSubmitMap((prev) => ({
                ...prev,
                [task.id]: { ...staged, note: e.target.value },
              }))
            }
            placeholder="제출 시 남길 메모 (선택)"
            maxLength={500}
            className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white"
          />

          {mySubmission && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
              이전 제출본은 교체되며 30일이 지나면 복구할 수 없습니다.
            </p>
          )}

          <button
            type="button"
            onClick={() => handleMobileSubmit(task.id, staged.file, staged.note)}
            disabled={submittingId === task.id}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors shadow-xs"
          >
            {submittingId === task.id ? uploadProgress || "제출 중…" : "🚀 제출 확정하기"}
          </button>
        </div>
      );
    };

    return (
      <li key={task.id} className={isPending ? "bg-indigo-50/20 dark:bg-indigo-950/20" : "bg-white dark:bg-slate-900"}>
        {showMonthDivider && currentMonthKey && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-100/80 dark:bg-slate-800/80 text-[11px] font-extrabold text-slate-600 dark:text-slate-300 select-none border-b border-slate-200/50 dark:border-slate-700/50">
            <span>📅</span>
            <span>{currentMonthKey}</span>
          </div>
        )}
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
                ? "bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-800"
                : "bg-blue-400"
            }`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1.5 text-[11px] mb-0.5">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-slate-500 dark:text-slate-400 font-medium">
                  {task.selfAssigned ? "본인 등록" : `${task.senderName} 선생님`}
                </span>
                {task.selfAssigned && (
                  <span className="text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1 py-0.2 rounded font-bold">
                    내가 등록
                  </span>
                )}
              </div>
              <span
                className={`font-bold ${
                  isDone
                    ? "text-emerald-600"
                    : isPending
                    ? "text-amber-600 font-extrabold"
                    : task.noDue
                    ? "text-slate-600 dark:text-slate-400 font-bold"
                    : remaining.isPast
                    ? "text-slate-400"
                    : remaining.isUrgent
                    ? "text-rose-500 font-extrabold"
                    : "text-indigo-600 dark:text-indigo-400"
                }`}
              >
                {isDone ? "완료됨" : isPending ? "수락 전" : remaining.text}
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
              <span>{task.noDue ? "기한 없음" : `기한: ${formatFull(task.dueAt)}`}</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {task.kind === "submit" ? "📁 파일 제출 필요" : "✅ 확인 완료 필요"}
              </span>
            </div>

            {/* 내용 (피드백 8번 '내용' + 피드백 6,9번 autolink) */}
            {task.body && (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-700/80 p-3 text-xs text-slate-800 dark:text-slate-200">
                <MemoRichBody
                  body={task.body}
                  isPlain={task.contentFormat !== "md1"}
                  className="text-xs space-y-1.5 font-sans leading-relaxed"
                />
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
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 space-y-2">
              {/* 거절 사유 또는 완료 메모 표출 (피드백 27번) */}
              {myStatus.state === "DECLINED" && myStatus.note && (
                <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-2.5 text-xs text-rose-700 dark:text-rose-300">
                  <strong>거절 사유:</strong> {myStatus.note}
                </div>
              )}
              {myStatus.state === "DONE" && myStatus.note && (
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <strong>완료 메모:</strong> {myStatus.note}
                </div>
              )}

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
                      onClick={() => {
                        setCompletingId(task.id);
                        setCompleteNote("");
                      }}
                      disabled={actionLoadingId === task.id}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <span>✅</span>
                      <span>{actionLoadingId === task.id ? "처리 중…" : "완료 체크"}</span>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      {stagedSubmitMap[task.id] ? (
                        renderStagedCard()
                      ) : (
                        <div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                const safeFile = await toTransportSafeFile(f);
                                setStagedSubmitMap((prev) => ({
                                  ...prev,
                                  [task.id]: { file: safeFile, displayName: f.name, note: "" },
                                }));
                              } catch (err) {
                                console.error("Failed to read file:", err);
                                alert("파일을 읽지 못했습니다. 다시 선택해 주세요.");
                              } finally {
                                if (fileInputRef.current) fileInputRef.current.value = "";
                              }
                            }}
                            className="hidden"
                            id={`mobile-submit-${task.id}`}
                          />
                          <label
                            htmlFor={`mobile-submit-${task.id}`}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                          >
                            <span>📁</span>
                            <span>파일/사진 선택하기</span>
                          </label>
                        </div>
                      )}
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
                    ) : !stagedSubmitMap[task.id] ? (
                      <div>
                        <input
                          type="file"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            try {
                              const safeFile = await toTransportSafeFile(f);
                              setStagedSubmitMap((prev) => ({
                                ...prev,
                                [task.id]: { file: safeFile, displayName: f.name, note: "" },
                              }));
                            } catch (err) {
                              console.error("Failed to read file:", err);
                              alert("파일을 읽지 못했습니다. 다시 선택해 주세요.");
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
                    ) : null}
                  </div>
                  {mySubmission && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      내 제출: {mySubmission.name}
                    </div>
                  )}
                  {task.kind !== "confirm" && renderStagedCard()}
                </div>
              )}

              {myStatus.state === "DECLINED" && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-rose-600 font-medium">거절됨</span>
                  <button
                    type="button"
                    onClick={() => handleTransition(task.id, "accept")}
                    disabled={actionLoadingId === task.id}
                    className="text-xs text-indigo-600 font-bold underline cursor-pointer"
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
  };

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-base">📌</span>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">내 할 일</h2>
          {pendingCount > 0 && (
            <span className="text-[11px] font-black bg-indigo-500 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {pendingCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSelfAddOpen(true)}
            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 cursor-pointer"
          >
            + 추가
          </button>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            미완료 {pendingCount} / 전체 {tasks.length}건
          </span>
        </div>
      </div>

      {/* 탭 필터 바 (지시서 33번) */}
      <div className="flex items-center border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 px-3 py-1.5 gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setFilter("pending")}
          className={`px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
            filter === "pending"
              ? "bg-indigo-600 text-white shadow-2xs"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60"
          }`}
        >
          미완료 ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter("done")}
          className={`px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
            filter === "done"
              ? "bg-indigo-600 text-white shadow-2xs"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60"
          }`}
        >
          완료됨
        </button>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
            filter === "all"
              ? "bg-indigo-600 text-white shadow-2xs"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60"
          }`}
        >
          전체 ({tasks.length})
        </button>
      </div>

      {/* 구독 오류 안내 블록 (피드백 5번 조용한 실패 금지) */}
      {loadError && (
        <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 font-semibold flex items-center justify-between">
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

      {/* 목록 */}
      {loading ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400 animate-pulse">
          할 일을 불러오는 중…
        </div>
      ) : sortedFilteredTasks.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">
          {filter === "pending" ? "남은 할 일이 없습니다." : "해당하는 업무가 없습니다."}
        </div>
      ) : (
        <div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {/* 1. 기한 있는 업무 */}
            {visibleDueTasks.map((task, idx) => {
              const currentMonthKey = getYearMonthKey(task.dueAt);
              const prevMonthKey = idx > 0 ? getYearMonthKey(visibleDueTasks[idx - 1].dueAt) : null;
              const showMonthDivider = currentMonthKey && currentMonthKey !== prevMonthKey;
              return renderTaskItem(task, !!showMonthDivider, currentMonthKey);
            })}

            {/* 2. 기한 없음 구역 (A안, 0건이면 감춤, task_no_due_spec §3-2) */}
            {visibleNoDueTasks.length > 0 && (
              <>
                <li className="bg-slate-100/90 dark:bg-slate-800/90 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 select-none border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span>📋</span>
                    <span>기한 없음</span>
                  </div>
                  <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] px-1.5 py-0.2 rounded-full font-bold">
                    {visibleNoDueTasks.length}
                  </span>
                </li>
                {visibleNoDueTasks.map((task) => renderTaskItem(task, false, null))}
              </>
            )}
          </ul>

          {/* 더 보기 버튼 (지시서 33번) */}
          {hasMoreTasks && (
            <div className="p-3 text-center border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPageSize((prev) => prev + 20)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                더 보기 ({sortedFilteredTasks.length - visibleTasks.length}개 남음) ↓
              </button>
            </div>
          )}
        </div>
      )}

    {/* [내 할 일 추가] 셀프 등록 모달 (피드백 15번, 피드백 32번 서식+참고파일) */}
    {isSelfAddOpen && (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 max-w-sm w-full space-y-3 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
              <span>📝</span>
              <span>내 할 일 추가</span>
            </h4>
            <button
              type="button"
              onClick={() => setIsSelfAddOpen(false)}
              className="text-slate-400 text-xs p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-0.5">할 일 제목 *</label>
              <input
                type="text"
                value={selfTitle}
                onChange={(e) => setSelfTitle(e.target.value)}
                placeholder="예: 교과진도표 작성"
                className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                  마감 기한 {!selfNoDue && <span className="text-rose-500">*</span>}
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selfNoDue}
                    onChange={(e) => setSelfNoDue(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>기한 없음</span>
                </label>
              </div>
              <div className={`grid grid-cols-2 gap-1.5 transition-opacity ${selfNoDue ? "opacity-50" : ""}`}>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                    마감 날짜 {!selfNoDue && <span className="text-rose-500">*</span>}
                  </label>
                  <input
                    type="date"
                    value={selfDueDate}
                    onChange={(e) => setSelfDueDate(e.target.value)}
                    disabled={selfNoDue}
                    className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:bg-slate-100 disabled:dark:bg-slate-800/50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-0.5">
                    마감 시각 {!selfNoDue && <span className="text-rose-500">*</span>}
                  </label>
                  <input
                    type="time"
                    value={selfDueTime}
                    onChange={(e) => setSelfDueTime(e.target.value)}
                    disabled={selfNoDue}
                    className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-1.5 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white disabled:bg-slate-100 disabled:dark:bg-slate-800/50 disabled:text-slate-400 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            {/* 내용 칸 (피드백 32-ⓐ 서식 지원) */}
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-0.5">내용 / 메모 (선택)</label>
              <div className="rounded-lg border border-slate-300 dark:border-slate-700 focus-within:ring-2 focus-within:ring-indigo-500 overflow-hidden">
                <MemoEditorToolbar
                  editorRef={selfEditorRef}
                  onContentChange={syncSelfBodyMd1}
                />
                <div
                  ref={selfEditorRef}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onInput={syncSelfBodyMd1}
                  onPaste={syncSelfBodyMd1}
                  onKeyUp={syncSelfBodyMd1}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="할 일 내용"
                  data-placeholder="메모를 자유롭게 적어두세요."
                  className="w-full p-2 text-xs leading-relaxed min-h-[70px] max-h-[140px] overflow-y-auto focus:outline-none bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-0.5 [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 dark:[&_blockquote]:bg-indigo-950/40 [&_blockquote]:py-0.5 [&_blockquote]:px-2 [&_blockquote]:my-0.5 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic"
                />
              </div>
            </div>

            {/* 참고 파일 추가 (피드백 32-ⓑ) */}
            <div className="space-y-1.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5">
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                  참고 파일 (최대 5개, ≤30MB)
                </div>
                {selfFiles.length < 5 && (
                  <div>
                    <input
                      ref={selfFileInputRef}
                      type="file"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (!files.length) return;
                        const validFiles: File[] = [];
                        for (const f of files) {
                          if (f.size > 30 * 1024 * 1024) {
                            alert(`30MB 초과 파일은 제외됩니다: ${f.name}`);
                            continue;
                          }
                          validFiles.push(f);
                        }
                        setSelfFiles((prev) => [...prev, ...validFiles].slice(0, 5));
                        if (selfFileInputRef.current) selfFileInputRef.current.value = "";
                      }}
                      className="hidden"
                      id="mobile-self-add-file-input"
                    />
                    <label
                      htmlFor="mobile-self-add-file-input"
                      className="px-2 py-0.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded cursor-pointer text-xs font-bold"
                    >
                      + 파일 추가
                    </label>
                  </div>
                )}
              </div>

              {selfFiles.length > 0 && (
                <div className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
                  {selfFiles.map((f, i) => (
                    <div key={i} className="px-2 py-1 flex items-center justify-between text-[11px]">
                      <span className="truncate mr-1 text-slate-800 dark:text-slate-200 flex-1">
                        📄 {f.name} ({(f.size / 1024).toFixed(0)}KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelfFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-slate-400 hover:text-rose-600 font-bold px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsSelfAddOpen(false)}
              className="px-3 py-1.5 text-xs text-slate-500 cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSelfAdd}
              disabled={selfSubmitting || !selfTitle.trim()}
              className="px-3.5 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg disabled:opacity-50 cursor-pointer shadow-2xs"
            >
              {selfSubmitting ? (selfUploadProgress || "등록 중…") : "등록하기"}
            </button>
          </div>
        </div>
      </div>
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

      {/* 모바일 완료 확인 및 선택 메모 모달 (피드백 27번) */}
      {completingId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 max-w-xs w-full space-y-3 animate-in fade-in zoom-in-95">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
              <span>✅</span>
              <span>업무 완료 처리</span>
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              완료 메모나 전달사항을 남길 수 있습니다 (선택).
            </p>
            <input
              type="text"
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              placeholder="완료 메모 (선택)"
              maxLength={500}
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCompletingId(null);
                  setCompleteNote("");
                }}
                className="px-3 py-1.5 text-xs text-slate-500"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  handleTransition(completingId, "done", completeNote.trim());
                }}
                className="px-3 py-1.5 text-xs bg-emerald-600 text-white font-bold rounded-lg shadow-xs"
              >
                완료 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
