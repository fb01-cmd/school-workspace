// 쪽지 2단계 — 첨부 검증 순수 로직 (docs/memo_attachment_spec.md §0·§2·§3)
// 이 파일은 네트워크·Firestore 무의존이다 — selftest(scripts/memo_attachment_selftest.ts)가 직접 임포트한다.

import { TASK_FILE_EXT_WHITELIST, TASK_FILE_MAX_BYTES, TASK_SERVER_UPLOAD_MAX_BYTES } from "@/lib/tasks/logic";

export const MEMO_MAX_ATTACHMENTS = 5;
/** 서버 경유 업로드 상한 — 업무와 동일 4MB (2026-08-19 피드백 10번: 초과분은 세션 업로드 경로) */
export const MEMO_ATTACHMENT_MAX_BYTES = TASK_SERVER_UPLOAD_MAX_BYTES;
/** 세션 업로드(대용량) 절대 상한 — 업무 파일 상한 승계 (30MB, 2026-08-19 상향) */
export const MEMO_ATTACHMENT_SESSION_MAX_BYTES = TASK_FILE_MAX_BYTES;
/**
 * 일반 파일 확장 (2026-08-19 피드백 10번) — 업무 파일 목록 재사용 + GIF 유지
 * (GIF는 업무에서만 제외 — richtext spec §9의 쪽지 GIF는 실수요). 실행 파일류는 목록 밖 = 차단.
 */
export const MEMO_FILE_EXT_WHITELIST = [...TASK_FILE_EXT_WHITELIST, "gif"];
/** 이미지 MIME (바이트 서명 검증 대상) — v1 이미지 전용 시절의 화이트리스트, 이제 이미지 판별용 */
export const MEMO_ATTACHMENT_MIME_WHITELIST = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export const MEMO_ATTACHMENT_NAME_MAX = 100;
/** 수신 집합이 전 교직원의 이 비율 이상이면 개별 권한 대신 도메인 내부 링크 공유 (§3-3 예외) */
export const MEMO_ATTACHMENT_DOMAIN_SHARE_RATIO = 0.9;

export type AttachmentShareMode = "individual" | "domain";

/** memos 문서의 attachments[] 원소 (§3-1) — 파일 실체는 Drive, 여기엔 참조만 */
export interface MemoAttachment {
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string;
  thumbnailLink?: string;
}

/** 원본 파일명 정리 — 경로 구분자·제어문자 제거, 확장자가 남도록 꼬리 기준 절단 */
export function sanitizeAttachmentName(raw: unknown): string {
  const base = typeof raw === "string" ? raw : "";
  const cleaned = base.replace(/[\/\\\u0000-\u001f\u007f]/g, "_").trim();
  const name = cleaned || "이미지";
  return name.length > MEMO_ATTACHMENT_NAME_MAX ? name.slice(-MEMO_ATTACHMENT_NAME_MAX) : name;
}

/** 실제 바이트 서명(magic bytes)으로 이미지 형식 판별 — 선언 MIME 위장 차단 (§3-2 서버 재검증) */
export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && // "GIF8"
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61 // "7a" | "9a" (GIF87a/GIF89a)
  ) {
    return "image/gif";
  }
  return null;
}

/** 파일명 확장자 — 화이트리스트 대조용 (업무 validateTaskFileName과 같은 규칙) */
export function memoFileExt(name: unknown): string {
  const n = typeof name === "string" ? name.trim() : "";
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(n);
  return m ? m[1].toLowerCase() : "";
}

/**
 * 서버 경유 업로드 검증 (§3-2 + 2026-08-19 일반 파일 확장).
 * 이미지는 종전대로 바이트 서명이 확장자와 일치해야 통과(선언 MIME 위장 차단 유지).
 * 비이미지(한글·오피스 등)는 바이트 서명 판별이 불가하므로 확장자 화이트리스트 + 크기만 —
 * 업무 파일 경로(validateTaskFileName)와 같은 수준의 방어다.
 */
