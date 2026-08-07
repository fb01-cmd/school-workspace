// 알리미 웹 푸시 — 구독 관리 API (docs/web_push_spec.md §3)
import { verifyAuthAccess } from "@/lib/firebase/admin";
import {
  PushSubscriptionDoc,
  getVapidPublicKey,
  isWebPushConfigured,
  pushSubsColRef,
  sendPushToEmail,
  subIdOfEndpoint,
} from "@/lib/push/webpush";
import { loadTimetableSettings, resolveStudentClass } from "@/lib/timetable/server";
import { NextRequest, NextResponse } from "next/server";

type PushAction = "config" | "subscribe" | "unsubscribe" | "status" | "test_send";

function validEndpoint(endpoint: unknown): endpoint is string {
  return (
    typeof endpoint === "string" &&
    endpoint.startsWith("https://") &&
    endpoint.length <= 2048
  );
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const domain = auth.email.split("@")[1] || "hmh.or.kr";
    const email = auth.email.trim().toLowerCase();
    const body = await req.json().catch(() => ({} as any));
    const action: PushAction = body.action;

    switch (action) {
      case "config": {
        const enabled = isWebPushConfigured();
        let canTest = false;
        if (enabled && auth.role !== "student") {
          if (auth.role === "super_admin") {
            canTest = true;
          } else {
            const settings = await loadTimetableSettings(domain);
            canTest = settings.managerEmails.includes(email);
          }
        }
        return NextResponse.json({
          success: true,
          action,
          enabled,
          publicKey: enabled ? getVapidPublicKey() : null,
          canTest,
        });
      }

      case "subscribe": {
        if (!isWebPushConfigured()) {
          return NextResponse.json({ error: "알림 기능이 아직 설정되지 않았습니다." }, { status: 503 });
        }
        const sub = body.subscription;
        const p256dh = sub?.keys?.p256dh;
        const authKey = sub?.keys?.auth;
        if (
          !validEndpoint(sub?.endpoint) ||
          typeof p256dh !== "string" || !p256dh || p256dh.length > 512 ||
          typeof authKey !== "string" || !authKey || authKey.length > 512
        ) {
          return NextResponse.json({ error: "구독 정보 형식이 유효하지 않습니다." }, { status: 400 });
        }

        // 학생 학년·반은 서버가 강제 도출 — 클라이언트 신고값은 받지 않는다 (스펙 §2)
        let studentClass: { grade: number; classNum: number } | null = null;
        if (auth.role === "student") {
          studentClass = await resolveStudentClass(auth);
        }

        const id = subIdOfEndpoint(sub.endpoint);
        const ref = pushSubsColRef(domain).doc(id);
        const existing = await ref.get();
        const now = Date.now();
        const doc: PushSubscriptionDoc = {
          endpoint: sub.endpoint,
          keys: { p256dh, auth: authKey },
          email,
          uid: auth.uid,
          role: auth.role,
          ...(studentClass ? { grade: studentClass.grade, classNum: studentClass.classNum } : {}),
          userAgent: (req.headers.get("user-agent") || "").slice(0, 200),
          createdAt: existing.exists ? (existing.data() as PushSubscriptionDoc).createdAt : now,
          updatedAt: now,
        };
        await ref.set(doc); // 전체 교체 — 진급·역할 변화 시 이전 스냅샷(grade 등) 잔존 방지
        return NextResponse.json({ success: true, action, subscribed: true });
      }

      case "unsubscribe": {
        if (!validEndpoint(body.endpoint)) {
          return NextResponse.json({ error: "endpoint가 유효하지 않습니다." }, { status: 400 });
        }
        const ref = pushSubsColRef(domain).doc(subIdOfEndpoint(body.endpoint));
        const snap = await ref.get();
        if (snap.exists) {
          const owner = (snap.data() as PushSubscriptionDoc).email;
          if (owner !== email) {
            return NextResponse.json({ error: "본인 구독만 해제할 수 있습니다." }, { status: 403 });
          }
          await ref.delete();
        }
        // 없는 구독 해제는 성공 처리 (멱등)
        return NextResponse.json({ success: true, action, subscribed: false });
      }

      case "status": {
        if (!validEndpoint(body.endpoint)) {
          return NextResponse.json({ error: "endpoint가 유효하지 않습니다." }, { status: 400 });
        }
        const snap = await pushSubsColRef(domain).doc(subIdOfEndpoint(body.endpoint)).get();
        const subscribed =
          snap.exists && (snap.data() as PushSubscriptionDoc).email === email;
        return NextResponse.json({ success: true, action, subscribed });
      }

      case "test_send": {
        if (!isWebPushConfigured()) {
          return NextResponse.json({ error: "알림 기능이 아직 설정되지 않았습니다." }, { status: 503 });
        }
        let allowed = auth.role === "super_admin";
        if (!allowed && auth.role === "teacher") {
          const settings = await loadTimetableSettings(domain);
          allowed = settings.managerEmails.includes(email);
        }
        if (!allowed) {
          return NextResponse.json({ error: "시험 발송 권한이 없습니다." }, { status: 403 });
        }
        const result = await sendPushToEmail(domain, email, {
          title: "알림 시험 발송",
          body: "이 알림이 보이면 정상입니다.",
          tag: "push-test",
        });
        return NextResponse.json({ success: true, action, ...result });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[api/push] 처리 실패:", e?.message || e);
    return NextResponse.json({ error: "알림 요청 처리에 실패했습니다." }, { status: 500 });
  }
}
