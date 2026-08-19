"use client";
// 쪽지 서식 렌더 컴포넌트 — docs/memo_richtext_spec.md §4·§13
// parseMd1 노드 트리를 React 요소로 매핑. dangerouslySetInnerHTML 사용 금지 (주입 표면 0).
// 인라인 이미지는 첨부 참조만 — 바이트는 자체 프록시(/api/memo/attachment, 쿠키 인증) 경유.

import React, { useState } from "react";
import {
  parseMd1,
  autolinkBlocks,
  parsePlainAutolink,
  type RichBlock,
  type RichInline,
} from "@/lib/memo/richtext";

interface MemoRichBodyProps {
  body: string;
  className?: string;
  /** 인라인 이미지 프록시 URL용 — 상세 뷰에서 전달. 없으면 이미지는 라벨 평문으로 강등 */
  memoId?: string;
  /** 평문 문서인 경우 true 지정 시 md1 문법을 해석하지 않고 줄바꿈 유지 + https 링크만 자동 연결 */
  isPlain?: boolean;
}

function MemoInlineImage({
  label,
  attachmentId,
  memoId,
}: {
  label: string;
  attachmentId: string;
  memoId?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!memoId || failed) {
    return (
      <span className="inline-block px-2 py-0.5 my-0.5 text-xs rounded bg-slate-100 text-slate-500 border border-slate-200">
        {label || "이미지"}
      </span>
    );
  }
  return (
    <img
      src={`/api/memo/attachment?memoId=${encodeURIComponent(memoId)}&attId=${encodeURIComponent(attachmentId)}`}
      alt={label || "첨부 이미지"}
      loading="lazy"
      onError={() => setFailed(true)}
      className="block max-w-full max-h-[420px] object-contain rounded-lg my-1.5 border border-slate-200 dark:border-slate-700"
    />
  );
}

function renderInline(node: RichInline, key: number | string, memoId?: string): React.ReactNode {
  switch (node.kind) {
    case "text":
      return <React.Fragment key={key}>{node.text}</React.Fragment>;
    case "bold":
      return (
        <strong key={key} className="font-bold">
          {node.text}
        </strong>
      );
    case "italic":
      return (
        <em key={key} className="italic">
          {node.text}
        </em>
      );
    case "underline":
      return (
        <u key={key} className="underline underline-offset-2">
          {node.text}
        </u>
      );
    case "strike":
      return (
        <s key={key} className="line-through text-slate-500 dark:text-slate-400">
          {node.text}
        </s>
      );
    case "link":
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline break-all"
        >
          {node.label}
        </a>
      );
    case "image":
      return (
        <MemoInlineImage key={key} label={node.label} attachmentId={node.attachmentId} memoId={memoId} />
      );
    default:
      return null;
  }
}

function renderInlines(inlines: RichInline[], memoId?: string): React.ReactNode {
  return inlines.map((node, i) => renderInline(node, i, memoId));
}

function renderBlock(block: RichBlock, key: number | string, memoId?: string): React.ReactNode {
  switch (block.kind) {
    case "paragraph":
      if (block.children.length === 0) {
        return <div key={key} className="h-3" aria-hidden="true" />;
      }
      return (
        <p key={key} className="leading-relaxed whitespace-pre-wrap">
          {renderInlines(block.children, memoId)}
        </p>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc list-outside pl-5 space-y-1 my-1.5 leading-relaxed">
          {block.items.map((item, idx) => (
            <li key={idx} className="whitespace-pre-wrap">
              {renderInlines(item, memoId)}
            </li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={block.start} className="list-decimal list-outside pl-5 space-y-1 my-1.5 leading-relaxed">
          {block.items.map((item, idx) => (
            <li key={idx} className="whitespace-pre-wrap">
              {renderInlines(item, memoId)}
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-4 border-indigo-400 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-950/20 py-1.5 px-3 rounded-r-md my-2 text-slate-700 dark:text-slate-300 space-y-1"
        >
          {block.lines.map((line, idx) => (
            <p key={idx} className="leading-relaxed whitespace-pre-wrap">
              {renderInlines(line, memoId)}
            </p>
          ))}
        </blockquote>
      );
    default:
      return null;
  }
}

export default function MemoRichBody({ body, className, memoId, isPlain }: MemoRichBodyProps) {
  const blocks = isPlain ? parsePlainAutolink(body) : autolinkBlocks(parseMd1(body));

  return (
    <div
      className={
        className ||
        "space-y-2 text-[15px] text-slate-800 dark:text-slate-200 font-sans leading-relaxed break-words"
      }
    >
      {blocks.map((block, i) => renderBlock(block, i, memoId))}
    </div>
  );
}
