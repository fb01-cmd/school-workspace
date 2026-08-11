/**
 * 포털 접속 차단 조직단위 매칭 (coop_account_block_spec §1·§2)
 *
 * 순수 함수 — scripts/blocked_ou_selftest.ts가 회귀 검증. 판정은 서버(sync-user)에서만
 * 수행하며, 여기의 로직 변경은 인증 가드 소관(Claude 재검토)이다.
 */

/** 인프라 보호 계정 — blockedOuPaths와 무관하게 항상 통과 (AGENTS.md 인프라 계정 규칙 4).
 *  잘못된 OU 등록(예: /교직원 전체)으로 인프라 계정이 잠기는 사고를 막는 최후 방어선. */
export const PROTECTED_ACCOUNT_EMAILS = [
  "fb01@hmh.or.kr",
  "hmnotice@hmh.or.kr",
  "admin@hmh.or.kr",
];

/** OU 경로 정규화 — trim + 후행 슬래시 제거 ("/학생/공동교육/" → "/학생/공동교육") */
function normalizeOuPath(path: string): string {
  let p = (path || "").trim();
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * 계정의 orgUnitPath가 차단 목록에 걸리는가 — 정확 일치 또는 하위 OU(프리픽스+"/") 포함.
 * 빈 경로·빈 목록은 항상 통과(false).
 */
export function isBlockedOuPath(orgUnitPath: string | null | undefined, blockedList: string[]): boolean {
  const path = normalizeOuPath(orgUnitPath || "");
  if (!path || path === "/") return false;
  for (const raw of blockedList || []) {
    const blocked = normalizeOuPath(raw);
    if (!blocked || blocked === "/") continue; // 루트 등록은 무시 — 전면 차단 오등록 방어
    if (path === blocked || path.startsWith(`${blocked}/`)) return true;
  }
  return false;
}

/** 보호 계정 여부 (대소문자 무시) */
export function isProtectedAccountEmail(email: string): boolean {
  const e = (email || "").trim().toLowerCase();
  return PROTECTED_ACCOUNT_EMAILS.includes(e);
}
