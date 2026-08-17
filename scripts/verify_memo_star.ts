/**
 * 즐겨찾기함 등호 쿼리 색인 실측 (memo_star_search_spec §1-3·§3 — 구현 조건)
 *
 * 검증 대상: 사용자별 맵 키(starredBy.{email}) 등호 필터가 복합 색인 없이
 * array-contains(수신)·등호(발신) 필터와 병합 실행되는가. 색인 요구(FAILED_PRECONDITION)가
 * 뜨면 스펙 §1-3 폴백(전량 조회 재사용)으로 전환해야 한다.
 *
 * 문서 4종을 만들어 정확도까지 확인: A(수신+내 별표) B(발신+내 별표) C(수신, 별표 없음)
 * D(수신, 남의 별표만) → 받은 별표 쿼리 = A만, 보낸 별표 쿼리 = B만. 흔적 삭제.
 *
 * 주의: admin SDK는 firestore.rules를 타지 않으므로 여기서 실측되는 것은 **색인·쿼리 성립**이다.
 * 규칙 통과는 구조 논증(두 쿼리 모두 기존 실측된 통과 형태 + 필터 추가는 결과를 좁히기만 함)
 * + UI 구현 후 실기기 확인이 담당한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_memo_star.ts
 */
import { adminDb } from "../src/lib/firebase/admin";
import { FieldPath } from "firebase-admin/firestore";

let failed = 0;
function expect(name: string, cond: boolean) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

const DOMAIN = "hmh.or.kr";
const ME = "fb01@hmh.or.kr"; // 보호 계정 — 실사용자 아님
const OTHER = "star-selftest-ghost@hmh.or.kr";

async function main() {
  const col = adminDb.collection("memos").doc(DOMAIN).collection("items");
  const stamp = Date.now();
  const base = {
    title: "별표 실측",
    body: "-",
    links: [],
    recipientCount: 1,
    recipientSummary: "",
    reads: {},
    createdAt: stamp,
    expireAt: stamp + 3600 * 1000, // 1시간 뒤 만료 — 정리 실패해도 파기 크론이 지움
  };
  const docs = {
    A: col.doc(`startest_A_${stamp}`),
    B: col.doc(`startest_B_${stamp}`),
    C: col.doc(`startest_C_${stamp}`),
    D: col.doc(`startest_D_${stamp}`),
  };

  try {
    await docs.A.set({ ...base, senderEmail: OTHER, senderName: "실측", recipientEmails: [ME], starredBy: { [ME]: true } });
    await docs.B.set({ ...base, senderEmail: ME, senderName: "실측", recipientEmails: [OTHER], starredBy: { [ME]: true } });
    await docs.C.set({ ...base, senderEmail: OTHER, senderName: "실측", recipientEmails: [ME] });
    await docs.D.set({ ...base, senderEmail: OTHER, senderName: "실측", recipientEmails: [ME], starredBy: { [OTHER]: true } });

    const testIds = new Set(Object.values(docs).map((d) => d.id));

    // 받은 별표: array-contains 본인 + starredBy.{me} == true
    try {
      const received = await col
        .where("recipientEmails", "array-contains", ME)
        .where(new FieldPath("starredBy", ME), "==", true)
        .get();
      const mine = received.docs.filter((d) => testIds.has(d.id)).map((d) => d.id);
      expect("받은 별표 쿼리 — 색인 오류 없이 실행", true);
      expect("받은 별표 쿼리 — A만 반환(무별표 C·남의 별표 D 제외)", mine.length === 1 && mine[0] === docs.A.id);
    } catch (e: any) {
      expect(`받은 별표 쿼리 실행 (실패: ${e?.code || ""} ${e?.message?.slice(0, 80)})`, false);
    }

    // 보낸 별표: senderEmail 본인 + starredBy.{me} == true
    try {
      const sent = await col
        .where("senderEmail", "==", ME)
        .where(new FieldPath("starredBy", ME), "==", true)
        .get();
      const mine = sent.docs.filter((d) => testIds.has(d.id)).map((d) => d.id);
      expect("보낸 별표 쿼리 — 색인 오류 없이 실행", true);
      expect("보낸 별표 쿼리 — B만 반환", mine.length === 1 && mine[0] === docs.B.id);
    } catch (e: any) {
      expect(`보낸 별표 쿼리 실행 (실패: ${e?.code || ""} ${e?.message?.slice(0, 80)})`, false);
    }
  } finally {
    for (const ref of Object.values(docs)) await ref.delete().catch(() => {});
    const gone = await Promise.all(Object.values(docs).map((r) => r.get().then((s) => !s.exists)));
    expect("흔적 삭제 — 실측 문서 잔존 0", gone.every(Boolean));
  }

  console.log(failed === 0 ? "\n전체 통과 ✅ (복합 색인 불요 실측 확정 — 폴백 불필요)" : `\n실패 ${failed}건 ❌`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
