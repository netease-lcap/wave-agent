import React, { useEffect, useRef } from "react";
import { ExternalLinkIcon } from "./HeaderIcons";
import "../styles/MoreMenu.css";

interface MoreMenuProps {
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
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
}

export const MoreMenu: React.FC<MoreMenuProps> = ({
  onOpenSettings,
  onOpenEnterpriseConsole,
  onLogin,
  onLogout,
  onClose,
  isAuthenticated,
  hostLabel,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside + Escape to close
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

  const handleSettings = () => {
    onOpenSettings();
    onClose();
  };

  const handleEnterprise = () => {
    onOpenEnterpriseConsole();
    onClose();
  };

  const handleLogout = () => {
    onLogout();
    onClose();
  };

  const handleLogin = () => {
    onLogin();
    onClose();
  };

  return (
    <div ref={menuRef} className="more-menu" data-testid="more-menu">
      <div
        className="more-menu-item"
        role="menuitem"
        tabIndex={0}
        onClick={handleSettings}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSettings();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        data-testid="more-menu-settings"
      >
        设置{hostLabel ? `（${hostLabel}）` : ""}
      </div>
      <div
        className="more-menu-item more-menu-item--between"
        role="menuitem"
        tabIndex={0}
        onClick={handleEnterprise}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleEnterprise();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        data-testid="more-menu-enterprise"
      >
        <span>企业控制台</span>
        <ExternalLinkIcon className="more-menu-item-icon" />
      </div>
      {isAuthenticated ? (
        <div
          className="more-menu-item"
          role="menuitem"
          tabIndex={0}
          onClick={handleLogout}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleLogout();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          data-testid="more-menu-logout"
        >
          退出登录{hostLabel ? `（${hostLabel}）` : ""}
        </div>
      ) : (
        <div
          className="more-menu-item"
          role="menuitem"
          tabIndex={0}
          onClick={handleLogin}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleLogin();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          data-testid="more-menu-login"
        >
          登录{hostLabel ? `（${hostLabel}）` : ""}
        </div>
      )}
    </div>
  );
};

export default MoreMenu;
