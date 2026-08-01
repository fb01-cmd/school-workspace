/**
 * Phase 9a: 시간표 권한 판정 엔진 (순수 함수 — Firestore 의존 없음)
 * 
 * 상위 스펙: phase9a_spec.md §1
 */

import { ManageAction, ViewAction } from "./types";

export interface TimetableAuthzContext {
  role: "student" | "teacher" | "super_admin";
  email: string;
  managerEmails: string[];
  observerEmails?: string[]; // 열람 전용 참관자 (교무부장 등) — phase9b_spec §5
  studentClass?: { grade: number; classNum: number };
}

export interface TimetableAuthzResult {
  allowed: boolean;
  basis: string;
}

/**
 * 시간표 관리 (manage) 권한 판정.
 * 
 * 규칙:
 *   1. 학생 -> 전면 차단
 *   2. super_admin -> 모든 관리 기능 허용
 *   3. set_managers -> super_admin 전용 (일반 관리자 차단)
 *   4. 일과계 관리자 (managerEmails 포함) -> import, 학기 활성화/삭제 등 관리 허용
 *   5. 일반 교사 -> get_settings 읽기만 허용, 나머지 관리 기능 차단
 */
export function canManageTimetable(
  ctx: TimetableAuthzContext,
  action: ManageAction
): TimetableAuthzResult {
  const normEmail = ctx.email.toLowerCase();
  const isManager = ctx.managerEmails.some((m) => m.toLowerCase() === normEmail);

  // 1. 학생 차단
  if (ctx.role === "student") {
    return { allowed: false, basis: "denied:student_role" };
  }

  // 2. 수퍼어드민
  if (ctx.role === "super_admin") {
    return { allowed: true, basis: "super_admin" };
  }

  // 3. 관리자 지정 및 참관자 지정 (super_admin 전용)
  if (action === "set_managers" || action === "set_observers") {
    return { allowed: false, basis: "denied:super_admin_only" };
  }

  // 4. 일과계 관리자
  if (isManager) {
    return { allowed: true, basis: "manager" };
  }

  // 5. 열람 전용 참관자 (교무부장 등): 요청대장·주 목록 읽기만 (phase9b_spec §5)
  const isObserver = (ctx.observerEmails || []).some((o) => o.toLowerCase() === normEmail);
  if (isObserver && (action === "request_list" || action === "week_list")) {
    return { allowed: true, basis: "observer_read" };
  }

  // 6. 일반 교사: 설정 조회만 허용
  if (action === "get_settings") {
    return { allowed: true, basis: "teacher_read_settings" };
  }

  return { allowed: false, basis: "denied:not_manager" };
}

/**
 * 시간표 열람 (view) 권한 판정.
 * 
 * 규칙:
 *   1. 교사 / super_admin -> 전체 뷰 (my, teacher, class, school, free) 허용
 *   2. 학생 -> 'class' 액션 중 자기 반(studentClass)만 허용. 다른 액션 및 다른 반은 차단.
 */
export function canViewTimetable(
  ctx: TimetableAuthzContext,
  action: ViewAction,
  targetClass?: { grade: number; classNum: number }
): TimetableAuthzResult {
  // 교사 및 수퍼어드민은 모든 뷰 접근 허용
  if (ctx.role === "teacher" || ctx.role === "super_admin") {
    return { allowed: true, basis: ctx.role };
  }

  // 학생 처리
  if (ctx.role === "student") {
    if (action !== "class") {
      return { allowed: false, basis: "denied:student_action_restricted" };
    }
    if (!ctx.studentClass || !targetClass) {
      return { allowed: false, basis: "denied:no_student_class" };
    }
    if (
      ctx.studentClass.grade === targetClass.grade &&
      ctx.studentClass.classNum === targetClass.classNum
    ) {
      return { allowed: true, basis: "student_own_class" };
    }
    return { allowed: false, basis: "denied:student_other_class" };
  }

  return { allowed: false, basis: "denied:unknown_role" };
}
