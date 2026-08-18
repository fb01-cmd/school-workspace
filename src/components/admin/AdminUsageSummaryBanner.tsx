"use client";

import { useState, useEffect } from "react";
import { UsageSnapshot } from "./UsageDashboardTab";

interface AdminUsageSummaryBannerProps {
  onNavigate?: () => void;
}

export default function AdminUsageSummaryBanner({ onNavigate }: AdminUsageSummaryBannerProps) {
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchSummary = async () => {
      try {
        // days=30으로 호출하여 사용량 화면과 서버 캐시를 공유
        const res = await fetch("/api/ops/usage?days=30");
        if (!res.ok) return;
        const json = await res.json();
        if (isMounted) {
          setData(json);
        }
      } catch (err) {
        // 백그라운드 조회 실패 시 무시
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchSummary();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleClick = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "usage" } }));
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between animate-pulse">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span className="text-xs text-slate-400 font-medium">사용량 요약을 확인하는 중...</span>
        </div>
      </div>
    );
  }

  // 권한 미부여 상태 (available === false 또는 데이터 없음)
  if (!data || !data.available) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="w-full text-left bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between transition-colors group cursor-pointer shadow-2xs"
      >
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            사용량을 아직 볼 수 없습니다
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
            (모니터링 조회 설정 필요)
          </span>
        </div>
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-0.5 transition-transform">
          설정 확인하기 →
        </span>
      </button>
    );
  }

  const today = data.today;
  const topPercent = Math.round(today?.topPercent ?? 0);
  const level = today?.level ?? 0;

  const isWarning = level >= 80 || topPercent >= 80;
  const isCaution = level >= 50 || topPercent >= 50;

  const statusText = isWarning ? "경고" : isCaution ? "주의" : "정상";
  const dotColor = isWarning ? "bg-rose-500" : isCaution ? "bg-amber-500" : "bg-emerald-500";
  const badgeClass = isWarning
    ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60"
    : isCaution
    ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60"
    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60";

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 flex items-center justify-between transition-colors group cursor-pointer shadow-2xs"
    >
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0 animate-pulse`} />
        <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
          오늘 사용량 {topPercent}% · {statusText}
        </span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClass} hidden sm:inline`}>
          {statusText}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-0.5 transition-transform">
        <span>상세보기</span>
        <span>→</span>
      </div>
    </button>
  );
}
