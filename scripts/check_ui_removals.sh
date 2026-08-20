#!/usr/bin/env bash
# 화면 기능 유실 탐지 — 수정 전후로 "사라진 상호작용"을 기계적으로 뽑는다.
#
# 배경(2026-08-15): 통 이동 UI 재배선(dbb999e)이 DirectSubstituteTab을 사실상 전면 재작성하면서
# (추가 891줄 / 삭제 1816줄, onClick 39개 삭제·24개 추가) 지시에 없던 체인 기능 2건이 조용히
# 사라졌다. tsc·build는 통과한다 — 타입 검사는 "버튼이 없어진 것"을 잡지 못한다.
# 사람 눈으로 1800줄 삭제분을 읽는 것은 비현실적이므로, 없어진 것만 목록으로 뽑아 준다.
#
# 사용: bash scripts/check_ui_removals.sh <기준-커밋> [파일...]
#   예: bash scripts/check_ui_removals.sh HEAD~1
#       bash scripts/check_ui_removals.sh 2968cee src/components/admin/timetable/DirectSubstituteTab.tsx
#
# 출력에 뜬 항목이 전부 결함은 아니다(의도한 철거일 수 있다). 판정 기준은 하나다:
#   "이 삭제가 지시서에 적혀 있었나?" — 적혀 있지 않은 삭제는 전부 확인 대상이다.

set -uo pipefail

BASE="${1:-}"
if [ -z "$BASE" ]; then
  echo "사용: bash scripts/check_ui_removals.sh <기준-커밋> [파일...]" >&2
  exit 1
fi
shift

if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  mapfile -t FILES < <(git diff --name-only "$BASE" -- '*.tsx' '*.ts')
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "대상 파일 없음 (기준 $BASE 대비 변경된 .ts/.tsx 없음)"
  exit 0
fi

# mktemp 실패를 반드시 잡는다 (2026-08-20, Codex 검증 중 실측).
# set -e 가 아니라서 실패해도 계속 진행됐고, TMP 가 빈 문자열이면 아래 모든 쓰기가 조용히
# 실패하는데 FOUND 는 0으로 남아 **"사라진 상호작용 없음"을 출력했다.** 검사기가 아무것도
# 안 하고 통과 판정을 내는 것이 이 스크립트가 막으려던 사고보다 나쁘다 — 읽기 전용 샌드박스에서
# 실제로 재현됐다.
TMP="$(mktemp -d)" || {
  echo "❌ 임시 디렉터리를 만들지 못했다 — 검사를 수행하지 못했으므로 '통과'가 아니다." >&2
  exit 2
}
if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
  echo "❌ 임시 디렉터리가 비었다 — 검사를 수행하지 못했으므로 '통과'가 아니다." >&2
  exit 2
fi
trap 'rm -rf "$TMP"' EXIT
FOUND=0

# 상호작용 표면을 뽑는다: 핸들러 이름, 상태 setter 호출, 사용자에게 보이는 한글 라벨.
extract() {
  # 한글 라벨 추출은 로케일 영향을 받는다([가-힣] 범위가 collation 오류를 낸다) — 바이트 기준으로 고정하고
  # "ASCII가 아닌 글자를 포함한 태그 사이 문자열"을 사용자에게 보이는 라벨로 본다.
  {
    LC_ALL=C grep -oE '\bhandle[A-Za-z0-9_]+' "$1"
    LC_ALL=C grep -oE '\b(set|fetch|execute|run)[A-Z][A-Za-z0-9_]+\(' "$1" | tr -d '('
    LC_ALL=C grep -oE '>[^<>{}]*[^ -~][^<>{}]*<' "$1" \
      | sed 's/^>//; s/<$//; s/^[[:space:]]*//; s/[[:space:]]*$//' \
      | LC_ALL=C grep -vE '^\{|^$'
    # 속성이 여러 줄인 요소는 여는 >와 닫는 <가 다른 줄에 있어 위 패턴이 놓친다
    # (실사례: "3단계까지 넓혀 다시 탐색" 버튼). 태그·코드 기호가 없는 순수 텍스트 줄을 라벨로 본다.
    LC_ALL=C grep -E '[^ -~]' "$1" \
      | LC_ALL=C grep -vE '[<>{}=;]|^\s*(//|\*|/\*)' \
      | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
      | LC_ALL=C grep -vE '^$'
  } | LC_ALL=C sort -u
}

for f in "${FILES[@]}"; do
  git show "$BASE:$f" > "$TMP/old" 2>/dev/null || continue
  [ -f "$f" ] || { echo "‼️  파일 자체가 삭제됨: $f"; FOUND=1; continue; }

  extract "$TMP/old" > "$TMP/old.txt"
  extract "$f" > "$TMP/new.txt"
  comm -23 "$TMP/old.txt" "$TMP/new.txt" > "$TMP/gone.txt"

  added=$(git diff --numstat "$BASE" -- "$f" | cut -f1)
  removed=$(git diff --numstat "$BASE" -- "$f" | cut -f2)
  gone=$(wc -l < "$TMP/gone.txt")

  [ "$gone" -eq 0 ] && continue
  FOUND=1
  echo "── $f  (추가 ${added:-0}줄 / 삭제 ${removed:-0}줄)"
  if [ -n "${removed:-}" ] && [ -n "${added:-}" ] && [ "$removed" -gt "$added" ]; then
    echo "   ⚠️  삭제가 추가보다 많다 — 부분 수정이 아니라 재작성일 수 있다."
  fi
  echo "   사라진 항목 ${gone}건:"
  sed 's/^/     - /' "$TMP/gone.txt"
  echo
done

if [ "$FOUND" -eq 0 ]; then
  echo "✅ 사라진 상호작용 없음 (기준 $BASE)"
else
  echo "위 항목마다 물어라: 이 삭제가 지시서에 있었나? 없었다면 회귀다."
fi
