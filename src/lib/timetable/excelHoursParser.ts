/**
 * Phase 9c-H: 교사별 시수표 엑셀 파서 (docs/phase9c_h_spec.md §0-1a)
 *
 * 컴시간 교사별 시수표 엑셀(.xls / .xlsx) 형식을 파싱하고 무결성 3종을 검증합니다:
 * 1. 행 계 = 반별 셀 합
 * 2. 합계행 반별 열합 = 위 전체 행의 열합
 * 3. 전 셀 정수 검사 & 순번 연속성 검사
 *
 * 학년별 반 수 비대칭 지원 (§0-1a-③ⓐ):
 * - 학년마다 반 수가 달라도 (예: 1학년 9반, 2학년 8반, 3학년 9반)
 *   헤더 1행(학년)과 2행(반 번호)을 동적으로 순회하여 학급 목록을 구성합니다.
 */
import * as XLSX from "xlsx";

export interface ParsedHoursRow {
  seq: number;
  subjectName: string;
  subjectShort: string;
  teacherName: string;
  classHours: Array<{ grade: number; classNum: number; hours: number }>;
  totalHours: number;
}

export interface ParsedHoursResult {
  success: boolean;
  rows: ParsedHoursRow[];
  classList: Array<{ grade: number; classNum: number }>;
  distinctTeachers: string[];
  columnSums: Record<string, number>; // key: `${grade}-${classNum}`
  grandTotal: number;
  issues: Array<{ severity: "error" | "warning"; message: string }>;
}

