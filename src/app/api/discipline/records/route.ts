import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  loadAuthzContext,
  parseStudentIdStrict,
  recordFromDoc,
  recordsColRef,
  stageEventFromDoc,
  stageEventsColRef,
} from "@/lib/discipline/server";
import { judgeDiscipline } from "@/lib/discipline/authz";
import {
  computeStatusesForStudents,
  computeStudentStatus,
  getResetMarkerMs,
} from "@/lib/discipline/engine";
import { DisciplineRecord, DisciplineStageEvent } from "@/lib/discipline/types";

/**
 * Phase 6b: 생활지도 기록 API
 *
 * POST /api/discipline/records
 * - action: "create" → 기록 입력 (record 권한, 해당 반)
 * - action: "void"   → 기록 무효화 (본인 기록 또는 manage_rules) — 삭제는 존재하지 않는다
 * - action: "list"   → 기록 + 학생별 현재 단계 계산 결과 조회 (view 권한, 요청 범위)
 *
 * 보안 원칙:
 * - grade/classNum은 클라이언트 값을 신뢰하지 않고 서버가 studentId에서 파싱해 강제한다.
 * - Firestore 조회는 등호 필터만 사용(복합 색인 불필요), 정렬·리셋 필터는 메모리에서.
 */

const MAX_NOTE_LEN = 1000;

