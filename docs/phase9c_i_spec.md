# Phase 9c-I — 시수 계획 → 자동 작성 연결 스펙 (2026-08-15, Claude Opus 5)

> 근거: [`phase9c_h_spec.md`](./phase9c_h_spec.md)(입력 2종 = 코호트 등록부 + 시수 계획) · [`phase9c_blank_run_2026-08-14.md`](./phase9c_blank_run_2026-08-14.md)(백지 편성 성립 증명, soft 38 < 현행 39) · [`scripts/solve_blank.ts`](../scripts/solve_blank.ts)(**조립 순서의 실증 코드 — 이 스펙의 단일 원본**)
> 사용자 승인: 2026-08-15 (*"좋은데"*)
> 대상: 9c의 마지막 큰 조각. 엔진·화면·채택 흐름이 **전부 이미 있고**, 없는 것은 그 사이를 잇는 배선뿐이다.

---

## 0. 한 줄 목표

**「시수 계획」 화면에서 만든 계획 하나를 골라 「자동 작성」에서 새 학기 시간표를 백지에서 짜고, 기존 초안·채택 흐름에 그대로 실어 보낸다.**

### 0-1. 왜 얇은가 — 이미 있는 것과 없는 것

| 조각 | 상태 | 소재 |
|---|---|---|
| 시수 계획 저장·파생·편집 | ✅ 있음 | `timetable_hours_plans`, `HoursPlanTab.tsx` |
| 교육과정 코호트 등록부 | ✅ 있음 | `listCurriculumCohorts`, `CurriculumCohortTab.tsx` |
| 코호트 → 고정 블록 전개 | ✅ 있음 | `expandCohortFixedBlocks` (`cohort.ts:46`) |
| 고정 블록 → 함의 시수 행 | ✅ 있음 (`src/`에서 **미사용**) | `impliedHoursFromFixedBlocks` (`cohort.ts:101`) |
| 시수표 → 섹션 컴파일 | ✅ 있음 (`src/`에서 **미사용**) | `compileSectionsFromHours` (`solver.ts:389`) |
| 솔버·검사기·워커 | ✅ 있음 | `solveTimetablePortfolio`, `validateTimetable`, `solver.worker.ts` |
| 초안 저장·편집·채택 | ✅ 있음 | `createDraft`, `applyDraftOp`, `adoptDraftToTerm` |
| **계획 행 → 시수표 행 변환** | ❌ **없다** | 이 스펙 §3 |
| **위 조각들의 조립을 서버에 두는 곳** | ❌ **없다** | 이 스펙 §2·§5 |
| **워커의 백지 분기** | ❌ **없다** | 이 스펙 §6-1 |
| **그리드 없는 초안 생성** | ❌ **막혀 있다** | 이 스펙 §4 |

`compileSectionsFromHours`와 `impliedHoursFromFixedBlocks`는 **완성돼 있는데 실험 스크립트에서만 호출된다.** 이 스펙은 그 둘을 실제 화면으로 끌어오는 배선이다.

---

## 1. 사용자에게 보이는 것 (3줄)

1. 「자동 작성」 화면에 **"시수 계획으로 새로 짜기"** 라는 두 번째 시작 방법이 생긴다.
2. 계획을 고르면 **먼저 확인 화면**이 뜬다 — 몇 학급·몇 시간을 짜는지, 확인이 필요한 점이 몇 건인지.
3. 「짜기」를 누르면 지금과 똑같이 초안이 만들어지고, 지금과 똑같이 검토·수정·채택한다.

---

## 2. 조립 순서 — `solve_blank.ts`의 전사, 서버 1곳에 둔다

> **이 순서는 새로 설계하는 것이 아니다.** [`scripts/solve_blank.ts`](../scripts/solve_blank.ts) `main()`이 실물 데이터로 통과시킨 순서를 그대로 옮긴다. 순서를 바꾸면 안 되는 이유가 각 줄에 있다.

새 서버 함수 **`buildBlankSolveInput(domain, planId)`** (`src/lib/timetable/server.ts`)가 아래를 순서대로 한다.

