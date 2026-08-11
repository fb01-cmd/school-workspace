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

// 실측 2026-08-11: 신규 발급 키에는 구모델(gemini-2.5-flash)이 404 — "no longer available to
// new users". 롤링 별칭을 써서 모델 퇴역에 따른 재수정을 구조적으로 회피한다. 문제가 생기면
// models 목록 API로 재실측 후 이 상수만 갱신.
export const GEMINI_MODEL = "gemini-flash-latest";

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
  sorted.forEach((t, i) => {
    const alias = `T${String(i + 1).padStart(2, "0")}`;
    if (t.email) aliasByToken.push({ token: t.email, alias });
    if (t.name) aliasByToken.push({ token: t.name, alias });
    nameByAlias.set(alias, t.name || t.email || alias);
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

  return { mask, unmask, size: sorted.length };
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
      throw new AiCallError("AI 사용량이 많아 잠시 후 다시 시도해 주세요.", 429);
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

  let raw = await callGemini(prompt, apiKey);
  let parsed = parseDiagnoseResponse(raw);
  if (!parsed) {
    raw = await callGemini(
      `${prompt}\n\n(직전 응답이 JSON 형식이 아니었습니다. 다른 텍스트 없이 JSON 하나만 다시 출력하세요.)`,
      apiKey
    );
    parsed = parseDiagnoseResponse(raw);
  }
  if (!parsed) {
    throw new AiCallError("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.", 502);
  }
  return {
    diagnosis: p.unmask(parsed.diagnosis),
    suggestions: parsed.suggestions.map((s) => p.unmask(s)),
  };
}
