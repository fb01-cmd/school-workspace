// Cloud Monitoring 접근 공통층 — 일일 경보(usage_alert)와 사용량 화면(usage_query)이 공유한다.
//
// ⚠️ 이 파일을 고칠 때 반드시 지킬 것 (2026-08-18 실사고):
// **집계 구간의 경계는 반드시 태평양 자정에 맞춘다.** `alignmentPeriod: 86400s`의 24시간
// 버킷은 요청 구간을 기준으로 잘리므로, 구간을 "지금부터 N일 전"처럼 임의 시각으로 자르면
// 버킷이 자정에 걸리지 않아 **날짜별 수치가 통째로 어긋난다**. 첫 구현에서 8/16이 12,156으로
// 나왔으나 자정 정렬 후 36,882(실제)였다 — 1/3로 틀렸다. 구간 계산은 usage_logic.ts의
// 태평양 헬퍼를 통해서만 만든다.
import { google } from "googleapis";
import { UsageMetric } from "./usage_logic";

export const METRIC_TYPE: Record<UsageMetric, string> = {
  reads: "firestore.googleapis.com/document/read_count",
  writes: "firestore.googleapis.com/document/write_count",
  deletes: "firestore.googleapis.com/document/delete_count",
};

/** 지표를 읽을 수 없는 이유 — 경보·화면 어디서도 "사용량 0"과 혼동하지 않기 위해 분리한다 */
export type UnavailableReason = "no-credentials" | "permission-denied" | "api-error";

export class MonitoringUnavailable extends Error {
  constructor(public reason: UnavailableReason, public detail?: string) {
    super(detail || reason);
    this.name = "MonitoringUnavailable";
  }
}

type MonitoringApi = ReturnType<typeof google.monitoring>;

/**
 * 서비스 계정 본인 자격(사칭 없음 — GCP 프로젝트 자원이지 Workspace 사용자 자원이 아니다).
 * 필요한 역할 = roles/monitoring.viewer 이상.
 * ⚠️ 「모니터링 서비스 편집자」(roles/monitoring.servicesEditor)는 SLO 관리용이라 무효다
 *    — 2026-08-18 실측에서 이것만 부여됐을 때 403이었고, roles/monitoring.editor로 통과했다.
 */
export function monitoringClient(): { api: MonitoringApi; projectId: string } {
  const privateKey = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const clientEmail = process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!privateKey || !clientEmail || !projectId) {
    throw new MonitoringUnavailable("no-credentials");
  }
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/monitoring.read"],
  });
  return { api: google.monitoring({ version: "v3", auth }), projectId };
}

/** 에러를 사유로 접어 준다 — 호출부가 try/catch 문자열 파싱을 반복하지 않도록 */
export function toUnavailable(err: any): MonitoringUnavailable {
  if (err instanceof MonitoringUnavailable) return err;
  const code = err?.code ?? err?.response?.status;
  const detail = String(err?.message || err).slice(0, 300);
  if (code === 403 || code === 401) return new MonitoringUnavailable("permission-denied", detail);
  return new MonitoringUnavailable("api-error", detail);
}

export interface Bucket {
  /** 버킷 시작 시각(ms) — 날짜·시각 라벨은 호출부가 붙인다 */
  startMs: number;
  value: number;
}

/**
 * 한 지표를 구간 [startMs, endMs)에서 alignmentSeconds 단위로 합산해 버킷 배열로 돌려준다.
 * 시계열이 여러 개(데이터베이스별)면 같은 버킷끼리 더한다.
 */
export async function fetchBuckets(
  metric: UsageMetric,
  startMs: number,
  endMs: number,
  alignmentSeconds: number
): Promise<Bucket[]> {
  const { api, projectId } = monitoringClient();
  const res = await api.projects.timeSeries.list({
    name: `projects/${projectId}`,
    filter: `metric.type="${METRIC_TYPE[metric]}"`,
    "interval.startTime": new Date(startMs).toISOString(),
    "interval.endTime": new Date(endMs).toISOString(),
    "aggregation.alignmentPeriod": `${alignmentSeconds}s`,
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  });

  const byStart = new Map<number, number>();
  for (const series of res.data.timeSeries || []) {
    for (const point of series.points || []) {
      // 버킷 라벨은 **시작 시각** 기준. 끝 시각을 쓰면 하루/한 시간씩 밀린다.
      const iso = point.interval?.startTime;
      if (!iso) continue;
      const at = Date.parse(iso);
      const v = Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
      byStart.set(at, (byStart.get(at) || 0) + v);
    }
  }
  return [...byStart.entries()]
    .map(([startMs, value]) => ({ startMs, value }))
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * 구간 전체 합계.
 *
 * ⚠️ **구간 길이를 그대로 alignmentPeriod로 주면 안 된다** (2026-08-18 실사고).
 * 진행 중인 하루처럼 길이가 어중간한 구간에서는 정렬이 맞지 않아 Monitoring이 버킷을
 * 2개로 쪼개 돌려주고, 전부 더하면 **같은 구간을 두 번 세게 된다.**
 * 실측: 같은 시각을 세 번 물었더니 13,577 → 47,477 → 13,577로 튀었다(시간별 합은
 * 13,107로 안정). 화면의 "오늘 사용량"이 경고와 정상을 오가던 원인이 이것이다.
 *
 * 그래서 **작은 고정 간격으로 쪼개 더한다.** 간격이 작으면 경계 오차도 작고 버킷이
 * 겹치지 않는다.
 */
const TOTAL_BUCKET_SECONDS = 300;

export async function fetchTotal(metric: UsageMetric, startMs: number, endMs: number): Promise<number> {
  const buckets = await fetchBuckets(metric, startMs, endMs, TOTAL_BUCKET_SECONDS);
  return buckets.reduce((a, b) => a + b.value, 0);
}
