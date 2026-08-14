/**
 * Phase 9a: 시간표 백엔드 서비스 & Firestore DB 로더 (admin SDK 전용)
 * 
 * 상위 스펙: phase9a_spec.md §2, §3, §4
 */

import { adminDb, DecodedAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { bumpTimetableCacheVersion } from "./cacheVersion";
import { applySimulMarks } from "./simul";
import { applyVenueMarks } from "./venue";
import { checkPlaceholderOp, deriveGradeDayPeriods, deriveHoursFromGrids, hardViolationKey, validateTimetable } from "./validate";
import { validateCohortInput } from "./cohort";
import { SOFT_CODE_LABELS } from "./labels";
import { applyRevisionOps, cloneClassGrids } from "./utils";
export { applyRevisionOps, cloneClassGrids };
import { buildNeisPrecheckReport, emptyNeisMapRegistry } from "./neis";
import {
  ClassCellIssue,
  ClassGrid,
  NeisMapRegistry,
  NeisPrecheckReport,
  NeisPrecheckTarget,
  FreeTeacher,
  IntermediateClassGrid,
  IntermediateImportPayload,
  SimulGroup,
  VenueGroup,
  TeacherSlotBan,
  ConsecutiveRule,
  CoTeachingRule,
  SwapDraft,
  SuspiciousMappingIssue,
  TeacherOverlapIssue,
  TeacherTimeCount,
  TeacherTimetable,
  TeacherTimetableCell,
  TimeCountMismatchIssue,
  TimetableLesson,
  TimetableSettings,
  TimetableSubject,
  TimetableTeacher,
  TimetableTerm,
  TimetableValidationReport,
  TimetableWeekDay,
  UnmatchedTeacherIssue,
  SCHEDULE_AFFECTING_TYPES,
  CurriculumCohort,
  HoursPlan,
  HoursPlanRow,
  HoursPlanSummary,
} from "./types";

// ── Firestore 경로 헬퍼 ────────────────────────────────────────

export const swapDraftsColRef = (domain: string) =>
  adminDb.collection("swap_drafts").doc(domain).collection("drafts");

export const timetableSettingsDocRef = (domain: string) =>
  adminDb.collection("timetable_settings").doc(domain);

export const timetableTermsColRef = (domain: string) =>
  adminDb.collection("timetable_terms").doc(domain).collection("terms");

export const classGridsColRef = (domain: string, termId: string) =>
  adminDb
    .collection("timetable_terms")
    .doc(domain)
    .collection("terms")
    .doc(termId)
    .collection("classGrids");

export const simulGroupsColRef = (domain: string) =>
  adminDb.collection("timetable_simul_groups").doc(domain).collection("groups");

export const venueGroupsColRef = (domain: string) =>
  adminDb.collection("timetable_venue_groups").doc(domain).collection("groups");

export const teacherSlotBansColRef = (domain: string) =>
  adminDb.collection("timetable_slot_bans").doc(domain).collection("rules");

export const consecutiveRulesColRef = (domain: string) =>
  adminDb.collection("timetable_consecutive_rules").doc(domain).collection("rules");

export const coTeachingRulesColRef = (domain: string) =>
  adminDb.collection("timetable_coteaching_rules").doc(domain).collection("rules");

export const hoursPlansColRef = (domain: string) =>
  adminDb.collection("timetable_hours_plans").doc(domain).collection("plans");

export const curriculumCohortsColRef = (domain: string) =>
  adminDb.collection("timetable_curriculum_cohorts").doc(domain).collection("cohorts");

// ── 직렬화 헬퍼 ────────────────────────────────────────────────

export function toMillis(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof (v as any)?.toMillis === "function") return (v as any).toMillis();
  return null;
}

// ── 설정 (Settings) CRUD ────────────────────────────────────────

export async function loadTimetableSettings(domain: string): Promise<TimetableSettings> {
  const snap = await timetableSettingsDocRef(domain).get();
  if (!snap.exists) {
    return {
      managerEmails: [],
      activeTermId: null,
      days: 5,
      periodsPerDay: 7,
      lunchAfterPeriod: 4,
      observerEmails: [],
      teacherOpen: false,
      teacherPilotEmails: [],
      publishWeeksAhead: 2,
      lastNeisSyncAt: undefined,
      icsToken: undefined,
      icsStaffToken: undefined,
    };
  }
  const data = snap.data() || {};
  return {
    managerEmails: Array.isArray(data.managerEmails)
      ? data.managerEmails.map((e) => String(e).trim().toLowerCase())
      : [],
    activeTermId: data.activeTermId || null,
    days: Number(data.days) || 5,
    periodsPerDay: Number(data.periodsPerDay) || 7,
    lunchAfterPeriod: Number(data.lunchAfterPeriod) || 4,
    observerEmails: Array.isArray(data.observerEmails)
      ? data.observerEmails.map((e) => String(e).trim().toLowerCase())
      : [],
    teacherOpen: !!data.teacherOpen,
    teacherPilotEmails: Array.isArray(data.teacherPilotEmails)
      ? data.teacherPilotEmails.map((e) => String(e).trim().toLowerCase())
      : [],
    publishWeeksAhead: Number.isFinite(Number(data.publishWeeksAhead))
      ? Math.max(0, Math.min(8, Number(data.publishWeeksAhead)))
      : 2,
    lastNeisSyncAt: typeof data.lastNeisSyncAt === "number" ? data.lastNeisSyncAt : undefined,
    icsToken: typeof data.icsToken === "string" && data.icsToken.trim() ? data.icsToken : undefined,
    icsStaffToken: typeof data.icsStaffToken === "string" && data.icsStaffToken.trim() ? data.icsStaffToken : undefined,
  };
}

export async function saveTimetableSettings(
  domain: string,
  settings: Partial<TimetableSettings>
): Promise<TimetableSettings> {
  const current = await loadTimetableSettings(domain);
  const updated: TimetableSettings = {
    ...current,
    ...settings,
    managerEmails: Array.isArray(settings.managerEmails)
      ? settings.managerEmails.map((e) => String(e).trim().toLowerCase())
      : current.managerEmails,
  };
  await timetableSettingsDocRef(domain).set(updated, { merge: true });
  await bumpTimetableCacheVersion(domain);
  return updated;
}

// ── 학기 (Term) CRUD & 생명주기 ─────────────────────────────────

export async function loadTimetableTerm(
  domain: string,
  termId: string
): Promise<TimetableTerm | null> {
  const snap = await timetableTermsColRef(domain).doc(termId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id: snap.id,
    name: data.name || snap.id,
    status: data.status || "draft",
    subjects: Array.isArray(data.subjects) ? data.subjects : [],
    importedAt: toMillis(data.importedAt) || 0,
    importedBy: data.importedBy || "",
    activatedAt: toMillis(data.activatedAt),
    sourceNote: data.sourceNote || "",
  };
}

export async function loadAllTerms(domain: string): Promise<TimetableTerm[]> {
  const snap = await timetableTermsColRef(domain).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      name: data.name || doc.id,
      status: data.status || "draft",
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
      importedAt: toMillis(data.importedAt) || 0,
      importedBy: data.importedBy || "",
      activatedAt: toMillis(data.activatedAt),
      sourceNote: data.sourceNote || "",
    };
  });
}

export async function loadActiveTerm(domain: string): Promise<TimetableTerm | null> {
  const settings = await loadTimetableSettings(domain);
  if (settings.activeTermId) {
    const term = await loadTimetableTerm(domain, settings.activeTermId);
    if (term) return term;
  }
  // fallback: status === "active" 문서를 무작위 검색
  const snap = await timetableTermsColRef(domain).where("status", "==", "active").limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() || {};
  return {
    id: doc.id,
    name: data.name || doc.id,
    status: "active",
    subjects: Array.isArray(data.subjects) ? data.subjects : [],
    importedAt: toMillis(data.importedAt) || 0,
    importedBy: data.importedBy || "",
    activatedAt: toMillis(data.activatedAt),
    sourceNote: data.sourceNote || "",
  };
}

// ── 동시수업(분반) 그룹 등록부 (pre_opening_3features_spec §A) ──

export async function loadSimulGroups(domain: string, termId: string): Promise<SimulGroup[]> {
  const snap = await simulGroupsColRef(domain).where("termId", "==", termId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      termId: data.termId || termId,
      label: data.label || "",
      grade: Number(data.grade) || 0,
      classNums: Array.isArray(data.classNums) ? data.classNums.map(Number).filter(Boolean) : [],
      subjectNames: Array.isArray(data.subjectNames) ? data.subjectNames.map(String) : [],
      ...(Array.isArray(data.slots) && data.slots.length
        ? { slots: data.slots.map((s: any) => ({ day: Number(s.day), period: Number(s.period) })) }
        : {}),
      active: data.active !== false,
      createdBy: data.createdBy || "",
      createdAt: toMillis(data.createdAt) || 0,
      ...(data.updatedBy ? { updatedBy: data.updatedBy } : {}),
      ...(toMillis(data.updatedAt) ? { updatedAt: toMillis(data.updatedAt)! } : {}),
    };
  });
}

export function validateSimulGroupPayload(raw: any): { ok: true; group: Omit<SimulGroup, "id" | "createdBy" | "createdAt"> } | { ok: false; error: string } {
  const label = typeof raw?.label === "string" ? raw.label.trim().slice(0, 60) : "";
  if (!label) return { ok: false, error: "그룹 이름을 입력해 주세요." };
  const termId = typeof raw?.termId === "string" ? raw.termId.trim() : "";
  if (!termId) return { ok: false, error: "학기가 지정되지 않았습니다." };
  const grade = Number(raw?.grade);
  if (![1, 2, 3].includes(grade)) return { ok: false, error: "학년은 1~3 중에서 지정해야 합니다." };
  const classNums: number[] = Array.isArray(raw?.classNums)
    ? [...new Set<number>(raw.classNums.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 15)
    : [];
  if (classNums.length < 2)
    return { ok: false, error: "묶인 반을 2개 이상 지정해야 합니다 (이동수업은 여러 반이 함께 듣는 수업입니다)." };
  const subjectNames = Array.isArray(raw?.subjectNames)
    ? [...new Set(raw.subjectNames.map((s: any) => String(s).trim()).filter(Boolean))]
    : [];
  if (subjectNames.length === 0) return { ok: false, error: "대상 과목을 1개 이상 지정해야 합니다." };
  let slots: { day: number; period: number }[] | undefined;
  if (Array.isArray(raw?.slots) && raw.slots.length) {
    slots = [];
    for (const s of raw.slots) {
      const day = Number(s?.day);
      const period = Number(s?.period);
      if (!Number.isInteger(day) || day < 1 || day > 5 || !Number.isInteger(period) || period < 1 || period > 8)
        return { ok: false, error: "교시 제한 값이 올바르지 않습니다." };
      slots.push({ day, period });
    }
  }
  return {
    ok: true,
    group: {
      termId,
      label,
      grade,
      classNums: (classNums as number[]).sort((a, b) => a - b),
      subjectNames: subjectNames as string[],
      ...(slots ? { slots } : {}),
      active: raw?.active !== false,
    },
  };
}

// ── 특별실 배정 등록부 (pre_opening_3features_spec §F) ─────────

export async function loadVenueGroups(domain: string, termId: string): Promise<VenueGroup[]> {
  const snap = await venueGroupsColRef(domain).where("termId", "==", termId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      termId: data.termId || termId,
      roomName: data.roomName || "",
      label: data.label || "",
      grade: Number(data.grade) || 0,
      classNums: Array.isArray(data.classNums) ? data.classNums.map(Number).filter(Boolean) : [],
      subjectNames: Array.isArray(data.subjectNames) ? data.subjectNames.map(String) : [],
      ...(Array.isArray(data.slots) && data.slots.length
        ? { slots: data.slots.map((s: any) => ({ day: Number(s.day), period: Number(s.period) })) }
        : {}),
      active: data.active !== false,
      createdBy: data.createdBy || "",
      createdAt: toMillis(data.createdAt) || 0,
      ...(data.updatedBy ? { updatedBy: data.updatedBy } : {}),
      ...(toMillis(data.updatedAt) ? { updatedAt: toMillis(data.updatedAt)! } : {}),
    };
  });
}

export function validateVenueGroupPayload(raw: any): { ok: true; group: Omit<VenueGroup, "id" | "createdBy" | "createdAt"> } | { ok: false; error: string } {
  const roomName = typeof raw?.roomName === "string" ? raw.roomName.trim().slice(0, 30) : "";
  if (!roomName) return { ok: false, error: "특별실 이름을 입력해 주세요." };
  const label = typeof raw?.label === "string" ? raw.label.trim().slice(0, 60) : "";
  if (!label) return { ok: false, error: "배정 이름을 입력해 주세요." };
  const termId = typeof raw?.termId === "string" ? raw.termId.trim() : "";
  if (!termId) return { ok: false, error: "학기가 지정되지 않았습니다." };
  const grade = Number(raw?.grade);
  if (![1, 2, 3].includes(grade)) return { ok: false, error: "학년은 1~3 중에서 지정해야 합니다." };
  const classNums: number[] = Array.isArray(raw?.classNums)
    ? [...new Set<number>(raw.classNums.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 15)
    : [];
  // 동시수업과 달리 반 1개 허용 — 한 반 수업도 특별실을 점유한다 (예: 2-9 지구, 3-6 지Ⅱ).
  if (classNums.length < 1) return { ok: false, error: "대상 반을 1개 이상 지정해야 합니다." };
  const subjectNames = Array.isArray(raw?.subjectNames)
    ? [...new Set(raw.subjectNames.map((s: any) => String(s).trim()).filter(Boolean))]
    : [];
  if (subjectNames.length === 0) return { ok: false, error: "대상 과목을 1개 이상 지정해야 합니다." };
  let slots: { day: number; period: number }[] | undefined;
  if (Array.isArray(raw?.slots) && raw.slots.length) {
    slots = [];
    for (const s of raw.slots) {
      const day = Number(s?.day);
      const period = Number(s?.period);
      if (!Number.isInteger(day) || day < 1 || day > 5 || !Number.isInteger(period) || period < 1 || period > 8)
        return { ok: false, error: "교시 제한 값이 올바르지 않습니다." };
      slots.push({ day, period });
    }
  }
  return {
    ok: true,
    group: {
      termId,
      roomName,
      label,
      grade,
      classNums: (classNums as number[]).sort((a, b) => a - b),
      subjectNames: subjectNames as string[],
      ...(slots ? { slots } : {}),
      active: raw?.active !== false,
    },
  };
}

// ── 특별교사 금지 등록부 (phase9c_spec §2-3·매뉴얼 §6-가) ──────

export async function loadTeacherSlotBans(domain: string, termId: string): Promise<TeacherSlotBan[]> {
  const snap = await teacherSlotBansColRef(domain).where("termId", "==", termId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      termId: data.termId || termId,
      teacherEmail: data.teacherEmail || "",
      teacherName: data.teacherName || "",
      kind: data.kind === "move" ? "move" : "assign",
      slots: Array.isArray(data.slots)
        ? data.slots.map((s: any) => ({ day: Number(s.day), period: Number(s.period) }))
        : [],
      note: data.note || "",
      active: data.active !== false,
      createdBy: data.createdBy || "",
      createdAt: toMillis(data.createdAt) || 0,
      ...(data.updatedBy ? { updatedBy: data.updatedBy } : {}),
      ...(toMillis(data.updatedAt) ? { updatedAt: toMillis(data.updatedAt)! } : {}),
    };
  });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTeacherSlotBanPayload(raw: any): { ok: true; rule: Omit<TeacherSlotBan, "id" | "createdBy" | "createdAt"> } | { ok: false; error: string } {
  const termId = typeof raw?.termId === "string" ? raw.termId.trim() : "";
  if (!termId) return { ok: false, error: "학기가 지정되지 않았습니다." };
  const teacherEmail = typeof raw?.teacherEmail === "string" ? raw.teacherEmail.trim().toLowerCase() : "";
  if (!teacherEmail || !EMAIL_REGEX.test(teacherEmail)) {
    return { ok: false, error: "올바른 교사 이메일 형식이 아닙니다 (예: name@domain.com)." };
  }
  const teacherName = typeof raw?.teacherName === "string" ? raw.teacherName.trim() : undefined;
  const kind = raw?.kind === "move" ? "move" : "assign";
  if (!Array.isArray(raw?.slots) || raw.slots.length === 0) {
    return { ok: false, error: "금지 교시를 최소 1개 이상 지정해 주세요." };
  }
  const slots: { day: number; period: number }[] = [];
  for (const s of raw.slots) {
    const day = Number(s?.day);
    const period = Number(s?.period);
    if (!Number.isInteger(day) || day < 1 || day > 5 || !Number.isInteger(period) || period < 1 || period > 8) {
      return { ok: false, error: "교시 값이 올바르지 않습니다 (월~금, 1~8교시)." };
    }
    slots.push({ day, period });
  }
  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 100) : undefined;

  return {
    ok: true,
    rule: {
      termId,
      teacherEmail,
      ...(teacherName ? { teacherName } : {}),
      kind,
      slots,
      ...(note ? { note } : {}),
      active: raw?.active !== false,
    },
  };
}

// ── 연속수업 등록부 (phase9c_spec §2-3·매뉴얼 §6-라) ──────────

export async function loadConsecutiveRules(domain: string, termId: string): Promise<ConsecutiveRule[]> {
  const snap = await consecutiveRulesColRef(domain).where("termId", "==", termId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      termId: data.termId || termId,
      grade: Number(data.grade) || 0,
      classNums: Array.isArray(data.classNums) ? data.classNums.map(Number).filter(Boolean) : [],
      subjectName: data.subjectName || "",
      ...(data.teacherEmail ? { teacherEmail: data.teacherEmail } : {}),
      pattern: data.pattern || "2",
      active: data.active !== false,
      createdBy: data.createdBy || "",
      createdAt: toMillis(data.createdAt) || 0,
      ...(data.updatedBy ? { updatedBy: data.updatedBy } : {}),
      ...(toMillis(data.updatedAt) ? { updatedAt: toMillis(data.updatedAt)! } : {}),
    };
  });
}

export function validateConsecutiveRulePayload(raw: any): { ok: true; rule: Omit<ConsecutiveRule, "id" | "createdBy" | "createdAt"> } | { ok: false; error: string } {
  const termId = typeof raw?.termId === "string" ? raw.termId.trim() : "";
  if (!termId) return { ok: false, error: "학기가 지정되지 않았습니다." };
  const grade = Number(raw?.grade);
  if (![1, 2, 3].includes(grade)) return { ok: false, error: "학년은 1~3 중에서 지정해야 합니다." };
  const classNums: number[] = Array.isArray(raw?.classNums)
    ? [...new Set<number>(raw.classNums.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 15)
    : [];
  if (classNums.length < 1) return { ok: false, error: "대상 반을 1개 이상 지정해야 합니다." };
  const subjectName = typeof raw?.subjectName === "string" ? raw.subjectName.trim() : "";
  if (!subjectName) return { ok: false, error: "대상 과목명을 입력해 주세요." };
  const pattern = typeof raw?.pattern === "string" ? raw.pattern.trim() : "";
  if (!pattern) return { ok: false, error: "연속패턴(예: 2, 2,2, 3)을 입력해 주세요." };
  if (!/^\d+(\s*,\s*\d+)*$/.test(pattern)) {
    return { ok: false, error: "연속패턴은 '2' 또는 '2,2'와 같이 숫자와 쉼표로만 작성해야 합니다." };
  }
  const blockNums = pattern.split(",").map((s: string) => Number(s.trim())).filter((n: number) => !isNaN(n));
  if (!blockNums.some((n: number) => n >= 2)) {
    return { ok: false, error: "연속 블록 길이(2 이상)가 1개 이상 포함되어야 합니다." };
  }

  const teacherEmail = typeof raw?.teacherEmail === "string" && raw.teacherEmail.trim()
    ? raw.teacherEmail.trim().toLowerCase()
    : undefined;
  if (teacherEmail && !EMAIL_REGEX.test(teacherEmail)) {
    return { ok: false, error: "올바른 교사 이메일 형식이 아닙니다 (예: name@domain.com)." };
  }

  return {
    ok: true,
    rule: {
      termId,
      grade,
      classNums: classNums.sort((a, b) => a - b),
      subjectName,
      ...(teacherEmail ? { teacherEmail } : {}),
      pattern,
      active: raw?.active !== false,
    },
  };
}

// ── 복수교사 등록부 (phase9c_spec §2-3·매뉴얼 §6-사) ──────────

export async function loadCoTeachingRules(domain: string, termId: string): Promise<CoTeachingRule[]> {
  const snap = await coTeachingRulesColRef(domain).where("termId", "==", termId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      termId: data.termId || termId,
      grade: Number(data.grade) || 0,
      classNums: Array.isArray(data.classNums) ? data.classNums.map(Number).filter(Boolean) : [],
      subjectName: data.subjectName || "",
      teacherEmails: Array.isArray(data.teacherEmails) ? data.teacherEmails.map(String) : [],
      active: data.active !== false,
      createdBy: data.createdBy || "",
      createdAt: toMillis(data.createdAt) || 0,
      ...(data.updatedBy ? { updatedBy: data.updatedBy } : {}),
      ...(toMillis(data.updatedAt) ? { updatedAt: toMillis(data.updatedAt)! } : {}),
    };
  });
}

export function validateCoTeachingRulePayload(raw: any): { ok: true; rule: Omit<CoTeachingRule, "id" | "createdBy" | "createdAt"> } | { ok: false; error: string } {
  const termId = typeof raw?.termId === "string" ? raw.termId.trim() : "";
  if (!termId) return { ok: false, error: "학기가 지정되지 않았습니다." };
  const grade = Number(raw?.grade);
  if (![1, 2, 3].includes(grade)) return { ok: false, error: "학년은 1~3 중에서 지정해야 합니다." };
  const classNums: number[] = Array.isArray(raw?.classNums)
    ? [...new Set<number>(raw.classNums.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= 15)
    : [];
  if (classNums.length < 1) return { ok: false, error: "대상 반을 1개 이상 지정해야 합니다." };
  const subjectName = typeof raw?.subjectName === "string" ? raw.subjectName.trim() : "";
  if (!subjectName) return { ok: false, error: "대상 과목명을 입력해 주세요." };
  const teacherEmails: string[] = Array.isArray(raw?.teacherEmails)
    ? [...new Set<string>(raw.teacherEmails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (teacherEmails.length < 2) return { ok: false, error: "복수 교사는 2명 이상 등록해야 합니다." };
  for (const email of teacherEmails) {
    if (!EMAIL_REGEX.test(email)) {
      return { ok: false, error: `올바르지 않은 교사 이메일 형식입니다: ${email}` };
    }
  }

  return {
    ok: true,
    rule: {
      termId,
      grade,
      classNums: classNums.sort((a, b) => a - b),
      subjectName,
      teacherEmails,
      active: raw?.active !== false,
    },
  };
}

// ── 학급 시간표 그리드 (ClassGrid) Operations ─────────────────

export async function loadAllClassGrids(domain: string, termId: string): Promise<ClassGrid[]> {
  const [snap, simulGroups, venueGroups] = await Promise.all([
    classGridsColRef(domain, termId).get(),
    loadSimulGroups(domain, termId),
    loadVenueGroups(domain, termId),
  ]);
  const grids = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      grade: Number(data.grade) || 0,
      classNum: Number(data.classNum) || 0,
      cells: Array.isArray(data.cells) ? data.cells : [],
    };
  });
  // 동시수업(분반) 라벨 + 특별실명 스탬프 — 저장 데이터는 무표기, 읽기 시점에 등록부 대조
  // (§A·§F 판정 단일 통로). 이후의 합성·엔진·커밋 재검증·view 응답이 전부 이 마크를 본다.
  applySimulMarks(grids, simulGroups);
  applyVenueMarks(grids, venueGroups);
  return grids;
}

export async function loadClassGrid(
  domain: string,
  termId: string,
  grade: number,
  classNum: number
): Promise<ClassGrid | null> {
  const docId = `${grade}-${classNum}`;
  const [snap, simulGroups, venueGroups] = await Promise.all([
    classGridsColRef(domain, termId).doc(docId).get(),
    loadSimulGroups(domain, termId),
    loadVenueGroups(domain, termId),
  ]);
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const grid = {
    grade: Number(data.grade) || grade,
    classNum: Number(data.classNum) || classNum,
    cells: Array.isArray(data.cells) ? data.cells : [],
  };
  applySimulMarks([grid], simulGroups);
  applyVenueMarks([grid], venueGroups);
  return grid;
}

export async function saveAllClassGrids(
  domain: string,
  termId: string,
  grids: ClassGrid[]
): Promise<void> {
  const colRef = classGridsColRef(domain, termId);
  // Firestore batch Write limit (500) 이하인 400개 단위로 저장
  for (let i = 0; i < grids.length; i += 400) {
    const batch = adminDb.batch();
    for (const grid of grids.slice(i, i + 400)) {
      const docId = `${grid.grade}-${grid.classNum}`;
      batch.set(colRef.doc(docId), grid);
    }
    await batch.commit();
  }
  await bumpTimetableCacheVersion(domain);
}

// ── 가져오기 중간 형식 -> ClassGrid & TimetableSubject 변환 ────

export function convertIntermediateToClassGrids(payload: IntermediateImportPayload): {
  classGrids: ClassGrid[];
  subjects: TimetableSubject[];
  maxPeriodsPerDay: number;
} {
  const teacherEmailMap = payload.teacherEmailMap || {};
  const virtualNames = new Set(
    (payload.virtualTeacherNames || []).map((n) => n.trim()).filter(Boolean)
  );
  const gridMap = new Map<string, ClassGrid>(); // "grade-classNum" -> ClassGrid
  const subjectMap = new Map<string, { shortName: string; teacherEmails: Set<string> }>();
  let maxPeriodsPerDay = 7;

  for (const rawGrid of payload.rawClassGrids || []) {
    const key = `${rawGrid.grade}-${rawGrid.classNum}`;
    const cellMap = new Map<string, TimetableLesson[]>(); // "day-period" -> TimetableLesson[]

    for (const rawCell of rawGrid.cells || []) {
      if (rawCell.period > maxPeriodsPerDay) {
        maxPeriodsPerDay = rawCell.period;
      }
      const cellKey = `${rawCell.day}-${rawCell.period}`;
      // 가상 교사(SLAT·창체 등)는 계정이 실수로 매핑돼 있어도 이메일 없이 저장 —
      // 엔진의 가상 교사 판정(이메일 없음 = 하드 제외)과 정합 유지
      const teacherEmail = virtualNames.has(rawCell.teacherName?.trim())
        ? ""
        : (teacherEmailMap[rawCell.teacherName] || "").trim().toLowerCase();
      const teacherObj: TimetableTeacher = {
        email: teacherEmail,
        name: rawCell.teacherName,
      };

      const subjName = rawCell.subjectName.trim();
      const subjShort = rawCell.subjectShort?.trim() || subjName.slice(0, 2);

      // 과목 매핑 집계
      if (!subjectMap.has(subjName)) {
        subjectMap.set(subjName, { shortName: subjShort, teacherEmails: new Set() });
      }
      if (teacherEmail) {
        subjectMap.get(subjName)!.teacherEmails.add(teacherEmail);
      }

      const existingLessons = cellMap.get(cellKey) || [];
      // 동일 요일·교시에 같은 과목명/coTeachingKey인 레슨이 있으면 교사만 추가
      const existingLesson = existingLessons.find(
        (l) => l.subjectName === subjName && (rawCell.room ? l.room === rawCell.room : true)
      );

      if (existingLesson) {
        if (!existingLesson.teachers.some((t) => t.name === rawCell.teacherName)) {
          existingLesson.teachers.push(teacherObj);
        }
      } else {
        existingLessons.push({
          subjectName: subjName,
          subjectShort: subjShort,
          teachers: [teacherObj],
          // Firestore는 undefined 값을 거부하므로 교실 정보가 있을 때만 속성을 포함
          ...(rawCell.room ? { room: rawCell.room } : {}),
        });
      }
      cellMap.set(cellKey, existingLessons);
    }

    const cells = Array.from(cellMap.entries()).map(([cKey, lessons]) => {
      const [dayStr, periodStr] = cKey.split("-");
      return {
        day: Number(dayStr),
        period: Number(periodStr),
        lessons,
      };
    });

    gridMap.set(key, {
      grade: rawGrid.grade,
      classNum: rawGrid.classNum,
      cells,
    });
  }

  const classGrids = Array.from(gridMap.values()).sort(
    (a, b) => a.grade - b.grade || a.classNum - b.classNum
  );

  const subjects: TimetableSubject[] = Array.from(subjectMap.entries()).map(([name, info]) => ({
    name,
    shortName: info.shortName,
    teacherEmails: Array.from(info.teacherEmails),
  }));

  return { classGrids, subjects, maxPeriodsPerDay };
}

// ── 가져오기 검증 파서 (import_validate) ───────────────────────

