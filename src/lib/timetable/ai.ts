/**
 * Phase 9c-E: AI 보조층 — 가명화·프롬프트·Gemini 호출·응답 파싱 (Claude 소유 파일)
 *
 * 상위 스펙: docs/phase9c_e_spec.md
 *
 * 철칙 (spec §0): AI 출력은 표시 전용이거나 사람 확인 후 정규 저장 API로만 반영된다.
 * 개인정보 (spec §2): 무료 등급 입력은 모델 개선에 활용될 수 있으므로 교사 실명·이메일을
 * 외부로 보내지 않는다 — 전송 직전 가명(T01…) 치환, 응답 역치환. 치환표는 요청 생명주기
 * 안에서만 존재한다. **가명화를 제거하는 변경은 반드시 Claude 재검토를 거칠 것.**
 *
 * 순수 부분(가명화·프롬프트 조립·파싱)은 네트워크 무의존 — scripts/ai_selftest.ts가 회귀 검증.
 */

// 실측 2026-08-11: 신규 발급 키에는 구모델(gemini-2.5-flash / -lite)이 404 — "no longer
// available to new users" (2026-08-12 재확인, 여전히 404).
//
// 실측 2026-08-12 — 롤링 별칭(gemini-flash-latest) 철회: 별칭은 항상 **최신** 모델을 가리키는데
// 최신 모델일수록 무료 등급 일일 한도가 작다. 당시 별칭이 가리키던 gemini-3.6-flash는
// `GenerateRequestsPerDayPerProjectPerModel-FreeTier` = **하루 20회**로, 실사용 몇 번에 소진돼
// AI 기능 전체가 하루 종일 막혔다(실사고). 한도는 **모델별로 따로** 잡히므로 한 세대 이전
// 모델로 고정해 여유를 확보한다. 별칭을 다시 쓰면 같은 사고가 재발한다.
//
// 한도가 다시 빠듯해지면 대안(같은 키로 사용 가능 실측): gemini-3.5-flash-lite,
// gemini-flash-lite-latest. 실제 잔여량은 https://ai.dev/rate-limit 에서 확인.
export const GEMINI_MODEL = "gemini-3.5-flash";

const GEMINI_ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const CALL_TIMEOUT_MS = 30_000;

export function isAiEnabled(): boolean {
  return !!(process.env.GEMINI_API_KEY || "").trim();
}

// ── 가명화 (spec §2) ──────────────────────────────────────────

export interface AiTeacherRef {
  email?: string;
  name?: string;
}

export interface Pseudonymizer {
  /** 실명·이메일 → 가명. 전송 직전 모든 문자열에 적용 */
  mask(text: string): string;
  /** 가명 → 실명. 응답 문자열에 적용 */
  unmask(text: string): string;
  /** 가명 → 교사 참조 (E2 정식화의 별칭 해석용). 모르는 가명은 null */
  resolve(alias: string): AiTeacherRef | null;
  /** 전체 가명 목록 (프롬프트 로스터용) */
  aliases(): string[];
  size: number;
}

/**
 * 교사 목록으로 가명 사전(T01…)을 만든다.
 * - 이름은 긴 것부터 치환(부분 문자열 겹침 방어 — "김지구"를 "지구"보다 먼저).
 * - 이메일은 항상 치환 대상(이름보다 먼저 — 이메일 안에 이름이 들어있지 않으므로 순서 무해하나 명시).
 * - 이름이 과목명 등 비인명 텍스트와 동일한 경우까지 치환될 수 있으나, 과도 치환은
 *   개인정보 방향으로 안전한 실패(false positive)라 허용한다.
 */
