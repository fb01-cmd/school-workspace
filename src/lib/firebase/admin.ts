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
 * 이메일에 매칭되는 Firestore users/{uid} 문서를 전부 삭제합니다 (중복 uid 포함).
 * users 문서는 로그인 시(sync-user) 생성만 되고 삭제 경로가 없어, 계정 삭제·재생성이
 * 반복되면 유령·중복 문서가 쌓이는 결함(2026-08-07 실측: 유령 7건, 동일 이메일 5중복)의
 * 재발 방지 장치. 실패해도 호출 흐름을 깨지 않는다 (베스트 에포트).
 */
export const deleteFirestoreUserDocsByEmail = async (email: string): Promise<number> => {
  try {
    const target = email.trim();
    const variants = [...new Set([target, target.toLowerCase()])];
    let deleted = 0;
    for (const v of variants) {
      const snap = await adminDb.collection("users").where("email", "==", v).get();
      if (snap.empty) continue;
      const batch = adminDb.batch();
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
    }
    return deleted;
  } catch (err: any) {
    console.warn(`[Firebase Admin] users 문서 정리 실패 (${email}): ${err.message}`);
    return 0;
  }
};

/**
 * 이메일을 기준으로 Firebase Authentication 내 사용자 계정을 조회하여 삭제합니다.
 * 백엔드 동기화(전출, 삭제, 새학기 입학 전 stale 계정 정리) 시 호출되어
 * GWS UID 변경에 의한 auth/provider-already-linked 에러를 근본적으로 차단합니다.
 *
 * 함께: Firestore users/{uid} 문서도 이메일 기준으로 동반 정리합니다 — 이 함수는
 * 모든 삭제·생성 전 정리 흐름이 지나는 단일 관문이므로, 여기 한 곳에 두면
 * 개별/일괄/크론/전출 전 경로에서 유령 문서가 남지 않는다.
 */
export const deleteAuthUserByEmail = async (email: string): Promise<boolean> => {
  await deleteFirestoreUserDocsByEmail(email);
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

/**
 * 학교 설정(settings 컬렉션)에서 학생 OU 경로 목록을 조회하는 공통 헬퍼
 * - Firestore settings/{domain} 문서의 ouMapping.students를 파싱
 * - 문서가 없거나 매핑이 비어있으면 기본값 ["/students"] 반환
 */
export const getStudentOUPaths = async (domain: string): Promise<string[]> => {
  try {
    const settingsSnap = await adminDb.collection("settings").doc(domain).get();
    if (settingsSnap.exists) {
      const data = settingsSnap.data();
      const ouMap = data?.ouMapping?.students || {};
      const paths = (Object.values(ouMap) as string[]).filter(Boolean);
      if (paths.length > 0) {
        console.log(`[Student OU Resolver] Loaded ouMapping for ${domain} from Firestore settings:`, paths);
        return paths;
      }
    }
  } catch (e: any) {
    console.warn(`[Student OU Resolver] Failed to fetch settings for ${domain}:`, e?.message || e);
  }
  console.log(`[Student OU Resolver] Fallback student OU paths used for ${domain}: ["/students"]`);
  return ["/students"];
};

