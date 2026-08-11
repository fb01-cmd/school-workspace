/**
 * Phase 9c-E 실호출 스모크 (phase9c_e_spec §6-2) — Gemini 실호출 1~2회, Firestore 무의존.
 *
 * 사용법: npx tsx --env-file=.env.local scripts/verify_ai_smoke.ts
 *
 * 검증: ① 전송 프롬프트에 실명·이메일 0건(기계 검증 — 가명화 실측)
 *       ② 실호출 → JSON 파싱 → 역치환된 결과에 실명 복원 확인.
 * 합성 입력만 사용 — 실데이터·실교사 이름을 쓰지 않는다.
 */
import {
  AiDiagnoseInput,
  buildDiagnosePrompt,
  buildPseudonymizer,
  isAiEnabled,
  runDiagnose,
} from "../src/lib/timetable/ai";

async function main() {
  if (!isAiEnabled()) {
    console.error("GEMINI_API_KEY가 없습니다 — .env.local 확인.");
    process.exit(1);
  }

  const teachers = [
    { email: "t-alpha@example.com", name: "테스트교사갑" },
    { email: "t-beta@example.com", name: "테스트교사을" },
  ];
  const input: AiDiagnoseInput = {
    termLabel: "검증용 학기",
    draftLabel: "스모크 초안",
    teachers,
    hard: [
      { code: "H2", text: "테스트교사갑 — 화 3교시에 2곳 동시 배정 (1-1 국어, 2-3 문학)" },
      { code: "H5", text: "테스트교사을 — 월 1교시 배정 금지 위반", registryGap: true },
      { code: "H1", text: "1-1반 수학(테스트교사을) — 시수표 4시간 중 3시간만 배정 (1시간 미배정)" },
    ],
    unplaced: [{ label: "1-1반 수학 테스트교사을", remaining: 1 }],
    softTotal: 42,
    registryStats: { simulGroups: 1, venueGroups: 1, teacherSlotBans: 0, consecutiveRules: 0, coTeaching: 0 },
  };

  // ① 전송 본문 무PII 기계 검증
  const p = buildPseudonymizer(teachers);
  const prompt = buildDiagnosePrompt(input, p);
  const leaks = ["테스트교사갑", "테스트교사을", "@example.com"].filter((s) => prompt.includes(s));
  console.log(`[①] 전송 프롬프트 PII 검사: ${leaks.length === 0 ? "✅ 실명·이메일 0건" : `❌ 유출 ${leaks.join(",")}`}`);
  if (leaks.length > 0) process.exit(1);

  // ② 실호출
  console.log("[②] Gemini 실호출 중…");
  const result = await runDiagnose(input, (process.env.GEMINI_API_KEY || "").trim());
  console.log(`\n진단: ${result.diagnosis}\n`);
  result.suggestions.forEach((s, i) => console.log(`제안 ${i + 1}: ${s}`));
  const restored =
    result.diagnosis.includes("테스트교사") ||
    result.suggestions.some((s) => s.includes("테스트교사")) ||
    (!/T\d{2}/.test(result.diagnosis) && !result.suggestions.some((s) => /T\d{2}/.test(s)));
  console.log(`\n[②] 파싱·역치환: ${restored ? "✅ (실명 복원 또는 가명 무언급)" : "⚠️ 가명 잔존 — unmask 확인 필요"}`);
  process.exit(restored ? 0 : 1);
}

main().catch((e) => {
  console.error("스모크 실패:", e?.message || e);
  process.exit(1);
});
