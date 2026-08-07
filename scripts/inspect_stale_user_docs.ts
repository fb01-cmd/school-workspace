/**
 * Firestore users 컬렉션 잔존·중복 문서 실측 (읽기 전용 — 변경 없음)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_stale_user_docs.ts
 *
 * 확인 항목:
 *  ① users/{uid} 문서 전수 — 이메일별 문서 수 (중복 = 재생성 누적)
 *  ② GWS 실존 대조 — 이미 삭제된 계정의 문서(유령) 목록
 */
import { google } from "googleapis";
import { adminDb } from "../src/lib/firebase/admin";

const DOMAIN = "hmh.or.kr";

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
  const [snap, gwsEmails] = await Promise.all([
    adminDb.collection("users").get(),
    listGwsEmails(),
  ]);

  const byEmail = new Map<string, { uid: string; role: string; hasAck: boolean }[]>();
  snap.forEach((d) => {
    const x = d.data();
    const email = String(x.email || "").toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push({ uid: d.id, role: x.role || "?", hasAck: !!x.policyAck });
  });

  console.log(`users 문서 총 ${snap.size}건 / 고유 이메일 ${byEmail.size}개 / GWS 실계정 ${gwsEmails.size}명`);

  console.log("\n① 이메일별 중복 문서 (2건 이상):");
  for (const [email, docs] of byEmail) {
    if (docs.length > 1) console.log(`   ${email}: ${docs.length}건 — uid: ${docs.map((d) => d.uid.slice(0, 8)).join(", ")}`);
  }

  console.log("\n② GWS에 없는 유령 문서 (삭제된 계정 잔존):");
  let ghost = 0;
  for (const [email, docs] of byEmail) {
    if (!email || !gwsEmails.has(email)) {
      ghost += docs.length;
      console.log(`   ${email || "(email 필드 없음)"} — 문서 ${docs.length}건 (role: ${docs.map((d) => d.role).join(",")})`);
    }
  }
  console.log(`   유령 문서 합계: ${ghost}건`);
}

run().then(() => process.exit(0)).catch((e) => { console.error("실패:", e?.message || e); process.exit(1); });
