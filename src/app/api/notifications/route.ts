// 알림 센터 API (docs/notification_center_spec.md §1·§2·§4)
// 본인 강제: 모든 액션이 인증 이메일 기준으로만 동작 — recipientEmail을 요청에서 받지 않는다.

import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  listNotifications,
  markAllNotificationsRead,
  decideActionableNotification,
} from "@/lib/notifications/server";
import { transitionDraftConsent } from "@/lib/timetable/server";
import { emitNotification } from "@/lib/notifications/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const email = auth.email.trim().toLowerCase();
    const domain = email.split("@")[1] || "";
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case "list": {
        const { items, hasMore } = await listNotifications(domain, email, body.limit);
        return NextResponse.json({ success: true, action, items, hasMore });
      }

      case "mark_read": {
        const marked = await markAllNotificationsRead(domain, email);
        return NextResponse.json({ success: true, action, marked });
      }

      // 수락 창구 (스펙 §4) — 양해 요청 알림의 [양해합니다]/[어렵습니다]
      case "consent_decide": {
        if (!body.notificationId || !["accepted", "declined"].includes(body.decision)) {
          return NextResponse.json(
            { error: "notificationId와 decision(accepted|declined)이 필요합니다." },
            { status: 400 }
          );
        }
        const decision = body.decision as "accepted" | "declined";
        const decisionNote = typeof body.note === "string" ? body.note : undefined;
        const notif = await decideActionableNotification(
          domain,
          email,
          body.notificationId,
          decision,
          decisionNote
        );
        // 원본(양해 초안) 전이 — REQUESTED일 때만 전이하고, 아니면 알림만 정리된다
        let draftRequester: string | null = null;
        if (notif.refType === "swap_draft") {
          draftRequester = await transitionDraftConsent(
            domain,
            notif.refId,
            decision === "accepted" ? "CONSENTED" : "DECLINED",
            decisionNote
          );
        }
        // 신청자에게 결과 알림 (스펙 §4 — 수락 기록은 원본 기한 보존 대상이라 길게).
        // 당사자의 한 줄 사유는 message로 동봉 (미니 쪽지 왕복, 2026-08-18 사용자)
        if (draftRequester) {
          await emitNotification(domain, {
            recipientEmail: draftRequester,
            type: "consent-result",
            title:
              decision === "accepted"
                ? "요청하신 양해를 상대 선생님이 수락했습니다."
                : "요청하신 양해를 상대 선생님이 수락하지 못했습니다.",
            refType: "swap_draft",
            refId: notif.refId,
            ...(notif.actionable?.note ? { message: notif.actionable.note } : {}),
            retentionDays: 365,
          });
        }
        await writeAuditLog({
          operatorEmail: email,
          targetEmail: domain,
          action: "consent_decide",
          details: `양해 ${decision === "accepted" ? "수락" : "거절"} — 알림 ${body.notificationId} / 초안 ${notif.refId}`,
          status: "success",
        });
        return NextResponse.json({ success: true, action, notification: notif });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (error) {
    const e = error as Error;
    console.error("[POST /api/notifications] Error:", e);
    return NextResponse.json({ error: e.message || "서버 내부 오류가 발생했습니다." }, { status: 500 });
  }
}
