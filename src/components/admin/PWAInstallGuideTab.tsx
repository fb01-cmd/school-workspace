import { useState, useEffect } from "react";

// 사용자 제작 iorad 튜토리얼 — 설치~자동 실행~알림까지 화면 따라하기 (2026-08-07)
const IORAD_TUTORIAL_URL = "https://www.iorad.com/player/2754580/----------------";

export default function PWAInstallGuideTab() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // 앱 설치 상태 체크
    if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* 1. 상단 안내 헤더 배너 */}
      <div className="bg-gradient-to-r from-indigo-900 via-blue-900 to-slate-900 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-4 -mr-4 w-48 h-48 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5 mb-1.5">
              <span className="text-2xl">📱</span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {isInstalled ? "앱 사용 설정을 마저 따라해 보세요" : "효명고 관리 시스템, 앱으로 설치해서 쓰세요"}
              </h2>
              {isInstalled && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-500/30 text-green-200 border border-green-400/30 backdrop-blur-sm">
                  ✓ 현재 앱으로 접속 중
                </span>
              )}
            </div>
            <p className="text-sm text-blue-100/80 max-w-2xl leading-relaxed">
              {isInstalled
                ? "이미 앱으로 실행 중이시니 설치 단계는 건너뛰시고, 작업표시줄 고정 → 컴퓨터 켤 때 자동 실행 → 알림 켜기 단계만 아래 따라하기 화면에서 이어서 하시면 됩니다."
                : "매번 인터넷 브라우저를 열고 주소를 찾아 접속할 필요 없이, 컴퓨터를 켜자마자 바탕화면 앱 형태로 바로 편리하게 사용하실 수 있습니다. 아래 따라하기 화면에서 [다음]을 눌러 가며 그대로 하시면 됩니다."}
            </p>
          </div>

          {deferredPrompt && !isInstalled && (
            <button
              onClick={handleInstallClick}
              className="flex items-center space-x-2 px-5 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-md self-start md:self-auto shrink-0"
            >
              <span>📲 지금 앱으로 설치하기</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. 따라하기 튜토리얼 (iorad 임베드) — 기존 3단계 텍스트 카드+스크린샷 자리 표시를
          사용자 제작 인터랙티브 튜토리얼로 통째 대체 (2026-08-07, project_notes 참조) */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center space-x-2">
            <span>⚙️ 화면 따라하기: 설치부터 자동 실행 설정까지</span>
          </h3>
          <a
            href={`${IORAD_TUTORIAL_URL}#trysteps-${isInstalled ? 6 : 1}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline shrink-0"
          >
            새 창에서 크게 보기 ↗
          </a>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          아래 화면에서 <strong>[다음]</strong>을 누르며 실제 화면 그대로 따라 하시면 됩니다. 설치 → 작업표시줄 고정 → 컴퓨터 켤 때 자동 실행 → 알림 켜기까지 한 번에 끝납니다.
        </p>
        <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800">
          <iframe
            // 앱으로 실행 중이면 설치 단계(1~5)를 건너뛰고 사용 설정 단계부터 시작 (스텝 번호는 사용자 확정 2026-08-08)
            src={`${IORAD_TUTORIAL_URL}?src=iframe#trysteps-${isInstalled ? 6 : 1}`}
            title="효명고 관리시스템 앱 설치하기 따라하기 튜토리얼"
            className="w-full block"
            style={{ height: "640px" }}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>

    </div>
  );
}
