// Phase 8 3단계 — 업무 지시 API (docs/phase8_tasks_spec.md §2~§6)
// 읽기(내 할 일·현황판)는 클라이언트 직독 + firestore.rules — 쓰기는 이 라우트 전용.
// 발송 파이프라인(자격 게이트·그룹 확장·실존 대조·표시 이름)은 memo와 같은 규약.
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import { writeAuditLog } from "@/lib/firebase/audit-server";
import { listGroupMembers, listUsersInOUs } from "@/lib/google/workspace";
import {
  TASK_MAX_FORM_FILES,
  TASK_MAX_RECIPIENTS,
  TASK_DEFAULT_RETENTION_DAYS,
  TaskDoc,
  applyTaskTransition,
  buildSelfTaskDoc,
  canNudge,
  nudgeTargets,
  normalizeSubmissionFileName,
  submissionDoneStatus,
  validateTaskContent,
  validateTaskFileName,
  validateTaskFileSize,
} from "@/lib/tasks/logic";
import {
  createResumableUploadSession,
  ensureTaskFolders,
  getTaskFileMeta,
  grantFolderReader,
  overwriteTaskFile,
  revokeFolderReader,
  uploadTaskFile,
} from "@/lib/tasks/drive";
import { expandGroupEmails, resolveRecipients } from "@/lib/memo/logic";
import { emitNotificationsBatch } from "@/lib/notifications/server";
import { notifyTask } from "@/lib/push/webpush";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse, after } from "next/server";

type TasksAction =
  | "prepare"
  | "form_upload"
  | "form_session_start"
  | "form_session_finish"
  | "send"
  | "self_add"
  | "transition"
  | "submit"
  | "submit_session_start"
  | "submit_session_finish"
  | "nudge"
  | "cancel";

const tasksColRef = (domain: string) =>
  adminDb.collection("tasks").doc(domain).collection("items");

const kstYear = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 4);

async function loadTaskOrNull(domain: string, taskId: string): Promise<(TaskDoc & { id: string }) | null> {
  if (!taskId || taskId.includes("/") || taskId.length > 128) return null;
  const snap = await tasksColRef(domain).doc(taskId).get();
  return snap.exists ? ({ id: snap.id, ...(snap.data() as TaskDoc) }) : null;
}

