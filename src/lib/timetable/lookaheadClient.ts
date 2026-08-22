/**
 * Phase 9c: 수읽기 워커 클라이언트 헬퍼 — UI(DraftAutoTab)가 쓰는 단일 진입점
 *
 * 사용 예:
 *   const run = searchLookaheadInWorker({ grids, model, target, budget }, (evaluated, budget) => setProgress(...));
 *   const result = await run.promise; // LookaheadResult
 *   // 이탈·재실행 시: run.cancel();
 *
 * 브라우저 전용 (Web Worker). 서버 컴포넌트·SSR 경로에서 호출하면 즉시 reject.
 * 워커는 완료·오류·취소 시 항상 terminate — 누수 없음.
 */

import type {
  LookaheadWorkerMessage,
  LookaheadWorkerRequest,
} from "./lookahead.worker";
import type { LookaheadResult } from "./lookahead";

export type { LookaheadWorkerRequest, LookaheadWorkerMessage };

export interface LookaheadRun {
  promise: Promise<LookaheadResult>;
  cancel: () => void;
}

export function searchLookaheadInWorker(
  request: LookaheadWorkerRequest,
  onProgress?: (evaluated: number, budget: number) => void
): LookaheadRun {
  if (typeof Worker === "undefined") {
    return {
      promise: Promise.reject(
        new Error("수읽기 탐색은 브라우저 화면에서만 실행할 수 있습니다.")
      ),
      cancel: () => {},
    };
  }
  const worker = new Worker(new URL("./lookahead.worker.ts", import.meta.url));
  let settled = false;
  let rejectRun: (err: Error) => void = () => {};
  const finish = () => {
    settled = true;
    worker.terminate();
  };
  const promise = new Promise<LookaheadResult>((resolve, reject) => {
    rejectRun = reject;
    worker.onmessage = (e: MessageEvent<LookaheadWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.evaluated, msg.budget);
        return;
      }
      if (settled) return;
      finish();
      if (msg.type === "done") resolve(msg.result);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      if (settled) return;
      finish();
      reject(new Error(e.message || "수읽기 탐색 작업을 시작하지 못했습니다."));
    };
    worker.postMessage(request);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      finish();
      rejectRun(new Error("cancelled"));
    },
  };
}
