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

  // allowedRoles는 호출부에서 인라인 배열로 넘어와 렌더마다 참조가 바뀌므로,
  // 문자열 키로 변환해 deps에 사용 (메뉴 전환 등 부모 리렌더마다 effect가
  // 재실행되며 Firestore 재조회하던 문제 방지)
  const rolesKey = allowedRoles.join(",");

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
    // (완료 플래그가 서 있으면 재검사하지 않음 — 세션당 1회)
    const isTeacher = userData.role === "teacher" || userData.role === "super_admin";
    if (securityGroupCheckDone) {
      // 이미 확인 완료 — 재실행 불필요
    } else if (isTeacher && !userData.isSecurityGroupJoined && userData.email && userData.domain) {
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
    // (완료 플래그가 서 있으면 재조회하지 않음 — 세션당 1회)
    const isTransferPage = pathname?.startsWith("/admin/transfer-deadline");
    if (transferCheckDone) {
      // 이미 확인 완료 — 재조회 불필요
    } else if (!isTransferPage && userData.domain && userData.email) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userData, loading, rolesKey, router, pathname]);

  if (loading || !user || !userData || !allowedRoles.includes(userData.role)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">로그인 상태 확인 중...</p>
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
