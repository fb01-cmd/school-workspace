"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import MyProfileCard from "@/components/admin/MyProfileCard";
import ClassroomCleanupBanner from "@/components/admin/ClassroomCleanupBanner";
import SavingModeBanner from "@/components/common/SavingModeBanner";

const TabLoading = () => (
  <div className="p-8 text-center text-slate-500 font-medium">
    <div className="animate-pulse flex items-center justify-center gap-2">
      <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
      <span>메뉴 탭을 로딩 중입니다...</span>
    </div>
  </div>
);

const UserList = dynamic(() => import("@/components/admin/UserList"), { loading: TabLoading });
const OUConfiguration = dynamic(() => import("@/components/admin/OUConfiguration"), { loading: TabLoading });
const OUManager = dynamic(() => import("@/components/admin/OUManager"), { loading: TabLoading });
const AuditLogViewer = dynamic(() => import("@/components/admin/AuditLogViewer"), { loading: TabLoading });
const StudentRoster = dynamic(() => import("@/components/admin/StudentRoster"), { loading: TabLoading });
const StudentLifecycle = dynamic(() => import("@/components/admin/lifecycle/StudentLifecycle"), { loading: TabLoading });
const TeacherLifecycle = dynamic(() => import("@/components/admin/lifecycle/TeacherLifecycle"), { loading: TabLoading });
const GroupList = dynamic(() => import("@/components/admin/GroupList"), { loading: TabLoading });
const ClassroomPage = dynamic(() => import("@/app/teacher/classroom/page"), { loading: TabLoading });
const ChromeBookmarks = dynamic(() => import("@/components/admin/ChromeBookmarks"), { loading: TabLoading });
const PasswordReset = dynamic(() => import("@/components/admin/PasswordReset"), { loading: TabLoading });
const ProfileApprovals = dynamic(() => import("@/components/admin/ProfileApprovals"), { loading: TabLoading });
const ClassroomCleanupTab = dynamic(() => import("@/components/admin/ClassroomCleanupTab"), { loading: TabLoading });
const DisciplineSection = dynamic(() => import("@/components/admin/discipline/DisciplineSection"), { loading: TabLoading });
const TimetableOperationSection = dynamic(() => import("@/components/admin/timetable/TimetableOperationSection"), { loading: TabLoading });
const TimetableCreationSection = dynamic(() => import("@/components/admin/timetable/TimetableCreationSection"), { loading: TabLoading });
const TeacherPortalSection = dynamic(() => import("@/components/admin/timetable/TeacherPortalSection"), { loading: TabLoading });
const PolicyAckStatusTab = dynamic(() => import("@/components/admin/PolicyAckStatusTab"), { loading: TabLoading });
const PWAInstallGuideTab = dynamic(() => import("@/components/admin/PWAInstallGuideTab"), { loading: TabLoading });
const MessagingHub = dynamic(() => import("@/components/admin/MessagingHub"), { loading: TabLoading });
const TasksSection = dynamic(() => import("@/components/admin/tasks/TasksSection"), { loading: TabLoading });
const UsageDashboardTab = dynamic(() => import("@/components/admin/UsageDashboardTab"), { loading: TabLoading });
import { PWAInstallPrompt } from "@/components/pwa/PWAInstallPrompt";
import MealCard from "@/components/common/MealCard";
import AdminUsageSummaryBanner from "@/components/admin/AdminUsageSummaryBanner";
import PushNotificationManager from "@/components/common/PushNotificationManager";
import NotificationCenter from "@/components/common/NotificationCenter";
import MyTimetableCard from "@/components/admin/MyTimetableCard";
import DashboardMemoPanel, { useIncomingMemos } from "@/components/admin/DashboardMemoPanel";
import DashboardTaskCard from "@/components/admin/DashboardTaskCard";

import { getClientCache, setClientCache } from "@/lib/cache/clientCache";
import { TimetableSettings } from "@/lib/timetable/types";

import { db } from "@/lib/firebase/config";
import { collection, query, where, onSnapshot } from "firebase/firestore";

type MenuType = "home" | "hub" | "users" | "groups" | "settings" | "forms" | "logs" | "roster" | "lifecycle" | "teachers" | "ou_manage" | "classroom" | "classroom_cleanup" | "chrome_bookmarks" | "password_reset" | "profile_approvals" | "discipline" | "timetable_operation" | "timetable_creation" | "my_timetable" | "policy_ack" | "pwa_guide" | "memo" | "tasks" | "usage";

