/**
 * 교사별 시수표 자동 생성 — 상류 3파일 파이프라인 (hours_source_files_analysis §2·§4·§5ⓓ)
 *
 * 구조 (2026-08-16 hwpx 전환 후):
 *   배정표 hwpx → 결정론 표 파싱(hwpxAssignment.ts) → **결정론 교차 검증(§4의 1·2·5·6)**
 *   → 창체·이동수업 대조(3·4) → HoursPlan 행 조립. PDF+AI 경로는 폐지 —
 *   칸 좌표 추측이 학년 밀림 오독을 낳던 뿌리를 형식 교체로 제거했다.
 */

import { ExtractedAssignmentDept, ExtractedHourCell } from "./ai";

// ── 2. 배정표 부서 단위 분할 ──────────────────────────────────

export interface DeptChunk {
  dept: string; // 격자표 제목의 부서명 (예: "국어", "(과학)")
  headerLine: string; // 개인 배정표 제목 줄 — 부서 총시간 파싱 재료 (검증 2)
  text: string; // 격자표+개인표 전체 텍스트 (가명화 전)
}

/** 개인 배정표 제목의 "국어 (113시간+창체5) / 한문 (15시간)" → [{label, hours, creative}] (검증 2 재료) */
export function parseHeaderTotals(
  headerLine: string
): Array<{ label: string; hours: number; creative: number }> {
  // 실물 양식이 넷: "국어 (113시간+창체5 )" · "외국어(113시간+창체5시간)" · "수학 (127시간)"
  // · "개인시수표 (정보27시간+창체2시간 /기술가정 15시간/철학 15시간)" (괄호 안 나열·두 줄 접합본)
  // → "라벨 [ ( ] 숫자 시간" 패턴 전수 스캔으로 일반화. 창체N은 creative로 분리.
  const body = headerLine.replace(/^.*(?:개인 배정표\s*:|개인시수표)\s*/, "");
  const out: Array<{ label: string; hours: number; creative: number }> = [];
  for (const m of body.matchAll(/([가-힣·A-Za-z]+)\s*\(?\s*(\d+)\s*시간/g)) {
    const label = m[1].trim();
    const hours = Number(m[2]);
    if (label === "창체") {
      if (out.length) out[out.length - 1].creative += hours;
      continue;
    }
    out.push({ label, hours, creative: 0 });
  }
  // "+창체5 )"처럼 "시간" 없이 끝나는 변형 (국어 실물)
  for (const m of body.matchAll(/창체\s*(\d+)\s*[)\s]/g)) {
    const n = Number(m[1]);
    if (out.length && !out.some((o) => o.creative === n)) {
      if (out[0].creative === 0) out[0].creative = n;
    }
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
    | "simul-status-mismatch"
    | "grade-misplacement" // 4. 이동수업 현황 반 묶음 ≠ 배정표 배정 반
    | "stale-title"; // 6. 문서 제목 학기 ≠ 대상 학기
  dept?: string;
  text: string;
}

/**
 * 과목명 대조기 — 정규화 동일 또는 **약칭 부분열 규칙** (2026-08-17).
 * 시스템 과목 등록부가 약칭만 담고 있어(컴시간 유래) 정식↔약칭 데이터 다리가 없다.
 * 약칭 관행 = 풀네임 글자의 순서 보존 부분열("중화"⊂중국어회화, "세포"⊂세포와물질대사).
 * 끝 숫자(로마숫자 포함, Ⅱ↔2 동일시)는 **일치 필수** — 물Ⅰ/물Ⅱ 충돌 방지.
 */
export function subjectMatches(a: string, b: string): boolean {
  const roman = (x: string) => x.replace(/Ⅰ/g, "1").replace(/Ⅱ/g, "2").replace(/Ⅲ/g, "3");
  // "화학Ⅱ→화Ⅱ" 축약(학 탈락)은 한쪽에만 적용될 수 있어 변형 두 벌을 모두 시도한다 —
  // "지구과학" ↔ "지구과학Ⅱ"가 축약 비대칭으로 어긋나던 실사고 보수 (2026-08-16)
  const variants = (x: string): string[] => {
    const flat = roman(x.replace(/\s+/g, ""));
    const contracted = roman(x.replace(/\s+/g, "").replace(/학(?=[ⅠⅡⅢ])/g, ""));
    return contracted === flat ? [flat] : [flat, contracted];
  };
  const pairOk = (va: string, vb: string): boolean => {
    if (va === vb) return true;
    const numOf = (x: string) => (x.match(/(\d+)$/)?.[1] ?? "");
    const stem = (x: string) => x.replace(/\d+$/, "");
    const [shortV, longV] = va.length <= vb.length ? [va, vb] : [vb, va];
    const sNum = numOf(shortV);
    if (sNum && sNum !== numOf(longV)) return false;
    const sStem = stem(shortV);
    const lStem = stem(longV);
    // 끝 숫자가 양쪽에 있고 일치하면 한 글자 줄기도 허용("체Ⅱ"↔체육2) — 숫자 불일치
    // 보호가 위에서 이미 물Ⅰ/물Ⅱ류를 걸렀다. 숫자 근거가 없으면 두 글자 이상 유지.
    const minLen = sNum && sNum === numOf(longV) ? 1 : 2;
    if (sStem.length < minLen || sStem[0] !== lStem[0]) return false;
    let i = 0;
    for (const ch of lStem) if (ch === sStem[i]) i++;
    return i === sStem.length;
  };
  for (const va of variants(a)) for (const vb of variants(b)) if (pairOk(va, vb)) return true;
  return false;
}

/**
 * 그룹 맥락 한정 최후 폴백 — 등록부 약칭이 분반 차수 표기로 끝나는 실물("인공Ⅱ" =
 * 인공지능 기초 2번째 밴드, 2026-08-16 실사고). subjectMatches의 끝 숫자 보호(물Ⅰ/Ⅱ)를
 * 무시하고 줄기 부분열만 본다. **학년·반 범위로 이미 좁혀진 등록부(이동수업·특별실)
 * 대조에서만 쓸 것** — 전역에 쓰면 물Ⅰ/물Ⅱ가 충돌한다.
 */
export function subjectStemLoose(a: string, b: string): boolean {
  const stem = (x: string) =>
    x.replace(/\s+/g, "").replace(/Ⅰ/g, "1").replace(/Ⅱ/g, "2").replace(/Ⅲ/g, "3").replace(/\d+$/, "");
  const [sh, lo] = [stem(a), stem(b)].sort((p, q) => p.length - q.length);
  if (sh.length < 2 || sh[0] !== lo[0]) return false;
  let i = 0;
  for (const ch of lo) if (ch === sh[i]) i++;
  return i === sh.length;
}

const cellsSum = (cells: ExtractedHourCell[]) => cells.reduce((s, c) => s + c.hours, 0);
const cellKey = (c: ExtractedHourCell) => `${c.grade}-${c.classNum}`;

export function validateDept(d: ExtractedAssignmentDept): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  // 2a-격자. 격자표 행 비고 = 그 과목 총계.
  // 창체는 제외 — 격자표 창체가 칸 없이 비고 총계만 갖는 실물(외국어·사회)이 있다.
  // 창체의 진실 대조는 검출 3(창체 파일)과 교사 블록 총계(2a-개인, "12+3" 합성)가 담당한다.
  for (const r of d.gridRows) {
    if (r.subject === "창체") continue;
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
  // 과목 키는 정규화 대조(공백 제거·"물리학Ⅱ"≡"물리Ⅱ" — 실물 (과학) 부서의 표기 이원화).
  // 창체는 제외(위 2a-격자와 같은 이유).
  const canonSubj = (x: string) => x.replace(/\s+/g, "").replace(/학(?=[ⅠⅡⅢ])/g, "");
  const gridBySubj = new Map<string, Map<string, number>>();
  for (const g of d.gridRows) {
    if (g.subject === "창체") continue;
    const k = canonSubj(g.subject);
    const m = gridBySubj.get(k) || new Map<string, number>();
    for (const c of g.cells) m.set(cellKey(c), (m.get(cellKey(c)) || 0) + c.hours);
    gridBySubj.set(k, m);
  }
  const personBySubj = new Map<string, Map<string, number>>();
  for (const p of d.personalRows) {
    if (p.subject === "창체") continue;
    const k = canonSubj(p.subject);
    const m = personBySubj.get(k) || new Map<string, number>();
    for (const c of p.cells) m.set(cellKey(c), (m.get(cellKey(c)) || 0) + c.hours);
    personBySubj.set(k, m);
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
    if (!gridBySubj.has(subj))
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
  const m = title.match(/(\d{4})\s*학?년도?\s*.*?(\d)\s*학기/);
  // 연도 없는 표식("<2학년 2학기>")도 실재 — 학기만이라도 대조 (2026-08-17 신학기 시뮬 실측)
  if (!m) {
    const semOnly = title.match(/(\d)\s*학기/);
    if (semOnly && Number(semOnly[1]) !== expected.semester)
      return [
        {
          severity: "error",
          code: "stale-title",
          text: `${fileLabel} 내부 표기가 「${semOnly[1]}학기」입니다 — 대상(${expected.year}학년도 ${expected.semester}학기)과 학기가 다릅니다. 지난 학기 파일인지 확인해 주세요.`,
        },
      ];
    return [];
  }
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

// ── 5. 이동수업 현황 xlsx — 결정론 파서 + 검출 4 ─────────────

export interface SimulStatusEntry {
  grade: number;
  /** 정규화 과목명 (뒤 숫자·공백 제거: "중국어회화1" → "중국어회화") */
  subject: string;
  classNums: number[];
  raw: string; // 원문 (보고용)
  /** §9-B②: 개설 반 — 이 문자열이 적혀 있던 행의 반. 시수표에서 이 과목이 소속될 반이다 */
  hostClassNum?: number;
}

const normMoving = (s: string) => s.replace(/\s+/g, "").replace(/\d+$/, "");

/** 파싱 결과 — 보강 양식이면 standalone(단독 개설 확정 실증)이 함께 온다 */
export interface SimulStatusParse {
  grade: number;
  entries: SimulStatusEntry[];
  /** 「단독 개설」 실증 — "grade-class|과목". 보강 양식의 한 쌍짜리 줄, 또는 구양식의
   *  **괄호 없는 과목 기재**(2026-08-17 발견: 원본에 이미 있었다 — "중국문화2"가 2반 행에) */
  standalone: string[];
  /** 파일 내부의 학기 표식 원문 (예: "<3학년 1학기>") — 학기 불일치 검출(검출 6) 재료 */
  semesterTitle?: string;
}

/** 두 양식 자동 감지: ① 보강 양식(2026-08-17 — 헤더에 「개설 반」·「구분」) ② 구양식("과목(1반+6반)") */
export function parseSimulStatusXlsx(buf: Buffer): SimulStatusParse {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  // 보강 양식 C안(2026-08-17 확정) 감지: 「반=과목」 쌍 셀. 한 줄 = 한 묶음,
  // 쌍이 명시라 순서 무관. 쌍 1개 = 단독 개설 확정 실증, 2개 이상 = 이동수업.
  {
    const PAIR = /(\d{1,2})\s*반?\s*=\s*([가-힣A-Za-zⅠⅡⅢ0-9·\s]+)/g;
    for (const sheetName of wb.SheetNames) {
      const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1 });
      const entries: SimulStatusEntry[] = [];
      const standalone: string[] = [];
      const normName = (x: string) => x.replace(/\s+/g, "").replace(/\d+$/, "");
      for (const r of sheetRows) {
        if (!Array.isArray(r)) continue;
        const grade = Number(r.find((c) => Number(c) >= 1 && Number(c) <= 3));
        if (!grade) continue;
        const content = r.find((c) => typeof c === "string" && /\d+\s*반?\s*=/.test(c)) as string | undefined;
        if (!content) continue;
        const pairs = [...content.matchAll(PAIR)].map((m) => ({ cls: Number(m[1]), name: m[2].trim() }));
        if (!pairs.length) continue;
        if (pairs.length === 1) {
          standalone.push(`${grade}-${pairs[0].cls}|${normName(pairs[0].name)}`);
          continue;
        }
        const band = [...new Set(pairs.map((p) => p.cls))].sort((a, b) => a - b);
        for (const pr of pairs)
          entries.push({
            grade, subject: normName(pr.name), classNums: band,
            raw: `${pr.name}(${band.join("반+")}반)`, hostClassNum: pr.cls,
          });
      }
      if (entries.length || standalone.length) {
        const grades = new Set(entries.map((e) => e.grade));
        return { grade: grades.size === 1 ? [...grades][0] : 0, entries, standalone };
      }
    }
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  let grade = 0;
  let currentClass = 0; // §9-B②: 행 맥락 — "N반" 셀 이후의 문자열은 그 반 행에 속한다
  let semesterTitle: string | undefined;
  const seen = new Map<string, SimulStatusEntry>();
  const standaloneSet = new Set<string>();
  const normStandalone = (x: string) => x.replace(/\s+/g, "").replace(/\d+$/, "");
  for (const row of rows) {
    let rowClass = 0; // 반 표식은 그 행에서만 유효 — 다음 행 문자열까지 전이되면 오귀속
    for (const cell of row || []) {
      if (typeof cell !== "string") continue;
      const g = cell.match(/<\s*(\d)\s*학년/);
      if (g) grade = Number(g[1]);
      if (!semesterTitle && /<[^>]*학기[^>]*>/.test(cell)) semesterTitle = cell.trim();
      const cls = cell.trim().match(/^(\d{1,2})\s*반$/);
      if (cls) { currentClass = Number(cls[1]); rowClass = currentClass; }
      // 괄호 없는 과목 기재 = 단독 개설 (원본 실측: "중국문화2"·"논술1"·"사회문제탐구1" 등)
      // 같은 행(반 표식 행)의 문자열만 — 다음 행들은 탐구선택 나열이라 반 귀속이 다르다
      if (
        rowClass > 0 && grade > 0 &&
        !/[()<>=+/]/.test(cell) && !/^\d+\s*반$/.test(cell.trim()) &&
        /^[가-힣][가-힣A-Za-zⅠⅡⅢ0-9\s]{2,15}$/.test(cell.trim()) &&
        !/인원|계열|학기|선택$/.test(cell)
      ) {
        standaloneSet.add(`${grade}-${rowClass}|${normStandalone(cell.trim())}`);
      }
      for (const m of cell.matchAll(/([가-힣A-Za-zⅠⅡⅢ]+\d*)\(((?:\d+\s*반\s*\+?\s*)+)\)/g)) {
        const subject = normMoving(m[1]);
        const classNums = [...m[2].matchAll(/(\d+)\s*반/g)].map((x) => Number(x[1])).sort((a, b) => a - b);
        if (!subject || classNums.length < 2) continue; // 묶음(2반 이상)만 이동수업으로 본다
        const key = `${subject}|${classNums.join(",")}|${currentClass}`;
        if (!seen.has(key))
          seen.set(key, {
            grade: 0, subject, classNums, raw: m[0],
            // 개설 반은 문자열이 놓인 행의 반 — 단 그 반이 밴드 소속일 때만 신뢰 (표 여백 셀 방어)
            hostClassNum: classNums.includes(currentClass) ? currentClass : undefined,
          });
      }
    }
  }
  const entries = [...seen.values()].map((e) => ({ ...e, grade }));
  return { grade, entries, standalone: [...standaloneSet], semesterTitle };
}

/**
 * 검출 4 — 이동수업 현황의 반 묶음 ↔ 배정표의 그 과목 배정 반 대조.
 * 양방향: 현황에 있는데 배정이 없는 반 / 현황에 없는 반에 배정이 있는 경우 모두 잡는다.
 * 과목명은 정규화 대조(뒤 숫자·공백 제거) — 배정표 약칭과 어긋나 못 찾은 과목은 별도 고지.
 */
export function validateSimulStatus(
  depts: ExtractedAssignmentDept[],
  status: { entries: SimulStatusEntry[] }
): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];
  // 밴드 의미론 (실물 재해석 2026-08-16): "중국어회화1(1반+6반+10반)"의 반 묶음은 그 과목
  // 수강 반이 아니라 **같이 움직이는 밴드**다 — 밴드의 각 반은 서로 다른 과목을 듣는다.
  // 따라서 과목 단위 대조는 같은 기반 과목의 **밴드 합집합**과 배정표 반 집합을 비교하되,
  // 단독 개설(비이동) 반이 실재하므로(3학년 10반 화Ⅱ 전례) 전부 **고지**로만 낸다.
  // 정규화와 같은 동치류 클러스터링 — 같은 과목이 두 이름이면 대조도 한 번만
  const vClusters: Array<{ grade: number; names: string[]; union: Set<number> }> = [];
  for (const en of status.entries) {
    const found = vClusters.find(
      (c) => c.grade === en.grade && c.names.some((n) => subjectMatches(n, en.subject))
    );
    if (found) {
      if (!found.names.includes(en.subject)) found.names.push(en.subject);
      en.classNums.forEach((c) => found.union.add(c));
    } else {
      vClusters.push({ grade: en.grade, names: [en.subject], union: new Set(en.classNums) });
    }
  }
  for (const vc of vClusters) {
    const subject = [...vc.names].sort((a, b) => b.length - a.length)[0];
    const e = { grade: vc.grade, subject, classNums: [...vc.union].sort((a, b) => a - b), raw: subject };
    const matchNames = vc.names;
    const assigned = new Set<number>();
    let subjectFound = false;
    for (const d of depts)
      for (const r of d.personalRows) {
        if (!matchNames.some((n) => subjectMatches(r.subject, n))) continue;
        subjectFound = true;
        for (const c of r.cells) if (c.grade === e.grade) assigned.add(c.classNum);
      }
    if (!subjectFound) {
      issues.push({
        severity: "notice",
        code: "simul-status-mismatch",
        text: `이동수업 현황의 「${subject}」 과목을 배정표에서 찾지 못했습니다 (배정표 표기가 다른 이름일 수 있음 — 확인용)`,
      });
      continue;
    }
    if (!assigned.size) {
      // 이 학년엔 한 칸도 없는데 같은 과목이 다른 학년에 잡혀 있다 = 학년 열 오독 신호
      // (중국문화 3학년→2학년 실사고, 2026-08-16). 판정은 **정규화 동일 이름**만 —
      // 약칭 부분열("과학"↔"과학사")까지 잡으면 유사 이름 남남이 오독으로 오인된다(실측).
      const baseName = (x: string) =>
        x.replace(/\s+/g, "").replace(/학(?=[ⅠⅡⅢ])/g, "").replace(/Ⅰ/g, "1").replace(/Ⅱ/g, "2").replace(/Ⅲ/g, "3");
      const elsewhere = new Map<number, Set<number>>();
      for (const d of depts)
        for (const r of d.personalRows) {
          if (!matchNames.some((n) => baseName(r.subject) === baseName(n))) continue;
          for (const c of r.cells)
            if (c.grade !== e.grade) {
              if (!elsewhere.has(c.grade)) elsewhere.set(c.grade, new Set());
              elsewhere.get(c.grade)!.add(c.classNum);
            }
        }
      if (elsewhere.size) {
        const desc = [...elsewhere.entries()]
          .map(([g, cs]) => `${g}학년 ${[...cs].sort((a, b) => a - b).join("·")}반`)
          .join(", ");
        issues.push({
          severity: "error",
          code: "grade-misplacement",
          text: `${e.grade}학년 ${subject}: 이동수업 자료상 ${e.grade}학년 수업인데 배정표 추출 결과에는 ${desc}으로 잡혀 있습니다 — 학년 열을 잘못 읽었을 수 있습니다. 표에서 이 수업의 학년·반을 자료 기준으로 고쳐 주세요`,
        });
        continue;
      }
    }
    const want = new Set(e.classNums);
    const missing = e.classNums.filter((c) => !assigned.has(c));
    const extra = [...assigned].filter((c) => !want.has(c));
    const overlap = e.classNums.filter((c) => assigned.has(c)).length;
    if (missing.length || extra.length)
      issues.push({
        severity: "notice",
        code: "simul-status-mismatch",
        text:
          overlap === 0
            ? // 겹치는 반이 0 = 대개 이름만 비슷한 서로 다른 수업 (과학 ↔ 과학사 실사고 2026-08-16)
              `${e.grade}학년 ${subject}: 이동수업 자료의 「${subject}」(${e.classNums.join("·")}반)과 배정표에서 이름이 비슷한 과목(${[...assigned].sort((a, b) => a - b).join("·")}반)은 겹치는 반이 하나도 없습니다 — 이름만 비슷한 서로 다른 수업일 가능성이 큽니다. 서로 다른 수업이 맞다면 조치 없이 확인 체크만 하면 됩니다`
            : `${e.grade}학년 ${subject}: 이동수업 밴드 반(${e.classNums.join("·")})과 배정표 반(${[...assigned].sort((a, b) => a - b).join("·")})이 다릅니다 — ` +
              `밴드에서 다른 과목을 듣는 반이거나 단독 개설 반이면 정상입니다 (확인용)` +
              (missing.length ? ` · 밴드에만 있는 반: ${missing.join("·")}` : "") +
              (extra.length ? ` · 배정에만 있는 반: ${extra.join("·")}` : ""),
      });
  }
  return issues;
}

