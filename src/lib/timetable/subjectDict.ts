/**
 * 과목 이름 단일 사전 — 색인·정확 일치·관문 후보 제안 (subject_dictionary_spec)
 *
 * 원칙: 추측(느슨 매칭)은 배정표 불러오기 관문의 후보 제안에서 한 번만 쓰고 사람이
 * 확정한다. 확정 표기는 사전(term.subjects의 name/shortName/aliases)에 박제되고,
 * 내부 판정은 이 사전 안에서의 정규화 정확 일치만 쓴다.
 *
 * 순수 함수만 둔다 (Firestore 의존 없음 — 셀프테스트·클라이언트 공용).
 * import 방향: subjectDict → hoursAssignment(후보 엔진). simul/solver/validate가
 * 이 모듈을 import하므로 여기서 그들을 import하면 순환이 된다 — 금지.
 */

import { subjectMatches, subjectStemLoose } from "./hoursAssignment";
import { SubjectNameEntry, SubjectNameHistoryEntry } from "./types";

/** 표기 정규화 — validate.ts normSubject와 같은 규약 (NFC·공백 제거·소문자).
 *  규약을 바꾸면 저장된 그리드·등록부 대조가 전부 흔들린다 — 바꾸지 말 것. */
export const normSubjectName = (s: string): string =>
  (s || "").normalize("NFC").replace(/\s+/g, "").trim().toLowerCase();

/**
 * 사전 색인 — 정규화 표기 → 사전 항목(동일 객체 참조가 동치 판정의 근거).
 * ambiguous: 서로 다른 항목이 같은 표기를 주장하는 정규화 키 집합. 컴시간 유래 약칭이
 * 앞 2글자 폴백이라 실데이터에서 충돌이 실재한다("과학"↔"과학사" 류) — 그런 표기는
 * 색인에서 제외해 정확 일치가 어느 쪽에도 붙지 않게 한다 (추측 금지의 색인판).
 */
export interface SubjectIndex {
  byNorm: Map<string, SubjectNameEntry>;
  ambiguous: Set<string>;
}

/** 항목의 합법 표기 전체 — { name, shortName, ...aliases } */
export function entrySpellings(e: SubjectNameEntry): string[] {
  return [e.name, e.shortName, ...(e.aliases || [])].filter(Boolean);
}

export function buildSubjectIndex(subjects: SubjectNameEntry[] | undefined): SubjectIndex {
  const byNorm = new Map<string, SubjectNameEntry>();
  const ambiguous = new Set<string>();
  for (const e of subjects || []) {
    for (const sp of entrySpellings(e)) {
      const key = normSubjectName(sp);
      if (!key) continue;
      const prev = byNorm.get(key);
      if (prev && prev !== e) {
        ambiguous.add(key);
        continue;
      }
      byNorm.set(key, e);
    }
  }
  for (const key of ambiguous) byNorm.delete(key);
  return { byNorm, ambiguous };
}

/** 내부 판정의 전부 — 색인 정확 일치. 실패 시 null (추측하지 않는다). */
export function resolveExact(index: SubjectIndex, raw: string): SubjectNameEntry | null {
  return index.byNorm.get(normSubjectName(raw)) || null;
}

/**
 * 두 표기가 같은 과목인가 — 소비자용 한 줄 판정.
 * 반환 3치: true = 같다(정규화 동일 또는 같은 사전 항목) / false = 사전이 둘 다 알며
 * **서로 다른 과목이라고 확정** (느슨 폴백을 시도하면 안 된다 — 물Ⅰ/물Ⅱ류 오연결 방지) /
 * null = 사전이 판정 불능(한쪽 이상 미등재) — 전환 1단계에서는 호출자가 느슨 폴백 가능.
 */
export function sameSubjectExact(index: SubjectIndex, a: string, b: string): boolean | null {
  const na = normSubjectName(a);
  const nb = normSubjectName(b);
  if (na === nb) return true;
  const ea = index.byNorm.get(na);
  const eb = index.byNorm.get(nb);
  if (ea && eb) return ea === eb;
  return null;
}

// ── 관문 전용 — 후보 제안·대조 결과 (런타임 판정에 쓰지 말 것) ─────────

export interface SubjectCandidate {
  name: string;
  shortName: string;
  /** history = 과거 사람 확정 기록(1순위) / suggest = 느슨 매칭 후보 제안 */
  via: "history" | "suggest";
}

