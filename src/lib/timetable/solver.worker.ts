/**
 * Phase 9c-C2: 솔버 Web Worker 본체 — UI 비블로킹 실행 + 진행률 스트림 (phase9c_spec §5)
 *
 * 브라우저 전용. 직접 import 금지 — 반드시 solverClient.ts의 solveTimetableInWorker로 기동한다
 * (이 파일을 일반 번들에 import하면 self 핸들러가 SSR에서 터진다).
 *
 * 처리 순서: 섹션 컴파일(역산) → 시드 포트폴리오 → 검사기 관문(validateTimetable)까지
 * 워커 안에서 전부 수행 — UI는 완성 그리드 + 관문 리포트를 받기만 한다 (§0-1 철칙).
 */

import {
  compileSectionsFromGrids,
  solveTimetablePortfolio,
  SolverWorkerMessage,
  SolverWorkerRequest,
} from "./solver";
import { deriveGradeDayPeriods, deriveHoursFromGrids, validateTimetable } from "./validate";

const post = (msg: SolverWorkerMessage) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<SolverWorkerRequest>) => {
  try {
    const { grids, model, seeds, localSearchIterations } = e.data;
    const gradeDayPeriods = model.gradeDayPeriods || deriveGradeDayPeriods(grids);
    // 시수표 미제공 시 입력(기준) 그리드에서 역산 — 관문 리포트의 H1/H4가
    // "기준 대비 시수 보존"을 감시하게 한다 (phase9c_d_spec §7 — draft_model엔 hours가 없음)
    const hours = model.hours?.length ? model.hours : deriveHoursFromGrids(grids);
    const sections = compileSectionsFromGrids(grids, model);
    const { best, ranking } = solveTimetablePortfolio({
      sections,
      gradeDayPeriods,
      lunchAfterPeriod: model.lunchAfterPeriod,
      seeds,
      localSearchIterations,
      onProgress: (phase, done, total) => post({ type: "progress", phase, done, total }),
    });
    const report = validateTimetable(best.grids, { ...model, gradeDayPeriods, hours });
    post({
      type: "done",
      seed: best.seed,
      grids: best.grids,
      unplaced: best.unplaced,
      stats: best.stats,
      ranking,
      report,
    });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : "시간표 자동 작성 중 오류가 발생했습니다.",
    });
  }
};
