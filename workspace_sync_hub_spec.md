# 학교 맞춤형 워크스페이스 연동 웹앱 개발 명세서 (Universal School Sync Hub)

본 문서는 개발자(교사)의 브레인스토밍과 설계 의도를 고스란히 담은 최종 개발 사양서입니다. 에이전트 기반 코딩 AI(Antigravity IDE, Cursor 등)가 학교 환경의 특수성, 기술적 의사결정 맥락을 이해하고 프로젝트를 올바르게 구성할 수 있도록 상세히 서술되었습니다.

---

## 1. 프로젝트 배경 및 문제의식 (Context & Background)

* **OK Goldy의 부재:** 구글 워크스페이스 대량 관리용 시트 애드온인 'OK Goldy'의 업데이트 중단으로 일선 학교 정보부장 교사들의 수동 관리 피로도가 극대화되었습니다.
* **학적 변동의 상시성:** 학교 현장에서는 전입, 전출, 학업 중단 등 학적 변동 이벤트가 학기 중 수시로 발생합니다.
* **데이터 파편화:** 변동이 생길 때마다 구글 어드민 콘솔뿐만 아니라 학교 내부에서 쓰는 무수한 스프레드시트(명렬표, 생활지도 기록표) 및 외부 에듀테크 앱(교육과정 선택 앱, 지필평가 현황판 등)에 명단을 일일이 수동으로 싱크해야 하여 행정 사고의 위험이 큽니다.
* **최종 목표:** 우리 학교 환경에 100% 최적화된 계정 관리 및 데이터 연동 허브 웹앱을 구축하고, 추후 타 학교도 쉽게 가져다 쓸 수 있는 범용(Universal) 아키텍처 설계를 지향합니다.

---

## 2. 기획 패러다임의 진화 맥락 (Design Decisions)

AI 에이전트는 코드를 구현할 때 아래의 세 가지 핵심 아키텍처 결정 맥락을 반드시 준수해야 합니다.

### 2.1. 스프레드시트 애드온에서 '독립형 웹앱(Web App)'으로의 전환
* **이유:** 일반 교사는 로우 데이터(Raw Data) 시트 자체를 만질 필요가 없으며, 정제된 화면 조회나 인쇄 기능만 있으면 충분합니다. 
* **해결하는 페인 포인트:** 매년 학기 초마다 '1학년 1반 시트는 1반 담임만 수정 가능'하도록 시트별 접근 권한을 수동으로 재구성해야 하는 피로를 줄입니다. 또한 시트 구조가 바뀔 때마다 시스템 개발자(교사)가 독박 유지보수하는 문제를 웹앱 UI 상의 동적 폼(Form) 관리로 해결합니다.

### 2.2. 외부 데이터베이스로 'Firebase Firestore' 선정
* **우려했던 사항:** 비용 제로화 및 학교 내부 개인정보 처리 규정 통과를 위해 '특정 구글 계정의 구글 드라이브/시트'를 DB로 쓰는 방안을 검토했습니다.
* **Firestore를 채택한 이유:** 구글 드라이브 파일/시트 API 방식은 여러 교사가 동시에 생활지도 기록 등을 저장할 때 데이터가 덮어씌워지는 **동시성(Concurrency) 결함**, 파일 다운로드/업로드 과정의 **지연 시간(Latency)**, 구글 API **호출 제한(Quota)** 문제가 치명적입니다. 파이어베이스는 구글 생태계 내부 데이터 서비스이므로 학교 보안 심사에 유리하며, 안정적인 동시 처리가 가능하고 소규모 학교 규모에서는 무료 티어로 충분히 커버 가능합니다.

### 2.3. 점진적 범용성(Universal) 확보 전략
* **기본 방향:** 1단계로 우리 학교 전용 시스템으로 빠르게 구축하되, DB 테이블(컬럼) 설계 시 타 학교 도메인 확장을 염두에 둡니다.
* **구현 방향:** 향후 타 학교가 도입할 때, 각 학교의 파이어베이스 API Key와 워크스페이스 서비스 계정 JSON 정보만 웹앱 설정 창에 입력하면 동적으로 도메인이 전환되는 '설정형 화이트라벨 웹앱' 구조를 갖출 수 있도록 코드를 유연하게 작성합니다.

---

## 3. 기술 스택 및 연동 아키텍처 (Technical Stack)

* **Frontend / Backend:** Next.js (App Router 권장)
* **Database:** Firebase / Firestore
* **Authentication:** Google OAuth 2.0 (도메인 `@hmh.or.kr` 제한 및 학생/교사 구분)
* **Google Core API:** Google Workspace Admin SDK (Directory API, Groups API)
* **Server-side Controller:** GCP Service Account (Domain-Wide Delegation 권한 부여 필요)
* **External Sync API:** 타 서비스(Vercel에 배포된 교육과정 선택 웹앱 등)로 학적 변동 사항을 쏴주기 위한 REST API 엔드포인트 또는 Webhook 모듈

---

## 4. 사용자 권한 모델 및 인증 메커니즘 (RBAC)

