"use client";
// 쪽지 서식 편집기 툴바 & 이모지 피커 — docs/memo_richtext_spec.md §7
// 번들 내장 상수 이모지 (외부 요청 0), 8종 서식 버튼, 미리보기 토글.
// 개발 용어(마크다운 등) 화면 노출 금지.

import React, { useState, useRef, useEffect, useCallback } from "react";

const EMOJI_CATEGORIES = [
  {
    name: "자주 사용",
    emojis: ["👍", "👏", "🙌", "🤝", "🙏", "✅", "🆗", "🙆", "🙇", "💡", "📌", "📢", "⭐", "✨", "❤️"],
  },
  {
    name: "표정",
    emojis: ["😊", "😀", "😃", "😆", "😌", "🤔", "🧐", "😅", "😭", "🥹", "🥳", "😎", "🫡", "👀", "😉"],
  },
  {
    name: "학교/업무",
    emojis: ["📚", "📖", "✏️", "📝", "📋", "🗓️", "⏰", "🏫", "🎓", "🖥️", "💻", "📂", "✉️", "📞", "🔔"],
  },
  {
    name: "기호/활동",
    emojis: ["☕", "🍱", "🥪", "🏃", "🚌", "🚗", "💯", "❗", "❓", "🎁", "🌸", "☀️", "⛅", "🌈", "🎉"],
  },
];

interface MemoEditorToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  body: string;
  setBody: React.Dispatch<React.SetStateAction<string>>;
  mode: "edit" | "preview";
  setMode: (mode: "edit" | "preview") => void;
}

