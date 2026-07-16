"use client";

import { useState, useRef, useCallback } from "react";

export interface BookmarkItem {
  name: string;
  url?: string;
  children?: BookmarkItem[];
}

// ─── Immutable tree helpers ───────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function removeItemAtPath(items: BookmarkItem[], path: number[]): [BookmarkItem[], BookmarkItem | null] {
  const clone = deepClone(items);
  const [head, ...tail] = path;
  if (tail.length === 0) {
    const removed = clone.splice(head, 1)[0] ?? null;
    return [clone, removed];
  }
  const parent = clone[head];
  if (!parent?.children) return [clone, null];
  const [newChildren, removed] = removeItemAtPath(parent.children, tail);
  parent.children = newChildren;
  return [clone, removed];
}

function insertItemAtPath(items: BookmarkItem[], path: number[], item: BookmarkItem): BookmarkItem[] {
  const clone = deepClone(items);
  const [head, ...tail] = path;
  if (tail.length === 0) {
    clone.splice(head, 0, item);
    return clone;
  }
  const parent = clone[head];
  if (!parent) return clone;
  if (!parent.children) parent.children = [];
  parent.children = insertItemAtPath(parent.children, tail, item);
  return clone;
}

function updateItemAtPath(items: BookmarkItem[], path: number[], updates: Partial<BookmarkItem>): BookmarkItem[] {
  const clone = deepClone(items);
  const [head, ...tail] = path;
  if (tail.length === 0) {
    clone[head] = { ...clone[head], ...updates };
    return clone;
  }
  const parent = clone[head];
  if (!parent?.children) return clone;
  parent.children = updateItemAtPath(parent.children, tail, updates);
  return clone;
}

