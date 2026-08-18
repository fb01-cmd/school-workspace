// 사용량 보기 API (docs/usage_dashboard_spec.md §3)
//
// 열람은 super_admin 전용 — 클라이언트 조건부 렌더에 맡기지 않고 **서버에서 막는다**.
// Firestore 읽기는 권한 확인(users 문서 1건)뿐이고 사용량 자료 자체는 Cloud Monitoring에서
// 온다 — 감시 도구가 감시 대상을 늘리지 않는다(스펙 §2).
import { verifyAuthAccess } from "@/lib/firebase/admin";
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
    const snapshot = await getUsageSnapshot({ days: Number.isFinite(days) ? days : 30, force });
    // available:false도 200으로 내린다 — 고장이 아니라 "아직 안 켠 기능"이고,
    // 화면은 오류가 아니라 안내 카드를 그려야 한다(스펙 §3).
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error: any) {
    console.error("[Ops Usage] 조회 실패:", error);
    return NextResponse.json({ error: "사용량을 불러오지 못했습니다." }, { status: 500 });
  }
}
