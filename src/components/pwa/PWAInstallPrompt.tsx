"use client";

import { useEffect, useState } from "react";

interface PWAInstallPromptProps {
  onOpenGuide?: () => void;
}

export function PWAInstallPrompt({ onOpenGuide }: PWAInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

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
    if (onOpenGuide) {
      onOpenGuide();
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] User choice outcome: ${outcome}`);
      setDeferredPrompt(null);
      return;
    }
    // 브라우저가 자동 설치 신호를 주지 않은 상태(이미 설치됨·삭제 직후·미지원 브라우저 등) —
    // 무반응으로 두면 고장으로 오인하므로 수동 경로를 안내한다 (2026-08-08 실기기 실증)
    alert(
      "자동 설치 창을 열 수 없는 상태입니다.\n\n" +
        "• 이미 앱이 설치되어 있다면: 홈 화면의 앱 아이콘으로 실행해 주세요.\n" +
        "• 방금 앱을 삭제했다면: 브라우저를 완전히 닫았다가 잠시 후 다시 시도해 주세요.\n" +
        "• 계속 안 되면: 브라우저 메뉴에서 \"앱 설치\" 또는 \"홈 화면에 추가\"를 눌러 주세요."
    );
  };

  if (isStandalone) {
    return (
      <button
        onClick={handleInstallClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold transition-colors shadow-xs cursor-pointer"
        title="작업표시줄 고정 · 컴퓨터 켤 때 자동 실행 · 알림 켜기 따라하기"
      >
        <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
        </svg>
        <span>앱으로 실행 중 · 사용 설정 안내</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleInstallClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full text-xs font-semibold transition-colors shadow-xs cursor-pointer"
      title="앱으로 설치하기 안내 열기"
    >
      <span>📱</span>
      <span>앱으로 설치하기</span>
    </button>
  );
}
