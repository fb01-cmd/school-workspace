// 절약 모드 토글 API (docs/saving_mode_spec.md §3·§6)
//
// 읽기는 이 API가 주 경로가 아니다 — 클라이언트는 platform_config/saving_mode 문서를
// 직접 구독한다(즉시 전파). 여기 GET은 서버·검증용 확인 창구다.
//
// ⚠️ 자동 발동 경로를 추가하지 말 것(스펙 §6): 임계 초과 시 시스템이 스스로 켜면
//    오탐 때 조용히 품질이 떨어지고, 무엇보다 급증의 **원인 규명을 가린다**.
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { buildSavingBannerText } from "@/lib/ops/saving_logic";
import { getSavingMode, setSavingMode } from "@/lib/ops/saving_mode";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const auth = await verifyAuthAccess(req);
  if (!auth) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const resolved = await getSavingMode();
  return NextResponse.json({
    success: true,
    active: resolved.active,
    expiresAt: resolved.expiresAt ?? null,
    remainingMs: resolved.remainingMs ?? null,
    turnedOnBy: resolved.turnedOnBy ?? null,
    knobs: resolved.knobs,
    banner: buildSavingBannerText(resolved),
  });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuthAccess(req);
  if (!auth) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (auth.role !== "super_admin") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ error: "on(true|false)이 필요합니다." }, { status: 400 });
  }

  const { resolved } = await setSavingMode(body.on, auth.email);
  return NextResponse.json({
    success: true,
    active: resolved.active,
    expiresAt: resolved.expiresAt ?? null,
    remainingMs: resolved.remainingMs ?? null,
    knobs: resolved.knobs,
    banner: buildSavingBannerText(resolved),
  });
}
