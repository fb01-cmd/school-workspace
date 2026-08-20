#!/usr/bin/env bash
# 문서 점검 단일 관문 (AGENTS.md ④-1·④-4·배포 절)
#
# 규칙을 늘리는 대신 명령을 합친다 — 2026-08-20 다이어트.
# 이전에는 ④-4(유령 표기 검사)와 배포 절(check:docs)이 서로 다른 것을
# 실행해 두 규칙이 따로 놀았고, ④-1(노트 회전)은 아무도 확인하지 않아
# 150KB 규칙에 220KB가 방치돼 있었다. 셋을 한 명령으로 묶는다.
set -u
fail=0

echo "── 1/3 로드맵 상태 표기 모순 ──────────────────"
bash "$(dirname "$0")/check_roadmap_status_drift.sh" || fail=1

echo
echo "── 2/3 유령 씨앗(새 상태 표기) ────────────────"
npx tsx "$(dirname "$0")/check_ghost_markers.ts" || fail=1

echo
echo "── 3/3 대형 문서 회전 필요 여부 (④-1) ─────────"
# 한도(150KB)만 보면 **넘고 나서야 안다.** 2026-08-21에 실제로 그렇게 됐다 —
# 로드맵이 154KB로 초과해 작업 중에 발이 묶였고, 그 자리에서 항목 하나를 급히
# 압축해 겨우 통과시켰다(압축은 회전이 아니라 유실 위험이 있는 임시방편이다).
# 그래서 근접선을 하나 더 둔다: 135KB를 넘으면 미리 알려 주되 **막지는 않는다.**
#
# 경고가 커밋을 막으면 135KB가 사실상 새 한도가 되고, "넘고 나서야 안다"는
# 문제는 15KB 아래로 옮겨갈 뿐 사라지지 않는다. 경고의 값어치는 **회전을 급한
# 작업 도중이 아니라 한가할 때 하도록** 미리 알려 주는 데 있다.
LIMIT_KB=150
WARN_KB=135
for f in project_notes.md development_roadmap.md; do
  [ -f "$f" ] || continue
  kb=$(( $(wc -c < "$f") / 1024 ))
  if [ "$kb" -gt "$LIMIT_KB" ]; then
    echo "  ⚠️  $f = ${kb}KB (한도 ${LIMIT_KB}KB) — 아카이브 회전 대상 (④-1)"
    fail=1
  elif [ "$kb" -gt "$WARN_KB" ]; then
    echo "  🟡 $f = ${kb}KB (한도 ${LIMIT_KB}KB까지 $(( LIMIT_KB - kb ))KB) — 회전 준비 권고, 이번 커밋은 막지 않는다 (④-1)"
  else
    echo "  ✅ $f = ${kb}KB"
  fi
done

echo
if [ "$fail" -ne 0 ]; then
  echo "❌ 문서 점검에서 조치할 항목이 있다. 위 내용을 확인하고 처리한 뒤 커밋한다."
else
  echo "✅ 문서 점검 통과"
fi
exit $fail
