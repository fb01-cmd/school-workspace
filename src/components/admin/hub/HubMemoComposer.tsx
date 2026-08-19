"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting, MEMO_CONTENT_FORMAT_MD1 } from "@/lib/memo/richtext";
import { buildRecipientSummary, deriveRecipientChips, RecipientChip } from "@/lib/org/recipients";
import type { TeacherProfile } from "@/context/AuthContext";
import { resolveDisplayName } from "@/lib/org/displayName";
import {
  uploadAttachment,
  formatAttachmentSize,
  isImageFile,
  MEMO_MAX_ATTACHMENTS,
} from "@/lib/memo/client_attachments";
import type { MemoAttachment } from "@/lib/memo/client_attachments";

interface HubMemoComposerProps {
  selectedEmails: Set<string>;
  onClearSelection: () => void;
  onRemoveEmail: (email: string) => void;
  onSwitchToTask: (title: string, body: string) => void;
  onSent: () => void;
  profiles: TeacherProfile[];
  gwsNameMap: Map<string, string>;
  initialTitle?: string;
  initialBody?: string;
  canSend: boolean;
  hasDraftRef?: React.MutableRefObject<boolean>;
}

interface StagedAttachment {
  id: string;
  name: string;
  size: number;
  previewUrl?: string;
  status: "resizing" | "uploading" | "done" | "error";
  progressText?: string;
  attachment?: MemoAttachment;
  error?: string;
}

