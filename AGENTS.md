<!-- BEGIN:single-source-notice -->
# ⚠️ 이 파일이 프로젝트 규칙의 단일 원본이다

Antigravity·Claude 두 에이전트가 따르는 모든 공통 규칙은 **이 파일에만** 기록한다.
`CLAUDE.md`와 `.agents/AGENTS.md`에는 이 파일을 가리키는 안내만 둔다.
규칙을 바꿀 때는 반드시 이 파일을 수정한다. (합의: 2026-07-22)
<!-- END:single-source-notice -->

<!-- BEGIN:project-overview -->
# 프로젝트 개요

- **스택**: Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Firebase (Auth, Firestore) + Google Workspace Admin SDK
- **용도**: 학교 학적관리, Google Workspace 계정 생애주기, 구글 클래스룸 배정, 크롬 북마크 관리
- **배포**: Vercel
- **주요 디렉터리**:
  - `src/app/` — Next.js App Router 페이지 및 API 라우트
  - `src/components/admin/` — 관리자 대시보드 컴포넌트 (lifecycle 하위 디렉터리 포함)
  - `src/context/AuthContext.tsx` — 인증 및 백그라운드 프리페치 데이터 관리
  - `src/lib/google/workspace.ts` — Google Workspace Admin SDK 헬퍼 함수
  - `src/lib/firebase/` — Firebase Admin 및 클라이언트 설정
  - `src/lib/cache/clientCache.ts` — 브라우저 인메모리 캐시 (TTL 5분)
<!-- END:project-overview -->

<!-- BEGIN:session-start-rules -->
# 세션 시작 시 필수 읽기

새 세션을 시작할 때 반드시 아래 파일을 읽고 현재 개발 맥락을 파악한다:
1. `development_roadmap.md` — 전체 개발 로드맵, 완료/미완료 Phase, 아이디어 목록
2. `project_notes.md` — 미검증 사항, 아키텍처 결정 기록, 핸드오버 누적 기록

> **비용 주의**: Claude가 이 파일들을 직접 훑는 것도 토큰 비용이다. Antigravity가 이미 맥락을 파악하고 있다면 컨텍스트 팩(협업 규칙 ⑦)으로 요약해 넘기는 편이 낫다.
<!-- END:session-start-rules -->

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

<!-- BEGIN:git-based-roadmap-rules -->
# 개발 로드맵 및 기획 문서 Git 연동 의존 규칙

이 프로젝트에서 개발 관련 기획 문서, 진행 상태 보고서(Status Report), 구현 계획서(Implementation Plan), 할 일 목록(Task) 등을 에이전트가 작성할 때 다음 규칙을 따른다:

1. 에이전트 전용 격리 공간(예: C:\Users\...\.gemini\antigravity-ide\brain)에만 마크다운 문서를 작성하여 격리시키지 않는다.
2. 모든 기획, 계획, 진행 현황 문서는 프로젝트 루트에 파일(예: development_roadmap.md)로 작성하고 Git 추적 대상에 포함되게 한다. 이를 통해 기기 전환이나 대화 세션 만료 시에도 기획 맥락이 끊기지 않도록 방지한다.
<!-- END:git-based-roadmap-rules -->

<!-- BEGIN:dual-agent-collaboration-rules -->
# Antigravity & Claude 이중 협업 및 분업 규칙

> **개정 2026-07-22** — Claude 제안 + Antigravity 회신 합의로 전면 개편.
> 협의 전문은 `collaboration_proposal.md` 참조. 이전 기준("일의 크기"로 분담)은 폐기됨.

## 0. 대전제 — 두 에이전트의 비용이 다르다

| | Claude | Antigravity |
|---|---|---|
| 비용 | **비쌈** — 사용량 한도가 5일 주기로 리셋 | 저렴, 사실상 대량 사용 가능 |
| 한도 소진 시 | **고급 판단 에이전트가 며칠간 사라짐** | 영향 적음 |

Claude의 토큰은 **회복에 며칠이 걸리는 소모성 자원**이다. 분업의 목표는 "공평한 배분"이 아니라 **"비싼 자원을 그것이 아니면 안 되는 곳에만 쓰기"** 이다.

## 1. 분담 기준 — 판단(judgment) vs 생산(production)

