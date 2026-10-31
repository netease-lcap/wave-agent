import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileItem } from "../types";
import type { FileTreeEntry } from "wave-webview-fixtures";
import { childPath, baseNameOf } from "../utils/fileTreePaths";
import { isDesktopHost } from "../utils/platform";
import { ChevronIcon } from "./ChevronIcon";
import { FolderIcon } from "./FolderIcon";
import { PanelKindIcon } from "./PanelKindIcon";

/** Per-directory listing state, keyed by the directory's absolute path. */
export interface DirEntryState {
  loading?: boolean;
  error?: string;
  entries?: FileTreeEntry[];
  /** Post-filter count before the per-level cap (the 「还有 N 项」 row). */
  total?: number;
}

export interface FileTreeProps {
  /** Workspace root of the tree — the session's stable root, never a bash `cd`. */
  root: string;
  /** Expanded directories (absolute paths). Owned by the pane so 「在文件树中
   *  显示」 can expand ancestors from outside the tree. */
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  /** Listings already fetched (lazily, level by level). */
  dirs: Record<string, DirEntryState>;
  /** Ask the host for one level; only called for a directory not yet loaded. */
  onNeedDir: (path: string) => void;
  activePath?: string;
  onOpenFile: (path: string) => void;
  /** Bumps when 「在文件树中显示」 is invoked; reveals `activePath`. */
  revealTick: number;

  // ---- 过滤框（spec「文件面板按名字查找」）----
  filter: string;
  onFilterChange: (value: string) => void;
  filterResults: FileItem[];
  filterLoading: boolean;
  filterError?: string;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onPickResult: (file: FileItem) => void;
}

interface TreeRow {
  path: string;
  name: string;
  depth: number;
  type: "dir" | "file";
  expanded: boolean;
  /** Loading / error state for a directory row (rendered as a child line). */
  state?: DirEntryState;
}

/**
 * `[data-tree-path="…"]` for a path that may hold quotes or backslashes —
 * jsdom ships no `CSS.escape`, and escaping those two is enough inside a quoted
 * attribute selector.
 */
