"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import { useRouter } from "next/navigation";
import UserList from "@/components/admin/UserList";
import OUConfiguration from "@/components/admin/OUConfiguration";
import AuditLogViewer from "@/components/admin/AuditLogViewer";
import StudentRoster from "@/components/admin/StudentRoster";
import StudentLifecycle from "@/components/admin/lifecycle/StudentLifecycle";
import GroupList from "@/components/admin/GroupList";

type MenuType = "home" | "users" | "groups" | "settings" | "bulk" | "forms" | "logs" | "roster" | "lifecycle";

export default function AdminPage() {
  const { userData } = useAuth();
  const router = useRouter();
  const [activeMenu, setActiveMenu] = useState<MenuType>("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleLogout = async () => {
    await logOut();
    router.push("/login");
  };

  const hasAccess = userData?.role === "super_admin" || userData?.isApproved;
  const isSuperAdmin = userData?.role === "super_admin";

  const renderContent = () => {
    switch (activeMenu) {
      case "users":
        return <UserList />;
      case "groups":
        return <GroupList />;
      case "settings":
        return isSuperAdmin ? (
          <OUConfiguration />
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-2">권한이 없습니다</h3>
            <p className="text-gray-600">조직단위 설정은 수퍼어드민 전용 기능입니다.</p>
          </div>
        );
      case "bulk":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">📥 학생 명단 벌크 업로드</h3>
            <p className="text-gray-600 mb-4">엑셀(Excel) 또는 CSV 파일을 올려 학생 계정을 일괄 생성하거나 전입/전출 처리를 진행합니다.</p>
            <span className="inline-flex px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">개발 예정</span>
          </div>
        );
      case "forms":
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">📝 동적 생활지도 기록 폼 빌더</h3>
            <p className="text-gray-600 mb-4">매년 양식이 달라지는 학생 관찰 및 생활지도 기록 폼을 코딩 없이 마우스 클릭으로 빌드합니다.</p>
            <span className="inline-flex px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">개발 예정</span>
          </div>
        );
      case "logs":
        return <AuditLogViewer />;
      case "roster":
        return <StudentRoster />;
      case "lifecycle":
        return <StudentLifecycle />;
      case "home":
      default:
        return (
          <div className="space-y-8">
            {/* Summary Banner */}
            <div className="bg-gradient-to-r from-indigo-800 to-blue-900 rounded-lg text-white p-6 shadow-md">
              <h2 className="text-xl font-bold mb-2">효명고등학교 관리 시스템</h2>
              <p className="text-blue-100 text-sm">
                구글 워크스페이스와 실시간 연동되어 학교 도리인 계정 및 학적을 안전하게 관리합니다.
              </p>
            </div>

            {/* Widget Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Users Widget - Super Admin Only */}
              {isSuperAdmin && (
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
                  <p className="text-gray-500 text-sm mb-6">사용자를 조회하거나 추가하고, 비밀번호 및 계정을 직접 제어합니다.</p>
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
              )}

              {/* Groups Widget - Super Admin Only */}
              {isSuperAdmin && (
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
                  <p className="text-gray-500 text-sm mb-6">반별 구글 메일링 그룹 및 학년별 교직원 그룹을 조회하고 가입/게시판 권한을 조정합니다.</p>
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
              )}

              {/* OU Mapping Widget (Super Admin Only) */}
              {isSuperAdmin && (
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
                    <p className="text-gray-500 text-sm mb-6">구글 워크스페이스 조직 트리(OU)를 불러와 교사와 학년제 매핑 규칙을 지정합니다.</p>
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
              )}

              {/* Domain Widget */}
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">도메인 정보</h3>
                    <span className="p-2 rounded-lg bg-purple-50 text-purple-600">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                      </svg>
                    </span>
                  </div>
                  <div className="space-y-2 mb-6">
                    <p className="text-sm font-semibold text-gray-800">
                      연동 도메인: <span className="font-mono text-indigo-600">{userData?.domain}</span>
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2 py-1 rounded">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                      구글 API 서버 통신 상태 정상 (GCP 연동 완료)
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  관리자 계정: {userData?.email}
                </div>
              </div>

              {/* Bulk Upload Widget - Super Admin Only */}
              {isSuperAdmin && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow opacity-75">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">벌크 업로드</h3>
                    <span className="p-2 rounded-lg bg-yellow-50 text-yellow-600">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm mb-6">엑셀 및 CSV 대량 계정 추가와 학기/학년말 대량 전출 관리를 일괄 처리합니다.</p>
                </div>
                <div>
                  <button
                    onClick={() => setActiveMenu("bulk")}
                    className="w-full text-left text-sm text-yellow-700 hover:text-yellow-950 font-semibold py-1.5"
                  >
                    일괄 업로드 페이지로 이동 →
                  </button>
                </div>
              </div>
              )}

              {/* Form Builder Widget - Super Admin Only */}
              {isSuperAdmin && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow opacity-75">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">동적 폼 빌더</h3>
                    <span className="p-2 rounded-lg bg-pink-50 text-pink-600">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm mb-6">생활지도 관찰지나 상담 일지 폼을 자유롭게 직접 만들고 답변 데이터를 기록합니다.</p>
                </div>
                <div>
                  <button
                    onClick={() => setActiveMenu("forms")}
                    className="w-full text-left text-sm text-pink-700 hover:text-pink-950 font-semibold py-1.5"
                  >
                    생활지도 폼 만들기 →
                  </button>
                </div>
              </div>
              )}
            </div>
          </div>
        );
    }
  };

  return (
    <RouteGuard allowedRoles={["teacher", "super_admin"]}>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Left Sidebar */}
        <aside
          className={`bg-indigo-950 text-gray-300 w-64 flex-shrink-0 transition-all flex flex-col justify-between ${
            isSidebarOpen ? "block" : "hidden"
          } md:flex`}
        >
          {/* Logo & Navigation */}
          <div>
            {/* Brand Header */}
            <div className="h-16 flex items-center gap-3 px-6 bg-indigo-900 text-white font-bold tracking-wide border-b border-indigo-800">
              <span className="bg-indigo-600 text-white p-1 rounded-md text-sm font-bold">효명</span>
              <span>효명고등학교</span>
            </div>

            {/* Nav Menu */}
            <nav className="p-4 space-y-1">
              <button
                onClick={() => setActiveMenu("home")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeMenu === "home"
                    ? "bg-indigo-800 text-white"
                    : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                }`}
              >
                <span>🏠</span>
                <span>홈 (대시보드)</span>
              </button>

              {/* 사용자 관리 - Super Admin Only */}
              {isSuperAdmin && (
              <button
                onClick={() => setActiveMenu("users")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeMenu === "users"
                    ? "bg-indigo-800 text-white"
                    : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                }`}
              >
                <span>👥</span>
                <span>사용자 관리</span>
              </button>
              )}

              {/* 그룹 관리 - Super Admin Only */}
              {isSuperAdmin && (
              <button
                onClick={() => setActiveMenu("groups")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeMenu === "groups"
                    ? "bg-indigo-800 text-white"
                    : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                }`}
              >
                <span>💬</span>
                <span>그룹 관리</span>
              </button>
              )}

              {/* 조직단위 설정 - Super Admin Only */}
              {isSuperAdmin && (
                <button
                  onClick={() => setActiveMenu("settings")}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activeMenu === "settings"
                      ? "bg-indigo-800 text-white"
                      : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                  }`}
                >
                  <span>⚙️</span>
                  <span>조직단위 설정</span>
                </button>
              )}

              {/* 학적 관리 - Super Admin Only */}
              {isSuperAdmin && (
                <button
                  onClick={() => setActiveMenu("lifecycle")}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activeMenu === "lifecycle"
                      ? "bg-indigo-800 text-white"
                      : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                  }`}
                >
                  <span>📚</span>
                  <span>학적 관리</span>
                </button>
              )}

              {/* 학생 명렬표 인쇄 - All Users */}
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

              {/* 추가 도구 섹션 - Super Admin Only */}
              {isSuperAdmin && (
              <>
              <div className="pt-4 pb-2 px-4 text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                추가 도구
              </div>

              <button
                onClick={() => setActiveMenu("bulk")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeMenu === "bulk"
                    ? "bg-indigo-800 text-white"
                    : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                }`}
              >
                <span>📥</span>
                <span>벌크 업로드</span>
              </button>

              <button
                onClick={() => setActiveMenu("forms")}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeMenu === "forms"
                    ? "bg-indigo-800 text-white"
                    : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                }`}
              >
                <span>📝</span>
                <span>동적 폼 빌더</span>
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
              </>
              )}
            </nav>
          </div>

          {/* User profile section at the bottom */}
          <div className="p-4 border-t border-indigo-900 bg-indigo-950/50">
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
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top Navbar */}
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 focus:outline-none md:hidden"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="text-lg font-bold text-gray-800">
                {activeMenu === "home" && "어드민 홈 대시보드"}
                {activeMenu === "users" && "사용자 명단 관리"}
                {activeMenu === "settings" && "조직도 매핑 설정"}
                {activeMenu === "bulk" && "명단 벌크 업로드"}
                {activeMenu === "forms" && "동적 폼 빌더"}
                {activeMenu === "logs" && "작업 감사 로그"}
                {activeMenu === "roster" && "학급 명렬표 인쇄 & 관리"}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                isSuperAdmin ? "bg-indigo-100 text-indigo-800" : "bg-gray-100 text-gray-800"
              }`}>
                {isSuperAdmin ? "수퍼어드민 권한" : "교사 권한"}
              </span>
            </div>
          </header>

          {/* Dynamic Content Panel */}
          <main className="flex-1 overflow-auto p-8">
            <div className="max-w-6xl mx-auto">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </RouteGuard>
  );
}
