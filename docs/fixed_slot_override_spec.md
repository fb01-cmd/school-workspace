# 창체·SLAT 배치 — 「○○학년도부터 바꾸기」 스펙 (학년도 재정의 층)

- 작성: 2026-08-21, Claude Fable (STATUS.md 「창체·SLAT 고정 슬롯」 설계 과제)
- 입력: STATUS.md 해당 행 전체 + `phase9c_questionnaire_result_2026-08-14.md` §2-1·§2-2 + `phase9c_h_spec.md` §2 + `src/lib/timetable/cohort.ts`·`types.ts` 실측
- 열린 항목의 단일 원본은 `STATUS.md`의 해당 행이다. 이 문서는 설계 본문만 담는다.

## 0. 무엇을 고치는 설계인가 — 세 문장

1. 창체·SLAT 자리는 **교육과정 축**(입학년도, `CurriculumCohort`)만으로 기록되는데, 실제 변경은 두 갈래로 온다 — ⓐ 교육과정 개정(입학년도 축, 현행 모델이 정확히 처리) ⓑ **실무협의회의 구조 결정**(학년도 축, 전 학년 즉시 적용 — 현행 모델에 담을 곳이 없다).
2. ⓑ를 기존 코호트를 **고쳐서** 담으면 지난 학년도 편성까지 소급 변경되고 이력이 사라지며, **새 코호트로** 담으면 1학년부터 3년에 걸쳐 스며들어 틀린 결과가 된다.
3. 그래서 코호트 축은 그대로 두고, 그 위에 **「○○학년도부터 적용」 재정의 층**을 얹는다 (STATUS 행의 「설계 요구 한 줄」 그대로).

같은 교육과정 안의 **학년별 차등**(고3의 SL이 실사례 — STATUS 🟡 행)도 이 층이 담는다. `phase9c_questionnaire_result` §2-1의 미이행 조건 *"학년 단위를 기본 축으로 하되, 데이터 모델은 학급 단위 예외를 막지 않는다"* 를 이 층이 이행한다(학급 단위는 §7-3).

## 1. 데이터 모델

`src/lib/timetable/types.ts`에 추가:

```ts
/** 창체·SLAT 배치의 학년도 재정의 층 (fixed_slot_override_spec §1).
 *  코호트 축(교육과정)이 기본값이고, 이 재정의가 「○○학년도부터」 그 위를 덮는다.
 *  gradeSlots에 키가 있는 학년만 덮는다 — 키 없는 학년은 코호트를 그대로 따른다.
 *  저장은 학년별 전체 사본이다(차분 아님 — 9c-H §0-2와 같은 원칙). */
export interface FixedSlotOverride {
  id: string;
  /** "2027학년도 창체 수요일 이동" — 사람이 붙임. 화면 문구에 「재정의」·「오버라이드」 금지 */
  label: string;
  /** 이 학년도부터 적용. 끝 학년도는 없다 — 더 나중의 재정의가 나오면 그것이 대신한다 */
  effectiveFromSchoolYear: number;
  /** 학년(1~3) → 그 학년의 고정 슬롯 전체 사본. 빈 배열 [] = "이 학년은 고정 슬롯 없음"(의미 있는 값) */
  gradeSlots: Record<number, FixedSlotOverrideGrade>;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

export interface FixedSlotOverrideGrade {
  /** 작성 시점(effectiveFromSchoolYear 기준)에 이 학년이 따르던 교육과정 id.
   *  서버가 저장 시 직접 계산해 찍는다 — 클라이언트 값을 믿지 않는다.
   *  해석 시점에 실제 교육과정과 다르면 이 재정의는 그 학년에 적용하지 않는다(§2 부적용 규칙). */
  basedOnCohortId: string | null;
  slots: CohortFixedSlot[];   // 기존 타입 재사용 — displayName·day·period
}
```

**모델 결정 4가지와 근거**

