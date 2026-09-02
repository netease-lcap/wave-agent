import React, { useEffect, useRef, useState } from "react";
import type { DesktopPanelKind, PanelTab } from "../types";
import { PANEL_LABELS } from "./ChatApp";
import { PanelToggleMenu } from "./PanelToggleMenu";
import "../styles/DesktopPanelTabs.css";

export interface DesktopPanelTabsProps {
  /** Open panel tabs, in tab order (multi-instance kinds may repeat). */
  tabs: PanelTab[];
  /** Currently active tab id (null = no tab open — the slot is hidden anyway). */
  activeTabId: string | null;
  /** Panels unavailable right now (e.g. diff/terminal without a workdir). */
  disabled: DesktopPanelKind[];
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  /** "＋" menu item click: add a fresh instance (preview/diff/file) or open-or-
   *  activate the unique tab (terminal/plan). Returns false when space is
   *  refused and nothing was opened. */
  onAdd: (kind: DesktopPanelKind) => boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Panel-type icons, matching the tab strip labels. */
const PANEL_ICONS: Record<DesktopPanelKind, string> = {
  preview: "codicon-browser",
  plan: "codicon-list-unordered",
  diff: "codicon-diff",
  terminal: "codicon-terminal",
  file: "codicon-file-code",
};

/** Short per-instance tab label: the guest page title for preview (regular
 *  browser semantics — the tab shows what the page is called, not its URL),
 *  falling back to host+path / "新预览"; file tabs keep the plain "文件" panel
 *  name — the concrete file name is shown in the pane's secondary toolbar
 *  (FilePane), never leaked into the tab strip. */
function tabLabel(tab: PanelTab): string {
  if (tab.kind === "preview") {
    if (tab.previewTitle) return tab.previewTitle;
    if (!tab.previewUrl) return "新预览";
    try {
      const u = new URL(tab.previewUrl);
      const path = u.pathname === "/" ? "" : u.pathname;
      return `${u.host}${path}`;
    } catch {
      return tab.previewUrl;
    }
  }
  return PANEL_LABELS[tab.kind];
}

/**
 * Tab strip above the desktop panel slot (browser-style tabs, spec「面板 tab
 * 化」): one pill tab per open panel instance (icon + label + ×), a "＋" button
 * that opens the panel-type menu, and the fullscreen action on the right.
 * Clicking a tab switches the active panel; inactive tabs stay mounted
 * (display:none) so preview guests / terminal PTYs survive switching. Closing
 * a tab destroys that instance (browser-tab semantics).
 */
export const DesktopPanelTabs: React.FC<DesktopPanelTabsProps> = ({
  tabs,
  activeTabId,
  disabled,
  onActivate,
  onClose,
  onAdd,
  fullscreen,
  onToggleFullscreen,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  // Menu anchor: the "＋" button lives INSIDE the tab strip, right after the
  // tabs (its natural flex position when they fit). On overflow it sticks to
  // the strip's visible right edge (see CSS position:sticky), so the menu is
  // left-aligned to the button and clamped so a right-edge button never pushes
  // the dropdown out. Measured on every open — tabs shift width.
  const [menuLeft, setMenuLeft] = useState(0);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tabsBoxRef = useRef<HTMLDivElement>(null);

  const toggleAddMenu = () => {
    if (!menuOpen) {
      // Multi-instance kinds can always add another tab, so the menu always
      // has an entry — no "all kinds are open" guard here.
      const btn = addBtnRef.current;
      const box = tabsBoxRef.current;
      if (btn && box) {
        const btnRect = btn.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        const MENU_WIDTH = 200;
        // Left-align to the button; clamp so a button near the right edge
        // (sticky on overflow) never pushes the menu out of the tab bar.
        const left = Math.min(
          Math.max(0, btnRect.left - boxRect.left),
          Math.max(0, boxRect.width - MENU_WIDTH - 4),
        );
        setMenuLeft(left);
      }
    }
    setMenuOpen((v) => !v);
  };

  // Arrow keys move focus among the tabs (roving tabindex).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = Array.from(
      stripRef.current?.querySelectorAll<HTMLElement>("[data-panel-tab]") ?? [],
    );
    if (tabs.length === 0) return;
    const cur = tabs.findIndex((t) => t.tabIndex === 0);
    const i = cur === -1 ? 0 : cur;
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : (i - 1 + tabs.length) % tabs.length;
    tabs[next].focus();
    e.preventDefault();
  };

