// 알리미 웹 푸시 1단계 — 시간표 변경 알림 (docs/web_push_spec.md)
// 구독 저장·발송·수신자 도출 전부 서버 전용(admin SDK). 클라이언트는 /api/push 경유만.
import { createHash } from "crypto";
import webpush from "web-push";
import { adminDb } from "@/lib/firebase/admin";
import { emitNotificationsBatch } from "@/lib/notifications/server";
import { timetableChangesColRef } from "@/lib/timetable/server";
import { TimetableChange } from "@/lib/timetable/types";

// ── 구독 문서 ─────────────────────────────────────────────────

export interface PushSubscriptionDoc {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  email: string;
  uid: string;
  role: "student" | "teacher" | "super_admin";
  grade?: number; // 학생만 — 구독 시점 서버 도출 스냅샷 (재구독 upsert로 갱신)
  classNum?: number;
  userAgent?: string;
  createdAt: number;
  updatedAt: number;
}

export const pushSubsColRef = (domain: string) =>
  adminDb.collection("push_subscriptions").doc(domain).collection("subs");

/** subId = sha256(endpoint) — 같은 브라우저 재구독은 자연 upsert(멱등) */
export const subIdOfEndpoint = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

// ── VAPID 설정 ────────────────────────────────────────────────

export function getVapidPublicKey(): string {
  return (process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
}

export function isWebPushConfigured(): boolean {
  return !!getVapidPublicKey() && !!(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!isWebPushConfigured()) return false;
  if (!vapidReady) {
    const sender =
      process.env.GOOGLE_WORKSPACE_SENDER_EMAIL ||
      process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL ||
      "hmnotice@hmh.or.kr";
    webpush.setVapidDetails(
      `mailto:${sender}`,
      getVapidPublicKey(),
      (process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim()
    );
    vapidReady = true;
  }
  return true;
}

// ── 발송 ──────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // 없으면 발송 시 구독 역할로 결정 (학생 → /student)
  /**
   * 딥링크 파라미터 (2026-08-21 신설) — 예: `nav=memo&id=abc`.
   *
   * `url`을 직접 지정하면 **역할 라우팅이 무력화된다** — 시간표 알림은 학생도 받는데
   * `/teacher?…`를 박아 보내면 학생이 못 여는 화면으로 떨어진다. 그래서 목적지는
   * 역할이 정하게 두고, **교사 계열에만** 이 쿼리를 붙인다. 착지 처리는
   * `/teacher`의 `?nav=` 리더가 한다(학생 화면에는 리더가 없으므로 붙이지 않는다).
   */
  navQuery?: string;
  tag?: string;
}

export interface PushSendResult {
  sent: number;
  removed: number; // 만료(404/410)로 삭제된 구독 수
  failed: number;
}

type SubWithId = { id: string; data: PushSubscriptionDoc };

/**
 * 구독 목록에 페이로드 발송. 404/410 구독은 즉시 삭제.
 * 어떤 실패도 throw하지 않는다 — 알림 실패가 시간표 커밋을 깨면 안 된다.
 */
async function sendToSubs(
  domain: string,
  subs: SubWithId[],
  payload: PushPayload
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 };
  if (!ensureVapid() || subs.length === 0) return result;

  await Promise.allSettled(
    subs.map(async (sub) => {
      const isStudent = sub.data.role === "student";
      const url =
        payload.url ||
        (isStudent
          ? "/student"
          : payload.navQuery
            ? `/teacher?${payload.navQuery}`
            : "/");
      const body = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url,
        tag: payload.tag || "timetable",
      });
      try {
        await webpush.sendNotification(
          { endpoint: sub.data.endpoint, keys: sub.data.keys },
          body,
          { TTL: 24 * 3600 }
        );
        result.sent++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          // 만료된 구독 — 정리
          try {
            await pushSubsColRef(domain).doc(sub.id).delete();
            result.removed++;
          } catch {
            result.failed++;
          }
        } else {
          console.error(`[web_push] 발송 실패 (${sub.data.email}, ${code || "?"}):`, e?.message);
          result.failed++;
        }
      }
    })
  );
  return result;
}

async function listSubsByEmails(domain: string, emails: string[]): Promise<SubWithId[]> {
  const uniq = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out: SubWithId[] = [];
  // Firestore 'in' 쿼리 상한(30) 단위 청크
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    const snap = await pushSubsColRef(domain).where("email", "in", chunk).get();
    snap.forEach((d) => out.push({ id: d.id, data: d.data() as PushSubscriptionDoc }));
  }
  return out;
}

