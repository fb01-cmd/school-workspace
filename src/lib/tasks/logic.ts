// Phase 8 3단계 업무 지시 — 순수 검증·상태 머신 로직 (docs/phase8_tasks_spec.md §2·§3·§5·§6)
// 이 파일은 네트워크·Firestore 무의존이다 — selftest(scripts/tasks_selftest.ts)가 직접 임포트한다.

export const TASK_MAX_TITLE = 200;
export const TASK_MAX_BODY = 10000;
export const TASK_MAX_RECIPIENTS = 300;
export const TASK_MAX_FORM_FILES = 5;
export const TASK_DEFAULT_RETENTION_DAYS = 365;
/** 서버 경유 업로드 상한 (Vercel 본문 4.5MB 내 여유) — 초과는 Drive 세션 경로 (§5-4) */
export const TASK_SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** 파일 절대 상한 (세션 경로 포함) — 2026-08-19 사용자 확정 10→30MB (쪽지 첨부 상한도 이 값을 승계) */
export const TASK_FILE_MAX_BYTES = 30 * 1024 * 1024;
/** 재촉 최소 간격 (§6 — 업무당 24시간 1회) */
export const TASK_NUDGE_INTERVAL_MS = 24 * 3600 * 1000;
/**
 * 「기한 없음」 센티널 (task_no_due_spec §1-2) — 2100-01-01.
 *
 * `dueAt: null`을 쓰지 않는 이유: 「내 할 일」·모바일·홈 카드 세 목록이 전부 `dueAt`을
 * 범위 조건으로 걸어 조회하므로(`where("dueAt", ">=", windowStart)`), 값이 없으면 세 곳
 * 모두에서 문서가 통째로 빠진다. 먼 미래 값을 넣으면 ⓐ 같은 쿼리가 그대로 집어 오고
 * ⓑ `orderBy asc`에서 저절로 맨 뒤에 오며(= 스펙 A안 배치) ⓒ D-1 리마인드 스윕
 * (`cron.ts` — now~+48h 창)과 「지난 업무」(`dueAt < windowStart`)에 영원히 안 걸린다.
 * 새 색인·추가 읽기·스윕 변경이 전부 0건이 된다.
 *
 * **대가**: 화면이 `noDue`를 안 보고 `dueAt`으로 계산하면 「2100.01.01까지」가 샌다.
 * 표시 경로는 반드시 `noDue`를 먼저 본다(스펙 §1-3 — 고쳐야 할 4곳이 명시돼 있다).
 * 값을 2100년으로 잡은 것도 의도다 — 새어 나가도 죽지 않고 **눈에 띄게 이상해 보인다.**
 */
