"use client";

// 업무 작성 및 발송 모달 (2상 흐름) — docs/phase8_tasks_spec.md §2~§5, §7
// 1상: prepare (기본 정보 + 본문) -> taskId 수령
// 양식 업로드 (form_upload, 최대 5개, <=4MB)
// 2상: send (수신자 지정 및 최종 발송) — 발송 전에는 초안으로 수신자에게 미노출

import { useState, useRef, useCallback, useEffect } from "react";
import TaskRecipientPickerModal from "./TaskRecipientPickerModal";
import type { RecipientChip } from "@/lib/org/recipients";
import type { TaskFormFile, TaskKind } from "@/lib/tasks/logic";
import MemoEditorToolbar from "@/components/common/MemoEditorToolbar";
import { serializeDomToMd1 } from "@/lib/memo/richtext_dom";
import { bodyHasMd1Formatting, unescapeMd1Literal } from "@/lib/memo/richtext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function TaskComposerModal({ isOpen, onClose, onSuccess }: Props) {
  // 단계: 1(내용 작성) -> 2(양식 첨부 및 수신자 지정)
  const [step, setStep] = useState<1 | 2>(1);

  // 1단계 입력값
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("confirm");
  const [dueDate, setDueDate] = useState(() => {
    // 3일 뒤 KST 날짜
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [dueTime, setDueTime] = useState("17:00");
  const [body, setBody] = useState("");

  // 편집기 ref (MemoEditorToolbar 및 contenteditable 연동 — 피드백 9번)
  const editorRef = useRef<HTMLDivElement>(null);
  const syncBodyMd1 = useCallback(() => {
    if (editorRef.current) {
      const md1 = serializeDomToMd1(editorRef.current);
      setBody(md1);
    }
  }, []);

  // 2단계 데이터
  const [preparedTaskId, setPreparedTaskId] = useState<string | null>(null);
  const [formFiles, setFormFiles] = useState<TaskFormFile[]>([]);
  const [uploadingForm, setUploadingForm] = useState(false);

  // 수신자
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [recipientSummary, setRecipientSummary] = useState("");
  const [recipientChips, setRecipientChips] = useState<RecipientChip[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // 로딩 및 에러
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 전체 상태 초기화 함수 (피드백 24번)
  const resetForm = useCallback(() => {
    setStep(1);
    setTitle("");
    setKind("confirm");
    const d = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000);
    setDueDate(d.toISOString().slice(0, 10));
    setDueTime("17:00");
    setBody("");
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
    setPreparedTaskId(null);
    setFormFiles([]);
    setUploadingForm(false);
    setSelectedUsers([]);
    setRecipientSummary("");
    setRecipientChips([]);
    setIsPickerOpen(false);
    setLoading(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // 모달이 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  const handleModalClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  // 기한 ms 계산 (KST 기준)
  const calculateDueAtMs = (): number => {
    const [y, m, d] = dueDate.split("-").map(Number);
    const [hh, mm] = dueTime.split(":").map(Number);
    // UTC 밀리초로 환산 (KST는 UTC+9)
    return Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
  };

  // 1단계 -> 2단계: prepare 호출
  const handlePrepare = async () => {
    if (!title.trim()) {
      setError("업무명을 입력해 주세요.");
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

    setLoading(true);
    setError(null);
    try {
      const finalBody = body.trim();
      const hasMd1 = bodyHasMd1Formatting(finalBody);
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          title: title.trim(),
          // 평문으로 강등해 보낼 땐 이스케이프를 풀어 저장한다 (2026-08-21)
          body: hasMd1 ? finalBody : unescapeMd1Literal(finalBody),
          contentFormat: hasMd1 ? "md1" : undefined,
          kind,
          dueAt,
          recipientSummary: "",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "업무 초안을 준비하지 못했습니다.");
      }

      setPreparedTaskId(data.taskId);
      setStep(2);
    } catch (err: any) {
      setError(err.message || "업무 준비 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 양식 파일 업로드 (4MB 이하 form_upload, 4MB 초과~30MB form_session 3단 흐름 — 피드백 36번)
  const handleFormUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !preparedTaskId) return;

    if (formFiles.length >= 5) {
      alert("양식 파일은 최대 5개까지 올릴 수 있습니다.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      alert(`양식 파일은 30MB 이하로 올려 주세요. (선택한 파일: ${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadingForm(true);
    try {
      if (file.size <= 4 * 1024 * 1024) {
        // 4MB 이하: 기존 multipart form_upload
        const formData = new FormData();
        formData.append("action", "form_upload");
        formData.append("taskId", preparedTaskId);
        formData.append("file", file);

        const res = await fetch("/api/tasks", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "양식 파일 업로드 실패");
        }

        setFormFiles((prev) => [...prev, data.formFile]);
      } else {
        // 4MB 초과 ~ 30MB: 세션 3단 업로드 (§5-4, 피드백 36번)
        const startRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "form_session_start",
            taskId: preparedTaskId,
            fileName: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
          }),
        });
        const startData = await startRes.json();
        if (!startRes.ok || !startData.success) {
          throw new Error(startData.error || "대용량 업로드 세션 발급에 실패했습니다.");
        }

        const driveRes = await fetch(startData.sessionUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        const driveData = await driveRes.json();
        if (!driveRes.ok || !driveData.id) {
          throw new Error("드라이브 직접 전송에 실패했습니다.");
        }

        const finishRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "form_session_finish",
            taskId: preparedTaskId,
            driveFileId: driveData.id,
          }),
        });
        const finishData = await finishRes.json();
        if (!finishRes.ok || !finishData.success) {
          throw new Error(finishData.error || "양식 업로드 완료 확인에 실패했습니다.");
        }

        setFormFiles((prev) => [...prev, finishData.formFile]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      alert(err.message || "양식 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadingForm(false);
    }
  };

  // 최종 발송 (send)
  const handleSend = async () => {
    if (!preparedTaskId) return;
    if (selectedUsers.length === 0) {
      setError("업무를 전달할 수신자를 최소 1명 이상 선택해 주세요.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          taskId: preparedTaskId,
          recipients: { users: selectedUsers, groups: [] },
          recipientSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "업무 발송에 실패했습니다.");
      }

      alert("업무가 성공적으로 발송되었습니다.");
      onSuccess?.();
      handleModalClose();
    } catch (err: any) {
      setError(err.message || "발송 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handlePickerConfirm = (result: {
    users: string[];
    groups: string[];
    summary: string;
    chips: RecipientChip[];
  }) => {
    setSelectedUsers(result.users);
    setRecipientSummary(result.summary);
    setRecipientChips(result.chips);
  };

  const handleRemoveChip = (email: string) => {
    const nextUsers = selectedUsers.filter((u) => u !== email);
    const nextChips = recipientChips.filter((c) => c.email !== email);
    setSelectedUsers(nextUsers);
    setRecipientChips(nextChips);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>📌</span>
              <span>업무 등록</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={handleModalClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold p-1 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* 단계 인디케이터 */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-indigo-50/50 border-b border-slate-100 text-sm font-bold select-none">
          <span className={step === 1 ? "text-indigo-600 font-extrabold" : "text-slate-500"}>
            ① 업무 내용 및 기한 설정
          </span>
          <span className="text-slate-300">›</span>
          <span className={step === 2 ? "text-indigo-600 font-extrabold" : "text-slate-400"}>
            ② 양식 첨부 및 수신자 발송
          </span>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold rounded-xl p-3">
              ⚠️ {error}
            </div>
          )}

          {/* ── 1단계: 내용 및 기한 ── */}
          {step === 1 && (
            <div className="space-y-4">
              {/* 업무명 */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  업무명 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 2026학년도 2학기 현장체험학습 참가 동의서 취합"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
                  required
                />
              </div>

              {/* 업무 유형 선택 */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  업무 유형 <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setKind("confirm")}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      kind === "confirm"
                        ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="text-sm flex items-center gap-1.5">
                      <span>✅</span>
                      <span>확인형 업무</span>
                    </div>
                    <div className="text-xs text-slate-500 font-normal mt-1">
                      공지 확인이나 처리 완료 체크만 필요한 업무
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setKind("submit")}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      kind === "submit"
                        ? "border-indigo-600 bg-indigo-50/70 text-indigo-950 font-bold ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="text-sm flex items-center gap-1.5">
                      <span>📁</span>
                      <span>제출형 업무</span>
                    </div>
                    <div className="text-xs text-slate-500 font-normal mt-1">
                      서식 파일을 작성하여 제출받는 업무 (파일명 자동 정규화)
                    </div>
                  </button>
                </div>
              </div>

              {/* 기한 설정 */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  기한 (마감 일시) <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
                    />
                  </div>
                  <div>
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  마감 하루 전 아침에 미완료 선생님께 기한 알림이 발송됩니다.
                </p>
              </div>

              {/* 내용 (피드백 8번 명칭 + 피드백 9번 MemoEditorToolbar 서식 편집기) */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-1.5">
                  내용
                </label>
                <div className="rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                  <MemoEditorToolbar
                    editorRef={editorRef}
                    onContentChange={syncBodyMd1}
                  />
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false} // 맞춤법 빨간 줄이 링크 표시와 혼동됨 (2026-08-19 실기기)
                    onInput={syncBodyMd1}
                    onPaste={syncBodyMd1}
                    onKeyUp={syncBodyMd1}
                    role="textbox"
                    aria-multiline="true"
                    aria-label="업무 내용"
                    data-placeholder="업무 내용, 유의사항, 제출 방법 등을 적어주세요."
                    className="w-full px-3.5 py-2.5 text-sm leading-relaxed min-h-[140px] max-h-[260px] overflow-y-auto focus:outline-none bg-white text-slate-900 font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400 empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:border-indigo-400 [&_blockquote]:bg-indigo-50/40 [&_blockquote]:py-1 [&_blockquote]:px-3 [&_blockquote]:rounded-r-md [&_blockquote]:my-1.5 [&_blockquote]:text-slate-700 [&_blockquote]:italic [&_a]:text-indigo-600 [&_a]:underline [&_u]:underline [&_u]:underline-offset-2 [&_s]:line-through [&_strike]:line-through [&_del]:line-through [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── 2단계: 양식 첨부 & 수신자 지정 ── */}
          {step === 2 && (
            <div className="space-y-6">
              {/* 양식 파일 첨부 (제출형 권장) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                      <span>📎</span>
                      <span>작성 양식 파일 첨부 (선택, 최대 5개)</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      한글(HWP/HWPX), 오피스, PDF 등 (파일당 30MB 이하)
                    </p>
                  </div>
                  {formFiles.length < 5 && (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFormUpload}
                        className="hidden"
                        id="task-form-file-input"
                      />
                      <label
                        htmlFor="task-form-file-input"
                        className="px-3 py-1.5 bg-white border border-slate-300 hover:border-indigo-500 hover:text-indigo-600 text-sm font-bold text-slate-700 rounded-lg cursor-pointer transition-colors inline-block"
                      >
                        {uploadingForm ? "올리는 중…" : "+ 파일 추가"}
                      </label>
                    </div>
                  )}
                </div>

                {formFiles.length > 0 ? (
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white overflow-hidden">
                    {formFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 flex items-center justify-between text-sm"
                      >
                        <span className="font-semibold text-slate-800 truncate flex-1 mr-2">
                          📄 {file.name}
                        </span>
                        <span className="text-slate-400 text-[11px]">
                          {(file.size / 1024).toFixed(0)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4 text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white">
                    {kind === "submit"
                      ? "양식 파일을 첨부하시면 수신자가 내려받아 작성 후 제출할 수 있습니다."
                      : "첨부된 양식 파일이 없습니다."}
                  </div>
                )}
              </div>

              {/* 수신자 선택 영역 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-800">
                    업무 수신자 지정 <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsPickerOpen(true)}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-sm font-bold transition-colors cursor-pointer"
                  >
                    👥 조직도에서 선택
                  </button>
                </div>

                {selectedUsers.length > 0 ? (
                  <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50 space-y-2">
                    <div className="text-sm font-bold text-slate-700 flex items-center justify-between">
                      <span>지정된 수신자: {selectedUsers.length}명</span>
                      {recipientSummary && (
                        <span className="text-indigo-600 font-normal">({recipientSummary})</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pt-1">
                      {recipientChips.map((chip) => (
                        <span
                          key={chip.email}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-slate-200 text-slate-800 shadow-2xs"
                        >
                          <span>{chip.label}</span>
                          {chip.deptLabel && (
                            <span className="text-[11px] text-slate-400">({chip.deptLabel})</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveChip(chip.email)}
                            className="text-slate-400 hover:text-rose-600 ml-0.5 cursor-pointer font-bold"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => setIsPickerOpen(true)}
                    className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center text-xs text-slate-400 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer transition-colors"
                  >
                    [조직도에서 선택] 버튼을 눌러 업무를 보낼 선생님들을 선택해 주세요.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 버튼 */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={handleModalClose}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handlePrepare}
                disabled={loading || !title.trim()}
                className="px-5 py-2 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {loading ? "준비 중…" : "다음 (수신자 지정) ›"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={loading}
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors cursor-pointer"
              >
                ← 이전
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || selectedUsers.length === 0}
                className="px-6 py-2.5 text-sm font-extrabold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors cursor-pointer flex items-center gap-2 shadow-xs"
              >
                {loading ? (
                  <>
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                    <span>발송 중…</span>
                  </>
                ) : (
                  <span>🚀 업무 최종 발송하기 ({selectedUsers.length}명)</span>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 수신자 선택 모달 */}
      <TaskRecipientPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        initialSelectedEmails={selectedUsers}
        onConfirm={handlePickerConfirm}
      />
    </div>
  );
}
