import { signInWithPopup, signInWithRedirect, signInWithCredential, signOut, GoogleAuthProvider, User } from "firebase/auth";
import { auth, googleProvider } from "./config";

export interface UserData {
  email: string;
  domain: string;
  role: "student" | "teacher" | "super_admin";
  isApproved: boolean;
  isSecurityGroupJoined?: boolean;
  orgUnitPath?: string;
  createdAt?: any;
  policyAck?: {
    version: string;
    ackedAt: any;
  };
}

// 홈 화면에 설치한 앱(standalone)으로 실행 중인지. iOS는 이 모드에서 팝업 로그인이
// 결과를 앱으로 돌려주지 못한 채 오류도 없이 멈추므로(2026-08-11 아이폰 실기기 실증)
// 팝업을 시도조차 하지 않고 처음부터 redirect 방식을 쓴다.
// navigator.standalone은 iOS 사파리 전용 레거시 플래그 — display-mode 미디어쿼리의 이중 방어.
const isStandaloneApp = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

export const signInWithGoogle = async () => {
  try {
    // 기존 세션을 무조건 종료 후 새 계정으로 로그인
    await signOut(auth);
    if (isStandaloneApp()) {
      // 복귀 후에는 AuthContext의 onAuthStateChanged가 handleUserRoles를 호출해
      // 나머지 흐름(역할 동기화 → 화면 이동)을 이어간다. 오류는 로그인 페이지의
      // getRedirectResult가 표시한다.
      await signInWithRedirect(auth, googleProvider);
      return null; // 이 직후 페이지가 이동하므로 반환값은 사용되지 않음
    }
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await handleUserRoles(user);
    return user;
  } catch (error: any) {
    // 팝업이 차단되거나 팝업을 지원하지 않는 환경이면 전체 페이지 이동(redirect)
    // 방식으로 자동 전환한다. 브라우저가 구글 로그인 페이지로 이동했다가 돌아오고,
    // 복귀 후에는 AuthContext의 onAuthStateChanged가 handleUserRoles를 호출해
    // 나머지 흐름(역할 동기화 → 화면 이동)을 그대로 이어간다.
    if (
      error?.code === "auth/popup-blocked" ||
      error?.code === "auth/operation-not-supported-in-this-environment"
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null; // 이 직후 페이지가 이동하므로 반환값은 사용되지 않음
    }
    console.error("Google Sign-In Error", error);
    throw error;
  }
};




/** 차단 OU 계정 로그인 거부 (coop_account_block_spec §3) — 로그인 화면이 message를 그대로 표시 */
export class BlockedAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAccountError";
  }
}

export const handleUserRoles = async (user: User) => {
  if (!user.email) throw new Error("No email found for user.");

  // 역할 판정·기록은 서버(/api/auth/sync-user)가 ID 토큰을 검증해 수행한다.
  // 클라이언트가 role을 직접 쓰면 보안 규칙을 잠가도 권한 상승 통로가 남기 때문.
  const idToken = await user.getIdToken();
  const res = await fetch("/api/auth/sync-user", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.blocked) {
      // 세션을 즉시 끊는다 — 남겨두면 AuthContext 자가 치유(users 문서 부재 감지)가
      // 페이지 로드마다 이 호출을 재시도하는 루프가 된다 (spec §3 함정).
      await signOut(auth).catch(() => {});
      throw new BlockedAccountError(data.error || "이 포털은 효명고등학교 구성원 계정만 사용할 수 있습니다.");
    }
    throw new Error(data.error || "사용자 역할 동기화에 실패했습니다.");
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Sign Out Error", error);
    throw error;
  }
};

