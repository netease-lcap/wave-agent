import React, { useEffect, useRef, useState } from "react";
import type { SlashCommand } from "../types";
import { useClickOutside } from "../utils/useClickOutside";
import { Tooltip } from "./Tooltip";
import "../styles/SlashCommandsPopup.css";

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

interface CommandGroup {
  title: string;
  commands: SlashCommand[];
}

// Split the flat command list into fixed-order visual groups. The concatenated
// group order is the single source of truth for both rendering and keyboard
// navigation, so the highlighted item always matches its visual position.
//
// 分组判据只有一条：命令是否由技能注册（`skillSource` 有无）。带它就是技能命令，
// 其余（宿主本地指令、磁盘自定义命令、插件命令）一律算系统指令。
//
// 这里刻意**不**维护命令名名单。曾经有一份 `SYSTEM_COMMANDS` 白名单，宿主每加一条
// 本地指令（/hooks、/plan、/resume、/reload-plugins …）都要同步过来，漏一次就让系统
// 指令掉进「技能」分组——同一处已补过两次名单（/subtask、/plan）。判据回到数据本身
// 之后，宿主的本地指令表怎么长都不需要动 webview。
//
// 也不再给 `/plugin` 单列「插件管理」分组：插件市场已是独立整页入口，弹窗里不再
// 额外高亮它。
export const groupSlashCommands = (
  commands: SlashCommand[],
): CommandGroup[] => {
  const systemCommands: SlashCommand[] = [];
  const skillCommands: SlashCommand[] = [];

  commands.forEach((command) => {
    if (command.skillSource) {
      skillCommands.push(command);
    } else {
      systemCommands.push(command);
    }
  });

  return [
    { title: "系统指令", commands: systemCommands },
    { title: "技能", commands: skillCommands },
  ];
};

// Flatten commands into display order (grouped). selectedIndex indexes into this.
export const orderSlashCommands = (commands: SlashCommand[]): SlashCommand[] =>
  groupSlashCommands(commands).flatMap((group) => group.commands);

/**
 * 选项 = **一行**（`/名字` + 来源标签），描述不进列表 —— 对齐 CC 桌面端斜杠菜单
 * （`ccc334009-*.js` 的 `SlashCommandMenuPopupBody`：icon + label + 别名 + 右侧来源
 * caption，估高 32px；描述只在浮层里出现）。
 *
 * 之前的形态是把描述排在名字行下面、最多两行（`-webkit-line-clamp: 2`，仅桌面端）：
 * 描述一行时整项 40.6、两行时 ~60，长短混排的列表高度参差，320px 高的弹窗一屏只剩
 * 5–6 条，而弹窗本身早就限过高了（`SlashCommandsPopup.css` 的 `max-height`）——真
 * 正失控的是**单项**高度。
 *
 * 描述改由两颗入口给出，信息不丢：
 * 1. 悬停 / **键盘选中**时右侧气泡（`Tooltip` + `forceVisible`）—— 焦点在输入框、
 *    指针不动，所以选中项必须受控显示，不能只靠 `mouseenter`；
 * 2. 无悬停能力的设备（手机远控页，`hover: none`）气泡那条路走不通，描述就在选项
 *    内折行显示（CSS 媒体查询控制，组件不做宿主判断）。
 *
 * 无障碍：气泡的 `aria-describedby` 由 Tooltip 挂在触发元素上，读屏能拿到描述。
 */
const CommandRow: React.FC<{
  command: SlashCommand;
  isSelected: boolean;
  /** 鼠标是否停在**列表里任意一项**上（见 SlashCommandsPopup 里 `hoveredId` 的注释）。
   *  为真时选中项不再常显气泡 —— 此刻由 hover 那一项自己出气泡。 */
  isAnyHovered: boolean;
  onHoverChange: (id: string | null) => void;
  onSelect: (command: SlashCommand) => void;
}> = ({ command, isSelected, isAnyHovered, onHoverChange, onSelect }) => (
  <li
    className={`slash-command-item ${isSelected ? "selected" : ""}`}
    onMouseEnter={() => onHoverChange(command.id)}
    onMouseLeave={() => onHoverChange(null)}
    onMouseDown={(e) => {
      e.preventDefault();
      onSelect(command);
    }}
    data-testid={`slash-command-${command.id}`}
  >
    <Tooltip
      text={command.description}
      multiline
      position="right"
      portal
      disabled={!command.description}
      forceVisible={isSelected && !isAnyHovered}
      className="slash-command-row-wrap"
    >
      <div className="slash-command-row">
        <div className="slash-command-name">/{command.name}</div>
        {command.skillSource && (
          <span
            className={`slash-command-tag slash-command-tag-${command.skillSource}`}
            data-testid={`slash-command-source-${command.id}`}
          >
            {SKILL_SOURCE_LABELS[command.skillSource]}
          </span>
        )}
      </div>
    </Tooltip>
    {command.description && (
      <div className="slash-command-description">{command.description}</div>
    )}
  </li>
);

export const SlashCommandsPopup: React.FC<SlashCommandsPopupProps> = ({
  commands,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
  position,
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  // 鼠标停在哪个选项上。选中项的气泡是常显的（键盘上下键时焦点在输入框，没有 hover
  // 可依赖），但鼠标停到**别的**选项上时不能两颗气泡一起挂（停在 A、键盘选中 B 就会
  // 看到 A 和 B 的描述各挂一颗）。规则：鼠标在列表里时只认 hover 那一条，选中项的常
  // 显气泡让位；鼠标移出后选中项的气泡回来。
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 弹层关掉时必须清掉它：DOM 一卸载，`mouseleave` 就没机会补发，残留一个非空的
  // `hoveredId` 会让下次打开时选中项的气泡被「有项被悬停」这条规则压住。
  useEffect(() => {
    if (!isVisible) setHoveredId(null);
  }, [isVisible]);

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
                  return (
                    <CommandRow
                      key={command.id}
                      command={command}
                      isSelected={displayIndex === selectedIndex}
                      isAnyHovered={hoveredId !== null}
                      onHoverChange={setHoveredId}
                      onSelect={onSelect}
                    />
                  );
                })}
              </ul>
            </div>
          ))
      )}
    </div>
  );
};
