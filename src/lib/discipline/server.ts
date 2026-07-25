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
  HomeroomAssignmentMap,
} from "./types";
import { DisciplineAuthzContext, findHomeroomClasses } from "./authz";

// ── 경로 헬퍼 ──────────────────────────────────────────────────

export const configDocRef = (domain: string) =>
  adminDb.collection("discipline_config").doc(domain);

export const grantsColRef = (domain: string) =>
  adminDb.collection("discipline_permissions").doc(domain).collection("grants");

export const homeroomDocRef = (domain: string) =>
  adminDb.collection("homeroom_assignments").doc(domain);

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

export async function loadHomeroomAssignments(
  domain: string
): Promise<{ assignments: HomeroomAssignmentMap; updatedAt: number | null; updatedBy: string }> {
  const snap = await homeroomDocRef(domain).get();
  const data = snap.data() || {};
  const assignments: HomeroomAssignmentMap = {};
  const raw = (data.assignments || {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") assignments[k] = v;
  }
  return {
    assignments,
    updatedAt: toMillis(data.updatedAt),
    updatedBy: data.updatedBy || "",
  };
}

/**
 * 권한 판정 컨텍스트 로드 — 모든 생활지도 API의 진입점.
 * config를 함께 반환해 라우트에서 이중 조회를 피한다.
 */
export async function loadAuthzContext(
  domain: string,
  auth: DecodedAuthAccess
): Promise<{ ctx: DisciplineAuthzContext; config: DisciplineConfig; configSeeded: boolean }> {
  const [{ config, seeded }, grants, homeroom] = await Promise.all([
    loadDisciplineConfig(domain),
    // 학생 역할이면 grant 조회 자체가 불필요하지만, 판정 엔진이 0순위로 거부하므로 안전
    auth.role === "student" ? Promise.resolve([]) : loadGrantsForTeacher(domain, auth.email),
    loadHomeroomAssignments(domain),
  ]);

  const ctx: DisciplineAuthzContext = {
    role: auth.role,
    email: auth.email.toLowerCase(),
    grants,
    homeroomClasses: findHomeroomClasses(homeroom.assignments, auth.email),
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
