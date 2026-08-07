// Service Worker for 효명고 관리 시스템 PWA
// Minimum Service Worker satisfying PWA installability criteria (no offline caching, pure network pass-through)

const CACHE_NAME = "hyomyung-pwa-v1";

self.addEventListener("install", (event) => {
  // Immediately activate new service worker
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim all active clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Minimal fetch event handler required for PWA installability check.
  // Performs normal network requests without caching as requested.
  return;
});

// ── 웹 푸시 (알리미 — 시간표 변경 알림, docs/web_push_spec.md §6) ──

self.addEventListener("push", (event) => {
  let payload = { title: "알림", body: "", url: "/", tag: "timetable" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    // JSON이 아니면 텍스트 그대로 본문으로
    payload.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate && client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
