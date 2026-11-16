/**
 * Plugin MODS —— mod 与宿主之间的数据契约（spec `ecosystem/plugin-mods.md`）。
 *
 * 这个文件是四端共用契约的**唯一真源**：SDK 侧编译器/沙箱产出它，stdio RPC
 * 用它序列化，webview 侧 `ModPanelRenderer` 消费它。webview 只能从
 * `wave-agent-sdk/types` 拿到这些类型（浏览器 bundle 需要 node-free 入口），
 * 所以这里不许 import 任何 node 模块。
 */

/**
 * 支持的元素。新增一个要同时改 runtime 的工厂与 webview 的渲染器。
 *
 * 与 Claude Code 的 `desktop` 表逐项对齐，只差 `Client`（它要在渲染端执行 mod
 * 附带的第二份模块，见 spec「交付分层」）；`Raster` / `Image` 只有终端有，不在
 * 桌面端的表里。
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

/**
 * `ui.render` 事件里 `props.bodyColumns` 的取值。
 *
 * surface 目前不在渲染请求里报自己的宽度（面板宽度由用户拖，带宽度跟窗口走），
 * 而社区 mod 会拿它决定「画 8 格还是 12 格的进度条」「这半句要不要省略」。给一
 * 个中性的默认值总比给 `undefined` 好：后者会让 `e.props.bodyColumns >= 110`
 * 恒假，宽窗口上也永远画窄版。
 */
export const MOD_RENDER_BODY_COLUMNS = 100;

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
 * `$.prompt.fill` 把文本放在哪（spec「把草稿填进输入框」）。
 *
 * 三档都是 Claude Code 的原名：`replace` 替掉整份草稿、`append` 接在后面、
 * `insert` 插在光标处。
 */
export type ModPromptFillMode = "replace" | "append" | "insert";

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
   * 额度窗口（Claude Code 的 `five_hour` / `seven_day`）。
   *
   * 我们还没有企业端的额度接口，所以**恒为空数组** —— 形状留着是为了让社区
   * mod 不用改一行（它们直接 `.reduce` 这个字段），语义留白由空数组表达。
   */
  rateLimits: ModRateLimitWindow[];
  /** 当前模型名；没配时是 `undefined`。 */
  model?: string;
}

/** 一个额度窗口的用量（spec「会话用量」）。 */
export interface ModRateLimitWindow {
  /** `five_hour` / `seven_day` 这类窗口名。 */
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
  hook_event_name: "PermissionRequest";
  tool_name: string;
  tool_input?: unknown;
  plan_file_path?: string;
}

/**
 * `tool.call` 的载荷：一次工具调用**结束**，结果已经拿到（spec「完成与审批的
 * 观察」）。
 *
 * 字段照 Claude Code 同名事件的形状取最小集：`tool` 是工具名、`input` 是它收到
 * 的参数。CC 的同名钩子还能返回 `{ deny }` 拦下这次调用，我们只做观察这一半，
 * 返回值丢弃。
 */
export interface ModToolCallEvent {
  tool: string;
  input: unknown;
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

/** `turn.start` 的载荷：一轮开始（用户消息已进上下文、第一个请求之前）。 */
export interface ModTurnStartEvent {
  /** 一轮里第几步，永远是 0；给形状留位（与 `turn.step` 的 `step` 连着看）。 */
  step: 0;
}

/** `turn.step` 的载荷：这一轮里每发出一次模型请求之前。 */
export interface ModTurnStepEvent {
  /** 从 1 起：一轮里第 N 次模型请求（工具循环里每次请求都算一步）。 */
  step: number;
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
  /** `$.clock.sleep` 单次等待上限；更长的夹到这个数。 */
  maxSleepMs: 600_000,
  /** 一个 mod 同时未完成的 `$.clock.sleep` 数；与定时器分开计。 */
  maxSleepsPerMod: 16,
  /** `$.env.get` 的名字长度上限；更长的按「没设置」处理。 */
  envNameChars: 256,
  /** `$.settings.read` 返回值的 JSON 字节上限；超出报错（截断的配置是错的配置）。 */
  settingsReadBytes: 4 * 1024 * 1024,
  /** `prompt.submit` 钩子能塞的上下文条数上限。 */
  promptContextMaxItems: 32,
  /** `prompt.submit` 钩子能塞的上下文总字符上限。 */
  promptContextChars: 100_000,
} as const;
