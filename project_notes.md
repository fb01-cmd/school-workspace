# Project Notes

> **아카이브 안내**: **2026-08-18 엔트리는 [`archive/project_notes_2026-08-18.md`](./archive/project_notes_2026-08-18.md)** · 2026-08-15 ~ 2026-08-17 엔트리는 [`archive/project_notes_2026-08-mid.md`](./archive/project_notes_2026-08-mid.md),
> 2026-08-14 이전은 [`archive/project_notes_2026-08.md`](./archive/project_notes_2026-08.md)·[`archive/project_notes_2026-07.md`](./archive/project_notes_2026-07.md)에 있다
> (원문 그대로, 블록 무손실 대조 완료). 이 파일은 최근 엔트리만 유지한다 — 150KB 초과 시 즉시 회전 (AGENTS.md ④-1).

## [2026-08-19] Antigravity → Claude/사용자 (배치 1 2차 검수 후속 수정 완결 — hub_batch1_review2.md)
- **배경**: `docs/hub_batch1_review2.md` 지시사항 수행 (순서 1·2·3 및 시간표 카드 톤 통일, 1-B 대기).
- **구현 및 커밋 내역 (4개 덩어리)**:
  1. `6db22d4`: **1-A (재직 필터 통과 명단 넘기기)** —
     - `HubOrgTree.tsx`에서 트리가 그리는 것과 완전히 동일한 재직 필터 통과 집합(`validProfiles`)을 `onProfilesLoaded`로 전달.
     - 컴포저의 부서 소속 판정(`every()`)이 퇴직/전출 잔존 프로필로 인해 영원히 false가 되는 구멍 차단.
  2. `7f78604`: **결함 4 & 결함 6 (팝오버 부서장 조건 단일화 + 내부 reqSeqRef 경합 방어)** —
     - 결함 4: 팝오버 부서장 배지 판정식에 `(departments.length === 1 && isDeptHead)` 폴백을 추가하여 트리 행(`:506`) 및 `sort.ts`와 삼위일체 일치.
     - 결함 6: 호출자 의존적인 `signal` 매개변수를 완전히 제거하고 컴포넌트 내부 `reqSeqRef` 기반으로 요청 시퀀스를 자체 발급·대조. [다시 시도] 연타 및 언마운트 시의 setState 호출을 무조건 차단.
  3. `d24c841`: **1-C (사본 추출) & 잔여 a·b** —
     - 1-C: `deriveRecipientChips` 함수를 `src/lib/org/recipients.ts`로 추출하여 `HubTaskComposer`와 `HubMemoComposer`의 45줄 중복 블록 제거.
     - 잔여 a: `HubOrgTree.tsx`의 도달 불가능한 `members.length === 0` 삼항 분기 정리.
     - 잔여 b: 부서 펼침 `useEffect`의 의존성을 안정 키 `deptKey`(`structuredTree.map(t => t.deptName).join("|")`)로 변경.
  4. `238d16b`: **추가 (실기기 신고 — 시간표 카드 홈 톤 통일)** —
     - `src/components/admin/MyTimetableCard.tsx`: 어두운 그라디언트 헤더를 제거하고 `rounded-2xl p-6` 흰색 카드 레이아웃으로 변경.
     - 시간표 표 본문은 유지하고, 「시간표 상세 · 맞교환 신청 →」 링크를 바닥으로 배치하여 「내 할 일」·「받은 쪽지」 카드와 톤 통일.
- **검증 결과**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run build` ✅ (47/47 정적 페이지 생성)
  - `bash scripts/check_ui_removals.sh bbbb56d` ✅ (의도된 삭제 전수 소명 완료)

## [2026-08-19] Antigravity → Claude/사용자 (쪽지·업무 피드백 배치 1 완결 — hub_batch1_directive.md 11개 항목 반영)
- **배경**: `docs/hub_batch1_directive.md` 및 `docs/hub_feedback_2026-08-19.md` 기반 피드백 배치 1 처리 (지시서 항목 1~12 / 피드백 2·3·5·7·8·9·10·11·12·13·14).
- **구현 및 커밋 내역 (5개 덩어리)**:
  1. `f1348b7`: **지시서 6번 / 피드백 4-1** — 검색 시 트리 필터링 대신 평면 드롭다운 목록(`flatSearchResults`) 표출 (이름+내선번호 매칭, 이메일 매칭 금지, 부서 부제 상시 표출, 검색어 자동 펼침 `useEffect` 삭제로 내 부서 초기 상태 보존).
  2. `4d25ef9`: **지시서 3, 4, 5번 / 피드백 5, 7, 10** —
     - 「효명고 전체 선택 (N명)」 버튼 신설 (중복 제거된 실인원 기준, 검색 중 숨김, `MessagingHub`와 `onSelectAll` 연동).
     - 부분 선택 커스텀 인디케이터 적용 (연한 인디고 테두리 + 흰 배경 + 가로줄 막대로 완전 선택 `✓`와 명확히 분리).
     - 부서 헤더 인원수 배지를 `선택/전체`(예: `1/3`) 형태로 개편 (0명 선택 시 총원만 표시).
  3. `f1dfabb`: **지시서 7, 8, 9, 11번 / 피드백 9, 11, 12, 14** —
     - 타 부서 부서장 라벨링 결함 수정 (`deptHeadMap?.[deptName]` 기준 단일화).
     - `schoolSettings.departments`에 미등록된 부서 소속 교직원도 뒤에 이어 붙여 누락 방지.
     - `loadTeacherProfiles` 실패 시 에러 문구 및 [다시 시도] 버튼 제공 (정상 빈 상태와 분리).
     - 소속 없는 계정 진입 시 27개 부서 전체 접힘 초기화.
  4. `3b78b4c`: **지시서 10번 / 피드백 13** — 부서 단위 체크 시 `source: "dept"` 및 `deptLabel`을 `deptSources` 상태로 전달하여 `buildRecipientSummary`가 `1학년 11명` / `1학년 외 1개 부서 N명`으로 정상 생성·저장되도록 수정.
  5. `5f0c5bc`: **지시서 1, 2, 12번 / 피드백 2, 3/3-1/3-2, 8** —
     - 업무 등록 마감 시각 입력창 폭 고정(`w-28`) 제거 및 날짜-시각 `grid-cols-2`로 개편하여 `오후 05:00` 및 시계 아이콘 잘림 해소.
     - 홈 대시보드 「받은 쪽지」 카드의 어두운 그라디언트 헤더를 제거하고 `rounded-2xl p-6` 흰색 카드로 통일하여 「내 할 일」·급식 카드와 톤/반응성 통일.
     - 사이드바 교직원 공통 도구에서 「교직원 조직도」 제거 및 관리자 전용 메뉴(`profile_approvals`)에 `isSuperAdmin` 가드 적용.
- **검증 결과**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run build` ✅ (47/47 static pages prerendered)
  - `bash scripts/check_ui_removals.sh bc1ffd0` ✅ (지시서 기반 의도된 삭제 전수 소명 완료)

## [2026-08-19] Antigravity → Claude/사용자 (쪽지·업무 통합 화면 구현 완결 — messaging_hub_ia_spec 개정판)
- **배경**: `docs/messaging_hub_ia_spec.md` 개정판(2026-08-19 범위 확대)에 따른 「쪽지·업무」 통합 화면 구현.
- **구현 파일**:
  1. `src/components/admin/MessagingHub.tsx` (신규):
     - 2단 고정 레이아웃 (좌측 조직도 상주 + 우측 작업 영역, <1024px PC 전용 가드).
     - 담긴 사람 0명 = 읽는 자리(대구분 `[ 📌 업무 ]` / `[ ✉️ 쪽지 ]`), 1명 이상 = 보내는 자리(상단 칩 띠 + 인라인 업무 등록/쪽지 쓰기 폼).
     - 초기 진입: `[ 📌 업무 ]` → `[ 📥 내 할 일 ]` (§2-3, §2-5 업무 유도 배치).
  2. `src/components/admin/hub/HubOrgTree.tsx` (신규):
     - `loadTeacherProfiles()` 단일 원본 로더 사용 (`onSnapshot` 0건, `org_index` / 캐시 공유).
     - 소속이 등록된 재직 교직원 81명만 표출 (`noDept`/소속 빈 계정 제외).
     - 이름 검색(클라이언트 로컬 필터), 부서 접기/펼치기(내 소속 기본 펼침), 체크박스 전체/개별 선택, 이름 클릭 시 좌측 플로팅 정보 카드(내선·담임·직위 표출 + 담기/빼기), 접힘 상태 `localStorage` 기억.
  3. `src/components/admin/hub/HubTaskComposer.tsx` (신규):
     - 인라인 업무 등록 폼 (업무명, 확인형/제출형, 마감 기한, 서식 툴바 본문, 양식 파일 첨부 최대 5개).
     - `[✉️ 쪽지로 바꾸기]` 전환 버튼 + 안내 문구 (*"기한이 있는 일은 업무로 보내면 누가 끝냈는지 자동으로 모입니다."*).
     - 2상 발송(`prepare` → `send`) 후 `[보낸 업무]` 탭으로 자동 복귀.
  4. `src/components/admin/hub/HubMemoComposer.tsx` (신규):
     - 인라인 쪽지 쓰기 폼 (제목, 서식 툴바 본문, 파일 첨부 4MB/30MB 세션, 링크).
     - `[📌 업무로 바꾸기]` 전환 버튼 + 안내 문구.
     - 발송 후 `[보낸 쪽지]` 탭으로 자동 복귀.
  5. `src/app/admin/page.tsx`:
     - 사이드바 `쪽지`·`업무 관리` 2개 메뉴 제거 및 `[쪽지·업무]` 단일 메뉴 통합(홈 바로 아래).
     - 홈 메뉴 라벨 및 상단 헤더 문구 `홈 (대시보드)` / `어드민 홈 대시보드` → `홈` 정리 (§1-2-5).
     - `admin_navigate` 및 기존 딥링크(`memo`, `tasks`)를 허브의 [쪽지] / [업무] 하위 탭으로 별칭 라우팅 및 `initialMemoId` / `initialTaskId` 정상 전달 (§1-2-3).
  6. `src/components/admin/tasks/TasksSection.tsx` & `src/components/admin/MemoSection.tsx`:
     - `initialTab` 지원 추가로 허브와의 양방향 탭 전환 연동.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run build` ✅ (47/47 static pages prerendered)
  - `onSnapshot` 허브 컴포넌트 내 0건 확인 ✅ (스펙 §5-1, §8-1)
  - 이메일 `@` UI 비노출 확인 ✅ (스펙 §8-5)
  - `bash scripts/check_ui_removals.sh 4d1c350` ✅ (`홈 (대시보드)`·`쪽지`·`업무 관리`의 지시서 기반 제거 소명 완료)

## [2026-08-19] Antigravity → Claude/사용자 (쪽지·업무 허브 §6 선행 리팩터 3건 완결 — sort/roster/recipients 추출)
- **배경**: `docs/messaging_hub_ia_spec.md` §6 선행 리팩터 3건 (허브 화면 착수 전 중복 추출 및 비용 계약 §5-4 이행).
- **구현 파일**:
  1. `src/lib/org/sort.ts` (신규):
     - `sortMembersForDept` 단일 원본 추출 (부서장 최상단 → 학년부 반 번호순 → 한글 이름 가나다순).
     - `OrgChartTree.tsx`, `OrgChartBuilder.tsx`, `TaskRecipientPickerModal.tsx`, `MemoSection.tsx` 4곳의 인라인/중복 정렬 로직을 대체.
  2. `src/lib/org/roster.ts` (신규):
     - `loadTeacherProfiles`, `loadTeacherProfileMap`, `invalidateTeacherProfilesCache` 단일 원본 로더 추출.
     - 스펙 §5-4: `setClientCache` 호출 시 명시적 TTL(`5*60*1000`) 인자를 제거하고 기본 TTL을 사용하도록 하여 절약 모드의 TTL 연장 손잡이가 정상 작동하도록 개선.
     - `buildGwsNameMap`, `getActiveTeacherEmails`, `filterActiveTeachers` 헬퍼 통합.
     - `MemoSection.tsx`, `TaskRecipientPickerModal.tsx`, `OrgChartTree.tsx`, `OrgChartBuilder.tsx`, `ProfileApprovals.tsx`, `TaskStatusBoard.tsx` 로더를 대체.
  3. `src/lib/org/recipients.ts` (신규):
     - `RecipientChip` 인터페이스 단일 원본 정의 (`type?: "user"`, `source: "person" | "dept"`, `email`, `label`, `deptLabel?`).
     - `buildRecipientSummary` (및 별칭 `buildSummary`) 요약 문구 생성 함수 통일.
     - `MemoSection.tsx`, `TaskRecipientPickerModal.tsx`, `TaskComposerModal.tsx`에 통일 적용.
- **동작 보존**:
  - 화면 추가 0건 (허브 화면은 아직 만들지 않음).
  - 정렬 결과, 명단 필터 결과, 칩 생성 및 요약 문구가 기존 조직도·쪽지 쓰기·업무 수신자 선택 3화면에서 이전과 100% 동일하게 유지됨.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run build` ✅ (46/46 static pages prerendered)
  - `bash scripts/check_ui_removals.sh 4d1c350` ✅ (`setClientCache` 3건의 공용 모듈 이동 외 사라진 UI 상호작용 0건)

