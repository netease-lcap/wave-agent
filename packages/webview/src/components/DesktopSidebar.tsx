import React, { useState, useRef, RefObject } from "react";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { AccountCard, type AccountCardAccount } from "./AccountCard";
import { CodewaveLogo } from "./CodewaveLogo";
import {
  NewSessionIcon,
  CollapseIcon,
  MoreIcon,
  QueueTrashIcon,
  SplitIcon,
} from "./HeaderIcons";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
import { isMacHiddenTitlebar } from "../utils/platform";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import "../styles/DesktopApp.css";

/** dataTransfer MIME carrying { workdir, sessionId } while a sidebar session drags. */
export const SESSION_DRAG_MIME = "application/x-wave-session";

/** 会话状态看板入口图标（对齐原型 figma/activity.svg）。常态跟随文本色，
 *  看板打开时（is-active）品牌红填充——原型 active 图标 #c1292e。 */
const ActivityIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "block" }}
    aria-hidden="true"
  >
    <path d="M10.6318 13.1409C10.9908 13.1409 11.2822 13.4323 11.2822 13.7913C11.2821 14.1502 10.9908 14.4417 10.6318 14.4417H5.25C4.89118 14.4415 4.60069 14.1501 4.60059 13.7913C4.60059 13.4324 4.89112 13.141 5.25 13.1409H10.6318Z" />
    <path d="M10.7354 4.92407C10.9867 4.66806 11.3981 4.66405 11.6543 4.91528C11.9102 5.16665 11.9142 5.57807 11.6631 5.83423L9.57031 7.96704L9.4834 8.04126C9.26851 8.19441 8.97705 8.20377 8.75 8.05493L6.59375 6.63989L5.26074 7.97192C5.00704 8.22533 4.59558 8.2252 4.3418 7.97192C4.08796 7.71808 4.08795 7.30584 4.3418 7.052L6.04785 5.34595C6.26572 5.12833 6.6068 5.09394 6.86426 5.26294L9.0166 6.67603L10.7354 4.92407Z" />
    <path d="M12.1553 0.891846C13.6188 0.891846 14.8056 2.07871 14.8057 3.54224V9.84888C14.8057 11.0363 13.8427 11.9993 12.6553 11.9993H3.84375C2.38039 11.9991 1.19434 10.8123 1.19434 9.34888V3.54224C1.19437 2.0788 2.38034 0.891991 3.84375 0.891846H12.1553ZM3.84375 2.19263C3.09831 2.19277 2.49417 2.79677 2.49414 3.54224V9.34888C2.49414 10.0943 3.09829 10.6983 3.84375 10.6985H12.6553C13.1247 10.6985 13.5049 10.3183 13.5049 9.84888V3.54224C13.5048 2.79668 12.9008 2.19263 12.1553 2.19263H3.84375Z" />
  </svg>
);

/** Row menu anchored under a session row's "更多" button (fixed positioning
 *  escapes the sidebar's overflow:hidden). 并排打开 + 删除会话. */
const SessionItemMenu: React.FC<{
  anchorRect: DOMRect;
  onSplit: () => void;
  onDelete: () => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}> = ({ anchorRect, onSplit, onDelete, onClose, triggerRef }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".desktop-session-menu-item",
    itemCount: 2,
    triggerRef,
    closeOnActivate: true,
    onRequestClose: onClose,
    onActivate: (i) => (i === 0 ? onSplit() : onDelete()),
  });

  // Click-outside close; listener registered one tick later (inside
  // useClickOutside) so the mousedown that just opened the menu is not
  // treated as an outside click.
  useClickOutside({
    refs: [menuRef],
    onClickOutside: onClose,
  });

  const menuWidth = 148;
  // Right-align the menu to the trigger, clamped to the viewport.
  const left = Math.max(
    8,
    Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8),
  );
  return (
    <div
      ref={menuRef}
      className="desktop-session-menu"
      role="menu"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 4,
        left,
        width: menuWidth,
      }}
      data-testid="desktop-session-menu"
    >
      <div
        className="desktop-session-menu-item"
        role="menuitem"
        {...getItemProps(0)}
        data-testid="desktop-session-menu-split"
      >
        <SplitIcon className="desktop-session-menu-icon" />
        <span>并排打开</span>
      </div>
      <div
        className="desktop-session-menu-item desktop-session-menu-item--danger"
        role="menuitem"
        {...getItemProps(1)}
        data-testid="desktop-session-menu-delete"
      >
        <QueueTrashIcon className="desktop-session-menu-icon" />
        <span>删除会话</span>
      </div>
    </div>
  );
};