1. **학년별 전체 사본이지 차분(패치)이 아니다.** "창체만 수요일로" 같은 부분 수정을 이름 키로 표현하면 h_spec §2-2 규칙 1(*"이름을 키로 삼지 않는다"*)을 어긴다. 전체 사본은 9c-H §0-2(*"저장은 파생 시점의 전체 사본"*)와 같은 원칙이고, 입력 부담은 화면이 **현재 적용값을 미리 채워** 없앤다(§5).
2. **학년 키가 3월 함정을 되살리지 않는다.** 함정의 정체는 **학년도 없는 학년 표기**였다("1학년: 금5·6"은 해마다 뜻이 바뀐다). 여기 학년 키는 `effectiveFromSchoolYear`에 묶인 **(학년도 × 학년) 좌표**라 뜻이 고정된다 — 사용자가 증언한 실제 의사결정 축 그대로다.
3. **`basedOnCohortId`가 낡은 재정의의 무단 적용을 막는다.** 재정의는 만료일 없이 계속 살기 때문에, 몇 년 뒤 교육과정 개정이 오면 "옛 구조 기준으로 만든 재정의"가 새 교육과정 학년에 조용히 적용될 수 있다 — 3월 함정과 같은 종류의 **조용히 틀리는** 경로다. 작성 당시 교육과정을 찍어 두고, 달라지면 **적용하지 않고 알린다**(§2). 자동 교정이 아니라 fail-loud다(9c-D 철칙과 같은 방향).
4. **끝 학년도(endSchoolYear)를 두지 않는다.** 코호트 해석(`cohortForGrade`)과 동형으로 "그 이하 중 가장 최근 것"이 이긴다. 종료 개념이 필요하면 새 재정의를 만들면 된다 — 필드가 둘이면 겹침·빈틈 검증이 따라붙는다.

## 2. 해석 규칙 — 단일 소재지는 `cohort.ts`

`src/lib/timetable/cohort.ts`에 추가. **이 함수 밖에서 재정의 적용 여부를 판정하지 않는다** (학년 역산과 같은 단일 소재지 원칙).

```ts
export interface ResolvedGradeSlots {
  slots: CohortFixedSlot[];
  source:
    | { kind: "override"; overrideId: string; label: string }
    | { kind: "cohort"; cohortId: string; label: string }
    | { kind: "none" };
  /** 최신 재정의가 있었으나 교육과정 불일치로 적용하지 않은 경우 — 화면·사전점검 안내용 */
  skippedOverride?: { overrideId: string; label: string };
}

export function resolveFixedSlots(
  cohorts: CurriculumCohort[],
  overrides: FixedSlotOverride[],
  schoolYear: number,
  grade: number
): ResolvedGradeSlots
```

판정 순서 — (학년도, 학년) 하나에 대해:

1. **후보** = `active`이고 `effectiveFromSchoolYear <= schoolYear`이고 `gradeSlots[grade]`가 있는 재정의.
2. 후보 중 `effectiveFromSchoolYear`가 **가장 큰 것 하나**를 고른다. 동점은 저장 검증(§4)이 막으므로 없다.
3. 고른 재정의의 `basedOnCohortId`를 `cohortForGrade(cohorts, schoolYear, grade)?.id ?? null`과 비교한다.
   - **일치** → 그 재정의의 `slots` 사용. `source.kind = "override"`.
   - **불일치** → **적용하지 않는다.** 더 오래된 재정의로 내려가지도 않는다(그쪽은 더 낡았다). 코호트로 폴백하고 `skippedOverride`에 기록한다.
4. 재정의가 없거나 부적용이면 → 기존 그대로 `cohortForGrade(...).fixedSlots`, 그것도 없으면 `{ kind: "none" }`.

**전개 함수 연결**: `expandCohortFixedBlocks(cohorts, schoolYear, classList, termId)`에 `overrides` 인자를 추가하고, 학년별 슬롯을 `cohort.fixedSlots` 대신 `resolveFixedSlots(...)`로 얻는다. 반환형(FixedBlock[])과 그룹핑·정렬·라벨 로직은 그대로 — **컴파일러·솔버는 이 변경을 모른다**(cohort.ts 머리말의 경계 원칙 유지). 호출부 3곳 전부 갱신: `server.ts:8155`(자동 작성) · `HoursPlanTab.tsx:490` · `AssignmentHoursModal.tsx:975`.

