import React, { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ModPanelTree, ModTreeNode } from "wave-agent-sdk/types";
import { CloseTabIcon } from "./CloseTabIcon";
import "../styles/ModPanel.css";

/**
 * 把一个 mod 返回的元素树画成 React（spec `ecosystem/plugin-mods.md`）。
 *
 * ## 为什么是「树上七个固定元素」而不是任意 React
 *
 * mod 的代码跑在 CLI 进程的 vm 沙箱里，webview 拿到的只是一棵 JSON 树。所以
 * 这里不需要（也不能）渲染组件、传函数 prop、读任意上下文 —— 每种元素对应
 * 一段固定实现，事件只以 `{ kind, key }` 回传给宿主，由宿主再交给 mod。
 *
 * 校验（节点数/深度/文本量/`href` 白名单）在宿主侧做完了，这里只负责画；
 * 唯一还要自己判的是「这个 type 我不认识」—— 旧 webview 遇到新元素时画一行
 * 占位，而不是整块崩掉。
 */
export interface ModPanelRendererProps {
  tree: ModPanelTree | null;
  /** 编译 / 校验 / 钩子失败的摘要，优先于树显示。 */
  error?: string;
  /** 用户交互回传；`value` 只有 `input`（提交的文字）与 `select`（选中项）才有。 */
  onEvent: (
    kind: "press" | "input" | "select",
    key: string,
    value?: string,
  ) => void;
  /**
   * 外链点击。桌面端的 webview 里直接导航会顶掉整个界面，所以链接一律交给
   * 宿主开系统浏览器（`openExternal`）——与聊天正文里的处理一致。
   */
  onOpenLink?: (href: string) => void;
}

const SPACE_SCALE: Record<string, number> = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

/** `padding*` / `gap` 这类间距既能写数字（px）也能写档位名。 */
function space(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && SPACE_SCALE[value] !== undefined) {
    return SPACE_SCALE[value];
  }
  return undefined;
}

/**
 * 主题色名 → 我们自己的 CSS 变量（spec「颜色收两类值」）。
 *
 * mod 写 `color="success"` 是想说「用主题的绿」，不是想让宿主的绿恰好也叫
 * success；所以这里把 Claude Code 的 24 个主题键翻成 `--cc-*`，宿主（桌面端 /
 * VS Code / JB）按自己的主题给值，没给就走括号里的兜底。变量名对不上是刻意
 * 的：键名是 CC 的公开契约，变量名是我们宿主的主题系统。
 */
const TOKEN_COLORS: Record<string, string> = {
  text: "var(--cc-text-primary, inherit)",
  subtle: "var(--cc-text-secondary, #6c7076)",
  inactive: "var(--cc-text-placeholder, #858b8f)",
  inverseText: "var(--cc-bg-panel, #fff)",
  suggestion: "var(--cc-text-link, #2f6fdd)",
  remember: "var(--cc-text-link, #2f6fdd)",
  merged: "var(--cc-text-link, #2f6fdd)",
  success: "var(--cc-color-success, #2e7d32)",
  autoAccept: "var(--cc-color-success, #2e7d32)",
  warning: "var(--cc-state-waiting, #b26a00)",
  permission: "var(--cc-state-waiting, #b26a00)",
  error: "var(--cc-color-danger, #c62828)",
  planMode: "var(--cc-color-info, #1565c0)",
  ide: "var(--cc-color-info, #1565c0)",
  claude: "var(--cc-action-primary, #2f6fdd)",
  promptBorder: "var(--cc-border, #d9dbe0)",
  bashBorder: "var(--cc-border, #d9dbe0)",
  diffAdded: "var(--cc-color-success, #2e7d32)",
  diffRemoved: "var(--cc-color-danger, #c62828)",
  diffAddedDimmed: "var(--cc-color-success-soft, rgba(46, 125, 50, 0.14))",
  diffRemovedDimmed: "var(--cc-color-danger-soft, rgba(198, 40, 40, 0.14))",
  diffAddedWord: "var(--cc-color-success, #2e7d32)",
  diffRemovedWord: "var(--cc-color-danger, #c62828)",
};

