import { NextRequest, NextResponse } from "next/server";
import { runNeisCalendarSync } from "@/lib/timetable/server";
import { adminDb } from "@/lib/firebase/admin";

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !CRON_SECRET) {
    console.error("[Cron] CRON_SECRET이 설정되지 않아 실행을 거부합니다.");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const settingsSnap = await adminDb.collection("timetable_settings").get();
    const domains = settingsSnap.docs.map((d) => d.id);
    const targetDomain = domains[0] || "hmh.or.kr";

    const result = await runNeisCalendarSync(targetDomain);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      stats: result.stats,
      processedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Cron] neis-calendar 수집 중 오류:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
