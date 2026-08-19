"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting, MEMO_CONTENT_FORMAT_MD1 } from "@/lib/memo/richtext";
import { buildRecipientSummary, RecipientChip } from "@/lib/org/recipients";
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
  deptSources?: Record<string, string>;
  onClearSelection: () => void;
  onRemoveEmail: (email: string) => void;
  onSwitchToTask: (title: string, body: string) => void;
  onSent: () => void;
  profiles: TeacherProfile[];
  gwsNameMap: Map<string, string>;
  initialTitle?: string;
  initialBody?: string;
  canSend: boolean;
}

export default function HubMemoComposer({
  selectedEmails,
  deptSources,
  onClearSelection,
  onRemoveEmail,
  onSwitchToTask,
  onSent,
  profiles,
  gwsNameMap,
  initialTitle = "",
  initialBody = "",
  canSend,
}: HubMemoComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  const [attachments, setAttachments] = useState<MemoAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState<string | null>(null);

  const [links, setLinks] = useState<{ url: string; title?: string }[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);

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

  // Recipient chips for summary (Directive 10 / Feedback 13)
  const recipientChips = useMemo<RecipientChip[]>(() => {
    const chips: RecipientChip[] = [];
    selectedEmails.forEach((email) => {
      const p = profileMap.get(email);
      const name = resolveDisplayName(email, p, gwsNameMap.get(email)).name;
      const deptSource = deptSources?.[email];
      chips.push({
        type: "user",
        source: deptSource ? "dept" : "person",
        email,
        label: name,
        deptLabel: deptSource || p?.departments?.[0],
      });
    });
    return chips;
  }, [selectedEmails, profileMap, gwsNameMap, deptSources]);

  // Handle file uploads
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (attachments.length + files.length > MEMO_MAX_ATTACHMENTS) {
      alert(`첨부 파일은 최대 ${MEMO_MAX_ATTACHMENTS}개까지 가능합니다.`);
      return;
    }

    setUploadingFiles(true);
    setError(null);

    try {
      for (const file of files) {
        setUploadProgressMsg(`${file.name} 올리는 중…`);
        const att = await uploadAttachment(file, (msg) => setUploadProgressMsg(msg));
        setAttachments((prev) => [...prev, att]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setError(err.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadingFiles(false);
      setUploadProgressMsg(null);
    }
  };

  const handleRemoveAttachment = (driveFileId: string) => {
    setAttachments((prev) => prev.filter((a) => a.driveFileId !== driveFileId));
  };

  const handleAddLink = () => {
    if (!newLinkUrl.trim()) return;
    let url = newLinkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }
    setLinks((prev) => [...prev, { url, title: newLinkTitle.trim() || undefined }]);
    setNewLinkUrl("");
    setNewLinkTitle("");
    setIsAddingLink(false);
  };

  const handleRemoveLink = (index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  };

  // Send memo (no confirmation modal per memo_spec §11-1)
  const handleSend = async () => {
    if (!canSend) return;

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
      const driveFileIds = attachments.map((a) => a.driveFileId);

      const res = await fetch("/api/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          title: title.trim() || undefined,
          body: finalBody,
          contentFormat: hasMd1 ? MEMO_CONTENT_FORMAT_MD1 : undefined,
          links: links.length > 0 ? links : undefined,
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
              onInput={syncBodyMd1}
              onBlur={syncBodyMd1}
              data-placeholder="쪽지 내용을 입력해 주세요."
              className="p-3.5 min-h-[200px] text-sm text-slate-900 focus:outline-none leading-relaxed prose prose-sm max-w-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none"
            />
          </div>
        </div>

        {/* Attachments & Links Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                첨부 파일 {attachments.length > 0 && `(${attachments.length}/${MEMO_MAX_ATTACHMENTS})`}
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFiles || attachments.length >= MEMO_MAX_ATTACHMENTS}
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

            {attachments.length > 0 ? (
              <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200 max-h-36 overflow-y-auto">
                {attachments.map((file) => (
                  <div
                    key={file.driveFileId}
                    className="flex items-center justify-between px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-xs"
                  >
                    <span className="truncate text-slate-800 font-medium">
                      {isImageFile(file.name) ? "🖼️" : "📄"} {file.name}
                      <span className="text-slate-400 text-[10px] ml-1.5">
                        ({formatAttachmentSize(file.size)})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(file.driveFileId)}
                      className="text-slate-400 hover:text-rose-600 font-bold ml-2 cursor-pointer p-0.5"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-3 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                {uploadProgressMsg || (uploadingFiles ? "파일 올리는 중..." : "첨부된 파일이 없습니다.")}
              </div>
            )}
          </div>

          {/* Links */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">
                웹 링크 {links.length > 0 && `(${links.length})`}
              </label>
              {!isAddingLink && (
                <button
                  type="button"
                  onClick={() => setIsAddingLink(true)}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer flex items-center gap-1"
                >
                  <span>+ 링크 추가</span>
                </button>
              )}
            </div>

            {isAddingLink && (
              <div className="p-2.5 bg-slate-50 border border-indigo-200 rounded-xl space-y-2 mb-2">
                <input
                  type="text"
                  value={newLinkUrl}
                  onChange={(e) => setNewLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                />
                <input
                  type="text"
                  value={newLinkTitle}
                  onChange={(e) => setNewLinkTitle(e.target.value)}
                  placeholder="링크 설명/제목 (선택 사항)"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingLink(false);
                      setNewLinkUrl("");
                      setNewLinkTitle("");
                    }}
                    className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-800 cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={handleAddLink}
                    disabled={!newLinkUrl.trim()}
                    className="px-3 py-1 bg-indigo-600 text-white font-bold text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                  >
                    추가
                  </button>
                </div>
              </div>
            )}

            {links.length > 0 ? (
              <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200 max-h-36 overflow-y-auto">
                {links.map((link, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-xs"
                  >
                    <span className="truncate text-indigo-600 underline font-medium">
                      🔗 {link.title || link.url}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveLink(idx)}
                      className="text-slate-400 hover:text-rose-600 font-bold ml-2 cursor-pointer p-0.5"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              !isAddingLink && (
                <div className="py-3 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  추가된 링크가 없습니다.
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Bottom Send Bar */}
      <div className="pt-4 border-t border-slate-200 flex items-center justify-between max-w-4xl">
        <button
          type="button"
          onClick={onClearSelection}
          className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          선택 비우기
        </button>

        <button
          type="button"
          onClick={handleSend}
          disabled={sending || uploadingFiles || !canSend || selectedEmails.size === 0 || !body.trim()}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
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
