# NEXT — Antigravity 작업 지시서

> **이 파일은 덮어쓴다.** 끝난 과제는 지운다 — 낡은 줄이 곧 버그다 (`AGENTS.md` §1-5).
> 저장소는 `/home/fb01/school`. 기준 커밋은 각 과제에 적힌 것.

## 항상 지킬 것 (매 과제 공통)

1. **기존 파일을 재작성하지 마라.** 요청받은 부분만 국소 수정한다 (`AGENTS.md` ①-1).
2. **삭제가 추가보다 많으면 멈추고 보고해라.**
3. **커밋은 과제별로 끊는다.** `git add -A` / `git add .` 금지 — 자기가 바꾼 파일만 명시적으로 add.
   - **2026-08-21부터 이건 기계가 막는다.** 남의 작업 중 파일이 담기면 커밋이 거부되고, 어떤 파일이 왜 걸렸는지 화면에 나온다. 막히면 지목된 파일을 `git restore --staged`로 빼고 자기 파일만 다시 담아라.
   - **막혔다고 `--no-verify`나 `COMMIT_GUARD_OK=1`로 넘기지 마라.** 그 파일이 정말 네 것이라고 확신하면 넘기되, **왜 그랬는지 보고에 적어라.**
4. **넘기기 전 스스로 통과시켜라**: `npx tsc --noEmit` · `bash scripts/check_ui_removals.sh <기준커밋>`
   - `npm run build`는 돌려도 된다 (힙 옵션이 스크립트에 들어 있다).
5. **절대 금지**: `git push` · `gh` · `.env.local` · `~/.ssh/` · `rm -rf`
6. **지시가 지금 코드와 다를 수 있다. 다르면 맞추지 말고 다르다고 보고해라.**
7. **실행해야만 알 수 있는 것은 통과/실패로 몰지 말고 「판정 불가」로 두고, 무엇을 실행해야 아는지 적어라.**
8. **근거는 `파일:줄번호`로 단다.** 보고는 항목당 한 줄 — 서술형 장문 금지.
9. **한 번에 한 과제만 한다.** 지금 차례는 **과제 CC 하나**다. 커밋·핸드오버까지 마쳤으면 **거기서 멈추고 보고해라.**
10. **`project_notes.md`는 덧붙이기만 한다 (④-2).** 과제 U 커밋이 남의 엔트리 한 줄을 지웠다 — 커밋 전에 `git diff --numstat project_notes.md`의 삭제 열이 0인지 확인해라.

---

## 과제 BB-2 — 개정 화면 이동이 아예 안 된다 (검증 누락 보수, 2026-08-23)

**기준 커밋: `56d58c1`.** 사용자 실기기: *"그냥 단순 집기만 돼. 그걸 집고 목적지 클릭은 아예 안 돼."* **과제 BB의 핵심 기능이 동작하지 않는다.**

### 원인 — 제약 모델이 반쪽이다

`BaseRevisionTab.tsx:145`가 `setModel(data.model || null)`로 **서버가 준 model을 날것 그대로** 쓴다. 그런데 **`draft_model` 응답의 model에는 `gradeDayPeriods`와 `hours`가 없다**(`route.ts:1336-1343` — `lunchAfterPeriod`·`periodsPerDay`·등록부 5종뿐).

**초안 화면은 그 둘을 클라이언트에서 채운다**(`DraftAutoTab.tsx:1144-1150`):
```ts
const gradeDayPeriods = deriveGradeDayPeriods(baseGrids);
const hours = … deriveHoursFromGrids(baseGrids);
const fullModel = { ...model, gradeDayPeriods, hours };
```

결과:
- **`gradeDayPeriods` 없음 → 후보 0개.** `evaluateMoveCandidates`가 `model.gradeDayPeriods?.[pick.grade] || {}`(`moveCandidates.ts:40` 부근)로 후보 슬롯을 만드는데 빈 객체가 되어 **후보가 하나도 안 나온다.** 그래서 모든 칸이 「후보 아님」으로 떨어지고 `handleCellClick`의 `if (!cand …) return`(`:266`)에 걸려 **클릭이 무반응**이다. 3색도 당연히 안 뜬다.
- **`hours` 없음 → 검사 결과가 헐겁다.** 시수 부족(H1) 판정이 돌 수 없어 **「중대 문제 0건」이 실제보다 적게** 나올 수 있다. 화면의 감점 총점도 같은 model로 계산된다.

### 고칠 것

1. `fetchModelAndBaseGrids`에서 model을 **초안 화면과 똑같이 완성**한다 — `deriveGradeDayPeriods(baseGrids)`와 `deriveHoursFromGrids(baseGrids)`를 붙여 `fullModel`로 저장. 두 함수는 `@/lib/timetable/validate`에 이미 있다.
2. **초안 화면의 그 6줄을 그대로 옮겨라.** 다르게 쓰면 두 화면의 판정이 갈린다 — 이 과제열 내내 지켜 온 원칙이다.
3. 고친 뒤 **집기 → 3색이 뜨는지 → 목적지 클릭으로 이동 op가 쌓이는지**를 **코드 경로로 설명**해라(어느 값이 어떻게 채워져서 후보가 나오는지).

