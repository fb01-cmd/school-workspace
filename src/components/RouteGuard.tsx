"use client";

import { useEffect, useRef, useState } from "react";
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
  // 사용량 맥박 — 세션당 1회만. state가 아니라 ref다(재렌더를 일으킬 이유가 없다)
  const usagePulseSentRef = useRef(false);

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
        router.replace("/student");
      } else {
        router.replace("/teacher");
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
          if (!res.ok) return;
          // **실제로 붙은 게 1건 이상일 때만** 완료 도장을 찍는다 (2026-08-21).
          // 종전에는 res.ok 만 보고 찍었다. 그래서 설정에서 보안그룹을 빼 둔 동안
          // 로그인한 교사는 **0개 가입인데 «연동 완료»** 가 되고, 이 플래그가 재시도
          // 조건이라(위 !userData.isSecurityGroupJoined) 나중에 보안그룹을 다시
          // 등록해도 그 교사만 조용히 빠진 채 남았다.
          const data = await res.json().catch(() => null);
          if (data && typeof data.joinedCount === "number" && data.joinedCount < 1) return;
          await updateDoc(userRef, { isSecurityGroupJoined: true });
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

    // 1-2. 사용량 「로그인 맥박」 (2026-08-21 사용자 발안 — 「로그인 픽셀」)
    //
    // 메일 수신확인 픽셀처럼, **로그인했다는 사실 자체**를 사용량 점검의 방아쇠로 쓴다.
    // 근거: 읽기의 다수가 브라우저 onSnapshot 구독이라(`usage_alert.ts` 머리 주석)
    // **사용량이 오르는 것과 누군가 로그인해 있는 것은 사실상 같은 사건**이다.
    // 아무도 안 들어오면 읽기가 오르지도 않으니 점검할 필요도 없다.
    //
    // 이것이 메우는 빈틈: 판정을 사용량 화면 조회로 옮겼지만 **관리자가 그 화면을
    // 열어야만** 돌았다. 크론은 Vercel Hobby 2개 한도가 차 있어 주기를 못 줄인다.
    //
    // 화면에는 아무것도 나타나지 않는다 — 응답은 `{ok:true}`뿐이고 숫자는 안 돌려준다.
    // 실제 점검은 서버가 5분에 1회로 쓰로틀한다(70명이 몰려도 1회).
    // 세션당 1회만 던지고, 실패해도 조용히 넘어간다 — 로그인 흐름을 막지 않는다.
    if (!usagePulseSentRef.current) {
      usagePulseSentRef.current = true;
      fetch("/api/ops/usage/pulse", { method: "POST" }).catch(() => {});
    }

    // 2. 전출 대기 교사 강제 리다이렉트 체크
    // /teacher/transfer-deadline 페이지 자체는 예외 처리
    // (완료 플래그가 서 있으면 재조회하지 않음 — 세션당 1회)
    const isTransferPage = pathname?.startsWith("/teacher/transfer-deadline");
    if (transferCheckDone) {
      // 이미 확인 완료 — 재조회 불필요
    } else if (!isTransferPage && userData.domain && userData.email) {
      const domain = userData.domain;
      const email = userData.email;
      getDoc(doc(db, "teacher_transfer_tasks", domain, "teachers", email))
        .then((snap) => {
          const status = snap.data()?.status;
          if (snap.exists() && (status === "PENDING_DEADLINE" || status === "DEADLINE_SET")) {
            router.replace("/teacher/transfer-deadline");
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
  const isTransferPage = pathname?.startsWith("/teacher/transfer-deadline");
  if (!isTransferPage && (!transferCheckDone || !securityGroupCheckDone)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">계정 보안 상태 확인 중...</p>
      </div>
    );
  }

  return <>{children}</>;
}
