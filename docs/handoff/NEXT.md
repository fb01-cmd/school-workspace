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

## 과제 I — 글씨 크기 2단계 1묶음: 허브·쪽지·업무·조직도의 1급 정보 14px 승격

- 기준 커밋: `5d4919e`
- **시작 전에 `docs/font_size_spec.md` §2(등급)·§4(모바일 조건)·§5(2단계)를 읽어라.**

### 할 일

1. 대상 파일(이 묶음만): `src/components/admin/hub/` 전체, `src/components/admin/tasks/` 전체, `src/components/mobile/MobileTasksSection.tsx`, `src/components/admin/MemoSection.tsx`, `src/components/admin/DashboardMemoPanel.tsx`, `src/components/admin/OrgChartTree.tsx`, `src/components/admin/OrgChartBuilder.tsx`.
2. 화면에 보이는 **1급 정보**(스펙 §2 표: 사람 이름·날짜·시각·마감·상태·버튼 라벨·에러 문장·입력 필드의 값과 라벨)가 `text-xs` 이하로 렌더되는 곳을 전수 찾아 `text-sm` 이상으로 올린다.
3. 2급·3급은 손대지 않는다. 임의값 신설 금지 — 표준 클래스만.
4. 크기 승격으로 한 줄에 안 들어가는 곳은 **줄바꿈 허용 수준까지만** 고친다(`flex-wrap`, 세로 스택 전환). 구조 개편·컴포넌트 재배치는 금지 — 필요해 보이면 `파일:줄`로 보고만.
5. 판단이 애매한 자리는 한 급 위로 올리고, 올리지 않고 남긴 1급 후보는 사유와 함께 보고한다.
6. 커밋은 2~3개로 끊는다 (쪽지·허브 / 업무 / 조직도).

### 완료 확인 방법

1. `grep -rnE "text-\[[0-9](\.[0-9]+)?px\]" src/` → 0건 유지 (회귀)
2. `npx tsc --noEmit` · `npm run build` 통과
3. `bash scripts/check_ui_removals.sh 5d4919e` 결과 보고
4. 핸드오버: 승격한 곳 수 + 남긴 1급 후보 목록(사유) + 줄바꿈 처리한 곳 목록 + **"화면·모바일 미검증" 명시** (360px·실기기는 Claude·사용자 몫)

