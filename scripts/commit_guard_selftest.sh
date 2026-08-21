#!/usr/bin/env bash
# 커밋 범위 가드 자가 테스트 — 임시 저장소에서 실사고 3건의 모양을 재현한다
#
# 사용법: bash scripts/commit_guard_selftest.sh
#
# **왜 자가 테스트까지 두는가**: 이 가드의 가장 그럴듯한 고장은 "막지 못하는 것"이 아니라
# **조용히 아무것도 하지 않는 것**이다. 초판이 실제로 그랬다 — bash+jq로 썼는데 이 기기에
# jq가 없어 상태 파일이 한 줄도 안 쌓였고, 커밋은 멀쩡히 통과했다(2026-08-21 실측).
# 죽은 검사는 없는 검사보다 나쁘다: 지켜지고 있다고 믿게 만든다.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  [통과] %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  [실패] %s\n' "$1"; }
check() { if [ "$1" = "0" ]; then ok "$2"; else bad "$2"; fi; }

cd "$TMP"
git init -q .
git config user.email guard@test; git config user.name guard
mkdir -p scripts .githooks src
cp "$ROOT/scripts/commit_scope_guard.sh" "$ROOT/scripts/commit_guard_record.py" scripts/
cp "$ROOT/.githooks/pre-commit" .githooks/
chmod +x scripts/commit_scope_guard.sh .githooks/pre-commit
git config core.hooksPath .githooks
printf 'base\n' > src/engine.ts; printf 'base\n' > src/screen.tsx; printf 'base\n' > notes.md
git add -A && COMMIT_GUARD_OK=1 git commit -qm init

rec() { printf '%s' "$2" | python3 scripts/commit_guard_record.py "$1"; }
claim_json() { printf '{"session_id":"%s","tool_input":{"file_path":"%s/%s"}}' "$1" "$TMP" "$2"; }

echo "── 0. 기록기가 실제로 기록하는가 (조용한 죽음 탐지) ──"
rec snapshot '{"session_id":"probe"}'
rec claim "$(claim_json probe notes.md)"
[ -s .git/commit-guard/probe.snapshot ] || [ -f .git/commit-guard/probe.snapshot ]
check $? "세션 시작 스냅샷 파일이 생긴다"
grep -qx 'notes.md' .git/commit-guard/probe.claim 2>/dev/null
check $? "편집한 파일이 기록된다"
rec committer '{"session_id":"probe","tool_input":{"command":"git commit -m x"}}'
grep -qx 'probe' .git/commit-guard/COMMITTER 2>/dev/null
check $? "커밋 주체 표시가 남는다"
rec end '{"session_id":"probe"}'
[ ! -f .git/commit-guard/probe.claim ]
check $? "세션이 끝나면 기록이 지워진다"

# 「지금 커밋하려는 것인가」 판정 — 느슨하면 경로 문자열(.git/commit-guard/…)에도 걸린다.
# 초판이 실제로 그랬다: 가드 상태를 들여다보는 명령만으로 커밋 주체가 바뀌어 버렸다.
cmd_probe() { rm -f .git/commit-guard/COMMITTER
  printf '{"session_id":"rx","tool_input":{"command":"%s"}}' "$1" | python3 scripts/commit_guard_record.py committer
  [ -f .git/commit-guard/COMMITTER ]; }
for c in 'git commit -m x' 'git add a && git commit -qm y' 'git -C /repo commit' 'git -c user.name=t commit'; do
  cmd_probe "$c"; check $? "커밋 명령으로 인식: $c"
done
# 에이전트가 보내는 명령은 여러 줄인 경우가 흔하다. 줄 앞을 안 보면 그런 커밋을 통째로 놓치고,
# 그러면 가드가 **자기 세션을 남으로 오인해** 정상 커밋을 막는다 (2026-08-21 실측).
cmd_probe 'cd /repo\ngit add a\ngit commit -m x'
check $? "커밋 명령으로 인식: 여러 줄 명령의 셋째 줄에 있는 git commit"
for c in 'ls .git/commit-guard/' 'cat .git/commit-guard/COMMITTER' 'git log --oneline' 'echo git commit'; do
  cmd_probe "$c"; [ $? -ne 0 ]; check $? "커밋이 아닌 것으로 인식: $c"
done
rm -f .git/commit-guard/COMMITTER

echo "── 1. 실사고 재현: 남이 작업 중인 파일을 add -A 로 담는다 ──"
# 세션 A가 엔진 파일을 편집 중. 그 뒤 세션 B가 시작돼 화면 파일만 고치고 전부 담는다.
rec snapshot '{"session_id":"sessA"}'
printf 'A의 미완성 작업\n' > src/engine.ts
rec claim "$(claim_json sessA src/engine.ts)"

rec snapshot '{"session_id":"sessB"}'
printf 'B의 화면 수정\n' > src/screen.tsx
rec claim "$(claim_json sessB src/screen.tsx)"
rec committer '{"session_id":"sessB","tool_input":{"command":"git commit -m \"화면 문구 수정\""}}'

git add -A
git commit -qm "B의 커밋" 2>/dev/null
[ $? -ne 0 ]
check $? "add -A 로 남의 작업 중 파일까지 담으면 커밋이 막힌다"
git log --oneline | grep -q "B의 커밋" && bad "막혔다고 했는데 커밋이 만들어졌다" || ok "커밋이 실제로 만들어지지 않았다"

echo "── 2. 자기 파일만 담으면 통과한다 (오탐 없음) ──"
git restore --staged src/engine.ts
git commit -qm "B의 커밋 (자기 파일만)" 2>/dev/null
check $? "자기가 편집한 파일만 담은 커밋은 통과한다"

echo "── 3. 상대가 Claude가 아니어도 잡는다 (스냅샷 층) ──"
# sessC 시작 시점에 engine.ts가 이미 더럽다. 누가 더럽혔는지는 알 필요가 없다.
git log --oneline >/dev/null
rec snapshot '{"session_id":"sessC"}'
printf 'C의 문서 작업\n' > notes.md
rec claim "$(claim_json sessC notes.md)"
rec committer '{"session_id":"sessC","tool_input":{"command":"git commit"}}'
git add -A
git commit -qm "C의 커밋" 2>/dev/null
[ $? -ne 0 ]
check $? "내 세션 시작 전부터 더럽고 내가 손대지 않은 파일이 담기면 막힌다"

echo "── 4. 빠져나갈 문이 있다 ──"
COMMIT_GUARD_OK=1 git commit -qm "C의 커밋 (의도적 통과)" 2>/dev/null
check $? "COMMIT_GUARD_OK=1 이면 통과한다"

echo "── 5. 기록이 없으면 아무것도 막지 않는다 (열린 실패) ──"
rm -rf .git/commit-guard
printf '수정\n' >> src/engine.ts
git add src/engine.ts
git commit -qm "기록 없는 상태" 2>/dev/null
check $? "상태 기록이 없으면 평소대로 커밋된다"

printf '\n결과: 통과 %d / 실패 %d\n' "$pass" "$fail"
[ "$fail" = "0" ] || exit 1
printf '가드가 살아 있습니다.\n'
