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
/**
 * 수신자 요약의 **재료** (2026-08-20 신설).
 *
 * **문장을 저장하지 않고 재료를 저장한다.** 이전에는 `"1학년 12명"` 같은 완성된 문장을
 * 발송 시점에 만들어 문서에 박았는데, 그러면 ⓐ 문구가 틀려도 이미 보낸 것은 못 고치고
 * ⓑ 표현을 바꾸면 옛 것과 새 것이 섞이며 ⓒ 회수로 인원이 줄어도 숫자가 옛날 그대로다.
 *
 * 재료만 저장하면 **문장은 화면에서 만든다** — 문구 변경이 옛 문서에도 즉시 반영되고,
 * 인원수는 살아 있는 `recipientCount`를 쓰므로 회수를 자동으로 따라간다.
 *
 * 저장하는 것은 **발송 시점에만 알 수 있는 것**뿐이다:
 * - `depts` — 어느 부서를 통째로 골랐나 (나중에 명단이 바뀌면 복원 불가)
 * - `firstLabel` — 개인 선택일 때 대표로 보일 이름 (발송 당시 스탬프, `senderName`과 같은 성격)
 * - `extra` — 부서 외에 개인으로 더한 인원 (참고용)
 */
export interface RecipientMeta {
  depts: string[];
  extra: number;
  firstLabel?: string;
}

export function buildRecipientMeta(chips: RecipientChip[]): RecipientMeta {
  const depts = [...new Set(chips.filter((c) => c.source === "dept" && c.deptLabel).map((c) => c.deptLabel!))];
  const extra = chips.filter((c) => c.source !== "dept").length;
  return { depts, extra, ...(chips[0]?.label ? { firstLabel: chips[0].label } : {}) };
}

/**
 * 화면에 보일 한 줄을 만든다. **여기가 문구의 단일 소재지다 — 바꾸고 싶으면 이 함수만 고친다.**
 *
 * @param meta  발송 시 저장한 재료 (없으면 옛 문서 — `fallback` 사용)
 * @param fallback  옛 문서에 저장돼 있던 완성 문장
 * @param count  **살아 있는** 수신자 수 (`recipientCount`) — 회수를 반영한다
 */
export function renderRecipientLine(
  meta: RecipientMeta | undefined | null,
  fallback: string | undefined | null,
  count: number
): string {
  if (!meta) return (fallback || "").trim() || (count > 0 ? `${count}명` : "");

  const { depts, extra, firstLabel } = meta;

  if (depts.length === 0) {
    if (!firstLabel) return count > 0 ? `${count}명` : "";
    return count > 1 ? `${firstLabel} 외 ${count - 1}명` : firstLabel;
  }
  if (depts.length === 1) {
    // 부서만 골랐으면 「1학년 11명」. 개인이 섞였으면 **부서 인원인 척하지 않는다** —
    // 「1학년 12명」은 1학년이 12명이라는 뜻으로 읽힌다(2026-08-20 사용자 지적).
    return extra > 0 ? `${depts[0]} 등 ${count}명` : `${depts[0]} ${count}명`;
  }
  return `${depts[0]} 외 ${depts.length - 1}개 부서 ${count}명`;
}

/**
 * 화면 미리보기용 — 아직 발송 전이라 `recipientCount`가 없을 때 쓴다.
 * 저장 대상이 아니다(저장은 `buildRecipientMeta`).
 */
export function previewRecipientLine(chips: RecipientChip[]): string {
  return renderRecipientLine(buildRecipientMeta(chips), null, chips.length);
}

export const buildSummary = previewRecipientLine;

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

/**
 * 서버 입력 정규화 — 클라이언트가 보낸 `recipientMeta`를 신뢰하지 않고 모양만 받아 정리한다.
 * 값이 이상하면 `undefined`를 돌려 옛 문장(`recipientSummary`) 경로로 떨어지게 한다.
 */
export function sanitizeRecipientMeta(raw: unknown): RecipientMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const depts = Array.isArray(r.depts)
    ? r.depts.filter((d): d is string => typeof d === "string" && !!d.trim()).map((d) => d.trim().slice(0, 40)).slice(0, 30)
    : [];
  const extra = typeof r.extra === "number" && Number.isFinite(r.extra) && r.extra >= 0 ? Math.floor(r.extra) : 0;
  const firstLabel = typeof r.firstLabel === "string" && r.firstLabel.trim() ? r.firstLabel.trim().slice(0, 40) : undefined;
  if (depts.length === 0 && !firstLabel) return undefined;
  return { depts, extra, ...(firstLabel ? { firstLabel } : {}) };
}