export const TASK_NO_DUE_AT = Date.UTC(2100, 0, 1);

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
  /** 기한 없는 항목은 `TASK_NO_DUE_AT` 센티널이 들어간다 — 화면은 `dueAt` 대신 `noDue`를 먼저 본다 */
  dueAt: number;
  /**
   * 기한 없는 셀프 할 일 (task_no_due_spec §1-2). **이것이 계약이고 `dueAt` 센티널은 구현 세부다.**
   * 셀프 등록에만 허용된다 — 남에게 보내는 업무는 서버가 거부한다(같은 스펙 §2-3).
   */
  noDue?: boolean;
  recipientEmails: string[];
  recipientCount: number;
  recipientSummary: string;
  /** 요약의 재료 — 문장은 화면에서 만든다 (org/recipients.ts). 옛 문서엔 없다 */
  recipientMeta?: { depts: string[]; extra: number; firstLabel?: string };
  statuses: Record<string, TaskRecipientStatus>;
  /** 셀프 등록 업무 (피드백 15번) — 현황판 접기·"내가 등록" 표시용 */
  selfAssigned?: boolean;
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
  /** 기한 없는 셀프 할 일 — true면 dueAt 검증을 건너뛰고 센티널을 쓴다 (task_no_due_spec §2-1) */
  noDue?: unknown;
  contentFormat?: unknown;
  recipientSummary?: unknown;
  now: number;
}):
  | { ok: true; content: { title: string; body: string; kind: TaskKind; dueAt: number; noDue?: true; contentFormat?: "md1"; recipientSummary: string } }
  | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "업무명을 입력해 주세요." };
  if (title.length > TASK_MAX_TITLE) return { ok: false, error: `업무명은 ${TASK_MAX_TITLE}자 이내여야 합니다.` };

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length > TASK_MAX_BODY)
    return { ok: false, error: `내용은 ${TASK_MAX_BODY.toLocaleString()}자 이내여야 합니다.` };

  if (input.kind !== "confirm" && input.kind !== "submit")
    return { ok: false, error: "업무 유형이 유효하지 않습니다." };

  // 기한 없음: dueAt 검증을 건너뛰고 센티널을 박는다. 호출부가 이 값을 그대로 문서에 쓴다.
  const noDue = input.noDue === true;
  const dueAt = noDue ? TASK_NO_DUE_AT : typeof input.dueAt === "number" ? input.dueAt : NaN;
  if (!noDue) {
    if (!Number.isFinite(dueAt)) return { ok: false, error: "기한을 지정해 주세요." };
    if (dueAt <= input.now) return { ok: false, error: "기한은 지금보다 뒤여야 합니다." };
  }

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
      ...(noDue ? { noDue: true as const } : {}),
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
    case "done": {
      if (task.kind === "submit")
        return { ok: false, error: "제출형 업무는 파일을 제출하면 완료됩니다." };
      if (cur === "DECLINED") return { ok: false, error: "거절한 업무입니다. 먼저 수락해 주세요." };
      // 완료 코멘트 (피드백 27번) — 거절 사유와 같은 자리(note), 선택 사항
      const comment = (note || "").trim();
      return { ok: true, next: { state: "DONE", at: now, ...(comment ? { note: comment.slice(0, 500) } : {}) } };
    }
    case "undone":
      if (cur !== "DONE") return { ok: false, error: "완료 상태가 아닙니다." };
      return { ok: true, next: { state: "ACCEPTED", at: now } };
    default:
      return { ok: false, error: "지원하지 않는 동작입니다." };
  }
}

/** 제출 성공 = DONE (제출형 전용 — 라우트가 제출 기록과 원자 처리). note = 제출 코멘트 (피드백 27번, 선택) */
export function submissionDoneStatus(now: number, note?: unknown): TaskRecipientStatus {
  const comment = typeof note === "string" ? note.trim() : "";
  return { state: "DONE", at: now, ...(comment ? { note: comment.slice(0, 500) } : {}) };
}

// ── 고아 초안 판정 (피드백 4-ⓑ — 2상 발송의 1상만 하고 중단된 문서) ──

/** prepare 후 send가 안 된 초안이 이 시간을 넘기면 스윕이 정리한다 */
export const TASK_DRAFT_ORPHAN_MS = 24 * 3600 * 1000;

/** 수신자 0명(미발송)인 채 24시간이 지난 초안인가 — 작성 중인 문서를 지우지 않는 관문 */
export function isOrphanDraft(
  task: Pick<TaskDoc, "recipientCount" | "createdAt">,
  now: number
): boolean {
  return task.recipientCount === 0 && now - task.createdAt >= TASK_DRAFT_ORPHAN_MS;
}

// ── 셀프 등록 (피드백 15번 — [내 할 일 추가] 미니 입력의 서버 형상) ──

/**
 * 셀프 업무 문서 — 수신자 자동 본인·생성 즉시 수락·확인형 강제 (사용자 확정: 자기에게
 * 제출하는 제출형은 개념 불일치라 유형 선택 자체가 없다. 서버가 confirm을 강제한다).
 * Drive 폴더는 만들지 않는다 — 확인형 셀프 업무에 양식·제출함이 없고, 파기 스윕의
 * 폴더 삭제는 폴더 부재를 정상 통과한다.
 */
