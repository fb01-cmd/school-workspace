import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { canManageTimetable } from "@/lib/timetable/authz";
import { bumpTimetableCacheVersion } from "@/lib/timetable/cacheVersion";
import { listSimulCells } from "@/lib/timetable/simul";
import { findVenueBaseConflicts, listVenueCells } from "@/lib/timetable/venue";
import {
  activateTerm,
  applyRevisionDraft,
  approveSwapRequest,
  commitTimetableImport,
  deleteRevisionDraft,
  ensureDerivedWeeks,
  loadBaseRevisions,
  loadCalendarEvents,
  saveRevisionDraft,
  timetableCalendarColRef,
  validateCalendarEventPayload,
  validateRevisionOps,
  commitSimulGroupMove,
  computeCandidatesAllWeeks,
  computeChainSearch,
  computeDirectCandidates,
  computeSimulGroupMoveCandidates,
  computeDirectProjectedWeeks,
  computeHourTotals,
  deleteTerm,
  directCommit,
  listNeisRows,
  listSwapRequests,
  validatePendingSwapRequests,
  prepareHoursAssignmentJob,
  extractHoursAssignmentDept,
  finalizeHoursAssignmentJob,
  listWeeks,
  loadAllClassGrids,
  loadAllTerms,
  loadSimulGroups,
  loadTimetableSettings,
  loadVenueGroups,
  loadTeacherSlotBans,
  loadConsecutiveRules,
  loadCoTeachingRules,
  simulGroupsColRef,
  teacherSlotBansColRef,
  consecutiveRulesColRef,
  coTeachingRulesColRef,
  validateSimulGroupPayload,
  validateVenueGroupPayload,
  validateTeacherSlotBanPayload,
  validateConsecutiveRulePayload,
  validateCoTeachingRulePayload,
  venueGroupsColRef,
  registerWeek,
  getCalendarIcsInfo,
  rejectSwapRequest,
  revertTimetableChange,
  saveTimetableSettings,
  updateWeek,
  syncDerivedWeeksWithCalendar,
  runNeisCalendarSync,
  validateTimetableImport,
  listDrafts,
  createDraft,
  getDraft,
  deleteDraft,
  applyDraftOp,
  undoDraftOp,
  redoDraftOp,
  DraftOpConflictError,
  loadNeisMapRegistry,
  saveNeisMapRegistry,
  computeNeisCsvBundle,
  computeNeisPrecheck,
  loadTimetableTerm,
  computeAiDiagnosis,
  computeAiFormalize,
  computeAiExplain,
  computeAiCritique,
  listCurriculumCohorts,
  saveCurriculumCohort,
  deleteCurriculumCohort,
  listHoursPlans,
  getHoursPlan,
  deriveHoursPlanFromGrids,
  saveHoursPlan,
  assertRegistryEditable,
  RegistryLockError,
  deleteHoursPlan,
  buildBlankSolveInput,
  createDraftTerm,
  inheritRegistries,
  adoptDraftToTerm,
} from "@/lib/timetable/server";
import { sanitizeNeisMapPayload } from "@/lib/timetable/neis";
import { AiCallError, isAiEnabled } from "@/lib/timetable/ai";
import {
  DirectCommitBatchItemResult,
  ManageAction,
  ManageTimetableRequest,
  SCHEDULE_AFFECTING_TYPES,
} from "@/lib/timetable/types";
import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { notifyTimetableChanges } from "@/lib/push/webpush";
import { emitNotification } from "@/lib/notifications/server";
import type { TimetableChange } from "@/lib/timetable/types";

