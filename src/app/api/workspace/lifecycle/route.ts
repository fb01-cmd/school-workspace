import { NextRequest, NextResponse } from "next/server";
import {
  createOrgunit,
  updateOrgunit,
  listOrgunits,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  listUsersInOUs,
  deleteAllClassGroups,
  createAllClassGroups,
  addGroupMember,
  removeGroupMember,
  listGroupsForUser,
  invalidateUserCache,
  sendGmail,
  sendGoogleChat,
  isMock,
  checkIsSecurityGroup,
} from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { deleteAuthUserByEmail, verifyAuthAccess, adminDb } from "@/lib/firebase/admin";
import { isProtectedAccountEmail } from "@/lib/auth/blockedOu";
import { FieldValue } from "firebase-admin/firestore";
import { mapConcurrent, mapConcurrentSettled } from "@/lib/concurrency";
import { DEFAULT_TEACHER_GROUPS } from "@/lib/org/teacherGroups";
import { buildRosterIndex } from "@/lib/org/roster_index";

/**
 * 명단 색인 재조립 — 교직원 프로필을 서버에서 지우거나 되살린 뒤 반드시 부른다.
 * (docs/roster_index_spec.md §2-1 갈래 ②)
 *
 * ⚠️ 프로필 쓰기가 **전부 끝난 뒤 한 번만** 부른다. 비원자 다중 문서 쓰기 중간에 부르면
 *    반쪽 상태가 색인에 박힌다.
 * 재조립 실패가 생애주기 작업 자체를 되돌리게 하지는 않는다 — 하루 1회 보정이 흡수한다.
 */
async function rebuildRosterIndexSafely(teacherEmail: string, builtBy: string): Promise<void> {
  try {
    const domain = teacherEmail.split("@")[1]?.toLowerCase();
    if (!domain) return;
    await buildRosterIndex(domain, { builtBy, force: true });
  } catch (err: any) {
    console.warn(`[roster_index] 재조립 실패(계속 진행) — ${builtBy}:`, err?.message);
  }
}

