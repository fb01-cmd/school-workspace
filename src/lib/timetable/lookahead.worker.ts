/**
 * Phase 9c: 수읽기(Lookahead) Web Worker 본체 — UI 비블로킹 실행 + 탐색 진행률 스트림
 *
 * 브라우저 전용. 직접 import 금지 — 반드시 lookaheadClient.ts의 searchLookaheadInWorker로 기동한다
 * (이 파일을 일반 번들에 import하면 self 핸들러가 SSR에서 터진다).
 */

import { searchLookaheadLines, LookaheadTarget, LookaheadResult } from "./lookahead";
import type { ClassGrid, TimetableConstraintModel } from "./types";

export interface LookaheadWorkerRequest {
  grids: ClassGrid[];
  model: TimetableConstraintModel;
  target: LookaheadTarget;
  depth?: number;
  beamWidth?: number;
  movesPerNode?: number;
  picksPerNode?: number;
  budget?: number;
}

export type LookaheadWorkerMessage =
  | { type: "progress"; evaluated: number; budget: number }
  | { type: "done"; result: LookaheadResult }
  | { type: "error"; message: string };

const post = (msg: LookaheadWorkerMessage) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<LookaheadWorkerRequest>) => {
  try {
    const { grids, model, target, depth, beamWidth, movesPerNode, picksPerNode, budget } = e.data;
    const result = searchLookaheadLines({
      grids,
      model,
      target,
      depth,
      beamWidth,
      movesPerNode,
      picksPerNode,
      budget,
      onProgress: (evaluated, b) => post({ type: "progress", evaluated, budget: b }),
    });
    post({ type: "done", result });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : "수읽기 탐색 중 오류가 발생했습니다.",
    });
  }
};
