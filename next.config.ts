import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist는 번들에 넣지 않고 node_modules에서 그대로 로드한다 — 번들러가 묶으면
  // 브라우저 전용 전역(DOMMatrix)을 참조하는 경로가 섞여 서버 라우트가 죽는다
  // (2026-08-16 실사고: 배정표 업로드가 배포에서만 "DOMMatrix is not defined").
  // 로컬 검증(tsx)은 원본 로드라 무사했다 — 이 설정이 배포를 로컬과 같은 조건으로 만든다.
  serverExternalPackages: ["pdfjs-dist"],
  // Firebase 인증 핸들러(/__/auth/*)를 우리 도메인에서 서빙하도록 프록시.
  // signInWithRedirect가 별도 도메인(firebaseapp.com)을 경유하면 크롬의
  // 서드파티 저장소 차단 정책에 걸려 로그인 결과가 유실되므로(공식 문서의
  // "redirect best practices" Option 3), 인증 경로를 same-origin으로 만든다.
  async rewrites() {
    return [
      {
        source: "/__/auth/:path*",
        destination: "https://school-sync-hub.firebaseapp.com/__/auth/:path*",
      },
    ];
  },
};

export default nextConfig;
