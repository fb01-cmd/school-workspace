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

## 과제 E — 「내 할 일 추가」도 잠그고, 자격 판정을 한 곳으로 모은다

**기준 커밋**: `61110a9` · Codex 검증 D-5·D-7 실패분의 후속

### 배경

`61110a9`로 「+ 업무 등록」은 잠겼다. 그런데 **같은 함정이 「내 할 일 추가」에 남아 있다** — 소속 없는 계정이 버튼을 눌러 내용을 다 쓴 뒤 서버에서 거절당한다.

**서버는 그대로 둔다 (2026-08-20 사용자 결정).** 소속 없는 계정은 셀프 할 일도 쓸 수 없는 것이 맞다. 그렇게 하려면 보안 규칙과 목록 조회까지 세 겹을 다 열어야 하는데, 그만한 일이 아니라고 판단했다. **화면을 서버에 맞추는 것이 이 과제다.**

### 할 일 (1) — 「내 할 일 추가」 버튼 잠금

| 파일 | 줄 | 지금 |
|---|---|---|
| `src/components/admin/tasks/TasksSection.tsx` | `:1228-1235` | 조건 없이 `setIsSelfAddOpen(true)` |
| `src/components/mobile/MobileTasksSection.tsx` | `:887-891` | 조건 없이 `setIsSelfAddOpen(true)` |

- 두 곳 모두 **자격 없으면 `disabled`** 로 만든다. **스타일만 흐리게 하지 마라** — 눌리면 실패다.
- `61110a9`가 「+ 업무 등록」에 한 것과 **똑같은 방식**을 쓴다(`TasksSection.tsx:1128-1145` 참고). 새 방식을 만들지 마라.
- 안내 문구는 그 버튼 성격에 맞게: `조직 정보가 등록되면 내 할 일을 쓸 수 있습니다.`
- 「내 조직 정보 신청 →」도 같이 둔다 — 같은 `openMyProfileModal` 이벤트.
- **PC와 모바일이 같은 문구·같은 동작이어야 한다.** 오늘 PC·모바일이 갈려서 난 사고가 두 번이다.

### 할 일 (2) — 자격 판정 단일화 (지금 5벌이다)

`61110a9`가 `canUseMessaging`(`src/lib/org/eligibility.ts`)을 만들었지만 **사본이 4곳 남아 있다.**

```
src/components/mobile/MobileMemoSection.tsx:50
src/components/admin/MemoSection.tsx:2142
src/components/admin/DashboardMemoPanel.tsx:47
src/components/mobile/MobileTasksSection.tsx:63
```

넷 다 이렇게 쓰여 있다:

```ts
const notEligible = !!userData && !(teacherProfile?.departments?.length);
```

**⚠️ 이것을 `!canUseMessaging(...)` 으로 바꾸지 마라. 동작이 달라진다.**

`notEligible`은 **`userData`가 아직 안 왔을 때 `false`** 다 — 즉 **로딩 중에는 경고를 띄우지 않는다.** 반면 `!canUseMessaging(null, ...)`은 `true`라서 **화면이 뜨는 순간 경고가 번쩍인다.** 이건 버그가 아니라 의도된 장치다.

**그래서 헬퍼를 하나 더 만든다.** `src/lib/org/eligibility.ts`에 추가:

```ts
/**
 * 「자격 없음」 표시 여부 — 자격 판정의 단순 반대가 아니다.
 *
 * `userData`가 아직 안 온 로딩 구간에서는 **false**를 돌려 경고가 번쩍이는 것을 막는다.
 * `!canUseMessaging(...)`으로 대체하면 그 깜빡임이 생긴다 (2026-08-20 단일화 시 확인).
 */
export function isMessagingIneligible(
  userData: unknown,
  teacherProfile: { departments?: string[] | null } | null | undefined
): boolean {
  return !!userData && !(teacherProfile?.departments?.length);
}
```

- 위 4곳이 **이 함수를 쓰게** 바꾼다. 조건식을 손으로 다시 쓰지 마라.
- **표현을 바꾸지 마라 — 옮기기만 해라.** 동작이 한 톨도 달라지면 안 된다.

### 하지 말 것

- **서버를 건드리지 마라.** `src/app/api/tasks/route.ts`의 소속 검사는 **그대로 유지**한다.
- **`firestore.rules`를 건드리지 마라.**
- 자격 조건(소속 1개 이상)을 바꾸지 마라.
- 목록 조회 게이트(`MobileTasksSection.tsx:120`·`:526`)를 건드리지 마라. **이 과제 범위가 아니다.**

### 완료 확인

1. `npx tsc --noEmit` 0건.
2. **자격 있는 계정: 아무 변화가 없다.** 두 버튼 다 종전과 똑같이 열린다. 이게 조건이다.
3. **자격 없는 계정**: 「+ 업무 등록」·「+ 내 할 일 추가」 둘 다 눌리지 않고, 안내와 「내 조직 정보 신청」이 보인다.
4. `grep -rn "departments?.length\|departments.length > 0" src/ | grep -v "lib/org/eligibility"` 를 돌려 **자격 판정 용도의 사본이 0건인지** 확인해 결과를 그대로 붙여라.
   - 목록 표시·그룹핑 용도(`TaskRecipientPickerModal` 등)는 자격 판정이 아니다. **구분해서 보고해라.**
5. `bash scripts/check_ui_removals.sh 61110a9` — 뜬 항목마다 이 지시서에 있었는지 판정해라.
6. **실기기 확인은 Antigravity가 못 한다.** 보고에 *"실기기 미확인"* 을 명시해라.

### 보고할 것

- 4번 `grep` 결과를 **그대로** 붙여라.
- PC와 모바일의 문구가 **글자까지 같은지** 각각 `파일:줄번호`로 보여라.