export function buildPseudonymizer(teachers: AiTeacherRef[]): Pseudonymizer {
  // 이름 기준 정렬로 결정론 부여 → 같은 입력 = 같은 가명 배정
  const uniq = new Map<string, AiTeacherRef>();
  for (const t of teachers) {
    const name = (t.name || "").trim();
    const email = (t.email || "").trim().toLowerCase();
    if (!name && !email) continue;
    const key = email || `name:${name}`;
    if (!uniq.has(key)) uniq.set(key, { name, email });
  }
  const sorted = Array.from(uniq.values()).sort((a, b) =>
    (a.name || a.email || "").localeCompare(b.name || b.email || "", "ko")
  );

  const aliasByToken: Array<{ token: string; alias: string }> = [];
  const nameByAlias = new Map<string, string>();
  const teacherByAlias = new Map<string, AiTeacherRef>();
  sorted.forEach((t, i) => {
    const alias = `T${String(i + 1).padStart(2, "0")}`;
    if (t.email) aliasByToken.push({ token: t.email, alias });
    if (t.name) aliasByToken.push({ token: t.name, alias });
    nameByAlias.set(alias, t.name || t.email || alias);
    teacherByAlias.set(alias, t);
  });
  // 긴 토큰 먼저 — "김지구" 치환 전에 "지구"가 먼저 먹으면 "김T05" 잔여가 생긴다
  aliasByToken.sort((a, b) => b.token.length - a.token.length);

  const mask = (text: string): string => {
    let out = text ?? "";
    for (const { token, alias } of aliasByToken) {
      if (token) out = out.split(token).join(alias);
    }
    return out;
  };
  const unmask = (text: string): string => {
    // T\d{2,} 패턴만 치환 — 일반 문장에 나올 일 없는 토큰
    return (text ?? "").replace(/T\d{2,}/g, (m) => nameByAlias.get(m) || m);
  };

  return {
    mask,
    unmask,
    resolve: (alias: string) => teacherByAlias.get((alias || "").trim().toUpperCase()) || null,
    aliases: () => Array.from(teacherByAlias.keys()),
    size: sorted.length,
  };
}

// ── E1 불능 진단 (spec §3) ────────────────────────────────────

export interface AiDiagnoseInput {
  termLabel: string;
  draftLabel: string;
  /** 가명 사전 구축용 — 그리드에 등장하는 전체 교사 */
  teachers: AiTeacherRef[];
  /** 검사기 하드 위반 눈높이 문장 (registryGap 구분 포함) */
  hard: Array<{ code: string; text: string; registryGap?: boolean; hint?: string }>;
  unplaced: Array<{ label: string; remaining: number }>;
  softTotal: number;
  registryStats: {
    simulGroups: number;
    venueGroups: number;
    teacherSlotBans: number;
    consecutiveRules: number;
    coTeaching: number;
  };
}

export interface AiDiagnoseResult {
  diagnosis: string;
  suggestions: string[];
}

const MAX_HARD_LINES = 100;
const MAX_UNPLACED_LINES = 60;

/** 프롬프트 조립 (순수) — 반환 문자열은 이미 가명화 완료 상태여야 하며, 호출부는 p.mask를 신뢰한다 */
export function buildDiagnosePrompt(input: AiDiagnoseInput, p: Pseudonymizer): string {
  const hardLines = input.hard
    .slice(0, MAX_HARD_LINES)
    .map((h) => `- [${h.code}${h.registryGap ? "·등록부미비" : ""}] ${p.mask(h.text)}${h.hint ? ` (참고: ${p.mask(h.hint)})` : ""}`)
    .join("\n");
  const omittedHard = input.hard.length - Math.min(input.hard.length, MAX_HARD_LINES);
  const unplacedLines = input.unplaced
    .slice(0, MAX_UNPLACED_LINES)
    .map((u) => `- ${p.mask(u.label)} — 미배정 ${u.remaining}시간`)
    .join("\n");

  return [
    `당신은 고등학교 시간표 편성 실무를 돕는 진단 보조입니다. 자동 검사기가 찾은 문제를 근본 원인 단위로 묶어, 시간표 담당 교사가 바로 이해하는 한국어로 설명합니다.`,
    ``,
    `규칙:`,
    `1. 교사 이름은 T01 같은 가명입니다. 가명을 그대로 사용하세요 (실명을 추측하지 마세요).`,
    `2. "등록부미비" 표시가 있는 항목은 제약 데이터가 아직 입력되지 않아 생긴 것일 수 있습니다 — 데이터 보완을 먼저 제안하세요.`,
    `3. 완화 제안은 구체적으로: 어떤 제약을 어떻게 줄이면 어떤 문제 몇 건이 풀릴지.`,
    `4. 반드시 JSON 하나만 출력: {"diagnosis": "전체 진단 요약 (3~6문장)", "suggestions": ["완화 제안 1", "..."]} — suggestions는 최대 6개.`,
    ``,
    `## 대상: ${p.mask(input.termLabel)} / 작성본 "${p.mask(input.draftLabel)}"`,
    `등록된 제약: 동시수업 그룹 ${input.registryStats.simulGroups} · 특별실 ${input.registryStats.venueGroups} · 교사 교시 금지 ${input.registryStats.teacherSlotBans} · 연속수업 규칙 ${input.registryStats.consecutiveRules} · 복수교사 ${input.registryStats.coTeaching}`,
    `소프트 감점 총점: ${input.softTotal}`,
    ``,
    `## 하드 위반 (${input.hard.length}건${omittedHard > 0 ? `, 처음 ${MAX_HARD_LINES}건만 표시` : ""})`,
    hardLines || "(없음)",
    ``,
    `## 미배정 (${input.unplaced.length}건)`,
    unplacedLines || "(없음)",
  ].join("\n");
}

