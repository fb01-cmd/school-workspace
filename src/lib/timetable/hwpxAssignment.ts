/**
 * 배정표 hwpx 결정론 파서 — PDF+AI 경로의 후계 (2026-08-16 사용자 확정: "PDF는 날리자")
 *
 * 근거: PDF는 표를 글자 좌표로만 담아 칸 나누기를 추측해야 했고, 그 추측이 학년 밀림
 * 오독(중국문화 3학년→2학년 실사고)을 낳았다. hwpx는 표를 표로 담는다 — 모든 칸이
 * "몇 행 몇 열, 몇 칸 병합"을 명시하므로 (실측: 배정표 실물 16표 × 셀 주소 완비)
 * 학년·반 판정이 추측이 아니라 산수다. AI·가명화·재시도 전부 불필요해진다.
 *
 * 출력은 기존 AI 추출과 같은 ExtractedAssignmentDept 모양 — 하류의 결정론 검증 그물
 * (validateDept·이동수업 대조·조립)이 무수정으로 이어진다. 그물의 역할은 "AI가 잘
 * 읽었나"에서 "원본 문서 자체에 오류가 있나"로 본연 회귀.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { ExtractedAssignmentDept, ExtractedAssignmentRow, ExtractedHourCell } from "./ai";

// ── 저수준: hwpx 컨테이너 → 문서 순서 흐름(문단 | 표) ─────────────

interface HwpxCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}

type FlowItem = { type: "p"; text: string } | { type: "table"; cells: HwpxCell[] };

/** preserveOrder 트리에서 화면에 보이는 글(t 노드)만 문서 순서로 모은다.
 *  비고 칸의 계산식 필드(=SUM…)가 다른 노드에 숨어 있어 전체 #text를 긁으면 오염된다 (실측). */
function collectText(nodes: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown, inT: boolean): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x, inT);
      return;
    }
    if (n && typeof n === "object") {
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (k === "#text") {
          if (inT) out.push(String(v));
        } else if (k !== ":@") walk(v, inT || k === "t");
      }
    }
  };
  walk(nodes, false);
  return out.join("").trim();
}

const attrsOf = (node: Record<string, unknown>): Record<string, string> =>
  ((node[":@"] as Record<string, string>) || {}) as Record<string, string>;

/** tbl 노드 → 셀 목록 (cellAddr/cellSpan 명시 주소 사용) */
function parseTbl(tblChildren: unknown): HwpxCell[] {
  const cells: HwpxCell[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (!n || typeof n !== "object") return;
    const rec = n as Record<string, unknown>;
    if ("tc" in rec) {
      const tcChildren = rec.tc as unknown[];
      let row = -1,
        col = -1,
        rowSpan = 1,
        colSpan = 1;
      for (const child of tcChildren) {
        const c = child as Record<string, unknown>;
        if ("cellAddr" in c) {
          const a = attrsOf(c);
          row = Number(a["@_rowAddr"] ?? -1);
          col = Number(a["@_colAddr"] ?? -1);
        } else if ("cellSpan" in c) {
          const a = attrsOf(c);
          rowSpan = Number(a["@_rowSpan"] ?? 1);
          colSpan = Number(a["@_colSpan"] ?? 1);
        }
      }
      if (row >= 0 && col >= 0)
        cells.push({ row, col, rowSpan, colSpan, text: collectText(tcChildren) });
      // 셀 내부에 중첩 표는 배정표 실물에 없다 — 하강 불필요
      return;
    }
    for (const [k, v] of Object.entries(rec)) if (k !== ":@" && k !== "#text") walk(v);
  };
  walk(tblChildren);
  return cells;
}

