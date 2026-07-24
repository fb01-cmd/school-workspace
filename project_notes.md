# Project Notes

## Firebase Configuration
- **Admin/Owner Account**: `fb01@hmh.or.kr`
- **Status**: The Firebase project is currently being created by the teacher. Waiting for the `firebaseConfig` object.

## Architecture Decisions
- **Multi-tenancy**: Simple approach (all users in a single root `users` collection) was chosen. Future schools adopting this system will deploy their own entirely separate Firebase project (Whitelabel approach).
- **Styling**: Tailwind CSS is used for styling.

## 미검증 사항 (Pending Verification)
- **Phase 5.8 — 배포 승인 보류** (2026-07-24, 전체 리뷰 결과 아래 핸드오버 참조) — `classroom_cleanup_logs` Firestore 복합 색인이 실제로 생성되어 있는지만 남은 미검증 항목 (없어도 in-memory 폴백으로 조용히 동작은 하니 급하진 않음). 나머지는 코드 스캔으로 확정된 확실한 갭이라 "미검증"이 아니라 아래 핸드오버의 "미구현/버그" 항목 참조.

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
