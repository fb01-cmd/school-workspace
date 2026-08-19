// 쪽지 2단계 — 클라이언트 파일(이미지+일반 파일) 첨부 전처리 및 업로드 헬퍼 (docs/memo_attachment_spec.md §3-2·§4, 피드백 10번)

import type { MemoAttachment } from "./attachment_logic";
import {
  MEMO_MAX_ATTACHMENTS,
  MEMO_ATTACHMENT_MAX_BYTES,
  MEMO_ATTACHMENT_SESSION_MAX_BYTES,
  MEMO_FILE_EXT_WHITELIST,
  memoFileExt,
} from "./attachment_logic";

export type { MemoAttachment };
export { MEMO_MAX_ATTACHMENTS, MEMO_ATTACHMENT_MAX_BYTES, MEMO_ATTACHMENT_SESSION_MAX_BYTES };
export const MEMO_ATTACHMENT_MAX_COUNT = MEMO_MAX_ATTACHMENTS;

/** 파일 크기 포맷팅 (예: 450 KB, 1.2 MB) */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 이미지 파일 여부 판별 */
export function isImageFile(name: string, mimeType?: string): boolean {
  const ext = memoFileExt(name);
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return true;
  if (mimeType && mimeType.startsWith("image/")) return true;
  return false;
}

/**
 * 캔버스 리사이즈 및 이미지 검증 (이미지 전용)
 */
export async function resizeAndValidateImage(file: File): Promise<{ blob: Blob; safeName: string }> {
  const ext = memoFileExt(file.name);
  const type = file.type.toLowerCase();

  const isGif = type === "image/gif" || ext === "gif";
  if (isGif) {
    if (file.size > MEMO_ATTACHMENT_MAX_BYTES) {
      throw new Error("움직이는 이미지(GIF)는 4MB 이하만 첨부할 수 있습니다.");
    }
    return { blob: file, safeName: file.name };
  }

  const isPng = type === "image/png" || ext === "png";

  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("브라우저 환경에서만 이미지를 처리할 수 있습니다."));
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      const maxDim = 2000;
      const needsScale = width > maxDim || height > maxDim;

      // PNG이고 리사이즈가 불필요하며 4MB 이하면 원본 유지
      if (isPng && !needsScale && file.size <= MEMO_ATTACHMENT_MAX_BYTES) {
        resolve({ blob: file, safeName: file.name });
        return;
      }

      if (needsScale) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("이미지 변환 캔버스를 초기화하지 못했습니다."));
        return;
      }

      if (!isPng) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }

      ctx.drawImage(img, 0, 0, width, height);

      const outputMime = isPng ? "image/png" : "image/jpeg";
      const quality = isPng ? undefined : 0.85;

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("이미지 파일 변환에 실패했습니다."));
            return;
          }
          if (blob.size > MEMO_ATTACHMENT_MAX_BYTES) {
            reject(new Error("첨부 이미지는 4MB 이하여야 합니다."));
            return;
          }
          resolve({ blob, safeName: file.name });
        },
        outputMime,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("이미지를 읽는 중 오류가 발생했습니다."));
    };

    img.src = objectUrl;
  });
}

/**
 * 첨부 파일 1건 업로드 (<=4MB: 직접 multipart, 4MB~10MB: 세션 업로드)
 */
export async function uploadAttachment(
  file: File,
  onProgress?: (msg: string) => void
): Promise<MemoAttachment> {
  const ext = memoFileExt(file.name);
  if (!ext || !MEMO_FILE_EXT_WHITELIST.includes(ext)) {
    throw new Error("허용되지 않는 파일 형식입니다. (한글·오피스·PDF·압축·이미지 파일만 가능)");
  }

  if (file.size > MEMO_ATTACHMENT_SESSION_MAX_BYTES) {
    throw new Error("첨부 파일은 최대 10MB 이하만 가능합니다.");
  }

  // 1. 이미지이고 4MB 이하인 경우 리사이즈/전처리
  let uploadBlob: Blob = file;
  let uploadName: string = file.name;

  if (isImageFile(file.name, file.type)) {
    if (file.size <= MEMO_ATTACHMENT_MAX_BYTES) {
      onProgress?.("이미지 최적화 중…");
      const prepared = await resizeAndValidateImage(file);
      uploadBlob = prepared.blob;
      uploadName = prepared.safeName;
    }
  }

  // 2. 4MB 이하: 서버 직접 multipart 업로드
  if (uploadBlob.size <= MEMO_ATTACHMENT_MAX_BYTES) {
    onProgress?.("파일 올리는 중…");
    const formData = new FormData();
    formData.append("file", uploadBlob, uploadName);

    const res = await fetch("/api/memo", {
      method: "POST",
      body: formData,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.attachment) {
      throw new Error(data.error || "파일 업로드에 실패했습니다.");
    }
    return data.attachment as MemoAttachment;
  }

  // 3. 4MB 초과 10MB 이하: 구글 드라이브 Resumable Session 직접 업로드
  onProgress?.("대용량 업로드 준비 중…");
  const startRes = await fetch("/api/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "attach_session_start",
      name: uploadName,
      size: uploadBlob.size,
      mimeType: file.type || "application/octet-stream",
    }),
  });

  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startData.success || !startData.sessionUrl) {
    throw new Error(startData.error || "대용량 업로드 세션을 시작하지 못했습니다.");
  }

  onProgress?.("드라이브에 전송 중…");
  const uploadRes = await fetch(startData.sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Content-Range": `bytes 0-${uploadBlob.size - 1}/${uploadBlob.size}`,
    },
    body: uploadBlob,
  });

  if (!uploadRes.ok) {
    throw new Error("드라이브 직접 전송에 실패했습니다.");
  }

  const uploadResultJson = await uploadRes.json().catch(() => ({}));
  const driveFileId = uploadResultJson.id;
  if (!driveFileId) {
    throw new Error("드라이브 파일 ID를 확인하지 못했습니다.");
  }

  onProgress?.("첨부 마무리 중…");
  const finishRes = await fetch("/api/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "attach_session_finish",
      driveFileId,
      name: uploadName,
      size: uploadBlob.size,
      mimeType: file.type || "application/octet-stream",
    }),
  });

  const finishData = await finishRes.json().catch(() => ({}));
  if (!finishRes.ok || !finishData.success || !finishData.attachment) {
    throw new Error(finishData.error || "첨부 마무리에 실패했습니다.");
  }

  return finishData.attachment as MemoAttachment;
}

/** 하위 호환용 래퍼 */
export async function uploadAttachmentFile(fileBlob: Blob, fileName: string): Promise<MemoAttachment> {
  const f = new File([fileBlob], fileName, { type: fileBlob.type });
  return uploadAttachment(f);
}
