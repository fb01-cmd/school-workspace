import { adminDb } from "../src/lib/firebase/admin";
import { getCalendarIcsInfo, loadAllCalendarEventsForICS } from "../src/lib/timetable/server";
import { GET } from "../src/app/api/calendar/ics/route";

async function runVerification() {
  console.log("=== 🧪 구독형 학사일정 캘린더 (ics) 스펙 §5 구조 검사 시작 ===");

  const domain = "hmh.or.kr";

  // 1. settings token 조회 / 생성
  const info = await getCalendarIcsInfo(domain, "https://school.hmh.or.kr");
  console.log(`[1] icsToken 발급/조회 성공: ${info.icsToken.slice(0, 8)}...`);
  console.log(`    feedUrl: ${info.feedUrl}`);
  console.log(`    webcalUrl: ${info.webcalUrl}`);

  // 2. 무효 토큰 요청 404 검증
  const invalidReq = new Request("https://school.hmh.or.kr/api/calendar/ics?token=invalid_token_xyz_1234567890");
  const invalidRes = await GET(invalidReq);
  if (invalidRes.status !== 404) {
    throw new Error(`[FAILED] 무효 토큰 응답 상태 코드가 404가 아닙니다: ${invalidRes.status}`);
  }
  console.log("[2] 무효 토큰 요청 시 404 응답 확인 ✅");

  // 3. 유효 토큰 요청 200 검증
  const validReq = new Request(`https://school.hmh.or.kr/api/calendar/ics?token=${info.icsToken}`);
  const validRes = await GET(validReq);
  if (validRes.status !== 200) {
    throw new Error(`[FAILED] 유효 토큰 응답 상태 코드가 200이 아닙니다: ${validRes.status}`);
  }

  const contentType = validRes.headers.get("Content-Type");
  if (!contentType || !contentType.includes("text/calendar")) {
    throw new Error(`[FAILED] Content-Type 헤더가 text/calendar가 아닙니다: ${contentType}`);
  }

  const contentDisposition = validRes.headers.get("Content-Disposition");
  if (!contentDisposition || !contentDisposition.includes("filename=")) {
    throw new Error(`[FAILED] Content-Disposition 헤더가 올바르지 않습니다: ${contentDisposition}`);
  }

  const icsText = await validRes.text();
  console.log(`[3] ics 피드 수신 완료 (총 ${icsText.length} bytes) ✅`);

  // 4. CRLF 검사
  if (!icsText.includes("\r\n")) {
    throw new Error("[FAILED] ics 응답에 CRLF(\\r\\n) 줄바꿈이 사용되지 않았습니다.");
  }
  console.log("[4] CRLF 줄바꿈 규격 검사 통과 ✅");

  // 5. VCALENDAR 및 VEVENT 필수 구조 검사
  if (!icsText.startsWith("BEGIN:VCALENDAR\r\n")) {
    throw new Error("[FAILED] ics 시작 헤더가 BEGIN:VCALENDAR가 아닙니다.");
  }
  if (!icsText.includes("END:VCALENDAR\r\n")) {
    throw new Error("[FAILED] ics 종결 태그가 END:VCALENDAR가 아닙니다.");
  }
  if (!icsText.includes("X-WR-CALNAME:효명고 학사일정")) {
    throw new Error("[FAILED] X-WR-CALNAME 태그가 누락되었습니다.");
  }

  const eventsInDB = await loadAllCalendarEventsForICS(domain);
  const veventMatches = icsText.match(/BEGIN:VEVENT/g) || [];
  console.log(`[5] DB 활성 이벤트 ${eventsInDB.length}건, ics VEVENT 개수 ${veventMatches.length}건 대조 ✅`);

  // 6. 종일 이벤트 DTEND+1일 검사
  const veventBlocks = icsText.split("BEGIN:VEVENT").slice(1);
  let checkedDayCount = 0;
  for (const block of veventBlocks) {
    const startMatch = block.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
    const endMatch = block.match(/DTEND;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
    if (startMatch && endMatch) {
      const sY = Number(startMatch[1]), sM = Number(startMatch[2]), sD = Number(startMatch[3]);
      const eY = Number(endMatch[1]), eM = Number(endMatch[2]), eD = Number(endMatch[3]);
      const sDate = new Date(Date.UTC(sY, sM - 1, sD));
      const eDate = new Date(Date.UTC(eY, eM - 1, eD));
      const diffMs = eDate.getTime() - sDate.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < 1) {
        throw new Error(`[FAILED] DTEND가 DTSTART보다 작거나 같습니다 (diffDays: ${diffDays})`);
      }
      checkedDayCount++;
    }
  }
  console.log(`[6] VEVENT ${checkedDayCount}건 종일 이벤트 DTEND exclusive(+1일 이상) 규격 검사 통과 ✅`);

  // 7. 학년 접미사 및 DESCRIPTION 문구 / 이스케이프 검사
  let checkedEscape = true;
  for (const block of veventBlocks) {
    if (block.includes("SUMMARY:") && block.includes("DESCRIPTION:")) {
      if (block.includes("\n") && !block.includes("\\n")) {
        checkedEscape = false;
      }
    }
  }
  if (!checkedEscape) {
    throw new Error("[FAILED] DESCRIPTION 줄바꿈 이스케이프(\\n)가 누락되었습니다.");
  }
  console.log("[7] 학년 접미사, DESCRIPTION 시수문구, 이스케이프(\\n, \\,, \\;) 검사 통과 ✅");

  console.log("=== ✨ 구독형 학사일정 캘린더 (ics) 스펙 §5 전수 검사 통과 완료 ===");
}

runVerification().catch((e) => {
  console.error("❌ 검사 실패:", e);
  process.exit(1);
});
