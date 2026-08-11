// 쪽지(사내 메신저) 1단계 — 발송·읽음 API (docs/memo_spec.md §2)
// 읽기(받은/보낸쪽지함)는 클라이언트 직독 + firestore.rules — 쓰기는 이 라우트 전용.
import { adminDb, verifyAuthAccess } from "@/lib/firebase/admin";
import {
  MEMO_MAX_RECIPIENTS,
  MemoDoc,
  expandGroupEmails,
  isValidEmailFormat,
  resolveRecipients,
  resolveRetentionDays,
  validateMemoContent,
} from "@/lib/memo/logic";
import { listGroupMembers, listUsersInOUs } from "@/lib/google/workspace";
import { notifyMemo } from "@/lib/push/webpush";
import { FieldPath } from "firebase-admin/firestore";
import { NextRequest, NextResponse, after } from "next/server";

type MemoAction = "send" | "read";

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
    if (
      !userData ||
      !["teacher", "super_admin"].includes(userData.role) ||
      userData.isApproved !== true
    ) {
      return NextResponse.json({ error: "쪽지 기능 사용 권한이 없습니다." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as any));
    const action: MemoAction = body.action;

    switch (action) {
      case "send": {
        const validated = validateMemoContent(body);
        if (!validated.ok) {
          return NextResponse.json({ error: validated.error }, { status: 400 });
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

        // 발신자 표시 이름: teacher_profiles → GWS 디렉터리 → 이메일 로컬부 (스펙 §1)
        let senderName = "";
        try {
          const profileSnap = await adminDb.collection("teacher_profiles").doc(email).get();
          senderName = (profileSnap.data()?.name || "").trim();
        } catch {
          /* 이름 폴백으로 진행 */
        }
        if (!senderName) {
          const me = directory.find(
            (u: any) => (u.primaryEmail || "").toLowerCase() === email
          ) as any;
          senderName =
            `${me?.name?.familyName || ""}${me?.name?.givenName || ""}`.trim() ||
            email.split("@")[0];
        }

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
        };
        const ref = memoItemsColRef(domain).doc();
        await ref.set(doc);

        // 웹 푸시 — 응답 후 발송, 실패해도 저장에 영향 없음 (스펙 §2-6·§5)
        after(() =>
          notifyMemo(domain, resolved.accepted, senderName, validated.content.title, ref.id)
        );

        return NextResponse.json({
          success: true,
          action,
          memoId: ref.id,
          recipientCount: resolved.accepted.length,
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

      default:
        return NextResponse.json({ error: "지원하지 않는 action입니다." }, { status: 400 });
    }
  } catch (e: any) {
    console.error("[api/memo] 처리 실패:", e?.message || e);
    return NextResponse.json({ error: "쪽지 요청 처리에 실패했습니다." }, { status: 500 });
  }
}
