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
9. **한 번에 한 과제만 한다.** 지금 차례는 **과제 U 하나**다. 커밋·핸드오버까지 마쳤으면 **거기서 멈추고 보고해라.** S·T·U는 검증을 통과한 뒤 Claude가 다시 지시한다 — 미리 손대지 마라(같은 파일이라 겹치면 검증이 불가능해진다).

---

## 과제 U — 수읽기 기보 카드: 해결안 찾기 내부 엔진 교체 (L1)

**과제 R·S·T 계열은 2026-08-22 검증 통과·배포로 종결됐다. 지금 차례가 이것이다.** 기준 커밋: `8a34eac`. 배치 원본 = `docs/timetable_lookahead_spec.md` §3·§4.

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
