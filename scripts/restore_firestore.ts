/**
 * Firestore 복구 (docs/backup_restore_spec.md §3)
 *
 * 백업은 잘못돼도 백업이 없을 뿐이지만, **복구는 잘못되면 살아 있는 데이터를 덮어쓴다.**
 * 그래서 가드가 이쪽에 몰려 있다.
 *
 *   1. 기본은 예행(dry-run) — 실제 쓰기는 --apply를 명시해야 한다
 *   2. 기본은 추가 전용 — 이미 있는 문서는 건드리지 않는다. 덮어쓰려면 --overwrite
 *   3. **절대 삭제하지 않는다** — 백업에 없는 문서를 지우는 기능은 제공하지 않는다
 *   4. 전체 복구는 --all을 명시해야 한다. 기본은 --path로 지정한 것만
 *
 * 사용법:
 *   # 1) 무엇이 복구되는지 먼저 본다 (쓰기 없음)
 *   npx tsx --env-file=.env.local scripts/restore_firestore.ts --from=~/school-backups/2026-08-14T2130_full --all
 *   # 2) 일부만
 *   ... --from=<dir> --path=discipline_records/hmh.or.kr/records
 *   # 3) 실제 적용
 *   ... --from=<dir> --path=<경로> --apply
 *   # 4) 기존 문서까지 덮어쓰기 (가장 위험)
 *   ... --from=<dir> --path=<경로> --apply --overwrite
 */
import * as os from "os";
import { adminDb } from "../src/lib/firebase/admin";
import { readArchive, decodeValue, encodeValue, collectionKeyOf } from "./lib/firestoreBackup";

/** 키 순서에 흔들리지 않는 정규 문자열 — 왕복 대조용 */
function canon(v: any): string {
  const sort = (x: any): any =>
    Array.isArray(x) ? x.map(sort)
      : x && typeof x === "object" ? Object.keys(x).sort().reduce((o: any, k) => ((o[k] = sort(x[k])), o), {})
      : x;
  return JSON.stringify(sort(v));
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function argAll(name: string): string[] {
  return process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
}
function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, os.homedir()) : p;
}

