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

interface CommandGroup {
  title: string;
  commands: SlashCommand[];
}

// Split the flat command list into fixed-order visual groups. The concatenated
// group order is the single source of truth for both rendering and keyboard
// navigation, so the highlighted item always matches its visual position.
export const groupSlashCommands = (commands: SlashCommand[]): CommandGroup[] => {
  const pluginCommands: SlashCommand[] = [];
  const systemCommands: SlashCommand[] = [];
  const skillCommands: SlashCommand[] = [];

  commands.forEach((command) => {
    if (command.name === PLUGIN_COMMAND) {
      pluginCommands.push(command);
    } else if (SYSTEM_COMMANDS.includes(command.name)) {
      systemCommands.push(command);
    } else {
      skillCommands.push(command);
    }
  });

  return [
    { title: '插件管理', commands: pluginCommands },
    { title: '系统指令', commands: systemCommands },
    { title: '技能', commands: skillCommands }
  ];
};

// Flatten commands into display order (grouped). selectedIndex indexes into this.
export const orderSlashCommands = (commands: SlashCommand[]): SlashCommand[] =>
  groupSlashCommands(commands).flatMap((group) => group.commands);

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

  const groups = groupSlashCommands(commands);
  let displayIndex = -1;

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
          .filter((group) => group.commands.length > 0)
          .map((group) => (
            <div className="slash-group" key={group.title}>
              <div className="slash-group-title">{group.title}</div>
              <ul className="slash-commands-list">
                {group.commands.map((command) => {
                  displayIndex += 1;
                  const isSelected = displayIndex === selectedIndex;
                  return (
                    <li
                      key={command.id}
                      className={`slash-command-item ${isSelected ? 'selected' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); onSelect(command); }}
                      data-testid={`slash-command-${command.id}`}
                    >
                      <div className="slash-command-name">/{command.name}</div>
                      {command.description && (
                        <div className="slash-command-description">{command.description}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
      )}
    </div>
  );
};
