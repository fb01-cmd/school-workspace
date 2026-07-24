import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { NextRequest } from "next/server";

// Initialize Firebase Admin SDK once
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export const adminDb = getFirestore();

/**
 * 이메일을 기준으로 Firebase Authentication 내 사용자 계정을 조회하여 삭제합니다.
 * 백엔드 동기화(전출, 삭제, 새학기 입학 전 stale 계정 정리) 시 호출되어
 * GWS UID 변경에 의한 auth/provider-already-linked 에러를 근본적으로 차단합니다.
 */
export const deleteAuthUserByEmail = async (email: string): Promise<boolean> => {
  try {
    const authAdmin = getAuth();
    const userRecord = await authAdmin.getUserByEmail(email);
    await authAdmin.deleteUser(userRecord.uid);
    console.log(`[Firebase Admin] Successfully deleted stale Auth user: ${email}`);
    return true;
  } catch (err: any) {
    if (err.code === "auth/user-not-found") {
      // 이미 Firebase Auth에 없는 상태라면 정상으로 판단
      return true;
    }

    console.warn(
      `[Firebase Admin] Warning: Failed to delete Firebase Auth user for ${email} (Permission check required): ${err.message}`
    );
    return false;
  }
};

export interface DecodedAuthAccess {
  uid: string;
  email: string;
  role: "student" | "teacher" | "super_admin";
}

/**
 * HTTP Request 쿠키에서 토큰을 추출하여 유효성을 검증하고,
 * 유저의 UID 및 권한(Role) 정보를 반환합니다.
 * 미인증 접근 또는 변조된 토큰일 경우 null을 반환합니다.
 */
export const verifyAuthAccess = async (req: NextRequest): Promise<DecodedAuthAccess | null> => {
  try {
    const token = req.cookies.get("token")?.value;
    if (!token) return null;

    const authAdmin = getAuth();
    const decodedToken = await authAdmin.verifyIdToken(token);
    const { uid, email } = decodedToken;
    if (!email) return null;

    // Firestore에서 유저 권한 조회 (Admin SDK 사용)
    const userSnap = await adminDb.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      // 동기화 딜레이 등으로 Firestore 문서가 아직 생성되지 않은 경우
      // 이메일 주소 패턴 기반으로 임시 권한 판별 (학생 vs 교사)
      const isStudent = /^\d{5}@hmh\.or\.kr$/.test(email);
      return { uid, email, role: isStudent ? "student" : "teacher" };
    }

    const userData = userSnap.data() || {};
    return {
      uid,
      email,
      role: userData.role || "teacher",
    };
  } catch (err: any) {
    console.error("[Auth Guard] 토큰 검증 실패:", err.message);
    return null;
  }
};