**사전점검 통지 2가지** (자동 작성 `server.ts` §8-1 stats 계열):

- `cohortMissingGrades`의 판정을 `cohortForGrade === null`에서 **`resolveFixedSlots(...).source.kind === "none"`**으로 바꾼다 — 재정의가 슬롯을 주는 학년은 더 이상 누락이 아니다(빈 배열 `[]`도 "고정 슬롯 없음"이라는 유효한 답이다).
- `overrideSkips` 신설: 학년별 `skippedOverride` 수집. 문구 예: *"「2027학년도 창체 수요일 이동」은 1학년에 적용되지 않았습니다 — 만들 당시와 지금의 1학년 교육과정이 다릅니다. 창체·SLAT 배치 화면에서 확인해 주세요."* (확인 목록 출구 규칙 — 이동할 곳을 문구에 넣는다.)

## 3. 소급 금지 — 지난 학년도는 건드릴 수 없게 만든다

STATUS 행의 요구 *"지난 학년도 편성은 불변"* 을 두 겹으로 지킨다.

1. **구조로**: 이미 짠 시간표(편성)는 저장된 결과물이고 재전개되지 않는다. 전개는 초안(draft) 학기의 자동 작성 때만 일어난다 — 현행 그대로.
2. **규칙으로**: 재정의는 **`effectiveFromSchoolYear ≥ 현재 학년도`일 때만 저장·수정·삭제할 수 있다.** 서버 검증(§4)이 막는다.
   - 이미 저장된 재정의의 `effectiveFromSchoolYear`가 현재 학년도보다 **작으면** 그 문서는 수정·삭제·비활성화 전부 거부한다(읽기 전용 이력). 앞으로 바꾸고 싶으면 새 재정의를 만든다.
   - 현재 학년도 값(예: 2026학년도에 effectiveFrom 2026)은 수정 가능하다 — 운영 중 학년도의 초안 작업에 필요하고, 확정된 편성은 어차피 저장본이라 흔들리지 않는다.
   - **현재 학년도 계산은 3월 시작 기준**이다(KST, 1·2월은 전년도 학년도). `CurriculumCohortTab.tsx:22`가 `new Date().getFullYear()`를 쓰고 있어 1~2월에 한 해 어긋난다 — 이번 구현에서 학년도 헬퍼를 하나 두고(클라이언트·서버 공용, cohort.ts) 그 줄도 함께 고친다.

**코호트 원본(`CurriculumCohort.fixedSlots`) 수정은 막지 않는다** — 오타·착오 정정 경로로 남긴다. 대신 화면 문구로 길을 가른다: 코호트 수정 진입부에 *"자리를 옮기기로 결정된 것이라면 여기서 고치지 말고 「○○학년도부터 바꾸기」를 쓰세요 — 여기서 고치면 지난 학년도 화면 표시도 함께 바뀝니다."* (하드 차단하지 않는 이유: 잠그면 정당한 정정까지 막히고, 지난 편성의 실체는 저장본이라 실피해가 제한적이다.)

## 4. 저장 모델·API·검증

**저장**: `timetable_curriculum_cohorts/{domain}/overrides/{overrideId}` — 코호트와 같은 도메인 문서 아래 형제 서브컬렉션. 함께 로드된다.

**API** — `/api/timetable/manage`에 action 추가 (코호트 3종과 동형, 감사 로그 포함):

| action | 본문 |
|---|---|
| `cohort_override_list` | `{}` |
| `cohort_override_save` | `{ override }` — 신규·수정 겸용, 전체 교체. **`basedOnCohortId`는 서버가 계산해 덮어쓴다** |
| `cohort_override_delete` | `{ overrideId }` |

**서버 검증** (`validateOverrideInput`, cohort.ts — `validateCohortInput`과 나란히):