  // Browser tab semantics: keep the active tab reachable. A freshly added tab
  // always sits at the end and is active — scroll the strip fully right so BOTH
  // it and the trailing "＋" are fully visible (the strip's scrollbar is
  // hidden, so without this the newest tab would be clipped and look covered
  // by the add button). Activating an older tab scrolls it into view instead.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || tabs.length === 0) return;
    if (activeTabId === tabs[tabs.length - 1].id) {
      strip.scrollLeft = strip.scrollWidth;
    } else {
      strip
        .querySelector('[data-panel-tab][aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeTabId, tabs]);

  return (
    <div
      ref={tabsBoxRef}
      className="desktop-panel-tabs"
      data-testid="desktop-panel-tabs"
    >
      <div
        ref={stripRef}
        className="desktop-panel-tabs-strip"
        role="tablist"
        aria-label="面板"
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab) => {
          const { id, kind } = tab;
          const isActive = activeTabId === id;
          const label = tabLabel(tab);
          return (
            <div
              key={id}
              data-panel-tab
              role="tab"
              aria-selected={isActive}
              aria-label={label}
              data-kind={kind}
              data-testid={`panel-tab-${id}`}
              className={`desktop-panel-tab${isActive ? " active" : ""}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onActivate(id)}
              title={label}
            >
              <i className={`codicon ${PANEL_ICONS[kind]}`} />
              <span className="desktop-panel-tab-label">{label}</span>
              <button
                className="preview-tab-close"
                title={`关闭${label}`}
                aria-label={`关闭${label}`}
                data-testid={`panel-tab-close-${id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(id);
                }}
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
          );
        })}
        {/* "＋" stays inside the strip as the last flex child: it sits right
            after the tabs when they fit, and sticks to the strip's visible
            right edge (position:sticky) when they overflow — so it stays
            visible next to the fullscreen button without JS overflow checks. */}
        <button
          ref={addBtnRef}
          className="desktop-panel-tabs-add"
          title="新建面板"
          aria-label="新建面板"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="panel-tabs-add"
          onClick={toggleAddMenu}
        >
          <i className="codicon codicon-add" />
        </button>
      </div>
      <div className="desktop-panel-tabs-actions">
        <button
          className="preview-pane-button"
          title={fullscreen ? "退出全屏" : "全屏"}
          aria-label={fullscreen ? "退出全屏" : "全屏"}
          aria-pressed={fullscreen}
          data-testid="panel-fullscreen"
          onClick={onToggleFullscreen}
        >
          <i
            className={`codicon ${
              fullscreen ? "codicon-screen-normal" : "codicon-screen-full"
            }`}
          />
        </button>
      </div>
      {menuOpen && (
        <PanelToggleMenu
          // Preview never shows a check — clicking it always ADDS a fresh
          // tab, so a checkmark would mislead ("open → clicking jumps there").
          // The other kinds are single-instance: a check marks "already open,
          // click to focus it".
          checked={Array.from(
            new Set(tabs.map((t) => t.kind).filter((k) => k !== "preview")),
          )}
          onToggle={onAdd}
          disabled={disabled}
          noCheckKinds={["preview"]}
          closeOnActivate
          onClose={() => setMenuOpen(false)}
          triggerRef={addBtnRef}
          className="panel-toggle-menu--tabs"
          style={{ left: menuLeft }}
        />
      )}
    </div>
  );
};

export default DesktopPanelTabs;
