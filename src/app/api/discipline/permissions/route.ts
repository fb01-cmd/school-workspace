import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  grantsColRef,
  homeroomDocRef,
  loadAllGrants,
  loadAuthzContext,
  loadHomeroomAssignments,
} from "@/lib/discipline/server";
import { computeAccessTargets, judgeDiscipline } from "@/lib/discipline/authz";
import {
  ALL_DISCIPLINE_RIGHTS,
  DisciplineRight,
  DisciplineScope,
  HomeroomAssignmentMap,
} from "@/lib/discipline/types";

/**
 * Phase 6b: 생활지도 권한 관리 API
 *
 * POST /api/discipline/permissions
 * - action: "my"           → 내 유효 권한 요약 (메뉴 표시용 — 서버는 매 요청 재판정하므로 참고용)
 * - action: "list_grants"  → grant 전체 목록 (manage_permissions)
 * - action: "create_grant" → grant 부여 (manage_permissions)
 * - action: "revoke_grant" → grant 회수 (manage_permissions)
 * - action: "get_homeroom" → 담임 배정표 조회 (교직원)
 * - action: "set_homeroom" → 담임 배정표 저장 (manage_permissions)
 */

function validateScope(raw: any): DisciplineScope | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "all") return { type: "all" };
  const grade = Number(raw.grade);
  if (!Number.isInteger(grade) || grade < 1 || grade > 3) return null;
  if (raw.type === "grade") return { type: "grade", grade };
  if (raw.type === "class") {
    const classNum = Number(raw.classNum);
    if (!Number.isInteger(classNum) || classNum < 1 || classNum > 30) return null;
    return { type: "class", grade, classNum };
  }
  return null;
}

