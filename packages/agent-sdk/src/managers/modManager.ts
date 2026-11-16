import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { compileMods, type ModSourceFile } from "../mods/compile.js";
import { ModProcessManager } from "../mods/processes.js";
import {
  ModRuntime,
  errorMessage,
  isThenable,
  type CompiledModule,
} from "../mods/runtime.js";
import { validateModTree } from "../mods/validate.js";
import type { Message } from "../types/messaging.js";
import {
  MOD_BAND_INSTANCE_ID,
  MOD_LIMITS,
  MOD_RENDER_BAND_ROWS,
  MOD_RENDER_BODY_COLUMNS,
  MOD_RENDER_PANE_ROWS,
  type ModAgentInfo,
  type ModBandRenderResult,
  type ModCommandBridge,
  type ModCommandSpec,
  type ModConfigRow,
  type ModModelCompleteResult,
  type ModPromptEditEvent,
  type ModPromptSuggestEvent,
  type ModPanelEventPayload,
  type ModPanelRenderResult,
  type ModPanelTree,
  type ModPanelUpdatePayload,
  type ModPermissionRequestEvent,
  type ModPromptBox,
  type ModPromptFillMode,
  type ModPromptSubmitResult,
  type ModRenderSurface,
  type ModSessionCompactEvent,
  type ModSessionMeasureTrigger,
  type ModPromptContextBlock,
  type ModPromptSection,
  type ModSessionAppendDoor,
  type ModSessionMessage,
  type ModSessionMessageBlock,
  type ModSessionRepo,
  type ModToolCheckDecision,
  type ModToolCheckEvent,
  type ModUiControlEvent,
  type ModSessionUsage,
  type ModSessionVersion,
  type ModSettingsSource,
  type ModStatusPayload,
  type ModClassicEvent,
  type ModClassicPreToolUseEvent,
  type ModClassicStopEvent,
  type ModClassicTrigger,
  type ModStopHookResult,
  type ModToastPayload,
  type ModTokenTotals,
  type ModToolCallEvent,
  type ModToolInfo,
  type ModTurnCompleteEvent,
  type ModTurnCompleteTrigger,
  type ModTurnStartEvent,
  type ModTurnStepEvent,
  type ModUiCopyResult,
  type PluginMod,
} from "../types/mods.js";
import type { Plugin } from "../types/plugins.js";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";
import { engineVersion } from "../utils/engineVersion.js";
import { getEsbuild } from "../utils/esbuild.js";
import { logger } from "../utils/globalLogger.js";

/**
 * 我们真的会画的那两端（spec「元素表按端分」）。
 *
 * `renderPane` / `renderBand` 的 `surface` 只收这两个名字：`vscode` / `mobile`
 * 没有渲染器，放进来会让 `ui.render` 说「这棵树有人画」、实际一个像素都不出。
 */
type DrawnSurface = Extract<ModRenderSurface, "terminal" | "desktop">;

/**
 * 能派发的 `classic.*` 名字（spec「影子事件：`classic.*`」）。
 *
 * 列在这里而不是从 `HOOK_NAMES` 里筛：两边的用途不同 —— 那张表是「mod 允许注册
 * 什么」，这里是「宿主会派什么」，改一处不该顺带改另一处。
 *
 * `classic.PreToolUse` **不在**这里：它要等返回值、载荷是 `tool.call` 的信封而
 * 不是 stdin，走的是 {@link ModManager.dispatchToolCall} 那条链。
 */
type ClassicEventName =
  | "classic.PermissionRequest"
  | "classic.SessionStart"
  | "classic.SessionEnd"
  | "classic.Stop"
  | "classic.StopFailure"
  | "classic.UserPromptSubmit"
  | "classic.Notification"
  | "classic.InstructionsLoaded"
  | "classic.PostModelSwitch"
  | "classic.SubagentStart"
  | "classic.SubagentStop"
  | "classic.PermissionDenied"
  | "classic.PostToolUse"
  | "classic.PostToolUseFailure"
  | "classic.PostToolBatch"
  | "classic.CwdChanged"
  | "classic.PreCompact"
  | "classic.PostCompact"
  | "classic.MessageDisplay";

/**
 * 插件 MODS 的宿主侧编排：加载 → 编译 → 沙箱实例 → 事件 → 面板快照。
 *
 * ## 分层
 *
 * 编译与执行都在 agent 进程内（spec「架构约束」），对外只暴露两件事：
 *
 * - {@link onPanelUpdate}：面板的**元信息**（新面板 / 过期 / 关闭 / 错误），
 *   **不带树**。树永远由 surface 拉取（{@link renderPane}，spec「架构约束」）：
 *   surface 收到 `stale` 后自己来要，宿主不主动推树，也不缓存一份给别的
 *   surface —— 每次请求都重新跑 `ui.render`。
 * - {@link handlePanelEvent}：webview 回传的点击/输入/关闭。
 *
 * ## 面板状态归属
 *
 * 面板活在**会话**里，不活在 mod 进程里：mod 调 `$.ui.open()` 只是登记一个
 * 面板，真正的内容由 `ui.render` 钩子现算。宿主关掉一个 pane 时把它的快照、
 * 回调表与定时器一并丢掉；mod 那边只收到一条 `ui.close`（spec「事件」），而且
 * 是告知 —— 拦不下关闭。
 */
/**
 * `$` 上那几个只读事实的数据源（spec「会话事实」「环境变量与设置（只读）」）。
 *
 * 每个值住在不同的 manager 里（`MessageManager` / 容器 token / `AIManager` /
 * `ConfigurationService`），而 `ModManager` 在这些层的下面、一个都拿不到，所以
 * 由 `Agent` 接进来 —— 与 `promptSubmitter` / `sessionUsageProvider` 同一条纪律。
 */
export interface ModSessionFacts {
  sessionId(): string;
  /** 会话工作根（容器 token `WorkspaceRoot`，`cd` 不动）。 */
  workspaceRoot(): string;
  /** 当前生效的模型名；没配时是空串。 */
  model(): string;
  /**
   * 这一刻有谁在画（spec「会话事实」的 `$.session.surfaces()`）。
   *
   * 接口层没接时给空数组：不认识的宿主入口一律按「不画面板」算，宁可让守卫走
   * 「没人能确认」的降级，也不要给一个编出来的 `desktop`。
   */
  surfaces(): readonly ModRenderSurface[];
  env(name: string): string | undefined;
  settings(query: {
    source?: ModSettingsSource;
    key?: string;
  }): Promise<unknown>;
  /** `$.session.turns()`：用户已经发过几条 prompt（只数真实输入）。 */
  turns(): number;
  /** `$.session.repo()`：会话所在的 git 仓库；不在仓库里给 `null`。 */
  repo(): ModSessionRepo | null;
  /** `$.session.version()`：引擎版本、发布基线、构建时间。 */
  version(): ModSessionVersion;
  /** `$.config.list()`：`/config` 菜单此刻会画的行。 */
  configRows(): ModConfigRow[];
  /** `$.tool.list()`：这一刻模型能调的工具。 */
  toolInfos(): ModToolInfo[];
  /** `$.agent.list()`：这条会话派过、还没被丢掉的子代理。 */
  agentInfos(): ModAgentInfo[];
  /**
   * `$.session.messages()`：转录里已经存下的消息（最新在最后）。
   *
   * 由 `Agent` 接进来；没接时给空数组 —— 插件拿到「没有历史」而不是报错。
   */
  sessionMessages(): ModSessionMessage[];
  /**
   * 当前会话的转录文件路径（`classic.*` 镜像的 `transcript_path`）。
   *
   * 与 settings 钩子收到的同一个值：社区插件拿它去读/扫自己的转录副本。
   */
  transcriptPath(): string;
  /**
   * 这一刻生效的权限模式（`classic.UserPromptSubmit` / `classic.PostToolUse`
   * 的 `permission_mode`）。与 `PermissionMode` 的取值同一套。
   */
  permissionMode(): string;
}

/**
 * `$.tool.register` 收到的工具规格（name 已经是 `mcp__<plugin>__<name>`）。
 *
 * 与 `ModCommandBridge` 同一条理由：工具表在 `ToolManager`，而「这个工具该问哪
 * 个 mod 的钩子」只有 `ModManager` 知道。两边互相持有会成环，所以在组装处接桥。
 */
export interface ModToolBridge {
  /** 把一个 mod 的工具挂进注册表；重名（内置 / 自定义 / MCP / 别的 mod）即失败。 */
  register(spec: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    plugin: string;
  }): { ok: true } | { ok: false; reason: string };
  /** 撤销（插件重载、会话结束）。名字不在表里不算错。 */
  unregister(name: string): void;
}

/**
 * `dispatchToolCall` 的答复。
 *
 * 三种可能：`{ deny }`（拦下）、`{ result }`（这次调用的结果）、`{}`（没有
 * 意见，宿主照常往下走）。`result` 与 `deny` 互斥。
 *
 * `result` 有两个来源，宿主不用区分：mod 调了 `next(e)` 时链尾**真的执行**了
 * 这次调用，返回的是那条结果；或者 mod 自己造了一份（CC 同口径 —— 拿到
 * `next()` 的结果再改写就是它的正常用法）。
 */
export interface ModToolCallDecision {
  deny?: string;
  result?: unknown;
}

/**
 * `$.agent.spawn` 的出口：派一个子代理，resolve 在它 started 之后。
 *
 * `settled` 在子代理真正跑完（完成、失败、被杀）时敲定，用来把「还在跑几个」
 * 减回去 —— 并发上限数的是活着的那些，不是派过的那些。
 */
export interface ModAgentBridge {
  spawn(args: {
    prompt: string;
    description?: string;
    subagentType?: string;
    model?: string;
    plugin: string;
    modId: string;
  }): Promise<{ model: string; agentId?: string; settled: Promise<unknown> }>;
}

/** `$.model.complete` 的出口：一次一问、不流式（spec「让模型替插件答一次」）。 */
export interface ModModelBridge {
  complete(request: {
    model: string;
    prompt: string;
    system?: string;
    maxTokens: number;
    signal?: AbortSignal;
    plugin: string;
  }): Promise<ModModelCompleteResult>;
}

/** `ModManager` 的构造参数。 */
export interface ModManagerOptions {
  sessionId: string;
  /** 面板快照的出口；stdio 层把它转成 `modPanelUpdate` 通知。 */
  onPanelUpdate: (payload: ModPanelUpdatePayload) => void;
  /**
   * `$.ui.status` / `$.ui.toast` 的出口（spec「状态带、状态行与提示」）。
   *
   * 可选：不画状态行与提示的宿主（CLI）不传，mod 的调用照常成功、只是没人展示
   * —— 与 `$.ui.open` 在没人画面板时同一条纪律。stdio 层把它们转成
   * `modStatusUpdate` / `modToast` 通知。
   */
  onStatus?: (payload: ModStatusPayload) => void;
  onToast?: (payload: ModToastPayload) => void;
  /**
   * `$.process.spawn` 的默认 cwd。
   *
   * 传 getter 而不是字符串：口径是「会动」的那个工作目录（容器 token
   * `CurrentWorkdir`，与 Bash 工具的 spawn cwd 一致），会话里 `cd` 过之后起的
   * 脚本该落在新目录；挂在会话起点或工作区根上都会指错。
   */
  workdir?: () => string;
  /** `$.session.id()` / `root()` / `model()`、`$.env.get`、`$.settings.read` 的数据源。 */
  sessionFacts?: ModSessionFacts;
  /** 覆盖 store 根目录（测试用）。 */
  storeRoot?: string;
}

interface PaneState {
  modId: string;
  paneId: string;
  title: string;
  revision: number;
  /** 上一帧**成功**渲染的树；渲染失败时回给 surface 的也是它。 */
  tree: ModPanelTree | null;
  error?: string;
  /** 上一次发出 stale 通知的时间，用于 100ms 合并（spec「限额」）。 */
  lastRenderAt: number;
  /**
   * `$.ui.open({ focus: true })` 记下的「这一帧该把键盘送进面板」（spec
   * 「终端形态」）。只在打开那一条推送里透传一次，之后不再带。
   */
  focus?: boolean;
  pending?: NodeJS.Timeout;
}

interface LoadedMod {
  mod: PluginMod;
  /** 插件注册名（`$.ui.status` / 状态带要按它署名）。 */
  plugin: string;
  runtime?: ModRuntime;
  /** 加载/编译失败时的摘要（面板上显示）。 */
  error?: string;
}

/**
 * 一个 `$.clock` 定时器。
 *
 * `running` 是「上一拍的回调还没结束」：`every` 的节拍固定（fire 时就把下一拍
 * 排上），所以回调慢于间隔时会出现「上一拍还在跑、下一拍又到」—— 这时跳过这一
 * 拍而不是排队或并发（spec「定时器」）。
 */
interface ClockTimer {
  modId: string;
  kind: "after" | "every";
  delayMs: number;
  run: () => unknown;
  timer?: NodeJS.Timeout;
  running: boolean;
  cancelled: boolean;
}

/** 该插件持久化的 KV（跨会话），按插件名分文件。 */
function storePath(root: string, pluginName: string): string {
  return path.join(root, `${pluginName}.json`);
}

/**
 * `$.clock.sleep` 的取消错误（spec「时钟：等待」）。
 *
 * `name` 必须是 `AbortError`：mod 的 `try/catch` 要能分辨「等到了」和「被宿主
 * 撤销了」，只靠消息文字做不到（跨 realm，`instanceof` 也不可靠）。
 */
function abortError(): Error {
  const error = new Error("$.clock.sleep 被取消（会话结束或插件重载）");
  error.name = "AbortError";
  return error;
}

/**
 * 跨 realm 的 `AbortSignal` 判断。
 *
 * mod 传进来的 signal 可能是沙箱那边 `new AbortController().signal`，也可能是
 * 用户从别处传进来的对象 —— 只按结构判，不 `instanceof`。
 */
function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { aborted?: unknown }).aborted === "boolean" &&
    typeof (value as { addEventListener?: unknown }).addEventListener ===
      "function" &&
    typeof (value as { removeEventListener?: unknown }).removeEventListener ===
      "function"
  );
}

/** 一个未完成的 `$.clock.sleep`：`cancel()` 让它的 Promise reject。 */
interface SleepWait {
  cancel: () => void;
}

/** 没接上用量来源时的快照：全 0，`window: 0` 表示「还不知道」。 */
const EMPTY_SESSION_USAGE: ModSessionUsage = {
  startedAt: 0,
  context: { tokens: 0, window: 0, percent: 0 },
  tokens: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
  rateLimits: [],
};

/**
 * `turn.complete.usage` 上补一份 Claude Code 的别名（spec「兼容社区 mod」）。
 *
 * 社区 mod 直接 `u.input_tokens` / `u.output_tokens` 做加法，缺一个就是
 * `undefined`，整条带会画出 `NaN`。我们的 `prompt` 含缓存命中、CC 的
 * `input_tokens` 不含，所以是**相减**得来的，不是改名。
 */
/** 钩子返回值是不是一个 `{ deny: string }`（`tool.call` 的决议形状）。 */
/**
 * 走「改写型」链的事件（见 `ModManager.runValueHookChain`）。
 *
 * 与 deny 型那两个（`tool.call` / `classic.PreToolUse`）分开命名，
 * 免得调用方误用：两族链的 `next` 语义不同。
 */
type ModValueHookName =
  | "tool.check"
  | "tool.describe"
  | "prompt.compose"
  | "prompt.section"
  | "prompt.context"
  | "prompt.attachment"
  | "session.append"
  | "skill.prompt"
  | "command.describe"
  // A 档第二批（spec「派子代理」「输入框里的建议与焦点」）：都是「引擎算了一份
  // 值、插件可以换掉它」的形状，与上面那批同一条链。
  | "agent.offer"
  | "prompt.edit"
  | "prompt.suggest"
  // `turn.step` 也在这条链上：引擎算了一份「这次请求用哪个模型」，插件可以
  // 换掉它（`{ ...e, model }`）。它是生成器事件，但改写语义与这一族相同。
  | "turn.step"
  // 控件交互（spec「控件的交互事件」）：链尾是「用户这次按的是哪个控件、带了
  // 什么值」，插件可以换掉两者。
  | "ui.press"
  | "ui.input"
  | "ui.select";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把我们的消息转成 mods 面看到的形状（spec「会话消息」）。
 *
 * 两处刻意的差异：我们的 `tool` 块一条里同时装着调用与结果，CC 那边是
 * `tool_use` 与 `tool_result` 两块 —— 插件按 CC 的形状写渲染，拆成两块它才认得
 * 出「这个工具在干什么」；`isMeta` 的隐藏行不递出去（它们不是对话的一部分）。
 */
export function toModSessionMessages(
  messages: readonly Message[],
): ModSessionMessage[] {
  const out: ModSessionMessage[] = [];
  for (const message of messages) {
    if (message.isMeta) continue;
    let budget = MOD_LIMITS.sessionMessageChars;
    const clip = (text: string): string => {
      if (budget <= 0) return "…";
      const slice = text.length > budget ? `${text.slice(0, budget)}…` : text;
      budget -= Math.min(text.length, budget);
      return slice;
    };
    const content: ModSessionMessageBlock[] = [];
    for (const block of message.blocks) {
      if (block.type === "text") {
        content.push({ type: "text", text: clip(block.content) });
        continue;
      }
      if (block.type !== "tool") continue;
      const id = typeof block.id === "string" ? block.id : "";
      const name = typeof block.name === "string" ? block.name : "";
      content.push({
        type: "tool_use",
        id,
        name,
        input: parseToolParameters(block.parameters),
      });
      const result = block.result ?? block.error;
      if (result === undefined) continue;
      const text =
        typeof result === "string"
          ? result
          : result instanceof Error
            ? result.message
            : String(result);
      content.push({
        type: "tool_result",
        tool_use_id: id,
        content: clip(text),
      });
    }
    out.push({ id: message.id, role: message.role, content });
  }
  return out;
}

