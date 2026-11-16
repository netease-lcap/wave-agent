import * as vm from "node:vm";
import * as path from "node:path";
import type {
  ModCommandInfo,
  ModCommandSpec,
  ModElementType,
  ModFetchResult,
  ModFsEntry,
  ModFsStat,
  ModRunOptions,
  ModRunResult,
  ModTreeNode,
  ModSpawnOptions,
  ModProcessChunk,
  ModProcessExit,
  ModPropValue,
  ModPromptFillMode,
  ModSessionUsage,
  ModSettingsSource,
} from "../types/mods.js";
import { MOD_LIMITS, MOD_SETTINGS_SOURCES } from "../types/mods.js";
import {
  Box,
  Text,
  Button,
  Input,
  Select,
  Svg,
  Link,
  Code,
  Markdown,
  Progress,
} from "./index.js";
import { ModFs } from "./files.js";
import { modFetch } from "./http.js";
import { logger } from "../utils/globalLogger.js";

/**
 * mod 的执行沙箱。
 *
 * 编译产物是 CJS，这里给它一个**干净的** vm context：只有 `__wave`（`h` /
 * `Fragment` / 元素构造器）、一个转发到 `wave` 日志的 `console`，以及我们
 * 自己的 `require` —— 没有 `process`、没有 `Buffer`、没有 `node:*`，`eval` /
 * `new Function` 也由 context 的 `codeGeneration` 开关关掉。
 *
 * 这是**进程内隔离**，不是安全边界：mod 是用户自己装的插件代码，和 hooks /
 * MCP server 同一个信任层级。它挡的是「误写 `process.exit()` 把会话带走」，
 * 不是「恶意代码想跑出去」。
 */

/**
 * 元素构造器：`h()` 只认字符串 tag，所以构造器本身就是 tag 名。
 *
 * 名单不许在这里另写一份 —— `./index.js` 才是插件作者 `import` 的那份（也是
 * `wave-agent-sdk/mods` 子路径的产物），两边漂移会让 `<Text>` 编译出来的 tag
 * 在渲染器里变成未知元素。`tests/mods/runtime.test.ts` 钉住了它与
 * `ModElementType` 的一致性。
 */
const ELEMENT_CONSTRUCTORS = [
  Box,
  Text,
  Button,
  Input,
  Select,
  Svg,
  Link,
  Code,
  Markdown,
  Progress,
];

const elements = Object.fromEntries(
  ELEMENT_CONSTRUCTORS.map((name) => [String(name), String(name)]),
) as Record<ModElementType, ModElementType>;

/**
 * 画这棵树的那一端 —— `ui.render` 的 `e.surface`，也是 `$.ui.resolve(e)` 选
 * 元素表的键。
 *
 * Claude Code 的表里有四端：`terminal` / `desktop` / `mobile` / `vscode`，各自的
 * 元素集不同（`terminal` 有 `Raster` / `Image` 没有 `Svg`，`desktop` 反过来）。
 * 我们一期只发 `desktop` —— 别的值当错处理，别让它悄悄拿到桌面端的表。
 */
const SURFACE = "desktop";

/**
 * 这一端上能画的站点：`ui.render` 的 `e.component`。
 *
 * 一期两处：右侧面板（`Pane`）与输入框上方的带（`AbovePrompt`）—— 宿主两处都
 * 会发 `ui.render`，漏一个就等于让那一处的 mod 在 `$.ui.resolve(e)` 上抛错。
 * CC 的表里还有 15 个（`ToolUse`、`PromptHint`…），加站点时往这里加，别在别处
 * 另写一份。
 */
const RENDER_SITES: readonly string[] = ["Pane", "AbovePrompt"];

/**
 * 冻结的元素表：每次 `$.ui.resolve(e)` 返回同一份，mod 改不到它。
 *
 * CC 的桌面端表是 11 个，我们放真画得出的那 10 个 —— 只差 `Client`（要在渲染端
 * 执行 mod 附带的第二份模块，spec「交付分层」没做）。给了画不出的名字，mod 编出
 * 的树会被 `validateModTree` 拒掉，错误离原因更远。
 */
const ELEMENT_TABLE: Readonly<Record<ModElementType, ModElementType>> =
  Object.freeze({ ...elements });

/**
 * 把 `ui.render` 的事件换成这一端可用的元素表。
 *
 * 传错参数（不是 render 事件、没见过的 surface / component）当场报错并列出
 * 可用名单 —— 返回半张表会让 mod 在 `<undefined>` 上炸，错误离原因更远。
 */
function resolveElements(
  event: unknown,
): Readonly<Record<ModElementType, ModElementType>> {
  const e = (typeof event === "object" && event !== null ? event : {}) as {
    surface?: unknown;
    component?: unknown;
  };
  const surface = typeof e.surface === "string" ? e.surface : undefined;
  if (surface !== SURFACE) {
    throw new Error(
      `$.ui.resolve 需要一个 ui.render 的事件（e.surface 是画这棵树的那一端，一期只有 ${SURFACE}${surface === undefined ? "" : `，拿到的是 "${surface}"`}）`,
    );
  }
  const component = typeof e.component === "string" ? e.component : "";
  if (!RENDER_SITES.includes(component)) {
    throw new Error(
      `$.ui.resolve 不认识站点 "${component}"（一期只画 ${RENDER_SITES.join(" / ")}）`,
    );
  }
  return ELEMENT_TABLE;
}

/**
 * 状态行 / 提示的文本：纯文本，截到限额并加省略号。
 *
 * `null` 与空串都表示「清掉那一行」—— 空串在界面上只会留一条空行，没有别的
 * 含义，按清除处理比让 mod 作者记两条规则好。
 */
function normalizeStatus(text: unknown): string | null {
  if (text === null || text === undefined) return null;
  if (typeof text !== "string") {
    throw new Error("$.ui.status 需要一段文本（null 清除）");
  }
  if (text.trim().length === 0) return null;
  return text.length > MOD_LIMITS.statusChars
    ? `${text.slice(0, MOD_LIMITS.statusChars)}…`
    : text;
}

/** `$.ui.toast` 的停留时间：默认 4000ms，超过上限夹住（都是我们的限额）。 */
function toastMs(timeoutMs: unknown): number {
  if (timeoutMs === undefined) return MOD_LIMITS.toastDefaultMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    throw new Error("$.ui.toast 的第二个参数是停留毫秒数");
  }
  if (timeoutMs <= 0) return MOD_LIMITS.toastDefaultMs;
  return Math.min(timeoutMs, MOD_LIMITS.toastMaxMs);
}

