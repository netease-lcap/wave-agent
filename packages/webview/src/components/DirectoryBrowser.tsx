/**
 * DirectoryBrowser — 远程目录浏览面板（桌面端远程主机与远控 Web 页共用）。
 *
 * 从 DesktopWorkdirSelector 的浏览面板抽出：面包屑 + 单层子目录列表
 * （点击进入子目录、「…」上级项）+ 关键词实时筛选（匹配高亮）+ 底部
 * 路径/筛选输入与「选择此目录」按钮。
 *
 * 组件自持一次浏览会话的全部状态（requestId、当前路径、列表、筛选词、
 * 键盘选中项），父级只负责三件事：
 *   - `onRequestList(path, requestId)`：发出列目录请求（宿主命令）；
 *   - 通过 `replyCommand` 声明回复消息的 command 名，requestId 匹配消费
 *     （桌面端 `desktopRemoteDirList` / 远控页 shim `newSessionDirs`，
 *     两者载荷形状一致：{ requestId, resolvedPath, dirs } 或 { requestId, error }）；
 *   - `onSelect(path)`（选定）/ `onClose()`（Escape）/ `onResolved(path)`
 *     （每次解析成功回报，宿主做跨开关的位置记忆）。
 *
 * 与 VS Code Remote-SSH 目录浏览器同一交互（spec desktop-remote-host.md
 * 场景 20/21/22；远控页新会话按「与桌面端远程目录弹窗一致」复用同一交互）。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useHostMessage } from "../utils/useHostMessage";
import "../styles/DesktopApp.css";

/** Join a normalized absolute path with a child name. */
export const joinPath = (base: string, child: string): string =>
  `${base.replace(/\/+$/, "")}/${child}`;

/** Parent of a normalized absolute path; '/' has no parent. */
export const parentOf = (p: string): string => {
  const norm = p.replace(/\/+$/, "");
  if (!norm || norm === "/") return "/";
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "/";
  return norm.slice(0, idx);
};

export interface DirectoryBrowserProps {
  /** host→webview 回复消息的 command 名（requestId 匹配）。 */
  replyCommand: string;
  /**
   * 请求列出 `path` 的子目录，**返回本次请求的 requestId**（回执经
   * `replyCommand` 携带同一 requestId）。号由父级分配：父级是拥有与宿主
   * 通信通道的常驻方，只有它知道哪些号还在途——浏览器面板每次打开重挂，
   * 若号从 1 重数，上一轮的迟到回执就会错配到新一轮请求上。
   */
  onRequestList: (path: string) => string;
  /** 选定路径（「选择此目录」或输入框里的绝对路径回车）。 */
  onSelect: (path: string) => void;
  /** Escape 关闭面板；焦点归位由父级决定。 */
  onClose: () => void;
  /** 首次打开的起始位置（桌面端传上次访问目录，Web 页传 ~）。 */
  initialPath?: string;
  /** 每次列表解析成功后回报解析出的绝对路径（宿主位置记忆用）。 */
  onResolved?: (path: string) => void;
}

