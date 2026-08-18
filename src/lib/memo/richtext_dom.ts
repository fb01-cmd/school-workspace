/**
 * 즉시 반영(WYSIWYG) 편집기 → md1 직렬화기 (memo_richtext_spec §7 개정 2026-08-18)
 *
 * 입력창(contenteditable)의 DOM을 걸어 md1 문자열을 만든다 — 저장·발송·렌더는
 * 여전히 md1 단일 원본이고, 이 파일이 그 변환의 단일 소재지다.
 *
 * 브라우저 DOM에 직접 의존하지 않는다: 최소 인터페이스(Md1DomNode)만 요구하므로
 * 셀프테스트(scripts/verify_memo_richtext_dom.ts)가 목 객체로 검증한다.
 *
 * 규칙 (spec §7):
 * - 텍스트 노드의 토큰 문자는 전부 이스케이프(escapeMd1Literal) — 사용자가 친
 *   리터럴 `*`가 서식으로 둔갑하지 않는다 (즉시 반영 방식에선 원문이 안 보이므로 의무).
 * - 서식 중첩은 md1이 미지원 — 가장 바깥 표시만 살린다(안쪽 무시, 결정론).
 * - 링크는 https만 성립, 그 외는 라벨 평문 강등 (파서와 같은 기준).
 * - 목록 번호는 DOM 순서로 1부터 다시 매긴다 (원본 start 속성이 있으면 그 값부터).
 */

import { escapeMd1Literal } from "./richtext";

/** 브라우저 Node와 셀프테스트 목 객체가 함께 만족하는 최소 모양 */
export interface Md1DomNode {
  nodeType: number; // 1 = element, 3 = text
  nodeName: string; // 요소는 대문자 태그명
  textContent?: string | null;
  childNodes: ArrayLike<Md1DomNode>;
  getAttribute?: (name: string) => string | null;
}

const ELEMENT = 1;
const TEXT = 3;

const LINK_MAX_URL = 2048;

function children(node: Md1DomNode): Md1DomNode[] {
  return Array.from(node.childNodes as ArrayLike<Md1DomNode>);
}

/** 후손 전체를 서식 무시하고 이스케이프된 평문으로 (중첩 마크 안쪽 무시·링크 라벨 추출용) */
function plainText(node: Md1DomNode): string {
  if (node.nodeType === TEXT) return escapeMd1Literal(node.textContent || "");
  if (node.nodeType !== ELEMENT) return "";
  if (node.nodeName === "BR") return "\n";
  return children(node).map(plainText).join("");
}

function isHttpsUrl(url: string | null): url is string {
  return (
    !!url &&
    url.startsWith("https://") &&
    url.length > "https://".length &&
    url.length <= LINK_MAX_URL &&
    !/\s/.test(url)
  );
}

/** 인라인(phrasing) 직렬화 — 블록 요소를 만나면 호출부(블록 워커)가 처리했어야 한다 */
function serializeInline(node: Md1DomNode): string {
  if (node.nodeType === TEXT) return escapeMd1Literal(node.textContent || "");
  if (node.nodeType !== ELEMENT) return "";

  const name = node.nodeName;
  switch (name) {
    case "BR":
      return "\n";
    case "STRONG":
    case "B": {
      const inner = plainText(node); // 가장 바깥 마크만 — 안쪽 마크 무시 (md1 중첩 미지원)
      return inner ? `**${inner}**` : "";
    }
    case "EM":
    case "I": {
      const inner = plainText(node);
      return inner ? `*${inner}*` : "";
    }
    case "U": {
      const inner = plainText(node);
      return inner ? `__${inner}__` : "";
    }
    case "S":
    case "STRIKE":
    case "DEL": {
      const inner = plainText(node);
      return inner ? `~~${inner}~~` : "";
    }
    case "A": {
      const href = node.getAttribute ? node.getAttribute("href") : null;
      const label = plainText(node);
      if (isHttpsUrl(href) && label) return `[${label}](${href})`;
      return label; // https 아니면 라벨 평문 강등 (파서 기준과 동일)
    }
    default:
      // SPAN·FONT 등 알 수 없는 요소는 투명 통과
      return children(node).map(serializeInline).join("");
  }
}

const BLOCK_TAGS = new Set(["DIV", "P", "UL", "OL", "BLOCKQUOTE", "LI", "H1", "H2", "H3"]);

function isBlock(node: Md1DomNode): boolean {
  return node.nodeType === ELEMENT && BLOCK_TAGS.has(node.nodeName);
}

/** 한 블록 요소의 인라인 내용 — 줄바꿈(BR)은 공백으로 눌러 목록 접두가 깨지지 않게 */
function inlineOfListItem(node: Md1DomNode): string {
  return children(node)
    .map(serializeInline)
    .join("")
    .replace(/\n+/g, " ")
    .trim();
}

function pushBlock(node: Md1DomNode, out: string[]): void {
  const name = node.nodeName;

  if (name === "UL") {
    for (const li of children(node)) {
      if (li.nodeType === ELEMENT && li.nodeName === "LI") out.push(`- ${inlineOfListItem(li)}`);
    }
    return;
  }

  if (name === "OL") {
    const startAttr = node.getAttribute ? node.getAttribute("start") : null;
    const start = startAttr && /^\d+$/.test(startAttr) ? parseInt(startAttr, 10) : 1;
    let n = start;
    for (const li of children(node)) {
      if (li.nodeType === ELEMENT && li.nodeName === "LI") {
        out.push(`${n}. ${inlineOfListItem(li)}`);
        n++;
      }
    }
    return;
  }

  if (name === "BLOCKQUOTE") {
    const innerLines: string[] = [];
    walkBlocks(node, innerLines);
    for (const line of innerLines) out.push(`> ${line}`);
    return;
  }

  // DIV·P·H* — 한 줄(내부 BR은 줄 분리)
  const text = children(node).map(serializeInline).join("");
  for (const line of text.split("\n")) out.push(line);
}

/** 컨테이너의 자식들을 순회하며 줄 목록을 만든다 — 루트·blockquote 공용 */
function walkBlocks(container: Md1DomNode, out: string[]): void {
  let inlineBuf = "";
  const flush = () => {
    if (inlineBuf !== "") {
      for (const line of inlineBuf.split("\n")) out.push(line);
      inlineBuf = "";
    }
  };
  for (const child of children(container)) {
    if (isBlock(child)) {
      flush();
      pushBlock(child, out);
    } else {
      inlineBuf += serializeInline(child);
    }
  }
  flush();
}

/**
 * contenteditable 루트 → md1 문자열.
 * 결과는 그대로 memos.body가 되고, 발송 관문(bodyHasMd1Formatting)·파서(parseMd1)와 왕복 정합.
 */
export function serializeDomToMd1(root: Md1DomNode): string {
  const lines: string[] = [];
  walkBlocks(root, lines);
  // 편집기 잔여물 정리 — 끝쪽 빈 줄만 제거(중간 빈 줄은 의도된 문단 간격)
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}
