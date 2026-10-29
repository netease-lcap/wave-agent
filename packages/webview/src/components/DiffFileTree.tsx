import React, { useMemo, useState } from "react";
import type { WorkspaceDiffFile } from "./DiffPane";
import { ChevronIcon } from "./ChevronIcon";
import { FolderIcon } from "./FolderIcon";
import { PanelKindIcon } from "./PanelKindIcon";
import { isDesktopHost } from "../utils/platform";

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
      // 1029 评论（第六批）：「和文件的文件树样式保持一致」—— 桌面端与
      // `FileTree.tsx` 逐值对齐：左距基准 8 → 6、每级缩进仍 12；IDE 宿主保持原样。
      const indent = {
        paddingLeft: (isDesktopHost() ? 6 : 8) + depth * 12,
      };
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
              {/* 与文件树同一套：桌面端 = 官方 chevron 矢量 + 文件夹图标（展开/收起
                  就是文件夹开合），IDE 宿主两处都保留 codicon 字形。 */}
              {isDesktopHost() ? (
                <ChevronIcon
                  expanded={!isCollapsed}
                  className="diff-tree-caret"
                />
              ) : (
                <i
                  className={`codicon codicon-chevron-${isCollapsed ? "right" : "down"}`}
                />
              )}
              {isDesktopHost() &&
                (isCollapsed ? (
                  <FolderIcon className="diff-tree-icon" />
                ) : (
                  <FolderIcon expanded className="diff-tree-icon" />
                ))}
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
          {isDesktopHost() && (
            // 文件行留一个与箭头同宽的占位，名字与目录行的名字对齐（同文件树）。
            <span className="diff-tree-caret" aria-hidden="true" />
          )}
          {isDesktopHost() && (
            <PanelKindIcon kind="file" size={16} className="diff-tree-icon" />
          )}
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
