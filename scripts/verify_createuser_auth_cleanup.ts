/**
 * 2026-08-19 배포 후 실증: createUser의 stale Firebase Auth 정리 (성공 뒤 실행 순서).
 *
 * 검증 1 — 고침이 실제로 작동하는가:
 *   실패 조건(옛 Google sub가 링크된 Auth 레코드)을 **일부러 심어 두고** 전입생을
 *   새로 만든다. 생성 직후 그 레코드가 사라져 있으면, 사람이 손대지 않아도
 *   auth/provider-already-linked가 나지 않는다는 뜻이다.
 *   (새 일련번호는 stale 레코드가 없어 그냥 만들면 아무것도 증명하지 못한다.)
 *
 * 검증 2 — 순서 교정이 실제로 지켜지는가:
 *   이미 있는 번호로 생성을 시도한다. insert는 409로 실패해야 하고,
 *   그 계정의 Firestore `users` 문서(=role의 원본)는 **그대로 남아 있어야** 한다.
 *   교정 전 코드였다면 여기서 문서가 지워진다.
 *
 * 기본은 DRY RUN(계획만 출력). 실제 실행은 `--apply`.
 * 정리는 `--cleanup` (심어 둔 것과 만든 계정을 되돌린다).
 */
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createUser, deleteUser, isMock } from "@/lib/google/workspace";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const APPLY = process.argv.includes("--apply");
const CLEANUP = process.argv.includes("--cleanup");

const EMAIL = process.argv.find((a) => a.startsWith("--email="))?.split("=")[1];
const OU = process.argv.find((a) => a.startsWith("--ou="))?.split("=")[1];

// 실패 조건 재현용 가짜 Google sub — 실제 존재하지 않는 값이어야 한다
const FAKE_SUB = "999888777666555444333";
const STALE_UID = "stale-authtest-uid-20260819";

const auth = getAuth();
const db = getFirestore();

const line = (s = "") => console.log(s);

async function snapshot(email: string, label: string) {
  const rec = await auth.getUserByEmail(email).catch(() => null);
  const snap = await db.collection("users").where("email", "==", email).get();
  line(`  [${label}]`);
  line(`     Firebase Auth : ${rec ? `uid=${rec.uid} providers=[${rec.providerData.map((p) => `${p.providerId}:${p.uid}`).join(", ")}]` : "없음"}`);
  line(`     users 문서    : ${snap.size}건 ${snap.size ? `(${snap.docs.map((d) => d.id).join(", ")})` : ""}`);
  return { authUid: rec?.uid ?? null, authSubs: rec?.providerData.map((p) => p.uid) ?? [], docIds: snap.docs.map((d) => d.id) };
}

async function cleanup(email: string) {
  line(`정리: ${email}`);
  const rec = await auth.getUserByEmail(email).catch(() => null);
  if (rec) { await auth.deleteUser(rec.uid); line(`   Auth 레코드 삭제 (uid ${rec.uid})`); }
  const snap = await db.collection("users").where("email", "==", email).get();
  if (!snap.empty) {
    const b = db.batch(); snap.forEach((d) => b.delete(d.ref)); await b.commit();
    line(`   users 문서 ${snap.size}건 삭제`);
  }
  await deleteUser(email).then(() => line("   GWS 계정 삭제")).catch((e: any) => line(`   GWS 계정 삭제 실패/없음: ${e.message}`));
}

async function main() {
  if (!EMAIL) throw new Error("--email=<주소> 가 필요합니다.");
  line(`대상: ${EMAIL}   (isMock=${isMock})`);
  if (isMock) throw new Error("자격증명이 없어 mock 모드다 — 실증이 되지 않는다.");
  line();

  if (CLEANUP) { await cleanup(EMAIL); return; }

  line("── 시작 상태 ──");
  await snapshot(EMAIL, "before");
  line();

  if (!APPLY) {
    line("DRY RUN — 실제 실행은 `--apply`. 아래를 수행한다:");
    line(`  1. Auth에 stale 레코드 심기 (google.com:${FAKE_SUB})`);
    line(`  2. createUser(${EMAIL}, OU=${OU})`);
    line("  3. Auth 레코드가 사라졌는지 확인  ← 검증 1");
    line("  4. users 문서를 하나 심고, 같은 이메일로 createUser 재시도");
    line("  5. 생성은 실패하고 users 문서는 남아 있는지 확인  ← 검증 2");
    return;
  }
  if (!OU) throw new Error("--ou=<조직단위 경로> 가 필요합니다.");

  // ── 검증 1 ──────────────────────────────────────────────────────────────
  line("── 검증 1: stale Auth 레코드가 있는 상태에서 계정 생성 ──");
  await auth.importUsers([
    { uid: STALE_UID, email: EMAIL, emailVerified: true,
      providerData: [{ uid: FAKE_SUB, providerId: "google.com", email: EMAIL }] } as any,
  ]);
  line(`  실패 조건 심음: Auth uid=${STALE_UID}, google sub=${FAKE_SUB}`);
  await snapshot(EMAIL, "생성 직전");

  await createUser(EMAIL, "전입테스트", "0000", OU, "1234abcd!!!!", true);
  line("  createUser 성공");
  const after1 = await snapshot(EMAIL, "생성 직후");

  const test1 = after1.authUid === null;
  line(`  ▶ 검증 1: ${test1 ? "통과 — stale 레코드가 자동으로 사라졌다" : "실패 — 레코드가 남아 있다 (로그인 시 재발)"}`);
  line();

  // ── 검증 2 ──────────────────────────────────────────────────────────────
  line("── 검증 2: 이미 있는 번호로 생성 재시도 (users 문서 보존) ──");
  const guardDocId = "authtest-guard-doc-20260819";
  await db.collection("users").doc(guardDocId).set({
    email: EMAIL, role: "student", _note: "createUser 순서 교정 검증용 임시 문서 (2026-08-19)",
  });
  line(`  users 문서 심음: ${guardDocId} (role=student)`);
  await snapshot(EMAIL, "재시도 직전");

  let insertFailed = false;
  try {
    await createUser(EMAIL, "전입테스트", "0000", OU, "1234abcd!!!!", true);
    line("  ⚠️ createUser가 성공했다 — 중복 생성이 막히지 않았다는 뜻");
  } catch (e: any) {
    insertFailed = true;
    line(`  createUser 실패 (예상대로): ${e.code || ""} ${e.message}`);
  }
  const after2 = await snapshot(EMAIL, "재시도 직후");

  const test2 = insertFailed && after2.docIds.includes(guardDocId);
  line(`  ▶ 검증 2: ${test2 ? "통과 — 생성은 실패하고 권한 문서는 살아남았다" : "실패 — 멀쩡한 계정의 권한 문서가 지워졌다"}`);

  await db.collection("users").doc(guardDocId).delete().catch(() => {});
  line(`  임시 문서 제거: ${guardDocId}`);
  line();

  line(`결과: 검증1 ${test1 ? "PASS" : "FAIL"} / 검증2 ${test2 ? "PASS" : "FAIL"}`);
  line(`남은 것: ${EMAIL} 계정으로 실기기 로그인 (스크립트는 충돌 소멸까지만 증명한다)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