/** 主题键取变量，其余（`#rgb` / `rgb()` / `red`）原样交给 CSS 判是否合法。 */
function modColor(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return TOKEN_COLORS[value] ?? value;
}

const TEXT_WEIGHTS: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

const TEXT_SIZES: Record<string, number> = {
  caption: 11,
  footnote: 12,
  body: 13,
  heading: 16,
  title: 20,
};

/**
 * `hover` 与基准 props 的合并：hover 只覆盖它写了的键。
 *
 * 校验器已经把 hover 的键卡进该元素的白名单（`Box` 只认边框/底色/显隐，
 * `Text` 只认字色/字重），所以这里的覆盖是同类替换，不会把 `hover` 里的
 * `color` 贴到 `Box` 上。
 */
function mergeHover(
  props: Record<string, unknown>,
  hover: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return hover === undefined ? props : { ...props, ...hover };
}

function boxStyle(
  props: Record<string, unknown>,
  hover?: Record<string, unknown>,
): React.CSSProperties {
  props = mergeHover(props, hover);
  const style: React.CSSProperties = { display: "flex", minWidth: 0 };
  const direction = props.flexDirection;
  // 四个方向都照 `flexDirection` 的原义走（CC 的 `Box` 直接落成 CSS 值）：
  // `row-reverse` / `column-reverse` 是社区 mod 用来把主操作摆到右边/下边的写法。
  if (
    direction === "row" ||
    direction === "column" ||
    direction === "row-reverse" ||
    direction === "column-reverse"
  ) {
    style.flexDirection = direction;
  }
  // flex 子项默认 `flex-shrink: 1`：带里一排按钮会被压窄到折行。mod 要它别缩
  // 就得显式给 `flexShrink: 0`（与 Claude Code 同名 props）。
  if (typeof props.flexGrow === "number") style.flexGrow = props.flexGrow;
  if (typeof props.flexShrink === "number") style.flexShrink = props.flexShrink;
  if (props.flexWrap === "wrap" || props.flexWrap === "nowrap") {
    style.flexWrap = props.flexWrap;
  }
  const gap = space(props.gap);
  if (gap !== undefined) style.gap = gap;
  const columnGap = space(props.columnGap);
  if (columnGap !== undefined) style.columnGap = columnGap;
  const rowGap = space(props.rowGap);
  if (rowGap !== undefined) style.rowGap = rowGap;
  // 间距的轴写法**不是**别名：后写的那层覆盖先写的（`padding` → `paddingX`/
  // `paddingY` → 单边），与 Claude Code 的解析顺序一致。CSS 里没有 `paddingX`
  // 这个属性，所以只能在这里展开成左右/上下。
  const padding = space(props.padding);
  if (padding !== undefined) style.padding = padding;
  const paddingX = space(props.paddingX);
  if (paddingX !== undefined) {
    style.paddingLeft = paddingX;
    style.paddingRight = paddingX;
  }
  const paddingY = space(props.paddingY);
  if (paddingY !== undefined) {
    style.paddingTop = paddingY;
    style.paddingBottom = paddingY;
  }
  const margin = space(props.margin);
  if (margin !== undefined) style.margin = margin;
  const marginX = space(props.marginX);
  if (marginX !== undefined) {
    style.marginLeft = marginX;
    style.marginRight = marginX;
  }
  const marginY = space(props.marginY);
  if (marginY !== undefined) {
    style.marginTop = marginY;
    style.marginBottom = marginY;
  }
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    const padding = space(props[`padding${side}`]);
    if (padding !== undefined) style[`padding${side}`] = padding;
    const margin = space(props[`margin${side}`]);
    if (margin !== undefined) style[`margin${side}`] = margin;
  }
  if (props.width !== undefined) style.width = props.width as number | string;
  if (props.height !== undefined)
    style.height = props.height as number | string;
  if (props.minWidth !== undefined) {
    style.minWidth = props.minWidth as number | string;
  }
  if (props.minHeight !== undefined) {
    style.minHeight = props.minHeight as number | string;
  }
  if (props.alignItems !== undefined) {
    style.alignItems = props.alignItems as React.CSSProperties["alignItems"];
  }
  if (props.alignSelf !== undefined) {
    style.alignSelf = props.alignSelf as React.CSSProperties["alignSelf"];
  }
  if (props.justifyContent !== undefined) {
    style.justifyContent =
      props.justifyContent as React.CSSProperties["justifyContent"];
  }
  if (props.display === "none") style.display = "none";
  if (props.overflow === "hidden" || props.overflow === "auto") {
    style.overflow = props.overflow;
  }
  if (props.position === "absolute" || props.position === "relative") {
    style.position = props.position;
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const offset = space(props[edge]);
      if (offset !== undefined) style[edge] = offset;
    }
  }
  const background = modColor(props.backgroundColor);
  if (background !== undefined) style.background = background;
  if (props.borderStyle === "single" || props.borderStyle === "round") {
    const borderColor = modColor(props.borderColor);
    style.border =
      borderColor === undefined
        ? "1px solid var(--vscode-panel-border, #3c3c3c)"
        : `1px solid ${borderColor}`;
    style.borderRadius = props.borderStyle === "round" ? 8 : 0;
    if (props.borderDimColor === true) style.opacity = 0.65;
  }
  return style;
}

