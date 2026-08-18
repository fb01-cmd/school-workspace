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
const NORMAL_TTL_MS = 5 * 60 * 1000; // 평시 5분

/**
 * 현재 기본 수명. 절약 모드(docs/saving_mode_spec.md)가 켜지면 AuthContext가 이 값을
 * 늘린다 — 화면이 같은 자료를 다시 받아오는 횟수를 줄이는 손잡이다.
 * **이미 저장된 항목은 저장 당시의 수명을 그대로 쓴다**(소급 적용하지 않는다):
 * 소급하면 절약 모드를 끄는 순간 멀쩡하던 캐시가 한꺼번에 만료돼 되레 읽기가 튄다.
 */
let currentDefaultTtlMs = NORMAL_TTL_MS;

/** 절약 모드 전환 시 호출 (AuthContext). 인자가 없거나 비정상이면 평시로 복귀. */
export const setClientCacheDefaultTtl = (ttlMs?: number): void => {
  currentDefaultTtlMs = typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : NORMAL_TTL_MS;
};

export const getClientCacheDefaultTtl = (): number => currentDefaultTtlMs;

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
 * @param ttlMs 만료 시간(ms). 생략하면 현재 기본값(평시 5분, 절약 모드 시 연장).
 */
export const setClientCache = (key: string, data: any, ttlMs = currentDefaultTtlMs): void => {
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

