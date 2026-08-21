/**
 * Phase 9c-C-2 백지 편성 실험 — "컴시간 없이 짤 수 있는가"의 첫 실증.
 *
 * 재현 실험(solve_rehearsal.ts)은 현행 그리드에서 섹션을 역산했다 — 답이 있는 문제를
 * 다시 푼 것. 여기서는 그리드에서 **시수표만** 뽑고 그리드를 버린 뒤, 시수표+등록부만으로
 * 섹션을 컴파일(compileSectionsFromHours)해 솔버를 돌리고, 오늘 기준선(하드 0·소프트
 * 38·미배정 0)과 대조한다.
 *
 *   현행 그리드 → deriveHoursFromGrids → 시수표
 *                                          ↓
 *                          compileSectionsFromHours   ← 그리드를 보지 않는다
 *                                          ↓
 *                                     솔버 → 검사기
 *
 * 그리드에서 함께 뽑되 "장래 다른 출처가 주게 될" 입력 (각각의 정식 출처):
 *  - 자리표시(창체·SLAT) 고정 슬롯 → 일괄 배정(fixedBlocks) 형태로 추출.
 *    정식 출처는 교육과정 코호트 등록부(질의 결과 §2-2) — 학급 단위 entries로 전개하므로
 *    학년 하드코딩이 없다.
 *  - 학년별 요일별 교시수(gradeDayPeriods) → 정식 출처는 설정·입력 화면.
 *  - 교사 이름·과목 약칭(표시용) → 정식 출처는 계정 원장·term.subjects.
 *
 * [2026-08-14 2차 — 9c-H §3 항목 5] 그리드 대역을 실제로 끊었다:
 *  - 고정 슬롯: 그리드 추출(extractPlaceholderFixedBlocks) 대신 **코호트 등록부 전개**
 *    (expandCohortFixedBlocks). 등록부 내용은 관리자 입력을 전사한 상수(TRANSCRIBED_COHORTS,
 *    2026-08-14 실측: 전 학년 동일 — 수6·7 SLAT, 금5·6 창체). 그리드 추출은 전사가 실제와
 *    같은지 대조하는 검증용으로만 남는다.
 *  - 시수표: **업로드 실물 조건**(9c-H §0-1a-③ⓒ — 창체·SLAT 행 없음)을 재현. 파생 시수표에서
 *    가상 행을 제거한 뒤, 등록부가 함의하는 행(impliedHoursFromFixedBlocks)으로 보강한다.
 *    이 보강이 실서버 업로드 경로에서도 그대로 필요하다 (H1/H4 시수표 대조 전제).
 *
 * 사용법: npx tsx --env-file=.env.local scripts/solve_blank.ts [seed] [--cache=경로]
 *   --cache: 지정 시 첫 실행에서 Firestore 입력을 JSON으로 저장하고 이후 재사용
 *            (읽기 할당량 절약 — 반복 실험용). 읽기 전용, Firestore 쓰기 0건.
 */
import fs from "node:fs";
import {
  deriveGradeDayPeriods,
  deriveHoursFromGrids,
  isAllVirtual,
  validateTimetable,
} from "../src/lib/timetable/validate";
import {
  compileSectionsFromGrids,
  compileSectionsFromHours,
  solveTimetable,
  solveTimetablePortfolio,
} from "../src/lib/timetable/solver";
import {
  ClassGrid,
  CurriculumCohort,
  FixedBlock,
  TimetableConstraintModel,
} from "../src/lib/timetable/types";
import {
  expandCohortFixedBlocks,
  impliedHoursFromFixedBlocks,
} from "../src/lib/timetable/cohort";

/**
 * 코호트 등록부 전사 — 관리자가 화면에서 입력하게 될 내용을 상수로 재현 (실험용).
 * 2026-08-14 실측: 2026-2 전 학년·전 학급이 동일 슬롯(수6·7 SLAT, 금5·6 창체)이라
 * 교육과정 1건으로 전 학년이 덮인다(입학 2024 이후 전부). 아래 전사가 그리드 실물과
 * 일치하는지는 실행 시 extractPlaceholderFixedBlocks 대조로 검증한다.
 */
const TRANSCRIBED_COHORTS: CurriculumCohort[] = [
  {
    id: "adm2024",
    label: "2026-2 현행 교육과정 (전사)",
    startAdmissionYear: 2024,
    fixedSlots: [
      { displayName: "SLAT", day: 3, period: 6 },
      { displayName: "SLAT", day: 3, period: 7 },
      { displayName: "창체", day: 5, period: 5 },
      { displayName: "창체", day: 5, period: 6 },
    ],
    active: true,
    createdBy: "experiment",
    updatedBy: "experiment",
    updatedAt: 0,
  },
];
const SCHOOL_YEAR = 2026;

