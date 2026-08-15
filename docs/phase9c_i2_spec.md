# Phase 9c-I-2 — 계획 행 힌트 직접 전달 스펙 (2026-08-15, Claude Fable 5)

> 근거: [`phase9c_i_spec.md`](./phase9c_i_spec.md) §10-1 (분리 사유 원문) · 2026-08-15 사용자 피드백(*"일과계 피드백을 받아볼 게 아니면 확인이 필요하다고 접근하면 안 되지"*)
> 목표 한 줄: **컴파일러가 "정답을 손에 쥐고 추측하는" 상태를 끝낸다.** 확인 모달의 고지성 이슈(현재 20건 안팎)를 실측 기준 한 자릿수 이하로.

---

## 0. 구조 — 힌트는 3층으로 흐른다

```
ⓐ 파생 자동 채움      그리드 실증(lesson.simul 라벨·lesson.room 스탬프) → 계획 행에 기록
ⓑ 사용자 편집(기존재)  HoursPlanTab의 동시수업 드롭다운·특별실 시수 칸 — 이미 있다
ⓒ 컴파일러 신뢰       힌트 있으면 그대로 쓰고(이슈 없음), 없으면 종전 추정 + 이슈 (완전 하위호환)
```

**ⓐ가 이 스펙의 발견이다.** 계획의 원천인 2026-2 그리드는 로드 시점에 동시수업 라벨(`applySimulMarks` — 슬롯+과목 대조 스탬프, `simul.ts:51`)과 특별실(`applyVenueMarks`)이 **이미 판정되어 붙어 있다.** 어느 과목이 그룹 몫인지(3-8 물Ⅱ vs 화Ⅱ 같은 애매 사례 포함) 그리드가 정확히 알고 있으므로, 파생이 그걸 계획에 옮기면 사용자 수작업 태깅 없이 힌트가 완비된다. ⓑ는 신규 입력·수정용 보조 경로가 된다.

**힌트 필드는 이미 저장 모델에 있다**: `HoursPlanRow.simulGroupId`(저장 검증 `server.ts:6094` — 그룹 실재 확인)·`venueHours`(≤ hours 검증). 지금은 컴파일러로 가는 길이 없을 뿐이다.

---

## 1. 타입 — `HoursRequirement`에 힌트 2필드 (types.ts:1108)

```ts
export interface HoursRequirement {
  grade: number;
  classNum: number;
  subjectName: string;
  teacherKey: string;
  hours: number;
  /** 9c-I-2 힌트 — 동시수업 그룹 소속 (계획 행에서 전달, 없으면 컴파일러가 종전대로 추정) */
  simulGroupId?: string | null;
  /** 9c-I-2 힌트 — hours 중 특별실 점유 시수 (없으면 종전대로 전 시수 보수 처리) */
  venueHours?: number | null;
}
```

- **검사기(validateTimetable)는 이 필드를 읽지 않는다** — H1/H4 대조 키는 (grade, classNum, subjectName, teacherKey)이고 바뀌지 않는다. 힌트는 컴파일 전용.
- `deriveHoursFromGrids` 산출물에는 이 필드가 없다(undefined) → 그리드 기반 경로·기존 스크립트 전부 무변경.

## 2. `hoursFromPlanRows` — 패스스루 (cohort.ts)

`toHoursRequirement`에 두 줄 추가: `simulGroupId: row.simulGroupId ?? null`, `venueHours: row.venueHours ?? null`. 키 규약(§3-1)은 불변.

## 3. 파생 자동 채움 — `deriveHoursPlanFromGrids` (server.ts)

`targetTermId`가 있을 때만 수행한다(힌트의 참조 대상이 **대상 학기 등록부**이므로).

```
① targetGroups = loadSimulGroups(domain, targetTermId)   ← 승계 후의 그룹 (라벨은 원본과 동일 복사)
② 그리드 순회하며 행 키(grade-classNum|normSubject)별 실증 수집:
   - simulLabel: lesson.simul이 붙은 placement가 하나라도 있으면 그 라벨
   - roomCount: lesson.room이 비어 있지 않은 placement 수
③ 행 생성 시:
   - simulGroupId = targetGroups에서 label 일치 && grade 일치 && classNums 포함인 그룹의 id
     (일치 그룹 없으면 null — 승계 전이거나 그룹 미생성. 침묵이 맞다: ⓒ 폴백이 종전 동작)
   - venueHours   = roomCount가 0 < n ≤ hours 이면 n, 아니면 null
```

- `loadAllClassGrids`가 이미 로드 시점에 마크를 스탬프하므로(파생은 이 로더를 쓴다) 추가 조회는 `loadSimulGroups` 1회뿐.
- ⚠️ **라벨 대조이지 그룹 id 대조가 아니다** — 그리드 스탬프는 원본 학기 그룹으로 찍혔고, 계획이 가리켜야 하는 것은 대상 학기 그룹이다. 승계 복사가 라벨을 보존하므로 라벨이 다리다. 같은 라벨의 그룹이 대상 학기에 둘이면(비정상) 첫 번째를 쓰고 채움을 포기하지 않는다 — 저장 검증이 실재만 보므로 안전.

## 4. 컴파일러 — `compileSectionsFromHours` (solver.ts)

### 4-1. ①′ 동시수업: 태그 우선, 학급 단위 폴백

현행 ①(solver.ts:474~)의 구조는 유지하고 **부분집합 탐색만 대체**한다:

- 후보 수집은 종전대로(grade·classNums·subjectNames 매치). 그다음 학급별로:
  - **태그 학급** (`simulGroupId === g.id`인 행이 1개 이상): 그 학급의 그룹 몫 = **태그 행 전부.** 부분집합 탐색 생략. 합 ≠ h이면 새 이슈 `simul-tag-mismatch`(조치성)를 남기고 **그 학급만 태그를 무시하고 종전 탐색으로 폴백**(그룹 전체를 죽이지 않는다).
  - **무태그 학급**: 종전 부분집합 탐색.
- **열 배정(교사 겹침 백트래킹)은 그대로 필요하다** — 태그는 소속을 말할 뿐 열 분배를 말하지 않는다. 탐색 공간만 준다.
- 이슈 규칙: **전 학급이 태그로 확정되면 `simul-assumed`를 내지 않는다** (모달에서 사라진다 — 이 스펙의 목표 지점). 일부만 태그면 무태그 학급만 언급하는 문구로 낸다.
- 행의 `simulGroupId`가 `model.simulGroups`(활성)에 없는 id를 가리키면: 새 이슈 `simul-tag-unknown`(조치성 — "계획이 가리키는 동시수업 그룹이 이 학기에 없습니다. 등록부 승계 여부를 확인해 주세요") + 그 행은 태그 없는 것으로 취급.

### 4-2. ③′ 특별실: `venueHours`로 정밀 분할

잔여 일반 섹션(③) 생성 시, `roomFor` 매치가 있고 행에 `venueHours`가 있으면:

| venueHours | 처리 |
|---|---|
| `null` (무힌트) | 종전 — 전 시수 실 점유, restricted면 `venue-slot-limited` 이슈 |
| `== hours` | 전 시수 실 점유, **이슈 없음** (명시 확인됨) |
| `0 < n < hours` | **섹션 분할**: 실 섹션(`bplain-v:`, n시간, room·allowedSlots 적용) + 일반 섹션(`bplain-f:`, hours−n, room 없음). 이슈 없음 |

- 연속수업 규칙과의 결합: 블록은 전체 시수 기준으로 파싱(`parseBlockLens(pattern, hours)`)한 뒤 **큰 블록부터 실 섹션에 배분**한다(실측 통례: 2연속 = 특별실 수업). 배분이 나누어떨어지지 않으면(블록 경계가 n과 어긋남) 실 섹션 몫을 블록 경계로 올림하고 그 사실을 `venue-hours-block-adjust`(고지성) 이슈로 남긴다.
- `venueHours`가 있는데 `roomFor` 매치가 없으면: `venue-hours-no-group`(조치성 — "계획에 특별실 시수가 적혀 있지만 이 학기 특별실 등록부에 해당 항목이 없습니다") + 힌트 무시.
- 분할된 두 섹션은 같은 과목이므로 같은 날에 겹치면 S4 — **이미 넣은 S4 내부 가중(×4)이 자연 분산시킨다.** 별도 장치 불요.

### 4-3. 이슈 코드 유니언 확장 (solver.ts `BlankCompileIssue`)

신설 4종: `simul-tag-mismatch` · `simul-tag-unknown` · `venue-hours-no-group` (조치성) / `venue-hours-block-adjust` (고지성).

## 5. 화면 — 이슈 분류 세트 갱신 (DraftAutoTab.tsx)

`handlingCodes`(고지성)에 `venue-hours-block-adjust` 추가. 나머지 신설 3종은 보수 세트(complement)라 자동으로 "짜기 전에 살펴볼 점"에 들어간다 — **코드 수정 1줄.** 문구는 §4의 한국어 문안을 그대로 쓰되 화면 문구 규칙(개발 용어 금지) 준수.

선택(경미): HoursPlanTab 파생 완료 안내에 "동시수업 소속 n개 수업·특별실 시간 m개 수업을 자동 인식했습니다" 한 줄.

## 6. 하지 않는 것

- 컴파일러가 힌트 **없이** 동작하는 경로의 변경 — 추정 로직·이슈 문구 전부 불변 (하위호환이 회귀 관문이다).
- `deriveHoursFromGrids`(그리드 역산)에 힌트 추가 — 그리드 경로는 섹션을 그리드에서 직접 컴파일하므로 힌트가 무의미.
- 슬롯 제한형 특별실의 "몇 시간이 어느 슬롯인지"까지 지정 — venueHours는 총량 힌트다. 슬롯 배정은 솔버 몫.

## 7. 완료 판정 (DoD)

1. `npx tsc --noEmit` · `npm run build`.
2. **폴백 무변경 회귀**: 힌트 없는 입력(현행 [2027-1] 계획을 힌트 제거 사본으로)에서 섹션 통계·이슈 목록이 개정 전과 동일.
3. **재파생 실측**: [2027-1] 계획 재파생 → 자동 채움 수 보고(동시수업 태그 행 수·venueHours 행 수) → `hours_plan_solve_input`의 이슈에서 **`simul-assumed` 0건** 확인, 고지성 총량 실측 보고.
4. **품질 유지**: 전체 포트폴리오 솔브 — 하드 0 · 미배정 0 · S4 1건 수준 · 소프트 총점 35±α.
5. 재파생 계획으로 화면 한 바퀴(확인 모달 → 짜기 → 초안) — 사용자 또는 실브라우저.

## 8. 분업

| 조각 | 담당 |
|---|---|
| §1~4 (타입·패스스루·파생 자동 채움·컴파일러 ①′③′) | **Claude (Fable)** — 백트래킹·섹션 분할은 엔진 코어, §1-2 직접 구현 영역 |
| §5 (이슈 분류 세트·파생 안내 문구·화면 문구 검수) | **Antigravity** |
| §7-3~5 실측·화면 검증 | Claude 실측 + 사용자/Antigravity 화면 |
