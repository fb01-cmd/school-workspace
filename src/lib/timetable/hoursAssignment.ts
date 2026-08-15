/**
 * 교사별 시수표 자동 생성 — 상류 3파일 파이프라인 (hours_source_files_analysis §2·§4·§5ⓓ)
 *
 * 구조:
 *   배정표 PDF → 텍스트 층 추출(pdfjs, 로컬) → 가명화(ai.ts Pseudonymizer) → Gemini 구조화(E5)
 *   → 역치환 → **결정론 교차 검증(§4의 1·2·5·6)** → 창체·이동수업 대조(3·4) → HoursPlan 행 조립.
 *
 * 원칙 (9c-D 철칙): AI는 추출만 한다. 숫자의 진실성은 이 파일의 검증기가 판정하며,
 * 검증을 통과하지 못한 추출은 반영되지 않고 불일치 목록으로 사람에게 보인다.
 * 실명 PDF를 AI에 직접 보내지 않는다 — 텍스트 추출·가명화는 항상 서버 로컬에서.
 */

import { ExtractedAssignmentDept, ExtractedHourCell } from "./ai";

// ── 1. PDF 텍스트 층 추출 (레이아웃 보존) ─────────────────────

/**
 * pdfjs 텍스트 항목을 줄·열 정렬 텍스트로 재구성한다.
 * 열 위치(어느 반 칸인가)가 의미를 갖는 표라서, 항목 사이 간격을 공백으로 환산해
 * pdftotext -layout과 같은 "고정폭 배치" 근사를 만든다 (실물 검증: verify_hours_assignment [0]).
 */
export async function extractPdfLayoutPages(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number; w: number };
    const items: Item[] = (content.items as Array<{ str: string; transform: number[]; width: number }>)
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
    // 줄 묶기: y가 가까운 항목(±3pt)을 한 줄로
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Item[][] = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last[0].y - it.y) <= 3) last.push(it);
      else lines.push([it]);
    }
    const rendered = lines.map((line) => {
      line.sort((a, b) => a.x - b.x);
      // 평균 글자폭으로 x → 열 환산 (한글 PDF 실측상 5~10pt/자 — 페이지별 평균 사용)
      const charW =
        line.reduce((s, i) => s + (i.str.length ? i.w / i.str.length : 0), 0) / line.length || 6;
      let out = "";
      for (const it of line) {
        const col = Math.max(0, Math.round(it.x / charW));
        if (col > out.length) out += " ".repeat(col - out.length);
        else if (out.length && !out.endsWith(" ")) out += " ";
        out += it.str;
      }
      return out;
    });
    pages.push(rendered.join("\n"));
  }
  await doc.cleanup();
  return pages;
}

// ── 2. 배정표 부서 단위 분할 ──────────────────────────────────

export interface DeptChunk {
  dept: string; // 격자표 제목의 부서명 (예: "국어", "(과학)")
  headerLine: string; // 개인 배정표 제목 줄 — 부서 총시간 파싱 재료 (검증 2)
  text: string; // 격자표+개인표 전체 텍스트 (가명화 전)
}

/** "과목별 배정표 : X" ~ 다음 "과목별 배정표 :" 직전까지를 한 부서로 자른다 */
export function splitDeptChunks(pages: string[]): DeptChunk[] {
  const all = pages.join("\n");
  const lines = all.split("\n");
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/과목별 배정표\s*:/.test(l) && !/개인 배정표/.test(l)) starts.push(i);
  });
  return starts.map((s, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    const chunk = lines.slice(s, end);
    const dept = (lines[s].match(/과목별 배정표\s*:\s*(.+)$/)?.[1] || "").trim();
    const headerLine = chunk.find((l) => /개인 배정표\s*:/.test(l)) || "";
    return { dept, headerLine, text: chunk.join("\n") };
  });
}

/** 개인 배정표 제목의 "국어 (113시간+창체5) / 한문 (15시간)" → [{label, hours, creative}] (검증 2 재료) */
export function parseHeaderTotals(
  headerLine: string
): Array<{ label: string; hours: number; creative: number }> {
  const body = headerLine.replace(/^.*개인 배정표\s*:\s*/, "");
  const out: Array<{ label: string; hours: number; creative: number }> = [];
  for (const m of body.matchAll(/([^/()]+)\(\s*(\d+)\s*(?:시간)?\s*(?:\+\s*창체\s*(\d+)\s*(?:시간)?)?\s*\)/g)) {
    out.push({ label: m[1].trim(), hours: Number(m[2]), creative: Number(m[3] || 0) });
  }
  return out;
}

