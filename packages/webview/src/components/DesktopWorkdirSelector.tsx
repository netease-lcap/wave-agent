import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
import { ContextDirectoryIcon, PermCaretIcon, CloseIcon } from "./HeaderIcons";
import "../styles/DesktopApp.css";

export interface DesktopWorkdirSelectorProps {
  workdir?: string;
  recentWorkdirs: string[];
  /**
   * Current host ('local' or an SSH host name). Remote hosts have no Electron
   * directory picker — 浏览… opens a remote directory browser panel instead
   * (spec scenarios 20/21), and the path is validated with `test -d` on the
   * host before the session starts.
   */
  host?: string;
  onSelectWorkdir: () => void;
  /** Remote-only: select a workdir by absolute path on `host`. */
  onSelectRemotePath?: (path: string, host: string) => void;
  /**
   * Remote-only: request the subdirectory list of `path` (requestId-matched
   * reply arrives as a `desktopRemoteDirList` window message).
   */
  onListRemoteDir?: (path: string, requestId: string) => void;
  /** `host` scopes the recents lookup to a specific host (defaults to the current one). */
  onSelectRecentWorkdir: (path: string, host?: string) => void;
  onRemoveRecentWorkdir: (path: string, host?: string) => void;
}

/** Join a normalized absolute path with a child name. */
const joinPath = (base: string, child: string): string =>
  `${base.replace(/\/+$/, "")}/${child}`;

/** Parent of a normalized absolute path; '/' has no parent. */
const parentOf = (p: string): string => {
  const norm = p.replace(/\/+$/, "");
  if (!norm || norm === "/") return "/";
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "/";
  return norm.slice(0, idx);
};

/**
 * Workdir dropdown shown at the top-left of the message input (desktop host,
 * new-session state only). Same pattern as the permission-mode dropdown in
 * MessageInput: a relative container holds the trigger + an absolutely
 * positioned menu. The menu expands UPWARD (bottom:100%) because the input
 * sits at the bottom of the viewport. Clicking outside closes it.
 *
 * On a remote host the 浏览… entry opens a VS Code Remote-SSH-style directory
 * browser: breadcrumbs, a single-level subdirectory list (点击进入子目录,
 * 「…」上级项) with live keyword filtering + highlighted matches, and a filter
 * input + 选择此目录 button anchored at the bottom (the browser expands
 * upward, so the input never moves when the list height changes). The browser
 * keeps its last visited location across opens (spec scenario 22).
 */
