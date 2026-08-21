import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { buildSavingBannerText } from "@/lib/ops/saving_logic";

export interface MetricPoint {
  label: string;
  reads: number;
  writes: number;
  deletes: number;
}

export interface AlertRecipientsInfo {
  recipients: string[];
  source: "configured" | "role-fallback";
  needsAttention: boolean;
}

export interface UsageSnapshot {
  available: boolean;
  reason?: string;
  detail?: string;
  generatedAt: number;
  lagMinutes: number;
  resetHourLabel?: string;
  dailyBarNote?: string;
  limits?: {
    reads: number;
    writes: number;
    deletes: number;
  };
  today?: {
    day: string;
    reads: number;
    writes: number;
    deletes: number;
    level: 0 | 50 | 80;
    topMetric: "reads" | "writes" | "deletes";
    topPercent: number;
    /** 한국 시간 구간 문구 — 태평양 날짜를 그대로 보이면 날짜가 어긋나 보인다 */
    periodLabel?: string;
  };
  daily?: MetricPoint[];
  hourly?: MetricPoint[];
  alert?: AlertRecipientsInfo;
}

type MetricKey = "reads" | "writes" | "deletes";

const METRIC_NAMES: Record<MetricKey, { name: string; desc: string; color: string }> = {
  reads: { name: "조회", desc: "데이터 읽기", color: "indigo" },
  writes: { name: "저장", desc: "데이터 쓰기·수정", color: "blue" },
  deletes: { name: "삭제", desc: "데이터 삭제", color: "slate" },
};

