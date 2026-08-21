/**
 * memo_escape_selftest.ts
 *
 * 쪽지·업무 본문의 이스케이프 누출 회귀 방어 (2026-08-21 실기기 신고).
 *
 * 신고 증상: "좋은 하루~~~" 라고 썼는데 화면에 "좋은 하루\~\~\~" 로 보였다.
 * 원인: 작성기가 md1 직렬화하며 토큰 문자를 이스케이프하는데, 서식이 없으면
 *       평문으로 저장되고 평문 렌더 경로에는 이스케이프 해제가 없었다.
 *
 * 실행: npx tsx scripts/memo_escape_selftest.ts
 */

import {
  escapeMd1Literal,
  unescapeMd1Literal,
  parsePlainAutolink,
  parseMd1,
  bodyHasMd1Formatting,
  stripMd1,
} from "../src/lib/memo/richtext";
import type { RichBlock, RichInline } from "../src/lib/memo/richtext";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

/** 블록 트리에서 보이는 글자만 뽑는다 (화면에 실제로 렌더되는 것) */
function visibleText(blocks: RichBlock[]): string {
  const inline = (ns: RichInline[]): string =>
    ns.map((n: any) => (n.kind === "text" ? n.text : n.children ? inline(n.children) : n.text || "")).join("");
  return blocks
    .map((b: any) => (b.children ? inline(b.children) : ""))
    .join("\n");
}

console.log("=== 쪽지 이스케이프 누출 회귀 테스트 ===");

// ── Case 1: 신고된 그 입력 ──
console.log("\n[Case 1] 신고 입력 — 좋은 하루~~~");
const typed1 = "바로 볼 줄 몰랐음. 좋은 하루~~~";
const serialized1 = escapeMd1Literal(typed1);
assert(serialized1.includes("\\~"), `직렬화가 ~ 를 이스케이프해야 함: ${serialized1}`);
assert(!bodyHasMd1Formatting(serialized1), "서식이 없으므로 평문으로 판정돼야 함");
const rendered1 = visibleText(parsePlainAutolink(serialized1));
assert(rendered1 === typed1, `평문 렌더가 원문과 달라짐:\n  기대 ${typed1}\n  실제 ${rendered1}`);
console.log("  ✅ 평문 경로에서 역슬래시가 사라지고 원문 그대로 나온다");

// ── Case 2: ~ 만이 아니다 ──
console.log("\n[Case 2] 다른 토큰 문자들도 (* _ [ \\)");
for (const typed of ["3*4는 12", "snake_case 변수", "[참고] 확인 바람", "경로: C:\\temp", "a*b_c[d]~e"]) {
  const ser = escapeMd1Literal(typed);
  const out = visibleText(parsePlainAutolink(ser));
  assert(out === typed, `왕복 불일치: 원문 ${JSON.stringify(typed)} → ${JSON.stringify(out)}`);
}
console.log("  ✅ 5종 입력 전부 원문 그대로 복원");

// ── Case 3: 저장 쪽 — 평문 강등 시 이스케이프를 푼다 ──
console.log("\n[Case 3] 평문 강등 저장 시 본문에 역슬래시가 남지 않는다");
const stored = bodyHasMd1Formatting(serialized1) ? serialized1 : unescapeMd1Literal(serialized1);
assert(!stored.includes("\\"), `평문 저장분에 역슬래시가 남았다: ${stored}`);
assert(stored === typed1, `평문 저장분이 원문과 다르다: ${stored}`);
console.log("  ✅ 앞으로 저장되는 것은 이스케이프 없이 들어간다");

// ── Case 4: 회귀 방어 — 진짜 서식은 md1 그대로 살아 있어야 한다 ──
console.log("\n[Case 4] 실제 서식은 깨지지 않는다");
const md1 = "**굵게** 와 ~~취소선~~ 과 *기울임*";
assert(bodyHasMd1Formatting(md1), "이건 md1로 판정돼야 함");
const blocks = parseMd1(md1);
const kinds = JSON.stringify(blocks).match(/"kind":"(bold|strike|italic|underline)"/g) || [];
assert(kinds.length >= 3, `서식 노드가 살아있어야 함: ${JSON.stringify(kinds)}`);
assert(stripMd1(md1) === "굵게 와 취소선 과 기울임", `stripMd1 결과: ${stripMd1(md1)}`);
console.log("  ✅ 굵게·취소선·기울임 모두 서식으로 유지, stripMd1도 정상");

// ── Case 5: 이스케이프된 토큰은 서식이 되면 안 된다 ──
console.log("\n[Case 5] 이스케이프된 토큰이 서식으로 승격되지 않는다");
const escaped = escapeMd1Literal("**이건 굵게가 아니라 별표다**");
assert(!bodyHasMd1Formatting(escaped), "이스케이프됐으므로 서식이 아니어야 함");
assert(
  visibleText(parsePlainAutolink(escaped)) === "**이건 굵게가 아니라 별표다**",
  "별표가 리터럴로 보여야 함"
);
console.log("  ✅ 리터럴 별표가 굵게로 오해되지 않는다");

console.log("\n🎉 모든 5개 케이스 통과 (5/5)");
