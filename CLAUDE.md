# 효명고등학교 관리 시스템 — Claude Code 프로젝트 규칙

## 프로젝트 개요

- **스택**: Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + Firebase (Auth, Firestore) + Google Workspace Admin SDK
- **용도**: 학교 학적관리, Google Workspace 계정 생애주기, 구글 클래스룸 배정, 크롬 북마크 관리
- **배포**: Vercel
- **주요 디렉터리**:
  - `src/app/` — Next.js App Router 페이지 및 API 라우트
  - `src/components/admin/` — 관리자 대시보드 컴포넌트 (18개 파일 + lifecycle 하위 디렉터리)
  - `src/context/AuthContext.tsx` — 인증 및 백그라운드 프리페치 데이터 관리
  - `src/lib/google/workspace.ts` — Google Workspace Admin SDK 헬퍼 함수
  - `src/lib/firebase/` — Firebase Admin 및 클라이언트 설정
  - `src/lib/cache/clientCache.ts` — 브라우저 인메모리 캐시 (TTL 5분)

---

## 세션 시작 시 필수 읽기

새 세션을 시작할 때 반드시 아래 파일을 읽고 현재 개발 맥락을 파악하라:
1. `development_roadmap.md` — 전체 개발 로드맵, 완료/미완료 Phase, 아이디어 목록
2. `project_notes.md` — 미검증 사항, 배포 체크리스트, 아키텍처 결정 기록

---

## Antigravity & Claude AI 에이전트 이중 협업 및 분업 규칙

이 프로젝트는 IDE 기반의 **Antigravity**와 터미널/데스크톱 앱 기반의 **Claude**가 공동으로 개발을 진행한다. 두 에이전트는 서로의 작업 결과와 상태를 존중하며 아래 분업 및 교대 수칙을 준수한다.

### 1. 에이전트별 주 전담 영역 및 역할 분담
- **Antigravity (IDE & Agentic Assistant)**:
  - **대규모 아키텍처 및 기획 설계**: `implementation_plan.md`, `development_roadmap.md` 수립 및 관리.
  - **브라우저 서브에이전트 E2E 검증**: 브라우저 서브에이전트를 활용하여 실제 사용자 화면 흐름 및 UI 동작 검증.
  - **복합 컴포넌트 개발**: 신규 기능 컴포넌트, 복잡한 비즈니스 로직 작성 및 통합 모니터링.
- **Claude (CLI / Linux Desktop App Assistant)**:
  - **로컬 검증 및 디버깅**: 로컬 터미널 빌드(`npm run build`), 타입 검사(`npx tsc`), 린트(`npm run lint`) 및 빠른 에러 수정.
  - **단위 리팩토링 및 코드 리뷰**: 개별 함수, 헬퍼 유틸리티, 스타일링 튜닝 및 빠른 코드 리뷰.
  - **Git 커밋 관리**: 변경 사항에 대한 로컬 Git 커밋 및 상태 확인.

### 2. 작업 상태 동기화 및 기록 규칙 (Context Handover)
- 한 에이전트가 주요 작업(Phase 완료, 큰 기능 작성)을 마쳤을 때는 반드시 프로젝트 루트의 `development_roadmap.md` 또는 `project_notes.md`에 **완료한 작업**과 **다음 에이전트가 이어서 해야 할 작업(Next Actions)**을 기록한다.
- 모든 기획 문서, 이슈 노트, 진행 상태 보고서는 에이전트 전용 임시 디렉터리가 아닌 프로젝트 루트 파일에 작성하고 Git으로 추적한다.

### 3. 상호 존중 및 공통 규칙 준수
- 상대방 에이전트가 이미 작성해 둔 코드나 구조를 파괴하는 임의 변경을 금지한다.
- `CLAUDE.md` / `AGENTS.md`에 정의된 기존 공통 규칙(알림 발신자 `hmnotice@hmh.or.kr` 통일, 백그라운드 프리페치 데이터 우선 사용, AutocompleteInput 사용 등)을 양쪽 에이전트 모두 엄격히 준수한다.

### 4. 사용자 대상 차순위 지시 가이드 (Next Action Recommendation)
사용자는 비전문가이므로, 작업이 완료되거나 특정 단계가 끝날 때마다 **반드시** 답변 마무리에 **"다음으로 어느 에이전트에게 무슨 지시를 해야 하는지"** 복사해서 쓸 수 있는 구체적인 프롬프트를 추천해야 한다.

- **Antigravity가 대규모 코드/설계를 마쳤을 때:**
  - 💡 **[Claude 지시 추천]**: *"Claude 앱을 열고 'Antigravity가 작성한 코드에 대해 `npx tsc` 및 `npm run build`를 실행해서 빌드/타입 에러가 없는지 검사하고 고쳐줘'라고 지시하세요."*
