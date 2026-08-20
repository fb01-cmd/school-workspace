import { useState, useEffect } from "react";

// 사용자 제작 iorad 튜토리얼 — 설치~자동 실행~알림까지 화면 따라하기 (2026-08-07)
const IORAD_TUTORIAL_URL = "https://www.iorad.com/player/2754580/----------------";

export default function PWAInstallGuideTab() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const userAgent = window.navigator.userAgent || "";
      setIsIOS(/iPhone|iPad|iPod/i.test(userAgent));

      if (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true) {
        setIsInstalled(true);
      }
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
                : "매번 인터넷 브라우저를 열고 주소를 찾아 접속할 필요 없이, 바탕화면이나 홈 화면 앱 형태로 바로 편리하게 사용하실 수 있습니다. 아래 가이드를 참고해 주시기 바랍니다."}
            </p>
          </div>

          {deferredPrompt && !isInstalled && (
            <button
              onClick={handleInstallClick}
              className="flex items-center space-x-2 px-5 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-md self-start md:self-auto shrink-0 cursor-pointer"
            >
              <span>📲 지금 앱으로 설치하기</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. 아이폰(iOS) 사용자 설치 및 알림 설정 가이드 카드 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-slate-200 dark:border-gray-700 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center space-x-2.5">
            <span className="text-xl">🍎</span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              아이폰(iOS) 사용자 설치 및 알림 설정 안내
            </h3>
            {isIOS && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                현재 기기 (아이폰/아이패드)
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">아이폰 필수 절차</span>
        </div>

        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          아이폰에서는 사파리(Safari) 브라우저를 통해 홈 화면에 앱을 추가한 후, 알림 받기를 설정하셔야 정상적으로 알림을 받으실 수 있습니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-1">
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-700/60 flex flex-col justify-between space-y-2">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">Safari로 열기</span>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-normal">
              링크를 <strong>Safari로</strong> 열기<br />
              <span className="text-[11px] text-gray-500 dark:text-gray-500 block mt-1">
                (카톡에서 열렸으면: 하단 공유 아이콘 → "Safari로 열기", 또는 주소 복사 후 Safari에 붙여넣기)
              </span>
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-700/60 flex flex-col justify-between space-y-2">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">홈 화면에 추가</span>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-normal">
              하단 가운데 <strong>공유 버튼(⬆️)</strong> → 아래로 스크롤 → <strong>"홈 화면에 추가"</strong><br />
              <span className="text-[11px] text-gray-500 dark:text-gray-500 block mt-1">
                ("웹 앱으로 열기" 체크는 켠 채로)
              </span>
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-700/60 flex flex-col justify-between space-y-2">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">앱 실행 및 로그인</span>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-normal">
              홈 화면의 <strong>효명고 아이콘으로</strong> 앱 열기 → 로그인<br />
              <span className="text-[11px] text-gray-500 dark:text-gray-500 block mt-1">
                (구글 화면으로 갔다가 자동으로 돌아옴)
              </span>
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-3.5 border border-slate-200/80 dark:border-slate-700/60 flex flex-col justify-between space-y-2">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">4</span>
              <span className="text-xs font-bold text-gray-900 dark:text-white">기기 알림 허용</span>
            </div>
            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-normal">
              첫 화면의 "<strong>알림을 기기로도 받아보세요</strong>" 또는 상단 🔔 알림에서 <strong>기기로 바로 알림 받기</strong> 켜기 → 확인 창에서 <strong>허용</strong>
            </p>
          </div>

          <div className="bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl p-3.5 border border-emerald-200/80 dark:border-emerald-800/60 flex flex-col justify-between space-y-2">
            <div className="flex items-center space-x-2">
              <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold shrink-0">5</span>
              <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300">설정 완료</span>
            </div>
            <p className="text-[11px] text-emerald-800 dark:text-emerald-300 leading-normal">
              스위치에 "<strong>켜짐</strong>" 초록 표시가 보이면 완료
            </p>
          </div>
        </div>
      </div>

      {/* 3. 따라하기 튜토리얼 (iorad 임베드) — PC/일반 브라우저 따라하기 */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center space-x-2">
            {/* 2026-08-14: 제목에서 Android를 뺐다. 이 튜토리얼은 작업표시줄 고정·컴퓨터 켤 때
                자동 실행을 다루는데 **안드로이드에 없는 개념**이다. 이 컴포넌트에는 안드로이드
                감지 로직 자체가 없고(유일한 "Android" 문자열이 이 제목이었다), 안드로이드 사용자는
                따라 할 수 없는 안내를 자기용이라고 읽게 돼 있었다. 사용자 지적. */}
            <span>⚙️ 컴퓨터(윈도우) 화면 따라하기: 설치부터 자동 실행 설정까지</span>
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
          아래 화면에서 <strong>[다음]</strong>을 누르며 실제 화면 그대로 따라 하시면 됩니다. 설치 → 작업표시줄 고정 → 컴퓨터 켤 때 자동 실행 → 기기 알림 켜기까지 한 번에 끝납니다.
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <strong>안드로이드 휴대폰</strong>을 쓰시면 이 따라하기 대신 아래 방법으로 하시면 됩니다 — 크롬으로 접속 →
          주소창 오른쪽 <strong>점 세 개(⋮)</strong> → <strong>&ldquo;앱 설치&rdquo;</strong>(또는 &ldquo;홈 화면에 추가&rdquo;) →
          첫 화면의 <strong>&ldquo;알림을 기기로도 받아보세요&rdquo;</strong>(또는 상단 🔔 알림)에서 <strong>기기로 바로 알림 받기</strong>를 <strong>허용</strong>. 휴대폰에는 작업표시줄·자동 실행이 없습니다.
        </p>
        <div className="rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm bg-white dark:bg-gray-800">
          <iframe
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

