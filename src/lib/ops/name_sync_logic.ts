// 표시이름 동기화 — 순수 계획 수립 (피드백 22·23번). 네트워크·Firestore 무의존 —
// 셀프테스트(scripts/name_sync_selftest.ts)가 직접 임포트한다. 실행부는 name_sync.ts.

export interface NameSyncPlanItem {
  kind: "profile" | "user";
  id: string; // profile = 이메일(doc id), user = users doc id
  email: string;
  from: string;
  to: string;
}

/**
 * 빈 이름(23번)과 GWS와 다른 이름(22번)을 모두 잡는다.
 * GWS에 이름이 없으면 건드리지 않는다(임의 생성 금지).
 */
export function computeNameSyncPlan(params: {
  profiles: { email: string; name?: unknown }[];
  users: { id: string; email?: unknown; name?: unknown }[];
  gwsNames: Map<string, string>;
}): NameSyncPlanItem[] {
  const plan: NameSyncPlanItem[] = [];
  for (const p of params.profiles) {
    const email = p.email.toLowerCase();
    const cur = typeof p.name === "string" ? p.name.trim() : "";
    const real = (params.gwsNames.get(email) || "").trim();
    if (!real || cur === real) continue;
    plan.push({ kind: "profile", id: email, email, from: cur, to: real });
  }
  for (const u of params.users) {
    const email = typeof u.email === "string" ? u.email.toLowerCase() : "";
    if (!email) continue;
    const cur = typeof u.name === "string" ? u.name.trim() : "";
    const real = (params.gwsNames.get(email) || "").trim();
    if (!real || cur === real) continue;
    plan.push({ kind: "user", id: u.id, email, from: cur, to: real });
  }
  return plan;
}
