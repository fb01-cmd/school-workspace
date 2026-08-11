/**
 * Phase 9c-C2: 솔버 워커 클라이언트 헬퍼 — Phase D(작성·수동 조정 UI)가 쓰는 단일 진입점
 *
 * 사용 예:
 *   const run = solveTimetableInWorker({ grids, model }, (phase, done, total) => setProgress(...));
 *   const done = await run.promise; // { grids, report, ranking, ... }
 *   // 이탈·재실행 시: run.cancel();
 *
 * 브라우저 전용 (Web Worker). 서버 컴포넌트·SSR 경로에서 호출하면 즉시 reject.
 * 워커는 완료·오류·취소 시 항상 terminate — 누수 없음.
 */

import type { SolverWorkerMessage, SolverWorkerRequest } from "./solver";

export type SolverDone = Extract<SolverWorkerMessage, { type: "done" }>;

export interface SolverRun {
  promise: Promise<SolverDone>;
  cancel: () => void;
}

export function solveTimetableInWorker(
  request: SolverWorkerRequest,
  onProgress?: (phase: string, done: number, total: number) => void
): SolverRun {
  if (typeof Worker === "undefined") {
    return {
      promise: Promise.reject(
        new Error("시간표 자동 작성은 브라우저 화면에서만 실행할 수 있습니다.")
      ),
      cancel: () => {},
    };
  }
  const worker = new Worker(new URL("./solver.worker.ts", import.meta.url));
  let settled = false;
  let rejectRun: (err: Error) => void = () => {};
  const finish = () => {
    settled = true;
    worker.terminate();
  };
  const promise = new Promise<SolverDone>((resolve, reject) => {
    rejectRun = reject;
    worker.onmessage = (e: MessageEvent<SolverWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.phase, msg.done, msg.total);
        return;
      }
      if (settled) return;
      finish();
      if (msg.type === "done") resolve(msg);
      else reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      if (settled) return;
      finish();
      reject(new Error(e.message || "시간표 자동 작성 작업을 시작하지 못했습니다."));
    };
    worker.postMessage(request);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      finish();
      rejectRun(new Error("cancelled")); // 취소 후 대기 중인 await가 영원히 걸리지 않도록
    },
  };
}
