/**
 * 사용량 추세 실측 — 최근 N일 일자별 조회·저장·삭제 (태평양 날짜 기준)
 *
 * 무료 복귀 판단(크레딧 만료 ~11월 중순)의 근거 자료를 뽑는다.
 * 사용량 화면(docs/usage_dashboard_spec.md)의 §1-2와 같은 자료원·같은 구간 계산.
 *
 * 실행: npx tsx --env-file=.env.local scripts/inspect_usage_history.ts [일수]
 */
import { google } from "googleapis";
import { FIRESTORE_FREE_DAILY, lastCompletePacificDay } from "../src/lib/ops/usage_logic";

const DAYS = Number(process.argv[2] || 30);

const METRIC: Record<string, string> = {
  reads: "firestore.googleapis.com/document/read_count",
  writes: "firestore.googleapis.com/document/write_count",
  deletes: "firestore.googleapis.com/document/delete_count",
};

function client() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/monitoring.read"],
  });
  return {
    api: google.monitoring({ version: "v3", auth }),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  };
}

/** 태평양 날짜 라벨 — 정렬 키 겸 표시용 */
function pacificDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

async function series(kind: string, startMs: number, endMs: number) {
  const { api, projectId } = client();
  const res = await api.projects.timeSeries.list({
    name: `projects/${projectId}`,
    filter: `metric.type="${METRIC[kind]}"`,
    "interval.startTime": new Date(startMs).toISOString(),
    "interval.endTime": new Date(endMs).toISOString(),
    "aggregation.alignmentPeriod": "86400s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
  });
  const byDay = new Map<string, number>();
  for (const s of res.data.timeSeries || []) {
    for (const p of s.points || []) {
      // 구간 시작 시각으로 날짜를 정한다 (끝 시각은 다음 날 자정이라 하루 밀린다)
      const startIso = p.interval?.startTime;
      if (!startIso) continue;
      const day = pacificDay(Date.parse(startIso));
      const v = Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0);
      byDay.set(day, (byDay.get(day) || 0) + v);
    }
  }
  return byDay;
}

function bar(pct: number, width = 40) {
  const filled = Math.min(width, Math.round((pct / 100) * width));
  const over = pct > 100;
  return (over ? "!" : "").padEnd(0) + "█".repeat(filled) + "·".repeat(Math.max(0, width - filled));
}

async function main() {
  // ⚠️ 구간 경계를 반드시 태평양 자정에 맞춘다. 그냥 "지금부터 30일 전"으로 자르면
  // 24시간 버킷이 자정이 아닌 시각에 걸려 날짜별 수치가 통째로 어긋난다
  // (첫 실행에서 8/16이 12,156으로 나왔으나 자정 정렬 후 36,882 — 3배 차이).
  const end = lastCompletePacificDay(new Date()).endMs; // = 진행 중인 태평양 날짜의 자정
  const start = end - DAYS * 86400_000;

  const [reads, writes, deletes] = await Promise.all([
    series("reads", start, end),
    series("writes", start, end),
    series("deletes", start, end),
  ]);

  const days = [...new Set([...reads.keys(), ...writes.keys(), ...deletes.keys()])].sort();

  console.log(`\n최근 ${DAYS}일 사용량 (태평양 날짜 기준 · 하루 무료 조회 ${FIRESTORE_FREE_DAILY.reads.toLocaleString()}건)\n`);
  console.log("날짜          조회      %   " + " ".repeat(34) + "저장     삭제");
  console.log("─".repeat(96));

  let overLimit = 0;
  let over50 = 0;
  for (const d of days) {
    const r = reads.get(d) || 0;
    const w = writes.get(d) || 0;
    const x = deletes.get(d) || 0;
    const pct = (r / FIRESTORE_FREE_DAILY.reads) * 100;
    if (pct >= 100) overLimit++;
    if (pct >= 50) over50++;
    const mark = pct >= 100 ? "🔴" : pct >= 80 ? "🟠" : pct >= 50 ? "🟡" : "  ";
    console.log(
      `${d} ${String(r).padStart(8)} ${pct.toFixed(0).padStart(4)}% ${mark} ${bar(pct)} ${String(w).padStart(7)} ${String(x).padStart(7)}`
    );
  }

  const vals = days.map((d) => reads.get(d) || 0);
  const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const max = Math.max(...vals, 0);
  console.log("─".repeat(96));
  console.log(`  일수 ${days.length} · 평균 조회 ${Math.round(avg).toLocaleString()} · 최대 ${max.toLocaleString()}`);
  console.log(`  한도 초과일 ${overLimit}일 · 절반 초과일 ${over50}일`);
  console.log(
    `\n  무료 복귀 판정: ${
      overLimit > 0
        ? "❌ 불가 — 한도를 넘긴 날이 있다 (그날 서비스가 멈춘다)"
        : max > FIRESTORE_FREE_DAILY.reads * 0.8
        ? "⚠️  위험 — 최대치가 한도의 80%를 넘는다. 절감 없이 복귀하면 급증일에 멈춘다"
        : "✅ 여유 있음"
    }\n`
  );
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
