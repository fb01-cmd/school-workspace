// 절약 모드 — 순수 로직 (docs/saving_mode_spec.md §2·§4)
//
// 네트워크·Firestore 무의존. verify_saving_mode.ts가 직접 임포트한다.
//
// 이 모듈은 **값만 정한다.** 각 손잡이를 실제 호출부에 결선하는 것은 스펙 §8 순서 3이며,
// 여기서 내보내는 상수를 그쪽이 읽어 쓴다. 값과 결선을 한 파일에 섞지 않는 이유는,
// 결선이 여러 모듈(시간표 캐시·클라 캐시·쪽지 검색)에 흩어져 있어 값의 단일 원본이
// 흐려지면 "켰는데 일부만 적용되는" 상태를 만들기 때문이다.

/** 위급 조치를 영구 저하로 굳히지 않는다 — 켠 뒤 이 시간이 지나면 스스로 꺼진다 (§4) */
export const SAVING_AUTO_OFF_MS = 24 * 3600 * 1000;

export interface SavingModeState {
  on: boolean;
  /** 켠 시각(ms) — 자동 해제 기준 */
  turnedOnAt: number;
  /** 켠 사람 (감사·배너 표기용) */
  turnedOnBy: string;
}

export const SAVING_MODE_OFF: SavingModeState = { on: false, turnedOnAt: 0, turnedOnBy: "" };

/**
 * 손잡이 값. **개별 토글로 쪼개지 않는다** — 위급 상황에 관리자가 항목별로 고민하게
 * 만들지 않는다는 스펙 §2의 결정.
 *
 * ⚠️ 승인·커밋 등 **쓰기 직전 fresh 읽기 경로는 이 값의 적용 대상이 아니다.**
 *    (시간표 읽기 다이어트에서 세운 선 — 절약이 데이터 사고가 되는 자리)
 */
export interface SavingKnobs {
  /** 클라이언트 인메모리 캐시 수명 (현행 기본 5분) */
  clientCacheTtlMs: number;
  /** 시간표 후보 advisory 캐시 수명 (현행 10분) — 1순위 비용원 */
  timetableCacheTtlMs: number;
  /** 쪽지 검색 기본 기간(일). 범위 키가 아니라 일수로 두어, 결선 쪽이 형태를 정하게 한다 */
  memoSearchDefaultDays: number;
}

export const KNOBS_NORMAL: SavingKnobs = {
  clientCacheTtlMs: 5 * 60 * 1000,
  timetableCacheTtlMs: 10 * 60 * 1000,
  memoSearchDefaultDays: 90,
};

export const KNOBS_SAVING: SavingKnobs = {
  clientCacheTtlMs: 60 * 60 * 1000,
  timetableCacheTtlMs: 60 * 60 * 1000,
  memoSearchDefaultDays: 30,
};

export interface ResolvedSavingMode {
  /** 지금 실제로 켜져 있는가 — 저장된 on이 true여도 24시간이 지났으면 false */
  active: boolean;
  /** 자동 해제 예정 시각(ms) — active일 때만 */
  expiresAt?: number;
  /** 남은 시간(ms) — 배너 표기용 */
  remainingMs?: number;
  /** 저장된 on이 true인데 시간이 지나 꺼진 상태 = 정리 대상 (daily-sync가 문서를 끈다) */
  staleOn: boolean;
  turnedOnBy?: string;
  knobs: SavingKnobs;
}

/**
 * 저장 상태 + 현재 시각 → 실제 적용 상태.
 *
 * 자동 해제를 **읽는 쪽에서 판정**하는 이유: 크론이 문서를 끄기 전이라도 24시간이
 * 지나면 즉시 평시로 돌아가야 한다. 크론에만 맡기면 최대 하루 동안 불필요한 저하가
 * 남는다(크론은 문서 정리만 담당).
 */
export function resolveSavingMode(
  state: SavingModeState | null | undefined,
  now: number
): ResolvedSavingMode {
  const s = state && typeof state.turnedOnAt === "number" ? state : SAVING_MODE_OFF;
  if (!s.on) return { active: false, staleOn: false, knobs: KNOBS_NORMAL };

  const expiresAt = s.turnedOnAt + SAVING_AUTO_OFF_MS;
  if (now >= expiresAt) {
    // 시간 초과 — 저장값은 켜짐이지만 적용은 평시. 문서 정리는 크론 몫.
    return { active: false, staleOn: true, knobs: KNOBS_NORMAL };
  }
  return {
    active: true,
    expiresAt,
    remainingMs: expiresAt - now,
    staleOn: false,
    turnedOnBy: s.turnedOnBy || undefined,
    knobs: KNOBS_SAVING,
  };
}

/** 배너 문구 — 개발 용어 금지(캐시·TTL·쿼터 등 노출 안 함) */
export function buildSavingBannerText(r: ResolvedSavingMode): string | null {
  if (!r.active || r.remainingMs == null) return null;
  const hours = Math.floor(r.remainingMs / 3600_000);
  const mins = Math.floor((r.remainingMs % 3600_000) / 60_000);
  const left = hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
  return `지금은 데이터 사용을 줄이는 중입니다. ${left} 뒤 자동으로 원래대로 돌아갑니다.`;
}
