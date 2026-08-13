/**
 * Firestore 컬렉션별 문서 수 실측 (읽기 전용, count() 집계)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/inspect_firestore_volume.ts
 *
 * 목적: 백업 설계의 입력. "전량 백업이 무료 한도(읽기 5만/일) 안에서 가능한가"를
 *       추측이 아니라 숫자로 정한다.
 *
 * 비용: count() 집계는 문서를 읽지 않고 인덱스 항목 1000개당 1읽기로 과금된다.
 *       전 컬렉션을 세도 수십 읽기 수준 — 전수 조회(문서 수만큼 읽기)와 다르다.
 *       (AGENTS.md 규율표 3번 "전수 조사 전 읽기량을 추산한다"의 도구)
 */
import { adminDb } from "../src/lib/firebase/admin";

const DOMAIN = "hmh.or.kr";

// 최상위 컬렉션
const TOP = [
  "users", "settings", "audit_logs", "policy_acks", "memos",
  "teacher_profiles", "teacher_profiles_pending",
  "discipline_records", "discipline_stage_events", "discipline_config",
  "chrome_bookmark_logs", "classroom_cleanup_logs", "classroom_sync_logs",
  "timetable_settings", "timetable_terms", "timetable_weeks", "timetable_changes",
  "timetable_base_revisions", "timetable_simul_groups", "timetable_venue_groups",
  "timetable_slot_bans", "timetable_consecutive_rules", "timetable_coteaching_rules",
  "timetable_cache_meta", "push_subscriptions", "graduation_consents",
];

// 도메인 하위 컬렉션 (컬렉션/{domain}/하위) — 실제 ref 헬퍼에서 확인한 경로만 적는다.
// 최상위로 착각하면 0으로 나와 백업 규모를 과소평가한다(초판이 그랬다).
const NESTED: [string, string][] = [
  ["graduation_tasks", "students"],
  ["transfer_out_tasks", "students"],
  ["teacher_transfer_tasks", "teachers"],
  ["discipline_permissions", "grants"],       // discipline/server.ts:46
  ["discipline_records", "records"],           // discipline/server.ts:40
  ["discipline_stage_events", "events"],       // discipline/server.ts:43
  ["push_subscriptions", "subs"],              // push/webpush.ts:25
  ["timetable_calendar", "events"],            // timetable/server.ts:1831 계열
  ["timetable_terms", "terms"],                // timetable/server.ts:59
  ["timetable_weeks", "weeks"],                // timetable/server.ts:1255
  ["timetable_changes", "changes"],            // timetable/server.ts:1258
  ["memos", "items"],                          // api/memo/route.ts:22
];

// 컬렉션 그룹 — 학기마다 하위에 매달리는 것은 그룹 질의로 한 번에 센다
const GROUPS = ["classGrids"];                 // timetable/server.ts:61-67 (학기당 30학급)

async function countOf(ref: FirebaseFirestore.Query): Promise<number | string> {
  try {
    const snap = await ref.count().get();
    return snap.data().count;
  } catch (e: any) {
    return `조회 실패(${e.code || e.message})`;
  }
}

async function run() {
  const rows: { name: string; n: number | string }[] = [];

  for (const c of TOP) rows.push({ name: c, n: await countOf(adminDb.collection(c)) });
  for (const [p, sub] of NESTED) {
    rows.push({ name: `${p}/${DOMAIN}/${sub}`, n: await countOf(adminDb.collection(p).doc(DOMAIN).collection(sub)) });
  }
  for (const g of GROUPS) {
    rows.push({ name: `${g} (컬렉션 그룹 전체)`, n: await countOf(adminDb.collectionGroup(g)) });
  }

  rows.sort((a, b) => (typeof b.n === "number" ? b.n : -1) - (typeof a.n === "number" ? a.n : -1));

  let total = 0;
  console.log("컬렉션".padEnd(48) + "문서 수");
  console.log("-".repeat(60));
  for (const r of rows) {
    if (typeof r.n === "number") total += r.n;
    if (r.n === 0) continue; // 빈 컬렉션은 생략
    console.log(r.name.padEnd(48) + r.n);
  }
  console.log("-".repeat(60));
  console.log(`합계(0 제외 표시, 합계는 전체): ${total} 문서`);
  console.log(`\n전량 백업 1회 = 약 ${total} 읽기 (Firestore 무료 일일 한도 50,000의 ${((total / 50000) * 100).toFixed(1)}%)`);
  console.log(`이 실행 자체의 비용 = count() 집계 ${rows.length}회 (문서 수와 무관, 수십 읽기 수준)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