/** section XML 트리 → 문단·표를 문서 순서로 */
function extractFlow(nodes: unknown, flow: FlowItem[]): void {
  if (Array.isArray(nodes)) {
    for (const n of nodes) extractFlow(n, flow);
    return;
  }
  if (!nodes || typeof nodes !== "object") return;
  const rec = nodes as Record<string, unknown>;
  if ("tbl" in rec) {
    flow.push({ type: "table", cells: parseTbl(rec.tbl) });
    return; // 표 내부 문단은 셀 텍스트로 이미 소화
  }
  if ("p" in rec) {
    // 이 문단이 표를 품고 있으면(표는 문단의 자식) 하강해서 표만 뽑고,
    // 아니면 문단 텍스트로 취급
    const inner: FlowItem[] = [];
    extractFlowChildren(rec.p, inner);
    if (inner.some((i) => i.type === "table")) {
      flow.push(...inner);
    } else {
      const text = collectText(rec.p);
      if (text) flow.push({ type: "p", text });
    }
    return;
  }
  for (const [k, v] of Object.entries(rec)) if (k !== ":@" && k !== "#text") extractFlow(v, flow);
}

function extractFlowChildren(nodes: unknown, flow: FlowItem[]): void {
  if (Array.isArray(nodes)) {
    for (const n of nodes) extractFlowChildren(n, flow);
    return;
  }
  if (!nodes || typeof nodes !== "object") return;
  const rec = nodes as Record<string, unknown>;
  if ("tbl" in rec) {
    flow.push({ type: "table", cells: parseTbl(rec.tbl) });
    return;
  }
  for (const [k, v] of Object.entries(rec))
    if (k !== ":@" && k !== "#text") extractFlowChildren(v, flow);
}

/** hwpx(zip) → 전 섹션의 문단·표 흐름. hwpx가 아니면 명확한 오류를 던진다 */
export async function loadHwpxFlow(buf: Buffer): Promise<FlowItem[]> {
  if (buf.slice(0, 4).toString("latin1").startsWith("%PDF"))
    throw new Error("PDF는 더 이상 받지 않습니다 — 한글 원본 파일(.hwpx)을 그대로 올려 주세요.");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b)
    throw new Error(
      "한글 파일(.hwpx)이 아닙니다. 한글에서 [다른 이름으로 저장 → HWPX 문서]로 저장해 올려 주세요. (구형 .hwp는 한글에서 열어 hwpx로 다시 저장)"
    );
  const zip = await JSZip.loadAsync(buf);
  const sectionNames = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  if (!sectionNames.length)
    throw new Error("한글 파일(.hwpx)이 아닙니다 — 문서 본문을 찾지 못했습니다.");
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: false,
  });
  const flow: FlowItem[] = [];
  for (const name of sectionNames) {
    const xml = await zip.files[name].async("string");
    extractFlow(parser.parse(xml), flow);
  }
  return flow;
}

// ── 표 해석: 열 지도(학년·반)와 병합 커버 조회 ────────────────────

interface TableView {
  cells: HwpxCell[];
  rowCount: number;
  /** col → 학년·반 (반 번호 헤더 행 기준) */
  colMap: Map<number, { grade: 1 | 2 | 3; classNum: number }>;
  noteCol: number;
  /** (row,col)을 덮는 셀 텍스트 (병합 포함) */
  textAt: (row: number, col: number) => string;
  anchorAt: (row: number, col: number) => HwpxCell | undefined;
}

function buildTableView(cells: HwpxCell[]): TableView {
  const cover = new Map<string, HwpxCell>();
  let rowCount = 0;
  for (const c of cells) {
    rowCount = Math.max(rowCount, c.row + c.rowSpan);
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let k = c.col; k < c.col + c.colSpan; k++) cover.set(`${r}|${k}`, c);
  }
  // 학년 구간: 머리 행(0~2)에서 "N학년" 셀의 col~col+span
  const gradeRanges: Array<{ grade: 1 | 2 | 3; from: number; to: number }> = [];
  let noteCol = -1;
  for (const c of cells) {
    if (c.row > 0) continue;
    const gm = c.text.replace(/\s/g, "").match(/^([123])학년$/);
    if (gm) gradeRanges.push({ grade: Number(gm[1]) as 1 | 2 | 3, from: c.col, to: c.col + c.colSpan });
    if (c.text.replace(/\s/g, "") === "비고") noteCol = c.col;
  }
  // 반 번호: 머리 행 중 숫자 나열 행(행2 실물)에서 각 col의 반 번호
  const colMap = new Map<number, { grade: 1 | 2 | 3; classNum: number }>();
  for (const c of cells) {
    if (c.row === 0 || c.row > 2) continue;
    const num = c.text.trim();
    if (!/^\d{1,2}$/.test(num)) continue;
    const g = gradeRanges.find((r) => c.col >= r.from && c.col < r.to);
    if (g) colMap.set(c.col, { grade: g.grade, classNum: Number(num) });
  }
  return {
    cells,
    rowCount,
    colMap,
    noteCol,
    textAt: (row, col) => cover.get(`${row}|${col}`)?.text?.trim() || "",
    anchorAt: (row, col) => cover.get(`${row}|${col}`),
  };
}