export function parseHoursExcel(data: ArrayBuffer | Uint8Array): ParsedHoursResult {
  const issues: Array<{ severity: "error" | "warning"; message: string }> = [];
  const rows: ParsedHoursRow[] = [];
  const classList: Array<{ grade: number; classNum: number }> = [];
  const distinctTeachersSet = new Set<string>();
  const columnSums: Record<string, number> = {};
  let grandTotal = 0;

  try {
    const wb = XLSX.read(data, { type: "array" });
    if (!wb.SheetNames || wb.SheetNames.length === 0) {
      return {
        success: false,
        rows: [],
        classList: [],
        distinctTeachers: [],
        columnSums: {},
        grandTotal: 0,
        issues: [{ severity: "error", message: "엑셀 파일에 시트가 없습니다." }],
      };
    }

    // 첫 번째 시트 사용 (스펙 §0-1a-③)
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (!rawData || rawData.length < 4) {
      return {
        success: false,
        rows: [],
        classList: [],
        distinctTeachers: [],
        columnSums: {},
        grandTotal: 0,
        issues: [{ severity: "error", message: "시수표 데이터 행이 부족합니다 (최소 4행 이상 필요)." }],
      };
    }

    // 1. 헤더 분석 (Row 1: 학년 레이블, Row 2: 반 번호)
    // 0행: 제목 ("교사별 시수표")
    // 1행: ["순", "정식과목명", "단축과목명", "교사명", "1학년", ..., "2학년", ..., "3학년", ..., "계"]
    // 2행: [null, null, null, null, 1, 2, ..., 10, 1, 2, ..., 10, ...]
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(5, rawData.length); r++) {
      const row = rawData[r] || [];
      const hasSeq = row.some((c) => String(c || "").trim() === "순");
      const hasSubject = row.some((c) => String(c || "").trim().includes("과목명"));
      const hasTeacher = row.some((c) => String(c || "").trim().includes("교사명"));
      if (hasSeq && (hasSubject || hasTeacher)) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx === -1) {
      return {
        success: false,
        rows: [],
        classList: [],
        distinctTeachers: [],
        columnSums: {},
        grandTotal: 0,
        issues: [{ severity: "error", message: "시수표 헤더 행('순', '정식과목명', '교사명')을 찾을 수 없습니다." }],
      };
    }

    const headerRow1 = rawData[headerRowIdx] || [];
    const headerRow2 = rawData[headerRowIdx + 1] || [];

    // 열 매핑 구성: colIdx -> { grade, classNum } | "seq" | "subjectName" | "subjectShort" | "teacherName" | "total"
    const colMap: Map<number, { type: "class"; grade: number; classNum: number } | { type: "meta"; key: string }> = new Map();

    let currentGrade = 0;
    let totalColIdx = -1;

    for (let c = 0; c < Math.max(headerRow1.length, headerRow2.length); c++) {
      const val1 = String(headerRow1[c] || "").trim();
      const val2 = String(headerRow2[c] || "").trim();

      if (val1 === "순") {
        colMap.set(c, { type: "meta", key: "seq" });
        continue;
      }
      if (val1 === "정식과목명" || val1.includes("정식과목")) {
        colMap.set(c, { type: "meta", key: "subjectName" });
        continue;
      }
      if (val1 === "단축과목명" || val1 === "과목명" || val1.includes("단축과목")) {
        colMap.set(c, { type: "meta", key: "subjectShort" });
        continue;
      }
      if (val1 === "교사명" || val1.includes("교사")) {
        colMap.set(c, { type: "meta", key: "teacherName" });
        continue;
      }
      if (val1 === "계" || val1 === "합계" || val1.includes("총계")) {
        colMap.set(c, { type: "meta", key: "total" });
        totalColIdx = c;
        continue;
      }

      // 학년 헤더 감지 ("1학년", "1", "2학년", "3학년" 등)
      const gradeMatch = val1.match(/^([1-3])(\s*학년)?$/);
      if (gradeMatch) {
        currentGrade = parseInt(gradeMatch[1], 10);
      }

      // 반 번호 감지 (headerRow2의 숫자)
      const classNum = parseInt(val2, 10);
      if (currentGrade > 0 && !isNaN(classNum) && classNum > 0) {
        colMap.set(c, { type: "class", grade: currentGrade, classNum });
        classList.push({ grade: currentGrade, classNum });
      }
    }

    if (classList.length === 0) {
      return {
        success: false,
        rows: [],
        classList: [],
        distinctTeachers: [],
        columnSums: {},
        grandTotal: 0,
        issues: [{ severity: "error", message: "학급 열(1~3학년 반)을 파싱할 수 없습니다." }],
      };
    }

    // 2. 데이터 행 파싱 (headerRowIdx + 2 부터 시작)
    const startDataRow = headerRowIdx + 2;
    let expectedSeq = 1;
    let sumRow: any[] | null = null;

    for (let r = startDataRow; r < rawData.length; r++) {
      const row = rawData[r] || [];
      if (row.length === 0 || row.every((c) => c === null || c === undefined || String(c).trim() === "")) {
        continue;
      }

      // seq 컬럼 확인
      let seqVal: any = null;
      let subjectName = "";
      let subjectShort = "";
      let teacherName = "";
      let reportedTotal = 0;
      let hasReportedTotal = false;

      const cellHoursMap = new Map<string, number>();

      for (let c = 0; c < row.length; c++) {
        const mapping = colMap.get(c);
        if (!mapping) continue;

        const rawVal = row[c];
        if (mapping.type === "meta") {
          if (mapping.key === "seq") seqVal = rawVal;
          else if (mapping.key === "subjectName") subjectName = String(rawVal || "").trim();
          else if (mapping.key === "subjectShort") subjectShort = String(rawVal || "").trim();
          else if (mapping.key === "teacherName") teacherName = String(rawVal || "").trim();
          else if (mapping.key === "total") {
            if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== "") {
              reportedTotal = Number(rawVal);
              hasReportedTotal = true;
            }
          }
        } else if (mapping.type === "class") {
          const key = `${mapping.grade}-${mapping.classNum}`;
          if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== "") {
            const h = Number(rawVal);
            if (isNaN(h) || !Number.isInteger(h) || h < 0) {
              issues.push({
                severity: "error",
                message: `${r + 1}행 ${mapping.grade}학년 ${mapping.classNum}반 시수 '${rawVal}'는 올바른 정수가 아닙니다.`,
              });
            } else {
              cellHoursMap.set(key, h);
            }
          } else {
            cellHoursMap.set(key, 0);
          }
        }
      }

      // 순번이 없거나 정수가 아닌 경우 -> 합계행인지 확인 (스펙 §0-1a-① 규칙 5)
      const numSeq = parseInt(String(seqVal || ""), 10);
      if (isNaN(numSeq) || numSeq <= 0) {
        // 합계행으로 판정하고 데이터 행 파싱 종료
        sumRow = row;
        break;
      }

      // 순번 연속성 검사
      if (numSeq !== expectedSeq) {
        issues.push({
          severity: "warning",
          message: `${r + 1}행의 순번(${numSeq})이 예상 순번(${expectedSeq})과 다릅니다.`,
        });
      }
      expectedSeq = numSeq + 1;

      // 행별 반 시수 배열 구성
      let calculatedRowSum = 0;
      const classHours: Array<{ grade: number; classNum: number; hours: number }> = [];
      for (const cls of classList) {
        const key = `${cls.grade}-${cls.classNum}`;
        const h = cellHoursMap.get(key) || 0;
        calculatedRowSum += h;
        if (h > 0) {
          classHours.push({ grade: cls.grade, classNum: cls.classNum, hours: h });
        }
      }

      // 무결성 검사 1: 행 계 = 반별 셀 합
      if (hasReportedTotal && calculatedRowSum !== reportedTotal) {
        issues.push({
          severity: "error",
          message: `순번 ${numSeq}(${subjectName}/${teacherName}): 엑셀에 기재된 계(${reportedTotal})와 실제 반별 합계(${calculatedRowSum})가 일치하지 않습니다.`,
        });
      }

      if (teacherName) {
        distinctTeachersSet.add(teacherName);
      }

      rows.push({
        seq: numSeq,
        subjectName,
        subjectShort: subjectShort || subjectName.slice(0, 2),
        teacherName,
        classHours,
        totalHours: calculatedRowSum,
      });
    }

    if (rows.length === 0) {
      return {
        success: false,
        rows: [],
        classList,
        distinctTeachers: [],
        columnSums: {},
        grandTotal: 0,
        issues: [{ severity: "error", message: "유효한 시수표 데이터 행이 없습니다." }],
      };
    }

    // 3. 열별 합계 계산 및 합계행 대조 (무결성 검사 2)
    for (const cls of classList) {
      const key = `${cls.grade}-${cls.classNum}`;
      let colSum = 0;
      for (const row of rows) {
        const hit = row.classHours.find((ch) => ch.grade === cls.grade && ch.classNum === cls.classNum);
        if (hit) colSum += hit.hours;
      }
      columnSums[key] = colSum;
      grandTotal += colSum;
    }

    if (sumRow) {
      // sumRow에서 열합 대조
      for (let c = 0; c < sumRow.length; c++) {
        const mapping = colMap.get(c);
        if (!mapping) continue;

        if (mapping.type === "class") {
          const key = `${mapping.grade}-${mapping.classNum}`;
          const expectedColSum = columnSums[key] || 0;
          const reportedColSum = Number(sumRow[c] || 0);
          if (reportedColSum > 0 && reportedColSum !== expectedColSum) {
            issues.push({
              severity: "warning",
              message: `${mapping.grade}학년 ${mapping.classNum}반: 합계행 기재값(${reportedColSum})과 계산된 열합(${expectedColSum})이 일치하지 않습니다.`,
            });
          }
        } else if (mapping.type === "meta" && mapping.key === "total") {
          const reportedGrandTotal = Number(sumRow[c] || 0);
          if (reportedGrandTotal > 0 && reportedGrandTotal !== grandTotal) {
            issues.push({
              severity: "warning",
              message: `총계 불일치: 합계행 총계(${reportedGrandTotal})와 계산된 총계(${grandTotal})가 다릅니다.`,
            });
          }
        }
      }
    }

    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      success: !hasErrors,
      rows,
      classList,
      distinctTeachers: Array.from(distinctTeachersSet).sort(),
      columnSums,
      grandTotal,
      issues,
    };
  } catch (err: any) {
    return {
      success: false,
      rows: [],
      classList: [],
      distinctTeachers: [],
      columnSums: {},
      grandTotal: 0,
      issues: [{ severity: "error", message: `엑셀 파싱 중 예외 발생: ${err.message || String(err)}` }],
    };
  }
}

