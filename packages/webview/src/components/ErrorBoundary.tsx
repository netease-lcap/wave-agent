import React from "react";

/**
 * React 18 遇到渲染期抛错时会卸载整棵树：没有边界的话 `#root` 直接变空
 * —— 一片纯白，除了重新加载没有别的出路。远控页正好撞上这条（一条构造得
 * 不如预期的队列更新传到 QueuedMessageList 的 `.slice`），而手机上的
 * standalone PWA 连下拉刷新都没有。根节点上放一个边界，把「什么都没有了」
 * 换成「这里坏了，出口在这」。
 *
 * 兜底页刻意不碰任何运行期上下文：i18n、主题 provider、CSS 文件都可能是坏
 * 掉的那一环，所以文案与样式全部写死在这里，只由最朴素的元素组成。
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 日志文件之外的唯一线索：手机上没有控制台可看，把这段留在 host 的日志
    // 里，出问题的人至少能从终端里读到它。
    console.error("[webview] render failed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" data-testid="app-error-boundary" style={WRAP}>
        <p style={{ margin: 0, fontSize: 14 }}>页面出错了</p>
        <button
          type="button"
          style={BUTTON}
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
        {error.message ? <pre style={DETAIL}>{error.message}</pre> : null}
      </div>
    );
  }
}

const WRAP: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  height: "100%",
  boxSizing: "border-box",
  padding: 24,
  textAlign: "center",
  fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
  fontSize: 13,
  color: "var(--vscode-foreground, #1f1f1f)",
  background: "var(--vscode-editor-background, #ffffff)",
};

const BUTTON: React.CSSProperties = {
  padding: "6px 16px",
  border: "none",
  borderRadius: 4,
  font: "inherit",
  cursor: "pointer",
  color: "var(--vscode-button-foreground, #ffffff)",
  background: "var(--vscode-button-background, #0e639c)",
};

// 出错原文留着但不抢眼：一是它多半是压缩后的 `e.slice` 之类，二是手机上报
// 障的唯一凭据就是这一行。
const DETAIL: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: "30vh",
  margin: 0,
  overflow: "auto",
  fontFamily: "var(--vscode-editor-font-family, monospace)",
  fontSize: 11,
  lineHeight: 1.4,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  opacity: 0.6,
};
