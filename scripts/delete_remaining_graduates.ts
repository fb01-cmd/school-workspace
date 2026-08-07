/**
 * 잔존 졸업생 계정 삭제 재실행 (2026-08-07 316명 일괄 삭제 부분 실패 126건 후속)
 *
 * 사용법:
 *   드라이런(기본): npx tsx --env-file=.env.local scripts/delete_remaining_graduates.ts
 *   실제 삭제:      npx tsx --env-file=.env.local scripts/delete_remaining_graduates.ts --apply
 *
 * 안전장치:
 *  - 대상 = 이메일이 /^23\d{3}@hmh\.or\.kr$/ 이고 OU가 정확히 "/학생/졸업생"인 계정만.
 *    (둘 다 만족해야 함 — 재학생 5자리 학번은 1~3으로 시작해 패턴에서 자연 제외)
 *  - 로컬 실행이라 함수 시간 한도 없음 → 동시성 2 + 429 지수 백오프로 쿼터 창을 넘겨 완주.
 *  - AGENTS.md UID 동기화 규칙 준수: GWS 삭제 전 deleteAuthUserByEmail
 *    (Firebase Auth + Firestore users 문서 동반 정리 — 2026-08-07 보강판).
 *  - 종료 후 잔존 재검증 + 감사 로그 1건 기록.
 */
import { google } from "googleapis";
import { adminDb, deleteAuthUserByEmail } from "../src/lib/firebase/admin";
import { mapConcurrentSettled, retryOnRateLimit } from "../src/lib/concurrency";
import { FieldValue } from "firebase-admin/firestore";

const DOMAIN = "hmh.or.kr";
const APPLY = process.argv.includes("--apply");
const TARGET_RE = /^23\d{3}@hmh\.or\.kr$/;
const TARGET_OU = "/학생/졸업생";

function getDirectory() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });
  return google.admin({ version: "directory_v1", auth });
}

async function listTargets(dir: ReturnType<typeof getDirectory>): Promise<string[]> {
  const targets: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await dir.users.list({ domain: DOMAIN, maxResults: 500, pageToken, query: "email:23*" });
    for (const u of r.data.users || []) {
      const email = (u.primaryEmail || "").toLowerCase();
      if (TARGET_RE.test(email) && u.orgUnitPath === TARGET_OU) targets.push(email);
    }
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return targets.sort();
}

async function run() {
  console.log(`모드: ${APPLY ? "⚠️ 실제 삭제 (--apply)" : "드라이런 (변경 없음)"}`);
  const dir = getDirectory();
  const targets = await listTargets(dir);
  console.log(`대상: ${targets.length}명 (${TARGET_OU} OU, 23***** 학번)`);
  console.log(targets.join(", "));

  if (!APPLY || targets.length === 0) {
    if (!APPLY && targets.length > 0) console.log("\n--apply를 붙이면 위 계정을 영구 삭제합니다.");
    return;
  }

  let done = 0;
  const results = await mapConcurrentSettled(targets, 2, async (email) => {
    // AGENTS.md 규칙: GWS 삭제 전 Firebase Auth(+users 문서) 정리
    await deleteAuthUserByEmail(email);
    await retryOnRateLimit(() => dir.users.delete({ userKey: email }), {
      attempts: 6,
      baseDelayMs: 3000,
      maxDelayMs: 30000,
    });
    done++;
    if (done % 10 === 0) console.log(`  ...${done}/${targets.length}`);
  });

  const failures = results
    .map((r, i) => (r.status === "rejected" ? { email: targets[i], reason: (r.reason as any)?.message } : null))
    .filter(Boolean) as { email: string; reason?: string }[];

  console.log(`\n결과: 성공 ${targets.length - failures.length} / 실패 ${failures.length}`);
  for (const f of failures) console.log(`  ✗ ${f.email}: ${f.reason}`);

  // 잔존 재검증
  const remaining = await listTargets(dir);
  console.log(`재검증 — 잔존: ${remaining.length}명${remaining.length ? ` (${remaining.join(", ")})` : " ✅"}`);

  await adminDb.collection("audit_logs").add({
    operatorEmail: "system(script)",
    operatorName: "delete_remaining_graduates",
    action: "일괄 삭제",
    targetEmail: "복수 계정",
    details:
      `졸업생 잔존 ${targets.length}명 삭제 재실행 (2026-08-07 부분 실패 후속) — 성공 ${targets.length - failures.length}, 실패 ${failures.length}` +
      (failures.length ? ` — ${failures.map((f) => `${f.email}(${f.reason || "?"})`).join(", ").slice(0, 2000)}` : "") +
      ` / 재검증 잔존 ${remaining.length}명`,
    status: failures.length > 0 ? "failure" : "success",
    timestamp: FieldValue.serverTimestamp(),
  });
  console.log("감사 로그 기록 완료");
}

run().then(() => process.exit(0)).catch((e) => { console.error("실패:", e?.message || e); process.exit(1); });
