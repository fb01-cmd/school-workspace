/**
 * 과목 이름 단일 사전 셀프테스트 (subject_dictionary_spec §8)
 *
 * 실행: npx tsx scripts/verify_subject_dict.ts  (Firestore 무의존 — 순수 함수만)
 */
import {
  buildSubjectIndex,
  resolveExact,
  sameSubjectExact,
  suggestCandidates,
  resolveSubjectsForGate,
  applySubjectConfirmations,
  defaultShortNameFor,
  pruneSubjectsToReferenced,
} from "../src/lib/timetable/subjectDict";
import { buildSimulMatcher } from "../src/lib/timetable/simul";
import { SimulGroup, SubjectNameHistoryEntry, TimetableSubject } from "../src/lib/timetable/types";

const ok = (b: boolean) => (b ? "✅" : "❌");
let fails = 0;
const check = (label: string, b: boolean, detail = "") => {
  if (!b) fails++;
  console.log(`${ok(b)} ${label}${detail ? ` — ${detail}` : ""}`);
};

const S = (name: string, shortName: string, aliases?: string[]): TimetableSubject => ({
  name,
  shortName,
  teacherEmails: [],
  ...(aliases ? { aliases } : {}),
});

// [1] 색인·정확 일치 — name/shortName/alias 전 표기 해석, 사전 밖은 null
{
  const dict = [S("과학탐구실험2", "과탐2", ["과탐"]), S("중국어 회화", "중화")];
  const idx = buildSubjectIndex(dict);
  check(
    "[1] 정확 일치 — 정식명·약칭·별칭 전 표기",
    resolveExact(idx, "과학탐구실험2")?.name === "과학탐구실험2" &&
      resolveExact(idx, "과탐")?.name === "과학탐구실험2" &&
      resolveExact(idx, "중화")?.name === "중국어 회화" &&
      resolveExact(idx, "중국어회화")?.name === "중국어 회화" && // 공백 정규화
      resolveExact(idx, "논술") === null
  );
}

// [2] 실사고 4종 재연 — 별칭 확정 전에는 suggested 후보, 확정 후에는 exact
{
  const incidents: Array<[registry: string, formal: string, short: string]> = [
    ["과탐", "과학탐구실험2", "과탐2"],
    ["지구과학", "지구과학Ⅱ", "지2"],
    ["인공Ⅱ", "인공지능 기초", "인공"],
    ["수탐A", "수학과제탐구", "수탐"],
  ];
  for (const [alias, formal, short] of incidents) {
    const before = resolveSubjectsForGate([alias], [S(formal, short)], []);
    const suggested =
      before[0].status === "suggested" && before[0].candidates.some((c) => c.name === formal);
    const after = resolveSubjectsForGate([alias], [S(formal, short, [alias])], []);
    check(
      `[2] ${alias} ↔ ${formal}`,
      suggested && after[0].status === "exact" && after[0].resolved?.name === formal,
      `확정 전 ${before[0].status}(후보 ${before[0].candidates.length}) → 확정 후 ${after[0].status}`
    );
  }
}

// [3] 경계 보호 — 물리학Ⅰ/Ⅱ는 어느 경로로도 서로 엮이지 않는다
{
  const dict = [S("물리학Ⅰ", "물Ⅰ"), S("물리학Ⅱ", "물Ⅱ")];
  const idx = buildSubjectIndex(dict);
  const crossSuggest = suggestCandidates("물Ⅰ", dict, []).some((c) => c.name === "물리학Ⅱ");
  check(
    "[3] 물리학Ⅰ/Ⅱ 격리",
    sameSubjectExact(idx, "물Ⅰ", "물리학Ⅱ") === false &&
      sameSubjectExact(idx, "물Ⅰ", "물리학Ⅰ") === true &&
      !crossSuggest
  );
}

// [4] 신학기 시딩 — 빈 사전 + 이력 → 전 항목 new + 약칭 기본값이 이력에서 온다
{
  const history: SubjectNameHistoryEntry[] = [
    { alias: "과탐", canonicalName: "과학탐구실험2", shortName: "과탐2", confirmedBy: "t", confirmedAt: 1 },
  ];
  const res = resolveSubjectsForGate(["과학탐구실험2", "새내기과목"], [], history);
  check(
    "[4] 신학기 시딩",
    res.every((r) => r.status === "new") &&
      res[0].suggestedShortName === "과탐2" &&
      res[1].suggestedShortName === "새내", // 이력 없으면 앞 2글자 폴백 (기존 규약)
    `약칭 기본값: ${res.map((r) => r.suggestedShortName).join(", ")}`
  );
  check("[4b] 이력 후보 1순위", (() => {
    const withDict = resolveSubjectsForGate(["과탐"], [S("과학탐구실험2", "실험2")], history);
    return withDict[0].status === "suggested" && withDict[0].candidates[0]?.via === "history";
  })());
}

