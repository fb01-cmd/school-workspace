import "./_force_notify_mock";
import { getAuth } from "firebase-admin/auth";
import { adminDb } from "../src/lib/firebase/admin";

async function main() {
  const isCommit = process.argv.includes("--commit");
  console.log(`=== [backfill_user_names] 사용자 이름(name) 백필 스크립트 시작 (${isCommit ? "REAL COMMIT" : "DRY-RUN 시뮬레이션"}) ===\n`);

  const snap = await adminDb.collection("users").get();
  console.log(`- 전체 Firestore users 문서: ${snap.docs.length}건`);

  const missingDocs = snap.docs.filter((d) => {
    const data = d.data();
    const name = data.name || data.displayName;
    return typeof name !== "string" || !name.trim();
  });

  console.log(`- 백필 대상 (name 없는 문서): ${missingDocs.length}건\n`);

  let successCount = 0;
  let failCount = 0;

  for (const doc of missingDocs) {
    const data = doc.data();
    const email = data.email;
    const uid = doc.id;

    let authDisplayName: string | undefined;

    try {
      if (email) {
        const userRec = await getAuth().getUserByEmail(email);
        if (userRec.displayName?.trim()) {
          authDisplayName = userRec.displayName.trim();
        }
      }
      if (!authDisplayName) {
        const userRec = await getAuth().getUser(uid);
        if (userRec.displayName?.trim()) {
          authDisplayName = userRec.displayName.trim();
        }
      }
    } catch (e: any) {
      // Auth 레코드 없음 또는 조회 실패
    }

    if (authDisplayName) {
      console.log(`  [${email || uid}] -> "${authDisplayName}" ${isCommit ? "(업데이트 완료)" : "(업데이트 예정)"}`);
      if (isCommit) {
        await doc.ref.update({ name: authDisplayName });
      }
      successCount++;
    } else {
      console.warn(`  ⚠️ [${email || uid}] -> Firebase Auth에서 displayName을 찾을 수 없음`);
      failCount++;
    }
  }

  console.log(`\n=== 요약 ===`);
  console.log(`- 전체 대상: ${missingDocs.length}건`);
  console.log(`- 성공 (${isCommit ? "Firestore 반영 완료" : "발견됨/시뮬레이션"}): ${successCount}건`);
  console.log(`- 실패/미발견: ${failCount}건`);
  if (!isCommit && missingDocs.length > 0) {
    console.log(`\n💡 실제 Firestore 반영을 원하시면 --commit 플래그를 붙여 실행하세요:`);
    console.log(`   npx tsx --env-file=.env.local scripts/backfill_user_names.ts --commit`);
  }
}

main().catch((err) => {
  console.error("❌ 스크립트 실행 오류:", err);
  process.exit(1);
});
