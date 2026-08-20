// 쪽지(사내 메신저) 1단계 — 순수 검증·수신자 확정 로직 (docs/memo_spec.md §1·§2)
// 이 파일은 네트워크·Firestore 무의존이다 — selftest(scripts/memo_selftest.ts)가 직접 임포트한다.

export const MEMO_MAX_TITLE = 200;
/** 빈 제목 표기 폴백 (피드백 31번 — 제목 선택화) — 서버 발신 표면·화면 공용 단일 원본 */
export const MEMO_UNTITLED_FALLBACK = "(제목 없음)";
export const MEMO_MAX_BODY = 10000;
export const MEMO_MAX_LINKS = 5;
export const MEMO_MAX_RECIPIENTS = 300;
export const MEMO_MAX_SUMMARY = 100;
export const MEMO_DEFAULT_RETENTION_DAYS = 365;
export const MEMO_GROUP_MAX_DEPTH = 3;

import type { AttachmentShareMode, MemoAttachment } from "./attachment_logic";
import { MEMO_CONTENT_FORMAT_MD1 } from "./richtext";

export interface MemoLink {
  url: string;
  label?: string;
}

export interface MemoDoc {
  senderEmail: string;
  senderName: string;
  title: string;
  body: string;
  links: MemoLink[];
  recipientEmails: string[];
  recipientCount: number;
  recipientSummary: string;
  // 수신자 이메일 → 최초 열람 시각(ms). 키에 점(.)이 있으므로 갱신은 FieldPath 필수.
  reads: Record<string, number>;
  createdAt: number;
  expireAt: number;
  /** 마지막 회수 시각(ms) — 회수한 적 없으면 없음 (§12-2) */
  recalledAt?: number;
  /** 지금까지 회수된 인원 누계 — 보낸 이력이 왜곡되지 않게 남긴다 (§12-2) */
  recalledCount?: number;
  /** 본인 화면에서 감춘 사람 → 감춘 시각(ms) (§12-1 — 원본은 보존 기간까지 남는다). 키에 점(.) — FieldPath 필수 */
  hiddenBy?: Record<string, number>;
  /** 별표한 사람 → true (star/search spec §1-1 — 값이 시각이 아닌 이유: 즐겨찾기함이 등호 쿼리라서) */
  starredBy?: Record<string, true>;
  /** 스레드 뿌리 쪽지의 memoId — 답장에만 존재, 뿌리 자신에게는 없음 (reply spec §2) */
  threadId?: string;
  /** 직접 부모 쪽지의 memoId (reply spec §2) */
  replyTo?: string;
  /** 첨부 참조 (2단계 attachment spec §3-1) — 파일 실체는 hmnotice@ Drive, ≤5개 */
  attachments?: MemoAttachment[];
  /** 첨부 열람 권한 방식 — 전 교직원 공지만 domain (attachment spec §3-3) */
  attachmentShareMode?: AttachmentShareMode;
  /** 본문 서식 — "md1"일 때만 서식 렌더. 부재 = 평문, 절대 재해석 금지 (richtext spec §2) */
  contentFormat?: typeof MEMO_CONTENT_FORMAT_MD1;
  /** 권한 부여 실패분 잔존 — 다음 발송·크론이 재시도 (attachment spec §3-3) */
  permissionPending?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(v: unknown): v is string {
  return typeof v === "string" && v.length <= 320 && EMAIL_RE.test(v.trim());
}

// ── 본문 검증 ────────────────────────────────────────────────

export type MemoContent = {
  title: string;
  body: string;
  links: MemoLink[];
  recipientSummary: string;
  /** 본문 서식 — "md1"일 때만 존재. 부재 = 평문 (richtext spec §2) */
  contentFormat?: typeof MEMO_CONTENT_FORMAT_MD1;
};

export function validateMemoContent(input: {
  title?: unknown;
  body?: unknown;
  links?: unknown;
  recipientSummary?: unknown;
  contentFormat?: unknown;
}): { ok: true; content: MemoContent } | { ok: false; error: string } {
  // 제목 선택화 (2026-08-19 피드백 31번 — 메신저 문법): 빈 제목 허용, 문서엔 "" 저장.
  // 표기 폴백은 MEMO_UNTITLED_FALLBACK 단일 상수 — 서버 발신 표면(푸시·원장)과 화면이 공유.
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length > MEMO_MAX_TITLE)
    return { ok: false, error: `제목은 ${MEMO_MAX_TITLE}자 이내여야 합니다.` };

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { ok: false, error: "내용을 입력해 주세요." };
  if (body.length > MEMO_MAX_BODY)
    return { ok: false, error: `내용은 ${MEMO_MAX_BODY.toLocaleString()}자 이내여야 합니다.` };

