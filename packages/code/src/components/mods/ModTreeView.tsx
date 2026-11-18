import React from "react";
import { Box, Text, useWindowSize } from "ink";
import type { ModTreeNode } from "wave-agent-sdk/types";
import { Markdown } from "../Markdown.js";

/**
 * 把 mod 返回的元素树画成 Ink（spec `ecosystem/plugin-mods.md`「终端渲染」）。
 *
 * 与 webview 那份 `ModPanelRenderer` 同一个输入、不同的输出：树是宿主侧校验过的
 * 纯数据，这里每个元素对应一段固定实现。终端那张表少 `Svg`（校验器已经按端拒掉
 * 了，这里兜底画一行占位），其余九个元素直译成 Ink 自己的 flexbox。
 *
 * 这里**不发事件**：终端没有指针，交互只有「焦点 + 键盘」一条路，由
 * `ModPane` 收键盘、按 `key` 回传给 mod。本组件只知道「谁现在被聚焦」。
 */

/** 主题 token → 终端色（spec「颜色收两类值」）。表外的值原样交给 chalk。 */
const TOKEN_COLORS: Record<string, string> = {
  text: "white",
  subtle: "gray",
  inactive: "gray",
  inverseText: "black",
  suggestion: "cyan",
  remember: "cyan",
  merged: "cyan",
  success: "green",
  autoAccept: "green",
  warning: "yellow",
  permission: "yellow",
  error: "red",
  planMode: "blue",
  ide: "blue",
  claude: "cyan",
  promptBorder: "gray",
  bashBorder: "gray",
  diffAdded: "green",
  diffRemoved: "red",
  diffAddedDimmed: "green",
  diffRemovedDimmed: "red",
  diffAddedWord: "green",
  diffRemovedWord: "red",
};

/** 主题键取终端色；`#rgb` / `red` 这类原样用（chalk 认得两种）。 */
function modColor(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return TOKEN_COLORS[value] ?? value;
}

/**
 * 间距档位 → 终端格数。
 *
 * CSS 的 4/8/12/16/24px 在终端里没有像素概念：一格里能放一个汉字，所以压成
 * 1/2/3/4/6 格。数字仍按格算 —— mod 写 `padding={1}` 想要的就是「空一格」。
 */
const SPACE: Record<string, number> = { xs: 1, sm: 2, md: 3, lg: 4, xl: 6 };

function space(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string" && SPACE[value] !== undefined) {
    return SPACE[value];
  }
  return undefined;
}

/** `weight` / `bold` 合成一个布尔：终端只有「粗」与「不粗」。 */
function isBold(props: Record<string, unknown>): boolean {
  if (props.bold === true) return true;
  return props.weight === "semibold" || props.weight === "bold";
}

/** `Progress` 的字符条：`█` 填、`░` 空。 */
function progressBar(ratio: number, cells: number): string {
  const filled = Math.round(ratio * cells);
  return "█".repeat(filled) + "░".repeat(Math.max(0, cells - filled));
}

/**
 * `Code format="diff"` 的行着色（spec「元素」的 `Code.format`）：`+` 绿、`-` 红、
 * `@@` 用 `planMode`，其余保持原色。
 *
 * **不从内容猜**：只有 mod 自己声明了 `format="diff"` 才走到这里，一段以 `+` 开头
 * 的普通文本不会被染绿。
 */
function diffLineColor(line: string): string | undefined {
  if (line.startsWith("+")) return modColor("diffAdded");
  if (line.startsWith("-")) return modColor("diffRemoved");
  if (line.startsWith("@@")) return modColor("planMode");
  return undefined;
}

export interface ModTreeViewProps {
  node: ModTreeNode | string;
  /**
   * 当前聚焦的可交互节点 `key`。终端没有指针，焦点就是唯一的「选中」概念 ——
   * 被聚焦的 `Button` 反白、`Input` 显示光标、`Select` 显示候选。
   */
  focusKey?: string;
  /** 正在编辑的 `Input` 的内容（父组件持有，回车时提交给 mod）。 */
  draft?: string;
  /** 展开中的 `Select`：`key` 与候选下标。 */
  openSelect?: { key: string; index: number };
}