- **Claude가 빌드/린트/디버깅/Git 커밋을 마쳤을 때:**
  - 💡 **[Antigravity 지시 추천]**: *"Antigravity에게 'Claude가 빌드 및 타입 검사를 마쳤으니, 브라우저 서브에이전트로 해당 기능의 화면 동작을 E2E 검증해줘'라고 지시하세요."*

---

## Next.js 버전 주의

이 프로젝트는 **Next.js 16**을 사용한다. 이 버전에는 breaking changes가 있을 수 있으므로, API 사용법이나 파일 구조를 작성하기 전에 `node_modules/next/dist/docs/`의 관련 가이드를 먼저 읽어라. 디프리케이션 경고에 주의하라.

---

## 로컬 개발 서버 시작 규칙

사용자가 로컬 서버를 켜달라고 하면:
1. `npm run dev`를 백그라운드로 실행한다.
2. **그 즉시 멈춘다.** 서버 로그를 반복 확인(폴링)하는 행동을 절대 하지 않는다.
3. 사용자에게 "서버가 시작됩니다. 기본 주소는 `http://localhost:3000` 입니다." 라고 안내하고 다음 지시를 기다린다.

**금지 행동**: 서버 로그 파일을 여러 번 읽거나, 상태를 반복 확인하여 무한 루프에 빠지는 것.

---

## 이메일 및 구글 챗 발신자 규칙

학생 또는 교직원에게 이메일(Gmail API)이나 구글 챗 DM을 발송할 때:

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

---

## Google Workspace & Firebase Auth UID 동기화 규칙

GWS 계정과 Firebase Auth를 함께 사용하는 이 프로젝트에서 학적 변동(전입, 전출, 삭제, 입학) 처리 시 아래 수명 주기를 엄격히 준수한다:

1. **GWS UID 충돌 방지**:
   동일한 이메일로 구글 계정을 삭제 후 재생성할 때, 구글 내부 고유 ID(UID)가 변경되어 파이어베이스 로그인 시 `auth/provider-already-linked` 에러가 발생한다.
   - 계정 **삭제(개별/일괄/크론/전출)** 시: Google Workspace 계정을 삭제하기 전에 반드시 `deleteAuthUserByEmail(email)`을 호출하여 Firebase Auth의 인증 레코드도 동기화하여 삭제한다.
   - 계정 **생성(개별/전입/입학)** 시: Google Workspace 계정을 생성하기 전에 반드시 `deleteAuthUserByEmail(email)`을 먼저 실행하여 혹시 남아있을지 모르는 파이어베이스 구버전 UID 레코드를 깨끗이 정리(Clean)한다.

2. **서비스 계정 역할(IAM) 전제 조건**:
   이 자동 삭제 메커니즘(`deleteAuthUserByEmail`)이 정상 작동하려면, 백엔드 서버에서 실행되는 GCP 서비스 계정(`GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL`)에 GCP Console 또는 Firebase Console을 통해 **`Firebase 인증 관리자 (Firebase Authentication Admin)`** 역할이 반드시 부여되어 있어야 한다.

---

## 개발 로드맵 및 기획 문서 규칙

개발 관련 기획 문서, 진행 상태 보고서, 구현 계획서, 할 일 목록 등을 작성할 때:

1. 임시 디렉터리나 에이전트 전용 격리 공간에만 문서를 작성하지 않는다.
2. 모든 기획, 계획, 진행 현황 문서는 **프로젝트 루트**에 파일(예: `development_roadmap.md`)로 작성하고 Git 추적 대상에 포함되게 한다. 이를 통해 기기 전환이나 대화 세션 만료 시에도 기획 맥락이 끊기지 않도록 방지한다.

---

## 백그라운드 프리페치 데이터 우선 사용 규칙

이 프로젝트는 로그인 직후 `AuthContext.tsx`에서 핵심 데이터를 백그라운드로 미리 로딩한다.
새 기능을 개발할 때 아래 목록을 **1순위로 확인**하고, 해당 데이터가 있으면 반드시 우선 사용한다.
불필요한 API 재호출, 로딩 스피너, 중복 state를 만들지 않는다.

### 프리페치 데이터 목록 (로그인 시 자동 로드)

| 데이터 | 접근 방법 | 캐시 키 | 대상 API |
|---|---|---|---|
| **조직단위(OU) 목록** | `useAuth().orgUnits` (React state) | `"ou:all"` | `GET /api/workspace/ou` |
| **전체 사용자 목록** | `getClientCache("users:all")` | `"users:all"` | `POST /api/workspace/users` |
| **그룹(메일링리스트) 목록** | `getClientCache("groups:all")` | `"groups:all"` | `POST /api/workspace/groups` |
| **학교 설정** | `useAuth().schoolSettings` (React state) | Firestore 실시간 구독 | — |
| **로그인 사용자 정보** | `useAuth().userData` (React state) | Firestore 실시간 구독 | — |