export function validateTimetableImport(
  payload: IntermediateImportPayload
): TimetableValidationReport {
  const teacherEmailMap = payload.teacherEmailMap || {};
  const virtualNames = new Set(
    (payload.virtualTeacherNames || []).map((n) => n.trim()).filter(Boolean)
  );
  const unmatchedTeachersSet = new Map<string, number>();

  // 1. 미매칭 교사 체크 — 가상 교사(SLAT·창체 등)로 지정된 이름은 계정 없이 허용
  for (const rawGrid of payload.rawClassGrids || []) {
    for (const cell of rawGrid.cells || []) {
      const tName = cell.teacherName?.trim();
      if (!tName) continue;
      if (virtualNames.has(tName)) continue;
      const email = teacherEmailMap[tName];
      if (!email) {
        unmatchedTeachersSet.set(tName, (unmatchedTeachersSet.get(tName) || 0) + 1);
      }
    }
  }

  // 1-b. 의심 매핑 체크 (저장 차단) — 2026-08-02 오매핑 사고 재발 방지 서버측 이중 방어
  //   학번형(^\d+@) 계정은 이 학교의 학생 계정 규칙: 동명이인 학생 오매핑의 실제 사고 패턴
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const suspiciousMappings: SuspiciousMappingIssue[] = [];
  for (const [teacherName, rawEmail] of Object.entries(teacherEmailMap)) {
    const email = (rawEmail || "").trim().toLowerCase();
    if (virtualNames.has(teacherName.trim())) {
      if (email)
        suspiciousMappings.push({
          teacherName,
          email,
          reason: "가상 교사로 지정됐는데 계정도 매핑됨 — 둘 중 하나만 선택",
        });
      continue;
    }
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      suspiciousMappings.push({ teacherName, email, reason: "이메일 형식이 아님 (검색어 원문 의심)" });
    } else if (/^\d+@/.test(email)) {
      suspiciousMappings.push({ teacherName, email, reason: "학번형 계정 — 동명이인 학생 오매핑 의심" });
    }
  }

  const unmatchedTeachers: UnmatchedTeacherIssue[] = Array.from(
    unmatchedTeachersSet.entries()
  ).map(([teacherName, occurrenceCount]) => ({ teacherName, occurrenceCount }));

  // 2. 교사 중복 수업 검사 (Teacher Overlap)
  // Key를 객체 배열로 관리하여 하이픈 포함 교사명 깨짐 방지
  interface SlotKey {
    teacherName: string;
    day: number;
    period: number;
  }
  interface SlotEntry {
    grade: number;
    classNum: number;
    subjectName: string;
    coTeachingKey?: string;
  }

  const teacherSlots: { key: SlotKey; entries: SlotEntry[] }[] = [];

  for (const rawGrid of payload.rawClassGrids || []) {
    for (const cell of rawGrid.cells || []) {
      const tName = cell.teacherName?.trim();
      if (!tName) continue;

      let slot = teacherSlots.find(
        (s) =>
          s.key.teacherName === tName &&
          s.key.day === cell.day &&
          s.key.period === cell.period
      );
      if (!slot) {
        slot = { key: { teacherName: tName, day: cell.day, period: cell.period }, entries: [] };
        teacherSlots.push(slot);
      }
      slot.entries.push({
        grade: rawGrid.grade,
        classNum: rawGrid.classNum,
        subjectName: cell.subjectName,
        coTeachingKey: cell.coTeachingKey?.trim(),
      });
    }
  }

  const overlaps: TeacherOverlapIssue[] = [];
  for (const slot of teacherSlots) {
    if (slot.entries.length > 1) {
      // 반(grade-classNum) 단위 고유 엔트리 추출
      const uniqueClasses = slot.entries.filter(
        (c, idx, self) =>
          self.findIndex((s) => s.grade === c.grade && s.classNum === c.classNum) === idx
      );

      if (uniqueClasses.length > 1) {
        // 🔴 수정 2: 모든 엔트리가 동일한 non-empty coTeachingKey를 갖고 있다면 의도된 이동/동시수업이므로 오버랩에서 제외
        const firstKey = uniqueClasses[0].coTeachingKey;
        const isCoTeachingGroup =
          Boolean(firstKey) && uniqueClasses.every((c) => c.coTeachingKey === firstKey);

        if (!isCoTeachingGroup) {
          overlaps.push({
            teacherName: slot.key.teacherName,
            teacherEmail: teacherEmailMap[slot.key.teacherName],
            day: slot.key.day,
            period: slot.key.period,
            classes: uniqueClasses.map((c) => ({
              grade: c.grade,
              classNum: c.classNum,
              subjectName: c.subjectName,
            })),
          });
        }
      }
    }
  }

  // 3. 학급 셀 검사 (Class Cell Issues)
  const cellIssues: ClassCellIssue[] = [];
  let maxPeriodsPerDay = 7;

  for (const rawGrid of payload.rawClassGrids || []) {
    const classLabel = `${rawGrid.grade}학년 ${rawGrid.classNum}반`;
    const totalCells = (rawGrid.cells || []).length;

    // 🔴 3-a. 학급별 수업 수가 없거나 10시간 미만인 경우 (누락 의심)
    if (totalCells === 0) {
      cellIssues.push({
        grade: rawGrid.grade,
        classNum: rawGrid.classNum,
        issue: `${classLabel}: 학급 시간표에 등록된 수업이 0개입니다. (누락 의심)`,
      });
    } else if (totalCells < 10) {
      cellIssues.push({
        grade: rawGrid.grade,
        classNum: rawGrid.classNum,
        issue: `${classLabel}: 주당 수업 수가 ${totalCells}시간으로 극단적으로 적습니다. (누락 의심)`,
      });
    }

    // 🔴 3-b. 동일 학급 같은 요일·교시에 동일 과목 / 교사 중복 등록 검사
    const cellOccurrences = new Map<
      string,
      { day: number; period: number; count: number; subjectName: string; teacherName: string }
    >();

    for (const cell of rawGrid.cells || []) {
      if (cell.period > maxPeriodsPerDay) maxPeriodsPerDay = cell.period;

      const cKey = `${cell.day}-${cell.period}-${cell.subjectName.trim()}-${cell.teacherName.trim()}`;
      const existing = cellOccurrences.get(cKey);
      if (existing) {
        existing.count++;
      } else {
        cellOccurrences.set(cKey, {
          day: cell.day,
          period: cell.period,
          count: 1,
          subjectName: cell.subjectName.trim(),
          teacherName: cell.teacherName.trim(),
        });
      }
    }

    for (const item of cellOccurrences.values()) {
      if (item.count > 1) {
        cellIssues.push({
          grade: rawGrid.grade,
          classNum: rawGrid.classNum,
          issue: `${classLabel}: ${item.day}요일 ${item.period}교시에 동일 과목(${item.subjectName}) / 교사(${item.teacherName}) 중복 데이터 ${item.count}건`,
        });
      }
    }
  }

  // 4. 시수 대조 (Time Count Mismatch)
  const timeMismatches: TimeCountMismatchIssue[] = [];
  if (Array.isArray(payload.teacherTimeCounts) && payload.teacherTimeCounts.length > 0) {
    // grid 계산 시수: key: "teacherName-subjectName" -> total hours
    const actualHoursMap = new Map<string, number>();
    for (const rawGrid of payload.rawClassGrids || []) {
      for (const cell of rawGrid.cells || []) {
        const tName = cell.teacherName?.trim();
        const sName = cell.subjectName?.trim();
        if (!tName || !sName) continue;
        const key = `${tName}-${sName}`;
        actualHoursMap.set(key, (actualHoursMap.get(key) || 0) + 1);
      }
    }

    for (const tc of payload.teacherTimeCounts) {
      const tName = tc.teacherName.trim();
      const sName = tc.subjectName.trim();
      const key = `${tName}-${sName}`;
      const actual = actualHoursMap.get(key) || 0;
      if (actual !== tc.targetHours) {
        timeMismatches.push({
          teacherName: tName,
          teacherEmail: teacherEmailMap[tName],
          subjectName: sName,
          gridHours: actual,
          targetHours: tc.targetHours,
        });
      }
    }
  }

  const totalClasses = (payload.rawClassGrids || []).length;
  const teacherNamesSet = new Set<string>();
  let totalLessons = 0;

  for (const grid of payload.rawClassGrids || []) {
    for (const cell of grid.cells || []) {
      totalLessons++;
      if (cell.teacherName) teacherNamesSet.add(cell.teacherName.trim());
    }
  }

  const canCommit = unmatchedTeachers.length === 0 && suspiciousMappings.length === 0;
  const isValid = canCommit && overlaps.length === 0 && cellIssues.length === 0;

  return {
    isValid,
    canCommit,
    overlaps,
    cellIssues,
    timeMismatches,
    unmatchedTeachers,
    suspiciousMappings,
    summary: {
      totalClasses,
      totalTeachers: teacherNamesSet.size,
      totalLessons,
      maxPeriodsPerDay,
    },
  };
}

// ── 학기 가져오기 커밋 (import_commit) ───────────────────────────

