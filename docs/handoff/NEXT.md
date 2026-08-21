# NEXT — Antigravity 작업 지시서

> **이 파일은 덮어쓴다.** 끝난 과제는 지운다 — 낡은 줄이 곧 버그다 (`AGENTS.md` §1-5).
> 저장소는 `/home/fb01/school`. 기준 커밋은 각 과제에 적힌 것.

## 항상 지킬 것 (매 과제 공통)

1. **기존 파일을 재작성하지 마라.** 요청받은 부분만 국소 수정한다 (`AGENTS.md` ①-1).
2. **삭제가 추가보다 많으면 멈추고 보고해라.**
3. **커밋은 과제별로 끊는다.** `git add -A` / `git add .` 금지 — 자기가 바꾼 파일만 명시적으로 add.
4. **넘기기 전 스스로 통과시켜라**: `npx tsc --noEmit` · `bash scripts/check_ui_removals.sh <기준커밋>`
   - `npm run build`는 돌려도 된다 (힙 옵션이 스크립트에 들어 있다).
5. **절대 금지**: `git push` · `gh` · `.env.local` · `~/.ssh/` · `rm -rf`
6. **지시가 지금 코드와 다를 수 있다. 다르면 맞추지 말고 다르다고 보고해라.**
7. **실행해야만 알 수 있는 것은 통과/실패로 몰지 말고 「판정 불가」로 두고, 무엇을 실행해야 아는지 적어라.**
8. **근거는 `파일:줄번호`로 단다.** 보고는 항목당 한 줄 — 서술형 장문 금지.

---

## 과제 L — 창체·SLAT 배치 화면: 「학년도별 변경」 추가 (fixed_slot_override_spec §5)

- 기준 커밋: `9fb78b3` (코어·서버·API는 이 커밋에 전부 들어 있다 — 화면만 만들면 된다)
- **시작 전에 `docs/fixed_slot_override_spec.md` §5(화면)를 읽어라.** §1~§4는 배경 설명이니 판단이 필요할 때만 본다.
- 주 작업 파일: `src/components/admin/timetable/CurriculumCohortTab.tsx`. 보조 컴포넌트가 필요하면 같은 폴더에 신설.
- ⚠️ **동시 작업 금지**: 「화면 문구 다이어트 2차(시간표 폴더)」 과제와 같은 파일을 만질 수 있다. 이 과제를 받았다면 그쪽이 돌고 있지 않은지 사용자에게 확인하고 시작해라.

### 할 일 (스펙 §5의 ⑴⑵⑶ + 학년도 계산 교체)

1. **맨 위 「지금은 어떻게 되나」 블록**: 학년도 선택(기본 = 현재 학년도) + 학년(1~3)별 최종 슬롯 미니 격자 + 출처 한 줄. 데이터는 `resolveFixedSlots(cohorts, overrides, 학년도, 학년)`(`src/lib/timetable/cohort.ts`) 호출 결과만 쓴다 — **판정 로직을 화면에서 재구현하지 마라.** `skippedOverride`가 있으면 그 학년에 경고 줄(문구는 스펙 §2의 사전점검 문구와 같은 취지).
2. **아래 「학년도별 변경」 목록 + [+ ○○학년도부터 바꾸기] 버튼**:
   - 카드: label · "○○학년도부터" · 담긴 학년의 미니 격자. **적용 학년도가 현재 학년도보다 과거인 카드는 수정·삭제 버튼 비활성** + 사유 문구(서버도 거부하지만 화면에서 먼저 막는다).
   - 편집기: ① 적용 학년도 입력(현재 학년도 이상만) ② 학년 체크박스(기본 전부 선택) ③ 체크된 학년마다 격자 — **그 학년도의 `resolveFixedSlots` 결과를 미리 채운 채** 시작 ④ 학년마다 캡션 "이 학년도의 N학년은 ○○ 교육과정을 따릅니다"(`gradesForCohort`/`cohortForGrade` 재사용). 격자 조작은 기존 코호트 편집기와 동일한 방식(눌러서 켜고 끄기, 이름 기본값 "창체").
3. **API**: `cohort_override_list` / `cohort_override_save`(본문 `{override}`) / `cohort_override_delete`(본문 `{overrideId}`) — `/api/timetable/manage`. **`basedOnCohortId`는 서버가 계산해 덮어쓰니 화면에서 채우지 마라** (빈 값 `null`로 보내면 된다). 저장 실패 시 서버가 준 에러 문구를 그대로 보여준다(소급 거부·충돌 거부 문구가 이미 사용자 눈높이다).
4. **`CurriculumCohortTab.tsx:22`의 `new Date().getFullYear()`를 `schoolYearOfDate(new Date())`로 교체** (`cohort.ts`에서 import). 1~2월에 학년도가 한 해 어긋나는 버그 수정이다.
5. **문구 규칙**: 「재정의」·「오버라이드」·「코호트」를 화면에 쓰지 마라. 쓰는 말은 「학년도별 변경」·「○○학년도부터 바꾸기」·「교육과정」. 기존 코호트 수정 진입부에 안내 한 줄 추가: "자리를 옮기기로 결정된 것이라면 여기서 고치지 말고 「○○학년도부터 바꾸기」를 쓰세요 — 여기서 고치면 지난 학년도 화면 표시도 함께 바뀝니다."
6. 글씨 크기는 `docs/font_size_spec.md` 3등급 기준(행동 결정 14px · 식별 보조 12px · 메타 11px)을 따른다.

### 완료 확인 방법

1. `npx tsc --noEmit` · `npm run build` 통과
2. `bash scripts/check_ui_removals.sh 9fb78b3` — 사라진 상호작용 0 (기존 코호트 편집 기능이 그대로 있어야 한다)
3. **변경(재정의) 0건 상태에서 기존 화면과 동작 동일** — 새 섹션이 비어 있을 뿐 코호트 카드·편집이 이전과 같다
4. 핸드오버(`project_notes.md`)에 적을 것: 신설 컴포넌트 목록 + 지난 학년도 카드 비활성 처리 방식 + **"화면·모바일 미검증" 명시**(실기기는 사용자 몫)

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