export interface DesktopSidebarProps {
  onNewSession: () => void;
  /** Cmd/Ctrl+Click on the 新对话 button: start the new session in an additional pane. */
  onNewSessionInPane: () => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
  /** Desktop host: the more menu (settings/enterprise console/login) lives here. */
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onOpenHelpDocs: () => void;
  onLogin: () => void;
  onLogout: () => void;
  /** 侧边栏底部账户卡片 (desktopAccountInfo push). */
  account?: AccountCardAccount | null;
  /** 账户卡片更新按钮 S0–S6（spec desktop-account-card-and-panel-tabs.md）. */
  onDownloadUpdate?: () => void;
  onRestartApp?: () => void;
  /**
   * Host the focused pane runs on ('local' or an SSH host name). Labels the
   * more menu's 登录/退出登录 entry so it names the auth subject it acts on.
   */
  hostLabel?: string;
  /** Session tree groups, one per recent directory (FR-020). */
  sessionTree: DesktopSessionGroup[];
  /** Active session id — gets the running dot while streaming. */
  currentSessionId?: string;
  /** Sessions shown in panes — those other than currentSessionId get a weak highlight. */
  visibleSessionIds?: string[];
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Cmd/Ctrl+Click: open the session in an additional pane to the right. */
  onOpenPane: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index (also cleans up worktree if applicable). */
  onDeleteSession: (sessionId: string) => void;
  /** Sidebar fully hidden (chat takes the whole width); the header's expand
   *  button restores it. */
  collapsed?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Batch 2 会话状态看板: brand-row 活动 button opens the board view. When
   *  active the icon renders brand-red (spec 场景 1 highlight state). */
  sessionBoardActive?: boolean;
  onOpenSessionBoard?: () => void;
}

const dirName = (workdir: string): string =>
  workdir.split("/").filter(Boolean).pop() ?? workdir;

// A group is identified by (host, workdir) — the same directory may exist on
// the local machine and on an SSH host, and those are distinct groups (spec
// docs/specs/ui/desktop-app.md 「SSH 远程主机」scenario 9).
const groupKey = (group: DesktopSessionGroup): string =>
  `${group.host}:${group.workdir}`;

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().startsWith("MAC");