export default function AdminPage() {
  const { userData, teacherProfile } = useAuth();
  const router = useRouter();
  // 수신 쪽지 구독 — 페이지에서 한 번만. 홈 패널과 사이드바 안읽음 배지가 나눠 쓴다
  // (읽기량: 접속당 최근 50건 1회 + 실시간 변경분. 리스너 추가 없음 — 홈 패널 것을 승격)
  const memoFeed = useIncomingMemos();
  const [activeMenu, setActiveMenu] = useState<MenuType>("home");
  const [initialHubCategory, setInitialHubCategory] = useState<"tasks" | "memo">("tasks");
  const [targetMemoId, setTargetMemoId] = useState<string | null>(null);
  // 알림·카드에서 온 이동 요청의 일련번호 (같은 항목을 다시 눌러도 전달되게 한다)
  const [navSeq, setNavSeq] = useState(0);
  const [targetTaskId, setTargetTaskId] = useState<string | null>(null);
  // 기본 닫힘. md 이상은 aside의 md:flex가 항상 이기므로 이 값은 md 미만(드로어)에서만 의미가 있고,
  // /m 폐지(2026-08-21)로 폰이 여기로 바로 랜딩하게 되면서 열림이 기본이면 첫 화면이 드로어에 덮인다.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [pendingProfileCount, setPendingProfileCount] = useState(0);
  const [pendingDisciplineCount, setPendingDisciplineCount] = useState<number | null>(null);
  const [pendingSwapCount, setPendingSwapCount] = useState<number | null>(null);
  const [timetableSettings, setTimetableSettings] = useState<TimetableSettings | null>(null);

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    common: false,
    timetable: false,
    discipline: false,
    admin: false,
  });

  // Restore collapsed sections state from localStorage or calculate defaults
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setIsSidebarOpen(false);
    }
    try {
      const saved = localStorage.getItem("admin_sidebar_collapsed");
      if (saved) {
        setCollapsedSections(JSON.parse(saved));
      } else {
        const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
        setCollapsedSections({
          common: false,
          timetable: false,
          discipline: false,
          admin: isMobile,
        });
      }
    } catch (e) {}
  }, []);

  // 모바일 드로어: 메뉴를 고르면 닫는다 — 개별 버튼 40곳 대신 activeMenu 변화 한 지점에서
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setIsSidebarOpen(false);
    }
  }, [activeMenu]);

  // admin_navigate 이벤트 리스너 (탭/메뉴간 이동 및 허브 별칭 라우팅 — spec §1-2-3)
  useEffect(() => {
    const handleAdminNav = (e: any) => {
      if (e.detail?.menu) {
        // 지목이 없는 이동(「쪽지함 바로가기」 등)은 직전 지목을 지운다 —
        // 남겨 두면 목록으로 가라는 요청이 옛날 항목을 다시 여는 꼴이 된다.
        setTargetMemoId(e.detail.memoId ?? null);
        setTargetTaskId(e.detail.taskId ?? null);
        // ⚠️ 이미 그 화면에 있을 때 아무 일도 안 일어나던 원인이 여기였다.
        // 아래 setActiveMenu·setInitialHubCategory 가 전부 "지금과 같은 값"이면
        // React가 리렌더를 건너뛰고, 그러면 허브의 열기 effect도 돌지 않는다.
        // 이동 요청 자체를 세는 값을 하나 올려 매번 확실히 전달한다.
        setNavSeq((n) => n + 1);
        if (e.detail.menu === "memo") {
          setInitialHubCategory("memo");
          setActiveMenu("hub");
        } else if (e.detail.menu === "tasks") {
          setInitialHubCategory("tasks");
          setActiveMenu("hub");
        } else {
          setActiveMenu(e.detail.menu);
        }
      }
    };
    window.addEventListener("admin_navigate", handleAdminNav);
    return () => window.removeEventListener("admin_navigate", handleAdminNav);
  }, []);

  // 알림 딥링크 착지 — `?nav=memo&id=…` 로 들어오면 그 화면을 연다 (2026-08-21 신설)
  //
  // 사용자 신고: *"모바일 알림 플로트가 떠서 눌렀는데 그냥 앱 홈이 나오고 쪽지로 이동은
  // 안 됐어."* 원인은 서비스 워커가 아니라 **보내는 쪽**이었다 — 푸시 payload의 `url`이
  // `"/"` 로 하드코딩돼 있었다(`webpush.ts`). 쪽지·업무 번호는 이미 `tag`에 쓰고 있으면서
  // 주소에는 안 썼다.
  //
  // 앱 안 알림함이 쓰는 `admin_navigate` 장치가 이미 잘 동작하므로 **그대로 재사용**한다.
  // 여기서는 주소 → 이벤트로 옮겨 주기만 하면 된다.
  //
  // 처리 후 주소를 지운다(`replaceState`) — 안 지우면 새로고침·뒤로가기 때마다 같은
  // 항목이 다시 열려, 사용자가 목록으로 못 빠져나온다.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nav = params.get("nav");
    if (!nav) return;

    const id = params.get("id") || undefined;
    const detail: Record<string, unknown> = { menu: nav };
    if (id) {
      if (nav === "memo") detail.memoId = id;
      else if (nav === "tasks") detail.taskId = id;
    }

    // 주소부터 정리하고 이벤트를 쏜다 (이벤트 처리 중 리렌더가 나도 주소가 남지 않게)
    window.history.replaceState({}, "", window.location.pathname);
    window.dispatchEvent(new CustomEvent("admin_navigate", { detail }));
  }, []);

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      try {
        localStorage.setItem("admin_sidebar_collapsed", JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  // Load timetable settings to check managerEmails for sidebar menu access
  useEffect(() => {
    if (!userData) return;
    const cached = getClientCache("timetable:settings");
    if (cached?.settings) {
      setTimetableSettings(cached.settings);
    } else {
      fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_settings" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.settings) {
            setTimetableSettings(data.settings);
            setClientCache("timetable:settings", { settings: data.settings, terms: data.terms });
          }
        })
        .catch(() => {});
    }

    const handleSettingsUpdate = (e: any) => {
      if (e.detail?.managerEmails) {
        setTimetableSettings((prev) =>
          prev
            ? { ...prev, managerEmails: e.detail.managerEmails }
            : { managerEmails: e.detail.managerEmails, activeTermId: null, days: 5, periodsPerDay: 7, lunchAfterPeriod: 4, observerEmails: [] }
        );
      }
    };
    window.addEventListener("timetableSettingsUpdated", handleSettingsUpdate);
    return () => window.removeEventListener("timetableSettingsUpdated", handleSettingsUpdate);
  }, [userData]);

  // Real-time pending profile approvals count
  useEffect(() => {
    if (userData?.role !== "super_admin") return;
    const q = query(
      collection(db, "teacher_profiles_pending"),
      where("status", "==", "PENDING")
    );
    const unsub = onSnapshot(q, snap => setPendingProfileCount(snap.size));
    return () => unsub();
    // 인증 로딩이 끝난 뒤(userData 도착 후) 구독을 시작해야 함 — []이면 마운트 시 조기 return으로 영영 미구독
  }, [userData?.role]);

  // 대시보드 미처리 건수 1회 집계 (클라이언트 캐시 5분 TTL 적용, 실시간 구독 미사용으로 Firestore 읽기 예산 보호)
  useEffect(() => {
    if (!userData || userData.role !== "super_admin") return;

    // 1) 미처리 생활지도 건수
    const cachedDiscipline = getClientCache("dashboard:pending_discipline");
    if (cachedDiscipline !== null && cachedDiscipline !== undefined) {
      setPendingDisciplineCount(Number(cachedDiscipline));
    } else {
      fetch("/api/discipline/stage-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", onlyPending: true }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.events)) {
            const count = data.events.length;
            setPendingDisciplineCount(count);
            setClientCache("dashboard:pending_discipline", count, 5 * 60 * 1000);
          }
        })
        .catch(() => {});
    }

    // 2) 교체 신청 대기 건수
    const cachedSwap = getClientCache("dashboard:pending_swap");
    if (cachedSwap !== null && cachedSwap !== undefined) {
      setPendingSwapCount(Number(cachedSwap));
    } else {
      fetch("/api/timetable/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_list", status: "PENDING" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.requests)) {
            const count = data.requests.length;
            setPendingSwapCount(count);
            setClientCache("dashboard:pending_swap", count, 5 * 60 * 1000);
          }
        })
        .catch(() => {});
    }
  }, [userData]);

  const handleLogout = async () => {
    await logOut();
    router.push("/login");
  };

  // hasAccess(= role super_admin || isApproved)는 2026-08-13에 제거했다. 선언만 되고 어디서도
  // 읽히지 않는 죽은 변수였는데, isApproved가 학생 계정에도 true라(sync-user) 누군가 나중에
  // 이걸 관문으로 배선하는 순간 학생이 관리자 화면에 들어오는 구조였다. 권한 판정의 단일
  // 원본은 role(= GWS 관리자 여부)이다.
  const isSuperAdmin = userData?.role === "super_admin";
  const isTeacher = userData?.role === "teacher";
  const isStudent = userData?.role === "student";
  const hasNoProfile = (isSuperAdmin || isTeacher) && !teacherProfile;

  const userEmail = userData?.email?.toLowerCase() || "";
  const isTimetableManager =
    isSuperAdmin ||
    (timetableSettings?.managerEmails || []).some((m) => m.toLowerCase() === userEmail);
  // 열람 전용 참관자 (교무부장 등) — 요청대장 읽기만 (phase9b_spec §5)
  const isTimetableObserver =
    !isTimetableManager &&
    (timetableSettings?.observerEmails || []).some((m) => m.toLowerCase() === userEmail);
  const canSeeTimetableMenu = isTimetableManager || isTimetableObserver;

  const handleNavigateToMemo = (memoId?: string) => {
    setTargetMemoId(memoId || null);
    setInitialHubCategory("memo");
    setActiveMenu("hub");
  };

  const handleNavigateToTasks = (taskId?: string) => {
    setTargetTaskId(taskId || null);
    setInitialHubCategory("tasks");
    setActiveMenu("hub");
  };

  const renderContent = () => {
    switch (activeMenu) {
      case "hub":
        return <MessagingHub initialCategory={initialHubCategory} initialTaskId={targetTaskId} initialMemoId={targetMemoId} navSeq={navSeq} />;
      case "users":
        return <UserList />;
      case "profile_approvals":
        return isSuperAdmin ? (
          <ProfileApprovals />
        ) : (
          <div className="p-8 text-center text-slate-500 text-sm">관리자 전용 메뉴입니다.</div>
        );
      case "classroom":
        return <ClassroomPage />;
      case "classroom_cleanup":
        return <ClassroomCleanupTab />;
      case "discipline":
        return <DisciplineSection />;
      case "chrome_bookmarks":
        return <ChromeBookmarks />;
      case "password_reset":
        return <PasswordReset />;
      case "groups":
        return <GroupList />;
      case "settings":
        return <OUConfiguration />;
      case "ou_manage":
        return <OUManager />;
      case "forms":
      case "discipline":
        return <DisciplineSection />;
      case "timetable_operation":
        return canSeeTimetableMenu ? <TimetableOperationSection /> : null;
      case "timetable_creation":
        return isTimetableManager ? <TimetableCreationSection /> : null;
      case "my_timetable":
        // 교사 신청 화면 (phase9b_spec §7 순서 4). 학생·canSeeTimetableMenu 게이트는 컴포넌트 내부에서 재검증.
        return <TeacherPortalSection />;
      case "logs":
        return <AuditLogViewer />;
      case "policy_ack":
        return isSuperAdmin ? <PolicyAckStatusTab /> : null;
      case "usage":
        return isSuperAdmin ? <UsageDashboardTab /> : null;
      case "pwa_guide":
        return <PWAInstallGuideTab />;
      case "roster":
        return <StudentRoster />;
      case "lifecycle":
        return <StudentLifecycle />;
      case "teachers":
        return <TeacherLifecycle />;
      case "home":
      default:
        return (
          <div className="space-y-6">
            {/* 조직 정보 미등록 안내 배너 */}
            {hasNoProfile && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-4">
                <span className="text-2xl mt-0.5">⚠️</span>
                <div className="flex-1">
                  <p className="font-bold text-amber-800 text-sm">조직 정보를 아직 등록하지 않으셨습니다.</p>
                  <p className="text-amber-700 text-xs mt-1">소속 부서, 직책, 담임 여부 등을 등록하면 앞으로 업무 배포나 메시지 발송 기능에서 올바르게 식별됩니다.</p>
                </div>
                <button
                  onClick={() => document.dispatchEvent(new CustomEvent("openMyProfileModal"))}
                  className="flex-shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  지금 등록하기
                </button>
              </div>
            )}
            {/* 배너 없음 — 학교 이름은 사이드바 맨 위 로고(:657)가 항상 띄우고 있고,
                이 줄의 머리는 「홈」이다. 배너를 두면 학교 이름이 한 화면에 두 번 나온다.
                (2026-08-21 사용자 질의 「홈 자리로 효명고 관리 시스템이 가면?」에 대한 결론 —
                 머리줄을 학교 이름으로 바꾸면 「머리줄 = 사이드바에서 누른 이름」 규칙이 홈만 깨진다) */}
            {/* 알림 카드는 공통 최상단 */}
            <PushNotificationManager />
            {isSuperAdmin && <AdminUsageSummaryBanner onNavigate={() => setActiveMenu("usage")} />}

            {/* super_admin 홈: 상단 개인 업무·쪽지 영역 및 관리 위젯 그리드 (피드백 13번, 19번: 내 할 일 → 받은 쪽지 → 급식 순서) */}
            {isSuperAdmin ? (
              <div className="space-y-6">
                {/* 상단 개인 업무 및 쪽지 영역 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  <DashboardTaskCard onNavigate={() => { setInitialHubCategory("tasks"); setActiveMenu("hub"); }} />
                  <DashboardMemoPanel onNavigateToMemo={handleNavigateToMemo} feed={memoFeed} />
                </div>

                {/* 급식 카드 */}
                <MealCard />

                {/* 관리자 위젯 그리드 */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* 1. Profile Approvals Widget (할 일 건수 카드) */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">프로필 승인</h3>
                        {pendingProfileCount > 0 ? (
                          <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse">
                            승인 대기 {pendingProfileCount}건
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                            대기 0건
                          </span>
                        )}
                      </div>
                      <span className="p-2 rounded-lg bg-amber-50 text-amber-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => setActiveMenu("profile_approvals")}
                      className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5"
                    >
                      프로필 승인 바로가기 →
                    </button>
                  </div>
                </div>

                {/* 2. Student Discipline Widget (할 일 건수 카드) */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">학생 생활지도</h3>
                        {pendingDisciplineCount !== null && (
                          pendingDisciplineCount > 0 ? (
                            <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse">
                              미처리 {pendingDisciplineCount}건
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                              미처리 0건
                            </span>
                          )
                        )}
                      </div>
                      <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => setActiveMenu("discipline")}
                      className="w-full text-left text-sm text-blue-600 hover:text-blue-800 font-semibold py-1.5"
                    >
                      생활지도 종합 관리 바로가기 →
                    </button>
                  </div>
                </div>

                {/* 3. Timetable Operation Widget (할 일 건수 카드) */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">시간표 운영</h3>
                        {pendingSwapCount !== null && (
                          pendingSwapCount > 0 ? (
                            <span className="bg-indigo-100 text-indigo-800 text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse">
                              교체 신청 {pendingSwapCount}건
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                              대기 0건
                            </span>
                          )
                        )}
                      </div>
                      <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => setActiveMenu("timetable_operation")}
                      className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5"
                    >
                      시간표 운영 바로가기 →
                    </button>
                  </div>
                </div>

                {/* 4. Users Widget */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-900">사용자</h3>
                      <span className="p-2 rounded-lg bg-blue-50 text-blue-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setActiveMenu("users")}
                      className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5"
                    >
                      사용자 전체보기 →
                    </button>
                  </div>
                </div>

                {/* 5. Groups Widget */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-900">그룹</h3>
                      <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </span>
                    </div>
                    <p className="text-gray-500 text-sm mb-6">반별·업무별 구글 메일링 그룹</p>
                  </div>
                  <div>
                    <button
                      onClick={() => setActiveMenu("groups")}
                      className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5"
                    >
                      그룹 전체보기 →
                    </button>
                  </div>
                </div>

                {/* 6. OU Mapping Widget */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-900">조직단위 설정</h3>
                      <span className="p-2 rounded-lg bg-green-50 text-green-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </span>
                    </div>
                    <p className="text-gray-500 text-sm mb-6">구글 조직단위(OU)와 학년·교사 연결</p>
                  </div>
                  <div>
                    <button
                      onClick={() => setActiveMenu("settings")}
                      className="w-full text-left text-sm text-indigo-600 hover:text-indigo-800 font-semibold py-1.5"
                    >
                      조직 매핑 설정하기 →
                    </button>
                  </div>
                </div>

                {/* 7. Classroom Widget */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-900">클래스룸 배정</h3>
                      <span className="p-2 rounded-lg bg-pink-50 text-pink-600">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => setActiveMenu("classroom")}
                      className="w-full text-left text-sm text-pink-600 hover:text-pink-800 font-semibold py-1.5"
                    >
                      수업 생성 및 학생 배정 →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
              /* 일반 교사(role teacher) 홈: 넓은 화면 2단(좌: 할일+시간표+급식, 우: 받은 쪽지).
                 좁은 화면은 DOM 순서대로 세로 스택 — 열 래퍼로 묶으면 쪽지가 급식 아래로
                 통째로 떨어지므로(2026-08-20 실기기), 네 카드를 그리드 직속 자식으로 두고
                 모바일 순서 = 할 일 → 쪽지 → 시간표 → 급식 (피드백 13·19 순서 원칙과 정합) */
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="contents lg:block lg:col-span-7 xl:col-span-8 lg:space-y-6">
                  <div className="order-1"><DashboardTaskCard onNavigate={() => { setInitialHubCategory("tasks"); setActiveMenu("hub"); }} /></div>
                  <div className="order-3"><MyTimetableCard onNavigateToMyTimetable={() => setActiveMenu("my_timetable")} /></div>
                  <div className="order-4"><MealCard /></div>
                </div>
                <div className="contents lg:block lg:col-span-5 xl:col-span-4">
                  <div className="order-2"><DashboardMemoPanel onNavigateToMemo={handleNavigateToMemo} feed={memoFeed} /></div>
                </div>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <RouteGuard allowedRoles={["teacher", "super_admin"]}>
      {/* h-screen + main overflow-auto: 본문을 main 스크롤로 고정해야 우측 미리보기 패널의 sticky가 작동한다 */}
      <div className="h-screen bg-gray-50 flex">
        {/* 모바일 드로어 배경 — 사이드바를 본문 위에 겹치게 바꾸면서 추가 (2026-08-20 실기기:
            밀어내기형은 열면 본문이 ~150px로 눌려 글자가 세로로 쏟아졌다). 탭하면 닫힘 */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        {/* Left Sidebar — md 미만에서는 겹침형(드로어), md 이상은 기존 밀착형 그대로 */}
        <aside
          className={`bg-indigo-950 text-gray-300 w-64 flex-shrink-0 transition-all flex flex-col justify-between overflow-y-auto max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-2xl ${
            isSidebarOpen ? "block" : "hidden"
          } md:flex`}
        >
          {/* Logo & Navigation */}
          <div>
            {/* Brand Header (피드백 21번: 효명 배지 -> 교표 아이콘)
                로고 탭 = 사이드바 접기 (2026-08-20 사용자: 3줄 메뉴보다 로고가 직관) */}
            <div
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="h-16 flex items-center gap-3 px-6 bg-indigo-900 text-white font-bold tracking-wide border-b border-indigo-800 cursor-pointer select-none">
              <div className="w-8 h-8 rounded-lg bg-white p-0.5 shadow-xs flex items-center justify-center flex-shrink-0">
                <img
                  src="/icon-192.png"
                  alt="효명고 교표"
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="text-base tracking-tight">효명고등학교</span>
            </div>

            {/* Nav Menu */}
            <nav className="p-4 space-y-4">
              {/* 일반 교직원 공통 메뉴 */}
              <div>
                <button
                  type="button"
                  onClick={() => toggleSection("common")}
                  className="w-full flex items-center justify-between px-4 pb-2 text-xs font-bold text-indigo-400 uppercase tracking-wider hover:text-indigo-200 transition-colors"
                >
                  <span>교직원 공통 도구</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      collapsedSections.common ? "-rotate-90" : "rotate-0"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedSections.common && (
                  <div className="space-y-1">
                    <button
                      onClick={() => setActiveMenu("home")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "home"
                          ? "bg-indigo-800 text-white"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>🏠</span>
                      <span>홈</span>
                    </button>

                    {/* 쪽지·업무 — 홈 바로 아래, 전 교직원 (messaging_hub_ia_spec §1-2) */}
                    <button
                      onClick={() => {
                        setTargetMemoId(null);
                        setTargetTaskId(null);
                        setInitialHubCategory("tasks");
                        setActiveMenu("hub");
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "hub" || activeMenu === "memo" || activeMenu === "tasks"
                          ? "bg-indigo-800 text-white font-bold shadow-sm"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>✉️</span>
                      <span>쪽지·업무</span>
                      {/* 안 읽은 쪽지 수 — 쪽지함에 들어가야만 보이던 것을 메뉴에서 바로 (backlog A12) */}
                      {memoFeed.unreadCount > 0 && (
                        <span className="ml-auto min-w-[1.35rem] text-center text-[11px] font-bold bg-rose-500 text-white rounded-full px-1.5 py-0.5">
                          {memoFeed.unreadCount > 9 ? "9+" : memoFeed.unreadCount}
                        </span>
                      )}
                    </button>

                    {/* 내 시간표 (교사 최다 사용 메뉴 — 홈 바로 아래 이동) */}
                    {!isStudent && (
                      <button
                        onClick={() => setActiveMenu("my_timetable")}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          activeMenu === "my_timetable"
                            ? "bg-indigo-800 text-white font-bold shadow-sm"
                            : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                        }`}
                      >
                        <span>📅</span>
                        <span>내 시간표</span>
                      </button>
                    )}

                    <button
                      onClick={() => setActiveMenu("roster")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "roster"
                          ? "bg-indigo-800 text-white"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>📋</span>
                      <span>학생 명렬표 인쇄</span>
                    </button>

                    <button
                      onClick={() => setActiveMenu("chrome_bookmarks")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "chrome_bookmarks"
                          ? "bg-indigo-800 text-white"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>🔖</span>
                      <span>크롬 북마크 배정</span>
                    </button>

                    <button
                      onClick={() => setActiveMenu("classroom")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "classroom"
                          ? "bg-indigo-800 text-white"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>🏫</span>
                      <span>클래스룸 학생 강제 배정</span>
                    </button>

                    <button
                      onClick={() => setActiveMenu("password_reset")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "password_reset"
                          ? "bg-indigo-800 text-white"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>🔑</span>
                      <span>학생 비밀번호 초기화</span>
                    </button>

                    {/* 학기말 클래스룸 정리 — 시기성 기능이라 사용 빈도 기준 맨 아래 (2026-08-06 사용자 확정) */}
                    <button
                      onClick={() => setActiveMenu("classroom_cleanup")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "classroom_cleanup"
                          ? "bg-indigo-800 text-white"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>📦</span>
                      <span>학기말 클래스룸 정리</span>
                    </button>

                    {/* 「내 조직 정보 신청」 사이드바 항목 제거 (2026-08-21 사용자 판단).
                        하단 「내 정보 관리」 카드와 **완전히 같은 창**(MyProfileModal)을 여는
                        중복 통로였다. 같은 창으로 가는 길이 5곳 더 있고(홈 미등록 배너의
                        버튼 `:346`, MyProfileCard, 쪽지·업무 작성기 4곳), 미등록 상태 안내도
                        홈 상단 배너(`:338`)가 이미 크게 하고 있어 뱃지도 중복이었다.
                        `openMyProfileModal` 이벤트는 나머지 통로가 계속 쓴다. */}
                  </div>
                )}
              </div>

              {/* 시간표 독립 섹션 (super_admin + managerEmails + 열람 전용 참관자) */}
              {canSeeTimetableMenu && (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleSection("timetable")}
                    className="w-full flex items-center justify-between px-4 pb-2 text-xs font-bold text-indigo-400 uppercase tracking-wider hover:text-indigo-200 transition-colors"
                  >
                    <span>시간표 관리</span>
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        collapsedSections.timetable ? "-rotate-90" : "rotate-0"
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!collapsedSections.timetable && (
                    <div className="space-y-1">
                      <button
                        onClick={() => setActiveMenu("timetable_operation")}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                          activeMenu === "timetable_operation"
                            ? "bg-indigo-800 text-white font-bold shadow-sm"
                            : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                        }`}
                      >
                        <span>🗓️</span>
                        <span>시간표 운영</span>
                      </button>
                      {isTimetableManager && (
                        <button
                          onClick={() => setActiveMenu("timetable_creation")}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            activeMenu === "timetable_creation"
                              ? "bg-indigo-800 text-white font-bold shadow-sm"
                            : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                          }`}
                        >
                          <span>🧩</span>
                          <span>시간표 작성</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 학생 생활지도 독립 섹션 */}
              <div>
                <button
                  type="button"
                  onClick={() => toggleSection("discipline")}
                  className="w-full flex items-center justify-between px-4 pb-2 text-xs font-bold text-indigo-400 uppercase tracking-wider hover:text-indigo-200 transition-colors"
                >
                  <span>학생 생활지도</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                      collapsedSections.discipline ? "-rotate-90" : "rotate-0"
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedSections.discipline && (
                  <div className="space-y-1">
                    <button
                      onClick={() => setActiveMenu("discipline")}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        activeMenu === "discipline"
                          ? "bg-indigo-800 text-white font-bold shadow-sm"
                          : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                      }`}
                    >
                      <span>⚖️</span>
                      <span>생활지도 종합 관리</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 🔐 관리자 전용 대섹션 (super_admin 전용) */}
              {isSuperAdmin && (
                <div className="pt-2 border-t border-indigo-900/60">
                  <button
                    type="button"
                    onClick={() => toggleSection("admin")}
                    className="w-full flex items-center justify-between px-4 pb-2 text-xs font-bold text-red-300 uppercase tracking-wider hover:text-red-100 transition-colors"
                  >
                    <span>🔐 관리자 전용</span>
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        collapsedSections.admin ? "-rotate-90" : "rotate-0"
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {!collapsedSections.admin && (
                    <div className="space-y-4 pt-1">
                      {/* 시스템 설정 */}
                      <div>
                        <div className="px-4 pb-1 text-xs font-bold text-indigo-400 uppercase tracking-wider">
                          ⚙️ 시스템 설정
                        </div>
                        <div className="space-y-1">
                          <button
                            onClick={() => setActiveMenu("settings")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "settings"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>🛠️</span>
                            <span>Workspace 환경 설정</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("policy_ack")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "policy_ack"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>🔒</span>
                            <span>개인정보 고지 현황</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("usage")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "usage"
                                ? "bg-indigo-800 text-white font-bold shadow-sm"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>📊</span>
                            <span>사용량</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("logs")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "logs"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>🛡️</span>
                            <span>작업 감사 로그</span>
                          </button>
                        </div>
                      </div>

                      {/* 사용자 및 조직 관리 */}
                      <div>
                        <div className="px-4 pb-1 text-xs font-bold text-indigo-400 uppercase tracking-wider">
                          👥 사용자 및 조직 관리
                        </div>
                        <div className="space-y-1">
                          <button
                            onClick={() => setActiveMenu("users")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "users"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>👤</span>
                            <span>사용자 전체관리</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("groups")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "groups"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>💬</span>
                            <span>구글 메일링 그룹</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("ou_manage")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "ou_manage"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>🏢</span>
                            <span>조직단위 관리</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("profile_approvals")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "profile_approvals"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>📥</span>
                            {/* 2026-08-19 사용자 확정: 「프로필 승인 대기」→「교직원 조직도 관리」.
                                교직원 공통 도구의 「교직원 조직도」를 내리면서(피드백 8번) 이 메뉴가
                                조직도 열람의 유일한 경로가 됐는데, 옛 이름으로는 그게 안 읽혀
                                관리자가 조직도를 못 찾았다(사용자 실기기, 배포 당일). 위치는 유지. */}
                            <span>교직원 조직도 관리</span>
                            {pendingProfileCount > 0 && (
                              <span className="ml-auto bg-amber-400 text-amber-900 text-[11px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                                {pendingProfileCount}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* 계정 생애주기 관리 */}
                      <div>
                        <div className="px-4 pb-1 text-xs font-bold text-red-300 uppercase tracking-wider">
                          🔄 계정 생애주기 관리
                        </div>
                        <div className="space-y-1">
                          <button
                            onClick={() => setActiveMenu("lifecycle")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "lifecycle"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>🎓</span>
                            <span>학생 계정 생애주기</span>
                          </button>

                          <button
                            onClick={() => setActiveMenu("teachers")}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                              activeMenu === "teachers"
                                ? "bg-indigo-800 text-white"
                                : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                            }`}
                          >
                            <span>👩‍🏫</span>
                            <span>교직원 계정 생애주기</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </nav>
          </div>

          {/* User profile section at the bottom */}
          <div className="p-4 border-t border-indigo-900 bg-indigo-950/50 space-y-3">
            {/* 내 조직 정보 카드 */}
            <MyProfileCard />
            <div className="text-xs text-gray-500 font-semibold mb-1">로그인 계정</div>
            <div className="text-sm font-medium text-white truncate mb-3" title={userData?.email}>
              {userData?.email}
            </div>
            <button
              onClick={handleLogout}
              className="w-full text-center py-2 bg-indigo-900 hover:bg-indigo-800 text-gray-300 hover:text-white text-xs font-semibold rounded transition-colors"
            >
              로그아웃
            </button>
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center mt-2 text-[11px] text-gray-500 hover:text-gray-300 hover:underline transition-colors"
            >
              개인정보 처리 안내
            </a>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top Navbar */}
          {/* 모바일 헤더 겹침 방지 (2026-08-20 실기기): 제목은 truncate, 우측은 shrink-0,
              앱 실행 안내 pill은 sm 미만 숨김 — 폰의 설치 안내는 로그인 화면이 담당한다
              (/m 폐지 전에는 "모바일 설치 안내는 /m에 있다"고 적혀 있었으나 /m에는 알림 켜기만 있었다) */}
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between gap-2 px-4 md:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 focus:outline-none md:hidden"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              {/* 이 줄이 각 화면의 유일한 제목이다 (2026-08-21 사용자 결정 「제목을 두 번 안 쓴다」).
                  화면 컴포넌트 안에 페이지 제목을 다시 두지 않는다 — 안에 두면 같은 말이 두 번 나오고
                  모양도 화면마다 갈린다(짙은 배너/흰 카드/없음 세 종류였다).
                  ⚠️ 여기 이름은 사이드바 메뉴 이름과 글자까지 같아야 한다. 누른 이름과 뜨는 이름이
                  다르면 다른 데로 온 것처럼 읽힌다 — 7곳이 어긋나 있던 것을 같은 날 맞췄다. */}
              <h1 className="text-lg font-bold text-gray-800 truncate">
                {activeMenu === "home" && "홈"}
                {activeMenu === "users" && "사용자 전체관리"}
                {activeMenu === "groups" && "구글 메일링 그룹"}
                {activeMenu === "classroom_cleanup" && "학기말 클래스룸 정리"}
                {activeMenu === "chrome_bookmarks" && "크롬 북마크 배정"}
                {activeMenu === "password_reset" && "학생 비밀번호 초기화"}
                {activeMenu === "profile_approvals" && "교직원 조직도 관리"}
                {activeMenu === "discipline" && "생활지도 종합 관리"}
                {activeMenu === "settings" && "Workspace 환경 설정"}
                {activeMenu === "ou_manage" && "조직단위 관리"}
                {activeMenu === "forms" && "생활지도 기록 작성"}
                {activeMenu === "logs" && "작업 감사 로그"}
                {activeMenu === "policy_ack" && "개인정보 고지 현황"}
                {activeMenu === "usage" && "사용량"}
                {activeMenu === "pwa_guide" && "앱으로 설치하기 안내"}
                {activeMenu === "roster" && "학생 명렬표 인쇄"}
                {activeMenu === "classroom" && "클래스룸 학생 강제 배정"}
                {activeMenu === "teachers" && "교직원 계정 생애주기"}
                {activeMenu === "lifecycle" && "학생 계정 생애주기"}
                {activeMenu === "timetable_operation" && "시간표 운영"}
                {activeMenu === "timetable_creation" && "시간표 작성"}
                {activeMenu === "my_timetable" && "내 시간표"}
                {(activeMenu === "hub" || activeMenu === "memo" || activeMenu === "tasks") && "쪽지·업무"}
              </h1>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:block">
                <PWAInstallPrompt onOpenGuide={() => setActiveMenu("pwa_guide")} />
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                isSuperAdmin ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-800"
              }`}>
                {isSuperAdmin ? "수퍼어드민 권한" : "교사 권한"}
              </span>
              <NotificationCenter />
            </div>
          </header>

          {/* Dynamic Content Panel */}
          {activeMenu === "hub" ? (
            /* 쪽지·업무는 패딩/max-width 없이 꽉 채움 (2단 레이아웃 및 좌·우 독립 스크롤).
               ClassroomCleanupBanner는 모든 메뉴에서 노출되어야 하므로(결정 #5) 여기도 포함. */
            <main className="flex-1 overflow-hidden flex flex-col">
              <div className="px-4 pt-3 pb-0 space-y-3">
                <SavingModeBanner />
                <ClassroomCleanupBanner onNavigate={() => setActiveMenu("classroom_cleanup")} />
              </div>
              <MessagingHub initialCategory={initialHubCategory} initialTaskId={targetTaskId} initialMemoId={targetMemoId} />
            </main>
          ) : (
            <main className="flex-1 overflow-auto p-8">
              <div className="max-w-6xl mx-auto space-y-4">
                <SavingModeBanner />
                {/* 학기말 정리 알림 배너: 어느 메뉴에 있든(홈 포함) 항상 노출 — 클래스룸 메뉴에 직접 들어가야만 보이면 결정 #5의 "안 가본 사람도 알게 한다"는 목적이 무력화됨 */}
                <ClassroomCleanupBanner onNavigate={() => setActiveMenu("classroom_cleanup")} />
                {renderContent()}
              </div>
            </main>
          )}
        </div>
      </div>
    </RouteGuard>
  );
}
