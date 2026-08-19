/**
 * 명단 색인 낡음 판정 셀프테스트 — 순수 함수, Firestore 읽기 0
 *
 *   npx tsx scripts/roster_index_selftest.ts
 *
 * 이 판정이 "색인을 믿을 것인가 / 원본으로 되돌아갈 것인가"를 혼자 정한다.
 * 틀리면 둘 중 하나가 조용히 일어난다 — 낡은 명단을 계속 보여 주거나(느슨), 매번
 * 89건을 읽어 절감이 0이 되거나(빡빡). 그래서 경계를 기계로 고정한다.
 */
import {
  ROSTER_INDEX_MAX_AGE_MS,
  ROSTER_INDEX_SCHEMA_VERSION,
  isRosterIndexUsable,
} from "../src/lib/org/roster_index_shared";

const NOW = 1_800_000_000_000;
const ok = (builtAt: number = NOW) => ({
  schemaVersion: ROSTER_INDEX_SCHEMA_VERSION,
  domain: "hmh.or.kr",
  builtAt,
  builtBy: "test",
  count: 2,
  profiles: [{ email: "a@x" }, { email: "b@x" }],
});

const cases: [string, boolean, unknown][] = [
  ["정상", true, ok()],
  ["없음(null)", false, null],
  ["없음(undefined)", false, undefined],
  ["구조 버전 불일치", false, { ...ok(), schemaVersion: ROSTER_INDEX_SCHEMA_VERSION + 1 }],
  ["profiles가 배열이 아님", false, { ...ok(), profiles: "nope" }],
  ["count 불일치(쓰다 만 문서)", false, { ...ok(), count: 3 }],
  ["count 누락", false, { ...ok(), count: undefined }],
  ["builtAt 0", false, { ...ok(), builtAt: 0 }],
  ["builtAt 누락", false, { ...ok(), builtAt: undefined }],
  // 경계 — 딱 48시간은 아직 쓴다, 1ms 넘으면 안 쓴다
  ["나이 = 한도 정각", true, ok(NOW - ROSTER_INDEX_MAX_AGE_MS)],
  ["나이 = 한도 + 1ms", false, ok(NOW - ROSTER_INDEX_MAX_AGE_MS - 1)],
  ["나이 = 한도 - 1ms", true, ok(NOW - ROSTER_INDEX_MAX_AGE_MS + 1)],
  // 미래 시각(서버·클라 시계 어긋남) — 음수 나이는 한도를 넘지 않으므로 사용 가능
  ["빌드 시각이 미래", true, ok(NOW + 60_000)],
  ["빈 명단이라도 구조가 맞으면 사용 가능", true, { ...ok(), count: 0, profiles: [] }],
];

let failed = 0;
for (const [name, expected, doc] of cases) {
  const actual = isRosterIndexUsable(doc as any, NOW);
  const pass = actual === expected;
  if (!pass) failed++;
  console.log(`${pass ? "✅" : "❌"} ${name} — 기대 ${expected}, 실제 ${actual}`);
}

console.log(`\n${cases.length - failed}/${cases.length} 통과`);
process.exit(failed ? 1 : 0);
