import { useState, useEffect } from "react";

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
              <h2 className="text-xl font-bold text-white tracking-tight">효명고 관리 시스템, 앱으로 설치해서 쓰세요</h2>
              {isInstalled && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-500/30 text-green-200 border border-green-400/30 backdrop-blur-sm">
                  ✓ 현재 앱으로 접속 중
                </span>
              )}
            </div>
            <p className="text-sm text-blue-100/80 max-w-2xl leading-relaxed">
              매번 인터넷 브라우저를 열고 주소를 찾아 접속할 필요 없이, 컴퓨터를 켜자마자 바탕화면 앱 형태로 바로 편리하게 사용하실 수 있습니다. 아래 3단계를 따라 간단하게 설치해 보세요.
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

      {/* 2. 3단계 가이드 카드 */}
      <div className="space-y-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center space-x-2">
          <span>⚙️ 앱 설치 및 부팅 시 자동 실행 3단계 가이드</span>
        </h3>

        {/* 1단계 카드 */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-full bg-blue-600 text-white font-black flex items-center justify-center text-sm shadow-xs">
              1
            </span>
            <h4 className="text-base font-bold text-gray-900 dark:text-white">
              1단계: 웹사이트에서 [앱으로 설치] 클릭하기
            </h4>
          </div>

          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-11">
            <p>1. 크롬(Chrome) 브라우저로 <strong>효명고 관리 시스템</strong>에 접속합니다.</p>
            <p>
              2. 화면 상단 우측에 있는 <strong>[앱으로 설치]</strong> 버튼을 클릭합니다.
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                (또는 브라우저 맨 위 주소창 오른쪽에 보이는 모니터/화살표 모양의 설치 아이콘을 클릭하셔도 됩니다.)
              </span>
            </p>
            <p>3. 확인 팝업 창이 뜨면 <strong>[설치]</strong> 버튼을 선택합니다.</p>
          </div>

          {/* 스크린샷 자리 표시자 Box */}
          <div className="ml-11 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-center space-y-2">
            <div className="text-2xl text-gray-400">🖼️</div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              [스크린샷 예시: 화면 상단 &apos;앱으로 설치&apos; 버튼 및 주소창 오른쪽 설치 아이콘]
            </p>
            <p className="text-[11px] text-gray-400">
              (사용자 실기기 캡처 이미지 제공 시 업데이트 예정)
            </p>
          </div>
        </div>

        {/* 2단계 카드 */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-full bg-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-xs">
              2
            </span>
            <h4 className="text-base font-bold text-gray-900 dark:text-white">
              2단계: 컴퓨터 켤 때 자동으로 앱 켜기 (자동 시작 설정)
            </h4>
          </div>

          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-11">
            <p>1. 설치가 완료되면 인터넷 브라우저 창과 분리된 <strong>독립된 전용 앱 창</strong>으로 시스템이 열립니다.</p>
            <p>2. 앱 창 오른쪽 상단의 <strong>점 3개(⋮) 메뉴</strong>를 누르고 <strong>[앱 정보]</strong>를 클릭합니다.</p>
            <p>3. 펼쳐진 메뉴에서 <strong>[앱 설정]</strong>을 클릭합니다.</p>
            <p>4. 설정 화면에서 <strong>[로그인 시 앱 실행]</strong> 스위치를 <strong>켭니다</strong>.</p>
          </div>

          <div className="ml-11 p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start space-x-2">
            <span className="text-base mt-0.5">💡</span>
            <p className="leading-relaxed">
              <strong>참고:</strong> 이 설정을 켜두시면 교무실 컴퓨터를 켤 때 효명고 관리 플랫폼이 자동으로 열려 바로 업무를 시작하실 수 있습니다.
            </p>
          </div>

          {/* 스크린샷 자리 표시자 Box */}
          <div className="ml-11 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-center space-y-2">
            <div className="text-2xl text-gray-400">🖼️</div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              [스크린샷 예시: 점 3개 메뉴 &rarr; 앱 정보 &rarr; 앱 설정 &rarr; &apos;로그인 시 앱 실행&apos; 스위치 켜기]
            </p>
            <p className="text-[11px] text-gray-400">
              (사용자 실기기 캡처 이미지 제공 시 업데이트 예정)
            </p>
          </div>
        </div>

        {/* 3단계 카드 */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
          <div className="flex items-center space-x-3">
            <span className="w-8 h-8 rounded-full bg-teal-600 text-white font-black flex items-center justify-center text-sm shadow-xs">
              3
            </span>
            <h4 className="text-base font-bold text-gray-900 dark:text-white">
              3단계: 작업 표시줄에 고정하기 (선택 사항)
            </h4>
          </div>

          <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-11">
            <p>1. 컴퓨터 화면 아래쪽 <strong>작업 표시줄</strong>에 생성된 <strong>효명고 관리 시스템 아이콘</strong>을 찾습니다.</p>
            <p>2. 아이콘 위에서 <strong>마우스 오른쪽 버튼</strong>을 클릭합니다.</p>
            <p>3. 메뉴에서 <strong>[작업 표시줄에 고정]</strong>을 선택하면 브라우저가 닫혀 있어도 언제든 클릭 한 번으로 바로 실행할 수 있습니다.</p>
          </div>

          {/* 스크린샷 자리 표시자 Box */}
          <div className="ml-11 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-center space-y-2">
            <div className="text-2xl text-gray-400">🖼️</div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              [스크린샷 예시: 작업 표시줄 아이콘 마우스 우클릭 후 &apos;작업 표시줄에 고정&apos; 선택]
            </p>
            <p className="text-[11px] text-gray-400">
              (사용자 실기기 캡처 이미지 제공 시 업데이트 예정)
            </p>
          </div>
        </div>
      </div>

      {/* 3. 자주 묻는 질문 FAQ */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
        <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center space-x-2">
          <span>📌 자주 묻는 질문 (FAQ)</span>
        </h3>

        <div className="space-y-3 text-xs text-gray-700 dark:text-gray-300">
          <div className="p-3.5 bg-gray-50 dark:bg-gray-900/40 rounded-xl space-y-1">
            <p className="font-bold text-gray-900 dark:text-white">Q. 크롬북에서도 컴퓨터 부팅 시 자동 실행이 되나요?</p>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              크롬북이나 태블릿 환경에서는 해당 자동 시작 옵션 대신 바탕화면 및 앱 목록에 전용 아이콘으로 추가됩니다. 교무실 윈도우/맥 컴퓨터에서 위 2단계 설정을 활용하시면 편리합니다.
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 dark:bg-gray-900/40 rounded-xl space-y-1">
            <p className="font-bold text-gray-900 dark:text-white">Q. 다시 일반 인터넷 웹사이트 형식으로 접속하고 싶어요.</p>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              기존 웹주소 그대로 접속하셔도 앱과 동일하게 시스템을 이용하실 수 있습니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
