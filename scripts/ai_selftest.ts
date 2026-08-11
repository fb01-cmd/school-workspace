/**
 * Phase 9c-E AI 보조 자가 테스트 — 가명화 왕복·프롬프트 무PII·파싱 (네트워크·Firestore 무의존)
 *
 * 사용법: npx tsx scripts/ai_selftest.ts
 *
 * 실호출 스모크(verify_ai_smoke.ts)와 별개로, 순수 부분의 회귀 하네스.
 * 가명화 로직을 고치면 이 스크립트부터 통과시킬 것 (spec §2 — PII 외부 전송 0 보증의 근거).
 */
import {
  AiDiagnoseInput,
  buildDiagnosePrompt,
  buildPseudonymizer,
  parseDiagnoseResponse,
} from "../src/lib/timetable/ai";

let failed = 0;
function expect(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("── 가명화 왕복 ──");
{
  const p = buildPseudonymizer([
    { email: "kim@hmh.or.kr", name: "김지구" },
    { email: "lee@hmh.or.kr", name: "지구" }, // 부분 문자열 겹침 — 긴 이름 먼저 치환돼야 함
    { email: "", name: "창체" }, // 가상 교사 (이메일 없음)
  ]);
  const masked = p.mask("김지구(kim@hmh.or.kr)와 지구 교사가 화3 중복, 창체는 제외");
  expect("실명 잔존 0", !masked.includes("김지구") && !masked.includes("지구") && !masked.includes("창체"), masked);
  expect("이메일 잔존 0", !masked.includes("kim@hmh.or.kr") && !masked.includes("lee@"), masked);
  expect("겹침 이름 오염 없음 (김T?? 잔여 금지)", !/김T\d/.test(masked), masked);
  const un = p.unmask(masked);
  expect("역치환 복원", un.includes("김지구") && un.includes("창체"), un);
  expect("결정론 — 같은 입력 같은 가명", buildPseudonymizer([{ name: "김지구" }, { name: "지구" }]).mask("지구") ===
    buildPseudonymizer([{ name: "지구" }, { name: "김지구" }]).mask("지구"));
}

console.log("── 프롬프트 무PII (기계 검증) ──");
{
  const teachers = [
    { email: "hong@hmh.or.kr", name: "홍길동" },
    { email: "sung@hmh.or.kr", name: "성춘향" },
  ];
  const input: AiDiagnoseInput = {
    termLabel: "2026학년도 2학기",
    draftLabel: "자동 작성 #1",
    teachers,
    hard: [
      { code: "H2", text: "홍길동 — 화 3교시에 2곳 동시 배정 (1-1 국어, 2-3 문학)" },
      { code: "H5", text: "성춘향 — 월 1교시 배정 금지 위반", registryGap: true, hint: "특별교사 금지 등록부 확인" },
    ],
    unplaced: [{ label: "2-3반 통합과학 홍길동", remaining: 2 }],
    softTotal: 123,
    registryStats: { simulGroups: 5, venueGroups: 4, teacherSlotBans: 0, consecutiveRules: 2, coTeaching: 1 },
  };
  const p = buildPseudonymizer(teachers);
  const prompt = buildDiagnosePrompt(input, p);
  expect("실명 0건", !prompt.includes("홍길동") && !prompt.includes("성춘향"), "프롬프트에 실명 잔존");
  expect("이메일 0건", !prompt.includes("@hmh.or.kr"));
  expect("가명 존재", /T\d{2}/.test(prompt));
  expect("등록부미비 표기", prompt.includes("등록부미비"));
  expect("미배정 라벨 마스킹", prompt.includes("미배정 2시간") && !prompt.includes("홍길동"));
  expect("JSON 출력 지시 포함", prompt.includes('"diagnosis"') && prompt.includes('"suggestions"'));
}

console.log("── 응답 파싱 ──");
{
  const ok = parseDiagnoseResponse('{"diagnosis":"T01의 화3 중복이 핵심","suggestions":["a","b"]}');
  expect("정상 JSON", ok?.diagnosis.includes("T01") === true && ok?.suggestions.length === 2);
  const fenced = parseDiagnoseResponse('```json\n{"diagnosis":"d","suggestions":[]}\n```');
  expect("코드펜스 제거", fenced?.diagnosis === "d");
  expect("비JSON → null", parseDiagnoseResponse("이건 그냥 텍스트") === null);
  expect("형태 위반 → null", parseDiagnoseResponse('{"foo":1}') === null);
  const many = parseDiagnoseResponse(
    JSON.stringify({ diagnosis: "d", suggestions: Array.from({ length: 10 }, (_, i) => `s${i}`) })
  );
  expect("suggestions 6개 상한", many?.suggestions.length === 6);
  const long = parseDiagnoseResponse(JSON.stringify({ diagnosis: "가".repeat(3000), suggestions: [] }));
  expect("diagnosis 2000자 상한", (long?.diagnosis.length || 0) === 2000);
}

console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
