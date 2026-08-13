import { verifyAuthAccess } from "@/lib/firebase/admin";
import { canViewTimetable } from "@/lib/timetable/authz";
import { getTimetableCacheVersion } from "@/lib/timetable/cacheVersion";
import {
  computeCommonActivitySlots,
  currentMondayISO,
  pickCurrentWeek,
  resolveStudentClass,
  synthesizeFreeTeachers,
  synthesizeTeacherTimetable,
} from "@/lib/timetable/server";
import { buildSlotIndex, isBlockTeacher } from "@/lib/timetable/swap";
import {
  getBaseGridsCached,
  getCacheStats,
  getViewContextCached,
  getWeekGridsCached,
  takeRequestOutcome,
} from "@/lib/timetable/viewCache";
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

/**
 * 계측 래퍼 (docs/transition_day_rehearsal_spec.md §2-1)
 *
 * 이 라우트의 인메모리 캐시는 서버리스 인스턴스마다 따로 존재한다. 실제로 캐시가
 * 도는지는 인스턴스 재사용률에 달려 있는데 그 값이 프로덕션에서 측정된 적이 없다.
 * 응답 헤더로 인스턴스 신원과 적중 판정을 내보내 밖에서 **냉시작 비율 R**을 잰다.
 * 개인정보·비밀값이 없고 인증된 요청에만 나간다.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const res = await handleView(req);
  const s = getCacheStats();
  res.headers.set("x-tt-instance", s.instanceId);
  res.headers.set("x-tt-cache", takeRequestOutcome());
  res.headers.set("x-tt-hits", String(s.hits));
  res.headers.set("x-tt-misses", String(s.misses));
  return res;
}

async function handleView(req: NextRequest): Promise<NextResponse> {
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

    // 캐시 버전 1읽기 — 이후 재료(설정·학기·주·그리드)는 버전 키 인메모리 캐시 사용
    // (weekly_synthesis_cache_spec). 쓰기마다 버전이 올라 낡은 항목은 자연 격리된다.
    const cacheVersion = await getTimetableCacheVersion(domain);
    const ctx = await getViewContextCached(domain, cacheVersion, body.termId);
    const settings = ctx.settings;

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
    //    (ctx가 동일 규칙으로 이미 결정 — termId 미존재 시 active 폴백 포함)
    const term = ctx.term;

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
    //      ctx.weeks는 이 학기의 주 전체이므로 목록 미포함 = 미등록 또는 타 학기.
    let week = null;
    if (body.weekId) {
      week = ctx.weeks.find((w) => w.id === body.weekId) || null;
      if (!week) {
        return NextResponse.json(
          { error: `해당 학기에 등록되지 않은 주(${body.weekId})입니다.` },
          { status: 400 }
        );
      }
    } else {
      week = pickCurrentWeek(ctx.weeks);
    }

    const isManagerish =
      auth.role === "super_admin" ||
      settings.managerEmails.some((m) => m.toLowerCase() === auth.email.toLowerCase());

    /** 기초 그리드를 로드하고, 주가 정해져 있으면 합성본으로 치환.
     *  기초는 개정판 주차별 해석 (spec §E) — 주 미지정 시 오늘 주 기준 판.
     *  버전 키 캐시 적중 시 Firestore 읽기 0. 반환 그리드는 요청 간 공유되므로
     *  변형 금지 — 역할별 가공은 반드시 새 객체로 (cache spec §3-3). */
    const loadGrids = () =>
      getWeekGridsCached(domain, cacheVersion, term!.id, week, currentMondayISO(), settings);

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
          // §3-2d S1: 이 주의 전교 공통 활동 교시 목록 — UI는 "내 공강" 렌더에서 제외 (U4)
          commonActivitySlots: computeCommonActivitySlots(allGrids),
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

        // 전교 공통 활동 교시 판정 (consent_swap_opening_spec §4-1b) — SLAT·창체처럼 수업이
        // 가상(이메일 없음)·블록 교사 명의인 학급이 과반이면, 그리드상 비어 보이는 실교사들도
        // 실제로는 담임·부담임·교과·동아리로 투입되므로 공강 개념이 성립하지 않는다.
        // (§3-2d S1에서 주 단위 판정으로 일반화 — 단일 교시 판정도 같은 헬퍼를 쓴다)
        const commonSlots = computeCommonActivitySlots(allGrids);
        if (commonSlots.some((s) => s.day === day && s.period === period)) {
          const res: ViewTimetableResponse = {
            term: termMeta,
            action,
            data: [],
            commonActivitySlot: true,
          };
          return NextResponse.json(withWeek(res, warnings));
        }

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
        const baseGrids = await getBaseGridsCached(domain, cacheVersion, term.id);
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
