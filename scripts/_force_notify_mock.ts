// 실서버 리허설 공용 가드: 구글 챗/메일 실발송 차단.
// workspace.ts의 isMock은 모듈 로드 시 평가되므로, 이 모듈을 리허설 스크립트의
// "가장 첫 번째 import"로 두어야 한다 (server.ts보다 먼저 평가되도록).
// ADMIN_EMAIL만 제거하면 Firestore admin(서비스 계정 키 사용)은 정상 동작하면서
// hasCredentials가 false가 되어 알림 전부가 [Chat MOCK]/[Gmail MOCK] 로그로 대체된다.
delete process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;
console.log("[force_notify_mock] GOOGLE_WORKSPACE_ADMIN_EMAIL 제거 — 알림 MOCK 강제 (실교사 DM 차단)");

export {};
