// 알림 센터 — 원장 코어 (docs/notification_center_spec.md, 2026-08-18 사용자 전부 확정)
//
// 원칙: 푸시는 초인종, 알림은 원장. 이 모듈은 저장·카운터·열람만 담당하고
// 푸시는 각 발생 지점의 기존 경로가 계속 맡는다(스펙 §3 구현 노트 — 이중 발송 방지
// 및 순환 import 회피: webpush가 이 모듈을 import하므로 역방향 import 금지).
//
// import 방향: notifications/server → firebase/admin 뿐. timetable/server·webpush를
// 여기서 import하지 않는다 — 양해(consent) 초안 전이는 라우트가 양쪽을 불러 조립한다.

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export const NOTIF_RETENTION_DAYS = 180; // 스펙 §5 — 수락 기록 예외는 호출자가 expireAt 지정
export const NOTIF_LIST_LIMIT = 30;
export const NOTIF_TITLE_MAX = 200;

export type NotificationType =
  | "lesson-changed"
  | "request-resolved"
  | "memo"
  | "admin-action"
  | "consent-request"
  | "consent-result"
  // 업무 지시 (phase8_tasks_spec §6) — 발송·기한 임박·재촉·철회·발신자향 상태 원장
  | "task-assigned"
  | "task-status"
  | "task-due"
  | "task-canceled";

export interface NotificationDoc {
  recipientEmail: string;
  type: NotificationType;
  title: string;
  refType: string;
  refId: string;
  /** 발신 당사자의 한 줄 메시지 (선택) — 양해 요청의 부탁 말씀 등. 제목 아래 표시 (미니 쪽지) */
  message?: string;
  createdAt: number;
  read: boolean; // 미열람 질의용 (동등 필터 — 복합 색인 불요)
  readAt?: number;
  actionable?: {
    kind: "consent";
    state: "pending" | "accepted" | "declined";
    decidedAt?: number;
    /** 수락·거절에 붙이는 당사자의 한 줄 사유 (2026-08-18 사용자 — "알림이 미니 쪽지 역할") */
    note?: string;
  };
  /** 파기 — Firestore TTL 정책 대상 필드 (Timestamp, phase11 관례) */
  expireAt: Timestamp;
}

export const notificationsColRef = (domain: string) =>
  adminDb.collection("notifications").doc(domain).collection("items");

const usersColRef = () => adminDb.collection("users");

/** email → users/{uid} 문서 참조 (없으면 null — 미로그인 교사는 카운터 없이 원장만) */
async function findUserDocByEmail(email: string) {
  const snap = await usersColRef().where("email", "==", email.trim().toLowerCase()).limit(1).get();
  return snap.empty ? null : snap.docs[0].ref;
}

export interface EmitInput {
  recipientEmail: string;
  type: NotificationType;
  title: string;
  refType: string;
  refId: string;
  /** 발신 당사자의 한 줄 메시지 (선택, 200자) */
  message?: string;
  actionable?: { kind: "consent" };
  /** 스펙 §5 예외(수락 기록 등) — 미지정 시 180일 */
  retentionDays?: number;
}

function buildDoc(input: EmitInput, now: number): NotificationDoc {
  const days = input.retentionDays ?? NOTIF_RETENTION_DAYS;
  return {
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    type: input.type,
    title: input.title.slice(0, NOTIF_TITLE_MAX),
    refType: input.refType,
    refId: input.refId,
    createdAt: now,
    read: false,
    ...((input.message || "").trim() ? { message: input.message!.trim().slice(0, 200) } : {}),
    ...(input.actionable ? { actionable: { kind: input.actionable.kind, state: "pending" as const } } : {}),
    expireAt: Timestamp.fromMillis(now + days * 24 * 3600 * 1000),
  };
}

/** 알림 1건 생성 + 배지 카운터 증가 — 실패는 삼키지 않되 호출자가 after()로 감싸는 것을 권장 */
export async function emitNotification(domain: string, input: EmitInput): Promise<string> {
  const now = Date.now();
  const ref = notificationsColRef(domain).doc();
  await ref.set(buildDoc(input, now));
  const userRef = await findUserDocByEmail(input.recipientEmail);
  if (userRef) await userRef.set({ unreadNotifCount: FieldValue.increment(1) }, { merge: true });
  return ref.id;
}

