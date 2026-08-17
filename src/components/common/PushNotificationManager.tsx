"use client";

import { useEffect, useState } from "react";

export default function PushNotificationManager() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);

  const checkStatus = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);

    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "config" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.enabled) {
          setEnabled(true);
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          setIsSubscribed(!!sub && Notification.permission === "granted");
        }
      }
    } catch {}
  };

  useEffect(() => {
    checkStatus();

    const handleStatusChange = (e: any) => {
      if (typeof e.detail?.isSubscribed === "boolean") {
        setIsSubscribed(e.detail.isSubscribed);
      } else {
        checkStatus();
      }
    };

    window.addEventListener("push_status_changed", handleStatusChange);
    return () => window.removeEventListener("push_status_changed", handleStatusChange);
  }, []);

  // 지원 불가, 서버 비활성화, 또는 이미 기기 알림이 켜진 경우 미노출 (스펙 §6-1)
  if (supported === false || enabled === false || isSubscribed) {
    return null;
  }

  return (
    <div
      onClick={() => window.dispatchEvent(new CustomEvent("open_notification_center"))}
      role="button"
      tabIndex={0}
      className="bg-indigo-50/80 hover:bg-indigo-100/80 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 border border-indigo-200/80 dark:border-indigo-800/60 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-indigo-900 dark:text-indigo-200 cursor-pointer transition-colors shadow-2xs"
    >
      <div className="flex items-center gap-2 font-semibold">
        <span className="text-base leading-none">📲</span>
        <span>알림을 기기로도 받아보세요</span>
      </div>
      <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5 shrink-0">
        <span>설정하기</span>
        <span>→</span>
      </span>
    </div>
  );
}
