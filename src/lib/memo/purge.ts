// 쪽지 파기 크론 코어 (memo_spec §6 후행 크론 + memo_attachment_spec §6)
// 파기 대상 3종: ① expireAt 지난 쪽지(첨부 Drive 파일 포함) ② attachment_staging 24h 고아
// ③ 빈 지난달 첨부 폴더(캐시 키 동반 정리 — attachments.ts getMemoMonthFolderId 주석의 의무 이행).
//
// 안전 원칙:
// - Drive 파일 삭제가 실패하면(404 제외) 그 참조 문서(쪽지·staging)는 지우지 않는다 —
//   참조를 잃으면 재시도가 불가능해져 고아 파일이 영구 잔존한다. 다음 회차가 재시도한다.
// - 회차당 처리량을 상한으로 묶는다(읽기 예산 규율 + 크론 maxDuration 60초). 밀린 분량은
//   다음 날 이어서 — 파기는 하루 단위 지연이 무해한 작업이다.
import { adminDb } from "@/lib/firebase/admin";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { MemoAttachment } from "./attachment_logic";
import { driveOrThrow, folderCacheRef } from "./attachments";

type Drive = ReturnType<typeof driveOrThrow>;

const EXPIRED_BATCH = 100;
const STAGING_BATCH = 100;
const STAGING_ORPHAN_MS = 24 * 3600 * 1000;

export interface MemoPurgeSummary {
  dryRun: boolean;
  /** 이번 회차에서 만료로 조회된 쪽지 수(도메인 합산, 회차 상한 내) */
  expiredFound: number;
  memosDeleted: number;
  attachmentFilesDeleted: number;
  /** Drive 삭제 실패로 이번 회차에 보류한 쪽지 수(다음 회차 재시도) */
  memosDeferred: number;
  stagingOrphansFound: number;
  stagingDeleted: number;
  monthFoldersDeleted: number;
  /** Drive 클라이언트 초기화 실패 시 true — 첨부 관련 파기 전부 보류됨 */
  driveUnavailable: boolean;
}

/** 삭제 성공 | 이미 없음(성공 취급) | 실패(참조 보존해 재시도) */
async function deleteDriveFileSafe(
  drive: Drive,
  fileId: string
): Promise<"deleted" | "missing" | "failed"> {
  try {
    await drive.files.delete({ fileId });
    return "deleted";
  } catch (e: any) {
    if (e?.code === 404) return "missing";
    console.error("[쪽지 파기] Drive 파일 삭제 실패:", fileId, e?.message || e);
    return "failed";
  }
}

export async function runMemoPurge(
  domains: string[],
  opts: { dryRun?: boolean } = {}
): Promise<MemoPurgeSummary> {
  const dryRun = !!opts.dryRun;
  const now = Date.now();
  const summary: MemoPurgeSummary = {
    dryRun,
    expiredFound: 0,
    memosDeleted: 0,
    attachmentFilesDeleted: 0,
    memosDeferred: 0,
    stagingOrphansFound: 0,
    stagingDeleted: 0,
    monthFoldersDeleted: 0,
    driveUnavailable: false,
  };

  let drive: Drive | null = null;
  const getDrive = (): Drive | null => {
    if (summary.driveUnavailable) return null;
    if (!drive) {
      try {
        drive = driveOrThrow();
      } catch (e: any) {
        console.error("[쪽지 파기] Drive 클라이언트 초기화 실패:", e?.message || e);
        summary.driveUnavailable = true;
        return null;
      }
    }
    return drive;
  };

  // ── 1. 만료 쪽지 (첨부 파일 → 문서 순서 — 참조가 마지막에 사라지게) ──
  //
  // ⚠️ **쪽지 파기의 단일 소재지다. 다른 크론·스크립트에서 만료 쪽지 문서를 지우지 마라.**
  // 문서를 먼저 지우면 그것이 가리키던 Drive 첨부를 다시 찾을 방법이 없어져
  // **본문만 파기되고 첨부(학생 사진·명단 등)는 영구히 남는다** — 개인정보 보존 기한 위반이다.
  // 2026-08-20에 lifecycle 크론이 UTC 15시에 문서만 일괄 삭제하고 있었고(이 함수는 18시),
  // 그 결함을 제거하며 여기로 일원화했다.

  for (const domain of domains) {
    const expiredSnap = await adminDb
      .collection("memos")
      .doc(domain)
      .collection("items")
      .where("expireAt", "<=", now)
      .limit(EXPIRED_BATCH)
      .get();
    summary.expiredFound += expiredSnap.size;
    if (dryRun) continue;

    for (const doc of expiredSnap.docs) {
      const attachments: MemoAttachment[] = Array.isArray(doc.data().attachments)
        ? doc.data().attachments
        : [];
      let allFilesGone = true;
      if (attachments.length > 0) {
        const d = getDrive();
        if (!d) {
          summary.memosDeferred++;
          continue;
        }
        for (const att of attachments) {
          const r = await deleteDriveFileSafe(d, att.driveFileId);
          if (r === "deleted") summary.attachmentFilesDeleted++;
          if (r === "failed") allFilesGone = false;
        }
      }
      if (!allFilesGone) {
        summary.memosDeferred++;
        continue;
      }
      await doc.ref.delete();
      summary.memosDeleted++;
    }
  }

  // ── 2. staging 고아 — 업로드 후 24h 내 미발송분 (attachment spec §3-2·§6) ──
  const stagingSnap = await adminDb
    .collection("attachment_staging")
    .where("createdAt", "<=", now - STAGING_ORPHAN_MS)
    .limit(STAGING_BATCH)
    .get();
  summary.stagingOrphansFound = stagingSnap.size;
  if (!dryRun) {
    for (const doc of stagingSnap.docs) {
      const d = getDrive();
      if (!d) break;
      const r = await deleteDriveFileSafe(d, doc.id); // staging 문서 id = driveFileId
      if (r === "failed") continue;
      if (r === "deleted") summary.attachmentFilesDeleted++;
      await doc.ref.delete();
      summary.stagingDeleted++;
    }
  }

  // ── 3. 빈 지난달 폴더 + 캐시 키 (이번 달은 건드리지 않음 — 업로드 진행 중일 수 있다) ──
  const cacheSnap = await folderCacheRef().get();
  const ids: Record<string, string> = cacheSnap.data()?.ids || {};
  const nowDate = new Date(now);
  const currentKey = `쪽지/${nowDate.getFullYear()}/${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
  for (const [pathKey, folderId] of Object.entries(ids)) {
    if (!pathKey.startsWith("쪽지/") || pathKey === currentKey || typeof folderId !== "string") continue;
    const d = getDrive();
    if (!d) break;
    try {
      const res = await d.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "files(id)",
        pageSize: 1,
      });
      if ((res.data.files || []).length > 0) continue; // 파일이 남아 있으면 폴더 유지
      if (dryRun) {
        summary.monthFoldersDeleted++;
        continue;
      }
      await d.files.delete({ fileId: folderId });
      await folderCacheRef().update(new FieldPath("ids", pathKey), FieldValue.delete());
      summary.monthFoldersDeleted++;
    } catch (e: any) {
      if (e?.code === 404) {
        // 폴더가 이미 없음 — 낡은 캐시 키만 정리
        if (!dryRun) {
          await folderCacheRef().update(new FieldPath("ids", pathKey), FieldValue.delete());
        }
        continue;
      }
      console.error("[쪽지 파기] 폴더 정리 실패:", pathKey, e?.message || e);
    }
  }

  return summary;
}
