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
  invalidateUserCache,
  isMock,
} from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

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

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
  }
}