/** 命令名的合法形状（与 Claude Code 同一条：`/^[a-zA-Z0-9_-]{1,64}$/`）。 */
const COMMAND_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * 校验 `$.command.register` 的参数，再交给宿主。
 *
 * 校验放这里（而不是宿主）与其它 `$` 方法一致：形状错误是 mod 写错了，要在
 * 调用点就带着能改的文案报出来，而不是变成宿主日志里一条莫名的 warn。
 */
function validateCommandSpec(spec: unknown): ModCommandSpec {
  if (!isPlainObject(spec)) {
    throw new Error(
      "$.command.register 需要一个对象：{ name, description, argumentHint?, immediate? }",
    );
  }
  const name = spec.name;
  if (typeof name !== "string" || !COMMAND_NAME_RE.test(name)) {
    throw new Error(
      "$.command.register 的 name 只能用小写/大写字母、数字、下划线和连字符（1-64 个）",
    );
  }
  const description = spec.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(
      "$.command.register 需要 description（菜单里显示的那行字，不能为空）",
    );
  }
  const argumentHint = spec.argumentHint;
  if (argumentHint !== undefined && typeof argumentHint !== "string") {
    throw new Error("$.command.register 的 argumentHint 是字符串");
  }
  const immediate = spec.immediate;
  if (immediate !== undefined && typeof immediate !== "boolean") {
    throw new Error("$.command.register 的 immediate 是布尔值");
  }
  return {
    name,
    description: description.trim(),
    ...(argumentHint === undefined ? {} : { argumentHint }),
    ...(immediate === undefined ? {} : { immediate }),
  };
}

/**
 * 校验 `$.settings.read` 的参数（spec「环境变量与设置（只读）」）。
 *
 * 四种形式：`read()` / `read({ source })` / `read({ key })` /
 * `read({ source, key })`。`source` 只认我们自己有的三层 —— Claude Code 的表里
 * 还有 `flag` / `policy`，我们没有那两层，写错了要当场报出来并列出可用值，
 * 而不是安静地返回一份合并结果（那会让插件以为读到了策略层）。
 */
function normalizeSettingsQuery(query: unknown): {
  source?: ModSettingsSource;
  key?: string;
} {
  if (query === undefined) return {};
  if (!isPlainObject(query)) {
    throw new Error("$.settings.read 只接受 { source }、{ key } 或无参数");
  }
  const source = query.source;
  if (
    source !== undefined &&
    !(MOD_SETTINGS_SOURCES as readonly unknown[]).includes(source)
  ) {
    throw new Error(
      `$.settings.read 的 source 只允许 ${MOD_SETTINGS_SOURCES.map((s) => `"${s}"`).join("、")}`,
    );
  }
  const key = query.key;
  if (key !== undefined && typeof key !== "string") {
    throw new Error(
      "$.settings.read 的 key 是字符串（顶层键，不做 . 路径展开）",
    );
  }
  return {
    ...(source === undefined ? {} : { source: source as ModSettingsSource }),
    ...(key === undefined ? {} : { key }),
  };
}

/** 定时器句柄：`cancel()` 可重复调用。 */
export interface ModTimerHandle {
  cancel(): void;
}

