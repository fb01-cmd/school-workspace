/**
 * Firestore 전량 백업 (docs/backup_restore_spec.md §2-B)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/backup_firestore.ts
 *   npx tsx --env-file=.env.local scripts/backup_firestore.ts --label=학기말 --out=/경로
 *
 * 주기: 월 1회 + 학기 경계. 산출물은 기본 ~/school-backups/ (저장소 밖).
 *
 * ⚠️ 산출물에는 학생·교직원 개인정보가 평문으로 담긴다 — 생활지도 기록, 졸업 동의 서명,
 *    쪽지 본문 포함. 클라우드·메일·메신저로 옮기지 않는다 (스펙 §4).
 *
 * 비용: 문서 1건당 읽기 1회. 2026-08-14 실측 전량 1,269건 = 무료 일일 한도(5만)의 2.5%.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { walkAll, writeArchive, defaultBackupRoot } from "./lib/firestoreBackup";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function run() {
  const root = arg("out") || defaultBackupRoot();
  const label = arg("label") || "full";
  const started = Date.now();

  console.log(`Firestore 전량 백업 시작 → ${root}`);
  console.log(`(컬렉션 목록을 하드코딩하지 않고 listCollections로 루트부터 순회한다)\n`);

  const { dir, manifest } = await writeArchive(walkAll(adminDb), {
    root,
    label,
    scope: "full",
    now: new Date(),
  });

  const rows = Object.entries(manifest.byCollection).sort((a, b) => b[1] - a[1]);
  console.log("컬렉션".padEnd(46) + "문서 수");
  console.log("-".repeat(58));
  for (const [k, n] of rows) console.log(k.padEnd(46) + n);
  console.log("-".repeat(58));
  console.log(`합계 ${manifest.docCount}건 · ${((Date.now() - started) / 1000).toFixed(1)}초`);
  console.log(`\n보관 위치: ${dir}`);
  console.log(`읽기 사용: 약 ${manifest.docCount}회 (무료 일일 한도 50,000의 ${((manifest.docCount / 50000) * 100).toFixed(1)}%)`);
  console.log(`\n다음: 오래된 백업 정리 — 최근 3개 + 학기 경계본만 남긴다 (스펙 §4-4).`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error("\n백업 실패:", e.message);
  process.exit(1);
});
