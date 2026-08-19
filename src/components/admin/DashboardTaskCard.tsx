"use client";

// 대시보드 내 할 일 카드 — docs/phase8_tasks_spec.md §7
// 미완료 할 일(PENDING/ACCEPTED)을 기한 임박순으로 표출 (5분 TTL 클라이언트 캐시)
//
// [2026-08-19] 건수 전용 → 목록 표출. 사용자 실기기 지적("모바일에선 목록으로 잘 뜨는데
// 오히려 PC가 이래") — 옆 DashboardMemoPanel·모바일과 형태를 맞춘다.
// **읽기 비용은 늘지 않는다**: 이전에도 문서를 전부 받아 세기만 하고 버렸다. 추가 조회 0.
//
// 쿼리는 TasksSection의 「내 할 일」과 **같은 모양**이다(90일 기한 창 + orderBy + limit).
// 이유 두 가지 — ⓐ 기존 복합 색인을 그대로 쓴다 ⓑ 카드에 보이는 집합과 화면에 보이는
// 집합이 어긋나지 않는다. 이전 쿼리에는 limit도 기한 창도 없어 보존 365일이 쌓일수록
// 무거워졌다(AGENTS.md §2-⑩ — 목표 규모로 지금 설계).

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase/config";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import type { TaskDoc } from "@/lib/tasks/logic";

interface Props {
  onNavigate: () => void;
}

/** 카드에 실제로 그리는 줄 수 — 나머지는 건수 배지와 [열기]가 안내한다 */
const PREVIEW_ROWS = 5;

interface PendingRow {
  id: string;
  title: string;
  dueAt: number;
  noDue?: boolean;
  accepted: boolean;
}

/** 기한 표기 — 오늘/내일/지남을 먼저 말한다(날짜만 적으면 급한지 아닌지 읽히지 않는다) */
function formatDue(dueAt: number, now: number, noDue?: boolean): { label: string; urgent: boolean } {
  if (noDue || !dueAt) return { label: "기한 없음", urgent: false };
  const day = 24 * 3600 * 1000;
  const kst = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const dDay = Math.round(
    (new Date(kst(dueAt)).getTime() - new Date(kst(now)).getTime()) / day
  );
  if (dDay < 0) return { label: `${-dDay}일 지남`, urgent: true };
  if (dDay === 0) return { label: "오늘까지", urgent: true };
  if (dDay === 1) return { label: "내일까지", urgent: true };
  return { label: `${kst(dueAt).slice(5).replace("-", ".")}까지`, urgent: false };
}

export default function DashboardTaskCard({ onNavigate }: Props) {
  const { user, userData } = useAuth();
  const myEmail = (user?.email || userData?.email || "").toLowerCase();
  const domain = myEmail.split("@")[1] || "hmh.or.kr";

  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const pendingCount = rows === null ? null : rows.length;
  const dueRows = rows === null ? null : rows.filter((r) => !r.noDue);

  useEffect(() => {
    if (!myEmail || !domain) return;

    // 캐시 키를 바꾼다 — 예전 키에는 건수(숫자)가 들어 있어 목록으로 읽으면 깨진다.
    const CACHE_KEY = `dashboard:pending_task_rows:${myEmail}`;
    const cached = getClientCache(CACHE_KEY) as PendingRow[] | null;
    if (cached) {
      setRows(cached);
      return;
    }

    // Firestore 1회 조회 — TasksSection 「내 할 일」과 같은 모양(기존 복합 색인 재사용)
    const windowStart = Date.now() - 90 * 24 * 3600 * 1000;
    const q = query(
      collection(db, "tasks", domain, "items"),
      where("recipientEmails", "array-contains", myEmail),
      where("dueAt", ">=", windowStart),
      orderBy("dueAt", "asc"),
      limit(100)
    );

    getDocs(q)
      .then((snap) => {
        const list: PendingRow[] = [];
        snap.docs.forEach((d) => {
          const t = d.data() as TaskDoc;
          if (t.canceledAt) return;
          const st = t.statuses?.[myEmail]?.state || "PENDING";
          if (st !== "PENDING" && st !== "ACCEPTED") return;
          list.push({
            id: d.id,
            title: t.title || "(제목 없음)",
            dueAt: Number(t.dueAt || 0),
            noDue: !!t.noDue,
            accepted: st === "ACCEPTED",
          });
        });
        setRows(list);
        setLoadError(false);
        setClientCache(CACHE_KEY, list, 5 * 60 * 1000);
      })
      .catch(() => {
        setLoadError(true);
        setRows([]);
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
        {dueRows === null ? (
          <p className="text-slate-400 text-sm py-4">불러오는 중…</p>
        ) : dueRows.length === 0 ? (
          <p className="text-slate-500 text-sm py-4">
            {loadError
              ? "목록을 불러오지 못했습니다. 새로고침해 주세요."
              : "받은 업무가 없습니다."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 -mx-1">
            {dueRows.slice(0, PREVIEW_ROWS).map((r) => {
              const due = formatDue(r.dueAt, Date.now(), r.noDue);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={onNavigate}
                    className="w-full flex items-center gap-3 px-1 py-2.5 text-left hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-800">
                      {r.title}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        due.urgent ? "text-rose-600" : "text-slate-500"
                      }`}
                    >
                      {due.label}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        r.accepted
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {r.accepted ? "수락함" : "할 일"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="pt-2">
        <button
          type="button"
          onClick={onNavigate}
          className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5 cursor-pointer"
        >
          {dueRows && dueRows.length > PREVIEW_ROWS
            ? `쪽지·업무 열기 (${dueRows.length - PREVIEW_ROWS}건 더) →`
            : "쪽지·업무 열기 →"}
        </button>
      </div>
    </div>
  );
}
