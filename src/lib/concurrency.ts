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
