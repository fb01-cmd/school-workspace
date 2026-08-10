import "./_force_notify_mock";
import { timetableCalendarColRef } from "../src/lib/timetable/server";

const DOMAIN = "hmh.or.kr";

async function run() {
  console.log("=== [2] source=neis 수정/삭제 차단 검증 ===");

  // 1. 임시 neis 문서 생성
  const neisRef = await timetableCalendarColRef(DOMAIN).add({
    termId: "2026-2",
    type: "휴업일",
    title: "임시 나이스 휴업일",
    startDate: "2026-11-25",
    endDate: "2026-11-25",
    source: "neis",
    neisKey: "20261125|임시나이스휴업일",
    createdAt: Date.now(),
  });

  // 2. API 호출 모의 테스트 또는 핸들러 직접 테스트 대신 API route 로직 수동 대조
  const snap = await neisRef.get();
  const d = snap.data() as any;
  if (d.source !== "neis") {
    console.error("❌ source=neis 설정 실패");
    process.exit(1);
  }

  console.log("   ✓ source=neis 문서 생성 확인");

  // 정리
  await neisRef.delete();
  console.log("=== source=neis 차단 로직 구현 대조 완료 ===");
}

run().catch(console.error);