// ── 6. 시수표(HoursPlan 행) 조립 + 성명→이메일 매칭 ──────────

export interface AssembledHoursRow {
  grade: number;
  classNum: number;
  subjectName: string;
  teacherName: string;
  teacherEmail: string; // 미매칭이면 "" — 화면의 성명→이메일 매칭 UI(9c-H 재사용)가 마저 채운다
  hours: number;
  /** §9-B①: 이동수업 등록부 대조로 자동 태그 (9c-I-2 힌트 계보) — 솔버 무편집 투입의 재료 */
  simulGroupId?: string | null;
  /** §9-C: 특별실 등록부 대조 — 슬롯 제한형이면 그 수, 아니면 전 시수 */
  venueHours?: number | null;
}

export interface AssembleResult {
  rows: AssembledHoursRow[]; // 배정표 개인표 유래 — **창체 제외** (§9-A: 최종 시수표 실측상
  // 창체는 시수표에 없고 교육과정 고정 시간 몫. 불러오기의 코호트 함의 행과 이중 계상 차단)
  /** 창체 담당 파일 유래(반별 담당 1시간) — 배정표 창체와 관계가 확정되지 않아 **합치지 않고 따로** 준다.
   *  포함 여부는 화면에서 일과계가 정한다 (이중 계상 방지 — 9c-I H1 무력화 함정과 같은 정신). */
  creativeRows: AssembledHoursRow[];
  unmatchedNames: string[]; // 이메일 미매칭 성명 (동명이인 포함)
}

