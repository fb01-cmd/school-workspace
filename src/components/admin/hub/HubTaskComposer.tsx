"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { TaskFormFile, TaskKind } from "@/lib/tasks/logic";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting } from "@/lib/memo/richtext";
import { buildRecipientSummary, RecipientChip } from "@/lib/org/recipients";
import type { TeacherProfile } from "@/context/AuthContext";
import { resolveDisplayName } from "@/lib/org/displayName";

interface HubTaskComposerProps {
  selectedEmails: Set<string>;
  onClearSelection: () => void;
  onRemoveEmail: (email: string) => void;
  onSwitchToMemo: (title: string, body: string) => void;
  onSent: () => void;
  profiles: TeacherProfile[];
  gwsNameMap: Map<string, string>;
  initialTitle?: string;
  initialBody?: string;
  canSend: boolean;
}

export default function HubTaskComposer({
  selectedEmails,
  onClearSelection,
  onRemoveEmail,
  onSwitchToMemo,
  onSent,
  profiles,
  gwsNameMap,
  initialTitle = "",
  initialBody = "",
  canSend,
}: HubTaskComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [kind, setKind] = useState<TaskKind>("confirm");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [dueTime, setDueTime] = useState("17:00");
  const [body, setBody] = useState(initialBody);

  const [formFiles, setFormFiles] = useState<TaskFormFile[]>([]);
  const [uploadingForm, setUploadingForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initial body into DOM once mounted or when initialBody changes
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

  // Recipient chips for summary
  const recipientChips = useMemo<RecipientChip[]>(() => {
    const chips: RecipientChip[] = [];
    selectedEmails.forEach((email) => {
      const p = profileMap.get(email);
      const name = resolveDisplayName(email, p, gwsNameMap.get(email)).name;
      chips.push({
        type: "user",
        source: "person",
        email,
        label: name,
        deptLabel: p?.departments?.[0],
      });
    });
    return chips;
  }, [selectedEmails, profileMap, gwsNameMap]);

  const calculateDueAtMs = (): number => {
    const [y, m, d] = dueDate.split("-").map(Number);
    const [hh, mm] = dueTime.split(":").map(Number);
    return Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
  };

  // Form file upload handling
  const handleFormFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (formFiles.length >= 5) {
      alert("양식 파일은 최대 5개까지 첨부할 수 있습니다.");
      return;
    }

    setUploadingForm(true);
    try {
      if (file.size <= 4 * 1024 * 1024) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("action", "form_upload_temp");

        const res = await fetch("/api/tasks/file", {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.formFile) {
          throw new Error(data.error || "파일 업로드에 실패했습니다.");
        }
        setFormFiles((prev) => [...prev, data.formFile]);
      } else {
        // Session upload
        const startRes = await fetch("/api/tasks/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "form_session_start",
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
          }),
        });
        const startData = await startRes.json().catch(() => ({}));
        if (!startRes.ok || !startData.success || !startData.sessionUrl) {
          throw new Error(startData.error || "대용량 업로드 세션 발급에 실패했습니다.");
        }

        const driveRes = await fetch(startData.sessionUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const driveData = await driveRes.json().catch(() => ({}));
        if (!driveRes.ok || !driveData.id) {
          throw new Error("드라이브 전송에 실패했습니다.");
        }

        const finishRes = await fetch("/api/tasks/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "form_session_finish",
            driveFileId: driveData.id,
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
          }),
        });
        const finishData = await finishRes.json().catch(() => ({}));
        if (!finishRes.ok || !finishData.success || !finishData.formFile) {
          throw new Error(finishData.error || "업로드 마무리에 실패했습니다.");
        }
        setFormFiles((prev) => [...prev, finishData.formFile]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      alert(err.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadingForm(false);
    }
  };

  const handleRemoveFormFile = (index: number) => {
    setFormFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit and send task (2-phase)
  const handleSend = async () => {
    if (!canSend) return;

    if (!title.trim()) {
      setError("업무명을 입력해 주세요.");
      return;
    }
    if (selectedEmails.size === 0) {
      setError("업무를 전달할 수신자를 선택해 주세요.");
      return;
    }
    if (!dueDate || !dueTime) {
      setError("기한 날짜와 시각을 지정해 주세요.");
      return;
    }
    const dueAt = calculateDueAtMs();
    if (dueAt <= Date.now()) {
      setError("기한은 현재 시각보다 이후여야 합니다.");
      return;
    }

    setSending(true);
    setError(null);

    try {
      const finalBody = syncBodyMd1();
      const hasMd1 = bodyHasMd1Formatting(finalBody);
      const recipientSummary = buildRecipientSummary(recipientChips);
      const userList = Array.from(selectedEmails);

      // Phase 1: prepare
      const prepareRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          title: title.trim(),
          body: finalBody,
          contentFormat: hasMd1 ? "md1" : undefined,
          kind,
          dueAt,
          recipientSummary,
          formFiles: formFiles.length > 0 ? formFiles : undefined,
        }),
      });

      const prepareData = await prepareRes.json().catch(() => ({}));
      if (!prepareRes.ok || !prepareData.success || !prepareData.taskId) {
        throw new Error(prepareData.error || "업무 초안을 생성하지 못했습니다.");
      }

      const taskId = prepareData.taskId;

      // Phase 2: send
      const sendRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          taskId,
          recipients: { users: userList, groups: [] },
          recipientSummary,
        }),
      });

      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok || !sendData.success) {
        throw new Error(sendData.error || "업무 발송에 실패했습니다.");
      }

      onSent();
    } catch (err: any) {
      setError(err.message || "업무 등록 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  const handleSwitchClick = () => {
    const currentBody = syncBodyMd1();
    onSwitchToMemo(title, currentBody);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white overflow-y-auto p-6 space-y-6">
      {/* Header with Switcher Hint */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>📌</span>
            <span>새 업무 등록</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            기한과 제출 양식이 있는 정식 업무를 배분합니다.
          </p>
        </div>

        {/* Switch to Memo with Helper Copy (§2-5) */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 hidden xl:inline">
            기한이 있는 일은 업무로 보내면 누가 끝냈는지 자동으로 모입니다.
          </span>
          <button
            type="button"
            onClick={handleSwitchClick}
            className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer border border-slate-200 flex items-center gap-1.5"
          >
            <span>✉️ 쪽지로 바꾸기</span>
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
            업무명 <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 2026학년도 1학기 교육과정 반성 및 만족도 조사지 제출"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
            maxLength={100}
          />
        </div>

        {/* Kind and Due Date Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Kind Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              업무 방식 <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("confirm")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex flex-col items-center gap-0.5 ${
                  kind === "confirm"
                    ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 shadow-2xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>✅ 확인형</span>
                <span className="text-[10px] font-normal text-slate-500">완료 체크만 필요</span>
              </button>
              <button
                type="button"
                onClick={() => setKind("submit")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer flex flex-col items-center gap-0.5 ${
                  kind === "submit"
                    ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 shadow-2xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>📂 제출형</span>
                <span className="text-[10px] font-normal text-slate-500">서식/파일 제출 필요</span>
              </button>
            </div>
          </div>

          {/* Due Date & Time */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              마감 기한 <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-28 px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
              />
            </div>
          </div>
        </div>

        {/* Body Editor */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            지시 내용 및 안내 사항
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
              data-placeholder="지시 내용이나 전달 사항을 입력해 주세요."
              className="p-3.5 min-h-[160px] text-sm text-slate-900 focus:outline-none leading-relaxed prose prose-sm max-w-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none"
            />
          </div>
        </div>

        {/* Form Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700">
              양식 파일 첨부 {formFiles.length > 0 && `(${formFiles.length}/5)`}
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingForm || formFiles.length >= 5}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              <span>+ 양식 파일 추가</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFormFileUpload}
              className="hidden"
            />
          </div>

          {formFiles.length > 0 ? (
            <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              {formFiles.map((file, idx) => (
                <div
                  key={file.driveFileId || idx}
                  className="flex items-center justify-between px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-xs"
                >
                  <span className="truncate text-slate-800 font-medium">
                    📄 {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFormFile(idx)}
                    className="text-slate-400 hover:text-rose-600 font-bold ml-2 cursor-pointer p-0.5"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              {uploadingForm ? "양식 파일을 업로드하고 있습니다..." : "첨부된 양식 파일이 없습니다."}
            </div>
          )}
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
          disabled={sending || uploadingForm || !canSend || selectedEmails.size === 0 || !title.trim()}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
        >
          {sending ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>업무 등록 중...</span>
            </>
          ) : (
            <>
              <span>📌</span>
              <span>{selectedEmails.size}명에게 업무 등록</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
