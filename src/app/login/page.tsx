"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getRedirectResult } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { signInWithGoogle, logOut } from "@/lib/firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { PWAInstallPrompt } from "@/components/pwa/PWAInstallPrompt";

export default function LoginPage() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 설치형 앱(standalone) redirect 로그인에서 돌아온 경우의 오류 표시 전용.
    // 성공 흐름은 AuthContext의 onAuthStateChanged가 처리하므로 여기서는 건드리지 않는다.
    // 아이폰 설치형 앱은 원격 디버깅이 안 되므로 실패를 화면에 드러내는 것이 유일한 단서다.
    getRedirectResult(auth).catch((err: any) => {
      console.error("Redirect sign-in error", err);
      setError(`로그인에 실패했습니다. 다시 시도해주세요. (${err?.code || err?.message || "알 수 없는 오류"})`);
    });
  }, []);

  useEffect(() => {
    // If the user is already logged in and we have their data, redirect them based on their role
    if (!loading && user && userData) {
      if (userData.role === "student") {
        router.push("/student-portal");
      } else {
        const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
        if (isMobile) {
          router.push("/m");
        } else {
          router.push("/admin");
        }
      }
    }
  }, [user, userData, loading, router]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
      // The useEffect will handle redirect once user and userData update
    } catch (err: any) {
      console.error(err);
      // 차단 계정 거부는 서버가 준 안내 문구를 그대로 보여준다 (coop_account_block_spec §3)
      setError(
        err?.name === "BlockedAccountError"
          ? err.message
          : "로그인에 실패했습니다. 다시 시도해주세요."
      );
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logOut();
      window.location.reload();
    } catch (err) {
      console.error("Sign out failed", err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">로딩 중...</p>
      </div>
    );
  }

  // If user is authenticated in Firebase but their database profile (userData) couldn't be loaded
  if (user && !userData) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md space-y-6 rounded-xl bg-white p-10 shadow-lg text-center">
          <h2 className="text-2xl font-bold text-red-600">계정 권한 확인 실패</h2>
          <p className="text-gray-600 text-sm">
            로그인한 계정(<strong className="font-mono">{user.email}</strong>)의 권한 정보를 불러오지 못했거나 등록되지 않은 계정입니다.
          </p>
          <div className="pt-2">
            <button
              onClick={handleSignOut}
              className="w-full flex justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors shadow-sm"
            >
              로그아웃 / 다른 계정으로 로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-white p-10 shadow-lg">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            효명고등학교
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            구글 워크스페이스 계정 및 학적 관리 시스템
          </p>
          <div className="mt-3 flex justify-center">
            <PWAInstallPrompt />
          </div>
        </div>
        
        <div className="mt-8 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          
          <button
            onClick={handleGoogleSignIn}
            disabled={isSigningIn}
            className="group relative flex w-full justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
          >
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
              <svg className="h-5 w-5 text-indigo-500 group-hover:text-indigo-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
              </svg>
            </span>
            {isSigningIn ? "로그인 중..." : "Google 계정으로 로그인"}
          </button>

          {/* 사전 개인정보 처리 안내 요약 박스 */}
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-2.5">
            <div className="flex items-center justify-between font-semibold text-slate-800 border-b border-slate-200/80 pb-2">
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                개인정보 처리 안내
              </span>
              <span className="text-[11px] text-slate-400 font-normal">사전 고지</span>
            </div>
            
            <ul className="space-y-1.5 text-slate-600 leading-snug">
              <li className="flex items-start gap-1.5">
                <span className="text-slate-400 select-none">•</span>
                <span><strong>목적</strong>: Google Workspace 계정·학적 관리 및 학교 행정 업무</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-slate-400 select-none">•</span>
                <span><strong>항목</strong>: 학교 이메일, 이름, 학번/부서 등 최소 필요 정보</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-slate-400 select-none">•</span>
                <span><strong>원칙</strong>: 학교 업무 수행에 필요한 최소한의 범위에서만 처리</span>
              </li>
            </ul>

            <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">자세한 내용은 처리 안내 전문을 확인하세요.</span>
              <Link 
                href="/privacy" 
                className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5 transition-colors"
              >
                전문 보기
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
