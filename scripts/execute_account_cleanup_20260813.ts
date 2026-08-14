/**
 * 계정·데이터 정리 묶음 일회성 정리 스크립트 (2026-08-13 트리아지 §4)
 *
 * ⚠️⚠️ 2번 단계는 **재실행 금지** (2026-08-14) ⚠️⚠️
 * 이 스크립트의 2번이 관리 계정을 조직도에서 빼면서 **쪽지 기능을 쓸 수 없게 만들었다.**
 * 쪽지는 조직도 소속을 요구하는데, 그 배치는 찌꺼기가 아니라 **시험을 위한 의도된 상태**였다.
 * 사용자 확정: 쪽지 기능이 완성될 때까지 관리 계정은 「휴직 교사」에 둔다.
 * 복구 스크립트: scripts/restore_admin_org_membership.ts
 * 경위: docs/midterm_triage.md §4의 2026-08-14 정정 주석.
 * → 이 파일을 다시 돌려야 한다면 1번만 돌리고 2번은 건너뛸 것.
 *
 * 1. teacher_profiles 이름 오염 19건 정리 (profile.name == email local-part -> name: "")
 * 2. 관리자·시험 계정 4개 (admin@, admin2@, admin3@, tteacher@) "휴직 교사" 부서 임시 배치 해제 (departments: [], noDept: true)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/execute_account_cleanup_20260813.ts           ← 드라이런
 *   npx tsx --env-file=.env.local scripts/execute_account_cleanup_20260813.ts --commit  ← 실제 Firestore 업데이트
 */
import { adminDb } from "../src/lib/firebase/admin";
import { writeAuditLog } from "../src/lib/firebase/audit-server";

const OPERATOR = "fb01@hmh.or.kr";

async function main() {
  const isCommit = process.argv.includes("--commit");
  console.log(`=== [execute_account_cleanup] 계정·데이터 정리 묶음 시작 (${isCommit ? "REAL COMMIT" : "DRY-RUN"}) ===\n`);

  const profSnap = await adminDb.collection("teacher_profiles").get();
  console.log(`- 전체 teacher_profiles: ${profSnap.size}건`);

  const pollutedNames: { docId: string; email: string; oldName: string }[] = [];
  const adminDepts: { docId: string; email: string; oldDepts: string[] }[] = [];

  const TARGET_ADMINS = new Set(["admin@hmh.or.kr", "admin2@hmh.or.kr", "admin3@hmh.or.kr", "tteacher@hmh.or.kr"]);

  for (const doc of profSnap.docs) {
    const data = doc.data() as any;
    const email = (data.email || doc.id).toLowerCase();
    const local = email.split("@")[0];
    const name = (data.name || "").trim();
    const depts: string[] = data.departments || [];

    // 1. 이름 오염 (profile.name == local-part)
    if (name && name.toLowerCase() === local.toLowerCase()) {
      pollutedNames.push({ docId: doc.id, email, oldName: name });
    }

    // 2. 관리자/시험 계정 "휴직 교사" 임시 배치
    if (TARGET_ADMINS.has(email) && depts.includes("휴직 교사")) {
      adminDepts.push({ docId: doc.id, email, oldDepts: depts });
    }
  }

  console.log(`\n1. 이름 오염 대상 (${pollutedNames.length}건):`);
  for (const p of pollutedNames) {
    console.log(`   - ${p.email.padEnd(28)} name="${p.oldName}" -> name=""`);
  }

  console.log(`\n2. 관리자/시험 계정 임시 배치 해제 대상 (${adminDepts.length}건):`);
  for (const a of adminDepts) {
    console.log(`   - ${a.email.padEnd(28)} departments=${JSON.stringify(a.oldDepts)} -> departments=[], noDept=true`);
  }

  if (!isCommit) {
    console.log(`\n(드라이런 종료 — 실제 Firestore 반영을 원하시면 --commit 플래그를 추가하여 실행하세요.)`);
    return;
  }

  console.log(`\n=== Firestore 커밋 진행 중… ===`);

  // 1. 이름 오염 정리
  for (const p of pollutedNames) {
    await adminDb.collection("teacher_profiles").doc(p.docId).update({
      name: "",
      updatedAt: Date.now(),
    });
    console.log(`  ✅ [이름 오염 초기화] ${p.email}`);
  }

  // 2. 관리자/시험 계정 부서 해제
  for (const a of adminDepts) {
    await adminDb.collection("teacher_profiles").doc(a.docId).update({
      departments: [],
      noDept: true,
      updatedAt: Date.now(),
    });
    console.log(`  ✅ [관리자 부서 해제] ${a.email}`);
  }

  // 감사 로그 기록
  await writeAuditLog({
    operatorEmail: OPERATOR,
    targetEmail: "ALL_PROFILES",
    action: "account_data_cleanup_20260813",
    details: `이름 오염 ${pollutedNames.length}건 초기화 + 관리자 계정 ${adminDepts.length}건 휴직 교사 부서 해제 완료`,
    status: "success",
  });

  console.log(`\n=== 커밋 완료 ===`);
}

main().catch((err) => {
  console.error("❌ 오류 발생:", err);
  process.exit(1);
});
