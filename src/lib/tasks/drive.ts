// Phase 8 업무 지시 — 전용 공유드라이브·파일 작업 (docs/phase8_tasks_spec.md §5)
//
// 원칙(§0-4): 저장소는 "업무 제출함" 공유드라이브 신설(조직 소유) — 명단 드라이브 재사용 금지.
// 폴더는 플랫폼 자동 생성 창고 `업무/{연도}/{업무ID}/양식|제출함`, 접근 권한 = 서비스 계정
// (관리자 사칭)만. 예외 1: 담당자에게 그 업무 제출함 열람 부여(취합), 철회·파기 시 회수.
import { adminDb } from "@/lib/firebase/admin";
import { getDriveClient } from "@/lib/google/workspace";
import { google } from "googleapis";

const adminSubject = () => process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || "";

function driveOrThrow() {
  const drive = getDriveClient(adminSubject());
  if (!drive) throw new Error("Drive 클라이언트를 초기화하지 못했습니다(모의 모드).");
  return drive;
}

const taskDriveConfigRef = () => adminDb.collection("platform_config").doc("task_drive");

/** 공유드라이브 최초 1회 프로비저닝 — id는 platform_config에 저장 (§5-1) */
export async function ensureTaskSharedDrive(): Promise<string> {
  const snap = await taskDriveConfigRef().get();
  const existing = snap.exists ? (snap.data() as any).driveId : null;
  if (existing) return existing;

  const drive = driveOrThrow();
  const created = await drive.drives.create({
    requestId: `task-drive-${Date.now()}`,
    requestBody: { name: "업무 제출함 (플랫폼)" },
  });
  const driveId = created.data.id!;
  await taskDriveConfigRef().set({ driveId, createdAt: Date.now() }, { merge: true });
  return driveId;
}

async function getOrCreateFolder(parentId: string, name: string): Promise<string> {
  const drive = driveOrThrow();
  const q = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  const hit = q.data.files?.[0]?.id;
  if (hit) return hit;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id!;
}

/** 업무 폴더 한 벌 생성: 업무/{연도}/{업무ID}/양식·제출함 (§5-1) */
export async function ensureTaskFolders(
  taskId: string,
  year: string
): Promise<{ formFolderId: string; submitFolderId: string }> {
  const driveId = await ensureTaskSharedDrive();
  const yearFolder = await getOrCreateFolder(driveId, year);
  const taskFolder = await getOrCreateFolder(yearFolder, taskId);
  const formFolderId = await getOrCreateFolder(taskFolder, "양식");
  const submitFolderId = await getOrCreateFolder(taskFolder, "제출함");
  return { formFolderId, submitFolderId };
}

export async function uploadTaskFile(params: {
  folderId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ driveFileId: string }> {
  const drive = driveOrThrow();
  const { Readable } = await import("stream");
  const res = await drive.files.create({
    requestBody: { name: params.name, parents: [params.folderId] },
    media: { mimeType: params.mimeType || "application/octet-stream", body: Readable.from(params.buffer) },
    fields: "id",
    supportsAllDrives: true,
  });
  return { driveFileId: res.data.id! };
}

/** 재제출 = 최신본 교체 (§0-5 — Drive 버전 이력 30일이 이전 본을 보관) */
export async function overwriteTaskFile(params: {
  fileId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<void> {
  const drive = driveOrThrow();
  const { Readable } = await import("stream");
  await drive.files.update({
    fileId: params.fileId,
    requestBody: { name: params.name },
    media: { mimeType: params.mimeType || "application/octet-stream", body: Readable.from(params.buffer) },
    supportsAllDrives: true,
  });
}

export async function downloadTaskFile(fileId: string): Promise<Buffer> {
  const drive = driveOrThrow();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

export async function getTaskFileMeta(
  fileId: string
): Promise<{ name: string; size: number; parents: string[]; mimeType: string } | null> {
  const drive = driveOrThrow();
  try {
    const res = await drive.files.get({
      fileId,
      fields: "name,size,parents,mimeType",
      supportsAllDrives: true,
    });
    return {
      name: res.data.name || "",
      size: Number(res.data.size || 0),
      parents: res.data.parents || [],
      mimeType: res.data.mimeType || "",
    };
  } catch {
    return null;
  }
}

/** 담당자 제출함 열람 부여 (§0-4 예외 1) — 알림 메일 억제 */
export async function grantFolderReader(folderId: string, email: string): Promise<void> {
  const drive = driveOrThrow();
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { type: "user", role: "reader", emailAddress: email },
    sendNotificationEmail: false,
    supportsAllDrives: true,
  });
}

export async function revokeFolderReader(folderId: string, email: string): Promise<void> {
  const drive = driveOrThrow();
  const perms = await drive.permissions.list({
    fileId: folderId,
    fields: "permissions(id,emailAddress)",
    supportsAllDrives: true,
  });
  const target = (perms.data.permissions || []).find(
    (p) => (p.emailAddress || "").toLowerCase() === email.toLowerCase()
  );
  if (target?.id) {
    await drive.permissions.delete({ fileId: folderId, permissionId: target.id, supportsAllDrives: true });
  }
}

/** 파기 크론용 — 업무 폴더 통째 삭제 (양식·제출물 포함, §8) */
export async function deleteTaskFolderTree(taskFolderParentYear: string, taskId: string): Promise<boolean> {
  const drive = driveOrThrow();
  const driveId = await ensureTaskSharedDrive();
  const yearFolder = await getOrCreateFolder(driveId, taskFolderParentYear);
  const q = await drive.files.list({
    q: `'${yearFolder}' in parents and name = '${taskId}' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 1,
  });
  const id = q.data.files?.[0]?.id;
  if (!id) return false;
  await drive.files.delete({ fileId: id, supportsAllDrives: true });
  return true;
}

/**
 * 대용량(>4MB) 제출용 Drive 재개 업로드 세션 (§5-4) — 서버가 세션 URL을 발급하고
 * 브라우저가 그 URL로 직접 PUT. Origin을 세션 생성 시 지정해야 CORS가 열린다.
 * 완료 후 서버가 getTaskFileMeta로 재검증(finalize)하기 전까지 제출로 치지 않는다.
 */
export async function createResumableUploadSession(params: {
  folderId: string;
  name: string;
  mimeType: string;
  origin: string;
}): Promise<string> {
  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: adminSubject(),
  });
  const token = await auth.getAccessToken();
  if (!token.token) throw new Error("업로드 토큰 발급에 실패했습니다.");

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": params.mimeType || "application/octet-stream",
        Origin: params.origin,
      },
      body: JSON.stringify({ name: params.name, parents: [params.folderId] }),
    }
  );
  const location = res.headers.get("location");
  if (!res.ok || !location) {
    throw new Error(`업로드 세션 발급 실패 (${res.status})`);
  }
  return location;
}
