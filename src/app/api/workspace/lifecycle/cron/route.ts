import { NextRequest, NextResponse } from "next/server";
import { updateUser, deleteUser, invalidateUserCache, listUsersInOUs, sendGmail, sendGoogleChat } from "@/lib/google/workspace";
import { writeAuditLog } from "@/lib/firebase/audit";
import { deleteAuthUserByEmail } from "@/lib/firebase/admin";
import { db } from "@/lib/firebase/config";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
} from "firebase/firestore";

// 이 크론 API는 Vercel Cron 또는 외부 스케줄러(예: Cloud Scheduler)에서
// 매일 0시경 자동으로 호출해야 합니다.
// 임의로 외부에서 호출되는 것을 막기 위해 CRON_SECRET 환경변수로 인증합니다.

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  // 프로덕션에서 CRON_SECRET 미설정 시 실행 자체를 거부 (fail-closed).
  // 이 크론은 계정 일시정지·영구삭제를 실행하고 mockToday로 기준 날짜까지 바꿀 수 있으므로,
  // 시크릿 없이 열려 있으면 외부인이 삭제를 조기 발동시킬 수 있다.
  if (process.env.NODE_ENV === "production" && !CRON_SECRET) {
    console.error("[Cron] CRON_SECRET이 설정되지 않아 실행을 거부합니다.");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  // 인증 확인 (CRON_SECRET 설정이 없는 개발 환경에서는 허용)
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const mockToday = searchParams.get("mockToday");
  const testEmailFilter = searchParams.get("testEmailFilter");
  const now = mockToday ? new Date(mockToday) : new Date();

  // KST (UTC+9) 날짜 기준 문자열 YYYY-MM-DD 구하는 헬퍼
  const getKSTDateString = (d: Date): string => {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().split("T")[0];
  };

  const addDaysToKSTDateString = (dateStr: string, days: number): string => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  };

  const todayKSTStr = getKSTDateString(now);

  const results = {
    suspended: [] as string[],
    deleted: [] as string[],
    warned: [] as string[],
    errors: [] as { email: string; error: string }[],
    processedAt: now.toISOString(),
    debug: [] as string[],
  };
  const dbg = (msg: string) => { results.debug.push(msg); console.log(msg); };

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

        if (task.status === "OU_MOVED" && task.suspendDueDate) {
          const suspendDue = task.suspendDueDate.toDate
            ? task.suspendDueDate.toDate()
            : new Date(task.suspendDueDate);
          const suspendDueStr = getKSTDateString(suspendDue);

          if (suspendDueStr <= todayKSTStr) {
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

        else if (task.status === "SUSPENDED" && task.deleteDueDate) {
          const deleteDue = task.deleteDueDate.toDate
            ? task.deleteDueDate.toDate()
            : new Date(task.deleteDueDate);
          const deleteDueStr = getKSTDateString(deleteDue);

          if (deleteDueStr <= todayKSTStr) {
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

      // ─────────────────────────────────────────────────────────────
      // [졸업생 생애주기 스케줄링 및 알림 처리]
      // ─────────────────────────────────────────────────────────────
      try {
        const settingsRef = doc(db, "settings", domain);
        const settingsSnap = await getDoc(settingsRef);
        dbg(`[Grad] settings 로드: exists=${settingsSnap.exists()}, domain=${domain}`);
        
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
          const gradSettings = sData.graduationSettings;
          const studentOUMappings = sData.ouMapping?.students || {};
          const grade3OU = studentOUMappings[3] || studentOUMappings["3"] || "";
          const graduatesOU = sData.ouMapping?.graduates || "";
          dbg(`[Grad] gradSettings=${JSON.stringify(gradSettings)}, grade3OU=${grade3OU}, graduatesOU=${graduatesOU}`);

          // 1. 12월 ~ 6월 사이 졸업 시즌인 경우: 3학년 및 졸업생 대상자 자동 수집/등록 (동기화)
          const currentMonth = now.getMonth(); // 0: Jan, 11: Dec
          const isGraduationSeason = currentMonth === 11 || currentMonth < 6;
          dbg(`[Grad] now=${now.toISOString()}, currentMonth=${currentMonth}, isGraduationSeason=${isGraduationSeason}, isMonday=${now.getDay()===1}`);

          if (isGraduationSeason && (grade3OU || graduatesOU)) {
            try {
              const targetOUs = [grade3OU, graduatesOU].filter(Boolean);
              dbg(`[Grad] 동기화 대상 OUs: ${JSON.stringify(targetOUs)}`);
              const wsStudents = await listUsersInOUs(targetOUs);
              dbg(`[Grad] GWS에서 가져온 학생 수: ${wsStudents.length}`);
              
              for (const student of wsStudents) {
                const email = student.primaryEmail;
                if (!email) continue;
                
                // 테스트용 필터가 지정된 경우, 필터에 부합하는 이메일만 동기화 대상으로 취급
                if (testEmailFilter && !email.toLowerCase().includes(testEmailFilter.toLowerCase())) {
                  continue;
                }
                dbg(`[Grad] 동기화 대상: ${email}`);
                
                const taskRef = doc(db, "graduation_tasks", domain, "students", email);
                const taskSnap = await getDoc(taskRef);
                
                if (!taskSnap.exists()) {
                  const name = student.name?.givenName || student.name || "학생";
                  const studentId = student.name?.familyName || "";
                  
                  await setDoc(taskRef, {
                    email,
                    name,
                    studentId,
                    originalOU: student.orgUnitPath || "/학생",
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
                  });
                  dbg(`[Grad] 새 태스크 등록: ${email}`);
                } else {
                  dbg(`[Grad] 이미 등록됨: ${email}, status=${taskSnap.data()?.status}`);
                }
              }
            } catch (syncErr: any) {
              dbg(`[Grad] ❌ 동기화 실패 (${domain}): ${syncErr.message}`);
            }
          } else {
            dbg(`[Grad] 동기화 스킵 — isGraduationSeason=${isGraduationSeason}, grade3OU=${grade3OU}, graduatesOU=${graduatesOU}`);
          }

          // 2. 일정별 자동 제어 및 미동의 알림 독촉 발송
          const activeGradSettings = gradSettings || { suspendDate: "06-01", deleteDate: "06-30" };
          if (activeGradSettings) {
            const suspendDateStr = activeGradSettings.suspendDate; // MM-DD or YYYY-MM-DD
            const deleteDateStr = activeGradSettings.deleteDate;   // MM-DD or YYYY-MM-DD

            const parseMMDD = (val: string) => {
              if (!val) return null;
              // 기존 YYYY-MM-DD 형식 대응
              if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                const date = new Date(val);
                date.setHours(0, 0, 0, 0);
                return date;
              }
              // MM-DD 형식 대응 (매년 반복 스케줄링)
              if (/^\d{2}-\d{2}$/.test(val)) {
                const [mStr, dStr] = val.split("-");
                const m = parseInt(mStr);
                const d = parseInt(dStr);
                if (isNaN(m) || isNaN(d)) return null;

                const currentYear = now.getFullYear();
                const currentMonth = now.getMonth(); // 0: Jan, 11: Dec

                // 졸업 일정(정지·삭제일)은 항상 상반기(1~6월)에 위치함.
                // 현재가 7월 이후(currentMonth > 5)이면 올해 상반기 날짜는 이미 지났으므로
                // 다음 졸업 사이클(내년 상반기)의 날짜로 계산한다.
                // 예) 2026-11-30 기준 → "06-01" → 2027-06-01 (내년)
                // 예) 2027-03-15 기준 → "06-01" → 2027-06-01 (올해)
                // 예) 2027-06-05 기준 → "06-01" → 2027-06-01 (올해, 이미 지남 → 정지 실행)
                let targetYear = currentYear;
                if (currentMonth > 5) { // 7월(6) 이후이면 내년 사이클
                  targetYear = currentYear + 1;
                }
                const targetDate = new Date(targetYear, m - 1, d);
                targetDate.setHours(0, 0, 0, 0);
                return targetDate;
              }
              return null;
            };

            const suspendDue = parseMMDD(suspendDateStr);
            const deleteDue = parseMMDD(deleteDateStr);

            // 졸업생 OU에 현재 속해있는 학생 목록 조회 (졸업생과 일반 3학년 구분용)
            let graduatesEmailSet = new Set<string>();
            if (graduatesOU) {
              try {
                const gradUsers = await listUsersInOUs([graduatesOU]);
                graduatesEmailSet = new Set(gradUsers.map(u => u.primaryEmail?.toLowerCase()));
              } catch (err: any) {
                console.warn(`[Cron] 졸업생 OU 사용자 조회 실패:`, err.message);
              }
            }

            const isMonday = now.getDay() === 1;
            const gradTasksCol = collection(db, "graduation_tasks", domain, "students");
            const gradTasksSnap = await getDocs(gradTasksCol);
            dbg(`[Grad] graduation_tasks 총 ${gradTasksSnap.size}개, isMonday=${isMonday}`);

            for (const sDoc of gradTasksSnap.docs) {
              const task = sDoc.data();
              const email = task.email;
              if (!email) continue;

              // 테스트용 필터가 지정된 경우, 필터에 부합하지 않는 계정은 시뮬레이션 및 알림 대상에서 제외
              if (testEmailFilter && !email.toLowerCase().includes(testEmailFilter.toLowerCase())) {
                continue;
              }

              const isGraduate = graduatesEmailSet.has(email.toLowerCase());
              dbg(`[Grad] 처리 중: ${email}, status=${task.status}, isGraduate=${isGraduate}, isGraduationSeason=${isGraduationSeason}, isMonday=${isMonday}`);
              if (task.status !== "PENDING") { dbg(`[Grad] → SKIP (status=${task.status})`); }

              // ── A. 미동의 알림 독촉 발송 ──
              if (task.status === "PENDING") {
                // 졸업생 OU에 있는 학생 → 매일 발송
                // 일반 3학년 학생   → 졸업 시즌(12월~6월) 내 매주 월요일에만 발송
                const shouldAlert = isGraduate || (isGraduationSeason && isMonday);
                dbg(`[Grad] shouldAlert 상세: isGraduate=${isGraduate}, isGraduationSeason=${isGraduationSeason}, isMonday=${isMonday} → shouldAlert=${shouldAlert}`);

                if (shouldAlert) {
                  try {
                    const name = task.name || "학생";
                    const suspendFmt = suspendDue ? suspendDue.toLocaleDateString("ko-KR") : "지정일";
                    const deleteFmt = deleteDue ? deleteDue.toLocaleDateString("ko-KR") : "지정일";

                    const portalOrigin = new URL(req.url).origin;
                    const portalUrl = `${portalOrigin}/student-portal`;

                    let emailSubject = activeGradSettings.emailTemplateSubject || "[중요] 구글 워크스페이스 계정 삭제 사전 안내 — 안내 확인 서명이 필요합니다";
                    let emailBody = activeGradSettings.emailTemplateBody || `안녕하세요, {name}님.

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

효명고등학교 드림`;
                    let chatBody = activeGradSettings.chatTemplateBody || `📢 *[효명고등학교 구글 계정 삭제 사전 안내]*

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
  → https://gw.googleforeducation.org/관리하기/학년을-마무리-하며-할-일/졸업생을-위한-안내자료`;

                    const replaceVars = (txt: string) =>
                      txt
                        .replace(/\{name\}/g, name)
                        .replace(/\{email\}/g, email)
                        .replace(/\{suspendDate\}/g, suspendFmt)
                        .replace(/\{deleteDate\}/g, deleteFmt)
                        .replace(/\{portalUrl\}/g, portalUrl);

                    emailSubject = replaceVars(emailSubject);
                    emailBody = replaceVars(emailBody);
                    chatBody = replaceVars(chatBody);

                    // Gmail 발송
                    const mailSender = process.env.GOOGLE_WORKSPACE_SENDER_EMAIL || process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL || "hmnotice@hmh.or.kr";
                    dbg(`[Grad] 메일 발송 시도: ${mailSender} → ${email}`);
                    try {
                      await sendGmail(mailSender, email, emailSubject, emailBody);
                      dbg(`[Grad] ✅ 메일 발송 성공: ${email}`);
                    } catch (mailErr: any) {
                      dbg(`[Grad] ❌ 메일 발송 실패 (${email}): ${mailErr.message}`);
                    }

                    // Chat 발송
                    dbg(`[Grad] 챗 발송 시도: ${email}`);
                    try {
                      await sendGoogleChat(email, chatBody);
                      dbg(`[Grad] ✅ 챗 발송 성공: ${email}`);
                    } catch (chatErr: any) {
                      dbg(`[Grad] ❌ 챗 발송 실패 (${email}): ${chatErr.message}`);
                    }

                    // DB 알림 카운트 업데이트
                    await updateDoc(doc(db, "graduation_tasks", domain, "students", email), {
                      warnedCount: (task.warnedCount || 0) + 1,
                      lastWarnedAt: new Date(),
                    });
                    results.warned.push(email);
                  } catch (alertErr: any) {
                    dbg(`[Grad] ❌ 독촉 알림 중 에러 (${email}): ${alertErr.message}`);
                  }
                }
              }

              // ── B. 계정 자동 일시정지 (suspendDate 도래 시) ──
              const suspendDueStr = suspendDue ? getKSTDateString(suspendDue) : null;
              const deleteDueStr = deleteDue ? getKSTDateString(deleteDue) : null;

              if ((task.status === "PENDING" || task.status === "CONSENTED") && suspendDueStr && suspendDueStr <= todayKSTStr) {
                try {
                  const suspendFmt = suspendDue ? suspendDue.toLocaleDateString("ko-KR") : "";
                  await updateUser(email, { suspended: true });
                  await updateDoc(doc(db, "graduation_tasks", domain, "students", email), {
                    status: "SUSPENDED",
                    suspendedAt: new Date(),
                  });
                  results.suspended.push(email);

                  await writeAuditLog({
                    operatorEmail: "system@cron",
                    operatorName: "[자동 처리] 크론 스케줄러",
                    action: "졸업생 계정 자동 일시정지",
                    targetEmail: email,
                    details: `유예 기간 만료로 계정 자동 정지 처리 (예정일: ${suspendFmt})`,
                    status: "success",
                  });
                } catch (err: any) {
                  results.errors.push({ email, error: `졸업생 자동 정지 실패: ${err.message}` });
                }
              }

              // ── C. 계정 자동 영구삭제 (deleteDate 도래 시) ──
              if (task.status === "SUSPENDED" && deleteDue && deleteDueStr && deleteDueStr <= todayKSTStr) {
                try {
                  const deleteFmt = deleteDue.toLocaleDateString("ko-KR");
                  
                  // Firebase Auth에서도 해당 유저 레코드 동기화 삭제
                  await deleteAuthUserByEmail(email);

                  await deleteUser(email);
                  await updateDoc(doc(db, "graduation_tasks", domain, "students", email), {
                    status: "DELETED",
                    deletedAt: new Date(),
                  });
                  results.deleted.push(email);

                  await writeAuditLog({
                    operatorEmail: "system@cron",
                    operatorName: "[자동 처리] 크론 스케줄러",
                    action: "졸업생 계정 자동 영구삭제",
                    targetEmail: email,
                    details: `유예 기간 만료로 계정 자동 영구삭제 처리 (예정일: ${deleteFmt})`,
                    status: "success",
                  });
                } catch (err: any) {
                  results.errors.push({ email, error: `졸업생 자동 삭제 실패: ${err.message}` });
                }
              }
            }
          }
        }
      } catch (gradErr: any) {
        console.error(`[Cron] 졸업생 생애주기 스케줄링 실패 (${domain}):`, gradErr.message);
      }
    }

    // ─────────────────────────────────────────────
    // 교직원 전출 자동 배치
    // ─────────────────────────────────────────────
    try {
      for (const domain of domains) {
        const teachersCol = collection(db, "teacher_transfer_tasks", domain, "teachers");
        const teachersSnap = await getDocs(teachersCol);

        for (const teacherDoc of teachersSnap.docs) {
          const task = teacherDoc.data();
          const email = task.email as string;
          if (!email) continue;
          if (testEmailFilter && email !== testEmailFilter) continue;

          // ── 미선정 교사 주간 리마인더 발송 (PENDING_DEADLINE 상태)
          if (task.status === "PENDING_DEADLINE") {
            const lastWarned = task.lastWarnedAt
              ? (task.lastWarnedAt.toDate ? task.lastWarnedAt.toDate() : new Date(task.lastWarnedAt))
              : null;
            const sevenDaysAgo = new Date(now);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            if (!lastWarned || lastWarned <= sevenDaysAgo) {
              try {
                const mailSender =
                  process.env.GOOGLE_WORKSPACE_SENDER_EMAIL ||
                  process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL ||
                  "hmnotice@hmh.or.kr";
                const warnedCount = (task.warnedCount || 0) + 1;
                const chatBody = `📢 *[효명고등학교 - 데이터 백업 기한 설정 안내 ${warnedCount}차]*\n\n안녕하세요, *${task.name}*님.\n아직 데이터 백업 기한을 설정하지 않으셨습니다.\n\n아래 주소에서 기한을 직접 설정해 주세요:\n→ ${process.env.NEXT_PUBLIC_BASE_URL || "https://admin.hmh.or.kr"}/admin/transfer-deadline\n\n설정 기한은 최대 1년 이내로 지정 가능합니다.`;
                await sendGoogleChat(email, chatBody);
                await updateDoc(doc(db, "teacher_transfer_tasks", domain, "teachers", email), {
                  warnedCount,
                  lastWarnedAt: new Date(),
                });
                results.warned.push(email);
                dbg(`[교사 리마인더] ${email} — ${warnedCount}차 알림 발송 완료`);
              } catch (wErr: any) {
                results.errors.push({ email, error: `교사 리마인더 발송 실패: ${wErr.message}` });
              }
            }
          }

          // ── 데드라인 도달 시 계정 일시정지 (DEADLINE_SET 또는 PENDING_DEADLINE 상태 모두 대응)
          if ((task.status === "DEADLINE_SET" || task.status === "PENDING_DEADLINE") && task.deadlineDate) {
            const deadline = task.deadlineDate.toDate
              ? task.deadlineDate.toDate()
              : new Date(task.deadlineDate);
            const deadlineStr = getKSTDateString(deadline);

            if (deadlineStr <= todayKSTStr) {
              try {
                await updateUser(email, { suspended: true });
                await updateDoc(doc(db, "teacher_transfer_tasks", domain, "teachers", email), {
                  status: "SUSPENDED",
                  suspendedAt: new Date(),
                });
                results.suspended.push(email);
                dbg(`[교사 자동 일시정지] ${email} — 데드라인(${deadline.toLocaleDateString("ko-KR")}) 도달로 계정 정지`);
                await writeAuditLog({
                  operatorEmail: "system@cron",
                  operatorName: "[자동 처리] 크론 스케줄러",
                  action: "교사 전출 계정 자동 일시정지",
                  targetEmail: email,
                  details: `데드라인(${deadline.toLocaleDateString("ko-KR")}) 경과로 GWS 계정 일시정지 처리`,
                  status: "success",
                });
              } catch (sErr: any) {
                results.errors.push({ email, error: `교사 자동 일시정지 실패: ${sErr.message}` });
              }
            }
          }

          // ── 일시정지 후 30일 경과 시 영구삭제 (SUSPENDED → DELETED)
          if (task.status === "SUSPENDED" && task.suspendedAt) {
            const suspendedAt = task.suspendedAt.toDate
              ? task.suspendedAt.toDate()
              : new Date(task.suspendedAt);
            const suspendedAtStr = getKSTDateString(suspendedAt);
            const deleteAfterStr = addDaysToKSTDateString(suspendedAtStr, 30);

            if (deleteAfterStr <= todayKSTStr) {
              try {
                await deleteAuthUserByEmail(email);
                await deleteUser(email);
                await updateDoc(doc(db, "teacher_transfer_tasks", domain, "teachers", email), {
                  status: "DELETED",
                  deletedAt: new Date(),
                });
                results.deleted.push(email);
                dbg(`[교사 영구삭제] ${email} — 일시정지 후 30일 경과로 계정 영구 삭제`);
                await writeAuditLog({
                  operatorEmail: "system@cron",
                  operatorName: "[자동 처리] 크론 스케줄러",
                  action: "교사 전출 계정 자동 영구삭제",
                  targetEmail: email,
                  details: `일시정지 후 30일 경과 (일시정지: ${suspendedAt.toLocaleDateString("ko-KR")})로 GWS 계정 및 Firebase Auth 영구 삭제`,
                  status: "success",
                });
              } catch (dErr: any) {
                results.errors.push({ email, error: `교사 자동 영구삭제 실패: ${dErr.message}` });
              }
            }
          }
        }
      }
    } catch (teacherCronErr: any) {
      console.error("[Cron] 교사 전출 배치 처리 실패:", teacherCronErr.message);
    }

    console.log(`[Cron] 자동 처리 완료 - 정지: ${results.suspended.length}명, 삭제: ${results.deleted.length}명, 오류: ${results.errors.length}건`);


    return NextResponse.json({
      success: true,
      processedAt: results.processedAt,
      suspended: results.suspended,
      deleted: results.deleted,
      warned: results.warned,
      errors: results.errors,
      debug: results.debug,
    });
  } catch (err: any) {
    console.error("[Cron] 자동 처리 중 오류 발생:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
