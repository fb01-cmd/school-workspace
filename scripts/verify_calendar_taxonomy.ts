import "./_force_notify_mock"; // 반드시 첫 import
import {
  runNeisCalendarSync,
  loadCalendarEvents,
  timetableCalendarColRef,
  validateCalendarEventPayload,
} from "../src/lib/timetable/server";

const DOMAIN = "hmh.or.kr";
const TERM = "2026-2";

function fail(msg: string): never {
  console.error(`❌ 검증 실패: ${msg}`);
  process.exit(1);
}

async function run() {
  console.log("=== [1] 나이스 학사일정 수집 및 taxonomy 강화 검증 시작 ===");

  // 1. NEIS 학사일정 수집 실행
  console.log("1. runNeisCalendarSync 실행 중...");
  const syncResult = await runNeisCalendarSync(DOMAIN, TERM);
  console.log(`   결과: success=${syncResult.success}, message="${syncResult.message}", stats=`, syncResult.stats);

  if (!syncResult.success) {
    fail(`NEIS 수집 실패: ${syncResult.message}`);
  }

  // 2. 수집된 학사일정 건수 및 부정 케이스 검증
  const events = await loadCalendarEvents(DOMAIN, TERM);
  console.log(`2. 로드된 전체 학사일정: ${events.length}건`);
  events.forEach((e) => console.log(`   [${e.startDate}~${e.endDate}] type=${e.type} title="${e.title}" grades=${JSON.stringify(e.grades || "전체")}`));

  if (events.length < 10) {
    fail(`2026-2 수집 이벤트가 ${events.length}건으로 10건 미만입니다 (NEIS 학기 구간 수집 부족 가능성).`);
  }
  console.log(`   ✓ 2026-2 수집 이벤트 ${events.length}건 (>= 10건) 검증 통과`);

  // 공휴일 스킵 검증
  const holidayEvents = events.filter((e) => e.title === "광복절" || e.title === "광복절 대체공휴일" || e.title === "추석" || e.title === "개천절" || e.title === "한글날");
  if (holidayEvents.length > 0) {
    fail(`공휴일이 수집되어 등록됨 (${holidayEvents.map((e) => e.title).join(", ")}) — 공휴일 표 파생과 중복`);
  }
  console.log("   ✓ 공휴일 스킵 정상 확인");

  // 토요휴업일 스킵 검증
  const saturdayEvents = events.filter((e) => e.title === "토요휴업일");
  if (saturdayEvents.length > 0) {
    fail("토요휴업일이 수집되어 등록됨 — 주간 그리드 월~금 스킵 위반");
  }
  console.log("   ✓ 토요휴업일 스킵 정상 확인");

  // 겨울방학 기간 병합 1건 존재 검증 (없으면 fail)
  const winterVacation = events.find(
    (e) => e.source === "neis" && (e.title?.includes("방학") || e.title?.includes("겨울방학") || e.title?.includes("여름방학")) && e.startDate !== e.endDate
  );
  if (!winterVacation) {
    fail("겨울방학(또는 방학) 기간 병합 1건(startDate !== endDate)이 존재하지 않습니다.");
  }
  console.log(`   ✓ 방학 기간 병합 1건 존재 확인: "${winterVacation.title}" (${winterVacation.startDate} ~ ${winterVacation.endDate})`);

  // 수능일 (2026-11-19) 휴업일 존재 검증 (없으면 fail)
  const suneung = events.find(
    (e) => e.startDate === "2026-11-19" && e.title === "대학수학능력시험"
  );
  if (!suneung || suneung.type !== "휴업일") {
    fail(`수능일(2026-11-19) 휴업일 이벤트가 존재하지 않거나 타입 불일치: ${JSON.stringify(suneung)}`);
  }
  console.log(`   ✓ 수능일(2026-11-19) 휴업일 검증 성공: "${suneung.title}" (type=${suneung.type})`);

  // 대수능 모의평가 grades=[3] 검증 (없으면 fail)
  const suneungMock = events.find((e) => e.title === "대수능 모의평가");
  if (!suneungMock || JSON.stringify(suneungMock.grades) !== JSON.stringify([3])) {
    fail(`대수능 모의평가 grades가 [3]이 아닙니다: ${JSON.stringify(suneungMock)}`);
  }
  console.log(`   ✓ 대수능 모의평가 grades=[3] 검증 성공: "${suneungMock.title}"`);

  // 체험학습 grades=[2] 검증 (없으면 fail)
  const fieldTrip = events.find((e) => e.title === "체험학습");
  if (!fieldTrip || JSON.stringify(fieldTrip.grades) !== JSON.stringify([2])) {
    fail(`체험학습 grades가 [2]가 아닙니다: ${JSON.stringify(fieldTrip)}`);
  }
  console.log(`   ✓ 체험학습 grades=[2] 검증 성공: "${fieldTrip.title}"`);

  // 3. manual 항목 생성 후 수집 실행 시 manual 항목 보존(불가침) 검증
  console.log("3. 수동(manual) 학사일정 추가 및 보존 검증...");
  const manualRef = await timetableCalendarColRef(DOMAIN).add({
    termId: TERM,
    type: "단축수업",
    title: "검증용 수동 단축수업",
    startDate: "2026-11-20",
    endDate: "2026-11-20",
    periodsByGrade: { "1": 4, "2": 4, "3": 4 },
    source: "manual",
    createdBy: "claude-taxonomy-test",
    createdAt: Date.now(),
  });

  // 수집 재실행
  await runNeisCalendarSync(DOMAIN, TERM);
  const eventsAfterSync = await loadCalendarEvents(DOMAIN, TERM);
  const foundManual = eventsAfterSync.find((e) => e.id === manualRef.id);
  if (!foundManual) {
    fail("수집 재실행 시 수동(manual) 학사일정이 삭제됨! (manual 불가침 위반)");
  }
  console.log("   ✓ 수동(manual) 등록 항목 수집 시 삭제되지 않고 완전 보존됨 확인");

  // 정리
  await manualRef.delete();

  // 4. validateCalendarEventPayload 검증
  console.log("4. validateCalendarEventPayload 검증...");
  const v1 = validateCalendarEventPayload({ termId: TERM, type: "행사", startDate: "2026-10-15" });
  if (v1.ok) fail("행사 일정에 title 없이 통과됨 (title 필수 규칙 위반)");

  const v2 = validateCalendarEventPayload({
    termId: TERM,
    type: "행사",
    title: "체육대회",
    startDate: "2026-10-15",
    endDate: "2026-10-15",
    grades: [1, 2],
  });
  if (!v2.ok) fail(`행사 일정 검증 실패: ${v2.error}`);
  if (v2.event.title !== "체육대회" || JSON.stringify(v2.event.grades) !== JSON.stringify([1, 2])) {
    fail(`행사 일정 payload 파싱 불일치: ${JSON.stringify(v2.event)}`);
  }
  console.log("   ✓ 행사 title 필수 및 grades 파싱 정상 확인");

  console.log("=== 학사일정 taxonomy 및 수집 검증 전 과정 통과 ===");
}

run().catch((e) => {
  console.error("❌ 에러 발생:", e);
  process.exit(1);
});
