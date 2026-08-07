/**
 * 제한된 동시성(limit)으로 비동기 함수 매핑 실행 헬퍼.
 *
 * - 전량 순차(for + await)는 시즌 피크에 Vercel 함수 시간 한도를 초과하고,
 * - 전량 동시(Promise.all)는 Google API rate limit(429)에 걸린다.
 * 이 헬퍼는 그 중간 — limit명의 워커가 큐를 나눠 처리한다.
 *
 * (원본: classroom/transfer-enroll/route.ts의 검증된 구현을 공용화)
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Promise.allSettled(items.map(fn))의 동시성 제한 버전 — 드롭인 교체용.
 * 무제한 동시 발사는 Google Directory API가 429(rateLimitExceeded)로 일부를
 * 거절해 대량 작업에서 부분 실패가 발생하므로, 항상 이 함수를 사용한다.
 */
/**
 * Google API 속도 제한 오류 판별 — HTTP 429, 또는 403 중 rate/quota 계열 reason.
 * (googleapis GaxiosError는 상황에 따라 code / response.status / errors[].reason에 실린다)
 */
export function isRateLimitError(e: any): boolean {
  const status = Number(e?.code ?? e?.response?.status ?? e?.statusCode);
  if (status === 429) return true;
  const reasons: string[] = [
    ...(Array.isArray(e?.errors) ? e.errors : []),
    ...(Array.isArray(e?.response?.data?.error?.errors) ? e.response.data.error.errors : []),
  ].map((x: any) => String(x?.reason || ""));
  const text = reasons.join(",") + " " + String(e?.message || "");
  return status === 403 && /ratelimit|userratelimit|quota/i.test(text);
}

/**
 * 속도 제한(429 등) 시 지수 백오프로 재시도하는 래퍼.
 * 2026-08-07 졸업생 316명 일괄 삭제에서 재시도 부재로 126건이 즉시 실패 확정된
 * 사고의 재발 방지 — 대량 Google API 변이 호출은 이 래퍼로 감싼다.
 * 제한이 아닌 오류(404 등)는 재시도 없이 그대로 던진다.
 */
export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const attempts = opts?.attempts ?? 4;
  const base = opts?.baseDelayMs ?? 2000;
  const cap = opts?.maxDelayMs ?? 15000;
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e) || i === attempts - 1) throw e;
      const delay = Math.min(cap, base * 2 ** i) + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function mapConcurrentSettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  return mapConcurrent(items, limit, async (item): Promise<PromiseSettledResult<R>> => {
    try {
      return { status: "fulfilled", value: await fn(item) };
    } catch (reason) {
      return { status: "rejected", reason };
    }
  });
}
