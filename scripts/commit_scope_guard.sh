#!/usr/bin/env bash
# 커밋 범위 가드 — 남의 작업 중 파일이 커밋에 쓸려 들어가는 것을 막는다 (pre-commit)
#
# ── 왜 (실사고 3회) ───────────────────────────────────────────
#  2026-08-05 `c6c679d`  Claude의 문서 커밋이 Antigravity 작업 중 파일 52줄을 담아 이력 오염
#  2026-08-17 `21fe37f`  같은 실수로 화면 700줄이 **미검수 상태로 배포**
#  2026-08-21 `898a8b3`  화면 문구 수정 커밋이 다른 세션의 검사기·엔진 7파일 1,016줄을 담았고,
#                        그 트리는 컴파일되지 않는데 메시지에는 "tsc 0건"이 적혀 나갔다
# AGENTS.md §3-3이 `git add -A` 금지를 규칙으로 적어 둔 지 오래인데 세 번 다 못 막았다.
# 규칙이 세 번 안 지켜졌으면 규율 문제가 아니라 구조 문제다(④-3: 잊혀서 안 지켜지면 자동화한다).
#
# ── 무엇을 보는가 ─────────────────────────────────────────────
# 스테이지에 올라온 파일 하나하나에 대해 두 가지를 묻는다.
#   ① 다른 세션이 **지금 편집 중**인 파일인가         (claim — 상대가 Claude일 때)
#   ② 내 세션이 시작되기 **전부터 더러웠던** 파일인가  (snapshot — 상대가 누구든)
#      단 그 뒤 내가 실제로 편집했으면 내 것이다(claim이 뒤집는다).
# ②가 이 가드의 핵심이다. 상대(Antigravity·사람)가 아무 협조를 하지 않아도 잡힌다 —
# 내 세션이 시작되기 전에 더러웠다면 그건 정의상 내가 만든 변경이 아니기 때문이다.
#
# ── 안 잡히는 경우 (정직하게 적어 둔다) ───────────────────────
#  · 내 세션이 시작된 **뒤에** 비(非)Claude 에이전트가 편집을 시작한 파일 → ①②에 모두 안 걸린다.
#  · 기록 자체가 없을 때(훅 미설치·jq 없음) → 아무것도 막지 않는다(열린 실패).
# 완벽한 그물이 아니라 **세 번 난 사고의 모양을 정확히 막는 그물**이다.
#
# 통과시켜야 할 정당한 이유가 있으면: COMMIT_GUARD_OK=1 git commit ...
set -uo pipefail

# 가드 자체의 버그로 커밋이 통째로 막히지 않게, 예상 못 한 실패는 경고만 남기고 통과시킨다.
# 다만 **조용히** 통과하지는 않는다 — 죽은 검사가 가장 나쁘다(2026-08-21 일지 교훈).
bail() { printf '커밋 범위 가드: %s — 검사를 건너뜁니다\n' "$1" >&2; exit 0; }

[ "${COMMIT_GUARD_OK:-}" = "1" ] && exit 0

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)" || bail "저장소를 찾지 못했습니다"
DIR="$GIT_DIR/commit-guard"
[ -d "$DIR" ] || exit 0   # 기록이 없으면 판정할 근거가 없다

FRESH_HOURS="${COMMIT_GUARD_FRESH_HOURS:-12}"
NOW="$(date +%s)" || bail "시각을 읽지 못했습니다"
CUTOFF=$(( NOW - FRESH_HOURS * 3600 ))

STAGED="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null)" || bail "스테이지를 읽지 못했습니다"
[ -n "$STAGED" ] || exit 0

mtime_of() { date -r "$1" +%s 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }

# ── 커밋 주체(me) 판정 ────────────────────────────────────────
# PreToolUse(Bash) 훅이 git commit 직전에 적어 둔 표시. 5분보다 낡았으면 다른 커밋의 잔재다.
ME=""
if [ -f "$DIR/COMMITTER" ]; then
  MT="$(mtime_of "$DIR/COMMITTER")"
  if [ "$MT" -gt $(( NOW - 300 )) ]; then ME="$(head -n1 "$DIR/COMMITTER" 2>/dev/null || true)"; fi
