/**
 * 생활지도 기록 유입 경로 실측 (읽기 전용)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_discipline_adoption.ts
 *
 * 목적: 시트 브리지로 들어온 기록과 **교사가 플랫폼에서 직접 남긴 기록**을 갈라 센다.
 *       브리지 기록은 문서 id가 "rec_brg_"로 시작하고 recordedBy가 admin@ 이다
 *       (src/lib/discipline/bridge.ts:442,455). 직접 기록은 교사 본인 이메일이 남는다.
 *
 * 비용: 기록 전량 1회 조회. 2026-08-14 기준 약 180건 = 무료 일일 한도의 0.4%.
 */
import { adminDb } from "../src/lib/firebase/admin";

const DOMAIN = "hmh.or.kr";
const BRIDGE_PREFIX = "rec_brg_";
const BRIDGE_ACTOR = "admin@hmh.or.kr";

function ymd(v: any): string {
  const d = v?.toDate?.() instanceof Date ? v.toDate() : v ? new Date(v) : null;
  return d ? d.toISOString().slice(0, 10) : "-";
}

async function run() {
  const snap = await adminDb.collection("discipline_records").doc(DOMAIN).collection("records").get();
  const docs = snap.docs;

  let bridge = 0, direct = 0, voided = 0;
  const byRecorder = new Map<string, number>();
  const directRows: { at: string; by: string; item: string }[] = [];

  for (const d of docs) {
    const x = d.data() || {};
    if (x.voided) voided++;
    const isBridge = d.id.startsWith(BRIDGE_PREFIX) || x.recordedBy === BRIDGE_ACTOR;
    if (isBridge) bridge++;
    else {
      direct++;
      const by = String(x.recordedBy || "(미상)");
      byRecorder.set(by, (byRecorder.get(by) || 0) + 1);
      directRows.push({ at: ymd(x.recordedAt), by, item: String(x.itemId || "-") });
    }
  }

  console.log(`생활지도 기록 총 ${docs.length}건 (무효 ${voided}건 포함)`);
  console.log(`  시트 브리지 유입 : ${bridge}건`);
  console.log(`  플랫폼 직접 기록 : ${direct}건`);

  if (direct > 0) {
    console.log(`\n플랫폼에서 직접 기록한 선생님 ${byRecorder.size}명`);
    for (const [by, n] of [...byRecorder.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${by.padEnd(28)} ${n}건`);
    }
    directRows.sort((a, b) => (a.at < b.at ? 1 : -1));
    console.log(`\n최근 직접 기록 (최대 8건)`);
    for (const r of directRows.slice(0, 8)) console.log(`  ${r.at}  ${r.by.padEnd(26)} ${r.item}`);
  } else {
    console.log(`\n아직 플랫폼 직접 기록은 없다 — 전부 시트 브리지 유입이다.`);
  }
  console.log(`\n읽기 사용: ${docs.length}회 (무료 일일 한도 50,000의 ${((docs.length / 50000) * 100).toFixed(1)}%)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
