/**
 * 시수표 자동 생성 엔진 셀프테스트 (2026-08-16) — 저장소 루트의 실물 3파일 사용.
 *
 * [0] PDF 텍스트 층 추출 — 부서 8개 분할(생활교양과 별도 양식 포함)·자릿수 헤더 실재 (pdfjs가 pdftotext 근사를 내는가)
 * [1] 가명화 커버리지 — AI로 나가는 텍스트에 로스터 실명 잔존 0 (개인정보 게이트)
 * [2] 창체 결정론 파서 — 30반 담당 + 낡은 제목 함정(2025-1) 검출
 * [3] Gemini 추출(전 7부서) → 결정론 교차 검증 — 부서별 제목 합 = 개인 합
 * [5] 이동수업 xlsx 결정론 파스 + 검출 4  [6] 창체 대조 + 조립·이메일 매칭
 * [4] 주입 오류 검출 — 셀 하나를 일부러 틀리게 바꾸면 검증기가 잡아야 한다 (그물 실증)
 *
 * Gemini 호출 수: 부서 2개 × (1~2회) — 무료 한도 내. 쓰기 0 (읽기·API 호출만).
 */
import { readFileSync } from "fs";
import {
  extractPdfLayoutPages,
  splitDeptChunks,
  parseHeaderTotals,
  parseCreativeGrid,
  parseSimulStatusXlsx,
  validateDept,
  validateTitleSemester,
  validateCreative,
  validateSimulStatus,
  assembleHoursRows,
} from "../src/lib/timetable/hoursAssignment";
import { ExtractedAssignmentDept } from "../src/lib/timetable/ai";
import { runAssignmentExtract, buildPseudonymizer, AiTeacherRef } from "../src/lib/timetable/ai";
import { adminDb } from "../src/lib/firebase/admin";

const ASSIGN_PDF = "2026학년도 과목별 배정표_2학기.pdf";
const CREATIVE_PDF = "2026학년도 2학기 창체 수업 담당교사.pdf";
const SIMUL_XLSX = "이동수업 현황(2학년2학기) (1).xlsx";

async function loadRoster(): Promise<AiTeacherRef[]> {
  const snap = await adminDb.collection("teacher_profiles").get();
  const out: AiTeacherRef[] = [];
  snap.docs.forEach((d) => {
    const name = (d.data().name || "").trim();
    if (name) out.push({ name, email: d.id });
  });
  return out;
}

