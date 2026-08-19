"use client";

// 대시보드 내 할 일 건수 위젯 카드 — docs/phase8_tasks_spec.md §7
// 미완료 할 일 건수(PENDING/ACCEPTED) 집계 표출 (5분 TTL 클라이언트 캐시)

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { collection, query, where, getDocs } from "firebase/firestore";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import type { TaskDoc } from "@/lib/tasks/logic";

interface Props {
  onNavigate: () => void;
}

export default function DashboardTaskCard({ onNavigate }: Props) {
  const { user, userData } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "hmh.or.kr";

  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!myEmail || !domain) return;

    const CACHE_KEY = `dashboard:pending_tasks:${myEmail}`;
    const cached = getClientCache(CACHE_KEY);
    if (cached !== null && cached !== undefined) {
      setPendingCount(Number(cached));
      return;
    }

    // Firestore 1회 조회
    const q = query(
      collection(db, "tasks", domain, "items"),
      where("recipientEmails", "array-contains", myEmail)
    );

    getDocs(q)
      .then((snap) => {
        let count = 0;
        snap.docs.forEach((d) => {
          const t = d.data() as TaskDoc;
          if (t.canceledAt) return;
          const st = t.statuses?.[myEmail]?.state || "PENDING";
          if (st === "PENDING" || st === "ACCEPTED") {
            count++;
          }
        });
        setPendingCount(count);
        setLoadError(false);
        setClientCache(CACHE_KEY, count, 5 * 60 * 1000);
      })
      .catch(() => {
        setLoadError(true);
        setPendingCount(0);
      });
  }, [myEmail, domain]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900">내 할 일</h3>
            {loadError ? (
              <span className="bg-rose-50 text-rose-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                불러오지 못함
              </span>
            ) : pendingCount !== null && (
              pendingCount > 0 ? (
                <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse">
                  미완료 {pendingCount}건
                </span>
              ) : (
                <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                  할 일 없음
                </span>
              )
            )}
          </div>
          <span className="p-2 rounded-xl bg-indigo-50 text-indigo-600 text-xl">
            📌
          </span>
        </div>
        <p className="text-slate-500 text-sm mb-6">
          내게 배분된 업무 목록을 확인하고 완료 체크 또는 서식 파일을 제출합니다.
        </p>
      </div>
      <div>
        <button
          type="button"
          onClick={onNavigate}
          className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5 cursor-pointer"
        >
          업무 관리 바로가기 →
        </button>
      </div>
    </div>
  );
}
