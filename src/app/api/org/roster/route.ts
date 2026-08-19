// 교직원 명단 색인 재조립 창구 (docs/roster_index_spec.md §2)
//
// 이 라우트가 존재하는 이유: 색인은 **서버만** 만들 수 있어야 한다. 클라이언트가 명단을
// 조립해 올려 보내는 형태였다면 교사 1명이 전원의 명단을 오염시킬 수 있다(원본은 승인제로
// 잠겨 있는데 사본이 뒷문이 되는 형태). 여기서는 요청자가 "다시 만들어라"만 말할 수 있고,
// 내용은 서버가 Firestore 원본에서 직접 읽어 정한다.
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { buildRosterIndex } from "@/lib/org/roster_index";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const email = auth.email.trim().toLowerCase();
    const domain = email.split("@")[1] || "hmh.or.kr";

    const body = await req.json().catch(() => ({}));
    if (body?.action !== "rebuild") {
      return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    }

    // 자격 = 승인 역할(교직원). 내선번호 수정은 일반 교사도 하는 쓰기이므로
    // 수퍼어드민으로 좁히면 그 경로에서 색인이 갱신되지 않는다(스펙 §2-4).
    const userSnap = await adminDb.collection("users").doc(auth.uid).get();
    const userData = userSnap.data();
    if (!userData || !["teacher", "super_admin"].includes(userData.role)) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    // 디바운스는 buildRosterIndex 안에 있다 — 연타·동시 편집이 89 reads × N이 되지 않는다.
    const result = await buildRosterIndex(domain, { builtBy: "write" });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[api/org/roster] 재조립 실패:", error);
    // 실패해도 화면은 원본 폴백으로 정상 동작한다 — 호출부는 fire-and-forget이다.
    return NextResponse.json({ error: error?.message || "재조립에 실패했습니다." }, { status: 500 });
  }
}
