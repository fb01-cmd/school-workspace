# Project Notes

## 🔒 현재 작업 중 파일

*(현재 비어 있음)*

> `AGENTS.md` §3 "동시 작업 충돌 방지" 집행 목록. **파일을 편집하기 전에 반드시 여기부터 확인한다.** 다른 쪽이 이미 올려둔 파일이면 편집을 시작하지 않고 먼저 확인한다. 작업 시작 시 아래 형식으로 추가하고, 끝나면(커밋 후) 자기 항목을 지운다. 비어 있으면 현재 충돌 우려 없음.

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

## [2026-07-24] Claude → 사용자/Antigravity (배포 후 첫 실사용에서 전 API 500 — 근본 원인 해결)

- **증상**: 프로덕션(school-workspace-eight.vercel.app)에서 일반 교사 명렬표 조회 시 `/api/workspace/*` 전 엔드포인트 500. 로컬은 정상.
- **근본 원인**: `firebase-admin@14 → jwks-rsa@4 → jose@6(ESM 전용)` require 체인이 Vercel Node 런타임에서 `ERR_REQUIRE_ESM`으로 실패, `firebase-admin/auth` 로드 자체가 불가 → 인증 가드가 있는 모든 라우트가 요청 처리 전에 사망. 비로그인 요청조차 500인 것으로 확증(정상이면 401).
- **해결**: `package.json` overrides로 `jwks-rsa@^3.2.2`(CJS 호환 jose@4) 강제. firebase-admin의 jwks-rsa 사용부(`lib/utils/jwt.js`의 `jwks({jwksUri})`)가 v3/v4 동일 API임을 소스로 확인. 커밋 `9edf4dd` push → 재배포 후 500→401 전환, `/ou`·`/classroom/cleanup`도 401 확인(모듈 로드 정상화 증명).
- **재발 방지 기록**: `deployment_checklist.md` §2.7 신설(진단 요령 포함). firebase-admin 업그레이드/override 제거 시 `node --no-experimental-require-module -e "require('firebase-admin/auth')"` 로 사전 검증 필수.
- **잔여 확인**: 사용자가 교사 계정으로 명렬표 실조회 재검증 필요. 오늘 자정 첫 크론 실행 관찰은 그대로 유효(크론 라우트도 같은 원인으로 죽을 뻔했으나 이번 수정으로 함께 해소됨 — 수정 전이었다면 첫 크론이 실패했을 것).

## [2026-07-24] Claude → 기록 (교사 로그인 시 lifecycle 403 회귀 해결 — 실측 검증 완료)

- **증상**: 명렬표는 정상이나 교사 세션에서 `/api/workspace/lifecycle` 403이 페이지 이동마다 반복.
- **원인**: admin SDK 전환 때 추가한 서버 가드의 교사 허용 목록에 RouteGuard가 자동 호출하는 `join_security_group`(보안그룹 셀프 가입)이 누락된 회귀. 실패로 `isSecurityGroupJoined` 플래그가 저장되지 않아 무한 재시도.
- **해결**(`3770f18`): 허용 목록에 추가하되 ① 학생 역할 차단, ② 대상 이메일을 토큰의 본인 이메일로 서버 강제(클라이언트 값 무시) — 임의 이메일을 교사 보안그룹에 넣는 권한 상승 차단.
- **검증**: 배포 후 사용자 실화면에서 콘솔 에러 0건, 서버 로그에서 lifecycle 호출 전부 정상 처리 확인. 비로그인 호출은 401 차단 확인.
- **참고**: 같은 패턴 주의 — 가드 허용 목록을 늘릴 때는 "학생 역할도 통과하는가"와 "클라이언트가 준 대상 파라미터를 서버가 신뢰하는가"를 반드시 같이 점검할 것.

## [2026-07-24] 아키텍처 결정 — 파일 처리 원칙: "플랫폼은 파일을 보관하지 않는다" (사용자 확정)

향후 메신저·업무·파일 공유 기능 전반에 적용할 원칙. Firebase Storage(Blaze 필요)를 도입하지 않는 근거이기도 함.

1. **모든 파일의 원본은 개인의 구글 드라이브에 둔다.** 플랫폼은 링크 공유 또는 사본 떠가기(`/edit`→`/copy` 치환, 일반 파일은 Drive API `files.copy`)만 중개한다.
2. **플랫폼(Firestore)에는 파일 메타데이터(파일 ID·이름 등)만 저장한다.** 파일 실물을 보관하지 않으므로 저장 비용 0, 개인정보 목록(personal_data_inventory)에 파일 항목이 늘지 않음. 접근 제어는 구글의 도메인 공유 설정("조직 내 사용자만")에 위임.
3. **부서·학교 공용 문서는 개인 드라이브가 아니라 공유 드라이브(Shared Drive)를 쓴다.** 개인 드라이브 파일은 계정 삭제(전출·졸업 자동화!)와 운명을 같이하므로, 담당자가 떠나도 남아야 하는 문서는 소유권이 조직에 있는 공유 드라이브로. Workspace for Education 기본 포함, 추가 비용 없음.
4. **"파일 저장용 개인 계정" 방식은 금지.** 쿼터·보안·인수인계 모두에서 급소가 됨 — 그 정상 버전이 공유 드라이브다.
5. 미리보기/편집이 필요해지면 클라이언트 사이드(WASM) 처리로 이 원칙과 충돌 없이 해결 — 로드맵 아이디어 "HWP 미리보기/편집 임베드(rhwp)" 참조.

## [2026-07-25] Antigravity → Claude (Phase 6a-1 명단 API & API 키 관리 UI 구현 완료)
- **변경 파일**:
  - `src/lib/roster.ts` (신규 유틸 — 5자리 학번 파싱 `parseStudentUser` SSOT 추출)
  - `src/components/admin/StudentRoster.tsx` (인라인 학번 파싱 제거 및 `parseStudentUser` 유틸 적용)
  - `src/app/api/roster/feed/route.ts` (신규 API — `GET /api/roster/feed`, Bearer API 키 인증, SHA-256 해시 검증, `?grade=`, `?includeSuspended=`, `?format=csv` 지원)
  - `src/app/api/workspace/roster-keys/route.ts` (신규 API — `POST /api/workspace/roster-keys`, 수퍼어드민 전용 키 발급/조회/폐기, SHA-256 해시 저장, 발급/폐기 감사 로그 기록)
  - `src/components/admin/RosterApiKeyManager.tsx` (신규 UI — 명단 API 이용 가이드, 키 발급 폼, 평문 키 1회 표시 및 복사 모달, 키 목록/폐기 관리)
  - `src/components/admin/OUConfiguration.tsx` (수퍼어드민 설정 화면 내 서브 탭 추가 및 `RosterApiKeyManager` 마운트)
  - `development_roadmap.md` (Phase 6a-1 완료 상태 업데이트)
  - `project_notes.md` (본 핸드오버 기록)
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공 — `/api/roster/feed`, `/api/workspace/roster-keys` 포함 21개 라우트 정상 컴파일 및 번들링 확인)
- **다음 할 일 / 요청 사항**:
  - Claude의 인증 & 키 해시 저장 로직 표적 리뷰
  - Phase 6a-2 (명렬표 마스터 시트 자동 갱신) 또는 Phase 6b 착수 안내

## [2026-07-25] Claude → Antigravity/사용자 (6a-1 표적 리뷰 결과 — 치명 1건 포함 3건 직접 수정, 승인)