/** 工具参数在消息里是一段 JSON 文本；解析不出来就原样给（插件自己会 `String()`）。 */
function parseToolParameters(parameters: string | undefined): unknown {
  if (typeof parameters !== "string") return {};
  try {
    return JSON.parse(parameters) as unknown;
  } catch {
    return parameters;
  }
}

/**
 * `session.append` 里插件交回来的消息：只认「同一条消息、换掉文本」。
 *
 * 改 `role`、改块类型、少一个块都不认（返回 `undefined`，caller 按原样存）——
 * 一条被改了身份的消息会让 `$.session.messages()` 与 `classic.MessageDisplay`
 * 里的 id 对不上（spec「转录写入前改写」）。
 */
function normalizeSessionMessage(
  value: unknown,
): ModSessionMessage | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (typeof value.id !== "string") return undefined;
  const role = value.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return undefined;
  }
  if (!Array.isArray(value.content)) return undefined;
  const content: ModSessionMessageBlock[] = [];
  for (const raw of value.content) {
    if (!isPlainRecord(raw)) return undefined;
    if (raw.type === "text") {
      if (typeof raw.text !== "string") return undefined;
      content.push({ type: "text", text: raw.text });
      continue;
    }
    if (raw.type === "tool_use") {
      if (typeof raw.id !== "string" || typeof raw.name !== "string") {
        return undefined;
      }
      content.push({
        type: "tool_use",
        id: raw.id,
        name: raw.name,
        input: raw.input,
      });
      continue;
    }
    if (raw.type === "tool_result") {
      if (typeof raw.tool_use_id !== "string") return undefined;
      content.push({
        type: "tool_result",
        tool_use_id: raw.tool_use_id,
        content: typeof raw.content === "string" ? raw.content : "",
      });
      continue;
    }
    return undefined;
  }
  return { id: value.id, role, content };
}

function isDeny(value: unknown): value is { deny: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { deny?: unknown }).deny === "string"
  );
}

/**
 * 把我们这一侧的 token 合计翻译成社区读的那套字段（spec「会话用量」）。
 *
 * `$.model.complete` 的 `usage` 也从这里出去：社区插件拿它记账，两处口径必须
 * 一样，否则同一个插件会把缓存重复算一遍。
 */
export function withCommunityUsage(
  totals: ModTokenTotals,
  model: string | undefined,
): ModTurnCompleteEvent["usage"] {
  return {
    ...totals,
    input_tokens: Math.max(
      0,
      totals.prompt - totals.cacheRead - totals.cacheCreation,
    ),
    output_tokens: totals.completion,
    cache_read_input_tokens: totals.cacheRead,
    cache_creation_input_tokens: totals.cacheCreation,
    ...(model === undefined ? {} : { model }),
  };
}

/**
 * `ui.render` 事件的 `props`（社区写法会读 `hasSurvey` / `bodyColumns`）。
 *
 * 我们这一侧还没有这些事实：`hasSurvey` 是 Claude Code 偶尔插在输入框上方的
 * 调查横幅（我们没有），`isWorking` 要问 AI 层的加载状态（渲染请求是从 surface
 * 来的，路线上拿不到），`bodyColumns` 见 {@link MOD_RENDER_BODY_COLUMNS}，两个
 * 行数见 {@link MOD_RENDER_PANE_ROWS}。
 * 先给「中性且稳定」的一组值 —— 缺字段会让社区 mod 的 `e.props.hasSurvey` 直接
 * 抛错，那些 mod 连画都画不出来。
 */
function renderSiteProps(rows = MOD_RENDER_BAND_ROWS): Record<string, unknown> {
  return {
    hasSurvey: false,
    isWorking: false,
    bodyColumns: MOD_RENDER_BODY_COLUMNS,
    maxRows: rows,
    scroll: { offset: 0, bodyRows: rows },
    view: {},
  };
}

/**
 * 从 `AbovePromptList` 的返回树里认出「它留下了哪些行」，按出现顺序给下标。
 *
 * 按**值**比较（先比引用，再比 JSON）：社区写法 `rows.map(r => r.tree)` 交回来
 * 的就是收到的那几个节点（引用相等），把它们包进一层 `<Box>` 再排也还是同一批
 * 节点。改过的副本认不出来 —— 与 Claude Code「改过或重复的一律不算数」同一条
 * 规则，只是我们这边表现为「这次重排不算数」而不是报错。
 */
function pickBandRows(
  value: unknown,
  trees: readonly ModPanelTree[],
): number[] {
  const picked: number[] = [];
  const used = new Set<number>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const index = trees.findIndex(
      (tree, at) => !used.has(at) && sameTree(tree, node),
    );
    if (index >= 0) {
      used.add(index);
      picked.push(index);
      return;
    }
    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    }
  };
  walk(value);
  return picked;
}

function sameTree(tree: ModPanelTree, node: unknown): boolean {
  if (tree === node) return true;
  try {
    return JSON.stringify(tree) === JSON.stringify(node);
  } catch {
    return false;
  }
}

/**
 * `turn.step` 链上的一份答案：只收下 `model` / `effort`。
 *
 * 轮次、序号、消息条数是宿主的事实（mod 说「现在是第 5 步」没有意义）；
 * `model` 按 CC 的口径必须是非空字符串，给了空串、数字就当没改。
 */
function mergeTurnStep(
  fallback: ModTurnStepEvent,
  patch: unknown,
): ModTurnStepEvent {
  if (typeof patch !== "object" || patch === null) return fallback;
  const { model, effort } = patch as { model?: unknown; effort?: unknown };
  const nextModel =
    typeof model === "string" && model.trim() ? model.trim() : fallback.model;
  const nextEffort =
    typeof effort === "string" || typeof effort === "number"
      ? effort
      : fallback.effort;
  return {
    ...fallback,
    model: nextModel,
    ...(nextEffort === undefined ? {} : { effort: nextEffort }),
  };
}

export class ModManager {
  private readonly mods = new Map<string, LoadedMod>();
  private readonly panes = new Map<string, PaneState>();
  /**
   * modId → 输入框上方那条带的上一帧（spec「状态带、状态行与提示」）。
   *
   * 只在这里留住**上一帧成功的树**用于失败兜底 —— 与面板同一条纪律，surface
   * 每次来要都重新跑 `ui.render`，宿主不缓存一份推给别人。
   */
  /** modId → 那条带正在排队的 stale 通知（合并窗口内的重复 invalidate 丢掉）。 */
  private readonly bandPending = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** modId → 那条带上一次被标 stale 的时刻（只用于算合并窗口）。 */
  private readonly bandLastRenderAt = new Map<string, number>();
  private readonly bands = new Map<
    string,
    { revision: number; tree: ModPanelTree | null }
  >();
  /**
   * modId → 它当前贴的那一行状态（spec「状态带、状态行与提示」）。
   *
   * 只为了**重放**：`session.start` 里的推送比客户端注册会话更早，会被
   * `NotificationRouter` 按 v1 语义丢掉（`if (!agent) return`）。surface 挂上来
   * 时要的那份快的照（{@link statusSnapshots}）顺带把这一行补回去，否则
   * 「启动时贴一次就该一直挂着」的用法会一条都看不到。toast 不重放：它是
   * 瞬时消息，晚了就不该再弹。
   */
  private readonly statusLines = new Map<
    string,
    { plugin: string; text: string }
  >();
  private readonly state = new Map<string, Map<string, unknown>>();
  /** modId → 它名下还活着的定时器。 */
  private readonly timers = new Map<string, Set<ClockTimer>>();
  /** modId → 它名下还没结束的 `$.clock.sleep`（与定时器分开计，spec「限额」）。 */
  private readonly sleeps = new Map<string, Set<SleepWait>>();
  private readonly processes: ModProcessManager;
  private readonly storeRoot: string;
  /**
   * 只读事实的数据源（{@link ModSessionFacts}）。
   *
   * 没接上时给一份兜底：会话 id 用构造时那个、工作根用「会动」的目录、模型空
   * 串、env 读不到、settings 空对象 —— 宿主没接线不该让 mod 直接报错。
   */
  private readonly facts: ModSessionFacts;
  /**
   * `$.prompt.submit` 的出口。
   *
   * mod 把 prompt 投进**本会话**，而「投进会话」这件事只有 `Agent` 知道怎么做
   * （走 `Agent.sendMessage`：忙时入队、`/clear` 之类的立即命令直通）。所以由
   * `Agent` 在构造最后接进来，而不是让这个 manager 反过来持有 agent。
   */
  private promptSubmitter?: (text: string) => Promise<void>;
  /**
   * `$.turn.abort` 的出口（spec「收掉一轮」）。
   *
   * 与 `promptSubmitter` 同一条理由：只有 `AIManager` 知道哪一轮在跑、`turnId`
   * 对不对得上，所以由 `Agent` 在构造最后接进来。判不过就让它抛错 —— 这里不做
   * 二次判断，也不吞错。
   */
  private turnAborter?: (turnId: string) => void;
  /**
   * `$.prompt.fill` 的出口（spec「把草稿填进输入框」）。
   *
   * 与 `promptSubmitter` 的区别是这条路**要等回执**：填输入框的是界面进程，
   * 会话这边只知道「发下去」和「填了没有」。配对、超时、宿主能力判断都在
   * `Agent` 里做（见 `Agent.fillModPrompt`），这个 manager 只转一手。
   */
  private promptFiller?: (request: {
    text: string;
    mode: ModPromptFillMode;
  }) => Promise<boolean>;
  /**
   * `$.prompt.read` 的出口（spec「输入框里现在有什么」）。
   *
   * 与 `promptFiller` 是同一条通道的两头，配对与超时也一样留在 `Agent` 那边
   * —— 这里只转一手，答不出来就是 `{ text: "", cursor: 0 }`。
   */
  private promptDraftReader?: () => Promise<ModPromptBox>;
  /**
   * `$.prompt.suggest` 的出口（spec「输入框里的建议与焦点」）。
   *
   * 与 `promptFiller` 同一条通道的第三种用法：摆成暗色建议、Tab 采纳。没接上
   * 时答 `{ isShown: false }` —— 终端就是这一档。
   */
  private promptSuggestionSink?: (request: {
    text: string;
    plugin: string;
  }) => Promise<{ isShown: boolean }>;
  /**
   * `$.ui.notice` 的出口（spec「工具行下面的一行」）。
   *
   * 只推不拉：宿主不画工具块就不传，mod 的调用照常成功（同 `logSink`）。
   */
  private noticeSink?: (
    plugin: string,
    toolUseId: string,
    text: string | null,
  ) => void;
  /**
   * `$.ui.copy` 的出口（spec「剪贴板与视图」）。
   *
   * 要等回执（谁写、写没写成都在界面那一端），所以是个 Promise；没接上时按
   * `no-surface` 作答。
   */
  private copySink?: (request: {
    text: string;
    surface?: ModRenderSurface;
  }) => Promise<ModUiCopyResult>;
  /**
   * `$.session.usage()` 的数据源。
   *
   * 用量只有 `Agent` 读得到（上下文窗口、模型、每次响应的 usage 都在它和它下
   * 面的 manager 手里），与 `promptSubmitter` 同一条理由：由 `Agent` 在构造最
   * 后接进来，这个 manager 不反过来持有 agent。没接上时给零值快照 —— mod 拿到
   * 一个 0 而不是抛错。
   */
  private sessionUsageProvider?: () => ModSessionUsage;
  /**
   * `$.ui.log` 的出口（spec「在对话流里留一行」）。
   *
   * 落点是会话的提示块（`notice`），只有 `MessageManager` 写得了；与
   * `promptSubmitter` 同一条理由，由 `Agent` 接进来。没接上时这行丢失并记一条
   * debug —— 宿主（比如将来的 CLI 形态）不展示对话流时不该让 mod 报错。
   */
  private logSink?: (text: string) => void;
  /**
   * `$.ui.ask` 的出口（spec「问用户一个问题」）。
   *
   * 提问走的是引擎自己的 `AskUserQuestion` 那条审批链路，只有 `Agent` 那边拿得
   * 到权限管理器与宿主回调；与 `promptSubmitter` 同一条理由，由 `Agent` 接进来。
   * 没接上时（纯服务调用）reject —— 守卫据此按「没人能答」处理。
   */
  private askUserHandler?: (
    question: string,
    options: { labels: string[]; header?: string; multiSelect?: true },
  ) => Promise<string>;
  /**
   * `$.command.*` 的桥（spec「注册命令」）。
   *
   * 命令表在 `SlashCommandManager` 里，而「执行一条命令时该问哪个 mod 的钩子」
   * 只有这里知道 —— 两边互相持有会成环，所以由 `containerSetup` 组装一个桥：
   * 注册/列表/执行都转给命令表，回调里再回到本 manager 派 `command.run`。
   */
  private commandBridge?: ModCommandBridge;
  /** 每个 mod 注册了哪些命令（`<modId>` → 命令名集合），卸载与重载时清理。 */
  private readonly ownedCommands = new Map<string, Set<string>>();
  /** `$.tool.register` 的出口（工具表在 `ToolManager`，装配在 `containerSetup`）。 */
  private toolBridge?: ModToolBridge;
  /** 每个 mod 注册了哪些工具（`<modId>` → 全名集合），卸载与重载时清理。 */
  private readonly ownedTools = new Map<string, Set<string>>();
  /** `$.agent.spawn` 的出口（子代理在 `SubagentManager`）。 */
  private agentBridge?: ModAgentBridge;
  /** 每个 mod 眼下还有几个子代理在跑（并发上限数这个）。 */
  private readonly activeModAgents = new Map<string, number>();
  /** `$.model.complete` 的出口（模型请求在 `AIService`）。 */
  private modelBridge?: ModModelBridge;
  /**
   * 每条会话每个插件已经调过几次 `$.model.complete`（spec「让模型替插件答一
   * 次」）。
   *
   * 按**插件**而不是按 mod 数：一个插件拆成三个 mod，用户看的还是这一个插件。
   */
  private readonly modModelCalls = new Map<string, number>();
  private disposed = false;

  constructor(private readonly options: ModManagerOptions) {
    this.storeRoot =
      options.storeRoot ?? path.join(homedir(), ".wave", "plugin-mods");
    this.facts = options.sessionFacts ?? {
      sessionId: () => options.sessionId,
      workspaceRoot: () => options.workdir?.() ?? process.cwd(),
      model: () => "",
      // 没接入口就不画面板：宁可按「没人看得见」降级，也不编一个 desktop。
      surfaces: () => [],
      sessionMessages: () => [],
      env: () => undefined,
      // `key` 由数据源自己取（它有那份配置）；兜底没配置可查，所以带 key 时
      // 与「没这一项」同义。
      settings: async (query) => (query.key === undefined ? {} : undefined),
      // 没接数据源时三个清单都是空的、轮数 0、没有仓库、版本取当前包版本 ——
      // 「读不到」不编一个值出来。
      turns: () => 0,
      repo: () => null,
      version: () => engineVersion(),
      configRows: () => [],
      toolInfos: () => [],
      agentInfos: () => [],
      // 影子的公共字段：没数据源时给空串，不编一个路径出来。
      transcriptPath: () => "",
      permissionMode: () => "default",
    };
    // cwd 现取现用：`cd` 之后起的脚本落在新目录。
    this.processes = new ModProcessManager(
      () => options.workdir?.() ?? process.cwd(),
    );
  }

  /** 接上 prompt 投递通道（见 `promptSubmitter`）。 */
  setPromptSubmitter(fn: (text: string) => Promise<void>): void {
    this.promptSubmitter = fn;
  }

  /** 接上「收掉一轮」的通道（见 `turnAborter`）。 */
  setTurnAborter(fn: (turnId: string) => void): void {
    this.turnAborter = fn;
  }

  /** 接上用量快照（见 `sessionUsageProvider`）。 */
  setSessionUsageProvider(fn: () => ModSessionUsage): void {
    this.sessionUsageProvider = fn;
  }

  /** 接上对话流的写入口（见 `logSink`）。 */
  setLogSink(fn: (text: string) => void): void {
    this.logSink = fn;
  }

  /** 接上提问通道（见 `askUserHandler`）。 */
  setAskUser(
    fn: (
      question: string,
      options: { labels: string[]; header?: string; multiSelect?: true },
    ) => Promise<string>,
  ): void {
    this.askUserHandler = fn;
  }

  /** 接上命令表（见 `commandBridge`）。 */
  setCommandBridge(bridge: ModCommandBridge): void {
    this.commandBridge = bridge;
  }

  /** 接上工具表（见 `toolBridge`）。 */
  setToolBridge(bridge: ModToolBridge): void {
    this.toolBridge = bridge;
  }

  /** 接上子代理出口（见 `agentBridge`）。 */
  setAgentBridge(bridge: ModAgentBridge): void {
    this.agentBridge = bridge;
  }

  /** 接上模型调用出口（见 `modelBridge`）。 */
  setModelBridge(bridge: ModModelBridge): void {
    this.modelBridge = bridge;
  }

  /** 接上「摆建议」通道（见 `promptSuggestionSink`）。 */
  setPromptSuggestionSink(
    fn: (request: {
      text: string;
      plugin: string;
    }) => Promise<{ isShown: boolean }>,
  ): void {
    this.promptSuggestionSink = fn;
  }

  /** 接上「填草稿」通道（见 `promptFiller`）。 */
  setPromptFiller(
    fn: (request: {
      text: string;
      mode: ModPromptFillMode;
    }) => Promise<boolean>,
  ): void {
    this.promptFiller = fn;
  }

  /** 接上「读草稿」通道（见 `promptDraftReader`）。 */
  setPromptDraftReader(fn: () => Promise<ModPromptBox>): void {
    this.promptDraftReader = fn;
  }

  /** 接上「工具行下面贴一行」的出口（见 `noticeSink`）。 */
  setNoticeSink(
    fn: (plugin: string, toolUseId: string, text: string | null) => void,
  ): void {
    this.noticeSink = fn;
  }