```
① plan = getHoursPlan(domain, planId)
   → 없으면 오류. plan.targetTermId 가 비어 있으면 오류(§8-4).
   termId   = plan.targetTermId
   schoolYear = Number(termId.slice(0, 4))          // "2027-1" → 2027

② term = loadTimetableTerm(domain, termId)
   → 없거나 term.status !== "draft" 이면 오류(§8-5).

③ settings  = loadTimetableSettings(domain)
   registries = Promise.all([loadSimulGroups, loadVenueGroups, loadTeacherSlotBans,
                             loadConsecutiveRules, loadCoTeachingRules])  ← 전부 (domain, termId)
   cohorts    = listCurriculumCohorts(domain)

④ classList = plan.rows 의 (grade, classNum) 중복 제거 → 정렬
   ※ 백지 학기에는 그리드가 없다. 학급 목록의 원본은 계획이다.

⑤ fixedBlocks = expandCohortFixedBlocks(cohorts, schoolYear, classList, termId)

⑥ hours = §3의 변환 규칙          ← 계획 행 + 코호트 함의 행, 이중 계상 방지

⑦ gradeDayPeriods = plan.gradeDayPeriods   ← 파생하지 않는다. 계획이 원본이다.

⑧ teacherNames / subjectShorts = §3-3 (표시용, 판정 무관)

⑨ model: TimetableConstraintModel = {
     lunchAfterPeriod, periodsPerDay, gradeDayPeriods, hours,
     simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching,
     fixedBlocks,
   }

⑩ preflight = compileSectionsFromHours({ hours, model, gradeDayPeriods,
                                          teacherNames, subjectShorts })
   → sections 는 **버린다**(§8-1). issues 와 통계만 화면에 돌려준다.

반환: { model, teacherNames, subjectShorts, issues, stats, planLabel, termId }
```

**⑤가 ⑥보다 먼저인 이유**: `impliedHoursFromFixedBlocks`의 입력이 ⑤의 산출물이다. 순서가 바뀌면 창체·SLAT 시수가 0이 되고, 검사기 H1이 그 자리를 "미배정"이라 부르지 못한다.

**⑦이 파생이 아닌 이유**: 백지 학기에는 파생할 그리드가 없다. `deriveGradeDayPeriods([])`는 `{}`를 돌려주고, 그러면 컴파일러의 학급 슬롯 정합성 검사(`class-slot-mismatch`)가 통째로 무력해진다.

---

## 3. 계획 행 → 시수표 행 변환 (없던 조각)

새 순수 함수 **`hoursFromPlanRows(rows: HoursPlanRow[], fixedBlocks: FixedBlock[]): { hours: HoursRequirement[]; droppedVirtual: number }`** — 소재지는 `src/lib/timetable/cohort.ts` (`impliedHoursFromFixedBlocks` 바로 아래. 같은 규약을 쓰는 함수끼리 붙여 둔다).

### 3-1. 교사 키 규약 — `deriveHoursPlanFromGrids`의 정확한 역함수

`HoursPlanRow`는 `teacherEmail` / `teacherName` 두 칸으로 쪼개져 있고, `HoursRequirement`는 `teacherKey` 한 칸이다. 쪼갠 코드가 `server.ts:5951-5960`에 있으므로 **그 역만 그대로 쓴다.**

```ts
const teacherKey = row.teacherEmail.trim()
  ? row.teacherEmail.trim()          // 실교사 — 파생 시 소문자화되어 저장돼 있다
  : `name:${row.teacherName}`;       // 가상 교사 — "name:" 규약 (validate.ts teacherKeyOf 동일)
```

> ⚠️ **소문자화를 새로 하지 않는다.** 파생 경로(`deriveHoursPlanFromGrids`)는 `teacherKey`를 **가공 없이** `teacherEmail`에 넣는다. 여기서 `toLowerCase()`를 추가하면 손으로 편집한 행과 파생 행의 키가 갈라져 H2(교사 중복)가 같은 교사를 둘로 본다. **왕복이 성립해야 H1/H4 대조가 성립한다** (`solver.ts:392` 주석과 같은 취지).