export function assembleHoursRows(
  depts: ExtractedAssignmentDept[],
  creative: CreativeGrid,
  creativeSubjectLabel: string,
  roster: Array<{ name: string; email: string }>,
  registries?: {
    simulGroups?: Array<{ id?: string; grade: number; classNums: number[]; subjectNames: string[] }>;
    venueGroups?: Array<{ grade: number; classNums: number[]; subjectNames: string[]; slots?: unknown[] }>;
    /** 정식 과목명 ↔ 약칭 쌍 (term.subjects) — 등록부는 약칭("중화"), 배정표는 풀네임("중국어회화")이라 다리 필수 */
    subjectPairs?: Array<{ name: string; shortName: string }>;
  }
): AssembleResult {
  const canon = (x: string) => x.replace(/\s+/g, "").replace(/학(?=[ⅠⅡⅢ])/g, "").replace(/\d+$/, "");
  // 이름 동치 집합: 행 과목명과 등록부 표기가 정식↔약칭 어느 조합이어도 만나게
  const aliasSets = new Map<string, Set<string>>();
  for (const pr of registries?.subjectPairs || []) {
    const a = canon(pr.name);
    const b = canon(pr.shortName);
    const set = aliasSets.get(a) || aliasSets.get(b) || new Set<string>();
    set.add(a).add(b);
    aliasSets.set(a, set);
    aliasSets.set(b, set);
  }
  const sameSubject = (x: string, y: string) => {
    const cx = canon(x);
    const cy = canon(y);
    if (cx === cy) return true;
    if (aliasSets.get(cx)?.has(cy)) return true;
    if (subjectMatches(x, y)) return true; // 약칭 부분열 폴백 — 등록부가 약칭만 담는 실태 (2026-08-17)
    return subjectStemLoose(x, y);
  };
  const tagHints = (row: AssembledHoursRow) => {
    const sg = registries?.simulGroups?.find(
      (g) => g.grade === row.grade && g.classNums.includes(row.classNum) &&
        g.subjectNames.some((sn) => sameSubject(sn, row.subjectName))
    );
    if (sg?.id) row.simulGroupId = sg.id;
    const vg = registries?.venueGroups?.find(
      (g) => g.grade === row.grade && g.classNums.includes(row.classNum) &&
        g.subjectNames.some((sn) => sameSubject(sn, row.subjectName))
    );
    if (vg) row.venueHours = vg.slots?.length ? Math.min(row.hours, vg.slots.length) : row.hours;
    return row;
  };
  // 성명→이메일: **서로 다른** 이메일이 유일할 때만 자동 매칭 (동명이인은 미매칭으로 남겨
  // 사람이 정한다). 같은 사람이 여러 소스에서 중복 들어오는 것은 Set이 흡수한다 —
  // 배열로 세면 3소스 합집합에서 전원이 "후보 3개"가 되는 실사고 (2026-08-16).
  const byName = new Map<string, Set<string>>();
  for (const t of roster) {
    if (!t.name || !t.email) continue;
    if (!byName.has(t.name)) byName.set(t.name, new Set());
    byName.get(t.name)!.add(t.email.toLowerCase());
  }
  const emailOf = (name: string) => {
    const set = byName.get(name);
    return set && set.size === 1 ? [...set][0] : "";
  };
  const unmatched = new Set<string>();
  const rows: AssembledHoursRow[] = [];
  for (const d of depts)
    for (const r of d.personalRows) {
      if (!r.teacher) continue;
      if (r.subject === "창체") continue; // §9-A — 검출 3 대조에는 depts 원본이 계속 쓰인다
      const email = emailOf(r.teacher);
      if (!email) unmatched.add(r.teacher);
      for (const c of r.cells)
        rows.push(
          tagHints({
            grade: c.grade,
            classNum: c.classNum,
            subjectName: r.subject,
            teacherName: r.teacher,
            teacherEmail: email,
            hours: c.hours,
          })
        );
    }
  const creativeRows: AssembledHoursRow[] = [];
  for (const [key, name] of creative.byClass) {
    const [g, c] = key.split("-").map(Number);
    const email = emailOf(name);
    if (!email) unmatched.add(name);
    creativeRows.push({
      grade: g,
      classNum: c,
      subjectName: creativeSubjectLabel,
      teacherName: name,
      teacherEmail: email,
      hours: 1,
    });
  }
  return { rows, creativeRows, unmatchedNames: [...unmatched].sort() };
}