  /** 接上剪贴板通道（见 `copySink`）。 */
  setCopySink(
    fn: (request: {
      text: string;
      surface?: ModRenderSurface;
    }) => Promise<ModUiCopyResult>,
  ): void {
    this.copySink = fn;
  }

  /**
   * 编译并实例化所有插件里的 mod。
   *
   * 一个插件下的 mod 共享一次编译（`import "./shared"` 要能解析到同目录的
   * 兄弟文件），但每个 mod 一个沙箱实例。
   */
  async loadFromPlugins(plugins: Plugin[]): Promise<void> {
    for (const plugin of plugins) {
      const modFiles = plugin.mods ?? [];
      if (modFiles.length === 0) continue;

      const esbuild = getEsbuild();
      if (!esbuild) {
        for (const mod of modFiles) {
          this.mods.set(mod.id, {
            mod,
            plugin: plugin.name,
            error: "TSX mod 需要 esbuild（运行时依赖尚未安装）",
          });
        }
        logger.warn(
          `[Wave] 插件 ${plugin.name} 带 mod，但 esbuild 不可用，已跳过`,
        );
        continue;
      }

      const sources: ModSourceFile[] = [];
      for (const mod of modFiles) {
        try {
          sources.push({
            path: mod.path,
            source: fs.readFileSync(mod.path, "utf-8"),
          });
        } catch (error) {
          this.mods.set(mod.id, {
            mod,
            plugin: plugin.name,
            error: `读取失败：${errorMessage(error)}`,
          });
        }
      }

      const outcomes = await compileMods(esbuild, sources);
      // 该插件全部文件的编译产物：每个 mod 的沙箱都能解析到兄弟文件。
      const compiled: CompiledModule[] = [];
      for (const [filePath, outcome] of outcomes) {
        if (outcome.code !== undefined) {
          compiled.push({ path: filePath, code: outcome.code });
        }
      }

      for (const mod of modFiles) {
        if (this.mods.has(mod.id)) continue;
        const outcome = outcomes.get(mod.path);
        if (!outcome?.code) {
          this.mods.set(mod.id, {
            mod,
            plugin: plugin.name,
            error: outcome?.error ?? "编译失败",
          });
          logger.warn(
            `[Wave] mod 编译失败：${mod.id}\n${outcome?.error ?? ""}`,
          );
          continue;
        }
        try {
          const runtime = new ModRuntime(
            {
              pluginName: plugin.name,
              // `$.plugin.root`：插件自己的目录（`plugin.json` 那个），不是会话
              // 工作目录 —— 后者会随 `cd` 动，拼出来的插件资源必然找不到。
              pluginRoot: plugin.path,
              openPane: (paneId, title, focus) =>
                this.openPane(mod.id, paneId, title, focus),
              closePane: (paneId) => this.closePane(mod.id, paneId),
              listPanes: () => this.listPanes(mod.id),
              surfaces: () => this.facts.surfaces(),
              invalidate: () => this.invalidate(mod.id),
              setStatus: (text) => this.publishStatus(mod.id, text),
              showToast: (text, timeoutMs) =>
                this.publishToast(mod.id, text, timeoutMs),
              appendLog: (text) => this.appendLog(text),
              askUser: (question, options) => this.askUser(question, options),
              registerCommand: (spec) =>
                this.registerCommand(mod.id, plugin.name, spec),
              listCommands: () => this.commandBridge?.list() ?? [],
              runCommand: (command, args) => this.runCommand(command, args),
              stateGet: (key) => this.stateFor(mod.id).get(key),
              stateSet: (key, value) => {
                this.stateFor(mod.id).set(key, value);
              },
              storeGet: (key) => this.readStore(plugin.name)[key],
              storeSet: (key, value) => {
                const store = this.readStore(plugin.name);
                store[key] = value;
                this.writeStore(plugin.name, store);
              },
              storeDelete: (key) => {
                const store = this.readStore(plugin.name);
                delete store[key];
                this.writeStore(plugin.name, store);
              },
              storeKeys: () => Object.keys(this.readStore(plugin.name)),
              startTimer: (kind, ms, fn) =>
                this.startTimer(mod.id, kind, ms, fn),
              spawnProcess: (options) => this.processes.spawn(mod.id, options),
              runProcess: (argv, runOptions) =>
                this.processes.run(mod.id, argv, runOptions),
              // `$.fs` 的相对路径基准与 `spawn` 的 cwd 同一口径：现取现用，
              // `cd` 过之后读的相对路径跟着落在新目录。
              workdir: () => this.options.workdir?.() ?? process.cwd(),
              submitPrompt: (text) => this.submitPrompt(mod.id, text),
              fillPrompt: (request) => this.fillPrompt(request),
              sessionUsage: () => this.usageSnapshot(),
              sessionId: () => this.facts.sessionId(),
              workspaceRoot: () => this.facts.workspaceRoot(),
              model: () => this.facts.model(),
              sessionTurns: () => this.facts.turns(),
              sessionRepo: () => this.facts.repo(),
              sessionVersion: () => this.facts.version(),
              listConfigRows: () => this.facts.configRows(),
              listToolInfos: () => this.facts.toolInfos(),
              listAgentInfos: () => this.facts.agentInfos(),
              registerTool: (spec) =>
                this.registerModTool(mod.id, plugin.name, spec),
              checkTool: (request) => this.checkModTool(request),
              callTool: (request) => this.callModTool(request),
              spawnAgent: (args) =>
                this.spawnModAgent(mod.id, plugin.name, args),
              completeModel: (request) =>
                this.completeModModel(mod.id, plugin.name, request),
              suggestPrompt: (request) => this.suggestPrompt(request),
              listSessionMessages: () => this.facts.sessionMessages(),
              readPromptDraft: () => this.readPromptDraft(),
              showNotice: (toolUseId, text) =>
                this.noticeSink?.(plugin.name, toolUseId, text),
              copyText: (request) => this.copyText(request),
              envGet: (name) => this.facts.env(name),
              settingsRead: (query) => this.facts.settings(query),
              sleep: (ms, signal) => this.startSleep(mod.id, ms, signal),
              turnAbort: (turnId) => this.abortTurn(mod.id, turnId),
            },
            mod.path,
            compiled,
            // `register(on, options)` 拿到的就是它（`plugin.json` 的 userConfig
            // 当前取值），spec「兼容社区 mod」。
            plugin.modOptions,
          );
          const registered = await runtime.load();
          if (!registered) {
            // 被 import 的共享模块，不是面板入口。
            logger.debug(
              `[Wave] ${mod.id} 没有导出 register，作为依赖模块保留`,
            );
            continue;
          }
          this.mods.set(mod.id, { mod, plugin: plugin.name, runtime });
          logger.info(`[Wave] 已加载 mod ${mod.id}`);
        } catch (error) {
          const message = errorMessage(error);
          this.mods.set(mod.id, { mod, plugin: plugin.name, error: message });
          logger.warn(`[Wave] mod 加载失败：${mod.id}：${message}`);
        }
      }
    }
  }

  /** 触发所有 mod 的 `session.start`。 */
  async startSession(): Promise<void> {
    for (const [modId, loaded] of this.mods) {
      if (!loaded.runtime) {
        // 加载或编译失败：开一个只承载错误摘要的面板。否则用户看到的是「面板
        // 没出现」，而失败的原文只在日志里（spec「限额」「加载纪律」都要求错误
        // 可见，不静默丢弃）。
        if (loaded.error) this.openErrorPane(loaded.mod, loaded.error);
        continue;
      }
      const result = await loaded.runtime.callHook("session.start", {
        sessionId: this.options.sessionId,
        modId,
      });
      if (!result.ok) {
        logger.warn(`[Wave] ${modId} 的 session.start 失败：${result.error}`);
      } else if (this.listPanes(modId).length === 0) {
        // 只注册 ui.render 不构成「要画」的请求：面板得由 mod 自己 open。
        logger.debug(
          `[Wave] ${modId} 未申请面板（没有调用 $.ui.open），本会话不显示`,
        );
      }
    }
  }

  /**
   * 派发一次只读事件（`turn.start` / `turn.step` / `turn.complete` /
   * `session.compact`、以及全部 `classic.*` 镜像，spec「事件」「轮次内外的
   * 事件」「完成与审批的观察」「影子事件」）。
   *
   * 不等 mod、也不返回 Promise：这些时刻都压在宿主的关键路径上（轮次起收尾、
   * 每次请求之前、工具刚跑完、审批卡片即将弹出），mod 在里面做网络上报不能把
   * 用户的中断、下一个请求或那道审批拖住。钩子失败、超时只记一条 warn —— 事件
   * 丢了就丢了，宿主不回滚、不重试、不排队（瞬时事件本来就没有「补发」这回事）。
   * 要等返回值的另外几条：`prompt.submit`（见 {@link collectPromptContext}）、
   * `session.end`（见 {@link endSession}）、`classic.Stop`（见
   * {@link collectStopContext}）、以及决策型的 `tool.call`（见
   * {@link dispatchToolCall}）。
   */
  notifyMods(
    event:
      | "turn.start"
      | "turn.step"
      | "turn.complete"
      | "session.measure"
      | "session.compact"
      | ClassicEventName,
    payload:
      | ModTurnStartEvent
      | ModTurnStepEvent
      | ModTurnCompleteTrigger
      | ModSessionMeasureTrigger
      | ModSessionCompactEvent
      | ModPermissionRequestEvent
      | ModClassicTrigger<ModClassicEvent>,
  ): void {
    if (this.disposed) return;
    // `session.measure` 的载荷里带一份用量快照（社区 mod 在这个事件里读用量，
    // 不自己轮询）：快照的数据源挂在 agent 上，只有这里拿得到。
    let enriched: unknown = payload;
    if (event === "session.measure") {
      enriched = {
        ...(payload as ModSessionMeasureTrigger),
        ...this.usageSnapshot(),
      };
    } else if (event === "turn.complete") {
      // 社区的 `turn.complete` 读 Claude Code 那份 snake_case 的 usage：补上
      // 别名（见 `withCommunityUsage`），我们自己的四个字段照旧给。
      const complete = payload as ModTurnCompleteTrigger;
      enriched = {
        ...complete,
        usage: withCommunityUsage(complete.usage, this.usageSnapshot().model),
      };
    } else if (event.startsWith("classic.")) {
      enriched = this.withClassicBase(
        event.slice("classic.".length),
        payload as object,
      );
    }
    for (const [modId, loaded] of this.mods) {
      const runtime = loaded.runtime;
      if (!runtime) continue;
      void runtime.callHook(event, enriched).then((result) => {
        if (!result.ok) {
          logger.warn(`[Wave] ${modId} 的 ${event} 失败：${result.error}`);
        }
      });
    }
  }

  /**
   * 派发 `turn.step` 并等它答完：这次请求到底用哪个模型。
   *
   * 与 {@link notifyMods} 里那条 fire-and-forget 的差别就是 Claude Code 的
   * **生成器形状**：`turn.step` 是它仅有的两个生成器事件之一（另一个是
   * `process.spawn`），链上的 mod 可以 `yield* next(e)` 让下游先产出、也可以
   * `return { ...e, model }` 把这次请求换到另一个模型上 —— 所以宿主必须等，
   * 并把链尾那份事件（不是进场那份）带回去。
   *
   * 只认 `model` / `effort` 两个字段：`turnId` / `index` / `messageCount` 是宿主
   * 的事实，mod 改不动「现在是第几步」。`model` 必须是非空字符串（CC 同口径），
   * 给了别的就按没改。
   */
  async dispatchTurnStep(event: ModTurnStepEvent): Promise<ModTurnStepEvent> {
    if (this.disposed) return event;
    return this.runValueHookChain<ModTurnStepEvent>(
      "turn.step",
      event,
      (current) => mergeTurnStep(event, current),
      (_modId, value, fallback) => mergeTurnStep(fallback, value),
    );
  }

  /**
   * `classic.*` 的公共五字段（spec「影子事件」）。
   *
   * 每条事件的调用点只写它自己那几个字段，公共值统一在这里补；调用点显式给的
   * 值优先（`classic.PermissionRequest` 就是自己带着完整载荷进来的）。
   *
   * `permission_mode` 是公共的而不是某几个事件专属：Claude Code 的
   * `createBaseHookInput(permissionMode)` 把它写进**每条** hook 的 stdin，社区守
   * 卫（jr-deploy-guard）靠它判断「此刻有没有人会被问到」。
   */
  private withClassicBase(name: string, payload: object): unknown {
    return {
      session_id: this.facts.sessionId(),
      transcript_path: this.facts.transcriptPath(),
      cwd: this.options.workdir?.() ?? "",
      permission_mode: this.currentPermissionMode(),
      hook_event_name: name,
      ...payload,
    };
  }

  /**
   * 派发 `classic.Stop` 并收集插件塞回来的 `additionalContext`（spec「一轮收尾
   * 时的非错误反馈」）。
   *
   * 与 {@link notifyMods} 的唯一区别是要等返回值：这一轮算不算收尾，取决于插件
   * 有没有话要说。等是有边界的 —— 每个 mod 各自受 5 秒钩子上限约束，失败或超时
   * 只记一条 warn（这一轮照常收尾，其余 mod 的反馈照收）。返回值按加载顺序拍平，
   * 条数与字数沿用 `prompt.submit` 那份限额。
   */
  async collectStopContext(
    payload: ModClassicTrigger<ModClassicStopEvent>,
  ): Promise<string[]> {
    if (this.disposed) return [];
    const event = this.withClassicBase("Stop", payload);
    const parts = await Promise.all(
      [...this.mods].map(async ([modId, loaded]) => {
        const runtime = loaded.runtime;
        if (!runtime) return [];
        const result = await runtime.callHook("classic.Stop", event);
        if (!result.ok) {
          logger.warn(`[Wave] ${modId} 的 classic.Stop 失败：${result.error}`);
          return [];
        }
        const returned = result.value;
        if (
          typeof returned !== "object" ||
          returned === null ||
          Array.isArray(returned)
        ) {
          return [];
        }
        const value = returned as ModStopHookResult & Record<string, unknown>;
        // `decision: "block"` / `preventContinuation` 是 Claude Code 另外两条
        // 通道，我们只收 `additionalContext`（spec 同一小节）。
        if (
          value.decision !== undefined ||
          value.preventContinuation !== undefined
        ) {
          logger.warn(
            `[Wave] ${modId} 的 classic.Stop 返回了 decision/preventContinuation：只支持 { additionalContext }，那两项被忽略`,
          );
        }
        const context = value.additionalContext;
        if (context === undefined) return [];
        if (
          !Array.isArray(context) ||
          context.some((item) => typeof item !== "string")
        ) {
          logger.warn(
            `[Wave] ${modId} 的 classic.Stop 的 additionalContext 必须是字符串数组，已忽略`,
          );
          return [];
        }
        return context
          .map((item: string) => item.trim())
          .filter((item: string) => item.length > 0);
      }),
    );
    const merged = parts.flat();
    const limited: string[] = [];
    let chars = 0;
    for (const part of merged) {
      if (limited.length >= MOD_LIMITS.promptContextMaxItems) break;
      if (chars + part.length > MOD_LIMITS.promptContextChars) break;
      limited.push(part);
      chars += part.length;
    }
    if (limited.length < merged.length) {
      logger.warn(
        `[Wave] classic.Stop 的 additionalContext 有 ${merged.length} 条，超过限额，只用了前 ${limited.length} 条`,
      );
    }
    return limited;
  }

  /**
   * 派发 `tool.call`：这次调用**执行之前**问一遍插件，被拦下就不跑（spec
   * 「拦下一次工具调用」）。
   *
   * 两种答法：`{ deny }` 时 caller 把这段文本当成工具的错误结果交回模型；
   * `{ result }` 时 caller 直接把这份值当成工具结果（见 `ModToolCallDecision`）；
   * 都没有就是「没人拦」。
   *
   * `options.run` 让 `next(e)` **真的执行**这次调用（CC 的形状：`tool.call`
   * 的 next 是「往下走」，走到链尾就该轮到工具）。宿主传进来的 thunk 自己负责
   * 幂等与「先过 settings 的 PreToolUse」—— mod 的 `next` 不该成为绕过审批的
   * 后门。插件自己注册的工具没有宿主侧执行体，那时不传 `run`（链尾仍是空对象）。
   *
   * `classic.PreToolUse` 是这条链的**另一个名字**：同一时刻、同一份信封、同一
   * 个 `{ deny }`，`tool.call` 没人拦时接着问它（spec「影子事件」里那条
   * 「先 `tool.call` 再它」）。CC 把两者做成两层（一个在 mods 面、一个是
   * settings 钩子的镜像），社区里只写后者的那半（chronicle、FlowCTL）就靠这一
   * 步才真的拦得住。
   */
  async dispatchToolCall(
    event: ModToolCallEvent,
    options: {
      signal?: AbortSignal;
      /** 链尾的执行体：`next(e)` 走到最后一个 mod 之后调它，返回这次调用的结果。 */
      run?: () => Promise<unknown>;
    } = {},
  ): Promise<ModToolCallDecision> {
    if (this.disposed) return {};
    // 链尾把结果包成 `{ result }`：mod 的 `await next(e)` 读 `below.result` 就是
    // 这次调用的结果（与它自己 `return { result }` 的形状一致）。
    const run = options.run;
    const decision = await this.runToolHookChain(
      "tool.call",
      event,
      run ? { run: async () => ({ result: await run() }) } : {},
      options.signal,
    );
    if (decision.deny !== undefined) return { deny: decision.deny };
    if ("result" in decision) return { result: decision.result };
    // 信封就是同一份（`tool` / `tool_use_id` / `input` + 顶层铺开的参数）：
    // 差别只在这条链认的是另一个钩子名。
    const classic = await this.runToolHookChain(
      "classic.PreToolUse",
      event as ModClassicPreToolUseEvent,
      {},
      options.signal,
    );
    return classic.deny === undefined ? {} : { deny: classic.deny };
  }