async function main() {
  let failed = false;

  // [0] 추출·분할
  const pages = await extractPdfLayoutPages(new Uint8Array(readFileSync(ASSIGN_PDF)));
  const chunks = splitDeptChunks(pages);
  const headerOk = chunks.every((c) => /1\s+2\s+3\s+4\s+5\s+6\s+7\s+8\s+9\s+10/.test(c.text));
  console.log(
    `[0] 추출·분할 ${chunks.length === 8 && headerOk ? "✅" : "❌"} — 부서 ${chunks.length}개(기대 8 — 생활교양과 포함) · 반 번호 헤더 전 부서 실재 ${headerOk ? "✅" : "❌"}`
  );
  console.log(`    부서: ${chunks.map((c) => c.dept).join(" · ")}`);
  if (chunks.length !== 8 || !headerOk) failed = true;

  // [1] 가명화 커버리지 — 로스터의 어떤 실명도 마스킹 후 텍스트에 남으면 안 된다
  const roster = await loadRoster();
  const p = buildPseudonymizer(roster);
  const residual = new Set<string>();
  for (const c of chunks) {
    const masked = p.mask(c.text);
    for (const t of roster) if (t.name && masked.includes(t.name)) residual.add(t.name);
  }
  console.log(
    `[1] 가명화 커버리지 ${residual.size === 0 ? "✅" : "❌"} — 로스터 ${roster.length}명, 마스킹 후 실명 잔존 ${residual.size}건${residual.size ? ` (${[...residual].slice(0, 5).join(",")})` : ""}`
  );
  if (residual.size) failed = true;
  // 로스터 밖 인명(전출자 등) 잔존 가능성 — 마스킹 후 남은 2~4자 한글 토큰 중 T## 아닌 것을 보고만 한다
  const suspect = new Set<string>();
  for (const c of chunks) {
    const masked = p.mask(c.text);
    for (const line of masked.split("\n"))
      if (/[가-힣]{2,4}\s*,/.test(line)) // 명단 줄 패턴("A, B, C / D")만 표적
        for (const tok of line.match(/[가-힣]{2,4}/g) || [])
          if (!/과목|배정|시간|학년|창체|비고|교사|합계/.test(tok)) suspect.add(tok);
  }
  console.log(`    (참고) 명단 줄의 미마스킹 한글 토큰 ${suspect.size}건: ${[...suspect].slice(0, 8).join(", ") || "없음"}`);

  // [2] 창체 결정론 파서 + 낡은 제목 함정
  const cPages = await extractPdfLayoutPages(new Uint8Array(readFileSync(CREATIVE_PDF)));
  const creative = parseCreativeGrid(cPages.join("\n"));
  const staleIssues = validateTitleSemester(creative.title, { year: 2026, semester: 2 }, "창체 담당 파일");
  console.log(
    `[2] 창체 파서 ${creative.byClass.size === 30 ? "✅" : "❌"} — 담당 ${creative.byClass.size}반(기대 30) · 낡은 제목 검출 ${staleIssues.length === 1 ? "✅" : "❌"} ${staleIssues[0]?.text ? `("${staleIssues[0].text.slice(0, 40)}…")` : ""}`
  );
  if (creative.byClass.size !== 30 || staleIssues.length !== 1) failed = true;

  // [3] Gemini 추출 — 국어·수학 (알려진 진실: 국어 113+창체5·한문 15 / 수학 127 삼중 일치)
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    console.log("[3] GEMINI_API_KEY 없음 — AI 추출 미실행 (미검증)");
    process.exit(1);
  }
  const extracted: ExtractedAssignmentDept[] = [];
  for (const chunk of chunks) {
    const target = chunk.dept;
    const d = await runAssignmentExtract(chunk, roster, apiKey);
    extracted.push(d);
    const all = validateDept(d);
    const issues = all.filter((i) => i.severity === "error"); // notice(분담 배정 등)는 실데이터 실재 — 실패 아님
    const notices = all.length - issues.length;
    const headerTotals = parseHeaderTotals(d.headerLine);
    const personalSum = d.personalRows
      .filter((r) => r.subject !== "창체")
      .reduce((s, r) => s + r.cells.reduce((x, c) => x + c.hours, 0), 0);
    const headerSum = headerTotals.reduce((s, t) => s + t.hours, 0);
    const aliasLeak = d.personalRows.some((r) => /^T\d{2,}$/.test(r.teacher));
    console.log(
      `[3-${target}] 추출 ${issues.length === 0 && headerSum === personalSum && !aliasLeak ? "✅" : "❌"} — ` +
        `개인 행 ${d.personalRows.length}·격자 행 ${d.gridRows.length} · 제목 합 ${headerSum} = 개인 합 ${personalSum} ${headerSum === personalSum ? "✅" : "❌"} · ` +
        `교차 검증 오류 ${issues.length}건(고지 ${notices}건 별도) · 미해석 가명 ${aliasLeak ? "있음 ❌" : "없음 ✅"}`
    );
    for (const i of issues.slice(0, 5)) console.log(`      · [${i.code}] ${i.text}`);
    if (issues.length || headerSum !== personalSum || aliasLeak) failed = true;

    // [4] 주입 오류 — 첫 개인 행 첫 셀에 +1 → grid-vs-personal이 반드시 떠야 한다
    if (target.includes("수학") && d.personalRows[0]?.cells[0]) {
      const mutated = JSON.parse(JSON.stringify(d));
      mutated.personalRows[0].cells[0].hours += 1;
      const caught = validateDept(mutated).some((i) => i.code === "grid-vs-personal" || i.code === "row-note-mismatch");
      console.log(`[4] 주입 오류 검출 ${caught ? "✅" : "❌"} — 셀 +1 조작이 교차 검증에 걸림`);
      if (!caught) failed = true;
    }
  }

  // [5] 이동수업 현황(2학년) — 결정론 파스 + 검출 4 대조
  const status = parseSimulStatusXlsx(readFileSync(SIMUL_XLSX));
  const statusIssues = validateSimulStatus(extracted, status);
  const statusErrors = statusIssues.filter((i) => i.severity === "error");
  console.log(
    `[5] 이동수업 대조 — ${status.grade}학년 묶음 ${status.entries.length}건 파스 · 반 불일치(오류) ${statusErrors.length}건 · 이름 미대조(고지) ${statusIssues.length - statusErrors.length}건`
  );
  for (const e of status.entries.slice(0, 4)) console.log(`      · ${e.subject} (${e.classNums.join("·")}반)`);
  for (const i of statusIssues.slice(0, 6)) console.log(`      ! [${i.severity}] ${i.text.slice(0, 90)}`);
  if (status.grade !== 2 || status.entries.length < 4) failed = true; // 실물엔 밴드 5개 안팎이 실재해야

  // [6] 창체 대조(검출 3) + 조립·이메일 매칭
  const creativeIssues = validateCreative(extracted, creative);
  const asm = assembleHoursRows(
    extracted,
    creative,
    "진로",
    roster.map((t) => ({ name: t.name || "", email: t.email || "" }))
  );
  const rowsHours = asm.rows.reduce((s, r) => s + r.hours, 0);
  const matched = asm.rows.filter((r) => r.teacherEmail).length;
  console.log(
    `[6] 조립 — 배정표 행 ${asm.rows.length}건(${rowsHours}시간) + 창체 행 ${asm.creativeRows.length}건(별도) · ` +
      `이메일 매칭 ${matched}/${asm.rows.length} · 미매칭 성명 ${asm.unmatchedNames.length}명(${asm.unmatchedNames.slice(0, 6).join(",") || "없음"}) · 창체 대조 이슈 ${creativeIssues.length}건`
  );
  for (const i of creativeIssues.slice(0, 4)) console.log(`      ! ${i.text.slice(0, 90)}`);
  if (!asm.rows.length || asm.creativeRows.length !== 30) failed = true;

  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
