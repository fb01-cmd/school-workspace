import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { getUser } from "@/lib/google/workspace";
import {
  loadAuthzContext,
  parseStudentIdStrict,
  stageEventFromDoc,
  stageEventsColRef,
} from "@/lib/discipline/server";
import { computeAccessTargets, judgeDiscipline } from "@/lib/discipline/authz";
import { DisciplineStageEvent } from "@/lib/discipline/types";

/**
 * Phase 6b: 생활지도 단계 이벤트(처리함) API
 *
 * POST /api/discipline/stage-events
 * - action: "list"          → 단계 도달 이벤트 조회 (view 권한 — 기본은 미처리 큐)
 * - action: "resolve"       → 조치 입력·처리 완료 (resolve 권한, 해당 반)
 * - action: "create_manual" → 수동 단계 지정 (resolve 권한) — 계산 결과보다 우선 적용됨
 */

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

    // ── 이벤트 조회 (처리함/이력) ──
    if (action === "list") {
      const onlyPending = body.onlyPending !== false; // 기본: 미처리만
      let events: DisciplineStageEvent[] = [];

      if (body.studentId) {
        const parsed = parseStudentIdStrict(body.studentId);
        if (!parsed)
          return NextResponse.json({ error: "학번 형식이 올바르지 않습니다." }, { status: 400 });
        const judgment = judgeDiscipline(ctx, "view", {
          grade: parsed.grade,
          classNum: parsed.classNum,
        });
        if (!judgment.allowed)
          return NextResponse.json({ error: "해당 학생에 대한 열람 권한이 없습니다." }, { status: 403 });
        const snap = await stageEventsColRef(domain)
          .where("studentId", "==", String(body.studentId).trim())
          .get();
        events = snap.docs.map((d) => stageEventFromDoc(d.id, d.data()));
        if (onlyPending) events = events.filter((e) => !e.resolved);
      } else {
        // 요청 범위 중 허용된 부분만 자동 축소 — 담임/반 단위 grant는 자기 반만 반환
        // (⚠️ target 없이 view를 판정하면 반 단위 grant도 전역 통과되므로 반드시 범위 단위로 판정)
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

        // 등호 계열 필터만 조합 (grade == / classNum in / resolved ==) — 복합 색인 불필요
        const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [];
        for (const t of targets) {
          const classChunks: (number[] | null)[] =
            t.classNums === "all"
              ? [null]
              : Array.from({ length: Math.ceil(t.classNums.length / 10) }, (_, i) =>
                  (t.classNums as number[]).slice(i * 10, i * 10 + 10)
                );
          for (const chunk of classChunks) {
            let q = stageEventsColRef(domain).where("grade", "==", t.grade);
            if (chunk) q = q.where("classNum", "in", chunk);
            if (onlyPending) q = q.where("resolved", "==", false);
            queries.push(q.get());
          }
        }
        const snaps = await Promise.all(queries);
        events = snaps.flatMap((s) => s.docs.map((d) => stageEventFromDoc(d.id, d.data())));
      }

      events.sort((a, b) => b.enteredAt - a.enteredAt);
      return NextResponse.json({ events });
    }

    // ── 조치 입력·처리 완료 ──
    if (action === "resolve") {
      const eventId = body.eventId;
      if (!eventId || typeof eventId !== "string")
        return NextResponse.json({ error: "처리할 이벤트 id가 없습니다." }, { status: 400 });
      const resolution =
        typeof body.resolution === "string" ? body.resolution.trim().slice(0, 2000) : "";
      if (!resolution)
        return NextResponse.json({ error: "조치 내용을 입력해야 합니다." }, { status: 400 });

      const snap = await stageEventsColRef(domain).doc(eventId).get();
      if (!snap.exists)
        return NextResponse.json({ error: "이벤트를 찾을 수 없습니다." }, { status: 404 });
      const event = stageEventFromDoc(snap.id, snap.data()!);
      if (event.resolved)
        return NextResponse.json({ error: "이미 처리 완료된 이벤트입니다." }, { status: 400 });

      const judgment = judgeDiscipline(ctx, "resolve", {
        grade: event.grade,
        classNum: event.classNum,
      });
      if (!judgment.allowed)
        return NextResponse.json({ error: "단계 처리 권한이 없습니다." }, { status: 403 });

      await stageEventsColRef(domain).doc(eventId).update({
        resolved: true,
        resolvedAt: Timestamp.now(),
        resolvedBy: auth.email,
        resolution,
      });

      const stageLabel =
        config.stages.find((s) => s.id === event.stageId)?.label || event.stageId;
      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 단계 처리자",
        action: "생활지도 단계 처리",
        targetEmail: event.studentEmail,
        details: `${event.grade}학년 ${event.classNum}반 ${event.studentId} — ${stageLabel} 처리 완료 (판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true, eventId });
    }

    // ── 수동 단계 지정 ──
    if (action === "create_manual") {
      const parsed = parseStudentIdStrict(body.studentId);
      if (!parsed)
        return NextResponse.json({ error: "학번 형식이 올바르지 않습니다." }, { status: 400 });
      const studentId = String(body.studentId).trim();
      const { grade, classNum } = parsed;

      const judgment = judgeDiscipline(ctx, "resolve", { grade, classNum });
      if (!judgment.allowed)
        return NextResponse.json({ error: "수동 단계 지정 권한이 없습니다." }, { status: 403 });

      const stage = config.stages.find((s) => s.id === body.stageId);
      if (!stage)
        return NextResponse.json({ error: "존재하지 않는 단계입니다." }, { status: 400 });

      const manualReason =
        typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      if (!manualReason)
        return NextResponse.json({ error: "수동 지정 사유를 입력해야 합니다." }, { status: 400 });
      const studentName =
        typeof body.studentName === "string" ? body.studentName.trim().slice(0, 50) : "";

      // 학생 실이메일 검증 (산출물 D 보완) — 합성 주소(학번@도메인) 저장 금지.
      // records create와 동일: 클라이언트가 명단의 실이메일을 보내고, 서버가 Directory의
      // familyName(학번)과 대조해 위조를 막는다.
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

      const eventId = "evt_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
      await stageEventsColRef(domain).doc(eventId).set({
        studentId,
        studentEmail,
        studentName,
        grade,
        classNum,
        stageId: stage.id,
        enteredAt: Timestamp.now(),
        cause: "manual",
        causeRecordIds: [],
        manualReason,
        createdBy: auth.email,
        resolved: false,
      });

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 단계 처리자",
        action: "생활지도 수동 단계 지정",
        targetEmail: `${studentId}@${domain}`,
        details: `${grade}학년 ${classNum}반 ${studentId} → ${stage.label} 수동 지정 — 사유: ${manualReason} (판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true, eventId });
    }

    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("[Discipline Stage Events API Error]:", error);
    return NextResponse.json(
      { error: `단계 이벤트 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
