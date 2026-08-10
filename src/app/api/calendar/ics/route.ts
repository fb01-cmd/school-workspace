import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { loadAllCalendarEventsForICS } from "@/lib/timetable/server";

function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function formatYmd(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function addOneDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return formatYmd(ymd);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  const ny = date.getUTCFullYear();
  const nm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(date.getUTCDate()).padStart(2, "0");
  return `${ny}${nm}${nd}`;
}

function formatUtcTimestamp(ts?: number): string {
  const d = ts && ts > 0 ? new Date(ts) : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

function formatGradesSuffix(grades?: number[]): string {
  if (!grades || grades.length === 0 || grades.length >= 3) return "";
  const sorted = [...grades].sort((a, b) => a - b);
  return ` (${sorted.join("·")}학년)`;
}

function formatPeriodsDescription(periodsByGrade?: Record<string, number>): string {
  if (!periodsByGrade) return "";
  const entries = Object.entries(periodsByGrade)
    .map(([g, p]) => ({ grade: Number(g), period: Number(p) }))
    .filter((e) => Number.isInteger(e.grade) && Number.isInteger(e.period));
  if (entries.length === 0) return "";

  const byPeriod = new Map<number, number[]>();
  for (const { grade, period } of entries) {
    const list = byPeriod.get(period) || [];
    list.push(grade);
    byPeriod.set(period, list.sort((a, b) => a - b));
  }

  const parts: string[] = [];
  for (const [period, grades] of Array.from(byPeriod.entries()).sort((a, b) => a[0] - b[0])) {
    parts.push(`${grades.join("·")}학년 ${period}교시 수업`);
  }
  return parts.join(", ");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token")?.trim();

    if (!token || token.length < 16) {
      return new NextResponse("Not Found", { status: 404 });
    }

    // 1. icsToken (학생용) 검색
    let snap = await adminDb
      .collection("timetable_settings")
      .where("icsToken", "==", token)
      .limit(1)
      .get();

    let audience: "student" | "staff" = "student";
    let calName = "효명고 학사일정";

    if (snap.empty) {
      // 2. icsStaffToken (교직원용) 검색
      snap = await adminDb
        .collection("timetable_settings")
        .where("icsStaffToken", "==", token)
        .limit(1)
        .get();

      if (snap.empty) {
        return new NextResponse("Not Found", { status: 404 });
      }
      audience = "staff";
      calName = "효명고 학사일정(교직원)";
    }

    const domain = snap.docs[0].id;
    const allEvents = await loadAllCalendarEventsForICS(domain);

    // audience === "student" 이면 staffOnly 이벤트 제외
    const events = audience === "student" ? allEvents.filter((ev) => !ev.staffOnly) : allEvents;

    const icsLines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Hyomyeong High School//Timetable Calendar//KO",
      `NAME:${calName}`,
      `X-WR-CALNAME:${calName}`,
      "X-PUBLISHED-TTL:PT12H",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    for (const ev of events) {
      if (!ev.startDate) continue;

      const titleBase = ev.title || ev.type;
      const gradesSuffix = formatGradesSuffix(ev.grades);
      const summary = escapeIcsText(`${titleBase}${gradesSuffix}`);

      const noteText = ev.note?.trim() || "";
      const periodsText = formatPeriodsDescription(ev.periodsByGrade);
      const descParts = [noteText, periodsText].filter(Boolean);
      const description = descParts.length > 0 ? escapeIcsText(descParts.join("\n")) : "";

      const dtStart = formatYmd(ev.startDate);
      const endDate = ev.endDate || ev.startDate;
      const dtEnd = addOneDayYmd(endDate);

      const uid = `${ev.id || `${ev.startDate}_${titleBase}`}@portal.hmh.or.kr`;
      const dtStamp = formatUtcTimestamp(ev.createdAt);

      icsLines.push("BEGIN:VEVENT");
      icsLines.push(`UID:${uid}`);
      icsLines.push(`DTSTAMP:${dtStamp}`);
      icsLines.push(`LAST-MODIFIED:${dtStamp}`);
      icsLines.push(`DTSTART;VALUE=DATE:${dtStart}`);
      icsLines.push(`DTEND;VALUE=DATE:${dtEnd}`);
      icsLines.push(`SUMMARY:${summary}`);
      if (description) {
        icsLines.push(`DESCRIPTION:${description}`);
      }
      icsLines.push("END:VEVENT");
    }

    icsLines.push("END:VCALENDAR");

    const icsContent = icsLines.join("\r\n") + "\r\n";

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="hyomyeong-calendar.ics"',
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    console.error("[api/calendar/ics] Error:", err?.message || err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
