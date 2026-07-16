"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import RouteGuard from "@/components/RouteGuard";
import { logOut } from "@/lib/firebase/auth";
import { useRouter } from "next/navigation";
import UserList from "@/components/admin/UserList";
import OUConfiguration from "@/components/admin/OUConfiguration";
import OUManager from "@/components/admin/OUManager";
import AuditLogViewer from "@/components/admin/AuditLogViewer";
import StudentRoster from "@/components/admin/StudentRoster";
import StudentLifecycle from "@/components/admin/lifecycle/StudentLifecycle";
import TeacherLifecycle from "@/components/admin/lifecycle/TeacherLifecycle";
import GroupList from "@/components/admin/GroupList";
import ClassroomPage from "@/app/admin/classroom/page";
import ChromeBookmarks from "@/components/admin/ChromeBookmarks";

type MenuType = "home" | "users" | "groups" | "settings" | "bulk" | "forms" | "logs" | "roster" | "lifecycle" | "teachers" | "ou_manage" | "classroom" | "chrome_bookmarks";

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
      case "classroom":
        return <ClassroomPage />;
      case "chrome_bookmarks":
        return <ChromeBookmarks />;
      case "groups":
        return <GroupList />;
      case "settings":
        return <OUConfiguration />;
      case "ou_manage":
        return <OUManager />;
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
      case "teachers":
        return <TeacherLifecycle />;
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

              {/* Classroom Widget - All Teachers */}
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
                  <p className="text-gray-500 text-sm mb-6">새로운 클래스룸 수업을 개설하거나 기존 수업에 학생들을 즉시 강제 배정합니다.</p>
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
            <nav className="p-4 space-y-4">
              {/* 일반 교직원 공통 메뉴 */}
              <div>
                <div className="px-4 pb-2 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                  교직원 공통 도구
                </div>
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
                    <span>홈 (대시보드)</span>
                  </button>

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
                    onClick={() => setActiveMenu("forms")}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      activeMenu === "forms"
                        ? "bg-indigo-800 text-white"
                        : "hover:bg-indigo-900/50 text-gray-400 hover:text-white"
                    }`}
                  >
                    <span>📝</span>
                    <span>생활지도 기록 작성</span>
                  </button>
                </div>
              </div>

              {/* GWS 관리자 전용 메뉴 */}
              {isSuperAdmin && (
                <div className="space-y-4">
                  {/* 시스템 환경설정 */}
                  <div>
                    <div className="border-t border-indigo-900/50 my-2 pt-2 px-4 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                      ⚙️ 시스템 설정
                    </div>
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
                  </div>

                  {/* 사용자 및 조직 관리 */}
                  <div>
                    <div className="border-t border-indigo-900/50 my-2 pt-2 px-4 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
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
                        <span>그룹스 전체관리</span>
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
                    </div>
                  </div>

                  {/* 계정 생애주기 관리 */}
                  <div>
                    <div className="border-t border-indigo-900/50 my-2 pt-2 px-4 text-[10px] font-bold text-red-400 uppercase tracking-wider">
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

                  {/* 추가 도구 */}
                  <div>
                    <div className="border-t border-indigo-900/50 my-2 pt-2 px-4 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                      🛠️ 추가 도구
                    </div>
                    <div className="space-y-1">
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
                </div>
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
                {activeMenu === "users" && "사용자 전체관리"}
                {activeMenu === "settings" && "Workspace 환경 설정"}
                {activeMenu === "ou_manage" && "GWS 조직단위 관리"}
                {activeMenu === "bulk" && "명단 벌크 업로드"}
                {activeMenu === "forms" && "생활지도 기록 작성"}
                {activeMenu === "logs" && "작업 감사 로그"}
                {activeMenu === "roster" && "학급 명렬표 인쇄 & 관리"}
                {activeMenu === "classroom" && "구글 클래스룸 학생 즉시 배정"}
                {activeMenu === "teachers" && "교직원 계정 및 생애주기 관리"}
                {activeMenu === "lifecycle" && "학생 계정 생애주기 관리"}
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