일의 크기가 아니라 **"틀렸을 때 대가가 큰가"** 로 나눈다.

- **Claude = 판단** — 결정·스펙·리뷰. 출력이 짧고, 틀리면 손해가 크다.
- **Antigravity = 생산** — 코드·문서·탐색. 출력이 길고, 틀려도 다시 만들면 된다.

| 영역 | 담당 |
|---|---|
| 되돌릴 수 없는 작업 설계 (계정 삭제·복원, 데이터 마이그레이션, 배포) | **Claude** |
| 보안·개인정보 결정 (Firestore 규칙, 인증 가드) | **Claude** |
| 두 번 이상 실패한 버그의 근본 원인 진단 | **Claude** |
| 아키텍처 갈림길 결정, 스펙 작성 | **Claude** |
| 위험 지점 표적 코드 리뷰 (전수 아님) | **Claude** |
| 컴포넌트 구현, UI, 레이아웃, UX 문구 | **Antigravity** |
| 반복 수정, 대량 파일 편집, 타입 부채 정리 | **Antigravity** |
| 저장소 탐색·검색·요약 | **Antigravity** |
| E2E 화면 검증 | **Antigravity** |
| 문서 초안 살 붙이기 (Claude는 뼈대만) | **Antigravity** |

**Claude는 무엇을 어떻게 만들지 정하고, Antigravity가 만든다.**

## 2. 운영 규칙 7가지

### ① 완료 정의(DoD) — 넘기기 전에 스스로 통과시킨다
상대에게 넘기기 전 **작성자 본인이** `npx tsc --noEmit`과 `npm run build`를 통과시킨다. 빌드 에러를 Claude에게 고치게 하는 것은 가장 비싼 자원을 가장 기계적인 일에 쓰는 낭비다.

### ② 자기 작업은 자기가 커밋한다
커밋 독점을 폐지한다. 작성자가 자기 변경을 커밋한다. Claude는 대신 **커밋 규칙**(메시지 형식, 작업 트리 청결)을 관리한다.

### ③ 작성자는 자기 작업의 최종 승인자가 아니다 (교차 검증)
- Claude가 정한 스펙/백엔드 판단 → Antigravity가 화면에서 확인
- Antigravity가 쓴 코드 → Claude가 위험 지점 표적 리뷰

### ④ 핸드오버는 고정 양식으로 남긴다
`project_notes.md` 하단에 누적한다.

```markdown
## [2026-07-22] Antigravity → Claude
- 변경 파일: src/components/admin/UserList.tsx
- 검증 상태: tsc ✅ / build ✅ / lint ⚠️(기존 부채 12건)
- 다음 할 일: 삭제 복원 로직의 권한 검사 스펙 판단 요청
- 주의: users:all 캐시 무효화 시점이 바뀌었음
```

### ⑤ 규칙은 단일 원본을 둔다
**이 파일(`AGENTS.md`)이 단일 원본(Single Source of Truth)이다.** `CLAUDE.md`와 `.agents/AGENTS.md`에는 이 파일을 가리키는 안내만 둔다. 규칙 변경은 반드시 이 파일에서 한다.

### ⑥ Claude를 부르는 기준 (에스컬레이션)

**부른다**
- 되돌릴 수 없는 작업: 계정 삭제·복원, 데이터 마이그레이션, 배포 직전 점검
- 보안·개인정보 결정
- 같은 버그를 두 번 고쳐도 재발할 때
- 아키텍처 갈림길에서 방향이 갈릴 때

**부르지 않는다** (Antigravity가 끝낸다)
- 보일러플레이트, UI 조정, 문구 수정
- 빌드/타입 에러 중 원인이 명확한 것
- 단순 반복 수정, 파일 탐색

**안전장치 (Antigravity 제안, 합의됨)**: 단순 오류로 판단해 수정을 시작했더라도 **2회 시도 내에 해결되지 않거나 원인이 아키텍처/스펙 문제로 확장되면 즉시 손을 떼고 Claude에게 에스컬레이션한다.** 막힌 채 혼자 오래 붙잡는 것이 Claude를 부르는 것보다 비싸다.