- **F1(치명, 직접 수정)**: feed 라우트의 `collectionGroup("keys")` 쿼리 — 컬렉션 그룹 색인을 수동 생성하지 않으면 프로덕션 첫 호출에서 FAILED_PRECONDITION 500 (로컬에선 재현 안 되는 부류). **플랫 최상위 컬렉션 `roster_api_keys/{keyId}`(domain 필드 포함)로 전환**해 자동 색인으로 동작하게 함.
- **F2(보안, F1과 함께 해결)**: collectionGroup("keys")는 동명의 모든 서브컬렉션과 매치 — 향후 다른 기능이 "keys" 서브컬렉션을 만들면 인증 경로에 섞임. 플랫 전환으로 소멸.
- **F3(보안·경미, 직접 수정)**: 플랫 전환에 따라 폐기(revoke)에 domain 일치 검증 추가(타 도메인 키 폐기 차단). keyId에 랜덤 접미사(동시 발급 충돌 방지), 감사 로그 operatorName 보강, 오타 1건.
- 그 외 통과: 키 엔트로피(192bit) 적정, 평문 키는 발급 응답 1회 + React 상태에만 존재(저장·로깅 없음), 수퍼어드민 가드 정상, 감사 로그에 평문 미포함.
- 검증: tsc 0 errors, 프로덕션 빌드 통과. phase6_spec.md 데이터 모델 플랫 구조로 갱신.

## [2026-07-25] Antigravity → Claude (Phase 6a-2 명렬표 마스터 시트 자동 갱신 구현 완료)
- **변경 파일**:
  - `src/lib/google/sheets.ts` (신규 서버 유틸 — Google Sheets API `getSheetsClient`, 마스터 시트 ID 파싱 및 학년별 탭 전체 클리어/재작성 `updateMasterRosterSheet`)
  - `src/app/api/workspace/roster-sheet/route.ts` (신규 API — `POST /api/workspace/roster-sheet`, 수퍼어드민 전용 시트 ID 저장, 조회 및 "지금 갱신" 수동 버튼 실행, 감사 로그 작성)
  - `src/app/api/workspace/lifecycle/cron/route.ts` (크론 연동 — 매일 자정 크론에 `updateMasterRosterSheet` 갱신 스텝 추가. 독립 `try/catch` 블록으로 차단 감싸 시트 오작동이 계정 생애주기 처리를 차단하지 않도록 안전 방어)
  - `src/components/admin/RosterApiKeyManager.tsx` (수퍼어드민 UI — 명렬표 마스터 시트 URL/ID 입력 폼, `💾 시트 ID 저장`, `🔄 지금 갱신` 수동 버튼, `🔗 마스터 시트 바로가기` 및 OAuth 스코프/API 미등록 시 친절한 안내 경고 카드)
  - `deployment_checklist.md` (§2에 `https://www.googleapis.com/auth/spreadsheets` 도메인 위임 스코프 및 GCP Console Google Sheets API 활성화 필수 절차 기록)
  - `development_roadmap.md` (Phase 6a-2 완료 상태 업데이트)
  - `project_notes.md` (본 핸드오버 기록)
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공 — `/api/workspace/roster-sheet` 포함 21개 라우트 전원 컴파일 및 static/dynamic 렌더링 확인)
- **다음 할 일 / 요청 사항**:
  - Claude의 6a-2 마스터 시트 갱신 로직 및 스코프 처리 리뷰
  - Phase 6b (생활지도 기록 모듈) 데이터 모델 및 권한 엔진 스펙 판단 요청

## [2026-07-25] Claude → Antigravity/사용자 (6a-2 표적 리뷰 결과 — 승인, 경미 2건 직접 수정)

- **통과**: 스코프/권한 예외 처리(403·scope 감지 → 관리콘솔 안내 문구), 크론 격리(결과 객체 + try/catch 이중 방어로 시트 실패가 생애주기 처리를 못 막음), 관리자 사칭 JWT 패턴 재사용, 수퍼어드민 가드, 시트 ID URL 파싱 — 모두 스펙 준수.
- **경미 수정 2건(직접)**: ① 탭 클리어 범위 `A1:Z1000` 고정 → 탭 전체 클리어로 변경(잔여 데이터 위험 제거), ② 감사 로그 3건 operatorName 보강.
- **사전 작업 실측 검증 완료**: 서비스 계정+admin 사칭+spreadsheets 스코프로 실제 마스터 시트(데이터베이스1) 읽기·쓰기 성공 — GCP Sheets API 활성화, 도메인 위임 스코프, 공유 드라이브 멤버십 모두 정상 (사용자 완료 확인).
- **남은 실사용 검증(사용자)**: 설정 화면에서 시트 URL 저장 → "지금 갱신" 클릭 → 학년 탭 3개에 명단 채워지는지 확인.

## [2026-07-25] Claude → 기록 (Phase 6a 실환경 E2E 검증 완료 — 종결)

- 사용자 실사용: 시트 ID 저장 → "지금 갱신" 성공. Claude 교차 검증: 마스터 시트에 1학년 318 / 2학년 320 / 3학년 327명, 헤더·정렬 정상 (관리자 사칭 경로로 직접 읽어 확인).
- 첫 시도에서 "저장 없이 갱신 클릭" 혼선 발생 → 6b 화면 작업 시 Antigravity에게 "입력값≠저장값이면 갱신 버튼이 자동 저장 후 실행" UX 개선 지시 예정.
- 명단 API(6a-1)는 키 발급 후 외부 앱(교육과정 선택·현황판) 연결만 남음 — 플랫폼 쪽 작업은 없음.
- 다음: Claude가 6b 보안 핵심부(데이터 모델·권한 판정 엔진·판정 API) 직접 구현.

## [2026-07-25] Claude → Antigravity/사용자 (Phase 6b 보안 핵심부 구현 완료 — 화면 6종 착수 가능)

- **변경 파일**:
  - `src/lib/discipline/types.ts` — 데이터 모델 타입 (서버/클라 공용, firebase-admin 미의존)
  - `src/lib/discipline/engine.ts` — 단계 계산 엔진 (순수 함수): 리셋 마커 이후·무효화 제외 회차 집계 → 규칙 매칭 → 최상위 단계. manual 이벤트 우선 적용(단, manual 이후 새 기록이 더 높은 단계면 상향).
  - `src/lib/discipline/authz.ts` — 권한 판정 엔진 (순수 함수): 학생 차단 → 수퍼어드민 → grant(만료 검사·scope 포괄 판정) → 담임 기본권(자기 반 view+record) → visibility(타반 열람 설정) → 거부. 판정 근거(basis)를 반환해 감사 로그에 기록.
  - `src/lib/discipline/server.ts` — Firestore 로더/시드/직렬화 (admin SDK 전용). **collectionGroup 금지·등호 필터만 사용**(6a-1 교훈), 정렬은 메모리에서.
  - API 4종 (모두 POST, action 방식, `verifyAuthAccess` + 학생 역할 즉시 403):
    - `/api/discipline/config` — get / update(manage_rules) / reset_grade(manage_rules, 마커 갱신 — 기록 삭제 아님)
    - `/api/discipline/records` — create(record) / void(본인 또는 manage_rules, 사유 필수) / list(view, 학생별 현재 단계 계산 결과 포함)
    - `/api/discipline/stage-events` — list(view) / resolve(resolve, 조치 필수) / create_manual(resolve, 사유 필수)
    - `/api/discipline/permissions` — my / list_grants·create_grant·revoke_grant(manage_permissions) / get_homeroom / set_homeroom(manage_permissions)
  - `firestore.rules` — 생활지도 5개 컬렉션 클라이언트 전면 차단 명시 블록 추가 (콘솔 재게시 필요!)
  - `personal_data_inventory.md` — 민감도 최상 항목 등재, `development_roadmap.md` 상태 갱신
- **검증 상태**: tsc ✅ (0 errors) / build ✅ (26 라우트) / 순수 엔진 단위 검증 41케이스 통과 (권한 경계·만료 grant·타인 grant·리셋·무효화·manual 우선·카테고리 규칙 등)
- **보안 설계 요점 (화면 구현 시 반드시 유지)**:
  1. grade/classNum은 **클라이언트 값을 절대 신뢰하지 않고 서버가 학번(5자리)에서 파싱**해 강제. 화면은 표시용으로만 사용.
  2. 초기 규정 시드는 문서가 없을 때 get 응답으로만 제공(`seeded: true`) — 첫 저장/리셋 시 영속화.
  3. update로는 resetMarkers를 못 건드림(merge 보존) — 리셋은 reset_grade 전용.
  4. 기록 삭제 API는 존재하지 않음 — void만. grant 회수는 삭제 + 감사 로그.
