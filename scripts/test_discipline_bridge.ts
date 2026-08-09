import "./_force_notify_mock"; // DM 차단 관례 (이 스크립트는 알림 발송 경로가 없으며 mock이 env를 오염시키지 않음)
import { runDisciplineSheetBridge } from "../src/lib/discipline/bridge";

/**
 * 생활지도 시트 단방향 브리지 크론 CLI 테스트 스크립트
 *
 * 실행 예시:
 * 1) 드라이런 및 실측 (킬 스위치 우회, Firestore 쓰기 없음):
 *    npx tsx --env-file=.env.local scripts/test_discipline_bridge.ts --dry-run
 *
 * 2) 실제 실행 (킬 스위치 우회 및 실제 쓰기):
 *    npx tsx --env-file=.env.local scripts/test_discipline_bridge.ts --execute
 */
async function main() {
  const isExecute = process.argv.includes("--execute");
  const dryRun = process.argv.includes("--dry-run") || !isExecute;
  const bypassKillSwitch = dryRun; // dry-run일 때만 킬 스위치 우회, --execute 시 킬 스위치 존중

  console.log(`========== 생활지도 시트 브리지 CLI 테스트 (${dryRun ? "DRY-RUN (미리보기)" : "EXECUTE (실제 쓰기)"}) ==========`);

  const result = await runDisciplineSheetBridge({
    dryRun,
    bypassKillSwitch,
  });

  console.log("\n[실행 결과 요약]");
  console.log(`- Success: ${result.success}`);
  console.log(`- Dry-Run: ${Boolean(result.dryRun)}`);
  console.log(`- Skipped: ${Boolean(result.skipped)}`);
  console.log(`- Aborted: ${Boolean(result.aborted)}`);
  if (result.reason) console.log(`- Reason: ${result.reason}`);
  console.log(`- 대조 대상: ${result.checkedRowsCount || 0}행 (${result.checkedTotalCount || 0}건 체크)`);
  console.log(`- 추가 (예정) 기록: ${result.addedRecordsCount || 0}건`);
  console.log(`- 생성 (예정) 이벤트: ${result.createdEventsCount || 0}건`);

  if (result.warnings && result.warnings.length > 0) {
    console.log(`\n[경고 메시지 ${result.warnings.length}건]`);
    result.warnings.forEach((w) => console.log(`  ⚠️ ${w}`));
  }

  if (result.excluded && result.excluded.length > 0) {
    console.log(`\n[제외/불일치 학생 ${result.excluded.length}명]`);
    result.excluded.forEach((e) =>
      console.log(`  ❌ ${e.key} ${e.name}: ${e.reason} (체크 ${e.checksCount}건)`)
    );
  }

  console.log("\n=======================================================");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("오류 발생:", e?.response?.data || e);
    process.exit(1);
  });
