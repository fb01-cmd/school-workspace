"use client";

import { useEffect, useState } from "react";
interface ClassroomCleanupBannerProps {
  onNavigate?: () => void;
}

export default function ClassroomCleanupBanner({ onNavigate }: ClassroomCleanupBannerProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [targetCount, setTargetCount] = useState(0);
  const [currentSchoolYear, setCurrentSchoolYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    // 1. 스누즈 상태 체크
    const snoozeUntil = localStorage.getItem("classroom_cleanup_snooze_until");
    if (snoozeUntil && Date.now() < Number(snoozeUntil)) {
      return;
    }

    // 2. 학기말 정리 시즌 선차단 (1월=0, 2월=1)
    // 프로덕션 환경에서 정리 시즌 외 기간에는 API 호출을 선차단하여 불필요한 스캔 방지
    const month = new Date().getMonth();
    const isCleanupSeason = month === 0 || month === 1;
    if (process.env.NODE_ENV === "production" && !isCleanupSeason) {
      return;
    }

    // 3. 학기말 정리 대상 코스 조회
    checkCleanupTargets();
  }, []);

  const checkCleanupTargets = async () => {
    try {
      const res = await fetch("/api/workspace/classroom/cleanup");
      if (!res.ok) return;

      const data = await res.json();
      const count = data.stats?.targetCount || 0;

      if (count > 0) {
        setTargetCount(count);
        setCurrentSchoolYear(data.currentSchoolYear || new Date().getFullYear());
        setShowBanner(true);
      }
    } catch (e) {}
  };

  const handleSnooze = () => {
    const snoozeUntil = Date.now() + 7 * 24 * 60 * 60 * 1000; // 1 week
    localStorage.setItem("classroom_cleanup_snooze_until", String(snoozeUntil));
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-amber-900 shadow-xs transition-all">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm font-medium">
        <div className="flex items-center gap-2.5">
          <span className="text-base">📢</span>
          <div>
            <strong className="font-bold text-amber-950">학기말 클래스룸·캘린더 정리 안내:</strong> 지난 학년도 클래스룸 중 정리 필요한 코스가 <span className="underline font-bold text-amber-900">{targetCount}개</span> 있습니다.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          <button
            type="button"
            onClick={onNavigate}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-bold transition-colors shadow-2xs cursor-pointer"
          >
            학기말 정리 바로가기 →
          </button>
          <button
            onClick={handleSnooze}
            className="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md font-semibold transition-colors"
          >
            1주일 스누즈
          </button>
          <button
            onClick={() => setShowBanner(false)}
            className="p-1 text-amber-500 hover:text-amber-800"
            title="닫기"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