export default function MemoEditorToolbar({
  textareaRef,
  setBody,
  mode,
  setMode,
}: MemoEditorToolbarProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // 밖 클릭 시 이모지 피커 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showEmojiPicker]);

  const wrapSelection = useCallback(
    (prefix: string, suffix: string, defaultText: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;
      const selected = val.substring(start, end);

      const replacement = selected ? `${prefix}${selected}${suffix}` : `${prefix}${defaultText}${suffix}`;
      const next = val.substring(0, start) + replacement + val.substring(end);
      setBody(next);

      setTimeout(() => {
        el.focus();
        if (selected) {
          el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
        } else {
          el.setSelectionRange(start + prefix.length, start + prefix.length + defaultText.length);
        }
      }, 0);
    },
    [textareaRef, setBody]
  );

  const prependLines = useCallback(
    (prefixFn: (index: number) => string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;

      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = val.indexOf("\n", end);
      if (lineEnd === -1) lineEnd = val.length;

      const chunk = val.substring(lineStart, lineEnd);
      const lines = chunk.split("\n");
      const modifiedLines = lines.map((line, idx) => `${prefixFn(idx + 1)}${line}`);
      const modifiedChunk = modifiedLines.join("\n");

      const next = val.substring(0, lineStart) + modifiedChunk + val.substring(lineEnd);
      setBody(next);

      setTimeout(() => {
        el.focus();
        el.setSelectionRange(lineStart, lineStart + modifiedChunk.length);
      }, 0);
    },
    [textareaRef, setBody]
  );

  const insertLink = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const selected = val.substring(start, end);

    if (selected) {
      if (selected.startsWith("https://")) {
        const replacement = `[링크](${selected})`;
        const next = val.substring(0, start) + replacement + val.substring(end);
        setBody(next);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + 1, start + 3); // "링크" 선택
        }, 0);
      } else {
        const replacement = `[${selected}](https://)`;
        const next = val.substring(0, start) + replacement + val.substring(end);
        setBody(next);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(
            start + selected.length + 3,
            start + selected.length + 11
          ); // "https://" 선택
        }, 0);
      }
    } else {
      const replacement = `[링크 이름](https://)`;
      const next = val.substring(0, start) + replacement + val.substring(end);
      setBody(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + 1, start + 6); // "링크 이름" 선택
      }, 0);
    }
  }, [textareaRef, setBody]);

  const handleSelectEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      if (!el) {
        setBody((prev) => prev + emoji);
        setShowEmojiPicker(false);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;
      const next = val.substring(0, start) + emoji + val.substring(end);
      setBody(next);
      setShowEmojiPicker(false);

      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    },
    [textareaRef, setBody]
  );

  return (
    <div className="relative flex items-center justify-between border border-slate-200 border-b-0 bg-slate-50/90 rounded-t-lg px-2 py-1.5 gap-1 flex-wrap text-slate-700 select-none">
      {/* 서식 버튼 8종 + 이모지 피커 */}
      <div className="flex items-center gap-0.5 flex-wrap">
        <button
          type="button"
          onClick={() => wrapSelection("**", "**", "굵은 텍스트")}
          disabled={mode === "preview"}
          title="굵게 (Ctrl+B)"
          className="px-2 py-1 text-xs font-bold hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="굵게"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("*", "*", "기울임 텍스트")}
          disabled={mode === "preview"}
          title="기울임 (Ctrl+I)"
          className="px-2 py-1 text-xs italic font-serif hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="기울임"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("__", "__", "밑줄 텍스트")}
          disabled={mode === "preview"}
          title="밑줄 (Ctrl+U)"
          className="px-2 py-1 text-xs underline underline-offset-2 hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="밑줄"
        >
          U
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("~~", "~~", "취소선 텍스트")}
          disabled={mode === "preview"}
          title="취소선"
          className="px-2 py-1 text-xs line-through hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="취소선"
        >
          S
        </button>

        <span className="w-px h-4 bg-slate-300 mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => prependLines(() => "- ")}
          disabled={mode === "preview"}
          title="글머리 기호"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center"
          aria-label="글머리 기호"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => prependLines((idx) => `${idx}. `)}
          disabled={mode === "preview"}
          title="번호 목록"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center text-xs font-semibold"
          aria-label="번호 목록"
        >
          1.
        </button>
        <button
          type="button"
          onClick={() => prependLines(() => "> ")}
          disabled={mode === "preview"}
          title="인용"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center"
          aria-label="인용"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={insertLink}
          disabled={mode === "preview"}
          title="링크 삽입"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center"
          aria-label="링크 삽입"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>

        <span className="w-px h-4 bg-slate-300 mx-1" aria-hidden="true" />

        {/* 이모지 피커 버튼 */}
        <button
          ref={emojiButtonRef}
          type="button"
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          disabled={mode === "preview"}
          title="이모지 선택"
          className={`px-1.5 py-0.5 text-sm rounded transition-colors disabled:opacity-40 cursor-pointer flex items-center justify-center ${
            showEmojiPicker ? "bg-indigo-100 ring-1 ring-indigo-400" : "hover:bg-slate-200/80"
          }`}
          aria-label="이모지 선택"
        >
          😀
        </button>
      </div>

      {/* 미리보기 / 작성 토글 */}
      <div className="flex items-center bg-slate-200/80 p-0.5 rounded-md">
        <button
          type="button"
          onClick={() => setMode("edit")}
          className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors cursor-pointer ${
            mode === "edit"
              ? "bg-white text-indigo-700 shadow-2xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          작성
        </button>
        <button
          type="button"
          onClick={() => setMode("preview")}
          className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors cursor-pointer ${
            mode === "preview"
              ? "bg-white text-indigo-700 shadow-2xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          미리보기
        </button>
      </div>

      {/* 이모지 피커 팝오버 */}
      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className="absolute left-2 top-full mt-1 z-30 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 animate-in fade-in zoom-in-95 duration-100 text-slate-800"
        >
          {/* 카테고리 탭 */}
          <div className="flex items-center border-b border-slate-100 pb-1.5 mb-2 gap-1 overflow-x-auto">
            {EMOJI_CATEGORIES.map((cat, idx) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => setActiveCategory(idx)}
                className={`px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  activeCategory === idx
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* 이모지 그리드 */}
          <div className="grid grid-cols-6 gap-1.5 max-h-56 overflow-y-auto p-1">
            {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleSelectEmoji(emoji)}
                className="w-9 h-9 text-lg flex items-center justify-center hover:bg-indigo-50 hover:scale-110 active:scale-95 rounded-lg transition-transform cursor-pointer"
                aria-label={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* 단축키 안내 풋터 */}
          <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] text-slate-400 text-center">
            단축키: Windows <kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200 font-mono">⊞</kbd> + <kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200 font-mono">.</kbd> / Mac <kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200 font-mono">⌃</kbd>+<kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200 font-mono">⌘</kbd>+<kbd className="px-1 py-0.5 bg-slate-100 rounded text-slate-600 border border-slate-200 font-mono">Space</kbd>
          </div>
        </div>
      )}
    </div>
  );
}
