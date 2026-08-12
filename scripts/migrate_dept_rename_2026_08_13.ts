/**
 * 조직도 부서명 정정 + 관리자 계정 배치 (2026-08-13, 사용자 지시)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/migrate_dept_rename_2026_08_13.ts        (미리보기)
 *         APPLY=1 npx tsx --env-file=.env.local scripts/migrate_dept_rename_2026_08_13.ts (실행)
 *
 * ① "휴직 및 퇴직 교사" → "휴직 교사" 개명.
 *    근거: 퇴직 교사는 조직 단위에 실재하지 않아 이름이 사실과 달랐다(사용자 지적).
 *    대상 = settings/{domain}.departments 배열 + 그 부서를 쓰는 teacher_profiles 문서들.
 * ② 관리자 계정(admin·admin2·admin3)을 "휴직 교사"에 배치.
 *    근거: 쪽지 자격을 "소속이 실제로 있어야 통과"로 조이면 소속이 빈 관리자 계정이 막혀
 *    시연·테스트를 할 수 없다. 사용자 지시로 **일단** 이 부서에 둔다(임시 배치).
 *
 * 쓰기 9건(설정 1 + 프로필 5 + 관리자 3). 되돌리려면 같은 스크립트의 OLD/NEW를 뒤집으면 된다.
 */
import { adminDb } from "../src/lib/firebase/admin";

const DOMAIN = "hmh.or.kr";
const OLD = "휴직 및 퇴직 교사";
const NEW = "휴직 교사";
const ADMIN_ACCOUNTS = ["admin@hmh.or.kr", "admin2@hmh.or.kr", "admin3@hmh.or.kr"];
const APPLY = process.env.APPLY === "1";

async function main() {
  const plan: string[] = [];

  // ① settings.departments
  const sRef = adminDb.collection("settings").doc(DOMAIN);
  const sSnap = await sRef.get();
  const depts: string[] = sSnap.data()?.departments || [];
  const idx = depts.indexOf(OLD);
  if (idx >= 0) {
    const next = [...depts];
    next[idx] = NEW;
    plan.push(`settings/${DOMAIN}.departments[${idx}] "${OLD}" → "${NEW}"`);
    if (APPLY) await sRef.update({ departments: next });
  } else {
    plan.push(`settings/${DOMAIN}.departments — "${OLD}" 없음 (건너뜀)`);
  }

  // ② 그 부서를 쓰는 프로필
  const profs = await adminDb.collection("teacher_profiles").get();
  for (const d of profs.docs) {
    const arr: string[] = d.data().departments || [];
    if (!arr.includes(OLD)) continue;
    const next = arr.map((x) => (x === OLD ? NEW : x));
    plan.push(`teacher_profiles/${d.id}.departments ${JSON.stringify(arr)} → ${JSON.stringify(next)}`);
    if (APPLY) await d.ref.update({ departments: next });
  }

  // ③ 관리자 계정 배치
  for (const email of ADMIN_ACCOUNTS) {
    const ref = adminDb.collection("teacher_profiles").doc(email);
    const snap = await ref.get();
    if (!snap.exists) {
      plan.push(`teacher_profiles/${email} — 문서 없음 (건너뜀)`);
      continue;
    }
    const arr: string[] = snap.data()?.departments || [];
    if (arr.length > 0) {
      plan.push(`teacher_profiles/${email} — 이미 소속 ${JSON.stringify(arr)} (건너뜀)`);
      continue;
    }
    plan.push(`teacher_profiles/${email} 소속 배치 [] → ["${NEW}"], noDept true → false`);
    if (APPLY) await ref.update({ departments: [NEW], noDept: false });
  }

  console.log(APPLY ? "── 실행 완료 ──" : "── 미리보기 (실행하려면 APPLY=1) ──");
  for (const p of plan) console.log(`  ${p}`);

  if (APPLY) {
    // 검증 — 옛 이름이 어디에도 남아 있지 않아야 한다
    const after = await adminDb.collection("teacher_profiles").get();
    const left = after.docs.filter((d) => (d.data().departments || []).includes(OLD));
    const sAfter = await sRef.get();
    const sLeft = (sAfter.data()?.departments || []).includes(OLD);
    console.log(`\n── 검증 ──`);
    console.log(`  settings에 옛 이름 잔존: ${sLeft ? "❌" : "✅ 없음"}`);
    console.log(`  프로필에 옛 이름 잔존: ${left.length ? `❌ ${left.map((d) => d.id).join(", ")}` : "✅ 없음"}`);
    for (const email of ADMIN_ACCOUNTS) {
      const s = await adminDb.collection("teacher_profiles").doc(email).get();
      console.log(`  ${email} 소속: ${JSON.stringify(s.data()?.departments || [])}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
