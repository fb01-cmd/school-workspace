# Phase 8 실기기 피드백 배치 — 화면 몫 인계 (Antigravity)

> 원본 목록 = `development_roadmap.md` Phase 8 「[2026-08-19 실기기 피드백 수집 중]」 (번호도 그 목록 기준).
> 코어(서버·파서) 몫 6건(4-b·6·9·10·11·15)은 Claude가 2026-08-19 구현 완결 — 이 문서의 해당 항목은 "배선만" 남았다.
> 완료 후: AGENTS.md ④-3 인계 게이트 3종(자기 커밋·project_notes 핸드오버·check_ui_removals 소명) 필수. push는 하지 않는다 — Claude 검수 후 일괄 배포.

## 작업 순서

**1군(치명 — 최우선, 두 건을 같이 고치고 같이 확인): 5 → 7.** 2군(수신자 픽커): 1·2·3. 3군(문구·표시): 8·11·14·15명칭·4-a. 4군(배선·기능): 9·6·12·13·15미니입력·10.

---

## 1군 — 치명

### 5. 내 할 일 목록 불안정 — 색인 의존 쿼리 제거 + 조용한 실패 금지

원인 실측 확정: `recipientEmails array-contains + orderBy(dueAt)` 복합 쿼리가 Firestore 복합 색인을 요구하는데 색인이 없어 구독이 FAILED_PRECONDITION으로 죽는다. 색인을 만들지 않는다 — **쿼리에서 orderBy를 빼고 클라이언트에서 정렬**한다(색인 관리 대상 자체를 없앰. 쪽지 즐겨찾기 ⑧이 같은 이유로 같은 패턴을 이미 씀).

- [`TasksSection.tsx:96`](../src/components/admin/tasks/TasksSection.tsx) — `where(...array-contains...)` 단독으로 바꾸고 스냅샷을 `dueAt` 오름차순으로 클라 정렬.
- [`MobileTasksSection.tsx:77`](../src/components/mobile/MobileTasksSection.tsx) — 동일.
- [`DashboardTaskCard.tsx:37`](../src/components/admin/DashboardTaskCard.tsx) — array-contains 단독이라 색인 불요(이미 안전). onError 표기만 점검.
- **조용한 실패 금지**: 현재 구독 오류가 `console.error`뿐이고 화면은 빈 목록([`TasksSection.tsx:112`](../src/components/admin/tasks/TasksSection.tsx)). onError에서 화면 상태로 눈높이 문구를 표기한다 — 예: "할 일 목록을 불러오지 못했습니다. 새로고침해 주세요." (개발 용어·에러 코드 노출 금지 — AGENTS.md ui-copy-rules). 세 컴포넌트 전부.
- 완료 판정: 색인 없는 현 상태의 실서비스에서 PC·모바일 내 할 일이 새로고침 없이 표시.

### 7. 수락·완료·완료취소 반영 지연 — 전이 응답 즉시 반영 (낙관 갱신)

증상: 완료 체크가 잠깐 바뀌었다 원래대로 롤백, 새로고침해야 반영. 이미 수락한 업무가 "수락 전"+수락 버튼 활성으로 남아 누르면 "이미 수락한 업무입니다" 오류.

- `/api/tasks` `transition` 성공 응답은 `{ success, status }`로 **다음 상태(next)를 이미 돌려준다** — 이 값을 받는 즉시 해당 업무의 로컬 상태(`statuses[내 이메일]`)에 반영한다. 이후 구독 스냅샷이 오면 그것이 우선.
- 수락·거절·완료·완료취소 전부. 제출(submit) 성공 응답의 `submission`도 동일하게 즉시 반영.
- **상태 칩·버튼 활성이 statuses 실시간 값을 따르는지 일괄 점검** — 낡은 상태가 잘못된 행동(중복 수락 등)을 유도하지 않게.
- 적용 파일: TasksSection·MobileTasksSection (+DashboardTaskCard에 전이 버튼이 있으면 동일).
- 5번과 한 뿌리(죽은 구독의 스냅샷 대기)다 — 5번 수정 후에도 낙관 갱신은 그대로 필요(응답 즉시 반영이 원칙).

