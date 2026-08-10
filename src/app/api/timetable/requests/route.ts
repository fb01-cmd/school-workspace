import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  cancelSwapRequest,
  computeCandidates,
  computeCandidatesAllWeeks,
  computeMyProjectedWeeks,
  createSwapRequest,
  deleteSwapDraft,
  listSwapDrafts,
  listSwapRequests,
  notifySwapBatchToManagers,
  saveSwapDraft,
} from "@/lib/timetable/server";
import { SwapBatchItemResult, SwapRequestApiRequest } from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * Phase 9b: 수업교환 신청 라우트 (교사 본인용) — phase9b_spec §6, §13-1
 *
 * 권한: 교직원(teacher·super_admin)만. 학생 전면 차단.
 * 원칙: 후보는 서버가 계산한 것만 신청 가능 — create 시 서버가 재계산해 대조한다 (§5).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    if (auth.role === "student") {
      return NextResponse.json({ error: "수업교환 신청 권한이 없습니다." }, { status: 403 });
    }

    const domain = auth.email.split("@")[1] || "hmh.or.kr";
    const body: SwapRequestApiRequest = await req.json().catch(() => ({} as any));
    const action = body.action;

    switch (action) {
      case "candidates": {
        if (!body.weekId || !body.source) {
          return NextResponse.json({ error: "weekId와 source가 필요합니다." }, { status: 400 });
        }
        const { grade, classNum, day, period } = body.source;
        if (![grade, classNum, day, period].every((n) => Number.isInteger(n) && n > 0)) {
          return NextResponse.json({ error: "source 슬롯 값이 유효하지 않습니다." }, { status: 400 });
        }
        const result = await computeCandidates(
          domain, auth.email, body.weekId,
          { grade, classNum, day, period, subjectName: "" },
          body.targetWeekId, // 교차 주 맞교환 (§4-3b) — 없거나 weekId와 같으면 같은-주
          // §14-1 가상 합성: 본인 PENDING 신청·초안을 겹친 누적 기준 계산 (기본 꺼짐)
          body.includeMyPending || body.includeDrafts
            ? { includeMyPending: !!body.includeMyPending, includeDrafts: !!body.includeDrafts }
            : undefined
        );
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, action, ...result });
      }

      // ── §14-2 v2.1: 전 주 후보 일괄 (그리드 인라인 하이라이트) ──
      // 오버레이 기본 켜짐 — 그리드가 작업 상태이므로 클릭 누적(초안)·대기 신청 위에서 탐색한다.
      case "candidates_all": {
        if (!body.weekId || !body.source) {
          return NextResponse.json({ error: "weekId와 source가 필요합니다." }, { status: 400 });
        }
        const { grade, classNum, day, period } = body.source;
        if (![grade, classNum, day, period].every((n) => Number.isInteger(n) && n > 0)) {
          return NextResponse.json({ error: "source 슬롯 값이 유효하지 않습니다." }, { status: 400 });
        }
        const result = await computeCandidatesAllWeeks(
          domain, auth.email, body.weekId,
          { grade, classNum, day, period, subjectName: "" },
          {
            includeMyPending: body.includeMyPending !== false,
            includeDrafts: body.includeDrafts !== false,
          }
        );
        if (result.error) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        return NextResponse.json({ success: true, action, ...result });
      }

      case "create": {
        if (!body.weekId || !body.source || !body.type || !body.candidate) {
          return NextResponse.json(
            { error: "weekId, source, type, candidate가 모두 필요합니다." },
            { status: 400 }
          );
        }
        if (body.type !== "swap" && body.type !== "substitute") {
          return NextResponse.json({ error: "type은 swap 또는 substitute여야 합니다." }, { status: 400 });
        }
        // 특별보강은 교사 신청 대상이 아님 — 결강은 일과계가 직권 배정으로 처리 (2026-08-04 사용자 확정).
        // 화면에서도 제거되지만 API 우회를 막기 위해 서버에서 차단. 일과계 직권은 manage 라우트(direct_commit) 사용.
        if (body.type === "substitute") {
          return NextResponse.json(
            { error: "특별보강은 교사 신청 대상이 아닙니다. 결강 사유가 있으면 일과계에 문의해 주세요." },
            { status: 400 }
          );
        }
        const { grade, classNum, day, period } = body.source;
        const request = await createSwapRequest(domain, auth.email, {
          weekId: body.weekId,
          type: body.type,
          source: { grade, classNum, day, period, subjectName: body.source.subjectName || "" },
          candidate: body.candidate,
          reason: body.reason,
          targetWeekId: body.targetWeekId,
          consent: body.consent, // 조율 필요 후보의 양해 확인 (consent_swap_opening_spec §3) — 검증·명단 도출은 서버
        });
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.candidate.counterpartEmail,
          action: "create_swap_request",
          details: `수업교환 신청: ${request.source.grade}-${request.source.classNum} ${request.source.day}요일 ${request.source.period}교시 (${request.type}${request.targetWeekId ? `, 교차 주 → ${request.targetWeekId}` : ""}) 사유 ${request.reason.type}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, request });
      }

      // ── 장바구니 일괄 제출 (phase9b_spec §14-2) ───────────────
      // 항목별로 기존 createSwapRequest 재검증을 순차 수행 — 부분 성공 허용 (전체 롤백 없음).
      case "create_batch": {
        const items = body.items;
        if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
          return NextResponse.json({ error: "items 배열(1~20건)이 필요합니다." }, { status: 400 });
        }
        const batchId = randomUUID();
        const results: SwapBatchItemResult[] = [];
        let firstCreated: Awaited<ReturnType<typeof createSwapRequest>> | null = null;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const draftIdField = item?.draftId ? { draftId: item.draftId } : {};
          try {
            if (!item?.weekId || !item.source || !item.candidate) {
              throw new Error("weekId, source, candidate가 모두 필요합니다.");
            }
            // 단건 create와 동일 규약: 교사 신청은 맞교환만 (특별보강 서버 차단과 정합)
            if (item.type !== "swap") {
              throw new Error("일괄 제출은 맞교환(swap) 항목만 가능합니다.");
            }
            const { grade, classNum, day, period } = item.source;
            const request = await createSwapRequest(
              domain, auth.email,
              {
                weekId: item.weekId,
                type: "swap",
                source: { grade, classNum, day, period, subjectName: item.source.subjectName || "" },
                candidate: item.candidate,
                reason: item.reason || body.reason,
                targetWeekId: item.targetWeekId,
                consent: item.consent, // 항목별 양해 확인 — 조율 필요 후보 항목만 필요 (서버가 판정)
              },
              { batchId, skipManagerNotify: true } // 요약 알림 1건으로 대체 (아래)
            );
            if (!firstCreated) firstCreated = request;
            // 접수 성공한 항목의 초안 정리 (본인 소유 검증은 deleteSwapDraft 내부)
            if (item.draftId) {
              try {
                await deleteSwapDraft(domain, auth.email, item.draftId);
              } catch (e: any) {
                console.error(`[create_batch] 초안 정리 실패 (${item.draftId}):`, e.message);
              }
            }
            results.push({ index: i, ok: true, requestId: request.id, ...draftIdField });
          } catch (e: any) {
            results.push({ index: i, ok: false, error: e.message || "접수 실패", ...draftIdField });
          }
        }

        const createdCount = results.filter((r) => r.ok).length;
        if (createdCount > 0 && firstCreated) {
          await notifySwapBatchToManagers(
            domain, firstCreated.requesterName, auth.email, createdCount, items.length
          );
          await writeAuditLog({
            operatorEmail: auth.email,
            targetEmail: auth.email,
            action: "create_swap_batch",
            details: `수업교환 일괄 신청: ${createdCount}/${items.length}건 접수 (batchId ${batchId})`,
            status: "success",
          });
        }
        return NextResponse.json({ success: true, action, batchId, createdCount, results });
      }

      case "my_list": {
        const requests = await listSwapRequests(domain, {
          requesterEmail: auth.email,
          weekId: body.weekId,
        });
        return NextResponse.json({ success: true, action, requests });
      }

      // ── §14-2 v2: 등록 전 주 예상 내 시간표 (알리미식 일렬 나열) ──
      // 기본값 켜짐 — 그리드가 곧 작업 상태이므로 PENDING·초안(클릭 누적)을 항상 반영해 보여준다.
      case "my_projected": {
        const result = await computeMyProjectedWeeks(domain, auth.email, {
          includeMyPending: body.includeMyPending !== false,
          includeDrafts: body.includeDrafts !== false,
        });
        return NextResponse.json({ success: true, action, ...result });
      }

      case "cancel": {
        if (!body.requestId) {
          return NextResponse.json({ error: "requestId가 누락되었습니다." }, { status: 400 });
        }
        const request = await cancelSwapRequest(domain, auth.email, body.requestId);
        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: request.id,
          action: "cancel_swap_request",
          details: `수업교환 신청 취소: ${request.id}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, request });
      }

      // ── 사전 양해 임시저장 API (phase9b_spec §13-1) ───────────

      case "draft_save": {
        try {
          const draft = await saveSwapDraft(
            domain,
            auth.email,
            "",
            body.draftId,
            body.draft
          );
          return NextResponse.json({ success: true, action, draft });
        } catch (e: any) {
          const msg = e.message || "";
          if (
            msg.includes("최대 20건") ||
            msg.includes("수정할 권한") ||
            msg.includes("존재하지 않는") ||
            msg.includes("이메일 형식") ||
            msg.includes("필수 정보")
          ) {
            return NextResponse.json({ error: msg }, { status: 400 });
          }
          throw e;
        }
      }

      case "draft_list": {
        const drafts = await listSwapDrafts(domain, auth.email);
        return NextResponse.json({ success: true, action, drafts });
      }

      case "draft_delete": {
        if (!body.draftId) {
          return NextResponse.json({ error: "draftId가 누락되었습니다." }, { status: 400 });
        }
        try {
          await deleteSwapDraft(domain, auth.email, body.draftId);
          return NextResponse.json({ success: true, action, draftId: body.draftId });
        } catch (e: any) {
          const msg = e.message || "";
          if (msg.includes("삭제할 권한") || msg.includes("존재하지 않는")) {
            return NextResponse.json({ error: msg }, { status: 400 });
          }
          throw e;
        }
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[POST /api/timetable/requests] Error:", error);
    return NextResponse.json(
      { error: error.message || "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
