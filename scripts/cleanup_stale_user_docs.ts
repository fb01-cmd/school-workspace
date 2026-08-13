/**
 * Firestore users 컬렉션 정지·유령 문서 정리 (수동 실행용)
 *
 * 사용법:
 *   드라이런(기본): npx tsx --env-file=.env.local scripts/cleanup_stale_user_docs.ts
 *   실제 삭제:      npx tsx --env-file=.env.local scripts/cleanup_stale_user_docs.ts --apply
 *   유령만 삭제:    ... --apply --ghosts-only   (정지분은 크론에 맡길 때)
 *
 * 판정·삭제·안전 규칙은 전부 `src/lib/auth/reconcileUserDocs.ts` 한 곳에 있다.
 * 이 스크립트는 그것을 수동으로 한 번 돌리는 껍데기이며, 같은 로직이 매일
 * `lifecycle/cron`에서도 자동 실행된다(콘솔에서 직접 정지·삭제한 건까지 자가 치유).
 *
 * ⚠️ 예전 이 스크립트는 자체 판정 로직을 들고 있었고 **보호 계정 예외가 없었다.**
 *    로직을 두 벌 두면 한쪽만 고쳐지므로 라이브러리 호출로 대체했다.
 */
import { reconcileUserDocsWithWorkspace } from "../src/lib/auth/reconcileUserDocs";

const APPLY = process.argv.includes("--apply");
const GHOSTS_ONLY = process.argv.includes("--ghosts-only");

async function run() {
  console.log(
    `모드: ${APPLY ? "⚠️ 실제 삭제 (--apply)" : "드라이런 (변경 없음)"}` +
      `${GHOSTS_ONLY ? " / 범위: 유령만 (정지분은 크론 소관)" : ""}\n`
  );

  const r = await reconcileUserDocsWithWorkspace({
    dryRun: !APPLY,
    refreshCache: true,
    only: GHOSTS_ONLY ? "ghosts" : "all",
    operator: { email: "system(script)", name: "cleanup_stale_user_docs" },
  });

  console.log(`users 문서 ${r.userDocCount}건 / GWS 실계정 ${r.gwsUserCount}명`);
  console.log(`\n유령 문서(GWS에 없음) ${r.ghosts.length}건:`);
  r.ghosts.forEach((e) => console.log(`  - ${e}`));
  console.log(`\n정지 계정 문서(GWS 정지) ${r.suspended.length}건:`);
  r.suspended.forEach((e) => console.log(`  - ${e}`));

  if (r.protectedSkipped.length > 0) {
    console.log(`\n보호 계정으로 제외: ${r.protectedSkipped.join(", ")}`);
  }
  if (r.graceSkipped.length > 0) {
    console.log(`\n신규 유예(1시간 이내 생성)로 제외: ${r.graceSkipped.join(", ")}`);
  }

  if (r.skipped) {
    console.log(`\n⏸  삭제하지 않음 — ${r.reason}`);
    if (!APPLY && r.ghosts.length + r.suspended.length > 0) {
      console.log("   --apply를 붙이면 위 문서를 삭제합니다.");
    }
    return;
  }

  const total = GHOSTS_ONLY ? r.ghosts.length : r.ghosts.length + r.suspended.length;
  if (total === 0) {
    console.log("\n✅ 정리 대상 없음 — users 문서와 GWS가 일치합니다.");
    return;
  }
  console.log(`\n✅ ${total}건 삭제 완료 (감사 로그 기록됨)`);
  if (GHOSTS_ONLY && r.suspended.length > 0) {
    console.log(`   정지 ${r.suspended.length}건은 남겨 뒀습니다 — 다음 크론이 정리합니다.`);
  }
  console.log("   정지가 풀리고 그 사람이 로그인하면 sync-user가 문서를 다시 만듭니다.");
}

run().then(() => process.exit(0)).catch((e) => { console.error("실패:", e?.message || e); process.exit(1); });
