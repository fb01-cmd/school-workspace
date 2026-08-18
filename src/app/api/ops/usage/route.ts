// 사용량 보기 API (docs/usage_dashboard_spec.md §3)
//
// 열람은 super_admin 전용 — 클라이언트 조건부 렌더에 맡기지 않고 **서버에서 막는다**.
// Firestore 읽기는 권한 확인(users 문서 1건)뿐이고 사용량 자료 자체는 Cloud Monitoring에서
// 온다 — 감시 도구가 감시 대상을 늘리지 않는다(스펙 §2).
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { getAlertRecipients, setAlertRecipients } from "@/lib/ops/usage_alert";
import { getUsageSnapshot } from "@/lib/ops/usage_query";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const auth = await verifyAuthAccess(req);
  if (!auth) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  if (auth.role !== "super_admin") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const days = Number(params.get("days") || 30);
  // 「다시 확인」 버튼용 — 60초 캐시를 건너뛴다. 이게 없으면 사용자가 새로고침을 눌러도
  // 1분 동안 같은 숫자가 나와 버튼이 고장난 것처럼 보인다.
  const force = params.get("force") === "1";

  try {
    const [snapshot, alert] = await Promise.all([
      getUsageSnapshot({ days: Number.isFinite(days) ? days : 30, force }),
      getAlertRecipients(),
    ]);
    // available:false도 200으로 내린다 — 고장이 아니라 "아직 안 켠 기능"이고,
    // 화면은 오류가 아니라 안내 카드를 그려야 한다(스펙 §3).
    return NextResponse.json({ success: true, ...snapshot, alert });
  } catch (error: any) {
    console.error("[Ops Usage] 조회 실패:", error);
    return NextResponse.json({ error: "사용량을 불러오지 못했습니다." }, { status: 500 });
  }
}

/**
 * 경보 받는 사람 지정 (어드민 화면).
 *
 * 왜 화면에서 정하게 하는가: 수신자를 role로 추론했더니 이 학교의 super_admin 4개가
 * 전부 상시 로그인하지 않는 계정이라 **알림이 아무도 못 보는 상태**였다(2026-08-18).
 * 누가 이 알림을 볼 것인가는 사람이 정할 문제다.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuthAccess(req);
  if (!auth) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (auth.role !== "super_admin") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.action !== "set_recipients") {
    return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  }

  const result = await setAlertRecipients(body.recipients);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true, alert: result.view });
}
