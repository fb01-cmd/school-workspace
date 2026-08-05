import "./_force_notify_mock"; // 관례 유지 (생활지도는 알림 경로 자체가 없음)
import { adminDb } from "../src/lib/firebase/admin";

async function run() {
  const domain = "hmh.or.kr";
  // 1) 규정 문서
  const cfgSnap = await adminDb.collection("discipline_config").doc(domain).get();
  console.log(`[규정] 문서 존재: ${cfgSnap.exists}`);
  if (cfgSnap.exists) {
    const c = cfgSnap.data() as any;
    console.log(`  items: ${(c.items||[]).map((i:any)=>`${i.label}(${i.active?"활성":"비활성"})`).join(", ")}`);
    console.log(`  rules: ${(c.rules||[]).length}건, resetMarkers: ${JSON.stringify(c.resetMarkers||{})}`);
  }
  // 2) 특별 권한
  const grants = await adminDb.collection("discipline_permissions").doc(domain).collection("grants").get();
  console.log(`[권한] grant ${grants.size}건`);
  grants.forEach(g => { const d = g.data() as any; console.log(`  ${d.teacherEmail || g.id}: ${JSON.stringify(d.permissions||d.perms||[])} 만료:${d.expiresAt||"-"} 회수:${d.revoked||false}`); });
  // 3) 담임 매핑 — 서버와 동일한 로더 사용 (단일 원본: teacher_profiles isHomeroom)
  const { loadHomeroomEntries } = await import("../src/lib/discipline/server");
  const entries = await loadHomeroomEntries(domain);
  console.log(`[담임] ${entries.length}건 (30개 반 기준 누락 ${30 - entries.length}건)`);
  entries.forEach(e => console.log(`  ${e.grade}-${e.classNum}: ${e.name} (${e.email})`));
  // 4) 기존 기록/이벤트 (실데이터 유무)
  const recs = await adminDb.collection("discipline_records").doc(domain).collection("records").limit(5).get();
  const evts = await adminDb.collection("discipline_stage_events").doc(domain).collection("events").limit(5).get();
  console.log(`[기록] records ${recs.size >= 5 ? "5+" : recs.size}건 / stage_events ${evts.size >= 5 ? "5+" : evts.size}건`);
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
