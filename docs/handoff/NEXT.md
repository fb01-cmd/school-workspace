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
9. **한 번에 한 과제만 한다.** 지금 차례는 **과제 S-2 하나**다. 커밋·핸드오버까지 마쳤으면 **거기서 멈추고 보고해라.** S·T·U는 검증을 통과한 뒤 Claude가 다시 지시한다 — 미리 손대지 마라(같은 파일이라 겹치면 검증이 불가능해진다).

---

## 과제 S-2 — 과제 S 보수 (검증 결과, 2026-08-22)

**기준 커밋: `c4eb908`.** 과제 S 본체는 통과했다 — 낙관적 반영·롤백 8개 상태 복원·커서 처리·D&D가 클릭과 같은 후보 데이터를 쓰는 것까지 전부 확인했다(기계 관문 전부 통과, Codex 9항목 중 6 통과). **409 처리 5벌을 1벌로 합친 것도 잘한 일이다.** 아래 **3건만** 보수한다.

### S2-1. 충돌(409)로 초안을 다시 불러올 때 옛 상태가 남는다 (우선 — 데이터가 틀어질 수 있다)

`DraftAutoTab.tsx:1232-1237`. 다른 창이 먼저 고쳐서 409가 나면 `handleOpen`으로 최신 초안을 다시 받는데, `handleOpen`이 초기화하는 것은 `selectedUnplaced` 하나뿐이다(`:751`). 그래서 **집은 수업·3색 후보·연쇄 진행(`chainSteps`)·트레이 선택이 옛 판 기준으로 남는다.**

- 가장 위험한 것은 `chainSteps`다 — 남아 있으면 **다음 조작이 이미 사라진 판을 기준으로 만든 연쇄를 서버로 보낸다.**
- 처방: 409 분기에서 `handleOpen`을 부르기 **전에** 롤백 경로와 같은 초기화를 한다(`pickedSlot`·`candidatesResult`·`chainSteps`·`chainStartGrids`·`heldParkId`·`selectedParkedEntry`). `handleOpen` 자체에 넣어도 좋다 — 그 편이 초안 목록에서 다른 초안을 열 때도 같이 해결된다. **어느 쪽을 골랐는지 보고에 적어라.**
- **이건 네가 만든 결함이 아니다** — 합치기 전 5벌 전부 똑같았다. 다만 이제 고칠 자리가 하나다.

### S2-2. 이중 클릭 차단이 두 경로에서 빠졌다 (지시 1번 미이행)

과제 S 지시 1번이 *"다른 조작(집기 등)도 op 전송 중에는 같은 패턴인지 점검해 일괄 적용"* 이라고 했는데 두 곳이 남았다:

- `handleApplyFixPlan`(`:1048`) — 「물어보고 고치기」의 수순 전체 적용. **`savingOp`를 검사하지 않고** 직접 `draft_op`를 연달아 보낸다(`:1057-1066`). 다른 op가 날아가는 중에 누르면 두 글쓴이가 경합한다.
- `handleApplyOp`(`:1936`) — 연쇄 영향 다이얼로그의 [적용하기]. `setSavingOp(true)`를 **설정만 하고 진입할 때 검사하지 않는다.** 빠르게 두 번 누르면 둘 다 통과한다.

처방: 두 곳 다 진입 가드(`if (savingOp) return;`)를 붙이고, 버튼도 `disabled={savingOp}`로 막는다. 그 밖에 `draft_op`를 보내는 경로가 더 있는지 grep으로 전수하고 목록을 보고에 적어라.

### S2-3. ESC가 트레이 카드만 골라 놓은 상태에서 3색을 안 지운다 (사소)

`:378-380`. ESC 처리의 네 분기 중 `selectedParkedEntry` 분기만 `setCandidatesResult(null)`이 없다. 트레이 카드를 고르면 `pickedSlot`은 비고(`:4098`) `candidatesResult`만 서므로, ESC를 눌러도 **선택만 풀리고 판의 3색은 남는다.** 나머지 세 분기와 똑같이 한 줄 추가하면 된다. (기존 코드이고 과제 S가 만든 것이 아니다 — 드래그로 고르는 길이 하나 늘어 눈에 띄었을 뿐이다.)

**참고 — 기각한 지적**: 「드래그를 취소하면 집은 수업·3색이 남는다」는 **결함이 아니다.** 그 상태는 클릭으로 집었을 때와 동일하고, 지시서가 *"클릭 방식은 그대로 병행 유지"* 를 요구했으므로 오히려 정합적이다. 해제 수단(ESC)도 있다. 손대지 마라.

