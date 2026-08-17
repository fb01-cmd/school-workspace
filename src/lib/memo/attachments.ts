// 쪽지 2단계 — 첨부 서버부 (docs/memo_attachment_spec.md §1~§3·§7)
// 저장 소유 = hmnotice@ Drive (§1, 보호 계정). 클라이언트는 Drive에 직접 닿지 않는다 — DWD 키는 서버 전용(§3-2).
import { Readable } from "stream";
import { adminDb } from "@/lib/firebase/admin";
import { getDriveClient } from "@/lib/google/workspace";
import { FieldValue } from "firebase-admin/firestore";
import { AttachmentShareMode, MemoAttachment } from "./attachment_logic";

type Drive = NonNullable<ReturnType<typeof getDriveClient>>;

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** 첨부 소유 계정 (§1) — 발신자 규칙과 같은 폴백 순서 */
const attachmentOwnerEmail = () =>
  process.env.GOOGLE_WORKSPACE_SENDER_EMAIL ||
  process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL ||
  "hmnotice@hmh.or.kr";

export const folderCacheRef = () => adminDb.collection("platform_config").doc("attachment_folders");
const stagingRef = (fileId: string) => adminDb.collection("attachment_staging").doc(fileId);
const memoRef = (domain: string, memoId: string) =>
  adminDb.collection("memos").doc(domain).collection("items").doc(memoId);

export function driveOrThrow(): Drive {
  const drive = getDriveClient(attachmentOwnerEmail());
  if (!drive) throw new Error("Drive 클라이언트를 초기화하지 못했습니다(모의 모드).");
  return drive;
}

// ── 폴더 관리 (§2) ──────────────────────────────────────────────

