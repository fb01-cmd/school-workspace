import { signInWithPopup, signInWithCredential, signOut, GoogleAuthProvider, User } from "firebase/auth";
import { auth, googleProvider } from "./config";

export interface UserData {
  email: string;
  domain: string;
  role: "student" | "teacher" | "super_admin";
  isApproved: boolean;
  isSecurityGroupJoined?: boolean;
  orgUnitPath?: string;
  createdAt?: any;
}

export const signInWithGoogle = async () => {
  try {
    // 기존 세션을 무조건 종료 후 새 계정으로 로그인
    await signOut(auth);
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await handleUserRoles(user);
    return user;
  } catch (error: any) {
    console.error("Google Sign-In Error", error);
    throw error;
  }
};




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