### ⑦ Claude에게는 "컨텍스트 팩"을 만들어 넘긴다
Claude는 출력뿐 아니라 **파일을 읽는 입력에도 비용이 든다.** 저장소를 직접 훑게 하면 판단 전에 한도가 깎인다. Antigravity가 아래 4줄로 미리 요약해 넘긴다.

```markdown
## Claude 요청: (한 줄 제목)
- 관련 파일: 경로 + 줄 범위
- 증상: 무엇이 잘못되는가
- 이미 시도: 무엇을 해봤고 왜 실패했는가
- 묻고 싶은 것: 판단이 필요한 지점
```

## 3. 동시 작업 충돌 방지

1. **동시에 같은 파일을 편집하지 않는다.** 작업 시작 시 핸드오버 기록에 "작업 중" 파일을 명시한다.
2. **상대 영역 파일을 고쳐야 하면, 고치기 전에 핸드오버 기록에 이유를 남긴다.**
3. **작업 시작 전 `git status`로 상대의 미커밋 변경이 있는지 확인한다.** 있으면 먼저 정리하거나 사용자에게 묻는다.

## 4. 엔진(모델) 선택 규칙

### 대원칙 — 자기 드롭다운은 자기만 안다

**각 에이전트는 자신의 모델만 추천한다.** 상대 에이전트의 드롭다운에 무엇이 있는지는 볼 수 없으므로, 상대에게 넘길 때는 **"어느 에이전트에게 넘기는가"까지만** 지정하고 **구체적 모델명은 받는 쪽이 정한다.**

> **왜 이 규칙이 생겼나 (2026-07-22)**: 이 규칙의 초판에는 `Claude Sonnet 4.6` / `Claude Opus 4.6` 이라는 **실재하지 않는 모델명**이 적혀 있었다. 상대 라인업을 추측해서 쓴 결과였다. **모델명은 반드시 실제 드롭다운에서 확인한 것만 쓰고, 절대 추측하지 않는다.**

### 추천 시점 — 넘길 때가 먼저다

| 시점 | 누가 | 무엇을 |
|---|---|---|
| **① 작업을 넘길 때 (주된 절약)** | 넘기는 쪽 | "다음은 ○○ 에이전트" — 에이전트만 지정 |
| **② 작업을 받았을 때 (보조)** | 받는 쪽 | 현재 모델이 **명백히 과하거나 모자랄 때만** 한 줄 안내 |

②를 **매번 출력하지 않는다.** 이미 그 모델로 대화가 시작된 뒤라 브리핑 자체가 비용이며, 특히 비싼 모델이 "저는 과합니다"라고 말하는 순간 아끼려던 토큰은 이미 쓰인 뒤다. 불일치가 클 때만, 한 줄로, 다음 대화부터 바꾸도록 안내한다.

### Claude 측 모델 선택 (Claude 자신이 판단)

**실제 드롭다운 확인 결과 (2026-07-22)**: `Fable 5` / `Opus 4.8` / `Sonnet 5` / `Haiku 4.5` (그 외 "더 많은 모델" 하위 메뉴 존재)

| 작업 성격 | 선택 |
|---|---|
| 되돌릴 수 없는 작업(계정 삭제·복원, 데이터 마이그레이션), 보안·개인정보 결정, 배포 직전 점검 | `Fable 5` 또는 `Opus 4.8` — 최상위 |
| 아키텍처 결정, 스펙 작성, 2회 실패 버그의 근본 원인 진단 | `Opus 4.8` |
| 일반 코드 리뷰, 위험 지점 표적 리뷰, 문서·규칙 정리 | `Sonnet 5` |
| 단순 확인, 커밋 정리, 짧은 질의응답, 상태 조회 | `Haiku 4.5` |

기본값은 `Opus 4.8`로 두되, **판단이 필요 없는 기계적 작업이 예상되면 시작 전에 `Sonnet 5`나 `Haiku 4.5`로 낮춘다.** 대화가 시작된 뒤에 낮추면 이미 쓴 토큰은 돌아오지 않는다.

> **빠른 모드**: 모델을 낮추는 기능이 아니라 같은 모델의 출력 속도를 올리는 옵션이다. **토큰 절약 수단이 아니므로 비용 판단과 혼동하지 않는다.**
>
> Claude 계열은 버전이 자주 바뀐다. 이 표가 실제 드롭다운과 다르면 **드롭다운을 따르고 이 표를 갱신한다.**