function textStyle(
  props: Record<string, unknown>,
  hover?: Record<string, unknown>,
): React.CSSProperties {
  const merged = mergeHover(props, hover);
  const style: React.CSSProperties = {};
  const color = modColor(merged.color);
  if (color !== undefined) style.color = color;
  const background = modColor(merged.backgroundColor);
  if (background !== undefined) style.background = background;
  const weight = merged.weight;
  if (typeof weight === "string" && TEXT_WEIGHTS[weight] !== undefined) {
    style.fontWeight = TEXT_WEIGHTS[weight];
  }
  // `bold` 是旧写法、语义等于 `semibold`；两个都写时 `weight` 更具体。
  if (merged.bold === true && style.fontWeight === undefined) {
    style.fontWeight = 600;
  }
  const size = merged.size;
  if (typeof size === "string" && TEXT_SIZES[size] !== undefined) {
    style.fontSize = TEXT_SIZES[size];
  }
  if (merged.italic === true) style.fontStyle = "italic";
  const decorations: string[] = [];
  if (merged.underline === true) decorations.push("underline");
  if (merged.strikethrough === true) decorations.push("line-through");
  if (decorations.length > 0) style.textDecoration = decorations.join(" ");
  // `inverse` 是终端那套「反显」：字色与底色对调。没有底色的文字按面板底色算，
  // 否则反显出来的字会看不见。
  if (merged.inverse === true) {
    style.color = background ?? "var(--cc-bg-panel, #fff)";
    style.background = color ?? "var(--cc-text-primary, #1f2329)";
  }
  if (merged.dimColor === true) style.opacity = 0.65;
  if (merged.wrap === false) {
    style.whiteSpace = "nowrap";
    style.overflow = "hidden";
    style.textOverflow = "ellipsis";
  }
  return style;
}

