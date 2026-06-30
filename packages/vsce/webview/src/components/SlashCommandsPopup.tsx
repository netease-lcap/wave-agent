import React, { useEffect, useRef } from 'react';
import '../styles/SlashCommandsPopup.css';

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
}

interface SlashCommandsPopupProps {
  commands: SlashCommand[];
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  position: { top: number; left: number };
  isLoading?: boolean;
}

export const SlashCommandsPopup: React.FC<SlashCommandsPopupProps> = ({
  commands,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
  position,
  isLoading = false
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside to close popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isVisible) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isVisible, onClose]);

  // Auto-scroll selected item into view when navigation happens
  useEffect(() => {
    if (!popupRef.current) return;
    const selectedItem = popupRef.current.querySelector('.slash-command-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isVisible) return null;

  return (
    <div
      ref={popupRef}
      className="slash-commands-popup"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 1000
      }}
      data-testid="slash-commands-popup"
    >
      <div className="slash-commands-header">
        指令
      </div>

      {isLoading ? (
        <div className="slash-commands-loading">
          正在加载命令...
        </div>
      ) : commands.length === 0 ? (
        <div className="slash-commands-empty">
          未找到可用命令
        </div>
      ) : (
        <ul className="slash-commands-list">
          {commands.map((command, index) => (
            <li
              key={command.id}
              className={`slash-command-item ${index === selectedIndex ? 'selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onSelect(command); }}
              data-testid={`slash-command-${command.id}`}
            >
              <div className="slash-command-name">/{command.name}</div>
              <div className="slash-command-description">{command.description}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};