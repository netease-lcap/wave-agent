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
  paddingTop?: number | ModSpace;
  paddingRight?: number | ModSpace;
  paddingBottom?: number | ModSpace;
  paddingLeft?: number | ModSpace;
  marginTop?: number | ModSpace;
  marginRight?: number | ModSpace;
  marginBottom?: number | ModSpace;
  marginLeft?: number | ModSpace;
  width?: number | string;
  height?: number | string;
  borderStyle?: "single" | "round";
  alignItems?: string;
  justifyContent?: string;
  overflow?: "hidden" | "auto";
  children?: ModChild;
}

export interface TextProps {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dimColor?: boolean;
  /** `false` 表示单行截断。 */
  wrap?: boolean;
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
