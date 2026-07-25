/**
 * Phase 6b: 생활지도 서버 유틸 — Firestore 로더/직렬화 (admin SDK 전용)
 *
 * ⚠️ 컬렉션 접근 원칙:
 * - 모든 조회는 정확한 경로 지정(subcollection 직접 참조 또는 플랫 컬렉션 + 등호 필터)만 사용.
 * - collectionGroup 조회 금지 (6a-1 표적 리뷰 F1/F2 교훈: 수동 색인 필요 + 동명 컬렉션 충돌).
 * - 등호(==) 필터만 조합하고 orderBy는 쓰지 않는다(복합 색인 없이 자동 색인으로 동작).
 *   정렬은 서버 메모리에서 수행 — 단일 학교 규모(수천 건/년)에서 충분.
 */

import { adminDb, DecodedAuthAccess } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  DisciplineConfig,
  DisciplineGrant,
  DisciplineRecord,
  DisciplineStageEvent,
  DisciplineVisibility,
  HomeroomClass,
} from "./types";
import { DisciplineAuthzContext } from "./authz";

// ── 경로 헬퍼 ──────────────────────────────────────────────────

export const configDocRef = (domain: string) =>
  adminDb.collection("discipline_config").doc(domain);

export const grantsColRef = (domain: string) =>
  adminDb.collection("discipline_permissions").doc(domain).collection("grants");

// 담임 정보의 단일 원본은 승인된 교직원 프로필(teacher_profiles/{email})이다.
// 조직 정보 신청 → 수퍼어드민 승인 흐름으로만 확정되며, 생활지도 전용 배정표를
// 따로 두지 않는다(2026-07-25 사용자 지적: 베이스 데이터 중복 제거).
// teacher_profiles/{email}: { email, isHomeroom, homeroom: { grade, class } | null }
export const teacherProfilesColRef = () => adminDb.collection("teacher_profiles");

export const recordsColRef = (domain: string) =>
  adminDb.collection("discipline_records").doc(domain).collection("records");

export const stageEventsColRef = (domain: string) =>
  adminDb.collection("discipline_stage_events").doc(domain).collection("events");

// ── 직렬화 헬퍼 ────────────────────────────────────────────────

/** Firestore Timestamp | number | null → epoch millis | null */
export function toMillis(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof (v as any)?.toMillis === "function") return (v as any).toMillis();
  return null;
}

// ── 초기 규정 시드 (현행 시트 기준 — phase6_spec.md 표) ────────

const DEFAULT_VISIBILITY: DisciplineVisibility = {
  homeroomCanViewOtherClasses: false,
};

export function buildSeedConfig(): DisciplineConfig {
  return {
    items: [
      { id: "item_uniform", label: "생활지도(교복)", category: "생활지도", active: true },
      { id: "item_smoking", label: "흡연", category: "선도", active: true },
      { id: "item_phone", label: "휴대폰", category: "선도", active: true },
    ],
    stages: [
      { id: "stage_homeroom", order: 1, label: "담임" },
      { id: "stage_counselor", order: 2, label: "생활지도교사" },
      { id: "stage_level1", order: 3, label: "1단계" },
      { id: "stage_committee", order: 4, label: "생활교육위원회" },
    ],
    rules: [
      // 생활지도(교복): 1회차=담임, 2회차=생활지도교사, 3회차=생활교육위원회
      { id: "rule_uniform_1", trigger: { itemId: "item_uniform", countThreshold: 1 }, targetStageId: "stage_homeroom" },
      { id: "rule_uniform_2", trigger: { itemId: "item_uniform", countThreshold: 2 }, targetStageId: "stage_counselor" },
      { id: "rule_uniform_3", trigger: { itemId: "item_uniform", countThreshold: 3 }, targetStageId: "stage_committee" },
      // 흡연: 1회차=1단계, 2회차=생활교육위원회
      { id: "rule_smoking_1", trigger: { itemId: "item_smoking", countThreshold: 1 }, targetStageId: "stage_level1" },
      { id: "rule_smoking_2", trigger: { itemId: "item_smoking", countThreshold: 2 }, targetStageId: "stage_committee" },
      // 휴대폰: 1회차=1단계, 2회차=생활교육위원회
      { id: "rule_phone_1", trigger: { itemId: "item_phone", countThreshold: 1 }, targetStageId: "stage_level1" },
      { id: "rule_phone_2", trigger: { itemId: "item_phone", countThreshold: 2 }, targetStageId: "stage_committee" },
    ],
    resetMarkers: {},
    visibility: { ...DEFAULT_VISIBILITY },
  };
}

