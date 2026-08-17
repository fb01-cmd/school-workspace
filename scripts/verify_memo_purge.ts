/**
 * 쪽지 파기 크론 검증 — 실계정 사이클 (memo_spec §6 + memo_attachment_spec §6)
 *
 * 시나리오를 실제로 만들어 돌린다:
 *   A. 만료 쪽지(첨부 1장 포함) → 파기 시 문서·Drive 파일 동반 삭제
 *   B. staging 고아(24h 경과 백데이트) → 파기 시 파일·staging 문서 삭제
 *   C. 빈 지난달 폴더(2026/01 인위 생성) → 파기 시 폴더·캐시 키 삭제
 * dryRun 선행 → 실파기 → 잔존 0 확인. 실패해도 finally가 흔적을 지운다.
 * 알림 억제: 문서를 admin SDK로 직접 만들므로 푸시·알림 경로를 타지 않는다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_memo_purge.ts
 */
import { adminDb } from "../src/lib/firebase/admin";
import {
  driveOrThrow,
  folderCacheRef,
  getMemoMonthFolderId,
  uploadMemoAttachment,
} from "../src/lib/memo/attachments";
import { runMemoPurge } from "../src/lib/memo/purge";
import { FieldPath, FieldValue } from "firebase-admin/firestore";

let failed = 0;
function expect(name: string, cond: boolean) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const DOMAIN = "hmh.or.kr";
const ME = "fb01@hmh.or.kr"; // 보호 계정 — 실사용자 아님

async function fileGone(drive: ReturnType<typeof driveOrThrow>, fileId: string): Promise<boolean> {
  return drive.files
    .get({ fileId, fields: "id" })
    .then(() => false)
    .catch((e: any) => e?.code === 404);
}

async function main() {
  const drive = driveOrThrow();
  const memoRef = adminDb.collection("memos").doc(DOMAIN).collection("items").doc(`purgetest_${Date.now()}`);
  let attFileId = "";
  let orphanFileId = "";
  let pastFolderId = "";
  const pastKey = "쪽지/2026/01";

  try {
    // ── 준비 A: 만료 쪽지 + 첨부 ──
    const att = await uploadMemoAttachment({
      uploaderEmail: ME,
      domain: DOMAIN,
      safeName: "purge_a.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    attFileId = att.driveFileId;
    await adminDb.collection("attachment_staging").doc(attFileId).delete(); // 발송 소거 시뮬레이션
    const now = Date.now();
    await memoRef.set({
      senderEmail: ME,
      senderName: "파기시험",
      title: "파기 검증",
      body: "-",
      links: [],
      recipientEmails: [ME],
      recipientCount: 1,
      recipientSummary: "",
      reads: {},
      createdAt: now - 400 * 24 * 3600 * 1000,
      expireAt: now - 24 * 3600 * 1000, // 만료 상태
      attachments: [att],
    });

    // ── 준비 B: staging 고아 (25h 백데이트) ──
    const orphan = await uploadMemoAttachment({
      uploaderEmail: ME,
      domain: DOMAIN,
      safeName: "purge_b.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    orphanFileId = orphan.driveFileId;
    await adminDb
      .collection("attachment_staging")
      .doc(orphanFileId)
      .set({ createdAt: Date.now() - 25 * 3600 * 1000 }, { merge: true });

    // ── 준비 C: 빈 지난달 폴더 (2026/01) ──
    pastFolderId = await getMemoMonthFolderId(drive, new Date(2026, 0, 15), { skipCache: true });
    await folderCacheRef().set({ ids: { [pastKey]: pastFolderId } }, { merge: true });

    // ── dryRun — 집계만, 아무것도 안 지움 ──
    const dry = await runMemoPurge([DOMAIN], { dryRun: true });
    expect("dryRun — 만료 쪽지 집계 ≥1", dry.expiredFound >= 1);
    expect("dryRun — staging 고아 집계 ≥1", dry.stagingOrphansFound >= 1);
    expect("dryRun — 빈 지난달 폴더 집계 ≥1", dry.monthFoldersDeleted >= 1);
    const stillThere =
      (await memoRef.get()).exists && !(await fileGone(drive, attFileId)) && !(await fileGone(drive, orphanFileId));
    expect("dryRun — 실제 삭제 0 (문서·파일 전부 잔존)", stillThere);

    // ── 실파기 ──
    const real = await runMemoPurge([DOMAIN], {});
    expect("실파기 — Drive 미가용 아님", !real.driveUnavailable);
    expect("실파기 — 만료 쪽지 문서 삭제", !(await memoRef.get()).exists);
    expect("실파기 — 첨부 Drive 파일 삭제", await fileGone(drive, attFileId));
    expect("실파기 — 고아 파일 삭제", await fileGone(drive, orphanFileId));
    expect(
      "실파기 — 고아 staging 문서 삭제",
      !(await adminDb.collection("attachment_staging").doc(orphanFileId).get()).exists
    );
    expect("실파기 — 빈 지난달 폴더 삭제", await fileGone(drive, pastFolderId));
    const cacheAfter = (await folderCacheRef().get()).data()?.ids || {};
    expect("실파기 — 폴더 캐시 키 정리", cacheAfter[pastKey] === undefined);
    expect("실파기 — 보류 0", real.memosDeferred === 0);
  } finally {
    // 흔적 삭제 — 파기가 실패했을 경우 대비 잔존물 정리
    await memoRef.delete().catch(() => {});
    for (const id of [attFileId, orphanFileId, pastFolderId]) {
      if (id) await drive.files.delete({ fileId: id }).catch(() => {});
    }
    for (const id of [attFileId, orphanFileId]) {
      if (id) await adminDb.collection("attachment_staging").doc(id).delete().catch(() => {});
    }
    await folderCacheRef()
      .update(new FieldPath("ids", pastKey), FieldValue.delete())
      .catch(() => {});
  }

  console.log(failed === 0 ? "\n전체 통과 ✅" : `\n실패 ${failed}건 ❌`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