### 3-2. 이중 계상 방지 — 정밀 키 대조

계획을 전 학기 그리드에서 파생하면 **창체·SLAT 가상 행이 이미 들어 있다**(2026-2 실측 432행 중 60행). 여기에 `impliedHoursFromFixedBlocks`를 그냥 더하면 그 시간들이 두 번 계상돼 학급 주간 슬롯 수요가 폭발한다.

```ts
const implied = impliedHoursFromFixedBlocks(fixedBlocks);
const impliedKeys = new Set(implied.map(r => `${r.grade}-${r.classNum}|${r.subjectName}`));

const planHours = rows
  .map(toHoursRequirement)
  .filter(r => !(r.teacherKey.startsWith("name:") &&
                 impliedKeys.has(`${r.grade}-${r.classNum}|${r.subjectName}`)));

return { hours: [...planHours, ...implied],
         droppedVirtual: rows.length - planHours.length };
```

**왜 `solve_blank.ts`와 다른가.** 실험 스크립트는 *가상 행 전부*를 버렸다(`solve_blank.ts:231-234`) — 업로드 실물 시수표에 창체·SLAT 행이 없는 조건을 재현하려는 것이었다. 실전 계획은 사용자가 손으로 편집하므로 **코호트에 없는 가상 행이 남아 있을 수 있고**(예: 담당 교사 미정 과목), 그것을 뭉텅이로 버리면 시수가 조용히 사라진다. 정밀 키 대조는 실험 조건에서 뭉텅이 필터와 **결과가 같고**(가상 60행이 전부 창체·SLAT이므로), 그 밖의 행은 살려 컴파일러의 `fixed-missing` 이슈로 드러나게 한다. 동치성은 §9-2에서 기계적으로 확인한다.

### 3-3. 표시용 두 사전 (판정 무관)

- `teacherNames`: 계획 행에서 `teacherEmail → teacherName` (빈 이메일 행 제외). 그리드가 필요 없다.
  > **[2026-08-15 정정 — 가정 오류]** 이 줄은 "계획 행에 이름이 들어 있다"를 전제했는데, 파생 경로(`deriveHoursPlanFromGrids`)는 실교사 행의 `teacherName`을 **빈 값**으로 저장한다. 결과 = 사전이 비어 초안 편집기에 교사가 이메일로 표시됨(2026-08-15 사용자 실검증에서 발견). 처방: 파생 시 그리드 lessons에서 이름을 채워 계획에 저장하고, 기존 계획은 재파생으로 교체한다.
- `subjectShorts`: ① 계획 행의 `subjectShort`가 있으면 그것 ② 없으면 `loadTimetableTerm(domain, plan.sourceTermId).subjects`에서 `normSubject(name) → shortName` 및 `normSubject(shortName) → shortName` 양쪽 등재(`solve_blank.ts:244-251`과 동일).
  `normSubject` = `(s) => s.normalize("NFC").replace(/\s+/g,"").trim().toLowerCase()` — **이미 여러 곳에 복제돼 있으니 이번에 `src/lib/timetable/validate.ts`의 것을 export해 재사용한다**(새로 세 번째 사본을 만들지 않는다).

---

## 4. 저장 모델 변경 — 초안 2필드 추가

`TimetableDraft` (`types.ts:1223`)에 **선택 필드 2개**를 더한다. 기존 초안은 두 필드가 없으므로 동작이 바뀌지 않는다(§8-6).

```ts
/** 시수 계획으로 만든 초안의 시수 원본. 없으면 종전대로 그리드에서 역산 */
hoursSnapshot?: HoursRequirement[];        // ← 이미 있음. 채우는 값이 달라진다(§4-1)
/** 시수 계획으로 만든 초안의 교육과정 고정 슬롯. 없으면 H6 검사 생략(종전 동작) */
fixedBlocksSnapshot?: FixedBlock[];        // ← 신설
/** 출처 표시용 */
sourcePlanId?: string;                     // ← 신설
```

### 4-1. `hoursSnapshot`은 **계획**이지 솔버 산출물이 아니다 🔴

