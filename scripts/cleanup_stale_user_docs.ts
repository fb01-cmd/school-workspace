/**
 * Firestore users 컬렉션 유령 문서(GWS에 없는 계정) 정리
 *
 * 사용법:
 *   드라이런(기본): npx tsx --env-file=.env.local scripts/cleanup_stale_user_docs.ts
 *   실제 삭제:      npx tsx --env-file=.env.local scripts/cleanup_stale_user_docs.ts --apply
 *
 * 삭제 대상: users/{uid} 중 email이 GWS 실계정 목록에 없는 문서 전부.
 * (email 필드가 없는 문서도 유령으로 간주 — sync-user는 항상 email을 기록하므로)
 * 이력 문서(policy_acks, audit_logs)는 증빙용이라 건드리지 않는다.
 */
import { google } from "googleapis";
import { adminDb } from "../src/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const DOMAIN = "hmh.or.kr";
const APPLY = process.argv.includes("--apply");

async function listGwsEmails(): Promise<Set<string>> {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });
  const dir = google.admin({ version: "directory_v1", auth });
  const emails = new Set<string>();
  let pageToken: string | undefined;
  do {
    const r = await dir.users.list({ domain: DOMAIN, maxResults: 500, pageToken });
    for (const u of r.data.users || []) emails.add((u.primaryEmail || "").toLowerCase());
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return emails;
}

async function run() {
  console.log(`모드: ${APPLY ? "⚠️ 실제 삭제 (--apply)" : "드라이런 (변경 없음)"}`);
  const [snap, gwsEmails] = await Promise.all([adminDb.collection("users").get(), listGwsEmails()]);
  console.log(`users 문서 ${snap.size}건 / GWS 실계정 ${gwsEmails.size}명`);

  const ghosts = snap.docs.filter((d) => {
    const email = String(d.data().email || "").toLowerCase();
    return !email || !gwsEmails.has(email);
  });

  console.log(`\n유령 문서 ${ghosts.length}건:`);
  for (const d of ghosts) {
    const x = d.data();
    console.log(`  - ${x.email || "(email 없음)"} (uid ${d.id.slice(0, 8)}…, role ${x.role || "?"})`);
  }

  if (!APPLY || ghosts.length === 0) {
    if (!APPLY && ghosts.length > 0) console.log("\n--apply를 붙이면 위 문서를 삭제합니다.");
    return;
  }

  const batch = adminDb.batch();
  ghosts.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await adminDb.collection("audit_logs").add({
    operatorEmail: "system(script)",
    operatorName: "cleanup_stale_user_docs",
    action: "users 유령 문서 정리",
    targetEmail: "복수 문서",
    details: `GWS에 없는 계정의 users 문서 ${ghosts.length}건 삭제: ${ghosts
      .map((d) => d.data().email || d.id)
      .join(", ")
      .slice(0, 2000)}`,
    status: "success",
    timestamp: FieldValue.serverTimestamp(),
  });
  console.log(`\n✅ ${ghosts.length}건 삭제 완료 (감사 로그 기록됨)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error("실패:", e?.message || e); process.exit(1); });
