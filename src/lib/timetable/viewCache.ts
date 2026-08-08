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

function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.TIMETABLE_VIEW_CACHE === "off") return fn(); // 킬스위치
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.promise as Promise<T>;
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
