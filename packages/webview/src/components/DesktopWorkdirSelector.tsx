import React, { useState, useRef, useCallback } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
import { ContextDirectoryIcon, PermCaretIcon, CloseIcon } from "./HeaderIcons";
import { FolderIcon } from "./FolderIcon";
import { DirectoryBrowser } from "./DirectoryBrowser";
import "../styles/DesktopApp.css";

/**
 * 新会话未指定目录时的常驻引导气泡内容（从 CodeWave 高码应用唤起 IDE 后，
 * 用户不知道要先指定文件夹才能提问——气泡指向选择器把这一步讲清楚）。
 *
 * 只在**没有目录**时出现：已有目录（宿主自动带出的最近目录、或用户自己选的）
 * 一律不再多一次确认，见 ChatApp 的 guide 传参。
 */
export interface DesktopWorkdirGuide {
  /** 气泡主句。 */
  text: string;
  /** 选目录按钮的文案，默认「选择文件夹」。 */
  actionLabel?: string;
  /** 点「×」关闭：本会话内不再出现（选择器本身仍可用）。 */
  onDismiss: () => void;
}

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
   * reply arrives as a `desktopRemoteDirList` window message). Delegated to
   * the shared DirectoryBrowser.
   */
  onListRemoteDir?: (path: string, requestId: string) => void;
  /** `host` scopes the recents lookup to a specific host (defaults to the current one). */
  onSelectRecentWorkdir: (path: string, host?: string) => void;
  onRemoveRecentWorkdir: (path: string, host?: string) => void;
  /**
   * 常驻引导气泡：不传即不渲染。仅在「桌面端 + 新会话 + 尚未选目录」时由 ChatApp
   * 传入——选到目录后 effectiveWorkdir 非空，气泡自动收回（无需额外清理）。
   */
  guide?: DesktopWorkdirGuide;
}

/**
 * Workdir dropdown shown at the top-left of the message input (desktop host,
 * new-session state only). Same pattern as the permission-mode dropdown in
 * MessageInput: a relative container holds the trigger + an absolutely
 * positioned menu. The menu expands UPWARD (bottom:100%) because the input
 * sits at the bottom of the viewport. Clicking outside closes it.
 *
 * On a remote host the 浏览… entry opens the shared DirectoryBrowser panel
 * (VS Code Remote-SSH-style: breadcrumbs, single-level list with live keyword
 * filtering, filter input + 选择此目录 anchored at the bottom). The browser
 * keeps its last visited location across opens (spec scenario 22) — the
 * location lives HERE (lastPathRef), not in the browser, which remounts each
 * open and reports each resolved path back via onResolved.
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
  guide,
}) => {
  const [browsing, setBrowsing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const lastPathRef = useRef("~");
  // Directory listing request ids: allocated HERE, in the component that owns
  // the host channel and survives panel close/reopen — a stray reply from the
  // previous session must not collide with a reused id (and the browser panel
  // remounts on every open, so it cannot own the counter).
  const requestIdRef = useRef(0);
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

  const handleBrowse = useCallback(() => {
    onSelectWorkdir();
    closeReturningFocus();
  }, [onSelectWorkdir, closeReturningFocus]);

  const openBrowser = useCallback(() => {
    closeMenu();
    setBrowsing(true);
  }, [closeMenu]);

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

  return (
    <div className="desktop-workdir-container" ref={menuRef}>
      <div
        className={`desktop-workdir-trigger${guide ? " desktop-workdir-trigger--guide" : ""}`}
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
      {guide && (
        <div
          className="desktop-workdir-guide"
          role="note"
          data-testid="desktop-workdir-guide"
        >
          <div className="desktop-workdir-guide-row">
            <span className="desktop-workdir-guide-text">{guide.text}</span>
            <button
              className="desktop-workdir-guide-close"
              title="我知道了"
              aria-label="关闭引导"
              onClick={guide.onDismiss}
              data-testid="desktop-workdir-guide-close"
            >
              <CloseIcon className="desktop-workdir-guide-close-icon" />
            </button>
          </div>
          <div className="desktop-workdir-guide-actions">
            <button
              className="desktop-workdir-guide-action"
              // 文案两档统一，动作按主机分流：本地 → 系统目录对话框
              // （desktopSelectWorkdir），远程 → 远程目录浏览面板（系统对话框选不到
              // 远端路径，真宿主还会把主机钉回本地）。
              onClick={() => {
                if (isRemote) openBrowser();
                else handleBrowse();
              }}
              data-testid="desktop-workdir-guide-action"
            >
              {guide.actionLabel ?? "选择文件夹"}
            </button>
          </div>
          <span className="desktop-workdir-guide-arrow" aria-hidden="true" />
        </div>
      )}
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
                {/* 1029 评论（她点 `span.codicon.codicon-folder`）：「替换图标，展开收起的
                    都换」⇒ 最近打开项（收起态）与「浏览…」（展开态）都换成设计源矢量，
                    见 FolderIcon。原来这两处是 codicon 字体字形。 */}
                <FolderIcon />
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
          {recents.length > 0 && (
            <div className="desktop-workdir-menu-separator" />
          )}
          <div
            className="desktop-workdir-menu-item"
            role="option"
            {...getItemProps(recents.length)}
            data-testid="desktop-workdir-browse"
          >
            <FolderIcon expanded />
            <span>{isRemote ? "浏览…" : "浏览…"}</span>
          </div>
        </div>
      )}
      {browsing && onListRemoteDir && (
        <DirectoryBrowser
          replyCommand="desktopRemoteDirList"
          onRequestList={(path) => {
            const requestId = String(++requestIdRef.current);
            onListRemoteDir(path, requestId);
            return requestId;
          }}
          // Location memory: reopen at the last visited directory (or home on
          // the first open of a session), spec scenario 22.
          initialPath={lastPathRef.current || "~"}
          onResolved={(p) => {
            lastPathRef.current = p;
          }}
          onSelect={(p) => {
            setBrowsing(false);
            onSelectRemotePath?.(p, host as string);
          }}
          onClose={() => {
            setBrowsing(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
};

export default DesktopWorkdirSelector;