/** 受控输入：值只活在 webview 里，提交时才回到 mod（mod 不该收到每一次击键）。 */
function ModInput({
  node,
  onEvent,
}: {
  node: ModTreeNode;
  onEvent: ModPanelRendererProps["onEvent"];
}): React.ReactElement {
  const key = String(node.props.key ?? "");
  const [value, setValue] = useState(
    typeof node.props.value === "string" ? node.props.value : "",
  );
  const label =
    typeof node.props.label === "string" ? node.props.label : undefined;
  const placeholder =
    typeof node.props.placeholder === "string" ? node.props.placeholder : "";
  // `rows` ≥ 2 换多行输入框：回车仍是提交（这是本组件的既有语义，多行输入框
  // 若把回车吃掉，提交动作就只剩那个按钮可点了），换行走 Shift+Enter。
  const rows =
    typeof node.props.rows === "number" && node.props.rows >= 2
      ? Math.floor(node.props.rows)
      : 0;
  const submit = () => {
    onEvent("input", key, value);
    // 提交即清空（spec 场景 2「输入框清空」）：值已经交给 mod，留在这里只会让
    // 用户重复提交同一句。mod 想保留就把它写进 `$.state` 再用 `value` 回填。
    setValue("");
  };
  return (
    <form
      className="mod-panel-input"
      style={{ display: "flex", gap: 8, alignItems: "center" }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {label ? <span>{label}</span> : null}
      {rows > 0 ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          data-mod-key={key}
          autoFocus={node.props.autoFocus === true}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          style={{ flex: 1, minWidth: 0, resize: "vertical" }}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          data-mod-key={key}
          autoFocus={node.props.autoFocus === true}
          onChange={(event) => setValue(event.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
      )}
      <button type="submit" data-mod-key={`${key}:submit`}>
        {typeof node.props.submitLabel === "string"
          ? node.props.submitLabel
          : "提交"}
      </button>
    </form>
  );
}

/**
 * 下拉：选中项由树上的 `value` 决定，webview 不自己记。
 *
 * 选中只回 `select` 事件，界面等下一次渲染 —— mod 没有把 `value` 改过来时，
 * 选中项就该原地不动（`Input` 提交后清空是同一条纪律：控件的状态归 mod）。
 */
function ModSelect({
  node,
  onEvent,
}: {
  node: ModTreeNode;
  onEvent: ModPanelRendererProps["onEvent"];
}): React.ReactElement {
  const key = String(node.props.key ?? "");
  const label =
    typeof node.props.label === "string" ? node.props.label : undefined;
  const value = typeof node.props.value === "string" ? node.props.value : "";
  const options = Array.isArray(node.props.options)
    ? (node.props.options as Array<{ value?: unknown; label?: unknown }>)
    : [];
  return (
    <label className="mod-panel-select">
      {label ? <span>{label}</span> : null}
      <select
        data-mod-key={key}
        value={value}
        onChange={(event) => onEvent("select", key, event.target.value)}
      >
        {options.map((option) => {
          const optionValue = String(option.value ?? "");
          return (
            <option key={optionValue} value={optionValue}>
              {typeof option.label === "string" ? option.label : optionValue}
            </option>
          );
        })}
      </select>
    </label>
  );
}

/**
 * 一段 SVG 标记，内联画出来。
 *
 * 走 DOMPurify 的 svg profile：mod 的 `source` 是**字符串**，里面写 `<script>`
 * 或 `onload=` 与聊天正文里的 markdown 同一条风险，净化口径也照抄那边。宽高由
 * prop 给（校验器已经把它夹到 0–4096），缺省按 `viewBox` 自适应。
 */
function ModSvg({ node }: { node: ModTreeNode }): React.ReactElement {
  const source = typeof node.props.source === "string" ? node.props.source : "";
  const alt = typeof node.props.alt === "string" ? node.props.alt : "";
  const html = useMemo(
    () =>
      DOMPurify.sanitize(source, {
        USE_PROFILES: { svg: true, svgFilters: true },
      }),
    [source],
  );
  const style: React.CSSProperties = {
    display: "block",
    maxWidth: "100%",
    ...(typeof node.props.width === "number"
      ? { width: node.props.width }
      : {}),
    ...(typeof node.props.height === "number"
      ? { height: node.props.height }
      : {}),
    // 非交互的图不吃指针事件：它常常被当背景用，挡着下面的按钮就白画了。
    ...(node.props.isInteractive === false ? { pointerEvents: "none" } : {}),
  };
  return (
    <div
      className="mod-panel-svg"
      role="img"
      aria-label={alt}
      style={style}
      // 净化后的 SVG 只能整段内联：它是标记语言，没有「逐节点画」这条路。
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** `value/max` 夹到 0–1；`max` 缺省 1（与 Claude Code 同一个口径）。 */
function progressRatio(props: Record<string, unknown>): number | undefined {
  const value = props.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const max =
    typeof props.max === "number" && Number.isFinite(props.max) && props.max > 0
      ? props.max
      : 1;
  return Math.min(1, Math.max(0, value / max));
}

function ModProgress({ node }: { node: ModTreeNode }): React.ReactElement {
  const label = typeof node.props.label === "string" ? node.props.label : "";
  const ratio = progressRatio(node.props);
  const text =
    typeof node.props.valueText === "string"
      ? node.props.valueText
      : ratio === undefined
        ? undefined
        : `${Math.round(ratio * 100)}%`;
  return (
    <div className="mod-panel-progress">
      <div className="mod-panel-progress-head">
        <span>{label}</span>
        {text === undefined ? null : <span>{text}</span>}
      </div>
      {ratio === undefined ? null : (
        <div
          className="mod-panel-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(ratio * 100)}
          aria-label={label}
        >
          <div
            className="mod-panel-progress-fill"
            style={{
              width: `${ratio * 100}%`,
              ...(modColor(node.props.color) === undefined
                ? {}
                : { background: modColor(node.props.color) }),
            }}
          />
        </div>
      )}
    </div>
  );
}

function ModMarkdown({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink?: (href: string) => void;
}): React.ReactElement {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
        USE_PROFILES: { html: true },
      }),
    [text],
  );
  return (
    <div
      className="mod-panel-markdown"
      // markdown 里的链接同样是 HTML 注入出来的，只能在容器上捕获后交给宿主。
      onClick={(event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        const href = anchor?.getAttribute("href");
        if (!href || !onOpenLink) return;
        event.preventDefault();
        onOpenLink(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * 悬停态。规范在 spec「元素」里：`hover` 是节点的**独立字段**，作用域是离它
 * 最近的带 `key` 的 `Box`（或者它自己写的 `hover.scope`）。所以「指着这一行，
 * 行里某个字变色」不用在树上重复写作用域 ID —— 作用域由树的形状决定，跟
 * Claude Code 的口径一致。
 *
 * 状态挂在 {@link ModPanelRenderer} 上（而不是每个节点各持一份），否则同一个
 * 作用域里的几个节点会各自算自己的悬停、指针一移就闪。
 */
interface HoverCtx {
  active: ReadonlySet<string>;
  enter: (scope: string) => void;
  leave: (scope: string) => void;
}

/** 去掉 `hover.scope`（它是作用域声明，不是样式）。 */
function styleHover(
  hover: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (hover === undefined) return undefined;
  const rest: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(hover)) {
    if (name !== "scope") rest[name] = value;
  }
  return rest;
}

function renderNode(
  node: ModTreeNode | string,
  onEvent: ModPanelRendererProps["onEvent"],
  onOpenLink: ((href: string) => void) | undefined,
  index: number,
  hover: HoverCtx,
  scope: string | undefined,
): React.ReactNode {
  if (typeof node === "string") {
    return <React.Fragment key={index}>{node}</React.Fragment>;
  }
  const nodeHover = node.hover;
  const key = typeof node.props.key === "string" ? node.props.key : undefined;
  const explicitScope =
    typeof nodeHover?.scope === "string" ? nodeHover.scope : undefined;
  // 解析顺序：`hover.scope` > 自己带字符串 key 的 `Box`（自己就是宿主）> 祖先。
  const nodeScope =
    explicitScope ??
    (node.type === "Box" && key !== undefined ? key : undefined) ??
    scope;
  const hovered =
    nodeHover !== undefined &&
    nodeScope !== undefined &&
    hover.active.has(nodeScope);
  const activeHover = hovered ? styleHover(nodeHover) : undefined;
  // 指针进出只挂在**作用域宿主**上：给叶子节点也挂一遍会让进入子节点时先触发
  // 父节点 leave（React 的 pointerenter/leave 不冒泡，但宿主重复绑定会互相抵消）。
  const isScopeHost =
    nodeScope !== undefined &&
    (explicitScope !== undefined || (node.type === "Box" && key === nodeScope));
  const hoverHandlers =
    isScopeHost && nodeScope !== undefined
      ? {
          onPointerEnter: () => hover.enter(nodeScope),
          onPointerLeave: () => hover.leave(nodeScope),
        }
      : {};
  const children = node.children.map((child, childIndex) =>
    renderNode(child, onEvent, onOpenLink, childIndex, hover, nodeScope),
  );
  switch (node.type) {
    case "Box":
      return (
        <div
          key={index}
          style={boxStyle(node.props, activeHover)}
          {...hoverHandlers}
        >
          {children}
        </div>
      );
    case "Text":
      return (
        <span
          key={index}
          style={textStyle(node.props, activeHover)}
          {...hoverHandlers}
        >
          {children}
        </span>
      );
    case "Button": {
      const buttonKey = String(node.props.key ?? "");
      // `variant` 是纯外观：`primary` 用主题强调色，`secondary`/未给用中性底。
      const variant = node.props.variant;
      // `plain`：去掉边框与底色的按钮（工具栏里那一排「开关」用它）。它与
      // `variant` 互斥 —— 没有底色的按钮谈不上「主操作色」。
      const plain = node.props.plain === true;
      // `role="dismiss"`：这个按钮关闭它所在的站点。桌面端把它画成那颗关闭控件
      // （与面板页签的 × 同一颗），`label` 不再画出来、改当无障碍名 —— 与 Claude
      // Code 的「a desktop its native close control, the label its accessible
      // name」同一套。它不是行为声明：关了之后发生什么由 `onPress` 决定。
      const dismiss = node.props.role === "dismiss";
      const classes = ["mod-button"];
      if (dismiss) {
        classes.push("mod-button-plain", "mod-button-dismiss");
      } else if (plain) {
        classes.push("mod-button-plain");
      } else if (variant === "primary" || variant === "secondary") {
        classes.push(`mod-button-${variant}`);
      }
      // `dimColor` 是「静止时调暗」：指针进来就恢复全强度（否则悬停上去还是
      // 半透明的字，看不出被指着）。
      const labelProps =
        node.props.dimColor === true && hovered
          ? { ...node.props, dimColor: false }
          : node.props;
      return (
        <button
          key={index}
          type="button"
          className={classes.join(" ")}
          data-mod-key={buttonKey}
          data-mod-hotkey={
            typeof node.props.hotkey === "string"
              ? node.props.hotkey
              : undefined
          }
          autoFocus={node.props.autoFocus === true}
          aria-label={
            dismiss && typeof node.props.label === "string"
              ? node.props.label
              : undefined
          }
          onClick={() => onEvent("press", buttonKey)}
          {...hoverHandlers}
        >
          {/* 标签一律包一层 span：`hover` 在 `Button` 上改的是**字**（字色/字重），
              与 Claude Code 的 `ButtonHoverProps` 同一套。`dismiss` 的按钮画的
              是关闭字形，`label` 已经给了 `aria-label`。 */}
          <span style={textStyle(labelProps, activeHover)}>
            {dismiss ? (
              <CloseTabIcon />
            ) : children.length > 0 ? (
              children
            ) : typeof node.props.label === "string" ? (
              node.props.label
            ) : (
              buttonKey
            )}
          </span>
          {/* 快捷键画成一个小的键帽：不画的话用户无从知道有热键（Claude Code
              的桌面端也把键摆在标签旁边）。 */}
          {typeof node.props.hotkey === "string" ? (
            <kbd className="mod-button-hotkey">{node.props.hotkey}</kbd>
          ) : null}
        </button>
      );
    }
    case "Input":
      return <ModInput key={index} node={node} onEvent={onEvent} />;
    case "Select":
      return <ModSelect key={index} node={node} onEvent={onEvent} />;
    case "Svg":
      return <ModSvg key={index} node={node} />;
    case "Progress":
      return <ModProgress key={index} node={node} />;
    case "Link": {
      const href = String(node.props.href ?? "");
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            if (!onOpenLink) return;
            event.preventDefault();
            onOpenLink(href);
          }}
        >
          {children.length > 0
            ? children
            : typeof node.props.label === "string"
              ? node.props.label
              : href}
        </a>
      );
    }
    case "Code": {
      const language =
        typeof node.props.language === "string" ? node.props.language : "";
      const path = typeof node.props.path === "string" ? node.props.path : "";
      // `wrap`：终端里 `truncate-end` 是「一行、超出打点」，`wrap` 是折行。
      const wrap = node.props.wrap;
      const wrapStyle: React.CSSProperties =
        wrap === "wrap"
          ? { whiteSpace: "pre-wrap" }
          : wrap === "truncate-end"
            ? {
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }
            : {};
      return (
        <pre
          key={index}
          className="mod-panel-code"
          data-language={language}
          style={Object.keys(wrapStyle).length > 0 ? wrapStyle : undefined}
        >
          {path ? <div className="mod-panel-code-path">{path}</div> : null}
          <code>
            {typeof node.props.source === "string" ? node.props.source : ""}
          </code>
        </pre>
      );
    }
    case "Markdown":
      return (
        <ModMarkdown
          key={index}
          text={typeof node.props.text === "string" ? node.props.text : ""}
          onOpenLink={onOpenLink}
        />
      );
    default:
      // 旧 webview 遇到新元素：占位，不整块崩（mod 与 webview 版本不同步是常态）。
      return (
        <div
          key={index}
          className="mod-panel-unknown"
          data-mod-type={node.type}
        >
          未知元素 {node.type}
        </div>
      );
  }
}

/**
 * 面板有键盘焦点时按 `Button.hotkey` 等于点了那个按钮（spec「用户交互的结果」）。
 *
 * 三条与 Claude Code 同口径的边界：
 *
 * - **只在这个渲染器里生效**：监听挂在这棵树的根上，焦点在别处（输入框、消息
 *   区）时收不到事件，所以不会劫持全局输入。
 * - **焦点在输入类控件里时一律放行**：`Input` 拿到焦点后每个可打印键都归它，
 *   否则用户在输入框里打 `y` 会顺手点掉一个按钮。
 * - **撞键时后写的赢**：`querySelectorAll` 从后往前找第一个没被禁用的。
 */
function hotkeyHandler(
  onEvent: ModPanelRendererProps["onEvent"],
): (event: React.KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    // 带修饰键的是宿主的快捷键（Ctrl+C 那类），不是 mod 的热键。
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
      return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target?.isContentEditable === true
    ) {
      return;
    }
    const key = event.key;
    if (key.length !== 1) return;
    const hot = key.toLowerCase();
    const matches = event.currentTarget.querySelectorAll<HTMLElement>(
      `[data-mod-hotkey="${hot}"]`,
    );
    for (let at = matches.length - 1; at >= 0; at -= 1) {
      const element = matches[at]!;
      event.preventDefault();
      onEvent("press", element.dataset.modKey ?? "");
      return;
    }
  };
}