현행 `createDraft`(`server.ts:5232-5237`)는 `hoursSnapshot`을 **그리드에서 역산**한다. 백지 경로에서 그대로 두면 솔버 결과 그리드에서 역산하게 되고, **솔버가 덜 배치한 시수가 스냅샷에서도 같이 빠진다.** 그러면 초안 편집 중 `loadDraftConstraintModel`(`server.ts:5366-5368`)이 그 스냅샷을 기준으로 삼아 **H1(미배정 시수)이 영원히 0으로 나온다** — 부족한 시간표가 검사를 통과해 채택까지 간다.

→ `createDraft`에 선택 인자 `hoursSnapshot?: HoursRequirement[]`, `fixedBlocksSnapshot?: FixedBlock[]`, `sourcePlanId?: string`을 추가하고, **`hoursSnapshot`이 넘어오면 그리드 역산을 건너뛴다**(`loadAllClassGrids` 재조회도 하지 않는다 — 빈 학기를 다시 읽는 낭비).

### 4-2. `loadDraftConstraintModel`에 고정 블록 싣기

`server.ts:5339`의 모델 조립에 한 줄:

```ts
...(meta.fixedBlocksSnapshot?.length ? { fixedBlocks: meta.fixedBlocksSnapshot } : {}),
```

**스냅샷을 쓰고 코호트를 다시 전개하지 않는 이유**: 매번 재전개하면 기존 그리드 기반 초안에도 없던 `fixedBlocks`가 생겨 **없던 H6 위반이 새로 터지고**, `applyDraftOp`는 신규 하드 위반을 409로 거부하므로 **멀쩡히 편집 중이던 초안이 갑자기 잠긴다.** 스냅샷은 새 초안에만 붙으므로 그런 소급이 없다.

### 4-3. `gradeDayPeriods`도 스냅샷을 따라야 하는가 — 아니다

`loadDraftConstraintModel`은 `deriveGradeDayPeriods(baseGrids)`로 파생한다. 백지 초안의 `baseGrids`는 **솔버가 만든 실물 그리드**이므로 비어 있지 않고 파생이 성립한다. 추가 필드가 필요 없다.

---

## 5. API — 새 action 1개 + 기존 1개 확장

전부 `POST /api/timetable/manage` (`src/app/api/timetable/manage/route.ts`).

### 5-1. `hours_plan_solve_input` (신설)

| | |
|---|---|
| 요청 | `{ action: "hours_plan_solve_input", planId }` |
| 처리 | `buildBlankSolveInput(domain, planId)` (§2) |
| 응답 | `{ success, action, model, teacherNames, subjectShorts, issues, stats, planLabel, termId }` |
| 권한 | 기존 `draft_model`과 동일한 가드를 그대로 적용한다 (같은 라우트의 인접 case를 복사) |

`stats` = `{ classCount, rowCount, totalHours, fixedSlotCount, droppedVirtual, cohortMissingGrades: number[] }`
- `cohortMissingGrades` = `classList`의 학년 중 `cohortForGrade`가 `null`을 준 학년. 코호트 등록부가 비면 조용히 빈 채로 진행되는 것(`cohort.ts:66`)을 화면에서 잡기 위한 것이다.

### 5-2. `draft_create` (확장)

기존 body에 3개를 **선택적으로** 더 받는다: `draftHours`, `draftFixedBlocks`, `draftPlanId` → `createDraft`의 새 인자로 전달.

서버측 검증(기존 `hours_plan_save`의 방어 수위에 맞춘다):
- `draftHours` 길이 ≤ 5000, 각 행 `hours` 1~40 정수
- `draftFixedBlocks` 길이 ≤ 100, 각 블록 `entries` ≤ 200

### 5-3. 만들지 않는 것

**`draft_model`은 손대지 않는다.** 현행 자동 작성(현행 시간표에서 다시 짜기) 경로가 그것을 쓰고 있고, 거기에 `hours`를 얹으면 워커의 백지 분기 조건(§6-1)과 뒤엉킨다. 두 경로는 서로 다른 action을 쓴다.

---

## 6. 클라이언트

