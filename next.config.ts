import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
