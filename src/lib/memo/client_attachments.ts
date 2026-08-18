// 쪽지 2단계 — 클라이언트 이미지 첨부 전처리 및 업로드 헬퍼 (docs/memo_attachment_spec.md §3-2·§4)

import type { MemoAttachment } from "./attachment_logic";
export type { MemoAttachment };

export const MEMO_ATTACHMENT_MAX_COUNT = 5;
export const MEMO_ATTACHMENT_MAX_BYTES = Math.floor(3.5 * 1024 * 1024); // 3.5MB

/** 파일 크기 포맷팅 (예: 450 KB, 1.2 MB) */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 캔버스 리사이즈 및 3.5MB 검증
 * - 지원 형식: PNG, JPEG, JPG, WEBP, GIF
 * - 최대 변 2000px (비율 유지)
 * - PNG: 원본 유지 (2000px 이하이고 3.5MB 이하면 원본 그대로, 초과 시 캔버스 PNG 리사이즈)
 * - GIF: 캔버스 금지 — 첫 프레임만 남아 움직임이 죽는다. 3.5MB 이하 원본 통과, 초과 거부 (richtext spec §9)
 * - JPEG/WEBP: JPEG 품질 0.85
 * - 최종 바이트 3.5MB 이하 검증
 */
export async function resizeAndValidateImage(file: File): Promise<{ blob: Blob; safeName: string }> {
  const allowedMimes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
  const type = file.type.toLowerCase();

  // MIME 확장자 예외 처리 (파일 타입이 비었거나 일반적인 경우)
  const ext = file.name.split(".").pop()?.toLowerCase();
  const isAllowedExt = ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);

  if (!allowedMimes.includes(type) && !isAllowedExt) {
    throw new Error("이미지 파일(PNG·JPG·WEBP·GIF)만 첨부할 수 있습니다.");
  }

  const isGif = type === "image/gif" || ext === "gif";
  if (isGif) {
    if (file.size > MEMO_ATTACHMENT_MAX_BYTES) {
      throw new Error("움직이는 이미지(GIF)는 3.5MB 이하만 첨부할 수 있습니다.");
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

      // PNG이고 리사이즈가 불필요하며 3.5MB 이하면 파일 원본 유지 (§3-2)
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

      // 흰색 배경 채움 (JPEG 변환 시 투명 영역 검은색 변환 방지)
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
            reject(new Error("첨부 이미지는 3.5MB 이하여야 합니다."));
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
 * 첨부 1건 업로드 (POST /api/memo multipart/form-data)
 */
export async function uploadAttachmentFile(fileBlob: Blob, fileName: string): Promise<MemoAttachment> {
  const formData = new FormData();
  formData.append("file", fileBlob, fileName);

  const res = await fetch("/api/memo", {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.attachment) {
    throw new Error(data.error || "이미지 업로드에 실패했습니다.");
  }

  return data.attachment as MemoAttachment;
}
