/**
 * Phase 6b: 생활지도 권한 판정 엔진 (순수 함수 — Firestore 의존 없음)
 *
 * 판정 순서 (phase6_spec.md — 서버 사이드 전용):
 *   0. 학생 역할 → 무조건 거부 (2026-07-24 403 회귀의 교훈: 가드에서 학생 통과 여부 최우선 점검)
 *   1. 수퍼어드민 → 전체 권한
 *   2. grant에 해당 scope·right 있으면 허용 (만료 grant 제외)
 *   3. 담임 기본권: 자기 반이면 view + record
 *   4. 열람 기본값: visibility 설정 적용 (예: 담임의 타반 열람 허용)
 *   5. 그 외 거부
 */

import {
  ALL_DISCIPLINE_RIGHTS,
  DisciplineGrant,
  DisciplineRight,
  DisciplineScope,
  DisciplineVisibility,
  HomeroomClass,
} from "./types";

export interface ScopeTarget {
  grade: number;
  classNum?: number; // 없으면 "학년 전체" 범위 요청
}

export interface DisciplineAuthzContext {
  role: "student" | "teacher" | "super_admin";
  email: string;
  /** 본인에게 부여된 grant만 (도메인 필터·teacherEmail 필터 완료 상태) */
  grants: DisciplineGrant[];
  /** 담임 배정표에서 찾은 본인 담임 반 목록 */
  homeroomClasses: HomeroomClass[];
  visibility: DisciplineVisibility;
  nowMs: number;
}

export interface DisciplineJudgment {
  allowed: boolean;
  /** 허용 근거 — 감사 로그·디버깅용 ("super_admin" | "grant:<id>" | "homeroom" | "visibility" | "denied:<이유>") */
  basis: string;
}

function isValidRight(r: unknown): r is DisciplineRight {
  return typeof r === "string" && (ALL_DISCIPLINE_RIGHTS as string[]).includes(r);
}

/** grant의 scope가 요청 대상 범위를 포괄하는가 */
export function scopeCovers(scope: DisciplineScope, target?: ScopeTarget): boolean {
  if (!scope || typeof scope !== "object") return false;
  // 대상 미지정 = 범위와 무관한 전역 권한 검사(manage_rules 등) — scope 종류와 무관하게 통과
  if (!target) return true;
  switch (scope.type) {
    case "all":
      return true;
    case "grade":
      return scope.grade === target.grade;
    case "class":
      // 반 단위 grant는 "학년 전체" 요청(classNum 미지정)을 포괄하지 못한다
      return (
        target.classNum !== undefined &&
        scope.grade === target.grade &&
        scope.classNum === target.classNum
      );
    default:
      return false;
  }
}

/**
 * 권한 판정 본체.
 *
 * @param target view/record/resolve처럼 학생 범위가 있는 권한은 반드시 target을 넘긴다.
 *               manage_rules/manage_permissions처럼 도메인 전역 권한만 target 생략.
 */
export function judgeDiscipline(
  ctx: DisciplineAuthzContext,
  right: DisciplineRight,
  target?: ScopeTarget
): DisciplineJudgment {
  if (!isValidRight(right)) return { allowed: false, basis: "denied:invalid_right" };

  // 0. 학생 전면 차단
  if (ctx.role === "student") return { allowed: false, basis: "denied:student_role" };

  // 1. 수퍼어드민
  if (ctx.role === "super_admin") return { allowed: true, basis: "super_admin" };

  // 2. 개별 grant
  for (const g of ctx.grants) {
    if (g.teacherEmail !== ctx.email) continue; // 방어적 재확인 (로더가 이미 필터)
    if (g.expiresAt !== null && g.expiresAt !== undefined && g.expiresAt <= ctx.nowMs) continue;
    if (!Array.isArray(g.rights) || !g.rights.includes(right)) continue;
    if (!scopeCovers(g.scope, target)) continue;
    return { allowed: true, basis: `grant:${g.id}` };
  }

  // 3. 담임 기본권 — 자기 반에 한해 view + record
  if ((right === "view" || right === "record") && target && target.classNum !== undefined) {
    const isOwnClass = ctx.homeroomClasses.some(
      (h) => h.grade === target.grade && h.classNum === target.classNum
    );
    if (isOwnClass) return { allowed: true, basis: "homeroom" };
  }

  // 4. 열람 기본값 — 담임이 한 반이라도 있고, 타반 열람이 설정으로 허용된 경우 (열람만)
  if (
    right === "view" &&
    ctx.homeroomClasses.length > 0 &&
    ctx.visibility?.homeroomCanViewOtherClasses === true
  ) {
    return { allowed: true, basis: "visibility" };
  }

  // 5. 거부
  return { allowed: false, basis: "denied:no_matching_rule" };
}

/** 학년별 접근 가능 범위: 학년 전체("all") 또는 허용된 반 번호 목록 */
export interface GradeAccessTarget {
  grade: number;
  classNums: number[] | "all";
}

/**
 * 목록 조회용 접근 범위 산출 — "요청 범위 중 허용된 부분만" 자동 축소.
 *
 * 학년 전체 판정이 거부돼도, 담임 반·반 단위 grant로 접근 가능한 반이 있으면
 * 그 반들만 목록에 포함시킨다 (담임이 "전체" 조회 시 자기 반만 반환되는 근거).
 * 후보 반은 ctx의 담임 배정 + class scope grant에서만 나오므로 전수 탐색이 없다.
 */
export function computeAccessTargets(
  ctx: DisciplineAuthzContext,
  right: DisciplineRight,
  grades: number[],
  classNum?: number
): GradeAccessTarget[] {
  const out: GradeAccessTarget[] = [];
  for (const grade of grades) {
    // 반이 특정된 요청은 그 반만 판정
    if (classNum !== undefined) {
      if (judgeDiscipline(ctx, right, { grade, classNum }).allowed) {
        out.push({ grade, classNums: [classNum] });
      }
      continue;
    }
    // 학년 전체 허용 여부
    if (judgeDiscipline(ctx, right, { grade }).allowed) {
      out.push({ grade, classNums: "all" });
      continue;
    }
    // 반 단위 후보 수집 → 개별 재판정 (만료·rights 검사는 judge가 수행)
    const candidates = new Set<number>();
    for (const h of ctx.homeroomClasses) {
      if (h.grade === grade) candidates.add(h.classNum);
    }
    for (const g of ctx.grants) {
      if (g.scope && g.scope.type === "class" && g.scope.grade === grade) {
        candidates.add(g.scope.classNum);
      }
    }
    const allowed = Array.from(candidates)
      .filter((c) => judgeDiscipline(ctx, right, { grade, classNum: c }).allowed)
      .sort((a, b) => a - b);
    if (allowed.length > 0) out.push({ grade, classNums: allowed });
  }
  return out;
}

/** 담임 배정표 맵("1-1": email)에서 특정 교사의 담임 반 목록을 추출 */
export function findHomeroomClasses(
  assignments: Record<string, string> | undefined | null,
  teacherEmail: string
): HomeroomClass[] {
  if (!assignments) return [];
  const out: HomeroomClass[] = [];
  const email = teacherEmail.toLowerCase();
  for (const [key, value] of Object.entries(assignments)) {
    if (typeof value !== "string" || value.toLowerCase() !== email) continue;
    const m = key.match(/^(\d)-(\d{1,2})$/);
    if (!m) continue;
    out.push({ grade: parseInt(m[1], 10), classNum: parseInt(m[2], 10) });
  }
  return out;
}