export default function UsageDashboardTab() {
  const { savingMode, userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isSavingToggling, setIsSavingToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [selectedDailyMetric, setSelectedDailyMetric] = useState<MetricKey>("reads");
  const [selectedHourlyMetric, setSelectedHourlyMetric] = useState<MetricKey>("reads");
  const [hoveredDailyIndex, setHoveredDailyIndex] = useState<number | null>(null);
  const [hoveredHourlyIndex, setHoveredHourlyIndex] = useState<number | null>(null);

  // 알림 수신자 관리 상태
  const [recipientsList, setRecipientsList] = useState<string[]>([]);
  const [newRecipientInput, setNewRecipientInput] = useState("");
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [recipientSuccess, setRecipientSuccess] = useState<string | null>(null);
  const [isRecipientsDirty, setIsRecipientsDirty] = useState(false);

  useEffect(() => {
    // 편집 중이면 서버 값으로 덮지 않는다. 이 목록은 매 조회마다 새 배열로 오므로
    // 가드가 없으면 「다시 확인」 한 번에 저장 안 한 입력이 말없이 사라진다.
    // (저장 성공 경로는 handleSaveRecipients가 직접 목록을 갱신하고 dirty를 내린다.)
    if (isRecipientsDirty) return;
    if (data?.alert?.recipients) setRecipientsList(data.alert.recipients);
  }, [data?.alert?.recipients, isRecipientsDirty]);

  const handleAddRecipient = () => {
    const trimmed = newRecipientInput.trim().toLowerCase();
    if (!trimmed) return;
    setRecipientError(null);
    setRecipientSuccess(null);

    if (recipientsList.includes(trimmed)) {
      setRecipientError("이미 추가된 계정입니다.");
      return;
    }
    if (recipientsList.length >= 10) {
      setRecipientError("받는 사람은 최대 10명까지 지정할 수 있습니다.");
      return;
    }

    const next = [...recipientsList, trimmed];
    setRecipientsList(next);
    setNewRecipientInput("");
    setIsRecipientsDirty(true);
  };

  const handleRemoveRecipient = (emailToRemove: string) => {
    setRecipientError(null);
    setRecipientSuccess(null);
    const next = recipientsList.filter((e) => e !== emailToRemove);
    setRecipientsList(next);
    setIsRecipientsDirty(true);
  };

  const handleSaveRecipients = async () => {
    if (savingRecipients) return;
    setSavingRecipients(true);
    setRecipientError(null);
    setRecipientSuccess(null);

    try {
      const res = await fetch("/api/ops/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_recipients",
          recipients: recipientsList,
        }),
      });
      const resData = await res.json();
      if (!res.ok) {
        setRecipientError(resData.error || "수신자 목록을 저장하지 못했습니다.");
        return;
      }

      if (resData.alert) {
        setData((prev) => (prev ? { ...prev, alert: resData.alert } : prev));
        setRecipientsList(resData.alert.recipients || []);
      }
      setIsRecipientsDirty(false);
      setRecipientSuccess("알림 받는 사람 목록이 저장되었습니다.");
    } catch (err: any) {
      setRecipientError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSavingRecipients(false);
    }
  };

  const handleToggleSavingMode = async () => {
    if (isSavingToggling) return;
    const nextState = !savingMode.active;
    setIsSavingToggling(true);
    try {
      const res = await fetch("/api/ops/saving-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: nextState }),
      });
      const resData = await res.json();
      if (!res.ok) {
        alert(resData.error || "절약 모드 상태를 변경하지 못했습니다.");
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setIsSavingToggling(false);
    }
  };

  const fetchUsageData = useCallback(async (force = false) => {
    if (force) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = `/api/ops/usage?days=30${force ? "&force=1" : ""}`;
      const res = await fetch(url);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "사용량을 불러오지 못했습니다.");
      }

      setData(json);
    } catch (err: any) {
      setError(err.message || "사용량을 조회하는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsageData(false);
  }, [fetchUsageData]);

  // 불러온 시각 경과 계산
  const getElapsedFetchText = () => {
    if (!data?.generatedAt) return "";
    const diffMs = Math.max(0, Date.now() - data.generatedAt);
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) return "방금 불러왔습니다";
    return `${diffMinutes}분 전에 불러왔습니다`;
  };

  if (loading && !data) {
    return (
      <div className="py-24 text-center text-slate-500 space-y-4">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-indigo-600 border-t-transparent" />
        <p className="text-sm font-medium">사용량 데이터를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center space-y-3">
        <div className="text-3xl">⚠️</div>
        <p className="text-sm font-bold text-rose-900">{error}</p>
        <button
          type="button"
          onClick={() => fetchUsageData(true)}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // 권한 미부여 또는 모니터링 미활성화 상태 (available === false)
  if (data && !data.available) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-2xl border border-amber-200 dark:border-amber-900/50 text-2xl shrink-0">
              ℹ️
            </div>
            <div className="space-y-2 flex-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                사용량을 아직 볼 수 없습니다
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                데이터베이스 사용량을 집계하려면 구글 클라우드 콘솔에서 서비스 계정에 모니터링 조회 권한을 켜야 합니다.
                <span className="block mt-1 text-xs text-amber-700 dark:text-amber-400 font-medium">
                  (아직 켜지 않은 상태이며, 시스템 오류가 아닙니다.)
                </span>
              </p>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-850 rounded-xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 space-y-3 text-xs sm:text-sm">
            <div className="font-bold text-slate-800 dark:text-slate-200">
              🛠️ 연동 권한 설정 위치
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-400 leading-relaxed">
              <li>구글 클라우드 콘솔 이동</li>
              <li>[IAM 및 관리자] → 관리자 서비스 계정 선택</li>
              <li>[모니터링 편집자] 또는 [모니터링 뷰어] 역할 부여</li>
              <li>Cloud Monitoring 사용 설정 확인</li>
            </ol>
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
              권한 부여 후 아래 &apos;다시 확인&apos; 버튼을 누르면 즉시 사용량 집계가 활성화됩니다.
            </p>
          </div>

          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              onClick={() => fetchUsageData(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors shadow-sm cursor-pointer"
            >
              {refreshing ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  <span>확인 중...</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>다시 확인</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const limits = data?.limits || { reads: 50000, writes: 20000, deletes: 20000 };
  const today = data?.today || {
    day: "",
    reads: 0,
    writes: 0,
    deletes: 0,
    level: 0,
    topMetric: "reads" as MetricKey,
    topPercent: 0,
  };
  const daily = data?.daily || [];
  const hourly = data?.hourly || [];
  const lagMinutes = data?.lagMinutes || 5;

  // 30일간 선택된 지표의 일자별 통계
  const dailyMetricValues = daily.map((d) => d[selectedDailyMetric]);
  const dailyMax = dailyMetricValues.length > 0 ? Math.max(...dailyMetricValues) : 0;
  const dailyAvg = dailyMetricValues.length > 0
    ? Math.round(dailyMetricValues.reduce((a, b) => a + b, 0) / dailyMetricValues.length)
    : 0;
  const dailyLimit = limits[selectedDailyMetric];
  const chartMaxY = Math.max(dailyLimit, dailyMax, 1) * 1.15;

  // 시간대별 선택된 지표의 통계
  const hourlyMetricValues = hourly.map((h) => h[selectedHourlyMetric]);
  const hourlyMax = hourlyMetricValues.length > 0 ? Math.max(...hourlyMetricValues) : 0;
  const hourlyChartMaxY = Math.max(hourlyMax, 1) * 1.2;

  // 오늘 단계별 라벨/색상
  const getLevelBadge = (level: number, percent: number) => {
    if (level >= 80 || percent >= 80) {
      return {
        label: "경고",
        bg: "bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800",
        dot: "bg-rose-500",
      };
    }
    if (level >= 50 || percent >= 50) {
      return {
        label: "주의",
        bg: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
        dot: "bg-amber-500",
      };
    }
    return {
      label: "정상",
      bg: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
      dot: "bg-emerald-500",
    };
  };

  const todayBadge = getLevelBadge(today.level, today.topPercent);

  return (
    <div className="space-y-6">
      {/* 제목 없음 — 상단 머리줄이 「사용량」을 띄운다. 남은 것은 오늘 상태와 다시 확인 버튼이다. */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📊</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${todayBadge.bg}`}>
            <span className={`w-2 h-2 rounded-full ${todayBadge.dot}`} />
            <span>오늘 {todayBadge.label} ({Math.round(today.topPercent)}%)</span>
          </span>
        </div>

        <div className="flex items-center sm:flex-col sm:items-end justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchUsageData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors shadow-xs cursor-pointer"
          >
            {refreshing ? (
              <>
                <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                <span>불러오는 중...</span>
              </>
            ) : (
              <>
                <span>🔄</span>
                <span>다시 확인</span>
              </>
            )}
          </button>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {getElapsedFetchText()}
          </span>
        </div>
      </div>

      {/* 필수 고지 안내 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-3.5 flex items-center gap-3">
          <span className="text-lg shrink-0">⏰</span>
          <p className="text-indigo-900 dark:text-indigo-200 font-medium">
            사용량은 매일 {data?.resetHourLabel || "오후 4시"}(한국 시간)에 0으로 초기화됩니다 — 그때가 하루의 시작입니다
          </p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex items-center gap-3">
          <span className="text-lg shrink-0">📡</span>
          <p className="text-slate-700 dark:text-slate-300 font-medium">
            최근 {lagMinutes}분 이내 사용량은 아직 반영되지 않았을 수 있습니다
          </p>
        </div>
      </div>

      {/* 1. 오늘 진행 현황 (3종 막대) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🎯</span>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              이번 사용 주기 (진행 중)
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {today.periodLabel || `기준 일자: ${today.day}`}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(["reads", "writes", "deletes"] as MetricKey[]).map((key) => {
            const used = today[key] || 0;
            const limit = limits[key] || 1;
            const percent = (used / limit) * 100;
            const meta = METRIC_NAMES[key];
            const badge = getLevelBadge(percent >= 80 ? 80 : percent >= 50 ? 50 : 0, percent);

            const barColor =
              percent >= 80
                ? "bg-rose-500"
                : percent >= 50
                ? "bg-amber-500"
                : key === "reads"
                ? "bg-indigo-600"
                : key === "writes"
                ? "bg-blue-600"
                : "bg-slate-600";

            return (
              <div
                key={key}
                className="bg-slate-50/80 dark:bg-slate-850/80 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {meta.name}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-1.5">
                      ({meta.desc})
                    </span>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-black text-slate-900 dark:text-white">
                      {used.toLocaleString()}
                      <span className="text-xs font-normal text-slate-500 ml-0.5">건</span>
                    </span>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      한도 {limit.toLocaleString()}건 ({percent.toFixed(1)}%)
                    </span>
                  </div>

                  {/* 프로그레스 바 */}
                  <div className="h-3 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(100, Math.max(percent > 0 ? 1 : 0, percent))}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. 최근 30일 일자별 막대 + 무료 한도 기준선 */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-base">📅</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                최근 30일 일자별 추세
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              매일 완결된 일자별 사용량 및 한도 초과 여부를 관측합니다.
              {data?.dailyBarNote ? ` ${data.dailyBarNote}` : ""}
            </p>
          </div>

          {/* 지표 선택 탭 */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(["reads", "writes", "deletes"] as MetricKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDailyMetric(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  selectedDailyMetric === key
                    ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {METRIC_NAMES[key].name}
              </button>
            ))}
          </div>
        </div>

        {/* 30일 통계 요약 박스 */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">일평균 사용</div>
            <div className="text-base font-bold text-slate-800 dark:text-slate-100 mt-0.5">
              {dailyAvg.toLocaleString()}건
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">30일 최고치</div>
            <div className="text-base font-bold text-slate-800 dark:text-slate-100 mt-0.5">
              {dailyMax.toLocaleString()}건
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">일일 무료 한도</div>
            <div className="text-base font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
              {dailyLimit.toLocaleString()}건
            </div>
          </div>
        </div>

        {/* 30일 막대 차트 */}
        {daily.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            조회된 일자별 사용량 데이터가 없습니다.
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <div className="relative h-48 sm:h-56 w-full flex items-end gap-1 sm:gap-1.5 pt-6 pb-6 px-1 border-b border-slate-200 dark:border-slate-800">
              {/* 무료 한도 기준선 */}
              <div
                className="absolute left-0 right-0 border-t-2 border-dashed border-rose-400 dark:border-rose-500/80 pointer-events-none z-10 flex items-center justify-end pr-2"
                style={{
                  bottom: `${Math.min(95, Math.max(5, (dailyLimit / chartMaxY) * 100))}%`,
                }}
              >
                <span className="text-[11px] font-bold bg-white dark:bg-slate-900 px-1.5 py-0.5 text-rose-600 dark:text-rose-400 rounded-md border border-rose-200 dark:border-rose-900/60 shadow-2xs">
                  무료 한도 ({dailyLimit.toLocaleString()}건)
                </span>
              </div>

              {/* 일자별 막대 */}
              {daily.map((item, idx) => {
                const val = item[selectedDailyMetric];
                const heightPercent = Math.min(100, Math.max(val > 0 ? 2 : 0, (val / chartMaxY) * 100));
                const isOverLimit = val > dailyLimit;
                const isHovered = hoveredDailyIndex === idx;

                return (
                  <div
                    key={item.label}
                    className="relative flex-1 h-full flex flex-col justify-end items-center group cursor-pointer"
                    onMouseEnter={() => setHoveredDailyIndex(idx)}
                    onMouseLeave={() => setHoveredDailyIndex(null)}
                  >
                    {/* 툴팁 */}
                    {isHovered && (
                      <div className="absolute -top-12 z-20 bg-slate-900 text-white text-[11px] font-medium py-1 px-2 rounded-lg shadow-xl whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-100">
                        <div className="font-bold">{item.label}</div>
                        <div>
                          {val.toLocaleString()}건 ({((val / dailyLimit) * 100).toFixed(1)}%)
                        </div>
                      </div>
                    )}

                    {/* 막대 바 */}
                    <div
                      className={`w-full max-w-[20px] rounded-t-md transition-all duration-200 ${
                        isOverLimit
                          ? "bg-rose-500 group-hover:bg-rose-600"
                          : isHovered
                          ? "bg-indigo-600 dark:bg-indigo-400"
                          : "bg-indigo-400/80 dark:bg-indigo-600/80 group-hover:bg-indigo-500"
                      }`}
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* X축 날짜 라벨 (5일 간격으로 표시) */}
            <div className="flex justify-between text-[11px] text-slate-400 px-1">
              <span>{daily[0]?.label}</span>
              {daily.length > 10 && <span>{daily[Math.floor(daily.length / 2)]?.label}</span>}
              <span>{daily[daily.length - 1]?.label}</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. 오늘 시간대별 막대 */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-base">⏱️</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                오늘 시간대별 사용량 (급증 감지)
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              완결된 1시간 단위 · 한국 시간
            </p>
          </div>

          {/* 시간대 지표 선택 탭 */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(["reads", "writes", "deletes"] as MetricKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedHourlyMetric(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  selectedHourlyMetric === key
                    ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {METRIC_NAMES[key].name}
              </button>
            ))}
          </div>
        </div>

        {hourly.length === 0 ? (
          <div className="py-14 text-center text-xs text-slate-400">
            오늘 아직 완결된 시간대 데이터가 없습니다 (초기화 직후 또는 첫 1시간 경과 전).
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <div className="relative h-40 sm:h-48 w-full flex items-end gap-1 sm:gap-2 pt-4 pb-6 px-1 border-b border-slate-200 dark:border-slate-800">
              {hourly.map((item, idx) => {
                const val = item[selectedHourlyMetric];
                const heightPercent = Math.min(100, Math.max(val > 0 ? 2 : 0, (val / hourlyChartMaxY) * 100));
                const isHovered = hoveredHourlyIndex === idx;
                const isPeak = hourlyMax > 0 && val === hourlyMax;

                return (
                  <div
                    key={item.label}
                    className="relative flex-1 h-full flex flex-col justify-end items-center group cursor-pointer"
                    onMouseEnter={() => setHoveredHourlyIndex(idx)}
                    onMouseLeave={() => setHoveredHourlyIndex(null)}
                  >
                    {/* 툴팁 */}
                    {isHovered && (
                      <div className="absolute -top-12 z-20 bg-slate-900 text-white text-[11px] font-medium py-1 px-2 rounded-lg shadow-xl whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-100">
                        <div className="font-bold">{item.label}시 구간</div>
                        <div>{val.toLocaleString()}건</div>
                      </div>
                    )}

                    {/* 막대 바 */}
                    <div
                      className={`w-full max-w-[24px] rounded-t-md transition-all duration-200 ${
                        isPeak && val > 0
                          ? "bg-amber-500 group-hover:bg-amber-600"
                          : isHovered
                          ? "bg-blue-600 dark:bg-blue-400"
                          : "bg-blue-400/80 dark:bg-blue-600/80 group-hover:bg-blue-500"
                      }`}
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* X축 시간 라벨 */}
            <div className="flex justify-between text-[11px] text-slate-400 px-1">
              <span>{hourly[0]?.label}시</span>
              {hourly.length > 6 && <span>{hourly[Math.floor(hourly.length / 2)]?.label}시</span>}
              <span>{hourly[hourly.length - 1]?.label}시</span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              💡 시간대별 합계가 오늘 누계보다 작은 것은 정상입니다 (완결된 시간대만 집계됩니다).
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              💡 왼쪽 끝이 {data?.resetHourLabel || "오후 4시"}인 것도 정상입니다 — 하루가 그때 시작하므로
              막대는 자정을 넘어 다음 날 아침까지 이어집니다.
            </p>
          </div>
        )}
      </div>

      {/* 4. 알림 받는 사람 관리 (super_admin 전용) */}
      {userData?.role === "super_admin" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">📬</span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  알림 받는 사람
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                    data?.alert?.source === "configured"
                      ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
                      : "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      data?.alert?.source === "configured" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  <span>
                    {data?.alert?.source === "configured" ? "직접 지정됨" : "자동 추정 중"}
                  </span>
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  ({recipientsList.length}명 / 최대 10명)
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                데이터베이스 일일 사용량이 50% 또는 80%에 도달했을 때 경보 알림을 수신할 선생님 계정을 지정합니다.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveRecipients}
              disabled={savingRecipients || (!isRecipientsDirty && data?.alert?.source === "configured")}
              className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 ${
                isRecipientsDirty || data?.alert?.source === "role-fallback"
                  ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
              }`}
            >
              {savingRecipients ? (
                <>
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-current border-t-transparent" />
                  <span>저장 중...</span>
                </>
              ) : (
                <span>설정 저장</span>
              )}
            </button>
          </div>

          {/* 자동 추정(미지정) 상태 경고 안내 */}
          {data?.alert?.needsAttention && (
            <div className="bg-amber-500/10 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-700/60 rounded-xl p-4 space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 font-bold text-sm text-amber-950 dark:text-amber-100">
                <span>⚠️</span>
                <span>알림 수신자 지정 필요</span>
              </div>
              <p className="leading-relaxed">
                아직 받는 사람을 정하지 않아 자동으로 추정하고 있습니다. 이 계정들은 평소 로그인하지 않아 알림을 못 볼 수 있습니다.
              </p>
              <p className="text-amber-800/80 dark:text-amber-300/80 font-medium">
                👉 평소 업무 시 자주 로그인하시는 선생님의 이메일 계정을 아래에 추가하여 저장해 주세요.
              </p>
            </div>
          )}

          {/* 칩(Chip) 목록 */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 min-h-[42px] p-2 bg-slate-50 dark:bg-slate-850/50 rounded-xl border border-slate-200/70 dark:border-slate-800">
              {recipientsList.length === 0 ? (
                <span className="text-xs text-slate-400 px-2 py-1">
                  등록된 수신자가 없습니다. 아래 입력창에서 계정을 추가해 주세요.
                </span>
              ) : (
                recipientsList.map((email) => (
                  <div
                    key={email}
                    className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-2xs group"
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecipient(email)}
                      className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-md transition-colors cursor-pointer"
                      title={`${email} 삭제`}
                    >
                      <span className="text-xs">✕</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 주소 입력창 + 추가 버튼 */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="email"
              value={newRecipientInput}
              onChange={(e) => {
                setNewRecipientInput(e.target.value);
                setRecipientError(null);
                setRecipientSuccess(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddRecipient();
                }
              }}
              placeholder="이메일 주소 입력 (예: teacher@hmh.or.kr)"
              disabled={recipientsList.length >= 10}
              className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleAddRecipient}
              disabled={recipientsList.length >= 10 || !newRecipientInput.trim()}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold transition-colors shadow-2xs shrink-0 cursor-pointer"
            >
              추가
            </button>
          </div>

          {/* 에러 메시지 (서버 error 문구 그대로 표시) */}
          {recipientError && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-medium rounded-xl p-3 flex items-center gap-2">
              <span>⚠️</span>
              <p className="leading-snug">{recipientError}</p>
            </div>
          )}

          {/* 성공 메시지 */}
          {recipientSuccess && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium rounded-xl p-3 flex items-center gap-2">
              <span>✅</span>
              <p className="leading-snug">{recipientSuccess}</p>
            </div>
          )}
        </div>
      )}

      {/* 5. 데이터 절약 모드 관리 (super_admin 전용) */}
      {userData?.role === "super_admin" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">⚡</span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  데이터 절약 모드
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                    savingMode.active
                      ? "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      savingMode.active ? "bg-amber-500 animate-pulse" : "bg-slate-400"
                    }`}
                  />
                  <span>{savingMode.active ? "절약 모드 켜짐" : "평시 모드"}</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                사용량이 급증하거나 한도 소진 위험이 발생할 때 데이터 조회를 일시 최적화합니다. 켜면 24시간 동안 유지된 후 자동으로 꺼집니다.
              </p>
            </div>

            <button
              type="button"
              onClick={handleToggleSavingMode}
              disabled={isSavingToggling}
              className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-colors shadow-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-50 ${
                savingMode.active
                  ? "bg-rose-600 hover:bg-rose-700 text-white"
                  : "bg-amber-500 hover:bg-amber-600 text-slate-950"
              }`}
            >
              {isSavingToggling ? (
                <>
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-current border-t-transparent" />
                  <span>처리 중...</span>
                </>
              ) : savingMode.active ? (
                <span>절약 모드 끄기</span>
              ) : (
                <span>절약 모드 켜기</span>
              )}
            </button>
          </div>

          {savingMode.active && (
            <div className="bg-amber-500/10 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200 font-medium">
              <div className="flex items-center gap-2">
                <span>ℹ️</span>
                <span>{buildSavingBannerText(savingMode)}</span>
              </div>
              {savingMode.turnedOnBy && (
                <span className="text-[11px] text-amber-700 dark:text-amber-400 shrink-0">
                  (설정자: {savingMode.turnedOnBy})
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