**완료 확인**: tsc·build·check:ui·`check_ui_removals`(기준 `c4eb908`) + `movecand`·`m2ops`·`lookahead` selftest 유지 + ⓐS2-1을 어디에 넣었는지 ⓑ`draft_op` 전송 경로 전수 목록과 각각의 가드 유무 — 코드 근거(file:line) 보고. **핸드오버 ④ 기재.**

---

## 과제 T — 그리드 고정(📌)·시간표 추가 + 셀 높이 상시 균일화 (사용자 실기기 피드백 2026-08-22)

**착수 조건: 과제 S-2를 먼저 끝내라(같은 파일 — 순차). R·R-2는 종결됐다.** 배치 원본 = `docs/timetable_manual_move_spec.md` §2-2 개정판·§2-3 승격 조항(이 커밋에 반영됨).

1. **셀 높이 상시 균일화 (근본 결함 — 우선)**: 잠금·이동불가 설명 문장이 든 셀이 커서 hover 연동 때 판이 출렁이고 마우스가 튕긴다. **모든 셀 같은 높이** — 설명 문장은 hover 툴팁으로, 셀에는 아이콘(🔒)까지만. 직접 조정 모드만이 아니라 **평상시 렌더 포함**. 합격 기준 = hover로 그리드를 아무리 오가도 패널 위치·크기가 1px도 안 움직인다.
2. **📌 고정 토글**: 학급·교사 그리드 머리에 각각. 고정 시 hover 연동 무시, 명시적 선택으로만 변경. 기본값 = 지금처럼 따라오기.
3. **「시간표 추가」**: 고정 전용 그리드 패널 최대 2개 추가(추가 시 교사/학급 선택, 항상 고정, 닫기 버튼). 추가 패널에서도 집기·3색·이동이 본 그리드와 동일하게 동작(같은 후보 데이터 재사용).
4. 화면 문구 규칙·셀 불변 조항 유지.

**완료 확인**: tsc·build·check:ui·removals + selftest 유지 + ⓐ균일화 후 셀에 조건부로 남는 요소 전수 목록 ⓑ고정 토글이 무시하는 이벤트 경로 ⓒ추가 패널의 집기 경로가 본 그리드와 같은 함수를 쓰는지 — 코드 근거 보고. **핸드오버 ④ 기재.**

---

## 과제 U — 수읽기 기보 카드: 해결안 찾기 내부 엔진 교체 (L1)

**착수 조건: 과제 S-2·T를 먼저 끝내라(같은 파일 — 순차). R·R-2는 종결됐다.** 배치 원본 = `docs/timetable_lookahead_spec.md` §3·§4.

Claude 선행분(이 커밋 포함): `src/lib/timetable/lookahead.ts`의 `searchLookaheadLines({grids, model, target, budget…})` — 감점 항목(target = scope·key·day·code)을 주면 **기보(수순 상위 3개)** 를 돌려준다. 각 기보 = ops(전부 swap — 기존 draft_op 어휘)·stepScores·finalDelta·targetResolved·touched. 결정론·AI 호출 0. 자가 테스트 `npx tsx scripts/lookahead_selftest.ts` 8건(2수 문제·재생 파리티·예산 포함).

1. **감점 상세의 「해결안 찾기」 버튼 내부를 교체**: 기존 체인 탐색 호출 → `searchLookaheadLines`(target = 그 항목의 scope·key·day·code, 기본 budget). 결과 카드 = **기보 카드**: 미니 그리드 연쇄(touched 칸 하이라이트 — 텍스트 수순 표기 금지, 스펙 §0-1) + 최종 delta + [한 수씩 밟기] [전체 적용].
2. **한 수씩 밟기** = 기본. 각 수를 기존 draft_op(swap, expectedOpCursor 포함)로 순차 적용 — 수마다 그리드·총점 갱신, 언제든 중단·실행취소.
3. **전체 적용** = 남은 수들을 chain op 1건으로(steps = swap step 나열) 전송.
4. 기보를 못 찾으면: 읽은 수 표시 + 「더 깊이 읽기」(budget 3배 재호출, 1회만). 그래도 없으면 기존 잠금 안내 스타일 문구.
5. 계산은 비동기(집기 채점과 같은 패턴 — 처리 중 버튼 잠금·진행 표시, 과제 S의 반응성 규약 적용).
6. 기존 체인 탐색기(fixFinder)는 **삭제하지 말 것** — 물어보고 고치기가 아직 쓴다(그쪽 교체는 별도 판단).

**완료 확인**: tsc·build·check:ui·removals + `lookahead_selftest` 8건 유지 + 해결안 찾기 1회 호출 경로(어떤 target을 넘기는지)·두 적용 경로의 op 전송 코드 근거 보고. **핸드오버 ④ 기재.**

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
