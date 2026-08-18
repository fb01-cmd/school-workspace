/**
 * 쪽지 첨부(2단계) 자가 테스트 — docs/memo_attachment_spec.md §7
 *
 * 1부: 순수 검증 로직 (네트워크·Firestore 무의존)
 * 2부: 실계정 사이클 (DWD 자격증명이 환경에 있을 때만) —
 *      업로드 → staging 대조(위조 차단) → 소거(재사용 차단) → 파일명 확정·권한 부여 →
 *      권한 실측 → 회수 → 파기, 흔적 삭제(기존 selftest 규약: 알림 억제·잔존물 0).
 *      권한 부여 대상은 보호 계정 fb01@ — sendNotificationEmail:false라 어떤 알림도 나가지 않는다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/memo_attachment_selftest.ts
 */
import {
  MEMO_ATTACHMENT_MAX_BYTES,
  decideAttachmentShareMode,
  resolveAttachmentViewEligibility,
  sanitizeAttachmentName,
  sniffImageMime,
  validateAttachmentIds,
  validateAttachmentUpload,
} from "../src/lib/memo/attachment_logic";

let failed = 0;
function expect(name: string, cond: boolean) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

// 1×1 투명 PNG (유효한 실제 이미지 바이트)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
// 1×1 투명 GIF89a (유효한 실제 GIF 바이트 — richtext spec §9)
const TINY_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function pureTests() {
  console.log("── 1부: 순수 검증 로직 ──");

  const pngOk = validateAttachmentUpload({ name: "양해 카드.png", mimeType: "image/png", bytes: TINY_PNG });
  expect("정상 PNG 통과", pngOk.ok);
  expect("image/jpg 별칭 정규화 후 서명 불일치 거부",
    !validateAttachmentUpload({ name: "a.jpg", mimeType: "image/jpg", bytes: TINY_PNG }).ok);
  expect("정상 GIF 통과 (richtext spec §9)",
    validateAttachmentUpload({ name: "a.gif", mimeType: "image/gif", bytes: TINY_GIF }).ok);
  expect("GIF 선언 + PNG 바이트 위장 거부",
    !validateAttachmentUpload({ name: "a.gif", mimeType: "image/gif", bytes: TINY_PNG }).ok);
  expect("화이트리스트 밖 MIME 거부(bmp)",
    !validateAttachmentUpload({ name: "a.bmp", mimeType: "image/bmp", bytes: TINY_PNG }).ok);
  expect("선언 MIME과 바이트 서명 불일치 거부(PNG 바이트를 jpeg로 선언)",
    !validateAttachmentUpload({ name: "a.jpg", mimeType: "image/jpeg", bytes: TINY_PNG }).ok);
  expect("빈 파일 거부", !validateAttachmentUpload({ name: "a.png", mimeType: "image/png", bytes: new Uint8Array(0) }).ok);
  {
    const over = new Uint8Array(MEMO_ATTACHMENT_MAX_BYTES + 1);
    over.set(TINY_PNG.subarray(0, 8), 0); // PNG 서명만 흉내
    expect("3.5MB 초과 거부", !validateAttachmentUpload({ name: "a.png", mimeType: "image/png", bytes: over }).ok);
  }
  expect("서명 판별: png", sniffImageMime(TINY_PNG) === "image/png");
  expect("서명 판별: jpeg", sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg");
  expect("서명 판별: gif (GIF89a)", sniffImageMime(TINY_GIF) === "image/gif");
  expect("서명 판별: GIF87a", sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) === "image/gif");
  expect("서명 판별: 텍스트는 null", sniffImageMime(new TextEncoder().encode("hello world!")) === null);

  expect("파일명 경로 구분자 치환", sanitizeAttachmentName("../etc/passwd.png") === ".._etc_passwd.png");
  expect("빈 파일명 폴백", sanitizeAttachmentName("   ") === "이미지");
  expect("100자 초과는 꼬리(확장자) 보존 절단", sanitizeAttachmentName("가".repeat(150) + ".png").endsWith(".png"));

  expect("첨부 id 생략 허용", (() => { const r = validateAttachmentIds(undefined); return r.ok && r.ids.length === 0; })());
  expect("첨부 id 6개 거부", !validateAttachmentIds(["a", "b", "c", "d", "e", "f"]).ok);
  expect("경로 문자 포함 id 거부", !validateAttachmentIds(["ab/cd"]).ok);
  expect("중복 id 병합", (() => { const r = validateAttachmentIds(["x", "x"]); return r.ok && r.ids.length === 1; })());

  {
    // 인라인 이미지 프록시 열람 자격 (richtext spec §13)
    const memo = {
      senderEmail: "sender@hmh.or.kr",
      recipientEmails: ["r1@hmh.or.kr", "r2@hmh.or.kr"],
      attachments: [{ driveFileId: "f1", name: "a.png", mimeType: "image/png", size: 10, webViewLink: "x" }],
    };
    expect("프록시 자격: 발신자 통과", resolveAttachmentViewEligibility(memo, "sender@hmh.or.kr", "f1").ok);
    expect("프록시 자격: 수신자 통과(대소문자 무시)", resolveAttachmentViewEligibility(memo, "R1@hmh.or.kr", "f1").ok);
    const outsider = resolveAttachmentViewEligibility(memo, "other@hmh.or.kr", "f1");
    expect("프록시 자격: 제3자 403", !outsider.ok && outsider.status === 403);
    const wrongAtt = resolveAttachmentViewEligibility(memo, "r1@hmh.or.kr", "f2");
    expect("프록시 자격: 남의 쪽지 첨부 id 404", !wrongAtt.ok && wrongAtt.status === 404);
    const noMemo = resolveAttachmentViewEligibility(null, "r1@hmh.or.kr", "f1");
    expect("프록시 자격: 쪽지 없음 404", !noMemo.ok && noMemo.status === 404);
  }

  expect("수신 20/교직원 60 → 개별 권한", decideAttachmentShareMode(20, 60) === "individual");
  expect("수신 55/교직원 60 → 도메인 공유", decideAttachmentShareMode(55, 60) === "domain");
  expect("교직원 수 0(디렉터리 이상) → 개별 권한", decideAttachmentShareMode(10, 0) === "individual");
}

