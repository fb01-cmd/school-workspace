// 쪽지 인라인 이미지 바이트 프록시 (docs/memo_richtext_spec.md §13)
//
// 왜 프록시인가: Drive thumbnailLink는 만료되고 GIF가 정지 프레임이라 본문 표시용으로
// 부적합. 이 GET은 <img src>가 쿠키(token)를 자동 동봉하는 것을 이용해 기존 인증으로
// 원본 바이트를 흘린다. 열람 자격 = 그 쪽지의 발신자·수신자뿐(resolveAttachmentViewEligibility,
// 순수 함수 — 셀프테스트 대상). 형식은 업로드 시 바이트 서명으로 화이트리스트 검증된
// mimeType만 나가며 nosniff를 강제한다.
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { resolveAttachmentViewEligibility } from "@/lib/memo/attachment_logic";
import { downloadMemoAttachment } from "@/lib/memo/attachments";
import { ATTACHMENT_ID_RE } from "@/lib/memo/richtext";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const email = auth.email.trim().toLowerCase();
    const domain = email.split("@")[1] || "hmh.or.kr";

    const memoId = req.nextUrl.searchParams.get("memoId") || "";
    const attId = req.nextUrl.searchParams.get("attId") || "";
    if (!memoId || memoId.includes("/") || memoId.length > 200 || !ATTACHMENT_ID_RE.test(attId)) {
      return NextResponse.json({ error: "요청 형식이 유효하지 않습니다." }, { status: 400 });
    }

    const snap = await adminDb
      .collection("memos")
      .doc(domain)
      .collection("items")
      .doc(memoId)
      .get();
    const verdict = resolveAttachmentViewEligibility(
      snap.exists ? (snap.data() as any) : null,
      email,
      attId
    );
    if (!verdict.ok) {
      return NextResponse.json(
        { error: verdict.status === 403 ? "이 이미지를 볼 권한이 없습니다." : "이미지를 찾을 수 없습니다." },
        { status: verdict.status }
      );
    }

    const bytes = await downloadMemoAttachment(attId);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": verdict.mimeType,
        "Content-Length": String(bytes.length),
        // 첨부는 불변(재업로드 = 새 id) — 브라우저 캐시로 재열람 비용 절감, 단 private
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (e: any) {
    console.error("[api/memo/attachment] 인라인 이미지 프록시 실패:", e?.message || e);
    return NextResponse.json({ error: "이미지를 불러오지 못했습니다." }, { status: 502 });
  }
}