  /**
   * 派发 `tool.register`：每个 mod 一次，赶在第一次请求之前（spec「把我们自己的
   * 工具交给模型」）。
   *
   * 返回值忽略 —— handler 里该做的是调 `$.tool.register`。所以这里只等它们跑
   * 完，失败的记一条 warn，不阻塞谁。
   */
  async dispatchToolRegister(signal?: AbortSignal): Promise<void> {
    if (this.disposed) return;
    for (const [modId, loaded] of this.mods) {
      const runtime = loaded.runtime;
      if (!runtime) continue;
      if (!runtime.matchesHook("tool.register", {})) continue;
      const result = await runtime.callHook("tool.register", {}, { signal });
      if (!result.ok) {
        logger.warn(`[Wave] ${modId} 的 tool.register 失败：${result.error}`);
      }
    }
  }

  /**
   * 派发 `agent.offer`：引擎把一个子代理类型摆到模型面前（spec「派子代理」）。
   *
   * 清单与派发各触发一次：`{ isOffered: false }` 让这个类型既不出现在 Agent 工
   * 具的清单里、也拒绝派发。链尾是宿主的 `{ isOffered: true }`。
   */
  async dispatchAgentOffer(
    event: { agent: string; description: string; source: string },
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (this.disposed) return true;
    const result = await this.runValueHookChain<{ isOffered: boolean }>(
      "agent.offer",
      event,
      (current) => {
        if (!isPlainRecord(current)) return { isOffered: true };
        return { isOffered: current.isOffered !== false };
      },
      (modId, value, fallback) => {
        if (!isPlainRecord(value) || typeof value.isOffered !== "boolean") {
          logger.warn(
            `[Wave] ${modId} 的 agent.offer 只认 { isOffered: boolean }：这一条被忽略`,
          );
          return fallback;
        }
        return { isOffered: value.isOffered };
      },
      signal,
    );
    return result.isOffered;
  }