/**
 * Left rail for the desktop host: app title, "新对话" button, and the session
 * history tree (FR-020) — one collapsible group per recent directory holding up
 * to 5 recent sessions. Clicking a session restores it (switching workdir first
 * when it lives in another directory).
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  onNewSessionInPane,
  isStreaming,
  disabled,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onLogin,
  onLogout,
  account,
  onDownloadUpdate,
  onRestartApp,
  hostLabel,
  sessionTree,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  collapsed = false,
  onCollapsedChange,
  sessionBoardActive = false,
  onOpenSessionBoard,
}) => {
  // Explicit expand/collapse overrides; groups without an entry are expanded
  // by default — the tree starts fully expanded on every app launch (expansion
  // state is not persisted).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // Session awaiting delete confirmation; non-null shows the ConfirmDialog.
  const [pendingDelete, setPendingDelete] = useState<{
    sessionId: string;
    title: string;
    description?: string;
  } | null>(null);
  // Session whose row menu (并排打开/删除) is open, with the trigger's rect so
  // the fixed-position menu anchors under the button.
  const [openMenuFor, setOpenMenuFor] = useState<{
    sessionId: string;
    rect: DOMRect;
  } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  // Modifier key label for the side-by-side hints, same platform branch as the
  // click handlers below (Cmd on macOS / Ctrl elsewhere).
  const modKeyLabel = isMacPlatform() ? "Cmd" : "Ctrl";

  // Tooltip anchors live on the hover-highlight containers themselves (li for
  // session rows, the button for 新对话), so both hints start at the row's
  // visual right edge. Per-session ref objects are created lazily and reused
  // across renders — a fresh object per render would re-attach the refs.
  const sessionAnchorsRef = useRef(new Map<string, RefObject<HTMLLIElement>>());
  const getAnchorRef = (sessionId: string) => {
    let anchor = sessionAnchorsRef.current.get(sessionId);
    if (!anchor) {
      anchor = { current: null };
      sessionAnchorsRef.current.set(sessionId, anchor);
    }
    return anchor;
  };
  const newChatAnchorRef = useRef<HTMLButtonElement | null>(null);
  // Per-row 更多 trigger refs (same lazy-map pattern as the tooltip anchors).
  const moreBtnAnchorsRef = useRef(
    new Map<string, RefObject<HTMLButtonElement>>(),
  );
  const getMoreRef = (sessionId: string) => {
    let anchor = moreBtnAnchorsRef.current.get(sessionId);
    if (!anchor) {
      anchor = { current: null };
      moreBtnAnchorsRef.current.set(sessionId, anchor);
    }
    return anchor;
  };

  const isExpanded = (group: DesktopSessionGroup): boolean =>
    overrides[groupKey(group)] ?? true;

  const toggleGroup = (group: DesktopSessionGroup) => {
    setOverrides((prev) => ({
      ...prev,
      [groupKey(group)]: !(prev[groupKey(group)] ?? true),
    }));
  };

  // Tree-level keyboard navigation (modeled on Claude's sidebar):
  // - Session main buttons are all natively Tab-focusable — Tab walks the rows
  //   one by one (group headers included); the arrows are an accelerator, not
  //   the only way in.
  // - ↑/↓/Home/End move focus between session main buttons (skipping group
  //   headers; ↓ past the last row wraps to the first), scrolling the target
  //   into view. When focus sits on a delete button, the movement continues
  //   from that row's main button.
  // - ←/→ move within one row between its main and 更多 buttons.
  const handleTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tree = treeRef.current;
    const active = document.activeElement;
    if (!tree || !(active instanceof HTMLElement) || !tree.contains(active))
      return;
    // Keys inside an open row menu belong to the menu's own roving model —
    // the tree navigation must not steal focus (the menu renders inside the
    // row's li, so without this guard ↑/↓ would jump back to session mains).
    if (active.closest(".desktop-session-menu")) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const row = active.closest<HTMLElement>(".desktop-session-item");
      if (!row) return;
      const parts = Array.from(
        row.querySelectorAll<HTMLElement>(
          "[data-session-main], [data-session-more]",
        ),
      );
      if (parts.length < 2 || !parts.includes(active)) return;
      const step = e.key === "ArrowRight" ? 1 : -1;
      const nextIdx = Math.max(
        0,
        Math.min(parts.length - 1, parts.indexOf(active) + step),
      );
      if (nextIdx === parts.indexOf(active)) return;
      e.preventDefault();
      parts[nextIdx].focus();
      return;
    }

    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) {
      return;
    }

    // Collapsed groups don't render their <ul> at all, so everything matching
    // here is visible — no layout-based filtering (jsdom has none either).
    const mains = Array.from(
      tree.querySelectorAll<HTMLElement>("[data-session-main]"),
    );
    if (mains.length === 0) return;
    const currentRow = active.closest<HTMLElement>(".desktop-session-item");
    const currentMain =
      currentRow?.querySelector<HTMLElement>("[data-session-main]") ?? null;
    let next: HTMLElement;
    if (e.key === "Home") {
      next = mains[0];
    } else if (e.key === "End") {
      next = mains[mains.length - 1];
    } else {
      const from = currentMain ? mains.indexOf(currentMain) : -1;
      if (from === -1) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      next = mains[(from + dir + mains.length) % mains.length];
    }
    if (next === active) return;
    e.preventDefault();
    next.focus();
    if (typeof next.scrollIntoView === "function") {
      next.scrollIntoView({ block: "nearest" });
    }
  };

  const renderSession = (
    group: DesktopSessionGroup,
    session: DesktopSessionEntry,
  ) => {
    // FR-031 multi-session parallel: the host derives `session.running` for every
    // live session; the active one also falls back to the local streaming flag so
    // its dot appears without waiting for the next tree refresh.
    const running =
      session.running ||
      (session.sessionId === currentSessionId && isStreaming);
    // Waiting takes precedence: a session blocked on user confirmation is not
    // meaningfully "running", and it needs attention more than the running dot.
    const waiting = session.waitingConfirmation ?? false;
    const isCurrent = session.sessionId === currentSessionId;
    // A session displayed in a non-focused pane gets the weak highlight.
    const isVisible =
      !isCurrent && (visibleSessionIds?.includes(session.sessionId) ?? false);
    return (
      <li
        key={session.sessionId}
        className={`desktop-session-item${isCurrent ? " desktop-session-item--current" : ""}${isVisible ? " desktop-session-item--visible" : ""}`}
        draggable
        onDragStart={(e) => {
          // Drag into the chat area opens the session in a new pane (drop on a
          // pane gap inserts there, anywhere else appends at the right end).
          e.dataTransfer.setData(
            SESSION_DRAG_MIME,
            JSON.stringify({
              workdir: group.workdir,
              sessionId: session.sessionId,
            }),
          );
          try {
            e.dataTransfer.effectAllowed = "copy";
          } catch {
            // jsdom's DataTransfer polyfill exposes a read-only effectAllowed.
          }
        }}
        data-testid={`desktop-session-item-${session.sessionId}`}
        ref={getAnchorRef(session.sessionId)}
      >
        {/*
          Tooltip anchor = the li's hover-highlight container (via anchorRef),
          so the hint starts at the row's right edge (position="right", offset
          8px). The wrapper span only carries the row content + hover events.
          The delete button stays a sibling so hovering it shows its own
          "删除会话" title instead of the drag hint.
        */}
        <Tooltip
          text={`可拖拽或 ${modKeyLabel}+点击 并排打开`}
          position="right"
          className="desktop-session-item-tooltip"
          anchorRef={getAnchorRef(session.sessionId)}
        >
          <button
            type="button"
            className="desktop-session-item-main"
            aria-current={isCurrent || undefined}
            data-session-main=""
            onClick={(e) => {
              // Cmd on macOS / Ctrl elsewhere opens the session in a new pane
              // to the right; a plain click keeps the replace-focused-pane
              // behavior.
              if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
                onOpenPane(group.workdir, session.sessionId);
              } else {
                onSelectSession(group.workdir, session.sessionId);
              }
            }}
            data-testid={`desktop-session-main-${session.sessionId}`}
          >
            {running || waiting ? (
              <i
                className={`codicon codicon-${waiting ? "bell" : "loading codicon-modifier-spin"} desktop-session-status-icon`}
                style={{
                  color: waiting
                    ? "var(--vscode-charts-purple, #b180d7)"
                    : "var(--vscode-charts-blue, #59a4f9)",
                }}
                title={waiting ? "等待确认" : "正在运行"}
              />
            ) : (
              <span className="desktop-session-dot" aria-hidden="true" />
            )}
            <span className="desktop-session-title">
              {session.title || "新对话"}
            </span>
          </button>
        </Tooltip>
        <button
          type="button"
          ref={getMoreRef(session.sessionId)}
          className="desktop-session-more-btn"
          title="更多操作"
          aria-label="更多操作"
          aria-haspopup="menu"
          aria-expanded={
            openMenuFor?.sessionId === session.sessionId || undefined
          }
          data-session-more=""
          // Reached via ←/→ from the row's main button, never via Tab.
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setOpenMenuFor((prev) =>
              prev?.sessionId === session.sessionId
                ? null
                : { sessionId: session.sessionId, rect },
            );
          }}
          data-testid={`desktop-session-more-${session.sessionId}`}
        >
          <MoreIcon className="desktop-session-more-icon" />
        </button>
        {openMenuFor?.sessionId === session.sessionId && (
          <SessionItemMenu
            anchorRect={openMenuFor.rect}
            triggerRef={getMoreRef(session.sessionId)}
            onSplit={() => {
              setOpenMenuFor(null);
              onOpenPane(group.workdir, session.sessionId);
            }}
            onDelete={() => {
              setOpenMenuFor(null);
              // Worktree sessions warn about the worktree dir + temp branch
              // and the loss of uncommitted changes.
              const label = session.title || "新对话";
              setPendingDelete({
                sessionId: session.sessionId,
                title: `确定删除会话「${label}」？`,
                description: session.hasWorktree
                  ? "该会话的 worktree 目录与临时分支将一并删除，未提交的改动将丢失。"
                  : undefined,
              });
            }}
            onClose={() => setOpenMenuFor(null)}
          />
        )}
      </li>
    );
  };

  // macOS 隐藏标题栏（titleBarStyle: "hidden"，仅 darwin）：真机需要一条
  // 44px 顶部窗口行承载系统红绿灯并充当窗口拖拽区（spec「macOS 隐藏标题栏」），
  // 见下方渲染分支；Windows/Linux 真机保留系统原生标题栏，不渲染。
  const macHiddenTitlebar = isMacHiddenTitlebar();

  // Fully collapsed: nothing renders, no reserved width, no overlay — the chat
  // takes the whole pane width (spec 「侧边栏收起/展开」scenario 1).
  if (collapsed) return null;

  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      {/* macOS 窗口控制行（对齐 codechat 侧栏：44px 红绿灯行）。两种形态：
          - 真机 macOS：系统标题栏已隐藏，红绿灯由系统绘制在该行左端——行内
            不画假圆点，整行为 `-webkit-app-region: drag` 拖拽区（空行）。
          - 原型预览/IDE mock（waveHostType 未注入、浏览器无系统窗口 chrome）：
            绘制假红绿灯圆点行。
          真机 Windows/Linux 用系统原生标题栏，两者都不渲染。 */}
      {macHiddenTitlebar ? (
        <div
          className="sidebar-window-row sidebar-window-row--mac-drag"
          aria-hidden="true"
        />
      ) : typeof window !== "undefined" && window.waveHostType !== "desktop" ? (
        <div className="sidebar-window-row" aria-hidden="true">
          <span className="window-controls">
            <span className="window-dot window-dot--close" />
            <span className="window-dot window-dot--minimize" />
            <span className="window-dot window-dot--maximize" />
          </span>
        </div>
      ) : null}
      <div className="desktop-sidebar-header">
        <CodewaveLogo height={14} />
        {/* The header is space-between, so both buttons must live in one
            grouped flex row — otherwise "更多" gets pushed to the middle. */}
        <div className="desktop-sidebar-actions">
          {onOpenSessionBoard && (
            <Tooltip text="活动" position="bottom">
              <button
                className={`desktop-sidebar-more-btn${sessionBoardActive ? " is-active" : ""}`}
                onClick={onOpenSessionBoard}
                data-testid="desktop-sidebar-activity"
                aria-label="活动"
                aria-pressed={sessionBoardActive}
              >
                <ActivityIcon />
              </button>
            </Tooltip>
          )}
          <Tooltip text="收起侧边栏" position="bottom">
            <button
              className="desktop-sidebar-more-btn"
              onClick={() => onCollapsedChange(true)}
              data-testid="desktop-sidebar-collapse"
              aria-label="收起侧边栏"
            >
              <CollapseIcon />
            </button>
          </Tooltip>
        </div>
      </div>
      <Tooltip
        text={
          isMacPlatform()
            ? "新对话（Cmd+Click 并排打开）"
            : "新对话（Ctrl+Click 并排打开）"
        }
        position="right"
        className="desktop-sidebar-new-chat-tooltip"
        anchorRef={newChatAnchorRef}
      >
        <button
          ref={newChatAnchorRef}
          className="desktop-sidebar-new-chat"
          onClick={(e) => {
            // Cmd on macOS / Ctrl elsewhere opens the new session side-by-side
            // in a fresh pane; a plain click keeps the replace-focused-pane
            // behavior (same branching as session items above).
            if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
              onNewSessionInPane();
            } else {
              onNewSession();
            }
          }}
          // 新对话在会话运行（streaming）期间也可用 — 多会话并行，旧会话在后台继续生成（FR-031）。
          disabled={disabled}
          data-testid="desktop-new-session"
        >
          <NewSessionIcon className="" />
          <span>新对话</span>
        </button>
      </Tooltip>
      <div
        ref={treeRef}
        onKeyDown={handleTreeKeyDown}
        className="desktop-session-tree"
        data-testid="desktop-session-tree"
      >
        {sessionTree.map((group) => {
          const expanded = isExpanded(group);
          return (
            <div
              key={groupKey(group)}
              className="desktop-session-group"
              data-testid={`desktop-session-group-${groupKey(group)}`}
            >
              <button
                type="button"
                className="desktop-session-group-header"
                onClick={() => toggleGroup(group)}
                aria-expanded={expanded}
                aria-label={`${expanded ? "收起分组" : "展开分组"} ${dirName(group.workdir)}`}
                title={group.workdir}
              >
                <span className="desktop-session-group-name">
                  {dirName(group.workdir)}
                </span>
                <span
                  className={`codicon codicon-chevron-${expanded ? "down" : "right"}`}
                ></span>
                {group.host !== "local" && (
                  <span
                    className="desktop-session-group-host"
                    title={group.host}
                  >
                    {group.host}
                  </span>
                )}
              </button>
              {expanded &&
                (group.sessions.length === 0 ? (
                  <div className="desktop-session-empty">无会话</div>
                ) : (
                  <ul className="desktop-session-items">
                    {group.sessions.map((session) =>
                      renderSession(group, session),
                    )}
                  </ul>
                ))}
            </div>
          );
        })}
      </div>
      {account !== undefined && account !== null && (
        <AccountCard
          account={account}
          hostLabel={hostLabel === "local" ? undefined : hostLabel}
          onLogin={onLogin}
          onLogout={onLogout}
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onOpenHelpDocs={onOpenHelpDocs}
          onDownloadUpdate={onDownloadUpdate}
          onRestartApp={onRestartApp}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          description={pendingDelete.description}
          onConfirm={() => {
            onDeleteSession(pendingDelete.sessionId);
            sessionAnchorsRef.current.delete(pendingDelete.sessionId);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default DesktopSidebar;
