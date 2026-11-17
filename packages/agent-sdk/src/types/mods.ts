/**
 * Plugin MODS —— mod 与宿主之间的数据契约（spec `ecosystem/plugin-mods.md`）。
 *
 * 这个文件是四端共用契约的**唯一真源**：SDK 侧编译器/沙箱产出它，stdio RPC
 * 用它序列化，webview 侧 `ModPanelRenderer` 消费它。webview 只能从
 * `wave-agent-sdk/types` 拿到这些类型（浏览器 bundle 需要 node-free 入口），
 * 所以这里不许 import 任何 node 模块。
 */

// 影子事件 `classic.StopFailure` 的 `kind` 就是我们遥测那张错误分类闭集。纯类型
// import，编译后不留下任何依赖。
import type { ErrorCategory } from "../telemetry/errorCategory.js";

/**
 * 支持的元素。新增一个要同时改 runtime 的工厂与各端的渲染器。
 *
 * 这张是**并集**：桌面端全有；终端少 `Svg`（没有矢量画布），见
 * {@link MOD_SURFACE_ELEMENTS} 与 spec「元素表按端分」。与 Claude Code 的四张表
 * 相比只少 `Client` / `Shader` / `Raster` / `Image` 四件（都要在渲染端执行 mod
 * 附带的第二份模块或画位图，spec「交付分层」没做）。
 */
export const MOD_ELEMENT_TYPES = [
  "Box",
  "Text",
  "Button",
  "Input",
  "Select",
  "Svg",
  "Link",
  "Code",
  "Markdown",
  "Progress",
] as const;

export type ModElementType = (typeof MOD_ELEMENT_TYPES)[number];

/** `Select` 的一项。`value` 在同一棵树里必须唯一，`label` 缺省时画 `value`。 */
export interface ModSelectOption {
  value: string;
  label?: string;
}

/**
 * 能过 RPC 的 prop 值。
 *
 * 刻意不含函数与 Symbol：`onPress` / `onSubmit` / `onSelect` 这类回调在 mod
 * 进程内就被 `h()` 摘走、存进该 mod 自己的处理表，树上只留 `key` 作为回传标识。
 *
 * 只有 `Select.options` 用得上数组：其余元素的 prop 仍然是原始值，校验器按元素
 * 区分（spec「元素」）。`hover` 的值是对象，所以它根本不走 props —— 见
 * {@link ModTreeNode.hover}。
 */
export type ModPropValue =
  | string
  | number
  | boolean
  | null
  | readonly ModSelectOption[];

/**
 * 悬停态（spec「元素」的 `hover`）。
 *
 * 它是节点的**独立字段**，不在 `props` 里：值是对象，而 props 只收原始值。
 * key 集按元素区分（`Box` 一套、`Text` / `Button` 一套），由校验器按名字把关。
 *
 * 生效范围是「指针落在最近的带 `key` 的 `Box` 里」；`scope` 给字符串时加入
 * 那个同名的 scope，用来让画在行外的卡片跟着行内元素一起亮。
 */
export type ModHoverProps = Record<string, string | number | boolean>;