  const rawLinks = input.links === undefined ? [] : input.links;
  if (!Array.isArray(rawLinks) || rawLinks.length > MEMO_MAX_LINKS)
    return { ok: false, error: `링크는 ${MEMO_MAX_LINKS}개까지 넣을 수 있습니다.` };
  const links: MemoLink[] = [];
  for (const l of rawLinks) {
    const url = typeof l?.url === "string" ? l.url.trim() : "";
    if (!url.startsWith("https://") || url.length > 2048)
      return { ok: false, error: "링크 주소가 유효하지 않습니다." };
    const label =
      typeof l?.label === "string" && l.label.trim()
        ? l.label.trim().slice(0, 100)
        : undefined;
    links.push(label ? { url, label } : { url });
  }

  const recipientSummary =
    typeof input.recipientSummary === "string"
      ? input.recipientSummary.trim().slice(0, MEMO_MAX_SUMMARY)
      : "";

  // 본문 형식 화이트리스트 — 부재(평문) 또는 "md1"만 (richtext spec §2)
  if (input.contentFormat !== undefined && input.contentFormat !== MEMO_CONTENT_FORMAT_MD1)
    return { ok: false, error: "지원하지 않는 본문 형식입니다." };

  return {
    ok: true,
    content: {
      title,
      body,
      links,
      recipientSummary,
      ...(input.contentFormat === MEMO_CONTENT_FORMAT_MD1
        ? { contentFormat: MEMO_CONTENT_FORMAT_MD1 }
        : {}),
    },
  };
}

// ── 그룹 확장 (서버가 직접 — 클라이언트가 펼친 목록을 믿지 않는다) ──

export type GroupMemberLister = (
  groupEmail: string
) => Promise<Array<{ email?: string | null; type?: string | null }>>;

/**
 * 그룹을 재귀 확장해 개인 이메일 후보를 모은다.
 * - 방문 집합으로 순환 그룹 방지, 깊이 MEMO_GROUP_MAX_DEPTH 초과분은 확장하지 않고 보고.
 * - 존재하지 않는 그룹 등 조회 실패는 throw — 호출부가 400으로 변환한다(경고만 남기고 계속 금지).
 */
export async function expandGroupEmails(
  groups: string[],
  listMembers: GroupMemberLister,
  maxDepth: number = MEMO_GROUP_MAX_DEPTH
): Promise<{ users: string[]; skippedDepth: string[] }> {
  const users: string[] = [];
  const skippedDepth: string[] = [];
  const visited = new Set<string>();
  let frontier = groups.map((g) => g.trim().toLowerCase()).filter(Boolean);

  for (let depth = 1; frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const groupEmail of frontier) {
      if (visited.has(groupEmail)) continue;
      visited.add(groupEmail);
      const members = await listMembers(groupEmail);
      for (const m of members) {
        const email = typeof m.email === "string" ? m.email.trim().toLowerCase() : "";
        if (!email) continue;
        if (m.type === "GROUP") {
          if (depth >= maxDepth) {
            if (!visited.has(email)) skippedDepth.push(email);
          } else {
            next.push(email);
          }
        } else {
          // USER 외 타입(CUSTOMER 등)은 개인 후보로 취급하지 않는다
          if (m.type === "USER" || m.type === undefined || m.type === null) users.push(email);
        }
      }
    }
    frontier = next;
  }
  return { users, skippedDepth };
}

// ── 수신자 확정 (실존 대조 + 학생 제외) ──────────────────────

export interface DirectoryUser {
  primaryEmail?: string | null;
  orgUnitPath?: string | null;
}

export interface ResolvedRecipients {
  accepted: string[];
  notFound: string[];
  students: string[];
  outOfDomain: string[];
  invalidFormat: string[];
}

export function isStudentOuPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return path === "/학생" || path.startsWith("/학생/");
}

/**
 * 후보 이메일을 GWS 디렉터리 전수 목록과 대조해 최종 수신자를 확정한다.
 * - 학생 제외는 학번 휴리스틱이 아니라 orgUnitPath(/학생 하위) 실데이터 기준 (스펙 §2-3).
 * - 소문자 정규화·중복 제거. 발신자 본인 포함은 허용.
 */
