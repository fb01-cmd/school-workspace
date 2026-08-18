// Phase 8 3단계 업무 지시 — 순수 검증·상태 머신 로직 (docs/phase8_tasks_spec.md §2·§3·§5·§6)
// 이 파일은 네트워크·Firestore 무의존이다 — selftest(scripts/tasks_selftest.ts)가 직접 임포트한다.

export const TASK_MAX_TITLE = 200;
export const TASK_MAX_BODY = 10000;
export const TASK_MAX_RECIPIENTS = 300;
export const TASK_MAX_FORM_FILES = 5;
export const TASK_DEFAULT_RETENTION_DAYS = 365;
/** 서버 경유 업로드 상한 (Vercel 본문 4.5MB 내 여유) — 초과는 Drive 세션 경로 (§5-4) */
export const TASK_SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** 파일 절대 상한 (세션 경로 포함) */
export const TASK_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** 재촉 최소 간격 (§6 — 업무당 24시간 1회) */
export const TASK_NUDGE_INTERVAL_MS = 24 * 3600 * 1000;

export type TaskKind = "confirm" | "submit";
export type TaskRecipientState = "PENDING" | "ACCEPTED" | "DECLINED" | "DONE";
export type TaskAction = "accept" | "decline" | "done" | "undone";

export interface TaskRecipientStatus {
  state: TaskRecipientState;
  at: number;
  /** 거절 사유 — DECLINED에서 필수 (§3) */
  note?: string;
}

export interface TaskFormFile {
  driveFileId: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface TaskSubmission {
  driveFileId: string;
  name: string; // 정규화된 파일명 (§5-3)
  size: number;
  at: number;
  version: number; // 재제출마다 +1 (실체는 최신본 교체 — Drive 버전 이력 30일)
}

export interface TaskDoc {
  senderEmail: string;
  senderName: string;
  title: string;
  body: string;
  contentFormat?: "md1";
  kind: TaskKind;
  dueAt: number;
  recipientEmails: string[];
  recipientCount: number;
  recipientSummary: string;
  statuses: Record<string, TaskRecipientStatus>;
  formFiles?: TaskFormFile[];
  submissions?: Record<string, TaskSubmission>;
  submitFolderId?: string;
  formFolderId?: string;
  lastNudgeAt?: number;
  canceledAt?: number;
  createdAt: number;
  expireAt: number;
}

// ── 본문 검증 (memo validateMemoContent 계열) ────────────────

export function validateTaskContent(input: {
  title?: unknown;
  body?: unknown;
  kind?: unknown;
  dueAt?: unknown;
  contentFormat?: unknown;
  recipientSummary?: unknown;
  now: number;
}):
  | { ok: true; content: { title: string; body: string; kind: TaskKind; dueAt: number; contentFormat?: "md1"; recipientSummary: string } }
  | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "업무명을 입력해 주세요." };
  if (title.length > TASK_MAX_TITLE) return { ok: false, error: `업무명은 ${TASK_MAX_TITLE}자 이내여야 합니다.` };

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length > TASK_MAX_BODY)
    return { ok: false, error: `내용은 ${TASK_MAX_BODY.toLocaleString()}자 이내여야 합니다.` };

  if (input.kind !== "confirm" && input.kind !== "submit")
    return { ok: false, error: "업무 유형이 유효하지 않습니다." };

  const dueAt = typeof input.dueAt === "number" ? input.dueAt : NaN;
  if (!Number.isFinite(dueAt)) return { ok: false, error: "기한을 지정해 주세요." };
  if (dueAt <= input.now) return { ok: false, error: "기한은 지금보다 뒤여야 합니다." };

  if (input.contentFormat !== undefined && input.contentFormat !== "md1")
    return { ok: false, error: "지원하지 않는 본문 형식입니다." };

  const recipientSummary =
    typeof input.recipientSummary === "string" ? input.recipientSummary.trim().slice(0, 100) : "";

  return {
    ok: true,
    content: {
      title,
      body,
      kind: input.kind,
      dueAt,
      recipientSummary,
      ...(input.contentFormat === "md1" ? { contentFormat: "md1" as const } : {}),
    },
  };
}

// ── 상태 머신 (§3) — 단일 소재지 ─────────────────────────────

