"use client";

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import OUTreeSelector from "@/components/admin/OUTreeSelector";
import { useAuth } from "@/context/AuthContext";

interface GoogleUser {
  id: string;
  primaryEmail: string;
  name: {
    familyName: string;
    givenName: string;
  };
  orgUnitPath: string;
  role?: string;
  suspended?: boolean;
  aliases?: string[];
}

interface SheetRow {
  id: string;
  isNew: boolean;
  isModified: boolean;
  originalEmail?: string;
  familyName: string;
  givenName: string;
  emailPrefix: string;
  orgUnitPath: string;
  password?: string;
  changePasswordAtNextLogin: boolean;
  suspended: boolean;
  error?: string;
}

interface UserSheetEditorProps {
  users: GoogleUser[];
  orgUnits: { orgUnitId: string; orgUnitPath: string; name: string }[];
  domain: string;
  defaultOrgUnitPath?: string;
  onSave: () => void;
  onCancel: () => void;
}

// Module-level field list
const FIELDS: (keyof SheetRow)[] = [
  "familyName",
  "givenName",
  "emailPrefix",
  "orgUnitPath",
  "password",
  "changePasswordAtNextLogin",
  "suspended"
];

// Module-level pure function — no closure over component state.
function validateRow(row: SheetRow) {
  row.error = undefined;
  if (!row.familyName.trim() || !row.givenName.trim()) {
    row.error = "성 및 이름은 필수입니다.";
    return;
  }
  if (!row.emailPrefix.trim()) {
    row.error = "이메일 아이디는 필수입니다.";
    return;
  }
  if (row.isNew && (!row.password || row.password.length < 8)) {
    row.error = "새 계정은 8자 이상의 비밀번호가 필수입니다.";
    return;
  }
  if (row.password && row.password.length > 0 && row.password.length < 8) {
    row.error = "비밀번호는 최소 8자 이상이어야 합니다.";
    return;
  }
}

// Helper functions for drag-fill computations
const parseAndIncrement = (baseVal: any, step: number) => {
  if (typeof baseVal === "boolean") {
    return baseVal;
  }
  const str = String(baseVal || "");
  const match = str.match(/(\d+)$/);
  if (!match) return baseVal;

  const numStr = match[1];
  const prefix = str.substring(0, str.length - numStr.length);
  const val = parseInt(numStr, 10) + step;
  const paddedVal = String(Math.max(0, val)).padStart(numStr.length, "0");
  return `${prefix}${paddedVal}`;
};

const getFilledValue = (colIdx: number, t: number, bounds: any, currentRows: SheetRow[]) => {
  const fieldName = FIELDS[colIdx];
  const minR = bounds.minRow;
  const maxR = bounds.maxRow;
  const L = maxR - minR + 1;

  if (L === 1) {
    const baseVal = currentRows[minR][fieldName];
    const step = t - minR;
    return parseAndIncrement(baseVal, step);
  } else {
    const vals = [];
    for (let r = minR; r <= maxR; r++) {
      vals.push(currentRows[r][fieldName]);
    }

    if (typeof vals[0] === "boolean") {
      const idx = ((t - minR) % L + L) % L;
      return vals[idx];
    }

    const parsedSuffixes = vals.map(v => {
      const match = String(v || "").match(/(\d+)$/);
      return match ? { prefix: String(v).substring(0, String(v).length - match[1].length), num: parseInt(match[1], 10), padLen: match[1].length } : null;
    });

    const allHaveNumbers = parsedSuffixes.every(p => p !== null);
    const samePrefix = allHaveNumbers && parsedSuffixes.every(p => p!.prefix === parsedSuffixes[0]!.prefix);

    if (allHaveNumbers && samePrefix) {
      const diff = parsedSuffixes[1]!.num - parsedSuffixes[0]!.num;
      let isArithmetic = true;
      for (let i = 1; i < L - 1; i++) {
        if (parsedSuffixes[i+1]!.num - parsedSuffixes[i]!.num !== diff) {
          isArithmetic = false;
          break;
        }
      }

      if (isArithmetic) {
        const step = t - minR;
        const targetNum = parsedSuffixes[0]!.num + step * diff;
        const prefix = parsedSuffixes[0]!.prefix;
        const padLen = parsedSuffixes[0]!.padLen;
        const paddedNum = String(Math.max(0, targetNum)).padStart(padLen, "0");
        return `${prefix}${paddedNum}`;
      }
    }

    const idx = ((t - minR) % L + L) % L;
    return vals[idx];
  }
};

const getHorizontalFilledValue = (r: number, tC: number, bounds: any, currentRows: SheetRow[]) => {
  const minC = bounds.minCol;
  const maxC = bounds.maxCol;
  const L = maxC - minC + 1;

  if (L === 1) {
    const fieldName = FIELDS[minC];
    const baseVal = currentRows[r][fieldName];
    const step = tC - minC;
    return parseAndIncrement(baseVal, step);
  } else {
    const idx = ((tC - minC) % L + L) % L;
    const srcCol = minC + idx;
    const srcFieldName = FIELDS[srcCol];
    return currentRows[r][srcFieldName];
  }
};

// ---------------------------------------------------------------------------
// SheetRowMemo — memoized per-row component
// Prevents the entire table from re-rendering on every keystroke; only the
// changed row (whose SheetRow reference changed) will re-render.
// Selection state is passed as primitive/struct values so React.memo's
// shallow comparison correctly short-circuits unchanged rows.
// ---------------------------------------------------------------------------
type SelectionBounds = { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
type FillInfo = {
  fillEndRow: number | null;
  fillEndCol: number | null;
  fillDirection: "vertical" | "horizontal" | null;
} | null;

interface SheetRowProps {
  row: SheetRow;
  index: number;
  domain: string;
  orgUnits: { orgUnitId: string; orgUnitPath: string; name: string }[];
  selectionBounds: SelectionBounds;
  fillInfo: FillInfo;
  onMouseDown: (e: React.MouseEvent, row: number, col: number) => void;
  onMouseEnter: (row: number, col: number) => void;
  onFillMouseDown: (e: React.MouseEvent) => void;
  onFillDoubleClick: (e: React.MouseEvent) => void;
  onCellChange: (index: number, field: keyof SheetRow, value: any) => void;
  onCellFocus: () => void;
  onCellBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>, row: number, col: number) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onRemoveRow: (id: string, index: number) => void;
}