---

## 2군 — 수신자 선택 픽커 ([`TaskRecipientPickerModal.tsx`](../src/components/admin/tasks/TaskRecipientPickerModal.tsx))

### 1. 조직도 순서 — 가나다순을 버리고 조직도 정렬 단일 원본 재사용

- 원인: [`TaskRecipientPickerModal.tsx:132`](../src/components/admin/tasks/TaskRecipientPickerModal.tsx) `result.sort((a, b) => a.dept.localeCompare(b.dept, "ko"))`.
- 단일 원본: 부서 순서 = `schoolSettings.departments` 배열 순서([`OrgChartBuilder.tsx:67`](../src/components/admin/OrgChartBuilder.tsx)의 `departmentOrder` 참조), 부서 내 구성원 정렬 = [`OrgChartTree.tsx:158`](../src/components/admin/OrgChartTree.tsx) `sortMembersForDept`(부장 우선 → 담임 반 순 → 나머지 가나다). 같은 규칙을 픽커 `deptSections` 구성에 적용.
- 쪽지 수신자 픽커(MemoSection의 DeptCheckboxTree)도 같은 규칙인지 확인하고 다르면 함께 통일.

### 2. 기본 펼침 — 내 소속 부서만

- 원인: [`TaskRecipientPickerModal.tsx:157`](../src/components/admin/tasks/TaskRecipientPickerModal.tsx) `|| s.dept === deptSections[0]?.dept` — 첫 부서(가나다순이라 1학년부)가 무조건 펼쳐진다.
- 쪽지 v1.1 확정 동선과 동일하게 **내 소속 부서만** 초기 펼침([`MemoSection.tsx:300`](../src/components/admin/MemoSection.tsx) DeptCheckboxTree의 initialExpanded 패턴). 첫 부서 자동 펼침 조건 제거.

### 3. 검색 — 이름만

- [`TaskRecipientPickerModal.tsx:275`](../src/components/admin/tasks/TaskRecipientPickerModal.tsx) placeholder "선생님 이름 또는 내선번호로 검색…" → "선생님 이름으로 검색…". 검색 매칭 로직에서 내선번호 비교 제거(내선은 공용이라 식별자 불신 — 기존 결정).

---

## 3군 — 문구·표시

### 8. "지시" 단어 전면 소탕 (사용자: "어감이 매우 안 좋아")

- `grep -rn "지시" src/components src/app` 결과 중 **사용자 화면에 노출되는 문구만** 교체(코드 내부 명칭·주석·문서는 유지). 현재 노출 파일: TasksSection(2)·TaskComposerModal(4)·TaskStatusBoard(3)·MobileTasksSection(1)·DashboardTaskCard(1)·NotificationCenter(3)·OrgChartTree.
- 라벨 "지시 및 안내 내용" → **"내용"**. 그 외는 "업무 보내기/전달/내용"으로 통일.
- 서버 발신 문구(푸시·원장·감사 로그)는 코어에서 이미 정리됨 — 화면 하드코딩 문구만 보면 된다. 남은 서버 노출 문구를 발견하면 고치지 말고 핸드오버에 보고.

### 11. "미완료자 재촉" → "리마인드 알림"

- 버튼·안내 등 화면 언어 전면 교체("재촉" 단어도 8번과 함께 소탕). 429 응답은 서버가 새 문구("리마인드 알림은 업무당 하루에 한 번만…")를 주므로 서버 error 문자열을 그대로 표시하면 된다.
- 코어 변경(참고): 리마인드 실행 시 수신자 종 알림 원장에 `[리마인드] 업무명` 행이 새로 쌓인다(task-due 유형) + 푸시 제목이 "기한이 다가오는 업무가 있어요"로 부드러워짐. NotificationCenter가 task-due 유형을 정상 표기하는지만 확인.