학교 현장의 명확한 이메일 규칙을 활용하여 보안 사고를 방지하고 어드민 리소스를 최소화하는 인증 로직입니다.

### 4.1. 학생 계정 자동 분류 (Regex 활용)
* **학생 계정 규칙:** `[연도2자리]+[일련번호3자리]@hmh.or.kr` 규격 (예: `25001@hmh.or.kr`, `26123@hmh.or.kr`)
* **백엔드 로직:** 구글 로그인을 완료한 유저의 이메일을 정규표현식 `/^\d{5}@hmh\.or\.kr$/`로 검증합니다.
  * **매칭 성공 (학생):** `role: "student"`로 강제 분류합니다. 교사용 어드민 웹앱 진입을 원천 차단(403 Forbidden)하고, 학생 전용 포털(예: 교육과정 선택 결과 조회 등)로 리다이렉트합니다. 명단 DB에 학생이 선등록되어 있지 않더라도 로그인 시 자동 생성 및 분류되어 기록됩니다.
  * **매칭 실패 (교사):** 일반 교사 가입 절차로 진입합니다.

### 4.2. 교사 권한 라이프사이클 (수퍼어드민 승인 프로세스)
* **최초 가입:** 교사 로그인 시 `role: "teacher"`, `isApproved: false` 상태로 Firestore `users` 컬렉션에 유저 문서가 생성됩니다. 어드민 대시보드 접근 권한이 제한됩니다.
* **권한 신청:** 비승인 교사 화면에 **[수퍼어드민 권한 신청]** 버튼이 활성화되며, 신청 시 DB 상태가 `status: "pending_approval"`로 변경됩니다.
* **승인 프로세스:** 기존 수퍼어드민 권한을 가진 교사의 대시보드에 승인 대기 목록 팝업이 노출됩니다. 수퍼어드민이 승인 버튼을 클릭하면 대상 교사는 즉시 `role: "super_admin"`으로 격상되어 워크스페이스 제어 권한을 획득합니다.

---

## 5. 핵심 구현 기능 스펙 (Functional Requirements)

### 5.1. 구글 워크스페이스 계정 일괄 관리 및 외부 연동
* **전입 (Transfer-In):** 웹앱 대시보드에서 전입생 정보 입력 -> GCP Service Account API 호출을 통해 구글 워크스페이스 도메인에 계정 즉시 생성 -> 해당 학년/반 구글 그룹스(Groups)에 자동 가입 처리 -> 외부 교육용 웹앱에 Webhook 전송하여 해당 서비스의 DB에도 계정 동시 자동 생성.
* **전출 / 학업 중단 (Transfer-Out / Dropout):** 상태를 '전출' 또는 '학업중단'으로 변경 시 -> 워크스페이스 계정 즉시 일시 정지(Suspend) -> 속해 있던 모든 학내 그룹스에서 자동 탈퇴 -> 연동 앱에 '접근 제한' 웹훅 전송.

### 5.2. 교사용 동적 폼 빌더 (Dynamic Form Builder)
* **개념:** 매년 기록 항목이나 시트 구조가 바뀌어 개발자 교사가 코드를 매번 고쳐야 했던 '생활지도 기록표' 등의 문제를 웹앱 내에서 동적으로 해결합니다.
* **작동 방식:** 수퍼어드민은 마스터 폼 빌더 화면에서 입력 필드(날짜, 텍스트 상자, 셀렉트 박스 등)를 동적으로 디자인할 수 있습니다. 생성된 폼 양식은 데이터베이스 스키마와 연결되어 일반 담임 교사들에게 즉시 배포되며, 담임 교사들은 로그인 후 배정받은 학급의 폼을 통해 학생 생활 기록 데이터를 안전하고 간편하게 누적 저장합니다.

---

## 6. AI 에이전트 주입용 프롬프트 (Core Prompts)

AI 에이전트에게 최초 컨텍스트를 주입할 때 아래 프롬프트를 복사하여 채팅창에 입력하십시오.

```text
Please read the attached `workspace_sync_hub_spec.md` first. 

We are starting to build the "Universal School Sync Hub" with Next.js (App Router) and Firebase. 
As the first step, please implement the Google OAuth 2.0 Login system combined with the specified RBAC (Role-Based Access Control) rules:

1. Create a Firebase Authentication & Firestore user schema.
2. When a user logs in via Google OAuth, extract their email.
3. Apply the regex pattern `/^\d{5}@hmh\.or\.kr$/` to the email.
   - If it matches: Assign `role: "student"` inside Firestore, and strictly prevent them from accessing any paths under `/admin`. Redirect them to `/student-portal`.
   - If it doesn't match: Assign `role: "teacher"` and `isApproved: false`.
4. Provide a simple UI where unapproved teachers can click a "Request Admin Access" button, which updates their status in Firestore to `pending_approval`.
5. Ensure that the database structures and folders are logically prepared for future multi-tenant or domain-based expansions.

Provide clean, modular, and well-commented code. Let's start with setting up the project directory and the authentication files.