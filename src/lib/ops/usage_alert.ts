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
import { google } from "googleapis";
import { adminDb } from "@/lib/firebase/admin";
import { emitNotificationsBatch } from "@/lib/notifications/server";
import {
  AlertLevel,
  AlertState,
  DailyUsage,
  EMPTY_ALERT_STATE,
  UsageMetric,
  UsageRatio,
  buildAlertText,
  computeLevel,
  decideEmit,
  lastCompletePacificDay,
} from "./usage_logic";

const stateRef = () => adminDb.collection("platform_config").doc("usage_alert");

const METRIC_TYPE: Record<UsageMetric, string> = {
  reads: "firestore.googleapis.com/document/read_count",
  writes: "firestore.googleapis.com/document/write_count",
  deletes: "firestore.googleapis.com/document/delete_count",
};

/** 지표를 읽을 수 없는 이유 — 경보 부재와 "사용량 0"을 절대 혼동하지 않기 위해 분리한다 */
export type UnavailableReason = "no-credentials" | "permission-denied" | "api-error";

export interface UsageFetchResult {
  available: boolean;
  reason?: UnavailableReason;
  detail?: string;
  usage?: DailyUsage;
}

function monitoringClient() {
  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const clientEmail = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) return null;

  // subject(사칭) 없음 — Workspace 사용자 자원이 아니라 GCP 프로젝트 자원이다
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/monitoring.read"],
  });
  return { api: google.monitoring({ version: "v3", auth }), projectId };
}

/** 하루치 합계 1종 조회 — 시계열이 여러 개(데이터베이스별)면 전부 더한다 */
async function fetchMetricSum(
  api: ReturnType<typeof google.monitoring>,
  projectId: string,
  metric: UsageMetric,
  startMs: number,
  endMs: number
): Promise<number> {
  const res = await api.projects.timeSeries.list({
    name: `projects/${projectId}`,
    filter: `metric.type="${METRIC_TYPE[metric]}"`,
    "interval.startTime": new Date(startMs).toISOString(),
    "interval.endTime": new Date(endMs).toISOString(),
    "aggregation.alignmentPeriod": "86400s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  });
  let total = 0;
  for (const series of res.data.timeSeries || []) {
    for (const point of series.points || []) {
      const v = point.value || {};
      total += Number(v.int64Value ?? v.doubleValue ?? 0);
    }
  }
  return total;
}

/** 마지막 완결 태평양 날짜의 사용량 — 권한이 없으면 available:false (0이 아니다) */
export async function fetchDailyUsage(now = new Date()): Promise<UsageFetchResult> {
  const client = monitoringClient();
  if (!client) return { available: false, reason: "no-credentials" };

  const { day, startMs, endMs } = lastCompletePacificDay(now);
  try {
    const [reads, writes, deletes] = await Promise.all([
      fetchMetricSum(client.api, client.projectId, "reads", startMs, endMs),
      fetchMetricSum(client.api, client.projectId, "writes", startMs, endMs),
      fetchMetricSum(client.api, client.projectId, "deletes", startMs, endMs),
    ]);
    return { available: true, usage: { day, reads, writes, deletes } };
  } catch (err: any) {
    const code = err?.code ?? err?.response?.status;
    const detail = String(err?.message || err).slice(0, 300);
    if (code === 403 || code === 401) return { available: false, reason: "permission-denied", detail };
    return { available: false, reason: "api-error", detail };
  }
}

/** 경보 수신자 = 최고 관리자 전원 (일반 교사에게 보낼 성격이 아니다) */
async function findAdminEmails(): Promise<string[]> {
  const snap = await adminDb.collection("users").where("role", "==", "super_admin").get();
  const emails = new Set<string>();
  snap.forEach((d) => {
    const email = (d.data() || {}).email;
    if (typeof email === "string" && email.includes("@")) emails.add(email.trim().toLowerCase());
  });
  return [...emails];
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

  const admins = await findAdminEmails();
  base.recipients = admins.length;
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
