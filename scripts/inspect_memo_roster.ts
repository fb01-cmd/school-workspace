/**
 * 읽기 전용 — 쪽지 수신자 목록(= 조직도에 소속이 등록된 계정)에 실제로 뜨는 사람이 누구인지.
 * §11-5 동명이인·별명 판정은 "teacher_profiles 89명"이 아니라 이 명단 기준이어야 한다.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { listUsersInOUs } from "../src/lib/google/workspace";

async function main() {
  const profSnap = await adminDb.collection("teacher_profiles").get();
  const gwsUsers = await listUsersInOUs(["all"]);
  const gwsName = new Map<string, string>();
  for (const u of gwsUsers) {
    const email = (u.primaryEmail || (u as any).email || "").toLowerCase();
    if (!email) continue;
    let full = "";
    if (u.name) {
      full =
        u.name.fullName ||
        (u.name.familyName ? `${u.name.familyName}${u.name.givenName || ""}` : "");
    }
    if (full) gwsName.set(email, full.trim());
  }

  const inRoster: { email: string; shown: string; depts: string[] }[] = [];
  const excluded: { email: string; shown: string; why: string }[] = [];

  for (const d of profSnap.docs) {
    const email = d.id.toLowerCase();
    const data = d.data() as any;
    const depts: string[] = data.departments || [];
    // 표시 이름 = §11-7 0단계 확정 규칙(로컬부 오염 가드 포함)
    const local = email.split("@")[0];
    const pn = (data.name || "").trim();
    const shown =
      pn && pn.toLowerCase() !== local.toLowerCase()
        ? pn
        : gwsName.get(email) || local;

    if (data.noDept === true) excluded.push({ email, shown, why: "noDept=true" });
    else if (depts.length === 0) excluded.push({ email, shown, why: "부서 없음" });
    else inRoster.push({ email, shown, depts });
  }

  console.log(`쪽지 수신자 목록에 뜨는 인원: ${inRoster.length}명`);
  console.log(`목록에서 빠지는 인원: ${excluded.length}명\n`);

  console.log("=== 목록에서 빠지는 계정 ===");
  for (const e of excluded) console.log(` ${e.email.padEnd(26)} "${e.shown}"  (${e.why})`);

  const byName = new Map<string, string[]>();
  for (const r of inRoster) byName.set(r.shown, [...(byName.get(r.shown) || []), r.email]);
  const dups = [...byName.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n=== 목록 안에서 이름이 겹치는 쌍: ${dups.length}건 ===`);
  for (const [n, m] of dups) console.log(` "${n}" ← ${m.join(", ")}`);

  const odd = inRoster.filter((r) =>
    /쌤|샘|선생|관리자|공용|시험|테스트|데모|튜터|[A-Za-z0-9]/.test(r.shown)
  );
  console.log(`\n=== 목록 안에서 실명이 아닌 표기: ${odd.length}건 ===`);
  for (const r of odd)
    console.log(` ${r.email.padEnd(26)} "${r.shown}"  부서=${JSON.stringify(r.depts)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