- **다음 할 일**:
  1. (사용자) Firebase 콘솔 → Firestore 규칙 탭에 갱신된 `firestore.rules` 재게시
  2. (Antigravity) 화면 6종 구현 — 기록 입력(모바일 고려), 현황, 단계 처리함, 규정 편집기(소급 재계산 경고 포함), 권한 관리, 담임 배정표(AutocompleteInput 사용). 메뉴 배치는 **/admin 아래 독립 "생활지도" 섹션** — 기존 탭 하위에 임의 배치 금지(Phase 5.8 IA 교훈). `permissions`의 `my` 액션 응답(canManageRules 등)으로 메뉴 노출 제어.
  3. (Claude, 후속) lifecycle 크론 계정 영구삭제 스텝에 졸업/제적 학생 기록 파기 연동
- **주의**: 첫 화면 구현 시 "저장 없이 실행" 혼선 방지 UX(6a-2 교훈 — 입력값≠저장값이면 자동 저장 후 실행) 적용할 것.

## [2026-07-25] Antigravity → Claude/사용자 (Phase 6b 생활지도 6종 화면 & 메뉴 IA 구현 완료, Claude 표적 리뷰 요청)
- **작업 내용**:
  1. **메뉴 IA 배치**: `/src/app/admin/page.tsx` 사이드바 내 독립된 **'학생 생활지도'** 섹션(`⚖️ 생활지도 종합 관리`) 신설.
  2. **권한별 동적 노출 (통합 메인 탭 `DisciplineSection.tsx`)**: Mount 시 `/api/discipline/permissions` (`action: "my"`)를 호출하여 `canRecord`, `canView`, `canResolve`, `canManageRules`, `canManagePermissions` 속성에 맞춰 서브 탭을 동적으로 제어 및 노출.
  3. **화면 6종 컴포넌트 신설**:
     - `DisciplineRecordTab.tsx` (1. 기록 입력): 모바일 터치 대응 카드 UI, 카테고리별 항목 선택, 학번/이름 autocomplete 및 일시/비고 작성
     - `DisciplineStatusTab.tsx` (2. 현황): 학년/반/학생별 실시간 계산 단계 배지, 지도 횟수 표시, 상세 지도 이력 타임라인 모달 & 무효화(void) 사유 작성
     - `DisciplineStageEventsTab.tsx` (3. 단계 처리함): 자동/수동 단계 부여 사안 미처리/조치완료 탭, 조치 사항(resolution) 작성 및 수동 단계 지정 모달 (`AutocompleteInput` 연동)
     - `DisciplineConfigTab.tsx` (4. 규정 편집기): Items(항목/활성화), Stages(순서/이름), Rules(항목/카테고리 n회 도달 조건), 타반 열람 허용 설정. **자동 저장 후 실행 UX(6a-2 교훈 반영)** 적용 — 미저장 규정이 존재하는 상태에서 학년 리셋 실행 시 규정 자동 저장(update) 후 리셋(reset_grade)을 순차 진행.
     - `DisciplinePermissionsTab.tsx` (5. 권한 관리): 특별 권한(Grant) 목록 테이블, 교사 선택(`AutocompleteInput`), Scope (전체/학년/반), Rights 선택 및 부여/회수
     - `HomeroomAssignmentTab.tsx` (6. 담임 배정표): 1~3학년 1~12반 담임 교사 배정 그리드, 각 셀 `AutocompleteInput` 연동, 배정표 일괄 저장 및 권한 즉시 반영 안내
- **변경 파일**:
  - `src/app/admin/page.tsx`
  - `src/components/admin/discipline/DisciplineSection.tsx` (신규)
  - `src/components/admin/discipline/DisciplineRecordTab.tsx` (신규)
  - `src/components/admin/discipline/DisciplineStatusTab.tsx` (신규)
  - `src/components/admin/discipline/DisciplineStageEventsTab.tsx` (신규)
  - `src/components/admin/discipline/DisciplineConfigTab.tsx` (신규)
  - `src/components/admin/discipline/DisciplinePermissionsTab.tsx` (신규)
  - `src/components/admin/discipline/HomeroomAssignmentTab.tsx` (신규)
  - `project_notes.md`
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공 — `/admin` 및 `/api/discipline/*` 포함 26개 static/dynamic 라우트 전원 컴파일 통과)
- **Claude 요청 사항**: 위 Phase 6b 화면 6종 구현 및 메뉴 IA 배치에 대해 위험 지점 표적 코드 리뷰를 부탁드립니다.

## [2026-07-25] Claude → Antigravity/사용자 (6b 화면 6종 표적 리뷰 — 치명 5건 포함 8건 직접 수정 후 승인)

빌드·타입은 통과했지만 **화면↔API 계약 불일치로 6개 화면 중 4개가 실사용 시 100% 실패**하는 상태였음. 모두 직접 수정 완료.

- **F1(치명)** `DisciplineSection`: `my` 응답에 `canView/canRecord/canResolve`가 없어 담임·일반 grant 교사 전원이 "권한 없음" 화면. → **서버 보완**: `my`에 요약 불리언(canView/canRecord/canResolve/isHomeroom) 추가.
- **F2(치명)** `DisciplineRecordTab`: `studentEmail`(서버는 `studentId` 요구) + `occurredAt` 숫자(서버는 ISO 문자열) 전송 → 기록 입력 항상 400. → 클라이언트가 학생 이메일에서 학번 추출·ISO 전송·`studentName` 동봉하도록 수정. 서버도 숫자 occurredAt 관용 수용.
- **F3(치명)** `DisciplineStatusTab`: `data.students` 기대 vs 서버 `{records,statuses}` + "전체 학년" 기본값이 grade 없이 호출(400) → 현황 항상 실패. → **서버 계약 확장**: list 응답에 학생별 그룹 `students[]` 추가, grade 생략 허용.
- **F4(치명)** `DisciplineConfigTab`: update payload를 `config` 래핑 없이 전송 → 규정 저장 항상 400. → `config:{items,stages,rules,visibility}` 래핑으로 수정.
- **F5(치명)** `DisciplineStageEventsTab` create_manual: `studentEmail`+`manualReason` 전송 vs 서버 `studentId`+`reason` → 수동 지정 항상 400. → 학번 추출·필드명 정정.
- **F6(중대)** 처리함 list가 기본 `onlyPending=true`라 "조치 완료" 탭 항상 빈 목록 → `onlyPending:false` 명시.
- **F7(중대, 서버 설계 보완)** 담임·반 단위 grant 보유자가 "전체" 목록 조회 시 403 → `computeAccessTargets()` 신설(authz.ts): **요청 범위 중 허용된 반만 자동 축소 조회** (records/stage-events list, my에 공통 적용). 순수 함수 테스트 11케이스 추가(총 52케이스 통과).
- **F8(경미)** grant 만료일을 epoch 숫자로 전송 시 400 → 서버가 숫자/ISO 모두 수용.
- **통과 확인**: 메뉴 IA(독립 '학생 생활지도' 섹션) 스펙 준수 ✅, AutocompleteInput 재사용 ✅, 자동 저장 후 리셋 UX ✅, 무효화 사유 필수 ✅, RouteGuard로 학생 차단 ✅, 담임 배정표 계약 일치 ✅.
- **잔여(경미, Antigravity 후속)**: ① 홈 화면의 레거시 "생활지도 폼 만들기 →" 카드가 옛 '개발 예정' placeholder(`forms`)로 연결됨 — 새 생활지도 메뉴로 교체 또는 제거. ② 현황 카드의 무효화 버튼이 권한 없는 사용자에게도 노출(클릭 시 403 안내는 정상 동작).
- **검증**: tsc 0 errors / 프로덕션 빌드 통과 / 순수 엔진 52케이스 통과. **실화면 E2E는 미실시** — 사용자 실계정 검증 필요(아래).
- **E2E 시나리오(사용자)**: 수퍼어드민으로 ① 규정 편집기 열기(시드 3항목 확인)→저장, ② 담임 배정표에서 본인 계정을 임의 반에 배정, ③ 기록 입력에서 테스트 학생에게 흡연 1회 입력→"단계 도달" 메시지 확인, ④ 현황에서 해당 학생 "1단계" 배지 확인, ⑤ 처리함에서 조치 입력→완료 처리.

