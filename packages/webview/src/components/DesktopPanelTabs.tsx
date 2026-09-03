import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DesktopPanelKind, PanelTab } from "../types";
import { PANEL_LABELS } from "./ChatApp";
import { MaximizeIcon, UnmaximizeIcon } from "./HeaderIcons";
import { PanelKindIcon } from "./PanelKindIcon";
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

/** 面板类型图标统一走 PanelKindIcon（Figma Component 12 · 13561:39702）。 */

/** 「＋」=「功能」icon-button 添加变体官方矢量（Figma 13383:21135，
 *  13×12 viewBox 圆头实心加号，原 fill #565A60 → currentColor 随两主题）。 */
const AddTabGlyph: React.FC = () => (
  <svg width="13" height="12" viewBox="0 0 13 12" aria-hidden>
    <path
      d="M6.01572 0C6.38682 8.49952e-06 6.6875 0.300975 6.68774 0.672025V5.34374H11.3437C11.7148 5.34396 12.0157 5.64465 12.0157 6.01577C12.0157 6.38689 11.7148 6.68757 11.3437 6.68779H6.68774V11.3279C6.68754 11.699 6.38684 11.9999 6.01572 11.9999C5.64459 11.9999 5.3439 11.699 5.34369 11.3279V6.68779H0.672025C0.300956 6.68757 1.62222e-08 6.38689 0 6.01577C8.48392e-06 5.64465 0.300961 5.34396 0.672025 5.34374H5.34369V0.672025C5.34393 0.30097 5.64461 0 6.01572 0Z"
      fill="currentColor"
    />
  </svg>
);

/** 「×」=「功能」icon-button 关闭变体官方矢量（Figma 13440:12468，
 *  9×9 viewBox 圆头实心 X，原 fill #565A60 → currentColor）。 */
const CloseTabGlyph: React.FC = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden>
    <path
      d="M8.80087 0.198873C9.06618 0.464196 9.06598 0.894338 8.80087 1.15979L5.46088 4.49978L8.78962 7.82851C9.05474 8.09396 9.05493 8.5241 8.78962 8.78943C8.52429 9.05476 8.09415 9.05456 7.8287 8.78943L4.49997 5.46069L1.18257 8.77809C0.917121 9.04324 0.486989 9.04341 0.221653 8.77809C-0.0436834 8.51275 -0.0435003 8.08263 0.221653 7.81718L3.53905 4.49978L0.199095 1.15982C-0.0660373 0.89437 -0.0662338 0.464237 0.199095 0.198907C0.464426 -0.0664105 0.894562 -0.0662215 1.16001 0.198907L4.49997 3.53886L7.83996 0.198873C8.10541 -0.0662377 8.53555 -0.066449 8.80087 0.198873Z"
      fill="currentColor"
    />
  </svg>
);

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
  // Menu anchor: the "＋" button trails the last tab while they fit, and is
  // pinned OUTSIDE the scrollable strip (right of it) once the tabs overflow
  // (pinned=true). The menu is left-aligned to whichever button is live and
  // clamped so a right-edge button never pushes the dropdown out. Measured on
  // every open — tabs shift width.
  const [menuLeft, setMenuLeft] = useState(0);
  // true = tabs no longer fit in the strip → "＋" renders pinned next to the
  // fullscreen action; false = it stays inline after the last tab. Measured
  // against tabs+gap+button width (never the current mode's strip width, so
  // the decision can't flap when the button moves between the two spots).
  const [pinned, setPinned] = useState(false);
  const inlineAddRef = useRef<HTMLButtonElement>(null);
  const pinnedAddRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const tabsBoxRef = useRef<HTMLDivElement>(null);

  // Re-measure whenever tabs change or the strip resizes: tabs may grow/shrink
  // (labels, closes) without the container changing size.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => {
      const tabEls = Array.from(
        strip.querySelectorAll<HTMLElement>("[data-panel-tab]"),
      );
      const tabsTotal = tabEls.reduce((s, t) => s + t.offsetWidth, 0);
      // strip gap 8 between tabs + (8 gap + 24 button) needed after the last
      // tab for the inline "＋" to fit without overflowing.
      const needed = tabsTotal + Math.max(0, tabEls.length - 1) * 8 + 32;
      const next = needed > strip.clientWidth + 1;
      setPinned((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    strip
      .querySelectorAll<HTMLElement>("[data-panel-tab]")
      .forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [tabs]);

  const toggleAddMenu = () => {
    if (!menuOpen) {
      // Multi-instance kinds can always add another tab, so the menu always
      // has an entry — no "all kinds are open" guard here.
      const btn = pinned ? pinnedAddRef.current : inlineAddRef.current;
      const box = tabsBoxRef.current;
      if (btn && box) {
        const btnRect = btn.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        const MENU_WIDTH = 200;
        // Left-align to the button; clamp so a button near the right edge
        // (pinned on overflow) never pushes the menu out of the tab bar.
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
              <PanelKindIcon
                kind={kind}
                size={16}
                className="desktop-panel-tab-icon"
              />
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
                <CloseTabGlyph />
              </button>
            </div>
          );
        })}
        {/* "＋" trails the last tab while they fit (browser tab-bar semantics).
            The moment they overflow it moves OUTSIDE the strip, pinned next to
            the fullscreen action below, so it never scrolls out of view. The
            switch is measured in useLayoutEffect (pinned state) — no JS scroll
            bookkeeping, and the strip scrolls tabs independently either way. */}
        {!pinned && (
          <button
            ref={inlineAddRef}
            className="desktop-panel-tabs-add"
            title="新建面板"
            aria-label="新建面板"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="panel-tabs-add"
            onClick={toggleAddMenu}
          >
            <AddTabGlyph />
          </button>
        )}
      </div>
      {pinned && (
        <button
          ref={pinnedAddRef}
          className="desktop-panel-tabs-add"
          title="新建面板"
          aria-label="新建面板"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="panel-tabs-add"
          onClick={toggleAddMenu}
        >
          <AddTabGlyph />
        </button>
      )}
      <div className="desktop-panel-tabs-actions">
        <button
          className="preview-pane-button"
          title={fullscreen ? "退出全屏" : "全屏"}
          aria-label={fullscreen ? "退出全屏" : "全屏"}
          aria-pressed={fullscreen}
          data-testid="panel-fullscreen"
          onClick={onToggleFullscreen}
        >
          {fullscreen ? (
            <UnmaximizeIcon className="desktop-panel-tabs-action-icon" />
          ) : (
            <MaximizeIcon className="desktop-panel-tabs-action-icon" />
          )}
        </button>
      </div>
      {menuOpen && (
        <PanelToggleMenu
          // Tab-bar "＋" 是「新建/打开」操作菜单，不是面板勾选菜单：
          // checklist=false → 所有项一律无 checkbox 勾、无 active 选中底
          // （计划/终端等单实例已开时也不高亮），aria 走 plain menuitem。
          checklist={false}
          checked={Array.from(
            new Set(tabs.map((t) => t.kind).filter((k) => k !== "preview")),
          )}
          onToggle={onAdd}
          disabled={disabled}
          closeOnActivate
          onClose={() => setMenuOpen(false)}
          triggerRef={pinned ? pinnedAddRef : inlineAddRef}
          className="panel-toggle-menu--tabs"
          style={{ left: menuLeft }}
        />
      )}
    </div>
  );
};

export default DesktopPanelTabs;