fi

# ── 살아 있는 기록 수집 ──────────────────────────────────────
CONFLICT=0
REPORT=""
REPORTED=""   # 이미 보고한 파일 — 두 층에 다 걸린 파일을 두 번 적지 않는다
add_conflict() { CONFLICT=1; REPORT="${REPORT}$1"$'\n'; }

for CLAIM in "$DIR"/*.claim; do
  [ -e "$CLAIM" ] || continue
  SID="$(basename "$CLAIM" .claim)"
  [ "$SID" = "$ME" ] && continue                    # 내 것은 내가 담는 게 정상이다
  [ "$(mtime_of "$CLAIM")" -lt "$CUTOFF" ] && continue   # 오래된 기록은 유령이다
  HITS="$(grep -Fxf <(printf '%s\n' "$STAGED") "$CLAIM" 2>/dev/null | sort -u || true)"
  [ -n "$HITS" ] || continue
  AGO=$(( (NOW - $(mtime_of "$CLAIM")) / 60 ))
  REPORTED="${REPORTED}${HITS}"$'\n'
  add_conflict "  [다른 세션 ${SID:0:8} — ${AGO}분 전까지 편집 중]
$(printf '%s\n' "$HITS" | sed 's/^/    · /')"
done

# 내 세션이 시작되기 전부터 더러웠고, 그 뒤 내가 한 번도 편집하지 않은 파일
if [ -n "$ME" ] && [ -f "$DIR/$ME.snapshot" ]; then
  MINE="$DIR/$ME.claim"
  [ -f "$MINE" ] || MINE=/dev/null
  PRE="$(grep -Fxf <(printf '%s\n' "$STAGED") "$DIR/$ME.snapshot" 2>/dev/null | sort -u || true)"
  if [ -n "$PRE" ]; then
    UNTOUCHED="$(printf '%s\n' "$PRE" | grep -Fxv -f "$MINE" 2>/dev/null || printf '%s\n' "$PRE")"
    # 위 claim 층에서 이미 이름을 댄 파일은 다시 적지 않는다 (같은 파일이 두 번 나오면 읽기 어렵다)
    if [ -n "$(printf '%s' "$REPORTED" | sed '/^$/d')" ]; then
      UNTOUCHED="$(printf '%s\n' "$UNTOUCHED" | grep -Fxv -f <(printf '%s\n' "$REPORTED" | sed '/^$/d') 2>/dev/null || true)"
    fi
    UNTOUCHED="$(printf '%s' "$UNTOUCHED" | sed '/^$/d')"
    [ -n "$UNTOUCHED" ] && add_conflict "  [내 작업 시작 전부터 수정돼 있었고 내가 손대지 않은 파일]
$(printf '%s\n' "$UNTOUCHED" | sed 's/^/    · /')"
  fi
fi

[ "$CONFLICT" = "0" ] && exit 0

cat >&2 <<EOF

━━━ 커밋을 멈췄습니다 — 남의 작업 중 파일이 담겨 있습니다 ━━━

$REPORT
이 파일들은 **다른 세션이 만들고 있던 변경**으로 보입니다. 그대로 커밋하면
그 세션의 미완성 코드가 내 커밋 메시지를 달고 올라가고, 컴파일되지 않는 트리가
이력에 남습니다 (2026-08-21 898a8b3에서 실제로 일어났습니다).

  할 것: git restore --staged <위 파일들>  로 빼고 내 파일만 다시 담으세요.
         'git add -A' / 'git add .' 대신 바꾼 파일을 하나씩 적습니다 (AGENTS.md §3-3).

  정말 내 것이 맞다면: COMMIT_GUARD_OK=1 git commit ...
  (그렇게 통과시켰다면 왜 그랬는지 커밋 메시지에 한 줄 남기세요.)

EOF
exit 1
