#!/usr/bin/env bash
# development_roadmap.md 문서 상태 표기 정합성 점검 (모순 표기 탐지)
# 한 줄 안에 ✅와 (미착수|착수 대기|미구현)가 동시에 존재하는 모순 줄을 탐지합니다.

TARGET="development_roadmap.md"

if [ ! -f "$TARGET" ]; then
  echo "Error: $TARGET 파일이 존재하지 않습니다."
  exit 1
fi

# 정정 주석(> **[... 상태 정정 ...)으로 해명되지 않은 모순 줄 탐지
UNHANDLED_DRIFTS=$(awk '
  /✅/ && /(미착수|착수 대기|미구현)/ {
    line_num = NR;
    line_content = $0;
    has_correction = 0;
    
    # 다음 3줄 이내에 정정 주석이 달렸는지 확인
    for (i = 1; i <= 3; i++) {
      if ((getline next_line) > 0) {
        if (next_line ~ /> \*\*\[.*상태 정정/) {
          has_correction = 1;
        }
      }
    }
    
    if (!has_correction) {
      print line_num ":" line_content;
    }
  }
' "$TARGET")

if [ -n "$UNHANDLED_DRIFTS" ]; then
  echo "⚠️ [상태 표기 모순 탐지] 아래 라인에서 ✅ 표기와 미착수/착수 대기/미구현 표기가 정정 주석 없이 동시에 존재합니다:"
  echo "$UNHANDLED_DRIFTS"
  COUNT=$(echo "$UNHANDLED_DRIFTS" | wc -l)
  echo "총 $COUNT 건의 미정정 모순 표기가 발견되었습니다."
  exit 1
else
  echo "✅ [상태 표기 정합성 정상] 모순된 상태 표기가 없거나 모두 정정 주석으로 해명되었습니다."
  exit 0
fi
