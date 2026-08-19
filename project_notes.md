# Project Notes

> **아카이브 안내**: 2026-08-15 ~ 2026-08-17 엔트리는 [`archive/project_notes_2026-08-mid.md`](./archive/project_notes_2026-08-mid.md),
> 2026-08-14 이전은 [`archive/project_notes_2026-08.md`](./archive/project_notes_2026-08.md)·[`archive/project_notes_2026-07.md`](./archive/project_notes_2026-07.md)에 있다
> (원문 그대로, 블록 무손실 대조 완료). 이 파일은 최근 엔트리만 유지한다 — 150KB 초과 시 즉시 회전 (AGENTS.md ④-1).

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

## [2026-08-18] Antigravity → Claude/사용자 (교사 전출 화면 정지 행 삭제 예정일 및 D-Day 표기 완결)
- **배경**: `project_notes.md` 8/18 큐 전수 점검 잔여 확인 항목. 교사 전출 대기 현황(`TeacherLifecycle.tsx`)에서 계정 정지(`SUSPENDED`)된 행의 D-Day가 기한 선택일 기준으로 계산되어 오해를 부르던 문제 해결.
- **변경 파일**:
  - `src/components/admin/lifecycle/TeacherLifecycle.tsx`:
    - `task.status === "SUSPENDED"` 시 `task.suspendedAt` + 30일을 `deleteDueDate`로 산출.
    - D-Day 계산 기준일을 정지 상태에서는 `deleteDueDate`로 전환 (KST 날짜 기준 일수 차이 계산).
    - 학생 전출 화면(`TransferOutTab.tsx`)과 동일하게 `🛑 D-N` + `삭제 예정: YYYY. MM. DD.` (`deleteDueDate.toLocaleDateString("ko-KR")`) 2줄 표기로 통일.
    - 비정지 상태(`PENDING_DEADLINE`, `DEADLINE_SET`)는 기존 기한일 기준 D-Day 표기 유지.
    - 서버 로직 변경 0건.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어 배제, 직관적인 눈높이 날짜/상태 레이블 적용.
  - git add -A 금지 (수정된 `TeacherLifecycle.tsx`, `project_notes.md`만 표적 add).
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (42/42 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (주 운영 목록 지난 주 기본 숨김·토글 및 이번 주 배지 완결)
- **배경**: `development_roadmap.md` §2-④ 주 운영 목록에 지난 주가 계속 남아 이번 주가 밀리는 문제 해결 (CalendarManageTab 패턴 이식).
- **변경 파일**:
  - `src/components/admin/timetable/WeekManageTab.tsx`:
    - `getTodayKSTISO()`, `getWeekEndISO()` 기준 과거 주 판정 (`주 시작일 + 6일(일요일) < 오늘(KST)` — 주말 경과 기준).
    - `showPastWeeks` 상태 기본값 `false`로 지난 주 기본 숨김 적용.
    - 헤더에 `지난 주 N개 숨김` 안내 및 목록 하단 `▼ 지난 주 N개 보기 / ▲ 지난 주 N개 숨기기` 토글 버튼 추가.
    - 펼쳤을 때 지난 주 행 흐리게(`opacity-60`, `bg-gray-50/60`) 표시, 과거 주의 `⚙️ 휴업·시수 수정` 기능은 그대로 유지.
    - 학기 말 등 모든 주가 과거인 경우 빈 목록 안내 및 `▼ 지난 주 N개 보기` 탈출구 버튼 제공.
    - 이번 주 행(`시작일 <= 오늘(KST) <= 시작일 + 6일`)에 `이번 주` 배지 및 좌측 인디고 강조 테두리 적용.
    - 정렬 순서(오름차순) 및 주 문서 삭제 방지 유지.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건 — empty state 조건부 텍스트 전환)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (42/42 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (사용량 알림 받는 사람 관리 UI 및 알림 바로가기 권한 제약 완결)
- **변경 파일**:
  - `src/components/admin/UsageDashboardTab.tsx`:
    - `super_admin` 전용 '알림 받는 사람' 카드 신설 (`POST /api/ops/usage` with `{ action: "set_recipients", recipients }`).
    - 칩(chip) 형태 수신자 목록 표시 및 삭제(`✕`) 버튼.
    - 이메일 입력창 + 추가 버튼 (최대 10명 제한).
    - `needsAttention` (또는 `source === "role-fallback"`) 시 *"아직 받는 사람을 정하지 않아 자동으로 추정하고 있습니다. 이 계정들은 평소 로그인하지 않아 알림을 못 볼 수 있습니다."* 경고 안내 박스 표출.
    - 저장 시 서버가 반환하는 400 에러 문구(없는 계정, 형식 오류 등)를 그대로 화면에 표출(자체 작문 금지).
  - `src/components/common/NotificationCenter.tsx`:
    - `refType === "usage_alert"`인 알림 항목의 '사용량 바로가기' 버튼 및 딥링크 동작을 `super_admin`에게만 노출·동작하도록 제한 (교사 계정은 알림 본문 수치 전달로 완결).
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (42/42 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (절약 모드 화면 및 전역 구독 완결 — saving_mode_spec §8 순서 2)
- **변경 파일**:
  - `src/context/AuthContext.tsx`:
    - `platform_config/saving_mode` 문서를 `onSnapshot`으로 실시간 구독하여 앱 전역 `savingMode` 상태로 제공.
    - 활성화 시 남은 시간(`remainingMs`) 15초 주기 갱신 및 24시간 자동 만료 카운트다운 타이머 포함.
  - `src/components/common/SavingModeBanner.tsx`:
    - 절약 모드 켜짐 시 상시 배너 컴포넌트 신설.
    - 배너 문구: 서버 및 `saving_logic.ts`의 `buildSavingBannerText` 그대로 사용 ("지금은 데이터 사용을 줄이는 중입니다. N시간 M분 뒤 자동으로 원래대로 돌아갑니다.").
    - `super_admin` 권한 시 [절약 모드 끄기] 버튼 표시 및 `POST /api/ops/saving-mode { on: false }` 연동.
  - `src/components/admin/UsageDashboardTab.tsx`:
    - `super_admin` 전용 '데이터 절약 모드' 관리 카드 추가.
    - 현재 모드(절약 모드 켜짐 / 평시 모드) 뱃지, 설명 문구, 토글 버튼([절약 모드 켜기] / [절약 모드 끄기]), 켜진 경우 상세 배너 표출.
  - `src/app/admin/page.tsx`:
    - 관리자 메인 화면 및 쪽지함 상단에 `SavingModeBanner` 배치.
  - `docs/saving_mode_spec.md`:
    - §8 순서 2 완료 갱신 및 배포 시 `firebase deploy --only firestore:rules` 동반 주의사항 기록.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어(캐시, TTL, 쿼터, API 등) 일체 배제, 직관적인 한글 라벨 사용.
  - `platform_config/saving_mode` `onSnapshot` 구독으로 켜는 즉시 접속 중인 교사에게 실시간 전파.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npx tsx --env-file=.env.local scripts/verify_saving_mode.ts` ✅ (순수 판정 + 실계정 사이클 전판 통과)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (42/42 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (사용량 모니터링 화면 완결 — usage_dashboard_spec §7 순서 3)
- **변경 파일**:
  - `src/components/admin/UsageDashboardTab.tsx`:
    - **오늘 진행 현황 (3종 막대)**: 조회(`reads`), 저장(`writes`), 삭제(`deletes`) 지표별 사용 건수, 서버 제공 일일 한도(`limits`) 대비 백분율, 단계별 뱃지(정상/주의/경고), 프로그레스 바.
    - **최근 30일 일자별 추세 차트**: 지표별 전환 탭(조회/저장/삭제), 일자별 막대 그래프 + 무료 일일 한도 기준선 점선, 호버 툴팁, 30일 일평균/최고치/한도 통계 박스.
    - **오늘 시간대별 사용량 막대**: 완결된 1시간 단위 막대 그래프, 피크 시간대 시각적 강조, "완결된 시간대만 집계되므로 시간대별 합계가 오늘 누계보다 작은 것은 정상" 안내.
    - **필수 고지 문구 2종**:
      - *"하루 사용량은 매일 오후 4시(한국 시간)에 0으로 초기화됩니다"*
      - *"최근 5분 이내 사용량은 아직 반영되지 않았을 수 있습니다"* (`lagMinutes` 연동)
    - **`available: false` 대응**: 0이나 빈 그래프를 그리지 않고 무엇이 필요한지/설정 위치(구글 클라우드 콘솔 IAM 모니터링 편집자 역할 부여 등)를 설명하는 안내 카드 및 "다시 확인" 버튼 제공.
    - **다시 확인 버튼**: `GET /api/ops/usage?days=30&force=1` 파라미터로 호출하여 60초 캐시 우회 즉시 갱신.
  - `src/components/admin/AdminUsageSummaryBanner.tsx`:
    - super_admin 사용자에게만 홈 상단에 노출되는 한 줄 요약 배너.
    - `available: false` 시 "사용량을 아직 볼 수 없습니다 (설정 확인하기 →)" 중립 문구 표출.
    - `available: true` 시 "🟢 오늘 사용량 20% · 정상 (상세보기 →)" 형태 표출.
    - 클릭 시 `usage` 메뉴로 즉시 전환. `days=30` 호출로 서버 캐시 공유.
  - `src/app/admin/page.tsx`:
    - `MenuType`에 `"usage"` 추가, `UsageDashboardTab` 다이내믹 로딩 등록, `AdminUsageSummaryBanner` 홈 상단 배치.
    - 사이드바 `🔐 관리자 전용` > `⚙️ 시스템 설정` 하위에 「📊 사용량」 버튼 추가.
    - 헤더 타이틀 매핑 추가.
  - `src/components/common/NotificationCenter.tsx`:
    - 알림 항목의 `refType === "usage_alert"`인 경우 클릭 시 `/admin` 이동 및 `menu: "usage"` 전환 이벤트 디스패치.
    - 바로가기 텍스트 "사용량 바로가기", 뱃지 "📊 사용량" 연결.
  - `docs/usage_dashboard_spec.md`:
    - §7 분업 표 및 §9 구현 기록에 순서 3 완료 갱신.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어(API, 쿼터, Cloud Monitoring, UTC, Firestore 등) 일체 배제, 사용자 눈높이 직관적인 한글 라벨 사용.
  - 서버 `limits` 값 직접 사용 (화면 상수 재정의 0건).
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npx tsx --env-file=.env.local scripts/verify_usage_dashboard.ts` ✅ (경계·스냅샷·교차대조·캐시 4부 전판 통과)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (42/42 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 검색 범위 드롭다운 및 다계층 캐시 파생 완결 — memo_star_search_spec §2-4a)
- **변경 파일**:
  - `src/lib/memo/search_logic.ts`:
    - `MemoSearchRange` (`"3m" | "6m" | "1y"`), `MEMO_SEARCH_RANGE_LABELS`, `computeSearchRangeBoundary`, `filterMemosByRangeBoundary` 순수 헬퍼 정의 및 export.
  - `src/components/admin/MemoSection.tsx`:
    - **범위 드롭다운**: 검색창 좌측에 `[최근 3개월 | 최근 6개월 | 최근 1년]` 드롭다운 배치 (기본값: 최근 3개월).
    - **경계 쿼리**: Firestore 쪽지 조회 시 `where("createdAt", ">=", boundaryMs)` + `orderBy("createdAt", "desc")` 추가 (동일 필드 범위+정렬로 복합 색인·규칙 무변경, 읽기 비용 70~80% 절감).
    - **범위별 캐시 & 파생 필터**: `memos:all_user:${myEmail}:${range}`로 관리. 더 넓은 범위 캐시(예: 1년 또는 6개월)가 메모리에 있으면 Firestore 재조회 0건으로 `filterMemosByRangeBoundary` 파생 필터 생성 후 즉시 적용. 범위 확장 시에만 Firestore 재조회.
    - **즐겨찾기 동기화**: 별 토글 시 메모리에 존재하는 모든 범위 캐시(`3m`, `6m`, `1y`)에 낙관적 상태를 동기화하여 캐시 불일치 방지.
    - **결과 상단 표기 & 0건 유도**:
      - 결과 상단에 "최근 N개월/1년에서 찾았습니다 (N건)" 안내 바 표기.
      - 결과 0건 시 "'{검색어}'에 해당하는 쪽지가 없습니다." + "기간을 늘려 다시 찾아보세요" 유도 문구 및 즉시 6개월/1년으로 확장할 수 있는 바로가기 버튼 제공.
  - `scripts/memo_selftest.ts`:
    - 검색 범위 3종 경계 시각 산출, 라벨 매핑, 상위 캐시로부터 하위 범위 파생 필터링 검증 7케이스 추가.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어 배제, 사용자 눈높이 한국어 라벨 ("최근 3개월", "기간을 늘려 다시 찾아보세요"), 0건 시 원클릭 출구 버튼 제공.
  - `memo_star_search_spec §2-4a`: 쿼리 및 캐시 계층 구조 완전 준수.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npx tsx scripts/memo_selftest.ts` ✅ (검색 범위 7케이스 포함 전 항목 통과)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 즐겨찾기·검색 UI 완결 — memo_star_search_spec §1-5·§2-4)
- **변경 파일**:
  - `src/components/admin/MemoSection.tsx`:
    - **별 토글**: 목록 행(`InboxRow`, `SentRow`, `StarredRow`) 및 상세 패널(`MemoDetailPanel`) 헤더에 별 아이콘(☆/★) 버튼 배치. 클릭 시 낙관적 갱신(로컬 상태 즉시 변경) 후 `POST /api/memo { action: "star", memoId, on }` 호출. 실패 시 롤백 및 캐시 최신화.
    - **즐겨찾기 탭**: 상단 탭에 `[받은쪽지함 | 보낸쪽지함 | 즐겨찾기]` 확장. 즐겨찾기 탭 활성화 시 스펙 §1-3의 등호 쿼리 2개(`where("recipientEmails", "array-contains", myEmail)`, `where("senderEmail", "==", myEmail)` + `starredBy.{myEmail} == true`)를 `orderBy` 없이 1회 조회(복합 색인 0 유지). 클라이언트에서 `createdAt` 정렬, `hiddenBy` 필터, 중복 제거 적용. 빈 목록 문구 "별표를 눌러 자주 찾는 쪽지를 모아두세요." 제공.
    - **검색**: 상단 탭 줄 옆 검색 입력창 배치. 검색어 입력 시 기존 쿼리 패턴(`recipientEmails`/`senderEmail` + `startAfter` 페이지네이션 300건)으로 전량 조회 후 5분 TTL의 `clientCache`(`memos:all_user:${myEmail}`)에 캐싱. `src/lib/memo/search_logic.ts`의 `memoMatchesSearch`를 직접 임포트하여 다중 키워드 AND 검색(제목·본문·발신자 이름 스탬프/현재이름·수신자 요약) 적용. 로딩 중 "전체 쪽지에서 찾는 중…", 결과 0건 시 "'{검색어}'에 해당하는 쪽지가 없습니다." 안내, 검색어 비우면 즉시 원래 목록 복귀.
  - `docs/memo_star_search_spec.md`: §5 순서 3을 Antigravity 완료로 갱신.
  - `development_roadmap.md`: §2 피드백 덤프 ⑧, ⑨ 항목 완료 처리.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어 배제, 사용자 눈높이 문구 적용 ("별표를 눌러 자주 찾는 쪽지를 모아두세요.", "전체 쪽지에서 찾는 중…").
  - `memo_star_search_spec`: 즐겨찾기 쿼리에 `orderBy` 미사용, `memoMatchesSearch` 순수 함수 직접 사용(자체 매칭 구현 0건), 검색 전량 조회 시 5분 `clientCache` 적용.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npx tsx scripts/memo_selftest.ts` ✅ (별표 4+검색 10+삭제 6케이스 포함 전 항목 통과)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 삭제(내 화면 감추기) UI 완결 — memo_spec §12-1)
- **변경 파일**:
  - `src/components/admin/MemoSection.tsx`:
    - 상세 패널(`MemoDetailPanel`)에 [삭제] 버튼 추가:
      - 받은쪽지함(`tab === "inbox"`): 읽은 쪽지(`memo.reads?.[myEmail]`)에만 노출 (안 읽은 쪽지는 서버 400 거부 방어 및 "읽은 뒤에 정리할 수 있습니다" 원칙에 따라 미노출).
      - 보낸쪽지함(`tab === "sent"`): 내가 보낸 쪽지(`memo.senderEmail === myEmail`)에 노출.
    - 확인 1회 모달 추가: "이 쪽지를 내 쪽지함에서 지울까요? 내 화면에서만 지워지며 상대방 화면과 기록은 남습니다." (복구 불가에 따른 명확한 고지).
    - 확인 시 `POST /api/memo { action: "hide", memoId: memo.id }` 호출 후 상세 패널 닫기(`onClose()`).
    - 목록 및 전체 쪽지 필터: 받은쪽지(`inboxMemos`), 보낸쪽지(`sentMemos`), 전체 쪽지(`allMemos`), 스레드 이력(`threadMemos`)에서 `memo.hiddenBy?.[myEmail]`가 있는 쪽지를 클라이언트 필터로 제외.
  - `src/components/admin/DashboardMemoPanel.tsx`:
    - 대시보드 받은 쪽지 구독 시 `memo.hiddenBy?.[myEmail]`가 있는 항목을 클라이언트에서 제외하여 삭제된 쪽지가 대시보드에 노출되지 않도록 처리.
  - `src/components/mobile/MobileMemoSection.tsx`:
    - 모바일 받은/보낸 목록 및 스레드 이력 구독에서 `memo.hiddenBy?.[myEmail]` 제외.
    - 모바일 상세 펼침 영역 메타 우측에 [삭제] 버튼 추가 (읽은 수신 쪽지 및 내가 보낸 쪽지 대상) + 확인 모달 제공.
  - `docs/memo_spec.md`:
    - §12-1 상태를 서버부·UI 완결로 갱신.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어 배제 및 사용자 친화적 확인 문구 적용 ("이 쪽지를 내 쪽지함에서 지울까요? 내 화면에서만 지워지며 상대방 화면과 기록은 남습니다.").
  - 새 Firestore 쿼리 생성 금지 (클라이언트 필터 원칙 준수).
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npx tsx scripts/memo_selftest.ts` ✅ (삭제 6케이스 포함 전 항목 통과)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 화면 시각 위계 개선 완결 — roadmap §2 피드백 덤프 ⑦)
- **변경 파일**:
  - `src/components/admin/MemoSection.tsx`:
    - **목록 행 (`InboxRow`, `SentRow`)**:
      - 행 간 경계선 강화 (`border-b border-slate-200/80`) 및 선택 상태 좌측 액센트 바 (`border-l-4 border-l-indigo-600 bg-indigo-50/90`).
      - 발신자/수신자 요약은 윗줄 보조 톤(`text-xs text-slate-500 font-medium`) + 작성 시각(`text-[11px] text-slate-400`)으로 배치.
      - 제목은 아랫줄 주 톤(`text-sm font-bold text-slate-950` / `font-semibold text-slate-800`)으로 명확한 타이포 대비 부여.
      - 안 읽은 쪽지는 은은한 배경(`bg-slate-50/50`), 굵은 제목, 인디케이터 점(`w-2.5 h-2.5 bg-indigo-600 ring-4 ring-indigo-100`)으로 시각적 식별성 강화.
    - **상세 패널 (`MemoDetailPanel`)**:
      - **제목 및 메타 구획 (헤더)**: 상단 흰색 헤더 바에 발신자/수신자와 작성 시각을 작고 옅은 한 줄 메타로 통합(`보낸 사람: 홍길동 · 2026. 8. 18. 06:10`), 제목은 `text-lg font-bold text-slate-900` 주 톤으로 선명하게 분리.
      - **본문 구획 (카드화)**: `bg-white rounded-xl border border-slate-200/90 p-6 shadow-2xs` 독립 카드로 구획하여 `text-[15px] leading-relaxed`의 쾌적한 가독성 확보. 링크 및 첨부 이미지는 카드 내부 하단 구분선 뒤에 안정적으로 수록.
      - **보조 영역 구획 (주고받은 이력 & 읽음 현황)**: 본문 카드 아래 `bg-slate-100/70 border border-slate-200/80 rounded-xl` 보조 박스로 명확히 분리하여 본문과 혼동되지 않도록 구성.
  - `src/components/mobile/MobileMemoSection.tsx`:
    - 모바일 목록 구분선 강화 (`divide-slate-200 dark:divide-slate-800`) 및 안 읽음 배경/링 인디케이터 적용.
    - 윗줄 발신자 보조 톤(`text-xs text-slate-500`) · 아랫줄 제목 주 톤(`text-sm font-semibold text-slate-900`) 대비 일관 적용.
    - 상세 펼침 영역: 상단 한 줄 메타 정보, 독립된 본문 카드(`rounded-xl border p-4 text-[14px]`), 하단 주고받은 이력 보조 박스 분리.
  - `development_roadmap.md`:
    - §2 피드백 덤프 ⑦ 항목 완료 처리.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어 배제, 눈높이 한국어 라벨 유지 ("주고받은 이력", "읽음 현황", "현재 쪽지" 등).
  - 과한 장식 배제 및 명확한 시각 위계(제목/본문/메타/이력 구획) 달성.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `npx tsx scripts/memo_selftest.ts` ✅ (답장 9케이스 포함 전 항목 통과)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 static pages prerendered)

## [2026-08-18] Antigravity → Claude/사용자 (어드민 대시보드 받은 쪽지 편입 완결 — roadmap §2 피드백 덤프 ⑤)
- **변경 파일**:
  - `src/components/admin/DashboardMemoPanel.tsx` (신규):
    - 모바일 `/m` 받은쪽지함과 동일한 `where("recipientEmails", "array-contains", myEmail)` 실시간 `onSnapshot` 구독 재사용 (새 Firestore 쿼리 패턴 0건).
    - 안 읽은 쪽지 우선 정렬 및 동일 상태 내 최신순 정렬.
    - 발신자 표시는 발송 시 서버가 스탬프한 `memo.senderName`을 직접 사용하여 프리페치 전/TTL 만료 시에도 이름 표시 보장 (모바일 쪽지 섹션과 동일 방식, 캐시 직독 제거).
    - 안 읽음 뱃지, 안 읽음 인디케이터 점, 쪽지 제목, 첨부/링크 힌트 아이콘 표출.
    - 조직도 미등록 상태 및 빈 목록 상태 안내 문구 처리.
    - 항목 클릭 시 `onNavigateToMemo(memo.id)` 호출로 쪽지함의 해당 쪽지 상세로 직행 지원.
  - `src/app/admin/page.tsx`:
    - 일반 교사 홈 화면(대시보드) 레이아웃을 2단 반응형 그리드로 개편:
      - 넓은 화면(`lg:` 이상): 2단 그리드 (`lg:col-span-7/8` 좌측 컬럼에 "이번 주 내 시간표" + "오늘의 급식" 세로 스택, `lg:col-span-5/4` 우측 컬럼에 "받은 쪽지" 패널을 세로로 길게 배치).
      - 좁은 화면(`lg:` 미만): 세로 스택 (시간표 → 급식 → 쪽지 순서 유지).
    - `targetMemoId` state 및 `handleNavigateToMemo`를 추가하여 대시보드 항목 클릭 시 쪽지 메뉴 이동과 동시에 해당 쪽지 자동 선택 연동 (`MemoSection initialMemoId={targetMemoId}`).
  - `src/components/admin/MemoSection.tsx`:
    - `initialMemoId` prop을 수신하여 마운트/전환 시 해당 쪽지를 초기 선택하고 `tab="inbox"`로 자동 포커싱.
    - `initialMemoId` 수신 시 `POST /api/memo { action: "read", memoId: initialMemoId }`를 호출하여 대시보드에서 연 쪽지가 발신자에게 정상적으로 "읽음" 처리되도록 동기화 보장.
- **규칙 준수**:
  - Firestore 쿼리 규칙: 기존 `where("recipientEmails", "array-contains", myEmail)` 패턴 준수.
  - `ui-copy-rules`: 개발 용어 배제, "받은 쪽지", "쪽지함 전체보기" 등 직관적인 한국어 문구 적용.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `scripts/memo_selftest.ts` ✅ (답장 9케이스 포함 전 항목 통과)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 static pages prerendered)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 0건)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 답장 및 주고받은 이력 UI 구현 완료 — reply spec §3·§8 순서 2)
- **변경 파일**:
  - `src/components/admin/MemoSection.tsx`:
    - **받은쪽지함 상세 [답장] 버튼**: `tab === "inbox"`일 때 상세 헤더에 `[답장]` 버튼 노출 (보낸쪽지함에는 미노출).
    - **ComposeModal 답장 모드 (`replyToMemo`)**:
      - Step 1(조직도)을 건너뛰고 Step 2(작성)로 바로 진입 (`isReply` 시 초기 `step=2`).
      - 수신자는 원 쪽지 발신자 1인 고정 칩 표시 (칩 삭제 버튼·전체 지우기 버튼·받는 사람 변경 버튼·이름으로 추가 검색창 비노출로 UI 잠금).
      - 제목 `"RE: 원제목"` 프리필 (`/^re:\s*/i` 중첩 방지).
      - 발송 시 `replyToMemoId`를 payload에 포함하여 서버로 전달.
      - 헤더 및 발송 버튼 문구 "답장"으로 통일.
    - **상세 패널 「주고받은 이력」 로컬 그룹핑**:
      - `allMemos` (`inboxMemos` + `sentMemos`)를 `threadId`(`memo.threadId || memo.id`)로 로컬 그룹핑하여 시간순 요약 행(보낸이·제목·시각) 표시 (새 Firestore 쿼리 0건).
      - 현재 쪽지 하이라이트 및 `현재 쪽지` 배지 표시, 행 클릭 시 해당 쪽지 및 탭(`inbox`/`sent`)으로 전환 이동.
  - `src/components/mobile/MobileMemoSection.tsx`:
    - 보낸쪽지함(`sentMemos`) 구독을 추가하여 `allMemos` 기반 `threadId` 로컬 그룹핑 지원.
    - 상세 펼침 영역에 「주고받은 이력」 요약 행 표시 (행 클릭 시 해당 쪽지 본문·첨부로 전환 열람).
    - 모바일 열람 전용 원칙에 따라 [답장] 버튼은 미배치.
- **규칙 준수**:
  - `ui-copy-rules`: 개발 용어(threadId, payload, spec 등) 배제, "답장", "주고받은 이력", "현재 쪽지" 등 눈높이 한국어 문구 적용.
  - Firestore 쿼리 규칙 준수: `threadId` 쿼리 신설 0건 (로컬 그룹핑 사용).
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `scripts/memo_selftest.ts` ✅ (답장 9케이스 포함 전 항목 통과)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh HEAD` ✅ (사라진 상호작용 없음)


## [2026-08-18] Claude(Fable) → Antigravity/사용자 (편성 등록부 잠금 — 스펙+서버 가드 완결, UI 인계)
- 변경 파일: docs/registry_lock_spec.md(신설)·src/lib/timetable/{server,types}.ts·src/app/api/timetable/manage/route.ts(편집 10종 배선)·scripts/verify_registry_lock.ts(신설)
- 검증 상태: tsc ✅ / build ✅ / verify_registry_lock 5항 ✅(실데이터: 운영 2026-2 잠김·초안 2027-1 자유)
- 다음 할 일: Antigravity — 스펙 §5대로 잠금 배지·사유 입력 다이얼로그(423 registry-locked 분기)·보관 학기 비활성·㉯ 계열 안내 문구
- 주의: ① 잠금의 원본은 서버 가드 — UI는 423 응답으로 분기하는 것이 기본, 선제 배지만 activeTermId 비교 허용 ② 요청 계약 = 편집 10종에 unlockReason(2~200자) 동반, 문구는 스펙 §4의 확정 문안 사용 ③ **주의: 이 기능 배포 순간부터 운영 학기(2026-2) 등록부 편집은 사유 없이는 423으로 막힌다** — UI 배포 전까지 운영 학기 등록부를 편집할 일이 생기면 초안에서 하거나 UI 완성을 기다릴 것

## [2026-08-18] Antigravity → Claude/사용자 (편성 등록부 잠금 UI 구현 완료)
- **변경 파일**:
  - `src/components/admin/timetable/RegistryUnlockModal.tsx` (신규):
    - 스펙 §4 확정 문구(잠김 안내 ⓐ + 해제 경고 ⓑ)를 담은 사유 입력 다이얼로그(2~200자 실시간 카운터 및 유효성 검사).
    - `sessionStorage` 기반 사유 캐싱(`getStoredUnlockReason`, `setStoredUnlockReason`, `clearStoredUnlockReason`)을 제공하여 편집 세션 동안 반복 입력 부담 완화.
  - `src/components/admin/timetable/SimulGroupTab.tsx`:
    - 저장(`simul_save`)/삭제(`simul_delete`) 시 423 (`code: "registry-locked"`) 응답 분기 처리 (`termState: "operating"` 시 모달 오픈 및 사유 첨부 재요청, `termState: "archived"` 시 열람 전용 안내).
    - 운영 학기일 때 폼 헤더 및 저장/삭제 버튼에 `🔒` 자물쇠 배지 선제 표시, 보관 학기일 때 편집 비활성화.
  - `src/components/admin/timetable/VenueGroupTab.tsx`:
    - 특별실 저장(`venue_save`)/삭제(`venue_delete`) 423 응답 분기 처리 및 `🔒` 자물쇠 배지/보관 학기 비활성화.
  - `src/components/admin/timetable/TeacherSlotBanTab.tsx`:
    - ㉯ 계열 탭 상단 안내(스펙 §4 확정 문구 ⓒ: *"이 등록 내용은 시간표를 새로 짤 때 쓰입니다. 운영 중인 시간표에는 영향을 주지 않습니다."*) 상시 표시.
    - 규칙 저장(`slot_ban_save`)/삭제(`slot_ban_delete`)/AI 말로 입력 일괄 저장 423 응답 분기 및 `🔒` 자물쇠 배지/보관 학기 비활성화.
  - `src/components/admin/timetable/ConsecutiveRuleTab.tsx`:
    - ㉯ 계열 탭 상단 안내(스펙 §4 확정 문구 ⓒ) 상시 표시.
    - 연속수업 저장(`consecutive_rule_save`)/삭제(`consecutive_rule_delete`) 423 응답 분기 및 `🔒` 자물쇠 배지/보관 학기 비활성화.
  - `src/components/admin/timetable/CoTeachingRuleTab.tsx`:
    - ㉯ 계열 탭 상단 안내(스펙 §4 확정 문구 ⓒ) 상시 표시.
    - 복수교사 저장(`co_teaching_rule_save`)/삭제(`co_teaching_rule_delete`) 423 응답 분기 및 `🔒` 자물쇠 배지/보관 학기 비활성화.
  - `src/components/admin/timetable/TimetableCreationSection.tsx`:
    - 5개 탭(`SimulGroupTab`, `VenueGroupTab`, `TeacherSlotBanTab`, `ConsecutiveRuleTab`, `CoTeachingRuleTab`)에 `isOperating={!!activeTermId && effectiveTermId === activeTermId}` 및 `isArchived={workingTerm?.status === "archived"}` prop 전달.
- **규칙 준수**:
  - `AGENTS.md` (ui-copy-rules): 개발 용어(registry-locked, unlockReason 등)나 메타문구(스펙 §, 컴시간 등) 화면 노출 없음, 스펙 §4 확정 문구 정확히 적용.
  - 단일 원본 원칙: 잠금 판정은 서버 423 응답이 원본이며, UI는 응답에 따라 사유 다이얼로그 분기 처리.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (39/39 pages prerendered)
  - `bash scripts/check_ui_removals.sh 87f956d` ✅ (사라진 상호작용 없음)
  - `npx tsx --env-file=.env.local scripts/verify_registry_lock.ts` ✅ (5개 케이스 전판 통과)

## [2026-08-18] Antigravity → Claude/사용자 (편성 등록부 잠금 해제 다이얼로그 동작 조임)
- **배경**: 스펙 §4 ⓑ 해제 경고 원칙("이 변경은 이미 확정된 교체의 판정 근거를 바꿉니다")에 따라, 세션 사유가 있더라도 매 잠금 해제 편집 시 경고 다이얼로그(`RegistryUnlockModal`)를 반드시 표시하고 확인을 거쳐 진행하도록 동작 조임.
- **변경 파일**:
  - `docs/registry_lock_spec.md` (§5): "사유는 편집 세션 동안 기억하되 다이얼로그 창은 매번 표시하여 확인 후 진행하도록 한다"로 문구 수정.
  - `src/components/admin/timetable/{SimulGroupTab,VenueGroupTab,TeacherSlotBanTab,ConsecutiveRuleTab,CoTeachingRuleTab}.tsx` (5개 탭 공통):
    - 요청 전 `getStoredUnlockReason` 자동 동봉을 제거하고 모달에서 확인된 `reasonOverride`만 요청에 싣도록 변경.
    - `getStoredUnlockReason`은 다이얼로그 오픈 시 기본값 프리필(1클릭 확인 편의)에만 전담.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (39/39 pages prerendered)
  - `bash scripts/check_ui_removals.sh f9f5961` ✅ (사라진 상호작용 없음)
  - `npx tsx --env-file=.env.local scripts/verify_registry_lock.ts` ✅ (5개 케이스 전판 통과)

## [2026-08-18] Claude(Fable) → 사용자 (알림 센터 스펙 작성 — 결정 권고안 확정 대기)
- 변경 파일: docs/notification_center_spec.md(신설)·development_roadmap.md(상태 줄)
- 검증 상태: 문서 작업 — 코드 무변경. 스펙 내 실코드 대조: userData 전역 실시간 구독 실재(배지 카운터 무임승차 근거)·webpush.ts 실재·SwapDraft.consentStatus 기호환(§13-3) 확인
- 다음 할 일: 사용자 — 스펙의 [권고] 8건(ⓐ~ⓔ + 수락 ⓐ~ⓒ) 확정. 확정 후 §7 순서대로 Claude 서버 코어 착수
- 주의: 쪽지 2단계(이미지 첨부)는 스펙 §8 분업상 서버부(Claude)가 UI보다 선행 — attach_upload 미구현 실측 확인, Antigravity UI 인계는 서버부 완성 후

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (알림 센터 서버 코어 완결 — 스펙 §7 순서 1~3)
- 변경 파일: src/lib/notifications/server.ts(신설)·src/app/api/notifications/route.ts(신설)·src/lib/push/webpush.ts(수업 변경 원장 편입)·src/app/api/timetable/{manage,requests}/route.ts·src/app/api/memo/route.ts·src/lib/timetable/{server,types}.ts·docs/notification_center_spec.md(확정·구현 노트)·personal_data_inventory.md(notifications 등재)·scripts/verify_notifications.ts(신설)
- 검증 상태: tsc ✅ / build ✅ / verify_notifications(읽기 전용 스모크) ✅
- 다음 할 일: ① Antigravity — 벨·목록·수락 버튼 UI(스펙 §6, API: /api/notifications list·mark_read·consent_decide, 배지 = userData.unreadNotifCount) ② 사용자 or Claude — Firestore 콘솔에서 notifications 컬렉션 그룹 TTL 정책(expireAt) 1회 설정 ③ 후속 — 프로필 승인(행정 처리 유형) 발생 지점 배선, 양해 카드 UI에 consent_request 액션 연결
- 주의: ① 원장 발생 3종 배선 완료(수업 변경 전 경로[webpush 단일 지점]·신청 승인/반려·쪽지 발송), 행정 처리는 자리만 ② 푸시는 기존 경로 유지(이중 발송 방지) — emitNotification은 저장·카운터만 ③ 수업 변경 원장은 교사만(학생은 푸시만 — 문서 폭발 방지) ④ consent_decide는 swap_draft의 consentStatus를 REQUESTED→CONSENTED/DECLINED로 전이하고 신청자에게 결과 알림(365일 보존)

## [2026-08-18] Antigravity → Claude/사용자 (알림 센터 화면 UI & 양해 요청 연동 완료)
- **변경 파일**:
  - `src/lib/firebase/auth.ts`: `UserData` 인터페이스에 `unreadNotifCount?: number` 필드 추가.
  - `src/components/common/NotificationCenter.tsx` (신설):
    - 상단 벨(🔔) 아이콘 및 미열람 배지(AuthContext의 `userData.unreadNotifCount`를 그대로 구독하여 추가 읽기 비용 0원).
    - 벨 클릭 시 `POST /api/notifications` `{ action: "list" }`로 최신 30건 조회 및 동시에 `{ action: "mark_read" }` 호출(자가 치유 및 배지 0 리셋).
    - 원본 바로가기(딥링크): 쪽지(`memo`), 신청 처리(`swap_request`), 수업 변경(`weekly`/`timetable_change`), 양해 초안(`swap_draft`)별 맞춤 이동.
    - 양해 수락 창구: `actionable.state === "pending"` 항목에 `[🤝 양해합니다]` / `[어렵습니다]` 버튼 연동 (`action: "consent_decide"`).
    - UI Copy Rules 준수: 기술 용어 배제, 빈 목록 문구 *"새로 확인할 알림이 없습니다."*, 교사·학생 공통 레이아웃.
  - `src/app/admin/page.tsx`, `src/app/student-portal/page.tsx`, `src/app/m/page.tsx`: 각 상단 헤더에 `NotificationCenter` 컴포넌트 탑재.
  - `src/components/admin/timetable/TeacherPortalSection.tsx`:
    - `teacher_portal_nav` 커스텀 이벤트 리스너 추가 (알림 딥링크와 탭 동기화).
    - 초안 카드 및 융합 양해 섹션에 `[📨 양해 요청 보내기]` 버튼 배선 (`POST /api/timetable/requests` `{ action: "consent_request", draftId }`).
    - 초안 카드에 `consentStatus` (`REQUESTED`, `CONSENTED`, `DECLINED`) 상태 배지 표시.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh 63d94de` ✅ (사라진 상호작용 없음)
  - `npx tsx --env-file=.env.local scripts/verify_notifications.ts` ✅ (질의 경로 전판 통과)

## [2026-08-18] Antigravity → Claude/사용자 (알림 입구 단일화 — 벨 패널 통합 및 푸시 안내 배너 경량화)
- **배경**: 원장(벨)과 푸시 스위치(대시보드 카드)가 둘 다 "알림"으로 표기되어 발생하던 혼란을 해소하기 위해 입구를 벨 하나로 통일 (스펙 §6-1).
- **변경 파일**:
  - `src/components/common/NotificationCenter.tsx`:
    - 패널 하단에 「기기로 바로 알림 받기」 스위치 토글 및 `[시험 알림]` 버튼 통합.
    - 설명 한 줄: *"꺼도 알림 목록에는 계속 쌓입니다."* 표시.
    - `open_notification_center` 커스텀 이벤트 리스너 추가.
    - 명명 규약 준수: 패널 헤더는 "알림", 기기 푸시는 "기기로 바로 알림 받기"로 정립.
  - `src/components/common/PushNotificationManager.tsx`:
    - 기존 대형 카드에서 푸시 미설정 사용자에게만 노출되는 1줄 유도 배너(*"알림을 기기로도 받아보세요 →"*)로 경량화.
    - 클릭 시 벨 패널을 열도록 연동(`open_notification_center`), 기기 알림 활성화 시 배너 자동 소멸.
  - `src/components/pwa/PWAInstallPrompt.tsx`, `src/components/admin/PWAInstallGuideTab.tsx`:
    - 앱 설치 안내 문구 내 "알림 받기" 표현을 "알림을 기기로도 받아보세요" 및 "기기로 바로 알림 받기"로 일관성 있게 갱신.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh 8d67ed7`:
    - 대시보드 대형 푸시 카드(`PushNotificationManager.tsx`)의 버튼 및 문구 삭제는 스펙 §6-1 지시된 통합/경량화에 따른 의도된 변경임.
    - `NotificationCenter.tsx` 헤더를 "알림 센터" → "알림"으로 변경하고 `PWAInstallGuideTab.tsx` / `PWAInstallPrompt.tsx`의 표현을 명명 규약대로 수정한 의도된 변경임.

## [2026-08-18] Claude(Fable) → 사용자 (알림 센터 종결 — 실기기 확인 통과)
- 변경 파일: development_roadmap.md(종결·잔여 2건 등재)·project_notes.md
- 검증 상태: 실기기 확인 = 배지·목록·읽음 처리·입구 통일 전부 사용자 통과. 검수 = 삭제 소명 일치·tsc·명명 규약 일괄 적용 확인
- 다음 할 일: 잔여 2건은 로드맵 상태 줄로 분리(TTL 콘솔 설정·프로필 승인 배선) — 착수 시점 자유
- 주의: TTL 설정 전까지 알림 문서는 자연 누적되나 180일 보존 정책 내라 무해. 양해 수락 흐름의 실전 첫 사용은 실사용 재개 후 자연 발생 — 그때 consent_decide 감사 로그 확인 권장

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (양해 수락의 제출 효력 + 미니 쪽지 왕복 배선)
- 변경 파일: src/lib/timetable/{server,types}.ts·src/lib/notifications/server.ts·src/app/api/notifications/route.ts·src/app/api/timetable/requests/route.ts·docs/notification_center_spec.md
- 검증 상태: tsc ✅ / build ✅
- 다음 할 일: Antigravity UI 4곳 — ① 양해 요청 다이얼로그(부탁 한 줄 입력, consentMessage) ② 알림 항목에 message 표시(제목 아래 회색 한 줄) ③ 거절 시 사유 입력(consent_decide body.note)·결과 알림에 사유 표시 ④ 담긴 요청 카드에 양해 상태 배지(REQUESTED 대기/CONSENTED ✓ 알림으로 양해 받음[수동 체크 대체 표시]/DECLINED 사유 표시)
- 주의: ① 제출 효력은 서버가 판정(consentDraftId — create·create_batch 이미 전달 배선 완료) — UI는 CONSENTED면 체크박스 대신 "✓ 알림으로 양해 받음" 표시만 ② 수락 창구의 컨테이너(알림 vs 쪽지) 재검토 질문은 사용자 결정 대기 — Claude 권고는 알림 유지

## [2026-08-18] Antigravity → Claude/사용자 (양해 왕복 화면 4곳 구현 완료)
- **변경 파일**:
  - `src/lib/timetable/types.ts`: `SwapDraft` 인터페이스에 `consentNote?: string` 필드 추가.
  - `src/lib/timetable/server.ts`: `listSwapDrafts` 매핑에 `consentNote` 포함.
  - `src/components/common/NotificationCenter.tsx`:
    - 알림 항목에 `message` 필드 존재 시 제목 아래 인용구 스타일로 표시 (미니 쪽지).
    - `[어렵습니다]` 클릭 시 사유 한 줄 입력(선택, 200자) 입력창 표출 및 `consent_decide` 호출 시 `note` 동봉.
    - `consent-result` 알림 및 거절 항목에 사유(`actionable.note`) 표시.
  - `src/components/admin/timetable/TeacherPortalSection.tsx`:
    - 양해 카드 및 융합 바의 `[양해 요청 보내기]` 클릭 시 부탁 한 줄(선택, 200자) 입력 다이얼로그(`ConsentRequestModal`) 표출 및 `consent_request`에 `consentMessage` 동봉.
    - 담긴 요청 카드에 양해 상태 배지 표출: `REQUESTED` "📨 양해 대기 중", `CONSENTED` "✓ 알림으로 양해 받음", `DECLINED` "❌ 어렵다고 답함" + `(사유: ...)` 표시.
    - 단건/일괄 제출 확인 모달에서 `CONSENTED`인 항목은 수동 체크박스 숨김 처리 및 `✓ 알림으로 양해 받음` 배지 표시, 서버로 `consentDraftId` 전달.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh 9a15edd`:
    - `TeacherPortalSection.tsx`의 "✅ 양해 수락됨", "❌ 양해 거절됨", "양해 수락 완료" 변경은 지시서에 명시된 "✓ 알림으로 양해 받음" 및 "❌ 어렵다고 답함" + 사유 표시로의 갱신에 따른 정상적인 변경임.

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (양해 왕복의 직권 동등성 — 서버 배선 완결)
- 변경 파일: src/lib/timetable/{server,types}.ts·src/app/api/timetable/{manage,requests}/route.ts·docs/notification_center_spec.md
- 검증 상태: tsc ✅ / build ✅
- 다음 할 일: Antigravity — 직권 화면(DirectSubstituteTab) 담기 목록을 서버 초안으로 전환 + 양해 왕복 UI (아래 주의 참조)
- 주의: ① 담기 시 draft_save에 draft.direct=true로 저장, 목록은 draft_list {directOnly:true}(교사 포털과 자동 분리), 비우기/반영 성공 시 draft_delete ② 담기 카드에 [양해 요청 보내기](부탁 한 줄)·상태 배지 — 교사 포털 구현(00a7685)과 같은 패턴 재사용 ③ 반영(direct_commit·direct_commit_batch) 시 item.draftId 동봉하면 CONSENTED 초안은 양해 확인 다이얼로그 생략 가능(서버가 인정, method:"in-app" 기록) ④ 기존 "양해 이미지 만들기"는 존치(구두 양해 관행 보조) ⑤ 교사 전환 시 목록 비우기 규약은 direct 초안 삭제로 대체 구현

## [2026-08-18] Antigravity → Claude/사용자 (직권 화면 서버 초안 전환 및 양해 왕복 UI 구현 완료)
- **변경 파일**:
  - `src/components/admin/timetable/DirectSubstituteTab.tsx`:
    - **서버 초안 전환**: 담기(`handleAddToCart`, `handleAddChainToCart`) 시 `draft_save`에 `direct: true`로 서버 저장. 마운트 시 `draft_list` `{ directOnly: true }` 조회로 새로고침 후에도 담기 복원. 개별 삭제 및 전체 비우기 시 `draft_delete` 호출.
    - **교사 전환 시 비움 규약**: 교사 전환 시 확인 후 서버 직권 초안을 `draft_delete`로 삭제 처리.
    - **양해 왕복 UI**: 담기 카드에 양해 상태 배지(`REQUESTED` "📨 양해 대기 중", `CONSENTED` "✓ 알림으로 양해 받음", `DECLINED` "❌ 어렵다고 답함" + 사유) 및 `[📨 양해 요청 보내기]` 버튼 연동(부탁 한 줄 모달 포함).
    - **상대 교사별 양해 바**: 기존 양해 이미지 카드 복사 기능 존치 + `[📨 요청]` 버튼을 통합하여 상대 교사별 일괄 알림 요청 지원.
    - **일괄 반영 효력 연동**: `direct_commit_batch` 호출 시 `draftId` 동봉 및 `CONSENTED` 초안은 양해 확인 다이얼로그에서 수동 체크박스 숨김(`✓ 알림으로 양해 받음` 표시) 또는 생략 처리. 반영 성공 항목은 서버 직권 초안 자동 삭제 정리.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh f9bd523`:
    - `DirectSubstituteTab.tsx`의 "양해 이미지 카드 복사 (상대 교사별):" 라벨이 신규 알림 요청 기능과 통합된 "양해 이미지 카드 복사 / 알림 요청 (상대 교사별):"로 확장된 정상 변경임.

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (알림 목록 더 보기 — 서버 페이지 확장)
- 변경 파일: src/lib/notifications/server.ts·src/app/api/notifications/route.ts·scripts/verify_notifications.ts
- 검증 상태: tsc ✅ / build ✅ / verify_notifications ✅
- 다음 할 일: Antigravity — 알림 패널 하단 [지난 알림 더 보기] 버튼: list 응답의 hasMore가 true면 표시, 클릭 시 limit을 30씩 늘려(최대 200) 재조회
- 주의: 스펙 §6의 "30개 + 더 보기" 중 더 보기가 MVP에서 누락됐던 것의 보수. 알림은 원장(포인터)이라 영구 아카이브는 설계상 없음(180일 파기) — 사용자 질문에 대한 확정 답

## [2026-08-18] Antigravity → Claude/사용자 (알림 패널 지난 알림 더 보기 구현 완료)
- **변경 파일**:
  - `src/components/common/NotificationCenter.tsx`:
    - 알림 패널 열람 시 기본 30건 조회(`limit: 30`) 및 `hasMore` 상태 수신.
    - `hasMore`가 `true`일 때 목록 하단에 `[지난 알림 더 보기]` 버튼 표출.
    - 클릭 시 `limit`을 30씩 늘려(최대 200) `POST /api/notifications` `{ action: "list", limit }`로 재조회하여 목록 교체 및 `hasMore` 갱신.
    - 상한선(200건) 도달 시 버튼 대신 `"더 오래된 알림은 자동 정리되었습니다"` 한 줄 안내 표시.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh 1168df6` ✅ (사라진 상호작용 없음)

## [2026-08-18] Claude 체크포인트 — 이틀 스프린트 종료·새 창 전환점
- **이번 창에서 완결된 트랙 (전부 실기기 확인 포함 종결)**: ① 작업 7 과목 이름 단일 사전 전체(스펙→코어→UI→실사고 4건 보수→§5 2단계 폴백 제거까지, subject_dictionary_spec) ② 참조 학기 우선순위(전전학기 규칙, utils.rankReferenceTerms) ③ 편성 등록부 잠금(registry_lock_spec, 서버 가드+UI+실측) ④ 알림 센터 전체(notification_center_spec — 원장·배지·입구 통일·수락 창구·미니 쪽지 왕복·직권 동등성·더 보기)
- **결정된 원칙(신규)**: 실무자 관행에 처방 금지 / 알림=원장·푸시=초인종·입구는 벨 하나 / 양해는 "문구 달라도 프로세스 동일"(교사·일과계) / 독촉 대행 금지
- **다음 작업(사용자 확정)**: 쪽지 2단계(이미지 첨부) — memo_attachment_spec §8 순서 1·2(서버: attach_upload·staging 대조·권한 부여·폴더 관리·검증)가 Claude 몫. **주의: 스펙 §5(양해 쪽지 전송 버튼)는 오늘 구현된 알림 양해 왕복과 겹침 — 착수 시 §5 존폐/축소를 먼저 판단할 것**
- **잔여 소품**: TTL 콘솔 설정(사용자 콘솔 접속 시)·프로필 승인 알림 배선·양해 왕복 실기기 확인(상대 계정 필요)

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (쪽지 2단계 서버부 완결 + §5 양해 쪽지 버튼 폐지 판정)
- 변경 파일: docs/memo_attachment_spec.md(§5 폐지 판정·§8/§9 갱신)·development_roadmap.md(같은 판정 기록)·src/lib/memo/{attachment_logic,attachments}.ts(신설)·src/lib/memo/logic.ts(MemoDoc 첨부 필드)·src/app/api/memo/route.ts(attach_upload·send 확장·recall 권한 회수·attachment_quota)·scripts/memo_attachment_selftest.ts(신설)
- 검증 상태: tsc ✅ / build ✅ / memo_attachment_selftest ✅ (순수 19건 + 실계정 사이클 — 업로드→staging 위조·재사용 차단→파일명 확정→수신자 권한 실측→회수→파기, 흔적 0)
- 다음 할 일: Antigravity — 쓰기 첨부 UI·읽기 썸네일 (스펙 §4, 인계 프롬프트는 이번 답변 말미)
- 주의: ① **§5(양해 쪽지 전송 버튼) 폐지** — 알림 양해 왕복이 상위 호환 대체, 해당 UI 만들지 말 것(스펙 §5 판정) ② 발송 payload의 attachments는 **driveFileId 문자열 배열만** — 이름·링크 등 메타데이터는 서버가 staging에서 복원(클라이언트 값 불신) ③ 업로드 = POST /api/memo **multipart**(필드명 "file", 장당 1요청, 응답 {attachment}) ④ 권한 부여는 응답 후 비동기(after) — 수신자가 즉시 클릭하면 Drive "권한 요청" 화면 가능(스펙이 수용, 다음 발송 때 재시도 수렴) ⑤ 실측: hmnotice@ Drive는 학교 풀 용량(≈101TB 중 10.4TB 사용) — 스펙 §1의 15GB 가정은 과보수, 파기 주기 압박 없음 ⑥ 파기 크론(§8 순서 5)·staging 24h 고아 정리는 미구현 잔여 — 크론 구현 시 platform_config/attachment_folders 캐시 키 정리 포함(attachments.ts 주석 참조)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 2단계 이미지 첨부 및 열람 UI 구현 완료)
- **변경 파일**:
  - `src/lib/memo/client_attachments.ts`: 클라이언트 캔버스 리사이즈(최대 변 2000px, JPEG 품질 0.85, PNG 원본 유지), 3.5MB 이하 검증, 장당 1건 multipart 업로드 통신 헬퍼 신설.
  - `src/components/common/MemoAttachmentGrid.tsx`: 첨부 썸네일 그리드 컴포넌트 신설 (thumbnailLink 썸네일 표출, 에러 시 폴백 아이콘, 클릭 시 webViewLink 새 탭 열기, 기술 용어 배제).
  - `src/components/admin/MemoSection.tsx`:
    - **쪽지 쓰기**: Step 2에 이미지 첨부(최대 5장) UI 연결. 파일 선택 시 실시간 캔버스 리사이즈 및 비동기 업로드, 썸네일 미리보기·삭제(✕)·업로드 진행률/에러 상태 표출.
    - **발송**: `attachments`에 `driveFileId` 문자열 배열만 담아 서버로 전달 (메타데이터 제외).
    - **쪽지 열람**: `MemoDetailPanel` 내 본문 및 링크 하단에 `MemoAttachmentGrid` 배치.
  - `src/components/mobile/MobileMemoSection.tsx`: 모바일 쪽지 상세 펼침 뷰에 `MemoAttachmentGrid` 배치.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh fc4ff61` ✅ (사라진 상호작용 없음)

## [2026-08-18] Claude(Fable) → 사용자 (쪽지 2단계 UI 검수 통과 — 실기기 확인만 잔여)
- 변경 파일: (검수만, 코드 무변경) 대상 = b81cff5
- 검증 상태: 핸드오버 주장 3건 전부 재실측 일치 — tsc ✅ / build ✅(40/40) / check_ui_removals fc4ff61 ✅. 계약 준수 확인 — 발송은 driveFileId 배열만 전송, 업로드 중·실패 시 발송 차단, 썸네일 실패 아이콘 폴백, §5 버튼 미생성(지시 준수), 화면 문구에 기술 용어 없음
- 다음 할 일: 사용자 — 실기기 확인(쪽지 쓰기에서 이미지 첨부→본인에게 발송→받은쪽지함 썸네일→클릭 열람). Antigravity는 실기기 검증 불가 항목
- 주의: ① 경미 2건(비차단): 다크 모드에서 썸네일 배경 클래스 오타(dark:bg-slate-750 — 존재하지 않는 색, 무해)·작성 중 창을 닫으면 업로드분이 고아로 남음(24h 정리는 파기 크론 몫이라 그때까지 잔존 — 기지 잔여) ② main은 origin과 동기화 = 이미 배포 반영(방학 완화 유지 중이라 무해)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 쓰기 클립보드 이미지 붙여넣기 구현 완료)
- **변경 파일**:
  - `src/components/admin/MemoSection.tsx`:
    - `enqueueFiles` 공통 큐 함수 분리 (파일 선택 및 클립보드 붙여넣기에서 동일 리사이즈·업로드 파이프라인 공유).
    - `handlePaste` 이벤트 핸들러 추가: `clipboardData.items`에서 이미지 파일(`image/png`, `image/jpeg`, `image/webp`) 감지 시 기본 파일명(`붙여넣은 이미지.png`) 부여 후 `enqueueFiles`로 연결, 텍스트 붙여넣기는 브라우저 기본 동작 유지.
    - Step 2 모달 컨테이너, 제목 입력창, 본문 입력창에 `onPaste={handlePaste}` 연결.
    - 이미지 첨부 영역에 `"복사한 이미지를 붙여넣어도 됩니다."` 안내 문구 추가.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh b81cff5` ✅ (사라진 상호작용 없음)

## [2026-08-18] Claude(Fable) → 사용자 (붙여넣기 검수 — 중복 첨부 버그 1건 발견·직접 수정)
- 변경 파일: src/components/admin/MemoSection.tsx (handlePaste에 stopPropagation 한 줄)
- 검증 상태: tsc ✅ / build ✅(40/40) / check_ui_removals b17c1c7 ✅. 버그 = onPaste가 입력창과 Step 2 컨테이너 양쪽에 걸려 있어 입력창 붙여넣기가 버블링으로 두 번 처리 → 같은 이미지 2장 첨부·2회 업로드(enqueueFiles에 중복 방어 없음 실측). preventDefault는 전파를 막지 않음
- 다음 할 일: 사용자 — 실기기 확인(이미지 복사 → 쪽지 본문에 Ctrl+V → 1장만 붙는지, 파일 선택 첨부·발송·썸네일도 겸사 확인)
- 주의: 붙여넣기 구현 자체는 계약 준수(이미지 항목만 소비·텍스트 붙여넣기 무영향·기본 파일명 부여) — 비이미지(gif 등)는 업로드 단계에서 항목별 사유로 거부되는 기존 동선 그대로

## [2026-08-18] Claude(Fable) → 사용자/Antigravity (쪽지 답장 스펙 확정 — memo_reply_spec.md)
- 변경 파일: docs/memo_reply_spec.md(신설)·development_roadmap.md(스펙 완료 기록)
- 검증 상태: 문서 작업 — 1단계 스펙 전문·2단계 첨부 스펙·현행 route/logic/rules 대조 후 작성
- 다음 할 일: Claude — §8 순서 1 서버부(send에 replyToMemoId 검증·수신자 강제·threadId 스탬프 + selftest). 그 후 Antigravity UI(§3)
- 주의: ① 답장 수신자 = 원 발신자 1인 **서버 강제**(전체 답장 제외 — 알림 피로·"쪽지는 업무용" 원칙) ② 스레드 전용 쿼리 금지 — firestore.rules상 증명 불가로 거부됨, 스레드 뷰는 받은/보낸 onSnapshot 목록의 threadId 로컬 그룹핑(§2에 수용 한계 명기) ③ 규칙·색인·알림·첨부·회수 전부 무변경 승계가 설계 목표(send 변형일 뿐)

## [2026-08-18] Antigravity → Claude/사용자 (알림 종 아이콘 최상단 최우측 고정 및 패널 모바일 오버플로우 방지)
- **배경**: 학교 이름 카드 내부에 종이 위치하여 화면 중간 팝업 및 모바일 좌측 잘림 현상 발생 (roadmap §2 피드백 ①).
- **변경 파일**:
  - `src/components/common/NotificationCenter.tsx`:
    - 드롭다운 패널 반응형 위치 개선: 모바일(`fixed right-3 top-14 mt-1 w-[min(384px,calc(100vw-1.5rem))]`), 데스크톱(`sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-96`)으로 어떤 모바일 화면 폭에서도 좌우 12px 여백 유지 및 오버플로우 원천 방지.
    - 바깥 터치/클릭 감지에 `touchstart` 리스너 추가 (모바일 닫기 지원).
  - `src/app/admin/page.tsx`: 상단 내비게이션 바 우측 끝에 `NotificationCenter` 고정 배치.
  - `src/app/student-portal/page.tsx`: 기존 보라색 배너 카드 내부의 종 아이콘을 상단 고정 헤더(`sticky top-0 z-40`) 우측 끝으로 이동 분리.
  - `src/app/m/page.tsx`: 상단 고정 헤더(`sticky top-0 z-40`) 우측 끝에 `NotificationCenter` 배치.
- **검증 상태**:
  - `npx tsc --noEmit` ✅ (0 errors)
  - `NODE_OPTIONS="--max-old-space-size=6144" npm run build` ✅ (40/40 pages prerendered)
  - `bash scripts/check_ui_removals.sh 2698774` ✅ (사라진 상호작용 없음)

## [2026-08-18] Claude(Fable) → 사용자 (첨부 실패 사유 표시 수정 + 대용량 첨부 아이디어 기록)
- 변경 파일: src/components/admin/MemoSection.tsx(실패 사유를 카드 하단 전체 폭 줄로 — 80px 말줄임 폐기)·development_roadmap.md(피드백 덤프 ②③ 등재)
- 검증 상태: tsc ✅ / build ✅(40/40). 실기기 재확인 = 사용자(3.5MB 테스트 이미지 재첨부 시 "첨부 이미지는 3.5MB 이하여야 합니다"가 카드 아래 보여야 함)
- 다음 할 일: 사용자 실기기 확인 → 답장 서버부(Claude)
- 주의: ③ 대용량 첨부는 전제 교정 포함해 로드맵에 기록 — 첨부는 이미 전부 Drive 저장, 한도는 업로드 통로(Vercel 4.5MB). 해법(업로드 세션 URL)은 일반 파일 첨부 단계와 한 묶음 판단

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (쪽지 답장 서버부 완결 — reply spec §8 순서 1)
- 변경 파일: src/lib/memo/logic.ts(ReplyContext·resolveReplyContext·MemoDoc threadId/replyTo)·src/app/api/memo/route.ts(send에 replyToMemoId 분기)·scripts/memo_selftest.ts(답장 9케이스 확장)
- 검증 상태: memo_selftest ✅ 전판 / tsc ✅ / build ✅(40/40)
- 다음 할 일: Antigravity — 답장 UI (reply spec §3: 받은쪽지함 상세 [답장] 버튼·ComposeModal 고정 수신자 모드·상세 「주고받은 이력」 로컬 그룹핑·/m 이력 표시)
- 주의: ① 답장 발송 = 기존 send에 replyToMemoId만 추가 — 수신자 입력은 서버가 무시하고 원 발신자 1인으로 강제(그룹 확장도 건너뜀), UI도 수신자 잠금으로 정직하게 ② 자격 = 부모 쪽지의 수신자 본인만(발신자 본인·비당사자·회수된 수신자 403) ③ 스레드 뷰는 전용 쿼리 금지 — 받은/보낸 onSnapshot 목록을 threadId로 로컬 그룹핑(규칙상 threadId 쿼리는 거부됨, limit 50 밖 이력은 안 보이는 한계 수용) ④ 응답에 threadId 에코 포함

## [2026-08-18] Claude(Fable) → 사용자/Antigravity (답장 UI 검수 통과 — 단, 커밋 미이행 지적)
- 변경 파일: (검수만, 코드 무변경) 대상 = 작업 트리의 미커밋 답장 UI
- 검증 상태: tsc ✅ / build ✅(40/40) / check_ui_removals 0f37904 — 표시 1건(setMemos)은 받은/보낸 구독 분리에 따른 정당 개명(소명 완료). 계약 준수 확인 — 답장 버튼 inbox 전용·수신자 잠금(칩 제거/검색/전체 지우기 비노출)·RE 중첩 방지·replyToMemoId 전송·threadId 신규 쿼리 0건·모바일 열람 전용 유지(+이력 열람 시 read 멱등 호출은 가점)
- 다음 할 일: ① Antigravity — **자기 변경 직접 커밋**(④-3 게이트 1번 미이행 — 작업 트리에 미커밋 상태로 완료 보고됨. 검수자는 대행하지 않음) ② 커밋·push 후 사용자 실기기 확인: 자기에게 쪽지 → [답장] → 보낸쪽지함에 RE 도착·상세의 「주고받은 이력」 왕복 표시
- 주의: 모바일 이력 senderLabel 폴백이 이메일(senderName 부재 시) — senderName은 발송 시 항상 스탬프되므로 실노출 거의 없음, 비차단 메모만

## [2026-08-18] Claude(Fable) → 사용자 (대시보드 쪽지 재검수 통과 — 반려 2건 수정 확인)
- 변경 파일: (검수만, 코드 무변경) 대상 = a5ced5c
- 검증 상태: 반려 2건 수정 실측 — ① 대시보드 직행 read 호출(멱등) 들어감 ② DashboardMemoPanel 캐시 직독 제거·senderName 스탬프 사용. tsc ✅ / build ✅(40/40) / check_ui_removals 0953832 ✅. 커밋·push·자동 배포 반영 확인
- 다음 할 일: 사용자 실기기 확인 — 대시보드에서 안 읽은 쪽지 클릭 → 상세 열림 + (다른 계정 보낸쪽지함 또는 자기 발송 건으로) 읽음 반영 확인. 통과 시 ⑤ 종결, 다음은 ⑦(쪽지 시각 위계) 인계
- 주의: 크롬북 방전으로 사용자가 인계 여부를 잊었던 건 — 저장소 상태로 판정 가능했음(인계·수정·커밋 전부 방전 전 완료)

## [2026-08-18] Claude(Fable) → 사용자 (⑦ 쪽지 시각 위계 검수 통과 — 실기기 눈 확인만 잔여)
- 변경 파일: (검수만, 코드 무변경) 대상 = ccaaea7
- 검증 상태: tsc ✅ / build ✅(40/40) / check_ui_removals 6deedf7 ✅(사라진 상호작용 0) / memo_selftest ✅. 재스타일 diff에서 핸들러 수 이동 전후 동일 확인(기능 불변). 이번엔 커밋·push·핸드오버 게이트 전부 이행됨
- 다음 할 일: 사용자 — 실기기 눈 확인(⑦은 사용자가 제기한 시각 문제라 최종 판정도 사용자 눈): 목록 행 경계·제목/본문 대비·상세의 본문 카드 구획·이력 박스 분리
- 주의: 경미 1건(비차단) — 로드맵 ⑦ 항목을 덧붙임 아닌 덮어쓰기로 완료 처리(append-only 본문 규칙과 어긋남, 유실 내용은 없어 기록만). 다음부터는 완료 표시를 항목 뒤 추가 줄로

## [2026-08-18] Claude(Fable) → 사용자 (쪽지 파기 크론 완결 — attachment spec §8 순서 5·1단계 §6 후행 크론)
- 변경 파일: src/lib/memo/purge.ts(신설 — 만료 쪽지+첨부 Drive·staging 24h 고아·빈 지난달 폴더+캐시 키)·src/app/api/cron/daily-sync/route.ts(3번째 작업 통합)·src/lib/memo/attachments.ts(헬퍼 export)·scripts/verify_memo_purge.ts(신설)·personal_data_inventory.md(memos 행 갱신+쪽지 첨부 행 신설)·src/app/privacy/page.tsx(문안 정밀화 "첨부 링크"→"첨부 이미지", POLICY_VERSION 유지 — 자발 첨부·기준표 "문안만")·docs/memo_attachment_spec.md(§8-5 완료)
- 검증 상태: verify_memo_purge ✅ 12케이스(실계정 — dryRun 무삭제→실파기 문서·파일·staging·폴더·캐시 전부 소멸·보류 0) / tsc ✅ / build ✅(40/40)
- 다음 할 일: 없음(크론 자동) — 첫 실전 실행은 내일 daily-sync(03:00 KST). 확인하고 싶으면 Vercel 로그의 memoPurge 항목
- 주의: ① 크론 슬롯 판단 = daily-sync 통합 채택, GitHub Actions 기각(스케줄러 이원화) ② Drive 삭제 실패 시 참조 문서를 남겨 다음 회차 재시도(참조 유실 = 영구 고아 방지) ③ 회차 상한 100건/100건 — 밀리면 다음 날 이어감 ④ 실전 첫 파기는 2027년 중반(365일 보존)이라 당분간 staging 고아·빈 폴더 정리만 동작

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (쪽지 삭제(내 화면 감추기) 서버부 완결 — memo_spec §12-1)
- 변경 파일: src/lib/memo/logic.ts(hiddenBy 필드·resolveHideEligibility)·src/app/api/memo/route.ts(action "hide")·scripts/memo_selftest.ts(6케이스)·personal_data_inventory.md·src/app/privacy/page.tsx(고지 "삭제해도 원본은 보존 기간까지" — §12-1 딸린 의무)·docs/memo_spec.md(§12-1 상태)
- 검증 상태: memo_selftest ✅ 전판 / tsc ✅ / build ✅(40/40)
- 다음 할 일: Antigravity — 삭제 UI (아래 주의 참조. 사용자 아이디어의 소재 질문에서 착수 — §12-1은 2026-08-13 확정 스펙이었고 미구현 대기였음)
- 주의: ① 안 읽은 받은쪽지는 서버가 400 "읽은 뒤에 정리할 수 있습니다" — UI도 안 읽음 항목에는 삭제를 보이지 말 것 ② 감춤은 문서의 hiddenBy(email→시각) — 받은/보낸 목록·스레드 이력·대시보드 패널 전부 클라이언트 필터(hiddenBy[myEmail] 있으면 제외), 새 쿼리 없음 ③ 삭제 확인 문구에 "내 화면에서만 지워지며 상대방 화면과 기록은 남습니다" 필수 ④ 복구(숨김 해제) 기능은 없음 — 확인 1회로 방어

## [2026-08-18] Claude(Fable) → 사용자 (삭제 UI 검수 통과 — §12-1 완결, 실기기 확인만 잔여)
- 변경 파일: (검수만) 대상 = 6ac6e42 + development_roadmap.md(⑨ 전체 검색 사용자 확정 기록)
- 검증 상태: tsc ✅ / build ✅(40/40) / check_ui_removals b88fc22 ✅ / memo_selftest ✅. 계약 준수 — 삭제 버튼 노출 조건(받은=읽은 것만·보낸=내 것), 확인 1회 + "내 화면에서만" 고지 문구, hiddenBy 필터가 받은/보낸/이력/대시보드/모바일 전부 적용, 새 쿼리 0. 게이트(커밋·push·핸드오버) 전부 이행
- 다음 할 일: 사용자 실기기 확인(읽은 쪽지 삭제 → 목록·대시보드에서 사라짐, 상대 화면은 그대로) → ⑧⑨ 스펙(Claude)
- 주의: 모바일에도 삭제 버튼이 들어감 — 지시 범위(데스크톱 우선) 초과지만 §12-1과 정합(모바일 열람 전용 원칙은 발신 금지이지 본인 화면 정리 금지가 아님) — 수용

## [2026-08-18] Claude(Fable) → 사용자/Antigravity (쪽지 즐겨찾기·검색 스펙 확정 — memo_star_search_spec.md)
- 변경 파일: docs/memo_star_search_spec.md(신설)·development_roadmap.md(스펙 완료 기록)
- 검증 상태: 문서 작업 — 기존 규칙 통과 쿼리 형태·색인 실측 전례·읽기 예산 규율 대조 후 작성
- 다음 할 일: Claude — §5 순서 1·2 (star 액션·search_logic 순수 매칭·selftest + 즐겨찾기 쿼리 색인 실측 verify_memo_star). 실측 통과 후 Antigravity UI
- 주의: ① 별표 값은 시각이 아니라 `true` — 사용자별 맵 키에는 복합 색인을 만들 수 없어 등호 쿼리가 유일한 성립 형태 ② **별표도 365일 파기 유지 확정**(사용자에게 묻지 않음 — 보존은 문서 단위 단일 약속, 개인 별표가 상대방의 파기 기대를 무력화할 수 없음) ③ 검색은 실행 시에만 전량 조회+5분 캐시 — 상시 구독 확장 금지, 읽기 추산 1회 300~600

## [2026-08-18] Claude(Fable) → Antigravity/사용자 (즐겨찾기·검색 서버부 완결 — star/search spec §5 순서 1·2)
- 변경 파일: src/lib/memo/logic.ts(starredBy·resolveStarEligibility)·src/lib/memo/search_logic.ts(신설 — 순수 매칭, UI 공유용)·src/app/api/memo/route.ts(star 액션)·scripts/memo_selftest.ts(별표 4+검색 10케이스)·scripts/verify_memo_star.ts(신설)·docs/memo_star_search_spec.md(실측 결과)
- 검증 상태: memo_selftest ✅ 전판 / verify_memo_star ✅ (등호 쿼리 2개 **복합 색인 불요 실측 확정** — 정확도·흔적 0 포함) / tsc ✅ / build ✅(40/40)
- 다음 할 일: Antigravity — UI (스펙 §1-5·§2-4, 인계 프롬프트는 답변 말미)
- 주의: ① star 액션 = {action:"star", memoId, on:boolean} — 당사자만·읽음 무관·멱등 ② 즐겨찾기 탭 쿼리는 스펙 §1-3의 두 형태 **그대로**(orderBy 금지 — 붙이면 사용자별 복합 색인 문제가 되살아남, 정렬은 클라이언트) ③ 검색 필터는 search_logic.ts의 memoMatchesSearch를 임포트해서 쓸 것(자체 구현 금지 — selftest와 동일 로직 보장) ④ 검색 전량 조회는 기존 두 목록 쿼리 형태+startAfter 페이지(300), clientCache 5분

## [2026-08-18] Claude(Fable) → 사용자 (즐겨찾기·검색 UI 검수 통과 — 후속 1건: 검색 범위 드롭다운)
- 변경 파일: (검수만) 대상 = c2d2cec
- 검증 상태: tsc ✅ / build ✅(40/40) / check_ui_removals 4812244 ✅ / memo_selftest ✅. 표적 확인 — 즐겨찾기 쿼리 2개가 스펙 §1-3 형태 그대로(FieldPath 등호·orderBy 없음), memoMatchesSearch 임포트 사용(자체 구현 0), 검색 전량 조회+5분 캐시. 게이트 전부 이행
- 다음 할 일: ① Antigravity — 검색 범위 드롭다운(스펙 §2-4a, UI 완료 직후 채택된 개정이라 후속 분리) ② 사용자 실기기 확인(별표→즐겨찾기 탭·검색)
- 주의: §2-4a는 c2d2cec 이후 개정 — 현행 배포본은 전량(1년) 검색이며 무해(실사용 초기 물량 소량), 드롭다운 합류 시 기본 3개월로 전환됨

## [2026-08-18] Claude 체크포인트 — 쪽지 기능 대량 완결일 (새 창 전환점)
- **이번 창 완결 트랙 (쪽지 집중)**: ① 2단계 이미지 첨부 전체(§5 양해 쪽지 버튼 폐지 판단 → 서버[staging 대조·권한·폴더] → UI → 클립보드 붙여넣기 → 실사고 3건 수정[붙여넣기 중복·실패 사유 말줄임·배포 역전] → 실기기 통과) ② 답장(스펙[발신자 1인 서버 강제·threadId]→서버→UI→실기기 통과, memo_reply_spec) ③ 대시보드 받은 쪽지 편입(⑤ — 반려 2건[read 누락·이름 캐시 직독] 수정 후 통과) ④ 쪽지 시각 위계(⑦) ⑤ 삭제=내 화면 감추기(memo_spec §12-1 서버+UI, 고지 문안 동반) ⑥ 즐겨찾기·검색(memo_star_search_spec — 등호 쿼리 색인 실측 통과·전체 검색·서버+UI) ⑦ 파기 크론(purge.ts, daily-sync 3번째 작업 통합 — 만료 쪽지+첨부 Drive+staging 고아+빈 월 폴더, 실계정 12케이스) ⑧ 알림 종 최상단 우측 고정(①)
- **결정된 것(신규)**: 양해 쪽지 버튼 폐지(알림 왕복이 대체) / 답장 수신 = 원 발신자 1인 서버 강제(전체 답장 금지) / 별표 쪽지도 365일 파기 유지(문서 단위 단일 약속) / 검색 = 전체 범위 + 기간 드롭다운 기본 3개월(사용자 제안 채택, §2-4a) / 시트 창고 색인 미채택(비용 레버 순서 ①캐시 ②경량 색인 ③시트) / 사용량 조기 경보 등재(착수 나중 — 사용자 결정)
- **열린 것**: ⓐ Antigravity — 검색 기간 드롭다운(§2-4a, 인계 프롬프트 전달됨) ⓑ 사용자 — 실기기 한 바퀴(별표→즐겨찾기 탭→검색→읽은 쪽지 삭제→목록/상세 위계) ⓒ Claude — ④ 주 운영 지난주 접기 스펙 판단 ⓓ 소품 대기: GIF 첨부·일반 파일 첨부+대용량 세션 업로드(실수요)·조기 경보·TTL 콘솔 설정·프로필 승인 알림 배선·양해 왕복 실기기(상대 계정)
- **협업 특이 (다음 검수자 참고)**: Antigravity 미커밋 완료 보고 2회(답장 UI·대시보드 — 이후 시정됨), 공유 문서(로드맵) 항목 덮어쓰기 완료 처리 2회(⑦·⑧⑨ — 내용 유실 없어 경미 기록만, **반복 시 정식 지적 예고**). 크론 첫 실전(파기 합류분)은 다음 새벽 — Vercel 로그 memoPurge 항목으로 확인 가능

## [2026-08-18] Claude(Opus) → 사용자 (실기기 통과 기록 + 사용량 조기 경보 완결 — GCP 권한 1건 대기)
- 변경 파일: src/lib/ops/{usage_logic,usage_alert}.ts(신설)·src/app/api/cron/daily-sync/route.ts(4번째 작업 + targetDomain 호이스팅)·scripts/verify_usage_alert.ts(신설)·development_roadmap.md(레버 ②'·③ 판정 3건 + 조기 경보 완결 기록)
- 검증 상태: verify_usage_alert ✅ 26케이스(임계·발송 규칙·문구 개발용어 0·태평양 경계 서머타임 25시간 포함) / tsc ✅ / build ✅(40/40). **사용자 실기기 한 바퀴 통과 보고 — 즐겨찾기·검색·삭제·시각 위계 이상 없음(8/18 체크포인트 열린 항목 ⓑ 종결)**
- 다음 할 일: 사용자 — GCP 콘솔 1회 조작(서비스 계정에 모니터링 뷰어 부여 + Cloud Monitoring API 사용 설정). 그 전까지 경보는 no-op이라 무해
- 주의: ① **권한 없음은 실측 확인된 상태**(403) — 코드가 `available:false`로 구분해 가짜 경보를 내지 않으며, 권한 부여 시 **재배포 없이** 켜진다 ② 판정 단위가 **태평양 날짜**인 이유는 무료 할당량 초기화 경계가 거기라서 — KST로 자르면 두 주기가 섞인다. 보고일이 KST 기준 이틀 전처럼 보이는 것은 정상 ③ 세 지표 중 최대치로 판정 — 읽기만 보면 레버 ②'처럼 쓰기를 늘리는 개선의 부작용을 놓친다 ④ 크론 4작업 모두 상호 독립(하나가 던져도 나머지 실행) 유지 ⑤ 이번 창의 비용 아이디어 3건(시트 창고·개인 Drive 미러·월별 개인 사본)은 전부 로드맵 §2에 판정과 함께 등재 — **레버 ②'(월별 개인 사본)가 최유력이며 착수 트리거를 이 경보의 50% 신호로 명시 연결**했다

## [2026-08-18] Claude(Opus) → 사용자 (모니터링 권한 개통 + 30일 사용량 실측 — 급증 구조 확인)
- 변경 파일: scripts/inspect_usage_history.ts(신설)·development_roadmap.md·docs/{usage_dashboard,saving_mode}_spec.md(앞 커밋)
- 검증 상태: 권한 개통 확인 — verify_usage_alert 2부 실측 통과(8/16 조회 36,882 = 74%, 단계 50). **주의: 사용자가 처음 부여한 「모니터링 서비스 편집자」(roles/monitoring.servicesEditor)는 SLO용이라 무효였고, 「모니터링 편집자」(roles/monitoring.editor)로 교체 후 통과** — 콘솔 역할 이름이 유사해 오선택 쉬움, 재발 시 이 줄 참조
- 실측 결과(26일, 태평양 기준): 평균 14,671(29%) / **최대 94,680(189%, 8/15 = 기록된 소진 사고일과 일치)** / 한도 초과 1일·80% 이상 3일. 저장·삭제는 최대 843·500으로 **한도(20,000)의 4% 수준**
- 다음 할 일: 사용자 판단 — ① 사용량 화면 서버부 착수(권한 준비됨) ② 절약 모드 순서 1 착수. 오늘 밤 daily-sync에서 **첫 실전 경보가 발송된다**(8/16 74% → 단계 50, 수신자 super_admin 4명)
- 주의: ① **자체 발견·수정 1건** — inspect_usage_history 초판이 구간을 "지금부터 30일"로 잘라 24시간 버킷이 태평양 자정에 안 맞았고 8/16이 12,156(실제 36,882의 1/3)으로 나왔다. 경보 값과 교차 대조해 발견·수정, 수정 후 양쪽 36,882 일치. **Monitoring 집계는 구간 경계를 반드시 자정에 맞춰야 한다** ② 이 수치에는 **개발·검증 트래픽이 섞여 있다**(8/14~8/16은 verify 스크립트 대량 실행일) — "무료 복귀 불가" 판정은 실사용만의 결론이 아니며, 화면이 생긴 뒤 개학 후 순수 실사용으로 재판정할 것 ③ **레버 ②'(월별 개인 사본)의 쓰기 증폭 우려는 실측으로 해소** — 현재 쓰기가 한도의 4%라 80배 증폭도 여유. 스펙 작성 시 이 실측을 근거로 쓸 것

## [2026-08-18] Claude(Opus) → Antigravity/사용자 (사용량 화면 서버부 + 절약 모드 순서 1 완결)
- 변경 파일: src/lib/ops/{monitoring,usage_query,saving_logic,saving_mode}.ts(신설)·usage_logic.ts(태평양 헬퍼 3종)·usage_alert.ts(공통층으로 리팩터)·src/app/api/ops/{usage,saving-mode}/route.ts(신설)·firestore.rules·daily-sync(5번째 작업)·scripts/verify_{usage_dashboard,saving_mode}.ts(신설)·docs/{usage_dashboard,saving_mode}_spec.md(§9 구현 기록)
- 검증 상태: verify_usage_dashboard 4부 전판 ✅(경계·서머타임 회귀 감시·스냅샷 정합·**교차 대조 36,882 일치**·캐시) / verify_saving_mode 순수 20건 + 실계정 사이클 ✅(흔적 0) / verify_usage_alert 리팩터 후 값 동일 ✅ / tsc ✅ / build ✅(42/42) / check_ui_removals 10888d7 — 표시 1건(fetchMetricSum)은 monitoring.ts 이전에 따른 정당 삭제(경보 값 불변 실측으로 소명)
- 다음 할 일: **Antigravity** — ① 사용량 화면(usage_dashboard_spec §1·§4: 전체 화면 막대 3종·대시보드 한 줄 요약·알림 클릭 이동) ② 절약 모드 UI(saving_mode_spec §8 순서 2: 문서 구독 배선·super_admin 토글·상시 배너). 이어서 Claude — 절약 모드 순서 3(손잡이 결선)
- 주의: ① **화면은 `limits`를 응답에서 받아 쓴다** — 한도 상수를 화면에서 재정의하지 말 것 ② **`available:false`일 때 0이나 빈 그래프를 그리지 말 것** — 안내 카드(사용량 0과 혼동 금지) ③ 화면 필수 문구 2개: 「하루 사용량은 매일 오후 4시(한국 시간)에 0으로 초기화됩니다」·「약 N분 전까지 반영된 숫자입니다」 — 없으면 반드시 고장으로 오인된다 ④ 시간별 합계 < 오늘 누계는 **정상**(완결 시간만 담음) ⑤ **firestore.rules 미배포** — 절약 모드 구독을 붙일 때 `firebase deploy --only firestore:rules` 동반 필요 ⑥ 오늘 밤 daily-sync에서 첫 실전 경보 발송 예정(8/16 74% → 단계 50)

## [2026-08-18] Claude(Opus) → 사용자 (절약 모드 순서 3 결선 완결 — 이제 켜면 실제로 줄어든다)
- 변경 파일: src/lib/timetable/{memoCache,server}.ts·src/lib/cache/clientCache.ts·src/lib/ops/saving_mode.ts(동기 접근자)·src/lib/memo/search_logic.ts(1m 추가·rangeFromDays)·src/components/admin/MemoSection.tsx·src/context/AuthContext.tsx·scripts/verify_saving_mode.ts·docs/saving_mode_spec.md(§10)
- 검증 상태: verify_saving_mode ✅(결선 6건 포함 전판) / **verify_read_diet ✅**(동등성·커밋 직후 반영·revert 원상 — 최종선 불변 실측) / memo_selftest ✅ / tsc ✅ / build ✅(42/42) / check_ui_removals d8b4a26 — 표시 1건은 정적 ttlMs→동적 함수 교체(의도)
- 다음 할 일: ① **사용자 — 배포 시 `firebase deploy --only firestore:rules` 필수**(구독이 거부되면 절약 모드가 영영 안 켜진다. 앱은 안 깨짐) ② 사용자 실기기 — 사용량 화면 숫자를 구글 콘솔과 눈으로 대조(순서 4, Claude는 로그인 불가) ③ Claude — 순서 5 효과 실측(절약 모드 켠 채 하루 → 전/후 비교)과 §2 표 4번(목록 실시간 구독) 판단
- 주의: ① **모르는 상태의 기본값은 언제나 평시** — 설정 읽기 실패 시 절약 모드로 빠지지 않는다(사고로 켜진 상태가 더 나쁘다) ② 클라 캐시 수명은 **소급 적용하지 않는다** — 끄는 순간 전체 만료로 읽기가 튀는 것을 막는 의도적 결정 ③ 서버 손잡이는 최대 5분 지연 반영(화면 배너는 구독이라 즉시) ④ 검색 드롭다운에 「최근 1개월」이 상시 추가됐다(절약 모드와 무관하게 선택 가능) ⑤ **효과 실측 전까지 절약 폭은 추정치다** — 스펙 §2 표는 실측 후 갱신 대상

## [2026-08-18] Claude(Opus) → 사용자 (firestore.rules 게시 — 절약 모드 스위치 읽기 예외)
- 변경 파일: (게시만) 대상 = 저장소 firestore.rules 현재본 · scripts/test_firestore_rules_extension.ts(절약 규칙 4건 추가, a27337b)
- **ruleset 기록 (롤백용)**: 새 = `b3d99237-15af-4b46-a5d0-5b9c8cc3d254` (2026-08-18T05:38:52Z) / **이전 = `871128f7-7131-48c4-99c7-a2d87e513c37`** (2026-08-13T04:36:32Z)
- 검증 상태: 사전 점검 ✅ 실배포에만 있는 줄 0행(콘솔 직접 수정 흔적 없음) / 게시 후 재조회 ✅ 게시본이 저장소 파일과 완전 일치 / 시뮬레이터 ✅ **15/15**(기존 11 + 절약 4)
- 다음 할 일: 사용자 — 코드 배포(push) 여부 결정. **규칙만 올라갔고 앱 코드는 아직 origin에 없다** — 사용량 화면·절약 모드는 배포 전이라 실서비스에 아직 없다(무해: 규칙이 먼저 열린 것뿐)
- 주의: ① 게시 전 시뮬레이터에 **새 규칙이 범위 밖이었다** — 기존 11건은 teacher_profiles 전용이라 통과해도 새 규칙을 증명하지 못했다. 4건 추가 후 게시(교사 읽기 허용/비로그인 거부/클라 직접 쓰기 거부/같은 컬렉션 다른 문서 거부). **규칙을 바꿀 때 시뮬레이터 범위부터 확인할 것** ② `firebase deploy --only firestore:rules`는 이 저장소에서 쓸 수 없다(firebase.json·.firebaserc·CLI 전부 없음) — 정규 경로는 `npx tsx scripts/publish_firestore_rules.ts [--commit]`. 이전 핸드오버 3건에 잘못 적힌 명령이 있으니 그대로 따르지 말 것 ③ 콘솔에서 규칙을 직접 고치면 다음 게시 때 사전 점검이 중단시킨다 — 항상 저장소 파일을 고치고 스크립트로 올린다

## [2026-08-18] Claude(Opus) → Antigravity/사용자 (경보 수신자 지정 — 계정 구분 정정에서 드러난 실패 보수)
- 변경 파일: docs/memo_spec.md(계정 분류 정정)·src/lib/ops/usage_alert.ts(수신자 설정 우선·관리 함수)·src/app/api/ops/usage/route.ts(GET에 alert 동봉·POST set_recipients)
- 검증 상태: 없는 계정·형식 오류 모두 거부 실측 / playviolin@ 지정 후 크론 시뮬레이션 수신 1명(configured) 확인 / tsc ✅ / build ✅(42/42)
- 다음 할 일: **Antigravity** — 사용량 화면에 「알림 받는 사람」 카드 (아래 주의 참조)
- 주의: ① **사용자 정정 — `admin@`·`admin2@`·`admin3@`는 시험 계정이 아니라 실제 관리자 3인(사용자·보현쌤·현우쌤)의 권한 전용 계정**이고 `fb01@`·`hmnotice@`는 플랫폼 운영 계정이다. 시험 계정은 `tteacher@` 하나뿐. **이 계정들의 권한 회수·정리를 제안하지 말 것**(학교 Workspace 관리 경로가 끊긴다). memo_spec.md의 「관리·시험 계정 4개」 표기가 오독을 유발해 오늘 실제로 그렇게 제안할 뻔했다 — 정정문 첨부함 ② 그 결과 드러난 실패: **role == super_admin으로 수신자를 뽑으면 4개 전부 상시 로그인 안 하는 계정이라 알림을 아무도 못 본다.** 발송은 성공하고 사람은 영영 모르는 최악의 형태. 수신자는 role에서 추론할 것이 아니라 사람이 정한다 ③ 현재 지정 = `playviolin@hmh.or.kr`(사용자 상시 계정, users 문서 존재·role teacher 확인) — **오늘 밤 크론부터 여기로 간다** ④ 저장 시 **플랫폼 실재 계정만 통과**(로그인 이력 없는 주소는 거부) — 오타 하나로 같은 실패가 재발하는 것을 막는 장치 ⑤ **수신자가 super_admin이 아닐 수 있다** — 알림 클릭 시 사용량 화면은 super_admin 전용이라 교사 계정에는 안 열린다. 알림 본문에 수치가 담기므로 정보는 전달되지만, **딥링크 버튼은 super_admin에게만 보이게 할 것**

## [2026-08-18] Claude(Opus) → 사용자 (수신자 지정 UI 검수 통과 — 조용한 입력 유실 1건 직접 수정)
- 변경 파일: src/components/admin/UsageDashboardTab.tsx(동기화 effect에 편집 중 가드 1건) — 검수 대상 = 9f057f0
- 검증 상태: tsc ✅ / build ✅(42/42) / check_ui_removals e5b7855 ✅. 계약 준수 확인 — 칩 목록·삭제·추가·10명 상한, **서버 error 문구 그대로 표시**(자체 작문 없음), needsAttention 경고 문구가 지시 취지대로("평소 로그인하지 않아 못 볼 수 있습니다"), 딥링크 super_admin 제한 **이중 가드**(handleDeepLink 조기 반환 + 버튼 자체 미노출), 화면 문구에 기술 용어 0
- 다음 할 일: 사용자 — 배포(push) 후 실기기 확인. 오늘 밤 크론이 playviolin@로 첫 경보 발송
- 주의: ① 수정한 버그 = `alert.recipients`가 조회마다 새 배열로 와서, 주소 추가 후 저장 없이 「다시 확인」을 누르면 입력이 **아무 안내 없이 사라졌다**. 편집 중 가드로 차단(저장 성공 경로는 직접 갱신하므로 무영향) ② NotificationCenter의 삭제 22줄은 전부 조건부 래핑에 따른 들여쓰기 변화 — 기능 유실 0 실측 ③ 클라이언트의 중복·상한 문구는 자체 작문이지만 **서버 거부 문구를 바꿔 쓴 것이 아니라 제출 전 즉시 피드백**이라 수용(서버도 같은 규칙을 강제)

## [2026-08-18] Claude(Opus) → 사용자 (검색 기간 드롭다운 검수 통과 — 미뤄뒀던 43b04de 몫)
- 변경 파일: (검수만) 대상 = 43b04de + 이후 내 수정(사전 기반 선택지 생성)
- 검증 상태: **색인 실측 통과** — 받은(`array-contains` + `createdAt >=` + `orderBy createdAt desc` + `limit 300`)·보낸(`senderEmail ==` + 같은 조합) 두 쿼리 모두 **신규 복합 색인 없이 실행됨**(11건·1건 반환). 스펙 §2-4a의 "기존 쿼리 형태 유지, 신규 색인 0" 요건 충족. 캐시 키에 범위 포함·넓은 범위에서 파생 필터·페이지네이션 300 전부 계약대로. memo_selftest ✅
- 다음 할 일: 없음(이 항목 종결)
- 주의: ① 파생 캐시 저장이 절약 모드의 연장된 수명을 따른다 — 넓은 범위 캐시가 이미 낡았을 때 파생본이 최대 60분 더 사는 중첩 지연이 이론상 가능(평시 5분이라 무해, 절약 모드는 위급 상황 전제라 수용) ② 「최근 1개월」은 **절약 모드와 무관하게 상시 선택지**다(2026-08-18 사용자 확인) — 절약 모드는 선택지가 아니라 **기본 선택값**만 바꾼다. 항목이 나타났다 사라지면 화면이 제멋대로 보인다는 판단

## [2026-08-18] Claude(Opus) → 사용자 (주 운영 지난 주 숨김 검수 통과 — 로드맵 ④ 종결)
- 변경 파일: (검수만, 코드 무변경) 대상 = b702d2c
- 검증 상태: tsc ✅ / build ✅(42/42) / check_ui_removals 28d0bf7 — 표시 1건("등록된 주가 없습니다.")은 문구가 삼항 안으로 이동한 것이며 **원문 그대로 보존**(빈 상태 분기가 둘로 늘어난 정상 변경). 계약 준수 전항 확인 — 지난 주 기본 숨김·헤더 "지난 주 N개 숨김"·하단 토글·펼침 시 「지난 주」 배지, **판정식이 주말 기준**(`시작일+6 < 오늘KST`, 금요일 기준 아님), **이번 주 배지 신설**, 과거 주 「휴업·시수 수정」 버튼 **disabled 없음**(정정 경로 유지), 삭제 기능 미생성, 정렬 오름차순 유지, 서버 변경 0
- 다음 할 일: 사용자 — 배포 후 실기기 확인(시간표 운영 > 주 운영 목록에 이번 주가 맨 위·배지, 하단 「지난 주 N개 보기」)
- 주의: ① 경미(비차단) — `getTodayKSTISO`가 이 파일에 **세 번째 사본**으로 복제됐다(CalendarManageTab·DirectSubstituteTab에도 있음). 공용 유틸이 없어 기존 관행을 따른 것이라 수용하되, 날짜 유틸 단일화는 언젠가 정리 대상 ② 학기 말에 전 주가 과거가 되면 "진행 예정인 주가 없습니다" + 지난 주 보기 탈출구가 뜬다(지시대로 구현됨) ③ **지난 주 문서 삭제 기능은 끝까지 만들지 말 것** — 시수 집계·나이스 내보내기가 직접 읽는다(로드맵 ④ 처방 ①)

## [2026-08-18] Claude(Opus) → Antigravity/사용자 (나이스 CSV 서버 배선 + 전출 크론 심박 + 조직도 문답)
- 변경 파일: src/lib/timetable/{neis,server,types}.ts·src/app/api/timetable/manage/route.ts(neis_csv 액션)·scripts/neis_precheck_selftest.ts / (앞 커밋) src/lib/ops/cron_heartbeat.ts·두 크론 라우트·scripts/check_cron_health.ts
- 검증 상태: neis_precheck_selftest ✅ 전판(묶음 6건 추가) / tsc ✅ / build ✅(42/42) / check_cron_health 동작 확인
- 다음 할 일: **Antigravity** — 나이스 CSV 버튼 활성화(`NeisBatchExportTab.tsx:507-521`의 disabled 스텁 해제, 30학급 다운로드 방식 결정). 인계 프롬프트는 답변 말미
- 주의: ① **전출 테스트는 실패가 아니었다** — 삭제는 기한일이 아니라 **일시정지된 날부터 30일**이다(hjl@: 정지 7/25 → 삭제 예정 **8/24**). 화면의 `D+N`은 기한일 기준이라 정지 후에는 오해를 부른다. **정지된 행은 「삭제 예정일」을 보여주도록 고칠 것**(UI 잔여) ② **진짜 결함은 따로 있었다** — 기한 7/17인데 정지가 7/25에 일어났다. 그 7일간 생애주기 크론이 돌지 않았고, **크론이 무작업일 때 흔적을 안 남겨 한 달간 아무도 몰랐다**(8/13 시트 브리지와 같은 구멍). 심박 도입으로 보수 — `npx tsx --env-file=.env.local scripts/check_cron_health.ts` ③ **8/24 삭제가 실제로 일어나는지 확인 필요** — 심박이 배포된 뒤이므로 그날 이후 위 명령으로 검증 가능 ④ **조직도에 admin·admin2·admin3이 안 나오는 것은 정상** — 조직도 원본은 GWS `/교직원` OU(83명)이고 이 계정들은 그 밖에 있다(teacher_profiles에 「휴직 교사」로 적혀 있어도 명단에 없으면 그려지지 않는다). 2026-08-18 사용자 판단 = **그냥 둔다**(권한 전용 계정이라 교직원 명부에 없는 편이 자연스럽다). fb01·hmnotice는 옮기면 발송 대상에 섞이므로 **절대 옮기지 말 것** ⑤ 사용자 실기기 확인 완료: 오후 4시 초기화 정상(주기 표기·그래프 신규 막대 확인)

## [2026-08-18] Claude(Opus) → Claude(Fable, 새 창) (솔버 분산 한도 결함 수정 + 시드 추정 괴리 인계)
- 변경 파일: src/lib/timetable/solver.ts(dayLimit 완화 폴백)·scripts/solver_selftest.ts(회귀 감시 2건) — 커밋 2ea8a49
- 검증 상태: solver_selftest ✅ 8건 전판 / solve_blank 실데이터 ✅ 하드 0·미배정 0·결정론 유지, **소프트 32점(기준선 39 이하)**
- 다음 할 일: **Claude(Fable) 새 창** — 포트폴리오 내부 추정과 실측의 괴리 조사(아래 주의 ③). 인계 프롬프트는 이 엔트리 기준으로 작성됨
- 주의: ① **자가 테스트 2건은 낡은 픽스처가 아니라 진짜 결함이었다** — 조사 에이전트가 stale로 분류했으나 오판. 교사가 하루 통째로 막히면 그 반의 그 요일을 다른 과목이 메워야 하는데 dayLimit이 하드 필터로 그것까지 막아 **배정 불가**가 났다(질문지의 요일 통짜 제약 → 11월 실전 위험) ② **시도하고 버린 안**: dayLimit을 "쓸 수 있는 요일"로 나누기 → 자가 테스트는 통과하나 **실측 소프트 28→38점**(기준선 39 육박)으로 악화. 금지 있는 섹션의 한도를 넓히면 같은 날 중복이 허용되기 때문. 되돌리고 코드 주석에 경고로 남김 — **다시 시도하지 말 것** ③ **미해결**: 수정 전에는 `softScoreEstimate == validateTimetable` 실측이 정확히 일치했는데(28=28), 수정 후 어긋난다(추정 39 vs 실측 32). 포트폴리오는 추정으로 시드를 고르므로 **추정이 틀리면 나쁜 시드를 선발**한다. 수정 전 28점 회복 여지가 여기 있을 수 있다 ④ **협업 사고(3회차)** — Antigravity가 Claude의 미커밋 solver.ts 75줄을 자기 NEIS 커밋 `0f35d4a`에 쓸어 담았다(AGENTS.md "add -A 금지" 위반, 8/5·8/17에 이어 3번째). 내용 유실은 없으나 이력이 오염됐고, **그 때문에 비교 실험이 한 번 무효**가 됐다(양쪽 다 수정본으로 돌아 "차이 없음"이 나왔다 — 하마터면 그대로 믿을 뻔했다). 실험 전 `git status`로 대상 파일이 커밋 상태인지 확인할 것

## [2026-08-18] Claude(Fable) → 사용자 (시드 추정 괴리 해소 — 포트폴리오가 다시 옳은 시드를 뽑는다, 32→30점)
- 변경 파일: src/lib/timetable/solver.ts(S4 가중 제거한 추정 보고 + ⑦-b 보수 패스)·scripts/solver_selftest.ts(추정=실측 회귀 감시) — 커밋 97852a2
- 검증 상태: solver_selftest ✅ 9건 전판(신설 감시 포함) / solve_blank 실데이터 ✅ 하드 0·미배정 0·결정론 / **추정 30 = 실측 30 일치 복원** / 포트폴리오 선발 시드 42→1, 소프트 32→30(기준선 39 이하) / tsc·build ✅
- 원인(확정): 내부 softScore는 S4를 8배 가중(S4_INTERNAL_WEIGHT, 사람 기준 보정)하는데 softScoreEstimate가 그걸 그대로 보고했다. 2ea8a49 이전엔 dayLimit 하드 필터가 S4=0을 보장해 안 보였고(28=28), relax 폴백이 S4를 허용하자 공식 1점이 추정 8점으로 계상 — 39−32=7=(8−1)×1건으로 정확히 들어맞는다. 인계의 S4 계열 추측이 맞았다
- 다음 할 일: 없음(이 항목 종결). 원하면 후속 판단 1건 — 포트폴리오 시드 수 확대(솔버는 브라우저 로컬 연산이라 Firestore 비용 0, 시드당 약 3.4초). 8개 중 최선이 30이므로 28은 시드를 늘리면 나올 수도 있으나 미검증
- 주의: ① **28점은 이 구조에선 미회복** — 그리디 relax 폴백이 배정 불가(11월 실전 위험)를 막는 대가로 남기는 같은 날 중복 2점이고, ⑦-b 보수 패스(ejection 재배치, 걸림돌 상한 2·4 모두)로도 한도 내 재배치 여지가 없음을 실측 확인. 회귀 감시 2건은 건드리지 않았다 ② 인계 과제 3번(포트폴리오를 validateTimetable 실측으로 선발)은 **불필요해짐** — 추정이 이제 공식 점수와 등가라 선발 기준이 곧 실측이다. 검사기 추가 실행 비용 0 ③ ⑦-b는 **반드시 국소 탐색 뒤** — 앞에 두면 rng 스트림 소모로 국소 탐색 궤적이 바뀌어 30→35로 나빠진다(실측, 코드 주석에 경고 있음) ④ 자가 테스트에 「내부 추정 = 공식 소프트 점수」 감시가 생겨 앞으로 이 괴리는 오프라인에서 잡힌다(전 케이스 자동 대조) ⑤ solve_blank 실행 4회 사용(각 수백 읽기) — 오늘 사용량 확인 시 참고

## [2026-08-18] Claude(Fable) → 사용자 (시드 확대 실험 — 이득 없음 확정, 8개 유지 / 소프트 기준 출처 문답)
- 변경 파일: src/lib/timetable/solver.ts(실험 결론 주석 2줄) — 커밋 7767145
- 검증 상태: 24개 시드(소수 17~79 추가) 백지 편성 1회 실측 — 신규 최선 71=31점, 기존 최선 1=30점 유지, 미배정 0·하드 0. 편성 시간 25→82초. **확대 미채택**, 상수 옆 주석으로 반복 실험 방지
- 문답 기록(소프트 감점 기준 출처): ① S1~S4 = 컴시간 공식 매뉴얼 「주간시간표설명서」 p.27 감점 조건 계승(swap.ts:10·217) ② S6·S7 서열 = 8/14 일과계 질문지 확정(questionnaire_result §3, 절대값은 11월 리허설 조정 예정) ③ S4 내부 8배 = 사람 손 현행 시간표와 비교 실측 보정 ④ **현장 미검증 잔여 = S1·S2·S3·S5의 상호 가중(전부 1점 등가 가정)** — 9월 질문지 4번(4-1 S6 가중·4-2 S7 여부·4-3 자유응답→신규 규칙)이 이 괴리를 좁히는 기설계 경로
- 다음 할 일: 사용자 — 9월 질문지 전달·회수(기존 계획대로). 회수 후 Claude(Opus) — 제2부 4-1~4-3 반영 판단
- 주의: solve_blank 오늘 누적 5회(각 수백 읽기) — 사용량 화면 확인 시 참고

## [2026-08-18] Claude(Fable) 정정 — 직전 엔트리의 "9월 질문지 전달·회수" 지시는 오류
- 정정 대상: 바로 위 엔트리의 「다음 할 일: 사용자 — 9월 질문지 전달·회수」와 「④ 기설계 경로」 — **둘 다 무효.** 질문지(september_questionnaire.md)는 9월 예정을 앞당겨 **2026-08-14 전달·당일 회수 완료**(phase9c_questionnaire_result_2026-08-14.md)이고 답변은 이미 스펙·코드에 반영돼 있다(금1 실무회의 하드 금지 13명·S6 중간/S7 낮음·나이스 매핑 11종)
- 오판 경위: september_questionnaire.md 머리의 "전달·회수 시점 = 9월 중"(작성 당시 계획)을 액면대로 믿고, 같은 세션에서 직접 읽은 회수 결과 문서와 대조하지 않았다. 사용자 지적으로 발견. 로드맵 F-5("대기 항목에는 충족 확인 방법을 적는다")가 경고한 유령 대기의 재판 — 질문지 원본 머리에 ✅ 회수 완료 배너를 달아 함정 자체를 제거함
- 소프트 기준 출처 문답의 정정판: S1~S4 = 컴시간 주간시간표설명서 p.27 계승 / S6·S7 = 8/14 질문지로 현장 확정 / S4 8배 = 현행 시간표 비교 실측 보정 / **잔여 조정 지점은 질문지가 아니라 11월 리허설 하나**(절대 수치·S1~S3·S5 상호 가중, questionnaire_result §3에 기명시)
- 변경 파일: docs/september_questionnaire.md(회수 완료 배너)·project_notes.md(이 엔트리)

## [2026-08-18] Claude(Fable) → 사용자/Antigravity (큐 전수 점검 — 유령 정리 + 신규 발견 2건)
- 점검 방식: "대기" 표기를 액면대로 믿지 않고 항목마다 코드·커밋·원문 대조 (같은 날 9월 질문지 오판의 재발 방지)
- 유령/종결 확인: 검색 드롭다운·실기기 한 바퀴·사용량 화면·절약 모드 UI(SavingModeBanner 실재)·나이스 CSV 버튼(0f35d4a)·학생 화면 삭제 예정 표시(TransferOutTab SUSPENDED 분기 실재) — 전부 완료 상태
- **신규 발견 ① (조치 완료)**: .gitignore의 `/*.hwpx`가 루트 전용 글롭이라 docs/의 8/16 수령 4파일(2학기 과목별 배정표·창체 담당교사, hwpx+odt, 교사 실명 포함)이 안 걸렸다 — add -A 사고 전례 3회 저장소라 실위험. 추적 중 동형식 0건 확인 후 `*.hwp/*.hwpx/*.odt` 전역화 (커밋 596a14b). **이 4파일 = 9c-H 시수 입력 트랙의 재료가 이미 도착해 있다는 뜻** — 로드맵의 남은 선행은 3학년 이동수업 현황 + 입력 경로·착수 시점 사용자 결정
- **신규 발견 ② (칩 등재, 미수정)**: 학생 전출 삭제 유예 붕괴 — lifecycle/cron의 학생 브랜치는 삭제를 저장된 deleteDueDate(기한+유예)로 발화하는데 자동 정지 시 재계산이 없어, 정지가 지연되면(교사 hjl@ 7일 지연 전례와 같은 유형) 정지 직후 삭제될 수 있다. 교사 브랜치(suspendedAt+30)는 정상 — **hjl@ 8/24 삭제 전제는 코드와 일치함을 확정**. 처방 방향은 칩 프롬프트에 기록
- **잔여 확인 (진짜)**: 교사 전출 화면 정지 행의 D+N이 여전히 기한 기준(TeacherLifecycle.tsx:676, 「삭제 예정일」 미표시) — 8/18 나이스 엔트리의 UI 잔여가 아직 열려 있음 (Antigravity 몫)
- 다음 할 일: ① 내일 아침 — 첫 실전 경보(playviolin@ 수신함)·파기 크론(Vercel 로그 memoPurge) 확인 ② 8/24 후 check_cron_health ③ 사용자 — 미push 커밋 배포 여부·9c-H 입력 경로 결정

## [2026-08-18] Claude(Fable) → 사용자 (학생 전출 삭제 유예 붕괴 결함 수정 — 큐 점검 신규 발견 ② 종결)
- 변경 파일: src/app/api/workspace/lifecycle/cron/route.ts(학생 삭제 판정)·src/components/admin/lifecycle/TransferOutTab.tsx(SUSPENDED 행 표기 동기화) — 커밋 63efa5d
- 검증 상태: tsc ✅ / build ✅ / check_ui_removals ✅(사라진 상호작용 없음) / 실데이터 대조 ✅(읽기 5건 — 현행 태스크 3건 전부 정지 전 상태, 판정일 변화 0건 = 순수 예방 수정)
- 판단 요지: 처방은 「suspendedAt 우선」이 아니라 **max(저장 deleteDueDate, suspendedAt+유예)** 로 확정 — suspendedAt 단독 우선이면 관리자 「즉시 정지」(조기 정지, deleteDueDate 미재계산 경로)에서 학생에게 메일로 안내된 삭제 예정일보다 조기 삭제될 수 있다. max는 늦은 정지엔 유예 보장, 이른 정지엔 안내일 준수 — 어느 쪽으로도 예고보다 이르게 삭제하지 않는다. 학생 셀프 조기 정지는 deleteDueDate를 재계산 저장하므로 충돌 없음. 유예일수는 크론이 이미 읽는 settings 스냅샷 재사용(Firestore 추가 읽기 0)
- 다음 할 일: **Antigravity** — 학생 포털 문구 1건: student-portal/page.tsx:422 「영구 삭제 예정: 계정 일시정지 후 **7일** 경과 시」가 하드코딩이라 설정(transferOutSettings.deleteGraceDays)이 7이 아니게 바뀌면 어긋난다. get_student_transfer_status 응답 또는 설정값으로 치환할 것
- 주의: 이 워크트리(claude/bold-perlman-05adb1)는 main 미병합 — 배포 반영은 병합 후. 검증 스크립트는 스크래치 전용으로 저장소에 안 남김
## [2026-08-18] Claude(Fable) → 전원 (STATUS.md 신설 — 대장·일지 분리로 유령 생산 구조 제거)
- 변경 파일: STATUS.md(신설, 열린 항목 대장)·AGENTS.md(④-3 신설)·development_roadmap.md(머리 배너)·CLAUDE.md(세션 시작 순서에 STATUS.md 편입)
- 배경: 오늘 하루 유령 4건(9월 질문지·3학년 이동수업 파일·시수표 입력 경로·과목 사전 관문 UI) — 전부 본문 속 상태 문구가 낡은 채 남은 것. ④-2의 상태 줄 1줄 예외로는 본문 유령을 못 잡아, 대장을 파일로 분리(사용자 지시 "낭비를 막게")
- 새 규칙 요지(상세 AGENTS.md ④-3): ① 열린 항목 판단은 STATUS.md에서만 ② STATUS.md는 append-only 예외 — 닫힌 행은 지운다 ③ 완료·착수·결정 커밋에 STATUS.md 갱신 동반 ④ 행마다 확인 방법 필수
- 초기 데이터: 오늘 큐 전수 점검(코드·커밋·원문 대조)의 검증 결과를 그대로 심음 — 진행 중 2·날짜 트리거 6·사용자 결정 3·작업 대기 2·경미 3
- 주의: **Antigravity도 다음 세션부터 STATUS.md를 읽고 갱신해야 한다** — AGENTS.md를 세션 시작에 읽으므로 ④-3으로 전달되지만, 첫 커밋에서 STATUS.md 갱신 누락이 보이면 지적할 것

## [2026-08-18] Claude(Fable) → 사용자 (전출 유예 트랙 검수·병합 — 종결)
- 검수: Antigravity 3012ee8(포털 유예일수 하드코딩 해소) diff 전문 대조 ✅ — 설정값 연동·폴백 7이 서버(`|| 7`)와 일치, loadSettings 분리로 전출 학생도 졸업 태스크 조회 실패와 무관하게 설정 로드(개선). 삭제 8줄은 전부 이동(재추가)·치환분으로 사라진 상호작용 없음(수기 대조 — 본 저장소 스크립트 실행이 이 세션 권한상 불가)
- 지적: 3012ee8에 ④-3 인계 게이트 누락 — project_notes 핸드오버 엔트리·검증 상태 기재 없음. 다음 Antigravity 세션에서 준수 요청
- 병합: main(3012ee8·67c0676 포함) ← 이 브랜치 상호 병합 — project_notes 꼬리 append-append 충돌 1건은 양쪽 엔트리 전량 보존으로 해소. STATUS.md 「학생 전출 삭제 유예 결함 수정」 행 마감(수정 63efa5d + 검수 + 병합 완료)
- 주의: main 반영은 본 저장소에서 `git merge claude/bold-perlman-05adb1` 한 번(빨리감기) — push(배포)는 여전히 사용자 결정

## [2026-08-18] Claude(Fable) → 전원 (유령 방지 트랙 — 탐지기 신설 + 노트 회전, 사용자 우선순위 지시)
- 변경 파일: scripts/check_ghost_markers.ts(신설)·docs/ghost_marker_baseline.txt(신설, 재고 64건)·AGENTS.md(④-4 신설)·project_notes.md(8/15~17 72엔트리 회전 이관)·archive/project_notes_2026-08-mid.md(신설)·STATUS.md(유령 방지 트랙 2행)
- 검증 상태: 탐지기 동작 ✅(기준선 64건 수용 → 재검사 신규 0) / 노트 회전 무손실 ✅(블록 다중집합 동일 135=135 스크립트 증명, 235KB→102KB) — **주의: 원본이 병합 탓에 시간순이 아니어서 바이트 동일이 아니라 블록 단위 검증**
- 새 규칙(④-4): .md 고친 커밋 전 `npx tsx scripts/check_ghost_markers.ts` — 신규 상태 표기가 잡히면 STATUS.md 행 확인 후 --rebaseline. 큐 등재 근거는 코드·실데이터만
- 다음 할 일: STATUS.md 유령 방지 트랙 참조 (재고 소각은 지나가는 길에, 로드맵 다이어트는 Claude 별도 착수)
- 주의: 8/15~17 기록 인용 시 archive/project_notes_2026-08-mid.md에서 날짜+제목으로 찾을 것

## [2026-08-18] Claude(Fable) → 전원 (로드맵 다이어트 1차 — 완료 엔트리 본문 23블록 아카이브 이관)
- 변경 파일: development_roadmap.md(160→119KB, 상태 줄+§R## 포인터 잔류)·archive/roadmap_2026-08.md(신설 51KB, 동결)·docs/ghost_marker_baseline.txt(66→63건 재기준)·STATUS.md(다이어트 행 갱신)
- 검증 상태: 블록 무손실 ✅ — 아카이브 23블록을 포인터 자리에 되끼워 재조립한 결과가 이관 전 원본(HEAD)과 바이트 동일(sha256/16 c3c431d406b31bf9 = c3c431d406b31bf9, 다중집합 23=23, 포인터↔블록 일대일 True) / check_ghost_markers 신규 0 (notes 회전과 동일 방식)
- 다음 할 일: STATUS.md 유령 방지 트랙 「로드맵 다이어트 2차」 행 참조 — 절반 목표는 대형 열린 엔트리(피드백 덤프 21KB·양해 묶음 13KB·브리지 8KB 등)가 닫혀야 도달 가능, 닫힐 때 같은 방식으로 추가 이관
- 주의: ✅ 표기여도 STATUS 열린 항목과 얽힌 엔트리는 의도적으로 남김(6b 브리지[일몰 9/10]·과목 사전[작업 큐 #2]·양해 워크플로/개방[소품 실기기]·알림 센터 묶음[💡 2건이 본문 공유]·9c AI 보조[9c 진행 중]) — 산 것을 죽은 취급하지 않기 위함. 이관분 인용은 archive/roadmap_2026-08.md의 §R번호 또는 엔트리 제목으로(행 번호 금지). 이관 판정 시 코드 실측 4건 수행(/m 페이지·ics 라우트+구독 카드·iorad 재진입 탭·syncDerivedWeeksWithCalendar 실재 확인)

## [2026-08-18] Antigravity → Claude/사용자 (전전학기 참조 UI 기본 선택 2곳 배선 완결 — STATUS.md 작업 대기 1번 종결)
- 변경 파일: src/components/admin/timetable/HoursPlanTab.tsx·src/components/admin/timetable/TimetableCreationSection.tsx·STATUS.md
- 검증 상태: tsc ✅ / build ✅ / verify_reference_term ✅ / check_ghost_markers ✅ / check_ui_removals ✅(사라진 상호작용 0건)
- 다음 할 일: 없음 (STATUS.md 「작업 대기」 1번 행 닫힘 및 잔여 재정렬 완료)
- 주의: utils.rankReferenceTerms 단일 원본 재사용(전년도 같은 학기 1순위 → 과거 최신순 정렬, 대상 학기 제외). 시수 계획 "이전 학기에서 가져오기" 및 등록부 승계 inheritFromTermId 드롭다운에서 fallback도 대상 학기 제외 원칙 유지.

## [2026-08-18] Claude(Fable) → 전원 (전전학기 UI 배선 검수 통과 + 유령 9건째 기록)
- 변경 파일: development_roadmap.md(참조 학기 엔트리에 종결 확인 1줄 덧붙임)
- 검증 상태: 7293ff5 검수 ✅ — diff 전문 대조(폴백 3곳 보정 전부 타당: 대상 학기 자신이 폴백으로 잡히던 구멍 제거, deps 정리 무해) / tsc ✅ / verify_reference_term 5케이스 전판 ✅
- 다음 할 일: 없음 (STATUS 행은 7293ff5가 이미 닫음)
- 주의: **유령 9건째** — STATUS 「전전학기 UI 기본 선택 2곳」의 등재 근거("components에서 미사용 grep 실측")가 틀렸었다: 배선은 89e44b4(8/17 16:36)에 이미 있었고 오늘 7293ff5의 실제 delta는 폴백 보정뿐. 교훈 = grep 실측도 어느 커밋에서 돌렸는지가 함께 기록돼야 근거가 된다

## [2026-08-18] Claude(Fable) → 전원 (유령 10건째 — 과목 사전 STATUS 행 폐기 + 로드맵 §R24 이관)
- 변경 파일: STATUS.md(작업 큐 과목 사전 행 삭제)·development_roadmap.md(과목 사전 본문 §R24 이관, 119→116KB)·archive/roadmap_2026-08.md(§R24 덧붙임)·docs/ghost_marker_baseline.txt(63→61건)
- 검증 상태: 무손실 ✅(§R24 되끼움 재조립 = HEAD 바이트 동일, sha256/16 42d6b96b36facbd1, 총 24블록) / 유령 판정 근거 = bda57c9(8/17 §5 2단계 폴백 제거 커밋 실재)+solver.ts 주석+사용자 이틀간 실기기 관문 사용 증언(2027-1 배정표, 스크린샷)
- 다음 할 일: 없음 — 과목 사전 트랙은 사람 손 갈 일 소진(관문의 신규 별칭 확정은 배정표 불러올 때마다의 일상 사용일 뿐)
- 주의: **유령 10건째** — STATUS 등재 근거 "실기기 확인 미기록"이 로드맵 8/17 종결 기록(관문 완주 420행 박제·사전 57과목)과 모순인 채 등재됐었다. 교훈 = 대장 등재 시 "미기록"은 근거가 못 된다: 기록 부재를 확인했으면 코드·커밋 이력까지 대조했어야 (9건째와 동일 패턴 — 등재 시점 실측이 커밋 이력을 안 봄)

## [2026-08-18] Antigravity → Claude/사용자 (대시보드 미처리 건수 카드 구현 완결 — STATUS.md 작업 대기 종결)
- 변경 파일: src/app/admin/page.tsx·STATUS.md
- 검증 상태: tsc ✅ / build ✅ / check_ghost_markers ✅ / check_ui_removals ✅(사라진 상호작용 0건)
- 다음 할 일: 없음 (STATUS.md 「작업 대기」 행 닫힘 완료)
- 주의: 프로필 승인 대기(기존 onSnapshot 재사용)·미처리 생활지도(POST /api/discipline/stage-events 5분 캐시 1회 집계)·교체 신청 대기(POST /api/timetable/manage 5분 캐시 1회 집계)로 Firestore 읽기 예산 엄격 보호. 기존 카드 및 바로가기 액션 전원 보존.

## [2026-08-18] Claude(Fable) → 전원 (쪽지 서식·이모지·GIF 갈래 스펙 확정)
- 변경 파일: docs/memo_richtext_spec.md(신설)·development_roadmap.md(상태 줄 🔜 + 확정 기록 1줄)·STATUS.md(스펙 후보→작업 대기 1번 전환, 소품 행 GIF 포인터)
- 검증 상태: 스펙 문서라 코드 무변경 / 전제 실측 3건 ✅ — notifyMemo 푸시=제목만(평문 발췌 배선 불요 확정), dangerouslySetInnerHTML 저장소 0건, 첨부 화이트리스트·바이트 서명 단일 소재지(attachment_logic.ts)
- 다음 할 일: STATUS 작업 대기 1번 — 서식 v1 코어(richtext.ts 파서·strip·contentFormat 스탬프+셀프테스트)는 Claude, 이어 편집기·렌더는 Antigravity (스펙 §12)
- 주의: 핵심 결정 = md1 서브셋 저장·contentFormat 부재=평문(옛 쪽지 재해석 금지)·렌더는 React 노드만(HTML 주입 표면 0 유지). 이모지는 이미 성립이라 별도 단계 아님. Tenor GIF 검색은 보류 확정(재론 = 기관 채택 이후) — 큐에 올리지 말 것

## [2026-08-18] Claude(Fable) → Antigravity (쪽지 서식 v1 코어 완결 + Tenor 판정 갱신)
- 변경 파일: src/lib/memo/richtext.ts(신설 — parseMd1·stripMd1·bodyHasMd1Formatting 단일 소재지)·src/lib/memo/logic.ts(contentFormat 화이트리스트 검증)·src/app/api/memo/route.ts(발송 시 스탬프)·scripts/verify_memo_richtext.ts(신설)·docs/memo_richtext_spec.md·development_roadmap.md·STATUS.md
- 검증 상태: verify_memo_richtext 26케이스 전판 ✅(인라인 4종·미닫힘 평문·이스케이프·https만·선점 규칙·블록 묶기·strip·경계·스탬프 관문) / tsc ✅ / memo_selftest 회귀 전판 ✅
- 다음 할 일: STATUS 작업 대기 1번 — MemoRichBody 매핑 컴포넌트(노드→React, dangerouslySetInnerHTML 금지), 상세 뷰 2곳 contentFormat 분기, 편집기 툴바 8종+이모지 피커(산출 계약 = 스펙 §7: 유효 md1 + 리터럴 이스케이프 + bodyHasMd1Formatting false면 contentFormat 미포함), 목록 발췌 stripMd1
- 주의: **Tenor 판정 갱신** — 직전 핸드오버의 "보류 확정·큐에 올리지 말 것"은 사용자 반증(학교 구글 챗에 GIF 검색 내장·일상 사용, 실기기 스크린샷)으로 **감점 논거 철회, 후순위 별건**으로 완화(스펙 §1 갱신). 선행은 여전히 GIF 첨부(§9). 옛 쪽지(contentFormat 부재)는 어떤 화면에서도 parseMd1에 넣지 말 것 — 평문 <pre> 경로 유지가 하위호환의 핵심

## [2026-08-18] Claude(Fable) → 전원 (인라인 이미지 v1.1 설계 방향 기록 — 사용자 발상)
- 변경 파일: docs/memo_richtext_spec.md(§13 신설·§10 포인터)·development_roadmap.md(아이디어 즉시 기록 1줄)
- 검증 상태: 문서만 — 코드 무변경 (모바일 걸림돌 아님 판정은 §0 기존 실측 3건에 근거)
- 다음 할 일: 착수는 서식 v1 화면(STATUS 작업 대기 1번) 완료 후 사용자 결정 — 코어는 이미지 참조 토큰 1종 추가(Claude, 소규모)
- 주의: 인라인 이미지는 첨부의 참조(att:ID)만 성립 — 외부 URL 이미지는 추적 픽셀·IP 유출 표면이라 파서 수준 불성립로 확정(스펙 §13). 구현 시 이 선을 넘지 말 것

## [2026-08-18] Claude(Fable) → 전원 (GIF 첨부 완결 — 사용자 결정으로 소품 큐에서 앞당김)
- 변경 파일: src/lib/memo/attachment_logic.ts(화이트리스트+GIF87a/89a 서명)·src/lib/memo/client_attachments.ts(GIF 원본 통과 분기)·src/components/admin/MemoSection.tsx(accept 1줄)·scripts/memo_attachment_selftest.ts(GIF 4케이스)·docs/memo_richtext_spec.md §9·personal_data_inventory.md("GIF 포함")·development_roadmap.md(관찰 항목 종결)·STATUS.md(소품 행 GIF 제거)
- 검증 상태: memo_attachment_selftest 1부 전판 ✅(GIF 통과·PNG 바이트 위장 거부·서명 2종) / tsc ✅ / 2부 실계정은 PNG만 올리는 사이클이라 재실행 생략(증명력 无) — GIF 실기기 확인은 사용자 몫
- 다음 할 일: 사용자 실기기 — GIF 1장 첨부 발송 후 수신 측에서 클릭 재생 확인 (목록 미리보기는 정지 썸네일이 정상)
- 주의: GIF는 캔버스 경로를 타면 움직임이 죽는다 — 향후 첨부 코드 수정 시 isGif 분기(client_attachments) 앞단 유지. 글자 사이 재생은 v1.1 인라인 이미지(§13)에서

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 서식 v1 화면부 구현 완료 — STATUS 작업 대기 1번 종결)
- 변경 파일: src/components/common/MemoRichBody.tsx(신설 — parseMd1 노드→React 매핑, dangerouslySetInnerHTML 0)·src/components/common/MemoEditorToolbar.tsx(신설 — 8종 서식 버튼+내장 상수 이모지 피커+미리보기 토글)·src/components/admin/MemoSection.tsx(상세 MemoRichBody 분기, 툴바·피커·단축키·contentFormat 스탬프)·src/components/mobile/MobileMemoSection.tsx(상세 MemoRichBody 분기)·STATUS.md
- 검증 상태: tsc ✅ (0 errors) / verify_memo_richtext ✅ (26/26) / memo_selftest ✅ / check_ui_removals 57c2c2a ✅ (사라진 상호작용 0) / check_ghost_markers ✅ (신규 상태 표기 0)
- 다음 할 일: 사용자 실기기 확인 — PC에서 서식 쪽지 작성·발송(굵게/기울임/밑줄/취소선/목록/인용/링크/이모지) → 폰(/m)에서 열람 확인 + 옛 쪽지(평문 pre) 그대로 유지 확인
- 주의: ① dangerouslySetInnerHTML 사용 0건 유지(XSS 구조 차단) ② contentFormat === "md1"일 때만 MemoRichBody 렌더, 부재 시 기존 pre 평문 경로 엄격 유지 ③ 발송 시 bodyHasMd1Formatting(body)가 false면 contentFormat을 보내지 않음(평문 발송) ④ 화면 문구에 마크다운 등 개발 용어 일절 배제


## [2026-08-18] Claude(Fable) → 전원 (서식 v1 화면부 검수 통과 + 배포 전 점검 — 푸시 직전 기록)
- 변경 파일: src/components/admin/MemoSection.tsx(미사용 stripMd1 import 정리 — 목록 행이 제목만 표시라 현재 소비처 없음)·STATUS.md(작업 대기 = 실기기 확인 행)
- 검증 상태: c2289a2 표적 검수 ✅ — dangerouslySetInnerHTML 실사용 0(주석뿐)·MemoRichBody 링크 rel/target 안전·상세 분기 2곳 contentFormat 엄격·발송 관문 bodyHasMd1Formatting 확인·이모지 내장 상수(외부 요청 0) / 셀프테스트 3종 전판(richtext 26·memo·attachment) / tsc 0 / npm run build 성공(heap 4096)
- 다음 할 일: push(사용자 지시) → Vercel 자동 배포 → STATUS 작업 대기 1번 실기기 확인(사용자)
- 주의: 편집기는 토큰 삽입형(원문이 곧 md1, 미리보기 토글로 확인) — 스펙 §7의 이스케이프 의무는 WYSIWYG 직렬화 전제였으므로 이 방식에선 해당 없음(사용자가 보는 원문=저장 원문, 수용 판정). 배포 후 서식 오인 사례가 실기기에서 나오면 그때 §7 재론

## [2026-08-18] Claude(Fable) → 전원 (이모지 판 잘림 수정 — 실기기 신고 즉응)
- 변경 파일: src/components/admin/MemoSection.tsx(편집 칸 래퍼 overflow-hidden 제거+하단 모서리 명시)·src/components/common/MemoEditorToolbar.tsx(피커 w-80·6열·max-h-56 확대)
- 검증 상태: tsc ✅ / 원인 코드 특정(래퍼 overflow-hidden이 absolute 팝오버를 칸 경계에서 절단) — 시각 확인은 배포 후 사용자 실기기(로그인 뒤 화면이라 미리보기 재현 불가)
- 다음 할 일: STATUS 작업 대기 1번 실기기 확인에 이모지 판 잘림 해소 확인 포함
- 주의: 편집 칸 래퍼에 overflow-hidden 재도입 금지(주석 명기) — 팝오버류가 다시 잘린다

## [2026-08-18] Claude(Fable) → Antigravity (즉시 반영 편집기 전환 — 스펙 §7 개정 + 직렬화기 코어 완결)
- 변경 파일: src/lib/memo/richtext_dom.ts(신설 — serializeDomToMd1 단일 소재지)·src/lib/memo/richtext.ts(escapeMd1Literal)·scripts/verify_memo_richtext_dom.ts(신설 20케이스)·docs/memo_richtext_spec.md(§7 개정·§12 순서 5)·development_roadmap.md·STATUS.md(작업 대기 재편)
- 검증 상태: verify_memo_richtext_dom 20케이스 전판 ✅(이스케이프·중첩 바깥만·https 강등·번호 재매김·왕복 정합) / verify_memo_richtext 회귀 ✅ / tsc ✅
- 다음 할 일: STATUS 작업 대기 1번(Antigravity) — contenteditable 배선·paste 평문화(insertText)·미리보기 토글 제거·serializeDomToMd1 재사용(재구현 금지). 완료 후 push는 사용자 결정, 실기기 확인은 2번 행
- 주의: 즉시 반영 방식에선 이스케이프가 의무(사용자가 원문을 못 봄) — 직렬화기가 전담하므로 편집기에서 md1 문자열을 손으로 조립하지 말 것. 붙여넣기는 평문만(외부 서식 조용한 유실 방지)

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 즉시 반영 편집기 배선 완료 — STATUS 작업 대기 1번 종결)
- 변경 파일: src/components/common/MemoEditorToolbar.tsx(WYSIWYG execCommand 연동·미리보기 토글 제거)·src/components/admin/MemoSection.tsx(contenteditable 입력창 전환·serializeDomToMd1 연동·붙여넣기 평문화+이미지 첨부 보존)·STATUS.md
- 검증 상태: tsc ✅ (0 errors) / verify_memo_richtext_dom ✅ (20/20) / verify_memo_richtext ✅ (26/26) / memo_selftest ✅ / check_ui_removals 0b7772e ✅ (소명 완료) / check_ghost_markers ✅ (신규 상태 표기 0)
- 다음 할 일: STATUS 작업 대기 1번 실기기 확인(사용자) — PC 즉시 반영 편집기(서식 8종·이모지·번호 자동 잇기·평문 붙여넣기·이미지 첨부) 발송 후 /m 및 옛 쪽지 정상 확인
- 주의: ① serializeDomToMd1 단일 소재지 재사용(수기 조립 0) ② paste 가로채기로 외부 HTML 배제·평문 insertText만 허용(이미지 붙여넣기는 기존 첨부 큐로 연결) ③ bodyHasMd1Formatting 관문 및 1만자 상한 유지 ④ 화면 문구에 마크다운 등 개발 용어 0


## [2026-08-18] Claude(Fable) → 전원 (즉시 반영 편집기 검수 통과 + 링크 삽입 보정 — 푸시 직전 기록)
- 변경 파일: src/components/common/MemoEditorToolbar.tsx(링크 삽입 2건 보정 — http를 https로 승격 후 검증[직렬화기가 https만 인정해 조용한 평문 강등 방지], insertHTML 라벨·주소 엔티티 이스케이프[작성자 편집기 DOM 깨짐 방지])
- 검증 상태: f272486 표적 검수 ✅ — serializeDomToMd1 단일 소재지 재사용·발송 관문/1만자 유지·paste 평문화+이미지 첨부 큐 보존·contenteditable 스타일이 수신 렌더와 정합 / 셀프테스트 4종 전판 / tsc 0 / npm run build 성공
- 다음 할 일: push → Vercel 배포 → STATUS 작업 대기 1번 실기기 확인(사용자) — 즉시 반영 서식 8종·이모지 판·번호 자동 잇기·GIF 첨부·옛 쪽지 평문 유지
- 주의: 보정한 링크 삽입의 라벨 경로는 insertHTML이라 이스케이프 함수 제거 금지. 수신자 안전은 직렬화기가 이미 보장(이 보정은 작성자 화면 품질 건)

## [2026-08-18] Claude(Fable) → Antigravity (인라인 이미지 v1.1 — 코어·프록시·상세 뷰 완결, 작성기 인계)
- 변경 파일: src/lib/memo/richtext.ts(이미지 토큰·ATTACHMENT_ID_RE·collectMd1AttachmentIds)·richtext_dom.ts(IMG 직렬화 — data-att-id만, 외부 src 버림)·attachment_logic.ts(resolveAttachmentViewEligibility 순수)·attachments.ts(downloadMemoAttachment)·src/app/api/memo/attachment/route.ts(신설 GET 프록시)·MemoRichBody.tsx(image 노드+MemoInlineImage)·MemoSection.tsx·MobileMemoSection.tsx(memoId 전달+그리드 중복 숨김)·셀프테스트 3종 확장·spec §13·STATUS·로드맵
- 검증 상태: verify_memo_richtext ✅(이미지 7케이스 포함)/verify_memo_richtext_dom ✅(IMG 3케이스)/memo_attachment_selftest ✅(프록시 자격 5케이스)/tsc 0/npm run build ✅(신규 라우트 등재 확인)
- 다음 할 일: STATUS 작업 대기 1번(Antigravity) — 작성기에서 업로드·붙여넣기 완료 시 커서 위치에 img(data-att-id=driveFileId, src=previewUrl) 삽입 + 첨부 목록 참조분 구분 표시. 완료 후 Claude 검수→push→실기기(2번)
- 주의: 인라인 이미지는 att: 참조만 — 외부 URL은 이미지 노드가 안 생기고 '!'+링크 강등(외부 요청 0, 스펙 §13 명기). 프록시 열람 자격은 발신·수신자뿐이라 회수되면 이미지도 안 보이는 것이 정상. 편집기에서 직렬화기·프록시 URL을 손으로 조립하지 말 것

## [2026-08-18] Antigravity → Claude/사용자 (쪽지 인라인 이미지 작성기 배선 완료 — STATUS 작업 대기 1번 종결)
- 변경 파일: src/components/admin/MemoSection.tsx(savedRangeRef 커서 위치 기억 및 유효성 검증·Range 무효 시 본문 끝 폴백 삽입·img 뒤 빈 줄 div>br 삽입 및 캐럿 이동·업로드/붙여넣기 완료 시 img 삽입·첨부 목록 "본문에 들어감"/"+ 본문에 넣기" 상태 구분 표출·첨부 삭제 시 에디터 img 선제거 후 blob 해제)·STATUS.md
- 검증 상태: tsc ✅ (0 errors) / verify_memo_richtext ✅ (33/33) / verify_memo_richtext_dom ✅ (23/23) / memo_attachment_selftest ✅ / check_ghost_markers ✅ (재고 61건, 신규 0) / npm run build ✅ (43/43 라우트 빌드 성공)
- 다음 할 일: STATUS 작업 대기 1번 실기기 확인(사용자) — PC 작성기에서 이미지/GIF 업로드 및 붙여넣기 시 커서 위치 인라인 삽입 확인, img 뒤 빈 줄 캐럿 이동 확인, "본문에 들어감" 상태 표시 및 본문 삭제 시 하단 첨부 잔류 확인, 발송 후 본문 글자 사이 이미지 렌더 및 제3자 접근 차단 확인
- 주의: ① serializeDomToMd1이 img의 data-att-id 속성만 본문 참조로 인정하므로 손으로 md1/프록시 URL을 조립하지 않고 data-att-id img 노드만 삽입 ② 편집기에서 이미지를 지워도 첨부 목록(stagedAttachments)에는 그대로 유지되어 일반 첨부로 발송 ③ 화면 문구에 개발 용어 일절 배제(눈높이 표현 "본문에 들어감", "+ 본문에 넣기") ④ contenteditable 특성상 img 뒤 커서 이동을 위해 빈 줄(div>br) 자동 삽입 ⑤ 첨부 삭제 시 깨진 이미지 깜빡임 방지를 위해 img 선제거 후 blob 해제 순서 준수



## [2026-08-18] Claude(Fable) → 전원 (인라인 이미지 배선 검수 통과 — 푸시 직전 기록)
- 변경 파일: project_notes.md(이 기록뿐 — 코드 보정 0건)
- 검증 상태: 7b39e66·47b2c66 표적 검수 ✅ — 지적 3건 전부 정확 반영(isRangeValid 접속·포함·오프셋 검증+끝 폴백 / img→빈 줄 div>br→캐럿 이동 / 첨부 삭제 시 img 선제거 후 blob 해제), data-att-id 계약 준수·md1 수기 조립 0·수신 화면 무변경 확인 / 셀프테스트 4종 전판·tsc 0·npm run build 재실행 ✅
- 다음 할 일: push → Vercel 배포 → STATUS 작업 대기 1번 실기기 확인(사용자) — 본문 글자 사이 이미지·GIF 재생, 커서 위치 삽입, "본문에 들어감" 표시, 제3자 계정 차단(403)
- 주의: 작성기 img의 src는 로컬 미리보기(blob)이고 수신자는 프록시 경유라 서로 다른 것이 정상. 커밋 후 잔여 보정 없음

## [2026-08-18] Claude(Fable) → 전원 (쪽지 서식 트랙 전면 종결 — v1.1 실기기 통과)
- 변경 파일: STATUS.md(실기기 확인 행 마감)·development_roadmap.md(종결 기록 1줄)
- 검증 상태: 사용자 실기기 — 인라인 이미지·GIF 본문 재생·커서 삽입·참조 표시 전부 정상 + 제3자 차단 확인(드라이브 겹: 액세스 요청 페이지로 차단. 프록시 겹 403은 셀프테스트 5케이스 기증명)
- 다음 할 일: 없음 — 쪽지 서식 트랙(스펙→v1→즉시 반영→GIF→인라인) 종결. 남은 열린 항목은 STATUS 참조
- 주의: 드라이브 "액세스 요청"은 hmnotice@ 수신이라 승인 경로 없음(소음, 구멍 아님). 실유입 후 요청 메일이 쌓이면 그때 안내 문구 검토

## [2026-08-18] Claude(Fable) → 전원 (기간제 인수인계 스펙 확정 — 인터뷰 2라운드 + 컴시간 대조)
- 변경 파일: docs/substitute_handover_spec.md(신설)·development_roadmap.md(상태 줄 🔜 + 확정 기록 + 부재자 등록 아이디어 즉시 기록)·STATUS.md(진행 중 인터뷰 행 마감 → 작업 대기 1번 코어 구현)
- 검증 상태: 스펙 문서 — 근거 전부 사용자 인터뷰 증언 + 컴시간 설명서 2종 전문 검색(pdftotext, 기간제·휴직·복직 0건 → 성명 등록부 이름 덮어쓰기가 컴시간의 실무 경로임을 §0-1에 기록)
- 다음 할 일: STATUS 작업 대기 1번 — 마법사 코어(잔여 요일 변경 산출·치환 개정판 생성 순수 로직 + 서버 액션 + 클래스룸 공동교사 초대/제거, Classroom API 스코프 확인 포함) = Claude
- 주의: 업무분장·휴직자 계정 조치·나이스는 범위 밖(실무 그대로 — 스펙 §1). 날 단위 인수가 요구사항이라 주 단위 단순화 금지(인터뷰 확정 — "오겠다고 한 날짜부터"). 클래스룸은 공동교사 초대이지 소유 이전 아님, 종료 시 제거까지가 한 쌍

## [2026-08-18] Claude(Fable) → Antigravity (이관 마법사 코어 완결 — 화면 인계)
- 변경 파일: src/lib/timetable/handover.ts(신설 — 순수 산출: 걸치는 주 의도·치환 ops·날짜 계획)·src/app/api/workspace/handover/route.ts(신설 — preview/commit, 수퍼어드민 단독)·src/lib/google/workspace.ts(공동교사 초대/제거 2종, 신규 스코프 0)·scripts/verify_handover.ts(신설 19케이스)·docs/substitute_handover_spec.md §8 완결 기록·STATUS.md
- 검증 상태: verify_handover 19케이스 전판 ✅(요일 산술·잔여 요일 추출·공동수업 부분 치환·스탬프 미기록·역이관 대칭·날짜 계획 4갈래) / tsc 0 / npm run build ✅(신규 라우트 등재)
- 다음 할 일: STATUS 작업 대기 1번(Antigravity) — 마법사 UI. preview 응답의 existingDraftId가 있으면 commit이 409로 거부됨을 화면에서 미리 안내할 것. 완료 후 Claude 검수→push→실기기(§7 시나리오)
- 주의: 걸치는 주 커밋 = directCommit(substitute) 재사용이라 수신 교사에게 기존 보강 알림이 각 건마다 감. 개정판은 학기당 draft 1개 제약 — 마법사는 남의 초안을 절대 덮어쓰지 않고 중단(409). 클래스룸 조회 실패는 기능 저하로 수용(coursesError) — 마법사 진행 가능

## [2026-08-18] Antigravity → Claude/사용자 (기간제 담당 일괄 이관 마법사 화면 구현 완료 — STATUS 작업 대기 1번 종결)
- 변경 파일: src/components/admin/lifecycle/SubstituteHandoverWizard.tsx(신설 — 5단계 마법사: 대상/인수일 선택→미리보기 및 draft/프로필/부서 검증 안내→담임 승계 및 부서 배치→클래스룸 초대/내보내기→실행 요약 보고)·src/components/admin/lifecycle/TeacherLifecycle.tsx(4번째 섹션 버튼 및 패널 연결)·STATUS.md
- 검증 상태: tsc ✅ (0 errors) / verify_handover ✅ (19/19) / check_ghost_markers ✅ (재고 61건, 신규 0) / npm run build ✅ (44/44 라우트 빌드 성공)
- 다음 할 일: STATUS 작업 대기 1번 실기기 확인(사용자) — 시험 계정으로 기간제 부임 이관 실행(걸치는 주 직권 보강+다음 주 개정판+담임 승계+부서 배치+클래스룸 초대) 후 주간 시간표·내 시간표·나이스 목록 확인 → 복직 역이관 실행 후 원상 복귀 및 클래스룸 내보내기 확인
- 주의: ① 클라이언트에서 시간표 계산 재구현 0(POST /api/workspace/handover의 preview/commit 전담) ② existingDraftId 존재 시 초안 충돌 경고 및 커밋 사전 차단 ③ toProfileExists false 또는 부서 미배치 시 안내 및 부서 자동 배치 옵션 제공 ④ 클래스룸 오류 시 건너뛰기 허용 ⑤ 화면 문구 개발 용어 일절 배제


## [2026-08-18] Claude(Fable) → 전원 (이관 마법사 화면 검수 통과 + 코어 결함 1건 보정 — 푸시 직전 기록)
- 변경 파일: src/app/api/workspace/handover/route.ts(복직 방향 클래스룸 제거 대상 보정 — toEmail→fromEmail)
- 검증 상태: dd5d530 표적 검수 ✅ — API 전담(시간표 재계산 0)·existingDraftId 사전 차단+실행 버튼 비활성·프로필/부서 안내·coursesError 건너뛰기·방향 이원화 전부 계약 준수. **검수가 잡은 결함은 제 코어 쪽**: 복직(remove)에서 코스 목록은 기간제(from) 기준인데 제거 대상을 복직 교사(to)로 잘못 지정 — 복직 교사가 자기 클래스룸에서 제거될 뻔(마법사 화면 덕에 드러난 방향 오류). 보정 후 셀프테스트 3종·tsc·build 전판 ✅
- 다음 할 일: push → 배포 → STATUS 작업 대기 1번 실기기(spec §7 시나리오 — 시험 계정 이관→대조→역이관→원상)
- 주의: 역이관의 의미론 고정 — from=떠나는 기간제, to=복직 교사. 클래스룸 invite는 to에게, remove는 from에게. 이 방향을 바꾸면 §7 ④ 대칭이 깨진다

## [2026-08-18] Claude(Fable) → 전원 (이관 마법사 실기기 1건 즉응 — 운영 학기 오독 보정)
- 변경 파일: src/app/api/workspace/handover/route.ts(운영 학기 출처를 settings→timetable_settings/loadActiveTerm으로 보정)
- 검증 상태: 실기기에서 "운영 중인 학기가 없습니다" 오탐 재현(사용자 스크린샷) → 원인 = 운영 학기 단일 원본은 timetable_settings인데 일반 settings 문서에서 읽음 / 보정 후 tsc·build·verify_handover 전판 ✅
- 다음 할 일: 사용자 재시도 — 미리보기(지상인→이현준, 8/24) 진행
- 주의: 학기 참조는 loadActiveTerm 단일 경로 — settings 문서에서 activeTermId를 찾지 말 것 (셀프테스트가 못 잡는 라우트 배선층은 실기기 미리보기가 관문이라는 실증 사례)

## [2026-08-18] Claude(Fable) → 전원 (이관 마법사 교사 검색에 학생 노출 — 실기기 신고 즉응)
- 변경 파일: src/components/admin/AutocompleteInput.tsx(teachersOnly 옵션 — 학생 OU(/학생 프리픽스) 후보 제외, 캐시·폴백 공용 matchUser로 통합)·src/components/admin/lifecycle/SubstituteHandoverWizard.tsx(교사 검색 3필드 전부 적용)
- 검증 상태: tsc ✅ / 실기기 재확인은 사용자(배포 후 학번 검색 시 학생 미노출)
- 다음 할 일: 없음 — 기존 다른 화면의 AutocompleteInput은 전체 검색 의도라 무변경
- 주의: teachersOnly 기본값 false — 사용자 전체관리 등 기존 소비처 동작 불변

## [2026-08-18] Claude(Fable) → 전원 (기간제 인수인계 전면 종결 — 실기기 왕복 검증 통과)
- 변경 파일: src/components/admin/lifecycle/SubstituteHandoverWizard.tsx(역이관 4단계 문구 반전 보정 — 내보낼 사람은 fromName)·docs/substitute_handover_spec.md §8-3 완결 기록·development_roadmap.md(상태 줄 ✅)·STATUS.md(작업 대기 행 마감)
- 검증 상태: 실기기 왕복 ✅(사용자) — 지상인→이현준 이관(개정판 단독·알림 0) 후 역이관으로 개정판 상쇄·담임 1-5 원복·클래스룸 초대 2건→해제 2건 실측. 서버의 내보내기 대상은 검수 보정(d72519c)대로 from(이현준)이 맞았고 화면 문구만 반대였음(사용자 신고 → 보정) / tsc 0
- 다음 할 일: 없음 — 트랙 종결. 첫 실전 발생 시 동반 검증(STATUS 날짜가 오면 확인)
- 주의: 실기기가 잡은 3건(운영 학기 출처·학생 검색 노출·문구 반전)은 전부 셀프테스트가 못 보는 배선·화면층 — 이 층은 실기기 확인이 관문이라는 오늘 두 번째 실증

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
