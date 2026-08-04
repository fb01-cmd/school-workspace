import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단 (본 스크립트는 읽기 전용)
import {
  computeCandidates,
  loadWeek,
  synthesizeWeek,
  synthesizeTeacherTimetable,
} from "../src/lib/timetable/server";

/**
 * §14-1 가상 합성(what-if) 실측 (읽기 전용).
 * 전제: tteacher@의 교차 주 PENDING 신청 1건 (2026-08-10 목2 ↔ 2026-08-17 수1, 상대 이서준).
 * 확인: includeMyPending 시 소스 주 목요일 시수 -1, 대상 주 수요일 시수 +1이 projectedDayLoads에 반영되는가.
 */
async function run() {
  const domain = "hmh.or.kr";
  const email = "tteacher@hmh.or.kr";
  const weekA = "2026-08-10";
  const weekB = "2026-08-17";

  const dayLoads = async (weekId: string) => {
    const week = await loadWeek(domain, weekId);
    if (!week) throw new Error(`주 없음: ${weekId}`);
    const { grids } = await synthesizeWeek(domain, week);
    const counts = new Map<number, number>();
    for (const cell of synthesizeTeacherTimetable(grids, email)) {
      counts.set(cell.day, (counts.get(cell.day) || 0) + 1);
    }
    return [1, 2, 3, 4, 5].map((d) => counts.get(d) || 0);
  };

  const fmt = (a: number[] | { day: number; count: number }[]) =>
    (Array.isArray(a) && typeof a[0] === "number"
      ? (a as number[])
      : (a as { day: number; count: number }[]).map((x) => x.count)
    ).join(" ");

  const baseA = await dayLoads(weekA);
  const baseB = await dayLoads(weekB);
  console.log(`기준(오버레이 없음)  ${weekA} 월~금: ${fmt(baseA)}`);
  console.log(`기준(오버레이 없음)  ${weekB} 월~금: ${fmt(baseB)}`);

  // 소스 셀: 월1 (1-1반) — 대기 신청(목2)과 다른 셀이어야 자기 제외 로직에 안 걸림
  const source = { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" };

  const same = await computeCandidates(domain, email, weekA, source, undefined, { includeMyPending: true });
  console.log(`\n[같은-주 what-if] assumedPending=${same.assumedPendingCount} assumedDraft=${same.assumedDraftCount}`);
  console.log(`  projectedDayLoads(${weekA}): ${fmt(same.projectedDayLoads || [])}`);
  const thuBase = baseA[3];
  const thuProj = same.projectedDayLoads?.[3]?.count;
  console.log(`  검증: ${weekA} 목 ${thuBase} → ${thuProj} (기대 ${thuBase - 1}) ${thuProj === thuBase - 1 ? "✅" : "❌"}`);

  const cross = await computeCandidates(domain, email, weekA, source, weekB, { includeMyPending: true });
  console.log(`\n[교차 주 what-if] assumedPending=${cross.assumedPendingCount}`);
  console.log(`  projectedDayLoads(${weekA}):       ${fmt(cross.projectedDayLoads || [])}`);
  console.log(`  projectedTargetDayLoads(${weekB}): ${fmt(cross.projectedTargetDayLoads || [])}`);
  const wedBase = baseB[2];
  const wedProj = cross.projectedTargetDayLoads?.[2]?.count;
  console.log(`  검증: ${weekB} 수 ${wedBase} → ${wedProj} (기대 ${wedBase + 1}) ${wedProj === wedBase + 1 ? "✅" : "❌"}`);

  // 오프 스위치 회귀: whatIf 없으면 부가 필드가 없어야 한다
  const off = await computeCandidates(domain, email, weekA, source);
  const clean = off.projectedDayLoads === undefined && off.assumedPendingCount === undefined;
  console.log(`\n[회귀] whatIf 미지정 시 부가 필드 없음: ${clean ? "✅" : "❌"}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
