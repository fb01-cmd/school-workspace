"use client";

import { useState, useEffect, useRef } from "react";

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

// Build a tree from a flat list of orgUnitPaths
function buildTree(orgUnits: OU[]): TreeNode {
  const root: TreeNode = { name: "/", path: "/", children: {} };

  // Sort paths so parents come before children
  const sorted = [...orgUnits].sort((a, b) =>
    a.orgUnitPath.localeCompare(b.orgUnitPath)
  );

  for (const ou of sorted) {
    const parts = ou.orgUnitPath.split("/").filter(Boolean); // remove empty strings
    let current = root;
    let builtPath = "";

    for (const part of parts) {
      builtPath += "/" + part;
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: builtPath,
          children: {},
        };
      }
      current = current.children[part];
    }
  }

  return root;
}

interface TreeNodeProps {
  node: TreeNode;
  selectedValue: string;
  onSelect: (path: string) => void;
  depth?: number;
  defaultExpanded?: boolean;
}

function TreeNodeItem({ node, selectedValue, onSelect, depth = 0, defaultExpanded = false }: TreeNodeProps) {
  const hasChildren = Object.keys(node.children).length > 0;
  const [expanded, setExpanded] = useState(
    defaultExpanded || depth === 0 || selectedValue.startsWith(node.path + "/") || selectedValue === node.path
  );

  const isSelected = selectedValue === node.path;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 rounded text-sm select-none ${
          isSelected
            ? "bg-indigo-600 text-white"
            : "hover:bg-gray-100 text-gray-800"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse arrow — click ONLY toggles open/close, does NOT select */}
        <span
          className="w-4 flex-shrink-0 text-center cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (
            <span className={`text-xs ${isSelected ? "text-white" : "text-gray-400"}`}>
              {expanded ? "▼" : "▶"}
            </span>
          ) : (
            <span className={`text-xs ${isSelected ? "text-white" : "text-gray-300"}`}>•</span>
          )}
        </span>

        {/* Node name — click selects this OU */}
        <span
          className="whitespace-nowrap cursor-pointer flex-1 py-0.5"
          onClick={() => onSelect(node.path)}
        >
          {node.name}
        </span>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {Object.values(node.children)
            .sort((a, b) => a.name.localeCompare(b.name, "ko"))
            .map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                selectedValue={selectedValue}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  );
}

interface OUTreeSelectorProps {
  orgUnits: OU[];
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  size?: "sm" | "md";
  "data-row-index"?: number;
  "data-col-index"?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export default function OUTreeSelector({
  orgUnits,
  value,
  onChange,
  placeholder = "-- 조직단위를 선택하세요 --",
  size = "md",
  "data-row-index": dataRowIndex,
  "data-col-index": dataColIndex,
  onKeyDown,
}: OUTreeSelectorProps) {
  const [open, setOpen] = useState(false);
  const tree = buildTree(orgUnits);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (path: string) => {
    onChange(path);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-row-index={dataRowIndex}
        data-col-index={dataColIndex}
        onKeyDown={onKeyDown}
        className={`w-full flex items-center justify-between border rounded bg-white text-left focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
          size === "sm"
            ? "px-1.5 py-1 text-xs border-slate-200 text-slate-800"
            : "px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:ring-2"
        }`}
      >
        <span className={value && value !== "/" ? (size === "sm" ? "text-slate-800 font-medium" : "text-gray-900") : "text-gray-400"}>
          {!value || value === "/" ? "최상위" : value}
        </span>
        <svg
          className={`ml-1 h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown tree panel */}
      {open && (
        <div
          className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-auto max-h-72"
          style={{ minWidth: "max(100%, 280px)" }}
        >
          {/* Root/none option */}
          <div
            className={`flex items-center gap-1 py-1.5 px-3 text-sm cursor-pointer rounded-t ${
              value === "/" || value === "" ? "bg-indigo-600 text-white" : "hover:bg-gray-50 text-gray-500"
            }`}
            onClick={() => handleSelect("/")}
          >
            — / (최상위 조직) —
          </div>
          <hr className="border-gray-100" />

          {/* Tree nodes (children of root) */}
          {Object.values(tree.children)
            .sort((a, b) => a.name.localeCompare(b.name, "ko"))
            .map((node) => (
              <TreeNodeItem
                key={node.path}
                node={node}
                selectedValue={value}
                onSelect={handleSelect}
                depth={0}
                defaultExpanded={false}
              />
            ))}
        </div>
      )}
    </div>
  );
}
