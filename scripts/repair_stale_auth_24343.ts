/**
 * 2026-08-19 일회성 복구: 24343@hmh.or.kr 로그인 불가(auth/provider-already-linked).
 * inspect_transfer_login_conflict.ts가 확인한 충돌 1건을 제거한다.
 * DRY RUN이 기본 — 실제 삭제는 `--apply` 인자를 줘야 한다.
 */
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const EMAIL = "24343@hmh.or.kr";
const APPLY = process.argv.includes("--apply");

async function main() {
  const auth = getAuth();
  const db = getFirestore();

  const rec = await auth.getUserByEmail(EMAIL).catch(() => null);
  console.log("[Firebase Auth]", rec ? { uid: rec.uid, providers: rec.providerData.map((p) => `${p.providerId}:${p.uid}`), created: rec.metadata.creationTime } : "없음");

  const snap = await db.collection("users").where("email", "==", EMAIL).get();
  console.log(`[Firestore users] ${snap.size}건`);
  snap.forEach((d) => console.log("   ", d.id, JSON.stringify(d.data())));

  if (!APPLY) {
    console.log("\nDRY RUN — 실제로 지우려면 `--apply`를 붙여 다시 실행하세요.");
    return;
  }

  if (rec) { await auth.deleteUser(rec.uid); console.log(`삭제: Auth uid ${rec.uid}`); }
  if (!snap.empty) {
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`삭제: Firestore users 문서 ${snap.size}건`);
  }
  console.log("완료 — 이제 24343@ 계정으로 다시 로그인하면 새 레코드가 만들어집니다.");
}

main().catch((e) => { console.error(e); process.exit(1); });
