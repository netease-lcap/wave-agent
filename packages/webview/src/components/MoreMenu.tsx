import React, { useEffect, useRef } from 'react';
import { ExternalLinkIcon } from './HeaderIcons';
import '../styles/MoreMenu.css';

interface MoreMenuProps {
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onLogout: () => void;
  onClose: () => void;
}

export const MoreMenu: React.FC<MoreMenuProps> = ({
  onOpenSettings,
  onOpenEnterpriseConsole,
  onLogout,
  onClose
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
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
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

  return (
    <div ref={menuRef} className="more-menu" data-testid="more-menu">
      <div className="more-menu-item" onClick={handleSettings} data-testid="more-menu-settings">
        设置
      </div>
      <div
        className="more-menu-item more-menu-item--between"
        onClick={handleEnterprise}
        data-testid="more-menu-enterprise"
      >
        <span>企业控制台</span>
        <ExternalLinkIcon className="more-menu-item-icon" />
      </div>
      <div className="more-menu-item" onClick={handleLogout} data-testid="more-menu-logout">
        退出登录
      </div>
    </div>
  );
};

export default MoreMenu;
