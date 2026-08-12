"use client";
// 모바일 쪽지 열람 섹션 — docs/memo_spec.md §4-2
// 쓰기 없음. 안읽은 쪽지 우선 정렬, 탭 → 상세 펼침 + read 호출.

import { useState, useEffect, useCallback } from "react";
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
  const { user, userData } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";

  const [memos, setMemos] = useState<MemoItem[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!myEmail || !domain) return;
    setLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      orderBy("createdAt", "desc"),
      limit(20)
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
      setMemos(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [myEmail, domain]);

  const handleExpand = useCallback(
    async (memo: MemoItem) => {
      const isExpanding = expanded !== memo.id;
      setExpanded(isExpanding ? memo.id : null);
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

  const unreadCount = memos.filter((m) => !m.reads?.[myEmail]).length;

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
          최근 {memos.length}건
        </span>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400 animate-pulse">
          불러오는 중…
        </div>
      ) : memos.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">
          받은 쪽지가 없습니다.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {memos.map((memo) => {
            const isUnread = !memo.reads?.[myEmail];
            const isOpen = expanded === memo.id;
            return (
              <li key={memo.id}>
                {/* 목록 행 */}
                <button
                  onClick={() => handleExpand(memo)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${
                      isUnread ? "bg-indigo-500" : "bg-transparent"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          isUnread
                            ? "font-bold text-slate-900 dark:text-white"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {memo.senderName || memo.senderEmail}
                      </span>
                      <span className="flex-shrink-0 text-[10px] text-slate-400">
                        {formatDate(memo.createdAt)}
                      </span>
                    </div>
                    <p
                      className={`text-sm truncate mt-0.5 ${
                        isUnread
                          ? "font-semibold text-slate-800 dark:text-slate-100"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {memo.title}
                    </p>
                  </div>
                  <svg
                    className={`flex-shrink-0 w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 상세 펼침 */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-700 space-y-3">
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      {formatFull(memo.createdAt)}
                    </div>
                    <pre className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 font-sans leading-relaxed">
                      {memo.body}
                    </pre>
                    {memo.links && memo.links.length > 0 && (
                      <div className="space-y-1">
                        {memo.links.map((link, i) => (
                          <a
                            key={i}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            {link.label || link.url}
                          </a>
                        ))}
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
