/**
 * Phase 9c-A 검증 실험 (phase9c_spec §3-3) — 현행 실시간표를 검사기에 통과시킨다.
 *
 * 사용법: npx tsx --env-file=.env.local scripts/validate_current_timetable.ts
 *
 * 읽기 전용 (Firestore 쓰기 0건). 읽기량: settings 1 + term 조회 + 학급 그리드 ~30 + 등록부 소량.
 *
 * 판정 기준 (§3-3):
 *  - 하드 위반 0 = 정상. 위반이 나오면 제약 모델이 틀렸거나 등록부 데이터가 불완전한 것
 *    (컴시간 산출물이 그라운드 트루스). registryGap 표시 위반 = 9월 질문지·등재 후보.
 *  - 소프트 총점 = 컴시간 품질 기준선 → 이후 솔버 산출물이 이길 목표치.
 *  - 이번 실행의 시수표·요일별 교시수는 그리드 역산값(자기 일관 검사) — H1·H4·H11은
 *    독립 시수표가 들어오는 신학기 입력 단계부터 실질 검증력이 생긴다.
 */
import {
  loadActiveTerm,
  loadAllClassGrids,
  loadSimulGroups,
  loadTimetableSettings,
  loadVenueGroups,
} from "../src/lib/timetable/server";
import {
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  validateTimetable,
} from "../src/lib/timetable/validate";
import { HardViolation, TimetableConstraintModel } from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";
const DAY_LABEL = ["", "월", "화", "수", "목", "금"];

async function main() {
  const settings = await loadTimetableSettings(DOMAIN);
  const term = await loadActiveTerm(DOMAIN);
  if (!term) {
    console.error("활성 학기가 없습니다.");
    process.exit(1);
  }
  console.log(`학기: ${term.id} (${term.name})`);
  const [grids, simulGroups, venueGroups] = await Promise.all([
    loadAllClassGrids(DOMAIN, term.id),
    loadSimulGroups(DOMAIN, term.id),
    loadVenueGroups(DOMAIN, term.id),
  ]);
  console.log(
    `그리드 ${grids.length}학급 / 동시수업 등록부 ${simulGroups.length}건 / 특별실 등록부 ${venueGroups.length}건`
  );

  const gradeDayPeriods = deriveGradeDayPeriods(grids);
  const hours = deriveHoursFromGrids(grids);
  console.log(`역산 시수표 ${hours.length}행 (teacher×subject×class)`);
  for (const [grade, byDay] of Object.entries(gradeDayPeriods)) {
    const row = [1, 2, 3, 4, 5].map((d) => `${DAY_LABEL[d]}${byDay[d] || 0}`).join(" ");
    console.log(`  ${grade}학년 요일별 교시수: ${row}`);
  }

  const model: TimetableConstraintModel = {
    lunchAfterPeriod: settings.lunchAfterPeriod,
    periodsPerDay: settings.periodsPerDay,
    gradeDayPeriods,
    hours,
    simulGroups,
    venueGroups,
    // 아직 등록부가 없는 제약 4종 — 비어 있으면 해당 검사는 통과 (9월 질문지로 수집 예정)
    teacherSlotBans: [],
    fixedBlocks: [],
    consecutiveRules: [],
    coTeaching: [],
  };

  const report = validateTimetable(grids, model);

  console.log("\n══ 하드 위반 ══");
  const actionable = report.hard.filter((v) => !v.registryGap);
  const gaps = report.hard.filter((v) => v.registryGap);
  console.log(
    `총 ${report.hard.length}건 = 조치 대상 ${actionable.length}건 + 등록부 미비 추정 ${gaps.length}건`
  );
  console.log(
    `코드별: ${Object.entries(report.summary.hardByCode).map(([c, n]) => `${c}=${n}`).join(" ") || "없음"}`
  );
  const printViolations = (list: HardViolation[], title: string) => {
    if (!list.length) return;
    console.log(`\n— ${title} —`);
    for (const v of list) console.log(`  [${v.code}] ${v.text}${v.hint ? `\n        ↳ ${v.hint}` : ""}`);
  };
  printViolations(actionable, "조치 대상 (하드 0 목표의 분자)");
  printViolations(gaps, "등록부 미비 추정 (질문지·등재 후보 — §3-4 접힘 대상)");

  console.log("\n══ 소프트 감점 (컴시간 품질 기준선) ══");
  console.log(`총점: ${report.soft.total}점`);
  console.log(
    `코드별: ${Object.entries(report.soft.byCode).map(([c, n]) => `${c}=${n}`).join(" ") || "없음"}`
  );
  const byKey = new Map<string, { label: string; points: number }>();
  for (const d of report.soft.details) {
    const cur = byKey.get(d.key);
    if (cur) cur.points += d.points;
    else byKey.set(d.key, { label: d.label, points: d.points });
  }
  const top = [...byKey.values()].sort((a, b) => b.points - a.points).slice(0, 10);
  console.log("감점 상위 10 (교사/학급):");
  for (const t of top) console.log(`  ${t.label}: ${t.points}점`);
  console.log("\n감점 상세 상위 20:");
  for (const d of report.soft.details.slice(0, 20))
    console.log(`  [${d.code}] ${d.text} (${d.points}점)`);

  console.log("\n══ 요약 ══");
  console.log(
    `학급 ${report.summary.classes} / 수업 ${report.summary.lessons} / 실교사 ${report.summary.teachers}`
  );
  console.log(
    report.summary.actionableHard === 0
      ? "✅ 조치 대상 하드 위반 0 — 검사기·제약 모델이 현행 시간표와 정합"
      : `❌ 조치 대상 하드 위반 ${report.summary.actionableHard}건 — 제약 모델 또는 데이터 점검 필요`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
