"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import PushNotificationManager from "@/components/common/PushNotificationManager";
import NotificationCenter from "@/components/common/NotificationCenter";
import MealCard from "@/components/common/MealCard";
import TodayTimetableCard from "@/components/mobile/TodayTimetableCard";
import MobileMemoSection from "@/components/mobile/MobileMemoSection";
import MobileTasksSection from "@/components/mobile/MobileTasksSection";
import { resolveDisplayName } from "@/lib/org/displayName";

export default function MobileTeacherHome() {
  const { user, teacherProfile } = useAuth();

  const handleSignOut = async () => {
    try {
      await logOut();
      window.location.href = "/login";
    } catch (err) {
      console.error("Sign out failed", err);
    }
  };

  // 굳어진 로컬부 가드 (§11-7). user.displayName은 첫 로그인 때의 스냅샷이라 GWS에서
  // 이름을 고쳐도 낡은 값(영문 병기 등)이 계속 나온다 — gwsName 인자로 쓰지 않는다 (2026-08-20 실기기).
  const displayName = user?.email
    ? resolveDisplayName(user.email, teacherProfile ?? undefined).name
    : "선생님";

  return (
    <RouteGuard allowedRoles={["teacher", "super_admin"]}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        {/* 1. 최상단 고정 헤더 */}
        <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 shadow-2xs">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg">🏫</span>
              <div>
                <h1 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight inline">
                  효명고등학교
                </h1>
                <span className="text-xs text-slate-500 dark:text-slate-400 ml-1.5 font-normal">
                  {displayName}님
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleSignOut}
                className="whitespace-nowrap text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                로그아웃
              </button>
              <NotificationCenter />
            </div>
          </div>
        </header>

        <div className="max-w-md mx-auto p-4 space-y-4 pb-10">

          {/* 2. 알림 켜기 */}
          <PushNotificationManager />

          {/* 3. 내 할 일 (phase8_tasks_spec §7, 열람 + 완료 체크 + 파일/사진 제출) */}
          <MobileTasksSection />

          {/* 4. 쪽지 — 안읽은 쪽지 우선 목록 (spec §4-2, 쓰기 없음) */}
          <MobileMemoSection />

          {/* 5. 오늘·내일 내 시간표 */}
          <TodayTimetableCard />

          {/* 6. 오늘 급식 */}
          <MealCard />

          {/* 5. PC 화면 링크 */}
          <footer className="pt-2 text-center">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline py-2 px-3 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
            >
              <span>전체 기능(관리 화면)은 PC 화면에서</span>
              <span>→</span>
            </Link>
          </footer>
        </div>
      </div>
    </RouteGuard>
  );
}
