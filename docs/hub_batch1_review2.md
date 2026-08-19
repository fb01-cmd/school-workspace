# 배치 1 후속 수정 — 2차 검수 결과

> **검수**: 2026-08-19 Claude (Opus 5) · **대상 커밋**: `a70e052`·`8d9cc1b`·`bbbb56d`
> **원본**: [`docs/hub_batch1_review.md`](./hub_batch1_review.md)
> **결론**: 결함 1·2·3·5·7 해소. **4·6은 미완**이고, 결함 1에는 **처방이 못 덮은 구멍 2개**가 남았다.

## 해소 확인 (다시 손대지 마라)

| 결함 | 확인한 것 |
|---|---|
| **1** 부서 출처 | **파생으로 제대로 바뀌었다.** `deptSources` 상태가 사라졌고, 컴포저가 `deptEmails.every(e => selectedEmails.has(e))`로 매번 계산한다 — `MemoSection` 패턴 그대로. 검수 표의 A(부분 해제)·C(전교 선택)·D(업데이터 안 setState)가 실제로 해소됐다 |
| **2** 초안 삭제 | 선택 비우기에 확인 1회가 붙었다(`MessagingHub:141-143`). 작성 중 내용이 있을 때만 뜬다 |
| **3** 포커스 | `sr-only peer` + `peer-focus-visible:ring-2` — 키보드 포커스가 보인다. 진짜 `<input>`과 `indeterminate` effect 존치 |
| **5** 미등록 부서 펼침 | `structuredTree` 기준으로 돌게 바뀌었고, 「소속 없으면 전부 접힘」도 유지 |
| **7** 죽은 코드 | `allDeptMembers` 제거. 동작 변화 없음(원래 같은 배열이었다) |
| 범위 밖 | 결함 8·판단 A·B **손대지 않았다** — 지시 준수 |

---

## 미완 1 (중) — 결함 4: 팝오버와 트리가 **여전히** 어긋난다. 방향만 뒤집혔다

`HubOrgTree.tsx:617` — 팝오버가 부서별 표시로 바뀐 것은 맞다(잘했다). 그런데 조건이 **`!!popoverTeacher.deptHeadMap?.[d]` 하나뿐**이라 **단일 부서 폴백이 빠졌다.**

| 위치 | 조건 |
|---|---|
| 트리 행 `:510-512` | `!!deptHeadMap?.[deptName] \|\| (departments?.length === 1 && !!isDeptHead)` |
| 정렬 `sort.ts:39-43` | 같음 |
| **팝오버 `:617`** | **`!!deptHeadMap?.[d]` 만** ← 어긋난다 |

**재현**: `departments: ["국어과"]` · `isDeptHead: true` · `deptHeadMap: {}` 인 레거시 프로필 → **트리에는 배지가 뜨고 정렬도 최상단인데, 이름을 눌러 연 팝오버에는 배지가 없다.** 이런 프로필이 실재한다는 증거는 `ProfileApprovals.tsx:140`의 `deptHeadMap: ... || {}` 폴백과 `sort.ts`의 "단일 부서 isDeptHead 폴백" 주석이다.

**지시**: `:617`을 트리·정렬과 **같은 조건**으로 맞춰라.
```
!!popoverTeacher.deptHeadMap?.[d] || (popoverTeacher.departments?.length === 1 && !!popoverTeacher.isDeptHead)
```
세 지점이 같아지는 것이 결함 4의 목적이다. **한쪽만 바꾸면 불일치가 사라지지 않는다.**

---

## 미완 2 (중) — 결함 6: [다시 시도] 경로에 가드가 **하나도 없다**

`HubOrgTree.tsx:387` — `onClick={() => fetchProfiles()}` 로 **인자 없이** 부른다. 그런데 가드는 전부 `signal?.cancelled` 형태다(`:143·147·151·154`). `signal`이 `undefined`면 옵셔널 체이닝이 `undefined`(falsy)를 내므로 **모든 가드가 무력화된다.**

결과: 검수 문서가 명시한 시나리오 — *"[다시 시도]를 빠르게 두 번 누르면 먼저 시작한 요청의 늦은 응답이 나중 결과를 덮어쓸 수 있다"* — 가 **그대로 재현된다.** 재시도 중 언마운트해도 `setProfiles`가 호출된다(마운트 effect의 `signal`은 재시도 호출과 공유되지 않는다).

> **⚠️ 이 항목은 커밋 메시지가 사실과 다르다.** `bbbb56d`는 *"Restore cancelled guard in fetchProfiles (unmount/retry race defense)"* 라고 적었는데, **retry 방어는 실제로 없다.** 방어되는 것은 마운트 1회 경로뿐이다.
>
> 이건 이 저장소가 규칙으로 막아온 바로 그 형태다 — **"고쳤다는 주장"과 실제가 어긋나는 것**(AGENTS.md §1-1). 다음부터 커밋 메시지에 방어 범위를 적을 때는 **그 경로를 실제로 짚어보고** 적어라.

**지시**: 호출자에게 `signal` 전달을 맡기는 설계가 근본 원인이다. **`useRef`로 요청 시퀀스를 컴포넌트 레벨에 두고 `fetchProfiles` 내부에서 자체 발급·대조하게** 바꿔라. 그러면 어디서 부르든 방어된다.

**확인 방법**: DevTools에서 요청을 느리게 만든 뒤 [다시 시도]를 연타해, 나중 응답이 이전 응답을 덮어쓰지 않는지 본다.

---

## 결함 1이 못 덮은 구멍 2개 (새로 발견)

파생 전환 자체는 맞다. 다만 **파생의 입력이 트리와 다르다.**