/** 응답 파싱 (순수) — 코드펜스 제거·형태 검증·길이 상한. 실패 시 null */
export function parseDiagnoseResponse(text: string): AiDiagnoseResult | null {
  let body = (text || "").trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  try {
    const obj = JSON.parse(body);
    if (!obj || typeof obj.diagnosis !== "string") return null;
    const suggestions = Array.isArray(obj.suggestions)
      ? obj.suggestions.filter((s: unknown) => typeof s === "string").slice(0, 6)
      : [];
    return {
      diagnosis: obj.diagnosis.slice(0, 2000),
      suggestions: suggestions.map((s: string) => s.slice(0, 300)),
    };
  } catch {
    return null;
  }
}

// ── Gemini 호출 ───────────────────────────────────────────────

export class AiCallError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "AiCallError";
    this.statusCode = statusCode;
  }
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          // 3.x flash는 사고(thinking) 토큰이 출력 예산을 잠식한다 (실측: 100으로는 JSON이 잘림,
          // thinkingBudget:0은 INVALID_ARGUMENT). 사고+본문을 넉넉히 담는 8192로.
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      }),
    });
    if (res.status === 429) {
      // 무료 등급은 분당 호출 수 상한이 있다 — 짧은 시간에 여러 기능을 연달아 쓰면 걸리고
      // 1분 안에 저절로 풀린다. "잠시 후"는 얼마나 기다릴지 몰라 답답하므로 시간을 명시한다.
      throw new AiCallError("AI 사용량이 순간적으로 몰렸습니다. 약 1분 뒤 다시 시도해 주세요.", 429);
    }
    if (!res.ok) {
      throw new AiCallError(`AI 호출에 실패했습니다 (${res.status}).`, 502);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("");
    if (!text) throw new AiCallError("AI가 응답을 생성하지 못했습니다.", 502);
    return text;
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new AiCallError("AI 응답이 제한 시간을 넘겼습니다. 다시 시도해 주세요.", 504);
    }
    throw new AiCallError("AI 서비스에 연결하지 못했습니다.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** 호출 → 파싱, 실패 시 1회 재시도 — E1~E4 공통 (fail-visible: 최종 실패는 AiCallError) */
async function callGeminiParsed<T>(
  prompt: string,
  apiKey: string,
  parse: (raw: string) => T | null
): Promise<T> {
  let parsed = parse(await callGemini(prompt, apiKey));
  if (!parsed) {
    parsed = parse(
      await callGemini(
        `${prompt}\n\n(직전 응답이 JSON 형식이 아니었습니다. 다른 텍스트 없이 JSON 하나만 다시 출력하세요.)`,
        apiKey
      )
    );
  }
  if (!parsed) {
    throw new AiCallError("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.", 502);
  }
  return parsed;
}

/**
 * E1 불능 진단 실행 — 가명화 → 프롬프트 → 호출 → 파싱(실패 시 1회 재시도) → 역치환.
 * fail-visible: 최종 실패는 AiCallError로 던져 라우트가 눈높이 메시지로 표시한다.
 */
export async function runDiagnose(
  input: AiDiagnoseInput,
  apiKey: string
): Promise<AiDiagnoseResult> {
  const p = buildPseudonymizer(input.teachers);
  const prompt = buildDiagnosePrompt(input, p);
  const parsed = await callGeminiParsed(prompt, apiKey, parseDiagnoseResponse);
  return {
    diagnosis: p.unmask(parsed.diagnosis),
    suggestions: parsed.suggestions.map((s) => p.unmask(s)),
  };
}

// ── E2 선호 정식화 (spec §3) — 자연어 → teacherSlotBans 후보 ──

export interface AiFormalizeInput {
  /** 일과계가 입력한 자연어 문장 — 실명 포함 가능. runFormalize가 전송 전 가명화한다 */
  text: string;
  /** 실교사만 (이메일 있는) — 별칭 로스터·해석의 원천 */
  teachers: AiTeacherRef[];
  periodsPerDay: number;
}

/** slot_ban_save가 그대로 받는 형태 — AI 전용 쓰기 경로를 만들지 않기 위한 정렬 (spec §0 철칙) */
export interface AiFormalizeEntry {
  teacherEmail: string;
  teacherName?: string;
  kind: "assign" | "move";
  slots: Array<{ day: number; period: number }>;
}

export interface AiFormalizeResult {
  /** 사람 확인 다이얼로그에 보여줄 해석 문장 (역치환 완료) */
  interpretation: string;
  entries: AiFormalizeEntry[];
  /** 해석하지 못한 별칭·항목에 대한 안내 (역치환 완료) */
  warnings: string[];
}

const MAX_FORMALIZE_TEXT = 200;
const MAX_FORMALIZE_ENTRIES = 10;
const MAX_SLOTS_PER_ENTRY = 40;

/** 프롬프트 조립 (순수) — maskedText는 이미 가명화된 문장이어야 한다 */
export function buildFormalizePrompt(
  maskedText: string,
  aliases: string[],
  periodsPerDay: number
): string {
  return [
    `당신은 고등학교 시간표의 "교사 교시 금지" 등록을 돕는 해석기입니다. 담당 교사가 쓴 한국어 요구를 구조화된 규칙으로 번역합니다.`,
    ``,
    `규칙:`,
    `1. 교사는 가명(${aliases.slice(0, 5).join(", ")}…)으로만 지칭됩니다. 문장에 등장한 가명만 사용하세요.`,
    `2. kind: "assign" = 배정금지(그 교시에 수업을 아예 두지 않음), "move" = 이동금지(솔버가 그 교시의 수업을 옮기지 못함). 문장이 "회피·금지·비우기"면 assign, "고정·움직이지 말 것"이면 move. 애매하면 assign.`,
    `3. days: 1=월 2=화 3=수 4=목 5=금. periods: 1~${periodsPerDay}. 요일 전체면 periods에 "all".`,
    `4. 반드시 JSON 하나만 출력:`,
    `{"interpretation": "해석을 한 문장으로 (가명 사용)", "items": [{"teacher": "T01", "kind": "assign", "days": [1], "periods": [1, 2]}]}`,
    `5. 문장에 없는 요구를 만들지 마세요. 해석 불가면 items를 빈 배열로 하고 interpretation에 이유를 쓰세요.`,
    ``,
    `## 요구 문장`,
    maskedText,
  ].join("\n");
}

interface RawFormalizeItem {
  teacher: string;
  kind: "assign" | "move";
  days: number[];
  periods: number[] | "all";
}

/** 응답 파싱 (순수) — 형태 검증만. 별칭 해석·범위 정리는 normalizeFormalizeItems가 담당 */
export function parseFormalizeResponse(
  text: string
): { interpretation: string; items: RawFormalizeItem[] } | null {
  let body = (text || "").trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  try {
    const obj = JSON.parse(body);
    if (!obj || typeof obj.interpretation !== "string" || !Array.isArray(obj.items)) return null;
    const items: RawFormalizeItem[] = [];
    for (const it of obj.items.slice(0, MAX_FORMALIZE_ENTRIES)) {
      if (!it || typeof it.teacher !== "string") continue;
      // 모델 출력 변형 실측 2건 수용: "all" 리터럴 대신 문자열 변종("전체" 등) / 배열 안 문자열 ["all"]
      const rawPeriods = it.periods;
      let periods: number[] | "all";
      if (typeof rawPeriods === "string") {
        periods = "all";
      } else if (Array.isArray(rawPeriods)) {
        periods = rawPeriods.some((v: unknown) => typeof v === "string" && /all|전체|전부/i.test(v))
          ? "all"
          : rawPeriods.map(Number);
      } else {
        periods = [];
      }
      items.push({
        teacher: it.teacher,
        kind: it.kind === "move" ? "move" : "assign",
        days: Array.isArray(it.days) ? it.days.map(Number) : [],
        periods,
      });
    }
    return { interpretation: obj.interpretation.slice(0, 500), items };
  } catch {
    return null;
  }
}

/**
 * 별칭 해석·범위 정리·슬롯 전개 (순수) — 모르는 별칭·범위 밖 값은 버리고 warnings로 보고.
 * 반환 entries는 slot_ban_save 검증(validateTeacherSlotBanPayload)을 그대로 통과하는 형태.
 */
export function normalizeFormalizeItems(
  items: RawFormalizeItem[],
  p: Pseudonymizer,
  periodsPerDay: number
): { entries: AiFormalizeEntry[]; warnings: string[] } {
  const entries: AiFormalizeEntry[] = [];
  const warnings: string[] = [];
  for (const it of items) {
    const teacher = p.resolve(it.teacher);
    if (!teacher || !teacher.email) {
      warnings.push(`${it.teacher}: 등록된 교사와 연결하지 못해 제외했습니다.`);
      continue;
    }
    const days = Array.from(new Set(it.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 5)));
    // 교시 미지정 + 요일 지정 = "그 요일 전체"로 해석 (실측: "하루 종일" 요구에서 모델이 periods를
    // 비우는 경우 발생 — 과대 해석이어도 사람 확인 다이얼로그가 관문이라 안전한 방향)
    const periods =
      it.periods === "all" || (Array.isArray(it.periods) && it.periods.length === 0 && days.length > 0)
        ? Array.from({ length: periodsPerDay }, (_, i) => i + 1)
        : Array.from(
            new Set(
              (it.periods as number[]).filter(
                (q) => Number.isInteger(q) && q >= 1 && q <= periodsPerDay
              )
            )
          );
    if (days.length === 0 || periods.length === 0) {
      warnings.push(`${it.teacher}: 요일·교시를 해석하지 못해 제외했습니다.`);
      continue;
    }
    const slots: Array<{ day: number; period: number }> = [];
    for (const d of days) for (const q of periods) slots.push({ day: d, period: q });
    entries.push({
      teacherEmail: (teacher.email || "").toLowerCase(),
      ...(teacher.name ? { teacherName: teacher.name } : {}),
      kind: it.kind,
      slots: slots.slice(0, MAX_SLOTS_PER_ENTRY),
    });
  }
  return { entries, warnings };
}

