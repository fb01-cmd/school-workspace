"use client";
// 쪽지 서식 편집기 툴바 & 이모지 피커 — docs/memo_richtext_spec.md §7 (즉시 반영 개정판)
// contenteditable 브라우저 편집 명령(execCommand) 연동, 번들 내장 상수 이모지(외부 요청 0).
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
  editorRef: React.RefObject<HTMLDivElement | null>;
  onContentChange?: () => void;
}

export default function MemoEditorToolbar({
  editorRef,
  onContentChange,
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

  const exec = useCallback(
    (command: string, value: string | undefined = undefined) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      document.execCommand(command, false, value);
      onContentChange?.();
    },
    [editorRef, onContentChange]
  );

  const handleToggleQuote = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const currentBlock = document.queryCommandValue("formatBlock")?.toLowerCase();
    if (currentBlock === "blockquote") {
      document.execCommand("formatBlock", false, "p");
    } else {
      document.execCommand("formatBlock", false, "blockquote");
    }
    onContentChange?.();
  }, [editorRef, onContentChange]);

  const handleInsertLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    const sel = window.getSelection();
    const selectedText = sel ? sel.toString().trim() : "";

    let url = window.prompt("연결할 웹 주소를 입력하세요 (https://)", "https://");
    if (!url) return;
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    if (selectedText) {
      document.execCommand("createLink", false, url);
    } else {
      const label = window.prompt("화면에 표시할 링크 이름을 입력하세요", "링크") || url;
      const anchor = `<a href="${url}">${label}</a>`;
      document.execCommand("insertHTML", false, anchor);
    }
    onContentChange?.();
  }, [editorRef, onContentChange]);

  const handleSelectEmoji = useCallback(
    (emoji: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      document.execCommand("insertText", false, emoji);
      setShowEmojiPicker(false);
      onContentChange?.();
    },
    [editorRef, onContentChange]
  );

  return (
    <div className="relative flex items-center justify-between border border-slate-200 border-b-0 bg-slate-50/90 rounded-t-lg px-2 py-1.5 gap-1 flex-wrap text-slate-700 select-none">
      {/* 서식 버튼 8종 + 이모지 피커 */}
      <div className="flex items-center gap-0.5 flex-wrap">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("bold")}
          title="굵게 (Ctrl+B)"
          className="px-2 py-1 text-xs font-bold hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="굵게"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("italic")}
          title="기울임 (Ctrl+I)"
          className="px-2 py-1 text-xs italic font-serif hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="기울임"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("underline")}
          title="밑줄 (Ctrl+U)"
          className="px-2 py-1 text-xs underline underline-offset-2 hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="밑줄"
        >
          U
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("strikeThrough")}
          title="취소선"
          className="px-2 py-1 text-xs line-through hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center min-w-[26px]"
          aria-label="취소선"
        >
          S
        </button>

        <span className="w-px h-4 bg-slate-300 mx-1" aria-hidden="true" />

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("insertUnorderedList")}
          title="글머리 기호"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center"
          aria-label="글머리 기호"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("insertOrderedList")}
          title="번호 목록"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center text-xs font-semibold"
          aria-label="번호 목록"
        >
          1.
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleToggleQuote}
          title="인용"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center"
          aria-label="인용"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleInsertLink}
          title="링크 삽입"
          className="p-1 hover:bg-slate-200/80 rounded transition-colors cursor-pointer flex items-center justify-center"
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
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          title="이모지 선택"
          className={`px-1.5 py-0.5 text-sm rounded transition-colors cursor-pointer flex items-center justify-center ${
            showEmojiPicker ? "bg-indigo-100 ring-1 ring-indigo-400" : "hover:bg-slate-200/80"
          }`}
          aria-label="이모지 선택"
        >
          😀
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
                onMouseDown={(e) => e.preventDefault()}
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
                onMouseDown={(e) => e.preventDefault()}
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