### 6-1. 워커 분기 — 한 줄이 핵심 (`src/lib/timetable/solver.worker.ts:33`)

```ts
const { grids, model, seeds, localSearchIterations, teacherNames, subjectShorts } = e.data;

const blank = grids.length === 0;
if (blank && !(model.hours?.length && model.gradeDayPeriods)) {
  throw new Error("시수 계획 정보가 없어 시간표를 짤 수 없습니다.");
}

const gradeDayPeriods = model.gradeDayPeriods || deriveGradeDayPeriods(grids);
const hours = model.hours?.length ? model.hours : deriveHoursFromGrids(grids);
const sections = blank
  ? compileSectionsFromHours({ hours, model, gradeDayPeriods, teacherNames, subjectShorts }).sections
  : compileSectionsFromGrids(grids, model);
```

이후(`solveTimetablePortfolio` → `validateTimetable`)는 **한 글자도 바뀌지 않는다.** `model`이 이미 `fixedBlocks`·`hours`를 싣고 있으므로 검사기 관문이 그대로 작동한다.

`SolverWorkerRequest`(`solver.ts:1363`)에 `teacherNames?: Record<string,string>`, `subjectShorts?: Record<string,string>` 추가. `grids`는 타입 그대로 두고 **빈 배열**을 보낸다(선택 필드로 바꾸면 기존 호출부 전부가 `undefined` 분기를 떠안는다).

### 6-2. `DraftAutoTab.tsx` — 두 번째 진입점

`handleSolve`(L237)는 **그대로 둔다.** 형제 함수 `handleSolveFromPlan`을 새로 만든다.

```
① POST hours_plan_solve_input { planId }
② 확인 화면에 stats·issues 표시 → 사용자가 「이대로 짜기」를 누를 때까지 대기
③ solveTimetableInWorker({ grids: [], model, teacherNames, subjectShorts }, onProgress)
④ result.grids.length === 0 이면 "짤 수 있는 수업이 없습니다…" 로 중단
⑤ POST draft_create {
     termId: <응답의 termId>,          // ← activeTermId 가 아니다(§8-4)
     draftOrigin: { kind: "solver", seed: result.seed, ranking: result.ranking?.[0]?.seed },
     draftGrids: result.grids, draftUnplaced, draftReport: result.report,
     draftHours: model.hours, draftFixedBlocks: model.fixedBlocks, draftPlanId: planId,
   }
⑥ fetchDrafts()
```

②~③ 사이에 사용자 확인을 **반드시 끼운다.** 솔버는 수십 초 도는 작업이고, 이슈가 여러 건인 채로 돌리면 그 시간이 통째로 버려진다.

### 6-3. 계획 목록

`hours_plan_list` → `plans.filter(p => p.targetTermId === effectiveTermId)`. 0건이면 진입점을 비활성화하고 "이 학기로 지정된 시수 계획이 없습니다. 「시수 계획」에서 먼저 만들어 주세요."

---

## 7. 화면 배치와 문구

> 배치를 명시하는 이유: 스펙에 자리가 없으면 임의 배치 후 재작업이 난 전례가 있다(`AGENTS.md` §1 추가 조항).

**자리**: 「시간표 → 자동 작성」 탭 **맨 위**, 기존 「자동 작성 시작」 버튼 **위**에 시작 방법 두 개를 나란히 둔다. 새 탭을 만들지 않는다.

```
┌ 어떻게 짤까요? ───────────────────────────────┐
│ ○ 현행 시간표에서 다시 짜기   (기존 동작)      │
│ ● 시수 계획으로 새로 짜기      [계획 ▾]        │
└───────────────────────────────────────────────┘
```

