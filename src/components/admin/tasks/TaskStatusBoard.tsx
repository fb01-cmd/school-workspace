"use client";

// 보낸 업무 현황판 — docs/phase8_tasks_spec.md §3, §5, §7
// 발신자 화면의 실시간 원본: 수신자별 상태 표, 수락/완료 집계 칩, 재촉(24h 제한), 제출함 폴더 열기, 철회

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
} from "firebase/firestore";
import type { TaskDoc, TaskRecipientStatus, TaskSubmission } from "@/lib/tasks/logic";
import MemoRichBody from "@/components/common/MemoRichBody";
import { resolveDisplayName } from "@/lib/org/displayName";
import type { TeacherProfile } from "@/context/AuthContext";

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

export default function TaskStatusBoard() {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "hmh.or.kr";

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [loading, setLoading] = useState(true);

  // 교직원 프로필 맵 (이름/부서 표기용)
  const [profileMap, setProfileMap] = useState<Map<string, TeacherProfile>>(new Map());

  // 액션 상태
  const [nudging, setNudging] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  // 셀프 업무 접기 (피드백 15번) — 반드시 조기 return(로딩·빈 목록)보다 위에 있어야 한다.
  // 조기 return 아래 훅 선언은 로딩이 끝나는 렌더에서 훅 개수를 바꿔 React #310 크래시를 낸다 (2026-08-19 실사고)
  const [showSelfTasks, setShowSelfTasks] = useState(false);

  // 프로필 로드
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "teacher_profiles"), (snap) => {
      const map = new Map<string, TeacherProfile>();
      snap.docs.forEach((d) => {
        const p = d.data() as TeacherProfile;
        if (p.email) map.set(p.email.toLowerCase(), p);
      });
      setProfileMap(map);
    });
    return () => unsub();
  }, []);

  // 내가 보낸 업무 목록 구독
  useEffect(() => {
    if (!myEmail || !domain) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "tasks", domain, "items"),
      where("senderEmail", "==", myEmail),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TaskItem[] = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as TaskDoc),
          }))
          .filter((t) => (t.recipientCount || t.recipientEmails?.length || 0) > 0); // 초안 제외 (피드백 4-a)
        setTasks(list);
        if (list.length > 0 && !selectedTaskId) {
          setSelectedTaskId(list[0].id);
        }
        setLoading(false);
      },
      (err) => {
        console.error("[tasks] 보낸 업무 목록 구독 실패", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [myEmail, domain, selectedTaskId]);

  // 선택된 업무 단일 문서 실시간 구독
  useEffect(() => {
    if (!domain || !selectedTaskId) {
      setSelectedTask(null);
      return;
    }
    const ref = doc(db, "tasks", domain, "items", selectedTaskId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setSelectedTask({ id: snap.id, ...(snap.data() as TaskDoc) });
      } else {
        setSelectedTask(null);
      }
    });
    return () => unsub();
  }, [domain, selectedTaskId]);

  // 리마인드 알림 (nudge — 피드백 11번)
  const handleNudge = async () => {
    if (!selectedTask) return;
    setNudging(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "nudge", taskId: selectedTask.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "리마인드 알림 발송에 실패했습니다.");
      }
      alert(`미완료 선생님 ${data.nudged}분께 리마인드 알림을 발송했습니다.`);
    } catch (err: any) {
      alert(err.message || "리마인드 알림 처리 중 오류가 발생했습니다.");
    } finally {
      setNudging(false);
    }
  };

  // 철회 (cancel)
  const handleCancel = async () => {
    if (!selectedTask) return;
    setCanceling(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", taskId: selectedTask.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "업무 철회에 실패했습니다.");
      }
      setShowCancelModal(false);
      alert("업무가 철회되었습니다. (제출된 파일은 보존 기간까지 보관됩니다)");
    } catch (err: any) {
      alert(err.message || "철회 중 오류가 발생했습니다.");
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">보낸 업무 현황을 불러오는 중…</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-2">
        <span className="text-3xl block opacity-60">📭</span>
        <h3 className="text-sm font-bold text-slate-800">보낸 업무가 없습니다.</h3>
        <p className="text-xs text-slate-500">
          우측 상단의 [+ 업무 등록] 버튼을 눌러 업무를 등록하고 전달해 보세요.
        </p>
      </div>
    );
  }

  // 통계 집계
  const statuses = selectedTask?.statuses || {};
  const recipients = selectedTask?.recipientEmails || [];
  const totalCount = recipients.length;
  let doneCount = 0;
  let acceptedCount = 0;
  let declinedCount = 0;
  let pendingCount = 0;

  recipients.forEach((email) => {
    const st = statuses[email]?.state || "PENDING";
    if (st === "DONE") doneCount++;
    else if (st === "ACCEPTED") acceptedCount++;
    else if (st === "DECLINED") declinedCount++;
    else pendingCount++;
  });

  // 셀프 등록 업무와 일반 업무 분리 (피드백 15번)
  const normalTasks = tasks.filter((t) => !t.selfAssigned);
  const selfTasks = tasks.filter((t) => !!t.selfAssigned);

  const dueInfo = selectedTask ? formatRemainingTime(selectedTask.dueAt) : null;
  const isCanceled = !!selectedTask?.canceledAt;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* 좌측: 보낸 업무 목록 사이드 */}
      <div className="lg:col-span-4 space-y-2">
        <div className="text-xs font-bold text-slate-500 px-1 mb-2">보낸 업무 목록 ({normalTasks.length}건)</div>
        <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
          {normalTasks.map((task) => {
            const isSelected = selectedTaskId === task.id;
            const remaining = formatRemainingTime(task.dueAt);
            const taskDone = Object.values(task.statuses || {}).filter((s) => s.state === "DONE").length;
            const taskTotal = task.recipientCount || task.recipientEmails.length;
            const isTaskCanceled = !!task.canceledAt;

            return (
              <button
                key={task.id}
                type="button"
                onClick={() => setSelectedTaskId(task.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-indigo-50/80 border-indigo-600 shadow-xs"
                    : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 mb-1 text-[11px]">
                  <span
                    className={`font-bold px-1.5 py-0.2 rounded-md ${
                      task.kind === "submit"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {task.kind === "submit" ? "제출형" : "확인형"}
                  </span>
                  {isTaskCanceled ? (
                    <span className="text-slate-400 font-bold bg-slate-100 px-1.5 py-0.2 rounded">
                      철회됨
                    </span>
                  ) : (
                    <span
                      className={`font-bold ${
                        remaining.isPast
                          ? "text-slate-400"
                          : remaining.isUrgent
                          ? "text-rose-600 font-extrabold"
                          : "text-indigo-600"
                      }`}
                    >
                      {remaining.text}
                    </span>
                  )}
                </div>

                <div className="font-bold text-slate-900 text-xs line-clamp-1 mb-1.5">
                  {task.title}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    완료 <strong className="text-slate-800">{taskDone}</strong>/{taskTotal}명
                  </span>
                  <span>{formatFull(task.createdAt).split(" ")[0]}</span>
                </div>
              </button>
            );
          })}

          {/* 셀프 등록한 할 일 접힘 그룹 (피드백 15번) */}
          {selfTasks.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowSelfTasks(!showSelfTasks)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <span>📝 내가 등록한 할 일 ({selfTasks.length}건)</span>
                <span className="text-[10px]">{showSelfTasks ? "▲ 접기" : "▼ 펼치기"}</span>
              </button>
              {showSelfTasks && (
                <div className="space-y-1.5 mt-1.5">
                  {selfTasks.map((task) => {
                    const isSelected = selectedTaskId === task.id;
                    const remaining = formatRemainingTime(task.dueAt);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => setSelectedTaskId(task.id)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer text-xs ${
                          isSelected
                            ? "bg-indigo-50 border-indigo-500 font-bold"
                            : "bg-slate-50/70 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <div className="truncate text-slate-800">{task.title}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{remaining.text}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 우측: 선택된 업무 세부 현황판 */}
      {selectedTask && (
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl shadow-xs p-6 space-y-6">
          {/* 상단 헤더 및 액션 버튼들 */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span
                  className={`font-bold px-2 py-0.5 rounded-full ${
                    selectedTask.kind === "submit"
                      ? "bg-purple-100 text-purple-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {selectedTask.kind === "submit" ? "📁 제출형 업무" : "✅ 확인형 업무"}
                </span>
                {selectedTask.selfAssigned && (
                  <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                    내가 등록한 할 일
                  </span>
                )}
                {isCanceled ? (
                  <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">
                    철회된 업무
                  </span>
                ) : (
                  <span
                    className={`font-bold px-2 py-0.5 rounded-full ${
                      dueInfo?.isPast
                        ? "bg-slate-100 text-slate-500"
                        : dueInfo?.isUrgent
                        ? "bg-rose-100 text-rose-800"
                        : "bg-indigo-100 text-indigo-800"
                    }`}
                  >
                    기한: {formatFull(selectedTask.dueAt)} ({dueInfo?.text})
                  </span>
                )}
              </div>

              <h2 className="text-base font-extrabold text-slate-900 leading-snug break-words">
                {selectedTask.title}
              </h2>
              <p className="text-xs text-slate-400">
                발송 일시: {formatFull(selectedTask.createdAt)} · 수신 대상: {selectedTask.recipientSummary || `${totalCount}명`}
              </p>
            </div>

            {/* 발신자 제어 버튼들 */}
            {!isCanceled && !selectedTask.selfAssigned && (
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                {/* 리마인드 알림 버튼 (피드백 11번) */}
                <button
                  type="button"
                  onClick={handleNudge}
                  disabled={nudging || doneCount + declinedCount === totalCount}
                  title="미완료 선생님들께 리마인드 알림을 발송합니다 (하루 1회 제한)"
                  className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                >
                  <span>📢</span>
                  <span>{nudging ? "발송 중…" : "리마인드 알림"}</span>
                </button>

                {/* 제출함 폴더 열기 (제출형) */}
                {selectedTask.kind === "submit" && selectedTask.submitFolderId && (
                  <a
                    href={`https://drive.google.com/drive/folders/${selectedTask.submitFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>📁</span>
                    <span>제출함 열기</span>
                  </a>
                )}

                {/* 철회 버튼 */}
                <button
                  type="button"
                  onClick={() => setShowCancelModal(true)}
                  className="px-3 py-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  철회
                </button>
              </div>
            )}
          </div>

          {/* 내용 카드 (피드백 8번 '내용' + 피드백 6,9번 MemoRichBody autolink) */}
          {selectedTask.body && (
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-2">
              <div className="text-xs font-bold text-slate-500">내용</div>
              <MemoRichBody
                body={selectedTask.body}
                isPlain={selectedTask.contentFormat !== "md1"}
                className="text-xs text-slate-800 leading-relaxed font-sans"
              />
            </div>
          )}

          {/* 첨부된 양식 파일 목록 */}
          {selectedTask.formFiles && selectedTask.formFiles.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-slate-700">배포 양식 파일</div>
              <div className="flex flex-wrap gap-2">
                {selectedTask.formFiles.map((f, i) => (
                  <a
                    key={i}
                    href={`/api/tasks/file?taskId=${selectedTask.id}&fileId=${f.driveFileId}`}
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

          {/* 실시간 집계 칩 그리드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="text-[11px] text-slate-500 font-medium">수신 대상</div>
              <div className="text-base font-extrabold text-slate-900 mt-0.5">{totalCount}명</div>
            </div>

            <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3">
              <div className="text-[11px] text-emerald-700 font-bold">완료</div>
              <div className="text-base font-extrabold text-emerald-800 mt-0.5">
                {doneCount}명{" "}
                <span className="text-xs font-medium text-emerald-600">
                  ({totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%)
                </span>
              </div>
            </div>

            <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3">
              <div className="text-[11px] text-blue-700 font-bold">진행 중 (수락)</div>
              <div className="text-base font-extrabold text-blue-800 mt-0.5">
                {acceptedCount}명
              </div>
            </div>

            <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3">
              <div className="text-[11px] text-amber-700 font-bold">수락 전 / 거절</div>
              <div className="text-base font-extrabold text-amber-900 mt-0.5">
                수락 전 {pendingCount} · 거절 {declinedCount}
              </div>
            </div>
          </div>

          {/* 수신자별 상태 테이블 */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-800">
              수신자별 처리 현황 ({recipients.length}명)
            </div>
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
              <table className="w-full text-left text-xs divide-y divide-slate-100">
                <thead className="bg-slate-50/80 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3.5 py-2.5">이름</th>
                    <th className="px-3.5 py-2.5">소속</th>
                    <th className="px-3.5 py-2.5">상태</th>
                    <th className="px-3.5 py-2.5">확인/처리 일시</th>
                    {selectedTask.kind === "submit" && <th className="px-3.5 py-2.5">제출 파일</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {recipients.map((email) => {
                    const profile = profileMap.get(email.toLowerCase());
                    const name = resolveDisplayName(email, profile).name;
                    const dept = Array.isArray(profile?.departments) && profile.departments.length > 0 ? profile.departments[0] : "-";
                    const statusObj: TaskRecipientStatus = statuses[email] || { state: "PENDING", at: 0 };
                    const submission: TaskSubmission | undefined = selectedTask.submissions?.[email];

                    return (
                      <tr key={email} className="hover:bg-slate-50/60">
                        <td className="px-3.5 py-2 font-bold text-slate-900">
                          {name}
                          <span className="block text-[10px] text-slate-400 font-normal">{email}</span>
                        </td>
                        <td className="px-3.5 py-2 text-slate-600">{dept}</td>
                        <td className="px-3.5 py-2">
                          {statusObj.state === "DONE" ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <span>✓</span> 완료
                            </span>
                          ) : statusObj.state === "ACCEPTED" ? (
                            <span className="inline-flex items-center gap-1 font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                              <span>●</span> 수락됨
                            </span>
                          ) : statusObj.state === "DECLINED" ? (
                            <div className="space-y-0.5">
                              <span className="inline-flex items-center gap-1 font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                <span>✕</span> 거절됨
                              </span>
                              {statusObj.note && (
                                <p className="text-[11px] text-rose-600 font-medium">
                                  사유: {statusObj.note}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              수락 전
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2 text-slate-400 text-[11px]">
                          {statusObj.at ? formatFull(statusObj.at) : "-"}
                        </td>
                        {selectedTask.kind === "submit" && (
                          <td className="px-3.5 py-2">
                            {submission ? (
                              <a
                                href={`/api/tasks/file?taskId=${selectedTask.id}&fileId=${submission.driveFileId}`}
                                download
                                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold hover:underline"
                              >
                                <span>📄</span>
                                <span className="truncate max-w-[140px]">{submission.name}</span>
                                <span>↓</span>
                              </a>
                            ) : (
                              <span className="text-slate-300">미제출</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 철회 확인 모달 (피드백 12번 진행 상황 경고) */}
      {showCancelModal && selectedTask && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-sm w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div>
              <h4 className="text-sm font-bold text-slate-900">업무를 철회하시겠습니까?</h4>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed bg-amber-50 p-2.5 rounded-xl border border-amber-200 font-medium">
                ⚠️ 이미 수락 {acceptedCount}명 · 완료 {doneCount}명이 있습니다. 철회하면 전원의 할 일에서 사라지며, 제출물은 보존 기간까지 남습니다.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                disabled={canceling}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={canceling}
                className="px-4 py-1.5 text-xs font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                {canceling ? "철회 중…" : "업무 철회 확정"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
