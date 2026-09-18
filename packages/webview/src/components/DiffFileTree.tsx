import React, { useMemo, useState } from "react";
import type { WorkspaceDiffFile } from "./DiffPane";

interface DiffTreeNode {
  /** Display name: the last path segment. */
  name: string;
  /** Repo-relative path — the collapse key and the selection value. */
  path: string;
  dir: boolean;
  children?: DiffTreeNode[];
  file?: WorkspaceDiffFile;
}

/**
 * Fold the flat (already path-sorted) file list into a directory tree. Nodes
 * keep the input order, so walking the tree top-down yields the same order as
 * the accordion below — a file the tree lists first is the one the accordion
 * shows first.
 */
function buildTree(files: WorkspaceDiffFile[]): DiffTreeNode[] {
  const roots: DiffTreeNode[] = [];
  const dirs = new Map<string, DiffTreeNode>();
  for (const file of files) {
    const segments = file.path.split("/");
    let level = roots;
    let prefix = "";
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : segments[i];
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { name: segments[i], path: prefix, dir: true, children: [] };
        dirs.set(prefix, dir);
        level.push(dir);
      }
      level = dir.children as DiffTreeNode[];
    }
    level.push({
      name: segments[segments.length - 1],
      path: file.path,
      dir: false,
      file,
    });
  }
  return roots;
}

export interface DiffFileTreeProps {
  files: WorkspaceDiffFile[];
  /** Path of the file the accordion currently shows, or null. */
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

/** Sidebar file tree: all changed files, grouped by directory, with +/- stats. */
export const DiffFileTree: React.FC<DiffFileTreeProps> = ({
  files,
  selectedPath,
  onSelect,
}) => {
  const nodes = useMemo(() => buildTree(files), [files]);
  // Collapsed directories only, so a fresh range starts fully expanded and
  // directories that no longer exist cannot linger as stale collapse state.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleDir = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNodes = (items: DiffTreeNode[], depth: number): React.ReactNode =>
    items.map((node) => {
      const indent = { paddingLeft: 8 + depth * 12 };
      if (node.dir) {
        const isCollapsed = collapsed.has(node.path);
        return (
          <React.Fragment key={`dir:${node.path}`}>
            <button
              className="diff-tree-dir"
              style={indent}
              data-testid="diff-tree-dir"
              aria-expanded={!isCollapsed}
              title={node.path}
              onClick={() => toggleDir(node.path)}
            >
              <i
                className={`codicon codicon-chevron-${isCollapsed ? "right" : "down"}`}
              />
              <span className="diff-tree-name">{node.name}</span>
            </button>
            {!isCollapsed && renderNodes(node.children ?? [], depth + 1)}
          </React.Fragment>
        );
      }
      const file = node.file as WorkspaceDiffFile;
      return (
        <button
          key={`file:${node.path}`}
          className={`diff-tree-file${
            selectedPath === node.path ? " is-selected" : ""
          }`}
          style={indent}
          data-testid="diff-tree-file"
          data-path={node.path}
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          onClick={() => onSelect(node.path)}
        >
          <span className="diff-tree-name">{node.name}</span>
          <span className="diff-file-stats">
            <span className="diff-file-stats-add">+{file.additions}</span>
            <span className="diff-file-stats-del">-{file.deletions}</span>
          </span>
        </button>
      );
    });

  return (
    <div className="diff-tree" data-testid="diff-tree">
      {renderNodes(nodes, 0)}
    </div>
  );
};

export default DiffFileTree;
