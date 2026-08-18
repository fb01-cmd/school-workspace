/**
 * 쪽지 서식 md1 셀프테스트 (memo_richtext_spec §11) — 순수, Firestore 0회
 * 실행: npx tsx scripts/verify_memo_richtext.ts
 */
import {
  parseMd1,
  parseInlineMd1,
  stripMd1,
  bodyHasMd1Formatting,
  collectMd1AttachmentIds,
} from "../src/lib/memo/richtext";
import { validateMemoContent, MEMO_MAX_BODY } from "../src/lib/memo/logic";

let fails = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const pass = g === w;
  if (!pass) fails++;
  console.log(`${pass ? "✅" : "❌"} ${label}${pass ? "" : `\n   got:  ${g}\n   want: ${w}`}`);
};

// ① 인라인 4종
check("① 굵게", parseInlineMd1("a **b** c"), [
  { kind: "text", text: "a " },
  { kind: "bold", text: "b" },
  { kind: "text", text: " c" },
]);
check("① 기울임", parseInlineMd1("*x*"), [{ kind: "italic", text: "x" }]);
check("① 밑줄", parseInlineMd1("__x__"), [{ kind: "underline", text: "x" }]);
check("① 취소선", parseInlineMd1("~~x~~"), [{ kind: "strike", text: "x" }]);

// ② 미닫힘·빈 내용 토큰은 평문 보존
check("② 미닫힘 **", parseInlineMd1("**abc"), [{ kind: "text", text: "**abc" }]);
check("② 빈 내용 ****", parseInlineMd1("****"), [{ kind: "text", text: "****" }]);
check("② 홀 ~ 는 토큰 아님", parseInlineMd1("~x~"), [{ kind: "text", text: "~x~" }]);

// ③ 이스케이프 리터럴
check("③ \\* 리터럴", parseInlineMd1("\\*not\\*"), [{ kind: "text", text: "*not*" }]);
check("③ 토큰 안 이스케이프", parseInlineMd1("**a\\*b**"), [{ kind: "bold", text: "a*b" }]);
check("③ \\\\ 리터럴", parseInlineMd1("\\\\"), [{ kind: "text", text: "\\" }]);

// ④ 링크 — https만 성립
check("④ https 링크", parseInlineMd1("[클릭](https://a.b/c)"), [
  { kind: "link", label: "클릭", href: "https://a.b/c" },
]);
check("④ javascript: 불성립", parseInlineMd1("[x](javascript:alert(1))"), [
  { kind: "text", text: "[x](javascript:alert(1))" },
]);
check("④ http 불성립", parseInlineMd1("[x](http://a.b)"), [
  { kind: "text", text: "[x](http://a.b)" },
]);
check("④ 공백 URL 불성립", parseInlineMd1("[x](https://a b)"), [
  { kind: "text", text: "[x](https://a b)" },
]);

// ⑤ 중첩 시 선점(먼저 열린 토큰이 이긴다) — 내부 마커는 평문
check("⑤ 굵게 안 * 평문", parseInlineMd1("**a*b**"), [{ kind: "bold", text: "a*b" }]);
check("⑤ 이탤릭 선점 후 진행", parseInlineMd1("*a**b*"), [
  { kind: "italic", text: "a" },
  { kind: "italic", text: "b" },
]);

// ⑥ 블록 + 인라인 조합, 연속 항목 묶기
check(
  "⑥ 목록·인용·번호",
  parseMd1("- **a**\n- b\n> q1\n> q2\n3. c\n4. d\n일반"),
  [
    { kind: "bulletList", items: [[{ kind: "bold", text: "a" }], [{ kind: "text", text: "b" }]] },
    { kind: "quote", lines: [[{ kind: "text", text: "q1" }], [{ kind: "text", text: "q2" }]] },
    { kind: "orderedList", start: 3, items: [[{ kind: "text", text: "c" }], [{ kind: "text", text: "d" }]] },
    { kind: "paragraph", children: [{ kind: "text", text: "일반" }] },
  ]
);
check("⑥ 접두 불일치는 문단(-x, >x)", parseMd1("-x\n>x"), [
  { kind: "paragraph", children: [{ kind: "text", text: "-x" }] },
  { kind: "paragraph", children: [{ kind: "text", text: ">x" }] },
]);

// ⑦ stripMd1 — 토큰 제거·라벨 보존·공백 정리
check("⑦ strip 발췌", stripMd1("**중요** 회의\n\n\n\n- [자료](https://a.b) 참고"), "중요 회의\n\n자료 참고");

// ⑧ 최대 길이 경계 — 파서가 긴 입력에서도 정상 종료(선형 스캔)
const long = ("**a** " .repeat(2000)).slice(0, MEMO_MAX_BODY);
check("⑧ 10,000자 경계 파싱 완료", parseMd1(long).length >= 1, true);

// ⑨ 평문 경로 분기 — contentFormat 부재면 파서를 태우지 않는다(호출부 규약).
//    여기서는 스탬프 관문을 검증: 서식 없는 본문은 md1 승격 대상이 아니다.
check("⑨ 서식 없음 판정", bodyHasMd1Formatting("그냥 * 별표 문장"), false);
check("⑨ 서식 있음 판정", bodyHasMd1Formatting("*기울임* 문장"), true);
check("⑨ 블록만 있어도 서식", bodyHasMd1Formatting("- 목록"), true);

// ⑪ 인라인 이미지 — 첨부 참조만 성립, 외부 URL 불성립 (spec §13)
check("⑪ 첨부 참조 성립", parseInlineMd1("앞 ![주간표](att:abc-123_XY) 뒤"), [
  { kind: "text", text: "앞 " },
  { kind: "image", label: "주간표", attachmentId: "abc-123_XY" },
  { kind: "text", text: " 뒤" },
]);
check("⑪ 빈 라벨 허용", parseInlineMd1("![](att:id1)"), [
  { kind: "image", label: "", attachmentId: "id1" },
]);
// 외부 URL은 이미지 노드가 절대 생기지 않는다(외부 이미지 요청 0) — '!'+일반 링크로 강등
check("⑪ 외부 URL 불성립 — 이미지 아님, '!'+링크 강등", parseInlineMd1("![x](https://evil.com/a.png)"), [
  { kind: "text", text: "!" },
  { kind: "link", label: "x", href: "https://evil.com/a.png" },
]);
check("⑪ 이상 id 불성립", parseInlineMd1("![x](att:a/b)"), [
  { kind: "text", text: "![x](att:a/b)" },
]);
check("⑪ strip: 라벨/[이미지]", stripMd1("![주간표](att:id1) ![](att:id2)"), "주간표 [이미지]");
check("⑪ collect: 참조 id 수집·중복 제거", collectMd1AttachmentIds("![](att:a)\n- ![x](att:b)\n> ![](att:a)"), ["a", "b"]);
check("⑪ 이미지도 서식으로 판정", bodyHasMd1Formatting("![](att:a)"), true);

// ⑩ 서버 화이트리스트 — contentFormat은 "md1"만, 그 외 400 (logic.ts)
const base = { title: "t", body: "b" };
check("⑩ md1 수용", (validateMemoContent({ ...base, contentFormat: "md1" }) as any).content.contentFormat, "md1");
check("⑩ 부재 = 평문(필드 없음)", "contentFormat" in (validateMemoContent(base) as any).content, false);
check("⑩ 이상값 거부", (validateMemoContent({ ...base, contentFormat: "html" }) as any).ok, false);

console.log(fails ? `\n❌ 실패 ${fails}건` : "\n✅ 전판 통과");
process.exit(fails ? 1 : 0);
