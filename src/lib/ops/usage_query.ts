// 사용량 화면 조회 계층 (docs/usage_dashboard_spec.md §1·§2)
//
// 세 구간을 한 번에 만든다: 오늘 진행 중 / 최근 N일 완결 / 오늘 시간대별.
// **Firestore 읽기 0** — 감시 도구가 감시 대상을 늘리지 않는다(스펙 §2). 이 성질을 깨는
// 구현(사용량을 Firestore에 적재 후 조회 등)을 추가하지 말 것.
import {
  DailyUsage,
  FIRESTORE_FREE_DAILY,
  UsageMetric,
  computeLevel,
  currentPacificDayStart,
  formatKstPeriod,
  kstResetHourLabel,
  pacificDayLabel,
  pacificDayStartDaysAgo,
} from "./usage_logic";
import { UnavailableReason, fetchBuckets, fetchTotal, toUnavailable } from "./monitoring";
import { runLiveUsageAlert } from "./usage_alert";

const METRICS: UsageMetric[] = ["reads", "writes", "deletes"];

/** 서버 인메모리 캐시 — 연타·새로고침 흡수 (스펙 §2: 60초, 지표 자체가 수 분 지연이라 손실 0) */
const CACHE_TTL_MS = 60_000;

/**
 * 지표가 실제로 나타나기까지의 지연(분). 2026-08-18 실측 = 최신 버킷이 현재로부터
 * 약 3분 전까지만 채워짐. 화면 문구는 **보수적으로 5분**을 쓴다 — 신선도를 실제보다
 * 낮게 말하는 것은 안전하지만, 높게 말하면 "방금 것도 보인다"는 오해를 만들어
 * 급증 판단을 틀리게 한다.
 *
 * ⚠️ 화면은 이 값을 쓰고, `generatedAt`으로 "N분 전"을 **계산하지 말 것**.
 *    generatedAt은 우리 서버가 응답을 만든 시각일 뿐 지표의 신선도가 아니다 —
 *    막 불러왔다고 "0분 전"이라 적으면 사실이 아니다.
 */
export const METRIC_LAG_MINUTES = 5;
let cache: { at: number; days: number; payload: UsageSnapshot } | null = null;

export interface MetricPoint {
  /** YYYY-MM-DD (일별) 또는 HH (시간별) */
  label: string;
  reads: number;
  writes: number;
  deletes: number;
}

export interface UsageSnapshot {
  available: boolean;
  reason?: UnavailableReason;
  detail?: string;
  /** 이 응답을 만든 시각(ms) — **지표 신선도가 아니다**(캐시 나이 표기용) */
  generatedAt: number;
  /** 지표 지연(분) — 화면의 "최근 N분 이내 사용량은 아직 안 보일 수 있습니다" 문구용 */
  lagMinutes: number;
  /** 하루 무료 한도 (화면이 상수를 자체 정의하지 않도록 서버가 내려준다) */
  limits?: typeof FIRESTORE_FREE_DAILY;
  /** 진행 중인 오늘(태평양) — 자정부터 지금까지 누계 */
  today?: DailyUsage & {
    level: 0 | 50 | 80;
    topMetric: UsageMetric;
    topPercent: number;
    /** 화면 표기용 — 한국 시간 구간 ("8월 17일 오후 4시 ~ 8월 18일 오후 4시") */
    periodLabel: string;
  };
  /** 한도 초기화 시각 (한국 시간, 서머타임 반영) — 화면 문구가 숫자를 지어내지 않도록 */
  resetHourLabel?: string;
  /** 일별 막대 1개가 무엇인지 — 태평양 날짜를 그대로 보여 주면 날짜가 어긋나 보인다 */
  dailyBarNote?: string;
  /** 완결된 최근 N일 (오래된 → 최신) */
  daily?: MetricPoint[];
  /** 오늘의 **완결된 시간대**만 (진행 중인 현재 1시간은 제외 — 부분 집계라 오해를 부른다) */
  hourly?: MetricPoint[];
}

