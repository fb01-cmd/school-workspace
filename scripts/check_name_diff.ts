import { adminDb } from "../src/lib/firebase/admin";
import { listUsersInOUs } from "../src/lib/google/workspace";

async function checkNameDiff() {
  console.log("Fetching teacher_profiles from Firestore...");
  const profSnap = await adminDb.collection("teacher_profiles").get();
  const profiles = profSnap.docs.map((doc) => ({
    email: doc.id.toLowerCase(),
    ...doc.data(),
  })) as { email: string; name?: string }[];

  console.log(`Total teacher_profiles: ${profiles.length}`);

  console.log("Fetching GWS users via listUsersInOUs...");
  const gwsUsers = await listUsersInOUs(["all"]);
  console.log(`Total GWS users: ${gwsUsers.length}`);

  const gwsNameMap = new Map<string, string>();
  for (const u of gwsUsers) {
    const email = (u.primaryEmail || (u as any).email || "").toLowerCase();
    if (!email) continue;
    let fullName = "";
    if (u.name) {
      fullName =
        u.name.fullName ||
        (u.name.familyName
          ? `${u.name.familyName}${u.name.givenName || ""}`
          : "");
    }
    if (fullName) {
      gwsNameMap.set(email, fullName.trim());
    }
  }

  let diffCount = 0;
  const diffs: { email: string; profileName: string; gwsName: string }[] = [];

  for (const p of profiles) {
    const profileName = (p.name || "").trim();
    const gwsName = (gwsNameMap.get(p.email) || "").trim();

    if (profileName && gwsName && profileName !== gwsName) {
      diffCount++;
      diffs.push({ email: p.email, profileName, gwsName });
    }
  }

  console.log("\n==========================================");
  console.log(`89명 중 teacher_profiles.name과 GWS 이름이 다른 사람 수: ${diffCount}`);
  console.log("==========================================");

  if (diffs.length > 0) {
    console.log("Difference details:");
    for (const d of diffs) {
      console.log(` - ${d.email}: profile="${d.profileName}" vs gws="${d.gwsName}"`);
    }
  }
}

checkNameDiff().catch((err) => {
  console.error("Error checking name diff:", err);
  process.exit(1);
});
