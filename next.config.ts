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
