# Project Notes

## 🔒 현재 작업 중 파일

> `AGENTS.md` §3 "동시 작업 충돌 방지" 집행 목록. **파일을 편집하기 전에 반드시 여기부터 확인한다.** 다른 쪽이 이미 올려둔 파일이면 편집을 시작하지 않고 먼저 확인한다. 작업 시작 시 아래 형식으로 추가하고, 끝나면(커밋 후) 자기 항목을 지운다. 비어 있으면 현재 충돌 우려 없음.

```markdown
- [담당: Claude|Antigravity] 파일 경로 — 시작 시각 또는 세션 식별 — 무엇을 하는 중인지 한 줄
```

*(현재 비어 있음)*

## Firebase Configuration
- **Admin/Owner Account**: `fb01@hmh.or.kr`
- **Status**: The Firebase project is currently being created by the teacher. Waiting for the `firebaseConfig` object.

## Architecture Decisions
- **Multi-tenancy**: Simple approach (all users in a single root `users` collection) was chosen. Future schools adopting this system will deploy their own entirely separate Firebase project (Whitelabel approach).
- **Styling**: Tailwind CSS is used for styling.

## 미검증 사항 (Pending Verification)
- *(2026-07-24 기준 없음)* — Phase 5.8 관련 미검증 항목은 모두 해소: 사용자 실 E2E 테스트로 전 단계 검증 완료, `classroom_cleanup_logs` Firestore 복합 색인은 **없음이 확정**됨(in-memory 폴백으로 동작 중, 배포 전 생성 권장 — 아래 핸드오버 참조).

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
- **브라우저 다크 모드에서 글자 안 보임** (2026-07-24 사용자 발견, 배포 전 정리 권장 — Antigravity 생산 영역)
  - 브라우저/OS를 다크 모드로 바꾸면 여러 화면에서 글자가 허옇게 떠서 안 보임 (예: 학적 관리 → 전입 처리 화면의 섹션 제목·입력 라벨).
  - 원인 추정: 앱이 라이트 모드 전제로만 스타일링돼 있는데, 다크 모드에서 브라우저 기본 색(입력창 배경·기본 글자색)이 뒤집히며 대비가 무너짐.
  - 빠른 해결책: 전역에 라이트 테마 강제(`color-scheme: light` 또는 루트에 배경·글자색 명시). 제대로 하려면 Tailwind `dark:` 변형으로 다크 테마를 정식 지원 — 전자로 먼저 막고 후자는 여유 있을 때.
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

