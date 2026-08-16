/**
 * 파이프라인 산출 vs 일과계 최종 시수표(2026-2.xls) 전수 대조 (2026-08-16)
 * — "일과계가 3파일 위에 무엇을 더 얹었는가"를 추측이 아니라 목록으로 뽑는다.
 * 대조 축: (학년-반, 정규화 과목, 교사) → 시수. AI 8콜 + 읽기 전용.
 */
import { readFileSync } from "fs";
import { extractPdfLayoutPages, splitDeptChunks, parseCreativeGrid, assembleHoursRows } from "../src/lib/timetable/hoursAssignment";
import { runAssignmentExtract, AiTeacherRef } from "../src/lib/timetable/ai";
import { parseHoursExcel } from "../src/lib/timetable/excelHoursParser";
import { adminDb } from "../src/lib/firebase/admin";
import { loadTimetableSettings, loadAllClassGrids } from "../src/lib/timetable/server";

const norm = (s: string) => s.replace(/\s+/g, "").replace(/학(?=[ⅠⅡⅢ])/g, "");

async function main() {
  // 로스터 (시간표 실쌍 우선)
  const out = new Map<string, AiTeacherRef>();
  const add = (name: string, email: string) => {
    const n = (name || "").trim();
    if (!n || !/^[가-힣]{2,5}(쌤)?$/.test(n.replace(/\s/g, ""))) return;
    const key = `${n}|${email.toLowerCase()}`;
    if (!out.has(key)) out.set(key, { name: n, email: email.toLowerCase() });
  };
  const settings = await loadTimetableSettings("hmh.or.kr");
  const grids = await loadAllClassGrids("hmh.or.kr", settings.activeTermId!);
  for (const g of grids) for (const c of g.cells) for (const l of c.lessons || []) for (const t of l.teachers || []) if (t.email) add(t.name, t.email);
  (await adminDb.collection("teacher_profiles").get()).docs.forEach((d) => add(d.data().name || "", d.id));
  const roster = [...out.values()];

  // ① 파이프라인 산출
  const pages = await extractPdfLayoutPages(new Uint8Array(readFileSync("2026학년도 과목별 배정표_2학기.pdf")));
  const chunks = splitDeptChunks(pages);
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const depts = [];
  for (const c of chunks) depts.push(await runAssignmentExtract(c, roster, apiKey));
  const cPages = await extractPdfLayoutPages(new Uint8Array(readFileSync("2026학년도 2학기 창체 수업 담당교사.pdf")));
  const creative = parseCreativeGrid(cPages.join("\n"));
  const asm = assembleHoursRows(depts, creative, "진로", roster.map((t) => ({ name: t.name || "", email: t.email || "" })));

  // ② 최종 시수표
  const final = parseHoursExcel(readFileSync("2026-2.xls"));
  console.log(`파이프라인: 배정표 ${asm.rows.length}행 + 창체 ${asm.creativeRows.length}행 | 최종 시수표: ${final.rows.length}행 (총 ${final.grandTotal}시간)`);

  // 대조 맵: key = grade-class|과목|교사
  type Cell = { hours: number };
  const ours = new Map<string, number>();
  for (const r of [...asm.rows, ...asm.creativeRows])
    ours.set(`${r.grade}-${r.classNum}|${norm(r.subjectName)}|${r.teacherName}`, (ours.get(`${r.grade}-${r.classNum}|${norm(r.subjectName)}|${r.teacherName}`) || 0) + r.hours);
  const theirs = new Map<string, number>();
  for (const r of final.rows)
    for (const c of r.classHours)
      theirs.set(`${c.grade}-${c.classNum}|${norm(r.subjectName)}|${r.teacherName}`, (theirs.get(`${c.grade}-${c.classNum}|${norm(r.subjectName)}|${r.teacherName}`) || 0) + c.hours);

  const onlyTheirs = new Map<string, number>(); // 일과계가 "더 얹은" 것
  const onlyOurs = new Map<string, number>();
  let bothDiff = 0, same = 0;
  for (const [k, v] of theirs) {
    const o = ours.get(k);
    if (o == null) onlyTheirs.set(k, v);
    else if (o !== v) bothDiff++;
    else same++;
  }
  for (const [k, v] of ours) if (!theirs.has(k)) onlyOurs.set(k, v);

  console.log(`\n일치 ${same} · 시수만 다름 ${bothDiff} · 최종본에만 있음 ${onlyTheirs.size} · 우리 산출에만 있음 ${onlyOurs.size}`);

  // "더 얹은 것"을 과목별로 묶어 보고
  const groupBy = (m: Map<string, number>) => {
    const g = new Map<string, { count: number; hours: number; teachers: Set<string> }>();
    for (const [k, v] of m) {
      const [, subj, teacher] = k.split("|");
      const e = g.get(subj) || { count: 0, hours: 0, teachers: new Set() };
      e.count++; e.hours += v; e.teachers.add(teacher);
      g.set(subj, e);
    }
    return [...g.entries()].sort((a, b) => b[1].hours - a[1].hours);
  };
  console.log("\n── 최종본에만 있는 것 (일과계가 더 얹은 후보) ──");
  for (const [subj, e] of groupBy(onlyTheirs).slice(0, 15))
    console.log(`  ${subj}: ${e.count}칸 ${e.hours}시간 (${[...e.teachers].slice(0, 4).join(",")}${e.teachers.size > 4 ? "…" : ""})`);
  console.log("\n── 우리 산출에만 있는 것 (최종본에서 빠지거나 우리가 과추출) ──");
  for (const [subj, e] of groupBy(onlyOurs).slice(0, 15))
    console.log(`  ${subj}: ${e.count}칸 ${e.hours}시간 (${[...e.teachers].slice(0, 4).join(",")}${e.teachers.size > 4 ? "…" : ""})`);

  // 반별 합계 대조 (최종본은 34에 맞는가)
  const classSum = (m: Map<string, number>) => {
    const s = new Map<string, number>();
    for (const [k, v] of m) { const cls = k.split("|")[0]; s.set(cls, (s.get(cls) || 0) + v); }
    return s;
  };
  const fs = classSum(theirs);
  const mismatch = [...fs.entries()].filter(([, v]) => v !== 34);
  console.log(`\n최종 시수표의 반별 합계: 34시간 아닌 반 ${mismatch.length}개${mismatch.length ? ` (${mismatch.slice(0, 6).map(([k, v]) => `${k}=${v}`).join(", ")}…)` : " — 전 반 34 정합"}`);
  process.exit(0);
}
main().catch((e) => { console.error("실패:", e.message); process.exit(1); });
