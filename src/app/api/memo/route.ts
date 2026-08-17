// 쪽지(사내 메신저) 1단계 — 발송·읽음 API (docs/memo_spec.md §2)
// 읽기(받은/보낸쪽지함)는 클라이언트 직독 + firestore.rules — 쓰기는 이 라우트 전용.
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import {
  MEMO_MAX_RECIPIENTS,
  MemoDoc,
  computeRecall,
  expandGroupEmails,
  isStudentOuPath,
  isValidEmailFormat,
  resolveRecipients,
  resolveRetentionDays,
  validateMemoContent,
} from "@/lib/memo/logic";
import {
  decideAttachmentShareMode,
  validateAttachmentIds,
  validateAttachmentUpload,
} from "@/lib/memo/attachment_logic";
import {
  deleteStagingDocs,
  finalizeMemoAttachments,
  getAttachmentQuota,
  resolveStagedAttachments,
  retryPendingAttachmentGrants,
  revokeAttachmentAccess,
  uploadMemoAttachment,
} from "@/lib/memo/attachments";
import { listGroupMembers, listUsersInOUs } from "@/lib/google/workspace";
import { notifyMemo } from "@/lib/push/webpush";
import { emitNotificationsBatch } from "@/lib/notifications/server";
import { FieldPath } from "firebase-admin/firestore";
import { NextRequest, NextResponse, after } from "next/server";

type MemoAction = "send" | "read" | "recall" | "attachment_quota";