const SheetRowMemo = memo(function SheetRowMemo({
  row,
  index,
  domain,
  orgUnits,
  selectionBounds,
  fillInfo,
  onMouseDown,
  onMouseEnter,
  onFillMouseDown,
  onFillDoubleClick,
  onCellChange,
  onCellFocus,
  onCellBlur,
  onKeyDown,
  onPaste,
  onRemoveRow,
}: SheetRowProps) {
  const hasError = !!row.error;

  // Compute selection/fill border classes inline from stable value props.
  const isSelected = (c: number) =>
    selectionBounds !== null &&
    index >= selectionBounds.minRow && index <= selectionBounds.maxRow &&
    c >= selectionBounds.minCol && c <= selectionBounds.maxCol;

  const selectionBorderClass = (c: number): string => {
    if (!selectionBounds || !isSelected(c)) return "";
    let cls = "bg-indigo-50/20 ";
    if (index === selectionBounds.minRow) cls += "border-t-2 border-t-indigo-600 ";
    if (index === selectionBounds.maxRow) cls += "border-b-2 border-b-indigo-600 ";
    if (c === selectionBounds.minCol) cls += "border-l-2 border-l-indigo-600 ";
    if (c === selectionBounds.maxCol) cls += "border-r-2 border-r-indigo-600 ";
    return cls;
  };

  const isInFillRange = (c: number): boolean => {
    if (!fillInfo || !selectionBounds) return false;
    const { fillEndRow, fillEndCol, fillDirection } = fillInfo;
    const { minRow, maxRow, minCol, maxCol } = selectionBounds;
    if (fillDirection === "vertical" && fillEndRow !== null) {
      if (c < minCol || c > maxCol) return false;
      if (fillEndRow > maxRow) return index > maxRow && index <= fillEndRow;
      if (fillEndRow < minRow) return index >= fillEndRow && index < minRow;
    } else if (fillDirection === "horizontal" && fillEndCol !== null) {
      if (index < minRow || index > maxRow) return false;
      if (fillEndCol > maxCol) return c > maxCol && c <= fillEndCol;
      if (fillEndCol < minCol) return c >= fillEndCol && c < minCol;
    }
    return false;
  };

  const fillBorderClass = (c: number): string => {
    if (!isInFillRange(c) || !fillInfo || !selectionBounds) return "";
    const { fillEndRow, fillEndCol, fillDirection } = fillInfo;
    const { minRow, maxRow, minCol, maxCol } = selectionBounds;
    let cls = "bg-indigo-50/10 ";
    if (fillDirection === "vertical" && fillEndRow !== null) {
      const fillMinR = fillEndRow > maxRow ? maxRow + 1 : fillEndRow;
      const fillMaxR = fillEndRow > maxRow ? fillEndRow : minRow - 1;
      if (index === fillMinR) cls += "border-t-2 border-t-indigo-400 border-dashed ";
      if (index === fillMaxR) cls += "border-b-2 border-b-indigo-400 border-dashed ";
      if (c === minCol) cls += "border-l-2 border-l-indigo-400 border-dashed ";
      if (c === maxCol) cls += "border-r-2 border-r-indigo-400 border-dashed ";
    } else if (fillDirection === "horizontal" && fillEndCol !== null) {
      const fillMinC = fillEndCol > maxCol ? maxCol + 1 : fillEndCol;
      const fillMaxC = fillEndCol > maxCol ? fillEndCol : minCol - 1;
      if (index === minRow) cls += "border-t-2 border-t-indigo-400 border-dashed ";
      if (index === maxRow) cls += "border-b-2 border-b-indigo-400 border-dashed ";
      if (c === fillMinC) cls += "border-l-2 border-l-indigo-400 border-dashed ";
      if (c === fillMaxC) cls += "border-r-2 border-r-indigo-400 border-dashed ";
    }
    return cls;
  };

  const isSelectionHandleVisible = (c: number): boolean =>
    selectionBounds !== null && index === selectionBounds.maxRow && c === selectionBounds.maxCol;

  return (
    <tr
      className={`hover:bg-slate-50/50 ${
        row.isNew ? "bg-emerald-50/30" : row.isModified ? "bg-sky-50/30" : ""
      } ${hasError ? "bg-red-50/20" : ""}`}
    >
      {/* No / Status Column */}
      <td className="px-2 py-1 text-center font-mono text-slate-400 select-none border-r border-slate-100">
        <div className="flex flex-col items-center gap-0.5">
          <span>{index + 1}</span>
          {row.isNew ? (
            <span className="px-1 py-0.2 bg-emerald-100 text-emerald-800 rounded-[3px] text-[8px] font-bold">New</span>
          ) : row.isModified ? (
            <span className="px-1 py-0.2 bg-sky-100 text-sky-800 rounded-[3px] text-[8px] font-bold">Edit</span>
          ) : null}
        </div>
      </td>

      {/* Family Name */}
      <td
        className={`p-1 border-r border-slate-100 relative group transition-all ${selectionBorderClass(0)} ${fillBorderClass(0)}`}
        onMouseDown={(e) => onMouseDown(e, index, 0)}
        onMouseEnter={() => onMouseEnter(index, 0)}
      >
        <input
          type="text"
          value={row.familyName}
          onChange={(e) => onCellChange(index, "familyName", e.target.value)}
          onFocus={onCellFocus}
          onBlur={onCellBlur}
          onKeyDown={(e) => onKeyDown(e, index, 0)}
          onPaste={(e) => onPaste(e, index, 0)}
          data-row-index={index}
          data-col-index={0}
          placeholder="성"
          className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
            hasError && !row.familyName.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
          }`}
        />
        {isSelectionHandleVisible(0) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Given Name */}
      <td
        className={`p-1 border-r border-slate-100 relative group transition-all ${selectionBorderClass(1)} ${fillBorderClass(1)}`}
        onMouseDown={(e) => onMouseDown(e, index, 1)}
        onMouseEnter={() => onMouseEnter(index, 1)}
      >
        <input
          type="text"
          value={row.givenName}
          onChange={(e) => onCellChange(index, "givenName", e.target.value)}
          onFocus={onCellFocus}
          onBlur={onCellBlur}
          onKeyDown={(e) => onKeyDown(e, index, 1)}
          onPaste={(e) => onPaste(e, index, 1)}
          data-row-index={index}
          data-col-index={1}
          placeholder="이름"
          className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 ${
            hasError && !row.givenName.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
          }`}
        />
        {isSelectionHandleVisible(1) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Google ID Prefix */}
      <td
        className={`p-1 border-r border-slate-100 relative group transition-all ${selectionBorderClass(2)} ${fillBorderClass(2)}`}
        onMouseDown={(e) => onMouseDown(e, index, 2)}
        onMouseEnter={() => onMouseEnter(index, 2)}
      >
        <div className="flex items-center">
          <input
            type="text"
            value={row.emailPrefix}
            onChange={(e) => onCellChange(index, "emailPrefix", e.target.value.replace(/\s/g, "").toLowerCase())}
            onFocus={onCellFocus}
            onBlur={onCellBlur}
            onKeyDown={(e) => onKeyDown(e, index, 2)}
            onPaste={(e) => onPaste(e, index, 2)}
            data-row-index={index}
            data-col-index={2}
            placeholder="아이디"
            className={`flex-1 min-w-0 px-2 py-1 text-xs border rounded-l focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 font-mono ${
              hasError && !row.emailPrefix.trim() ? "border-red-400 bg-red-50/50" : "border-slate-200"
            }`}
          />
          <span className="px-2 py-1 text-[10px] text-slate-500 border border-l-0 border-slate-200 bg-slate-50 rounded-r font-mono select-none">
            @{domain}
          </span>
        </div>
        {isSelectionHandleVisible(2) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Org Unit Path */}
      <td
        className={`p-1 border-r border-slate-100 w-52 relative group transition-all ${selectionBorderClass(3)} ${fillBorderClass(3)}`}
        onMouseDown={(e) => onMouseDown(e, index, 3)}
        onMouseEnter={() => onMouseEnter(index, 3)}
      >
        <OUTreeSelector
          orgUnits={orgUnits}
          value={row.orgUnitPath}
          onChange={(path) => onCellChange(index, "orgUnitPath", path || "/")}
          size="sm"
          data-row-index={index}
          data-col-index={3}
          onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => onKeyDown(e, index, 3)}
        />
        {isSelectionHandleVisible(3) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Password */}
      <td
        className={`p-1 border-r border-slate-100 relative group transition-all ${selectionBorderClass(4)} ${fillBorderClass(4)}`}
        onMouseDown={(e) => onMouseDown(e, index, 4)}
        onMouseEnter={() => onMouseEnter(index, 4)}
      >
        <input
          type="text"
          value={row.password || ""}
          onChange={(e) => onCellChange(index, "password", e.target.value)}
          onFocus={onCellFocus}
          onBlur={onCellBlur}
          onKeyDown={(e) => onKeyDown(e, index, 4)}
          onPaste={(e) => onPaste(e, index, 4)}
          data-row-index={index}
          data-col-index={4}
          placeholder={row.isNew ? "임시비밀번호" : "(변경 시 입력)"}
          className={`w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-800 font-mono ${
            hasError && row.isNew && (!row.password || row.password.length < 8) ? "border-red-400 bg-red-50/50" : "border-slate-200"
          }`}
        />
        {isSelectionHandleVisible(4) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Change Password next sign in */}
      <td
        className={`p-1 text-center border-r border-slate-100 relative transition-all ${selectionBorderClass(5)} ${fillBorderClass(5)}`}
        onMouseDown={(e) => onMouseDown(e, index, 5)}
        onMouseEnter={() => onMouseEnter(index, 5)}
      >
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={row.changePasswordAtNextLogin}
            onChange={(e) => onCellChange(index, "changePasswordAtNextLogin", e.target.checked)}
            className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
          />
        </div>
        {isSelectionHandleVisible(5) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Suspend status */}
      <td
        className={`p-1 text-center border-r border-slate-100 relative transition-all ${selectionBorderClass(6)} ${fillBorderClass(6)}`}
        onMouseDown={(e) => onMouseDown(e, index, 6)}
        onMouseEnter={() => onMouseEnter(index, 6)}
      >
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={row.suspended}
            onChange={(e) => onCellChange(index, "suspended", e.target.checked)}
            className="rounded text-red-600 focus:ring-red-500 w-3.5 h-3.5 cursor-pointer"
          />
        </div>
        {isSelectionHandleVisible(6) && (
          <div
            onMouseDown={(e) => onFillMouseDown(e)}
            onDoubleClick={(e) => onFillDoubleClick(e)}
            className="absolute right-0 bottom-0 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-30 translate-x-1/2 translate-y-1/2 rounded-sm shadow-sm fill-handle"
            title="더블클릭하거나 끌어서 자동 채우기"
          />
        )}
      </td>

      {/* Delete row */}
      <td className="p-1 text-center">
        {row.isNew ? (
          <button
            type="button"
            onClick={() => onRemoveRow(row.id, index)}
            className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-0.5 rounded text-[10px] font-semibold"
          >
            삭제
          </button>
        ) : (
          <span className="text-slate-300 select-none">-</span>
        )}
      </td>
    </tr>
  );
});

