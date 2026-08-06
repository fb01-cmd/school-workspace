import "./_force_notify_mock";
import { adminDb } from "../src/lib/firebase/admin";

async function run() {
  const domain = "hmh.or.kr";
  const snap = await adminDb
    .collection("discipline_records").doc(domain).collection("records")
    .where("voided", "==", true).get();
  console.log(`[무효화 기록] 총 ${snap.size}건`);
  const fmt = (v: any) => {
    if (!v) return "-";
    if (typeof v?.toDate === "function") return v.toDate().toISOString().slice(0, 16);
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 16);
  };
  snap.forEach(d => {
    console.log(`--- ${d.id}`);
    const r = d.data() as any;
    for (const [k, v] of Object.entries(r)) {
      const shown = /At$/.test(k) ? `${fmt(v)} (raw:${JSON.stringify(v)})` : JSON.stringify(v);
      console.log(`  ${k}: ${shown}`);
    }
  });
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