/** 비고 텍스트 → 총계 숫자 ("10+5" 합성 허용, 없으면 null) */
function parseNote(text: string): number | null {
  const nums = text.match(/\d+/g);
  if (!nums || !nums.length) return null;
  return nums.reduce((s, n) => s + Number(n), 0);
}

/** 데이터 행(머리 3행 이후) → ExtractedAssignmentRow. teacherCol<0이면 격자표(교사 없음) */
function readRows(view: TableView, teacherCol: number, subjectCol: number): ExtractedAssignmentRow[] {
  const rows: Array<ExtractedAssignmentRow & { _noteAnchor?: HwpxCell }> = [];
  for (let r = 3; r < view.rowCount; r++) {
    const subject = view.textAt(r, subjectCol).replace(/\s+/g, " ").trim();
    if (!subject) continue;
    // 병합 과목 셀의 앵커 행에서만 한 번 읽는다 (동일 행 중복 방지)
    const anchor = view.anchorAt(r, subjectCol);
    if (anchor && anchor.row !== r) continue;
    const cells: ExtractedHourCell[] = [];
    for (const [col, gc] of view.colMap) {
      const cell = view.anchorAt(r, col);
      if (!cell || cell.row !== r) continue; // 병합 숫자 칸의 이중 계상 방지
      const t = cell.text.trim();
      if (!/^\d{1,2}$/.test(t)) continue;
      cells.push({ grade: gc.grade, classNum: gc.classNum, hours: Number(t) });
    }
    const teacher = teacherCol >= 0 ? view.textAt(r, teacherCol).replace(/\s+/g, "") : "";
    rows.push({
      teacher,
      subject,
      cells,
      noteTotal: view.noteCol >= 0 ? parseNote(view.textAt(r, view.noteCol)) : null,
      _noteAnchor: view.noteCol >= 0 ? view.anchorAt(r, view.noteCol) : undefined,
    });
  }
  // 개인표 비고 = 교사 블록 총계 (검증 2a 계약). 실물은 블록 병합 한 칸("15")도 있고
  // 과목별 분리 칸(체육 10 | 6)도 있다 — 블록의 서로 다른 비고 칸을 합산해 전 행에 싣는다.
  if (teacherCol >= 0) {
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j < rows.length && rows[j].teacher === rows[i].teacher) j++;
      const anchors = new Map<string, number>();
      for (let k = i; k < j; k++) {
        const a = rows[k]._noteAnchor;
        if (!a) continue;
        const v = parseNote(a.text);
        if (v != null) anchors.set(`${a.row}|${a.col}`, v);
      }
      const blockTotal = anchors.size ? [...anchors.values()].reduce((s, v) => s + v, 0) : null;
      for (let k = i; k < j; k++) rows[k].noteTotal = blockTotal;
      i = j;
    }
  }
  return rows.map(({ _noteAnchor, ...r }) => r);
}

// ── 상위: 배정표 문서 → 부서 목록 ────────────────────────────────

export interface HwpxAssignmentParse {
  /** 문서 상단 제목 (학기 검사 재료 — 검출 6) */
  title: string;
  depts: ExtractedAssignmentDept[];
}

