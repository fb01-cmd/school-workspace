/**
 * 읽기 전용 — teacher_profiles 89명의 GWS 표시 이름이 "사람 실명"인지 전수 점검.
 * check_name_diff.ts가 못 잡는 부류: profile.name과 GWS가 일치하지만
 * GWS 이름 자체가 별명·역할명·영문인 경우.
 */
import { adminDb } from "../src/lib/firebase/admin";
import { listUsersInOUs } from "../src/lib/google/workspace";

async function main() {
  const profSnap = await adminDb.collection("teacher_profiles").get();
  const emails = new Set(profSnap.docs.map((d) => d.id.toLowerCase()));
  const profName = new Map<string, string>();
  for (const d of profSnap.docs) {
    profName.set(d.id.toLowerCase(), ((d.data() as any).name || "").trim());
  }

  const gwsUsers = await listUsersInOUs(["all"]);
  const rows: { email: string; gws: string; prof: string; flags: string[] }[] = [];

  for (const u of gwsUsers) {
    const email = (u.primaryEmail || (u as any).email || "").toLowerCase();
    if (!email || !emails.has(email)) continue;
    let full = "";
    if (u.name) {
      full =
        u.name.fullName ||
        (u.name.familyName ? `${u.name.familyName}${u.name.givenName || ""}` : "");
    }
    full = (full || "").trim();

    const flags: string[] = [];
    if (!full) flags.push("GWS이름없음");
    if (/쌤|샘|선생|티처|teacher/i.test(full)) flags.push("별명·호칭");
    if (/[A-Za-z]/.test(full)) flags.push("영문포함");
    if (/[0-9]/.test(full)) flags.push("숫자포함");
    if (/관리자|공용|시험|테스트|데모|admin|test|demo/i.test(full)) flags.push("계정성격");
    const hangul = full.replace(/[^가-힣]/g, "");
    if (full && hangul.length !== full.length) flags.push("한글외문자");
    if (hangul.length > 4) flags.push(`한글${hangul.length}자(실명이례)`);

    rows.push({ email, gws: full, prof: profName.get(email) || "", flags });
  }

  rows.sort((a, b) => b.flags.length - a.flags.length || a.email.localeCompare(b.email));

  const flagged = rows.filter((r) => r.flags.length > 0);
  console.log(`teacher_profiles ${emails.size}명 중 GWS 매칭 ${rows.length}명`);
  console.log(`\n=== 의심 ${flagged.length}건 ===`);
  for (const r of flagged) {
    console.log(
      ` ${r.email.padEnd(28)} gws="${r.gws}"  prof="${r.prof}"  [${r.flags.join(", ")}]`
    );
  }

  console.log(`\n=== 정상으로 보이는 ${rows.length - flagged.length}건 (실명 2~4자) ===`);
  console.log(
    rows
      .filter((r) => r.flags.length === 0)
      .map((r) => r.gws)
      .join(" · ")
  );

  // 동명이인 실측 — GWS 표시 이름이 겹치는 쌍
  const byName = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.gws) continue;
    byName.set(r.gws, [...(byName.get(r.gws) || []), r.email]);
  }
  const dups = [...byName.entries()].filter(([, v]) => v.length > 1);
  console.log(`\n=== GWS 이름이 겹치는 쌍 ${dups.length}건 (§11-5 동명이인 실측) ===`);
  for (const [name, mails] of dups) console.log(` "${name}" ← ${mails.join(", ")}`);

  const noProfile = [...emails].filter((e) => !rows.some((r) => r.email === e));
  if (noProfile.length) {
    console.log(`\n=== GWS 계정이 없는데 프로필만 남은 것 ${noProfile.length}건 ===`);
    for (const e of noProfile) {
      const d = profSnap.docs.find((x) => x.id.toLowerCase() === e);
      const data = (d?.data() || {}) as any;
      console.log(
        ` ${e}  name="${data.name || ""}"  departments=${JSON.stringify(
          data.departments || []
        )}  noDept=${data.noDept}`
      );
      console.log(
        `   → 쪽지 수신자 자격(소속 등록 여부): ${
          (data.departments || []).length > 0 ? "⚠️ 있음 — 목록에 뜬다" : "없음"
        }`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
