// 명단 색인 — 클라이언트·서버가 함께 쓰는 순수 상수와 판정 (docs/roster_index_spec.md)
//
// ⚠️ 이 파일에 firebase-admin을 import하지 마라. 읽는 쪽(브라우저)이 그대로 물고 들어가
//    클라이언트 번들이 깨진다. 서버 전용 로직은 roster_index.ts에 둔다.
//
// 낡음 판정을 한 곳에 두는 이유: 읽는 쪽(브라우저)·검증 스크립트가 **같은 기준**을 써야
// "화면은 색인을 쓰는데 검증은 안 쓴다" 같은 어긋남이 생기지 않는다.

/** 색인 문서 구조가 바뀌면 올린다 — 읽는 쪽이 불일치를 낡음으로 판정해 폴백한다 */
export const ROSTER_INDEX_SCHEMA_VERSION = 1;

export const ROSTER_INDEX_COLLECTION = "org_index";

/** 색인을 신뢰하지 않는 나이 — 하루 1회 보정이 이틀 연속 실패했다는 뜻 (스펙 §3) */
export const ROSTER_INDEX_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** 연타·동시 편집 흡수 — 이 시간 안의 재요청은 재조립하지 않는다 (스펙 §2-4) */
export const ROSTER_INDEX_DEBOUNCE_MS = 10 * 1000;

/**
 * 쓰기를 거부하는 크기. 1 MiB 문서 한도의 여유분을 남긴다.
 * 넘으면 조용히 자르지 않고 실패시킨다 — 잘린 명단은 "그 사람이 퇴직한 것"처럼 보인다.
 */
export const ROSTER_INDEX_MAX_BYTES = 700 * 1024;

export interface RosterIndexDoc {
  schemaVersion: number;
  domain: string;
  builtAt: number;
  builtBy: string;
  count: number;
  profiles: Record<string, unknown>[];
}

/**
 * 색인을 믿어도 되는가 — 읽는 쪽·검증 스크립트 공통 판정 (스펙 §3 표)
 *
 * 없음 / 구조 불일치 / 개수 불일치(쓰다 만 문서) / 48시간 초과 → false(원본 폴백).
 */
export function isRosterIndexUsable(
  doc: Partial<RosterIndexDoc> | null | undefined,
  now: number = Date.now()
): boolean {
  if (!doc) return false;
  if (doc.schemaVersion !== ROSTER_INDEX_SCHEMA_VERSION) return false;
  if (!Array.isArray(doc.profiles)) return false;
  if (typeof doc.count !== "number" || doc.count !== doc.profiles.length) return false;
  if (typeof doc.builtAt !== "number" || !doc.builtAt) return false;
  if (now - doc.builtAt > ROSTER_INDEX_MAX_AGE_MS) return false;
  return true;
}
