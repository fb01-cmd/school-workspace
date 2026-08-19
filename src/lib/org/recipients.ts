/**
 * 쪽지·업무 수신자 칩 타입 및 요약 헬퍼 (스펙 §3, §6)
 *
 * 칩의 출처:
 * - "person": 개인 검색 또는 트리 개별 체크
 * - "dept": 부서 헤더 체크박스로 일괄 선택
 */
export interface RecipientChip {
  type?: "user";
  source: "person" | "dept";
  email: string;
  label: string;          // 이름만 (이메일 미포함)
  deptLabel?: string;     // source === "dept" 일 때 부서명 (요약 문구용)
}

/**
 * 수신자 칩 목록 요약 문구 생성
 *
 * 부서 선택 포함 시:
 * - 1개 부서: "2학년 10명"
 * - 복수 부서: "2학년 외 2개 부서 21명"
 * 개인 선택만:
 * - 1명: "홍길동"
 * - 복수: "홍길동 외 3명"
 */
export function buildRecipientSummary(chips: RecipientChip[]): string {
  if (chips.length === 0) return "";
  // 부서 헤더 선택이 하나라도 있으면 부서명 기준
  const deptChips = chips.filter((c) => c.source === "dept" && c.deptLabel);
  if (deptChips.length > 0) {
    const deptNames = [...new Set(deptChips.map((c) => c.deptLabel!))];
    const total = chips.length;
    if (deptNames.length === 1) {
      return `${deptNames[0]} ${total}명`;
    }
    return `${deptNames[0]} 외 ${deptNames.length - 1}개 부서 ${total}명`;
  }
  // 개인만이면 이름 기준
  const first = chips[0].label;
  const rest = chips.length - 1;
  return rest > 0 ? `${first} 외 ${rest}명` : first;
}

/**
 * buildRecipientSummary 의 별칭 (MemoSection 호환용)
 */
export const buildSummary = buildRecipientSummary;
