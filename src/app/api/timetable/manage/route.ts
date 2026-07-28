import { verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { canManageTimetable } from "@/lib/timetable/authz";
import {
  activateTerm,
  commitTimetableImport,
  deleteTerm,
  loadAllTerms,
  loadTimetableSettings,
  saveTimetableSettings,
  validateTimetableImport,
} from "@/lib/timetable/server";
import { ManageAction, ManageTimetableRequest } from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }

    const domain = auth.email.split("@")[1] || "hmh.or.kr";
    const body: ManageTimetableRequest = await req.json().catch(() => ({} as any));
    const action: ManageAction = body.action;

    if (!action) {
      return NextResponse.json({ error: "action 파라미터가 누락되었습니다." }, { status: 400 });
    }

    const settings = await loadTimetableSettings(domain);
    const authzCtx = {
      role: auth.role,
      email: auth.email,
      managerEmails: settings.managerEmails,
    };

    const judgment = canManageTimetable(authzCtx, action);
    if (!judgment.allowed) {
      return NextResponse.json(
        { error: "시간표 관리 권한이 없습니다.", basis: judgment.basis },
        { status: 403 }
      );
    }

    switch (action) {
      case "get_settings": {
        const terms = await loadAllTerms(domain);
        return NextResponse.json({
          success: true,
          action,
          settings,
          terms,
        });
      }

      case "set_managers": {
        if (!Array.isArray(body.managerEmails)) {
          return NextResponse.json(
            { error: "managerEmails 배열이 유효하지 않습니다." },
            { status: 400 }
          );
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const invalidEmails = body.managerEmails.filter(
          (email: string) => !emailRegex.test(email)
        );
        if (invalidEmails.length > 0) {
          return NextResponse.json(
            { error: `올바르지 않은 이메일 형식이 포함되어 있습니다: ${invalidEmails.join(", ")}` },
            { status: 400 }
          );
        }
        const updatedSettings = await saveTimetableSettings(domain, {
          managerEmails: body.managerEmails,
        });

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: domain,
          action: "set_timetable_managers",
          details: `시간표 일과계 관리자 변경: ${body.managerEmails.join(", ")}`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          settings: updatedSettings,
        });
      }

      case "import_validate": {
        if (!body.importPayload) {
          return NextResponse.json(
            { error: "importPayload 데이터가 누락되었습니다." },
            { status: 400 }
          );
        }
        const validationReport = validateTimetableImport(body.importPayload);
        return NextResponse.json({
          success: true,
          action,
          validationReport,
        });
      }

      case "import_commit": {
        if (!body.importPayload) {
          return NextResponse.json(
            { error: "importPayload 데이터가 누락되었습니다." },
            { status: 400 }
          );
        }
        const validationReport = validateTimetableImport(body.importPayload);
        if (!validationReport.canCommit) {
          return NextResponse.json(
            {
              error: "미매칭 교사명이 존재하여 학기를 저장할 수 없습니다.",
              validationReport,
            },
            { status: 400 }
          );
        }

        const term = await commitTimetableImport(domain, body.importPayload, auth.email);
        const terms = await loadAllTerms(domain);

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: term.id,
          action: "import_timetable_draft",
          details: `시간표 임시(draft) 학기 생성: ${term.name} (${term.id})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          term,
          terms,
        });
      }

      case "activate_term": {
        if (!body.termId) {
          return NextResponse.json({ error: "termId가 누락되었습니다." }, { status: 400 });
        }
        const term = await activateTerm(domain, body.termId);
        const terms = await loadAllTerms(domain);
        const updatedSettings = await loadTimetableSettings(domain);

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: term.id,
          action: "activate_timetable_term",
          details: `시간표 정식 학기 활성화: ${term.name} (${term.id})`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          term,
          terms,
          settings: updatedSettings,
        });
      }

      case "delete_term": {
        if (!body.termId) {
          return NextResponse.json({ error: "termId가 누락되었습니다." }, { status: 400 });
        }
        await deleteTerm(domain, body.termId);
        const terms = await loadAllTerms(domain);

        await writeAuditLog({
          operatorEmail: auth.email,
          targetEmail: body.termId,
          action: "delete_timetable_term",
          details: `시간표 초안 학기 삭제: ${body.termId}`,
          status: "success",
        });

        return NextResponse.json({
          success: true,
          action,
          terms,
        });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[POST /api/timetable/manage] Error:", error);
    return NextResponse.json(
      { error: error.message || "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