  /**
   * 派发 `agent.spawn`：**任何**子代理起跑之前（spec「派子代理」）。
   *
   * 两种答案：`{ deny }` 拒绝这一次派发、`{ model, agentId? }` 是它起来之后的
   * 事实。链尾就是真正的派发（`tail`），所以没插件注册时它照常跑 —— 与
   * `tool.call` 同一条纪律，只是这里 `next(e)` 交回的不是结果而是「它起来了」。
   */
  async dispatchAgentSpawn(
    event: unknown,
    tail: (event: unknown) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<{ deny?: string; value?: { model: string; agentId?: string } }> {
    if (this.disposed) return {};
    const loaded = [...this.mods.values()].filter((item) => item.runtime);
    const fromIndex = async (
      index: number,
      current: unknown,
    ): Promise<unknown> => {
      for (let i = index; i < loaded.length; i += 1) {
        const item = loaded[i]!;
        const runtime = item.runtime!;
        if (!runtime.matchesHook("agent.spawn", current)) continue;
        let inner: unknown;
        const result = await runtime.callHook("agent.spawn", current, {
          signal,
          engine: async (nextEvent) => {
            // `next()` 不带参数 = 「按现在这份继续」。漏了兜底，下层收到的是
            // `undefined`，链尾也按 `tail(undefined)` 算，整段事件凭空消失
            // （`runtime.runChain` 同口径）。
            inner = await fromIndex(
              i + 1,
              nextEvent === undefined ? current : nextEvent,
            );
            return inner;
          },
        });
        if (!result.ok) {
          // 钩子挂掉按 fail-open 放行（与其余守卫同一条纪律）：一个坏插件不能
          // 让用户永远派不出子代理。
          logger.warn(
            `[Wave] ${item.mod.id} 的 agent.spawn 失败：${result.error}`,
          );
          if (inner !== undefined) return inner;
          continue;
        }
        // 调过 `next(e)` 之后自己那份返回值不再算数：子代理已经起来了，
        // 事后再 deny 撤不回它（与 `tool.call` 同一条）。
        if (inner !== undefined) return inner;
        // 没调 `next` 也没给答复 = 这一层只是看看：接着问下一个 mod，而不是
        // 就此派发 —— 否则排在后面的守卫 mod 永远轮不到。
        if (result.value === undefined) continue;
        return result.value;
      }
      return tail(current);
    };
    const answer = await fromIndex(0, event);
    if (isDeny(answer)) return { deny: answer.deny };
    if (isPlainRecord(answer) && typeof answer.model === "string") {
      return {
        value: {
          model: answer.model,
          ...(typeof answer.agentId === "string"
            ? { agentId: answer.agentId }
            : {}),
        },
      };
    }
    // 谁都没答出合法形状：不把 `undefined` 当结果交出去（那会让上层 TypeError），
    // 按「没起来」报。
    logger.warn(
      "[Wave] agent.spawn 链没有给出 { model, agentId } 也没有 deny，按拒绝处理",
    );
    return { deny: "插件没有放行这次子代理派发" };
  }

  /**
   * 派发 `prompt.edit`：用户在输入框里做完一次编辑（spec「输入框里的建议与焦
   * 点」）。
   *
   * 链尾是宿主算好的 `{ text, cursor }`；`next({ ...e, text })` 就是「把这次编辑
   * 应用到另一份草稿上」，不调 `next` 直接返回 `{ text: e.text, cursor: e.cursor }`
   * 等于吃掉这次按键。
   */
  async dispatchPromptEdit(
    event: ModPromptEditEvent,
    tail: (current: unknown) => { text: string; cursor: number },
    signal?: AbortSignal,
  ): Promise<{ text: string; cursor: number }> {
    if (this.disposed) return tail(event);
    return this.runValueHookChain<{ text: string; cursor: number }>(
      "prompt.edit",
      event,
      tail,
      (modId, value, fallback) => {
        if (!isPlainRecord(value) || typeof value.text !== "string") {
          logger.warn(
            `[Wave] ${modId} 的 prompt.edit 只认 { text, cursor }：这一条被忽略`,
          );
          return fallback;
        }
        const cursor =
          typeof value.cursor === "number" && Number.isFinite(value.cursor)
            ? Math.min(Math.max(0, Math.trunc(value.cursor)), value.text.length)
            : value.text.length;
        return { text: value.text, cursor };
      },
      signal,
    );
  }

  /**
   * 派发 `prompt.suggest`：一个建议要摆进输入框（spec「输入框里的建议与焦
   * 点」）。
   *
   * 答案只说「摆没摆上」；换一个建议靠 `next({ ...e, text })`。链尾是宿主的
   * 「摆上去」——它可能因为输入框已有字、一轮在跑而答 `false`。
   */
  async dispatchPromptSuggest(
    event: ModPromptSuggestEvent,
    tail: (
      current: unknown,
    ) => { isShown: boolean } | Promise<{ isShown: boolean }>,
    signal?: AbortSignal,
  ): Promise<{ isShown: boolean; text: string }> {
    if (this.disposed) return { isShown: false, text: event.text };
    // 这条链不走 `runValueHookChain`：链尾是**一次宿主往返**（问输入框摆不
    // 摆），只有真的没人否掉时才该发生。放进去会让 `{ isShown: false }` 的否
    // 决晚于「已经摆上去了」。
    const loaded = [...this.mods.values()].filter((item) => item.runtime);
    let submitted = event.text;
    const fromIndex = async (
      index: number,
      current: unknown,
    ): Promise<{ isShown: boolean }> => {
      for (let i = index; i < loaded.length; i += 1) {
        const item = loaded[i]!;
        const runtime = item.runtime!;
        if (!runtime.matchesHook("prompt.suggest", current)) continue;
        let inner: { isShown: boolean } | undefined;
        const result = await runtime.callHook("prompt.suggest", current, {
          signal,
          engine: async (nextEvent) => {
            // `next()` 不带参数 = 「按现在这份继续」。漏了兜底，下层收到的是
            // `undefined`，链尾也按 `tail(undefined)` 算，整段事件凭空消失
            // （`runtime.runChain` 同口径）。
            inner = await fromIndex(
              i + 1,
              nextEvent === undefined ? current : nextEvent,
            );
            return inner;
          },
        });
        if (!result.ok) {
          logger.warn(
            `[Wave] ${item.mod.id} 的 prompt.suggest 失败：${result.error}`,
          );
          if (inner !== undefined) return inner;
          continue;
        }
        // 交给下面之后自己那份不算数（与其余几条链同一条纪律）。
        if (inner !== undefined) return inner;
        // 没调 `next` 也没表态：只是看看，接着问下一个。
        if (result.value === undefined) continue;
        const value = result.value;
        if (!isPlainRecord(value) || typeof value.isShown !== "boolean") {
          logger.warn(
            `[Wave] ${item.mod.id} 的 prompt.suggest 只认 { isShown: boolean }：这一条被忽略`,
          );
          continue;
        }
        // `{ isShown }` 就是这条事件的答案，两种取值都算数：`false` 是不摆，
        // `true` 是「摆上」—— 宿主照旧按自己的输入框状态尽力而为，但不再往下
        // 问。CC 的这条事件以 `isShown` 为结果键，谁给出合法值谁就收敛。
        return { isShown: value.isShown };
      }
      // 链尾按走到那里的那份事件算：`next({ ...e, text })` 换过的建议才是要摆
      // 上去的那条。
      if (isPlainRecord(current) && typeof current.text === "string") {
        submitted = current.text;
      }
      return await tail(current);
    };
    const result = await fromIndex(0, event);
    return { isShown: result.isShown, text: submitted };
  }

  /**
   * 派发 `tool.check`：宿主已经算出决定之后，让插件**换掉**它（spec「第二判定
   * 源」）。
   *
   * 与 `tool.call` 那条链的分工：那条回答「拦不拦」，这条回答「允不允许」。
   * 三个方向都算数，包括放宽 —— CC 的契约是 `return any { decision }`（官方示例
   * 就是 `() => ({ decision: "allow" })`），真插件用它给自家工具免审批（sotto）。
   */
  async dispatchToolCheck(
    event: ModToolCheckEvent,
    signal?: AbortSignal,
  ): Promise<{ decision: ModToolCheckDecision; reason?: string }> {
    const base: { decision: ModToolCheckDecision; reason?: string } = {
      decision: event.decision,
      reason: event.reason,
    };
    if (this.disposed) return base;
    return this.runValueHookChain(
      "tool.check",
      event,
      (current) => {
        // 链尾按链尾收到的事件取值：`next({ ...e, decision: "deny" })` 之后没人
        // 再注册时，这个决定就是最终结果。
        if (!isPlainRecord(current)) return base;
        const decision = current.decision;
        if (decision !== "allow" && decision !== "ask" && decision !== "deny") {
          return base;
        }
        const reason =
          typeof current.reason === "string" ? current.reason : base.reason;
        return { decision, ...(reason === undefined ? {} : { reason }) };
      },
      (modId, value, fallback) => {
        if (!isPlainRecord(value)) {
          logger.warn(
            `[Wave] ${modId} 的 tool.check 返回了不合法的结果：按拒绝处理`,
          );
          return {
            decision: "deny",
            reason: "tool.check returned no decision",
          };
        }
        const next = value.decision;
        if (next !== "allow" && next !== "ask" && next !== "deny") {
          logger.warn(
            `[Wave] ${modId} 的 tool.check 返回了不合法的 decision：按拒绝处理`,
          );
          return {
            decision: "deny",
            reason: "tool.check returned no valid decision",
          };
        }
        // 三个方向都算数（含放宽）。CC 的契约就是 `return any { decision }`，
        // 官方示例是 `on("tool.check", { tool: "Read" }, () => ({ decision: "allow" }))`，
        // 真插件拿它给自家的 `mcp__x__*` 工具免审批（sotto）。把放宽挡掉等于
        // 让这条钩子对它的主要用途失效。
        //
        // 换了档才换理由：`allow → allow` 不该把宿主的理由冲掉。
        const reason =
          typeof value.reason === "string"
            ? value.reason
            : next === fallback.decision
              ? fallback.reason
              : undefined;
        return { decision: next, reason };
      },
      signal,
      // 抛错 / 超时也是拒绝：CC 给这条链的兜底就是
      // `(e) => ({ decision: "deny", reason: e })`，理由是那条错误本身。这是
      // 全部事件里唯一 fail-closed 的一处 —— 守卫坏了要挡住工具，不是放行。
      (modId, error) => {
        logger.warn(
          `[Wave] ${modId} 的 tool.check 失败，按拒绝处理：${String(error)}`,
        );
        return {
          decision: "deny",
          reason: `tool.check hook failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      },
    );
  }

  /**
   * `$.tool.check`：跑一遍 `tool.check` 链（spec「主动问一次工具面」）。
   *
   * 基底决定是 `allow`：没有真实调用时宿主没算过规则与权限模式，唯一诚实的起
   * 点是「还没人拦」。`tool_use_id` 编一个稳定的临时值 —— 事件形状要求它，但
   * 它不会出现在任何 `ui.notice` 上。
   */
  async checkModTool(request: {
    tool: string;
    input?: unknown;
  }): Promise<{ decision: ModToolCheckDecision; reason?: string }> {
    return this.dispatchToolCheck({
      tool: request.tool,
      tool_use_id: `mod:${request.tool}`,
      input: request.input,
      decision: "allow",
    });
  }

  /**
   * `$.tool.call`：跑一遍 `tool.call` + `classic.PreToolUse` 链，只回「有没有
   * 人拦」（spec「主动问一次工具面」）。
   *
   * **不传 `run`**：mod 主动发起时没有宿主侧执行体，链尾是空对象 —— 这条方法
   * 不会真的执行工具，想做事用 `$.process` / `$.fs` / `$.http`。
   */
  async callModTool(request: {
    tool: string;
    input?: unknown;
  }): Promise<{ deny?: string }> {
    const decision = await this.dispatchToolCall({
      tool: request.tool,
      tool_use_id: `mod:${request.tool}`,
      input: request.input,
    });
    return decision.deny === undefined ? {} : { deny: decision.deny };
  }

  /**
   * 派发 `prompt.compose`：让插件换掉整份系统提示词的段表（spec「系统提示词
   * 与附件」）。
   *
   * 链尾是宿主自己拼出来的段表。返回的段表要过一遍形状校验：缺 `id` / `text`
   * 的段直接丢掉（一段拼不出来的提示词比少一段更坏）。
   */
  async collectPromptSections(
    base: readonly ModPromptSection[],
    signal?: AbortSignal,
  ): Promise<ModPromptSection[]> {
    if (this.disposed) return [...base];
    // 链尾与 normalize 共用这一份校验：`next({ ...e, sections })` 传下来的段表
    // 也得过同一遍形状检查，否则改事件这条路就成了绕开校验的后门。
    const readSections = (raw: unknown): ModPromptSection[] | undefined => {
      if (!Array.isArray(raw)) return undefined;
      const sections: ModPromptSection[] = [];
      for (const item of raw.slice(0, MOD_LIMITS.promptSections)) {
        if (!isPlainRecord(item)) continue;
        if (typeof item.id !== "string" || typeof item.text !== "string") {
          continue;
        }
        sections.push({
          id: item.id,
          text: item.text.slice(0, MOD_LIMITS.promptSectionChars),
          scope: item.scope === "session" ? "session" : "shared",
        });
      }
      return sections;
    };
    return this.runValueHookChain(
      "prompt.compose",
      { sections: base },
      (current) => {
        const raw = isPlainRecord(current) ? current.sections : undefined;
        return readSections(raw) ?? [...base];
      },
      (modId, value, fallback) => {
        if (!isPlainRecord(value) || !Array.isArray(value.sections)) {
          return fallback;
        }
        const raw = value.sections as unknown[];
        if (raw.length > MOD_LIMITS.promptSections) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.compose 给了 ${raw.length} 段，超过上限，只用了前 ${MOD_LIMITS.promptSections} 段`,
          );
        }
        if (
          raw.some(
            (item) =>
              isPlainRecord(item) &&
              typeof item.text === "string" &&
              item.text.length > MOD_LIMITS.promptSectionChars,
          )
        ) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.compose 给了超过 ${MOD_LIMITS.promptSectionChars} 字符的提示词段，已截断`,
          );
        }
        return readSections(raw) ?? fallback;
      },
      signal,
    );
  }

  /**
   * 派发 `prompt.section`：逐段问下去（spec「系统提示词与附件」）。
   *
   * 返回 `null` 表示这一段不出现（`{ text: null }`），与「空字符串」是两件事。
   */
  async collectPromptSection(
    section: ModPromptSection,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.disposed) return section.text;
    // 交下去（也给 `next(e)`）的是 `{ text }` 而不是裸字符串：CC 的这条契约
    // 就是这个对象，真插件写的是 `const s = await next(e); return { text: s.text + … }`
    // —— 给字符串会让 `s.text` 变 undefined。
    const result = await this.runValueHookChain<{ text: string | null }>(
      "prompt.section",
      { name: section.id, text: section.text, scope: section.scope },
      // 链尾按链尾收到的事件取值：`next({ ...e, text })` 之后没人再注册时，
      // 改过的那份就是要用的。
      (current) => {
        if (!isPlainRecord(current) || !("text" in current)) {
          return { text: section.text };
        }
        if (current.text === null) return { text: null };
        return {
          text: typeof current.text === "string" ? current.text : section.text,
        };
      },
      (modId, value, fallback) => {
        if (isPlainRecord(value) && "text" in value) {
          if (value.text === null) return { text: null };
          if (typeof value.text === "string") return { text: value.text };
        }
        // 宽容一档：直接返回字符串的也认（写起来更短，但拿不到 `next` 的结果）。
        if (typeof value === "string") return { text: value };
        logger.warn(
          `[Wave] ${modId} 的 prompt.section 只认 { text } / { text: null }：这一段按原样用`,
        );
        return fallback;
      },
      signal,
    );
    return result.text;
  }

  /**
   * 派发 `prompt.context`：每条会话一次的上下文块（spec「系统提示词与附件」）。
   *
   * 与 {@link collectPromptContext}（`prompt.submit` 的每轮注入）是两件事：
   * 那条每轮都能塞、只作用于本轮；这条一条会话只有一次机会。
   */
  async collectSessionContextBlocks(
    signal?: AbortSignal,
  ): Promise<ModPromptContextBlock[]> {
    if (this.disposed) return [];
    // 链尾与 normalize 共用这一份归一化：`next({ ...e, blocks })` 传下来的块表
    // 也得过同一遍校验与限额。
    const readBlocks = (
      raw: unknown,
    ): { blocks: ModPromptContextBlock[]; truncated: number } | undefined => {
      if (!Array.isArray(raw)) return undefined;
      const blocks: ModPromptContextBlock[] = [];
      for (const item of raw) {
        // 一块要么是 `{ name, text }`（CC 的形状），要么是裸字符串（写起来
        // 更短，来源名留空）。
        if (typeof item === "string") {
          if (item.trim()) blocks.push({ name: "context", text: item });
          continue;
        }
        if (!isPlainRecord(item) || typeof item.text !== "string") continue;
        blocks.push({
          name: typeof item.name === "string" ? item.name : "context",
          text: item.text,
        });
      }
      let chars = 0;
      const limited: ModPromptContextBlock[] = [];
      for (const block of blocks) {
        if (
          limited.length >= MOD_LIMITS.promptContextMaxItems ||
          chars + block.text.length > MOD_LIMITS.promptContextChars
        ) {
          break;
        }
        limited.push(block);
        chars += block.text.length;
      }
      return { blocks: limited, truncated: blocks.length - limited.length };
    };
    const result = await this.runValueHookChain<{
      blocks: ModPromptContextBlock[];
    }>(
      "prompt.context",
      { blocks: [] as ModPromptContextBlock[] },
      (current) => ({
        blocks:
          (isPlainRecord(current)
            ? readBlocks(current.blocks)?.blocks
            : undefined) ?? [],
      }),
      (modId, value, fallback) => {
        if (!isPlainRecord(value)) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.context 只认 { blocks }：这一条被忽略`,
          );
          return fallback;
        }
        const read = readBlocks(value.blocks);
        if (!read) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.context 只认 { blocks }：这一条被忽略`,
          );
          return fallback;
        }
        if (read.truncated > 0) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.context 有 ${read.blocks.length + read.truncated} 块，超过限额，只用了前 ${read.blocks.length} 块`,
          );
        }
        return { blocks: read.blocks };
      },
      signal,
    );
    return result.blocks;
  }

  /**
   * 派发 `prompt.attachment`：宿主自己要加一条消息之前（spec「系统提示词与附
   * 件」）。
   *
   * 返回 `null` 表示这条提醒不出现 —— 这是插件唯一能压掉一条宿主消息的通道。
   */
  async rewritePromptAttachment(
    attachment: { type: string; text: string },
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.disposed) return attachment.text;
    return this.runValueHookChain<string | null>(
      "prompt.attachment",
      attachment,
      (current) => {
        // 链尾按链尾收到的事件取值：`next({ ...e, text })` / `{ text: null }`
        // 之后没人再注册时，改过的那份就是最终结果。
        if (!isPlainRecord(current) || !("text" in current)) {
          return attachment.text;
        }
        if (current.text === null) return null;
        return typeof current.text === "string"
          ? current.text
          : attachment.text;
      },
      (modId, value, fallback) => {
        return this.textOrNullReply(
          modId,
          "prompt.attachment",
          value,
          fallback,
        );
      },
      signal,
    );
  }

  /**
   * 派发 `session.append`：一条消息落进转录之前（spec「转录写入前改写」）。
   *
   * 返回 `dropped` 时 caller 不存这一行。钩子返回的 `message` 过一遍形状校验：
   * 改 `role` 或块类型一律不认，按原样存（见 spec 那条「不允许改身份」）。
   */
  async dispatchSessionAppend(
    message: ModSessionMessage,
    door: ModSessionAppendDoor,
    agentId?: string,
    signal?: AbortSignal,
  ): Promise<{ message: ModSessionMessage; uuid: string; deny?: string }> {
    const base: { message: ModSessionMessage; uuid: string; deny?: string } = {
      message,
      uuid: message.id,
    };
    if (this.disposed) return base;
    return this.runValueHookChain(
      "session.append",
      {
        message,
        // `uuid` / `door` / `agentId` 是 CC 的三个字段名（`uuid` 就是我们的
        // message.id）：真插件按 `e.agentId` 分主/子代理、按 `e.door` 分这行是
        // 怎么来的，回来后按 `r.uuid` 记自己那份。没有 `turnId` —— CC 的事件
        // 里就没这个字段。
        uuid: message.id,
        door,
        ...(agentId === undefined ? {} : { agentId }),
      },
      (current) => {
        // 链尾按链尾收到的事件取值：`next({ ...e, message })` / `{ deny }` 之后
        // 没人再注册时，这几个字段就是最终结果 —— 这是 spec 给的改写通道。
        if (!isPlainRecord(current)) return base;
        const next = normalizeSessionMessage(current.message);
        const deny =
          typeof current.deny === "string" ? { deny: current.deny } : {};
        if (!next) return deny.deny === undefined ? base : { ...base, ...deny };
        return { message: next, uuid: next.id, ...deny };
      },
      (modId, value, fallback) => {
        if (!isPlainRecord(value)) return fallback;
        if (typeof value.deny === "string") {
          logger.info(
            `[Wave] ${modId} 的 session.append 丢弃了一条消息：${value.deny}`,
          );
          return {
            message: fallback.message,
            uuid: fallback.uuid,
            deny: value.deny,
          };
        }
        const next = normalizeSessionMessage(value.message);
        if (!next) {
          logger.warn(
            `[Wave] ${modId} 的 session.append 返回了不合法的 message（只能改文本块的 text）：按原样存`,
          );
          return fallback;
        }
        return { message: next, uuid: next.id };
      },
      signal,
    );
  }

  /**
   * 派发 `tool.describe`：一个工具的描述第一次要发给模型时（spec「给工具、技
   * 能、命令写描述」）。
   *
   * 每场会话问一次，答案由 `ToolManager` 存着；`breakPromptCache: true` 是插
   * 件声明「这份别存」，那一次请求之后就重新问。
   */
  async collectToolDescription(
    tool: { name: string; description: string },
    signal?: AbortSignal,
  ): Promise<{ description: string; breakPromptCache?: boolean }> {
    if (this.disposed) return { description: tool.description };
    type Described = { description: string; breakPromptCache?: boolean };
    return this.runValueHookChain<Described>(
      "tool.describe",
      { tool: tool.name, description: tool.description },
      (current) =>
        isPlainRecord(current) && typeof current.description === "string"
          ? { description: current.description }
          : { description: tool.description },
      (modId, value, fallback) => {
        if (!isPlainRecord(value)) return fallback;
        if (value.isDeferred !== undefined) {
          // 我们没有 tool search：`true` 等于把工具下架，`false` 没有意义。
          logger.warn(
            `[Wave] ${modId} 的 tool.describe 返回了 isDeferred：我们没有 tool search，这一项被忽略`,
          );
        }
        const description =
          typeof value.description === "string"
            ? value.description
            : fallback.description;
        // `breakPromptCache: true` 是「这一份别缓存」的声明，链上任何一环说了
        // 都算数 —— 丢掉它就等于把插件的时间戳又缓存住了一整场会话。
        return value.breakPromptCache === true ||
          fallback.breakPromptCache === true
          ? { description, breakPromptCache: true }
          : { description };
      },
      signal,
    );
  }

  /**
   * 派发 `skill.prompt`：一个技能的正文被展开给模型时（spec「给工具、技能、
   * 命令写描述」）。
   */
  async collectSkillText(
    skill: { skill: string; text: string; source?: string; path?: string },
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.disposed) return skill.text;
    return this.runValueHookChain<string>(
      "skill.prompt",
      skill,
      (current) =>
        isPlainRecord(current) && typeof current.text === "string"
          ? current.text
          : skill.text,
      (_modId, value, fallback) => {
        if (!isPlainRecord(value)) return fallback;
        return typeof value.text === "string" ? value.text : fallback;
      },
      signal,
    );
  }

  /**
   * 派发 `command.describe`：命令列表要画时每个命令一次（spec「给工具、技能、
   * 命令写描述」）。
   *
   * 三个字段都可选、只覆盖给了的：插件只关心「藏起来」时不必把描述也抄一遍。
   */
  async collectCommandDescribe(
    command: string,
    signal?: AbortSignal,
  ): Promise<{
    description?: string;
    argumentHint?: string;
    isHidden?: boolean;
  }> {
    if (this.disposed) return {};
    return this.runValueHookChain(
      "command.describe",
      { command },
      (current) => {
        // 链尾按链尾收到的事件取值：`next({ ...e, isHidden: true })` 之后没人
        // 再注册时，这一项就是要用的。
        const out: {
          description?: string;
          argumentHint?: string;
          isHidden?: boolean;
        } = {};
        if (!isPlainRecord(current)) return out;
        if (typeof current.description === "string") {
          out.description = current.description;
        }
        if (typeof current.argumentHint === "string") {
          out.argumentHint = current.argumentHint;
        }
        if (typeof current.isHidden === "boolean") {
          out.isHidden = current.isHidden;
        }
        return out;
      },
      (_modId, value, fallback) => {
        if (!isPlainRecord(value)) return fallback;
        const merged = { ...fallback };
        if (typeof value.description === "string") {
          merged.description = value.description;
        }
        if (typeof value.argumentHint === "string") {
          merged.argumentHint = value.argumentHint;
        }
        if (typeof value.isHidden === "boolean") {
          merged.isHidden = value.isHidden;
        }
        return merged;
      },
      signal,
    );
  }

  /**
   * `prompt.section` / `prompt.attachment` 共用的 `{ text }` / `{ text: null }`
   * 解析：`null` 与「没给」是两件事，前者是「这一段不要」。
   */
  private textOrNullReply(
    modId: string,
    name: "prompt.section" | "prompt.attachment",
    value: unknown,
    fallback: string | null,
  ): string | null {
    if (!isPlainRecord(value)) return fallback;
    if (value.text === null) return null;
    if (typeof value.text !== "string") return fallback;
    if (value.text.length > MOD_LIMITS.promptSectionChars) {
      logger.warn(
        `[Wave] ${modId} 的 ${name} 给了超过 ${MOD_LIMITS.promptSectionChars} 字符的文本，已截断`,
      );
      return value.text.slice(0, MOD_LIMITS.promptSectionChars);
    }
    return value.text;
  }

  /**
   * `tool.call` / `classic.PreToolUse` 的**跨 mod** 钩子链。
   *
   * 链尾（`tail`）有两个：`tool.call` 的「执行这次调用」（mod 的 `next(e)`
   * 走到最后一个 mod 之后真的把工具跑掉）与 `classic.PreToolUse` 的「没有意见」
   * （空对象，它只拦、不执行 —— 执行已经在 `tool.call` 那条链上了）。
   *
   * 一个 mod 失败（抛错、超时）按 fail-open 处理：记一条 warn，接着问下一个
   * —— 钩子挂掉不该让对话卡在「工具既不跑也不拒」（要 fail-closed 的守卫用
   * `.catch` 自己返回 `{ deny }`）。
   */
  private async runToolHookChain(
    name: "tool.call" | "classic.PreToolUse",
    event: unknown,
    tail: { run?: () => Promise<unknown> },
    signal?: AbortSignal,
  ): Promise<{ deny?: string; result?: unknown }> {
    const loaded = [...this.mods.values()].filter((item) => item.runtime);
    let ran = false;
    // 只认 `tool.call` 的 `{ result }`：`classic.PreToolUse` 在 Claude Code 那边
    // 没有这一项。返回 `null` = 这一层没有给出可用的答案（继续按「没有意见」算）。
    const asAnswer = (
      value: unknown,
    ):
      | { deny: string; result?: undefined }
      | { deny?: undefined; result: unknown }
      | null => {
      if (isDeny(value)) return { deny: value.deny };
      if (name !== "tool.call") return null;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
      }
      const shape = value as Record<string, unknown>;
      if (!("result" in shape)) return null;
      return { result: shape.result ?? null };
    };
    // 链尾把**工具结果**交回去：`tool.call` 的 `next(e)` 就是执行，社区写法是
    // `const r = await next(e)` 之后读 `r.result`。没有执行体（`classic.
    // PreToolUse`、或插件自己注册的工具）时，链尾给「没有意见」的空对象。
    const runOnce = async () => {
      if (tail.run && !ran) {
        ran = true;
        return await tail.run();
      }
      return {};
    };
    const fromIndex = async (
      index: number,
      current: unknown,
    ): Promise<unknown> => {
      for (let i = index; i < loaded.length; i += 1) {
        const item = loaded[i]!;
        const runtime = item.runtime!;
        if (!runtime.matchesHook(name, current)) continue;
        let nextCalled = false;
        let innerValue: unknown;
        const result = await runtime.callHook(name, current, {
          signal,
          engine: async (nextEvent) => {
            // 调了 `next(e)`：控制权交给下面的 mod（最后一个交回链尾）。把内层
            // 的答案记下来 —— `await next(e)` 之后忘掉返回值的写法很常见，不能
            // 因此丢掉下面那个 mod 的 `{ deny }` / `{ result }`。
            nextCalled = true;
            innerValue = await fromIndex(i + 1, nextEvent);
            return innerValue;
          },
        });
        if (!result.ok) {
          logger.warn(`[Wave] ${item.mod.id} 的 ${name} 失败：${result.error}`);
          continue;
        }
        // 交给下面之后，`classic.PreToolUse` 里这个 mod 自己的返回值不再算数：
        // 它没有执行体，`next` 之后只可能是在看下游的裁决（Claude Code 同口径）。
        //
        // `tool.call` 是例外：它没有「已经跑掉的工具」，`await next(e)` 之后包
        // 一层再返回（`return { result: shape(r) }`）是社区最自然的后处理写法，
        // spec「执行走 tool.call」也写了「外层返回自己的那份才算数」。
        if (nextCalled) {
          if (name === "tool.call" && asAnswer(result.value))
            return result.value;
          return innerValue;
        }
        if (name === "classic.PreToolUse" && !isDeny(result.value)) {
          // CC 这一条另有 `{ allow: true }` / `{ ask }` / `updatedInput`：放行
          // 与强制弹卡片都是第二判定源，改写参数同一条理由（spec「交付分层」）。
          // 静默忽略会让作者以为放行生效了，所以点一次名。
          const reply: unknown = result.value;
          if (typeof reply === "object" && reply !== null) {
            const shape = reply as Record<string, unknown>;
            if (
              shape.allow !== undefined ||
              shape.ask !== undefined ||
              shape.updatedInput !== undefined
            ) {
              logger.warn(
                `[Wave] ${item.mod.id} 的 classic.PreToolUse 返回了 allow/ask/updatedInput：只支持 { deny }，那几项被忽略`,
              );
            }
          }
        }
        return result.value ?? {};
      }
      return runOnce();
    };
    const value = await fromIndex(0, event);
    const answer = asAnswer(value);
    if (!answer) return {};
    return answer.deny !== undefined
      ? { deny: answer.deny }
      : { result: answer.result };
  }

  /**
   * 「改写型」钩子链：宿主先算出**一份值**，插件可以换掉它，下游还能再换。
   *
   * 与 {@link runToolHookChain} 的两处不同，都是刻意的：
   *
   * - **`next(e)` 之后外层还能改**。deny 链里 `next` 之后工具已经跑了（`tool.
   *   call` 的 `next` 就是执行），外层再说什么都晚了（Claude Code 同口径）；
   *   改写链里 `next` 只是「先看看下面几
   *   个 mod 改成什么」，外层在自己那份基础上继续改是正常写法 —— 社区的
   *   `const below = await next(e); return { ...below, text: fix(below.text) }`
   *   就是这个意思。旧链丢掉外层返回值，让这种写法静默失效。
   * - **链尾按「链尾收到的那份事件」算**，不是按进场时那份：`next({ ...e, x })`
   *   把改过的事件交给下游，下游一个 mod 都没注册时这份事件就是最终结果。所以
   *   `tail` 收事件、从里面取自己关心的字段；谁都没改时它与原值逐字相同（提示词
   *   缓存靠它）。
   *
   * 失败（抛错、超时、返回 `undefined`）按 fail-open：下游的值说了算 —— 但只有
   * 下游**跑完了**才算。`withBudget` 到期只是让 race 先落，handler 还挂在 `next`
   * 里没回来，此刻 `inner` 仍是 `undefined`；「调过 `next`」不等于「下游跑完了」。
   */
  private async runValueHookChain<T>(
    name: ModValueHookName,
    event: unknown,
    tail: (event: unknown) => T,
    normalize: (modId: string, value: unknown, fallback: T) => T,
    signal?: AbortSignal,
    /**
     * 某个 mod 抛错 / 超时时怎么办：返回一个结果就**当场收口**（链上后面的 mod
     * 不再问），返回 `undefined` 就按默认的「跳过它、继续问下一个」。
     *
     * 只有 `tool.check` 传它：CC 给这条链的兜底是 `{ decision: "deny" }`，
     * 一个守卫坏了不能等于放行；其余 value 型事件的失败语义是「这次没有答
     * 案」，跳过才是对的。
     */
    onFailure?: (modId: string, error: unknown, fallback: T) => T | undefined,
  ): Promise<T> {
    const loaded = [...this.mods.values()].filter((item) => item.runtime);
    const fromIndex = async (index: number, current: unknown): Promise<T> => {
      for (let i = index; i < loaded.length; i += 1) {
        const item = loaded[i]!;
        const runtime = item.runtime!;
        if (!runtime.matchesHook(name, current)) continue;
        let inner: T | undefined;
        const result = await runtime.callHook(name, current, {
          signal,
          engine: async (nextEvent) => {
            // `next()` 不带参数 = 「按现在这份继续」。漏了兜底，下层收到的是
            // `undefined`，链尾也按 `tail(undefined)` 算，整段事件凭空消失
            // （`runtime.runChain` 同口径）。
            inner = await fromIndex(
              i + 1,
              nextEvent === undefined ? current : nextEvent,
            );
            return inner;
          },
        });
        const fallback = inner !== undefined ? inner : tail(current);
        if (!result.ok) {
          logger.warn(`[Wave] ${item.mod.id} 的 ${name} 失败：${result.error}`);
          if (inner !== undefined) return inner;
          const failed = onFailure?.(item.mod.id, result.error, fallback);
          if (failed !== undefined) return failed;
          continue;
        }
        if (result.value === undefined) return fallback;
        return normalize(item.mod.id, result.value, fallback);
      }
      return tail(current);
    };
    return fromIndex(0, event);
  }

  /**
   * `$.ui.ask`：问用户一个问题（spec「问用户一个问题」）。
   *
   * 只转一手：真正画卡片、等人按的是界面进程，走的是引擎自己的
   * `AskUserQuestion` 审批链路（由 `Agent` 接进来）。没接上就是「这条会话没有
   * 人能回答」，reject —— 守卫据此按拒绝处理。
   */
  private async askUser(
    question: string,
    options: { labels: string[]; header?: string; multiSelect?: true },
  ): Promise<string> {
    if (!this.askUserHandler) {
      throw new Error("这条会话没有人能回答插件的问题（没有可用的界面）");
    }
    return this.askUserHandler(question, options);
  }

  /**
   * `$.session.usage()` / `session.measure` 用的那份快照（零值兜底）。
   *
   * 数据源由 `Agent` 接进来（`setSessionUsageProvider`）：纯服务调用与测试里
   * 没有 agent，那时给零值 —— mod 读到的是一份合法但空的用量。
   */
  private usageSnapshot(): ModSessionUsage {
    return this.sessionUsageProvider?.() ?? EMPTY_SESSION_USAGE;
  }

  /**
   * 派发 `prompt.submit` 并收集 mod 塞进本轮的上下文（spec「轮次内外的事件」）。
   *
   * 与 {@link notifyMods} 的区别是**要等返回值**：注入的文本必须在这一轮的请求
   * 发出前就位。等是有边界的 —— 每个 mod 各自受钩子超时约束，失败或超时只记一条
   * warn，这一轮照常发出（只是没有注入）。返回值按插件加载顺序拼接。
   */
  async collectPromptContext(text: string): Promise<string[]> {
    if (this.disposed) return [];
    const parts = await Promise.all(
      [...this.mods].map(async ([modId, loaded]) => {
        const runtime = loaded.runtime;
        if (!runtime) return [];
        const result = await runtime.callHook("prompt.submit", { text });
        if (!result.ok) {
          logger.warn(`[Wave] ${modId} 的 prompt.submit 失败：${result.error}`);
          return [];
        }
        const returned = result.value;
        if (
          typeof returned !== "object" ||
          returned === null ||
          Array.isArray(returned)
        ) {
          return [];
        }
        const value = returned as ModPromptSubmitResult &
          Record<string, unknown>;
        // 改 `text` / `drop` 是 Claude Code 同名事件另外两个返回值：我们不支持
        // （悄悄改写或丢掉用户敲的话，用户在界面上看不出来）。
        if (value.text !== undefined || value.drop !== undefined) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.submit 返回了 text/drop：只支持 { context }，那两项被忽略`,
          );
        }
        const context = value.context;
        if (context === undefined) return [];
        if (
          !Array.isArray(context) ||
          context.some((item) => typeof item !== "string")
        ) {
          logger.warn(
            `[Wave] ${modId} 的 prompt.submit 的 context 必须是字符串数组，已忽略`,
          );
          return [];
        }
        return context
          .map((item: string) => item.trim())
          .filter((item: string) => item.length > 0);
      }),
    );
    const merged = parts.flat();
    // 条数与总字数封顶：多余部分丢弃并记一条 warn —— 这一轮不能因为插件塞太多
    // 东西而失败。
    const limited: string[] = [];
    let chars = 0;
    for (const part of merged) {
      if (limited.length >= MOD_LIMITS.promptContextMaxItems) break;
      if (chars + part.length > MOD_LIMITS.promptContextChars) break;
      limited.push(part);
      chars += part.length;
    }
    if (limited.length < merged.length) {
      logger.warn(
        `[Wave] prompt.submit 的上下文有 ${merged.length} 条，超过限额，只用了前 ${limited.length} 条`,
      );
    }
    return limited;
  }

  /**
   * 当前所有面板的元信息（`initialize` / 会话恢复 / webview 重建时补发）。
   *
   * 一律带 `stale: true`：接上来的这个 surface 手里一帧都没有，必须自己去拉
   * —— 宿主不缓存树，没法替它回放上一次渲染的内容。
   */
  paneSnapshots(): ModPanelUpdatePayload[] {
    return [...this.panes.values()].map((pane) =>
      this.payloadOf(pane, { stale: true }),
    );
  }

  /**
   * 当前每个插件贴的状态行（surface 挂上来时重放用，见 `statusLines`）。
   *
   * 顺序按插件首次贴出的先后；清掉的行不在里面。
   */
  statusSnapshots(): ModStatusPayload[] {
    return [...this.statusLines].map(([modId, line]) => ({
      sessionId: this.options.sessionId,
      modId,
      plugin: line.plugin,
      text: line.text,
    }));
  }

  /**
   * 派发 `ui.press` / `ui.input` / `ui.select`：控件自己的回调之前先问一遍插件
   * （spec「控件的交互事件」）。
   *
   * 返回这次交互最终派给哪个控件、带什么值。返回值只认 `element` / `value`：
   * `element` 换派给哪个控件、`value` 换回调收到的值，两者都只对这一次生效、
   * 不落进元素树。`value` 只有 `ui.input` / `ui.select` 认得，形状不对时丢掉
   * 这一项并 warn（回调仍拿用户原本给的值）。
   */
  private async dispatchUiInteraction(
    payload: ModPanelEventPayload,
    plugin: string,
  ): Promise<{ element: string; value?: string }> {
    const name =
      payload.kind === "press"
        ? "ui.press"
        : payload.kind === "input"
          ? "ui.input"
          : "ui.select";
    const component =
      payload.kind === "press"
        ? "Button"
        : payload.kind === "input"
          ? "Input"
          : "Select";
    const base: ModUiControlEvent = {
      plugin,
      component,
      requestId: payload.paneId,
      element: payload.key,
      ...(payload.value === undefined ? {} : { value: payload.value }),
    };
    const read = (
      raw: unknown,
      fallback: { element: string; value?: string },
      modId?: string,
    ): { element: string; value?: string } => {
      if (!isPlainRecord(raw)) return fallback;
      const element =
        typeof raw.element === "string" && raw.element !== ""
          ? raw.element
          : fallback.element;
      // `ui.press` 没有 `value` 这一项：钩子给什么都不认。
      if (payload.kind === "press") return { element };
      const kept =
        fallback.value === undefined
          ? { element }
          : { element, value: fallback.value };
      if (raw.value === undefined) return kept;
      if (typeof raw.value !== "string") {
        logger.warn(
          `[Wave] ${modId ?? "mod"} 的 ${name} 给了非字符串的 value，这一项被丢掉`,
        );
        return kept;
      }
      return { element, value: raw.value };
    };
    return this.runValueHookChain<{ element: string; value?: string }>(
      name,
      base,
      (current) => read(current, base),
      (modId, value, fallback) => read(value, fallback, modId),
    );
  }

  /** webview 回传的交互。 */
  async handlePanelEvent(payload: ModPanelEventPayload): Promise<void> {
    if (this.disposed) return;
    const key = `${payload.modId}\u0000${payload.paneId}`;
    const loaded = this.mods.get(payload.modId);
    if (!loaded) {
      logger.warn(`[Wave] 收到未知 mod 的事件：${payload.modId}`);
      return;
    }
    if (loaded.error || !loaded.runtime) {
      // 面板本来就显示着错误态，交互无处可去。
      return;
    }
    if (payload.kind === "close") {
      // 宿主丢掉 pane 快照，同时给打开它的 mod 一条 `ui.close`（spec「事件」：
      // 告知，拦不下关闭）。
      this.closePane(payload.modId, payload.paneId);
      return;
    }
    if (!payload.key) {
      logger.warn(`[Wave] ${payload.modId} 的 ${payload.kind} 事件缺少 key`);
      return;
    }
    try {
      // 控件自己的回调之前先跑一遍同名钩子（spec「控件的交互事件」）：钩子能
      // 把这次交互改派给别的控件、换掉回调收到的值。
      const target = await this.dispatchUiInteraction(payload, loaded.plugin);
      const handled = await loaded.runtime.dispatch(
        payload.kind,
        target.element,
        target.value,
      );
      if (!handled) {
        logger.debug(
          `[Wave] ${payload.modId} 没有处理 ${payload.kind}「${payload.key}」的回调`,
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      logger.warn(
        `[Wave] ${payload.modId} 处理 ${payload.kind} 失败：${message}`,
      );
      const pane = this.panes.get(key);
      if (pane) this.publishUpdate(pane, { stale: true, error: message });
    }
  }

  /** 会话结束 / agent 销毁：关掉所有面板、撤销所有定时器与外部进程，进入终态。 */
  async dispose(): Promise<void> {
    this.cancelAllTimers();
    // 未完成的 `$.clock.sleep` 一并 reject（spec「时钟：等待」）：留着就是一个
    // resolve 到已销毁会话上的 Promise。
    this.cancelAllSleeps();
    // 外部进程连同子进程树一起杀（spec「生命周期」）：留下的孤儿会一直跑，
    // 然后往一个已经不存在的会话里写东西。
    this.processes.dispose();
    // 命令的 handler 闭包指着这个沙箱，留下就是一个打到已销毁会话上的僵尸。
    this.dropOwnedCommands();
    // 工具同理：注销之后模型不再看到它（spec「把我们自己的工具交给模型」）。
    this.dropOwnedTools();
    // 先关面板再进终态：`closed: true` 是界面关掉 tab 的唯一信号，而
    // `publishUpdate` 在 `disposed` 之后一律静默。这里**不**逐条发 `ui.close`：
    // 会话销毁只发一次 `session.end`（spec「事件」）。
    this.closeAllPanes(false);
    this.bands.clear();
    this.statusLines.clear();
    this.disposed = true;
  }

  /**
   * 这一刻生效的权限模式，给 `classic.UserPromptSubmit` / `classic.PostToolUse`
   * 这族载荷用（spec「影子事件」）。取不到时是 `default`。
   */
  currentPermissionMode(): string {
    return this.facts.permissionMode();
  }

  /**
   * 会话销毁之前派发一次 `session.end`（spec「轮次内外的事件（只读）」）。
   *
   * 唯一一个宿主会**等**的 mod 事件：插件要拿它把「这一场结束了」报到自己的服
   * 务端，而 `dispose` 之后实例就没了。并行等所有 mod，各自受 5 秒钩子上限约束；
   * 失败只记 warn —— 收尾不能因为一个插件卡住而卡住。
   */
  async endSession(): Promise<void> {
    if (this.disposed) return;
    const pending: Array<Promise<void>> = [];
    for (const [modId, loaded] of this.mods) {
      const runtime = loaded.runtime;
      if (!runtime) continue;
      pending.push(
        runtime.callHook("session.end", {}).then((result) => {
          if (!result.ok) {
            logger.warn(`[Wave] ${modId} 的 session.end 失败：${result.error}`);
          }
        }),
      );
    }
    await Promise.all(pending);
  }

  /**
   * 插件热重载（`/reload-plugins`）：关掉旧面板、丢掉旧 mod 与 state，再用新的
   * 插件列表重建。
   *
   * 与 {@link dispose} 分开是因为 `disposed` 是**终态**（agent 已经销毁，之后
   * 一律静默）；重载之后这个 manager 还得继续用，不能留在终态里 —— 早期版本
   * 直接在 reload 路径上调 `dispose("plugin")`，结果重载一次 mod 就永久不生效。
   */
  async reload(plugins: Plugin[]): Promise<void> {
    // 旧实例的定时器与进程必须先停：下面会丢掉 `mods`，它们的 `$` 还指向旧
    // runtime —— 留着的话这些回调/子进程会打到已经没人认领的旧实例上。
    this.cancelAllTimers();
    this.cancelAllSleeps();
    this.processes.killAll();
    // 命令先撤再重建：否则重载后命令表里留着指向旧沙箱的 handler。
    this.dropOwnedCommands();
    this.dropOwnedTools();
    // 早于 `mods.clear()`：`ui.close` 要发给还活着的旧实例（spec「事件」）。
    this.closeAllPanes(true);
    this.bands.clear();
    this.statusLines.clear();
    this.mods.clear();
    this.state.clear();
    await this.loadFromPlugins(plugins);
    await this.startSession();
    // 重载前 `dropOwnedTools()` 把工具表清空了，新的 mod 得重新交一遍规格
    // （spec「把我们自己的工具交给模型」）。
    await this.dispatchToolRegister();
  }

  // ── 定时器（spec「定时器」） ────────────────────────────────

  private timersFor(modId: string): Set<ClockTimer> {
    let set = this.timers.get(modId);
    if (!set) {
      set = new Set();
      this.timers.set(modId, set);
    }
    return set;
  }

  /**
   * 登记一个定时器。
   *
   * 间隔下限与数量上限都在这里强制（spec「限额」）：下限**夹取**而不报错
   * （`0` / 负值 / 非数字几乎一定是写错了，但没必要让整个面板变成错误态），
   * 上限则报错 —— 一个 mod 起了第 17 个定时器是设计问题，不该静默成功。
   */
  private startTimer(
    modId: string,
    kind: "after" | "every",
    ms: number,
    fn: () => unknown,
  ): { cancel(): void } {
    if (typeof fn !== "function") {
      throw new Error("$.clock 的回调必须是一个函数");
    }
    if (this.disposed) {
      // agent 已经销毁：给一个空句柄，别让 mod 的收尾代码再炸一次。
      return { cancel: () => {} };
    }
    const set = this.timersFor(modId);
    if (set.size >= MOD_LIMITS.maxTimersPerMod) {
      throw new Error(
        `定时器上限 ${MOD_LIMITS.maxTimersPerMod} 个（${modId}），先 cancel 掉不用的`,
      );
    }
    const delayMs = Number.isFinite(ms)
      ? Math.max(MOD_LIMITS.timerMinIntervalMs, Math.floor(ms))
      : MOD_LIMITS.timerMinIntervalMs;
    const timer: ClockTimer = {
      modId,
      kind,
      delayMs,
      run: fn,
      running: false,
      cancelled: false,
    };
    set.add(timer);
    this.schedule(timer);
    return { cancel: () => this.cancelTimer(timer) };
  }

  private schedule(timer: ClockTimer): void {
    if (timer.cancelled || this.disposed) return;
    timer.timer = setTimeout(() => this.fireTimer(timer), timer.delayMs);
    // 定时器不该把进程钉住：CLI 退出时 `unref` 掉，会话销毁时再显式 cancel。
    timer.timer.unref?.();
  }

  private fireTimer(timer: ClockTimer): void {
    timer.timer = undefined;
    if (timer.cancelled || this.disposed) return;
    if (timer.kind === "after") {
      // 一次性：先摘出登记表，回调里 cancel 也无妨。
      this.timersFor(timer.modId).delete(timer);
    }
    if (timer.running) {
      // 上一拍还没跑完 —— 跳过这一拍，节拍照旧（不排队、不并发）。
      logger.debug(`[Wave] ${timer.modId} 的定时器上一拍未结束，跳过这一拍`);
    } else {
      timer.running = true;
      const finish = () => {
        timer.running = false;
      };
      try {
        // 定时器回调也是 mod 代码：经沙箱那一跳，同步死循环才打得断（与钩子
        // 同一条洞，见 `ModRuntime.invokeInContext`）。
        const runtime = this.mods.get(timer.modId)?.runtime;
        const result =
          runtime === undefined
            ? timer.run()
            : runtime.runSandboxedCallback<unknown>(
                timer.run as (...args: unknown[]) => unknown,
                `$.clock.${timer.kind} 的回调`,
                `${timer.modId}:clock`,
              );
        if (isThenable(result)) {
          void result.then(
            () => finish(),
            (error: unknown) => {
              this.reportTimerError(timer.modId, error);
              finish();
            },
          );
        } else {
          finish();
        }
      } catch (error) {
        this.reportTimerError(timer.modId, error);
        finish();
      }
    }
    // `every` 的下一拍在 fire 时就排好（固定节拍）；`after` 到此为止。
    if (timer.kind === "every") this.schedule(timer);
  }

  private cancelTimer(timer: ClockTimer): void {
    timer.cancelled = true;
    if (timer.timer) {
      clearTimeout(timer.timer);
      timer.timer = undefined;
    }
    this.timersFor(timer.modId).delete(timer);
  }

  /** 撤销所有定时器；给了 `modId` 就只撤那个 mod 的。 */
  private cancelAllTimers(modId?: string): void {
    if (modId === undefined) {
      for (const id of [...this.timers.keys()]) this.cancelAllTimers(id);
      this.timers.clear();
      // 带上的 stale 通知也一起撤：会话销毁/插件重载后它指向的 mod 已经没了。
      for (const timer of this.bandPending.values()) clearTimeout(timer);
      this.bandPending.clear();
      this.bandLastRenderAt.clear();
      return;
    }
    const set = this.timers.get(modId);
    if (!set) return;
    for (const timer of [...set]) this.cancelTimer(timer);
    this.timers.delete(modId);
  }

  // ── 等待（spec「时钟：等待」） ──────────────────────────────

  private sleepsFor(modId: string): Set<SleepWait> {
    let set = this.sleeps.get(modId);
    if (!set) {
      set = new Set();
      this.sleeps.set(modId, set);
    }
    return set;
  }

  /**
   * 起一次 `$.clock.sleep`。
   *
   * 三条纪律都在这里：间隔夹进 [下限, 上限]、每 mod 并发数封顶、撤销权归宿主
   * （会话销毁 / 插件重载时 reject 掉所有未完成的等待）。下半段「与定时器同一
   * 条：沙箱里不该有活过会话的东西」。
   */
  private startSleep(
    modId: string,
    ms: number,
    signal: unknown,
  ): Promise<void> {
    const live = this.sleepsFor(modId);
    // 超配额与参数错误一样是**当场**抛（不是 rejection）：与 `after`/`every`
    // 的配额错误同一个形状，mod 的 `try/catch` 就能抓住；只有撤销才走 reject。
    if (live.size >= MOD_LIMITS.maxSleepsPerMod) {
      throw new Error(
        `$.clock.sleep 同时未完成的等待最多 ${MOD_LIMITS.maxSleepsPerMod} 个`,
      );
    }
    const delay = Math.min(
      Math.max(ms, MOD_LIMITS.timerMinIntervalMs),
      MOD_LIMITS.maxSleepMs,
    );
    const abortSignal = isAbortSignal(signal) ? signal : undefined;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) abortSignal?.removeEventListener("abort", onAbort);
        live.delete(wait);
        if (error) reject(error);
        else resolve();
      };
      const wait: SleepWait = { cancel: () => finish(abortError()) };
      live.add(wait);
      timer = setTimeout(() => finish(), delay);
      if (abortSignal) {
        onAbort = () => finish(abortError());
        abortSignal.addEventListener("abort", onAbort);
        // 已经 abort 的 signal：立刻结束，不必等下一次事件。
        if (abortSignal.aborted) finish(abortError());
      }
    });
  }

  /** 撤销所有未完成的等待；给了 `modId` 就只撤那个 mod 的。 */
  private cancelAllSleeps(modId?: string): void {
    if (modId === undefined) {
      for (const id of [...this.sleeps.keys()]) this.cancelAllSleeps(id);
      return;
    }
    const set = this.sleeps.get(modId);
    if (!set) return;
    this.sleeps.delete(modId);
    for (const wait of [...set]) wait.cancel();
  }

  // ── prompt 投递（spec「把 prompt 送进对话」） ────────────────

  /**
   * 把 mod 的一条 prompt 投进本会话。
   *
   * 语义就是用户自己发了一条：会话空闲时开新一轮，忙时按 `Agent.sendMessage`
   * 的既有规则入队。这里不自己做队列，也不做「用户按了 Esc 就丢掉」那种回执
   * ——多一套投递规则就多一种「消息去哪了」的解释。
   */
  private async submitPrompt(modId: string, text: string): Promise<void> {
    if (this.disposed) {
      throw new Error("会话已结束，不能再投递 prompt");
    }
    const submit = this.promptSubmitter;
    if (!submit) {
      throw new Error(
        "当前宿主没有接入 prompt 投递通道，$.prompt.submit 不可用",
      );
    }
    logger.info(`[Wave] ${modId} 把一条 prompt 投进了本会话`);
    await submit(text);
  }

  /**
   * 收掉一轮（spec「收掉一轮」）。
   *
   * 与 `submitPrompt` 同一条纪律：会话已销毁、宿主没接通道都抛错 —— 静默成功会
   * 让插件以为自己叫停了。`turnId` 对不对得上由 `AIManager` 判。
   */
  private abortTurn(modId: string, turnId: string): void {
    if (this.disposed) {
      throw new Error("会话已结束，没有可以收掉的轮次");
    }
    const abort = this.turnAborter;
    if (!abort) {
      throw new Error("当前宿主没有接入轮次中断通道，$.turn.abort 不可用");
    }
    logger.info(`[Wave] ${modId} 收掉了一轮：${turnId}`);
    abort(turnId);
  }

  /**
   * 把草稿填进界面上的输入框（spec「把草稿填进输入框」）。
   *
   * 与 `submitPrompt` 相反的两处：这条路**不抛错**（填不上是正常结果，mod 拿到
   * `false` 自己降级），也**不改会话**（不开轮次、不进上下文）。会话已经结束、
   * 或者宿主根本没接这条通道（终端 CLI、没挂 surface）时直接答 `false`。
   */
  private async fillPrompt(request: {
    text: string;
    mode: ModPromptFillMode;
  }): Promise<boolean> {
    if (this.disposed) return false;
    const fill = this.promptFiller;
    if (!fill) return false;
    return await fill(request);
  }

  /**
   * 读输入框里此刻的草稿（spec「输入框里现在有什么」）。
   *
   * 与 `fillPrompt` 一样不抛错：没人画、宿主没接、读失败都给空输入框。
   */
  private async readPromptDraft(): Promise<ModPromptBox> {
    const read = this.promptDraftReader;
    if (this.disposed || !read) return { text: "", cursor: 0 };
    try {
      return await read();
    } catch (error) {
      logger.debug("[Wave] 读草稿失败", error);
      return { text: "", cursor: 0 };
    }
  }

  /**
   * 把一段文本交给界面写进剪贴板（spec「剪贴板与视图」）。
   *
   * 三种失败态都由界面那一端判；没接通道时是 `no-surface` —— 「没有人能接」
   * 与「接了但写不进去」是两句话，别混成一个 `false`。
   */
  private async copyText(request: {
    text: string;
    surface?: ModRenderSurface;
  }): Promise<ModUiCopyResult> {
    const copy = this.copySink;
    if (this.disposed || !copy) {
      return { isCopied: false, reason: "no-surface" };
    }
    try {
      return await copy(request);
    } catch (error) {
      logger.debug("[Wave] $.ui.copy 失败", error);
      return { isCopied: false, reason: "refused" };
    }
  }

  /**
   * 定时器回调抛错：记日志，并把错误摘要叠在该 mod 的每个面板上。
   *
   * 面板不是错误态换掉树，而是「错误条 + 上一帧照旧」（与元素回调抛错同一条
   * 路径）；下一拍如果成功渲染，摘要自动消失。定时器本身**不停**——一次抛错就
   * 让面板永远不刷新，比偶发错误更难查。
   */
  private reportTimerError(modId: string, error: unknown): void {
    const message = errorMessage(error);
    logger.warn(`[Wave] ${modId} 的定时器回调失败：${message}`);
    for (const pane of [...this.panes.values()]) {
      if (pane.modId === modId) {
        this.publishUpdate(pane, { stale: true, error: message });
      }
    }
  }

  private closeAllPanes(notifyMods: boolean): void {
    const closing = [...this.panes.values()];
    for (const pane of closing) {
      if (pane.pending) clearTimeout(pane.pending);
    }
    this.panes.clear();
    // 只让界面把 tab 关掉（`closed: true`）；`notifyMods` 由调用方决定 ——
    // 插件重载时 mod 还活着，逐个发 `ui.close`；会话销毁只发一次 `session.end`。
    for (const pane of closing) {
      if (notifyMods) this.notifyPaneClosed(pane);
      this.publishUpdate(pane, { closed: true });
    }
  }

  /** 给打开这个 pane 的 mod 发一条 `ui.close`（fire-and-forget，拦不下关闭）。 */
  private notifyPaneClosed(pane: PaneState): void {
    const runtime = this.mods.get(pane.modId)?.runtime;
    if (!runtime || this.disposed) return;
    void runtime.callHook("ui.close", { id: pane.paneId }).then((result) => {
      if (!result.ok) {
        logger.warn(`[Wave] ${pane.modId} 的 ui.close 失败：${result.error}`);
      }
    });
  }

  private stateFor(modId: string): Map<string, unknown> {
    let map = this.state.get(modId);
    if (!map) {
      map = new Map();
      this.state.set(modId, map);
    }
    return map;
  }

  private readStore(pluginName: string): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(
        storePath(this.storeRoot, pluginName),
        "utf-8",
      );
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private writeStore(pluginName: string, store: Record<string, unknown>): void {
    try {
      fs.mkdirSync(this.storeRoot, { recursive: true });
      atomicWriteFileSync(
        storePath(this.storeRoot, pluginName),
        `${JSON.stringify(store, null, 2)}\n`,
      );
    } catch (error) {
      logger.warn(
        `[Wave] 写入 ${pluginName} 的 mod store 失败：${errorMessage(error)}`,
      );
    }
  }

  private listPanes(modId: string): string[] {
    return [...this.panes.values()]
      .filter((pane) => pane.modId === modId)
      .map((pane) => pane.paneId);
  }

  /**
   * 加载失败的 mod 也占一个面板：内容是一行错误摘要。
   *
   * `paneId` 固定为 `error` —— 一个 mod 只有一个「加载失败」入口，不需要多个
   * tab。用户关掉它之后不会再自动弹（`startSession` 只跑一次）。
   */
  private openErrorPane(mod: PluginMod, error: string): void {
    const pane: PaneState = {
      modId: mod.id,
      paneId: "error",
      title: mod.name,
      revision: 0,
      tree: null,
      error,
      lastRenderAt: Date.now(),
    };
    this.panes.set(`${mod.id}\u0000error`, pane);
    this.publishUpdate(pane, { error });
  }

  private openPane(
    modId: string,
    paneId: string,
    title: string,
    focus = false,
  ): boolean {
    if (this.disposed) return false;
    const key = `${modId}\u0000${paneId}`;
    const existing = this.panes.get(key);
    const pane: PaneState = existing ?? {
      modId,
      paneId,
      title,
      revision: 0,
      tree: null,
      lastRenderAt: 0,
    };
    pane.title = title;
    // 只有**这一次**打开要求了焦点才带：之后的重绘都清成 false，否则 mod 每
    // invalidate 一次就把用户的输入焦点抢走一次。
    pane.focus = focus;
    this.panes.set(key, pane);
    // 只登记 + 通知 surface 来要树，不在这里渲染（spec「架构约束」）。
    this.publishUpdate(pane, { stale: true, focus });
    return true;
  }

  private closePane(modId: string, paneId: string): void {
    const key = `${modId}\u0000${paneId}`;
    const pane = this.panes.get(key);
    if (!pane) return;
    if (pane.pending) clearTimeout(pane.pending);
    this.panes.delete(key);
    this.notifyPaneClosed(pane);
    this.publishUpdate(pane, { closed: true });
  }

  /**
   * 标记过期：100ms 内的多次调用合并成一次 `stale` 通知（spec「限额」）。
   *
   * mod 在一次交互里改三个 state 再 invalidate 一次是常态，但如果它在一个
   * 循环里 invalidate，合并能避免把 stdio 打爆。这里**不渲染** —— 树由
   * surface 收到 stale 后自己来要（spec「架构约束」）。
   */
  private invalidate(modId: string): void {
    const loaded = this.mods.get(modId);
    if (this.disposed || !loaded || loaded.error || !loaded.runtime) return;
    // 没注册 `ui.render` 的 mod 什么都画不出来，一次 stale 也是空转。
    if (!loaded.runtime.hookNames().includes("ui.render")) return;
    for (const pane of [...this.panes.values()]) {
      if (pane.modId === modId) this.schedulePaneStale(pane);
    }
    this.scheduleBandStale(modId);
  }

  /** 一个面板的合并窗口：`invalidateIntervalMs` 内的多次调用只发一条。 */
  private schedulePaneStale(pane: PaneState): void {
    if (pane.pending) return;
    const wait = Math.max(
      0,
      MOD_LIMITS.invalidateIntervalMs - (Date.now() - pane.lastRenderAt),
    );
    pane.pending = setTimeout(() => {
      pane.pending = undefined;
      this.publishUpdate(pane, { stale: true });
    }, wait);
    pane.pending.unref?.();
  }

  /**
   * 输入框上方那条带的 stale 通知（spec「用户交互的结果」）。
   *
   * 带不是 panel，没有 `PaneState` 可挂：这里直接发一条元信息，`paneId` 用固定
   * 的 `above-prompt`。surface 收到后只重拉带、不建 tab —— 这是只画带的 mod
   * 唯一的重画通道（否则它永远停在挂载时那一帧）。
   */
  private scheduleBandStale(modId: string): void {
    if (this.bandPending.has(modId)) return;
    const lastRenderAt = this.bandLastRenderAt.get(modId) ?? 0;
    const wait = Math.max(
      0,
      MOD_LIMITS.invalidateIntervalMs - (Date.now() - lastRenderAt),
    );
    const timer = setTimeout(() => {
      this.bandPending.delete(modId);
      if (this.disposed) return;
      this.bandLastRenderAt.set(modId, Date.now());
      this.options.onPanelUpdate({
        sessionId: this.options.sessionId,
        modId,
        paneId: MOD_BAND_INSTANCE_ID,
        title: "",
        revision: this.bands.get(modId)?.revision ?? 0,
        stale: true,
      });
    }, wait);
    timer.unref?.();
    this.bandPending.set(modId, timer);
  }

  /**
   * surface 来要树：跑一次 `ui.render` 并把结果回给它（spec「架构约束」）。
   *
   * 失败时返回**上一帧成功的树** + 错误摘要 —— 面板保留可点的内容，错误只
   * 叠在顶上；把整棵树换成一行错误文字会让面板一次性报废。
   */
  async renderPane(
    modId: string,
    paneId: string,
    surface: DrawnSurface = "desktop",
  ): Promise<ModPanelRenderResult> {
    const key = `${modId}\u0000${paneId}`;
    const pane = this.panes.get(key);
    if (this.disposed || !pane) {
      return { modId, paneId, revision: 0, tree: null, error: "面板已关闭" };
    }
    const loaded = this.mods.get(modId);
    if (!loaded) {
      return this.renderFailed(pane, "mod 未加载");
    }
    if (loaded.error || !loaded.runtime) {
      return this.renderFailed(pane, loaded.error ?? "mod 未加载");
    }
    const result = await loaded.runtime.callHook("ui.render", {
      modId: pane.modId,
      paneId: pane.paneId,
      // 三个正交的维度（与 CC 的 `ui_render` 消息同形）：`surface` 是画这棵树
      // 的那一端（决定 `$.ui.resolve(e)` 给哪张元素表），`component` 是画哪个
      // 站点，`instance_id` 是该站点的哪个实例 —— `Pane` 的实例就是
      // `$.ui.open({ id })` 的 id，也就是我们的 paneId。
      surface,
      component: "Pane",
      instance_id: pane.paneId,
      // 站点的 `props`：社区 mod 会读 `e.props.bodyColumns` 这类事实（见
      // `renderSiteProps`）。面板比带高得多，行数分开给。
      props: renderSiteProps(MOD_RENDER_PANE_ROWS),
    });
    if (!result.ok) {
      return this.renderFailed(pane, result.error);
    }
    if (result.value === undefined) {
      // 钩子没注册或明确返回 undefined：面板留空而不是报错。
      pane.tree = null;
      pane.error = undefined;
      pane.revision += 1;
      return { modId, paneId, revision: pane.revision, tree: null };
    }
    const validated = validateModTree(result.value, surface);
    if (!validated.ok) {
      return this.renderFailed(pane, validated.error);
    }
    // 成功这一帧必须**清掉**上一次的错误：交互钩子抛的错也落在 `error` 上
    // （见 `handlePanelEvent`），不清的话用户误点一次报错按钮，面板就永久停在
    // 错误页 —— 之后的请求再成功，`error` 还压在树上。
    pane.tree = validated.tree;
    pane.error = undefined;
    pane.revision += 1;
    return { modId, paneId, revision: pane.revision, tree: validated.tree };
  }

  /**
   * 输入框上方那条带：surface 来要（spec「状态带、状态行与提示」）。
   *
   * 只问注册了 `ui.render` 的 mod（没注册的压根不该占位置）；钩子返回
   * `undefined` 的 mod 回一条空树 —— surface 按「空树不占位置」处理，下一帧它
   * 又有内容时带会自己长回来。
   *
   * 失败与面板同一条纪律：回**上一帧成功的树** + 错误摘要，不把这条带换成一行
   * 错误文字；也从没成功过时回空树 + 错误。
   */
  async renderBand(
    surface: DrawnSurface = "desktop",
  ): Promise<ModBandRenderResult[]> {
    if (this.disposed) return [];
    const bands: ModBandRenderResult[] = [];
    for (const [modId, loaded] of this.mods) {
      if (loaded.error || !loaded.runtime) continue;
      if (!loaded.runtime.hookNames().includes("ui.render")) continue;
      const previous = this.bands.get(modId);
      const result = await loaded.runtime.callHook("ui.render", {
        modId,
        // 与面板同一套三个维度，只是 `component` 换成第二个站点、
        // `instance_id` 是固定值（一期一个 mod 一条带，不按实例区分）。
        surface,
        component: "AbovePrompt",
        instance_id: MOD_BAND_INSTANCE_ID,
        props: renderSiteProps(),
      });
      if (!result.ok) {
        bands.push({
          modId,
          plugin: loaded.plugin,
          revision: previous?.revision ?? 0,
          tree: previous?.tree ?? null,
          error: result.error,
        });
        continue;
      }
      const revision = (previous?.revision ?? 0) + 1;
      if (result.value === undefined) {
        this.bands.set(modId, { revision, tree: null });
        bands.push({
          modId,
          plugin: loaded.plugin,
          revision,
          tree: null,
        });
        continue;
      }
      const validated = validateModTree(result.value, surface);
      if (!validated.ok) {
        bands.push({
          modId,
          plugin: loaded.plugin,
          revision: previous?.revision ?? 0,
          tree: previous?.tree ?? null,
          error: validated.error,
        });
        continue;
      }
      this.bands.set(modId, { revision, tree: validated.tree });
      bands.push({
        modId,
        plugin: loaded.plugin,
        revision,
        tree: validated.tree,
      });
    }
    return this.applyBandList(bands, surface);
  }

  /**
   * 第三个渲染站点 `AbovePromptList`：把这一帧所有行摊给 mod 看，让它重排/隐藏
   * （spec「状态带、状态行与提示」）。
   *
   * 做法与 Claude Code 同一条：行是**交给** mod 的（`e.props.rows[].tree`），mod
   * 答一棵树回来，宿主从这棵树里认出它留下了哪些行、按什么顺序 —— 「What it
   * leaves is what core stacks」。所以既有「换个顺序」也有「不把某行放进去」，
   * 而不需要另一种返回值形状。
   *
   * 四个刻意的取舍：
   *
   * - **fail-open 只覆盖失败**：钩子抛错/超时按**原顺序**画（把带清空是更坏的
   *   默认值，用户会以为插件坏了）。想 fail-closed 就在自己 `.catch` 里返回一棵
   *   不含任何行的树 —— 那被读成「把带清空」，正是 Claude Code 的写法。
   * - **只问显式注册了这个站点的 mod**（`hasSiteHook`）：没写 matcher 的
   *   `ui.render` 处理器会收到每一个站点，而「只画自己那一行」的插件在收到这个
   *   站点时会照样返回自己那棵树 —— 那棵树里恰好有它自己那一行，按「留下哪些
   *   行」的语义等于把所有别人的行都隐藏了。
   * - **不支持「包一层再排版」**：跨插件嵌套之后，`revision`、归属、失败隔离都
   *   要按子树重算；按行重排已经覆盖合并/置顶/折叠。
   * - **不跨 mod 接力**：第一个给出可认结果的 mod 说了算，`next(e)` 之后没有
   *   第二个排序器可问（面板与带也是「一个 mod 一份」，只有这一个站点是全体的）。
   */
  private async applyBandList(
    bands: ModBandRenderResult[],
    surface: DrawnSurface,
  ): Promise<ModBandRenderResult[]> {
    if (this.disposed) return bands;
    const rows = bands.filter((band) => band.tree !== null);
    if (rows.length === 0) return bands;
    const trees = rows.map((row) => row.tree as ModPanelTree);
    const handed = rows.map((row) => ({ plugin: row.plugin, tree: row.tree }));
    // 没有树的带不占位置，重排之后按原相对顺序缀在末尾即可。
    const empty = bands.filter((band) => band.tree === null);
    for (const [modId, loaded] of this.mods) {
      if (loaded.error || !loaded.runtime) continue;
      if (!loaded.runtime.hasSiteHook("ui.render", "AbovePromptList")) continue;
      const result = await loaded.runtime.callHook("ui.render", {
        modId,
        surface,
        component: "AbovePromptList",
        instance_id: MOD_BAND_INSTANCE_ID,
        props: { ...renderSiteProps(), rows: handed },
      });
      if (!result.ok) {
        logger.debug(
          `[Wave] ${loaded.plugin} 的 AbovePromptList 钩子失败，按原顺序画：${result.error}`,
        );
        continue;
      }
      if (result.value === undefined) continue;
      // 显式注册过的排序器答了树，就按它留下的行画 —— 一行都没留下就是**把带
      // 清空**（Claude Code 的「to fail closed, answer no rows in its
      // `.catch`」正是这么写的）。它想「没有意见」就该返回 `undefined`。
      const picked = pickBandRows(result.value, trees);
      return [...picked.map((index) => rows[index]!), ...empty];
    }
    return bands;
  }

  private renderFailed(pane: PaneState, error: string): ModPanelRenderResult {
    pane.error = error;
    return {
      modId: pane.modId,
      paneId: pane.paneId,
      revision: pane.revision,
      tree: pane.tree,
      error,
    };
  }

  private payloadOf(
    pane: PaneState,
    extra: { stale?: boolean; closed?: boolean; focus?: boolean } = {},
  ): ModPanelUpdatePayload {
    return {
      sessionId: this.options.sessionId,
      modId: pane.modId,
      paneId: pane.paneId,
      title: pane.title,
      revision: pane.revision,
      ...(extra.stale ? { stale: true } : {}),
      ...(extra.closed ? { closed: true } : {}),
      ...(extra.focus ? { focus: true } : {}),
      ...(pane.error ? { error: pane.error } : {}),
    };
  }

  /**
   * `$.ui.status` 的出口（spec「状态带、状态行与提示」）。
   *
   * 宿主不替 mod 记住这一行：真实来源是 mod 自己的 `$.state`，surface 重连后由
   * mod 下次贴一次。没人画状态行的宿主（CLI）不传 `onStatus`，调用照常成功、
   * 只是没人展示 —— 与 `$.ui.open` 在没人画面板时同一条纪律。
   */
  private publishStatus(modId: string, text: string | null): void {
    if (this.disposed) return;
    const plugin = this.pluginOf(modId);
    if (text === null) this.statusLines.delete(modId);
    else this.statusLines.set(modId, { plugin, text });
    this.options.onStatus?.({
      sessionId: this.options.sessionId,
      modId,
      plugin,
      text,
    });
  }

  /** `$.ui.toast` 的出口；`timeoutMs` 已由 runtime 夹进限额。 */
  private publishToast(modId: string, text: string, timeoutMs: number): void {
    if (this.disposed) return;
    this.options.onToast?.({
      sessionId: this.options.sessionId,
      modId,
      plugin: this.pluginOf(modId),
      text,
      timeoutMs,
    });
  }

  /**
   * `$.ui.log` 的出口（spec「在对话流里留一行」）。
   *
   * 与 toast 不同，这一行属于会话：出口接的是 `MessageManager.addNoticeBlock`，
   * 所以它会随会话落盘、但不进模型上下文。没有落点（没人接）时丢弃并记 debug
   * —— 让 mod 因为「宿主不显示对话流」而报错没有意义。
   */
  private appendLog(text: string): void {
    if (this.disposed) return;
    if (!this.logSink) {
      logger.debug(`[Wave] $.ui.log 没有落点，丢弃一行：${text}`);
      return;
    }
    this.logSink(text);
  }

  /**
   * `$.tool.register`（spec「把我们自己的工具交给模型」）。
   *
   * 名字已经是 `mcp__<plugin>__<name>`：那个前缀让 `isRestrictedTool()` 把它归
   * 进受限工具，于是它与 MCP 工具走同一条审批路 —— 用户看得见、能拒。
   */
  private registerModTool(
    modId: string,
    plugin: string,
    spec: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    },
  ): Promise<{ name: string }> {
    const bridge = this.toolBridge;
    if (!bridge) {
      throw new Error("这个会话没有工具表，$.tool.register 无处可去");
    }
    const owned = this.ownedTools.get(modId) ?? new Set<string>();
    // 同一个 mod 重复注册同一个名字是幂等的（与 `$.command.register` 同款）。
    if (owned.has(spec.name)) return Promise.resolve({ name: spec.name });
    if (owned.size >= MOD_LIMITS.modToolsPerMod) {
      throw new Error(
        `$.tool.register 一个 mod 最多注册 ${MOD_LIMITS.modToolsPerMod} 个工具`,
      );
    }
    const outcome = bridge.register({ ...spec, plugin });
    if (!outcome.ok) throw new Error(outcome.reason);
    owned.add(spec.name);
    this.ownedTools.set(modId, owned);
    logger.info(`[Wave] $.tool.register (${plugin}): ${spec.name} listed`);
    return Promise.resolve({ name: spec.name });
  }

  /**
   * 这个名字是不是某个 mod 通过 `$.tool.register` 交上去的。
   *
   * `tool.call` 只对这类工具接受 `{ result }`（别的工具真会执行，顶替结果等于
   * 伪造事实）；调用没人接时也靠它认出「本该由插件答」的那一次。
   */
  ownsTool(name: string): boolean {
    for (const owned of this.ownedTools.values()) {
      if (owned.has(name)) return true;
    }
    return false;
  }

  /** 撤销某个 mod 注册过的全部工具（重载、销毁、`session.end`）。 */
  private dropOwnedTools(modId?: string): void {
    const bridge = this.toolBridge;
    const targets = modId ? [modId] : [...this.ownedTools.keys()];
    for (const target of targets) {
      const owned = this.ownedTools.get(target);
      if (!owned) continue;
      for (const name of owned) bridge?.unregister(name);
      this.ownedTools.delete(target);
    }
  }

  /**
   * `$.agent.spawn`（spec「派子代理」）。
   *
   * resolve 在子代理 **started** 之后，不等它跑完：结果在它自己的
   * `turn.complete` 里。并发上限按 mod 数（不是按插件）：拆成三个 mod 的插件
   * 想多开就多开，那本来就是三条独立的工作流。
   */
  private async spawnModAgent(
    modId: string,
    plugin: string,
    args: {
      prompt: string;
      description?: string;
      subagentType?: string;
      model?: string;
    },
  ): Promise<{ model: string; agentId?: string }> {
    const bridge = this.agentBridge;
    if (!bridge) {
      throw new Error("这个会话没有子代理，$.agent.spawn 无处可去");
    }
    if ((this.activeModAgents.get(modId) ?? 0) >= MOD_LIMITS.modAgentsPerMod) {
      throw new Error(
        `$.agent.spawn 一个 mod 同时最多有 ${MOD_LIMITS.modAgentsPerMod} 个子代理在跑`,
      );
    }
    // 先占名额再 await：判定与自增之间隔着一次真正的派发，5 个并发的
    // `$.agent.spawn` 会在自增之前全读到同一个旧值，把上限撑破。
    this.activeModAgents.set(modId, (this.activeModAgents.get(modId) ?? 0) + 1);
    const release = () => {
      const left = (this.activeModAgents.get(modId) ?? 1) - 1;
      if (left > 0) this.activeModAgents.set(modId, left);
      else this.activeModAgents.delete(modId);
    };
    let handle: { model: string; agentId?: string };
    /** 链尾拿到的那次派发的结局；链没走到尾就是 undefined。 */
    let settled: Promise<unknown> | undefined;
    try {
      // 同一条链（spec「派子代理」）：mod 自己派的子代理，别的插件也拦得住 ——
      // 「让 mod 拦下**任何**子代理起跑之前」。
      const decision = await this.dispatchAgentSpawn(
        {
          tool_use_id: "",
          prompt: args.prompt,
          ...(args.description === undefined
            ? {}
            : { description: args.description }),
          ...(args.subagentType === undefined
            ? {}
            : { subagentType: args.subagentType }),
          ...(args.model === undefined ? {} : { model: args.model }),
        },
        async (current) => {
          const event = isPlainRecord(current) ? current : {};
          const spawned = await bridge.spawn({
            ...args,
            prompt:
              typeof event.prompt === "string" ? event.prompt : args.prompt,
            ...(typeof event.description === "string"
              ? { description: event.description }
              : {}),
            ...(typeof event.subagentType === "string"
              ? { subagentType: event.subagentType }
              : {}),
            ...(typeof event.model === "string" ? { model: event.model } : {}),
            plugin,
            modId,
          });
          settled = spawned.settled;
          return { model: spawned.model, agentId: spawned.agentId };
        },
      );
      if (decision.deny) throw new Error(decision.deny);
      // 链没走到尾（有钩子自己答了个 `{ model }` 却没 `next`）＝ 一个子代理都
      // 没起：不能让 mod 以为派成功了。
      if (!decision.value || !settled) {
        throw new Error("插件接管了这次派发，但没有启动子代理");
      }
      handle = decision.value;
    } catch (error) {
      release();
      throw error;
    }
    // 子代理的结局不重要（结果在它自己的 `turn.complete` 里）：这里只还名额。
    void (settled ?? Promise.resolve()).then(release, release);
    return { model: handle.model, agentId: handle.agentId };
  }

  /**
   * `$.model.complete`（spec「让模型替插件答一次」）。
   *
   * 额度用完**抛错**而不是答一个 `reason`：CC 的 `reason` 说的是「这次请求怎么
   * 了」，而额度是「根本没发这次请求」，混进同一个联合里会让插件以为 provider
   * 出了毛病、去做无意义的重试。
   */
  private async completeModModel(
    modId: string,
    plugin: string,
    request: {
      model: string;
      prompt: string;
      system?: string;
      maxTokens: number;
      signal?: AbortSignal;
    },
  ): Promise<ModModelCompleteResult> {
    const bridge = this.modelBridge;
    if (!bridge) {
      throw new Error("这个会话没有模型通道，$.model.complete 无处可去");
    }
    const used = this.modModelCalls.get(plugin) ?? 0;
    if (used >= MOD_LIMITS.modModelCallsPerSession) {
      throw new Error(
        `$.model.complete 每条会话每个插件最多 ${MOD_LIMITS.modModelCallsPerSession} 次（${plugin} 已用完）`,
      );
    }
    // 先记账再发请求：超时/报错的调用同样花了额度，否则「失败重试」能把额度刷穿。
    this.modModelCalls.set(plugin, used + 1);
    logger.debug(
      `[Wave] $.model.complete (${plugin}, ${modId}): ${request.model}`,
      {
        maxTokens: request.maxTokens,
      },
    );
    return await bridge.complete({ ...request, plugin });
  }

  /**
   * `$.prompt.suggest`（spec「输入框里的建议与焦点」）。
   *
   * 与 `fillPrompt` 一样不抛错：没人画输入框（终端、headless）时答
   * `{ isShown: false }`，mod 自己降级。
   */
  private async suggestPrompt(request: {
    text: string;
    plugin: string;
  }): Promise<{ isShown: boolean }> {
    const suggest = this.promptSuggestionSink;
    if (this.disposed || !suggest) return { isShown: false };
    // 与引擎自己的推荐走同一条链（spec「输入框里的建议与焦点」）：`e.origin`
    // 标明是谁提的，别的 mod 能换 `text`，也能用 `{ isShown: false }` 否掉。
    // 链尾才是「问宿主摆不摆」——真摆了之后回包里的 `text` 就是摆上去的那条。
    const result = await this.dispatchPromptSuggest(
      { text: request.text, origin: { kind: "plugin", name: request.plugin } },
      async (current) => {
        const text =
          isPlainRecord(current) && typeof current.text === "string"
            ? current.text
            : request.text;
        try {
          const answer = await suggest({ text, plugin: request.plugin });
          return { isShown: answer.isShown };
        } catch (error) {
          logger.debug("[Wave] 摆建议失败", error);
          return { isShown: false };
        }
      },
    );
    return { isShown: result.isShown };
  }

  /**
   * `$.command.register`（spec「注册命令」）。
   *
   * 归属记在 `ownedCommands` 里：重载与销毁要按 mod 撤销（命令的 handler 闭包指
   * 向这个沙箱，留着就是一个打到已销毁会话上的僵尸）；重名则原样抛给 mod。
   */
  private registerCommand(
    modId: string,
    plugin: string,
    spec: ModCommandSpec,
  ): { command: string } {
    const bridge = this.commandBridge;
    if (!bridge) {
      throw new Error("这个会话没有命令表，$.command.register 无处可去");
    }
    const owned = this.ownedCommands.get(modId) ?? new Set<string>();
    // 同一个 mod 重复注册同一个名字是幂等的（CC 同款：只在命令表里留一条）。
    if (owned.has(spec.name)) {
      logger.debug(
        `[Wave] $.command.register (${plugin}): /${spec.name} unchanged; not re-registered`,
      );
      return { command: spec.name };
    }
    if (owned.size >= MOD_LIMITS.maxCommandsPerMod) {
      throw new Error(
        `$.command.register 一个 mod 最多注册 ${MOD_LIMITS.maxCommandsPerMod} 条命令`,
      );
    }
    const outcome = bridge.register({
      ...spec,
      plugin,
      // 用户执行这条命令时回到本沙箱：钩子答什么，这一行就变成什么。
      run: async (args) => this.runCommandHook(modId, spec.name, args),
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    owned.add(spec.name);
    this.ownedCommands.set(modId, owned);
    logger.info(`[Wave] $.command.register (${plugin}): /${spec.name} listed`);
    return { command: spec.name };
  }

  /**
   * 派一条 `command.run` 钩子，取出它答的那段文字。
   *
   * 三种「没人答得上来」都返回 `undefined`：mod 没注册对应 matcher、钩子抛错、
   * 返回的不是 `{ text: string }`。由命令表那边统一报「注册了但没钩子回答」，
   * 免得同一件事在两处给两种文案。
   */
  private async runCommandHook(
    modId: string,
    name: string,
    args: string,
  ): Promise<string | undefined> {
    const runtime = this.mods.get(modId)?.runtime;
    if (!runtime) return undefined;
    const result = await runtime.callCommandHook(`/${name}`, args);
    if (!result.ok) {
      logger.warn(`[Wave] ${modId} 的 /${name} 命令钩子失败：${result.error}`);
      return undefined;
    }
    const value = result.value;
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { text?: unknown }).text === "string"
    ) {
      return (value as { text: string }).text;
    }
    return undefined;
  }

  /** `$.command.run`：以 mod 身份执行一条已注册的命令。 */
  private async runCommand(command: string, args?: string): Promise<void> {
    const bridge = this.commandBridge;
    if (!bridge) {
      throw new Error("这个会话没有命令表，$.command.run 无处可去");
    }
    await bridge.run(command, args);
  }

  /**
   * 撤销某个 mod 注册过的全部命令（重载、销毁）。
   *
   * 逐个名单条命令，而不是按插件整批撤：同一个插件可能还有 markdown 命令（那些
   * 归 `PluginManager` 管），这里只碰 mod 自己注册的。
   */
  private dropOwnedCommands(modId?: string): void {
    const bridge = this.commandBridge;
    const targets = modId ? [modId] : [...this.ownedCommands.keys()];
    for (const target of targets) {
      const owned = this.ownedCommands.get(target);
      if (!owned) continue;
      for (const name of owned) bridge?.unregister(name);
      this.ownedCommands.delete(target);
    }
  }

  /** 插件注册名（署名用）；`modId` 是 `<pluginName>:<fileStem>`，但别去拆它。 */
  private pluginOf(modId: string): string {
    return this.mods.get(modId)?.plugin ?? modId;
  }

  /** 发一条元信息通知（不带树）；`stale` 表示 surface 该来要树了。 */
  private publishUpdate(
    pane: PaneState,
    extra: {
      stale?: boolean;
      closed?: boolean;
      error?: string;
      focus?: boolean;
    },
  ): void {
    if (this.disposed) return;
    if (extra.error !== undefined) pane.error = extra.error;
    pane.lastRenderAt = Date.now();
    const current = this.panes.get(`${pane.modId}\u0000${pane.paneId}`);
    if (current && current !== pane) current.error = pane.error;
    this.options.onPanelUpdate(this.payloadOf(pane, extra));
  }
}
