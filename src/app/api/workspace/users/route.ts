import { NextRequest, NextResponse } from "next/server";
import { listUsersInOUs, createUser, deleteUser, updateUser, addAlias, deleteAlias, invalidateUserCache, isMock, listDeletedUsers, restoreDeletedUser, resetStudentPassword, mockUsers, getUser } from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { deleteAuthUserByEmail, verifyAuthAccess, adminDb } from "@/lib/firebase/admin";
import { mapConcurrentSettled, retryOnRateLimit } from "@/lib/concurrency";
import { isProtectedAccountEmail } from "@/lib/auth/blockedOu";

// 보호 계정 차단 안내 (fb01@·hmnotice@·admin@ — 플랫폼 인프라·알림 발신·DWD 사칭 계정.
// GWS 최고관리자 승격은 콘솔 방어일 뿐, 이 플랫폼은 Admin SDK로 동작하므로 여기서 직접 막아야 한다.
// 2026-08-11 실사고: hmnotice@가 화면에서 일시정지되어 알림 발신이 전면 중단될 뻔함.)
const PROTECTED_BLOCK_MESSAGE =
  "이 계정은 시스템 운영에 필요한 보호 계정이라 정지하거나 삭제할 수 없습니다.";

// Vercel 함수 실행 시간 한도 명시 — 일괄 삭제/정지/저장이 수백 명 단위일 때 대비
export const maxDuration = 60;

