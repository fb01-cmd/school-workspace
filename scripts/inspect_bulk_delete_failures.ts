/**
 * 졸업생 일괄 삭제(316명) 부분 실패 원인 실측 (읽기 전용 — 삭제/변경 없음)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_bulk_delete_failures.ts [이메일접두 기본 23]
 *
 * 확인 항목:
 *  ① GWS에 아직 남아 있는 해당 학번대 계정 수·목록 (실패분 = 잔존분 가설 검증)
 *  ② 잔존 계정 표본의 상태 (정지 여부, OU, 보관 처리 여부)
 *  ③ 최근 "일괄 삭제" 감사 로그의 상세(실패 사유 필드 존재 여부)
 */
import { google } from "googleapis";
import { adminDb } from "../src/lib/firebase/admin";

const DOMAIN = "hmh.or.kr";
const PREFIX = process.argv[2] || "23";

async function getDirectory() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    // DWD에 등록된 기존 스코프 사용 (readonly 스코프는 미위임) — 호출은 users.list뿐, 변경 없음
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });
  return google.admin({ version: "directory_v1", auth });
}

async function run() {
  const directory = await getDirectory();

  // ① 잔존 계정 전수 (학번 접두 매칭)
  const remaining: { email: string; suspended: boolean; archived: boolean; orgUnitPath: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await directory.users.list({
      domain: DOMAIN,
      maxResults: 500,
      pageToken,
      query: `email:${PREFIX}*`,
    });
    for (const u of res.data.users || []) {
      remaining.push({
        email: u.primaryEmail || "?",
        suspended: !!u.suspended,
        archived: !!(u as any).archived,
        orgUnitPath: u.orgUnitPath || "?",
      });
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  console.log(`\n① GWS 잔존 ${PREFIX}* 계정: ${remaining.length}명`);
  const byOU = new Map<string, number>();
  let suspendedCount = 0, archivedCount = 0;
  for (const u of remaining) {
    byOU.set(u.orgUnitPath, (byOU.get(u.orgUnitPath) || 0) + 1);
    if (u.suspended) suspendedCount++;
    if (u.archived) archivedCount++;
  }
  console.log(`   OU 분포:`, Object.fromEntries(byOU));
  console.log(`   정지: ${suspendedCount} / 보관(archived): ${archivedCount}`);
  console.log(`   표본 5:`, remaining.slice(0, 5));

  // ② 최근 일괄 삭제 감사 로그 (실패 사유 저장 여부)
  const logs = await adminDb
    .collection("audit_logs")
    .where("action", "==", "일괄 삭제")
    .orderBy("timestamp", "desc")
    .limit(3)
    .get()
    .catch(async () => {
      // timestamp 필드명이 다르면 정렬 없이
      return adminDb.collection("audit_logs").where("action", "==", "일괄 삭제").limit(3).get();
    });
  console.log(`\n② 최근 "일괄 삭제" 감사 로그 ${logs.size}건:`);
  logs.forEach((d) => {
    const x = d.data();
    console.log(`   - status=${x.status} error=${x.error || "-"} details 길이=${String(x.details || "").length}`);
    console.log(`     details 앞 200자: ${String(x.details || "").slice(0, 200)}`);
  });
}

run().then(() => process.exit(0)).catch((e) => { console.error("실패:", e?.message || e); process.exit(1); });
// (부록) 잔존 이메일 전체를 압축 출력 — 실패 구간 분포 확인용