// ── 로더 ───────────────────────────────────────────────────────

/**
 * 규정 문서 로드. 문서가 없으면 시드 규정을 반환(쓰지는 않음 — 첫 저장 시 생성).
 * @returns config + seeded(시드 반환 여부)
 */
export async function loadDisciplineConfig(
  domain: string
): Promise<{ config: DisciplineConfig; seeded: boolean }> {
  const snap = await configDocRef(domain).get();
  if (!snap.exists) return { config: buildSeedConfig(), seeded: true };

  const data = snap.data() || {};
  const rawMarkers = (data.resetMarkers || {}) as Record<string, unknown>;
  const resetMarkers: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawMarkers)) {
    const ms = toMillis(v);
    if (ms !== null) resetMarkers[k] = ms;
  }

  const config: DisciplineConfig = {
    items: Array.isArray(data.items) ? data.items : [],
    stages: Array.isArray(data.stages) ? data.stages : [],
    rules: Array.isArray(data.rules) ? data.rules : [],
    resetMarkers,
    visibility: {
      ...DEFAULT_VISIBILITY,
      ...(typeof data.visibility === "object" && data.visibility ? data.visibility : {}),
    },
  };
  return { config, seeded: false };
}

function grantFromDoc(id: string, data: FirebaseFirestore.DocumentData): DisciplineGrant {
  return {
    id,
    teacherEmail: String(data.teacherEmail || "").toLowerCase(),
    scope: data.scope,
    rights: Array.isArray(data.rights) ? data.rights : [],
    grantedBy: data.grantedBy || "",
    grantedAt: toMillis(data.grantedAt),
    expiresAt: toMillis(data.expiresAt),
  };
}

/** 본인 grant만 조회 (등호 필터 1개 — 자동 색인) */
export async function loadGrantsForTeacher(
  domain: string,
  email: string
): Promise<DisciplineGrant[]> {
  const snap = await grantsColRef(domain)
    .where("teacherEmail", "==", email.toLowerCase())
    .get();
  return snap.docs.map((d) => grantFromDoc(d.id, d.data()));
}

/** 도메인 전체 grant 조회 (권한 관리 화면용) */
export async function loadAllGrants(domain: string): Promise<DisciplineGrant[]> {
  const snap = await grantsColRef(domain).get();
  return snap.docs.map((d) => grantFromDoc(d.id, d.data()));
}

/** 승인된 프로필 문서에서 담임 반을 추출 (isHomeroom + homeroom: {grade, class}) */
function homeroomClassesFromProfile(
  data: FirebaseFirestore.DocumentData | undefined
): HomeroomClass[] {
  if (!data || data.isHomeroom !== true || !data.homeroom) return [];
  const grade = Number(data.homeroom.grade);
  const classNum = Number(data.homeroom.class);
  if (!Number.isInteger(grade) || grade < 1 || grade > 3) return [];
  if (!Number.isInteger(classNum) || classNum < 1 || classNum > 30) return [];
  return [{ grade, classNum }];
}

/** 내 담임 반 조회 (권한 판정용) — 승인된 프로필 단일 문서 읽기 */
export async function loadMyHomeroomClasses(email: string): Promise<HomeroomClass[]> {
  const snap = await teacherProfilesColRef().doc(email.toLowerCase()).get();
  if (!snap.exists) return [];
  return homeroomClassesFromProfile(snap.data());
}

export interface HomeroomEntry {
  grade: number;
  classNum: number;
  email: string;
  name: string;
}

/** 전체 담임 현황 (읽기 전용 파생 뷰) — 승인된 프로필에서 집계. 공동담임(같은 반 복수)도 그대로 노출 */
export async function loadHomeroomEntries(domain: string): Promise<HomeroomEntry[]> {
  const snap = await teacherProfilesColRef().where("isHomeroom", "==", true).get();
  const out: HomeroomEntry[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const email = String(data.email || d.id).toLowerCase();
    if (!email.endsWith(`@${domain}`)) continue; // 방어적 도메인 필터
    for (const hc of homeroomClassesFromProfile(data)) {
      out.push({ grade: hc.grade, classNum: hc.classNum, email, name: data.name || "" });
    }
  }
  out.sort((a, b) => a.grade - b.grade || a.classNum - b.classNum || a.email.localeCompare(b.email));
  return out;
}

/**
 * 권한 판정 컨텍스트 로드 — 모든 생활지도 API의 진입점.
 * config를 함께 반환해 라우트에서 이중 조회를 피한다.
 */
