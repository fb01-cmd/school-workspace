"use client";

// 업무 관리 메인 컴포넌트 — docs/phase8_tasks_spec.md §7
// 탭: [📥 내 할 일] · [📤 보낸 업무 현황] · 우측 상단 [+ 새 업무 보내기] 버튼

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
  getDocs,
} from "firebase/firestore";
import type { TaskDoc, TaskRecipientStatus, TaskSubmission } from "@/lib/tasks/logic";
import { toTransportSafeFile } from "@/lib/tasks/logic";
import { canUseMessaging } from "@/lib/org/eligibility";
import MemoRichBody from "@/components/common/MemoRichBody";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting, unescapeMd1Literal } from "@/lib/memo/richtext";
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

function formatRemainingTime(dueAtMs: number, noDue?: boolean): { text: string; isPast: boolean; isUrgent: boolean } {
  if (noDue) {
    return { text: "기한 없음", isPast: false, isUrgent: false };
  }
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

function getYearMonthKey(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms + 9 * 3600 * 1000); // KST
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}년 ${m}월`;
}

interface Props {
  initialTaskId?: string | null;
  initialTab?: "inbox" | "sent";
}

export default function TasksSection({ initialTaskId, initialTab }: Props) {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "hmh.or.kr";

  // 발신 자격 = 교직원 조직도에 부서 등록 여부 (§4)
  const canSend = canUseMessaging(userData, teacherProfile);

  // 탭: "inbox" (내 할 일) | "sent" (보낸 업무 현황)
  const [activeTab, setActiveTab] = useState<"inbox" | "sent">(initialTab || "inbox");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [isComposerOpen, setIsComposerOpen] = useState(false);

  // 내 할 일 목록
  const [inboxTasks, setInboxTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "done" | "canceled">("pending");

  // 클라이언트 페이지네이션 (지시서 33번: 전체/완료/철회 탭 대상 25개씩)
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => {
    setPageSize(25);
  }, [filter]);

  // 90일 이전 기록 — 상시 구독 밖, 버튼 클릭 시 1회 조회 (기한창 재적용의 열람 출구)
  const [olderTasks, setOlderTasks] = useState<TaskItem[]>([]);
  const [olderLoaded, setOlderLoaded] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const loadOlderTasks = async () => {
    if (olderLoading || olderLoaded || !myEmail || !domain) return;
    setOlderLoading(true);
    setOlderError(null); // 다시 누르면 지난 오류 문구는 지운다
    try {
      const windowStart = Date.now() - 90 * 24 * 3600 * 1000;
      const snap = await getDocs(
        query(
          collection(db, "tasks", domain, "items"),
          where("recipientEmails", "array-contains", myEmail),
          where("dueAt", "<", windowStart),
          orderBy("dueAt", "desc"),
          limit(100)
        )
      );
      setOlderTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as TaskDoc) })));
      setOlderLoaded(true);
    } catch (err) {
      console.error("[tasks] 지난 업무 조회 실패", err);
      // 종전에는 alert 로 "잠시 후 다시 시도해 주세요"를 띄웠다. 두 가지가 틀렸다
      // (2026-08-21 사용자 신고 → 콘솔 실측으로 원인 확인):
      //  ① 이 경로는 **실패했을 때만** 온다(빈 결과는 아래 "90일 이전 기록이 없습니다").
      //     그런데 문구가 일시적 장애처럼 읽혀, 기록이 있는데 못 불러온 것으로 오해된다.
      //  ② 실제 원인은 Firestore 복합 인덱스 미생성이었다. 인덱스가 없으면 시간이
      //     지나도 절대 성공하지 않으므로 "잠시 후 다시"는 영원히 거짓말이다.
      // 화면 안 문구로 내리고, 시간이 해결해 준다는 약속을 뺀다.
      setOlderError("지난 업무를 불러오지 못했습니다. 다시 눌러도 같으면 관리자에게 알려 주세요.");
    } finally {
      setOlderLoading(false);
    }
  };

  // 상세 펼침 상태
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(initialTaskId || null);

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

  // 거절 모달
  const [decliningTaskId, setDecliningTaskId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [transitionLoading, setTransitionLoading] = useState(false);

  // 완료 체크 메모 모달 (피드백 27번)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completeNote, setCompleteNote] = useState("");

  // 파일 제출 대기 상태 (피드백 26번, 27번)
  const [stagedSubmitMap, setStagedSubmitMap] = useState<Record<string, { file: File; displayName: string; note: string }>>({});
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

  // 내 할 일 목록 실시간 구독 — 90일 기한창 + 서버 정렬 + 상한 (다이어트 3번 재적용:
  // recipientEmails 배열 + dueAt 복합 색인을 사용자가 2026-08-19 콘솔 생성, admin probe INDEX_OK 확인 후 적용.
  // 90일 이전 기록은 아래 loadOlderTasks(1회 조회)로 열람 — 구독 상시 비용에서 제외)
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

  // 필터링된 목록 (구독분 + 불러온 90일 이전 기록)
  const filteredTasks = useMemo(() => {
    const combined = olderTasks.length > 0 ? [...inboxTasks, ...olderTasks] : inboxTasks;
    return combined.filter((t) => {
      const isCanceled = !!t.canceledAt;
      const status = t.statuses?.[myEmail]?.state || "PENDING";

      if (filter === "canceled") return isCanceled;
      if (isCanceled) return false;
      if (filter === "all") return true;
      if (filter === "pending") return status === "PENDING" || status === "ACCEPTED";
      if (filter === "done") return status === "DONE";
      return true;
    });
  }, [inboxTasks, olderTasks, filter, myEmail]);

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

  // 클라이언트 페이지네이션 (지시서 33번: 전체/완료/철회 탭 대상 25개씩)
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

  // 미완료 할 일 건수 (기한 없는 항목 포함)
  const pendingCount = useMemo(() => {
    return inboxTasks.filter((t) => {
      if (t.canceledAt) return false;
      const st = t.statuses?.[myEmail]?.state || "PENDING";
      return st === "PENDING" || st === "ACCEPTED";
    }).length;
  }, [inboxTasks, myEmail]);

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
          // 평문으로 강등해 보낼 땐 이스케이프를 풀어 저장한다 (2026-08-21)
          body: (hasMd1 ? finalBody : unescapeMd1Literal(finalBody)) || undefined,
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

  const renderTaskCard = (task: TaskItem, monthDividerKey: string | null) => {
    const isExpanded = expandedTaskId === task.id;
    const isCanceled = !!task.canceledAt;
    const myStatus: TaskRecipientStatus = task.statuses?.[myEmail] || { state: "PENDING", at: 0 };
    const mySubmission: TaskSubmission | undefined = task.submissions?.[myEmail];
    const remaining = formatRemainingTime(task.dueAt, task.noDue);

    return (
      <div key={task.id} className="space-y-3">
        {monthDividerKey && (
          <div className="flex items-center gap-3 pt-2 pb-1 text-sm select-none">
            <span className="h-px flex-1 bg-slate-200" />
            <span className="px-3 py-1 bg-slate-100/90 text-slate-600 font-extrabold rounded-full border border-slate-200 shadow-2xs">
              📅 {monthDividerKey}
            </span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        )}

        <div
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
            {/* 1행: 발신자 및 메타 정보 */}
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="font-semibold text-slate-600">
                {task.selfAssigned ? "본인 등록" : `${task.senderName} 선생님`}
              </span>
              {task.selfAssigned && (
                <span className="text-[11px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                  내가 등록
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-500 font-medium">
                {task.noDue ? "기한 없음" : `기한: ${formatFull(task.dueAt)}`}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500 font-medium">
                {task.kind === "submit" ? "📁 파일 제출 필요" : "✅ 확인형 업무"}
              </span>
            </div>

            {/* 2행: 업무 제목 */}
            <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {task.title}
            </h3>
          </div>

          {/* 우측: 상태 칩 & D-Day 뱃지 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isCanceled ? (
              <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-full text-sm font-bold">
                🚫 철회됨
              </span>
            ) : myStatus.state === "DONE" ? (
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-extrabold flex items-center gap-1">
                <span>✅</span>
                <span>완료됨</span>
              </span>
            ) : myStatus.state === "DECLINED" ? (
              <span className="px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full text-sm font-bold">
                거절함
              </span>
            ) : myStatus.state === "ACCEPTED" ? (
              <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-extrabold flex items-center gap-1">
                <span>진행 중</span>
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full text-sm font-extrabold flex items-center gap-1">
                <span>수락 전</span>
              </span>
            )}

            {!isCanceled && myStatus.state !== "DONE" && (
              <span
                className={`px-2.5 py-1 rounded-full text-sm font-black ${
                  task.noDue
                    ? "bg-slate-100 text-slate-600 border border-slate-200"
                    : remaining.isPast
                    ? "bg-slate-200 text-slate-700"
                    : remaining.isUrgent
                    ? "bg-rose-500 text-white animate-pulse"
                    : "bg-indigo-50 text-indigo-700 border border-indigo-200"
                }`}
              >
                {remaining.text}
              </span>
            )}

            <span className="text-slate-400 text-xs pl-1">
              {isExpanded ? "▲" : "▼"}
            </span>
          </div>
        </div>

        {/* 카드 펼침 상세 영역 */}
        {isExpanded && (
          <div className="px-4 pb-5 sm:px-5 sm:pb-6 pt-2 border-t border-slate-100 space-y-4 bg-slate-50/40">
            {/* 업무 내용 (피드백 8번 '내용' + 피드백 6,9번 autolink) */}
            {task.body && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-1.5 shadow-2xs">
                <div className="text-sm font-bold text-slate-700">내용</div>
                <MemoRichBody
                  body={task.body}
                  isPlain={task.contentFormat !== "md1"}
                  className="text-sm text-slate-800 leading-relaxed font-sans"
                />
              </div>
            )}

            {/* 배포 양식 파일 다운로드 */}
            {task.formFiles && task.formFiles.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-sm font-bold text-slate-700">작성 양식 파일 내려받기</div>
                <div className="flex flex-wrap gap-2">
                  {task.formFiles.map((f, i) => (
                    <a
                      key={i}
                      href={`/api/tasks/file?taskId=${task.id}&fileId=${f.driveFileId}`}
                      download
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-600 rounded-xl text-sm font-semibold text-slate-700 transition-colors shadow-2xs"
                    >
                      <span>📄</span>
                      <span>{f.name}</span>
                      <span className="text-slate-400 text-[11px]">
                        ({(f.size / 1024).toFixed(0)} KB)
                      </span>
                      <span>↓</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* 거절 사유 또는 완료 메모 표시 (피드백 27번) */}
            {myStatus.state === "DECLINED" && myStatus.note && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800">
                <strong>거절 사유:</strong> {myStatus.note}
              </div>
            )}
            {myStatus.state === "DONE" && myStatus.note && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
                <strong>완료 메모:</strong> {myStatus.note}
              </div>
            )}

            {/* 액션 버튼 바 */}
            {!isCanceled && (
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between flex-wrap gap-3">
                {/* 1) PENDING 상태: 수락 / 거절 */}
                {myStatus.state === "PENDING" && (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => handleTransition(task.id, "accept")}
                      disabled={transitionLoading}
                      className="flex-1 sm:flex-initial px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span>🤝</span>
                      <span>{transitionLoading ? "처리 중…" : "업무 수락하기"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecliningTaskId(task.id);
                        setDeclineReason("");
                      }}
                      disabled={transitionLoading}
                      className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
                    >
                      거절
                    </button>
                  </div>
                )}

                {/* 2) ACCEPTED 상태: 확인형 완료 / 제출형 제출 */}
                {myStatus.state === "ACCEPTED" && (
                  <div className="w-full space-y-3">
                    {task.kind === "confirm" ? (
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm text-slate-500">
                          업무를 확인하고 처리를 완료하셨다면 완료 버튼을 눌러주세요.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setCompletingTaskId(task.id);
                            setCompleteNote("");
                          }}
                          disabled={transitionLoading}
                          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5"
                        >
                          <span>✅</span>
                          <span>{transitionLoading ? "처리 중…" : "처리 완료 체크"}</span>
                        </button>
                      </div>
                    ) : (
                      /* 제출형 업무 업로드 UI */
                      <div className="space-y-3">
                        {/* 2단계 제출 대기 카드 (피드백 26번, 27번) */}
                        {(() => {
                          const staged = stagedSubmitMap[task.id];
                          if (staged) {
                            return (
                              <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="text-base">📄</span>
                                    <span className="font-bold text-slate-900">
                                      {staged.displayName}
                                    </span>
                                    <span className="text-slate-500 text-xs">
                                      ({(staged.file.size / 1024).toFixed(0)} KB)
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStagedSubmitMap((prev) => {
                                        const next = { ...prev };
                                        delete next[task.id];
                                        return next;
                                      });
                                    }}
                                    className="text-sm text-slate-400 hover:text-rose-600 font-bold"
                                  >
                                    ✕ 취소
                                  </button>
                                </div>

                                <div>
                                  <input
                                    type="text"
                                    value={staged.note}
                                    onChange={(e) => {
                                      setStagedSubmitMap((prev) => ({
                                        ...prev,
                                        [task.id]: { ...staged, note: e.target.value },
                                      }));
                                    }}
                                    placeholder="제출 시 남길 메모 (선택, 예: 수정본 포함)"
                                    maxLength={500}
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 text-slate-900"
                                  />
                                </div>

                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSubmitFile(task.id, staged.file, staged.note)}
                                    disabled={submittingTaskId === task.id}
                                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors shadow-2xs flex items-center gap-1.5"
                                  >
                                    {submittingTaskId === task.id ? (
                                      <>
                                        <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                                        <span>{submitProgress || "제출 중…"}</span>
                                      </>
                                    ) : (
                                      <span>🚀 작성 파일 제출 확정</span>
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="text-sm text-slate-500">
                                작성한 서식 파일을 첨부하여 제출해 주세요. (파일명은 규칙에 따라 자동 정리됩니다)
                              </div>
                              <div>
                                <input
                                  ref={submitFileInputRef}
                                  type="file"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    try {
                                      const safeFile = await toTransportSafeFile(file);
                                      setStagedSubmitMap((prev) => ({
                                        ...prev,
                                        [task.id]: { file: safeFile, displayName: file.name, note: "" },
                                      }));
                                    } catch (err) {
                                      console.error("Failed to read file:", err);
                                      alert("파일을 읽지 못했습니다. 다시 선택해 주세요.");
                                    } finally {
                                      if (submitFileInputRef.current) submitFileInputRef.current.value = "";
                                    }
                                  }}
                                  className="hidden"
                                  id={`submit-file-${task.id}`}
                                />
                                <label
                                  htmlFor={`submit-file-${task.id}`}
                                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-colors shadow-2xs cursor-pointer inline-flex items-center gap-1.5"
                                >
                                  <span>📁</span>
                                  <span>작성 파일 선택하기</span>
                                </label>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}

                {/* 3) DONE 상태: 완료 취소 / 재제출 */}
                {myStatus.state === "DONE" && (
                  <div className="w-full space-y-3">
                    <div className="space-y-2">
                      {task.kind === "confirm" ? (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-emerald-700 font-bold flex items-center gap-1">
                            <span>✅</span>
                            <span>완료 처리되었습니다. ({formatFull(myStatus.at)})</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTransition(task.id, "undone")}
                            disabled={transitionLoading}
                            className="text-sm text-slate-500 hover:text-slate-800 underline cursor-pointer"
                          >
                            완료 취소 (다시 진행 중으로)
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white border border-emerald-200 rounded-xl p-3.5 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                              <span>✅</span>
                              <span>제출 완료 ({formatFull(myStatus.at)})</span>
                            </div>
                            <div>
                              <input
                                type="file"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    const safeFile = await toTransportSafeFile(file);
                                    setStagedSubmitMap((prev) => ({
                                      ...prev,
                                      [task.id]: { file: safeFile, displayName: file.name, note: "" },
                                    }));
                                  } catch (err) {
                                    console.error("Failed to read file:", err);
                                    alert("파일을 읽지 못했습니다. 다시 선택해 주세요.");
                                  }
                                }}
                                className="hidden"
                                id={`resubmit-file-${task.id}`}
                              />
                              <label
                                htmlFor={`resubmit-file-${task.id}`}
                                className="text-sm text-indigo-600 hover:text-indigo-800 font-bold underline cursor-pointer"
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
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-1.5">
                                    <span>📄</span>
                                    <span className="font-bold text-slate-900 truncate max-w-xs">
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
                                        const next = { ...prev };
                                        delete next[task.id];
                                        return next;
                                      });
                                    }}
                                    className="text-sm text-slate-400 hover:text-rose-600 font-bold"
                                  >
                                    ✕ 취소
                                  </button>
                                </div>

                                <div>
                                  <input
                                    type="text"
                                    value={staged.note}
                                    onChange={(e) => {
                                      setStagedSubmitMap((prev) => ({
                                        ...prev,
                                        [task.id]: { ...staged, note: e.target.value },
                                      }));
                                    }}
                                    placeholder="재제출 시 남길 메모 (선택, 예: 수정본 반영)"
                                    maxLength={500}
                                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 text-slate-900"
                                  />
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                                  <p className="text-sm text-amber-800 font-medium">
                                    이전 제출본은 교체되며 30일이 지나면 복구할 수 없습니다.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => handleSubmitFile(task.id, staged.file, staged.note)}
                                    disabled={submittingTaskId === task.id}
                                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors shadow-2xs flex items-center justify-center gap-1 shrink-0 cursor-pointer self-end sm:self-auto"
                                  >
                                    {submittingTaskId === task.id ? (
                                      <>
                                        <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                                        <span>{submitProgress || "제출 중…"}</span>
                                      </>
                                    ) : (
                                      <span>🚀 교체 제출 확정</span>
                                    )}
                                  </button>
                                </div>
                              </div>
                            );
                          })()}

                          {/* 기존 제출물 확인 링크 */}
                          {mySubmission && (
                            <div className="flex items-center justify-between text-sm bg-slate-50 p-2.5 rounded-lg border border-slate-200/80">
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
                  </div>
                )}

                {/* 4) DECLINED 상태: 다시 수락하기 */}
                {myStatus.state === "DECLINED" && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-rose-700 font-semibold">
                      거절 처리된 업무입니다.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTransition(task.id, "accept")}
                      disabled={transitionLoading}
                      className="px-4 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-sm font-bold transition-colors cursor-pointer"
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
      </div>
    );
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
        </div>

        <div className="flex items-center gap-3 overflow-x-auto">
          {/* 탭 전환 */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 shrink-0 border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab("inbox")}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "inbox"
                  ? "bg-white text-indigo-700 shadow-2xs font-extrabold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📥 내 할 일</span>
              {pendingCount > 0 && (
                <span className="bg-indigo-600 text-white text-[11px] px-1.5 py-0.2 rounded-full font-black">
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("sent")}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "sent"
                  ? "bg-white text-indigo-700 shadow-2xs font-extrabold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📤 보낸 업무 현황</span>
            </button>
          </div>

          {/* 업무 등록 버튼 (피드백 15번 명칭) 및 미자격 안내 */}
          {canSend ? (
            <button
              type="button"
              onClick={() => setIsComposerOpen(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold whitespace-nowrap shrink-0 rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>+ 업무 등록</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
                <span>🔒</span>
                <span>조직 정보가 등록되면 업무를 보낼 수 있습니다.</span>
                <button
                  type="button"
                  onClick={() => document.dispatchEvent(new CustomEvent("openMyProfileModal"))}
                  className="text-sm font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer ml-1"
                >
                  내 조직 정보 신청 →
                </button>
              </div>
              <button
                type="button"
                disabled
                className="px-4 py-2 bg-slate-200 text-slate-400 text-sm font-bold rounded-xl cursor-default opacity-60 flex items-center gap-1.5"
              >
                <span>+ 업무 등록</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── 탭 1: 내 할 일 ── */}
      {activeTab === "inbox" && (
        <div className="space-y-4">
          {/* 구독 오류 안내 블록 (피드백 5번 조용한 실패 금지) */}
          {loadError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 font-semibold flex items-center justify-between">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-rose-700 underline font-bold ml-2 cursor-pointer"
              >
                새로고침
              </button>
            </div>
          )}

          {/* 필터 칩 및 셀프 등록 버튼 */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-sm">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors cursor-pointer ${
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
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors cursor-pointer ${
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
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors cursor-pointer ${
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
                className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  filter === "canceled"
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                철회된 업무
              </button>
            </div>

            {/* 내 할 일 추가 버튼 (피드백 15번) 및 미자격 안내 */}
            {canSend ? (
              <button
                type="button"
                onClick={() => setIsSelfAddOpen(true)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold whitespace-nowrap rounded-full transition-colors cursor-pointer border border-slate-200"
              >
                <span>+ 내 할 일 추가</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
                  <span>🔒</span>
                  <span>조직 정보가 등록되면 내 할 일을 쓸 수 있습니다.</span>
                  <button
                    type="button"
                    onClick={() => document.dispatchEvent(new CustomEvent("openMyProfileModal"))}
                    className="text-sm font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer ml-1"
                  >
                    내 조직 정보 신청 →
                  </button>
                </div>
                <button
                  type="button"
                  disabled
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-400 font-bold rounded-full border border-slate-200 cursor-not-allowed opacity-60"
                >
                  <span>+ 내 할 일 추가</span>
                </button>
              </div>
            )}
          </div>

          {/* 할 일 목록 */}
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">할 일 목록을 불러오는 중…</div>
          ) : sortedFilteredTasks.length === 0 ? (
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
              {/* 1. 기한 있는 업무 */}
              {visibleDueTasks.map((task, idx) => {
                const currentMonthKey = getYearMonthKey(task.dueAt);
                const prevMonthKey = idx > 0 ? getYearMonthKey(visibleDueTasks[idx - 1].dueAt) : null;
                const showMonthDivider = currentMonthKey && currentMonthKey !== prevMonthKey;
                return renderTaskCard(task, showMonthDivider ? currentMonthKey : null);
              })}

              {/* 2. 기한 없음 구역 (A안, 0건이면 감춤, task_no_due_spec §3-2) */}
              {visibleNoDueTasks.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-3 pt-2 pb-1 text-sm select-none">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="px-3 py-1 bg-slate-100/90 text-slate-600 font-extrabold rounded-full border border-slate-200 shadow-2xs">
                      기한 없음 {visibleNoDueTasks.length}
                    </span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  {visibleNoDueTasks.map((task) => renderTaskCard(task, null))}
                </div>
              )}

              {/* 클라이언트 페이지네이션 [더 보기] 버튼 (지시서 33번) */}
              {hasMoreTasks && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setPageSize((prev) => prev + 25)}
                    className="px-6 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-sm rounded-xl shadow-2xs transition-colors cursor-pointer"
                  >
                    더 보기 ({sortedFilteredTasks.length - visibleTasks.length}개 남음) ↓
                  </button>
                </div>
              )}

              {/* 90일 이전 기록 열람 출구 — 상시 구독 밖 1회 조회 (기한창 재적용, 진행할 일 탭 제외) */}
              {filter !== "pending" && !hasMoreTasks && !olderLoaded && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={loadOlderTasks}
                    disabled={olderLoading}
                    className="px-6 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold text-sm rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {olderLoading ? "불러오는 중…" : "지난 업무 보기 (90일 이전)"}
                  </button>
                  {olderError && (
                    <p className="pt-2 text-sm text-rose-600 font-medium">{olderError}</p>
                  )}
                </div>
              )}
              {filter !== "pending" && olderLoaded && olderTasks.length === 0 && (
                <p className="pt-2 text-center text-xs text-slate-400">90일 이전 기록이 없습니다.</p>
              )}
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

      {/* [내 할 일 추가] 셀프 등록 모달 (피드백 15번, 피드백 32번 서식+참고파일) */}
      {isSelfAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
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

            <div className="space-y-3.5 text-sm">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  할 일 제목 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={selfTitle}
                  onChange={(e) => setSelfTitle(e.target.value)}
                  placeholder="예: 2학기 교과진도표 작성"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 font-medium"
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">
                    마감 기한 {!selfNoDue && <span className="text-rose-500">*</span>}
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-sm text-slate-700 font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selfNoDue}
                      onChange={(e) => setSelfNoDue(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span>기한 없음</span>
                  </label>
                </div>
                <div className={`grid grid-cols-2 gap-2 transition-opacity ${selfNoDue ? "opacity-50" : ""}`}>
                  <div>
                    <label className="block text-sm text-slate-500 mb-1">
                      마감 날짜 {!selfNoDue && <span className="text-rose-500">*</span>}
                    </label>
                    <input
                      type="date"
                      value={selfDueDate}
                      onChange={(e) => setSelfDueDate(e.target.value)}
                      disabled={selfNoDue}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-500 mb-1">
                      마감 시각 {!selfNoDue && <span className="text-rose-500">*</span>}
                    </label>
                    <input
                      type="time"
                      value={selfDueTime}
                      onChange={(e) => setSelfDueTime(e.target.value)}
                      disabled={selfNoDue}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              {/* 내용 칸 (피드백 32-ⓐ 서식 지원) */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">내용 / 메모 (선택)</label>
                <div className="rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
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
                    data-placeholder="유의사항이나 메모를 자유롭게 적어두세요."
                    className="w-full px-3.5 py-2.5 text-sm leading-relaxed min-h-[100px] max-h-[200px] overflow-y-auto focus:outline-none bg-white text-slate-900 font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-0.5 [&_blockquote]:px-2.5 [&_blockquote]:rounded-r-md [&_blockquote]:my-1 [&_blockquote]:text-slate-700 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic"
                  />
                </div>
              </div>

              {/* 참고 파일 추가 (피드백 32-ⓑ) */}
              <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-800 flex items-center gap-1">
                      <span>📎</span>
                      <span>참고 파일 추가 (선택, 최대 5개)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      한글(HWP/HWPX), 오피스, PDF 등 (파일당 30MB 이하)
                    </p>
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
                        id="self-add-file-input"
                      />
                      <label
                        htmlFor="self-add-file-input"
                        className="px-2.5 py-1 bg-white border border-slate-300 hover:border-indigo-500 hover:text-indigo-600 text-slate-700 rounded-lg cursor-pointer transition-colors inline-block font-bold text-sm"
                      >
                        + 파일 선택
                      </label>
                    </div>
                  )}
                </div>

                {selfFiles.length > 0 && (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white overflow-hidden">
                    {selfFiles.map((f, i) => (
                      <div key={i} className="px-2.5 py-1.5 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-800 truncate mr-2 flex-1">
                          📄 {f.name} <span className="text-xs text-slate-500">({(f.size / 1024).toFixed(0)} KB)</span>
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

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSelfAddOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSelfAdd}
                disabled={selfSubmitting || !selfTitle.trim()}
                className="px-5 py-2 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                {selfSubmitting ? (selfUploadProgress || "등록 중…") : "등록하기"}
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
              <h4 className="text-base font-bold text-slate-900">업무 거절 사유 입력</h4>
              <p className="text-xs text-slate-500 mt-1">발신 선생님께 전달됩니다.</p>
            </div>
            <textarea
              rows={3}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="예: 해당 기간 출장 일정으로 인하여 작성이 어렵습니다."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 text-slate-900"
              maxLength={500}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setDecliningTaskId(null);
                  setDeclineReason("");
                }}
                className="px-3.5 py-1.5 text-sm font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
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
                className="px-4 py-1.5 text-sm font-bold bg-rose-600 text-white rounded-xl hover:bg-rose-700 disabled:opacity-50 cursor-pointer shadow-2xs"
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
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                <span>✅</span>
                <span>업무 처리 완료</span>
              </h4>
              <p className="text-xs text-slate-500 mt-1">발신 선생님께 남길 메모 (선택)</p>
            </div>
            <textarea
              rows={3}
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              placeholder="예: 요청하신 서류 확인 후 교무실 서랍에 비치해 두었습니다. (선택)"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 text-slate-900"
              maxLength={500}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setCompletingTaskId(null);
                  setCompleteNote("");
                }}
                className="px-3.5 py-1.5 text-sm font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  handleTransition(completingTaskId, "done", completeNote.trim());
                }}
                disabled={transitionLoading}
                className="px-4 py-1.5 text-sm font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 cursor-pointer shadow-2xs"
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
