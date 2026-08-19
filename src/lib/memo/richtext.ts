/**
 * 쪽지 서식 md1 — 파서·평문 강등의 단일 소재지 (memo_richtext_spec §3~§5)
 *
 * 원칙: HTML은 어디에도 없다. parseMd1은 순수 데이터(노드 트리)만 만들고,
 * 렌더 컴포넌트는 이 노드를 React children으로만 흘린다 — 주입 표면 0 (spec §4).
 * React 무의존 순수 모듈이라 셀프테스트(scripts/verify_memo_richtext.ts) 가능.
 *
 * 하위호환의 핵심: 이 파서는 contentFormat === "md1" 문서에만 적용한다.
 * 필드 부재(평문) 쪽지를 여기에 넣어 재해석하지 않는다 (spec §2 — 호출부 책임).
 */

// ── 노드 타입 (spec §4) ──────────────────────────────────────

export type RichInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "underline"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "link"; label: string; href: string }
  // 인라인 이미지 = 이 쪽지 첨부의 참조만 (spec §13 — 외부 URL은 문법 불성립)
  | { kind: "image"; label: string; attachmentId: string };

export type RichBlock =
  | { kind: "paragraph"; children: RichInline[] } // 빈 줄 = children []
  | { kind: "bulletList"; items: RichInline[][] }
  | { kind: "orderedList"; start: number; items: RichInline[][] }
  | { kind: "quote"; lines: RichInline[][] };

/** 본문 형식 화이트리스트 — 서버 검증·클라 분기 공용 (spec §2) */
export const MEMO_CONTENT_FORMAT_MD1 = "md1" as const;

// ── 이스케이프 (spec §3) ─────────────────────────────────────

const ESCAPABLE = new Set(["*", "_", "~", "[", "\\"]);