### 14. 상태 칩 "도달 (확인 필요)" → "수락 전"

- [`TasksSection.tsx:423`](../src/components/admin/tasks/TasksSection.tsx) 확인. 같은 의미 칩(PENDING 상태 표기)을 현황판·모바일 포함 전수 검색해 일괄 "수락 전"으로.

### 15(명칭). 작성 모달 "업무 등록"

- "새 업무 지시 보내기" 등 발신 중심 명칭 전부 → **"업무 등록"** (TaskComposerModal 제목·진입 버튼·완료 토스트 등 전수).

### 4-a. 보내다 만 초안의 유령 표시

- 보낸 업무 목록에서 `recipientCount === 0` 문서를 **제외**하거나 "보내다 만 업무"로 구분 표시(둘 중 택1 — 발송 일시가 달린 정상 업무처럼 보이는 오해 제거가 목적. 구분 표시를 택하면 이어서 발송하거나 지울 출구가 있어야 함 — 출구 없는 나열 금지 원칙).
- 참고(코어 완료): 수신 0명인 채 24시간 지난 초안은 daily-sync `taskSweep`이 폴더째 자동 정리한다. 화면은 24시간 안의 것만 다루면 된다.

---

## 4군 — 배선·기능

### 9. 업무 내용 서식 편집기 배선 (GIF 제외)

- 작성: TaskComposerModal에 [`MemoEditorToolbar`](../src/components/common/MemoEditorToolbar.tsx)+직렬화기 배선 — 쪽지 작성기(MemoSection)와 동일 패턴. `bodyHasMd1Formatting`이 true일 때만 `contentFormat: "md1"` 스탬프(서버 검증은 이미 md1 수용).
- 표시: TasksSection·MobileTasksSection·TaskStatusBoard의 본문 표시를 `contentFormat === "md1"` 분기로 [`MemoRichBody`](../src/components/common/MemoRichBody.tsx) 재사용.
- GIF: 코어에서 업무 파일 화이트리스트의 gif가 제거됨(양식·제출물 공통) — 업무 쪽 편집기에 GIF 삽입 UI를 넣지 않는다. 서식·이모지는 유지.

### 6. URL 자동 링크 배선 (코어 완료 — 쪽지·업무 공용)

코어가 [`richtext.ts`](../src/lib/memo/richtext.ts)에 신설: `autolinkBlocks(parseMd1(body))` (md1 경로 — text 노드의 https URL만 링크 승격, 명시 링크·이미지는 그대로) / `parsePlainAutolink(body)` (평문 경로 — md1 토큰은 해석하지 않고 URL만 링크). https만, 2048자 이하, 꼬리 문장부호 제외. 저장 형식·알림 강등(stripMd1)·md1 스탬프 판단은 무영향.

- 배선 지점: 본문을 **상세로 그리는 모든 곳** — 쪽지 상세(PC·모바일), 업무 상세(PC·모바일·현황판). md1 문서는 `parseMd1(...)` 호출을 `autolinkBlocks(parseMd1(...))`로 감싸고, 평문 문서는 현재의 줄바꿈 렌더를 `parsePlainAutolink` + MemoRichBody 링크 노드 렌더로 교체.
- 목록 발췌·알림 문구는 대상 아님(링크 클릭이 없는 표면).
- 링크 렌더는 MemoRichBody의 기존 link 노드 스타일 재사용 (`target="_blank"` 등 기존 규약 그대로).

### 12. 철회 확인창에 진행 상황 경고

- TaskStatusBoard의 집계(수락 N·완료 N)를 재사용해 철회 확인창에: "이미 수락 N명·완료 N명이 있습니다. 철회하면 전원의 할 일에서 사라지며, 제출물은 보존 기간까지 남습니다." 서버 무변경.

