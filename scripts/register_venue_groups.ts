/**
 * 특별실 배정 1차 등재 + 검증 (pre_opening_3features_spec §F)
 *
 * 사용법:
 *   npx tsx --env-file=.env.local scripts/register_venue_groups.ts           ← 드라이런 (판정 셀·기초 충돌·엔진 스모크)
 *   APPLY=1 npx tsx --env-file=.env.local scripts/register_venue_groups.ts  ← 실제 등재 + 감사 로그
 *
 * GROUPS가 비어 있으면 현재 등록된 배정과 판정 셀 전수를 출력한다 (검증 전용 모드).
 * 데이터 출처: 2026-08-07 일과계(송혜원) 컴시간 특별실 시간표 스크린샷 — project_notes.md 체크포인트 참조.
 * 기대 시수: 다윗관 30 / 탁구장 30 / 정보실 27 / 생명과학실 16 (컴시간 표기와 일치해야 함).
 */
import "./_force_notify_mock";
import { writeAuditLog } from "../src/lib/firebase/audit-server";
import {
  loadAllClassGrids,
  loadTimetableSettings,
  loadVenueGroups,
  validateVenueGroupPayload,
  venueGroupsColRef,
} from "../src/lib/timetable/server";
import { applyVenueMarks, findVenueBaseConflicts, listVenueCells } from "../src/lib/timetable/venue";
import { buildSlotIndex, findSwapCandidates } from "../src/lib/timetable/swap";
import { synthesizeWeeklyGrids } from "../src/lib/timetable/weekly";
import { listWeeks, loadWeekChanges } from "../src/lib/timetable/server";

const DOMAIN = "hmh.or.kr";
const OPERATOR = "playviolin@hmh.or.kr";
const ALL10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 2026-08-07 1차 등재 완료 (18건·판정 103셀 — project_notes.md 체크포인트 참조).
 *  재실행 APPLY 시 중복 등재를 피하려고 GROUPS를 비워둠. 등재 당시 목록은 아래 주석 보존. */
const GROUPS: Array<{
  roomName: string;
  label: string;
  grade: number;
  classNums: number[];
  subjectNames: string[];
  slots?: { day: number; period: number }[];
}> = [];
/* 등재 당시 목록 (2026-08-07):
  // ── 다윗관(101) — 30시수: 1학년 체ⅠA(각 1) + 2학년 체Ⅱ(각 2) ──
  { roomName: "다윗관", label: "1학년 체육A", grade: 1, classNums: ALL10, subjectNames: ["체ⅠA"] },
  { roomName: "다윗관", label: "2학년 체육", grade: 2, classNums: ALL10, subjectNames: ["체Ⅱ"] },
  // ── 탁구장(102) — 30시수: 1학년 체ⅠB(각 1) + 3학년 체Ⅲ(각 2) ──
  { roomName: "탁구장", label: "1학년 체육B", grade: 1, classNums: ALL10, subjectNames: ["체ⅠB"] },
  { roomName: "탁구장", label: "3학년 체육", grade: 3, classNums: ALL10, subjectNames: ["체Ⅲ"] },
  // ── 정보실(103) — 27시수: 2학년 인공Ⅱ(6·8·9반 각 4) + 3학년 인공Ⅲ(6~10반 각 3) ──
  { roomName: "정보실", label: "2학년 인공지능기초", grade: 2, classNums: [6, 8, 9], subjectNames: ["인공Ⅱ"] },
  { roomName: "정보실", label: "3학년 인공지능기초", grade: 3, classNums: [6, 7, 8, 9, 10], subjectNames: ["인공Ⅲ"] },
  // ── 생명과학실(104) — 16시수: 1학년 과탐 실험(반별 지정 1교시) + 2-9 지구(전 3시수) + 3-6 지Ⅱ(전 3시수) ──
  { roomName: "생명과학실", label: "2학년 9반 지구시스템과학", grade: 2, classNums: [9], subjectNames: ["지구"] },
  { roomName: "생명과학실", label: "3학년 6반 지구과학Ⅱ", grade: 3, classNums: [6], subjectNames: ["지Ⅱ"] },
  // 과탐은 반마다 실험 배정 교시가 달라 slots 필수 (나머지 과탐 시수는 일반 교실)
  { roomName: "생명과학실", label: "1-1 과탐 실험", grade: 1, classNums: [1], subjectNames: ["과탐"], slots: [{ day: 4, period: 5 }] },
  { roomName: "생명과학실", label: "1-2 과탐 실험", grade: 1, classNums: [2], subjectNames: ["과탐"], slots: [{ day: 1, period: 5 }] },
  { roomName: "생명과학실", label: "1-3 과탐 실험", grade: 1, classNums: [3], subjectNames: ["과탐"], slots: [{ day: 2, period: 4 }] },
  { roomName: "생명과학실", label: "1-4 과탐 실험", grade: 1, classNums: [4], subjectNames: ["과탐"], slots: [{ day: 4, period: 1 }] },
  { roomName: "생명과학실", label: "1-5 과탐 실험", grade: 1, classNums: [5], subjectNames: ["과탐"], slots: [{ day: 2, period: 2 }] },
  { roomName: "생명과학실", label: "1-6 과탐 실험", grade: 1, classNums: [6], subjectNames: ["과탐"], slots: [{ day: 1, period: 2 }] },
  { roomName: "생명과학실", label: "1-7 과탐 실험", grade: 1, classNums: [7], subjectNames: ["과탐"], slots: [{ day: 5, period: 3 }] },
  { roomName: "생명과학실", label: "1-8 과탐 실험", grade: 1, classNums: [8], subjectNames: ["과탐"], slots: [{ day: 4, period: 4 }] },
  { roomName: "생명과학실", label: "1-9 과탐 실험", grade: 1, classNums: [9], subjectNames: ["과탐"], slots: [{ day: 1, period: 4 }] },
  { roomName: "생명과학실", label: "1-10 과탐 실험", grade: 1, classNums: [10], subjectNames: ["과탐"], slots: [{ day: 3, period: 4 }] },
*/

