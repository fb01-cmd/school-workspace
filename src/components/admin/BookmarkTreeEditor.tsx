"use client";

import { useState, useRef } from "react";

export interface BookmarkItem {
  name: string;
  url?: string;
  children?: BookmarkItem[];
}

// ─── Tree Helpers ─────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function removeAtPath(items: BookmarkItem[], path: number[]): [BookmarkItem[], BookmarkItem | null] {
  const clone = deepClone(items);
  const [h, ...tail] = path;
  if (tail.length === 0) {
    const removed = clone.splice(h, 1)[0] ?? null;
    return [clone, removed];
  }
  const parent = clone[h];
  if (!parent?.children) return [clone, null];
  const [newChildren, removed] = removeAtPath(parent.children, tail);
  parent.children = newChildren;
  return [clone, removed];
}

function insertAtPath(items: BookmarkItem[], path: number[], item: BookmarkItem): BookmarkItem[] {
  const clone = deepClone(items);
  const [h, ...tail] = path;
  if (tail.length === 0) {
    clone.splice(h, 0, deepClone(item));
    return clone;
  }
  const parent = clone[h];
  if (!parent) return clone;
  if (!parent.children) parent.children = [];
  parent.children = insertAtPath(parent.children, tail, item);
  return clone;
}

function updateAtPath(items: BookmarkItem[], path: number[], updates: Partial<BookmarkItem>): BookmarkItem[] {
  const clone = deepClone(items);
  const [h, ...tail] = path;
  if (tail.length === 0) {
    clone[h] = { ...clone[h], ...updates };
    return clone;
  }
  const parent = clone[h];
  if (!parent?.children) return clone;
  parent.children = updateAtPath(parent.children, tail, updates);
  return clone;
}

function appendToFolder(items: BookmarkItem[], folderPath: number[], newItem: BookmarkItem): BookmarkItem[] {
  if (folderPath.length === 0) return [...deepClone(items), deepClone(newItem)];
  const clone = deepClone(items);
  const [h, ...tail] = folderPath;
  if (tail.length === 0) {
    if (!clone[h].children) clone[h].children = [];
    clone[h].children!.push(deepClone(newItem));
    return clone;
  }
  const parent = clone[h];
  if (!parent?.children) return clone;
  parent.children = appendToFolder(parent.children, tail, newItem);
  return clone;
}

// ─── Module-level drag state (synchronous — avoids React async issues) ────────

type DragPayload = { path: number[]; item: BookmarkItem };
let _drag: DragPayload | null = null;

// ─── Types ────────────────────────────────────────────────────────────────────

type DropPos = "before" | "after" | "into";
type DropTarget = { pathStr: string; pos: DropPos } | null;

interface NodeProps {
  item: BookmarkItem;
  path: number[];
  depth: number;
  dropTarget: DropTarget;
  setDropTarget: (dt: DropTarget) => void;
  onUpdate: (path: number[], u: Partial<BookmarkItem>) => void;
  onDelete: (path: number[]) => void;
  onAdd: (folderPath: number[], item: BookmarkItem) => void;
  onMove: (from: DragPayload, toPath: number[], pos: DropPos) => void;
}

// ─── Node Component ───────────────────────────────────────────────────────────

