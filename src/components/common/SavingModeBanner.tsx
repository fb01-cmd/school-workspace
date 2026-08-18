"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { buildSavingBannerText } from "@/lib/ops/saving_logic";

interface SavingModeBannerProps {
  className?: string;
}

export default function SavingModeBanner({ className = "" }: SavingModeBannerProps) {
  const { savingMode, userData } = useAuth();
  const [isToggling, setIsToggling] = useState(false);

  if (!savingMode || !savingMode.active) return null;

  const bannerText = buildSavingBannerText(savingMode);
  if (!bannerText) return null;

  const isSuperAdmin = userData?.role === "super_admin";

  const handleTurnOff = async () => {
    if (isToggling) return;
    setIsToggling(true);
    try {
      const res = await fetch("/api/ops/saving-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "절약 모드를 끄지 못했습니다.");
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div
      className={`bg-amber-500/10 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-700/60 rounded-xl px-4 py-3 text-amber-900 dark:text-amber-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs sm:text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200 ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-base shrink-0">⚡</span>
        <p className="leading-snug">{bannerText}</p>
      </div>

      {isSuperAdmin && (
        <button
          type="button"
          onClick={handleTurnOff}
          disabled={isToggling}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg font-bold text-xs transition-colors shrink-0 cursor-pointer shadow-2xs"
        >
          {isToggling ? "끄는 중..." : "절약 모드 끄기"}
        </button>
      )}
    </div>
  );
}
