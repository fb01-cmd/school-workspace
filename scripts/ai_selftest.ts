/**
 * Phase 9c-E AI 보조 자가 테스트 — 가명화 왕복·프롬프트 무PII·파싱 (네트워크·Firestore 무의존)
 *
 * 사용법: npx tsx scripts/ai_selftest.ts
 *
 * 실호출 스모크(verify_ai_smoke.ts)와 별개로, 순수 부분의 회귀 하네스.
 * 가명화 로직을 고치면 이 스크립트부터 통과시킬 것 (spec §2 — PII 외부 전송 0 보증의 근거).
 */
import {
  AiAskFixPenalty,
  AiCallError,
  AiDiagnoseInput,
  AiGridSummaryInput,
  ASK_FIX_EXAMPLES,
  buildAskFixPrompt,
  buildCritiquePrompt,
  buildDiagnosePrompt,
  buildExplainPrompt,
  buildFormalizePrompt,
  buildPseudonymizer,
  findUnmaskedTeacherMention,
  normalizeAskFixGoal,
  normalizeFormalizeItems,
  parseAskFixResponse,
  parseCritiqueResponse,
  parseDiagnoseResponse,
  parseExplainResponse,
  parseFormalizeResponse,
  runAskFix,
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

console.log("── 말로 묻는 해결사: 질문 해석 ──");
{
  const teachers = [
    { email: "kyungho@hmh.or.kr", name: "이경호" },
    { email: "sung@hmh.or.kr", name: "권성민" },
  ];
  const p = buildPseudonymizer(teachers);
  const alias = p.mask("이경호");
  const penalties: AiAskFixPenalty[] = [
    { code: "S2", key: "kyungho@hmh.or.kr", day: 2, text: "이경호 선생님 화요일 연속 3교시 발생", points: 1 },
    { code: "S7", key: "2-3", day: 0, text: "2-3반 미적Ⅰ 3회가 전부 1교시 (교시 회전 없음)", points: 0.5 },
  ];
  const ctx = { periodsPerDay: 7, classes: [{ grade: 2, classNum: 3 }], penalties };

  // 프롬프트 무PII — 감점 목록의 실명까지 전부 가명화된 채로 나가야 한다
  const prompt = buildAskFixPrompt(
    p.mask("이경호 선생님 1교시가 5일 연속인데 3일 이하로 줄일 수 있을까요?"),
    p.aliases(),
    7,
    penalties.map((d) => p.mask(d.text))
  );
  expect("질문 프롬프트 실명 0건", !prompt.includes("이경호") && !prompt.includes("권성민"));
  expect("감점 목록이 프롬프트에 실렸고 그 안에도 실명 0건",
    prompt.includes("화요일 연속 3교시") && prompt.includes("#1") && !prompt.includes("이경호"));
  expect("이메일 0건", !prompt.includes("@hmh.or.kr"), "감점 key가 프롬프트에 샜다");
  expect("가명 존재", /T\d{2}/.test(prompt));
  expect("수(手)를 만들지 말라는 지시 포함", prompt.includes("제안하지 마세요"));

  // 해석 → 정형 목표
  const raw = parseAskFixResponse(
    JSON.stringify({
      interpretation: `${alias}의 1교시를 주 3일 이하로`,
      goal: { kind: "teacher-period-days", teacher: alias, period: 1, max: 3 },
    })
  );
  expect("질문 해석 파싱", raw !== null && raw.goal?.kind === "teacher-period-days");
  const g1 = normalizeAskFixGoal(raw!.goal, p, ctx);
  expect("별칭 → 실제 이메일 해석",
    g1.goal?.kind === "teacher-period-days" && g1.goal.teacherEmail === "kyungho@hmh.or.kr" &&
      g1.goal.maxDays === 3, JSON.stringify(g1));

  // 숫자를 말하지 않은 질문 → "reduce" (AI가 숫자를 지어내지 않는다)
  const g2 = normalizeAskFixGoal(
    { kind: "teacher-period-days", teacher: alias, period: 1 }, p, ctx
  );
  expect('목표치 미지정 → "reduce"',
    g2.goal?.kind === "teacher-period-days" && g2.goal.maxDays === "reduce");

  // 기존 감점 지목은 색인으로만 — key(이메일)를 AI가 만들어내지 않는다
  const g3 = normalizeAskFixGoal({ kind: "existing-detail", detailIndex: 1 }, p, ctx);
  expect("기존 감점 색인 → code·key·day 복원",
    g3.goal?.kind === "existing-detail" && g3.goal.code === "S7" && g3.goal.key === "2-3",
    JSON.stringify(g3));
  expect("없는 색인은 버린다",
    normalizeAskFixGoal({ kind: "existing-detail", detailIndex: 9 }, p, ctx).goal === null);

  // 반쯤 해석된 목표로 탐색을 돌리지 않는다 — 어긋나면 goal 자체를 만들지 않는다
  expect("모르는 별칭 → 목표 없음 + 경고",
    normalizeAskFixGoal({ kind: "teacher-period-days", teacher: "T99", period: 1 }, p, ctx).goal === null);
  expect("범위 밖 교시 → 목표 없음",
    normalizeAskFixGoal({ kind: "teacher-period-days", teacher: alias, period: 99 }, p, ctx).goal === null);
  expect("없는 학급 → 목표 없음",
    normalizeAskFixGoal({ kind: "move-cell", grade: 9, classNum: 9, day: 1, period: 1 }, p, ctx).goal === null);
  expect("어휘 밖 요구 → 목표 없음 (억지로 끼워 맞추지 않는다)",
    normalizeAskFixGoal({ kind: "make-everyone-happy" }, p, ctx).goal === null);
  expect("goal:null 응답도 정상 파싱 (못 알아들었다는 답)",
    parseAskFixResponse('{"interpretation":"무슨 뜻인지 모르겠습니다","goal":null}')?.goal === null);
  expect("알아듣는 질문의 예가 준비돼 있다 (막다른 길 금지)", ASK_FIX_EXAMPLES.length >= 3);

  expect("정상 학급·과목 목표", (() => {
    const g = normalizeAskFixGoal(
      { kind: "subject-rotation", grade: 2, classNum: 3, subject: "미적Ⅰ" }, p, ctx
    ).goal;
    return g?.kind === "subject-rotation" && g.subjectName === "미적Ⅰ";
  })());
  expect("요일 목표", (() => {
    const g = normalizeAskFixGoal({ kind: "teacher-day-hours", teacher: alias, day: 2, max: 5 }, p, ctx).goal;
    return g?.kind === "teacher-day-hours" && g.day === 2 && g.maxHours === 5;
  })());

  // 등록부에 없는 이름이 원문 그대로 나가는 것을 막는 관문
  expect("미등록 「○○ 선생님」 탐지", findUnmaskedTeacherMention(p.mask("김모름 선생님 1교시")) === "김모름");
  expect("등록 교사만 있으면 통과", findUnmaskedTeacherMention(p.mask("이경호 선생님 1교시")) === null);
  expect("교사 이름 없는 질문도 통과 (학급·과목 질문)",
    findUnmaskedTeacherMention(p.mask("2학년 3반 미적Ⅰ이 매번 같은 교시입니다")) === null);
}

console.log("── E3·E4: 요약 프롬프트 무PII·파싱 ──");
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
  const ePrompt = buildExplainPrompt(input, p);
  const cPrompt = buildCritiquePrompt(input, p);
  for (const [label, prompt] of [["E3 설명", ePrompt], ["E4 비평", cPrompt]] as const) {
    expect(`${label} 프롬프트 실명 0건`, !prompt.includes("홍길동") && !prompt.includes("성춘향"));
    expect(`${label} 프롬프트 이메일 0건`, !prompt.includes("@hmh.or.kr"));
    expect(`${label} 프롬프트 가명 존재`, /T\d{2}/.test(prompt));
  }
  expect("감점 0 코드는 요약에서 제외", !ePrompt.includes("순배"));
  expect("부하 분포 포함", ePrompt.includes("주 18시간") && ePrompt.includes("4/4/4/3/3"));
  expect("E3 JSON 출력 지시", ePrompt.includes('"explanation"'));
  expect("E4 JSON 출력 지시", cPrompt.includes('"suggestions"'));

  const okE = parseExplainResponse('{"explanation":"T01의 화요일 연속은 동시수업 제약의 절충으로 보입니다."}');
  expect("E3 정상 JSON", okE?.explanation.includes("T01") === true);
  expect("E3 빈 문자열 → null", parseExplainResponse('{"explanation":"  "}') === null);
  expect("E3 비JSON → null", parseExplainResponse("그냥 텍스트") === null);
  const longE = parseExplainResponse(JSON.stringify({ explanation: "가".repeat(5000) }));
  expect("E3 3000자 상한", (longE?.explanation.length || 0) === 3000);

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
    // 해결사 — 질문에 교사 이름이 없는 경우가 정상이므로, 가명화 후에도 남은
    // 「○○○ 선생님」만 잡는다 (등록부에 없는 이름의 원문 유출 차단)
    mustReject(
      "질문의 미등록 「○○ 선생님」 → 422 사전 거절",
      runAskFix(
        {
          text: "김모르는사람 선생님 1교시가 5일 연속입니다",
          teachers,
          periodsPerDay: 7,
          classes: [{ grade: 1, classNum: 1 }],
          penalties: [],
        },
        "dummy-key"
      )
    ),
  ]).then(finish);
}

function finish() {
  console.log(failed === 0 ? "\n🎉 전체 통과" : `\n💥 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}