/** 事件钩子能拿到的 `$`（见 spec「$（一期）」）。 */
export interface ModDollar {
  plugin: { name: string };
  ui: {
    /** `ui.render` 的事件 → 该站点可用的元素构造器表（spec「事件」）。 */
    resolve(event: unknown): Readonly<Record<ModElementType, ModElementType>>;
    open(pane: { id: string; title: string }): void;
    close(id: string): void;
    panes(): string[];
    /**
     * 「我这个 mod 画的东西过期了」——参数是**渲染站点的生产者**，一期只有
     * `"ui.render"`（spec「用户交互的结果」）。
     *
     * 不是面板 id：一次调用作用于该 mod 的**所有**站点，面板与输入框上方那条
     * 带都重画。带平时只在 surface 挂载时拉一次，没有这条通道就只能永远停在
     * 第一帧（Claude Code 的 `$.ui.invalidate("ui.render")` 是同一个形状）。
     */
    invalidate(target: string): void;
    /** 输入框下方那一行常驻状态（每个插件一条）；`null` 清除。 */
    status(text: string | null): void;
    /** 输入框下方的短暂提示；`timeoutMs` 默认 4000ms、最多 10 秒。 */
    toast(text: string, timeoutMs?: number): void;
    /**
     * 在**对话流**里留一行（spec「在对话流里留一行」）。
     *
     * 与 `status` / `toast` 的区别是它属于这次对话：随会话落盘、切回来还在，
     * 但不进模型上下文。一期只有 `to: "transcript"` 这一个落点。
     */
    log(text: string, options?: { to?: "transcript" }): void;
  };
  state: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  store: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    keys(): string[];
  };
  /**
   * 定时器（spec「定时器」）与等待（spec「时钟：等待」）。
   *
   * 沙箱里没有 `setTimeout`/`setInterval`：定时器登记在宿主上，会话销毁或插件
   * 重载时才撤销得掉 —— 裸定时器会留在进程里继续跑，然后打到已经销毁的会话上。
   * `sleep` 同理：未完成的等待在销毁时 reject，不会留一个 resolve 到已死会话上
   * 的 Promise。
   */
  clock: {
    now(): number;
    sleep(ms: number, options?: { signal?: AbortSignal }): Promise<void>;
    after(ms: number, fn: () => unknown): ModTimerHandle;
    every(ms: number, fn: () => unknown): ModTimerHandle;
  };
  /**
   * 外部进程（spec「外部进程」）。
   *
   * 沙箱里没有 `child_process`；与 `$.clock` 同一条纪律，进程归宿主所有，
   * 会话销毁或插件重载时由宿主一起杀掉。
   */
  process: {
    spawn(
      options: ModSpawnOptions,
    ): AsyncGenerator<ModProcessChunk, ModProcessExit>;
    run(argv: string[], options?: ModRunOptions): Promise<ModRunResult>;
  };
  /**
   * 文件（spec「读写文件」）。
   *
   * 沙箱里没有 `fs`。相对路径按会话**当前**工作目录解析（会随 `cd` 动），与
   * `$.process.spawn` 的 `cwd` 缺省值同一条口径。
   */
  fs: {
    read(
      filePath: string,
      options?: { as?: "text" | "bytes" },
    ): Promise<string | { base64: string }>;
    write(filePath: string, text: string): Promise<void>;
    list(dirPath: string): Promise<ModFsEntry[]>;
    stat(filePath: string): Promise<ModFsStat>;
    exists(filePath: string): Promise<boolean>;
  };
  /**
   * 网络（spec「发 HTTP 请求」）。
   *
   * 沙箱里没有 `fetch`。只允许 `https:` 与本机回环的 `http:`。
   */
  http: {
    fetch(
      url: string,
      options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeoutMs?: number;
      },
    ): Promise<ModFetchResult>;
  };
  /**
   * 把一条 prompt 投进**当前会话**（spec「把 prompt 送进对话」）。
   *
   * 不是「用户当前看着的会话」：mod 活在某个会话的进程里，这份 `$` 就只属于
   * 那个会话。跨会话是另一件事，一期没有。
   */
  prompt: {
    submit(options: { text: string; asUser?: boolean }): Promise<void>;
    /**
     * 把草稿填进用户正看着的输入框、**不发送**（spec「把草稿填进输入框」）。
     *
     * `isFilled: false` 是正常结果：终端 CLI、没有 surface 接手、对话框占着
     * 键、5 秒没有回执，都是这一种。mod 拿它决定要不要降级成 `submit`。
     */
    fill(options: {
      text: string;
      mode?: ModPromptFillMode;
    }): Promise<{ isFilled: boolean }>;
  };
  /**
   * 只读的会话快照（spec「会话用量」）。
   *
   * 现取现算、不订阅：`usage()` 每次返回一份新对象，mod 拿它画画，改不动会话
   * 里的任何东西。要看它变化就在自己的定时器或 `ui.render` 里再问一次。
   */
  session: {
    usage(): ModSessionUsage;
    /**
     * 会话**当前**工作目录（容器 token `CurrentWorkdir`，会随会话里的 `cd`
     * 变）。与 `$.fs` 相对路径、`$.process` 的缺省 cwd 是同一份数据源 ——
     * 三者口径必须一致，否则插件算出来的路径会与它读写的位置分叉。
     */
    cwd(): string;
    /**
     * 会话 id（spec「会话事实：id、根目录、模型」）。
     *
     * 异步是照 Claude Code 的形状：那边的 `session.id()` 也是 Promise。**要用
     * 时现取** —— `/clear` 与恢复会话会换 id，存死在 `session.start` 里就过期了。
     */
    id(): Promise<string>;
    /**
     * 会话工作根（容器 token `WorkspaceRoot`）：`EnterWorktree` 会让它动，`cd`
     * 不会。回答「这条会话在哪个工作区里干活」。
     */
    root(): Promise<string>;
    /** 当前生效的模型名（没配时是空串），与 `usage().model` 同一处解析。 */
    model(): Promise<string>;
  };
  /**
   * 环境变量（spec「环境变量与设置（只读）」）。
   *
   * 沙箱里没有 `process`：读到的值与工具、钩子看到的是同一份（会话 env 快照
   * 覆盖 OS env）。未设置给 `undefined`、不抛错 —— Claude Code 同语义，社区
   * 插件的写法就是 `(await $.env.get("X")) || 默认值`。
   */
  env: {
    get(name: string): Promise<string | undefined>;
  };
  /**
   * 设置快照（spec「环境变量与设置（只读）」）。
   *
   * 只读：不给 `set`，改配置会牵连正在跑的工具与子进程，且用户不知道是谁改的。
   */
  settings: {
    read(query?: {
      source?: ModSettingsSource;
      key?: string;
    }): Promise<unknown>;
  };
  /**
   * 注册斜杠命令（spec「注册命令」）。
   *
   * 注册只给菜单元数据，逻辑写在 `command.run` 钩子里：用户敲下 `/name args`
   * 后引擎派钩子，钩子返回 `{ text }` 才是这次命令要送进会话的那句话（与
   * Claude Code 同名能力同形状）。
   */
  command: {
    register(spec: ModCommandSpec): { command: string };
    list(): ModCommandInfo[];
    run(options: { command: string; args?: string }): Promise<void>;
  };
}

