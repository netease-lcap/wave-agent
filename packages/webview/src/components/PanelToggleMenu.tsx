import React, { useEffect, useRef } from 'react';
import type { DesktopPanelKind, PanelToggleProps } from '../types';
import '../styles/PanelToggleMenu.css';

interface PanelToggleMenuProps extends PanelToggleProps {
  onClose: () => void;
}

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

const PANEL_ITEMS: Array<{ kind: DesktopPanelKind; label: string; shortcut: string }> = [
  { kind: 'preview', label: '预览', shortcut: isMac ? '⇧⌘P' : 'Ctrl+Shift+P' },
  { kind: 'diff', label: '差异', shortcut: isMac ? '⇧⌘D' : 'Ctrl+Shift+D' },
  { kind: 'terminal', label: '终端', shortcut: isMac ? '⌃`' : 'Ctrl+`' },
  { kind: 'file', label: '文件', shortcut: isMac ? '⇧⌘F' : 'Ctrl+Shift+F' },
];

/**
 * Desktop header panel-toggle dropdown: multi-select checkboxes for the
 * conversation-level side panels. Clicking an item toggles it WITHOUT closing
 * the menu (consecutive multi-select); click-outside / Esc closes.
 */
export const PanelToggleMenu: React.FC<PanelToggleMenuProps> = ({
  checked,
  onToggle,
  disabled = [],
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={menuRef} className="panel-toggle-menu" data-testid="panel-toggle-menu">
      {PANEL_ITEMS.map(({ kind, label, shortcut }) => {
        const isChecked = checked.includes(kind);
        const isDisabled = disabled.includes(kind);
        return (
          <div
            key={kind}
            className={`panel-toggle-menu-item${isDisabled ? ' panel-toggle-menu-item--disabled' : ''}`}
            onClick={isDisabled ? undefined : () => onToggle(kind)}
            role="checkbox"
            aria-checked={isChecked}
            aria-disabled={isDisabled}
            data-testid={`panel-toggle-item-${kind}`}
          >
            <i
              className={`codicon codicon-check panel-toggle-menu-check${isChecked ? ' panel-toggle-menu-check--on' : ''}`}
            />
            <span className="panel-toggle-menu-label">{label}</span>
            <span className="panel-toggle-menu-shortcut">{shortcut}</span>
          </div>
        );
      })}
    </div>
  );
};

export default PanelToggleMenu;
