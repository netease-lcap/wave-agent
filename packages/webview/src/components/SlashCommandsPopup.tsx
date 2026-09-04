import React, { useEffect, useRef } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import "../styles/SlashCommandsPopup.css";

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  /** Source of a skill-backed command（内置/用户/项目/插件）；仅技能命令携带 */
  skillSource?: "builtin" | "user" | "project" | "plugin";
}

/** skillSource → 标签文案（与设置页技能来源 Tab 语义一致） */
export const SKILL_SOURCE_LABELS: Record<
  NonNullable<SlashCommand["skillSource"]>,
  string
> = {
  builtin: "内置",
  user: "用户",
  project: "项目",
  plugin: "插件",
};

interface SlashCommandsPopupProps {
  commands: SlashCommand[];
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  position: { top: number; left: number };
}

const PLUGIN_COMMAND = "plugin";
const SYSTEM_COMMANDS = [
  "config",
  "mcp",
  "status",
  "tasks",
  "workflows",
  "agents",
  "skills",
  "clear",
  "compact",
  "rewind",
  "model",
  "btw",
];

interface CommandGroup {
  title: string;
  commands: SlashCommand[];
}

// Split the flat command list into fixed-order visual groups. The concatenated
// group order is the single source of truth for both rendering and keyboard
// navigation, so the highlighted item always matches its visual position.
export const groupSlashCommands = (
  commands: SlashCommand[],
): CommandGroup[] => {
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
    { title: "插件管理", commands: pluginCommands },
    { title: "系统指令", commands: systemCommands },
    { title: "技能", commands: skillCommands },
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
  position,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside to close popup (listener registered one tick later
  // inside useClickOutside, so a mousedown that opens a nested popup — e.g.
  // clicking /rewind — is not treated as an outside click of this popup).
  useClickOutside({
    refs: [popupRef],
    enabled: isVisible,
    onClickOutside: onClose,
  });

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isVisible) return;

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onClose();
          break;
      }
    };

    if (isVisible) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isVisible, onClose]);

  // Auto-scroll selected item into view when navigation happens
  useEffect(() => {
    if (!popupRef.current) return;
    const selectedItem = popupRef.current.querySelector(
      ".slash-command-item.selected",
    );
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
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
        position: "absolute",
        top: position.top,
        left: position.left,
        zIndex: 1000,
      }}
      data-testid="slash-commands-popup"
    >
      {commands.length === 0 ? (
        <div className="slash-commands-empty">未找到可用命令</div>
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
                      className={`slash-command-item ${isSelected ? "selected" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(command);
                      }}
                      data-testid={`slash-command-${command.id}`}
                    >
                      <div className="slash-command-name-row">
                        <div className="slash-command-name">
                          /{command.name}
                        </div>
                        {command.skillSource && (
                          <span
                            className={`slash-command-tag slash-command-tag-${command.skillSource}`}
                            data-testid={`slash-command-source-${command.id}`}
                          >
                            {SKILL_SOURCE_LABELS[command.skillSource]}
                          </span>
                        )}
                      </div>
                      {command.description && (
                        <div className="slash-command-description">
                          {command.description}
                        </div>
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
