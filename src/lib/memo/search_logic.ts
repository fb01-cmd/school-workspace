// 쪽지 검색 순수 매칭 (docs/memo_star_search_spec.md §2-3)
// 네트워크·Firestore 무의존 — 화면(전량 조회 후 필터)과 selftest가 같은 함수를 쓴다.

/** 검색 대상 필드 묶음 — 발신자 이름은 문서 스탬프(senderName)와 현재 표시 이름 둘 다 받는다
 *  (GWS에서 이름이 바뀐 경우 어느 쪽으로 찾아도 나오게, §2-3) */
export interface MemoSearchTarget {
  title: string;
  body: string;
  senderName?: string;
  /** 현재 표시 이름(화면이 resolve한 값) — 없으면 senderName만 본다 */
  senderDisplayName?: string;
  /** 보낸쪽지함용 수신자 요약 */
  recipientSummary?: string;
}

/** 검색어 → 키워드 배열: 트림·소문자·공백 분리·중복 제거. 빈 검색어는 [] */
export function parseSearchKeywords(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.trim().toLowerCase().split(/\s+/)) {
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * 다중 키워드 AND 매칭 — 모든 키워드가 대상 필드 중 어딘가에 부분 문자열로 포함돼야 참.
 * 대소문자 무시. 키워드가 없으면(빈 검색어) 항상 참 — 호출부가 "검색 중 아님"으로 다뤄도 안전.
 */
export function memoMatchesSearch(target: MemoSearchTarget, rawQuery: unknown): boolean {
  const keywords = parseSearchKeywords(rawQuery);
  if (keywords.length === 0) return true;
  const haystack = [
    target.title,
    target.body,
    target.senderName || "",
    target.senderDisplayName || "",
    target.recipientSummary || "",
  ]
    .join("\n")
    .toLowerCase();
  return keywords.every((k) => haystack.includes(k));
}

// ── 검색 기간 범위 (docs/memo_star_search_spec.md §2-4a) ─────────

export type MemoSearchRange = "3m" | "6m" | "1y";

export const MEMO_SEARCH_RANGE_LABELS: Record<MemoSearchRange, string> = {
  "3m": "최근 3개월",
  "6m": "최근 6개월",
  "1y": "최근 1년",
};

export const MEMO_SEARCH_RANGE_DAYS: Record<MemoSearchRange, number> = {
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

/** 범위(3m | 6m | 1y)와 기준 시각(nowMs, 기본값 Date.now())으로부터 createdAt >= 경계 시각(ms) 계산 */
export function computeSearchRangeBoundary(
  range: MemoSearchRange,
  nowMs: number = Date.now()
): number {
  const days = MEMO_SEARCH_RANGE_DAYS[range] || 90;
  return nowMs - days * 24 * 60 * 60 * 1000;
}

/**
 * 상위 캐시(더 넓은 범위)로부터 하위(좁은 범위) 쪽지 목록을 파생 필터링하는 순수 헬퍼.
 * items 중 createdAt >= boundaryMs 인 항목만 필터하여 반환.
 */
export function filterMemosByRangeBoundary<T extends { createdAt: number }>(
  items: T[],
  boundaryMs: number
): T[] {
  return items.filter((item) => typeof item.createdAt === "number" && item.createdAt >= boundaryMs);
}