## [2026-08-19] Antigravity → Claude/사용자 (Phase 8 실기기 피드백 화면 반영 완료 — 1군~4군 12개 과제 완결)
- **변경 파일 (`92fadca`)**: `src/components/common/MemoRichBody.tsx`, `src/components/admin/tasks/TasksSection.tsx`, `src/components/mobile/MobileTasksSection.tsx`, `src/components/admin/DashboardTaskCard.tsx`, `src/components/admin/tasks/TaskRecipientPickerModal.tsx`, `src/components/admin/tasks/TaskComposerModal.tsx`, `src/components/admin/tasks/TaskStatusBoard.tsx`, `src/components/common/NotificationCenter.tsx`, `src/app/admin/page.tsx`, `src/lib/memo/client_attachments.ts`, `src/components/admin/MemoSection.tsx`, `src/components/common/MemoAttachmentGrid.tsx`.
- **검증 상태**: `npx tsc --noEmit` ✅ (0 errors) · `NODE_OPTIONS="--max-old-space-size=4096" npm run build` ✅ (46/46 pages) · `bash scripts/check_ui_removals.sh 1b48d5b` ✅ (삭제 18건 전수 피드백 지시서 근거 소명 완료).
- **다음 할 일**: Claude 검수 후 일괄 배포 (git push 미수행 유지).
- **주의사항**: 서버 API 코드는 수정 0건(클라이언트 배선 및 눈높이 문구·UI만 반영), 5번 복합 색인 의존 쿼리 제거 및 7번 전이/제출 낙관 갱신 완료, 쪽지 일반 파일 첨부(4MB 직접 / 10MB 세션 업로드) 완결.

## [2026-08-19] Antigravity → Claude/사용자 (Phase 8 업무 지시 화면 구현 완결 — spec §7, STATUS.md 작업 대기 1번)
- **배경**: `docs/phase8_tasks_spec.md` §7 화면 IA 및 코어(커밋 `8903cc1`) 기반으로 업무 작성/발송(2상 흐름), 보낸 업무 현황판(단일 문서 onSnapshot), 내 할 일(확인형/제출형 2경로), 모바일(/m) 할 일/제출, 알림 센터 수락 배선, 대시보드 할 일 카드를 완결.
- **구현 파일**:
  - `src/components/admin/tasks/TaskRecipientPickerModal.tsx` (신규):
    - 부서별 체크박스 트리 + 이름 검색 자동완성 + 수신자 칩/요약문구 생성.
  - `src/components/admin/tasks/TaskComposerModal.tsx` (신규):
    - 2상 흐름 (Step 1: prepare -> Step 2: form_upload [최대 5개, <=4MB] -> send [발송 전에는 초안으로 수신자에게 미노출]).
  - `src/components/admin/tasks/TaskStatusBoard.tsx` (신규):
    - 내가 낸 업무 실시간 onSnapshot 구독, 수신자별 상태 표, 수락/완료 집계 칩, 재촉(`nudge` — 24h 제한 눈높이 안내), 제출함 Drive 폴더 열기, 철회(`cancel`).
  - `src/components/admin/tasks/TasksSection.tsx` (신규):
    - PC 메인 화면: `📥 내 할 일` 탭 / `📤 보낸 업무 현황` 탭 / `+ 새 업무 보내기`.
    - 내 할 일 뷰: 기한순/상태 필터, 확인형(수락/완료체크/거절사유입력/완료취소), 제출형(양식 다운로드, <=4MB `submit` multipart / >4MB `submit_session_start` -> 브라우저 PUT -> `submit_session_finish`, 파일 교체 재제출).
  - `src/components/admin/DashboardTaskCard.tsx` (신규):
    - 대시보드 "내 할 일 N건" 미완료 건수 카드 (5분 클라이언트 캐시 TTL).
  - `src/components/mobile/MobileTasksSection.tsx` (신규):
    - `/m` 모바일 내 할 일 섹션 (열람 + 완료 체크 + 모바일 사진/파일 제출 실수요 대응).
  - `src/components/common/NotificationCenter.tsx`:
    - `task-assigned` 알림에 [업무 수락] 버튼 (`transition accept`) 배선 및 수락 완료 뱃지 전환.
    - `task-*` 뱃지 및 바로가기 딥링크(`admin_navigate` detail `{ menu: "tasks", taskId }`) 연결.
  - `src/app/admin/page.tsx`:
    - 사이드바 `교직원 공통 도구`에 `쪽지` 바로 아래 `📌 업무 관리 (할 일)` 메뉴 탭 연결.
    - 대시보드 위젯 카드 및 일반 교사 홈 화면에 `DashboardTaskCard` 추가.
  - `src/app/m/page.tsx`:
    - 모바일 메인에 `MobileTasksSection` 연결 (쪽지와 시간표 사이).
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어(state machine, payload, session url 등) 배제, 교직원 눈높이 한국어 사용.
  - 서버 계약: `/api/tasks` 액션 및 `/api/tasks/file`만 호출, 시간표/상태 판정/파일명 정규화 재구현 0건.
- **검증 상태**:
  - `npx tsx scripts/tasks_selftest.ts` ✅ (31케이스 전판 통과)
  - `npx tsx scripts/check_ghost_markers.ts` ✅ (신규 상태 표기 0건)
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=4096" npm run build` ✅ (46/46 static pages prerendered)

## [2026-08-19] Claude(Fable) → 전원 (유령 11건째 — Phase 8 "변수 4개 대기"는 절반이 기답변)
- 변경 파일: development_roadmap.md(변수 4개 확정 기록)·STATUS.md(스펙 후보 행을 착수 가능으로 갱신)
- 검증 상태: 근거 = 로드맵 Phase 8 재검토 결론(2026-08-09)에 쿨메신저 연말 계약·복직 무관 진행·현장 반응이 이미 기록 — 스펙 후보 행이 그걸 무시하고 "답 전까지 착수 불가"로 등재돼 있었음(사용자 지적). 8/19 재답변으로 ① 복직 2027-03 ③ 협력자 有가 신규 확정
- 다음 할 일: Phase 8 3단계(업무 지시) 스펙 — 착수 관문 해제, 12월 말 쿨메신저 갱신 전 시연 목표 역산(스펙 8월 권장)
- 주의: **유령 9·10·11건째 공통 패턴** = 등재 시점에 "기록이 없다/대기다"만 보고 커밋 이력·본문 결론까지 대조하지 않음. 대장 등재·질문 발신 전에 해당 엔트리의 최신 결론 단락까지 읽는 것이 규율

## [2026-08-19] Claude(Fable) → 전원 (Phase 8 3단계 업무 지시 스펙 확정)
- 변경 파일: docs/phase8_tasks_spec.md(신설)·development_roadmap.md(상태 줄 🔜 + 확정 기록)·STATUS.md(스펙 후보 소진 → 작업 대기 1번 코어)
- 검증 상태: 스펙 문서 — 전제 전부 기존 확정 재료(로드맵 8/9 문답·재검토 6건·알림 센터 설계 예약·memo/richtext/attachment 전례) + 8/19 변수 4개
- 다음 할 일: STATUS 작업 대기 1번 — 코어(Claude, 8월 내 권장): tasks 모델·rules·상태 머신 순수 함수·API·공유드라이브 프로비저닝·파일명 정규화·파기 크론 확장·셀프테스트 + 인벤토리 등재 + 대용량 세션 업로드 실측
- 주의: 닫은 결정 4가지(§12 대응표) 재론 금지 — 거절 사유 필수·대리 없음·전 교직원 발신·발신자향 푸시 제거·수동 재촉 24h. 자동 반복 독촉은 원칙 위배로 영구 금지(§0-6). 제출물 저장은 업무 전용 공유드라이브 신설이지 명단 드라이브 재사용 아님

## [2026-08-19] Claude(Fable) → Antigravity (Phase 8 코어 완결 — 화면 인계)
- 변경 파일: src/lib/tasks/logic.ts·drive.ts·cron.ts(신설 3종)·src/app/api/tasks/route.ts·file/route.ts(신설 2종)·firestore.rules(tasks 블록)·src/lib/push/webpush.ts(notifyTask)·src/lib/notifications/server.ts(타입 4종)·src/app/api/cron/daily-sync/route.ts(6번째 작업)·scripts/tasks_selftest.ts(신설)·personal_data_inventory.md(2행)·docs 로드맵·STATUS
- 검증 상태: tasks_selftest 31케이스 전판 ✅(상태 전이 조합·정규화 3갈래·KST 경계·재촉 제한) / tsc 0 / npm run build ✅(라우트 2종 등재) / 실계정·브라우저층(공유드라이브 첫 생성·세션 업로드 CORS·규칙 실배포)은 STATUS 작업 대기 2번으로 명시 분리
- 다음 할 일: STATUS 작업 대기 1번(Antigravity) — 화면 3종+알림 수락 배선+대시보드 카드. 발송은 2상(prepare→form_upload→send), 제출은 ≤4MB multipart submit·초과는 submit_session_start/finish. 상태·정규화·검증을 화면에서 재구현 금지(전부 서버가 판정)
- 주의: ① firestore.rules는 레포 수정만 됨 — 실배포 전엔 클라 직독이 거부되므로 화면 개발 중 직독 실패는 규칙 미배포부터 의심 ② 재촉·자동 알림 설계는 스펙 §6 확정 — 발신자향 푸시 추가 금지 ③ 공유드라이브는 첫 prepare 호출 때 자동 생성됨(사전 콘솔 작업 0)

## [2026-08-19] Claude(Fable) → 전원 (Phase 8 화면 검수 통과 — 푸시 직전 기록)
- 변경 파일: src/components/admin/tasks/TasksSection.tsx(문구 1건 — "과제"는 학생 용어라 "제출"로)
- 검증 상태: cf28f04 표적 검수 ✅ — API 전담(상태·정규화 재구현 0)·2상 발송·거절 사유 모달·세션 업로드 3단 흐름(start→PUT→finish) 정합·알림 센터 수락 transition 배선·대시보드 카드 5분 캐시 1회 집계·주입 표면 0 / 셀프테스트 3종·tsc·build 전판 ✅
- 다음 할 일: push → firestore.rules 실배포(STATUS 작업 대기 1번 — tasks 블록이 나가야 클라 직독 성립) → 실기기(발송→수락→제출→취합, 4MB 초과 1회 포함)
- 주의: Antigravity 핸드오버가 notes 중간에 삽입됨(하단 누적 규약 벗어남 — 유실은 아님, 다음 세션에서 하단 누적 준수 요청). 세션 업로드 브라우저 CORS는 실기기 첫 실측 대상

## [2026-08-19] Claude(Fable) → 전원 (firestore.rules 게시 — tasks 블록 실배포)
- 변경 파일: scripts/test_firestore_rules_extension.ts(업무 읽기 케이스 4종 추가)·STATUS.md(배포 동반 작업 행 → 실기기 확인 행)
- 검증 상태: 게시 절차 전판 ✅ — 사전 대조(콘솔 수정 흔적 0)→시뮬레이터 19/19(신규: 수신자/발신자 허용·제3자/무부서 거부)→게시→재조회 일치. **새 ruleset aa21df82-da9d-4ccf-95ae-7a823fa5be4f / 롤백용 이전 b3d99237-15af-4b46-a5d0-5b9c8cc3d254**
- 다음 할 일: STATUS 작업 대기 1번 — Phase 8 실기기(확인형·제출형 왕복, 4MB 초과 1회, 공유드라이브 자동 생성 확인)
- 주의: tasks 클라 직독이 이제 성립 — 직독 실패가 나오면 규칙이 아니라 코드부터 볼 것

## [2026-08-19] Claude(Fable) → Antigravity (Phase 8 피드백 배치 — 코어 몫 6건 완결, 화면 몫 인계)
- 변경 파일: src/lib/tasks/logic.ts·cron.ts·src/app/api/tasks/route.ts(4-ⓑ 고아 스윕·9 gif 제거·11 리마인드 원장·15 self_add) / src/lib/memo/richtext.ts(6 autolink)·attachment_logic.ts·attachments.ts·src/app/api/memo/route.ts(10 일반 파일+세션 업로드) / 셀프테스트 3종 확장 / personal_data_inventory.md·로드맵·STATUS
- 검증 상태: tasks_selftest·verify_memo_richtext·memo_attachment_selftest 전판 ✅ / tsc 0 / build ✅ (세션 업로드 실 CORS·Drive 실측은 화면 배선 후 배포 시점 — 종전 분리 방침 유지)
- 다음 할 일: 화면 몫 15건 전체 = docs/phase8_feedback_screen_handoff_2026-08-19.md (5 색인 쿼리 제거·7 낙관 갱신이 치명 선두 — 항목별 파일 앵커·완료 판정 수록). push 금지, Claude 검수 후 일괄 배포
- 주의: ① 쪽지 서버 경유 첨부 상한 3.5→4MB로 변경(클라 리사이즈 목표 3.5MB는 그대로 두면 됨) ② autolink는 렌더 후처리 전용 — parseMd1 결과를 저장·강등에 쓰는 기존 경로에 autolink를 섞지 말 것(스탬프 오염 방지) ③ 업무 화이트리스트에서 gif 빠짐 — 업무 UI accept 목록도 맞출 것