async function loadProfile(email: string) {
  const snap = await adminDb.collection("teacher_profiles").doc(email).get();
  return snap.exists ? (snap.data() as any) : null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const email = auth.email.trim().toLowerCase();
    const domain = email.split("@")[1] || "hmh.or.kr";

    // 자격 = 승인 역할 + 교직원 조직도 등록 (memo §2 공통 게이트와 동일 — §4 전 교직원 발신)
    const userSnap = await adminDb.collection("users").doc(auth.uid).get();
    const userData = userSnap.data();
    if (!userData || !["teacher", "super_admin"].includes(userData.role)) {
      return NextResponse.json({ error: "업무 기능 사용 권한이 없습니다." }, { status: 403 });
    }
    const myProfile = await loadProfile(email);
    const myDepts = Array.isArray(myProfile?.departments) ? myProfile.departments : [];
    if (myDepts.length === 0) {
      return NextResponse.json(
        { error: "교직원 조직도에 소속이 등록된 계정만 업무 기능을 사용할 수 있습니다." },
        { status: 403 }
      );
    }

    // ── multipart 액션 (form_upload · submit) — 본문 파서 앞 분기 (memo 첨부 전례) ──
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      const action = String(form?.get("action") || "");
      const taskId = String(form?.get("taskId") || "");
      const file = form?.get("file");
      if (!(file instanceof File) || !["form_upload", "submit"].includes(action)) {
        return NextResponse.json({ error: "업로드 요청이 유효하지 않습니다." }, { status: 400 });
      }
      const task = await loadTaskOrNull(domain, taskId);
      if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

      const nameCheck = validateTaskFileName(file.name);
      if (!nameCheck.ok) return NextResponse.json({ error: nameCheck.error }, { status: 400 });
      const sizeCheck = validateTaskFileSize(file.size, false);
      if (!sizeCheck.ok) return NextResponse.json({ error: sizeCheck.error }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());

      if (action === "form_upload") {
        // 양식 업로드 — 발신자 전용, 양식 폴더에 원본 이름 그대로 (§5-2)
        if (task.senderEmail !== email)
          return NextResponse.json({ error: "양식은 업무를 낸 사람만 올릴 수 있습니다." }, { status: 403 });
        if (task.canceledAt)
          return NextResponse.json({ error: "철회된 업무입니다." }, { status: 400 });
        // 셀프 등록 업무는 폴더 미생성 상태 — 첫 양식 첨부 시점에 지연 생성 (피드백 32-ⓑ:
        // 무첨부 셀프 업무의 가벼움은 유지하고, 필요해진 순간에만 Drive 비용을 낸다)
        if (!task.formFolderId) {
          const folders = await ensureTaskFolders(task.id, kstYear(task.createdAt));
          await tasksColRef(domain).doc(task.id).update(folders);
          task.formFolderId = folders.formFolderId;
          task.submitFolderId = folders.submitFolderId;
        }
        if ((task.formFiles || []).length >= TASK_MAX_FORM_FILES)
          return NextResponse.json(
            { error: `양식은 ${TASK_MAX_FORM_FILES}개까지 올릴 수 있습니다.` },
            { status: 400 }
          );
        const uploaded = await uploadTaskFile({
          folderId: task.formFolderId!,
          name: file.name,
          mimeType: file.type,
          buffer,
        });
        const entry = { driveFileId: uploaded.driveFileId, name: file.name, mimeType: file.type, size: file.size };
        await tasksColRef(domain).doc(task.id).update({
          formFiles: [...(task.formFiles || []), entry],
        });
        return NextResponse.json({ success: true, action, formFile: entry });
      }

      // submit — 수신자 전용, 제출형만, 정규화 이름으로 저장 + DONE 원자 (§5-3)
      if (task.kind !== "submit")
        return NextResponse.json({ error: "확인형 업무는 완료 체크로 끝납니다." }, { status: 400 });
      if (task.canceledAt) return NextResponse.json({ error: "철회된 업무입니다." }, { status: 400 });
      if (!task.recipientEmails.includes(email))
        return NextResponse.json({ error: "이 업무의 대상이 아닙니다." }, { status: 403 });

      const normalized = normalizeSubmissionFileName({
        taskTitle: task.title,
        submitterName: myProfile?.name || email.split("@")[0],
        homeroom: myProfile?.isHomeroom ? myProfile?.homeroom : null,
        departments: myDepts,
        originalName: file.name,
      });
      const prev = task.submissions?.[email];
      let driveFileId: string;
      if (prev) {
        await overwriteTaskFile({ fileId: prev.driveFileId, name: normalized, mimeType: file.type, buffer });
        driveFileId = prev.driveFileId;
      } else {
        const up = await uploadTaskFile({
          folderId: task.submitFolderId!,
          name: normalized,
          mimeType: file.type,
          buffer,
        });
        driveFileId = up.driveFileId;
      }
      const now = Date.now();
      const submission = { driveFileId, name: normalized, size: file.size, at: now, version: (prev?.version || 0) + 1 };
      const doneStatus = submissionDoneStatus(now, form?.get("note")); // 제출 코멘트 (피드백 27번, 선택)
      // 키에 점(.)이 포함되므로 FieldPath 가변 인자 형태 필수 (memo reads 전례)
      await tasksColRef(domain)
        .doc(task.id)
        .update(
          new FieldPath("submissions", email),
          submission,
          new FieldPath("statuses", email),
          doneStatus
        );
      return NextResponse.json({ success: true, action, submission, status: doneStatus });
    }

    const body = await req.json().catch(() => ({} as any));
    const action = body.action as TasksAction;

    switch (action) {
      case "prepare": {
        // 2상 발송의 1상 — 초안 생성 + 폴더 프로비저닝 (§5-1). 수신자 없는 초안은 발신자만 읽는다(rules)
        // 기한 없음은 셀프 등록 전용이다 (task_no_due_spec §0 전제 1) — 화면에서 막는 것으로
        // 충분하지 않다. 기한 없는 업무를 남에게 보내는 것은 "말로 시키기"의 재현이라
        // 이 기능의 취지와 충돌하므로 서버가 지킨다.
        if (body.noDue === true) {
          return NextResponse.json(
            { error: "기한 없는 업무는 본인 할 일에만 등록할 수 있습니다." },
            { status: 400 }
          );
        }
        const validated = validateTaskContent({ ...body, noDue: undefined, now: Date.now() });
        if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
        const now = Date.now();
        const retentionSnap = await adminDb.collection("settings").doc(domain).get();
        const retentionDays = Number(retentionSnap.data()?.taskRetentionDays) || TASK_DEFAULT_RETENTION_DAYS;
        const ref = tasksColRef(domain).doc();
        const folders = await ensureTaskFolders(ref.id, kstYear(now));
        const doc: TaskDoc = {
          senderEmail: email,
          senderName: (myProfile?.name || "").trim() || email.split("@")[0],
          title: validated.content.title,
          body: validated.content.body,
          ...(validated.content.contentFormat ? { contentFormat: "md1" as const } : {}),
          kind: validated.content.kind,
          dueAt: validated.content.dueAt,
          recipientEmails: [],
          recipientCount: 0,
          recipientSummary: validated.content.recipientSummary,
          statuses: {},
          formFolderId: folders.formFolderId,
          submitFolderId: folders.submitFolderId,
          createdAt: now,
          expireAt: now + retentionDays * 24 * 3600 * 1000,
        };
        await ref.set(doc);
        return NextResponse.json({ success: true, taskId: ref.id });
      }

      case "self_add": {
        // [내 할 일 추가] 미니 입력 (피드백 15번) — 1액션 완결: 수신자 자동 본인·즉시 수락·
        // 확인형 강제(buildSelfTaskDoc이 kind 입력을 받지 않는다). 폴더·알림·감사 로그 없음 —
        // 자기 자신에게 보내는 푸시는 소음이고, D-1 리마인드는 스윕이 동일하게 챙긴다.
        const now = Date.now();
        // 기한 없음 허용 지점 (task_no_due_spec §2) — validateTaskContent가 센티널을 넣어 준다
        const validated = validateTaskContent({
          ...body,
          kind: "confirm",
          recipientSummary: "본인",
          noDue: body.noDue === true,
          now,
        });
        if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
        const retentionSnap = await adminDb.collection("settings").doc(domain).get();
        const retentionDays = Number(retentionSnap.data()?.taskRetentionDays) || TASK_DEFAULT_RETENTION_DAYS;
        const ref = tasksColRef(domain).doc();
        await ref.set(
          buildSelfTaskDoc({
            email,
            name: (myProfile?.name || "").trim() || email.split("@")[0],
            title: validated.content.title,
            body: validated.content.body,
            contentFormat: validated.content.contentFormat,
            dueAt: validated.content.dueAt,
            noDue: validated.content.noDue,
            now,
            retentionDays,
          })
        );
        return NextResponse.json({ success: true, taskId: ref.id });
      }

      case "send": {
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.senderEmail !== email)
          return NextResponse.json({ error: "업무를 낸 사람만 발송할 수 있습니다." }, { status: 403 });
        if (task.recipientCount > 0)
          return NextResponse.json({ error: "이미 발송된 업무입니다." }, { status: 400 });

        const rawUsers = Array.isArray(body.recipients?.users) ? body.recipients.users : [];
        const rawGroups = Array.isArray(body.recipients?.groups) ? body.recipients.groups : [];
        let groupUsers: string[] = [];
        try {
          const expanded = await expandGroupEmails(rawGroups as string[], (g) => listGroupMembers(g));
          groupUsers = expanded.users;
        } catch {
          return NextResponse.json(
            { error: "수신 그룹을 확인하지 못했습니다. 그룹 주소를 다시 확인해 주세요." },
            { status: 400 }
          );
        }
        const directory = await listUsersInOUs(["all"]);
        const resolved = resolveRecipients([...(rawUsers as string[]), ...groupUsers], directory, domain);
        if (resolved.accepted.length === 0)
          return NextResponse.json({ error: "받을 수 있는 수신자가 없습니다." }, { status: 400 });
        if (resolved.accepted.length > TASK_MAX_RECIPIENTS)
          return NextResponse.json(
            { error: `수신자는 ${TASK_MAX_RECIPIENTS}명까지 지정할 수 있습니다.` },
            { status: 400 }
          );

        const summary =
          typeof body.recipientSummary === "string"
            ? body.recipientSummary.trim().slice(0, 100)
            : task.recipientSummary;

        await tasksColRef(domain).doc(task.id).update({
          recipientEmails: resolved.accepted,
          recipientCount: resolved.accepted.length,
          recipientSummary: summary,
        });
        // 제출형은 담당자에게 제출함 열람 부여 (§0-4 예외 1) — 실패는 기능 저하로 수용
        if (task.kind === "submit" && task.submitFolderId) {
          try {
            await grantFolderReader(task.submitFolderId, email);
          } catch (e: any) {
            console.error("[api/tasks] 제출함 권한 부여 실패:", e?.message || e);
          }
        }
        after(async () => {
          await notifyTask(domain, resolved.accepted, task.senderName, task.title, task.id, "새 업무");
          await emitNotificationsBatch(
            domain,
            resolved.accepted.map((r) => ({
              recipientEmail: r,
              type: "task-assigned" as const,
              title: `${task.senderName} 선생님의 업무: ${task.title}`,
              refType: "task",
              refId: task.id,
            }))
          );
          await writeAuditLog({
            operatorEmail: email,
            operatorName: task.senderName,
            action: "업무 발송",
            targetEmail: summary || `${resolved.accepted.length}명`,
            details: `업무 "${task.title}" (${task.kind === "submit" ? "제출형" : "확인형"}, 기한 ${new Date(task.dueAt).toISOString()}) → ${resolved.accepted.length}명`,
            status: "success",
          });
        });
        return NextResponse.json({ success: true, recipientCount: resolved.accepted.length });
      }

      case "transition": {
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        const verdict = applyTaskTransition(
          task,
          email,
          body.transition,
          typeof body.note === "string" ? body.note : undefined,
          Date.now()
        );
        if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 400 });
        await tasksColRef(domain)
          .doc(task.id)
          .update(new FieldPath("statuses", email), verdict.next);
        // 발신자향은 원장만 — 푸시 없음 (§6 피로 설계). 거절은 사유가 실리는 유일한 상태
        after(async () => {
          const label =
            verdict.next.state === "ACCEPTED" ? "수락" : verdict.next.state === "DECLINED" ? "거절" : "완료";
          await emitNotificationsBatch(domain, [
            {
              recipientEmail: task.senderEmail,
              type: "task-status" as const,
              title: `[${label}] ${task.title} — ${myProfile?.name || email.split("@")[0]}`,
              refType: "task",
              refId: task.id,
              ...(verdict.next.note ? { message: verdict.next.note.slice(0, 200) } : {}),
            },
          ]);
        });
        return NextResponse.json({ success: true, status: verdict.next });
      }

      case "submit_session_start": {
        // 대용량(>4MB) — Drive 재개 업로드 세션 발급 (§5-4). 정규화 이름을 세션 메타에 미리 박는다
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.kind !== "submit" || task.canceledAt || !task.recipientEmails.includes(email))
          return NextResponse.json({ error: "제출할 수 없는 업무입니다." }, { status: 400 });
        const nameCheck = validateTaskFileName(body.fileName);
        if (!nameCheck.ok) return NextResponse.json({ error: nameCheck.error }, { status: 400 });
        const sizeCheck = validateTaskFileSize(Number(body.size), true);
        if (!sizeCheck.ok) return NextResponse.json({ error: sizeCheck.error }, { status: 400 });
        if (task.submissions?.[email])
          return NextResponse.json(
            { error: "재제출은 4MB 이하로 올리거나, 기존 제출을 확인해 주세요." },
            { status: 400 }
          ); // 세션 경로는 신규 파일 생성 — 교체(재제출)는 서버 경유만 (v1 단순화)
        const normalized = normalizeSubmissionFileName({
          taskTitle: task.title,
          submitterName: myProfile?.name || email.split("@")[0],
          homeroom: myProfile?.isHomeroom ? myProfile?.homeroom : null,
          departments: myDepts,
          originalName: String(body.fileName),
        });
        const origin = req.headers.get("origin") || req.nextUrl.origin;
        const sessionUrl = await createResumableUploadSession({
          folderId: task.submitFolderId!,
          name: normalized,
          mimeType: typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream",
          origin,
        });
        return NextResponse.json({ success: true, sessionUrl, normalizedName: normalized });
      }

      case "submit_session_finish": {
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.kind !== "submit" || task.canceledAt || !task.recipientEmails.includes(email))
          return NextResponse.json({ error: "제출할 수 없는 업무입니다." }, { status: 400 });
        const fileId = String(body.driveFileId || "");
        const meta = fileId ? await getTaskFileMeta(fileId) : null;
        // 검증: 이 업무의 제출함 폴더 안 + 크기 상한 (§5-4 — 서버가 재검증하기 전까지 제출로 치지 않는다)
        if (!meta || !task.submitFolderId || !meta.parents.includes(task.submitFolderId)) {
          return NextResponse.json({ error: "업로드된 파일을 확인하지 못했습니다." }, { status: 400 });
        }
        const sizeCheck = validateTaskFileSize(meta.size, true);
        if (!sizeCheck.ok) return NextResponse.json({ error: sizeCheck.error }, { status: 400 });
        const now = Date.now();
        const submission = { driveFileId: fileId, name: meta.name, size: meta.size, at: now, version: 1 };
        const doneStatus = submissionDoneStatus(now, body.note); // 제출 코멘트 (피드백 27번, 선택)
        await tasksColRef(domain)
          .doc(task.id)
          .update(
            new FieldPath("submissions", email),
            submission,
            new FieldPath("statuses", email),
            doneStatus
          );
        return NextResponse.json({ success: true, submission, status: doneStatus });
      }

      case "form_session_start": {
        // 양식 대용량(>4MB, ≤30MB) — 발신자 전용 세션 업로드 (피드백 36번: submit 세션의 거울)
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.senderEmail !== email)
          return NextResponse.json({ error: "양식은 업무를 낸 사람만 올릴 수 있습니다." }, { status: 403 });
        if (task.canceledAt) return NextResponse.json({ error: "철회된 업무입니다." }, { status: 400 });
        if ((task.formFiles || []).length >= TASK_MAX_FORM_FILES)
          return NextResponse.json(
            { error: `양식은 ${TASK_MAX_FORM_FILES}개까지 올릴 수 있습니다.` },
            { status: 400 }
          );
        const nameCheck = validateTaskFileName(body.fileName);
        if (!nameCheck.ok) return NextResponse.json({ error: nameCheck.error }, { status: 400 });
        const sizeCheck = validateTaskFileSize(Number(body.size), true);
        if (!sizeCheck.ok) return NextResponse.json({ error: sizeCheck.error }, { status: 400 });
        if (!task.formFolderId) {
          const folders = await ensureTaskFolders(task.id, kstYear(task.createdAt));
          await tasksColRef(domain).doc(task.id).update(folders);
          task.formFolderId = folders.formFolderId;
        }
        const origin = req.headers.get("origin") || req.nextUrl.origin;
        const sessionUrl = await createResumableUploadSession({
          folderId: task.formFolderId!,
          name: String(body.fileName), // 양식은 원본 이름 그대로 (§5-2 — 제출물과 달리 정규화 없음)
          mimeType: typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream",
          origin,
        });
        return NextResponse.json({ success: true, sessionUrl });
      }

      case "form_session_finish": {
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.senderEmail !== email)
          return NextResponse.json({ error: "양식은 업무를 낸 사람만 올릴 수 있습니다." }, { status: 403 });
        if (task.canceledAt) return NextResponse.json({ error: "철회된 업무입니다." }, { status: 400 });
        const fileId = String(body.driveFileId || "");
        const meta = fileId ? await getTaskFileMeta(fileId) : null;
        // 재검증 전까지 양식으로 치지 않는다 (§5-4 규약 승계): 이 업무 양식 폴더 안 + 확장자·크기
        if (!meta || !task.formFolderId || !meta.parents.includes(task.formFolderId)) {
          return NextResponse.json({ error: "업로드된 파일을 확인하지 못했습니다." }, { status: 400 });
        }
        const nameCheck = validateTaskFileName(meta.name);
        if (!nameCheck.ok) return NextResponse.json({ error: nameCheck.error }, { status: 400 });
        const sizeCheck = validateTaskFileSize(meta.size, true);
        if (!sizeCheck.ok) return NextResponse.json({ error: sizeCheck.error }, { status: 400 });
        if ((task.formFiles || []).length >= TASK_MAX_FORM_FILES)
          return NextResponse.json(
            { error: `양식은 ${TASK_MAX_FORM_FILES}개까지 올릴 수 있습니다.` },
            { status: 400 }
          );
        const entry = { driveFileId: fileId, name: meta.name, mimeType: meta.mimeType, size: meta.size };
        await tasksColRef(domain)
          .doc(task.id)
          .update({ formFiles: FieldValue.arrayUnion(entry) });
        return NextResponse.json({ success: true, formFile: entry });
      }

      case "nudge": {
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.senderEmail !== email)
          return NextResponse.json({ error: "업무를 낸 사람만 재촉할 수 있습니다." }, { status: 403 });
        if (task.canceledAt) return NextResponse.json({ error: "철회된 업무입니다." }, { status: 400 });
        const now = Date.now();
        if (!canNudge(task.lastNudgeAt, now))
          return NextResponse.json(
            { error: "리마인드 알림은 업무당 하루에 한 번만 보낼 수 있습니다." },
            { status: 429 }
          );
        const targets = nudgeTargets(task);
        if (targets.length === 0)
          return NextResponse.json({ error: "리마인드를 보낼 대상이 없습니다. 모두 처리했습니다." }, { status: 400 });
        await tasksColRef(domain).doc(task.id).update({ lastNudgeAt: now });
        // 피드백 11번 — 푸시는 부드러운 문구 1회 + 종 알림 원장(task-due 계열) 기록.
        // 원장이 없으면 푸시를 놓친 수신자에게 흔적이 0으로 남는 설계 빈틈이었다.
        after(async () => {
          await notifyTask(domain, targets, task.senderName, task.title, task.id, "기한이 다가오는 업무가 있어요");
          await emitNotificationsBatch(
            domain,
            targets.map((r) => ({
              recipientEmail: r,
              type: "task-due" as const,
              title: `[리마인드] ${task.title}`,
              refType: "task",
              refId: task.id,
            }))
          );
          await writeAuditLog({
            operatorEmail: email,
            operatorName: task.senderName,
            action: "업무 리마인드",
            targetEmail: `${targets.length}명`,
            details: `업무 "${task.title}" 미처리 ${targets.length}명에게 리마인드 알림`,
            status: "success",
          });
        });
        return NextResponse.json({ success: true, nudged: targets.length });
      }

      case "cancel": {
        const task = await loadTaskOrNull(domain, String(body.taskId || ""));
        if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
        if (task.senderEmail !== email)
          return NextResponse.json({ error: "업무를 낸 사람만 철회할 수 있습니다." }, { status: 403 });
        if (task.canceledAt) return NextResponse.json({ error: "이미 철회된 업무입니다." }, { status: 400 });
        const now = Date.now();
        await tasksColRef(domain).doc(task.id).update({ canceledAt: now });
        // 제출물은 보존(§3) — 담당자 제출함 열람은 회수 (§5-1)
        if (task.kind === "submit" && task.submitFolderId) {
          try {
            await revokeFolderReader(task.submitFolderId, email);
          } catch {
            /* 기능 저하 수용 */
          }
        }
        after(async () => {
          await emitNotificationsBatch(
            domain,
            task.recipientEmails.map((r) => ({
              recipientEmail: r,
              type: "task-canceled" as const,
              title: `[철회] ${task.title}`,
              refType: "task",
              refId: task.id,
            }))
          );
          await writeAuditLog({
            operatorEmail: email,
            operatorName: task.senderName,
            action: "업무 철회",
            targetEmail: task.recipientSummary || `${task.recipientCount}명`,
            details: `업무 "${task.title}" 철회 (제출물은 보존 기간까지 유지)`,
            status: "success",
          });
        });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[api/tasks] 실패:", e?.message || e);
    return NextResponse.json({ error: e?.message || "업무 처리에 실패했습니다." }, { status: 500 });
  }
}