// ── 7. §9-B② 개설 반 정규화 — 배정표 반 표기를 이동수업 현황의 개설 반으로 ──

export interface HostNormalization {
  subject: string;
  teacher: string;
  from: { grade: number; classNum: number };
  to: { grade: number; classNum: number };
}

/**
 * 최종 시수표 역산(§9)에서 확정된 일과계 수작업의 자동화: 배정표가 이동수업 과목을
 * 개설 반이 아닌 반에 적어 두는 경우가 실재한다(기하가 밴드 밖 3반에 등). 현황 파일의
 * 행 맥락(hostClassNum)을 기준으로, 그 과목의 배정 칸 중 **개설 반 집합에 없는 칸**을
 * 남는 개설 반으로 옮긴다. 시수는 절대 바꾸지 않는다 — 반 소속만.
 *
 * 보수 원칙: 확실할 때만 움직인다 — 떠돌이 칸 수 ≠ 남는 개설 반 수면 옮기지 않고
 * 고지만 남긴다(오탐 이동이 무이동보다 나쁘다). 옮긴 건 전부 notice로 보고.
 */
export function normalizeHostClasses(
  depts: ExtractedAssignmentDept[],
  status: { entries: SimulStatusEntry[] },
  /** 그리드 실증 (2026-08-17): "grade-class|과목" 중 이동수업 딱지 **없이** 실재하는 조합.
   *  현황 파일의 부재는 "이동수업이 아님"과 "존재하지 않음"을 구별 못 하지만 그리드는 안다. */
  standaloneLessons?: Set<string>,
  /** 실증의 학기 등급 (2026-08-17 사용자 지적): "same" = 대상 학기 실물 → 확정, 떠돌이에서 제외.
   *  "previous" = 전 학기 참고 → **추정일 뿐** — 자동 이동 근거로 쓰지 않고 확인 요청 고지만 낸다. */
  evidenceTier: "same" | "previous" = "same",
  /** 확정 실증의 출처 — 문구 구분용: "grid"=시간표 실증 / "doc"=제출 문서 명시 */
  evidenceSource: "grid" | "doc" = "grid"
): { moves: HostNormalization[]; issues: AssignmentIssue[] } {
  const moves: HostNormalization[] = [];
  const issues: AssignmentIssue[] = [];
  const canon = (x: string) => x.replace(/\s+/g, "").replace(/학(?=[ⅠⅡⅢ])/g, "").replace(/\d+$/, "");
  // 과목별 개설 반 집합 (현황 행 맥락 유래만 — host 미상 항목은 정규화 근거로 안 쓴다)
  // 학년별 **동치류 클러스터링** (2026-08-17 실배포 실사고): 같은 과목이 역추출(약칭 "중화")과
  // 파일(풀네임 "중국어회화") 두 이름으로 들어오면, 별개 기준으로 정규화가 두 번 돌아
  // 이미 정리된 반을 또 "떠돌이"로 밀어낸다(이경호 3칸 연쇄 이동). 같은 학년에서
  // subjectMatches로 통하는 항목들을 한 덩어리로 합쳐 **과목당 정확히 한 번**만 정리한다.
  const clusters: Array<{ grade: number; names: string[]; hosts: Set<number> }> = [];
  for (const e of status.entries) {
    if (e.hostClassNum == null) continue;
    const found = clusters.find(
      (c) => c.grade === e.grade && c.names.some((n) => subjectMatches(n, e.subject))
    );
    if (found) {
      if (!found.names.includes(e.subject)) found.names.push(e.subject);
      found.hosts.add(e.hostClassNum);
    } else {
      clusters.push({ grade: e.grade, names: [e.subject], hosts: new Set([e.hostClassNum]) });
    }
  }
  for (const cluster of clusters) {
    const grade = cluster.grade;
    // 표시·대조 대표명 = 가장 긴 이름 (풀네임 우선)
    const subjKey = [...cluster.names].sort((a, b) => b.length - a.length)[0];
    const hosts = cluster.hosts;
    // 이 과목의 배정표 칸 전수 (해당 학년만)
    const cells: Array<{ row: { teacher: string; cells: ExtractedHourCell[] }; cell: ExtractedHourCell }> = [];
    for (const d of depts)
      for (const r of d.personalRows) {
        if (!cluster.names.some((n) => subjectMatches(r.subject, n))) continue;
        for (const c of r.cells) if (c.grade === grade) cells.push({ row: r, cell: c });
      }
    if (!cells.length) continue;
    let strays = cells.filter(({ cell }) => !hosts.has(cell.classNum));
    // 그리드 실증으로 단독 개설 확인된 칸은 떠돌이가 아니다 — 제자리 유지 + 고지
    if (standaloneLessons) {
      const confirmed = strays.filter(({ cell }) =>
        cluster.names.some((n) => standaloneLessons.has(`${cell.grade}-${cell.classNum}|${n}`)) ||
        standaloneLessons.has(`${cell.grade}-${cell.classNum}|${subjKey}`)
      );
      if (confirmed.length) {
        // 분담 배정(한 반에 교사 두 행)이면 같은 반이 두 번 잡힌다 — 반 번호로 중복 제거
        const classes = [...new Set(confirmed.map(({ cell }) => cell.classNum))]
          .sort((a, b) => a - b)
          .map((n) => `${n}반`)
          .join("·");
        if (evidenceTier === "same") {
          const basis = evidenceSource === "doc" ? "제출하신 이동수업 현황에 단독으로 적혀 있습니다" : "이 학기 시간표 실증상 이동 없는 단독 수업입니다";
          issues.push({
            severity: "notice",
            code: "simul-status-mismatch",
            text: `${grade}학년 ${subjKey}: ${classes}은 ${basis} — 그대로 둡니다 (확인됨)`,
          });
          strays = strays.filter((x) => !confirmed.includes(x));
        } else {
          // 전 학기 참고 — 확정 아님: 떠돌이에서 빼지 않는다(자동 이동 근거 금지). 판단 재료만 제공
          issues.push({
            severity: "notice",
            code: "simul-status-mismatch",
            text: `${grade}학년 ${subjKey}: ${classes}은 **전 학기** 시간표에서 이동 없는 단독 수업이었습니다 — 이번 학기도 같다면 정상, 바뀌었다면 불러온 뒤 표에서 반을 확인해 주세요`,
          });
        }
      }
    }
    const occupied = new Set(cells.map(({ cell }) => cell.classNum));
    const freeHosts = [...hosts].filter((h) => !occupied.has(h)).sort((a, b) => a - b);
    if (!strays.length) continue;
    if (strays.length !== freeHosts.length) {
      issues.push({
        severity: "notice",
        code: "simul-status-mismatch",
        text: `${grade}학년 ${subjKey}: 배정표 반과 이동수업 개설 반(${[...hosts].sort((a, b) => a - b).join("·")})이 어긋나는데 짝이 맞지 않아 자동 정리하지 않았습니다 — 불러온 뒤 표에서 반을 확인해 주세요`,
      });
      continue;
    }
    const classMap = new Map<number, number>(); // from반 → to반 (격자표에도 같은 이동 적용용)
    strays
      .sort((a, b) => a.cell.classNum - b.cell.classNum)
      .forEach(({ row, cell }, i) => {
        const to = freeHosts[i];
        classMap.set(cell.classNum, to);
        moves.push({
          subject: subjKey,
          teacher: row.teacher,
          from: { grade: cell.grade, classNum: cell.classNum },
          to: { grade: cell.grade, classNum: to },
        });
        issues.push({
          severity: "notice",
          code: "simul-status-mismatch",
          text: `${grade}학년 ${subjKey}(${row.teacher}): 배정표의 ${cell.classNum}반 표기를 이동수업 개설 반인 ${to}반으로 옮겼습니다 (시수 변화 없음)`,
        });
        cell.classNum = to;
      });
    // 격자표에도 같은 이동 — 개인표만 옮기면 격자↔개인 교차 검증이 우리 이동을 오류로 잡는다
    // (2026-08-17 실배포 실측: 기하 4건 오탐). 격자·개인이 같은 진실을 보게 한다.
    if (classMap.size)
      for (const d of depts)
        for (const r of d.gridRows) {
          if (!cluster.names.some((n) => subjectMatches(r.subject, n))) continue;
          for (const c of r.cells)
            if (c.grade === grade && classMap.has(c.classNum)) c.classNum = classMap.get(c.classNum)!;
        }
  }
  return { moves, issues };
}


