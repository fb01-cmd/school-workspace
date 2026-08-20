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

## 과제 D — 소속 없는 교사가 「업무 등록」에 들어가진 뒤 막힌다 (희망고문)

**기준 커밋**: `84d8ef5` · **사용자 실기기 신고 2026-08-20**

### 증상

교직원 조직도에 **소속이 등록되지 않은 교사** 계정으로:

- **쪽지**는 애초에 못 쓴다 — 자격 안내가 뜨고 발송이 막힌다. **올바른 동작이다.**
- **업무는 「+ 업무 등록」이 그냥 열린다.** 업무명·기한·내용을 다 채울 수 있고, **[다음] 을 눌러야 비로소 막힌다.**

사용자 표현: *"희망고문이랄까?"* **다 쓰게 해 놓고 마지막에 막는 것이 가장 나쁘다.**

### 원인 (Claude가 코드로 확인 완료 — 조사하지 말고 이대로 고쳐라)

`src/components/admin/tasks/TasksSection.tsx:1125` 의 「+ 업무 등록」 버튼에 **자격 검사가 아예 없다.**

```tsx
onClick={() => setIsComposerOpen(true)}   // 조건 없이 모달을 연다
```

사진에 보이는 분홍 경고는 화면이 미리 판단한 것이 아니라 **서버가 거절한 메시지**(`src/app/api/tasks/route.ts:87`)가 뒤늦게 표시된 것이다. 그래서 **들어간 뒤에야** 알게 된다.

**쪽지 쪽에는 이미 판정 기준이 있다** — `src/components/admin/MessagingHub.tsx:35`:

```ts
const canSend = !!userData && !!(teacherProfile?.departments && teacherProfile.departments.length > 0);
```

`TasksSection`도 **이미 `teacherProfile`을 갖고 있다**(`:73`의 `useAuth()`). 새로 불러올 것이 없다.

### 할 일

**(1) 판정을 한 곳으로 모은다.**

지금 이 판정이 `MessagingHub.tsx:35`에 있고, 여기에 또 쓰면 **두 곳이 된다.** 오늘 PC·모바일이 갈려서 생긴 사고를 이미 두 번 봤다.

- `src/lib/org/` 아래에 작은 헬퍼를 만든다. 예: `src/lib/org/eligibility.ts`
  ```ts
  /** 쪽지·업무를 보낼 자격 — 교직원 조직도에 소속이 등록돼 있어야 한다 (2026-08-20 단일화) */
  export function canUseMessaging(
    userData: unknown,
    teacherProfile: { departments?: string[] | null } | null | undefined
  ): boolean {
    return !!userData && !!(teacherProfile?.departments && teacherProfile.departments.length > 0);
  }
  ```
- **`MessagingHub.tsx:35`도 이 함수를 쓰도록 바꾼다.** 판정이 두 벌로 남으면 이 과제의 절반이 무의미하다.
- **동작은 지금과 완전히 같아야 한다.** 조건식을 바꾸지 마라, 옮기기만 해라.

**(2) 「+ 업무 등록」 버튼을 자격에 걸어 잠근다.**

`TasksSection.tsx:1124-1131`:

- 자격이 없으면 버튼을 **비활성**으로 만든다(`disabled`, 흐리게, 커서 기본).
- **왜 안 되는지와 다음에 할 일을 그 자리에서 알려준다.** 쪽지와 같은 문구·같은 동작을 쓴다:
  - 안내: `조직 정보가 등록되면 업무를 보낼 수 있습니다.`
  - 옆에 `내 조직 정보 신청 →` 버튼. 누르면 쪽지 쪽과 **똑같이** 프로필 모달을 연다:
    ```ts
    document.dispatchEvent(new CustomEvent("openMyProfileModal"))
    ```
    (참고 구현: `src/components/admin/hub/HubMemoComposer.tsx:516-529`)
- 안내를 버튼 옆이나 위에 두되 **새 컴포넌트를 만들지 마라.**

**(3) 모바일도 같은지 확인한다.**

`src/components/mobile/MobileTasksSection.tsx` 에 업무를 **등록하는** 입구가 있는지 확인해라.

- 있으면 같은 방식으로 잠근다.
- **없으면(받기 전용이면) 없다고 보고만 해라.** 없는 것을 만들지 마라.

### 하지 말 것

- **서버 검사를 없애지 마라.** 화면 잠금은 편의이고 서버가 진짜 방어선이다(`AGENTS.md` 자동완성 규칙 5번 — UI를 신뢰하지 않는다).
- 자격 조건 자체를 바꾸지 마라. **소속 1개 이상**이 기준이고 그대로다.
- 쪽지 쪽 동작을 바꾸지 마라. 지금이 맞다.
- 모달 내부(`TaskComposerModal.tsx`)를 고치지 마라. **입구를 막는 과제다.**

### 완료 확인

1. `npx tsc --noEmit` 0건.
2. **소속 있는 계정**: 「+ 업무 등록」이 종전과 똑같이 열린다. **변화 없음이 조건이다.**
3. **소속 없는 계정**: 버튼이 눌리지 않고, 안내와 「내 조직 정보 신청」이 보이며, 눌렀을 때 프로필 모달이 열린다.
4. `grep -rn "departments.length > 0" src/` — **판정이 한 곳(새 헬퍼)만 남았는지** 확인해 결과를 보고해라.
5. `bash scripts/check_ui_removals.sh 84d8ef5` — 뜬 항목마다 이 지시서에 있었는지 판정해라.
6. **실기기 확인은 Antigravity가 못 한다.** 보고에 *"실기기 미확인 — 소속 없는 계정 확인은 사용자 몫"* 을 명시해라.

### 보고할 것

- 4번 `grep` 결과를 **그대로** 붙여라. 판정이 두 곳 이상 남아 있으면 실패다.
- 모바일에 업무 등록 입구가 있었는지 없었는지 `파일:줄번호`로 답해라.
