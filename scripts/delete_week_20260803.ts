import "./_force_notify_mock"; // 반드시 첫 import
// 2026-08-03 주 삭제 — note 없이 등록 잔존한 과거 주 정리 (2026-08-10 체크포인트 잔여 관찰 건)
// 연관 데이터(변경분·교환 신청)가 1건이라도 있으면 삭제하지 않고 중단한다.
import { timetableWeeksColRef, timetableChangesColRef, swapRequestsColRef, listWeeks } from "../src/lib/timetable/server";
import { bumpTimetableCacheVersion } from "../src/lib/timetable/cacheVersion";

const DOMAIN = "hmh.or.kr";
const WEEK_ID = "2026-08-03";

async function run() {
  const ref = timetableWeeksColRef(DOMAIN).doc(WEEK_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`주(${WEEK_ID}) 문서가 이미 없음 — 할 일 없음`);
    process.exit(0);
  }
  const week = snap.data()!;
  console.log(`대상 주: ${WEEK_ID} termId=${week.termId} note=${week.note ?? "(없음)"} createdBy=${week.createdBy}`);

  const [changes, swapSrc, swapTgt] = await Promise.all([
    timetableChangesColRef(DOMAIN).where("weekId", "==", WEEK_ID).get(),
    swapRequestsColRef(DOMAIN).where("weekId", "==", WEEK_ID).get(),
    swapRequestsColRef(DOMAIN).where("targetWeekId", "==", WEEK_ID).get(),
  ]);
  console.log(`연관 데이터: 변경분=${changes.size} 교환신청(소스)=${swapSrc.size} 교환신청(타깃)=${swapTgt.size}`);
  if (changes.size + swapSrc.size + swapTgt.size > 0) {
    console.error("연관 데이터가 있어 삭제 중단 — 수동 판단 필요");
    process.exit(1);
  }

  await ref.delete();
  await bumpTimetableCacheVersion(DOMAIN);
  console.log("삭제 완료 + 캐시 버전 bump");

  const after = await listWeeks(DOMAIN, week.termId);
  console.log(`삭제 후 ${week.termId} 주 목록: ${after.map((w) => w.id).join(", ")}`);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