### Antigravity 측 모델 선택 (Antigravity 자신이 판단)

| 작업 성격 | 선택 |
|---|---|
| 단순 오탈자, 린트 수정, 보일러플레이트 | 최경량·저추론 |
| 일반 코드 생산, UI 구현, E2E 검증, DoD 빌드 체크 | 중간 등급 (기본값) |
| 대규모 파일 탐색, 타입 부채 전면 개편 | 상위 등급 |

> 구체적 모델명은 **Antigravity가 자기 드롭다운에서 확인해 채운다.** Claude는 이 목록을 검증할 수 없으므로 임의로 수정하지 않는다.

### 넘길 때 양식 (모델명 없이 에이전트만 지정)

```markdown
💡 **다음 작업 지시 가이드**
- **대상 에이전트**: Claude
- **복사용 프롬프트**: *"Claude, 방금 구현한 기능의 위험 지점을 표적 리뷰해줘."*
- *(어떤 모델로 돌릴지는 Claude가 받아서 판단합니다)*
```
<!-- END:dual-agent-collaboration-rules -->

<!-- BEGIN:prefetch-first-rules -->
# 백그라운드 프리페치 데이터 우선 사용 규칙

이 프로젝트는 로그인 직후 `AuthContext.tsx`에서 핵심 데이터를 백그라운드로 미리 로딩한다.
새 기능을 개발할 때 아래 목록을 **1순위로 확인**하고, 해당 데이터가 있으면 반드시 우선 사용한다.
불필요한 API 재호출, 로딩 스피너, 중복 state를 만들지 않는다.

## 프리페치 데이터 목록 (로그인 시 자동 로드)

| 데이터 | 접근 방법 | 캐시 키 | 대상 API |
|---|---|---|---|
| **조직단위(OU) 목록** | `useAuth().orgUnits` (React state) | `"ou:all"` | `GET /api/workspace/ou` |
| **전체 사용자 목록** | `getClientCache("users:all")` | `"users:all"` | `POST /api/workspace/users` |
| **그룹(메일링리스트) 목록** | `getClientCache("groups:all")` | `"groups:all"` | `POST /api/workspace/groups` |
| **학교 설정** | `useAuth().schoolSettings` (React state) | Firestore 실시간 구독 | — |
| **로그인 사용자 정보** | `useAuth().userData` (React state) | Firestore 실시간 구독 | — |

## 개발 체크리스트 (새 컴포넌트/기능 개발 전 필독)

1. **OU 목록이 필요한가?** → `useAuth().orgUnits`를 바로 사용한다. `fetch("/api/workspace/ou")`를 새로 호출하지 않는다.
2. **사용자 검색/목록이 필요한가?** → `getClientCache("users:all")`로 로컬 필터링한다. 캐시가 없는 경우에만 API를 온디맨드 호출한다.
3. **그룹 목록이 필요한가?** → `getClientCache("groups:all")`로 로컬 필터링한다.
4. **학교 설정(학년 수, OU 매핑 등)이 필요한가?** → `useAuth().schoolSettings`를 사용한다.

## 구현 패턴 예시

```typescript
// ✅ 올바른 방법 - 프리페치 데이터 우선 사용
const { orgUnits, schoolSettings } = useAuth();

// ❌ 금지 - 이미 있는 데이터를 재호출
const [orgUnits, setOrgUnits] = useState([]);
useEffect(() => {
  fetch("/api/workspace/ou").then(...).then(data => setOrgUnits(data));
}, []);
```

## 새 데이터를 프리페치에 추가하는 방법

새 기능에서 공통적으로 필요한 데이터가 생겼을 때, 개별 컴포넌트에 fetch를 추가하지 말고:
1. `src/context/AuthContext.tsx`의 백그라운드 프리페치 블록(`setTimeout` 내부)에 추가한다.
2. 필요 시 `AuthContextType` 인터페이스와 state를 추가하여 `useAuth()`로 노출한다.
3. 이 문서의 프리페치 데이터 목록 표를 업데이트한다.
<!-- END:prefetch-first-rules -->

<!-- BEGIN:firestore-security-rules -->
# Firestore 보안 규칙 — 배포 전 필수 변경 규칙

