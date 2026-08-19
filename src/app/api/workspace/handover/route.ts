// 기간제 교사 담당 일괄 이관 마법사 — 서버 액션 (docs/substitute_handover_spec.md §3~§5)
//
// preview: 바뀔 것 전부를 계산해 보여준다(실행 없음). commit: 미리보기와 같은 계산을
// 서버가 다시 수행해 실행한다(클라이언트 계산을 믿지 않는다).
// 산출물은 전부 기존 모델(직권 substitute 변경·기초 개정판·프로필·클래스룸 명단)이라
// 되돌리기도 기존 경로 그대로다 — 마법사 전용 롤백 개념 없음 (§5).
// 권한 = 수퍼어드민 단독 (§5 — 계정·담임·클래스룸이 얽힌 저빈도 행정 행위).
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import {
  addCourseCoTeacher,
  listClassroomCourses,
  removeCourseCoTeacher,
} from "@/lib/google/workspace";
import {
  buildHandoverRevisionOps,
  computeHandoverWeekIntents,
  planHandoverDates,
} from "@/lib/timetable/handover";
import {
  applyRevisionDraft,
  currentMondayISO,
  directCommit,
  loadActiveTerm,
  loadBaseGridsForWeek,
  loadBaseRevisions,
  loadWeek,
  saveRevisionDraft,
  synthesizeWeek,
} from "@/lib/timetable/server";
import { NextRequest, NextResponse } from "next/server";
import { buildRosterIndex } from "@/lib/org/roster_index";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const profileRef = (email: string) => adminDb.collection("teacher_profiles").doc(email);

async function loadProfile(email: string) {
  const snap = await profileRef(email).get();
  return snap.exists ? (snap.data() as any) : null;
}

