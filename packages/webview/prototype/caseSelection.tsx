import React from "react";

/**
 * 原型预览的 mock 用例选择（dev server 与 build 产物共用，非产品功能）。
 *
 * 为什么单独成一个模块：选择结果决定「页面会不会收到宿主消息」。用例 key 记在
 * sessionStorage（`wave-preview-case`），而 sessionStorage 按 **origin + 会话**
 * 隔离——分享出去的 artifact、以及被宿主当成一个全新页面加载的 guest（desktop
 * 预览面板里的 `<webview>`）都读不到上次的选择，每次都要重走一遍回退链。
 *
 * 回退链一旦静默落到空结果（`mock/` 目录还没建、上次选的用例文件被删/改名），
 * 页面就停在「一条宿主消息都没有」的空白态：ChatApp 停在 welcome 扫光、DesktopApp
 * 停在一个纯空 div，看起来就是黑屏。所以这里的每一次回退都必须能被工具条说出来
 * （兜底选中 / 上次的用例已失效 / 未找到可用用例），选不到用例时正文还要给出一个
 * 带说明的空态——不能是一片黑。
 */

/** 默认用例：桌面端新对话（打开预览不该先看到无限扫光）。 */
export const DEFAULT_CASE_KEY = "desktop-new-chat";

/** 记住用户上次选择的 sessionStorage 键。 */
export const CASE_STORAGE_KEY = "wave-preview-case";

export interface CaseSelection {
  /** 用例 key；空串 = 没有可用用例（正文要给提示，不能只留一片黑）。 */
  key: string;
  /** 兜底选中：默认用例不存在，退到了 mock 列表里的第一个。 */
  fallback: boolean;
  /** 上次记的用例已不在 mock 列表里（文件被删/改名），已重新选。 */
  staleSelection: boolean;
}

/** `import.meta.glob("./mock/*.ts")` 的结果 → 用例 key（保持扫描顺序）。 */
export function caseKeysFromModules(
  modules: Record<string, unknown>,
): string[] {
  const prefix = "./mock/";
  const suffix = ".ts";
  return Object.keys(modules)
    .filter((path) => path.startsWith(prefix) && path.endsWith(suffix))
    .map((path) => path.slice(prefix.length, -suffix.length));
}

/**
 * 首屏选哪个用例。优先级：记住的（且文件仍在）→ 默认用例 → 列表第一个（标注为
 * 兜底）→ 空（由调用方给出「未找到可用用例」的提示）。
 *
 * `stored` 为空串表示「上次明确选了『无 mock』」——那不是一个失效的选择，按「没有
 * 记住」处理，否则每次回到页面都会误报「上次的用例已失效」。
 */
export function resolveInitialCase(
  keys: readonly string[],
  stored: string | null,
): CaseSelection {
  if (stored && keys.includes(stored)) {
    return { key: stored, fallback: false, staleSelection: false };
  }
  const staleSelection = Boolean(stored) && !keys.includes(stored as string);
  if (keys.includes(DEFAULT_CASE_KEY)) {
    return { key: DEFAULT_CASE_KEY, fallback: false, staleSelection };
  }
  const first = keys[0] ?? "";
  return { key: first, fallback: first !== "", staleSelection };
}

/** 工具条上的状态徽标：只在「这次选择另有隐情」时出现，正常记住的选择不留噪音。 */
export const SelectionBadges: React.FC<{ selection: CaseSelection }> = ({
  selection,
}) => {
  const badge: React.CSSProperties = {
    padding: "1px 6px",
    borderRadius: 4,
    border: "1px solid var(--vscode-widget-border, #555)",
    color: "var(--vscode-descriptionForeground, #8b8b8b)",
    fontSize: 11,
    whiteSpace: "nowrap",
  };
  return (
    <>
      {selection.staleSelection && (
        <span
          style={badge}
          data-testid="preview-case-stale"
          title="上次选中的用例文件已不存在（mock/ 下被删或改名），已重新选一个"
        >
          上次的用例已失效
        </span>
      )}
      {selection.fallback && (
        <span
          style={badge}
          data-testid="preview-case-fallback"
          title={`默认用例 ${DEFAULT_CASE_KEY} 不存在，已兜底选中 mock 列表里的第一个`}
        >
          兜底选中
        </span>
      )}
      {!selection.key && (
        <span
          style={{ ...badge, color: "var(--vscode-errorForeground, #f48771)" }}
          data-testid="preview-case-missing"
          title="mock/ 目录下没有任何用例文件，页面收不到宿主消息"
        >
          未找到可用用例
        </span>
      )}
    </>
  );
};

/**
 * 正文空态：一个用例都没加载到时替换掉应用外壳。原来这里什么都不显示，用户看到
 * 的是一片黑（深色主题下连 loading 都几乎看不见），根本猜不到是 mock 目录空。
 */
export const NoCaseNotice: React.FC = () => (
  <div
    data-testid="preview-no-case"
    style={{
      flex: 1,
      height: "100vh",
      boxSizing: "border-box",
      overflow: "auto",
      padding: 32,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      alignItems: "flex-start",
      justifyContent: "center",
      background: "var(--vscode-editor-background, #1e1e1e)",
      color: "var(--vscode-foreground, #cccccc)",
      font: "13px/1.6 -apple-system, 'Segoe UI', sans-serif",
    }}
  >
    <strong style={{ fontSize: 15 }}>未找到可用用例</strong>
    <div>
      `mock/` 目录下没有任何 mock 用例文件，页面收不到任何宿主消息，
      所以正文是空的（不是渲染坏了）。
    </div>
    <div>
      新建
      <code
        style={{
          margin: "0 4px",
          padding: "1px 5px",
          borderRadius: 3,
          background:
            "var(--vscode-textCodeBlock-background, rgba(128,128,128,.17))",
        }}
      >
        packages/webview/prototype/mock/&lt;用例名&gt;.ts
      </code>
      保存后页面会自动重载，用例随即出现在上方工具条的下拉里。
    </div>
    <div style={{ color: "var(--vscode-descriptionForeground, #8b8b8b)" }}>
      用例结构见 prototype/types.d.ts（name / host / messages / responders）。
    </div>
  </div>
);
