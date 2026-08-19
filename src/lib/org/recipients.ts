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

import type { TeacherProfile } from "@/context/AuthContext";
import { resolveDisplayName } from "@/lib/org/displayName";

/**
 * 선택된 이메일 목록과 교직원 프로필로부터 수신자 칩 목록을 파생 계산
 * (부서 전원이 선택된 경우 source: "dept", 그 외에는 source: "person")
 * - 1-C 추출 (HubTaskComposer & HubMemoComposer 공통)
 */
export function deriveRecipientChips(
  selectedEmails: Set<string>,
  profiles: TeacherProfile[],
  profileMap: Map<string, TeacherProfile>,
  gwsNameMap: Map<string, string>
): RecipientChip[] {
  // 1. 부서→이메일 멤버십 맵 구축
  const deptEmailsMap: Record<string, string[]> = {};
  profiles.forEach((p) => {
    const email = (p.email || "").toLowerCase();
    if (!email || !p.departments || p.departments.length === 0 || p.noDept) return;
    p.departments.forEach((d) => {
      if (!deptEmailsMap[d]) deptEmailsMap[d] = [];
      deptEmailsMap[d].push(email);
    });
  });

  // 2. Map<email, chip> — 이메일 키로 중복 제거
  const chipMap = new Map<string, RecipientChip>();

  // 2a. 부서 전체 선택된 것 먼저 — "dept" source로 삽입
  Object.entries(deptEmailsMap).forEach(([deptName, deptEmails]) => {
    const allIn = deptEmails.length > 0 && deptEmails.every((e) => selectedEmails.has(e));
    if (allIn) {
      deptEmails.forEach((e) => {
        const p = profileMap.get(e);
        const name = resolveDisplayName(e, p, gwsNameMap.get(e)).name;
        chipMap.set(e, {
          type: "user",
          source: "dept",
          email: e,
          label: name,
          deptLabel: deptName,
        });
      });
    }
  });

  // 2b. 부서 전체가 아닌 개인 선택 — 이미 Map에 있으면 덮어쓰지 않음
  selectedEmails.forEach((email) => {
    if (chipMap.has(email)) return;
    const p = profileMap.get(email);
    const name = resolveDisplayName(email, p, gwsNameMap.get(email)).name;
    chipMap.set(email, {
      type: "user",
      source: "person",
      email,
      label: name,
    });
  });

  return [...chipMap.values()];
}
