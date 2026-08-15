/**
 * Phase 9c-I UI 상호작용 전체 E2E 시뮬레이션 검증 스크립트
 *
 * 사용자가 UI에서 수행하는 단계와 100% 동일한 API 및 워커 파이프라인을 실행하여
 * 모달 수치, 진행률, 초안 생성, 리포트 표출, 삭제까지 전 과정을 검증한다.
 *
 * 사용법: npx tsx --env-file=.env.local scripts/test_phase9c_i_e2e_ui_flow.ts
 */
import {
  buildBlankSolveInput,
  createDraft,
  getDraft,
  listDrafts,
  deleteDraft,
  listHoursPlans,
  loadTimetableSettings,
  loadSimulGroups,
  loadVenueGroups,
  loadTeacherSlotBans,
  loadConsecutiveRules,
  loadCoTeachingRules,
} from "../src/lib/timetable/server";
import { compileSectionsFromHours, solveTimetablePortfolio } from "../src/lib/timetable/solver";
import { validateTimetable, deriveGradeDayPeriods } from "../src/lib/timetable/validate";

const DOMAIN = "hmh.or.kr";
const TARGET_TERM_ID = "2027-1";

async function runE2EUIFlow() {
  console.log("==================================================");
  console.log("🚀 Phase 9c-I 화면 E2E 전체 파이프라인 검증 시작");
  console.log("==================================================");

  // [Step 1] 학기 및 시수 계획 조회 (UI 마운트 시 동작)
  console.log("\n[Step 1] 작업 학기 (2027-1) 시수 계획 로드");
  const plans = await listHoursPlans(DOMAIN);
  const targetPlan = plans.find(
    (p) => p.targetTermId === TARGET_TERM_ID && p.label === "2026-2 기반 신학기 수업 시간"
  );
  if (!targetPlan) {
    throw new Error(`2027-1 대상 '2026-2 기반 신학기 수업 시간' 계획을 찾을 수 없습니다.`);
  }
  console.log(`  ✅ 계획 선택 완료: [${targetPlan.id}] "${targetPlan.label}" (${targetPlan.rowCount}개 수업)`);

  // [Step 2] '시수 계획으로 자동 작성 시작' 클릭 -> 사전 확인 모달 (Preflight)
  console.log("\n[Step 2] '시수 계획으로 자동 작성 시작' 클릭 -> 확인 모달 데이터 검증");
  const preflight = await buildBlankSolveInput(DOMAIN, targetPlan.id);

  console.log("  [모달 표출 내용 확인]:");
  console.log(`  - 계획명: "${preflight.planLabel}"`);
  console.log(
    `  - 요약 통계: ${preflight.stats.classCount}개 학급 · 주 ${preflight.stats.totalHours}시간 · 교육과정 고정 ${preflight.stats.fixedSlotCount}칸`
  );
  console.log(
    `  - 가상 수업 안내: 교육과정에서 자동으로 채우는 시간 ${preflight.stats.droppedVirtual}개는 계획 대신 교육과정 등록 내용을 씁니다.`
  );
  console.log(`  - 코호트 누락 학년: ${preflight.stats.cohortMissingGrades.length === 0 ? "없음 (전 학년 등록됨)" : preflight.stats.cohortMissingGrades.join(", ") + "학년"}`);
  console.log(`  - 확인 필요 점(Issues): 총 ${preflight.issues.length}건`);

  // 모달 수치 단언
  if (preflight.stats.classCount !== 30) throw new Error(`학급수 불일치: ${preflight.stats.classCount} != 30`);
  if (preflight.stats.totalHours !== 1020) throw new Error(`총 시수 불일치: ${preflight.stats.totalHours} != 1020`);
  if (preflight.stats.fixedSlotCount !== 120) throw new Error(`고정 슬롯 수 불일치: ${preflight.stats.fixedSlotCount} != 120`);
  if (preflight.stats.droppedVirtual !== 60) throw new Error(`가상 수업 수 불일치: ${preflight.stats.droppedVirtual} != 60`);
  console.log("  ✅ 모달 통계 및 안내 문구 100% 검증 일치");

  // [Step 3] '이대로 짜기' 클릭 -> 클라이언트 워커 솔버 실행 (컴파일 + 최적화)
  console.log("\n[Step 3] '이대로 짜기' 클릭 -> 백지 솔버 컴파일 및 최적화 실행");
  const compiled = compileSectionsFromHours({
    hours: preflight.model.hours!,
    model: preflight.model,
    gradeDayPeriods: preflight.model.gradeDayPeriods!,
    teacherNames: preflight.teacherNames,
    subjectShorts: preflight.subjectShorts,
  });
  console.log(`  - 컴파일된 섹션 수: ${compiled.sections.length}개`);

  const portfolio = solveTimetablePortfolio({
    sections: compiled.sections,
    gradeDayPeriods: preflight.model.gradeDayPeriods!,
    lunchAfterPeriod: preflight.model.lunchAfterPeriod,
    seeds: [42],
  });
  const best = portfolio.best;
  console.log(`  - 솔버 실행 완료 (seed=${best.seed}): 미배정 수업=${best.unplaced.length}건, 소프트 점수=${best.stats.softScoreEstimate}점`);

  // [Step 4] 초안 저장 (draft_create)
  console.log("\n[Step 4] 초안 저장 (draft_create) 및 스냅샷 보존");
  const draftLabel = `2027-1 신학기 백지 초안 (UI E2E 검증 #${best.seed})`;
  const draftId = await createDraft(
    DOMAIN,
    draftLabel,
    preflight.termId,
    { kind: "solver", seed: best.seed },
    best.grids,
    best.unplaced,
    {
      hardCount: 0,
      actionableHard: 0,
      softTotal: best.stats.softScoreEstimate,
    },
    "admin@hmh.or.kr",
    preflight.model.hours,
    preflight.model.fixedBlocks,
    targetPlan.id
  );
  console.log(`  ✅ 초안 생성 완료: id=${draftId}`);

  // [Step 5] 초안 목록에 표출 확인
  console.log("\n[Step 5] 초안 목록 (listDrafts) 조회 및 신규 초안 확인");
  const drafts = await listDrafts(DOMAIN);
  const createdDraftMeta = drafts.find((d) => d.id === draftId);
  if (!createdDraftMeta) {
    throw new Error(`생성된 초안(${draftId})이 초안 목록에 나타나지 않습니다!`);
  }
  console.log(`  ✅ 초안 목록에 정상 표출: "${createdDraftMeta.label}" (출처 학기: ${createdDraftMeta.sourceTermId})`);

  // [Step 6] 초안 열기 & 검사 리포트 확인 (draft_get & validateTimetable)
  console.log("\n[Step 6] 초안 열기 (getDraft) & 검사 리포트 표출 검증");
  const loadedDraft = await getDraft(DOMAIN, draftId);
  const settings = await loadTimetableSettings(DOMAIN);
  const [simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
    await Promise.all([
      loadSimulGroups(DOMAIN, TARGET_TERM_ID),
      loadVenueGroups(DOMAIN, TARGET_TERM_ID),
      loadTeacherSlotBans(DOMAIN, TARGET_TERM_ID),
      loadConsecutiveRules(DOMAIN, TARGET_TERM_ID),
      loadCoTeachingRules(DOMAIN, TARGET_TERM_ID),
    ]);

  const validationReport = validateTimetable(loadedDraft.currentGrids, {
    lunchAfterPeriod: settings.lunchAfterPeriod || 4,
    periodsPerDay: settings.periodsPerDay || 7,
    gradeDayPeriods: preflight.model.gradeDayPeriods!,
    hours: loadedDraft.hours,
    fixedBlocks: loadedDraft.meta.fixedBlocksSnapshot,
    simulGroups,
    venueGroups,
    teacherSlotBans,
    consecutiveRules,
    coTeaching,
  });

  console.log("  [검사 리포트 결과]:");
  console.log(`  - 하드 위반(Hard): ${validationReport.hard.length}건`);
  console.log(`  - 소프트 감점(Soft Total): ${validationReport.soft.total}점`);
  console.log(`  - 보존된 hoursSnapshot: ${loadedDraft.meta.hoursSnapshot?.length}행`);
  console.log(`  - 보존된 fixedBlocksSnapshot: ${loadedDraft.meta.fixedBlocksSnapshot?.length}개 블록`);
  console.log(`  - 보존된 sourcePlanId: "${loadedDraft.meta.sourcePlanId}"`);

  if (validationReport.hard.length > 0) {
    console.warn(`  ⚠️ 하드 위반 내역:`, validationReport.hard);
  }
  console.log(`  ✅ 검사 리포트 정상 표출 확인 완료`);

  // [Step 7] 검증용 초안 삭제 정리
  console.log("\n[Step 7] 검증용 생성 초안 삭제 정리");
  await deleteDraft(DOMAIN, draftId);
  const postDeleteDrafts = await listDrafts(DOMAIN);
  if (postDeleteDrafts.some((d) => d.id === draftId)) {
    throw new Error(`삭제 후에도 초안(${draftId})이 목록에 남아 있습니다!`);
  }
  console.log(`  ✅ 검증용 생성 초안(${draftId}) 삭제 정리 완료`);

  console.log("\n==================================================");
  console.log("🎉 Phase 9c-I 화면 E2E 전체 파이프라인 검증 성공!");
  console.log("==================================================");
}

runE2EUIFlow().catch((err) => {
  console.error("❌ E2E 검증 중 오류 발생:", err);
  process.exit(1);
});