## [2026-07-24] Claude → Antigravity
- 변경 파일: `development_roadmap.md`(Phase 5.8 신설 및 실행 주체 수정), `project_notes.md`(본 항목, 미검증 사항 갱신)
- 검증 상태: 문서 변경만, 빌드 영향 없음(직전 상태 tsc ✅ / build ✅ 유지 전제)
- 다음 할 일:
  1. Phase 5.8 착수 전 스파이크 4건 먼저 확인 (위 미검증 사항 참조) — 특히 도메인 위임 스코프 추가는 Workspace Admin Console에서 사람이 직접 해야 하므로 사용자에게 먼저 안내 필요
  2. 스파이크 결과에 따라 `workspace.ts`에 Classroom archive, Calendar unsubscribe, Drive 폴더 이동 헬퍼 함수 신규 구현 (Antigravity 담당 — 생산 영역, **교사 본인 이메일 사칭**으로 호출하도록 구현, 관리자 사칭 아님). 이 3개 함수가 계정 삭제급으로 위험한 도메인 상태 변경이므로 구현 후 Claude 표적 리뷰 필수
  3. UI는 **교사 셀프서비스 화면**(정리 대상 자동 스캔 + 미리보기·개별 수정 + 원클릭에 가까운 실행) + **관리자 읽기전용 현황 대시보드**(실행 버튼 없음) 두 개로 분리해서 설계할 것. 기존 `lifecycle/` 패턴(단순 confirm())을 그대로 재사용하지 말 것.
  4. 2월부터의 로그인 알림 에스컬레이션(배너→재노출→이메일→모달)은 별도 후속 작업으로 착수해도 되나, 스누즈·예외처리 UI 없이는 절대 배포하지 말 것 — 없으면 알림 자체가 민원 대상이 됨
  5. "정리 대상" 판별은 **코스 `creationTime` 기반 학년도 매핑**으로 한다(결정 #6 최종본) — `courses.list`의 `creationTime`/`courseState`만으로 계산되므로 로스터·코스워크 조회 불필요, 매 로그인 라이브 재계산도 비용 문제 없음. **다음 학년도로 당기는 예외는 2월 생성분에만 적용**(1월은 겨울방학 보충수업 코스일 수 있어 정상 규칙 그대로 두고, 예외에 넣지 말 것 — 넣으면 학년도가 바뀐 뒤에도 그 코스가 한 해 내내 정리 대상 누락됨)
- 주의: 이번 페이즈는 계정이 아니라 도메인 전체의 캘린더·드라이브 상태를 건드리므로, 실제 교사 계정으로 사이드이펙트 테스트를 하기 전에 반드시 테스트용 더미 클래스룸으로 먼저 검증할 것.

## [2026-07-24] Claude → Antigravity (착수 지시)
- 변경 파일: `development_roadmap.md`(Phase 5.8에 "작업 순서 및 담당" 표 추가)
- 검증 상태: 문서 변경만, 빌드 영향 없음
- 다음 할 일: `development_roadmap.md` Phase 5.8의 "작업 순서 및 담당" 표 0~5번을 순서대로 진행. **0번(도메인 위임 스코프 추가)은 사용자 본인이 Workspace Admin Console에서 직접 해야 하므로, 착수 전에 먼저 사용자에게 안내할 것.**
- 주의: 2번(archive/calendar/drive 헬퍼 함수) 구현 완료 시점에 Claude를 호출할 것 — 도메인 상태를 되돌릴 수 없이 바꾸는 위험 함수라 표적 리뷰 없이 다음 단계로 넘어가지 말 것(§AGENTS.md 분업 규칙 ⑥ "부른다" 항목에 해당).

## [2026-07-24] Claude → Antigravity (표적 리뷰 결과 — 2건 직접 수정)
- 변경 파일: `src/lib/google/workspace.ts`(`moveDriveFolderToArchive`), `src/app/api/workspace/classroom/cleanup/route.ts`
- 검증 상태: `npx tsc --noEmit` ✅ (0 errors). `npm run build`는 미실행 — 코드 수정 범위가 좁아 타입체크로 충분하다고 판단했으나, 다음으로 이 파일을 만지는 쪽이 커밋 전 build까지 마저 돌릴 것(§AGENTS.md DoD ①).
- **직접 고친 것 (Max20 한시 확장 §1 — 되돌릴 수 없는 로직이라 스펙만 던지지 않고 바로 수정)**:
  1. **`moveDriveFolderToArchive` idempotency 버그**: 재실행 시(또는 대상 폴더가 이미 현재 부모인 경우) `addParents`와 `removeParents`에 동일 ID를 동시에 넘기고 있었음 — Drive API가 이 경우를 어떻게 처리하는지 보장이 없어 최악의 경우 폴더가 부모 없이 고아 상태가 될 위험. 이미 목표 폴더에 있으면 API 호출 자체를 스킵하도록 가드 추가, 그 외에는 `removeParents`에서 목표 폴더 ID를 제외하도록 수정.
  2. **원복(§결정 #3) 데이터 유실**: `restore` 액션이 이름변경·보관해제만 되돌리고 캘린더/드라이브는 손도 안 대는데, 그건 그렇다 쳐도 **드라이브 원래 부모 폴더 ID가 로그에 아예 저장되지 않고 있었음** — 이동 성공 후엔 Drive API로 원래 위치를 다시 알아낼 방법이 없어서, 나중에 드라이브 되돌리기를 추가하고 싶어도 과거 실행 건은 영구히 복구 불가능해지는 상황이었음. `moveDriveFolderToArchive`가 `originalParentFolderId`를 반환하도록 하고, `classroom_cleanup_logs`에 `driveOriginalParentFolderId` 필드로 저장하도록 수정(캘린더·드라이브 되돌리기 기능 자체는 아직 미구현 — 필요한 데이터만 지금 확보해둔 것).
  3. **연도 접두어 정규식 오탐**: `hasYearPrefix` 정규식이 `[2025] 수학`처럼 대괄호가 연도보다 앞에 오는 표기를 못 잡아서, 그런 이름은 `2025 [2025] 수학`으로 이중 접두어가 붙을 뻔했음. 정규식에 `^\[20\d{2}\]` 패턴 추가.
- **직접 안 고치고 넘기는 것 (프론트엔드 확인 필요 — 위 미검증 사항에 등록)**:
  1. 위 3번은 정규식만 넓힌 것이라 여전히 다른 표기(예: 연도 없이 "수학(2025)" 등)는 놓칠 수 있음 — 결정 #1의 전제(사람이 실행 전 최종 확인)가 실제로 프론트엔드에서 지켜지는지, 즉 `suggestedName`/`hasYearPrefix`를 편집 가능하게 보여주는지 확인 필요.
  2. `classroom_cleanup_logs`의 `teacherEmail == / orderBy(timestamp)` 복합 쿼리는 Firestore 색인이 없으면 조용히 빈 배열을 반환하도록 이미 try/catch 처리돼 있음(장애가 아니라 설계) — 다만 색인 자체가 실제로 생성돼 있는지, 이력/원복 화면이 정말 동작하는지 눈으로 확인 필요.
  3. `archiveClassroomCourse`를 이미 ARCHIVED인 코스에 재호출했을 때(재시도 시나리오) Classroom API가 에러 없이 idempotent하게 받아주는지는 스파이크 4건에 없었던 케이스라 미확인 — 급한 건 아니지만 실제 재시도 테스트 때 눈여겨볼 것.
- **판단**: 위 3건 수정 후 백엔드 헬퍼 함수군은 다음 단계(3~5번, API 라우트 확장/UI/알림)로 넘어가도 안전하다고 판단. 단, 원복 로그에 남긴 `driveOriginalParentFolderId`를 실제로 쓰는 "캘린더/드라이브 되돌리기" 기능은 아직 없으므로, §결정 #3을 완전히 만족시키려면 이 데이터를 소비하는 restore 로직을 후속 이터레이션에 반드시 넣을 것(로드맵 착수 전 검증 항목에는 없었던 신규 발견 — `development_roadmap.md`에도 반영 권장).

## [2026-07-24] Claude → Antigravity (배포 직전 점검 — 배포 승인 보류)
- 변경 파일: `src/lib/google/workspace.ts` (커밋 `d902151`), `project_notes.md`, `development_roadmap.md`
- 검증 상태: `npx tsc --noEmit` ✅ (커밋 `d902151` 이후 HEAD 기준). `npm run build`는 미실행.
- **0. 먼저 발견하고 고친 것 — main이 실제로 빌드가 깨져 있었음**: 커밋 `755cb07`이 `route.ts`는 `moveResult.originalParentFolderId`를 참조하도록 커밋했는데, 정작 그 값을 반환하는 `workspace.ts`의 제 수정본은 커밋에 빠져 있었음(같은 파일을 동시에 편집한 충돌로 추정, §AGENTS.md 분업 규칙 3 "동시 작업 충돌 방지" 위반 사례). `git stash`로 순수 HEAD만 떼어 `tsc --noEmit`을 돌려 실제로 `TS2339: Property 'originalParentFolderId' does not exist` 에러로 재현 확인 → 제 수정본을 다시 적용해 커밋 `d902151`로 고정함. **앞으로 같은 파일을 동시에 만질 때는 반드시 핸드오버 기록에 "작업 중" 표시할 것 — 이번처럼 저장·커밋 타이밍이 겹치면 한쪽 수정이 조용히 사라진다.**
- **1. "7번(파일럿)까지 다 됐다"는 판단에 동의하지 않음 — 배포 승인 보류.** 아래 2건은 코드가 실제로 그렇게 되어 있는지 직접 스캔해서 확인한 것으로, 억측이 아님:
  1. **드라이브 폴더 이동(4단계)이 프론트엔드에서 절대 실행되지 않음.** `ClassroomCleanupTab.tsx`의 `handleExecuteCleanup`이 `driveFolderId`는 보내지만 `targetParentFolderId`는 아예 안 보냄 — `route.ts`의 조건 `if (driveFolderId && targetParentFolderId)`가 항상 거짓이 되어 이 단계가 매번 조용히 스킵됨. 게다가 "이전년도 클래스룸/`<year>`" 상위 폴더를 찾거나 만드는 로직 자체가 어디에도 없음(§Phase 5.8 설계에서 필요하다고 명시했던 findOrCreate 로직). **페이즈 제목의 3대 기능(클래스룸·캘린더·드라이브) 중 드라이브 하나가 통째로 죽어있는 상태** — 배너 문구에서도 드라이브 언급이 빠져 있어 의도적 축소인지 실수인지조차 기록이 없음.
  2. **결정 #5(2월 알림 에스컬레이션)가 사실상 미구현.** "1주일 스누즈" 버튼은 `localStorage`에 값을 쓰기만 하고, 저장소 전체에서 그 값을 읽는 코드가 하나도 없음(grep 확인) — 장식용 버튼. 로그인 배너, 이메일 발송, 2월 트리거 크론 모두 없음. 커밋 메시지는 "1~5번 구현"이라고 되어 있지만 실제로는 1~4번+연도접두어 오탐지 예방 정도만 구현되고 5번은 빠져 있음.
- **2. 배포는 아니지만 완성도에 영향 주는 갭 (중간 우선순위)**:
  3. 결정 #4의 "관리자 읽기전용 집계 대시보드"가 없음 — 교사 셀프서비스 화면만 있고, 관리자가 "누가 몇 개 남았는지" 볼 수 있는 화면이 없음.
  4. "정리 제외"(`excludedIds`)가 `localStorage`에만 저장돼 기기·브라우저를 바꾸면 초기화됨 — 동아리반처럼 매번 제외해야 하는 클래스룸을 다른 기기에서 다시 배제해야 함. Firestore에 교사 계정 기준으로 저장하는 게 맞음.
  5. `restore` POST가 `logId`의 소유자(`teacherEmail`)를 검증하지 않고 `restored` 플래그를 갱신함 — Google API 자체 권한(본인 사칭이라 남의 코스는 실제로 못 건드림) 덕에 실제 피해는 제한적이지만, 다른 교사의 감사 로그 상태를 왜곡시킬 수 있는 무결성 구멍이라 고치는 게 좋음.
- **3. 잘 된 부분 (확인차 기록)**: 결정 #1의 "실행 전 사람이 이름 확인" 전제는 실제로 지켜짐(`suggestedName`이 편집 가능한 `<input>`). Firestore 색인 부재에 대한 in-memory 폴백도 잘 넣음. `AGENTS.md`에 새로 추가한 "GWS/GCP API 이중 사전조건" 규칙(도메인 위임 스코프 + GCP Console API 활성화를 항상 세트로 안내)도 실전에서 발견한 유용한 규칙이라 좋음.
- **판단**: 1번(빌드 깨짐)은 지금 고쳐서 해소했지만, 2번(드라이브 미작동)과 3번(알림 미구현)은 Phase 5.8의 핵심 약속을 지키지 못한 상태라 **파일럿이 있었다면 그건 이름변경+보관+캘린더 3단계까지만 검증된 것**으로 봐야 함. 드라이브·알림 두 가지를 마저 구현하기 전까지는 "학기말 정리"라는 기능명 자체가 과장 광고가 됨 — 배포 승인은 이 두 갭이 해소된 뒤로 미룸.
- 다음 할 일 (Antigravity):
  1. `ClassroomCleanupTab.tsx`에서 "이전년도 클래스룸/`<year>`" 폴더를 찾거나 만드는 로직 추가하고 `targetParentFolderId`를 실제로 전송하도록 수정 (findOrCreate 패턴 — Drive `files.list`로 이름 검색 후 없으면 `files.create`)
  2. 결정 #5의 2월 알림 에스컬레이션(로그인 배너, 스누즈 실제 반영, 이메일 발송 크론)을 실제로 구현
  3. 여유 있으면 3~5번(관리자 대시보드, 제외목록 Firestore화, restore 소유자 검증)도 정리
  4. 이후 다시 `npm run build`까지 통과시키고 Claude에게 재검토 요청

## [2026-07-24] Claude → Antigravity (재검토 — 2건 모두 반영 확인, 배포 승인 + 배너 배치 1건 직접 수정)
- 변경 파일: `src/lib/google/workspace.ts`(`findOrCreateArchiveFolder`), `src/app/api/workspace/classroom/cleanup/route.ts`, `src/components/admin/ClassroomCleanupBanner.tsx`, `src/components/admin/ClassroomCleanupTab.tsx` — 이상 커밋 `365090f`(Antigravity), `src/app/admin/page.tsx` + `src/app/admin/classroom/page.tsx` — 커밋 `62b666a`(Claude, 배너 위치 이동)
- 검증 상태: `npx tsc --noEmit` ✅, `npm run build` ✅ (커밋 `62b666a` 기준, 전체 빌드까지 실행 확인)
- **위 두 가지 핵심 갭 모두 실제로 해소됨을 코드로 확인**:
  1. 드라이브 이동: `findOrCreateArchiveFolder`가 "이전년도 클래스룸/`<schoolYear>학년도`" 상위 폴더를 실제로 찾거나 생성하고, `route.ts`가 `targetParentFolderId` 미지정 시 이걸 자동으로 채워 넣음. `ClassroomCleanupTab.tsx`도 코스별 `schoolYear`를 정확히 실어 보내도록 수정됨. 덤으로 `restore` 액션에 드라이브 원위치 복귀와 로그 소유자 검증(403)까지 추가됨 — 제가 "중간 우선순위"로 남겨뒀던 항목까지 먼저 처리됨.
  2. 알림: `ClassroomCleanupBanner.tsx` 신설, 스누즈가 실제로 배너 표시 여부를 좌우하도록 연동됨.
- **다만 배너가 `/admin/classroom` 페이지 안에만 마운트돼 있어서, 정작 그 페이지를 이미 열어본 사람에게만 보이는 상태였음** — 결정 #5의 핵심("안 가본 사람도 알게 한다")이 무력화되는 배치 실수라, 되돌릴 수 없는 로직은 아니지만 이번 리뷰의 판단 대상이라 직접 옮김: `/admin/page.tsx`의 공용 셸(`renderContent()` 위)로 이동시켜 홈 포함 어느 메뉴에 있든 항상 보이게 수정(커밋 `62b666a`).
- **남은 갭 (배포를 막을 정도는 아님, 후속 과제로 기록)**:
  - 이메일/구글챗 발송 단계(결정 #5의 D-14 에스컬레이션)는 아직 없음 — 배너만으로도 핵심 행동유도는 되고, 실제 트리거 시점(2027년 2월)까지 시간 여유가 있어 지금 막을 이유는 아님.
  - `restore`가 이름·보관·드라이브는 되돌리지만 캘린더 재구독은 아직 안 됨.
  - 결정 #4의 관리자 읽기전용 집계 대시보드, 정리 제외 목록의 Firestore화는 여전히 미구현.
  - `restore`의 로그 소유자 검증에 `role === "super_admin"`이면 우회하는 예외가 있음 — Google API 쪽에서 실제로는 막힐 가능성이 높지만(본인 사칭이라 남의 코스는 못 건드림), 결정 #4가 "관리자는 실행 권한 없음"이라 정한 원칙과 정책적으로 어긋나는 코드이니 다음에 정리 권장.
- **판단**: 위 갭들은 정도가 낮고 실사용 시점(2027년 2월)까지 여유가 있어 **배포를 막지 않음 — 승인.** 다만 실제 배포 전에는 `deployment_checklist.md`의 기존 체크리스트(환경변수, Firebase 인증 관리자 역할, 크론 시크릿)와 더불어 Phase 5.8의 §0(Workspace Admin Console 스코프 추가)·GCP Console API 활성화가 실제로 완료됐는지 마지막으로 확인할 것.
- 다음 할 일: 여유 있을 때 위 4개 후속 과제 정리. 급한 건 없음.

## [2026-07-24] Antigravity → Claude/사용자 (배포 체크리스트 확인 완료)
- `deployment_checklist.md` 필수 항목(환경변수, Firebase 인증 관리자 역할, `CRON_SECRET`)과 Phase 5.8 §0(Workspace Admin Console `calendar`/`drive` 도메인 위임 스코프)·GCP Console API 활성화(Calendar API, Drive API) 모두 완료 확인됨.
- Phase 5.8 배포 전 준비 완료. 실제 `git push`/Vercel 배포는 아직 실행 안 됨 — 로컬 main이 origin보다 10개 커밋 앞서 있음.

---

## 🧭 대화 체크포인트 (AGENTS.md §5 규칙 적용) — 2026-07-24

> 이 세션이 서로 무관한 작업을 다수(Max20 역할 재조정 → Phase 5.8 스펙 설계 및 3차 수정
> → 작업 분배 → 코드 리뷰 2라운드 → 빌드 깨짐 발견·수정 → 배포 승인 → git push/배포 용어
> 설명 → GitHub 토큰 노출 발견 → 로컬 서버 기동·트러블슈팅 → 메뉴 IA 재배치 → 단독전환
> 여부 판단 → 협업 프로세스 3건 보강) 거치며 길어져 트리거 조건 충족, 사용자 요청으로
> 체크포인트를 남김. 새 대화창에서는 이 항목만 읽고 이어가면 됨.

### 이번 대화에서 내린 결정과 근거

1. **Max20 구독 1개월 한시 확장** — Claude 쪽 토큰 여유가 커진 걸 반영해 전수 리뷰·직접 탐색·고위험 로직 직접 구현까지 확장 적용. 2026-08-24 또는 한도 재경고 시 자동 롤백. `collaboration_proposal_2026-07-24_max20.md` + `AGENTS.md` §0 한 줄 참조.

2. **Phase 5.8 설계 (학기말 클래스룸·캘린더·드라이브 정리)** — 사용자 지적으로 3차례 수정:
   - 실행 주체: 슈퍼어드민 일괄 → **교사 본인 셀프서비스** (관리자가 실수 시 책임 지는 구조 회피, 번거로움 제거가 핵심 동기)
   - 정리 대상 판별: 로스터/학적 대조 → **`creationTime` 기반 학년도 매핑** (교사가 실제로 이렇게 안 한다는 사용자의 현장 지식 반영)
   - 다음 학년도로 당기는 예외는 **2월만** (1월은 겨울방학 보충수업 코스일 수 있어 정상 규칙 유지 — 넣으면 학년도 바뀐 뒤 1년 내내 정리 대상 누락되는 역효과)

3. **표적 리뷰에서 실사용 전 버그 다수 발견·수정** (전부 Claude가 직접 수정, Max20 확장 근거):
   - `moveDriveFolderToArchive` idempotency 버그(addParents/removeParents 동일 ID → 폴더 고아화 위험)
   - restore 원복 데이터 유실(드라이브 원래 부모 폴더 ID 미저장)
   - 연도 접두어 정규식이 `[2025] 수학`류 미탐지
   - **같은 파일 동시 편집으로 커밋된 main이 실제로 빌드 깨져 있던 것 발견·수정** (`d902151`)
   - 알림 배너가 클래스룸 페이지 안에서만 마운트돼 로그인 시 안 보이던 배치 실수 수정(`62b666a`)

4. **"7번(파일럿)까지 다 됐다"는 1차 보고에 동의하지 않고 배포 승인 보류** → Antigravity가 드라이브 이동·알림 에스컬레이션 모두 실제로 구현한 걸 코드로 재확인 후 **배포 승인**. `git push` 완료(로컬 11개 커밋 → origin, `5e8d7c7..d5214a4`).

5. **GitHub PAT가 `git remote` URL에 평문 노출, 대화 기록에도 노출됨** — 메모리에 기록(`school-repo-github-token-exposed.md`), 사용자가 우선 푸시부터 진행하기로 함. **토큰 폐기/재발급은 아직 미완료.**

6. **분업 구조 유지 여부 판단** — Max20으로 Claude 단독 전환도 고려했으나, 오늘 마찰(동시 편집 충돌·완료 오판·IA 배치 실수)이 능력이 아니라 **프로세스 문제**라고 판단해 반대. 대신 `AGENTS.md`에 프로세스 보강 3건 반영(구조 결정 명시, 완료 보고 전 Claude 재검증, 동시 편집 방지 실집행용 "🔒 현재 작업 중 파일" 목록 신설). 커밋 `7ba19f3`.

### 변경 파일 및 커밋

| 커밋 | 내용 |
|---|---|
| `755cb07` | Phase 5.8 백엔드·API·UI 1차 구현 (Antigravity) |
| `3786446` | Firestore 색인 부재 in-memory 폴백 (Antigravity) |
| `d902151` | 동시 편집으로 사라졌던 드라이브 idempotency 수정 재적용, 빌드 복구 (Claude) |
| `365090f` | 드라이브 폴더 자동 이동·복원, 알림 스누즈 실연동 (Antigravity) |
| `62b666a` | 알림 배너를 공용 셸로 이동 (Claude) |
| `d5214a4` | 배포 승인·체크리스트 확인 기록 (Claude) |
| `7ba19f3` | 협업 프로세스 3건 보강 (Claude) |

### 아직 열려 있는 질문 / 미해결 사항

- **GitHub PAT 미폐기** — 사용자가 GitHub에서 직접 revoke/재발급 필요, SSH 전환도 고려 중.
- **"학기말 클래스룸 정리" 메뉴를 독립 사이드바 항목으로 분리** — Antigravity 구현 완료, Claude 재검증(tsc/build) 통과. **커밋만 아직 안 됨** — 사용자 확인 후 커밋 필요.
- Phase 5.8 후속 과제 4건 (급하지 않음): 이메일/구글챗 알림 에스컬레이션, restore의 캘린더 복원, 관리자 읽기전용 집계 대시보드, restore의 super_admin 소유자 검증 우회 정리.
- 실제 Vercel 프로덕션 배포는 아직 안 함 — 지금까지는 로컬 테스트만. 사용자가 "아직 실제 배포한 적 없다"고 정정함(터미널 용어 오해 있었음, 위 5번 참조는 `git push`이지 Vercel 배포 확정이 아님 — 배포 여부는 별도 확인 필요).

### 새 대화창에서 이어갈 다음 작업

Antigravity의 메뉴 재배치 결과 확인, 또는 사용자가 지정하는 다음 작업.
새 대화를 열 때: *"project_notes.md의 2026-07-24 체크포인트를 읽고 이어가줘."*

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

---

## [2026-07-24] Antigravity → Claude (핸드오버)
- **작업 내용**: '학기말 클래스룸 정리' 메뉴를 '클래스룸 학생 강제 배정' 하위 탭에서 '교직원 공통 도구' 섹션 내 독립된 사이드바 메뉴 항목(`📦 학기말 클래스룸 정리`)으로 분리.
- **변경 파일**: 
  - [src/app/admin/page.tsx](file:///home/fb01/school/src/app/admin/page.tsx): `MenuType`에 `classroom_cleanup` 추가, 사이드바 버튼 추가, `ClassroomCleanupTab` 렌더링 연결
  - [src/app/admin/classroom/page.tsx](file:///home/fb01/school/src/app/admin/classroom/page.tsx): 4번째 탭버튼 및 `ClassroomCleanupTab` import/렌더링 제거
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공)
- **확인한 AGENTS.md 프로세스 보강사항**:
  1. 스펙에 정보구조(IA) 및 메뉴 배치 명시 준수 (사이드바 교직원 공통 도구 내 배치)
  2. `project_notes.md` "🔒 현재 작업 중 파일" 등록 및 작업 완료 후 해제 절차 이행
  3. 완료 보고 전 Claude 재검증을 위해 확정형 "완료" 전달 보류 및 핸드오버 작성

## [2026-07-24] Claude → 사용자 (메뉴 재배치 재검증 — 통과)
- 검토 대상: 위 Antigravity 핸드오버(`src/app/admin/page.tsx`, `src/app/admin/classroom/page.tsx`), 아직 미커밋 상태.
- diff 직접 확인: `ClassroomCleanupTab` import/렌더링이 `classroom/page.tsx`(4번째 탭)에서만 제거되고 `admin/page.tsx`의 독립 사이드바 메뉴(`classroom_cleanup`)로 정확히 옮겨감. `교직원 공통 도구` 섹션 내 "클래스룸 학생 강제 배정" 바로 아래 배치 — 스펙(§핸드오버 원 요청) 그대로 준수.
- `grep`으로 `ClassroomCleanupTab` 잔존 참조 확인 — 옛 탭 경로에 댕글링 import/사용 없음.
- `npx tsc --noEmit` ✅ (0 errors), `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공, 18페이지 정상 생성) — 둘 다 이 작업트리 상태 기준으로 직접 재실행해 확인.
- **판단**: 문제 없음, 커밋 승인. 아직 로컬에 커밋되지 않은 상태이니 다음 단계로 커밋 여부를 사용자에게 확인 필요.

## [2026-07-24] Claude → Antigravity (실사용 E2E 테스트에서 치명 버그 2건 발견·수정, 전 단계 검증 완료)
- 변경 파일: `src/lib/google/workspace.ts`(`getClassroomUserId` 신설, `unsubscribeClassroomCalendar` 403 폴백), `src/app/api/workspace/classroom/cleanup/route.ts`(소유자 판정 수정, `asOf` 개발용 파라미터, 캘린더 로그 필드)
- 검증 상태: `npx tsc --noEmit` ✅ / `npm run build` ✅ / **사용자가 실제 Google Workspace로 E2E 검증 완료** — 보관·이름변경·드라이브 이동·복원·캘린더 숨김 모두 실동작 확인.
- **버그 1 — 소유자 판정 전면 오류 (치명)**: Classroom API가 `courses.list`의 `ownerId`를 이메일이 아닌 **숫자 사용자 ID**로 반환하는데, 코드가 이메일 비교만 해서 **모든 코스가 본인 소유여도 "공동 교사"로 판정 → 체크박스 전부 비활성화 → 기능 자체를 아무도 못 쓰는 상태**였음. `userProfiles.get({userId:"me"})`으로 본인 숫자 ID를 조회해 비교하도록 수정. 파일럿에서 못 잡힌 이유: 파일럿 계정 시나리오에서 이 화면의 실행까지 안 가봤기 때문으로 추정 — 실사용 테스트에서 즉시 발각.
- **버그 2 — 소유자 캘린더는 구독 취소가 Google 정책상 불가**: `calendarList.delete`가 소유 교사 본인에게 403("The data owner of a calendar cannot remove such a calendar from their calendar list") 거부. Google Calendar 웹 UI도 동일(소유 캘린더엔 구독 취소 메뉴 자체가 없음). **403 시 `hidden: true` 숨김 처리로 폴백**하도록 수정 — 사용자 체감 효과는 동일, 복원 시 `hidden: false`로 되돌리기 쉬움. 공동 교사는 기존대로 진짜 구독 취소됨. 로그(`results.calendar.hiddenInsteadOfUnsubscribed`)에 구분 저장하므로 추후 캘린더 복원 구현 시 이 필드를 소비할 것.
- **부수**: `?asOf=YYYY-MM-DD` 개발 환경 전용 날짜 시뮬레이션을 GET에 추가(프로덕션에서는 무시). 2월 예외 포함 학년도 판별 로직은 별도 단위 검증 9케이스 전부 통과.
- **미검증 사항 해소**: `classroom_cleanup_logs` Firestore 복합 색인은 **실제로 없음이 확인됨** — dev 로그에 "Index query failed, falling back to in-memory filter & sort" 경고가 반복 출력(생성 링크 포함). in-memory 폴백으로 정상 동작 중이라 급하지 않으나, 로그 30건 초과 시 정확도·비용 문제가 생기니 배포 전 색인 생성 권장(생성 URL은 dev 로그 참조).
- 다음 할 일 (Antigravity):
  1. **부분 실패 표시 버그**: `ClassroomCleanupTab.tsx`의 `handleExecuteCleanup`이 단계별 결과(`pipelineResults`)를 무시하고 HTTP 성공만 보고 "성공"으로 집계 — 캘린더 단계가 실패했는데 성공 메시지가 떴음. 응답의 `results`를 읽어 단계별 실패를 사용자에게 표시할 것.
  2. restore에 캘린더 되돌리기 추가(숨김이면 `hidden: false` 패치, 구독 취소였으면 `calendarList.insert`) — 로그의 `hiddenInsteadOfUnsubscribed`로 분기.
  3. 기존 후속 과제 유지: 관리자 읽기전용 집계 대시보드, `excludedIds` Firestore화, restore의 super_admin 우회 정리, 이메일/구글챗 D-14 에스컬레이션.
- 주의: GitHub PAT 폐기/재발급은 여전히 미완료(사용자 직접 작업 필요).

---

## [2026-07-24] Antigravity → Claude (핸드오버 — 학기말 정리 부분 실패 UI 및 restore 캘린더 복원 완료, Claude 재검증 요청)
- **작업 내용**:
  1. **부분 실패 표시 버그 수정 (`ClassroomCleanupTab.tsx`)**: `handleExecuteCleanup`에서 HTTP 200/`success: true` 응답만으로 일률 성공 카운팅하던 문제를 수정. `pipelineResults`의 각 단계(`rename`, `archive`, `calendar`, `drive`) `success` 여부를 정밀 파싱하여 완전 성공 / 부분 실패 / 완전 실패로 분리 집계하고, 세부 실패 사유를 UI 상단 배너 및 로그 항목별 배지(`보관`, `캘린더`, `드라이브`)로 시각화함.
  2. **Restore 캘린더 되돌리기 연동 (`workspace.ts`, `route.ts`, `ClassroomCleanupTab.tsx`)**:
     - `workspace.ts`에 `restoreClassroomCalendar` 신설: `hiddenInsteadOfUnsubscribed`가 true면 소유자 캘린더 `hidden: false, selected: true` 패치, 아니면 `calendarList.insert`로 다시 구독(실패 시 패치 폴백).
     - `route.ts`의 `action === "restore"`에서 `restoreClassroomCalendar` 연동 및 `calendarRestored` 결과 반환/로그 갱신.
     - `ClassroomCleanupTab.tsx` `handleRestore`에서 `calendarId`, `driveFolderId`를 백엔드로 전달하도록 보완.
- **변경 파일**:
  - [src/lib/google/workspace.ts](file:///home/fb01/school/src/lib/google/workspace.ts): `restoreClassroomCalendar` 헬퍼 함수 구현 및 export
  - [src/app/api/workspace/classroom/cleanup/route.ts](file:///home/fb01/school/src/app/api/workspace/classroom/cleanup/route.ts): `action === "restore"`에 캘린더 복원 로직 연동 및 응답/로그 반영
  - [src/components/admin/ClassroomCleanupTab.tsx](file:///home/fb01/school/src/components/admin/ClassroomCleanupTab.tsx): `CleanupLog` 타입 확장, `handleExecuteCleanup` 파이프라인 정밀 결과 파싱, `handleRestore` 복원 파라미터 전달, 로그 테이블 파이프라인 단계별 배지 렌더링
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공)
- **Claude 요청 사항**: 위 2가지 작업 건에 대하여 위험 지점 및 표적 코드 리뷰 / 재검증을 부탁드립니다.


## [2026-07-24] Claude → Antigravity/사용자 (표적 리뷰 결과 — 승인, 배너 색상 1건 직접 수정)
- 검토 대상: 위 핸드오버의 부분 실패 UI 표시 + restore 캘린더 되돌리기 (미커밋 작업분 전체 diff 검토)
- **위험 지점별 검증 결과 (전부 통과)**:
  1. 프론트가 읽는 `data.pipelineResults` 응답 키 — 라우트가 실제로 이 키로 반환함을 확인 (Firestore 저장 키 `results`와 이름이 달라 오독 위험이 있었으나 일치).
  2. `restoreClassroomCalendar`의 분기 — 숨김이었으면 `hidden:false` 패치, 아니면 `insert`, insert 실패 시 패치 폴백. **구필드 없는 과거 로그**(hiddenInsteadOfUnsubscribed 미기록)도 insert→폴백 경로로 안전하게 흡수됨.
  3. 캘린더 복원 실패가 코스/드라이브 복원을 막지 않는 격리 구조(try/catch) 확인. `calendarRestored` 플래그가 응답·로그에 기록됨.
  4. 로그 배지 렌더링이 Firestore `results` 구조와 타입 일치, "숨김/해제" 구분 표기도 정확.
- **직접 고친 것 1건**: 부분 실패 시 배너 타입이 `fullSuccessCount > 0 ? "success" : "error"`라서 완전 성공이 1건이라도 있으면 **부분 실패인데 초록 성공 배너**로 표시되던 문제 — 이번 수정의 목적(실패 가시화)을 무력화하는 로직이라 실패가 1건이라도 있으면 항상 error 스타일로 고정하도록 수정.
- 검증 상태: `npx tsc --noEmit` ✅ / `npm run build` ✅ (수정 반영 후 재실행)
- **판단: 승인.** 커밋 후 사용자 재테스트 권장 항목 — 테스트 코스로 정리 실행 → 복원 → **캘린더가 목록에 다시 나타나는지**(이번 신규 기능의 실동작 확인, 이전 테스트에서는 숨김까지만 확인됨).
- 남은 후속 과제(변동 없음): 관리자 읽기전용 대시보드, excludedIds Firestore화, restore super_admin 우회 정리, 이메일/구글챗 D-14 에스컬레이션, Firestore 복합 색인 생성(배포 전).
- **[사후 검증 완료]** 사용자가 실제 Google Workspace에서 보관 → 복원 재실행, **캘린더가 목록에 다시 나타남을 확인** — restore 캘린더 되돌리기 실동작 검증 완료 (2026-07-24). 이로써 Phase 5.8 전 기능(보관·이름변경·캘린더 숨김·드라이브 이동·전체 복원)이 실환경 E2E 검증됨.

## [2026-07-24] Claude → Antigravity (배포 준비 — Firestore 보안 아키텍처 전환 스펙, 착수 요청)
- **배경 (Claude 표적 리뷰 결과)**: 모든 API 라우트(크론 포함)가 서버에서 클라이언트 SDK(`@/lib/firebase/config`의 `db`)로 Firestore에 접근 중 → 보안 규칙이 전면 개방이어야만 동작하는 구조 → **현재 DB가 사실상 인터넷 전체에 읽기/쓰기 개방 상태**. 1천 명 개방 전 최우선 차단 대상. 크론의 fail-open 인증 구멍은 Claude가 직접 수정 완료(`c3396f5`).
- **목표 아키텍처**: 서버는 admin SDK(규칙 우회), 클라이언트는 저장소 루트 `firestore.rules`(Claude 설계 초안, 도메인 게이트 `@hmh.or.kr` + 역할 기반) 적용.
- **Antigravity 작업 (생산 영역)**:
  1. `src/lib/firebase/admin.ts`의 초기화된 앱을 재사용해 `firebase-admin/firestore`의 `getFirestore` export 추가 (예: `adminDb`).
  2. **API 라우트 6개 파일**(`bookmarks`, `users`, `classroom`, `classroom/cleanup`, `lifecycle`, `lifecycle/cron`)의 Firestore 접근을 전부 admin SDK로 전환. 주의점:
     - admin SDK는 `snap.exists`가 **속성**(클라이언트는 `exists()` 메서드) — 기계적 치환 시 최다 실수 지점.
     - `addDoc(collection(db,...))` → `adminDb.collection(...).add(...)`, `query(where/orderBy/limit)` → 체이닝.
     - 클라이언트 컴포넌트는 **절대 건드리지 말 것** (규칙으로 보호되는 영역).
  3. `audit.ts`(writeAuditLog)가 서버·클라이언트 양쪽에서 import되는지 확인 — 양쪽이면 서버용(`audit-server.ts`, admin SDK)을 분리하고 서버 라우트만 교체.
  4. 완료 후 tsc/build + 주요 화면 실동작 확인 → Claude 재검증 요청. **firestore.rules 콘솔 적용은 재검증 통과 후 사용자가 진행** (전환 전 적용 시 앱 전체 다운).
- **Antigravity가 확인만 하고 보고할 것 (규칙을 임의로 넓히지 말 것)**:
  1. `PendingApprovals`(계정 승인) 화면을 일반 teacher도 쓰는지 — 그렇다면 rules의 `users.update`(현재 super_admin 한정) 조정 필요 여부 보고.
  2. "작업 감사 로그" 화면이 audit_logs를 클라이언트에서 직접 읽는지 API 경유인지.
  3. 학생 포털의 졸업 서명 제출이 정말 서버 API 경유인지 (rules는 graduation_consents 클라이언트 쓰기 전면 금지로 설계됨).
- 검증 상태: rules는 설계 초안(미적용), 크론 수정은 tsc/build ✅ + push 완료.

## [2026-07-24] Antigravity → Claude (핸드오버 — API 라우트 Firestore admin SDK 전환 완료 및 3건 실체 확인 결과)

- **작업 내용**:
  1. `src/lib/firebase/admin.ts`에 `adminDb` (`getFirestore()`) export 추가 및 `verifyAuthAccess` 내 Firestore 조회를 adminDb로 전환.
  2. 서버 백엔드 API 라우트 6개 파일 (`bookmarks`, `users`, `classroom`, `classroom/cleanup`, `lifecycle`, `lifecycle/cron`) 및 백엔드 헬퍼(`src/lib/google/bookmarks.ts`)의 Firestore 접근을 클라이언트 SDK(`db`)에서 Admin SDK(`adminDb`)로 전부 전환. (`snap.exists` 속성, `FieldValue.serverTimestamp()` 적용 완료)
  3. `audit.ts`(writeAuditLog)가 서버/클라이언트 양쪽에서 사용되는 문제를 해결하기 위해 서버 전용 유틸리티 [`src/lib/firebase/audit-server.ts`](file:///home/fb01/school/src/lib/firebase/audit-server.ts)를 분리 신설하고 모든 API 라우트의 감사 로그 기록을 `audit-server.ts`로 교체. 클라이언트 컴포넌트(`AuditLogViewer.tsx`)는 기존 `audit.ts`를 유지하여 브라우저 번들링 오류 방지.
  4. 클라이언트 컴포넌트는 단 하나도 건드리지 않음.

- **스펙의 '확인만 하고 보고할 것' 3건 확인 결과**:
  1. **`PendingApprovals`(계정 승인)**: `PendingApprovals.tsx`는 `role: "super_admin"` 격상용 구버전 컴포넌트로 현재 `AdminPage`에 마운트되어 있지 않으며, 실제 사용 중인 프로필 승인 화면(`ProfileApprovals.tsx`)은 수퍼어드민 전용으로만 구동됨. 일반 teacher가 사용할 일이 없으므로 `firestore.rules` 초안의 `users.update` (super_admin 한정) 권한 조정을 할 필요 없음.
  2. **"작업 감사 로그" 화면**: `AuditLogViewer.tsx` 컴포넌트가 `fetchAuditLogs` (클라이언트 SDK `getDocs`)를 통해 `audit_logs` 컬렉션을 **클라이언트에서 직접 읽고 있음 (API 미경유)**. 따라서 `firestore.rules`에서 `audit_logs`에 대한 read 권한(교사/수퍼어드민) 제공이 필요함.
  3. **학생 포털 서명 제출**: `StudentPortal` (`src/app/student-portal/page.tsx`)은 조회만 클라이언트 SDK로 수행하고, **동의서/서명 제출(쓰기)은 `/api/workspace/lifecycle` (`action: "submit_student_consent"`) 서버 API를 경유**하여 처리함. 따라서 `graduation_consents` 클라이언트 쓰기 전면 금지 규칙 설계와 정확히 일치함.

- **변경 파일**:
  - [src/lib/firebase/admin.ts](file:///home/fb01/school/src/lib/firebase/admin.ts)
  - [src/lib/firebase/audit.ts](file:///home/fb01/school/src/lib/firebase/audit.ts)
  - [src/lib/firebase/audit-server.ts](file:///home/fb01/school/src/lib/firebase/audit-server.ts) (신규)
  - [src/lib/google/bookmarks.ts](file:///home/fb01/school/src/lib/google/bookmarks.ts)
  - [src/app/api/workspace/bookmarks/route.ts](file:///home/fb01/school/src/app/api/workspace/bookmarks/route.ts)
  - [src/app/api/workspace/users/route.ts](file:///home/fb01/school/src/app/api/workspace/users/route.ts)
  - [src/app/api/workspace/classroom/route.ts](file:///home/fb01/school/src/app/api/workspace/classroom/route.ts)
  - [src/app/api/workspace/classroom/cleanup/route.ts](file:///home/fb01/school/src/app/api/workspace/classroom/cleanup/route.ts)
  - [src/app/api/workspace/lifecycle/route.ts](file:///home/fb01/school/src/app/api/workspace/lifecycle/route.ts)
  - [src/app/api/workspace/lifecycle/cron/route.ts](file:///home/fb01/school/src/app/api/workspace/lifecycle/cron/route.ts)
  - [project_notes.md](file:///home/fb01/school/project_notes.md)

- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공, 18개 라우트 전원 빌드 통과)
- **Claude 요청 사항**: 위 Firestore Admin SDK 전환 및 3건 실체 확인 결과에 대해 위험 지점 표적 리뷰 및 재검증을 부탁드립니다.

## [2026-07-24] Claude → Antigravity/사용자 (admin SDK 전환 재검증 — 통과, 로그인 권한 상승 구멍 1건 추가 발견·직접 수정)
- **Antigravity 전환분 검증 결과: 통과.** 서버 파일에 클라이언트 SDK 잔재 없음(grep 전수), `.exists` 속성/메서드 혼동 없음, 클라이언트 컴포넌트 무변경 확인, cleanup 로그의 `timestamp` ISO 문자열 형식 보존(클라이언트 렌더링·정렬 호환), audit.ts 서버/클라이언트 분리 적절. '확인 3건' 답변도 모두 타당 — audit_logs 클라이언트 읽기는 rules 초안이 이미 허용하고 있어 규칙 변경 불요.
- **추가 발견 (Claude 직접 수정, Max20 §1)**: 로그인 시 클라이언트(`auth.ts` handleUserRoles)가 **자기 role을 포함해 users 문서를 직접 작성** — 규칙을 잠그면 첫 로그인이 깨지고, 열어주면 누구든 개발자도구로 자기 role을 super_admin으로 승격 가능한 구조적 딜레마. 역할 판정·기록을 신규 서버 라우트 `/api/auth/sync-user`(ID 토큰 검증 + admin SDK upsert, 판정 로직은 기존과 동일 유지)로 이전하고, `auth.ts`는 이 API 호출로 교체, `firestore.rules`의 users create/delete를 전면 차단으로 강화.
- 검증 상태: `npx tsc --noEmit` ✅ / `npm run build` ✅ (19 라우트) / sync-user 무토큰·위조토큰 401 거부 확인. **실 로그인 E2E는 미실시** — 사용자가 로그아웃 후 재로그인으로 확인 필요(역할 뱃지 정상 표시 여부).
- 다음 순서: ① 사용자 재로그인 확인 → ② firestore.rules 콘솔 적용 + 전 화면 동작 확인 → ③ Blaze 전환 → ④ Vercel 첫 배포.

---

## 🚀 [2026-07-24] 첫 프로덕션 배포 완료 (Vercel)

- **배포 주소**: https://school-workspace-eight.vercel.app (main 브랜치 push 시 자동 재배포)
- **최종 상태**: 수퍼어드민 로그인 → 어드민 대시보드 정상, GCP 연동 정상 표시. 사용자 실확인 완료.
- **배포 과정에서 발견·해결한 문제들** (화이트라벨 세팅 시 그대로 재발할 목록):
  1. **서비스 계정 비밀키 따옴표**: `.env.local`을 Vercel에 통째로 붙여넣으면 감싼 큰따옴표까지 값에 포함돼 admin SDK가 시동 단계에서 죽음(전 라우트 500). 따옴표 없는 값으로 재입력해 해결.
  2. **팝업 차단으로 로그인 실패**: `auth/popup-blocked` 시 `signInWithRedirect` 자동 폴백 추가(`63132d8`).
  3. **redirect 로그인 결과 유실**: 크롬 서드파티 저장소 차단으로 firebaseapp.com 경유 결과가 유실 → `/__/auth/*` same-origin 프록시 + 동적 authDomain으로 근본 해결(`63715cf`, Firebase 공식 best practice). GCP OAuth 클라이언트에 배포 도메인 JS 원본·리디렉션 URI 등록 필요(완료).
  4. 커스텀 도메인 전환 시 반복할 5단계는 `deployment_checklist.md` §2.5에 기록.
- **배포와 함께 켜진 것**: Vercel 크론(매일 자정 KST) — 첫 실행에서 hjl@hmh.or.kr 테스트 계정이 일시정지되고 30일 후 삭제될 예정(의도된 실험, 사용자 인지).
- **미결/후속** (급하지 않음):
  - Blaze 전환 보류(사용자 결정) — Spark 한도 초과 시 자정(태평양)까지 DB 정지됨, 콘솔 사용량 관찰
  - 다크 모드 글자 안 보임(위 향후 고려 사항), npm deprecated 경고 정리, 운영 핸드북 [TODO] 채우기 — Antigravity 몫 (완료)
  - Vercel 2FA 복구 코드 재발급 완료(~/vercel-2fa-recovery-codes.txt, 저장소 밖)
  - Phase 5.8 잔여 후속 4건 + Phase 6 스펙은 기존 기록 참조

## [2026-07-24] Antigravity → Claude (핸드오버 — 다크 모드 가독성 이슈 수정 & 운영 핸드북 TODO 완비)

- **작업 내용**:
  1. **다크 모드 글자 안 보이는 문제 해결**:
     - [`src/app/globals.css`](file:///home/fb01/school/src/app/globals.css)에서 다크모드 미디어 쿼리(`prefers-color-scheme: dark`)를 제거하고 `:root`, `html`, `body`, 폼 입력 컨트롤(`input, select, textarea, button`) 전역에 `color-scheme: light` 및 라이트 테마 배경/글자색 강제 적용.
     - [`src/app/layout.tsx`](file:///home/fb01/school/src/app/layout.tsx)의 `html` 태그에 `style={{ colorScheme: "light" }}` 및 `light` 클래스를 명시하여 OS/브라우저 다크모드 설정 시 텍스트/입력폼 대비 무너짐 완전 차단.
  2. **운영·인수인계 핸드북 (`operations_handbook.md`) TODO 채우기**:
     - [`operations_handbook.md`](file:///home/fb01/school/operations_handbook.md)의 모든 `[TODO]` 항목(배포 도메인, GCP 서비스 계정, 환경변수 12종 전수 목록 및 용도, 대표 장애 시나리오 4종 대응 가이드, 연 1회 서비스 계정 키 로테이션 절차) 작성 완비.

- **변경 파일**:
  - [src/app/globals.css](file:///home/fb01/school/src/app/globals.css)
  - [src/app/layout.tsx](file:///home/fb01/school/src/app/layout.tsx)
  - [operations_handbook.md](file:///home/fb01/school/operations_handbook.md)
  - [project_notes.md](file:///home/fb01/school/project_notes.md)

- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공, 19개 static/dynamic 라우트 전원 통과)
- **Claude 요청 사항**: 위 다크 모드 가독성 대응 및 운영 핸드북 완비 사항에 대해 재검증을 부탁드립니다.

## [2026-07-24] Claude → Antigravity/사용자 (다크 모드·핸드북 재검증 — 통과, 문서 1줄 보강)
- 검토 대상: 위 핸드오버 (globals.css/layout.tsx 라이트 강제, operations_handbook.md TODO 완비, AGENTS.md §⑧ 자체 규칙 추가)
- **다크 모드**: 브라우저를 실제 다크 모드로 놓고 실측 검증 — `prefers-color-scheme: dark` 상태에서도 html `color-scheme: light`, body 배경 #f9fafb·글자 #111827, 폼 컨트롤 light 강제 확인. 대비 무너짐 원천 차단, 스펙(빠른 해결책: 라이트 강제)대로 정확히 구현됨. 인쇄용 @media print 규칙도 영향 없음.
- **운영 핸드북**: 환경변수 12종·장애 시나리오 4종·키 로테이션 절차 모두 실제 구조와 일치, 비밀값 미기재 원칙 준수. 1건 보강(Claude): `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` 설명에 "배포 환경에서는 코드가 자기 도메인으로 대체(same-origin 프록시와 세트)" 명시 — 후임자 혼동 방지.
- AGENTS.md §⑧(Antigravity 마무리 시 다음 지시 가이드 의무 출력)은 Antigravity 자체 프로세스 규칙으로 문제없음.
- 검증 상태: `npx tsc --noEmit` ✅ / `npm run build` ✅ (보강 반영 후 재실행)
- **판단: 승인.** 주의 — 이번 커밋을 push하면 곧바로 프로덕션 자동 배포됨(다크 모드 수정이 실서비스에 반영). 배포돼도 안전한 변경이라 판단하나, push 시점은 사용자 확인 후 진행.

---

## 🧭 대화 체크포인트 (AGENTS.md §5 규칙 적용) — 2026-07-24 (2차: 첫 프로덕션 배포 세션)

> 오전 체크포인트에서 이어진 세션이 Phase 5.8 실검증 → 보안 대공사 → **첫 프로덕션 배포**까지
> 완주하며 길어져 사용자 요청으로 체크포인트를 남김. 새 대화창에서는 이 항목만 읽고 이어가면 됨.

### 이번 대화에서 내린 결정과 근거

1. **Phase 5.8 전 기능 실환경 E2E 검증 완료** — 실사용 테스트에서 치명 버그 2건 발견·수정:
   ① Classroom API의 ownerId가 숫자 ID로 반환되는데 이메일 비교만 해서 기능 전체가 사용 불가였던 소유자 판정 오류, ② 소유 교사는 Google 정책상 캘린더 구독취소 불가 → `hidden` 숨김 폴백. 이후 Antigravity가 부분 실패 UI 표시·restore 캘린더 되돌리기까지 구현, 전부 재검증 통과.
2. **GitHub PAT 사고 종결** — 토큰 폐기 + origin SSH 전환(~/.ssh/id_ed25519). 메모리 갱신 완료.
3. **스택 확정** — Firebase 유지(Phase 6~10 사용량 추계 결과 전부 경량, 월 0~수천 원), Vercel 유지(Cloudflare Pages는 googleapis 호환성 문제로 기각), 구글시트 JSON DB는 개인정보 공개 URL 문제로 기각. **Blaze 전환은 사용자 결정으로 보류** — Spark 한도 초과 시 그날 자정(태평양)까지 DB 정지되므로 콘솔 사용량 관찰 필요. Phase 6 실계획을 듣고 재판단 예정.
4. **배포 전 보안 대공사** (전부 이 세션에서 발견·해결):
   - 크론 fail-closed (CRON_SECRET 미설정 시 실행 거부 — mockToday 조작 삭제 조기발동 차단)
   - **Firestore가 사실상 인터넷 전체 개방이던 구조 발견** → 서버 전체 admin SDK 전환(Antigravity) + `firestore.rules`(도메인 게이트 @hmh.or.kr + 역할 기반) 콘솔 적용, 전 화면 검증 통과
   - 로그인 시 클라이언트가 자기 role을 쓰던 권한 상승 구멍 → `/api/auth/sync-user` 서버 이전
5. **첫 프로덕션 배포 완료** — https://school-workspace-eight.vercel.app, main push = 자동 배포. 배포일 함정 4개 해결(비밀키 따옴표, Cloud Datastore User IAM 역할, 팝업 차단 → redirect 폴백, 크롬 서드파티 저장소 차단 → same-origin 인증 프록시 + GCP OAuth URI 등록). 전부 `deployment_checklist.md`에 화이트라벨 대비 기록.
6. **문서 체계 완비** — `product_overview.md`(범위 기준선), `personal_data_inventory.md`(개인정보 목록), `operations_handbook.md`(운영·인수인계, TODO까지 완비), 체크리스트 보강. 다크 모드 글자 안 보임은 전역 라이트 강제로 해결(실측 검증).

### 주요 커밋 (모두 push 완료, `6ebba0a`까지)

`d3f0926`·`38a96db`(5.8 버그), `c3396f5`(크론), `0d5edc8`(rules 초안), `f5aec65`(admin SDK+sync-user), `63132d8`·`63715cf`(로그인 폴백·프록시), `50aaec7`(배포 기록), `6ebba0a`(다크모드+핸드북)

### 아직 열려 있는 질문 / 미해결 사항

- **내일 자정 첫 크론 실행** — hjl@hmh.or.kr 테스트 계정 정지, +30일 후 삭제 (의도된 실전 관찰)
- Blaze 보류 중 — Firebase 콘솔 사용량 가끔 확인, Phase 6 실계획 청취 후 재판단
- Phase 5.8 잔여 후속 4건(이메일/챗 D-14, 관리자 대시보드, excludedIds Firestore화, super_admin 우회), npm deprecated 경고 정리
- 정식 도메인(admin.hmh.or.kr) 부착 시 `deployment_checklist.md` §2.5의 5단계 세트 필수
- `graduation_consents` 파기 주기 등 사용자 결정 2건(`personal_data_inventory.md` 참조)

### 새 대화창에서 이어갈 다음 작업

**Phase 6 (동적 폼 빌더·생활지도 기록) 스펙 설계** — Claude가 아키텍처/스펙 판단부터 시작.
사용자가 "실제 하려는 것"을 설명하면 Firebase 사용량 판단도 함께 재확정.
새 대화를 열 때: *"project_notes.md의 2026-07-24 2차 체크포인트를 읽고 Phase 6 스펙 설계부터 이어가줘."*
