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
