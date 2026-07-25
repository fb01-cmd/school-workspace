/**
 * Phase 6b: 생활지도 단계 계산 엔진 (순수 함수 — Firestore 의존 없음)
 *
 * 핵심 원칙 (phase6_spec.md):
 * - 학생의 현재 단계는 저장하지 않고 계산한다: 마지막 리셋 이후 records + rules로 산출.
 *   규정이 바뀌면 재계산으로 자연 반영된다.
 * - 리셋 = 기록 삭제가 아니라 마커 갱신. 회차 집계는 "마커 이후 발생(occurredAt) 기록"만.
 * - 수동 개입(manual stage event)은 계산 결과보다 우선 적용하되, manual 이벤트 이후에
 *   새 기록이 쌓여 더 높은 단계가 계산되면 둘 중 상위 단계를 따른다.
 */

import {
  DisciplineConfig,
  DisciplineRecord,
  DisciplineStage,
  DisciplineStageEvent,
  StudentDisciplineStatus,
} from "./types";

/** 학년별 리셋 마커 조회 (없으면 0 = 전체 집계) */
export function getResetMarkerMs(config: DisciplineConfig, grade: number): number {
  const v = config.resetMarkers?.[String(grade)];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function stageOrder(stages: DisciplineStage[], stageId: string | null): number {
  if (!stageId) return -Infinity;
  const s = stages.find((st) => st.id === stageId);
  return s ? s.order : -Infinity;
}

/** 두 단계 중 order가 높은 쪽 반환 (동률이면 첫 번째) */
function higherStage(
  stages: DisciplineStage[],
  a: string | null,
  b: string | null
): string | null {
  if (!a) return b;
  if (!b) return a;
  return stageOrder(stages, b) > stageOrder(stages, a) ? b : a;
}

/**
 * 학생 1명의 현재 상태를 계산한다.
 *
 * @param records     해당 학생의 전체 기록 (필터 전 — 무효화/리셋 이전 기록도 포함 가능)
 * @param stageEvents 해당 학생의 단계 이벤트 (manual 우선 판정에 사용)
 */
export function computeStudentStatus(
  config: DisciplineConfig,
  studentId: string,
  grade: number,
  records: DisciplineRecord[],
  stageEvents: DisciplineStageEvent[]
): StudentDisciplineStatus {
  const markerMs = getResetMarkerMs(config, grade);

  // 1. 유효 기록: 본인 + 무효화 제외 + 마지막 리셋 이후 발생분
  const effective = records.filter(
    (r) => r.studentId === studentId && !r.voided && r.occurredAt > markerMs
  );

  // 2. 항목별/카테고리별 회차 집계
  const counts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const itemById = new Map(config.items.map((it) => [it.id, it]));
  for (const r of effective) {
    counts[r.itemId] = (counts[r.itemId] || 0) + 1;
    const cat = itemById.get(r.itemId)?.category;
    if (cat) categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  // 3. 규칙 판정: 회차 → 처리 단계 매핑 (countThreshold 이상이면 충족)
  const triggered: StudentDisciplineStatus["triggered"] = [];
  for (const rule of config.rules) {
    const t = rule.trigger;
    if (!t || !Number.isFinite(t.countThreshold)) continue;
    let count = 0;
    if (t.itemId) count = counts[t.itemId] || 0;
    else if (t.category) count = categoryCounts[t.category] || 0;
    else continue;
    if (count >= t.countThreshold) {
      triggered.push({
        ruleId: rule.id,
        targetStageId: rule.targetStageId,
        count,
        threshold: t.countThreshold,
      });
    }
  }

  // 4. 계산 단계 = 충족 규칙 중 최상위 order 단계
  let computedStageId: string | null = null;
  for (const t of triggered) {
    computedStageId = higherStage(config.stages, computedStageId, t.targetStageId);
  }

  // 5. manual 우선 적용: 리셋 이후 최신 manual 이벤트
  const manualEvents = stageEvents
    .filter(
      (e) =>
        e.studentId === studentId && e.cause === "manual" && e.enteredAt > markerMs
    )
    .sort((a, b) => b.enteredAt - a.enteredAt);
  const latestManual = manualEvents[0] || null;
  const manualStageId = latestManual ? latestManual.stageId : null;

  // 6. 최종 판정 — manual이 있으면 우선하되, manual 이후 새 기록이 더 높은 단계를
  //    계산해내면 상위 단계를 따른다 (수동 하향 후 재발 시 다시 상향되도록).
  let currentStageId: string | null;
  if (!latestManual) {
    currentStageId = computedStageId;
  } else {
    const hasNewerRecords = effective.some(
      (r) => r.occurredAt > latestManual.enteredAt
    );
    currentStageId = hasNewerRecords
      ? higherStage(config.stages, manualStageId, computedStageId)
      : manualStageId;
  }

  return {
    studentId,
    counts,
    categoryCounts,
    triggered,
    computedStageId,
    manualStageId,
    currentStageId,
  };
}

/**
 * 여러 학생의 상태를 일괄 계산 (현황 화면용).
 * records/stageEvents는 조회 범위(반/학년) 전체를 넘기면 학생별로 분류해 계산한다.
 */
export function computeStatusesForStudents(
  config: DisciplineConfig,
  students: { studentId: string; grade: number }[],
  records: DisciplineRecord[],
  stageEvents: DisciplineStageEvent[]
): Record<string, StudentDisciplineStatus> {
  const recsByStudent = new Map<string, DisciplineRecord[]>();
  for (const r of records) {
    const arr = recsByStudent.get(r.studentId) || [];
    arr.push(r);
    recsByStudent.set(r.studentId, arr);
  }
  const eventsByStudent = new Map<string, DisciplineStageEvent[]>();
  for (const e of stageEvents) {
    const arr = eventsByStudent.get(e.studentId) || [];
    arr.push(e);
    eventsByStudent.set(e.studentId, arr);
  }

  const out: Record<string, StudentDisciplineStatus> = {};
  for (const s of students) {
    out[s.studentId] = computeStudentStatus(
      config,
      s.studentId,
      s.grade,
      recsByStudent.get(s.studentId) || [],
      eventsByStudent.get(s.studentId) || []
    );
  }
  return out;
}
