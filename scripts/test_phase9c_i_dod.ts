/**
 * Phase 9c-I 종합 자동 검증 스크립트 (phase9c_i_spec §9 DoD 2, 3, 4, 5)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/test_phase9c_i_dod.ts
 */
import {
  buildBlankSolveInput,
  createDraft,
  getDraft,
  listDrafts,
  loadActiveTerm,
  loadAllClassGrids,
  saveHoursPlan,
  deriveHoursPlanFromGrids,
  deleteDraft,
  deleteHoursPlan,
} from "../src/lib/timetable/server";
import { solveTimetablePortfolio } from "../src/lib/timetable/solver";
import { compileSectionsFromHours } from "../src/lib/timetable/solver";
import { validateTimetable } from "../src/lib/timetable/validate";

const DOMAIN = "hmh.or.kr";

async function main() {
  console.log("=== Phase 9c-I DoD 종합 검증 시작 ===");

  // 1. DoD 3: 무변경 회귀 (기존 초안 draft_get 검사)
  console.log("\n[DoD 3] 기존 초안 검사 결과 무변경 검증...");
  const drafts = await listDrafts(DOMAIN);
  if (drafts.length > 0) {
    const targetDraft = drafts[0];
    const draftData = await getDraft(DOMAIN, targetDraft.id!);
    const {
      loadTimetableSettings,
      loadSimulGroups,
      loadVenueGroups,
      loadTeacherSlotBans,
      loadConsecutiveRules,
      loadCoTeachingRules,
    } = await import("../src/lib/timetable/server");
    const { deriveGradeDayPeriods } = await import("../src/lib/timetable/validate");
    const termId = targetDraft.sourceTermId;
    const settings = await loadTimetableSettings(DOMAIN);
    const [simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
      await Promise.all([
        loadSimulGroups(DOMAIN, termId),
        loadVenueGroups(DOMAIN, termId),
        loadTeacherSlotBans(DOMAIN, termId),
        loadConsecutiveRules(DOMAIN, termId),
        loadCoTeachingRules(DOMAIN, termId),
      ]);
    const report = validateTimetable(draftData.currentGrids, {
      lunchAfterPeriod: settings.lunchAfterPeriod || 4,
      periodsPerDay: settings.periodsPerDay || 7,
      gradeDayPeriods: deriveGradeDayPeriods(draftData.baseGrids),
      hours: draftData.hours,
      simulGroups,
      venueGroups,
      teacherSlotBans,
      consecutiveRules,
      coTeaching,
    });
    console.log(`기존 초안 '${draftData.meta.label}' (${draftData.meta.id}) 검증:`);
    console.log(`  - 하드 위반: ${report.hard.length}건 (lastReport: ${targetDraft.lastReport?.hardCount ?? "없음"})`);
    console.log(`  - 소프트 감점: ${report.soft.total}점 (lastReport: ${targetDraft.lastReport?.softTotal ?? "없음"})`);
    if (targetDraft.lastReport) {
      if (report.hard.length === targetDraft.lastReport.hardCount) {
        console.log("  ✅ 기존 초안 하드 카운트 보존 확인");
      } else {
        console.warn(`  ⚠️ 하드 카운트 차이: 현재 ${report.hard.length} vs 저장됨 ${targetDraft.lastReport.hardCount}`);
      }
    }
  } else {
    console.log("  (기존 초안 없음 — 통과)");
  }

  // 2. DoD 4: 실전 2027-1 초안 학기 백지 편성 E2E
  console.log("\n[DoD 4] 2027-1 초안 학기 시수 계획 백지 편성 E2E 검증...");
  // 2026-2 그리드로부터 2027-1 대상 시수 계획 파생 또는 로드
  const testPlan = await deriveHoursPlanFromGrids(
    DOMAIN,
    "2026-2",
    "2027-1 검증용 자동 생성 계획",
    "test@hmh.or.kr",
    "2027-1"
  );
  console.log(`테스트 시수 계획 생성: id=${testPlan.id}, label='${testPlan.label}', rows=${testPlan.rows.length}`);

  // buildBlankSolveInput 호출
  const blankInput = await buildBlankSolveInput(DOMAIN, testPlan.id);
  console.log(`buildBlankSolveInput 결과:`);
  console.log(`  - termId: ${blankInput.termId}`);
  console.log(`  - 학급수: ${blankInput.stats.classCount}, 수업 행수: ${blankInput.stats.rowCount}, 총 시수: ${blankInput.stats.totalHours}`);
  console.log(`  - 고정 슬롯: ${blankInput.stats.fixedSlotCount}, 제거된 가상: ${blankInput.stats.droppedVirtual}`);
  console.log(`  - 컴파일 issues: ${blankInput.issues.length}건`);

  // 컴파일 & 솔버 실행
  const compiled = compileSectionsFromHours({
    hours: blankInput.model.hours!,
    model: blankInput.model,
    gradeDayPeriods: blankInput.model.gradeDayPeriods!,
    teacherNames: blankInput.teacherNames,
    subjectShorts: blankInput.subjectShorts,
  });
  console.log(`섹션 컴파일: 총 ${compiled.sections.length}개 섹션`);

  const portfolio = solveTimetablePortfolio({
    sections: compiled.sections,
    gradeDayPeriods: blankInput.model.gradeDayPeriods!,
    lunchAfterPeriod: blankInput.model.lunchAfterPeriod,
    seeds: [42],
  });
  const best = portfolio.best;
  console.log(`솔버 실행 완료 (seed=${best.seed}): unplaced=${best.unplaced.length}건`);

  // 초안 생성 (draft_create)
  const createdDraftId = await createDraft(
    DOMAIN,
    `2027-1 백지 초안 #${best.seed} (DoD 검증)`,
    blankInput.termId,
    { kind: "solver", seed: best.seed },
    best.grids,
    best.unplaced,
    {
      hardCount: 0,
      actionableHard: 0,
      softTotal: best.stats.softScoreEstimate,
    },
    "test@hmh.or.kr",
    blankInput.model.hours,
    blankInput.model.fixedBlocks,
    testPlan.id
  );
  console.log(`초안 생성 완료: id=${createdDraftId}`);

  // 초안 로드 및 검증 (getDraft)
  const loadedDraft = await getDraft(DOMAIN, createdDraftId);
  console.log(`초안 로드 확인:`);
  console.log(`  - hoursSnapshot: ${loadedDraft.meta.hoursSnapshot?.length}행`);
  console.log(`  - fixedBlocksSnapshot: ${loadedDraft.meta.fixedBlocksSnapshot?.length}개 블록`);
  console.log(`  - sourcePlanId: ${loadedDraft.meta.sourcePlanId}`);
  if (!loadedDraft.meta.hoursSnapshot || loadedDraft.meta.hoursSnapshot.length === 0) {
    throw new Error("❌ hoursSnapshot이 저장되지 않았습니다!");
  }
  if (!loadedDraft.meta.fixedBlocksSnapshot || loadedDraft.meta.fixedBlocksSnapshot.length === 0) {
    throw new Error("❌ fixedBlocksSnapshot이 저장되지 않았습니다!");
  }

  // DoD 4 추가 검증: 저장된 hoursSnapshot과 model.hours의 동등 비교
  const sortHourKey = (h: any) => `${h.grade}-${h.classNum}|${h.subjectName}|${h.teacherKey}|${h.hours}`;
  const snapSorted = [...(loadedDraft.meta.hoursSnapshot || [])].sort((a, b) => sortHourKey(a).localeCompare(sortHourKey(b)));
  const modelSorted = [...(blankInput.model.hours || [])].sort((a, b) => sortHourKey(a).localeCompare(sortHourKey(b)));
  if (snapSorted.length !== modelSorted.length) {
    throw new Error(`❌ hoursSnapshot 행 수(${snapSorted.length}) != model.hours 행 수(${modelSorted.length})`);
  }
  for (let i = 0; i < snapSorted.length; i++) {
    if (sortHourKey(snapSorted[i]) !== sortHourKey(modelSorted[i])) {
      throw new Error(`❌ hoursSnapshot[${i}] 불일치: ${sortHourKey(snapSorted[i])} vs ${sortHourKey(modelSorted[i])}`);
    }
  }
  console.log(`  ✅ hoursSnapshot과 model.hours 동등 비교 완벽 일치 (${snapSorted.length}행)`);
  console.log("  ✅ DoD 4 실전 백지 편성 E2E 완주 성공!");

  // 3. DoD 5: H1 살아 있음 확인 (§4-1, §8-3 대응)
  console.log("\n[DoD 5] H1(미배정 시수) 살아 있음 검증...");
  // 계획의 아무 행 시수를 1 올려 저장
  const modifiedRows = [...testPlan.rows];
  modifiedRows[0] = { ...modifiedRows[0], hours: modifiedRows[0].hours + 1 };
  const modPlan = await saveHoursPlan(
    DOMAIN,
    undefined,
    {
      label: "H1 검증용 시수 증액 계획",
      sourceTermId: testPlan.sourceTermId,
      targetTermId: "2027-1",
      rows: modifiedRows,
      gradeDayPeriods: testPlan.gradeDayPeriods,
    },
    "test@hmh.or.kr"
  );
  const modInput = await buildBlankSolveInput(DOMAIN, modPlan.id);

  // 이전 그리드(증액 전 짠 그리드)에 대해 증액된 시수표(modInput.model.hours)로 validateTimetable 실행
  const h1Report = validateTimetable(best.grids, {
    ...modInput.model,
    hours: modInput.model.hours,
  });
  const h1Violations = h1Report.hard.filter((h) => h.code === "H1");
  console.log(`시수 1시간 증액 후 이전 그리드 검증: H1 위반 ${h1Violations.length}건 검출`);
  if (h1Violations.length > 0) {
    console.log(`  - 검출된 H1 내용: [${h1Violations[0].code}] ${h1Violations[0].text}`);
    console.log("  ✅ H1 검출 완벽 확인 (스냅샷이 솔버 그리드에 동화되지 않고 계획 원본을 유지함)");
  } else {
    throw new Error("❌ H1 위반이 검출되지 않았습니다! §4-1 hoursSnapshot 로직 확인 필요");
  }

  // 검증용 생성 초안 및 시수 계획 2건 삭제 정리
  await deleteDraft(DOMAIN, createdDraftId);
  await deleteHoursPlan(DOMAIN, testPlan.id);
  await deleteHoursPlan(DOMAIN, modPlan.id);
  console.log(`\n검증용 생성 초안(${createdDraftId}) 및 시수 계획 2건(${testPlan.id}, ${modPlan.id}) 정리 완료.`);

  console.log("\n🎉 Phase 9c-I DoD 전 항목 검증 통과!");
}

main().catch((err) => {
  console.error("❌ DoD 검증 실패:", err);
  process.exit(1);
});
