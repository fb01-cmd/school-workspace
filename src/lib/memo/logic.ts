// 쪽지(사내 메신저) 1단계 — 순수 검증·수신자 확정 로직 (docs/memo_spec.md §1·§2)
// 이 파일은 네트워크·Firestore 무의존이다 — selftest(scripts/memo_selftest.ts)가 직접 임포트한다.

export const MEMO_MAX_TITLE = 200;
export const MEMO_MAX_BODY = 10000;
export const MEMO_MAX_LINKS = 5;
export const MEMO_MAX_RECIPIENTS = 300;
export const MEMO_MAX_SUMMARY = 100;
export const MEMO_DEFAULT_RETENTION_DAYS = 365;
export const MEMO_GROUP_MAX_DEPTH = 3;

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
};

export function validateMemoContent(input: {
  title?: unknown;
  body?: unknown;
  links?: unknown;
  recipientSummary?: unknown;
}): { ok: true; content: MemoContent } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "제목을 입력해 주세요." };
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

  return { ok: true, content: { title, body, links, recipientSummary } };
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

function isStudentOuPath(path: string | null | undefined): boolean {
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