/** 元素树节点，已经过形状校验与限额检查。 */
export interface ModTreeNode {
  type: ModElementType;
  props: Record<string, ModPropValue>;
  /** 悬停态；缺省就是这一帧不随指针变化（spec「元素」）。 */
  hover?: ModHoverProps;
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
  /**
   * `$.ui.open({ focus: true })` 打开的这一帧：surface 应把键盘直接送进面板。
   *
   * 只在打开（或再打开）的那一条推送里为 `true`，之后的重绘都不带 —— 否则 mod
   * 每 `invalidate` 一次就会把用户正在输入框里打的字抢走。终端用得上它，桌面端
   * 忽略（它的 tab 本来就是激活态，spec「面板的归属」）。
   */
  focus?: boolean;
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

/**
 * surface 量到的**版面事实**（spec「`ui.render` 的 `e.props`」）。
 *
 * 这些只有画它的那一端知道，所以跟着 `modPanelRender` / `modBandRender` 请求上来，
 * 再原样进 `ui.render` 事件的 `e.viewport` 与 `e.props`。字段名与 Claude Code 同形，
 * 没量到的字段**不带**（缺省由引擎补，见 {@link MOD_RENDER_BODY_COLUMNS}）—— 报一个
 * 假的 `false` / 0 比不报更坏，mod 会把猜测当成测量结果。
 */
export interface ModSurfaceMetrics {
  /** 这一端画布的字符宽（`e.viewport.columns`）。 */
  columns?: number;
  /** 这一端画布的字符高（`e.viewport.rows`）。 */
  rows?: number;
  /**
   * 这块面板自己的字符宽（`e.props.bodyColumns`）。dock 时是右侧那一列、inline 与
   * 带时是输入区那一列 —— 与 `columns` 不是一个数，mod 靠这个差换排布。
   */
  bodyColumns?: number;
  /** 这一端是不是占满视口（IDE 聊天面板是，桌面端分屏不是）。 */
  isFullscreen?: boolean;
}

/**
 * surface 在要 `Pane` 这一帧时顺带说明的**摆法**（spec「在 IDE 插件里画」）。
 *
 * 摆法与版面事实分开说：摆法只有两种（宽面板 dock 在对话右侧、窄面板落到输入框
 * 上方），量到的宽高跟着 {@link ModSurfaceMetrics} 一起上来。
 */
export interface ModPaneLayout extends ModSurfaceMetrics {
  /** `dock`：摆在对话右侧；`inline`：摆在输入框上方。缺省 `dock`。 */
  placement?: "dock" | "inline";
}

/**
 * 输入框上方那条带的渲染结果（spec「状态带、状态行与提示」）。
 *
 * 一个 mod 一条带；没有注册 `ui.render`、或钩子返回 `undefined` 的 mod 不出现在
 * 结果里（不占位置）。`ui.render` 事件里的 `requestId` 固定是
 * {@link MOD_BAND_INSTANCE_ID}。
 */
export interface ModBandRenderResult {
  modId: string;
  /** 插件注册名，界面按它署名与排序。 */
  plugin: string;
  /** 每次成功渲染递增；surface 丢弃比已显示版本更旧的回复。 */
  revision: number;
  /** 空树表示这条带这次没有内容，surface 不占位置。 */
  tree: ModPanelTree | null;
  /** 渲染失败；`tree` 是上一帧成功的树（可能为 null）。 */
  error?: string;
}

/** `AbovePrompt` 站点的 `requestId`（spec「状态带、状态行与提示」）。 */
export const MOD_BAND_INSTANCE_ID = "above-prompt";

/**
 * `ui.render` 事件里 `props.bodyColumns` 的**缺省值**。
 *
 * surface 会在请求树时报量到的宽度（{@link ModSurfaceMetrics.bodyColumns}），这是
 * 「它还没量到」时的兜底：给一个中性的默认值总比给 `undefined` 好 —— 后者会让
 * `e.props.bodyColumns >= 110` 恒假，宽窗口上也永远画窄版。
 */
export const MOD_RENDER_BODY_COLUMNS = 100;

/**
 * `ui.render` 的 `Pane` 站点：一次最多画多少行（`props.maxRows` 与
 * `props.scroll.bodyRows`）的**缺省值**。
 *
 * surface 报来画布行数时按它算（{@link ModSurfaceMetrics.rows}），这是兜底：面板
 * 真实高度随窗口与用户拖动变。给一组上限值（面板 24、带 8）能让分页的 mod 一开始
 * 就不溢出：面板更高时留白，更矮时由面板自己滚。
 */
export const MOD_RENDER_PANE_ROWS = 24;

/** `AbovePrompt` / `AbovePromptList` 站点的行数缺省值（见 {@link MOD_RENDER_PANE_ROWS}）。 */
export const MOD_RENDER_BAND_ROWS = 8;

/**
 * 面板落到输入框上方（`placement: "inline"`）时正文的行数上限。
 *
 * 12 是 Claude Code 扩展里的那个数（官方文档「Draw in the VS Code extension」：
 * 面板窄于 800 像素时面板落到输入框上方，「a pane shows 12 rows before it
 * scrolls」；宽于 800 像素则 dock 在右侧、`isFullscreen` 为 `true`）。再高就把
 * 输入框挤出视口。`e.props.maxRows` 与 `e.props.scroll.bodyRows` 都用它 —— mod
 * 按它分页才不会画到可视区外面。
 */
export const MOD_RENDER_INLINE_ROWS = 12;

/** `$.ui.status(text)` 的推送：每个插件一条常驻行，`text: null` 表示清除。 */
export interface ModStatusPayload {
  sessionId: string;
  modId: string;
  /** 插件注册名：用户要能看出是谁贴的。 */
  plugin: string;
  text: string | null;
}

/** `$.ui.toast(text)` 的推送：短暂提示，`timeoutMs` 已夹进限额。 */
export interface ModToastPayload {
  sessionId: string;
  modId: string;
  plugin: string;
  text: string;
  timeoutMs: number;
}

/** webview → 宿主 → mod 的用户交互。 */
export interface ModPanelEventPayload {
  sessionId: string;
  modId: string;
  paneId: string;
  /** 触发交互的元素 `key`（`Button` / `Input` / `Select` 必填；`close` 时为空串）。 */
  key: string;
  /** `close` 是用户关掉了面板 tab（mod 的 `ui.close` 钩子据此收到通知）。 */
  kind: "press" | "input" | "select" | "close";
  /** `kind === "input"` 时是用户提交的字符串。 */
  value?: string;
  /** `kind === "close"` 时是谁关的（诊断用；mod 收不到关闭通知，见 spec「事件」）。 */
  origin?: "person" | "plugin" | "unload";
}

/**
 * `ui.press` / `ui.input` / `ui.select` 的载荷（spec「控件的交互事件」）。
 *
 * 字段名与 Claude Code 的 `UiPressArgument` / `UiInputArgument` /
 * `UiSelectArgument` 一致：`plugin`（谁画的）、`component`（画在哪个站点）、
 * `requestId`（哪个实例，也就是 paneId）、`surface`（哪一端）、`element`（控件的
 * `key`），`ui.input` / `ui.select` 另有 `value`。钩子在控件自己的 `onPress` /
 * `onSubmit` / `onSelect` **之前**跑。
 */
export interface ModUiControlEvent {
  /** 画这个控件的 mod 的注册名 —— matcher 钉的就是它。 */
  plugin: string;
  /** 画这个控件的站点：右侧面板，或输入框上方那条带。 */
  component: "Pane" | "AbovePrompt";
  /**
   * 这块面板的实例 id：pane id，输入框上方那条带是 `above-prompt`。
   *
   * 与 `ui.render` 的 `requestId` 是同一个值，钩子按它区分「哪个面板的控件」。
   */
  requestId: string;
  /** 哪一端画的（决定 `$.ui.resolve(e)` 给哪张元素表）。 */
  surface: ModRenderSurface;
  /** 控件的 `key`。 */
  element: string;
  /** 我们的 `Input` 只有提交一条通道（没有逐次编辑），恒为 `"submit"`。 */
  kind?: "submit";
  /** `ui.input` / `ui.select` 上用户给的值。 */
  value?: string;
}

/**
 * 三个控件事件的返回值：改写这次交互派给谁、带什么值（spec「控件的交互事
 * 件」）。
 *
 * 只对**这一次**生效，不落进元素树：下一帧画什么仍由 `ui.render` 决定。
 */
export interface ModUiControlResult {
  /** 换派给哪个控件；那个 pane 里没有对应回调时按「没人接」丢掉并记 debug。 */
  element?: string;
  /** 换控件回调收到的值；必须是字符串，否则这一项被丢掉并 warn。 */
  value?: string;
}

/**
 * `$.prompt.fill` 把文本放在哪（spec「把草稿填进输入框」）。
 *
 * 三档都是 Claude Code 的原名：`replace` 替掉整份草稿、`append` 接在后面、
 * `insert` 插在光标处。
 */
export type ModPromptFillMode = "replace" | "append" | "insert";

/**
 * 能画 mod 树的一端（spec「会话事实」的 `$.session.surfaces()`）。
 *
 * 四个名字照 Claude Code 的 `RenderSurface` 取，`$.ui.resolve(e)` 也按它选
 * 元素表。一期两端真的会画：桌面端与前端的终端 CLI；VS Code / JetBrains 都不画，
 * 所以它们此刻**不在**数组里（`[]` 就是「没有界面」）。
 */
export type ModRenderSurface = "terminal" | "desktop" | "vscode" | "mobile";

/**
 * 各端能画的元素名（spec「元素表按端分」）。
 *
 * 桌面端 10 个；终端 9 个 —— 只少 `Svg`（终端没有矢量画布）。`Progress` 两端都
 * 有，与 Claude Code 四端一致。`$.ui.resolve(e)` 按 `e.surface` 取这里的名单造表，
 * `validateModTree` 按同一份名单拒绝画不出的名字 —— 两处必须是同一个数据源，
 * 否则 mod 拿得到构造器、树却在渲染时被拒。
 */
export const MOD_SURFACE_ELEMENTS: Record<
  Extract<ModRenderSurface, "terminal" | "desktop" | "vscode">,
  readonly ModElementType[]
> = {
  desktop: MOD_ELEMENT_TYPES,
  // IDE 画的是同一份 webview，元素集与桌面端一致（有 `Svg`）。
  vscode: MOD_ELEMENT_TYPES,
  terminal: MOD_ELEMENT_TYPES.filter((name) => name !== "Svg"),
};

/**
 * `$.ui.open()` 的结果（spec「面板放得下吗」）。
 *
 * `isPlaced: false` 时 `reason` 说明为什么没画：没有能画面板的表面（以
 * `no-surface` 开头，与 Claude Code 同一个词）、会话正在销毁。守卫类插件据此
 * 决定要不要把命令冻在等人按键上。
 */
export type ModUiOpenResult =
  | { isPlaced: true }
  | { isPlaced: false; reason: string };

/**
 * `$.config.list()` 的一行（spec「配了哪些、能调什么、有谁在跑」）。
 *
 * 形状照 Claude Code 的 `ConfigRow`：`key` 是行名，`kind` 说这一行的值怎么
 * 取，`value` 是值本体，`isLocked` 表示它被托管层钉住（显示但拒绝改）。我们
 * 只列**真有值的键**，不把默认值铺出来 —— 社区的读法是
 * `find(row => row.key === "theme")`，没写过要给 `undefined`。
 */
export type ModConfigKind = "boolean" | "choice" | "text" | "number";

/** 一行配置的值；`choice` 的候选另放 `options`。 */
export type ModConfigValue = boolean | string | number | readonly string[];

/** 谁拥有这一行：引擎自己的行 `plugin` 是 `"engine"`。 */
export interface ModConfigProvider {
  plugin: string;
  tier: string;
}

export interface ModConfigRow {
  key: string;
  label: string;
  description?: string;
  kind: ModConfigKind;
  value: ModConfigValue;
  options?: readonly string[];
  provider: ModConfigProvider;
  isLocked: boolean;
}

/** `$.tool.list()` 的一项：`mcp` 为真表示这是 MCP server 的工具。 */
export interface ModToolInfo {
  name: string;
  description: string;
  mcp: boolean;
}

/** `$.agent.list()` 里的状态，照 Claude Code 的 `AgentStatus` 取。 */
export type ModAgentStatus =
  | "pending"
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "killed";

/** `$.agent.list()` 的一项：一条会话里派过的一个子代理。 */
export interface ModAgentInfo {
  id: string;
  description: string;
  type: string;
  status: ModAgentStatus;
  parentAgentId?: string;
  /** 派它的插件名（mod 自己派的那种才有）。 */
  plugin?: string;
}

/**
 * `$.model.complete` 的结果（spec「让模型替插件答一次」）。
 *
 * 形状照 Claude Code 的三档：`api-error` 带状态码与错误分类、`empty-reply` 是
 * 「模型回了但没有文本块」、`aborted` 是「这次调用被切掉了」。**我们自己的门槛
 * 不在这里** —— 模型不在 allowlist、额度用完都是当场 reject，因为那两件事意味
 * 着这次请求根本没发出去。
 *
 * `usage` 每一档都带，字段与 `turn.complete` 的同一套（含 CC 别名）。
 */
export type ModModelCompleteResult =
  | {
      isAnswered: true;
      /** 回复的正文（文本块拼起来）。 */
      text: string;
      usage: ModTokenTotals & ModCommunityTokenTotals;
    }
  | {
      isAnswered: false;
      reason: "api-error";
      /** HTTP 状态；拿不到响应（连接断了、provider 超时）时是 `null`。 */
      status: number | null;
      /** provider 的错误原文（插件日志/界面上要能显示「为什么没答」）。 */
      error: string;
      usage: ModTokenTotals & ModCommunityTokenTotals;
    }
  | {
      isAnswered: false;
      reason: "empty-reply";
      usage: ModTokenTotals & ModCommunityTokenTotals;
    }
  | {
      isAnswered: false;
      reason: "aborted";
      usage: ModTokenTotals & ModCommunityTokenTotals;
    };

/**
 * `prompt.suggest` / `prompt.edit` 两处共用的「谁发起的」
 * （spec「输入框里的建议」）。
 *
 * 两个事件各认其中几个分支，`next(e)` 把它原样传下去：哪个分支由引擎在起点盖
 * 章，钩子改不动。
 */
export type ModPromptOrigin =
  | { kind: "composer" }
  | { kind: "suggestion" }
  | { kind: "plugin"; name: string };

/** `prompt.suggest` 的 `e`（spec「输入框里的建议」）。 */
export interface ModPromptSuggestEvent {
  /** 这次要摆上去的建议（改写它靠 `next({ ...e, text })`）。 */
  text: string;
  origin: ModPromptOrigin;
  [key: string]: unknown;
}

/** `prompt.edit` 的 `e`（spec「输入框里的建议」）。 */
export interface ModPromptEditEvent {
  origin: ModPromptOrigin;
  /** 触发这次编辑的那一个按键；粘贴、折起来的一串键没有它。 */
  key?: unknown;
  /** 编辑之前的草稿。 */
  text: string;
  /** 编辑之前光标在哪。 */
  cursor: number;
  /** 被替换的那一段从哪开始。 */
  start: number;
  /** 被替换的那一段到哪结束（插入时为 `start`）。 */
  end: number;
  /** 中间放进去的字（删除时为 `""`）。 */
  inputText: string;
  [key: string]: unknown;
}

/**
 * `$.tool.register()` 的参数（spec「把我们自己的工具交给模型」）。
 *
 * 这里**没有 handler**：执行体是同一个 mod 的另一条 `tool.call` 钩子 ——
 * 与 Claude Code 的 `ToolSpec` 同一个形状，社区插件不用为「写工具」再学一套 API。
 */
export interface ModToolRegisterSpec {
  /** 只能 `[a-zA-Z0-9_-]{1,64}`；模型看到的是 `mcp__<plugin>__<name>`。 */
  name: string;
  /** 模型看到的那段，必填非空，≤ 2000 字符。 */
  description: string;
  /** JSON Schema 对象（缺省 `{ type: "object" }`），序列化后 ≤ 16 KiB。 */
  inputSchema?: Record<string, unknown>;
}

/** `$.session.repo()`：会话所在的 git 仓库；不在仓库里时给 `null`。 */
export interface ModSessionRepo {
  /** 仓库根，绝对路径（在 worktree 里跑也给主工作树的）。 */
  root: string;
  /** `origin` 的 URL；没有 remote 就是 `null`。 */
  remote: string | null;
  /** 是不是「我们自己的」仓库。我们不分公有/内部，恒 `false`。 */
  internal: boolean;
  /** 匹配到的仓库名 `owner/name`；`internal` 为假时是 `null`。 */
  name: string | null;
}

/** `$.session.version()`：引擎版本、它的发布基线、构建时间。 */
export interface ModSessionVersion {
  version: string;
  base?: string;
  builtAt?: string;
}

/** `$.prompt.read()`：输入框里的草稿，`cursor` 是 UTF-16 偏移。 */
export interface ModPromptBox {
  text: string;
  cursor: number;
}

/** `$.fs.ancestors()` 里一项的组成部分；一期只有文件自己。 */
export interface ModFsAncestorPart {
  path: string;
  content: string;
}

/** `$.fs.ancestors()` 的一项：一个目录里的一个指令文件。 */
export interface ModFsAncestor {
  dir: string;
  name: string;
  content: string;
  parts: readonly ModFsAncestorPart[];
}

/** `$.ui.copy()` 的结果，照 Claude Code 的 `UiCopyResult`。 */
export type ModUiCopyResult =
  | { isCopied: true }
  | { isCopied: false; reason: "no-surface" | "no-clipboard" | "refused" };

/** `$.ui.view()` 的结果：`{}` 表示视图已切过去，`{ deny }` 说明为什么没动。 */
export interface ModUiViewResult {
  deny?: string;
}

/**
 * `$.prompt.suggest()` 送达 surface 的一次请求（spec「输入框里的建议与焦点」）。
 *
 * 与 `fill` / `read` 同一条「推出去、等回执」的通道：摆不摆得上只有输入框知
 * 道（它可能正忙、可能没挂上），所以答案走 `resolveModPromptSuggest` 回来。
 */
export interface ModPromptSuggestRequest {
  sessionId: string;
  requestId: string;
  /** 要摆上去的那条（`prompt.suggest` 链改写过的就是改写后的版本）。 */
  text: string;
  /** 谁提的（`e.origin`）；引擎自己的推荐不走这条通道。 */
  plugin: string;
}

/** `$.prompt.read()` 送达 surface 的一次请求（与 `ModPromptFillRequest` 配对）。 */
export interface ModPromptReadRequest {
  sessionId: string;
  requestId: string;
}

/** surface 对 `ModPromptReadRequest` 的回执。 */
export interface ModPromptReadResult {
  sessionId: string;
  requestId: string;
  text: string;
  cursor: number;
}

/** `$.ui.copy()` 送达 surface 的一次请求。 */
export interface ModCopyRequest {
  sessionId: string;
  requestId: string;
  text: string;
  surface?: ModRenderSurface;
}

/** surface 对 `ModCopyRequest` 的回执。 */
export interface ModCopyResult {
  sessionId: string;
  requestId: string;
  isCopied: boolean;
  reason?: string;
}

/** `$.ui.notice` 推给 surface 的一行（`text: null` 表示撤掉）。 */
export interface ModNoticePayload {
  sessionId: string;
  plugin: string;
  toolUseId: string;
  text: string | null;
}

/**
 * `$.prompt.fill` 送达 surface 的一次请求（spec「把草稿填进输入框」）。
 *
 * 这是宿主里唯一一条「mod 提问、界面作答」的通道：CLI 发下去，surface 填完
 * 输入框后带着 `requestId` 回执（`modPromptFillResult`）。`requestId` 只用于
 * 配对，不进 mod 的视野 —— mod 拿到的是 `{ isFilled }`。
 */
export interface ModPromptFillRequest {
  sessionId: string;
  requestId: string;
  text: string;
  mode: ModPromptFillMode;
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

/**
 * `$.process.spawn` 的参数（spec「外部进程」）。
 *
 * `cwd` 的缺省值是会话**当前**的工作目录，与 Bash 工具的 spawn cwd 同一条
 * 口径（容器 token `CurrentWorkdir`，会随 `cd` 动）—— 不是会话起点，也不是
 * 工作区根：`cd` 进子目录之后起的脚本该落在新目录里。
 */
export interface ModSpawnOptions {
  /** 参数数组，**不走 shell**；要 shell 就显式写 `["bash", "-lc", cmd]`。 */
  argv: string[];
  /** 缺省用会话当前工作目录。 */
  cwd?: string;
  /** 与宿主环境取并集，显式给的值覆盖。 */
  env?: Record<string, string>;
  /** 一次性写入 stdin 后关闭；不支持长连 stdin。 */
  input?: string;
}

/** 外部进程的一块输出。 */
export interface ModProcessChunk {
  stream: "stdout" | "stderr";
  text: string;
}

/**
 * 外部进程正常结束时，异步迭代的返回值。
 *
 * `for await` 拿不到它（语言限制），要看退出码就手动驱动迭代器；用 `for await`
 * 的写法通常只关心输出块。
 */
export interface ModProcessExit {
  code: number | null;
  signal: string | null;
}

/**
 * `$.process.run` 的参数（spec「外部进程」）。
 *
 * 与 `spawn` 有一处名字不齐：这里的一次性输入叫 `stdin`，`spawn` 里叫
 * `input`。这是 Claude Code 自己的不一致，照抄。
 */
export interface ModRunOptions {
  /** 缺省用会话当前工作目录（与 `spawn` 同一条口径）。 */
  cwd?: string;
  /** 与宿主环境取并集，显式给的值覆盖。 */
  env?: Record<string, string>;
  /** 一次性写入 stdin 后关闭。 */
  stdin?: string;
  /** 缺省 30 秒，超过上限夹到 10 分钟。 */
  timeoutMs?: number;
}

/** `$.process.run` 的结果：退出码非 0 也 resolve。 */
export interface ModRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  isStdoutTruncated: boolean;
  isStderrTruncated: boolean;
}

/** `$.fs.list` 的一项（不递归）。 */
export interface ModFsEntry {
  name: string;
  kind: "file" | "dir";
  size: number;
  isLink: boolean;
}

/** `$.fs.stat` 的结果。 */
export interface ModFsStat {
  kind: "file" | "dir";
  size: number;
  isLink: boolean;
}

/** `$.http.fetch` 的结果。 */
export interface ModFetchResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
  /** 响应体超过限额时 `text` 只留了前面一段。 */
  isTruncated: boolean;
}

