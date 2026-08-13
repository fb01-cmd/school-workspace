#!/usr/bin/env bash
# development_roadmap.md 문서 상태 표기 정합성 점검 (모순 표기 탐지)
#
# 한 줄 안에 ✅와 (미착수|착수 대기|미구현)가 동시에 있고, 바로 아래 3줄 안에
# 정정 주석이 없으면 모순으로 본다.
#
# 2026-08-13 수정 (Claude) — 초판의 결함 2건:
#   ① getline으로 다음 줄을 읽어 입력 스트림을 소비했다. 한 건 걸릴 때마다 그 뒤
#      3줄이 본 규칙 검사를 통째로 건너뛰어 조용히 누락됐다(거짓 음성).
#   ② 정정 주석은 낡은 문구를 인용하느라 "미착수"와 "✅"를 둘 다 담는다. 그래서
#      정정 주석 자신이 매번 걸렸고, 정정 주석 뒤에 또 정정 주석이 올 리 없으므로
#      **항상 exit 1**이 됐다. 늘 빨간 점검은 곧 무시되는 점검이다(🔒 목록의 전철).
# → 파일을 배열로 읽어 소비 없이 앞뒤를 보고, 정정 주석 줄은 검사 대상에서 뺀다.

TARGET="${1:-development_roadmap.md}"

if [ ! -f "$TARGET" ]; then
  echo "Error: $TARGET 파일이 존재하지 않습니다."
  exit 2
fi

awk '
  { lines[NR] = $0 }
  END {
    total_top = 0
    work_top = 0
    narrative_top = 0
    missing_status = 0
    missing_count = 0

    for (i = 1; i <= NR; i++) {
      if (lines[i] ~ /^\* /) {
        total_top++
        prev = (i > 1) ? lines[i-1] : ""
        if (prev ~ /<!-- 서술 -->/) {
          narrative_top++
          continue
        }

        work_top++
        if (prev !~ /^- [^ ]+ \*\*/) {
          missing_status++
          if (missing_count == 0) {
            print "⚠️ [상태 줄 누락] 최상위 작업 항목 중 상태 줄이 없는 항목이 있습니다:"
          }
          missing_count++
          printf "  %d행: %.140s...\n", i, lines[i]
        }
      }
    }

    percent = (work_top > 0) ? int(((work_top - missing_status) / work_top) * 100) : 100
    print "상태 줄 점검: 작업 항목 " (work_top - missing_status) " / " work_top " (이행률 " percent "% / 서술 문단 " narrative_top "개 제외)"

    count = 0
    for (i = 1; i <= NR; i++) {
      # 정정 주석 자신은 검사 대상이 아니다 (낡은 문구를 인용하므로 두 표기를 다 담는다)
      if (lines[i] ~ /상태 정정/) continue
      if (lines[i] !~ /✅/) continue
      if (lines[i] !~ /(미착수|착수 대기|미구현)/) continue

      corrected = 0
      for (j = i + 1; j <= i + 3 && j <= NR; j++) {
        if (lines[j] ~ /상태 정정/) { corrected = 1; break }
      }
      if (!corrected) {
        if (count == 0) {
          print "⚠️ [상태 표기 모순] ✅와 미착수/착수 대기/미구현이 한 줄에 있는데 정정 주석이 없습니다:"
        }
        count++
        printf "  %d행: %.140s...\n", i, lines[i]
      }
    }

    if (missing_status > 0) {
      print "❌ 이행 미완료: 상태 줄이 누락된 작업 항목이 " missing_status "개 존재합니다."
      exit 1
    }

    if (count > 0) {
      print "총 " count "건. 원문을 열어 실제 상태를 확인하고, 그 줄 아래에 정정 주석을 덧붙이세요."
      print "(기존 줄은 지우지 않습니다 — AGENTS.md ④-2 append-only)"
      exit 1
    }

    print "✅ 상태 대장 이행 100% 완료 및 모순 정합성 정상."
    exit 0
  }
' "$TARGET"