// [5] 확정 반영 — create/link, 충돌은 오류로
{
  const base = [S("물리학Ⅰ", "물Ⅰ")];
  const applied = applySubjectConfirmations(
    base,
    [
      { rawName: "인공지능 기초", action: "create", canonicalName: "인공지능 기초", shortName: "인공" },
      { rawName: "인공Ⅱ", action: "link", canonicalName: "인공지능 기초" },
      { rawName: "물Ⅰ", action: "link", canonicalName: "인공지능 기초" }, // 이미 물리학Ⅰ 표기 — 오류여야 함
    ],
    (name, shortName) => S(name, shortName)
  );
  const idx = buildSubjectIndex(applied.subjects);
  check(
    "[5] create+link 반영·충돌 거부",
    resolveExact(idx, "인공Ⅱ")?.name === "인공지능 기초" &&
      applied.errors.length === 1 &&
      applied.errors[0].includes("물Ⅰ"),
    `오류 ${applied.errors.length}건: ${applied.errors[0] || "(없음)"}`
  );
}

// [6] 색인 충돌(약칭 겹침) — 겹친 표기는 어느 쪽에도 안 붙고, 정식명은 계속 산다
{
  const idx = buildSubjectIndex([S("과학사", "과학"), S("과학탐구실험2", "과학")]);
  check(
    "[6] 겹친 약칭은 판정 불능 처리",
    resolveExact(idx, "과학") === null &&
      resolveExact(idx, "과학사")?.name === "과학사" &&
      resolveExact(idx, "과학탐구실험2")?.name === "과학탐구실험2"
  );
}

// [7] 소비자 통합 — 사전이 "다른 과목"이라 확정하면 느슨 폴백 금지, 사전 없으면 기존 폴백 유지
{
  const group: SimulGroup = {
    id: "g1",
    termId: "t",
    label: "지구과학 밴드",
    grade: 2,
    classNums: [1, 2],
    subjectNames: ["지구과학"],
    slots: [],
    active: true,
  } as unknown as SimulGroup;
  // 사전 없음 → 어젯밤 느슨 다리 그대로: "지구과학Ⅱ"가 태그 "지구과학"에 붙는다 (전환 1단계 안전망)
  const looseBind = buildSimulMatcher([group])(2, 1, 1, 1, "지구과학Ⅱ") !== null;
  // 사전이 지구과학·지구과학Ⅱ를 서로 다른 과목으로 알면 → 붙지 않는다 (내부 정확 일치만)
  const dict = [S("지구과학", "지구"), S("지구과학Ⅱ", "지2")];
  const dictBlocks = buildSimulMatcher([group], dict)(2, 1, 1, 1, "지구과학Ⅱ") === null;
  // 사전 별칭 확정("지구과학" 태그가 지구과학Ⅱ의 별칭) → 정확 일치로 붙는다
  const dict2 = [S("지구과학Ⅱ", "지2", ["지구과학"])];
  const dictBinds = buildSimulMatcher([group], dict2)(2, 1, 1, 1, "지구과학Ⅱ") !== null;
  check("[7] 매처 — 사전 우선·폴백 강등", looseBind && dictBlocks && dictBinds,
    `폴백 ${looseBind} · 사전 격리 ${dictBlocks} · 별칭 정확 일치 ${dictBinds}`);
}