/** 沙箱需要宿主提供的全部能力。 */
export interface ModRuntimeHost {
  pluginName: string;
  openPane(paneId: string, title: string): void;
  closePane(paneId: string): void;
  listPanes(): string[];
  invalidate(target: string): void;
  /** 输入框下方那一行常驻状态；`null` 清除（spec「状态带、状态行与提示」）。 */
  setStatus(text: string | null): void;
  /** 短暂提示；`timeoutMs` 由 runtime 夹进限额后交下来。 */
  showToast(text: string, timeoutMs: number): void;
  /** `$.ui.log`：在对话流里追加一行（长度已由 runtime 夹进限额）。 */
  appendLog(text: string): void;
  stateGet(key: string): unknown;
  stateSet(key: string, value: unknown): void;
  storeGet(key: string): string | undefined;
  storeSet(key: string, value: string): void;
  storeDelete(key: string): void;
  storeKeys(): string[];
  /** 登记一个定时器；间隔下限、数量上限、串行与撤销都由宿主实现。 */
  startTimer(
    kind: "after" | "every",
    ms: number,
    fn: () => unknown,
  ): ModTimerHandle;
  /** 起一个外部进程；参数校验、限额与回收都由宿主实现。 */
  spawnProcess(
    options: unknown,
  ): AsyncGenerator<ModProcessChunk, ModProcessExit>;
  /** 跑完拿结果（`$.process.run`）；限额与回收同 `spawnProcess`。 */
  runProcess(argv: unknown, options?: unknown): Promise<ModRunResult>;
  /**
   * `$.fs` 相对路径的解析基准：会话**当前**工作目录（容器 token
   * `CurrentWorkdir`，会随 `cd` 动）。
   */
  workdir(): string;
  /** 把一条 prompt 投进当前会话。 */
  submitPrompt(text: string): Promise<void>;
  /**
   * 把草稿填进 surface 的输入框（spec「把草稿填进输入框」）。
   *
   * 返回「填了没有」。宿主链路（通知 → webview → 回执）与超时都由实现方
   * 负责：这里只看结果，不关心是哪一端放弃的。
   */
  fillPrompt(request: {
    text: string;
    mode: ModPromptFillMode;
  }): Promise<boolean>;
  /** `$.session.usage()` 的数据源；会话还没起过轮次时给零值快照。 */
  sessionUsage(): ModSessionUsage;
  /** `$.session.id()`：会话 id（现取，`/clear` 之后是新值）。 */
  sessionId(): string;
  /** `$.session.root()`：会话工作根（容器 token `WorkspaceRoot`，`cd` 不动）。 */
  workspaceRoot(): string;
  /** `$.session.model()`：当前生效的模型名；没配时给空串。 */
  model(): string;
  /** `$.env.get`：会话 env 快照与 OS env 合并后按名字取。 */
  envGet(name: string): string | undefined;
  /**
   * `$.settings.read`：某一层或合并后的设置。
   *
   * `source` 缺省给合并后的当前配置；`key` 给了就取顶层键。层的读法、脱不开的
   * 「这一层不存在」都由实现方决定（`null` 当空对象）。
   */
  settingsRead(query: {
    source?: ModSettingsSource;
    key?: string;
  }): Promise<unknown>;
  /**
   * `$.clock.sleep`：等待 `ms`。
   *
   * 撤销权在宿主：会话销毁 / 插件重载时未完成的等待一律 reject（`AbortError`），
   * 所以这里只收「等多久」和 mod 自己那份 signal（可为 `undefined`，跨 realm，
   * 由实现方 duck-type 判）。
   */
  sleep(ms: number, signal: unknown): Promise<void>;
  /** `$.command.register`：交给宿主的命令表（归属、重名、上限都在那边判）。 */
  registerCommand(spec: ModCommandSpec): { command: string };
  /** `$.command.list`：当前可见的命令（含非 mod 来源）。 */
  listCommands(): ModCommandInfo[];
  /** `$.command.run`：以 mod 身份执行一条已注册的命令。 */
  runCommand(command: string, args?: string): Promise<void>;
}

/**
 * 允许注册的钩子（spec「事件」）。
 *
 * `session.start` / `ui.render` 是「要 mod 做事」的那两个；`turn.complete`、
 * `tool.call`、`turn.start`、`turn.step`、`session.compact`、`session.end`、
 * `ui.close` 与 `classic.PermissionRequest` 是只读的观察事件，返回值一律丢弃
 * （`tool.call` 在 Claude Code 里还能返回 `{ deny }` 拦下调用，那是决策型钩子，
 * 我们只做观察这一半）。`classic.` 前缀是照 Claude Code 的规矩：它把每个
 * settings hook 事件都镜像成 `classic.<Event>`，我们只做这一个镜像，`e` 的形状
 * 也照那份 stdin JSON。`prompt.submit` 与 `command.run` 是仅有的两个有返回值
 * 语义的：前者答 `{ context }`（本轮附加上下文，不改用户原文），后者答
 * `{ text }`。别的名字一律拒收，免得插件作者依赖一个不存在的钩子。
 */
const HOOK_NAMES = new Set([
  "session.start",
  "prompt.submit",
  "turn.start",
  "turn.step",
  "ui.render",
  "ui.close",
  "turn.complete",
  "session.compact",
  "session.end",
  "tool.call",
  "classic.PermissionRequest",
  "command.run",
]);

/** 一个已编译文件：路径 + CJS 源码。 */
export interface CompiledModule {
  path: string;
  code: string;
}

/** 钩子调用结果。 */
export type ModHookResult =
  | { ok: true; value: unknown; elapsedMs: number }
  | { ok: false; error: string; elapsedMs: number };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 取错误摘要。
 *
 * 沙箱里抛出来的 `Error` 属于另一个 realm，宿主的 `instanceof Error` 对它判
 * 假 —— 直接用 `String(error)` 会把每条消息都染成 `Error: xxx`。按 `message`
 * 字段取，两种来源就一致了。
 */
/**
 * 错误消息，兼容跨 realm。
 *
 * mod 的代码跑在 vm context 里，抛出来的 `Error` 是**另一个 realm** 的构造
 * 函数实例：`instanceof Error` 判假，`String(error)` 会带上 `Error: ` 前缀。
 * 所以先认 `message` 字段。宿主侧（`ModManager`）也用它，避免两处写法漂移。
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isPlainObject(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

/**
 * 跨 realm 的 thenable 判断。
 *
 * mod 在 vm context 里 `new Promise(...)` 拿到的是**另一个 realm** 的
 * `Promise`，`instanceof Promise` 判假。定时器要靠它判定「这一拍还没跑完」，
 * 判错就会把 async 回调当成同步的，串行语义整个失效。
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * 跨 realm 的 JSON 拷贝。
 *
 * `$` 上的值来自宿主 realm；直接交给 mod 会把宿主对象暴露给插件代码，而且
 * 跨 realm 的 `instanceof` / 原型判断都会失效。`state` / `store` 的值本来就
 * 要求可 JSON 序列化，拷贝一份最省事。
 */
function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/**
 * 把 `h()` 的 children 拍平成树节点。
 *
 * 只保留字符串/数字与元素；`null` / `undefined` / `false` / `true` 丢弃 ——
 * 这正是 `{cond && <X/>}` 的语义。
 */
function appendChildren(
  target: Array<ModTreeNode | string>,
  input: unknown,
): void {
  if (
    input === null ||
    input === undefined ||
    input === false ||
    input === true
  ) {
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) appendChildren(target, item);
    return;
  }
  if (typeof input === "string" || typeof input === "number") {
    target.push(String(input));
    return;
  }
  if (isPlainObject(input) && typeof input.type === "string") {
    target.push(input as unknown as ModTreeNode);
    return;
  }
  logger.warn(`[Wave] mod 渲染出无法识别的子节点类型：${typeof input}`);
}

/** 带回调的 prop：留在进程内的处理函数表，不进树。 */
const CALLBACK_PROPS = new Set(["onPress", "onSubmit", "onSelect"]);

/**
 * `h()` 要原样留在树里的**非原始值** prop。
 *
 * 只有 `Select.options`：它是 `{ value, label? }[]`，丢了它下拉框就是个空壳。
 * 其余非原始值（函数、Symbol、普通对象）照旧丢弃 —— 它们过不了 RPC，留着只会
 * 在校验器那里变成一个更难读的错。
 */
