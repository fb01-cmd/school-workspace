"use client";

import React, { useState, useRef, useEffect } from "react";

interface HelpTipProps {
  title?: string;
  children: React.ReactNode;
  variant?: "dark" | "light" | "indigo";
  className?: string;
}

export default function HelpTip({
  title = "도움말 및 상세 안내",
  children,
  variant = "dark",
  className = "",
}: HelpTipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const buttonStyle =
    variant === "dark"
      ? "bg-white/20 hover:bg-white/30 text-white border-white/30"
      : variant === "indigo"
      ? "bg-indigo-100 hover:bg-indigo-200 text-indigo-700 border-indigo-200"
      : "bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300";

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={title}
        title={title}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold transition-all shadow-xs border cursor-pointer ${buttonStyle}`}
      >
        ?
      </button>

      {isOpen && (
        <div className="absolute right-0 top-7 w-80 sm:w-96 p-4 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
          <div className="flex justify-between items-center pb-2 mb-2 border-b border-gray-100 font-bold text-gray-900">
            <span className="flex items-center gap-1.5 text-indigo-600">
              <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px]">
                ?
              </span>
              {title}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600 text-sm font-bold px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="space-y-2 text-gray-600 leading-relaxed max-h-80 overflow-y-auto">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
