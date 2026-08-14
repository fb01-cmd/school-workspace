/**
 * Phase 9c-H: 교사별 시수표 엑셀 파서 자가 테스트 (phase9c_h_spec §0-1a)
 *
 * 사용법: npx tsx scripts/hours_excel_parser_selftest.ts   ← Firestore 무의존 (순수 함수)
 *
 * 검증 목록:
 * 1. 정상 케이스 (대칭 10-10-10, 총 30개 학급)
 * 2. 학년별 반 수 비대칭 케이스 (스펙 §0-1a-③ⓐ 의무: 1학년 9반·2학년 8반·3학년 9반, 2-1-1 등)
 * 3. 순번 누락 케이스 (중간 행 순번 누락 시 침묵 절단 방지 — 에러 검출)
 * 4. 합계행 이후 데이터 잔여 케이스 (순번 단절로 인한 절단 방지 — 에러 검출)
 * 5. 행 계 불일치 케이스 (무결성 검사 1 위반 검출)
 * 6. 합계행 열합 불일치 케이스 (무결성 검사 2 위반 검출)
 */

import * as XLSX from "xlsx";
import { parseHoursExcel, createMockHoursExcel } from "../src/lib/timetable/excelHoursParser";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("① 정상 대칭 케이스 (10-10-10, 총 30학급)");
{
  const buf = createMockHoursExcel({
    classesByGrade: { 1: 10, 2: 10, 3: 10 },
    rows: [
      {
        seq: 1,
        subjectName: "공통국어1",
        subjectShort: "국어",
        teacherName: "지상인",
        hoursByClass: { "1-1": 3, "1-2": 3, "1-3": 3, "1-4": 3, "1-5": 3 },
      },
      {
        seq: 2,
        subjectName: "공통국어1",
        subjectShort: "국어",
        teacherName: "김지현",
        hoursByClass: { "1-6": 3, "1-7": 3, "1-8": 3, "1-9": 3, "1-10": 3 },
      },
    ],
  });

  const res = parseHoursExcel(buf);
  check("파싱 성공 (success === true)", res.success);
  check("30개 학급 감지", res.classList.length === 30);
  check("2개 과목 행 감지", res.rows.length === 2);
  check("고유 교사 2명 감지", res.distinctTeachers.length === 2);
  check("총 30시간 합계 일치", res.grandTotal === 30);
  check("이슈 0건", res.issues.length === 0);
}

