/**
 * 시간표 view 캐시 버전 문서 (weekly_synthesis_cache_spec §3-1)
 *
 * view 경로 인메모리 캐시(viewCache.ts)의 키에 들어가는 도메인별 버전.
 * 시간표를 바꾸는 모든 쓰기가 bump하고, view 라우트는 요청마다 이 값을 읽는다
 * (요청당 1읽기 — 이 읽기가 무효화 정확성의 원천이므로 캐시하지 않는다).
 */

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const cacheMetaDocRef = (domain: string) =>
  adminDb.collection("timetable_cache_meta").doc(domain);

export async function getTimetableCacheVersion(domain: string): Promise<number> {
  const snap = await cacheMetaDocRef(domain).get();
  if (!snap.exists) return 0;
  return Number(snap.data()?.v) || 0;
}

/**
 * 버전 +1. 본 쓰기는 이미 커밋된 뒤이므로 실패해도 throw하지 않는다 —
 * 여기서 던지면 사용자 재시도로 중복 커밋 위험이 더 크다. 유실분은
 * viewCache의 TTL(10분)이 흡수한다 (spec §3-1).
 */
export async function bumpTimetableCacheVersion(domain: string): Promise<void> {
  try {
    await cacheMetaDocRef(domain).set(
      { v: FieldValue.increment(1), bumpedAt: Date.now() },
      { merge: true }
    );
  } catch (e: any) {
    console.error(
      `[timetableCache] 버전 증가 실패 (${domain}) — 최대 TTL까지 낡은 캐시 가능:`,
      e.message
    );
  }
}
