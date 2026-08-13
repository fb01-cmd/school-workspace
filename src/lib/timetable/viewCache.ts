/**
 * 시간표 view 경로 인메모리 캐시 (weekly_synthesis_cache_spec §3-2)
 *
 * - 키에 항상 캐시 버전(cacheVersion.ts)이 들어간다. 쓰기마다 버전이 올라
 *   옛 항목은 자연 격리되므로, 쓰기 직전에 시작된 채움이 낡은 값을 저장해도
 *   새 요청에는 닿지 않는다 (경합 창 없음).
 * - view 라우트 전용. manage·requests·후보/체인 엔진·승인 검증은 fresh 로더 유지.
 * - 캐시 값은 역할 무관 원본이다 — 학생 sanitize 등 역할별 가공은 라우트에서.
 *   소비 측은 캐시된 객체를 변형하지 않는다 (spec §3-3-4).
 */

import {
  loadActiveTerm,
  loadAllClassGrids,
  loadBaseGridsForWeek,
  loadTimetableSettings,
  loadTimetableTerm,
  loadWeekChanges,
  listWeeks,
} from "./server";
import { synthesizeWeeklyGrids } from "./weekly";
import {
  ClassGrid,
  TimetableSettings,
  TimetableTerm,
  TimetableWeek,
} from "./types";

const TTL_MS = 10 * 60 * 1000; // 안전망 — 정상 신선도는 버전 키가 보장 (spec §3-2)
const MAX_ENTRIES = 40;

type Entry = { at: number; promise: Promise<unknown> };
const store = new Map<string, Entry>();

/**
 * 인스턴스 계측 (docs/transition_day_rehearsal_spec.md §2-1)
 *
 * 이 store는 **모듈 스코프**라 서버리스 인스턴스마다 따로 존재한다. 그래서 캐시가
 * 실제로 도는지는 "인스턴스가 얼마나 재사용되는가"에 전적으로 달려 있는데,
 * 그 값이 프로덕션에서 측정된 적이 없다.
 *
 * 모듈 로드 시 한 번 생성되는 난수 id가 곧 인스턴스 신원이다 — 응답 헤더로 내보내면
 * 밖에서 distinct 개수를 세어 **냉시작 비율 R**을 직접 잴 수 있다.
 * 개인정보·비밀값이 없고 인증된 요청에만 나가므로 상시 켜 둔다(설정 없이 다시 잴 수 있어야 한다).
 */
const INSTANCE_ID = Math.random().toString(36).slice(2, 10);
const stats = { hits: 0, misses: 0, startedAt: Date.now() };
/**
 * 직전 판정 표식 — 라우트가 읽고 지운다.
 *
 * ⚠️ **한계**: 모듈 스코프 변수라 **같은 인스턴스에서 동시 처리되는 요청끼리 섞일 수 있다.**
 * 즉 `x-tt-cache`는 요청 1건짜리 확인(리허설 단계 0)에서만 신뢰할 수 있고,
 * 동시 발사 구간에서는 참고값이다. **냉시작 비율 R은 이 값이 아니라
 * `x-tt-instance`의 distinct 개수로 계산한다** — 그쪽은 동시성과 무관하게 정확하다.
 * 누적 카운터(hits/misses)도 정확하다.
 */
let lastOutcome: "hit" | "miss" | "off" | null = null;

export function getCacheStats() {
  return {
    instanceId: INSTANCE_ID,
    hits: stats.hits,
    misses: stats.misses,
    size: store.size,
    uptimeMs: Date.now() - stats.startedAt,
  };
}

/** 이번 요청의 캐시 판정을 꺼내며 초기화한다. miss가 하나라도 있으면 miss로 본다. */
export function takeRequestOutcome(): "hit" | "miss" | "off" | "none" {
  const v = lastOutcome ?? "none";
  lastOutcome = null;
  return v;
}

function mark(outcome: "hit" | "miss" | "off") {
  if (outcome === "hit") stats.hits++;
  else if (outcome === "miss") stats.misses++;
  // 한 요청에 memo가 여러 번 걸린다 — 하나라도 miss면 그 요청엔 콜드 채움이 일어난 것이다
  if (lastOutcome === null || outcome === "miss") lastOutcome = outcome;
}

function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.TIMETABLE_VIEW_CACHE === "off") { mark("off"); return fn(); } // 킬스위치
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < TTL_MS) { mark("hit"); return hit.promise as Promise<T>; }
  mark("miss");
  const promise = fn();
  // 실패한 Promise가 TTL 동안 에러를 고정하지 않도록 즉시 제거
  promise.catch(() => {
    if (store.get(key)?.promise === promise) store.delete(key);
  });
  store.set(key, { at: now, promise });
  if (store.size > MAX_ENTRIES) {
    for (const k of store.keys()) {
      if (store.size <= MAX_ENTRIES) break;
      store.delete(k);
    }
  }
  return promise;
}

export interface ViewContext {
  settings: TimetableSettings;
  term: TimetableTerm | null;
  weeks: TimetableWeek[];
}

/** settings + term(지정/active 폴백) + 주 목록 — view 라우트 공통 재료 (~29읽기 → 1회) */
export function getViewContextCached(
  domain: string,
  version: number,
  termId?: string
): Promise<ViewContext> {
  return memo(`ctx:${domain}:${version}:${termId || ""}`, async () => {
    const settings = await loadTimetableSettings(domain);
    let term = termId ? await loadTimetableTerm(domain, termId) : null;
    if (!term) term = await loadActiveTerm(domain);
    const weeks = term ? await listWeeks(domain, term.id) : [];
    return { settings, term, weeks };
  });
}

/**
 * 주간 재료 일괄: 기초(개정 주차별 해석) + 주 변경분 + 합성 완료 그리드 + 무결성 경고.
 * week가 null이면 기초 열람 — baseDate(오늘 주 월요일)는 라우트에서 계산해 넘긴다
 * (날짜가 캐시 항목에 얼어붙지 않도록 키에 포함).
 */
export function getWeekGridsCached(
  domain: string,
  version: number,
  termId: string,
  week: TimetableWeek | null,
  baseDate: string,
  settings: TimetableSettings
): Promise<{ grids: ClassGrid[]; warnings: string[] }> {
  const slot = week ? week.id : `base:${baseDate}`;
  return memo(`grids:${domain}:${version}:${termId}:${slot}`, async () => {
    const baseGrids = await loadBaseGridsForWeek(
      domain,
      termId,
      week ? week.startDate : baseDate
    );
    if (!week) return { grids: baseGrids, warnings: [] as string[] };
    const changes = await loadWeekChanges(domain, week.id);
    const { grids, integrityWarnings } = synthesizeWeeklyGrids(
      baseGrids,
      week,
      changes,
      settings
    );
    return { grids, warnings: integrityWarnings };
  });
}

/** teachers 드롭다운용 기초 그리드 (분반·특별실 마크 포함, ~51읽기 → 1회) */
export function getBaseGridsCached(
  domain: string,
  version: number,
  termId: string
): Promise<ClassGrid[]> {
  return memo(`basegrids:${domain}:${version}:${termId}`, () =>
    loadAllClassGrids(domain, termId)
  );
}
