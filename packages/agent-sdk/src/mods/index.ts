/**
 * `wave-agent-sdk/mods` —— 插件 mod 的**书写面**。
 *
 * mod 源码里只需要 `import { Box, Text, Button } from "wave-agent-sdk/mods"`，
 * 然后像写 React 一样写 JSX。这些"组件"的运行时值只是元素名字符串：
 * mod 跑在 agent 进程的 vm 沙箱里，`require("wave-agent-sdk/mods")` 由沙箱自己
 * 的 require 接管、返回同一份表（见 `runtime.ts`），所以**这个文件在沙箱里不会
 * 被真正加载**。它存在的意义是给插件作者的 TypeScript 提供 props 类型。
 *
 * 因此这里的每个 props 接口都要跟两侧保持一致（名单与 Claude Code 的 `desktop`
 * 表逐项对齐，只差 `Client`）：
 * - `runtime.ts` 的 `h()`：哪些 prop 会被摘走（`onPress`/`onSubmit`/`onSelect`），
 *   哪些值可序列化（其余一律丢弃；只有 `Select.options` 是对象数组）；
 * - `packages/webview/src/components/ModPanelRenderer.tsx`：哪些 prop 会被画出来。
 */

/** 间距档位，与渲染器的 `SPACE_SCALE` 对齐。 */
export type ModSpace = "xs" | "sm" | "md" | "lg" | "xl";

/**
 * 颜色：主题 token 或裸色（spec「元素」）。
 *
 * token 名与 Claude Code 的 `ThemeKey` 同名、跟随用户的明暗主题；表外的字符串
 * 当 CSS 颜色原样用（`"#f60"`、`"red"`），不做白名单校验。
 */
export type ModColor = string;

/**
 * `Box` 的悬停态（spec「元素」）。
 *
 * 值是对象，所以它是节点的**独立字段**、不在 props 里：JSX 上照常写
 * `hover={{ backgroundColor: "error" }}`，`h()` 会把它摘到节点上。
 * 没有一个 key 会让兄弟移位。
 */
export interface BoxHover {
  /** 加入这个名字的 scope，而不是最近的带 `key` 的 Box。 */
  scope?: string;
  /** 只重绘已有边框，不新增。 */
  borderStyle?: "single" | "round";
  borderColor?: ModColor;
  borderDimColor?: boolean;
  backgroundColor?: ModColor;
  /** 只认 `"flex"`：用来 reveal 一个 `display="none"` 的 Box。 */
  display?: "flex";
  /** 只对 `position="absolute"` 有效（px，可负）。 */
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}

