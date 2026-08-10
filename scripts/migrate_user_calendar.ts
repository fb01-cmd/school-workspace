import "./_force_notify_mock"; // 반드시 첫 import
// 기존 수동 학사일정 캘린더(공개 ics) → 플랫폼 1회 이행 (calendar_ics_feed_spec §4-2)
// dry-run 기본: 이행/제외/분류 목록만 출력. --commit 시 실반영(source=manual).
import { loadCalendarEvents, timetableCalendarColRef } from "../src/lib/timetable/server";

const DOMAIN = "hmh.or.kr";
const TERM = "2026-2";
const SRC_ICS = "https://calendar.google.com/calendar/ical/c_jva5u0ienqbqrhhmvp9vdmveu4%40group.calendar.google.com/public/basic.ics";
const FROM = "2026-08-10"; // 남은 학기분만
const TO = "2027-02-28";

// 교직원 전용 자동 분류 키워드 (업무 마감·내부 작업류)
const STAFF_KEYWORDS = ["마감", "대사작업", "입력", "제출", "동료장학", "채점", "성적", "학생부 반영", "오류 점검", "NEIS"]; // 학생대위원회·정담회는 학생 노출 대상(사용자 확정)

function norm(s: string): string {
  return s.replace(/\s+/g, "").replace(/\(.*?\)/g, "").toLowerCase();
}
// 나이스 수집분과 동일 일정 판정용 동의어 짝 (정규화 후 비교)
const SYNONYM: Array<[string, string]> = [
  ["지필평가", "정기시험"],
  ["현장체험학습", "체험학습"],
  ["입학설명회", "신입생입시설명회"],
  ["전국연합평가", "전국연합학력평가"],
  ["대수능모의평가", "대수능모의평가"],
  ["개학식", "개학식"],
  ["학부모공개수업", "학부모공개수업"],
  ["강연100도씨", "강연100도씨"],
  ["대학수학능력시험", "대학수학능력시험"],
  ["재량휴업일", "재량휴업일"],
];
function sameEvent(aTitle: string, aS: string, aE: string, bTitle: string, bS: string, bE: string): boolean {
  const overlap = aS <= bE && bS <= aE;
  if (!overlap) return false;
  const na = norm(aTitle), nb = norm(bTitle);
  if (na.includes(nb) || nb.includes(na)) return true;
  return SYNONYM.some(([x, y]) => (na.includes(x) && nb.includes(y)) || (na.includes(y) && nb.includes(x)));
}

function parseGradesFromTitle(title: string): { clean: string; grades?: number[] } {
  // "대수능모의평가(3)", "전국연합평가(1, 2)", "2학기 2차 지필평가(3)" 형태
  const m = title.match(/\(([123][\s,·]*(?:[123][\s,·]*)*)\)\s*$/);
  if (!m) return { clean: title };
  const grades = Array.from(new Set(m[1].match(/[123]/g)!.map(Number))).sort();
  return { clean: title.replace(m[0], "").trim(), grades: grades.length >= 3 ? undefined : grades };
}

async function run() {
  const isCommit = process.argv.includes("--commit");
  console.log(`=== 기존 캘린더 이행 (${isCommit ? "실반영" : "DRY-RUN"}) ===`);

  const res = await fetch(SRC_ICS);
  if (!res.ok) throw new Error(`소스 ics 수신 실패: HTTP ${res.status}`);
  let raw = await res.text();
  raw = raw.replace(/\r\n[ \t]/g, ""); // unfold

  const platform = await loadCalendarEvents(DOMAIN, TERM);

  const vevents = raw.split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]);
  type Item = { start: string; end: string; title: string; grades?: number[]; staffOnly: boolean };
  const items: Item[] = [];
  const excluded: string[] = [];

  for (const e of vevents) {
    const s = e.match(/DTSTART[^:]*:(\d{8})/)?.[1];
    const en = e.match(/DTEND[^:]*:(\d{8})/)?.[1];
    const sm = e.match(/SUMMARY:(.*)/)?.[1]?.trim().replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ");
    if (!s || !sm) continue;
    const start = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    // 소스 DTEND는 exclusive → 실제 종료일 = -1일
    const endEx = en ? `${en.slice(0, 4)}-${en.slice(4, 6)}-${en.slice(6, 8)}` : start;
    const endD = new Date(`${endEx}T00:00:00Z`); endD.setUTCDate(endD.getUTCDate() - 1);
    const end = en ? endD.toISOString().slice(0, 10) : start;

    if (end < FROM || start > TO) continue; // 기간 밖(과거·차학년도)
    if (/^추석|^설날|^신정|^광복절|^개천절|^한글날|^현충일|^성탄절|.*공휴일$/.test(sm)) { excluded.push(`[공휴일] ${sm}`); continue; }
    // 입학설명회: 출처 불일치(연간표 11/6 vs 나이스·홈페이지 일정 11/5) — 나이스 마스터 추종을 위해 이행 제외 (2026-08-10 판정)
    if (sm.includes("입학설명회")) { excluded.push(`[나이스 추종] ${start} ${sm} — 날짜 불일치는 학교가 나이스 정정 시 자동 반영`); continue; }

    const dup = platform.find((p) => sameEvent(sm, start, end, p.title || p.type, p.startDate, p.endDate));
    if (dup) { excluded.push(`[나이스 중복] ${start} ${sm} ↔ ${dup.title}`); continue; }

    const fixedTitle = sm.replace("독도문회제", "독도문화제"); // 원본 오타 교정(연간표 실측)
    const { clean, grades } = parseGradesFromTitle(fixedTitle);
    const staffOnly = STAFF_KEYWORDS.some((k) => sm.includes(k));
    items.push({ start, end, title: clean, grades, staffOnly });
  }

  console.log(`\n-- 제외 ${excluded.length}건`);
  excluded.forEach((x) => console.log("  " + x));
  const pub = items.filter((i) => !i.staffOnly);
  const staff = items.filter((i) => i.staffOnly);
  console.log(`\n-- 이행: 전체 공개 ${pub.length}건`);
  pub.forEach((i) => console.log(`  ${i.start}${i.end !== i.start ? "~" + i.end : ""} ${i.title}${i.grades ? ` (${i.grades.join(",")}학년)` : ""}`));
  console.log(`\n-- 이행: 🔒 교직원 전용 ${staff.length}건`);
  staff.forEach((i) => console.log(`  ${i.start}${i.end !== i.start ? "~" + i.end : ""} ${i.title}${i.grades ? ` (${i.grades.join(",")}학년)` : ""}`));

  if (isCommit) {
    for (const i of items) {
      await timetableCalendarColRef(DOMAIN).add({
        termId: TERM, type: "행사", startDate: i.start, endDate: i.end, title: i.title,
        ...(i.grades ? { grades: i.grades } : {}), staffOnly: i.staffOnly,
        source: "manual", createdBy: "기존 캘린더 이행", createdAt: Date.now(),
      });
    }
    console.log(`\n실반영 완료: ${items.length}건 등록`);
  } else {
    console.log(`\nDRY-RUN — 실반영은 --commit`);
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