/** 학생의 전체 기록·이벤트를 로드 (등호 필터 1개짜리 쿼리 2개) */
async function loadStudentHistory(domain: string, studentId: string) {
  const [recSnap, evtSnap] = await Promise.all([
    recordsColRef(domain).where("studentId", "==", studentId).get(),
    stageEventsColRef(domain).where("studentId", "==", studentId).get(),
  ]);
  const records = recSnap.docs.map((d) => recordFromDoc(d.id, d.data()));
  const events = evtSnap.docs.map((d) => stageEventFromDoc(d.id, d.data()));
  return { records, events };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (auth.role === "student")
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

    const domain = auth.email.split("@")[1];
    if (!domain)
      return NextResponse.json({ error: "도메인 정보를 확인할 수 없습니다." }, { status: 400 });

    const body = await req.json();
    const { action } = body;
    const { ctx, config } = await loadAuthzContext(domain, auth);

    // ── 기록 입력 ──
    if (action === "create") {
      const parsed = parseStudentIdStrict(body.studentId);
      if (!parsed)
        return NextResponse.json(
          { error: "학번 형식이 올바르지 않습니다. (5자리, 예: 10101)" },
          { status: 400 }
        );
      const studentId = String(body.studentId).trim();
      const { grade, classNum } = parsed;

      const judgment = judgeDiscipline(ctx, "record", { grade, classNum });
      if (!judgment.allowed)
        return NextResponse.json(
          { error: `${grade}학년 ${classNum}반에 대한 기록 권한이 없습니다.` },
          { status: 403 }
        );

      const item = config.items.find((it) => it.id === body.itemId);
      if (!item || !item.active)
        return NextResponse.json(
          { error: "존재하지 않거나 비활성화된 지도 항목입니다." },
          { status: 400 }
        );

      const occurredAtMs = Date.parse(body.occurredAt);
      if (!Number.isFinite(occurredAtMs))
        return NextResponse.json({ error: "발생 일시 형식이 올바르지 않습니다." }, { status: 400 });
      const nowMs = Date.now();
      if (occurredAtMs > nowMs + 24 * 60 * 60 * 1000 || occurredAtMs < Date.parse("2020-01-01"))
        return NextResponse.json({ error: "발생 일시가 유효 범위를 벗어났습니다." }, { status: 400 });

      const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LEN) : "";
      const studentName =
        typeof body.studentName === "string" ? body.studentName.trim().slice(0, 50) : "";

      const recordId = "rec_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
      const studentEmail = `${studentId}@${domain}`;

      await recordsColRef(domain).doc(recordId).set({
        studentId,
        studentEmail,
        studentName,
        grade,
        classNum,
        itemId: item.id,
        occurredAt: Timestamp.fromMillis(occurredAtMs),
        note,
        recordedBy: auth.email,
        recordedAt: Timestamp.now(),
        voided: false,
      });

      // ── 단계 자동 판정: 이 기록으로 새 단계에 도달했으면 auto 이벤트 생성 (처리함 큐 공급) ──
      const { records, events } = await loadStudentHistory(domain, studentId);
      const gradeRecords = records.filter((r) => r.grade === grade);
      const status = computeStudentStatus(config, studentId, grade, gradeRecords, events);

      let createdEventId: string | null = null;
      if (status.computedStageId) {
        const markerMs = getResetMarkerMs(config, grade);
        const alreadyEvented = events.some(
          (e) => e.stageId === status.computedStageId && e.enteredAt > markerMs
        );
        if (!alreadyEvented) {
          // 해당 단계를 트리거한 규칙의 대상 기록 id들 (item 또는 category 기준)
          const triggers = status.triggered.filter(
            (t) => t.targetStageId === status.computedStageId
          );
          const triggerRules = config.rules.filter((r) =>
            triggers.some((t) => t.ruleId === r.id)
          );
          const itemById = new Map(config.items.map((it) => [it.id, it]));
          const causeRecordIds = gradeRecords
            .filter((r) => !r.voided && r.occurredAt > markerMs)
            .filter((r) =>
              triggerRules.some((rule) =>
                rule.trigger.itemId
                  ? rule.trigger.itemId === r.itemId
                  : rule.trigger.category === itemById.get(r.itemId)?.category
              )
            )
            .map((r) => r.id);

          createdEventId = "evt_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
          await stageEventsColRef(domain).doc(createdEventId).set({
            studentId,
            studentEmail,
            studentName,
            grade,
            classNum,
            stageId: status.computedStageId,
            enteredAt: Timestamp.now(),
            cause: "auto",
            causeRecordIds,
            createdBy: auth.email,
            resolved: false,
          });
        }
      }

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 기록자",
        action: "생활지도 기록 입력",
        targetEmail: studentEmail,
        details: `${grade}학년 ${classNum}반 ${studentId} — ${item.label}${
          createdEventId ? " (단계 도달 이벤트 생성)" : ""
        } (판정 근거: ${judgment.basis})`,
        status: "success",
      });

      return NextResponse.json({
        success: true,
        recordId,
        status,
        stageEventCreated: Boolean(createdEventId),
      });
    }

    // ── 기록 무효화 (삭제 대체) ──
    if (action === "void") {
      const recordId = body.recordId;
      if (!recordId || typeof recordId !== "string")
        return NextResponse.json({ error: "무효화할 기록 id가 없습니다." }, { status: 400 });
      const voidReason =
        typeof body.voidReason === "string" ? body.voidReason.trim().slice(0, 500) : "";
      if (!voidReason)
        return NextResponse.json({ error: "무효화 사유를 입력해야 합니다." }, { status: 400 });

      const snap = await recordsColRef(domain).doc(recordId).get();
      if (!snap.exists)
        return NextResponse.json({ error: "기록을 찾을 수 없습니다." }, { status: 404 });
      const record = recordFromDoc(snap.id, snap.data()!);
      if (record.voided)
        return NextResponse.json({ error: "이미 무효화된 기록입니다." }, { status: 400 });

      // 무효화 권한: 본인이 입력한 기록이거나 규정 관리 권한 보유자
      const isSelf = record.recordedBy.toLowerCase() === auth.email.toLowerCase();
      const manageJudgment = judgeDiscipline(ctx, "manage_rules");
      if (!isSelf && !manageJudgment.allowed)
        return NextResponse.json(
          { error: "본인이 입력한 기록 또는 규정 관리 권한자만 무효화할 수 있습니다." },
          { status: 403 }
        );

      await recordsColRef(domain).doc(recordId).update({
        voided: true,
        voidedBy: auth.email,
        voidedAt: Timestamp.now(),
        voidReason,
      });

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 기록자",
        action: "생활지도 기록 무효화",
        targetEmail: record.studentEmail,
        details: `기록 ${recordId} (${record.itemId}) 무효화 — 사유: ${voidReason} (근거: ${
          isSelf ? "본인 기록" : manageJudgment.basis
        })`,
        status: "success",
      });
      return NextResponse.json({ success: true, recordId });
    }

    // ── 기록·현황 조회 ──
    if (action === "list") {
      const includeVoided = body.includeVoided === true;
      let records: DisciplineRecord[] = [];
      let events: DisciplineStageEvent[] = [];
      let targetGrade: number;

      if (body.studentId) {
        // 학생 1명 조회 — 범위는 학번에서 서버가 도출
        const parsed = parseStudentIdStrict(body.studentId);
        if (!parsed)
          return NextResponse.json({ error: "학번 형식이 올바르지 않습니다." }, { status: 400 });
        const judgment = judgeDiscipline(ctx, "view", {
          grade: parsed.grade,
          classNum: parsed.classNum,
        });
        if (!judgment.allowed)
          return NextResponse.json({ error: "해당 학생에 대한 열람 권한이 없습니다." }, { status: 403 });

        const history = await loadStudentHistory(domain, String(body.studentId).trim());
        records = history.records;
        events = history.events;
        targetGrade = parsed.grade;
      } else {
        // 반/학년 조회
        const grade = Number(body.grade);
        if (!Number.isInteger(grade) || grade < 1 || grade > 3)
          return NextResponse.json({ error: "학년은 1~3 사이여야 합니다." }, { status: 400 });
        const classNum =
          body.classNum !== undefined && body.classNum !== null && body.classNum !== ""
            ? Number(body.classNum)
            : undefined;
        if (classNum !== undefined && (!Number.isInteger(classNum) || classNum < 1 || classNum > 30))
          return NextResponse.json({ error: "반 번호가 올바르지 않습니다." }, { status: 400 });

        const judgment = judgeDiscipline(ctx, "view", { grade, classNum });
        if (!judgment.allowed)
          return NextResponse.json(
            { error: "요청한 범위에 대한 열람 권한이 없습니다." },
            { status: 403 }
          );

        // 등호 필터만 조합 (grade [+ classNum]) — 복합 색인 불필요
        let recQuery = recordsColRef(domain).where("grade", "==", grade);
        let evtQuery = stageEventsColRef(domain).where("grade", "==", grade);
        if (classNum !== undefined) {
          recQuery = recQuery.where("classNum", "==", classNum);
          evtQuery = evtQuery.where("classNum", "==", classNum);
        }
        const [recSnap, evtSnap] = await Promise.all([recQuery.get(), evtQuery.get()]);
        records = recSnap.docs.map((d) => recordFromDoc(d.id, d.data()));
        events = evtSnap.docs.map((d) => stageEventFromDoc(d.id, d.data()));
        targetGrade = grade;
      }

      // 학생별 현재 단계 계산 (회차 집계는 현재 학년 기록만 — 진급 전 기록 혼입 방지)
      const gradeRecords = records.filter((r) => r.grade === targetGrade);
      const studentIds = Array.from(new Set(gradeRecords.map((r) => r.studentId)));
      const statuses = computeStatusesForStudents(
        config,
        studentIds.map((id) => ({ studentId: id, grade: targetGrade })),
        gradeRecords,
        events
      );

      const visibleRecords = (includeVoided ? records : records.filter((r) => !r.voided)).sort(
        (a, b) => b.occurredAt - a.occurredAt
      );

      return NextResponse.json({
        records: visibleRecords,
        statuses,
        resetMarker: getResetMarkerMs(config, targetGrade) || null,
      });
    }

    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("[Discipline Records API Error]:", error);
    return NextResponse.json(
      { error: `기록 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
