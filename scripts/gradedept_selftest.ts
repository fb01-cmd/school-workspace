#!/usr/bin/env npx tsx
/**
 * 학년부 판정 자가 테스트 (docs/grade_dept_spec.md §5-1)
 *
 * 실행: npx tsx scripts/gradedept_selftest.ts
 *
 * 이 테스트가 지키는 것은 하나다 — **화면과 정렬이 같은 답을 내는가.**
 * 2026-08-21 이전에는 둘이 서로 다른 정규식을 써서, 부서를 「1학년부」로 개명하면
 * 정렬은 학년부로 보는데 화면은 아니게 되어 담임 반 선택이 조용히 사라졌다.
 * 이제 둘 다 gradeOfDepartment 하나를 쓰므로, 이 함수만 지키면 그 사고가 안 난다.
 */
import { gradeOfDepartment } from "../src/lib/org/gradeDept";

type Case = { name: string; dept: string; settings: any; want: number; why: string };

const CASES: Case[] = [
  // ── 기본 (설정 없음 = 기존 도메인. 마이그레이션 0의 근거) ──
  { name: "기존 그대로", dept: "1학년", settings: null, want: 1, why: "지금까지 동작하던 형태가 그대로여야 한다" },
  { name: "기존 그대로 3학년", dept: "3학년", settings: null, want: 3, why: "" },
  { name: "학년부 아님", dept: "교무기획부", settings: null, want: 0, why: "" },
  { name: "학년부 아님(교과)", dept: "국어", settings: null, want: 0, why: "" },

  // ── 이 스펙이 생긴 이유 ──
  { name: "★ 개명형 「1학년부」", dept: "1학년부", settings: null, want: 1,
    why: "이것이 0이 되던 것이 사고의 원인 — 정렬은 1로 보고 화면은 0으로 봤다" },
  { name: "★ 개명형 「2학년부」", dept: "2학년부", settings: null, want: 2, why: "" },
  { name: "「1학년 담당」", dept: "1학년 담당", settings: null, want: 1, why: "N학년으로 시작하면 인정" },
  { name: "공백 낀 「1 학년」", dept: "1 학년", settings: null, want: 1, why: "" },

  // ── 범위 (하드코딩 [1-3] 제거의 근거) ──
  { name: "3학년제에서 4학년", dept: "4학년", settings: { gradesCount: 3 }, want: 0,
    why: "학년 수를 넘으면 학년부가 아니다" },
  { name: "6학년제에서 4학년", dept: "4학년", settings: { gradesCount: 6 }, want: 4,
    why: "★ 예전엔 [1-3] 하드코딩이라 항상 0이었다" },
  { name: "6학년제에서 6학년부", dept: "6학년부", settings: { gradesCount: 6 }, want: 6, why: "" },
  { name: "「11학년」", dept: "11학년", settings: { gradesCount: 3 }, want: 0,
    why: "앞자리만 떼어 1로 읽으면 안 된다" },
  { name: "「0학년」", dept: "0학년", settings: null, want: 0, why: "" },

  // ── 연결 표 (이름을 무엇으로 바꾸든 유지) ──
  { name: "★ 연결 표가 이름을 이긴다", dept: "저학년부", settings: { gradeDepartments: { 저학년부: 1 } }, want: 1,
    why: "이름에 「학년」이 없어도 연결이 있으면 학년부다" },
  { name: "연결 표가 이름과 다를 때", dept: "1학년", settings: { gradeDepartments: { "1학년": 2 } }, want: 2,
    why: "적어 둔 쪽이 우선 — 짐작보다 명시가 세다" },
  { name: "연결 표에 없는 부서는 폴백", dept: "2학년", settings: { gradeDepartments: { 저학년부: 1 } }, want: 2, why: "" },
  { name: "연결 표에 0", dept: "교무기획부", settings: { gradeDepartments: { 교무기획부: 0 } }, want: 0, why: "" },

  // ── 잡값 ──
  { name: "빈 문자열", dept: "", settings: null, want: 0, why: "" },
  { name: "「학년부」(숫자 없음)", dept: "학년부", settings: null, want: 0, why: "" },
  { name: "앞뒤 공백", dept: "  2학년  ", settings: null, want: 2, why: "" },
];

let pass = 0;
const fails: string[] = [];

for (const c of CASES) {
  const got = gradeOfDepartment(c.dept, c.settings);
  if (got === c.want) {
    pass++;
  } else {
    fails.push(`  ❌ ${c.name}: gradeOfDepartment(${JSON.stringify(c.dept)}) = ${got}, 기대 ${c.want}${c.why ? `\n       (${c.why})` : ""}`);
  }
}

// ── 사고 재현 방지: 화면과 정렬이 같은 답을 내는가 ──
// 예전에는 화면이 /^([1-3])학년$/, 정렬이 /^([1-3])학년/ 이었다. 두 옛 규칙을 여기서
// 재현해, 「둘이 갈리던 이름」이 이제는 하나의 답으로 모이는지 확인한다.
const OLD_SCREEN = (d: string) => (/^([1-3])학년$/.test(d) ? Number(d[0]) : 0);
const OLD_SORT = (d: string) => { const m = d.match(/^([1-3])학년/); return m ? Number(m[1]) : 0; };
const DIVERGED = ["1학년부", "2학년부", "3학년 담당", "1학년(가)"];

let dividedNow = 0;
for (const d of DIVERGED) {
  if (OLD_SCREEN(d) === OLD_SORT(d)) {
    fails.push(`  ❌ 테스트 자체가 틀렸다 — 「${d}」는 옛 규칙에서 갈리지 않는다`);
    continue;
  }
  // 지금은 하나의 함수이므로 갈릴 수가 없다. 값이 0이 아니어야 의미가 있다.
  const now = gradeOfDepartment(d, null);
  if (now === 0) {
    dividedNow++;
    fails.push(`  ❌ 「${d}」가 지금도 학년부로 안 잡힌다 (= ${now})`);
  }
}

console.log(`── 학년부 판정 자가 테스트 ──`);
console.log(`  케이스 ${pass}/${CASES.length} 통과`);
console.log(`  옛 규칙이 갈리던 이름 ${DIVERGED.length}종 — 지금은 전부 한 답: ${dividedNow === 0 ? "✅" : "❌"}`);

if (fails.length) {
  console.log("");
  fails.forEach((f) => console.log(f));
  console.log("");
  console.log("❌ 실패 — docs/grade_dept_spec.md §3-2를 보라");
  process.exit(1);
}
console.log("");
console.log("✅ 전부 통과");
