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

---

## 과제 N-2 — 직접 조정 M1 화면 보수 (사용자 실기기 1차 반려)

**기준 커밋: HEAD. 사용자 판정: "이건 아닌 것 같아. UI 다시." 원인 = 스펙 제1원칙(표가 계속 보여야 한다) 위반 — 신설된 「셀 불변 조항」(`docs/timetable_manual_move_spec.md` §2-3 마지막 항목)이 이번 보수의 단일 기준이다.**

고칠 것 4가지 (전부 `DraftAutoTab.tsx`):

1. **셀 안의 문장 전부 철거 → hover 말풍선으로.** 지금 후보 칸 안에 감점 내역("연속 3교시 이상(+2점), …")과 차단·잠금 사유("분반 이동수업 묶음(…) 칸입니다") 문장이 통째로 렌더돼 셀이 거대해지고 주간이 안 보인다. 셀에는 기존 내용 + **우상단 소형 뱃지(±숫자)** + 배경 틴트 + ⇄ 아이콘까지만. 문장류는 전부 title/툴팁·말풍선으로 옮긴다. **셀 크기·격자 치수가 집기 전과 완전히 동일해야 한다** — 이것이 합격 기준.
2. **색은 배경 틴트로** — 굵은 테두리 박스 확대 금지(연초록/연노랑/회색빗금 배경). 오른쪽 교사 그리드의 밀도가 정답 견본이다 — 학급 그리드를 그 밀도로 맞춰라.
3. **집은 수업 칩의 문자열 버그**: "수$1교시"로 표시된다 — 템플릿 조립 오류(`$` 리터럴). 수정하고, 칩 문구는 「과목 (교사)」만 남기고 교시 표기는 빼라(그리드에서 집은 칸이 강조돼 있으니 중복이고, 텍스트 위치 표기는 스펙 §0-1 금지 계열이다).
4. 빈 칸 후보의 「빈 칸 +n」 글자도 뱃지+틴트로 통일(교사 그리드 포함 — "빈 칸" 글자는 불필요, 비어 보이는 것 자체가 정보다).

**완료 확인**: tsc·build·check:ui·`check_ui_removals`(기준 HEAD — 문장 이동은 삭제로 잡힐 것, 사유 기재) + **집기 전/후 격자 치수 불변을 코드 근거로 보고**(셀에 조건부로 들어가는 요소 목록 제시). 실기기 재확인은 사용자.

---

## 과제 Q — 직접 조정 M2 화면: 연쇄(루미큐브) + 잠깐 빼두기 트레이

**착수 조건: 과제 O·P를 먼저 끝내라(같은 파일 — 순차).** 기준 커밋: 이 파일과 같이 커밋된 HEAD. 배치·동작 원본 = `docs/timetable_manual_move_spec.md` §2-4(연쇄)·§2-5(트레이). **셀 불변 조항(§2-3 마지막)은 여기도 그대로다.**

Claude 선행분(이 커밋에 포함 — 전부 검증 완료, 자가 테스트 `npx tsx scripts/m2ops_selftest.ts` 15건):
- **op 3종 신설**: `chain`(steps 배열 — 한 판이 op 1건 = 실행취소 원자 단위) · `park`/`unpark`(parkId 문자열로 지목). `src/lib/timetable/types.ts`의 `BaseRevisionOp`·`ChainStep`·`TrayEntry` 참조.
- **트레이는 저장하지 않는다** — `deriveTray(baseGrids, ops)`(utils)가 파생한다. `customUnplaced`(draftUnplaced)를 트레이에 쓰지 마라.
- 서버 관문 완비: 빼둔 수업이 만드는 시수 부족은 조작 단계에서 안 막히고, **채택 시** "잠깐 빼둔 수업 N건…" 메시지로 막힌다. 자리표시 가드도 chain·park까지 확장돼 있다.

**M2 화면 범위 (스펙 §2-4·§2-5 그대로)**:
1. **연쇄**: 집은 수업을 점유 칸에 놓을 때 교환이 안 되면(후보 채점 결과 swap 불성립) — 지금처럼 포기하는 대신 **밀려난 수업이 커서에 들린다**(트레이 위 미니 카드 「지금 들고 있음: 과목 (교사)」). 들린 카드 기준으로 3색 재계산 → 계속 굴리기. 종료 = ⓐ 내려놓기 ⓑ 트레이로 빼두기 ⓒ Esc(그 판 전체 취소 — 서버 미전송이므로 로컬 상태만 버리면 된다).
2. **한 판 = chain op 1건**: 연쇄 중에는 서버에 안 보내고 로컬 steps를 쌓다가, 종료 ⓐⓑ 시점에 `{type:"chain", steps:[...]}` 하나로 draft_op 전송(expectedOpCursor 포함). 단독 이동/맞교환(연쇄 없이 한 수)은 기존 swap op 유지.
3. **트레이 패널**: 스펙 §2-2 배치(Ⓒ — 그리드 아래, 비면 얇게 접힘). 내용 = `deriveTray(openDraft.baseGrids, ops.slice(0,opCursor))`. 카드 = 과목·교사·원위치 없이? — 원위치는 카드 hover 툴팁으로(텍스트 위치 표기 금지 원칙, from 필드 활용은 툴팁까지만). 카드 클릭 = 집기(3색 모드) → 빈 칸에 내려놓으면 unpark op.
4. 수업 우클릭 또는 집은 상태에서 트레이 클릭 = park op 전송.
5. 채택 버튼 활성 조건에 트레이 비움 추가(서버가 이미 막지만 화면에서도 미리) — 트레이에 남은 게 있으면 버튼 비활성 + 「잠깐 빼둔 수업 N건」 안내.

