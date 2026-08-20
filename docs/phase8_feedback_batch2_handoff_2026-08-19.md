# Phase 8 피드백 배치 2 — 화면 몫 인계 (Antigravity) — 📕 **종결 (2026-08-21)**

> ## ⛔ 이 문서는 살아 있는 지시가 아니다
>
> **종결 확인 2026-08-21.** 배치 2는 검수를 통과해 닫혔다. **지금 열린 항목은 [`STATUS.md`](../STATUS.md)에서 본다.**
>
> **근거 커밋**
> - `09cacdc` — 배치 2 검수 통과 기록(수정 2건 반영, 남은 3번 항목은 `STATUS.md`로 이관)
> - `599d3b2` — 배치 2 종결 기록(배치 3 코어와 같은 커밋)
> - `b7adf85` — D절 다이어트 3(내 할 일 90일 기한창 재적용) 완결
>
> **근거 코드 (2026-08-21 실측)**
> - 다이어트 4(teacher_profiles 캐시 통일) → [`TaskStatusBoard.tsx:98`](../src/components/admin/tasks/TaskStatusBoard.tsx)
> - 다이어트 3(구독 범위 제한) → [`TasksSection.tsx:113-119`](../src/components/admin/tasks/TasksSection.tsx)
> - 17번(알림 패널 수락 버튼 상태) → [`NotificationCenter.tsx:481`](../src/components/common/NotificationCenter.tsx)·[`:821`](../src/components/common/NotificationCenter.tsx)
>
> 본문이 지시 대상으로 든 `MobileTasksSection`은 커밋 `0dbfc9b`(`/m` 폐지)로 파일 자체가 사라졌다 — 반응형 단일 화면으로 통합됐다.
> **인계의 단일 원본은 [`docs/handoff/NEXT.md`](./handoff/NEXT.md) 다** (`AGENTS.md` §1-5).

*(이하 2026-08-19 작성 당시 기록 — 현재 상태가 아니다.)*

> 원본 목록 = `development_roadmap.md` Phase 8 「[2026-08-19 실기기 피드백 수집 중]」의 17~30번 (번호도 그 목록 기준).
> 코어 몫(22·23 이름 동기화 크론, 27 완료 코멘트 서버, 30MB 상향)은 Claude가 구현 완료(`3f4e91c`·`7ab99ba`) — 이 문서는 화면 몫만.
> 읽기 다이어트 4건 중 1·2번(AuthContext·TaskStatusBoard 구독)도 Claude가 완료 — **이 문서의 D절(다이어트 3·4번)만 남았다.**
> 완료 후: AGENTS.md ④-3 인계 게이트 3종 필수. push 금지 — Claude 검수 후 일괄 배포.

## 작업 순서 — ~~지시~~ (2026-08-21 종결, 이력)

> 아래 순서는 2026-08-19에 정한 것이고 그대로 수행돼 `09cacdc`에서 검수를 통과했다. 지금의 우선순위는 `STATUS.md`와 `docs/handoff/NEXT.md`에서 본다.

**A절(업무·알림): 17 → 24 → 26 → 27화면 → 19 → 14보완.** B절(쪽지 작성기): 18 → 28 → 29 → 30안내. C절(소품): 21 → 25안내. D절(읽기 다이어트 3·4).

---

## A절 — 업무·알림

### 17. 알림 패널 [업무 수락하기] 버튼이 낡은 상태로 잔존

[`NotificationCenter.tsx`](../src/components/common/NotificationCenter.tsx) — 버튼 숨김이 `acceptedTaskIds`(이 패널·이 세션에서 수락한 것만 기억하는 로컬 Set, :110)뿐이라 업무 화면에서 수락했거나 재접속하면 버튼이 영구 잔존, 누르면 "이미 수락한 업무입니다" alert.

- 패널이 열려 task-assigned 알림이 보일 때, 해당 refId 업무 문서를 **표시분만** 1회씩 읽어(보통 수 건 — 읽기 예산 무해) 내 상태가 PENDING이 아니면 버튼 대신 "수락함 ✓" 표기. 철회(canceledAt)·비대상이면 버튼 숨김.
- 클릭 시 "이미 수락" 계열 400 응답은 alert 오류가 아니라 **버튼을 완료 표기로 바꾸는 신호**로 처리.
- 공용 컴포넌트라 PC·모바일 동시 해소.

### 24. 업무 등록 모달 상태가 발송 후에도 잔존

