/**
 * 버전 키 인메모리 메모 코어 (읽기 다이어트 ① — 2026-08-16)
 *
 * viewCache.ts의 memo 본체를 독립 모듈로 추출한 것. server.ts의 후보(advisory) 경로가
 * 같은 코어를 쓰되(로직 두 벌 금지), viewCache ← server 순환 import를 만들지 않기 위해
 * 이 파일은 server.ts를 import하지 않는다 — 로더는 항상 호출부가 넘긴다.
 *
 * 신선도 계약 (viewCache와 동일, weekly_synthesis_cache_spec §3-2):
 * - 키에 반드시 캐시 버전(cacheVersion.ts)이 들어간다. 시간표를 바꾸는 모든 쓰기가
 *   bump하므로 옛 항목은 자연 격리된다 — 쓰기 직전에 시작된 채움이 낡은 값을 저장해도
 *   새 요청의 키에는 닿지 않는다 (경합 창 없음).
 * - TTL은 안전망이다 (bump 유실 시 최대 TTL까지 낡은 캐시 — cacheVersion.ts 주석 참조).
 * - 캐시 값은 공유 객체다 — 소비 측은 변형하지 않는다. 합성기는 입력을 deepCopy하므로
 *   기초판·changes 원재료를 여러 요청이 공유해도 안전하다 (weekly.ts:356 실측).
 */

export interface MemoStore {
  memo<T>(key: string, fn: () => Promise<T>): Promise<T>;
  size(): number;
}

export function createMemoStore(opts: {
  /**
   * 수명(ms). **함수로 주면 매 조회 시 평가된다** — 절약 모드(docs/saving_mode_spec.md)가
   * 실행 중에 수명을 늘릴 수 있어야 해서 열어 둔 자리다. 숫자를 주면 종전과 동일.
   */
  ttlMs: number | (() => number);
  maxEntries: number;
  /** 환경변수 이름 — 값이 "off"면 캐시를 통째로 끈다 (킬스위치) */
  killSwitchEnv?: string;
  /** 판정 계측 콜백 (viewCache의 hit/miss 통계용 — 없으면 무계측) */
  onOutcome?: (outcome: "hit" | "miss" | "off") => void;
}): MemoStore {
  const store = new Map<string, { at: number; promise: Promise<unknown> }>();
  return {
    memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
      if (opts.killSwitchEnv && process.env[opts.killSwitchEnv] === "off") {
        opts.onOutcome?.("off");
        return fn();
      }
      const now = Date.now();
      const ttlMs = typeof opts.ttlMs === "function" ? opts.ttlMs() : opts.ttlMs;
      const hit = store.get(key);
      if (hit && now - hit.at < ttlMs) {
        opts.onOutcome?.("hit");
        return hit.promise as Promise<T>;
      }
      opts.onOutcome?.("miss");
      const promise = fn();
      // 실패한 Promise가 TTL 동안 에러를 고정하지 않도록 즉시 제거
      promise.catch(() => {
        if (store.get(key)?.promise === promise) store.delete(key);
      });
      store.set(key, { at: now, promise });
      if (store.size > opts.maxEntries) {
        for (const k of store.keys()) {
          if (store.size <= opts.maxEntries) break;
          store.delete(k);
        }
      }
      return promise;
    },
    size: () => store.size,
  };
}
