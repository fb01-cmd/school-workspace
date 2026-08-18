/**
 * WYSIWYG → md1 직렬화기 셀프테스트 (memo_richtext_spec §7 개정·§11) — 순수, DOM·Firestore 0
 * 실행: npx tsx scripts/verify_memo_richtext_dom.ts
 */
import { serializeDomToMd1, type Md1DomNode } from "../src/lib/memo/richtext_dom";
import { parseMd1, escapeMd1Literal } from "../src/lib/memo/richtext";

// ── 목 노드 헬퍼 ──
const t = (text: string): Md1DomNode => ({ nodeType: 3, nodeName: "#text", textContent: text, childNodes: [] });
const el = (name: string, kids: Md1DomNode[] = [], attrs: Record<string, string> = {}): Md1DomNode => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  childNodes: kids,
  getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
});
const root = (...kids: Md1DomNode[]) => el("div", kids);

let fails = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const pass = g === w;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}${pass ? "" : `\n   got:  ${g}\n   want: ${w}`}`);
};

// ① 마크 4종 + 평문
check("① 굵게", serializeDomToMd1(root(el("div", [t("앞 "), el("strong", [t("굵게")]), t(" 뒤")]))), "앞 **굵게** 뒤");
check("① 기울임(I)", serializeDomToMd1(root(el("div", [el("i", [t("x")])]))), "*x*");
check("① 밑줄", serializeDomToMd1(root(el("div", [el("u", [t("x")])]))), "__x__");
check("① 취소선(DEL)", serializeDomToMd1(root(el("div", [el("del", [t("x")])]))), "~~x~~");

// ② 리터럴 이스케이프 — 사용자가 친 * 가 서식으로 둔갑하지 않는다
check("② 리터럴 * 이스케이프", serializeDomToMd1(root(el("div", [t("2*3=6, a_b")]))), "2\\*3=6, a\\_b");
check("② escapeMd1Literal 왕복", parseMd1(escapeMd1Literal("**살아있는 별표**")), [
  { kind: "paragraph", children: [{ kind: "text", text: "**살아있는 별표**" }] },
]);

// ③ 중첩 마크 — 가장 바깥만 (결정론)
check("③ 굵게 안 기울임은 바깥만", serializeDomToMd1(root(el("div", [el("b", [el("i", [t("x")])])]))), "**x**");

// ④ 링크 — https만, 아니면 라벨 강등
check("④ https 링크", serializeDomToMd1(root(el("div", [el("a", [t("클릭")], { href: "https://a.b/c" })]))), "[클릭](https://a.b/c)");
check("④ http 라벨 강등", serializeDomToMd1(root(el("div", [el("a", [t("클릭")], { href: "http://a.b" })]))), "클릭");
check("④ javascript: 라벨 강등", serializeDomToMd1(root(el("div", [el("a", [t("x")], { href: "javascript:alert(1)" })]))), "x");

// ⑤ 목록 — 번호는 DOM 순서로 다시 매김
check(
  "⑤ 번호 목록 1·2·3",
  serializeDomToMd1(root(el("ol", [el("li", [t("a")]), el("li", [t("b")]), el("li", [t("c")])]))),
  "1. a\n2. b\n3. c"
);
check(
  "⑤ 글머리 + LI 안 BR은 공백",
  serializeDomToMd1(root(el("ul", [el("li", [t("한 줄"), el("br"), t("이어짐")])]))),
  "- 한 줄 이어짐"
);

// ⑥ 인용·줄 구조
check(
  "⑥ 인용 여러 줄",
  serializeDomToMd1(root(el("blockquote", [el("div", [t("q1")]), el("div", [t("q2")])]))),
  "> q1\n> q2"
);
check("⑥ DIV 두 개 = 두 줄", serializeDomToMd1(root(el("div", [t("a")]), el("div", [t("b")]))), "a\nb");
check("⑥ BR = 줄바꿈", serializeDomToMd1(root(el("div", [t("a"), el("br"), t("b")]))), "a\nb");
check("⑥ 루트 직속 텍스트", serializeDomToMd1(root(t("맨몸 텍스트"))), "맨몸 텍스트");
check("⑥ SPAN 투명 통과", serializeDomToMd1(root(el("div", [el("span", [t("x")])]))), "x");
check("⑥ 끝 빈 줄 제거", serializeDomToMd1(root(el("div", [t("a")]), el("div", []))), "a");

// ⑦ 왕복 정합 — 직렬화 결과를 파서에 넣으면 같은 구조
check(
  "⑦ 왕복: 굵게+목록",
  parseMd1(serializeDomToMd1(root(el("div", [el("b", [t("공지")])]), el("ul", [el("li", [t("하나")]), el("li", [t("둘")])])))),
  [
    { kind: "paragraph", children: [{ kind: "bold", text: "공지" }] },
    { kind: "bulletList", items: [[{ kind: "text", text: "하나" }], [{ kind: "text", text: "둘" }]] },
  ]
);
check(
  "⑦ 왕복: 리터럴 별표 문장",
  parseMd1(serializeDomToMd1(root(el("div", [t("별표 *는 그냥 별표")])))),
  [{ kind: "paragraph", children: [{ kind: "text", text: "별표 *는 그냥 별표" }] }]
);

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
