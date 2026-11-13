import React, { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ModPanelTree, ModTreeNode } from "wave-agent-sdk/types";
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
  /** 用户交互回传；`value` 只有 `input` 才有。 */
  onEvent: (kind: "press" | "input", key: string, value?: string) => void;
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

function boxStyle(props: Record<string, unknown>): React.CSSProperties {
  const style: React.CSSProperties = { display: "flex", minWidth: 0 };
  const direction = props.flexDirection;
  if (direction === "row" || direction === "column") {
    style.flexDirection = direction;
  }
  const gap = space(props.gap);
  if (gap !== undefined) style.gap = gap;
  const columnGap = space(props.columnGap);
  if (columnGap !== undefined) style.columnGap = columnGap;
  const rowGap = space(props.rowGap);
  if (rowGap !== undefined) style.rowGap = rowGap;
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    const padding = space(props[`padding${side}`]);
    if (padding !== undefined) style[`padding${side}`] = padding;
    const margin = space(props[`margin${side}`]);
    if (margin !== undefined) style[`margin${side}`] = margin;
  }
  if (props.width !== undefined) style.width = props.width as number | string;
  if (props.height !== undefined)
    style.height = props.height as number | string;
  if (props.alignItems !== undefined) {
    style.alignItems = props.alignItems as React.CSSProperties["alignItems"];
  }
  if (props.justifyContent !== undefined) {
    style.justifyContent =
      props.justifyContent as React.CSSProperties["justifyContent"];
  }
  if (props.overflow === "hidden" || props.overflow === "auto") {
    style.overflow = props.overflow;
  }
  if (props.borderStyle === "single" || props.borderStyle === "round") {
    style.border = "1px solid var(--vscode-panel-border, #3c3c3c)";
    style.borderRadius = props.borderStyle === "round" ? 8 : 0;
  }
  return style;
}

function textStyle(props: Record<string, unknown>): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (typeof props.color === "string") style.color = props.color;
  if (props.bold === true) style.fontWeight = 600;
  if (props.italic === true) style.fontStyle = "italic";
  if (props.underline === true) style.textDecoration = "underline";
  if (props.dimColor === true) style.opacity = 0.65;
  if (props.wrap === false) {
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
      <input
        value={value}
        placeholder={placeholder}
        data-mod-key={key}
        onChange={(event) => setValue(event.target.value)}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button type="submit" data-mod-key={`${key}:submit`}>
        {typeof node.props.submitLabel === "string"
          ? node.props.submitLabel
          : "提交"}
      </button>
    </form>
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

function renderNode(
  node: ModTreeNode | string,
  onEvent: ModPanelRendererProps["onEvent"],
  onOpenLink: ((href: string) => void) | undefined,
  index: number,
): React.ReactNode {
  if (typeof node === "string") {
    return <React.Fragment key={index}>{node}</React.Fragment>;
  }
  const children = node.children.map((child, childIndex) =>
    renderNode(child, onEvent, onOpenLink, childIndex),
  );
  switch (node.type) {
    case "Box":
      return (
        <div key={index} style={boxStyle(node.props)}>
          {children}
        </div>
      );
    case "Text":
      return (
        <span key={index} style={textStyle(node.props)}>
          {children}
        </span>
      );
    case "Button": {
      const key = String(node.props.key ?? "");
      const disabled = node.props.disabled === true;
      return (
        <button
          key={index}
          type="button"
          data-mod-key={key}
          disabled={disabled}
          onClick={() => onEvent("press", key)}
        >
          {children.length > 0
            ? children
            : typeof node.props.label === "string"
              ? node.props.label
              : key}
        </button>
      );
    }
    case "Input":
      return <ModInput key={index} node={node} onEvent={onEvent} />;
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
      return (
        <pre key={index} className="mod-panel-code" data-language={language}>
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

export function ModPanelRenderer({
  tree,
  error,
  onEvent,
  onOpenLink,
}: ModPanelRendererProps): React.ReactElement {
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
          <div className="mod-panel-root" data-testid="mod-panel-root">
            {renderNode(tree, onEvent, onOpenLink, 0)}
          </div>
        ) : null}
      </>
    );
  }
  if (!tree) {
    return <div className="mod-panel-empty">mod 没有返回内容</div>;
  }
  return (
    <div className="mod-panel-root" data-testid="mod-panel-root">
      {renderNode(tree, onEvent, onOpenLink, 0)}
    </div>
  );
}