const STRUCTURED_PROPS: Readonly<Record<string, (value: unknown) => unknown>> =
  {
    options: (value) => {
      if (!Array.isArray(value)) return undefined;
      const options: Array<{ value: string; label?: string }> = [];
      for (const option of value) {
        if (!isPlainObject(option)) return undefined;
        const { value: optionValue, label } = option as {
          value?: unknown;
          label?: unknown;
        };
        if (typeof optionValue !== "string") return undefined;
        options.push(
          typeof label === "string"
            ? { value: optionValue, label }
            : { value: optionValue },
        );
      }
      return options;
    },
  };

/**
 * 一个 mod 的沙箱实例：执行入口文件、收集钩子、承载 `$`。
 *
 * 每个 mod 一个实例（各自一个 vm context），所以两个 mod 的全局状态、模块
 * 缓存、处理函数表互不可见 —— spec「多个 mod 互不影响」。
 */
export class ModRuntime {
  private readonly context: vm.Context;
  private readonly modules = new Map<string, { exports: unknown }>();
  private readonly sources = new Map<string, string>();
  /** `<type>:<key>` → 回调。 */
  private readonly handlers = new Map<string, (value?: string) => unknown>();
  private readonly hooks = new Map<string, (event: unknown) => unknown>();
  /**
   * `command.run` 的处理器：matcher 是**带斜杠**的命令名（`"/standup"`），与
   * Claude Code 的 matcher 口径一致。
   *
   * 单独一张表而不是塞进 `hooks`：这个事件是唯一带 matcher、唯一有返回值语义
   * 的钩子，而且同一个 mod 会为多条命令各注册一个 —— 塞进 `hooks`（同名覆盖）
   * 只会剩下最后一条。
   */
  private readonly commandHooks = new Map<
    string,
    (event: unknown) => unknown
  >();
  /** 正在跑 `command.run` 钩子的层数（`$.command.run` 靠它拒自激）。 */
  private commandHookDepth = 0;
  private readonly dollar: ModDollar;
  private readonly wave: unknown;
  /** 当前正在计时的预算（`$.process.spawn` 等输出时会被暂停）。 */
  private budget: HookBudget | undefined;
  /** `$.fs` 的实现，惰性创建：多数 mod 一次都不碰文件。 */
  private fileApiHolder: ModFs | undefined;

  constructor(
    private readonly host: ModRuntimeHost,
    private readonly entryPath: string,
    compiled: CompiledModule[],
  ) {
    for (const mod of compiled) {
      this.sources.set(path.resolve(mod.path), mod.code);
    }

    const h = (type: unknown, props: unknown, ...children: unknown[]) => {
      const rawProps = isPlainObject(props) ? props : {};
      const key = typeof rawProps.key === "string" ? rawProps.key : undefined;
      const kept: Record<string, ModPropValue> = {};
      for (const [name, value] of Object.entries(rawProps)) {
        if (CALLBACK_PROPS.has(name)) {
          const callback = value as (input?: string) => unknown;
          if (key && typeof callback === "function") {
            this.handlers.set(`${String(type)}:${key}`, callback);
          }
          continue;
        }
        if (value === undefined) continue;
        const structured = STRUCTURED_PROPS[name];
        if (structured) {
          const mapped = structured(value);
          // 形状不对就整条丢掉，让校验器去报「options 不是 { value, label? }[]」
          // —— 这里只是搬运，不替 mod 猜它想写什么。
          if (mapped !== undefined) kept[name] = mapped as ModPropValue;
          continue;
        }
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        ) {
          kept[name] = value;
        }
      }
      const nodeChildren: Array<ModTreeNode | string> = [];
      for (const child of children) appendChildren(nodeChildren, child);
      return { type: String(type), props: kept, children: nodeChildren };
    };

    this.wave = { h, Fragment: "Fragment", elements };

