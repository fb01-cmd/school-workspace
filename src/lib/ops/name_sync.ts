// 표시이름 동기화 — GWS 실명을 단일 원본으로 플랫폼 사본(teacher_profiles.name·users.name)을 맞춘다
// (2026-08-19 피드백 22·23번: 낡은 이름 1건 + 빈 이름 18건 실사고 — 수동 정정을 daily-sync 자동화로 승격)
//
// 원칙: GWS에 이름이 없으면 건드리지 않는다(임의 생성 금지). 대상은 이름 필드뿐 —
// 다른 프로필 필드는 조직도 화면이 원본이다. 과거 발송분의 스탬프 이름은 불변(원장 원칙).
import { adminDb } from "@/lib/firebase/admin";
import { listUsersInOUs } from "@/lib/google/workspace";
import { computeNameSyncPlan } from "./name_sync_logic";

export interface NameSyncResult {
  checkedProfiles: number;
  checkedUsers: number;
  updated: number;
  /** 로그 가독용 — "email: from→to" 최대 10건 */
  samples: string[];
}

export async function runNameSync(opts: { dryRun?: boolean } = {}): Promise<NameSyncResult> {
  const [profSnap, userSnap, gwsUsers] = await Promise.all([
    adminDb.collection("teacher_profiles").get(),
    adminDb.collection("users").where("role", "in", ["teacher", "super_admin"]).get(),
    listUsersInOUs(["all"]),
  ]);
  const gwsNames = new Map<string, string>();
  for (const u of gwsUsers) {
    const em = (u.primaryEmail || "").toLowerCase();
    const n = (u.name?.fullName || "").trim();
    if (em && n) gwsNames.set(em, n);
  }
  const plan = computeNameSyncPlan({
    profiles: profSnap.docs.map((d) => ({ email: d.id, name: (d.data() as any).name })),
    users: userSnap.docs.map((d) => ({ id: d.id, email: (d.data() as any).email, name: (d.data() as any).name })),
    gwsNames,
  });
  if (!opts.dryRun) {
    for (const item of plan) {
      const col = item.kind === "profile" ? "teacher_profiles" : "users";
      await adminDb.collection(col).doc(item.id).update({ name: item.to });
    }
  }
  return {
    checkedProfiles: profSnap.size,
    checkedUsers: userSnap.size,
    updated: plan.length,
    samples: plan.slice(0, 10).map((i) => `${i.email}(${i.kind}): ${JSON.stringify(i.from)}→${JSON.stringify(i.to)}`),
  };
}
