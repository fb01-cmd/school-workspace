import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { canManageTimetable } from "@/lib/timetable/authz";
import {
  activateTerm,
  approveSwapRequest,
  commitTimetableImport,
  computeDirectCandidates,
  computeHourTotals,
  deleteTerm,
  directCommit,
  listNeisRows,
  listSwapRequests,
  validatePendingSwapRequests,
  listWeeks,
  loadAllTerms,
  loadTimetableSettings,
  registerWeek,
  rejectSwapRequest,
  revertTimetableChange,
  saveTimetableSettings,
  updateWeek,
  validateTimetableImport,
} from "@/lib/timetable/server";
import { ManageAction, ManageTimetableRequest } from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }

    const domain = auth.email.split("@")[1] || "hmh.or.kr";
    const body: ManageTimetableRequest = await req.json().catch(() => ({} as any));
    const action: ManageAction = body.action;

    if (!action) {
      return NextResponse.json({ error: "action 파라미터가 누락되었습니다." }, { status: 400 });
    }

    const settings = await loadTimetableSettings(domain);
    const authzCtx = {
      role: auth.role,
      email: auth.email,
      managerEmails: settings.managerEmails,
      observerEmails: settings.observerEmails,
    };

    const judgment = canManageTimetable(authzCtx, action);
    if (!judgment.allowed) {
      return NextResponse.json(
        { error: "시간표 관리 권한이 없습니다.", basis: judgment.basis },
        { status: 403 }
      );
    }

    switch (action) {
      case "get_settings": {
        const terms = await loadAllTerms(domain);
        return NextResponse.json({
          success: true,
          action,
          settings,
          terms,
        });
      }

      case "set_managers": {
        if (!Array.isArray(body.managerEmails)) {
          return NextResponse.json(
            { error: "managerEmails 배열이 유효하지 않습니다." },
            { status: 400 }
          );
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const invalidEmails = body.managerEmails.filter(
          (email: string) => !emailRegex.test(email)
        );
        if (invalidEmails.length > 0) {
          return NextResponse.json(
            { error: `올바르지 않은 이메일 형식이 포함되어 있습니다: ${invalidEmails.join(", ")}` },
            { status: 400 }
          );
        }
        const updatedSettings = await saveTimetableSettings(domain, {
          managerEmails: body.managerEmails,
        });

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "set_timetable_managers",
          details: `시간표 일과계 관리자 변경: ${body.managerEmails.join(", ")}`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          settings: updatedSettings,
        });
      }

      case "set_observers": {
        // phase9b_spec §5 — observerEmails (열람 전용 참관자) 저장, super_admin 전용
        if (!Array.isArray(body.observerEmails)) {
          return NextResponse.json(
            { error: "observerEmails 배열이 유효하지 않습니다." },
            { status: 400 }
          );
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const invalidObservers = body.observerEmails.filter(
          (email: string) => !emailRegex.test(email)
        );
        if (invalidObservers.length > 0) {
          return NextResponse.json(
            { error: `올바르지 않은 이메일 형식이 포함되어 있습니다: ${invalidObservers.join(", ")}` },
            { status: 400 }
          );
        }
        const updatedObserverSettings = await saveTimetableSettings(domain, {
          observerEmails: body.observerEmails,
        });

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "set_timetable_observers",
          details: `시간표 열람 전용 참관자 변경: ${body.observerEmails.join(", ")}`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          settings: updatedObserverSettings,
        });
      }

      case "import_validate": {
        if (!body.importPayload) {
          return NextResponse.json(
            { error: "importPayload 데이터가 누락되었습니다." },
            { status: 400 }
          );
        }
        const validationReport = validateTimetableImport(body.importPayload);
        return NextResponse.json({
          success: true,
          action,
          validationReport,
        });
      }

      case "import_commit": {
        if (!body.importPayload) {
          return NextResponse.json(
            { error: "importPayload 데이터가 누락되었습니다." },
            { status: 400 }
          );
        }
        const validationReport = validateTimetableImport(body.importPayload);
        if (!validationReport.canCommit) {
          return NextResponse.json(
            {
              error: "미매칭 교사명이 존재하여 학기를 저장할 수 없습니다.",
              validationReport,
            },
            { status: 400 }
          );
        }

        const term = await commitTimetableImport(domain, body.importPayload, auth.email);
        const terms = await loadAllTerms(domain);

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: term.id,
          action: "import_timetable_draft",
          details: `시간표 임시(draft) 학기 생성: ${term.name} (${term.id})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          term,
          terms,
        });
      }

      case "activate_term": {
        if (!body.termId) {
          return NextResponse.json({ error: "termId가 누락되었습니다." }, { status: 400 });
        }
        const term = await activateTerm(domain, body.termId);
        const terms = await loadAllTerms(domain);
        const updatedSettings = await loadTimetableSettings(domain);

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: term.id,
          action: "activate_timetable_term",
          details: `시간표 정식 학기 활성화: ${term.name} (${term.id})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          term,
          terms,
          settings: updatedSettings,
        });
      }

      case "delete_term": {
        if (!body.termId) {
          return NextResponse.json({ error: "termId가 누락되었습니다." }, { status: 400 });
        }
        await deleteTerm(domain, body.termId);
        const terms = await loadAllTerms(domain);

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: body.termId,
          action: "delete_timetable_term",
          details: `시간표 초안 학기 삭제: ${body.termId}`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          terms,
        });
      }

      // ── Phase 9b (phase9b_spec §6) ──────────────────────────

      case "week_register": {
        if (!body.week?.termId || !body.week?.startDate) {
          return NextResponse.json({ error: "week.termId와 week.startDate가 필요합니다." }, { status: 400 });
        }
        const week = await registerWeek(domain, body.week, auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: week.id,
          action: "register_timetable_week",
          details: `시간표 주 등록: ${week.id} (${week.termId})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, week });
      }

      case "week_update": {
        if (!body.weekId) {
          return NextResponse.json({ error: "weekId가 누락되었습니다." }, { status: 400 });
        }
        const week = await updateWeek(domain, body.weekId, body.week || {}, auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: week.id,
          action: "update_timetable_week",
          details: `시간표 주 수정: ${week.id}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, week });
      }

      case "week_list": {
        const weeks = await listWeeks(domain, body.termId);
        return NextResponse.json({ success: true, action, weeks });
      }

      case "request_list": {
        const requests = await listSwapRequests(domain, {
          weekId: body.weekId,
          status: body.status,
        });
        // PENDING 사전 검증: 먼저 승인된 건 때문에 이미 성립 불가한 신청을 목록에 표시
        const validity = await validatePendingSwapRequests(domain, requests);
        return NextResponse.json({ success: true, action, requests, validity, readOnly: judgment.basis === "observer_read" });
      }

      case "approve": {
        if (!body.requestId) {
          return NextResponse.json({ error: "requestId가 누락되었습니다." }, { status: 400 });
        }
        const { request, change } = await approveSwapRequest(domain, auth.email, body.requestId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "approve_swap_request",
          details: `수업교환 승인: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}) → change ${change.id}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, request, change });
      }

      case "reject": {
        if (!body.requestId) {
          return NextResponse.json({ error: "requestId가 누락되었습니다." }, { status: 400 });
        }
        if (!body.decisionNote?.trim()) {
          return NextResponse.json({ error: "반려 사유는 필수입니다." }, { status: 400 });
        }
        const request = await rejectSwapRequest(domain, auth.email, body.requestId, body.decisionNote);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "reject_swap_request",
          details: `수업교환 반려: ${body.requestId} — ${body.decisionNote}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, request });
      }

      case "direct_candidates": {
        if (!body.weekId || !body.source) {
          return NextResponse.json({ error: "weekId와 source가 필요합니다." }, { status: 400 });
        }
        const { grade, classNum, day, period } = body.source;
        if (![grade, classNum, day, period].every((n) => Number.isInteger(n) && n > 0)) {
          return NextResponse.json({ error: "source 슬롯 값이 유효하지 않습니다." }, { status: 400 });
        }
        const result = await computeDirectCandidates(
          domain, body.weekId,
          { grade, classNum, day, period, subjectName: "" },
          body.targetWeekId // 교차 주 맞교환 (§4-3b)
        );
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, action, ...result });
      }

      case "direct_commit": {
        if (!body.weekId || !body.source || !body.type || !body.candidate) {
          return NextResponse.json(
            { error: "weekId, source, type, candidate가 모두 필요합니다." },
            { status: 400 }
          );
        }
        if (body.type !== "swap" && body.type !== "substitute") {
          return NextResponse.json({ error: "type은 swap 또는 substitute여야 합니다." }, { status: 400 });
        }
        const { grade, classNum, day, period } = body.source;
        const { request, change } = await directCommit(domain, auth.email, {
          weekId: body.weekId,
          type: body.type,
          source: { grade, classNum, day, period, subjectName: body.source.subjectName || "" },
          candidate: body.candidate,
          reason: body.reason,
          targetWeekId: body.targetWeekId,
        });
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "direct_swap_commit",
          details: `일과계 직권 배정: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}${request.targetWeekId ? `, 교차 주 → ${request.targetWeekId}` : ""}) → change ${change.id}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, request, change });
      }

      case "revert_change": {
        if (!body.changeId) {
          return NextResponse.json({ error: "changeId가 누락되었습니다." }, { status: 400 });
        }
        const revert = await revertTimetableChange(domain, auth.email, body.changeId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: body.changeId,
          action: "revert_timetable_change",
          details: `수업교환 승인 취소(revert): ${body.changeId} → ${revert.id}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, change: revert });
      }

      case "neis_list": {
        // phase9b_spec §8 — NEIS 입력용 수업교환 목록 (읽기 전용, 일과계·super_admin)
        if (!body.startDate || !body.endDate) {
          return NextResponse.json(
            { error: "startDate와 endDate가 필요합니다." },
            { status: 400 }
          );
        }
        const rows = await listNeisRows(domain, {
          termId: body.termId,
          startDate: body.startDate,
          endDate: body.endDate,
          type: body.type,
        });
        return NextResponse.json({ success: true, action, rows });
      }

      case "hour_totals": {
        // phase9b_spec §8 — 시수 집계 (읽기 전용, 저장 없음, 실시수만 — §12-3)
        if (!body.endDate) {
          return NextResponse.json({ error: "endDate가 필요합니다." }, { status: 400 });
        }
        const totals = await computeHourTotals(domain, {
          termId: body.termId,
          endDate: body.endDate,
        });
        return NextResponse.json({ success: true, action, totals });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[POST /api/timetable/manage] Error:", error);
    return NextResponse.json(
      { error: error.message || "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