// ═════════════════════════════════════════════════════════════
// 자가 테스트 (Self-Test Suite) — 학년별 반 수 비대칭 포함
// ═════════════════════════════════════════════════════════════

/**
 * 인메모리 XLSX 버퍼 생성 헬퍼
 */
export function createMockHoursExcel(options: {
  classesByGrade: Record<number, number>; // e.g. { 1: 9, 2: 8, 3: 9 }
  rows: Array<{
    seq: number;
    subjectName: string;
    subjectShort: string;
    teacherName: string;
    hoursByClass: Record<string, number>; // key: `${grade}-${classNum}`
  }>;
  sumRow?: boolean;
}): Uint8Array {
  const grades = Object.keys(options.classesByGrade).map(Number).sort((a, b) => a - b);

  // Row 0: 제목
  const r0 = ["교사별 시수표"];

  // Row 1 & Row 2 헤더
  const r1: any[] = ["순", "정식과목명", "단축과목명", "교사명"];
  const r2: any[] = [null, null, null, null];

  for (const g of grades) {
    const classCount = options.classesByGrade[g];
    r1.push(`${g}학년`);
    for (let i = 1; i < classCount; i++) r1.push(null);

    for (let c = 1; c <= classCount; c++) {
      r2.push(c);
    }
  }
  r1.push("계");
  r2.push(null);

  const data: any[][] = [r0, r1, r2];

  // 데이터 행
  const colSums: number[] = new Array(r2.length).fill(0);
  let totalGrand = 0;

  for (const r of options.rows) {
    const dataRow: any[] = [r.seq, r.subjectName, r.subjectShort, r.teacherName];
    let rowSum = 0;

    let colIdx = 4;
    for (const g of grades) {
      const classCount = options.classesByGrade[g];
      for (let c = 1; c <= classCount; c++) {
        const key = `${g}-${c}`;
        const h = r.hoursByClass[key] || 0;
        dataRow.push(h > 0 ? h : null);
        colSums[colIdx] += h;
        rowSum += h;
        colIdx++;
      }
    }
    dataRow.push(rowSum);
    totalGrand += rowSum;
    data.push(dataRow);
  }

  // 합계행
  if (options.sumRow !== false) {
    const sumDataRow: any[] = [null, null, null, null];
    let colIdx = 4;
    for (const g of grades) {
      const classCount = options.classesByGrade[g];
      for (let c = 1; c <= classCount; c++) {
        sumDataRow.push(colSums[colIdx]);
        colIdx++;
      }
    }
    sumDataRow.push(totalGrand);
    data.push(sumDataRow);
  }

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "교사별시수표");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

