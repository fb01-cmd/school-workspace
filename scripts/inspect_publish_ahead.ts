import "./_force_notify_mock"; // 반드시 첫 import — 읽기 전용 실측
import { listWeeks, loadTimetableSettings, computeMyProjectedWeeks } from "../src/lib/timetable/server";

async function run() {
  const domain = "hmh.or.kr";
  const settings = await loadTimetableSettings(domain);
  console.log(`publishWeeksAhead(저장값 반영 후): ${settings.publishWeeksAhead}`);
  const ws = await listWeeks(domain, settings.activeTermId || "2026-2");
  for (const w of ws) console.log(`${w.id} createdBy=${w.createdBy} note=${w.note ?? "-"}`);
  const proj = await computeMyProjectedWeeks(domain, "admin@hmh.or.kr", {
    includeMyPending: false,
    includeDrafts: false,
  });
  console.log(`computeMyProjectedWeeks 노출 주: ${proj.weeks.map((w) => w.weekId).join(", ") || "(없음)"}`);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
