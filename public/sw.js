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
