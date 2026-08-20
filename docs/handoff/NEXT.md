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

## 과제 J — 글씨 크기 2단계 2묶음: 생활지도·수명주기의 1급 정보 14px 승격

- 기준 커밋: `6c95c62`
- **시작 전에 `docs/font_size_spec.md` §2(등급)·§3(예외 2종)·§4(모바일 조건)·§5(2단계)를 읽어라.**
- 실측 규모(2026-08-21, Claude): 대상 23파일 / `text-xs`·`text-[11px]` 합계 **418곳**. 이 418곳을 전부 올리라는 뜻이 **아니다** — 그중 **1급인 것만** 올린다 (스펙 §5 마지막 줄).

### 대상 파일 (이 묶음만)

- `src/components/admin/discipline/` 전체 9파일
- `src/components/admin/lifecycle/` 전체 14파일

이 두 디렉터리 **밖은 건드리지 마라.** 시간표는 과제 K다(아래).

### 할 일

1. 화면에 보이는 **1급 정보**가 `text-xs`(12px) 이하로 렌더되는 곳을 전수 찾아 `text-sm`(14px) 이상으로 올린다.
2. **이 묶음에서 1급으로 봐야 할 것** (스펙 §2 표를 이 화면들에 적용한 결과 — 애매하면 이 목록을 우선한다):
   - **학생 식별자** — 이름, 학번, 학년·반·번호. 사람을 잘못 짚으면 되돌리기 어려운 화면들이다.
   - **날짜·기한** — 전입·전출일, 졸업 처리일, 승급 기준일, 징계 발생일·단계 전환일, 마감.
   - **상태** — 승인/반려/대기/완료/무효, 동의/미동의, 처리 성공·실패.
   - **징계 단계와 사유** — 단계 숫자·명칭, 사유 문장.
   - **건수** — 대상 인원, 처리 건수처럼 사용자가 보고 실행 여부를 정하는 수.
   - **버튼·링크 라벨, 에러·경고 문장, 입력 필드의 값과 라벨.**
3. **2급·3급은 손대지 않는다.** 이 화면들에서 2급인 것: 이메일 주소, 소속·직책, 툴팁, 독립 힌트 문구, 목록의 부가 열, 안내 도움말. 3급: 단위 표기, 캡션.
4. 임의값 신설 금지 — 표준 클래스만. (`text-[11px]`은 기존 것을 올릴 때의 출발점일 뿐, 새로 만들지 마라.)
5. 크기 승격으로 한 줄에 안 들어가는 곳은 **줄바꿈 허용 수준까지만** 고친다(`flex-wrap`, 세로 스택 전환). 구조 개편·컴포넌트 재배치는 금지 — 필요해 보이면 `파일:줄`로 보고만.
6. **`shared.tsx`·`GroupTabs.tsx`는 여러 탭이 함께 쓴다.** 여기를 고치면 파급이 넓으니 바꾼 곳마다 어느 탭에 영향이 가는지 한 줄로 적어라.
7. **`SubstituteHandoverWizard.tsx` 주의** — 기간제 이관 마법사다. 실행하면 되돌리기 어려운 화면이라 **확인 문구·대상자 이름·경고 문장이 전부 1급**이다. 여기서 남긴 1급 후보가 있으면 반드시 사유를 적어라.
8. 판단이 애매한 자리는 한 급 위로 올리고, 올리지 않고 남긴 1급 후보는 사유와 함께 보고한다.
9. 커밋은 2개로 끊는다 (생활지도 / 수명주기).

### 완료 확인 방법

1. `grep -rnE "text-\[[0-9](\.[0-9]+)?px\]" src/` → **0건 유지** (1단계 회귀 검사)
2. `grep -rln "text-\[10px\]" src/` → 잡히는 파일이 **스펙 §7 목록 13개와 정확히 일치** (늘지도 줄지도 않아야 한다)
3. `npx tsc --noEmit` · `npm run build` 통과
4. `bash scripts/check_ui_removals.sh 6c95c62` 결과 보고
5. 핸드오버(`project_notes.md`)에 적을 것: 승격한 곳 수 + **남긴 1급 후보 목록(사유)** + 줄바꿈 처리한 곳 목록 + `shared.tsx` 파급 영향 + **"화면·모바일 미검증" 명시** (360px는 Claude, 실기기는 사용자 몫 — 스펙 §4)

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