export async function loadAuthzContext(
  domain: string,
  auth: DecodedAuthAccess
): Promise<{ ctx: DisciplineAuthzContext; config: DisciplineConfig; configSeeded: boolean }> {
  const [{ config, seeded }, grants, homeroomClasses] = await Promise.all([
    loadDisciplineConfig(domain),
    // 학생 역할이면 grant/담임 조회 자체가 불필요하지만, 판정 엔진이 0순위로 거부하므로 안전
    auth.role === "student" ? Promise.resolve([]) : loadGrantsForTeacher(domain, auth.email),
    auth.role === "student" ? Promise.resolve([]) : loadMyHomeroomClasses(auth.email),
  ]);

  const ctx: DisciplineAuthzContext = {
    role: auth.role,
    email: auth.email.toLowerCase(),
    grants,
    homeroomClasses,
    visibility: config.visibility,
    nowMs: Date.now(),
  };
  return { ctx, config, configSeeded: seeded };
}

// ── 기록/이벤트 문서 → 타입 변환 ──────────────────────────────

export function recordFromDoc(
  id: string,
  data: FirebaseFirestore.DocumentData
): DisciplineRecord {
  return {
    id,
    studentId: data.studentId || "",
    studentEmail: data.studentEmail || "",
    studentName: data.studentName || "",
    grade: Number(data.grade) || 0,
    classNum: Number(data.classNum) || 0,
    itemId: data.itemId || "",
    occurredAt: toMillis(data.occurredAt) ?? 0,
    note: data.note || "",
    recordedBy: data.recordedBy || "",
    recordedAt: toMillis(data.recordedAt),
    voided: Boolean(data.voided),
    voidedBy: data.voidedBy || undefined,
    voidedAt: toMillis(data.voidedAt),
    voidReason: data.voidReason || undefined,
  };
}

export function stageEventFromDoc(
  id: string,
  data: FirebaseFirestore.DocumentData
): DisciplineStageEvent {
  return {
    id,
    studentId: data.studentId || "",
    studentEmail: data.studentEmail || "",
    studentName: data.studentName || "",
    grade: Number(data.grade) || 0,
    classNum: Number(data.classNum) || 0,
    stageId: data.stageId || "",
    enteredAt: toMillis(data.enteredAt) ?? 0,
    cause: data.cause === "manual" ? "manual" : "auto",
    causeRecordIds: Array.isArray(data.causeRecordIds) ? data.causeRecordIds : [],
    manualReason: data.manualReason || undefined,
    createdBy: data.createdBy || "",
    resolved: Boolean(data.resolved),
    resolvedAt: toMillis(data.resolvedAt),
    resolvedBy: data.resolvedBy || undefined,
    resolution: data.resolution || undefined,
  };
}

// ── 파기 정책 (phase6_spec.md — 2026-07-25 사용자 확정) ───────

/**
 * 졸업/제적 파기: 계정 영구삭제 시점에 해당 학생의 생활지도 기록·단계 이력을 삭제한다.
 * 호출자는 감사 로그에 "파기 실행" 사실(건수)만 남기고 내용은 보존하지 않는다.
 */
export async function purgeDisciplineDataForStudent(
  domain: string,
  studentEmail: string
): Promise<{ recordsDeleted: number; eventsDeleted: number }> {
  const email = studentEmail.trim().toLowerCase();
  const [recSnap, evtSnap] = await Promise.all([
    recordsColRef(domain).where("studentEmail", "==", email).get(),
    stageEventsColRef(domain).where("studentEmail", "==", email).get(),
  ]);
  const docs = [...recSnap.docs, ...evtSnap.docs];
  // Firestore batch 한도(500) 아래인 400개 단위로 삭제
  for (let i = 0; i < docs.length; i += 400) {
    const batch = adminDb.batch();
    for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  return { recordsDeleted: recSnap.size, eventsDeleted: evtSnap.size };
}

// ── 학번 파싱 (서버 강제 — 클라이언트의 grade/classNum을 신뢰하지 않음) ─

/** "10101" → { grade: 1, classNum: 1, number: 1 } — 실패 시 null */
export function parseStudentIdStrict(
  studentId: unknown
): { grade: number; classNum: number; number: number } | null {
  if (typeof studentId !== "string") return null;
  const m = studentId.trim().match(/^(\d)(\d{2})(\d{2})$/);
  if (!m) return null;
  const grade = parseInt(m[1], 10);
  const classNum = parseInt(m[2], 10);
  const number = parseInt(m[3], 10);
  if (grade < 1 || grade > 3 || classNum < 1 || number < 1) return null;
  return { grade, classNum, number };
}