### ⚠️ 이 항목이 왜 검증을 통과했는지 (같은 실수 반복 방지)

tsc·build·selftest가 전부 통과했다 — `gradeDayPeriods`가 **optional 필드**라 타입 오류가 안 나고, selftest는 model을 손으로 만들어 넣으므로 이 경로를 안 밟는다. **Claude 검증도 「`evaluateMoveCandidates`를 부르는가」만 확인하고 「유효한 model을 받는가」는 안 봤다.**

→ **보고할 때 「불렀다」가 아니라 「그 함수가 받은 입력이 무엇인지」를 적어라.** 이번 완료 확인에 그 항목을 넣었다.

**완료 확인**: tsc · build · check:ui · `check_ui_removals`(기준 `56d58c1`) · selftest 4종 유지 + ⓐ`fullModel`에 `gradeDayPeriods`·`hours`가 들어가는 지점(file:line) ⓑ**집기 직후 `candidatesResult.candidates`가 비어 있지 않게 되는 근거** ⓒ「중대 문제」 건수가 `hours`를 반영해 계산되는지. **핸드오버 ④ 기재.**

---

## 과제 CC — 개정 화면에 「해결안 찾기」(수읽기) 붙이기 (2026-08-23)

**기준 커밋: 이 파일이 커밋된 시점의 HEAD.** 주 대상은 `BaseRevisionTab.tsx`. **`DraftAutoTab.tsx`는 import 한 줄 바꾸는 것 외에 건드리지 마라.**

과제 BB·BB-2로 개정 화면에서 **집기·3색·이동**이 된다(실데이터로 후보 33개 확인). 이제 **감점 항목에서 출발하는 수순 제안**을 붙인다.

### CC-1. 미니 그리드를 공용 파일로 뺀다 (기계적 이동 — 로직 변경 0)

`DraftAutoTab.tsx:134`의 `HistoryMiniGrid`는 **props만 받는 순수 함수**다(클로저 의존 0). `src/components/admin/timetable/MiniGrid.tsx`(신규)로 **한 글자도 안 바꾸고** 옮기고, `DraftAutoTab`은 **import만** 추가한다.

- ⚠️ **로직을 손대지 마라.** 옮기는 것 외의 변경이 있으면 실패다. `DraftAutoTab`의 두 사용처(작업기록·기보 카드)가 **똑같이 보여야** 한다.
- 격자 렌더러(`renderClassGridTable`·`renderTeacherGridTable`)는 **이번에 건드리지 마라** — 클로저에 묶여 있어 추출이 위험하다. 별도 판단.

### CC-2. 개정 화면에 감점 상세 목록

지금은 **「중대 문제 N건 / 감점 N점」 요약만** 있다(`:547-559`). `auditReport.soft.details`를 **접이식 목록**으로 펼친다.

- 문구·정렬은 **초안 화면과 같게.** 검사기가 만든 `detail.text`를 **그대로** 쓴다(화면에서 새로 짓지 마라 — 두 화면의 문장이 갈리면 대조가 안 된다).
- 중대 문제(`hard`)도 같이 펼친다.

### CC-3. 항목마다 「해결안 찾기」 → 기보 카드

1. 감점 항목의 버튼 → `searchLookaheadInWorker`(`lookaheadClient.ts`)를 그대로 쓴다. **`searchLookaheadLines`를 직접 부르지 마라** — 화면이 언다(과제 Z 전례).
   - target = 그 항목의 `{scope, key, day, code}`. grids = 지금 판(`currentGrids`), model = `fullModel`.
   - 진행률(`N가지 수 탐색 중…`)·취소·청크 로드 실패 안내는 클라이언트가 이미 제공한다 — **그대로 배선**해라.
2. **기보 카드**는 초안 화면과 같은 규약:
   - **수마다 미니 그리드** + `→` 연쇄(CC-1의 공용 컴포넌트). 위치를 글자로 쓰지 마라(스펙 §0-1).
   - 각 수 옆에 **① 과목(교사) ↔ ② 과목(교사)**. ⚠️ **2수 이상이면 n번째 수는 앞선 수를 적용한 판에서 읽어야 한다** — `DraftAutoTab`의 `simBoard` 누적 방식이 본보기다.
   - **대가 줄** — `line.sideEffects`를 **그대로** 표시(재계산·재정렬 금지). 나빠지는 게 없으면 「다른 감점이 늘어나지 않습니다」 명시.
   - **§0-5 준수**: `finalDelta > 0`이면 **「총점 N점 나빠짐」 경고 딱지가 맨 앞**. 「점수 유지」는 0일 때만.
