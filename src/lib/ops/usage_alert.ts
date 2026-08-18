// Firestore 사용량 조기 경보 — I/O 계층 (판정은 usage_logic.ts, 여기는 수집·발송만)
//
// 자료 출처는 **Cloud Monitoring**이다. 앱에서 직접 세는 방식(자가 계수)은 이 시스템에서
// 성립하지 않는다 — 읽기의 다수가 브라우저의 onSnapshot 구독이라 서버를 지나지 않는다.
// 서버에서 센 숫자는 가장 큰 비용원을 통째로 놓친다.
//
// ── 권한 (2026-08-18 실측) ───────────────────────────────────────────────
// 서비스 계정 school-sync-hub-admin@ 은 현재 이 지표를 읽을 수 없다 (403 Permission denied).
// 필요한 것은 GCP 프로젝트 school-sync-hub 에서 이 서비스 계정에 **모니터링 뷰어**
// (roles/monitoring.viewer) 부여 + Cloud Monitoring API 사용 설정.
// 그래서 이 모듈은 **권한이 없으면 조용히 no-op**이고(가짜 경보를 내지 않는다),
// 권한이 생기는 순간 재배포 없이 스스로 동작하기 시작한다.
import { adminDb } from "@/lib/firebase/admin";
import { emitNotificationsBatch } from "@/lib/notifications/server";
import {
  AlertLevel,
  AlertState,
  DailyUsage,
  EMPTY_ALERT_STATE,
  UsageRatio,
  buildAlertText,
  computeLevel,
  decideEmit,
  lastCompletePacificDay,
} from "./usage_logic";
import { UnavailableReason, fetchTotal, toUnavailable } from "./monitoring";

const stateRef = () => adminDb.collection("platform_config").doc("usage_alert");

export type { UnavailableReason };

export interface UsageFetchResult {
  available: boolean;
  reason?: UnavailableReason;
  detail?: string;
  usage?: DailyUsage;
}

/** 마지막 완결 태평양 날짜의 사용량 — 권한이 없으면 available:false (0이 아니다) */
export async function fetchDailyUsage(now = new Date()): Promise<UsageFetchResult> {
  const { day, startMs, endMs } = lastCompletePacificDay(now);
  try {
    const [reads, writes, deletes] = await Promise.all([
      fetchTotal("reads", startMs, endMs),
      fetchTotal("writes", startMs, endMs),
      fetchTotal("deletes", startMs, endMs),
    ]);
    return { available: true, usage: { day, reads, writes, deletes } };
  } catch (err: any) {
    const u = toUnavailable(err);
    return { available: false, reason: u.reason, detail: u.detail };
  }
}

/**
 * 경보 수신자.
 *
 * ⚠️ **role == "super_admin" 으로 뽑으면 안 된다** (2026-08-18 실측으로 확인된 함정).
 * 이 학교에서 수퍼어드민 4개는 전부 **상시 로그인하지 않는 계정**이다:
 *   - admin@·admin2@·admin3@ = 관리자 3인의 **권한 전용** 계정(평소엔 각자 일반 계정 사용)
 *   - fb01@ = 플랫폼 운영 계정
 * 즉 role로 뽑은 수신자에게 보내면 **아무도 보지 못한다.** 알림은 조용히 성공하고
 * 사람은 영영 모르는, 가장 나쁜 형태의 실패다.
 *
 * 그래서 수신자는 **사람이 지정한 목록**을 우선한다 —
 * `platform_config/usage_alert.recipients` (이메일 배열, 상시 쓰는 일반 계정).
 * 목록이 없을 때만 super_admin으로 폴백하고, 그 사실을 요약에 남긴다.
 */
async function findAlertRecipients(): Promise<{ emails: string[]; source: "configured" | "role-fallback" }> {
  const snap = await stateRef().get();
  const configured = snap.exists ? (snap.data() || {}).recipients : null;
  if (Array.isArray(configured)) {
    const emails = configured
      .filter((e): e is string => typeof e === "string" && e.includes("@"))
      .map((e) => e.trim().toLowerCase());
    if (emails.length) return { emails: [...new Set(emails)], source: "configured" };
  }

  const users = await adminDb.collection("users").where("role", "==", "super_admin").get();
  const emails = new Set<string>();
  users.forEach((d) => {
    const email = (d.data() || {}).email;
    if (typeof email === "string" && email.includes("@")) emails.add(email.trim().toLowerCase());
  });
  return { emails: [...emails], source: "role-fallback" };
}

async function readState(): Promise<AlertState> {
  const snap = await stateRef().get();
  if (!snap.exists) return { ...EMPTY_ALERT_STATE };
  const d = snap.data() || {};
  const lastLevel: AlertLevel = d.lastLevel === 80 ? 80 : d.lastLevel === 50 ? 50 : 0;
  return {
    lastLevel,
    lastEmittedAt: typeof d.lastEmittedAt === "number" ? d.lastEmittedAt : 0,
    ...(typeof d.lastDay === "string" ? { lastDay: d.lastDay } : {}),
  };
}

