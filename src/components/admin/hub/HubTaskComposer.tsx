"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { TaskFormFile, TaskKind } from "@/lib/tasks/logic";
import {
  TASK_MAX_FORM_FILES,
  TASK_SERVER_UPLOAD_MAX_BYTES,
  validateTaskFileName,
  validateTaskFileSize,
} from "@/lib/tasks/logic";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting, stripMd1 } from "@/lib/memo/richtext";
import { previewRecipientLine, buildRecipientMeta, deriveRecipientChips, RecipientChip } from "@/lib/org/recipients";
import type { TeacherProfile } from "@/context/AuthContext";
import { resolveDisplayName } from "@/lib/org/displayName";

/** 고른 파일 1건 — 업로드 전에는 `uploaded`가 없다. 발송 때 채워지고, 재시도 시 건너뛰는 표식이 된다. */
interface PendingFormFile {
  key: string;
  file: File;
  uploaded?: TaskFormFile;
}

interface HubTaskComposerProps {
  selectedEmails: Set<string>;
  onClearSelection: () => void;
  onRemoveEmail: (email: string) => void;
  onSwitchToMemo: () => void;
  onSent: () => void;
  profiles: TeacherProfile[];
  gwsNameMap: Map<string, string>;
  initialTitle?: string;
  initialBody?: string;
  canSend: boolean;
  hasDraftRef?: React.MutableRefObject<boolean>;
  currentDraftRef?: React.MutableRefObject<{ title: string; body: string; hasAttachments: boolean }>;
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
  hasDraftRef,
  currentDraftRef,
}: HubTaskComposerProps) {
  const [title, setTitle] = useState(initialTitle);
  const [kind, setKind] = useState<TaskKind>("confirm");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [dueTime, setDueTime] = useState("17:00");
  const plainInitialBody = useMemo(() => (initialBody ? stripMd1(initialBody) : ""), [initialBody]);
  const [body, setBody] = useState(plainInitialBody);

  // 양식 파일은 「고른 뒤 발송 시 업로드」다 (2026-08-19 피드백 6번 처방).
  // 서버의 form_upload·form_session_* 는 **이미 존재하는 taskId** 를 요구하는데(api/tasks/route.ts:101·409),
  // 이 작성기는 prepare 를 발송 시점에 부른다. 그래서 고르는 즉시 올리려면 초안을 미리 만들어야 하고,
  // 그러면 ⓐ 작성을 접을 때마다 빈 초안 문서 + Drive 폴더 2개가 남고 ⓑ 초안 이후 제목·기한을 고치면
  // prepare 로 굳은 값이 그대로 발송된다(초안 갱신 액션이 없다). 두 함정을 다 피하려고 업로드를 발송으로 미룬다.
  const [pendingFiles, setPendingFiles] = useState<PendingFormFile[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 업로드 도중 실패했을 때 재시도가 초안을 하나 더 만들지 않도록 붙잡아 둔다.
  // 내용이 바뀌면 서명이 달라져 새 초안을 만든다 — 화면과 다른 내용이 발송되는 것을 막는 장치.
  const draftRef = useRef<{ taskId: string; signature: string } | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 부모(MessagingHub)의 draft 동기화 (결함 1, 결함 2)
  useEffect(() => {
    const hasDraft = !!(title.trim() || body.trim() || pendingFiles.length > 0);
    if (hasDraftRef) hasDraftRef.current = hasDraft;
    if (currentDraftRef) {
      currentDraftRef.current = {
        title,
        body,
        hasAttachments: pendingFiles.length > 0,
      };
    }
  }, [title, body, pendingFiles, hasDraftRef, currentDraftRef]);

  useEffect(() => {
    return () => {
      if (hasDraftRef) hasDraftRef.current = false;
      if (currentDraftRef) currentDraftRef.current = { title: "", body: "", hasAttachments: false };
    };
  }, [hasDraftRef, currentDraftRef]);

  // Sync initial body into DOM once mounted or when plainInitialBody changes
  useEffect(() => {
    if (editorRef.current && plainInitialBody && !editorRef.current.innerHTML) {
      editorRef.current.innerText = plainInitialBody;
    }
  }, [plainInitialBody]);

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

  const calculateDueAtMs = (): number => {
    const [y, m, d] = dueDate.split("-").map(Number);
    const [hh, mm] = dueTime.split(":").map(Number);
    return Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
  };

  // 파일 고르기 — 네트워크 호출 0. 이름·크기·개수만 여기서 거른다.
  // 서버와 같은 검사기를 쓴다(logic.ts는 네트워크 무의존이라 클라이언트에서도 임포트된다) — 규칙이 갈라지지 않게.
  const handleFormFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (pendingFiles.length >= TASK_MAX_FORM_FILES) {
      setError(`양식 파일은 최대 ${TASK_MAX_FORM_FILES}개까지 첨부할 수 있습니다.`);
      return;
    }
    const nameCheck = validateTaskFileName(file.name);
    if (!nameCheck.ok) {
      setError(nameCheck.error);
      return;
    }
    const sizeCheck = validateTaskFileSize(file.size, true);
    if (!sizeCheck.ok) {
      setError(sizeCheck.error);
      return;
    }

    setError(null);
    setPendingFiles((prev) => [
      ...prev,
      { key: `${file.name}-${file.size}-${prev.length}`, file },
    ]);
  };

  const handleRemoveFormFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /** 파일 1건을 업로드한다 — 4MB 이하는 서버 경유 multipart, 초과는 Drive 세션 3단 (원본 작성기와 동일 규약). */
  const uploadFormFile = async (taskId: string, file: File): Promise<TaskFormFile> => {
    if (file.size <= TASK_SERVER_UPLOAD_MAX_BYTES) {
      const formData = new FormData();
      formData.append("action", "form_upload");
      formData.append("taskId", taskId);
      formData.append("file", file);

      const res = await fetch("/api/tasks", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.formFile) {
        throw new Error(data.error || `양식 파일 「${file.name}」 업로드에 실패했습니다.`);
      }
      return data.formFile as TaskFormFile;
    }

    const startRes = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "form_session_start",
        taskId,
        fileName: file.name,
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

    const finishRes = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "form_session_finish",
        taskId,
        driveFileId: driveData.id,
      }),
    });
    const finishData = await finishRes.json().catch(() => ({}));
    if (!finishRes.ok || !finishData.success || !finishData.formFile) {
      throw new Error(finishData.error || "업로드 마무리에 실패했습니다.");
    }
    return finishData.formFile as TaskFormFile;
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
      const recipientSummary = previewRecipientLine(recipientChips); // 옛 문서 호환용 문장
      const recipientMeta = buildRecipientMeta(recipientChips); // 화면이 문장을 만들 재료
      const userList = Array.from(selectedEmails);

      // 1상: prepare — 초안 생성. 이미 만든 초안이 있고 내용이 그대로면 재사용한다(재시도 시 중복 초안 방지).
      // recipientSummary는 서명에서 뺀다 — 담긴 사람이 바뀌어도 send가 다시 실어 보내므로 초안을 버릴 이유가 없다.
      const signature = JSON.stringify([title.trim(), finalBody, hasMd1, kind, dueAt]);
      let taskId = draftRef.current?.signature === signature ? draftRef.current.taskId : "";
      // 이번 발송 동안의 작업 사본 — 루프 중에는 state가 아직 갱신되지 않으므로 여기서 판단한다.
      let working = pendingFiles;

      if (!taskId) {
        setProgress("업무 초안을 만드는 중...");
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
          recipientMeta,
            // 양식은 여기서 넘기지 않는다 — prepare는 formFiles를 읽지 않고 버린다(route.ts:198 문서 리터럴).
            // 파일은 taskId를 받은 뒤 form_upload로 올린다.
          }),
        });

        const prepareData = await prepareRes.json().catch(() => ({}));
        if (!prepareRes.ok || !prepareData.success || !prepareData.taskId) {
          throw new Error(prepareData.error || "업무 초안을 생성하지 못했습니다.");
        }
        taskId = prepareData.taskId as string;
        // 초안이 새로 만들어졌으니 앞서 올린 파일 표식은 무효다 (그 파일은 버려진 초안의 양식 폴더에 있다).
        working = working.map((p) => ({ ...p, uploaded: undefined }));
        setPendingFiles(working);
      }
      draftRef.current = { taskId, signature };

      // 1.5상: 양식 파일 업로드 — 이 시점에야 taskId가 있다. 하나라도 실패하면 발송하지 않는다.
      for (let i = 0; i < working.length; i++) {
        if (working[i].uploaded) continue; // 앞선 시도에서 이미 올라간 파일
        setProgress(`양식 파일 올리는 중 (${i + 1}/${working.length})`);
        const uploaded = await uploadFormFile(taskId, working[i].file);
        working = working.map((p, idx) => (idx === i ? { ...p, uploaded } : p));
        setPendingFiles(working);
      }

      // 2상: send
      setProgress("업무를 보내는 중...");
      const sendRes = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          taskId,
          recipients: { users: userList, groups: [] },
          recipientSummary,
          recipientMeta,
        }),
      });

      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok || !sendData.success) {
        throw new Error(sendData.error || "업무 발송에 실패했습니다.");
      }

      draftRef.current = null;
      setPendingFiles([]);
      onSent();
    } catch (err: any) {
      setError(err.message || "업무 등록 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  const handleSwitchClick = () => {
    syncBodyMd1();
    onSwitchToMemo();
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
            placeholder="예: 2026학년도 2학기 현장체험학습 참가 동의서 취합"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
            maxLength={200}
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

          {/* Due Date & Time (Directive 1 / Feedback 2) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              마감 기한 <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-slate-900"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              마감 하루 전 아침에 미완료 선생님께 기한 알림이 발송됩니다.
            </p>
          </div>
        </div>

        {/* Body Editor */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            내용
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
              data-placeholder="업무 내용, 유의사항, 제출 방법 등을 적어주세요."
              className="w-full px-3.5 py-2.5 text-sm leading-relaxed min-h-[140px] max-h-[260px] overflow-y-auto focus:outline-none bg-white text-slate-900 font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-1 [&_blockquote]:px-3 [&_blockquote]:rounded-r-md [&_blockquote]:my-1.5 [&_blockquote]:text-slate-700 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic"
            />
          </div>
        </div>

        {/* Form Attachments */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div>
              <label className="text-xs font-bold text-slate-700">
                양식 파일 첨부 (최대 {TASK_MAX_FORM_FILES}개)
              </label>
              <p className="text-[11px] text-slate-400 mt-0.5">
                한글(HWP/HWPX), 오피스, PDF 등 (파일당 30MB 이하)
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || pendingFiles.length >= TASK_MAX_FORM_FILES}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 cursor-pointer flex items-center gap-1 flex-shrink-0"
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

          {pendingFiles.length > 0 ? (
            <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              {pendingFiles.map((entry, idx) => (
                <div
                  key={entry.key}
                  className="flex items-center justify-between px-3 py-1.5 bg-white rounded-lg border border-slate-200 text-xs"
                >
                  <span className="truncate text-slate-800 font-medium">
                    📄 {entry.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFormFile(idx)}
                    disabled={sending}
                    className="text-slate-400 hover:text-rose-600 font-bold ml-2 cursor-pointer p-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-slate-500 px-1">
                고른 파일은 업무를 보낼 때 함께 올라갑니다.
              </p>
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              첨부된 양식 파일이 없습니다.
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
          disabled={sending || !canSend || selectedEmails.size === 0 || !title.trim()}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
        >
          {sending ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>{progress || "업무 등록 중..."}</span>
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
