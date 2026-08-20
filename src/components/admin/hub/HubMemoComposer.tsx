"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting, MEMO_CONTENT_FORMAT_MD1, collectMd1AttachmentIds, stripMd1 } from "@/lib/memo/richtext";
import { previewRecipientLine, buildRecipientMeta, deriveRecipientChips, RecipientChip } from "@/lib/org/recipients";
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
  onSwitchToTask: () => void;
  onSent: () => void;
  profiles: TeacherProfile[];
  gwsNameMap: Map<string, string>;
  initialTitle?: string;
  initialBody?: string;
  canSend: boolean;
  hasDraftRef?: React.MutableRefObject<boolean>;
  currentDraftRef?: React.MutableRefObject<{ title: string; body: string; hasAttachments: boolean }>;
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
  currentDraftRef,
}: HubMemoComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const plainInitialBody = useMemo(() => (initialBody ? stripMd1(initialBody) : ""), [initialBody]);
  const [body, setBody] = useState(plainInitialBody);
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  // 부모(MessagingHub)의 draft 동기화 (결함 1, 결함 2)
  useEffect(() => {
    const hasDraft = !!(title.trim() || body.trim() || stagedAttachments.length > 0);
    if (hasDraftRef) hasDraftRef.current = hasDraft;
    if (currentDraftRef) {
      currentDraftRef.current = {
        title,
        body,
        hasAttachments: stagedAttachments.length > 0,
      };
    }
  }, [title, body, stagedAttachments, hasDraftRef, currentDraftRef]);

  useEffect(() => {
    return () => {
      if (hasDraftRef) hasDraftRef.current = false;
      if (currentDraftRef) currentDraftRef.current = { title: "", body: "", hasAttachments: false };
    };
  }, [hasDraftRef, currentDraftRef]);

  useEffect(() => {
    if (editorRef.current && plainInitialBody && !editorRef.current.innerHTML) {
      editorRef.current.innerText = plainInitialBody;
    }
  }, [plainInitialBody]);

  // 편집기 커서/선택 영역 저장
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current) {
      const range = sel.getRangeAt(0);
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  }, []);

  const syncBodyMd1 = useCallback(() => {
    if (editorRef.current) {
      const md1 = serializeDomToMd1(editorRef.current);
      setBody(md1);
      return md1;
    }
    return body;
  }, [body]);

  // Range 유효성 검사 — 비동기 업로드 중 본문 편집으로 Range가 DOM에서 떨어졌는지 확인
  const isRangeValid = useCallback((r: Range | null): boolean => {
    if (!r || !editorRef.current) return false;
    try {
      const container = r.commonAncestorContainer;
      if (!container || !container.isConnected || !editorRef.current.contains(container)) {
        return false;
      }
      if (!r.startContainer.isConnected || !r.endContainer.isConnected) {
        return false;
      }
      const maxStart =
        r.startContainer.nodeType === Node.TEXT_NODE
          ? (r.startContainer.textContent?.length ?? 0)
          : r.startContainer.childNodes.length;
      const maxEnd =
        r.endContainer.nodeType === Node.TEXT_NODE
          ? (r.endContainer.textContent?.length ?? 0)
          : r.endContainer.childNodes.length;
      if (r.startOffset > maxStart || r.endOffset > maxEnd) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  // 편집기 커서 위치에 이미지 노드 삽입 (A-4 / spec §13)
  const insertInlineImage = useCallback(
    (attId: string, previewUrl: string, fileName: string) => {
      const editor = editorRef.current;
      if (!editor) return;

      const img = document.createElement("img");
      img.setAttribute("data-att-id", attId);
      img.setAttribute("src", previewUrl);
      img.setAttribute("alt", fileName);
      img.className = "max-w-full h-auto rounded-lg my-2 block";
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.display = "block";
      img.style.margin = "0.5rem 0";
      img.style.borderRadius = "0.5rem";

      const lineBreakDiv = document.createElement("div");
      lineBreakDiv.appendChild(document.createElement("br"));

      editor.focus();

      const sel = window.getSelection();
      let targetRange: Range | null = null;

      if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        if (isRangeValid(currentRange)) {
          targetRange = currentRange;
        }
      }

      if (!targetRange && isRangeValid(savedRangeRef.current)) {
        targetRange = savedRangeRef.current;
      }

      if (targetRange) {
        targetRange.deleteContents();
        targetRange.insertNode(lineBreakDiv);
        targetRange.insertNode(img);
      } else {
        editor.appendChild(img);
        editor.appendChild(lineBreakDiv);
      }

      const nextRange = document.createRange();
      nextRange.setStart(lineBreakDiv, 0);
      nextRange.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(nextRange);
      savedRangeRef.current = nextRange.cloneRange();

      syncBodyMd1();
    },
    [isRangeValid, syncBodyMd1]
  );

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

  // 본문에서 참조 중인 첨부 ID 집합 (A-4)
  const inlineAttachmentIds = useMemo(() => {
    return new Set(collectMd1AttachmentIds(body));
  }, [body]);

  // 파일 업로드 큐 처리 (A-6: 파일별 독립 업로드 + 실패 격리, 5: 남은 슬롯만 추가, 6: resizing 상태 적용)
  const enqueueFiles = (fileList: File[]) => {
    if (!fileList || fileList.length === 0) return;

    const currentCount = stagedAttachments.length;
    if (currentCount >= MEMO_MAX_ATTACHMENTS) {
      setError(`첨부 파일은 최대 ${MEMO_MAX_ATTACHMENTS}개까지 가능합니다.`);
      return;
    }

    const availableSlots = MEMO_MAX_ATTACHMENTS - currentCount;
    if (fileList.length > availableSlots) {
      setError(`첨부 파일은 최대 ${MEMO_MAX_ATTACHMENTS}개까지 가능합니다. (초과분 제외)`);
    } else {
      setError(null);
    }

    const selectedFiles = fileList.slice(0, availableSlots);

    const newItems: StagedAttachment[] = selectedFiles.map((file) => {
      const isImg = isImageFile(file.name, file.type);
      return {
        id: Math.random().toString(36).slice(2),
        name: file.name,
        size: file.size,
        status: isImg && file.size <= 4 * 1024 * 1024 ? "resizing" : "uploading",
        previewUrl: isImg && typeof window !== "undefined" ? URL.createObjectURL(file) : undefined,
        progressText: isImg && file.size <= 4 * 1024 * 1024 ? "최적화 중…" : "업로드 중…",
      };
    });

    setStagedAttachments((prev) => [...prev, ...newItems]);

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

          // 이미지인 경우 본문 커서 위치에 이미지 노드 자동 삽입 (A-4 / MemoSection:1470)
          if (isImageFile(file.name, file.type)) {
            const preview = item.previewUrl || uploaded.thumbnailLink || "";
            insertInlineImage(uploaded.driveFileId, preview, file.name);
          }
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

  // 클립보드 붙여넣기 — 이미지 파일 감지 (A-2)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          let fileName = file.name;
          if (!fileName || fileName === "image.png" || fileName === "blob") {
            const ext = file.type.split("/")[1] || "png";
            fileName = `붙여넣은 이미지.${ext}`;
          }
          const namedFile = new File([file], fileName, { type: file.type });
          imageFiles.push(namedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      enqueueFiles(imageFiles);
    }
  };

  // 편집기 붙여넣기 — 이미지 추출 or 평문 텍스트 강제 (A-2, A-3)
  const handleEditorPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const namedFile = new File(
              [file],
              file.name && file.name !== "image.png" ? file.name : "붙여넣은 이미지.png",
              { type: file.type }
            );
            imageFiles.push(namedFile);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        enqueueFiles(imageFiles);
        return;
      }
    }

    // 텍스트 붙여넣기는 외부 서식(HTML)을 배제하고 평문만 삽입 (A-3)
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
      syncBodyMd1();
      saveSelection();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (fileInputRef.current) fileInputRef.current.value = "";
    enqueueFiles(files);
  };

  const handleRemoveAttachment = (id: string) => {
    setStagedAttachments((prev) => {
      const target = prev.find((a) => a.id === id);

      // 편집기 DOM에서 해당 이미지 제거 (A-4)
      if (target?.attachment?.driveFileId && editorRef.current) {
        const imgs = editorRef.current.querySelectorAll(
          `img[data-att-id="${target.attachment.driveFileId}"]`
        );
        imgs.forEach((img) => img.remove());
        setTimeout(syncBodyMd1, 0);
      }

      if (target?.previewUrl && target.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return prev.filter((a) => a.id !== id);
    });
  };

  const isUploading = stagedAttachments.some((a) => a.status === "uploading" || a.status === "resizing");
  const failedAttachmentsCount = stagedAttachments.filter((a) => a.status === "error").length;
  const hasAttachmentError = failedAttachmentsCount > 0;
  const isBodyEmpty = !body.trim();
  const isBodyTooLong = body.length > 10000;
  const isNoRecipient = selectedEmails.size === 0;

  // A-7: 발송 불가 사유
  const disableReason = !canSend
    ? "조직 정보 등록 후 쪽지를 보낼 수 있습니다."
    : isNoRecipient
    ? "수신자를 선택해 주세요."
    : isBodyEmpty
    ? "쪽지 내용을 입력해 주세요."
    : isBodyTooLong
    ? "쪽지 내용은 최대 10,000자까지 작성할 수 있습니다."
    : hasAttachmentError
    ? `올릴 수 없는 첨부 ${failedAttachmentsCount}개가 있습니다. 빼면 보낼 수 있어요.`
    : isUploading
    ? "첨부 파일을 업로드하고 있습니다…"
    : null;

  const canSubmit = !sending && !isUploading && canSend && !isNoRecipient && !isBodyEmpty && !isBodyTooLong && !hasAttachmentError;

  // Send memo (no confirmation modal per memo_spec §11-1)
  const handleSend = async () => {
    if (!canSubmit) return;

    const finalBody = syncBodyMd1();
    if (!finalBody.trim()) {
      setError("쪽지 내용을 입력해 주세요.");
      return;
    }
    if (finalBody.length > 10000) {
      setError("쪽지 내용은 최대 10,000자까지 작성할 수 있습니다.");
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
      const recipientSummary = previewRecipientLine(recipientChips); // 옛 문서 호환용 문장
      const recipientMeta = buildRecipientMeta(recipientChips); // 화면이 문장을 만들 재료
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
          recipientMeta,
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
    syncBodyMd1();
    onSwitchToTask();
  };

  return (
    <div
      onPaste={handlePaste}
      className="flex-1 flex flex-col h-full bg-white overflow-y-auto p-6 space-y-6"
    >
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
            className="px-3 py-1.5 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer border border-slate-200 flex items-center gap-1.5"
          >
            <span>📌 업무로 바꾸기</span>
          </button>
        </div>
      </div>

      {/* Ineligible notice banner (§4) */}
      {!canSend && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🔒</span>
            <span>조직 정보가 등록되면 보낼 수 있습니다.</span>
          </div>
          <button
            type="button"
            onClick={() => document.dispatchEvent(new CustomEvent("openMyProfileModal"))}
            className="text-sm font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
          >
            내 조직 정보 신청 →
          </button>
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 font-semibold flex items-center justify-between">
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
          <label className="block text-sm font-bold text-slate-700 mb-1.5">
            제목 <span className="text-slate-400 font-normal">(선택 사항)</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목 (선택)"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
            maxLength={200}
          />
        </div>

        {/* Body Editor (A-5: 글자수 카운터) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-bold text-slate-700">
              쪽지 내용 <span className="text-rose-500">*</span>
            </label>
            <span
              className={`text-[11px] ${
                body.length > 10000 ? "text-rose-600 font-bold" : "text-slate-400"
              }`}
            >
              {body.length.toLocaleString()} / 10,000자
            </span>
          </div>
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
              onInput={() => {
                syncBodyMd1();
                saveSelection();
              }}
              onPaste={handleEditorPaste}
              onSelect={saveSelection}
              onMouseUp={saveSelection}
              onBlur={saveSelection}
              onKeyDown={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  if (["b", "B", "i", "I", "u", "U"].includes(e.key)) {
                    setTimeout(() => {
                      syncBodyMd1();
                      saveSelection();
                    }, 0);
                  }
                }
              }}
              onKeyUp={() => {
                syncBodyMd1();
                saveSelection();
              }}
              role="textbox"
              aria-multiline="true"
              aria-label="쪽지 내용"
              data-placeholder="쪽지 내용을 입력해 주세요."
              className="w-full px-3.5 py-2.5 text-[15px] leading-relaxed min-h-[160px] max-h-[300px] overflow-y-auto focus:outline-none bg-white text-slate-800 font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-1 [&_blockquote]:px-3 [&_blockquote]:rounded-r-md [&_blockquote]:my-1.5 [&_blockquote]:text-slate-700 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:block"
            />
          </div>
        </div>

        {/* Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-bold text-slate-700">
              첨부 파일 {stagedAttachments.length > 0 && `(${stagedAttachments.length}/${MEMO_MAX_ATTACHMENTS})`}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || stagedAttachments.length >= MEMO_MAX_ATTACHMENTS}
              className="text-sm font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              <span>+ 파일 첨부</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.zip,.txt,.csv"
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
                    className={`flex items-center justify-between px-3 py-2 bg-white rounded-lg border text-sm ${
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
                          <span className="text-slate-400 text-[11px] flex-shrink-0">
                            ({formatAttachmentSize(item.size)})
                          </span>
                          {/* A-4: 본문 삽입 버튼 / 본문에 들어감 표시 */}
                          {isImg && item.status === "done" && item.attachment && (
                            inlineAttachmentIds.has(item.attachment.driveFileId) ? (
                              <span className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                                본문에 들어감
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  insertInlineImage(
                                    item.attachment!.driveFileId,
                                    item.previewUrl || item.attachment!.thumbnailLink || "",
                                    item.name
                                  )
                                }
                                className="text-xs text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded font-semibold transition-colors cursor-pointer flex-shrink-0"
                                title="본문 커서 위치에 넣기"
                              >
                                + 본문에 넣기
                              </button>
                            )
                          )}
                        </div>
                        {item.status === "uploading" && (
                          <p className="text-xs text-indigo-600 font-medium">
                            {item.progressText || "업로드 중…"}
                          </p>
                        )}
                        {item.status === "error" && (
                          <p className="text-xs text-rose-600 font-semibold leading-snug">
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
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            선택 비우기
          </button>
          {disableReason && (
            <p className={`text-sm font-semibold ${hasAttachmentError ? "text-rose-600" : "text-slate-500"}`}>
              {disableReason}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSubmit}
          title={disableReason || undefined}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-sm rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
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
