/**
 * firestore.rules 게시 (Rules API). 2026-08-12에 확립한 절차를 코드로 굳힌 것.
 *
 *   1) 게시 전 실배포 대조 — 실배포에만 있는 줄(콘솔 직접 수정 흔적)이 있으면 중단한다.
 *   2) ruleset 생성 → release 갱신
 *   3) 게시 후 재조회로 게시본이 저장소 파일과 일치하는지 검증
 *   4) 롤백용 이전 ruleset id를 출력 — 반드시 project_notes.md에 기록할 것
 *
 * 규칙 변경은 실서비스 접근 통제를 바꾼다. 게시 전 반드시 시뮬레이터를 돌릴 것:
 *   npx tsx scripts/test_firestore_rules_extension.ts
 *
 *   npx tsx scripts/publish_firestore_rules.ts          # 사전 점검만(기본, 게시 안 함)
 *   npx tsx scripts/publish_firestore_rules.ts --commit # 실제 게시
 */
import * as fs from "fs";
import * as path from "path";
import {
  loadEnvLocal,
  rulesClient,
  RULES_API,
  fetchDeployed,
  deployedOnlyLines,
} from "./inspect_firestore_rules";

async function main() {
  const commit = process.argv.includes("--commit");
  loadEnvLocal();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
  const client = rulesClient();
  const local = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

  // 1) 게시 전 실배포 대조
  const before = await fetchDeployed(client, projectId);
  console.log(`현재 배포 ruleset : ${before.rulesetId} (${before.createTime})`);

  if (before.source === local) {
    console.log("저장소 파일과 이미 동일하다 — 게시할 변경이 없다.");
    return;
  }
  const consoleEdits = deployedOnlyLines(before.source, local);
  if (consoleEdits.length) {
    console.error(
      `\n🛑 중단: 실배포에만 있는 줄이 ${consoleEdits.length}행 있다(콘솔 직접 수정 흔적).\n` +
        `   그대로 게시하면 그 변경이 사라진다. 저장소에 반영한 뒤 다시 시도할 것.`
    );
    consoleEdits.forEach((l) => console.error("   실배포만 | " + l.trim()));
    process.exit(1);
  }
  console.log("사전 점검 ✅ 실배포에만 있는 줄 0행 (콘솔 직접 수정 흔적 없음)");

  if (!commit) {
    console.log("\n(사전 점검 전용 실행 — 게시하지 않았다. 실제 게시는 --commit)");
    return;
  }

  // 2) ruleset 생성 → release 갱신
  const created: any = await client.request({
    url: `${RULES_API}/projects/${projectId}/rulesets`,
    method: "POST",
    data: { source: { files: [{ name: "firestore.rules", content: local }] } },
  });
  const newName: string = created.data.name;
  console.log(`새 ruleset 생성   : ${newName.split("/").pop()}`);

  await client.request({
    url: `${RULES_API}/projects/${projectId}/releases/cloud.firestore`,
    method: "PATCH",
    data: {
      release: {
        name: `projects/${projectId}/releases/cloud.firestore`,
        rulesetName: newName,
      },
    },
  });

  // 3) 게시 후 재조회 검증
  const after = await fetchDeployed(client, projectId);
  const match = after.source === local;
  console.log(`\n게시 후 재조회    : ${after.rulesetId} (${after.createTime})`);
  console.log(match ? "검증 ✅ 게시본이 저장소 파일과 완전 일치" : "검증 ❌ 게시본 불일치 — 즉시 확인 필요");

  // 4) 롤백 정보
  console.log(`\n📌 기록할 것 — 새 ruleset: ${after.rulesetId} / 롤백용 이전: ${before.rulesetId}`);
  if (!match) process.exit(1);
}

main().catch((e) => {
  console.error("실패:", JSON.stringify(e?.response?.data || e.message, null, 2));
  process.exit(1);
});
