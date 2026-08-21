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

## 과제 M — 「물어보고 고치기」 카드 (자동 작성 탭)

**기준 커밋 `7b9f015`.** 대상 파일은 `src/components/admin/timetable/DraftAutoTab.tsx` **한 개**다.
설계 본문 = `docs/timetable_ask_fix_spec.md` (§4가 이 과제, §7이 하지 말 것). 열린 항목 대장은 `STATUS.md`의 「말로 묻는 시간표 해결사」 절.

### 무엇을 만드는가 (한 문단)

지금 감점 목록의 [해결안 찾기]는 **감점 한 줄을 지목했을 때만** 동작한다. 이 과제는 그 앞에 **말로 묻는 입구**를 붙인다 — 일과계가 *"이경호 선생님 1교시가 5일 연속인데 해결할 방법은?"* 이라고 쓰면, 해석 결과를 먼저 확인시키고, 여러 번 맞바꾸는 수순과 **그로 인해 새로 생기는 감점 전부**를 보여 준 뒤, 수락하면 그대로 적용한다.

**속은 이미 다 만들어져 있다. 이 과제는 화면만 만든다.** 판정·탐색·채점 로직을 새로 쓰지 마라.

### 쓸 것 — 이미 있는 진입점 두 개

**(1) 질문 해석 (서버 1회 호출)**

```ts
POST /api/timetable/manage
{ action: "ai_ask_fix", draftId: openDraft.meta.id, aiText: 질문원문 }
```

응답: `{ success, enabled, result: { interpretation, goal, warnings } }`

- `enabled === false` → AI 도움 기능이 설정 안 된 상태. 기존 E-3·E-4 버튼과 **같은 규칙**으로 다룬다 (`DraftAutoTab.tsx:1260` 참조 — 버튼을 조용히 없애지 말고 이유 한 줄을 남긴다).
- `result.goal === null` → **못 알아들은 것이다.** `interpretation`(이유)과 함께 **알아듣는 질문의 예**를 보여 준다. 예시 문장은 `src/lib/timetable/ai.ts`의 `ASK_FIX_EXAMPLES`를 그대로 import 해서 쓴다 — 화면에 손으로 다시 적지 마라(둘이 갈라진다).
- 실패 응답(4xx)의 `error` 문장은 그대로 보여 주면 된다. 이미 눈높이 문장이다 (예: 등록부에 없는 성명을 썼을 때).

**(2) 수순 탐색 (화면에서 계산 — 서버 호출 없음)**

```ts
import { findFixPlanAsync, type FixPlan } from "@/lib/timetable/fixFinder";

const { baseGrids, meta, model, currentGrids } = openDraft;
const plan = await findFixPlanAsync(
  { baseGrids, ops: meta.ops.slice(0, meta.opCursor), currentGrids, model, goal },
  (p) => setProgress(p)   // { evaluated, budget, depth }
);
```

- **동기판(`findFixPlan`)을 쓰지 마라.** 최대 3초가 걸리고 그동안 화면이 멈춘다. 비동기판은 25건마다 제어를 돌려주므로 진행률과 스크롤이 산다.
- 기존 [해결안 찾기]가 쓰는 `findFixCandidates`와는 **다른 함수**다. 그쪽은 건드리지 마라.

### `FixPlan`을 화면에 어떻게 옮기는가

| 필드 | 화면에서 |
|---|---|
| `goalText` | 탐색 **전에** 보여 주는 확인 문장. "이렇게 이해했습니다: ○○" |
| `steps[]` | 수순. 각 항목의 `desc`가 이미 사람 문장이다(*"1학년 2반 월요일 1교시(국어·김ㅇㅇ)와 목요일 5교시(빈 교시)를 맞바꿉니다"*). **1) 2) 3) 번호를 붙여** 순서대로 |
| `steps[].sideEffects` | 그 수 하나가 만든 변화 (최대 3건) |
| `newPenalties[]` | **수락 버튼 앞에 전부 보여 준다.** 접거나 "외 N건"으로 줄이지 마라 — 이게 이 기능의 요구 그 자체다(아래 「가장 중요」) |
| `finalSoftTotal` | 최종 점수. 시작 점수는 `openDraft.report.soft.total` |
| `resolvesGoal` | false면 아래 「못 풀었을 때」 |
| `remaining` / `initialRemaining` | 못 풀었을 때 "얼마나 갔는지" (예: 시작 4 → 남은 2) |
| `budgetExhausted` | true면 "시간 안에 다 못 봤다", false면 "3번까지 바꿔 봐도 안 된다" — **문구가 달라진다** |

**[가장 중요] 부작용 전수 고지가 이 기능의 핵심 요구다.** 발안 원문이 *"추가로 생기는 감점 요소들을 다 알려주고 일과계가 수락하면 고고"* 였다. 기존 해결안 카드는 "최대 3건" 요약이지만 **여기서는 `newPenalties`를 전부** 보여 준다. 길다는 이유로 자르지 마라.

### 버튼 두 개의 배선