const DAYS = ["", "월", "화", "수", "목", "금"];

function printCells(title: string, cells: ReturnType<typeof listVenueCells>) {
  console.log(`\n[${title}] 판정 셀 ${cells.length}건`);
  const byRoom = new Map<string, number>();
  for (const c of cells) {
    byRoom.set(c.roomName, (byRoom.get(c.roomName) || 0) + 1);
    console.log(
      `  ${c.roomName} | ${c.grade}-${c.classNum} ${DAYS[c.day]}${c.period}교시 | ${c.subjectName} (${c.teacherNames.join(",") || "교사 없음"})`
    );
  }
  console.log(
    "  ── 실별 시수:",
    [...byRoom.entries()].map(([r, n]) => `${r} ${n}`).join(" / "),
    "(기대: 다윗관 30 / 탁구장 30 / 정보실 27 / 생명과학실 16)"
  );
}

/** 엔진 스모크 — 이번 주 합성본에서 체육 수업 하나의 맞교환 후보를 마크 전/후로 비교 */
async function engineSmoke(termId: string, grids: any[], stamped: boolean) {
  const settings = await loadTimetableSettings(DOMAIN);
  const weeks = await listWeeks(DOMAIN, termId);
  if (!weeks.length) return console.log("  (주 미등록 — 엔진 스모크 생략)");
  const week = weeks.sort((a, b) => a.startDate.localeCompare(b.startDate))[weeks.length - 1];
  const changes = await loadWeekChanges(DOMAIN, week.id);
  const { grids: weekly } = synthesizeWeeklyGrids(grids, week, changes, settings);
  // 소스: 2학년에서 체Ⅱ 셀 하나 찾기
  let src: { grade: number; classNum: number; day: number; period: number } | null = null;
  let teacher = "";
  outer: for (const g of weekly.filter((x) => x.grade === 2)) {
    for (const cell of g.cells) {
      for (const l of cell.lessons) {
        if (l.subjectName === "체Ⅱ" && l.teachers?.[0]?.email) {
          src = { grade: g.grade, classNum: g.classNum, day: cell.day, period: cell.period };
          teacher = l.teachers[0].email;
          break outer;
        }
      }
    }
  }
  if (!src) return console.log("  (체Ⅱ 셀을 찾지 못해 스모크 생략)");
  const { candidates, error } = findSwapCandidates(weekly, week, settings, teacher, src as any);
  if (error) return console.log(`  스모크 소스 오류: ${error}`);
  // 검산: 후보 목표 슬롯에 타 학급 다윗관 사용이 남아 있으면 위반
  const idx = buildSlotIndex(weekly);
  const own = `${src.grade}-${src.classNum}`;
  const bad = candidates.filter((c) => {
    const users = idx.roomUse.get(`${c.targetDay}-${c.targetPeriod}`)?.get("다윗관");
    return users && [...users].some((k) => k !== own);
  });
  console.log(
    `  [마크 ${stamped ? "적용" : "미적용"}] ${src.grade}-${src.classNum} ${DAYS[src.day]}${src.period} 체Ⅱ(${teacher.split("@")[0]}) → 후보 ${candidates.length}건, 다윗관 충돌 잔존 ${bad.length}건${stamped ? " (0이어야 정상)" : " (마크 없으면 검사 자체가 비활성)"}`
  );
}