### 1-A (중) — 재직 필터가 안 걸린 명단으로 부서 소속을 계산한다

`HubOrgTree.tsx:148` — `onProfilesLoaded?.(items)` 가 **필터 전 원본**을 부모에 넘긴다. 트리는 `activeEmails`로 퇴직·전출자를 걸러 그리는데(`:170`), 컴포저의 `deptEmailsMap`(`HubTaskComposer:113-122`)은 **그 필터 없이** `profiles`로 만든다.

**결과**: 어떤 부서에 **잔존 프로필이 한 건이라도 있으면**, 화면에는 N-1명이 보이고 사용자가 그 전원을 담아도 `deptEmailsMap`에는 N명이 있어 `every()`가 **영원히 false**다 → 그 부서는 **부서 요약이 절대 안 나온다.** 개인 나열로 조용히 떨어진다.

**가설이 아니다** — 잔존 프로필 정리(전출 교사 자동 삭제)가 아직 열려 있는 항목이고, `activeEmails` 필터가 존재하는 이유 자체가 그것이다.

**지시**: `onProfilesLoaded`가 **필터를 통과한 명단**을 넘기게 한다(트리가 그리는 것과 같은 집합). 컴포저는 이름 조회·부서 소속 둘 다 그 집합만 쓰면 된다.

### 1-B (경, 별건이라 판단 필요) — 개인이 섞이면 부서 인원수가 사실과 달라진다

`src/lib/org/recipients.ts:29-36` — 부서 칩이 하나라도 있으면 `total = chips.length`를 그대로 쓴다. 그래서 **1학년 전원(11명) + 타 부서 1명**을 담으면 요약이 **`1학년 12명`** 이 된다. 1학년은 11명이다.

**⚠️ 이 함수는 기존 쪽지 화면(`MemoSection`)도 쓴다** — 허브만의 문제가 아니고, 고치면 기존 화면의 요약 문구도 바뀐다. **문구 결정이 필요하므로 사용자 판단 대기로 둔다.** 후보: `1학년 외 1명` · `1학년 11명 외 1명` 등.

### 1-C (경) — 파생 블록이 두 벌이다

`HubTaskComposer:110-158`과 `HubMemoComposer`의 같은 블록이 **거의 동일한 45줄**이다. 스펙 §6이 사본을 줄이려고 `src/lib/org/`로 추출해 둔 흐름과 반대다. **`src/lib/org/recipients.ts`에 `deriveRecipientChips(...)`로 추출**하고 두 컴포저가 부르게 하라.

---

## 잔여 경미 2건

| # | 위치 | 내용 |
|---|---|---|
| a | `HubOrgTree.tsx:501-505` | `members.length === 0` 삼항이 도달 불가(`:201`에서 `sorted.length > 0`일 때만 push). 결함 7을 절반만 이행 |
| b | `HubOrgTree.tsx:220-221` | 펼침 effect 의존성이 `structuredTree.length`라 **부서 개수는 같은데 구성이 바뀌는 경우**(부서명 개명 등)를 못 잡는다. `structuredTree.map(t => t.deptName).join("|")` 같은 안정 키로 |

---

## 순서

1. **1-A(재직 필터)** — 결함 1의 이득을 무효로 만드는 구멍이라 최우선.
2. 결함 4·6 — 둘 다 "고쳤다고 했는데 안 고쳐진" 항목이다.
3. 1-C(사본 추출) · 잔여 a·b.
4. **1-B는 사용자 회신 전까지 손대지 마라** (기존 쪽지 화면이 함께 바뀐다).

---

## 추가 (실기기 신고 — 2026-08-19) : 시간표 카드도 색 헤더다

> 사용자: *"쪽지는 흰톤이고 시간표는 여전히 헤더가 파랑이야"*

**결함 2(홈 카드 톤 통일)의 미완이다. 지시서가 파일 하나만 지목한 탓이지 구현 잘못이 아니다.**

색 헤더를 쓰는 홈 카드가 **둘**이었다 — `DashboardMemoPanel`(고쳐짐)과 **`MyTimetableCard`(안 고쳐짐)**. 두 파일의 헤더 클래스가 **글자 그대로 같다**: `bg-gradient-to-r from-indigo-950 to-indigo-900`.

**지시**: `src/components/admin/MyTimetableCard.tsx`에 **원본 지시서 2번과 똑같은 처방**을 적용한다.

- 색 헤더(`:66`) 제거 → 다른 홈 카드와 같은 흰 배경 + 균일 패딩
- 컨테이너 라운딩 `:64`의 `rounded-xl` → **`rounded-2xl`** (`DashboardMemoPanel:94`·`DashboardTaskCard:106`과 일치)
- 헤더 한 줄에 제목·배지·부제·버튼을 몰아넣은 `flex flex-wrap justify-between` 구조를 푼다 — 좁은 폭에서 먼저 깨지는 지점
- **시간표 표 자체(`:120~`)는 건드리지 마라.** 헤더와 컨테이너만이다

**전수 대조 결과 홈 카드 중 남은 것은 이 하나뿐이다.** 다른 색 헤더(`ClassroomCleanupTab`·`UsageDashboardTab`·`PWAInstallGuideTab`·`TeacherPortalSection`·`StudentTimetableCard`)는 **별도 메뉴 안이라 이 통일의 범위가 아니다** — 건드리지 마라.

**확인 방법**: 교사 홈에서 「내 할 일」·「이번 주 내 시간표」·「받은 쪽지」·「오늘의 급식」 네 카드의 헤더 톤과 모서리가 같다. 창을 800px로 줄여도 시간표 카드 헤더가 안 깨진다.