**완료 확인**: tsc·build·check:ui·removals + `m2ops_selftest`·`movecand_selftest` 통과 유지 + 연쇄 종료 3경로(내려놓기/빼두기/Esc)가 각각 무엇을 전송하는지 코드 근거(file:line) 보고. **핸드오버(④) 기재 필수.**

---

## 과제 Q-2 — 연쇄 극성 수정 (Codex 검증 실패 3건의 단일 원인 해소)

**기준 커밋: 이 파일과 같이 커밋된 HEAD.** Codex E1·E2·E9 실패의 원인은 하나다 — 「교환이 **되는** 칸」이 연쇄로 처리되고, 「교환이 **안 되는** 칸」(연쇄의 존재 이유)은 회색으로 죽어 있다. **Claude가 채점기에 새 후보 종류를 추가해 뒀다** — 이제 재배선만 하면 된다.

새로 쓸 수 있는 것 (이 커밋 포함, selftest 15건 통과):
- `MoveCandidate.kind`에 **`"displace"` 신설**: 맞바꿈은 불성립이지만 **내 수업을 넣고 그 칸 수업을 들어올릴 수 있는** 점유 칸. 이제 그런 칸이 회색이 아니라 초록/노랑으로 온다.
- **`evaluateHeldCandidates({grids, model, held})` 신설**: 든 카드(들린 수업·트레이 카드) 기준 3색 — 빈 칸 = move(내려놓기), 점유 칸 = displace(다음 카드 들기). 연쇄 중 재계산은 이걸 쓴다(집기용 evaluateMoveCandidates를 우회 호출하지 말 것).

고칠 것 3가지 (`DraftAutoTab.tsx` 직접 조정 클릭 핸들러):
1. **연쇄 비활성 상태에서 `kind === "swap"` 초록/노랑 클릭 = 즉시 swap op 전송** (M1 동작 복원 — 로컬 연쇄로 돌리지 마라).
2. **`kind === "displace"` 클릭 = 연쇄 시작**: 로컬 미리보기에서 내 수업을 그 칸에 넣고 그 칸 수업을 「들고 있는 카드」로, `evaluateHeldCandidates`로 3색 재계산. steps 기록은 swap step이 아니라 **park(들린 수업을 임시 보관) 개념이 아니라** — 연쇄 종료 시 steps가 재생됐을 때 같은 결과가 나오도록: [swap(내 원위치↔목적지)는 불성립이므로] `chain` steps는 **순서 있는 이동의 나열**로 짜야 한다. 가장 단순한 정답: 각 밀어내기를 `park(목적지 칸, parkId_n)` + `swap(내 위치→목적지)` … 마지막에 `unpark`들이 내려놓기로 소진되는 구조 대신, **steps = [{park A로 목적지 수업 빼기}, {swap으로 내 수업 이동}, …, {unpark 마지막 내려놓기}]** — m2ops_selftest의 「chain: 3수 원자 재생」 케이스가 정확히 이 패턴의 견본이다(빼기→밀기→되돌리기). 재생 결과가 화면 미리보기와 같은지로 자가 검증해라.
3. **연쇄 중** 모든 수(재밀어내기 포함) steps 누적 → 종료(내려놓기/트레이/Esc) 동작은 기존 구현 유지.
- displace 칸 표시: 3색 그대로 + 셀 불변 조항 안에서 작은 「✋」 아이콘 허용(교환과 구분).

**완료 확인**: tsc·build·check:ui·removals + `movecand_selftest` 15건·`m2ops_selftest` 15건 유지 + **재배선 후 세 경로(단독 swap 즉시 전송 / displace 연쇄 시작 / 연쇄 종료 chain 전송)의 코드 근거(file:line) 보고** + 로컬 미리보기와 chain 재생 결과 동일성(수동 추적 1례) 보고. **핸드오버 ④ 기재.**

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
