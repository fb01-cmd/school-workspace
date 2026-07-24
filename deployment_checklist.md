# 🚀 효명고등학교 계정관리 플랫폼 배포 체크리스트 (Deployment Checklist)

이 문서는 개발을 완료하고 실제 상용 서버(Vercel, Staging/Production 등)에 배포할 때, 서비스 정지나 기능 오작동을 방지하기 위해 반드시 점검해야 하는 환경 변수 및 사전 전제 조건들을 정리한 체크리스트입니다.

---

## 1. 🔑 필수 환경 변수 (Environment Variables) 설정

운영 플랫폼(Vercel 대시보드 환경설정 등) 및 배포용 `.env` 파일에 아래 변수들이 누락 없이 기입되어 있는지 확인해 주세요.

### 📡 Google Workspace API & Mail/Chat 연동
구글 Admin Directory API 및 이메일/챗 가장(Impersonate) 연동을 위한 백엔드 설정입니다.

| 환경 변수명 | 권장 설정값 (운영 기준) | 설명 |
| :--- | :--- | :--- |
| **`GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL`** | `school-sync-hub-admin@...iam.gserviceaccount.com` | GCP Console에서 생성한 서비스 계정(Service Account)의 이메일 주소입니다. |
| **`GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY`** | `"-----BEGIN PRIVATE KEY-----\n..."` | 서비스 계정의 비공개 키(Private Key)입니다. 반드시 따옴표(`"`)로 감싸고 줄바꿈을 `\n` 문자로 치환해 입력해야 합니다. |
| **`GOOGLE_WORKSPACE_ADMIN_EMAIL`** | `admin@hmh.or.kr` | 구글 워크스페이스 최고 관리자 이메일입니다. 서비스 계정이 API 권한을 획득하기 위한 가장(Impersonation) 주소로 사용됩니다. |
| **`GOOGLE_WORKSPACE_SENDER_EMAIL`** | `hmnotice@hmh.or.kr` | **[중요]** 시스템 안내/공지 전용 메일 및 구글 챗 DM 발송용 계정입니다. 해당 변수가 없을 경우 `admin@`에서 메일이 발송되어 혼선이 생기므로 **반드시** 설정되어야 합니다. |

---

### 🌐 플랫폼 기본 도메인 설정
사용자에게 발송되는 알림 톡/메일 내부 링크 생성을 위한 설정입니다.

| 환경 변수명 | 권장 설정값 (운영 기준) | 설명 |
| :--- | :--- | :--- |
| **`NEXT_PUBLIC_BASE_URL`** | `https://admin.hmh.or.kr` | **[중요]** 플랫폼의 실제 상용 도메인 주소입니다. 메일이나 챗 안내문에 기재되는 바로가기 링크(예: `/admin/transfer-deadline`)의 호스트명으로 사용됩니다. |

---

### 🔥 Firebase 인증 및 데이터베이스 (Client & Server)
프론트엔드 및 서버리스 API에서 사용되는 Firebase SDK 연동 설정입니다.

| 환경 변수명 | 설명 |
| :--- | :--- |
| **`NEXT_PUBLIC_FIREBASE_API_KEY`** | Firebase Web App API Key |
| **`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`** | Firebase Auth 인증 리다이렉트 도메인 |
| **`NEXT_PUBLIC_FIREBASE_PROJECT_ID`** | Firestore 및 Auth 연동용 Firebase 프로젝트 ID |
| **`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`** | 파일 및 이미지 스토리지 버킷 주소 |
| **`NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`** | 푸시 알림 발송을 위한 송신자 ID |
| **`NEXT_PUBLIC_FIREBASE_APP_ID`** | Firebase App 식별 ID |

---

### ⏰ 크론(Cron) 스케줄링 보안 설정
정기 감사 및 교직원 데이터 기한 선택 유예 자동 처리를 위한 백엔드 크론 보안 토큰입니다.

| 환경 변수명 | 권장 설정값 (운영 기준) | 설명 |
| :--- | :--- | :--- |
| **`CRON_SECRET`** | 임의의 보안 난수 문자열 | `lifecycle/cron/route.ts`에 정의된 정기 배치 작업을 외부 악성 호출로부터 보호하기 위해 Vercel Cron 등 스케줄러 헤더에 탑재될 인증 키입니다. |

---

## 2. 🛡️ 서비스 계정(IAM) 사전 권한 및 API 설정 (GCP/Google Console)

백엔드에서 구글 API를 실행하기 위해, 구글 관리 콘솔 및 GCP 콘솔에서 사전에 작업해야 하는 체크사항입니다.