function BookmarkNode({ item, path, depth, dropTarget, setDropTarget, onUpdate, onDelete, onAdd, onMove }: NodeProps) {
  const isFolder = item.children !== undefined;
  const [expanded, setExpanded] = useState(false);
  const [editName, setEditName] = useState(false);
  const [editUrl, setEditUrl] = useState(false);
  const [tmpName, setTmpName] = useState(item.name);
  const [tmpUrl, setTmpUrl] = useState(item.url || "");

  const rowRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathStr = path.join("-");

  const isSelf = _drag?.path.join("-") === pathStr;
  const isDropBefore = dropTarget?.pathStr === pathStr && dropTarget.pos === "before";
  const isDropAfter  = dropTarget?.pathStr === pathStr && dropTarget.pos === "after";
  const isDropInto   = dropTarget?.pathStr === pathStr && dropTarget.pos === "into";

  // Clear hover-expand timer
  const clearHoverTimer = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };


  const handleDragStart = (e: React.DragEvent) => {
    _drag = { path, item };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", pathStr);
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!_drag) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (e.clientY - rect.top) / rect.height;

    let pos: DropPos;
    // Allow "into" for ALL folders (expanded or not) when hovering middle zone
    if (isFolder && ratio > 0.25 && ratio < 0.75) {
      pos = "into";
      // Auto-expand collapsed folders after 650ms hover
      if (!expanded && !hoverTimer.current) {
        hoverTimer.current = setTimeout(() => {
          setExpanded(true);
          hoverTimer.current = null;
        }, 650);
      }
    } else {
      clearHoverTimer();
      pos = ratio < 0.5 ? "before" : "after";
    }
    setDropTarget({ pathStr, pos });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!rowRef.current?.contains(e.relatedTarget as Node)) {
      clearHoverTimer();
      setDropTarget(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const drag = _drag;
    if (!drag || !dropTarget || dropTarget.pathStr !== pathStr) return;
    onMove(drag, path, dropTarget.pos);
    setDropTarget(null);
    _drag = null;
  };

  const commitName = () => {
    const n = tmpName.trim();
    if (n) onUpdate(path, { name: n });
    else setTmpName(item.name);
    setEditName(false);
  };

  const commitUrl = () => {
    onUpdate(path, { url: tmpUrl.trim() });
    setEditUrl(false);
  };

  return (
    <div className={isSelf ? "opacity-30" : ""}>
      {isDropBefore && <div className="h-0.5 bg-indigo-500 rounded-full mx-2 my-0.5 pointer-events-none" />}

      <div
        ref={rowRef}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ paddingLeft: `${depth * 20 + 6}px` }}
        className={[
          "group flex items-center gap-2 py-1.5 pr-2 rounded-lg select-none transition-colors",
          isDropInto ? "ring-2 ring-inset ring-indigo-400 bg-indigo-50" : "hover:bg-gray-50",
        ].join(" ")}
      >
        {/* Drag handle */}
        <span className="text-gray-300 text-xs cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 w-3 flex-shrink-0 text-center leading-none">
          ⠿
        </span>

        {/* Expand toggle */}
        <span
          className="w-3.5 flex-shrink-0 text-[10px] text-gray-400 text-center cursor-pointer"
          onClick={() => isFolder && setExpanded(v => !v)}
        >
          {isFolder ? (expanded ? "▼" : "▶") : ""}
        </span>

        {/* Icon */}
        <span className="text-base flex-shrink-0 cursor-pointer" onClick={() => isFolder && setExpanded(v => !v)}>
          {isFolder ? (expanded ? "📂" : "📁") : "🔗"}
        </span>

        {/* Name & URL */}
        <div className="flex-1 min-w-0">
          {editName ? (
            <input
              autoFocus
              value={tmpName}
              onChange={e => setTmpName(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setTmpName(item.name); setEditName(false); } }}
              onClick={e => e.stopPropagation()}
              className="w-full text-[13px] font-semibold text-gray-900 bg-indigo-50 border-b-2 border-indigo-400 outline-none px-0.5 rounded-sm"
            />
          ) : (
            <p
              className="text-[13px] font-semibold text-gray-900 truncate leading-tight cursor-pointer"
              onClick={() => isFolder && setExpanded(v => !v)}
              onDoubleClick={e => { e.stopPropagation(); setEditName(true); setTmpName(item.name); }}
              title={item.name}
            >
              {item.name}
            </p>
          )}

          {!isFolder && (
            editUrl ? (
              <input
                autoFocus
                value={tmpUrl}
                onChange={e => setTmpUrl(e.target.value)}
                onBlur={commitUrl}
                onKeyDown={e => { if (e.key === "Enter") commitUrl(); if (e.key === "Escape") { setTmpUrl(item.url || ""); setEditUrl(false); } }}
                onClick={e => e.stopPropagation()}
                className="w-full text-[11px] text-blue-600 bg-blue-50 border-b border-blue-400 outline-none mt-0.5 font-mono rounded-sm"
              />
            ) : (
              <p
                className="text-[11px] text-gray-400 truncate font-mono leading-tight mt-px hover:text-blue-500 cursor-text"
                onDoubleClick={e => { e.stopPropagation(); setEditUrl(true); setTmpUrl(item.url || ""); }}
                title={item.url}
              >
                {item.url || "URL 없음 — 더블클릭으로 입력"}
              </p>
            )
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); setEditName(true); setTmpName(item.name); }}
            className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[11px] transition-colors" title="이름 수정">✏️</button>
          {isFolder && <>
            <button onClick={e => { e.stopPropagation(); onAdd(path, { name: "새 북마크", url: "https://" }); setExpanded(true); }}
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[11px] transition-colors" title="폴더 안에 북마크 추가">🔗+</button>
            <button onClick={e => { e.stopPropagation(); onAdd(path, { name: "새 폴더", children: [] }); setExpanded(true); }}
              className="p-1 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 text-[11px] transition-colors" title="폴더 안에 하위 폴더 추가">📁+</button>
          </>}
          <button onClick={e => { e.stopPropagation(); onDelete(path); }}
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 text-[11px] transition-colors" title="삭제">✕</button>
        </div>
      </div>

      {isDropAfter && <div className="h-0.5 bg-indigo-500 rounded-full mx-2 my-0.5 pointer-events-none" />}

      {/* Children */}
      {isFolder && expanded && (
        <div className="border-l border-gray-100 ml-[26px]">
          {(item.children || []).length === 0 && (
            <p className="text-[11px] text-gray-300 pl-5 py-1 italic">빈 폴더 — 우측 버튼으로 추가</p>
          )}
          {(item.children || []).map((child, i) => (
            <BookmarkNode
              key={i}
              item={child}
              path={[...path, i]}
              depth={0}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAdd={onAdd}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Root Editor ──────────────────────────────────────────────────────────────

interface BookmarkTreeEditorProps {
  items: BookmarkItem[];
  onChange: (items: BookmarkItem[]) => void;
}

export default function BookmarkTreeEditor({ items, onChange }: BookmarkTreeEditorProps) {
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const handleUpdate = (path: number[], updates: Partial<BookmarkItem>) =>
    onChange(updateAtPath(items, path, updates));

  const handleDelete = (path: number[]) => {
    const [newItems] = removeAtPath(items, path);
    onChange(newItems);
  };

  const handleAdd = (folderPath: number[], newItem: BookmarkItem) =>
    onChange(appendToFolder(items, folderPath, newItem));

  const handleAddRoot = (newItem: BookmarkItem) =>
    onChange([...deepClone(items), deepClone(newItem)]);

  const handleMove = (from: DragPayload, toPath: number[], pos: DropPos) => {
    const fromStr = from.path.join("-");
    const toStr = toPath.join("-");
    if (toStr === fromStr || toStr.startsWith(fromStr + "-")) return;

    let [newItems, removed] = removeAtPath(items, from.path);
    if (!removed) return;

    let adjusted = [...toPath];
    if (from.path.length === toPath.length) {
      const fp = from.path.slice(0, -1).join("-");
      const tp = toPath.slice(0, -1).join("-");
      if (fp === tp && from.path[from.path.length - 1] < toPath[toPath.length - 1]) {
        adjusted[adjusted.length - 1]--;
      }
    }

    if (pos === "into") {
      newItems = appendToFolder(newItems, adjusted, removed);
    } else if (pos === "before") {
      newItems = insertAtPath(newItems, adjusted, removed);
    } else {
      adjusted[adjusted.length - 1]++;
      newItems = insertAtPath(newItems, adjusted, removed);
    }

    onChange(newItems);
  };

  return (
    <div onDragEnd={() => { setDropTarget(null); _drag = null; }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button type="button" onClick={() => handleAddRoot({ name: "새 북마크", url: "https://" })}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm">
          🔗 북마크 추가
        </button>
        <button type="button" onClick={() => handleAddRoot({ name: "새 폴더", children: [] })}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm">
          📁 폴더 추가
        </button>
        {items.length > 0 && (
          <span className="ml-auto text-[11px] text-gray-400">
            총 {items.length}개 항목 · 폴더 클릭 시 열림 · 이름 더블클릭으로 수정 · 드래그로 순서 변경
          </span>
        )}
      </div>

      {/* Tree */}
      {items.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <p className="text-4xl mb-3">📌</p>
          <p className="text-sm font-medium">등록된 북마크가 없습니다.</p>
          <p className="text-xs text-gray-300 mt-1">위의 버튼을 눌러 시작하세요.</p>
        </div>
      ) : (
        <div className="space-y-px">
          {items.map((item, i) => (
            <BookmarkNode
              key={i}
              item={item}
              path={[i]}
              depth={0}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onMove={handleMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
