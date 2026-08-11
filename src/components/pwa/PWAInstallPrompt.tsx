"use client";

import { useEffect, useState } from "react";

interface PWAInstallPromptProps {
  onOpenGuide?: () => void;
}

export function PWAInstallPrompt({ onOpenGuide }: PWAInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const userAgent = window.navigator.userAgent || "";
      const isIOSDevice = /iPhone|iPad|iPod/i.test(userAgent);
      setIsIOS(isIOSDevice);

      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);

      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

      window.addEventListener("appinstalled", () => {
        setDeferredPrompt(null);
        setIsStandalone(true);
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
      if (outcome === "accepted") {
        setIsStandalone(true);
      }
      setDeferredPrompt(null);
      return;
    }
    // 아이폰(iOS)이거나 자동 설치가 미지원되는 환경에서는 모달을 띄워 안내
    setShowModal(true);
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
    <>
      <button
        onClick={handleInstallClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full text-xs font-semibold transition-colors shadow-xs cursor-pointer"
        title="앱으로 설치하기 안내 열기"
      >
        <span>📱</span>
        <span>앱으로 설치하기</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 dark:border-gray-800 space-y-5 text-left max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <span>📱</span>
                  <span>앱 설치 및 알림 설정 안내</span>
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {isIOS ? "아이폰(iOS) 기기용 설치 절차입니다." : "기기별 설치 절차를 안내해 드립니다."}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>

            {/* 아이폰 (iOS) 안내 박스 */}
            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  🍎 아이폰(iOS) 사용자 설치 절차
                </span>
                {isIOS && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 rounded-full">
                    현재 기기
                  </span>
                )}
              </div>
              <ol className="space-y-2 text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                    1
                  </span>
                  <span>
                    링크를 <strong className="text-indigo-600 dark:text-indigo-400">Safari로</strong> 열기
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-0.5">
                      (카톡에서 열렸으면: 하단 공유 아이콘 → "Safari로 열기", 또는 주소 복사 후 Safari에 붙여넣기)
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                    2
                  </span>
                  <span>
                    하단 가운데 <strong className="text-indigo-600 dark:text-indigo-400">공유 버튼(⬆️)</strong> → 아래로 스크롤 → <strong className="text-indigo-600 dark:text-indigo-400">"홈 화면에 추가"</strong>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-0.5">
                      ("웹 앱으로 열기" 체크는 켠 채로)
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                    3
                  </span>
                  <span>
                    홈 화면의 <strong className="text-indigo-600 dark:text-indigo-400">효명고 아이콘으로</strong> 앱 열기 → 로그인
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 font-normal mt-0.5">
                      (구글 화면으로 갔다가 자동으로 돌아옴)
                    </span>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                    4
                  </span>
                  <span>
                    첫 화면의 "<strong className="text-indigo-600 dark:text-indigo-400">🔔 알림 받기</strong>" → 아이폰 확인 창에서 <strong className="text-indigo-600 dark:text-indigo-400">허용</strong>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                    5
                  </span>
                  <span>
                    카드에 "<strong className="text-emerald-600 dark:text-emerald-400">알림 켜짐</strong>" 초록 표시가 보이면 완료
                  </span>
                </li>
              </ol>
            </div>

            {/* 기타/안드로이드/PC 브라우저 안내 */}
            {!isIOS && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <div className="font-semibold text-gray-800 dark:text-gray-200">
                  💻 PC 및 안드로이드 수동 설치 안내
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                  <li>이미 앱이 설치되어 있다면 홈 화면 또는 앱 목록의 아이콘으로 실행해 주세요.</li>
                  <li>브라우저 주소창 우측의 설치 아이콘(⊕) 또는 메뉴에서 "앱 설치"를 선택해 주세요.</li>
                </ul>
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

