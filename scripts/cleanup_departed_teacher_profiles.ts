/**
 * 전출·명퇴 등으로 떠난 교사의 잔존 teacher_profiles 일회성 정리 (2026-08-07 조직도 결함 후속)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/cleanup_departed_teacher_profiles.ts           ← 드라이런 (전수 판정·원본 JSON 출력)
 *   APPLY=1 npx tsx --env-file=.env.local scripts/cleanup_departed_teacher_profiles.ts  ← 보관소 이동 + 삭제 + 감사 로그
 *
 * 판정 기준 (자동 정리 대상):
 *   ① 계정이 GWS에 없음(삭제됨)  ② OB 보존실 OU 소속  ③ 학생 전출및자퇴 OU 소속
 * 교직원 OU 밖이지만 위에 해당하지 않는 계정은 "확인 필요"로만 보고 (행정·특수 계정 오삭 방지).
 * 삭제 전 원본을 teacher_profiles_archive/{domain}/profiles/{email}에 보관 — 언제든 복원 가능.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { writeAuditLog } from "../src/lib/firebase/audit-server";
import { getUser } from "../src/lib/google/workspace";
import { snapshotBeforeDestruction } from "./lib/firestoreBackup";

const DOMAIN = "hmh.or.kr";
const OPERATOR = "playviolin@hmh.or.kr";

async function run() {
  const sSnap = await adminDb.collection("settings").doc(DOMAIN).get();
  const sData = sSnap.exists ? sSnap.data() || {} : {};
  const teachersOU = ((sData.ouMapping?.teachers as string) || "").toLowerCase();
  const teachersOB = ((sData.ouMapping?.teachersOB as string) || "").toLowerCase();
  console.log(`교직원 OU: ${teachersOU || "(미설정)"} / OB 보존실: ${teachersOB || "(미설정)"}`);

  const profSnap = await adminDb.collection("teacher_profiles").get();
  console.log(`teacher_profiles 총 ${profSnap.size}건 전수 대조 시작…\n`);

  const removals: Array<{ email: string; reason: string; data: any }> = [];
  const reviews: Array<{ email: string; orgPath: string }> = [];

  for (const doc of profSnap.docs) {
    const email = (doc.data()?.email || doc.id).toLowerCase();
    let orgPath = "";
    let missing = false;
    try {
      const u = await getUser(email);
      orgPath = ((u?.orgUnitPath as string) || "").toLowerCase();
    } catch {
      missing = true;
    }
    if (missing) {
      removals.push({ email, reason: "GWS 계정 없음(삭제됨)", data: doc.data() });
    } else if (teachersOB && (orgPath === teachersOB || orgPath.startsWith(teachersOB + "/"))) {
      removals.push({ email, reason: `OB 보존실 소속 (${orgPath})`, data: doc.data() });
    } else if (orgPath.includes("전출및자퇴")) {
      removals.push({ email, reason: `전출및자퇴 OU 소속 (${orgPath})`, data: doc.data() });
    } else if (teachersOU && orgPath !== teachersOU && !orgPath.startsWith(teachersOU + "/")) {
      reviews.push({ email, orgPath });
    }
  }

  console.log(`[자동 정리 대상] ${removals.length}건`);
  for (const r of removals) {
    console.log(`  - ${r.email} | ${r.reason}`);
    console.log(`    원본: ${JSON.stringify(r.data)}`);
  }
  console.log(`\n[확인 필요 — 교직원 OU 밖이지만 자동 기준 미해당, 미조치] ${reviews.length}건`);
  reviews.forEach((r) => console.log(`  - ${r.email} | ${r.orgPath || "(OU 미상)"}`));

  if (process.env.APPLY !== "1") {
    console.log("\n(드라이런 — 대상 눈 대조 후 APPLY=1로 정리. 원본은 보관소로 이동되어 복원 가능)");
    return;
  }

  // 위험 직전 스냅샷 (docs/backup_restore_spec.md §2-A) — 지우기 전에 원본을 보관한다.
  // 아래 루프가 teacher_profiles를 보관소로 옮기긴 하지만 teacher_profiles_pending은
  // 보관 없이 삭제한다. 스냅샷은 그 격차까지 함께 덮는다.
  await snapshotBeforeDestruction(
    adminDb,
    ["teacher_profiles", "teacher_profiles_pending"],
    "cleanup_departed_teacher_profiles"
  );

  for (const r of removals) {
    await adminDb
      .collection("teacher_profiles_archive").doc(DOMAIN)
      .collection("profiles").doc(r.email)
      .set({ ...r.data, archivedAt: Date.now(), archivedBy: OPERATOR, archiveReason: `stale_cleanup: ${r.reason}` });
    await adminDb.collection("teacher_profiles").doc(r.email).delete();
    const pendRef = adminDb.collection("teacher_profiles_pending").doc(r.email);
    if ((await pendRef.get()).exists) await pendRef.delete();
    await writeAuditLog({
      operatorEmail: OPERATOR,
      targetEmail: r.email,
      action: "teacher_profile_stale_cleanup",
      details: `잔존 조직도 프로필 정리(보관소 이동 후 삭제) — ${r.reason}`,
      status: "success",
    });
    console.log(`  정리됨: ${r.email}`);
  }
  console.log("\n정리 완료 — 조직도에서 사라졌는지 화면 확인 권장.");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
