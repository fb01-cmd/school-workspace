/**
 * Phase 9c-E AI 보조 자가 테스트 — 가명화 왕복·프롬프트 무PII·파싱 (네트워크·Firestore 무의존)
 *
 * 사용법: npx tsx scripts/ai_selftest.ts
 *
 * 실호출 스모크(verify_ai_smoke.ts)와 별개로, 순수 부분의 회귀 하네스.
 * 가명화 로직을 고치면 이 스크립트부터 통과시킬 것 (spec §2 — PII 외부 전송 0 보증의 근거).
 */
import {
  AiCallError,
  AiGridSummaryInput,
  buildCritiquePrompt,
  buildFormalizePrompt,
  buildPseudonymizer,
  normalizeFormalizeItems,
  parseCritiqueResponse,
  parseFormalizeResponse,
  runFormalize,
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

console.log("── E2 정식화: 파싱·별칭 해석·슬롯 전개 ──");
{
  const p = buildPseudonymizer([
    { email: "hong@hmh.or.kr", name: "홍길동" },
    { email: "", name: "창체" }, // 가상 교사 — 금지 규칙 대상 아님
  ]);
  // 별칭은 이름 가나다순 배정 — 하드코딩하지 않고 mask로 실제 별칭을 얻는다
  const hongAlias = p.mask("홍길동");
  const virtAlias = p.mask("창체");
  const parsed = parseFormalizeResponse(
    JSON.stringify({
      interpretation: `${hongAlias}의 월 1교시 배정금지`,
      items: [
        { teacher: hongAlias, kind: "assign", days: [1], periods: [1] },
        { teacher: "T99", kind: "move", days: [2], periods: "all" },
        { teacher: hongAlias, kind: "move", days: [0, 3, 9], periods: [1, 99] },
        { teacher: virtAlias, kind: "assign", days: [1], periods: [1] },
      ],
    })
  );
  expect("정식화 파싱", parsed !== null && parsed.items.length === 4);
  const { entries, warnings } = normalizeFormalizeItems(parsed!.items, p, 7);
  expect("정상 항목 → slot_ban 형태", entries.length === 2 &&
    entries[0].teacherEmail === "hong@hmh.or.kr" && entries[0].slots.length === 1,
    JSON.stringify(entries));
  expect("모르는 별칭 T99 + 가상 교사 제외+경고 2건", warnings.length === 2 &&
    warnings.some((w) => w.includes("T99")), JSON.stringify(warnings));
  expect("범위 밖 요일·교시 걸러냄", entries[1]?.slots.length === 1 &&
    entries[1].slots[0].day === 3 && entries[1].slots[0].period === 1);
  const all = normalizeFormalizeItems(
    [{ teacher: hongAlias, kind: "assign", soft: false, days: [5], periods: "all" }], p, 7
  );
  expect('"all" → 1~7교시 전개', all.entries[0]?.slots.length === 7);
  // 모델 출력 변형 실측: periods가 ["all"](배열 안 문자열)·빈 배열인 경우도 전일로 해석
  const variant = parseFormalizeResponse(
    JSON.stringify({ interpretation: "v", items: [
      { teacher: hongAlias, kind: "move", days: [5], periods: ["all"] },
      { teacher: hongAlias, kind: "move", days: [2], periods: [] },
    ]})
  );
  const vNorm = normalizeFormalizeItems(variant!.items, p, 7);
  expect('변형 ["all"] → 전일 전개', vNorm.entries[0]?.slots.length === 7, JSON.stringify(vNorm));
  expect("빈 periods+요일 지정 → 전일 해석", vNorm.entries[1]?.slots.length === 7);
  const prompt = buildFormalizePrompt(p.mask("홍길동은 월 1교시 회피"), p.aliases(), 7);
  expect("정식화 프롬프트 무PII", !prompt.includes("홍길동") && !prompt.includes("hong@"));
  expect("soft 어휘 안내 포함 (부탁 vs 반드시)", prompt.includes("되도록") && prompt.includes("soft"));

  // B6 「부탁성 희망」 — 되도록/가능하면은 어겨도 되는 요청이라 soft로 실린다
  const softParsed = parseFormalizeResponse(
    JSON.stringify({ interpretation: "s", items: [
      { teacher: hongAlias, kind: "assign", soft: true, days: [5], periods: [6, 7] },
      { teacher: hongAlias, kind: "move", soft: true, days: [1], periods: [1] },
    ]})
  );
  const softNorm = normalizeFormalizeItems(softParsed!.items, p, 7);
  expect("부탁(soft) 항목이 그대로 실린다", softNorm.entries[0]?.soft === true,
    JSON.stringify(softNorm.entries[0]));
  expect("이동금지에 붙은 soft는 버린다 (「되도록 움직이지 마세요」는 성립 안 함)",
    softNorm.entries[1]?.soft === undefined, JSON.stringify(softNorm.entries[1]));
  expect("soft 표시가 없으면 종전대로 하드 금지",
    normalizeFormalizeItems(
      [{ teacher: hongAlias, kind: "assign", soft: false, days: [1], periods: [1] }], p, 7
    ).entries[0]?.soft === undefined);
}

console.log("── E4: 요약 프롬프트 무PII·파싱 ──");
{
  const teachers = [
    { email: "hong@hmh.or.kr", name: "홍길동" },
    { email: "sung@hmh.or.kr", name: "성춘향" },
  ];
  const input: AiGridSummaryInput = {
    termLabel: "2026학년도 2학기",
    draftLabel: "자동 작성 #1",
    teachers,
    classes: 18,
    lessons: 540,
    hardCount: 1,
    unplaced: [{ label: "2-3반 통합과학 홍길동", remaining: 2 }],
    softTotal: 87,
    softByCode: [
      { label: "연속 3교시 이상", points: 60 },
      { label: "점심 전후 연속 수업", points: 27 },
      { label: "순배", points: 0 },
    ],
    penalties: [
      { text: "홍길동 — 화요일 3교시 연속 수업", points: 30 },
      { text: "성춘향 — 금요일 점심 전후 연속", points: 27 },
    ],
    teacherLoads: [
      { name: "홍길동", total: 18, byDay: [4, 4, 4, 3, 3] },
      { name: "성춘향", total: 16, byDay: [3, 3, 4, 3, 3] },
    ],
  };
  const p = buildPseudonymizer(teachers);
  const cPrompt = buildCritiquePrompt(input, p);
  expect("E4 비평 프롬프트 실명 0건", !cPrompt.includes("홍길동") && !cPrompt.includes("성춘향"));
  expect("E4 비평 프롬프트 이메일 0건", !cPrompt.includes("@hmh.or.kr"));
  expect("E4 비평 프롬프트 가명 존재", /T\d{2}/.test(cPrompt));
  expect("E4 JSON 출력 지시", cPrompt.includes('"suggestions"'));

  const okC = parseCritiqueResponse('{"suggestions":["T01의 화3 연속을 분산", "  ", 5]}');
  expect("E4 정상 JSON (비문자열·공백 제거)", okC?.suggestions.length === 1);
  expect("E4 빈 배열 유효 (개선점 없음)", parseCritiqueResponse('{"suggestions":[]}')?.suggestions.length === 0);
  expect("E4 형태 위반 → null", parseCritiqueResponse('{"foo":1}') === null);
  const manyC = parseCritiqueResponse(
    JSON.stringify({ suggestions: Array.from({ length: 12 }, (_, i) => `s${i}`) })
  );
  expect("E4 8개 상한", manyC?.suggestions.length === 8);
}

console.log("── 사전 거절 (외부 호출 차단) ──");
{
  const teachers = [{ email: "hong@hmh.or.kr", name: "홍길동" }];
  /** 호출이 진행되면(=거절 관문이 뚫리면) 실패, AiCallError 422면 통과 */
  const mustReject = (label: string, run: Promise<unknown>) =>
    run.then(
      () => {
        failed++;
        console.log(`  ❌ ${label} — 미등록 이름인데 호출이 진행됨`);
      },
      (e) => expect(label, e instanceof AiCallError && e.statusCode === 422, e?.message)
    );

  Promise.all([
    // E2 — 등록 교사 이름이 하나도 치환되지 않으면 fetch 없이 422
    mustReject(
      "E2 미등록 이름 → 422 사전 거절",
      runFormalize({ text: "김모르는사람은 월1 회피", teachers, periodsPerDay: 7 }, "dummy-key")
    ),
  ]).then(finish);
}

function finish() {
  console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}