/** `Text` / `Button` 的悬停态：改颜色与文字样式（不含 `wrap`）。 */
export interface TextHover {
  scope?: string;
  color?: ModColor;
  backgroundColor?: ModColor;
  dimColor?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

/** JSX 里能出现的东西：文本、数字、元素、条件渲染的假值、数组。 */
export type ModChild =
  | string
  | number
  | null
  | undefined
  | false
  | true
  | ModElement
  | ModChild[];

/**
 * 元素句柄。
 *
 * 不暴露真实的树结构（那是宿主与 webview 的内部契约）：作者只需要知道它可以
 * 嵌在 children 里。
 */
export interface ModElement {
  readonly __modElement: unique symbol;
}

type ModComponent<P> = (props: P) => ModElement;

function element<P>(name: string): ModComponent<P> {
  // 运行时值就是 tag 名；`h()` 只认字符串。
  return name as unknown as ModComponent<P>;
}

export interface BoxProps {
  /** 默认 `row`（与 flex 一致）。 */
  flexDirection?: "row" | "column";
  /** 一排放不下时是否折行（默认 `nowrap`，与 flex 一致）。 */
  flexWrap?: "wrap" | "nowrap";
  /** 剩余空间里怎么长/怎么缩。带里的一排按钮默认会被压窄，要它别缩就给 `flexShrink: 0`。 */
  flexGrow?: number;
  flexShrink?: number;
  gap?: number | ModSpace;
  columnGap?: number | ModSpace;
  rowGap?: number | ModSpace;
  padding?: number | ModSpace;
  /**
   * 左右一条边、上下一条边。**不是别名**：与 `paddingLeft` 这类单边写法各自生效，
   * 生效顺序是 `padding` → `paddingX` → `paddingY` → 单边（后写覆盖先写）。
   */
  paddingX?: number | ModSpace;
  paddingY?: number | ModSpace;
  paddingTop?: number | ModSpace;
  paddingRight?: number | ModSpace;
  paddingBottom?: number | ModSpace;
  paddingLeft?: number | ModSpace;
  margin?: number | ModSpace;
  marginX?: number | ModSpace;
  marginY?: number | ModSpace;
  marginTop?: number | ModSpace;
  marginRight?: number | ModSpace;
  marginBottom?: number | ModSpace;
  marginLeft?: number | ModSpace;
  width?: number | string;
  height?: number | string;
  minWidth?: number | string;
  minHeight?: number | string;
  borderStyle?: "single" | "round";
  borderColor?: ModColor;
  /** 把边框颜色调暗。 */
  borderDimColor?: boolean;
  backgroundColor?: ModColor;
  alignItems?: string;
  /** 注意没有 `stretch`（那是 `alignItems` 才有的值）。 */
  alignSelf?: "flex-start" | "center" | "flex-end" | "auto";
  justifyContent?: string;
  /** `none` 时不占位置：配合 `hover` 的 `display: "flex"` 做「悬停才展开的卡片」。 */
  display?: "flex" | "none";
  position?: "relative" | "absolute";
  /** 只有 `position="absolute"` 时才生效（px，可负）。 */
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  overflow?: "hidden" | "auto";
  /**
   * 指针落在**最近的带 `key` 的 `Box`** 里时生效（给 `scope` 时加入那个同名
   * scope）。悬停不过进程、不跑钩子：surface 自己换一组样式。
   */
  hover?: BoxHover;
  children?: ModChild;
}

export interface TextProps {
  color?: ModColor;
  backgroundColor?: ModColor;
  /** 字重。`bold: true` 是旧写法（等价 `semibold`），显式 `weight` 压过它。 */
  weight?: "regular" | "medium" | "semibold" | "bold";
  /** 语义档位，不是字号；缺省继承外层文本。 */
  size?: "caption" | "footnote" | "body" | "heading" | "title";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dimColor?: boolean;
  strikethrough?: boolean;
  /** 前景与背景互换。 */
  inverse?: boolean;
  /** `false` 表示单行截断。 */
  wrap?: boolean;
  hover?: TextHover;
  children?: ModChild;
}

export interface ButtonProps {
  /** 点击回调按它路由回 mod —— 同一个面板内必须唯一。 */
  key: string;
  label?: string;
  /** 点击时执行（在 mod 进程内）。 */
  onPress?: () => void;
  disabled?: boolean;
  /** 画面观感：`primary` 用主题主操作色，`secondary` 与不写时同一中性底。 */
  variant?: "primary" | "secondary";
  /** 画成无边框无底色的字形键（一排 `➤` / `✕` 就用它）；给了它 `variant` 不再起作用。 */
  plain?: boolean;
  /** label 静止时调暗、指针/焦点下恢复全强度。 */
  dimColor?: boolean;
  /** `true` 时把焦点放这里（一个站点里多个只第一个生效）。 */
  autoFocus?: boolean;
  /** 改的是 label 的样式。 */
  hover?: TextHover;
  children?: ModChild;
}

export interface InputProps {
  /** 提交回调按它路由回 mod —— 同一个面板内必须唯一。 */
  key: string;
  label?: string;
  placeholder?: string;
  value?: string;
  submitLabel?: string;
  /** 用户提交时拿到输入的字符串；提交后输入框清空。 */
  onSubmit?: (value: string) => void;
  autoFocus?: boolean;
  /** ≥1 的整数，缺省 1；从 2 起是多行输入（Enter 仍提交）。 */
  rows?: number;
}

export interface SelectOption {
  value: string;
  /** 缺省时列表里画 `value`。 */
  label?: string;
}

export interface SelectProps {
  /** 选中回调按它路由回 mod —— 同一个面板内必须唯一。 */
  key: string;
  /** 1–64 项，`value` 必须唯一。 */
  options: SelectOption[];
  /** 用户选了某一项时拿到那一项的 `value`。 */
  onSelect?: (value: string) => void;
  label?: string;
  /** 当前选中项；缺省时列表里没有选中项。 */
  value?: string;
  /** 只接受 `true`：面板打开时把焦点放这里。 */
  autoFocus?: boolean;
}

export interface SvgProps {
  /** 一段 SVG 标记（≤131072 字符），内联画出来。 */
  source: string;
  /** 必填：没有它，读屏与降级渲染都拿不到这张图在说什么。 */
  alt: string;
  width?: number;
  height?: number;
  /**
   * `false` 时整张图不吃指针事件（可以当背景图用）；缺省跟随浏览器默认。
   *
   * Claude Code 的桌面端只把它当「这张图是否接收交互」的开关，没有点击回调；
   * 要可点的区域请在上面盖 `Button`。
   */
  isInteractive?: boolean;
}

export interface ProgressProps {
  /** 必填：这一条在做什么（画在条上方）。 */
  label: string;
  /** 当前值；缺省时不画条、只画标签。 */
  value?: number;
  /** 满值，缺省 1。`value/max` 会被夹到 0–1。 */
  max?: number;
  /** 替代默认百分比的那段文字。 */
  valueText?: string;
  /** 条的颜色（CSS 颜色值）。 */
  color?: string;
}

export interface LinkProps {
  /** 只允许 `https:` 与本地回环 `http:`（`localhost` / `127.0.0.1` / `[::1]`）。 */
  href: string;
  label?: string;
  children?: ModChild;
}

export interface CodeProps {
  source: string;
  language?: string;
  /** 可选的一行文件路径，画在代码上方。 */
  path?: string;
  startLine?: number;
  /** 只有这两个值（`Text.wrap` 的其它拼法在这里没有意义）。 */
  wrap?: "wrap" | "truncate-end";
}

export interface MarkdownProps {
  text: string;
}

export const Box = element<BoxProps>("Box");
export const Text = element<TextProps>("Text");
export const Button = element<ButtonProps>("Button");
export const Input = element<InputProps>("Input");
export const Select = element<SelectProps>("Select");
export const Svg = element<SvgProps>("Svg");
export const Link = element<LinkProps>("Link");
export const Code = element<CodeProps>("Code");
export const Markdown = element<MarkdownProps>("Markdown");
export const Progress = element<ProgressProps>("Progress");

/** `<></>` 的片段。classic pragma 下由编译器指向 `__wave.Fragment`。 */
export const Fragment = element<{ children?: ModChild }>("Fragment");

/**
 * `atom` / `read` / `update` —— 社区的「声明一个值，然后读写它」（spec
 *「兼容社区 mod」）。
 *
 * 与元素构造器一样，这三个只是给插件作者的 TypeScript 用的：运行时由沙箱自己
 * 的 `require` 提供**同一份**实现（见 `./atoms.js`），这个文件在沙箱里不会被
 * 真正加载。
 */
export { atom, read, update } from "./atoms.js";
export type { ModAtom } from "./atoms.js";