3. **적용 — 여기가 초안과 다르다.** 초안은 서버에 `draft_op`를 보내지만 **개정은 `ops` 배열에 쌓는다.** 기보의 `line.ops`는 **이미 `BaseRevisionOp`(swap)** 이므로 **그대로 `setOps(prev => [...prev, ...])` 하면 끝**이다.
   - **[한 수씩 밟기]** = ops에 한 건씩 push (되돌리기는 기존 `handleRemoveOp`가 이미 한다).
   - **[전체 적용]** = 남은 수를 한 번에 push.
   - **서버 호출 0건이어야 한다.** `expectedOpCursor`·낙관적 반영 같은 초안 코드를 가져오지 마라 — 여기엔 서버 왕복이 없다.

### 완료 확인

tsc · build · check:ui · `check_ui_removals`(기준 커밋) · selftest 4종 유지 + 아래를 **결과로** 보고해라(호출 여부가 아니라):

- ⓐ `MiniGrid.tsx`가 **로직 변경 0**인 기계적 이동인지(diff로)
- ⓑ 감점 상세가 `detail.text`를 그대로 쓰는 지점
- ⓒ **해결안 찾기가 워커를 타는지**(`searchLookaheadLines` 직접 호출 0건)
- ⓓ 2수 이상 기보에서 **n번째 수를 어느 판에서 읽는지**(코드 근거)
- ⓔ **적용 시 서버 호출이 0건**인지 — `ops`에만 쌓이는 근거
- ⓕ 읽기량 한 줄(규칙 ⑪) — 해결안 찾기는 **0회**여야 한다(브라우저 안 계산)

**핸드오버 ④ 기재**(덧붙이기만, 표·목록은 본문에).

---

## 아직 착수하지 마라 — 과제 K (시간표)

**착수 조건: 과제 J가 Codex 검증까지 통과한 뒤 Claude가 이 절을 과제로 승격한다.** 지금은 범위만 확정해 둔 것이다. 이 절을 보고 먼저 손대지 마라.

> **왜 따로 끊었나 (2026-08-21 Claude 실측)**: 시간표는 31파일 / 1,368곳으로 **2묶음의 3배 이상**이고, 무엇보다 **스펙 §3-1 격자 예외가 거의 전부 여기 몰려 있다**(§7 허용목록 13파일 중 12개가 `timetable/`). 예외 파일을 모르고 일괄 상향하면 **스펙이 허용한 10px 격자를 지워 회귀**가 된다. 그래서 예외 없는 파일과 있는 파일을 갈랐다.

### K-1 — 격자 예외가 **없는** 시간표 파일 (19파일 / 573곳)

`AssignmentHoursModal` · `TimetableImportTab` · `CalendarManageTab` · `HoursPlanTab` · `TeacherSlotBanTab` · `NeisBatchExportTab` · `SwapRequestLedgerTab` · `CurriculumCohortTab` · `WeekManageTab` · `HourTotalsTab` · `NeisExportTab` · `FreeTeacherViewer` · `TimetableCreationSection` · `RegistryUnlockModal` · `CoordinationNoticeBlock` · `TimetableOperationSection` · `PaginationControls` · `TimetableSection` · `FreeTeacherTab`

일반 화면과 같은 규칙을 그대로 적용하면 된다. 이 묶음의 1급 = 교사 이름, 교시, 요일, 학급, 과목, 특별실, 시수 숫자, 마감, 상태, 버튼 라벨.

### K-2 — 격자 예외가 **있는** 시간표 파일 (12파일 / 795곳) — 가장 조심할 묶음

`BaseRevisionTab` · `ClassTimetableTab` · `TeacherTimetableTab` · `ConsecutiveRuleTab` · `CoTeachingRuleTab` · `SimulGroupTab` · `VenueGroupTab` · `DirectSubstituteTab` · `DraftAutoTab` · `TeacherPortalSection` · `MiniPreviewGrid` · (+ `src/components/admin/MyTimetableCard.tsx`)

여기서 지킬 세 줄:

1. **격자 셀 「안」의 정보는 건드리지 마라.** 10px은 스펙 §3-1이 허용한 것이다. 올리면 회귀다.
2. **격자 「밖」은 대상이다** — 툴바, 필터, 범례, 모달, 상태 문구, 요약 줄, 버튼. 이쪽이 이 묶음의 실제 작업 대상이다.
3. **격자 셀 안이라도 「조작 라벨」(버튼·링크)은 예외가 아니다** — 스펙 §3-1 마지막 줄. 1단계에서 **잠정 12px로 남겨 둔 3건이 이 과제의 숙제**다: `BaseRevisionTab`의 「내용 변경」 · `DirectSubstituteTab`의 「가져오기」 · `TeacherPortalSection`의 「취소」. 셋 다 **배치를 바꿔서 14px로 해소**한다(크기를 낮추는 것은 오답 — 스펙 §4-4).
4. **`OffscreenShareCard.tsx`는 전면 제외.** 화면에 안 보이는 이미지 캡처 전용이라 스펙 대상 자체가 아니다(§3-2). 열지도 마라.
