<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:local-dev-server-rules -->
# 로컬 개발 서버 시작 규칙

사용자가 로컬 서버를 켜달라고 하면:
1. `npm run dev`를 백그라운드 태스크로 실행한다.
2. **그 즉시 멈춘다.** `manage_task status`나 `view_file`로 로그를 반복 확인(폴링)하는 행동을 절대 하지 않는다.
3. 사용자에게 "서버가 시작됩니다. 기본 주소는 `http://localhost:3000` 입니다." 라고 안내하고 다음 지시를 기다린다.

**금지 행동**: 서버 로그 파일을 여러 번 읽거나, `status`를 반복 호출하여 무한 루프에 빠지는 것. 이 문제가 3번 반복되었으므로 반드시 준수할 것.
<!-- END:local-dev-server-rules -->

<!-- BEGIN:notification-sender-rules -->
# 이메일 및 구글 챗 발신자 규칙

이 프로젝트에서 학생 또는 교직원에게 이메일(Gmail API)이나 구글 챗 DM을 발송할 때:

1. **발신자는 반드시 `hmnotice@hmh.or.kr`로 통일한다.**
   - 환경변수: `process.env.GOOGLE_WORKSPACE_SENDER_EMAIL`
   - 이 계정은 안내/공지 전용 계정이다. `admin@hmh.or.kr`(GOOGLE_WORKSPACE_ADMIN_EMAIL)을 발신자로 절대 사용하지 않는다.

2. **발신자 변수 작성 패턴 (반드시 이 순서로 fallback):**
   ```typescript
   const mailSender = process.env.GOOGLE_WORKSPACE_SENDER_EMAIL
     || process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL
     || "hmnotice@hmh.or.kr";
   ```

3. **구글 챗은 `workspace.ts`의 `getChatClient()`가 이미 `SENDER_EMAIL`로 사칭(impersonate)하도록 설정되어 있으므로 별도 수정 불필요.**
   - `sendGoogleChat(studentEmail, message)` 함수를 그대로 호출하면 된다.

4. **이 규칙을 어기면 `admin@hmh.or.kr`에서 메일이 나가 학생들이 혼란스러워하므로 반드시 준수할 것.**
<!-- END:notification-sender-rules -->

<!-- BEGIN:gws-firebase-uid-sync-rules -->
# Google Workspace & Firebase Auth 고유 ID(UID) 동기화 및 권한 규칙

구글 워크스페이스(GWS) 계정과 파이어베이스 인증(Firebase Auth)을 함께 사용하는 이 프로젝트에서 학적 변동(전입, 전출, 삭제, 입학) 처리 시 아래 수명 주기를 엄격히 준수한다:

1. **GWS UID 충돌 방지**: 
   동일한 이메일로 구글 계정을 삭제 후 재생성할 때, 구글 내부 고유 ID(UID)가 변경되어 파이어베이스 로그인 시 `auth/provider-already-linked` 에러가 발생한다.
   - 계정 **삭제(개별/일괄/크론/전출)** 시: Google Workspace 계정을 삭제하기 전에 반드시 `deleteAuthUserByEmail(email)`을 호출하여 Firebase Auth의 인증 레코드도 동기화하여 삭제한다.
   - 계정 **생성(개별/전입/입학)** 시: Google Workspace 계정을 생성하기 전에 반드시 `deleteAuthUserByEmail(email)`을 먼저 실행하여 혹시 남아있을지 모르는 파이어베이스 구버전 UID 레코드를 깨끗이 정리(Clean)한다.

2. **서비스 계정 역할(IAM) 전제 조건**:
   이 자동 삭제 메커니즘(`deleteAuthUserByEmail`)이 정상 작동하려면, 백엔드 서버에서 실행되는 GCP 서비스 계정(`GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL`)에 GCP Console 또는 Firebase Console을 통해 **`Firebase 인증 관리자 (Firebase Authentication Admin)`** 역할이 반드시 부여되어 있어야 한다. 만약 이 권한이 누락되면 권한 오류로 자동 정리가 실패하여 로그인 꼬임이 발생한다.
<!-- END:gws-firebase-uid-sync-rules -->
