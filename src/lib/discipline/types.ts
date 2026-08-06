/**
 * Phase 6b: 생활지도 기록 모듈 — 공유 타입 정의
 *
 * 원칙 (phase6_spec.md):
 * - 규정(items/stages/rules)과 권한(grants)은 코드에 하드코딩하지 않고 전부 Firestore 설정 데이터.
 * - 코드는 "설정을 해석하는 엔진"만 담당한다.
 * - 이 파일은 서버/클라이언트 공용 — 서버 전용 의존성(firebase-admin)을 import하지 않는다.
 */

// ── 규정 (discipline_config/{domain}) ─────────────────────────

export interface DisciplineItem {
  id: string;
  label: string;      // 예: "흡연", "생활지도(교복)"
  category: string;   // 예: "선도", "생활지도"
  active: boolean;    // 비활성 항목은 신규 기록 불가(과거 기록 표시는 유지)
}

export interface DisciplineStage {
  id: string;
  order: number;      // 클수록 상위 단계 (예: 담임 1 → 생활교육위원회 4)
  label: string;      // 예: "담임", "생활교육위원회"
  /** 담임 처리 단계 — true면 담임이 자기 반 학생의 이 단계 사안을 grant 없이 조치할 수 있다 (2026-08-05 사용자 확정) */
  homeroomResolvable?: boolean;
}

/** 규칙 = "회차 → 처리 단계" 매핑. trigger는 itemId 또는 category 중 하나만 지정. */
export interface DisciplineRule {
  id: string;
  trigger: {
    itemId?: string;
    category?: string;
    countThreshold: number; // n회차 도달 시 (>= 비교)
  };
  targetStageId: string;
}

export interface DisciplineVisibility {
  /** true면 담임(어느 반이든)이 타반 기록도 열람 가능 (기록은 불가) */
  homeroomCanViewOtherClasses: boolean;
}

export interface DisciplineConfig {
  items: DisciplineItem[];
  stages: DisciplineStage[];
  rules: DisciplineRule[];
  /** 학년별 수동 리셋 마커 (epoch millis). 회차 집계는 마커 이후 기록만. 기록 자체는 삭제하지 않는다. */
  resetMarkers: Record<string, number>;
  visibility: DisciplineVisibility;
}

// ── 권한 (discipline_permissions/{domain}/grants/{grantId}) ───

export type DisciplineRight =
  | "view"                // 기록 열람
  | "record"              // 기록 입력·본인 기록 무효화
  | "resolve"             // 단계 처리(처리함), 수동 단계 지정
  | "manage_rules"        // 규정 편집, 학년별 리셋
  | "manage_permissions"; // grant 부여·회수, 담임 배정표 편집

export const ALL_DISCIPLINE_RIGHTS: DisciplineRight[] = [
  "view",
  "record",
  "resolve",
  "manage_rules",
  "manage_permissions",
];

export type DisciplineScope =
  | { type: "class"; grade: number; classNum: number }
  | { type: "grade"; grade: number }
  | { type: "all" };

export interface DisciplineGrant {
  id: string;
  teacherEmail: string;
  scope: DisciplineScope;
  rights: DisciplineRight[];
  grantedBy: string;
  grantedAt: number | null;  // epoch millis (API 응답 직렬화 기준)
  expiresAt: number | null;  // 학년도 말 자동 만료용 (선택)
}

// ── 담임 반 ────────────────────────────────────────────────────
// 단일 원본: 승인된 교직원 프로필 teacher_profiles/{email}의 { isHomeroom, homeroom }.
// (별도 담임 배정표 컬렉션은 2026-07-25 베이스 데이터 중복 제거로 폐기)

export interface HomeroomClass {
  grade: number;
  classNum: number;
}

// ── 지도 기록 (discipline_records/{domain}/records/{recordId}) ─

export interface DisciplineRecord {
  id: string;
  studentId: string;     // "10101" — 기록 시점 스냅샷
  studentEmail: string;
  studentName: string;
  grade: number;
  classNum: number;
  itemId: string;
  occurredAt: number;    // epoch millis (발생 시점 — 회차 집계 기준)
  note: string;          // 비고 (예: "6/26 사복 착용(1교시)")
  recordedBy: string;
  recordedAt: number | null;
  // 삭제 금지 — 무효화만 허용
  voided: boolean;
  voidedBy?: string;
  voidedAt?: number | null;
  voidReason?: string;
}

// ── 단계 이력 (discipline_stage_events/{domain}/events/{eventId}) ─

export interface DisciplineStageEvent {
  id: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  grade: number;
  classNum: number;
  stageId: string;
  enteredAt: number;             // epoch millis
  cause: "auto" | "manual";
  causeRecordIds: string[];      // auto: 트리거된 기록 id들 / manual: 빈 배열
  manualReason?: string;         // manual 사유
  createdBy: string;
  resolved: boolean;
  resolvedAt?: number | null;
  resolvedBy?: string;
  resolution?: string;           // 조치 내용
}

// ── 판정 결과 ──────────────────────────────────────────────────

/** 학생 1명의 현재 상태(저장하지 않고 서버에서 계산) */
export interface StudentDisciplineStatus {
  studentId: string;
  /** itemId → 마지막 리셋 이후 유효(무효화 제외) 기록 횟수 */
  counts: Record<string, number>;
  /** category → 횟수 */
  categoryCounts: Record<string, number>;
  /** 충족된 규칙들 */
  triggered: {
    ruleId: string;
    targetStageId: string;
    count: number;
    threshold: number;
  }[];
  /** 규칙 계산으로 산출된 단계 (충족 규칙 중 최상위 order) */
  computedStageId: string | null;
  /** 마지막 리셋 이후 최신 manual 이벤트의 단계 */
  manualStageId: string | null;
  /** 최종 판정 단계 — manual 우선 적용 규칙 반영 */
  currentStageId: string | null;
}