export function ModPanelRenderer({
  tree,
  error,
  onEvent,
  onOpenLink,
}: ModPanelRendererProps): React.ReactElement {
  // 悬停作用域的集合挂在这里：一帧树里可能有多个作用域同时被指（指针在嵌套的
  // 两个 Box 里），所以是 Set 不是一个值。
  const [hovered, setHovered] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const hover = useMemo<HoverCtx>(
    () => ({
      active: hovered,
      enter: (scope: string) =>
        setHovered((prev) =>
          prev.has(scope) ? prev : new Set(prev).add(scope),
        ),
      leave: (scope: string) =>
        setHovered((prev) => {
          if (!prev.has(scope)) return prev;
          const next = new Set(prev);
          next.delete(scope);
          return next;
        }),
    }),
    [hovered],
  );
  if (error) {
    // 错误条**叠在**上一帧树上，而不是顶掉它。`error` 有两个来源：加载/校验
    // 失败（这时还没有树），以及元素回调抛错（树是上一次成功渲染的那份）。
    // 后者若整块换成错误文字，用户连别的按钮都点不到，面板就废在那儿了 ——
    // 下一次 `$.ui.invalidate` 成功后错误会由宿主清掉（modManager.render）。
    return (
      <>
        <div
          className="mod-panel-error"
          role="alert"
          data-testid="mod-panel-error"
        >
          {error}
        </div>
        {tree ? (
          <div
            className="mod-panel-root"
            data-testid="mod-panel-root"
            onKeyDown={hotkeyHandler(onEvent)}
          >
            {renderNode(tree, onEvent, onOpenLink, 0, hover, undefined)}
          </div>
        ) : null}
      </>
    );
  }
  if (!tree) {
    return <div className="mod-panel-empty">mod 没有返回内容</div>;
  }
  return (
    <div
      className="mod-panel-root"
      data-testid="mod-panel-root"
      onKeyDown={hotkeyHandler(onEvent)}
    >
      {renderNode(tree, onEvent, onOpenLink, 0, hover, undefined)}
    </div>
  );
}
