/**
 * Phase 9c-F: NEIS 일괄 내보내기 — 매핑 등록부 sanitize + 사전 검증 리포트 (순수 함수)
 *
 * 상위 스펙: docs/phase9c_f_spec.md §2·§3
 *
 * 빈칸 3원인(매뉴얼 §10) 예방이 목적: ① 과목명 NEIS 미등록 ② 교사명 미등록 ③ 담당 미등록.
 * 플랫폼은 NEIS를 조회할 수 없으므로 판정은 이원화한다 —
 *   차단(B1) = 플랫폼이 아는 것(과목 NEIS명 매핑 유무),
 *   체크리스트(W2·W3) = NEIS 쪽 등록 상태(일과계 자가 확인 표식 대조).
 * Firestore 무의존 — 검사기(validateTimetable)와 같은 계열의 순수 관문.
 */

import {
  ClassGrid,
  NeisMapRegistry,
  NeisPrecheckPairIssue,
  NeisPrecheckReport,
  NeisPrecheckSubjectIssue,
  NeisPrecheckTeacherIssue,
  NeisSubjectMapping,
} from "./types";
import { normSubject, teacherKeyOf } from "./validate";

// ── 등록부 기본값·sanitize (spec §2) ──────────────────────────

export function emptyNeisMapRegistry(): NeisMapRegistry {
  return { subjects: [], confirmedTeachers: [], confirmedPairs: [] };
}

const MAX_NAME_LEN = 60;
const MAX_SUBJECTS = 300;
const MAX_TEACHERS = 500;
const MAX_PAIRS = 5000;

/**
 * neis_map_save 본문 검증·정리 — 전체 교체 페이로드.
 * 형태 위반은 오류(400 사유)로 반환하고, 통과분은 trim·중복 제거해 돌려준다.
 */
export function sanitizeNeisMapPayload(input: unknown): {
  registry?: NeisMapRegistry;
  error?: string;
} {
  if (!input || typeof input !== "object") {
    return { error: "등록부 본문(neisMap)이 없습니다." };
  }
  const raw = input as Partial<NeisMapRegistry>;

  const rawSubjects = Array.isArray(raw.subjects) ? raw.subjects : [];
  if (rawSubjects.length > MAX_SUBJECTS) {
    return { error: `과목 매핑은 최대 ${MAX_SUBJECTS}건까지 저장할 수 있습니다.` };
  }
  const seen = new Set<string>();
  const subjects: NeisSubjectMapping[] = [];
  for (const row of rawSubjects) {
    if (!row || typeof row !== "object") {
      return { error: "과목 매핑 항목 형식이 올바르지 않습니다." };
    }
    const platformName = String((row as NeisSubjectMapping).platformName ?? "").trim();
    const neisName = String((row as NeisSubjectMapping).neisName ?? "").trim();
    if (!platformName) continue; // 빈 행은 조용히 버림 (UI 편집 잔재)
    if (platformName.length > MAX_NAME_LEN || neisName.length > MAX_NAME_LEN) {
      return { error: `과목명은 ${MAX_NAME_LEN}자를 넘을 수 없습니다.` };
    }
    const key = normSubject(platformName);
    if (seen.has(key)) continue; // 중복 과목명은 첫 항목만
    seen.add(key);
    subjects.push({ platformName, neisName });
  }

  const cleanList = (
    value: unknown,
    max: number,
    label: string
  ): { list?: string[]; error?: string } => {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length > max) return { error: `${label}은(는) 최대 ${max}건까지 저장할 수 있습니다.` };
    const out = new Set<string>();
    for (const item of arr) {
      if (typeof item !== "string") return { error: `${label} 항목 형식이 올바르지 않습니다.` };
      const v = item.trim().toLowerCase();
      if (!v) continue;
      if (v.length > MAX_NAME_LEN * 2 + 1) return { error: `${label} 항목이 너무 깁니다.` };
      out.add(v);
    }
    return { list: Array.from(out) };
  };

  const teachers = cleanList(raw.confirmedTeachers, MAX_TEACHERS, "교원 확인 목록");
  if (teachers.error) return { error: teachers.error };
  const pairs = cleanList(raw.confirmedPairs, MAX_PAIRS, "담당 확인 목록");
  if (pairs.error) return { error: pairs.error };
  // pair key 형식 검증 — 서버 산출 "teacherKey|정규화 과목명"만 수용 (클라 조립 금지 관례의 방어선)
  for (const p of pairs.list!) {
    if (!p.includes("|")) return { error: "담당 확인 목록에 형식이 올바르지 않은 항목이 있습니다." };
  }

  return {
    registry: {
      subjects,
      confirmedTeachers: teachers.list!,
      confirmedPairs: pairs.list!,
    },
  };
}

// ── 사전 검증 리포트 (spec §3) ────────────────────────────────

/** 담당 확인 pair key — 등록부 confirmedPairs 저장 규약 (서버 산출 값을 클라가 그대로 반송) */
export function neisPairKey(teacherKey: string, subjectName: string): string {
  return `${teacherKey}|${normSubject(subjectName)}`;
}