const memoItemsColRef = (domain: string) =>
  adminDb.collection("memos").doc(domain).collection("items");

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증되지 않은 요청입니다." }, { status: 401 });
    }
    const email = auth.email.trim().toLowerCase();
    const domain = email.split("@")[1] || "hmh.or.kr";

    // 승인된 교직원만 (스펙 §2 공통 게이트) — verifyAuthAccess의 role만으로는
    // 승인 대기 교사(role: teacher, isApproved: false)를 거르지 못하므로 문서를 직접 확인한다.
    const userSnap = await adminDb.collection("users").doc(auth.uid).get();
    const userData = userSnap.data();
    if (!userData || !["teacher", "super_admin"].includes(userData.role)) {
      return NextResponse.json({ error: "쪽지 기능 사용 권한이 없습니다." }, { status: 403 });
    }
    // 자격 = 교직원 조직도 등록 (firestore.rules와 같은 기준 — 단일 원본).
    // users.isApproved를 쓰지 않는다: 그 값은 로그인마다 "워크스페이스 관리자인가"로
    // 덮어써져 일반 교사는 영원히 false다(2026-08-13 실측, 20명 중 true 0명).
    const profSnap = await adminDb.collection("teacher_profiles").doc(email).get();
    const depts = profSnap.exists ? profSnap.data()?.departments : null;
    if (!Array.isArray(depts) || depts.length === 0) {
      return NextResponse.json(
        { error: "교직원 조직도에 소속이 등록된 계정만 쪽지를 사용할 수 있습니다. 소속 정보를 등록해 주세요." },
        { status: 403 }
      );
    }

    // 첨부 업로드 (attachment spec §3-2) — 유일한 multipart 액션이라 본문 파서 앞에서 분기.
    // 자격 게이트(승인 교직원)는 위에서 이미 통과했다.
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "첨부할 이미지를 확인하지 못했습니다." }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const checked = validateAttachmentUpload({ name: file.name, mimeType: file.type, bytes: buffer });
      if (!checked.ok) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      try {
        const attachment = await uploadMemoAttachment({
          uploaderEmail: email,
          domain,
          safeName: checked.safeName,
          mimeType: checked.mimeType,
          buffer,
        });
        return NextResponse.json({ success: true, action: "attach_upload", attachment });
      } catch (e: any) {
        console.error("[api/memo] 첨부 업로드 실패:", e?.message || e);
        return NextResponse.json(
          { error: "이미지 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 502 }
        );
      }
    }

    const body = await req.json().catch(() => ({} as any));
    const action: MemoAction = body.action;

    switch (action) {
      case "send": {
        const validated = validateMemoContent(body);
        if (!validated.ok) {
          return NextResponse.json({ error: validated.error }, { status: 400 });
        }
        // 첨부는 driveFileId 배열만 받는다 — 메타데이터는 staging이 원본 (attachment spec §3-2)
        const attIds = validateAttachmentIds(body.attachments);
        if (!attIds.ok) {
          return NextResponse.json({ error: attIds.error }, { status: 400 });
        }

        // 수신자 원자료 — 형식·개수 방어
        const rawUsers: unknown = body.recipients?.users ?? [];
        const rawGroups: unknown = body.recipients?.groups ?? [];
        if (!Array.isArray(rawUsers) || !Array.isArray(rawGroups)) {
          return NextResponse.json({ error: "수신자 형식이 유효하지 않습니다." }, { status: 400 });
        }
        if (rawUsers.length > 400 || rawGroups.length > 30) {
          return NextResponse.json({ error: "수신자 지정이 너무 많습니다." }, { status: 400 });
        }
        for (const g of rawGroups) {
          if (!isValidEmailFormat(g)) {
            return NextResponse.json({ error: "그룹 주소가 유효하지 않습니다." }, { status: 400 });
          }
        }

        // 그룹 확장은 서버가 직접 (스펙 §2-1) — 조회 실패는 삼키지 않고 400
        let groupUsers: string[] = [];
        try {
          const expanded = await expandGroupEmails(
            rawGroups as string[],
            (g) => listGroupMembers(g)
          );
          groupUsers = expanded.users;
          if (expanded.skippedDepth.length > 0) {
            console.warn("[api/memo] 중첩 깊이 초과로 미확장 그룹:", expanded.skippedDepth);
          }
        } catch (e: any) {
          console.error("[api/memo] 그룹 확장 실패:", e?.message || e);
          return NextResponse.json(
            { error: "수신 그룹을 확인하지 못했습니다. 그룹 주소를 다시 확인해 주세요." },
            { status: 400 }
          );
        }

        // 실존 대조 — users.list 전수 1회(캐시), 수신자 수와 무관하게 호출 고정 (스펙 §2-2·§2-3)
        const directory = await listUsersInOUs(["all"]);
        const resolved = resolveRecipients(
          [...(rawUsers as string[]), ...groupUsers],
          directory,
          domain
        );
        if (resolved.accepted.length === 0) {
          return NextResponse.json(
            { error: "받을 수 있는 수신자가 없습니다. 수신자를 다시 확인해 주세요." },
            { status: 400 }
          );
        }
        if (resolved.accepted.length > MEMO_MAX_RECIPIENTS) {
          return NextResponse.json(
            { error: `수신자는 ${MEMO_MAX_RECIPIENTS}명까지 지정할 수 있습니다.` },
            { status: 400 }
          );
        }

        // 발신자 표시 이름: GWS 디렉터리 → teacher_profiles(이메일 로컬부 오염 가드) → 이메일 로컬부
        let senderName = "";
        const emailLocal = email.split("@")[0];

        // 1. GWS 디렉터리 이름
        const me = directory.find(
          (u: any) => (u.primaryEmail || "").toLowerCase() === email
        ) as any;
        const gwsFullName =
          me?.name?.fullName ||
          (me?.name?.familyName ? `${me.name.familyName}${me.name.givenName || ""}` : "");
        if (gwsFullName && gwsFullName.trim()) {
          senderName = gwsFullName.trim();
        }

        // 2. teacher_profiles (GWS 이름 없거나 빈 값일 때, 이메일 로컬부 오염 가드)
        if (!senderName) {
          try {
            const profileSnap = await adminDb.collection("teacher_profiles").doc(email).get();
            const pName = (profileSnap.data()?.name || "").trim();
            if (pName && pName.toLowerCase() !== emailLocal.toLowerCase()) {
              senderName = pName;
            }
          } catch {
            /* 폴백 진행 */
          }
        }

        // 3. 이메일 로컬부 폴백
        if (!senderName) {
          senderName = emailLocal;
        }


        // 첨부 대조 — 발신자 본인이 방금 올린 파일만 통과 (attachment spec §3-2)
        const staged = await resolveStagedAttachments(attIds.ids, email, domain);
        if (!staged.ok) {
          return NextResponse.json({ error: staged.error }, { status: 400 });
        }
        // 전 교직원 공지면 개별 권한 대신 도메인 내부 링크 공유 (attachment spec §3-3 예외)
        const staffCount = directory.filter((u: any) => !isStudentOuPath(u.orgUnitPath)).length;
        const attachmentShareMode =
          staged.attachments.length > 0
            ? decideAttachmentShareMode(resolved.accepted.length, staffCount)
            : undefined;

        // 보존 기한 — 발송 시 즉시 스탬프 (스펙 §6)
        const settingsSnap = await adminDb.collection("settings").doc(domain).get();
        const retentionDays = resolveRetentionDays(settingsSnap.data()?.memoRetentionDays);

        const now = Date.now();
        const doc: MemoDoc = {
          senderEmail: email,
          senderName,
          title: validated.content.title,
          body: validated.content.body,
          links: validated.content.links,
          recipientEmails: resolved.accepted,
          recipientCount: resolved.accepted.length,
          recipientSummary: validated.content.recipientSummary,
          reads: {},
          createdAt: now,
          expireAt: now + retentionDays * 24 * 3600 * 1000,
          ...(staged.attachments.length > 0
            ? { attachments: staged.attachments, attachmentShareMode }
            : {}),
        };
        const ref = memoItemsColRef(domain).doc();
        await ref.set(doc);

        // 첨부 마무리 — staging 소거(재사용 차단) → 파일명 확정·권한 부여 → 잔존 실패분 수습.
        // 응답 후 실행: 권한 부여는 수신자 수만큼 Drive 콜이라 응답을 붙잡지 않는다 (attachment spec §3-3).
        if (staged.attachments.length > 0) {
          after(async () => {
            try {
              await deleteStagingDocs(attIds.ids);
              await finalizeMemoAttachments({
                domain,
                memoId: ref.id,
                attachments: staged.attachments,
                recipients: resolved.accepted,
                shareMode: attachmentShareMode!,
              });
              await retryPendingAttachmentGrants(domain);
            } catch (e) {
              console.error("[api/memo] 첨부 마무리 실패:", (e as Error)?.message);
              await ref.set({ permissionPending: true }, { merge: true }).catch(() => {});
            }
          });
        }

        // 웹 푸시 — 응답 후 발송, 실패해도 저장에 영향 없음 (스펙 §2-6·§5)
        after(() =>
          notifyMemo(domain, resolved.accepted, senderName, validated.content.title, ref.id)
        );
        // 원장: 수신자 전원에게 알림 (notification_center_spec §3 ③) — 문구는 푸시와 동일 수준
        // (발신자·제목까지만, 본문 금지)
        after(() =>
          emitNotificationsBatch(
            domain,
            resolved.accepted.map((r: string) => ({
              recipientEmail: r,
              type: "memo" as const,
              title: `${senderName} 선생님의 쪽지: ${validated.content.title}`,
              refType: "memo",
              refId: ref.id,
            }))
          ).catch((e) => console.error("[알림 센터] 쪽지 원장 기록 실패:", (e as Error)?.message))
        );

        return NextResponse.json({
          success: true,
          action,
          memoId: ref.id,
          recipientCount: resolved.accepted.length,
          ...(staged.attachments.length > 0
            ? { attachmentCount: staged.attachments.length, attachmentShareMode }
            : {}),
          excluded: {
            notFound: resolved.notFound.slice(0, 20),
            students: resolved.students.length,
            outOfDomain: resolved.outOfDomain.slice(0, 20),
          },
        });
      }

      case "read": {
        const memoId = typeof body.memoId === "string" ? body.memoId.trim() : "";
        if (!memoId || memoId.length > 128 || memoId.includes("/")) {
          return NextResponse.json({ error: "쪽지 정보가 유효하지 않습니다." }, { status: 400 });
        }
        const ref = memoItemsColRef(domain).doc(memoId);
        const snap = await ref.get();
        if (!snap.exists) {
          return NextResponse.json({ error: "쪽지를 찾을 수 없습니다." }, { status: 404 });
        }
        const memo = snap.data() as MemoDoc;
        if (!Array.isArray(memo.recipientEmails) || !memo.recipientEmails.includes(email)) {
          return NextResponse.json({ error: "이 쪽지의 수신자가 아닙니다." }, { status: 403 });
        }
        // 최초 열람만 기록 (멱등 — 재열람은 갱신하지 않음, 스펙 §2 read)
        if (!memo.reads || !memo.reads[email]) {
          // 이메일 키에 점(.)이 있으므로 FieldPath 필수 — 문자열 경로 금지 (스펙 §1)
          await ref.update(new FieldPath("reads", email), Date.now());
        }
        return NextResponse.json({ success: true, action });
      }

      case "recall": {
        // 회수 (§12-2) — 이미 읽은 사람 것은 두고, 아직 안 읽은 사람 것만 거둔다.
        const memoId = typeof body.memoId === "string" ? body.memoId.trim() : "";
        if (!memoId || memoId.length > 128 || memoId.includes("/")) {
          return NextResponse.json({ error: "쪽지 정보가 유효하지 않습니다." }, { status: 400 });
        }
        const ref = memoItemsColRef(domain).doc(memoId);

        // **트랜잭션 필수** — 대상을 계산한 뒤 쓰기까지 사이에 누군가 열면, 읽었는데도 목록에서
        // 사라진 사람이 생겨 수신확인 이력이 왜곡된다. 트랜잭션이면 그 경합에서 재시도되어
        // 항상 최신 reads 기준으로 자른다.
        const outcome = await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { fail: { error: "쪽지를 찾을 수 없습니다.", status: 404 } };
          const memo = snap.data() as MemoDoc;
          if (memo.senderEmail !== email) {
            return { fail: { error: "보낸 사람만 쪽지를 회수할 수 있습니다.", status: 403 } };
          }
          const { keep, recalled } = computeRecall(memo);
          // 전원이 이미 읽었으면 거둘 것이 없다 — 실패가 아니라 0건 성공으로 알린다.
          // (여기서 쓰기를 하면 회수한 적 없는 쪽지에 recalledAt이 찍혀 이력이 거짓이 된다.)
          if (recalled.length === 0) return { recalledCount: 0, remainingCount: keep.length };
          tx.update(ref, {
            recipientEmails: keep,
            recipientCount: keep.length,
            recalledAt: Date.now(),
            // 누계로 쌓는다 — 덮어쓰면 앞선 회수 이력이 사라진다
            recalledCount: (memo.recalledCount || 0) + recalled.length,
          });
          return {
            recalledCount: recalled.length,
            remainingCount: keep.length,
            recalledEmails: recalled,
            attachments: memo.attachments || [],
            shareMode: memo.attachmentShareMode,
          };
        });

        if ("fail" in outcome && outcome.fail) {
          return NextResponse.json({ error: outcome.fail.error }, { status: outcome.fail.status });
        }
        // 첨부 열람 권한 = 쪽지 열람 집합 (attachment spec §0-3) — 회수된 미열람자의 reader도 거둔다.
        // 도메인 공유(전 교직원 공지)는 개인 단위 회수가 불가능하므로 제외.
        if (
          "recalledEmails" in outcome &&
          outcome.recalledCount > 0 &&
          Array.isArray(outcome.attachments) &&
          outcome.attachments.length > 0 &&
          outcome.shareMode !== "domain"
        ) {
          const { attachments, recalledEmails = [] } = outcome;
          after(() =>
            revokeAttachmentAccess(attachments, recalledEmails).catch((e) =>
              console.warn("[api/memo] 회수 첨부 권한 정리 실패:", (e as Error)?.message)
            )
          );
        }
        // 푸시는 되돌릴 수 없다(잠금화면에 발신자·제목이 이미 남았다) — 화면이 안내한다(§12-2).
        return NextResponse.json({
          success: true,
          action,
          recalledCount: outcome.recalledCount,
          remainingCount: outcome.remainingCount,
        });
      }

      case "attachment_quota": {
        // 운영 액션 (attachment spec §7) — 첨부 저장 계정 Drive 사용량. 관리자 전용.
        if (userData.role !== "super_admin") {
          return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
        }
        const quota = await getAttachmentQuota();
        return NextResponse.json({ success: true, action, quota });
      }

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[api/memo] 처리 실패:", e?.message || e);
    return NextResponse.json({ error: "쪽지 요청 처리에 실패했습니다." }, { status: 500 });
  }
}
