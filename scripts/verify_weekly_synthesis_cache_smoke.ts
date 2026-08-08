import "./_force_notify_mock";
import { getTimetableCacheVersion } from "../src/lib/timetable/cacheVersion";
import {
  getViewContextCached,
  getWeekGridsCached,
  getBaseGridsCached,
} from "../src/lib/timetable/viewCache";
import {
  registerWeek,
  updateWeek,
  computeDirectCandidates,
  directCommit,
  revertTimetableChange,
  timetableWeeksColRef,
  timetableChangesColRef,
  swapRequestsColRef,
  simulGroupsColRef,
  loadTimetableSettings,
  loadActiveTerm,
} from "../src/lib/timetable/server";

async function runSmokeTests() {
  const domain = "hmh.or.kr";
  const managerEmail = "admin@hmh.or.kr";
  const activeTerm = await loadActiveTerm(domain);
  if (!activeTerm) throw new Error("활성 학기가 없습니다.");
  const termId = activeTerm.id;
  const testWeekId = "2026-12-28";
  const settings = await loadTimetableSettings(domain);

  console.log("=== [주간 합성 캐시 정합 스모크 4건 검증 시작] ===");
  console.log(`활성 학기: ${termId}`);

  // Clean up previous test artifacts
  await timetableWeeksColRef(domain).doc(testWeekId).delete();
  const oldChanges = await timetableChangesColRef(domain).where("weekId", "==", testWeekId).get();
  for (const d of oldChanges.docs) await d.ref.delete();
  const oldReqs = await swapRequestsColRef(domain).where("weekId", "==", testWeekId).get();
  for (const d of oldReqs.docs) await d.ref.delete();

  // -------------------------------------------------------------------
  // Scenario 4: 주 등록/수정 직후 반영
  // -------------------------------------------------------------------
  console.log("\n--- [시나리오 4] 주 등록/수정 직후 반영 ---");
  const v0 = await getTimetableCacheVersion(domain);
  console.log(`초기 캐시 버전: ${v0}`);
  
  const ctx0 = await getViewContextCached(domain, v0, termId);
  const weekExistsBefore = ctx0.weeks.some((w) => w.id === testWeekId);
  console.log(`등록 전 테스트 주 존재 여부: ${weekExistsBefore}`);

  const registeredWeek = await registerWeek(
    domain,
    { termId, startDate: testWeekId, note: "정합 스모크 테스트 주" },
    managerEmail
  );
  const v1 = await getTimetableCacheVersion(domain);
  console.log(`주 등록 후 캐시 버전: ${v1} (v0: ${v0} -> v1: ${v1})`);

  const ctx1 = await getViewContextCached(domain, v1, termId);
  const weekExistsAfter = ctx1.weeks.some((w) => w.id === testWeekId);
  console.log(`주 등록 후 viewContext에서 주 검색 결과: ${weekExistsAfter}`);

  await updateWeek(domain, testWeekId, { note: "정합 스모크 테스트 주 (수정됨)" }, managerEmail);
  const v1_1 = await getTimetableCacheVersion(domain);
  console.log(`주 수정 후 캐시 버전: ${v1_1} (v1: ${v1} -> v1_1: ${v1_1})`);
  const ctx1_1 = await getViewContextCached(domain, v1_1, termId);
  const updatedNote = ctx1_1.weeks.find((w) => w.id === testWeekId)?.note;
  console.log(`주 수정 후 viewContext note: ${updatedNote}`);

  const pass4 = weekExistsAfter && updatedNote === "정합 스모크 테스트 주 (수정됨)" && v1_1 > v0;
  console.log(pass4 ? "✅ 시나리오 4 통과!" : "❌ 시나리오 4 실패!");

  // -------------------------------------------------------------------
  // Scenario 1: 직권 담기 일괄 반영 직후 해당 교사 시간표·학급 화면 즉시 반영
  // -------------------------------------------------------------------
  console.log("\n--- [시나리오 1] 직권 담기 일괄 반영 직후 시간표 즉시 반영 ---");
  const sourceSlot = { grade: 1, classNum: 1, day: 1, period: 1, subjectName: "" };
  const candResult = await computeDirectCandidates(domain, testWeekId, sourceSlot);
  if (candResult.error || !("sourceTeacher" in candResult)) {
    throw new Error(`직권 후보 탐색 실패: ${candResult.error}`);
  }
  const swapCands = candResult.swapCandidates || [];
  const subCands = candResult.substituteCandidates || [];
  const type: "swap" | "substitute" = swapCands.length > 0 ? "swap" : "substitute";
  const topCandidate = type === "swap" ? swapCands[0] : subCands[0];
  if (!topCandidate) throw new Error("후보가 없습니다.");

  const topCandidateAny = topCandidate as any;
  const candSnap = type === "swap"
    ? {
        targetDay: topCandidateAny.targetDay,
        targetPeriod: topCandidateAny.targetPeriod,
        counterpartEmail: topCandidateAny.teacherEmail || topCandidateAny.counterpartEmail,
        counterpartName: topCandidateAny.teacherName || topCandidateAny.counterpartName,
        counterpartSubjectName: topCandidateAny.subjectName || topCandidateAny.counterpartSubjectName,
        score: topCandidateAny.score || 0,
        penalties: topCandidateAny.penalties || [],
      }
    : {
        counterpartEmail: topCandidateAny.teacherEmail,
        counterpartName: topCandidateAny.teacherName,
        score: 0,
        penalties: [],
      };

  const vBeforeCommit = await getTimetableCacheVersion(domain);
  const gridsBefore = await getWeekGridsCached(domain, vBeforeCommit, termId, registeredWeek, testWeekId, settings);
  const targetClassBefore = gridsBefore.grids.find((g) => g.grade === 1 && g.classNum === 1);
  const cellBefore = targetClassBefore?.cells.find((c) => c.day === 1 && c.period === 1);
  const teacherBefore = cellBefore?.lessons.map((l) => l.teachers.map((t) => t.name).join(",")).join("/") || "";

  const commitRes = await directCommit(domain, managerEmail, {
    weekId: testWeekId,
    type,
    source: { ...sourceSlot, subjectName: candResult.sourceTeacher.subjectName },
    candidate: candSnap as any,
    reason: { type: "출장" },
    batchId: "smoke_test_batch",
  });
  const changeId = commitRes.change.id;

  const vAfterCommit = await getTimetableCacheVersion(domain);
  console.log(`직권 담기 커밋 후 캐시 버전: ${vAfterCommit} (before: ${vBeforeCommit})`);
  const gridsAfterCommit = await getWeekGridsCached(domain, vAfterCommit, termId, registeredWeek, testWeekId, settings);
  
  const targetClassAfter = gridsAfterCommit.grids.find((g) => g.grade === 1 && g.classNum === 1);
  const cellAfter = targetClassAfter?.cells.find((c) => c.day === 1 && c.period === 1);
  const teacherAfter = cellAfter?.lessons.map((l) => l.teachers.map((t) => t.name).join(",")).join("/") || "";

  console.log(`담기 전 교사: [${teacherBefore}]`);
  console.log(`담기 후 교사: [${teacherAfter}]`);

  const pass1 = vAfterCommit > vBeforeCommit && teacherBefore !== teacherAfter;
  console.log(pass1 ? "✅ 시나리오 1 통과!" : "❌ 시나리오 1 실패!");

  // -------------------------------------------------------------------
  // Scenario 2: 승인 취소(revert) 직후 원상 복귀 즉시 반영
  // -------------------------------------------------------------------
  console.log("\n--- [시나리오 2] 승인 취소(revert) 직후 원상 복귀 즉시 반영 ---");
  await revertTimetableChange(domain, managerEmail, changeId);
  const vAfterRevert = await getTimetableCacheVersion(domain);
  console.log(`revert 후 캐시 버전: ${vAfterRevert} (afterCommit: ${vAfterCommit})`);

  const gridsAfterRevert = await getWeekGridsCached(domain, vAfterRevert, termId, registeredWeek, testWeekId, settings);
  const targetClassReverted = gridsAfterRevert.grids.find((g) => g.grade === 1 && g.classNum === 1);
  const cellReverted = targetClassReverted?.cells.find((c) => c.day === 1 && c.period === 1);
  const teacherReverted = cellReverted?.lessons.map((l) => l.teachers.map((t) => t.name).join(",")).join("/") || "";

  console.log(`revert 후 교사: [${teacherReverted}]`);
  const pass2 = vAfterRevert > vAfterCommit && teacherReverted === teacherBefore;
  console.log(pass2 ? "✅ 시나리오 2 통과!" : "❌ 시나리오 2 실패!");

  // -------------------------------------------------------------------
  // Scenario 3: 분반 또는 특별실 등록/삭제 직후 그리드 마크 반영
  // -------------------------------------------------------------------
  console.log("\n--- [시나리오 3] 분반/특별실 등록·삭제 직후 그리드 마크 반영 ---");
  const vBeforeSimul = await getTimetableCacheVersion(domain);
  const simulRef = simulGroupsColRef(domain).doc("smoke_test_simul");
  await simulRef.set({
    termId,
    grade: 1,
    classNums: [1, 2],
    subjectNames: ["수학"],
    label: "정합 스모크 분반",
    active: true,
    createdBy: managerEmail,
    createdAt: Date.now(),
  });
  const { bumpTimetableCacheVersion } = await import("../src/lib/timetable/cacheVersion");
  await bumpTimetableCacheVersion(domain);

  const vAfterSimul = await getTimetableCacheVersion(domain);
  console.log(`분반 등록 후 캐시 버전: ${vAfterSimul} (before: ${vBeforeSimul})`);

  const baseGridsAfterSimul = await getBaseGridsCached(domain, vAfterSimul, termId);
  const g1c1AfterSimul = baseGridsAfterSimul.find((g) => g.grade === 1 && g.classNum === 1);
  let mathLessonSimul: string | undefined;
  for (const c of g1c1AfterSimul?.cells || []) {
    const found = c.lessons.find((l) => l.subjectName === "수학");
    if (found) {
      mathLessonSimul = found.simul;
      break;
    }
  }
  console.log(`분반 등록 후 수학 lesson.simul: ${mathLessonSimul}`);

  // Delete simul group
  await simulRef.delete();
  await bumpTimetableCacheVersion(domain);
  const vAfterSimulDel = await getTimetableCacheVersion(domain);
  console.log(`분반 삭제 후 캐시 버전: ${vAfterSimulDel}`);
  const baseGridsAfterSimulDel = await getBaseGridsCached(domain, vAfterSimulDel, termId);
  const g1c1AfterSimulDel = baseGridsAfterSimulDel.find((g) => g.grade === 1 && g.classNum === 1);
  let mathLessonSimulDel: string | undefined;
  for (const c of g1c1AfterSimulDel?.cells || []) {
    const found = c.lessons.find((l) => l.subjectName === "수학");
    if (found) {
      mathLessonSimulDel = found.simul;
      break;
    }
  }
  console.log(`분반 삭제 후 수학 lesson.simul: ${mathLessonSimulDel}`);

  const pass3 = vAfterSimul > vBeforeSimul && mathLessonSimul === "정합 스모크 분반" && mathLessonSimulDel === undefined;
  console.log(pass3 ? "✅ 시나리오 3 통과!" : "❌ 시나리오 3 실패!");

  // Cleanup test week
  await timetableWeeksColRef(domain).doc(testWeekId).delete();
  const oldChangesEnd = await timetableChangesColRef(domain).where("weekId", "==", testWeekId).get();
  for (const d of oldChangesEnd.docs) await d.ref.delete();
  const oldReqsEnd = await swapRequestsColRef(domain).where("weekId", "==", testWeekId).get();
  for (const d of oldReqsEnd.docs) await d.ref.delete();

  console.log("\n=== [종합 검증 결과] ===");
  console.log(`① 직권 담기 반영: ${pass1 ? "PASS" : "FAIL"}`);
  console.log(`② 승인 취소 (revert): ${pass2 ? "PASS" : "FAIL"}`);
  console.log(`③ 분반/특별실 마크: ${pass3 ? "PASS" : "FAIL"}`);
  console.log(`④ 주 등록/수정: ${pass4 ? "PASS" : "FAIL"}`);

  if (pass1 && pass2 && pass3 && pass4) {
    console.log("\n🎉 정합 스모크 4건 전체 통과!");
  } else {
    console.error("\n❌ 정합 스모크 실패 항목 존재!");
    process.exit(1);
  }
}

runSmokeTests().catch((e) => {
  console.error("스모크 테스트 실행 중 에러:", e);
  process.exit(1);
});