async function run() {
  const from = arg("from");
  const paths = argAll("path");
  const all = flag("all");
  const apply = flag("apply");
  const overwrite = flag("overwrite");

  if (!from) throw new Error("--from=<백업 디렉터리> 가 필요하다.");
  if (!all && paths.length === 0) {
    throw new Error("복구 범위를 지정하라 — --path=<컬렉션 경로> (반복 가능) 또는 --all.\n전체 복구를 기본값으로 두지 않는 것은 의도적이다.");
  }

  const { manifest, docs } = readArchive(expandHome(from));
  console.log(`아카이브: ${manifest.createdAt} · ${manifest.scope} · ${manifest.docCount}건 (label=${manifest.label})`);

  // ── 검증 모드: 쓰기 없이 "이 백업으로 정말 되돌릴 수 있는가"를 확인한다 ──
  // 아카이브를 디코드 → 재인코드 → 살아 있는 값과 대조. 왕복이 깨지면 여기서 잡힌다.
  // 복구를 한 번도 리허설하지 않은 백업은 백업이 아니다 (스펙 §3).
  if (flag("verify")) {
    const scope = all ? docs : docs.filter((d) => paths.some((p) => d.path === p || d.path.startsWith(p.replace(/\/$/, "") + "/")));
    console.log(`\n왕복 검증: ${scope.length}건 (읽기 ${scope.length}회, 쓰기 없음)\n`);
    let same = 0, diff = 0, gone = 0;
    const diffs: string[] = [];
    for (let i = 0; i < scope.length; i += 300) {
      const part = scope.slice(i, i + 300);
      const snaps = await adminDb.getAll(...part.map((d) => adminDb.doc(d.path)));
      snaps.forEach((s, j) => {
        const arc = part[j];
        if (!s.exists) { gone++; return; }
        const roundTripped = canon(encodeValue(decodeValue(arc.data, adminDb), arc.path));
        const live = canon(encodeValue(s.data(), arc.path));
        if (roundTripped === live) same++;
        else { diff++; if (diffs.length < 5) diffs.push(arc.path); }
      });
    }
    console.log(`  일치 ${same}건 · 불일치 ${diff}건 · 현재 없음 ${gone}건(백업 이후 삭제됨)`);
    if (diffs.length) console.log(`  불일치 예: ${diffs.join(", ")}`);
    console.log(diff === 0
      ? `\n■ 왕복 검증 통과 — 이 아카이브는 실제로 복구 가능하다.`
      : `\n■ 불일치가 있다. 백업 이후 값이 바뀐 것인지 인코딩 결함인지 위 경로를 열어 확인하라.`);
    return;
  }

  const targets = all ? docs : docs.filter((d) => paths.some((p) => d.path === p || d.path.startsWith(p.replace(/\/$/, "") + "/")));
  if (targets.length === 0) throw new Error("지정한 경로에 해당하는 문서가 아카이브에 없다. --path를 확인하라.");

  // 현재 상태 대조 — 신규/기존을 나눠 보여준다
  console.log(`\n대상 ${targets.length}건에 대해 현재 상태를 조회한다 (읽기 ${targets.length}회)...`);
  const existing = new Set<string>();
  for (let i = 0; i < targets.length; i += 300) {
    const part = targets.slice(i, i + 300);
    const snaps = await adminDb.getAll(...part.map((d) => adminDb.doc(d.path)));
    snaps.forEach((s) => { if (s.exists) existing.add(s.ref.path); });
  }
  const fresh = targets.filter((d) => !existing.has(d.path));
  const clash = targets.filter((d) => existing.has(d.path));

  const byCol: Record<string, { fresh: number; clash: number }> = {};
  for (const d of targets) {
    const k = collectionKeyOf(d.path);
    byCol[k] = byCol[k] || { fresh: 0, clash: 0 };
    existing.has(d.path) ? byCol[k].clash++ : byCol[k].fresh++;
  }

  console.log("\n컬렉션".padEnd(46) + "신규".padStart(6) + "기존".padStart(8));
  console.log("-".repeat(60));
  for (const [k, v] of Object.entries(byCol).sort((a, b) => (b[1].fresh + b[1].clash) - (a[1].fresh + a[1].clash))) {
    console.log(k.padEnd(46) + String(v.fresh).padStart(6) + String(v.clash).padStart(8));
  }
  console.log("-".repeat(60));

  const willWrite = overwrite ? targets.length : fresh.length;
  console.log(`신규 ${fresh.length}건 · 기존 ${clash.length}건`);
  console.log(overwrite
    ? `⚠️ --overwrite: 기존 ${clash.length}건을 **현재 값 위에 덮어쓴다.** 지금 살아 있는 값은 사라진다.`
    : `기존 ${clash.length}건은 건드리지 않는다 (덮어쓰려면 --overwrite).`);
  console.log(`쓰기 예정 ${willWrite}건 (무료 일일 쓰기 한도 20,000의 ${((willWrite / 20000) * 100).toFixed(1)}%)`);
  console.log(`\n복구는 삭제하지 않는다 — 아카이브에 없는 문서는 그대로 남는다.`);

  if (!apply) {
    console.log(`\n■ 예행 종료. 실제로 쓰려면 --apply 를 붙여라.`);
    return;
  }
  if (willWrite === 0) {
    console.log(`\n■ 쓸 것이 없다. 종료.`);
    return;
  }

  const write = overwrite ? targets : fresh;
  console.log(`\n적용 중... ${write.length}건`);
  for (let i = 0; i < write.length; i += 400) {
    const batch = adminDb.batch();
    for (const d of write.slice(i, i + 400)) batch.set(adminDb.doc(d.path), decodeValue(d.data, adminDb));
    await batch.commit();
    console.log(`  ${Math.min(i + 400, write.length)} / ${write.length}`);
  }
  console.log(`\n■ 완료: ${write.length}건 복구.`);
  console.log(`검증 권장: npx tsx --env-file=.env.local scripts/inspect_firestore_volume.ts 로 문서 수를 확인하라.`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error("\n복구 중단:", e.message);
  process.exit(1);
});
