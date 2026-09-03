import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
import type { DesktopPanelKind, PanelToggleProps } from "../types";
import "../styles/PanelToggleMenu.css";

interface PanelToggleMenuProps extends PanelToggleProps {
  onClose: () => void;
  /** Trigger button (面板 in the header); Escape returns focus here. */
  triggerRef?: RefObject<HTMLElement | null>;
  /** Close the menu after activating an item (the tab-bar "＋" menu) instead of
   *  keeping it open for consecutive multi-select (the header checkbox menu). */
  closeOnActivate?: boolean;
  /** Extra class for positioning overrides (e.g. anchored to the tab bar). */
  className?: string;
  /** Position override (e.g. left offset anchoring the menu under the "＋"). */
  style?: React.CSSProperties;
  /** Checkbox semantics (multi-select, keeps open): false switches to a plain
   *  menu where activating an item just opens that panel (tab-bar "＋" menu). */
  checklist?: boolean;
  /** Show already-checked items: false hides them so the menu only lists the
   *  panels that aren't open yet (the tab bar already shows open ones). */
  showChecked?: boolean;
  /** Kinds that never render a checkmark even in checklist mode — e.g. preview,
   *  whose menu click ALWAYS adds a fresh tab, so a check would mislead. */
  noCheckKinds?: DesktopPanelKind[];
}

const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

export const PANEL_ITEMS: Array<{
  kind: DesktopPanelKind;
  label: string;
  shortcut?: string;
}> = [
  { kind: "preview", label: "预览", shortcut: isMac ? "⇧⌘P" : "Ctrl+Shift+P" },
  // 计划面板无快捷键：ExitPlanMode 时自动打开（对齐 VSCE claudePlanPreview）。
  { kind: "plan", label: "计划" },
  { kind: "diff", label: "差异", shortcut: isMac ? "⇧⌘D" : "Ctrl+Shift+D" },
  { kind: "terminal", label: "终端", shortcut: isMac ? "⌃`" : "Ctrl+`" },
  // 文件面板无快捷键（与 Claude Code Desktop 一致；Ctrl+Shift+F 与 Windows
  // 输入法简繁切换冲突），仅经菜单栏「面板 → 文件」或点击文件路径打开。
  { kind: "file", label: "文件" },
];

/**
 * Desktop header panel-toggle dropdown: multi-select checkboxes for the
 * conversation-level side panels. Clicking an item toggles it WITHOUT closing
 * the menu (consecutive multi-select); click-outside / Esc closes.
 *
 * Keyboard: roving tabindex + Arrow keys via useRovingMenu. Disabled items
 * stay arrow-key reachable (perceivable) but activation is a no-op.
 */
export const PanelToggleMenu: React.FC<PanelToggleMenuProps> = ({
  checked,
  onToggle,
  disabled = [],
  onClose,
  triggerRef,
  closeOnActivate = false,
  className,
  style,
  checklist = true,
  showChecked = true,
  noCheckKinds = [],
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Tab-bar "＋" menu (showChecked=false) lists only the panels that aren't
  // open yet — the tab strip already visualizes the open ones.
  const visibleItems = PANEL_ITEMS.map((item, index) => ({
    item,
    index,
  })).filter(({ item }) => showChecked || !checked.includes(item.kind));

  // Roving keyboard model shared with the other custom dropdowns; toggling
  // keeps the menu open (closeOnActivate off), Escape returns to the trigger.
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".panel-toggle-menu-item",
    itemCount: visibleItems.length,
    triggerRef,
    closeOnActivate,
    onRequestClose: onClose,
    onActivate: (i) => {
      const kind = visibleItems[i].item.kind;
      if (!disabled.includes(kind)) {
        onToggle(kind);
        if (closeOnActivate) onClose();
      }
    },
  });

  // Click-outside + global Escape fallback (the hook only handles Escape from
  // a focused item). useClickOutside registers the mousedown listener one tick
  // later so a mousedown that just mounted this menu is not an outside click.
  useClickOutside({
    refs: [menuRef],
    onClickOutside: onClose,
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={`panel-toggle-menu${className ? ` ${className}` : ""}`}
      style={style}
      data-testid="panel-toggle-menu"
    >
      {visibleItems.map(({ item }, vi) => {
        const { kind, label, shortcut } = item;
        const isChecked = checked.includes(kind);
        const isDisabled = disabled.includes(kind);
        const noCheck = noCheckKinds.includes(kind);
        return (
          <div
            key={kind}
            {...getItemProps(vi)}
            className={`panel-toggle-menu-item${checklist && isChecked && !noCheck ? " panel-toggle-menu-item--active" : ""}${isDisabled ? " panel-toggle-menu-item--disabled" : ""}`}
            role={checklist ? "checkbox" : "menuitem"}
            aria-checked={checklist && !noCheck ? isChecked : undefined}
            aria-disabled={isDisabled}
            data-testid={`panel-toggle-item-${kind}`}
          >
            <span className="panel-toggle-menu-label">{label}</span>
            {shortcut ? (
              <span className="panel-toggle-menu-shortcut">{shortcut}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default PanelToggleMenu;
