// 사용량 「로그인 맥박」 — 2026-08-21 사용자 발안(「로그인 픽셀」)
//
// 로그인한 사람이 있다는 사실 자체를 방아쇠로 삼아 사용량을 점검한다.
// 근거: 읽기의 다수가 브라우저 onSnapshot 구독이라(`usage_alert.ts` 머리 주석),
// **사용량이 오르는 것과 누군가 로그인해 있는 것은 사실상 같은 사건**이다.
//
// ⚠️ 이 라우트의 두 가지 성질은 의도된 것이다:
//  1. **역할을 보지 않는다** — 일반 교사의 로그인도 방아쇠여야 한다.
//     (숫자를 보여 주는 `/api/ops/usage`는 그대로 super_admin 전용이다.)
//  2. **숫자를 일절 돌려주지 않는다** — 교사가 사용량을 볼 이유가 없다.
//     화면 노출이 0이어야 «보이지 않는 픽셀»이다. 응답은 `{ ok: true }` 뿐이며
//     쓰로틀에 걸렸는지조차 알려 주지 않는다(정보 노출 표면 0).
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { runUsagePulse } from "@/lib/ops/usage_alert";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const auth = await verifyAuthAccess(req);
  if (!auth) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  // 토큰에 domain 필드가 없어 로그인 이메일에서 뽑는다 — 교내 계정 전용 플랫폼이다.
  const domain = (auth.email.split("@")[1] || "").toLowerCase();
  if (!domain) {
    return NextResponse.json({ ok: true });
  }

  // 기다리지 않는다 — 로그인 직후 호출이라 응답 지연이 0이어야 한다.
  // `runUsagePulse`는 내부에서 절대 throw 하지 않는다.
  void runUsagePulse(domain);

  return NextResponse.json({ ok: true });
}
