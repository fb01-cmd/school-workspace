// Firestore 사용량 조기 경보 — 순수 로직 (development_roadmap.md §2 「Firestore 사용량 조기 경보」)
//
// 이 파일은 네트워크·Firestore 무의존이다 — verify_usage_alert.ts가 직접 임포트한다.
// (memo/logic.ts·search_logic.ts와 같은 규약: 판정은 순수 함수, I/O는 usage_alert.ts)
//
// 왜 만드나: 한도 소진은 지금까지 **사후 통보**였다 — 그날 화면 전체가 401로 죽고 나서야
// 알았다(2026-08-08 실사고). 이 모듈은 그것을 "몇 주 전부터 보이는 추세"로 바꾼다.
//
// ── 왜 태평양 시간인가 (틀리기 쉬운 지점) ────────────────────────────────
// Firestore 무료 할당량은 **미국 태평양 시간 자정**에 초기화된다. KST 기준으로 하루를
// 자르면 두 개의 서로 다른 할당 주기가 섞여 비율이 왜곡된다. 그래서 이 모듈은 판정 단위를
// 「마지막으로 완결된 태평양 날짜」로 고정한다. KST 03:00 크론 시점의 태평양 시간은 아직
// 전날 오전이므로, 보고 대상은 KST 기준 이틀 전처럼 보인다 — 정상이다. 이 경보의 목적은
// 실시간 차단이 아니라 추세 관측이므로 하루 지연은 수용한다.

/** Firestore 무료 일일 할당량 (Blaze에서도 매일 이만큼은 무료 — 넘는 순간부터 과금) */
export const FIRESTORE_FREE_DAILY = {
  reads: 50_000,
  writes: 20_000,
  deletes: 20_000,
} as const;

export type UsageMetric = keyof typeof FIRESTORE_FREE_DAILY;

/** 화면 문구용 — 개발 용어 금지 규칙(UI 문구에 Firestore·쿼터 등 노출 안 함) */
const METRIC_LABEL: Record<UsageMetric, string> = {
  reads: "조회",
  writes: "저장",
  deletes: "삭제",
};

export interface DailyUsage {
  /** 태평양 기준 완결일 (YYYY-MM-DD) */
  day: string;
  reads: number;
  writes: number;
  deletes: number;
}

/** 0 = 조용함 / 50·80 = 해당 임계 초과 */
export type AlertLevel = 0 | 50 | 80;

export interface UsageRatio {
  metric: UsageMetric;
  used: number;
  limit: number;
  /** 0~ (100 초과 가능) */
  percent: number;
}

export interface AlertState {
  /** 마지막으로 알린 단계 — 같은 단계 반복 발송을 막는다 */
  lastLevel: AlertLevel;
  /** 마지막 발송 시각(ms) */
  lastEmittedAt: number;
  /** 마지막으로 판정한 태평양 날짜 — 같은 날 재실행 시 중복 방지 */
  lastDay?: string;
}

export const EMPTY_ALERT_STATE: AlertState = { lastLevel: 0, lastEmittedAt: 0 };

/**
 * 진행 중인 오늘 주기의 판정 결과 — **완결일 축과 별도로 둔다** (2026-08-21 신설).
 *
 * **왜 축을 나누는가**: 종전 경보는 `lastCompletePacificDay`, 즉 **완결된 마지막 날**만 봤다.
 * 게다가 크론이 18:00 UTC(태평양 11:00)에 돌아 하루가 더 밀린다 — 8/21 새벽 크론이 8/19를
 * 판정한다. **오늘 한도의 82%를 써도 경보는 모레 온다.** 한도 소진을 막는 데는 늦다
 * (2026-08-08 실제 소진 사고가 이 형태였다).
 *
 * 두 축을 한 상태에 섞으면 «어제 80%» 와 «오늘 80%» 가 서로를 중복으로 눌러 버린다.
 * 그래서 완결일(`lastDay`/`lastLevel`)과 진행일(`liveDay`/`liveLevel`)을 분리한다.
 */
export interface LiveAlertFields {
  /** 진행 중 주기로 판정한 태평양 날짜 */
  liveDay?: string;
  /** 그 날에 대해 이미 알린 단계 — 같은 날 같은 단계 반복 발송 방지 */
  liveLevel?: AlertLevel;
}

/**
 * 진행 중인 오늘 주기의 발송 판정 — 하루 안에서 **단계가 올라갈 때만** 알린다.
 * (50% 도달 1회, 80% 도달 1회. 같은 단계에 머무는 동안은 조용하다.)
 *
 * 완결일 판정(`decideEmit`)과 달리 **재알림 간격이 없다** — 진행 중 경보의 목적은
 * "지금 멈추라"이고, 하루가 지나면 어차피 새 주기라 축적될 여지가 없다.
 */
