import React, { useEffect, useState, useRef, RefObject } from "react";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { MoreIcon } from "./HeaderIcons";
import { MoreMenu } from "./MoreMenu";
import { useRovingMenu } from "../utils/useRovingMenu";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import "../styles/DesktopApp.css";

/** dataTransfer MIME carrying { workdir, sessionId } while a sidebar session drags. */
export const SESSION_DRAG_MIME = "application/x-wave-session";

/**
 * Codewave wordmark from the designer prototype (figma/logo.svg). The
 * letterforms follow the current text color (theme-adaptive); the "IDE"
 * suffix keeps its lighter weight via opacity; the brand-red slashes stay
 * fixed — red is the brand mark and reads on both light and dark themes.
 */
const CodewaveLogo: React.FC<{ height?: number }> = ({ height = 14 }) => (
  <svg
    width={(height * 212) / 24}
    height={height}
    viewBox="0 0 212 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "block" }}
    role="img"
    aria-label="Wave 代码智聊"
  >
    <g fill="currentColor" opacity="0.55">
      <path d="M198.935 5.51074H211.581V7.80325H201.622V12.9306H210.989V15.2231H201.622V20.8188H212V23.1113H198.935V5.51074Z" />
      <path d="M181.266 5.51074H187.676C190.51 5.51074 192.655 6.29956 194.134 7.90186C195.515 9.3809 196.205 11.5255 196.205 14.311C196.205 17.0719 195.49 19.2165 194.085 20.7449C192.606 22.3225 190.461 23.1113 187.626 23.1113H181.266V5.51074ZM183.953 7.80325V20.8188H187.133C189.352 20.8188 191.003 20.2765 192.039 19.2165C193.049 18.1565 193.567 16.5296 193.567 14.311C193.567 12.0432 193.049 10.4162 192.063 9.3809C191.028 8.32092 189.401 7.80325 187.183 7.80325H183.953Z" />
      <path d="M175.105 5.5105H177.767V23.1111H175.105V5.5105Z" />
    </g>
    <g fill="currentColor">
      <path d="M19.1857 23.034H12.0057C5.75216 23.034 0.579474 18.0929 0.50227 11.8393C0.425066 5.50859 5.52054 0.335938 11.8513 0.335938H21.193C21.3474 0.335938 21.4246 0.490353 21.3474 0.644761L19.4945 3.34689C19.4173 3.4241 19.4173 3.42411 19.3401 3.42411H12.0057C7.52785 3.50132 3.74487 7.05267 3.66766 11.5305C3.59046 16.1627 7.29624 19.8686 11.8513 19.8686H21.0386C21.193 19.8686 21.2702 20.023 21.193 20.1774L19.3401 22.8795C19.3401 22.9567 19.2629 23.034 19.1857 23.034Z" />
      <path d="M60.3354 20.9495C59.6405 20.9495 59.1001 20.409 59.1001 19.7142V0.490392C59.1001 0.335984 59.0229 0.258789 58.8685 0.258789H56.3208C56.1664 0.258789 56.0892 0.335984 56.0892 0.490392V8.51962C54.6223 7.12995 52.615 6.2807 50.3761 6.2807C45.7438 6.2807 42.038 10.0637 42.038 14.6187C42.038 19.251 45.821 22.9568 50.3761 22.9568C52.6922 22.9568 54.6995 22.0303 56.2436 20.5634C56.7068 21.9531 57.942 22.9568 59.4861 22.9568H60.2582C60.3354 22.9568 60.4898 22.8796 60.4898 22.7252V21.1039C60.567 21.0267 60.4898 20.9495 60.3354 20.9495ZM50.4533 20.1002C47.4423 20.1002 45.049 17.6297 45.049 14.696C45.049 11.685 47.5195 9.29165 50.4533 9.29165C53.4642 9.29165 55.8576 11.7622 55.8576 14.696C55.8576 17.6297 53.4642 20.1002 50.4533 20.1002Z" />
      <path d="M124.029 20.9495C123.334 20.9495 122.793 20.4091 122.793 19.7143V7.20718C122.793 7.05278 122.716 6.97552 122.562 6.97552H120.014C119.86 6.97552 119.782 7.05278 119.782 7.20718V8.05637C118.161 6.66671 116.077 5.81748 113.761 5.97189C109.514 6.2035 106.117 9.60049 105.809 13.7695C105.5 18.7106 109.36 22.8024 114.224 22.8024C116.385 22.8024 118.393 21.9531 119.937 20.5635C120.323 21.9531 121.635 23.034 123.179 23.034H123.951C124.106 23.034 124.183 22.9568 124.183 22.8024V21.1039C124.26 21.0267 124.183 20.9495 124.029 20.9495ZM114.301 19.8686C111.29 19.8686 108.819 17.3981 108.819 14.3872C108.819 11.3762 111.29 8.90562 114.301 8.90562C117.312 8.90562 119.782 11.3762 119.782 14.3872C119.782 17.3981 117.312 19.8686 114.301 19.8686Z" />
      <path d="M78.7872 16.1626C78.8644 15.6994 78.9415 15.159 78.9415 14.6958C78.9415 9.90911 74.8496 5.97169 69.9858 6.35771C65.894 6.66653 62.497 9.9863 62.2654 14.0781C61.9566 18.942 65.8168 23.0338 70.6035 23.0338C73.6145 23.0338 76.2394 21.4897 77.7063 19.0964C77.7834 18.942 77.7063 18.7876 77.5519 18.7876H74.2321C74.1549 18.7876 74.1549 18.7876 74.0777 18.8648C73.1513 19.6368 71.916 20.1 70.6035 20.1C68.133 20.1 66.0484 18.4015 65.3536 16.1626H78.7872ZM70.5263 9.21428C72.9967 9.21428 75.0813 10.9128 75.7762 13.1517H65.2764C65.9712 10.9128 68.0557 9.21428 70.5263 9.21428Z" />
      <path d="M156.686 16.0855C156.763 15.6222 156.84 15.0818 156.84 14.6186C156.84 9.83196 152.749 5.89454 147.885 6.28056C143.793 6.58938 140.396 9.90915 140.164 14.001C139.855 18.8648 143.716 22.9567 148.502 22.9567C151.513 22.9567 154.138 21.4126 155.605 19.0192C155.682 18.8648 155.605 18.7104 155.451 18.7104H152.131C152.054 18.7104 152.054 18.7104 151.977 18.7876C151.05 19.5597 149.815 20.0229 148.502 20.0229C146.032 20.0229 143.947 18.3244 143.252 16.0855H156.686ZM148.425 9.21435C150.896 9.21435 152.98 10.9128 153.675 13.1517H143.252C143.87 10.9128 145.955 9.21435 148.425 9.21435Z" />
      <path d="M99.864 22.8795L105.037 6.43504C105.114 6.28064 104.959 6.12622 104.805 6.12622H102.18C102.103 6.12622 102.026 6.2034 101.949 6.2806L97.9339 18.8649L93.9193 6.35782C93.9193 6.28062 93.8421 6.20344 93.6877 6.20344H91.1399C91.0627 6.20344 90.9855 6.28062 90.9083 6.35782L86.9709 19.2509L82.8019 6.35782C82.8019 6.28062 82.7247 6.20344 82.5703 6.20344H79.9453C79.7909 6.20344 79.7137 6.35786 79.7137 6.51226L84.9636 22.9567C84.9636 23.0339 85.0408 23.1111 85.1953 23.1111H88.6694C88.7466 23.1111 88.8238 23.0339 88.901 22.9567L92.4524 11.5305L96.1582 22.9567C96.1582 23.0339 96.2354 23.1111 96.3898 23.1111H99.6324C99.7096 23.0339 99.7868 22.9567 99.864 22.8795Z" />
      <path d="M125.11 6.51219L130.359 23.0339H134.22L139.315 6.51219C139.392 6.35779 139.238 6.20337 139.084 6.20337H136.381C136.304 6.20337 136.227 6.28055 136.15 6.35775L132.135 19.2509L128.043 6.35775C128.043 6.28055 127.966 6.20337 127.812 6.20337H125.187C125.11 6.20337 125.032 6.35778 125.11 6.51219Z" />
    </g>
    <g fill="#c1292e">
      <path d="M161.627 19.7913H158.385V23.0338H161.627V19.7913Z" />
      <path d="M31.0751 22.725L26.52 14.5414L30.9979 6.51219C31.0751 6.35778 30.9979 6.20337 30.8435 6.20337H27.9097C27.8582 6.20337 27.8067 6.22912 27.7553 6.28059L23.123 14.5414L27.8325 22.9566C27.8325 23.0338 27.9097 23.0339 27.9869 23.0339H30.9206C30.9978 23.0339 31.1523 22.8794 31.0751 22.725Z" />
      <path d="M32.5419 22.725L37.097 14.5414L32.6191 6.51219C32.5419 6.35778 32.6191 6.20337 32.7735 6.20337H35.7073C35.7587 6.20337 35.8102 6.22912 35.8617 6.28059L40.494 14.5414L35.7845 22.9566C35.7845 23.0338 35.7073 23.0339 35.6301 23.0339H32.6963C32.6191 23.0339 32.4647 22.8794 32.5419 22.725Z" />
    </g>
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

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

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
        <span className="codicon codicon-split-horizontal"></span>
        <span>并排打开</span>
      </div>
      <div
        className="desktop-session-menu-item desktop-session-menu-item--danger"
        role="menuitem"
        {...getItemProps(1)}
        data-testid="desktop-session-menu-delete"
      >
        <span className="codicon codicon-trash"></span>
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
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
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
  onLogin,
  onLogout,
  isAuthenticated,
  hostLabel,
  sessionTree,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  collapsed = false,
  onCollapsedChange,
}) => {
  // Explicit expand/collapse overrides; groups without an entry are expanded
  // by default — the tree starts fully expanded on every app launch (expansion
  // state is not persisted).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
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
  // 更多 trigger; the menu returns focus here on Escape / item activation.
  const moreBtnRef = useRef<HTMLButtonElement>(null);
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
          <span className="codicon codicon-ellipsis"></span>
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

  // Fully collapsed: nothing renders, no reserved width, no overlay — the chat
  // takes the whole pane width (spec 「侧边栏收起/展开」scenario 1).
  if (collapsed) return null;

  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="desktop-sidebar-header">
        <CodewaveLogo height={14} />
        {/* The header is space-between, so both buttons must live in one
            grouped flex row — otherwise "更多" gets pushed to the middle. */}
        <div className="desktop-sidebar-actions">
          <Tooltip text="更多" position="bottom">
            <button
              ref={moreBtnRef}
              className="desktop-sidebar-more-btn"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              data-testid="desktop-more-btn"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
            >
              <MoreIcon />
            </button>
          </Tooltip>
          <Tooltip text="收起侧边栏" position="bottom">
            <button
              className="desktop-sidebar-more-btn"
              onClick={() => {
                setShowMoreMenu(false);
                onCollapsedChange(true);
              }}
              data-testid="desktop-sidebar-collapse"
              aria-label="收起侧边栏"
            >
              <span className="codicon codicon-layout-panel-left"></span>
            </button>
          </Tooltip>
        </div>
      </div>
      {showMoreMenu && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          // Only remote hosts get annotated — the local host is the default
          // subject, so its 登录/退出登录 entry stays unlabeled.
          hostLabel={hostLabel === "local" ? undefined : hostLabel}
          onClose={() => setShowMoreMenu(false)}
          triggerRef={moreBtnRef}
        />
      )}
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
          <span className="codicon codicon-add"></span>
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
                <span
                  className={`codicon codicon-chevron-${expanded ? "down" : "right"}`}
                ></span>
                <span className="desktop-session-group-name">
                  {dirName(group.workdir)}
                </span>
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
