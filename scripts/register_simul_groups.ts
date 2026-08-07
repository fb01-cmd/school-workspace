/**
 * 동시수업(분반) 그룹 1차 등재 + 검증 (pre_opening_3features_spec §A-5)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/register_simul_groups.ts           ← 드라이런 (판정 셀 전수 출력만)
 *   APPLY=1 npx tsx --env-file=.env.local scripts/register_simul_groups.ts  ← 실제 등재 + 감사 로그
 *
 * GROUPS가 비어 있으면 현재 등록된 그룹과 판정 셀 전수를 출력한다 (검증 전용 모드).
 * 8/7 일과계 목록 수령 후 GROUPS를 채워 드라이런 → 눈 대조 → APPLY=1.
 * 과목명은 기초 그리드 표기와 정확히 일치해야 한다 (드라이런이 0셀이면 표기 불일치 의심).
 */
import "./_force_notify_mock";
import { adminDb } from "../src/lib/firebase/admin";
import { writeAuditLog } from "../src/lib/firebase/audit-server";
import {
  loadAllClassGrids,
  loadSimulGroups,
  loadTimetableSettings,
  simulGroupsColRef,
  validateSimulGroupPayload,
} from "../src/lib/timetable/server";
import { listSimulCells } from "../src/lib/timetable/simul";

const DOMAIN = "hmh.or.kr";
const OPERATOR = "playviolin@hmh.or.kr";

/** 8/7 일과계 목록으로 채울 자리. 예시:
 *  { label: "1학년 제2외국어", grade: 1, classNums: [1,2,3], subjectNames: ["중국어Ⅰ","일본어Ⅰ"] },
 *  { label: "2학년 과학 분반(화·목3)", grade: 2, classNums: [4,5], subjectNames: ["물리학Ⅰ"],
 *    slots: [{ day: 2, period: 3 }, { day: 4, period: 3 }] },
 */
const GROUPS: Array<{
  label: string;
  grade: number;
  classNums: number[];
  subjectNames: string[];
  slots?: { day: number; period: number }[];
}> = [];
// 2026-08-07 1차 등재 완료 (11그룹·판정 86셀 — project_notes.md 체크포인트 참조).
// 재등재 시 중복을 피하려고 GROUPS를 비워둠. 등재 당시 목록은 아래 주석 보존:
/*
  // ── 2학년 (이동수업 현황(2학년2학기).xlsx + 기초 그리드 교시 정렬 실측 2026-08-07) ──
  // 밴드 {1,6,10}: 1반=중국어회화, 6반=인공지능기초, 10반=기하 — 월1·화4·수2·목1
  { label: "2학년 선택 밴드(1·6·10반) 중국어회화·인공지능기초·기하", grade: 2, classNums: [1, 6, 10], subjectNames: ["중화", "인공Ⅱ", "기하"] },
  // 밴드 {2,3}: 2반=일본어회화, 3반=중국어 — 월3·화7·수4·목6
  { label: "2학년 제2외국어 밴드(2·3반) 일본어회화·중국어회화", grade: 2, classNums: [2, 3], subjectNames: ["일화", "중화"] },
  // 밴드 {4,5,7,8}: 4반=일본어회화, 5반=중국어회화, 7반=기하, 8반=인공지능기초 — 월5·수5·목4·금3
  { label: "2학년 선택 밴드(4·5·7·8반) 일본어회화·중국어회화·기하·인공지능기초", grade: 2, classNums: [4, 5, 7, 8], subjectNames: ["일화", "중화", "기하", "인공Ⅱ"] },
  // 과학 {6,10}: 6반=지구시스템과학, 10반=세포와물질대사 — 월6·화1·수5
  { label: "2학년 과학 분반(6·10반) 지구시스템과학·세포와물질대사", grade: 2, classNums: [6, 10], subjectNames: ["지구", "세포"] },
  // 과학 {8,9}: 8반=전자기와양자, 9반=지구시스템과학 — 화3·수3·목6
  { label: "2학년 과학 분반(8·9반) 전자기와양자·지구시스템과학", grade: 2, classNums: [8, 9], subjectNames: ["전자", "지구"] },

  // ── 3학년 (이동수업 현황_2026(3학년).xlsx[1학기 표] + 2학기 기초 그리드 교시 정렬 실측으로 확정) ──
  // 밴드 {1,3,8}: 1반=중국문화, 3반=일본문화, 8반=인공지능기초 — 화5·목3·금4
  { label: "3학년 선택 밴드(1·3·8반) 중국문화·일본문화·인공지능기초", grade: 3, classNums: [1, 3, 8], subjectNames: ["중문", "일문", "인공Ⅲ"] },
  // {1,7}: 1반=수과탐A/B, 7반=논술 — 월5·금3
  { label: "3학년 수과탐·논술 분반(1·7반)", grade: 3, classNums: [1, 7], subjectNames: ["수탐A", "수탐B", "논술B"] },
  // {8,9}: 8반=수과탐, 9반=논술 — 수5·목2
  { label: "3학년 수과탐·논술 분반(8·9반)", grade: 3, classNums: [8, 9], subjectNames: ["수탐", "논술B"] },
  // 과학 {8,9}: 8반=물리학Ⅱ, 9반=생명과학Ⅱ — 월1·화3·금2
  { label: "3학년 과학 분반(8·9반) 물리학Ⅱ·생명과학Ⅱ", grade: 3, classNums: [8, 9], subjectNames: ["물Ⅱ", "생Ⅱ"] },
  // 과학 {6,7}: 6반=지구과학Ⅱ, 7반=화학Ⅱ — 월3·목3·금4
  { label: "3학년 과학 분반(6·7반) 지구과학Ⅱ·화학Ⅱ", grade: 3, classNums: [6, 7], subjectNames: ["지Ⅱ", "화Ⅱ"] },
  // 과학 {6,8,10}: 6반=물리학Ⅱ, 8반=화학Ⅱ, 10반=생명과학Ⅱ — 월5·수4·목5.
  // slots 필수: 화Ⅱ를 과목만으로 걸면 10반 단독 화학Ⅱ(화4·수3·금3)까지 오탐 차단됨.
  { label: "3학년 과학 분반(6·8·10반) 물리학Ⅱ·화학Ⅱ·생명과학Ⅱ", grade: 3, classNums: [6, 8, 10], subjectNames: ["물Ⅱ", "화Ⅱ", "생Ⅱ"],
    slots: [{ day: 1, period: 5 }, { day: 3, period: 4 }, { day: 4, period: 5 }] },
*/

