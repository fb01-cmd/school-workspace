import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 배포 환경에서는 인증 핸들러를 우리 도메인(same-origin, next.config.ts의 /__/auth 프록시)으로
// 서빙한다 — 크롬 서드파티 저장소 차단으로 redirect 로그인이 유실되는 문제의 근본 대책.
// 로컬 개발(localhost)은 http라 그대로 firebaseapp.com 핸들러를 쓴다(팝업 방식으로 동작).
const authDomain =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? window.location.host
    : process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase only if it hasn't been initialized already
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// 항상 계정 선택 창을 표시 — 기존 세션 계정과 다른 계정으로 로그인 가능하게
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