export function applyTaskTransition(
  task: Pick<TaskDoc, "kind" | "statuses" | "recipientEmails" | "canceledAt">,
  email: string,
  action: TaskAction,
  note: string | undefined,
  now: number
): { ok: true; next: TaskRecipientStatus } | { ok: false; error: string } {
  const me = email.trim().toLowerCase();
  if (task.canceledAt) return { ok: false, error: "철회된 업무입니다." };
  if (!task.recipientEmails.includes(me)) return { ok: false, error: "이 업무의 대상이 아닙니다." };
  const cur: TaskRecipientState = task.statuses?.[me]?.state || "PENDING";

  switch (action) {
    case "accept":
      if (cur !== "PENDING" && cur !== "DECLINED")
        return { ok: false, error: "이미 수락한 업무입니다." };
      return { ok: true, next: { state: "ACCEPTED", at: now } };
    case "decline": {
      if (cur === "DONE") return { ok: false, error: "완료한 업무는 거절할 수 없습니다." };
      const reason = (note || "").trim();
      if (!reason) return { ok: false, error: "거절 사유를 입력해 주세요." }; // §3 — 사유 필수
      return { ok: true, next: { state: "DECLINED", at: now, note: reason.slice(0, 500) } };
    }
    case "done":
      if (task.kind === "submit")
        return { ok: false, error: "제출형 업무는 파일을 제출하면 완료됩니다." };
      if (cur === "DECLINED") return { ok: false, error: "거절한 업무입니다. 먼저 수락해 주세요." };
      return { ok: true, next: { state: "DONE", at: now } };
    case "undone":
      if (cur !== "DONE") return { ok: false, error: "완료 상태가 아닙니다." };
      return { ok: true, next: { state: "ACCEPTED", at: now } };
    default:
      return { ok: false, error: "지원하지 않는 동작입니다." };
  }
}

/** 제출 성공 = DONE (제출형 전용 — 라우트가 제출 기록과 원자 처리) */
export function submissionDoneStatus(now: number): TaskRecipientStatus {
  return { state: "DONE", at: now };
}

// ── 재촉 간격 (§6) ───────────────────────────────────────────

export function canNudge(lastNudgeAt: number | undefined, now: number): boolean {
  return !lastNudgeAt || now - lastNudgeAt >= TASK_NUDGE_INTERVAL_MS;
}

export function nudgeTargets(task: Pick<TaskDoc, "recipientEmails" | "statuses">): string[] {
  return task.recipientEmails.filter((r) => {
    const st = task.statuses?.[r]?.state || "PENDING";
    return st !== "DONE" && st !== "DECLINED";
  });
}

// ── 기한 임박 판정 (§6 — D-1, KST) ──────────────────────────

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** KST 기준 날짜 문자열 */
export function kstDateStr(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 기한이 KST 기준 내일인가 — daily-sync(새벽 실행)에서 D-1 아침 리마인드 판정 */
export function isDueTomorrowKST(dueAt: number, now: number): boolean {
  const tomorrow = kstDateStr(now + 24 * 3600 * 1000);
  return kstDateStr(dueAt) === tomorrow;
}

// ── 제출 파일명 정규화 (§5-3) — 킬러 기능의 심장 ────────────

/** 파일명 금지 문자 정리 (attachment sanitize 계열 — 경로·제어문자) */
function cleanSegment(s: string): string {
  return s.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
}

/**
 * `{소속}_{이름}_{업무명}.{원본 확장자}` — 소속 = 담임이면 "N학년M반", 아니면 첫 부서, 없으면 생략.
 * 예: "2학년3반_홍길동_현장체험 동의서.hwp"
 */
export function normalizeSubmissionFileName(params: {
  taskTitle: string;
  submitterName: string;
  homeroom?: { grade: number; class: number } | null;
  departments?: string[] | null;
  originalName: string;
}): string {
  const ext = (() => {
    const m = /\.([A-Za-z0-9]{1,10})$/.exec(params.originalName || "");
    return m ? `.${m[1].toLowerCase()}` : "";
  })();
  const affiliation = params.homeroom
    ? `${params.homeroom.grade}학년${params.homeroom.class}반`
    : params.departments && params.departments.length > 0
      ? cleanSegment(params.departments[0])
      : "";
  const name = cleanSegment(params.submitterName) || "이름없음";
  const title = cleanSegment(params.taskTitle).slice(0, 60) || "업무";
  const base = [affiliation, name, title].filter(Boolean).join("_");
  return `${base}${ext}`.slice(0, 150);
}

// ── 양식·제출 파일 화이트리스트 (§5-2) ───────────────────────

/** 업무 양식·제출물 허용 확장자 — 실행 파일류 차단. 이미지의 바이트 서명 검증은 첨부 로직 재사용 */
export const TASK_FILE_EXT_WHITELIST = [
  "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "zip",
  "png", "jpg", "jpeg", "webp", "gif", "txt", "csv",
];

export function validateTaskFileName(name: unknown): { ok: true; ext: string } | { ok: false; error: string } {
  const n = typeof name === "string" ? name.trim() : "";
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(n);
  const ext = m ? m[1].toLowerCase() : "";
  if (!n || !ext || !TASK_FILE_EXT_WHITELIST.includes(ext)) {
    return { ok: false, error: "허용되지 않는 파일 형식입니다. (한글·오피스·PDF·압축·이미지 파일만)" };
  }
  return { ok: true, ext };
}

export function validateTaskFileSize(size: number, viaSession: boolean): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "빈 파일은 올릴 수 없습니다." };
  const limit = viaSession ? TASK_FILE_MAX_BYTES : TASK_SERVER_UPLOAD_MAX_BYTES;
  if (size > limit) {
    return {
      ok: false,
      error: viaSession
        ? "파일은 10MB 이하여야 합니다."
        : "4MB가 넘는 파일은 대용량 업로드 경로로 올려 주세요.",
    };
  }
  return { ok: true };
}