async function run() {
  const settings = await loadTimetableSettings(DOMAIN);
  const termId = settings.activeTermId;
  if (!termId) throw new Error("활성 학기가 없습니다.");
  console.log(`활성 학기: ${termId}`);
  const grids = await loadAllClassGrids(DOMAIN, termId);

  const existing = await loadVenueGroups(DOMAIN, termId);
  console.log(`\n[현재 등록] ${existing.length}건`);
  existing.forEach((g) =>
    console.log(`  ${g.id} | ${g.roomName} | ${g.label} | ${g.grade}학년 ${g.classNums.join(",")}반 | ${g.subjectNames.join(", ")}${g.slots ? ` | 교시 ${g.slots.map((s) => `${DAYS[s.day]}${s.period}`).join(",")}` : ""} | ${g.active ? "활성" : "비활성"}`)
  );
  if (existing.length) {
    printCells("현재 등록분", listVenueCells(grids, existing));
    const conflicts = findVenueBaseConflicts(grids, existing);
    console.log(`  기초 이중 점유: ${conflicts.length}건 (0이어야 정상)`);
    conflicts.forEach((c) => console.log(`    ⚠ ${DAYS[c.day]}${c.period}교시 ${c.roomName}: ${c.users.join(" + ")}`));
    console.log("\n[엔진 스모크 — 현재 등록분 기준]");
    await engineSmoke(termId, grids, existing.length > 0);
  }

  if (GROUPS.length === 0) {
    console.log("\nGROUPS가 비어 있음 — 검증 전용 모드 종료.");
    return;
  }

  const validated = GROUPS.map((raw) => {
    const v = validateVenueGroupPayload({ ...raw, termId });
    if (!v.ok) throw new Error(`배정 "${raw.roomName}/${raw.label}" 검증 실패: ${v.error}`);
    return v.group;
  });
  const preview = validated.map((g, i) => ({ ...g, id: `new-${i}`, createdBy: "", createdAt: 0 }));
  printCells("등재 예정분", listVenueCells(grids, preview));
  const zero = preview.filter((g) => listVenueCells(grids, [g]).length === 0);
  zero.forEach((g) => console.log(`  ⚠ 판정 0셀: ${g.roomName}/${g.label} — 과목명·반·교시 표기 불일치 의심`));
  const conflicts = findVenueBaseConflicts(grids, preview);
  console.log(`\n[기초 이중 점유 검사] ${conflicts.length}건 (0이어야 정상)`);
  conflicts.forEach((c) => console.log(`  ⚠ ${DAYS[c.day]}${c.period}교시 ${c.roomName}: ${c.users.join(" + ")}`));

  // 엔진 스모크: 마크 미적용(현 상태) vs 인메모리 적용 비교 — DB 무변경
  console.log("\n[엔진 스모크 — 마크 전/후 비교 (인메모리, DB 무변경)]");
  await engineSmoke(termId, grids, false);
  const stampedGrids = JSON.parse(JSON.stringify(grids));
  applyVenueMarks(stampedGrids, preview as any);
  await engineSmoke(termId, stampedGrids, true);

  if (process.env.APPLY !== "1") {
    console.log("\n(드라이런 — 위 판정 셀을 컴시간 스크린샷과 눈 대조 후 APPLY=1로 등재)");
    return;
  }

  for (const g of validated) {
    const ref = venueGroupsColRef(DOMAIN).doc();
    await ref.set({ ...g, createdBy: OPERATOR, createdAt: Date.now() });
    await writeAuditLog({
      operatorEmail: OPERATOR,
      targetEmail: DOMAIN,
      action: "venue_group_create",
      details: `특별실 배정 1차 등재: ${g.roomName} — ${g.label} (${g.grade}학년 ${g.classNums.join(",")}반 / ${g.subjectNames.join(", ")}${g.slots ? ` / 교시 ${g.slots.map((s: any) => `${DAYS[s.day]}${s.period}`).join(",")}` : ""})`,
      status: "success",
    });
    console.log(`  등재됨: ${ref.id} (${g.roomName} — ${g.label})`);
  }
  console.log("\n등재 완료 — 재실행(드라이런)으로 최종 상태를 확인하세요.");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