export function resolveRecipients(
  candidates: string[],
  directory: DirectoryUser[],
  domain: string
): ResolvedRecipients {
  const byEmail = new Map<string, string>(); // email → orgUnitPath
  for (const u of directory) {
    const email = typeof u.primaryEmail === "string" ? u.primaryEmail.trim().toLowerCase() : "";
    if (email) byEmail.set(email, u.orgUnitPath || "");
  }

  const out: ResolvedRecipients = {
    accepted: [],
    notFound: [],
    students: [],
    outOfDomain: [],
    invalidFormat: [],
  };
  const seen = new Set<string>();
  const domainSuffix = "@" + domain.toLowerCase();

  for (const raw of candidates) {
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!email || seen.has(email)) continue;
    seen.add(email);
    if (!isValidEmailFormat(email)) {
      out.invalidFormat.push(email || String(raw));
      continue;
    }
    if (!email.endsWith(domainSuffix)) {
      out.outOfDomain.push(email);
      continue;
    }
    if (!byEmail.has(email)) {
      out.notFound.push(email);
      continue;
    }
    if (isStudentOuPath(byEmail.get(email))) {
      out.students.push(email);
      continue;
    }
    out.accepted.push(email);
  }
  return out;
}

/** settings 값에서 보존 일수 확정 (1~3650 밖·비숫자는 기본값) */
export function resolveRetentionDays(raw: unknown): number {
  const n = typeof raw === "number" ? Math.floor(raw) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 3650) return MEMO_DEFAULT_RETENTION_DAYS;
  return n;
}

/** 보존 개월 수 — 달 단위 파기의 기준 (2026-08-20 사용자 확정). 기본 12개월 */
export const MEMO_RETENTION_MONTHS = 12;

/**
 * 설정값 해석 — `memoRetentionMonths`(신규)를 먼저 보고, 없으면 옛 `memoRetentionDays`를
 * 개월로 환산한다(설정 UI는 아직 없어 실사용 값은 없으나 하위호환을 남긴다).
 * 환산은 **내림** — 짧아지는 방향만 택한다는 A안 원칙과 같다.
 */
export function resolveRetentionMonths(rawMonths: unknown, rawDays?: unknown): number {
  const m = typeof rawMonths === "number" ? Math.floor(rawMonths) : NaN;
  if (Number.isFinite(m) && m >= 1 && m <= 120) return m;
  const d = typeof rawDays === "number" ? Math.floor(rawDays) : NaN;
  if (Number.isFinite(d) && d >= 28 && d <= 3650) return Math.max(1, Math.floor(d / 30.44));
  return MEMO_RETENTION_MONTHS;
}

/**
 * 파기 시각 = **보낸 달로부터 N개월이 지난 달 1일 00:00 KST** (2026-08-20 A안 확정).
 *
 * 왜 「보낸 날 + 365일」이 아닌가 — 파기를 **달 단위로 끊기 위해서**다.
 * 같은 달에 보낸 쪽지가 전부 같은 날 만료되면 ⓐ 첨부 폴더가 이미 `쪽지/YYYY/MM`로
 * 달별이라 **폴더를 통째로 지울 수 있고** ⓑ 월별 개인 사본(레버 ②')이 도입되면
 * **그 사람의 그 달 문서 하나만 지우면 끝난다.** 한 건씩 골라 지우는 비용이 사라진다.
 *
 * **말일이 아니라 1일인 이유**: 실제 보존이 **335~365일**이 되어 **기존 고지("보낸 날부터
 * 365일")를 절대 넘지 않는다.** 말일로 잡으면 최대 395일이 되어 보관 기간이 늘어나고,
 * 그것은 문구 수정이 아니라 다시 알려야 하는 변경이 된다. **짧아지는 방향만 택한다.**
 *
 * 예) 2026-08-01 발송 → 2027-08-01 파기(365일) · 2026-08-31 발송 → 2027-08-01 파기(335일)
 */
export function memoExpireAtKST(sentAtMs: number, retentionMonths = MEMO_RETENTION_MONTHS): number {
  const KST = 9 * 3600 * 1000;
  const k = new Date(sentAtMs + KST); // KST 벽시계로 환산
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth(); // 0-based
  // 보낸 달 + N개월의 1일 00:00 KST → UTC ms
  return Date.UTC(y, m + retentionMonths, 1, 0, 0, 0, 0) - KST;
}

// ── 삭제(내 화면에서만 감추기) (§12-1) ──────────────────────────────────────

/**
 * 감추기 자격 판정 — 발신자·수신자 본인만, 수신자는 **읽은 뒤에만**.
 * 안 읽고 감추면 발신자 화면에 영원히 "안 읽음"으로 남아 수신확인이 거짓이 된다(§12-1 해소 규칙).
 * 발신자는 제약 없음(보낸쪽지함에서 감춤 — 수신자 쪽 영향 없음). 이미 감춘 경우는 멱등.
 */
