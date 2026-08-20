/**
 * 교직원 명단 요약본 갱신 지연 대기 셀프테스트 (NEXT.md 과제 2)
 *
 *   npx tsx scripts/roster_rebuild_wait_selftest.ts
 *
 * 테스트 케이스:
 *   ⓐ 재조립이 제때 끝나면 새 값을 읽는다 (index read)
 *   ⓑ 3초를 넘기면 원본으로 간다 (origin read)
 *   ⓒ 재조립 요청이 없던 평상시 경로는 종전과 동일하다 (index read)
 *   ⓓ 재조립이 debounced로 돌아오면 원본으로 간다 (origin read)
 *   ⓔ 재조립이 실패(에러)하면 원본으로 간다 (origin read)
 */

// Node 테스트 환경용 더미 환경변수 세팅 (Firestore/Auth 초기화용, 네트워크 읽기 0)
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "test-project";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "test-project.firebaseapp.com";

import { ROSTER_INDEX_SCHEMA_VERSION } from "../src/lib/org/roster_index_shared";
import type { TeacherProfile } from "../src/context/AuthContext";
import type { RebuildResult } from "../src/lib/org/roster";

const mockIndexProfiles: TeacherProfile[] = [
  { email: "index_teacher@school.kr", name: "색인교사", departments: ["교무부"] },
];

const mockOriginProfiles: TeacherProfile[] = [
  { email: "origin_teacher@school.kr", name: "원본교사", departments: ["교무부"] },
];

const usableIndexDoc = {
  schemaVersion: ROSTER_INDEX_SCHEMA_VERSION,
  domain: "school.kr",
  builtAt: Date.now(),
  builtBy: "test",
  count: 1,
  profiles: mockIndexProfiles,
};

async function runTests() {
  const { fetchProfilesViaIndexOrOrigin, _setInFlightRebuildPromiseForTest } = await import("../src/lib/org/roster");
  let passed = 0;
  let failed = 0;

  async function assertCase(
    name: string,
    inFlightPromise: Promise<RebuildResult> | null,
    timeoutMs: number,
    expectedSource: "index" | "origin"
  ) {
    let indexReadCount = 0;
    let originReadCount = 0;

    _setInFlightRebuildPromiseForTest(inFlightPromise);

    const result = await fetchProfilesViaIndexOrOrigin({
      customTimeoutMs: timeoutMs,
      mockDomain: "school.kr",
      mockGetIndexDoc: async () => {
        indexReadCount++;
        return usableIndexDoc;
      },
      mockGetOriginDocs: async () => {
        originReadCount++;
        return mockOriginProfiles;
      },
    });

    _setInFlightRebuildPromiseForTest(null);

    const actualSource = result[0]?.email === "index_teacher@school.kr" ? "index" : "origin";
    const ok = actualSource === expectedSource;
    if (ok) {
      passed++;
      console.log(`✅ [PASS] ${name} -> ${actualSource} (indexReads: ${indexReadCount}, originReads: ${originReadCount})`);
    } else {
      failed++;
      console.error(`❌ [FAIL] ${name} -> expected ${expectedSource}, got ${actualSource} (indexReads: ${indexReadCount}, originReads: ${originReadCount})`);
    }
  }

  // ⓐ 재조립이 제때 끝나면 새 값을 읽는다 (50ms 완료 -> index)
  await assertCase(
    "Case ⓐ: 재조립이 제때 끝나면 새 색인을 읽는다",
    new Promise((resolve) => setTimeout(() => resolve({ success: true, built: true }), 50)),
    3000,
    "index"
  );

  // ⓑ 3초를 넘기면 원본으로 간다 (timeoutMs=100ms, promise=500ms -> origin)
  await assertCase(
    "Case ⓑ: 타임아웃(3초 초과) 시 색인을 건너뛰고 원본으로 간다",
    new Promise((resolve) => setTimeout(() => resolve({ success: true, built: true }), 500)),
    100,
    "origin"
  );

  // ⓒ 재조립 요청이 없던 평상시 경로는 종전과 동일하다 (promise=null -> index)
  await assertCase(
    "Case ⓒ: 평상시(재조립 없음) 경로는 즉시 색인을 읽는다",
    null,
    3000,
    "index"
  );

  // ⓓ 재조립이 debounced로 돌아오면 원본으로 간다
  await assertCase(
    "Case ⓓ: debounced(재조립 생략) 응답 시 원본으로 간다",
    Promise.resolve({ success: true, built: false, reason: "debounced" }),
    3000,
    "origin"
  );

  // ⓔ 재조립이 실패(에러)하면 원본으로 간다
  await assertCase(
    "Case ⓔ: 재조립 실패 시 원본으로 간다",
    Promise.resolve({ success: false }),
    3000,
    "origin"
  );

  console.log(`\n결과: ${passed}/${passed + failed} 통과`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