async function findOrCreateFolder(
  drive: Drive,
  name: string,
  parentId: string | null
): Promise<string> {
  const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
  const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false and ${parentClause}`;
  const found = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
    fields: "id",
  });
  return created.data.id!;
}

/**
 * 이번 달 업로드 폴더(내 드라이브/플랫폼 첨부/쪽지/YYYY/MM) id.
 * platform_config/attachment_folders에 경로→id 캐시 — 월당 Drive 왕복 1회(§2).
 * 서버 시간대(UTC) 기준이라 KST 월 경계가 9시간 어긋날 수 있으나, 폴더는 파기 단위 근사라 무해.
 * ⚠️ 파기 크론(§6)이 빈 월 폴더를 지울 때는 이 캐시의 해당 키도 함께 지워야 한다.
 */
export async function getMemoMonthFolderId(
  drive: Drive,
  now: Date = new Date(),
  opts?: { skipCache?: boolean }
): Promise<string> {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const pathKey = `쪽지/${y}/${m}`;
  if (!opts?.skipCache) {
    const cacheSnap = await folderCacheRef().get();
    const cached = cacheSnap.data()?.ids?.[pathKey];
    if (typeof cached === "string" && cached) return cached;
  }
  const root = await findOrCreateFolder(drive, "플랫폼 첨부", null);
  const memoRoot = await findOrCreateFolder(drive, "쪽지", root);
  const yearFolder = await findOrCreateFolder(drive, y, memoRoot);
  const monthFolder = await findOrCreateFolder(drive, m, yearFolder);
  await folderCacheRef().set({ ids: { [pathKey]: monthFolder } }, { merge: true });
  return monthFolder;
}

// ── 업로드 + staging (§3-2) ─────────────────────────────────────

/**
 * 검증 통과한 이미지를 Drive에 올리고 staging 문서를 남긴다.
 * staging은 발송 시 "발신자 본인이 방금 올린 파일인가" 대조의 원본 — 남의 파일 id 끼워넣기 차단.
 * 미발송분은 staging createdAt 기준 24h 후 파기 크론(§6)이 파일과 함께 삭제한다.
 */
export async function uploadMemoAttachment(params: {
  uploaderEmail: string;
  domain: string;
  safeName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<MemoAttachment> {
  const drive = driveOrThrow();
  let folderId = await getMemoMonthFolderId(drive);
  const createFile = () =>
    drive.files.create({
      // 발송 전이라 memoId가 없다 — 발송 마무리(finalizeMemoAttachments)에서 {memoId}_{n}_ 접두로 확정(§2)
      requestBody: { name: `대기_${params.safeName}`, parents: [folderId] },
      media: { mimeType: params.mimeType, body: Readable.from(params.buffer) },
      fields: "id, webViewLink, thumbnailLink, size",
    });
  let res;
  try {
    res = await createFile();
  } catch (e: any) {
    // 파기 크론이 월 폴더를 지웠는데 캐시가 남았으면 부모 404 — 캐시 무시하고 1회 재생성
    if (e?.code === 404) {
      folderId = await getMemoMonthFolderId(drive, new Date(), { skipCache: true });
      res = await createFile();
    } else {
      throw e;
    }
  }
  const attachment: MemoAttachment = {
    driveFileId: res.data.id!,
    name: params.safeName,
    mimeType: params.mimeType,
    size: Number(res.data.size) || params.buffer.length,
    webViewLink: res.data.webViewLink || "",
    ...(res.data.thumbnailLink ? { thumbnailLink: res.data.thumbnailLink } : {}),
  };
  await stagingRef(attachment.driveFileId).set({
    uploaderEmail: params.uploaderEmail,
    domain: params.domain,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    webViewLink: attachment.webViewLink,
    thumbnailLink: attachment.thumbnailLink || null,
    createdAt: Date.now(),
  });
  return attachment;
}

/**
 * 발송 payload의 driveFileId들을 staging과 대조해 첨부 참조를 확정한다 (§3-2).
 * 메타데이터는 staging 문서가 원본이다 — 클라이언트가 보낸 이름·링크를 믿지 않는다.
 */
export async function resolveStagedAttachments(
  ids: string[],
  senderEmail: string,
  domain: string
): Promise<{ ok: true; attachments: MemoAttachment[] } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, attachments: [] };
  const snaps = await adminDb.getAll(...ids.map((id) => stagingRef(id)));
  const attachments: MemoAttachment[] = [];
  for (const snap of snaps) {
    const d = snap.data();
    if (!snap.exists || !d || d.uploaderEmail !== senderEmail || d.domain !== domain) {
      return {
        ok: false,
        error: "첨부 이미지 정보를 확인하지 못했습니다. 이미지를 다시 첨부해 주세요.",
      };
    }
    attachments.push({
      driveFileId: snap.id,
      name: d.name,
      mimeType: d.mimeType,
      size: d.size,
      webViewLink: d.webViewLink,
      ...(d.thumbnailLink ? { thumbnailLink: d.thumbnailLink } : {}),
    });
  }
  return { ok: true, attachments };
}

/** 발송 커밋 후 staging 삭제 — 같은 fileId의 재사용(이중 발송 끼워넣기)을 끊는다 */
export async function deleteStagingDocs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const batch = adminDb.batch();
  for (const id of ids) batch.delete(stagingRef(id));
  await batch.commit();
}

// ── 권한 부여 (§3-3) ────────────────────────────────────────────

/** Drive가 "이미 권한 있음"류로 거부하면 성공으로 취급 — 재시도 경로의 멱등성 */
function isAlreadyGranted(e: any): boolean {
  const msg = String(e?.message || "");
  return e?.code === 409 || /already/i.test(msg) || /duplicate/i.test(msg);
}

async function forEachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<boolean> {
  let anyFail = false;
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      try {
        await fn(item);
      } catch {
        anyFail = true;
      }
    }
  });
  await Promise.all(workers);
  return anyFail;
}

async function grantAttachmentAccess(
  drive: Drive,
  params: {
    domain: string;
    attachments: MemoAttachment[];
    recipients: string[];
    shareMode: AttachmentShareMode;
  }
): Promise<boolean> {
  let anyFail = false;
  for (const att of params.attachments) {
    if (params.shareMode === "domain") {
      // 전 교직원 공지 예외 (§3-3) — 개별 300콜 대신 도메인 내부 링크 공유, 검색 노출은 막는다
      try {
        await drive.permissions.create({
          fileId: att.driveFileId,
          requestBody: { type: "domain", domain: params.domain, role: "reader", allowFileDiscovery: false },
        });
      } catch (e: any) {
        if (!isAlreadyGranted(e)) {
          anyFail = true;
          console.error("[쪽지 첨부] 도메인 공유 실패:", att.driveFileId, e?.message || e);
        }
      }
    } else {
      const failed = await forEachLimited(params.recipients, 6, async (recipient) => {
        try {
          await drive.permissions.create({
            fileId: att.driveFileId,
            sendNotificationEmail: false, // Drive 메일 발송 금지 — 알림은 쪽지가 한다 (§3-3)
            requestBody: { type: "user", role: "reader", emailAddress: recipient },
          });
        } catch (e: any) {
          if (!isAlreadyGranted(e)) throw e;
        }
      });
      anyFail = anyFail || failed;
    }
  }
  return anyFail;
}

/**
 * 발송 커밋 후 비동기 마무리 — 파일명에 memoId 접두(§2 역추적) + 열람 권한 부여(§3-3).
 * 권한 실패분은 memos 문서에 permissionPending: true — 다음 발송·크론이 재시도한다.
 */
export async function finalizeMemoAttachments(params: {
  domain: string;
  memoId: string;
  attachments: MemoAttachment[];
  recipients: string[];
  shareMode: AttachmentShareMode;
}): Promise<void> {
  const drive = driveOrThrow();
  // 이름 확정 실패는 치명 아님(역추적 보조) — 경고만 남기고 진행
  await Promise.all(
    params.attachments.map((att, i) =>
      drive.files
        .update({
          fileId: att.driveFileId,
          requestBody: { name: `${params.memoId}_${i + 1}_${att.name}` },
        })
        .catch((e: any) =>
          console.warn("[쪽지 첨부] 파일명 확정 실패:", att.driveFileId, e?.message || e)
        )
    )
  );
  const anyFail = await grantAttachmentAccess(drive, params);
  if (anyFail) {
    await memoRef(params.domain, params.memoId)
      .set({ permissionPending: true }, { merge: true })
      .catch((e) => console.error("[쪽지 첨부] permissionPending 기록 실패:", (e as Error)?.message));
  }
}

/** permissionPending 쪽지 수습 — 다음 발송의 after에서 몇 건씩 재시도 (§3-3) */
export async function retryPendingAttachmentGrants(domain: string, max = 2): Promise<void> {
  const snap = await adminDb
    .collection("memos")
    .doc(domain)
    .collection("items")
    .where("permissionPending", "==", true)
    .limit(max)
    .get();
  if (snap.empty) return;
  const drive = driveOrThrow();
  for (const doc of snap.docs) {
    const m = doc.data();
    const attachments: MemoAttachment[] = Array.isArray(m.attachments) ? m.attachments : [];
    if (attachments.length === 0) {
      await doc.ref.update({ permissionPending: FieldValue.delete() });
      continue;
    }
    const anyFail = await grantAttachmentAccess(drive, {
      domain,
      attachments,
      recipients: Array.isArray(m.recipientEmails) ? m.recipientEmails : [],
      shareMode: m.attachmentShareMode === "domain" ? "domain" : "individual",
    });
    if (!anyFail) await doc.ref.update({ permissionPending: FieldValue.delete() });
  }
}

// ── 회수 연동 (§0-3 — 첨부 열람 집합 = 쪽지 열람 집합) ─────────

/**
 * 회수된(미열람) 수신자의 첨부 reader 권한을 거둔다. 실패는 경고만 — 회수 자체는 이미 성립.
 * 도메인 공유 쪽지는 개인 단위 회수가 불가능하므로 호출부가 individual일 때만 부른다.
 */
export async function revokeAttachmentAccess(
  attachments: MemoAttachment[],
  recalledEmails: string[]
): Promise<void> {
  if (attachments.length === 0 || recalledEmails.length === 0) return;
  const drive = driveOrThrow();
  const targets = new Set(recalledEmails.map((e) => e.toLowerCase()));
  for (const att of attachments) {
    try {
      let pageToken: string | undefined;
      do {
        const res = await drive.permissions.list({
          fileId: att.driveFileId,
          fields: "nextPageToken, permissions(id, emailAddress, type)",
          pageSize: 100,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const p of res.data.permissions || []) {
          if (p.type === "user" && p.emailAddress && p.id && targets.has(p.emailAddress.toLowerCase())) {
            await drive.permissions
              .delete({ fileId: att.driveFileId, permissionId: p.id })
              .catch((e: any) =>
                console.warn("[쪽지 첨부] 권한 회수 실패:", att.driveFileId, p.emailAddress, e?.message || e)
              );
          }
        }
        pageToken = res.data.nextPageToken || undefined;
      } while (pageToken);
    } catch (e: any) {
      console.warn("[쪽지 첨부] 권한 목록 조회 실패:", att.driveFileId, e?.message || e);
    }
  }
}

// ── 운영 (§7) ───────────────────────────────────────────────────

/** 운영 액션 attachment_quota — hmnotice@ Drive 사용량 보고 */
export async function getAttachmentQuota(): Promise<{
  limitBytes: number;
  usageBytes: number;
  usageInDriveBytes: number;
}> {
  const drive = driveOrThrow();
  const res = await drive.about.get({ fields: "storageQuota" });
  const q = res.data.storageQuota || {};
  return {
    limitBytes: Number(q.limit) || 0,
    usageBytes: Number(q.usage) || 0,
    usageInDriveBytes: Number(q.usageInDrive) || 0,
  };
}
