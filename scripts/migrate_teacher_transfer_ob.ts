import { adminDb } from "../src/lib/firebase/admin";
import { getUser, updateUser } from "../src/lib/google/workspace";

async function main() {
  const domain = "hmh.or.kr";
  console.log(`Starting migration for domain: ${domain}...`);

  // 1. Fetch settings for OB OU
  const sSnap = await adminDb.collection("settings").doc(domain).get();
  const sData = sSnap.exists ? sSnap.data() || {} : {};
  const teachersOBOU = sData.ouMapping?.teachersOB || "/교직원/OB 보존실";
  console.log(`Target OB OU: ${teachersOBOU}`);

  // 2. Target teachers mentioned in spec
  const targetEmails = ["donghwan1008@hmh.or.kr", "jjinwoni@hmh.or.kr", "hjl@hmh.or.kr"];

  const results: any[] = [];

  for (const emailInput of targetEmails) {
    const email = emailInput.includes("@") ? emailInput : `${emailInput}@${domain}`;
    const taskRef = adminDb.collection("teacher_transfer_tasks").doc(domain).collection("teachers").doc(email);
    const taskSnap = await taskRef.get();

    let taskData = taskSnap.exists ? taskSnap.data() : null;

    console.log(`\nProcessing ${email}...`);
    console.log(`Task exists in Firestore: ${taskSnap.exists}`);

    let originalOU = taskData?.originalOU || "";
    let currentOU = "";
    try {
      const gwsUser = await getUser(email);
      currentOU = gwsUser.orgUnitPath || "";
      if (!originalOU) {
        originalOU = currentOU;
      }
    } catch (err: any) {
      console.error(`Failed to fetch GWS user for ${email}:`, err.message);
    }

    console.log(`Original OU: '${originalOU}', Current GWS OU: '${currentOU}'`);

    if (taskSnap.exists) {
      await taskRef.set({ originalOU }, { merge: true });
      console.log(`Updated task document for ${email} with originalOU='${originalOU}'`);
    }

    let newOU = currentOU;
    let moveSuccess = false;
    let errorMsg = "";

    if (teachersOBOU && currentOU !== teachersOBOU) {
      try {
        await updateUser(email, { orgUnitPath: teachersOBOU });
        newOU = teachersOBOU;
        moveSuccess = true;
        console.log(`Successfully moved ${email} to ${teachersOBOU}`);
      } catch (err: any) {
        errorMsg = err.message;
        console.error(`Failed to move ${email} to ${teachersOBOU}:`, err.message);
      }
    } else if (currentOU === teachersOBOU) {
      moveSuccess = true;
      console.log(`${email} is already in ${teachersOBOU}`);
    }

    results.push({
      email,
      originalOU,
      currentOUBefore: currentOU,
      ouAfter: newOU,
      moveSuccess,
      errorMsg,
    });
  }

  console.log("\n================ Migration Summary ================");
  console.log(JSON.stringify(results, null, 2));
  console.log("===================================================");
}

main().catch(err => {
  console.error("Migration script error:", err);
  process.exit(1);
});
