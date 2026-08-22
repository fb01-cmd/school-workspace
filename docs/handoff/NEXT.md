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

## 과제 N — 직접 조정 모드 M1 화면 (시간표 작성 편집기)

**기준 커밋: 이 파일과 같이 커밋된 HEAD. 스펙(배치 원본) = `docs/timetable_manual_move_spec.md` — §2가 화면 구성의 단일 원본이다. 배치를 임의로 바꾸지 말고, 스펙과 코드가 어긋나면 보고해라.**

Claude 선행분은 이미 커밋돼 있다:
- `src/lib/timetable/moveCandidates.ts` — `evaluateMoveCandidates({grids, model, pick})` 가 후보 전 칸의 3색 판정(`verdict: ok|worse|blocked`)·감점 변화(`softDelta`)·사유(`blockedReason`)·말풍선용 코드별 증가(`worseByCode`)를 돌려준다. 채점은 본검사기 단일 소재지라 서버 관문과 어긋나지 않는다. 자가 테스트 = `npx tsx scripts/movecand_selftest.ts`.
- `draft_op`에 `expectedOpCursor` 선행조건이 생겼다 — **모든 draft_op 호출에 `expectedOpCursor: openDraft.meta.opCursor`를 담아라**(기존 2곳은 Claude가 이미 배선). 충돌 응답이 오면 "다른 창이 먼저 수정" 안내 후 초안 재로드.

**M1 범위 (스펙 §4 — 연쇄·트레이는 M2, 손대지 마라)**:
1. `DraftAutoTab` 도구줄에 `[직접 조정]` 토글 (1024px 미만 창에서는 렌더하지 않는다 — 스펙 §0-4).
2. 토글 켜면: 교사 카드를 학급 그리드와 **동급 패널로 병치**(스펙 §2-2 배치도), 학급 그리드 칸 hover 시 그 수업 교사의 주간표가 교사 패널에 즉시 표시(현행 클릭 → hover로).
3. 칸 클릭 = 집기 → `evaluateMoveCandidates` 호출(비동기, 결과 오기 전 칸들은 중립색) → 두 그리드에 3색 + softDelta 뱃지 렌더 (스펙 §2-3 표 그대로: 초록=즉시 이동, 노랑=뱃지·말풍선 후 즉시 이동(팝업 금지), 회색=무반응+hover 사유).
4. 초록/노랑 클릭 = 기존 draft_op(swap) 경로로 적용(expectedOpCursor 포함) → 성공 시 그리드·감점 상세·상단 총점 갱신, 집기 해제.
5. 집기 해제 = 같은 칸 재클릭/Esc. pickBlocked면 칸 옆 말풍선으로 사유 표시(alert 금지 — 기존 🔒 alert 두 곳도 이 기회에 말풍선으로 바꿔라).
6. 상단 바: 현재 총점 + 직접 조정 시작 시점 대비 변화 (스펙 §2-2).

**화면 문구**: 스펙 §0-3 — 개발 용어 금지. 텍스트 이동 표기(「월3→화2」) 금지 — 모든 표시는 그리드 위 색·뱃지.

**완료 확인 방법 (전부 적어서 보고)**:
- `npx tsc --noEmit` 0건 · `npm run build` ✅ · `npm run check:ui` ✅ · `bash scripts/check_ui_removals.sh <기준커밋>` (사라진 것 전부 사유 기재)
- `npx tsx scripts/movecand_selftest.ts` 통과 유지 (모듈을 고치지 않았다면 자동)
- 화면 실측 불가(로그인)므로: 토글·3색·뱃지·이동 각각에 대해 **무엇을 렌더하는지 코드 근거(file:line)로 보고** — 실기기 확인은 사용자 몫으로 남긴다

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