export default function HubMemoComposer({
  selectedEmails,
  onClearSelection,
  onRemoveEmail,
  onSwitchToTask,
  onSent,
  profiles,
  gwsNameMap,
  initialTitle = "",
  initialBody = "",
  canSend,
  hasDraftRef,
}: HubMemoComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  // 부모(MessagingHub)의 hasDraftRef 동기화 — 선택 비우기 전 확인창 판단용 (결함 2)
  useEffect(() => {
    if (hasDraftRef) hasDraftRef.current = !!(title.trim() || body.trim());
  }, [title, body, hasDraftRef]);
  useEffect(() => {
    return () => { if (hasDraftRef) hasDraftRef.current = false; };
  }, [hasDraftRef]);

  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editorRef.current && initialBody && !editorRef.current.innerHTML) {
      editorRef.current.innerText = initialBody;
    }
  }, [initialBody]);

  const syncBodyMd1 = useCallback(() => {
    if (editorRef.current) {
      const md1 = serializeDomToMd1(editorRef.current);
      setBody(md1);
      return md1;
    }
    return body;
  }, [body]);

  // Profile lookup map
  const profileMap = useMemo(() => {
    const map = new Map<string, TeacherProfile>();
    profiles.forEach((p) => {
      if (p.email) map.set(p.email.toLowerCase(), p);
    });
    return map;
  }, [profiles]);

  // Recipient chips — 1-C 공통 헬퍼로 파생 계산
  const recipientChips = useMemo<RecipientChip[]>(() => {
    return deriveRecipientChips(selectedEmails, profiles, profileMap, gwsNameMap);
  }, [selectedEmails, profileMap, gwsNameMap, profiles]);

  // 파일 업로드 큐 처리 (A-6: 파일별 독립 업로드 + 실패 격리)
  const enqueueFiles = (selectedFiles: File[]) => {
    if (stagedAttachments.length + selectedFiles.length > MEMO_MAX_ATTACHMENTS) {
      setError(`첨부 파일은 최대 ${MEMO_MAX_ATTACHMENTS}개까지 가능합니다.`);
      return;
    }

    const newItems: StagedAttachment[] = selectedFiles.map((file) => {
      const isImg = isImageFile(file.name, file.type);
      return {
        id: Math.random().toString(36).slice(2),
        name: file.name,
        size: file.size,
        status: "uploading",
        previewUrl: isImg ? URL.createObjectURL(file) : undefined,
        progressText: isImg && file.size <= 4 * 1024 * 1024 ? "최적화 중…" : "업로드 중…",
      };
    });

    setStagedAttachments((prev) => [...prev, ...newItems]);
    setError(null);

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const item = newItems[i];

      (async () => {
        try {
          const uploaded = await uploadAttachment(file, (msg) => {
            setStagedAttachments((prev) =>
              prev.map((a) => (a.id === item.id ? { ...a, progressText: msg } : a))
            );
          });

          setStagedAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "done",
                    progressText: undefined,
                    attachment: uploaded,
                    previewUrl: uploaded.thumbnailLink || a.previewUrl,
                  }
                : a
            )
          );
        } catch (err: any) {
          setStagedAttachments((prev) =>
            prev.map((a) =>
              a.id === item.id
                ? {
                    ...a,
                    status: "error",
                    progressText: undefined,
                    error: err?.message || "업로드 실패",
                  }
                : a
            )
          );
        }
      })();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    enqueueFiles(files);
  };

  const handleRemoveAttachment = (id: string) => {
    setStagedAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const isUploading = stagedAttachments.some((a) => a.status === "uploading" || a.status === "resizing");
  const failedAttachmentsCount = stagedAttachments.filter((a) => a.status === "error").length;
  const hasAttachmentError = failedAttachmentsCount > 0;
  const isBodyEmpty = !body.trim();
  const isNoRecipient = selectedEmails.size === 0;

  // A-7: 발송 불가 사유
  const disableReason = !canSend
    ? "조직 정보 등록 후 쪽지를 보낼 수 있습니다."
    : isNoRecipient
    ? "수신자를 선택해 주세요."
    : isBodyEmpty
    ? "쪽지 내용을 입력해 주세요."
    : hasAttachmentError
    ? `올릴 수 없는 첨부 ${failedAttachmentsCount}개가 있습니다. 빼면 보낼 수 있어요.`
    : isUploading
    ? "첨부 파일을 업로드하고 있습니다…"
    : null;

  const canSubmit = !sending && !isUploading && canSend && !isNoRecipient && !isBodyEmpty && !hasAttachmentError;

  // Send memo (no confirmation modal per memo_spec §11-1)
  const handleSend = async () => {
    if (!canSubmit) return;

    const finalBody = syncBodyMd1();
    if (!finalBody.trim()) {
      setError("쪽지 내용을 입력해 주세요.");
      return;
    }
    if (selectedEmails.size === 0) {
      setError("쪽지를 보낼 수신자를 선택해 주세요.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const hasMd1 = bodyHasMd1Formatting(finalBody);
      const recipientSummary = buildRecipientSummary(recipientChips);
      const userList = Array.from(selectedEmails);
      const driveFileIds = stagedAttachments
        .filter((a) => a.status === "done" && a.attachment)
        .map((a) => a.attachment!.driveFileId);

      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          title: title.trim() || undefined,
          body: finalBody,
          contentFormat: hasMd1 ? MEMO_CONTENT_FORMAT_MD1 : undefined,
          attachments: driveFileIds.length > 0 ? driveFileIds : undefined,
          recipientSummary,
          recipients: { users: userList, groups: [] },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "쪽지 발송에 실패했습니다.");
      }

      onSent();
    } catch (err: any) {
      setError(err.message || "쪽지 발송 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  const handleSwitchClick = () => {
    const currentBody = syncBodyMd1();
    onSwitchToTask(title, currentBody);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-y-auto p-6 space-y-6">
      {/* Header with Switcher Hint */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>✉️</span>
            <span>쪽지 쓰기</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            가벼운 공지나 일반 연락 사항을 발송합니다.
          </p>
        </div>

        {/* Switch to Task with Helper Copy (§2-5) */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 hidden xl:inline">
            기한이 있는 일은 업무로 보내면 누가 끝냈는지 자동으로 모입니다.
          </span>
          <button
            type="button"
            onClick={handleSwitchClick}
            className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer border border-slate-200 flex items-center gap-1.5"
          >
            <span>📌 업무로 바꾸기</span>
          </button>
        </div>
      </div>

      {/* Ineligible notice banner (§4) */}
      {!canSend && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🔒</span>
            <span>조직 정보가 등록되면 보낼 수 있습니다.</span>
          </div>
          <button
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent("openMyProfileModal"))}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
          >
            내 조직 정보 신청 →
          </button>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-semibold flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-500 hover:text-rose-700 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-4 max-w-4xl">
        {/* Title */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            제목 <span className="text-slate-400 font-normal">(선택 사항)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목을 입력하지 않으면 본문 첫 줄이 미리보기로 표시됩니다."
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
            maxLength={100}
          />
        </div>

        {/* Body Editor */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            쪽지 내용 <span className="text-rose-500">*</span>
          </label>
          <div className="border border-slate-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
            <MemoEditorToolbar
              editorRef={editorRef}
              onContentChange={syncBodyMd1}
            />
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onInput={syncBodyMd1}
              onBlur={syncBodyMd1}
              data-placeholder="쪽지 내용을 입력해 주세요."
              className="w-full px-3.5 py-2.5 text-[15px] leading-relaxed min-h-[160px] max-h-[300px] overflow-y-auto focus:outline-none bg-white text-slate-800 font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-1 [&_blockquote]:px-3 [&_blockquote]:rounded-r-md [&_blockquote]:my-1.5 [&_blockquote]:text-slate-700 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:block"
            />
          </div>
        </div>

        {/* Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700">
              첨부 파일 {stagedAttachments.length > 0 && `(${stagedAttachments.length}/${MEMO_MAX_ATTACHMENTS})`}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || stagedAttachments.length >= MEMO_MAX_ATTACHMENTS}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              <span>+ 파일 첨부</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {stagedAttachments.length > 0 ? (
            <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200 max-h-48 overflow-y-auto">
              {stagedAttachments.map((item) => {
                const isImg = isImageFile(item.name);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between px-3 py-2 bg-white rounded-lg border text-xs ${
                      item.status === "error"
                        ? "border-rose-300 bg-rose-50/50"
                        : item.status === "done"
                        ? "border-slate-200"
                        : "border-indigo-200 bg-indigo-50/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span>{isImg ? "🖼️" : "📄"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-slate-800 font-medium">{item.name}</span>
                          <span className="text-slate-400 text-[10px] flex-shrink-0">
                            ({formatAttachmentSize(item.size)})
                          </span>
                        </div>
                        {item.status === "uploading" && (
                          <p className="text-[10px] text-indigo-600 font-medium">
                            {item.progressText || "업로드 중…"}
                          </p>
                        )}
                        {item.status === "error" && (
                          <p className="text-[10px] text-rose-600 font-semibold leading-snug">
                            ⚠️ {item.error || "업로드에 실패했습니다."}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(item.id)}
                      className="text-slate-400 hover:text-rose-600 font-bold ml-2 cursor-pointer p-0.5 flex-shrink-0"
                      title="첨부 제거"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-3 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              첨부된 파일이 없습니다.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Send Bar */}
      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 max-w-4xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClearSelection}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            선택 비우기
          </button>
          {disableReason && (
            <p className={`text-xs font-semibold ${hasAttachmentError ? "text-rose-600" : "text-slate-500"}`}>
              {disableReason}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSubmit}
          title={disableReason || undefined}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
        >
          {sending ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>쪽지 보내는 중...</span>
            </>
          ) : (
            <>
              <span>✉️</span>
              <span>{selectedEmails.size}명에게 쪽지 보내기</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
