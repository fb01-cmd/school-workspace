"use client";
// 쪽지 서식 렌더 컴포넌트 — docs/memo_richtext_spec.md §4
// parseMd1 노드 트리를 React 요소로 매핑. dangerouslySetInnerHTML 사용 금지 (주입 표면 0).

import React from "react";
import { parseMd1, type RichBlock, type RichInline } from "@/lib/memo/richtext";

interface MemoRichBodyProps {
  body: string;
  className?: string;
}

function renderInline(node: RichInline, key: number | string): React.ReactNode {
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
    default:
      return null;
  }
}

function renderInlines(inlines: RichInline[]): React.ReactNode {
  return inlines.map((node, i) => renderInline(node, i));
}

function renderBlock(block: RichBlock, key: number | string): React.ReactNode {
  switch (block.kind) {
    case "paragraph":
      if (block.children.length === 0) {
        return <div key={key} className="h-3" aria-hidden="true" />;
      }
      return (
        <p key={key} className="leading-relaxed whitespace-pre-wrap">
          {renderInlines(block.children)}
        </p>
      );
    case "bulletList":
      return (
        <ul key={key} className="list-disc list-outside pl-5 space-y-1 my-1.5 leading-relaxed">
          {block.items.map((item, idx) => (
            <li key={idx} className="whitespace-pre-wrap">
              {renderInlines(item)}
            </li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} start={block.start} className="list-decimal list-outside pl-5 space-y-1 my-1.5 leading-relaxed">
          {block.items.map((item, idx) => (
            <li key={idx} className="whitespace-pre-wrap">
              {renderInlines(item)}
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
              {renderInlines(line)}
            </p>
          ))}
        </blockquote>
      );
    default:
      return null;
  }
}

export default function MemoRichBody({ body, className }: MemoRichBodyProps) {
  const blocks = parseMd1(body);

  return (
    <div
      className={
        className ||
        "space-y-2 text-[15px] text-slate-800 dark:text-slate-200 font-sans leading-relaxed break-words"
      }
    >
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}
