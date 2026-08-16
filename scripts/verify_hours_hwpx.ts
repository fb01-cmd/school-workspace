/**
 * 배정표 hwpx 결정론 파이프라인 셀프테스트 (PDF+AI 경로 폐지 후속 — 2026-08-16)
 *
 * 실행: npx tsx --env-file=.env.local scripts/verify_hours_hwpx.ts
 * 재료: docs/의 실물 hwpx 2종 + 이동수업 xlsx 2종 (저장소 미추적 — 로컬 전용)
 */
import { readFileSync } from "fs";
import { parseAssignmentHwpx, creativeHwpxToText } from "../src/lib/timetable/hwpxAssignment";
import {
  validateDept,
  validateCreative,
  validateSimulStatus,
  parseCreativeGrid,
  parseHeaderTotals,
  parseSimulStatusXlsx,
  assembleHoursRows,
} from "../src/lib/timetable/hoursAssignment";
import { loadTeacherNameRoster } from "../src/lib/timetable/server";

const ok = (b: boolean) => (b ? "✅" : "❌");
const ASSIGN = "docs/2026학년도 과목별 배정표_2학기.hwpx";
const CREATIVE = "docs/2026학년도 2학기 창체 수업 담당교사.hwpx";

async function main() {
  // [0] 파싱 — 부서 8·전 부서 검증 오류 0
  const parsed = await parseAssignmentHwpx(readFileSync(ASSIGN));
  let errTotal = 0;
  for (const d of parsed.depts) {
    const errs = validateDept(d).filter((i) => i.severity === "error");
    errTotal += errs.length;
    if (errs.length) console.log(`    · [${d.dept}]`, errs.map((e) => e.text.slice(0, 70)));
  }
  console.log(
    `[0] 파싱·검증 ${ok(parsed.depts.length === 8 && errTotal === 0)} — 부서 ${parsed.depts.length}개(기대 8) · 검증 오류 ${errTotal}건(기대 0) · 제목 "${parsed.title.trim().slice(0, 24)}"`
  );

  // [1] 학년 오독 소멸 — 문화 과목은 3학년 칸에만 (PDF 시절 2학년 밀림 실사고의 회귀 감시)
  const cult = parsed.depts.flatMap((d) => d.personalRows).filter((r) => /문화/.test(r.subject));
  const cultOk = cult.length === 2 && cult.every((r) => r.cells.every((c) => c.grade === 3));
  console.log(
    `[1] 학년 열 판정 ${ok(cultOk)} — ${cult.map((r) => `${r.subject}(${r.teacher}): ${r.cells.map((c) => `${c.grade}-${c.classNum}`).join(",")}`).join(" · ")}`
  );

  // [2] 부서 제목 총시간 ↔ 개인표 합 (검증 2 재료가 문단에서 온전히 왔는지)
  const totalsOk = parsed.depts.every((d) => {
    const t = parseHeaderTotals(d.headerLine).reduce((s, x) => s + x.hours, 0);
    const p = d.personalRows.filter((r) => r.subject !== "창체").reduce((s, r) => s + r.cells.reduce((a, c) => a + c.hours, 0), 0);
    return t === 0 || t === p;
  });
  console.log(`[2] 제목 총시간 대조 ${ok(totalsOk)} — 8부서 전부 제목 합 = 개인표 합`);

  // [3] 창체 파일 — 30반 + 낡은 제목 검출
  const cText = await creativeHwpxToText(readFileSync(CREATIVE));
  const cg = parseCreativeGrid(cText);
  const creativeIssues = validateCreative(parsed.depts, cg);
  console.log(`[3] 창체 ${ok(cg.byClass.size === 30)} — 담당 ${cg.byClass.size}반(기대 30) · 배정표 대조 이슈 ${creativeIssues.length}건`);

  // [4] 주입 오류 검출 — 셀 하나를 +1 조작하면 그물에 걸려야 한다 (그물 자체의 회귀 감시)
  const mutated = JSON.parse(JSON.stringify(parsed.depts[0]));
  const victim = mutated.personalRows.find((r: { cells: unknown[] }) => r.cells.length);
  victim.cells[0].hours += 1;
  const caught = validateDept(mutated).filter((i) => i.severity === "error").length > 0;
  console.log(`[4] 주입 오류 검출 ${ok(caught)} — 셀 +1 조작이 교차 검증에 걸림`);

  // [5] 이동수업 대조 — 실물 2파일 + 학년 오독 검출 회귀 (지금 데이터는 전부 정상이어야 함)
  const simulEntries = [
    ...parseSimulStatusXlsx(readFileSync("docs/이동수업_현황_원본_2학년_2026-2.xlsx")).entries,
    ...parseSimulStatusXlsx(readFileSync("docs/이동수업_현황_원본_3학년_2026-1학기표.xlsx")).entries,
  ];
  const sIssues = validateSimulStatus(parsed.depts, { entries: simulEntries });
  const misplaced = sIssues.filter((i) => i.code === "grade-misplacement");
  console.log(
    `[5] 이동수업 대조 ${ok(misplaced.length === 0)} — 학년 오독 ${misplaced.length}건(기대 0 — hwpx로 소멸) · 고지 ${sIssues.length}건`
  );

  // [6] 조립 + 실명 매칭 (Firestore 로스터 — 가명화 없이 실명 직결)
  const roster = await loadTeacherNameRoster("hmh.or.kr");
  const asm = assembleHoursRows(parsed.depts, cg, "창체", roster);
  const unmatched = asm.rows.filter((r) => !r.teacherEmail).length;
  console.log(
    `[6] 조립 ${ok(unmatched === 0 && asm.rows.length > 300)} — 배정표 행 ${asm.rows.length}건 · 창체 행 ${asm.creativeRows.length}건 · 미매칭 ${unmatched}명(기대 0)`
  );

  // [7] 병기 과목 — 격자 병기 표기가 구조로 감지되는가
  const slashed = parsed.depts.flatMap((d) => d.gridRows).filter((r) => r.subject.includes("/"));
  console.log(`[7] 병기 과목 감지 ${ok(slashed.length >= 1)} — ${slashed.length}건 ("${slashed[0]?.subject || ""}")`);
}

main()
  .catch((e) => {
    console.error("ERR", e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 400));