export function decideEmitLive(
  level: AlertLevel,
  state: AlertState & LiveAlertFields,
  day: string
): { emit: boolean; reason: string; nextLive: LiveAlertFields } {
  const sameDay = state.liveDay === day;
  const prev: AlertLevel = sameDay ? (state.liveLevel ?? 0) : 0;

  if (level === 0) {
    return {
      emit: false,
      reason: sameDay && prev > 0 ? "진행 중 — 50% 아래로 회복" : "진행 중 — 조용함",
      nextLive: { liveDay: day, liveLevel: 0 },
    };
  }
  if (level > prev) {
    return {
      emit: true,
      reason: `진행 중 단계 상승 ${prev}% → ${level}%`,
      nextLive: { liveDay: day, liveLevel: level },
    };
  }
  return {
    emit: false,
    reason: `진행 중 ${level}% 유지 — 이미 알림`,
    nextLive: { liveDay: day, liveLevel: prev },
  };
}

/** 같은 단계에 머무를 때의 재알림 간격 — 매일 잔소리와 영구 침묵 사이의 타협 */
export const REPEAT_REMINDER_MS = 7 * 24 * 3600 * 1000;

export function computeRatios(u: DailyUsage): UsageRatio[] {
  return (Object.keys(FIRESTORE_FREE_DAILY) as UsageMetric[]).map((metric) => {
    const limit = FIRESTORE_FREE_DAILY[metric];
    const used = Math.max(0, Math.round(u[metric]));
    return { metric, used, limit, percent: (used / limit) * 100 };
  });
}

/**
 * 세 지표 중 **가장 많이 쓴 것**으로 단계를 판정한다.
 * (읽기만 보지 않는 이유: 월별 개인 사본 같은 구조 변경은 쓰기를 늘린다 — 읽기만 보면
 *  그 부작용을 놓친다.)
 */
export function computeLevel(u: DailyUsage): { level: AlertLevel; top: UsageRatio } {
  const ratios = computeRatios(u);
  const top = ratios.reduce((a, b) => (b.percent > a.percent ? b : a));
  const level: AlertLevel = top.percent >= 80 ? 80 : top.percent >= 50 ? 50 : 0;
  return { level, top };
}

export interface EmitDecision {
  emit: boolean;
  /** 사람이 읽는 판정 사유 — 크론 로그·검증 스크립트용 */
  reason: string;
  nextState: AlertState;
}

/**
 * 발송 여부 판정.
 *  - 단계가 **올라가면** 알린다 (0→50, 50→80, 0→80)
 *  - 같은 단계에 머무르면 7일에 한 번만 (85%로 한 달을 버티는 동안 침묵하지 않도록)
 *  - 50% 아래로 내려오면 상태를 0으로 되돌린다 → 다음 상승 때 다시 알린다
 *  - 같은 날을 두 번 판정하면(크론 재실행·수동 실행) 발송하지 않는다
 */
export function decideEmit(
  level: AlertLevel,
  state: AlertState,
  now: number,
  day: string
): EmitDecision {
  if (state.lastDay === day) {
    return { emit: false, reason: `이미 판정한 날(${day}) — 중복 실행`, nextState: state };
  }
  const base: AlertState = { ...state, lastDay: day };

  if (level === 0) {
    return {
      emit: false,
      reason: state.lastLevel > 0 ? "한도의 50% 아래로 회복 — 상태 초기화" : "조용함",
      nextState: { ...base, lastLevel: 0 },
    };
  }
  if (level > state.lastLevel) {
    return {
      emit: true,
      reason: `단계 상승 ${state.lastLevel}% → ${level}%`,
      nextState: { ...base, lastLevel: level, lastEmittedAt: now },
    };
  }
  if (now - state.lastEmittedAt >= REPEAT_REMINDER_MS) {
    return {
      emit: true,
      reason: `${level}% 유지 중 — 주간 재알림`,
      nextState: { ...base, lastLevel: level, lastEmittedAt: now },
    };
  }
  return {
    emit: false,
    reason: `${level}% 유지 중 — 재알림 간격 이내`,
    nextState: { ...base, lastLevel: level },
  };
}

/** 알림 문구 — 개발 용어 금지(사용자 화면에 Firestore·쿼터·API 같은 말을 쓰지 않는다) */
export function buildAlertText(
  level: AlertLevel,
  top: UsageRatio,
  day: string
): { title: string; message: string } {
  const label = METRIC_LABEL[top.metric];
  const pct = Math.round(top.percent);
  const title =
    level === 80
      ? "데이터 사용량 주의 — 무료 한도의 80%를 넘었습니다"
      : "데이터 사용량이 무료 한도의 절반을 넘었습니다";
  const tail =
    level === 80
      ? "한도를 넘으면 요금이 발생합니다. 비용을 줄이는 개선을 시작할 시점입니다."
      : "아직 여유가 있습니다. 계속 늘어나는 추세인지 지켜볼 시점입니다.";
  const message =
    `${day} 하루 ${label} ${top.used.toLocaleString("ko-KR")}건 ` +
    `(하루 무료 ${top.limit.toLocaleString("ko-KR")}건의 ${pct}%). ${tail}`;
  return { title, message: message.slice(0, 200) };
}

