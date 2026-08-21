#!/usr/bin/env python3
"""커밋 범위 가드 — 상태 기록기 (Claude Code 훅이 stdin으로 훅 입력 JSON을 준다).

왜 있는가: 남의 작업 중 파일이 커밋에 쓸려 들어가는 사고가 세 번 났다
(2026-08-05 c6c679d · 2026-08-17 21fe37f · 2026-08-21 898a8b3). AGENTS.md §3-3이
`git add -A` 금지를 규칙으로 적어 두었지만 규칙만으로 세 번 다 못 막았다.
④-3의 "잊혀서 안 지켜지는 규칙은 자동화한다"에 따라 기계로 옮긴다.

이 파일은 **판정하지 않는다** — 판정은 scripts/commit_scope_guard.sh(pre-commit)가 한다.
여기서는 판정에 필요한 사실만 적는다:

  snapshot   세션이 시작될 때 **이미 더러웠던** 파일 목록. 내 세션이 시작되기 전부터
             수정돼 있었다면 그건 정의상 내가 만든 변경이 아니다. 이 한 줄이 상대가
             Claude가 아니어도(Antigravity·사람) 통하는 이유다.
  claim      이 세션이 실제로 편집한 파일. snapshot의 "남의 것" 판정을 뒤집는 근거이자,
             다른 Claude 세션이 내 작업 중 파일을 담는 것을 막는 근거.
  committer  지금 커밋하려는 세션. PreToolUse(Bash)가 git commit 직전에 적는다.

파이썬으로 쓴 이유: 처음엔 bash+jq로 썼는데 **이 기기에 jq가 없어 조용히 아무 일도 하지
않았다**(2026-08-21 실측). 죽은 검사가 가장 나쁘다 — 의존성을 표준 파이썬으로 낮춘다.
상태는 .git/commit-guard/ 아래 — 저장소에 커밋되지 않고 클론마다 따로 산다.
"""
import json
import os
import re
import subprocess
import sys


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        git_dir = git("rev-parse", "--absolute-git-dir").strip()
        root = git("rev-parse", "--show-toplevel").strip()
    except Exception:
        return 0  # 저장소가 아니면 할 일이 없다

    state = os.path.join(git_dir, "commit-guard")
    os.makedirs(state, exist_ok=True)

    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        payload = {}
    sid = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("session_id") or ""))
    if not sid:
        return 0

    if mode == "snapshot":
        # 세션 시작 시점에 이미 더러운 파일 = 내가 만든 것이 아니다
        lines = []
        for row in git("status", "--porcelain", "--untracked-files=all").splitlines():
            path = row[3:]
            if " -> " in path:  # 이름이 바뀐 항목은 도착지 경로가 스테이지에 오른다
                path = path.split(" -> ", 1)[1]
            if path:
                lines.append(path.strip('"'))
        with open(os.path.join(state, f"{sid}.snapshot"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))

    elif mode == "claim":
        tool_input = payload.get("tool_input") or {}
        response = payload.get("tool_response") or {}
        path = response.get("filePath") or tool_input.get("file_path") or ""
        if not path:
            return 0
        rel = os.path.relpath(os.path.abspath(path), root)
        if rel.startswith(".."):
            return 0  # 저장소 밖 파일은 커밋될 일이 없다
        with open(os.path.join(state, f"{sid}.claim"), "a", encoding="utf-8") as f:
            f.write(rel + "\n")

    elif mode == "committer":
        # git commit 직전에만 표시한다 — 이 표시가 있어야 "내 파일"과 "남의 파일"을 가릴 수 있다
        cmd = str((payload.get("tool_input") or {}).get("command") or "")
        # `git`이 **명령어 자리**에 오고 `commit`이 그 하위 명령일 때만. 느슨하게 잡으면
        # 경로 문자열(.git/commit-guard/…)에도 걸린다 — 초판이 실제로 그랬다(2026-08-21 실측).
        # 구분자에 **줄바꿈이 반드시 들어가야 한다** — 에이전트가 보내는 명령은 여러 줄인 경우가
        # 흔하고(`cd …\ngit add …\ngit commit …`), 줄 앞을 안 보면 그런 커밋을 통째로 놓친다.
        # 2026-08-21 실측: 이 누락 때문에 가드가 **자기 세션을 남으로 오인**해 정상 커밋을 막았다.
        # -C <경로> · -c <키=값> 처럼 값을 받는 전역 옵션이 앞에 붙을 수 있다.
        if re.search(
            r"(?:^|[;&|\n])\s*git\s+(?:(?:-[cC])\s+\S+\s+|-{1,2}\S+\s+)*commit\b", cmd
        ):
            with open(os.path.join(state, "COMMITTER"), "w", encoding="utf-8") as f:
                f.write(sid + "\n")

    elif mode == "end":
        for name in (f"{sid}.claim", f"{sid}.snapshot"):
            try:
                os.remove(os.path.join(state, name))
            except OSError:
                pass

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # 기록기가 커밋·편집을 방해하면 안 된다. 기록이 없으면 가드는 아무것도 막지 않는다.
        # 이 조용한 실패를 알아채는 장치가 scripts/commit_guard_selftest.sh 다.
        sys.exit(0)