const treePathSelector = (path: string) =>
  `[data-tree-path="${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;

/** Per-level cap notice: the host keeps at most this many rows per level. */
const ROW_LIMIT_NOTICE = (hidden: number) => `还有 ${hidden} 项未显示`;

/**
 * The file panel's directory tree (spec desktop-file-panel.md「文件面板工作区
 * 目录树」): lazy per level, keyboard navigable, with the workspace file filter
 * at the top. It paints only what the host has already listed — expansion is
 * what triggers a listing, so opening the panel costs one directory read.
 */
export const FileTree: React.FC<FileTreeProps> = ({
  root,
  expanded,
  onToggleDir,
  dirs,
  onNeedDir,
  activePath,
  onOpenFile,
  revealTick,
  filter,
  onFilterChange,
  filterResults,
  filterLoading,
  filterError,
  selectedIndex,
  onSelectedIndexChange,
  onPickResult,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const filtering = filter.length > 0;
  const files = useMemo(
    () => filterResults.filter((f) => !f.isDirectory),
    [filterResults],
  );

  // Flatten the visible part of the tree: root row, then each expanded level.
  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    const rootName = baseNameOf(root) || root;
    out.push({
      path: root,
      name: rootName,
      depth: 0,
      type: "dir",
      expanded: true,
      state: dirs[root],
    });
    const walk = (dir: string, depth: number) => {
      for (const entry of dirs[dir]?.entries ?? []) {
        const path = childPath(dir, entry.name);
        const isDir = entry.type === "dir";
        const isExpanded = isDir && expanded.has(path);
        out.push({
          path,
          name: entry.name,
          depth,
          type: entry.type,
          expanded: isExpanded,
          state: isDir ? dirs[path] : undefined,
        });
        if (isExpanded) walk(path, depth + 1);
      }
    };
    walk(root, 1);
    return out;
  }, [root, dirs, expanded]);

  // Lazily fetch a level the moment it becomes visible. The root has no toggle,
  // so it is requested here rather than in the click handler.
  useEffect(() => {
    for (const row of rows) {
      if (row.type !== "dir" || !row.expanded) continue;
      // 折叠的目录等展开再读：打开面板只付一层目录的开销（场景 2）。
      if (row.state?.loading || row.state?.entries || row.state?.error)
        continue;
      onNeedDir(row.path);
    }
  }, [rows, onNeedDir]);

  // 「在文件树中显示」: bring the active file's row into view, once per tick.
  useEffect(() => {
    if (!revealTick || !activePath || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(treePathSelector(activePath))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [revealTick, activePath]);

  /** 结果项的所在目录：相对工作区根，同名文件靠它区分（场景 2）。 */
  const dirPrefix = (path: string) => {
    const head = path.startsWith(root) ? path.slice(root.length) : path;
    return head.slice(0, Math.max(0, head.length - baseNameOf(path).length));
  };

  const activate = useCallback(
    (row: TreeRow) => {
      if (row.type === "dir") onToggleDir(row.path);
      else onOpenFile(row.path);
    },
    [onOpenFile, onToggleDir],
  );

  /**
   * Keyboard navigation follows the file-tree conventions the spec lists
   * (scenario 5): ↑/↓ move, Home/End jump, → expands or steps into the first
   * child, ← collapses or jumps to the parent, and a letter jumps to the next
   * row starting with it. Focus is roving: exactly one row holds `tabIndex=0`.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((r) => r.path === focusedPath);
      const index = currentIndex < 0 ? 0 : currentIndex;
      const row = rows[index];
      const focusRow = (next: TreeRow | undefined) => {
        if (!next) return;
        setFocusedPath(next.path);
        listRef.current
          ?.querySelector<HTMLElement>(treePathSelector(next.path))
          ?.focus();
      };
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(rows[Math.min(rows.length - 1, index + 1)]);
          return;
        case "ArrowUp":
          event.preventDefault();
          focusRow(rows[Math.max(0, index - 1)]);
          return;
        case "Home":
          event.preventDefault();
          focusRow(rows[0]);
          return;
        case "End":
          event.preventDefault();
          focusRow(rows[rows.length - 1]);
          return;
        case "ArrowRight": {
          event.preventDefault();
          if (row.type !== "dir") return;
          if (!row.expanded) {
            onToggleDir(row.path);
            return;
          }
          focusRow(rows[index + 1]);
          return;
        }
        case "ArrowLeft": {
          event.preventDefault();
          if (row.type === "dir" && row.expanded) {
            onToggleDir(row.path);
            return;
          }
          // Jump to the parent row (the nearest row one level up).
          for (let i = index - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) {
              focusRow(rows[i]);
              return;
            }
          }
          return;
        }
        case "Enter":
        case " ":
          event.preventDefault();
          activate(row);
          return;
        default: {
          if (event.key.length !== 1 || event.metaKey || event.ctrlKey) return;
          const letter = event.key.toLowerCase();
          const ordered = [
            ...rows.slice(index + 1),
            ...rows.slice(0, index + 1),
          ];
          const match = ordered.find((r) =>
            r.name.toLowerCase().startsWith(letter),
          );
          if (match) {
            event.preventDefault();
            focusRow(match);
          }
        }
      }
    },
    [rows, focusedPath, activate, onToggleDir],
  );

  /** Filter-box keys: ↓/↑ walk the results, Enter opens, Esc clears. */
  const handleFilterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onFilterChange("");
        return;
      }
      if (files.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        onSelectedIndexChange(Math.min(files.length - 1, selectedIndex + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        onSelectedIndexChange(Math.max(0, selectedIndex - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const file = files[selectedIndex];
        if (file) onPickResult(file);
      }
    },
    [files, selectedIndex, onSelectedIndexChange, onPickResult, onFilterChange],
  );

  return (
    <div className="file-tree" data-testid="file-pane-tree">
      <div className="file-tree-filter-row">
        <input
          ref={filterInputRef}
          className="file-tree-filter"
          data-testid="file-tree-filter"
          placeholder="筛选文件…"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          onKeyDown={handleFilterKeyDown}
          aria-label="筛选文件"
        />
      </div>
      {filtering ? (
        <div
          className="file-tree-results"
          data-testid="file-tree-filter-results"
          role="listbox"
        >
          {filterLoading && files.length === 0 && (
            <div className="file-tree-note">正在搜索…</div>
          )}
          {filterError && <div className="file-tree-note">{filterError}</div>}
          {!filterLoading && !filterError && files.length === 0 && (
            <div className="file-tree-note" data-testid="file-tree-no-match">
              未找到匹配的文件
            </div>
          )}
          {files.map((file, i) => (
            <button
              key={file.path}
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              className={`file-tree-result${i === selectedIndex ? " file-tree-result--selected" : ""}`}
              data-testid="file-tree-filter-result"
              // 同名文件靠所在相对目录区分（场景 2）。
              title={file.path}
              onMouseEnter={() => onSelectedIndexChange(i)}
              onClick={() => onPickResult(file)}
            >
              <span className="file-tree-result-name">
                {baseNameOf(file.path)}
              </span>
              <span className="file-tree-result-dir">
                {dirPrefix(file.path)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div
          className="file-tree-rows"
          data-testid="file-tree-rows"
          role="tree"
          aria-label="工作区目录"
          ref={listRef}
          onKeyDown={handleKeyDown}
        >
          {rows.map((row) => {
            const isActive = !!activePath && row.path === activePath;
            const hidden =
              row.type === "dir" && row.state?.total !== undefined
                ? row.state.total - (row.state.entries?.length ?? 0)
                : 0;
            return (
              <React.Fragment key={row.path}>
                <div
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-expanded={row.type === "dir" ? row.expanded : undefined}
                  aria-selected={isActive}
                  aria-label={
                    row.type === "dir"
                      ? `${row.expanded ? "折叠目录" : "展开目录"} ${row.name}`
                      : row.name
                  }
                  tabIndex={
                    focusedPath === null
                      ? row.depth === 0
                        ? 0
                        : -1
                      : focusedPath === row.path
                        ? 0
                        : -1
                  }
                  data-tree-path={row.path}
                  data-testid="file-tree-row"
                  className={`file-tree-row${row.type === "dir" ? " file-tree-row--dir" : ""}${isActive ? " file-tree-row--active" : ""}`}
                  style={{ paddingLeft: 6 + row.depth * 12 }}
                  onClick={() => activate(row)}
                  onFocus={() => setFocusedPath(row.path)}
                >
                  {row.type === "dir" ? (
                    // 桌面端用官方 Figma chevron 矢量（ChevronIcon）——与侧栏会话分组头
                    // 是**同一个字形**，墨迹同宽（1029 第七轮「和图标保持一致」→ 第八轮
                    // 「比那边大了一点」，改用同源矢量后两处逐像素一致）；插件端保留
                    // 原来的「▸」文字三角，样式见 FilePane.css 的 .file-tree-caret。
                    isDesktopHost() ? (
                      <ChevronIcon
                        expanded={row.expanded}
                        className="file-tree-caret"
                      />
                    ) : (
                      <span
                        className={`file-tree-caret${row.expanded ? " file-tree-caret--open" : ""}`}
                        aria-hidden="true"
                      >
                        ▸
                      </span>
                    )
                  ) : (
                    <span className="file-tree-caret" aria-hidden="true" />
                  )}
                  {/* 文件夹 / 文件图标（1029 第十三轮）：桌面端换成产品里已在用的两颗
                      官方矢量 —— 目录 = FolderIcon（与侧栏会话分组头、工作目录下拉同一颗，
                      展开 / 收起就是文件夹开合），文件 = PanelKindIcon kind="file"
                      （与文件标签页、面板标签同一颗）。codicon 是字体字形：笔画由字体
                      决定（约 1.0px），与这两处的 1.4 描边不是一套，颜色也吃
                      `--vscode-icon-foreground` 比文字浅一档。插件端保留 codicon。 */}
                  {isDesktopHost() ? (
                    row.type === "dir" ? (
                      <FolderIcon
                        expanded={row.expanded}
                        className="file-tree-icon"
                      />
                    ) : (
                      <PanelKindIcon
                        kind="file"
                        size={16}
                        className="file-tree-icon"
                      />
                    )
                  ) : (
                    <i
                      className={`codicon ${row.type === "dir" ? (row.expanded ? "codicon-folder-opened" : "codicon-folder") : "codicon-file"} file-tree-icon`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="file-tree-name" title={row.path}>
                    {row.name}
                  </span>
                </div>
                {row.type === "dir" && row.expanded && row.state?.loading && (
                  <div
                    className="file-tree-note file-tree-note--child"
                    style={{ paddingLeft: 18 + row.depth * 12 }}
                  >
                    正在加载…
                  </div>
                )}
                {row.type === "dir" && row.expanded && row.state?.error && (
                  // 失败保留可重试态：再点一次这一行重新请求（场景 2）。
                  <button
                    type="button"
                    className="file-tree-note file-tree-note--child file-tree-note--error"
                    style={{ paddingLeft: 18 + row.depth * 12 }}
                    data-testid="file-tree-error"
                    onClick={() => onNeedDir(row.path)}
                  >
                    {row.state.error}
                  </button>
                )}
                {row.type === "dir" &&
                  row.expanded &&
                  !row.state?.loading &&
                  !row.state?.error &&
                  row.state?.entries?.length === 0 && (
                    <div
                      className="file-tree-note file-tree-note--child"
                      data-testid="file-tree-empty-dir"
                      style={{ paddingLeft: 18 + row.depth * 12 }}
                    >
                      空目录
                    </div>
                  )}
                {row.type === "dir" && row.expanded && hidden > 0 && (
                  <div
                    className="file-tree-note file-tree-note--child"
                    style={{ paddingLeft: 18 + row.depth * 12 }}
                  >
                    {ROW_LIMIT_NOTICE(hidden)}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FileTree;
