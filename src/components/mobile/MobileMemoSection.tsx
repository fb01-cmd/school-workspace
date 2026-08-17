"use client";
// 모바일 쪽지 열람 섹션 — docs/memo_spec.md §4-2, memo_reply_spec.md §3
// 쓰기 없음 (열람 전용). 안읽은 쪽지 우선 정렬, 탭 → 상세 펼침 + read 호출 + 주고받은 이력 표출.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { MemoDoc } from "@/lib/memo/logic";
import MemoAttachmentGrid from "@/components/common/MemoAttachmentGrid";

type MemoItem = MemoDoc & { id: string };

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay)
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

function formatFull(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MobileMemoSection() {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";
  // 자격 = 교직원 조직도 등록(teacher_profiles) — 규칙·API와 같은 기준. 미등록은 직독이 거부된다.
  const notEligible = !!userData && !(teacherProfile?.departments?.length);

  const [inboxMemos, setInboxMemos] = useState<MemoItem[]>([]);
  const [sentMemos, setSentMemos] = useState<MemoItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedThreadMemoId, setSelectedThreadMemoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 받은쪽지함 구독
  useEffect(() => {
    if (!myEmail || !domain || notEligible) { setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      orderBy("createdAt", "desc"),
      limit(50) // 스펙 §3 — 20으로 줄이면 안 읽은 쪽지가 창 밖으로 밀려 목록에서 사라진다
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: MemoItem[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as MemoDoc),
      }));
      // 안읽은 쪽지 우선 정렬
      list.sort((a, b) => {
        const aUnread = !a.reads?.[myEmail] ? 1 : 0;
        const bUnread = !b.reads?.[myEmail] ? 1 : 0;
        if (bUnread !== aUnread) return bUnread - aUnread;
        return b.createdAt - a.createdAt;
      });
      setInboxMemos(list);
      setLoading(false);
    }, (err) => {
      // 조용히 삼키면 권한 거부가 "쪽지 없음"과 구별되지 않는다 — 원인 추적이 막힌다.
      console.error("[memo] 쪽지 목록 구독 실패", err);
      setLoading(false);
    });
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  // 보낸쪽지함 구독 (주고받은 이력 로컬 그룹핑용 — reply spec §2·§3)
  useEffect(() => {
    if (!myEmail || !domain || notEligible) return;
    const q = query(
      collection(db, "memos", domain, "items"),
      where("senderEmail", "==", myEmail),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: MemoItem[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as MemoDoc),
      }));
      setSentMemos(list);
    }, (err) => {
      console.error("[memo] 보낸쪽지함 구독 실패", err);
    });
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  const allMemos = useMemo(() => [...inboxMemos, ...sentMemos], [inboxMemos, sentMemos]);

  const handleExpand = useCallback(
    async (memo: MemoItem) => {
      const isExpanding = expanded !== memo.id;
      setExpanded(isExpanding ? memo.id : null);
      setSelectedThreadMemoId(null);
      // read 호출: 펼칠 때 + 아직 안읽음
      if (isExpanding && !memo.reads?.[myEmail]) {
        try {
          await fetch("/api/memo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "read", memoId: memo.id }),
          });
        } catch {
          // 실패해도 UI는 계속
        }
      }
    },
    [expanded, myEmail]
  );

  const unreadCount = inboxMemos.filter((m) => !m.reads?.[myEmail]).length;

  // 조직도 미등록 계정 — 섹션을 조용히 비워두면 "쪽지가 없다"로 오해한다
  if (notEligible) {
    return (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs px-4 py-4">
        <div className="flex items-start gap-2.5">
          <span className="text-base mt-0.5">🔒</span>
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">쪽지</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              쪽지는 교직원 조직도에 등록된 분끼리 주고받습니다. 아직 소속 정보가 없어
              이용할 수 없습니다 — PC에서 「내 정보 관리」로 소속을 등록해 주세요.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-base">✉️</span>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">쪽지</h2>
          {unreadCount > 0 && (
            <span className="text-[10px] font-black bg-indigo-500 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {unreadCount}
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          최근 {inboxMemos.length}건
        </span>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400 animate-pulse">
          불러오는 중…
        </div>
      ) : inboxMemos.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">
          받은 쪽지가 없습니다.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {inboxMemos.map((memo) => {
            const isUnread = !memo.reads?.[myEmail];
            const isOpen = expanded === memo.id;

            // 현재 펼쳐진 영역에서 표시할 쪽지 (이력 선택 시 해당 쪽지 내용으로 전환)
            const displayedMemo =
              isOpen && selectedThreadMemoId
                ? allMemos.find((m) => m.id === selectedThreadMemoId) || memo
                : memo;

            const isDisplayedSentByMe =
              displayedMemo.senderEmail.toLowerCase() === myEmail.toLowerCase();

            // 이 쪽지의 스레드 이력 계산 (threadId 로컬 그룹핑 — reply spec §2·§3)
            const currentThreadId = memo.threadId || memo.id;
            const threadMemosMap = new Map<string, MemoItem>();
            for (const m of allMemos) {
              const mThreadId = m.threadId || m.id;
              if (mThreadId === currentThreadId) {
                threadMemosMap.set(m.id, m);
              }
            }
            const threadMemos = Array.from(threadMemosMap.values()).sort(
              (a, b) => a.createdAt - b.createdAt
            );

            return (
              <li key={memo.id} className={isUnread ? "bg-indigo-50/20 dark:bg-indigo-950/20" : "bg-white dark:bg-slate-900"}>
                {/* 목록 행 */}
                <button
                  onClick={() => handleExpand(memo)}
                  className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <span
                    className={`flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1 ${
                      isUnread ? "bg-indigo-600 ring-2 ring-indigo-200 dark:ring-indigo-800" : "bg-transparent"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          isUnread
                            ? "font-bold text-slate-700 dark:text-slate-300"
                            : "text-slate-500 dark:text-slate-400 font-medium"
                        }`}
                      >
                        {memo.senderName || memo.senderEmail}
                      </span>
                      <span className="flex-shrink-0 text-[11px] text-slate-400">
                        {formatDate(memo.createdAt)}
                      </span>
                    </div>
                    <p
                      className={`text-sm truncate mt-1 ${
                        isUnread
                          ? "font-bold text-slate-950 dark:text-white"
                          : "font-medium text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {memo.title}
                    </p>
                  </div>
                  <svg
                    className={`flex-shrink-0 w-4 h-4 text-slate-400 transition-transform mt-1 ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 상세 펼침 */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-2.5 bg-slate-100/70 dark:bg-slate-900/70 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between flex-wrap gap-1 px-0.5">
                      <span>
                        {isDisplayedSentByMe ? (
                          <span className="font-semibold text-slate-700 dark:text-slate-200">내가 보낸 쪽지</span>
                        ) : (
                          <span>
                            보낸 사람: <strong className="font-semibold text-slate-700 dark:text-slate-200">
                              {displayedMemo.senderName || displayedMemo.senderEmail}
                            </strong>
                          </span>
                        )}
                      </span>
                      <span className="text-slate-400">{formatFull(displayedMemo.createdAt)}</span>
                    </div>

                    {displayedMemo.id !== memo.id && (
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white px-0.5">
                        {displayedMemo.title}
                      </h4>
                    )}

                    {/* 본문 카드 구획 */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-700/80 p-4 shadow-2xs space-y-3">
                      <pre className="whitespace-pre-wrap text-[14px] text-slate-800 dark:text-slate-200 font-sans leading-relaxed">
                        {displayedMemo.body}
                      </pre>

                      {displayedMemo.links && displayedMemo.links.length > 0 && (
                        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 space-y-1">
                          <span className="text-[11px] font-semibold text-slate-400 block mb-0.5">첨부 링크</span>
                          {displayedMemo.links.map((link, i) => (
                            <a
                              key={i}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                              {link.label || link.url}
                            </a>
                          ))}
                        </div>
                      )}

                      {displayedMemo.attachments && displayedMemo.attachments.length > 0 && (
                        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800">
                          <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">첨부 이미지</span>
                          <MemoAttachmentGrid attachments={displayedMemo.attachments} />
                        </div>
                      )}
                    </div>

                    {/* 주고받은 이력 (threadId 로컬 그룹핑 — reply spec §2·§3, 모바일에는 답장 버튼 없음) */}
                    {threadMemos.length > 1 && (
                      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-800/60 shadow-2xs mt-3">
                        <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                            <span>주고받은 이력</span>
                            <span className="text-[11px] font-normal text-slate-500">({threadMemos.length}건)</span>
                          </span>
                        </div>
                        <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60 max-h-48 overflow-y-auto bg-white dark:bg-slate-900">
                          {threadMemos.map((item) => {
                            const isCurrent = item.id === displayedMemo.id;
                            const isSentByMe = item.senderEmail.toLowerCase() === myEmail.toLowerCase();
                            const senderLabel = isSentByMe ? "나" : (item.senderName || item.senderEmail);

                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  if (!isCurrent) {
                                    setSelectedThreadMemoId(item.id);
                                    if (!item.reads?.[myEmail] && item.recipientEmails?.includes(myEmail)) {
                                      fetch("/api/memo", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "read", memoId: item.id }),
                                      }).catch(() => {});
                                    }
                                  }
                                }}
                                className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between gap-2 transition-colors ${
                                  isCurrent
                                    ? "bg-indigo-50/80 dark:bg-indigo-950/40 font-bold text-indigo-950 dark:text-indigo-200 cursor-default"
                                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400 cursor-pointer"
                                }`}
                              >
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                                      isSentByMe
                                        ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                        : "bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300"
                                    }`}
                                  >
                                    {senderLabel}
                                  </span>
                                  <span
                                    className={`truncate flex-1 ${
                                      isCurrent
                                        ? "font-bold text-indigo-950 dark:text-indigo-100"
                                        : "text-slate-700 dark:text-slate-300"
                                    }`}
                                  >
                                    {item.title}
                                  </span>
                                  {isCurrent && (
                                    <span className="text-[10px] bg-indigo-600 text-white font-semibold px-1.5 py-0.5 rounded flex-shrink-0">
                                      현재 쪽지
                                    </span>
                                  )}
                                </div>
                                <span className="flex-shrink-0 text-slate-400 dark:text-slate-500 text-[10px]">
                                  {formatDate(item.createdAt)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