function toPoints(
  buckets: Record<UsageMetric, { startMs: number; value: number }[]>,
  label: (startMs: number) => string
): MetricPoint[] {
  const byStart = new Map<number, MetricPoint>();
  for (const m of METRICS) {
    for (const b of buckets[m]) {
      const cur = byStart.get(b.startMs) || { label: label(b.startMs), reads: 0, writes: 0, deletes: 0 };
      cur[m] = b.value;
      byStart.set(b.startMs, cur);
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/**
 * 시간대 막대의 라벨. **한국 시간으로 적는다** (2026-08-21 정정).
 *
 * 종전에는 `America/Los_Angeles`로 포맷했다. 숫자 자체는 틀리지 않았다 — 파이어베이스의
 * "하루"가 태평양 시간 기준이라 버킷 경계가 실제로 그쪽에 맞춰져 있기 때문이다. 그러나
 * **화면을 보는 사람은 한국 사람이고, 라벨에는 시간대가 안 적혀 있었다.** 그래서 밤 10시의
 * 작업 급증이 `06시`로 표시됐고, 사용자가 *"그 시간엔 자고 있었다"*며 침입을 의심했다
 * (2026-08-21 실제 신고). 같은 화면 위쪽이 이미 *"매일 오후 4시(한국 시간)에 초기화"*라고
 * 한국 시간으로 안내하고 있어 **한 화면 안에서 시간대가 둘로 갈려 있던 것**이 문제였다.
 *
 * 버킷의 경계·집계 범위는 그대로다(태평양 기준 하루). **표기만 한국 시간으로 옮긴다.**
 * 그 결과 x축은 초기화 시각(오후 4시 또는 5시)에서 시작해 자정을 넘어 이어진다 —
 * 화면 쪽에서 그 사실을 한 줄로 안내한다.
 */
const hourLabel = (startMs: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(startMs));

/**
 * 화면 한 판에 필요한 자료 전부. 권한이 없으면 `available:false` — **0으로 채우지 않는다**
 * (사용량 0과 혼동 금지, usage_alert.ts와 같은 원칙).
 */
export async function getUsageSnapshot(
  opts: { days?: number; now?: Date; force?: boolean; domain?: string } = {}
): Promise<UsageSnapshot> {
  const days = Math.min(90, Math.max(7, opts.days ?? 30));
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  if (!opts.force && cache && cache.days === days && nowMs - cache.at < CACHE_TTL_MS) {
    return cache.payload;
  }

  const todayStart = currentPacificDayStart(now);
  const dailyStart = pacificDayStartDaysAgo(now, days);
  // 시간별은 **완결된 시간까지만** — 진행 중인 1시간을 넣으면 항상 마지막 막대가 낮아 보인다
  const lastFullHour = Math.floor(nowMs / 3_600_000) * 3_600_000;

  try {
    const [todayTotals, dailyBuckets, hourlyBuckets] = await Promise.all([
      Promise.all(METRICS.map((m) => fetchTotal(m, todayStart, nowMs))),
      Promise.all(METRICS.map((m) => fetchBuckets(m, dailyStart, todayStart, 86_400))),
      lastFullHour > todayStart
        ? Promise.all(METRICS.map((m) => fetchBuckets(m, todayStart, lastFullHour, 3_600)))
        : Promise.resolve(METRICS.map(() => [])),
    ]);

    const todayUsage: DailyUsage = {
      day: pacificDayLabel(todayStart),
      reads: todayTotals[0],
      writes: todayTotals[1],
      deletes: todayTotals[2],
    };
    const { level, top } = computeLevel(todayUsage);

    // ── 진행 중 경보 판정 (2026-08-21 신설) ──
    // **경보의 주 경로를 여기로 옮겼다.** 크론은 「완결된 날」만 보는데 실행 시각 때문에
    // 하루가 더 밀려, 오늘 82%를 써도 판정이 모레였다(실측: lastDay가 이틀 전에 정체,
    // 발송 0건). 사용자가 개발 당시 *"크론은 의미가 없다, 관리자가 실시간 사용량을
    // 플랫폼에서 볼 수 있게 하는 게 의미 있다"* 고 한 판단이 옳았다.
    //
    // **지표를 다시 읽지 않는다** — 바로 위에서 화면용으로 이미 읽은 `todayUsage`를 쓴다.
    // 추가 비용 0. 화면 응답을 막지 않도록 기다리지 않고(await 없음) 던져 두며,
    // `runLiveUsageAlert`는 내부에서 절대 throw 하지 않는다.
    if (opts.domain) void runLiveUsageAlert(opts.domain, todayUsage);

    const pack = (arr: Awaited<ReturnType<typeof fetchBuckets>>[]) =>
      ({ reads: arr[0], writes: arr[1], deletes: arr[2] }) as Record<
        UsageMetric,
        { startMs: number; value: number }[]
      >;

    const payload: UsageSnapshot = {
      available: true,
      generatedAt: nowMs,
      lagMinutes: METRIC_LAG_MINUTES,
      limits: FIRESTORE_FREE_DAILY,
      today: {
        ...todayUsage,
        level,
        topMetric: top.metric,
        topPercent: top.percent,
        periodLabel: formatKstPeriod(todayStart, todayStart + 24 * 3_600_000),
      },
      resetHourLabel: kstResetHourLabel(todayStart),
      dailyBarNote: `막대 하나 = ${kstResetHourLabel(todayStart)}부터 다음 날 같은 시각까지 (한국 시간)`,
      daily: toPoints(pack(dailyBuckets), pacificDayLabel),
      hourly: toPoints(pack(hourlyBuckets), hourLabel),
    };
    cache = { at: nowMs, days, payload };
    return payload;
  } catch (err: any) {
    const u = toUnavailable(err);
    // 실패는 캐시하지 않는다 — 권한을 켜자마자 다음 열람에서 살아나야 한다
    return {
      available: false,
      reason: u.reason,
      detail: u.detail,
      generatedAt: nowMs,
      lagMinutes: METRIC_LAG_MINUTES,
    };
  }
}

/** 검증·테스트용 — 캐시를 비운다 */
export function clearUsageCache() {
  cache = null;
}
