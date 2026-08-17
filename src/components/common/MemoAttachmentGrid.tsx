"use client";

import { useState } from "react";
import type { MemoAttachment } from "@/lib/memo/attachment_logic";
import { formatAttachmentSize } from "@/lib/memo/client_attachments";

interface MemoAttachmentGridProps {
  attachments?: MemoAttachment[];
}

function AttachmentCard({ attachment }: { attachment: MemoAttachment }) {
  const [imgError, setImgError] = useState(false);

  return (
    <a
      href={attachment.webViewLink}
      target="_blank"
      rel="noopener noreferrer"
      title={`${attachment.name} (${formatAttachmentSize(attachment.size)}) - 새 탭에서 열기`}
      className="group relative flex flex-col bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all text-left"
    >
      {/* 썸네일 영역 */}
      <div className="relative w-full h-28 bg-slate-100 dark:bg-slate-750 flex items-center justify-center overflow-hidden">
        {attachment.thumbnailLink && !imgError ? (
          <img
            src={attachment.thumbnailLink}
            alt={attachment.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-slate-400 dark:text-slate-500 p-2">
            <svg className="w-8 h-8 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[10px] font-medium">첨부 이미지</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-[11px] font-bold px-2 py-1 rounded-md transition-opacity">
            크게 보기 ↗
          </span>
        </div>
      </div>

      {/* 파일명 & 크기 */}
      <div className="p-2 bg-white dark:bg-slate-800 flex flex-col justify-between gap-0.5">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={attachment.name}>
          {attachment.name}
        </p>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          {formatAttachmentSize(attachment.size)}
        </span>
      </div>
    </a>
  );
}

export default function MemoAttachmentGrid({ attachments }: MemoAttachmentGridProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
        <span>🖼️</span>
        <span>첨부 이미지 ({attachments.length}장)</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {attachments.map((att, idx) => (
          <AttachmentCard key={att.driveFileId || idx} attachment={att} />
        ))}
      </div>
    </div>
  );
}
