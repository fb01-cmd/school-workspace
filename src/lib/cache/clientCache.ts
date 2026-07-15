// ─────────────────────────────────────────────────────────────
// Client-Side In-Memory Cache Module
// SPA 수명 주기 동안 유지되며, 불필요한 네트워크 API 호출 및 스피너를 제거합니다.
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  data: any;
  timestamp: number;
  ttlMs: number;
}

const cacheStore = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5분 기본값

/**
 * 캐시에서 데이터를 조회합니다.
 * 만료되었거나 없을 경우 null을 리턴합니다.
 */
export const getClientCache = (key: string): any | null => {
  const entry = cacheStore.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > entry.ttlMs) {
    cacheStore.delete(key);
    return null;
  }

  return entry.data;
};

/**
 * 캐시에 데이터를 저장합니다.
 * @param ttlMs 만료 시간(ms). 기본값 5분.
 */
export const setClientCache = (key: string, data: any, ttlMs = DEFAULT_TTL_MS): void => {
  cacheStore.set(key, {
    data,
    timestamp: Date.now(),
    ttlMs,
  });
};

/**
 * 특정 키 또는 접두사를 가진 캐시를 무효화(삭제)합니다.
 */
export const invalidateClientCache = (keyOrPrefix?: string): void => {
  if (!keyOrPrefix) {
    cacheStore.clear();
    return;
  }

  for (const key of cacheStore.keys()) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
      cacheStore.delete(key);
    }
  }
};