export function buildSelfTaskDoc(params: {
  email: string;
  name: string;
  title: string;
  body: string;
  contentFormat?: "md1";
  dueAt: number;
  /** 기한 없는 셀프 할 일 — dueAt 은 이미 센티널이어야 한다 (validateTaskContent 가 넣어 준다) */
  noDue?: boolean;
  now: number;
  retentionDays: number;
}): TaskDoc {
  const email = params.email.trim().toLowerCase();
  return {
    senderEmail: email,
    senderName: params.name,
    title: params.title,
    body: params.body,
    ...(params.contentFormat === "md1" ? { contentFormat: "md1" as const } : {}),
    kind: "confirm", // 확인형 강제 — 클라이언트 입력과 무관
    dueAt: params.dueAt,
    ...(params.noDue ? { noDue: true } : {}),
    recipientEmails: [email],
    recipientCount: 1,
    recipientSummary: "본인",
    statuses: { [email]: { state: "ACCEPTED", at: params.now } }, // 생성 즉시 수락
    selfAssigned: true,
    createdAt: params.now,
    expireAt: params.now + params.retentionDays * 24 * 3600 * 1000,
  };
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
  /** 동명이인 구분자 — 있으면 이름 뒤에 괄호로 붙는다 (2026-08-20). 없으면 종전과 완전히 동일. */
  disambiguator?: string;
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
  const rawName = cleanSegment(params.submitterName) || "이름없음";
  const dis = params.disambiguator ? cleanSegment(params.disambiguator).slice(0, 20) : "";
  const name = dis ? `${rawName}(${dis})` : rawName;
  const title = cleanSegment(params.taskTitle).slice(0, 60) || "업무";
  const base = [affiliation, name, title].filter(Boolean).join("_");
  // 150자로 줄일 때 **확장자는 자르지 않는다** (2026-08-21, Codex 발견).
  // 종전엔 `${base}${ext}`를 통째로 slice 해서 base 가 길면 확장자까지 잘렸다.
  // 확장자 없는 파일은 담당자가 내려받아 열 때 프로그램 연결이 안 된다.
  // base+ext 가 150 이하면 결과는 종전과 완전히 동일하다(회귀 없음).
  return `${base.slice(0, Math.max(0, 150 - ext.length))}${ext}`;
}

// ── 양식·제출 파일 화이트리스트 (§5-2) ───────────────────────

/** 업무 양식·제출물 허용 확장자 — 실행 파일류 차단. 이미지의 바이트 서명 검증은 첨부 로직 재사용.
 * GIF 제외 (2026-08-19 피드백 9번 — 업무엔 불요, 사용자 확정. 쪽지 첨부는 GIF 유지) */
export const TASK_FILE_EXT_WHITELIST = [
  "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "zip",
  "png", "jpg", "jpeg", "webp", "txt", "csv",
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
        ? "파일은 30MB 이하여야 합니다."
        : "4MB가 넘는 파일은 대용량 업로드 경로로 올려 주세요.",
    };
  }
  return { ok: true };
}

/**
 * 고른 파일을 즉시 메모리로 읽어 **전송 안전한 이름**의 새 File 로 바꾼다 (2026-08-20).
 *
 * 두 가지를 동시에 막는다.
 * ① 안드로이드 사진 선택기가 준 파일 통로가 담기~확정 사이에 닫히는 것
 *    — 여기서 미리 읽어 두면 통로가 닫혀도 바이트는 손에 있다.
 * ② 스크린샷 파일명의 한글·띄어쓰기·괄호가 전송에서 문제를 일으키는 것
 *    — 서버는 어차피 확장자만 쓰고 이름은 새로 만든다(normalizeSubmissionFileName).
 *      그러므로 원본 이름을 그대로 보낼 이유가 없다.
 *
 * **원본 이름은 버리지 말고 호출부가 따로 보관해 화면에 표시한다.**
 */
export async function toTransportSafeFile(file: File): Promise<File> {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(file.name || "");
  const ext = m ? m[1].toLowerCase() : "bin";
  const buf = await file.arrayBuffer();
  return new File([buf], `upload.${ext}`, {
    type: file.type || "application/octet-stream",
  });
}