- [ ] **구글 관리 콘솔 Domain-Wide Delegation (도메인 전체 위임) 등록**
  - 서비스 계정의 고유 **ClientID**가 구글 워크스페이스 관리 콘솔(`보안 > API 제어 > 도메인 전체 위임`)에 등록되어 있어야 합니다.
  - 허용해야 할 OAuth 범위(Scopes):
    - `https://www.googleapis.com/auth/admin.directory.user` (계정 생성/수정/삭제)
    - `https://www.googleapis.com/auth/admin.directory.group` (그룹 가입/탈퇴/조회)
    - `https://www.googleapis.com/auth/gmail.send` (알림 메일 대리 발송)
    - `https://www.googleapis.com/auth/chat.spaces` 및 `https://www.googleapis.com/auth/chat.messages.create` (구글 챗 메시지 전송)
- [ ] **Firebase Authentication Admin API 권한 부여**
  - **[규칙 확인]** 서비스 계정이 파이어베이스 인증 DB 내의 구버전 UID 충돌을 자동 해결(`deleteAuthUserByEmail`)할 수 있도록, GCP IAM 관리 화면 또는 Firebase Console을 통해 **`Firebase 인증 관리자 (Firebase Authentication Admin)`** 역할(Role)이 반드시 이 계정에 부여되어 있어야 합니다.
- [x] **Cloud Datastore 사용자(Cloud Datastore User) 역할 부여** *(2026-07-24 admin SDK 전환으로 신규 필수, 효명고 프로젝트에는 부여 완료)*
  - 서버 API와 크론이 Firestore를 **admin SDK**로 접근하므로, 서비스 계정에 GCP IAM에서 **`Cloud Datastore 사용자`** 역할이 반드시 있어야 합니다. 없으면 로그인 포함 **DB를 쓰는 모든 기능이 `PERMISSION_DENIED`로 죽습니다** (실제 발생했던 장애 — 인증 관리자 역할만으로는 부족).
  - 화이트라벨로 다른 학교에 세울 때 반드시 걸리는 지점이므로 초기 세팅 시 함께 부여할 것.
- [ ] **보안 그룹(Security Group) 활성화 여부 확인**
  - 환경설정에서 지정해 둔 그룹 중 `ts@`, `tc@` 도메인을 가진 그룹이나 이름/설명에 "보안그룹" 텍스트를 포함하고 있는 그룹들이 실제 구글 워크스페이스 상에서 정상적으로 조회되는지 확인합니다.

---

## 2.5 🌐 커스텀 도메인(예: admin.hmh.or.kr) 붙이는 날 할 일 세트

> 2026-07-24 첫 배포에서 확정된 절차. **도메인이 바뀌면 아래 5개를 전부 반복해야 로그인이 작동한다.**
> (인증 핸들러가 same-origin 프록시 방식이라 도메인마다 구글 쪽 등록이 필요함)

1. **Vercel**: 프로젝트 Settings → Domains → 새 도메인 추가 → 안내되는 DNS 레코드(CNAME)를 `hmh.or.kr` DNS 관리 화면에 추가
2. **Firebase 콘솔**: Authentication → Settings → 승인된 도메인 → 새 도메인 추가
3. **GCP 콘솔**: API 및 서비스 → 사용자 인증 정보 → Web client (auto created by Google Service):
   - 승인된 자바스크립트 원본에 `https://<새 도메인>` 추가
   - 승인된 리디렉션 URI에 `https://<새 도메인>/__/auth/handler` 추가
4. **Vercel 환경변수**: `NEXT_PUBLIC_BASE_URL`을 새 도메인으로 수정 → Redeploy
5. **검증**: 새 도메인에서 팝업 차단 상태로 로그인 되는지 확인 (redirect 폴백 경로)

---

## 3. 🧪 배포 전 최종 검증 시나리오 (Vercel 배포 후)

상용 배포 직후 아래 시나리오들을 순서대로 수동 작동하여 오작동 여부를 검사하는 것을 강력히 권장합니다.

1. **교사 전출 등록 및 링크 테스트**
   - 테스트용 교사를 전출 등록 처리합니다.
   - 수신된 메일 및 챗 알림이 `hmnotice@hmh.or.kr` 로부터 발송되는지 확인합니다.
   - 메일 하단 링크의 호스트가 배포된 도메인(`NEXT_PUBLIC_BASE_URL`)과 일치하는지 확인합니다.
   - 링크 뒤에 `)에` 등의 괄호나 한글 기호가 딸려 들어가서 클릭 시 에러가 나지 않는지, 순수 URL만 클릭이 되는지 수신함에서 직접 터치/클릭하여 체크합니다.
2. **전출 취소 롤백 테스트**
   - 전출 대기 큐에 들어간 교사에 대해 **[전출 취소]** 버튼을 클릭합니다.
   - 큐에서 정상적으로 사라지는지 확인합니다.
   - 구글 관리자 콘솔에서 해당 교사가 원래 가입되어 있던 연동 그룹(클래스룸 교사 그룹 등)에 다시 정확히 가입되었는지 멤버 조회를 수행합니다.