- `label` 1~60자
- `effectiveFromSchoolYear` 정수, **현재 학년도 이상**, 2200 이하 (§3-2)
- `gradeSlots` 키는 1~3, **최소 1개** — 키 없는 재정의는 아무것도 안 하는 문서다
- 학년별 `slots`: 빈 배열 허용(의미 있음) · 최대 50칸 · `displayName` 1~30자 · `day` 1~5 · `period` 1~9 · 같은 학년 안 `(day, period)` 중복 금지 (코호트 검증과 동일 잣대)
- **충돌 금지**: 같은 `effectiveFromSchoolYear`의 다른 `active` 재정의와 **학년 키가 겹치면** 거부 — 해석 2단계의 "가장 큰 것 하나"가 항상 유일하도록
- 수정·삭제 대상의 저장된 `effectiveFromSchoolYear`가 현재 학년도 미만이면 거부 (§3-2)

## 5. 화면 — 「창체·SLAT 배치」 탭 안 (Antigravity 몫)

기존 `CurriculumCohortTab.tsx`에 얹는다. 새 메뉴를 만들지 않는다.

**⑴ 맨 위 — 「지금은 어떻게 되나」 (해석 결과 보기)**
학년도 선택(기본 = 현재 학년도) + 학년별로: 최종 슬롯 미니 격자 + 출처 한 줄(*"○○ 교육과정에 따름"* / *"「2027학년도 창체 수요일 이동」에 따름"*). `skippedOverride`가 있으면 그 학년에 경고 줄. 이 블록이 이 화면의 안전장치다 — 기존 역산 안내문("○학년도 기준 ○학년에 적용")의 확장이고, **등록자가 자기가 무엇을 바꾸는지 눈으로 확인**한다는 h_spec §2-5 원칙 그대로다.

**⑵ 가운데 — 기존 교육과정 카드들** (변경 없음. §3의 안내 문구 한 줄만 수정 진입부에 추가)

**⑶ 아래 — 「학년도별 변경」 목록 + [+ ○○학년도부터 바꾸기]**
- 카드: label · "○○학년도부터" · 담긴 학년의 미니 격자 · 지난 학년도 것은 수정·삭제 버튼 비활성 + 사유 문구
- 편집기: ① 적용 학년도(현재 학년도 이상만) ② 학년 체크(기본 전 학년 — STATUS 행의 "기본 전 학년, 학년 한정 가능") ③ 체크된 학년마다 격자, **그 학년도의 현재 적용값이 미리 채워진 채** 시작(전체 사본 입력 부담 제거) ④ 학년마다 캡션 *"이 학년도의 N학년은 ○○ 교육과정을 따릅니다"*
- 격자 조작은 기존 코호트 편집과 동일(눌러서 켜고 끄기, 이름 기본값 "창체")

**문구 규칙**: 「재정의」·「오버라이드」·「코호트」 화면 노출 금지. 쓰는 말은 **「학년도별 변경」·「○○학년도부터 바꾸기」·「교육과정」** 계열. 안내 예: *"실무협의회에서 창체·SLAT 자리를 옮기기로 했다면, 어느 학년도부터인지 정해 여기에 등록하세요. 지난 학년도 기록은 그대로 남습니다."*

## 6. 실사례 대입 — 이 모델이 STATUS의 두 사례를 담는가

**ⓐ 구조 결정** (*"창체를 수요일로, 다음해부터"*): 재정의 1건 — effectiveFrom 다음 학년도, 전 학년 체크, 미리 채워진 격자에서 창체만 이동. **전 학년 즉시 적용**되고(코호트 신설처럼 3년 걸리지 않음), 지난 학년도는 그대로다. 교육과정 혼재기(개정 1~2년차)라도 학년마다 자기 교육과정 기준 값이 미리 채워지므로 SLAT 유무 차이가 뭉개지지 않는다.

**ⓑ 학년별 차등 — 고3의 SL** (STATUS 🟡 행, 이 설계의 입력 자료): 재정의 1건 — 3학년만 체크. 학교가 고르는 것에 따라 둘 다 표현된다:
- 칸을 계속 잡아 두되 정직하게: `{3: [SL(자율) 수6, SL(자율) 수7, 창체 금5, 창체 금6]}` — 창체(동아리, 실제 운영)와 빈 시간이 **다른 이름으로 분리**된다(깨지는 조건 ⓑ 해소)
- 칸을 비워 실수업·보충에 쓰기: 3학년 슬롯에서 SL 두 칸을 빼면 솔버가 그 칸을 쓸 수 있다(깨지는 조건 ⓒ 해소). 요일·교시를 옮기는 것(조건 ⓐ)도 격자에서 그대로
- **어느 쪽으로 할지는 학교(사용자) 결정**이다 — 이 스펙은 표현 수단까지만 만든다(`system-informs-not-mediates`). 결정은 STATUS 「결정 대기」 행에서 일괄 처리.