export interface SubjectResolutionItem {
  rawName: string; // 배정표 표기 (fromSimulStatus면 이동수업 현황 표기)
  status: "exact" | "suggested" | "new";
  /** exact일 때 — 확인 불요, 표시만 */
  resolved?: { name: string; shortName: string };
  candidates: SubjectCandidate[];
  /** new일 때 신규 등록 약칭 기본값 (확정 이력 → 앞 2글자 순) */
  suggestedShortName?: string;
  /** 배정표 행이 아니라 이동수업 현황 문서에서만 나온 표기 — 기존 "이동수업 현황 과목 연결"
   *  드롭다운을 관문으로 흡수하는 다리 (spec §6). UI는 출처를 문구로 구분해 준다. */
  fromSimulStatus?: boolean;
}

/**
 * 관문 후보 제안 — 이력 1순위 → subjectMatches(약칭 부분열) → subjectStemLoose(줄기).
 * 2026-08-16~17의 느슨 매칭 규칙들은 여기로 강등·재사용된다 (스펙 §0·§5).
 */
export function suggestCandidates(
  raw: string,
  subjects: SubjectNameEntry[],
  history: SubjectNameHistoryEntry[]
): SubjectCandidate[] {
  const seen = new Set<SubjectNameEntry>();
  const out: SubjectCandidate[] = [];
  const byName = new Map<string, SubjectNameEntry>();
  for (const e of subjects) byName.set(normSubjectName(e.name), e);
  const push = (e: SubjectNameEntry, via: SubjectCandidate["via"]) => {
    if (seen.has(e)) return;
    seen.add(e);
    out.push({ name: e.name, shortName: e.shortName, via });
  };
  const nraw = normSubjectName(raw);
  for (const h of history) {
    if (normSubjectName(h.alias) !== nraw) continue;
    const e = byName.get(normSubjectName(h.canonicalName));
    if (e) push(e, "history");
  }
  for (const e of subjects) {
    if (entrySpellings(e).some((sp) => subjectMatches(sp, raw))) push(e, "suggest");
  }
  for (const e of subjects) {
    if (entrySpellings(e).some((sp) => subjectStemLoose(sp, raw))) push(e, "suggest");
  }
  return out;
}

/** 신규 등록 약칭 기본값 — 확정 이력의 같은 표기 기록 → 앞 2글자 순 */
export function defaultShortNameFor(raw: string, history: SubjectNameHistoryEntry[]): string {
  const nraw = normSubjectName(raw);
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.shortName && (normSubjectName(h.canonicalName) === nraw || normSubjectName(h.alias) === nraw))
      return h.shortName;
  }
  return raw.replace(/\s+/g, "").slice(0, 2);
}

/** 관문 대조 — 배정표 과목 표기 전체를 사전·이력과 대조해 확정 목록 재료를 만든다 (스펙 §3-1) */
export function resolveSubjectsForGate(
  rawNames: string[],
  subjects: SubjectNameEntry[],
  history: SubjectNameHistoryEntry[]
): SubjectResolutionItem[] {
  const index = buildSubjectIndex(subjects);
  const distinct = [...new Set(rawNames.map((n) => n.trim()).filter(Boolean))];
  return distinct.map((rawName) => {
    const hit = resolveExact(index, rawName);
    if (hit) {
      return {
        rawName,
        status: "exact" as const,
        resolved: { name: hit.name, shortName: hit.shortName },
        candidates: [],
      };
    }
    const candidates = suggestCandidates(rawName, subjects, history);
    if (candidates.length) return { rawName, status: "suggested" as const, candidates };
    return {
      rawName,
      status: "new" as const,
      candidates: [],
      suggestedShortName: defaultShortNameFor(rawName, history),
    };
  });
}

/**
 * 신학기 도태 — 승계 사전에서 이번 학기가 실제로 쓰는 항목만 남긴다 (2026-08-17 사용자 원칙:
 * "작년 기준 관성을 줄이고 올해 받은 리소스만으로"). 쓰임 = 행 이름이 정확 해석되는 항목
 * + 확정(link)이 가리키는 항목. 안 쓰는 승계 항목(작년 분반 표기 등)이 새 등록의 표기
 * 자리를 선점해 충돌내는 것을 막는다 — 실사고: 「논술」 create가 승계 논술A/B의 약칭에 막힘.
 * 그리드가 이미 채택된 학기에는 쓰지 말 것(살아 있는 그리드가 참조하는 항목까지 지운다).
 */
export function pruneSubjectsToReferenced<T extends SubjectNameEntry>(
  subjects: T[],
  rowNames: string[],
  confirmations: SubjectConfirmation[]
): T[] {
  const index = buildSubjectIndex(subjects);
  const keep = new Set<SubjectNameEntry>();
  for (const n of rowNames) {
    const hit = resolveExact(index, n);
    if (hit) keep.add(hit);
  }
  const byName = new Map(subjects.map((e) => [normSubjectName(e.name), e] as const));
  for (const c of confirmations) {
    if (c.action !== "link") continue;
    const t = byName.get(normSubjectName((c.canonicalName || "").trim()));
    if (t) keep.add(t);
  }
  return subjects.filter((e) => keep.has(e));
}