// ── 태평양 시간 경계 계산 ────────────────────────────────────────────────

interface PacificParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function pacificParts(at: Date): PacificParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    // en-US hour12:false는 자정을 "24"로 내는 구현이 있다 — 24를 0으로 접는다
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

/** 태평양 시간대의 UTC 대비 오프셋(ms) — PST -8h, PDT -7h */
function pacificOffsetMs(at: Date): number {
  const p = pacificParts(at);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** 태평양 기준 y-m-d 자정의 UTC ms — 서머타임 전환일 포함 안전(오프셋 재계산 1회로 수렴) */
function pacificMidnightUtcMs(y: number, m: number, d: number): number {
  const approx = Date.UTC(y, m - 1, d) + 8 * 3600 * 1000; // PST 가정 1차 근사
  const off = pacificOffsetMs(new Date(approx));
  return Date.UTC(y, m - 1, d) - off;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface PacificDayWindow {
  /** YYYY-MM-DD (태평양 기준) */
  day: string;
  startMs: number;
  /** 배타적 끝 — 다음 날 자정 */
  endMs: number;
}

/** 태평양 기준 오늘(진행 중) 자정의 UTC ms */
export function currentPacificDayStart(now: Date): number {
  const t = pacificParts(now);
  return pacificMidnightUtcMs(t.y, t.m, t.d);
}

/** 태평양 날짜 라벨 (YYYY-MM-DD) */
export function pacificDayLabel(atMs: number): string {
  const p = pacificParts(new Date(atMs));
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

/**
 * 태평양 기준 오늘로부터 `days`일 **전 날짜의 자정** UTC ms.
 * 고정 86400초를 빼지 않고 **달력 날짜로 물러난 뒤 자정을 다시 계산**한다 —
 * 서머타임 전환이 낀 구간에서 86400초 산술은 자정에서 1시간 어긋나고,
 * 그러면 24시간 버킷이 전부 밀려 날짜별 수치가 통째로 틀린다(이 파일 상단 경고).
 */
export function pacificDayStartDaysAgo(now: Date, days: number): number {
  const t = pacificParts(now);
  const shifted = new Date(Date.UTC(t.y, t.m - 1, t.d - days));
  return pacificMidnightUtcMs(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

/**
 * 「마지막으로 완결된 태평양 날짜」의 구간을 돌려준다.
 * 진행 중인 날을 쓰지 않는 이유: 부분 집계라 항상 낮게 보여 경보가 늦는다.
 */
export function lastCompletePacificDay(now: Date): PacificDayWindow {
  const today = pacificParts(now);
  const todayStart = pacificMidnightUtcMs(today.y, today.m, today.d);
  // 진행 중인 날의 자정에서 12시간 되돌리면 서머타임과 무관하게 전날 안쪽에 떨어진다
  const prev = pacificParts(new Date(todayStart - 12 * 3600 * 1000));
  const startMs = pacificMidnightUtcMs(prev.y, prev.m, prev.d);
  return { day: `${prev.y}-${pad2(prev.m)}-${pad2(prev.d)}`, startMs, endMs: todayStart };
}

/**
 * 한도 주기를 **한국 시간 구간**으로 풀어 쓴다.
 *
 * 왜 필요한가 (2026-08-18 사용자 신고): 화면이 태평양 날짜를 그대로 "기준 일자"로
 * 보여 주니, 한국 시간 8/18 새벽에 「오늘 사용량」의 기준 일자가 8/17이고 그래프
 * 마지막 날은 8/16이라 **날짜가 셋 다 달라 보였다.** 내부적으로는 전부 맞는 값이지만
 * 읽는 사람에게는 고장으로 보인다.
 *
 * 그래서 날짜 대신 **"몇 시부터 몇 시까지"**로 말한다. 한도가 초기화되는 시각은
 * 서머타임에 따라 한국 시간 오후 4시 또는 5시라, 문자열을 짐작하지 않고 실제 경계
 * 시각을 그대로 포맷한다.
 */
export function formatKstPeriod(startMs: number, endMs: number): string {
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "long",
      day: "numeric",
      hour: "numeric",
      hour12: true,
    }).format(new Date(ms));
  return `${fmt(startMs)} ~ ${fmt(endMs)}`;
}

/** 한도 초기화 시각을 한국 시간으로 (서머타임에 따라 오후 4시 또는 5시) */
export function kstResetHourLabel(anyDayStartMs: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    hour12: true,
  }).format(new Date(anyDayStartMs));
}
