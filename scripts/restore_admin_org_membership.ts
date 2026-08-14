/**
 * 관리자·시험 계정을 조직도 「휴직 교사」로 복구 (2026-08-14)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/restore_admin_org_membership.ts          # 드라이런
 *   APPLY=1 npx tsx --env-file=.env.local scripts/restore_admin_org_membership.ts  # 실제 적용
 *
 * 경위: 2026-08-13 계정 정리(`43fed0b`, `scripts/execute_account_cleanup_20260813.ts`)가
 *       admin@·admin2@·admin3@·tteacher@ 를 「휴직 교사」에서 빼고 `noDept: true`로 만들었다.
 *       트리아지 §4가 이 배치를 "임시 배치 → 정리 대상"으로 적어 둔 탓인데, **그 배치는
 *       정리 대상이 아니라 의도된 것**이다 — 쪽지가 조직도 소속을 요구하므로, 관리 계정이
 *       조직도 밖이면 쪽지를 시험할 수 없다.
 *
 * 사용자 확정(2026-08-14): **쪽지 기능이 다 구현될 때까지 관리 계정은 「휴직 교사」에 둔다.**
 *       시험할 것이 많아 조직도 안에 있어야 한다. 쪽지 완성 후 다시 뺀다.
 *
 * ⚠️ 이 배치를 다시 "정리"하지 말 것. 정리하려면 쪽지 완성 여부를 먼저 확인한다.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { snapshotBeforeDestruction } from "./lib/firestoreBackup";

const DEPT = "휴직 교사";
const TARGETS = ["admin@hmh.or.kr", "admin2@hmh.or.kr", "admin3@hmh.or.kr", "tteacher@hmh.or.kr"];

async function run() {
  const apply = process.env.APPLY === "1";
  const snap = await adminDb.collection("teacher_profiles").get();

  const hits = snap.docs.filter((d) => {
    const e = String((d.data() as any).email || d.id).toLowerCase();
    return TARGETS.includes(e);
  });

  console.log(`대상 ${hits.length}건 / 지정 ${TARGETS.length}건\n`);
  const todo: { ref: FirebaseFirestore.DocumentReference; email: string; before: string[] }[] = [];

  for (const d of hits) {
    const x = d.data() as any;
    const email = String(x.email || d.id);
    const before: string[] = x.departments || [];
    const already = before.includes(DEPT) && x.noDept !== true;
    console.log(`  ${email.padEnd(24)} depts=${JSON.stringify(before)} noDept=${x.noDept} ${already ? "→ 이미 정상, 건너뜀" : "→ 복구 대상"}`);
    if (!already) todo.push({ ref: d.ref, email, before });
  }

  if (todo.length === 0) {
    console.log(`\n복구할 것이 없다.`);
    return;
  }

  if (!apply) {
    console.log(`\n(드라이런 — 실제로 바꾸려면 APPLY=1 을 붙여라)`);
    console.log(`적용 시: departments = ["${DEPT}"], noDept = false 로 설정한다.`);
    return;
  }

  // 되돌릴 수 있게 먼저 스냅샷 (docs/backup_restore_spec.md §2-A)
  await snapshotBeforeDestruction(adminDb, ["teacher_profiles"], "restore_admin_org_membership");

  for (const t of todo) {
    await t.ref.update({ departments: [DEPT], noDept: false });
    console.log(`  복구됨: ${t.email}  ${JSON.stringify(t.before)} → ["${DEPT}"]`);
  }
  console.log(`\n완료 ${todo.length}건. 화면에서 조직도·쪽지 접근이 열리는지 확인할 것.`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