export function buildNeisPrecheckReport(
  grids: ClassGrid[],
  registry: NeisMapRegistry
): NeisPrecheckReport {
  // 매핑 색인 — 정규화 과목명 → NEIS명(확정만)
  const mapped = new Map<string, string>();
  for (const row of registry.subjects || []) {
    const neisName = (row.neisName || "").trim();
    if (neisName) mapped.set(normSubject(row.platformName), neisName);
  }
  const confirmedTeachers = new Set(
    (registry.confirmedTeachers || []).map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
  const confirmedPairs = new Set(
    (registry.confirmedPairs || []).map((p) => p.trim().toLowerCase()).filter(Boolean)
  );

  // 그리드 집계
  const subjectAgg = new Map<
    string,
    { platformName: string; lessonCount: number; classes: Set<string> }
  >();
  const virtualAgg = new Map<string, { teacherName: string; lessonCount: number }>();
  const teacherAgg = new Map<string, { teacherName: string; lessonCount: number }>();
  const pairAgg = new Map<
    string,
    { teacherKey: string; teacherName: string; platformName: string; classes: Set<string> }
  >();
  let lessons = 0;

  for (const grid of grids || []) {
    const classKey = `${grid.grade}-${grid.classNum}`;
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        lessons++;
        const subjName = (lesson.subjectName || "").trim();
        const subjKey = normSubject(subjName);
        if (subjKey) {
          const agg = subjectAgg.get(subjKey) || {
            platformName: subjName,
            lessonCount: 0,
            classes: new Set<string>(),
          };
          agg.lessonCount++;
          agg.classes.add(classKey);
          subjectAgg.set(subjKey, agg);
        }

        for (const t of lesson.teachers || []) {
          const tk = teacherKeyOf(t);
          if (!tk) continue;
          if (tk.startsWith("name:")) {
            // 가상 교사 (창체·SLAT) — NEIS 표현 미정 (F-2 열린 질문)
            const v = virtualAgg.get(tk) || { teacherName: t.name || "", lessonCount: 0 };
            v.lessonCount++;
            virtualAgg.set(tk, v);
            continue;
          }
          const ta = teacherAgg.get(tk) || { teacherName: t.name || "", lessonCount: 0 };
          ta.lessonCount++;
          teacherAgg.set(tk, ta);
          if (subjKey) {
            const pk = neisPairKey(tk, subjName);
            const pa =
              pairAgg.get(pk) ||
              ({
                teacherKey: tk,
                teacherName: t.name || "",
                platformName: subjName,
                classes: new Set<string>(),
              } as { teacherKey: string; teacherName: string; platformName: string; classes: Set<string> });
            pa.classes.add(classKey);
            pairAgg.set(pk, pa);
          }
        }
      }
    }
  }

  // B1 — NEIS명 미확정 과목 (차단)
  const unmappedSubjects: NeisPrecheckSubjectIssue[] = [];
  for (const [key, agg] of subjectAgg) {
    if (mapped.has(key)) continue;
    unmappedSubjects.push({
      platformName: agg.platformName,
      lessonCount: agg.lessonCount,
      classCount: agg.classes.size,
      text: `${agg.platformName} — 나이스 등재명이 아직 입력되지 않았습니다 (${agg.classes.size}개 반 · 주 ${agg.lessonCount}시간 사용)`,
    });
  }
  unmappedSubjects.sort((a, b) => b.lessonCount - a.lessonCount);

  // W1 — 가상 교사 수업
  const virtualLessons: NeisPrecheckTeacherIssue[] = Array.from(virtualAgg.entries())
    .map(([tk, v]) => ({
      teacherKey: tk,
      teacherName: v.teacherName,
      lessonCount: v.lessonCount,
      text: `${v.teacherName} — 계정 없는 이름의 수업 주 ${v.lessonCount}시간. 나이스 파일에서의 처리 방식은 샘플 확보 후 확정됩니다`,
    }))
    .sort((a, b) => b.lessonCount - a.lessonCount);

  // W2 — 교원 등재 미확인
  const unconfirmedTeachers: NeisPrecheckTeacherIssue[] = Array.from(teacherAgg.entries())
    .filter(([tk]) => !confirmedTeachers.has(tk))
    .map(([tk, v]) => ({
      teacherKey: tk,
      teacherName: v.teacherName,
      lessonCount: v.lessonCount,
      text: `${v.teacherName} — 나이스 교원 등재 여부가 아직 확인되지 않았습니다 (주 ${v.lessonCount}시간)`,
    }))
    .sort((a, b) => b.lessonCount - a.lessonCount);

  // W3 — 담당 등록 미확인 (교사×과목)
  const unconfirmedPairs: NeisPrecheckPairIssue[] = Array.from(pairAgg.entries())
    .filter(([pk]) => !confirmedPairs.has(pk))
    .map(([pk, v]) => {
      const neisName = mapped.get(normSubject(v.platformName));
      return {
        key: pk,
        teacherKey: v.teacherKey,
        teacherName: v.teacherName,
        platformName: v.platformName,
        ...(neisName ? { neisName } : {}),
        classCount: v.classes.size,
        text: `${v.teacherName} · ${v.platformName}${neisName && neisName !== v.platformName ? ` (나이스명: ${neisName})` : ""} — 담당 등록 확인이 필요합니다 (${v.classes.size}개 반)`,
      };
    })
    .sort(
      (a, b) => a.teacherName.localeCompare(b.teacherName, "ko") || b.classCount - a.classCount
    );

  return {
    readyForExport: unmappedSubjects.length === 0,
    blockers: { unmappedSubjects },
    warnings: { virtualLessons, unconfirmedTeachers, unconfirmedPairs },
    summary: {
      classes: (grids || []).length,
      lessons,
      subjects: subjectAgg.size,
      mappedSubjects: subjectAgg.size - unmappedSubjects.length,
      teachers: teacherAgg.size,
      confirmedTeachers: teacherAgg.size - unconfirmedTeachers.length,
      pairs: pairAgg.size,
      confirmedPairs: pairAgg.size - unconfirmedPairs.length,
    },
  };
}
