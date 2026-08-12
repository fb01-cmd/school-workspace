/**
 * F-2 해결안 탐색기 비용 실측 (timetable_fix_assist_spec.md §2-4)
 *
 * 사용법: npx tsx --env-file=.env.local scripts/fixfinder_cost_probe.ts
 *
 * 읽기 전용 (Firestore 쓰기 0건). 읽기량 ≈ 90건:
 *   설정 1 + 학기 1 + 등록부 5종(소량 쿼리) + 초안 목록 ≤50 + 초안 그리드 31.
 *
 * 목적: "평가 1회 = cloneClassGrids(30학급) + ops 재생 + validateTimetable" 의 실제 소요를
 * 실데이터로 재고, 300회 예상치가 1초 미만인지 판정한다(§2-4 착수 순서 ①②).
 *
 * 주의: Node 측정치다. 브라우저도 같은 V8이지만 기기·탭 상태에 따라 느려질 수 있으므로
 * 판정에는 안전계수를 얹어 해석할 것.
 */
import {
  getDraft,
  listDrafts,
  loadActiveTerm,
  loadAllClassGrids,
  loadCoTeachingRules,
  loadConsecutiveRules,
  loadSimulGroups,
  loadTeacherSlotBans,
  loadTimetableSettings,
  loadVenueGroups,
} from "../src/lib/timetable/server";
import { applyRevisionOps, cloneClassGrids } from "../src/lib/timetable/utils";
import {
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  validateTimetable,
} from "../src/lib/timetable/validate";
import { BaseRevisionOp, ClassGrid, TimetableConstraintModel } from "../src/lib/timetable/types";

const DOMAIN = "hmh.or.kr";

/** 표본 배열 → 평균·중앙값·최소·최대 (ms) */
function stat(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((t, v) => t + v, 0);
  return {
    avg: sum / s.length,
    p50: s[Math.floor(s.length / 2)],
    min: s[0],
    max: s[s.length - 1],
  };
}

function fmt(label: string, st: ReturnType<typeof stat>) {
  return `  ${label.padEnd(34)} 평균 ${st.avg.toFixed(3)}ms  중앙 ${st.p50.toFixed(3)}ms  (최소 ${st.min.toFixed(3)} / 최대 ${st.max.toFixed(3)})`;
}

function bench(runs: number, fn: () => void): number[] {
  // 워밍업 — JIT 최적화 전 첫 회를 표본에서 뺀다
  for (let i = 0; i < 3; i++) fn();
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return out;
}

