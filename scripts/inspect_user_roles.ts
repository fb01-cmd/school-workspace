/**
 * 읽기 전용 — users 컬렉션의 권한 판정 필드(role) 실태 점검.
 *
 * `verifyAuthAccess`(src/lib/firebase/admin.ts)가 문서 부재·role 부재 시
 * "teacher"로 폴백(fail-open)하던 것을 fail-closed로 바꿀 때, 그 전환이
 * 실데이터에서 누구를 잠그는지 먼저 재는 것이 목적이다.
 *
 * 재실행: npx tsx --env-file=.env.local scripts/inspect_user_roles.ts
 */
import { adminDb } from "../src/lib/firebase/admin";

const VALID_ROLES = new Set(["student", "teacher", "super_admin"]);

async function main() {
  const snap = await adminDb.collection("users").get();
  console.log(`users 문서 총 ${snap.size}건 (읽기 ${snap.size}회 소모)\n`);

  const byRole = new Map<string, number>();
  const problems: { id: string; email: string; why: string; role: unknown }[] = [];
  const emailSeen = new Map<string, string[]>();

  snap.forEach((d) => {
    const data = d.data() || {};
    const role = data.role;
    const email = (data.email || "").toLowerCase();
    const key = typeof role === "string" ? role : `(${typeof role})`;
    byRole.set(key, (byRole.get(key) || 0) + 1);

    if (email) emailSeen.set(email, [...(emailSeen.get(email) || []), d.id]);

    if (typeof role !== "string" || !VALID_ROLES.has(role)) {
      problems.push({
        id: d.id,
        email: email || "(이메일 없음)",
        why: role === undefined ? "role 필드 없음" : "role 값이 허용 목록 밖",
        role,
      });
    }
    if (!email) {
      problems.push({ id: d.id, email: "(없음)", why: "email 필드 없음", role });
    }
  });

  console.log("── role 분포 ──");
  for (const [role, n] of [...byRole.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(14)} ${n}건`);
  }

  const dups = [...emailSeen.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`\n── 같은 이메일 중복 문서 ── ${dups.length}건`);
  for (const [email, ids] of dups) console.log(`  ${email}: uid ${ids.join(", ")}`);

  console.log(`\n── fail-closed 전환 시 잠기는 문서 ── ${problems.length}건`);
  if (problems.length === 0) {
    console.log("  없음 — role 없는/이상한 문서 0건. 폴백 제거가 아무도 잠그지 않는다.");
  } else {
    for (const p of problems) {
      console.log(`  ⚠️ ${p.email} (uid ${p.id}) — ${p.why} [role=${JSON.stringify(p.role)}]`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
