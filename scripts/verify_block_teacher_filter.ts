import "./_force_notify_mock"; // 반드시 첫 import — 실교사 DM 차단 (본 스크립트는 읽기 전용)
import { loadAllClassGrids, loadActiveTerm } from "../src/lib/timetable/server";
import { buildSlotIndex, isBlockTeacher } from "../src/lib/timetable/swap";
import { TimetableTeacher } from "../src/lib/timetable/types";

/**
 * 2026-08-04 view `teachers`·`free` 가상·블록 교사 서버 제외 실측 (읽기 전용).
 * 확인 항목: ① 드롭다운 오염 주범(changche 등)이 블록 판정으로 제외되는가
 *           ② 실교사가 오탐으로 제외되지 않는가 (제외 명단 전수 출력해 눈으로 검증)
 */
async function run() {
  const domain = "hmh.or.kr";
  const term = await loadActiveTerm(domain);
  if (!term) throw new Error("active 학기 없음");
  console.log(`학기: ${term.id} (${term.name})`);

  const baseGrids = await loadAllClassGrids(domain, term.id);
  const teacherMap = new Map<string, TimetableTeacher>();
  for (const subj of term.subjects || []) {
    for (const email of subj.teacherEmails || []) {
      const normEmail = email.trim().toLowerCase();
      if (normEmail && !teacherMap.has(normEmail)) {
        teacherMap.set(normEmail, { email: normEmail, name: normEmail.split("@")[0] });
      }
    }
  }
  for (const grid of baseGrids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        for (const teacher of lesson.teachers || []) {
          const normEmail = (teacher.email || "").trim().toLowerCase();
          if (normEmail) {
            teacherMap.set(normEmail, { email: normEmail, name: teacher.name || normEmail.split("@")[0] });
          }
        }
      }
    }
  }

  const idx = buildSlotIndex(baseGrids);
  const all = Array.from(teacherMap.values());
  const excluded = all.filter((t) => isBlockTeacher(idx, t.email));
  const kept = all.filter((t) => !isBlockTeacher(idx, t.email));

  console.log(`전체 수집 교사: ${all.length}명 / 드롭다운 유지: ${kept.length}명 / 블록 제외: ${excluded.length}명`);
  console.log("\n── 제외 명단 (가상·블록 여부 눈으로 확인) ──");
  for (const t of excluded) {
    // 동시 최대 학급 수 산출 (판정 근거 표시)
    const tm = (idx as any).teacherSlots?.get?.(t.email);
    let maxSimul = 0;
    if (tm) for (const subjects of tm.values()) maxSimul = Math.max(maxSimul, subjects.length);
    console.log(`  ❌ ${t.name} <${t.email}> — 동시 최대 ${maxSimul}학급`);
  }
  console.log("\n── 유지 명단 ──");
  console.log("  " + kept.map((t) => t.name).sort((a, b) => a.localeCompare(b, "ko")).join(", "));
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
