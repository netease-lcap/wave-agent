/**
 * Plugin MODS —— mod 与宿主之间的数据契约（spec `ecosystem/plugin-mods.md`）。
 *
 * 这个文件是四端共用契约的**唯一真源**：SDK 侧编译器/沙箱产出它，stdio RPC
 * 用它序列化，webview 侧 `ModPanelRenderer` 消费它。webview 只能从
 * `wave-agent-sdk/types` 拿到这些类型（浏览器 bundle 需要 node-free 入口），
 * 所以这里不许 import 任何 node 模块。
 */

/** 一期支持的元素。新增一个要同时改 runtime 的工厂与 webview 的渲染器。 */
export const MOD_ELEMENT_TYPES = [
  "Box",
  "Text",
  "Button",
  "Input",
  "Link",
  "Code",
  "Markdown",
] as const;

export type ModElementType = (typeof MOD_ELEMENT_TYPES)[number];

/**
 * 能过 RPC 的 prop 值。
 *
 * 刻意不含函数与 Symbol：`onPress` / `onSubmit` 这类回调在 mod 进程内就被
 * `h()` 摘走、存进该 mod 自己的处理表，树上只留 `key` 作为回传标识。
 */
export type ModPropValue = string | number | boolean | null;

/** 元素树节点，已经过形状校验与限额检查。 */
export interface ModTreeNode {
  type: ModElementType;
  props: Record<string, ModPropValue>;
  /** 子节点；字符串是文本节点。 */
  children: Array<ModTreeNode | string>;
}

/** 面板内容：一棵树，或者 render 失败时的错误摘要。 */
export type ModPanelTree = ModTreeNode | string;

/**
 * 一条面板**元信息**（不带树）。
 *
 * 树永远由 surface 拉取（spec「架构约束」）：宿主只告诉渲染端这个 pane
 * 存在 / 过期 / 关掉了，surface 收到后自己发 `modPanelRender` 要树。
 */
export interface ModPanelUpdatePayload {
  /** 会话 id（信封里也有，这里留一份便于宿主直接转发给 webview）。 */
  sessionId: string;
  /** `<pluginName>:<fileStem>`，与 `PluginMod.id` 一致。 */
  modId: string;
  /** mod 自己起的面板 id（同一 mod 可开多个面板）。 */
  paneId: string;
  title: string;
  /** 单调递增；surface 丢弃比已显示版本更旧的回复。 */
  revision: number;
  /** 树已过期，surface 应对这个 pane 发一次 `modPanelRender`。 */
  stale?: boolean;
  /** 面板被关掉时宿主发这一条，`closed: true`。 */
  closed?: boolean;
  /** 失败原因（编译失败 / 校验超限 / 钩子异常）。surface 画错误条，树保留。 */
  error?: string;
}

/** `modPanelRender` 的回复：surface 要的那棵树。 */
export interface ModPanelRenderResult {
  modId: string;
  paneId: string;
  /** 每次成功渲染递增。 */
  revision: number;
  /**
   * 渲染失败时这里是**上一帧成功的树**（可能为 `null`），错误摘要放 `error` ——
   * 把整棵树换成一行错误文字会让面板一次性报废。
   */
  tree: ModPanelTree | null;
  error?: string;
}

/** webview → 宿主 → mod 的用户交互。 */
export interface ModPanelEventPayload {
  sessionId: string;
  modId: string;
  paneId: string;
  /** 触发交互的元素 `key`（`Button` / `Input` 必填；`close` 时为空串）。 */
  key: string;
  /** `close` 是用户关掉了面板 tab（mod 的 `ui.close` 钩子据此收到通知）。 */
  kind: "press" | "input" | "close";
  /** `kind === "input"` 时是用户提交的字符串。 */
  value?: string;
  /** `kind === "close"` 时是谁关的（诊断用；mod 收不到关闭通知，见 spec「事件」）。 */
  origin?: "person" | "plugin" | "unload";
}

/** 一个已加载的 mod（`<pluginRoot>/mods/*.tsx|*.js`）。 */
export interface PluginMod {
  /** `<pluginName>:<fileStem>`。 */
  id: string;
  /** 文件 stem，展示用。 */
  name: string;
  /** 绝对路径，位于插件目录内（realpath 校验过）。 */
  path: string;
  pluginRoot: string;
}

/** 限额（spec「限额」表）。宿主与编译器共用同一份数字。 */
export const MOD_LIMITS = {
  /** 单个 mod 文件。 */
  fileBytes: 1024 * 1024,
  /** 一个插件所有 mod 文件总量。 */
  totalBytes: 4 * 1024 * 1024,
  /** 一个插件的 mod 文件数。 */
  fileCount: 64,
  /** 元素树节点数。 */
  treeNodes: 2000,
  /** 元素树深度。 */
  treeDepth: 24,
  /** 树内文本总量（字符）。 */
  treeTextChars: 100_000,
  /** `Link.href` 长度。 */
  hrefChars: 2048,
  /** 单个 hook 执行时间。 */
  hookTimeoutMs: 5_000,
  /** 同一面板两次刷新的最小间隔。 */
  invalidateIntervalMs: 100,
  /** `$.clock` 的最小间隔；更小的值夹到这个数（spec「定时器」）。 */
  timerMinIntervalMs: 200,
  /** 一个 mod 同时活跃的定时器数；超出时新建报错。 */
  maxTimersPerMod: 16,
} as const;