async function listSubsByClass(
  domain: string,
  grade: number,
  classNum: number
): Promise<SubWithId[]> {
  const snap = await pushSubsColRef(domain)
    .where("grade", "==", grade)
    .where("classNum", "==", classNum)
    .get();
  const out: SubWithId[] = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() as PushSubscriptionDoc }));
  return out;
}

/** 본인 이메일의 전 기기 구독으로 발송 (test_send용) */
export async function sendPushToEmail(
  domain: string,
  email: string,
  payload: PushPayload
): Promise<PushSendResult & { subscriptions: number }> {
  const subs = await listSubsByEmails(domain, [email]);
  const r = await sendToSubs(domain, subs, payload);
  return { ...r, subscriptions: subs.length };
}

// ── 시간표 변경 → 수신자 도출·문구 (스펙 §4) ──────────────────

const DAY_NAMES = ["", "월", "화", "수", "목", "금"];

/** weekId(월요일 "2026-09-07") + 요일(1~5) → "9/8(화)" */
function dateLabel(weekId: string, day: number): string {
  const base = new Date(`${weekId}T00:00:00Z`);
  if (isNaN(base.getTime()) || !(day >= 1 && day <= 5)) return DAY_NAMES[day] || "";
  const d = new Date(base.getTime() + (day - 1) * 86400000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DAY_NAMES[day]})`;
}

interface ChangeAudience {
  line: string;
  teacherEmails: string[];
  classKey?: { grade: number; classNum: number };
}

function describeChange(change: TimetableChange): ChangeAudience | null {
  const revert = change.revertOf ? "변경 취소: " : "";
  if (change.swap) {
    const { grade, classNum, a, b } = change.swap;
    return {
      line:
        `${revert}${dateLabel(change.weekId, a.day)} ${a.period}교시 ${a.subjectName}` +
        ` ↔ ${dateLabel(change.weekId, b.day)} ${b.period}교시 ${b.subjectName} (${grade}-${classNum}반)`,
      teacherEmails: [a.teacherEmail, b.teacherEmail],
      classKey: { grade, classNum },
    };
  }
  if (change.substitute) {
    const s = change.substitute;
    return {
      line:
        `${revert}${dateLabel(change.weekId, s.day)} ${s.period}교시 ${s.subjectName} 보강` +
        ` — ${s.subTeacherName} 선생님 (${s.grade}-${s.classNum}반)`,
      teacherEmails: [s.absentTeacherEmail, s.subTeacherEmail],
      classKey: { grade: s.grade, classNum: s.classNum },
    };
  }
  if (change.crossSwap) {
    const c = change.crossSwap;
    // §5c-8: 한쪽이 없는 교차 주 이동 — 빠지기만 하거나 들어오기만 하는 표현
    return {
      line:
        `${revert}${dateLabel(change.weekId, c.day)} ${c.period}교시` +
        ` ${c.out ? c.out.subjectName : "빈 교시"} → ${c.in ? c.in.subjectName : "빈 교시"} (${c.grade}-${c.classNum}반)`,
      teacherEmails: [c.out?.teacherEmail, c.in?.teacherEmail].filter(
        (e): e is string => !!e
      ),
      classKey: { grade: c.grade, classNum: c.classNum },
    };
  }
  if (change.move) {
    // 통 이동의 빈 교시 반 — 상대 없는 단순 이동 (consent_swap_opening_spec §5b-1)
    const m = change.move;
    return {
      line:
        `${revert}${dateLabel(change.weekId, m.from.day)} ${m.from.period}교시 ${m.subjectName}` +
        ` → ${dateLabel(change.weekId, m.to.day)} ${m.to.period}교시 (${m.grade}-${m.classNum}반)`,
      teacherEmails: [m.teacherEmail],
      classKey: { grade: m.grade, classNum: m.classNum },
    };
  }
  return null;
}

function buildPayload(lines: string[], tagSeed: string): PushPayload {
  const MAX_LINES = 4;
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`외 ${lines.length - MAX_LINES}건`);
  return {
    title: lines.length > 1 ? `시간표 변경 ${lines.length}건` : "시간표 변경 안내",
    body: shown.join("\n"),
    // §3-2d S5(15번): 고정 tag는 브라우저가 이전 알림을 통째로 교체해, 승인·취소를 여러 번
    // 나눠 하면 마지막 1건만 남아 "1건만 바뀐 것"처럼 보였다. 발송 호출 단위로 tag를 달리해
    // 호출 간 교체를 막는다 — 한 호출 안의 여러 건은 여전히 lines 집계(외 N건)로 1건 발송.
    // 눌렀을 때 시간표 운영 화면으로 (2026-08-21). 종전에는 url 자체가 없어
    // 서비스 워커 기본값 "/" 로 떨어졌다 — 학생 구독은 발송 단계에서 /student 로 바뀐다.
    navQuery: "nav=timetable_operation",
    tag: `timetable-${tagSeed}`,
  };
}

/**
 * 시간표 변경 발송 훅 (스펙 §5) — 당사자 교사 + 해당 반 학생 구독으로 푸시.
 * 여러 건(직권 일괄 반영)은 수신자별로 1건으로 집계. 절대 throw하지 않는다.
 */
export async function notifyTimetableChanges(
  domain: string,
  changes: TimetableChange[]
): Promise<void> {
  try {
    if (changes.length === 0) return;
    // 푸시 미설정이어도 원장(알림 센터) 기록은 진행한다 — 푸시는 초인종, 원장이 본체
    // (notification_center_spec §3). 발송 구간만 설정 여부로 가른다.
    const pushConfigured = isWebPushConfigured();

    // revert 문서는 수신자 정보(swap/substitute/crossSwap)를 담지 않으므로
    // 원본 change를 로드해 "변경 취소" 문구로 합성한다 (server.ts revert 트랜잭션 구조 참조)
    const resolved: TimetableChange[] = [];
    for (const change of changes) {
      if (change.revertOf && !change.swap && !change.substitute && !change.crossSwap && !change.move) {
        const snap = await timetableChangesColRef(domain).doc(change.revertOf).get();
        if (snap.exists) {
          resolved.push({ ...(snap.data() as TimetableChange), id: change.id, revertOf: change.revertOf });
        }
      } else {
        resolved.push(change);
      }
    }

    const emailLines = new Map<string, string[]>();
    const classLines = new Map<string, { grade: number; classNum: number; lines: string[] }>();
    for (const change of resolved) {
      const a = describeChange(change);
      if (!a) continue;
      for (const email of a.teacherEmails) {
        const key = email.trim().toLowerCase();
        if (!key) continue;
        if (!emailLines.has(key)) emailLines.set(key, []);
        emailLines.get(key)!.push(a.line);
      }
      if (a.classKey) {
        const key = `${a.classKey.grade}-${a.classKey.classNum}`;
        if (!classLines.has(key)) classLines.set(key, { ...a.classKey, lines: [] });
        classLines.get(key)!.lines.push(a.line);
      }
    }

    // 원장 기록 (notification_center_spec §3 ①) — 수업 변경의 모든 경로(승인·직권·통 이동·
    // 되돌림)가 이 함수를 지나므로 여기가 단일 배선 지점이다. 교사만 — 학생은 반 단위라
    // 원장 문서가 인원수만큼 불어나 푸시(초인종)로만 유지한다.
    try {
      await emitNotificationsBatch(
        domain,
        [...emailLines.entries()].map(([email, lines]) => ({
          recipientEmail: email,
          type: "lesson-changed" as const,
          title: lines.length > 1 ? `${lines[0]} 외 ${lines.length - 1}건` : lines[0],
          refType: "timetable_change",
          refId: changes[0]?.id || "",
        }))
      );
    } catch (e) {
      console.error("[알림 센터] 수업 변경 원장 기록 실패(푸시는 계속):", (e as Error)?.message);
    }

    if (!pushConfigured) return;

    // 교사: 이메일 묶음 1회 조회 후 수신자별 페이로드
    const teacherSubs = await listSubsByEmails(domain, [...emailLines.keys()]);
    const sends: Promise<PushSendResult>[] = [];
    const byEmail = new Map<string, SubWithId[]>();
    for (const sub of teacherSubs) {
      const key = sub.data.email;
      if (!byEmail.has(key)) byEmail.set(key, []);
      byEmail.get(key)!.push(sub);
    }
    const tagSeed = changes[0]?.id || String(Date.now());
    for (const [email, subs] of byEmail) {
      const lines = emailLines.get(email);
      if (lines?.length) sends.push(sendToSubs(domain, subs, buildPayload(lines, tagSeed)));
    }

    // 학생: 반 단위 조회 (구독 문서의 학년·반 스냅샷 기반)
    for (const { grade, classNum, lines } of classLines.values()) {
      const subs = await listSubsByClass(domain, grade, classNum);
      // 학생 구독만 — 교사 구독에 학년·반이 들어갈 일은 없지만 이중 방어
      const studentSubs = subs.filter((s) => s.data.role === "student");
      if (studentSubs.length) sends.push(sendToSubs(domain, studentSubs, buildPayload(lines, tagSeed)));
    }

    const results = await Promise.all(sends);
    const total = results.reduce(
      (acc, r) => ({ sent: acc.sent + r.sent, removed: acc.removed + r.removed, failed: acc.failed + r.failed }),
      { sent: 0, removed: 0, failed: 0 }
    );
    if (total.sent + total.removed + total.failed > 0) {
      console.log(
        `[web_push] 시간표 변경 ${changes.length}건 알림 — 발송 ${total.sent}, 만료 정리 ${total.removed}, 실패 ${total.failed}`
      );
    }
  } catch (e: any) {
    console.error("[web_push] 변경 알림 처리 실패:", e?.message || e);
  }
}

/**
 * 쪽지 발송 알림 (docs/memo_spec.md §2-6·§5).
 * - tag는 쪽지별 — 여러 쪽지 알림이 서로 덮어쓰지 않는다(시간표의 단일 tag 집계와 반대).
 * - 페이로드는 발신자 이름·제목까지만 — 본문·수신자 목록 금지(잠금화면 노출 텍스트).
 * - 어떤 실패도 throw하지 않는다 — 알림 실패가 쪽지 저장을 깨면 안 된다.
 */
/** 업무 지시 푸시 (phase8_tasks_spec §6) — 제목만, 실패 무해(발송이 저장을 깨면 안 됨) */
export async function notifyTask(
  domain: string,
  recipientEmails: string[],
  senderName: string,
  title: string,
  taskId: string,
  headline: string
): Promise<void> {
  try {
    if (!isWebPushConfigured()) return;
    const subs = await listSubsByEmails(domain, recipientEmails);
    if (subs.length === 0) return;
    const shortTitle = title.length > 60 ? title.slice(0, 59) + "…" : title;
    const r = await sendToSubs(domain, subs, {
      title: headline,
      body: `${senderName} 선생님: ${shortTitle}`,
      // 눌렀을 때 그 업무가 열리게 (2026-08-21) — 위 쪽지와 같은 이유
      navQuery: `nav=tasks&id=${encodeURIComponent(taskId)}`,
      tag: `task:${taskId}`,
    });
    console.log(`[web_push] 업무 알림 — 발송 ${r.sent}, 만료 정리 ${r.removed}, 실패 ${r.failed}`);
  } catch (e: any) {
    console.error("[web_push] 업무 알림 처리 실패:", e?.message || e);
  }
}

export async function notifyMemo(
  domain: string,
  recipientEmails: string[],
  senderName: string,
  title: string,
  memoId: string
): Promise<void> {
  try {
    if (!isWebPushConfigured()) return;
    const subs = await listSubsByEmails(domain, recipientEmails);
    if (subs.length === 0) return;
    const shortTitle = title.length > 60 ? title.slice(0, 59) + "…" : title;
    const r = await sendToSubs(domain, subs, {
      title: "새 쪽지",
      body: `${senderName} 선생님: ${shortTitle}`,
      // 눌렀을 때 **그 쪽지가 열리게** 한다 (2026-08-21). 종전에는 "/" 라 앱 홈만 떴다 —
      // memoId 를 tag 에만 쓰고 주소에는 안 쓰고 있었다. 착지 처리는 `/teacher` 가 한다.
      navQuery: `nav=memo&id=${encodeURIComponent(memoId)}`,
      tag: `memo:${memoId}`,
    });
    console.log(
      `[web_push] 쪽지 알림 — 발송 ${r.sent}, 만료 정리 ${r.removed}, 실패 ${r.failed}`
    );
  } catch (e: any) {
    console.error("[web_push] 쪽지 알림 처리 실패:", e?.message || e);
  }
}