export interface UsageAlertSummary {
  dryRun: boolean;
  /** 지표를 읽었는가 — false면 아래 usage·level은 없다 */
  available: boolean;
  reason?: UnavailableReason;
  detail?: string;
  day?: string;
  usage?: DailyUsage;
  level?: AlertLevel;
  /** 가장 많이 쓴 지표 (판정 근거) */
  top?: UsageRatio;
  /** 발송 여부 판정 사유 */
  decision?: string;
  /** 실제로 만든 알림 수 */
  emitted: number;
  recipients: number;
  /**
   * 수신자를 어디서 얻었는가. `role-fallback`이면 **사람이 못 볼 가능성이 높다** —
   * 이 학교의 super_admin은 전부 상시 로그인하지 않는 계정이다(findAlertRecipients 주석).
   */
  recipientSource?: "configured" | "role-fallback";
}

/**
 * 하루 1회 실행 — 전일(태평양) 사용량을 읽어 임계 초과 시 최고 관리자에게 알림 1건.
 * 실패해도 던지지 않는다: 이 경보가 크론의 다른 작업을 무너뜨리면 본말전도다.
 */
export async function runUsageAlert(
  domain: string,
  opts: { dryRun?: boolean; now?: Date } = {}
): Promise<UsageAlertSummary> {
  const dryRun = !!opts.dryRun;
  const now = opts.now ?? new Date();

  const fetched = await fetchDailyUsage(now);
  if (!fetched.available || !fetched.usage) {
    return {
      dryRun,
      available: false,
      reason: fetched.reason,
      detail: fetched.detail,
      emitted: 0,
      recipients: 0,
    };
  }

  const usage = fetched.usage;
  const { level, top } = computeLevel(usage);
  const state = await readState();
  const decision = decideEmit(level, state, now.getTime(), usage.day);

  const base: UsageAlertSummary = {
    dryRun,
    available: true,
    day: usage.day,
    usage,
    level,
    top,
    decision: decision.reason,
    emitted: 0,
    recipients: 0,
  };

  if (!decision.emit) {
    if (!dryRun) await stateRef().set(decision.nextState, { merge: true });
    return base;
  }

  const { emails: admins, source } = await findAlertRecipients();
  base.recipients = admins.length;
  base.recipientSource = source;
  if (!admins.length) {
    // 상태는 진전시키지 않는다 — 수신자가 생기면 그때 알려야 한다
    return { ...base, decision: `${decision.reason} · 수신자 없음(super_admin 0명) — 발송 보류` };
  }

  const { title, message } = buildAlertText(level, top, usage.day);
  if (!dryRun) {
    base.emitted = await emitNotificationsBatch(
      domain,
      admins.map((email) => ({
        recipientEmail: email,
        type: "admin-action" as const,
        title,
        message,
        refType: "usage_alert",
        refId: usage.day,
      }))
    );
    await stateRef().set(decision.nextState, { merge: true });
  } else {
    base.emitted = admins.length; // 예상 발송 수
  }
  return base;
}

// ── 수신자 관리 (어드민 화면에서 편집) ──────────────────────────────────

export const MAX_ALERT_RECIPIENTS = 10;

export interface RecipientsView {
  recipients: string[];
  /** configured = 사람이 지정함 / role-fallback = 아직 미지정이라 자동 추정 중 */
  source: "configured" | "role-fallback";
  /** 자동 추정 상태라 아무도 못 볼 수 있다는 경고를 화면이 띄울지 */
  needsAttention: boolean;
}

export async function getAlertRecipients(): Promise<RecipientsView> {
  const { emails, source } = await findAlertRecipients();
  return { recipients: emails, source, needsAttention: source === "role-fallback" };
}

export interface SetRecipientsResult {
  ok: boolean;
  error?: string;
  view?: RecipientsView;
}

/**
 * 수신자 목록 저장.
 *
 * **플랫폼에 실재하는 계정만 받는다.** 오타나 없는 주소를 허용하면 알림이 만들어지고도
 * 아무도 못 보는 상태가 된다 — 이 기능이 존재하는 이유가 바로 그 실패였다(2026-08-18).
 * 조용히 무시하지 않고 어느 주소가 문제인지 돌려준다.
 */
export async function setAlertRecipients(input: unknown): Promise<SetRecipientsResult> {
  if (!Array.isArray(input)) return { ok: false, error: "주소 목록이 필요합니다." };

  const cleaned = [
    ...new Set(
      input
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (cleaned.length > MAX_ALERT_RECIPIENTS) {
    return { ok: false, error: `받는 사람은 ${MAX_ALERT_RECIPIENTS}명까지 지정할 수 있습니다.` };
  }

  const malformed = cleaned.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (malformed.length) {
    return { ok: false, error: `주소 형식이 올바르지 않습니다: ${malformed.join(", ")}` };
  }

  // 실재 확인 — 없는 계정에 보내면 알림은 생기고 아무도 못 본다
  const unknown: string[] = [];
  for (const email of cleaned) {
    const snap = await adminDb.collection("users").where("email", "==", email).limit(1).get();
    if (snap.empty) unknown.push(email);
  }
  if (unknown.length) {
    return {
      ok: false,
      error: `이 플랫폼에 로그인한 적 없는 계정입니다: ${unknown.join(", ")} — 한 번 로그인한 뒤 다시 지정해 주세요.`,
    };
  }

  await stateRef().set({ recipients: cleaned }, { merge: true });
  return { ok: true, view: await getAlertRecipients() };
}