const DOMAIN = "hmh.or.kr";
const args = process.argv.slice(2);
const SEED_ARG = args.find((a) => !a.startsWith("--")) ? Number(args.find((a) => !a.startsWith("--"))) : null;
const CACHE_PATH = args.find((a) => a.startsWith("--cache="))?.slice("--cache=".length) || null;

function hashOf(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

interface LoadedInputs {
  termId: string;
  subjects: Array<{ name: string; shortName: string }>;
  settings: { lunchAfterPeriod: number; periodsPerDay: number };
  grids: ClassGrid[];
  simulGroups: TimetableConstraintModel["simulGroups"];
  venueGroups: TimetableConstraintModel["venueGroups"];
  teacherSlotBans: TimetableConstraintModel["teacherSlotBans"];
  consecutiveRules: TimetableConstraintModel["consecutiveRules"];
  coTeaching: TimetableConstraintModel["coTeaching"];
}

async function loadInputs(): Promise<LoadedInputs> {
  if (CACHE_PATH && fs.existsSync(CACHE_PATH)) {
    console.log(`입력 캐시 사용: ${CACHE_PATH} (Firestore 읽기 0건)`);
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  }
  const {
    loadActiveTerm,
    loadAllClassGrids,
    loadSimulGroups,
    loadTimetableSettings,
    loadVenueGroups,
    loadTeacherSlotBans,
    loadConsecutiveRules,
    loadCoTeachingRules,
  } = await import("../src/lib/timetable/server");
  const settings = await loadTimetableSettings(DOMAIN);
  const term = await loadActiveTerm(DOMAIN);
  if (!term) throw new Error("활성 학기가 없습니다.");
  const [grids, simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
    await Promise.all([
      loadAllClassGrids(DOMAIN, term.id),
      loadSimulGroups(DOMAIN, term.id),
      loadVenueGroups(DOMAIN, term.id),
      loadTeacherSlotBans(DOMAIN, term.id),
      loadConsecutiveRules(DOMAIN, term.id),
      loadCoTeachingRules(DOMAIN, term.id),
    ]);
  const data: LoadedInputs = {
    termId: term.id,
    subjects: (term.subjects || []).map((s) => ({ name: s.name, shortName: s.shortName })),
    settings: {
      lunchAfterPeriod: settings.lunchAfterPeriod,
      periodsPerDay: settings.periodsPerDay,
    },
    grids,
    simulGroups,
    venueGroups,
    teacherSlotBans,
    consecutiveRules,
    coTeaching,
  };
  if (CACHE_PATH) {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data));
    console.log(`입력 캐시 저장: ${CACHE_PATH}`);
  }
  return data;
}

/**
 * 자리표시(전원 가상 교사) 수업의 위치를 일괄 배정 등록부 형태로 추출 —
 * 장래 교육과정 코호트 등록부(질의 결과 §2-2)가 생성할 데이터의 실험용 대역.
 * 학급 단위 entries로 전개한다 (학년 하드코딩 금지 — 학급·학년별 차등도 그대로 담긴다).
 */
function extractPlaceholderFixedBlocks(grids: ClassGrid[], termId: string): FixedBlock[] {
  const bySlot = new Map<string, FixedBlock>();
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        if (!isAllVirtual(lesson)) continue;
        const key = `${cell.day}-${cell.period}`;
        if (!bySlot.has(key)) {
          bySlot.set(key, {
            termId,
            label: `자리표시 ${key}`,
            day: cell.day,
            period: cell.period,
            entries: [],
            active: true,
          });
        }
        bySlot.get(key)!.entries.push({
          grade: grid.grade,
          classNum: grid.classNum,
          subjectName: lesson.subjectName,
          teacherName: lesson.teachers?.[0]?.name || undefined,
        });
      }
    }
  }
  return [...bySlot.values()].sort((a, b) => a.day - b.day || a.period - b.period);
}