export async function commitTimetableImport(
  domain: string,
  payload: IntermediateImportPayload,
  userEmail: string
): Promise<TimetableTerm> {
  const termId = payload.termId.trim();
  const termName = payload.termName.trim() || termId;

  // 서버측 재검증 (2026-08-02 이중 방어): UI 우회 호출로 미매칭·의심 매핑이 저장되는 것 차단
  const report = validateTimetableImport(payload);
  if (!report.canCommit) {
    const reasons = [
      ...report.unmatchedTeachers.map((u) => `미매칭: ${u.teacherName}`),
      ...report.suspiciousMappings.map((s) => `${s.teacherName}(${s.email}): ${s.reason}`),
    ];
    throw new Error(`저장 조건 미충족 — ${reasons.slice(0, 5).join(" / ")}${reasons.length > 5 ? ` 외 ${reasons.length - 5}건` : ""}`);
  }

  // 🔴 수정 1: 기존 학기 존재 여부 및 status 검사
  const existingTerm = await loadTimetableTerm(domain, termId);
  if (existingTerm && existingTerm.status !== "draft") {
    throw new Error(
      `학기(${termId})는 이미 ${existingTerm.status === "active" ? "활성" : "보관"} 상태입니다. 활성/보관 학기는 덮어쓸 수 없으며, draft 상태이거나 신규 학기 ID만 저장 가능합니다.`
    );
  }

  // 기존 draft 학기를 재저장하는 경우 기존 classGrids 문서를 전체 삭제하여 유령 문서 방지
  if (existingTerm && existingTerm.status === "draft") {
    const oldGridsSnap = await classGridsColRef(domain, termId).get();
    for (let i = 0; i < oldGridsSnap.docs.length; i += 400) {
      const batch = adminDb.batch();
      for (const doc of oldGridsSnap.docs.slice(i, i + 400)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  }

  const { classGrids, subjects, maxPeriodsPerDay } = convertIntermediateToClassGrids(payload);

  const termDoc: TimetableTerm = {
    id: termId,
    name: termName,
    status: "draft",
    subjects,
    importedAt: Date.now(),
    importedBy: userEmail.toLowerCase(),
    sourceNote: payload.sourceNote || "웹 시트 엑셀 붙여넣기 파싱",
  };

  // 1. Term 문서 저장 (draft 상태)
  await timetableTermsColRef(domain).doc(termId).set(termDoc);

  // 2. ClassGrid 문서들 저장
  await saveAllClassGrids(domain, termId, classGrids);

  // 3. 학교 설정 내 periodsPerDay 갱신 (saveTimetableSettings가 캐시 버전도 bump)
  await saveTimetableSettings(domain, { periodsPerDay: maxPeriodsPerDay });

  return termDoc;
}

// ── 학기 활성화 / 삭제 ─────────────────────────────────────────

export async function activateTerm(domain: string, termId: string): Promise<TimetableTerm> {
  const term = await loadTimetableTerm(domain, termId);
  if (!term) throw new Error(`학기(${termId})를 찾을 수 없습니다.`);

  // 기존 active 학기들을 archived로 전환
  const activeSnap = await timetableTermsColRef(domain).where("status", "==", "active").get();
  const batch = adminDb.batch();
  for (const doc of activeSnap.docs) {
    if (doc.id !== termId) {
      batch.update(doc.ref, { status: "archived" });
    }
  }

  // 대상 학기를 active로 전환
  batch.update(timetableTermsColRef(domain).doc(termId), {
    status: "active",
    activatedAt: Date.now(),
  });
  await batch.commit();

  // 설정 문서 activeTermId 갱신 (saveTimetableSettings가 캐시 버전도 bump)
  await saveTimetableSettings(domain, { activeTermId: termId });

  term.status = "active";
  term.activatedAt = Date.now();
  return term;
}

export async function deleteTerm(domain: string, termId: string): Promise<void> {
  const term = await loadTimetableTerm(domain, termId);
  if (!term) throw new Error(`학기(${termId})를 찾을 수 없습니다.`);
  if (term.status === "active") {
    throw new Error("현재 활성화된 학기는 삭제할 수 없습니다. 다른 학기를 먼저 활성화하세요.");
  }

  // 1. 하위 classGrids 컬렉션 삭제
  const gridsSnap = await classGridsColRef(domain, termId).get();
  for (let i = 0; i < gridsSnap.docs.length; i += 400) {
    const batch = adminDb.batch();
    for (const d of gridsSnap.docs.slice(i, i + 400)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  // 2. Term 문서 삭제
  await timetableTermsColRef(domain).doc(termId).delete();
  await bumpTimetableCacheVersion(domain);
}

// ── View 데이터 합성 유틸리티 ──────────────────────────────────

export function synthesizeTeacherTimetable(
  allGrids: ClassGrid[],
  teacherEmail: string
): TeacherTimetableCell[] {
  const normEmail = teacherEmail.trim().toLowerCase();
  const cells: TeacherTimetableCell[] = [];

  for (const grid of allGrids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        const matches = (lesson.teachers || []).some(
          (t) => t.email.trim().toLowerCase() === normEmail
        );
        if (matches) {
          cells.push({
            day: cell.day,
            period: cell.period,
            grade: grid.grade,
            classNum: grid.classNum,
            subjectName: lesson.subjectName,
            subjectShort: lesson.subjectShort,
            room: lesson.room,
            // 주간 합성본이 입력이면 변경 마킹을 그대로 전달 (phase9b_spec §3)
            ...((lesson as any).changed ? { changed: (lesson as any).changed } : {}),
            ...(lesson.simul ? { simul: lesson.simul } : {}),
          });
        }
      }
    }
  }

  cells.sort(
    (a, b) => a.day - b.day || a.period - b.period || a.grade - b.grade || a.classNum - b.classNum
  );
  return cells;
}

export function synthesizeFreeTeachers(
  allGrids: ClassGrid[],
  allTeachers: TimetableTeacher[],
  day: number,
  period: number
): FreeTeacher[] {
  const busyTeacherEmails = new Set<string>();

  for (const grid of allGrids) {
    for (const cell of grid.cells || []) {
      if (cell.day === day && cell.period === period) {
        for (const lesson of cell.lessons || []) {
          for (const teacher of lesson.teachers || []) {
            if (teacher.email) {
              busyTeacherEmails.add(teacher.email.trim().toLowerCase());
            }
          }
        }
      }
    }
  }

  const freeList: FreeTeacher[] = [];
  const addedEmails = new Set<string>();

  for (const teacher of allTeachers) {
    const email = teacher.email.trim().toLowerCase();
    if (!email || busyTeacherEmails.has(email) || addedEmails.has(email)) continue;
    addedEmails.add(email);
    freeList.push({
      email,
      name: teacher.name,
    });
  }

  freeList.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return freeList;
}

// ── 학생 학적 반(grade, classNum) 판별 ─────────────────────────

export async function resolveStudentClass(
  auth: DecodedAuthAccess
): Promise<{ grade: number; classNum: number } | null> {
  const email = auth.email.trim().toLowerCase();
  const parseId = (s: unknown): { grade: number; classNum: number } | null => {
    const m = typeof s === "string" ? s.trim().match(/^(\d)(\d{2})(\d{2})$/) : null;
    if (!m) return null;
    const grade = parseInt(m[1], 10);
    const classNum = parseInt(m[2], 10);
    return grade >= 1 && grade <= 3 && classNum >= 1 ? { grade, classNum } : null;
  };

  // 1. users/{uid} 캐시 — 아래 GWS 조회 결과가 적재되는 곳 (24시간 신선도, 진급 반영용)
  const userRef = auth.uid ? adminDb.collection("users").doc(auth.uid) : null;
  let staleCache: { grade: number; classNum: number } | null = null;
  if (userRef) {
    const snap = await userRef.get();
    if (snap.exists) {
      const data = snap.data() || {};
      const grade = Number(data.grade);
      const classNum = Number(data.classNum);
      if (Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNum) && classNum >= 1) {
        if (Date.now() - (Number(data.studentClassCachedAt) || 0) < 24 * 3600 * 1000) {
          return { grade, classNum };
        }
        staleCache = { grade, classNum };
      }
      if (!staleCache) staleCache = parseId(data.studentId);
    }
  }

  // 2. 학번의 단일 원본 = GWS 계정 성(familyName) 필드, 5자리 학년(1)+반(2)+번호(2)
  //    — 명렬표(Phase 6a, roster.ts parseStudentUser)와 동일 규약.
  //    이메일 아이디는 입학연도+일련번호(예: 24343 = 3학년 일련 343)라 학급 정보가 없다.
  //    (과거 이메일 파싱 폴백이 24343을 "2학년 43반"으로 오독한 결함의 재발 방지 — 파싱 금지)
  try {
    const gu = await getUser(email);
    const parsed = parseId(gu?.name?.familyName);
    if (parsed) {
      if (userRef) {
        // 다음 요청부터 GWS 왕복 없이 캐시로 — 실패해도 열람 흐름은 계속
        userRef
          .set(
            {
              grade: parsed.grade,
              classNum: parsed.classNum,
              studentId: String(gu.name.familyName).trim(),
              studentClassCachedAt: Date.now(),
            },
            { merge: true }
          )
          .catch(() => {});
      }
      return parsed;
    }
  } catch (e: any) {
    console.warn(`[resolveStudentClass] GWS 학번 조회 실패 (${email}):`, e?.message || e);
  }

  // 3. GWS를 못 읽으면 오래된 캐시라도 사용 (학급 정보 오차보다 열람 불가가 더 큰 피해)
  return staleCache;
}

// ═════════════════════════════════════════════════════════════
// Phase 9b: 주 등록 · 변경 로그 · 수업교환 신청 · 승인 트랜잭션
// 상위 스펙: phase9b_spec.md §2, §5, §6
// ═════════════════════════════════════════════════════════════

import { getUser, sendGoogleChat } from "@/lib/google/workspace";
import {
  accumulateWeeklyHours,
  countSubstituteTotals,
  flattenNeisChanges,
  isSlotWithinWeek,
  synthesizeWeeklyGrids,
} from "./weekly";
import {
  buildSlotIndex,
  findCrossSwapCandidates,
  findSubstituteCandidates,
  findSwapCandidates,
  isBlockTeacher,
  resolveSourceLesson,
} from "./swap";
import { holidayNameOf } from "./holidays";
import {
  BaseRevisionOp,
  CalendarEventType,
  ChainSearchChain,
  ChainStepItem,
  CrossSwapLessonRef,
  DirectPendingOverlayItem,
  HourTotalsResult,
  NeisRow,
  ProjectedDayLoad,
  SubstituteCandidate,
  SwapCandidate,
  SwapCandidateSnapshot,
  SwapConsent,
  SwapConsentInput,
  SwapRequest,
  SwapRequestReason,
  SwapRequestType,
  SwapSourceSlot,
  SWAP_REASON_TYPES,
  TimetableBaseRevision,
  TimetableCalendarEvent,
  TimetableChange,
  TimetableWeek,
  WeekRegisterInput,
  WeeklyClassGrid,
  WeeklyLesson,
  WeeklySynthesisResult,
} from "./types";

export const timetableWeeksColRef = (domain: string) =>
  adminDb.collection("timetable_weeks").doc(domain).collection("weeks");

export const timetableChangesColRef = (domain: string) =>
  adminDb.collection("timetable_changes").doc(domain).collection("changes");

export const swapRequestsColRef = (domain: string) =>
  adminDb.collection("swap_requests").doc(domain).collection("requests");

export const timetableCalendarColRef = (domain: string) =>
  adminDb.collection("timetable_calendar").doc(domain).collection("events");

export const baseRevisionsColRef = (domain: string) =>
  adminDb.collection("timetable_base_revisions").doc(domain).collection("revisions");

// ── 주 등록 (weeks CRUD) ──────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysISO(dateStr: string, add: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

function normalizeWeekDays(input: WeekRegisterInput): TimetableWeek["days"] {
  const byDay = new Map<number, { holiday?: boolean; periodsByGrade?: Record<string, number> }>();
  for (const d of input.days || []) {
    const dayNum = Number(d.day);
    if (dayNum >= 1 && dayNum <= 5) byDay.set(dayNum, d);
  }
  const days: TimetableWeek["days"] = [];
  for (let day = 1; day <= 5; day++) {
    const src = byDay.get(day);
    days.push({
      day,
      date: addDaysISO(input.startDate, day - 1),
      holiday: !!src?.holiday,
      ...(src?.periodsByGrade && Object.keys(src.periodsByGrade).length > 0
        ? { periodsByGrade: src.periodsByGrade }
        : {}),
    });
  }
  return days;
}

export async function registerWeek(
  domain: string,
  input: WeekRegisterInput,
  userEmail: string
): Promise<TimetableWeek> {
  const startDate = (input.startDate || "").trim();
  if (!DATE_RE.test(startDate)) throw new Error("startDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (new Date(`${startDate}T00:00:00Z`).getUTCDay() !== 1)
    throw new Error("주 시작일은 월요일이어야 합니다.");
  const term = await loadTimetableTerm(domain, input.termId);
  if (!term) throw new Error(`학기(${input.termId})를 찾을 수 없습니다.`);
  if (term.status === "archived") throw new Error("보관된 학기에는 주를 등록할 수 없습니다.");

  const weekId = startDate;
  const existing = await timetableWeeksColRef(domain).doc(weekId).get();
  if (existing.exists) throw new Error(`이미 등록된 주(${weekId})입니다. week_update를 사용하세요.`);

  const week: TimetableWeek = {
    id: weekId,
    termId: input.termId,
    startDate,
    days: normalizeWeekDays(input),
    dayOverrides: input.dayOverrides || [],
    ...(input.note ? { note: input.note } : {}),
    createdBy: userEmail.toLowerCase(),
    createdAt: Date.now(),
  };
  await timetableWeeksColRef(domain).doc(weekId).set(week);
  await bumpTimetableCacheVersion(domain);
  return week;
}

export async function updateWeek(
  domain: string,
  weekId: string,
  input: Partial<WeekRegisterInput>,
  userEmail: string
): Promise<TimetableWeek> {
  const ref = timetableWeeksColRef(domain).doc(weekId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`등록되지 않은 주(${weekId})입니다.`);
  const current = snap.data() as TimetableWeek;

  let newDays = current.days;
  let dayOverrides = current.dayOverrides;

  if (input.days) {
    newDays = normalizeWeekDays({ termId: current.termId, startDate: current.startDate, days: input.days });
    const events = await loadCalendarEvents(domain, current.termId);
    const derivedInput = deriveWeekInput(current.termId, current.startDate, events);
    const derivedDays = normalizeWeekDays(derivedInput);

    dayOverrides = [];
    for (let day = 1; day <= 5; day++) {
      const curDay = newDays.find((d) => d.day === day);
      const derDay = derivedDays.find((d) => d.day === day);
      const isDiff =
        !curDay ||
        !derDay ||
        curDay.holiday !== derDay.holiday ||
        JSON.stringify(curDay.periodsByGrade || {}) !== JSON.stringify(derDay.periodsByGrade || {});
      if (isDiff) {
        dayOverrides.push(day);
      }
    }
  }

  const updated: TimetableWeek = {
    ...current,
    ...(input.days ? { days: newDays, dayOverrides } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  // note가 빈 문자열이면 필드 제거 (Firestore undefined 금지 원칙과 동일 계열)
  if (!updated.note) delete (updated as any).note;
  await ref.set({ ...updated, updatedBy: userEmail.toLowerCase(), updatedAt: Date.now() });
  await bumpTimetableCacheVersion(domain);
  return updated;
}

export async function loadWeek(domain: string, weekId: string): Promise<TimetableWeek | null> {
  const snap = await timetableWeeksColRef(domain).doc(weekId).get();
  if (!snap.exists) return null;
  return snap.data() as TimetableWeek;
}

export async function listWeeks(domain: string, termId?: string): Promise<TimetableWeek[]> {
  let q: FirebaseFirestore.Query = timetableWeeksColRef(domain);
  if (termId) q = q.where("termId", "==", termId);
  const snap = await q.get();
  return snap.docs
    .map((d) => d.data() as TimetableWeek)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * 주 목록에서 오늘이 속한 주 판별 (순수 함수) — 캐시된 주 목록에도 쓰이므로
 * "현재"의 기준(오늘 날짜)은 호출 시점에 계산한다 (weekly_synthesis_cache_spec §3-2).
 */
export function pickCurrentWeek(weeks: TimetableWeek[]): TimetableWeek | null {
  const today = todayKSTISO();
  return (
    weeks.find((w) => w.startDate <= today && addDaysISO(w.startDate, 6) >= today) || null
  );
}

/**
 * 오늘이 속한 등록된 주 (view 라우트의 현재 주 폴백용).
 * 복합 인덱스를 피하려고 termId 등호 조회 후 메모리에서 판별한다 (학기당 주 ~25개).
 */
export async function findCurrentWeek(domain: string, termId: string): Promise<TimetableWeek | null> {
  return pickCurrentWeek(await listWeeks(domain, termId));
}

// ── 학사일정 → 주차 자동 파생 (pre_opening_3features_spec §B) ──

export async function loadCalendarEvents(
  domain: string,
  termId: string
): Promise<TimetableCalendarEvent[]> {
  const snap = await timetableCalendarColRef(domain).where("termId", "==", termId).get();
  return snap.docs
    .map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        termId: data.termId || termId,
        type: data.type as CalendarEventType,
        startDate: data.startDate || "",
        endDate: data.endDate || data.startDate || "",
        ...(data.title ? { title: data.title } : {}),
        ...(Array.isArray(data.grades) ? { grades: data.grades } : {}),
        ...(data.periodsByGrade ? { periodsByGrade: data.periodsByGrade } : {}),
        ...(data.note ? { note: data.note } : {}),
        ...(typeof data.staffOnly === "boolean" ? { staffOnly: data.staffOnly } : {}),
        source: (data.source as "neis" | "manual") || "manual",
        ...(data.neisKey ? { neisKey: data.neisKey } : {}),
        createdBy: data.createdBy || "",
        createdAt: toMillis(data.createdAt) || 0,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

const CALENDAR_TYPES: CalendarEventType[] = ["행사", "휴업일", "재량휴업", "단축수업", "고사"];

export function validateCalendarEventPayload(
  raw: any
): { ok: true; event: Omit<TimetableCalendarEvent, "id" | "createdBy" | "createdAt"> } | { ok: false; error: string } {
  const termId = typeof raw?.termId === "string" ? raw.termId.trim() : "";
  if (!termId) return { ok: false, error: "학기가 지정되지 않았습니다." };
  const type = raw?.type as CalendarEventType;
  if (!CALENDAR_TYPES.includes(type))
    return { ok: false, error: "일정 종류는 행사·휴업일·재량휴업·단축수업·고사 중 하나여야 합니다." };

  const title = typeof raw?.title === "string" ? raw.title.trim().slice(0, 100) : undefined;
  if (type === "행사" && !title) {
    return { ok: false, error: "행사 일정에는 일정 이름(title)이 필수입니다." };
  }

  const startDate = typeof raw?.startDate === "string" ? raw.startDate.trim() : "";
  const endDate = typeof raw?.endDate === "string" && raw.endDate.trim() ? raw.endDate.trim() : startDate;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate))
    return { ok: false, error: "날짜는 YYYY-MM-DD 형식이어야 합니다." };
  if (endDate < startDate) return { ok: false, error: "종료일이 시작일보다 빠릅니다." };

  let periodsByGrade: Record<string, number> | undefined;
  if (type === "단축수업" || type === "고사") {
    const pbg = raw?.periodsByGrade;
    if (!pbg || typeof pbg !== "object" || Object.keys(pbg).length === 0)
      return { ok: false, error: `${type}에는 학년별 수업 교시 수(periodsByGrade)가 필요합니다.` };
    periodsByGrade = {};
    for (const [g, n] of Object.entries(pbg)) {
      const num = Number(n);
      if (!["1", "2", "3"].includes(g) || !Number.isInteger(num) || num < 0 || num > 8)
        return { ok: false, error: "학년별 교시 수 값이 올바르지 않습니다 (학년 1~3, 교시 0~8)." };
      periodsByGrade[g] = num;
    }
  }

  let grades: number[] | undefined;
  if (Array.isArray(raw?.grades)) {
    const parsed = raw.grades
      .map((g: any) => Number(g))
      .filter((num: number) => Number.isInteger(num) && num >= 1 && num <= 3);
    const unique = Array.from(new Set<number>(parsed)).sort((a, b) => a - b);
    if (unique.length > 0 && unique.length < 3) {
      grades = unique;
    }
  }

  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 200) : "";
  const staffOnly = Boolean(raw?.staffOnly);
  return {
    ok: true,
    event: {
      termId,
      type,
      startDate,
      endDate,
      ...(title ? { title } : {}),
      ...(grades ? { grades } : {}),
      ...(periodsByGrade ? { periodsByGrade } : {}),
      ...(note ? { note } : {}),
      // 항상 명시(true/false) — calendar_save 수정이 merge 쓰기라 생략 시 체크 해제가 반영되지 않음
      staffOnly,
    },
  };
}

/** 특정 월요일 주의 파생 입력 생성 — 공휴일 표 ∪ 학사일정 이벤트 (휴업일 우선, 행사는 일과 무영향) */
export function deriveWeekInput(
  termId: string,
  monday: string,
  events: TimetableCalendarEvent[]
): WeekRegisterInput {
  const days: WeekRegisterInput["days"] = [];
  const noteParts: string[] = [];

  // SCHEDULE_AFFECTING_TYPES 필터 한 줄 (행사 타입은 주간 파생 시수 무영향)
  const affectingEvents = events.filter((e) =>
    (SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(e.type)
  );

  for (let day = 1; day <= 5; day++) {
    const date = addDaysISO(monday, day - 1);
    const holidayName = holidayNameOf(date);
    const hits = affectingEvents.filter((e) => e.startDate <= date && date <= e.endDate);
    const closed = !!holidayName || hits.some((e) => e.type === "휴업일" || e.type === "재량휴업");
    const short = hits.find((e) => e.type === "단축수업" || e.type === "고사");
    if (closed) {
      const label =
        holidayName ||
        hits.find((e) => e.type === "휴업일" || e.type === "재량휴업")?.title ||
        hits.find((e) => e.type === "휴업일" || e.type === "재량휴업")?.note ||
        hits.find((e) => e.type === "휴업일" || e.type === "재량휴업")?.type;
      noteParts.push(`${date.slice(5)} ${label}`);
      days.push({ day, holiday: true });
    } else if (short?.periodsByGrade) {
      noteParts.push(`${date.slice(5)} ${short.title || short.note || short.type}`);
      days.push({ day, periodsByGrade: short.periodsByGrade });
    } else {
      days.push({ day });
    }
  }
  return {
    termId,
    startDate: monday,
    days,
    ...(noteParts.length ? { note: `학사일정 자동: ${noteParts.join(", ")}` } : {}),
  };
}

/** 학기의 시작일과 종료일 (ISO YYYY-MM-DD) 고정 구간을 구한다 */
export function getTermDateRange(termId: string): { startDate: string; endDate: string } {
  const match = termId.match(/^(\d{4})-(1|2)$/);
  if (match) {
    const year = Number(match[1]);
    const sem = match[2];
    if (sem === "1") {
      return { startDate: `${year}-03-01`, endDate: `${year}-07-31` };
    } else {
      const nextYear = year + 1;
      const isLeap = (nextYear % 4 === 0 && nextYear % 100 !== 0) || nextYear % 400 === 0;
      const lastDay = isLeap ? "29" : "28";
      return { startDate: `${year}-08-01`, endDate: `${nextYear}-02-${lastDay}` };
    }
  }
  const currentYear = new Date().getFullYear();
  return { startDate: `${currentYear}-03-01`, endDate: `${currentYear}-07-31` };
}

/**
 * 나이스(NEIS) SchoolSchedule API를 호출하여 학사일정을 자동 수집 및 동기화한다 (spec §3).
 * fail-safe: API 오류, 파싱 실패, 수신 0건, INFO-200(데이터 없음) 시 prune 없이 즉시 중단하고 실패 감사 로그만 기록.
 */
export async function runNeisCalendarSync(
  domain: string,
  targetTermId?: string
): Promise<{
  success: boolean;
  message: string;
  stats?: { added: number; updated: number; deleted: number; totalNeisEvents: number; weekSyncCalled: boolean };
}> {
  const terms = await loadAllTerms(domain);
  const activeTerms = terms.filter((t) => t.status !== "archived");
  const targetTerms = targetTermId ? activeTerms.filter((t) => t.id === targetTermId) : activeTerms;

  if (targetTerms.length === 0) {
    return { success: false, message: "동기화 대상 학기를 찾을 수 없습니다." };
  }

  const atptCode = process.env.NEIS_ATPT_CODE || "J10";
  const schulCode = process.env.NEIS_SCHUL_CODE || "7530601";
  const apiKey = process.env.NEIS_API_KEY;

  let totalAdded = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalNeisEventsCount = 0;
  let weekSyncCalledAny = false;

  for (const term of targetTerms) {
    const termRange = getTermDateRange(term.id);
    const fromYmd = termRange.startDate.replace(/-/g, "");
    const toYmd = termRange.endDate.replace(/-/g, "");
    const url = new URL("https://open.neis.go.kr/hub/SchoolSchedule");
    url.searchParams.set("Type", "json");
    url.searchParams.set("pIndex", "1");
    url.searchParams.set("pSize", "500");
    url.searchParams.set("ATPT_OFCDC_SC_CODE", atptCode);
    url.searchParams.set("SD_SCHUL_CODE", schulCode);
    url.searchParams.set("AA_FROM_YMD", fromYmd);
    url.searchParams.set("AA_TO_YMD", toYmd);
    if (apiKey) url.searchParams.set("KEY", apiKey);

    let rawData: any;
    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      rawData = await res.json();
    } catch (err: any) {
      console.error(`[runNeisCalendarSync] NEIS API 호출 실패 (${term.id}):`, err.message);
      await writeAuditLog({
        operatorEmail: "system@cron",
        targetEmail: domain,
        action: "neis_calendar_sync_fail",
        details: `나이스 학사일정 수집 실패 (${term.id}): ${err.message}. 안전을 위해 기존 데이터 삭제(prune)를 건너뜁니다.`,
        status: "failure",
      });
      return { success: false, message: `나이스 API 호출 실패: ${err.message}` };
    }

    // Fail-Safe: INFO-200, RESULT 오류, 파싱 실패 등 체크
    if (rawData?.RESULT || !Array.isArray(rawData?.SchoolSchedule) || !rawData.SchoolSchedule[1]?.row) {
      const resultCode = rawData?.RESULT?.CODE || rawData?.SchoolSchedule?.[0]?.head?.[1]?.RESULT?.CODE || "UNKNOWN";
      const resultMsg = rawData?.RESULT?.MESSAGE || rawData?.SchoolSchedule?.[0]?.head?.[1]?.RESULT?.MESSAGE || "데이터 없음 / 구조 상이";
      console.warn(`[runNeisCalendarSync] NEIS 수신 실패/0건 (${term.id}): [${resultCode}] ${resultMsg}`);
      await writeAuditLog({
        operatorEmail: "system@cron",
        targetEmail: domain,
        action: "neis_calendar_sync_fail",
        details: `나이스 학사일정 수신 0건 또는 오류 [${resultCode}]: ${resultMsg}. 안전을 위해 기존 데이터 삭제(prune)를 건너뜁니다.`,
        status: "failure",
      });
      return { success: false, message: `나이스 수신 실패/0건 [${resultCode}]: ${resultMsg}` };
    }

    const rows: any[] = rawData.SchoolSchedule[1].row;
    if (!Array.isArray(rows) || rows.length === 0) {
      console.warn(`[runNeisCalendarSync] NEIS row 배열이 비어있음 (${term.id})`);
      await writeAuditLog({
        operatorEmail: "system@cron",
        targetEmail: domain,
        action: "neis_calendar_sync_fail",
        details: `나이스 학사일정 응답 0건 (${term.id}). 안전을 위해 기존 데이터 삭제(prune)를 건너뜁니다.`,
        status: "failure",
      });
      return { success: false, message: `나이스 학사일정 응답 0건 (${term.id})` };
    }

    // 1일 단위 수집 및 스킵 필터링 (§3 매핑표)
    interface RawNeisItem {
      date: string; // YYYY-MM-DD
      eventNm: string;
      sbtrNm: string;
      note?: string;
      grades?: number[];
      type: CalendarEventType;
    }

    const parsedItems: RawNeisItem[] = [];

    for (const row of rows) {
      const ymdStr = String(row.AA_YMD || "");
      if (!/^\d{8}$/.test(ymdStr)) continue;
      const date = `${ymdStr.slice(0, 4)}-${ymdStr.slice(4, 6)}-${ymdStr.slice(6, 8)}`;
      const sbtrNm = String(row.SBTR_DD_SC_NM || "").trim(); // 공제구분명
      const eventNm = String(row.EVENT_NM || "").trim(); // 행사명
      const note = typeof row.EVENT_CNTNT === "string" && row.EVENT_CNTNT.trim() ? row.EVENT_CNTNT.trim() : undefined;

      // 공제 "공휴일" 스킵, EVENT_NM "토요휴업일" 스킵
      if (sbtrNm === "공휴일" || eventNm === "토요휴업일") continue;

      let type: CalendarEventType = "행사";
      if (sbtrNm === "휴업일") {
        type = "휴업일";
      } else if (sbtrNm === "해당없음") {
        type = "행사";
      }

      // 학년 YN
      const g1 = row.ONE_GRADE_EVENT_YN === "Y";
      const g2 = row.TW_GRADE_EVENT_YN === "Y";
      const g3 = row.THREE_GRADE_EVENT_YN === "Y";
      let grades: number[] | undefined;
      if (g1 && g2 && g3) {
        grades = undefined; // 전 학년
      } else if (!g1 && !g2 && !g3) {
        grades = undefined; // 전 학년
      } else {
        const temp: number[] = [];
        if (g1) temp.push(1);
        if (g2) temp.push(2);
        if (g3) temp.push(3);
        grades = temp.length > 0 ? temp : undefined;
      }

      parsedItems.push({ date, eventNm, sbtrNm, note, grades, type });
    }

    // 날짜순 정렬
    parsedItems.sort((a, b) => a.date.localeCompare(b.date));

    // 연속 일자 & 동일 EVENT_NM 기간(Period) 병합
    interface MergedNeisEvent {
      startDate: string;
      endDate: string;
      title: string;
      type: CalendarEventType;
      note?: string;
      grades?: number[];
      neisKey: string;
    }

    const mergedEvents: MergedNeisEvent[] = [];
    for (const item of parsedItems) {
      const last = mergedEvents[mergedEvents.length - 1];
      const isContinuous = last && addDaysISO(last.endDate, 1) === item.date;
      const isSameAttr =
        last &&
        last.title === item.eventNm &&
        last.type === item.type &&
        JSON.stringify(last.grades || []) === JSON.stringify(item.grades || []) &&
        last.note === item.note;

      if (isContinuous && isSameAttr) {
        last.endDate = item.date;
      } else {
        mergedEvents.push({
          startDate: item.date,
          endDate: item.date,
          title: item.eventNm,
          type: item.type,
          ...(item.note ? { note: item.note } : {}),
          ...(item.grades ? { grades: item.grades } : {}),
          neisKey: `${item.date.replace(/-/g, "")}|${item.eventNm}`,
        });
      }
    }

    totalNeisEventsCount += mergedEvents.length;

    // Firestore 동기화 (upsert & prune) — [term.startDate, term.endDate] 구간 내 neis 항목 한정
    const snap = await timetableCalendarColRef(domain).where("termId", "==", term.id).get();
    const existingNeisDocsMap = new Map<string, { id: string; data: any }>();

    snap.docs.forEach((doc) => {
      const data = doc.data();
      // source === "neis" 항목만 prune/upsert 대상 (manual은 불가침!)
      if (data.source === "neis") {
        const key = data.neisKey || `${data.startDate?.replace(/-/g, "")}|${data.title}`;
        existingNeisDocsMap.set(key, { id: doc.id, data });
      }
    });

    let added = 0;
    let updated = 0;
    let deleted = 0;
    let affectingChanged = false;

    const matchedKeys = new Set<string>();

    for (const event of mergedEvents) {
      matchedKeys.add(event.neisKey);
      const existing = existingNeisDocsMap.get(event.neisKey);

      if (!existing) {
        // 신규 추가
        await timetableCalendarColRef(domain).add({
          termId: term.id,
          type: event.type,
          startDate: event.startDate,
          endDate: event.endDate,
          title: event.title,
          ...(event.note ? { note: event.note } : {}),
          ...(event.grades ? { grades: event.grades } : {}),
          source: "neis",
          neisKey: event.neisKey,
          createdAt: Date.now(),
        });
        added++;
        if ((SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(event.type)) {
          affectingChanged = true;
        }
      } else {
        // 기존 문서 비교 후 수정
        const old = existing.data;
        const isDiff =
          old.type !== event.type ||
          old.startDate !== event.startDate ||
          old.endDate !== event.endDate ||
          old.title !== event.title ||
          old.note !== event.note ||
          JSON.stringify(old.grades || []) !== JSON.stringify(event.grades || []);

        if (isDiff) {
          await timetableCalendarColRef(domain).doc(existing.id).update({
            type: event.type,
            startDate: event.startDate,
            endDate: event.endDate,
            title: event.title,
            ...(event.note ? { note: event.note } : { note: FieldValue.delete() }),
            ...(event.grades ? { grades: event.grades } : { grades: FieldValue.delete() }),
            updatedAt: Date.now(),
          });
          updated++;
          if (
            (SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(event.type) ||
            (SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(old.type)
          ) {
            affectingChanged = true;
          }
        }
      }
    }

    // 나이스에서 사라진 항목 prune (구간 내 neis 항목 한정, manual 불가침)
    for (const [key, existing] of existingNeisDocsMap.entries()) {
      if (!matchedKeys.has(key)) {
        await timetableCalendarColRef(domain).doc(existing.id).delete();
        deleted++;
        if ((SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(existing.data.type)) {
          affectingChanged = true;
        }
      }
    }

    totalAdded += added;
    totalUpdated += updated;
    totalDeleted += deleted;

    // 일과 영향 타입 변화 시에만 주간 파생 동기화 호출
    if (affectingChanged) {
      await syncDerivedWeeksWithCalendar(domain, term.id);
      weekSyncCalledAny = true;
    }
  }

  // settings.lastNeisSyncAt 기록
  const syncTime = Date.now();
  await saveTimetableSettings(domain, { lastNeisSyncAt: syncTime });

  await writeAuditLog({
    operatorEmail: "system@cron",
    targetEmail: domain,
    action: "neis_calendar_sync",
    details: `나이스 학사일정 동기화 완료: 추가 ${totalAdded}건, 수정 ${totalUpdated}건, 삭제 ${totalDeleted}건 (총 수집 ${totalNeisEventsCount}건, 주파생재동기화: ${weekSyncCalledAny ? "실행" : "스킵"})`,
    status: "success",
  });

  return {
    success: true,
    message: `나이스 학사일정 동기화가 완료되었습니다.`,
    stats: {
      added: totalAdded,
      updated: totalUpdated,
      deleted: totalDeleted,
      totalNeisEvents: totalNeisEventsCount,
      weekSyncCalled: weekSyncCalledAny,
    },
  };
}

/** KST 기준 오늘 (ISO) — 서버는 UTC라 toISOString 단독 사용 시 KST 00:00~08:59에 어제로 계산된다 */
export function todayKSTISO(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 오늘 주의 월요일 (ISO) */
export function currentMondayISO(): string {
  const today = todayKSTISO();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일..6=토
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysISO(today, delta);
}

/**
 * 지연 생성: 오늘 주부터 publishWeeksAhead주 앞까지 없는 주를 학사일정으로 자동 생성.
 * 수동 등록 주는 절대 덮지 않는다 (registerWeek가 기존 주면 건너뜀). week_list 처리 시 호출.
 */
export async function ensureDerivedWeeks(domain: string): Promise<TimetableWeek[]> {
  const settings = await loadTimetableSettings(domain);
  const termId = settings.activeTermId;
  if (!termId) return [];
  const ahead = settings.publishWeeksAhead ?? 2;
  const [existing, events] = await Promise.all([
    listWeeks(domain, termId),
    loadCalendarEvents(domain, termId),
  ]);
  const existingIds = new Set(existing.map((w) => w.id));
  const created: TimetableWeek[] = [];
  let monday = currentMondayISO();
  for (let i = 0; i <= ahead; i++, monday = addDaysISO(monday, 7)) {
    if (existingIds.has(monday)) continue;
    try {
      created.push(await registerWeek(domain, deriveWeekInput(termId, monday, events), "학사일정 자동"));
    } catch (e: any) {
      // 경쟁 생성("이미 등록된 주")·보관 학기 등은 파생을 멈출 사유가 아니다
      console.error(`[ensureDerivedWeeks] ${monday} 생성 건너뜀:`, e.message);
    }
  }
  return created;
}

/**
 * 학사일정 변경 시 (calendar_save / calendar_delete) 기존 주들과 마스터 동기화 (spec §3-2).
 * 비과거 주(종료일 >= todayKSTISO())에 대해 dayOverrides에 없는 요일을 파생값으로 업데이트한다.
 * dayOverrides가 없는 레거시 주(undefined)는 첫 동기화 시 기존 days와 파생 days를 비교하여
 * 다른 요일은 오버라이드로 편입, 같은 요일은 추종으로 이행한다 (spec §4).
 */
export async function syncDerivedWeeksWithCalendar(
  domain: string,
  termId: string
): Promise<{ updatedCount: number; updatedWeekIds: string[] }> {
  const [allWeeks, events] = await Promise.all([
    listWeeks(domain, termId),
    loadCalendarEvents(domain, termId),
  ]);

  const today = todayKSTISO();
  const activeWeeks = allWeeks.filter((w) => addDaysISO(w.startDate, 6) >= today);
  const updatedWeekIds: string[] = [];

  for (const week of activeWeeks) {
    const derivedInput = deriveWeekInput(termId, week.startDate, events);
    const derivedDays = normalizeWeekDays(derivedInput);

    // §4: 레거시 주 (dayOverrides가 undefined) 자가 이행
    let overrides: number[];
    if (!Array.isArray(week.dayOverrides)) {
      overrides = [];
      for (let day = 1; day <= 5; day++) {
        const curDay = week.days.find((d) => d.day === day);
        const derDay = derivedDays.find((d) => d.day === day);
        const isDiff =
          !curDay ||
          !derDay ||
          curDay.holiday !== derDay.holiday ||
          JSON.stringify(curDay.periodsByGrade || {}) !== JSON.stringify(derDay.periodsByGrade || {});
        if (isDiff) {
          overrides.push(day);
        }
      }
    } else {
      overrides = [...week.dayOverrides];
    }

    const overrideSet = new Set(overrides);

    // 요일별 파생 추종 값 병합 (overrideSet에 없는 요일만 파생값 적용)
    const newDays: TimetableWeekDay[] = [];
    for (let day = 1; day <= 5; day++) {
      const curDay = week.days.find((d) => d.day === day);
      const derDay = derivedDays.find((d) => d.day === day)!;
      if (overrideSet.has(day) && curDay) {
        newDays.push(curDay);
      } else {
        newDays.push(derDay);
      }
    }

    // note 처리: 주 note가 없거나 "학사일정 자동:"으로 시작하면 파생 note로 재생성, 그 외 보존
    let newNote = week.note;
    if (!week.note || week.note.startsWith("학사일정 자동:")) {
      newNote = derivedInput.note;
    }

    // 변경 여부 대조
    const daysChanged = JSON.stringify(newDays) !== JSON.stringify(week.days);
    const overridesChanged = JSON.stringify(overrides) !== JSON.stringify(week.dayOverrides);
    const noteChanged = newNote !== week.note;

    if (daysChanged || overridesChanged || noteChanged) {
      const ref = timetableWeeksColRef(domain).doc(week.id);
      if (!newNote && week.note) {
        await ref.update({
          days: newDays,
          dayOverrides: overrides,
          note: FieldValue.delete(),
        });
      } else {
        const payload: Partial<TimetableWeek> = {
          days: newDays,
          dayOverrides: overrides,
          ...(newNote ? { note: newNote } : {}),
        };
        await ref.set(payload, { merge: true });
      }
      updatedWeekIds.push(week.id);
    }
  }

  if (updatedWeekIds.length > 0) {
    await bumpTimetableCacheVersion(domain);
    await writeAuditLog({
      operatorEmail: "system",
      targetEmail: domain,
      action: "sync_calendar_weeks",
      details: `학사일정 마스터 동기화 (${updatedWeekIds.length}개 주 반영): ${updatedWeekIds.join(", ")}`,
      status: "success",
    });
  }

  return { updatedCount: updatedWeekIds.length, updatedWeekIds };
}

// ── 기초시간표 개정 (pre_opening_3features_spec §E) ────────────

export async function loadBaseRevisions(
  domain: string,
  termId: string
): Promise<TimetableBaseRevision[]> {
  const snap = await baseRevisionsColRef(domain).where("termId", "==", termId).get();
  return snap.docs
    .map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        termId: data.termId || termId,
        status: data.status === "applied" ? ("applied" as const) : ("draft" as const),
        ...(data.effectiveFrom ? { effectiveFrom: data.effectiveFrom } : {}),
        ops: Array.isArray(data.ops) ? (data.ops as BaseRevisionOp[]) : [],
        ...(data.note ? { note: data.note } : {}),
        createdBy: data.createdBy || "",
        createdAt: toMillis(data.createdAt) || 0,
        ...(data.appliedBy ? { appliedBy: data.appliedBy } : {}),
        ...(toMillis(data.appliedAt) ? { appliedAt: toMillis(data.appliedAt)! } : {}),
      };
    })
    .sort((a, b) => (a.appliedAt || a.createdAt || 0) - (b.appliedAt || b.createdAt || 0));
}

const MAX_REVISION_OPS = 200;

export function validateRevisionOps(
  raw: any
): { ok: true; ops: BaseRevisionOp[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "ops는 배열이어야 합니다." };
  if (raw.length > MAX_REVISION_OPS)
    return { ok: false, error: `편집 항목이 너무 많습니다 (최대 ${MAX_REVISION_OPS}건).` };
  const ops: BaseRevisionOp[] = [];
  const slotOk = (d: any, p: any) =>
    Number.isInteger(Number(d)) && Number(d) >= 1 && Number(d) <= 5 &&
    Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= 8;
  for (const [i, op] of raw.entries()) {
    const grade = Number(op?.grade);
    const classNum = Number(op?.classNum);
    if (![1, 2, 3].includes(grade) || !Number.isInteger(classNum) || classNum < 1 || classNum > 15)
      return { ok: false, error: `${i + 1}번째 편집: 학년·반이 올바르지 않습니다.` };
    if (op?.type === "swap") {
      if (!slotOk(op?.a?.day, op?.a?.period) || !slotOk(op?.b?.day, op?.b?.period))
        return { ok: false, error: `${i + 1}번째 편집: 교시 정보가 올바르지 않습니다.` };
      const a = { day: Number(op.a.day), period: Number(op.a.period) };
      const b = { day: Number(op.b.day), period: Number(op.b.period) };
      if (a.day === b.day && a.period === b.period)
        return { ok: false, error: `${i + 1}번째 편집: 같은 교시끼리는 맞바꿀 수 없습니다.` };
      ops.push({ type: "swap", grade, classNum, a, b });
    } else if (op?.type === "edit_cell") {
      if (!slotOk(op?.day, op?.period))
        return { ok: false, error: `${i + 1}번째 편집: 교시 정보가 올바르지 않습니다.` };
      if (!Array.isArray(op?.lessons))
        return { ok: false, error: `${i + 1}번째 편집: 수업 목록이 올바르지 않습니다.` };
      const lessons: TimetableLesson[] = [];
      for (const l of op.lessons) {
        const subjectName = typeof l?.subjectName === "string" ? l.subjectName.trim() : "";
        if (!subjectName)
          return { ok: false, error: `${i + 1}번째 편집: 과목명이 비어 있습니다.` };
        lessons.push({
          subjectName,
          subjectShort: typeof l?.subjectShort === "string" && l.subjectShort.trim()
            ? l.subjectShort.trim() : subjectName.slice(0, 2),
          teachers: Array.isArray(l?.teachers)
            ? l.teachers
                .map((t: any) => ({
                  email: typeof t?.email === "string" ? t.email.trim().toLowerCase() : "",
                  name: typeof t?.name === "string" ? t.name.trim() : "",
                }))
                .filter((t: any) => t.email || t.name)
            : [],
          ...(typeof l?.room === "string" && l.room.trim() ? { room: l.room.trim() } : {}),
        });
      }
      ops.push({ type: "edit_cell", grade, classNum, day: Number(op.day), period: Number(op.period), lessons });
    } else {
      return { ok: false, error: `${i + 1}번째 편집: 지원하지 않는 편집 종류입니다.` };
    }
  }
  return { ok: true, ops };
}



/**
 * 주차별 기초 그리드 — 기초 + (effectiveFrom ≤ 주 시작일)인 적용 개정판들을 순서 적용.
 * 적용 후 동시수업 라벨 재스탬프 (이동 후 위치 기준 재판정). 여러 주를 한 번에 해석하며
 * 같은 개정 상태를 공유하는 주들은 같은 그리드 참조를 재사용한다 (합성기가 깊은 복사).
 */
export async function loadBaseGridsByWeek(
  domain: string,
  termId: string,
  weekStartDates: string[]
): Promise<Map<string, ClassGrid[]>> {
  const grids = await loadAllClassGrids(domain, termId);
  const out = new Map<string, ClassGrid[]>();
  const dates = [...new Set(weekStartDates)].sort();
  const applied = (await loadBaseRevisions(domain, termId))
    .filter((r) => r.status === "applied" && r.effectiveFrom)
    .sort((a, b) =>
      a.effectiveFrom!.localeCompare(b.effectiveFrom!) || (a.appliedAt || 0) - (b.appliedAt || 0)
    );
  if (applied.length === 0) {
    for (const d of dates) out.set(d, grids);
    return out;
  }
  const [simulGroups, venueGroups] = await Promise.all([
    loadSimulGroups(domain, termId),
    loadVenueGroups(domain, termId),
  ]);
  let cur = grids;
  let idx = 0;
  for (const date of dates) {
    let advanced = false;
    while (idx < applied.length && applied[idx].effectiveFrom! <= date) {
      if (!advanced) {
        cur = cloneClassGrids(cur);
        advanced = true;
      }
      const warns = applyRevisionOps(cur, applied[idx].ops);
      for (const w of warns)
        console.error(`[baseRevision ${applied[idx].id}] ${w}`);
      idx++;
    }
    if (advanced) {
      applySimulMarks(cur, simulGroups);
      applyVenueMarks(cur, venueGroups);
    }
    out.set(date, cur);
  }
  return out;
}

export async function loadBaseGridsForWeek(
  domain: string,
  termId: string,
  weekStartDate: string
): Promise<ClassGrid[]> {
  return (await loadBaseGridsByWeek(domain, termId, [weekStartDate])).get(weekStartDate)!;
}

/**
 * draft 저장 (생성 또는 전체 교체) — 저장은 항상 하고, 최신 적용 기초에 가상 적용한
 * 경고 목록을 함께 반환한다 (편집 중 임시 상태 허용, spec §E-3).
 */
export async function saveRevisionDraft(
  domain: string,
  termId: string,
  userEmail: string,
  ops: BaseRevisionOp[],
  note?: string,
  revisionId?: string
): Promise<{ revision: TimetableBaseRevision; warnings: string[] }> {
  let ref: FirebaseFirestore.DocumentReference;
  let createdBy = userEmail.toLowerCase();
  let createdAt = Date.now();
  if (revisionId) {
    ref = baseRevisionsColRef(domain).doc(revisionId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("수정할 개정판을 찾을 수 없습니다.");
    const data = snap.data() as any;
    if (data.status !== "draft") throw new Error("이미 적용된 개정판은 수정할 수 없습니다.");
    createdBy = data.createdBy || createdBy;
    createdAt = toMillis(data.createdAt) || createdAt;
  } else {
    // 학기당 draft 1개 (단순화) — 기존 draft가 있으면 그것을 교체한다
    const existing = (await loadBaseRevisions(domain, termId)).find((r) => r.status === "draft");
    ref = existing?.id ? baseRevisionsColRef(domain).doc(existing.id) : baseRevisionsColRef(domain).doc();
    if (existing) {
      createdBy = existing.createdBy || createdBy;
      createdAt = existing.createdAt || createdAt;
    }
  }
  // 편집 기준판 = 최신 적용 기초 (모든 applied 개정 반영)
  const latestBase = await loadBaseGridsForWeek(domain, termId, "9999-12-31");

  // 자리표시(창체·SLAT) 셀 보호 — 개정 연산에 자리표시 셀 차단 체크
  const checkGrids = cloneClassGrids(latestBase);
  for (const op of ops) {
    const placeholderBlock = checkPlaceholderOp(checkGrids, op);
    if (placeholderBlock) throw new Error(placeholderBlock);
    applyRevisionOps(checkGrids, [op]);
  }

  // edit_cell 교사 이메일 자동 해석 — 화면에서 이름만 입력한 경우 기초 그리드의 유일
  // 동명 교사 이메일을 보충한다. 이메일 없는 교사는 엔진이 가상 교사로 취급해 그 수업이
  // 교체 불가가 되므로(§4-3), 해석 실패는 경고로 알린다.
  const nameToEmails = new Map<string, Set<string>>();
  for (const g of latestBase)
    for (const c of g.cells || [])
      for (const l of c.lessons || [])
        for (const t of l.teachers || []) {
          if (!t.name || !t.email) continue;
          if (!nameToEmails.has(t.name)) nameToEmails.set(t.name, new Set());
          nameToEmails.get(t.name)!.add(t.email.trim().toLowerCase());
        }
  const resolveWarnings: string[] = [];
  for (const op of ops) {
    if (op.type !== "edit_cell") continue;
    for (const t of op.lessons.flatMap((l) => l.teachers || [])) {
      if (t.email || !t.name) continue;
      const found = nameToEmails.get(t.name);
      if (found && found.size === 1) {
        t.email = [...found][0];
      } else {
        resolveWarnings.push(
          found && found.size > 1
            ? `"${t.name}" 선생님이 여러 명이라 계정을 자동으로 찾지 못했습니다 — 이 수업은 교체 대상에서 빠집니다.`
            : `"${t.name}" 선생님의 계정을 찾지 못했습니다 — 이 수업은 교체 대상에서 빠집니다.`
        );
      }
    }
  }

  const revision: TimetableBaseRevision = {
    id: ref.id,
    termId,
    status: "draft",
    ops,
    ...(note ? { note: note.trim().slice(0, 200) } : {}),
    createdBy,
    createdAt,
  };
  await ref.set({ ...revision, updatedBy: userEmail.toLowerCase(), updatedAt: Date.now() });
  // 미리보기 검증: 최신 적용 기초 위에 가상 적용
  const warnings = [...resolveWarnings, ...applyRevisionOps(cloneClassGrids(latestBase), ops)];
  return { revision, warnings };
}

/** draft → applied. effectiveFrom 기본 = 다음 주 월요일. 이번 주 이하 소급 적용 금지 (spec §E-3). */
export async function applyRevisionDraft(
  domain: string,
  userEmail: string,
  revisionId: string,
  effectiveFrom?: string
): Promise<TimetableBaseRevision> {
  const ref = baseRevisionsColRef(domain).doc(revisionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("적용할 개정판을 찾을 수 없습니다.");
  const data = snap.data() as any;
  if (data.status !== "draft") throw new Error("이미 적용된 개정판입니다.");
  if (!Array.isArray(data.ops) || data.ops.length === 0)
    throw new Error("편집 내용이 비어 있어 적용할 수 없습니다.");
  const nextMonday = addDaysISO(currentMondayISO(), 7);
  const from = (effectiveFrom || nextMonday).trim();
  if (!DATE_RE.test(from)) throw new Error("적용 시작일은 YYYY-MM-DD 형식이어야 합니다.");
  if (new Date(`${from}T00:00:00Z`).getUTCDay() !== 1)
    throw new Error("적용 시작일은 월요일이어야 합니다.");
  if (from <= currentMondayISO())
    throw new Error("이미 운영 중인 주에는 소급 적용할 수 없습니다. 다음 주 이후 월요일을 지정하세요.");
  const patch = {
    status: "applied" as const,
    effectiveFrom: from,
    appliedBy: userEmail.toLowerCase(),
    appliedAt: Date.now(),
  };
  await ref.set(patch, { merge: true });
  await bumpTimetableCacheVersion(domain);
  return { ...(data as TimetableBaseRevision), id: revisionId, ...patch };
}

export async function deleteRevisionDraft(domain: string, revisionId: string): Promise<void> {
  const ref = baseRevisionsColRef(domain).doc(revisionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("삭제할 개정판을 찾을 수 없습니다.");
  if ((snap.data() as any).status !== "draft")
    throw new Error("적용된 개정판은 삭제할 수 없습니다. 되돌리려면 새 개정으로 원복하세요.");
  await ref.delete();
}

// ── 변경 로그 로드 & 주간 합성 ────────────────────────────────

export async function loadWeekChanges(domain: string, weekId: string): Promise<TimetableChange[]> {
  const snap = await timetableChangesColRef(domain).where("weekId", "==", weekId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export async function loadTermChanges(domain: string, termId: string): Promise<TimetableChange[]> {
  const snap = await timetableChangesColRef(domain).where("termId", "==", termId).get();
  return snap.docs
    .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
    .sort((a, b) => a.appliedAt - b.appliedAt);
}

export async function synthesizeWeek(
  domain: string,
  week: TimetableWeek,
  extraChanges?: TimetableChange[]
): Promise<WeeklySynthesisResult> {
  const [baseGrids, changes, settings] = await Promise.all([
    loadBaseGridsForWeek(domain, week.termId, week.startDate), // 개정판 반영 (spec §E)
    loadWeekChanges(domain, week.id),
    loadTimetableSettings(domain),
  ]);
  // extraChanges(가상 what-if — §14-1)는 실 변경 뒤에 적용돼야 한다. 합성기가 appliedAt으로
  // 재정렬하므로, 호출부는 extraChanges의 appliedAt을 미래값으로 세팅해 전달한다.
  const all = extraChanges?.length ? [...changes, ...extraChanges] : changes;
  return synthesizeWeeklyGrids(baseGrids, week, all, settings);
}

/** 학기 과목·그리드에서 전체 교사 수집 (view 라우트 free 액션과 동일 규칙) */
export function collectTermTeachers(term: TimetableTerm, grids: WeeklyClassGrid[]): TimetableTeacher[] {
  const teacherMap = new Map<string, TimetableTeacher>();
  for (const subj of term.subjects || []) {
    for (const email of subj.teacherEmails || []) {
      const normEmail = email.trim().toLowerCase();
      if (normEmail && !teacherMap.has(normEmail)) {
        teacherMap.set(normEmail, { email: normEmail, name: normEmail.split("@")[0] });
      }
    }
  }
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        for (const teacher of lesson.teachers || []) {
          const normEmail = (teacher.email || "").trim().toLowerCase();
          if (normEmail) {
            teacherMap.set(normEmail, { email: normEmail, name: teacher.name || normEmail.split("@")[0] });
          }
        }
      }
    }
  }
  return Array.from(teacherMap.values());
}

// ── §14-1 가상 합성(what-if): PENDING 신청·초안 → 가상 change ──

/** 신청·초안 공통 최소 형태 — 가상 change 변환 입력 */
interface VirtualSwapItem {
  key: string; // 가상 change id 구성용 (req-{id} / draft-{id})
  termId: string;
  weekId: string;
  targetWeekId?: string;
  type: SwapRequestType;
  requesterEmail: string;
  requesterName: string;
  source: SwapSourceSlot;
  candidate: SwapCandidateSnapshot;
}

/**
 * 한 항목을 특정 주(weekId)에 적용될 가상 change로 변환 (phase9b_spec §14-1).
 *
 * 승인 트랜잭션(approveSwapRequest)이 생성하는 3형태(swap/cross_swap 쌍/substitute)와 같은
 * 문서 모양을 **스냅샷 값으로 근사**한다 — change 필드를 바꿀 때는 반드시 양쪽을 함께 고칠 것.
 * (승인 쪽은 재검증된 그리드에서 lesson 세부를 읽지만, 여기는 검증 없이 스냅샷만 쓰므로
 *  함수를 공유하지 않는다. 무효 항목은 합성기가 integrityWarnings로 건너뛴다(§3-4) —
 *  what-if 목적에는 그 방어 동작이 정확히 원하는 것이다.)
 *
 * appliedAt은 호출부가 미래값으로 지정한다 — 합성기의 appliedAt 재정렬에서 실 변경 뒤에
 * 적용되는 것을 보장하기 위함. 가상 문서는 절대 저장하지 않는다.
 */
function buildVirtualChanges(item: VirtualSwapItem, weekId: string, appliedAt: number): TimetableChange[] {
  const common = {
    termId: item.termId,
    appliedBy: "__virtual__",
    appliedAt,
  };
  const isCross = !!item.targetWeekId && item.targetWeekId !== item.weekId;

  if (!isCross) {
    if (item.weekId !== weekId) return [];
    if (item.type === "substitute") {
      return [{
        id: `virtual-${item.key}`, weekId, type: "substitute", ...common,
        substitute: {
          grade: item.source.grade, classNum: item.source.classNum,
          day: item.source.day, period: item.source.period,
          subjectName: item.source.subjectName,
          absentTeacherEmail: item.requesterEmail, absentTeacherName: item.requesterName,
          subTeacherEmail: item.candidate.counterpartEmail, subTeacherName: item.candidate.counterpartName,
        },
      }];
    }
    if (item.candidate.targetDay == null || item.candidate.targetPeriod == null) return [];
    return [{
      id: `virtual-${item.key}`, weekId, type: "swap", ...common,
      swap: {
        grade: item.source.grade, classNum: item.source.classNum,
        a: {
          day: item.source.day, period: item.source.period,
          subjectName: item.source.subjectName,
          teacherEmail: item.requesterEmail, teacherName: item.requesterName,
        },
        b: {
          day: item.candidate.targetDay, period: item.candidate.targetPeriod,
          subjectName: item.candidate.counterpartSubjectName || "",
          teacherEmail: item.candidate.counterpartEmail, teacherName: item.candidate.counterpartName,
        },
      },
    }];
  }

  // 교차 주: 이 주에 해당하는 쪽 문서만 (approve의 changeA/changeB와 동일 방향)
  if (item.candidate.targetDay == null || item.candidate.targetPeriod == null) return [];
  const myRef: CrossSwapLessonRef = {
    subjectName: item.source.subjectName,
    subjectShort: item.source.subjectName.slice(0, 2), // 근사 — 가상 문서는 표시용이 아님
    teacherEmail: item.requesterEmail,
    teacherName: item.requesterName,
  };
  const otherRef: CrossSwapLessonRef = {
    subjectName: item.candidate.counterpartSubjectName || "",
    subjectShort: (item.candidate.counterpartSubjectName || "").slice(0, 2),
    teacherEmail: item.candidate.counterpartEmail,
    teacherName: item.candidate.counterpartName,
  };
  if (weekId === item.weekId) {
    return [{
      id: `virtual-${item.key}-a`, weekId, type: "cross_swap", ...common,
      crossSwap: {
        exchangeId: `virtual-${item.key}`, otherWeekId: item.targetWeekId!,
        grade: item.source.grade, classNum: item.source.classNum,
        day: item.source.day, period: item.source.period,
        out: myRef, in: otherRef,
      },
    }];
  }
  if (weekId === item.targetWeekId) {
    return [{
      id: `virtual-${item.key}-b`, weekId, type: "cross_swap", ...common,
      crossSwap: {
        exchangeId: `virtual-${item.key}`, otherWeekId: item.weekId,
        grade: item.source.grade, classNum: item.source.classNum,
        day: item.candidate.targetDay, period: item.candidate.targetPeriod,
        out: otherRef, in: myRef,
      },
    }];
  }
  return [];
}

/**
 * 본인 PENDING 신청(+선택 시 초안)을 주별 가상 change 목록으로 로드 (§14-1).
 * excludeSource: 지금 후보를 조회하는 소스 셀과 같은 항목은 제외 — 자기 자신과의 충돌 방지.
 */
async function loadMyVirtualOverlay(
  domain: string,
  userEmail: string,
  weekIds: string[],
  opts: { includeMyPending?: boolean; includeDrafts?: boolean },
  excludeSource: { weekId: string; source: SwapSourceSlot } | null
): Promise<{ byWeek: Map<string, TimetableChange[]>; pendingCount: number; draftCount: number }> {
  const norm = userEmail.trim().toLowerCase();
  const items: VirtualSwapItem[] = [];
  let pendingCount = 0;
  let draftCount = 0;

  const isExcluded = (weekId: string, s: SwapSourceSlot) =>
    excludeSource !== null &&
    weekId === excludeSource.weekId &&
    s.grade === excludeSource.source.grade && s.classNum === excludeSource.source.classNum &&
    s.day === excludeSource.source.day && s.period === excludeSource.source.period;
  const touches = (weekId: string, targetWeekId?: string) =>
    weekIds.includes(weekId) || (targetWeekId ? weekIds.includes(targetWeekId) : false);

  if (opts.includeMyPending) {
    const snap = await swapRequestsColRef(domain)
      .where("requesterEmail", "==", norm)
      .where("status", "==", "PENDING")
      .get();
    for (const doc of snap.docs) {
      const r = doc.data() as SwapRequest;
      if (!touches(r.weekId, r.targetWeekId) || isExcluded(r.weekId, r.source)) continue;
      items.push({
        key: `req-${doc.id}`, termId: r.termId, weekId: r.weekId, targetWeekId: r.targetWeekId,
        type: r.type, requesterEmail: norm, requesterName: r.requesterName,
        source: r.source, candidate: r.candidate,
      });
      pendingCount++;
    }
  }

  if (opts.includeDrafts) {
    const drafts = await listSwapDrafts(domain, norm);
    for (const d of drafts) {
      if (!touches(d.sourceWeekId, d.targetWeekId) || isExcluded(d.sourceWeekId, d.source)) continue;
      // 이미 같은 소스 셀의 PENDING 신청이 겹쳐 있으면 초안은 건너뜀 (이중 적용 방지)
      if (items.some((it) => isSameSourceSlot(it, d.sourceWeekId, d.source))) continue;
      items.push({
        key: `draft-${d.id}`, termId: d.termId, weekId: d.sourceWeekId, targetWeekId: d.targetWeekId,
        type: "swap", requesterEmail: norm,
        requesterName: d.requesterName || norm.split("@")[0],
        source: d.source, candidate: d.candidate,
      });
      draftCount++;
    }
  }

  const byWeek = new Map<string, TimetableChange[]>();
  // 실 변경 뒤 + 항목 생성순 적용 보장: 미래 시각 + 순번
  const futureBase = Date.now() + 10_000_000;
  let seq = 0;
  for (const it of items) {
    for (const wid of weekIds) {
      const chs = buildVirtualChanges(it, wid, futureBase + seq);
      if (chs.length) {
        byWeek.set(wid, [...(byWeek.get(wid) || []), ...chs]);
        seq += chs.length;
      }
    }
  }
  return { byWeek, pendingCount, draftCount };
}

function isSameSourceSlot(it: VirtualSwapItem, weekId: string, s: SwapSourceSlot): boolean {
  return (
    it.weekId === weekId &&
    it.source.grade === s.grade && it.source.classNum === s.classNum &&
    it.source.day === s.day && it.source.period === s.period
  );
}

/**
 * §14-4: 직권 담기 누적분(extraItems)을 주별 가상 change로 변환.
 * loadMyVirtualOverlay와 같은 규약이되 입력이 DB가 아니라 호출부 명시 전달이라는 점만 다르다.
 * appliedAt은 오버레이(+10M)보다 뒤(+20M)로 두어 담기 순서가 실 변경·대기분 뒤에 적용됨을 보장.
 * excludeSource: 현재 후보를 탐색 중인 소스 셀과 같은 항목 제외(자기 충돌 방지) — 불필요하면 null.
 */
function buildDirectExtraOverlay(
  extraItems: DirectPendingOverlayItem[] | undefined,
  termId: string,
  requesterEmail: string,
  weekIds: string[],
  excludeSource: { weekId: string; source: SwapSourceSlot } | null
): { byWeek: Map<string, TimetableChange[]>; count: number } {
  const byWeek = new Map<string, TimetableChange[]>();
  let count = 0;
  if (!extraItems?.length) return { byWeek, count };
  const futureBase = Date.now() + 20_000_000;
  let seq = 0;
  extraItems.forEach((e, i) => {
    const isExcluded =
      excludeSource !== null &&
      e.weekId === excludeSource.weekId &&
      e.source.grade === excludeSource.source.grade && e.source.classNum === excludeSource.source.classNum &&
      e.source.day === excludeSource.source.day && e.source.period === excludeSource.source.period;
    if (isExcluded) return;
    // §C 체인 단계는 선택 교사가 아닌 다른 교사의 수업일 수 있다 — 항목에 실린 소스 담당자 우선
    const stepEmail = (e.sourceTeacherEmail || requesterEmail).toLowerCase();
    const it: VirtualSwapItem = {
      key: `direct-${i}`,
      termId,
      weekId: e.weekId,
      targetWeekId: e.targetWeekId,
      type: e.type,
      requesterEmail: stepEmail,
      requesterName: e.sourceTeacherName || stepEmail.split("@")[0],
      source: e.source,
      candidate: e.candidate,
    };
    let touched = false;
    for (const wid of weekIds) {
      const chs = buildVirtualChanges(it, wid, futureBase + seq);
      if (chs.length) {
        byWeek.set(wid, [...(byWeek.get(wid) || []), ...chs]);
        seq += chs.length;
        touched = true;
      }
    }
    if (touched) count++;
  });
  return { byWeek, count };
}

/**
 * §14-4: 직권 담기 가상 반영 그리드 — 대상 교사의 등록 전 주 시간표에 담기 누적분을 가상 적용해 반환.
 * 교사 포털 my_projected(computeMyProjectedWeeks)의 직권 대응. 확정 상태 + extraItems만 반영하며
 * DB의 PENDING·초안은 반영하지 않는다(직권 확정 상태 기준 원칙 유지). 가상 셀은 changed.changeId가
 * "virtual-direct-" 접두어로 표시되어 UI가 담김 이동분을 구분한다.
 */
export async function computeDirectProjectedWeeks(
  domain: string,
  teacherEmail: string,
  extraItems: DirectPendingOverlayItem[],
  opts?: { extraWeeks?: number }
): Promise<{
  termId: string | null;
  weeks: Array<{
    weekId: string; startDate: string; cells: TeacherTimetableCell[];
    dayPeriodCounts: Array<{ day: number; periods: number }>; // 수집 20 — 미편성 교시 렌더 제외 재료 (my_projected와 동일)
  }>;
  appliedCount: number;
  /** 반환 범위 밖에 아직 남은 등록 주가 있는지 — UI의 [이후 주 더 보기] 노출 판정 (§3-2d 수집 24) */
  hasMore: boolean;
}> {
  const [settings, term] = await Promise.all([
    loadTimetableSettings(domain),
    loadActiveTerm(domain),
  ]);
  if (!term) return { termId: null, weeks: [], appliedCount: 0, hasMore: false };

  let weeks = await listWeeks(domain, term.id);

  // 파생 게이트: [현재 주, 현재 주 + publishWeeksAhead주] 범위의 월요일 중 목록에 없는 주가 하나라도 있으면 파생 후 재조회
  const currMonday = currentMondayISO();
  const ahead = settings.publishWeeksAhead ?? 2;
  const existingMondays = new Set(weeks.map((w) => w.startDate || w.id));

  let missingAny = false;
  let mondayIter = currMonday;
  for (let i = 0; i <= ahead; i++) {
    if (!existingMondays.has(mondayIter)) {
      missingAny = true;
      break;
    }
    mondayIter = addDaysISO(mondayIter, 7);
  }

  if (missingAny) {
    await ensureDerivedWeeks(domain);
    weeks = await listWeeks(domain, term.id);
  }

  // 주 목록 필터: 종료일(startDate+6일)이 KST 오늘 이상 & startDate가 현재 주+publishWeeksAhead주 이하
  const today = todayKSTISO();
  const maxMonday = addDaysISO(currMonday, ahead * 7);

  // 일과계는 노출 창 밖의 미래 주(9월 출장 선등록 등)도 작업할 수 있어야 한다 — 다만 전 주를
  // 항상 그리면 스크롤 압박이 되므로, 기본은 노출 창이고 UI의 [이후 주 더 보기]가 주 단위로 넓힌다
  // (§3-2d 수집 24, 2026-08-11 사용자 확정). 과거 주 제외는 유지.
  const extraWeeks = Math.max(0, Math.min(52, Math.floor(opts?.extraWeeks ?? 0)));
  const windowMaxMonday = addDaysISO(maxMonday, extraWeeks * 7);

  const notPast = weeks.filter((w) => addDaysISO(w.startDate, 6) >= today);
  weeks = notPast.filter((w) => w.startDate <= windowMaxMonday);
  const hasMore = notPast.some((w) => w.startDate > windowMaxMonday);

  weeks.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const extra = buildDirectExtraOverlay(extraItems, term.id, teacherEmail, weeks.map((w) => w.id), null);

  const baseByWeek = await loadBaseGridsByWeek(domain, term.id, weeks.map((w) => w.startDate));
  const changesByWeek = new Map(
    await Promise.all(
      weeks.map(async (w) => [w.id, await loadWeekChanges(domain, w.id)] as const)
    )
  );

  const out: Array<{
    weekId: string; startDate: string; cells: TeacherTimetableCell[];
    dayPeriodCounts: Array<{ day: number; periods: number }>;
  }> = [];
  for (const week of weeks) {
    const changes = changesByWeek.get(week.id) || [];
    const virtual = extra.byWeek.get(week.id) || [];
    const { grids } = synthesizeWeeklyGrids(baseByWeek.get(week.startDate)!, week, [...changes, ...virtual], settings);
    out.push({
      weekId: week.id, startDate: week.startDate,
      cells: synthesizeTeacherTimetable(grids, teacherEmail),
      dayPeriodCounts: computeDayPeriodCounts(grids),
    });
  }
  return { termId: term.id, weeks: out, appliedCount: extra.count, hasMore };
}

/** 가상 합성본에서 본인 요일별 시수 집계 (§14-1 projectedDayLoads) */
function countMyDayLoads(grids: WeeklyClassGrid[], email: string): ProjectedDayLoad[] {
  const counts = new Map<number, number>();
  for (const cell of synthesizeTeacherTimetable(grids, email)) {
    counts.set(cell.day, (counts.get(cell.day) || 0) + 1);
  }
  return [1, 2, 3, 4, 5].map((day) => ({ day, count: counts.get(day) || 0 }));
}

/**
 * §14-2 v2: 등록된 전 주의 "예상 내 시간표" — 알리미식 일렬 나열용.
 * PENDING 신청·초안(클릭 누적분)을 가상 적용한 각 주의 본인 셀·요일 시수를 한 번에 반환.
 * 셀 changed.changeId 접두어("virtual-req-"/"virtual-draft-")로 UI가 대기/초안 반영분을 구분한다.
 */
/**
 * 전교 공통 활동 교시 판정을 주 단위로 일반화 (consent_swap_opening_spec §3-2d S1 — §4-1b의 확장).
 * (요일·교시)별로, 수업 있는 학급 중 가상(이메일 없음)·블록 교사 명의 학급이 과반이면 공통 활동 교시.
 * view `free`의 단일 교시 판정과 동일 기준 — UI(U4)는 이 목록으로 체인 목적지 렌더에서 제외한다.
 */
export function computeCommonActivitySlots(
  grids: WeeklyClassGrid[]
): Array<{ day: number; period: number }> {
  const idx = buildSlotIndex(grids);
  const classesWithLesson = new Map<string, number>();
  const commonClasses = new Map<string, number>();
  for (const grid of grids) {
    const seen = new Set<string>(); // 같은 그리드에 동일 교시 셀이 중복돼도 학급당 1회만 계수 (free 판정의 find와 동일 의미)
    for (const cell of grid.cells || []) {
      const lessons = cell.lessons || [];
      if (!lessons.length) continue;
      const key = `${cell.day}-${cell.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      classesWithLesson.set(key, (classesWithLesson.get(key) || 0) + 1);
      const isCommon = lessons.some((l) => {
        const ts = l.teachers || [];
        if (ts.length === 0 || ts.every((t) => !(t.email || "").trim())) return true; // 가상
        return ts.some((t) => isBlockTeacher(idx, t.email || "")); // 블록(전교 공통)
      });
      if (isCommon) commonClasses.set(key, (commonClasses.get(key) || 0) + 1);
    }
  }
  const out: Array<{ day: number; period: number }> = [];
  for (const [key, total] of classesWithLesson) {
    if ((commonClasses.get(key) || 0) * 2 >= total) {
      const [day, period] = key.split("-").map(Number);
      out.push({ day, period });
    }
  }
  return out.sort((a, b) => a.day - b.day || a.period - b.period);
}

/**
 * 요일별 실제 운영 교시 수 = 그 요일에 어느 학급이든 수업이 있는 마지막 교시 (§3-2d 수집 20).
 *
 * 주 메타(days[].periodsByGrade)는 우리 학교 실데이터에서 비어 있고(2026-08-11 실측),
 * 진실은 기초시간표에 있다 — 금요일은 6교시까지만 편성되어 있으나 settings.periodsPerDay는 7.
 * 클라이언트는 자기 그리드만 알아 판정할 수 없으므로 서버가 동봉한다. 편성이 바뀌면
 * 이 값도 따라 바뀌므로(하드코딩 없음) 이후 시간표 편성 기능에도 그대로 유효하다.
 * 휴업일·미운영 요일은 0.
 */
export function computeDayPeriodCounts(
  grids: WeeklyClassGrid[]
): Array<{ day: number; periods: number }> {
  const maxByDay = new Map<number, number>();
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      if (!(cell.lessons || []).length) continue;
      maxByDay.set(cell.day, Math.max(maxByDay.get(cell.day) || 0, cell.period));
    }
  }
  return [1, 2, 3, 4, 5].map((day) => ({ day, periods: maxByDay.get(day) || 0 }));
}

export async function computeMyProjectedWeeks(
  domain: string,
  userEmail: string,
  opts: { includeMyPending: boolean; includeDrafts: boolean }
): Promise<{
  termId: string | null;
  weeks: Array<{
    weekId: string;
    startDate: string;
    days: TimetableWeek["days"];
    cells: TeacherTimetableCell[];
    dayLoads: ProjectedDayLoad[];
    commonActivitySlots: Array<{ day: number; period: number }>; // §3-2d S1 — U4(체인 목적지 제외) 재료
    dayPeriodCounts: Array<{ day: number; periods: number }>; // 수집 20 — 미편성 교시(금7 등) 렌더 제외 재료
  }>;
  assumedPendingCount: number;
  assumedDraftCount: number;
}> {
  const [settings, term] = await Promise.all([
    loadTimetableSettings(domain),
    loadActiveTerm(domain),
  ]);
  if (!term) return { termId: null, weeks: [], assumedPendingCount: 0, assumedDraftCount: 0 };

  let weeks = await listWeeks(domain, term.id);

  // 파생 게이트: [현재 주, 현재 주 + publishWeeksAhead주] 범위의 월요일 중 목록에 없는 주가 하나라도 있으면 파생 후 재조회
  const currMonday = currentMondayISO();
  const ahead = settings.publishWeeksAhead ?? 2;
  const existingMondays = new Set(weeks.map((w) => w.startDate || w.id));

  let missingAny = false;
  let mondayIter = currMonday;
  for (let i = 0; i <= ahead; i++) {
    if (!existingMondays.has(mondayIter)) {
      missingAny = true;
      break;
    }
    mondayIter = addDaysISO(mondayIter, 7);
  }

  if (missingAny) {
    await ensureDerivedWeeks(domain);
    weeks = await listWeeks(domain, term.id);
  }

  // 주 목록 필터: 종료일(startDate+6일)이 KST 오늘 이상 & startDate가 현재 주+publishWeeksAhead주 이하
  const today = todayKSTISO();
  const maxMonday = addDaysISO(currMonday, ahead * 7);

  weeks = weeks.filter((w) => {
    const weekEnd = addDaysISO(w.startDate, 6);
    return weekEnd >= today && w.startDate <= maxMonday;
  });

  weeks.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const overlay = await loadMyVirtualOverlay(
    domain, userEmail, weeks.map((w) => w.id), opts, null
  );

  const baseByWeek = await loadBaseGridsByWeek(domain, term.id, weeks.map((w) => w.startDate));

  // 주별 changes는 서로 독립이므로 병렬 조회 — 직렬 왕복 누적(주 수 × RTT) 방지
  const changesByWeek = new Map(
    await Promise.all(
      weeks.map(async (w) => [w.id, await loadWeekChanges(domain, w.id)] as const)
    )
  );

  const out: Array<{
    weekId: string; startDate: string; days: TimetableWeek["days"];
    cells: TeacherTimetableCell[]; dayLoads: ProjectedDayLoad[];
    commonActivitySlots: Array<{ day: number; period: number }>;
    dayPeriodCounts: Array<{ day: number; periods: number }>;
  }> = [];
  for (const week of weeks) {
    const changes = changesByWeek.get(week.id) || [];
    const virtual = overlay.byWeek.get(week.id) || [];
    const { grids } = synthesizeWeeklyGrids(baseByWeek.get(week.startDate)!, week, [...changes, ...virtual], settings);
    out.push({
      weekId: week.id,
      startDate: week.startDate,
      days: week.days,
      cells: synthesizeTeacherTimetable(grids, userEmail),
      dayLoads: countMyDayLoads(grids, userEmail),
      commonActivitySlots: computeCommonActivitySlots(grids),
      dayPeriodCounts: computeDayPeriodCounts(grids),
    });
  }
  return {
    termId: term.id,
    weeks: out,
    assumedPendingCount: overlay.pendingCount,
    assumedDraftCount: overlay.draftCount,
  };
}

/**
 * 조율 필요 후보 켬 (consent_swap_opening_spec §2-3) — 후보 조회·신청 재검증·요청대장 사전 검증·
 * 승인 재검증 전 경로에서 켠다. **체인 탐색(computeChainSearch)만 예외로 끈 채 유지**
 * (엔진 기본값 꺼짐 — 체인 단계에 조율 후보가 섞이면 양해 당사자가 눈덩이).
 */
const COORD_ON = { includeCoordination: true } as const;

/**
 * §14-2 v2.1: 소스 셀 1개에 대해 등록된 **전 주**의 맞교환 후보를 한 번에 계산.
 * 그리드 인라인 하이라이트용 — 같은 주는 same-week 엔진, 나머지 주는 cross 엔진.
 * 오버레이(PENDING·초안)는 전 주에 공통 적용(기본 켜짐 권장 — 클릭 누적 위에서 탐색).
 */
export async function computeCandidatesAllWeeks(
  domain: string,
  requesterEmail: string,
  sourceWeekId: string,
  source: SwapSourceSlot,
  whatIf?: {
    includeMyPending?: boolean;
    includeDrafts?: boolean;
    // §14-4 직권 담기 누적분 — DB에 없는 화면 세션 상태라 호출부가 전량 명시 전달
    extraItems?: DirectPendingOverlayItem[];
    // 직권 화면처럼 보는 사람 ≠ 신청자일 때 감점 주어를 실명으로 (§3-2d 수집 21)
    thirdPerson?: boolean;
  }
): Promise<{
  sourceSubjectName: string;
  weeks: Array<{ weekId: string; startDate: string; swapCandidates: SwapCandidate[] }>;
  assumedPendingCount: number;
  assumedDraftCount: number;
  assumedExtraCount: number;
  error?: string;
}> {
  const sourceWeek = await loadWeek(domain, sourceWeekId);
  if (!sourceWeek) throw new Error(`등록되지 않은 주(${sourceWeekId})입니다.`);
  const term = await loadTimetableTerm(domain, sourceWeek.termId);
  if (!term) throw new Error(`학기(${sourceWeek.termId})를 찾을 수 없습니다.`);

  const engineOpts = { includeCoordination: true, thirdPerson: !!whatIf?.thirdPerson };

  const allWeeks = await listWeeks(domain, term.id);
  allWeeks.sort((a, b) => a.startDate.localeCompare(b.startDate));

  const wantWhatIf = !!(whatIf?.includeMyPending || whatIf?.includeDrafts);
  const overlay = wantWhatIf
    ? await loadMyVirtualOverlay(
        domain, requesterEmail, allWeeks.map((w) => w.id), whatIf!,
        { weekId: sourceWeekId, source }
      )
    : null;

  // §14-4: 직권 담기 누적분 가상 적용 — 현재 탐색 중인 소스 셀과 같은 항목은 제외(자기 충돌 방지)
  const { byWeek: extraByWeek, count: extraCount } = buildDirectExtraOverlay(
    whatIf?.extraItems, term.id, requesterEmail, allWeeks.map((w) => w.id),
    { weekId: sourceWeekId, source }
  );
  const virtualOf = (weekId: string): TimetableChange[] => [
    ...(overlay?.byWeek.get(weekId) || []),
    ...(extraByWeek.get(weekId) || []),
  ];

  // 설정 1회, 기초는 개정판 주차별 해석 (spec §E), 주별 합성 (computeMyProjectedWeeks와 동일 패턴)
  const [baseByWeek, settings] = await Promise.all([
    loadBaseGridsByWeek(domain, term.id, allWeeks.map((w) => w.startDate)),
    loadTimetableSettings(domain),
  ]);
  // 주별 changes 병렬 조회 (computeMyProjectedWeeks와 동일 이유)
  const changesByWeek = new Map(
    await Promise.all(
      allWeeks.map(async (w) => [w.id, await loadWeekChanges(domain, w.id)] as const)
    )
  );
  const synthByWeek = new Map<string, WeeklyClassGrid[]>();
  for (const week of allWeeks) {
    const changes = changesByWeek.get(week.id) || [];
    const virtual = virtualOf(week.id);
    const { grids } = synthesizeWeeklyGrids(baseByWeek.get(week.startDate)!, week, [...changes, ...virtual], settings);
    synthByWeek.set(week.id, grids);
  }

  // 조건부 태깅용 base(가상 합성 없는 확정 시간표) 합성 — 가상 변경이 없는 주는 동일 참조를 재사용해
  // 아래 후보 루프에서 참조 비교로 base 재계산 자체를 건너뛴다 (추가 DB 조회 없음, CPU만)
  const overlayCount = (overlay ? overlay.pendingCount + overlay.draftCount : 0) + extraCount;
  let baseSynthByWeek: Map<string, WeeklyClassGrid[]> | null = null;
  if (overlayCount > 0) {
    baseSynthByWeek = new Map();
    for (const week of allWeeks) {
      const virtual = virtualOf(week.id);
      baseSynthByWeek.set(
        week.id,
        virtual.length === 0
          ? synthByWeek.get(week.id)!
          : synthesizeWeeklyGrids(baseByWeek.get(week.startDate)!, week, changesByWeek.get(week.id) || [], settings).grids
      );
    }
  }

  const srcGrids = synthByWeek.get(sourceWeekId)!;
  const src = resolveSourceLesson(srcGrids, requesterEmail, source);
  if (!src.ok) {
    return {
      sourceSubjectName: "", weeks: [], error: src.error,
      assumedPendingCount: overlay?.pendingCount || 0, assumedDraftCount: overlay?.draftCount || 0,
      assumedExtraCount: extraCount,
    };
  }
  const sourceSubjectName = src.lesson!.subjectName;
  const fullSource: SwapSourceSlot = { ...source, subjectName: sourceSubjectName };

  // base에 없는 후보 = 내 대기·초안 승인을 전제로만 성립하는 조건부 후보 (base 계산 실패 시 전 후보 조건부)
  const keyOf = (c: SwapCandidate) => `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`;
  const markConditional = (cands: SwapCandidate[], baseCands: SwapCandidate[]): SwapCandidate[] => {
    const baseKeys = new Set(baseCands.map(keyOf));
    return cands.map((c) => (baseKeys.has(keyOf(c)) ? c : { ...c, conditional: true }));
  };

  const weeks: Array<{ weekId: string; startDate: string; swapCandidates: SwapCandidate[] }> = [];
  for (const week of allWeeks) {
    if (week.id === sourceWeekId) {
      const res = findSwapCandidates(srcGrids, sourceWeek, settings, requesterEmail, fullSource, engineOpts);
      // 소스 레벨 오류는 위 resolveSourceLesson에서 이미 걸렀으므로 여기 error는 후보 0건으로 취급
      let cands = res.candidates || [];
      const baseSrc = baseSynthByWeek?.get(sourceWeekId);
      if (baseSrc && baseSrc !== srcGrids) {
        const baseRes = findSwapCandidates(baseSrc, sourceWeek, settings, requesterEmail, fullSource, engineOpts);
        cands = markConditional(cands, baseRes.error ? [] : baseRes.candidates || []);
      }
      weeks.push({ weekId: week.id, startDate: week.startDate, swapCandidates: cands });
    } else {
      const tgtGrids = synthByWeek.get(week.id)!;
      const res = findCrossSwapCandidates(
        srcGrids, sourceWeek, tgtGrids, week, settings, requesterEmail, fullSource, engineOpts
      );
      let cands = res.candidates || [];
      const baseSrc = baseSynthByWeek?.get(sourceWeekId);
      const baseTgt = baseSynthByWeek?.get(week.id);
      if (baseSrc && baseTgt && (baseSrc !== srcGrids || baseTgt !== tgtGrids)) {
        const baseRes = findCrossSwapCandidates(
          baseSrc, sourceWeek, baseTgt, week, settings, requesterEmail, fullSource, engineOpts
        );
        cands = markConditional(cands, baseRes.error ? [] : baseRes.candidates || []);
      }
      weeks.push({ weekId: week.id, startDate: week.startDate, swapCandidates: cands });
    }
  }

  return {
    sourceSubjectName,
    weeks,
    assumedPendingCount: overlay?.pendingCount || 0,
    assumedDraftCount: overlay?.draftCount || 0,
    assumedExtraCount: extraCount,
  };
}

// ── 후보 탐색 (라우트 → 엔진 연결) ────────────────────────────

export async function computeCandidates(
  domain: string,
  requesterEmail: string,
  weekId: string,
  source: SwapSourceSlot,
  targetWeekId?: string,
  whatIf?: { includeMyPending?: boolean; includeDrafts?: boolean }
): Promise<{
  swapCandidates: SwapCandidate[];
  substituteCandidates: SubstituteCandidate[];
  sourceSubjectName: string;
  targetWeekId?: string;
  error?: string;
  // §14-1 가상 합성 부가 정보 (whatIf 요청 시에만)
  assumedPendingCount?: number;
  assumedDraftCount?: number;
  projectedDayLoads?: ProjectedDayLoad[]; // 소스 주 — 현재 검토 후보 미포함 (±1은 UI 계산)
  projectedTargetDayLoads?: ProjectedDayLoad[]; // 교차 주일 때 대상 주
}> {
  const week = await loadWeek(domain, weekId);
  if (!week) throw new Error(`등록되지 않은 주(${weekId})입니다.`);
  const term = await loadTimetableTerm(domain, week.termId);
  if (!term) throw new Error(`학기(${week.termId})를 찾을 수 없습니다.`);
  const settings = await loadTimetableSettings(domain);

  // §14-1: 본인 PENDING 신청(+선택 초안)을 가상 change로 겹쳐 누적 기준으로 계산
  const wantWhatIf = !!(whatIf?.includeMyPending || whatIf?.includeDrafts);
  const overlayWeekIds = [weekId, ...(targetWeekId && targetWeekId !== weekId ? [targetWeekId] : [])];
  const overlay = wantWhatIf
    ? await loadMyVirtualOverlay(domain, requesterEmail, overlayWeekIds, whatIf!, { weekId, source })
    : null;
  const whatIfExtras = overlay
    ? { assumedPendingCount: overlay.pendingCount, assumedDraftCount: overlay.draftCount }
    : {};

  const { grids } = await synthesizeWeek(domain, week, overlay?.byWeek.get(weekId));
  const src = resolveSourceLesson(grids, requesterEmail, source);
  if (!src.ok) {
    return { swapCandidates: [], substituteCandidates: [], sourceSubjectName: "", error: src.error };
  }
  const sourceSubjectName = src.lesson!.subjectName;
  const fullSource: SwapSourceSlot = { ...source, subjectName: sourceSubjectName };

  // 조건부 판별을 위해 base (가상 합성 없는 확정 시간표) 교환 후보 키 Set 추출 (overlay 항목이 1건 이상일 때만)
  let baseKeySet: Set<string> | null = null;
  const overlayCount = overlay ? (overlay.pendingCount + overlay.draftCount) : 0;
  if (overlayCount > 0) {
    // 기본값 빈 Set: base 계산이 실패하면(소스 수업 자체가 가상 이동분인 경우 등) 확정 시간표에는
    // 어떤 후보도 성립하지 않는 것이므로 전 후보를 조건부로 표시하는 것이 맞다
    baseKeySet = new Set();
    try {
      if (targetWeekId && targetWeekId !== weekId) {
        const targetWeekForBase = await loadWeek(domain, targetWeekId);
        if (targetWeekForBase && targetWeekForBase.termId === week.termId) {
          const { grids: baseGrids } = await synthesizeWeek(domain, week);
          const { grids: baseTargetGrids } = await synthesizeWeek(domain, targetWeekForBase);
          const baseCrossRes = findCrossSwapCandidates(
            baseGrids, week, baseTargetGrids, targetWeekForBase, settings, requesterEmail, fullSource, COORD_ON
          );
          if (!baseCrossRes.error) {
            baseKeySet = new Set(
              baseCrossRes.candidates.map(
                (c) => `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`
              )
            );
          }
        }
      } else {
        const { grids: baseGrids } = await synthesizeWeek(domain, week);
        const baseSwapRes = findSwapCandidates(baseGrids, week, settings, requesterEmail, fullSource, COORD_ON);
        if (!baseSwapRes.error) {
          baseKeySet = new Set(
            baseSwapRes.candidates.map(
              (c) => `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`
            )
          );
        }
      }
    } catch {
      // base 계산 실패 시 무시
    }
  }

  // ── 교차 주 맞교환 (§4-3b): 두 합성본 기준 별도 엔진. 특별보강은 교차 주 개념이 없음 ──
  if (targetWeekId && targetWeekId !== weekId) {
    const targetWeek = await loadWeek(domain, targetWeekId);
    if (!targetWeek) throw new Error(`등록되지 않은 주(${targetWeekId})입니다. 일과계가 먼저 주를 등록해야 교환할 수 있습니다.`);
    if (targetWeek.termId !== week.termId)
      throw new Error("다른 학기의 주와는 교환할 수 없습니다.");
    const { grids: targetGrids } = await synthesizeWeek(
      domain, targetWeek, overlay?.byWeek.get(targetWeekId)
    );
    const crossRes = findCrossSwapCandidates(
      grids, week, targetGrids, targetWeek, settings, requesterEmail, fullSource, COORD_ON
    );
    if (crossRes.error) {
      return {
        swapCandidates: [], substituteCandidates: [], sourceSubjectName, targetWeekId,
        error: crossRes.error,
      };
    }

    let finalCandidates = crossRes.candidates;
    if (baseKeySet) {
      finalCandidates = finalCandidates.map((c) => {
        const key = `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`;
        if (!baseKeySet!.has(key)) {
          return { ...c, conditional: true };
        }
        return c;
      });
    }

    return {
      swapCandidates: finalCandidates,
      substituteCandidates: [],
      sourceSubjectName,
      targetWeekId,
      ...(overlay
        ? {
            ...whatIfExtras,
            projectedDayLoads: countMyDayLoads(grids, requesterEmail),
            projectedTargetDayLoads: countMyDayLoads(targetGrids, requesterEmail),
          }
        : {}),
    };
  }

  const swapRes = findSwapCandidates(grids, week, settings, requesterEmail, fullSource, COORD_ON);
  // 소스 레벨 오류(블록 교사 등)는 두 후보 목록 모두에 대해 치명적 — 전파한다
  if (swapRes.error) {
    return { swapCandidates: [], substituteCandidates: [], sourceSubjectName, error: swapRes.error };
  }

  let finalCandidates = swapRes.candidates;
  if (baseKeySet) {
    finalCandidates = finalCandidates.map((c) => {
      const key = `${c.targetDay}-${c.targetPeriod}-${c.counterpartEmail.toLowerCase()}`;
      if (!baseKeySet!.has(key)) {
        return { ...c, conditional: true };
      }
      return c;
    });
  }

  const allTeachers = collectTermTeachers(term, grids);
  const termChanges = await loadTermChanges(domain, week.termId);
  const substituteTotals = countSubstituteTotals(termChanges);
  const subjectTeacherEmails = new Set(
    (term.subjects || [])
      .filter((s) => s.name === sourceSubjectName)
      .flatMap((s) => s.teacherEmails.map((e) => e.trim().toLowerCase()))
  );
  const subRes = findSubstituteCandidates(
    grids, week, settings, requesterEmail, fullSource,
    allTeachers, substituteTotals, subjectTeacherEmails
  );

  return {
    swapCandidates: finalCandidates,
    substituteCandidates: subRes.candidates,
    sourceSubjectName,
    ...(overlay
      ? { ...whatIfExtras, projectedDayLoads: countMyDayLoads(grids, requesterEmail) }
      : {}),
  };
}

// ── 신청 생성·조회·취소 (§5 서버 검증) ────────────────────────

function validateReason(reason: SwapRequestReason | undefined): SwapRequestReason {
  if (!reason || !SWAP_REASON_TYPES.includes(reason.type))
    throw new Error("신청 사유를 선택해야 합니다.");
  const note = (reason.note || "").trim();
  if (reason.type === "기타" && !note) throw new Error("기타 사유는 내용 입력이 필수입니다.");
  return { type: reason.type, ...(note ? { note } : {}) };
}

export async function createSwapRequest(
  domain: string,
  requesterEmail: string,
  params: {
    weekId: string;
    type: SwapRequestType;
    source: SwapSourceSlot;
    candidate: SwapCandidateSnapshot;
    reason?: SwapRequestReason;
    targetWeekId?: string; // 교차 주 맞교환 (§4-3b) — 없거나 weekId와 같으면 같은-주
    consent?: SwapConsentInput; // 조율 필요 후보의 양해 확인 (consent_swap_opening_spec §3) — 명단은 서버 도출
  },
  options?: { skipManagerNotify?: boolean; direct?: boolean; batchId?: string }
): Promise<SwapRequest> {
  const reason = validateReason(params.reason);
  const week = await loadWeek(domain, params.weekId);
  if (!week) throw new Error(`등록되지 않은 주(${params.weekId})입니다.`);

  const targetWeekId =
    params.targetWeekId && params.targetWeekId !== params.weekId ? params.targetWeekId : undefined;
  if (targetWeekId && params.type !== "swap")
    throw new Error("교차 주 교환은 맞교환만 가능합니다.");

  // 서버 재계산 검증: 클라이언트가 보낸 후보는 신뢰하지 않는다 (AGENTS.md §5 이중 방어)
  const computed = await computeCandidates(
    domain, requesterEmail, params.weekId, params.source, targetWeekId
  );
  if (computed.error) throw new Error(computed.error);

  let candidate: SwapCandidateSnapshot;
  let requesterName = requesterEmail.split("@")[0];
  if (params.type === "swap") {
    const match = computed.swapCandidates.find(
      (c) =>
        c.targetDay === params.candidate.targetDay &&
        c.targetPeriod === params.candidate.targetPeriod &&
        c.counterpartEmail === (params.candidate.counterpartEmail || "").trim().toLowerCase()
    );
    if (!match) {
      // 실패 시에만 whatIf: { includeMyPending: true, includeDrafts: false }로 한 번 더 계산해, 거기에 해당 후보가 존재하면 구분된 사유 던짐
      try {
        const whatIfComputed = await computeCandidates(
          domain,
          requesterEmail,
          params.weekId,
          params.source,
          targetWeekId,
          { includeMyPending: true, includeDrafts: false }
        );
        const conditionalMatch = whatIfComputed.swapCandidates.find(
          (c) =>
            c.targetDay === params.candidate.targetDay &&
            c.targetPeriod === params.candidate.targetPeriod &&
            c.counterpartEmail === (params.candidate.counterpartEmail || "").trim().toLowerCase()
        );
        if (conditionalMatch) {
          throw new Error(
            "이 후보는 본인의 다른 대기 신청이 승인되어야 성립하는 조건부 후보입니다. 해당 신청이 승인된 뒤 다시 신청해 주세요."
          );
        }
      } catch (e: any) {
        if (e.message.includes("조건부 후보입니다")) throw e;
      }
      throw new Error("선택한 후보가 더 이상 유효하지 않습니다. 후보를 다시 조회해 주세요.");
    }
    candidate = { ...match, ...(targetWeekId ? { targetWeekId } : {}) }; // 서버 계산값 스냅샷 (점수·감점 포함)
  } else {
    const match = computed.substituteCandidates.find(
      (c) => c.teacherEmail === (params.candidate.counterpartEmail || "").trim().toLowerCase()
    );
    if (!match) throw new Error("선택한 보강 교사가 더 이상 공강이 아닙니다. 후보를 다시 조회해 주세요.");
    candidate = {
      counterpartEmail: match.teacherEmail,
      counterpartName: match.teacherName,
      score: 0,
      penalties: [],
    };
  }

  // ── 조율 필요 후보 양해 검증 (consent_swap_opening_spec §3-1) ──
  // parties는 서버 재계산된 coordination에서 도출 — 신청 body의 명단은 받지도 않는다 (AGENTS.md §5).
  let consentRecord: SwapConsent | undefined;
  if (candidate.coordination) {
    if (params.consent?.confirmed !== true) {
      throw new Error(
        "이 후보는 당사자 양해가 필요합니다. 해당 선생님께 양해를 받은 뒤 확인란을 체크해 주세요."
      );
    }
    const partyMap = new Map<string, string>();
    for (const conf of candidate.coordination.conflicts) {
      for (const o of conf.occupants) {
        if (!partyMap.has(o.teacherEmail)) partyMap.set(o.teacherEmail, o.teacherName);
      }
    }
    const consentNote = (params.consent.note || "").trim().slice(0, 200);
    consentRecord = {
      confirmed: true,
      parties: [...partyMap.entries()].map(([email, name]) => ({ email, name })),
      ...(consentNote ? { note: consentNote } : {}),
      confirmedAt: Date.now(),
    };
  }

  // 신청자 실명: 합성본의 본인 lesson에서 추출
  const { grids } = await synthesizeWeek(domain, week);
  const src = resolveSourceLesson(grids, requesterEmail, params.source);
  if (src.ok && src.lesson) requesterName = src.lesson.teachers[0]?.name || requesterName;

  // 같은 소스 셀 중복 PENDING 차단
  const dupSnap = await swapRequestsColRef(domain)
    .where("weekId", "==", params.weekId)
    .where("requesterEmail", "==", requesterEmail.toLowerCase())
    .where("status", "==", "PENDING")
    .get();
  const dup = dupSnap.docs.some((d) => {
    const s = (d.data() as SwapRequest).source;
    return (
      s.grade === params.source.grade && s.classNum === params.source.classNum &&
      s.day === params.source.day && s.period === params.source.period
    );
  });
  if (dup) throw new Error("같은 수업에 대해 이미 대기 중인 신청이 있습니다.");

  const ref = swapRequestsColRef(domain).doc();
  const request: SwapRequest = {
    id: ref.id,
    termId: week.termId,
    weekId: params.weekId,
    type: params.type,
    ...(targetWeekId ? { targetWeekId } : {}),
    requesterEmail: requesterEmail.toLowerCase(),
    requesterName,
    source: { ...params.source, subjectName: computed.sourceSubjectName },
    candidate,
    reason,
    status: "PENDING",
    createdAt: Date.now(),
    ...(options?.direct ? { direct: true } : {}),
    ...(options?.batchId ? { batchId: options.batchId } : {}),
    ...(consentRecord ? { consent: consentRecord } : {}),
  };
  await ref.set(request);

  // 알림: 일과계에게 (실패해도 신청은 유효). 직권 흐름은 관리자 본인이 만들었으므로 생략
  if (options?.skipManagerNotify) return request;
  const settings = await loadTimetableSettings(domain);
  const dayNames = ["", "월", "화", "수", "목", "금"];
  const summary =
    `📋 새 수업교환 신청\n` +
    `신청자: ${requesterName} (${requesterEmail})\n` +
    `대상: ${request.source.grade}-${request.source.classNum} ${dayNames[request.source.day]} ${request.source.period}교시 ${request.source.subjectName}\n` +
    `유형: ${params.type === "swap" ? `맞교환 (상대: ${candidate.counterpartName})` : `특별보강 (보강: ${candidate.counterpartName})`}${targetWeekId ? `\n교차 주 교환: ${targetWeekId} 주 ${dayNames[candidate.targetDay || 0]} ${candidate.targetPeriod}교시와 맞교환` : ""}\n` +
    `사유: ${reason.type}${reason.note ? ` — ${reason.note}` : ""}` +
    (consentRecord
      ? `\n🤝 양해 확인됨: ${consentRecord.parties.map((p) => p.name).join(", ")}${consentRecord.note ? ` — ${consentRecord.note}` : ""}`
      : "");
  for (const manager of settings.managerEmails) {
    try {
      await sendGoogleChat(manager, summary);
    } catch (e: any) {
      console.error(`[swap_request] 일과계 알림 실패 (${manager}):`, e.message);
    }
  }

  return request;
}

/**
 * 장바구니 일괄 제출 요약 알림 (§14-2) — 항목별 개별 DM 대신 일과계에 1건만 보낸다.
 * (개별 create는 skipManagerNotify로 호출되므로 이 함수가 유일한 알림 경로)
 */
export async function notifySwapBatchToManagers(
  domain: string,
  requesterName: string,
  requesterEmail: string,
  createdCount: number,
  totalCount: number
): Promise<void> {
  const settings = await loadTimetableSettings(domain);
  const msg =
    `📋 수업교환 일괄 신청 접수\n` +
    `신청자: ${requesterName} (${requesterEmail})\n` +
    `접수: ${createdCount}건${createdCount < totalCount ? ` (제출 ${totalCount}건 중 ${totalCount - createdCount}건 재검증 탈락)` : ""}\n` +
    `요청대장에서 묶음으로 확인할 수 있습니다.`;
  for (const manager of settings.managerEmails) {
    try {
      await sendGoogleChat(manager, msg);
    } catch (e: any) {
      console.error(`[swap_batch] 일과계 알림 실패 (${manager}):`, e.message);
    }
  }
}

export async function listSwapRequests(
  domain: string,
  filter: { weekId?: string; status?: string; requesterEmail?: string }
): Promise<SwapRequest[]> {
  let q: FirebaseFirestore.Query = swapRequestsColRef(domain);
  if (filter.weekId) q = q.where("weekId", "==", filter.weekId);
  if (filter.status) q = q.where("status", "==", filter.status);
  if (filter.requesterEmail) q = q.where("requesterEmail", "==", filter.requesterEmail.toLowerCase());
  const snap = await q.get();
  return snap.docs
    .map((d) => ({ ...(d.data() as SwapRequest), id: d.id }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ── 교사 체인 신청 (consent_swap_opening_spec §4-3) ───────────

/** 체인 단계열의 동일성 서명 — computeChainSearch pushChain의 중복 키와 같은 형식 */
function chainSignature(steps: ChainStepItem[]): string {
  return steps
    .map((s) => `${s.weekId}:${s.source.day}-${s.source.period}>${s.candidate.targetDay}-${s.candidate.targetPeriod}:${s.candidate.counterpartEmail}`)
    .join("|");
}

/**
 * 체인 신청 생성 — 후보 위조 차단을 위해 서버가 체인을 재탐색해 제출 단계열과 대조하고,
 * **서버 계산 스냅샷**을 원장에 저장한다 (create 재검증과 같은 정신). 체인은 다른 교사 명의의
 * 수업 이동을 포함하므로 관련 교사 전원의 양해(consent)가 필수 — parties는 서버 도출.
 */
export async function createChainSwapRequest(
  domain: string,
  requesterEmail: string,
  params: {
    weekId: string;
    source: { grade: number; classNum: number; day: number; period: number };
    chainTarget: { weekId?: string; day: number; period: number };
    steps: ChainStepItem[];
    reason?: SwapRequestReason;
    consent?: SwapConsentInput;
  },
  options?: { skipManagerNotify?: boolean } // 검증 스크립트 전용 — 라우트는 항상 알림
): Promise<SwapRequest> {
  const reason = validateReason(params.reason);
  const week = await loadWeek(domain, params.weekId);
  if (!week) throw new Error(`등록되지 않은 주(${params.weekId})입니다.`);
  if (!Array.isArray(params.steps) || params.steps.length < 1 || params.steps.length > 3)
    throw new Error("체인 단계는 1~3단계여야 합니다.");

  // 서버 재탐색 대조 — 소유 검증(requesterEmail)은 computeChainSearch가 수행
  const search = await computeChainSearch(domain, {
    weekId: params.weekId,
    source: params.source,
    target: params.chainTarget,
    maxDepth: params.steps.length,
    requesterEmail,
  });
  if (search.error) throw new Error(search.error);
  const wanted = chainSignature(params.steps);
  const serverChain = search.chains.find((c) => chainSignature(c.steps) === wanted);
  if (!serverChain)
    throw new Error("선택한 체인이 더 이상 유효하지 않습니다. 체인을 다시 탐색해 주세요.");

  // 양해 필수 — 당사자 = 체인의 전 관련 교사 (단계 소스 담당 + 맞교환 상대, 본인 제외), 서버 도출
  if (params.consent?.confirmed !== true)
    throw new Error("체인 교체는 관련 선생님 전원의 양해가 필요합니다. 양해를 받은 뒤 확인란을 체크해 주세요.");
  const me = requesterEmail.trim().toLowerCase();
  const partyMap = new Map<string, string>();
  for (const s of serverChain.steps) {
    const src = s.sourceTeacherEmail.trim().toLowerCase();
    if (src !== me && !partyMap.has(src)) partyMap.set(src, s.sourceTeacherName);
    const cp = s.candidate.counterpartEmail.trim().toLowerCase();
    if (cp !== me && !partyMap.has(cp)) partyMap.set(cp, s.candidate.counterpartName);
  }
  const consentNote = (params.consent.note || "").trim().slice(0, 200);
  const consent: SwapConsent = {
    confirmed: true,
    parties: [...partyMap.entries()].map(([email, name]) => ({ email, name })),
    ...(consentNote ? { note: consentNote } : {}),
    confirmedAt: Date.now(),
  };

  // 같은 소스 셀 중복 PENDING 차단 (기존 create와 동일 규칙)
  const dupSnap = await swapRequestsColRef(domain)
    .where("weekId", "==", params.weekId)
    .where("requesterEmail", "==", me)
    .where("status", "==", "PENDING")
    .get();
  const dup = dupSnap.docs.some((d) => {
    const s = (d.data() as SwapRequest).source;
    return (
      s.grade === params.source.grade && s.classNum === params.source.classNum &&
      s.day === params.source.day && s.period === params.source.period
    );
  });
  if (dup) throw new Error("같은 수업에 대해 이미 대기 중인 신청이 있습니다.");

  const mover = search.sourceTeacher!;
  const last = serverChain.steps[serverChain.steps.length - 1];
  const targetWeekId =
    params.chainTarget.weekId && params.chainTarget.weekId !== params.weekId
      ? params.chainTarget.weekId
      : undefined;
  const ref = swapRequestsColRef(domain).doc();
  const request: SwapRequest = {
    id: ref.id,
    termId: week.termId,
    weekId: params.weekId,
    type: "chain",
    requesterEmail: me,
    requesterName: mover.teacherName,
    source: { ...params.source, subjectName: mover.subjectName },
    // 사람용 요약 스냅샷 — 목적지 슬롯 + 마지막 단계 상대 (상세는 chainSteps)
    candidate: {
      targetDay: params.chainTarget.day,
      targetPeriod: params.chainTarget.period,
      ...(targetWeekId ? { targetWeekId } : {}),
      counterpartEmail: last.candidate.counterpartEmail,
      counterpartName: last.candidate.counterpartName,
      score: serverChain.totalScore,
      penalties: serverChain.steps.map((s) => s.stepSummary),
    },
    chainSteps: serverChain.steps,
    chainTarget: {
      ...(targetWeekId ? { weekId: targetWeekId } : {}),
      day: params.chainTarget.day,
      period: params.chainTarget.period,
    },
    reason,
    status: "PENDING",
    createdAt: Date.now(),
    consent,
  };
  await ref.set(request);

  // 일과계 알림 (기존 create와 동일 채널)
  if (options?.skipManagerNotify) return request;
  const settings = await loadTimetableSettings(domain);
  const summary =
    `📋 새 수업교환 신청 (🔗 징검다리 ${serverChain.steps.length}단계)\n` +
    `신청자: ${mover.teacherName} (${me})\n` +
    `${serverChain.summary}\n` +
    `🤝 양해 확인됨: ${consent.parties.map((p) => p.name).join(", ")}${consent.note ? ` — ${consent.note}` : ""}\n` +
    `사유: ${reason.type}${reason.note ? ` — ${reason.note}` : ""}`;
  for (const manager of settings.managerEmails) {
    try {
      await sendGoogleChat(manager, summary);
    } catch (e: any) {
      console.error(`[chain_create] 일과계 알림 실패 (${manager}):`, e.message);
    }
  }
  return request;
}

/**
 * 요청대장 사전 검증: PENDING 신청이 현재 확정 시간표 기준으로 여전히 성립하는지.
 * 승인 트랜잭션(approveSwapRequest)의 재검증과 같은 규칙을 목록 시점에 미리 돌려,
 * 먼저 승인된 다른 건 때문에 이미 불가능해진 신청을 일과계가 화면에서 바로 보게 한다.
 * (실제 차단은 여전히 승인 트랜잭션이 담당 — 여기는 표시용이라 트랜잭션 불필요)
 */
export async function validatePendingSwapRequests(
  domain: string,
  requests: SwapRequest[]
): Promise<Record<string, { ok: boolean; reason?: string }>> {
  const out: Record<string, { ok: boolean; reason?: string }> = {};
  const pendings = requests.filter((r) => r.status === "PENDING");
  if (pendings.length === 0) return out;

  const settings = await loadTimetableSettings(domain);
  // 관련 주 합성본은 주당 1회만 (병렬 로드). 기초는 개정판 주차별 해석 (spec §E) —
  // weekId = 주 시작일이므로 학기별로 loadBaseGridsByWeek 1회면 충분하다.
  const weekIds = Array.from(new Set(pendings.flatMap((r) => [r.weekId, r.targetWeekId || r.weekId])));
  const baseByTermWeek = new Map<string, Map<string, ClassGrid[]>>();
  for (const termId of new Set(pendings.map((r) => r.termId))) {
    baseByTermWeek.set(termId, await loadBaseGridsByWeek(domain, termId, weekIds));
  }
  const weekObjs = new Map<string, TimetableWeek | null>();
  const gridsByWeek = new Map<string, WeeklyClassGrid[]>();
  await Promise.all(
    weekIds.map(async (wid) => {
      const [w, changes] = await Promise.all([loadWeek(domain, wid), loadWeekChanges(domain, wid)]);
      weekObjs.set(wid, w);
      const base = w ? baseByTermWeek.get(w.termId)?.get(w.startDate) : null;
      if (w && base) gridsByWeek.set(wid, synthesizeWeeklyGrids(base, w, changes, settings).grids);
    })
  );

  for (const r of pendings) {
    try {
      const week = weekObjs.get(r.weekId);
      const grids = gridsByWeek.get(r.weekId);
      if (!week || !grids) {
        out[r.id] = { ok: false, reason: `주(${r.weekId}) 등록이 삭제되어 승인할 수 없습니다.` };
        continue;
      }
      const src = resolveSourceLesson(grids, r.requesterEmail, r.source);
      if (!src.ok) {
        out[r.id] = { ok: false, reason: src.error || "원래 수업이 다른 변경으로 이미 이동/변경되었습니다." };
        continue;
      }
      if (r.type === "substitute") {
        // 특별보강은 소스 수업 성립만 사전 확인 (보강 교사 가용성은 승인 트랜잭션에서 재검증)
        out[r.id] = { ok: true };
        continue;
      }
      if (r.type === "chain") {
        // 체인은 단계별 가상 누적 위 재검증이 필요해(뒤 단계 소스가 앞 단계 이동 후 위치)
        // 목록 시점엔 신청자 소스 성립(위에서 통과)까지만 — 전량 재검증은 승인 트랜잭션 몫 (§4-3)
        out[r.id] = { ok: true };
        continue;
      }
      const fullSource: SwapSourceSlot = { ...r.source, subjectName: src.lesson!.subjectName };
      const isCross = !!r.targetWeekId && r.targetWeekId !== r.weekId;
      let stillValid = false;
      let engineError: string | undefined;
      if (!isCross) {
        const res = findSwapCandidates(grids, week, settings, r.requesterEmail, fullSource, COORD_ON);
        engineError = res.error;
        stillValid = !res.error && (res.candidates || []).some(
          (c) =>
            c.targetDay === r.candidate.targetDay &&
            c.targetPeriod === r.candidate.targetPeriod &&
            c.counterpartEmail === r.candidate.counterpartEmail
        );
      } else {
        const tWeek = weekObjs.get(r.targetWeekId!);
        const tGrids = gridsByWeek.get(r.targetWeekId!);
        if (!tWeek || !tGrids) {
          out[r.id] = { ok: false, reason: `대상 주(${r.targetWeekId}) 등록이 삭제되어 승인할 수 없습니다.` };
          continue;
        }
        const res = findCrossSwapCandidates(grids, week, tGrids, tWeek, settings, r.requesterEmail, fullSource, COORD_ON);
        engineError = res.error;
        stillValid = !res.error && (res.candidates || []).some(
          (c) =>
            c.targetDay === r.candidate.targetDay &&
            c.targetPeriod === r.candidate.targetPeriod &&
            c.counterpartEmail === r.candidate.counterpartEmail
        );
      }
      out[r.id] = stillValid
        ? { ok: true }
        : { ok: false, reason: engineError || "먼저 승인된 다른 변경으로 이 교체안이 더 이상 성립하지 않습니다." };
    } catch (e: any) {
      out[r.id] = { ok: false, reason: e?.message || "사전 검증 중 오류가 발생했습니다." };
    }
  }
  return out;
}

export async function cancelSwapRequest(
  domain: string,
  requesterEmail: string,
  requestId: string
): Promise<SwapRequest> {
  const ref = swapRequestsColRef(domain).doc(requestId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("신청을 찾을 수 없습니다.");
    const req = snap.data() as SwapRequest;
    if (req.requesterEmail !== requesterEmail.toLowerCase())
      throw new Error("본인의 신청만 취소할 수 있습니다.");
    if (req.status !== "PENDING") throw new Error("대기 중인 신청만 취소할 수 있습니다.");
    tx.update(ref, { status: "CANCELED", decidedAt: Date.now() });
    return { ...req, id: requestId, status: "CANCELED" as const };
  });
}

// ── 승인·반려·취소(revert) — §5 트랜잭션 ──────────────────────

/**
 * 승인: Firestore 트랜잭션 안에서 그 주 changes를 다시 읽고 후보를 재검증한다.
 * 다른 승인으로 상황이 바뀌었으면 실패 — 승인 간 경합이 유일한 동시성 위험 지점(§5).
 */
export async function approveSwapRequest(
  domain: string,
  managerEmail: string,
  requestId: string,
  options?: { skipNotify?: boolean } // 검증 스크립트 전용 — 라우트·직권 경로는 항상 알림
): Promise<{ request: SwapRequest; change: TimetableChange }> {
  // 기초 그리드·설정·주는 승인 중 변하지 않으므로 트랜잭션 밖에서 읽는다.
  const reqSnapPre = await swapRequestsColRef(domain).doc(requestId).get();
  if (!reqSnapPre.exists) throw new Error("신청을 찾을 수 없습니다.");
  const reqPre = reqSnapPre.data() as SwapRequest;
  const [week, settings] = await Promise.all([
    loadWeek(domain, reqPre.weekId),
    loadTimetableSettings(domain),
  ]);
  if (!week) throw new Error(`등록되지 않은 주(${reqPre.weekId})입니다.`);

  // 교차 주 (§4-3b): 대상 주 문서도 트랜잭션 밖에서 읽는다 (주 문서는 승인 중 불변)
  const isCross = !!reqPre.targetWeekId && reqPre.targetWeekId !== reqPre.weekId;
  const targetWeek = isCross ? await loadWeek(domain, reqPre.targetWeekId!) : null;
  if (isCross && !targetWeek)
    throw new Error(`등록되지 않은 주(${reqPre.targetWeekId})입니다. 대상 주 등록이 삭제되어 승인할 수 없습니다.`);

  // 체인(consent_swap_opening_spec §4-3): 단계들이 걸치는 모든 주 문서를 트랜잭션 밖에서 로드
  const chainWeekIds =
    reqPre.type === "chain"
      ? Array.from(new Set([
          reqPre.weekId,
          ...(reqPre.chainSteps || []).flatMap((s) => [s.weekId, ...(s.targetWeekId ? [s.targetWeekId] : [])]),
        ]))
      : [];
  const chainWeeks = new Map<string, TimetableWeek>();
  for (const wid of chainWeekIds) {
    const w = wid === reqPre.weekId ? week : await loadWeek(domain, wid);
    if (!w)
      throw new Error(`등록되지 않은 주(${wid})입니다. 체인 대상 주 등록이 삭제되어 승인할 수 없습니다.`);
    chainWeeks.set(wid, w);
  }

  // 기초는 개정판 주차별 해석 (spec §E) — 교차 주·체인은 주별 기초판이 다를 수 있다
  const baseDates = [
    week.startDate,
    ...(targetWeek ? [targetWeek.startDate] : []),
    ...[...chainWeeks.values()].map((w) => w.startDate),
  ];
  const baseByWeekMap = await loadBaseGridsByWeek(domain, reqPre.termId, baseDates);
  const baseGrids = baseByWeekMap.get(week.startDate)!;
  const targetBaseGrids = targetWeek ? baseByWeekMap.get(targetWeek.startDate)! : null;

  const result = await adminDb.runTransaction(async (tx) => {
    const reqRef = swapRequestsColRef(domain).doc(requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new Error("신청을 찾을 수 없습니다.");
    const request = { ...(reqSnap.data() as SwapRequest), id: requestId };
    if (request.status !== "PENDING") throw new Error("대기 중인 신청만 승인할 수 있습니다.");

    const changesSnap = await tx.get(
      timetableChangesColRef(domain).where("weekId", "==", request.weekId)
    );
    const changes = changesSnap.docs
      .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
      .sort((a, b) => a.appliedAt - b.appliedAt);

    // 교차 주: 대상 주 changes도 트랜잭션 안에서 재읽기 (양주 재검증 — §4-3b)
    let targetChanges: TimetableChange[] = [];
    if (isCross) {
      const targetChangesSnap = await tx.get(
        timetableChangesColRef(domain).where("weekId", "==", request.targetWeekId!)
      );
      targetChanges = targetChangesSnap.docs
        .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
        .sort((a, b) => a.appliedAt - b.appliedAt);
    }

    // 트랜잭션 내 재검증: 현재 오버레이 기준으로 후보가 여전히 성립하는가
    const { grids } = synthesizeWeeklyGrids(baseGrids, week, changes, settings);
    const src = resolveSourceLesson(grids, request.requesterEmail, request.source);
    if (!src.ok) throw new Error(`승인 불가 — ${src.error} 신청자의 재신청이 필요합니다.`);

    // ── 체인 승인 (consent_swap_opening_spec §4-3): 단계 순차 재검증(가상 누적) → 전 단계
    //    단일 트랜잭션 원자 커밋. 부분 성공 금지 — 체인은 단계 의존적이라 중간까지만 실행되면
    //    시간표가 어정쩡하게 남는다 (직권 batch의 부분 성공 원칙과 다른 이유). ──
    if (request.type === "chain") {
      const steps = request.chainSteps || [];
      if (steps.length === 0) throw new Error("체인 단계 정보가 없습니다.");
      if (!request.consent?.confirmed)
        throw new Error("승인 불가 — 체인 교체는 관련 교사 전원의 양해 기록이 필요합니다. 신청자의 재신청이 필요합니다.");

      // 관련 주 changes 전부 재읽기 — 트랜잭션 규칙상 모든 read를 write 전에 수행
      const chainChanges = new Map<string, TimetableChange[]>();
      chainChanges.set(request.weekId, changes);
      for (const wid of chainWeekIds) {
        if (wid === request.weekId) continue;
        const snap = await tx.get(timetableChangesColRef(domain).where("weekId", "==", wid));
        chainChanges.set(
          wid,
          snap.docs
            .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
            .sort((a, b) => a.appliedAt - b.appliedAt)
        );
      }

      // 검증된 앞 단계를 가상 오버레이로 누적하며 각 단계를 엔진으로 재검증 —
      // computeChainSearch의 탐색 구성과 동일한 방식이라 판정이 어긋날 수 없다
      const virtualByWeek = new Map<string, TimetableChange[]>();
      const synthChain = (wid: string): WeeklyClassGrid[] => {
        const w = chainWeeks.get(wid)!;
        return synthesizeWeeklyGrids(
          baseByWeekMap.get(w.startDate)!,
          w,
          [...(chainChanges.get(wid) || []), ...(virtualByWeek.get(wid) || [])],
          settings
        ).grids;
      };

      const now = Date.now();
      const futureBase = now + 30_000_000;
      const newChanges: TimetableChange[] = [];
      const changeRefs: FirebaseFirestore.DocumentReference[] = [];

      steps.forEach((step, i) => {
        const stepNo = i + 1;
        const sGrids = synthChain(step.weekId);
        const stepSrc = resolveDirectSource(sGrids, step.source);
        if (
          !stepSrc.ok ||
          stepSrc.info.teacherEmail !== step.sourceTeacherEmail ||
          stepSrc.info.subjectName !== step.source.subjectName
        )
          throw new Error(`승인 불가 — ${stepNo}단계 수업이 다른 변경으로 바뀌었습니다. 신청자의 재신청이 필요합니다.`);

        const isCrossStep = step.type === "cross_swap" && !!step.targetWeekId;
        const sWeek = chainWeeks.get(step.weekId)!;
        const stepSource: SwapSourceSlot = { ...step.source };
        let still: SwapCandidate | undefined;
        let counterpartLesson: WeeklyLesson | undefined;
        if (!isCrossStep) {
          const r = findSwapCandidates(sGrids, sWeek, settings, step.sourceTeacherEmail, stepSource);
          if (r.error) throw new Error(`승인 불가 — ${stepNo}단계: ${r.error}`);
          still = r.candidates.find(
            (c) =>
              c.targetDay === step.candidate.targetDay &&
              c.targetPeriod === step.candidate.targetPeriod &&
              c.counterpartEmail === step.candidate.counterpartEmail
          );
        } else {
          const tGrids = synthChain(step.targetWeekId!);
          const tWeek = chainWeeks.get(step.targetWeekId!)!;
          const r = findCrossSwapCandidates(
            sGrids, sWeek, tGrids, tWeek, settings, step.sourceTeacherEmail, stepSource
          );
          if (r.error) throw new Error(`승인 불가 — ${stepNo}단계: ${r.error}`);
          still = r.candidates.find(
            (c) =>
              c.targetDay === step.candidate.targetDay &&
              c.targetPeriod === step.candidate.targetPeriod &&
              c.counterpartEmail === step.candidate.counterpartEmail
          );
          if (still) {
            counterpartLesson = tGrids
              .find((g) => g.grade === step.source.grade && g.classNum === step.source.classNum)
              ?.cells.find((c) => c.day === still!.targetDay && c.period === still!.targetPeriod)
              ?.lessons[0];
          }
        }
        if (!still)
          throw new Error(
            `승인 불가 — ${stepNo}단계 교환이 더 이상 성립하지 않습니다 (${step.stepSummary}). 신청자의 재신청이 필요합니다.`
          );

        // 실 change 조립 — 단건 승인과 동일 문서 형태, appliedAt은 단계 순서 보존(now + i)
        const appliedAt = now + i;
        if (!isCrossStep) {
          const ref = timetableChangesColRef(domain).doc();
          newChanges.push({
            id: ref.id,
            termId: request.termId,
            weekId: step.weekId,
            type: "swap",
            requestId,
            swap: {
              grade: step.source.grade,
              classNum: step.source.classNum,
              a: {
                day: step.source.day,
                period: step.source.period,
                subjectName: step.source.subjectName,
                teacherEmail: step.sourceTeacherEmail,
                teacherName: step.sourceTeacherName,
              },
              b: {
                day: still.targetDay,
                period: still.targetPeriod,
                subjectName: still.counterpartSubjectName,
                teacherEmail: still.counterpartEmail,
                teacherName: still.counterpartName,
              },
            },
            appliedBy: managerEmail.toLowerCase(),
            appliedAt,
          });
          changeRefs.push(ref);
        } else {
          const myLesson = sGrids
            .find((g) => g.grade === step.source.grade && g.classNum === step.source.classNum)!
            .cells.find((c) => c.day === step.source.day && c.period === step.source.period)!
            .lessons[0];
          const myRef: CrossSwapLessonRef = {
            subjectName: step.source.subjectName,
            subjectShort: myLesson.subjectShort,
            teacherEmail: step.sourceTeacherEmail,
            teacherName: step.sourceTeacherName,
            ...(myLesson.room ? { room: myLesson.room } : {}),
          };
          const otherRef: CrossSwapLessonRef = {
            subjectName: counterpartLesson!.subjectName,
            subjectShort: counterpartLesson!.subjectShort,
            teacherEmail: still.counterpartEmail,
            teacherName: still.counterpartName,
            ...(counterpartLesson!.room ? { room: counterpartLesson!.room } : {}),
          };
          const exchangeId = timetableChangesColRef(domain).doc().id;
          const refA = timetableChangesColRef(domain).doc();
          const refB = timetableChangesColRef(domain).doc();
          const common = {
            termId: request.termId,
            type: "cross_swap" as const,
            requestId,
            appliedBy: managerEmail.toLowerCase(),
            appliedAt,
          };
          newChanges.push(
            {
              id: refA.id, weekId: step.weekId, ...common,
              crossSwap: {
                exchangeId, otherWeekId: step.targetWeekId!,
                grade: step.source.grade, classNum: step.source.classNum,
                day: step.source.day, period: step.source.period,
                out: myRef, in: otherRef,
              },
            },
            {
              id: refB.id, weekId: step.targetWeekId!, ...common,
              crossSwap: {
                exchangeId, otherWeekId: step.weekId,
                grade: step.source.grade, classNum: step.source.classNum,
                day: still.targetDay, period: still.targetPeriod,
                out: otherRef, in: myRef,
              },
            }
          );
          changeRefs.push(refA, refB);
        }

        // 다음 단계 재검증용 가상 오버레이 누적 (futureBase + i — 실 변경 뒤·단계 순서 보존)
        const it: VirtualSwapItem = {
          key: `appr-${i}`,
          termId: request.termId,
          weekId: step.weekId,
          ...(step.targetWeekId ? { targetWeekId: step.targetWeekId } : {}),
          type: step.type,
          requesterEmail: step.sourceTeacherEmail,
          requesterName: step.sourceTeacherName,
          source: stepSource,
          candidate: {
            targetDay: still.targetDay,
            targetPeriod: still.targetPeriod,
            ...(step.targetWeekId ? { targetWeekId: step.targetWeekId } : {}),
            counterpartEmail: still.counterpartEmail,
            counterpartName: still.counterpartName,
            counterpartSubjectName: still.counterpartSubjectName,
            score: still.score,
            penalties: still.penalties,
          },
        };
        for (const wid of chainWeekIds) {
          const chs = buildVirtualChanges(it, wid, futureBase + i);
          if (chs.length) virtualByWeek.set(wid, [...(virtualByWeek.get(wid) || []), ...chs]);
        }
      });

      newChanges.forEach((c, idx) => tx.set(changeRefs[idx], c));
      tx.update(reqRef, {
        status: "APPROVED",
        decidedBy: managerEmail.toLowerCase(),
        decidedAt: now,
        appliedChangeIds: newChanges.map((c) => c.id),
      });
      return {
        request: { ...request, status: "APPROVED" as const, appliedChangeIds: newChanges.map((c) => c.id) },
        change: newChanges[0],
      };
    }

    // ── 교차 주 맞교환 승인: 양방향 재검증 → 문서쌍(exchangeId) 원자 커밋 (§4-3b) ──
    if (isCross) {
      const cand = request.candidate;
      const { grids: targetGrids } = synthesizeWeeklyGrids(targetBaseGrids || baseGrids, targetWeek!, targetChanges, settings);
      const crossRes = findCrossSwapCandidates(
        grids, week, targetGrids, targetWeek!, settings, request.requesterEmail, request.source, COORD_ON
      );
      if (crossRes.error) throw new Error(`승인 불가 — ${crossRes.error} 신청자의 재신청이 필요합니다.`);
      const still = crossRes.candidates.find(
        (c) =>
          c.targetDay === cand.targetDay &&
          c.targetPeriod === cand.targetPeriod &&
          c.counterpartEmail === cand.counterpartEmail
      );
      if (!still)
        throw new Error("승인 불가 — 다른 변경으로 상황이 바뀌어 후보가 더 이상 유효하지 않습니다. 신청자의 재신청이 필요합니다.");
      // 조율 필요 후보(특별실 충돌)는 양해 기록이 있어야 승인 가능 — 신청 후 상황 변화로
      // 깨끗했던 후보가 조율 필요로 바뀐 경우도 여기서 걸린다 (consent_swap_opening_spec §2-3)
      if (still.coordination && !request.consent?.confirmed)
        throw new Error("승인 불가 — 이 교체안은 당사자 양해가 필요한 상태인데 양해 기록이 없습니다. 신청자의 재신청이 필요합니다.");

      // 상대 수업 전체 정보(약칭·특별실)는 재검증된 대상 주 합성본 셀에서 직접 읽는다
      const targetGrid = targetGrids.find(
        (g) => g.grade === request.source.grade && g.classNum === request.source.classNum
      )!;
      const counterpartLesson = targetGrid.cells.find(
        (c) => c.day === still.targetDay && c.period === still.targetPeriod
      )!.lessons[0];

      const myRef: CrossSwapLessonRef = {
        subjectName: src.lesson!.subjectName,
        subjectShort: src.lesson!.subjectShort,
        teacherEmail: request.requesterEmail,
        teacherName: request.requesterName,
        ...(src.lesson!.room ? { room: src.lesson!.room } : {}),
      };
      const otherRef: CrossSwapLessonRef = {
        subjectName: counterpartLesson.subjectName,
        subjectShort: counterpartLesson.subjectShort,
        teacherEmail: still.counterpartEmail,
        teacherName: still.counterpartName,
        ...(counterpartLesson.room ? { room: counterpartLesson.room } : {}),
      };

      const exchangeId = timetableChangesColRef(domain).doc().id;
      const refA = timetableChangesColRef(domain).doc();
      const refB = timetableChangesColRef(domain).doc();
      const now = Date.now();
      const common = {
        termId: request.termId,
        type: "cross_swap" as const,
        requestId,
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: now,
      };
      const changeA: TimetableChange = {
        id: refA.id,
        weekId: request.weekId,
        ...common,
        crossSwap: {
          exchangeId,
          otherWeekId: request.targetWeekId!,
          grade: request.source.grade,
          classNum: request.source.classNum,
          day: request.source.day,
          period: request.source.period,
          out: myRef,
          in: otherRef,
        },
      };
      const changeB: TimetableChange = {
        id: refB.id,
        weekId: request.targetWeekId!,
        ...common,
        crossSwap: {
          exchangeId,
          otherWeekId: request.weekId,
          grade: request.source.grade,
          classNum: request.source.classNum,
          day: still.targetDay,
          period: still.targetPeriod,
          out: otherRef,
          in: myRef,
        },
      };
      tx.set(refA, changeA);
      tx.set(refB, changeB);
      tx.update(reqRef, {
        status: "APPROVED",
        decidedBy: managerEmail.toLowerCase(),
        decidedAt: now,
        appliedChangeIds: [refA.id, refB.id],
      });
      return {
        request: { ...request, status: "APPROVED" as const, appliedChangeIds: [refA.id, refB.id] },
        change: changeA,
      };
    }

    const changeRef = timetableChangesColRef(domain).doc();
    let change: TimetableChange;

    if (request.type === "swap") {
      const cand = request.candidate;
      const swapRes = findSwapCandidates(grids, week, settings, request.requesterEmail, request.source, COORD_ON);
      const still = swapRes.candidates.find(
        (c) =>
          c.targetDay === cand.targetDay &&
          c.targetPeriod === cand.targetPeriod &&
          c.counterpartEmail === cand.counterpartEmail
      );
      if (!still)
        throw new Error("승인 불가 — 다른 변경으로 상황이 바뀌어 후보가 더 이상 유효하지 않습니다. 신청자의 재신청이 필요합니다.");
      // 조율 필요 후보(특별실 충돌)는 양해 기록이 있어야 승인 가능 (consent_swap_opening_spec §2-3)
      if (still.coordination && !request.consent?.confirmed)
        throw new Error("승인 불가 — 이 교체안은 당사자 양해가 필요한 상태인데 양해 기록이 없습니다. 신청자의 재신청이 필요합니다.");

      change = {
        id: changeRef.id,
        termId: request.termId,
        weekId: request.weekId,
        type: "swap",
        requestId,
        swap: {
          grade: request.source.grade,
          classNum: request.source.classNum,
          a: {
            day: request.source.day,
            period: request.source.period,
            subjectName: request.source.subjectName,
            teacherEmail: request.requesterEmail,
            teacherName: request.requesterName,
          },
          b: {
            day: still.targetDay,
            period: still.targetPeriod,
            subjectName: still.counterpartSubjectName,
            teacherEmail: still.counterpartEmail,
            teacherName: still.counterpartName,
          },
        },
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: Date.now(),
      };
    } else {
      // 특별보강: 보강 교사가 여전히 그 슬롯에 공강인지 재확인
      const idxFree = !synthesizeWeeklyGrids(baseGrids, week, changes, settings)
        .grids.some((g) =>
          g.cells.some(
            (c) =>
              c.day === request.source.day &&
              c.period === request.source.period &&
              c.lessons.some((l) =>
                (l.teachers || []).some(
                  (t) => t.email.trim().toLowerCase() === request.candidate.counterpartEmail
                )
              )
          )
        );
      if (!idxFree)
        throw new Error("승인 불가 — 보강 교사가 해당 교시에 더 이상 공강이 아닙니다. 신청자의 재신청이 필요합니다.");

      change = {
        id: changeRef.id,
        termId: request.termId,
        weekId: request.weekId,
        type: "substitute",
        requestId,
        substitute: {
          grade: request.source.grade,
          classNum: request.source.classNum,
          day: request.source.day,
          period: request.source.period,
          subjectName: request.source.subjectName,
          absentTeacherEmail: request.requesterEmail,
          absentTeacherName: request.requesterName,
          subTeacherEmail: request.candidate.counterpartEmail,
          subTeacherName: request.candidate.counterpartName,
        },
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: Date.now(),
      };
    }

    tx.set(changeRef, change);
    tx.update(reqRef, {
      status: "APPROVED",
      decidedBy: managerEmail.toLowerCase(),
      decidedAt: change.appliedAt,
      appliedChangeIds: [changeRef.id],
    });
    return { request: { ...request, status: "APPROVED" as const, appliedChangeIds: [changeRef.id] }, change };
  });

  // changes 커밋 완료 → view 캐시 무효화 (알림 실패와 무관하게 먼저)
  await bumpTimetableCacheVersion(domain);

  // 알림: 신청자 + 상대 교사 (§5 — 교무부장은 열람 전용, DM 없음)
  if (options?.skipNotify) return result;
  const dayNames = ["", "월", "화", "수", "목", "금"];
  const r = result.request;

  // 체인 승인: 신청자 + 관련 교사 전원(consent.parties — 서버 도출 집합) 통지 (§4-3)
  if (r.type === "chain") {
    const chainMsg =
      `✅ 징검다리 수업교환 승인 완료 (${(r.chainSteps || []).length}단계)\n` +
      (r.chainSteps || []).map((s) => s.stepSummary).join("\n") +
      (r.consent
        ? `\n🤝 양해 확인됨: ${r.consent.parties.map((p) => p.name).join(", ")}${r.consent.note ? ` — ${r.consent.note}` : ""}`
        : "") +
      `\n승인: ${managerEmail}`;
    const chainRecipients = Array.from(
      new Set([r.requesterEmail, ...(r.consent?.parties || []).map((p) => p.email)])
    );
    for (const to of chainRecipients) {
      try {
        await sendGoogleChat(to, chainMsg);
      } catch (e: any) {
        console.error(`[chain_approve] 알림 실패 (${to}):`, e.message);
      }
    }
    return result;
  }
  // 교차 주는 주가 다르므로 날짜를 병기한다 (§4-3b UI 원칙과 동일)
  const dateOfDay = (w: TimetableWeek | null, day: number): string =>
    w?.days.find((d) => d.day === day)?.date?.slice(5).replace("-", "/") || "";
  const msg =
    `✅ 수업교환 승인 완료${isCross ? " (교차 주)" : ""}\n` +
    `${r.source.grade}-${r.source.classNum} ${isCross ? `${dateOfDay(week, r.source.day)}(` : ""}${dayNames[r.source.day]} ${r.source.period}교시${isCross ? ")" : ""} ${r.source.subjectName}` +
    (r.type === "swap"
      ? ` ↔ ${isCross ? `${dateOfDay(targetWeek, r.candidate.targetDay || 0)}(` : ""}${dayNames[r.candidate.targetDay || 0]} ${r.candidate.targetPeriod}교시${isCross ? ")" : ""} ${r.candidate.counterpartSubjectName} (${r.candidate.counterpartName})`
      : ` → ${r.candidate.counterpartName} 선생님 특별보강`) +
    (r.consent
      ? `\n🤝 장소 양해 확인됨: ${r.consent.parties.map((p) => p.name).join(", ")}${r.consent.note ? ` — ${r.consent.note}` : ""}`
      : "") +
    `\n승인: ${managerEmail}`;
  // 양해 당사자도 확정 통지 수신 (consent_swap_opening_spec §3-2) — 기록이 보호 장치로 완성되는 지점
  const approveRecipients = Array.from(
    new Set([
      r.requesterEmail,
      r.candidate.counterpartEmail,
      ...(r.consent?.parties || []).map((p) => p.email),
    ])
  );
  for (const to of approveRecipients) {
    try {
      await sendGoogleChat(to, msg);
    } catch (e: any) {
      console.error(`[swap_approve] 알림 실패 (${to}):`, e.message);
    }
  }

  return result;
}

export async function rejectSwapRequest(
  domain: string,
  managerEmail: string,
  requestId: string,
  decisionNote: string
): Promise<SwapRequest> {
  const note = (decisionNote || "").trim();
  if (!note) throw new Error("반려 사유는 필수입니다.");
  const ref = swapRequestsColRef(domain).doc(requestId);
  const updated = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("신청을 찾을 수 없습니다.");
    const req = { ...(snap.data() as SwapRequest), id: requestId };
    if (req.status !== "PENDING") throw new Error("대기 중인 신청만 반려할 수 있습니다.");
    tx.update(ref, {
      status: "REJECTED",
      decidedBy: managerEmail.toLowerCase(),
      decidedAt: Date.now(),
      decisionNote: note,
    });
    return { ...req, status: "REJECTED" as const, decisionNote: note };
  });

  try {
    await sendGoogleChat(
      updated.requesterEmail,
      `❌ 수업교환 신청 반려\n사유: ${note}\n반려: ${managerEmail}`
    );
  } catch (e: any) {
    console.error(`[swap_reject] 알림 실패:`, e.message);
  }
  return updated;
}

/** 승인 취소: 원본 불변 — 역방향(revert) 변경을 기록한다 (§2) */
export async function revertTimetableChange(
  domain: string,
  managerEmail: string,
  changeId: string,
  options?: { skipNotify?: boolean } // 검증 스크립트 전용 — 라우트는 항상 알림
): Promise<TimetableChange & { allReverts: TimetableChange[] }> {
  const reverted = await adminDb.runTransaction(async (tx) => {
    const targetRef = timetableChangesColRef(domain).doc(changeId);
    const targetSnap = await tx.get(targetRef);
    if (!targetSnap.exists) throw new Error("취소할 변경을 찾을 수 없습니다.");
    const target = { ...(targetSnap.data() as TimetableChange), id: changeId };
    if (target.type === "revert") throw new Error("취소 기록 자체는 다시 취소할 수 없습니다.");

    // 취소 대상 문서 집합: 교차 주는 exchangeId 문서쌍 전체 — 한쪽만 취소 금지 (§4-3b)
    let targets: TimetableChange[] = [target];
    if (target.type === "cross_swap" && target.crossSwap) {
      const pairSnap = await tx.get(
        timetableChangesColRef(domain).where(
          "crossSwap.exchangeId", "==", target.crossSwap.exchangeId
        )
      );
      targets = pairSnap.docs.map((d) => ({ ...(d.data() as TimetableChange), id: d.id }));
      if (!targets.some((t) => t.id === changeId)) targets.push(target);
    }
    // 체인 승인이 만든 변경은 신청 단위로만 취소 — 부분 취소 금지 (consent_swap_opening_spec §4-3).
    // 체인 안의 교차 주 단계도 이 확장이 문서쌍까지 포괄한다 (전 단계가 같은 requestId를 공유).
    // §3-2d S5: 원 신청은 알림 수신자(신청자+양해 당사자)·취소 내용 문구의 재료이므로 체인 여부와 무관하게 읽어둔다.
    let request: SwapRequest | null = null;
    if (target.requestId) {
      const reqSnap = await tx.get(swapRequestsColRef(domain).doc(target.requestId));
      if (reqSnap.exists) {
        request = { ...(reqSnap.data() as SwapRequest), id: target.requestId };
        if (request.type === "chain") {
          const groupSnap = await tx.get(
            timetableChangesColRef(domain).where("requestId", "==", target.requestId)
          );
          targets = groupSnap.docs
            .map((d) => ({ ...(d.data() as TimetableChange), id: d.id }))
            .filter((t) => t.type !== "revert");
          if (!targets.some((t) => t.id === changeId)) targets.push(target);
        }
      }
    }

    for (const t of targets) {
      const existingRevert = await tx.get(
        timetableChangesColRef(domain).where("revertOf", "==", t.id).limit(1)
      );
      if (!existingRevert.empty) throw new Error("이미 취소된 변경입니다.");
    }

    const now = Date.now();
    const reverts: TimetableChange[] = [];
    // 되돌리기는 뒤 단계부터(LIFO) — 체인처럼 순차 의존 변경의 역연산은 적용 역순이어야
    // 원복된다. revert appliedAt에 역순 오프셋을 줘 합성기의 appliedAt 정렬이 이를 보장한다.
    // (검증 실측에서 검출: 동일 appliedAt이면 정순 역연산이 걸려 적용 불능 → 원복 실패)
    const orderedTargets = [...targets].sort((a, b) => b.appliedAt - a.appliedAt);
    orderedTargets.forEach((t, idx) => {
      const ref = timetableChangesColRef(domain).doc();
      const revert: TimetableChange = {
        id: ref.id,
        termId: t.termId,
        weekId: t.weekId,
        type: "revert",
        revertOf: t.id,
        appliedBy: managerEmail.toLowerCase(),
        appliedAt: now + idx,
      };
      tx.set(ref, revert);
      reverts.push(revert);
    });
    if (target.requestId) {
      tx.update(swapRequestsColRef(domain).doc(target.requestId), {
        status: "CANCELED",
        decidedBy: managerEmail.toLowerCase(),
        decidedAt: now,
        decisionNote: "일과계 승인 취소 (revert)",
      });
    }
    return {
      revert: reverts.find((r) => r.revertOf === changeId) || reverts[0],
      reverts,
      targets,
      request,
    };
  });

  // revert change 커밋 완료 → view 캐시 무효화 (알림 실패와 무관하게 먼저)
  await bumpTimetableCacheVersion(domain);

  const result = Object.assign({ ...reverted.revert }, { allReverts: reverted.reverts });
  if (options?.skipNotify) return result;

  // 알림 (§5 + §3-2d S5): 수신자 = 취소된 전 change의 당사자 ∪ 신청자 ∪ 양해 당사자.
  // 클릭한 change 1건의 두 교사만 통지하면 체인·교차 주 취소에서 나머지 단계 당사자가 누락된다 (16ⓐ 실측).
  const recipients = new Set<string>();
  for (const t of reverted.targets) {
    if (t.swap) {
      recipients.add(t.swap.a.teacherEmail);
      recipients.add(t.swap.b.teacherEmail);
    }
    if (t.substitute) {
      recipients.add(t.substitute.absentTeacherEmail);
      recipients.add(t.substitute.subTeacherEmail);
    }
    if (t.crossSwap) {
      recipients.add(t.crossSwap.out.teacherEmail);
      recipients.add(t.crossSwap.in.teacherEmail);
    }
  }
  const req = reverted.request;
  if (req) {
    recipients.add(req.requesterEmail);
    for (const p of req.consent?.parties || []) recipients.add(p.email);
  }
  recipients.delete("");

  // 취소 DM에도 어떤 교환이 취소됐는지 상세를 담는다 (16ⓑ — 승인 DM은 상세인데 취소는 무내용이던 비대칭 해소)
  const dayNames = ["", "월", "화", "수", "목", "금"];
  const detailLines: string[] = [];
  if (req?.type === "chain" && (req.chainSteps || []).length > 0) {
    detailLines.push(...(req.chainSteps || []).map((s) => s.stepSummary).filter(Boolean));
  } else {
    for (const t of reverted.targets) {
      if (t.swap) {
        detailLines.push(
          `${t.swap.grade}-${t.swap.classNum} ${dayNames[t.swap.a.day]} ${t.swap.a.period}교시 ${t.swap.a.subjectName}(${t.swap.a.teacherName})` +
          ` ↔ ${dayNames[t.swap.b.day]} ${t.swap.b.period}교시 ${t.swap.b.subjectName}(${t.swap.b.teacherName})`
        );
      } else if (t.substitute) {
        detailLines.push(
          `${t.substitute.grade}-${t.substitute.classNum} ${dayNames[t.substitute.day]} ${t.substitute.period}교시 ${t.substitute.subjectName} 보강(${t.substitute.subTeacherName} 선생님)`
        );
      } else if (t.crossSwap) {
        detailLines.push(
          `${t.crossSwap.grade}-${t.crossSwap.classNum} ${t.weekId} 주 ${dayNames[t.crossSwap.day]} ${t.crossSwap.period}교시 ${t.crossSwap.out.subjectName} → ${t.crossSwap.in.subjectName} (교차 주)`
        );
      }
    }
  }
  const header =
    req?.type === "chain"
      ? `↩️ 승인되었던 징검다리 수업교환(${reverted.targets.length}단계)이 전체 취소되었습니다.`
      : "↩️ 승인되었던 수업교환이 취소되었습니다.";
  const msg = [header, ...detailLines, `취소: ${managerEmail}`].join("\n");
  for (const to of recipients) {
    try {
      await sendGoogleChat(to, msg);
    } catch (e: any) {
      console.error(`[swap_revert] 알림 실패 (${to}):`, e.message);
    }
  }
  return result;
}

// ── 일과계 직권 배정 (§6 direct_* — 관리자 전용) ──────────────

export interface DirectSourceInfo {
  teacherEmail: string;
  teacherName: string;
  subjectName: string;
}

/** 직권 배정용 소스 슬롯 해석: 관리자가 지정한 슬롯의 (단일) 담당 교사를 서버가 찾는다 */
export function resolveDirectSource(
  grids: WeeklyClassGrid[],
  source: { grade: number; classNum: number; day: number; period: number }
): { ok: true; info: DirectSourceInfo } | { ok: false; error: string } {
  const grid = grids.find((g) => g.grade === source.grade && g.classNum === source.classNum);
  if (!grid) return { ok: false, error: "해당 학급 시간표를 찾을 수 없습니다." };
  const cell = grid.cells.find((c) => c.day === source.day && c.period === source.period);
  if (!cell || cell.lessons.length === 0) return { ok: false, error: "해당 교시에 수업이 없습니다." };
  if (cell.lessons.length > 1)
    return { ok: false, error: "동시수업(분반) 교시는 직권 배정 대상이 아닙니다." };
  const lesson = cell.lessons[0];
  if (lesson.simul)
    return { ok: false, error: `여러 반이 함께 듣는 이동수업(${lesson.simul})이라 직권 배정 대상이 아닙니다.` };
  if ((lesson.teachers || []).length > 1)
    return { ok: false, error: "복수교사 수업은 직권 배정 대상이 아닙니다." };
  const t = lesson.teachers[0];
  if (!t || !t.email?.trim())
    return { ok: false, error: "학교 공통 활동 시간(동아리·자율활동 등)의 수업이라 이동할 수 없습니다." }; // §3-2d S3: 내부 개념(가상 교사) 노출 금지
  return {
    ok: true,
    info: {
      teacherEmail: t.email.trim().toLowerCase(),
      teacherName: t.name,
      subjectName: lesson.subjectName,
    },
  };
}

/** 직권 후보 탐색: 슬롯 담당 교사를 서버가 해석한 뒤 그 교사 기준으로 엔진 실행 */
export async function computeDirectCandidates(
  domain: string,
  weekId: string,
  source: SwapSourceSlot,
  targetWeekId?: string
) {
  const week = await loadWeek(domain, weekId);
  if (!week) throw new Error(`등록되지 않은 주(${weekId})입니다.`);
  const { grids } = await synthesizeWeek(domain, week);
  const resolved = resolveDirectSource(grids, source);
  if (!resolved.ok) return { error: resolved.error };
  const computed = await computeCandidates(
    domain, resolved.info.teacherEmail, weekId, source, targetWeekId
  );
  return { ...computed, sourceTeacher: resolved.info };
}

// ── §C 징검다리(목표 지향 체인) 탐색 (pre_opening_3features_spec §C-2) ──

const CHAIN_MAX_RESULTS = 5;
const CHAIN_BRANCH_CAP = 8; // 단계당 확장 후보 상한 (분기 폭발 가드)
const CHAIN_TIME_BUDGET_MS = 3000;

/**
 * 소스 수업 s가 목적지 슬롯 t에 도달하는 맞교환 수열을 탐색한다.
 * 1수 = 기존 엔진의 유효 맞교환(하드 제외 전부: 동시수업·특별실·가상·복수교사) — 각 단계의
 * 유효성·감점은 findSwap/CrossSwapCandidates를 가상 적용 상태 위에서 그대로 호출해 얻으므로
 * 엔진과 판정이 어긋날 수 없다. 수열 형태는 두 갈래를 조합한다:
 *   (i) s 자체를 옮기는 수: s→v→…→t (마지막 수가 t 도달)
 *   (ii) t를 점유한 수업을 먼저 치우는 수: t의 수업을 다른 교시로 보낸 뒤 s→t
 * 출력 단계는 담기(pendingItems) 호환 — 기존 direct_projected·direct_commit_batch 흐름을
 * 그대로 재사용한다("먼저 비운 자리를 뒤 항목이 쓰는" 순차 승인 성질이 체인의 실행 기반).
 */
export async function computeChainSearch(
  domain: string,
  params: {
    weekId: string;
    source: { grade: number; classNum: number; day: number; period: number };
    target: { weekId?: string; day: number; period: number };
    maxDepth?: number;
    /** 교사용 경로(§4-2): 지정 시 소스 수업 담당자가 이 이메일과 일치해야 탐색 진행 (본인 소유 검증) */
    requesterEmail?: string;
  }
): Promise<{
  chains: ChainSearchChain[];
  sourceTeacher?: DirectSourceInfo;
  truncated?: boolean;
  error?: string;
}> {
  const maxDepth = Math.min(Math.max(Math.floor(params.maxDepth ?? 2), 1), 3);
  const srcWeek = await loadWeek(domain, params.weekId);
  if (!srcWeek) throw new Error(`등록되지 않은 주(${params.weekId})입니다.`);
  const targetWeekId = params.target.weekId || params.weekId;
  const tgtWeek =
    targetWeekId === params.weekId ? srcWeek : await loadWeek(domain, targetWeekId);
  if (!tgtWeek) throw new Error(`등록되지 않은 주(${targetWeekId})입니다.`);
  if (tgtWeek.termId !== srcWeek.termId) throw new Error("다른 학기의 주로는 옮길 수 없습니다.");
  if (
    targetWeekId === params.weekId &&
    params.target.day === params.source.day &&
    params.target.period === params.source.period
  ) {
    return { chains: [], error: "이미 그 자리에 있는 수업입니다." };
  }

  const termId = srcWeek.termId;
  const involved = targetWeekId === params.weekId ? [srcWeek] : [srcWeek, tgtWeek];
  const [baseByWeek, settings] = await Promise.all([
    loadBaseGridsByWeek(domain, termId, involved.map((w) => w.startDate)),
    loadTimetableSettings(domain),
  ]);
  const changesByWeek = new Map(
    await Promise.all(involved.map(async (w) => [w.id, await loadWeekChanges(domain, w.id)] as const))
  );
  const weekOf = new Map(involved.map((w) => [w.id, w]));

  // 체인 접두(prefix)를 가상 change로 변환해 관련 주를 합성 — 단계마다 실제 담당 교사 명의
  const synthWith = (steps: ChainStepItem[]): Map<string, WeeklyClassGrid[]> => {
    const futureBase = Date.now() + 30_000_000; // 실 변경·담기 오버레이(+20M)보다 뒤
    const virtualByWeek = new Map<string, TimetableChange[]>();
    steps.forEach((s, i) => {
      const it: VirtualSwapItem = {
        key: `chain-${i}`,
        termId,
        weekId: s.weekId,
        targetWeekId: s.targetWeekId,
        type: s.type,
        requesterEmail: s.sourceTeacherEmail,
        requesterName: s.sourceTeacherName,
        source: s.source,
        candidate: s.candidate,
      };
      for (const w of involved) {
        const chs = buildVirtualChanges(it, w.id, futureBase + i);
        if (chs.length) virtualByWeek.set(w.id, [...(virtualByWeek.get(w.id) || []), ...chs]);
      }
    });
    const out = new Map<string, WeeklyClassGrid[]>();
    for (const w of involved) {
      const { grids } = synthesizeWeeklyGrids(
        baseByWeek.get(w.startDate)!,
        w,
        [...(changesByWeek.get(w.id) || []), ...(virtualByWeek.get(w.id) || [])],
        settings
      );
      out.set(w.id, grids);
    }
    return out;
  };

  // 이동 대상 수업(s)·담당 교사 확정
  const grids0 = synthWith([]).get(params.weekId)!;
  const resolved = resolveDirectSource(grids0, params.source);
  if (!resolved.ok) return { chains: [], error: resolved.error };
  const mover = resolved.info;
  // 교사용 경로: 본인 수업만 체인 시작 가능 (consent_swap_opening_spec §4-2 — 탐색 전 조기 차단)
  if (
    params.requesterEmail &&
    mover.teacherEmail !== params.requesterEmail.trim().toLowerCase()
  ) {
    return { chains: [], error: "본인의 수업만 체인 교체를 시작할 수 있습니다." };
  }

  const DAYS_KO = ["", "월", "화", "수", "목", "금"];
  const slotLabel = (weekId: string, day: number, period: number) => {
    const w = weekOf.get(weekId)!;
    const [, m, d] = w.startDate.split("-");
    const prefix = involved.length > 1 ? `${Number(m)}/${Number(d)}주 ` : "";
    return `${prefix}${DAYS_KO[day]}${period}`;
  };

  const makeStep = (
    idx: number,
    who: { email: string; name: string },
    fromWeekId: string,
    fromSlot: { day: number; period: number },
    subjectName: string,
    cand: SwapCandidate,
    cross: boolean
  ): ChainStepItem => ({
    weekId: fromWeekId,
    ...(cross ? { targetWeekId } : {}),
    type: cross ? "cross_swap" : "swap",
    source: {
      grade: params.source.grade,
      classNum: params.source.classNum,
      day: fromSlot.day,
      period: fromSlot.period,
      subjectName,
    },
    candidate: {
      targetDay: cand.targetDay,
      targetPeriod: cand.targetPeriod,
      ...(cross ? { targetWeekId } : {}),
      counterpartEmail: cand.counterpartEmail,
      counterpartName: cand.counterpartName,
      counterpartSubjectName: cand.counterpartSubjectName,
      score: cand.score,
      penalties: cand.penalties,
    },
    sourceTeacherEmail: who.email,
    sourceTeacherName: who.name,
    stepSummary: `${who.name} ${slotLabel(fromWeekId, fromSlot.day, fromSlot.period)} → ${slotLabel(cross ? targetWeekId : fromWeekId, cand.targetDay, cand.targetPeriod)} (맞교환 상대: ${cand.counterpartName})`,
    score: cand.score,
    penalties: cand.penalties,
  });

  const chains: ChainSearchChain[] = [];
  let truncated = false;
  const deadline = Date.now() + CHAIN_TIME_BUDGET_MS;
  const seenChains = new Set<string>();

  const pushChain = (steps: ChainStepItem[]) => {
    const key = steps
      .map((s) => `${s.weekId}:${s.source.day}-${s.source.period}>${s.candidate.targetDay}-${s.candidate.targetPeriod}:${s.candidate.counterpartEmail}`)
      .join("|");
    if (seenChains.has(key)) return;
    seenChains.add(key);
    chains.push({
      steps: steps.map((s, i) => ({ ...s, stepSummary: `${"①②③"[i] || `${i + 1}.`} ${s.stepSummary}` })),
      totalScore: steps.reduce((sum, s) => sum + s.score, 0),
      summary: steps.map((s, i) => `${"①②③"[i] || `${i + 1}.`} ${s.stepSummary}`).join("  "),
    });
  };

  // 깊이 우선 탐색. sPos = s의 현재 위치(가상 적용 후), depth = 사용한 교환 수
  const dfs = (
    steps: ChainStepItem[],
    sPos: { weekId: string; day: number; period: number },
    visitedSlots: Set<string>
  ) => {
    if (chains.length >= CHAIN_MAX_RESULTS * 3) return; // 정렬 전 여유 수집 상한
    if (Date.now() > deadline) {
      truncated = true;
      return;
    }
    const depth = steps.length;
    if (depth >= maxDepth) return;
    const gridsMap = synthWith(steps);
    const sGrids = gridsMap.get(sPos.weekId)!;
    const sWeek = weekOf.get(sPos.weekId)!;
    const sSource: SwapSourceSlot = {
      grade: params.source.grade,
      classNum: params.source.classNum,
      day: sPos.day,
      period: sPos.period,
      subjectName: mover.subjectName,
    };

    // ── (i) s 자체의 이동 후보 ──
    const collect: Array<{ cand: SwapCandidate; cross: boolean }> = [];
    const same = findSwapCandidates(sGrids, sWeek, settings, mover.teacherEmail, sSource);
    (same.candidates || []).forEach((cand) => collect.push({ cand, cross: false }));
    if (sPos.weekId !== targetWeekId) {
      const cross = findCrossSwapCandidates(
        sGrids, sWeek, gridsMap.get(targetWeekId)!, tgtWeek, settings, mover.teacherEmail, sSource
      );
      (cross.candidates || []).forEach((cand) => collect.push({ cand, cross: true }));
    }
    let branched = 0;
    for (const { cand, cross } of collect) {
      const landsWeek = cross ? targetWeekId : sPos.weekId;
      const isGoal =
        landsWeek === targetWeekId &&
        cand.targetDay === params.target.day &&
        cand.targetPeriod === params.target.period;
      if (isGoal) {
        pushChain([...steps, makeStep(depth, { email: mover.teacherEmail, name: mover.teacherName }, sPos.weekId, sPos, mover.subjectName, cand, cross)]);
        continue;
      }
      if (depth + 1 >= maxDepth) continue; // 남은 수가 없으면 중간 이동 무의미
      const slotKey = `${landsWeek}:${cand.targetDay}-${cand.targetPeriod}`;
      if (visitedSlots.has(slotKey) || branched >= CHAIN_BRANCH_CAP) continue;
      branched++;
      dfs(
        [...steps, makeStep(depth, { email: mover.teacherEmail, name: mover.teacherName }, sPos.weekId, sPos, mover.subjectName, cand, cross)],
        { weekId: landsWeek, day: cand.targetDay, period: cand.targetPeriod },
        new Set([...visitedSlots, slotKey])
      );
      if (Date.now() > deadline) { truncated = true; return; }
    }

    // ── (ii) 목적지 점유 수업 치우기 (남은 수 2 이상일 때만 의미) ──
    if (depth + 2 > maxDepth) return;
    const tGrids = gridsMap.get(targetWeekId)!;
    const occ = resolveDirectSource(tGrids, {
      grade: params.source.grade,
      classNum: params.source.classNum,
      day: params.target.day,
      period: params.target.period,
    });
    if (!occ.ok) return; // 점유 수업이 없거나(빈 셀) 하드 제외 대상이면 이 갈래 없음
    if (occ.info.teacherEmail === mover.teacherEmail) return;
    const occSource: SwapSourceSlot = {
      grade: params.source.grade,
      classNum: params.source.classNum,
      day: params.target.day,
      period: params.target.period,
      subjectName: occ.info.subjectName,
    };
    const occRes = findSwapCandidates(tGrids, tgtWeek, settings, occ.info.teacherEmail, occSource);
    let occBranched = 0;
    for (const cand of occRes.candidates || []) {
      // s의 현재 자리로 옮기는 수는 곧 s↔점유 수업 직접 교환 — (i)의 goal 후보와 중복이라 제외
      if (
        targetWeekId === sPos.weekId &&
        cand.targetDay === sPos.day && cand.targetPeriod === sPos.period
      ) continue;
      if (occBranched >= CHAIN_BRANCH_CAP) break;
      occBranched++;
      dfs(
        [...steps, makeStep(depth, { email: occ.info.teacherEmail, name: occ.info.teacherName }, targetWeekId, { day: params.target.day, period: params.target.period }, occ.info.subjectName, cand, false)],
        sPos,
        visitedSlots
      );
      if (Date.now() > deadline) { truncated = true; return; }
    }
  };

  dfs([], { weekId: params.weekId, day: params.source.day, period: params.source.period }, new Set());

  chains.sort((a, b) => a.totalScore - b.totalScore || a.steps.length - b.steps.length);

  let reason: string | undefined;
  if (chains.length === 0) {
    const tGrids = synthWith([]).get(targetWeekId)!;
    const occ = resolveDirectSource(tGrids, {
      grade: params.source.grade,
      classNum: params.source.classNum,
      day: params.target.day,
      period: params.target.period,
    });

    if (!occ.ok) {
      if (occ.error.includes("수업이 없습니다")) {
        reason = `목적지(${slotLabel(targetWeekId, params.target.day, params.target.period)})가 빈 슬롯이나 ${mover.teacherName} 교사의 시간표/특별실 충돌로 직접 이동할 수 없습니다.`;
      } else {
        // §3-2d S3: "직권 배정 제외 대상" 같은 내부 분류어 대신 하위 사유를 그대로 전달 (사유 자체가 눈높이 문장)
        reason = `목적지 교시의 수업을 옮길 수 없어 경로가 성립하지 않습니다 — ${occ.error}`;
      }
    } else {
      const occSource: SwapSourceSlot = {
        grade: params.source.grade,
        classNum: params.source.classNum,
        day: params.target.day,
        period: params.target.period,
        subjectName: occ.info.subjectName,
      };
      const occRes = findSwapCandidates(tGrids, tgtWeek, settings, occ.info.teacherEmail, occSource);
      const occCandsCount = (occRes.candidates || []).length;

      const sSource: SwapSourceSlot = {
        grade: params.source.grade,
        classNum: params.source.classNum,
        day: params.source.day,
        period: params.source.period,
        subjectName: mover.subjectName,
      };
      const sRes = findSwapCandidates(grids0, srcWeek, settings, mover.teacherEmail, sSource);
      const sCandsCount = (sRes.candidates || []).length;

      if (occCandsCount === 0) {
        reason = `목적지 점유 수업(${occ.info.teacherName} · ${occ.info.subjectName})이 특별실·구장 제약 또는 시간표 충돌로 이동 가능한 대안 슬롯이 없습니다 (후보 0건).`;
      } else if (sCandsCount === 0) {
        reason = `이동 대상 수업(${mover.teacherName} · ${mover.subjectName})이 특별실·구장 제약 또는 시간표 충돌로 이동 가능한 대안 슬롯이 없습니다 (후보 0건).`;
      } else {
        reason = `목적지 점유 수업(${occ.info.subjectName}, 대안 ${occCandsCount}건)과 이동 대상 수업(${mover.subjectName}, 대안 ${sCandsCount}건) 간 탐색 깊이(${maxDepth}단계) 내 연결 가능한 경로가 없습니다.`;
      }
    }
  }

  return {
    chains: chains.slice(0, CHAIN_MAX_RESULTS),
    sourceTeacher: mover,
    ...(truncated ? { truncated: true } : {}),
    ...(reason ? { reason } : {}),
  };
}

/**
 * 직권 배정 실행: 슬롯 담당 교사 명의의 신청을 서버가 생성한 뒤 즉시 승인한다.
 * 승인 재검증에 실패하면 생성한 신청을 자동 취소(CANCELED)해 유령 PENDING을 남기지 않는다.
 */
export async function directCommit(
  domain: string,
  managerEmail: string,
  params: {
    weekId: string;
    type: SwapRequestType;
    source: SwapSourceSlot;
    candidate: SwapCandidateSnapshot;
    reason?: SwapRequestReason;
    targetWeekId?: string; // 교차 주 맞교환 (§4-3b)
    batchId?: string; // §14-4 직권 담기 일괄 반영 묶음 — 요청대장 묶음 표시와 감사 추적용
    consent?: SwapConsentInput; // 조율 필요 후보의 양해 확인 — §14-4 동등성 (직권도 양해는 받아야 함)
  }
): Promise<{ request: SwapRequest; change: TimetableChange }> {
  const week = await loadWeek(domain, params.weekId);
  if (!week) throw new Error(`등록되지 않은 주(${params.weekId})입니다.`);
  const { grids } = await synthesizeWeek(domain, week);
  const resolved = resolveDirectSource(grids, params.source);
  if (!resolved.ok) throw new Error(resolved.error);

  const request = await createSwapRequest(
    domain,
    resolved.info.teacherEmail,
    {
      weekId: params.weekId,
      type: params.type,
      source: params.source,
      candidate: params.candidate,
      reason: params.reason,
      targetWeekId: params.targetWeekId,
      consent: params.consent,
    },
    { skipManagerNotify: true, direct: true, batchId: params.batchId }
  );

  try {
    return await approveSwapRequest(domain, managerEmail, request.id);
  } catch (e) {
    // 직권 흐름에서 승인 실패 시 교사 명의의 유령 PENDING이 남지 않도록 자동 취소
    await swapRequestsColRef(domain).doc(request.id).update({
      status: "CANCELED",
      decidedBy: managerEmail.toLowerCase(),
      decidedAt: Date.now(),
      decisionNote: "직권 배정 승인 실패로 자동 취소",
    });
    throw e;
  }
}

// ── 운영 도구 (phase9b_spec §8 — neis_list / hour_totals, 읽기 전용) ──

async function resolveTermIdOrThrow(domain: string, termId?: string): Promise<string> {
  if (termId) return termId;
  const settings = await loadTimetableSettings(domain);
  if (!settings.activeTermId) throw new Error("활성 학기가 없습니다. termId를 지정하세요.");
  return settings.activeTermId;
}

/** NEIS 입력용 수업교환 목록 (§8) — 기간 내 확정 변경 평탄화, revert 반영 */
export async function listNeisRows(
  domain: string,
  params: { termId?: string; startDate: string; endDate: string; type?: SwapRequestType }
): Promise<NeisRow[]> {
  const { startDate, endDate } = params;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate))
    throw new Error("startDate·endDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (startDate > endDate) throw new Error("startDate가 endDate보다 늦을 수 없습니다.");
  const termId = await resolveTermIdOrThrow(domain, params.termId);
  const [weeks, changes] = await Promise.all([
    listWeeks(domain, termId),
    loadTermChanges(domain, termId),
  ]);
  return flattenNeisChanges(weeks, changes, { startDate, endDate, type: params.type });
}

/**
 * 시수 집계 (§8) — 학기 시작~endDate까지 등록된 주의 합성본에서 실시수만 센다 (§12-3).
 * 저장하지 않고 매번 계산. 특별보강 누계는 엔진 공평 정렬과 동일 함수(countSubstituteTotals) 공유.
 */
export async function computeHourTotals(
  domain: string,
  params: { termId?: string; endDate: string }
): Promise<HourTotalsResult> {
  const { endDate } = params;
  if (!DATE_RE.test(endDate)) throw new Error("endDate는 YYYY-MM-DD 형식이어야 합니다.");
  const termId = await resolveTermIdOrThrow(domain, params.termId);

  const weeks = (await listWeeks(domain, termId)).filter((w) => w.startDate <= endDate);
  const acc = {
    byTeacher: new Map<string, { name: string; total: number }>(),
    bySubject: new Map<string, number>(),
    byClass: new Map<string, number>(),
  };
  for (const week of weeks) {
    const { grids } = await synthesizeWeek(domain, week);
    accumulateWeeklyHours(grids, week, endDate, acc);
  }

  // 특별보강 누계: 집계 구간의 주 + 슬롯 날짜가 endDate 이내인 change만. revert 기록은 항상 유지.
  const weekIds = new Set(weeks.map((w) => w.id));
  const weekById = new Map(weeks.map((w) => [w.id, w]));
  const termChanges = (await loadTermChanges(domain, termId)).filter((c) => {
    if (!weekIds.has(c.weekId)) return false;
    if (c.type === "revert") return true;
    if (c.type === "substitute" && c.substitute) {
      const date = weekById.get(c.weekId)?.days.find((d) => d.day === c.substitute!.day)?.date;
      return !!date && date <= endDate;
    }
    return true; // swap은 특별보강 누계와 무관
  });
  const subTotals = countSubstituteTotals(termChanges);

  return {
    termId,
    endDate,
    weeksCounted: weeks.length,
    byTeacher: Array.from(acc.byTeacher.entries())
      .map(([email, v]) => ({
        email,
        name: v.name,
        total: v.total,
        substituteCount: subTotals.get(email) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    bySubject: Array.from(acc.bySubject.entries())
      .map(([subjectName, total]) => ({ subjectName, total }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "ko")),
    byClass: Array.from(acc.byClass.entries())
      .map(([key, total]) => {
        const [grade, classNum] = key.split("-").map(Number);
        return { grade, classNum, total };
      })
      .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum),
  };
}

// ── 사전 양해 임시저장 CRUD (swap_drafts — phase9b_spec §13-1) ─

export async function saveSwapDraft(
  domain: string,
  userEmail: string,
  userName: string,
  draftId?: string,
  draftData?: any
): Promise<SwapDraft> {
  const colRef = swapDraftsColRef(domain);
  const now = Date.now();

  if (!draftData || !draftData.source || !draftData.candidate || !draftData.sourceWeekId) {
    throw new Error("초안 저장을 위한 필수 정보(source, candidate, sourceWeekId)가 누락되었습니다.");
  }

  // 상대 교사 이메일 형식 검증
  const counterpartEmail = draftData.candidate?.counterpartEmail;
  if (counterpartEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(counterpartEmail)) {
    throw new Error("상대 교사 이메일 형식이 올바르지 않습니다.");
  }

  let docId = draftId;

  if (docId) {
    // 1. (보안 가드) 수정 경로 소유권 확인 — 기존 초안 ID가 넘겨진 경우 작성자 본인 일치 검증
    const existingSnap = await colRef.doc(docId).get();
    if (!existingSnap.exists) {
      throw new Error("존재하지 않는 초안입니다.");
    }
    const existingData = existingSnap.data();
    if (existingData?.requesterEmail !== userEmail) {
      throw new Error("해당 초안을 수정할 권한이 없습니다.");
    }
  } else {
    // 2. 신규 생성 시 1인당 최대 20건 상한 검증
    const countSnap = await colRef.where("requesterEmail", "==", userEmail).get();
    if (countSnap.size >= 20) {
      throw new Error("임시저장 초안은 최대 20건까지 저장할 수 있습니다. 기존 초안을 정리 후 다시 시도해 주세요.");
    }
    docId = colRef.doc().id;
  }

  const activeTerm = await loadActiveTerm(domain);
  const termId = draftData.termId || activeTerm?.id || "2026-2";

  // 신청자 실명: 합성본의 소스 lesson에서 추출 (3단계 대비 실명 저장)
  let requesterName = userName || userEmail.split("@")[0];
  try {
    const week = await loadWeek(domain, draftData.sourceWeekId);
    if (week) {
      const { grids } = await synthesizeWeek(domain, week);
      const src = resolveSourceLesson(grids, userEmail, draftData.source);
      if (src.ok && src.lesson) {
        requesterName = src.lesson.teachers[0]?.name || requesterName;
      }
    }
  } catch (e) {
    // fallback to default
  }

  const docPayload = {
    requesterEmail: userEmail, // 서버가 본인으로 강제 세팅
    requesterName,
    termId,
    sourceWeekId: draftData.sourceWeekId,
    targetWeekId: draftData.targetWeekId || null,
    source: draftData.source,
    candidate: draftData.candidate,
    reason: draftData.reason || null,
    note: draftData.note || "",
    consentStatus: "NONE" as const,
    updatedAt: now,
    conditional: !!draftData.conditional,
    ...(draftId ? {} : { createdAt: now }),
  };

  await colRef.doc(docId).set(docPayload, { merge: true });

  const updatedSnap = await colRef.doc(docId).get();
  const savedData = updatedSnap.data()!;

  return {
    id: docId,
    requesterEmail: savedData.requesterEmail,
    requesterName: savedData.requesterName,
    termId: savedData.termId,
    sourceWeekId: savedData.sourceWeekId,
    targetWeekId: savedData.targetWeekId || undefined,
    source: savedData.source,
    candidate: savedData.candidate,
    reason: savedData.reason || undefined,
    note: savedData.note || "",
    consentStatus: savedData.consentStatus || "NONE",
    createdAt: toMillis(savedData.createdAt) || now,
    updatedAt: toMillis(savedData.updatedAt) || now,
    conditional: !!savedData.conditional,
  };
}

export async function listSwapDrafts(domain: string, userEmail: string): Promise<SwapDraft[]> {
  const colRef = swapDraftsColRef(domain);
  const snap = await colRef.where("requesterEmail", "==", userEmail).get();
  const drafts: SwapDraft[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      requesterEmail: data.requesterEmail,
      requesterName: data.requesterName || "",
      termId: data.termId || "",
      sourceWeekId: data.sourceWeekId || "",
      targetWeekId: data.targetWeekId || undefined,
      source: data.source,
      candidate: data.candidate,
      reason: data.reason || undefined,
      note: data.note || "",
      consentStatus: data.consentStatus || "NONE",
      createdAt: toMillis(data.createdAt) || Date.now(),
      updatedAt: toMillis(data.updatedAt) || Date.now(),
      conditional: !!data.conditional,
    };
  });
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** §3-2d S2: 본인 초안 전량 일괄 삭제 — 삭제 건수 반환 (상한 20건이라 단일 batch로 충분) */
export async function deleteAllSwapDrafts(domain: string, userEmail: string): Promise<number> {
  const colRef = swapDraftsColRef(domain);
  const snap = await colRef.where("requesterEmail", "==", userEmail).get();
  if (snap.empty) return 0;
  const batch = colRef.firestore.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

export async function deleteSwapDraft(domain: string, userEmail: string, draftId: string): Promise<void> {
  const colRef = swapDraftsColRef(domain);
  const docRef = colRef.doc(draftId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new Error("존재하지 않는 초안입니다.");
  }
  if (snap.data()?.requesterEmail !== userEmail) {
    throw new Error("해당 초안을 삭제할 권한이 없습니다.");
  }
  await docRef.delete();
}

// ── 구독형 학사일정 캘린더 (calendar_ics_feed_spec) ──────────────

/**
 * 구독형 학사일정 캘린더 (calendar_ics_feed_spec) 토큰 조회 및 자동 생성
 */
export async function getCalendarIcsInfo(domain: string, baseUrl?: string): Promise<{
  icsToken: string;
  feedUrl: string;
  webcalUrl: string;
  icsStaffToken: string;
  staffFeedUrl: string;
  staffWebcalUrl: string;
}> {
  const settings = await loadTimetableSettings(domain);
  let icsToken = settings.icsToken;
  let icsStaffToken = settings.icsStaffToken;
  let updated = false;

  const crypto = await import("crypto");
  if (!icsToken || icsToken.trim().length < 32) {
    icsToken = crypto.randomBytes(24).toString("hex");
    updated = true;
  }
  if (!icsStaffToken || icsStaffToken.trim().length < 32) {
    icsStaffToken = crypto.randomBytes(24).toString("hex");
    updated = true;
  }

  if (updated) {
    await timetableSettingsDocRef(domain).set({ icsToken, icsStaffToken }, { merge: true });
    await bumpTimetableCacheVersion(domain);
  }

  const hostBase = baseUrl || process.env.NEXT_PUBLIC_APP_URL || "https://school.hmh.or.kr";
  const cleanHost = hostBase.replace(/^https?:\/\//, "");
  const feedUrl = `${hostBase}/api/calendar/ics?token=${icsToken}`;
  const webcalUrl = `webcal://${cleanHost}/api/calendar/ics?token=${icsToken}`;
  const staffFeedUrl = `${hostBase}/api/calendar/ics?token=${icsStaffToken}`;
  const staffWebcalUrl = `webcal://${cleanHost}/api/calendar/ics?token=${icsStaffToken}`;

  return { icsToken, feedUrl, webcalUrl, icsStaffToken, staffFeedUrl, staffWebcalUrl };
}

/**
 * ics 피드용 학사일정 이벤트 전수 조회 (보관된 학기 제외 전 학기 이벤트)
 */
export async function loadAllCalendarEventsForICS(domain: string): Promise<TimetableCalendarEvent[]> {
  const terms: TimetableTerm[] = await loadAllTerms(domain);
  const activeTerms = terms.filter((t: TimetableTerm) => t.status !== "archived");
  const activeTermIds = new Set(activeTerms.map((t: TimetableTerm) => t.id));

  const snap = await timetableCalendarColRef(domain).get();
  const events: TimetableCalendarEvent[] = [];

  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const termId = data.termId || "";
    if (activeTermIds.size > 0 && !activeTermIds.has(termId)) return;

    events.push({
      id: d.id,
      termId,
      type: data.type as CalendarEventType,
      startDate: data.startDate || "",
      endDate: data.endDate || data.startDate || "",
      ...(data.title ? { title: data.title } : {}),
      ...(Array.isArray(data.grades) ? { grades: data.grades } : {}),
      ...(data.periodsByGrade ? { periodsByGrade: data.periodsByGrade } : {}),
      ...(data.note ? { note: data.note } : {}),
      ...(typeof data.staffOnly === "boolean" ? { staffOnly: data.staffOnly } : {}),
      source: (data.source as "neis" | "manual") || "manual",
      ...(data.neisKey ? { neisKey: data.neisKey } : {}),
      createdBy: data.createdBy || "",
      createdAt: toMillis(data.createdAt) || 0,
    });
  });

  return events.sort((a, b) => a.startDate.localeCompare(b.startDate));
}


// ═══════════════════════════════════════════════════════════════
// Phase 9c-D: 자동 작성 초안 CRUD (phase9c_d_spec §2 · §7)
// ═══════════════════════════════════════════════════════════════

export const timetableDraftsColRef = (domain: string) =>
  adminDb.collection("timetable_drafts").doc(domain).collection("drafts");

export const timetableDraftGridsColRef = (domain: string, draftId: string) =>
  adminDb
    .collection("timetable_drafts")
    .doc(domain)
    .collection("drafts")
    .doc(draftId)
    .collection("classGrids");

/** 초안 목록 (메타 전용 — base 그리드 제외) */
export async function listDrafts(domain: string): Promise<import("./types").TimetableDraft[]> {
  const snap = await timetableDraftsColRef(domain)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      label: d.label || "무제 초안",
      sourceTermId: d.sourceTermId || "",
      origin: d.origin || { kind: "copy" },
      ops: Array.isArray(d.ops) ? d.ops : [],
      opCursor: typeof d.opCursor === "number" ? d.opCursor : 0,
      unplaced: Array.isArray(d.unplaced) ? d.unplaced : [],
      lastReport: d.lastReport || undefined,
      hoursSnapshot: Array.isArray(d.hoursSnapshot) ? d.hoursSnapshot : undefined,
      createdBy: d.createdBy,
      createdAt: toMillis(d.createdAt) ?? undefined,
      updatedBy: d.updatedBy,
      updatedAt: toMillis(d.updatedAt) ?? undefined,
    } as import("./types").TimetableDraft;
  });
}

/** 초안 생성 — grids 없으면 서버가 현행 기초 시간표를 복제 */
export async function createDraft(
  domain: string,
  label: string,
  sourceTermId: string,
  origin: import("./types").TimetableDraftOrigin,
  grids: ClassGrid[] | null,
  unplaced: import("./types").TimetableDraftUnplaced[],
  lastReport: import("./types").TimetableDraftLastReport | undefined,
  createdBy: string
): Promise<string> {
  let baseGrids: ClassGrid[] = grids ?? [];
  if (baseGrids.length === 0) {
    baseGrids = await loadAllClassGrids(domain, sourceTermId);
  }
  if (baseGrids.length === 0) {
    throw new Error(
      "기초 시간표가 없어 초안을 생성할 수 없습니다. 먼저 기초 시간표를 가져오기 해 주세요."
    );
  }

  // spec v1.1 §7: hoursSnapshot = sourceTermId 현행 학기 기초 그리드에서 역산한 시수표
  const sourceBaseGrids = (grids && grids.length > 0)
    ? await loadAllClassGrids(domain, sourceTermId)
    : baseGrids;
  const hoursSnapshot = sourceBaseGrids.length > 0
    ? deriveHoursFromGrids(sourceBaseGrids)
    : deriveHoursFromGrids(baseGrids);

  const now = Date.now();
  const draftRef = timetableDraftsColRef(domain).doc();
  const draftId = draftRef.id;

  await draftRef.set({
    label,
    sourceTermId,
    origin,
    ops: [],
    opCursor: 0,
    unplaced,
    ...(lastReport ? { lastReport } : {}),
    hoursSnapshot,
    createdBy,
    createdAt: now,
    updatedBy: createdBy,
    updatedAt: now,
  });

  const batch = adminDb.batch();
  for (const grid of baseGrids) {
    const docId = `${grid.grade}-${grid.classNum}`;
    const ref = timetableDraftGridsColRef(domain, draftId).doc(docId);
    batch.set(ref, { grade: grid.grade, classNum: grid.classNum, cells: grid.cells });
  }
  await batch.commit();

  return draftId;
}

/** 초안 상세 — 메타 + base 그리드 + ops 재생 그리드 */
export async function getDraft(
  domain: string,
  draftId: string
): Promise<{
  meta: import("./types").TimetableDraft;
  baseGrids: ClassGrid[];
  currentGrids: ClassGrid[];
  hours: import("./types").HoursRequirement[];
}> {
  const draftRef = timetableDraftsColRef(domain).doc(draftId);
  const snap = await draftRef.get();
  if (!snap.exists) throw new Error("초안을 찾을 수 없습니다.");
  const d = snap.data()!;
  const hoursSnapshot = Array.isArray(d.hoursSnapshot) ? d.hoursSnapshot : undefined;
  const meta: import("./types").TimetableDraft = {
    id: draftId,
    label: d.label || "무제 초안",
    sourceTermId: d.sourceTermId || "",
    origin: d.origin || { kind: "copy" },
    ops: Array.isArray(d.ops) ? d.ops : [],
    opCursor: typeof d.opCursor === "number" ? d.opCursor : 0,
    unplaced: Array.isArray(d.unplaced) ? d.unplaced : [],
    lastReport: d.lastReport || undefined,
    hoursSnapshot,
    createdBy: d.createdBy,
    createdAt: toMillis(d.createdAt) ?? undefined,
    updatedBy: d.updatedBy,
    updatedAt: toMillis(d.updatedAt) ?? undefined,
  };

  const gridSnap = await timetableDraftGridsColRef(domain, draftId).get();
  const baseGrids: ClassGrid[] = gridSnap.docs.map((doc) => {
    const g = doc.data();
    return { grade: g.grade, classNum: g.classNum, cells: g.cells || [] };
  });

  const currentGrids = cloneClassGrids(baseGrids);
  if (meta.ops.length > 0 && meta.opCursor > 0) {
    applyRevisionOps(currentGrids, meta.ops.slice(0, meta.opCursor));
  }

  const hours = (hoursSnapshot && hoursSnapshot.length > 0)
    ? hoursSnapshot
    : deriveHoursFromGrids(baseGrids);

  return { meta, baseGrids, currentGrids, hours };
}

/** 초안 삭제 — 메타 + classGrids 서브컬렉션 일괄 삭제 */
export async function deleteDraft(domain: string, draftId: string): Promise<void> {
  const gridSnap = await timetableDraftGridsColRef(domain, draftId).get();
  if (gridSnap.docs.length > 0) {
    const batch = adminDb.batch();
    for (const doc of gridSnap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  await timetableDraftsColRef(domain).doc(draftId).delete();
}

export class DraftOpConflictError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "DraftOpConflictError";
  }
}

/** 초안 검증 모델 로더 — draft_op·undo·redo·ai_diagnose 공용.
 *  동일 블록이 3곳에 복제돼 있던 것을 단일 소재지로 추출 (2026-08-11, D-2 F1 교훈 계열). */
async function loadDraftConstraintModel(
  domain: string,
  meta: import("./types").TimetableDraft,
  baseGrids: ClassGrid[]
): Promise<{
  model: import("./types").TimetableConstraintModel;
  registryStats: {
    simulGroups: number;
    venueGroups: number;
    teacherSlotBans: number;
    consecutiveRules: number;
    coTeaching: number;
  };
}> {
  const settings = await loadTimetableSettings(domain);
  const sourceTermId = meta.sourceTermId || settings.activeTermId || "";

  const [simulGroups, venueGroups, teacherSlotBans, consecutiveRules, coTeaching] =
    await Promise.all([
      loadSimulGroups(domain, sourceTermId),
      loadVenueGroups(domain, sourceTermId),
      loadTeacherSlotBans(domain, sourceTermId),
      loadConsecutiveRules(domain, sourceTermId),
      loadCoTeachingRules(domain, sourceTermId),
    ]);

  const gradeDayPeriods = deriveGradeDayPeriods(baseGrids);
  const hours = (meta.hoursSnapshot && meta.hoursSnapshot.length > 0)
    ? meta.hoursSnapshot
    : deriveHoursFromGrids(baseGrids);
  const model: import("./types").TimetableConstraintModel = {
    lunchAfterPeriod: settings.lunchAfterPeriod || 4,
    periodsPerDay: settings.periodsPerDay || 7,
    gradeDayPeriods,
    hours,
    simulGroups,
    venueGroups,
    teacherSlotBans,
    consecutiveRules,
    coTeaching,
  };
  return {
    model,
    registryStats: {
      simulGroups: simulGroups.length,
      venueGroups: venueGroups.length,
      teacherSlotBans: teacherSlotBans.length,
      consecutiveRules: consecutiveRules.length,
      coTeaching: coTeaching.length,
    },
  };
}

/** 초안 op 1건 적용 — 재생 → 검사 → 하드 신규 발생 시 409 거부 → DB 저장 */
export async function applyDraftOp(
  domain: string,
  draftId: string,
  op: BaseRevisionOp,
  operatorEmail: string,
  customUnplaced?: import("./types").TimetableDraftUnplaced[]
): Promise<{
  meta: import("./types").TimetableDraft;
  baseGrids: ClassGrid[];
  currentGrids: ClassGrid[];
  report: import("./types").TimetableAuditReport;
}> {
  const { meta, baseGrids } = await getDraft(domain, draftId);
  const { model } = await loadDraftConstraintModel(domain, meta, baseGrids);

  const truncatedOps = meta.ops.slice(0, meta.opCursor);
  const oldGrids = cloneClassGrids(baseGrids);
  if (truncatedOps.length > 0) {
    applyRevisionOps(oldGrids, truncatedOps);
  }
  const oldReport = validateTimetable(oldGrids, model);

  // 자리표시(창체·SLAT) 셀 보호 — 검사기가 잡을 수 없는 종류라 연산 접수 단계에서 막는다.
  // 클라이언트에도 같은 관문이 있으나 여기가 최종 관문이다 (우회 방지).
  const placeholderBlock = checkPlaceholderOp(oldGrids, op);
  if (placeholderBlock) throw new DraftOpConflictError(placeholderBlock);

  const newOps = [...truncatedOps, op];
  const newGrids = cloneClassGrids(baseGrids);
  applyRevisionOps(newGrids, newOps);
  const newReport = validateTimetable(newGrids, model);

  // 판정 키는 validate.ts의 hardViolationKey 단일 소재지 — 클라 관문·해결안 탐색기와 공유한다
  const oldHardKeys = new Set(oldReport.hard.map(hardViolationKey));
  const newHards = newReport.hard.filter((h) => !oldHardKeys.has(hardViolationKey(h)));

  if (newHards.length > 0) {
    const firstErr = newHards[0];
    throw new DraftOpConflictError(
      `이동/교환 후 중대 문제(하드 위반)가 새로 발생합니다: [${firstErr.code}] ${firstErr.text}`
    );
  }

  const now = Date.now();
  const lastReport: import("./types").TimetableDraftLastReport = {
    hardCount: newReport.hard.length,
    actionableHard: newReport.summary.actionableHard,
    softTotal: newReport.soft.total,
  };

  const updatedOps = newOps;
  const updatedCursor = newOps.length;

  const updateData: any = {
    ops: updatedOps,
    opCursor: updatedCursor,
    lastReport,
    updatedAt: now,
    updatedBy: operatorEmail,
  };
  if (customUnplaced) {
    updateData.unplaced = customUnplaced;
  }

  await timetableDraftsColRef(domain).doc(draftId).update(updateData);

  const updatedMeta: import("./types").TimetableDraft = {
    ...meta,
    ops: updatedOps,
    opCursor: updatedCursor,
    lastReport,
    ...(customUnplaced ? { unplaced: customUnplaced } : {}),
    updatedAt: now,
    updatedBy: operatorEmail,
  };

  return { meta: updatedMeta, baseGrids, currentGrids: newGrids, report: newReport };
}

/** 초안 undo — opCursor - 1 */
export async function undoDraftOp(
  domain: string,
  draftId: string,
  operatorEmail: string
): Promise<{
  meta: import("./types").TimetableDraft;
  baseGrids: ClassGrid[];
  currentGrids: ClassGrid[];
  report: import("./types").TimetableAuditReport;
}> {
  const { meta, baseGrids } = await getDraft(domain, draftId);
  if (meta.opCursor <= 0) {
    throw new Error("더 이상 실행 취소할 수 없습니다.");
  }

  const { model } = await loadDraftConstraintModel(domain, meta, baseGrids);

  const newCursor = meta.opCursor - 1;
  const currentGrids = cloneClassGrids(baseGrids);
  if (newCursor > 0) {
    applyRevisionOps(currentGrids, meta.ops.slice(0, newCursor));
  }
  const report = validateTimetable(currentGrids, model);
  const lastReport: import("./types").TimetableDraftLastReport = {
    hardCount: report.hard.length,
    actionableHard: report.summary.actionableHard,
    softTotal: report.soft.total,
  };

  const now = Date.now();
  await timetableDraftsColRef(domain).doc(draftId).update({
    opCursor: newCursor,
    lastReport,
    updatedAt: now,
    updatedBy: operatorEmail,
  });

  const updatedMeta: import("./types").TimetableDraft = {
    ...meta,
    opCursor: newCursor,
    lastReport,
    updatedAt: now,
    updatedBy: operatorEmail,
  };

  return { meta: updatedMeta, baseGrids, currentGrids, report };
}

/** 초안 redo — opCursor + 1 */
export async function redoDraftOp(
  domain: string,
  draftId: string,
  operatorEmail: string
): Promise<{
  meta: import("./types").TimetableDraft;
  baseGrids: ClassGrid[];
  currentGrids: ClassGrid[];
  report: import("./types").TimetableAuditReport;
}> {
  const { meta, baseGrids } = await getDraft(domain, draftId);
  if (meta.opCursor >= meta.ops.length) {
    throw new Error("더 이상 다시 실행할 수 없습니다.");
  }

  const { model } = await loadDraftConstraintModel(domain, meta, baseGrids);

  const newCursor = meta.opCursor + 1;
  const currentGrids = cloneClassGrids(baseGrids);
  applyRevisionOps(currentGrids, meta.ops.slice(0, newCursor));

  const report = validateTimetable(currentGrids, model);
  const lastReport: import("./types").TimetableDraftLastReport = {
    hardCount: report.hard.length,
    actionableHard: report.summary.actionableHard,
    softTotal: report.soft.total,
  };

  const now = Date.now();
  await timetableDraftsColRef(domain).doc(draftId).update({
    opCursor: newCursor,
    lastReport,
    updatedAt: now,
    updatedBy: operatorEmail,
  });

  const updatedMeta: import("./types").TimetableDraft = {
    ...meta,
    opCursor: newCursor,
    lastReport,
    updatedAt: now,
    updatedBy: operatorEmail,
  };

  return { meta: updatedMeta, baseGrids, currentGrids, report };
}

// ═════════════════════════════════════════════════════════════
// Phase 9c-F: NEIS 매핑 등록부 · 사전 검증 (phase9c_f_spec §2·§4)
// ═════════════════════════════════════════════════════════════

/** 학기 무관 영속 단일 문서 — term.subjects에 두면 신학기마다 유실되므로 별도 문서 (spec §2) */
export const neisMapDocRef = (domain: string) =>
  adminDb.collection("timetable_neis_map").doc(domain);

export async function loadNeisMapRegistry(domain: string): Promise<NeisMapRegistry> {
  const snap = await neisMapDocRef(domain).get();
  if (!snap.exists) return emptyNeisMapRegistry();
  const d = snap.data() || {};
  return {
    subjects: Array.isArray(d.subjects)
      ? d.subjects
          .filter((r: any) => r && typeof r.platformName === "string")
          .map((r: any) => ({
            platformName: String(r.platformName),
            neisName: typeof r.neisName === "string" ? r.neisName : "",
          }))
      : [],
    confirmedTeachers: Array.isArray(d.confirmedTeachers)
      ? d.confirmedTeachers.filter((t: any) => typeof t === "string")
      : [],
    confirmedPairs: Array.isArray(d.confirmedPairs)
      ? d.confirmedPairs.filter((p: any) => typeof p === "string")
      : [],
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : undefined,
    updatedAt: toMillis(d.updatedAt) ?? undefined,
  };
}

/** 등록부 전체 교체 저장 — sanitize는 호출부(route)에서 sanitizeNeisMapPayload로 선행 */
export async function saveNeisMapRegistry(
  domain: string,
  registry: NeisMapRegistry,
  operatorEmail: string
): Promise<void> {
  await neisMapDocRef(domain).set({
    subjects: registry.subjects,
    confirmedTeachers: registry.confirmedTeachers,
    confirmedPairs: registry.confirmedPairs,
    updatedBy: operatorEmail,
    updatedAt: Date.now(),
  });
}

/**
 * 사전 검증 리포트 계산 — 대상은 초안(draftId, 재생 현재 그리드) 또는 학기 기초 그리드.
 * 읽기 예산: 학급 그리드 ~30 + 등록부 1 (수동 버튼 트리거 전용 — spec §4).
 */
export async function computeNeisPrecheck(
  domain: string,
  opts: { termId?: string; draftId?: string }
): Promise<{ report: NeisPrecheckReport; target: NeisPrecheckTarget }> {
  const registry = await loadNeisMapRegistry(domain);

  if (opts.draftId) {
    const { meta, currentGrids } = await getDraft(domain, opts.draftId);
    return {
      report: buildNeisPrecheckReport(currentGrids, registry),
      target: { kind: "draft", id: opts.draftId, label: meta.label },
    };
  }

  if (!opts.termId) {
    throw new Error("대상 학기(termId) 또는 초안(draftId)이 필요합니다.");
  }
  const [term, grids] = await Promise.all([
    loadTimetableTerm(domain, opts.termId),
    loadAllClassGrids(domain, opts.termId),
  ]);
  return {
    report: buildNeisPrecheckReport(grids, registry),
    target: { kind: "term", id: opts.termId, label: term?.name || opts.termId },
  };
}

// ═════════════════════════════════════════════════════════════
// Phase 9c-E: AI 보조 — E1 불능 진단 (phase9c_e_spec §3)
// ═════════════════════════════════════════════════════════════

/**
 * E1 불능 진단 — 서버가 초안 리포트를 재산출(클라 신뢰 0)해 가명화 입력을 만들고 AI를 호출한다.
 * 하드 0·미배정 0이면 API 호출 없이 즉시 반환 (무료 한도 절약).
 */
export async function computeAiDiagnosis(
  domain: string,
  draftId: string
): Promise<{ clean: boolean; result?: import("./ai").AiDiagnoseResult }> {
  // 모델 파생(hoursSnapshot 폴백·요일별 교시수)은 draft_op 경로와 동일하게 base 그리드 기준
  const { meta, baseGrids, currentGrids } = await getDraft(domain, draftId);
  const { model, registryStats } = await loadDraftConstraintModel(domain, meta, baseGrids);
  const report = validateTimetable(currentGrids, model);

  if (report.hard.length === 0 && (meta.unplaced || []).length === 0) {
    return { clean: true };
  }

  // 가명 사전 원천 = 그리드의 **실교사** (위반·미배정 문장의 실명이 전부 이 집합에서 나옴).
  // 가상 교사(이메일 없음 — 창체·SLAT)는 사람이 아니라 가명화 대상이 아니고, 사전에 넣으면
  // AI가 활동명을 사람 가명으로 받아 교사로 착각한다 (2026-08-12 실사용 신고와 동일 계열).
  const teachers: import("./ai").AiTeacherRef[] = [];
  const seen = new Set<string>();
  for (const grid of currentGrids) {
    for (const cell of grid.cells) {
      for (const lesson of cell.lessons) {
        for (const t of lesson.teachers || []) {
          if (!(t.email || "").trim()) continue; // 가상 교사 — 실명이 아니므로 치환 불요
          const key = `${(t.email || "").toLowerCase()}|${t.name || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          teachers.push({ email: t.email, name: t.name });
        }
      }
    }
  }

  const term = await loadTimetableTerm(domain, meta.sourceTermId);
  const { runDiagnose } = await import("./ai");
  const result = await runDiagnose(
    {
      termLabel: term?.name || meta.sourceTermId,
      draftLabel: meta.label,
      teachers,
      hard: report.hard.map((h) => ({
        code: h.code,
        text: h.text,
        ...(h.registryGap ? { registryGap: true } : {}),
        ...(h.hint ? { hint: h.hint } : {}),
      })),
      unplaced: (meta.unplaced || []).map((u) => ({ label: u.label, remaining: u.remaining })),
      softTotal: report.soft.total,
      registryStats,
    },
    (process.env.GEMINI_API_KEY || "").trim()
  );
  return { clean: false, result };
}

/**
 * E2 선호 정식화 — 활성 학기 그리드의 실교사(이메일 있는)만 로스터로 삼아 자연어를
 * slot_ban 제안으로 번역한다. 저장은 하지 않는다 — UI가 사람 확인 후 slot_ban_save 호출.
 */
export async function computeAiFormalize(
  domain: string,
  termId: string,
  text: string
): Promise<import("./ai").AiFormalizeResult> {
  const [settings, grids] = await Promise.all([
    loadTimetableSettings(domain),
    loadAllClassGrids(domain, termId),
  ]);

  const teachers: import("./ai").AiTeacherRef[] = [];
  const seen = new Set<string>();
  for (const grid of grids) {
    for (const cell of grid.cells) {
      for (const lesson of cell.lessons) {
        for (const t of lesson.teachers || []) {
          const email = (t.email || "").trim().toLowerCase();
          if (!email || seen.has(email)) continue; // 가상 교사(창체·SLAT)는 금지 규칙 대상 아님
          seen.add(email);
          teachers.push({ email, name: t.name });
        }
      }
    }
  }

  const { runFormalize } = await import("./ai");
  return runFormalize(
    { text, teachers, periodsPerDay: settings.periodsPerDay || 7 },
    (process.env.GEMINI_API_KEY || "").trim()
  );
}

/**
 * E3·E4 공용 요약 조립 — 서버가 초안 그리드·리포트를 재산출(클라 신뢰 0)해
 * 요약 통계만 만든다 (spec §3: 그리드 전문 전송 금지, 실명은 ai.ts가 전송 직전 가명화).
 */
async function buildAiGridSummary(
  domain: string,
  draftId: string
): Promise<import("./ai").AiGridSummaryInput> {
  const { meta, baseGrids, currentGrids } = await getDraft(domain, draftId);
  const { model } = await loadDraftConstraintModel(domain, meta, baseGrids);
  const report = validateTimetable(currentGrids, model);

  // 가명 사전 원천 + 교사별 주간 부하 — 그리드 한 번 순회로 함께 수집.
  // **가상 교사(이메일 없음 — 창체·SLAT 자리표시)는 제외한다**: 검사기·솔버·교환 엔진이 이미
  // 같은 규약으로 제외하는데 여기만 포함시켜, AI가 "창체 선생님"을 실존 교사로 착각하고
  // 전 학급 합산 시수(예: 주 60시간)를 근거로 엉뚱한 진단·제안을 내놓았다 (2026-08-12 실사용 신고).
  const teachers: import("./ai").AiTeacherRef[] = [];
  const loadByKey = new Map<string, import("./ai").AiTeacherLoad>();
  for (const grid of currentGrids) {
    for (const cell of grid.cells) {
      for (const lesson of cell.lessons) {
        for (const t of lesson.teachers || []) {
          if (!(t.email || "").trim()) continue; // 가상 교사 — 사람이 아니므로 부하·가명 대상 아님
          const key = `${(t.email || "").toLowerCase()}|${t.name || ""}`;
          let load = loadByKey.get(key);
          if (!load) {
            teachers.push({ email: t.email, name: t.name });
            load = { name: t.name || t.email || "", total: 0, byDay: [0, 0, 0, 0, 0] };
            loadByKey.set(key, load);
          }
          load.total += 1;
          if (cell.day >= 1 && cell.day <= 5) load.byDay[cell.day - 1] += 1;
        }
      }
    }
  }

  const term = await loadTimetableTerm(domain, meta.sourceTermId);
  return {
    termLabel: term?.name || meta.sourceTermId,
    draftLabel: meta.label,
    teachers,
    classes: report.summary.classes,
    lessons: report.summary.lessons,
    hardCount: report.hard.length,
    unplaced: (meta.unplaced || []).map((u) => ({ label: u.label, remaining: u.remaining })),
    softTotal: report.soft.total,
    softByCode: Object.entries(report.soft.byCode).map(([code, points]) => ({
      label: SOFT_CODE_LABELS[code] || code,
      points: points || 0,
    })),
    penalties: [...report.soft.details]
      .sort((a, b) => b.points - a.points)
      .map((d) => ({ text: d.text, points: d.points })),
    teacherLoads: Array.from(loadByKey.values()).sort((a, b) => b.total - a.total),
  };
}

/** E3 결과 설명 — 표시 전용 (spec §0 철칙: 어떤 저장도 하지 않는다) */
export async function computeAiExplain(
  domain: string,
  draftId: string
): Promise<import("./ai").AiExplainResult> {
  const input = await buildAiGridSummary(domain, draftId);
  const { runExplain } = await import("./ai");
  return runExplain(input, (process.env.GEMINI_API_KEY || "").trim());
}

/** E4 정성 비평 — 표시 전용 (spec §0 철칙: 어떤 저장도 하지 않는다) */
export async function computeAiCritique(
  domain: string,
  draftId: string
): Promise<import("./ai").AiCritiqueResult> {
  const input = await buildAiGridSummary(domain, draftId);
  const { runCritique } = await import("./ai");
  return runCritique(input, (process.env.GEMINI_API_KEY || "").trim());
}

// ═════════════════════════════════════════════════════════════
// Phase 9c-H: 신학기 편성 입력 2종 (phase9c_h_spec)
// ═════════════════════════════════════════════════════════════

// ── 교육과정 코호트 등록부 (phase9c_h_spec §2-2, §2-4) ─────────────

export async function listCurriculumCohorts(domain: string): Promise<CurriculumCohort[]> {
  const snap = await curriculumCohortsColRef(domain).get();
  const list: CurriculumCohort[] = [];
  snap.forEach((doc) => {
    const d = doc.data() as any;
    list.push({
      id: doc.id,
      label: d.label || "",
      startAdmissionYear: d.startAdmissionYear || 2025,
      fixedSlots: Array.isArray(d.fixedSlots) ? d.fixedSlots : [],
      active: d.active !== false,
      createdBy: d.createdBy || "",
      updatedBy: d.updatedBy || "",
      updatedAt: toMillis(d.updatedAt) || 0,
    });
  });
  return list.sort((a, b) => b.startAdmissionYear - a.startAdmissionYear);
}

export async function saveCurriculumCohort(
  domain: string,
  cohort: Partial<CurriculumCohort>,
  userEmail: string
): Promise<CurriculumCohort> {
  const validationError = validateCohortInput(cohort);
  if (validationError) {
    throw new Error(validationError);
  }

  const id = cohort.id?.trim() || randomUUID();
  const docRef = curriculumCohortsColRef(domain).doc(id);
  const now = Date.now();

  const data: CurriculumCohort = {
    id,
    label: (cohort.label || "").trim(),
    startAdmissionYear: Number(cohort.startAdmissionYear),
    fixedSlots: (cohort.fixedSlots || []).map((s) => ({
      displayName: (s.displayName || "창체").trim(),
      day: Number(s.day),
      period: Number(s.period),
    })),
    active: cohort.active !== false,
    createdBy: cohort.createdBy || userEmail,
    updatedBy: userEmail,
    updatedAt: now,
  };

  await docRef.set(data);
  return data;
}

export async function deleteCurriculumCohort(
  domain: string,
  cohortId: string
): Promise<void> {
  if (!cohortId) throw new Error("cohortId가 누락되었습니다.");
  await curriculumCohortsColRef(domain).doc(cohortId).delete();
}

// ── 신학기 주당 수업 시간 계획 (phase9c_h_spec §1-2, §1-3) ────────

export async function listHoursPlans(domain: string): Promise<HoursPlanSummary[]> {
  const snap = await hoursPlansColRef(domain).get();
  const list: HoursPlanSummary[] = [];
  snap.forEach((doc) => {
    const d = doc.data() as any;
    list.push({
      id: doc.id,
      label: d.label || "",
      sourceTermId: d.sourceTermId || "",
      derivedAt: toMillis(d.derivedAt) || 0,
      rowCount: Array.isArray(d.rows) ? d.rows.length : 0,
      status: d.status === "ready" ? "ready" : "draft",
      createdBy: d.createdBy || "",
      updatedBy: d.updatedBy || "",
      updatedAt: toMillis(d.updatedAt) || 0,
    });
  });
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getHoursPlan(
  domain: string,
  planId: string
): Promise<HoursPlan | null> {
  if (!planId) return null;
  const doc = await hoursPlansColRef(domain).doc(planId).get();
  if (!doc.exists) return null;
  const d = doc.data() as any;
  return {
    id: doc.id,
    label: d.label || "",
    sourceTermId: d.sourceTermId || "",
    derivedAt: toMillis(d.derivedAt) || 0,
    rows: Array.isArray(d.rows) ? d.rows : [],
    gradeDayPeriods: d.gradeDayPeriods || {},
    status: d.status === "ready" ? "ready" : "draft",
    createdBy: d.createdBy || "",
    updatedBy: d.updatedBy || "",
    updatedAt: toMillis(d.updatedAt) || 0,
  };
}

export async function deriveHoursPlanFromGrids(
  domain: string,
  sourceTermId: string,
  label: string,
  userEmail: string
): Promise<HoursPlan> {
  const grids = await loadAllClassGrids(domain, sourceTermId);
  if (!grids || grids.length === 0) {
    throw new Error(`선택한 학기(${sourceTermId})에 등록된 기초시간표 학급 그리드가 없습니다.`);
  }

  // validate.ts의 기존 파생 함수 재사용
  const hoursReqs = deriveHoursFromGrids(grids);
  const gradeDayPeriods = deriveGradeDayPeriods(grids);

  const rows: HoursPlanRow[] = hoursReqs.map((r) => {
    let teacherEmail = "";
    let teacherName = "";
    if (r.teacherKey.startsWith("name:")) {
      teacherName = r.teacherKey.slice(5);
    } else {
      teacherEmail = r.teacherKey;
    }
    return {
      id: randomUUID(),
      grade: r.grade,
      classNum: r.classNum,
      subjectName: r.subjectName,
      teacherEmail,
      teacherName,
      hours: r.hours,
    };
  });

  const planId = randomUUID();
  const now = Date.now();
  const plan: HoursPlan = {
    id: planId,
    label: label.trim() || `${sourceTermId} 파생 시수`,
    sourceTermId,
    derivedAt: now,
    rows,
    gradeDayPeriods,
    status: "draft",
    createdBy: userEmail,
    updatedBy: userEmail,
    updatedAt: now,
  };

  await hoursPlansColRef(domain).doc(planId).set(plan);
  return plan;
}

export async function saveHoursPlan(
  domain: string,
  planId: string | undefined,
  payload: {
    label?: string;
    sourceTermId?: string;
    rows: HoursPlanRow[];
    gradeDayPeriods: Record<number, Record<number, number>>;
    status?: "draft" | "ready";
  },
  userEmail: string
): Promise<HoursPlan> {
  const rows = payload.rows || [];

  // 1. rows 길이 상한 2000, 크기 900KB
  if (!Array.isArray(rows)) {
    throw new Error("rows 배열이 유효하지 않습니다.");
  }
  if (rows.length > 2000) {
    throw new Error(`수업 행 수(${rows.length})가 최대 허용치(2000행)를 초과했습니다.`);
  }
  const serialized = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes > 900 * 1024) {
    throw new Error(`저장 데이터 용량(${(sizeBytes / 1024).toFixed(1)}KB)이 최대 허용치(900KB)를 초과했습니다.`);
  }

  // 6. simulGroupId 유효성 검증을 위해 그룹 목록 로드
  const simulSnap = await simulGroupsColRef(domain).get();
  const validSimulGroupIds = new Set(simulSnap.docs.map((d) => d.id));

  // 4. teacherEmail 검증 규약 — `users` 컬렉션 대조는 원천이 틀렸다: users/{uid} 문서는
  //    첫 로그인에 생기므로 플랫폼 미접속 교사(실측: 현직 다수)가 전부 거부된다.
  //    계정 실재는 UI 드롭다운(워크스페이스 디렉터리 목록)이 보장하고, 서버는 컴시간
  //    가져오기(validateImportPayload 1-b)와 동일하게 형식·학번형 학생 계정만 차단한다.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const rowKeySet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // 2. hours 1~40 정수
    if (!Number.isInteger(r.hours) || r.hours < 1 || r.hours > 40) {
      throw new Error(`[행 ${i + 1}] 시수는 1~40 사이의 정수여야 합니다 (현재: ${r.hours}).`);
    }
    // 3. grade, classNum 양의 정수
    if (!Number.isInteger(r.grade) || r.grade < 1 || !Number.isInteger(r.classNum) || r.classNum < 1) {
      throw new Error(`[행 ${i + 1}] 학년(${r.grade})과 반(${r.classNum})은 1 이상의 양의 정수여야 합니다.`);
    }
    // 과목명 확인
    if (!r.subjectName || !r.subjectName.trim()) {
      throw new Error(`[행 ${i + 1}] 과목명이 누락되었습니다.`);
    }
    // 4. teacherEmail 형식·학생 계정 차단 (빈 문자열 = 가상 교사 허용) — 위 규약 주석 참조
    const normEmail = (r.teacherEmail || "").trim().toLowerCase();
    if (normEmail !== "") {
      if (!EMAIL_RE.test(normEmail)) {
        throw new Error(`[행 ${i + 1}] 이메일 형식이 아닙니다: ${r.teacherEmail} (${r.teacherName || r.subjectName})`);
      }
      if (/^\d+@/.test(normEmail)) {
        throw new Error(`[행 ${i + 1}] 학번형 계정입니다 — 동명이인 학생 오매핑 의심: ${r.teacherEmail} (${r.teacherName || r.subjectName})`);
      }
    }
    // 5. venueHours 0 <= venueHours <= hours
    if (r.venueHours !== null && r.venueHours !== undefined) {
      if (!Number.isInteger(r.venueHours) || r.venueHours < 0 || r.venueHours > r.hours) {
        throw new Error(`[행 ${i + 1}] 특별실 시간(${r.venueHours})은 0 이상, 주당 시수(${r.hours}) 이하여야 합니다.`);
      }
    }
    // 6. simulGroupId 실재 확인
    if (r.simulGroupId && !validSimulGroupIds.has(r.simulGroupId)) {
      throw new Error(`[행 ${i + 1}] 존재하지 않는 동시수업 그룹 ID입니다: ${r.simulGroupId}`);
    }
    // 7. 중복 행 금지 (grade, classNum, subjectName, teacherEmail)
    const rowKey = `${r.grade}|${r.classNum}|${r.subjectName.trim().toLowerCase()}|${normEmail}`;
    if (rowKeySet.has(rowKey)) {
      throw new Error(`[행 ${i + 1}] 중복된 수업 행이 존재합니다 (${r.grade}학년 ${r.classNum}반 ${r.subjectName} / ${r.teacherName || normEmail || "담당없음"}).`);
    }
    rowKeySet.add(rowKey);
  }

  const id = planId?.trim() || randomUUID();
  const now = Date.now();

  // 기존 문서 조회하여 createdBy 보존
  let createdBy = userEmail;
  let derivedAt = now;
  if (planId) {
    const existing = await hoursPlansColRef(domain).doc(planId).get();
    if (existing.exists) {
      const exData = existing.data() as any;
      createdBy = exData.createdBy || userEmail;
      derivedAt = toMillis(exData.derivedAt) || now;
    }
  }

  // undefined 값 키는 아예 넣지 않는다 — 이 프로젝트 Firestore는 ignoreUndefinedProperties
  // 미설정이라 명시적 undefined가 set()에서 통째로 거부된다 (가상 교사 행의 단축·나이스명이 해당)
  const cleanRows: HoursPlanRow[] = rows.map((r) => ({
    id: r.id?.trim() || randomUUID(),
    grade: Number(r.grade),
    classNum: Number(r.classNum),
    subjectName: r.subjectName.trim(),
    ...(r.subjectShort?.trim() ? { subjectShort: r.subjectShort.trim() } : {}),
    ...(r.neisName?.trim() ? { neisName: r.neisName.trim() } : {}),
    teacherEmail: (r.teacherEmail || "").trim(),
    teacherName: (r.teacherName || "").trim(),
    hours: Number(r.hours),
    simulGroupId: r.simulGroupId ? r.simulGroupId.trim() : null,
    venueHours: r.venueHours !== null && r.venueHours !== undefined ? Number(r.venueHours) : null,
  }));

  const plan: HoursPlan = {
    id,
    label: (payload.label || "신학기 주당 수업 시간 계획").trim(),
    sourceTermId: payload.sourceTermId || "",
    derivedAt,
    rows: cleanRows,
    gradeDayPeriods: payload.gradeDayPeriods || {},
    status: payload.status === "ready" ? "ready" : "draft",
    createdBy,
    updatedBy: userEmail,
    updatedAt: now,
  };

  await hoursPlansColRef(domain).doc(id).set(plan);
  return plan;
}

export async function deleteHoursPlan(domain: string, planId: string): Promise<void> {
  if (!planId) throw new Error("planId가 누락되었습니다.");
  await hoursPlansColRef(domain).doc(planId).delete();
}

