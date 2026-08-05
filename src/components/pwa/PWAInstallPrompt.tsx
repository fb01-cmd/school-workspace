"use client";

import { useEffect, useState } from "react";

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    // Check if running in standalone window mode
    if (typeof window !== "undefined") {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);

      const handleBeforeInstallPrompt = (e: Event) => {
        // Prevent default mini-infobar on mobile Chrome
        e.preventDefault();
        // Stash the event so it can be triggered later
        setDeferredPrompt(e);
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

      window.addEventListener("appinstalled", () => {
        setDeferredPrompt(null);
        setIsStandalone(true);
        console.log("[PWA] App installed successfully.");
      });

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] User choice outcome: ${outcome}`);
    setDeferredPrompt(null);
  };

  if (isStandalone) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs">
        <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
        </svg>
        <span>독립 창 (PWA 앱)</span>
      </div>
    );
  }

  if (!deferredPrompt || isDismissed) {
    return null;
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium transition-colors shadow-xs">
      <span className="flex items-center gap-1">
        <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <strong>앱으로 설치</strong>
      </span>
      <button
        onClick={handleInstallClick}
        className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold transition-colors text-xs"
      >
        설치하기
      </button>
      <button
        onClick={() => setIsDismissed(true)}
        className="text-indigo-400 hover:text-indigo-600 p-0.5"
        title="닫기"
      >
        ✕
      </button>
    </div>
  );
}
