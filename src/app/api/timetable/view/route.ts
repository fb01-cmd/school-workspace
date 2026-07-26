import { verifyAuthAccess } from "@/lib/firebase/admin";
import { canViewTimetable } from "@/lib/timetable/authz";
import {
  loadActiveTerm,
  loadAllClassGrids,
  loadClassGrid,
  loadTimetableSettings,
  loadTimetableTerm,
  resolveStudentClass,
  synthesizeFreeTeachers,
  synthesizeTeacherTimetable,
} from "@/lib/timetable/server";
import {
  TimetableTeacher,
  ViewAction,
  ViewTimetableRequest,
  ViewTimetableResponse,
} from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }

    const domain = auth.email.split("@")[1] || "hmh.or.kr";
    const body: ViewTimetableRequest = await req.json().catch(() => ({} as any));
    let action: ViewAction = body.action || "my";
    let requestedGrade = Number(body.grade) || 0;
    let requestedClassNum = Number(body.classNum) || 0;

    const settings = await loadTimetableSettings(domain);

    // 1. 학생 권한 강제 보정 (스펙 0번/1번/3번 대전제: 학생은 무조건 본인 반 시간표로 강제)
    let studentClass: { grade: number; classNum: number } | undefined = undefined;
    if (auth.role === "student") {
      const resolved = await resolveStudentClass(auth);
      if (!resolved) {
        return NextResponse.json(
          { error: "학생의 학적(학년/반) 정보를 찾을 수 없어 시간표를 열람할 수 없습니다." },
          { status: 403 }
        );
      }
      studentClass = resolved;
      action = "class";
      requestedGrade = resolved.grade;
      requestedClassNum = resolved.classNum;
    }

    // 2. 권한 검사
    const authzCtx = {
      role: auth.role,
      email: auth.email,
      managerEmails: settings.managerEmails,
      studentClass,
    };

    const targetClassParam =
      requestedGrade > 0 && requestedClassNum > 0
        ? { grade: requestedGrade, classNum: requestedClassNum }
        : undefined;

    const judgment = canViewTimetable(authzCtx, action, targetClassParam);
    if (!judgment.allowed) {
      return NextResponse.json(
        { error: "시간표 열람 권한이 없습니다.", basis: judgment.basis },
        { status: 403 }
      );
    }

    // 3. 학기(Term) 결정: body.termId가 제공되면 해당 학기, 없으면 active 학기
    let term = body.termId ? await loadTimetableTerm(domain, body.termId) : null;
    if (!term) {
      term = await loadActiveTerm(domain);
    }

    if (!term) {
      const emptyRes: ViewTimetableResponse = {
        term: null,
        action,
        data: null,
      };
      return NextResponse.json(emptyRes);
    }

    const termMeta = {
      id: term.id,
      name: term.name,
      status: term.status,
    };

    // 4. 액션별 데이터 처리
    switch (action) {
      case "my": {
        const allGrids = await loadAllClassGrids(domain, term.id);
        const cells = synthesizeTeacherTimetable(allGrids, auth.email);
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: {
            teacherEmail: auth.email,
            teacherName: auth.email.split("@")[0],
            cells,
          },
        };
        return NextResponse.json(res);
      }

      case "teacher": {
        const targetTeacherEmail = (body.teacherEmail || auth.email).trim().toLowerCase();
        const allGrids = await loadAllClassGrids(domain, term.id);
        const cells = synthesizeTeacherTimetable(allGrids, targetTeacherEmail);
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: {
            teacherEmail: targetTeacherEmail,
            teacherName: targetTeacherEmail.split("@")[0],
            cells,
          },
        };
        return NextResponse.json(res);
      }

      case "class": {
        if (requestedGrade < 1 || requestedClassNum < 1) {
          return NextResponse.json(
            { error: "grade와 classNum 파라미터가 유효하지 않습니다." },
            { status: 400 }
          );
        }
        const classGrid = await loadClassGrid(
          domain,
          term.id,
          requestedGrade,
          requestedClassNum
        );
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: classGrid || { grade: requestedGrade, classNum: requestedClassNum, cells: [] },
        };
        return NextResponse.json(res);
      }

      case "school": {
        const allGrids = await loadAllClassGrids(domain, term.id);
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: allGrids,
        };
        return NextResponse.json(res);
      }

      case "free": {
        const day = Number(body.day) || 1;
        const period = Number(body.period) || 1;
        const allGrids = await loadAllClassGrids(domain, term.id);

        // 등록된 전체 교사 목록 수집 (학기 과목 정보 + 시간표 그리드 내 교사)
        const teacherMap = new Map<string, TimetableTeacher>();
        for (const subj of term.subjects || []) {
          for (const email of subj.teacherEmails || []) {
            const normEmail = email.trim().toLowerCase();
            if (normEmail && !teacherMap.has(normEmail)) {
              teacherMap.set(normEmail, { email: normEmail, name: normEmail.split("@")[0] });
            }
          }
        }
        for (const grid of allGrids) {
          for (const cell of grid.cells || []) {
            for (const lesson of cell.lessons || []) {
              for (const teacher of lesson.teachers || []) {
                const normEmail = (teacher.email || "").trim().toLowerCase();
                if (normEmail) {
                  teacherMap.set(normEmail, { email: normEmail, name: teacher.name || normEmail.split("@")[0] });
                }
              }
            }
          }
        }

        const allTeachers = Array.from(teacherMap.values());
        const freeTeachers = synthesizeFreeTeachers(allGrids, allTeachers, day, period);

        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: freeTeachers,
        };
        return NextResponse.json(res);
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[POST /api/timetable/view] Error:", error);
    return NextResponse.json(
      { error: error.message || "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
