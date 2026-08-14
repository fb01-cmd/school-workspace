/**
 * Phase 9c-H: 교사별 시수표 엑셀 파서 (docs/phase9c_h_spec.md §0-1a)
 *
 * 컴시간 교사별 시수표 엑셀(.xls / .xlsx) 형식을 파싱하고 무결성 3종을 검증합니다:
 * 1. 행 계 = 반별 셀 합
 * 2. 합계행 반별 열합 = 위 전체 행의 열합
 * 3. 전 셀 정수 검사 & 순번 연속성 검사
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
      const gradeMatch = val1.match(/([1-3])\s*학년/);
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