export default function UserSheetEditor({
  users,
  orgUnits,
  domain,
  defaultOrgUnitPath,
  onSave,
  onCancel,
}: UserSheetEditorProps) {
  const { user, userData } = useAuth();
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [history, setHistory] = useState<SheetRow[][]>([]);
  const [selectionStart, setSelectionStart] = useState<{ row: number; col: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ row: number; col: number } | null>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [isDraggingFill, setIsDraggingFill] = useState(false);
  const [fillEndRow, setFillEndRow] = useState<number | null>(null);
  const [fillEndCol, setFillEndCol] = useState<number | null>(null);
  const [fillDirection, setFillDirection] = useState<"vertical" | "horizontal" | null>(null);

  // Spec A: Lazy snapshot arming flag
  const armedRef = useRef(true);

  // State refs to guarantee stable useCallback identity without stale closures
  const rowsRef = useRef<SheetRow[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const historyRef = useRef<SheetRow[][]>([]);
  useEffect(() => { historyRef.current = history; }, [history]);

  const selectionStartRef = useRef(selectionStart);
  useEffect(() => { selectionStartRef.current = selectionStart; }, [selectionStart]);

  const selectionEndRef = useRef(selectionEnd);
  useEffect(() => { selectionEndRef.current = selectionEnd; }, [selectionEnd]);

  const isDraggingSelectionRef = useRef(isDraggingSelection);
  useEffect(() => { isDraggingSelectionRef.current = isDraggingSelection; }, [isDraggingSelection]);

  const isDraggingFillRef = useRef(isDraggingFill);
  useEffect(() => { isDraggingFillRef.current = isDraggingFill; }, [isDraggingFill]);

  const fillEndRowRef = useRef(fillEndRow);
  useEffect(() => { fillEndRowRef.current = fillEndRow; }, [fillEndRow]);

  const fillEndColRef = useRef(fillEndCol);
  useEffect(() => { fillEndColRef.current = fillEndCol; }, [fillEndCol]);

  const fillDirectionRef = useRef(fillDirection);
  useEffect(() => { fillDirectionRef.current = fillDirection; }, [fillDirection]);

  // Push snapshot to history stack
  const pushHistory = useCallback((currentRows: SheetRow[]) => {
    const snapshot = JSON.parse(JSON.stringify(currentRows)) as SheetRow[];
    setHistory((prev) => [...prev.slice(-49), snapshot]);
  }, []);

  // Spec D: handleUndo decoupled from setHistory updater callback + re-arm flag
  const handleUndo = useCallback(() => {
    const prevHistory = historyRef.current;
    if (prevHistory.length === 0) return;
    const previousState = prevHistory[prevHistory.length - 1];
    setRows(previousState);
    setHistory((prev) => prev.slice(0, -1));
    armedRef.current = true;
  }, []);

  // Spec C: Memoized selection bounds and fill info
  const selectionBounds = useMemo(() => {
    if (!selectionStart || !selectionEnd) return null;
    return {
      minRow: Math.min(selectionStart.row, selectionEnd.row),
      maxRow: Math.max(selectionStart.row, selectionEnd.row),
      minCol: Math.min(selectionStart.col, selectionEnd.col),
      maxCol: Math.max(selectionStart.col, selectionEnd.col),
    };
  }, [selectionStart, selectionEnd]);

  const fillInfo = useMemo(() => {
    if (!isDraggingFill) return null;
    return { fillEndRow, fillEndCol, fillDirection };
  }, [isDraggingFill, fillEndRow, fillEndCol, fillDirection]);

  // Helper using refs for stable callbacks
  const getSelectionBoundsFromRef = useCallback(() => {
    if (!selectionStartRef.current || !selectionEndRef.current) return null;
    return {
      minRow: Math.min(selectionStartRef.current.row, selectionEndRef.current.row),
      maxRow: Math.max(selectionStartRef.current.row, selectionEndRef.current.row),
      minCol: Math.min(selectionStartRef.current.col, selectionEndRef.current.col),
      maxCol: Math.max(selectionStartRef.current.col, selectionEndRef.current.col),
    };
  }, []);

  // Spec A: Lazy arming focus/blur handlers (no instant snapshot on focus/blur)
  const handleCellFocus = useCallback(() => {
    armedRef.current = true;
  }, []);

  const handleCellBlur = useCallback(() => {
    armedRef.current = true;
  }, []);

  // Spec A: Commit snapshot on actual mutation if armed
  const handleCellChange = useCallback((index: number, field: keyof SheetRow, value: any) => {
    if (armedRef.current) {
      pushHistory(rowsRef.current);
      armedRef.current = false;
    }
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      (row as any)[field] = value;
      row.isModified = !row.isNew;
      validateRow(row);
      next[index] = row;
      return next;
    });
  }, [pushHistory]);

  // Spec B: 7 Handler stabilization with useCallback + refs
  const handleMouseDown = useCallback((e: React.MouseEvent, r: number, c: number) => {
    if ((e.target as HTMLElement).closest(".fill-handle")) return;

    const isInput = (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT";
    
    if (e.shiftKey) {
      e.preventDefault();
      setSelectionEnd({ row: r, col: c });
    } else {
      setSelectionStart({ row: r, col: c });
      setSelectionEnd({ row: r, col: c });
      setIsDraggingSelection(true);
      if (!isInput) {
        e.preventDefault();
      }
    }
  }, []);

  const handleMouseEnter = useCallback((r: number, c: number) => {
    if (isDraggingSelectionRef.current) {
      setSelectionEnd({ row: r, col: c });
    } else if (isDraggingFillRef.current && selectionStartRef.current && selectionEndRef.current) {
      const bounds = getSelectionBoundsFromRef();
      if (!bounds) return;

      const distY = Math.max(0, r - bounds.maxRow) + Math.max(0, bounds.minRow - r);
      const distX = Math.max(0, c - bounds.maxCol) + Math.max(0, bounds.minCol - c);

      let dir: "vertical" | "horizontal" = "vertical";
      if (distX > distY) {
        dir = "horizontal";
      }

      setFillDirection(dir);
      if (dir === "vertical") {
        setFillEndRow(r);
        setFillEndCol(null);
      } else {
        setFillEndCol(c);
        setFillEndRow(null);
      }
    }
  }, [getSelectionBoundsFromRef]);

  const handleFillMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFill(true);
    if (selectionEndRef.current) {
      setFillEndRow(selectionEndRef.current.row);
      setFillEndCol(selectionEndRef.current.col);
      setFillDirection(null);
    }
  }, []);

  const handleFillDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!selectionStartRef.current || !selectionEndRef.current) return;
    const bounds = getSelectionBoundsFromRef();
    if (!bounds) return;

    const minR = bounds.minRow;
    const maxR = bounds.maxRow;
    const minC = bounds.minCol;
    const maxC = bounds.maxCol;

    const currentRows = rowsRef.current;
    const maxRows = currentRows.length;
    if (maxR >= maxRows - 1) return;

    let neighborCol = -1;
    if (minC > 0) {
      neighborCol = minC - 1;
    } else if (maxC < FIELDS.length - 1) {
      neighborCol = maxC + 1;
    }

    let fillToRow = maxRows - 1;

    if (neighborCol !== -1) {
      const neighborField = FIELDS[neighborCol];
      let lastNonEmpty = maxR;
      for (let r = maxR + 1; r < maxRows; r++) {
        const val = currentRows[r][neighborField];
        const isEmpty = val === undefined || val === null || String(val).trim() === "";
        if (!isEmpty) {
          lastNonEmpty = r;
        } else {
          break;
        }
      }
      if (lastNonEmpty > maxR) {
        fillToRow = lastNonEmpty;
      }
    }

    if (fillToRow <= maxR) {
      let lastNonEmptyRow = maxR;
      for (let r = maxR + 1; r < maxRows; r++) {
        const hasAnyData = FIELDS.some(f => {
          const val = currentRows[r][f];
          return val !== undefined && val !== null && String(val).trim() !== "" && val !== "/";
        });
        if (hasAnyData) {
          lastNonEmptyRow = r;
        }
      }
      if (lastNonEmptyRow > maxR) {
        fillToRow = lastNonEmptyRow;
      } else {
        fillToRow = maxRows - 1;
      }
    }

    if (fillToRow <= maxR) return;

    pushHistory(currentRows);
    armedRef.current = true;

    setRows((prevRows) => {
      const nextRows = [...prevRows];
      for (let r = maxR + 1; r <= fillToRow; r++) {
        const row = { ...nextRows[r] };
        for (let c = minC; c <= maxC; c++) {
          const fieldName = FIELDS[c];
          const val = getFilledValue(c, r, bounds, prevRows);
          (row as any)[fieldName] = val;
        }
        row.isModified = !row.isNew;
        validateRow(row);
        nextRows[r] = row;
      }
      return nextRows;
    });

    setSelectionEnd({ row: fillToRow, col: maxC });
  }, [getSelectionBoundsFromRef, pushHistory]);

  const executeDragFill = useCallback(() => {
    if (!selectionStartRef.current || !selectionEndRef.current) return;
    const bounds = getSelectionBoundsFromRef();
    if (!bounds) return;

    const minR = bounds.minRow;
    const maxR = bounds.maxRow;
    const minC = bounds.minCol;
    const maxC = bounds.maxCol;

    const currentFillEndRow = fillEndRowRef.current;
    const currentFillEndCol = fillEndColRef.current;
    const currentFillDirection = fillDirectionRef.current;

    if (currentFillDirection === "vertical" && currentFillEndRow !== null) {
      let targetRows: number[] = [];
      if (currentFillEndRow > maxR) {
        for (let r = maxR + 1; r <= currentFillEndRow; r++) targetRows.push(r);
      } else if (currentFillEndRow < minR) {
        for (let r = currentFillEndRow; r <= minR - 1; r++) targetRows.push(r);
      }

      if (targetRows.length === 0) return;

      pushHistory(rowsRef.current);
      armedRef.current = true;

      setRows((prevRows) => {
        const nextRows = [...prevRows];
        for (const r of targetRows) {
          const row = { ...nextRows[r] };
          for (let c = minC; c <= maxC; c++) {
            const fieldName = FIELDS[c];
            const val = getFilledValue(c, r, bounds, prevRows);
            (row as any)[fieldName] = val;
          }
          row.isModified = !row.isNew;
          validateRow(row);
          nextRows[r] = row;
        }
        return nextRows;
      });

      setSelectionStart({ row: Math.min(minR, currentFillEndRow), col: minC });
      setSelectionEnd({ row: Math.max(maxR, currentFillEndRow), col: maxC });
    } 
    else if (currentFillDirection === "horizontal" && currentFillEndCol !== null) {
      let targetCols: number[] = [];
      if (currentFillEndCol > maxC) {
        for (let c = maxC + 1; c <= currentFillEndCol; c++) targetCols.push(c);
      } else if (currentFillEndCol < minC) {
        for (let c = currentFillEndCol; c <= minC - 1; c++) targetCols.push(c);
      }

      if (targetCols.length === 0) return;

      pushHistory(rowsRef.current);
      armedRef.current = true;

      setRows((prevRows) => {
        const nextRows = [...prevRows];
        for (let r = minR; r <= maxR; r++) {
          const row = { ...nextRows[r] };
          for (const c of targetCols) {
            const fieldName = FIELDS[c];
            const val = getHorizontalFilledValue(r, c, bounds, prevRows);
            (row as any)[fieldName] = val;
          }
          row.isModified = !row.isNew;
          validateRow(row);
          nextRows[r] = row;
        }
        return nextRows;
      });

      setSelectionStart({ row: minR, col: Math.min(minC, currentFillEndCol) });
      setSelectionEnd({ row: maxR, col: Math.max(maxC, currentFillEndCol) });
    }

    setFillEndRow(null);
    setFillEndCol(null);
    setFillDirection(null);
  }, [getSelectionBoundsFromRef, pushHistory]);

  // Spec B & Spec D: Keydown handler with event propagation stop on Ctrl+Z
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>, rowIndex: number, colIndex: number) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      handleUndo();
      return;
    }

    const currentRows = rowsRef.current;
    const maxRows = currentRows.length;
    const maxCols = 5;

    const focusInput = (r: number, c: number) => {
      const target = document.querySelector(
        `[data-row-index="${r}"][data-col-index="${c}"]`
      ) as HTMLElement | null;
      if (target) {
        target.focus();
        if (target instanceof HTMLInputElement && target.type === "text") {
          target.select();
        }
      }
    };

    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      if (rowIndex < maxRows - 1) {
        e.preventDefault();
        focusInput(rowIndex + 1, colIndex);
        if (e.shiftKey) {
          if (!selectionStartRef.current) setSelectionStart({ row: rowIndex, col: colIndex });
          setSelectionEnd((prev) => prev ? { row: Math.min(maxRows - 1, prev.row + 1), col: prev.col } : { row: rowIndex + 1, col: colIndex });
        } else {
          setSelectionStart({ row: rowIndex + 1, col: colIndex });
          setSelectionEnd({ row: rowIndex + 1, col: colIndex });
        }
      }
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      if (rowIndex > 0) {
        e.preventDefault();
        focusInput(rowIndex - 1, colIndex);
        if (e.shiftKey) {
          if (!selectionStartRef.current) setSelectionStart({ row: rowIndex, col: colIndex });
          setSelectionEnd((prev) => prev ? { row: Math.max(0, prev.row - 1), col: prev.col } : { row: rowIndex - 1, col: colIndex });
        } else {
          setSelectionStart({ row: rowIndex - 1, col: colIndex });
          setSelectionEnd({ row: rowIndex - 1, col: colIndex });
        }
      }
    } else if (e.key === "ArrowLeft") {
      const target = e.target as HTMLInputElement;
      const isBoundary = target instanceof HTMLInputElement && target.type === "text"
        ? (target.selectionStart === 0 && target.selectionEnd === 0)
        : true;
        
      if (isBoundary || e.shiftKey) {
        if (colIndex > 0) {
          e.preventDefault();
          focusInput(rowIndex, colIndex - 1);
          if (e.shiftKey) {
            if (!selectionStartRef.current) setSelectionStart({ row: rowIndex, col: colIndex });
            setSelectionEnd((prev) => prev ? { row: prev.row, col: Math.max(0, prev.col - 1) } : { row: rowIndex, col: colIndex - 1 });
          } else {
            setSelectionStart({ row: rowIndex, col: colIndex - 1 });
            setSelectionEnd({ row: rowIndex, col: colIndex - 1 });
          }
        }
      }
    } else if (e.key === "ArrowRight") {
      const target = e.target as HTMLInputElement;
      const isBoundary = target instanceof HTMLInputElement && target.type === "text"
        ? (target.selectionStart === target.value.length && target.selectionEnd === target.value.length)
        : true;

      if (isBoundary || e.shiftKey) {
        if (colIndex < maxCols - 1) {
          e.preventDefault();
          focusInput(rowIndex, colIndex + 1);
          if (e.shiftKey) {
            if (!selectionStartRef.current) setSelectionStart({ row: rowIndex, col: colIndex });
            setSelectionEnd((prev) => prev ? { row: prev.row, col: Math.min(maxCols - 1, prev.col + 1) } : { row: rowIndex, col: colIndex + 1 });
          } else {
            setSelectionStart({ row: rowIndex, col: colIndex + 1 });
            setSelectionEnd({ row: rowIndex, col: colIndex + 1 });
          }
        }
      }
    }
  }, [handleUndo]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text");
    if (!text) return;

    const pastedRows = text.split(/\r?\n/).map((line) => line.split("\t"));
    
    pushHistory(rowsRef.current);
    armedRef.current = true;

    let defaultOU = "/";
    if (defaultOrgUnitPath && defaultOrgUnitPath !== "all") {
      defaultOU = defaultOrgUnitPath;
    } else if (orgUnits.length > 0) {
      const studentOU = orgUnits.find((ou) => ou.orgUnitPath.startsWith("/학생"));
      defaultOU = studentOU ? studentOU.orgUnitPath : orgUnits[0].orgUnitPath;
    }

    setRows((prevRows) => {
      let nextRows = [...prevRows];

      const requiredRows = rowIndex + pastedRows.length;
      if (requiredRows > nextRows.length) {
        const extraCount = requiredRows - nextRows.length;
        const newRows: SheetRow[] = Array.from({ length: extraCount }).map(() => ({
          id: `new_${Math.random().toString(36).substr(2, 9)}_${Math.random().toString(36).substr(2, 9)}`,
          isNew: true,
          isModified: false,
          familyName: "",
          givenName: "",
          emailPrefix: "",
          orgUnitPath: defaultOU,
          password: "",
          changePasswordAtNextLogin: true,
          suspended: false,
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

          if (fieldName === "suspended" || fieldName === "changePasswordAtNextLogin") {
            (row as any)[fieldName] = ["true", "y", "yes", "예", "1", "o", "true"].includes(rawVal.toLowerCase());
          } else {
            (row as any)[fieldName] = rawVal;
          }
        }
        row.isModified = !row.isNew;
        validateRow(row);
        nextRows[targetRowIdx] = row;
      }

      return nextRows;
    });
  }, [defaultOrgUnitPath, orgUnits, pushHistory]);

  // Global listeners for mouse move, mouse up, and keyboard Ctrl+Z
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDraggingSelectionRef.current) {
        window.getSelection()?.removeAllRanges();
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDraggingSelectionRef.current) {
        setIsDraggingSelection(false);
      }
      if (isDraggingFillRef.current) {
        setIsDraggingFill(false);
        executeDragFill();
      }
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [executeDragFill, handleUndo]);

  // Initialize sheet rows from props
  useEffect(() => {
    const initialRows: SheetRow[] = users.map((u) => ({
      id: u.id,
      isNew: false,
      isModified: false,
      originalEmail: u.primaryEmail,
      familyName: u.name.familyName || "",
      givenName: u.name.givenName || "",
      emailPrefix: u.primaryEmail.split("@")[0] || "",
      orgUnitPath: u.orgUnitPath || "/",
      password: "",
      changePasswordAtNextLogin: false,
      suspended: !!u.suspended,
    }));
    setRows(initialRows);
  }, [users]);

  // Add new empty rows for bulk creation
  const handleAddRow = useCallback(() => {
    const input = prompt("추가할 계정 행(Row)의 개수를 입력해 주세요. (예: 10 또는 100)", "1");
    if (input === null) return;
    
    let count = parseInt(input.trim(), 10);
    if (isNaN(count) || count <= 0) {
      alert("유효한 숫자를 입력해 주세요.");
      return;
    }
    
    if (count > 300) {
      if (!confirm("한 번에 300개 이상의 행을 추가하면 브라우저가 느려질 수 있습니다. 그래도 진행하시겠습니까?")) {
        return;
      }
    }

    let defaultOU = "/";
    if (defaultOrgUnitPath && defaultOrgUnitPath !== "all") {
      defaultOU = defaultOrgUnitPath;
    } else if (orgUnits.length > 0) {
      const studentOU = orgUnits.find((ou) => ou.orgUnitPath.startsWith("/학생"));
      defaultOU = studentOU ? studentOU.orgUnitPath : orgUnits[0].orgUnitPath;
    }
    const newRows: SheetRow[] = Array.from({ length: count }).map(() => ({
      id: `new_${Math.random().toString(36).substr(2, 9)}_${Math.random().toString(36).substr(2, 9)}`,
      isNew: true,
      isModified: false,
      familyName: "",
      givenName: "",
      emailPrefix: "",
      orgUnitPath: defaultOU,
      password: "",
      changePasswordAtNextLogin: true,
      suspended: false,
    }));
    pushHistory(rowsRef.current);
    armedRef.current = true;
    setRows((prev) => [...prev, ...newRows]);
  }, [defaultOrgUnitPath, orgUnits, pushHistory]);

  // Spec B: handleRemoveRow with useCallback
  const handleRemoveRow = useCallback((id: string, index: number) => {
    const row = rowsRef.current[index];
    if (row && row.isNew) {
      pushHistory(rowsRef.current);
      armedRef.current = true;
      setRows((prev) => prev.filter((r) => r.id !== id));
    }
  }, [pushHistory]);

  // Fill Down: Copies the target cell value down to all rows below it
  const handleFillDownFrom = useCallback((startIndex: number, field: keyof SheetRow) => {
    const currentRows = rowsRef.current;
    if (currentRows.length <= startIndex + 1) return;
    const baseValue = currentRows[startIndex][field];

    pushHistory(currentRows);
    armedRef.current = true;
    setRows((prev) =>
      prev.map((row, idx) => {
        if (idx <= startIndex) return row;
        const updatedRow = {
          ...row,
          [field]: baseValue,
          isModified: !row.isNew,
        };
        validateRow(updatedRow);
        return updatedRow;
      })
    );
  }, [pushHistory]);

  // Auto-increment: Increments numeric suffixes in a text column starting from the target row down
  const handleAutoIncrementFrom = useCallback((startIndex: number, field: keyof SheetRow) => {
    const currentRows = rowsRef.current;
    if (currentRows.length <= startIndex + 1) return;
    const baseValue = String(currentRows[startIndex][field] || "");
    
    const match = baseValue.match(/(\d+)$/);
    if (!match) {
      alert("기준 셀의 값에 숫자가 포함되어 있어야 순차 채우기가 가능합니다. (예: 25001)");
      return;
    }

    const baseNumberStr = match[1];
    const baseNumber = parseInt(baseNumberStr, 10);
    const prefix = baseValue.substring(0, baseValue.length - baseNumberStr.length);
    const padLength = baseNumberStr.length;

    pushHistory(currentRows);
    armedRef.current = true;
    setRows((prev) =>
      prev.map((row, idx) => {
        if (idx <= startIndex) return row;
        
        const offset = idx - startIndex;
        const currentNum = baseNumber + offset;
        const paddedNum = String(currentNum).padStart(padLength, "0");
        const incrementalValue = `${prefix}${paddedNum}`;

        const updatedRow = {
          ...row,
          [field]: field === "suspended" || field === "changePasswordAtNextLogin" || field === "isNew" || field === "isModified" ? row[field] : incrementalValue,
          isModified: !row.isNew,
        };
        validateRow(updatedRow);
        return updatedRow;
      })
    );
  }, [pushHistory]);

  // Save changes by separating modifications & additions and sending to batch API
  const handleSaveChanges = async () => {
    const activeRows = rows.filter((r) => {
      if (r.isNew) {
        const isCompletelyEmpty =
          !r.familyName.trim() &&
          !r.givenName.trim() &&
          !r.emailPrefix.trim() &&
          !r.password?.trim();
        return !isCompletelyEmpty;
      }
      return true;
    });

    const validatedRows = activeRows.map((r) => {
      const copy = { ...r };
      validateRow(copy);
      return copy;
    });

    const hasErrors = validatedRows.some((r) => r.error);
    if (hasErrors) {
      setRows((prev) =>
        prev.map((originalRow) => {
          const matchingValidated = validatedRows.find((v) => v.id === originalRow.id);
          if (matchingValidated) {
            return matchingValidated;
          }
          return originalRow;
        })
      );
      alert("시트에 입력 에러가 표시되어 있습니다. 빨간색 테두리와 에러 안내를 확인하고 수정해 주세요.");
      return;
    }

    const creates = validatedRows
      .filter((r) => r.isNew)
      .map((r) => ({
        email: `${r.emailPrefix.trim()}@${domain}`,
        firstName: r.givenName.trim(),
        lastName: r.familyName.trim(),
        orgUnitPath: r.orgUnitPath,
        password: r.password,
        changePasswordAtNextLogin: r.changePasswordAtNextLogin,
      }));

    const updates = validatedRows
      .filter((r) => !r.isNew && (r.isModified || `${r.emailPrefix.trim()}@${domain}` !== r.originalEmail || r.password));

    const mappedUpdates = updates.map((r) => {
      const updatePayload: any = {
        firstName: r.givenName.trim(),
        lastName: r.familyName.trim(),
        orgUnitPath: r.orgUnitPath,
        suspended: r.suspended,
      };
      if (r.password && r.password.trim().length >= 8) {
        updatePayload.password = r.password.trim();
        updatePayload.changePasswordAtNextLogin = r.changePasswordAtNextLogin;
      }
      const newEmail = `${r.emailPrefix.trim()}@${domain}`;
      if (newEmail !== r.originalEmail) {
        updatePayload.primaryEmail = newEmail;
      }
      return {
        email: r.originalEmail!,
        updates: updatePayload,
      };
    });

    if (creates.length === 0 && mappedUpdates.length === 0) {
      alert("수정되거나 새로 추가된 계정이 없습니다.");
      return;
    }

    if (
      !confirm(
        `변경사항을 구글 워크스페이스에 저장하시겠습니까?\n- 신규 생성: ${creates.length}건\n- 기존 수정: ${mappedUpdates.length}건`
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspace/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_save",
          creates,
          updates: mappedUpdates,
          operatorEmail: user?.email || userData?.email || "unknown@domain.com",
          operatorName: user?.displayName || user?.email?.split("@")[0] || "관리자",
        }),
      });

      const data = await res.json();
      if (res.ok) {
        if (data.createFailures?.length > 0 || data.updateFailures?.length > 0) {
          const createErrMsgs = (data.createFailures || []).map((f: any) => `[생성실패] ${f.email}: ${f.reason}`).join("\n");
          const updateErrMsgs = (data.updateFailures || []).map((f: any) => `[수정실패] ${f.email}: ${f.reason}`).join("\n");
          alert(`일부 저장 처리 실패:\n${createErrMsgs}\n${updateErrMsgs}`);
        } else {
          alert("모든 변경사항이 구글 워크스페이스에 실시간으로 성공 반영되었습니다!");
        }
        onSave();
      } else {
        throw new Error(data.error || "일괄 저장에 실패했습니다.");
      }
    } catch (err: any) {
      console.error(err);
      alert(`에러 발생: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelWithWarning = () => {
    const hasUnsavedChanges = rows.some(
      (r) => r.isNew || r.isModified || (r.password && r.password.trim().length > 0)
    );
    if (hasUnsavedChanges) {
      if (
        !confirm(
          "저장하지 않은 변경사항이 있습니다. 정말로 일반 뷰로 전환하시겠습니까?\n(작성 중이거나 수정한 내용은 저장되지 않고 소실됩니다.)"
        )
      ) {
        return;
      }
    }
    onCancel();
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Spreadsheet Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            📊 웹 시트 일괄 편집기
          </h3>
          <p className="text-xs text-slate-500">
            성과 이름, 아이디, 비밀번호 등을 표 형식으로 한 번에 수정한 뒤 일괄 저장할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAddRow}
            disabled={isSubmitting}
            className="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
          >
            ➕ 행 추가 (새 계정 작성)
          </button>
          
          <button
            type="button"
            onClick={handleCancelWithWarning}
            disabled={isSubmitting}
            className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
          >
            일반 뷰로 전환
          </button>

          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={isSubmitting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-md transition-colors shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? "일괄 저장 중..." : "💾 변경사항 저장"}
          </button>
        </div>
      </div>

      {/* Spreadsheet Sheet Grid Container */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[500px]">
        <table className="min-w-full divide-y divide-slate-200 text-xs border-collapse">
          {/* Sheet Column Headers */}
          <thead className="bg-slate-100 sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-center text-slate-500 w-12 select-none font-bold border-r border-slate-200">No</th>
              
              {/* Family Name */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-40 border-r border-slate-200">
                <span>성 (Family)*</span>
              </th>

              {/* Given Name */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-40 border-r border-slate-200">
                <span>이름 (Given)*</span>
              </th>

              {/* Google ID Prefix */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-64 border-r border-slate-200">
                <span>구글 아이디 (ID)*</span>
              </th>

              {/* Org Unit Path */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-52 border-r border-slate-200">
                <span>조직단위 (OU)*</span>
              </th>

              {/* Password */}
              <th className="px-3 py-3 text-left font-semibold text-slate-700 w-44 border-r border-slate-200">
                <span>비밀번호 (8자 이상)</span>
              </th>

              {/* Change Password checkbox */}
              <th
                className="px-3 py-2 text-center font-semibold text-slate-700 w-28 border-r border-slate-200 cursor-help"
                title="최초 로그인 시 비밀번호를 변경하도록 안내합니다"
              >
                <div className="flex flex-col gap-1 items-center">
                  <span>비번 변경 안내 ℹ️</span>
                  <button
                    type="button"
                    onClick={() => handleFillDownFrom(0, "changePasswordAtNextLogin")}
                    className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium px-1.5 py-0.5 rounded text-center transition-colors"
                    title="첫 번째 행 체크 상태를 아래로 복사"
                  >
                    아래로 복사
                  </button>
                </div>
              </th>

              {/* Suspend status */}
              <th className="px-3 py-2 text-center font-semibold text-slate-700 w-24 border-r border-slate-200">
                <div className="flex flex-col gap-1 items-center">
                  <span>계정 정지</span>
                  <button
                    type="button"
                    onClick={() => handleFillDownFrom(0, "suspended")}
                    className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium px-1.5 py-0.5 rounded text-center transition-colors"
                    title="첫 번째 행의 정지 여부를 아래로 복사"
                  >
                    아래로 복사
                  </button>
                </div>
              </th>

              <th className="px-3 py-3 text-center text-slate-500 w-16">삭제</th>
            </tr>
          </thead>

          {/* Sheet Cells Body */}
          <tbody className="bg-white divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                  표시할 데이터가 없습니다. 상단의 <strong>[행 추가]</strong>를 눌러 신규 계정을 등록해 보세요.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                return (
                  <SheetRowMemo
                    key={row.id}
                    row={row}
                    index={index}
                    domain={domain}
                    orgUnits={orgUnits}
                    selectionBounds={selectionBounds}
                    fillInfo={fillInfo}
                    onMouseDown={handleMouseDown}
                    onMouseEnter={handleMouseEnter}
                    onFillMouseDown={handleFillMouseDown}
                    onFillDoubleClick={handleFillDoubleClick}
                    onCellChange={handleCellChange}
                    onCellFocus={handleCellFocus}
                    onCellBlur={handleCellBlur}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onRemoveRow={handleRemoveRow}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Row Error / Status info */}
      {rows.some((r) => r.error) && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-800 text-xs">
          ⚠️ <strong>일부 셀에 입력 에러가 발견되었습니다:</strong>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            {rows
              .filter((r) => r.error)
              .map((r, i) => (
                <li key={i}>
                  {i + 1}행 ({r.familyName}{r.givenName || "이름없음"}): {r.error}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
