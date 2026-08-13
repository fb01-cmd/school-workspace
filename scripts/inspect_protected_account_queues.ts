/**
 * 보호 계정 3종이 생애주기 삭제 큐에 등재돼 있는지 실측 (읽기 전용)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_protected_account_queues.ts
 *
 * 배경: lifecycle/cron의 3개 영구삭제 경로(transfer_out / graduation / teacher_transfer)는
 *       보호 계정 검사 없이 deleteAuthUserByEmail() → deleteUser()를 호출한다. 앞의 함수는
 *       가드가 없으므로, 보호 계정이 큐에 들어 있으면 users 문서·Firebase Auth 레코드가
 *       먼저 삭제된 뒤 GWS 삭제만 throw로 막힌다. 이 스크립트는 그 전제(큐 등재)가
 *       실제로 성립하는지 확인한다.
 *
 * 읽기: 3 컬렉션 × 3 계정 = 9 doc get. 쓰기·삭제 없음.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { PROTECTED_ACCOUNT_EMAILS } from "../src/lib/auth/blockedOu";

const DOMAIN = "hmh.or.kr";

const QUEUES: { label: string; path: (email: string) => string[] }[] = [
  { label: "transfer_out_tasks (전출·자퇴)", path: (e) => ["transfer_out_tasks", DOMAIN, "students", e] },
  { label: "graduation_tasks (졸업)", path: (e) => ["graduation_tasks", DOMAIN, "students", e] },
  { label: "teacher_transfer_tasks (교사 전출)", path: (e) => ["teacher_transfer_tasks", DOMAIN, "teachers", e] },
];

async function run() {
  let hits = 0;
  for (const q of QUEUES) {
    for (const email of PROTECTED_ACCOUNT_EMAILS) {
      const [c1, d1, c2, d2] = q.path(email);
      const snap = await adminDb.collection(c1).doc(d1).collection(c2).doc(d2).get();
      if (snap.exists) {
        hits++;
        const d = snap.data() || {};
        console.log(`🔴 등재됨 — ${q.label} / ${email} : status=${d.status} deleteDueDate=${d.deleteDueDate ?? "-"} suspendedAt=${d.suspendedAt ?? "-"}`);
      } else {
        console.log(`🟢 없음 — ${q.label} / ${email}`);
      }
    }
  }
  console.log(`\n합계: 보호 계정 큐 등재 ${hits}건 (읽기 ${QUEUES.length * PROTECTED_ACCOUNT_EMAILS.length}회)`);
}

run().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