export function resolveHideEligibility(
  memo: Pick<MemoDoc, "senderEmail" | "recipientEmails" | "reads">,
  email: string
): { ok: true } | { ok: false; error: string; status: 400 | 403 } {
  const me = email.trim().toLowerCase();
  const isSender = (memo.senderEmail || "").toLowerCase() === me;
  const isRecipient = Array.isArray(memo.recipientEmails) && memo.recipientEmails.includes(me);
  if (!isSender && !isRecipient) {
    return { ok: false, error: "이 쪽지의 당사자가 아닙니다.", status: 403 };
  }
  if (!isSender && isRecipient && !memo.reads?.[me]) {
    return { ok: false, error: "읽은 뒤에 정리할 수 있습니다.", status: 400 };
  }
  return { ok: true };
}

// ── 즐겨찾기 (star/search spec §1-2) ────────────────────────────────────────

/**
 * 별표 자격 — 당사자(발신자 또는 수신자)면 됨. **읽음 여부 무관** — 별표는 본인 화면의
 * 표식일 뿐 수신확인 의미론을 건드리지 않는다(hide의 읽음 조건과 다른 점).
 */
export function resolveStarEligibility(
  memo: Pick<MemoDoc, "senderEmail" | "recipientEmails">,
  email: string
): { ok: true } | { ok: false; error: string; status: 403 } {
  const me = email.trim().toLowerCase();
  const isSender = (memo.senderEmail || "").toLowerCase() === me;
  const isRecipient = Array.isArray(memo.recipientEmails) && memo.recipientEmails.includes(me);
  if (!isSender && !isRecipient) {
    return { ok: false, error: "이 쪽지의 당사자가 아닙니다.", status: 403 };
  }
  return { ok: true };
}

// ── 답장 (reply spec §6) ─────────────────────────────────────────────────────

export interface ReplyContext {
  /** 스레드 뿌리 — 부모가 답장이면 계승, 뿌리면 부모 자신 */
  threadId: string;
  /** 직접 부모 */
  replyTo: string;
  /** 답장 수신자 = 원 쪽지 발신자 1인 (서버 강제 — 클라이언트 수신자 입력은 무시된다) */
  recipientEmail: string;
}

/**
 * 답장 자격·스레드 계승 판정 (reply spec §1·§6).
 * - 자격 = 부모 쪽지의 수신자 본인뿐. 발신자 본인·비당사자는 403(회수된 수신자도
 *   recipientEmails에서 빠져 있으므로 자연 거부 — 회수의 의미와 정합).
 * - 자기에게 보낸 쪽지는 본인이 수신자이기도 하므로 답장(자신에게) 허용 — 무해.
 */
export function resolveReplyContext(
  parent: Pick<MemoDoc, "senderEmail" | "recipientEmails" | "threadId"> & { id: string },
  senderEmail: string
): { ok: true; ctx: ReplyContext } | { ok: false; error: string; status: 403 } {
  const me = senderEmail.trim().toLowerCase();
  if (!Array.isArray(parent.recipientEmails) || !parent.recipientEmails.includes(me)) {
    return { ok: false, error: "받은 쪽지에만 답장할 수 있습니다.", status: 403 };
  }
  return {
    ok: true,
    ctx: {
      threadId: parent.threadId || parent.id,
      replyTo: parent.id,
      recipientEmail: (parent.senderEmail || "").trim().toLowerCase(),
    },
  };
}

// ── 회수 (§12-2) ──────────────────────────────────────────────────────────────

export interface RecallResult {
  /** 회수 후에도 남는 수신자 = **이미 읽은 사람** */
  keep: string[];
  /** 회수되는 수신자 = 아직 읽지 않은 사람 */
  recalled: string[];
}

/**
 * 회수 대상 계산 — "이미 읽은 사람 것은 두고 안 읽은 사람 것만" (§12-2).
 *
 * `recipientEmails`에서 미열람자만 빼면 그들은 firestore.rules상 그 문서를 읽을 수 없게 되어
 * 목록에서 사라지고, 열람자는 그대로 남는다. **`reads`는 건드리지 않는다** — 수신확인 이력이
 * 보존되어야 하고, 남는 사람이 곧 읽은 사람이므로 reads와 recipientEmails가 저절로 정합된다.
 *
 * 순수 함수다. 실제 적용은 트랜잭션 안에서 해야 한다 — 계산과 쓰기 사이에 누가 읽으면
 * "읽었는데 목록에서 사라진 사람"이 생겨 이력이 왜곡된다.
 */
export function computeRecall(
  memo: Pick<MemoDoc, "recipientEmails" | "reads">
): RecallResult {
  const reads = memo.reads || {};
  const keep: string[] = [];
  const recalled: string[] = [];
  for (const e of memo.recipientEmails || []) {
    if (reads[e]) keep.push(e);
    else recalled.push(e);
  }
  return { keep, recalled };
}