/**
 * `$.session.usage()` 的快照（spec「会话用量」）。
 *
 * 只在 agent 进程内传（不过 RPC），字段名刻意按我们的口径写死，别拿它去对
 * Claude Code 的 `usage()`：
 *
 * - `context.percent` 的分母是**自动压缩阈值**，不是裸 `window` —— 与输入框旁
 *   那个用量环同一个算法，环画到 100% 就是压缩要发生的地方。
 * - `tokens.prompt` **含**缓存命中的 token（我们上游的 `prompt_tokens` 就是含
 *   的），对应 Claude Code 的 `input_tokens` 是**不含**的那种，两者不能互换。
 */
export interface ModSessionUsage {
  /**
   * 会话开始的时间（毫秒）。社区 mod 用它算「$/小时」这类速率
   * （burn-rate 的 `(now - startedAt)`），所以形状照 Claude Code 给。
   */
  startedAt: number;
  /** 上下文占用：`tokens` 是最近一次带 usage 的响应报出的总数。 */
  context: { tokens: number; window: number; percent: number };
  /** 整场会话累计的 token（跨轮相加，含压缩轮）。 */
  tokens: ModTokenTotals;
  /**
   * 额度窗口（我们对齐 Claude Code 的 `rateLimits` 形状，窗口名用自己的）。
   *
   * 数据来自模型响应的 `x-codechat-quota-*` 头（每次调用都带，成功与失败两条
   * 路径都有）：`weekly` / `monthly` 两个窗口，顺序固定。**没有这批头的环境
   * 就是空数组** —— 私有化部署与自定义网关不经过那层 proxy，这是真实读法
   * （「这个账号没有配额窗口可报」），不是缺陷。
   */
  rateLimits: ModRateLimitWindow[];
  /** 当前模型名；没配时是 `undefined`。 */
  model?: string;
}

