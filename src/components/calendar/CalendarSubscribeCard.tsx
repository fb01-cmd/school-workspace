"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

interface CalendarSubscribeCardProps {
  variant?: "compact" | "full";
  defaultTarget?: "staff" | "student";
  className?: string;
}

export default function CalendarSubscribeCard({
  variant = "compact",
  defaultTarget = "staff",
  className = "",
}: CalendarSubscribeCardProps) {
  const { user } = useAuth();
  const [webcalUrl, setWebcalUrl] = useState<string>("");
  const [staffWebcalUrl, setStaffWebcalUrl] = useState<string>("");
  const [activeTarget, setActiveTarget] = useState<"staff" | "student">(defaultTarget);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchIcsInfo() {
      try {
        if (!user) return;
        const idToken = await user.getIdToken();
        const res = await fetch("/api/timetable/manage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ action: "calendar_ics_info" }),
        });
        const data = await res.json();
        if (isMounted) {
          if (res.ok && data.success) {
            setWebcalUrl(data.webcalUrl || "");
            if (data.staffWebcalUrl) {
              setStaffWebcalUrl(data.staffWebcalUrl);
              setActiveTarget(defaultTarget);
            } else {
              setActiveTarget("student");
            }
          } else {
            setError("구독 주소를 가져오지 못했습니다.");
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError("네트워크 오류가 발생했습니다.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchIcsInfo();
    return () => {
      isMounted = false;
    };
  }, [user, defaultTarget]);

  const currentUrl = activeTarget === "staff" && staffWebcalUrl ? staffWebcalUrl : webcalUrl;

  const handleCopyUrl = async (urlToCopy?: string) => {
    const targetUrl = urlToCopy || currentUrl;
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert("주소 복사에 실패했습니다. 아래 주소를 직접 복사해 주세요.");
    }
  };

  const googleCalLink = currentUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(currentUrl)}`
    : "#";

  if (loading) {
    return (
      <div className={`p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 animate-pulse ${className}`}>
        학사일정 캘린더 구독 정보를 불러오는 중...
      </div>
    );
  }

  if (error || (!webcalUrl && !staffWebcalUrl)) {
    return null;
  }

  const hasStaffFeed = Boolean(staffWebcalUrl);

  return (
    <div
      className={`bg-gradient-to-br from-indigo-50/80 via-purple-50/50 to-blue-50/80 border border-indigo-100 rounded-2xl p-4 sm:p-5 shadow-xs transition-all ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-base">📅</span>
            <h4 className="font-bold text-slate-800 text-sm sm:text-base">
              학사일정을 내 캘린더로 받기
              {hasStaffFeed && (
                <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  {activeTarget === "staff" ? "교직원용" : "학생·학부모용"}
                </span>
              )}
            </h4>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            한 번 추가해 두면 학사일정이 바뀔 때 캘린더가 자동으로 따라 바뀝니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
          {hasStaffFeed && (
            <div className="inline-flex rounded-xl p-0.5 bg-slate-200/70 text-[11px] font-bold shrink-0">
              <button
                type="button"
                onClick={() => setActiveTarget("staff")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  activeTarget === "staff"
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                교직원용
              </button>
              <button
                type="button"
                onClick={() => setActiveTarget("student")}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  activeTarget === "student"
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                학생용
              </button>
            </div>
          )}

          <a
            href={googleCalLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-xs rounded-xl shadow-xs transition-all"
          >
            <span>🗓️</span>
            <span>구글 캘린더에 추가</span>
          </a>

          <button
            type="button"
            onClick={() => handleCopyUrl(currentUrl)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-medium text-xs border border-slate-200 rounded-xl shadow-2xs transition-all"
          >
            <span>{copied ? "✅" : "📋"}</span>
            <span>{copied ? "주소 복사됨!" : "주소 복사"}</span>
          </button>
        </div>
      </div>

      {variant === "full" && (
        <div className="mt-3.5 pt-3 border-t border-indigo-100/80 space-y-2">
          {hasStaffFeed ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-white/80 p-2.5 rounded-xl border border-indigo-100 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-sans">
                  <span className="font-bold text-indigo-700">🔒 교직원용 구독 주소 (전체 일정 포함)</span>
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(staffWebcalUrl)}
                    className="text-xs text-indigo-600 hover:underline font-medium"
                  >
                    복사
                  </button>
                </div>
                <div className="truncate text-slate-600 text-[11px] select-all">{staffWebcalUrl}</div>
              </div>

              <div className="bg-white/80 p-2.5 rounded-xl border border-indigo-100 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-sans">
                  <span className="font-bold text-slate-700">📢 학생·학부모용 구독 주소 (교직원 전용 제외)</span>
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(webcalUrl)}
                    className="text-xs text-slate-600 hover:underline font-medium"
                  >
                    복사
                  </button>
                </div>
                <div className="truncate text-slate-600 text-[11px] select-all">{webcalUrl}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-500 font-mono bg-white/70 px-3 py-1.5 rounded-lg border border-indigo-100 select-all overflow-x-auto">
              <span className="text-indigo-400 font-sans font-medium text-[11px] shrink-0">구독 주소:</span>
              <span className="truncate">{webcalUrl}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>💡 반영까지 하루 정도 걸릴 수 있습니다.</span>
        <span>🇰🇷 공휴일은 캘린더에 기본으로 있는 대한민국 휴일을 그대로 쓰세요.</span>
      </div>
    </div>
  );
}