// Vercel 함수 실행 시간 한도 명시 — 신입생 일괄 생성·졸업생 일괄 정지/삭제 등
// 수백 명 단위 작업이 플랜 기본값(10초대)에 잘리지 않도록.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, operatorEmail, operatorName, domain } = body;

    // ─────────────────────────────────────────
    // 🔐 서버 사이드 인증 가드
    // 교사/학생 셀프 기한 제출 및 상태 조회 액션은 일반 사용자 계정도 허용, 나머지는 수퍼어드민 전용
    // ─────────────────────────────────────────
    const TEACHER_ALLOWED_ACTIONS = ["submit_teacher_deadline", "get_teacher_transfer_status", "join_security_group"];
    const STUDENT_ALLOWED_ACTIONS = ["submit_student_transfer_deadline", "get_student_transfer_status"];
    const authUser = await verifyAuthAccess(req);
    if (!authUser) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    if (
      authUser.role !== "super_admin" &&
      !TEACHER_ALLOWED_ACTIONS.includes(action) &&
      !STUDENT_ALLOWED_ACTIONS.includes(action)
    ) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }
    // join_security_group: 로그인한 교사 본인의 셀프 가입 전용.
    if (action === "join_security_group" && authUser.role !== "super_admin") {
      if (authUser.role !== "teacher") {
        return NextResponse.json({ error: "교사 계정만 사용할 수 있는 기능입니다." }, { status: 403 });
      }
      body.teacherEmail = authUser.email;
    }
    // submit_teacher_deadline / get_teacher_transfer_status: 교사 본인 레코드 전용.
    if (
      (action === "submit_teacher_deadline" || action === "get_teacher_transfer_status") &&
      authUser.role !== "super_admin"
    ) {
      body.teacherEmail = authUser.email;
    }
    // submit_student_transfer_deadline / get_student_transfer_status: 학생 본인 레코드 전용.
    // 대상 이메일을 토큰의 본인 이메일로 강제 — 타 학생 기한을 악의적으로 변경하는 권한 상승 구멍 차단.
    if (
      (action === "submit_student_transfer_deadline" || action === "get_student_transfer_status") &&
      authUser.role !== "super_admin"
    ) {
      body.email = authUser.email;
    }

    const adminEmail = operatorEmail || authUser.email || "unknown@domain.com";
    const adminName = operatorName || "관리자";

    // ─────────────────────────────────────────
    // ACTION: year_end_ou_transition
    // ─────────────────────────────────────────
    if (action === "year_end_ou_transition") {
      const { grade1, grade2, grade3, parentPath, gradName, graduatesOUPath } = body;
      const targetGradName = gradName || "졸업생";
      const steps: any[] = [];

      try {
        // Step 0: Archive existing graduates OU if it exists (prevents name collision)
        if (graduatesOUPath) {
          try {
            const allOUs = await listOrgunits();
            const existingGradOU = allOUs.find((o: any) => o.orgUnitPath === graduatesOUPath);
            if (existingGradOU) {
              const archiveName = `이전 학년도 ${targetGradName}`;
              await updateOrgunit(graduatesOUPath, archiveName);
              steps.push({ step: 0, action: `기존 ${targetGradName} → ${archiveName} (아카이브)`, status: "success" });
            } else {
              steps.push({ step: 0, action: `기존 ${targetGradName} OU 없음 (건너뜀)`, status: "success" });
            }
          } catch (archiveErr: any) {
            steps.push({ step: 0, action: `기존 ${targetGradName} 아카이브 실패: ${archiveErr.message}`, status: "error" });
            throw new Error(`기존 ${targetGradName} OU 아카이브 실패: ${archiveErr.message}`);
          }
        } else {
          steps.push({ step: 0, action: `졸업생 OU 미설정 (건너뜀)`, status: "success" });
        }

        await updateOrgunit(grade3, targetGradName);
        steps.push({ step: 1, action: `${grade3} → ${targetGradName}`, status: "success" });

        await updateOrgunit(grade2, "3학년");
        steps.push({ step: 2, action: `${grade2} → 3학년`, status: "success" });

        await updateOrgunit(grade1, "2학년");
        steps.push({ step: 3, action: `${grade1} → 2학년`, status: "success" });

        await createOrgunit("1학년", parentPath);
        steps.push({ step: 4, action: `새 1학년 OU 생성`, status: "success" });

        await writeAuditLog({
          operatorEmail: adminEmail, operatorName: adminName,
          action: "연도말 OU 전환", targetEmail: "-",
          details: "OU 이름 변경 5단계 완료 (아카이브 포함)", status: "success",
        });

        return NextResponse.json({ success: true, steps, isMock });
      } catch (err: any) {
        await writeAuditLog({
          operatorEmail: adminEmail, operatorName: adminName,
          action: "연도말 OU 전환", targetEmail: "-",
          details: `OU 전환 중 오류: ${err.message}`, status: "failure", error: err.message,
        });
        return NextResponse.json({ success: false, steps, error: err.message }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: delete_class_groups
    // ─────────────────────────────────────────
    if (action === "delete_class_groups") {
      const { testPrefix } = body;
      const result = await deleteAllClassGroups(domain, testPrefix);
      await writeAuditLog({
        operatorEmail: adminEmail, operatorName: adminName,
        action: "반별 그룹 전체 삭제", targetEmail: "-",
        details: `삭제: ${result.deleted}개, 실패: ${result.failed}개${testPrefix ? ` (테스트 접두사: ${testPrefix})` : ""}`,
        status: result.failed === 0 ? "success" : "failure",
      });
      return NextResponse.json({ ...result, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: create_class_groups
    // ─────────────────────────────────────────
    if (action === "create_class_groups") {
      const { studentOUPaths, testPrefix } = body;
      const allStudentOUs: string[] = Object.values(studentOUPaths || {});
      if (allStudentOUs.length === 0) {
        return NextResponse.json({ error: "학생 OU 경로가 설정되지 않았습니다." }, { status: 400 });
      }

      const students = await listUsersInOUs(allStudentOUs);
      const studentData = students.map((s: any) => ({
        primaryEmail: s.primaryEmail,
        familyName: s.name?.familyName || "",
      }));

      const result = await createAllClassGroups(domain, studentData, testPrefix);

      await writeAuditLog({
        operatorEmail: adminEmail, operatorName: adminName,
        action: "반별 그룹 일괄 생성", targetEmail: "-",
        details: `생성: ${result.created}개 그룹, 멤버: ${result.membersAdded}명, 실패: ${result.failed}개${testPrefix ? ` (테스트 접두사: ${testPrefix})` : ""}`,
        status: result.failed === 0 ? "success" : "failure",
      });

      return NextResponse.json({ ...result, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: enroll_students (신입생 일괄 생성)
    // ─────────────────────────────────────────
    if (action === "enroll_students") {
      const { students, admissionYear, grade1OUPath } = body;

      if (!Array.isArray(students) || students.length === 0) {
        return NextResponse.json({ error: "학생 데이터가 없습니다." }, { status: 400 });
      }

      // 동시성 5 제한 — 무제한 동시 생성은 Directory API 429로 부분 실패 발생
      const results = await mapConcurrentSettled(
        students, 5, async (s: any) => {
          const serialStr = String(s.serialNum).padStart(3, "0");
          const email = `${admissionYear}${serialStr}@${domain}`;
          const classStr = String(s.classNum).padStart(2, "0");
          const numStr = String(s.studentNum).padStart(2, "0");
          // grade1OUPath로 학년 추출: 맨 앞 숫자 또는 기본값 1
          // enroll_students는 항상 1학년 신입생이지만, 전입(transfer)은 학년이 다를 수 있음
          // s.grade가 있으면 그걸 사용, 없으면 1학년
          const grade = s.grade ? String(s.grade) : "1";
          const studentId = `${grade}${classStr}${numStr}`;

          // 1. 계정 생성
          await createUser(email, s.givenName || s.name || "학생", studentId, grade1OUPath, "1234abcd!!!!", true);

          // 2. 반별 그룹에 추가: {testPrefix}{학년}{반(2자리)}@{domain} 예) test-101@hmh.or.kr
          //    그룹이 없을 경우 에러가 나도 계정 생성은 성공으로 처리
          const isTestMode = grade1OUPath.includes("테스트") || grade1OUPath.toLowerCase().includes("test");
          const testPrefix = isTestMode ? "test-" : "";
          const groupEmail = `${testPrefix}${grade}${classStr}@${domain}`;
          let groupAdded = false;
          try {
            await addGroupMember(groupEmail, email);
            groupAdded = true;
          } catch (groupErr) {
            console.warn(`그룹 추가 실패 (${groupEmail}):`, groupErr);
          }

          return {
            email,
            studentId,
            groupEmail,
            groupAdded,
            name: `${s.familyName || ""}${s.givenName || s.name || ""}`,
            givenName: s.givenName || s.name || "",
            grade: Number(grade),
            classNum: Number(s.classNum),
            studentNum: Number(s.studentNum),
          };
        }
      );

      const succeeded = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value);
      const failed = results
        .map((r, i) => {
          if (r.status === "rejected") {
            const s = students[i];
            const serialStr = String(s.serialNum).padStart(3, "0");
            const email = `${admissionYear}${serialStr}@${domain}`;
            const grade = s.grade ? String(s.grade) : "1";
            const classStr = String(s.classNum).padStart(2, "0");
            const numStr = String(s.studentNum).padStart(2, "0");
            return {
              name: `${s.familyName || ""}${s.givenName || s.name || ""}`,
              email,
              studentId: `${grade}${classStr}${numStr}`,
              reason: (r as PromiseRejectedResult).reason?.message || "알 수 없는 오류",
            };
          }
          return null;
        })
        .filter(Boolean);

      invalidateUserCache();

      await writeAuditLog({
        operatorEmail: adminEmail, operatorName: adminName,
        action: "신입생 일괄 생성", targetEmail: "복수 계정",
        details: `${admissionYear}년도 신입생 ${succeeded.length}명 생성, 실패: ${failed.length}명`,
        status: failed.length === 0 ? "success" : "failure",
      });

      return NextResponse.json({ succeeded, failed, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: promote_students (진급 처리)
    // ─────────────────────────────────────────
    if (action === "promote_students") {
      const { promotions } = body;

      if (!Array.isArray(promotions) || promotions.length === 0) {
        return NextResponse.json({ error: "진급 데이터가 없습니다." }, { status: 400 });
      }

      const results = await mapConcurrentSettled(promotions, 8, async (p: any) => {
        await updateUser(p.email, { lastName: p.newStudentId });
        return { email: p.email, newStudentId: p.newStudentId };
      });

      const succeeded = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value);
      const failed = results
        .map((r, i) => {
          if (r.status === "rejected") {
            const p = promotions[i];
            return {
              email: p?.email,
              name: p?.name || "학생",
              studentId: p?.newStudentId,
              reason: (r as PromiseRejectedResult).reason?.message || "업데이트 실패",
            };
          }
          return null;
        })
        .filter(Boolean);

      invalidateUserCache();

      // Firestore 진급 로그 저장
      if (domain && promotions.length > 0) {
        try {
          await adminDb.collection("promotion_logs").doc(domain).collection("batches").add({
            createdAt: FieldValue.serverTimestamp(),
            appliedBy: adminEmail,
            totalCount: promotions.length,
            succeededCount: succeeded.length,
            failedCount: failed.length,
            records: promotions.map((p: any, i: number) => ({
              email: p.email,
              prevStudentId: p.prevStudentId,
              newStudentId: p.newStudentId,
              status: results[i].status === "fulfilled" ? "success" : "failed",
            })),
          });
        } catch (logErr) {
          console.error("Failed to save promotion log", logErr);
        }
      }

      await writeAuditLog({
        operatorEmail: adminEmail, operatorName: adminName,
        action: "진급 처리", targetEmail: "복수 계정",
        details: `진급 완료: ${succeeded.length}명, 실패: ${failed.length}명`,
        status: failed.length === 0 ? "success" : "failure",
      });

      return NextResponse.json({ succeeded, failed, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: graduation_warn (졸업생 이름 변경 경고)
    // ─────────────────────────────────────────
    if (action === "graduation_warn") {
      const { graduateEmails, warnFamilyName = "6월30일", warnGivenName = "삭제예정" } = body;

      const results = await mapConcurrentSettled(graduateEmails, 8, (email: string) =>
        updateUser(email, { lastName: warnFamilyName, firstName: warnGivenName })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      invalidateUserCache();

      await writeAuditLog({
        operatorEmail: adminEmail, operatorName: adminName,
        action: "졸업생 삭제 경고 (이름 변경)", targetEmail: "복수 계정",
        details: `"${warnFamilyName} ${warnGivenName}"으로 변경: ${succeeded}명, 실패: ${failed}명`,
        status: failed === 0 ? "success" : "failure",
      });

      return NextResponse.json({ succeeded, failed, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: graduation_delete (졸업생 일괄 삭제)
    // ─────────────────────────────────────────
    if (action === "graduation_delete") {
      const { graduateEmails } = body;

      const results = await mapConcurrentSettled(graduateEmails, 8, (email: string) => deleteUser(email));

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      invalidateUserCache();

      await writeAuditLog({
        operatorEmail: adminEmail, operatorName: adminName,
        action: "졸업생 일괄 삭제", targetEmail: "복수 계정",
        details: `삭제 완료: ${succeeded}명, 실패: ${failed}명`,
        status: failed === 0 ? "success" : "failure",
      });

      return NextResponse.json({ succeeded, failed, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: register_transfer_out (전출/자퇴 등록)
    // ─────────────────────────────────────────
    if (action === "register_transfer_out") {
      const { email, studentName, studentId, originalOU } = body;
      if (!email) {
        return NextResponse.json({ error: "이메일이 누락되었습니다." }, { status: 400 });
      }
      // 유령 레코드 방어선: UI는 선택 객체를 보내지만, 원시 문자열 유입 시 문서 ID 오염 차단
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: "올바른 이메일 형식이 아닙니다. 전체 주소(아이디@도메인)로 입력해 주세요." },
          { status: 400 }
        );
      }

      // 1. 설정에서 전출/자퇴자용 OU 경로 조회 (기본값: 마지노선 30일, 정지 후 삭제 7일)
      let transferOutOU = "/학생/전출및자퇴";
      let suspendGraceDays = 30;
      let deleteGraceDays = 7;

      if (domain) {
        const settingsSnap = await adminDb.collection("settings").doc(domain).get();
        if (settingsSnap.exists) {
          const sData = settingsSnap.data() || {};
          if (sData.ouMapping?.transferOut) {
            transferOutOU = sData.ouMapping.transferOut;
          }
          if (sData.transferOutSettings) {
            suspendGraceDays = Number(sData.transferOutSettings.suspendGraceDays) || 30;
            deleteGraceDays = Number(sData.transferOutSettings.deleteGraceDays) || 7;
          }
        }
      }

      // 2. 구글 워크스페이스에서 해당 유저의 OU를 전출/자퇴 OU로 이동
      try {
        await updateUser(email, { orgUnitPath: transferOutOU });
      } catch (err: any) {
        console.error("Failed to move user OU:", err);
        return NextResponse.json({ error: `조직단위 이동 실패: ${err.message}` }, { status: 500 });
      }

      // 3. 학생이 속한 모든 Google Groups 조회 및 탈퇴
      let originalGroups: string[] = [];
      try {
        const groups = await listGroupsForUser(email);
        originalGroups = groups.map((g: any) => g.email);
        for (const gEmail of originalGroups) {
          try {
            await removeGroupMember(gEmail, email);
          } catch (grpErr) {
            console.warn(`그룹 탈퇴 실패 (${gEmail}):`, grpErr);
          }
        }
      } catch (grpListErr) {
        console.warn("그룹스 목록 조회 실패:", grpListErr);
      }

      // 4. Firestore에 전출 진행 태스크 등록 (maxSuspendDueDate 상한 고정)
      const now = new Date();
      const suspendDueDate = new Date(now.getTime() + suspendGraceDays * 24 * 60 * 60 * 1000);
      const deleteDueDate = new Date(suspendDueDate.getTime() + deleteGraceDays * 24 * 60 * 60 * 1000);

      const taskRef = adminDb.collection("transfer_out_tasks").doc(domain || "mock-domain").collection("students").doc(email);
      const taskData = {
        email,
        name: studentName || "학생",
        studentId: studentId || "-",
        originalOU: originalOU || "/학생",
        originalGroups,
        status: "OU_MOVED",
        registeredAt: now,
        suspendDueDate,
        maxSuspendDueDate: suspendDueDate, // 학생 셀프 설정 상한일
        deleteDueDate,
        suspendedAt: null,
        deletedAt: null,
      };
      await taskRef.set(taskData);

      // 치환자 공통 헬퍼
      const studentDeadlineUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "https://portal.hmh.or.kr"}/student-portal`;
      const maxSuspendDateStr = suspendDueDate.toLocaleDateString("ko-KR");
      const applyStudentVars = (tpl: string) =>
        tpl
          .replace(/\{name\}/g, studentName || "학생")
          .replace(/\{email\}/g, email)
          .replace(/\{suspendDate\}/g, suspendDueDate.toLocaleDateString("ko-KR"))
          .replace(/\{deleteDate\}/g, deleteDueDate.toLocaleDateString("ko-KR"))
          .replace(/\{deadlineUrl\}/g, studentDeadlineUrl)
          .replace(/\{maxSuspendDate\}/g, maxSuspendDateStr)
          .replace(/\{suspendGraceDays\}/g, String(suspendGraceDays))
          .replace(/\{deleteGraceDays\}/g, String(deleteGraceDays));

      // 5. Gmail 발송 (설정에 저장된 템플릿 사용)
      try {
        let emailSubject = "[안내] 전출/자퇴로 인한 구글 워크스페이스 계정 정지 및 데이터 백업 안내";
        let emailBody = `[효명고등학교 계정관리시스템]\n\n${studentName || "학생"}님의 전출/자퇴 처리에 따른 구글 워크스페이스 계정 정지 및 데이터 백업 안내입니다.\n\n■ 계정 일시정지 마지노선: ${maxSuspendDateStr} (${suspendGraceDays}일 후)\n■ 계정 영구삭제 예정일: 일시정지 후 ${deleteGraceDays}일 경과 시\n\n👉 학생 포털에서 계정 정지 희망일 직접 설정하기:\n${studentDeadlineUrl}\n\n계정이 일시정지되면 모든 구글 서비스 이용이 차단되므로, 정지 예정일 전까지 중요 데이터를 반드시 백업해 주세요.\n\n- 개인 기기로 데이터 다운로드 가이드: https://www.iorad.com/player/1765417/--------------#trysteps-1\n- 타 구글 계정으로 데이터 전송 가이드: https://www.iorad.com/player/1813583/GW---------------------#trysteps-1\n- 구글 테이크아웃 바로가기: https://takeout.google.com\n\n감사합니다.`;

        if (domain) {
          const settingsSnap = await adminDb.collection("settings").doc(domain).get();
          if (settingsSnap.exists) {
            const sData = settingsSnap.data() || {};
            if (sData.transferOutSettings?.emailTemplateSubject) {
              emailSubject = applyStudentVars(sData.transferOutSettings.emailTemplateSubject);
            }
            if (sData.transferOutSettings?.emailTemplateBody) {
              emailBody = applyStudentVars(sData.transferOutSettings.emailTemplateBody);
            }
          }
        }

        const senderEmail = process.env.GOOGLE_WORKSPACE_SENDER_EMAIL || process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || "hmnotice@hmh.or.kr";
        await sendGmail(senderEmail, email, emailSubject, emailBody);
        console.log(`[Gmail] 전출/자퇴 안내 메일 발송 완료 → ${email}`);
      } catch (mailErr: any) {
        console.warn(`[Gmail] 메일 발송 실패 (${email}):`, mailErr.message);
      }

      // 6. Google Chat DM 발송 (설정에 저장된 챗 템플릿 사용)
      try {
        let chatBody = `📢 [효명고등학교 계정관리시스템]\n${studentName || "학생"}님의 전출/자퇴 처리에 따라 사용 중이던 학교 계정(${email})이 정리될 예정입니다.\n\n👉 학생 포털에서 계정 정지 희망일 직접 설정하기:\n${studentDeadlineUrl} (최대 마지노선: ${maxSuspendDateStr})\n\n아래 튜토리얼 가이드를 참고하여 중요한 자료는 그 전까지 반드시 개인 기기로 다운로드하거나 타 계정으로 전송하여 백업해 주시기 바랍니다.\n- 데이터 다운로드 가이드: https://www.iorad.com/player/1765417/--------------#trysteps-1\n- 타 계정 전송 가이드: https://www.iorad.com/player/1813583/GW---------------------#trysteps-1\n- 구글 테이크아웃: https://takeout.google.com`;

        if (domain) {
          const settingsSnap2 = await adminDb.collection("settings").doc(domain).get();
          if (settingsSnap2.exists) {
            const sData2 = settingsSnap2.data() || {};
            if (sData2.transferOutSettings?.chatTemplateBody) {
              chatBody = applyStudentVars(sData2.transferOutSettings.chatTemplateBody);
            }
          }
        }

        await sendGoogleChat(email, chatBody);
        console.log(`[Chat] 전출/자퇴 안내 챗 DM 발송 완료 → ${email}`);
      } catch (chatErr: any) {
        console.warn(`[Chat] 챗 DM 발송 실패 (${email}):`, chatErr.message);
      }

      invalidateUserCache();

      await writeAuditLog({
        operatorEmail: adminEmail,
        operatorName: adminName,
        action: "전출/자퇴 등록 (OU 이동 및 격리)",
        targetEmail: email,
        details: `이름: ${studentName || "미입력"}, 이동 OU: ${transferOutOU}, 그룹스 ${originalGroups.length}개 탈퇴 처리`,
        status: "success",
      });

      return NextResponse.json({ success: true, task: taskData, isMock });
    }

    // ─────────────────────────────────────────
    // ACTION: execute_transfer_out_suspend (계정 일시정지)
    // ─────────────────────────────────────────
    if (action === "execute_transfer_out_suspend") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "이메일이 누락되었습니다." }, { status: 400 });
      }

      try {
        await updateUser(email, { suspended: true });
        
        const taskRef = adminDb.collection("transfer_out_tasks").doc(domain || "mock-domain").collection("students").doc(email);
        await taskRef.update({
          status: "SUSPENDED",
          suspendedAt: new Date(),
        });

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "전출/자퇴 계정 정지",
          targetEmail: email,
          details: "구글 워크스페이스 계정 즉시 일시 정지(Suspend) 수행 완료",
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `계정 일시정지 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: execute_transfer_out_delete (계정 영구삭제)
    // ─────────────────────────────────────────
    if (action === "execute_transfer_out_delete") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "이메일이 누락되었습니다." }, { status: 400 });
      }

      try {
        // Firebase Auth에서도 유저 레코드 동기화 삭제
        await deleteAuthUserByEmail(email);

        await deleteUser(email);

        // 삭제 완료된 태스크는 Firestore에서도 제거 (감사 로그에 기록되므로 이력 보존 OK)
        const taskRef = adminDb.collection("transfer_out_tasks").doc(domain || "mock-domain").collection("students").doc(email);
        await taskRef.delete();

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "전출/자퇴 계정 영구 삭제",
          targetEmail: email,
          details: "구글 워크스페이스 계정 영구 삭제(Delete) 수행 완료",
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `계정 영구삭제 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: restore_transfer_out (전출/자퇴 취소 및 계정 복구)
    // ─────────────────────────────────────────
    if (action === "restore_transfer_out") {
      const { email } = body;
      if (!email) {
        return NextResponse.json({ error: "이메일이 누락되었습니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("transfer_out_tasks").doc(domain || "mock-domain").collection("students").doc(email);
        const taskSnap = await taskRef.get();
        
        if (!taskSnap.exists) {
          return NextResponse.json({ error: "해당 학생의 전출 처리 기록이 존재하지 않습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data() || {};
        const { originalOU, originalGroups } = taskData;

        // 1. 구글 워크스페이스에서 계정 활성화 및 이전 OU로 이동
        await updateUser(email, {
          orgUnitPath: originalOU || "/학생",
          suspended: false,
        });

        // 2. 이전 가입했던 그룹스 복구
        if (Array.isArray(originalGroups)) {
          for (const gEmail of originalGroups) {
            try {
              await addGroupMember(gEmail, email);
            } catch (grpErr) {
              console.warn(`그룹 재복구 실패 (${gEmail}):`, grpErr);
            }
          }
        }

        // 3. Firestore에서 전출 태스크 레코드 삭제
        await taskRef.delete();

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "전출/자퇴 취소 및 계정 복구",
          targetEmail: email,
          details: `이전 OU(${originalOU || "/학생"}) 이동, 계정 활성화 및 소속 그룹스 복구 완료`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `계정 복구 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: sync_graduation_candidates (졸업 대상 학생 동기화)
    // ─────────────────────────────────────────
    if (action === "sync_graduation_candidates") {
      try {
        if (!domain) {
          return NextResponse.json({ error: "도메인 정보가 누락되었습니다." }, { status: 400 });
        }

        // 1. 설정에서 3학년 및 졸업생 OU 경로 조회
        let grade3OU = "";
        let graduatesOU = "";
        const settingsSnap = await adminDb.collection("settings").doc(domain).get();
        if (settingsSnap.exists) {
          const sData = settingsSnap.data() || {};
          if (sData.ouMapping?.students) {
            grade3OU = sData.ouMapping.students[3] || sData.ouMapping.students["3"] || "";
          }
          if (sData.ouMapping?.graduates) {
            graduatesOU = sData.ouMapping.graduates;
          }
        }

        // 동기화할 대상 OU 취합 (3학년 또는 졸업생 OU)
        const targetOUs = [grade3OU, graduatesOU].filter(Boolean);
        if (targetOUs.length === 0) {
          return NextResponse.json({ error: "3학년 또는 졸업생 OU 경로가 매핑되지 않았습니다." }, { status: 400 });
        }

        // 2. 구글 워크스페이스에서 해당 OU 학생 전체 조회
        const students = await listUsersInOUs(targetOUs);
        const results = { added: 0, skipped: 0, errors: 0 };

        // 3. 각 학생별로 Firestore에 graduation_tasks 등록 (이메일 기준 고유 보존)
        // 기존 태스크 전체를 1회만 읽어 메모리에서 비교하고, 쓰기는 batch로 묶는다
        // (이전: 학생별 get→set 순차 왕복 N+1 — 500명 기준 15~30초 → 왕복 2~3회)
        const tasksCol = adminDb.collection("graduation_tasks").doc(domain).collection("students");
        const existingSnap = await tasksCol.get();
        const existingTasks = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

        let batch = adminDb.batch();
        let batchCount = 0;
        const flushIfFull = async () => {
          if (batchCount >= 400) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
          }
        };

        for (const student of students) {
          const email = student.primaryEmail;
          if (!email) continue;

          const name = student.name?.givenName || student.name || "학생";
          const studentId = student.name?.familyName || ""; // familyName에 학번 저장 관례
          const existing = existingTasks.get(email);

          if (!existing) {
            // 최초 등록 시 구글 계정 일시정지 상태에 따라 초기 상태 지정
            batch.set(tasksCol.doc(email), {
              email,
              name,
              studentId,
              originalOU: student.orgUnitPath || "/학생",
              status: student.suspended ? "SUSPENDED" : "PENDING",
              registeredAt: new Date(),
              consentSubmitted: false,
              consentedAt: null,
              acknowledgedDeletion: false,
              acknowledgedDownload: false,
              suspendedAt: student.suspended ? new Date() : null,
              deletedAt: null,
              warnedCount: 0,
              lastWarnedAt: null,
            });
            batchCount++;
            results.added++;
          } else {
            // 이미 존재하는 졸업생 태스크의 경우, 구글의 일시정지 상태와 동기화
            const isGwsSuspended = !!student.suspended;
            const isDbSuspended = existing.status === "SUSPENDED";

            if (isGwsSuspended !== isDbSuspended) {
              if (isGwsSuspended) {
                // GWS에선 정지되었으나 DB 상태가 정지가 아니면 정지로 변경
                batch.update(tasksCol.doc(email), {
                  status: "SUSPENDED",
                  suspendedAt: new Date(),
                });
              } else {
                // GWS에선 정지 해제되었으나 DB 상태가 여전히 정지이면 원래 상태로 변경
                const originalStatus = existing.consentSubmitted ? "CONSENTED" : "PENDING";
                batch.update(tasksCol.doc(email), {
                  status: originalStatus,
                  suspendedAt: null,
                });
              }
              batchCount++;
            }
            results.skipped++;
          }
          await flushIfFull();
        }
        if (batchCount > 0) await batch.commit();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업 대상자 동기화",
          targetEmail: "복수 계정",
          details: `동기화 완료: 신규 추가 ${results.added}명, 기존 유지 ${results.skipped}명, 오류 ${results.errors}건`,
          status: results.errors === 0 ? "success" : "failure",
        });

        return NextResponse.json({ success: true, results, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `동기화 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: clear_graduation_candidates (졸업 대상자 목록 전체 비우기)
    // ─────────────────────────────────────────
    if (action === "clear_graduation_candidates") {
      try {
        if (!domain) {
          return NextResponse.json({ error: "도메인 정보가 누락되었습니다." }, { status: 400 });
        }

        const snap = await adminDb.collection("graduation_tasks").doc(domain).collection("students").get();

        // 테스트용 학생은 제외하고 실제 동기화된 일반 학생 데이터만 삭제
        // (문서별 순차 delete → 400건 단위 batch 삭제)
        const toDelete = snap.docs.filter((sDoc) => {
          const task = sDoc.data();
          return !task.isTest && task.originalOU !== "/학생/테스트";
        });
        for (let i = 0; i < toDelete.length; i += 400) {
          const batch = adminDb.batch();
          toDelete.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        const deletedCount = toDelete.length;

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업 대상자 목록 비우기",
          targetEmail: "복수 계정",
          details: `동기화된 일반 학생 ${deletedCount}명 기록 삭제 완료 (테스트 학생 제외)`,
          status: "success",
        });

        return NextResponse.json({ success: true, deletedCount, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `목록 비우기 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: save_graduation_settings (졸업 설정 저장)
    // ─────────────────────────────────────────
    if (action === "save_graduation_settings") {
      const { graduationSettings } = body;
      if (!domain || !graduationSettings) {
        return NextResponse.json({ error: "도메인 또는 설정 정보가 누락되었습니다." }, { status: 400 });
      }

      try {
        const settingsRef = adminDb.collection("settings").doc(domain);
        const settingsSnap = await settingsRef.get();
        if (settingsSnap.exists) {
          await settingsRef.set({
            ...settingsSnap.data(),
            graduationSettings,
            updatedAt: new Date(),
          });
        } else {
          await settingsRef.set({
            graduationSettings,
            updatedAt: new Date(),
          });
        }

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업 설정 변경",
          targetEmail: "-",
          details: `정지 예정일: ${graduationSettings.suspendDate}, 삭제 예정일: ${graduationSettings.deleteDate}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `설정 저장 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: submit_student_consent (학생 본인 동의 제출)
    // ─────────────────────────────────────────
    if (action === "submit_student_consent") {
      const { email, signature } = body;
      if (!email || !domain) {
        return NextResponse.json({ error: "이메일 또는 도메인 정보가 누락되었습니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
        const taskSnap = await taskRef.get();

        if (!taskSnap.exists) {
          return NextResponse.json({ error: "졸업 관리 대상자 명단에 이메일이 존재하지 않습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data() || {};

        // 1. 별도 보관용 컬렉션 graduation_consents에 영구 보존용 동의서(서명 포함) 저장
        const consentRef = adminDb.collection("graduation_consents").doc(`${domain}_${email}`);
        await consentRef.set({
          email,
          domain,
          name: taskData.name || "학생",
          studentId: taskData.studentId || "",
          consentedAt: new Date(),
          signature: signature || "서명 누락",
          expiresAt: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000), // 3년 후 만료
        });

        // 2. 기존 graduation_tasks의 개별 학생 타스크 상태 업데이트
        await taskRef.update({
          status: "CONSENTED",
          consentSubmitted: true,
          consentedAt: new Date(),
          acknowledgedDeletion: true,
          acknowledgedDownload: true,
        });

        await writeAuditLog({
          operatorEmail: email,
          operatorName: taskData.name || "학생",
          action: "졸업생 동의서 제출",
          targetEmail: email,
          details: "학생 본인 계정 삭제 및 데이터 백업 안내 동의 제출 완료 (터치 서명 포함)",
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `동의 제출 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: toggle_student_consent (수동 동의/동의 취소 토글)
    // ─────────────────────────────────────────
    if (action === "toggle_student_consent") {
      const { email, consentSubmitted } = body;
      if (!email || !domain) {
        return NextResponse.json({ error: "이메일 또는 도메인 정보가 누락되었습니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
        const taskSnap = await taskRef.get();

        if (!taskSnap.exists) {
          return NextResponse.json({ error: "졸업 대상자 기록이 존재하지 않습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data() || {};
        const isSubmit = !!consentSubmitted;

        // 1. 수동 동의 처리 시 graduation_consents 보존 레코드도 생성/삭제 동기화
        const consentRef = adminDb.collection("graduation_consents").doc(`${domain}_${email}`);
        if (isSubmit) {
          await consentRef.set({
            email,
            domain,
            name: taskData.name || "학생",
            studentId: taskData.studentId || "",
            consentedAt: new Date(),
            signature: "대리 동의 (관리자 승인)",
            expiresAt: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000), // 3년 후 만료
          });
        } else {
          await consentRef.delete();
        }

        // 2. 태스크 상태 업데이트
        await taskRef.update({
          status: isSubmit ? "CONSENTED" : "PENDING",
          consentSubmitted: isSubmit,
          consentedAt: isSubmit ? new Date() : null,
          acknowledgedDeletion: isSubmit,
          acknowledgedDownload: isSubmit,
        });

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: isSubmit ? "졸업 동의 강제 등록" : "졸업 동의 등록 취소",
          targetEmail: email,
          details: `관리자에 의한 상태 변경: ${isSubmit ? "동의 완료" : "미동의(대기)"}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `상태 변경 실패: ${err.message}` }, { status: 500 });
      }
    }
    // ─────────────────────────────────────────
    // ACTION: execute_graduation_suspend (졸업 예정 학생 일괄 정지)
    // ─────────────────────────────────────────
    if (action === "execute_graduation_suspend") {
      try {
        if (!domain) {
          return NextResponse.json({ error: "도메인 정보가 누락되었습니다." }, { status: 400 });
        }

        const snap = await adminDb.collection("graduation_tasks").doc(domain).collection("students").get();
        const results = { suspended: 0, skipped: 0, errors: 0 };

        // 학생별 처리는 독립 — 동시성 5로 병렬 실행 (순차 시 수백 명 규모에서 함수 시간 한도 초과)
        await mapConcurrent(snap.docs, 5, async (sDoc) => {
          const task = sDoc.data();
          const email = task.email;
          if (task.status === "PENDING" || task.status === "CONSENTED") {
            try {
              await updateUser(email, { suspended: true });
              await adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email).update({
                status: "SUSPENDED",
                suspendedAt: new Date(),
              });
              results.suspended++;
            } catch (err) {
              console.error(`계정 정지 실패 (${email}):`, err);
              results.errors++;
            }
          } else {
            results.skipped++;
          }
        });

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업생 계정 일괄 정지",
          targetEmail: "복수 계정",
          details: `정지 완료: ${results.suspended}명, 건너뜀: ${results.skipped}명, 에러: ${results.errors}건`,
          status: results.errors === 0 ? "success" : "failure",
        });

        return NextResponse.json({ success: true, results, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `일괄 정지 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: execute_graduation_delete (졸업 예정 학생 일괄 삭제)
    // ─────────────────────────────────────────
    if (action === "execute_graduation_delete") {
      try {
        if (!domain) {
          return NextResponse.json({ error: "도메인 정보가 누락되었습니다." }, { status: 400 });
        }

        const snap = await adminDb.collection("graduation_tasks").doc(domain).collection("students").get();
        const results = { deleted: 0, skipped: 0, errors: 0 };

        // 학생별 처리는 독립 — 동시성 5로 병렬 실행. 학생 1명 안에서의
        // 순서(Firebase Auth 삭제 → GWS 삭제 → 상태 기록)는 그대로 유지됨.
        await mapConcurrent(snap.docs, 5, async (sDoc) => {
          const task = sDoc.data();
          const email = task.email;
          if (task.status === "SUSPENDED") {
            try {
              // Firebase Auth에서도 해당 졸업생 유저 레코드 동기화 삭제
              await deleteAuthUserByEmail(email);

              await deleteUser(email);
              await adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email).update({
                status: "DELETED",
                deletedAt: new Date(),
              });
              results.deleted++;
            } catch (err) {
              console.error(`계정 삭제 실패 (${email}):`, err);
              results.errors++;
            }
          } else {
            results.skipped++;
          }
        });

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업생 계정 일괄 영구 삭제",
          targetEmail: "복수 계정",
          details: `삭제 완료: ${results.deleted}명, 건너뜀: ${results.skipped}명, 에러: ${results.errors}건`,
          status: results.errors === 0 ? "success" : "failure",
        });

        return NextResponse.json({ success: true, results, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `일괄 삭제 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: execute_graduation_restore (졸업 예정 학생 일괄 활성화/정지 해제)
    // ─────────────────────────────────────────
    if (action === "execute_graduation_restore") {
      try {
        if (!domain) {
          return NextResponse.json({ error: "도메인 정보가 누락되었습니다." }, { status: 400 });
        }

        const snap = await adminDb.collection("graduation_tasks").doc(domain).collection("students").get();
        const results = { restored: 0, skipped: 0, errors: 0 };

        // 학생별 처리는 독립 — 동시성 5로 병렬 실행
        await mapConcurrent(snap.docs, 5, async (sDoc) => {
          const task = sDoc.data();
          const email = task.email;
          if (task.status === "SUSPENDED") {
            try {
              // 1. 구글 워크스페이스 상에서 계정 활성화
              await updateUser(email, { suspended: false });

              // 2. 동의 여부에 따라 상태 원복
              const originalStatus = task.consentSubmitted ? "CONSENTED" : "PENDING";
              await adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email).update({
                status: originalStatus,
                suspendedAt: null,
              });
              results.restored++;
            } catch (err) {
              console.error(`계정 활성화 실패 (${email}):`, err);
              results.errors++;
            }
          } else {
            results.skipped++;
          }
        });

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업생 계정 일괄 활성화 (정지 해제)",
          targetEmail: "복수 계정",
          details: `활성화 완료: ${results.restored}명, 건너뜀: ${results.skipped}명, 에러: ${results.errors}건`,
          status: results.errors === 0 ? "success" : "failure",
        });

        return NextResponse.json({ success: true, results, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `일괄 활성화 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: execute_individual_graduation_restore (개별 졸업생 계정 활성화 / 정지 해제)
    // ─────────────────────────────────────────
    if (action === "execute_individual_graduation_restore") {
      const { email } = body;
      if (!email || !domain) {
        return NextResponse.json({ error: "이메일 또는 도메인 정보가 누락되었습니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
        const taskSnap = await taskRef.get();
        if (!taskSnap.exists) {
          return NextResponse.json({ error: "졸업 대상자 기록이 존재하지 않습니다." }, { status: 404 });
        }

        const task = taskSnap.data() || {};

        // 1. 구글 워크스페이스 상에서 계정 활성화 (정지 해제)
        await updateUser(email, { suspended: false });

        // 2. 동의 여부에 따라 Firestore 상태 원복
        const originalStatus = task.consentSubmitted ? "CONSENTED" : "PENDING";
        await taskRef.update({
          status: originalStatus,
          suspendedAt: null,
        });

        invalidateUserCache();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "졸업생 개별 계정 활성화 (정지 해제)",
          targetEmail: email,
          details: `계정 활성화 및 Firestore 상태 복구 완료 (${originalStatus})`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `계정 개별 활성화 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: add_test_graduation_student (테스트용 졸업생 수동 등록)
    // ─────────────────────────────────────────
    if (action === "add_test_graduation_student") {
      const { name, email, studentId } = body;
      if (!email || !name || !domain) {
        return NextResponse.json({ error: "필수 정보(이름, 이메일, 도메인)가 누락되었습니다." }, { status: 400 });
      }
      // 원시 문자열이 그대로 문서 ID가 되는 유령 레코드 차단 (테스트 레코드라 실존 확인은 생략)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json(
          { error: "올바른 이메일 형식이 아닙니다. 전체 주소(아이디@도메인)로 입력해 주세요." },
          { status: 400 }
        );
      }

      try {
        const taskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
        await taskRef.set({
          email,
          name,
          studentId: studentId || "테스트",
          originalOU: "/학생/테스트",
          status: "PENDING",
          registeredAt: new Date(),
          consentSubmitted: false,
          consentedAt: null,
          acknowledgedDeletion: false,
          acknowledgedDownload: false,
          suspendedAt: null,
          deletedAt: null,
          warnedCount: 0,
          lastWarnedAt: null,
          isTest: true,
        });

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "테스트 졸업생 수동 등록",
          targetEmail: email,
          details: `이름: ${name}, 학번: ${studentId || "없음"} 수동 등록 완료`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `테스트 학생 등록 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: delete_test_graduation_student (테스트용 졸업생 수동 삭제)
    // ─────────────────────────────────────────
    if (action === "delete_test_graduation_student") {
      const { email } = body;
      if (!email || !domain) {
        return NextResponse.json({ error: "이메일 또는 도메인이 누락되었습니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
        await taskRef.delete();

        // 테스트 유저 삭제 시 보관함에 들어간 테스트용 동의 서명 기록도 동시 영구 삭제
        const consentRef = adminDb.collection("graduation_consents").doc(`${domain}_${email}`);
        await consentRef.delete();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "테스트 졸업생 수동 삭제",
          targetEmail: email,
          details: `${email} 테스트 학생 기록 삭제 완료`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `테스트 학생 삭제 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: test_graduation_cron (졸업생 스케줄러 가상 테스트 실행)
    // ─────────────────────────────────────────
    if (action === "test_graduation_cron") {
      const { mockToday, testEmailFilter } = body;
      try {
        const cronUrl = new URL(`/api/workspace/lifecycle/cron`, req.url);
        if (mockToday) {
          cronUrl.searchParams.set("mockToday", mockToday);
        }
        if (testEmailFilter) {
          cronUrl.searchParams.set("testEmailFilter", testEmailFilter);
        }
        
        const headers: HeadersInit = {};
        if (process.env.CRON_SECRET) {
          headers["authorization"] = `Bearer ${process.env.CRON_SECRET}`;
        }
        
        const response = await fetch(cronUrl.toString(), {
          method: "GET",
          headers,
        });

        if (!response.ok) {
          const errText = await response.text();
          return NextResponse.json({ error: `크론 테스트 실행 실패: ${errText}` }, { status: response.status });
        }

        const data = await response.json();
        // cron 응답 필드를 그대로 반환 (results로 이중 래핑하지 않음)
        return NextResponse.json({ success: true, ...data });
      } catch (err: any) {
        return NextResponse.json({ error: `시뮬레이션 테스트 실행 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: send_individual_graduation_warning (개별 졸업 독촉 알림 발송)
    // ─────────────────────────────────────────
    if (action === "send_individual_graduation_warning") {
      const { email } = body;
      if (!email || !domain) {
        return NextResponse.json({ error: "이메일 또는 도메인이 누락되었습니다." }, { status: 400 });
      }
      try {
        const taskRef = adminDb.collection("graduation_tasks").doc(domain).collection("students").doc(email);
        const taskSnap = await taskRef.get();
        if (!taskSnap.exists) {
          return NextResponse.json({ error: "학생 기록을 찾을 수 없습니다." }, { status: 404 });
        }
        const task = taskSnap.data() || {};
        
        let suspendFmt = "지정일";
        let deleteFmt = "지정일";
        let emailSubject = "[중요] 구글 워크스페이스 계정 삭제 사전 안내 — 안내 확인 서명이 필요합니다";
        let emailBody = "";
        let chatBody = "";

        const settingsSnap = await adminDb.collection("settings").doc(domain).get();
        if (settingsSnap.exists) {
          const sData = settingsSnap.data() || {};
          const gradSettings = sData.graduationSettings;
          if (gradSettings) {
            suspendFmt = gradSettings.suspendDate ? new Date(gradSettings.suspendDate).toLocaleDateString("ko-KR") : "지정일";
            deleteFmt = gradSettings.deleteDate ? new Date(gradSettings.deleteDate).toLocaleDateString("ko-KR") : "지정일";
            emailSubject = gradSettings.emailTemplateSubject || emailSubject;
            emailBody = gradSettings.emailTemplateBody || "";
            chatBody = gradSettings.chatTemplateBody || "";
          }
        }

        const portalOrigin = new URL(req.url).origin;
        const portalUrl = `${portalOrigin}/student-portal`;

        const name = task.name || "학생";
        const replaceVars = (txt: string) =>
          txt
            .replace(/\{name\}/g, name)
            .replace(/\{email\}/g, email)
            .replace(/\{suspendDate\}/g, suspendFmt)
            .replace(/\{deleteDate\}/g, deleteFmt)
            .replace(/\{portalUrl\}/g, portalUrl);

        emailSubject = replaceVars(emailSubject);
        if (!emailBody) {
          emailBody = replaceVars(`안녕하세요, {name}님.

효명고등학교 구글 워크스페이스 계정 관리 시스템에서 안내드립니다.

학교에서 사용 중인 구글 계정(학교 이메일)은 학교 전체가 드라이브 용량을 공유하는 교육용 계정으로, 졸업 이후에는 해당 계정을 삭제해야 합니다. 아래 내용을 확인하고 서명을 완료해 주세요.

━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  계정 처리 예정 일정
━━━━━━━━━━━━━━━━━━━━━━━━━
  📅 계정 일시정지 예정일 : {suspendDate}
  🗑️  계정 영구 삭제 예정일 : {deleteDate}

※ 계정이 일시정지되면 구글 드라이브, Gmail, 구글 포토 등 모든 데이터에 접근할 수 없게 됩니다.

━━━━━━━━━━━━━━━━━━━━━━━━━
✅  안내 확인 서명 (필수 — 정지 예정일 이전까지 완료)
━━━━━━━━━━━━━━━━━━━━━━━━━
학교는 위 계정 삭제 일정 및 아래 데이터 이전·다운로드 방법을 학생에게 안내하였습니다.
아래 학생 포털에 접속하여 '안내 확인 서명'을 완료해 주세요.

  → {portalUrl}

이 서명은 '데이터 백업을 완료했다'는 의미가 아니라,
'학교로부터 계정 삭제 안내 및 방법을 전달받았음'을 확인하는 것입니다.

※ 계정이 정지되면 포털 접속 자체가 불가능하므로, 반드시 정지 예정일 이전에 서명해 주세요.

━━━━━━━━━━━━━━━━━━━━━━━━━
📦  데이터 이전 및 다운로드 방법
━━━━━━━━━━━━━━━━━━━━━━━━━
다른 구글 계정으로의 데이터 이전 방법과 다운로드 방법 모두 아래 가이드에 상세히 안내되어 있습니다.

  → https://gw.googleforeducation.org/관리하기/학년을-마무리-하며-할-일/졸업생을-위한-안내자료

궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요.
감사합니다.

효명고등학교 드림`);
        } else {
          emailBody = replaceVars(emailBody);
        }
        if (!chatBody) {
          chatBody = replaceVars(`📢 *[효명고등학교 구글 계정 삭제 사전 안내]*

안녕하세요, *{name}*님.
학교 구글 계정이 아래 일정에 따라 처리될 예정입니다.

📅 *계정 일시정지 예정:* {suspendDate}
🗑️ *계정 영구삭제 예정:* {deleteDate}

━━━━━━━━━━━━━━━━━━━
⚠️ 계정이 정지되면 드라이브·Gmail·포토 등 모든 데이터에 접근할 수 없습니다.

✅ *[필수] 정지 예정일 전까지 학생 포털에서 안내 확인 서명을 완료해 주세요.*
서명은 '백업 완료' 확인이 아니라, 학교로부터 계정 삭제 안내를 받았음을 확인하는 것입니다.
계정이 정지되면 서명도 불가능합니다!

  → {portalUrl}

📦 *데이터 이전 및 다운로드 방법*
  → https://gw.googleforeducation.org/관리하기/학년을-마무리-하며-할-일/졸업생을-위한-안내자료`);
        } else {
          chatBody = replaceVars(chatBody);
        }

        const mailSender = process.env.GOOGLE_WORKSPACE_SENDER_EMAIL || process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || "hmnotice@hmh.or.kr";
        await sendGmail(mailSender, email, emailSubject, emailBody);
        await sendGoogleChat(email, chatBody);

        await taskRef.update({
          warnedCount: (task.warnedCount || 0) + 1,
          lastWarnedAt: new Date(),
        });

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "개별 졸업 안내 리마인더 발송",
          targetEmail: email,
          details: `이메일 및 구글 챗 안내 리마인더 개별 발송 완료`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock });
      } catch (err: any) {
        return NextResponse.json({ error: `알림 발송 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // DYNAMIC TEACHER GROUPS HELPER
    // ─────────────────────────────────────────
    const getTeacherGroups = async (): Promise<string[]> => {
      const classroomTeachersGroup = `classroom_teachers@${domain || "hmh.or.kr"}`;
      if (!domain) return DEFAULT_TEACHER_GROUPS;
      try {
        const settingsSnap = await adminDb.collection("settings").doc(domain).get();
        if (settingsSnap.exists) {
          const settings = settingsSnap.data() || {};
          if (settings.teacherSettings?.autoJoinGroups && Array.isArray(settings.teacherSettings.autoJoinGroups)) {
            const groups = settings.teacherSettings.autoJoinGroups;
            if (!groups.includes(classroomTeachersGroup)) {
              return [classroomTeachersGroup, ...groups];
            }
            return groups;
          }
        }
      } catch (err) {
        console.warn("Failed to load autoJoinGroups setting, using fallback defaults:", err);
      }
      return DEFAULT_TEACHER_GROUPS;
    };

    // ─────────────────────────────────────────
    // ACTION: enroll_teacher
    // 신규 교사 계정 생성 및 지정된 그룹 자동 가입
    // ─────────────────────────────────────────
    if (action === "enroll_teacher") {
      const { teacherEmail, teacherGivenName, teacherFamilyName, teacherOU } = body;
      if (!teacherEmail || !teacherGivenName || !teacherFamilyName) {
        return NextResponse.json({ error: "교사 이메일, 이름(성/이름)은 필수 항목입니다." }, { status: 400 });
      }

      try {
        // Firebase Auth 구버전 UID 충돌 사전 방지
        await deleteAuthUserByEmail(teacherEmail);

        // GWS 계정 생성 (초기 패스워드: 고정값)
        const tempPassword = "1234abcd!!!!";
        const ouPath = teacherOU || "/교직원";
        await createUser(
          teacherEmail,
          teacherGivenName,
          teacherFamilyName,
          ouPath,
          tempPassword,
          true
        );

        // 사전 지정된 교사 그룹 동적 조회 및 자동 가입 (보안그룹은 최초 로그인 락 방지를 위해 가입 유보)
        const activeGroups = await getTeacherGroups();
        const groupResults: { group: string; success: boolean; error?: string }[] = [];
        for (const groupEmail of activeGroups) {
          const isSecurity = await checkIsSecurityGroup(groupEmail);
          if (isSecurity) {
            // 보안그룹은 나중에 로그인 성공 시 연동하므로 가입 보류
            continue;
          }
          try {
            await addGroupMember(groupEmail, teacherEmail);
            groupResults.push({ group: groupEmail, success: true });
          } catch (gErr: any) {
            groupResults.push({ group: groupEmail, success: false, error: gErr.message });
          }
        }

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "교사 신규 등록",
          targetEmail: teacherEmail,
          details: `GWS 계정 생성 및 지정 연동 그룹 가입 처리. 결과: ${JSON.stringify(groupResults)}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock, tempPassword, groupResults });
      } catch (err: any) {
        return NextResponse.json({ error: `교사 등록 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: register_teacher_transfer
    // 교사 전출 등록: 지정 연동 그룹 즉시 탈퇴 + OB 보존실 OU 이동 + Firestore 큐 적재 + 안내 알림 발송
    // ─────────────────────────────────────────
    if (action === "register_teacher_transfer") {
      const { teacherEmail, teacherName } = body;
      if (!teacherEmail || !domain) {
        return NextResponse.json({ error: "교사 이메일과 도메인은 필수 항목입니다." }, { status: 400 });
      }
      // 검색창 원시 문자열("gotest" 등)이 그대로 등록되던 구멍 차단
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(teacherEmail)) {
        return NextResponse.json(
          { error: "올바른 이메일 형식이 아닙니다. 전체 주소(아이디@도메인)로 입력해 주세요." },
          { status: 400 }
        );
      }
      // 보호 계정(fb01@·hmnotice@·admin@)은 전출 큐 등재 금지 — 기한 도래 시 삭제로 이어지는 경로
      if (isProtectedAccountEmail(teacherEmail)) {
        return NextResponse.json(
          { error: "이 계정은 시스템 운영에 필요한 보호 계정이라 전출 등록할 수 없습니다." },
          { status: 403 }
        );
      }

      try {
        // 1. 교사의 현재 워크스페이스 정보(OU) 조회 — 계정 실존 확인을 겸하므로 실패 시 등록 중단
        //    (존재하지 않는 계정이 큐에 유령 레코드로 남으면 취소조차 불가)
        let originalOU = "";
        try {
          const userGws = await getUser(teacherEmail);
          if (!userGws) throw new Error("user-not-found");
          originalOU = userGws.orgUnitPath || "";
        } catch (uErr: any) {
          return NextResponse.json(
            { error: `해당 이메일의 워크스페이스 계정을 찾을 수 없습니다: ${teacherEmail}` },
            { status: 404 }
          );
        }

        // 1-1. 재등록 가드: 이미 큐에 있으면 기존 originalOU 보존
        // — 재등록 시점의 현재 OU는 이미 OB라, 덮어쓰면 취소해도 OB에 좌초된다.
        const taskRef = adminDb.collection("teacher_transfer_tasks").doc(domain).collection("teachers").doc(teacherEmail);
        const prevTaskSnap = await taskRef.get();
        if (prevTaskSnap.exists && prevTaskSnap.data()?.originalOU) {
          originalOU = prevTaskSnap.data()!.originalOU;
        }

        // 2. OB 보존실 OU 조회 및 이동
        let newOU = "";
        let ouWarning = "";
        let teachersOBOU = "";
        try {
          const sSnap = await adminDb.collection("settings").doc(domain).get();
          if (sSnap.exists) {
            const sData = sSnap.data() || {};
            teachersOBOU = sData.ouMapping?.teachersOB || "";
          }
        } catch (sErr) {
          console.warn("설정 데이터 조회 실패:", sErr);
        }

        if (teachersOBOU) {
          try {
            await updateUser(teacherEmail, { orgUnitPath: teachersOBOU });
            newOU = teachersOBOU;
            invalidateUserCache();
          } catch (movErr: any) {
            console.error("교사 OB 보존실 OU 이동 실패:", movErr);
            ouWarning = `OB 보존실 OU 이동 실패: ${movErr.message}`;
          }
        } else {
          ouWarning = "OB 보존실 OU(teachersOB)가 설정되지 않아 OU 이동이 생략되었습니다.";
        }

        // 3. 지정 연동 그룹 즉시 강제 탈퇴 (보안 즉각 차단)
        const activeGroups = await getTeacherGroups();
        const groupResults: { group: string; success: boolean; error?: string }[] = [];
        for (const groupEmail of activeGroups) {
          try {
            await removeGroupMember(groupEmail, teacherEmail);
            groupResults.push({ group: groupEmail, success: true });
          } catch (gErr: any) {
            groupResults.push({ group: groupEmail, success: false, error: gErr.message });
          }
        }

        // 1년 뒤 기본 데드라인 설정 (KST 시차 고려한 1년 뒤 Date 객체 생성)
        const defaultDeadline = new Date();
        defaultDeadline.setFullYear(defaultDeadline.getFullYear() + 1);

        // 3-1. 조직도 프로필 정리 (2026-08-07 조직도 잔존 결함 수정)
        // teacher_profiles가 남으면 조직도·담임 조회에 유령으로 잡힌다. 원본은 전출 작업
        // 문서에 보관해 cancel_teacher_transfer가 그대로 복원한다. 재등록 시(이미 삭제됨)
        // 기존 보관본을 보존한다 (originalOU 가드와 동일 원리).
        const profileKey = teacherEmail.toLowerCase();
        let archivedProfile: any = prevTaskSnap.exists ? prevTaskSnap.data()?.archivedProfile || null : null;
        let archivedPending: any = prevTaskSnap.exists ? prevTaskSnap.data()?.archivedPending || null : null;
        try {
          const profRef = adminDb.collection("teacher_profiles").doc(profileKey);
          const profSnap = await profRef.get();
          if (profSnap.exists) {
            archivedProfile = profSnap.data();
            await profRef.delete();
          }
          const pendRef = adminDb.collection("teacher_profiles_pending").doc(profileKey);
          const pendSnap = await pendRef.get();
          if (pendSnap.exists) {
            archivedPending = pendSnap.data();
            await pendRef.delete();
          }
        } catch (profErr: any) {
          console.warn(`전출 등록: 조직도 프로필 정리 실패(계속 진행) — ${profileKey}:`, profErr?.message);
        }
        // 명단 색인 재조립 — 프로필·pending 정리가 **전부 끝난 뒤 한 번만** (roster_index_spec §2-1).
        // 빠뜨리면 떠난 교사가 조직도·쪽지·업무 수신자에 유령으로 남는다.
        await rebuildRosterIndexSafely(teacherEmail, "lifecycle:transfer_register");

        // Firestore에 전출 작업 등록 (originalOU·보관 프로필 포함)
        await taskRef.set({
          email: teacherEmail,
          name: teacherName || teacherEmail,
          status: "PENDING_DEADLINE",
          originalOU,
          ...(archivedProfile ? { archivedProfile } : {}),
          ...(archivedPending ? { archivedPending } : {}),
          registeredAt: new Date(),
          deadlineDate: defaultDeadline,
          deadlineSetAt: null,
          suspendedAt: null,
          deletedAt: null,
          warnedCount: 0,
          lastWarnedAt: null,
          registeredBy: adminEmail,
        });

        // 안내 이메일 및 구글 챗 알림 발송
        const mailSender =
          process.env.GOOGLE_WORKSPACE_SENDER_EMAIL ||
          process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL ||
          "hmnotice@hmh.or.kr";

        // 치환자 공통 값
        const deadlineUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "https://portal.hmh.or.kr"}/admin/transfer-deadline`;
        const maxDeadline = new Date();
        maxDeadline.setFullYear(maxDeadline.getFullYear() + 1);
        const maxDeadlineDateStr = maxDeadline.toLocaleDateString("ko-KR");
        const applyTeacherVars = (tpl: string) =>
          tpl
            .replace(/\{name\}/g, teacherName || teacherEmail)
            .replace(/\{email\}/g, teacherEmail)
            .replace(/\{deadlineUrl\}/g, deadlineUrl)
            .replace(/\{maxDeadlineDate\}/g, maxDeadlineDateStr);

        // 설정 우선·하드코딩 폴백
        let emailSubject = `[중요] 학교 구글 계정 전출 처리 안내 - 데이터 백업 기한을 설정해 주세요`;
        let emailBody = `안녕하세요, ${teacherName || teacherEmail}님.\n\n학교 행정상 선생님의 구글 워크스페이스 계정이 전출 처리되었습니다.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n📋  조치 사항\n━━━━━━━━━━━━━━━━━━━━━━━━━\n선생님이 가입되어 있던 교사용 연동 그룹에서 즉시 탈퇴 처리되었습니다.\n구글 계정 자체는 아직 유지되고 있으나, 아래 안내에 따라 데이터 백업 기한을 직접 설정하셔야 합니다.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n📅  기한 설정 방법\n━━━━━━━━━━━━━━━━━━━━━━━━━\n학교 어드민 시스템에 접속하시면 데이터 백업 완료 후 계정 삭제를 희망하시는 날짜(최대 1년 이내)를 직접 입력하실 수 있습니다.\n\n👉 어드민 시스템 바로가기:\n${deadlineUrl}\n\n📦  데이터 이전 및 다운로드 방법:\n→ https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4\n\n궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요. 감사합니다.\n\n효명고등학교 드림`;
        let chatBody = `📢 *[효명고등학교 구글 계정 전출 처리 안내]*\n\n안녕하세요, *${teacherName || teacherEmail}*님.\n학교 행정상 선생님의 구글 워크스페이스 계정이 전출 처리되었습니다.\n\n*📋  조치 사항*\n선생님이 가입되어 있던 교사용 연동 그룹에서 즉시 탈퇴 처리되었습니다.\n구글 계정 자체는 아직 유지되고 있으나, 아래 안내에 따라 데이터 백업 기한을 직접 설정하셔야 합니다.\n\n*📅  기한 설정 방법*\n학교 어드민 시스템에 접속하시면 데이터 백업 완료 후 계정 삭제를 희망하시는 날짜(최대 1년 이내)를 직접 입력하실 수 있습니다.\n\n👉 어드민 시스템 바로가기:\n${deadlineUrl}\n\n*📦  데이터 이전 및 다운로드 방법:*\n→ https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4\n\n궁금하신 점은 playviolin@hmh.or.kr 로 문의해 주세요. 감사합니다.`;

        if (domain) {
          try {
            const tSettingsSnap = await adminDb.collection("settings").doc(domain).get();
            if (tSettingsSnap.exists) {
              const ts = (tSettingsSnap.data() || {}).teacherTransferSettings;
              if (ts?.emailTemplateSubject) emailSubject = applyTeacherVars(ts.emailTemplateSubject);
              if (ts?.emailTemplateBody) emailBody = applyTeacherVars(ts.emailTemplateBody);
              if (ts?.chatTemplateBody) chatBody = applyTeacherVars(ts.chatTemplateBody);
            }
          } catch (settingsErr) {
            console.warn("교사 전출 알림 템플릿 설정 로드 실패(폴백 사용):", settingsErr);
          }
        }

        try {
          await sendGmail(mailSender, teacherEmail, emailSubject, emailBody);
          await sendGoogleChat(teacherEmail, chatBody);
        } catch (notifyErr) {
          console.warn("전출 안내 알림 발송 실패(계속 진행):", notifyErr);
        }

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "교사 전출 등록",
          targetEmail: teacherEmail,
          details: `연동 그룹 즉시 탈퇴 처리 및 전출 큐 등록. OU 이동: ${originalOU || "미지정"} -> ${newOU || "이동생략"}${ouWarning ? ` (${ouWarning})` : ""}. 그룹 결과: ${JSON.stringify(groupResults)}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock, groupResults, warning: ouWarning || undefined });
      } catch (err: any) {
        return NextResponse.json({ error: `전출 등록 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: cancel_teacher_transfer
    // 교사 전출 취소: Firestore 큐 삭제 + 지정 연동 그룹 재가입 + 원래 OU 복귀 (롤백)
    // ─────────────────────────────────────────
    if (action === "cancel_teacher_transfer") {
      const { teacherEmail, teacherName } = body;
      if (!teacherEmail || !domain) {
        return NextResponse.json({ error: "교사 이메일과 도메인은 필수 항목입니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("teacher_transfer_tasks").doc(domain).collection("teachers").doc(teacherEmail);
        const taskSnap = await taskRef.get();
        const taskData = taskSnap.exists ? taskSnap.data() : null;

        // 원복할 OU 결정 (task.originalOU -> settings.ouMapping.teachers -> "/교직원")
        let teachersOU = "/교직원";
        try {
          const sSnap = await adminDb.collection("settings").doc(domain).get();
          if (sSnap.exists) {
            const sData = sSnap.data() || {};
            if (sData.ouMapping?.teachers) teachersOU = sData.ouMapping.teachers;
          }
        } catch (sErr) {
          console.warn("설정 조회 실패:", sErr);
        }

        let restoreOU = taskData?.originalOU || teachersOU;

        // 0. GWS 계정 일시정지 해제 (활성화) 및 원래 OU 복귀
        // originalOU가 그 사이 삭제된 하위 OU면 이동이 실패하므로, 교사 루트 OU로 폴백 재시도
        // — 복귀 이동 실패가 계정 활성화·그룹 재가입까지 막지 않게 한다.
        // 계정 자체가 GWS에 없으면(유령 레코드·이미 삭제) GWS 조치를 건너뛰고 큐 정리만 진행.
        const isUserNotFound = (e: any) =>
          e?.code === 404 || e?.response?.status === 404 || /resource not found|user.?not.?found/i.test(e?.message || "");
        let accountMissing = false;
        try {
          await updateUser(teacherEmail, { suspended: false, orgUnitPath: restoreOU });
        } catch (restoreErr: any) {
          if (isUserNotFound(restoreErr)) {
            accountMissing = true;
            console.warn(`전출 취소: ${teacherEmail} 계정이 GWS에 없음 — 큐 정리만 진행`);
          } else if (restoreOU !== teachersOU) {
            console.warn(`원래 OU(${restoreOU}) 복귀 실패, 교사 루트(${teachersOU})로 폴백:`, restoreErr.message);
            restoreOU = teachersOU;
            await updateUser(teacherEmail, { suspended: false, orgUnitPath: restoreOU });
          } else {
            throw restoreErr;
          }
        }
        invalidateUserCache();

        // 1. 지정 연동 그룹 재가입 (롤백) — 계정이 없으면 생략
        const groupResults: { group: string; success: boolean; error?: string }[] = [];
        if (!accountMissing) {
          const activeGroups = await getTeacherGroups();
          for (const groupEmail of activeGroups) {
            try {
              await addGroupMember(groupEmail, teacherEmail);
              groupResults.push({ group: groupEmail, success: true });
            } catch (gErr: any) {
              groupResults.push({ group: groupEmail, success: false, error: gErr.message });
            }
          }
        }

        // 1-1. 조직도 프로필 복원 — 전출 등록 시 보관해 둔 원본 그대로 (2026-08-07)
        try {
          const restoreKey = teacherEmail.toLowerCase();
          if (taskData?.archivedProfile) {
            await adminDb.collection("teacher_profiles").doc(restoreKey).set(taskData.archivedProfile);
          }
          if (taskData?.archivedPending) {
            await adminDb.collection("teacher_profiles_pending").doc(restoreKey).set(taskData.archivedPending);
          }
        } catch (profErr: any) {
          console.warn(`전출 취소: 조직도 프로필 복원 실패(계속 진행):`, profErr?.message);
        }
        // 복원도 재조립 대상이다 — 되살린 사람이 색인에 없으면 명단에서 계속 안 보인다.
        await rebuildRosterIndexSafely(teacherEmail, "lifecycle:transfer_cancel");

        // 2. Firestore 전출 큐 삭제
        await taskRef.delete();

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "교사 전출 취소",
          targetEmail: teacherEmail,
          details: accountMissing
            ? `전출 등록 취소 — GWS에 계정이 없어(유령 레코드/기삭제) 큐 정리만 수행.`
            : `전출 등록 취소 완료 및 원래 OU(${restoreOU}) 복귀, 지정 연동 그룹 재가입 처리. 그룹 결과: ${JSON.stringify(groupResults)}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock, groupResults });
      } catch (err: any) {
        return NextResponse.json({ error: `전출 취소 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: submit_teacher_deadline
    // 전출 교사 본인이 백업 완료 예정 기한(최대 1년) 직접 제출
    // ─────────────────────────────────────────
    if (action === "submit_teacher_deadline") {
      const { teacherEmail, deadlineDate } = body;
      if (!teacherEmail || !deadlineDate || !domain) {
        return NextResponse.json({ error: "teacherEmail, deadlineDate, domain은 필수입니다." }, { status: 400 });
      }

      // 1년 초과 여부 검증
      const deadline = new Date(deadlineDate);
      const maxDeadline = new Date();
      maxDeadline.setFullYear(maxDeadline.getFullYear() + 1);
      if (deadline > maxDeadline) {
        return NextResponse.json({ error: "데드라인은 오늘로부터 최대 1년 이내로 설정해야 합니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("teacher_transfer_tasks").doc(domain).collection("teachers").doc(teacherEmail);
        const taskSnap = await taskRef.get();
        if (!taskSnap.exists) {
          return NextResponse.json({ error: "해당 교사의 전출 레코드가 없습니다." }, { status: 404 });
        }

        const getKSTDateString = (d: Date): string => {
          const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
          return kst.toISOString().split("T")[0];
        };
        const deadlineKST = getKSTDateString(deadline);
        const todayKST = getKSTDateString(new Date());

        const isDueNow = deadlineKST <= todayKST;

        if (isDueNow) {
          // 즉시 일시정지 처리 실행!
          await updateUser(teacherEmail, { suspended: true });
          await taskRef.update({
            deadlineDate: deadline,
            deadlineSetAt: new Date(),
            status: "SUSPENDED",
            suspendedAt: new Date(),
          });
          invalidateUserCache();

          await writeAuditLog({
            operatorEmail: teacherEmail,
            operatorName: (taskSnap.data() || {}).name || teacherEmail,
            action: "교사 전출 기한 즉시 정지 처리",
            targetEmail: teacherEmail,
            details: `데드라인 즉시 정지 실행 (설정 날짜: ${deadlineKST})`,
            status: "success",
          });
        } else {
          await taskRef.update({
            deadlineDate: deadline,
            deadlineSetAt: new Date(),
            status: "DEADLINE_SET",
          });

          await writeAuditLog({
            operatorEmail: teacherEmail,
            operatorName: (taskSnap.data() || {}).name || teacherEmail,
            action: "교사 전출 기한 설정",
            targetEmail: teacherEmail,
            details: `데드라인 설정: ${deadlineKST}`,
            status: "success",
          });
        }

        return NextResponse.json({ success: true });
      } catch (err: any) {
        return NextResponse.json({ error: `기한 설정 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: get_student_transfer_status
    // 학생 전출 상태 및 기한 설정 정보 조회
    // ─────────────────────────────────────────
    if (action === "get_student_transfer_status") {
      const { email } = body;
      if (!email || !domain) {
        return NextResponse.json({ error: "이메일과 도메인은 필수입니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("transfer_out_tasks").doc(domain).collection("students").doc(email);
        const snap = await taskRef.get();
        if (!snap.exists) {
          return NextResponse.json({ exists: false });
        }
        return NextResponse.json({ exists: true, task: snap.data() });
      } catch (err: any) {
        return NextResponse.json({ error: `전출 상태 조회 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: submit_student_transfer_deadline
    // 전출/자퇴 학생 본인이 계정 정지 희망 기한 직접 제출
    // ─────────────────────────────────────────
    if (action === "submit_student_transfer_deadline") {
      const { email, deadlineDate } = body;
      if (!email || !deadlineDate || !domain) {
        return NextResponse.json({ error: "email, deadlineDate, domain은 필수입니다." }, { status: 400 });
      }

      try {
        const taskRef = adminDb.collection("transfer_out_tasks").doc(domain).collection("students").doc(email);
        const taskSnap = await taskRef.get();
        if (!taskSnap.exists) {
          return NextResponse.json({ error: "해당 학생의 전출 레코드가 없습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data() || {};
        const deadline = new Date(deadlineDate);
        if (isNaN(deadline.getTime())) {
          return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
        }

        const getKSTDateStr = (d: Date): string => {
          const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
          return kst.toISOString().split("T")[0];
        };

        // maxSuspendDueDate 상한 검증 (없으면 suspendDueDate를 폴백으로)
        // 비교는 KST 날짜 문자열로 — 타임스탬프 직접 비교 시 이른 아침(KST 00~09시) 등록 건에서
        // UI가 제시한 마지노선 당일이 UTC 시각 차이로 거부되는 경계 버그 발생 (Phase 3.5 KST 시차 버그와 동일 계열)
        const maxDueDate = taskData.maxSuspendDueDate
          ? (taskData.maxSuspendDueDate.toDate ? taskData.maxSuspendDueDate.toDate() : new Date(taskData.maxSuspendDueDate))
          : taskData.suspendDueDate
          ? (taskData.suspendDueDate.toDate ? taskData.suspendDueDate.toDate() : new Date(taskData.suspendDueDate))
          : null;

        if (maxDueDate && getKSTDateStr(deadline) > getKSTDateStr(maxDueDate)) {
          return NextResponse.json(
            { error: `선택하신 날짜가 최대 마지노선(${maxDueDate.toLocaleDateString("ko-KR")})을 초과할 수 없습니다.` },
            { status: 400 }
          );
        }

        // 정지 후 삭제 유예기간 (deleteGraceDays) 로드 (기본 7일)
        let deleteGraceDays = 7;
        try {
          const settingsSnap = await adminDb.collection("settings").doc(domain).get();
          if (settingsSnap.exists) {
            deleteGraceDays = Number(settingsSnap.data()?.transferOutSettings?.deleteGraceDays) || 7;
          }
        } catch (_sErr) { /* 폴백 7일 */ }

        const deleteDueDate = new Date(deadline.getTime() + deleteGraceDays * 24 * 60 * 60 * 1000);

        const getKSTDateString = (d: Date): string => {
          const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
          return kst.toISOString().split("T")[0];
        };
        const deadlineKST = getKSTDateString(deadline);
        const todayKST = getKSTDateString(new Date());

        const isDueNow = deadlineKST <= todayKST;

        if (isDueNow) {
          // 과거/당일 제출 시 즉시 일시정지!
          await updateUser(email, { suspended: true });
          await taskRef.update({
            suspendDueDate: deadline,
            deleteDueDate,
            deadlineSetAt: new Date(),
            status: "SUSPENDED",
            suspendedAt: new Date(),
          });
          invalidateUserCache();

          await writeAuditLog({
            operatorEmail: email,
            operatorName: taskData.name || email,
            action: "학생 전출 기한 즉시 정지 처리",
            targetEmail: email,
            details: `학생 셀프 데드라인 즉시 정지 실행 (설정 날짜: ${deadlineKST}, 삭제 예정일: ${deleteDueDate.toLocaleDateString("ko-KR")})`,
            status: "success",
          });
        } else {
          await taskRef.update({
            suspendDueDate: deadline,
            deleteDueDate,
            deadlineSetAt: new Date(),
            status: "DEADLINE_SET",
          });

          await writeAuditLog({
            operatorEmail: email,
            operatorName: taskData.name || email,
            action: "학생 전출 기한 설정",
            targetEmail: email,
            details: `학생 셀프 데드라인 설정: ${deadlineKST} (삭제 예정일: ${deleteDueDate.toLocaleDateString("ko-KR")})`,
            status: "success",
          });
        }

        return NextResponse.json({ success: true });
      } catch (err: any) {
        return NextResponse.json({ error: `기한 설정 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: execute_teacher_ob
    // 교사 명예퇴임: OB 보존실 OU 이동 + 연동 그룹 탈퇴 (계정은 영구 보존)
    // ─────────────────────────────────────────
    if (action === "execute_teacher_ob") {
      const { teacherEmail, teacherName, teachersOBPath } = body;
      if (!teacherEmail || !teachersOBPath) {
        return NextResponse.json({ error: "teacherEmail과 teachersOBPath(OB 보존실 OU 경로)는 필수입니다." }, { status: 400 });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(teacherEmail)) {
        return NextResponse.json({ error: "올바른 이메일 형식이 아닙니다." }, { status: 400 });
      }

      try {
        // 계정 실존 여부 사전 검증
        try {
          await getUser(teacherEmail);
        } catch (uErr: any) {
          return NextResponse.json({ error: `구글 워크스페이스에 존재하지 않는 계정입니다 (${teacherEmail})` }, { status: 404 });
        }

        // 지정 연동 그룹에서 탈퇴
        const activeGroups = await getTeacherGroups();
        const groupResults: { group: string; success: boolean; error?: string }[] = [];
        for (const groupEmail of activeGroups) {
          try {
            await removeGroupMember(groupEmail, teacherEmail);
            groupResults.push({ group: groupEmail, success: true });
          } catch (gErr: any) {
            groupResults.push({ group: groupEmail, success: false, error: gErr.message });
          }
        }

        // OB 보존실 OU로 이동 (계정 active 유지)
        await updateUser(teacherEmail, { orgUnitPath: teachersOBPath });

        // 조직도 프로필 정리 — 명퇴는 취소 액션이 없으므로 보관소 컬렉션으로 이동 (2026-08-07)
        try {
          const profileKey = teacherEmail.toLowerCase();
          const archiveRef = adminDb
            .collection("teacher_profiles_archive").doc(domain || teacherEmail.split("@")[1] || "unknown")
            .collection("profiles").doc(profileKey);
          const profRef = adminDb.collection("teacher_profiles").doc(profileKey);
          const profSnap = await profRef.get();
          if (profSnap.exists) {
            await archiveRef.set({
              ...profSnap.data(),
              archivedAt: Date.now(),
              archivedBy: adminEmail,
              archiveReason: "honorary_retirement",
            });
            await profRef.delete();
          }
          const pendRef = adminDb.collection("teacher_profiles_pending").doc(profileKey);
          if ((await pendRef.get()).exists) await pendRef.delete();
        } catch (profErr: any) {
          console.warn(`명예퇴임: 조직도 프로필 정리 실패(계속 진행):`, profErr?.message);
        }
        // 보관소 이동 + 삭제가 끝난 뒤 한 번만 (비원자 쌍이라 중간에 부르면 반쪽이 색인에 박힌다)
        await rebuildRosterIndexSafely(teacherEmail, "lifecycle:honorary_retirement");

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "교사 명예퇴임 처리",
          targetEmail: teacherEmail,
          details: `OB 보존실(${teachersOBPath})로 OU 이동 및 지정 연동 그룹 탈퇴. 결과: ${JSON.stringify(groupResults)}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock, groupResults });
      } catch (err: any) {
        return NextResponse.json({ error: `명예퇴임 처리 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: join_security_group
    // 교사 최초 로그인 확인 시 GWS 보안그룹들 가입 처리
    // ─────────────────────────────────────────
    if (action === "join_security_group") {
      const { teacherEmail } = body;
      if (!teacherEmail) {
        return NextResponse.json({ error: "teacherEmail은 필수입니다." }, { status: 400 });
      }

      try {
        // 지정된 그룹스 중 보안그룹 속성을 지닌 그룹만 골라 가입
        const activeGroups = await getTeacherGroups();
        const groupResults: { group: string; success: boolean; error?: string }[] = [];
        
        for (const groupEmail of activeGroups) {
          const isSecurity = await checkIsSecurityGroup(groupEmail);
          if (isSecurity) {
            try {
              await addGroupMember(groupEmail, teacherEmail);
              groupResults.push({ group: groupEmail, success: true });
            } catch (gErr: any) {
              groupResults.push({ group: groupEmail, success: false, error: gErr.message });
            }
          }
        }

        await writeAuditLog({
          operatorEmail: "system@portal",
          operatorName: "[자동 연동] 포털 시스템",
          action: "교사 보안그룹 자동 연동",
          targetEmail: teacherEmail,
          details: `교사 최초 포털 로그인 감지로 보안그룹 가입 완료. 결과: ${JSON.stringify(groupResults)}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock, groupResults });
      } catch (err: any) {
        return NextResponse.json({ error: `보안그룹 가입 실패: ${err.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
  }
}
