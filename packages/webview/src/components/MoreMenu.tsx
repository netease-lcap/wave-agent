import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { ExternalLinkIcon } from "./HeaderIcons";
import "../styles/MoreMenu.css";

interface MoreMenuProps {
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onOpenHelpDocs: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onClose: () => void;
  isAuthenticated: boolean;
  /**
   * Label of the auth subject this menu's 登录/退出登录 entry acts on —
   * set by the desktop host to the focused pane's host (e.g. 'lyq.u',
   * '本地'). Absent for hosts without the concept (VSCE/JetBrains), in which
   * case the entry shows no annotation.
   */
  hostLabel?: string;
  /**
   * Trigger button (更多 in the header); Escape and item activation return
   * focus here.
   */
  triggerRef?: RefObject<HTMLElement | null>;
  /**
   * Anchor rect for fixed-position anchoring (AccountCard's 更多 button, which
   * sits at the sidebar bottom). When present the menu positions itself ABOVE
   * the anchor — the sidebar's overflow:hidden clips absolute descendants, so
   * the card's menu must escape via fixed (SessionItemMenu pattern). The
   * header trigger omits it and keeps the absolute header-anchored layout.
   */
  anchorRect?: DOMRect;
}

export const MoreMenu: React.FC<MoreMenuProps> = ({
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onLogin,
  onLogout,
  onClose,
  isAuthenticated,
  hostLabel,
  triggerRef,
  anchorRect,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Roving keyboard model shared with the other custom dropdowns: Arrow keys
  // move, Enter/Space activate, Escape closes back to the trigger. The hook
  // calls onRequestClose for the in-menu close paths; this component keeps
  // its own click-outside / global-Escape listeners (see below).
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".more-menu-item",
    itemCount: 4,
    triggerRef,
    closeOnActivate: true,
    onRequestClose: onClose,
    onActivate: (i) => entries[i].run(),
  });

  const handleSettings = () => onOpenSettings();
  const handleEnterprise = () => onOpenEnterpriseConsole();
  const handleHelpDocs = () => onOpenHelpDocs();
  const authLabelSuffix = hostLabel ? `（${hostLabel}）` : "";

  // Entry order matches focus order; the fourth slot is 登录/退出登录 by auth,
  // danger-styled and separated when it is 退出登录 (spec 场景 4).
  const entries: Array<{
    id: string;
    run: () => void;
    content: React.ReactNode;
    className?: string;
    separator?: boolean;
  }> = [
    {
      id: "more-menu-settings",
      run: handleSettings,
      content: <span>设置{authLabelSuffix}</span>,
    },
    {
      id: "more-menu-enterprise",
      className: "more-menu-item--between",
      run: handleEnterprise,
      content: (
        <>
          <span>企业控制台</span>
          <ExternalLinkIcon className="more-menu-item-icon" />
        </>
      ),
    },
    {
      id: "more-menu-help-docs",
      className: "more-menu-item--between",
      run: handleHelpDocs,
      content: (
        <>
          <span>帮助文档</span>
          <ExternalLinkIcon className="more-menu-item-icon" />
        </>
      ),
    },
    isAuthenticated
      ? {
          id: "more-menu-logout",
          className: "more-menu-item--danger",
          separator: true,
          run: onLogout,
          content: <span>退出登录{authLabelSuffix}</span>,
        }
      : {
          id: "more-menu-login",
          run: onLogin,
          content: <span>登录{authLabelSuffix}</span>,
        },
  ];

  // Click-outside + global Escape fallback (the hook only handles Escape from
  // a focused item). Focus returns to the trigger on those in-menu paths.
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
      className="more-menu"
      data-testid="more-menu"
      style={
        anchorRect
          ? {
              position: "fixed",
              top: "auto",
              bottom: window.innerHeight - anchorRect.top + 4,
              right: Math.max(8, window.innerWidth - anchorRect.right),
              left: "auto",
            }
          : undefined
      }
    >
      {entries.map((entry, i) => (
        <div key={`${entry.separator ? "sep-" : ""}${entry.id}`}>
          {entry.separator && (
            <div className="more-menu-separator" aria-hidden="true" />
          )}
          <div
            {...getItemProps(i)}
            className={`more-menu-item${entry.className ? ` ${entry.className}` : ""}`}
            role="menuitem"
            data-testid={entry.id}
          >
            {entry.content}
          </div>
        </div>
      ))}
    </div>
  );
};

export default MoreMenu;
