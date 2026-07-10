/**
 * 효명고등학교 CSV 파서 유틸리티
 * 
 * 유연한 파싱: 1/01/001 혼용, 공백 trim, BOM 처리, 빈 행 무시
 */

export interface EnrollmentRow {
  familyName: string;   // 성
  givenName: string;    // 명
  classNum: number;     // 반 (1~10)
  studentNum: number;   // 번호
  serialNum: number;    // 시스템이 부여하는 일련번호 (001~)
}

export interface PromotionRow {
  prevGrade: number;
  prevClass: number;
  prevNum: number;
  newGrade: number;
  newClass: number;
  newNum: number;
}

export interface ParseResult<T> {
  rows: T[];
  errors: { line: number; message: string }[];
  raw: string[][];
}

// Normalize a field: trim, remove BOM, convert to string
const norm = (v: any): string => String(v ?? "").replace(/^\uFEFF/, "").trim();

// Parse integer flexibly: "1", "01", "001" → 1
const flexInt = (v: string): number => {
  const n = parseInt(v.replace(/^0+/, "") || "0", 10);
  return isNaN(n) ? 0 : n;
};


// Parse raw CSV text into 2D array
export const parseCSVText = (text: string): string[][] => {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n");
  return lines
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell !== ""));
};

// ─────────────────────────────────────────────────────
// Parse enrollment CSV
// Expected columns: 성,명,반,번호  (생년월일 미수집)
// ─────────────────────────────────────────────────────
export const parseEnrollmentCSV = (text: string): ParseResult<EnrollmentRow> => {
  const raw = parseCSVText(text);
  const rows: EnrollmentRow[] = [];
  const errors: { line: number; message: string }[] = [];

  if (raw.length < 2) {
    errors.push({ line: 0, message: "데이터가 없습니다. 헤더 포함 최소 2행이 필요합니다." });
    return { rows, errors, raw };
  }

  // Skip header row (line 1)
  const dataRows = raw.slice(1);

  const parsed: Array<{ row: EnrollmentRow; lineNum: number } | null> = dataRows.map((cells, i) => {
    const lineNum = i + 2;

    if (cells.length < 4) {
      errors.push({ line: lineNum, message: `열 수가 부족합니다 (${cells.length}열, 최소 4열 필요)` });
      return null;
    }

    const familyName = norm(cells[0]);
    const givenName = norm(cells[1]);
    const classNum = flexInt(norm(cells[2]));
    const studentNum = flexInt(norm(cells[3]));

    if (!familyName) { errors.push({ line: lineNum, message: "성(姓)이 비어 있습니다." }); return null; }
    if (!givenName) { errors.push({ line: lineNum, message: "이름이 비어 있습니다." }); return null; }
    if (classNum < 1 || classNum > 10) { errors.push({ line: lineNum, message: `반이 유효하지 않습니다: ${classNum}` }); return null; }
    if (studentNum < 1 || studentNum > 99) { errors.push({ line: lineNum, message: `번호가 유효하지 않습니다: ${studentNum}` }); return null; }

    return {
      lineNum,
      row: { familyName, givenName, classNum, studentNum, serialNum: 0 },
    };
  });

  // Sort by classNum, studentNum and assign serial numbers
  const validRows = parsed
    .filter((p): p is { row: EnrollmentRow; lineNum: number } => p !== null)
    .sort((a, b) => a.row.classNum - b.row.classNum || a.row.studentNum - b.row.studentNum);

  validRows.forEach((item, idx) => {
    item.row.serialNum = idx + 1; // Will be offset by startSerial in the component
    rows.push(item.row);
  });

  return { rows, errors, raw };
};

// ─────────────────────────────────────────────────────
// Parse promotion CSV
// Expected columns: 이전학년,이전반,이전번호,새학년,새반,새번호
// ─────────────────────────────────────────────────────
export const parsePromotionCSV = (text: string): ParseResult<PromotionRow> => {
  const raw = parseCSVText(text);
  const rows: PromotionRow[] = [];
  const errors: { line: number; message: string }[] = [];

  if (raw.length < 2) {
    errors.push({ line: 0, message: "데이터가 없습니다." });
    return { rows, errors, raw };
  }

  const dataRows = raw.slice(1);

  dataRows.forEach((cells, i) => {
    const lineNum = i + 2;

    if (cells.length < 6) {
      errors.push({ line: lineNum, message: `열 수 부족 (${cells.length}열, 최소 6열 필요)` });
      return;
    }

    const prevGrade = flexInt(norm(cells[0]));
    const prevClass = flexInt(norm(cells[1]));
    const prevNum = flexInt(norm(cells[2]));
    const newGrade = flexInt(norm(cells[3]));
    const newClass = flexInt(norm(cells[4]));
    const newNum = flexInt(norm(cells[5]));

    if (prevGrade < 1 || prevGrade > 3) { errors.push({ line: lineNum, message: `이전학년 오류: ${prevGrade}` }); return; }
    if (prevClass < 1 || prevClass > 10) { errors.push({ line: lineNum, message: `이전반 오류: ${prevClass}` }); return; }
    if (prevNum < 1 || prevNum > 99) { errors.push({ line: lineNum, message: `이전번호 오류: ${prevNum}` }); return; }
    if (newGrade < 1 || newGrade > 3) { errors.push({ line: lineNum, message: `새학년 오류: ${newGrade}` }); return; }
    if (newClass < 1 || newClass > 10) { errors.push({ line: lineNum, message: `새반 오류: ${newClass}` }); return; }
    if (newNum < 1 || newNum > 99) { errors.push({ line: lineNum, message: `새번호 오류: ${newNum}` }); return; }

    rows.push({ prevGrade, prevClass, prevNum, newGrade, newClass, newNum });
  });

  return { rows, errors, raw };
};

// Build studentId string from grade, class, num
// Format: {grade}{class:2d}{num:2d} e.g. 10101, 21003
export const buildStudentId = (grade: number, classNum: number, num: number): string => {
  return `${grade}${String(classNum).padStart(2, "0")}${String(num).padStart(2, "0")}`;
};

// Parse studentId back to parts
export const parseStudentId = (id: string): { grade: number; classNum: number; num: number } | null => {
  const match = id.match(/^(\d)(\d{2})(\d{2})$/);
  if (!match) return null;
  return {
    grade: parseInt(match[1]),
    classNum: parseInt(match[2]),
    num: parseInt(match[3]),
  };
};

// Generate enrollment CSV template
export const getEnrollmentCSVTemplate = (): string => {
  return `성,명,반,번호
김,민준,1,1
이,서연,1,2
박,지호,2,1`;
};

// Generate promotion CSV template
export const getPromotionCSVTemplate = (): string => {
  return `이전학년,이전반,이전번호,새학년,새반,새번호
1,1,1,2,3,5
1,1,2,2,1,1
2,5,10,3,2,8`;
};
