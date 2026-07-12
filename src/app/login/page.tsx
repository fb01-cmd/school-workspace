"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle, logOut } from "@/lib/firebase/auth";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { user, userData, loading } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If the user is already logged in and we have their data, redirect them based on their role
    if (!loading && user && userData) {
      if (userData.role === "student") {
        router.push("/student-portal");
      } else {
        router.push("/admin");
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
      setError("로그인에 실패했습니다. 다시 시도해주세요.");
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
        </div>
      </div>
    </div>
  );
}