async function main() {
  // ── 실데이터 적재 ──
  const settings = await loadTimetableSettings(DOMAIN);
  const term = await loadActiveTerm(DOMAIN);
  if (!term) throw new Error("활성 학기가 없습니다.");

  const drafts = await listDrafts(DOMAIN);
  if (!drafts.length) throw new Error("초안이 없습니다 — 초안을 하나 만든 뒤 다시 실행하세요.");
  const target = drafts[0]; // 가장 최근 초안
  if (!target.id) throw new Error("초안 id가 없습니다.");
  console.log(`학기: ${term.id} (${term.name})`);
  console.log(`초안: ${target.id} "${target.label}" — ops ${target.ops.length}건, 커서 ${target.opCursor}`);

  const [draft, simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
    await Promise.all([
      getDraft(DOMAIN, target.id),
      loadSimulGroups(DOMAIN, target.sourceTermId || term.id),
      loadVenueGroups(DOMAIN, target.sourceTermId || term.id),
      loadTeacherSlotBans(DOMAIN, target.sourceTermId || term.id),
      loadConsecutiveRules(DOMAIN, target.sourceTermId || term.id),
      loadCoTeachingRules(DOMAIN, target.sourceTermId || term.id),
    ]);

  const baseGrids: ClassGrid[] = draft.baseGrids;
  const ops: BaseRevisionOp[] = draft.meta.ops.slice(0, draft.meta.opCursor);

  // 화면(DraftAutoTab.tsx:353-359)과 동일한 fullModel 조립 — 초안 유래 시수·교시수 + 학기 유래 등록부
  const hours =
    draft.hours && draft.hours.length > 0
      ? draft.hours
      : draft.meta.hoursSnapshot && draft.meta.hoursSnapshot.length > 0
        ? draft.meta.hoursSnapshot
        : deriveHoursFromGrids(baseGrids);
  const model: TimetableConstraintModel = {
    lunchAfterPeriod: settings.lunchAfterPeriod,
    periodsPerDay: settings.periodsPerDay,
    gradeDayPeriods: deriveGradeDayPeriods(baseGrids),
    hours,
    simulGroups,
    venueGroups,
    teacherSlotBans,
    fixedBlocks: [],
    consecutiveRules,
    coTeaching,
  };

  const cellCount = baseGrids.reduce((s, g) => s + (g.cells || []).length, 0);
  const lessonCount = baseGrids.reduce(
    (s, g) => s + (g.cells || []).reduce((t, c) => t + (c.lessons || []).length, 0),
    0
  );
  console.log(
    `데이터: ${baseGrids.length}학급 / 셀 ${cellCount} / 수업 ${lessonCount} / 시수표 ${hours.length}행 / 등록부 simul ${simulGroups.length}·venue ${venueGroups.length}·bans ${teacherSlotBans.length}·consec ${consecutiveRules.length}·co ${coTeaching.length}`
  );

  // 기준 리포트 — 후보 평가의 비교 대상
  const currentGrids = cloneClassGrids(baseGrids);
  applyRevisionOps(currentGrids, ops);
  const baseReport = validateTimetable(currentGrids, model);
  console.log(
    `기준: 하드 ${baseReport.hard.length}건(조치 ${baseReport.summary.actionableHard}) / 소프트 ${baseReport.soft.total}점, 감점 상세 ${baseReport.soft.details.length}건`
  );

  // 평가에 쓸 대표 후보 op — 상위 감점 항목이 있는 학급의 임의 두 슬롯 맞교환
  const sampleOp: BaseRevisionOp = {
    type: "swap",
    grade: baseGrids[0].grade,
    classNum: baseGrids[0].classNum,
    a: { day: 1, period: 1 },
    b: { day: 3, period: 4 },
  };

  const RUNS = 40;
  console.log(`\n══ 구성요소별 소요 (각 ${RUNS}회, 워밍업 3회 제외) ══`);
  const tClone = stat(bench(RUNS, () => void cloneClassGrids(baseGrids)));
  console.log(fmt(`cloneClassGrids (${baseGrids.length}학급)`, tClone));

  const tReplay = stat(
    bench(RUNS, () => {
      const g = cloneClassGrids(baseGrids);
      applyRevisionOps(g, [...ops, sampleOp]);
    })
  );
  console.log(fmt(`clone + ops 재생 (${ops.length + 1}건)`, tReplay));

  const tValidate = stat(bench(RUNS, () => void validateTimetable(currentGrids, model)));
  console.log(fmt("validateTimetable", tValidate));

  // ── 평가 1회 = 스펙 §2-4가 정의한 전체 사이클 ──
  const tEval = stat(
    bench(RUNS, () => {
      const g = cloneClassGrids(baseGrids);
      applyRevisionOps(g, [...ops, sampleOp]);
      validateTimetable(g, model);
    })
  );
  console.log("\n══ 평가 1회 (clone + 재생 + 검사) ══");
  console.log(fmt("전체 사이클", tEval));

  console.log("\n══ 300회 예상 ══");
  for (const n of [50, 100, 300, 500]) {
    const ms = tEval.avg * n;
    console.log(`  ${String(n).padStart(3)}회: ${(ms / 1000).toFixed(2)}초${n === 300 ? ms < 1000 ? "  ← 1초 미만 ✅ 동기 실행 가능" : "  ← 1초 초과 ❌ 청크 분할 필요" : ""}`);
  }

  // ── 후보 공간 크기 — 상위 감점 항목이 실제로 몇 개의 후보를 만드는가 ──
  console.log("\n══ 상위 감점 항목별 후보 공간(개략) ══");
  const P = settings.periodsPerDay;
  for (const d of baseReport.soft.details.slice(0, 6)) {
    let sourceCells = 0;
    if (d.scope === "teacher") {
      for (const g of currentGrids)
        for (const c of g.cells || []) {
          if (c.day !== d.day) continue;
          for (const l of c.lessons || [])
            if ((l.teachers || []).some((t) => (t.email || "").trim().toLowerCase() === d.key))
              sourceCells++;
        }
    } else {
      const [gr, cn] = d.key.split("-").map(Number);
      const g = currentGrids.find((x) => x.grade === gr && x.classNum === cn);
      for (const c of g?.cells || []) if (c.day === d.day) sourceCells += (c.lessons || []).length;
    }
    // 목적지 = 같은 학급의 다른 슬롯 (요일 5 × 교시 P − 자기 자신)
    const est = sourceCells * (5 * P - 1);
    console.log(
      `  [${d.code}] ${d.text} (−${d.points}점)\n        원인 셀 ${sourceCells}개 × 목적지 ${5 * P - 1} = 후보 약 ${est}개 → ${(tEval.avg * Math.min(est, 300) / 1000).toFixed(2)}초 (상한 300 적용)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
