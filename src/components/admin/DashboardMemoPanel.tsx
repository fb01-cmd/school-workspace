"use client";
// 어드민 홈 대시보드용 받은 쪽지 패널 — development_roadmap.md §2 피드백 덤프 ⑤
// 데이터 소스: 내 수신 쪽지 onSnapshot (기존 받은쪽지함 쿼리 패턴 재사용)
// 안 읽은 쪽지 우선 정렬, 항목 클릭 시 쪽지함의 해당 쪽지 상세로 이동

import { useState, useEffect } from "react";
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
import { MEMO_UNTITLED_FALLBACK } from "@/lib/memo/logic";
import { isMessagingIneligible } from "@/lib/org/eligibility";

type MemoItem = MemoDoc & { id: string };

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) {
    return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });
}

interface DashboardMemoPanelProps {
  onNavigateToMemo?: (memoId?: string) => void;
}

export default function DashboardMemoPanel({ onNavigateToMemo }: DashboardMemoPanelProps) {
  const { user, userData, teacherProfile } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "";
  const notEligible = isMessagingIneligible(userData, teacherProfile);

  const [memos, setMemos] = useState<MemoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!myEmail || !domain || notEligible) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "memos", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      orderBy("createdAt", "desc"),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: MemoItem[] = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as MemoDoc),
          }))
          .filter((m) => !m.hiddenBy?.[myEmail]);
        // 안 읽은 쪽지 우선 정렬
        list.sort((a, b) => {
          const aUnread = !a.reads?.[myEmail] ? 1 : 0;
          const bUnread = !b.reads?.[myEmail] ? 1 : 0;
          if (bUnread !== aUnread) return bUnread - aUnread;
          return b.createdAt - a.createdAt;
        });
        setMemos(list);
        setLoading(false);
      },
      (err) => {
        console.error("[DashboardMemoPanel] 받은 쪽지 구독 실패:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [myEmail, domain, notEligible]);

  const unreadCount = memos.filter((m) => !m.reads?.[myEmail]).length;

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
      <div>
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-800">받은 쪽지</h3>
              {loading ? (
                <span className="bg-slate-100 text-slate-400 text-xs px-2 py-0.5 rounded-full animate-pulse">
                  확인 중…
                </span>
              ) : notEligible ? (
                <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">
                  소속 미등록
                </span>
              ) : unreadCount > 0 ? (
                <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  안 읽음 {unreadCount}건
                </span>
              ) : (
                <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                  모두 읽음
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {unreadCount > 0
                ? `확인하지 않은 쪽지가 ${unreadCount}건 있습니다.`
                : "모든 쪽지를 확인했습니다."}
            </p>
          </div>
          <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600 text-xl">
            ✉️
          </span>
        </div>

        {/* 본문 목록 */}
        {loading ? (
          <p className="text-slate-400 text-sm py-4">불러오는 중…</p>
        ) : notEligible ? (
          <div className="py-6 text-center text-xs text-slate-500 space-y-1">
            <span className="text-xl block">🔒</span>
            <p className="font-semibold text-slate-700">소속 정보 등록 후 이용할 수 있습니다</p>
            <p className="text-slate-400">
              쪽지는 교직원 조직도에 등록된 분끼리 주고받습니다.
            </p>
          </div>
        ) : memos.length === 0 ? (
          <p className="text-slate-500 text-sm py-4">받은 쪽지가 없습니다.</p>
        ) : (
          <div className="divide-y divide-slate-100 -mx-1">
            {memos.slice(0, 5).map((memo) => {
              const isUnread = !memo.reads?.[myEmail];
              const senderName = memo.senderName || memo.senderEmail;
              const hasAttachments = !!(memo.attachments && memo.attachments.length > 0);
              const hasLinks = !!(memo.links && memo.links.length > 0);

              return (
                <button
                  key={memo.id}
                  type="button"
                  onClick={() => onNavigateToMemo?.(memo.id)}
                  className={`w-full text-left p-2.5 rounded-lg hover:bg-slate-50 transition-colors flex items-start gap-2.5 group cursor-pointer ${
                    isUnread ? "bg-indigo-50/40" : ""
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      isUnread ? "bg-indigo-600" : "bg-transparent"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span
                        className={`text-xs truncate ${
                          isUnread ? "font-bold text-slate-900" : "text-slate-600"
                        }`}
                      >
                        {senderName}
                      </span>
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {formatDate(memo.createdAt)}
                      </span>
                    </div>
                    <p
                      className={`text-sm truncate leading-snug ${
                        isUnread
                          ? "font-bold text-slate-900 group-hover:text-indigo-700"
                          : "text-slate-700 group-hover:text-slate-900"
                      }`}
                    >
                      {memo.title || MEMO_UNTITLED_FALLBACK}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5 text-slate-400">
                    {hasAttachments && <span className="text-xs">📎</span>}
                    {hasLinks && <span className="text-xs">🔗</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 바닥 링크 */}
      {onNavigateToMemo && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => onNavigateToMemo()}
            className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5 cursor-pointer"
          >
            {memos.length > 5
              ? `쪽지·업무 열기 (${memos.length - 5}건 더) →`
              : "쪽지·업무 열기 →"}
          </button>
        </div>
      )}
    </div>
  );
}
