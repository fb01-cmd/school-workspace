"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import PushNotificationManager from "@/components/common/PushNotificationManager";
import MealCard from "@/components/common/MealCard";
import TodayTimetableCard from "@/components/mobile/TodayTimetableCard";

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

  const displayName = teacherProfile?.name || user?.displayName || user?.email?.split("@")[0] || "선생님";

  return (
    <RouteGuard allowedRoles={["teacher", "super_admin"]}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="max-w-md mx-auto p-4 space-y-4 pb-10">
          {/* 1. 헤더 */}
          <header className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-xl">🏫</span>
              <div>
                <h1 className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">
                  효명고등학교
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {displayName}님
                </p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              로그아웃
            </button>
          </header>

          {/* 2. 알림 켜기 */}
          <PushNotificationManager />

          {/* 3. 오늘·내일 내 시간표 */}
          <TodayTimetableCard />

          {/* 4. 오늘 급식 */}
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