async function main() {
  const inputs = await loadInputs();
  const { grids } = inputs;
  console.log(
    `학기 ${inputs.termId} / 그리드 ${grids.length}학급 / 등록부: 동시 ${inputs.simulGroups?.length}·특별실 ${inputs.venueGroups?.length}·금지 ${inputs.teacherSlotBans?.length}·연속 ${inputs.consecutiveRules?.length}·복수 ${inputs.coTeaching?.length}`
  );

  // ── 그리드에서 뽑는 것: 시수표 + 요일별 교시수 + 표시용 이름들 ──
  const derivedHours = deriveHoursFromGrids(grids);
  const gradeDayPeriods = deriveGradeDayPeriods(grids);

  // ── 고정 슬롯: 코호트 등록부 전개 (그리드 대역 아님 — 9c-H §3 항목 5) ──
  const classList = grids
    .map((g) => ({ grade: g.grade, classNum: g.classNum }))
    .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum);
  const fixedBlocks = expandCohortFixedBlocks(
    TRANSCRIBED_COHORTS,
    SCHOOL_YEAR,
    classList,
    inputs.termId
  );
  // 전사 검증: 등록부 전개 결과가 그리드 실물의 자리표시 위치와 일치하는가
  const gridBlocks = extractPlaceholderFixedBlocks(grids, inputs.termId);
  const slotSig = (bs: FixedBlock[]) =>
    bs
      .flatMap((b) =>
        b.entries.map((e) => `${b.day}-${b.period}|${e.grade}-${e.classNum}|${e.subjectName}`)
      )
      .sort()
      .join("\n");
  const transcriptionOk = slotSig(fixedBlocks) === slotSig(gridBlocks);
  console.log(
    `코호트 전사 대조: 등록부 전개 ${fixedBlocks.reduce((s, b) => s + b.entries.length, 0)}건 vs ` +
      `그리드 실물 ${gridBlocks.reduce((s, b) => s + b.entries.length, 0)}건 → ${transcriptionOk ? "✅ 일치" : "❌ 불일치"}`
  );
  if (!transcriptionOk) {
    console.log("전사가 실물과 다릅니다 — TRANSCRIBED_COHORTS를 실물에 맞게 고치세요.");
    process.exit(1);
  }

  // ── 시수표: 업로드 실물 조건 재현 (창체·SLAT 행 제거) + 등록부 함의 행 보강 ──
  const isVirtualRow = (tk: string) => !tk || tk.startsWith("name:");
  const uploadHours = derivedHours.filter((h) => !isVirtualRow(h.teacherKey));
  const impliedHours = impliedHoursFromFixedBlocks(fixedBlocks);
  const hours = [...uploadHours, ...impliedHours];
  console.log(
    `시수표: 파생 ${derivedHours.length}행 → 업로드형 ${uploadHours.length}행(가상 ${derivedHours.length - uploadHours.length}행 제거) + 등록부 함의 ${impliedHours.length}행`
  );
  const teacherNames: Record<string, string> = {};
  for (const g of grids)
    for (const c of g.cells || [])
      for (const l of c.lessons || [])
        for (const t of l.teachers || [])
          if ((t.email || "").trim()) teacherNames[t.email.trim().toLowerCase()] = t.name;
  const subjectShorts: Record<string, string> = {};
  const normSubject = (s: string) =>
    (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();
  for (const s of inputs.subjects) {
    subjectShorts[normSubject(s.name)] = s.shortName;
    subjectShorts[normSubject(s.shortName)] = s.shortName;
  }
  console.log(
    `시수표 ${hours.length}행 / 자리표시 고정 블록 ${fixedBlocks.length}슬롯 (${fixedBlocks.reduce((s, b) => s + b.entries.length, 0)}건)`
  );

  const model: TimetableConstraintModel = {
    lunchAfterPeriod: inputs.settings.lunchAfterPeriod,
    periodsPerDay: inputs.settings.periodsPerDay,
    gradeDayPeriods,
    hours,
    simulGroups: inputs.simulGroups,
    venueGroups: inputs.venueGroups,
    teacherSlotBans: inputs.teacherSlotBans,
    consecutiveRules: inputs.consecutiveRules,
    coTeaching: inputs.coTeaching,
    fixedBlocks,
  };

  // ── 기준선: 현행 그리드 (재현 실험과 동일 관문) ──
  const baseline = validateTimetable(grids, model);
  console.log(`기준선(현행): 하드 ${baseline.hard.length} / 소프트 ${baseline.soft.total}점`);

  // ── 대조용: 그리드 역산 컴파일러의 섹션 통계 ──
  const gridSections = compileSectionsFromGrids(grids, model);
  const statsOf = (ss: typeof gridSections) => ({
    total: ss.length,
    fixed: ss.filter((s) => s.kind === "fixed").length,
    simul: ss.filter((s) => s.kind === "simul").length,
    occ: ss.reduce((a, s) => a + s.blockLens.reduce((x, y) => x + y, 0), 0),
  });
  const gs = statsOf(gridSections);

  // ── 백지 컴파일: 여기서부터 그리드를 보지 않는다 ──
  const { sections, issues } = compileSectionsFromHours({
    hours,
    model,
    gradeDayPeriods,
    teacherNames,
    subjectShorts,
  });
  const bs = statsOf(sections);
  console.log(
    `\n섹션 대조 — 그리드 역산: 총 ${gs.total}(고정 ${gs.fixed}·동시 ${gs.simul}) 점유 ${gs.occ} ` +
      `vs 백지: 총 ${bs.total}(고정 ${bs.fixed}·동시 ${bs.simul}) 점유 ${bs.occ}`
  );
  if (issues.length) {
    console.log(`\n⚠️ 백지 컴파일 issues ${issues.length}건:`);
    for (const i of issues) console.log(`  [${i.code}] ${i.text}`);
  } else {
    console.log("백지 컴파일 issues 0건");
  }

  // ── 솔버 ──
  const t0 = Date.now();
  const base = {
    sections,
    gradeDayPeriods,
    lunchAfterPeriod: model.lunchAfterPeriod,
  };
  let result;
  let seedUsed: number;
  if (SEED_ARG !== null && Number.isFinite(SEED_ARG)) {
    result = solveTimetable({ ...base, seed: SEED_ARG });
    seedUsed = SEED_ARG;
  } else {
    const portfolio = solveTimetablePortfolio(base);
    result = portfolio.best;
    seedUsed = portfolio.best.seed;
    console.log(
      `\n시드 포트폴리오: ${portfolio.ranking
        .map((r) => `${r.seed}=${r.soft}점${r.unplacedHours ? `(미배정 ${r.unplacedHours})` : ""}`)
        .join(" ")} → 선발 시드 ${seedUsed}`
    );
  }
  const elapsed = Date.now() - t0;
  console.log(
    `솔버 완료 (${(elapsed / 1000).toFixed(1)}s, seed=${seedUsed}): 그리디 ${result.stats.placedGreedy} + ejection ${result.stats.placedByEjection} / ${result.stats.occurrencesTotal}회차, 국소 탐색 수용 ${result.stats.localSearchAccepted}건`
  );
  if (result.unplaced.length) {
    console.log(`\n⚠️ 미배정 ${result.unplaced.length}건:`);
    for (const u of result.unplaced) console.log(`  - ${u.label}: ${u.remaining}시간`);
  } else {
    console.log("미배정 0건 — 전 시수 배치 완료");
  }

  // ── 검사기 관문 ──
  const report = validateTimetable(result.grids, model);
  const gaps = report.hard.filter((v) => v.registryGap);
  console.log(
    `\n══ 검사기 관문 ══\n하드 ${report.hard.length}건 (조치 대상 ${report.summary.actionableHard} + 등록부 미비 추정 ${gaps.length})`
  );
  if (report.hard.length) {
    const byCode = Object.entries(report.summary.hardByCode)
      .map(([c, n]) => `${c}=${n}`)
      .join(" ");
    console.log(`코드별: ${byCode}`);
    for (const v of report.hard.slice(0, 20)) console.log(`  [${v.code}] ${v.text}`);
    if (report.hard.length > 20) console.log(`  … 외 ${report.hard.length - 20}건`);
  }
  console.log(
    `소프트: ${report.soft.total}점 (내부 추정 ${result.stats.softScoreEstimate}점) vs 기준선 ${baseline.soft.total}점 → ${
      report.soft.total <= baseline.soft.total ? "✅ 기준선 이하" : "❌ 기준선 초과"
    }`
  );
  console.log(
    `코드별: ${Object.entries(report.soft.byCode).map(([c, n]) => `${c}=${n}`).join(" ") || "없음"}`
  );
  // S2 상세 — 2026-08-21 실측에서 열린 축: 실제 운영 시간표(사람 손)는 연속 3+가 0건이다.
  // 총점이 좋아도 연속 4+가 남으면 "사람이 안 하는 배치"라 대체 주장을 못 한다.
  {
    const s4 = report.soft.details.filter((d) => d.code === "S4");
    if (s4.length) {
      console.log(`S4 상세 ${s4.length}건 (금기 — 관문 기준 0건) · 최후 폴백(몫 완화) 발동 ${result.stats.relaxQuotaUsed}회:`);
      for (const d of s4) console.log(`  ⚠ ${d.text}`);
    } else {
      console.log(`S4 0건 · 최후 폴백(몫 완화) 발동 ${result.stats.relaxQuotaUsed}회`);
    }
    const s2 = report.soft.details.filter((d) => d.code === "S2");
    console.log(`S2 상세 ${s2.length}건 (실제 운영 시간표 기준 0건):`);
    for (const d of s2) console.log(`  ${/연속 [4-9]/.test(d.text) ? "⚠ " : "  "}${d.text}`);
    // 죽음/경유 분류 (2026-08-22 ⓒ안 관문축) — 죽음 = 점심 안 끼는 내리 3연속(1-2-3·2-3-4·5-6-7),
    // 경유 = 점심이 끼는 3연속(3-4-5·4-5-6, 체감상 숨을 쉰다). 사용자 기준 죽음 연속이 진짜 위반.
    {
      const L = model.lunchAfterPeriod;
      const byTeacher = new Map<string, Map<number, Set<number>>>();
      for (const g of result.grids)
        for (const c of g.cells || [])
          for (const l of c.lessons || [])
            for (const t of l.teachers || []) {
              const e = (t.email || "").trim().toLowerCase();
              if (!e) continue;
              if (!byTeacher.has(e)) byTeacher.set(e, new Map());
              const dm = byTeacher.get(e)!;
              if (!dm.has(c.day)) dm.set(c.day, new Set());
              dm.get(c.day)!.add(c.period);
            }
      const DAY = ["", "월", "화", "수", "목", "금"];
      const death: string[] = [];
      const viaLunch: string[] = [];
      for (const [e, dm] of byTeacher)
        for (const [day, ps] of dm) {
          const sorted = [...ps].sort((a, b) => a - b);
          let run: number[] = [];
          const flush = () => {
            if (run.length >= 3) {
              const label = `${teacherNames[e] || e} ${DAY[day]} ${run.join("-")}교시`;
              if (run.includes(L) && run.includes(L + 1)) viaLunch.push(label);
              else death.push(label);
            }
            run = [];
          };
          for (const p of sorted) {
            if (run.length && p !== run[run.length - 1] + 1) flush();
            run.push(p);
          }
          flush();
        }
      console.log(
        `S2 분류: 죽음(점심 없이 3연속+) ${death.length}건 · 점심 경유 ${viaLunch.length}건 (실제 운영 시간표 = 0·0)`
      );
      for (const d of death.sort()) console.log(`  ☠ ${d}`);
      for (const v of viaLunch.sort()) console.log(`  ~ ${v}`);
    }
    // 공강 대조 (summary.teacherGaps — 점수 밖 참고 지표, 2026-08-22): 사람 손이 연속 0을
    // 만든 수단이 공강 배치였음이 실측돼 신설. 첫 실측 = 총량 동등(450 vs 456칸) — 기울기 가설 반증.
    {
      const g = report.summary.teacherGaps;
      const b = baseline.summary.teacherGaps;
      if (g && b)
        console.log(
          `공강(점수 밖): 산출 ${g.days}건/${g.slots}칸(하루 2칸+ ${g.heavyDays}건) vs 실제 운영 시간표 ${b.days}건/${b.slots}칸(2칸+ ${b.heavyDays}건)`
        );
    }
    const s1 = report.soft.details.filter((d) => d.code === "S1");
    console.log(`S1 상세 ${s1.length}건 (실제 운영 시간표 기준 1건 — 5시간×1):`);
    for (const d of s1) console.log(`    ${d.text}`);
  }

  // ── 결정론: 같은 시드 재실행 = 동일 출력 ──
  const rerun = solveTimetable({
    sections: compileSectionsFromHours({ hours, model, gradeDayPeriods, teacherNames, subjectShorts })
      .sections,
    gradeDayPeriods,
    lunchAfterPeriod: model.lunchAfterPeriod,
    seed: seedUsed,
  });
  const same = hashOf(result.grids) === hashOf(rerun.grids);
  console.log(`결정론: 같은 시드 재실행 ${same ? "✅ 동일 출력" : "❌ 불일치"}`);

  const pass = report.hard.length === 0 && result.unplaced.length === 0 && same;
  console.log(
    pass
      ? `\n✅ 백지 편성 실험 통과 — 하드 0·전 시수 배치·결정론 (소프트 ${report.soft.total} vs 기준선 ${baseline.soft.total})`
      : "\n❌ 백지 편성 실험 미통과 — 위 issues·리포트가 시수표 입력 화면의 사양이다"
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
