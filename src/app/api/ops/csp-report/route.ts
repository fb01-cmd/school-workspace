/**
 * CSP 위반 보고 수신 (next.config.ts의 Content-Security-Policy-Report-Only가 지정).
 *
 * 브라우저가 자동으로 쏘는 보고라 인증을 걸 수 없다. 저장하지 않고 서버 로그로만
 * 남긴다(Vercel 로그에서 확인) — Firestore 쓰기 0건, 무료 원칙 준수.
 * 관찰 모드 운영 중에만 의미가 있고, 시행 전환 판단의 입력이 된다 (STATUS 행 참조).
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY = 4096; // 보고 한 건이면 충분 — 그 이상은 소음·남용으로 보고 자른다

export async function POST(req: Request) {
  try {
    const text = (await req.text()).slice(0, MAX_BODY);
    // 보고 형식은 {"csp-report": {...}} (report-uri 규격). 파싱 실패해도 원문을 남긴다.
    let summary = text;
    try {
      const parsed = JSON.parse(text);
      const r = parsed["csp-report"] || parsed;
      summary = JSON.stringify({
        page: r["document-uri"],
        violated: r["violated-directive"],
        blocked: r["blocked-uri"],
        sample: (r["script-sample"] || "").slice(0, 80),
      });
    } catch {
      // 원문 유지
    }
    console.warn(`[csp-report] ${summary}`);
  } catch {
    // 보고 수신 실패는 무시 — 이 엔드포인트가 앱 동작에 영향을 주면 안 된다
  }
  return new NextResponse(null, { status: 204 });
}