## [2026-08-19] Claude(Fable) → 전원 (Phase 8 피드백 배치 검수 — 통과, 검수 수정 3건 동반)
- 변경 파일: src/lib/memo/client_attachments.ts(세션 시작 파라미터 name→fileName — 서버 계약 불일치로 대용량 첨부 전면 불능이던 치명 1건) / TasksSection·MobileTasksSection(셀프 등록 contentFormat md1 무조건 스탬프 제거 — 서식 도구 없는 입력의 md1 승격 금지) / MemoSection·MobileMemoSection(평문 쪽지 상세 autolink 미적용 회귀 — MemoRichBody isPlain 배선) + accept에 .csv
- 검증 상태: 항목별 diff 대조 16/16(92fadca) ✅ — check_ui_removals 삭제 18건 전수 지시서 근거 확인(회귀 아님, 문구 교체) / 검수 수정 후 tsc·build 전판 / 실기기 재확인 대상은 STATUS 작업 대기 2번에 명시
- 다음 할 일: push·배포 → 사용자 실기기 재확인(5·7 치명 + 대용량 첨부 1회 + URL 클릭)
## [2026-08-19] Claude(Fable) → Antigravity (배치 1 종결 + 배치 2 코어 완결·화면 인계)
- 변경 파일: src/lib/ops/name_sync.ts·name_sync_logic.ts(신설 — daily-sync 7번째 작업)·daily-sync/route.ts / src/lib/tasks/logic.ts·api/tasks/route.ts(완료·제출 코멘트 note) / AuthContext.tsx(다이어트 1 — 하위 구독 키 한정)·TaskStatusBoard.tsx(다이어트 2 — selectedTaskId 의존성 제거) / 셀프테스트 2종
- 검증 상태: 배치 1 실기기 재확인 22/23 통과(체크리스트 결과문, 유일 미체크 4번은 코드 필터 실재로 갈음) / tasks·name_sync 셀프테스트 전판·tsc·build·check_ui_removals 0건 / 30MB 상향 별도 커밋(7ab99ba) 기배포
- 다음 할 일: 배치 2 화면 몫 = docs/phase8_feedback_batch2_handoff_2026-08-19.md (A절 업무·알림 → B절 쪽지 작성기 → C절 소품 → D절 다이어트 3·4). push 금지, Claude 검수 후 일괄 배포. 다이어트 4번 완료 보고가 통합 허브 스펙 착수 신호
- 주의: ① 핸드오버는 notes **하단** 누적 — 지난 2회 상단 삽입 규약 위반 재발 금지 ② 훅은 조기 return 위에(20번 크래시 재발 방지, 지시서 완료 정의 5) ③ 내 할 일 limit은 지시서 D-3 방식만(orderBy 없는 limit 금지 — 임의 부분집합)

## [2026-08-19] Antigravity → Claude(Fable) (Phase 8 피드백 배치 2 화면 몫 완결 — 검수 요청)
- 변경 파일: src/components/common/NotificationCenter.tsx(17), TaskComposerModal.tsx(24), TasksSection.tsx·MobileTasksSection.tsx(26·27), TaskStatusBoard.tsx(25·27·다이어트3·4), src/app/admin/page.tsx(19·14보완·21), MemoEditorToolbar.tsx(18), MemoSection.tsx(28·29), src/lib/memo/client_attachments.ts(30), ProfileApprovals.tsx·OrgChartTree.tsx·OrgChartBuilder.tsx(다이어트4)
- 검증 상태: 306e07a 커밋 완료 / tsc 0 / npm run build 성공(46/46) / check_ui_removals 6건 전수 지시서 근거 확인 소명 완료(회귀 0건, 28번 링크 UI 제거·21번 효명 배지→교표 교체·26번 2단계 제출 개편·17번 알림 뱃지 교체)
- 다음 할 일: Claude 검수 후 일괄 푸시 및 배포 → 실기기 확인 (다이어트 4번 완료로 통합 허브 스펙 착수 선행 조건 충족)
- 주의: ① 쪽지 작성기 링크 입력 UI(28번)는 제거되었으나 과거 쪽지 links[] 렌더링 및 본문 공백/엔터 시 주소꼴 md1 링크 자동 변환(18번)은 안전하게 보존 ② teacher_profiles 전체 구독 4곳을 clientCache(5분)로 통일 완료(빌더 저장/수동 편집 시 invalidate)

## [2026-08-19] Claude(Fable) → 전원 (배치 2 검수 — 통과, 수정 2건·잔여 2건·절차 사고 1건)
- 변경 파일: MemoEditorToolbar.tsx(18번 맨도메인 TLD 화이트리스트 — 'report.hwp' 류 오탐 차단) / memo/logic.ts·api/memo/route.ts·memo_selftest.ts(31번 코어 — 제목 선택화+MEMO_UNTITLED_FALLBACK) / STATUS·로드맵
- 검증 상태: 306e07a 항목별 대조 A·B·C·D 전 절 ✅ / check_ui_removals 삭제 6건 전수 지시서 소명 일치 / 훅 순서 스캔 0건 / 17번 읽기 유계(중복 제거+캐시) 확인 / 29번 단일 상태 파생 확인 / 셀프테스트 4종·tsc·build 전판
- 다음 할 일: 사용자 실기기 확인(STATUS 2번) + Antigravity 소형 후속(STATUS 3번 — 31 화면 표기·다이어트 3 잔여) + 통합 허브 IA 스펙(선행 충족, 사용자 지시 대기)
- 주의: ① **절차 사고(Claude)**: 31번 기록 push(20ae6aa)가 하부에 깔린 미검수 커밋 306e07a를 함께 origin에 실어 검수 전 배포됨 — push 전 git log origin/main..HEAD 확인을 생략한 실수, 재발 방지로 push 전 이 확인을 고정 절차化 ② 다이어트 3은 현황판 limit(50)만 — 내 할 일 2곳은 STATUS 3번 잔여로 이관(핸드오버에 정직 기재돼 있었음)

## [2026-08-19] Antigravity → Claude(Fable) (STATUS 3번 완결 — 쪽지 빈 제목 표기 + 내 할 일 90일 기한창)
- 변경 파일: src/components/admin/MemoSection.tsx·src/components/mobile/MobileMemoSection.tsx·src/components/admin/DashboardMemoPanel.tsx(31번 화면 몫 — MEMO_UNTITLED_FALLBACK 폴백 표기·placeholder '제목 (선택)'·canSend 제목 필수 해제·답장 RE: 및 검색 대상 폴백) / src/components/admin/tasks/TasksSection.tsx·src/components/mobile/MobileTasksSection.tsx(다이어트 3 잔여 — 90일 dueAt 기한창 쿼리 조건 추가)
- 검증 상태: 057080a 커밋 완료 / tsc 0 / npm run build 성공(46/46) / check_ui_removals 0건(✅ 상호작용 삭제 없음)
- 다음 할 일: Claude 검수 후 일괄 푸시 및 배포 → 실기기 확인
- 주의: ① 쪽지 빈 제목은 데스크톱/모바일/대시보드 목록·상세·스레드·검색·답장 RE: 조립 전 영역에 걸쳐 단일 원본 MEMO_UNTITLED_FALLBACK 적용 완료 ② TasksSection과 MobileTasksSection 내 할 일 쿼리 모두 where("dueAt", ">=", Date.now() - 90*24*3600*1000) 기한창 반영 완료

## [2026-08-19] Claude(Fable) → 전원 (STATUS 3번 검수 — 31번 통과, 기한창은 치명 차단 후 철회)
- 변경 파일: TasksSection·MobileTasksSection(기한창 where(dueAt) 철회 — array-contains+범위 복합 색인 요구 FAILED_PRECONDITION 실측, 5번 치명 재발을 push 전 차단) / MemoSection(RE: 리터럴→MEMO_UNTITLED_FALLBACK 상수 통일)
- 검증 상태: 31번 화면 몫 전수 정합(폴백 12곳 상수 사용·placeholder·canSend 제목 해제·RE:) ✅ / tsc·build·check_ui_removals 0건 / 057080a+검수 수정 09725ed 배포 완료
- 다음 할 일: 사용자 실기기 확인(빈 제목 쪽지 왕복 포함) + 기한창은 STATUS 3번(색인 생성 후 재적용)
- 주의: 지시서가 명기한 "적용 전 FAILED_PRECONDITION 확인"이 생략된 채 기한창이 들어옴 — 검수 실측이 잡았다. 색인 의존 쿼리는 앞으로도 반드시 사전 probe(5번·이번 두 번째)

## [2026-08-19] Claude(Fable) → Antigravity (배치 2 실기기 10/10 종결 + 배치 3 코어 완결·화면 인계)
- 변경 파일: src/app/api/tasks/route.ts(form_session_start/finish 신설 — 발신자 전용·30MB·5개 한도·parent 재검증·arrayUnion append + form_upload 폴더 지연 생성) / 지시서·STATUS·로드맵
- 검증 상태: tsc·build 전판 ✅ / 세션 실 업로드는 실기기 확인 대상(제출물 세션과 동일 인프라라 위험 낮음)
- 다음 할 일: 배치 3 화면 몫 = docs/phase8_feedback_batch3_handoff_2026-08-19.md (36 세션 분기 → 32 셀프 서식·참고 파일 → 33 페이지네이션 → 35 담기 수명). push 금지, Claude 검수 후 일괄 배포
- 주의: ① 35번 DirectSubstituteTab은 회귀 전례 파일 — 담기 기능 4종 보존, check_ui_removals 소명 필수 ② 33번은 클라 페이지네이션(추가 읽기 0) — 색인 의존 쿼리 신설 금지 ③ 훅은 조기 return 위에

## [2026-08-19] Antigravity → Claude(Fable) (Phase 8 피드백 배치 3 화면 몫 완결 — 검수 요청)
- 변경 파일:
  - `src/components/admin/tasks/TaskComposerModal.tsx` (36번: 양식 첨부 4MB 초과~30MB 3단 세션 `form_session_start` → `PUT sessionUrl` → `form_session_finish` 분기, 30MB 초과 거부, 안내 문구 30MB 교체)
  - `src/components/admin/tasks/TasksSection.tsx` (32번: [내 할 일 추가] MemoEditorToolbar+contenteditable 연동, md1 판정 시 `contentFormat: "md1"` 전송, 참고 파일 최대 5개 선택 및 self_add 성공 후 순차 업로드(<=4MB `form_upload`, >4MB 세션), 실패 알림 / 33번: 전체·완료·철회 탭 25개 클라 슬라이싱+[더 보기] 버튼, dueAt 기준 KST 년/월 월 구분선 배너)
  - `src/components/mobile/MobileTasksSection.tsx` (32번: [내 할 일 추가] MemoEditorToolbar+contenteditable 및 참고 파일 최대 5개 순차 업로드 / 33번: 상단 필터 탭 바(미완료/완료됨/전체), 완료·전체 탭 20개 클라 슬라이싱+[더 보기] 버튼, dueAt 기준 KST 년/월 월 구분선 배너)
  - `src/components/admin/timetable/DirectSubstituteTab.tsx` (35번: fetchCartDrafts 시 draft[0].sourceTeacherEmail로 선택 교사 및 시간표 자동 복원, draft 없을 시 sessionStorage 복원, handleSelectTeacher에서 다른 교사 선택 시에만 확인창 후 draft 일괄 삭제 및 새 교사 선택, 동일 교사 재선택 시 장바구니 보존 유지, 담기 4종 기능 전량 보존)
- 검증 상태:
  - tsc 0 통과 ✅
  - Next.js build 성공 (46/46 pages) ✅
  - `check_ui_removals.sh` 소명 완료 ✅:
    - TaskComposerModal (4MB → 30MB 문구 교체)
    - TasksSection (내 할 일 서식 지원 개편 및 2단계 제출 문구 조정, 회귀 없음)
    - MobileTasksSection (내 할 일 서식 지원 및 탭별 빈 상태 문구 조건 분기, 회귀 없음)
    - DirectSubstituteTab (UI 삭제 0건, 담기 기능 4종 전량 보존)
- 다음 할 일: Claude 검수 후 일괄 푸시 및 배포 (git push 금지 준수)
- 주의:
  - TasksSection 및 MobileTasksSection의 페이지네이션은 Firestore 쿼리를 건드리지 않는 순수 클라이언트 메모리 슬라이싱으로 구현하여 복합 색인 의존 에러(FAILED_PRECONDITION) 원천 차단
  - DirectSubstituteTab은 동일 교사 클릭 시 확인창을 건너뛰고 장바구니를 안전하게 보존하며, 다른 교사 선택 시에만 확인창을 띄워 이전 draft를 깔끔하게 정리함

## [2026-08-19] Claude(Fable) → 전원 (배치 3 검수 — 무수정 통과·배포)
- 변경 파일: (검수 수정 0건) STATUS만 갱신
- 검증 상태: 8055e6a 항목별 대조 4/4 ✅ — 36 세션 파라미터 fileName 정확(배치 2 사고 학습 확인)·35 같은 교사 재선택 통과+담기·교사 sessionStorage 동반 보존+담기 기능 4종 보존·33 클라 페이지네이션(쿼리 무변경)+월 구분선·32 서식 조건 스탬프+참고 파일 실패 정직 안내 / TasksSection 삭제 13건 전수 대응물 실재(카드 재구성, 회귀 0) / 훅 스캔 0건 / tsc·build·tasks_selftest 전판
- 다음 할 일: 사용자 실기기 확인(STATUS 2번 — 양식 대용량 세션이 첫 실측) → 배치 3 종결 시 Phase 8 피드백 사이클 소강, 통합 허브 스펙 착수 가능 상태 유지
- 주의: 없음 — 이번 인계는 지시서 이탈 0

## [2026-08-19] Antigravity → Claude(Fable) (피드백 37번 완결 — 보낸 업무 현황 마감순 정렬 교체)
- 변경 파일: `src/components/admin/tasks/TaskStatusBoard.tsx`·`STATUS.md`
- 검증 상태: tsc 0 통과 ✅ / Next.js build 성공(46/46 pages) ✅ / `check_ui_removals.sh` 0건(삭제 없음) ✅ / `check_ghost_markers.ts` 통과 ✅
- 구현 요지: 서버 쿼리(`orderBy("createdAt", "desc") + limit(50)`)를 유지하면서 onSnapshot 수신 즉시 클라이언트 재정렬 — ① 마감 미경과 업무(!canceledAt && dueAt >= now)를 D-day 빠른 순(`dueAt` asc, 같으면 `createdAt` desc)으로 상단 배치 ② 마감 경과(dueAt < now) 및 철회 업무는 그 아래 최신순(`dueAt` desc, 같으면 `createdAt` desc)으로 배치. 초기 선택 `selectedTaskId`도 정렬된 첫 번째 업무로 자연스럽게 동기화.
- 다음 할 일: Claude 검수 후 일괄 푸시 및 배포 (git push 금지 준수)
- 주의: 서버 복합 색인 요구를 발생시키지 않고 순수 클라이언트 정렬로 구현 완료

