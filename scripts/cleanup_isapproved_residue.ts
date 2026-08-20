/**
 * users 문서에 남은 `isApproved` 잔재 필드 일괄 제거.
 *
 * 경위: `isApproved`는 이름과 달리 "워크스페이스 관리자인가"를 담고 있어 권한 판정에 오용된
 * 전력이 있고(쪽지가 수퍼어드민 전용이 돼 있었다), 2026-08-13에 **권한 판정의 단일 원본을
 * `role` 하나로** 확정하며 폐기했다. `sync-user`가 로그인할 때 `FieldValue.delete()`로 지우지만
 * 그 뒤 로그인하지 않은 계정에는 그대로 남아 있다(2026-08-21 실측: 29건 중 25건).
 *
 * 지금은 읽는 곳이 0곳이라 무해하나, 남겨 두면 다음 사람이 "쓰이는 필드"로 오해해 관문에
 * 다시 배선할 수 있다 — 그것이 원래 사고의 경로였다. 그래서 지운다.
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/cleanup_isapproved_residue.ts           # 목록만 (기본)
 *   npx tsx --env-file=.env.local scripts/cleanup_isapproved_residue.ts --apply   # 실제 삭제
 *
 * `--apply`일 때만 실행 직전 스냅샷을 남긴다 (docs/backup_restore_spec.md §2-A).
 * 비용: users 문서 수만큼 읽기(약 29건).
 */
import { adminDb } from "../src/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { snapshotBeforeDestruction } from "./lib/firestoreBackup";

const APPLY = process.argv.includes("--apply");

async function run() {
  const snap = await adminDb.collection("users").get();

  const targets = snap.docs
    .map((d) => ({ id: d.id, v: d.data() as Record<string, any> }))
    .filter((x) => "isApproved" in x.v || "status" in x.v);

  console.log(`users 문서 ${snap.size}건 중 정리 대상 ${targets.length}건\n`);

  if (targets.length === 0) {
    console.log("정리할 것이 없다.");
    return;
  }

  console.log("이메일".padEnd(34) + "role".padEnd(14) + "isApproved".padEnd(12) + "status");
  console.log("-".repeat(74));
  for (const t of targets) {
    console.log(
      String(t.v.email ?? "(이메일 없음)").padEnd(34) +
        String(t.v.role ?? "(없음)").padEnd(14) +
        ("isApproved" in t.v ? String(t.v.isApproved) : "—").padEnd(12) +
        ("status" in t.v ? String(t.v.status) : "—")
    );
  }

  // 지우는 것은 이 두 필드뿐이라는 것을 눈으로 확인할 수 있게 남는 필드도 보여준다.
  const keptKeys = new Set<string>();
  targets.forEach((t) => Object.keys(t.v).forEach((k) => { if (k !== "isApproved" && k !== "status") keptKeys.add(k); }));
  console.log(`\n지우는 필드: isApproved, status`);
  console.log(`그대로 두는 필드: ${[...keptKeys].sort().join(", ")}`);

  if (!APPLY) {
    console.log(`\n[미실행] 목록만 출력했다. 실제로 지우려면 --apply 를 붙인다.`);
    return;
  }

  await snapshotBeforeDestruction(adminDb, ["users"], "isapproved_cleanup");

  // 배치 상한 500. 대상이 수십 건이라 한 배치로 끝나지만 상한은 지킨다.
  let done = 0;
  for (let i = 0; i < targets.length; i += 400) {
    const batch = adminDb.batch();
    for (const t of targets.slice(i, i + 400)) {
      batch.update(adminDb.collection("users").doc(t.id), {
        isApproved: FieldValue.delete(),
        status: FieldValue.delete(),
      });
    }
    await batch.commit();
    done += Math.min(400, targets.length - i);
  }
  console.log(`\n[완료] ${done}건 정리.`);

  const after = await adminDb.collection("users").get();
  const left = after.docs.filter((d) => "isApproved" in d.data() || "status" in d.data()).length;
  console.log(`재확인: 잔여 ${left}건 (0이어야 한다)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