/**
 * 파서 자가 테스트 함수 (비대칭 학급 포함)
 */
export function runExcelHoursParserSelfTests(): {
  total: number;
  passed: number;
  failed: number;
  errors: string[];
} {
  const errors: string[] = [];
  let passed = 0;
  let total = 0;

  const assert = (condition: boolean, desc: string) => {
    total++;
    if (condition) {
      passed++;
    } else {
      errors.push(`Assertion failed: ${desc}`);
    }
  };

  // 1. 대칭 학급 (10-10-10) 테스트
  const buf10_10_10 = createMockHoursExcel({
    classesByGrade: { 1: 10, 2: 10, 3: 10 },
    rows: [
      {
        seq: 1,
        subjectName: "국어",
        subjectShort: "국어",
        teacherName: "홍길동",
        hoursByClass: { "1-1": 4, "1-2": 4, "1-3": 4 },
      },
    ],
  });
  const res10_10_10 = parseHoursExcel(buf10_10_10);
  assert(res10_10_10.success, "대칭 10-10-10 파싱 성공");
  assert(res10_10_10.classList.length === 30, "대칭 10-10-10 총 30개 학급 감지");
  assert(res10_10_10.rows.length === 1 && res10_10_10.rows[0].totalHours === 12, "대칭 10-10-10 1행 12시수 일치");

  // 2. 비대칭 학급 (1학년 9반, 2학년 8반, 3학년 9반 = 총 26개 반) 테스트 (컴시간 매뉴얼 §5-나 실물)
  const bufAsym9_8_9 = createMockHoursExcel({
    classesByGrade: { 1: 9, 2: 8, 3: 9 },
    rows: [
      {
        seq: 1,
        subjectName: "수학",
        subjectShort: "수학",
        teacherName: "이순신",
        hoursByClass: { "1-9": 4, "2-8": 4, "3-9": 4 },
      },
      {
        seq: 2,
        subjectName: "영어",
        subjectShort: "영어",
        teacherName: "강감찬",
        hoursByClass: { "1-1": 3, "2-1": 3, "3-1": 3 },
      },
    ],
  });
  const resAsym9_8_9 = parseHoursExcel(bufAsym9_8_9);
  assert(resAsym9_8_9.success, "비대칭 9-8-9 파싱 성공");
  assert(resAsym9_8_9.classList.length === 26, "비대칭 9-8-9 총 26개 학급(9+8+9) 감지");
  assert(
    resAsym9_8_9.classList.filter((c) => c.grade === 1).length === 9 &&
      resAsym9_8_9.classList.filter((c) => c.grade === 2).length === 8 &&
      resAsym9_8_9.classList.filter((c) => c.grade === 3).length === 9,
    "비대칭 9-8-9 각 학년별 반 수 정확 매핑"
  );
  assert(resAsym9_8_9.grandTotal === 21, "비대칭 9-8-9 총 21시수 일치");

  // 3. 극단적 비대칭 학급 (1학년 2반, 2학년 1반, 3학년 1반 = 총 4개 반) 테스트 (cohort_selftest ④와 동형)
  const bufAsym2_1_1 = createMockHoursExcel({
    classesByGrade: { 1: 2, 2: 1, 3: 1 },
    rows: [
      {
        seq: 1,
        subjectName: "과학",
        subjectShort: "과학",
        teacherName: "장영실",
        hoursByClass: { "1-1": 3, "1-2": 3, "2-1": 3, "3-1": 3 },
      },
    ],
  });
  const resAsym2_1_1 = parseHoursExcel(bufAsym2_1_1);
  assert(resAsym2_1_1.success, "극단적 비대칭 2-1-1 파싱 성공");
  assert(resAsym2_1_1.classList.length === 4, "극단적 비대칭 2-1-1 총 4개 학급 감지");
  assert(
    resAsym2_1_1.classList.some((c) => c.grade === 1 && c.classNum === 2) &&
      !resAsym2_1_1.classList.some((c) => c.grade === 2 && c.classNum === 2),
    "1학년에만 2반이 있고 2학년에는 2반이 없음 확인"
  );

  // 4. 무결성 검사: 행 계 불일치 감지 테스트
  // 임의로 엑셀 데이터 AOA 수정하여 계를 틀리게 만듦
  const badRowData: any[][] = [
    ["교사별 시수표"],
    ["순", "정식과목명", "단축과목명", "교사명", "1학년", "2학년", "계"],
    [null, null, null, null, 1, 1, null],
    [1, "국어", "국어", "홍길동", 3, 3, 999], // 계가 6이어야 하는데 999
    [null, null, null, null, 3, 3, 6],
  ];
  const wsBad = XLSX.utils.aoa_to_sheet(badRowData);
  const wbBad = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbBad, wsBad, "교사별시수표");
  const bufBad = XLSX.write(wbBad, { type: "array", bookType: "xlsx" });
  const resBad = parseHoursExcel(bufBad);
  assert(!resBad.success, "행 계 불일치 시 success === false");
  assert(
    resBad.issues.some((i) => i.severity === "error" && i.message.includes("일치하지 않습니다")),
    "행 계 불일치 에러 메시지 생성 확인"
  );

  return { total, passed, failed: total - passed, errors };
}
