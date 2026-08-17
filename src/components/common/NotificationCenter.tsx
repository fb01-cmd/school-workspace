"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";

export interface NotificationItem {
  id: string;
  recipientEmail: string;
  type: "lesson-changed" | "request-resolved" | "memo" | "admin-action" | "consent-request" | "consent-result";
  title: string;
  refType: string;
  refId: string;
  createdAt: number;
  read: boolean;
  readAt?: number;
  actionable?: {
    kind: "consent";
    state: "pending" | "accepted" | "declined";
    decidedAt?: number;
  };
}

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

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "방금 전";
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 2 * day) return "어제";
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`;

  const d = new Date(timestamp);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function getNotificationTypeBadge(type: string) {
  switch (type) {
    case "lesson-changed":
      return { icon: "🗓️", label: "수업 변경", bg: "bg-blue-50 text-blue-700 border-blue-200" };
    case "request-resolved":
      return { icon: "📋", label: "신청 처리", bg: "bg-purple-50 text-purple-700 border-purple-200" };
    case "memo":
      return { icon: "💬", label: "쪽지", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "admin-action":
      return { icon: "⚙️", label: "행정 처리", bg: "bg-slate-50 text-slate-700 border-slate-200" };
    case "consent-request":
      return { icon: "🤝", label: "양해 요청", bg: "bg-amber-50 text-amber-800 border-amber-300" };
    case "consent-result":
      return { icon: "📨", label: "양해 결과", bg: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    default:
      return { icon: "🔔", label: "알림", bg: "bg-gray-50 text-gray-700 border-gray-200" };
  }
}

export default function NotificationCenter() {
  const { user, userData, refreshUserData } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  // 푸시(기기로 바로 알림 받기) 설정 상태 (스펙 §6-1)
  const [pushSupported, setPushSupported] = useState<boolean | null>(null);
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [pushPublicKey, setPushPublicKey] = useState<string>("");
  const [pushCanTest, setPushCanTest] = useState<boolean>(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isPushSubscribed, setIsPushSubscribed] = useState<boolean>(false);
  const [pushLoading, setPushLoading] = useState<boolean>(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [pushTesting, setPushTesting] = useState<boolean>(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const unreadCount = userData?.unreadNotifCount ?? 0;

  // 푸시 지원 및 구독 상태 조회
  useEffect(() => {
    const initPush = async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushSupported(false);
        return;
      }
      setPushSupported(true);
      setPushPermission(Notification.permission);

      try {
        const res = await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "config" }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.enabled && data.publicKey) {
            setPushEnabled(true);
            setPushPublicKey(data.publicKey);
            if (data.canTest) setPushCanTest(true);

            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            const active = !!sub && Notification.permission === "granted";
            setIsPushSubscribed(active);
            window.dispatchEvent(new CustomEvent("push_status_changed", { detail: { isSubscribed: active } }));
          }
        }
      } catch (err) {
        console.error("[NotificationCenter] Push config check error:", err);
      }
    };

    initPush();
  }, []);

  const fetchAndMarkRead = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 목록 조회
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "알림 목록을 불러오지 못했습니다.");
      }
      setItems(data.items || []);

      // 2. 열람과 동시에 mark_read 호출 (스펙 §2)
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read" }),
      }).catch(() => {});

      if (refreshUserData) {
        refreshUserData().catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || "알림을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (!isOpen) {
      setIsOpen(true);
      fetchAndMarkRead();
    } else {
      setIsOpen(false);
    }
  };

  // 외부(배너 등)에서 알림 센터 열기 이벤트 수신
  useEffect(() => {
    const handleOpenNotifCenter = () => {
      setIsOpen(true);
      fetchAndMarkRead();
    };
    window.addEventListener("open_notification_center", handleOpenNotifCenter);
    return () => window.removeEventListener("open_notification_center", handleOpenNotifCenter);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // 기기로 바로 알림 받기 토글 핸들러 (스펙 §6-1)
  const handleTogglePush = async () => {
    if (pushLoading) return;
    setPushLoading(true);
    setPushMessage(null);

    try {
      if (isPushSubscribed) {
        // 해제 로직
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await fetch("/api/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "unsubscribe", endpoint }),
          });
        }
        setIsPushSubscribed(false);
        window.dispatchEvent(new CustomEvent("push_status_changed", { detail: { isSubscribed: false } }));
        setPushMessage("기기로 바로 알림 받기가 꺼졌습니다.");
      } else {
        // 구독 로직
        const perm = await Notification.requestPermission();
        setPushPermission(perm);
        if (perm !== "granted") {
          setPushMessage("브라우저 알림 권한이 허용되지 않았습니다.");
          setPushLoading(false);
          return;
        }

        const reg = await navigator.serviceWorker.ready;
        const applicationServerKey = urlBase64ToUint8Array(pushPublicKey);
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
          setIsPushSubscribed(true);
          window.dispatchEvent(new CustomEvent("push_status_changed", { detail: { isSubscribed: true } }));
          setPushMessage("✨ 기기로 바로 알림 받기가 켜졌습니다.");
        } else {
          const data = await res.json().catch(() => ({}));
          setPushMessage(`설정 실패: ${data.error || "알 수 없는 오류"}`);
        }
      }
    } catch (err: any) {
      setPushMessage(`오류: ${err.message}`);
    } finally {
      setPushLoading(false);
    }
  };

  // 시험 알림 발송 핸들러
  const handleTestPush = async () => {
    if (pushTesting) return;
    setPushTesting(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_send" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const n = data.subscriptions ?? 0;
        setPushMessage(
          n > 0
            ? `🧪 지금 로그인한 계정의 기기 ${n}대로 시험 알림을 보냈습니다.`
            : "🧪 알림을 켠 기기가 없어 발송할 수 없습니다."
        );
      } else {
        setPushMessage(`시험 발송 실패: ${data.error || "구독 정보가 없습니다."}`);
      }
    } catch (err: any) {
      setPushMessage(`시험 발송 오류: ${err.message}`);
    } finally {
      setPushTesting(false);
    }
  };

  // 양해 수락/거절 핸들러 (스펙 §4)
  const handleDecide = async (notificationId: string, decision: "accepted" | "declined") => {
    setDecidingId(notificationId);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "consent_decide",
          notificationId,
          decision,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "처리에 실패했습니다.");
      }

      // 로컬 항목 상태 갱신
      setItems((prev) =>
        prev.map((it) => {
          if (it.id === notificationId && it.actionable) {
            return {
              ...it,
              actionable: {
                ...it.actionable,
                state: decision,
                decidedAt: Date.now(),
              },
            };
          }
          return it;
        })
      );
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setDecidingId(null);
    }
  };

  // 딥링크 이동 핸들러
  const handleDeepLink = (item: NotificationItem) => {
    setIsOpen(false);
    const role = userData?.role;
    const isStudent = role === "student";

    if (item.refType === "memo" || item.type === "memo") {
      if (isStudent) return;
      if (pathname === "/m") return;
      if (pathname === "/admin") {
        window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "memo" } }));
      } else {
        router.push("/admin");
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "memo" } }));
        }, 150);
      }
      return;
    }

    if (item.refType === "swap_request" || item.type === "request-resolved") {
      if (isStudent) return;
      if (pathname === "/admin") {
        window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "my_timetable" } }));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("teacher_portal_nav", { detail: { tab: "my_requests" } }));
        }, 50);
      } else {
        router.push("/admin");
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "my_timetable" } }));
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("teacher_portal_nav", { detail: { tab: "my_requests" } }));
          }, 50);
        }, 150);
      }
      return;
    }

    if (item.refType === "swap_draft") {
      if (isStudent) return;
      if (pathname === "/admin") {
        window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "my_timetable" } }));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("teacher_portal_nav", { detail: { tab: "my_tt" } }));
        }, 50);
      } else {
        router.push("/admin");
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "my_timetable" } }));
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("teacher_portal_nav", { detail: { tab: "my_tt" } }));
          }, 50);
        }, 150);
      }
      return;
    }

    if (item.refType === "weekly" || item.refType === "timetable_change" || item.type === "lesson-changed") {
      if (isStudent) {
        if (pathname !== "/student-portal") router.push("/student-portal");
        return;
      }
      if (pathname === "/admin") {
        window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "my_timetable" } }));
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("teacher_portal_nav", { detail: { tab: "my_tt" } }));
        }, 50);
      } else if (pathname === "/m") {
        // 모바일 홈
      } else {
        router.push("/admin");
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("admin_navigate", { detail: { menu: "my_timetable" } }));
        }, 150);
      }
      return;
    }
  };

  if (!user) return null;

  return (
    <div className="relative inline-block text-left">
      {/* 🔔 상단 벨 버튼 (미열람 배지) */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title="알림"
        aria-label="알림"
        className="relative p-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
      >
        <span className="text-lg leading-none select-none">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full min-w-[18px] text-center shadow-xs animate-pulse">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* 📋 알림 패널 드롭다운 */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 z-50 overflow-hidden font-sans animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* 패널 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850/80 backdrop-blur-xs">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔔</span>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">알림</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 패널 본문 (알림 목록) */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800">
            {loading ? (
              <div className="py-12 px-4 text-center text-xs text-gray-500 dark:text-gray-400 space-y-2">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-indigo-600 border-t-transparent" />
                <p>알림을 불러오는 중입니다…</p>
              </div>
            ) : error ? (
              <div className="py-8 px-4 text-center space-y-2">
                <p className="text-xs text-red-600 dark:text-red-400 font-semibold">{error}</p>
                <button
                  type="button"
                  onClick={fetchAndMarkRead}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-gray-700 dark:text-gray-200 rounded-lg transition-colors cursor-pointer"
                >
                  다시 시도
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="py-14 px-4 text-center space-y-2">
                <span className="text-3xl block opacity-60">📭</span>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  새로 확인할 알림이 없습니다.
                </p>
              </div>
            ) : (
              items.map((item) => {
                const badge = getNotificationTypeBadge(item.type);
                const isPendingAction = item.actionable?.kind === "consent" && item.actionable.state === "pending";
                const isDeciding = decidingId === item.id;

                return (
                  <div
                    key={item.id}
                    className={`p-3.5 space-y-2 transition-colors ${
                      !item.read ? "bg-indigo-50/30 dark:bg-indigo-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-850"
                    }`}
                  >
                    {/* 상단 뱃지 및 시간 */}
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold border text-[10px] ${badge.bg}`}
                      >
                        <span>{badge.icon}</span>
                        <span>{badge.label}</span>
                      </span>
                      <span className="text-gray-400 dark:text-gray-500 font-medium shrink-0">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>

                    {/* 알림 한 줄 문구 */}
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 leading-snug">
                      {item.title}
                    </p>

                    {/* 수락 창구 (Actionable 영역) */}
                    {item.actionable?.kind === "consent" && (
                      <div className="pt-1">
                        {isPendingAction ? (
                          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl p-2.5 space-y-2">
                            <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                              상대 선생님의 양해 요청에 응답해 주세요:
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDecide(item.id, "accepted")}
                                disabled={isDeciding}
                                className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                              >
                                {isDeciding ? (
                                  <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                                ) : (
                                  <span>🤝</span>
                                )}
                                <span>양해합니다</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecide(item.id, "declined")}
                                disabled={isDeciding}
                                className="flex-1 py-1.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-bold transition-colors border border-gray-300 dark:border-slate-700 cursor-pointer"
                              >
                                <span>어렵습니다</span>
                              </button>
                            </div>
                          </div>
                        ) : item.actionable.state === "accepted" ? (
                          <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                            <span>✅</span>
                            <span>양해 수락 완료</span>
                          </div>
                        ) : item.actionable.state === "declined" ? (
                          <div className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-800">
                            <span>❌</span>
                            <span>양해 거절됨</span>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* 원본 바로가기 (딥링크) */}
                    <div className="flex items-center justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => handleDeepLink(item)}
                        className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span>
                          {item.refType === "memo" || item.type === "memo"
                            ? "쪽지함 바로가기"
                            : item.refType === "swap_request" || item.type === "request-resolved"
                            ? "내 신청 바로가기"
                            : item.refType === "swap_draft"
                            ? "담긴 요청 바로가기"
                            : "내 시간표 바로가기"}
                        </span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 📲 패널 하단: 기기로 바로 알림 받기 통합 영역 (스펙 §6-1) */}
          {pushSupported !== false && pushEnabled && (
            <div className="border-t border-gray-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-850/90 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-gray-900 dark:text-white">기기로 바로 알림 받기</span>
                    {isPushSubscribed && (
                      <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold px-1.5 py-0.2 rounded-full border border-emerald-200 dark:border-emerald-800">
                        켜짐
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    꺼도 알림 목록에는 계속 쌓입니다.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isPushSubscribed && pushCanTest && (
                    <button
                      type="button"
                      onClick={handleTestPush}
                      disabled={pushTesting}
                      className="px-2 py-1 bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-slate-700 font-bold rounded-lg text-[11px] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {pushTesting ? "발송 중…" : "시험 알림"}
                    </button>
                  )}

                  {/* 스위치 토글 */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPushSubscribed}
                    onClick={handleTogglePush}
                    disabled={pushLoading || pushPermission === "denied"}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 ${
                      isPushSubscribed ? "bg-indigo-600" : "bg-gray-300 dark:bg-slate-700"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        isPushSubscribed ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {pushPermission === "denied" && (
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  ⚠️ 브라우저 알림 권한이 차단되어 있습니다. 주소창 또는 브라우저 설정에서 알림을 허용해 주세요.
                </p>
              )}

              {pushMessage && (
                <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                  {pushMessage}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
