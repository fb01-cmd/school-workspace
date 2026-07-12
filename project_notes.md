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

## 향후 고려 사항 및 개선 아이디어 (Future Considerations)
- **최초 도입 학교를 위한 3개 학년 초기 세팅 메뉴** (2026-07-12 추가)
  - 현재 효명고등학교 실정(진급 처리 및 신입생 입학 위주)에 맞추어 흐름이 제작되어 있으나, 신설/신규 도입 학교처럼 1, 2, 3학년 전체를 최초로 한 번에 세팅해야 하는 경우를 위한 일괄 초기 세팅 메뉴가 추후 필요함.
  - **참고사항**: 효명고등학교용 플랫폼이 모두 완성된 이후에 이 아이디어를 상기하여 추가 설계 및 작업을 진행할 예정.

---

## 🚀 정식 배포 시 반드시 할 일 (Deployment Checklist)

> **⚠️ 이 섹션은 Vercel 정식 배포 시 빠짐없이 확인해야 합니다.**
> AI 에이전트가 배포 시점에 이 항목들을 꺼내서 안내해 줍니다.

### ✅ 환경변수 설정 (Vercel 대시보드 → Project Settings → Environment Variables)

| 변수명 | 설명 |
|--------|------|
| `CRON_SECRET` | `.env.local`의 값과 동일하게 등록. 없으면 계정 자동 정지/삭제 크론 API가 보안 없이 외부에 노출됨. |
| `NEXT_PUBLIC_FIREBASE_*` | Firebase 연결 설정. 로컬 `.env.local`에 있는 값들을 그대로 등록. |
| `GOOGLE_WORKSPACE_*` | Google Workspace 서비스 계정 키. 로컬 `.env.local`에 있는 값들을 그대로 등록. |

### ✅ Vercel 크론 자동화 확인 사항

- 배포 후 Vercel 대시보드 → **Cron Jobs** 탭에서 `/api/workspace/lifecycle/cron`이 등록되었는지 확인
- 스케줄: `"0 15 * * *"` (UTC 기준) = **KST 매일 0시** 자동 실행
- Vercel 무료 플랜(Hobby)은 크론 1개까지 무료. Pro 이상은 제한 없음.

### ✅ 배포 후 기타 확인 사항

- Firebase 보안 규칙(Firestore Security Rules)이 프로덕션 환경에 맞게 설정되었는지 확인
- Google Workspace 서비스 계정의 도메인 위임(Domain-wide delegation) 권한 정상 여부 확인
- 배포 직후 `/admin` 페이지에서 수퍼어드민 계정(`fb01@hmh.or.kr`)으로 로그인 테스트
