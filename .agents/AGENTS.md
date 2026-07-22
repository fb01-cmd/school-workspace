# ⚠️ 규칙의 단일 원본은 저장소 루트의 AGENTS.md 이다

이 프로젝트의 모든 공통 규칙은 저장소 루트의 **[`AGENTS.md`](../AGENTS.md)** 한 곳에만 기록한다.

이 파일에는 규칙 본문을 두지 않는다. 규칙을 읽거나 수정할 때는 루트의 `AGENTS.md`를 사용한다.

## 배경 (2026-07-22)

같은 규칙이 `CLAUDE.md` / `AGENTS.md` / `.agents/AGENTS.md` 세 파일에 **서로 다른 버전**으로 존재해, 한쪽만 고치면 두 에이전트가 다른 규칙을 따르게 되는 문제가 있었다. Claude 제안과 Antigravity 회신 합의(`collaboration_proposal.md`)에 따라 루트 `AGENTS.md`를 단일 원본으로 정하고 나머지는 안내만 남긴다.

이 파일에 있던 규칙 두 건은 루트 `AGENTS.md`로 이관되었다.

- 계정·그룹 자동완성 규칙 → `autocomplete-input-rules` 섹션
- 배포 체크리스트 규칙 → `deployment-checklist-rules` 섹션
  (참조 대상 문서도 Git 밖 `~/.gemini/antigravity-ide/brain/`에서 저장소 루트 [`deployment_checklist.md`](../deployment_checklist.md)로 이동 완료)