export const ModTreeView: React.FC<ModTreeViewProps> = ({
  node,
  focusKey,
  draft,
  openSelect,
}) => {
  const { columns } = useWindowSize();

  if (typeof node === "string") return <Text>{node}</Text>;

  const props = node.props;
  const children = node.children.map((child, index) => (
    <ModTreeView
      // 树是纯数据，同一层里位置就是身份（mod 要稳定身份会给 `key`）。
      key={index}
      node={child}
      focusKey={focusKey}
      draft={draft}
      openSelect={openSelect}
    />
  ));

  switch (node.type) {
    case "Box": {
      const gap = space(props.gap);
      const width = typeof props.width === "number" ? props.width : undefined;
      return (
        <Box
          flexDirection={props.flexDirection === "column" ? "column" : "row"}
          flexWrap={props.flexWrap === "wrap" ? "wrap" : "nowrap"}
          flexGrow={
            typeof props.flexGrow === "number" ? props.flexGrow : undefined
          }
          flexShrink={
            typeof props.flexShrink === "number" ? props.flexShrink : undefined
          }
          columnGap={space(props.columnGap) ?? gap}
          rowGap={space(props.rowGap) ?? undefined}
          padding={space(props.padding)}
          paddingX={space(props.paddingX)}
          paddingY={space(props.paddingY)}
          paddingTop={space(props.paddingTop)}
          paddingRight={space(props.paddingRight)}
          paddingBottom={space(props.paddingBottom)}
          paddingLeft={space(props.paddingLeft)}
          margin={space(props.margin)}
          marginX={space(props.marginX)}
          marginY={space(props.marginY)}
          marginTop={space(props.marginTop)}
          marginRight={space(props.marginRight)}
          marginBottom={space(props.marginBottom)}
          marginLeft={space(props.marginLeft)}
          width={width}
          borderStyle={
            props.borderStyle === "round"
              ? "round"
              : props.borderStyle === "single"
                ? "single"
                : undefined
          }
          borderColor={modColor(props.borderColor)}
          borderDimColor={props.borderDimColor === true}
          backgroundColor={modColor(props.backgroundColor)}
          alignItems={
            props.alignItems === "center" ||
            props.alignItems === "flex-start" ||
            props.alignItems === "flex-end"
              ? props.alignItems
              : undefined
          }
          justifyContent={
            props.justifyContent === "center" ||
            props.justifyContent === "flex-start" ||
            props.justifyContent === "flex-end" ||
            props.justifyContent === "space-between"
              ? props.justifyContent
              : undefined
          }
          display={props.display === "none" ? "none" : undefined}
        >
          {children}
        </Box>
      );
    }
    case "Text":
      return (
        <Text
          color={modColor(props.color)}
          backgroundColor={modColor(props.backgroundColor)}
          bold={isBold(props)}
          dimColor={props.dimColor === true}
          italic={props.italic === true}
          underline={props.underline === true}
          strikethrough={props.strikethrough === true}
          inverse={props.inverse === true}
          wrap={props.wrap === "truncate-end" ? "truncate" : undefined}
        >
          {children}
        </Text>
      );
    case "Button": {
      const buttonKey = String(props.key ?? "");
      const focused = focusKey !== undefined && buttonKey === focusKey;
      // `role="dismiss"`：关掉它所在站点的那颗控件。终端里画成 `✕`，`label`
      // 退成热键提示——与桌面端「画成原生关闭控件、label 只当无障碍名」同一套。
      const dismiss = props.role === "dismiss";
      const label = dismiss
        ? "✕"
        : children.length > 0
          ? children
          : typeof props.label === "string"
            ? props.label
            : buttonKey;
      const hotkey =
        typeof props.hotkey === "string" ? `(${props.hotkey})` : undefined;
      return (
        <Text
          color={
            props.variant === "primary" && !focused
              ? "cyan"
              : modColor(props.color)
          }
          inverse={focused}
          dimColor={props.dimColor === true && !focused}
        >
          {focused ? "▸ " : ""}
          {label}
          {hotkey ? (dismiss ? "" : ` ${hotkey}`) : ""}
        </Text>
      );
    }
    case "Input": {
      const inputKey = String(props.key ?? "");
      const focused = focusKey !== undefined && inputKey === focusKey;
      const label = typeof props.label === "string" ? props.label : undefined;
      const text = focused
        ? (draft ?? "")
        : typeof props.value === "string"
          ? props.value
          : "";
      const placeholder =
        typeof props.placeholder === "string" ? props.placeholder : "";
      return (
        <Text>
          {label ? `${label}: ` : ""}
          <Text dimColor={!text}>{text || placeholder}</Text>
          {focused ? "▏" : ""}
        </Text>
      );
    }
    case "Select": {
      const selectKey = String(props.key ?? "");
      const focused = focusKey !== undefined && selectKey === focusKey;
      const options = Array.isArray(props.options) ? props.options : [];
      const value = typeof props.value === "string" ? props.value : undefined;
      const label = typeof props.label === "string" ? props.label : undefined;
      const current =
        options.find((option) => option.value === value)?.label ?? value ?? "";
      const expanded = focused && openSelect?.key === selectKey;
      return (
        <Box flexDirection="column">
          <Text inverse={focused && !expanded}>
            {label ? `${label}: ` : ""}
            {current}
            {focused ? " ▾" : ""}
          </Text>
          {expanded
            ? options.map((option, index) => (
                <Text key={option.value} inverse={index === openSelect?.index}>
                  {index === openSelect?.index ? "❯ " : "  "}
                  {option.label ?? option.value}
                </Text>
              ))
            : null}
        </Box>
      );
    }
    case "Progress": {
      const label = typeof props.label === "string" ? props.label : "";
      const value = typeof props.value === "number" ? props.value : undefined;
      const max =
        typeof props.max === "number" && props.max > 0 ? props.max : 1;
      const known = value !== undefined && Number.isFinite(value);
      const ratio = known ? Math.min(1, Math.max(0, value / max)) : 0;
      // 站点行宽的 1/3，夹在 10–40 格：窄终端也画得出条，宽终端不铺满整行。
      const cells = Math.min(40, Math.max(10, Math.floor(columns / 3)));
      const figure =
        typeof props.valueText === "string"
          ? props.valueText
          : known
            ? `${Math.round(ratio * 100)}%`
            : "";
      return (
        <Text color={modColor(props.color)}>
          {label ? `${label} ` : ""}
          {progressBar(ratio, cells)}
          {figure ? ` ${figure}` : ""}
        </Text>
      );
    }
    case "Link": {
      const href = typeof props.href === "string" ? props.href : "";
      const label =
        node.children.length > 0
          ? children
          : typeof props.label === "string"
            ? props.label
            : href;
      // 终端里点了不跳（spec「终端渲染」）：画成带下划线的文本，地址留在原处
      // 便于复制。
      return <Text underline>{label}</Text>;
    }
    case "Code": {
      const source = typeof props.source === "string" ? props.source : "";
      const path = typeof props.path === "string" ? props.path : "";
      const diff = props.format === "diff";
      return (
        <Box flexDirection="column">
          {path ? <Text dimColor>{path}</Text> : null}
          {source.split("\n").map((line, index) => (
            <Text
              key={index}
              color={diff ? diffLineColor(line) : undefined}
              wrap={props.wrap === "wrap" ? "wrap" : undefined}
            >
              {line}
            </Text>
          ))}
        </Box>
      );
    }
    case "Markdown": {
      const text = typeof props.text === "string" ? props.text : "";
      return <Markdown>{text}</Markdown>;
    }
    default:
      // 校验器按端拒掉了终端画不出的名字（`Svg` 等），这里是旧树/旧宿主的兜底：
      // 画一行占位，不让整块面板崩掉。
      return <Text dimColor>[{String(node.type)}]</Text>;
  }
};

/**
 * 树里可以聚焦的节点（`Button` / `Input` / `Select`），按文档顺序。
 *
 * 焦点在这些节点之间移动：终端没有指针，能聚焦的就是能交互的那三个。没有 `key`
 * 的节点收不进来 —— 回传给 mod 的事件必须带 `key` 才认得出是谁。
 */
export function collectFocusKeys(
  node: ModTreeNode | string,
  into: string[] = [],
): string[] {
  if (typeof node === "string") return into;
  const type = node.type;
  if (type === "Button" || type === "Input" || type === "Select") {
    const key = node.props.key;
    if (typeof key === "string" && key !== "") into.push(key);
  }
  for (const child of node.children) collectFocusKeys(child, into);
  return into;
}