- **[한 수씩 미리보기]** → `analyzeOpImpact(step.op, step.desc)` (`DraftAutoTab.tsx:950`). 기존 미리보기 모달이 그대로 열린다.
- **[모두 적용]** → `draft_op`를 **순서대로 한 건씩** 호출한다. `handleApplyOp`(`:1086`)이 하는 것과 같은 요청이고, 응답의 `meta·baseGrids·currentGrids·report`로 `setOpenDraft`를 갱신한 **뒤** 다음 수를 보낸다.
  - **한 건이라도 실패(4xx)하면 거기서 멈추고, 몇 번째까지 적용됐는지 화면에 남긴다.** 조용히 계속 가면 안 된다.
  - 적용 뒤 "한 수씩 되돌릴 수 있습니다"를 한 줄 안내한다 (기존 「실행취소」 버튼이 수 단위로 동작한다).
  - 새 적용 경로를 만들지 마라. 이 두 개 말고 다른 저장 호출은 이 과제에 없다.

### E-4(개선 제안) 제거 — 같은 커밋에서

사용자 판정이 확정이다: *"저 메뉴들은 해결책을 말 안 해주기 때문에 무쓸모야."* 이 기능이 그 자리를 대신한다.

- 지울 것: 버튼(`:1237~1256`) · 카드(`:1685~1729`) · 상태 4개(`:258~262`) · 호출 함수 `handleAiCritique`(`:886~`) · 초안 전환 시 초기화 줄 · import `AiCritiqueResult`.
- **E-3(이 시간표 설명)은 남긴다.** 지우지 마라.
- 에러 배너가 셋을 공유한다(`:1313~1317`) — `aiCritiqueError`만 빼고 나머지 둘은 살린다. **여기에 새 기능의 에러도 합류시키는 편이 자연스럽다.**
- 서버 쪽 `ai_critique` 액션은 **건드리지 마라.** 화면만 걷는다.

### 문구 규칙 (AGENTS.md ui-copy)

1. **금지어**: 「체인」·「빔」·「엔진」·「목표 어휘」·「탐색기」·`FixPlan` 같은 내부 이름. 스펙 §번호도 화면에 쓰지 않는다.
   - 대신: "여러 번 맞바꿔서" · "방법을 찾는 중" · "바꿀 순서".
2. **못 풀었을 때 출구를 단다** (ui-copy 5). 나열만 하고 끝나면 안 된다.
   - `budgetExhausted` → *"시간 안에 찾지 못했습니다. 조건을 조금 낮춰서(예: 3일 이하 → 4일 이하) 다시 물어보시겠어요?"*
   - 깊이 소진 → *"세 번까지 바꿔 봐도 풀리지 않았습니다. 이 정도면 학급 전체 편성을 조정해야 할 수 있습니다."*
   - 어느 쪽이든 `initialRemaining` → `remaining`으로 **어디까지 갔는지** 함께.
3. AI 결과 옆에는 기존 카드들과 같은 **참고 의견 딱지**를 붙인다 — 단, 딱지가 걸리는 것은 **해석 문장**뿐이다. 수순과 점수는 AI가 만든 것이 아니라 계산된 사실이므로 "AI가 작성한 참고 의견"이라고 쓰면 **거짓말**이 된다. 문구를 나눠라.
4. 글씨 크기는 `docs/font_size_spec.md` 3등급. 이 카드는 격자 밖이라 예외가 없다 — 행동을 결정하는 값(수순 문장·점수·버튼)은 14px.

### 하지 말 것 (스펙 §7)

1. AI에게 교환 수를 제안시키는 경로 — **영구 금지**. AI가 주는 것은 목표 1건뿐이고, 그 외의 것을 화면에 표시하지 마라.
2. 자동 수락 — 사람이 누르지 않으면 적용되지 않는다.
3. 질문 이력 저장 — 세션 안 상태로만. 어디에도 쓰지 마라.
4. `fixFinder.ts` · `ai.ts` · `validate.ts` · `solver.ts` 수정 — **이 과제의 대상이 아니다.** 고쳐야 할 것을 발견하면 고치지 말고 보고해라.

### 완료 확인 방법

1. `npx tsc --noEmit` 0건 · `npm run build` 통과 · `npm run check:ui` 통과.
2. `bash scripts/check_ui_removals.sh 7b9f015` — **없어진 것이 E-4 관련뿐인지** 확인한다. E-3·해결안 찾기·미리보기·실행취소의 핸들러나 라벨이 목록에 뜨면 **되살린 뒤** 넘긴다.
3. `npx tsx scripts/askfix_selftest.ts` = 42/42, `npx tsx scripts/ai_selftest.ts` = 전체 통과. (화면만 고치면 안 깨진다. 깨졌다면 §7-4를 어긴 것이다.)
4. `grep -nE "체인|빔 서치|FixPlan|AskFixGoal|resolvesGoal" src/components/admin/timetable/DraftAutoTab.tsx` — **화면 문구에 걸리는 것이 0건**이어야 한다(타입 이름은 코드에 있어도 된다, 문자열 안에 있으면 안 된다).
5. **화면 왕복은 「판정 불가」로 두어라** — 로그인이 필요해 네가 못 한다. 대신 *"무엇을 눌러 무엇이 보여야 하는지"* 를 항목으로 적어 넘겨라. 사용자·Claude가 실기기에서 본다.

### 보고에 반드시 적을 것

- 지운 것 목록 (E-4 4종) + `check_ui_removals` 결과.
- 새 화면이 서버를 몇 번 부르는지 한 줄 (`AGENTS.md` ⑪): 질문 1건당 **해석 1회**, 탐색 0회, 적용은 수순 길이만큼.
- 스펙과 코드가 어긋난 곳이 있으면 맞추지 말고 그대로 보고.

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