### 13. 어드민 홈 상단에 내 할 일·받은 쪽지

- [`src/app/admin/page.tsx:339`](../src/app/admin/page.tsx) super_admin 홈 그리드 — 현재 업무 카드가 8번째(스크롤 밖)·쪽지 패널 부재. **DashboardTaskCard·DashboardMemoPanel을 관리 카드 위(상단)에 배치** — 교사 홈( :541 부근)과 같은 두 컴포넌트 재사용, 새 컴포넌트 금지.

### 15(미니 입력). [내 할 일 추가] 셀프 등록

- 내 할 일 화면(PC·모바일)에 미니 입력: **업무명 + 기한(필수), 내용(선택)**. 유형 선택 없음(확인형 고정 — 서버가 강제).
- API: `POST /api/tasks` `{ action: "self_add", title, dueAt, body?, contentFormat? }` → `{ success, taskId }`. 1액션 완결 — prepare/send 불필요, 알림 없음.
- 표시: 문서에 `selfAssigned: true`가 찍힌다 — 내 할 일 카드에 "내가 등록" 표시, **현황판에서는 셀프 업무를 접어서**(기본 숨김 또는 접힘 그룹) 남의 현황과 섞이지 않게.
- 셀프 업무는 생성 즉시 수락 상태(ACCEPTED)로 온다 — 카드가 "수락 전"이 아닌 진행 중 상태로 그려져야 함(7번 칩 점검과 같이 확인).

### 10(UI). 쪽지 일반 파일 첨부

코어 완료 명세 (서버는 그대로 쓰면 됨):

- **서버 경유(기존 multipart 그대로)**: 이미지 외 일반 파일(한글·오피스·PDF·압축·txt·csv, GIF 유지) 통과. 상한이 3.5MB → **4MB**로 올라감(파일 단위).
- **클라 처리 분기**: 이미지는 기존 리사이즈([`client_attachments.ts`](../src/lib/memo/client_attachments.ts)) 유지, **비이미지는 리사이즈 우회**(원본 그대로 FormData).
- **4MB 초과~10MB**: `{ action: "attach_session_start", fileName, size, mimeType }` → `{ sessionUrl }` → 브라우저가 sessionUrl로 파일 PUT(업무 제출 대용량 업로드와 동일 패턴 — TasksSection 제출 경로 참조, PUT 응답 JSON의 `id`가 driveFileId) → `{ action: "attach_session_finish", driveFileId }` → `{ attachment }`. 반환된 attachment의 `driveFileId`를 기존 stagedAttachments에 추가하면 발송·표시·파기 전부 기존 흐름.
- UI: 파일 선택 accept 확장(이미지 전용 해제), 비이미지 첨부 카드(파일명+크기+제거 버튼 — 썸네일 없음), 수신측 상세에서 비이미지는 webViewLink 다운로드/열기 링크로. 인라인 이미지(본문 삽입) 문법은 이미지만 — 비이미지에 삽입 버튼 노출 금지.
- 문구: "이미지 첨부" 계열 → "파일 첨부", 한도 안내 "5개, 개당 4MB(대용량 10MB)". "N장" → "N개".
- 10MB 초과는 첨부 불가 — 사유를 눈높이로 표시.

---

## 완료 정의 (전 항목 공통)

1. `npx tsc --noEmit` + `NODE_OPTIONS="--max-old-space-size=4096" npm run build` 통과.
2. `bash scripts/check_ui_removals.sh <작업 시작 커밋>` 실행·항목별 소명 (①-1-3).
3. 자기 변경 파일만 명시 add로 커밋(add -A 금지), project_notes.md 4줄 핸드오버.
4. push 금지 — Claude 검수 후 일괄 배포.
5. 실기기 재확인이 필요한 항목(5·7)은 "수정 완료"가 아니라 "수정 + 사용자 실기기 확인 대기"로 보고.
