import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { canManageTimetable } from "@/lib/timetable/authz";
import { listSimulCells } from "@/lib/timetable/simul";
import {
  activateTerm,
  approveSwapRequest,
  commitTimetableImport,
  computeCandidatesAllWeeks,
  computeDirectCandidates,
  computeDirectProjectedWeeks,
  computeHourTotals,
  deleteTerm,
  directCommit,
  listNeisRows,
  listSwapRequests,
  validatePendingSwapRequests,
  listWeeks,
  loadAllClassGrids,
  loadAllTerms,
  loadSimulGroups,
  loadTimetableSettings,
  simulGroupsColRef,
  validateSimulGroupPayload,
  registerWeek,
  rejectSwapRequest,
  revertTimetableChange,
  saveTimetableSettings,
  updateWeek,
  validateTimetableImport,
} from "@/lib/timetable/server";
import {
  DirectCommitBatchItemResult,
  ManageAction,
  ManageTimetableRequest,
} from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

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
          pendingItems?.length ? { extraItems: pendingItems } : undefined
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
        const result = await computeDirectProjectedWeeks(
          domain, String(body.teacherEmail).trim().toLowerCase(), pendingItems
        );
        return NextResponse.json({ success: true, action, ...result });
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
            const { request, change } = await directCommit(domain, auth.email, {
              weekId: item.weekId,
              type: item.type,
              source: { grade, classNum, day, period, subjectName: item.source.subjectName || "" },
              candidate: item.candidate,
              reason: item.reason || body.reason,
              targetWeekId: item.targetWeekId,
              batchId,
            });
            await writeAuditLog({
              operatorEmail: auth.email,
              targetEmail: request.requesterEmail,
              action: "direct_swap_commit",
              details: `일과계 직권 배정: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}${request.targetWeekId ? `, 교차 주 → ${request.targetWeekId}` : ""}) → change ${change.id} (일괄 ${i + 1}/${items.length}, batchId ${batchId})`,
              status: "success",
            });
            results.push({ index: i, ok: true, requestId: request.id, changeId: change.id });
          } catch (e: any) {
            results.push({ index: i, ok: false, error: e.message || "반영 실패" });
          }
        }
        const committedCount = results.filter((r) => r.ok).length;
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
        await ref.delete();
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "simul_group_delete",
          details: `동시수업 그룹 삭제: ${label}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action });
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