export const DirectoryBrowser: React.FC<DirectoryBrowserProps> = ({
  replyCommand,
  onRequestList,
  onSelect,
  onClose,
  initialPath = "~",
  onResolved,
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [filterKeyword, setFilterKeyword] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyboard selection index into the filtered list; -1 = nothing selected.
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string>("");

  const requestList = useCallback(
    (path: string) => {
      const requestId = onRequestList(path);
      requestIdRef.current = requestId;
      setCurrentPath(path);
      setLoading(true);
      setError(null);
      // Navigating to another directory resets the filter keyword — the
      // keyword targets the currently listed single-level directory list.
      setFilterKeyword("");
      setSelectedIndex(-1);
    },
    [onRequestList],
  );

  // Consume requestId-matched replies. Stale replies (a newer request
  // superseded this one) are dropped. Routing is by requestId (request
  // correlation), not message.paneId.
  useHostMessage((message) => {
    if (message.command !== replyCommand) return;
    if (String(message.requestId) !== String(requestIdRef.current)) return;
    setLoading(false);
    if (message.error) {
      setError(String(message.error));
      return;
    }
    setCurrentPath(message.resolvedPath);
    setDirs(message.dirs ?? []);
    onResolved?.(message.resolvedPath);
  });

  // Auto-focus the filter input once on mount (the panel expands in place,
  // the input is the primary control). Refs are stable, so the empty deps are
  // honest: exactly one focus, on the first mount.
  useEffect(() => {
    requestAnimationFrame(() => filterInputRef.current?.focus());
  }, []);

  // 首次列目录：不放在 requestList 的 effect 里，避免 onRequestList 引用
  // 变化引发重复请求；只按挂载触发一次。
  const bootstrappedRef = useRef(false);
  if (!bootstrappedRef.current) {
    bootstrappedRef.current = true;
    requestIdRef.current = onRequestList(initialPath);
    setLoading(true);
  }

  // Keep the highlighted item in view while moving with the keyboard.
  useEffect(() => {
    const el = selectedItemRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Breadcrumb segments of the current path: ['/', 'home', 'user', 'project'].
  const crumbs = currentPath.startsWith("/")
    ? ["/", ...currentPath.split("/").filter(Boolean)]
    : currentPath.split("/").filter(Boolean);

  // Live filter over the single-level directory list (case-insensitive
  // substring). The keyword also highlights matches.
  const keyword = filterKeyword.trim().toLowerCase();
  const filteredDirs = keyword
    ? dirs.filter((d) => d.toLowerCase().includes(keyword))
    : dirs;

  /** Render a dir name with every keyword occurrence wrapped in a <mark>. */
  const highlightName = (name: string): React.ReactNode => {
    if (!keyword) return name;
    const lower = name.toLowerCase();
    const parts: React.ReactNode[] = [];
    let pos = 0;
    let key = 0;
    let idx = lower.indexOf(keyword, pos);
    while (idx >= 0) {
      if (idx > pos) parts.push(name.slice(pos, idx));
      parts.push(
        <mark key={key++} className="desktop-remote-browser-mark">
          {name.slice(idx, idx + keyword.length)}
        </mark>,
      );
      pos = idx + keyword.length;
      idx = lower.indexOf(keyword, pos);
    }
    if (pos < name.length) parts.push(name.slice(pos));
    return parts;
  };

  /** Filter the single-level list by the typed keyword (case-insensitive
   *  substring). Filtering auto-selects the first match so Enter can go
   *  straight into it without an extra ArrowDown. */
  const handleFilterChange = (value: string) => {
    setFilterKeyword(value);
    const next = value.trim().toLowerCase();
    const matches = next
      ? dirs.filter((d) => d.toLowerCase().includes(next))
      : dirs;
    setSelectedIndex(matches.length > 0 ? 0 : -1);
  };

  /**
   * Enter-without-selection on the filter input. Only an absolute-path-shaped
   * value (`/…` or `~…`) jumps straight to that path; a bare keyword is just
   * the live filter and does nothing here.
   */
  const submitFilterInput = useCallback(() => {
    const p = filterKeyword.trim();
    if (!p || !(p.startsWith("/") || p.startsWith("~"))) return;
    onSelect(p);
  }, [filterKeyword, onSelect]);

  const selectCurrent = useCallback(() => {
    if (!currentPath || loading || error) return;
    onSelect(currentPath);
  }, [currentPath, loading, error, onSelect]);

  return (
    <div
      className="desktop-remote-browser"
      data-testid="desktop-remote-browser"
    >
      <div
        className="desktop-remote-browser-crumbs"
        data-testid="desktop-remote-browser-crumbs"
      >
        {crumbs.map((seg, i) => {
          const target =
            seg === "/" ? "/" : `/${crumbs.slice(1, i + 1).join("/")}`;
          return (
            <span
              key={`${seg}-${i}`}
              className={`desktop-remote-browser-crumb${i === crumbs.length - 1 ? " active" : ""}`}
              tabIndex={0}
              onClick={() => requestList(target)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  requestList(target);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
            >
              {seg}
            </span>
          );
        })}
      </div>
      {loading ? (
        <div className="desktop-remote-browser-status">加载中…</div>
      ) : error ? (
        <div
          className="desktop-remote-browser-status desktop-remote-browser-error"
          data-testid="desktop-remote-browser-error"
        >
          <span>{error}</span>
          <button
            className="desktop-remote-browser-retry"
            onClick={() => requestList(currentPath)}
            data-testid="desktop-remote-browser-retry"
          >
            重试
          </button>
        </div>
      ) : (
        <div className="desktop-remote-browser-list" role="listbox">
          {currentPath !== "/" && (
            <div
              className="desktop-remote-browser-item"
              role="option"
              onClick={() => requestList(parentOf(currentPath))}
              data-testid="desktop-remote-browser-parent"
            >
              <span className="codicon codicon-arrow-up"></span>
              <span>…</span>
            </div>
          )}
          {filteredDirs.length === 0 ? (
            <div
              className="desktop-remote-browser-status"
              data-testid="desktop-remote-browser-empty"
            >
              {keyword ? "没有匹配的目录" : "该目录下没有子目录"}
            </div>
          ) : (
            filteredDirs.map((d, i) => (
              <div
                key={d}
                ref={i === selectedIndex ? selectedItemRef : undefined}
                className={`desktop-remote-browser-item${i === selectedIndex ? " selected" : ""}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => requestList(joinPath(currentPath, d))}
                title={d}
                data-testid="desktop-remote-browser-item"
              >
                <span className="codicon codicon-folder"></span>
                <span className="desktop-remote-browser-item-name">
                  {highlightName(d)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      <div className="desktop-remote-browser-footer">
        <input
          ref={filterInputRef}
          className="desktop-host-add-input"
          placeholder="输入关键词筛选目录，或输入完整路径回车"
          value={filterKeyword}
          onChange={(e) => handleFilterChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedIndex((i) =>
                i >= filteredDirs.length - 1 ? i : i + 1,
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedIndex((i) => (i <= 0 ? -1 : i - 1));
            } else if (e.key === "Enter") {
              // Enter enters the highlighted subdirectory first; without
              // a selection it falls back to the absolute-path jump.
              if (selectedIndex >= 0 && filteredDirs[selectedIndex]) {
                requestList(joinPath(currentPath, filteredDirs[selectedIndex]));
              } else {
                submitFilterInput();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          data-testid="desktop-remote-browser-input"
        />
        <button
          className="desktop-remote-browser-select"
          onClick={selectCurrent}
          disabled={!currentPath || loading || !!error}
          data-testid="desktop-remote-browser-select"
        >
          选择此目录
        </button>
      </div>
    </div>
  );
};

export default DirectoryBrowser;
