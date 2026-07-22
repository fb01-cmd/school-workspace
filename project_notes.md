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


---

## 🧭 대화 체크포인트 (AGENTS.md §5 규칙 적용) — 2026-07-22

> 이 세션이 무관한 주제 여러 개(한글 IME 진단 → 크롬북 튜토리얼 작성 → 구글 문서 발행 →
> 개발 맥락 점검 → 협업 규칙 개편 → 엔진 선택 규칙 수정)를 거치며 길어져 트리거 조건을
> 충족, 사용자 요청으로 체크포인트를 남김. 새 대화창에서는 이 항목만 읽고 이어가면 됨.

### 이번 대화에서 내린 결정과 근거

1. **크롬북 Crostini 한글 입력 문제 해결 및 튜토리얼 발행**
   - 원인: sommelier가 Wayland input-method 프로토콜을 미지원 → Electron 앱을 X11로 강제 실행해야 함.
   - 사용자 홈 디렉터리에 `~/chromebook-claude-korean-input.md` 작성, 구글 문서로 발행함
     (링크는 메모리 `chromebook-korean-input-guide.md` 참조, 이 저장소와 무관).
   - `~/.sommelierrc`의 fcitx5 실행 줄 제거(이중 실행 경쟁 방지), systemd 사용자 서비스로 대체.
   - 이 프로젝트(`school` 저장소)와는 무관한 개인 환경 설정 작업이라 **커밋 대상 아님**.

2. **에이전트 분업 방식을 "일의 크기" → "판단(Claude) vs 생산(Antigravity)"으로 전면 개편**
   - 근거: Claude는 5일 주기로 리셋되는 유상·희소 자원, Antigravity는 저렴·다계정 대량 사용 가능.
   - Claude 제안 → Antigravity 회신(전면 찬성 + 안전장치 1건 보완) → 합의 반영까지 완료.
   - `AGENTS.md`를 규칙 단일 원본으로 지정. `CLAUDE.md`/`.agents/AGENTS.md`는 안내만 남김.

3. **엔진(모델) 선택 규칙 — 사실 오류 수정**
   - 초판에 실재하지 않는 모델명(`Claude Sonnet 4.6`/`Opus 4.6`)이 있어 삭제.
   - 사용자가 실제 드롭다운 스크린샷 제공 → `Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5`로 확정.
   - 원칙: 각 에이전트는 자기 모델만 추천, 핸드오버 시엔 에이전트만 지정(모델명 상호 추측 금지).
   - "빠른 모드"는 속도 옵션이지 비용 절감 수단이 아님을 명시.

4. **대화 길이 체크포인트 규칙 신설 (Claude 전용, `AGENTS.md` §5)**
   - 사실관계 정정: 대화가 길어지면 비용이 "기하급수적으로 폭증"하는 게 아니라, 캐싱 안 되는
     새 입력과 늘어난 추론 토큰 때문에 누적 비용이 커지는 것. 이 harness는 이미 컨텍스트 한계
     근처에서 자동(사후·손실 있는) 압축을 한다 — 이 규칙은 그걸 대체하는 게 아니라 선제적·
     고정밀 체크포인트로 보완하는 것.
   - Antigravity의 컨텍스트 처리 방식은 미확인이라 이 절은 Claude 전용으로 명시.

### 변경 파일 및 커밋

문서만 변경, 코드 변경 없음. 모두 `main`에 커밋 완료, 작업 트리 깨끗함.

| 커밋 | 내용 |
|---|---|
| `24d1bfa` | 이중 협업 규칙 최초 추가 (3파일 중복 버전) |
| `abd7a89` | 협업 규칙 개편 + `AGENTS.md` 단일 원본화 + Phase 5.5 로드맵 소급 |
| `63d15ff` | API 가드 E2E 검증 완료 기록 (Antigravity 작업분) |
| `3bdc1dd` → `5e8d7c7` → `4c8afdf` → `e02405d` | 엔진 선택 규칙 시행착오 및 최종 수정 |
| `e404933` | 대화 길이 체크포인트 규칙 신설 (본 항목의 근거) |

### 아직 열려 있는 질문 / 미해결 사항

- **Antigravity 측 모델 표 미채움**: `AGENTS.md` §4 "Antigravity 측 모델 선택" 표에 등급만
  있고 실제 Gemini 모델명이 비어 있음. Antigravity가 직접 자기 드롭다운을 확인해 채워야 함.
- **저장소 루트 잔여 스크립트**: `write_lifecycle.js`(파싱 에러 원인), `gen_a.cjs`,
  `gen_lifecycle.cjs`, `gen_part1.cjs` — 별도 백그라운드 작업으로 이미 등록됨(`task_b7a7d34b`),
  아직 미실행.
- **린트 부채 408건**: 빌드/타입은 정상이라 급하지 않음. `no-explicit-any` 345건은 대량 생산
  영역(Antigravity), `react-hooks` 계열 51건은 실제 버그 소지가 있어 Claude가 표적 점검 필요.

### 새 대화창에서 이어갈 다음 작업

Phase 6(동적 폼 빌더 및 생활지도 기록) 착수 — 아키텍처/스펙 판단부터 Claude가 시작.
새 대화를 열 때: *"project_notes.md의 최신 체크포인트를 읽고 Phase 6 스펙 설계부터 이어가줘"*
