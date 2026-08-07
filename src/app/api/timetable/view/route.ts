import { verifyAuthAccess } from "@/lib/firebase/admin";
import { canViewTimetable } from "@/lib/timetable/authz";
import { buildSlotIndex, isBlockTeacher } from "@/lib/timetable/swap";
import {
  currentMondayISO,
  findCurrentWeek,
  loadActiveTerm,
  loadAllClassGrids,
  loadBaseGridsForWeek,
  loadTimetableSettings,
  loadTimetableTerm,
  loadWeek,
  loadWeekChanges,
  resolveStudentClass,
  synthesizeFreeTeachers,
  synthesizeTeacherTimetable,
} from "@/lib/timetable/server";
import { synthesizeWeeklyGrids } from "@/lib/timetable/weekly";
import {
  ClassGrid,
  TimetableTeacher,
  ViewAction,
  ViewTimetableRequest,
  ViewTimetableResponse,
} from "@/lib/timetable/types";
import { NextRequest, NextResponse } from "next/server";

/** 그리드 셀에 저장된 교사 실명 조회 — 이메일 로컬파트("tteacher") 노출 방지 (2026-08-04 파일럿) */
function resolveTeacherName(grids: ClassGrid[], normEmail: string): string {
  for (const grid of grids) {
    for (const cell of grid.cells || []) {
      for (const lesson of cell.lessons || []) {
        for (const t of lesson.teachers || []) {
          if ((t.email || "").trim().toLowerCase() === normEmail && t.name) return t.name;
        }
      }
    }
  }
  return normEmail.split("@")[0];
}

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

    // 3-b. 주간 합성 결정 (phase9b_spec §3-6):
    //      weekId 지정 시 그 주, 미지정 시 현재 주 폴백. 둘 다 없으면 기초시간표 그대로.
    let week = null;
    if (body.weekId) {
      week = await loadWeek(domain, body.weekId);
      if (!week || week.termId !== term.id) {
        return NextResponse.json(
          { error: `해당 학기에 등록되지 않은 주(${body.weekId})입니다.` },
          { status: 400 }
        );
      }
    } else {
      week = await findCurrentWeek(domain, term.id);
    }

    const isManagerish =
      auth.role === "super_admin" ||
      settings.managerEmails.some((m) => m.toLowerCase() === auth.email.toLowerCase());

    /** 기초 그리드를 로드하고, 주가 정해져 있으면 합성본으로 치환.
     *  기초는 개정판 주차별 해석 (spec §E) — 주 미지정 시 오늘 주 기준 판. */
    const loadGrids = async () => {
      const baseGrids = await loadBaseGridsForWeek(
        domain, term!.id, week ? week.startDate : currentMondayISO()
      );
      if (!week) return { grids: baseGrids, warnings: [] as string[] };
      const changes = await loadWeekChanges(domain, week.id);
      const { grids, integrityWarnings } = synthesizeWeeklyGrids(baseGrids, week, changes, settings);
      return { grids, warnings: integrityWarnings };
    };

    const weekMeta = week ? { id: week.id, startDate: week.startDate, days: week.days } : null;
    /** 응답에 주 메타 + (일과계·super_admin에게만) 무결성 경고 동봉 */
    const withWeek = (res: ViewTimetableResponse, warnings: string[]): ViewTimetableResponse => ({
      ...res,
      week: weekMeta,
      ...(isManagerish && warnings.length > 0 ? { integrityWarnings: warnings } : {}),
    });

    // 4. 액션별 데이터 처리
    switch (action) {
      case "my": {
        const { grids: allGrids, warnings } = await loadGrids();
        const cells = synthesizeTeacherTimetable(allGrids, auth.email);
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: {
            teacherEmail: auth.email,
            teacherName: resolveTeacherName(allGrids, auth.email.trim().toLowerCase()),
            cells,
          },
        };
        return NextResponse.json(withWeek(res, warnings));
      }

      case "teacher": {
        const targetTeacherEmail = (body.teacherEmail || auth.email).trim().toLowerCase();
        const { grids: allGrids, warnings } = await loadGrids();
        const cells = synthesizeTeacherTimetable(allGrids, targetTeacherEmail);
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: {
            teacherEmail: targetTeacherEmail,
            teacherName: resolveTeacherName(allGrids, targetTeacherEmail),
            cells,
          },
        };
        return NextResponse.json(withWeek(res, warnings));
      }

      case "class": {
        if (requestedGrade < 1 || requestedClassNum < 1) {
          return NextResponse.json(
            { error: "grade와 classNum 파라미터가 유효하지 않습니다." },
            { status: 400 }
          );
        }
        // 학생 응답에선 가상(블록) 교사 표기를 제거한다 — SLAT·창체 가상 계정은
        // 이메일이 없고 이름=과목명(실측: 동시 최대 30반)이라 "SLAT (SLAT)"처럼 보임.
        // 실교사는 반드시 이메일이 있으므로 이메일 유무가 안전한 판별 기준.
        const sanitizeForStudent = <G extends { cells: any[] }>(grid: G): G =>
          auth.role !== "student"
            ? grid
            : {
                ...grid,
                cells: grid.cells.map((c: any) => ({
                  ...c,
                  lessons: (c.lessons || []).map((l: any) => ({
                    ...l,
                    teachers: (l.teachers || []).filter(
                      (t: any) =>
                        !!t?.email?.trim() &&
                        t.name !== l.subjectName &&
                        t.name !== l.subjectShort
                    ),
                  })),
                })),
              };
        // 주간 합성이 필요하면 전 학급 로드 후 대상 학급만 추출 (합성은 학급 단위로 쪼갤 수 없음)
        if (week) {
          const { grids, warnings } = await loadGrids();
          const classGrid = grids.find(
            (g) => g.grade === requestedGrade && g.classNum === requestedClassNum
          );
          const res: ViewTimetableResponse = {
            term: termMeta,
            action,
            data: sanitizeForStudent(
              classGrid || { grade: requestedGrade, classNum: requestedClassNum, cells: [] }
            ),
          };
          return NextResponse.json(withWeek(res, warnings));
        }
        // 주 미지정 기초 열람도 개정판 인지 경로로 (spec §E — 오늘 주 기준 판)
        const { grids: baseGrids } = await loadGrids();
        const classGrid = baseGrids.find(
          (g) => g.grade === requestedGrade && g.classNum === requestedClassNum
        );
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: sanitizeForStudent(
            classGrid || { grade: requestedGrade, classNum: requestedClassNum, cells: [] }
          ),
        };
        return NextResponse.json(res);
      }

      case "school": {
        const { grids: allGrids, warnings } = await loadGrids();
        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: allGrids,
        };
        return NextResponse.json(withWeek(res, warnings));
      }

      case "free": {
        const day = Number(body.day) || 1;
        const period = Number(body.period) || 1;
        const { grids: allGrids, warnings } = await loadGrids();

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

        // 가상·블록 교사는 공강 목록에서도 제외 — 보강 후보 엔진(findSubstituteCandidates)과
        // 동일 기준. 수업 없는 교시의 창체·SLAT이 공강 교사로 잡히는 것을 막는다.
        const blockIdx = buildSlotIndex(allGrids);
        const allTeachers = Array.from(teacherMap.values()).filter(
          (t) => !isBlockTeacher(blockIdx, t.email)
        );
        const freeTeachers = synthesizeFreeTeachers(allGrids, allTeachers, day, period);

        const res: ViewTimetableResponse = {
          term: termMeta,
          action,
          data: freeTeachers,
        };
        return NextResponse.json(withWeek(res, warnings));
      }

      case "teachers": {
        // 전체 교사 목록 (가나다순) — 교사 선택 드롭다운용 (2026-08-04, 검색 입력 대체)
        // 기초 그리드만 필요하므로 주간 합성 생략 (이름·이메일만 수집)
        const baseGrids = await loadAllClassGrids(domain, term.id);
        const teacherMap = new Map<string, TimetableTeacher>();
        for (const subj of term.subjects || []) {
          for (const email of subj.teacherEmails || []) {
            const normEmail = email.trim().toLowerCase();
            if (normEmail && !teacherMap.has(normEmail)) {
              teacherMap.set(normEmail, { email: normEmail, name: normEmail.split("@")[0] });
            }
          }
        }
        for (const grid of baseGrids) {
          for (const cell of grid.cells || []) {
            for (const lesson of cell.lessons || []) {
              for (const teacher of lesson.teachers || []) {
                const normEmail = (teacher.email || "").trim().toLowerCase();
                if (normEmail) {
                  teacherMap.set(normEmail, {
                    email: normEmail,
                    name: teacher.name || normEmail.split("@")[0],
                  });
                }
              }
            }
          }
        }
        // 가상 교사(창체·SLAT 등)가 실이메일로 매핑된 학기 데이터에서 드롭다운이 오염됨
        // (60시간·다학급 셀). 한 교시에 2개 학급 이상 동시 수업이면 실교사 시간표가 아니므로
        // 블록 판정(isBlockTeacher)으로 제외 — 실교사의 그런 중복은 임포트 검증이 이미 차단한다.
        const blockIdx = buildSlotIndex(baseGrids);
        const sorted = Array.from(teacherMap.values())
          .filter((t) => !isBlockTeacher(blockIdx, t.email))
          .sort((a, b) => a.name.localeCompare(b.name, "ko"));
        return NextResponse.json({ term: termMeta, action, data: sorted });
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