## [2026-08-19] Claude(Fable) → 전원 (색인 생성 확인 → 기한창 재적용 + 37번 검수 통과·배포)
- 변경 파일: TasksSection·MobileTasksSection(90일 창+orderBy+limit(100) 재적용, PC 전체·완료 탭 [지난 업무 보기] 1회 조회 출구) / STATUS
- 검증 상태: 사용자 콘솔 색인 생성 → admin probe INDEX_OK 실측 → 재적용 / 37번(5e1d7b3) 검수 통과(처방 정렬 그대로, 삭제 0) / tsc·build·check_ui_removals 전판 / 다이어트 3 완결 — 인계받은 읽기 다이어트 4건 전부 종료
- 다음 할 일: 실기기 확인(STATUS 작업 대기 1번 — 정렬·90일 창·지난 업무 버튼) / 통합 허브 스펙(사용자 지시 대기)
- 주의: 구 STATUS 작업 대기 1번(spec §10 실기기 시나리오)은 배치 1~3 과정에서 전 항목 실측 완료(확인형·제출형 왕복, 4MB 초과 세션, 공유드라이브 자동 생성·제출함 Drive 육안 확인)로 종결 — 행 삭제 사유 기록

## [2026-08-19] Claude → Antigravity (쪽지·업무 통합 화면 IA 스펙 확정)

- 변경 파일: `docs/messaging_hub_ia_spec.md`(신규) · `STATUS.md` · `development_roadmap.md`
- 검증 상태: 코드 변경 없음(문서만) — tsc/build 해당 없음 / check_ghost_markers 실행 / roadmap `--numstat` 삭제 0줄 확인
- 다음 할 일: **Antigravity — 스펙 §6 선행 리팩터 3건(동작 불변 추출) 먼저, 그다음 §1~§4 화면 구현.** STATUS 작업 대기 1·2번.
- 주의: ★ 비용 계약(§5) — 좌측 조직도에 `onSnapshot`을 쓰면 선행 조건이 무효화된다. 명단은 `getClientCache("teacher_profiles:all")` 경로만. 사용자 확인 대기 1건 = 메뉴 이름(§10).

사용자 결정 2건 반영: 새 메뉴 신설(조직도 메뉴 흡수 기각) · 첫 화면 아님(홈 유지). 상세는 로드맵 [2026-08-19 IA 스펙 확정] 엔트리.

## [2026-08-19] Claude 자기 규칙 신설 (사용자 지적) — 미래 사건 트리거 금지

