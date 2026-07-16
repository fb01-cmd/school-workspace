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

// ─── Item Modal (Add & Edit) ────────────────────────────────────────────────

interface ItemModalProps {
  mode: "add" | "edit";
  type: "bookmark" | "folder";
  initialName?: string;
  initialUrl?: string;
  onConfirm: (name: string, url?: string) => void;
  onCancel: () => void;
}

function ItemModal({ mode, type, initialName = "", initialUrl = "https://", onConfirm, onCancel }: ItemModalProps) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl || "https://");
  const isBookmark = type === "bookmark";
  const isEdit = mode === "edit";

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (isBookmark) {
      const trimmedUrl = url.trim();
      if (!trimmedUrl.startsWith("http")) {
        alert("URL은 http:// 또는 https://로 시작해야 합니다.");
        return;
      }
      onConfirm(trimmedName, trimmedUrl);
    } else {
      onConfirm(trimmedName);
    }
  };

  const title = isEdit
    ? (isBookmark ? "북마크 수정" : "폴더 이름 수정")
    : (isBookmark ? "북마크 추가" : "폴더 추가");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <span>{isBookmark ? "🔗" : "📁"}</span>
          {title}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              {isBookmark ? "북마크 이름" : "폴더 이름"}
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleSubmit();
                if (e.key === "Escape") onCancel();
              }}
              placeholder={isBookmark ? "예: 학업성적관리 시스템" : "예: 교무부"}
              className="w-full text-sm text-gray-900 border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
            />
          </div>

          {isBookmark && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">URL 주소</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleSubmit();
                  if (e.key === "Escape") onCancel();
                }}
                placeholder="https://"
                className="w-full text-sm font-mono text-gray-900 border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
              />
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg py-2 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-lg py-2 transition-colors"
          >
            {isEdit ? "저장" : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}




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
  onOpenAddModal: (folderPath: number[], type: "bookmark" | "folder") => void;
  onMove: (from: DragPayload, toPath: number[], pos: DropPos) => void;
}

// ─── Node Component ───────────────────────────────────────────────────────────

function BookmarkNode({ item, path, depth, dropTarget, setDropTarget, onUpdate, onDelete, onOpenAddModal, onMove }: NodeProps) {

  const isFolder = item.children !== undefined;
  const [expanded, setExpanded] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

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
        {/* Edit Modal */}
        {showEditModal && (
          <ItemModal
            mode="edit"
            type={isFolder ? "folder" : "bookmark"}
            initialName={item.name}
            initialUrl={item.url}
            onConfirm={(name, url) => {
              const updates: Partial<BookmarkItem> = { name };
              if (url !== undefined) updates.url = url;
              onUpdate(path, updates);
              setShowEditModal(false);
            }}
            onCancel={() => setShowEditModal(false)}
          />
        )}

        {/* Name & URL */}
        <div className="flex-1 min-w-0">
          <p
            className="text-[13px] font-semibold text-gray-900 truncate leading-tight cursor-pointer"
            onClick={() => isFolder && setExpanded(v => !v)}
            onDoubleClick={e => { e.stopPropagation(); setShowEditModal(true); }}
            title={item.name}
          >
            {item.name}
          </p>

          {!isFolder && (
            <p
              className="text-[11px] text-gray-400 truncate font-mono leading-tight mt-px hover:text-blue-500 cursor-text"
              onDoubleClick={e => { e.stopPropagation(); setShowEditModal(true); }}
              title={item.url}
            >
              {item.url || "URL 없음"}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={e => { e.stopPropagation(); setShowEditModal(true); }}
            className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[11px] transition-colors" title="수정">✏️</button>
          {isFolder && <>
            <button onClick={e => { e.stopPropagation(); onOpenAddModal(path, "bookmark"); setExpanded(true); }}
              className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[11px] transition-colors" title="폴더 안에 북마크 추가">🔗+</button>
            <button onClick={e => { e.stopPropagation(); onOpenAddModal(path, "folder"); setExpanded(true); }}
              className="p-1 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 text-[11px] transition-colors" title="폴더 안에 하위 폴더 추가">📁+</button>
          </>}
          <button
            onClick={e => {
              e.stopPropagation();
              const label = isFolder ? `폴더 "${item.name}" (하위 항목 포함)` : `"${item.name}"`;
              if (window.confirm(`${label}을(를) 삭제하시겠습니까?\n\n저장 버튼을 누르기 전까지는 실제 반영되지 않습니다.`)) {
                onDelete(path);
              }
            }}
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
              onOpenAddModal={onOpenAddModal}
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

interface ModalState {
  open: boolean;
  type: "bookmark" | "folder";
  folderPath: number[] | null; // null = root level
}

export default function BookmarkTreeEditor({ items, onChange }: BookmarkTreeEditorProps) {
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [modal, setModal] = useState<ModalState>({ open: false, type: "bookmark", folderPath: null });

  const openAddModal = (folderPath: number[] | null, type: "bookmark" | "folder") =>
    setModal({ open: true, type, folderPath });

  const closeModal = () => setModal(s => ({ ...s, open: false }));

  const handleModalConfirm = (name: string, url?: string) => {
    const newItem: BookmarkItem = url !== undefined
      ? { name, url }
      : { name, children: [] };

    if (modal.folderPath === null) {
      onChange([...deepClone(items), deepClone(newItem)]);
    } else {
      onChange(appendToFolder(items, modal.folderPath, newItem));
    }
    closeModal();
  };

  const handleUpdate = (path: number[], updates: Partial<BookmarkItem>) =>
    onChange(updateAtPath(items, path, updates));

  const handleDelete = (path: number[]) => {
    const [newItems] = removeAtPath(items, path);
    onChange(newItems);
  };

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
      {/* Add Item Modal */}
      {modal.open && (
        <ItemModal
          mode="add"
          type={modal.type}
          onConfirm={handleModalConfirm}
          onCancel={closeModal}
        />

      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button type="button" onClick={() => openAddModal(null, "bookmark")}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm">
          🔗 북마크 추가
        </button>
        <button type="button" onClick={() => openAddModal(null, "folder")}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors shadow-sm">
          📁 폴더 추가
        </button>
        {items.length > 0 && (
          <span className="ml-auto text-[11px] text-gray-400">
            총 {items.length}개 항목 · 폴더 클릭 시 열림 · ✏️ 버튼으로 수정 · 드래그로 순서 변경
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
              onOpenAddModal={openAddModal}
              onMove={handleMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}


