/**
 * 급식 식단 조회 — 나이스 교육정보 개방 포털 급식식단정보 API 프록시 (대시보드 최소화, 로드맵 §2)
 *
 * 무료 원칙: 공공 API, 인증키 없이도 소량 조회 가능(NEIS_API_KEY 환경변수를 넣으면 키 사용).
 * 학생·교사 공용(로그인만 필요 — 급식은 공개 정보이나 열린 프록시 방지용 게이트).
 * 서버 메모리 캐시 1시간 — 전 교직원·학생이 같은 날짜 구간을 보므로 실호출은 시간당 1회 수준.
 */
import { verifyAuthAccess } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";

// 효명고 나이스 코드 (2026-08-07 schoolInfo API 실측: 경기도교육청 J10 / 7530601)
const ATPT_CODE = process.env.NEIS_ATPT_CODE || "J10";
const SCHUL_CODE = process.env.NEIS_SCHUL_CODE || "7530601";

interface MealDay {
  date: string; // YYYY-MM-DD
  mealName: string; // 조식/중식/석식
  dishes: Array<{ name: string; allergyCodes: string }>;
  calories?: string;
}

const cache = new Map<string, { at: number; meals: MealDay[] }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const DATE_RE = /^\d{8}$/;

function parseDishes(raw: string): MealDay["dishes"] {
  return (raw || "")
    .split(/<br\s*\/?>/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)[\s]*\(([\d.]+)\)\s*$/);
      const name = (m ? m[1] : s).replace(/[*#@&]+/g, "").trim();
      return { name, allergyCodes: m ? m[2] : "" };
    })
    .filter((d) => d.name);
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyAuthAccess(req);
    if (!auth) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    // 기본: 오늘부터 7일 (이번 주 급식) — KST 기준 날짜
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const from = typeof body.from === "string" && DATE_RE.test(body.from) ? body.from : ymd(now);
    const toDefault = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const to = typeof body.to === "string" && DATE_RE.test(body.to) ? body.to : ymd(toDefault);
    if (from > to) return NextResponse.json({ error: "조회 구간이 올바르지 않습니다." }, { status: 400 });

    const cacheKey = `${from}-${to}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json({ success: true, meals: hit.meals, cached: true });
    }

    const key = process.env.NEIS_API_KEY ? `&KEY=${process.env.NEIS_API_KEY}` : "";
    const url =
      `https://open.neis.go.kr/hub/mealServiceDietInfo?ATPT_OFCDC_SC_CODE=${ATPT_CODE}` +
      `&SD_SCHUL_CODE=${SCHUL_CODE}&MLSV_FROM_YMD=${from}&MLSV_TO_YMD=${to}&Type=json${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`나이스 응답 오류 (${res.status})`);
    const data = await res.json();

    // 나이스 규약: 데이터 없음도 RESULT 코드(INFO-200)로 옴 — 빈 목록으로 정상 반환
    const rows: any[] = data?.mealServiceDietInfo?.[1]?.row || [];
    const meals: MealDay[] = rows.map((r) => ({
      date: `${r.MLSV_YMD.slice(0, 4)}-${r.MLSV_YMD.slice(4, 6)}-${r.MLSV_YMD.slice(6, 8)}`,
      mealName: r.MMEAL_SC_NM || "중식",
      dishes: parseDishes(r.DDISH_NM),
      ...(r.CAL_INFO ? { calories: r.CAL_INFO } : {}),
    }));
    cache.set(cacheKey, { at: Date.now(), meals });
    return NextResponse.json({ success: true, meals });
  } catch (error: any) {
    console.error("[POST /api/meal] Error:", error);
    return NextResponse.json(
      { error: "급식 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 }
    );
  }
}