/**
 * E2 정식화 실행 — 입력 문장 가명화 → 호출 → 파싱(1회 재시도) → 별칭 해석 → 역치환.
 * PII 방어선: 문장에서 등록 교사 이름이 하나도 치환되지 않으면 **외부 호출 없이** 422로 거절
 * (모르는 이름·오타가 원문 그대로 나가는 것을 차단. 일부 일치·일부 오타의 잔여 위험은
 * 스펙 §3 E2에 수용 기록 — UI가 "성명을 정확히" 안내).
 */
export async function runFormalize(
  input: AiFormalizeInput,
  apiKey: string
): Promise<AiFormalizeResult> {
  const text = (input.text || "").trim().slice(0, MAX_FORMALIZE_TEXT);
  if (!text) throw new AiCallError("요구 문장을 입력해 주세요.", 400);

  const p = buildPseudonymizer(input.teachers);
  const masked = p.mask(text);
  if (masked === text) {
    throw new AiCallError(
      "문장에서 등록된 교사 성명을 찾지 못했습니다. 시간표에 있는 교사의 성명을 정확히 넣어 주세요.",
      422
    );
  }

  const prompt = buildFormalizePrompt(masked, p.aliases(), input.periodsPerDay);
  const parsed = await callGeminiParsed(prompt, apiKey, parseFormalizeResponse);

  const { entries, warnings } = normalizeFormalizeItems(parsed.items, p, input.periodsPerDay);
  return {
    interpretation: p.unmask(parsed.interpretation),
    entries,
    warnings: warnings.map((w) => p.unmask(w)),
  };
}