function addItemToFolder(items: BookmarkItem[], folderPath: number[], newItem: BookmarkItem): BookmarkItem[] {
  if (folderPath.length === 0) {
    return [...deepClone(items), deepClone(newItem)];
  }
  const clone = deepClone(items);
  const [head, ...tail] = folderPath;
  if (tail.length === 0) {
    if (!clone[head].children) clone[head].children = [];
    clone[head].children!.push(deepClone(newItem));
    return clone;
  }
  const parent = clone[head];
  if (!parent?.children) return clone;
  parent.children = addItemToFolder(parent.children, tail, newItem);
  return clone;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DragInfo = { path: number[]; item: BookmarkItem };
type DropPosition = "before" | "after" | "into";
type DropTarget = { path: number[]; position: DropPosition } | null;

// ─── BookmarkNode ─────────────────────────────────────────────────────────────

interface NodeProps {
  item: BookmarkItem;
  path: number[];
  depth: number;
  onUpdate: (path: number[], updates: Partial<BookmarkItem>) => void;
  onDelete: (path: number[]) => void;
  onAdd: (folderPath: number[], item: BookmarkItem) => void;
  onDragStart: (info: DragInfo) => void;
  onDrop: (targetPath: number[], position: DropPosition) => void;
  dragInfo: DragInfo | null;
  dropTarget: DropTarget;
  setDropTarget: (dt: DropTarget) => void;
}

function BookmarkNode({
  item, path, depth,
  onUpdate, onDelete, onAdd,
  onDragStart, onDrop, dragInfo, dropTarget, setDropTarget,
}: NodeProps) {
  const isFolder = item.children !== undefined;
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [tempName, setTempName] = useState(item.name);
  const [tempUrl, setTempUrl] = useState(item.url || "");

  const nodeRef = useRef<HTMLDivElement>(null);
  const pathStr = path.join(",");
  const isDragging = dragInfo?.path.join(",") === pathStr;
  const isDropBefore = dropTarget?.path.join(",") === pathStr && dropTarget.position === "before";
  const isDropAfter = dropTarget?.path.join(",") === pathStr && dropTarget.position === "after";
  const isDropInto = dropTarget?.path.join(",") === pathStr && dropTarget.position === "into";

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    onDragStart({ path, item });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const rect = nodeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (isFolder && expanded && y > h * 0.3 && y < h * 0.7) {
      setDropTarget({ path, position: "into" });
    } else if (y < h / 2) {
      setDropTarget({ path, position: "before" });
    } else {
      setDropTarget({ path, position: "after" });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropTarget) onDrop(dropTarget.path, dropTarget.position);
  };

  const commitName = () => {
    if (tempName.trim()) onUpdate(path, { name: tempName.trim() });
    else setTempName(item.name);
    setEditingName(false);
  };

  const commitUrl = () => {
    onUpdate(path, { url: tempUrl.trim() });
    setEditingUrl(false);
  };

  return (
    <div className={`transition-opacity ${isDragging ? "opacity-30 pointer-events-none" : ""}`}>
      {/* Drop indicator: before */}
      {isDropBefore && <div className="h-0.5 bg-indigo-500 rounded-full mx-1 my-px" />}

      {/* Row */}
      <div
        ref={nodeRef}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={(e) => {
          if (!nodeRef.current?.contains(e.relatedTarget as Node)) setDropTarget(null);
        }}
        style={{ paddingLeft: `${depth * 18 + 4}px` }}
        className={`group flex items-center gap-2 py-1.5 pr-2 rounded-md cursor-default
          ${isDropInto ? "ring-2 ring-inset ring-indigo-400 bg-indigo-50/60" : "hover:bg-gray-50"}
          transition-colors`}
      >
        {/* Drag handle */}
        <span className="text-gray-300 text-[11px] cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity w-3 flex-shrink-0 text-center leading-none select-none">
          ⠿
        </span>

        {/* Expand arrow */}
        <span
          className="w-3.5 flex-shrink-0 text-center text-[10px] text-gray-400 cursor-pointer select-none"
          onClick={() => isFolder && setExpanded((v) => !v)}
        >
          {isFolder ? (expanded ? "▼" : "▶") : ""}
        </span>

        {/* Icon */}
        <span className="text-base flex-shrink-0 select-none cursor-pointer" onClick={() => isFolder && setExpanded((v) => !v)}>
          {isFolder ? (expanded ? "📂" : "📁") : "🔗"}
        </span>

        {/* Name + URL */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => isFolder && !editingName && setExpanded((v) => !v)}>
          {editingName ? (
            <input
              autoFocus
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") { setTempName(item.name); setEditingName(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[13px] font-semibold text-gray-900 bg-indigo-50 border-b-2 border-indigo-400 outline-none px-0.5"
            />
          ) : (
            <p
              className="text-[13px] font-semibold text-gray-900 truncate leading-tight"
              onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true); setTempName(item.name); }}
              title={item.name}
            >
              {item.name}
            </p>
          )}
          {!isFolder && (
            editingUrl ? (
              <input
                autoFocus
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
                onBlur={commitUrl}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitUrl();
                  if (e.key === "Escape") { setTempUrl(item.url || ""); setEditingUrl(false); }
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-[11px] text-blue-600 bg-blue-50 border-b border-blue-400 outline-none mt-0.5 font-mono"
              />
            ) : (
              <p
                className="text-[11px] text-gray-400 truncate font-mono leading-tight mt-px hover:text-blue-500 cursor-text"
                onDoubleClick={(e) => { e.stopPropagation(); setEditingUrl(true); setTempUrl(item.url || ""); }}
                title={item.url}
              >
                {item.url || "URL 없음 (더블클릭하여 입력)"}
              </p>
            )
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setEditingName(true); setTempName(item.name); }}
            className="p-1 text-[11px] text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
            title="이름 수정 (더블클릭도 가능)"
          >
            ✏️
          </button>
          {isFolder && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onAdd(path, { name: "새 북마크", url: "https://" }); setExpanded(true); }}
                className="p-1 text-[11px] text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                title="이 폴더 안에 북마크 추가"
              >
                🔗+
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onAdd(path, { name: "새 폴더", children: [] }); setExpanded(true); }}
                className="p-1 text-[11px] text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                title="이 폴더 안에 하위 폴더 추가"
              >
                📁+
              </button>
            </>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(path); }}
            className="p-1 text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="삭제"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Drop indicator: after */}
      {isDropAfter && <div className="h-0.5 bg-indigo-500 rounded-full mx-1 my-px" />}

      {/* Children */}
      {isFolder && expanded && (
        <div className="border-l border-gray-100 ml-[22px]">
          {(item.children || []).length === 0 && (
            <p className="text-[11px] text-gray-300 pl-6 py-1 italic">빈 폴더</p>
          )}
          {(item.children || []).map((child, i) => (
            <BookmarkNode
              key={i}
              item={child}
              path={[...path, i]}
              depth={0}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAdd={onAdd}
              onDragStart={onDragStart}
              onDrop={onDrop}
              dragInfo={dragInfo}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── BookmarkTreeEditor (root) ────────────────────────────────────────────────

interface BookmarkTreeEditorProps {
  items: BookmarkItem[];
  onChange: (items: BookmarkItem[]) => void;
}

export default function BookmarkTreeEditor({ items, onChange }: BookmarkTreeEditorProps) {
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const handleUpdate = useCallback((path: number[], updates: Partial<BookmarkItem>) => {
    onChange(updateItemAtPath(items, path, updates));
  }, [items, onChange]);

  const handleDelete = useCallback((path: number[]) => {
    const [newItems] = removeItemAtPath(items, path);
    onChange(newItems);
  }, [items, onChange]);

  const handleAdd = useCallback((folderPath: number[], newItem: BookmarkItem) => {
    onChange(addItemToFolder(items, folderPath, newItem));
  }, [items, onChange]);

  const handleAddRoot = useCallback((newItem: BookmarkItem) => {
    onChange([...deepClone(items), deepClone(newItem)]);
  }, [items, onChange]);

  const handleDrop = useCallback((targetPath: number[], position: DropPosition) => {
    if (!dragInfo) return;
    const dragStr = dragInfo.path.join(",");
    const targetStr = targetPath.join(",");

    // Prevent dropping onto itself or own descendants
    if (targetStr === dragStr || targetStr.startsWith(dragStr + ",")) {
      setDragInfo(null); setDropTarget(null); return;
    }

    let [newItems, removed] = removeItemAtPath(items, dragInfo.path);
    if (!removed) { setDragInfo(null); setDropTarget(null); return; }

    // Adjust target index if dragged item was before target at same depth
    let adjusted = [...targetPath];
    const sameDepth = dragInfo.path.length === targetPath.length;
    if (sameDepth) {
      const dragParent = dragInfo.path.slice(0, -1).join(",");
      const targetParent = targetPath.slice(0, -1).join(",");
      const dragIdx = dragInfo.path[dragInfo.path.length - 1];
      const targetIdx = targetPath[targetPath.length - 1];
      if (dragParent === targetParent && dragIdx < targetIdx) {
        adjusted[adjusted.length - 1]--;
      }
    }

    if (position === "into") {
      newItems = addItemToFolder(newItems, adjusted, removed);
    } else if (position === "before") {
      newItems = insertItemAtPath(newItems, adjusted, removed);
    } else {
      adjusted[adjusted.length - 1]++;
      newItems = insertItemAtPath(newItems, adjusted, removed);
    }

    onChange(newItems);
    setDragInfo(null); setDropTarget(null);
  }, [dragInfo, items, onChange]);

  // Handle drop on root area (between top-level items or at end)
  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragInfo && dropTarget) {
      handleDrop(dropTarget.path, dropTarget.position);
    }
  };

  return (
    <div>
      {/* Root-level toolbar */}
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => handleAddRoot({ name: "새 북마크", url: "https://" })}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
        >
          🔗 북마크 추가
        </button>
        <button
          type="button"
          onClick={() => handleAddRoot({ name: "새 폴더", children: [] })}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm"
        >
          📁 폴더 추가
        </button>
        {items.length > 0 && (
          <span className="ml-auto text-[11px] text-gray-400 self-center">
            총 {items.length}개 항목 · 폴더를 클릭하면 열립니다 · 이름 더블클릭으로 수정
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
        <div
          className="space-y-px"
          onDragEnd={() => { setDragInfo(null); setDropTarget(null); }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleRootDrop}
        >
          {items.map((item, i) => (
            <BookmarkNode
              key={i}
              item={item}
              path={[i]}
              depth={0}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onDragStart={setDragInfo}
              onDrop={handleDrop}
              dragInfo={dragInfo}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}
