// 생활지도 시트 브리지 킬 스위치 토글 (가동/일몰/긴급 정지 공용)
// 실행: npx tsx --env-file=.env.local scripts/toggle_discipline_bridge.ts on|off
import "./_force_notify_mock"; // DM 차단 관례 (이 스크립트는 config 필드 1개만 수정)

async function main() {
  const mode = process.argv[2];
  if (mode !== "on" && mode !== "off") {
    console.error("사용법: toggle_discipline_bridge.ts on|off");
    process.exit(1);
  }
  const { adminDb } = await import("../src/lib/firebase/admin");
  const ref = adminDb.collection("discipline_config").doc("hmh.or.kr");
  const before = (await ref.get()).data()?.sheetBridgeEnabled;
  await ref.update({ sheetBridgeEnabled: mode === "on" });
  const after = (await ref.get()).data()?.sheetBridgeEnabled;
  console.log(`sheetBridgeEnabled: ${String(before)} → ${String(after)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
