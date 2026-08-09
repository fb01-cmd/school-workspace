import "./_force_notify_mock"; // 반드시 첫 import — 읽기 전용 실측
import { listWeeks, findCurrentWeek, loadTimetableSettings } from "../src/lib/timetable/server";

async function run() {
  const domain = "hmh.or.kr";
  for (const term of ["2026-1", "2026-2"]) {
    const ws = await listWeeks(domain, term);
    console.log(`${term}: ${ws.map((w) => `${w.id}${w.note ? `(${w.note})` : ""}`).join(", ") || "(없음)"}`);
  }
  const settings = await loadTimetableSettings(domain);
  console.log(`activeTermId: ${settings.activeTermId}`);
  if (settings.activeTermId) {
    const cur = await findCurrentWeek(domain, settings.activeTermId);
    console.log(`findCurrentWeek(오늘 기준): ${cur ? cur.id : "(없음)"}`);
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