// ── E3 결과 설명 · E4 정성 비평 (spec §3) — 공용 그리드 요약 ──

/** 감점 코드 → 눈높이 라벨 (프롬프트·요약 표시용) — types.ts SoftPenaltyCode 주석과 동기 유지 */
export const SOFT_CODE_LABELS: Record<string, string> = {
  S1: "요일 시수 쏠림",
  S2: "연속 3교시 이상",
  S3: "점심 전후 연속 수업",
  S4: "같은 반 같은 날 동일 과목 중복",
  S5: "교사 하루 3과목 이상",
  S6: "오전/오후 불균형",
  S7: "순배",
};

export interface AiTeacherLoad {
  /** 실명 — 프롬프트 조립 시 mask로 가명화 */
  name: string;
  total: number;
  /** [월..금] 5칸 시수 */
  byDay: number[];
}

/**
 * E3·E4 공용 입력 — 서버가 draftId로 재산출한 요약만 담는다 (spec §3: 그리드 전문 전송 금지).
 * penalties·teacherLoads의 실명은 프롬프트 조립 시 가명화된다.
 */
export interface AiGridSummaryInput {
  termLabel: string;
  draftLabel: string;
  /** 가명 사전 구축용 — 그리드에 등장하는 전체 교사 */
  teachers: AiTeacherRef[];
  classes: number;
  lessons: number;
  hardCount: number;
  unplaced: Array<{ label: string; remaining: number }>;
  softTotal: number;
  /** 코드별 감점 합계 (label = SOFT_CODE_LABELS) */
  softByCode: Array<{ label: string; points: number }>;
  /** 감점 상세 — 점수 내림차순 정렬 상태로 받는다. 상한 절단은 프롬프트 조립이 담당 */
  penalties: Array<{ text: string; points: number }>;
  teacherLoads: AiTeacherLoad[];
}

