"use client";

import { useRef } from "react";

export interface Settings {
  domain: string;
  ouMapping?: { students?: Record<string, string> };
}

export async function callAPI(action: string, extra: any, ud: any) {
  const r = await fetch("/api/workspace/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      domain: ud?.domain,
      operatorEmail: ud?.email,
      operatorName: ud?.displayName || ud?.email,
      ...extra,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "API 오류");
  return d;
}

const colorMap: Record<string, string> = {
  indigo: "bg-indigo-700 hover:bg-indigo-800",
  red: "bg-red-600 hover:bg-red-700",
  green: "bg-green-700 hover:bg-green-800",
  amber: "bg-amber-500 hover:bg-amber-600",
  gray: "bg-gray-600 hover:bg-gray-700",
  violet: "bg-violet-700 hover:bg-violet-800",
};

export function Btn({ onClick, disabled, color = "indigo", children }: {
  onClick: () => void;
  disabled?: boolean;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-5 py-2.5 ${colorMap[color] || colorMap.indigo} text-white font-bold rounded-xl disabled:opacity-50 transition-colors shadow text-sm`}
    >
      {children}
    </button>
  );
}

export function ErrBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
      ❌ {msg}
    </div>
  );
}

export function StepTracker({
  steps,
  startIndex = 1,
}: {
  steps: { label: string; status: "pending" | "running" | "success" | "error" }[];
  startIndex?: number;
}) {
  const icons = { pending: "⬜", running: "⏳", success: "✅", error: "❌" };
  const textColors = {
    pending: "text-gray-600",
    running: "text-gray-600",
    success: "text-green-700",
    error: "text-red-600",
  };
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border">
          <span className="text-lg w-6 text-center">{icons[s.status]}</span>
          <span className={`text-sm font-medium ${textColors[s.status]}`}>
            {i + startIndex}단계. {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CSVUploader({ onFile, label }: { onFile: (t: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => onFile(e.target?.result as string);
    reader.readAsText(file, "UTF-8");
  };
  return (
    <div
      className="border-2 border-dashed border-indigo-300 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-50 transition-colors"
      onClick={() => ref.current?.click()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) readFile(f);
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="text-3xl mb-2">📂</div>
      <p className="text-sm font-semibold text-indigo-600">{label}</p>
      <p className="text-xs text-gray-400 mt-1">클릭하거나 드래그하세요</p>
      <input
        ref={ref}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
