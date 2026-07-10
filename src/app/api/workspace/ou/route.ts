import { NextRequest, NextResponse } from "next/server";
import { listOrgunits, createOrgunit, updateOrgunit, deleteOrgunit, isMock } from "@/lib/google/workspace";

export async function GET(req: NextRequest) {
  try {
    const orgUnits = await listOrgunits();
    return NextResponse.json({ orgUnits, isMock });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to fetch OUs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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