const DAYS = ["", "월", "화", "수", "목", "금"];

function printCells(title: string, cells: ReturnType<typeof listSimulCells>) {
  console.log(`\n[${title}] 판정 셀 ${cells.length}건`);
  for (const c of cells) {
    console.log(
      `  ${c.grade}-${c.classNum} ${DAYS[c.day]}${c.period}교시 | ${c.subjectName} (${c.teacherNames.join(",") || "교사 없음"}) → ${c.groupLabel}`
    );
  }
}

async function run() {
  const settings = await loadTimetableSettings(DOMAIN);
  const termId = settings.activeTermId;
  if (!termId) throw new Error("활성 학기가 없습니다.");
  console.log(`활성 학기: ${termId}`);
  const grids = await loadAllClassGrids(DOMAIN, termId);

  const existing = await loadSimulGroups(DOMAIN, termId);
  console.log(`\n[현재 등록] ${existing.length}건`);
  existing.forEach((g) =>
    console.log(`  ${g.id} | ${g.label} | ${g.grade}학년 ${g.classNums.join(",")}반 | ${g.subjectNames.join(", ")}${g.slots ? ` | 교시 ${g.slots.map((s) => `${DAYS[s.day]}${s.period}`).join(",")}` : ""} | ${g.active ? "활성" : "비활성"}`)
  );
  if (existing.length) printCells("현재 등록분", listSimulCells(grids, existing));

  if (GROUPS.length === 0) {
    console.log("\nGROUPS가 비어 있음 — 검증 전용 모드 종료.");
    return;
  }

  // 신규 등재분 검증 + 드라이런 출력
  const validated = GROUPS.map((raw) => {
    const v = validateSimulGroupPayload({ ...raw, termId });
    if (!v.ok) throw new Error(`그룹 "${raw.label}" 검증 실패: ${v.error}`);
    return v.group;
  });
  const preview = validated.map((g, i) => ({ ...g, id: `new-${i}`, createdBy: "", createdAt: 0 }));
  printCells("등재 예정분", listSimulCells(grids, preview));
  const zero = preview.filter(
    (g) => listSimulCells(grids, [g]).length === 0
  );
  for (const g of zero) console.log(`  ⚠️ "${g.label}"는 판정 셀 0건 — 과목명 표기가 그리드와 다른지 확인 필요`);

  if (process.env.APPLY !== "1") {
    console.log("\n(드라이런 — 위 판정 셀을 일과계 목록과 눈 대조 후 APPLY=1로 등재)");
    return;
  }

  for (const g of validated) {
    const ref = simulGroupsColRef(DOMAIN).doc();
    await ref.set({ ...g, createdBy: OPERATOR, createdAt: Date.now() });
    await writeAuditLog({
      operatorEmail: OPERATOR,
      targetEmail: DOMAIN,
      action: "simul_group_create",
      details: `동시수업 그룹 등재(스크립트): ${g.label} — ${g.grade}학년 ${g.classNums.join(",")}반 / ${g.subjectNames.join(", ")}`,
      status: "success",
    });
    console.log(`  등재됨: ${ref.id} (${g.label})`);
  }
  console.log("\n등재 완료 — 재실행(드라이런)으로 최종 상태를 확인하세요.");
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
