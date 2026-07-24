# 운영·인수인계 핸드북 (Operations Handbook)

> 2026-07-24 Claude가 골격 작성, Antigravity가 세부 [TODO] 구현 완비.
> 이 문서의 독자는 **이 시스템을 만든 사람이 없어도 학교가 운영을 이어가야 하는 상황의 후임 담당자(비개발자 가능)** 다.
> 전문용어보다 "무엇을 눌러야 하는지"를 우선한다.
>
> ⚠️ **보안 주의**: 비밀값(키·시크릿)은 절대로 이 문서에 직접 기록하지 않으며, "어디에 있는지"와 "무슨 용도인지"만 기재합니다.

## 1. 시스템 한눈에 보기

- **웹사이트**: Vercel에서 호스팅되는 Next.js 앱. 주소: [https://school-workspace-eight.vercel.app](https://school-workspace-eight.vercel.app)
- **데이터베이스**: Firebase Firestore (프로젝트: `school-sync-hub`)
- **로그인**: Firebase Auth — `@hmh.or.kr` 구글 계정만 허용
- **실제 데이터 원본**: Google Workspace (계정·클래스룸·캘린더·드라이브)
- **소스 코드**: GitHub `fb01-cmd/school-workspace` (main 브랜치 push 시 Vercel 자동 배포)

## 2. 핵심 계정과 열쇠 (값이 아니라 위치)

| 무엇 | 어디에 | 용도 |
|---|---|---|
| 관리자 계정 | `fb01@hmh.or.kr` (Workspace 최고관리자) | 콘솔 접근, 시스템 소유 |
| 알림 발신 계정 | `hmnotice@hmh.or.kr` | 학생·교사 안내 메일 및 구글 챗 발신자 |
| GCP 서비스 계정 | `school-sync-hub-admin@school-sync-hub.iam.gserviceaccount.com` (GCP IAM) | 서버가 Workspace API를 호출하는 백엔드 신원 (도메인 전체 위임 적용) |
| 환경변수 (비밀값 묶음) | 로컬 `.env.local` / Vercel 프로젝트 [Settings] → [Environment Variables] | 아래 §3 목록 참조 |
| Firebase 콘솔 | console.firebase.google.com → `school-sync-hub` | DB·인증·보안 규칙 관리 |
| GCP 콘솔 | console.cloud.google.com → `school-sync-hub` | 서비스 계정, API 활성화, 결제 및 할당량 관리 |

## 3. 환경변수 목록 (이름과 용도만)

| 환경변수 이름 | 구분 / 노출 범위 | 주요 용도 |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | 클라이언트 (공개) | Firebase 웹 SDK 인증 및 Firestore 연결 API 키 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 클라이언트 (공개) | Firebase Auth 인증 도메인 (`school-sync-hub.firebaseapp.com`). **단, 배포 환경에서는 코드(config.ts)가 이 값을 무시하고 접속 도메인 자신을 사용** — 로그인 리디렉션 유실 방지용 same-origin 프록시 구조(`next.config.ts`의 `/__/auth` rewrite)와 세트 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 클라이언트 (공개) | Firebase 프로젝트 ID (`school-sync-hub`) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | 클라이언트 (공개) | Firebase Storage 버킷 URL |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | 클라이언트 (공개) | Firebase Cloud Messaging 발신자 ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | 클라이언트 (공개) | Firebase 웹 앱 식별 ID |
| `NEXT_PUBLIC_BASE_URL` | 클라이언트/서버 | 서비스의 기본 프로덕션 주소 (`https://school-workspace-eight.vercel.app`) |
| `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL` | 서버 (비밀) | GCP 서비스 계정 이메일 |
| `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY` | 서버 (비밀) | GCP 서비스 계정의 RSA 개인키 (`\n` 줄바꿈 포함 문자열) |
| `GOOGLE_WORKSPACE_ADMIN_EMAIL` | 서버 (비밀) | Google Workspace 최고관리자 계정 (`admin@hmh.or.kr`) |
| `GOOGLE_WORKSPACE_SENDER_EMAIL` | 서버 (비밀) | 메일 및 구글 챗 공지 전용 발신 계정 (`hmnotice@hmh.or.kr`) |
| `CRON_SECRET` | 서버 (비밀) | Vercel Cron API 자동 호출 시 외부 무단 호출을 막기 위한 인증 시크릿 |

## 4. 매일 자동으로 일어나는 일 (크론)

매일 **자정(KST)** Vercel 크론이 `/api/workspace/lifecycle/cron`을 호출해서:

1. **전출·자퇴 학생**: 정지 예정일 지난 계정 일시정지 → 삭제 예정일 지난 계정 영구삭제
2. **졸업생** (12월~6월에만): 3학년/졸업생 명단 동기화, 미서명자 안내 발송(졸업생 매일, 재학생 월요일), 정지일·삭제일 도래 시 집행
3. **전출 교사**: 백업 기한 미설정자 주간 독촉, 기한 경과 시 정지, 정지 30일 후 영구삭제

모든 집행 결과는 어드민 화면의 **작업 감사 로그**에 남는다.
⚠️ 크론은 `CRON_SECRET`이 Vercel에 등록돼 있어야 작동하며, 미설정 시 실행을 거부한다(안전장치).

## 5. 문제가 생겼을 때 보는 곳 (순서대로)

1. **어드민 → 작업 감사 로그**: 최근에 무슨 자동/수동 작업이 실행됐는지 확인
2. **Vercel 대시보드 → 프로젝트 → Logs**: 서버 API 에러 및 크론 실행 로그 확인
3. **Firebase 콘솔 → Firestore**: 데이터(사용자 role, 태스크 상태 등)의 실제 값 확인
4. **Google 관리 콘솔** (`admin.google.com`): 계정·클래스룸·그룹의 실제 상태 확인

### 대표 장애 시나리오별 대응 절차

1. **"로그인이 안 되거나 화면이 튕겨요" (auth/popup-blocked 또는 redirect 오류)**
   - **원인**: 브라우저 팝업 차단 또는 OAuth 승인 도메인 누락.
   - **대응**:
     1. 브라우저의 팝업 차단을 해제하거나 리디렉션 로그인(`signInWithRedirect`)으로 자동 전환되도록 사용 안내.
     2. Google Cloud Console (`console.cloud.google.com`) → [API 및 서비스] → [사용자 인증 정보]에서 OAuth 2.0 클라이언트 ID의 '승인된 JavaScript 원본' 및 '승인된 리디렉션 URI'에 배포 주소(`https://school-workspace-eight.vercel.app` 및 `https://school-workspace-eight.vercel.app/__/auth/handler`)가 포함되어 있는지 확인.

2. **"크론(매일 자정 자동 처리)이 안 돌았거나 실행 오류가 나요"**
   - **원인**: Vercel 환경변수에 `CRON_SECRET` 누락 또는 GCP API 한도 초과/권한 이슈.
   - **대응**:
     1. Vercel 대시보드 → [Settings] → [Environment Variables]에 `CRON_SECRET`이 정확히 설정되어 있는지 확인 (미설정 시 503 HTTP 에러로 닫힘).
     2. Vercel 대시보드 → [Logs] 메뉴에서 `/api/workspace/lifecycle/cron`의 00시 실행 기록과 상세 오류 로그 확인.

3. **"계정이 실수로 정지/삭제되었거나 전출 취소가 필요해요"**
   - **원인**: 유예기간 만료 또는 크론 자동 집행.
   - **대응**:
     1. 관리자 대시보드 → **[계정 생애주기 관리]** 메뉴 접속.
     2. **졸업생 관리** 탭 또는 **교사 전출 관리** 탭에서 대상 계정을 찾은 뒤 **[복원 / 정지 해제]** 또는 **[전출 취소]** 버튼 클릭.
     3. 구글 워크스페이스 상에서 정지가 즉시 해제되고 지정된 연동 그룹에 자동 재가입 처리됨.

4. **"API 호출 시 403 Forbidden / API Not Enabled 에러가 떠요"**
   - **원인**: GCP API 미활성화 또는 Domain-Wide Delegation Scope 누락.
   - **대응**:
     1. GCP Console (`console.cloud.google.com`)에서 해당 API(예: Google Calendar API, Google Drive API, Google Classroom API)가 **[사용(ENABLE)]** 상태인지 확인.
     2. Google Workspace Admin Console (`admin.google.com`) → [보안] → [API 제어] → [도메인 전체 위임]에 서비스 계정 이메일과 해당 OAuth Scope URL이 등록되어 있는지 확인.

## 6. 정기 운영 캘린더

| 시기 | 할 일 |
|---|---|
| 2월 | 학기말 클래스룸 정리 시즌 — 교사 알림 배너 자동 노출, 교사 셀프 정리 |
| 12월~6월 | 졸업생 계정 생애주기 시즌 (크론 자동, §4 참조) |
| 3월 | 신입생 입학 처리, 진급 처리 (생애주기 메뉴) |
| 수시 | 전출·자퇴·전입 처리 |
| 연 1회 | **서비스 계정 키 로테이션**: GCP Console → IAM 및 관리자 → 서비스 계정에서 새 JSON 키 발급 → Vercel 및 `.env.local`의 `GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY` 환경변수 갱신 후 재배포 (구 키는 만료 삭제) |

## 7. 후임자 인수인계 체크리스트

- [ ] Workspace 최고관리자 권한 이양 (또는 공동 관리자 추가)
- [ ] GitHub 저장소 소유권/협업자 이전
- [ ] Vercel·Firebase·GCP 프로젝트 멤버 추가
- [ ] `.env.local` 비밀값 안전한 방법으로 전달 (문서·메일 금지)
- [ ] 이 핸드북 + `product_overview.md` + `deployment_checklist.md` 함께 읽기
- [ ] AI 에이전트 협업 방식은 `AGENTS.md` 참조 (후임자가 원할 경우)

