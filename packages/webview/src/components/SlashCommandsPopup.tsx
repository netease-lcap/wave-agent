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
}

const PLUGIN_COMMAND = 'plugin';
const SYSTEM_COMMANDS = ['config', 'mcp', 'status', 'clear'];

interface CommandEntry {
  command: SlashCommand;
  globalIndex: number;
}

interface CommandGroup {
  title: string;
  entries: CommandEntry[];
}

export const SlashCommandsPopup: React.FC<SlashCommandsPopupProps> = ({
  commands,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
  position
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

  // Split flat command list into fixed-order groups, keeping the original
  // index of each command so keyboard navigation stays consistent.
  const pluginEntries: CommandEntry[] = [];
  const systemEntries: CommandEntry[] = [];
  const skillEntries: CommandEntry[] = [];

  commands.forEach((command, globalIndex) => {
    const entry: CommandEntry = { command, globalIndex };
    if (command.name === PLUGIN_COMMAND) {
      pluginEntries.push(entry);
    } else if (SYSTEM_COMMANDS.includes(command.name)) {
      systemEntries.push(entry);
    } else {
      skillEntries.push(entry);
    }
  });

  const groups: CommandGroup[] = [
    { title: '插件管理', entries: pluginEntries },
    { title: '系统指令', entries: systemEntries },
    { title: '技能', entries: skillEntries }
  ];

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
      {commands.length === 0 ? (
        <div className="slash-commands-empty">
          未找到可用命令
        </div>
      ) : (
        groups
          .filter((group) => group.entries.length > 0)
          .map((group) => (
            <div className="slash-group" key={group.title}>
              <div className="slash-group-title">{group.title}</div>
              <ul className="slash-commands-list">
                {group.entries.map(({ command, globalIndex }) => (
                  <li
                    key={command.id}
                    className={`slash-command-item ${globalIndex === selectedIndex ? 'selected' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); onSelect(command); }}
                    data-testid={`slash-command-${command.id}`}
                  >
                    <div className="slash-command-name">/{command.name}</div>
                    {command.description && (
                      <div className="slash-command-description">{command.description}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </div>
  );
};
