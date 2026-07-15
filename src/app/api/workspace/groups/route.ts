import { NextRequest, NextResponse } from "next/server";
import {
  listGroups,
  createGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  listGroupMembers,
  getGroupSettings,
  updateGroupSettings,
  listUsersInOUs,
  checkIsSecurityGroup,
  isMock,
} from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit";
import { verifyAuthAccess } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, operatorEmail, operatorName } = body;

    // ─────────────────────────────────────────
    // 🔐 서버 사이드 인증 가드
    // 조회 액션은 일반 교사도 허용, 그룹 생성/수정/삭제는 수퍼어드민 전용
    // ─────────────────────────────────────────
    const TEACHER_ALLOWED_ACTIONS = ["list", "list_members", "get_settings", "list_for_user"];
    const authUser = await verifyAuthAccess(req);
    if (!authUser) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    if (
      authUser.role !== "super_admin" &&
      !TEACHER_ALLOWED_ACTIONS.includes(action)
    ) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const adminEmail = operatorEmail || authUser.email || "unknown@domain.com";
    const adminName = operatorName || "관리자";

    // 1. LIST GROUPS
    if (action === "list") {
      const { domain } = body;
      if (!domain) {
        return NextResponse.json({ error: "domain is required" }, { status: 400 });
      }
      const groups = await listGroups(domain);
      return NextResponse.json({ groups, isMock });
    }

    // 2. LIST MEMBERS
    if (action === "list_members") {
      const { groupEmail } = body;
      if (!groupEmail) {
        return NextResponse.json({ error: "groupEmail is required" }, { status: 400 });
      }
      const members = await listGroupMembers(groupEmail);
      
      try {
        // Fetch all users in domain (cached or fresh) to resolve names
        const users = await listUsersInOUs(["all"]);
        const userMap = new Map(users.map((u: any) => [u.primaryEmail.toLowerCase(), u.name]));
        
        const resolvedMembers = members.map((m: any) => {
          const name = userMap.get(m.email?.toLowerCase());
          return {
            ...m,
            name: name ? { familyName: name.familyName, givenName: name.givenName } : null,
          };
        });
        return NextResponse.json({ members: resolvedMembers, isMock });
      } catch (err) {
        console.warn("Failed to resolve member names, returning default", err);
        return NextResponse.json({ members, isMock });
      }
    }

    // 3. GET SETTINGS
    if (action === "get_settings") {
      const { groupEmail } = body;
      if (!groupEmail) {
        return NextResponse.json({ error: "groupEmail is required" }, { status: 400 });
      }
      const settings = await getGroupSettings(groupEmail);
      return NextResponse.json({ settings, isMock });
    }

    // 4. CREATE GROUP
    if (action === "create") {
      const { groupEmail, groupName, description } = body;
      if (!groupEmail || !groupName) {
        return NextResponse.json({ error: "groupEmail and groupName are required" }, { status: 400 });
      }
      const group = await createGroup(groupEmail, groupName, description || "");
      await writeAuditLog({
        operatorEmail: adminEmail,
        operatorName: adminName,
        action: "그룹 생성",
        targetEmail: groupEmail,
        details: `그룹명: ${groupName}, 설명: ${description || "없음"}`,
        status: "success",
      });
      return NextResponse.json({ group, isMock });
    }

    // 5. DELETE GROUP
    if (action === "delete") {
      const { groupEmail } = body;
      if (!groupEmail) {
        return NextResponse.json({ error: "groupEmail is required" }, { status: 400 });
      }
      await deleteGroup(groupEmail);
      await writeAuditLog({
        operatorEmail: adminEmail,
        operatorName: adminName,
        action: "그룹 삭제",
        targetEmail: groupEmail,
        details: "그룹이 도메인에서 완전히 삭제되었습니다.",
        status: "success",
      });
      return NextResponse.json({ success: true, isMock });
    }

    // 6. ADD MEMBER
    if (action === "add_member") {
      const { groupEmail, memberEmail } = body;
      if (!groupEmail || !memberEmail) {
        return NextResponse.json({ error: "groupEmail and memberEmail are required" }, { status: 400 });
      }
      await addGroupMember(groupEmail, memberEmail);
      await writeAuditLog({
        operatorEmail: adminEmail,
        operatorName: adminName,
        action: "그룹 멤버 추가",
        targetEmail: memberEmail,
        details: `그룹: ${groupEmail}에 멤버로 추가되었습니다.`,
        status: "success",
      });
      return NextResponse.json({ success: true, isMock });
    }

    // 7. REMOVE MEMBER
    if (action === "remove_member") {
      const { groupEmail, memberEmail } = body;
      if (!groupEmail || !memberEmail) {
        return NextResponse.json({ error: "groupEmail and memberEmail are required" }, { status: 400 });
      }
      await removeGroupMember(groupEmail, memberEmail);
      await writeAuditLog({
        operatorEmail: adminEmail,
        operatorName: adminName,
        action: "그룹 멤버 제외",
        targetEmail: memberEmail,
        details: `그룹: ${groupEmail}에서 제외되었습니다.`,
        status: "success",
      });
      return NextResponse.json({ success: true, isMock });
    }

    // 8. UPDATE SETTINGS
    if (action === "update_settings") {
      const { groupEmail, settings } = body;
      if (!groupEmail || !settings) {
        return NextResponse.json({ error: "groupEmail and settings are required" }, { status: 400 });
      }
      const updated = await updateGroupSettings(groupEmail, settings);
      await writeAuditLog({
        operatorEmail: adminEmail,
        operatorName: adminName,
        action: "그룹 권한 설정 변경",
        targetEmail: groupEmail,
        details: `설정값 변경 적용 완료`,
        status: "success",
      });
      return NextResponse.json({ settings: updated, isMock });
    }

    // 9. CHECK SECURITY GROUP
    if (action === "check_security") {
      const { groupEmails } = body;
      if (!groupEmails || !Array.isArray(groupEmails)) {
        return NextResponse.json({ error: "groupEmails array is required" }, { status: 400 });
      }
      const results: Record<string, boolean> = {};
      for (const email of groupEmails) {
        results[email] = await checkIsSecurityGroup(email);
      }
      return NextResponse.json({ results, isMock });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Groups API error:", error);
    return NextResponse.json({ error: error.message || "Failed to process group request" }, { status: 500 });
  }
}
