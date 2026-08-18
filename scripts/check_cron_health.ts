/**
 * 크론 생존 확인 — "돌긴 돌았나"를 사람이 물어볼 수 있게 한다.
 *
 * 배경: 이 저장소의 크론은 할 일이 없으면 아무 기록도 남기지 않아 조용히 멈춰도
 * 아무도 몰랐다. 2026-08-13 시트 브리지 이틀 정지, 2026-08-18 교사 전출 자동
 * 일시정지가 기한보다 7일 늦게 실행된 것(한 달 뒤 발견) 둘 다 같은 구멍이다.
 *
 * 함께 보여 주는 것: 전출 대기 중인 교사 계정의 다음 자동 처리 예정일.
 * 삭제는 **기한일이 아니라 일시정지된 날부터 30일**이라 화면의 D+N과 다르다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/check_cron_health.ts
 */
import { adminDb } from "../src/lib/firebase/admin";
import { CRON_LABEL, CRON_STALE_MS, readCronStatuses } from "../src/lib/ops/cron_heartbeat";

const DELETE_AFTER_SUSPEND_DAYS = 30;

function fmtAge(ms?: number): string {
  if (ms == null) return "-";
  const h = Math.floor(ms / 3600_000);
  if (h < 48) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function kstDay(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

async function main() {
  console.log("\n=== 크론 심박 ===\n");
  const statuses = await readCronStatuses();
  for (const s of statuses) {
    const label = CRON_LABEL[s.name];
    if (s.never) {
      console.log(`  ⏳ ${label} — 기록 없음 (심박 도입 후 아직 한 번도 안 돌았거나 배포 전)`);
      continue;
    }
    const mark = s.lastHadError ? "⚠️ " : s.stale ? "❌" : "✅";
    console.log(`  ${mark} ${label} — 마지막 실행 ${fmtAge(s.ageMs)} (${new Date(s.lastRunAt!).toISOString().slice(0, 16)})`);
    console.log(`      ${s.lastSummary || "(요약 없음)"}`);
    if (s.stale) console.log(`      ⚠️ ${Math.round(CRON_STALE_MS / 3600_000)}시간 넘게 소식이 없다 — 멈췄을 수 있다`);
  }

  console.log("\n=== 전출 교사 자동 처리 예정 ===\n");
  const snap = await adminDb
    .collection("teacher_transfer_tasks")
    .doc("hmh.or.kr")
    .collection("teachers")
    .get();

  const today = kstDay(new Date());
  let shown = 0;
  snap.forEach((d) => {
    const t: any = d.data();
    if (t.status !== "SUSPENDED" || !t.suspendedAt) return;
    shown++;
    const susp: Date = t.suspendedAt.toDate ? t.suspendedAt.toDate() : new Date(t.suspendedAt);
    const suspStr = kstDay(susp);
    const due = new Date(suspStr);
    due.setDate(due.getDate() + DELETE_AFTER_SUSPEND_DAYS);
    const dueStr = due.toISOString().slice(0, 10);
    const daysLeft = Math.round((Date.parse(dueStr) - Date.parse(today)) / 86400_000);
    console.log(`  ${t.email}`);
    console.log(`      일시정지 ${suspStr} → 자동 삭제 예정 ${dueStr} (${daysLeft > 0 ? `${daysLeft}일 뒤` : daysLeft === 0 ? "오늘" : `${-daysLeft}일 지남 ⚠️`})`);
  });
  if (!shown) console.log("  (일시정지 상태인 전출 교사 없음)");

  console.log("");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
