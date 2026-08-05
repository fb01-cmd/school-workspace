"use client";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export default function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}: PaginationControlsProps) {
  if (totalCount === 0) return null;

  const validTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = Math.min(Math.max(1, currentPage), validTotalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 pb-1 border-t border-gray-100 text-xs text-gray-600">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-500">페이지당:</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="px-2 py-1 border border-gray-300 rounded bg-white font-semibold text-gray-800 focus:ring-1 focus:ring-indigo-500 focus:outline-none cursor-pointer"
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}개씩 보기
            </option>
          ))}
        </select>
        <span className="text-gray-400 font-normal">
          (총 <strong className="text-gray-700 font-bold">{totalCount}</strong>건)
        </span>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          onClick={() => onPageChange(safeCurrentPage - 1)}
          disabled={safeCurrentPage <= 1}
          className="px-2.5 py-1 border border-gray-300 rounded bg-white font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          ◀ 이전
        </button>

        <span className="px-2 font-bold text-gray-800">
          {safeCurrentPage} / {validTotalPages} 페이지
        </span>

        <button
          type="button"
          onClick={() => onPageChange(safeCurrentPage + 1)}
          disabled={safeCurrentPage >= validTotalPages}
          className="px-2.5 py-1 border border-gray-300 rounded bg-white font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
        >
          다음 ▶
        </button>
      </div>
    </div>
  );
}
