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
  const notEligible = !!userData && !(teacherProfile?.departments?.length);

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
        const list: MemoItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as MemoDoc),
        }));
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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col h-full">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-indigo-950 to-indigo-900 px-5 py-3.5 text-white flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">✉️</span>
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              받은 쪽지
              {unreadCount > 0 && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-500 text-white shadow-xs">
                  안 읽음 {unreadCount}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-indigo-200 mt-0.5">
              {unreadCount > 0 ? (
                <>확인하지 않은 쪽지가 <strong className="text-amber-300 font-bold">{unreadCount}건</strong> 있습니다.</>
              ) : (
                "모든 쪽지를 확인했습니다."
              )}
            </p>
          </div>
        </div>
        {onNavigateToMemo && (
          <button
            type="button"
            onClick={() => onNavigateToMemo()}
            className="text-xs text-indigo-100 hover:text-white bg-indigo-800/70 hover:bg-indigo-700 border border-indigo-700/60 px-3 py-1.5 rounded-lg font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer flex-shrink-0"
          >
            <span>쪽지함 전체보기</span>
            <span>→</span>
          </button>
        )}
      </div>

      {/* 본문 목록 */}
      <div className="flex-1 p-2 overflow-y-auto max-h-[540px] lg:max-h-[640px]">
        {loading ? (
          <div className="py-16 text-center text-xs text-indigo-500 font-medium animate-pulse flex items-center justify-center gap-2">
            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
            <span>받은 쪽지를 불러오는 중입니다...</span>
          </div>
        ) : notEligible ? (
          <div className="py-12 px-4 text-center text-xs text-slate-500 space-y-2">
            <span className="text-2xl block">🔒</span>
            <p className="font-semibold text-slate-700">소속 정보 등록 후 이용할 수 있습니다</p>
            <p className="text-slate-400 leading-relaxed">
              쪽지는 교직원 조직도에 등록된 분끼리 주고받습니다.
            </p>
          </div>
        ) : memos.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400 space-y-2">
            <svg
              className="w-10 h-10 mx-auto text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            <p>받은 쪽지가 없습니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {memos.map((memo) => {
              const isUnread = !memo.reads?.[myEmail];
              const senderName = memo.senderName || memo.senderEmail;
              const hasAttachments = !!(memo.attachments && memo.attachments.length > 0);
              const hasLinks = !!(memo.links && memo.links.length > 0);

              return (
                <button
                  key={memo.id}
                  type="button"
                  onClick={() => onNavigateToMemo?.(memo.id)}
                  className={`w-full text-left p-3 rounded-lg hover:bg-indigo-50/60 transition-colors flex items-start gap-2.5 group cursor-pointer ${
                    isUnread ? "bg-indigo-50/40" : ""
                  }`}
                >
                  {/* 안 읽음 점 */}
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
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {formatDate(memo.createdAt)}
                      </span>
                    </div>
                    <p
                      className={`text-sm truncate leading-snug ${
                        isUnread
                          ? "font-bold text-slate-900 group-hover:text-indigo-700"
                          : "text-slate-700 group-hover:text-indigo-600"
                      }`}
                    >
                      {memo.title}
                    </p>
                    {/* 부가 정보 (첨부/링크 힌트) */}
                    {(hasAttachments || hasLinks) && (
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        {hasAttachments && (
                          <span className="inline-flex items-center gap-0.5 text-slate-500">
                            <span>🖼️</span>
                            <span>사진 {memo.attachments!.length}장</span>
                          </span>
                        )}
                        {hasLinks && (
                          <span className="inline-flex items-center gap-0.5 text-slate-500">
                            <span>🔗</span>
                            <span>링크 {memo.links!.length}개</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