export function validateAttachmentUpload(input: {
  name: unknown;
  mimeType: unknown;
  bytes: Uint8Array;
}): { ok: true; safeName: string; mimeType: string } | { ok: false; error: string } {
  const ext = memoFileExt(input.name);
  if (!ext || !MEMO_FILE_EXT_WHITELIST.includes(ext)) {
    return { ok: false, error: "허용되지 않는 파일 형식입니다. (한글·오피스·PDF·압축·이미지 파일만)" };
  }
  if (input.bytes.length === 0) {
    return { ok: false, error: "빈 파일은 첨부할 수 없습니다." };
  }
  if (input.bytes.length > MEMO_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: "4MB가 넘는 파일은 대용량 업로드로 올려 주세요." };
  }
  const expectedImageMime = IMAGE_EXT_TO_MIME[ext];
  if (expectedImageMime) {
    const sniffed = sniffImageMime(input.bytes);
    if (!sniffed || sniffed !== expectedImageMime) {
      return { ok: false, error: "이미지 파일이 손상되었거나 형식이 올바르지 않습니다." };
    }
    return { ok: true, safeName: sanitizeAttachmentName(input.name), mimeType: sniffed };
  }
  const declared = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
  return {
    ok: true,
    safeName: sanitizeAttachmentName(input.name),
    mimeType: declared || "application/octet-stream",
  };
}

/** 세션 업로드(대용량) 시작 검증 — 확장자 화이트리스트 + 10MB 상한 (피드백 10번, 업무 §5-4 이식) */
export function validateAttachmentSessionStart(input: {
  name: unknown;
  size: unknown;
}): { ok: true; safeName: string; ext: string } | { ok: false; error: string } {
  const ext = memoFileExt(input.name);
  if (!ext || !MEMO_FILE_EXT_WHITELIST.includes(ext)) {
    return { ok: false, error: "허용되지 않는 파일 형식입니다. (한글·오피스·PDF·압축·이미지 파일만)" };
  }
  const size = typeof input.size === "number" ? input.size : NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "빈 파일은 첨부할 수 없습니다." };
  }
  if (size > MEMO_ATTACHMENT_SESSION_MAX_BYTES) {
    return { ok: false, error: "첨부 파일은 30MB 이하여야 합니다." };
  }
  return { ok: true, safeName: sanitizeAttachmentName(input.name), ext };
}

/** 발송 payload의 attachments — driveFileId 문자열 배열만 받는다(메타데이터는 staging이 원본, §3-2) */
export function validateAttachmentIds(
  raw: unknown
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "첨부 형식이 유효하지 않습니다." };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim() : "";
    if (!id || id.length > 200 || id.includes("/")) {
      return { ok: false, error: "첨부 형식이 유효하지 않습니다." };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > MEMO_MAX_ATTACHMENTS) {
    return { ok: false, error: `파일은 ${MEMO_MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.` };
  }
  return { ok: true, ids };
}

/**
 * 인라인 이미지 바이트 프록시의 열람 자격 판정 (richtext spec §13) — 순수.
 * 발신자·수신자만, 그리고 그 쪽지에 실제로 달린 첨부만 통과.
 * 회수로 수신 목록에서 빠진 사람은 쪽지와 함께 이미지 접근도 잃는다(의도된 정합).
 */
export function resolveAttachmentViewEligibility(
  memo: { senderEmail?: string; recipientEmails?: string[]; attachments?: MemoAttachment[] } | null | undefined,
  requesterEmail: string,
  driveFileId: string
): { ok: true; mimeType: string; size: number } | { ok: false; status: 403 | 404 } {
  if (!memo) return { ok: false, status: 404 };
  const att = (memo.attachments || []).find((a) => a.driveFileId === driveFileId);
  if (!att) return { ok: false, status: 404 };
  const me = requesterEmail.trim().toLowerCase();
  const allowed =
    (memo.senderEmail || "").toLowerCase() === me ||
    (memo.recipientEmails || []).some((r) => r.toLowerCase() === me);
  if (!allowed) return { ok: false, status: 403 };
  return { ok: true, mimeType: att.mimeType, size: att.size };
}

/** 개별 reader 부여 vs 도메인 내부 링크 공유 판정 (§3-3) — 전 교직원 공지만 도메인 공유 */
export function decideAttachmentShareMode(
  recipientCount: number,
  staffCount: number
): AttachmentShareMode {
  if (staffCount > 0 && recipientCount >= staffCount * MEMO_ATTACHMENT_DOMAIN_SHARE_RATIO) {
    return "domain";
  }
  return "individual";
}
