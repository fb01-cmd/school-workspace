// 절약 모드 — I/O 계층 (docs/saving_mode_spec.md §3·§4). 판정은 saving_logic.ts.
//
// 전달 경로: `platform_config/saving_mode` 문서 1건을 **클라이언트가 직접 구독**한다
// (firestore.rules에서 로그인 사용자 읽기 허용, 쓰기는 서버 경유만).
// 로그인 시 1회 프리페치로 하지 않는 이유 = 이미 접속 중인 교사에게 안 닿아 위급 레버
// 자격이 없다(스펙 §3). 비용은 세션당 1 읽기 + 토글 시 1 — 하루 80명 기준 ≈ 80 읽기.
import { adminDb } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  KNOBS_NORMAL,
  ResolvedSavingMode,
  SAVING_MODE_OFF,
  SavingKnobs,
  SavingModeState,
  resolveSavingMode,
} from "./saving_logic";

export const savingModeRef = () => adminDb.collection("platform_config").doc("saving_mode");

function parse(data: any): SavingModeState {
  if (!data) return SAVING_MODE_OFF;
  return {
    on: data.on === true,
    turnedOnAt: typeof data.turnedOnAt === "number" ? data.turnedOnAt : 0,
    turnedOnBy: typeof data.turnedOnBy === "string" ? data.turnedOnBy : "",
  };
}

/** 저장 상태 그대로 (자동 해제 판정 전) */
export async function readSavingModeState(): Promise<SavingModeState> {
  const snap = await savingModeRef().get();
  return parse(snap.exists ? snap.data() : null);
}

/** 지금 실제로 적용되는 상태 — 서버 경로에서 손잡이 값을 물을 때 쓴다 */
export async function getSavingMode(now = Date.now()): Promise<ResolvedSavingMode> {
  return resolveSavingMode(await readSavingModeState(), now);
}

// ── 서버 경로용 동기 접근자 (결선, 스펙 §8 순서 3) ──────────────────────
//
// 캐시 수명 판정 같은 **동기 지점**에서 손잡이 값을 물어야 하는데, 매번 Firestore를
// 읽으면 절약하려다 읽기를 늘리는 자가당착이 된다. 그래서 마지막으로 읽은 값을
// 모듈에 들고 있다가 5분마다 백그라운드로만 갱신한다.
//
// 비용: 인스턴스당 최대 288 읽기/일(5분 주기). 이 접근자를 부르는 요청은 후보 계산
// 경로(요청당 240+ 읽기)뿐이라 상대 비용은 무시할 수 있다.
// 지연: 켜고 최대 5분 뒤에 서버 쪽 손잡이가 반응한다 — 위급 조치가 초 단위로 급하지는
// 않으므로 수용한다(화면 배너는 구독이라 즉시 뜬다).
const KNOB_CACHE_TTL_MS = 5 * 60 * 1000;
let knobCache: { knobs: SavingKnobs; at: number } = { knobs: KNOBS_NORMAL, at: 0 };
let knobRefreshInFlight = false;

function refreshKnobsSoon() {
  if (knobRefreshInFlight) return;
  knobRefreshInFlight = true;
  readSavingModeState()
    .then((state) => {
      knobCache = { knobs: resolveSavingMode(state, Date.now()).knobs, at: Date.now() };
    })
    .catch(() => {
      // 읽기 실패 시 평시 값을 유지한다 — 절약 모드를 "모르면 켜진 것으로" 취급하지 않는다
      knobCache = { knobs: KNOBS_NORMAL, at: Date.now() };
    })
    .finally(() => {
      knobRefreshInFlight = false;
    });
}

/**
 * 동기 손잡이 조회. 첫 호출은 평시 값을 돌려주고 갱신을 예약한다 —
 * **모르는 상태의 기본값은 언제나 평시**다(절약 모드가 사고로 켜져 있는 것보다 낫다).
 */
export function getKnobsCached(now = Date.now()): SavingKnobs {
  if (now - knobCache.at > KNOB_CACHE_TTL_MS) refreshKnobsSoon();
  return knobCache.knobs;
}

/** 토글 직후 즉시 반영 — 켠 사람이 다음 요청에서 5분을 기다리지 않도록 */
function primeKnobCache(resolved: ResolvedSavingMode, now: number) {
  knobCache = { knobs: resolved.knobs, at: now };
}

/** 검증용 — 캐시를 비운다 */
export function clearKnobCache() {
  knobCache = { knobs: KNOBS_NORMAL, at: 0 };
}

export interface ToggleResult {
  state: SavingModeState;
  resolved: ResolvedSavingMode;
}

/**
 * 켜기/끄기 — **사람이 켠다.** 자동 발동 경로를 만들지 말 것(스펙 §6):
 * 자동 완화는 원인 규명을 가린다. 급증은 대개 버그 신호이고, 그것을 조용히 덮으면
 * 버그가 그대로 남는다.
 */
export async function setSavingMode(
  on: boolean,
  actorEmail: string,
  now = Date.now()
): Promise<ToggleResult> {
  const state: SavingModeState = on
    ? { on: true, turnedOnAt: now, turnedOnBy: actorEmail.trim().toLowerCase() }
    : { ...SAVING_MODE_OFF };
  await savingModeRef().set(state);

  await writeAuditLog({
    operatorEmail: actorEmail,
    targetEmail: "platform_config/saving_mode",
    action: on ? "saving_mode_on" : "saving_mode_off",
    details: on ? "데이터 절약 모드 켜짐 (24시간 뒤 자동 해제)" : "데이터 절약 모드 꺼짐",
    status: "success",
  }).catch(() => {});

  const resolved = resolveSavingMode(state, now);
  primeKnobCache(resolved, now);
  return { state, resolved };
}

export interface SavingSweepSummary {
  /** 24시간이 지나 문서를 끈 건수 (0 또는 1) */
  turnedOff: number;
  active: boolean;
}

/**
 * daily-sync 합류분 — 24시간 지난 절약 모드 문서를 끈다.
 * 적용 자체는 읽는 쪽(`resolveSavingMode`)이 이미 시간으로 판정하므로, 이 크론이 늦어도
 * 사용자는 제때 평시로 돌아간다. 크론은 **문서 정리**만 담당한다.
 */
export async function sweepSavingMode(now = Date.now()): Promise<SavingSweepSummary> {
  const state = await readSavingModeState();
  const r = resolveSavingMode(state, now);
  if (r.staleOn) {
    await savingModeRef().set({ ...SAVING_MODE_OFF });
    await writeAuditLog({
      operatorEmail: "system",
      targetEmail: "platform_config/saving_mode",
      action: "saving_mode_auto_off",
      details: "24시간 경과로 데이터 절약 모드 자동 해제",
      status: "success",
    }).catch(() => {});
    primeKnobCache(resolveSavingMode(SAVING_MODE_OFF, now), now);
    return { turnedOff: 1, active: false };
  }
  return { turnedOff: 0, active: r.active };
}
