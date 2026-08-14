/**
 * Phase 9c-F: 1학년 과목 NEIS 등재명 11종 등록 스크립트
 *
 * 근거: docs/phase9c_questionnaire_result_2026-08-14.md §4-3
 *
 * 1학년 실측 과목 11종:
 * - 철학 -> 인간과철학
 * - 통과 -> 통합과학2
 * - 영어 -> 공통영어2
 * - 통사(통사A, 통사B) -> 통합사회2
 * - 한국 -> 한국사2
 * - 수학 -> 공통수학2
 * - 국어 -> 공통국어2
 * - 과탐 -> 과학탐구실험2
 * - 체Ⅰ(체ⅠA, 체ⅠB) -> 체육2
 * - 미술 -> 미술
 * - 진로 -> 진로
 *
 * 2·3학년 및 기타 과목은 neisName: "" (미확정)으로 유지하여
 * phase9c_f_spec B1 차단 규칙이 정상 작동하도록 한다.
 */

import {
  loadActiveTerm,
  loadNeisMapRegistry,
  saveNeisMapRegistry,
} from "../src/lib/timetable/server";
import { NeisSubjectMapping } from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";
const OPERATOR = "fb01@hmh.or.kr";

// §4-3 확정 매핑표 (1학년 11종 및 변형 표기)
const CONFIRMED_G1_MAP: Record<string, string> = {
  철학: "인간과철학",
  통과: "통합과학2",
  영어: "공통영어2",
  통사: "통합사회2",
  통사A: "통합사회2",
  통사B: "통합사회2",
  한국: "한국사2",
  수학: "공통수학2",
  국어: "공통국어2",
  과탐: "과학탐구실험2",
  체Ⅰ: "체육2",
  체ⅠA: "체육2",
  체ⅠB: "체육2",
  미술: "미술",
  진로: "진로",
};

async function main() {
  const term = await loadActiveTerm(DOMAIN);
  if (!term) {
    console.error("활성 학기를 찾을 수 없습니다.");
    process.exit(1);
  }

  const existingRegistry = await loadNeisMapRegistry(DOMAIN);
  console.log("기존 등록부 상태:", {
    subjectsCount: existingRegistry.subjects.length,
    confirmedTeachersCount: existingRegistry.confirmedTeachers.length,
    confirmedPairsCount: existingRegistry.confirmedPairs.length,
  });

  const subjectMap = new Map<string, string>();

  // 1. 기존 등록부 값 유지
  for (const s of existingRegistry.subjects) {
    if (s.platformName) subjectMap.set(s.platformName, s.neisName || "");
  }

  // 2. 현재 학기 term.subjects 시드 반영 (없는 것은 빈 값)
  for (const s of term.subjects) {
    if (!subjectMap.has(s.name)) {
      subjectMap.set(s.name, "");
    }
  }

  // 3. 1학년 11종 매핑 확정값 주입
  for (const [pName, nName] of Object.entries(CONFIRMED_G1_MAP)) {
    subjectMap.set(pName, nName);
  }

  // 4. 리스트 구성 (1학년 확정분 우선 또는 정렬)
  const subjects: NeisSubjectMapping[] = Array.from(subjectMap.entries()).map(
    ([platformName, neisName]) => ({
      platformName,
      neisName,
    })
  );

  const newRegistry = {
    subjects,
    confirmedTeachers: existingRegistry.confirmedTeachers,
    confirmedPairs: existingRegistry.confirmedPairs,
  };

  await saveNeisMapRegistry(DOMAIN, newRegistry, OPERATOR);
  console.log(`\nNEIS 매핑 등록부 저장 완료: 총 ${subjects.length}건 중 매핑 확정 ${subjects.filter((s) => s.neisName).length}건`);
  
  const saved = await loadNeisMapRegistry(DOMAIN);
  console.log("\n[확인된 1학년 매핑 목록]");
  for (const s of saved.subjects.filter((s) => s.neisName)) {
    console.log(`  - ${s.platformName} ➔ ${s.neisName}`);
  }
}

main().catch((err) => {
  console.error("실행 실패:", err);
  process.exit(1);
});
