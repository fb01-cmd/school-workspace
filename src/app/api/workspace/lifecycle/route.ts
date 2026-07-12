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
} from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit";
import { db } from "@/lib/firebase/config";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, operatorEmail, operatorName, domain } = body;
    const adminEmail = operatorEmail || "unknown@domain.com";
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

        const senderEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || adminEmail;
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

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
  }
}