async function syncUserSuspensionToLifecycle(email: string, suspended: boolean) {
  try {
    const domain = email.split("@")[1];
    if (!domain) return;

    // 1. 졸업생 태스크 일시정지 상태 동기화
    const gradTaskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
    const gradTaskSnap = await gradTaskRef.get();
    if (gradTaskSnap.exists) {
      const task = gradTaskSnap.data() || {};
      if (suspended) {
        if (task.status === "PENDING" || task.status === "CONSENTED") {
          await gradTaskRef.update({
            status: "SUSPENDED",
            suspendedAt: new Date(),
          });
        }
      } else {
        if (task.status === "SUSPENDED") {
          const originalStatus = task.consentSubmitted ? "CONSENTED" : "PENDING";
          await gradTaskRef.update({
            status: originalStatus,
            suspendedAt: null,
          });
        }
      }
    }

    // 2. 전출/자퇴 태스크 일시정지 상태 동기화
    const transferTaskRef = adminDb.collection("transfer_out_tasks").doc(domain).collection("students").doc(email);
    const transferTaskSnap = await transferTaskRef.get();
    if (transferTaskSnap.exists) {
      const task = transferTaskSnap.data() || {};
      if (suspended) {
        if (task.status === "OU_MOVED") {
          await transferTaskRef.update({
            status: "SUSPENDED",
            suspendedAt: new Date(),
          });
        }
      } else {
        if (task.status === "SUSPENDED") {
          await transferTaskRef.update({
            status: "OU_MOVED",
            suspendedAt: null,
          });
        }
      }
    }
  } catch (err: any) {
    console.error(`[Lifecycle Sync] Failed to sync suspension status for ${email}:`, err.message);
  }
}

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

    // ─────────────────────────────────────────
    // 🔐 서버 사이드 인증 가드
    // list 같은 조회 기능은 승인된 일반 교사도 허용, 나머지 쌓기/수정/삭제는 수퍼어드민 전용
    // ─────────────────────────────────────────
    const TEACHER_ALLOWED_ACTIONS = ["list", "search", "reset_password"];
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

    if (action === "reset_password") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 });
      }
      try {
        const domain = authUser.email.split("@")[1];
        if (!domain) {
          return NextResponse.json({ error: "도메인 정보가 올바르지 않습니다." }, { status: 400 });
        }

        // 1. Fetch target user's details to check their OU
        const targetUser = await getUser(email);
        if (!targetUser) {
          return NextResponse.json({ error: "해당 사용자를 찾을 수 없습니다." }, { status: 404 });
        }
        const targetOU = (targetUser.orgUnitPath || "").toLowerCase().trim();

        // 2. If general teacher, verify target user is in the student OUs
        if (authUser.role !== "super_admin") {
          const settingsSnap = await adminDb.collection("settings").doc(domain).get();
          if (!settingsSnap.exists) {
            return NextResponse.json({ error: "학교 조직단위 설정 정보가 없습니다. Workspace 환경 설정을 완료해 주세요." }, { status: 400 });
          }
          const sData = settingsSnap.data() || {};
          const studentOUMappings: Record<string, string> = sData?.ouMapping?.students || {};
          const studentOUPaths = Object.values(studentOUMappings).map(p => p.toLowerCase().trim());

          const isTargetInStudentOU = studentOUPaths.some(studentOU => 
            targetOU === studentOU || targetOU.startsWith(studentOU + "/")
          );

          if (!isTargetInStudentOU) {
            return NextResponse.json({ 
              error: "일반 교사는 학생 조직단위(OU)에 소속된 계정만 비밀번호를 초기화할 수 있습니다." 
            }, { status: 403 });
          }
        }

        const { tempPassword } = await resetStudentPassword(email);
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "비밀번호 초기화",
          targetEmail: email,
          details: `학생 비밀번호 일괄 임시번호(${tempPassword})로 초기화 및 로그인 시 강제변경 지정`,
          status: "success",
        });
        return NextResponse.json({ success: true, tempPassword, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "비밀번호 초기화",
          targetEmail: email,
          details: `비밀번호 초기화 실패`,
          status: "failure",
          error: err.message,
        });
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
    }

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
                // "all" 요청은 전 OU 포함이므로 OU 이동 패치로 제외하면 안 된다
                // (2026-08-11 실사고: 정지상태 수정 직후 계정이 목록·검색에서 120초+캐시 TTL 동안 실종)
                if (
                  record.data.orgUnitPath &&
                  !orgUnitPaths.includes("all") &&
                  !orgUnitPaths.includes(record.data.orgUnitPath)
                ) {
                  return null;
                }
                return updatedUser;
              }
              return u;
            }).filter(Boolean);
          }
        }
      }

      // 응답 직전 필드 트리밍 — 클라이언트 7곳 소비 필드(6개)만 포함.
      // workspace.ts/listUsersInOUs 는 풀 객체를 반환한 채로 유지 (크론·lifecycle·roster feed·sheets가 직접 소비).
      const trimmedUsers = users.map((u: any) => ({
        id: u.id,
        primaryEmail: u.primaryEmail,
        name: {
          familyName: u.name?.familyName ?? "",
          givenName: u.name?.givenName ?? "",
        },
        orgUnitPath: u.orgUnitPath,
        suspended: !!u.suspended,
        aliases: u.aliases || [],
      }));

      return NextResponse.json({ users: trimmedUsers, isMock });
    }

    if (action === "search") {
      const { query } = body;
      if (!query || typeof query !== "string") {
        return NextResponse.json({ users: [], isMock });
      }
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) {
        return NextResponse.json({ users: [], isMock });
      }

      const allUsers = await listUsersInOUs(["all"]);
      
      const filtered = allUsers.filter((u: any) => {
        const email = (u.primaryEmail || "").toLowerCase();
        const familyName = (u.name?.familyName || "").toLowerCase();
        const givenName = (u.name?.givenName || "").toLowerCase();
        const fullName = familyName + givenName;
        const reversedFullName = givenName + familyName;
        
        return (
          email.includes(normalizedQuery) ||
          familyName.includes(normalizedQuery) ||
          givenName.includes(normalizedQuery) ||
          fullName.includes(normalizedQuery) ||
          reversedFullName.includes(normalizedQuery)
        );
      });
      
      const limited = filtered.slice(0, 15).map((u: any) => ({
        primaryEmail: u.primaryEmail,
        name: u.name,
        orgUnitPath: u.orgUnitPath,
      }));

      return NextResponse.json({ users: limited, isMock });
    }

    if (action === "create") {
      const { email, firstName, lastName, orgUnitPath, password, changePasswordAtNextLogin } = body;
      if (!email || !firstName || !lastName || !orgUnitPath || !password) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      if (isProtectedAccountEmail(email)) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 생성",
          targetEmail: email,
          details: "보호 계정이라 생성 요청을 차단함",
          status: "failure",
          error: "protected-account",
        });
        return NextResponse.json(
          { error: "이 주소는 시스템 운영에 필요한 보호 계정이라 새로 만들 수 없습니다." },
          { status: 403 }
        );
      }
      try {
        // 계정 생성 전, GWS 고유 ID 변경에 따른 Firebase Auth 로그인 충돌 방지를 위해 stale 계정 선제 정리
        await deleteAuthUserByEmail(email);

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
      // 보호 계정 정지 차단 (활성화 방향은 허용 — 복구 경로는 막지 않는다)
      if (updates.suspended === true && isProtectedAccountEmail(email)) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 정지",
          targetEmail: email,
          details: "보호 계정이라 정지 요청을 차단함",
          status: "failure",
          error: "protected-account",
        });
        return NextResponse.json({ error: PROTECTED_BLOCK_MESSAGE }, { status: 403 });
      }
      try {
        const user = await updateUser(email, updates);
        
        if (updates.suspended !== undefined) {
          await syncUserSuspensionToLifecycle(email, updates.suspended);
        }
        
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
      if (isProtectedAccountEmail(email)) {
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 삭제",
          targetEmail: email,
          details: "보호 계정이라 삭제 요청을 차단함",
          status: "failure",
          error: "protected-account",
        });
        return NextResponse.json({ error: PROTECTED_BLOCK_MESSAGE }, { status: 403 });
      }
      try {
        // Firebase Auth에서도 해당 유저 레코드 동기화 삭제
        await deleteAuthUserByEmail(email);

        await deleteUser(email);
        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "계정 삭제",
          targetEmail: email,
          details: `계정 구글 워크스페이스 및 Firebase 인증 영구 삭제 완료`,
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
      const { emails: rawEmails } = body;
      if (!Array.isArray(rawEmails)) {
        return NextResponse.json({ error: "emails must be an array" }, { status: 400 });
      }
      // 보호 계정은 대상에서 제외하고 실패 항목으로 보고 (일괄 선택에 휩쓸리는 사고 방지)
      const protectedTargets: string[] = rawEmails.filter((e: string) => isProtectedAccountEmail(e));
      const emails: string[] = rawEmails.filter((e: string) => !isProtectedAccountEmail(e));
      try {
        // Firebase Auth에서도 해당 유저 레코드들을 즉시 일괄 삭제
        // (동시성 제한 — 무제한 동시 발사는 API 429로 부분 실패 발생)
        await mapConcurrentSettled(emails, 10, (email: string) => deleteAuthUserByEmail(email));

        // Directory API 삭제는 분당 쿼터 창이 좁다 — 2026-08-07 316명 삭제에서 동시성 8·
        // 재시도 없음 조합이 쿼터 창 소진 구간의 126건을 즉시 실패 확정시킨 실사고.
        // 동시성을 낮추고 429는 지수 백오프로 재시도한다. (수백 명 단위 연 1회 대량
        // 정리는 함수 시간 한도 내 완주가 어려울 수 있음 — 남은 건 재선택·재실행이 복구 경로)
        const results = await mapConcurrentSettled(emails, 3, (email: string) =>
          retryOnRateLimit(() => deleteUser(email))
        );

        const failures = [
          ...protectedTargets.map((email) => ({ email, reason: "보호 계정 — 삭제 불가" })),
          ...results
            .map((res, idx) => (res.status === "rejected" ? { email: emails[idx], reason: res.reason?.message } : null))
            .filter(Boolean),
        ];

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
          // 실패 시엔 "실패한 계정 + 사유"를 기록한다 — 전체 선택 목록을 재나열하면
          // 무엇이 실패했는지 알 수 없고 로그만 비대해진다 (2026-08-07 원인 추적 불가 사례)
          details: failures.length > 0
            ? `선택한 ${emails.length}개 중 ${failures.length}건 삭제 실패 — ${failures
                .map((f) => `${f!.email}(${f!.reason || "사유 미상"})`)
                .join(", ")
                .slice(0, 3000)}`
            : `계정 ${emails.length}개 일괄 삭제 완료. 대상: ${
                emails.length > 30 ? `${emails.slice(0, 30).join(", ")} 외 ${emails.length - 30}건` : emails.join(", ")
              }`,
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
      const { emails: rawEmails, suspended } = body;
      if (!Array.isArray(rawEmails) || suspended === undefined) {
        return NextResponse.json({ error: "emails and suspended status are required" }, { status: 400 });
      }
      // 보호 계정은 정지 방향에서만 제외 (활성화 방향은 허용 — 복구 경로는 막지 않는다)
      const protectedTargets: string[] = suspended === true
        ? rawEmails.filter((e: string) => isProtectedAccountEmail(e))
        : [];
      const emails: string[] = rawEmails.filter((e: string) => !protectedTargets.includes(e));
      try {
        const results = await mapConcurrentSettled(emails, 8, (email: string) => updateUser(email, { suspended }));

        const failures = [
          ...protectedTargets.map((email) => ({ email, reason: "보호 계정 — 정지 불가" })),
          ...results
            .map((res, idx) => (res.status === "rejected" ? { email: emails[idx], reason: res.reason?.message } : null))
            .filter(Boolean),
        ];

        // Add successful suspensions to buffer cache to prevent propagation latency
        results.forEach((res, idx) => {
          if (res.status === "fulfilled") {
            const email = emails[idx];
            recentActionsCache.set(email.toLowerCase(), {
              action: "update",
              timestamp: Date.now(),
              data: { suspended }
            });
            // 생애주기 테이블 동기화 연동 (비동기 수행)
            syncUserSuspensionToLifecycle(email, suspended);
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
        // 생성·수정 각각 동시성 5 제한 (합산 최대 10 동시 호출)
        const [createResults, updateResults] = await Promise.all([
          mapConcurrentSettled(parsedCreates, 5, (u: any) =>
            createUser(
              u.email,
              u.firstName,
              u.lastName,
              u.orgUnitPath,
              u.password,
              !!u.changePasswordAtNextLogin
            )
          ),
          mapConcurrentSettled(parsedUpdates, 5, (u: any) =>
            updateUser(u.email, u.updates)
          ),
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

            if (u.updates.suspended !== undefined) {
              // 생애주기 테이블 동기화 연동 (비동기 수행)
              syncUserSuspensionToLifecycle(u.email, u.updates.suspended);
            }
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

    // 8. LIST DELETED USERS
    if (action === "list_deleted") {
      const domain = adminEmail.split("@")[1];
      if (!domain) {
        return NextResponse.json({ error: "올바르지 않은 관리자 계정 도메인입니다." }, { status: 400 });
      }
      try {
        const deletedUsers = await listDeletedUsers(domain);
        return NextResponse.json({ users: deletedUsers, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `삭제 사용자 조회 실패: ${err.message}` }, { status: 500 });
      }
    }

    // 9. RESTORE DELETED USER
    if (action === "restore") {
      const { email, id, orgUnitPath } = body;
      const targetKey = id || email;
      if (!targetKey || !orgUnitPath) {
        return NextResponse.json({ error: "email/id와 orgUnitPath는 필수입니다." }, { status: 400 });
      }
      try {
        await restoreDeletedUser(targetKey, orgUnitPath);
        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "삭제 계정 복원",
          targetEmail: email,
          details: `삭제된 계정을 [${orgUnitPath}] 조직단위로 복원 처리 완료`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        let friendlyMessage = err.message || "알 수 없는 오류가 발생했습니다.";
        const isConflict = friendlyMessage.includes("already exists") || 
                           friendlyMessage.includes("EntityAlreadyExists") || 
                           friendlyMessage.includes("domainUserEmailAlreadyExists");
        
        if (isConflict) {
          friendlyMessage = "동일한 이메일 주소를 사용하는 활성 계정이 이미 존재하여 복원할 수 없습니다. (이메일 중복 충돌)";
        }

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "삭제 계정 복원",
          targetEmail: email,
          details: `삭제된 계정 복원 시도 실패`,
          status: "failure",
          error: friendlyMessage,
        });
        return NextResponse.json({ error: friendlyMessage }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
  }
}