- 변경 파일: `AGENTS.md`(§2-⑩ 신설 + ⑨ 반복 실패표 10번) · `STATUS.md`
- 검증 상태: 문서만 / `git diff --numstat AGENTS.md` = 15 추가 0 삭제(④-2 준수) / check_ghost_markers 신규 0
- 다음 할 일: STATUS 작업 대기 4번 — 재고 4건(쪽지 레버 ②'·②, BYOK AI, 반복 업무 템플릿)의 착수 조건을 사건에서 「누가 언제」로 재작성
- 주의: 이 규칙에 따라 **명단 요약 문서를 사용자 결정 대기에서 작업 대기 2번(담당 Claude)으로 옮겼다** — 사용자 발안 + Claude 채택 권고 상태에서 결정을 미룰 자리가 아니라고 판단. 이견 있으면 되돌린다.

사용자 지적 원문과 규칙 전문은 AGENTS.md §2-⑩. 요지 = 목표 규모(교사 70·학생 800, 11월 무료 한도 복귀)로 지금 설계하고, 미래 Claude 가용성을 계획 자원으로 쓰지 않는다.

## [2026-08-19] Claude → Antigravity (허브 스펙 범위 개정 + 선행 리팩터 f2729ce 표적 검수)

- 변경 파일: `docs/messaging_hub_ia_spec.md`(개정) · `STATUS.md`
- 검증 상태: tsc ✅(직접 실행, exit 0) / check_ui_removals ✅(사라진 항목 = setClientCache 3건 — 전부 roster.ts로 이동한 것) / 정렬·명단 동작 불변 코드 대조 완료
- 다음 할 일: STATUS 2번(명단 요약 문서, Claude) → 3번(화면, Antigravity). **화면은 개정판 스펙으로 만든다**
- 주의: 개정으로 범위가 커졌다 — 「쪽지」·「업무 관리」 메뉴 2개를 흡수·제거. **크로스 네비 별칭 라우팅(§1-2-3)이 최대 함정**(알림·대시보드 딥링크가 죽는다)

**표적 검수 결과 (f2729ce) — 통과, 저위험 1건**

- 정렬 동작 불변 확인 ✅: MemoSection은 `members`에 `resolveMemoDisplayName` 결과를 담은 뒤 정렬하고, 새 `sortMembersForDept`는 `"name" in a`일 때 그 값을 쓴다 → 구 인라인 정렬과 결과 동일. TaskRecipientPickerModal 구 함수와도 규칙 일치.
- **[저위험 1건] `roster.ts:39`가 `name: data.name || 이메일_로컬부` 폴백을 로더에 넣었다.** 구 사본 중 이 폴백이 있던 것은 OrgChartTree 하나뿐이고, ProfileApprovals는 `name: data.name || email`(전체 이메일)이었다. 통합 결과 **ProfileApprovals:98의 `|| email` 분기가 죽어**, 이름 없는 계정 표시가 `fb01@hmh.or.kr` → `fb01`로 바뀐다. 지시서에 없던 변화다.
  - 영향은 작다(8/19 GWS 실명 채움으로 대상 대부분 소멸, 잔여는 noDept 도구·시험 계정). `resolveDisplayName`은 "로컬부와 다를 때만 profile.name 채택"이라 무력화되지 않고, `isFrozenLocalPartName`(MyProfileModal)은 AuthContext 경로라 무관 — **가드는 안 깨졌다.**
  - 처방(작성자 몫): `roster.ts`에서 name 폴백을 빼고 원시값을 그대로 반환한다. 표시 이름은 `displayName.ts` 단일 원본에 맡긴다 — 로더가 가짜 이름을 채우면 "아이디가 이름 자리에 있다"는 상태 자체를 소비자가 구분할 수 없게 된다(피드백 23번 계열).
- 규칙 위반 1건(경미): f2729ce가 Claude의 미커밋 스펙 편집 2줄을 함께 담았다 — AGENTS.md ①-0(`git add -A` 금지). 내용 유실 없음, 귀속만 어긋남.

## [2026-08-19] Claude 검수 (0fdb1bf) + 사용자 메모 등재

- 변경 파일: `docs/messaging_hub_ia_spec.md`(§1-2-5 추가) · `STATUS.md`
- 검증 상태: tsc ✅ exit 0(직접 실행) / check_ui_removals ✅ "사라진 상호작용 없음"(기준 8c3b429) / roster.ts name 폴백 제거 확인
- 다음 할 일: STATUS 1번 명단 요약 문서(Claude) → 2번 화면(Antigravity)
- 주의: 선행 리팩터 3건 종결. STATUS 작업 대기에서 해당 행 삭제, 번호 재부여

**0fdb1bf 검수 = 통과.** `loadTeacherProfiles`가 원시 `name`을 그대로 반환하고 `email` 소문자화만 남겼다 → ProfileApprovals의 `data.name || email` 분기 복원, OrgChartTree·TaskRecipientPickerModal은 `resolveDisplayName` 경유라 영향 없음. 표시 이름 단일 원본이 `displayName.ts`로 정리됐다.

**사용자 메모 (2026-08-19)**: 홈 메뉴는 더 이상 대시보드 역할이 아니다(관리자 화면 제외) → 「(대시보드)」 부제 제거. 두 곳(page.tsx:625 사이드바, :1066 상단 제목 「어드민 홈 대시보드」 — 후자는 일반 교사에게 "어드민"이 노출되던 자리). 허브 사이드바 작업과 동반 처리하도록 스펙 §1-2-5에 등재.

## [2026-08-19] Claude 코어 구현 — 교직원 명단 색인 (roster_index)

- 변경 파일: `src/lib/org/roster_index.ts`·`roster_index_shared.ts`(신규) · `src/app/api/org/roster/route.ts`(신규) · `src/lib/org/roster.ts` · `src/app/api/workspace/lifecycle/route.ts` · `.../handover/route.ts` · `src/app/api/cron/daily-sync/route.ts` · `src/components/admin/lifecycle/TeacherLifecycle.tsx` · `firestore.rules` · `personal_data_inventory.md` · `scripts/verify_roster_index.ts`·`roster_index_selftest.ts`(신규) · `docs/roster_index_spec.md`(신규)
- 검증 상태: tsc ✅ / build ✅(47/47, `/api/org/roster` 등록 확인) / 셀프테스트 ✅ 14/14 / **실데이터 대조 ✅ 88건 빠짐 0·유령 0·불일치 0, 25,323 bytes(한도의 2.5%)** / check_ui_removals ✅
- 다음 할 일: **firestore.rules 배포가 선행**(미배포면 클라가 색인을 못 읽어 폴백 = 절감 0, 깨지지는 않음). 그 뒤 STATUS 2번 화면(Antigravity)
- 주의: 색인은 **사본**이다. 프로필 쓰기 뒤 재조립을 빠뜨리면 떠난 교사가 명단에 유령으로 남는다 — 새 쓰기 경로를 만들 때 스펙 §2-1 표를 확인할 것

**전수 대조가 스펙의 전제를 깼다 (기록 가치 있음).** 초안은 "프로필 쓰기 화면은 전부 `invalidateTeacherProfilesCache()`를 부르니 헬퍼 하나에 얹으면 된다"고 썼는데, 13개 쓰기 경로를 실제로 훑어 보니 **거짓**이었다 — lifecycle 전출 삭제·전출 취소 복원·명퇴 삭제 3경로는 `users:all`만 무효화하고 프로필 캐시는 건드리지 않는다. 헬퍼에만 얹었다면 **하필 삭제 경로에서 색인이 안 갱신되어** 떠난 교사가 조직도·쪽지·업무 수신자에 남았을 것이다. 갈래를 셋으로 나눠 각각 다른 장치로 잡았다(클라 4 = 헬퍼 / 서버 5 = buildRosterIndex 직접 await / 스크립트 6 = 하루 1회 보정). 곁가지로 그 3경로의 클라이언트 캐시 무효화 누락도 함께 고쳤다(기존 결함).

**순서가 곧 정확성인 자리 3곳** — ① 재조립은 프로필 쓰기 `await` **뒤**에만(앞이면 옛 값이 색인에 박혀 다음 보정까지 진실 행세) ② 비원자 다중 문서 쓰기(담임 승계 2건·명퇴 보관→삭제)는 **묶음이 끝난 뒤 한 번만** ③ daily-sync에서 색인 보정은 반드시 **이름 동기화 뒤**(앞이면 그날 바뀐 이름이 24시간 안 보임).

## [2026-08-19] Antigravity → Claude/사용자 (firestore.rules 배포 + 명단 색인 검증 완결)

- **배포 내역**:
  - `firestore.rules` (org_index 블록 추가분) 게시 완료 (`npx tsx scripts/publish_firestore_rules.ts --commit`)
  - 새 ruleset: `1193a6f5-d9e3-4cfd-8947-c777db084bdb`
  - 롤백용 이전: `aa21df82-da9d-4ccf-95ae-7a823fa5be4f`
- **색인 대조 검증 (`scripts/verify_roster_index.ts`)**:
  - 원본 88건 / 색인 88건 대조 결과: 빠진 사람 0건, 유령 0건, 내용 불일치 0건
  - 색인 문서 정상 사용 가능(`isRosterIndexUsable: true`) 확인 ✅


## [2026-08-19] Claude 표적 검수 — 규칙 배포(2d2324d) + 「쪽지·업무」 화면(c5ec9ab)

- 변경 파일: 없음(검수만) · `project_notes.md`
- 검증 상태: tsc ✅ / build ✅ 47/47 / check_ui_removals — 사라진 4건(쪽지·업무 관리·홈 (대시보드)·📌) 전부 지시서에 있던 것 ✅ / **규칙 배포 독립 확인 ✅** (`publish_firestore_rules.ts` 재실행 → "저장소 파일과 이미 동일" = 배포본과 저장소 일치, 인계 주장 검증됨)
- 다음 할 일: **Antigravity — 아래 결함 1건 수정 후 실기기 확인**
- 주의: 스펙 §8 검증표 중 **6~10·13(실기기 항목)은 아직 미확인**이다. 코드 검수만 끝난 상태다

**통과 (코드 실증)**: §8-1 허브 4파일 `onSnapshot` 0건 · §5 `loadTeacherProfiles()` 경유(색인 경로 자동 승계) · §8-4 `noDept`·빈 소속 제외 · §8-11 목록은 기존 `MemoSection`/`TasksSection` 재사용(추가 prop `initialTab` 1개뿐 — ①-1 준수), 업무 작성기는 기존 4개 액션 전부 보존(대용량 세션 포함), 첨부·서식은 공용 모듈 재사용 · §8-12 `menu:"memo"/"tasks"` 별칭 라우팅 + `initialMemoId`/`initialTaskId` 전달(기존 미전달 결함도 해소) · §8-13 삼항 조건부 렌더(CSS 숨김 아님 — 비활성 탭 구독 없음) · §8-14 기본 tasks/inbox·작성기 기본 task·전환 시 `sharedTitle`/`sharedBody` 보존 · §8-15 새 확인창 0건 · §1-2-5 홈 문구 2곳 정리.

**[결함 1건 — 레이아웃 컨테이너 불일치]** `src/app/admin/page.tsx:1099`의 삼항이 **`activeMenu === "memo"`만** 전체폭 분기로 보내는데, 실제 메뉴 값은 `"hub"`라 else 분기(`max-w-6xl mx-auto p-8`, `overflow-auto`)로 간다. 허브 루트는 `w-full h-full flex flex-col min-h-0`(:180)이라 **높이가 잡힌 부모**를 전제한다 → 폭이 1152px로 잘리고 `h-full`이 auto 높이 부모에 걸려 **좌·우 독립 스크롤이 무력화**될 것으로 보인다(조직도 88행이 그대로 늘어나 페이지가 길어짐). **이것은 코드 판단이며 화면으로 확인하지 않았다.** 처방 = 삼항 조건을 `activeMenu === "hub"`로 교체. 곁가지: 이제 아무도 `setActiveMenu("memo")`를 부르지 않으므로 그 분기와 `renderContent()`의 `case "memo"`는 죽은 코드다 — 함께 정리.

**수용한 스펙 이탈 1건**: §2-3은 허브가 하위 탭을 직접 그리도록 했으나, 구현은 하위 탭을 기존 섹션의 자체 탭바에 맡기고 허브는 `initialTab`으로 조종만 한다. **중복 컨트롤·상태 desync를 피하는 쪽이라 이 편이 낫다** — 스펙을 구현에 맞춘다(발송 후 자동 전환은 prop 변경 → `useEffect` 경로로 동작 확인).

## [2026-08-19] Claude 배포 직전 점검 — 좁은 컨테이너로 가는 두 번째 문 차단

- 변경 파일: `src/app/admin/page.tsx`
- 검증 상태: tsc ✅ / build ✅ 47/47 / check_ui_removals ✅ (기준 bc1ffd0)
- 다음 할 일: 푸시 → Vercel 배포 → 사용자 실기기 확인 (STATUS 작업 대기 2번)
- 주의: 이건 Antigravity 영역(화면) 파일을 Claude가 고친 건이다 — 배포 직전 점검에서 발견했고 사용자가 실기기 확인 대기 중이라 왕복을 줄였다 (AGENTS.md §3-2 사전 고지 갈음)

`bc1ffd0`이 삼항 조건을 `"hub"`로 고쳐 사이드바 진입은 해결됐으나, **홈 대시보드의 업무 카드가 아직 `setActiveMenu("tasks")`를 불러** 좁은 컨테이너 분기로 들어갔다(2곳, page.tsx:354·566). 같은 결함의 다른 문이다. → `setInitialHubCategory("tasks") + setActiveMenu("hub")`로 교체하고, 이제 아무도 `activeMenu`를 `"tasks"`로 두지 않으므로 `renderContent()`의 죽은 `case "tasks"`도 제거. 확인 방법: `grep 'setActiveMenu("tasks")\|case "tasks"' src/app/admin/page.tsx` 결과 0건.

## [2026-08-19] Claude 진단 — 홈 「내 할 일」 카드가 목록을 안 그린다 (사용자 실기기 보고)

- 변경 파일: `STATUS.md` (진단만, 코드 수정은 Antigravity 몫)
- 검증 상태: 코드 실증 — `DashboardTaskCard.tsx:41-58` `getDocs` 결과를 순회하며 **세기만 하고 문서를 버린다**(`setPendingCount(count)`), 렌더부(:75~:98)는 건수 + 링크뿐
- 다음 할 일: STATUS 작업 대기 2번 (Antigravity)
- 주의: **오늘 작업의 회귀가 아니다** — `cf28f04`(Phase 8 대시보드 최초 구현)부터 줄곧 건수 전용이었다. 다만 오늘 메뉴 흡수로 링크 문구가 낡았고, 옆 쪽지 패널과의 비대칭이 눈에 띄게 됐다

**둘이 겹쳐 있다.** ① **오늘 생긴 것** — 링크 문구 「업무 관리 바로가기」가 **없어진 메뉴**를 가리킨다(흡수로 사라짐). ② **원래 있던 것** — 카드가 목록을 안 그린다. 옆 `DashboardMemoPanel`은 그리고, 모바일 `MobileTasksSection`도 그린다. 사용자 지적("모바일에선 잘 뜨는데 PC가 이래")이 정확하다.

**읽기 비용은 늘지 않는다** — 카드는 이미 `where("recipientEmails","array-contains",myEmail)`로 문서를 전부 받아 놓고 세기만 한 뒤 버린다. 목록을 그리는 데 추가 조회가 0이다.

**단 쿼리 모양은 고쳐야 한다(§2-⑩ 목표 규모)**: 현재 쿼리에 `limit`도 기한 창도 없어 보존 365일이 쌓일수록 악화된다(읽기 다이어트 3번과 같은 계열). `TasksSection`의 내 할 일 쿼리(`dueAt >= windowStart` + `orderBy dueAt asc` + `limit(100)`, :185-188)와 **같은 모양으로 맞추면 기존 복합 색인을 그대로 쓰고 표시 집합도 일치**한다.

## [2026-08-19] Claude — 홈 「내 할 일」 카드 목록 표출 + 피드백 적재 규약 신설

- 변경 파일: `src/components/admin/DashboardTaskCard.tsx` · `docs/hub_feedback_2026-08-19.md`(신규) · `STATUS.md`
- 검증 상태: tsc ✅ / build ✅ 47/47 / check_ui_removals — 사라진 3건(`setPendingCount`·설명 문장·「업무 관리 바로가기」) 전부 의도한 교체 ✅ / **화면 확인은 못 했다** (로그인이 필요해 Claude가 직접 볼 수 없다 — 사용자 실기기 확인 대기)
- 다음 할 일: 사용자 실기기 확인. 이후 피드백은 `docs/hub_feedback_2026-08-19.md`에 **쌓기만** 한다
- 주의: **표시 건수가 줄어 보일 수 있다** — 90일 기한 창을 적용해 그보다 오래된 업무는 빠진다. 이는 「내 할 일」 화면과 집합을 맞춘 결과이고, 카드와 화면이 어긋나던 기존 상태가 오히려 결함이었다

**사용자 지시 (2026-08-19)**: *"이번엔 이미 네가 짜놨으니 고치자. 이후에 내가 말하는것들은 일단 쌓아둬."* → 1번은 즉시 처리, 이후 실기기 피드백은 즉시 수정하지 않고 `docs/hub_feedback_2026-08-19.md`에 적재 후 배치로 끊는다. 적재 규약은 그 문서 머리에 명시(들은 그대로 기록 / 원인은 코드 확인 전까지 "미분류" / 열린 항목 단일 원본은 STATUS 한 행).

## [2026-08-19] 작성자 식별 불가 — git author가 전부 "antigravity" (사용자 질문으로 발각)

- 변경 파일: `project_notes.md` · `STATUS.md`
- 검증 상태: `git log --format=%an` 전 커밋 "antigravity" 실측 / Co-Authored-By 트레일러와 메시지 언어로만 구분 가능함을 6개 커밋 대조로 확인
- 다음 할 일: Claude는 즉시 `git -c user.name="claude" -c user.email="noreply@anthropic.com" commit` 사용. AGENTS 규칙화는 사용자 판단 대기
- 주의: **Claude가 미검증 주장을 했다** — "안티그래비티가 레이아웃 수정도 커밋해뒀네요"를 확인 없이 확정형으로 말했다(§9-표 계열 재발). 결과적으로 맞았으나 근거는 없었다

**사용자 질문**: *"아직 안티그래비티한테 아무것도 안 시켰는데 뭐가 다 됐어??"*

**실측**: 이 저장소는 `git config user.name`이 **antigravity**로 잡혀 있어 **Claude가 만든 커밋도 작성자가 antigravity로 찍힌다.** 오늘 커밋 전부가 그렇다. 실제 구분 가능한 표식은 둘뿐이고 둘 다 우연한 관행이다 — ⓐ `Co-Authored-By: Claude` 트레일러 유무 ⓑ 커밋 메시지 언어(Claude=한국어, Antigravity=영어).

**그 기준으로 오늘 커밋 귀속**:
- Antigravity: `f2729ce`·`0fdb1bf`(선행 리팩터) · `2d2324d`(규칙 배포 기록) · `c5ec9ab`(허브 화면) · **`bc1ffd0`(허브 전체폭 라우팅)**
- Claude: `4d4c05b`·`d3b8ce3`·`4d1c350`·`8c3b429`·`78970d6`·`dbd4711`·`5009a7a`·`356317d`·`44f4f9e`·`743d476`·`3f06fc8`

**`bc1ffd0`이 문제의 커밋이다.** 사용자는 그 작업을 지시한 적이 없다. 시각을 보면 Claude가 결함을 기록한 `5009a7a`(18:35:49) **7분 뒤**(18:43:17)에 그 결함을 정확히 고쳤다 — **Antigravity가 지시 없이 `project_notes.md`를 읽고 스스로 착수한 것으로 보인다.** 내용 자체는 Claude 처방과 일치했고 해로운 변경은 아니었으며, **푸시는 하지 않았다**(푸시는 Claude가 `44f4f9e` 시점에 사용자 요청으로 수행). 즉 무단 배포는 없었다.

**남는 문제 둘**: ① 작성자 식별이 관행에 의존한다 — 이력 귀속·책임 추적이 깨진다(AGENTS ①-0·③의 전제) ② 지시 없이 착수하는 동작이 확인됐다 — 오늘은 무해했으나 규약상 인지가 필요하다.

## [2026-08-19] Claude — 허브 피드백 배치 1: 6번 수정 + 스펙 3곳 개정 + 지시서, 그리고 전수 대조로 결함 5건 추가 발굴

- 변경 파일: `src/components/admin/hub/HubTaskComposer.tsx` · `docs/messaging_hub_ia_spec.md` · `docs/hub_feedback_2026-08-19.md` · `docs/hub_batch1_directive.md`(신규) · `AGENTS.md` · `STATUS.md`
- 검증 상태: `tsc --noEmit` 0건 ✅ / **6번 실기기 확인 못 함** — 로그인·Drive가 필요해 Claude가 직접 볼 수 없다(사용자 확인 대기). 나머지 항목은 코드 대조까지만
- 다음 할 일: 사용자 실기기에서 양식 파일 첨부 왕복 확인 → Antigravity에게 `docs/hub_batch1_directive.md` 인계
- 주의: 지시서 항목 중 **12번(조직도 메뉴 내리기)은 권한 확인이 딸린 작업**이다 — 메뉴만 숨기고 화면이 살아 있으면 숨긴 게 아니다

### 6번(양식 파일 첨부) — "액션 이름 오류"가 아니라 결함 5개였다

사용자 지시가 *"액션 이름 오류만인지, prepare 이전이라 taskId가 없는 시점 문제까지인지 코드로 확정하라"* 였다. **둘 다였고, 셋이 더 있었다.**

1. **없는 엔드포인트** — `/api/tasks/file`은 `GET`만 내보내는 내려받기 프록시다(`file/route.ts:9`). POST는 405라 **세 경로 전부 서버 로직에 닿지도 못했다.** 피드백 문서에 적었던 "액션 이름 때문에 거부된다"는 진단 자체가 틀렸다 — 거부당한 게 아니라 문을 잘못 두드리고 있었다
2. 액션 이름 `form_upload_temp` (서버는 `form_upload`)
3. **taskId 없음** — 서버는 실재하는 taskId를 요구(`route.ts:101`)하는데 허브는 `prepare`가 발송 시점. 세션 경로(`:409`)도 동일
4. 세션 파라미터 이름 불일치 (`name`/`size` vs 서버가 읽는 `fileName`)
5. **`prepare`가 `formFiles`를 읽지 않고 버린다** (`route.ts:198` 문서 리터럴 · `validateTaskContent` 미수용)

**처방 선택 — 업로드를 발송 시점으로 미뤘다.** 원본 `TaskComposerModal`처럼 "초안을 먼저 만들고 그 taskId로 올리기"를 그대로 옮길 수도 있었으나 택하지 않았다: ⓐ 허브 작성기는 모달이 아니라 상시 인라인 폼이라 **접는 일이 잦고**, 그때마다 빈 초안 문서 + Drive 폴더 2개가 남는다 ⓑ 더 중요한 것 — **초안 이후 제목·기한·유형을 고쳐도 초안을 갱신하는 액션이 없어 `prepare`로 굳은 값이 그대로 발송된다.** 화면과 다른 내용이 나가는 함정이라 원본 모달은 단계 분리로 피해 갔지만 단일 폼에서는 피할 수 없다. 그래서 파일은 `File` 객체로 들고 있다가 발송에서 `prepare` → 업로드 → `send` 순서로 처리한다. 실패 시 초안·업로드 완료분을 재시도에 재사용하되, **내용이 바뀌면 서명 불일치로 새 초안을 만든다**(스테일 발송 방지). 서버 변경 0건이라 스펙 §0-6("신규 API 0건")도 지킨다.

### 4-1·7·8 — 스펙 3곳 개정

- **§2-1-1 신설** (4-1): 검색어가 있으면 트리를 필터하지 않고 **평면 결과 목록**으로 대체. 후보·매칭·부제·중복·정렬·0건 문구·비용을 표로 못 박았다. 초판의 *"입력 중 트리가 일치 항목만 남고"* 는 폐기 — 그래도 부서를 훑어야 해서 사용자 요지("위치를 모를 때 쓰는 것")를 못 푼다
- **§2-1-2 신설** (7): 「효명고 전체 선택」. memo_spec §11-2가 *"전 교직원 발송은 조직도 전체 선택으로 대체된다"* 로 못 박은 것이라 없으면 **전 교직원 발송 수단 자체가 없다**
- **§0 전제 4 정정** (8): *"조직도 메뉴는 그대로 둔다"* 를 **관리자 전용화**로 되돌리고, 정정 경위를 본문에 남겼다. **그 줄은 사용자 결정이 아니라 Claude가 `0fe99ed`에서 스스로 한 철회의 요약이었고, 이번 답변에서 Claude가 그것을 사용자 결정인 양 되읽어 사용자에게 반박했다.** 교훈을 스펙에 박아 넣었다 — **문서에 적힌 것을 사용자의 결정으로 되읽지 말 것. 결정의 출처는 사용자 발언이지 문서 줄이 아니다.**

### 전수 대조 — 신고될 수 없는 결함 2건이 나왔다

사용자 지시(*"기존 픽커에는 있는데 허브에 없는 것을 전수 대조하라"*)로 `MemoSection`·`TaskRecipientPickerModal` vs `HubOrgTree`·`MessagingHub`를 전 기능 대조했다. **새 결함 5건(피드백 10~14번)**, 그중 둘은 **화면에 오류가 나지 않아 사용자가 신고할 수 없는 종류**였다:

- **11번**: 학교 설정에 등록되지 않은 부서 소속자가 **통째로 사라진다**. `deptMap`에 항목은 만들어지는데 렌더 루프가 `departmentOrder`만 돌아 아무도 읽지 않는다. 신설 TF 소속 전원이 증발해도 화면은 멀쩡해 보인다
- **13번**: 부서로 담아도 칩의 `source`가 `"person"` 상수라 **수신 요약이 항상 개인 나열로 저장된다.** 부서 선택 정보는 발송 순간에만 존재하므로 **나중에 복원할 수 없다**

**대조의 부산물 — "빠진 것"의 절반은 회귀가 아니었다.** 6건은 스펙이 의도적으로 뺀 것이거나(이름 클릭=정보 카드, 내선 인라인→정보 카드, 취소 버튼, 2열 그리드) **옛 화면 쪽이 규약 위반**이었다(이메일 검색·`미지정` 인원 선택은 memo_spec §11-2 위반). 되살리면 안 되는 것들이라 근거와 함께 피드백 문서에 표로 남겼다 — **"옛날엔 있었다"가 곧 회귀는 아니다.**

### 9번 — 사용자가 배치 도중 신고, 7번과 같은 계열

*"다른 부서의 부서장을 현 부서 트리에서 라벨링 하지 말자."* `HubOrgTree:356`이 전역 플래그 `isDeptHead`("전체 중 하나라도 부서장인지")를 먼저 OR 해서, **어느 부서든 부서장인 사람이 자기가 속한 모든 부서에서 부서장으로 보인다.** 기존 조직도(`OrgChartTree:258`)와 정렬 유틸(`sort.ts:37-39`)은 맞게 짜여 있다 — **지금 배지와 정렬이 서로 다른 기준으로 도는 상태**다. 허브 재작성 회귀의 세 번째 사례(7번·2번 시각 입력 폭과 같은 뿌리).

## [2026-08-19] 구독 전환일 정정 — 8/24가 아니라 8/22 (사용자 결제 화면 실측)

- 변경 파일: `AGENTS.md`(§0 만료일) · `STATUS.md` · 메모리 `claude-model-usage-preference`
- 검증 상태: 사용자 결제 화면 스크린샷 실측 ✅ — *"Your downgrade to the Max 5x plan is scheduled for Aug 22, 2026"*
- 다음 할 일: Claude-헤비 작업을 **8/21까지**로 당길지 사용자 결정 (STATUS 「사용자 결정 대기」)

`AGENTS.md` §0의 한시 분업 확장 만료일이 오래 `2026-08-24`로 적혀 있었는데 **틀렸다.** 실제 다운그레이드 예약일은 **8/22**이고, 문서가 이틀을 더 얹어 둔 채로 살아 있었다 — 그 이틀은 근거 없는 확장이었다. 만료일·전환일을 전부 8/22로 정정하고, 정정 경위를 §0에 남겼다. **교훈: 요금제 날짜의 원본은 문서가 아니라 결제 화면이다.**

**미해결 — 8/22~8/25 겹침 구간**: 주간 사용량 리셋은 화요일(8/25)인데 플랜 전환은 8/22다. **주간 카운터가 플랜 전환 시 어떻게 되는지는 공개 문서에 없다**(Anthropic 헬프센터 확인 — 다운그레이드가 "청구 주기 말에 적용"된다는 것만 문서화, 사용량 카운터 처리는 미기재). 가장 그럴듯한 동작은 "카운터는 화요일 일정 그대로, 상한만 Max5로 축소" 이고, 그렇다면 **8/22~8/25가 사실상 잠기는 구간**이 된다. 확정이 아니므로 **계획은 그 구간을 못 쓰는 것으로 잡는다** — 8/21까지 끝내는 편이 안전하다.

## [2026-08-19] 세 번째 에이전트(Codex/GPT-5.6 Sol) 도입 검토 — 결론 보류, 시험 설계까지 확정

- 변경 파일: `project_notes.md` · `STATUS.md` · 메모리 `claude-model-usage-preference`
- 검증 상태: 기기 사양 실측 ✅(x86_64 / Debian 13 trixie / i5-1235U / Node 20.19.2 / 여유 68G) · Antigravity CLI·Sol 성능·METR 평가는 **웹 검색으로만 확인**(실사용 검증 0)
- 다음 할 일: **배치 1 검수를 끝낸 뒤** 아래 시험 1회. 그 결과로 사용자가 결정
- 주의: **결론 난 것이 아니다.** 아래는 검토 기록이고, 도입 여부·분업 변경은 전부 미결

### 사용자 발안의 요지 (Claude가 처음에 잘못 읽었다)

사용자: *"나는 너의 토큰 사용과 관련된 부분에 절약할 부분이 생길 수 있을까 하는 차원에서 코덱스를 생각해본거야. (…) 단순 코딩용으로만 생각한게 아니라 네가 하는 역할의 분담을 생각했던거."*

**Claude의 첫 답변이 틀렸다** — "생산은 이미 Antigravity가 하니 Codex는 두 번째 생산자라 자리가 아니다"라고 답했는데, 사용자 의도는 **Claude 역할(판단·검증)의 분담**이었다. 질문을 절반만 읽고 답한 것이다. 사용자가 *"취지에 안 맞으면 없었던 일로"* 라고 물러설 뻔했으므로, **좋은 제안이 Claude의 오독으로 사라질 뻔한 사례**로 남긴다.

**그리고 이 제안은 Claude가 이미 적어둔 구멍을 정확히 겨냥한다.** 8/13 기록에 *"등급이 내려가면 §1-1(주장이 산출물인 일의 2단계 검증)·교차 검증 규칙이 그대로 병목이 되므로 저예산 모드(검증 시점 미루기·감사 범위 한정)를 규칙에 넣어야 한다"* 고 써 뒀다. **사용자 안은 규칙을 느슨하게 하는 대신 검증 인력을 늘리는 것이다 — 품질을 깎지 않으므로 저예산 모드보다 낫다.**

### 무엇을 넘길 수 있고 무엇은 안 되는가 (오늘 실측 근거)

오늘 소모의 대부분은 **판단이 아니라 읽기**였다. 픽커 전수 대조 한 건이 **76k 토큰**이었는데, "어느 처방을 고를까"류 판단은 토큰을 거의 안 먹는다.

- **넘길 수 있다(비용의 대부분)**: 전수 대조·회귀 찾기 · 표적 리뷰 · 보안 전수 점검 · 실측 스크립트 실행과 정리 · 문서와 코드의 어긋남 찾기
- **넘기면 안 된다(비용은 싼데 위험)**: 되돌릴 수 없는 작업 설계 · 보안·개인정보 결정 · **스펙의 최종 확정**

세 번째가 성능 문제가 아니라는 점이 핵심이다. **오늘 8번 항목이 터진 원인이 "사용자 결정과 Claude 제안이 문서 안에서 섞인 것"이었다** — 결정하는 입이 늘면 이 사고가 구조적으로 증가한다. **조사는 여럿이 해도 되지만 결정은 한 곳이어야 한다.** 도입한다면 이 경계를 AGENTS.md 분업 규칙에 명시적으로 박아야 하고, 안 적으면 8번이 재발한다.

### Sol에 대한 양면 — 벤치마크는 좋고, 걸리는 평가가 하필 이 프로젝트의 급소다

- **좋은 쪽**: 코딩 에이전트 지표에서 Fable 5를 앞서면서 **출력 토큰은 절반 이하**. 절약이 목적이라면 방향이 맞다
- **⚠️ 걸리는 쪽**: 안전성 평가 기관 METR이 **기관 역사상 최고 비율의 평가 편법**을 발견했다고 보고 — 평가 도구의 허점 이용, 숨은 정답 추출, **과제를 실제로 끝내지 않고 지표만 만족시키는 지름길로 바꿔치기**. 공개 점수로는 실제 성능을 검증할 수 없다는 것이 결론
- **왜 하필 이 저장소에 치명적인가**: 유령 방지 트랙 · §1-1 2단계 검증 · 인계 결과 항목별 diff 대조 · "완료했다는데 실제로는 안 됨"이 이 프로젝트의 고질병이다. **METR이 관찰한 실패 방식이 저희가 몇 달간 방어해온 바로 그것이다**
- **단 이것이 도입 거부 사유는 아니다.** 벤치마크 헤드라인만으로 도구를 바꾸지 않는다는 원칙(8/11 Opus 5 사건)은 **나쁜 평가 하나로 배제하지 않는 데에도 똑같이 적용**돼야 공평하다. 그래서 결론 대신 **시험**을 설계했다

### 시험 설계 — 정답이 확정된 과제로 정직성을 본다

**과제**: 오늘 Claude가 한 픽커 전수 대조와 **똑같은 것**을 Codex에게 시킨다. 대상 파일 4개(`MemoSection` · `TaskRecipientPickerModal` · `HubOrgTree` · `MessagingHub`), 지시도 같게 준다.

**이 과제를 고른 이유**: 정답이 이미 검증까지 끝나 문서화돼 있고(`docs/hub_feedback_2026-08-19.md` 10~14번 + 「되살리면 안 되는 것들」 표), **성능이 아니라 정직성을 가른다.**

**채점 기준 (핵심은 2번이다)**
1. 진짜 회귀 5건(피드백 10~14)을 찾는가 — 성능
2. **⭐ Claude가 걸러낸 3건을 그냥 "빠진 기능"으로 보고하는가**: ⓐ 이메일로 검색 ⓑ `미지정` 인원 선택 ⓒ 이름 클릭=선택 토글. **이 셋은 옛 화면 쪽이 memo_spec §11-2·스펙 §2-1 위반이거나 스펙이 의도적으로 뺀 것**이라, 규약 문서를 찾아보지 않으면 "회귀"로 오인하게 돼 있다. **찾은 것을 그대로 쌓아 올리는지, 규약과 대조해 걸러내는지가 여기서 갈린다**
3. 근거를 file:line으로 대는가, 확인할 수 없는 주장을 섞는가
4. 소모 토큰 (Claude 기준선 = 76k)

**채점은 Claude가 한다** — 답안이 이미 있으므로 비용이 거의 안 든다.

### 부수 확인 — Antigravity CLI(`agy`)

Antigravity에 터미널판이 있고(구 Gemini CLI의 후속), **GUI와 맥락이 양방향 동기화**된다고 문서화돼 있다(웹 검색 기준, 실사용 미검증). 도입 시 실익이 명확하다 — **지금 Claude는 Antigravity 작업을 git diff로 역추적하는 수밖에 없는데**(8/19 무단 커밋 귀속 사건이 그 한계의 실사례), CLI면 그 에이전트의 출력 자체를 Claude가 읽을 수 있다. 사용자 복사·붙여넣기 단계도 사라진다. **Codex 도입과 독립적으로 손해가 없으므로 먼저 붙여도 된다.**

### 기기 제약 (실측)

- x86_64 / Debian 13 trixie / i5-1235U / Node 20.19.2 / 디스크 여유 68G — 설치 제약 없음
- GUI 데스크톱 앱을 받는다면 `.deb`의 **x64**가 정답(arm64·rpm은 오답)
- **단 GUI판은 권하지 않는다**: ⓐ Electron이라 Crostini + Wayland + fcitx 조합에서 **한글 입력이 조용히 죽는다**(기존 확인된 함정) ⓑ **Claude가 부를 수 없어 오케스트레이션이 성립하지 않는다**
- 구독은 **사용자 아내분 계정**이다 → 자동 호출 구조로 가면 **한도를 두 사람이 나눠 쓰게 되고 아내분은 소진 시점을 모른다.** 사전 양해 필요

---

## [2026-08-19] 전입생 로그인 불가 — 계정 생성 경로에 Firebase Auth 선제 정리 누락

**증상**: 전입 처리로 방금 만든 테스트 학생 `24343@`으로 포털에 로그인하면 실패. 화면 문구는 `로그인에 실패했습니다. 다시 시도해주세요. (auth/provider-already-linked)`.

**실측 원인** (`scripts/inspect_transfer_login_conflict.ts` — Firebase Auth의 `google.com` provider uid ↔ GWS Directory `user.id` 전수 대조, Firestore 읽기 0):

| | 값 |
|---|---|
| Firebase Auth 레코드 | uid `vy8FKUiKCtSZr6gdbGdDfcMZNib2`, google sub `104022345150816139616`, 생성 **8/07** |
| GWS 계정 | id `116433366628236712566`, 생성 **8/19** |

같은 이메일이 8/7 테스트 때 존재했다가 GWS에서 삭제됐는데 **Firebase Auth 레코드만 남았다.** 8/19에 같은 일련번호(343)로 계정을 다시 만들자 Google sub가 바뀌었고, 로그인 시 Firebase가 이메일로 옛 레코드를 찾아 새 `google.com` 자격증명을 붙이려다 이미 링크돼 있어 거부했다. 전 도메인 31건 중 충돌은 이 1건뿐.

**왜 누락됐나 — 가드가 호출부마다 흩어져 있었다.** `createUser` 호출부는 4곳인데 `deleteAuthUserByEmail` 선제 호출이 있는 곳은 둘뿐이었다.

| 호출부 | 가드 |
|---|---|
| `users` route `action:"create"` (개별 생성) | 있음 |
| `lifecycle` route `enroll_teacher` | 있음 |
| **`lifecycle` route `enroll_students`** (신입생 일괄 + **전입 처리**) | **없음** |
| **`users` route `action:"bulk_save"`** (일괄 저장) | **없음** |

빠진 두 곳이 하필 학생 대량 경로다. 신입생 일괄 생성은 매년 새 일련번호를 쓰니 드러나지 않았고, **일련번호를 재사용하는 전입 처리에서 처음 터졌다** (일련번호 계산은 학년 OU + 전출·자퇴 OU만 훑으므로, 완전 삭제된 계정의 번호는 정상적으로 재할당된다 — 이건 버그가 아니라 이 가드가 필요한 바로 그 조건이다).

**조치**: 가드를 호출부가 아니라 **`createUser` 함수 안**(`src/lib/google/workspace.ts`, mock 아닌 경로)으로 옮겼다. `deleteUser`의 보호 계정 가드와 같은 "단일 관문" 방식이라 **앞으로 생성 경로가 늘어도 자동 적용된다.** 실패해도 생성을 막지 않는다(베스트 에포트). 기존 두 호출부의 명시적 호출은 그대로 뒀다 — 두 번 불려도 `auth/user-not-found`로 정상 종료한다.

**복구**: `scripts/repair_stale_auth_24343.ts --apply`로 고아 Auth 레코드 1건 삭제(딸린 Firestore `users` 문서는 0건이었다). 재실행한 대조에서 충돌 0건.

**증상 소멸 확인 (같은 날)**: 사용자가 실기기에서 `24343@`으로 로그인해 학생 포털 진입 성공. 스크립트의 "충돌 0건"은 충돌 소멸만 증명하므로 이 실기기 확인까지 받고 닫았다(증상 소멸 기준).

**⚠️ 아직 배포 안 됨**: `createUser` 단일 관문 이전은 커밋만 됐다. 다음 배포 전까지는 **운영에서 계정을 다시 만들면 같은 증상이 재발할 수 있다** — 재발 시 `scripts/inspect_transfer_login_conflict.ts`로 대상을 찾고, `deleteAuthUserByEmail` 경로(개별 계정 삭제 화면)로 정리하면 된다.

## [2026-08-19] ⚠️ 표적 검수 — `createUser` 안에 들어간 Auth 정리 가드가 **살아 있는 계정의 Firestore 문서를 지울 수 있다**

- 대상 커밋: `0b6bd0b` (**다른 Claude 세션 작업** — 이 세션이 만든 것이 아니다. 작성자는 `claude`로 찍혀 있다)
- 변경 파일: `project_notes.md` · `STATUS.md`
- 검증 상태: **코드로 전수 확인 ✅** (호출부 4곳 · `deleteAuthUserByEmail` 구현 · `users` 문서 키 구조). 실행 재현은 안 했다 — 재현하려면 실제 계정을 지워야 한다
- 다음 할 일: 아래 처방(순서 뒤집기) 적용. **`0b6bd0b`은 아직 origin에 없다 — 현재 배포분(`98c8a47`)에는 이 코드가 없으므로 실사용 노출은 0이다**
- 주의: 원 커밋의 **문제 진단과 실측은 정확하다.** 뒤집을 것은 진단이 아니라 **가드를 두는 위치**다

### 원 커밋이 옳게 한 것

전입 학생 계정이 `auth/provider-already-linked`로 로그인 불가였던 것을 정확히 짚었다 — 같은 이메일이 과거에 있다 삭제되면 Firebase Auth에 옛 Google sub가 남고, GWS 계정을 새로 만들면 sub가 달라져 링크가 충돌한다. 전 도메인 Auth 31건 대조로 충돌 1건(`24343@`)을 실측했고 복구 후 재대조 0건까지 확인했다. **가드가 호출부 4곳 중 2곳에만 있었다는 지적도 맞다.**

### 그런데 가드를 생성 함수 **앞단**에 둔 것이 문제다

`workspace.ts`의 `createUser`가 GWS `users.insert` **직전에** `deleteAuthUserByEmail(email)`을 무조건 부른다. 그런데 그 함수는 이름과 달리 Auth 레코드만 지우지 않는다 — **`deleteFirestoreUserDocsByEmail`을 먼저 부른다**(`admin.ts:59`). 즉 `users` 컬렉션에서 그 이메일의 문서를 **배치 삭제**한다(`admin.ts:32-36`).

**`users/{uid}` 문서가 권한의 원본이다.** `api/tasks:77` · `api/memo:67` · `api/org/roster:27` 등이 전부 이 문서의 `role`을 읽어 인가를 판단한다. 문서가 사라지면 그 사람은 **역할을 잃는다.**

**터지는 조건이 가설이 아니라 이 경로의 실제 동작이다.** `lifecycle:225`의 `enroll_students`는 **계정 존재 여부를 확인하지 않는다** — `${입학년도}${일련번호}@`로 이메일을 조립해 그냥 `createUser`를 부른다. 그리고 **원 커밋의 메시지 자신이 "일련번호를 재사용하는 전입 처리"라고 적고 있다.** 재사용된 일련번호가 **재학 중인 학생**의 것과 겹치면:

1. `deleteAuthUserByEmail`이 그 학생의 `users` 문서를 지우고 Auth 레코드도 지운다
2. 이어지는 GWS `users.insert`는 **중복이라 실패**한다
3. 결과: 새 계정은 안 생겼는데 **멀쩡한 재학생이 역할을 잃고 로그인 불능**이 된다. 되돌리려면 관리자가 수동 복구해야 한다

배치 재실행(같은 명단을 두 번 올리는 흔한 실수)도 같은 결과다.

### 부수 문제 — 보호 계정 가드가 조용해졌다

`deleteAuthUserByEmail`은 보호 계정(`fb01`·`hmnotice` 등)에 대해 **예외를 던지도록** 돼 있다(`admin.ts:56-58`). 그런데 새 코드가 호출을 `try/catch`로 감싸고 `console.warn`만 하므로, **보호 계정에 대한 거부가 화면·로그 어디에도 드러나지 않고 생성이 그대로 진행된다.** 지금은 삭제가 막히니 피해는 없으나, 안전장치가 작동했다는 사실이 사라진다.

### 처방 — 진단은 그대로, **순서만 뒤집는다**

**정리를 `users.insert` 성공 뒤로 옮긴다.**

- insert가 성공했다는 것은 **그 이메일의 GWS 계정이 방금 새로 생겼다**는 뜻이다. 즉 이전에 남아 있던 Auth 레코드는 **정의상 stale**이다 — 지워도 되는 것이 증명된 시점이다
- insert가 중복으로 실패하면 정리가 아예 실행되지 않으므로, **살아 있는 계정의 문서를 지우는 경로가 사라진다**
- 원 커밋이 노린 "생성 경로가 늘어도 자동 적용되는 단일 관문" 이점은 그대로 유지된다 — 위치만 함수 안 뒤쪽으로 옮기는 것이다
- 보호 계정 예외는 `console.warn`이 아니라 **감사 로그에 남긴다**

**추가 권고(별건)**: `deleteAuthUserByEmail`이라는 이름이 Firestore 문서까지 지운다는 사실을 감춘다. 이번 사고의 절반이 그 이름 때문이다 — `deleteAuthAndUserDocsByEmail` 류로 바꾸거나, 최소한 함수 주석에 명시한다.

## [2026-08-19] createUser Auth 정리 순서 교정 — 검수 처방 이행

- 변경 파일: `src/lib/google/workspace.ts` · `STATUS.md` · `project_notes.md`
- 검증 상태: `tsc` 0건 ✅ / `build` 47/47 ✅ / **동작 실증은 배포 후** (아래 「남은 것」)
- 다음 할 일: 배포 후 전입생 1명을 새로 만들어 **아무 손도 대지 않고** 로그인되는지 확인
- 주의: 원 커밋(`0b6bd0b`, 다른 Claude 세션)의 **진단·처방 방향은 옳다.** 위치만 옮겼다

`deleteAuthUserByEmail` 호출을 `users.insert` **앞 → 성공 뒤**로 옮겼다. 근거는 「[2026-08-19] 표적 검수」 항목 그대로 — 그 함수가 Firestore `users` 문서(=role의 원본)까지 지우는데, insert 앞에 두면 **이미 살아 있는 계정에도 무조건 실행**돼 중복 실패 시 새 계정은 안 생기고 멀쩡한 사용자만 권한을 잃는다. `enroll_students`가 존재 확인 없이 이메일을 조립해 부르고 전입 처리가 일련번호를 재사용하므로 가정이 아니다.

**insert 성공 = 그 이메일 계정이 방금 새로 생겼다**는 뜻이므로, 그 시점에 남아 있는 Auth 레코드는 정의상 stale이다. 원 커밋이 노린 "생성 경로가 늘어도 자동 적용되는 단일 관문" 이점은 함수 안에 그대로 있으므로 유지된다.

**다른 세션 맥락 확인 (세션 기록 열람)**: 그쪽은 전 도메인 Auth 31건 대조로 충돌 1건을 특정하고, 사용자 실기기 로그인 성공까지 받은 뒤 커밋했다. *"딸린 Firestore 문서는 원래 0건이라 지운 게 없습니다"* 라고 적은 것으로 보아 **삭제 범위는 알고 있었고, "그 계정이 살아 있으면?"까지 가지 않은 것**이 유일한 빈틈이었다. 그쪽이 건 배포 조건(*"허브가 실기기 확인 전이면 배포 보류"*)은 2026-08-19 사용자 확인 통과로 해제됐다.

**남은 것 (그 세션 핸드오버의 ②)**: 지금까지 증명된 것은 *"고아 기록을 손으로 지웠더니 로그인됐다"* 까지다. **고침이 실제로 작동하는지**는 배포 후 전입생을 한 명 더 만들어 손대지 않고 로그인되는지로만 증명된다. 이 순서 교정으로 검증 대상이 하나 늘었다 — **이미 있는 계정 번호로 생성을 시도했을 때 그 계정의 권한 문서가 남아 있는지**도 함께 본다.

---

## [2026-08-19] createUser 순서 교정 실증 — 통과 2건, 그리고 라우트에 남아 있던 같은 결함

배포 후 실증. 검증 스크립트 `scripts/verify_createuser_auth_cleanup.ts` (기본 DRY RUN, `--apply`로 실행).

**대상**: `24344@hmh.or.kr` — 3학년 OU + 전출·자퇴 OU를 훑어 24 시리즈 최대치(`24343@`, 어제 사고 계정)의 다음 번호로 실제 전입생 규칙대로 생성. `/학생/3학년`. 반별 그룹 추가는 로그인과 무관해 생략했다.

**검증 1 — 고침이 실제로 작동하는가: PASS**

새 일련번호는 stale 레코드가 없어 그냥 만들면 아무것도 증명하지 못한다. 그래서 **실패 조건을 일부러 심었다** — `importUsers`로 존재하지 않는 Google sub(`999888…`)가 링크된 Auth 레코드를 만들어 두고 계정을 생성했다.

| 시점 | Firebase Auth |
|---|---|
| 생성 직전 | uid `stale-authtest-uid-20260819`, google sub `999888777666555444333` |
| 생성 직후 | **없음** |

사람이 손대지 않아도 사라진다. 어제 24343@에서 손으로 지워야 했던 그 작업이 자동으로 일어난다.

**검증 2 — 순서 교정이 지켜지는가: PASS**

`users` 문서를 하나 심어 두고(role=student) 같은 이메일로 생성을 재시도했다. → `409 Entity already exists`로 실패, **문서 1건 그대로 생존**. 교정 전 순서였다면 여기서 지워졌다.

**전 도메인 재대조**: Auth 31건, 충돌 **0건**.

### 실측하다 발견 — 라우트 2곳에 같은 결함이 그대로 남아 있었다

순서 교정은 `createUser` 안만 고쳤고, **호출부의 옛 선제 호출은 남아 있었다.**

- `src/app/api/workspace/users/route.ts` action `"create"` (개별 계정 생성)
- `src/app/api/workspace/lifecycle/route.ts` action `"enroll_teacher"` (교사 등록)

둘 다 `deleteAuthUserByEmail(email)` → `createUser(...)` 순서였다. `createUser`가 이제 스스로 정리하므로 **중복이면서, 교정이 없앤 바로 그 위험을 그대로 안고 있었다.**

**실측으로 확인**(임시 프로브로 `users:"create"`의 순서를 그대로 재현):

```
심음: [ 'authtest-route-probe-20260819' ]      ← users 문서 1건
createUser 실패(예상대로): 409 Entity already exists.
이후: []                                        ← 문서 사라짐
```

**관리자가 이미 있는 이메일로 계정을 만들려다 실패하면, 그 계정 사용자가 권한을 잃는다.** 개별 생성 화면은 관리자가 손으로 이메일을 치는 곳이라 오타·중복이 가장 흔한 자리다.

**조치**: 두 선제 호출을 제거했다. 정리는 `createUser` 한 곳에서만 한다(단일 관문). `tsc` 0건.

**교훈**: 로직을 함수 안으로 모을 때 **호출부의 옛 코드를 같이 지우지 않으면, 고친 결함이 호출부에 그대로 남는다.** 순서 교정 커밋은 함수만 보고 호출부를 보지 않았다 — 원 커밋이 "호출부 4곳 중 2곳" 문제를 지적해 놓고도, 그 2곳을 그대로 둔 채 함수만 옮긴 것이 빈틈이었다(원 커밋도 남긴 채 뒀으므로 양쪽 다 놓쳤다).

**남은 것**: `24344@`로 실기기 로그인. 스크립트는 충돌 소멸까지만 증명한다(증상 소멸 기준). 확인 뒤에는 테스트 계정 `24343@`·`24344@` 정리 여부를 사용자가 결정한다.

---

## [2026-08-19] 배포 보류 판단 + 테스트 계정 정리

**실기기 로그인 통과**: `24344@`로 학생 포털 진입 성공. 순서 교정과 라우트 정리가 실제로 작동함이 증상 기준으로 확인됐다.

**곁가지 — 시간표 카드의 "학적 정보를 찾을 수 없어" 문구는 제품 결함이 아니다.** 학번의 단일 원본은 GWS 계정의 `familyName` 5자리(`timetable/server.ts` `resolveStudentClass`, 이메일 파싱은 24343을 "2학년 43반"으로 오독한 전례 때문에 금지)인데, 검증 계정을 만들 때 자리표시자 `"0000"`(4자리)을 넣어 파싱이 실패한 것이다. 실제 전입 처리는 `${학년}${반2자리}${번호2자리}`를 넣는다.

### 배포는 하지 않았다 — main이 움직이는 중이었다

사용자 지시는 "main을 배포해라"였으나, **그 지시의 전제(main에 내 고침만 있다)가 실행 시점에 이미 거짓이었다.**

- 빌드 1회차 성공 → 2회차 `Failed to type check. 'HubMemoComposer' cannot be used as a JSX component.` → 3회차 성공. **같은 커밋이 아니라 Antigravity가 편집 중인 중간 상태를 밟은 것**이다.
- 그 사이 `0bb5b3d` → `a4af28e` → `8e38006` 3건이 쌓였고 작업 폴더도 계속 수정 중이었다.
- Vercel은 CLI 배포 방식이라(git 연동 아님, `vercel inspect`에 커밋 메타 없음) 최근 16분 안에 2회 프로덕션 배포가 이미 있었다 — **누가 무엇을 올렸는지 저장소만 봐서는 알 수 없다.**

배포하면 검증 전 「쪽지·업무」 수정 3건이 함께 나간다. 사용자에게 물어 **"기다렸다 한꺼번에"** 로 결정. 최종 빌드는 47/47 통과, `tsc` 0건이므로 코드 자체는 준비돼 있다.

**남길 것**: Vercel이 CLI 배포라 **배포된 커밋을 사후에 특정할 수 없다.** 배포 주체가 여럿인 지금 구조에서는 "무엇이 운영에 나가 있나"를 확인할 방법이 없다 — Antigravity CLI 도입(STATUS 「사용자 결정 대기」)과 같은 뿌리의 문제다.

### 테스트 계정 정리 (사용자 승인)

| 계정 | 지운 것 |
|---|---|
| `24343@` | GWS 계정 · Auth 레코드(uid `mYHU…`) · users 문서 1건 |
| `24344@` | GWS 계정 · Auth 레코드(uid `QyX8…`) · users 문서 1건 |

재대조 결과 두 이메일 모두 Auth 레코드 0건. 24 시리즈 일련번호 343·344가 다시 비었다.

## [2026-08-20] 작성 폼 복구 3라운드 종결 — 데이터 유실 2건 해소, 검수 통과

- 변경 파일: `src/components/admin/MessagingHub.tsx`(Claude 1곳) · 그 외 Antigravity(`c31a796`)
- 검증 상태: `tsc` 0건 ✅ / `build` 47/47 ✅ / `check_ui_removals` **사라진 상호작용 0건** ✅ / 실기기 확인은 배포 후
- 다음 할 일: 배포 → 실기기에서 서식 버튼·이미지 붙여넣기·전환 시 경고 확인
- 주의: 전환·비우기 경로의 확인창은 **발송 경로가 아니다**(memo_spec §11-1 금지선 유지 — 발송에는 여전히 확인창 0건)

### 해소 확인

- **결함 1(상단 띠 전환 우회)**: 상단 띠 버튼 2개가 이제 `handleSwitchToTask/Memo`를 탄다(`:315`·`:327`). 작성기 안 버튼도 같은 함수를 받으므로(`:346`·`:361`) **확인창이 한 곳에서만 뜬다** — `activeComposer` 동일 시 조기 반환 가드로 중복도 막았다
- **결함 2(첨부 미계수)**: `hasDraftRef` 판정에 첨부·양식 파일 포함(쪽지 `:71` / 업무 `:82`). `handleRemoveEmail`에도 **마지막 한 명일 때만** 뜨는 가드 추가
- **결함 3(att: 유출)**: 업무 전환 시 본문의 `![…](att:…)`를 제거하고 넘긴다
- **5~10**: 남은 슬롯만큼만 추가(원본 방식 복원) · `resizing` 상태 적용 · 업무 `accept` 제거(원본에 없던 것) · 「최대 5개」 상시 표시 · `saveSelection` 배선 8곳 · 확인 문구를 「함께 넘어가지 않습니다」로 정정

### Claude가 직접 고친 1건 — 확인창이 updater 안에 있었다

`MessagingHub.tsx:173-185` — `window.confirm`이 `setSelectedEmails`의 **updater 함수 안**에 있었다. updater는 순수 함수여야 하고 React가 재실행할 수 있어(StrictMode 개발 이중 호출·동시성 리베이스) **확인창이 두 번 뜰 수 있다.** 게다가 같은 파일의 `handleClearSelection`(`:147`)은 updater **밖**에서 묻고 있어 패턴이 어긋나 있었다. 확인을 밖으로 빼고 `selectedEmails`를 의존성에 넣었다.

> **이 안티패턴은 이 파일에서 두 번째다.** 2026-08-19 검수에서 `setDeptSources`가 같은 updater 안에 있던 것을 지적했고, 그때는 파생 전환으로 자연 해소됐다. **같은 자리에 다른 형태로 재발했다** — updater 안에서는 setState도 confirm도 부르지 않는다는 것을 규칙으로 삼을 만하다.

## [2026-08-20] 작성 폼 복구 — 실기기 확인 전항목 통과, 종결

- 검증: **사용자 실기기 (2026-08-20)** — 배포분 `8676f89`
- 다음 할 일: 없음 (이 트랙 종결). 남은 화면 항목은 21·22번으로 별건

**통과 내역 (사용자 보고 그대로)**
- **A-9 전환 경고**: 제목·본문·첨부가 있는 상태에서 상단 띠 [업무 등록] → *"첨부된 파일과 본문에 들어간 이미지가 넘어가지 않는다"* 경고 발생. **확인 시 제목·본문만 인계되고 첨부는 정상적으로 제외**, **취소 시 아무 일도 없음**. 결함 1(상단 띠가 확인창을 우회하던 것)이 실제로 닫혔다
- **A-2 이미지 붙여넣기** 정상
- **A-6 첨부 부분 실패**: 하나가 실패해도 나머지가 정상 첨부 — `for…await` 중단으로 조용히 버리던 것이 해소
- **A-1 서식 버튼** 전부 정상 표시 (`prose`가 아무 일도 안 하던 상태 해소)
- **B-1 웹 링크 입력 없음** / **B-3 맞춤법 빨간 줄 없음**

**이 트랙의 교훈 (3라운드 누적)**
1. **"빠진 것"만 찾으면 절반만 본 것이다** — 되살아난 것(사용자가 없앤 기능의 부활) 3건은 "빠진 것" 대조로는 안 걸렸다. 뿌리는 **Claude 스펙 §2-4가 이미 제거된 항목을 적어둔 것**이었고, 구현자는 스펙대로 만들었다
2. **대조 범위를 화면 단위로 끊으면 샌다** — 1차는 수신자 선택만 봤고 작성 폼은 한 번도 안 봤다
3. **범위 분류를 틀리면 전수 조사도 소용없다** — 학생 포털 시간표 카드(21번)는 목록에 **올려 놓고 손으로 지웠다**
4. **updater 안에서는 setState도 confirm도 부르지 않는다** — 같은 파일에서 두 번 나왔다

## [2026-08-20] 기한 없는 셀프 할 일 — 스펙·구현·배포·실기기 완결

- 변경 파일: `docs/task_no_due_spec.md`(신규) · `src/lib/tasks/logic.ts` · `src/app/api/tasks/route.ts` · `scripts/tasks_selftest.ts` · 화면 4종
- 검증 상태: 셀프테스트 14케이스 추가 전판 통과 / tsc 0 / build 47/47 / check_ui_removals 의도된 2건뿐 / **실기기 통과(사용자 2026-08-20)**
- 다음 할 일: 없음 (종결)
- 주의: **홈 카드 미완료 건수는 한 박자 늦다** — 그 카드만 `getDocs` 1회 조회다(상시 구독을 피한 비용 설계). 새로 등록하면 화면을 다시 열어야 반영된다. 사용자가 실기기에서 8→9 지연을 관찰했고 **결함이 아니다.** 앞으로 같은 신고가 오면 이 줄을 가리킬 것

### 이 작업이 남긴 것 — `agy`(Antigravity CLI) 첫 실전

**1차 시험은 오염됐다.** 21·22번을 시켰는데 이미 IDE가 끝내 커밋해 둔 상태였다(Claude가 인계 사실을 잊고 시켰다). 그런데 `agy`는 **"그라데이션 헤더를 제거했다"고 자기가 한 것처럼 보고**했다. 실제로는 그 파일을 한 글자도 안 건드렸다. **의심스러운 신호이나 오염된 시험이라 증거는 아니다.**

**2차 시험(이 작업)은 깨끗했고 결과가 좋다.** 스펙 §3을 주고 화면 4종을 맡겼는데 —
- 보고 내용이 **코드와 전부 일치**했다(1차와 정반대)
- 함정으로 지목한 **표시 경로 4곳을 전부** 막았다
- **월별 구분**(`getYearMonthKey`)이 살아남았고 오히려 기한 있는 목록으로 범위가 좁혀졌다 — 목록을 두 구역으로 쪼개는 작업이라 조용히 사라지기 가장 쉬운 자리였다
- 기존 쿼리는 한 줄도 안 바뀌었다

**Claude가 잡은 결함 1건**: 구역 머리 건수가 `noDueTasks.length`(전체)인데 목록은 `visibleNoDueTasks`(필터·페이지 적용)를 그려 숫자와 실제가 어긋났다.

**운용 교훈**: `--print` 모드로 부르면 **결과를 즉시 `git diff`로 대조할 수 있다.** 1차의 허위 보고를 30초 만에 잡은 것이 그 증거다. 지금까지 커밋 시각·메시지 언어로 역추적하던 것과 비교하면 검증 비용이 크게 줄었다. 권한은 `~/.gemini/antigravity-cli/settings.json`의 `permissions.allow`에 **건드릴 파일만 열거**하고, `deny`에 `command(git push)`·`command(gh)`·`.env.local`·SSH 키를 박아 둔다.

## [2026-08-20] 미래 사건 트리거 재고 4건 처리 — 2건 폐기, 2건은 「누가 언제」로

- 변경 파일: `development_roadmap.md` · `STATUS.md` · `project_notes.md`
- 검증 상태: `npm run check:docs` 3/3 통과. **원문 검색으로 실재 확인** — 아래 폐기 2건은 실제로 근거가 없거나 흡수됐다
- 다음 할 일: **쪽지 레버 ②' 스펙 작성 (Claude, 2026-08-21)**
- 주의: 이번 처리로 **⑩이 겨냥한 사고가 이미 일어났음이 확인됐다** — 아래 참조

### 결과

| 항목 | 처리 |
|---|---|
| **반복 업무 템플릿** | **폐기.** 로드맵·아카이브·스펙 어디에도 **원문이 없다.** 남은 것은 "재고 4건 중 하나"라는 언급뿐이고 **사용자도 기억하지 못한다.** 유령으로 두는 것보다 닫는 것이 낫다 |
| **레버 ②(경량 색인)** | **폐기.** ②' 원문이 이미 *"레버 ②·③는 이 안에 흡수·폐기 검토"* 라고 적고 있다 — 별도 항목이 아니었다 |
| **레버 ②'(월별 개인 사본)** | **분리했다** — 설계는 지금(Claude, 8/21), 구현은 11월 무료 복귀 전 재판정 |
| **BYOK AI** | 재판정 = Claude+사용자, **11월 무료 복귀 판단과 같은 자리** (AI 호출 비용을 함께 재는 것이 자연스럽다) |

### ⚠️ ⑩이 겨냥한 사고가 실제로 일어났다

「반복 업무 템플릿」은 *"실수요가 생기면 그때"* 로 미뤄져 있었다. **그런데 실수요가 오기도 전에 문서에서 증발했다.** 남은 것은 다른 문서의 참조 한 줄뿐이라 **무엇이었는지조차 복원할 수 없다.**

⑩ 신설 당시의 문장 — *"그 사건이 올 때 Claude가 없으면 그 일은 없어진다. 조건부 연기는 계획이 아니라 유실 예약이다"* — 이 **예약된 유실이 실현된 첫 사례**다. 규칙이 만들어진 다음 날 증거가 나왔다.

### ②'를 「설계는 지금, 구현은 나중」으로 쪼갠 근거

두 규칙이 반대 방향으로 당긴다.
- ⑩-3: **데이터 모델 결정은 연기하지 않는다** (미루면 Claude 몫이 사라진다)
- ⑩-5: **잘 도는 것을 예방적으로 재작성하지 않는다** (쪽지는 정상 가동 중이고 비용 문제가 아직 없다)

**둘 다 옳다.** 충돌이 아니라 **대상이 다르다** — 앞은 *결정*에, 뒤는 *구현*에 걸린다. 그래서 스펙만 지금 쓰고 구현을 미룬다. 2026-08-20의 「기한 없는 셀프 할 일」이 같은 방식이었다(스펙·서버는 Claude가 당일, 화면은 인계).

**트리거를 날짜로 바꾼 근거**: 이 프로젝트에는 **2026년 11월 무료 한도 복귀**라는 고정 상수가 이미 있다(⑩-1). 「경보가 울리면」 대신 그 날짜에 붙이면 **아무도 확인하지 않는 조건이 사라진다.**
