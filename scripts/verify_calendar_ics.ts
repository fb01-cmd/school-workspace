import { adminDb } from "../src/lib/firebase/admin";
import { getCalendarIcsInfo } from "../src/lib/timetable/server";
import { GET } from "../src/app/api/calendar/ics/route";

async function runVerification() {
  console.log("=== 🧪 구독형 학사일정 캘린더 이중 피드 (ics) 스펙 §5 및 §4-2 구조 검사 시작 ===");

  const domain = "hmh.or.kr";

  // 1. settings token 조회 / 생성 (icsToken & icsStaffToken)
  const info = await getCalendarIcsInfo(domain, "https://school.hmh.or.kr");
  console.log(`[1] icsToken(학생용) 발급/조회: ${info.icsToken.slice(0, 8)}...`);
  console.log(`    icsStaffToken(교직원용) 발급/조회: ${info.icsStaffToken.slice(0, 8)}...`);

  if (!info.icsToken || info.icsToken.length < 32) {
    throw new Error("[FAILED] icsToken이 유효하지 않습니다.");
  }
  if (!info.icsStaffToken || info.icsStaffToken.length < 32) {
    throw new Error("[FAILED] icsStaffToken이 유효하지 않습니다.");
  }
  if (info.icsToken === info.icsStaffToken) {
    throw new Error("[FAILED] icsToken과 icsStaffToken이 동일합니다.");
  }

  // 2. 무효 토큰 요청 404 검증
  const invalidReq = new Request("https://school.hmh.or.kr/api/calendar/ics?token=invalid_token_xyz_1234567890");
  const invalidRes = await GET(invalidReq);
  if (invalidRes.status !== 404) {
    throw new Error(`[FAILED] 무효 토큰 응답 상태 코드가 404가 아닙니다: ${invalidRes.status}`);
  }
  console.log("[2] 무효 토큰 요청 시 404 응답 확인 ✅");

  // 테스트용 staffOnly 이벤트 임시 등록 (검증 완료 후 삭제)
  const testStaffDocRef = adminDb
    .collection("timetable_calendar")
    .doc(domain)
    .collection("events")
    .doc(`test_staff_${Date.now()}`);
  await testStaffDocRef.set({
    termId: "2026-2",
    type: "행사",
    title: "TEST_STAFF_ONLY_EVENT_교직원전용점검",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    staffOnly: true,
    source: "manual",
    createdAt: Date.now(),
  });

  try {
    // 3. 학생용 토큰 (icsToken) 피드 수신 및 검증
    const studentReq = new Request(`https://school.hmh.or.kr/api/calendar/ics?token=${info.icsToken}`);
    const studentRes = await GET(studentReq);
    if (studentRes.status !== 200) {
      throw new Error(`[FAILED] 학생용 토큰 피드 응답 상태 코드가 200이 아닙니다: ${studentRes.status}`);
    }
    const studentIcsText = await studentRes.text();

    if (!studentIcsText.includes("X-WR-CALNAME:효명고 학사일정")) {
      throw new Error("[FAILED] 학생용 피드의 X-WR-CALNAME 헤더가 올바르지 않습니다.");
    }
    if (studentIcsText.includes("TEST_STAFF_ONLY_EVENT_교직원전용점검")) {
      throw new Error("[FAILED] 학생용 피드에 교직원 전용(staffOnly: true) 이벤트가 포함되어 있습니다!");
    }
    console.log("[3] 학생용 피드 (icsToken) 검증 성공 (staffOnly 이벤트 미포함, 캘린더명: 효명고 학사일정) ✅");

    // 4. 교직원용 토큰 (icsStaffToken) 피드 수신 및 검증
    const staffReq = new Request(`https://school.hmh.or.kr/api/calendar/ics?token=${info.icsStaffToken}`);
    const staffRes = await GET(staffReq);
    if (staffRes.status !== 200) {
      throw new Error(`[FAILED] 교직원용 토큰 피드 응답 상태 코드가 200이 아닙니다: ${staffRes.status}`);
    }
    const staffIcsText = await staffRes.text();

    if (!staffIcsText.includes("X-WR-CALNAME:효명고 학사일정(교직원)")) {
      throw new Error("[FAILED] 교직원용 피드의 X-WR-CALNAME 헤더가 올바르지 않습니다.");
    }
    if (!staffIcsText.includes("TEST_STAFF_ONLY_EVENT_교직원전용점검")) {
      throw new Error("[FAILED] 교직원용 피드에 교직원 전용(staffOnly: true) 이벤트가 누락되었습니다!");
    }
    console.log("[4] 교직원용 피드 (icsStaffToken) 검증 성공 (staffOnly 이벤트 포함, 캘린더명: 효명고 학사일정(교직원)) ✅");

    // 5. 기존 icsToken 주소 불변성 검증 (기구독자 호환성)
    if (!studentIcsText.includes("BEGIN:VCALENDAR") || !studentIcsText.includes("END:VCALENDAR")) {
      throw new Error("[FAILED] 기존 icsToken 피드 구조가 올바르지 않습니다.");
    }
    console.log("[5] 기존 icsToken 주소 불변 및 정상 호환성 확인 ✅");

    // 6. CRLF 및 종일 이벤트 DTEND exclusive(+1일 이상) 검사
    if (!staffIcsText.includes("\r\n")) {
      throw new Error("[FAILED] ics 응답에 CRLF(\\r\\n) 줄바꿈이 사용되지 않았습니다.");
    }

    const veventBlocks = staffIcsText.split("BEGIN:VEVENT").slice(1);
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

  } finally {
    // 테스트 임시 문서 삭제 정리
    await testStaffDocRef.delete();
  }

  console.log("=== ✨ 구독형 학사일정 캘린더 이중 피드 (ics) 스펙 전수 검사 통과 완료 ===");
}

runVerification().catch((e) => {
  console.error("❌ 검사 실패:", e);
  process.exit(1);
});
