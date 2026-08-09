import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { getUser } from "@/lib/google/workspace";
import {
  loadAuthzContext,
  parseStudentIdStrict,
  recordFromDoc,
  recordsColRef,
  stageEventFromDoc,
  stageEventsColRef,
  triggerAutoStageEventIfNeeded,
} from "@/lib/discipline/server";
import {
  computeAccessTargets,
  GradeAccessTarget,
  judgeDiscipline,
} from "@/lib/discipline/authz";
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

/**
 * 접근 허용 범위(targets)별로 기록·이벤트를 조회.
 * 반 목록은 where-in(10개 단위 청크)으로 조회 — 등호 계열 필터라 복합 색인 불필요.
 */
async function fetchByTargets(domain: string, targets: GradeAccessTarget[]) {
  const recQueries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  const evtQueries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
  for (const t of targets) {
    if (t.classNums === "all") {
      recQueries.push(recordsColRef(domain).where("grade", "==", t.grade).get());
      evtQueries.push(stageEventsColRef(domain).where("grade", "==", t.grade).get());
    } else {
      for (let i = 0; i < t.classNums.length; i += 10) {
        const chunk = t.classNums.slice(i, i + 10);
        recQueries.push(
          recordsColRef(domain)
            .where("grade", "==", t.grade)
            .where("classNum", "in", chunk)
            .get()
        );
        evtQueries.push(
          stageEventsColRef(domain)
            .where("grade", "==", t.grade)
            .where("classNum", "in", chunk)
            .get()
        );
      }
    }
  }
  const [recSnaps, evtSnaps] = await Promise.all([
    Promise.all(recQueries),
    Promise.all(evtQueries),
  ]);
  return {
    records: recSnaps.flatMap((s) => s.docs.map((d) => recordFromDoc(d.id, d.data()))),
    events: evtSnaps.flatMap((s) => s.docs.map((d) => stageEventFromDoc(d.id, d.data()))),
  };
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

      // 발생 일시: ISO 문자열 또는 epoch millis 숫자 모두 허용
      const occurredAtMs =
        typeof body.occurredAt === "number" ? body.occurredAt : Date.parse(body.occurredAt);
      if (!Number.isFinite(occurredAtMs))
        return NextResponse.json({ error: "발생 일시 형식이 올바르지 않습니다." }, { status: 400 });
      const nowMs = Date.now();
      if (occurredAtMs > nowMs + 24 * 60 * 60 * 1000 || occurredAtMs < Date.parse("2020-01-01"))
        return NextResponse.json({ error: "발생 일시가 유효 범위를 벗어났습니다." }, { status: 400 });

      const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LEN) : "";
      const studentName =
        typeof body.studentName === "string" ? body.studentName.trim().slice(0, 50) : "";

      // 학생 실이메일 검증 (Phase 11 산출물 D) — 합성 주소(학번@도메인) 저장 금지.
      // 학생 실계정은 입학년도 기반(예: 26027@)이라 학번과 다르다. 클라이언트가 명단에서
      // 고른 실이메일을 보내고, 서버는 Directory의 familyName(학번)과 대조해 위조를 막는다.
      const studentEmail =
        typeof body.studentEmail === "string" ? body.studentEmail.trim().toLowerCase() : "";
      if (!studentEmail || !studentEmail.endsWith(`@${domain}`))
        return NextResponse.json(
          { error: "학생 이메일이 없거나 학교 도메인이 아닙니다. 명단에서 학생을 선택해 주세요." },
          { status: 400 }
        );
      let dirFamilyName = "";
      try {
        const dirUser = await getUser(studentEmail);
        dirFamilyName =
          typeof dirUser?.name === "object" ? String(dirUser.name?.familyName || "").trim() : "";
      } catch {
        dirFamilyName = "";
      }
      if (dirFamilyName !== studentId)
        return NextResponse.json(
          {
            error:
              "학생 계정 확인에 실패했거나 이메일과 학번이 명단과 일치하지 않습니다. 명단에서 학생을 다시 선택해 주세요.",
          },
          { status: 400 }
        );

      const recordId = "rec_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");

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
      const { createdEventId, status } = await triggerAutoStageEventIfNeeded({
        domain,
        config,
        studentId,
        studentEmail,
        studentName,
        grade,
        classNum,
        operatorEmail: auth.email,
      });

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

      // 무효화 권한: 본인이 입력한 기록, 담임의 자기 반 학생 기록, 또는 규정 관리 권한 보유자
      // (담임 자기 반 확대는 2026-08-05 사용자 결정 — grant의 record 권한으로는 확대하지 않는다)
      const isSelf = record.recordedBy.toLowerCase() === auth.email.toLowerCase();
      const isOwnClassHomeroom = ctx.homeroomClasses.some(
        (h) => h.grade === record.grade && h.classNum === record.classNum
      );
      const manageJudgment = judgeDiscipline(ctx, "manage_rules");
      if (!isSelf && !isOwnClassHomeroom && !manageJudgment.allowed)
        return NextResponse.json(
          { error: "본인이 입력한 기록, 담임의 자기 반 기록, 또는 규정 관리 권한자만 무효화할 수 있습니다." },
          { status: 403 }
        );

      await recordsColRef(domain).doc(recordId).update({
        voided: true,
        voidedBy: auth.email,
        voidedAt: Timestamp.now(),
        voidReason,
      });

      // ── 무효화 시 미처리 단계 사안 자동 정리 (causeRecordIds에 해당 recordId 포함 + resolved=false) ──
      const eventsSnap = await stageEventsColRef(domain)
        .where("studentEmail", "==", record.studentEmail)
        .get();

      const affectedEvents = eventsSnap.docs
        .map((doc) => stageEventFromDoc(doc.id, doc.data()))
        .filter(
          (evt) =>
            !evt.resolved &&
            Array.isArray(evt.causeRecordIds) &&
            evt.causeRecordIds.includes(recordId)
        );

      const cleanedEventIds: string[] = [];
      for (const evt of affectedEvents) {
        await stageEventsColRef(domain).doc(evt.id).delete();
        cleanedEventIds.push(evt.id);
        await writeAuditLog({
          operatorEmail: auth.email,
          operatorName: "생활지도 관리자",
          action: "생활지도 미처리 사안 자동 삭제 (무효화 연동)",
          targetEmail: record.studentEmail,
          details: `기록 ${recordId} 무효화로 인해 원인 기록에 포함된 미처리 단계 사안 ${evt.id} (${evt.stageId} 단계) 자동 삭제`,
          status: "success",
        });
      }

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 기록자",
        action: "생활지도 기록 무효화",
        targetEmail: record.studentEmail,
        details: `기록 ${recordId} (${record.itemId}) 무효화 — 사유: ${voidReason} (근거: ${
          isSelf ? "본인 기록" : isOwnClassHomeroom ? "담임(자기 반)" : manageJudgment.basis
        })${cleanedEventIds.length > 0 ? ` [연동 삭제된 미처리 사안: ${cleanedEventIds.join(", ")}]` : ""}`,
        status: "success",
      });
      return NextResponse.json({ success: true, recordId, cleanedEventIds });
    }

    // ── 기록·현황 조회 ──
    if (action === "list") {
      const includeVoided = body.includeVoided === true;
      let records: DisciplineRecord[] = [];
      let events: DisciplineStageEvent[] = [];

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
      } else {
        // 반/학년 조회 — grade 생략 시 전체 학년 요청으로 보고, 허용된 범위만 자동 축소
        // (담임은 "전체" 조회 시 자기 반만 반환됨 — computeAccessTargets 참조)
        const requestedGrades: number[] =
          body.grade !== undefined && body.grade !== null && body.grade !== ""
            ? [Number(body.grade)]
            : [1, 2, 3];
        if (requestedGrades.some((g) => !Number.isInteger(g) || g < 1 || g > 3))
          return NextResponse.json({ error: "학년은 1~3 사이여야 합니다." }, { status: 400 });
        const classNum =
          body.classNum !== undefined && body.classNum !== null && body.classNum !== ""
            ? Number(body.classNum)
            : undefined;
        if (classNum !== undefined && (!Number.isInteger(classNum) || classNum < 1 || classNum > 30))
          return NextResponse.json({ error: "반 번호가 올바르지 않습니다." }, { status: 400 });

        const targets = computeAccessTargets(ctx, "view", requestedGrades, classNum);
        if (targets.length === 0)
          return NextResponse.json(
            { error: "요청한 범위에 대한 열람 권한이 없습니다." },
            { status: 403 }
          );

        const { records: fetchedRecords, events: fetchedEvents } = await fetchByTargets(
          domain,
          targets
        );
        records = fetchedRecords;
        events = fetchedEvents;
      }

      // 학생별 현재 단계 계산 — 학번이 학년을 내포하므로(진급 시 학번 변경) 학생별 grade는
      // 그 학생 기록의 스냅샷 grade와 동일하다. 학생 단위로 묶어 계산한다.
      const byStudent = new Map<string, DisciplineRecord[]>();
      for (const r of records) {
        const arr = byStudent.get(r.studentId) || [];
        arr.push(r);
        byStudent.set(r.studentId, arr);
      }
      const studentInputs = Array.from(byStudent.entries()).map(([id, recs]) => ({
        studentId: id,
        grade: recs[0].grade,
      }));
      const statuses = computeStatusesForStudents(config, studentInputs, records, events);

      // 화면(현황 탭)용 학생별 그룹 — 이름/이메일은 최신 기록 스냅샷 기준
      const students = studentInputs
        .map(({ studentId, grade }) => {
          const recs = (byStudent.get(studentId) || []).sort((a, b) => b.occurredAt - a.occurredAt);
          const latest = recs[0];
          return {
            studentId,
            studentEmail: latest.studentEmail,
            studentName: latest.studentName,
            grade,
            classNum: latest.classNum,
            status: statuses[studentId],
            // 무효화 기록 포함 — 타임라인 화면이 [무효화됨] 배지로 직접 표시·필터한다
            records: recs,
            stageEvents: events
              .filter((e) => e.studentId === studentId)
              .sort((a, b) => b.enteredAt - a.enteredAt),
          };
        })
        .sort((a, b) => a.studentId.localeCompare(b.studentId));

      const visibleRecords = (includeVoided ? records : records.filter((r) => !r.voided)).sort(
        (a, b) => b.occurredAt - a.occurredAt
      );

      const resetMarkers: Record<string, number | null> = {};
      for (const g of [1, 2, 3]) resetMarkers[String(g)] = getResetMarkerMs(config, g) || null;

      return NextResponse.json({
        records: visibleRecords,
        statuses,
        students,
        resetMarkers,
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