TaskComposerModal — 발송 완료 후 다시 열면 2단계가 직전 정보 그대로, [발송 중…] 버튼 상태까지 잔존(실기기 스크린샷).

- **발송 성공 시와 모달 닫기 시 모두 전체 상태 초기화**: 1단계 복귀·필드 비움·수신자 비움·taskId 해제·submitting 해제.
- 작성 중 임시보관은 만들지 않는다 — 미발송 초안은 서버 스윕이 24h 후 정리(4-ⓑ)하는 설계와 정합.

### 26. 제출형 — 파일 선택 즉시 제출을 [첨부 확인 → 제출 버튼] 2단계로

TasksSection·MobileTasksSection의 제출 경로 — 서버 무변경, UI 흐름만:

- 파일 선택 → 로컬 대기 카드(파일명·크기·바꾸기/빼기) → **[제출] 버튼 클릭 시** 업로드+제출 실행. 4MB 초과 세션 경로도 같은 흐름. 재제출 동일.

### 27(화면). 완료·제출 코멘트 입력 + 현황판 표시

코어 완료 명세: `transition`(done)과 제출(multipart `note` 필드 / `submit_session_finish`의 `body.note`)에 **선택 코멘트**를 보내면 `statuses[email].note`에 실리고(500자 절단), 발신자향 [완료] 원장 알림에 자동 동반된다. 응답 `status`에 note 포함(낙관 갱신에 그대로 반영).

- 완료 체크 시 "간단한 메모 남기기(선택)" 입력(거절 사유 모달과 같은 패턴, 단 **선택 사항** — 빈 채로 완료 가능해야 함).
- 26번의 [제출] 버튼 옆에도 같은 선택 입력 1줄.
- TaskStatusBoard 수신자 표: note가 있으면 상태 칩 아래·옆에 표시(거절 사유 표시와 같은 톤). 확인형·제출형 공통.

### 19. 어드민 홈 — 내 할 일·받은 쪽지를 급식 위로

[`admin/page.tsx`](../src/app/admin/page.tsx) super_admin 홈 — 13번으로 카드는 들어왔으나 급식이 여전히 최상단. 순서를 **내 할 일 → 받은 쪽지 → 급식**으로.

### 14(보완). 대시보드 쪽지 클릭 시 특정 쪽지 미열림 (STATUS 작업 대기 4번)

[`admin/page.tsx:1090`](../src/app/admin/page.tsx) 부근 삼항이 renderContent()를 우회하고 `<MemoSection />`을 prop 없이 렌더 → `case "memo"` 분기(:259, `initialMemoId={targetMemoId}`)가 도달 불가. 삼항 쪽 렌더에 `initialMemoId={targetMemoId}`를 전달하고 도달 불가 분기는 정리.

---

## B절 — 쪽지 작성기

### 18. 주소 입력 시점 링크 변환 (쿨메신저 동선)

MemoEditorToolbar/직렬화기 — 렌더 자동 링크(https만)는 유지하고, **편집기가 입력 시점에 변환**한다:

- 엔터/공백 직후 직전 토큰이 주소꼴이면 md1 명시 링크 `[원문](https://…)`로 치환. 스킴 없으면 `https://` 부여.
- 주소꼴 판정: `https://…` 그대로, 또는 `www.…`/`도메인.tld[/경로]` — 점 포함·공백 없음·**TLD 영문 2자 이상**(숫자 TLD 제외 — "3.4버전" 오탐 차단).
- 쪽지·업무 편집기 공용(같은 컴포넌트라 한 곳 수정).

### 28. "링크 첨부" 섹션 제거

작성 UI의 링크 첨부 입력(최대 5개·이름 선택)만 제거. **기존 쪽지의 links[] 표시("첨부 링크" 박스)는 유지**(과거 데이터 하위호환). 서버 무변경.

### 29. 첨부 실패 시 사유·버튼 상태 단일화

실기기 실측 2회가 서로 다른 상태를 보임(1차: 배너 없음+버튼 비활성 / 2차: 배너 있음+버튼 활성). 실패 등록 경로가 2개(파일 선택 시 사전 차단 vs 업로드 후 실패)라 배너·비활성이 따로 파생되는 구조.

- **실패 첨부 존재 여부를 단일 상태로** 판정해 카드 ⚠️·배너·버튼 비활성이 항상 함께 움직이게.
- 버튼 위 눈높이 한 줄: "올릴 수 없는 첨부 N개가 있습니다. 빼면 보낼 수 있어요" (실패 카드 X 제거 시 즉시 활성).
- 실패 카드가 남은 채 발송이 실행되면 실패분이 조용히 빠진 채 나가는지 확인하고 차단.
- 배너 문구 "이미지" → "파일". 그 외 비활성 버튼들도 사유 표기가 있는지 1회 점검(일반 원칙).