/** 마법사 공통 계산 — preview·commit이 같은 코드를 탄다 (§3) */
async function computePlan(domain: string, fromEmail: string, toEmail: string, date: string) {
  // 운영 학기의 단일 원본은 timetable_settings (일반 settings 문서가 아님 — 8/18 실기기에서 발견한 오독)
  const activeTerm = await loadActiveTerm(domain);
  if (!activeTerm?.id) throw new Error("운영 중인 학기가 없습니다. 학기를 먼저 활성화해 주세요.");
  const termId = activeTerm.id;

  const plan = planHandoverDates(date, currentMondayISO());

  // 걸치는 주 의도 — 그 주의 실제 합성본 기준 (개정판·기존 변경 반영)
  let weekIntents: ReturnType<typeof computeHandoverWeekIntents> = [];
  if (plan.weekIntentsNeeded) {
    const week = await loadWeek(domain, plan.weekId);
    if (!week) {
      throw new Error(
        `인수일이 속한 주(${plan.weekId})가 아직 등록되지 않았습니다. 주간 운영 화면을 한 번 열어 주를 파생시킨 뒤 다시 시도해 주세요.`
      );
    }
    if (week.termId !== termId) {
      throw new Error("인수일이 운영 학기 밖입니다. 날짜를 확인해 주세요.");
    }
    const { grids } = await synthesizeWeek(domain, week);
    weekIntents = computeHandoverWeekIntents(grids, fromEmail, plan.fromDay);
  }

  // 치환 개정판 ops — 최신 적용 기초(모든 applied 개정 반영) 기준
  const latestBase = await loadBaseGridsForWeek(domain, termId, "9999-12-31");
  const fromProfile = await loadProfile(fromEmail);
  const toProfile = await loadProfile(toEmail);
  const fromName = fromProfile?.name || fromEmail.split("@")[0];
  const toName = toProfile?.name || toEmail.split("@")[0];
  const revisionOps = buildHandoverRevisionOps(
    latestBase,
    { email: fromEmail, name: fromName },
    { email: toEmail, name: toName }
  );

  // 학기당 draft 1개 제약 — 남의 작업 중 초안을 마법사가 덮어쓰지 않는다 (§5)
  const existingDraft = (await loadBaseRevisions(domain, termId)).find(
    (r) => r.status === "draft"
  );

  return {
    termId,
    plan,
    weekIntents,
    revisionOps,
    fromProfile,
    toProfile,
    fromName,
    toName,
    existingDraftId: existingDraft?.id || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth || auth.role !== "super_admin") {
      return NextResponse.json({ error: "수퍼어드민만 사용할 수 있습니다." }, { status: 403 });
    }
    const managerEmail = auth.email.trim().toLowerCase();
    const domain = managerEmail.split("@")[1] || "hmh.or.kr";

    const body = await req.json().catch(() => ({} as any));
    const action = body.action as "preview" | "commit";
    const fromEmail = typeof body.fromEmail === "string" ? body.fromEmail.trim().toLowerCase() : "";
    const toEmail = typeof body.toEmail === "string" ? body.toEmail.trim().toLowerCase() : "";
    const date = typeof body.date === "string" ? body.date.trim() : "";

    if (!["preview", "commit"].includes(action)) {
      return NextResponse.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
    }
    if (!EMAIL_RE.test(fromEmail) || !EMAIL_RE.test(toEmail) || fromEmail === toEmail) {
      return NextResponse.json({ error: "이관 전·후 교사 이메일을 확인해 주세요." }, { status: 400 });
    }
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "인수일은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    }

    const computed = await computePlan(domain, fromEmail, toEmail, date);

    // 인수 교사 자격 — 조직도 부서 배치까지가 선행 (§3 선행 검증)
    const toDepartments: string[] = Array.isArray(computed.toProfile?.departments)
      ? computed.toProfile.departments
      : [];

    // 클래스룸 — 원 교사의 활성 코스 (조회 실패는 기능 저하로 수용, 마법사는 진행 가능)
    let courses: { id: string; name: string; section?: string }[] = [];
    let coursesError: string | null = null;
    try {
      const raw = await listClassroomCourses(fromEmail, ["ACTIVE"]);
      courses = raw.map((c: any) => ({ id: c.id, name: c.name, section: c.section || undefined }));
    } catch (e: any) {
      coursesError = "클래스룸 목록을 불러오지 못했습니다. 클래스룸 단계는 건너뛰고 나중에 다시 할 수 있습니다.";
      console.error("[handover] 클래스룸 목록 조회 실패:", e?.message || e);
    }

    const homeroom =
      computed.fromProfile?.isHomeroom && computed.fromProfile?.homeroom
        ? computed.fromProfile.homeroom
        : null;

    if (action === "preview") {
      return NextResponse.json({
        success: true,
        preview: {
          termId: computed.termId,
          fromName: computed.fromName,
          toName: computed.toName,
          takeoverDate: date,
          weekId: computed.plan.weekId,
          effectiveFrom: computed.plan.effectiveFrom,
          weekIntents: computed.weekIntents,
          revisionCellCount: computed.revisionOps.length,
          homeroom, // {grade, class} | null
          toProfileExists: !!computed.toProfile,
          toDepartments,
          fromDepartments: Array.isArray(computed.fromProfile?.departments)
            ? computed.fromProfile.departments
            : [],
          courses,
          coursesError,
          existingDraftId: computed.existingDraftId,
        },
      });
    }

    // ── commit ──
    if (!computed.toProfile) {
      return NextResponse.json(
        { error: "인수 교사의 승인 프로필이 없습니다. 계정 발급·프로필 승인 후 다시 시도해 주세요." },
        { status: 400 }
      );
    }
    if (computed.existingDraftId && computed.revisionOps.length > 0) {
      return NextResponse.json(
        {
          error:
            "기초시간표 개정 초안이 이미 있습니다. 작업 중인 초안을 적용하거나 삭제한 뒤 다시 실행해 주세요 (마법사가 남의 초안을 덮어쓰지 않습니다).",
        },
        { status: 409 }
      );
    }

    const homeroomSuccessor =
      typeof body.homeroomSuccessorEmail === "string" && body.homeroomSuccessorEmail.trim()
        ? body.homeroomSuccessorEmail.trim().toLowerCase()
        : null; // null = 담임 변경 안 함 (담임 아님·복직 시 현 담임 유지 등)
    const assignDepartments = body.assignDepartments === true;
    const courseAction = body.courseAction === "remove" ? "remove" : "invite";
    const courseIds: string[] = Array.isArray(body.courseIds)
      ? body.courseIds.filter((v: unknown) => typeof v === "string" && v)
      : [];

    const batchId = `handover-${Date.now()}`;
    const summary = {
      batchId,
      weekChanges: { done: 0, failed: [] as string[] },
      revisionId: null as string | null,
      effectiveFrom: computed.plan.effectiveFrom,
      homeroomMoved: false,
      departmentsAssigned: false,
      courses: { done: 0, failed: [] as string[] },
    };

    // 1) 걸치는 주 — 기존 직권 경로 그대로 (실패 건은 모아서 보고, 나머지는 진행)
    for (const intent of computed.weekIntents) {
      try {
        await directCommit(domain, managerEmail, {
          weekId: computed.plan.weekId,
          type: "substitute",
          source: {
            grade: intent.grade,
            classNum: intent.classNum,
            day: intent.day,
            period: intent.period,
            subjectName: intent.subjectName,
          },
          candidate: {
            counterpartEmail: toEmail,
            counterpartName: computed.toName,
            score: 0,
            penalties: [],
          },
          reason: { type: "기타", note: "기간제 인수인계" },
          batchId,
        });
        summary.weekChanges.done++;
      } catch (e: any) {
        summary.weekChanges.failed.push(
          `${intent.grade}-${intent.classNum} ${intent.day}요일 ${intent.period}교시: ${e?.message || e}`
        );
      }
    }

    // 2) 개정판 — 치환 ops 저장 후 즉시 적용
    if (computed.revisionOps.length > 0) {
      const { revision } = await saveRevisionDraft(
        domain,
        computed.termId,
        managerEmail,
        computed.revisionOps,
        `기간제 인수인계: ${computed.fromName} → ${computed.toName} (${date}부터)`
      );
      const applied = await applyRevisionDraft(
        domain,
        managerEmail,
        revision.id!,
        computed.plan.effectiveFrom
      );
      summary.revisionId = applied.id || revision.id || null;
    }

    // 3) 담임 승계 (선택 — §3-3)
    if (homeroomSuccessor && homeroom) {
      const successorProfile = await loadProfile(homeroomSuccessor);
      if (!successorProfile) {
        return NextResponse.json(
          { error: "담임 승계자의 승인 프로필이 없습니다.", summary },
          { status: 400 }
        );
      }
      await profileRef(homeroomSuccessor).set(
        { isHomeroom: true, homeroom },
        { merge: true }
      );
      await profileRef(fromEmail).set({ isHomeroom: false, homeroom: null }, { merge: true });
      summary.homeroomMoved = true;
    }

    // 4) 조직도 배치 (선택 — 인수 교사에 부서가 없을 때만, 원 교사 부서로)
    if (assignDepartments && toDepartments.length === 0) {
      const fromDepts: string[] = Array.isArray(computed.fromProfile?.departments)
        ? computed.fromProfile.departments
        : [];
      if (fromDepts.length > 0) {
        await profileRef(toEmail).set({ departments: fromDepts }, { merge: true });
        summary.departmentsAssigned = true;
      }
    }

    // 4-1) 명단 색인 재조립 — 담임 승계(3)와 조직도 배치(4)가 **둘 다 끝난 뒤 한 번만**
    // (docs/roster_index_spec.md §2-1 갈래 ②). 담임 승계는 두 문서를 비원자로 고치므로
    // 중간에 부르면 "담임이 둘"인 반쪽 상태가 색인에 박힌다.
    if (summary.homeroomMoved || summary.departmentsAssigned) {
      try {
        const domain = fromEmail.split("@")[1]?.toLowerCase();
        if (domain) await buildRosterIndex(domain, { builtBy: "handover", force: true });
      } catch (err: any) {
        console.warn("[roster_index] 이관 후 재조립 실패(계속 진행):", err?.message);
      }
    }

    // 5) 클래스룸 공동교사 (invite = 인수 / remove = 복직 §4)
    // 방향 주의(검수 지적): 복직(remove)에서 코스 목록은 기간제(fromEmail) 기준으로 뽑히고,
    // 내보낼 사람도 떠나는 기간제(fromEmail)다 — toEmail(복직 교사)은 자기 코스의 원 교사라 건드리지 않는다.
    for (const courseId of courseIds) {
      try {
        if (courseAction === "invite") await addCourseCoTeacher(courseId, toEmail);
        else await removeCourseCoTeacher(courseId, fromEmail);
        summary.courses.done++;
      } catch (e: any) {
        summary.courses.failed.push(`${courseId}: ${e?.message || e}`);
      }
    }

    await writeAuditLog({
      operatorEmail: managerEmail,
      operatorName: auth.email,
      action: "기간제 담당 일괄 이관",
      targetEmail: fromEmail,
      details: `${computed.fromName} → ${computed.toName}, 인수일 ${date}. 걸치는 주 변경 ${summary.weekChanges.done}건(실패 ${summary.weekChanges.failed.length}), 개정판 ${summary.revisionId || "생성 없음"}(${summary.effectiveFrom}부터), 담임 ${summary.homeroomMoved ? "승계" : "변경 없음"}, 부서 ${summary.departmentsAssigned ? "배치" : "변경 없음"}, 클래스룸 ${courseAction} ${summary.courses.done}건(실패 ${summary.courses.failed.length}). batch=${batchId}`,
      // 부분 실패도 failure로 남긴다 (AuditLog status는 이분법) — 상세는 details에
      status:
        summary.weekChanges.failed.length || summary.courses.failed.length ? "failure" : "success",
    });

    return NextResponse.json({ success: true, summary });
  } catch (e: any) {
    console.error("[api/workspace/handover] 실패:", e?.message || e);
    return NextResponse.json({ error: e?.message || "이관 처리에 실패했습니다." }, { status: 500 });
  }
}
