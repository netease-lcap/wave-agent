import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import { Tooltip } from "./Tooltip";
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

/**
 * 选项描述：最多两行，超出末尾省略号（截断由 CSS `-webkit-line-clamp` 完成），
 * 被截断时 hover 由气泡给出全文。
 *
 * 只在**真的截断**时挂气泡：短描述本来就全在，再弹一个同文案的气泡纯属噪音。
 * 截断判定必须测量（`scrollHeight > clientHeight`），且宽度变化后要重测——弹窗宽度
 * 随内容在 300–400px 间浮动，同一个描述可能一会儿截一会儿不截。
 *
 * 「最多两行」这条 CSS 只在桌面上生效（`SlashCommandsPopup.css` 里带
 * `[data-host="desktop"]`，她 1009 裁定「只留桌面」）；组件这里不做宿主判断——IDE 宿主下
 * 描述不被裁，量出来就是不截断，Tooltip 走 `disabled` 直接返回原 children（DOM 与之前
 * 逐字相同）。宿主差异只由 CSS 一处表达。
 *
 * 节点用 **callback ref 存进 state**（而不是 `useRef`）：气泡一旦挂上，描述 div 就从
 * `li` 的直接子节点变成 Tooltip 包裹层里的子节点，DOM 节点会被重建。若观察的是
 * `useRef` 抓到的旧节点，卸载后它会报 `scrollHeight/offsetHeight = 0` ⇒ 判定翻回
 * 「未截断」⇒ 包裹层被摘掉 ⇒ 震荡（实测最终停在「没有气泡」那一侧）。挂在 state 上，
 * 节点一换就重跑 effect、把 ResizeObserver 重新指到当前节点，一次收敛。
 */
const CommandDescription: React.FC<{ text: string }> = ({ text }) => {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    if (!element) return;
    // +1：浏览器取整与亚像素行高（12px × 1.3）会把「刚好两行」读成 1px 溢出。
    const measure = () =>
      setIsTruncated(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return; // jsdom（单测）无此 API
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, text]);

  return (
    <Tooltip
      text={text}
      multiline
      position="right"
      disabled={!isTruncated}
      portal
      className="slash-command-description-wrap"
    >
      <div className="slash-command-description" ref={setElement}>
        {text}
      </div>
    </Tooltip>
  );
};

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
                        <CommandDescription text={command.description} />
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
