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
  AiGridSummaryInput,
  buildCritiquePrompt,
  buildDiagnosePrompt,
  buildExplainPrompt,
  buildFormalizePrompt,
  buildPseudonymizer,
  isAiEnabled,
  runCritique,
  runDiagnose,
  runExplain,
  runFormalize,
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
  if (!restored) process.exit(1);

  // ③ E2 정식화 실호출 — 프롬프트 무PII 기계 검증 + 제안이 slot_ban 형태로 나오는지
  const fText = "테스트교사갑은 월요일 1교시 배정 금지, 테스트교사을은 금요일 하루 종일 이동 금지";
  const fp = buildPseudonymizer(teachers);
  const fPrompt = buildFormalizePrompt(fp.mask(fText), fp.aliases(), 7);
  const fLeaks = ["테스트교사갑", "테스트교사을", "@example.com"].filter((s) => fPrompt.includes(s));
  console.log(`\n[③] 정식화 프롬프트 PII 검사: ${fLeaks.length === 0 ? "✅ 실명·이메일 0건" : `❌ 유출 ${fLeaks.join(",")}`}`);
  if (fLeaks.length > 0) process.exit(1);

  console.log("[③] 정식화 실호출 중…");
  const proposal = await runFormalize(
    { text: fText, teachers, periodsPerDay: 7 },
    (process.env.GEMINI_API_KEY || "").trim()
  );
  console.log(`\n해석: ${proposal.interpretation}`);
  for (const e of proposal.entries) {
    console.log(
      `제안: ${e.teacherName}(${e.teacherEmail}) ${e.kind === "move" ? "이동금지" : "배정금지"} — ${e.slots.map((s) => `${["", "월", "화", "수", "목", "금"][s.day]}${s.period}`).join(", ")}`
    );
  }
  proposal.warnings.forEach((w) => console.log(`경고: ${w}`));
  const okShape =
    proposal.entries.length >= 1 &&
    proposal.entries.every(
      (e) => e.teacherEmail.includes("@") && e.slots.every((s) => s.day >= 1 && s.day <= 5 && s.period >= 1 && s.period <= 7)
    );
  console.log(`\n[③] 제안 형태(slot_ban 정합): ${okShape ? "✅" : "❌"}`);
  if (!okShape) process.exit(1);

  // ④ E3 결과 설명 · E4 정성 비평 실호출 — 프롬프트 무PII 기계 검증 + 파싱·역치환
  const summary: AiGridSummaryInput = {
    termLabel: "검증용 학기",
    draftLabel: "스모크 초안",
    teachers,
    classes: 6,
    lessons: 180,
    hardCount: 0,
    unplaced: [],
    softTotal: 57,
    softByCode: [
      { label: "연속 3교시 이상", points: 30 },
      { label: "점심 전후 연속 수업", points: 27 },
    ],
    penalties: [
      { text: "테스트교사갑 — 화요일 3교시 연속 수업", points: 30 },
      { text: "테스트교사을 — 금요일 점심 전후 연속", points: 27 },
    ],
    teacherLoads: [
      { name: "테스트교사갑", total: 18, byDay: [4, 4, 4, 3, 3] },
      { name: "테스트교사을", total: 16, byDay: [3, 3, 4, 3, 3] },
    ],
  };
  const sp = buildPseudonymizer(teachers);
  const sLeaks = ["테스트교사갑", "테스트교사을", "@example.com"].filter(
    (s) => buildExplainPrompt(summary, sp).includes(s) || buildCritiquePrompt(summary, sp).includes(s)
  );
  console.log(`\n[④] E3·E4 프롬프트 PII 검사: ${sLeaks.length === 0 ? "✅ 실명·이메일 0건" : `❌ 유출 ${sLeaks.join(",")}`}`);
  if (sLeaks.length > 0) process.exit(1);

  console.log("[④] E3 결과 설명 실호출 중…");
  const explain = await runExplain(summary, (process.env.GEMINI_API_KEY || "").trim());
  console.log(`\n설명: ${explain.explanation}`);
  console.log("\n[④] E4 정성 비평 실호출 중…");
  const critique = await runCritique(summary, (process.env.GEMINI_API_KEY || "").trim());
  critique.suggestions.forEach((s, i) => console.log(`제안 ${i + 1}: ${s}`));
  const okE34 =
    explain.explanation.length > 0 &&
    !/T\d{2}/.test(explain.explanation + critique.suggestions.join(" "));
  console.log(`\n[④] E3·E4 파싱·역치환: ${okE34 ? "✅ (내용 존재 + 가명 잔존 0)" : "⚠️ 가명 잔존 또는 빈 응답"}`);
  process.exit(okE34 ? 0 : 1);
}

main().catch((e) => {
  console.error("스모크 실패:", e?.message || e);
  process.exit(1);
});
