import "./_force_notify_mock";
import { adminDb } from "../src/lib/firebase/admin";
import { writeAuditLog } from "../src/lib/firebase/audit-server";

// 무효화 보관함 테스트 기록 2건 완전 삭제 + 이들이 발동시킨 단계 사안 정리
// (2026-08-06 사용자 지시 — 내용 실측으로 전건 테스트 기록 확인됨)
const TARGET_IDS = ["rec_1785927728241_dc1c43ee", "rec_1786020208038_5044689f"];
const DOMAIN = "hmh.or.kr";
const OPERATOR = "playviolin@hmh.or.kr";

async function run() {
  const recCol = adminDb.collection("discipline_records").doc(DOMAIN).collection("records");
  const evtCol = adminDb.collection("discipline_stage_events").doc(DOMAIN).collection("events");

  // 1) 대상 기록이 발동시킨 단계 사안 탐색
  const allEvts = await evtCol.get();
  const linked = allEvts.docs.filter(d => {
    const ids: string[] = (d.data() as any).causeRecordIds || [];
    return ids.some(id => TARGET_IDS.includes(id));
  });
  console.log(`[단계 사안] 대상 기록 연관 ${linked.length}건 (전체 ${allEvts.size}건 중)`);
  for (const e of linked) {
    const v = e.data() as any;
    console.log(`  ${e.id} | 학생:${v.studentId} | resolved:${v.resolved} | cause:${JSON.stringify(v.causeRecordIds)}`);
  }

  // 2) 삭제 실행
  for (const e of linked) {
    await e.ref.delete();
    console.log(`  삭제됨(사안): ${e.id}`);
  }
  for (const id of TARGET_IDS) {
    const snap = await recCol.doc(id).get();
    if (!snap.exists) { console.log(`  없음(기록): ${id}`); continue; }
    const r = snap.data() as any;
    await recCol.doc(id).delete();
    console.log(`  삭제됨(기록): ${id} (${r.studentName}/${r.note})`);
    await writeAuditLog({
      operatorEmail: OPERATOR,
      action: "discipline_record_purge",
      targetEmail: r.studentEmail || "-",
      details: `무효화 보관함 테스트 기록 완전 삭제 — ${id} (학생 ${r.studentId} ${r.studentName}, 메모 "${r.note}", 무효화 사유 "${r.voidReason}") — admin SDK, 사용자 지시`,
      status: "success",
    });
  }

  // 3) 잔여 확인
  const remain = await recCol.where("voided", "==", true).get();
  console.log(`[검증] 무효화 보관함 잔여: ${remain.size}건`);
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
