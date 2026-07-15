import { NextRequest, NextResponse } from "next/server";
import { listOrgunits, createOrgunit, updateOrgunit, deleteOrgunit, isMock } from "@/lib/google/workspace";
import { verifyAuthAccess } from "@/lib/firebase/admin";

export async function GET(req: NextRequest) {
  // OU 조회는 로그인된 교사/어드민 모두 허용 (명렬표 및 OU 설정 화면에서 사용)
  const authUser = await verifyAuthAccess(req);
  if (!authUser) {
    return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }
  try {
    const orgUnits = await listOrgunits();
    return NextResponse.json({ orgUnits, isMock });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch OUs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // OU 생성은 수퍼어드민 전용
  const authUser = await verifyAuthAccess(req);
  if (!authUser) {
    return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }
  if (authUser.role !== "super_admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  try {
    const { name, parentOrgUnitPath } = await req.json();
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const newOU = await createOrgunit(name, parentOrgUnitPath || "/");
    return NextResponse.json({ orgUnit: newOU, isMock });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to create OU" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  // OU 이름 수정은 수퍼어드민 전용
  const authUser = await verifyAuthAccess(req);
  if (!authUser) {
    return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }
  if (authUser.role !== "super_admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  try {
    const { orgUnitPath, newName } = await req.json();
    if (!orgUnitPath || !newName) {
      return NextResponse.json({ error: "orgUnitPath and newName are required" }, { status: 400 });
    }
    const result = await updateOrgunit(orgUnitPath, newName);
    return NextResponse.json({ result, isMock });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update OU" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // OU 삭제는 수퍼어드민 전용
  const authUser = await verifyAuthAccess(req);
  if (!authUser) {
    return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
  }
  if (authUser.role !== "super_admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  try {
    const { orgUnitPath } = await req.json();
    if (!orgUnitPath) {
      return NextResponse.json({ error: "orgUnitPath is required" }, { status: 400 });
    }
    await deleteOrgunit(orgUnitPath);
    return NextResponse.json({ success: true, isMock });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to delete OU" }, { status: 500 });
  }
}
