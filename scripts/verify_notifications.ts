/**
 * 알림 센터 스모크 (읽기 전용 — notification_center_spec §7)
 * 실행: npx tsx --env-file=.env.local scripts/verify_notifications.ts
 * 존재하지 않는 수신자로 질의 경로만 검증 — 쓰기 0 (users 문서도 없어 카운터 미접촉).
 */
import { listNotifications, markAllNotificationsRead } from "../src/lib/notifications/server";

async function main() {
  const domain = "hmh.or.kr";
  const ghost = "notif-selftest-ghost@hmh.or.kr";
  const items = await listNotifications(domain, ghost);
  const marked = await markAllNotificationsRead(domain, ghost);
  const ok = Array.isArray(items) && items.length === 0 && marked === 0;
  console.log(`${ok ? "✅" : "❌"} 질의 경로 (본인 필터·미열람 동등 필터·색인 불요) — 목록 ${items.length}건 · 열람 처리 ${marked}건`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
