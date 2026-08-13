/**
 * 읽기 전용 — 실배포 firestore.rules를 받아 저장소 파일과 대조한다. 게시는 하지 않는다.
 *
 * 왜 있나: 이 프로젝트의 규칙은 수동 게시 구조라 저장소와 실배포가 조용히 벌어진다
 * (2026-08-12에 7/25 이후 3주 드리프트가 실증됐다). 중간점검 "규칙 드리프트 상시 점검"의 도구이자,
 * 게시 절차 1단계(게시 전 실배포 대조 — 실배포에만 있는 줄 = 콘솔 직접 수정 흔적)다.
 *
 *   npx tsx scripts/inspect_firestore_rules.ts
 */
import { JWT } from "google-auth-library";
import * as fs from "fs";
import * as path from "path";

export function loadEnvLocal() {
  const raw = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[m[1]] = v.replace(/\\n/g, "\n");
  }
}

export function rulesClient() {
  return new JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
}

export const RULES_API = "https://firebaserules.googleapis.com/v1";

export async function fetchDeployed(client: JWT, projectId: string) {
  const rel: any = await client.request({
    url: `${RULES_API}/projects/${projectId}/releases/cloud.firestore`,
  });
  const rulesetName: string = rel.data.rulesetName;
  const rs: any = await client.request({ url: `${RULES_API}/${rulesetName}` });
  return {
    rulesetName,
    rulesetId: rulesetName.split("/").pop()!,
    createTime: rs.data.createTime as string,
    source: rs.data.source.files[0].content as string,
  };
}

/** 실배포에만 있는 줄 = 저장소에 없는 규칙 = 콘솔 직접 수정 흔적 후보 */
export function deployedOnlyLines(deployed: string, local: string): string[] {
  const localSet = new Set(local.split("\n").map((s) => s.trim()));
  return deployed.split("\n").filter((l) => l.trim() && !localSet.has(l.trim()));
}

async function main() {
  loadEnvLocal();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
  const client = rulesClient();
  const dep = await fetchDeployed(client, projectId);
  const local = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

  console.log(`프로젝트      : ${projectId}`);
  console.log(`배포 ruleset  : ${dep.rulesetId}`);
  console.log(`생성 시각     : ${dep.createTime}`);

  if (dep.source === local) {
    console.log("\n✅ 저장소 파일과 완전 일치 — 드리프트 없음");
    return;
  }

  const onlyDeployed = deployedOnlyLines(dep.source, local);
  const onlyLocal = deployedOnlyLines(local, dep.source);
  console.log(`\n⚠️ 차이 있음`);
  console.log(`실배포에만 있는 줄(콘솔 직접 수정 흔적 후보): ${onlyDeployed.length}행`);
  onlyDeployed.forEach((l) => console.log("  실배포만 | " + l.trim()));
  console.log(`저장소에만 있는 줄(미게시 변경분): ${onlyLocal.length}행`);
  onlyLocal.forEach((l) => console.log("  저장소만 | " + l.trim()));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("실패:", e?.response?.data || e.message);
    process.exit(1);
  });
}
