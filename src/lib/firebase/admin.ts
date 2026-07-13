import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

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
