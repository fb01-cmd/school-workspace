"use client";

/** 작업기록 모달 전용 5x7 미니 그리드 (스펙 §0-1 제1원칙: 텍스트 이동 좌표 표기 금지) */
export function HistoryMiniGrid({
  highlightCells,
  periods = 7,
}: {
  highlightCells: Array<{ day: number; period: number; color?: string; label?: string }>;
  periods?: number;
}) {
  return (
    <div className="inline-block bg-white p-1 rounded-md border border-gray-200 shadow-2xs select-none shrink-0">
      <div className="grid grid-cols-5 gap-0.5 text-center text-[8px] font-bold text-gray-400 pb-0.5">
        <span>월</span>
        <span>화</span>
        <span>수</span>
        <span>목</span>
        <span>금</span>
      </div>
      <div className="grid grid-cols-5 gap-0.5">
        {Array.from({ length: periods * 5 }).map((_, i) => {
          const day = (i % 5) + 1;
          const period = Math.floor(i / 5) + 1;
          const hit = highlightCells.find((h) => h.day === day && h.period === period);
          return (
            <div
              key={i}
              className={`w-3.5 h-3 rounded-xs flex items-center justify-center text-[7px] font-mono font-extrabold transition-colors ${
                hit
                  ? hit.color || "bg-indigo-600 text-white"
                  : "bg-gray-100/70 border border-gray-200/40"
              }`}
            >
              {hit?.label || ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HistoryMiniGrid;
