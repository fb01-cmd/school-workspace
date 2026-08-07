"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushNotificationManager() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [canTest, setCanTest] = useState<boolean>(false);

  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState<boolean>(false);

  useEffect(() => {
    const checkSupportAndConfig = async () => {
      // 1. 브라우저 지원 체크
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setSupported(false);
        return;
      }
      setSupported(true);
      setPermission(Notification.permission);

      // 2. 서버 설정 조회
      try {
        const res = await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "config" }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.enabled && data.publicKey) {
            setEnabled(true);
            setPublicKey(data.publicKey);
            if (data.canTest) setCanTest(true);

            // 3. 기존 구독 확인 및 자동 재구독 (스냅샷 갱신)
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub && Notification.permission === "granted") {
              setIsSubscribed(true);
              // 서버에 기존 구독 조용히 재전송 (학년·반 등 최신 스냅샷 갱신)
              fetch("/api/push", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "subscribe",
                  subscription: sub.toJSON(),
                }),
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        console.error("[PushNotificationManager] Config check error:", err);
      }
    };

    checkSupportAndConfig();
  }, []);

  // 지원 불가 또는 서버 비활성화 시 전면 미노출
  if (supported === false || enabled === false) {
    return null;
  }

  const handleEnableNotification = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        setLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as any,
      });

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          subscription: sub.toJSON(),
        }),
      });

      if (res.ok) {
        setIsSubscribed(true);
        setMessage("✨ 시간표 변경 실시간 알림이 켜졌습니다.");
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage(`알림 설정 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } catch (err: any) {
      setMessage(`오류가 발생했습니다: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisableNotification = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "unsubscribe",
            endpoint,
          }),
        });
      }
      setIsSubscribed(false);
      setMessage("알림이 꺼졌습니다.");
    } catch (err: any) {
      setMessage(`알림 해제 실패: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestSend = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_send" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage("🧪 시험 알림을 성공적으로 발송했습니다. 기기를 확인해 주세요.");
      } else {
        setMessage(`시험 발송 실패: ${data.error || "구독 정보가 없거나 실패했습니다."}`);
      }
    } catch (err: any) {
      setMessage(`시험 발송 오류: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-indigo-100 p-4 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xl shrink-0">
          🔔
        </div>
        <div>
          <h4 className="text-xs font-black text-slate-900 flex items-center gap-2">
            <span>시간표 변경 실시간 알림</span>
            {isSubscribed && (
              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                알림 켜짐
              </span>
            )}
          </h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {permission === "denied"
              ? "브라우저 알림이 꺼져 있어요. 주소창 오른쪽 설정에서 알림을 허용해 주세요."
              : isSubscribed
              ? "내 시간표에 변경사항이 발생하면 즉시 알려드립니다."
              : "수업 교환·보강 지정 등 시간표 변경 시 실시간으로 안내받으세요."}
          </p>
          {message && (
            <p className="text-[10px] font-bold text-indigo-700 mt-1">{message}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
        {canTest && isSubscribed && (
          <button
            type="button"
            onClick={handleTestSend}
            disabled={testing}
            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold rounded-xl text-xs transition-colors disabled:opacity-50"
          >
            {testing ? "발송 중..." : "🧪 시험 알림"}
          </button>
        )}

        {permission === "denied" ? null : isSubscribed ? (
          <button
            type="button"
            onClick={handleDisableNotification}
            disabled={loading}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors disabled:opacity-50"
          >
            {loading ? "처리 중..." : "알림 끄기"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleEnableNotification}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs shadow-xs transition-colors disabled:opacity-50"
          >
            {loading ? "켜는 중..." : "🔔 알림 받기"}
          </button>
        )}
      </div>
    </div>
  );
}
