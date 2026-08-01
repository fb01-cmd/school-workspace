// 2026-08-02 가져오기 매핑 가드 실측: 가상 교사 미매핑 허용 + 학생 계정·형식 오류 차단 + 커밋 재검증
// 실행: npx tsx --env-file=.env.local scripts/verify_import_mapping_guards.ts  (Firestore 쓰기 없음)
import "./_force_notify_mock";
import {
  validateTimetableImport,
  convertIntermediateToClassGrids,
  commitTimetableImport,
} from "../src/lib/timetable/server";
import { IntermediateImportPayload } from "../src/lib/timetable/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function basePayload(overrides: Partial<IntermediateImportPayload>): IntermediateImportPayload {
  return {
    termId: "9999-검증용",
    termName: "매핑 가드 검증",
    rawClassGrids: [
      {
        grade: 1,
        classNum: 1,
        cells: [
          { day: 1, period: 1, subjectName: "음악", subjectShort: "음악", teacherName: "현유지" },
          { day: 1, period: 2, subjectName: "동시그룹", subjectShort: "동시", teacherName: "SLAT" },
          { day: 1, period: 3, subjectName: "창체", subjectShort: "창체", teacherName: "창체" },
        ],
      } as any,
    ],
    teacherEmailMap: {},
    ...overrides,
  };
}

async function main() {
  console.log("=== [가져오기 매핑 가드 실측] ===\n[1] 검증 리포트");

  // 1. 미매칭(비가상) → 차단
  let r = validateTimetableImport(basePayload({ teacherEmailMap: { 현유지: "", SLAT: "", 창체: "" } }));
  check("전원 미매칭 → canCommit false·미매칭 3명", !r.canCommit && r.unmatchedTeachers.length === 3);

  // 2. 가상 교사 지정 → 미매칭에서 제외, 실교사만 매핑되면 통과
  r = validateTimetableImport(basePayload({
    teacherEmailMap: { 현유지: "music@hmh.or.kr", SLAT: "", 창체: "" },
    virtualTeacherNames: ["SLAT", "창체"],
  }));
  check("가상 2명 미매핑 허용 → canCommit true·미매칭 0", r.canCommit && r.unmatchedTeachers.length === 0,
    JSON.stringify({ canCommit: r.canCommit, unmatched: r.unmatchedTeachers, susp: r.suspiciousMappings }));

  // 3. 가상 교사인데 계정도 매핑 → 충돌 차단
  r = validateTimetableImport(basePayload({
    teacherEmailMap: { 현유지: "music@hmh.or.kr", SLAT: "slat-real@hmh.or.kr", 창체: "" },
    virtualTeacherNames: ["SLAT", "창체"],
  }));
  check("가상+계정 동시 지정 → 차단", !r.canCommit && r.suspiciousMappings.some((s) => s.teacherName === "SLAT"));

  // 4. 학번형 계정 매핑 → 차단
  r = validateTimetableImport(basePayload({
    teacherEmailMap: { 현유지: "24029@hmh.or.kr", SLAT: "", 창체: "" },
    virtualTeacherNames: ["SLAT", "창체"],
  }));
  check("학번형(24029@) 매핑 → 학생 의심 차단", !r.canCommit && r.suspiciousMappings.some((s) => s.reason.includes("학번형")));

  // 5. 검색어 원문(이메일 형식 아님) → 차단
  r = validateTimetableImport(basePayload({
    teacherEmailMap: { 현유지: "gotest", SLAT: "", 창체: "" },
    virtualTeacherNames: ["SLAT", "창체"],
  }));
  check("원시 문자열(gotest) 매핑 → 형식 차단", !r.canCommit && r.suspiciousMappings.some((s) => s.reason.includes("형식")));

  console.log("\n[2] 변환 (convertIntermediateToClassGrids)");
  const conv = convertIntermediateToClassGrids(basePayload({
    teacherEmailMap: { 현유지: "music@hmh.or.kr", SLAT: "slat-real@hmh.or.kr", 창체: "" },
    virtualTeacherNames: ["SLAT", "창체"],
  }));
  const cells = conv.classGrids[0].cells;
  const slatLesson = cells.find((c) => c.period === 2)!.lessons[0];
  const realLesson = cells.find((c) => c.period === 1)!.lessons[0];
  check("가상 교사 레슨 이메일 강제 공란 (매핑돼 있어도)", slatLesson.teachers[0].email === "");
  check("실교사 레슨 이메일 정상", realLesson.teachers[0].email === "music@hmh.or.kr");
  const slatSubject = conv.subjects.find((s) => s.name === "동시그룹");
  check("가상 교사는 과목 teacherEmails에 미포함", !!slatSubject && slatSubject.teacherEmails.length === 0);

  console.log("\n[3] 커밋 서버측 재검증 (Firestore 쓰기 전 차단)");
  let threw = "";
  try {
    await commitTimetableImport("hmh.or.kr", basePayload({
      teacherEmailMap: { 현유지: "24029@hmh.or.kr", SLAT: "", 창체: "" },
      virtualTeacherNames: ["SLAT", "창체"],
    }), "admin@hmh.or.kr");
  } catch (e: any) { threw = e.message; }
  check("의심 매핑 커밋 → 저장 조건 미충족으로 거부", threw.includes("저장 조건 미충족"), threw);

  threw = "";
  try {
    await commitTimetableImport("hmh.or.kr", basePayload({
      teacherEmailMap: { 현유지: "" , SLAT: "", 창체: "" },
    }), "admin@hmh.or.kr");
  } catch (e: any) { threw = e.message; }
  check("미매칭 커밋 → 거부 (UI 우회 차단)", threw.includes("저장 조건 미충족"), threw);

  console.log(`\n결과: ${pass}/${pass + fail} 통과${fail ? " — 실패 있음!" : ""} (Firestore 쓰기 0건)`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("실측 오류:", e); process.exit(1); });
