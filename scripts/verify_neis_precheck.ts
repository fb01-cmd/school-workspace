/**
 * Phase 9c-F 사전 검증 실데이터 실측 (phase9c_f_spec §7) — 2026-2 실시간표 대상.
 *
 * 사용법: npx tsx --env-file=.env.local scripts/verify_neis_precheck.ts
 *
 * 읽기 전용 (Firestore 쓰기 0건). 읽기량: settings 1 + term 1 + 학급 그리드 ~30 + 등록부 1.
 *
 * 판정 기준:
 *  - 빈 등록부(또는 현재 저장분)에서 B1 목록 = 실사용 과목 전수와 일치해야 검출 능력 입증.
 *  - 전 과목을 플랫폼명 그대로 시드한 가상 등록부(메모리)로 재실행 → B1 = 0 (소거 확인).
 *  - W1 가상 교사 목록 = 창체·SLAT 계열 자리표시 이름과 일치.
 */
import {
  computeNeisPrecheck,
  loadActiveTerm,
  loadNeisMapRegistry,
  loadAllClassGrids,
} from "../src/lib/timetable/server";
import { buildNeisPrecheckReport } from "../src/lib/timetable/neis";
import { NeisMapRegistry } from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";

async function main() {
  const term = await loadActiveTerm(DOMAIN);
  if (!term) {
    console.error("활성 학기가 없습니다.");
    process.exit(1);
  }
  console.log(`대상 학기: ${term.id} (${term.name}) — 과목 ${term.subjects.length}종`);

  // 1) 현재 저장된 등록부 기준 실측 (서버 경로 그대로)
  const { report, target } = await computeNeisPrecheck(DOMAIN, { termId: term.id });
  console.log(`\n── 현행 등록부 기준 (${target.label}) ──`);
  console.log(
    `summary: 학급 ${report.summary.classes} · 수업 ${report.summary.lessons} · 과목 ${report.summary.subjects}(매핑 ${report.summary.mappedSubjects}) · 실교사 ${report.summary.teachers}(확인 ${report.summary.confirmedTeachers}) · 담당 ${report.summary.pairs}(확인 ${report.summary.confirmedPairs})`
  );
  console.log(`readyForExport: ${report.readyForExport}`);
  console.log(`B1 미확정 과목 ${report.blockers.unmappedSubjects.length}종:`);
  for (const s of report.blockers.unmappedSubjects) console.log(`  - ${s.text}`);
  console.log(`W1 가상 교사 ${report.warnings.virtualLessons.length}건:`);
  for (const v of report.warnings.virtualLessons) console.log(`  - ${v.text}`);
  console.log(
    `W2 교원 미확인 ${report.warnings.unconfirmedTeachers.length}명 · W3 담당 미확인 ${report.warnings.unconfirmedPairs.length}건 (목록 생략)`
  );

  // 검출 능력 검증: 등록부의 확정 매핑 수 + B1 수 = 그리드 실사용 과목 수
  const registry = await loadNeisMapRegistry(DOMAIN);
  const check1 =
    report.summary.mappedSubjects + report.blockers.unmappedSubjects.length ===
    report.summary.subjects;
  console.log(`\n[판정] 매핑+미확정 = 실사용 과목 전수: ${check1 ? "✅" : "❌"}`);

  // 2) 가상 시드(메모리 — 저장 안 함): 그리드 실사용 과목 전부를 플랫폼명 그대로 매핑 → B1 = 0
  const grids = await loadAllClassGrids(DOMAIN, term.id);
  const usedNames = new Set<string>();
  for (const g of grids)
    for (const c of g.cells) for (const l of c.lessons) usedNames.add(l.subjectName.trim());
  const seeded: NeisMapRegistry = {
    subjects: Array.from(usedNames).map((n) => ({ platformName: n, neisName: n })),
    confirmedTeachers: registry.confirmedTeachers,
    confirmedPairs: registry.confirmedPairs,
  };
  const seededReport = buildNeisPrecheckReport(grids, seeded);
  const check2 = seededReport.blockers.unmappedSubjects.length === 0 && seededReport.readyForExport;
  console.log(`[판정] 전 과목 시드 시 B1=0·readyForExport: ${check2 ? "✅" : "❌"}`);

  process.exit(check1 && check2 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
