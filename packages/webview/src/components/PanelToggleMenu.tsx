import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import type { DesktopPanelKind, PanelToggleProps } from "../types";
import "../styles/PanelToggleMenu.css";

interface PanelToggleMenuProps extends PanelToggleProps {
  onClose: () => void;
  /** Trigger button (面板 in the header); Escape returns focus here. */
  triggerRef?: RefObject<HTMLElement | null>;
}

const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

const PANEL_ITEMS: Array<{
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
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Roving keyboard model shared with the other custom dropdowns; toggling
  // keeps the menu open (closeOnActivate off), Escape returns to the trigger.
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".panel-toggle-menu-item",
    itemCount: PANEL_ITEMS.length,
    triggerRef,
    closeOnActivate: false,
    onRequestClose: onClose,
    onActivate: (i) => {
      const kind = PANEL_ITEMS[i].kind;
      if (!disabled.includes(kind)) onToggle(kind);
    },
  });

  // Click-outside + global Escape fallback (the hook only handles Escape from
  // a focused item).
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="panel-toggle-menu"
      data-testid="panel-toggle-menu"
    >
      {PANEL_ITEMS.map(({ kind, label, shortcut }, i) => {
        const isChecked = checked.includes(kind);
        const isDisabled = disabled.includes(kind);
        return (
          <div
            key={kind}
            {...getItemProps(i)}
            className={`panel-toggle-menu-item${isChecked ? " panel-toggle-menu-item--active" : ""}${isDisabled ? " panel-toggle-menu-item--disabled" : ""}`}
            role="checkbox"
            aria-checked={isChecked}
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
