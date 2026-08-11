/**
 * 공동교육 계정 users 문서 오염 조사 (coop_account_block_spec §5, 읽기 전용)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_coop_user_docs.ts
 *
 * 출력: ① settings.blockedOuPaths 현황 ② users 전수 중 비학번·teacher 문서 목록
 *       ③ 각 문서의 GWS orgUnitPath 대조(차단 OU 소속 / GWS 부재 유령 / 일반 교사 구분)
 * 읽기: users 전수(~20) + settings 1 + 대상별 GWS users.get. 삭제는 하지 않는다.
 */
// _force_notify_mock 미사용 — 이 스크립트는 알림 경로(server.ts)를 전혀 import하지 않고
// GWS 디렉터리 읽기만 하며, mock이 ADMIN_EMAIL을 지우면 사칭 조회가 실패한다 (실측).
import { google } from "googleapis";
import { adminDb } from "../src/lib/firebase/admin";
import { isBlockedOuPath, isProtectedAccountEmail } from "../src/lib/auth/blockedOu";

const STUDENT_EMAIL_REGEX = /^\d{5}@hmh\.or\.kr$/;

async function gwsClient() {
  const key = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });
  return google.admin({ version: "directory_v1", auth });
}

async function run() {
  const domain = "hmh.or.kr";

  const settingsSnap = await adminDb.collection("settings").doc(domain).get();
  const blocked: string[] = Array.isArray(settingsSnap.data()?.blockedOuPaths)
    ? settingsSnap.data()!.blockedOuPaths
    : [];
  console.log(`# settings.blockedOuPaths: ${blocked.length ? blocked.join(", ") : "(비어 있음 — 차단 미활성)"}\n`);

  const usersSnap = await adminDb.collection("users").get();
  console.log(`# users 문서 전수: ${usersSnap.size}건`);

  const candidates = usersSnap.docs
    .map((d) => ({ uid: d.id, ...(d.data() as any) }))
    .filter((u) => u.email && !STUDENT_EMAIL_REGEX.test(u.email) && u.role !== "student");

  console.log(`# 비학번·비학생 문서: ${candidates.length}건 — GWS 대조 시작\n`);
  const admin = await gwsClient();

  const rows: Array<{ email: string; uid: string; verdict: string; cleanup: boolean }> = [];
  for (const u of candidates) {
    let verdict: string;
    let cleanup = false;
    if (isProtectedAccountEmail(u.email)) {
      verdict = "보호 계정 (정리 대상 아님)";
    } else {
      try {
        const res = await admin.users.get({ userKey: u.email, projection: "basic" });
        const ou = typeof res.data.orgUnitPath === "string" ? res.data.orgUnitPath : "";
        if (isBlockedOuPath(ou, blocked)) {
          verdict = `🛑 차단 OU 소속 (${ou}) — 정리 대상`;
          cleanup = true;
        } else {
          verdict = `통과 (${ou || "OU 미상"}, role=${u.role}, approved=${u.isApproved})`;
        }
      } catch (e: any) {
        if (e?.code === 404 || /Resource Not Found/i.test(e?.message || "")) {
          verdict = "👻 GWS에 없음 (유령) — 정리 대상";
          cleanup = true;
        } else {
          verdict = `조회 오류: ${e.message}`;
        }
      }
    }
    rows.push({ email: u.email, uid: u.uid, verdict, cleanup });
  }

  for (const r of rows.sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(`- ${r.email} [uid ${r.uid.slice(0, 8)}…] → ${r.verdict}`);
  }

  const cleanupTargets = rows.filter((r) => r.cleanup);
  console.log(`\n# 정리 대상 합계: ${cleanupTargets.length}건`);
  if (cleanupTargets.length > 0) {
    console.log("# cleanup은 별도 스크립트로 — 이 목록을 눈으로 확인한 뒤 실행할 것.");
  }
  process.exit(0);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