    this.dollar = {
      plugin: { name: host.pluginName },
      ui: {
        resolve: resolveElements,
        open: (pane) => host.openPane(pane.id, pane.title),
        close: (id) => host.closePane(id),
        panes: () => [...host.listPanes()],
        invalidate: (target) => {
          if (target !== "ui.render") {
            throw new Error(
              `$.ui.invalidate 只认 "ui.render"（一期只有这一个渲染站点生产者），拿到的是 ${JSON.stringify(target)}`,
            );
          }
          host.invalidate(target);
        },
        // 只推不拉：不产生树、不进上下文，宿主收到就画（spec「状态带、状态行
        // 与提示」）。
        status: (text) => host.setStatus(normalizeStatus(text)),
        toast: (text, timeoutMs) => {
          const trimmed = normalizeStatus(text);
          if (trimmed === null) {
            throw new Error("$.ui.toast 需要一段文本");
          }
          host.showToast(trimmed, toastMs(timeoutMs));
        },
        // 进对话流、不进上下文：长度口径与状态行同一份限额。
        log: (text, options) => {
          const to = options?.to;
          if (to !== undefined && to !== "transcript") {
            // 不静默当成 transcript：CC 的 `to` 还认别的落点，拼错一个值就安静
            // 写进对话流比报错更难查。
            throw new Error(
              `$.ui.log 只认 to: "transcript"（一期只有对话流这一个落点），拿到的是 ${JSON.stringify(to)}`,
            );
          }
          const line = normalizeStatus(text)?.trim() ?? null;
          if (line === null) {
            throw new Error("$.ui.log 需要一段文本");
          }
          host.appendLog(line);
        },
      },
      state: {
        get: (key) => cloneValue(host.stateGet(key)),
        set: (key, value) => host.stateSet(key, cloneValue(value)),
      },
      store: {
        get: (key) => host.storeGet(key),
        set: (key, value) => host.storeSet(key, String(value)),
        delete: (key) => host.storeDelete(key),
        keys: () => [...host.storeKeys()],
      },
      clock: {
        now: () => Date.now(),
        // 只登记到宿主，不在沙箱里自己起计时器：撤销权必须留在宿主手里。
        after: (ms, fn) => host.startTimer("after", ms, fn),
        every: (ms, fn) => host.startTimer("every", ms, fn),
        // 同上：销毁时未完成的等待要能 reject，所以计时与撤销都在宿主那边。
        sleep: (ms, options) => {
          if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
            throw new Error("$.clock.sleep 需要非负的毫秒数");
          }
          return host.sleep(ms, options?.signal);
        },
      },
      // 同上：进程也归宿主所有，`dispose` / `/reload-plugins` 时宿主统一回收。
      process: {
        spawn: (options) => this.streamWithBudget(host.spawnProcess(options)),
        run: (argv, options) =>
          this.withBudget(() => host.runProcess(argv, options)),
      },
      // fs / http 在 agent 进程内就地实现：它们不碰会话状态，不需要过宿主。
      // 只有相对路径的基准要问宿主（`workdir()` 是 getter，`cd` 过要跟着变）。
      fs: {
        read: (filePath, options) =>
          this.withBudget(() => this.fileApi().read(filePath, options)),
        write: (filePath, text) =>
          this.withBudget(() => this.fileApi().write(filePath, text)),
        list: (dirPath) => this.withBudget(() => this.fileApi().list(dirPath)),
        stat: (filePath) =>
          this.withBudget(() => this.fileApi().stat(filePath)),
        exists: (filePath) =>
          this.withBudget(() => this.fileApi().exists(filePath)),
      },
      http: {
        fetch: (url, options) => this.withBudget(() => modFetch(url, options)),
      },
      prompt: {
        submit: async (options) => {
          const text = options?.text;
          if (typeof text !== "string" || text.length === 0) {
            throw new Error("$.prompt.submit 需要非空的 text");
          }
          // 一期只支持以用户身份发言：模型身份（`asUser: false`）要额外定义
          // 「这条消息怎么标注来源、要不要进 system 侧」，不在这一期的形状里。
          if (options.asUser !== true) {
            throw new Error("$.prompt.submit 一期只支持 asUser: true");
          }
          await host.submitPrompt(text);
        },
        fill: async (options) => {
          const text = options?.text;
          // 空串是合法输入：`replace` 空串就是把草稿清掉（与 Claude Code 一致）。
          if (typeof text !== "string") {
            throw new Error("$.prompt.fill 的 text 必须是字符串");
          }
          const mode = options.mode;
          if (
            mode !== undefined &&
            mode !== "replace" &&
            mode !== "append" &&
            mode !== "insert"
          ) {
            // 不静默当成 replace：拼错的 mode 会安静地替掉用户已打的字。
            throw new Error(
              '$.prompt.fill 的 mode 只允许 "replace"、"append"、"insert"',
            );
          }
          const isFilled = await host.fillPrompt({
            text,
            mode: mode ?? "replace",
          });
          return { isFilled };
        },
      },
      // 只读快照；克隆一份交出去，mod 改自己的副本伤不到会话。
      session: {
        usage: () => cloneValue(host.sessionUsage()),
        // 与 `$.fs` 同一份 getter：`cd` 过之后这里立刻是新目录。
        cwd: () => host.workdir(),
        // 三个事实都异步（Claude Code 同名方法也是异步的），一律现取。
        id: async () => host.sessionId(),
        root: async () => host.workspaceRoot(),
        model: async () => host.model(),
      },
      env: {
        get: async (name) => {
          if (typeof name !== "string" || name.length === 0) {
            throw new Error("$.env.get 需要一个变量名");
          }
          // 超长的名字按「没设置」处理：它不可能是真的环境变量名，报错反而
          // 逼插件去处理一个写错了的字符串。
          if (name.length > MOD_LIMITS.envNameChars) return undefined;
          return host.envGet(name);
        },
      },
      settings: {
        read: async (query) => {
          const request = normalizeSettingsQuery(query);
          const value = await host.settingsRead(request);
          // 跨 realm 传一份拷贝；同时守住体积（截断的配置是错的配置，所以超限
          // 报错而不是切一刀）。
          const cloned = cloneValue(value);
          const size = Buffer.byteLength(JSON.stringify(cloned) ?? "", "utf-8");
          if (size > MOD_LIMITS.settingsReadBytes) {
            throw new Error(
              `$.settings.read 的结果有 ${size} 字节，超过 ${MOD_LIMITS.settingsReadBytes}`,
            );
          }
          return cloned;
        },
      },
      // 命令的三件事：注册元数据、看命令表、执行一条（spec「注册命令」）。
      command: {
        register: (spec) => host.registerCommand(validateCommandSpec(spec)),
        list: () => cloneValue(host.listCommands()),
        run: async (options) => {
          const command = options?.command;
          if (typeof command !== "string" || !COMMAND_NAME_RE.test(command)) {
            throw new Error(
              '$.command.run 的 command 是命令名（不带斜杠，如 "standup"）',
            );
          }
          if (this.commandHookDepth > 0) {
            // 与 CC 同一条边界：钩子正持有用户打出的那一轮，再执行命令会等自己。
            throw new Error(
              "$.command.run 不能在 command.run 钩子里调用：它会等正被这个钩子占着的那一轮；在钩子里直接返回 { text }，或挪到 turn.complete 里再跑",
            );
          }
          await host.runCommand(command, options?.args);
        },
      },
    };

    this.context = vm.createContext(
      {
        __wave: this.wave,
        // `$.clock.sleep` 接受 `{ signal }`，而沙箱里原本连 `AbortController`
        // 都没有 —— 不给它，`signal` 就永远只能由宿主造（mod 自己取消不了自己
        // 的等待）。这两个类来自宿主 realm，只用来传递取消信号。
        AbortController,
        AbortSignal,
        console: {
          log: (...args: unknown[]) =>
            logger.info(`[mod:${host.pluginName}]`, ...args),
          info: (...args: unknown[]) =>
            logger.info(`[mod:${host.pluginName}]`, ...args),
          warn: (...args: unknown[]) =>
            logger.warn(`[mod:${host.pluginName}]`, ...args),
          error: (...args: unknown[]) =>
            logger.error(`[mod:${host.pluginName}]`, ...args),
        },
      },
      // `eval` / `new Function` 是从字符串取能力的经典逃逸口，而这个 context 里
      // 本来就没有任何值得逃出去的东西 —— 直接关掉。`vm.runInContext` 本身不受
      // 这个开关限制，所以模块包装器照常执行。
      { codeGeneration: { strings: false, wasm: false } },
    );
  }

  /**
   * 执行入口文件，调用它导出的 `register($, on)`。
   *
   * 返回 `false` 表示这个文件没有导出 `register` —— 它只是被别的 mod
   * `import` 的共享模块，不是面板入口（`mods/` 目录里的文件全部参与编译，
   * 但只有带 `register` 的才算一个 mod）。
   */
  async load(): Promise<boolean> {
    const exports = this.execute(this.entryPath, new Set());
    const register = (exports as { register?: unknown } | undefined)?.register;
    if (typeof register !== "function") return false;
    const result = (register as (dollar: unknown, on: unknown) => unknown).call(
      exports,
      this.dollar,
      (name: unknown, matcherOrHandler: unknown, maybeHandler?: unknown) => {
        if (typeof name !== "string") return;
        const hasMatcher = typeof maybeHandler === "function";
        const handler = hasMatcher ? maybeHandler : matcherOrHandler;
        if (typeof handler !== "function") return;
        if (!HOOK_NAMES.has(name)) {
          logger.warn(
            `[Wave] ${this.host.pluginName} 注册了不存在的 mod 钩子：${name}（可用：${[...HOOK_NAMES].join(" / ")}）`,
          );
          return;
        }
        if (name === "command.run") {
          // 唯一带 matcher 的事件：matcher 决定「这条命令归谁答」，没有它就无法
          // 把一条命令指到自己的处理器上（CC 的形状是 { command: "/name" }）。
          const command = isPlainObject(matcherOrHandler)
            ? matcherOrHandler.command
            : undefined;
          if (
            typeof command !== "string" ||
            !command.startsWith("/") ||
            command.length < 2
          ) {
            logger.warn(
              `[Wave] ${this.host.pluginName} 的 command.run 钩子需要 matcher { command: "/<命令名>" }（带斜杠），这一条被忽略`,
            );
            return;
          }
          this.commandHooks.set(
            command,
            handler as (event: unknown) => unknown,
          );
          return;
        }
        if (hasMatcher) {
          logger.warn(
            `[Wave] ${this.host.pluginName} 给 ${name} 传了 matcher：只有 command.run 接受 matcher，这一条被忽略`,
          );
          return;
        }
        this.hooks.set(name, handler as (event: unknown) => unknown);
      },
    );
    if (isThenable(result)) await result;
    return true;
  }

  /** 调一个钩子；没有注册时返回 `{ ok: true, value: undefined }`。 */
  async callHook(name: string, event: unknown): Promise<ModHookResult> {
    const handler = this.hooks.get(name);
    if (!handler) return { ok: true, value: undefined, elapsedMs: 0 };
    const started = Date.now();
    try {
      const value = await this.runWithBudget(
        `${name} 钩子超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
        () => handler(event),
      );
      return { ok: true, value, elapsedMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
        elapsedMs: Date.now() - started,
      };
    }
  }

  /**
   * 派一条命令给它的 `command.run` 钩子（spec「注册命令」）。
   *
   * `command` 带斜杠（`"/standup"`），与注册时的 matcher 同一个写法。没有对应
   * 处理器时返回 `{ ok: true, value: undefined }` —— 由调用方（宿主）决定「注册
   * 了命令却没人答」怎么报。
   */
  async callCommandHook(command: string, args: string): Promise<ModHookResult> {
    const handler = this.commandHooks.get(command);
    if (!handler) return { ok: true, value: undefined, elapsedMs: 0 };
    const started = Date.now();
    this.commandHookDepth += 1;
    try {
      const value = await this.runWithBudget(
        `${command} 的命令钩子超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
        () => handler({ command, args }),
      );
      return { ok: true, value, elapsedMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
        elapsedMs: Date.now() - started,
      };
    } finally {
      this.commandHookDepth -= 1;
    }
  }

  /**
   * 派发一个 UI 交互到它注册时挂上的回调。
   *
   * 返回 `false` 表示没有对应处理器（元素没写 `key`，或 mod 重画后 key 变了），
   * 宿主据此决定要不要提示。
   */
  async dispatch(
    kind: "press" | "input" | "select",
    key: string,
    value?: string,
  ): Promise<boolean> {
    // 按交互种类取对应元素的处理表：同一个 pane 里 Button / Input / Select 撞
    // key 是允许的（key 只要在自己的元素类型里唯一），所以不能跨类型兜底查找。
    const type =
      kind === "input" ? "Input" : kind === "select" ? "Select" : "Button";
    const handler = this.handlers.get(`${type}:${key}`);
    if (!handler) return false;
    await this.runWithBudget(
      `${kind} 处理超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
      () => handler(kind === "press" ? undefined : value),
    );
    return true;
  }

  /**
   * 在一份可暂停的预算里跑 mod 的代码（spec「限额」的 5 秒）。
   *
   * `this.budget` 是当前正在计时的那个：`$.process.spawn` 的迭代在等输出时
   * 通过它暂停/恢复（见 {@link streamWithBudget}）。钩子不嵌套调用，所以只需
   * 记一层，恢复回上一个即可。
   */
  private async runWithBudget<T>(
    message: string,
    work: () => Promise<T> | T,
  ): Promise<T> {
    const budget = new HookBudget(MOD_LIMITS.hookTimeoutMs, message);
    const outer = this.budget;
    this.budget = budget;
    try {
      return await withBudget(budget, work);
    } finally {
      this.budget = outer;
    }
  }

  /**
   * 包一层「等输出不算预算」的进程流。
   *
   * 暂停/恢复发生在**每一次** `next()` 上：mod 可能把迭代器留到钩子返回之后
   * 再用（`$.clock.every` 里一拍读一次），那时 `this.budget` 已经是别的预算或
   * 没有预算，暂停就自然不生效。
   *
   * 手写迭代器而不是 `async *`：mod 对这层调 `return()`（Cancel 按钮）时，必须
   * 立刻转给内层的 pull/close 协议去杀进程。写成生成器的话 `return()` 会被排在
   * 正在 `await` 的 `gen.next()` 后面，静默的长跑进程就永远等不到收尸。
   */
  private streamWithBudget(
    gen: AsyncGenerator<ModProcessChunk, ModProcessExit>,
  ): AsyncGenerator<ModProcessChunk, ModProcessExit> {
    const stream: AsyncGenerator<ModProcessChunk, ModProcessExit> = {
      next: async () => {
        const budget = this.budget;
        budget?.pause();
        try {
          return await gen.next();
        } finally {
          budget?.resume();
        }
      },
      return: async (value) => {
        const budget = this.budget;
        budget?.pause();
        try {
          return await gen.return(value);
        } finally {
          budget?.resume();
        }
      },
      throw: (error) => gen.throw(error),
      [Symbol.asyncIterator]: () => stream,
    };
    return stream;
  }

  /** 该 mod 注册了哪些钩子（诊断用）。 */
  hookNames(): string[] {
    const names = [...this.hooks.keys()];
    if (this.commandHooks.size > 0) names.push("command.run");
    return names;
  }

  /** 该 mod 用 matcher 注册了哪些命令（宿主清理/诊断用，带斜杠）。 */
  commandHookTargets(): string[] {
    return [...this.commandHooks.keys()];
  }

  /**
   * 等一次 I/O 的时间不计入钩子预算（spec「外部进程」）。
   *
   * 与 {@link streamWithBudget} 同一条规则，只是这里等的是一次性 promise：
   * `$.process.run` 默认 30 秒、`$.http.fetch` 也是 30 秒，都把 5 秒的 hook
   * 预算算穿。预算只算 mod 自己干活的时间。
   */
  private async withBudget<T>(call: () => Promise<T>): Promise<T> {
    const budget = this.budget;
    budget?.pause();
    try {
      return await call();
    } finally {
      budget?.resume();
    }
  }

  private fileApi(): ModFs {
    this.fileApiHolder ??= new ModFs(() => this.host.workdir());
    return this.fileApiHolder;
  }

  /**
   * 执行一个已编译文件，返回它的 `module.exports`。
   *
   * `require` 只接受相对路径与 `wave-agent-sdk/mods` —— 后者返回元素构造器
   * 表。其余裸包名直接抛错（spec「加载纪律」）。相对路径只在本 mod 已编译的
   * 文件集合里找，解析不出插件目录（文件本身在加载前已经过 realpath 校验）。
   */
  private execute(filePath: string, visiting: Set<string>): unknown {
    const resolved = path.resolve(filePath);
    // 循环要先于缓存判：`execute` 在递归**之前**就把半成品 `module.exports`
    // 写进了缓存（CJS 语义需要它），所以只查缓存永远看不到环。mod 的模块本该
    // 是「进来就注册」的，环形 import 拿到的是半成品导出 —— 宁可当场说清楚。
    if (visiting.has(resolved)) {
      throw new Error(`mod 的 import 出现循环：${resolved}`);
    }
    const cached = this.modules.get(resolved);
    if (cached) return cached.exports;
    const code = this.sources.get(resolved);
    if (code === undefined) {
      throw new Error(`mod 文件未编译：${resolved}`);
    }
    const module = { exports: {} as Record<string, unknown> };
    this.modules.set(resolved, module);
    visiting.add(resolved);

    const requireFn = (specifier: string) => {
      if (specifier === "wave-agent-sdk/mods") {
        return { ...elements, Fragment: "Fragment" };
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        throw new Error(
          `mod 只能 import 相对路径或 wave-agent-sdk/mods：${specifier}`,
        );
      }
      const target = path.resolve(path.dirname(resolved), specifier);
      for (const candidate of moduleCandidates(target)) {
        if (this.sources.has(candidate)) {
          return this.execute(candidate, visiting);
        }
      }
      throw new Error(
        `mod 找不到模块：${specifier}（来自 ${path.basename(resolved)}）`,
      );
    };

    const wrapper = `(function (module, exports, require, __wave) {\n${code}\n})`;
    const factory = vm.runInContext(wrapper, this.context, {
      filename: resolved,
      timeout: MOD_LIMITS.hookTimeoutMs,
    }) as (
      module: unknown,
      exports: unknown,
      require: unknown,
      wave: unknown,
    ) => void;
    factory.call(module.exports, module, module.exports, requireFn, this.wave);
    visiting.delete(resolved);
    return module.exports;
  }
}

/** `./a` 的候选：原样、`.tsx`、`.ts`、`.jsx`、`.js`、`/index.*`。 */
function moduleCandidates(target: string): string[] {
  return [
    target,
    `${target}.tsx`,
    `${target}.ts`,
    `${target}.jsx`,
    `${target}.js`,
    path.join(target, "index.tsx"),
    path.join(target, "index.ts"),
    path.join(target, "index.jsx"),
    path.join(target, "index.js"),
  ];
}

/**
 * 一次钩子/回调的时间预算，**可以暂停**。
 *
 * 暂停这一步是为了 `$.process.spawn`：mod 在钩子里 `for await` 一个长跑进程
 * 时，停在「等下一块输出」上的时间是**空闲**，不是失控的循环。只把 mod 自己
 * 干活的时间算进 5 秒里，否则「起一个连接、逐块消费」这种最正常的写法一动就
 * 超时。这与 Claude Code 把 `process.spawn` 的预算标成 `pull` 是同一条规则。
 */
class HookBudget {
  private remainingMs: number;
  private timer: NodeJS.Timeout | undefined;
  private armedAt = 0;
  private paused = false;
  private stopped = false;
  private rejectExpiry!: (error: Error) => void;
  /** 到期时 reject；调用方拿它和实际工作 race。 */
  readonly expiry: Promise<never>;

  constructor(
    private readonly totalMs: number,
    private readonly message: string,
  ) {
    this.remainingMs = totalMs;
    this.expiry = new Promise<never>((_, reject) => {
      this.rejectExpiry = reject;
    });
    this.arm();
  }

  pause(): void {
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.remainingMs -= Date.now() - this.armedAt;
    this.clear();
  }

  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    // 暂停期间已经超了：立刻到期，不必再等一轮。
    if (this.remainingMs <= 0) {
      this.fire();
      return;
    }
    this.arm();
  }

  /** 工作结束（成功或失败）：停表。 */
  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private arm(): void {
    this.armedAt = Date.now();
    this.timer = setTimeout(() => this.fire(), this.remainingMs);
    this.timer.unref?.();
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private fire(): void {
    this.clear();
    this.stopped = true;
    this.rejectExpiry(new Error(this.message));
  }
}

/** 把一份工作跑在预算里：到期即以 `message` 失败。 */
async function withBudget<T>(
  budget: HookBudget,
  work: () => Promise<T> | T,
): Promise<T> {
  try {
    return await Promise.race([Promise.resolve().then(work), budget.expiry]);
  } finally {
    budget.stop();
  }
}