// ── 관문 확정 반영 (저장 시점, 스펙 §3-2) ─────────────────────────

export interface SubjectConfirmation {
  rawName: string;
  action: "link" | "create";
  /** link: 기존 항목 name / create: 새 항목 name(원칙적으로 rawName) */
  canonicalName: string;
  /** create일 때 필수 */
  shortName?: string;
}

/**
 * 확정 목록을 사전에 적용 — 순수 함수. create는 항목 추가, link(raw ≠ canonical)는 별칭 추가.
 * 기존 항목과 표기가 충돌하는 확정은 오류로 모은다(색인이 조용히 애매해지는 것을 막는 저장 관문).
 */
export function applySubjectConfirmations<T extends SubjectNameEntry>(
  subjects: T[],
  confirmations: SubjectConfirmation[],
  makeEntry: (name: string, shortName: string) => T
): { subjects: T[]; errors: string[] } {
  const out = subjects.map((e) => ({ ...e, aliases: [...(e.aliases || [])] }) as T);
  const errors: string[] = [];
  const owner = new Map<string, T>();
  for (const e of out) for (const sp of entrySpellings(e)) owner.set(normSubjectName(sp), e);
  const byName = new Map(out.map((e) => [normSubjectName(e.name), e] as const));
  for (const c of confirmations) {
    const raw = (c.rawName || "").trim();
    const canonical = (c.canonicalName || "").trim();
    if (!raw || !canonical) {
      errors.push(`확정 항목에 이름이 비었습니다 (rawName="${c.rawName}").`);
      continue;
    }
    if (c.action === "create") {
      const key = normSubjectName(canonical);
      // 정식명이 정규화(공백 무시)로 같은 항목이 이미 있으면 오류가 아니라 그 항목의 다른
      // 표기다 — 배정표 「인공지능 기초」와 이동수업 현황 「인공지능기초」가 같은 저장에서
      // 둘 다 새 등록으로 와 자기끼리 충돌한 실사고 (2026-08-17). 추측이 아니라 정규화
      // 동일성이므로 자동 합류가 안전하다. 약칭·별칭 자리와 겹치는 경우만 오류 유지.
      const nameTwin = byName.get(key);
      if (nameTwin) {
        const rawKey = normSubjectName(raw);
        if (!entrySpellings(nameTwin).some((sp) => normSubjectName(sp) === rawKey)) {
          nameTwin.aliases = [...(nameTwin.aliases || []), raw];
          owner.set(rawKey, nameTwin);
        }
        continue;
      }
      if (owner.has(key)) {
        errors.push(`「${canonical}」은 이미 등록된 과목 표기와 겹칩니다 — 기존 과목에 연결해 주세요.`);
        continue;
      }
      const short = (c.shortName || "").trim();
      if (!short) {
        errors.push(`새 과목 「${canonical}」의 약칭이 비었습니다.`);
        continue;
      }
      const shortOwner = owner.get(normSubjectName(short));
      const entry = makeEntry(canonical, short);
      entry.aliases = [];
      out.push(entry);
      byName.set(key, entry);
      owner.set(key, entry);
      // 약칭 겹침은 오류가 아니다(앞 2글자 관행상 흔함) — 색인이 ambiguous로 빼서 정확
      // 일치에 안 쓰일 뿐. 다만 완전히 같은 항목 표기를 또 만드는 것만 위에서 막았다.
      if (!shortOwner) owner.set(normSubjectName(short), entry);
    } else {
      const target = byName.get(normSubjectName(canonical));
      if (!target) {
        errors.push(`「${raw}」을 연결할 과목 「${canonical}」이 사전에 없습니다.`);
        continue;
      }
      const rawKey = normSubjectName(raw);
      const rawOwner = owner.get(rawKey);
      if (rawOwner && rawOwner !== target) {
        errors.push(
          `「${raw}」은 이미 「${rawOwner.name}」의 표기로 등록돼 있어 「${canonical}」에 연결할 수 없습니다.`
        );
        continue;
      }
      if (!rawOwner && !entrySpellings(target).some((sp) => normSubjectName(sp) === rawKey)) {
        target.aliases = [...(target.aliases || []), raw];
        owner.set(rawKey, target);
      }
    }
  }
  return { subjects: out, errors };
}