이 프로젝트는 현재 개발 편의를 위해 Firestore 보안 규칙이 공개(open) 상태이다.
**배포(Vercel 등 외부 공개) 직전에 반드시 아래 절차를 수행해야 한다.**

## 현재 개발용 규칙 (배포 금지)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{documents=**} {
      allow read, write: if true;  // ⛔ 공개 — 로컬 전용
    }
  }
}
```

## 배포 시 적용해야 할 규칙

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      // ✅ 로그인한 사용자(Google 계정)만 읽기/쓰기 허용
      allow read, write: if request.auth != null;
    }
  }
}
```

## 변경 방법

Firebase 콘솔 → Firestore → **규칙** 탭 → 위 내용으로 교체 → **게시** 클릭

## 근거

- 이 앱의 서버 로직(Next.js API Route)은 Firebase Admin SDK를 사용하므로 보안 규칙 적용 대상 외
- 클라이언트는 로그인 후 실시간 구독(`onSnapshot`)만 사용하므로 `request.auth != null` 조건이 충분
- 학생 개인정보 보호를 위해 공개 규칙 상태로 배포하는 것은 절대 금지
<!-- END:firestore-security-rules -->

<!-- BEGIN:autocomplete-input-rules -->
# 계정 및 그룹 입력 필드 자동완성(Autocomplete) 규칙

사용자 계정(이메일, 아이디) 혹은 구글 워크스페이스 그룹 메일 주소를 텍스트로 직접 입력하거나 검색해야 하는 새로운 입력창을 개발할 때:

1. **공통 AutocompleteInput 컴포넌트 사용**:
   - 직접 텍스트 인풋창을 설계하지 않고, `AutocompleteInput` (`src/components/admin/AutocompleteInput.tsx`)을 공용으로 사용하여 이메일, 성, 이름 기반의 통합 검색 및 드롭다운 선택을 구현한다.

2. **성능 최적화 필수**:
   - 자동완성 검색 구현 시 **디바운스(200~300ms)**를 필수 적용한다.
   - 그룹 메일 등 데이터 용량이 고정적이고 작은 정보는 페이지 로드 시 1회만 fetch하여 **로컬 메모리 필터링**을 적용하고, 사용자 계정 등 가변적인 대량 정보는 입력에 따라 API를 **온디맨드 호출**한다.

3. **성/이름 검색 지원**:
   - 일반 계정 검색의 경우, 사용자가 이메일 아이디 외에도 성(Family Name) 또는 이름(Given Name)을 입력해도 검색이 지원되도록 API 쿼리를 연동한다.
<!-- END:autocomplete-input-rules -->

<!-- BEGIN:deployment-checklist-rules -->
# 정식 배포(Deployment) 시 체크리스트 규칙

정식 상용 배포 요청 시, 에이전트는 다음을 반드시 이행한다:

1. **배포 체크리스트 파일 사전 로드**:
   - 배포 지원을 시작하기 전에 반드시 저장소 루트의 [`deployment_checklist.md`](./deployment_checklist.md)를 읽고 점검 사항 및 검증 시나리오를 숙지한다.
   - (2026-07-22 이전에는 이 문서가 `~/.gemini/antigravity-ide/brain/` 아래 Git 밖에 고립되어 있었다. 저장소 루트로 이동 완료.)

2. **환경 변수 가이드**:
   - 배포 플랫폼에 입력할 환경 변수를 안내할 때, 알리미 계정(`GOOGLE_WORKSPACE_SENDER_EMAIL="hmnotice@hmh.or.kr"`)과 배포 도메인(`NEXT_PUBLIC_BASE_URL`), 크론 토큰(`CRON_SECRET`)이 누락되지 않도록 강조한다.

3. **서비스 계정 역할(IAM) 검증 안내**:
   - 도메인 전체 위임(Domain-wide delegation) 셋업과 더불어 서비스 계정에 **`Firebase 인증 관리자`** 역할이 부여되었는지 검사 단계를 안내한다.

4. **배포 전 필수 조치**:
   - Firestore 보안 규칙을 공개(`if true`)에서 인증 필수(`if request.auth != null`)로 반드시 변경한다. 상세는 아래 firestore-security-rules 섹션 참조.
<!-- END:deployment-checklist-rules -->
