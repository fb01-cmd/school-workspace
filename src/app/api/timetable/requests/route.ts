import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  cancelSwapRequest,
  computeCandidates,
  createSwapRequest,
  listSwapRequests,
} from "@/lib/timetable/server";
import { SwapRequestApiRequest } from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";

/**
 * Phase 9b: 수업교환 신청 라우트 (교사 본인용) — phase9b_spec §6
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
          body.targetWeekId // 교차 주 맞교환 (§4-3b) — 없거나 weekId와 같으면 같은-주
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

      case "my_list": {
        const requests = await listSwapRequests(domain, {
          requesterEmail: auth.email,
          weekId: body.weekId,
        });
        return NextResponse.json({ success: true, action, requests });
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