async function liveCycle() {
  if (!process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    console.log("── 2부: 실계정 사이클 — 자격증명 없음, 건너뜀 (--env-file=.env.local 필요) ──");
    return;
  }
  console.log("── 2부: 실계정 사이클 (hmnotice@ Drive) ──");
  const { getDriveClient } = await import("../src/lib/google/workspace");
  const { adminDb } = await import("../src/lib/firebase/admin");
  const {
    uploadMemoAttachment,
    resolveStagedAttachments,
    deleteStagingDocs,
    finalizeMemoAttachments,
    revokeAttachmentAccess,
    getAttachmentQuota,
  } = await import("../src/lib/memo/attachments");

  const domain = "hmh.or.kr";
  const uploader = "fb01@hmh.or.kr"; // 보호 계정 — 실사용자 아님
  const recipient = "fb01@hmh.or.kr";
  const owner = process.env.GOOGLE_WORKSPACE_SENDER_EMAIL || "hmnotice@hmh.or.kr";
  const drive = getDriveClient(owner);
  if (!drive) throw new Error("Drive 클라이언트 초기화 실패");

  let fileId = "";
  const memoId = `attselftest_${Date.now()}`;
  try {
    // 업로드 + staging
    const att = await uploadMemoAttachment({
      uploaderEmail: uploader,
      domain,
      safeName: "selftest.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    fileId = att.driveFileId;
    expect("업로드 — fileId·webViewLink 수신", !!att.driveFileId && !!att.webViewLink);
    const stagingSnap = await adminDb.collection("attachment_staging").doc(fileId).get();
    expect("staging 문서 생성(uploader 기록)", stagingSnap.exists && stagingSnap.data()?.uploaderEmail === uploader);

    // 대조 — 남의 파일 id 끼워넣기 차단
    const forged = await resolveStagedAttachments([fileId], "intruder@hmh.or.kr", domain);
    expect("타인 명의 발송 대조 거부", !forged.ok);
    const legit = await resolveStagedAttachments([fileId], uploader, domain);
    expect("본인 발송 대조 통과(메타데이터는 staging 원본)", legit.ok && legit.attachments[0].name === "selftest.png");

    // 소거 — 재사용 차단
    await deleteStagingDocs([fileId]);
    const reuse = await resolveStagedAttachments([fileId], uploader, domain);
    expect("발송 후 같은 id 재사용 거부", !reuse.ok);

    // 마무리 — 파일명 확정 + 권한 부여 (알림 억제: sendNotificationEmail=false 경로)
    if (!legit.ok) throw new Error("대조 실패로 중단");
    await finalizeMemoAttachments({
      domain,
      memoId,
      attachments: legit.attachments,
      recipients: [recipient],
      shareMode: "individual",
    });
    const meta = await drive.files.get({ fileId, fields: "name" });
    expect(`파일명 memoId 접두 확정(역추적)`, (meta.data.name || "").startsWith(`${memoId}_1_`));
    const perms1 = await drive.permissions.list({ fileId, fields: "permissions(emailAddress, role, type)" });
    expect(
      "수신자 reader 권한 실측",
      (perms1.data.permissions || []).some(
        (p) => p.type === "user" && (p.emailAddress || "").toLowerCase() === recipient && p.role === "reader"
      )
    );

    // 회수 — 권한 철회
    await revokeAttachmentAccess(legit.attachments, [recipient]);
    const perms2 = await drive.permissions.list({ fileId, fields: "permissions(emailAddress, role)" });
    expect(
      "회수 후 수신자 권한 소멸",
      !(perms2.data.permissions || []).some((p) => (p.emailAddress || "").toLowerCase() === recipient && p.role === "reader")
    );

    // 운영 — 용량 보고
    const quota = await getAttachmentQuota();
    expect("attachment_quota — 사용량 수신", quota.limitBytes > 0);
    console.log(`  ℹ️ ${owner} Drive 사용량: ${(quota.usageBytes / 1024 ** 3).toFixed(3)}GB / ${(quota.limitBytes / 1024 ** 3).toFixed(0)}GB`);
  } finally {
    // 흔적 삭제 — 파일 영구 삭제(휴지통 우회) + staging 잔존 시 제거
    if (fileId) {
      await drive.files.delete({ fileId }).catch((e: any) => console.warn("  ⚠️ 파일 정리 실패:", e?.message));
      await adminDb.collection("attachment_staging").doc(fileId).delete().catch(() => {});
      const gone = await drive.files.get({ fileId, fields: "id" }).then(() => false).catch((e: any) => e?.code === 404);
      expect("파기 — 파일 잔존 없음", gone === true);
    }
  }
}

async function main() {
  await pureTests();
  await liveCycle();
  console.log(failed === 0 ? "\n전체 통과 ✅" : `\n실패 ${failed}건 ❌`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