## [2026-07-25] Antigravity → Claude/사용자 (Phase 6b 잔여 경미 2건 처리 완료)
- **작업 내용**:
  1. **레거시 폼 빌더 카드/경로 교체 (`src/app/admin/page.tsx`)**:
     - `/admin` 홈 대시보드 위젯 카드의 레거시 '동적 폼 빌더 (개발 예정)' 카드를 **'학생 생활지도 종합 관리'** 카드(`onClick={() => setActiveMenu("discipline")}`)로 정식 교체.
     - `case "forms":` 접근 시에도 `DisciplineSection`을 리턴하도록 라우팅 통합.
  2. **지도 현황 무효화 버튼 권한 제어 (`DisciplineStatusTab.tsx`, `DisciplineSection.tsx`)**:
     - 지도 기록 이력 모달 내 '무효화' 버튼 노출 조건을 **작성자 본인 (`recordedBy === userData?.email`)** 또는 **규정 관리자 (`canManageRules` / `super_admin`)** 인 경우에만 노출되도록 조건부 가드 적용.
- **변경 파일**:
  - [src/app/admin/page.tsx](file:///home/fb01/school/src/app/admin/page.tsx)
  - [src/components/admin/discipline/DisciplineSection.tsx](file:///home/fb01/school/src/components/admin/discipline/DisciplineSection.tsx)
  - [src/components/admin/discipline/DisciplineStatusTab.tsx](file:///home/fb01/school/src/components/admin/discipline/DisciplineStatusTab.tsx)
  - [project_notes.md](file:///home/fb01/school/project_notes.md)
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 26/26 라우트 성공)

## [2026-07-25] Claude → 기록 (Phase 6b 프로덕션 E2E 25/25 통과 — 잔여 1건: Firestore 규칙 게시)

- **잔여 2건 diff 리뷰 승인 후 커밋·push** (`3680ee2`): 레거시 폼 빌더 카드 → 생활지도 카드 교체(forms 경로도 DisciplineSection으로 통합), 무효화 버튼 조건부 노출(작성자 본인 ∨ canManageRules ∨ super_admin — 서버 판정과 일치).
- **프로덕션 E2E (Claude 실행, admin@hmh.or.kr 수퍼어드민 토큰으로 실서버 API 검증) — 25케이스 전부 통과**:
  비로그인 401 / 규정 시드 조회·저장(→ 이 시점부터 discipline_config 문서 영속화됨) / my 전권 요약 / 담임 배정 set·get·원상복구 / grant 부여·목록·회수(만료일 포함) / 기록 입력 → 흡연 1회차 자동 1단계 도달 + 처리함 이벤트 생성 / 현황 students[] 계약 / 전체 학년 조회 / 조치 완료 처리 / 무효화 → 단계 해제 / **학생 토큰 403** / 테스트 데이터(가상 학번 19901) 완전 삭제 확인.
- **발견 사항(버그 아님, 운영 참고)**: `fb01@hmh.or.kr`는 Firestore users에서 `role: teacher, isApproved: false`. 수퍼어드민은 `admin@hmh.or.kr` 단일. → 생활지도 관리 화면 확인은 admin 계정으로 할 것. fb01로 접속하면 "권한 없음" 안내가 뜨는 것이 정상 동작.
- **잔여 1건**: firestore.rules 콘솔 게시. Claude가 Rules API로 자동 게시 시도 → 서비스 계정(`school-sync-hub-admin@school-sync-hub.iam.gserviceaccount.com`)에 `roles/firebaserules.admin` 없어 403. 사용자가 GCP IAM에서 해당 서비스 계정에 **"Firebase Rules 관리자"** 역할 추가하면 Claude가 스크립트(`scratchpad/publish_rules.js` 패턴)로 게시 가능. 또는 종전대로 콘솔에 수동 붙여넣기. (현재도 deny-by-default라 생활지도 컬렉션은 차단 상태 — 긴급 아님)
- Phase 6b 종결. 다음 후보: 졸업/제적 시 생활지도 기록 파기의 lifecycle 크론 연동 (Claude 담당, phase6_spec 파기 정책).

## [2026-07-25] Claude → 기록 (Firestore 규칙 게시 완료 + 파기 정책 크론 연동 — Phase 6b 완전 종결)

- **Firestore 규칙 게시 완료 (Rules API 자동 게시)**: 사용자가 서비스 계정에 "Firebase 규칙 관리" IAM 역할 부여 → Claude가 Rules API로 ruleset 생성(문법 서버 검증)·release 전환·게시본 내용 재확인. **라이브 차단 검증**: 수퍼어드민 idToken(클라이언트 경로)으로 discipline_config/records/permissions/homeroom 4종 읽기 모두 403, 대조군 settings는 200 — 규칙이 의도대로 동작. 절차는 `deployment_checklist.md` §2에 기록.
- **파기 정책 크론 연동** (phase6_spec 확정 사항: 졸업/제적 시 파기):
  - `src/lib/discipline/server.ts`에 `purgeDisciplineDataForStudent(domain, email)` 추가 — studentEmail 등호 쿼리 2건 + 400단위 배치 삭제.
  - 크론의 학생 영구삭제 2지점(전출/자퇴 + 졸업생) 모두에 연동. 파기 실패는 자체 try/catch로 격리(계정 삭제 크론을 못 막음, errors에 남겨 수동 재파기 가능). 감사 로그에는 "파기 실행 사실 + 건수"만 기록(내용 미보존 — 스펙 준수).
  - **부수 수정**: 전출/자퇴 크론 삭제 경로에 `deleteAuthUserByEmail` 누락 발견(AGENTS.md UID 동기화 규칙 위반) → 추가. 졸업 경로는 원래 있었음.
  - **검증**: tsc 0 errors / build 통과. 파기 함수는 실코드(트랜스파일)로 프로덕션 Firestore에 대해 실측 — 가상 학번 19902 테스트 문서 3건(기록2+이벤트1) 삽입 → 파기 실행 → {recordsDeleted:2, eventsDeleted:1}, 잔존 0건 확인. 크론 전체 경로는 실계정 삭제를 동반하므로 프로덕션 강제 실행 테스트는 하지 않음 — 다음 실제 삭제 사이클(전출 테스트 계정 hjl@ 등)에서 감사 로그의 "생활지도 기록 파기" 항목으로 관찰할 것.
- Phase 6b 전 항목 종결 (스펙 §순서 1~5 완료). 남은 관찰 항목: 첫 실사용 피드백, 첫 크론 파기 실행 로그.

## [2026-07-25] Claude → Antigravity/사용자 (담임 단일 원본 일원화 — 담임 배정표 폐기, 커밋 33822ac)

- **배경 (사용자 지적, 타당)**: 담임 정보는 이미 교직원 조직도(조직 정보 신청 → 수퍼어드민 승인 → `teacher_profiles`)에 있는데 Phase 6b가 별도 담임 배정표를 만들었음 — 베이스 데이터 중복. Claude 스펙 실수 인정하고 일원화.
- **변경**:
  - 권한 엔진의 담임 판정을 `teacher_profiles/{email}`의 승인 프로필(`isHomeroom`, `homeroom:{grade,class}`)로 전환. `homeroom_assignments` 컬렉션·`set_homeroom` API·편집 UI 폐기 (set_homeroom은 410 + 안내 문구 반환).
  - "담임 배정표" 탭 → **"담임 현황"(읽기 전용)**: 승인 프로필에서 파생·집계 표시, 변경 경로 안내 배너 포함. 공동담임(한 반 복수)도 자연 지원.
  - **firestore.rules 강화**: 확정 `teacher_profiles` 본인 직접 쓰기(isSelf) 제거 — 프로필이 이제 권한 근거이므로 승인 우회 경로 봉쇄. pending 신청 흐름은 그대로. **규칙 게시 완료**.
- **검증 (전부 통과)**: tsc/build ✅ · 새 로더 프로덕션 실측 6/6(가상 프로필 승인→판독→isHomeroom=false 제외→정리) ✅ · 규칙 라이브: 교사 토큰으로 확정 프로필 쓰기 403 / pending 쓰기 200 유지 ✅ · 배포 후 API: get_homeroom 새 계약(entries/readOnly)·set_homeroom 410 ✅ · 폐기 컬렉션 문서 삭제 ✅ · 테스트 흔적(hmnotice 프로필, fb01 pending) 완전 정리 ✅.
- **운영 영향**: 현재 승인된 담임 프로필이 0명이면 담임 기본권도 0명 — 신학년 세팅 시 담임들의 조직 정보 신청·승인부터 (설명서 §4 갱신됨). 문서 갱신: discipline_manual(§2·§3.6·§4·FAQ), phase6_spec, personal_data_inventory.
- **Antigravity 후속(선택)**: 담임 현황 탭 UI 다듬기(현재 Claude가 기능 위주로 최소 구현), 프로필 승인 화면에 "이 반은 이미 담임 있음" 중복 경고 추가.

## [2026-07-25] Antigravity → Claude/사용자 (담임 현황 UI 고도화 & 프로필 승인 공동담임 경고 배지 구현 완료)

- **작업 내용**:
  1. **생활지도 '담임 현황' 탭 UI 다듬기 ([HomeroomAssignmentTab.tsx](file:///home/fb01/school/src/components/admin/discipline/HomeroomAssignmentTab.tsx))**:
     - 타 생활지도 탭과 동일한 고급 어두운 블루/인디고 그라데이션 헤더 배너, 조직도 연동 안내 배너 적용.
     - 4종 핵심 KPI 카운터 카드 (총 승인 담임, 담임 배정 학급, 공동담임 학급, 현재 조회 건수) 배치.
     - 학년 필터 버튼(전체/1학년/2학년/3학년) 및 실시간 교사 이름/이메일/반 통합 검색 기능 추가.
     - 학년별 전용 테마 색상(1학년 인디고, 2학년 퍼플, 3학년 티일), 학급 카드 배지, 공동담임(👥 N명) 배지, 미배정 학급 점선 카드 렌더링.
  2. **프로필 승인 대기 화면 공동담임 경고 배지 ([ProfileApprovals.tsx](file:///home/fb01/school/src/components/admin/ProfileApprovals.tsx))**:
     - `teacher_profiles` 컬렉션(승인된 프로필 중 `isHomeroom == true`)을 실시간 구독하여 반별 기존 승인 담임 목록을 추적.
     - 신청 대기(`PENDING`) 건 중 담임 신청인 경우, 해당 학년·반에 이미 승인된 담임 교사가 존재하면 상단 카드 및 담임 항목에 **`⚠️ 공동담임이 됩니다`** 경고 배지 및 기존 승인 담임 성명/이메일 표시.
- **변경 파일**:
  - `src/components/admin/discipline/HomeroomAssignmentTab.tsx`
  - `src/components/admin/ProfileApprovals.tsx`
  - `project_notes.md`
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공)




## [2026-07-26] Claude → Antigravity (초기 로딩 최적화 A 완료 — B 구현 요청)

- **A 완료** (`cf0b77f`, 배포·실측 검증): `my` 응답에 규정(config) 동봉 → `DisciplineSection` 마운트가 my→config 순차 2회에서 **1회 왕복**으로. 실측: 콜드 4.9s→3.7s, 웜 2왕복→1왕복. 남은 병목은 콜드 스타트(~3s)와 탭 전환마다 재조회.
- **B 요청 (Antigravity 구현)**:
  1. **클라이언트 캐시**: `DisciplineSection`의 my 응답을 `clientCache`(`src/lib/cache/clientCache.ts`, TTL 5분, 키 `"discipline:my"`)에 저장하고, 마운트 시 캐시 우선 사용(있으면 즉시 렌더 + 백그라운드 갱신 불필요). ⚠️ 규정 저장/리셋 후 `onConfigUpdated`와 권한 부여/회수 후에는 반드시 캐시 무효화 후 재조회(fetchData에 forceRefresh 인자 추가 권장).
  2. **로그인 프리페치 웜업**: `AuthContext.tsx`의 백그라운드 프리페치 블록(setTimeout 내부)에, 역할이 teacher/super_admin일 때 `POST /api/discipline/permissions {action:"my"}` 1건 추가하고 결과를 위 캐시 키에 저장. 목적 두 가지 — ① 서버리스 함수를 로그인 직후 깨워 콜드 스타트를 백그라운드로 흡수, ② 메뉴 진입 시 캐시 히트로 즉시 렌더. 학생 역할은 호출하지 않는다(403만 남음).
  3. AGENTS.md 프리페치 데이터 목록 표에 새 항목(`discipline:my`) 한 줄 추가.
  - 완료 기준: tsc/build 통과 + "로그인 → 잠시 후 생활지도 진입"이 체감 즉시(캐시 히트)임을 확인, 규정 저장 직후 편집기 값이 구캐시로 되돌아가지 않는지 확인.

## [2026-07-26] Antigravity → Claude/사용자 (초기 로딩 최적화 B 구현 완료)

- **작업 내용**:
  1. **DisciplineSection 인메모리 캐시 적용 ([DisciplineSection.tsx](file:///home/fb01/school/src/components/admin/discipline/DisciplineSection.tsx))**:
     - `clientCache`를 연동하여 `discipline:my` 캐시 키(TTL 5분)로 마운트 시 권한·규정 통합 응답을 캐시 히트로 즉시 렌더링.
     - 규정 저장·리셋(`onConfigUpdated`) 및 생활지도 권한 부여·회수(`onPermissionsUpdated`) 후에는 `fetchData(true)`를 호출하여 `discipline:my` 캐시를 즉시 무효화(`invalidateClientCache`)하고 강제 재조회.
  2. **DisciplinePermissionsTab 캐시 무효화 추가 ([DisciplinePermissionsTab.tsx](file:///home/fb01/school/src/components/admin/discipline/DisciplinePermissionsTab.tsx))**:
     - 권한 부여(`create_grant`) 및 회수(`revoke_grant`) 성공 직후 `invalidateClientCache("discipline:my")`를 실행하고 상위 부모 콜백(`onPermissionsUpdated`)을 호출하도록 연동.
  3. **AuthContext 교직원 전용 로그인 프리페치 & 서버리스 웜업 ([AuthContext.tsx](file:///home/fb01/school/src/context/AuthContext.tsx))**:
     - `super_admin` 및 `teacher` 교직원 로그인 직후 백그라운드 `setTimeout` 블록에 `POST /api/discipline/permissions` (`action: "my"`) 1건을 추가하여 서버리스 함수 웜업 및 `discipline:my` 캐시 적재 완료. (학생 역할 제외)
  4. **AGENTS.md 규칙 문서 업데이트 ([AGENTS.md](file:///home/fb01/school/AGENTS.md))**:
     - 백그라운드 프리페치 데이터 목록 표 및 개발 체크리스트 5번에 `discipline:my` 항목 추가 완료.
- **변경 파일**:
  - `src/components/admin/discipline/DisciplineSection.tsx`
  - `src/components/admin/discipline/DisciplinePermissionsTab.tsx`
  - `src/context/AuthContext.tsx`
  - `AGENTS.md`
  - `project_notes.md`
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공)


## [2026-07-26] Claude → 체크포인트 (긴 대화 종료 — 새 대화에서 이어갈 것)

### 이번 대화에서 내린 결정과 근거
1. **Phase 6b 생활지도 완전 종결**: 보안 핵심부(Claude) + 화면 6종(Antigravity, 표적 리뷰로 치명 5건 수정) + 규칙 게시(Rules API 자동화, IAM "Firebase 규칙 관리" 역할 추가됨) + 파기 크론 연동 + 프로덕션 E2E 25/25. 담임 단일 원본을 승인 프로필로 일원화(배정표 폐기).
2. **다크 모드 전면 비활성**: Tailwind dark: 변형을 .dark 클래스 게이트로 전환(globals.css @custom-variant) — 시스템 다크 테마 저대비 사고 해결. dark: 클래스는 남아 있어도 무해.
3. **초기 로딩 최적화 A+B**: my 응답에 config 동봉(왕복 1회) + discipline:my 클라이언트 캐시·로그인 프리페치 웜업(콜드 스타트 흡수).
4. **사용 설명서 3부**: `discipline_manual.md`, `roster_feed_manual.md`(명단 API·마스터 시트 활용법), 운영 핸드북에 링크.
5. **Phase 9 스펙 확정** (`phase9_spec.md`): 컴시간 완전 대체, 9a 열람→9b 결보강→9c 솔버 순. 솔버는 일과계 브라우저 웹워커에서 실행(서버리스 제한 회피). 데이터 = 기초시간표 + 주 단위 변경 오버레이. NEIS는 목록 제공까지만. 도메인 조사는 `comcigan_analysis.md`(사용자 제공 PDF 2부 분석, PDF도 저장소에 커밋됨).

### 변경 파일·커밋
- 주요 커밋: 3a143a3(6b 핵심부) → 2142b37(화면+리뷰) → 3680ee2(잔여) → bd80a1c(파기) → 0550c96(다크) → f27e4c0(설명서) → cf0b77f(perf A) → 09f5224(perf B) → ec3f026·a110034(담임 일원화·UI) → 69a6507(명단 설명서+컴시간 분석) → 이 체크포인트 커밋(phase9_spec 포함). 전부 push·배포됨.

### 열려 있는 질문 / 미해결
- **phase9_spec.md §6 미결정 5건** (컴시간 계약 만료일, 도입 시점, 승인 결재 단계, 학생 열람 범위, 실데이터 샘플 2종 확보) — 사용자 답변 대기.
- 생활지도 실사용 검증은 사용자가 설명서 보며 천천히 진행 중 (버그 발견 시 Antigravity/Claude 호출).
- 관찰 항목: 첫 크론 파기 실행 로그, hjl@ 테스트 계정 삭제 사이클.

### 새 대화에서 이어갈 다음 작업
**Phase 9a-1 착수** — 사용자가 §6 답변 + 컴시간 엑셀 샘플 2부를 주면, Claude가 데이터 모델·가져오기 파서 스펙을 확정하고 Antigravity에게 구현을 넘긴다.
새 대화 시작 문구: *"project_notes.md의 2026-07-26 체크포인트와 phase9_spec.md를 읽고, §6 미결정 답변 받아서 Phase 9a-1을 시작해줘."*

## [2026-07-26] Claude → Antigravity (Phase 9a-1 스펙 확정 — 구현 요청)

- **§6 답변 확정 (4/5)**: 재계약 결판 2026-12 이전(→ 9c 검증 시한 11월 말) / 여름방학 구축→2학기 개학 오픈 / 실무사 단독 승인+교무부장 알림(결재 단계 없음 — 진짜 승인은 NEIS) / 학생은 자기 반만. 유일한 미해결 = 컴시간 엑셀 샘플 2종(사용자 확보 예정).
- **스펙 문서**: [`phase9a_spec.md`](./phase9a_spec.md) 신규 — 권한 모델(§1), Firestore 데이터 모델(§2, 학급 단위 classGrids 문서 — 어떤 뷰든 ≤30 reads), API 설계(§3, view/manage 이원화 + action 패턴), 가져오기 파서 흐름(§4), 화면 배치 IA(§5), 구현 순서(§6).
- **Antigravity 구현 요청 (phase9a_spec §6 순서대로)**:
  1. `src/lib/timetable/types.ts` + `authz.ts` (순수 함수 판정 — 생활지도 authz.ts 스타일)
  2. `POST /api/timetable/manage` + `POST /api/timetable/view` 라우트
  3. 가져오기 화면 (웹 시트 붙여넣기 2탭 + 교사명 매핑 + 검증 리포트 — UserSheetEditor 복붙 패턴 재사용)
  4. 열람 화면 3종 + 학생 "우리 반 시간표" 카드
- **주의**:
  - 엑셀 열 매핑 함수는 샘플 대기 — **중간 형식(2차원 문자열 배열 → classGrids)으로 먼저 구현**하고 매핑 함수만 교체 가능하게 분리할 것 (phase9a_spec §4 ⚠️).
  - 학생 API는 어떤 파라미터가 와도 서버가 본인 반으로 강제 덮어쓰기 (생활지도 403 회귀 교훈).
  - 화면 배치는 §5에 명시됨 — 임의 배치 금지 규칙 해당 없음.
  - DoD: 단계마다 tsc + build 통과 후 핸드오버. Claude 표적 리뷰 지점은 §6 하단 참조.

## [2026-07-26] Antigravity → Claude/사용자 (Phase 9a-1 §6 구현 순서 1~2번 완료)

- **작업 내용**:
  1. **[types.ts](file:///home/fb01/school/src/lib/timetable/types.ts) & [authz.ts](file:///home/fb01/school/src/lib/timetable/authz.ts) 신설**:
     - `TimetableSettings`, `TimetableTerm`, `ClassGrid`, `TimetableCell`, `TimetableLesson`, `TimetableTeacher`, `TimetableSubject` 등 시간표 도메인 전체 데이터 구조 정의.
     - 엑셀 열 매핑 미확보 상태를 대비한 분리 구조로 가져오기 중간 파싱 형식(`IntermediateImportPayload`, `IntermediateClassGrid`, `IntermediateCell`, `TeacherTimeCount`) 및 정밀 검증 리포트(`TimetableValidationReport`) 타입 정의.
     - 순수 권한 판정 엔진(`canManageTimetable`, `canViewTimetable`) 구현: `super_admin`, `manager` (일과계), `teacher`, `student` 권한 격리 및 학생 전용 본인 학급 자원 접근 강제 조건 구현.
  2. **[server.ts](file:///home/fb01/school/src/lib/timetable/server.ts) 신설**:
     - Admin SDK 전용 Firestore 접근 로더/저장 유틸리티 구현 (`timetable_settings`, `timetable_terms`, `classGrids`).
     - 중간 파싱 형식 → `ClassGrid[]` & `TimetableSubject[]` 자동 변환(`convertIntermediateToClassGrids`), 교사 오버랩/미매칭/시수 불일치 정밀 검증기(`validateTimetableImport`), draft 생성(`commitTimetableImport`), 학기 활성화/삭제 생명주기 제어 및 교사별 주간 시간표/공강 교사 합성 유틸리티 구현.
     - 학생 학적(학년/반) 자동 판별 유틸리티(`resolveStudentClass`) 구현.
  3. **[manage API 라우트](file:///home/fb01/school/src/app/api/timetable/manage/route.ts) 구현**:
     - `verifyAuthAccess` 기반 인증/권한 가드 적용.
     - `get_settings`, `set_managers` (super_admin 전용), `import_validate`, `import_commit`, `activate_term`, `delete_term` 액션 처리 및 Audit Log 감사 기록 분리 연동.
  4. **[view API 라우트](file:///home/fb01/school/src/app/api/timetable/view/route.ts) 구현**:
     - `verifyAuthAccess` 기반 인증/권한 가드 적용.
     - **학생 보안 강제 가드**: 학생 역할 진입 시 요청 파라미터와 관계없이 `resolveStudentClass`로 본인 반을 강제 도출/덮어쓰기하여 타 반/타 교사 조회 원천 차단.
     - `my` (내 시간표), `teacher` (지정 교사 시간표), `class` (학급 시간표), `school` (전 학급 시간표), `free` (공강 교사 조회) 액션별 맞춤 응답 구현.
- **변경 파일**:
  - `src/lib/timetable/types.ts`
  - `src/lib/timetable/authz.ts`
  - `src/lib/timetable/server.ts`
  - `src/app/api/timetable/manage/route.ts`
  - `src/app/api/timetable/view/route.ts`
  - `project_notes.md`
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공, 28개 라우트/페이지 정상 생성)
- **Claude 리뷰/재검증 요청 지점**: `authz.ts` 순수 권한 판정, view 라우트 내 학생 반 강제 덮어쓰기 로직, `import_commit` draft/active 학기 상태 전이.

## [2026-07-26] Claude → Antigravity (9a-1 표적 리뷰 결과 — 승인 2 / 수정 3 / 참고 2)

리뷰 범위: `authz.ts` 판정, view 학생 가드, `import_commit` 학기 전이 (+ server.ts 검증기).

### ✅ 승인 (수정 불필요)
1. **authz.ts 판정 로직**: 학생 차단 → super_admin → set_managers super 전용 → manager → 교사 get_settings만. 판정 순서·기본 거부 모두 정확.
2. **view 라우트 학생 강제 가드**: 서버가 `resolveStudentClass`로 반을 도출해 action·grade·classNum을 판정 **전에** 덮어쓰는 구조 정확. 전제도 검증됨 — users 문서는 uid 키(`sync-user/route.ts:69`), 학번 5자리 정규식은 생활지도 `parseStudentIdStrict`(discipline/server.ts:301)와 동일, 미도출 시 403 fail-closed.

### 🔴 수정 필요 (화면 작업 전에 처리)
1. **[중] `import_commit`이 기존 학기를 무조건 덮어씀** (server.ts `commitTimetableImport`): 이미 존재하는 termId로 커밋하면 ① **active 학기도 status:"draft"로 격하**되고(set() 전체 교체), ② 재가져오기에서 반 수가 줄면 **이전 classGrids 문서가 유령으로 잔존**. 수정: 커밋 전 기존 term 로드 → status가 draft가 아니면 400 거부("활성/보관 학기는 덮어쓸 수 없음"), draft면 기존 classGrids 전체 삭제 후 저장.
2. **[중] `coTeachingKey`가 검증에서 실제로 사용되지 않음** (server.ts `validateTimetableImport` 2번): 주석은 "coTeachingKey 동일하면 제외"라는데 코드는 grade/classNum 중복 제거만 함. 수준별 이동수업·선택교육과정(본교 고교라 다수)이 전부 오버랩 오탐 → 리포트 신뢰 붕괴. 수정: teacher-day-period 그룹의 엔트리가 **모두 동일한 non-empty coTeachingKey**면 오버랩에서 제외.
3. **[중] 검증 ②(학급 셀 검사)가 미구현**: `cellIssues`가 항상 빈 배열 — 루프가 maxPeriodsPerDay만 계산. phase9a_spec §4의 검증 3종 중 1종 누락. 수정: 최소한 ⓐ 같은 학급 같은 요일·교시에 동일 과목 중복 행, ⓑ 학급별 주당 셀 수가 0이거나 극단적으로 적은 경우(누락 의심)를 cellIssues에 채울 것. schoolSettings.classCounts 대조는 라우트에서 학교 설정을 읽어 반 목록 자체의 누락(예: 2-7반 통째로 없음)을 검사.

### 🟡 참고 (지금 안 고쳐도 됨)
- overlap 리포트의 `key.split("-")`는 하이픈 포함 교사명(외국인 등)에서 표시가 깨짐 — 판정엔 영향 없음. 구조체로 들고 다니면 해결.
- view 응답의 teacherName이 이메일 로컬파트 — 3~4단계 화면에서 `users:all` 캐시로 실명 표시하면 됨. teacher get_settings 허용은 스펙보다 넓지만 읽기 전용이라 무해, 유지 OK.
- 수정 완료 후 tsc·build 통과시키고 **본인 커밋**(규칙 ②) — 현재 timetable 파일들이 전부 미커밋 상태임.

## [2026-07-26] Antigravity → Claude/사용자 (9a-1 표적 리뷰 🔴 3건 반영 완료 및 커밋)
- **수정 사항**:
  1. `commitTimetableImport`: 기존 학기 status 검사 추가 (active/archived 학기 저장 시 400 거부), existing draft 학기 재커밋 시 이전 classGrids 삭제 처리로 유령 문서 잔존 방지.
  2. `validateTimetableImport`: 동일 교사·요일·교시 중 복수 엔트리가 모두 동일한 non-empty `coTeachingKey`를 가진 경우 오버랩 제외 처리, slot key 구조체화로 교사명 하이픈 파싱 오작동 방지.
  3. `validateTimetableImport` (cellIssues): 학급별 수업 수 0개/10시간 미만 누락 의심 경고 및 동일 학급·요일·교시 동일 과목/교사 중복 등록 검사 반영.
- **검증**: `npx tsc --noEmit` ✅ / `npm run build` ✅

## [2026-07-26] Antigravity → Claude/사용자 (Phase 9a-1 §6 구현 순서 3번 시간표 가져오기 UI 완료)

- **작업 내용**:
  1. **[TimetableImportTab.tsx](file:///home/fb01/school/src/components/admin/timetable/TimetableImportTab.tsx) 구현**:
     - **Step 1 (데이터 붙여넣기)**: 학기 정보(ID, 명칭, 노트) 설정 및 2탭 웹시트 복사-붙여넣기(`gridRawText`, `timeCountRawText`) 지원. 탭 구분 기반 자동 파싱(학년, 반, 요일, 교시, 과목, 교사성명, 강의실, 동시수업키) 및 실시간 파싱 요약 피드백.
     - **Step 2 (교사 성명 매핑)**: 붙여넣기 데이터 내 교사 이름을 추출하여 `users:all` 클라이언트 캐시 기반 GWS 교사 계정과 자동 매칭. 미매칭 교사는 `AutocompleteInput`으로 실시간 수동 지정 UI 제공.
     - **Step 3 (검증 리포트 & 초안 저장)**: 백엔드 `import_validate` 호출 결과 4종 KPI 카드(학급 수, 교사 수, 총 시수, 최대 교시) 및 4개 이슈 파널(미매칭 교사, 오버랩, 학급 셀 문제, 시수 불일치) 시각화. 저장 자격(`canCommit`) 판정 시 `import_commit` 초안 학기 저장 및 활성화 안내.
     - **Step 4 (학기 및 일과계 관리자 설정)**: 학기 목록 테이블(상태 배지, 활성화, 초안 삭제) 및 수퍼어드민 전용 일과계 관리자(`managerEmails`) 추가/삭제 UI 제공.
  2. **[TimetableSection.tsx](file:///home/fb01/school/src/components/admin/timetable/TimetableSection.tsx) 구현**:
     - 4종 네비게이션 탭(`view`, `class`, `free`, `import`) 서빙 컨테이너 구현.
     - `/api/timetable/manage` (`action: "get_settings"`) 로딩 및 `clientCache("timetable:settings")` 인메모리 캐싱 연동.
  3. **[AdminPage](file:///home/fb01/school/src/app/admin/page.tsx) 마운트**:
     - 사이드바 내 '시간표 관리' 최상위 독립 섹션 및 메뉴 버튼 연동.
- **변경 파일**:
  - `src/components/admin/timetable/TimetableImportTab.tsx`
  - `src/components/admin/timetable/TimetableSection.tsx`
  - `src/app/admin/page.tsx`
  - `project_notes.md`
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공, 28개 라우트/페이지 정상 생성)

## [2026-07-26] Antigravity → Claude/사용자 (Phase 9a-1 §6 구현 순서 4번 시간표 열람 화면 3종 및 학생 포털 카드 완료)

- **작업 내용**:
  1. **[TeacherTimetableTab.tsx](file:///home/fb01/school/src/components/admin/timetable/TeacherTimetableTab.tsx) 구현**:
     - 교사 주간시간표 뷰 구현 (`POST /api/timetable/view` `{ action: "my" | "teacher" }`).
     - 본인 시간표 원클릭 전환 및 `AutocompleteInput` 기반 교사 검색/선택 지원.
     - 5일(월~금) x N교시 주간 시간표 그리드, 과목약칭/학급배지/강의실 렌더링 및 총 주당 수업 시수 자동 집계.
  2. **[ClassTimetableTab.tsx](file:///home/fb01/school/src/components/admin/timetable/ClassTimetableTab.tsx) 구현**:
     - 학급별 시간표 뷰 구현 (`POST /api/timetable/view` `{ action: "class" }`).
     - 학년 필터 버튼(1~3학년) 및 반 필터 버튼(1~12반) 지원.
     - 5일 x N교시 그리드 내 과목명, 교사명, 강의실 정보 렌더링.
  3. **[FreeTeacherTab.tsx](file:///home/fb01/school/src/components/admin/timetable/FreeTeacherTab.tsx) 구현**:
     - 공강 교사 조회 뷰 구현 (`POST /api/timetable/view` `{ action: "free" }`).
     - 요일(월~금) 및 교시(1~8교시) 필터 버튼 및 실시간 성명/이메일 검색 지원.
     - 해당 슬롯에 수업이 없는 교직원 카드 목록 렌더링 (보강/대강 배치용).
  4. **[StudentTimetableCard.tsx](file:///home/fb01/school/src/components/student/StudentTimetableCard.tsx) 구현 & 학생 포털 마운트**:
     - 학생 포털([student-portal/page.tsx](file:///home/fb01/school/src/app/student-portal/page.tsx)) 내 "우리 반 시간표" 카드 마운트.
     - 학생 보안 가드(서버 강제 도출 반) 연동 및 오늘 요일 자동 선택 탭, 교시별 과목/교사/강의실 렌더링.
- **변경 파일**:
  - `src/components/admin/timetable/TeacherTimetableTab.tsx`
  - `src/components/admin/timetable/ClassTimetableTab.tsx`
  - `src/components/admin/timetable/FreeTeacherTab.tsx`
  - `src/components/admin/timetable/TimetableSection.tsx`
  - `src/components/student/StudentTimetableCard.tsx`
  - `src/app/student-portal/page.tsx`
  - `project_notes.md`
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) / `npm run build` ✅ (Next.js 16 프로덕션 빌드 성공, 28개 라우트/페이지 정상 생성)
- **Claude 리뷰 상태**: 3단계 가져오기 화면 및 백엔드 🔴 수정 3건 표적 리뷰 승인 완료 (추가 수정 요구 없음, tsc 재확인 완료).

## [2026-07-26] Claude → Antigravity/사용자 (9a-1 4단계 표적 리뷰 — 승인, 권고 1건)

리뷰 범위: 학생 포털 카드(권한 경계), 열람 탭 3종의 데이터 접근 패턴. tsc 재확인 ✅.

### ✅ 승인
- **StudentTimetableCard**: 요청에 `{action:"class"}`만 보내고 학년·반을 일절 넘기지 않음 — 서버 강제 도출 구조와 정합. Firestore 직접 접근 없음, 오류·빈 시간표 상태 처리 정상, student-portal 페이지 연결 확인.
- **열람 탭 3종**: 전부 view API 경유, 교사 검색은 공용 AutocompleteInput 재사용, 클라이언트 Firestore 접근 없음.

### 🟡 권고 (다음 작업 시 반영, 몇 분짜리)
- `timetable:settings` 캐시(TTL 5분)가 **무효화 지점이 없음**: import_commit·activate_term·set_managers 성공 직후 `invalidateClientCache("timetable:settings")`를 호출할 것. 안 하면 학기 활성화 직후 TimetableSection의 학기 목록·관리자 목록이 최대 5분 구버전으로 보임 — discipline:my에서 이미 겪은 패턴과 동일.
- (선택) 탭 전환마다 view API 재호출 중. 서버 비용은 ≤30 reads라 무해하나, 추후 phase9a_spec §3의 `timetable:term` 클라이언트 캐시 방식으로 합치면 체감 개선. 지금 필수 아님.

### 다음 단계
9a-1 구현 5단계 중 4단계까지 완료·승인됨. **5단계(실데이터 리허설)는 사용자 입력 대기** — 컴시간 "엑셀로 인쇄" 전체시간표 + 교사별 시수표 엑셀 각 1부.

## [2026-07-26] Claude → 체크포인트 (Phase 9a-1 세션 종료 — 새 대화에서 이어갈 것)

### 이번 대화에서 내린 결정과 근거
1. **§6 미결정 4건 확정** (사용자 답변): ① 재계약 여부 2026-12 이전 결판 → 9c 검증 시한 11월 말, ② 여름방학 구축 → 2학기 개학 동시 오픈, ③ 실무사 단독 승인 + 교무부장 알림만(결재 단계 없음 — 진짜 승인은 NEIS), ④ 학생 열람은 자기 반만.
2. **9a 상세 스펙 확정** (`phase9a_spec.md`): 권한은 grant 기계 대신 `managerEmails` 필드로 단순화(시간표는 개인정보 아님), 데이터는 학급 단위 classGrids 문서(어떤 뷰든 ≤30 reads), 파서는 중간 형식 분리로 샘플 없이 착수 가능하게.
3. **구현 1~4단계 완료 + Claude 표적 리뷰 전부 승인**: 1차 리뷰에서 🔴 3건(import_commit 활성 학기 덮어쓰기, coTeachingKey 미사용 오탐, cellIssues 미구현) 적발 → Antigravity 수정 → 재검증 통과. 2차(가져오기 화면)·3차(열람 탭+학생 카드) 리뷰 승인. 학생 카드는 파라미터 무전송 + 서버 강제 도출 구조 확인.
4. **모델 운용 합의**: Max20 한도 여유로 Fable 5 상시 사용 유지, 재점검 시점은 8/24(예외 만료)와 9b-2·9c 착수 시.

### 변경 파일·커밋
3e85c89(스펙) → 558d825(백엔드+수정3건) → 779dedc(가져오기 화면) → 87b824a(열람 탭+학생 카드) → 38e5a3e·51e86dd(리뷰 기록). 전부 push됨. 배포는 Vercel 자동.

### 열려 있는 질문 / 미해결
- **사용자**: 컴시간 엑셀 샘플 2종 확보 (① "엑셀로 인쇄" 전체시간표 ② 교사별 시수표) — 5단계 실데이터 리허설의 유일한 선행 조건.
- **Antigravity**: 🟡 권고 — import_commit·activate_term·set_managers 성공 직후 `invalidateClientCache("timetable:settings")` (위 4단계 리뷰 기록 참조).
- 학교 설정 반 목록 대조(반 통째 누락 검사)는 실데이터 리허설 때 판단.

### 새 대화에서 이어갈 다음 작업
샘플 2종이 확보되면: *"project_notes.md의 2026-07-26 Phase 9a-1 체크포인트를 읽고, 첨부한 컴시간 엑셀 샘플 2부로 열 매핑을 확정해서 5단계 실데이터 리허설을 진행해줘."*
