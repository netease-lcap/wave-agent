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

/**
 * 输入框上方那条带的渲染结果（spec「状态带、状态行与提示」）。
 *
 * 一个 mod 一条带；没有注册 `ui.render`、或钩子返回 `undefined` 的 mod 不出现在
 * 结果里（不占位置）。`instance_id` 固定是 {@link MOD_BAND_INSTANCE_ID}。
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

/** `AbovePrompt` 站点的 `instance_id`（spec「状态带、状态行与提示」）。 */
export const MOD_BAND_INSTANCE_ID = "above-prompt";

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
  /** 上下文占用：`tokens` 是最近一次带 usage 的响应报出的总数。 */
  context: { tokens: number; window: number; percent: number };
  /** 整场会话累计的 token（跨轮相加，含压缩轮）。 */
  tokens: ModTokenTotals;
  /** 当前模型名；没配时是 `undefined`。 */
  model?: string;
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
 * `turn.complete` 的载荷（spec「完成与审批的观察」）。
 *
 * 与 Claude Code 同名事件对齐的部分是 `isAborted` / `durationMs` / `answer` /
 * `usage`；**没有** `turnId` / `agentId`（我们一期只报主 agent 的轮次），也不接
 * 管返回值（CC 的 `{ text }` 会在答案下面显示一行，我们不显示）。
 */
export interface ModTurnCompleteEvent {
  /** 这一轮是被用户中断掉的（Esc / 停止），而不是答完。 */
  isAborted: boolean;
  /** 从这一轮开始处理到结束（含 Stop 钩子重开、通知注入重开的循环）。 */
  durationMs: number;
  /** 这一轮最后一条 assistant 消息的正文；中断时可能为空串。 */
  answer: string;
  /** 本轮所有模型请求的 token 合计（含工具循环里的每一次与每次重开）。 */
  usage: ModTokenTotals;
}

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
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input?: unknown;
  plan_file_path?: string;
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
} as const;
