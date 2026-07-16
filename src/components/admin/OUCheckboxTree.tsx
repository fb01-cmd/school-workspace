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
  const sorted = [...orgUnits].sort((a, b) => a.orgUnitPath.localeCompare(b.orgUnitPath));

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

// Collect all descendant paths (including self)
function getAllDescendantPaths(node: TreeNode): string[] {
  const paths: string[] = [node.path];
  for (const child of Object.values(node.children)) {
    paths.push(...getAllDescendantPaths(child));
  }
  return paths;
}

// Check selection state: "all" | "some" | "none"
function getSelectionState(node: TreeNode, selected: string[]): "all" | "some" | "none" {
  const descendants = getAllDescendantPaths(node);
  const checkedCount = descendants.filter((p) => selected.includes(p)).length;
  if (checkedCount === 0) return "none";
  if (checkedCount === descendants.length) return "all";
  return "some";
}

interface CheckboxNodeProps {
  node: TreeNode;
  selected: string[];
  onChange: (newSelected: string[]) => void;
  depth?: number;
}

function CheckboxNode({ node, selected, onChange, depth = 0 }: CheckboxNodeProps) {
  const hasChildren = Object.keys(node.children).length > 0;
  const state = getSelectionState(node, selected);
  const [expanded, setExpanded] = useState(depth < 2);

  const handleToggle = () => {
    const descendants = getAllDescendantPaths(node);
    if (state === "all") {
      // Uncheck everything
      onChange(selected.filter((p) => !descendants.includes(p)));
    } else {
      // Check everything (add missing descendants)
      const newSet = new Set([...selected, ...descendants]);
      onChange(Array.from(newSet));
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-gray-100/70 transition-colors cursor-pointer select-none`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* Expand/collapse arrow */}
        <span
          className="w-4 flex-shrink-0 text-center text-gray-400 hover:text-gray-600"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (
            <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          ) : (
            <span className="text-xs text-gray-300">•</span>
          )}
        </span>

        {/* Checkbox */}
        <input
          type="checkbox"
          checked={state === "all"}
          ref={(el) => {
            if (el) el.indeterminate = state === "some";
          }}
          onChange={handleToggle}
          className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 flex-shrink-0 cursor-pointer"
        />

        {/* Label */}
        <span
          className="text-xs text-gray-800 font-medium cursor-pointer flex-1"
          onClick={handleToggle}
        >
          {node.name}
          <span className="text-[10px] text-gray-400 font-normal ml-1.5 font-mono">
            {node.path}
          </span>
        </span>

        {/* Badge when fully selected */}
        {state === "all" && (
          <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
            허용
          </span>
        )}
        {state === "some" && (
          <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded-full flex-shrink-0">
            일부
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {Object.values(node.children)
            .sort((a, b) => a.name.localeCompare(b.name, "ko"))
            .map((child) => (
              <CheckboxNode
                key={child.path}
                node={child}
                selected={selected}
                onChange={onChange}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}

interface OUCheckboxTreeProps {
  orgUnits: OU[];
  selected: string[];
  onChange: (newSelected: string[]) => void;
}

export default function OUCheckboxTree({ orgUnits, selected, onChange }: OUCheckboxTreeProps) {
  const tree = buildTree(orgUnits);
  const rootChildren = Object.values(tree.children).sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  return (
    <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100 overflow-hidden">
      {rootChildren.length === 0 ? (
        <p className="text-xs text-gray-400 p-4 text-center">조직단위 정보가 없습니다.</p>
      ) : (
        <div className="p-2 space-y-0.5">
          {rootChildren.map((child) => (
            <CheckboxNode
              key={child.path}
              node={child}
              selected={selected}
              onChange={onChange}
              depth={0}
            />
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="px-3 py-2 bg-indigo-50/50 text-xs text-indigo-700 font-medium flex items-center justify-between">
          <span>허용된 조직단위: {selected.length}개</span>
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-indigo-500 hover:text-indigo-700 text-[10px] underline"
          >
            전체 해제
          </button>
        </div>
      )}
    </div>
  );
}
