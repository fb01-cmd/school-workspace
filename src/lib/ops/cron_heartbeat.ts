// 크론 심박(heartbeat) — "돌았는지"를 알 수 있게 한다.
//
// ── 왜 필요한가 (같은 사고가 두 번) ─────────────────────────────────────
// 이 저장소의 크론들은 **할 일이 없으면 아무 기록도 남기지 않는다.** 그래서 조용히
// 멈춰도 아무도 모른다.
//   · 2026-08-13: 생활지도 시트 브리지가 8/11부터 이틀간 죽어 있었는데 화면에 표시가
//     없어, 감사 로그를 뒤져서야 발견했다.
//   · 2026-08-18: 교사 전출 자동 일시정지가 기한(7/17)보다 **7일 늦은 7/24**에 실행됐다.
//     그 7일 동안 생애주기 크론이 돌지 않았다는 뜻인데, 한 달이 지나도록 아무도 몰랐고
//     그만큼 자동 삭제 예정일도 통째로 밀렸다(사용자의 한 달짜리 검증이 여기서 어긋났다).
//
// 그래서 **성공하든 아무 일이 없든 매 실행마다 한 줄을 남긴다.** 비용은 크론당 하루 1 쓰기다.
//
// 이 모듈은 크론을 방해하지 않는다 — 기록 실패는 삼키고 넘어간다. 심박이 본 작업을
// 무너뜨리면 본말전도다.
import { adminDb } from "@/lib/firebase/admin";

export type CronName = "lifecycle" | "daily-sync";

/** 심박이 이 시간보다 오래 끊기면 "멈춘 것으로 본다" — 하루 1회 크론 기준 여유 있게 */
export const CRON_STALE_MS = 36 * 3600 * 1000;

const heartbeatRef = () => adminDb.collection("platform_config").doc("cron_heartbeat");

export interface CronBeat {
  /** 마지막 실행 시각(ms) */
  lastRunAt: number;
  /** 마지막 실행이 남긴 한 줄 요약 (사람이 읽는다) */
  lastSummary?: string;
  /** 마지막 실행에서 오류가 있었는가 — 돌았지만 실패한 상태를 "정상"으로 읽지 않도록 */
  lastHadError?: boolean;
  /** 누적 실행 횟수 (심박 도입 이후) */
  runCount?: number;
}

/**
 * 실행 사실을 남긴다. **작업이 아무것도 안 했어도 반드시 호출한다** — 그게 이 모듈의 전부다.
 * 실패해도 던지지 않는다.
 */
export async function recordCronRun(
  name: CronName,
  opts: { summary?: string; hadError?: boolean; now?: number } = {}
): Promise<void> {
  try {
    const now = opts.now ?? Date.now();
    const snap = await heartbeatRef().get();
    const prev = (snap.exists ? (snap.data() || {})[name] : null) as CronBeat | null;
    const beat: CronBeat = {
      lastRunAt: now,
      lastSummary: (opts.summary || "").slice(0, 300),
      lastHadError: !!opts.hadError,
      runCount: (prev?.runCount ?? 0) + 1,
    };
    await heartbeatRef().set({ [name]: beat }, { merge: true });
  } catch {
    // 심박 기록 실패가 크론을 무너뜨리지 않는다
  }
}

export interface CronStatus extends Partial<CronBeat> {
  name: CronName;
  /** 한 번도 기록된 적 없음 (심박 도입 직후이거나 크론이 죽어 있음) */
  never: boolean;
  /** 심박이 끊겼는가 */
  stale: boolean;
  /** 마지막 실행 이후 경과(ms) */
  ageMs?: number;
}

const ALL: CronName[] = ["lifecycle", "daily-sync"];

/** 전체 크론의 심박 상태 — 화면·검증 스크립트가 함께 쓴다 */
export async function readCronStatuses(now = Date.now()): Promise<CronStatus[]> {
  let data: any = {};
  try {
    const snap = await heartbeatRef().get();
    data = snap.exists ? snap.data() || {} : {};
  } catch {
    // 조회 실패 시 전부 "모름"으로 — 조용히 정상이라고 말하지 않는다
  }
  return ALL.map((name) => {
    const b = data[name] as CronBeat | undefined;
    if (!b || typeof b.lastRunAt !== "number") {
      return { name, never: true, stale: true };
    }
    const ageMs = now - b.lastRunAt;
    return {
      name,
      ...b,
      never: false,
      stale: ageMs > CRON_STALE_MS,
      ageMs,
    };
  });
}

/** 화면 문구용 — 개발 용어 금지 */
export const CRON_LABEL: Record<CronName, string> = {
  lifecycle: "계정 생애주기 정리",
  "daily-sync": "일일 수집·정리",
};
