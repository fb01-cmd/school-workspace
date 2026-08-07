/**
 * §C 징검다리 체인 탐색 실데이터 검증 (읽기 전용 — 전부 가상 계산, DB 무변경)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/verify_chain_search.ts [주ID] [학년] [반]
 * 기본: 활성 학기 최신 주, 2학년 1반의 첫 번째 유효 수업.
 *
 * 검증 항목:
 *  ① 깊이1 체인 = 기존 맞교환 후보와 정확히 일치 (엔진 판정 동일성)
 *  ② 직접 교환이 안 되는 목적지 중 체인(2수)으로 도달 가능한 자리 발견 (기능 가치 실증)
 *  ③ 단계 출력이 담기 호환 형식인지 (weekId/type/source/candidate/sourceTeacher*)
 */
import "./_force_notify_mock";
import {
  computeChainSearch,
  listWeeks,
  loadTimetableSettings,
  loadWeekChanges,
  loadWeek,
  loadBaseGridsByWeek,
  resolveDirectSource,
} from "../src/lib/timetable/server";
import { synthesizeWeeklyGrids, isSlotWithinWeek } from "../src/lib/timetable/weekly";
import { buildSlotIndex, findSwapCandidates } from "../src/lib/timetable/swap";

const DOMAIN = "hmh.or.kr";
const DAYS = ["", "월", "화", "수", "목", "금"];

async function run() {
  const settings = await loadTimetableSettings(DOMAIN);
  const termId = settings.activeTermId!;
  const weeks = (await listWeeks(DOMAIN, termId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const weekId = process.argv[2] || weeks[weeks.length - 1].id;
  const week = (await loadWeek(DOMAIN, weekId))!;
  const grade = Number(process.argv[3]) || 2;
  const classNum = Number(process.argv[4]) || 1;
  console.log(`주: ${weekId} (${week.startDate}) / 학급: ${grade}-${classNum}`);

  const baseByWeek = await loadBaseGridsByWeek(DOMAIN, termId, [week.startDate]);
  const changes = await loadWeekChanges(DOMAIN, weekId);
  const { grids } = synthesizeWeeklyGrids(baseByWeek.get(week.startDate)!, week, changes, settings);
  const grid = grids.find((g) => g.grade === grade && g.classNum === classNum)!;

  // 소스: 이 학급에서 직권 배정 가능한 첫 수업
  let source: { grade: number; classNum: number; day: number; period: number } | null = null;
  let mover = "";
  for (const cell of grid.cells) {
    const r = resolveDirectSource(grids, { grade, classNum, day: cell.day, period: cell.period });
    if (r.ok) {
      source = { grade, classNum, day: cell.day, period: cell.period };
      mover = r.info.teacherEmail;
      console.log(`소스 수업: ${DAYS[cell.day]}${cell.period} ${r.info.subjectName} (${r.info.teacherName})`);
      break;
    }
  }
  if (!source) throw new Error("유효한 소스 수업이 없습니다.");

  // 기준: 기존 맞교환 후보 (직접 1수로 되는 자리들)
  const srcLesson = grid.cells.find((c) => c.day === source!.day && c.period === source!.period)!.lessons[0];
  const direct = findSwapCandidates(grids, week, settings, mover, {
    ...source, subjectName: srcLesson.subjectName,
  });
  const directSlots = new Set((direct.candidates || []).map((c) => `${c.targetDay}-${c.targetPeriod}`));
  console.log(`\n[기준] 직접 맞교환 가능 자리 ${directSlots.size}곳: ${[...directSlots].map(s => { const [d,p]=s.split("-"); return DAYS[+d]+p; }).join(", ") || "없음"}`);

  // 교사의 공강 슬롯 전수에 대해 체인 탐색
  const idx = buildSlotIndex(grids);
  let match1 = 0, mismatch1 = 0, chainOnly = 0, none = 0, checked = 0;
  const chainOnlyDetails: string[] = [];
  for (let d = 1; d <= 5; d++) {
    for (let p = 1; p <= (settings.periodsPerDay || 7); p++) {
      if (d === source.day && p === source.period) continue;
      if (!isSlotWithinWeek(week, settings, grade, d, p)) continue;
      if (idx.busyTeachers.get(`${d}-${p}`)?.has(mover)) continue; // 공강만
      checked++;
      const res = await computeChainSearch(DOMAIN, {
        weekId, source, target: { day: d, period: p }, maxDepth: 2,
      });
      const has1 = res.chains.some((c) => c.steps.length === 1);
      const has2 = res.chains.some((c) => c.steps.length === 2);
      const isDirect = directSlots.has(`${d}-${p}`);
      if (isDirect && has1) match1++;
      else if (isDirect !== has1) { mismatch1++; console.log(`  ⚠ 깊이1 불일치 ${DAYS[d]}${p}: 직접=${isDirect} 체인1=${has1}`); }
      if (!isDirect && !has1 && has2) {
        chainOnly++;
        const best = res.chains.find((c) => c.steps.length === 2)!;
        if (chainOnlyDetails.length < 3) chainOnlyDetails.push(`${DAYS[d]}${p}: ${best.summary} (감점 ${best.totalScore})`);
      }
      if (res.chains.length === 0) none++;
      // ③ 형식 검사
      for (const ch of res.chains) for (const s of ch.steps) {
        if (!s.weekId || !s.type || !s.source?.subjectName || !s.candidate?.counterpartEmail || !s.sourceTeacherEmail) {
          throw new Error(`담기 호환 형식 위반: ${JSON.stringify(s)}`);
        }
      }
    }
  }
  console.log(`\n[결과] 공강 ${checked}곳 검사 — 깊이1 일치 ${match1} / 불일치 ${mismatch1} / 체인으로만 도달 ${chainOnly} / 경로 없음 ${none}`);
  console.log(`[체인 전용 도달 예시]`);
  chainOnlyDetails.forEach((s) => console.log(`  ${s}`));
  console.log(`\n형식 검사 통과 ✅ (전 단계 담기 호환)`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
