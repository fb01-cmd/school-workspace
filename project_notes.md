# Project Notes

## Firebase Configuration
- **Admin/Owner Account**: `fb01@hmh.or.kr`
- **Status**: The Firebase project is currently being created by the teacher. Waiting for the `firebaseConfig` object.

## Architecture Decisions
- **Multi-tenancy**: Simple approach (all users in a single root `users` collection) was chosen. Future schools adopting this system will deploy their own entirely separate Firebase project (Whitelabel approach).
- **Styling**: Tailwind CSS is used for styling.

## 미검증 사항 (Pending Verification)
- **학적 관리 웹 시트 복사-붙여넣기 및 신입생/진급 에디터** (2026-07-12 추가)
  - 웹 시트 내 엑셀 다중 셀 복사-붙여넣기(`Ctrl+V`), 그리드 자동 확장, 신입생 입학/진급 에디터 구현 완료 (빌드 검증 완료).
  - 다른 기기(예: 크롬북 등)로 이전하여 실제 스프레드시트 데이터 붙여넣기 및 브라우저 동작 교차 검증 필요.