**ⓒ 교육과정 개정**: 지금처럼 새 코호트 추가. 재정의 불요. 개정이 재정의 있는 학년에 도달하면 `basedOnCohortId` 불일치로 재정의가 **소리 내며 비켜난다**(§2 부적용 + 통지) — 새 교육과정의 자기 슬롯이 적용되고, 구조 결정을 이어갈지는 사람이 새 재정의로 정한다.

## 7. 하지 않는 것 (이유 포함)

1. **시수 계획(HoursPlan) 안으로 스냅샷하지 않는다.** `gradeDayPeriods`는 계획 소속 스냅샷이지만, 슬롯은 전개 시점(자동 작성)에 살아 있는 등록부에서 읽는 현행 유지. 소급 문제는 §3의 학년도 게이트가 이미 막고, 초안 작업 중에는 **최신 결정이 반영되는 쪽이 오히려 맞다.** 계획 스키마 변경·마이그레이션도 아낀다.
2. **슬롯 이름 키 패치·부분 병합 없음.** §1 결정 1.
3. **학급 단위 예외는 지금 만들지 않는다 — 막지도 않는다.** 실사례가 학년 단위까지다(고3). 필요해지면 `CohortFixedSlot`(재정의 쪽)에 선택 필드 `classNums?: number[]`를 **추가만** 하면 되고(전개가 이미 학급 단위 entries를 만들므로 필터 한 줄), 기존 데이터 마이그레이션이 없다. §2-1의 *"막지 않는다"* 는 이 추가 가능성으로 충족된다.
4. **코호트 데이터 마이그레이션 없음.** 재정의 컬렉션은 빈 채로 시작하고, 하나도 없으면 동작이 현행과 완전히 같다(회귀 위험 최소).
5. **`FixedBlock`(수동 일괄 배정 등록부)과 합치지 않는다.** 그건 학기 소속 수동 등록부고 이건 학년도 축 자동 전개 원본이다 — questionnaire §2-1의 "재사용하려다 뒤섞지 않는다"와 같은 취지.

## 8. 구현 순서와 몫 (h_spec §3 관례)

| # | 항목 | 몫 | 선행 |
|---|---|---|---|
| 1 | `types.ts` 타입 + `cohort.ts`의 `resolveFixedSlots`·`validateOverrideInput`·학년도 헬퍼 + `expandCohortFixedBlocks` 확장 + `scripts/cohort_selftest.ts` 케이스 추가 | **Claude** | — |
| 2 | 서버: 컬렉션 로드·저장(`basedOnCohortId` 서버 스탬프)·API 3종·감사 로그 + `server.ts` 자동 작성 배선(전개 인자·`cohortMissingGrades` 판정 교체·`overrideSkips` 통지) | **Claude** (§1-2 — 판정·소급 게이트가 구조 핵심) | 1 |
| 3 | 화면 §5 (⑴ 해석 결과 보기 · ⑶ 학년도별 변경 편집기 · 문구) + `CurriculumCohortTab.tsx:22` 학년도 계산 교체 | Antigravity | 1·2 |
| 4 | Codex 커밋 검증 (§1-4) — 특히 해석 규칙 §2와 검증 §4의 대조 | Codex | 2·3 |

자가 테스트에 넣을 최소 케이스: 재정의 없음=현행 동일 / 전 학년 재정의 적용 / 학년 한정(다른 학년은 코호트 폴백) / 빈 배열=슬롯 없음 / 같은 학년도 겹침 거부 / 나중 학년도 재정의가 이전 것을 대체 / `basedOnCohortId` 불일치 부적용+`skippedOverride` / 코호트 없는 학년에 재정의만 있는 경우 / 지난 학년도 저장·수정·삭제 거부 / 1·2월 학년도 계산.
