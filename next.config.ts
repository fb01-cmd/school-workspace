import type { NextConfig } from "next";

// ── 웹 보안 헤더 (2026-08-21 도입, deferred_backlog B7) ──────────────────
//
// 2단 구조 — 화면을 깨뜨릴 수 없는 것만 즉시 시행하고, 깨뜨릴 수 있는 것(CSP)은
// 관찰 모드(Report-Only)로 위반 보고만 수집한다. 시행 전환은 보고가 잠잠한 것을
// 확인한 뒤 별도 결정 (STATUS 행 참조).
//
// ① 즉시 시행 (무해):
//    - nosniff: 응답을 선언된 콘텐츠 타입으로만 해석 (업로드물 스크립트 위장 차단)
//    - Referrer-Policy: 외부로 나갈 때 경로·쿼리 미전송 (URL에 정보를 안 담는 원칙의 이중화)
//    - X-Frame-Options: 타 사이트가 우리 화면을 iframe으로 감싸는 것(클릭재킹) 차단
//    - Permissions-Policy: 안 쓰는 브라우저 권한(카메라·마이크·위치) 원천 봉쇄
//    - HSTS는 Vercel이 자동 부여하므로 중복 선언하지 않는다.
// ② 관찰 모드 CSP: 목표 정책(외부 스크립트 전면 불허)을 그대로 걸되 Report-Only라
//    차단은 없고 위반이 /api/ops/csp-report 로 보고된다(Vercel 로그로 확인).
//    script-src에 'unsafe-inline'을 일부러 뺐다 — Next가 주입하는 인라인 스크립트가
//    얼마나 걸리는지 실측해야 시행 모드(nonce 도입 여부)를 정할 수 있다.
//
// /__/auth/* (아래 rewrites의 인증 프록시)는 CSP 대상에서 제외한다 — 구글 인증
// 핸들러가 외부 스크립트(gstatic)를 쓰는 페이지라 우리 정책과 다르고, 로그인은
// 어떤 경우에도 건드리지 않는다. /api/*는 JSON 응답이라 CSP가 무의미해 제외.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Tailwind·React 인라인 스타일 — 통상 허용 범위
  "img-src 'self' data: blob: https://lh3.googleusercontent.com", // 구글 프로필 사진 대비
  "font-src 'self' data:", // next/font는 빌드 시 자체 호스팅
  // Firebase 클라이언트 SDK 통신처 (Auth·Firestore)
  "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
  "frame-src 'self' https://www.iorad.com https://accounts.google.com", // 설치 안내 튜토리얼 + 구글 로그인
  "worker-src 'self' blob:", // 서비스 워커(PWA·푸시) + 솔버 웹 워커
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "report-uri /api/ops/csp-report",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // api(JSON)·인증 프록시 제외 — 위 머리말 참조
        source: "/((?!api|__/auth).*)",
        headers: [{ key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY }],
      },
    ];
  },

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

  // 옛 화면 주소 영구 보존 (2026-08-21 이름 통일: admin→teacher, student-portal→student).
  //
  // ⚠️ 이 규칙은 지우면 안 된다. 편의가 아니라 이미 발송된 안내문 때문이다 —
  // 졸업생·자퇴생·전출 교사에게 나간 메일과 구글 챗에 옛 주소가 박혀 있고, 그 링크가 하는 일이
  // 계정 삭제 기한 설정과 안내 확인 서명이며, 교사 전출은 기한이 최대 1년이다. 링크가 죽으면
  // 이미 학교를 떠난 사람이 물어볼 데도 없이 데이터를 잃는다. (경위: 일지 2026-08-21 「화면 주소 이름 통일」)
  //
  // :path* 와일드카드가 필요한 이유는 /admin/transfer-deadline 이 하위 경로라서다 —
  // 페이지 하나에 redirect()를 두는 방식(= /m에 쓴 방식)으로는 하위 경로가 안 덮인다.
  // permanent: true = 308. 주소가 되돌아갈 일이 없으므로 영구로 못 박는다.
  //
  // /api/* 는 의도적으로 제외한다. 외부 연동자(course-selection-app·명단 API 안내문 수신자)와
  // 구독 캘린더가 그 주소를 붙들고 있고, 이름을 다듬을 실익이 없다.
  async redirects() {
    return [
      { source: "/admin", destination: "/teacher", permanent: true },
      { source: "/admin/:path*", destination: "/teacher/:path*", permanent: true },
      { source: "/student-portal", destination: "/student", permanent: true },
      { source: "/student-portal/:path*", destination: "/student/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
