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
  NeisCsvBundle,
  NeisCsvFile,
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

        // 가상 교사만 있는 수업(창체·SLAT)은 **나이스 파일에 아예 나가지 않는다** —
        // 2026-08-14 일과계 회신 5-2 + 실물 대조로 확정(해당 칸이 빈 문자열).
        // 따라서 이 과목들은 "NEIS 등재명 미확정"이 아니라 **내보내기 대상이 아니다.**
        // B1(미확정 차단)에 걸리면 창체·SLAT 때문에 내보내기가 영원히 막힌다.
        // 교사 쪽은 이미 virtualAgg로 분리하고 있었으나(아래) 과목 쪽에 같은 분리가 없었다.
        // 근거: docs/phase9c_questionnaire_result_2026-08-14.md §4-1
        const teachersOf = lesson.teachers || [];
        const allVirtual =
          teachersOf.length > 0 && teachersOf.every((t) => teacherKeyOf(t).startsWith("name:"));

        if (subjKey && !allVirtual) {
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
      // 2026-08-14 확정 — 샘플 파일 회수로 F-2 열린 질문이 닫혔다.
      // 창체·SLAT는 나이스 파일에서 그 칸이 통째로 빈 문자열로 나간다(과목·교사 모두 빠짐).
      // 질의 5-2 답변 + 1학년 1반 실물 35칸 대조로 교차 확인.
      // 미정 사항이 아니라 정상 동작이므로 문구를 "확정 대기"에서 "이렇게 나갑니다"로 바꾼다.
      text: `${v.teacherName} — 계정 없는 이름의 수업 주 ${v.lessonCount}시간. 나이스 파일에는 이 칸이 빈칸으로 나갑니다(정상)`,
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

// ── 기초시간표 CSV 내보내기 (phase9c_f_spec — 2026-08-14 실물 회수로 형식 확정) ──
//
// 컴시간이 나이스 업로드용으로 뽑아 주던 파일을 그대로 재현한다. 형식은 추측이 아니라
// **실물 1건(1학년 1반)을 바이트 단위로 분석해 확정**했다:
//   · UTF-8 + BOM(EF BB BF) — 없으면 나이스·엑셀에서 한글이 깨진다
//   · 줄바꿈 CRLF, **마지막 줄에 개행 없음**
//   · 헤더 `,월,화,수,목,금,토,일` — 따옴표 없음
//   · 데이터 행 `교시,"과목(교사)",…` — 교시 번호만 따옴표 없고 나머지 셀은 항상 따옴표
//   · 9교시까지 행이 있고, 토·일 열은 존재하되 값이 없다
//   · 창체·SLAT처럼 담당 교사가 없는 수업은 **칸이 통째로 빈 문자열**(질의 5-2 + 실물 대조)
//
// 열 개수: 원본은 1~7교시 행이 7열, 8~9교시 행이 8열로 **들쭉날쭉하다**(후행 빈 칸 잘림).
// 그대로 흉내 내지 않고 **전 행 8열로 통일**한다 — 원본 자체가 내부적으로 불일치하는데도
// 나이스가 받아들였다는 것이 곧 "후행 빈 칸을 따지지 않는다"는 증거이고, 8열은 그 상위집합이다.
// (이 판단이 틀렸다면 나이스가 거부할 것이고, 그때 원본의 불일치까지 복제하면 된다.)

export interface NeisCsvResult {
  csv: string;
  /** 나이스 등재명이 없어 플랫폼 이름을 그대로 쓴 과목 — 정상 경로면 비어 있어야 한다(B1이 먼저 막는다) */
  unmapped: string[];
  /** 교사가 둘 이상인 수업 — 나이스 표기 규약이 미확정이라 첫 번째만 썼다 (질의 5-3 미회수) */
  multiTeacher: string[];
}

const NEIS_DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const NEIS_PERIODS = 9;

/**
 * 한 학급의 기초시간표를 나이스 업로드용 CSV 문자열로 만든다. 순수 함수 — Firestore 무의존.
 *
 * @param grid       대상 학급 그리드
 * @param neisNameOf 플랫폼 과목명 → 나이스 등재명. 없으면 null (호출부가 B1로 이미 막았어야 한다)
 */
export function buildNeisTimetableCsv(
  grid: ClassGrid,
  neisNameOf: (platformSubject: string) => string | null
): NeisCsvResult {
  const unmapped = new Set<string>();
  const multiTeacher = new Set<string>();

  // (day, period) → 칸 문자열
  const cellText = new Map<string, string>();
  for (const cell of grid.cells || []) {
    for (const lesson of cell.lessons || []) {
      const real = (lesson.teachers || []).filter((t) => (t.email || "").trim());
      // 담당 교사가 없는 수업(창체·SLAT)은 나이스 파일에 나가지 않는다 — 칸을 비운다
      if (real.length === 0) continue;
      if (real.length > 1) multiTeacher.add(`${lesson.subjectName}(${real.map((t) => t.name).join("·")})`);

      const platform = (lesson.subjectName || "").trim();
      const mapped = neisNameOf(platform);
      if (!mapped) unmapped.add(platform);
      const subject = mapped || platform;
      cellText.set(`${cell.day}-${cell.period}`, `${subject}(${real[0].name || ""})`);
    }
  }

  const lines: string[] = [`,${NEIS_DAYS.join(",")}`];
  for (let p = 1; p <= NEIS_PERIODS; p++) {
    const cells = NEIS_DAYS.map((_, i) => {
      const day = i + 1; // 월=1 … 일=7. 토·일(6·7)은 그리드에 없으므로 자연히 빈칸
      return `"${cellText.get(`${day}-${p}`) || ""}"`;
    });
    lines.push(`${p},${cells.join(",")}`);
  }

  // BOM + CRLF + 마지막 줄 개행 없음 — 원본과 동일
  return {
    csv: "﻿" + lines.join("\r\n"),
    unmapped: [...unmapped].sort(),
    multiTeacher: [...multiTeacher].sort(),
  };
}

// ── 학급별 CSV 일괄 생성 (phase9c_f_spec F-2 배선, 2026-08-18) ──
//
// 변환기(`buildNeisTimetableCsv`)는 2026-08-14에 실물 대조까지 끝났는데 **호출부가 없어
// 화면 버튼이 "준비 중"으로 잠겨 있었다.** 잠금 사유였던 "나이스 양식 확보"는 같은 날
// 해소됐고(deferred_backlog_2026-08-14 §A7), 이 함수가 그 마지막 배선이다.
//
// 컴시간 완전 대체의 네 축(①생성 ②검증 ③수동조정 ④나이스 내보내기) 중 ④가 여기서 닫힌다.


/**
 * 전 학급 CSV를 한 번에 만든다.
 *
 * ⚠️ **B1(나이스명 미확정 과목)이 남아 있으면 호출하지 말 것.** 그 상태로 내보내면
 * 플랫폼 과목명이 그대로 파일에 박혀 나이스가 거부하거나, 더 나쁘게는 **틀린 과목으로
 * 등재된다.** 호출부(서버 액션)가 precheck의 `readyForExport`로 먼저 막는다.
 */
export function buildNeisCsvBundle(grids: ClassGrid[], registry: NeisMapRegistry): NeisCsvBundle {
  const mapped = new Map<string, string>();
  for (const row of registry.subjects || []) {
    const neisName = (row.neisName || "").trim();
    if (neisName) mapped.set(normSubject(row.platformName), neisName);
  }
  const neisNameOf = (platformSubject: string) => mapped.get(normSubject(platformSubject)) || null;

  const unmappedAll = new Set<string>();
  const multiTeacherAll = new Set<string>();
  const files: NeisCsvFile[] = [];

  for (const grid of grids || []) {
    const r = buildNeisTimetableCsv(grid, neisNameOf);
    r.unmapped.forEach((u) => unmappedAll.add(u));
    r.multiTeacher.forEach((m) => multiTeacherAll.add(m));
    files.push({
      label: `${grid.grade}-${grid.classNum}`,
      grade: grid.grade,
      classNum: grid.classNum,
      csv: r.csv,
      unmapped: r.unmapped,
      multiTeacher: r.multiTeacher,
    });
  }

  files.sort((a, b) => a.grade - b.grade || a.classNum - b.classNum);
  return {
    files,
    unmappedAll: [...unmappedAll].sort((a, b) => a.localeCompare(b, "ko")),
    multiTeacherAll: [...multiTeacherAll].sort((a, b) => a.localeCompare(b, "ko")),
  };
}
