import { NextRequest, NextResponse } from "next/server";
import {
  createOrgunit,
  updateOrgunit,
  listOrgunits,
  createUser,
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
import { writeAuditLog } from "@/lib/firebase/audit";
import { deleteAuthUserByEmail, verifyAuthAccess } from "@/lib/firebase/admin";
import { db } from "@/lib/firebase/config";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, operatorEmail, operatorName, domain } = body;

    // ─────────────────────────────────────────
    // 🔐 서버 사이드 인증 가드
    // 전출 교사가 본인 데드라인을 제출하는 액션은 일반 교사도 허용, 나머지는 수퍼어드민 전용
    // ─────────────────────────────────────────
    const TEACHER_ALLOWED_ACTIONS = ["submit_teacher_deadline", "get_teacher_transfer_status"];
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

      const results = await Promise.allSettled(
        students.map(async (s: any) => {
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
          };
        })
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

      const results = await Promise.allSettled(
        promotions.map(async (p: any) => {
          await updateUser(p.email, { lastName: p.newStudentId });
          return { email: p.email, newStudentId: p.newStudentId };
        })
      );

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
          const logsCol = collection(db, "promotion_logs", domain, "batches");
          await addDoc(logsCol, {
            createdAt: serverTimestamp(),
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

      const results = await Promise.allSettled(
        graduateEmails.map((email: string) =>
          updateUser(email, { lastName: warnFamilyName, firstName: warnGivenName })
        )
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

      const results = await Promise.allSettled(
        graduateEmails.map((email: string) => deleteUser(email))
      );

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

      // 1. 설정에서 전출/자퇴자용 OU 경로 조회
      let transferOutOU = "/학생/전출및자퇴";
      let suspendGraceDays = 7;
      let deleteGraceDays = 30;

      if (domain) {
        const settingsSnap = await getDoc(doc(db, "settings", domain));
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
          if (sData.ouMapping?.transferOut) {
            transferOutOU = sData.ouMapping.transferOut;
          }
          if (sData.transferOutSettings) {
            suspendGraceDays = Number(sData.transferOutSettings.suspendGraceDays) || 7;
            deleteGraceDays = Number(sData.transferOutSettings.deleteGraceDays) || 30;
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

      // 4. Firestore에 전출 진행 태스크 등록
      const now = new Date();
      const suspendDueDate = new Date(now.getTime() + suspendGraceDays * 24 * 60 * 60 * 1000);
      const deleteDueDate = new Date(suspendDueDate.getTime() + deleteGraceDays * 24 * 60 * 60 * 1000);

      const taskRef = doc(db, "transfer_out_tasks", domain || "mock-domain", "students", email);
      const taskData = {
        email,
        name: studentName || "학생",
        studentId: studentId || "-",
        originalOU: originalOU || "/학생",
        originalGroups,
        status: "OU_MOVED",
        registeredAt: now,
        suspendDueDate,
        deleteDueDate,
        suspendedAt: null,
        deletedAt: null,
      };
      await setDoc(taskRef, taskData);

      // 5. Gmail 발송 (설정에 저장된 템플릿 사용)
      try {
        // 설정에서 이메일 제목/본문 템플릿 로드
        let emailSubject = "[안내] 전출/자퇴로 인한 구글 워크스페이스 계정 정지 및 데이터 백업 안내";
        let emailBody = `[효명고등학교 계정관리시스템]\n\n${studentName}님의 전출/자퇴 처리에 따른 구글 워크스페이스 계정 정지 및 데이터 백업 안내입니다.\n\n■ 계정 일시정지 예정일: ${suspendDueDate.toLocaleDateString("ko-KR")}\n■ 계정 영구삭제 예정일: ${deleteDueDate.toLocaleDateString("ko-KR")}\n\n계정이 일시정지되면 모든 구글 서비스 이용이 차단되므로, 정지 예정일 전까지 중요 데이터를 반드시 백업해 주세요.\n\n- 개인 기기로 데이터 다운로드 가이드: https://www.iorad.com/player/1765417/--------------#trysteps-1\n- 타 구글 계정으로 데이터 전송 가이드: https://www.iorad.com/player/1813583/GW---------------------#trysteps-1\n- 구글 테이크아웃 바로가기: https://takeout.google.com\n\n감사합니다.`;

        if (domain) {
          const settingsSnap = await getDoc(doc(db, "settings", domain));
          if (settingsSnap.exists()) {
            const sData = settingsSnap.data();
            if (sData.transferOutSettings?.emailTemplateSubject) {
              emailSubject = sData.transferOutSettings.emailTemplateSubject;
            }
            if (sData.transferOutSettings?.emailTemplateBody) {
              // 템플릿 변수 치환
              emailBody = sData.transferOutSettings.emailTemplateBody
                .replace(/\{name\}/g, studentName || "학생")
                .replace(/\{email\}/g, email)
                .replace(/\{suspendDate\}/g, suspendDueDate.toLocaleDateString("ko-KR"))
                .replace(/\{deleteDate\}/g, deleteDueDate.toLocaleDateString("ko-KR"))
                .replace(/\{suspendGraceDays\}/g, String(suspendGraceDays))
                .replace(/\{deleteGraceDays\}/g, String(deleteGraceDays));
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
        let chatBody = `📢 [효명고등학교 계정관리시스템]\n${studentName || "학생"}님의 전출/자퇴 처리에 따라 사용 중이던 학교 계정(${email})이 ${suspendDueDate.toLocaleDateString("ko-KR")}에 일시정지 및 ${deleteDueDate.toLocaleDateString("ko-KR")}에 영구 삭제될 예정입니다.\n\n아래 튜토리얼 가이드를 참고하여 중요한 자료는 그 전까지 반드시 개인 기기로 다운로드하거나 타 계정으로 전송하여 백업해 주시기 바랍니다.\n- 데이터 다운로드 가이드: https://www.iorad.com/player/1765417/--------------#trysteps-1\n- 타 계정 전송 가이드: https://www.iorad.com/player/1813583/GW---------------------#trysteps-1\n- 구글 테이크아웃: https://takeout.google.com`;

        if (domain) {
          const settingsSnap2 = await getDoc(doc(db, "settings", domain));
          if (settingsSnap2.exists()) {
            const sData2 = settingsSnap2.data();
            if (sData2.transferOutSettings?.chatTemplateBody) {
              chatBody = sData2.transferOutSettings.chatTemplateBody
                .replace(/\{name\}/g, studentName || "학생")
                .replace(/\{email\}/g, email)
                .replace(/\{suspendDate\}/g, suspendDueDate.toLocaleDateString("ko-KR"))
                .replace(/\{deleteDate\}/g, deleteDueDate.toLocaleDateString("ko-KR"))
                .replace(/\{suspendGraceDays\}/g, String(suspendGraceDays))
                .replace(/\{deleteGraceDays\}/g, String(deleteGraceDays));
            }
          }
        }

        await sendGoogleChat(email, chatBody);
        console.log(`[Chat] 전출/자퇴 안내 챗 DM 발송 완료 → ${email}`);
      } catch (chatErr: any) {
        // 챗 발송 실패도 전체 프로세스를 중단하지 않음 (경고만 기록)
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
        
        const taskRef = doc(db, "transfer_out_tasks", domain || "mock-domain", "students", email);
        await updateDoc(taskRef, {
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
        const taskRef = doc(db, "transfer_out_tasks", domain || "mock-domain", "students", email);
        await deleteDoc(taskRef);

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
        const taskRef = doc(db, "transfer_out_tasks", domain || "mock-domain", "students", email);
        const taskSnap = await getDoc(taskRef);
        
        if (!taskSnap.exists()) {
          return NextResponse.json({ error: "해당 학생의 전출 처리 기록이 존재하지 않습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data();
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
        await deleteDoc(taskRef);

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
        const settingsSnap = await getDoc(doc(db, "settings", domain));
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
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
        for (const student of students) {
          const email = student.primaryEmail;
          if (!email) continue;

          try {
            const taskRef = doc(db, "graduation_tasks", domain, "students", email);
            const taskSnap = await getDoc(taskRef);

            const name = student.name?.givenName || student.name || "학생";
            const studentId = student.name?.familyName || ""; // familyName에 학번 저장 관례

            if (!taskSnap.exists()) {
              // 최초 등록 시 구글 계정 일시정지 상태에 따라 초기 상태 지정
              await setDoc(taskRef, {
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
              results.added++;
            } else {
              // 이미 존재하는 졸업생 태스크의 경우, 구글의 일시정지 상태와 동기화
              const task = taskSnap.data();
              const isGwsSuspended = !!student.suspended;
              const isDbSuspended = task.status === "SUSPENDED";

              if (isGwsSuspended !== isDbSuspended) {
                if (isGwsSuspended) {
                  // GWS에선 정지되었으나 DB 상태가 정지가 아니면 정지로 변경
                  await updateDoc(taskRef, {
                    status: "SUSPENDED",
                    suspendedAt: new Date(),
                  });
                } else {
                  // GWS에선 정지 해제되었으나 DB 상태가 여전히 정지이면 원래 상태로 변경
                  const originalStatus = task.consentSubmitted ? "CONSENTED" : "PENDING";
                  await updateDoc(taskRef, {
                    status: originalStatus,
                    suspendedAt: null,
                  });
                }
              }
              results.skipped++;
            }
          } catch (studentErr) {
            console.error(`학생 등록 중 오류 (${email}):`, studentErr);
            results.errors++;
          }
        }

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

        const studentsCol = collection(db, "graduation_tasks", domain, "students");
        const snap = await getDocs(studentsCol);
        
        let deletedCount = 0;
        for (const sDoc of snap.docs) {
          const task = sDoc.data();
          // 테스트용 학생은 제외하고 실제 동기화된 일반 학생 데이터만 삭제
          if (!task.isTest && task.originalOU !== "/학생/테스트") {
            await deleteDoc(doc(db, "graduation_tasks", domain, "students", sDoc.id));
            deletedCount++;
          }
        }

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
        const settingsRef = doc(db, "settings", domain);
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists()) {
          await setDoc(settingsRef, {
            ...settingsSnap.data(),
            graduationSettings,
            updatedAt: new Date(),
          });
        } else {
          await setDoc(settingsRef, {
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
        const taskRef = doc(db, "graduation_tasks", domain, "students", email);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) {
          return NextResponse.json({ error: "졸업 관리 대상자 명단에 이메일이 존재하지 않습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data();

        // 1. 별도 보관용 컬렉션 graduation_consents에 영구 보존용 동의서(서명 포함) 저장
        const consentRef = doc(db, "graduation_consents", `${domain}_${email}`);
        await setDoc(consentRef, {
          email,
          domain,
          name: taskData.name || "학생",
          studentId: taskData.studentId || "",
          consentedAt: new Date(),
          signature: signature || "서명 누락",
          expiresAt: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000), // 3년 후 만료
        });

        // 2. 기존 graduation_tasks의 개별 학생 타스크 상태 업데이트
        await updateDoc(taskRef, {
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
        const taskRef = doc(db, "graduation_tasks", domain, "students", email);
        const taskSnap = await getDoc(taskRef);

        if (!taskSnap.exists()) {
          return NextResponse.json({ error: "졸업 대상자 기록이 존재하지 않습니다." }, { status: 404 });
        }

        const taskData = taskSnap.data();
        const isSubmit = !!consentSubmitted;

        // 1. 수동 동의 처리 시 graduation_consents 보존 레코드도 생성/삭제 동기화
        const consentRef = doc(db, "graduation_consents", `${domain}_${email}`);
        if (isSubmit) {
          await setDoc(consentRef, {
            email,
            domain,
            name: taskData.name || "학생",
            studentId: taskData.studentId || "",
            consentedAt: new Date(),
            signature: "대리 동의 (관리자 승인)",
            expiresAt: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000), // 3년 후 만료
          });
        } else {
          await deleteDoc(consentRef);
        }

        // 2. 태스크 상태 업데이트
        await updateDoc(taskRef, {
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

        const studentsCol = collection(db, "graduation_tasks", domain, "students");
        const snap = await getDocs(studentsCol);
        const results = { suspended: 0, skipped: 0, errors: 0 };

        for (const sDoc of snap.docs) {
          const task = sDoc.data();
          const email = task.email;
          if (task.status === "PENDING" || task.status === "CONSENTED") {
            try {
              await updateUser(email, { suspended: true });
              await updateDoc(doc(db, "graduation_tasks", domain, "students", email), {
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
        }

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

        const studentsCol = collection(db, "graduation_tasks", domain, "students");
        const snap = await getDocs(studentsCol);
        const results = { deleted: 0, skipped: 0, errors: 0 };

        for (const sDoc of snap.docs) {
          const task = sDoc.data();
          const email = task.email;
          if (task.status === "SUSPENDED") {
            try {
              // Firebase Auth에서도 해당 졸업생 유저 레코드 동기화 삭제
              await deleteAuthUserByEmail(email);

              await deleteUser(email);
              await updateDoc(doc(db, "graduation_tasks", domain, "students", email), {
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
        }

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

        const studentsCol = collection(db, "graduation_tasks", domain, "students");
        const snap = await getDocs(studentsCol);
        const results = { restored: 0, skipped: 0, errors: 0 };

        for (const sDoc of snap.docs) {
          const task = sDoc.data();
          const email = task.email;
          if (task.status === "SUSPENDED") {
            try {
              // 1. 구글 워크스페이스 상에서 계정 활성화
              await updateUser(email, { suspended: false });
              
              // 2. 동의 여부에 따라 상태 원복
              const originalStatus = task.consentSubmitted ? "CONSENTED" : "PENDING";
              await updateDoc(doc(db, "graduation_tasks", domain, "students", email), {
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
        }

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
        const taskRef = doc(db, "graduation_tasks", domain, "students", email);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) {
          return NextResponse.json({ error: "졸업 대상자 기록이 존재하지 않습니다." }, { status: 404 });
        }

        const task = taskSnap.data();

        // 1. 구글 워크스페이스 상에서 계정 활성화 (정지 해제)
        await updateUser(email, { suspended: false });

        // 2. 동의 여부에 따라 Firestore 상태 원복
        const originalStatus = task.consentSubmitted ? "CONSENTED" : "PENDING";
        await updateDoc(taskRef, {
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

      try {
        const taskRef = doc(db, "graduation_tasks", domain, "students", email);
        await setDoc(taskRef, {
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
        const taskRef = doc(db, "graduation_tasks", domain, "students", email);
        await deleteDoc(taskRef);

        // 테스트 유저 삭제 시 보관함에 들어간 테스트용 동의 서명 기록도 동시 영구 삭제
        const consentRef = doc(db, "graduation_consents", `${domain}_${email}`);
        await deleteDoc(consentRef);

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
        const taskRef = doc(db, "graduation_tasks", domain, "students", email);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) {
          return NextResponse.json({ error: "학생 기록을 찾을 수 없습니다." }, { status: 404 });
        }
        const task = taskSnap.data();
        
        let suspendFmt = "지정일";
        let deleteFmt = "지정일";
        let emailSubject = "[중요] 구글 워크스페이스 계정 삭제 사전 안내 — 안내 확인 서명이 필요합니다";
        let emailBody = "";
        let chatBody = "";

        const settingsSnap = await getDoc(doc(db, "settings", domain));
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
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

궁금하신 점은 학교 정보부에 문의해 주세요.
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

        await updateDoc(taskRef, {
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
    const DEFAULT_TEACHER_GROUPS = [
      "ts@hmh.or.kr",
      "classroom_teachers@hmh.or.kr",
      "hmhteacher@hmh.or.kr",
      "hmh_teachers@hmh.or.kr",
    ];

    const getTeacherGroups = async (): Promise<string[]> => {
      const classroomTeachersGroup = `classroom_teachers@${domain || "hmh.or.kr"}`;
      if (!domain) return DEFAULT_TEACHER_GROUPS;
      try {
        const settingsSnap = await getDoc(doc(db, "settings", domain));
        if (settingsSnap.exists()) {
          const settings = settingsSnap.data();
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
    // 교사 전출 등록: 지정 연동 그룹 즉시 탈퇴 + Firestore 큐 적재 + 안내 알림 발송
    // ─────────────────────────────────────────
    if (action === "register_teacher_transfer") {
      const { teacherEmail, teacherName } = body;
      if (!teacherEmail || !domain) {
        return NextResponse.json({ error: "교사 이메일과 도메인은 필수 항목입니다." }, { status: 400 });
      }

      try {
        // 지정 연동 그룹 즉시 강제 탈퇴 (보안 즉각 차단)
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

        // Firestore에 전출 작업 등록
        const taskRef = doc(db, "teacher_transfer_tasks", domain, "teachers", teacherEmail);
        await setDoc(taskRef, {
          email: teacherEmail,
          name: teacherName || teacherEmail,
          status: "PENDING_DEADLINE",
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

        const emailSubject = `[중요] 학교 구글 계정 전출 처리 안내 - 데이터 백업 기한을 설정해 주세요`;
        const emailBody = `안녕하세요, ${teacherName || teacherEmail}님.

학교 행정상 선생님의 구글 워크스페이스 계정이 전출 처리되었습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━
📋  조치 사항
━━━━━━━━━━━━━━━━━━━━━━━━━
선생님이 가입되어 있던 교사용 연동 그룹에서 즉시 탈퇴 처리되었습니다.
구글 계정 자체는 아직 유지되고 있으나, 아래 안내에 따라 데이터 백업 기한을 직접 설정하셔야 합니다.

━━━━━━━━━━━━━━━━━━━━━━━━━
📅  기한 설정 방법
━━━━━━━━━━━━━━━━━━━━━━━━━
학교 어드민 시스템에 접속하시면 데이터 백업 완료 후 계정 삭제를 희망하시는 날짜(최대 1년 이내)를 직접 입력하실 수 있습니다.

👉 어드민 시스템 바로가기:
${process.env.NEXT_PUBLIC_BASE_URL || "https://admin.hmh.or.kr"}/admin/transfer-deadline

📦  데이터 이전 및 다운로드 방법:
→ https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4

궁금하신 점은 학교 정보부에 문의해 주세요. 감사합니다.

효명고등학교 드림`;

        const chatBody = `📢 *[효명고등학교 구글 계정 전출 처리 안내]*

안녕하세요, *${teacherName || teacherEmail}*님.
학교 행정상 선생님의 구글 워크스페이스 계정이 전출 처리되었습니다.

*📋  조치 사항*
선생님이 가입되어 있던 교사용 연동 그룹에서 즉시 탈퇴 처리되었습니다.
구글 계정 자체는 아직 유지되고 있으나, 아래 안내에 따라 데이터 백업 기한을 직접 설정하셔야 합니다.

*📅  기한 설정 방법*
학교 어드민 시스템에 접속하시면 데이터 백업 완료 후 계정 삭제를 희망하시는 날짜(최대 1년 이내)를 직접 입력하실 수 있습니다.

👉 어드민 시스템 바로가기:
${process.env.NEXT_PUBLIC_BASE_URL || "https://admin.hmh.or.kr"}/admin/transfer-deadline

*📦  데이터 이전 및 다운로드 방법:*
→ https://gw.googleforeducation.org/%EA%B4%80%EB%A6%AC%ED%95%98%EA%B8%B0/%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%9D%B4%EC%A0%84%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C-%EC%95%88%EB%82%B4

궁금하신 점은 학교 정보부에 문의해 주세요. 감사합니다.`;

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
          details: `연동 그룹 즉시 탈퇴 처리 및 전출 큐 등록. 그룹 결과: ${JSON.stringify(groupResults)}`,
          status: "success",
        });

        return NextResponse.json({ success: true, isMock, groupResults });
      } catch (err: any) {
        return NextResponse.json({ error: `전출 등록 실패: ${err.message}` }, { status: 500 });
      }
    }

    // ─────────────────────────────────────────
    // ACTION: cancel_teacher_transfer
    // 교사 전출 취소: Firestore 큐 삭제 + 지정 연동 그룹 재가입 (롤백)
    // ─────────────────────────────────────────
    if (action === "cancel_teacher_transfer") {
      const { teacherEmail, teacherName } = body;
      if (!teacherEmail || !domain) {
        return NextResponse.json({ error: "교사 이메일과 도메인은 필수 항목입니다." }, { status: 400 });
      }

      try {
        // 0. GWS 계정 일시정지 해제 (활성화)
        await updateUser(teacherEmail, { suspended: false });
        invalidateUserCache();

        // 1. 지정 연동 그룹 재가입 (롤백)
        const activeGroups = await getTeacherGroups();
        const groupResults: { group: string; success: boolean; error?: string }[] = [];
        for (const groupEmail of activeGroups) {
          try {
            await addGroupMember(groupEmail, teacherEmail);
            groupResults.push({ group: groupEmail, success: true });
          } catch (gErr: any) {
            groupResults.push({ group: groupEmail, success: false, error: gErr.message });
          }
        }

        // 2. Firestore 전출 큐 삭제
        const taskRef = doc(db, "teacher_transfer_tasks", domain, "teachers", teacherEmail);
        await deleteDoc(taskRef);

        await writeAuditLog({
          operatorEmail: adminEmail,
          operatorName: adminName,
          action: "교사 전출 취소",
          targetEmail: teacherEmail,
          details: `전출 등록 취소 완료 및 지정된 연동 그룹 재가입 처리. 그룹 결과: ${JSON.stringify(groupResults)}`,
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
        const taskRef = doc(db, "teacher_transfer_tasks", domain, "teachers", teacherEmail);
        const taskSnap = await getDoc(taskRef);
        if (!taskSnap.exists()) {
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
          await updateDoc(taskRef, {
            deadlineDate: deadline,
            deadlineSetAt: new Date(),
            status: "SUSPENDED",
            suspendedAt: new Date(),
          });
          invalidateUserCache();

          await writeAuditLog({
            operatorEmail: teacherEmail,
            operatorName: taskSnap.data().name || teacherEmail,
            action: "교사 전출 기한 즉시 정지 처리",
            targetEmail: teacherEmail,
            details: `데드라인 즉시 정지 실행 (설정 날짜: ${deadlineKST})`,
            status: "success",
          });
        } else {
          await updateDoc(taskRef, {
            deadlineDate: deadline,
            deadlineSetAt: new Date(),
            status: "DEADLINE_SET",
          });

          await writeAuditLog({
            operatorEmail: teacherEmail,
            operatorName: taskSnap.data().name || teacherEmail,
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
    // ACTION: execute_teacher_ob
    // 교사 명예퇴임: OB 보존실 OU 이동 + 연동 그룹 탈퇴 (계정은 영구 보존)
    // ─────────────────────────────────────────
    if (action === "execute_teacher_ob") {
      const { teacherEmail, teacherName, teachersOBPath } = body;
      if (!teacherEmail || !teachersOBPath) {
        return NextResponse.json({ error: "teacherEmail과 teachersOBPath(OB 보존실 OU 경로)는 필수입니다." }, { status: 400 });
      }

      try {
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