export interface AiExplainResult {
  explanation: string;
}

export interface AiCritiqueResult {
  suggestions: string[];
}

const MAX_PENALTY_LINES = 40;
const MAX_TEACHER_LOAD_LINES = 80;
const MAX_CRITIQUE_SUGGESTIONS = 8;

/** E3·E4 공용 요약 섹션 (순수) — 반환 문자열은 가명화 완료 상태 */
function buildSummarySection(input: AiGridSummaryInput, p: Pseudonymizer): string {
  const softLines = input.softByCode
    .filter((s) => s.points > 0)
    .map((s) => `- ${s.label}: ${s.points}점`)
    .join("\n");
  const penaltyLines = input.penalties
    .slice(0, MAX_PENALTY_LINES)
    .map((d) => `- ${p.mask(d.text)} (${d.points}점)`)
    .join("\n");
  const omittedPenalties = input.penalties.length - Math.min(input.penalties.length, MAX_PENALTY_LINES);
  const loadLines = input.teacherLoads
    .slice(0, MAX_TEACHER_LOAD_LINES)
    .map((t) => `- ${p.mask(t.name)}: 주 ${t.total}시간 (월~금 ${t.byDay.join("/")})`)
    .join("\n");
  const unplacedLines = input.unplaced
    .slice(0, MAX_UNPLACED_LINES)
    .map((u) => `- ${p.mask(u.label)} — 미배정 ${u.remaining}시간`)
    .join("\n");

  return [
    `## 대상: ${p.mask(input.termLabel)} / 작성본 "${p.mask(input.draftLabel)}"`,
    `학급 ${input.classes}개 · 배정 수업 ${input.lessons}건 · 교사 ${input.teacherLoads.length}명 · 중대 문제(하드 위반) ${input.hardCount}건 · 미배정 ${input.unplaced.length}건`,
    ``,
    `## 감점 합계: ${input.softTotal}점`,
    softLines || "(감점 없음)",
    ``,
    `## 감점 상세 (점수 높은 순${omittedPenalties > 0 ? `, 처음 ${MAX_PENALTY_LINES}건만 표시` : ""})`,
    penaltyLines || "(없음)",
    ``,
    `## 교사별 주간 부하 (요일별 시수)`,
    loadLines || "(없음)",
    ``,
    `## 미배정`,
    unplacedLines || "(없음)",
  ].join("\n");
}

