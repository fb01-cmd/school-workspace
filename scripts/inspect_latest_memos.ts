/**
 * 읽기 전용 — 최근 쪽지 문서를 최신순으로 찍는다. 함께 **내선번호 오염 여부**를 자동 판정한다.
 *
 * 왜 있나: Firebase 콘솔의 `memos/{domain}/items`는 문서 ID가 난수라 **어느 게 방금 보낸
 * 것인지 눈으로 알 수 없다**(2026-08-13 실기기 확인 때 사용자가 7개를 일일이 열어 봤다).
 * 그리고 "내선이 안 보인다"는 눈 확인은 **보낸 사람에게 내선이 실제로 등록돼 있었을 때만**
 * 의미가 있는데, 콘솔만 봐서는 그 전제를 확인할 수 없다 — 그래서 프로필까지 대조한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/inspect_latest_memos.ts [건수]
 *
 * ⚠️ 자격증명은 **`.env.local`**이다. `prod.env`의 서비스 계정 개인키는 `[SENSITIVE]`
 * 자리표시로 치환돼 있어 "Failed to parse private key"로 죽는다(2026-08-13 확인).
 * 다른 admin SDK 스크립트도 마찬가지 — `--env-file=.env.local`로 실행할 것.
 */
import { adminDb } from "../src/lib/firebase/admin";

const DOMAIN = process.env.SCHOOL_DOMAIN || "hmh.or.kr";

async function main() {
  const limit = Number(process.argv[2] || 5);

  const profSnap = await adminDb.collection("teacher_profiles").get();
  const extOf = new Map<string, string>();
  for (const d of profSnap.docs) {
    const ext = String((d.data() as any).extension || "").trim();
    if (ext) extOf.set(d.id.toLowerCase(), ext);
  }
  console.log(`내선번호 등록 계정: ${extOf.size}명 / 전체 프로필 ${profSnap.size}명`);
  if (extOf.size === 0) {
    console.log("⚠️ 등록된 내선이 하나도 없다 — 이 상태의 '내선 안 보임'은 비오염 증거가 못 된다.");
  } else {
    for (const [email, ext] of extOf) console.log(`   · ${email} → ${ext}`);
  }

  const snap = await adminDb
    .collection("memos")
    .doc(DOMAIN)
    .collection("items")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  console.log(`\n최근 쪽지 ${snap.size}건 (최신순)`);
  for (const doc of snap.docs) {
    const m = doc.data() as any;
    const when = m.createdAt ? new Date(Number(m.createdAt)).toLocaleString("ko-KR") : "?";
    const sender = String(m.senderEmail || "").toLowerCase();
    const parties = [sender, ...(m.recipientEmails || []).map((e: string) => e.toLowerCase())];
    const known = parties.filter(e => extOf.has(e));

    // 저장 문자열 두 곳에 관련자의 내선이 섞였는지 — 스펙 §11-7 "쪽지 문서 비오염"
    const stored = `${m.senderName || ""} | ${m.recipientSummary || ""}`;
    const leaked = known.filter(e => stored.includes(extOf.get(e)!));

    console.log(`\n[${when}] ${doc.id}`);
    console.log(`  senderName        : ${JSON.stringify(m.senderName)}  (${sender})`);
    console.log(`  recipientSummary  : ${JSON.stringify(m.recipientSummary)}  (${m.recipientCount}명)`);
    if (known.length === 0) {
      console.log("  판정: ⚪ 관련자 중 내선 등록자가 없어 오염 검사 대상이 아니다(무의미한 통과).");
    } else if (leaked.length > 0) {
      console.log(`  판정: 🔴 오염 — ${leaked.map(e => `${e}(${extOf.get(e)})`).join(", ")}`);
    } else {
      console.log(`  판정: 🟢 비오염 — 내선 등록자 ${known.length}명이 관여했는데 저장 문자열에 번호 없음`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