/** 一个额度窗口的用量（spec「会话用量」）。 */
export interface ModRateLimitWindow {
  /**
   * 窗口名，取上游的真名：`weekly` / `monthly`。
   *
   * **不是** Claude Code 的 `five_hour` / `seven_day` —— 我们的计费窗口是自
   * 然周与滚动月，硬套 CC 的两个名字会让 `kind === "five_hour"` 的判断永远假。
   */
  kind: string;
  /** 已用百分比，0–100。 */
  percentUsed: number;
  /** 下次重置时间（毫秒）。 */
  resetsAt?: number;
}

/**
 * token 合计，口径与 `$.session.usage().tokens` 同一套字段名。
 *
 * 两处用法作用域不同：这里给的是**本轮**的合计，`$.session.usage()` 给的是**整
 * 场会话**的累计。`prompt` 均**含**缓存命中的 token（我们上游的 `prompt_tokens`
 * 就是含的），别把它当 Claude Code 的 `input_tokens`（那种不含）。
 */
export interface ModTokenTotals {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * 同一份用量的 Claude Code 别名（spec「兼容社区 mod」）。
 *
 * 社区 mod 读的是这几个 snake_case 字段，而且 `input_tokens` **不含**缓存
 * 命中 —— 与我们的 `prompt`（含）不是同一个数，直接把 `prompt` 改个名字会让
 * 它们把缓存重复算一遍。所以两套并存，换算在这里一次做完。
 */
export interface ModCommunityTokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/**
 * `turn.complete` 的载荷（spec「完成与审批的观察」）。
 *
 * 与 Claude Code 同名事件对齐的部分是 `turnId` / `isAborted` / `durationMs` /
 * `answer` / `usage`；**没有** `agentId`（我们一期只报主 agent 的轮次），也不接
 * 管返回值（CC 的 `{ text }` 会在答案下面显示一行，我们不显示）。
 */
export interface ModTurnCompleteEvent {
  /** 收尾的是哪一轮（与 `turn.start` 的 `turnId` 同一个值）。 */
  turnId: string;
  /** 这一轮是被用户中断掉的（Esc / 停止），而不是答完。 */
  isAborted: boolean;
  /** 从这一轮开始处理到结束（含 Stop 钩子重开、通知注入重开的循环）。 */
  durationMs: number;
  /** 这一轮最后一条 assistant 消息的正文；中断时可能为空串。 */
  answer: string;
  /**
   * 本轮所有模型请求的 token 合计（含工具循环里的每一次与每次重开）。
   *
   * 两套字段并存：我们自己那四个（`prompt` 含缓存），外加 Claude Code 的
   * {@link ModCommunityTokenTotals} 别名与 `model`，让社区 mod 原样能跑。
   */
  usage: ModTokenTotals & ModCommunityTokenTotals & { model?: string };
}

/**
 * 派发 `turn.complete` 时**调用方**给的载荷（`AIManager` 只算得出本轮合计）。
 *
 * Claude Code 那几个别名由 `ModManager` 补齐（它才拿得到模型名），与
 * `session.measure` 同一条做法。
 */
export type ModTurnCompleteTrigger = Omit<ModTurnCompleteEvent, "usage"> & {
  usage: ModTokenTotals;
};

/**
 * `classic.PermissionRequest` 的载荷：一次工具审批**即将**弹给用户。
 *
 * 形状刻意与 Claude Code 的 `classic.<Event>` 一致 —— 那是 `PermissionRequest`
 * 这个 settings hook 收到的 stdin JSON（snake_case，含 `transcript_path`），不是
 * 我们的 camelCase 内部事件。权限规则自动放行/拒绝、以及 `PermissionRequest`
 * 钩子直接拒掉的都不会触发，那些情况没有卡片要显示；只读，mod 返回什么都不影
 * 响审批结果。
 */
export interface ModPermissionRequestEvent {
  session_id: string;
  transcript_path: string;
  cwd: string;
  /** 与 `classic.*` 同一份公共字段（CC 的 base hook input）。 */
  permission_mode: string;
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input?: unknown;
  plan_file_path?: string;
}

/**
 * 每条 `classic.*` 镜像都带的五个字段（spec「影子事件」）。
 *
 * 这就是 Claude Code 的 `createBaseHookInput(permissionMode)`：会话 id、转录文件
 * 路径、当时的（**会动的**那个）工作目录、此刻的权限模式、以及不带前缀的事件名。
 * 五项都由 `ModManager` 统一补齐 —— 每条事件的调用点只写它自己那几个字段，公共
 * 值不会各有各的写法。
 *
 * `permission_mode` 在这里而不是某几个事件上，因为 CC 就是把它铺进**每条** hook
 * 的 stdin（`Stop`、`SessionStart`、`PostToolBatch` 都有），而社区守卫（例如
 * jr-deploy-guard）靠它判断「这一刻有没有人会被问到」。
 */
export interface ModClassicEventBase {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
}

/**
 * 派发 `classic.*` 时**调用方**给的载荷：事件自己的字段，公共四项可省。
 *
 * 省掉的那几项由 `ModManager` 补（它才拿得到会话 id 与转录路径）；调用方愿意
 * 显式给也会被原样保留。对联合类型要**逐支**做 `Omit`，否则只剩公共键。
 */
export type ModClassicTrigger<T extends ModClassicEventBase> = T extends unknown
  ? Omit<T, keyof ModClassicEventBase> & Partial<ModClassicEventBase>
  : never;

/** `classic.SessionStart`：会话开始（含 resume / compact / clear 之后）。 */
export interface ModClassicSessionStartEvent extends ModClassicEventBase {
  hook_event_name: "SessionStart";
  /** 照我们 `SessionStart` settings 钩子的四档，不是 CC 的全集。 */
  source: "startup" | "resume" | "compact" | "clear";
}

/** `classic.SessionEnd`：会话销毁前。 */
export interface ModClassicSessionEndEvent extends ModClassicEventBase {
  hook_event_name: "SessionEnd";
  /**
   * 与 CC 同名同义：`clear` 是 `/clear` 把这一场扔掉、`prompt_input_exit` 是
   * 用户退出（CC 的 `--input=exit` 那档）、`other` 是宿主要求销毁。
   */
  reason: "clear" | "prompt_input_exit" | "other";
}

/** `classic.Stop`：模型停下来、这一轮可能要收尾（答完或用户中断）。 */
export interface ModClassicStopEvent extends ModClassicEventBase {
  hook_event_name: "Stop";
  /**
   * 这一轮结束时还在跑的后台任务；没有时是 `[]`。
   *
   * 形状照 Claude Code 的 Stop stdin（`id` / `type` / `status` / `description`
   * …，与我们自己 Stop 钩子的 `backgroundTasks` 是同一份数据）。
   */
  background_tasks: ModBackgroundTask[];
  /**
   * 这一轮是不是已经因为 `additionalContext` 续过（spec「一轮收尾时的非错误
   * 反馈」）。
   *
   * 名字与语义照 Claude Code：插件的防死循环开关 —— 它要求续跑一次之后，下一
   * 次收尾就该看见 `true` 并收手。首次收尾恒为 `false`。
   */
  stop_hook_active: boolean;
  /**
   * 这一轮最后一条 assistant 消息的正文（CC 的 `last_assistant_message`）。
   *
   * 给它是为了省掉「插件自己去读转录、自己解 JSONL」那一步 —— 社区插件里有几
   * 个就是这么用的。中断的一轮可能没有答案，那时不给这个字段。
   */
  last_assistant_message?: string;
}

/**
 * `classic.Stop` 的返回值：这一轮别急着收尾，把这几句话读给模型听（spec
 * 「一轮收尾时的非错误反馈」）。
 *
 * 只认 `additionalContext`；`{ decision: "block", reason }` 与
 * `preventContinuation` 是 Claude Code 另外两条通道，我们不支持（返回了只记一条
 * warn 并忽略）。
 */
export interface ModStopHookResult {
  /** 字符串数组；多项按加载顺序拍平、拼成一条消息，空串丢掉。 */
  additionalContext?: string[];
}

/** 影子事件 `classic.Stop` 里的一个后台任务。 */
export interface ModBackgroundTask {
  id: string;
  type: "shell" | "subagent" | "workflow";
  status: string;
  description: string;
  command?: string;
  agent_type?: string;
  name?: string;
}

/** `classic.StopFailure`：一轮**因错误**结束。 */
export interface ModClassicStopFailureEvent extends ModClassicEventBase {
  hook_event_name: "StopFailure";
  error: {
    /** 我们自己的错误分类（`ErrorCategory` 那个闭集）。 */
    kind: ErrorCategory;
    message: string;
  };
}

/** `classic.UserPromptSubmit`：用户提交一条 prompt。 */
export interface ModClassicUserPromptSubmitEvent extends ModClassicEventBase {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

/**
 * `classic.Notification`：宿主给用户弹出一条「要你动手」的东西。
 *
 * 只在审批卡片弹出时发，`notification_type` 取 Claude Code 那张取值表里的
 * `permission_prompt`。`$.ui.ask` 的提问卡片**不**发：CC 对提问不发通知，编一个
 * 表外的名字（`question`）只会让按 `permission_prompt` / `idle_prompt` 过滤的
 * 插件永远不触发 —— done-waiting-ping 就是这样被静默跳过的。
 */
export interface ModClassicNotificationEvent extends ModClassicEventBase {
  hook_event_name: "Notification";
  /** 照 CC 的取值表：我们只会给 `permission_prompt`。 */
  notification_type: "permission_prompt";
  message: string;
}

/** `classic.InstructionsLoaded`：一份指令文件被注入上下文。 */
export interface ModClassicInstructionsLoadedEvent extends ModClassicEventBase {
  hook_event_name: "InstructionsLoaded";
  file_path: string;
  /**
   * 这份文件属于哪一档记忆（CC 的 `memory_type`）。
   *
   * 我们的对应：`<workdir>/AGENTS.md`（回退 `CLAUDE.md`）与子树里那份 →
   * `Project`；`<workdir>/AGENTS.local.md` → `Local`；`~/.wave/AGENTS.md` →
   * `User`。`Managed` 给不出：我们没有企业托管设置层。
   */
  memory_type: "Project" | "Local" | "User";
  /**
   * 为什么读它。名字照 CC：开局常驻的几份是 `session_start`，模型读到子树里的
   * 文件之后沿目录链注入的那份是 `nested_traversal`（我们曾经自造成
   * `nested_read`，按真名字过滤的插件于是永不触发）。
   */
  load_reason: "session_start" | "nested_traversal";
}

/** `classic.PostModelSwitch`：会话的模型被换掉。 */
export interface ModClassicPostModelSwitchEvent extends ModClassicEventBase {
  hook_event_name: "PostModelSwitch";
  /** 换之前生效的模型名。 */
  from_model: string;
  /** 换之后生效的模型名（曾经叫 `model`，CC 那两个名字才是插件读的）。 */
  to_model: string;
  /**
   * 换之前那一刻的上下文估值：下一次请求要重发的量，与
   * `$.session.usage().context.tokens` 同一处解析。
   */
  context_tokens: number;
  /** 恒为 `null`：我们不做提示词缓存的 TTL 记账（给假数字更坏）。 */
  cache_ttl: null;
}

/** `classic.SubagentStart`：一个子代理起来（CC 这一条只有这两个字段）。 */
export interface ModClassicSubagentStartEvent extends ModClassicEventBase {
  hook_event_name: "SubagentStart";
  agent_id: string;
  agent_type: string;
}

/** `classic.SubagentStop`：一个子代理结束（完成 / 出错 / 中止 / 用户停掉）。 */
export interface ModClassicSubagentStopEvent extends ModClassicEventBase {
  hook_event_name: "SubagentStop";
  agent_id: string;
  agent_type: string;
  /**
   * 恒 `false`：这条事件在我们这里没有续跑通道（`additionalContext` 不收），
   * 字段照 CC 给，是为了让读它的插件拿到一个布尔值而不是 `undefined`。
   */
  stop_hook_active: false;
  /** 子代理停下来之前最后一条 assistant 消息的正文（插件不必去解转录）。 */
  last_assistant_message?: string;
  /**
   * 子代理自己的日志文件：只有跑在后台、宿主为它开了日志流的子代理才给。
   *
   * 不是 JSONL 转录（我们还没有子代理级的转录文件），CC 那边这一格是转录。
   */
  agent_transcript_path?: string;
}

/** `classic.PostToolUse` / `classic.PostToolUseFailure`：一次工具调用的收尾。 */
export interface ModClassicToolUseEvent extends ModClassicEventBase {
  hook_event_name: "PostToolUse" | "PostToolUseFailure";
  tool_name: string;
  tool_input: unknown;
  /** 模型消息里那次调用的 id（`$.ui.notice` 也认它）。 */
  tool_use_id: string;
  /** 这次执行花了多久（从进工具到它返回，含内部的权限判定与钩子）。 */
  duration_ms?: number;
  /** 只有 `PostToolUse` 有：那次工具的结果文本（按限额截断）。 */
  tool_response?: string;
  /** 只有 `PostToolUseFailure` 有：失败正文。 */
  error?: string;
}

/** `classic.PostToolBatch`：一批工具调用全部跑完。 */
export interface ModClassicPostToolBatchEvent extends ModClassicEventBase {
  hook_event_name: "PostToolBatch";
  /**
   * 这一批里的每一次调用；形状照 CC（没有 `ok` —— 成功与否看 `tool_response`
   * 在不在）。
   */
  tool_calls: Array<{
    tool_name: string;
    tool_input: unknown;
    tool_use_id: string;
    tool_response?: string;
  }>;
}

/** `classic.CwdChanged`：会话**会动的**工作目录变了。 */
export interface ModClassicCwdChangedEvent extends ModClassicEventBase {
  hook_event_name: "CwdChanged";
  /** 变之前那个目录（社区插件读的就是这个名字）。 */
  old_cwd: string;
  /** 变之后那个目录，与公共字段 `cwd` 同一个值。 */
  new_cwd: string;
}

/**
 * `classic.PreToolUse` 的 `e`：**不是** `classic.*` 那份 stdin，而是 `tool.call`
 * 的 `ToolCallEnvelope`。
 *
 * 这是 CC 自己在 mods 面里的排法（`E extends 'PreToolUse' ? ToolCallEnvelope :
 * ClassicHookInputs[E]`）：工具名、调用 id、参数对象，外加把参数在顶层铺一份。
 * 所以这一条**没有** `hook_event_name`，也不进 `ModClassicEvent` 那个联合 ——
 * 它和 `tool.call` 走同一条链（见 `ModManager.dispatchToolCall`）。
 */
export interface ModClassicPreToolUseEvent {
  /** 工具名（与 `tool.call` 的 `tool` 同一个字段）。 */
  tool: string;
  tool_use_id: string;
  input: Record<string, unknown>;
  /** 顶层铺开的一份工具参数：`e.command` 就是 Bash 的 command。 */
  [key: string]: unknown;
}

/**
 * `classic.PreToolUse` 的返回值：与 `tool.call` 同一份 `{ deny }`。
 *
 * CC 对这一条另有 `{ allow: true }` / `{ ask }` / `updatedInput`：前两个是「替
 * 用户放行」与「强制弹一次卡片」，都是第二判定源，`updatedInput` 是改写参数，
 * 三者一律不做。
 */
export interface ModPreToolUseResult {
  deny?: string;
}

/**
 * 一次工具调用是怎么被拒的（`classic.PermissionDenied` 的 `reason`）。
 *
 * 四档分别对应宿主里不同的拒绝点：规则/安全边界直接拒、模式不给问（plan /
 * `dontAsk`）、没有能答的人（headless 没有审批回调）、用户点了拒绝。
 */
export type ModPermissionDeniedReason =
  | "denied_by_rule"
  | "denied_by_mode"
  | "no_permission_prompt"
  | "user_denied";

/**
 * `classic.PermissionDenied`：一次工具调用被权限拒掉之后。
 *
 * 卡片弹出来、用户点了拒绝，与规则/模式直接拒，都在这里报；两者靠 `reason`
 * 分辨。CC 那一格也是宿主自定的短码（它自己给 `host_exit` 这类），所以取值不
 * 与它逐字相同。
 */
export interface ModClassicPermissionDeniedEvent extends ModClassicEventBase {
  hook_event_name: "PermissionDenied";
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  reason: ModPermissionDeniedReason;
}

/** `classic.PreCompact`：上下文压缩**开始之前**。 */
export interface ModClassicPreCompactEvent extends ModClassicEventBase {
  hook_event_name: "PreCompact";
  /** 撞阈值自动压（`auto`）还是 `/compact`（`manual`）。 */
  trigger: "auto" | "manual";
  /** `/compact` 带的那段指令；没有时是 `null`（CC 这一格就是 nullable）。 */
  custom_instructions: string | null;
}

/** `classic.PostCompact`：上下文压缩**完成之后**（与 `session.compact` 同一时刻）。 */
export interface ModClassicPostCompactEvent extends ModClassicEventBase {
  hook_event_name: "PostCompact";
  trigger: "auto" | "manual";
  /** 这次写回历史的那段摘要正文。 */
  compact_summary: string;
}

/**
 * `classic.MessageDisplay`：一条 assistant 消息收尾时（一轮里每条回答各一次）。
 *
 * 我们不分 flush：CC 每攒够几行派发一次、`index` 递增、`final` 只在最后一次为
 * 真；我们一条消息只给一次全文，所以 `index` 恒 `0`、`final` 恒 `true`。
 */
export interface ModClassicMessageDisplayEvent extends ModClassicEventBase {
  hook_event_name: "MessageDisplay";
  /** 这条消息属于哪一轮（与 `turn.start` / `turn.complete` 的 `turnId` 同一个）。 */
  turn_id: string;
  /** 转录里这条消息的 id（同一条消息的多次 flush 共用一个）。 */
  message_id: string;
  /** 恒 `0`：我们不给增量，只有一次全文。 */
  index: 0;
  /** 恒 `true`：这一次就是这条消息的最后一次。 */
  final: true;
  /** 这条消息的完整正文（按限额截断）。 */
  delta: string;
}

/**
 * 会话里一条消息的内容块（spec「会话消息」）。
 *
 * 三种块就是模型真正读的那三种：文本、一次工具调用、一次工具结果。没有第四
 * 种 —— 宿主自己的提醒在转录里也是文本块，只是带 `system-reminder` 包壳。
 */
export type ModSessionMessageBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

/**
 * `$.session.messages()` 返回的一条消息，也是 `session.append` 里的 `e.message`
 * （spec「会话消息」「转录写入前改写」）。
 *
 * 两个地方同一形状是刻意的：插件拿到 `session.append` 的消息后可能想直接喂给
 * 自己的面板，形状不一致会让它写两套渲染。
 */
export interface ModSessionMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: ModSessionMessageBlock[];
}

/**
 * `session.append` 的载荷：一条消息要存进转录之前（spec「转录写入前改写」）。
 *
 * 粒度是**一条消息**，不是 CC 的一行 —— 一条 assistant 消息可能带多个块，
 * 见 spec 里那条「粒度是我们的，不是 CC 的」。
 */
export interface ModSessionAppendEvent {
  message: ModSessionMessage;
  /**
   * 这一行在转录里的 id（就是 `message.id`）。CC 的字段名是 `uuid`，插件按它
   * 回查 / 串联自己要记的那一份 —— 真插件（lossless-claude）读的就是这个名字。
   */
  uuid: string;
  /** 这一行是从哪条门进来的，取值与 CC 的 `doorOf` 同名同义。 */
  door: ModSessionAppendDoor;
  /** 子代理落库时带自己的 id（主会话的行上没有这个键）。 */
  agentId?: string;
  [key: string]: unknown;
}

/**
 * `session.append` 的 `door`：这一行是怎么来的。
 *
 * 只列我们给得出的档；CC 另有 `tool-message`（子代理的工具消息）、`command`
 * （斜杠命令的回显）、`notice`（系统提示行）、`compaction`（压缩摘要）、
 * `delivery`（投递给子代理的附件）、`hook-context`（钩子塞进来的上下文）、
 * `attachment`（宿主自己渲染的附件）七档，我们没有对应的行，就不放进类型里
 * 装作有 —— 压缩摘要那一行本来就不问 `session.append`。
 */
export type ModSessionAppendDoor =
  // 用户提交的一句话
  | "prompt"
  // 模型的回答
  | "response"
  // 工具结果（CC 里是带 tool_result 块的 user 行）
  | "tool-result"
  // 宿主自己塞进去、不来自人的行（记忆注入、系统提醒）
  | "note";

/** `tool.check` 能给出的决定（spec「第二判定源」）。 */
export type ModToolCheckDecision = "allow" | "ask" | "deny";

/**
 * `tool.check` 的载荷：宿主已经按规则与模式算出决定之后（spec「第二判定源」）。
 *
 * `decision` / `reason` 是**宿主的结论**，`next(e)` 原样传给下面的 mod；钩子
 * 返回 `{ decision }` 换掉它。**只能收紧**：`deny → allow/ask` 不接受。
 */
export interface ModToolCheckEvent {
  tool: string;
  tool_use_id: string;
  input: unknown;
  /** 宿主的结论（规则 + 模式 + 前面那些钩子的结果）。 */
  decision: ModToolCheckDecision;
  /** 结论的理由：`deny` 时是规则名、`ask` 时是模式名，`allow` 时通常没有。 */
  reason?: string;
  /** 子代理发起的调用上才有。 */
  agentId?: string;
  /** 工具自己报了只读时为 `true`；不是 `false`，是不出现。 */
  isReadOnly?: true;
  [key: string]: unknown;
}

/** 系统提示词里的一段（spec「系统提示词与附件」）。 */
export interface ModPromptSection {
  /** 段名，`prompt.section` 的 `e.name` 就是它。 */
  id: string;
  text: string;
  /**
   * `shared` 是跨轮不变的共享段（排在段表最前、进缓存前缀），`session` 是本场
   * 会话内才成立的段（排在最后、每轮重算）。与 CC 的两档同名同义。
   */
  scope: "shared" | "session";
}

/**
 * `prompt.context` 交下去的一块上下文（spec「系统提示词与附件」）。
 *
 * 形状照 CC：`{ name, text }` —— `name` 是给人和日志看的来源标记，`text` 才是
 * 进模型上下文的正文。lossless-claude 就是 `{ blocks: [...blocks, { name: "lcm", text }] }`。
 */
export interface ModPromptContextBlock {
  name: string;
  text: string;
}

/**
 * 所有 `classic.*` 镜像的并集（`classic.PermissionRequest` 与
 * `classic.PreToolUse` 在它们自己的类型里）。
 *
 * 只用于 `notifyMods` 的载荷签名 —— mod 侧拿到的是对应的那一个。
 */
export type ModClassicEvent =
  | ModClassicSessionStartEvent
  | ModClassicSessionEndEvent
  | ModClassicStopEvent
  | ModClassicStopFailureEvent
  | ModClassicUserPromptSubmitEvent
  | ModClassicNotificationEvent
  | ModClassicInstructionsLoadedEvent
  | ModClassicPostModelSwitchEvent
  | ModClassicSubagentStartEvent
  | ModClassicSubagentStopEvent
  | ModClassicToolUseEvent
  | ModClassicPostToolBatchEvent
  | ModClassicCwdChangedEvent
  | ModClassicPermissionDeniedEvent
  | ModClassicPreCompactEvent
  | ModClassicPostCompactEvent
  | ModClassicMessageDisplayEvent;

/**
 * `$.ui.ask` 的第二个参数（spec「问用户一个问题」）。
 *
 * 照 Claude Code 的 `AskOptions`：可以直接给标签数组，也可以给
 * `{ options, header, multiSelect }`。标签少于两个按「是 / 否」补齐，多于四个
 * 报错（提问卡片画不下）。
 */
export type ModAskOptions =
  | readonly string[]
  | {
      options?: readonly string[];
      /** 那颗小标签；没写用插件名（CLI 会 `.slice(0, 12)`）。 */
      header?: string;
      /** 允许多选时多个答案用逗号连接。 */
      multiSelect?: true;
    };

/**
 * `tool.call` 的载荷：一次工具调用（spec「拦下一次工具调用」）。
 *
 * 字段照 Claude Code 的 `ToolCallEnvelope`：`tool` 是工具名、`tool_use_id` 是这
 * 次调用的 id、`input` 是它收到的参数；参数**另外在顶层铺一份**（`e.command`
 * 就是 Bash 的 `command`），社区插件读写的是顶层那份而不是 `e.input.command`。
 *
 * 时机在 `settings.json` 的 PreToolUse 钩子之前（「要不要拦」）；`next(e)` 就是
 * 执行，里面的执行先过那道 PreToolUse，所以它不能用来绕过用户的拒绝。
 */
export interface ModToolCallEvent {
  tool: string;
  tool_use_id: string;
  input: unknown;
  /** 工具参数在顶层铺开的副本（见上）。 */
  [key: string]: unknown;
}

/**
 * `tool.call` 钩子的 `{ deny }` 返回值。
 *
 * 拦下这次调用，模型收到这段文本作为工具错误结果（与「参数不合法」同一形态）。
 * 改写参数、替用户批准（`tool.check`）都不做；`{ result }` 是另一个通道
 * （见 `ModManager.dispatchToolCall` 的 `ModToolCallDecision`）。
 */
export interface ModToolDenyResult {
  deny: string;
}

/**
 * `prompt.submit` 的载荷：用户提交了一条 prompt、模型请求还没发出（spec
 * 「轮次内外的事件（只读）」）。
 *
 * **只在用户敲的那条 prompt 上派发**：mod 自己经 `$.prompt.submit` 投进来的不
 * 触发（否则 handler 里再 submit 就是无限环）。钩子可以返回
 * {@link ModPromptSubmitResult} 往本轮塞上下文；改 `text` / `drop` 是 Claude
 * Code 同名事件另外两个返回值，我们不支持（悄悄改写或丢掉用户敲的话，界面上
 * 看不出来）。
 */
export interface ModPromptSubmitEvent {
  /** 用户提交的原文。 */
  text: string;
}

/** `prompt.submit` 钩子的返回值：塞进本轮的附加上下文。 */
export interface ModPromptSubmitResult {
  /** 字符串数组；为空、非数组、超限的部分一律丢弃并记一条 warn。 */
  context?: string[];
}

/**
 * `turn.start` 的载荷：一轮开始（用户消息已进上下文、第一个请求之前）。
 */
export interface ModTurnStartEvent {
  /**
   * 这一轮的 id：`turn.start` / `turn.step` / `turn.complete` /
   * `classic.MessageDisplay` 用同一个值，也是 `$.turn.abort({ turnId })` 要传的
   * 那一个（spec「收掉一轮」）。
   */
  turnId: string;
  [key: string]: unknown;
}

/** `turn.step` 的载荷：这一轮里每发出一次模型请求之前。 */
export interface ModTurnStepEvent {
  /** 属于哪一轮（与 `turn.start` 的 `turnId` 同一个值）。 */
  turnId: string;
  /** 这一轮里第几次模型请求，**从 0 起**：工具循环里每次请求都算一步。 */
  index: number;
  /** 写这一次请求时会话里已有的消息条数。 */
  messageCount: number;
  /** 这一次请求要用的模型名（CC 要求非空字符串）。 */
  model: string;
  /** 推理强度：宿主有统一口径就带上，没有这个键（CC 的取值是枚举或数字）。 */
  effort?: string | number;
  [key: string]: unknown;
}

/** `session.compact` 的载荷：上下文压缩**完成后**。 */
export interface ModSessionCompactEvent {
  /** 自动（撞到阈值）还是手动（`/compact`）。 */
  trigger: "auto" | "manual";
  /** 压缩前的上下文估值，与 `$.session.usage().context.tokens` 同一口径。 */
  tokensBefore: number;
  /** 压缩后的上下文估值（压缩完读历史重新算）。 */
  tokensAfter: number;
}

/** `session.end` 的载荷：会话销毁之前（没有字段，形状留位）。 */
export type ModSessionEndEvent = Record<string, never>;

/**
 * `session.measure` 的载荷（spec「会话用量」）。
 *
 * 「量了一次」= 刚收到一次带 usage 的响应。载荷就是一份 `$.session.usage()`
 * 快照（`context` / `tokens` / `rateLimits` / `startedAt`），外加 `changed`
 * 说明这次变的是哪几项 —— 社区 mod 用它决定要不要重画，不自己轮询。
 * 我们**没有**成本账本，所以快照里没有 `cost`（社区 mod 的写法是
 * `usage.cost ? … : null`，缺字段与「没有账本」同义）。
 */
export interface ModSessionMeasureEvent extends ModSessionUsage {
  /** 这次测量里变了的项。 */
  changed: Array<"context" | "tokens">;
}

/**
 * 派发 `session.measure` 时**调用方**给的最小载荷（`AIManager` 只知道
 * 「刚量到一次用量」）。
 *
 * 其余字段由 `ModManager` 用用量快照补齐（它才握着数据源），所以这里是
 * {@link ModSessionMeasureEvent} 的子集而不是另立一套形状。
 */
export type ModSessionMeasureTrigger = Pick<ModSessionMeasureEvent, "changed">;

/** `ui.close` 的载荷：一个由 mod 打开的面板被关掉。 */
export interface ModPaneCloseEvent {
  /** 被关掉的 pane id（`$.ui.open({ id })` 的那个）。 */
  id: string;
}

/** `$.settings.read({ source })` 认的层。 */
export const MOD_SETTINGS_SOURCES = ["user", "project", "local"] as const;

export type ModSettingsSource = (typeof MOD_SETTINGS_SOURCES)[number];

/** `$.ui.copy({ surface })` / `surfaces()` 认的端（与 `ModRenderSurface` 同一组）。 */
export const MOD_RENDER_SURFACES = [
  "terminal",
  "desktop",
  "vscode",
  "mobile",
] as const;

/**
 * `$.command.register` 的参数（spec「注册命令」）。
 *
 * 只有菜单元数据，**没有 handler** —— 用户敲下命令后引擎派 `command.run` 钩子，
 * 由钩子答 `{ text }`。这是 Claude Code 的契约，照抄的理由是：注册的是「菜单里
 * 那一行」，而真正做什么每次都可能在钩子里按状态变化。
 */
export interface ModCommandSpec {
  /** `/^[a-zA-Z0-9_-]{1,64}$/`，不带斜杠。 */
  name: string;
  /** 菜单里显示的那行字，必填非空。 */
  description: string;
  /** 命令后显示的参数提示（如 `"<天数>"`）。 */
  argumentHint?: string;
  /** 忙时是否插队执行，语义同 `SlashCommand.immediate`。 */
  immediate?: boolean;
}

/** `$.command.list()` 的一行。 */
export interface ModCommandInfo {
  name: string;
  description: string;
  /** 来源：内置技能、用户/项目自定义命令、插件（含 mod 自己注册的）。 */
  source: "builtin" | "user" | "project" | "plugin";
  /** `source === "plugin"` 时的插件名（不可信文本，展示前要转义）。 */
  plugin?: string;
}

/**
 * `ModManager` 与斜杠命令表之间的桥（spec「注册命令」）。
 *
 * 命令表在 `SlashCommandManager`，而「执行这条命令该问哪个 mod」只有
 * `ModManager` 知道；两边互相持有会成环，所以由组装方（`containerSetup`）建一个
 * 只含四个动作的桥传进去。
 */
export interface ModCommandBridge {
  /**
   * 登记一条 mod 命令。重名、非法名都在实现侧拒掉并返回原因 ——
   * `$.command.register` 要把原因抛给 mod 作者看。
   */
  register(input: {
    name: string;
    description: string;
    argumentHint?: string;
    immediate?: boolean;
    /** 注册者插件名，用于命令的归属（重名判定的「插件 X 已注册」）。 */
    plugin: string;
    /** 用户执行这条命令时调用；返回 `undefined` 表示没有钩子回答。 */
    run: (args: string) => Promise<string | undefined>;
  }): { ok: true } | { ok: false; reason: string };
  /** 撤销一条 mod 命令（插件重载 / 会话销毁）。 */
  unregister(name: string): void;
  /** 当前可见的命令（含非 mod 来源），供 `$.command.list()`。 */
  list(): ModCommandInfo[];
  /** 以 mod 身份执行一条命令；不存在时抛错。 */
  run(command: string, args?: string): Promise<void>;
}

/**
 * 层级（Claude Code 的 `Tier` 的**子集**）。
 *
 * 只有两档：`core` 是引擎自己，`user` 是**所有** mod —— 我们这一版 mod 全在同
 * 一层里，正好等于 Claude Code 的 `user`。`prepend` / `append` / `builtin` 要
 * 一整套分层与让位机制，本轮不做；先造出这三个值只会让人以为有派发语义。
 */
export type ModTier = "core" | "user";

/** 谁发起了这次派发（Claude Code 的 `Origin`）：插件名，加它所在的层。 */
export interface ModHookOrigin {
  /** 引擎自己发起时是 `"engine"`；某个 mod 用 `$` 主动进链时是那个 mod 的名字。 */
  readonly plugin: string;
  readonly tier: ModTier;
}

/**
 * `next.budget`（Claude Code 的 `NextBudget`）：这个钩子**这次派发**的时间预算。
 *
 * `ms` 是这次派发的总额度（0 表示没人计量），`remainingMs` 是现在还剩多少。
 * 我们的钩子一律计量（`MOD_LIMITS.hookTimeoutMs`），所以 `ms` 恒为那个数。
 *
 * 与 CC 同一条口径：**这个钟只算这个钩子自己的时间**，它调 `next(e)` 期间、
 * 以及它调 `$`（等外部进程、等模型）期间都停表 —— 下游有几个 mod、跑多久都
 * 不吃本层的额度（CC 的 `HookBudget` 原文是 "A hook's budget per dispatch"）。
 * 所以一条链的总耗时可以超过 `ms`。
 *
 * 与 CC 的差别：CC 是 10 秒，我们是 5 秒；CC 的 `.catch` 另有 1 秒宽限
 * （`catchMs`），我们没有——兜底跑在预算停表之后，不被计时。
 */
export interface ModHookBudget {
  readonly ms: number;
  readonly remainingMs: number;
}

/**
 * 一条 `next.trace` 记录的结局。
 *
 * 只有我们**真能判定**的三档（Claude Code 的 `TraceOutcome` 的子集）：
 * `returned` 自己给了结果、`caught` 抛了但被 `.catch` 接住并给了结果、
 * `rejected` 抛了且没人接（错误继续往上走）。
 * CC 另外四个（`passed` / `kept` / `expired` / `skipped`）分别要「返回值是不是
 * 就是 `next` 的结果」「失败前后的结果留存」「逐层预算记账」「层间让位」，这几
 * 样我们都没有 —— 不编假值，缺就是缺。
 */
export type ModTraceOutcome = "caught" | "rejected" | "returned";

/**
 * `next.trace` 的一条：这条链上**已经跑完**的一层（Claude Code 的 `TraceEntry`）。
 *
 * 只给真拿得到的字段。CC 还有 `reason`（这层被跳过时写「被谁 bypass」）、
 * `chunks`、`received`、`returned`：我们没有层间让位、也没按层记块数，不给。
 */
export interface ModTraceEntry {
  /**
   * 在这条链上第几个跑完，**0 是第一个跑完的**（嵌套链里最内层先完成，所以
   * 0 往往是最内层）；matcher 没选中的层不占号，因此不会出现空洞。
   *
   * 不是「第几层」（CC 的 `TraceEntry.index` 是链上的位置，我们是完成顺序）：
   * 我们记的是「已经跑完的层」，一个正挂在 `next` 上的层还没资格进 trace。
   */
  readonly index: number;
  /** 这一层属于哪个插件。 */
  readonly plugin: string;
  /** 这一层在哪一档（我们的 mod 一律 `user`）。 */
  readonly tier: ModTier;
  /** 这次派发的事件名。 */
  readonly event: string;
  readonly outcome: ModTraceOutcome;
  /**
   * 这一层花掉的墙钟毫秒。
   *
   * 与 CC 的 `ms` 同名字、同含义，但**不**扣掉它调 `next` 时下面那几层的时间
   * （要扣得逐次记住 `next` 的在飞时长，等真有需要再补）。
   */
  readonly ms: number;
}

/**
 * 钩子链的 `next`：一次派发里「交给下面」的那一帧（Claude Code 2.1.323 的
 * `Next` / `GlobNext` 里我们支持的那部分）。
 *
 * 可调用 —— `next(e)` 把控制权交给链上的下一层，最后是引擎自己那一帧；另外挂
 * 着五个只读成员。CC 还有 `to(e, tier)`（跳到更深的某一层），那要 entry 打 tier
 * 且两个 chain driver 都支持跳层；我们所有 mod 同层，本轮**没有** `to`，不是漏。
 *
 * `.catch` 那一帧在此之上多 `error` / `called`（CC 的 `Caught`），主帧没有它们。
 */
export interface ModHookNext {
  /** 交给链上的下一层；链尾是引擎那一帧（`ui.render` 是 `undefined`）。 */
  (event?: unknown): unknown;
  /** 整条调用被放弃时 abort（用户中断、会话销毁、插件重载）。 */
  readonly signal: AbortSignal;
  /** 这次派发的事件名，给「一条钩子管多个事件」的写法记日志 / 分支。 */
  readonly event: string;
  /** 谁发起了这次派发（引擎自己，还是某个 mod 的 `$` 调用）。 */
  readonly origin: ModHookOrigin;
  /** 这条链上已经跑完的层；读一次给一次只读快照。 */
  readonly trace: readonly ModTraceEntry[];
  /**
   * 这次派发的时间预算；读一次算一次。
   *
   * 只在整个 mod 都停着等人时静止（`$` 调用、等进程输出那种）；`next` 在飞时
   * **不停表** —— 停了就等于每层各有一份完整额度，那正是本轮修掉的东西。
   */
  readonly budget: ModHookBudget;
  /**
   * 这次派发的事件是不是被 `pattern` 选中：`next.is("tool.call", e)`。
   *
   * 认的 pattern 与我们 `on()` 认的**完全一致**（事件名，或 `"classic.*"`）：
   * CC 的 `"*"` 与 `"!tool.*"` 我们派发侧还不支持，认下来等于骗人 —— 传别的
   * 模式当场抛错，而不是安静答 `false`。
   */
  is(pattern: string, event: unknown): boolean;
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
  /** `Svg.source` 的字符上限（与 Claude Code 同一个数）。 */
  svgSourceChars: 131_072,
  /** `Svg` 的 `width` / `height` 上限（px，同上）。 */
  svgDimension: 4096,
  /** `Select.options` 的条数上限（同上）。 */
  selectOptions: 64,
  /** 单个 hook 执行时间。 */
  hookTimeoutMs: 5_000,
  /** 同一面板两次刷新的最小间隔。 */
  invalidateIntervalMs: 100,
  /** `$.clock` 的最小间隔；更小的值夹到这个数（spec「定时器」）。 */
  timerMinIntervalMs: 200,
  /** 一个 mod 同时活跃的定时器数；超出时新建报错。 */
  maxTimersPerMod: 16,
  /** 一个 mod 同时活跃的外部进程数；超出时 `$.process.spawn` 报错。 */
  maxProcessesPerMod: 4,
  /** 外部进程单块输出的字符上限，更长的块切开。 */
  processChunkChars: 64 * 1024,
  /** 一个外部进程累计输出上限（字节），超出后停止读取并结束该进程。 */
  processTotalBytes: 4 * 1024 * 1024,
  /** `$.process.run` 的默认超时。 */
  runTimeoutMs: 30_000,
  /** `$.process.run` 的超时上限；更大的 `timeoutMs` 夹到这个数。 */
  maxRunTimeoutMs: 600_000,
  /** `$.process.run` 的 stdout / stderr 各自保留的字节数。 */
  runStreamBytes: 4 * 1024 * 1024,
  /** `$.fs` 单个文件的读写上限（字节）。 */
  fsFileBytes: 4 * 1024 * 1024,
  /** `$.http.fetch` 的请求体 / 响应体上限（字符）。 */
  httpBodyChars: 4 * 1024 * 1024,
  /** 一次 `$.http.fetch` 的超时（含重定向与读完 body）。 */
  httpTimeoutMs: 30_000,
  /**
   * `$.prompt.fill` 等宿主回执的上限（spec「把草稿填进输入框」）。
   *
   * 与 Claude Code 同一个 5 秒：超时按 `{ isFilled: false }` 作答，晚到的
   * 回执丢弃。没有这条上限，mod 的 `await` 会在一个卡住的 webview 上永远挂着。
   */
  promptFillTimeoutMs: 5_000,
  /**
   * `$.prompt.read()` 等宿主回执的上限（spec「输入框里现在有什么」）。
   *
   * 比 `fill` 短：读草稿是「顺手问一句」，超时就当没有输入框，不值得让调用方
   * 多等两秒。
   */
  promptReadTimeoutMs: 3_000,
  /** `$.ui.copy` 一次能写入的字符上限；超出报错而不是切一刀。 */
  copyTextChars: 100_000,
  /** `$.fs.ancestors` 最多返回几项；超出按目录由近到远截断。 */
  ancestorFiles: 32,
  /** `$.fs.ancestors` 读出来的正文总量（字节）；超出报错。 */
  ancestorBytes: 256 * 1024,
  /** 一次 `$.http.fetch` 最多跟的重定向次数。 */
  httpMaxRedirects: 5,
  /** `$.ui.status` 一行的字符上限，超出截断并加省略号。 */
  statusChars: 10_000,
  /** `$.ui.toast` 的默认停留时间。 */
  toastDefaultMs: 4_000,
  /** `$.ui.toast` 允许的最长停留时间；更大的 `timeoutMs` 夹到这个数。 */
  toastMaxMs: 10_000,
  /** 同时排队的 toast 条数；溢出时丢弃尚未展示的旧条。 */
  toastQueueMax: 50,
  /** 一个 mod 注册的命令数上限；超出时 `$.command.register` 报错。 */
  maxCommandsPerMod: 32,
  /** 一个 mod 注册的工具数上限；超出时 `$.tool.register` 报错。 */
  modToolsPerMod: 16,
  /** mod 工具的 `description` 字符上限；超出报错（不截断 —— 截断的描述教错模型）。 */
  modToolDescriptionChars: 2_000,
  /** mod 工具的 `inputSchema` 序列化后字节上限；超出报错。 */
  modToolSchemaBytes: 16 * 1024,
  /** 一个 mod 同时活跃的子代理数；超出时 `$.agent.spawn` 报错。 */
  modAgentsPerMod: 4,
  /** `$.model.complete` 每条会话每个插件的调用次数上限（超出当场 reject）。 */
  modModelCallsPerSession: 50,
  /** `$.model.complete` 的 `maxTokens` 上限，更大的夹到这个数。 */
  modModelMaxTokens: 4096,
  /** `$.model.complete` 的 `timeoutMs` 上限，更大的夹到这个数（缺省不设超时）。 */
  modModelMaxTimeoutMs: 300_000,
  /** `$.clock.sleep` 单次等待上限；更长的夹到这个数。 */
  maxSleepMs: 600_000,
  /** 一个 mod 同时未完成的 `$.clock.sleep` 数；与定时器分开计。 */
  maxSleepsPerMod: 16,
  /** `$.env.get` 的名字长度上限；更长的按「没设置」处理。 */
  envNameChars: 256,
  /** `$.settings.read` 返回值的 JSON 字节上限；超出报错（截断的配置是错的配置）。 */
  settingsReadBytes: 4 * 1024 * 1024,
  /**
   * `$.store` 单个值的 JSON 文本**字符数**上限（与 Claude Code 同一个数，
   * 它比的也是 `JSON.stringify` 之后的 `length`，不是字节）。
   */
  storeValueChars: 4_194_304,
  /** `prompt.submit` 钩子能塞的上下文条数上限。 */
  promptContextMaxItems: 32,
  /** `prompt.submit` 钩子能塞的上下文总字符上限。 */
  promptContextChars: 100_000,
  /**
   * 同一条用户 prompt 里，`classic.Stop` 的 `additionalContext` 最多让这一轮续
   * 跑几次（spec「一轮收尾时的非错误反馈」）。
   *
   * 8 是 Claude Code 的 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 默认值：插件写得再贪
   * 也不会把用户困在「永远答不完」的循环里。
   */
  stopHookContinuationCap: 8,
  /**
   * `$.session.messages()` 最多回多少条（spec「会话消息」）。
   *
   * 「整份对话」与「一个数字」不是一个量级：`usage()` 那种快照可以每轮给，
   * 历史不行。200 条足够画一屏历史，又不至于把一次 `Read` 的几 MB 结果连同
   * 前面几十轮一起跨沙箱边界递出去。
   */
  sessionMessages: 200,
  /** `$.session.messages()` 单条消息的正文上限，超出截断并加省略号。 */
  sessionMessageChars: 8_000,
  /** `prompt.compose` 能返回的段数上限；超出只取前这么多并记一条 warn。 */
  promptSections: 64,
  /** 一段系统提示词的字符上限；超出截断并记一条 warn（截断的提示词是坏提示词）。 */
  promptSectionChars: 100_000,
} as const;
