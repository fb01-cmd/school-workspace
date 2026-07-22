# Project Notes

## Firebase Configuration
- **Admin/Owner Account**: `fb01@hmh.or.kr`
- **Status**: The Firebase project is currently being created by the teacher. Waiting for the `firebaseConfig` object.

## Architecture Decisions
- **Multi-tenancy**: Simple approach (all users in a single root `users` collection) was chosen. Future schools adopting this system will deploy their own entirely separate Firebase project (Whitelabel approach).
- **Styling**: Tailwind CSS is used for styling.

## 미검증 사항 (Pending Verification)
- *현재 미검증 항목 없음* (모든 주요 인증 가드 및 E2E 기능 검증 완료)

## 검증 완료 사항 (Verified Items)
- **[보안 강화] 수퍼어드민 및 교사 로그인 상태에서 API 가드 동작 검증** (2026-07-22 검증 완료)
  - `verifyAuthAccess` 쿠키 인증 가드가 장착된 4개 API (`/api/workspace/users`, `/api/workspace/groups`, `/api/workspace/ou`, `/api/workspace/lifecycle`) 검증 완료.
  - **수퍼어드민 E2E 검증**: `AuthContext.tsx`에서 로그인 시 `document.cookie`로 `token`을 동기화하여 수퍼어드민 접속 시 어드민 대시보드 내 사용자/그룹/OU/생애주기 생성·수정·삭제·조회가 거부 없이 정상 작동함을 검증.
  - **권한 차단 검증**: 비로그인 요청 시 `401 Unauthorized`, 일반 교사의 수퍼어드민 전용 액션(계정 삭제 등) 요청 시 `403 Forbidden` 반환 확인.
  - **크론 우회 검증**: `/api/workspace/lifecycle/cron`은 `verifyAuthAccess` 대상에서 제외되고 `CRON_SECRET` Bearer 토큰으로 정상 우회 호출됨을 검증 완료.
  - **빌드/타입 검증**: `npx tsc --noEmit` ✅ (0 errors), `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공).
- **학생 계정 생애주기 웹 시트 복사-붙여넣기 및 신입생/진급 에디터** (2026-07-15 검증 완료)
  - 웹 시트 내 엑셀 다중 셀 복사-붙여넣기(`Ctrl+V`), 그리드 자동 확장, 신입생 입학/진급 에디터 동작 검증.
  - 크롬북 및 다른 기기 환경에서 실제 스프레드시트 데이터를 붙여넣었을 때의 브라우저 동작 교차 검증 완료.

## 향후 고려 사항 및 개선 아이디어 (Future Considerations)
- **최초 도입 학교를 위한 3개 학년 초기 세팅 메뉴** (2026-07-12 추가)
  - 현재 효명고등학교 실정(진급 처리 및 신입생 입학 위주)에 맞추어 흐름이 제작되어 있으나, 신설/신규 도입 학교처럼 1, 2, 3학년 전체를 최초로 한 번에 세팅해야 하는 경우를 위한 일괄 초기 세팅 메뉴가 추후 필요함.
  - **참고사항**: 효명고등학교용 플랫폼이 모두 완성된 이후에 이 아이디어를 상기하여 추가 설계 및 작업을 진행할 예정.

---

## 🚀 정식 배포 시 반드시 할 일 (Deployment Checklist)

> **⚠️ 이 섹션은 Vercel 정식 배포 시 빠짐없이 확인해야 합니다.**
> AI 에이전트가 배포 시점에 이 항목들을 꺼내서 안내해 줍니다.
>
> 📌 **상세 체크리스트 전문은 저장소 루트의 [`deployment_checklist.md`](./deployment_checklist.md)에 있습니다.** (2026-07-22에 Git 밖 에이전트 전용 디렉터리에서 저장소로 이관)
> 규칙 본문은 [`AGENTS.md`](./AGENTS.md)의 `deployment-checklist-rules` 섹션을 참고하세요.

### ✅ 주요 필수 체크사항
1. **환경 변수 지정**: `GOOGLE_WORKSPACE_SENDER_EMAIL` (알리미 계정: `hmnotice@hmh.or.kr`) 및 `NEXT_PUBLIC_BASE_URL` (배포 사이트 도메인) 등이 누락 없이 설정되어야 합니다.
2. **서비스 계정 역할**: Firebase Auth UID 정리 동기화를 위해 GCP Console에서 **`Firebase 인증 관리자 (Firebase Authentication Admin)`** 역할이 반드시 부여되어 있어야 합니다.
3. **Vercel 크론 스케줄링**: 배포 후 스케줄러를 위해 `CRON_SECRET`를 등록해야 합니다.

---

## 🔄 에이전트 핸드오버 기록 (Handover Log)

> `AGENTS.md`의 이중 협업 규칙 ④에 따라, 작업을 넘길 때 아래 양식으로 이 섹션 **맨 아래에 추가**한다.
> 양식: 변경 파일 / 검증 상태 / 다음 할 일 / 주의

## [2026-07-22] Claude → Antigravity
- 변경 파일: `AGENTS.md`(단일 원본화), `CLAUDE.md`·`.agents/AGENTS.md`(안내만 남김), `deployment_checklist.md`(신규 이관), `development_roadmap.md`(Phase 5.5 소급), `project_notes.md`(본 섹션 신설)
- 검증 상태: 문서 변경만이라 빌드 영향 없음. 직전 코드 상태는 tsc ✅ / build ✅ / lint ⚠️(에러 408, 기존 부채)
- 다음 할 일:
  1. `project_notes.md` 미검증 항목 — 수퍼어드민 로그인 상태에서 사용자·그룹·OU·생애주기 기능이 API 인증 가드 적용 후에도 정상 동작하는지 **E2E 검증** (Antigravity 담당)
  2. 남은 개발은 Phase 6(동적 폼 빌더)부터
- 주의:
  - 규칙 수정은 이제 **루트 `AGENTS.md`에서만** 한다. `CLAUDE.md`/`.agents/AGENTS.md`에 규칙 본문을 다시 넣지 말 것.
  - 린트 에러 408건 중 `react-hooks` 계열 51건은 실제 렌더링 버그 소지가 있어 별도 점검 필요. `no-explicit-any` 345건은 대량 생산 영역이므로 Antigravity 담당.

## [2026-07-22] Antigravity → Claude
- 변경 파일: `project_notes.md`
- 검증 상태: tsc ✅ / build ✅ / lint ⚠️(기존 부채 408건)
- 다음 할 일: Phase 6 (동적 폼 빌더) 아키텍처/스펙 판단 및 뼈대 설계 요청
- 주의: API 가드(`verifyAuthAccess`) 수퍼어드민 및 크론 우회 동작 E2E 검증 통과 완료.