// [8] 신학기 도태 — 승계 항목 중 올해 안 쓰는 것이 새 등록을 막지 않는다 (실사고: 「논술」 vs 논술A/B 약칭)
{
  const inherited = [S("논술A", "논술"), S("논술B", "논술"), S("미술", "미술")];
  const rowNames = ["논술", "미술"]; // 올해 배정표 — 미술은 정확 일치로 계속 쓰임, 논술A/B는 안 쓰임
  const confs = [{ rawName: "논술", action: "create" as const, canonicalName: "논술", shortName: "논술" }];
  // 도태 전에는 create가 승계 약칭에 막힌다 (거부 자체는 안전장치로서 정상)
  const blocked = applySubjectConfirmations(inherited, confs, (n, s) => S(n, s));
  // 도태 후에는 논술A/B가 빠지고 create가 성립하며, 계속 쓰는 미술은 살아남는다
  const pruned = pruneSubjectsToReferenced(inherited, rowNames, confs);
  const applied = applySubjectConfirmations(pruned, confs, (n, s) => S(n, s));
  const idx = buildSubjectIndex(applied.subjects);
  check(
    "[8] 신학기 도태 — 안 쓰는 승계 표기 정리 후 새 등록 성립",
    blocked.errors.length === 1 &&
      pruned.length === 1 &&
      pruned[0].name === "미술" &&
      applied.errors.length === 0 &&
      resolveExact(idx, "논술")?.name === "논술" &&
      resolveExact(idx, "미술")?.name === "미술",
    `도태 전 오류 ${blocked.errors.length}건 → 도태 후 오류 ${applied.errors.length}건 · 생존 ${pruned.map((e) => e.name).join(",")}`
  );
}

// [9] 같은 저장 안의 표기 자기 충돌 — 공백만 다른 두 create는 오류가 아니라 별칭 합류 (실사고: 인공지능 기초/인공지능기초)
{
  const applied = applySubjectConfirmations(
    [] as ReturnType<typeof S>[],
    [
      { rawName: "인공지능 기초", action: "create", canonicalName: "인공지능 기초", shortName: "인공" },
      { rawName: "인공지능기초", action: "create", canonicalName: "인공지능기초", shortName: "인공" },
    ],
    (n, s) => S(n, s)
  );
  const idx = buildSubjectIndex(applied.subjects);
  check(
    "[9] 공백 변형 create 자기 충돌 → 별칭 자동 합류",
    applied.errors.length === 0 &&
      applied.subjects.length === 1 &&
      resolveExact(idx, "인공지능기초")?.name === "인공지능 기초" &&
      resolveExact(idx, "인공지능 기초")?.name === "인공지능 기초",
    `오류 ${applied.errors.length}건 · 항목 ${applied.subjects.length}개 · 별칭 ${JSON.stringify(applied.subjects[0]?.aliases)}`
  );
}

// [10] 3차 실측 재연 — 현황이 작년 분반 표기(논술A/B)를 그대로 쓸 때, 그 자동 연결 메아리가
// 도태를 면제시켜 새 등록을 막으면 안 된다 (서버 saveHoursPlan의 필터 규칙 합성 재연)
{
  const inherited = [S("논술A", "논술"), S("논술B", "논술"), S("미술", "미술")];
  const rowNames = ["논술", "미술"];
  const allConfs = [
    { rawName: "미술", action: "link" as const, canonicalName: "미술" }, // 행 유래 exact 메아리
    { rawName: "논술A", action: "link" as const, canonicalName: "논술A" }, // 현황 유래 exact 메아리
    { rawName: "논술B", action: "link" as const, canonicalName: "논술B" },
    { rawName: "논술", action: "create" as const, canonicalName: "논술", shortName: "논술" },
  ];
  const normOf = (s: string) => s.trim().replace(/\s+/g, "").toLowerCase();
  const rowNorms = new Set(rowNames.map(normOf));
  const pruned = pruneSubjectsToReferenced(
    inherited,
    rowNames,
    allConfs.filter((c) => c.action === "link" && rowNorms.has(normOf(c.rawName)))
  );
  const survivors = new Set(pruned.map((e) => normOf(e.name)));
  const filtered = allConfs.filter((c) => {
    if (c.action !== "link") return true;
    if (survivors.has(normOf(c.canonicalName))) return true;
    return rowNorms.has(normOf(c.rawName));
  });
  const applied = applySubjectConfirmations(pruned, filtered, (n, s) => S(n, s));
  const idx = buildSubjectIndex(applied.subjects);
  check(
    "[10] 현황의 작년 분반 표기 메아리에도 새 등록 성립",
    applied.errors.length === 0 &&
      resolveExact(idx, "논술")?.name === "논술" &&
      resolveExact(idx, "미술")?.name === "미술" &&
      !applied.subjects.some((e) => e.name === "논술A"),
    `오류 ${applied.errors.length}건 · 항목 ${applied.subjects.map((e) => e.name).join(",")}`
  );
}

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