export async function parseAssignmentHwpx(buf: Buffer): Promise<HwpxAssignmentParse> {
  const flow = await loadHwpxFlow(buf);
  const title =
    flow.find((f): f is { type: "p"; text: string } => f.type === "p" && /\d{4}\s*학년도|\d\s*학기/.test(f.text))
      ?.text || "";
  const depts: ExtractedAssignmentDept[] = [];
  let recentParas: string[] = [];
  let pendingGrid: { dept: string; rows: ExtractedAssignmentRow[] } | null = null;
  for (const item of flow) {
    if (item.type === "p") {
      recentParas.push(item.text);
      if (recentParas.length > 6) recentParas.shift();
      continue;
    }
    const view = buildTableView(item.cells);
    const head0 = (c: number) => view.textAt(0, c).replace(/\s/g, "");
    if (!view.colMap.size) continue; // 배정표 모양이 아닌 표(안내 표 등)는 무시
    if (head0(0) === "교과") {
      // 격자표 — 부서명은 직전 문단들에서
      const deptPara = [...recentParas].reverse().find((p) => /과목별 배정표|시수 배정표/.test(p)) || "";
      const dept = (
        deptPara.match(/과목별 배정표\s*:\s*(.+)$/)?.[1] ||
        deptPara.match(/([가-힣()]+과?)\s*시수 배정표/)?.[1] ||
        `부서${depts.length + 1}`
      )
        .trim()
        .replace(/^\((.+)\)$/, "$1");
      pendingGrid = { dept, rows: readRows(view, -1, 1) };
      recentParas = [];
    } else if (head0(0) === "교사") {
      // 개인 배정표 — 제목 문단이 부서 총시간 재료 (검증 2).
      // 괄호가 안 닫히면 다음 문단을 접합 (생활교양과 실물: 제목이 두 문단에 걸침)
      const hIdx = recentParas.findLastIndex((p) => /개인 배정표|개인시수표/.test(p));
      let headerLine = hIdx >= 0 ? recentParas[hIdx] : "";
      for (let j = hIdx + 1; j < recentParas.length && hIdx >= 0; j++) {
        const open = (headerLine.match(/\(/g) || []).length;
        const close = (headerLine.match(/\)/g) || []).length;
        if (open <= close) break;
        headerLine += " " + recentParas[j];
      }
      const personalRows = readRows(view, 0, 1);
      // 병기 과목("인간과 철학 / 삶과종교")은 격자표 표기로 통일 — AI 시절 프롬프트 계약의 결정론 이식
      const norm = (x: string) => x.replace(/\s+/g, "");
      const gridSubjects = new Set((pendingGrid?.rows || []).map((g) => norm(g.subject)));
      const slashSubjects = (pendingGrid?.rows || []).map((g) => g.subject).filter((x) => x.includes("/"));
      for (const pr of personalRows) {
        if (gridSubjects.has(norm(pr.subject))) continue;
        const host = slashSubjects.find((gs) => gs.split("/").some((part) => norm(part) === norm(pr.subject)));
        if (host) pr.subject = host;
      }
      depts.push({
        dept: pendingGrid?.dept || `부서${depts.length + 1}`,
        headerLine,
        gridRows: pendingGrid?.rows || [],
        personalRows,
        modelUsed: "결정론(hwpx)",
      });
      pendingGrid = null;
      recentParas = [];
    }
  }
  return { title, depts };
}

// ── 창체 담당 문서 → 기존 파서가 읽는 텍스트로 환원 ─────────────

/** 창체 hwpx → "1반 김OO 이OO 박OO" 줄 텍스트 (parseCreativeGrid 재사용) */
export async function creativeHwpxToText(buf: Buffer): Promise<string> {
  const flow = await loadHwpxFlow(buf);
  const lines: string[] = [];
  for (const item of flow) {
    if (item.type === "p") {
      lines.push(item.text);
      continue;
    }
    const byRow = new Map<number, HwpxCell[]>();
    for (const c of item.cells) {
      if (!byRow.has(c.row)) byRow.set(c.row, []);
      byRow.get(c.row)!.push(c);
    }
    for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
      const line = byRow
        .get(r)!
        .sort((a, b) => a.col - b.col)
        .map((c) => c.text.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      if (line) lines.push(line);
    }
  }
  return lines.join("\n");
}