console.log("\n② 학년별 반 수 비대칭 케이스 (스펙 §0-1a-③ⓐ 의무)");
{
  // 1학년 9반, 2학년 8반, 3학년 9반 (총 26반 — 컴시간 매뉴얼 §5-나 실물)
  const buf26 = createMockHoursExcel({
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

  const res26 = parseHoursExcel(buf26);
  check("9-8-9 비대칭 파싱 성공", res26.success);
  check("총 26개 학급(9+8+9) 감지", res26.classList.length === 26);
  check(
    "각 학년별 반 수 매핑 (1학년 9, 2학년 8, 3학년 9)",
    res26.classList.filter((c) => c.grade === 1).length === 9 &&
      res26.classList.filter((c) => c.grade === 2).length === 8 &&
      res26.classList.filter((c) => c.grade === 3).length === 9
  );
  check("총 21시간 일치 (12 + 9)", res26.grandTotal === 21);

  // 극단적 비대칭 (1학년 2반, 2학년 1반, 3학년 1반 = 총 4반 — cohort_selftest ④ 동형)
  const buf4 = createMockHoursExcel({
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
  const res4 = parseHoursExcel(buf4);
  check("2-1-1 극단 비대칭 파싱 성공", res4.success);
  check("총 4개 학급 감지", res4.classList.length === 4);
  check(
    "1학년 2반 존재 & 2학년 2반 부존재",
    res4.classList.some((c) => c.grade === 1 && c.classNum === 2) &&
      !res4.classList.some((c) => c.grade === 2 && c.classNum === 2)
  );
}

console.log("\n③ 침묵 절단 결함 1: 중간 행 순번 누락 케이스 (실패 및 에러 검출)");
{
  // 데이터 행인데 순번(seq)이 비어있는 경우
  const badData: any[][] = [
    ["교사별 시수표"],
    ["순", "정식과목명", "단축과목명", "교사명", "1학년", "2학년", "계"],
    [null, null, null, null, 1, 1, null],
    [1, "국어", "국어", "지상인", 3, 3, 6],
    [null, "영어", "영어", "김지현", 3, 3, 6], // 순번 누락된 데이터 행!
    [null, null, null, null, 6, 6, 12],
  ];
  const ws = XLSX.utils.aoa_to_sheet(badData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "교사별시수표");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const res = parseHoursExcel(buf);
  check("파싱 실패 (success === false)", !res.success);
  check(
    "순번 누락 에러 메시지 생성",
    res.issues.some((i) => i.severity === "error" && i.message.includes("순번이 누락된 데이터 행"))
  );
}

console.log("\n④ 침묵 절단 결함 2: 합계행 이후 데이터 행 잔여 케이스 (순번 단절 검출)");
{
  // 합계행(빈 순번) 뒤에 또 데이터 행이 남아있는 경우
  const brokenData: any[][] = [
    ["교사별 시수표"],
    ["순", "정식과목명", "단축과목명", "교사명", "1학년", "2학년", "계"],
    [null, null, null, null, 1, 1, null],
    [1, "국어", "국어", "지상인", 3, 3, 6],
    [null, null, null, null, 3, 3, 6], // 합계행 (순번 빈칸)
    [2, "수학", "수학", "이순신", 4, 4, 8], // 합계행 뒤에 버려질 뻔한 잔여 데이터 행!
  ];
  const ws = XLSX.utils.aoa_to_sheet(brokenData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "교사별시수표");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const res = parseHoursExcel(buf);
  check("파싱 실패 (success === false)", !res.success);
  check(
    "합계행 이후 데이터 잔여 에러 검출",
    res.issues.some((i) => i.severity === "error" && i.message.includes("합계행 이후 데이터 행 존재"))
  );
}

console.log("\n⑤ 무결성 검사 1: 행 계 불일치 케이스");
{
  const badRowSumData: any[][] = [
    ["교사별 시수표"],
    ["순", "정식과목명", "단축과목명", "교사명", "1학년", "2학년", "계"],
    [null, null, null, null, 1, 1, null],
    [1, "국어", "국어", "지상인", 3, 3, 999], // 계가 6이어야 하는데 999
    [null, null, null, null, 3, 3, 6],
  ];
  const ws = XLSX.utils.aoa_to_sheet(badRowSumData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "교사별시수표");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const res = parseHoursExcel(buf);
  check("파싱 실패 (success === false)", !res.success);
  check(
    "행 계 불일치 에러 검출",
    res.issues.some((i) => i.severity === "error" && i.message.includes("일치하지 않습니다"))
  );
}

console.log("\n⑥ 무결성 검사 2: 합계행 열합 불일치 케이스");
{
  const badColSumData: any[][] = [
    ["교사별 시수표"],
    ["순", "정식과목명", "단축과목명", "교사명", "1학년", "2학년", "계"],
    [null, null, null, null, 1, 1, null],
    [1, "국어", "국어", "지상인", 3, 3, 6],
    [null, null, null, null, 100, 3, 103], // 1학년 1반 열합이 3이어야 하는데 100
  ];
  const ws = XLSX.utils.aoa_to_sheet(badColSumData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "교사별시수표");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const res = parseHoursExcel(buf);
  check(
    "열합 불일치 경고 검출",
    res.issues.some((i) => i.severity === "warning" && i.message.includes("계산된 열합"))
  );
}

console.log("\n⑦ 단축과목명 충돌 검사 (스펙 §0-1a-②': 같은 단축명이 서로 다른 정식명에 걸릴 때)");
{
  // 같은 단축명 "국어"가 정식명 "공통국어1"과 "심화국어"에 중복 사용된 경우
  const collisionData: any[][] = [
    ["교사별 시수표"],
    ["순", "정식과목명", "단축과목명", "교사명", "1학년", "2학년", "계"],
    [null, null, null, null, 1, 1, null],
    [1, "공통국어1", "국어", "지상인", 3, 3, 6],
    [2, "심화국어", "국어", "김지현", 2, 2, 4], // 단축명 "국어" 충돌!
    [null, null, null, null, 5, 5, 10],
  ];
  const ws = XLSX.utils.aoa_to_sheet(collisionData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "교사별시수표");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

  const res = parseHoursExcel(buf);
  check("파싱 자체는 성공 (warning)", res.success);
  check(
    "단축과목명 충돌 경고 생성 확인",
    res.issues.some(
      (i) =>
        i.severity === "warning" &&
        i.message.includes("단축과목명 '국어'가 서로 다른 정식과목명(공통국어1, 심화국어)에 사용되었습니다")
    )
  );
}

console.log("\n" + "=".repeat(50));
console.log(`결과: ${pass}건 통과, ${fail}건 실패 (총 ${pass + fail}건)`);
if (fail > 0) process.exit(1);