// ── 3. 창체 담당 격자 — 결정론 파서 (AI 불요) ─────────────────

export interface CreativeGrid {
  /** 파일 내부 제목 원문 (검증 6 — 학기 낡음 함정의 실측 사례) */
  title: string;
  /** "grade-classNum" → 담당자 성명 */
  byClass: Map<string, string>;
}

/** "1반  김회선  조현영  최희라" 격자 — 열 순서 = 1·2·3학년 (실물 구조 §1-②) */
export function parseCreativeGrid(pageText: string): CreativeGrid {
  const lines = pageText.split("\n").map((l) => l.trim());
  const title = lines.find((l) => /창체|담당교사/.test(l)) || lines.find((l) => l) || "";
  const byClass = new Map<string, string>();
  for (const l of lines) {
    const m = l.match(/^(\d{1,2})반\s+(.+)$/);
    if (!m) continue;
    const classNum = Number(m[1]);
    const names = m[2].split(/\s+/).filter(Boolean);
    names.forEach((name, i) => {
      if (i < 3 && /^[가-힣]{2,4}$/.test(name)) byClass.set(`${i + 1}-${classNum}`, name);
    });
  }
  return { title, byClass };
}

// ── 4. 결정론 교차 검증 (분석 §4 — AI 오인식은 여기서 드러난다) ──

export interface AssignmentIssue {
  /** error = 반영 전 반드시 확인 / notice = 고지(실데이터에 실재하는 패턴 — 분담 배정 등) */
  severity: "error" | "notice";
  code:
    | "grid-vs-personal" // 1. 격자표 합 ≠ 개인표 합 (같은 쪽 두 표가 어긋남)
    | "row-note-mismatch" // 2a. 행 비고 총계 ≠ 셀 합
    | "dept-total-mismatch" // 2b. 부서 제목 총시간 ≠ 개인표 합
    | "creative-mismatch" // 3. 배정표 창체 반 ↔ 창체 파일 담당 반 불일치
    | "shared-assignment" // 5. 같은 반·같은 과목에 두 교사 — 실측상 분담(3+1시간 등)이 실재해 고지로 낮춤
    | "stale-title"; // 6. 문서 제목 학기 ≠ 대상 학기
  dept?: string;
  text: string;
}

const cellsSum = (cells: ExtractedHourCell[]) => cells.reduce((s, c) => s + c.hours, 0);
const cellKey = (c: ExtractedHourCell) => `${c.grade}-${c.classNum}`;