/** 리터럴 텍스트를 md1 안전 문자열로 — 토큰 문자 앞에 `\` (직렬화기·편집기 공용, spec §7) */
export function escapeMd1Literal(s: string): string {
  return s.replace(/[\\*_~[]/g, (c) => "\\" + c);
}

/** `\*` 류를 리터럴로 되돌린다. 이스케이프 대상이 아닌 문자 앞의 `\`는 그대로 남긴다. */
function unescapeMd1(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
      out += s[i + 1];
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

/** from부터 marker의 다음 비이스케이프 출현 위치. 없으면 -1. */
function findUnescaped(line: string, marker: string, from: number): number {
  let p = from;
  while (p <= line.length - marker.length) {
    if (line[p] === "\\") {
      p += 2;
      continue;
    }
    if (line.startsWith(marker, p)) return p;
    p += 1;
  }
  return -1;
}

// ── 인라인 파서 (spec §3 — 중첩 미지원, 먼저 열린 토큰이 이긴다) ──

const INLINE_MARKERS: ReadonlyArray<{
  marker: string;
  kind: "bold" | "underline" | "strike" | "italic";
}> = [
  // 2문자 마커를 1문자보다 먼저 검사한다 (`**`가 `*` 둘로 쪼개지지 않게)
  { marker: "**", kind: "bold" },
  { marker: "__", kind: "underline" },
  { marker: "~~", kind: "strike" },
  { marker: "*", kind: "italic" },
];

const LINK_MAX_URL = 2048; // memo_spec §1 links 기존 상한 승계
/** Drive 파일 id 형태 — 인라인 이미지 참조 검증 (파서·직렬화기 공용, spec §13) */
export const ATTACHMENT_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

export function parseInlineMd1(line: string): RichInline[] {
  const nodes: RichInline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    // 이스케이프 — 대상 문자면 리터럴 수용, 아니면 `\` 자체가 리터럴
    if (ch === "\\") {
      if (i + 1 < line.length && ESCAPABLE.has(line[i + 1])) {
        buf += line[i + 1];
        i += 2;
      } else {
        buf += "\\";
        i += 1;
      }
      continue;
    }

    // 서식 마커 — 닫히고 내용이 비지 않아야 토큰, 아니면 여는 표시 그대로 평문 (spec §3)
    let matched = false;
    for (const { marker, kind } of INLINE_MARKERS) {
      if (!line.startsWith(marker, i)) continue;
      const close = findUnescaped(line, marker, i + marker.length);
      const content = close >= 0 ? line.slice(i + marker.length, close) : "";
      if (close >= 0 && content.length > 0) {
        flush();
        nodes.push({ kind, text: unescapeMd1(content) });
        i = close + marker.length;
      } else {
        buf += marker;
        i += marker.length;
      }
      matched = true;
      break;
    }
    if (matched) continue;

    // 인라인 이미지 ![라벨](att:첨부ID) — 이 쪽지 첨부의 참조만 성립 (spec §13)
    if (ch === "!" && line[i + 1] === "[") {
      const labelClose = findUnescaped(line, "]", i + 2);
      if (labelClose >= i + 2 && line[labelClose + 1] === "(") {
        const refClose = line.indexOf(")", labelClose + 2);
        const ref = refClose >= 0 ? line.slice(labelClose + 2, refClose) : "";
        const m = /^att:(.+)$/.exec(ref);
        if (refClose >= 0 && m && ATTACHMENT_ID_RE.test(m[1])) {
          flush();
          nodes.push({
            kind: "image",
            label: unescapeMd1(line.slice(i + 2, labelClose)),
            attachmentId: m[1],
          });
          i = refClose + 1;
          continue;
        }
      }
      buf += "!";
      i += 1;
      continue;
    }

    // 링크 [라벨](https://…) — https만, 공백·초과 길이는 불성립 → 평문 (spec §3)
    if (ch === "[") {
      const labelClose = findUnescaped(line, "]", i + 1);
      if (labelClose > i + 1 && line[labelClose + 1] === "(") {
        const urlClose = line.indexOf(")", labelClose + 2);
        const url = urlClose >= 0 ? line.slice(labelClose + 2, urlClose) : "";
        if (
          urlClose >= 0 &&
          url.startsWith("https://") &&
          url.length > "https://".length &&
          url.length <= LINK_MAX_URL &&
          !/\s/.test(url)
        ) {
          flush();
          nodes.push({ kind: "link", label: unescapeMd1(line.slice(i + 1, labelClose)), href: url });
          i = urlClose + 1;
          continue;
        }
      }
      buf += "[";
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
  return nodes;
}

// ── 블록 파서 (spec §3 — 연속 항목은 목록/인용 하나로 묶는다) ──

const BULLET_RE = /^- (.*)$/;
const ORDERED_RE = /^(\d+)\. (.*)$/;
const QUOTE_RE = /^> (.*)$/;

export function parseMd1(body: string): RichBlock[] {
  const lines = body.split("\n");
  const blocks: RichBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (BULLET_RE.test(line)) {
      const items: RichInline[][] = [];
      while (i < lines.length) {
        const m = BULLET_RE.exec(lines[i]);
        if (!m) break;
        items.push(parseInlineMd1(m[1]));
        i++;
      }
      blocks.push({ kind: "bulletList", items });
      continue;
    }

    const om = ORDERED_RE.exec(line);
    if (om) {
      const start = parseInt(om[1], 10);
      const items: RichInline[][] = [];
      while (i < lines.length) {
        const m = ORDERED_RE.exec(lines[i]);
        if (!m) break;
        items.push(parseInlineMd1(m[2]));
        i++;
      }
      blocks.push({ kind: "orderedList", start, items });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoteLines: RichInline[][] = [];
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]);
        if (!m) break;
        quoteLines.push(parseInlineMd1(m[1]));
        i++;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    blocks.push({ kind: "paragraph", children: parseInlineMd1(line) });
    i++;
  }
  return blocks;
}

// ── 평문 강등 (spec §5) — 목록 발췌·향후 알림 강등의 공용 원본 ──

function inlineText(nodes: RichInline[]): string {
  return nodes
    .map((n) => {
      if (n.kind === "link") return n.label;
      if (n.kind === "image") return n.label || "[이미지]";
      return n.text;
    })
    .join("");
}

/** 본문이 참조하는 첨부 id 목록 — 상세 그리드 중복 숨김·작성기 배선용 (spec §13) */
export function collectMd1AttachmentIds(body: string): string[] {
  const ids = new Set<string>();
  for (const block of parseMd1(body)) {
    const inlines: RichInline[][] =
      block.kind === "paragraph"
        ? [block.children]
        : block.kind === "quote"
          ? block.lines
          : block.items;
    for (const line of inlines) {
      for (const n of line) if (n.kind === "image") ids.add(n.attachmentId);
    }
  }
  return Array.from(ids);
}

export function stripMd1(body: string): string {
  const lines: string[] = [];
  for (const block of parseMd1(body)) {
    switch (block.kind) {
      case "paragraph":
        lines.push(inlineText(block.children));
        break;
      case "bulletList":
        for (const item of block.items) lines.push(inlineText(item));
        break;
      case "orderedList":
        for (const item of block.items) lines.push(inlineText(item));
        break;
      case "quote":
        for (const l of block.lines) lines.push(inlineText(l));
        break;
    }
  }
  // 공백 정리 — 연속 빈 줄은 하나로, 양끝은 잘라낸다
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 본문에 서식이 실제로 있는가 — 편집기의 contentFormat 스탬프 판단용 (spec §7:
 * 토큰이 실제로 없으면 평문으로 보낸다). 서식 없는 쪽지를 md1로 승격하지 않는 관문.
 */
export function bodyHasMd1Formatting(body: string): boolean {
  return parseMd1(body).some(
    (b) => b.kind !== "paragraph" || b.children.some((n) => n.kind !== "text")
  );
}

// ── bare URL 자동 링크 (spec §10 v1.1 승격 — 2026-08-19 실기기 피드백 6번) ──
//
// 붙여넣은 https 주소를 링크 노드로 승격한다. 렌더 직전의 후처리라 parseMd1의
// 결과(저장 형식·stripMd1 강등·bodyHasMd1Formatting 스탬프 판단)는 바꾸지 않는다 —
// 평문에 URL이 있다고 md1로 승격되는 부작용을 여기서 차단한다.
// 안전 규칙은 명시 링크와 동일: https만, 공백 불가, 2048자 이하.

const AUTOLINK_RE = /https:\/\/[^\s]+/g;
/** URL 꼬리에 붙은 문장부호(마침표·쉼표·닫는 괄호류)는 링크에서 제외한다 */
const AUTOLINK_TRAILING_RE = /[.,;:!?"'）」』>\]})]+$/;

/** 리터럴 텍스트 하나를 text·link 노드 열로 분해 — 평문 렌더 경로의 최소 단위 */
export function autolinkText(text: string): RichInline[] {
  const nodes: RichInline[] = [];
  let last = 0;
  for (const m of text.matchAll(AUTOLINK_RE)) {
    let url = m[0].replace(AUTOLINK_TRAILING_RE, "");
    if (url.length <= "https://".length || url.length > LINK_MAX_URL) continue;
    if (m.index > last) nodes.push({ kind: "text", text: text.slice(last, m.index) });
    nodes.push({ kind: "link", label: url, href: url });
    last = m.index + url.length;
  }
  if (last < text.length) nodes.push({ kind: "text", text: text.slice(last) });
  if (nodes.length === 0 && text.length === 0) return [];
  return nodes.length ? nodes : [{ kind: "text", text }];
}

function autolinkInlines(nodes: RichInline[]): RichInline[] {
  return nodes.flatMap((n) => (n.kind === "text" ? autolinkText(n.text) : [n]));
}

/** md1 렌더 경로용 — parseMd1 결과의 text 노드만 링크로 승격 (명시 링크·이미지는 그대로) */
export function autolinkBlocks(blocks: RichBlock[]): RichBlock[] {
  return blocks.map((b) => {
    switch (b.kind) {
      case "paragraph":
        return { ...b, children: autolinkInlines(b.children) };
      case "bulletList":
        return { ...b, items: b.items.map(autolinkInlines) };
      case "orderedList":
        return { ...b, items: b.items.map(autolinkInlines) };
      case "quote":
        return { ...b, lines: b.lines.map(autolinkInlines) };
    }
  });
}

/**
 * 평문 렌더 경로용 — md1 토큰을 해석하지 않고 줄 = 문단으로만 나눈 뒤 URL만 링크로.
 * contentFormat 부재 문서를 재해석하지 않는다는 하위호환 원칙(spec §2)은 그대로다 —
 * 서식 해석이 아니라 렌더 표현(클릭 가능)만 바꾼다.
 */
export function parsePlainAutolink(body: string): RichBlock[] {
  return body.split("\n").map((line) => ({ kind: "paragraph" as const, children: autolinkText(line) }));
}
