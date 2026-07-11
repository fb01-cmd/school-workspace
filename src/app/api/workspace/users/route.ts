import { NextRequest, NextResponse } from "next/server";
import { listUsersInOUs, createUser, deleteUser, updateUser, addAlias, deleteAlias, invalidateUserCache, isMock } from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit";

interface RecentAction {
  action: "create" | "delete" | "update";
  timestamp: number;
  data?: any;
}

// In-memory process-level buffer for Google eventual consistency
const recentActionsCache = new Map<string, RecentAction>();

function pruneRecentActions() {
  const now = Date.now();
  for (const [email, record] of recentActionsCache.entries()) {
    if (now - record.timestamp > 120 * 1000) {
      recentActionsCache.delete(email);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, operatorEmail, operatorName } = body;
    const adminEmail = operatorEmail || "unknown@domain.com";
    const adminName = operatorName || "관리자";

    if (action === "list") {
      const { orgUnitPaths } = body;
      if (!Array.isArray(orgUnitPaths)) {
        return NextResponse.json({ error: "orgUnitPaths must be an array" }, { status: 400 });
      }
      pruneRecentActions();
      let users = await listUsersInOUs(orgUnitPaths);

      // Apply patches from recentActionsCache to handle propagation delay
      const now = Date.now();
      for (const [email, record] of recentActionsCache.entries()) {
        if (now - record.timestamp <= 120 * 1000) {
          if (record.action === "delete") {
            users = users.filter((u: any) => u.primaryEmail?.toLowerCase() !== email);
          } else if (record.action === "create") {
            const alreadyExists = users.some((u: any) => u.primaryEmail?.toLowerCase() === email);
            if (!alreadyExists && record.data) {
              const userOrgUnit = record.data.orgUnitPath || "/";
              if (orgUnitPaths.includes(userOrgUnit)) {
                users.unshift(record.data);
              }
            }
          } else if (record.action === "update") {
            users = users.map((u: any) => {
              if (u.primaryEmail?.toLowerCase() === email && record.data) {
                const updatedUser = { ...u, ...record.data };
                if (record.data.orgUnitPath && !orgUnitPaths.includes(record.data.orgUnitPath)) {
                  return null;
                }
                return updatedUser;
              }
              return u;
            }).filter(Boolean);
          }
        }
      }

      return NextResponse.json({ users, isMock });
    }

    if (action === "create") {
      const { email, firstName, lastName, orgUnitPath, password, changePasswordAtNextLogin } = body;
      if (!email || !firstName || !lastName || !orgUnitPath || !password) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      try {
        const user = await createUser(email, firstName, lastName, orgUnitPath, password, !!changePasswordAtNextLogin);
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 생성",
          targetEmail: email,
          details: `이름: ${lastName}${firstName}, 조직단위: ${orgUnitPath}`,
          status: "success",
        });

        // Add to buffer cache to prevent propagation latency
        recentActionsCache.set(email.toLowerCase(), {
          action: "create",
          timestamp: Date.now(),
          data: {
            id: user.id || `temp_${Math.random().toString(36).substr(2, 9)}`,
            primaryEmail: email,
            name: { familyName: lastName, givenName: firstName },
            orgUnitPath,
            changePasswordAtNextLogin: !!changePasswordAtNextLogin,
            suspended: false,
          }
        });

        invalidateUserCache();
        return NextResponse.json({ user, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 생성",
          targetEmail: email,
          details: `계정 생성 실패 (이름: ${lastName}${firstName}, 조직단위: ${orgUnitPath})`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "update") {
      const { email, updates } = body;
      if (!email || !updates) {
        return NextResponse.json({ error: "Email and updates are required" }, { status: 400 });
      }
      try {
        const user = await updateUser(email, updates);
        
        const detailParts = [];
        if (updates.firstName || updates.lastName) detailParts.push(`이름 변경: ${updates.lastName || ""}${updates.firstName || ""}`);
        if (updates.orgUnitPath) detailParts.push(`조직단위 변경: ${updates.orgUnitPath}`);
        if (updates.suspended !== undefined) detailParts.push(`정지상태 변경: ${updates.suspended ? "정지" : "활성"}`);
        if (updates.password) detailParts.push("비밀번호 재설정");
        if (updates.primaryEmail) detailParts.push(`이메일 변경: ${updates.primaryEmail}`);

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: updates.suspended !== undefined ? (updates.suspended ? "계정 정지" : "계정 활성화") : "계정 수정",
          targetEmail: email,
          details: detailParts.length > 0 ? detailParts.join(", ") : "계정 정보 수정",
          status: "success",
        });

        // Add to buffer cache to prevent propagation latency
        const mappedUpdates: any = {};
        if (updates.firstName !== undefined) {
          mappedUpdates.name = mappedUpdates.name || {};
          mappedUpdates.name.givenName = updates.firstName;
        }
        if (updates.lastName !== undefined) {
          mappedUpdates.name = mappedUpdates.name || {};
          mappedUpdates.name.familyName = updates.lastName;
        }
        if (updates.orgUnitPath !== undefined) mappedUpdates.orgUnitPath = updates.orgUnitPath;
        if (updates.suspended !== undefined) mappedUpdates.suspended = updates.suspended;

        recentActionsCache.set(email.toLowerCase(), {
          action: "update",
          timestamp: Date.now(),
          data: mappedUpdates
        });

        invalidateUserCache();
        return NextResponse.json({ user, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 수정",
          targetEmail: email,
          details: `계정 수정 시도 실패`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "delete") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 });
      }
      try {
        await deleteUser(email);
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 삭제",
          targetEmail: email,
          details: `계정 구글 워크스페이스 영구 삭제 완료`,
          status: "success",
        });

        // Add to buffer cache to prevent propagation latency
        recentActionsCache.set(email.toLowerCase(), {
          action: "delete",
          timestamp: Date.now()
        });

        invalidateUserCache();
        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 삭제",
          targetEmail: email,
          details: `계정 삭제 실패`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "bulk_delete") {
      const { emails } = body;
      if (!Array.isArray(emails)) {
        return NextResponse.json({ error: "emails must be an array" }, { status: 400 });
      }
      try {
        const results = await Promise.allSettled(emails.map(email => deleteUser(email)));
        
        const failures = results
          .map((res, idx) => (res.status === "rejected" ? { email: emails[idx], reason: res.reason?.message } : null))
          .filter(Boolean);

        // Add successful deletions to buffer cache to prevent propagation latency
        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            recentActionsCache.set(emails[idx].toLowerCase(), {
              action: "delete",
              timestamp: Date.now()
            });
          }
        });

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "일괄 삭제",
          targetEmail: "복수 계정",
          details: failures.length > 0 
            ? `선택한 ${emails.length}개 중 일부 삭제 실패 (실패: ${failures.length}건). 목록: ${emails.join(", ")}` 
            : `계정 ${emails.length}개 일괄 삭제 완료. 대상: ${emails.join(", ")}`,
          status: failures.length > 0 ? "failure" : "success",
          error: failures.length > 0 ? `${failures.length}건 실패` : undefined,
        });

        invalidateUserCache();
        return NextResponse.json({ success: failures.length === 0, failures, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "일괄 삭제",
          targetEmail: "복수 계정",
          details: `일괄 삭제 작업 도중 에러 발생`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "bulk_suspend") {
      const { emails, suspended } = body;
      if (!Array.isArray(emails) || suspended === undefined) {
        return NextResponse.json({ error: "emails and suspended status are required" }, { status: 400 });
      }
      try {
        const results = await Promise.allSettled(
          emails.map(email => updateUser(email, { suspended }))
        );
        
        const failures = results
          .map((res, idx) => (res.status === "rejected" ? { email: emails[idx], reason: res.reason?.message } : null))
          .filter(Boolean);

        // Add successful suspensions to buffer cache to prevent propagation latency
        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            recentActionsCache.set(emails[idx].toLowerCase(), {
              action: "update",
              timestamp: Date.now(),
              data: { suspended }
            });
          }
        });

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: `일괄 ${suspended ? "일시정지" : "활성화"}`,
          targetEmail: "복수 계정",
          details: failures.length > 0 
            ? `선택한 ${emails.length}개 중 일부 처리 실패 (실패: ${failures.length}건).` 
            : `계정 ${emails.length}개 일괄 ${suspended ? "일시정지" : "활성화"} 완료.`,
          status: failures.length > 0 ? "failure" : "success",
          error: failures.length > 0 ? `${failures.length}건 실패` : undefined,
        });

        invalidateUserCache();
        return NextResponse.json({ success: failures.length === 0, failures, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: `일괄 ${suspended ? "일시정지" : "활성화"}`,
          targetEmail: "복수 계정",
          details: `일괄 처리 중 에러 발생`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "add_alias") {
      const { email, alias } = body;
      if (!email || !alias) {
        return NextResponse.json({ error: "Email and alias are required" }, { status: 400 });
      }
      try {
        await addAlias(email, alias);
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "별칭 추가",
          targetEmail: email,
          details: `별칭 계정 추가 완료: ${alias}`,
          status: "success",
        });
        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "별칭 추가",
          targetEmail: email,
          details: `별칭 추가 실패: ${alias}`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "delete_alias") {
      const { email, alias } = body;
      if (!email || !alias) {
        return NextResponse.json({ error: "Email and alias are required" }, { status: 400 });
      }
      try {
        await deleteAlias(email, alias);
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "별칭 삭제",
          targetEmail: email,
          details: `별칭 계정 삭제 완료: ${alias}`,
          status: "success",
        });
        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "별칭 삭제",
          targetEmail: email,
          details: `별칭 삭제 실패: ${alias}`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    if (action === "bulk_save") {
      const { creates, updates } = body;
      const parsedCreates = Array.isArray(creates) ? creates : [];
      const parsedUpdates = Array.isArray(updates) ? updates : [];

      try {
        const createPromises = parsedCreates.map((u: any) =>
          createUser(
            u.email,
            u.firstName,
            u.lastName,
            u.orgUnitPath,
            u.password,
            !!u.changePasswordAtNextLogin
          )
        );

        const updatePromises = parsedUpdates.map((u: any) =>
          updateUser(u.email, u.updates)
        );

        const [createResults, updateResults] = await Promise.all([
          Promise.allSettled(createPromises),
          Promise.allSettled(updatePromises),
        ]);

        const createFailures = createResults
          .map((res, idx) =>
            res.status === "rejected"
              ? { email: parsedCreates[idx].email, reason: res.reason?.message || "알 수 없는 오류" }
              : null
          )
          .filter(Boolean);

        const updateFailures = updateResults
          .map((res, idx) =>
            res.status === "rejected"
              ? { email: parsedUpdates[idx].email, reason: res.reason?.message || "알 수 없는 오류" }
              : null
          )
          .filter(Boolean);

        // Add successful creates to buffer cache to prevent propagation latency
        createResults.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            const u = parsedCreates[idx];
            recentActionsCache.set(u.email.toLowerCase(), {
              action: "create",
              timestamp: Date.now(),
              data: {
                id: `temp_${Math.random().toString(36).substr(2, 9)}`,
                primaryEmail: u.email,
                name: { familyName: u.lastName, givenName: u.firstName },
                orgUnitPath: u.orgUnitPath,
                changePasswordAtNextLogin: !!u.changePasswordAtNextLogin,
                suspended: false,
              }
            });
          }
        });

        // Add successful updates to buffer cache to prevent propagation latency
        updateResults.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            const u = parsedUpdates[idx];
            const mappedUpdates: any = {};
            if (u.updates.firstName !== undefined) {
              mappedUpdates.name = mappedUpdates.name || {};
              mappedUpdates.name.givenName = u.updates.firstName;
            }
            if (u.updates.lastName !== undefined) {
              mappedUpdates.name = mappedUpdates.name || {};
              mappedUpdates.name.familyName = u.updates.lastName;
            }
            if (u.updates.orgUnitPath !== undefined) mappedUpdates.orgUnitPath = u.updates.orgUnitPath;
            if (u.updates.suspended !== undefined) mappedUpdates.suspended = u.updates.suspended;

            recentActionsCache.set(u.email.toLowerCase(), {
              action: "update",
              timestamp: Date.now(),
              data: mappedUpdates
            });
          }
        });

        const success = createFailures.length === 0 && updateFailures.length === 0;

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "웹 시트 일괄 저장",
          targetEmail: "복수 계정",
          details: !success
            ? `일괄 저장 완료 (부분 실패): 생성 실패 ${createFailures.length}건, 수정 실패 ${updateFailures.length}건`
            : `일괄 저장 성공: 생성 ${parsedCreates.length}건, 수정 ${parsedUpdates.length}건 반영 완료.`,
          status: success ? "success" : "failure",
          error: !success ? `생성실패 ${createFailures.length}건, 수정실패 ${updateFailures.length}건` : undefined,
        });

        invalidateUserCache();
        return NextResponse.json({
          success,
          createFailures,
          updateFailures,
          isMock,
        });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "웹 시트 일괄 저장",
          targetEmail: "복수 계정",
          details: `일괄 저장 실행 도중 치명적 에러 발생`,
          status: "failure",
          error: err.message,
        });
        throw err;
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
  }
}
