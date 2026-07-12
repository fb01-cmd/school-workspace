"use client";

import { useState, useEffect } from "react";
import type { EnrollmentRow } from "@/lib/csvParser";

interface SheetRow {
  id: string;
  givenName: string; // 이름
  classNum: string;  // 반
  studentNum: string; // 번호
  error?: string;
}

interface EnrollSheetEditorProps {
  onApply: (rows: EnrollmentRow[]) => void;
  onCancel: () => void;
}

const FIELDS: (keyof SheetRow)[] = ["givenName", "classNum", "studentNum"];

export default function EnrollSheetEditor({ onApply, onCancel }: EnrollSheetEditorProps) {
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [history, setHistory] = useState<SheetRow[][]>([]);

  // Initialize with 15 empty rows
  useEffect(() => {
    const initialRows: SheetRow[] = Array.from({ length: 15 }).map(() => ({
      id: `new_${Math.random().toString(36).substr(2, 9)}`,
      givenName: "",
      classNum: "",
      studentNum: "",
    }));
    setRows(initialRows);
  }, []);

  const pushHistory = (currentRows: SheetRow[]) => {
    const snapshot = JSON.parse(JSON.stringify(currentRows));
    setHistory((prev) => [...prev.slice(-49), snapshot]);
  };

  const handleUndo = () => {
    setHistory((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory;
      const previousState = prevHistory[prevHistory.length - 1];
      setRows(previousState);
      return prevHistory.slice(0, -1);
    });
  };

  const handleAddRows = (count: number = 10) => {
    pushHistory(rows);
    const newRows: SheetRow[] = Array.from({ length: count }).map(() => ({
      id: `new_${Math.random().toString(36).substr(2, 9)}`,
      givenName: "",
      classNum: "",
      studentNum: "",
    }));
    setRows((prev) => [...prev, ...newRows]);
  };

  const handleClearSheet = () => {
    if (!confirm("시트의 모든 데이터를 지우시겠습니까?")) return;
    pushHistory(rows);
    setRows(
      Array.from({ length: 15 }).map(() => ({
        id: `new_${Math.random().toString(36).substr(2, 9)}`,
        givenName: "",
        classNum: "",
        studentNum: "",
      }))
    );
  };

  const handleRemoveRow = (index: number) => {
    pushHistory(rows);
    setRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleCellChange = (index: number, field: keyof SheetRow, value: string) => {
    pushHistory(rows);
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[index], [field]: value };
      validateRow(row);
      next[index] = row;
      return next;
    });
  };

  const validateRow = (row: SheetRow) => {
    row.error = undefined;
    const name = row.givenName.trim();
    const classNumStr = row.classNum.trim();
    const studentNumStr = row.studentNum.trim();

    // If completely empty, no error (will be filtered out)
    if (!name && !classNumStr && !studentNumStr) {
      return;
    }

    if (!name) {
      row.error = "이름을 입력해 주세요.";
      return;
    }

    const c = parseInt(classNumStr, 10);
    if (isNaN(c) || c < 1 || c > 10) {
      row.error = "반은 1~10 사이의 숫자여야 합니다.";
      return;
    }

    const s = parseInt(studentNumStr, 10);
    if (isNaN(s) || s < 1 || s > 99) {
      row.error = "번호는 1~99 사이의 숫자여야 합니다.";
      return;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    if (!text) return;

    // Excel/Sheets tab separated columns, newline separated rows
    const pastedRows = text.split(/\r?\n/).map((line) => line.split("\t"));

    pushHistory(rows);

    setRows((prevRows) => {
      let nextRows = [...prevRows];

      const requiredRows = rowIndex + pastedRows.length;
      if (requiredRows > nextRows.length) {
        const extraCount = requiredRows - nextRows.length;
        const newRows: SheetRow[] = Array.from({ length: extraCount }).map(() => ({
          id: `new_${Math.random().toString(36).substr(2, 9)}`,
          givenName: "",
          classNum: "",
          studentNum: "",
        }));
        nextRows = [...nextRows, ...newRows];
      }

      for (let r = 0; r < pastedRows.length; r++) {
        const targetRowIdx = rowIndex + r;
        if (targetRowIdx >= nextRows.length) break;

        const row = { ...nextRows[targetRowIdx] };
        const cols = pastedRows[r];

        for (let c = 0; c < cols.length; c++) {
          const targetColIdx = colIndex + c;
          if (targetColIdx >= FIELDS.length) break;

          const fieldName = FIELDS[targetColIdx];
          const rawVal = cols[c].trim();

          (row as any)[fieldName] = rawVal;
        }
        validateRow(row);
        nextRows[targetRowIdx] = row;
      }

      return nextRows;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>, rowIndex: number, colIndex: number) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      handleUndo();
      return;
    }

    const maxRows = rows.length;
    const maxCols = FIELDS.length;

    const focusInput = (r: number, c: number) => {
      const target = document.querySelector(
        `[data-enroll-row-index="${r}"][data-enroll-col-index="${c}"]`
      ) as HTMLElement | null;
      if (target) {
        target.focus();
        if (target instanceof HTMLInputElement) {
          target.select();
        }
      }
    };

    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      if (rowIndex < maxRows - 1) {
        e.preventDefault();
        focusInput(rowIndex + 1, colIndex);
      }
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      if (rowIndex > 0) {
        e.preventDefault();
        focusInput(rowIndex - 1, colIndex);
      }
    } else if (e.key === "ArrowLeft") {
      const target = e.target as HTMLInputElement;
      const isBoundary = target.selectionStart === 0 && target.selectionEnd === 0;
      if (isBoundary && colIndex > 0) {
        e.preventDefault();
        focusInput(rowIndex, colIndex - 1);
      }
    } else if (e.key === "ArrowRight") {
      const target = e.target as HTMLInputElement;
      const isBoundary = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
      if (isBoundary && colIndex < maxCols - 1) {
        e.preventDefault();
        focusInput(rowIndex, colIndex + 1);
      }
    }
  };

  const handleSubmit = () => {
    // Filter empty rows
    const activeRows = rows.filter((r) => r.givenName.trim() || r.classNum.trim() || r.studentNum.trim());

    // Validate active rows
    const validatedRows = activeRows.map((r) => {
      const copy = { ...r };
      validateRow(copy);
      return copy;
    });

    const hasErrors = validatedRows.some((r) => r.error);
    if (hasErrors) {
      // Sync errors back to display rows
      setRows((prev) =>
        prev.map((original) => {
          const matched = validatedRows.find((v) => v.id === original.id);
          return matched ? matched : original;
        })
      );
      alert("시트에 입력 오류가 표시되어 있습니다. 빨간색 경고 메시지와 테두리를 확인해 주세요.");
      return;
    }

    if (validatedRows.length === 0) {
      alert("입력된 신입생 데이터가 없습니다.");
      return;
    }

    // Convert to EnrollmentRow[]
    const output: EnrollmentRow[] = validatedRows.map((r) => ({
      familyName: "", // familyName remains empty as handled by parseEnrollmentCSV
      givenName: r.givenName.trim(),
      classNum: parseInt(r.classNum.trim(), 10),
      studentNum: parseInt(r.studentNum.trim(), 10),
      serialNum: 0,
    }));

    onApply(output);
  };

  return (
    <div className="flex flex-col space-y-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h4 className="text-base font-bold text-slate-800 flex items-center gap-2">
            📝 신입생 시트 편집기
          </h4>
          <p className="text-xs text-slate-500 mt-1">
            성명, 반, 번호를 직접 입력하거나, 엑셀/스프레드시트에서 영역을 복사(Ctrl+C) 후 첫 번째 칸에 붙여넣기(Ctrl+V) 하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleAddRows(10)}
            className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-lg transition-all"
          >
            ➕ 10행 추가
          </button>
          <button
            type="button"
            onClick={handleClearSheet}
            className="px-3 py-1.5 text-xs font-semibold bg-red-50 border border-red-100 text-red-600 hover:bg-red-100 rounded-lg transition-all"
          >
            🗑️ 전체 초기화
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all"
            title="되돌리기 (Ctrl+Z)"
          >
            ↩️ 실행 취소
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[400px]">
        <table className="min-w-full divide-y divide-slate-200 text-xs border-collapse">
          <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-center text-slate-500 w-12 font-bold border-r border-slate-200">No</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700 w-1/3 border-r border-slate-200">이름*</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700 w-1/4 border-r border-slate-200">반 (1~10)*</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-700 w-1/4 border-r border-slate-200">번호 (1~99)*</th>
              <th className="px-3 py-2 text-center text-slate-500 w-16">삭제</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-100">
            {rows.map((row, index) => {
              const hasError = !!row.error;
              return (
                <tr key={row.id} className={`hover:bg-slate-50/50 ${hasError ? "bg-red-50/20" : ""}`}>
                  <td className="px-2 py-1 text-center font-mono text-slate-400 select-none border-r border-slate-100">
                    {index + 1}
                  </td>
                  <td className="p-1 border-r border-slate-100">
                    <input
                      type="text"
                      value={row.givenName}
                      onChange={(e) => handleCellChange(index, "givenName", e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, index, 0)}
                      onPaste={(e) => handlePaste(e, index, 0)}
                      data-enroll-row-index={index}
                      data-enroll-col-index={0}
                      placeholder="예: 김민준"
                      className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
                        hasError && !row.givenName.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
                      }`}
                    />
                  </td>
                  <td className="p-1 border-r border-slate-100">
                    <input
                      type="text"
                      value={row.classNum}
                      onChange={(e) => handleCellChange(index, "classNum", e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, index, 1)}
                      onPaste={(e) => handlePaste(e, index, 1)}
                      data-enroll-row-index={index}
                      data-enroll-col-index={1}
                      placeholder="예: 1"
                      className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
                        hasError && (!row.classNum.trim() || isNaN(parseInt(row.classNum)) || parseInt(row.classNum) < 1 || parseInt(row.classNum) > 10)
                          ? "border-red-400 bg-red-50/50"
                          : "border-slate-200"
                      }`}
                    />
                  </td>
                  <td className="p-1 border-r border-slate-100">
                    <input
                      type="text"
                      value={row.studentNum}
                      onChange={(e) => handleCellChange(index, "studentNum", e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, index, 2)}
                      onPaste={(e) => handlePaste(e, index, 2)}
                      data-enroll-row-index={index}
                      data-enroll-col-index={2}
                      placeholder="예: 5"
                      className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
                        hasError && (!row.studentNum.trim() || isNaN(parseInt(row.studentNum)) || parseInt(row.studentNum) < 1 || parseInt(row.studentNum) > 99)
                          ? "border-red-400 bg-red-50/50"
                          : "border-slate-200"
                      }`}
                    />
                  </td>
                  <td className="p-1 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(index)}
                      className="text-red-400 hover:text-red-600 px-1 py-0.5"
                      title="행 삭제"
                    >
                      ❌
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.some((r) => r.error) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-xs">
          ⚠️ <strong>입력 에러 내용:</strong>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {rows
              .filter((r) => r.error)
              .map((r, i) => (
                <li key={i}>
                  {rows.indexOf(r) + 1}행 ({r.givenName || "이름 미입력"}): {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-lg transition-colors"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
        >
          작성 완료 및 적용
        </button>
      </div>
    </div>
  );
}