export const DesktopWorkdirSelector: React.FC<DesktopWorkdirSelectorProps> = ({
  workdir,
  recentWorkdirs,
  host,
  onSelectWorkdir,
  onSelectRemotePath,
  onListRemoteDir,
  onSelectRecentWorkdir,
  onRemoveRecentWorkdir,
}) => {
  const [browsing, setBrowsing] = useState(false);
  const [currentPath, setCurrentPath] = useState("~");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyboard selection index into the filtered list; -1 = nothing selected.
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const lastPathRef = useRef("~");
  const isRemote = host !== undefined && host !== "local";
  // Some mount paths render before the recents list arrives (undefined), so
  // default here rather than only inside the menu JSX.
  const recents = recentWorkdirs ?? [];

  // The recents menu runs the shared roving-tabindex keyboard model (Arrow
  // keys move the focused item). Item order: 最近打开 entries, then 浏览….
  // Activation closes explicitly per branch (remote 浏览… opens the browser
  // panel instead of returning focus), so closeOnActivate stays off.
  const {
    open: menuOpen,
    openMenu,
    closeMenu,
    closeReturningFocus,
    getItemProps,
  } = useRovingMenu(menuRef, {
    itemSelector: ".desktop-workdir-menu-item",
    itemCount: recents.length + 1,
    triggerRef,
    closeOnActivate: false,
    onActivate: (i) => {
      if (i < recents.length) {
        handleSelectRecent(recents[i]);
      } else if (isRemote) {
        openBrowser();
      } else {
        handleBrowse();
      }
    },
  });

  // Only the remote browser owns click-outside here — closing the main menu
  // on outside clicks is handled inside useRovingMenu. Listener registered
  // one tick later inside useClickOutside.
  useClickOutside({
    refs: [menuRef],
    enabled: browsing,
    onClickOutside: () => setBrowsing(false),
  });

  const dirName = workdir
    ? workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
    : isRemote
      ? "选择远程目录…"
      : "选择工作目录…";

  const requestList = useCallback(
    (path: string) => {
      if (!onListRemoteDir) return;
      setCurrentPath(path);
      setLoading(true);
      setError(null);
      // Navigating to another directory resets the filter keyword — the
      // keyword targets the currently listed single-level directory list.
      setFilterKeyword("");
      setSelectedIndex(-1);
      onListRemoteDir(path, String(++requestIdRef.current));
    },
    [onListRemoteDir],
  );

  // Consume requestId-matched replies. Stale replies (panel closed, a newer
  // request superseded this one) are dropped.
  useEffect(() => {
    if (!browsing) return;
    const onMessage = (e: MessageEvent) => {
      const message = e.data;
      if (message.command !== "desktopRemoteDirList") return;
      if (String(message.requestId) !== String(requestIdRef.current)) return;
      setLoading(false);
      if (message.error) {
        setError(String(message.error));
        return;
      }
      setCurrentPath(message.resolvedPath);
      setDirs(message.dirs ?? []);
      lastPathRef.current = message.resolvedPath;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [browsing]);

  const handleBrowse = useCallback(() => {
    onSelectWorkdir();
    closeReturningFocus();
  }, [onSelectWorkdir, closeReturningFocus]);

  const openBrowser = useCallback(() => {
    closeMenu();
    setBrowsing(true);
    // Location memory: reopen at the last visited directory (or home on the
    // first open of a session), spec scenario 22.
    requestList(lastPathRef.current || "~");
    requestAnimationFrame(() => filterInputRef.current?.focus());
  }, [closeMenu, requestList]);

  const selectCurrent = useCallback(() => {
    if (!currentPath || loading || error) return;
    setBrowsing(false);
    onSelectRemotePath?.(currentPath, host as string);
  }, [currentPath, loading, error, host, onSelectRemotePath]);

  /**
   * Enter-without-selection on the filter input. Only an absolute-path-shaped
   * value (`/…` or `~…`) jumps straight to that path; a bare keyword is just
   * the live filter and does nothing here (spec scenario 20). With a keyboard
   * selection active, Enter enters that subdirectory instead (see onKeyDown).
   */
  const submitFilterInput = useCallback(() => {
    const p = filterKeyword.trim();
    if (!p || !(p.startsWith("/") || p.startsWith("~"))) return;
    setBrowsing(false);
    onSelectRemotePath?.(p, host as string);
  }, [filterKeyword, host, onSelectRemotePath]);

  const handleSelectRecent = useCallback(
    (path: string) => {
      onSelectRecentWorkdir(path, host);
      closeReturningFocus();
    },
    [host, onSelectRecentWorkdir, closeReturningFocus],
  );

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      onRemoveRecentWorkdir(path, host);
    },
    [host, onRemoveRecentWorkdir],
  );

  // Breadcrumb segments of the current path: ['/', 'home', 'user', 'project'].
  const crumbs = currentPath.startsWith("/")
    ? ["/", ...currentPath.split("/").filter(Boolean)]
    : currentPath.split("/").filter(Boolean);

  // Live filter over the single-level directory list (case-insensitive
  // substring), spec scenario 20. The keyword also highlights matches.
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

  // Keep the highlighted item in view while moving with the keyboard.
  useEffect(() => {
    const el = selectedItemRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  /** Filter the single-level list by the typed keyword (case-insensitive
   *  substring). Filtering auto-selects the first match so Enter can go
   *  straight into it without an extra ArrowDown (spec scenario 20). */
  const handleFilterChange = (value: string) => {
    setFilterKeyword(value);
    const next = value.trim().toLowerCase();
    const matches = next
      ? dirs.filter((d) => d.toLowerCase().includes(next))
      : dirs;
    setSelectedIndex(matches.length > 0 ? 0 : -1);
  };

  return (
    <div className="desktop-workdir-container" ref={menuRef}>
      <div
        className="desktop-workdir-trigger"
        ref={triggerRef}
        onClick={() => {
          if (menuOpen) closeReturningFocus();
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
          } else if (e.key === "Escape" && menuOpen) {
            e.preventDefault();
            closeReturningFocus();
          }
        }}
        title={workdir ?? (isRemote ? "选择远程目录…" : "选择工作目录…")}
        data-testid="desktop-workdir"
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        role="button"
        tabIndex={0}
      >
        <ContextDirectoryIcon className="desktop-workdir-icon" />
        <span className="desktop-workdir-name">{dirName}</span>
        <PermCaretIcon className="desktop-workdir-caret" />
      </div>
      {menuOpen && !browsing && (
        <div
          className="desktop-workdir-menu"
          role="listbox"
          data-testid="desktop-workdir-menu"
        >
          {recents.length > 0 && (
            <div className="desktop-workdir-menu-label">最近打开</div>
          )}
          {recents.map((dir, i) => {
            // VS Code-style two-line entry: basename on top, parent path
            // below in de-emphasized text (keeps long paths readable and
            // disambiguates same-named folders).
            const segments = dir.split(/[\\/]/).filter(Boolean);
            const base = segments.pop() || dir;
            const parent = dir
              .slice(0, dir.length - base.length)
              .replace(/[\\/]+$/, "");
            // Nested remove button owns its own keys — the row's roving key
            // handling must ignore events bubbling up from it.
            const itemProps = getItemProps(i);
            return (
              <div
                key={dir}
                className="desktop-workdir-menu-item"
                role="option"
                {...itemProps}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  itemProps.onKeyDown(e);
                }}
                title={dir}
                data-testid="desktop-workdir-recent-item"
              >
                <span className="codicon codicon-folder"></span>
                <span className="desktop-workdir-menu-path">
                  <span className="desktop-workdir-menu-name">{base}</span>
                  {parent && (
                    <span className="desktop-workdir-menu-parent">
                      {parent}
                    </span>
                  )}
                </span>
                <button
                  className="desktop-workdir-menu-remove"
                  title="从列表移除"
                  onClick={(e) => handleRemoveRecent(e, dir)}
                  data-testid="desktop-workdir-recent-remove"
                >
                  <CloseIcon className="desktop-workdir-menu-remove-icon" />
                </button>
              </div>
            );
          })}
          <div className="desktop-workdir-menu-separator" />
          <div
            className="desktop-workdir-menu-item"
            role="option"
            {...getItemProps(recents.length)}
            data-testid="desktop-workdir-browse"
          >
            <span className="codicon codicon-folder-opened"></span>
            <span>{isRemote ? "浏览…" : "浏览…"}</span>
          </div>
        </div>
      )}
      {browsing && (
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
                      setBrowsing(false);
                      triggerRef.current?.focus();
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
                  // a selection it falls back to the absolute-path jump
                  // (spec scenario 20).
                  if (selectedIndex >= 0 && filteredDirs[selectedIndex]) {
                    requestList(
                      joinPath(currentPath, filteredDirs[selectedIndex]),
                    );
                  } else {
                    submitFilterInput();
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setBrowsing(false);
                  triggerRef.current?.focus();
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
      )}
    </div>
  );
};

export default DesktopWorkdirSelector;