### 개발 체크리스트 (새 컴포넌트/기능 개발 전 필독)

1. **OU 목록이 필요한가?** → `useAuth().orgUnits`를 바로 사용한다. `fetch("/api/workspace/ou")`를 새로 호출하지 않는다.
2. **사용자 검색/목록이 필요한가?** → `getClientCache("users:all")`로 로컬 필터링한다. 캐시가 없는 경우에만 API를 온디맨드 호출한다.
3. **그룹 목록이 필요한가?** → `getClientCache("groups:all")`로 로컬 필터링한다.
4. **학교 설정(학년 수, OU 매핑 등)이 필요한가?** → `useAuth().schoolSettings`를 사용한다.

### 구현 패턴 예시

```typescript
// ✅ 올바른 방법 - 프리페치 데이터 우선 사용
const { orgUnits, schoolSettings } = useAuth();

// ❌ 금지 - 이미 있는 데이터를 재호출
const [orgUnits, setOrgUnits] = useState([]);
useEffect(() => {
  fetch("/api/workspace/ou").then(...).then(data => setOrgUnits(data));
}, []);
```

### 새 데이터를 프리페치에 추가하는 방법

새 기능에서 공통적으로 필요한 데이터가 생겼을 때, 개별 컴포넌트에 fetch를 추가하지 말고:
1. `src/context/AuthContext.tsx`의 백그라운드 프리페치 블록(`setTimeout` 내부)에 추가한다.
2. 필요 시 `AuthContextType` 인터페이스와 state를 추가하여 `useAuth()`로 노출한다.
3. 이 문서의 프리페치 데이터 목록 표를 업데이트한다.

---

## 계정 및 그룹 입력 필드 자동완성(Autocomplete) 규칙

사용자 계정(이메일, 아이디) 혹은 구글 워크스페이스 그룹 메일 주소를 텍스트로 직접 입력하거나 검색해야 하는 새로운 입력창을 개발할 때:

1. **공통 AutocompleteInput 컴포넌트 사용**:
   - 직접 텍스트 인풋창을 설계하지 않고, `AutocompleteInput` (`src/components/admin/AutocompleteInput.tsx`)을 공용으로 사용하여 이메일, 성, 이름 기반의 통합 검색 및 드롭다운 선택을 구현한다.

2. **성능 최적화 필수**:
   - 자동완성 검색 기능 구현 시 **디바운스(Debounce, 200~300ms)**를 필수 적용한다.
   - 그룹 메일 등 데이터 용량이 고정적이고 작은 정보는 페이지 로드 시 1회만 fetch하여 **로컬 메모리 필터링**을 적용하고, 사용자 계정 등 가변적인 대량 정보는 입력에 따라 API를 **온디맨드 호출**한다.

3. **성/이름 검색 지원**:
   - 일반 계정 검색의 경우, 사용자가 이메일 아이디 외에도 성(Family Name) 또는 이름(Given Name)을 입력해도 검색이 지원되도록 API 쿼리를 연동한다.

---

## Firestore 보안 규칙 — 배포 전 필수 변경

이 프로젝트는 현재 개발 편의를 위해 Firestore 보안 규칙이 공개(open) 상태이다.
**배포(Vercel 등 외부 공개) 직전에 반드시 아래로 변경해야 한다.**

```js
// 현재 (개발용 — 배포 금지)
allow read, write: if true;

// 배포 시 적용할 규칙
allow read, write: if request.auth != null;
```

변경 방법: Firebase 콘솔 → Firestore → **규칙** 탭 → 위 내용으로 교체 → **게시** 클릭

---

## 정식 배포 시 체크리스트

정식 상용 배포(Deployment) 요청 시, 다음 사항을 반드시 이행해야 한다:

1. **환경 변수 확인**:
   - `GOOGLE_WORKSPACE_SENDER_EMAIL="hmnotice@hmh.or.kr"` (발신 알리미 계정)
   - `NEXT_PUBLIC_BASE_URL` (배포 도메인)
   - `CRON_SECRET` (Vercel 크론 스케줄러)

2. **서비스 계정 역할(IAM) 검증**:
   - 최고관리자 위임(Domain-wide delegation) 셋업이 완료되었는지 확인
   - 서비스 계정에 **`Firebase 인증 관리자`** 역할이 부여되었는지 확인

3. **배포 전 상세 체크리스트**: `project_notes.md`의 "정식 배포 시 반드시 할 일" 섹션 참조
