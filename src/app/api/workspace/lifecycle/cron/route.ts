import { NextRequest, NextResponse } from "next/server";
import { updateUser, deleteUser, invalidateUserCache } from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit";
import { db } from "@/lib/firebase/config";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";

// 이 크론 API는 Vercel Cron 또는 외부 스케줄러(예: Cloud Scheduler)에서
// 매일 0시경 자동으로 호출해야 합니다.
// 임의로 외부에서 호출되는 것을 막기 위해 CRON_SECRET 환경변수로 인증합니다.

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  // 인증 확인 (CRON_SECRET 설정이 없는 개발 환경에서는 허용)
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  // 오늘 0시 기준 (한국 표준시 KST = UTC+9 기준으로 0시를 UTC로 환산)
  // Vercel 서버는 UTC 기준으로 동작하므로, KST 0시 = 전날 UTC 15:00
  // 단순화를 위해 "현재 시각 기준으로 예정일이 지났으면 처리" 방식으로 구현
  // → 크론이 KST 0시 이후에 호출되면 자동으로 정확하게 처리됨
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0); // 실행 당일 0시 기준

  const results = {
    suspended: [] as string[],
    deleted: [] as string[],
    errors: [] as { email: string; error: string }[],
    processedAt: now.toISOString(),
  };

  try {
    // 모든 도메인의 전출 태스크를 순회
    // transfer_out_tasks/{domain}/students 구조에서 getDocs로 조회
    // 주의: collectionGroup은 Firebase Admin SDK에서만 완전 지원
    // 클라이언트 SDK 방식으로 구현 (도메인 목록은 settings 컬렉션에서 가져옴)
    const settingsSnap = await getDocs(collection(db, "settings"));
    const domains = settingsSnap.docs.map((d) => d.id);

    for (const domain of domains) {
      const studentsCol = collection(db, "transfer_out_tasks", domain, "students");
      const studentsSnap = await getDocs(studentsCol);

      for (const studentDoc of studentsSnap.docs) {
        const task = studentDoc.data();
        const email = task.email as string;

        if (!email) continue;

        // ── 일시정지 처리: 상태가 OU_MOVED이고 suspendDueDate가 오늘 0시 이전인 경우
        if (task.status === "OU_MOVED" && task.suspendDueDate) {
          const suspendDue = task.suspendDueDate.toDate
            ? task.suspendDueDate.toDate()
            : new Date(task.suspendDueDate);

          if (suspendDue <= todayMidnight) {
            try {
              await updateUser(email, { suspended: true });
              await updateDoc(doc(db, "transfer_out_tasks", domain, "students", email), {
                status: "SUSPENDED",
                suspendedAt: new Date(),
              });
              invalidateUserCache();
              await writeAuditLog({
                operatorEmail: "system@cron",
                operatorName: "[자동 처리] 크론 스케줄러",
                action: "전출/자퇴 계정 자동 일시정지",
                targetEmail: email,
                details: `유예 기간 만료로 계정 자동 정지 처리 (예정일: ${suspendDue.toLocaleDateString("ko-KR")})`,
                status: "success",
              });
              results.suspended.push(email);
            } catch (err: any) {
              results.errors.push({ email, error: `정지 실패: ${err.message}` });
            }
          }
        }

        // ── 영구삭제 처리: 상태가 SUSPENDED이고 deleteDueDate가 오늘 0시 이전인 경우
        else if (task.status === "SUSPENDED" && task.deleteDueDate) {
          const deleteDue = task.deleteDueDate.toDate
            ? task.deleteDueDate.toDate()
            : new Date(task.deleteDueDate);

          if (deleteDue <= todayMidnight) {
            try {
              await deleteUser(email);
              // 삭제 완료 태스크는 Firestore에서 제거 (감사 로그에 기록되므로 이력 보존 OK)
              await deleteDoc(doc(db, "transfer_out_tasks", domain, "students", email));
              invalidateUserCache();
              await writeAuditLog({
                operatorEmail: "system@cron",
                operatorName: "[자동 처리] 크론 스케줄러",
                action: "전출/자퇴 계정 자동 영구삭제",
                targetEmail: email,
                details: `유예 기간 만료로 계정 자동 영구삭제 처리 (예정일: ${deleteDue.toLocaleDateString("ko-KR")})`,
                status: "success",
              });
              results.deleted.push(email);
            } catch (err: any) {
              results.errors.push({ email, error: `삭제 실패: ${err.message}` });
            }
          }
        }
        // ── 레거시 정리: 이미 DELETED 상태로 저장된 구버전 문서 삭제
        else if ((task.status as string) === "DELETED") {
          try {
            await deleteDoc(doc(db, "transfer_out_tasks", domain, "students", email));
            console.log(`[Cron] 레거시 DELETED 문서 정리: ${email}`);
          } catch (err: any) {
            console.warn(`[Cron] 레거시 문서 정리 실패 (${email}):`, err.message);
          }
        }
      }
    }

    console.log(`[Cron] 자동 처리 완료 - 정지: ${results.suspended.length}명, 삭제: ${results.deleted.length}명, 오류: ${results.errors.length}건`);

    return NextResponse.json({
      success: true,
      processedAt: results.processedAt,
      suspended: results.suspended,
      deleted: results.deleted,
      errors: results.errors,
    });
  } catch (err: any) {
    console.error("[Cron] 자동 처리 중 오류 발생:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
