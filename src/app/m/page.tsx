import { redirect } from "next/navigation";

// 2026-08-21 /m 폐지 — 반응형 단일화. 경로 자체는 지우지 않는다:
// 폰 북마크·설치 앱 홈 화면 아이콘이 /m을 가리키고 있을 수 있어 404가 나면 그 진입로가 죽는다.
// 학생 계정은 /teacher의 RouteGuard가 /student로 다시 넘긴다.
export default function MobileRedirect(): never {
  redirect("/teacher");
}