- 작업 학기에 기초 시간표가 없으면 위 항목을 비활성화하고 아래를 선택해 둔다. 비활성 사유: "이 학기에는 아직 시간표가 없어 이 방법을 쓸 수 없습니다."
- 확인 화면 제목: **"짜기 전에 확인해 주세요"** / 본문 = `{classCount}개 학급 · 주 {totalHours}시간 · 교육과정 고정 {fixedSlotCount}칸`
- 이슈 블록 제목: **"확인이 필요한 점 N건"**. 0건이면 블록을 감춘다.
- `cohortMissingGrades`가 비어 있지 않으면 별도 경고: "{n}학년의 교육과정 고정 시간이 등록돼 있지 않습니다. 창체·SLAT 자리가 비게 됩니다."
- `droppedVirtual > 0`이면 안내 한 줄: "교육과정에서 자동으로 채우는 시간 {n}개는 계획 대신 교육과정 등록 내용을 씁니다."

**문구 금지 사항**(`AGENTS.md` 화면 문구 규칙): "컴파일", "섹션", "솔버", "스냅샷", "H1", "§", "9c", "컴시간", 스펙 파일명 — 전부 화면에 내보내지 않는다. 컴파일러 이슈 텍스트는 이미 사람 말로 쓰여 있으므로 그대로 표시해도 된다.

---

## 8. 함정 — 이 순서로 밟으면 걸린다

### 8-1. 🔴 섹션을 서버에서 내려보내지 말 것

`SolverSection`(`solver.ts:49`)은 **`allowedSlots: Set<string> | null`과 `bannedSlots: Set<string>`을 갖는다.** `JSON.stringify(new Set([...]))`는 `{}`다 — 서버에서 컴파일해 HTTP로 내려보내면 **배정금지 교시와 특별실 제한이 조용히 전부 사라진다.** 검사기는 위반을 잡겠지만 솔버는 이미 그 제약을 모르는 채 돌아 시간이 통째로 버려진다.

→ **서버는 `model`(전부 평범한 JSON)만 내려보내고, 컴파일은 워커에서 한다.** §2-⑩의 서버 preflight 컴파일은 `issues`만 쓰고 `sections`는 버리므로 이 함정에 걸리지 않는다. 같은 입력에 같은 결과가 나오는 순수 함수라 두 번 도는 것은 안전하다(수백 행 CPU 작업).

### 8-2. 🔴 `createDraft`는 빈 그리드에서 예외를 던진다

`server.ts:5222-5226`: `baseGrids.length === 0`이면 *"기초 시간표가 없어 초안을 생성할 수 없습니다"*. 백지 경로는 **솔버 산출 그리드를 넘기므로** 이 예외에 걸리지 않는다 — 단 §6-2-④의 빈 결과 가드를 빼먹으면 사용자가 이 개발용 문구를 그대로 보게 된다.

### 8-3. 🔴 H1 무력화 — §4-1을 다시 읽을 것

이 스펙에서 유일하게 **조용히 틀리는** 항목이다. 나머지는 전부 화면에서 즉시 드러난다.

### 8-4. `activeTermId`를 쓰지 않는다

`DraftAutoTab`은 `activeTermId`(정확히는 `effectiveTermId = workingTerm?.id || activeTermId`)를 들고 있지만, 초안을 만들 학기의 원본은 **계획의 `targetTermId`**다. 둘이 어긋난 채 진행하면 다른 학기 등록부로 짠 시간표가 만들어진다. 서버 응답의 `termId`를 그대로 쓰고, 화면의 작업 학기와 다르면 진입 자체를 막고 "이 계획은 {termId} 학기용입니다." 라고 알린다.

> 이 계열 결함이 실제로 있었다 — `0987072`(파생·저장이 `targetTermId`를 버림), `f48e443`(`simul_list`에 `termId` 누락).

### 8-5. 작업 학기는 초안 학기여야 한다

`adoptDraftToTerm`(`server.ts:6327-6330`)이 **운영 학기로의 채택을 거부**한다. 시수 계획으로 짜 놓고 마지막 단계에서 막히는 것보다, 진입 시점에 §2-②로 막는 편이 낫다.

### 8-6. 기존 초안을 건드리지 않는다

추가 필드 3개는 전부 선택이고, `loadDraftConstraintModel`의 변경은 `fixedBlocksSnapshot`이 있을 때만 발동한다. **기존 초안의 검사 결과가 한 건이라도 달라지면 그것은 구현 오류다** — §9-3에서 확인한다.

---