function describeScope(scope: DisciplineScope): string {
  if (scope.type === "all") return "전체";
  if (scope.type === "grade") return `${scope.grade}학년 전체`;
  return `${scope.grade}학년 ${scope.classNum}반`;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (auth.role === "student")
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

    const domain = auth.email.split("@")[1];
    if (!domain)
      return NextResponse.json({ error: "도메인 정보를 확인할 수 없습니다." }, { status: 400 });

    const body = await req.json();
    const { action } = body;
    const { ctx } = await loadAuthzContext(domain, auth);

    // ── 내 권한 요약 ──
    if (action === "my") {
      // 메뉴/탭 노출 판단용 요약 불리언 — "어느 범위든 하나라도" 접근 가능하면 true.
      // (참고용일 뿐이며 실제 데이터 접근은 매 요청 서버가 범위 단위로 재판정한다)
      const hasAnyTarget = (right: "view" | "record" | "resolve") =>
        computeAccessTargets(ctx, right, [1, 2, 3]).length > 0;

      return NextResponse.json({
        role: ctx.role,
        email: ctx.email,
        homeroomClasses: ctx.homeroomClasses,
        isHomeroom: ctx.homeroomClasses.length > 0,
        grants: ctx.grants,
        myGrants: ctx.grants,
        visibility: ctx.visibility,
        canView: hasAnyTarget("view"),
        canRecord: hasAnyTarget("record"),
        canResolve: hasAnyTarget("resolve"),
        canManageRules: judgeDiscipline(ctx, "manage_rules").allowed,
        canManagePermissions: judgeDiscipline(ctx, "manage_permissions").allowed,
        // 학년별 판정 요약
        viewableGrades: [1, 2, 3].filter(
          (g) => computeAccessTargets(ctx, "view", [g]).length > 0
        ),
        resolvableGrades: [1, 2, 3].filter(
          (g) => computeAccessTargets(ctx, "resolve", [g]).length > 0
        ),
      });
    }

    // ── grant 목록 ──
    if (action === "list_grants") {
      const judgment = judgeDiscipline(ctx, "manage_permissions");
      if (!judgment.allowed)
        return NextResponse.json({ error: "권한 관리 권한이 없습니다." }, { status: 403 });
      const grants = await loadAllGrants(domain);
      grants.sort((a, b) => (b.grantedAt || 0) - (a.grantedAt || 0));
      return NextResponse.json({ grants });
    }

    // ── grant 부여 ──
    if (action === "create_grant") {
      const judgment = judgeDiscipline(ctx, "manage_permissions");
      if (!judgment.allowed)
        return NextResponse.json({ error: "권한 관리 권한이 없습니다." }, { status: 403 });

      const teacherEmail =
        typeof body.teacherEmail === "string" ? body.teacherEmail.trim().toLowerCase() : "";
      // 학교 도메인 계정만 허용 — 외부/학생 형식(5자리 학번) 계정 부여 차단
      if (!teacherEmail.endsWith(`@${domain}`) || !/^[^@\s]+@[^@\s]+$/.test(teacherEmail))
        return NextResponse.json(
          { error: `학교 도메인(@${domain}) 교직원 계정만 지정할 수 있습니다.` },
          { status: 400 }
        );
      if (/^\d{5}@/.test(teacherEmail))
        return NextResponse.json(
          { error: "학생 계정에는 생활지도 권한을 부여할 수 없습니다." },
          { status: 400 }
        );

      const scope = validateScope(body.scope);
      if (!scope)
        return NextResponse.json(
          { error: "scope 형식이 올바르지 않습니다. (all | grade | class)" },
          { status: 400 }
        );

      const rights: DisciplineRight[] = Array.isArray(body.rights)
        ? Array.from(new Set(body.rights)).filter((r): r is DisciplineRight =>
            (ALL_DISCIPLINE_RIGHTS as string[]).includes(r as string)
          )
        : [];
      if (rights.length === 0)
        return NextResponse.json(
          { error: `부여할 권한을 1개 이상 지정해야 합니다. (${ALL_DISCIPLINE_RIGHTS.join(", ")})` },
          { status: 400 }
        );

      let expiresAt: Timestamp | null = null;
      if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
        // ISO 문자열 또는 epoch millis 숫자 모두 허용
        const ms =
          typeof body.expiresAt === "number" ? body.expiresAt : Date.parse(body.expiresAt);
        if (!Number.isFinite(ms))
          return NextResponse.json({ error: "만료일 형식이 올바르지 않습니다." }, { status: 400 });
        if (ms <= Date.now())
          return NextResponse.json({ error: "만료일은 미래여야 합니다." }, { status: 400 });
        expiresAt = Timestamp.fromMillis(ms);
      }

      const grantId = "grant_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
      await grantsColRef(domain).doc(grantId).set({
        teacherEmail,
        scope,
        rights,
        grantedBy: auth.email,
        grantedAt: Timestamp.now(),
        expiresAt,
      });

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 권한 관리자",
        action: "생활지도 권한 부여",
        targetEmail: teacherEmail,
        details: `범위: ${describeScope(scope)} / 권한: ${rights.join(", ")}${
          expiresAt ? ` / 만료: ${expiresAt.toDate().toISOString().slice(0, 10)}` : ""
        } (판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true, grantId });
    }

    // ── grant 회수 ──
    if (action === "revoke_grant") {
      const judgment = judgeDiscipline(ctx, "manage_permissions");
      if (!judgment.allowed)
        return NextResponse.json({ error: "권한 관리 권한이 없습니다." }, { status: 403 });

      const grantId = body.grantId;
      if (!grantId || typeof grantId !== "string")
        return NextResponse.json({ error: "회수할 grant id가 없습니다." }, { status: 400 });

      // 도메인 하위 경로 직접 참조이므로 타 도메인 grant는 애초에 조회 불가
      const ref = grantsColRef(domain).doc(grantId);
      const snap = await ref.get();
      if (!snap.exists)
        return NextResponse.json({ error: "해당 grant를 찾을 수 없습니다." }, { status: 404 });
      const data = snap.data() || {};
      await ref.delete();

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 권한 관리자",
        action: "생활지도 권한 회수",
        targetEmail: data.teacherEmail || grantId,
        details: `grant ${grantId} 회수 (권한: ${(data.rights || []).join(", ")}) (판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true, grantId });
    }

    // ── 담임 배정표 조회 ──
    if (action === "get_homeroom") {
      const homeroom = await loadHomeroomAssignments(domain);
      return NextResponse.json(homeroom);
    }

    // ── 담임 배정표 저장 ──
    if (action === "set_homeroom") {
      const judgment = judgeDiscipline(ctx, "manage_permissions");
      if (!judgment.allowed)
        return NextResponse.json({ error: "담임 배정표 편집 권한이 없습니다." }, { status: 403 });

      const raw = body.assignments;
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return NextResponse.json({ error: "배정표 형식이 올바르지 않습니다." }, { status: 400 });

      const entries = Object.entries(raw as Record<string, unknown>);
      if (entries.length > 100)
        return NextResponse.json({ error: "배정 항목이 너무 많습니다." }, { status: 400 });

      const assignments: HomeroomAssignmentMap = {};
      for (const [key, value] of entries) {
        const keyMatch = key.match(/^([1-3])-(\d{1,2})$/);
        if (!keyMatch)
          return NextResponse.json(
            { error: `반 키 형식 오류: "${key}" (예: "1-1")` },
            { status: 400 }
          );
        if (typeof value !== "string" || !value.trim()) continue; // 빈 값 = 미배정
        const email = value.trim().toLowerCase();
        if (!email.endsWith(`@${domain}`) || /^\d{5}@/.test(email))
          return NextResponse.json(
            { error: `"${key}"의 담임 계정이 올바르지 않습니다: ${email}` },
            { status: 400 }
          );
        assignments[key] = email;
      }

      await homeroomDocRef(domain).set({
        assignments,
        updatedAt: Timestamp.now(),
        updatedBy: auth.email,
      });

      await writeAuditLog({
        operatorEmail: auth.email,
        operatorName: "생활지도 권한 관리자",
        action: "담임 배정표 저장",
        targetEmail: domain,
        details: `배정 ${Object.keys(assignments).length}건 저장 (판정 근거: ${judgment.basis})`,
        status: "success",
      });
      return NextResponse.json({ success: true, count: Object.keys(assignments).length });
    }

    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  } catch (error: any) {
    console.error("[Discipline Permissions API Error]:", error);
    return NextResponse.json(
      { error: `권한 관리 처리 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }
}