### 30(안내). 30MB 초과 거부 시 우회 안내

거부 문구에 한 줄 추가: "30MB가 넘는 파일은 내 드라이브에 올린 뒤 링크를 본문에 붙여 주세요." (자동 링크가 이 동선의 전제 — 이미 배포됨.)

---

## C절 — 소품

### 21. 사이드바 "효명" 텍스트 배지 → 교표

교표 이미지는 **`public/icon-192.png`가 이미 교표**(1953 문양) — 신규 파일 불요. 흰 원형/라운드 칩 배경 위에 얹어 보라 사이드바에서 시인성 확보(현 배지 크기 유지).

### 25(안내). 현황판 [제출함 폴더 열기] 옆 도움말

툴팁 또는 접이식 한 줄: "컴퓨터의 드라이브 폴더에서도 보려면 — 드라이브에서 이 폴더에 [바로가기 추가]를 해두세요." (자동 생성·공유드라이브 멤버십은 권한 사유로 비채택 — 로드맵 25번 ⓒⓓ. 안내만.)

---

## D절 — 읽기 다이어트 3·4번 (course-selection 인계분 — 1·2번은 Claude 완료)

### 다이어트 3. tasks 구독 3곳 limit

TasksSection·MobileTasksSection·TaskStatusBoard 전부 limit 없음(memos는 전부 limit(50)). 보존 365일이라 시간이 갈수록 악화.

- **현황판**(senderEmail==+orderBy createdAt): 색인 없이 성립함을 실측 완료 — `limit(50)`만 추가하면 끝.
- **내 할 일 2곳**(array-contains, orderBy 없음 — 색인 회피로 뺀 것): orderBy 없이 limit을 붙이면 임의 부분집합이라 **금지**. 대안 = `where("dueAt", ">", now - 90일)` 범위 조건(단일 필드라 색인 불요, dueAt 필터+dueAt 정렬은 같은 필드라 orderBy 재도입도 가능). 지난 업무는 "지난 업무 보기" 토글로 별도 1회 조회. 구현 전 어느 쪽이든 **FAILED_PRECONDITION이 안 나는지 콘솔에서 확인 후 적용**(5번 사고 재발 방지).

### 다이어트 4. teacher_profiles 전체 구독 4곳 → 캐시 통일

[`TaskStatusBoard.tsx:74`](../src/components/admin/tasks/TaskStatusBoard.tsx)·ProfileApprovals·OrgChartTree·OrgChartBuilder의 전체 컬렉션 onSnapshot을 기존 `getClientCache("teacher_profiles:all")` 5분 캐시 경로(TaskRecipientPickerModal이 이미 씀)로 통일 — 탭 왕복마다 89 읽기 소멸.

- 단 **OrgChartBuilder(조직도 편집)는 편집 후 즉시 반영이 필요**하면 저장 성공 시 캐시 무효화+재조회로 대체(실시간 구독 유지가 꼭 필요하면 그 화면만 예외로 남기고 사유를 핸드오버에 기재).
- ★ 이 항목이 **통합 허브의 선행 조건**이다 — 완료 보고에 명시할 것.

---

## 완료 정의 (전 항목 공통) — ~~게이트~~ (2026-08-21 종결, 이력)

> 이 게이트는 당시 통과됐다(`09cacdc`). 지금 넘기는 작업의 게이트 원본은 `AGENTS.md` ①~④다.

1. `npx tsc --noEmit` + `NODE_OPTIONS="--max-old-space-size=4096" npm run build` 통과.
2. `bash scripts/check_ui_removals.sh <작업 시작 커밋>` 실행·항목별 소명 (28번 링크 첨부 제거는 지시된 삭제임을 명기).
3. 자기 변경 파일만 명시 add로 커밋(add -A 금지), project_notes.md **하단**에 4줄 핸드오버 (지난 2회 상단 삽입은 규약 위반 — 하단 누적).
4. push 금지 — Claude 검수 후 일괄 배포.
5. **훅 규칙 준수**: useState/useEffect는 어떤 조기 return보다 위에 — 20번 크래시(React #310)의 재발 방지. 조건부 렌더 아래에 훅을 추가하지 않는다.
