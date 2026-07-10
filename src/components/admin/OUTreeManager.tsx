"use client";

import { useState } from "react";

interface OU {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
}

interface TreeNode {
  name: string;
  path: string;
  children: Record<string, TreeNode>;
}

function buildTree(orgUnits: OU[]): TreeNode {
  const root: TreeNode = { name: "/", path: "/", children: {} };
  const sorted = [...orgUnits].sort((a, b) =>
    a.orgUnitPath.localeCompare(b.orgUnitPath)
  );
  for (const ou of sorted) {
    const parts = ou.orgUnitPath.split("/").filter(Boolean);
    let current = root;
    let builtPath = "";
    for (const part of parts) {
      builtPath += "/" + part;
      if (!current.children[part]) {
        current.children[part] = { name: part, path: builtPath, children: {} };
      }
      current = current.children[part];
    }
  }
  return root;
}

interface OUTreeManagerProps {
  orgUnits: OU[];
  onRename: (orgUnitPath: string, newName: string) => Promise<void>;
  onDelete: (orgUnitPath: string) => Promise<void>;
  onRefresh: () => void;
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  onRename: (orgUnitPath: string, newName: string) => Promise<void>;
  onDelete: (orgUnitPath: string) => Promise<void>;
  editingOUPath: string | null;
  editingOUName: string;
  savingEdit: boolean;
  deletingOUPath: string | null;
  onStartEdit: (path: string, name: string) => void;
  onCancelEdit: () => void;
  onEditNameChange: (name: string) => void;
  onSaveEdit: (path: string) => void;
  onConfirmDelete: (path: string) => void;
}

function TreeNodeRow({
  node,
  depth,
  onRename,
  onDelete,
  editingOUPath,
  editingOUName,
  savingEdit,
  deletingOUPath,
  onStartEdit,
  onCancelEdit,
  onEditNameChange,
  onSaveEdit,
  onConfirmDelete,
}: TreeNodeRowProps) {
  const hasChildren = Object.keys(node.children).length > 0;
  const [expanded, setExpanded] = useState(depth < 2); // auto-expand first two levels

  const isEditing = editingOUPath === node.path;
  const isDeleting = deletingOUPath === node.path;

  const childNodes = Object.values(node.children).sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  return (
    <>
      <tr className="hover:bg-gray-50 group">
        <td className="px-4 py-2">
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: `${depth * 20}px` }}
          >
            {/* Expand/collapse toggle */}
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-600"
            >
              {hasChildren ? (
                <span className="text-xs">{expanded ? "▼" : "▶"}</span>
              ) : (
                <span className="text-xs text-gray-300">•</span>
              )}
            </button>

            {/* Path / edit input */}
            {isEditing ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={editingOUName}
                  onChange={(e) => onEditNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveEdit(node.path);
                    if (e.key === "Escape") onCancelEdit();
                  }}
                  autoFocus
                  className="px-2 py-0.5 border border-indigo-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 w-48"
                />
                <button
                  onClick={() => onSaveEdit(node.path)}
                  disabled={savingEdit}
                  className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  {savingEdit ? "저장중" : "저장"}
                </button>
                <button
                  onClick={onCancelEdit}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                >
                  취소
                </button>
              </div>
            ) : (
              <span className="text-sm text-gray-800 font-medium select-none">
                {node.name}
              </span>
            )}
          </div>
        </td>

        {/* Action buttons */}
        <td className="px-4 py-2 text-right">
          {!isEditing && (
            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onStartEdit(node.path, node.name)}
                disabled={editingOUPath !== null}
                className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                이름 수정
              </button>
              <button
                onClick={() => onConfirmDelete(node.path)}
                disabled={isDeleting}
                className="text-xs px-2 py-1 border border-red-200 rounded text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                {isDeleting ? "삭제중..." : "삭제"}
              </button>
            </div>
          )}
        </td>
      </tr>

      {/* Render children if expanded */}
      {hasChildren &&
        expanded &&
        childNodes.map((child) => (
          <TreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            onRename={onRename}
            onDelete={onDelete}
            editingOUPath={editingOUPath}
            editingOUName={editingOUName}
            savingEdit={savingEdit}
            deletingOUPath={deletingOUPath}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onEditNameChange={onEditNameChange}
            onSaveEdit={onSaveEdit}
            onConfirmDelete={onConfirmDelete}
          />
        ))}
    </>
  );
}

export default function OUTreeManager({
  orgUnits,
  onRename,
  onDelete,
  onRefresh,
}: OUTreeManagerProps) {
  const [editingOUPath, setEditingOUPath] = useState<string | null>(null);
  const [editingOUName, setEditingOUName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingOUPath, setDeletingOUPath] = useState<string | null>(null);

  const tree = buildTree(orgUnits);
  const rootChildren = Object.values(tree.children).sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  const handleSaveEdit = async (path: string) => {
    if (!editingOUName.trim()) return;
    setSavingEdit(true);
    try {
      await onRename(path, editingOUName.trim());
      setEditingOUPath(null);
      setEditingOUName("");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async (path: string) => {
    if (
      !confirm(
        `'${path}' 조직단위를 구글 워크스페이스에서 삭제하시겠습니까?\n(하위 조직단위 또는 소속된 계정이 있으면 삭제되지 않습니다)`
      )
    )
      return;
    setDeletingOUPath(path);
    try {
      await onDelete(path);
    } finally {
      setDeletingOUPath(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">조직단위(OU) 목록 관리</h2>
        <button
          onClick={onRefresh}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
        >
          새로고침
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider text-xs">
                조직단위 구조
              </th>
              <th className="px-4 py-2 text-right font-semibold text-gray-500 uppercase tracking-wider text-xs w-40">
                관리
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rootChildren.map((node) => (
              <TreeNodeRow
                key={node.path}
                node={node}
                depth={0}
                onRename={onRename}
                onDelete={onDelete}
                editingOUPath={editingOUPath}
                editingOUName={editingOUName}
                savingEdit={savingEdit}
                deletingOUPath={deletingOUPath}
                onStartEdit={(path, name) => {
                  setEditingOUPath(path);
                  setEditingOUName(name);
                }}
                onCancelEdit={() => {
                  setEditingOUPath(null);
                  setEditingOUName("");
                }}
                onEditNameChange={setEditingOUName}
                onSaveEdit={handleSaveEdit}
                onConfirmDelete={handleConfirmDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
