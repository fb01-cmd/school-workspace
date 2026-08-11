/**
 * 9월 질문지 v2용 후보 추출 — 활성 학기 실그리드에서 연속 블록·복수교사 수업을 역산 (읽기 전용)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/extract_questionnaire_candidates.ts
 *
 * 목적: 질문지 2·3번을 백지 복기 대신 "추출 목록 확인·체크" 방식으로 전환
 * (docs/september_questionnaire.md v2). 읽기: 그리드 ~30 + 설정 1 + 등록부 3 ≈ 35.
 * - 연속 블록: 같은 반·같은 날 인접 교시에 같은 과목·같은 교사 → 길이별 집계.
 *   이미 등록부(동시수업·특별실의 연속 필드, 연속수업 등록부)가 소유한 항목은 표시.
 * - 복수교사: 한 수업에 교사 2명 이상 → 목록. 기존 복수교사 등록부 등재 여부 표시.
 */
import "./_force_notify_mock"; // 반드시 첫 import — 읽기 전용 실측
import {
  loadAllClassGrids,
  loadConsecutiveRules,
  loadCoTeachingRules,
  loadSimulGroups,
  loadTimetableSettings,
  loadVenueGroups,
} from "../src/lib/timetable/server";

const DAY = ["", "월", "화", "수", "목", "금"];

async function run() {
  const domain = "hmh.or.kr";
  const settings = await loadTimetableSettings(domain);
  const termId = settings.activeTermId || "2026-2";
  console.log(`# 대상 학기: ${termId}\n`);

  const [grids, consecutiveRules, coTeaching, simulGroups, venueGroups] = await Promise.all([
    loadAllClassGrids(domain, termId),
    loadConsecutiveRules(domain, termId),
    loadCoTeachingRules(domain, termId),
    loadSimulGroups(domain, termId),
    loadVenueGroups(domain, termId),
  ]);

  // 이미 연속 속성을 소유한 과목 집합 (소유 우선순위: 동시수업·특별실 등록부의 consecutive 필드)
  const ownedConsecutiveSubjects = new Set<string>();
  for (const g of simulGroups) {
    if ((g as any).consecutive) for (const s of (g as any).subjectNames || []) ownedConsecutiveSubjects.add(`${g.grade}|${s}`);
  }
  for (const v of venueGroups) {
    if (v.consecutive) for (const s of v.subjectNames || []) ownedConsecutiveSubjects.add(`${v.grade}|${s}`);
  }
  const registeredConsecutive = new Set(
    consecutiveRules.map((r: any) => `${r.grade}|${r.subjectName}|${r.teacherName || r.teacherEmail || ""}`)
  );

  // ── 연속 블록 추출 ──
  // key: 학년|과목|교사 → 길이별 발생 횟수
  const blockAgg = new Map<string, { grade: number; subject: string; teacher: string; lens: Map<number, number> }>();
  for (const grid of grids) {
    for (let day = 1; day <= 5; day++) {
      const cells = grid.cells
        .filter((c) => c.day === day)
        .sort((a, b) => a.period - b.period);
      let run = 1;
      for (let i = 1; i <= cells.length; i++) {
        const prev = cells[i - 1];
        const cur = cells[i];
        const sameBlock =
          cur &&
          cur.period === prev.period + 1 &&
          prev.lessons.length > 0 &&
          cur.lessons.length > 0 &&
          prev.lessons[0].subjectName === cur.lessons[0].subjectName &&
          (prev.lessons[0].teachers?.[0]?.name || "") === (cur.lessons[0].teachers?.[0]?.name || "");
        if (sameBlock) {
          run++;
          continue;
        }
        if (run >= 2) {
          const l = prev.lessons[0];
          const teacher = l.teachers?.[0]?.name || "(교사 없음)";
          const key = `${grid.grade}|${l.subjectName}|${teacher}`;
          let agg = blockAgg.get(key);
          if (!agg) {
            agg = { grade: grid.grade, subject: l.subjectName, teacher, lens: new Map() };
            blockAgg.set(key, agg);
          }
          agg.lens.set(run, (agg.lens.get(run) || 0) + 1);
        }
        run = 1;
      }
    }
  }

  console.log("## 연속 블록 후보 (같은 반·같은 날 인접 교시, 같은 과목·교사)");
  const blocks = Array.from(blockAgg.values()).sort(
    (a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject, "ko")
  );
  for (const b of blocks) {
    const lens = Array.from(b.lens.entries())
      .sort((x, y) => x[0] - y[0])
      .map(([len, n]) => `${len}연속×${n}회`)
      .join(", ");
    const owned = ownedConsecutiveSubjects.has(`${b.grade}|${b.subject}`)
      ? " [동시/특별실 등록부 소유]"
      : registeredConsecutive.has(`${b.grade}|${b.subject}|${b.teacher}`)
      ? " [연속 등록부 기등재]"
      : "";
    console.log(`- ${b.grade}학년 ${b.subject} (${b.teacher}) — ${lens}${owned}`);
  }
  if (blocks.length === 0) console.log("(없음)");

  // ── 복수교사 추출 ──
  console.log("\n## 복수교사 후보 (한 수업에 교사 2명 이상)");
  const coSeen = new Map<string, { classes: string[]; subject: string; teachers: string }>();
  for (const grid of grids) {
    for (const cell of grid.cells) {
      for (const lesson of cell.lessons) {
        const ts = (lesson.teachers || []).map((t) => t.name || t.email || "?");
        if (ts.length < 2) continue;
        const key = `${grid.grade}|${lesson.subjectName}|${ts.slice().sort().join("+")}`;
        let e = coSeen.get(key);
        if (!e) {
          e = { classes: [], subject: lesson.subjectName, teachers: ts.join(" · ") };
          coSeen.set(key, e);
        }
        const cls = `${grid.grade}-${grid.classNum}`;
        if (!e.classes.includes(cls)) e.classes.push(cls);
      }
    }
  }
  const registeredCo = new Set(
    coTeaching.map((r: any) => `${r.grade ?? ""}|${r.subjectName ?? ""}`)
  );
  for (const [key, e] of Array.from(coSeen.entries()).sort()) {
    const grade = key.split("|")[0];
    const reg = registeredCo.has(`${grade}|${e.subject}`) ? " [복수교사 등록부 기등재]" : "";
    console.log(`- ${e.classes.join(", ")}반 ${e.subject} — ${e.teachers}${reg}`);
  }
  if (coSeen.size === 0) console.log("(없음)");

  console.log(
    `\n# 등록부 현황: 연속 ${consecutiveRules.length}건 · 복수교사 ${coTeaching.length}건 · 동시수업 ${simulGroups.length}건 · 특별실 ${venueGroups.length}건`
  );
  process.exit(0);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
