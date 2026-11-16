import * as vm from "node:vm";
import * as path from "node:path";
import type {
  ModAskOptions,
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
  ModRenderSurface,
  ModSessionUsage,
  ModSettingsSource,
  ModUiOpenResult,
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
import { atom, read, update } from "./atoms.js";
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
 *
 * 与 Claude Code 同一档（它的 `src/utils/vmHardening.ts`），外面多压两层：
 *
 * - **所有跨入沙箱的执行都从 `invokeInContext` 进**。`vm` 的 `timeout` 是 V8 的
 *   terminate，只在 `runInContext` 那一层生效；宿主直接 `fn()` 是裸调，
 *   `while (true) {}` 能把整个 `wave --stdio` 卡死（5 秒预算的 `setTimeout` 和
 *   它同一个事件循环，根本轮不到）。
 * - **本 realm 的内置一律冻结**，并锁掉 `Error.prepareStackTrace` /
 *   `captureStackTrace`：堆栈是**我们**写日志时要读的东西，mod 能改写它就能让
 *   排查看到一段假的。
 *
 * 没做的是 Claude Code 里那层 `intoEnvironment` 深拷贝 —— 那需要把 `$` 整个搬
 * 进 vm 里重建才彻底（它把元素构造器也写成 vm 内的 `String.raw` 源码），而我们
 * 的 `$` 是宿主对象，代价是把几百行有类型检查的代码降级成字符串。`$` 与元素表
 * 仍然是宿主对象，这条边界按上一段「不是安全边界」接受。
 */

/**
 * 沙箱里唯一的那一跳：宿主把「要执行什么」放进 `__wave$slot`，这个函数取出来
 * 调一次，顺手把槽位清干净。
 *
 * **它本身必须是 vm 内函数。** 宿主那边的任何函数都带宿主 realm 的
 * `Function.prototype`，`fn.constructor("return process")()` 一步就出去了 ——
 * context 的 `codeGeneration.strings=false` 只挡 vm 自己 `new Function`。名字在
 * context 里指向 vm 自己的函数，便拿不到那条路。
 */
const SANDBOX_SLOT = "__wave$slot";
const SANDBOX_INVOKE = "__wave$invoke";

/** 那一跳本身（不带 timeout，timeout 在每次 `runInContext` 的选项里）。 */
let invokeScript: vm.Script | undefined;
function invokeScriptOf(): vm.Script {
  // 惰性：SDK 模块在 import 时不做任何事（见 AGENTS.md 的「零 import 副作用」）。
  invokeScript ??= new vm.Script(`${SANDBOX_INVOKE}()`, {
    filename: "wave:mod-invoke",
  });
  return invokeScript;
}

/**
 * 装配 + 加固一个新 context：装上那一跳，然后把这个 realm 的内置一律冻结。
 *
 * 只碰本 context（每个 mod 一个，见 {@link ModRuntime}）：改的是 vm 自己的
 * `Object` / `Array` / `Promise`，宿主与其它 mod 都不受影响。
 *
 * `Error.prepareStackTrace` 与 `captureStackTrace` 单独处理：堆栈是**我们**
 * 写日志时要读的东西，mod 能改写它就能让排查看到一段假的。
 */
function hardenContext(context: vm.Context): void {
  vm.runInContext(
    `(function () {
      globalThis.${SANDBOX_INVOKE} = function () {
        var slot = globalThis.${SANDBOX_SLOT};
        globalThis.${SANDBOX_SLOT} = undefined;
        if (slot === undefined) throw new Error("沙箱没有拿到要执行的工作");
        return slot.fn.apply(slot.self, slot.args);
      };

      Object.defineProperty(Error, "prepareStackTrace", {
        value: undefined,
        writable: false,
        configurable: false,
      });
      delete Error.captureStackTrace;

      var intrinsics = [
        Object, Function, Array, String, Number, Boolean, Symbol, BigInt,
        RegExp, Date, Map, Set, WeakMap, WeakSet, Promise, JSON, Math, Reflect,
        ArrayBuffer, DataView, Uint8Array, Int8Array, Uint16Array, Int16Array,
        Uint32Array, Int32Array, Float32Array, Float64Array,
        Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError,
        URIError, AggregateError,
      ];
      for (var i = 0; i < intrinsics.length; i += 1) {
        var ctor = intrinsics[i];
        if (ctor === undefined) continue;
        if (ctor.prototype) Object.freeze(ctor.prototype);
        Object.freeze(ctor);
      }
    })();`,
    context,
    { filename: "wave:mod-sandbox" },
  );
}

/**
 * 元素名：`h()` 认的 tag，也是构造器的 `elementType`。
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

/**
 * `h()` 的 tag：JSX 标签既可能是元素名（`__wave.h("Text", …)`），也可能是构造器
 * 函数（`__wave.h(t.Text, …)`，`t` 是 `$.ui.resolve(e)` 那张表）。后者按它带的
 * `elementType` 归一，所以两种写法编出的是同一种节点。
 */
function tagOf(type: unknown): string {
  if (typeof type === "function") {
    const tag = (type as { elementType?: unknown }).elementType;
    if (typeof tag === "string") return tag;
  }
  return String(type);
}

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
 * 这一刻有谁在画这条会话（spec「会话事实」的 `$.session.surfaces()`）。
 *
 * 由宿主入口决定：桌面端会画 mod 的树 ⇒ `["desktop"]`；终端 CLI、`wave -p`、
 * VS Code / JetBrains 一期都不画 ⇒ `[]`（「没有界面」）。判据是**有没有界面**
 * 而不是「能不能画面板」：将来终端接上渲染，这里先变成 `["terminal"]`，读它的
 * 插件不用改（`$.ui.open()` 的 `isPlaced` 与它同一个数据源）。
 */
export function renderSurfacesOf(
  entrypoint: "cli" | "desktop" | "vscode" | "jetbrains" | "remote" | undefined,
): readonly ModRenderSurface[] {
  return entrypoint === "desktop" ? ["desktop"] : [];
}

/** 我们对外推荐的 mod 模块名（`wave-agent-sdk/mods` 子路径）。 */
const MODULE_SPECIFIER = "wave-agent-sdk/mods";

/**
 * 社区 mod 里写的裸模块名，解析到**同一份**模块（spec「兼容社区 mod」）。
 *
 * 不是依赖：这个 specifier 由沙箱自己的 `require` 接管，返回的是元素构造器表
 * 与 `atom` / `read` / `update`，不存在任何按包名去 `node_modules` 找的路径。
 */
const COMMUNITY_MODULE_SPECIFIER = "claude-code";

/**
 * 这一端上能画的站点：`ui.render` 的 `e.component`。
 *
 * 一期三处：右侧面板（`Pane`）、输入框上方的带（`AbovePrompt`）、以及「带里的
 * 行怎么排」（`AbovePromptList`，见 spec「状态带、状态行与提示」）—— 宿主三处
 * 都会发 `ui.render`，漏一个就等于让那一处的 mod 在 `$.ui.resolve(e)` 上抛错。
 * CC 的表里还有 15 个（`ToolUse`、`PromptHint`…），加站点时往这里加，别在别处
 * 另写一份。
 */
const RENDER_SITES: readonly string[] = [
  "Pane",
  "AbovePrompt",
  "AbovePromptList",
];

/**
 * 一张元素表（`$.ui.resolve(e)` 与 `require("claude-code")` 拿到的是同一份）。
 *
 * CC 的桌面端表是 11 个，我们放真画得出的那 10 个 —— 只差 `Client`（要在渲染端
 * 执行 mod 附带的第二份模块，spec「交付分层」没做）。给了画不出的名字，mod 编出
 * 的树会被 `validateModTree` 拒掉，错误离原因更远。
 *
 * **每个 mod 实例一份、且在构造时冻结**：构造器要闭包住这个实例的 `h()`（事件
 * 回调登记在实例上），所以不能是模块级共享的那一份。
 */
type ModElementTable = Readonly<Record<ModElementType, ModElementBuilder>>;

/**
 * 造一套元素构造器：调用式 `Text({ children: "hi" })` 与 JSX `<Text>hi</Text>`
 * 都落到同一个 `h()` 上。
 *
 * `children` 从 props 里摘出来（CC 的调用式把子节点写在 props 上），其余原样交给
 * `h()`：它才知道哪些 prop 能进树、哪些是回调。
 */
function elementTableOf(
  h: (type: unknown, props: unknown, ...children: unknown[]) => unknown,
): ModElementTable {
  const table: Record<string, ModElementBuilder> = {};
  for (const name of ELEMENT_CONSTRUCTORS) {
    const elementType = String(name) as ModElementType;
    const builder = ((props?: Record<string, unknown>) => {
      const { children, ...rest } = isPlainObject(props) ? props : {};
      if (children === undefined) return h(elementType, rest);
      return Array.isArray(children)
        ? h(elementType, rest, ...children)
        : h(elementType, rest, children);
    }) as {
      (props?: Record<string, unknown>): unknown;
      elementType: ModElementType;
    };
    Object.defineProperty(builder, "elementType", { value: elementType });
    table[elementType] = builder;
  }
  return Object.freeze(table) as ModElementTable;
}

/**
 * 把 `ui.render` 的事件换成这一端可用的元素表。
 *
 * 传错参数（不是 render 事件、没见过的 surface / component）当场报错并列出
 * 可用名单 —— 返回半张表会让 mod 在 `<undefined>` 上炸，错误离原因更远。
 */
function resolveElements(
  event: unknown,
  table: ModElementTable,
): ModElementTable {
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
  return table;
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

/**
 * 校验 `$.ui.ask` 的参数，归一成宿主那张提问卡片要的形状（spec「问用户一个问题」）。
 *
 * Claude Code 的签名是 `ask(question, options?)`，第二个参数可以是标签数组，也可
 * 以是 `{ options, header, multiSelect }`；标签 2–4 个，少于两个按「是 / 否」补
 * 齐。`header` 是那颗小标签，CLI 会 `.slice(0, 12).toUpperCase()`，所以这里一定
 * 给一个字符串（没写就用插件名）。
 */
function normalizeAskQuestion(
  question: unknown,
  options: unknown,
  pluginName: string,
): { question: string; labels: string[]; header: string; multiSelect?: true } {
  if (typeof question !== "string" || question.trim().length === 0) {
    throw new Error("$.ui.ask 需要一个问题（非空字符串）");
  }
  let rawLabels: unknown = [];
  let header: unknown;
  let multiSelect: unknown;
  if (Array.isArray(options)) {
    rawLabels = options;
  } else if (options !== undefined) {
    if (!isPlainObject(options)) {
      throw new Error(
        "$.ui.ask 的第二个参数是标签数组，或者 { options, header, multiSelect }",
      );
    }
    rawLabels = options.options ?? [];
    header = options.header;
    multiSelect = options.multiSelect;
  }
  if (!Array.isArray(rawLabels)) {
    throw new Error("$.ui.ask 的 options 必须是字符串数组");
  }
  const labels: string[] = [];
  for (const label of rawLabels) {
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error(
        `$.ui.ask 的每个选项都要是非空字符串，拿到的是 ${JSON.stringify(label)}`,
      );
    }
    const trimmed = label.trim();
    // 同一个标签给两次，用户点了也分不清是哪个。
    if (labels.includes(trimmed)) {
      throw new Error(`$.ui.ask 的选项重复了：${trimmed}`);
    }
    labels.push(trimmed);
  }
  if (labels.length > 4) {
    throw new Error(
      `$.ui.ask 最多四个选项（Claude Code 的口径，多出来的提问卡片画不下），拿到 ${labels.length} 个`,
    );
  }
  // 少于两个补成「是 / 否」：卡片上没有「只有一个选项」这种形状。
  while (labels.length < 2) labels.push(labels.length === 0 ? "是" : "否");
  if (header !== undefined && typeof header !== "string") {
    throw new Error("$.ui.ask 的 header 必须是字符串");
  }
  if (multiSelect !== undefined && multiSelect !== true) {
    // CC 的类型就写死 `multiSelect?: true`：给 false 是「单选的默认」，不是错。
    if (multiSelect !== false) {
      throw new Error("$.ui.ask 的 multiSelect 只能是 true");
    }
  }
  const trimmedHeader = (header ?? pluginName).trim().slice(0, 12);
  return {
    question: question.trim(),
    labels,
    header: trimmedHeader.length > 0 ? trimmedHeader : "plugin",
    ...(multiSelect === true ? { multiSelect: true as const } : {}),
  };
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

/**
 * 元素构造器：既能当 JSX 标签用（`<Text>hi</Text>` 编译成 `h(Text, …, "hi")`），
 * 也能像 Claude Code 的表那样直接调用（`Text({ children: "hi" })`）。
 *
 * 两种写法都必须在：社区插件两种都写（`hamzafer` 用 JSX，官方示例
 * `blast-radius.mjs` 用的是调用）。`elementType` 是 `h()` 认它时用的真名 ——
 * 调用式 `Text({…})` 与 JSX `<Text>` 编出来的是同一棵树。
 */
export interface ModElementBuilder {
  (props?: Record<string, unknown>): unknown;
  readonly elementType: ModElementType;
}

/** 事件钩子能拿到的 `$`（见 spec「$（一期）」）。 */
export interface ModDollar {
  plugin: { name: string };
  ui: {
    /** `ui.render` 的事件 → 该站点可用的元素构造器表（spec「事件」）。 */
    resolve(
      event: unknown,
    ): Readonly<Record<ModElementType, ModElementBuilder>>;
    /**
     * 打开一块面板（spec「面板放得下吗」）。
     *
     * 返回「这一帧有人接住了吗」：`isPlaced: false` 带一句 `reason`（没有能画
     * 面板的表面以 `no-surface` 开头、会话正在销毁）。**不等待用户做任何事**，
     * 也不表示面板已经可见 —— 守卫类插件据此决定要不要把命令冻在等人按键上。
     *
     * `focus` 只接受 `true`（与 Claude Code 一样，传 `false` 报错）：一期桌面端
     * 每个 mod 面板的第一帧都会激活它的 tab，所以这个字段目前不改变行为，收它
     * 只为让 CC 插件原样能跑。
     */
    open(pane: {
      id: string;
      title?: string;
      focus?: true;
    }): Promise<ModUiOpenResult>;
    /** 关掉一块面板（`{ id }` 是 Claude Code 的形状）；没开的 id 什么也不做。 */
    close(pane: { id: string }): Promise<void>;
    /**
     * 这个 mod 自己开着哪些面板。
     *
     * 一期返回 pane id 的数组（Claude Code 返回 `{ id, title, isShown,
     * isFocused, isPlaced }` 对象数组）：后三个字段要等 surface 把「当前显示哪
     * 个 tab」报上来才编得出来，现在编一个只会让守卫按错的答案放行。
     */
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
    /**
     * 问用户一个问题（spec「问用户一个问题」）。
     *
     * resolve 成选中的那个标签，或用户在「其他」里打的自由文本 —— 所以要跟标签
     * 做**精确**比较。没人能答（没有界面、用户关掉了对话框）时 reject。
     */
    ask(question: string, options?: ModAskOptions): Promise<string>;
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
    /**
     * 这一刻有谁在画这条会话（spec「会话事实」）：`["desktop"]` 或 `[]`。
     *
     * **永远不会 reject**：空数组是「没有界面」（`wave -p` 也是正常会话），不是
     * 错误，直接判 `length`。与 `$.ui.open()` 的 `isPlaced` 同一个数据源。
     */
    surfaces(): Promise<readonly ModRenderSurface[]>;
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
  /** 登记一块面板；返回「挂上了没有」（会话正在销毁时 false）。 */
  openPane(paneId: string, title: string): boolean;
  closePane(paneId: string): void;
  listPanes(): string[];
  /**
   * 这一刻有谁在画（`$.session.surfaces()` 与 `$.ui.open()` 的同一份数据源）。
   *
   * 由宿主入口决定，见 {@link renderSurfacesOf}。
   */
  surfaces(): readonly ModRenderSurface[];
  invalidate(target: string): void;
  /** 输入框下方那一行常驻状态；`null` 清除（spec「状态带、状态行与提示」）。 */
  setStatus(text: string | null): void;
  /** 短暂提示；`timeoutMs` 由 runtime 夹进限额后交下来。 */
  showToast(text: string, timeoutMs: number): void;
  /** `$.ui.log`：在对话流里追加一行（长度已由 runtime 夹进限额）。 */
  appendLog(text: string): void;
  /**
   * `$.ui.ask`：问用户一个问题，resolve 成选中的那个标签（或用户自己打的文本）。
   *
   * 参数已由 runtime 校验并归一成 `{ labels }`；「有没有人能答」「对话框怎么
   * 画」「用户关掉了算 reject」都是实现方的事（见 spec「问用户一个问题」）。
   */
  askUser(
    question: string,
    options: { labels: string[]; header?: string; multiSelect?: true },
  ): Promise<string>;
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
 * `turn.start`、`turn.step`、`session.measure`、`session.compact`、`session.end`、
 * `ui.close` 与 `classic.PermissionRequest` 是只读的观察事件，返回值一律丢弃。
 * 有返回值语义的四个：`tool.call` / `tool.run` 答 `{ deny }`（拦下这次调用，
 * 后者还负责真正执行它）、`prompt.submit` 答 `{ context }`（本轮附加上下文，
 * 不改用户原文）、`command.run` 答 `{ text }`。`classic.` 前缀是照 Claude Code
 * 的规矩：它把每个 settings hook 事件都镜像成 `classic.<Event>`，我们只做这一个
 * 镜像，`e` 的形状也照那份 stdin JSON。别的名字一律拒收，免得插件作者依赖一个
 * 不存在的钩子。
 */
const HOOK_NAMES = new Set([
  "session.start",
  "prompt.submit",
  "turn.start",
  "turn.step",
  "ui.render",
  "ui.close",
  "turn.complete",
  "session.measure",
  "session.compact",
  "session.end",
  "tool.call",
  "tool.run",
  "classic.PermissionRequest",
  "command.run",
]);

/**
 * 接受 matcher 的事件（其余事件带 matcher 一律拒收并 warn）。
 *
 * matcher 是**事件字段的子集**：`{ component: "Pane" }` 只吃 `component` 是
 * `Pane` 的那些渲染请求。社区 mod 用这三处把「一个事件、多个处理器」分开：
 * `ui.render` 按站点（`component` / `requestId`）、`tool.call` 按工具名、
 * `command.run` 按命令名。
 */
const MATCHER_EVENTS = new Set([
  "command.run",
  "ui.render",
  "tool.call",
  "tool.run",
]);

/**
 * matcher 里用的字段名 → 事件的字段名。
 *
 * 社区按 Claude Code 的字段名写 matcher（`requestId` 是渲染请求的实例 id），
 * 我们的事件里那个字段叫 `instance_id`（与 CC 的 `ui_render` 消息同形）。
 */
const MATCHER_KEY_ALIASES: Record<string, string> = {
  requestId: "instance_id",
};

/**
 * 事件里给社区再补一份 Claude Code 的字段名（同一个值两个名字）。
 *
 * `ui.render` 的站点实例 id：CC 的**钩子事件**里叫 `requestId`，它的
 * `ui_render` **消息**里叫 `instance_id`，我们的事件按后者写。社区 mod 在
 * handler 里比的是前者 —— 官方示例 `blast-radius` 就是
 * `if (e.requestId !== PANE_ID) return next(e)`，少了这个别名，它的面板永远画
 * 不出来（`isPlaced` 为真、树却空着）。matcher 那边早就按同一张表归一（见
 * {@link MATCHER_KEY_ALIASES}），这里补的是 handler 读的那个副本。
 */
function withEventAliases(event: unknown): unknown {
  if (!isPlainObject(event)) return event;
  if (typeof event.instance_id !== "string") return event;
  if (event.requestId !== undefined) return event;
  return { ...event, requestId: event.instance_id };
}

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
 * `next.signal` 的缺省：一个永远不 abort 的 signal。
 *
 * 只有整条调用真的会被放弃时才有必要造一个控制器；其余事件给这个常量，mod 挂
 * 监听不会报错，只是永远等不到 abort。
 */
const NEVER_ABORTED = new AbortController().signal;

/** `on(...)` 的返回值：只有社区的 `.catch(fn)` 一种用法。 */
interface HookRegistration {
  catch: (onError: unknown) => HookRegistration;
}

/** 一个已注册的钩子。 */
interface HookEntry {
  /** 原样的处理函数；形状（`(e)` / `($, e, next)`）看 {@link HookEntry.isCommunity}。 */
  handler: (...args: unknown[]) => unknown;
  /** 事件字段的子集；没有就是「所有这个事件的实例」。 */
  matcher?: Record<string, unknown>;
  /** `on(...).catch(fn)`：这个钩子抛错（含超时）时的兜底。 */
  onError?: (...args: unknown[]) => unknown;
  /** handler 是社区形状 `($, e, next)` —— 由登记时用的是哪个 `register` 实参决定。 */
  isCommunity: boolean;
  /** onError 与 handler 同形状。 */
  isCommunityError: boolean;
}

/** 命令名归一：`burn` 与 `/burn` 是同一条（社区的 matcher 不带斜杠）。 */
function normalizeCommand(command: string): string {
  return command.startsWith("/") ? command : `/${command}`;
}

function matcherValueMatches(
  key: string,
  expected: unknown,
  actual: unknown,
): boolean {
  if (
    key === "command" &&
    typeof expected === "string" &&
    typeof actual === "string"
  ) {
    return normalizeCommand(expected) === normalizeCommand(actual);
  }
  return expected === actual;
}

/**
 * matcher 是不是这个事件的实例：要求 matcher 里**每一项**都对上。
 *
 * matcher 的值可以是一组候选（`{ tool: ["Write", "Edit"] }`），命中任一个都算。
 */
function matchesEvent(
  matcher: Record<string, unknown> | undefined,
  event: unknown,
): boolean {
  if (!matcher) return true;
  if (!isPlainObject(event)) return false;
  for (const [rawKey, expected] of Object.entries(matcher)) {
    const key = MATCHER_KEY_ALIASES[rawKey] ?? rawKey;
    const actual = event[key];
    if (Array.isArray(expected)) {
      if (!expected.some((value) => matcherValueMatches(key, value, actual))) {
        return false;
      }
      continue;
    }
    if (!matcherValueMatches(key, expected, actual)) return false;
  }
  return true;
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
  /**
   * 钩子表：事件名 → 按注册顺序排的处理器。
   *
   * 一个事件可以有多条（社区写法：同一个 mod 给 `ui.render` 的多个站点、给
   * `tool.call` 的多个工具名各注册一条），所以是数组而不是单值；具体哪几条
   * 参与这次事件由 matcher 决定（见 {@link matchesEvent}）。
   */
  private readonly hooks = new Map<string, HookEntry[]>();
  /** 正在跑 `command.run` 钩子的层数（`$.command.run` 靠它拒自激）。 */
  private commandHookDepth = 0;
  private readonly dollar: ModDollar;
  private readonly wave: unknown;
  /**
   * 元素表：`$.ui.resolve(e)` 与 `require` 拿到的是同一份。**每实例一份**
   * （不是模块级常量），因为构造器要绑这个实例的 `h`（它记 handlers）。
   */
  private readonly elements: ModElementTable;
  /** 当前正在计时的预算（`$.process.spawn` 等输出时会被暂停）。 */
  private budget: HookBudget | undefined;
  /** `$.fs` 的实现，惰性创建：多数 mod 一次都不碰文件。 */
  private fileApiHolder: ModFs | undefined;

  constructor(
    private readonly host: ModRuntimeHost,
    private readonly entryPath: string,
    compiled: CompiledModule[],
    /**
     * `plugin.json` 的 `userConfig` 当前取值（只有默认值，spec「兼容社区 mod」）。
     *
     * 社区形状的 `register(on, options)` 读它；我们的形状用不到，但两种形状
     * 都拿到同一对实参（见 {@link load}）。
     */
    private readonly modOptions: Record<string, unknown> = {},
  ) {
    for (const mod of compiled) {
      this.sources.set(path.resolve(mod.path), mod.code);
    }

    const h = (type: unknown, props: unknown, ...children: unknown[]) => {
      const tag = tagOf(type);
      const rawProps = isPlainObject(props) ? props : {};
      const key = typeof rawProps.key === "string" ? rawProps.key : undefined;
      const kept: Record<string, ModPropValue> = {};
      // `hover` 的值是对象，props 只收原始值 —— 所以它是节点的独立字段
      // （与 Claude Code 的 `{ type, props, hover }` 同形）。形状不对时照样
      // 搬过去，由校验器点名，不在这里猜作者想写什么。
      let hover: unknown;
      for (const [name, value] of Object.entries(rawProps)) {
        if (name === "hover") {
          hover = value;
          continue;
        }
        if (CALLBACK_PROPS.has(name)) {
          const callback = value as (input?: string) => unknown;
          if (key && typeof callback === "function") {
            this.handlers.set(`${tag}:${key}`, callback);
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
          continue;
        }
        // 函数/对象 prop 到不了树上（过不了 RPC）。以前是静默丢弃，作者只看到
        // 「写了没效果、也没有报错」；现在点名，免得对着树猜。
        logger.warn(
          `[Wave] ${host.pluginName} 的 <${tag}${key ? ` key="${key}"` : ""}> 上有个 prop 传不出去：${name}（只有字符串/数字/布尔/null 能进树；对象只有 Select.options 与 hover 两处例外）`,
        );
      }
      const nodeChildren: Array<ModTreeNode | string> = [];
      for (const child of children) appendChildren(nodeChildren, child);
      return {
        type: tag,
        props: kept,
        ...(hover === undefined ? {} : { hover }),
        children: nodeChildren,
      };
    };

    /** 元素表：`$.ui.resolve(e)` 与 `require("claude-code")` 拿到的是这一份。 */
    this.elements = elementTableOf(h);
    const elements = this.elements;

    this.wave = { h, Fragment: "Fragment", elements };

    this.dollar = {
      plugin: { name: host.pluginName },
      ui: {
        resolve: (event: unknown) => resolveElements(event, elements),
        // 与 Claude Code 同形：`isPlaced` 说这块面板有没有真的挂到某端上。
        // 判据是「有没有 surface 在画」，不是「宿主登记成功没」—— 终端里登记
        // 得到一块永远没人画的面板，守卫若照它等人按键就会把对话挂死。
        open: async (pane) => {
          const id = pane?.id;
          if (typeof id !== "string" || id.length === 0) {
            throw new Error("$.ui.open 需要一个非空的 pane id");
          }
          if (pane.focus !== undefined && pane.focus !== true) {
            // 与 Claude Code 同一条：`focus` 只收 `true`，要条件式就整字段省略。
            throw new Error("$.ui.open 的 focus 只能写 true 或者不写");
          }
          const title = typeof pane.title === "string" ? pane.title : id;
          // 登记照做：与 Claude Code 一样「没有 surface 也把面板留着」—— 之后
          // 有界面挂上来它就画出来，`$.ui.panes()` 也看得到它。`isPlaced` 才是
          // 诚实的那句话。
          const registered = host.openPane(id, title);
          if (host.surfaces().length === 0) {
            return {
              isPlaced: false,
              reason: "no-surface: 这条会话没有能画 mod 面板的表面",
            };
          }
          return registered
            ? { isPlaced: true }
            : { isPlaced: false, reason: "会话正在销毁" };
        },
        close: async (pane) => {
          const id = (pane as { id?: unknown } | undefined)?.id;
          if (typeof id !== "string" || id.length === 0) {
            throw new Error("$.ui.close 需要一个 { id }");
          }
          host.closePane(id);
        },
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
        // 借引擎自己的提问通道（`AskUserQuestion` 那条审批链路），所以宿主不
        // 需要为 mod 单独画一个对话框（spec「问用户一个问题」）。
        ask: (question, options) => {
          const { question: text, ...rest } = normalizeAskQuestion(
            question,
            options,
            host.pluginName,
          );
          // 等人的时间不算钩子预算：与 `$.process.run` 同一条口径。
          return this.withBudget(() => host.askUser(text, rest));
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
        // 这几个事实都异步（Claude Code 同名方法也是异步的），一律现取。
        id: async () => host.sessionId(),
        root: async () => host.workspaceRoot(),
        model: async () => host.model(),
        // 空数组 = 没有界面（`wave -p` 也是正常会话），永远不 reject。
        surfaces: async () => [...host.surfaces()],
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
    hardenContext(this.context);
  }

  /**
   * 让**宿主持有的** mod 回调也走沙箱那一跳。
   *
   * `$.clock.after/every` 的回调由 `ModManager` 的定时器触发，不在钩子链上 ——
   * 宿主直接 `fn()` 的话，回调里的同步死循环同样能把进程卡死（与钩子同一个洞）。
   */
  runSandboxedCallback<T>(
    fn: (...args: unknown[]) => unknown,
    label: string,
    filename: string,
  ): T {
    return this.invokeInContext<T>(fn, undefined, [], label, filename);
  }

  /**
   * 在沙箱里执行一次工作 —— **所有**跨入都从这里走。
   *
   * 为什么不能直接 `fn(...)`：`vm` 的 `timeout` 是 V8 的 terminate，只在
   * `runInContext` 那一层生效；宿主直接调用一个从 context 里取出来的函数，它会
   * 一路裸跑，`while (true) {}` 能把 `wave --stdio` 整个卡死（5 秒预算的
   * `setTimeout` 在同一个事件循环上，根本轮不到）。所以把工作放进槽位、用
   * `runInContext` 触发，让这段同步执行落在 terminate 的覆盖范围里。
   *
   * 覆盖的是**同步段**：`async` 处理函数第一次 `await` 就交回宿主了，那之后的
   * 时间由 {@link HookBudget} 管（它看的是墙钟；两边互补，缺一边就有洞）。
   */
  private invokeInContext<T>(
    fn: (...args: unknown[]) => unknown,
    self: unknown,
    args: unknown[],
    label: string,
    filename: string,
  ): T {
    const context = this.context as unknown as Record<string, unknown>;
    context[SANDBOX_SLOT] = { fn, self, args };
    try {
      return invokeScriptOf().runInContext(this.context, {
        filename,
        timeout: MOD_LIMITS.hookTimeoutMs,
      }) as T;
    } catch (error) {
      if (
        (error as { code?: unknown } | undefined)?.code ===
        "ERR_SCRIPT_EXECUTION_TIMEOUT"
      ) {
        // vm 的原文是 `Script execution timed out after 5000ms`，既不说谁超时
        // 也不说卡在哪 —— 换成点名这一跳的说法。
        throw new Error(
          `${label} 的同步执行超过 ${MOD_LIMITS.hookTimeoutMs}ms（多半是卡在死循环里）`,
        );
      }
      throw error;
    } finally {
      context[SANDBOX_SLOT] = undefined;
    }
  }

  /**
   * 执行入口文件，调用它导出的 `register`。
   *
   * 两种注册签名都认（spec「兼容社区 mod」），**按实参形状区分**：两个实参都是
   * 同一个登记函数，只是各自挂了一套属性 ——
   *
   * - 第一个挂着 `$`（`ui` / `store` / `clock`…）。我们的形状把它当对象用；
   * - 第二个挂着 `userConfig` 的当前取值。社区的形状把它当对象用。
   *
   * 于是 `register($, on)` 与 `register(on, options)` 都能原样跑：两条路里
   * 「当对象用的那个实参」都能读到自己的属性，「当函数用的那个实参」都能登记。
   *
   * 返回 `false` 表示这个文件没有导出 `register` —— 它只是被别的 mod
   * `import` 的共享模块，不是面板入口（`mods/` 与 `hooks/hooks.json` 声明的
   * 文件全部参与编译，但只有带 `register` 的才算一个 mod）。
   */
  async load(): Promise<boolean> {
    const exports = this.execute(this.entryPath, new Set());
    const register = (exports as { register?: unknown } | undefined)?.register;
    if (typeof register !== "function") return false;
    // 两种 `register` 形状靠**哪一个实参被当成登记函数**区分，而不是 handler 的
    // 形参个数：我们的是 `register($, on)`（用第 2 个），社区的是
    // `register(on, options)` / `Register = on =>`（用第 1 个，还是对象照样能用）。
    // 形参个数在社区侧靠不住 —— `on("command.run", matcher, async $ => …)` 只写
    // 一个形参，那就是社区的 `$`。
    const registrarFor =
      (isCommunity: boolean) =>
      (
        name: unknown,
        matcherOrHandler: unknown,
        maybeHandler?: unknown,
      ): HookRegistration =>
        this.registerHook(name, matcherOrHandler, maybeHandler, isCommunity);
    const bind = (isCommunity: boolean, extra: object) => {
      const registrar = registrarFor(isCommunity);
      return Object.assign(
        (...args: unknown[]) => registrar(args[0], args[1], args[2]),
        extra,
      );
    };
    const withDollar = bind(true, this.dollar);
    const withOptions = bind(false, this.modOptions);
    const result = this.invokeInContext(
      register as (...args: unknown[]) => unknown,
      exports,
      [withDollar, withOptions],
      `${this.host.pluginName} 的 register`,
      `${this.entryPath}:register`,
    );
    if (isThenable(result)) await result;
    return true;
  }

  /**
   * 登记一个钩子（`on(name, handler)` / `on(name, matcher, handler)`）。
   *
   * 拒收的理由一律留一条 warn：静默登记一个永远不触发的处理器，比报错更难查。
   */
  private registerHook(
    name: unknown,
    matcherOrHandler: unknown,
    maybeHandler: unknown,
    isCommunity: boolean,
  ): HookRegistration {
    const noop: HookRegistration = {
      catch: () => noop,
    };
    if (typeof name !== "string") return noop;
    const hasMatcher = typeof maybeHandler === "function";
    const handler = hasMatcher ? maybeHandler : matcherOrHandler;
    if (typeof handler !== "function") return noop;
    if (!HOOK_NAMES.has(name)) {
      logger.warn(
        `[Wave] ${this.host.pluginName} 注册了不存在的 mod 钩子：${name}（可用：${[...HOOK_NAMES].join(" / ")}）`,
      );
      return noop;
    }
    if (hasMatcher && !MATCHER_EVENTS.has(name)) {
      logger.warn(
        `[Wave] ${this.host.pluginName} 给 ${name} 传了 matcher：只有 ${[...MATCHER_EVENTS].join(" / ")} 接受 matcher，这一条被忽略`,
      );
      return noop;
    }
    // `command.run` 的 matcher 是**可选**的：社区 mod（burn-rate 的 limit-guard）
    // 就是 `on("command.run", handler)` 一条钩子管自己所有命令，在钩子里比
    // `e.command`。派发本身已经按 mod 分开（`runCommandHook(modId, …)`），所以
    // 没有 matcher 只是「这个 mod 的每条命令都问它」，不会串到别的 mod 去。
    let matcher: Record<string, unknown> | undefined;
    if (hasMatcher) {
      if (!isPlainObject(matcherOrHandler)) {
        logger.warn(
          `[Wave] ${this.host.pluginName} 的 ${name} matcher 必须是对象，这一条被忽略`,
        );
        return noop;
      }
      if (
        name === "command.run" &&
        (typeof matcherOrHandler.command !== "string" ||
          matcherOrHandler.command.replace(/^\//, "").length === 0)
      ) {
        logger.warn(
          `[Wave] ${this.host.pluginName} 的 command.run matcher 要写成 { command: "/<命令名>" }，这一条被忽略`,
        );
        return noop;
      }
      matcher = { ...matcherOrHandler };
    }
    const entry: HookEntry = {
      handler: handler as (...args: unknown[]) => unknown,
      matcher,
      isCommunity,
      isCommunityError: false,
    };
    const list = this.hooks.get(name);
    if (list) list.push(entry);
    else this.hooks.set(name, [entry]);
    const registration: HookRegistration = {
      // 社区的 `on(...).catch(handler)`：钩子抛错（含 5 秒预算超时）时用它兜底，
      // 兜底自己也抛错才算这条钩子失败。
      catch: (onError: unknown) => {
        if (typeof onError !== "function") return registration;
        entry.onError = onError as (...args: unknown[]) => unknown;
        // 兜底与它所在的那条钩子同形状（同一个 `on` 登记出来的）。
        entry.isCommunityError = isCommunity;
        return registration;
      },
    };
    return registration;
  }

  /**
   * 跑这条事件上的处理器链，返回**第一个匹配上的处理器**给出的值。
   *
   * 社区形状的 `next(e)` 把控制权交给链上的下一个（最后是引擎自己那一帧，
   * 见 {@link engineFrame}），所以「包一层再返回」的写法照样成立。一次 handler
   * 只能调一次 `next(e)` —— 再调会让同一条链跑两遍。
   */
  private async runChain(
    name: string,
    entries: HookEntry[],
    start: number,
    event: unknown,
    engine: (finalEvent: unknown) => unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    for (let index = start; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (!matchesEvent(entry.matcher, event)) continue;
      let nextCalled = false;
      /** 已经交给下层的那次调用的结果（`.catch` 里的重放要用）。 */
      let nextResult: Promise<unknown> | undefined;
      const callNext = (nextEvent?: unknown) => {
        nextResult = this.runChain(
          name,
          entries,
          index + 1,
          nextEvent === undefined ? event : nextEvent,
          engine,
          signal,
        );
        return nextResult;
      };
      const next = Object.assign(
        (nextEvent?: unknown) => {
          if (nextCalled) {
            throw new Error("next(e) 一次只能调一次：再调会让同一条链跑两遍");
          }
          nextCalled = true;
          return callNext(nextEvent);
        },
        {
          /**
           * 整条调用被放弃时 abort（会话销毁、插件重载）。长等待挂在它上面，
           * 才能在会话没了的时候收手。
           */
          signal,
        },
      );
      try {
        return await this.invokeInContext<unknown>(
          entry.handler,
          undefined,
          entry.isCommunity ? [this.dollar, event, next] : [event],
          `${name} 的处理函数`,
          `${this.host.pluginName}:${name}`,
        );
      } catch (error) {
        if (!entry.onError) throw error;
        if (!entry.isCommunityError) {
          return await this.invokeInContext<unknown>(
            entry.onError,
            undefined,
            [error],
            `${name} 的 catch`,
            `${this.host.pluginName}:${name}`,
          );
        }
        // 社区 `.catch(($, e, next) => …)`：这里的 `next` 多两样东西 ——
        // `error`（为什么失败）与 `called`（失败之前有没有调过 `next`）。
        // 调过就**重放**那次调用的结果，不把下面的链再跑一遍（CC 的 `Caught`）。
        const caught = Object.assign(
          (nextEvent?: unknown) => {
            if (nextCalled) return nextResult ?? Promise.resolve({});
            nextCalled = true;
            return callNext(nextEvent);
          },
          { signal, error, called: nextCalled },
        );
        return await this.invokeInContext<unknown>(
          entry.onError,
          undefined,
          [this.dollar, event, caught],
          `${name} 的 catch`,
          `${this.host.pluginName}:${name}`,
        );
      }
    }
    // 引擎帧按**走到这里的那份事件**算：`next({ ...e, context })` 改过的内容
    // 必须在链尾出现，否则注入静默失效。
    return engine(event);
  }

  /**
   * 引擎自己那一帧 —— `next(e)` 走到链尾时拿到的东西。
   *
   * `ui.render` 的 `Pane` / `AbovePrompt` 是留给 mod 的空间，引擎没有自己那一帧
   * （`undefined`，社区的写法会据此判断「这个站点本来就是空的」）。
   *
   * 其余事件里，社区最常见的写法是「改一份事件再 `next(e)`」——
   * `return next({ ...e, context: [...] })` 那种（burn-rate 的限额提醒就这么
   * 写）。链尾必须从**最终那份事件**上把答案取回来，否则 mod 传下去的改动在
   * 链尾被丢掉，宿主拿到一个空对象。观察型事件的引擎帧就是个空对象：社区 mod
   * 会读 `ran.deny` / `ran.isError`，给 `undefined` 会当场抛属性错误。
   */
  private engineFrame(name: string, event: unknown): unknown {
    if (name === "ui.render") return undefined;
    if (!isPlainObject(event)) return {};
    if (name === "prompt.submit") {
      const context = event.context;
      // 只认字符串数组：形状不对时按「引擎没有意见」处理，由宿主那边统一报。
      return Array.isArray(context) &&
        context.every((item) => typeof item === "string")
        ? { context }
        : {};
    }
    if (name === "command.run") {
      return typeof event.text === "string" ? { text: event.text } : {};
    }
    return {};
  }

  /**
   * 这个 mod 有没有注册能接下这次事件的钩子。
   *
   * `tool.call` / `tool.run` 的链是**跨 mod** 的（`ModManager` 逐个 mod 往下
   * 走），走到一个压根没注册的 mod 时要能跳过它而不是把它的「空结果」当成决议。
   */
  matchesHook(name: string, event: unknown): boolean {
    return this.matchingHooks(name, event).length > 0;
  }

  /** 该事件上匹配这次事件的处理器（`command.run` 也走这张表）。 */
  private matchingHooks(name: string, event: unknown): HookEntry[] {
    const entries = this.hooks.get(name);
    if (!entries || entries.length === 0) return [];
    return entries.filter((entry) => matchesEvent(entry.matcher, event));
  }

  /**
   * 调一个钩子；没有注册时返回 `{ ok: true, value: undefined }`。
   *
   * `options.engine` 换掉「链尾」—— `tool.call` / `tool.run` 的链尾不是空对象，
   * 而是「交给下一个 mod」与「真正执行这次调用」（见 `ModManager`）。
   * `options.signal` 就是 `next.signal`：整条调用被放弃时 abort。
   */
  async callHook(
    name: string,
    rawEvent: unknown,
    options: {
      engine?: (finalEvent: unknown) => unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<ModHookResult> {
    const event = withEventAliases(rawEvent);
    const entries = this.matchingHooks(name, event);
    if (entries.length === 0)
      return { ok: true, value: undefined, elapsedMs: 0 };
    const started = Date.now();
    const engine =
      options.engine ?? ((e: unknown) => this.engineFrame(name, e));
    const signal = options.signal ?? NEVER_ABORTED;
    try {
      const value = await this.runWithBudget(
        `${name} 钩子超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
        () => this.runChain(name, entries, 0, event, engine, signal),
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
   * 参数带斜杠（`"/standup"`）；**事件里的 `e.command` 不带斜杠** —— 社区 mod
   * 直接比 `e.command === "guard"`，那是 Claude Code 的口径。matcher 两边都归
   * 一（见 `matcherValueMatches`），所以哪种写法都能匹配上。
   *
   * 没有对应处理器时返回 `{ ok: true, value: undefined }` —— 由调用方（宿主）
   * 决定「注册了命令却没人答」怎么报。
   */
  async callCommandHook(command: string, args: string): Promise<ModHookResult> {
    const event = { command: command.replace(/^\//, ""), args };
    const entries = this.matchingHooks("command.run", event);
    if (entries.length === 0)
      return { ok: true, value: undefined, elapsedMs: 0 };
    const started = Date.now();
    this.commandHookDepth += 1;
    try {
      const value = await this.runWithBudget(
        `${command} 的命令钩子超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
        () =>
          this.runChain(
            "command.run",
            entries,
            0,
            event,
            (e) => this.engineFrame("command.run", e),
            NEVER_ABORTED,
          ),
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
      () =>
        this.invokeInContext<unknown>(
          handler as (...args: unknown[]) => unknown,
          undefined,
          [kind === "press" ? undefined : value],
          `${kind}(${key}) 的交互回调`,
          `${this.host.pluginName}:${type}:${key}`,
        ),
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
    return [...this.hooks.keys()].filter(
      (name) => (this.hooks.get(name)?.length ?? 0) > 0,
    );
  }

  /**
   * 这个 mod 有没有**显式点名**某个 `ui.render` 站点的钩子（matcher 里写了
   * `component: "<站点>"`）。
   *
   * `AbovePromptList` 用它决定问谁：没写 matcher 的 `ui.render` 处理器会收到
   * 每一个站点，而一个「只画自己那一行」的插件在收到 `AbovePromptList` 时会
   * 照样返回自己那棵树 —— 那棵树里恰好有它自己那一行，按「留下哪些行」的语义
   * 就等于把所有别人的行都隐藏了。所以这个站点只问**显式注册过它**的 mod。
   */
  hasSiteHook(name: string, site: string): boolean {
    const entries = this.hooks.get(name) ?? [];
    return entries.some((entry) => entry.matcher?.["component"] === site);
  }

  /** 该 mod 用 matcher 注册了哪些命令（宿主清理/诊断用，带斜杠）。 */
  commandHookTargets(): string[] {
    const entries = this.hooks.get("command.run") ?? [];
    const commands: string[] = [];
    for (const entry of entries) {
      const command = entry.matcher?.command;
      if (typeof command === "string") {
        const normalized = normalizeCommand(command);
        if (!commands.includes(normalized)) commands.push(normalized);
      }
    }
    return commands;
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
      // `wave-agent-sdk/mods` 是我们对外推荐的名字；社区的 `'claude-code'` 是它
      // 的**别名**（同一份模块：元素构造器 + atom/read/update）。不引入那个 npm
      // 包、也不解析 `node_modules`。
      if (
        specifier === MODULE_SPECIFIER ||
        specifier === COMMUNITY_MODULE_SPECIFIER
      ) {
        return { ...this.elements, Fragment: "Fragment", atom, read, update };
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        throw new Error(
          `mod 只能 import 相对路径、${MODULE_SPECIFIER} 或 ${COMMUNITY_MODULE_SPECIFIER}：${specifier}`,
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
    }) as (...args: unknown[]) => unknown;
    try {
      this.invokeInContext(
        factory,
        module.exports,
        [module, module.exports, requireFn, this.wave],
        `模块 ${path.basename(resolved)} 的执行`,
        resolved,
      );
    } catch (error) {
      // 模块体抛错或超时的，别把半成品留在缓存里：后面 `import` 它的文件会拿到
      // 一个空 exports，失败点离原因更远。
      this.modules.delete(resolved);
      throw error;
    } finally {
      visiting.delete(resolved);
    }
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