## 9. 완료 판정 (DoD)

작성자가 넘기기 전에 스스로 통과시킨다(`AGENTS.md` §2-①). ①②는 기계적이라 논쟁 여지가 없다.

1. `npx tsc --noEmit` · `npm run build` 통과 (빌드는 `NODE_OPTIONS="--max-old-space-size=4096"`).
2. **동치성 회귀 — 이 스펙의 핵심 관문.** 2026-2에서 파생한 시수 계획으로 `buildBlankSolveInput`을 돌린 `hours`가 `solve_blank.ts`의 `hours`와 **행 단위로 일치**해야 한다(정렬 후 비교). §3-2가 뭉텅이 필터와 실험 조건에서 동치라는 주장의 검증이다. 확인용 스크립트를 `scripts/`에 남긴다.
3. **무변경 회귀**: 기존 초안 1건을 열어 `draft_get`의 리포트가 변경 전후로 동일한지 확인(하드·소프트 건수).
4. **실전 통과**: 2027-1 초안 학기(리허설 산출물, **지우지 말 것**)에서 계획 선택 → 확인 화면 → 짜기 → 초안 생성 → 초안 편집기에서 리포트 표시까지 화면으로 완주.
5. **H1 살아 있음 확인**(§8-3 대응): 계획의 아무 행 시수를 1 올려 저장 → 다시 짜기 → 미배정이 생기면 **초안 편집기에서** H1이 잡히는지 확인. 여기서 H1이 0으로 나오면 §4-1이 구현되지 않은 것이다.

---

## 10. 이번에 하지 않는 것 (기록해 둔다 — 유실 방지)

### 10-1. 계획 행의 `simulGroupId` · `venueHours`를 컴파일러에 전달하기

`HoursPlanRow`는 동시수업 그룹 소속과 특별실 시수를 **명시적으로** 갖고 있는데(`types.ts:1029-1030`), `compileSectionsFromHours`는 그것을 받는 입구가 없어 `model.simulGroups`에서 **추정**하고 `simul-assumed`·`venue-slot-limited` 이슈를 남긴다(`solver.ts:352-356`). 즉 **정답을 손에 쥐고 추측하는** 상태가 된다.

고치려면 `BlankCompileInput`에 행 단위 힌트를 더하는 **엔진 변경**이 필요하다 — 배선 스펙의 범위를 넘고, 잘못 건드리면 `solve_blank` 증명이 무효가 된다. **9c-I-2로 분리한다.** 실전 통과 후 이슈가 실제로 몇 건 뜨는지 보고 착수 여부를 정한다.

### 10-2. 초안 학기 이외로의 채택 (§8-5), 계획 여러 개 합치기, 계획 없이 백지에서 시작하기

전부 이번 범위 밖. 필요해지면 그때 스펙을 연다.

---

## 11. 변경 파일 목록 (구현자용)

| 파일 | 변경 |
|---|---|
| `src/lib/timetable/cohort.ts` | `hoursFromPlanRows` 신설 (§3) |
| `src/lib/timetable/validate.ts` | `normSubject` export (§3-3) |
| `src/lib/timetable/types.ts` | `TimetableDraft`에 `fixedBlocksSnapshot?`·`sourcePlanId?` (§4) |
| `src/lib/timetable/solver.ts` | `SolverWorkerRequest`에 `teacherNames?`·`subjectShorts?` (§6-1) |
| `src/lib/timetable/solver.worker.ts` | 백지 분기 (§6-1) — **이 파일의 변경은 3줄이다** |
| `src/lib/timetable/server.ts` | `buildBlankSolveInput` 신설 · `createDraft` 인자 3개 · `loadDraftConstraintModel` 1줄 (§2·§4) |
| `src/app/api/timetable/manage/route.ts` | `hours_plan_solve_input` 신설 · `draft_create` 확장 (§5) |
| `src/components/admin/timetable/DraftAutoTab.tsx` | 시작 방법 선택 · `handleSolveFromPlan` · 확인 화면 (§6-2·§7) |
| `scripts/` | 동치성 확인 스크립트 (§9-2) |
