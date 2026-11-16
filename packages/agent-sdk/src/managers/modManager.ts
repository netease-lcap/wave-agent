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
import {
  MOD_BAND_INSTANCE_ID,
  MOD_LIMITS,
  MOD_RENDER_BODY_COLUMNS,
  type ModBandRenderResult,
  type ModCommandBridge,
  type ModCommandSpec,
  type ModPanelEventPayload,
  type ModPanelRenderResult,
  type ModPanelTree,
  type ModPanelUpdatePayload,
  type ModPermissionRequestEvent,
  type ModPromptFillMode,
  type ModPromptSubmitResult,
  type ModSessionCompactEvent,
  type ModSessionMeasureTrigger,
  type ModSessionUsage,
  type ModSettingsSource,
  type ModStatusPayload,
  type ModToastPayload,
  type ModTokenTotals,
  type ModToolCallEvent,
  type ModTurnCompleteEvent,
  type ModTurnCompleteTrigger,
  type ModTurnStartEvent,
  type ModTurnStepEvent,
  type PluginMod,
} from "../types/mods.js";
import type { Plugin } from "../types/plugins.js";
import { atomicWriteFileSync } from "../utils/atomicWrite.js";
import { getEsbuild } from "../utils/esbuild.js";
import { logger } from "../utils/globalLogger.js";

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
  env(name: string): string | undefined;
  settings(query: {
    source?: ModSettingsSource;
    key?: string;
  }): Promise<unknown>;
}

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
function withCommunityUsage(
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
 * 来的，路线上拿不到），`bodyColumns` 见 {@link MOD_RENDER_BODY_COLUMNS}。
 * 先给「中性且稳定」的一组值 —— 缺字段会让社区 mod 的 `e.props.hasSurvey` 直接
 * 抛错，那些 mod 连画都画不出来。
 */
function renderSiteProps(): Record<string, unknown> {
  return {
    hasSurvey: false,
    isWorking: false,
    bodyColumns: MOD_RENDER_BODY_COLUMNS,
    maxRows: 8,
    scroll: { offset: 0, bodyRows: 8 },
    view: {},
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
   * `$.command.*` 的桥（spec「注册命令」）。
   *
   * 命令表在 `SlashCommandManager` 里，而「执行一条命令时该问哪个 mod 的钩子」
   * 只有这里知道 —— 两边互相持有会成环，所以由 `containerSetup` 组装一个桥：
   * 注册/列表/执行都转给命令表，回调里再回到本 manager 派 `command.run`。
   */
  private commandBridge?: ModCommandBridge;
  /** 每个 mod 注册了哪些命令（`<modId>` → 命令名集合），卸载与重载时清理。 */
  private readonly ownedCommands = new Map<string, Set<string>>();
  private disposed = false;

  constructor(private readonly options: ModManagerOptions) {
    this.storeRoot =
      options.storeRoot ?? path.join(homedir(), ".wave", "plugin-mods");
    this.facts = options.sessionFacts ?? {
      sessionId: () => options.sessionId,
      workspaceRoot: () => options.workdir?.() ?? process.cwd(),
      model: () => "",
      env: () => undefined,
      // `key` 由数据源自己取（它有那份配置）；兜底没配置可查，所以带 key 时
      // 与「没这一项」同义。
      settings: async (query) => (query.key === undefined ? {} : undefined),
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

  /** 接上用量快照（见 `sessionUsageProvider`）。 */
  setSessionUsageProvider(fn: () => ModSessionUsage): void {
    this.sessionUsageProvider = fn;
  }

  /** 接上对话流的写入口（见 `logSink`）。 */
  setLogSink(fn: (text: string) => void): void {
    this.logSink = fn;
  }

  /** 接上命令表（见 `commandBridge`）。 */
  setCommandBridge(bridge: ModCommandBridge): void {
    this.commandBridge = bridge;
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
              openPane: (paneId, title) => this.openPane(mod.id, paneId, title),
              closePane: (paneId) => this.closePane(mod.id, paneId),
              listPanes: () => this.listPanes(mod.id),
              invalidate: () => this.invalidate(mod.id),
              setStatus: (text) => this.publishStatus(mod.id, text),
              showToast: (text, timeoutMs) =>
                this.publishToast(mod.id, text, timeoutMs),
              appendLog: (text) => this.appendLog(text),
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
              envGet: (name) => this.facts.env(name),
              settingsRead: (query) => this.facts.settings(query),
              sleep: (ms, signal) => this.startSleep(mod.id, ms, signal),
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
   * `session.compact` / `tool.call` / `classic.PermissionRequest`，spec「事件」
   * 「轮次内外的事件」「完成与审批的观察」）。
   *
   * 不等 mod、也不返回 Promise：这些时刻都压在宿主的关键路径上（轮次起收尾、
   * 每次请求之前、工具刚跑完、审批卡片即将弹出），mod 在里面做网络上报不能把
   * 用户的中断、下一个请求或那道审批拖住。钩子失败、超时只记一条 warn —— 事件
   * 丢了就丢了，宿主不回滚、不重试、不排队（瞬时事件本来就没有「补发」这回事）。
   * 唯一要等返回值的是 `prompt.submit`（见 {@link collectPromptContext}）与
   * `session.end`（见 {@link endSession}）。
   */
  notifyMods(
    event:
      | "turn.start"
      | "turn.step"
      | "turn.complete"
      | "session.measure"
      | "session.compact"
      | "tool.call"
      | "classic.PermissionRequest",
    payload:
      | ModTurnStartEvent
      | ModTurnStepEvent
      | ModTurnCompleteTrigger
      | ModSessionMeasureTrigger
      | ModSessionCompactEvent
      | ModToolCallEvent
      | ModPermissionRequestEvent,
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
      const handled = await loaded.runtime.dispatch(
        payload.kind,
        payload.key,
        payload.value,
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
    // 先关面板再进终态：`closed: true` 是界面关掉 tab 的唯一信号，而
    // `publishUpdate` 在 `disposed` 之后一律静默。这里**不**逐条发 `ui.close`：
    // 会话销毁只发一次 `session.end`（spec「事件」）。
    this.closeAllPanes(false);
    this.bands.clear();
    this.statusLines.clear();
    this.disposed = true;
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
    // 早于 `mods.clear()`：`ui.close` 要发给还活着的旧实例（spec「事件」）。
    this.closeAllPanes(true);
    this.bands.clear();
    this.statusLines.clear();
    this.mods.clear();
    this.state.clear();
    await this.loadFromPlugins(plugins);
    await this.startSession();
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
        const result = timer.run();
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

  private readStore(pluginName: string): Record<string, string> {
    try {
      const raw = fs.readFileSync(
        storePath(this.storeRoot, pluginName),
        "utf-8",
      );
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private writeStore(pluginName: string, store: Record<string, string>): void {
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

  private openPane(modId: string, paneId: string, title: string): void {
    if (this.disposed) return;
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
    this.panes.set(key, pane);
    // 只登记 + 通知 surface 来要树，不在这里渲染（spec「架构约束」）。
    this.publishUpdate(pane, { stale: true });
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
      surface: "desktop",
      component: "Pane",
      instance_id: pane.paneId,
      // 站点的 `props`：社区 mod 会读 `e.props.bodyColumns` 这类事实（见
      // `renderSiteProps`）。
      props: renderSiteProps(),
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
    const validated = validateModTree(result.value);
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
  async renderBand(): Promise<ModBandRenderResult[]> {
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
        surface: "desktop",
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
      const validated = validateModTree(result.value);
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
    extra: { stale?: boolean; closed?: boolean } = {},
  ): ModPanelUpdatePayload {
    return {
      sessionId: this.options.sessionId,
      modId: pane.modId,
      paneId: pane.paneId,
      title: pane.title,
      revision: pane.revision,
      ...(extra.stale ? { stale: true } : {}),
      ...(extra.closed ? { closed: true } : {}),
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
    extra: { stale?: boolean; closed?: boolean; error?: string },
  ): void {
    if (this.disposed) return;
    if (extra.error !== undefined) pane.error = extra.error;
    pane.lastRenderAt = Date.now();
    const current = this.panes.get(`${pane.modId}\u0000${pane.paneId}`);
    if (current && current !== pane) current.error = pane.error;
    this.options.onPanelUpdate(this.payloadOf(pane, extra));
  }
}