/** E3 프롬프트 조립 (순수) */
export function buildExplainPrompt(input: AiGridSummaryInput, p: Pseudonymizer): string {
  return [
    `당신은 완성된 고등학교 시간표를 교사들에게 설명하는 보조입니다. 아래 요약 데이터만 근거로, 이 시간표가 어떤 절충(트레이드오프)을 거쳐 이렇게 배치됐는지를 시간표를 잘 모르는 교사도 이해할 수 있는 한국어 문단으로 설명합니다.`,
    ``,
    `규칙:`,
    `1. 교사 이름은 T01 같은 가명입니다. 가명을 그대로 사용하세요 (실명을 추측하지 마세요).`,
    `2. 데이터에 없는 사실을 만들지 마세요. 요약에 있는 감점·부하·미배정만 근거로 쓰세요.`,
    `3. 남아 있는 감점·하드 위반·미배정은 숨기지 말고 "불가피했던 절충" 또는 "남은 과제"로 설명하세요.`,
    `4. 감점이 큰 항목부터 왜 그런 배치가 나왔을지 추정 이유를 붙이되, 추정임을 드러내는 표현("~로 보입니다")을 쓰세요.`,
    `5. 반드시 JSON 하나만 출력: {"explanation": "설명 문단 (4~8문장, 줄바꿈 허용)"}`,
    ``,
    buildSummarySection(input, p),
  ].join("\n");
}

/** E3 응답 파싱 (순수) — 실패 시 null */
export function parseExplainResponse(text: string): AiExplainResult | null {
  let body = (text || "").trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  try {
    const obj = JSON.parse(body);
    if (!obj || typeof obj.explanation !== "string" || !obj.explanation.trim()) return null;
    return { explanation: obj.explanation.slice(0, 3000) };
  } catch {
    return null;
  }
}

/** E4 프롬프트 조립 (순수) */
export function buildCritiquePrompt(input: AiGridSummaryInput, p: Pseudonymizer): string {
  return [
    `당신은 고등학교 시간표의 품질을 검토하는 비평 보조입니다. 아래 요약 데이터에서 개선 여지를 찾아, 시간표 담당 교사가 조정 방향을 잡을 수 있는 구체적 제안을 만듭니다.`,
    ``,
    `규칙:`,
    `1. 교사 이름은 T01 같은 가명입니다. 가명을 그대로 사용하세요 (실명을 추측하지 마세요).`,
    `2. 제안은 구체적으로: 누구(가명)·어느 반의 어떤 문제(감점 항목·부하 쏠림)를 어느 방향으로 조정하면 좋아질지. 데이터에 없는 문제를 만들지 마세요.`,
    `3. 감점이 크거나 특정 교사·반에 쏠린 것부터 우선하세요. 미배정·하드 위반이 있으면 그것이 최우선입니다.`,
    `4. 뚜렷한 개선점이 없으면 suggestions를 빈 배열로 하세요 (억지 제안 금지).`,
    `5. 반드시 JSON 하나만 출력: {"suggestions": ["개선 제안 1", "..."]} — 최대 ${MAX_CRITIQUE_SUGGESTIONS}개.`,
    ``,
    buildSummarySection(input, p),
  ].join("\n");
}

/** E4 응답 파싱 (순수) — 실패 시 null. 빈 suggestions는 유효(개선점 없음) */
export function parseCritiqueResponse(text: string): AiCritiqueResult | null {
  let body = (text || "").trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  try {
    const obj = JSON.parse(body);
    if (!obj || !Array.isArray(obj.suggestions)) return null;
    return {
      suggestions: obj.suggestions
        .filter((s: unknown) => typeof s === "string" && (s as string).trim())
        .slice(0, MAX_CRITIQUE_SUGGESTIONS)
        .map((s: string) => s.slice(0, 300)),
    };
  } catch {
    return null;
  }
}

/** E3 결과 설명 실행 — 표시 전용 (spec §0) */
export async function runExplain(
  input: AiGridSummaryInput,
  apiKey: string
): Promise<AiExplainResult> {
  const p = buildPseudonymizer(input.teachers);
  const prompt = buildExplainPrompt(input, p);
  const parsed = await callGeminiParsed(prompt, apiKey, parseExplainResponse);
  return { explanation: p.unmask(parsed.explanation) };
}

/** E4 정성 비평 실행 — 표시 전용 (spec §0, v1은 셀 연동 없음) */
export async function runCritique(
  input: AiGridSummaryInput,
  apiKey: string
): Promise<AiCritiqueResult> {
  const p = buildPseudonymizer(input.teachers);
  const prompt = buildCritiquePrompt(input, p);
  const parsed = await callGeminiParsed(prompt, apiKey, parseCritiqueResponse);
  return { suggestions: parsed.suggestions.map((s) => p.unmask(s)) };
}