export function validateDept(d: ExtractedAssignmentDept): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  // 2a-격자. 격자표 행 비고 = 그 과목 총계
  for (const r of d.gridRows) {
    if (r.noteTotal != null && r.noteTotal !== cellsSum(r.cells)) {
      issues.push({
        severity: "error",
        code: "row-note-mismatch",
        dept: d.dept,
        text: `격자표 ${r.subject}: 비고 총계 ${r.noteTotal} ≠ 칸 합 ${cellsSum(r.cells)}`,
      });
    }
  }
  // 2a-개인. 개인표 비고 = **교사 블록 총계** (실물: 병합 셀에 "10+5" 등 — 행이 아니라 교사 단위)
  const byTeacher = new Map<string, { total: number | null; sum: number }>();
  for (const r of d.personalRows) {
    if (!r.teacher) continue;
    const t = byTeacher.get(r.teacher) || { total: null, sum: 0 };
    if (r.noteTotal != null) t.total = Math.max(t.total ?? 0, r.noteTotal);
    t.sum += cellsSum(r.cells);
    byTeacher.set(r.teacher, t);
  }
  for (const [teacher, t] of byTeacher) {
    if (t.total != null && t.total !== t.sum) {
      issues.push({
        severity: "error",
        code: "row-note-mismatch",
        dept: d.dept,
        text: `${teacher}: 비고 총계 ${t.total} ≠ 배정 합 ${t.sum}`,
      });
    }
  }
  // 1. 과목별로 격자표 분포 ≠ 개인표 합산 분포 (반 단위 대조 — 셀 하나의 오독도 여기서 드러난다)
  const gridBySubj = new Map<string, Map<string, number>>();
  for (const g of d.gridRows) {
    const m = gridBySubj.get(g.subject) || new Map<string, number>();
    for (const c of g.cells) m.set(cellKey(c), (m.get(cellKey(c)) || 0) + c.hours);
    gridBySubj.set(g.subject, m);
  }
  const personBySubj = new Map<string, Map<string, number>>();
  for (const p of d.personalRows) {
    const m = personBySubj.get(p.subject) || new Map<string, number>();
    for (const c of p.cells) m.set(cellKey(c), (m.get(cellKey(c)) || 0) + c.hours);
    personBySubj.set(p.subject, m);
  }
  for (const [subj, gm] of gridBySubj) {
    const pm = personBySubj.get(subj);
    if (!pm) {
      if (cellsSum(d.gridRows.filter((g) => g.subject === subj).flatMap((g) => g.cells)) > 0)
        issues.push({ severity: "error", code: "grid-vs-personal", dept: d.dept, text: `${subj}: 격자표에는 있는데 개인표에 배정이 없습니다` });
      continue;
    }
    const keys = new Set([...gm.keys(), ...pm.keys()]);
    for (const k of keys) {
      if ((gm.get(k) || 0) !== (pm.get(k) || 0)) {
        const [g, c] = k.split("-");
        issues.push({
          severity: "error",
          code: "grid-vs-personal",
          dept: d.dept,
          text: `${subj} ${g}학년 ${c}반: 격자표 ${gm.get(k) || 0} ≠ 개인표 합 ${pm.get(k) || 0}`,
        });
      }
    }
  }
  for (const subj of personBySubj.keys())
    if (!gridBySubj.has(subj) && subj !== "창체")
      issues.push({ severity: "error", code: "grid-vs-personal", dept: d.dept, text: `${subj}: 개인표에는 있는데 격자표에 없습니다` });
  // 2b. 부서 제목 총시간 ≠ 개인표 총합 (창체 제외 합 + 창체 합 분리 대조)
  const totals = parseHeaderTotals(d.headerLine);
  if (totals.length) {
    const personalTotal = d.personalRows
      .filter((p) => p.subject !== "창체")
      .reduce((s, p) => s + cellsSum(p.cells), 0);
    const headerHours = totals.reduce((s, t) => s + t.hours, 0);
    if (headerHours !== personalTotal)
      issues.push({
        severity: "error",
        code: "dept-total-mismatch",
        dept: d.dept,
        text: `제목 총시간 ${headerHours} ≠ 개인표 합 ${personalTotal}`,
      });
  }
  // 5. 같은 반·같은 과목 두 교사 (복수교사 표기 없이)
  const seen = new Map<string, string>();
  for (const p of d.personalRows) {
    if (!p.teacher || p.subject === "창체") continue;
    for (const c of p.cells) {
      const k = `${p.subject}|${cellKey(c)}`;
      const prev = seen.get(k);
      if (prev && prev !== p.teacher)
        issues.push({
          severity: "notice",
          code: "shared-assignment",
          dept: d.dept,
          text: `${p.subject} ${c.grade}학년 ${c.classNum}반: ${prev}·${p.teacher} 두 분이 나눠 맡습니다 (분담 배정이면 정상)`,
        });
      seen.set(k, p.teacher);
    }
  }
  return issues;
}

/** 6. 제목의 학년도·학기 대조 — 창체 파일 "2025학년도 1학기" 실측 함정 (분석 §1-②) */
export function validateTitleSemester(
  title: string,
  expected: { year: number; semester: number },
  fileLabel: string
): AssignmentIssue[] {
  const m = title.match(/(\d{4})\s*학년도\s*(\d)\s*학기/);
  if (!m) return [];
  const [y, s] = [Number(m[1]), Number(m[2])];
  if (y !== expected.year || s !== expected.semester)
    return [
      {
        severity: "error",
        code: "stale-title",
        text: `${fileLabel} 내부 제목이 「${y}학년도 ${s}학기」입니다 — 대상(${expected.year}학년도 ${expected.semester}학기)과 다릅니다. 양식 재활용 파일인지 확인해 주세요.`,
      },
    ];
  return [];
}

/** 3. 배정표 창체 배정 반 ↔ 창체 담당 파일의 반 집합 대조 */
export function validateCreative(
  depts: ExtractedAssignmentDept[],
  creative: CreativeGrid
): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  const assignedClasses = new Set<string>();
  for (const d of depts)
    for (const r of [...d.gridRows, ...d.personalRows])
      if (r.subject === "창체") for (const c of r.cells) assignedClasses.add(cellKey(c));
  for (const k of assignedClasses)
    if (!creative.byClass.has(k)) {
      const [g, c] = k.split("-");
      issues.push({ severity: "error", code: "creative-mismatch", text: `배정표에 ${g}학년 ${c}반 창체가 있는데 창체 담당 파일에 그 반 담당자가 없습니다` });
    }
  return issues;
}