/** 다건 생성 (쪽지 최대 300명·수업 변경 다건) — 문서는 배치, 카운터는 수신자별 병합 증가 */
export async function emitNotificationsBatch(domain: string, inputs: EmitInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const now = Date.now();
  const col = notificationsColRef(domain);
  // Firestore batch 상한 500 — 쪽지 최대 300명이라 한 배치로 충분하나 안전하게 쪼갠다
  for (let i = 0; i < inputs.length; i += 450) {
    const batch = adminDb.batch();
    for (const input of inputs.slice(i, i + 450)) batch.set(col.doc(), buildDoc(input, now));
    await batch.commit();
  }
  const perEmail = new Map<string, number>();
  for (const input of inputs) {
    const key = input.recipientEmail.trim().toLowerCase();
    perEmail.set(key, (perEmail.get(key) || 0) + 1);
  }
  for (const [email, count] of perEmail) {
    const userRef = await findUserDocByEmail(email);
    if (userRef) await userRef.set({ unreadNotifCount: FieldValue.increment(count) }, { merge: true });
  }
  return inputs.length;
}

/** 내 알림 목록 — 열 때만 조회(실시간 구독 금지, 스펙 §2). 색인 없이 전량 조회 후 정렬:
 *  보존 180일·승격 4종이라 1인당 문서 수가 작다(수십 건). 커지면 복합 색인 도입. */
export async function listNotifications(
  domain: string,
  email: string,
  limit: number = NOTIF_LIST_LIMIT
): Promise<{ items: Array<NotificationDoc & { id: string }>; hasMore: boolean }> {
  const capped = Math.max(1, Math.min(Number(limit) || NOTIF_LIST_LIMIT, 200)); // 더 보기 상한 (스펙 §6)
  const snap = await notificationsColRef(domain)
    .where("recipientEmail", "==", email.trim().toLowerCase())
    .get();
  const all = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as NotificationDoc) }))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { items: all.slice(0, capped), hasMore: all.length > capped };
}

/** 열람 처리 — 미열람 전건 read 표시 + 카운터 재동기화(0). 자가 치유가 곧 리셋이다 (스펙 §2). */
export async function markAllNotificationsRead(domain: string, email: string): Promise<number> {
  const normEmail = email.trim().toLowerCase();
  const snap = await notificationsColRef(domain)
    .where("recipientEmail", "==", normEmail)
    .where("read", "==", false)
    .get();
  const now = Date.now();
  if (!snap.empty) {
    const batch = adminDb.batch();
    for (const d of snap.docs) batch.update(d.ref, { read: true, readAt: now });
    await batch.commit();
  }
  const userRef = await findUserDocByEmail(normEmail);
  if (userRef) await userRef.set({ unreadNotifCount: 0 }, { merge: true });
  return snap.docs.length;
}

/** 수락 알림의 상태 전이 — 본인 소유·pending 검증까지만 이 모듈 책임.
 *  초안(consentStatus) 전이·결과 알림 발행은 라우트가 이어서 한다 (import 방향 원칙). */
export async function decideActionableNotification(
  domain: string,
  email: string,
  notificationId: string,
  decision: "accepted" | "declined",
  note?: string
): Promise<NotificationDoc & { id: string }> {
  const ref = notificationsColRef(domain).doc(notificationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("알림을 찾을 수 없습니다.");
  const doc = snap.data() as NotificationDoc;
  if (doc.recipientEmail !== email.trim().toLowerCase())
    throw new Error("본인에게 온 알림만 처리할 수 있습니다.");
  if (!doc.actionable || doc.actionable.state !== "pending")
    throw new Error("이미 처리되었거나 처리할 수 없는 알림입니다.");
  const decidedAt = Date.now();
  const trimmedNote = (note || "").trim().slice(0, 200);
  await ref.update({
    "actionable.state": decision,
    "actionable.decidedAt": decidedAt,
    ...(trimmedNote ? { "actionable.note": trimmedNote } : {}),
    read: true,
    readAt: doc.readAt || decidedAt,
  });
  return {
    id: notificationId,
    ...doc,
    actionable: { ...doc.actionable, state: decision, decidedAt, ...(trimmedNote ? { note: trimmedNote } : {}) },
  };
}