// 배정표 부서 추출은 AI 호출 최대 3회(1차+힌트 재시도 2회)가 직렬로 돌 수 있다
export const maxDuration = 300;

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

      case "set_publish_weeks_ahead": {
        const ahead = Number(body.publishWeeksAhead);
        if (!Number.isInteger(ahead) || ahead < 0 || ahead > 7) {
          return NextResponse.json(
            { error: "노출 범위(publishWeeksAhead)는 0~7 사이의 정수여야 합니다." },
            { status: 400 }
          );
        }
        const updatedSettings = await saveTimetableSettings(domain, {
          publishWeeksAhead: ahead,
        });

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "set_publish_weeks_ahead",
          details: `시간표 노출 범위 변경: 오늘 주 포함 총 ${ahead + 1}주 (publishWeeksAhead=${ahead})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          settings: updatedSettings,
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
        // 학사일정 지연 파생 (spec §B) — 오늘 주부터 publishWeeksAhead주 앞까지 없는 주 자동 생성.
        // 수동 등록 주는 덮지 않는다. 실패는 목록 반환을 막지 않는다.
        await ensureDerivedWeeks(domain).catch((e) =>
          console.error("[week_list] 주차 자동 파생 실패:", e?.message)
        );
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
        const approvedRequestId = body.requestId;
        const { request, change, changes } = await approveSwapRequest(domain, auth.email, approvedRequestId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "approve_swap_request",
          details: `수업교환 승인: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}) → change ${changes.map((c) => c.id).join(", ")}`,
          status: "success",
        });
        // 웹 푸시: 당사자 교사 + 해당 반 학생 (응답 후 발송, docs/web_push_spec.md §5).
        // §5c: 체인·통 이동은 change가 여러 건 — 전량을 넘겨야 뒷 단계·다른 반 당사자도 푸시를 받는다
        // (revert_change의 allReverts 전량 발송과 같은 이유. 종전 [change] 1건은 체인에서 누락이 있었다).
        after(() => notifyTimetableChanges(domain, changes.length ? changes : [change]));
        // 원장: 신청자에게 처리 결과 (notification_center_spec §3 ②)
        after(() =>
          emitNotification(domain, {
            recipientEmail: request.requesterEmail,
            type: "request-resolved",
            title: "교체 신청이 승인되었습니다.",
            refType: "swap_request",
            refId: approvedRequestId,
          }).catch((e) => console.error("[알림 센터] 승인 원장 기록 실패:", e?.message))
        );
        return NextResponse.json({ success: true, action, request, change, changes });
      }

      case "reject": {
        if (!body.requestId) {
          return NextResponse.json({ error: "requestId가 누락되었습니다." }, { status: 400 });
        }
        if (!body.decisionNote?.trim()) {
          return NextResponse.json({ error: "반려 사유는 필수입니다." }, { status: 400 });
        }
        const rejectedRequestId = body.requestId;
        const request = await rejectSwapRequest(domain, auth.email, rejectedRequestId, body.decisionNote);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "reject_swap_request",
          details: `수업교환 반려: ${body.requestId} — ${body.decisionNote}`,
          status: "success",
        });
        // 원장: 신청자에게 처리 결과 (notification_center_spec §3 ②) — 반려는 푸시 경로가
        // 없던 곳이라 원장이 유일한 비휘발 통지가 된다
        after(() =>
          emitNotification(domain, {
            recipientEmail: request.requesterEmail,
            type: "request-resolved",
            title: "교체 신청이 반려되었습니다. 사유를 확인해 주세요.",
            refType: "swap_request",
            refId: rejectedRequestId,
          }).catch((e) => console.error("[알림 센터] 반려 원장 기록 실패:", e?.message))
        );
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

      // §14 교사 기점 직권 배정 — 소스 셀 1개로 등록된 전 주의 맞교환 후보 일괄 계산.
      // teacherEmail을 requester로 넘겨 resolveSourceLesson이 "그 셀이 그 교사의 수업"임을 검증한다.
      // 확정 상태 기준 탐색은 유지하되(교사 PENDING·초안 오버레이 미사용), §14-4 담기 누적분은
      // pendingItems로 명시 전달받아 가상 적용한다 — 담긴 항목과 충돌하는 후보를 미리 거르기 위함.
      case "direct_candidates_all": {
        if (!body.weekId || !body.source || !body.teacherEmail) {
          return NextResponse.json(
            { error: "weekId, source, teacherEmail이 모두 필요합니다." },
            { status: 400 }
          );
        }
        const { grade, classNum, day, period } = body.source;
        if (![grade, classNum, day, period].every((n) => Number.isInteger(n) && n > 0)) {
          return NextResponse.json({ error: "source 슬롯 값이 유효하지 않습니다." }, { status: 400 });
        }
        const pendingItems = body.pendingItems;
        if (pendingItems !== undefined) {
          const shapeOk =
            Array.isArray(pendingItems) && pendingItems.length <= 20 &&
            pendingItems.every(
              (p) =>
                p?.weekId && p.source && p.candidate &&
                [p.source.grade, p.source.classNum, p.source.day, p.source.period].every(
                  (n) => Number.isInteger(n) && n > 0
                )
            );
          if (!shapeOk) {
            return NextResponse.json(
              { error: "pendingItems 형식이 유효하지 않습니다 (최대 20건)." },
              { status: 400 }
            );
          }
        }
        const result = await computeCandidatesAllWeeks(
          domain,
          String(body.teacherEmail).trim().toLowerCase(),
          body.weekId,
          { grade, classNum, day, period, subjectName: "" },
          // 일과계 화면은 보는 사람 ≠ 대상 교사 — 감점 주어를 실명으로 (수집 21)
          { thirdPerson: true, ...(pendingItems?.length ? { extraItems: pendingItems } : {}) }
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
          consent: body.consent, // 조율 필요 후보 반영 시 필수 — 검증은 createSwapRequest (§14-4 동등성)
          consentDraftId: body.draftId, // 알림 수락 경로 — 일과계 소유 CONSENTED 초안 (notification_center_spec §4)
        });
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "direct_swap_commit",
          details: `일과계 직권 배정: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}${request.targetWeekId ? `, 교차 주 → ${request.targetWeekId}` : ""}) → change ${change.id}`,
          status: "success",
        });
        // 웹 푸시: 당사자 교사 + 해당 반 학생 (응답 후 발송)
        after(() => notifyTimetableChanges(domain, [change]));
        return NextResponse.json({ success: true, action, request, change });
      }

      // §14-4 담기 가상 반영 그리드 — 대상 교사의 등록 전 주 시간표에 pendingItems를 가상 적용해 반환.
      // 그리드가 "담긴 상태의 예상 시간표"를 그리기 위한 읽기 전용 액션 (my_projected의 직권 대응).
      case "direct_projected": {
        if (!body.teacherEmail) {
          return NextResponse.json({ error: "teacherEmail이 필요합니다." }, { status: 400 });
        }
        const pendingItems = Array.isArray(body.pendingItems) ? body.pendingItems : [];
        const shapeOk =
          pendingItems.length <= 20 &&
          pendingItems.every(
            (p) =>
              p?.weekId && p.source && p.candidate &&
              [p.source.grade, p.source.classNum, p.source.day, p.source.period].every(
                (n) => Number.isInteger(n) && n > 0
              )
          );
        if (!shapeOk) {
          return NextResponse.json(
            { error: "pendingItems 형식이 유효하지 않습니다 (최대 20건)." },
            { status: 400 }
          );
        }
        // extraWeeks: UI의 [이후 주 더 보기] 누적 횟수 — 기본 노출 창을 주 단위로 넓힌다 (수집 24)
        const extraWeeks = Number.isFinite(Number(body.extraWeeks)) ? Number(body.extraWeeks) : 0;
        const result = await computeDirectProjectedWeeks(
          domain, String(body.teacherEmail).trim().toLowerCase(), pendingItems, { extraWeeks }
        );
        return NextResponse.json({ success: true, action, ...result });
      }

      // §C 징검다리 체인 — 소스 수업이 목적지 슬롯에 도달하는 교환 수열 탐색 (pre_opening_3features_spec §C-2)
      case "chain_search": {
        const src = body.source as any;
        const tgt = body.chainTarget as any;
        const okSlot = (o: any, keys: string[]) =>
          o && keys.every((k) => Number.isInteger(o[k]) && o[k] > 0);
        if (!body.weekId || !okSlot(src, ["grade", "classNum", "day", "period"])) {
          return NextResponse.json({ error: "weekId와 source(grade·classNum·day·period)가 필요합니다." }, { status: 400 });
        }
        if (!okSlot(tgt, ["day", "period"])) {
          return NextResponse.json({ error: "chainTarget(day·period)가 필요합니다." }, { status: 400 });
        }
        const result = await computeChainSearch(domain, {
          weekId: body.weekId,
          source: { grade: src.grade, classNum: src.classNum, day: src.day, period: src.period },
          target: { weekId: tgt.weekId || undefined, day: tgt.day, period: tgt.period },
          maxDepth: body.chainMaxDepth,
        });
        return NextResponse.json({ success: true, action, ...result });
      }

      // §5b 통 이동 후보 (consent_swap_opening_spec §5b-4) — 일과계 게이트는 상단 canManageTimetable이 담당
      case "simul_move_candidates": {
        const src = body.simulMoveSource as any;
        const okSlot = (o: any) =>
          o && ["day", "period"].every((k) => Number.isInteger(o[k]) && o[k] > 0);
        // simulMoveSource는 선택 — 생략하면 그룹의 현행 슬롯(groupSlots)만 반환(진입 조회).
        // 값을 보냈는데 형식이 틀린 경우만 400 (조용한 무시 금지).
        if (!body.weekId || !body.simulGroupId || (src !== undefined && !okSlot(src))) {
          return NextResponse.json(
            { error: "weekId, simulGroupId가 필요합니다 (simulMoveSource를 보낼 때는 day·period 형식)." },
            { status: 400 }
          );
        }
        const result = await computeSimulGroupMoveCandidates(domain, {
          weekId: body.weekId,
          groupId: body.simulGroupId,
          ...(src ? { source: { day: src.day, period: src.period } } : {}),
        });
        return NextResponse.json({ success: true, action, ...result });
      }

      // §5b 통 이동 원자 커밋 — 재계산 대조·consent 필수·부분 성공 금지 (consent_swap_opening_spec §5b-3)
      case "simul_move_commit": {
        const src = body.simulMoveSource as any;
        const tgt = body.simulMoveTarget as any;
        const okSlot = (o: any) =>
          o && ["day", "period"].every((k) => Number.isInteger(o[k]) && o[k] > 0);
        if (!body.weekId || !body.simulGroupId || !okSlot(src) || !okSlot(tgt)) {
          return NextResponse.json(
            { error: "weekId, simulGroupId, simulMoveSource·simulMoveTarget(day·period)가 필요합니다." },
            { status: 400 }
          );
        }
        const { request, changes } = await commitSimulGroupMove(domain, auth.email, {
          weekId: body.weekId,
          targetWeekId: body.targetWeekId, // §5c-8 다른 주로 옮기는 직권 반영 (없으면 같은 주)
          groupId: body.simulGroupId,
          source: { day: src.day, period: src.period },
          target: { day: tgt.day, period: tgt.period },
          reason: body.reason,
          consent: body.consent,
        });
        const sm = request.simulMove!;
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.requesterEmail,
          action: "simul_move_commit",
          details: `이동수업 통 이동: ${sm.grade}학년 ${sm.classNums.join("·")}반 「${sm.label}」 (${sm.from.day},${sm.from.period})→${request.targetWeekId ? `[${request.targetWeekId}]` : ""}(${sm.to.day},${sm.to.period}) — change ${changes.length}건, 양해 ${request.consent?.parties.length || 0}명`,
          status: "success",
        });
        // 웹 푸시: 반별 change 전체를 한 번에 넘겨 수신자별 1건으로 집계 (응답 후 발송)
        after(() => notifyTimetableChanges(domain, changes));
        return NextResponse.json({ success: true, action, request, changes });
      }

      // §14-4 직권 담기 일괄 반영 — 항목별로 directCommit(생성+즉시 승인)을 순차 실행.
      // 부분 성공 허용(전체 롤백 없음): 앞 항목이 실제 반영된 상태에서 뒤 항목이 재검증되므로,
      // 담기 시점에 유효했던 조합이 그대로 유효하면 전건 성공, 중간 실패는 항목별 사유로 반환.
      // 감사 로그는 단건 direct_commit과 동일 불변식(반영 1건 = 로그 1건)을 유지하고 batchId를 병기.
      case "direct_commit_batch": {
        const items = body.items;
        if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
          return NextResponse.json({ error: "items 배열(1~20건)이 필요합니다." }, { status: 400 });
        }
        const batchId = randomUUID();
        const results: DirectCommitBatchItemResult[] = [];
        const committedChanges: TimetableChange[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          try {
            if (!item?.weekId || !item.source || !item.type || !item.candidate) {
              throw new Error("weekId, source, type, candidate가 모두 필요합니다.");
            }
            if (item.type !== "swap" && item.type !== "substitute") {
              throw new Error("type은 swap 또는 substitute여야 합니다.");
            }
            const { grade, classNum, day, period } = item.source;
            if (![grade, classNum, day, period].every((n) => Number.isInteger(n) && n > 0)) {
              throw new Error("source 슬롯 값이 유효하지 않습니다.");
            }

            // §5c-9-4: 담기에 묶음 항목이 섞이면 전용 경로로 보낸다. createSwapRequest의 묶음
            // 거부는 단건 교체·체인·보강의 방어이므로 손대지 않고 여기서 항목별로 분기한다
            // (교사 일괄 제출이 simul_move_create로 분기하는 것과 같은 형태).
            const simulInfo = item.candidate?.coordination?.simul;
            if (simulInfo) {
              const tDay = item.candidate.targetDay;
              const tPeriod = item.candidate.targetPeriod;
              if (!Number.isInteger(tDay) || !Number.isInteger(tPeriod)) {
                throw new Error("이동할 교시 정보가 없습니다. 담기 목록에서 이 항목을 지우고 다시 담아 주세요.");
              }
              const { request: sReq, changes: sChanges } = await commitSimulGroupMove(domain, auth.email, {
                weekId: item.weekId,
                targetWeekId: item.targetWeekId,
                groupId: simulInfo.groupId,
                source: { day, period },
                target: { day: tDay as number, period: tPeriod as number },
                reason: item.reason || body.reason,
                consent: item.consent,
                batchId,
              });
              const sm = sReq.simulMove!;
              await writeAuditLog({
                operatorEmail: auth.email,
                targetEmail: sReq.requesterEmail,
                action: "simul_move_commit",
                details: `이동수업 통 이동: ${sm.grade}학년 ${sm.classNums.join("·")}반 「${sm.label}」 (${sm.from.day},${sm.from.period})→${sReq.targetWeekId ? `[${sReq.targetWeekId}]` : ""}(${sm.to.day},${sm.to.period}) — change ${sChanges.length}건, 양해 ${sReq.consent?.parties.length || 0}명 (일괄 ${i + 1}/${items.length}, batchId ${batchId})`,
                status: "success",
              });
              results.push({ index: i, ok: true, requestId: sReq.id, changeId: sChanges[0].id });
              committedChanges.push(...sChanges);
              continue;
            }

            const { request, change } = await directCommit(domain, auth.email, {
              weekId: item.weekId,
              type: item.type,
              source: { grade, classNum, day, period, subjectName: item.source.subjectName || "" },
              candidate: item.candidate,
              reason: item.reason || body.reason,
              targetWeekId: item.targetWeekId,
              batchId,
              consent: item.consent, // 조율 필요 후보 항목의 양해 확인 (§14-4 동등성)
              consentDraftId: item.draftId, // 알림 수락 경로 (notification_center_spec §4 직권 동등성)
            });
            await writeAuditLog({
              operatorEmail: auth.email,
              targetEmail: request.requesterEmail,
              action: "direct_swap_commit",
              details: `일과계 직권 배정: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}${request.targetWeekId ? `, 교차 주 → ${request.targetWeekId}` : ""}) → change ${change.id} (일괄 ${i + 1}/${items.length}, batchId ${batchId})`,
              status: "success",
            });
            results.push({ index: i, ok: true, requestId: request.id, changeId: change.id });
            committedChanges.push(change);
          } catch (e: any) {
            results.push({ index: i, ok: false, error: e.message || "반영 실패" });
          }
        }
        const committedCount = results.filter((r) => r.ok).length;
        // 웹 푸시: 배치 전체를 한 번에 넘겨 수신자별 1건으로 집계 (스팸 방지)
        if (committedChanges.length > 0) {
          after(() => notifyTimetableChanges(domain, committedChanges));
        }
        return NextResponse.json({ success: true, action, batchId, committedCount, results });
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
        // 웹 푸시: 취소도 같은 수신자에게 "변경 취소" 문구로 발송.
        // §3-2d S5: 체인·교차 주 취소는 revert가 여러 건 — 전량을 넘겨야 나머지 단계 당사자·학급도 푸시를 받는다.
        after(() => notifyTimetableChanges(domain, revert.allReverts || [revert]));
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

      // ── 동시수업(분반) 그룹 등록부 (pre_opening_3features_spec §A-4) ──

      case "simul_list": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) {
          return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        }
        const [groups, grids] = await Promise.all([
          loadSimulGroups(domain, termId),
          loadAllClassGrids(domain, termId),
        ]);
        // 미리보기: 저장 전 그룹 후보(simulGroup)가 오면 그 판정 셀만 별도 반환 (§A-4 저장 전 확인)
        let previewCells;
        if (body.simulGroup) {
          const v = validateSimulGroupPayload({ ...body.simulGroup, termId });
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
          previewCells = listSimulCells(grids, [
            { ...v.group, id: "preview", createdBy: "", createdAt: 0 },
          ]);
        }
        return NextResponse.json({
          success: true,
          action,
          groups,
          cells: listSimulCells(grids, groups),
          ...(previewCells ? { previewCells } : {}),
        });
      }

      case "simul_save": {
        const termId = body.simulGroup?.termId || body.termId || settings.activeTermId;
        if (!termId) {
          return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        }
        const v = validateSimulGroupPayload({ ...body.simulGroup, termId });
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        // 편성 등록부 잠금 (registry_lock_spec §2) — 이하 편집 10종 공통
        await assertRegistryEditable(domain, termId, auth.email, body.unlockReason, `동시수업 그룹 저장: ${v.group.label}`);
        const isUpdate = !!body.simulGroupId;
        const ref = isUpdate
          ? simulGroupsColRef(domain).doc(body.simulGroupId!)
          : simulGroupsColRef(domain).doc();
        if (isUpdate) {
          const existing = await ref.get();
          if (!existing.exists) {
            return NextResponse.json({ error: "수정할 그룹을 찾을 수 없습니다." }, { status: 404 });
          }
          await ref.set(
            { ...v.group, updatedBy: auth.email.toLowerCase(), updatedAt: Date.now() },
            { merge: true }
          );
        } else {
          await ref.set({
            ...v.group,
            createdBy: auth.email.toLowerCase(),
            createdAt: Date.now(),
          });
        }
        await bumpTimetableCacheVersion(domain); // 분반 마크는 view 그리드에 반영됨 (cache spec §4)
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: isUpdate ? "simul_group_update" : "simul_group_create",
          details: `동시수업 그룹 ${isUpdate ? "수정" : "등록"}: ${v.group.label} — ${v.group.grade}학년 ${v.group.classNums.join(",")}반 / ${v.group.subjectNames.join(", ")}${v.group.slots ? ` / 교시 제한 ${v.group.slots.length}건` : ""}${v.group.active ? "" : " (비활성)"}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, groupId: ref.id });
      }

      case "simul_delete": {
        if (!body.simulGroupId) {
          return NextResponse.json({ error: "simulGroupId가 필요합니다." }, { status: 400 });
        }
        const ref = simulGroupsColRef(domain).doc(body.simulGroupId);
        const snap = await ref.get();
        if (!snap.exists) {
          return NextResponse.json({ error: "삭제할 그룹을 찾을 수 없습니다." }, { status: 404 });
        }
        const label = (snap.data() as any)?.label || body.simulGroupId;
        await assertRegistryEditable(domain, (snap.data() as any)?.termId || "", auth.email, body.unlockReason, `동시수업 그룹 삭제: ${label}`);
        await ref.delete();
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "simul_group_delete",
          details: `동시수업 그룹 삭제: ${label}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      // ── 특별실 배정 등록부 (pre_opening_3features_spec §F) ──

      case "venue_list": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) {
          return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        }
        const [groups, grids] = await Promise.all([
          loadVenueGroups(domain, termId),
          loadAllClassGrids(domain, termId),
        ]);
        // 미리보기: 저장 전 배정 후보(venueGroup)가 오면 그 판정 셀만 별도 반환
        let previewCells;
        if (body.venueGroup) {
          const v = validateVenueGroupPayload({ ...body.venueGroup, termId });
          if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
          previewCells = listVenueCells(grids, [
            { ...v.group, id: "preview", createdBy: "", createdAt: 0 },
          ]);
        }
        return NextResponse.json({
          success: true,
          action,
          groups,
          cells: listVenueCells(grids, groups),
          // 기초 이중 점유(같은 교시 같은 특별실 2수업↑) — 등록 실수 감지용, 정상 0건
          baseConflicts: findVenueBaseConflicts(grids, groups),
          ...(previewCells ? { previewCells } : {}),
        });
      }

      case "venue_save": {
        const termId = body.venueGroup?.termId || body.termId || settings.activeTermId;
        if (!termId) {
          return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        }
        const v = validateVenueGroupPayload({ ...body.venueGroup, termId });
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        await assertRegistryEditable(domain, termId, auth.email, body.unlockReason, `특별실 배정 저장: ${v.group.roomName} — ${v.group.label}`);
        const isUpdate = !!body.venueGroupId;
        const ref = isUpdate
          ? venueGroupsColRef(domain).doc(body.venueGroupId!)
          : venueGroupsColRef(domain).doc();
        if (isUpdate) {
          const existing = await ref.get();
          if (!existing.exists) {
            return NextResponse.json({ error: "수정할 배정을 찾을 수 없습니다." }, { status: 404 });
          }
          await ref.set(
            { ...v.group, updatedBy: auth.email.toLowerCase(), updatedAt: Date.now() },
            { merge: true }
          );
        } else {
          await ref.set({
            ...v.group,
            createdBy: auth.email.toLowerCase(),
            createdAt: Date.now(),
          });
        }
        await bumpTimetableCacheVersion(domain); // 특별실 마크는 view 그리드에 반영됨 (cache spec §4)
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: isUpdate ? "venue_group_update" : "venue_group_create",
          details: `특별실 배정 ${isUpdate ? "수정" : "등록"}: ${v.group.roomName} — ${v.group.label} (${v.group.grade}학년 ${v.group.classNums.join(",")}반 / ${v.group.subjectNames.join(", ")}${v.group.slots ? ` / 교시 제한 ${v.group.slots.length}건` : ""}${v.group.active ? "" : " (비활성)"})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, groupId: ref.id });
      }

      case "venue_delete": {
        if (!body.venueGroupId) {
          return NextResponse.json({ error: "venueGroupId가 필요합니다." }, { status: 400 });
        }
        const ref = venueGroupsColRef(domain).doc(body.venueGroupId);
        const snap = await ref.get();
        if (!snap.exists) {
          return NextResponse.json({ error: "삭제할 배정을 찾을 수 없습니다." }, { status: 404 });
        }
        const d = snap.data() as any;
        await assertRegistryEditable(domain, d?.termId || "", auth.email, body.unlockReason, `특별실 배정 삭제: ${d?.roomName || ""} — ${d?.label || body.venueGroupId}`);
        await ref.delete();
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "venue_group_delete",
          details: `특별실 배정 삭제: ${d?.roomName || ""} — ${d?.label || body.venueGroupId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      // ── 학사일정 (pre_opening_3features_spec §B) ──

      case "calendar_list": {
        const events = await loadCalendarEvents(domain);
        return NextResponse.json({ success: true, action, events });
      }

      case "calendar_save": {
        const termId = body.calendarEvent?.termId || body.termId || settings.activeTermId || "";
        const v = validateCalendarEventPayload({ ...body.calendarEvent, termId });
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        const isUpdate = !!body.calendarEventId;
        const ref = isUpdate
          ? timetableCalendarColRef(domain).doc(body.calendarEventId!)
          : timetableCalendarColRef(domain).doc();
        if (isUpdate) {
          const existing = await ref.get();
          if (!existing.exists)
            return NextResponse.json({ error: "수정할 일정을 찾을 수 없습니다." }, { status: 404 });
          if (existing.data()?.source === "neis") {
            return NextResponse.json(
              { error: "나이스에서 자동 관리되는 일정입니다. 나이스에서 수정하거나, 시수 조정은 별도로 등록하세요." },
              { status: 400 }
            );
          }
          await ref.set({ ...v.event, source: "manual", updatedBy: auth.email.toLowerCase(), updatedAt: Date.now() }, { merge: true });
        } else {
          await ref.set({ ...v.event, source: "manual", createdBy: auth.email.toLowerCase(), createdAt: Date.now() });
        }
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: isUpdate ? "timetable_calendar_update" : "timetable_calendar_create",
          details: `학사일정 ${isUpdate ? "수정" : "등록"}: ${v.event.title ? `[${v.event.title}] ` : ""}${v.event.type} ${v.event.startDate}${v.event.endDate !== v.event.startDate ? `~${v.event.endDate}` : ""}${v.event.note ? ` (${v.event.note})` : ""}`,
          status: "success",
        });
        if ((SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(v.event.type)) {
          await syncDerivedWeeksWithCalendar(domain, termId).catch((e) =>
            console.error("[calendar_save] 주 동기화 실패:", e?.message)
          );
        }
        return NextResponse.json({ success: true, action, eventId: ref.id });
      }

      case "calendar_delete": {
        if (!body.calendarEventId)
          return NextResponse.json({ error: "calendarEventId가 필요합니다." }, { status: 400 });
        const ref = timetableCalendarColRef(domain).doc(body.calendarEventId);
        const snap = await ref.get();
        if (!snap.exists)
          return NextResponse.json({ error: "삭제할 일정을 찾을 수 없습니다." }, { status: 404 });
        const d = snap.data() as any;
        if (d?.source === "neis") {
          return NextResponse.json(
            { error: "나이스에서 자동 관리되는 일정입니다. 삭제가 불가능합니다." },
            { status: 400 }
          );
        }
        const termId = d?.termId || settings.activeTermId;
        await ref.delete();
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "timetable_calendar_delete",
          details: `학사일정 삭제: ${d?.title ? `[${d?.title}] ` : ""}${d?.type} ${d?.startDate}${d?.endDate && d.endDate !== d.startDate ? `~${d.endDate}` : ""}`,
          status: "success",
        });
        if (termId && (SCHEDULE_AFFECTING_TYPES as readonly string[]).includes(d?.type)) {
          await syncDerivedWeeksWithCalendar(domain, termId).catch((e) =>
            console.error("[calendar_delete] 주 동기화 실패:", e?.message)
          );
        }
        return NextResponse.json({ success: true, action });
      }

      case "calendar_neis_sync": {
        const termId = body.termId || settings.activeTermId || undefined;
        const result = await runNeisCalendarSync(domain, termId);
        if (!result.success) {
          return NextResponse.json({ error: result.message }, { status: 400 });
        }
        const updatedSettings = await loadTimetableSettings(domain);
        return NextResponse.json({
          success: true,
          action,
          message: result.message,
          stats: result.stats,
          settings: updatedSettings,
        });
      }

      case "calendar_ics_info": {
        let baseUrl: string | undefined;
        try {
          const u = new URL(req.url);
          baseUrl = `${u.protocol}//${u.host}`;
        } catch {
          // fallback
        }
        const info = await getCalendarIcsInfo(domain, baseUrl);
        if (auth.role === "student") {
          return NextResponse.json({
            success: true,
            action,
            icsToken: info.icsToken,
            feedUrl: info.feedUrl,
            webcalUrl: info.webcalUrl,
          });
        }
        return NextResponse.json({
          success: true,
          action,
          ...info,
        });
      }

      // ── 기초시간표 개정 (pre_opening_3features_spec §E) ──

      case "revision_list": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const revisions = await loadBaseRevisions(domain, termId);
        return NextResponse.json({ success: true, action, revisions });
      }

      case "revision_save_draft": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const v = validateRevisionOps(body.revisionOps);
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        const { revision, warnings } = await saveRevisionDraft(
          domain, termId, auth.email, v.ops, body.revisionNote, body.revisionId
        );
        return NextResponse.json({ success: true, action, revision, warnings });
      }

      case "revision_apply": {
        if (!body.revisionId)
          return NextResponse.json({ error: "revisionId가 필요합니다." }, { status: 400 });
        const applied = await applyRevisionDraft(domain, auth.email, body.revisionId, body.effectiveFrom);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "timetable_base_revision_apply",
          details: `기초시간표 개정 적용: ${applied.effectiveFrom} 주부터 (편집 ${applied.ops.length}건${applied.note ? `, ${applied.note}` : ""})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, revision: applied });
      }

      case "revision_delete": {
        if (!body.revisionId)
          return NextResponse.json({ error: "revisionId가 필요합니다." }, { status: 400 });
        await deleteRevisionDraft(domain, body.revisionId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "timetable_base_revision_delete",
          details: `기초시간표 개정 임시안 삭제: ${body.revisionId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      // ── Phase 9c: 특별교사 금지 / 연속수업 / 복수교사 등록부 ──────

      case "slot_ban_list": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const rules = await loadTeacherSlotBans(domain, termId);
        return NextResponse.json({ success: true, action, rules, data: rules });
      }

      case "slot_ban_save": {
        const termId = body.rule?.termId || body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const v = validateTeacherSlotBanPayload({ ...body.rule, termId });
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        await assertRegistryEditable(domain, termId, auth.email, body.unlockReason, `특별교사 금지 규칙 저장: ${v.rule.teacherEmail}`);
        const isUpdate = !!body.ruleId;
        const ref = isUpdate
          ? teacherSlotBansColRef(domain).doc(body.ruleId!)
          : teacherSlotBansColRef(domain).doc();
        if (isUpdate) {
          const existing = await ref.get();
          if (!existing.exists) return NextResponse.json({ error: "수정할 규칙을 찾을 수 없습니다." }, { status: 404 });
          await ref.set({ ...v.rule, updatedBy: auth.email.toLowerCase(), updatedAt: Date.now() }, { merge: true });
        } else {
          await ref.set({ ...v.rule, createdBy: auth.email.toLowerCase(), createdAt: Date.now() });
        }
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: isUpdate ? "slot_ban_update" : "slot_ban_create",
          details: `특별교사 금지 규칙 ${isUpdate ? "수정" : "등록"}: ${v.rule.teacherEmail} (${v.rule.kind === "move" ? "이동금지" : "배정금지"}) ${v.rule.slots.length}슬롯`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, ruleId: ref.id });
      }

      case "slot_ban_delete": {
        if (!body.ruleId) return NextResponse.json({ error: "ruleId가 필요합니다." }, { status: 400 });
        const ref = teacherSlotBansColRef(domain).doc(body.ruleId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ error: "삭제할 규칙을 찾을 수 없습니다." }, { status: 404 });
        await assertRegistryEditable(domain, (snap.data() as any)?.termId || "", auth.email, body.unlockReason, `특별교사 금지 규칙 삭제: ${body.ruleId}`);
        await ref.delete();
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "slot_ban_delete",
          details: `특별교사 금지 규칙 삭제: ${body.ruleId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      case "consecutive_rule_list": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const rules = await loadConsecutiveRules(domain, termId);
        return NextResponse.json({ success: true, action, rules, data: rules });
      }

      case "consecutive_rule_save": {
        const termId = body.rule?.termId || body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const v = validateConsecutiveRulePayload({ ...body.rule, termId });
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        await assertRegistryEditable(domain, termId, auth.email, body.unlockReason, `연속수업 규칙 저장: ${v.rule.grade}학년 ${v.rule.subjectName}`);
        const isUpdate = !!body.ruleId;
        const ref = isUpdate
          ? consecutiveRulesColRef(domain).doc(body.ruleId!)
          : consecutiveRulesColRef(domain).doc();
        if (isUpdate) {
          const existing = await ref.get();
          if (!existing.exists) return NextResponse.json({ error: "수정할 규칙을 찾을 수 없습니다." }, { status: 404 });
          await ref.set({ ...v.rule, updatedBy: auth.email.toLowerCase(), updatedAt: Date.now() }, { merge: true });
        } else {
          await ref.set({ ...v.rule, createdBy: auth.email.toLowerCase(), createdAt: Date.now() });
        }
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: isUpdate ? "consecutive_rule_update" : "consecutive_rule_create",
          details: `연속수업 규칙 ${isUpdate ? "수정" : "등록"}: ${v.rule.grade}학년 ${v.rule.classNums.join(",")}반 / ${v.rule.subjectName} (패턴: ${v.rule.pattern})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, ruleId: ref.id });
      }

      case "consecutive_rule_delete": {
        if (!body.ruleId) return NextResponse.json({ error: "ruleId가 필요합니다." }, { status: 400 });
        const ref = consecutiveRulesColRef(domain).doc(body.ruleId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ error: "삭제할 규칙을 찾을 수 없습니다." }, { status: 404 });
        await assertRegistryEditable(domain, (snap.data() as any)?.termId || "", auth.email, body.unlockReason, `연속수업 규칙 삭제: ${body.ruleId}`);
        await ref.delete();
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "consecutive_rule_delete",
          details: `연속수업 규칙 삭제: ${body.ruleId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      case "co_teaching_rule_list": {
        const termId = body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const rules = await loadCoTeachingRules(domain, termId);
        return NextResponse.json({ success: true, action, rules, data: rules });
      }

      case "co_teaching_rule_save": {
        const termId = body.rule?.termId || body.termId || settings.activeTermId;
        if (!termId) return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        const v = validateCoTeachingRulePayload({ ...body.rule, termId });
        if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
        await assertRegistryEditable(domain, termId, auth.email, body.unlockReason, `복수교사 규칙 저장: ${v.rule.grade}학년 ${v.rule.subjectName}`);
        const isUpdate = !!body.ruleId;
        const ref = isUpdate
          ? coTeachingRulesColRef(domain).doc(body.ruleId!)
          : coTeachingRulesColRef(domain).doc();
        if (isUpdate) {
          const existing = await ref.get();
          if (!existing.exists) return NextResponse.json({ error: "수정할 규칙을 찾을 수 없습니다." }, { status: 404 });
          await ref.set({ ...v.rule, updatedBy: auth.email.toLowerCase(), updatedAt: Date.now() }, { merge: true });
        } else {
          await ref.set({ ...v.rule, createdBy: auth.email.toLowerCase(), createdAt: Date.now() });
        }
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: isUpdate ? "co_teaching_rule_update" : "co_teaching_rule_create",
          details: `복수교사 규칙 ${isUpdate ? "수정" : "등록"}: ${v.rule.grade}학년 ${v.rule.classNums.join(",")}반 / ${v.rule.subjectName} (${v.rule.teacherEmails.join(", ")})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, ruleId: ref.id });
      }

      case "co_teaching_rule_delete": {
        if (!body.ruleId) return NextResponse.json({ error: "ruleId가 필요합니다." }, { status: 400 });
        const ref = coTeachingRulesColRef(domain).doc(body.ruleId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ error: "삭제할 규칙을 찾을 수 없습니다." }, { status: 404 });
        await assertRegistryEditable(domain, (snap.data() as any)?.termId || "", auth.email, body.unlockReason, `복수교사 규칙 삭제: ${body.ruleId}`);
        await ref.delete();
        await bumpTimetableCacheVersion(domain);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "co_teaching_rule_delete",
          details: `복수교사 규칙 삭제: ${body.ruleId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      // ── Phase 9c-D 자동 작성 초안 (phase9c_d_spec §7) ──

      case "draft_model": {
        // 편집 진입 시 1회 — 등록부 5종 + 현행 기초 그리드 한번에 내려줌 (spec §5)
        const termId = body.termId || settings.activeTermId;
        if (!termId)
          return NextResponse.json({ error: "대상 학기(termId)가 없습니다." }, { status: 400 });
        const [baseGrids, simulGroups, venueGroups, slotBans, consecutiveRules, coTeachingRules] =
          await Promise.all([
            loadAllClassGrids(domain, termId),
            loadSimulGroups(domain, termId),
            loadVenueGroups(domain, termId),
            loadTeacherSlotBans(domain, termId),
            loadConsecutiveRules(domain, termId),
            loadCoTeachingRules(domain, termId),
          ]);
        const model = {
          lunchAfterPeriod: settings.lunchAfterPeriod || 4,
          periodsPerDay: settings.periodsPerDay || 7,
          simulGroups,
          venueGroups,
          teacherSlotBans: slotBans,
          consecutiveRules,
          coTeaching: coTeachingRules,
        };
        return NextResponse.json({ success: true, action, model, baseGrids });
      }

      case "draft_list": {
        const drafts = await listDrafts(domain);
        return NextResponse.json({ success: true, action, drafts });
      }

      case "draft_create": {
        const termId = body.termId || settings.activeTermId;
        if (!termId)
          return NextResponse.json({ error: "대상 학기(termId)가 없습니다." }, { status: 400 });
        const origin = body.draftOrigin || { kind: "copy" as const };
        const label =
          body.draftLabel ||
          (origin.kind === "solver"
            ? `자동 작성 #${origin.seed ?? 0} (${new Date().toLocaleDateString("ko-KR")})`
            : `현행 복제 (${new Date().toLocaleDateString("ko-KR")})`);
        const lastReport =
          body.draftReport && Array.isArray(body.draftReport.hard)
            ? {
                hardCount: body.draftReport.hard.length,
                actionableHard: body.draftReport.summary?.actionableHard ?? body.draftReport.hard.length,
                softTotal: body.draftReport.soft?.total ?? 0,
              }
            : undefined;

        // phase9c_i_spec §5-2: 서버측 방어 검증
        let draftHours = Array.isArray(body.draftHours) ? body.draftHours : undefined;
        if (draftHours) {
          if (draftHours.length > 5000) {
            return NextResponse.json({ error: "시수표 행 수가 5000을 초과했습니다." }, { status: 400 });
          }
          for (const h of draftHours) {
            if (!Number.isInteger(h.hours) || h.hours < 1 || h.hours > 40) {
              return NextResponse.json({ error: "시수 값은 1~40 사이 정수여야 합니다." }, { status: 400 });
            }
          }
        }

        let draftFixedBlocks = Array.isArray(body.draftFixedBlocks) ? body.draftFixedBlocks : undefined;
        if (draftFixedBlocks) {
          if (draftFixedBlocks.length > 100) {
            return NextResponse.json({ error: "고정 블록 수가 100을 초과했습니다." }, { status: 400 });
          }
          for (const b of draftFixedBlocks) {
            if (Array.isArray(b.entries) && b.entries.length > 200) {
              return NextResponse.json({ error: "고정 블록 항목 수가 200을 초과했습니다." }, { status: 400 });
            }
          }
        }

        const draftPlanId = typeof body.draftPlanId === "string" ? body.draftPlanId : undefined;

        const draftId = await createDraft(
          domain,
          label,
          termId,
          origin,
          body.draftGrids ?? null,
          body.draftUnplaced ?? [],
          lastReport,
          auth.email,
          draftHours,
          draftFixedBlocks,
          draftPlanId
        );
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "draft_create",
          details: `새 초안 생성: ${draftId} (${label})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, draftId, label });
      }

      case "draft_get": {
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        const result = await getDraft(domain, body.draftId);
        return NextResponse.json({ success: true, action, ...result });
      }

      case "draft_delete": {
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        await deleteDraft(domain, body.draftId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "draft_delete",
          details: `초안 삭제: ${body.draftId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      case "draft_op": {
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        if (!body.draftOp)
          return NextResponse.json({ error: "draftOp가 필요합니다." }, { status: 400 });
        const result = await applyDraftOp(
          domain,
          body.draftId,
          body.draftOp,
          auth.email,
          body.draftUnplaced
        );
        return NextResponse.json({ success: true, action, ...result });
      }

      case "draft_undo": {
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        const result = await undoDraftOp(domain, body.draftId, auth.email);
        return NextResponse.json({ success: true, action, ...result });
      }

      case "draft_redo": {
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        const result = await redoDraftOp(domain, body.draftId, auth.email);
        return NextResponse.json({ success: true, action, ...result });
      }

      // ── Phase 9c-F NEIS 일괄 내보내기 (phase9c_f_spec §4) ──

      case "neis_map_get": {
        const termId = body.termId || settings.activeTermId;
        const [registry, term] = await Promise.all([
          loadNeisMapRegistry(domain),
          termId ? loadTimetableTerm(domain, termId) : Promise.resolve(null),
        ]);
        // seed = 매핑표 UI의 행 원천 (학기 과목명·약칭 — term 문서에 이미 있어 추가 읽기 0)
        const subjectsSeed = (term?.subjects || []).map((s) => ({
          name: s.name,
          shortName: s.shortName,
        }));
        return NextResponse.json({ success: true, action, registry, subjectsSeed, termId });
      }

      case "neis_map_save": {
        const { registry, error } = sanitizeNeisMapPayload(body.neisMap || body);
        if (error || !registry) {
          return NextResponse.json({ error: error || "등록부 본문이 올바르지 않습니다." }, { status: 400 });
        }
        await saveNeisMapRegistry(domain, registry, auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "neis_map_save",
          details: `NEIS 매핑 등록부 저장: 과목 ${registry.subjects.length}건 · 교원 확인 ${registry.confirmedTeachers.length}건 · 담당 확인 ${registry.confirmedPairs.length}건`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
      }

      case "neis_precheck": {
        const termId = body.termId || settings.activeTermId;
        if (!body.draftId && !termId) {
          return NextResponse.json(
            { error: "대상 학기(termId) 또는 초안(draftId)이 필요합니다." },
            { status: 400 }
          );
        }
        const { report, target } = await computeNeisPrecheck(domain, {
          termId: termId || undefined,
          draftId: body.draftId,
        });
        return NextResponse.json({ success: true, action, report, target });
      }

      // ── 나이스 CSV 일괄 생성 (phase9c_f_spec F-2 — 2026-08-18 배선) ──
      // 변환기는 2026-08-14에 실물 대조로 확정됐으나 호출부가 없어 화면 버튼이
      // "준비 중"으로 잠겨 있었다. 이것이 컴시간 완전 대체의 네 번째 축이다.
      case "neis_csv": {
        const termId = body.termId || settings.activeTermId;
        if (!body.draftId && !termId) {
          return NextResponse.json(
            { error: "대상 학기(termId) 또는 초안(draftId)이 필요합니다." },
            { status: 400 }
          );
        }
        const { bundle, report, target } = await computeNeisCsvBundle(domain, {
          termId: termId || undefined,
          draftId: body.draftId,
        });

        // 🔴 B1 차단 — 나이스명이 확정되지 않은 과목이 하나라도 있으면 내보내지 않는다.
        // 그대로 내보내면 플랫폼 과목명이 파일에 박혀 나이스가 거부하거나, 더 나쁘게는
        // **틀린 과목으로 등재된다.** 되돌리기가 어려운 쪽이므로 경고가 아니라 차단이다.
        if (!report.readyForExport) {
          return NextResponse.json(
            {
              error: `나이스 등재명이 정해지지 않은 과목이 ${report.blockers.unmappedSubjects.length}개 있습니다. 먼저 「검사」에서 과목 이름을 맞춘 뒤 내보내 주세요.`,
              report,
              target,
            },
            { status: 400 }
          );
        }
        if (!bundle.files.length) {
          return NextResponse.json({ error: "내보낼 학급이 없습니다." }, { status: 400 });
        }
        return NextResponse.json({ success: true, action, bundle, target, report });
      }

      // ── Phase 9c-E AI 보조 (phase9c_e_spec §4) ──

      case "ai_diagnose": {
        // 표시 전용 (spec §0 철칙) — 이 액션은 어떤 저장도 하지 않는다
        if (!isAiEnabled()) {
          return NextResponse.json({ success: true, action, enabled: false });
        }
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        const { clean, result } = await computeAiDiagnosis(domain, body.draftId);
        return NextResponse.json({ success: true, action, enabled: true, clean, result });
      }

      case "ai_formalize": {
        // E2 — 제안만 반환, 저장 없음 (spec §0 철칙: 반영은 UI 확인 후 slot_ban_save로만)
        if (!isAiEnabled()) {
          return NextResponse.json({ success: true, action, enabled: false });
        }
        const termId = body.termId || settings.activeTermId;
        if (!termId)
          return NextResponse.json({ error: "활성 학기가 없습니다." }, { status: 400 });
        if (typeof body.aiText !== "string" || !body.aiText.trim())
          return NextResponse.json({ error: "요구 문장(aiText)이 필요합니다." }, { status: 400 });
        const proposal = await computeAiFormalize(domain, termId, body.aiText);
        return NextResponse.json({ success: true, action, enabled: true, proposal });
      }

      case "ai_explain": {
        // E3 — 표시 전용 (spec §0 철칙: 어떤 저장도 하지 않는다)
        if (!isAiEnabled()) {
          return NextResponse.json({ success: true, action, enabled: false });
        }
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        const explainResult = await computeAiExplain(domain, body.draftId);
        return NextResponse.json({ success: true, action, enabled: true, result: explainResult });
      }

      case "ai_critique": {
        // E4 — 표시 전용 (spec §0 철칙, v1은 셀 연동 없음)
        if (!isAiEnabled()) {
          return NextResponse.json({ success: true, action, enabled: false });
        }
        if (!body.draftId)
          return NextResponse.json({ error: "draftId가 필요합니다." }, { status: 400 });
        const critiqueResult = await computeAiCritique(domain, body.draftId);
        return NextResponse.json({ success: true, action, enabled: true, result: critiqueResult });
      }

      // ── Phase 9c-H: 교육과정 코호트 등록부 ──
      case "cohort_list": {
        const cohorts = await listCurriculumCohorts(domain);
        return NextResponse.json({ success: true, action, cohorts });
      }

      case "cohort_save": {
        if (!body.cohort) {
          return NextResponse.json({ error: "cohort 객체가 누락되었습니다." }, { status: 400 });
        }
        const cohort = await saveCurriculumCohort(domain, body.cohort, auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "save_curriculum_cohort",
          details: `교육과정 등록부 저장 (${cohort.label})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, cohort });
      }

      case "cohort_delete": {
        if (!body.cohortId) {
          return NextResponse.json({ error: "cohortId가 필요합니다." }, { status: 400 });
        }
        await deleteCurriculumCohort(domain, body.cohortId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "delete_curriculum_cohort",
          details: `교육과정 등록부 삭제 (${body.cohortId})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, cohortId: body.cohortId });
      }

      // ── Phase 9c-H: 신학기 주당 수업 시간 계획 ──
      case "hours_plan_derive": {
        if (!body.sourceTermId) {
          return NextResponse.json({ error: "sourceTermId가 필요합니다." }, { status: 400 });
        }
        const plan = await deriveHoursPlanFromGrids(
          domain,
          body.sourceTermId,
          body.planLabel || "",
          auth.email,
          body.targetTermId
        );
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "derive_hours_plan",
          details: `기초시간표(${body.sourceTermId})에서 주당 수업 시간 계획 생성 (${plan.label})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, plan });
      }

      case "hours_plan_list": {
        const plans = await listHoursPlans(domain);
        return NextResponse.json({ success: true, action, plans });
      }

      case "hours_plan_get": {
        if (!body.planId) {
          return NextResponse.json({ error: "planId가 필요합니다." }, { status: 400 });
        }
        const plan = await getHoursPlan(domain, body.planId);
        if (!plan) {
          return NextResponse.json({ error: "해당 계획을 찾을 수 없습니다." }, { status: 404 });
        }
        return NextResponse.json({ success: true, action, plan });
      }

      case "hours_plan_save": {
        if (!Array.isArray(body.planRows)) {
          return NextResponse.json({ error: "planRows 배열이 필요합니다." }, { status: 400 });
        }
        const plan = await saveHoursPlan(
          domain,
          body.planId,
          {
            label: body.planLabel,
            sourceTermId: body.sourceTermId,
            targetTermId: body.targetTermId,
            rows: body.planRows,
            gradeDayPeriods: body.gradeDayPeriods || {},
            status: body.planStatus,
            reviewNotes: body.reviewNotes,
            // 관문 과목 확정 (subject_dictionary_spec §3-2) — 미제공이면 기존 저장 동작 그대로
            subjectConfirmations: Array.isArray(body.subjectConfirmations)
              ? body.subjectConfirmations
              : undefined,
          },
          auth.email
        );
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "save_hours_plan",
          details: `주당 수업 시간 계획 저장 (${plan.label}, 총 ${plan.rows.length}행)`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, plan });
      }

      case "hours_plan_delete": {
        if (!body.planId) {
          return NextResponse.json({ error: "planId가 필요합니다." }, { status: 400 });
        }
        await deleteHoursPlan(domain, body.planId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "delete_hours_plan",
          details: `주당 수업 시간 계획 삭제 (${body.planId})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, planId: body.planId });
      }

      // ── 교사별 시수표 자동 생성 (hours_source_files_analysis §5ⓓ) — 작업 3단계.
      //    저장은 없다: 결과는 화면 검토 후 기존 hours_plan_save로만 반영된다. ──
      case "hours_assignment_prepare": {
        if (!body.assignmentPdfB64 || !Number.isInteger(body.targetYear) || !Number.isInteger(body.targetSemester)) {
          return NextResponse.json(
            { error: "assignmentPdfB64, targetYear, targetSemester가 필요합니다." },
            { status: 400 }
          );
        }
        const result = await prepareHoursAssignmentJob(domain, auth.email, {
          assignmentPdfB64: body.assignmentPdfB64,
          creativePdfB64: body.creativePdfB64,
          simulXlsxB64: body.simulXlsxB64,
          simulXlsxB64List: Array.isArray(body.simulXlsxB64List)
            ? (body.simulXlsxB64List as string[]).filter((x) => typeof x === "string")
            : undefined,
          targetYear: body.targetYear as number,
          targetSemester: body.targetSemester as number,
        });
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "hours_assignment_prepare",
          details: `배정표 자동 생성 작업 준비 — 부서 ${result.depts.length}개 (job ${result.jobId})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, ...result });
      }
      case "hours_assignment_extract": {
        if (!body.jobId || !Number.isInteger(body.deptIndex)) {
          return NextResponse.json({ error: "jobId, deptIndex가 필요합니다." }, { status: 400 });
        }
        const result = await extractHoursAssignmentDept(domain, body.jobId, body.deptIndex as number);
        return NextResponse.json({ success: true, action, ...result });
      }
      case "hours_assignment_finalize": {
        if (!body.jobId) {
          return NextResponse.json({ error: "jobId가 필요합니다." }, { status: 400 });
        }
        const result = await finalizeHoursAssignmentJob(domain, body.jobId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "hours_assignment_finalize",
          details: `배정표 자동 생성 결과 — 행 ${result.rows.length}건·창체 ${result.creativeRows.length}건·확인 항목 ${result.issues.length}건·미매칭 ${result.unmatchedNames.length}명`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, ...result });
      }

      // ── Phase 9c-I 시수 계획 기반 백지 자동 작성 입력 (phase9c_i_spec §5-1) ──
      case "hours_plan_solve_input": {
        if (!body.planId) {
          return NextResponse.json({ error: "planId가 필요합니다." }, { status: 400 });
        }
        const result = await buildBlankSolveInput(domain, body.planId);
        return NextResponse.json({ success: true, action, ...result });
      }

      // ── 학기 전환 스펙 (term_transition_spec) ──
      case "term_create_draft": {
        if (!body.newTermId) {
          return NextResponse.json({ error: "newTermId가 필요합니다." }, { status: 400 });
        }
        const term = await createDraftTerm(domain, body.newTermId, body.newTermName || "", auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "create_draft_term",
          details: `신학기 초안 생성 (${term.id} - ${term.name})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, term });
      }

      case "registry_inherit": {
        if (!body.fromTermId || !body.toTermId) {
          return NextResponse.json({ error: "fromTermId와 toTermId가 모두 필요합니다." }, { status: 400 });
        }
        const inheritedCounts = await inheritRegistries(domain, body.fromTermId, body.toTermId, auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "inherit_registries",
          details: `등록부 승계 복사 (${body.fromTermId} → ${body.toTermId})`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, inheritedCounts });
      }

      case "draft_adopt": {
        if (!body.draftId || !body.termId) {
          return NextResponse.json({ error: "draftId와 termId가 모두 필요합니다." }, { status: 400 });
        }
        const result = await adoptDraftToTerm(domain, body.draftId, body.termId, auth.email);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "adopt_draft",
          details: `자동 작성 결과 기초시간표 채택 (초안: ${body.draftId} → 학기: ${body.termId}, 총 ${result.gridCount}개 학급)`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, adoptedGridCount: result.gridCount });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (error: any) {
    if (error instanceof DraftOpConflictError || error?.name === "DraftOpConflictError" || error?.statusCode === 409) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AiCallError || error?.name === "AiCallError") {
      // AI 호출 실패는 눈높이 메시지 그대로 (fail-visible — phase9c_e_spec §4)
      return NextResponse.json({ error: error.message }, { status: error.statusCode || 502 });
    }
    if (error instanceof RegistryLockError || error?.name === "RegistryLockError") {
      // 편성 등록부 잠금 (registry_lock_spec §2) — UI가 code·termState로 해제 다이얼로그 분기
      return NextResponse.json(
        { error: error.message, code: "registry-locked", termState: error.termState },
        { status: 423 }
      );
    }
    console.error("[POST /api/timetable/manage] Error:", error);
    return NextResponse.json(
      { error: error.message || "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
