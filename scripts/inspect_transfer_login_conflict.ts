/**
 * 전입생 로그인 실패(auth/provider-already-linked) 진단 스크립트 — 2026-08-19
 *
 * 가설: 계정 생성 경로(lifecycle enroll_students)가 `deleteAuthUserByEmail`를
 * 호출하지 않아, 같은 이메일로 예전에 존재하던 Firebase Auth 레코드(옛 Google sub)가
 * 남아 있고, 새 GWS 계정의 sub와 충돌한다.
 *
 * 확인 방법: Firebase Auth의 google.com provider uid ↔ GWS Directory의 user.id 대조.
 * 읽기 비용: Firestore 읽기 없음 (Auth API + Directory API만 사용).
 */
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { google } from "googleapis";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN || "hmh.or.kr";

async function directoryClient() {
  const jwt = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    // DWD 허용 목록에 등록된 스코프만 쓴다 (readonly는 미등록 → unauthorized_client)
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });
  await jwt.authorize();
  return google.admin({ version: "directory_v1", auth: jwt });
}

async function main() {
  const filter = process.argv[2]; // 선택: 특정 이메일만 볼 때
  const auth = getAuth();
  const admin = await directoryClient();

  const rows: any[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (!u.email) continue;
      if (filter && !u.email.includes(filter)) continue;
      const g = u.providerData.find((p) => p.providerId === "google.com");
      rows.push({ email: u.email, fbUid: u.uid, googleSub: g?.uid || null, created: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`Firebase Auth 레코드 ${rows.length}건 (도메인 ${DOMAIN})\n`);

  let conflicts = 0;
  for (const r of rows) {
    let gwsId: string | null = null;
    let gwsCreated: string | null = null;
    try {
      const res = await admin.users.get({ userKey: r.email });
      gwsId = (res.data.id as string) || null;
      gwsCreated = (res.data.creationTime as string) || null;
    } catch (e: any) {
      gwsId = `<GWS 없음: ${e.code || e.message}>`;
    }
    const mismatch = r.googleSub && gwsId && !String(gwsId).startsWith("<") && r.googleSub !== gwsId;
    if (mismatch) conflicts++;
    if (mismatch || filter) {
      console.log(
        `${mismatch ? "❌ 충돌" : "  정상"} ${r.email}\n` +
        `      Firebase uid=${r.fbUid} googleSub=${r.googleSub} (생성 ${r.created}, 최근로그인 ${r.lastSignIn || "없음"})\n` +
        `      GWS id=${gwsId} (생성 ${gwsCreated})`
      );
    }
  }
  console.log(`\n충돌(provider-already-linked 유발) ${conflicts}건`);
}

main().catch((e) => { console.error(e); process.exit(1); });
