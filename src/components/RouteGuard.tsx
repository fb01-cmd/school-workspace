"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { auth, db } from "@/lib/firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

export default function RouteGuard({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: Array<"student" | "teacher" | "super_admin">;
}) {
  const { user, userData, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  
  const [transferCheckDone, setTransferCheckDone] = useState(false);
  const [securityGroupCheckDone, setSecurityGroupCheckDone] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!user || !userData) {
      router.replace("/login");
      return;
    }

    if (!allowedRoles.includes(userData.role)) {
      if (userData.role === "student") {
        router.replace("/student-portal");
      } else {
        router.replace("/admin");
      }
      return;
    }

    // 1. GWS 보안그룹(ts@hmh.or.kr) 가입 유예 여부 감지 및 연동 처리
    const isTeacher = userData.role === "teacher" || userData.role === "super_admin";
    if (isTeacher && !userData.isSecurityGroupJoined && userData.email && userData.domain) {
      const userRef = doc(db, "users", user.uid);
      
      // 백그라운드 API 호출로 보안그룹 가입
      fetch("/api/workspace/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join_security_group",
          teacherEmail: userData.email,
          domain: userData.domain,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            // Firestore에 가입 완료 플래그 저장
            await updateDoc(userRef, { isSecurityGroupJoined: true });
          }
        })
        .catch((err) => {
          console.error("보안그룹 자동 연동 실패 (다음 로그인 때 재시도):", err);
        })
        .finally(() => {
          setSecurityGroupCheckDone(true);
        });
    } else {
      setSecurityGroupCheckDone(true);
    }

    // 2. 전출 대기 교사 강제 리다이렉트 체크
    // /admin/transfer-deadline 페이지 자체는 예외 처리
    const isTransferPage = pathname?.startsWith("/admin/transfer-deadline");
    if (!isTransferPage && userData.domain && userData.email) {
      const domain = userData.domain;
      const email = userData.email;
      getDoc(doc(db, "teacher_transfer_tasks", domain, "teachers", email))
        .then((snap) => {
          const status = snap.data()?.status;
          if (snap.exists() && (status === "PENDING_DEADLINE" || status === "DEADLINE_SET")) {
            router.replace("/admin/transfer-deadline");
          } else if (snap.exists() && status === "SUSPENDED") {
            signOut(auth).then(() => {
              router.replace("/login");
            });
          } else {
            setTransferCheckDone(true);
          }
        })
        .catch(() => {
          // 조회 실패 시 그냥 허용
          setTransferCheckDone(true);
        });
    } else {
      setTransferCheckDone(true);
    }
  }, [user, userData, loading, allowedRoles, router, pathname]);

  if (loading || !user || !userData || !allowedRoles.includes(userData.role)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">인증 확인 중...</p>
      </div>
    );
  }

  // 로딩 및 유효성 검사 완료 대기
  const isTransferPage = pathname?.startsWith("/admin/transfer-deadline");
  if (!isTransferPage && (!transferCheckDone || !securityGroupCheckDone)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">계정 보안 상태 확인 중...</p>
      </div>
    );
  }

  return <>{children}</>;
}
