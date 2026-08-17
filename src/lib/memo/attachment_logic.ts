// 쪽지 2단계 — 첨부 검증 순수 로직 (docs/memo_attachment_spec.md §0·§2·§3)
// 이 파일은 네트워크·Firestore 무의존이다 — selftest(scripts/memo_attachment_selftest.ts)가 직접 임포트한다.

export const MEMO_MAX_ATTACHMENTS = 5;
/** 클라이언트 리사이즈 상한과 동일 — 서버 재검증 기준 (§3-2) */
export const MEMO_ATTACHMENT_MAX_BYTES = Math.floor(3.5 * 1024 * 1024);
/** v1 = 이미지만 (§0-2) — 일반 파일은 실수요 후 이 목록 한 줄 확장으로 연다 */
export const MEMO_ATTACHMENT_MIME_WHITELIST = ["image/png", "image/jpeg", "image/webp"];
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
export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
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
  return null;
}

export function validateAttachmentUpload(input: {
  name: unknown;
  mimeType: unknown;
  bytes: Uint8Array;
}): { ok: true; safeName: string; mimeType: string } | { ok: false; error: string } {
  const declared =
    typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
  const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
  if (!MEMO_ATTACHMENT_MIME_WHITELIST.includes(normalized)) {
    return { ok: false, error: "이미지 파일(PNG·JPG·WEBP)만 첨부할 수 있습니다." };
  }
  if (input.bytes.length === 0) {
    return { ok: false, error: "빈 파일은 첨부할 수 없습니다." };
  }
  if (input.bytes.length > MEMO_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: "첨부 이미지는 3.5MB 이하여야 합니다." };
  }
  const sniffed = sniffImageMime(input.bytes);
  if (!sniffed || sniffed !== normalized) {
    return { ok: false, error: "이미지 파일이 손상되었거나 형식이 올바르지 않습니다." };
  }
  return { ok: true, safeName: sanitizeAttachmentName(input.name), mimeType: sniffed };
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
    return { ok: false, error: `이미지는 ${MEMO_MAX_ATTACHMENTS}장까지 첨부할 수 있습니다.` };
  }
  return { ok: true, ids };
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
