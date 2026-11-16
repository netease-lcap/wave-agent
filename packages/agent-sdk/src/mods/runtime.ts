import * as vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";
import type {
  ModAgentInfo,
  ModAskOptions,
  ModCommandInfo,
  ModCommandSpec,
  ModConfigRow,
  ModElementType,
  ModFetchResult,
  ModFsAncestor,
  ModFsEntry,
  ModFsStat,
  ModModelCompleteResult,
  ModPromptBox,
  ModRunOptions,
  ModRunResult,
  ModSessionRepo,
  ModSessionMessage,
  ModSessionVersion,
  ModToolInfo,
  ModTreeNode,
  ModSpawnOptions,
  ModProcessChunk,
  ModProcessExit,
  ModPropValue,
  ModPromptFillMode,
  ModRenderSurface,
  ModSessionUsage,
  ModSettingsSource,
  ModToolRegisterSpec,
  ModUiCopyResult,
  ModUiViewResult,
  ModUiOpenResult,
} from "../types/mods.js";
import {
  MOD_ELEMENT_TYPES,
  MOD_LIMITS,
  MOD_RENDER_SURFACES,
  MOD_SETTINGS_SOURCES,
  MOD_SURFACE_ELEMENTS,
} from "../types/mods.js";
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
 * 元素名（`h()` 认的 tag）的唯一来源是 `MOD_ELEMENT_TYPES`：`./index.js` 只是给
 * 插件作者用的那层包装，两边漂移会让 `<Text>` 编译出来的 tag 在渲染器里变成未知
 * 元素。`tests/mods/runtime.test.ts` 钉住了它与各端元素表的一致性。
 */

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
 * 一期两端：`desktop`（webview 右侧面板与带）与 `terminal`（`wave` 的输入框上方），
 * 各自能画的元素见 `MOD_SURFACE_ELEMENTS`（终端少 `Svg`）。Claude Code 还有
 * `vscode` / `mobile`，我们没接 —— 别的值当错处理，别让它悄悄拿到桌面端的表。
 */
const SURFACES_WE_DRAW: readonly ModRenderSurface[] = ["terminal", "desktop"];

/**
 * 这一刻有谁在画这条会话（spec「会话事实」的 `$.session.surfaces()`）。
 *
 * **只是默认值**：宿主在 `AgentOptions.renderSurfaces` 里显式声明时以声明为准
 * （终端 CLI 声明 `["terminal"]`，而 `wave -p` 同样是 `entrypoint: "cli"` 却不画，
 * 所以不能靠入口区分）。没声明时按入口推导：桌面端会画 mod 的树 ⇒ `["desktop"]`；
 * VS Code / JetBrains / 远控 ⇒ `[]`（「没有界面」）。判据是**有没有界面**而不是
 * 「能不能画面板」：`$.ui.open()` 的 `isPlaced` 与它同一个数据源。
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
 * 名字全部取自 {@link MOD_SURFACE_ELEMENTS}：桌面端 10 个，终端 9 个（少 `Svg`）。
 * 模块导入拿到的是**并集**（两端名字都在），按端裁剪只发生在 `$.ui.resolve(e)`
 * 与校验 —— 给了画不出的名字，mod 编出的树会被 `validateModTree` 拒掉，错误离
 * 原因更远。
 *
 * **每个 mod 实例一份、且在构造时冻结**：构造器要闭包住这个实例的 `h()`（事件
 * 回调登记在实例上），所以不能是模块级共享的那一份。
 */
type ModElementTable = Readonly<
  Partial<Record<ModElementType, ModElementBuilder>>
>;

/**
 * 造一套元素构造器：调用式 `Text({ children: "hi" })` 与 JSX `<Text>hi</Text>`
 * 都落到同一个 `h()` 上。
 *
 * `children` 从 props 里摘出来（CC 的调用式把子节点写在 props 上），其余原样交给
 * `h()`：它才知道哪些 prop 能进树、哪些是回调。
 */
function elementTableOf(
  h: (type: unknown, props: unknown, ...children: unknown[]) => unknown,
  names: readonly ModElementType[],
): ModElementTable {
  const table: Record<string, ModElementBuilder> = {};
  for (const elementType of names) {
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
  tables: Readonly<Record<string, ModElementTable>>,
): ModElementTable {
  const e = (typeof event === "object" && event !== null ? event : {}) as {
    surface?: unknown;
    component?: unknown;
  };
  const surface = typeof e.surface === "string" ? e.surface : undefined;
  const table = surface === undefined ? undefined : tables[surface];
  if (!table) {
    throw new Error(
      `$.ui.resolve 需要一个 ui.render 的事件（e.surface 是画这棵树的那一端，一期只有 ${SURFACES_WE_DRAW.join(" / ")}${surface === undefined ? "" : `，拿到的是 "${surface}"`}）`,
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

/** `$.ui.copy({ surface })` 的端名是否合法。 */
function isRenderSurface(value: unknown): value is ModRenderSurface {
  return (
    typeof value === "string" &&
    (MOD_RENDER_SURFACES as readonly string[]).includes(value)
  );
}

/** `child` 与 `parent` 是同一个路径，或者 `child` 落在 `parent` 之内。 */
function isWithinPath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * 校验 `$.fs.ancestors` 的参数（spec「沿目录链找指令文件」）。
 *
 * `names` 只收文件名：给了带 `/` 的路径就当场报错，而不是拿它去 `join` 出一
 * 个跑到祖父目录外面的路径。
 */
function normalizeAncestorRequest(request: unknown): {
  names: string[];
  of?: string;
  below?: string;
} {
  const value = (request ?? {}) as {
    names?: unknown;
    of?: unknown;
    below?: unknown;
  };
  if (!Array.isArray(value.names) || value.names.length === 0) {
    throw new Error('$.fs.ancestors 需要一个 { names: ["AGENTS.md"] }');
  }
  const names: string[] = [];
  for (const name of value.names) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("$.fs.ancestors 的 names 只能是非空字符串");
    }
    if (name.includes("/") || name.includes(path.sep)) {
      throw new Error(
        `$.fs.ancestors 的 names 只收文件名，不接受路径：${name}`,
      );
    }
    if (!names.includes(name)) names.push(name);
  }
  for (const key of ["of", "below"] as const) {
    const item = value[key];
    if (item !== undefined && typeof item !== "string") {
      throw new Error(`$.fs.ancestors 的 ${key} 必须是字符串`);
    }
  }
  return {
    names,
    of: value.of as string | undefined,
    below: value.below as string | undefined,
  };
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
 * 校验 `$.tool.register` 的参数（spec「把我们自己的工具交给模型」）。
 *
 * 名字由 runtime 补前缀：模型看到的是 `mcp__<plugin>__<name>`。`<plugin>` 归一
 * 成 `[a-z0-9_-]+`（插件名可能带空格、大写、点），与 MCP 工具名同一个字符集 ——
 * `isRestrictedTool()` 按 `mcp__` 前缀把这些工具归进受限工具，于是它们自动走
 * 与 MCP 工具同一条审批路，不用给「第三方工具」单开一条权限分支。
 */
function normalizeToolRegisterSpec(
  spec: unknown,
  pluginName: string,
): { name: string; description: string; inputSchema: Record<string, unknown> } {
  if (!isPlainObject(spec)) {
    throw new Error(
      "$.tool.register 需要一个对象：{ name, description, inputSchema? }",
    );
  }
  const name = spec.name;
  if (typeof name !== "string" || !COMMAND_NAME_RE.test(name)) {
    throw new Error(
      "$.tool.register 的 name 只能用小写/大写字母、数字、下划线和连字符（1-64 个）",
    );
  }
  const description = spec.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(
      "$.tool.register 需要 description（模型读到的那段，不能为空）",
    );
  }
  if (description.length > MOD_LIMITS.modToolDescriptionChars) {
    throw new Error(
      `$.tool.register 的 description 有 ${description.length} 个字符，超过 ${MOD_LIMITS.modToolDescriptionChars}`,
    );
  }
  const inputSchema = spec.inputSchema;
  if (inputSchema !== undefined && !isPlainObject(inputSchema)) {
    throw new Error("$.tool.register 的 inputSchema 是一个 JSON Schema 对象");
  }
  const schema = (inputSchema as Record<string, unknown> | undefined) ?? {
    type: "object",
  };
  const schemaBytes = Buffer.byteLength(JSON.stringify(schema) ?? "", "utf-8");
  if (schemaBytes > MOD_LIMITS.modToolSchemaBytes) {
    throw new Error(
      `$.tool.register 的 inputSchema 有 ${schemaBytes} 字节，超过 ${MOD_LIMITS.modToolSchemaBytes}`,
    );
  }
  const owner = pluginName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return {
    name: `mcp__${owner}__${name}`,
    description: description.trim(),
    inputSchema: schema,
  };
}

/**
 * 校验 `$.agent.spawn` 的参数（spec「派子代理」）。
 *
 * 与 Claude Code 的 `AgentSpawnArgs` 同一个形状：`prompt` 必填，其余可选。
 */
function normalizeAgentSpawnArgs(args: unknown): {
  prompt: string;
  description?: string;
  subagentType?: string;
  model?: string;
} {
  if (!isPlainObject(args)) {
    throw new Error(
      "$.agent.spawn 需要一个对象：{ prompt, description?, subagentType?, model? }",
    );
  }
  const prompt = args.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("$.agent.spawn 需要非空的 prompt");
  }
  const pick = (key: "description" | "subagentType" | "model") => {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`$.agent.spawn 的 ${key} 是非空字符串`);
    }
    return value;
  };
  const description = pick("description");
  const subagentType = pick("subagentType");
  const model = pick("model");
  return {
    prompt,
    ...(description === undefined ? {} : { description }),
    ...(subagentType === undefined ? {} : { subagentType }),
    ...(model === undefined ? {} : { model }),
  };
}

/**
 * 校验 `$.model.complete` 的参数（spec「让模型替插件答一次」）。
 *
 * `maxTokens` 缺省与上限都照 Claude Code：缺省 1024，上限是「模型自己的输出上限
 * 与 64000 中较小者」—— 我们这一层只知道后一半，前一半由模型配置那边夹。
 */
function normalizeCompleteRequest(request: unknown): {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  signal?: AbortSignal;
} {
  if (!isPlainObject(request)) {
    throw new Error(
      "$.model.complete 需要一个对象：{ model, prompt, system?, maxTokens?, timeoutMs? }",
    );
  }
  const model = request.model;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error("$.model.complete 需要 model（别名或全名）");
  }
  const prompt = request.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error("$.model.complete 需要非空的 prompt");
  }
  const system = request.system;
  if (system !== undefined && typeof system !== "string") {
    throw new Error("$.model.complete 的 system 是字符串");
  }
  const rawMax = request.maxTokens;
  if (
    rawMax !== undefined &&
    (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax <= 0)
  ) {
    throw new Error("$.model.complete 的 maxTokens 是正整数");
  }
  const maxTokens = Math.min(rawMax ?? 1024, MOD_LIMITS.modModelMaxTokens);
  const rawTimeout = request.timeoutMs;
  if (
    rawTimeout !== undefined &&
    (typeof rawTimeout !== "number" ||
      !Number.isInteger(rawTimeout) ||
      rawTimeout <= 0)
  ) {
    throw new Error("$.model.complete 的 timeoutMs 是正整数");
  }
  const timeoutMs =
    rawTimeout === undefined
      ? undefined
      : Math.min(rawTimeout, MOD_LIMITS.modModelMaxTimeoutMs);
  return {
    model: model.trim(),
    prompt,
    ...(system === undefined ? {} : { system }),
    maxTokens,
    // 超时就用一个自带的 signal 表达：与调用方取消走同一条路（provider 那边只
    // 需要看 signal 是否 abort），结果落在 `aborted` 那一档。
    ...(timeoutMs === undefined
      ? {}
      : { signal: AbortSignal.timeout(timeoutMs) }),
  };
}

/**
 * 校验 `$.settings.read` 的参数（spec「环境变量与设置（只读）」）。
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
  plugin: {
    name: string;
    /**
     * 这个插件自己的目录（绝对路径）—— `plugin.json` 所在的目录。
     *
     * 插件带的脚本、模板、数据文件按它解析：`$.fs` 的相对路径基准是会话当前
     * 工作目录（会随 `cd` 动），拿它去拼插件自己的文件必然拼错。
     */
    root: string;
  };
  ui: {
    /**
     * `ui.render` 的事件 → **这一端**可用的元素构造器表（spec「元素表按端分」）。
     *
     * 表按 `e.surface` 裁剪：桌面端 10 个，终端 9 个（没有 `Svg`）。所以返回类型
     * 是部分表 —— 照桌面端写的 `const { Svg } = $.ui.resolve(e)` 在终端里拿到
     * `undefined`，与 Claude Code 同一个行为。
     */
    resolve(
      event: unknown,
    ): Readonly<Partial<Record<ModElementType, ModElementBuilder>>>;
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
    panes(): Promise<string[]>;
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
     * 但不进模型上下文。`to` 两个落点：`"transcript"`（默认，对话流）与
     * `"debug"`（只进 `wave` 调试日志，用户看不见）。
     */
    log(text: string, options?: { to?: "transcript" | "debug" }): void;
    /**
     * 问用户一个问题（spec「问用户一个问题」）。
     *
     * resolve 成选中的那个标签，或用户在「其他」里打的自由文本 —— 所以要跟标签
     * 做**精确**比较。没人能答（没有界面、用户关掉了对话框）时 reject。
     */
    ask(question: string, options?: ModAskOptions): Promise<string>;
    /**
     * 贴在某个工具调用下面的一行（spec「工具行下面的一行」）。
     *
     * `text` 传 `undefined` 是撤掉那一行。tool_use_id 对不上当场报错：静默丢弃
     * 会让作者以为自己画上了。
     */
    notice(toolUseId: string, text: string | undefined): void;
    /**
     * 把文本写进剪贴板（spec「剪贴板与视图」）。
     *
     * 拿不到剪贴板（终端 CLI、用户拒绝）也走返回值、不 reject —— 失败是正常
     * 结果，插件据此换一种交付方式（与 `prompt.fill` 同一条纪律）。
     */
    copy(args: {
      text: string;
      surface?: ModRenderSurface;
    }): Promise<ModUiCopyResult>;
    /**
     * 把主视图切到某个子代理的转录（spec「剪贴板与视图」）。
     *
     * 一期一律答 `{ deny }`：还没有「在一个会话里切视角」的界面。
     */
    view(view: { agentId?: string }): Promise<ModUiViewResult>;
  };
  state: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  /**
   * 插件自己的持久化 KV（spec「`$`（一期）」的 `$.store` 行）。
   *
   * 四个方法都是异步的、值是任意 JSON —— 社区插件按 Claude Code 的契约写
   * `store.get(k).catch(…)` 与 `await store.set(k, {…})`。
   */
  store: {
    /** 读一个键；没有这个键（或文件读不出来）就是 `undefined`，不抛错。 */
    get(key: string): Promise<unknown>;
    /** 写一个键，返回的 Promise 落地才算写完（落盘走宿主的原子写）。 */
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
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
    /**
     * 沿目录链往上找同名的指令文件（spec「沿目录链找指令文件」）。
     *
     * 从 `of`（缺省是会话**当前**工作目录，与其余 `$.fs` 方法同一条口径）逐级
     * 往上，到 `below`（缺省是会话工作根 —— `cd` 不会把它带走）为止，收集
     * `names` 里任一个存在的文件，结果**根在前**。找不到给空数组、不抛错。
     */
    ancestors(request: {
      names: readonly string[];
      of?: string;
      below?: string;
    }): Promise<readonly ModFsAncestor[]>;
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
    /**
     * 读用户**此刻**打在输入框里的草稿（spec「输入框里现在有什么」）。
     *
     * `fill` 的反向操作：没有界面接手时给 `{ text: "", cursor: 0 }`，不 reject
     * —— 「现在没人画输入框」和「用户还没打字」对插件是同一个答案。
     */
    read(): Promise<ModPromptBox>;
    /**
     * 把这个建议摆成输入框里的暗色建议、Tab 采纳（spec「输入框里的建议与焦
     * 点」）。
     *
     * 与 `fill` 的区别是它只是「提议」：用户不按 Tab 就不进输入框。走同一条
     * `prompt.suggest` 事件链，`e.origin` 是 `{ kind: "plugin", name }`，别的
     * mod 据此分辨是谁提的。摆不上（输入框里已有字、一轮在跑、终端没有输入框）
     * 时答 `{ isShown: false }`，不 reject。
     */
    suggest(options: { text: string }): Promise<{ isShown: boolean }>;
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
    /**
     * 用户在这条会话里发过几轮话（spec「七个只读事实」）。
     *
     * 只数真实输入：工具结果、系统注入、`$.prompt.submit` 送进去的都算用户轮
     * （它们确实是用户侧发言），meta 消息不算。
     */
    turns(): Promise<number>;
    /**
     * 会话所在的 git 仓库（spec「七个只读事实」）。
     *
     * 不在仓库里给 `null`、不抛错 —— 社区写法就是 `(await $.session.repo())?.root`。
     * `root` 用会话工作根：进 worktree 该跟，`cd` 进子目录不该让插件以为换了仓库。
     */
    repo(): Promise<ModSessionRepo | null>;
    /** 引擎版本（spec「七个只读事实」）：`{ version }`，读不到给空串。 */
    version(): Promise<ModSessionVersion>;
    /**
     * 这条会话**已经存下**的消息，最新的在最后（spec「会话消息」）。
     *
     * 只读、且有硬上限：最多 `MOD_LIMITS.sessionMessages` 条、单条按
     * `sessionMessageChars` 截断。它和 `session.append` 的 `e.message` 同形，
     * 插件可以拿同一套渲染画「历史」和「正要存的那条」。
     */
    messages(): Promise<ModSessionMessage[]>;
  };
  /**
   * 收掉一轮（spec「收掉一轮」）。
   *
   * 与 `session` 那一片**故意**分开：`session` 全是只读快照，这一个会真的改动
   * 会话（打断正在跑的请求、停掉还没跑的工具）。只认 `turn.start` 给的 id。
   */
  turn: {
    /**
     * 把某一轮按中断处理（与用户按 Esc 同一条路）。
     *
     * `turnId` 对不上、或那条会话这一刻没有一轮在跑，一律 reject：静默成功会让
     * 插件以为自己叫停了。不动排队等待的用户消息，也不打断 Bash 命令与斜杠
     * 命令（它们不是这一轮的一部分）。
     */
    abort(options: { turnId: string }): Promise<void>;
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
  /**
   * 有哪些工具可调（spec「配了哪些、能调什么、有谁在跑」）。
   *
   * 只给名字、说明、是不是 MCP；工具自己的参数 schema 不给 —— 那是给模型看
   * 的，插件拿它没有用途。
   */
  tool: {
    list(): ModToolInfo[];
    /**
     * 把自己带来的一个工具交给模型（spec「把我们自己的工具交给模型」）。
     *
     * 规格里**没有 handler**：执行体是同一个 mod 的另一条 `tool.call` 钩子，它
     * 返回 `{ result }` 就是模型读到的结果。`name` 由 runtime 补成
     * `mcp__<plugin>__<name>`，于是这个工具与 MCP 工具走同一条审批路。
     */
    register(spec: ModToolRegisterSpec): Promise<{ name: string }>;
  };
  /**
   * 生效的配置项（spec「配了哪些、能调什么、有谁在跑」）。
   *
   * 只列标量（`boolean` / `string` / `number` / 字符串数组），嵌套对象整棵跳过：
   * 配置面板画不出树，`isLocked` 这种判断也只对标量有意义。
   */
  config: {
    list(): ModConfigRow[];
  };
  /**
   * 这条会话里跑过的子代理（spec「配了哪些、能调什么、有谁在跑」）。
   *
   * 只读、瞬时快照；状态是归一化后的五个值，没有「空闲」这个中间态。
   */
  agent: {
    list(): ModAgentInfo[];
    /**
     * 自己派一个子代理（spec「派子代理」）。
     *
     * resolve 在它 **started** 之后，不等它跑完：结果在它自己的 `turn.complete`
     * 里，`agentId` 是串起两边的那一个值。并发上限、深度、归属记账归宿主。
     */
    spawn(args: {
      prompt: string;
      description?: string;
      subagentType?: string;
      model?: string;
    }): Promise<{ model: string; agentId?: string }>;
  };
  /**
   * 让模型替插件答一次（spec「让模型替插件答一次」）。
   *
   * 唯一一条**刻意**不占 5 秒钩子预算的调用：一次请求通常 3–60 秒，塞进钩子预
   * 算等于废掉这个能力。超时由 `timeoutMs` 自己给。
   */
  model: {
    complete(request: {
      model: string;
      prompt: string;
      system?: string;
      maxTokens?: number;
      timeoutMs?: number;
    }): Promise<ModModelCompleteResult>;
  };
}

/** 沙箱需要宿主提供的全部能力。 */
export interface ModRuntimeHost {
  pluginName: string;
  /**
   * `$.plugin.root`：这个插件自己的目录（绝对路径）。
   *
   * 不是会话工作目录 —— 插件起自己的脚本、读自己的模板都该按这个拼。
   */
  pluginRoot: string;
  /**
   * 登记一块面板；返回「挂上了没有」（会话正在销毁时 false）。
   *
   * `focus` 是 `$.ui.open({ focus: true })` 的那一次要求：surface 收到推送里的
   * `focus: true` 就把键盘直接送进这块面板（spec「终端形态」）。之后的重绘不带。
   */
  openPane(paneId: string, title: string, focus?: boolean): boolean;
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
  /**
   * `$.store` 的读写（值已由 runtime 归一成 JSON 安全的东西、并过了体积上限）。
   *
   * 一个插件一份文件、跨会话；`get` 拿不到就是 `undefined`，文件坏了当空表
   * （与 `atom` 的「解析失败给初值」同一条口径）。
   */
  storeGet(key: string): unknown;
  storeSet(key: string, value: unknown): void;
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
  /**
   * `$.session.turns()`：用户已经发过几条 prompt。
   *
   * 数的是真实输入，不含工具结果与系统注入（spec「会话事实」）。
   */
  sessionTurns(): number;
  /** `$.session.repo()`：会话所在的 git 仓库；不在仓库里给 `null`。 */
  sessionRepo(): ModSessionRepo | null;
  /** `$.session.version()`：引擎版本、发布基线、构建时间。 */
  sessionVersion(): ModSessionVersion;
  /** `$.config.list()`：`/config` 菜单此刻会画的行（只列真有值的键）。 */
  listConfigRows(): ModConfigRow[];
  /** `$.tool.list()`：这一刻模型能调的工具，顺序就是模型看到的那份。 */
  listToolInfos(): ModToolInfo[];
  /** `$.agent.list()`：这条会话派过、还没被宿主丢掉的子代理。 */
  listAgentInfos(): ModAgentInfo[];
  /**
   * `$.tool.register`：把一个 mod 自己的工具挂进这一轮的工具清单（spec
   * 「把我们自己的工具交给模型」）。
   *
   * 名字已经由 runtime 归一成 `mcp__<plugin>__<name>`、限额也校验过了；重名判
   * 定、真正注册、卸载都在实现方（只有它知道当前注册了些什么）。
   */
  registerTool(spec: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }): Promise<{ name: string }>;
  /**
   * `$.agent.spawn`：派一个子代理，resolve 在它**started** 之后（spec「派子
   * 代理」）。
   *
   * 不等它跑完：结果在它自己的 `turn.complete` 里，`agentId` 是串起两边的那
   * 个值。并发上限、深度限制、归属记账都是实现方的事。
   */
  spawnAgent(args: {
    prompt: string;
    description?: string;
    subagentType?: string;
    model?: string;
  }): Promise<{ model: string; agentId?: string }>;
  /**
   * `$.model.complete`：让模型答一次（spec「让模型替插件答一次」）。
   *
   * provider 的失败是**结果**不是异常（`{ isAnswered: false, reason }`）；我们
   * 自己的门槛（模型不在 allowlist、额度用完）由实现方直接 reject —— 那两件事
   * 是「这次请求根本没发出去」，与 CC 的 `reason` 不是一回事。
   */
  completeModel(request: {
    model: string;
    prompt: string;
    system?: string;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<ModModelCompleteResult>;
  /**
   * `$.prompt.suggest`：把这个建议摆成输入框里的暗色建议（spec「输入框里的建
   * 议与焦点」）。
   *
   * 与 `$.prompt.fill` 同一条通道的第三种用法：没人画、没人答都按
   * `{ isShown: false }` 作答，**不 reject**（终端就是这一档）。
   */
  suggestPrompt(request: {
    text: string;
    plugin: string;
  }): Promise<{ isShown: boolean }>;
  /**
   * `$.session.messages()`：转录里已经存下的消息（最新在最后）。
   *
   * 宿主按 `MOD_LIMITS.sessionMessages` 截好再交下来 —— 限流放在这里而不是
   * runtime，是因为只有宿主知道哪些行不该递给插件（例如内部 meta 行）。
   */
  listSessionMessages(): ModSessionMessage[];
  /**
   * `$.prompt.read()`：surface 输入框里的草稿。
   *
   * 与 {@link fillPrompt} 同一条通道的另一头：没人答、没人画都按
   * `{ text: "", cursor: 0 }` 作答，**不 reject**（spec「输入框里现在有什么」）。
   */
  readPromptDraft(): Promise<ModPromptBox>;
  /**
   * `$.ui.notice`：在某个工具调用下面贴一行，`null` 撤掉（spec「工具行下面的一行」）。
   *
   * 只推不拉：宿主收不到（CLI 不画工具块）就丢弃，mod 那边照常成功。
   */
  showNotice(toolUseId: string, text: string | null): void;
  /**
   * `$.ui.copy()`：把文本写进某一端的剪贴板。
   *
   * 返回值是结果而不是抛错：`no-surface` / `no-clipboard` / `refused` 三种
   * 失败态都由实现方判（spec「剪贴板与视图」）。
   */
  copyText(request: {
    text: string;
    surface?: ModRenderSurface;
  }): Promise<ModUiCopyResult>;
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
  /**
   * `$.turn.abort`：收掉 `turnId` 那一轮。
   *
   * 宿主那边同步判「这个 id 对不对、有没有一轮在跑」，判不过就抛错 ——
   * runtime 不做二次判断，只把错误原样交给 mod。
   */
  turnAbort(turnId: string): void;
}

/**
 * 允许注册的钩子（spec「事件」）。
 *
 * `session.start` / `ui.render` 是「要 mod 做事」的那两个；`turn.complete`、
 * `turn.start`、`turn.step`、`session.measure`、`session.compact`、`session.end`、
 * `ui.close` 与 `classic.PermissionRequest` 之外的大部分 `classic.*` 是只读的
 * 观察事件，返回值一律丢弃。有返回值语义的六个：`tool.call` 答 `{ deny }` 或
 * `{ result }`（拦下这次调用 / 给出它的结果，`next(e)` 就是执行）、`prompt.
 * submit` 答
 * `{ context }`（本轮附加上下文，不改用户原文）、`command.run` 答 `{ text }`、
 * `classic.Stop` 答 `{ additionalContext }`（这一轮别急着收尾，把这几句读给
 * 模型听，spec「一轮收尾时的非错误反馈」）、`classic.PreToolUse` 答 `{ deny }`
 * （与 `tool.call` 是同一条链的另一个名字）。`classic.` 前缀是照 Claude Code
 * 的规矩：它把每个 settings hook 事件都镜像成 `classic.<Event>`，我们镜像其中
 * 20 个（spec「影子事件」），`e` 的形状也照那份 stdin JSON（`PreToolUse` 例外，
 * 照 CC 自己的排法给 `tool.call` 那个信封）。别的名字一律拒收，免得插件作者依
 * 赖一个不存在的钩子。
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
  "command.run",
  // A 档（spec「第二判定源」「系统提示词与附件」「给工具、技能、命令写描述」
  // 「转录写入前改写」）：都是「改写宿主算出来的东西」而不是「观察」。
  "tool.check",
  "tool.describe",
  "prompt.compose",
  "prompt.section",
  "prompt.context",
  "prompt.attachment",
  "session.append",
  "skill.prompt",
  "command.describe",
  // 第二判定源之外的三个「让插件做事」的落点（spec「把我们自己的工具交给模型」
  // 「派子代理」「输入框里的建议与焦点」）。
  "tool.register",
  "agent.offer",
  "agent.spawn",
  "prompt.edit",
  "prompt.suggest",
  "ui.focus",
  // 影子事件（spec「影子事件：`classic.*`」）：除 `PreToolUse` / `Stop` 外都是
  // 只读镜像，返回值忽略。
  "classic.PermissionRequest",
  "classic.SessionStart",
  "classic.SessionEnd",
  "classic.Stop",
  "classic.StopFailure",
  "classic.UserPromptSubmit",
  "classic.Notification",
  "classic.InstructionsLoaded",
  "classic.PostModelSwitch",
  "classic.SubagentStart",
  "classic.SubagentStop",
  "classic.PreToolUse",
  "classic.PostToolUse",
  "classic.PostToolUseFailure",
  "classic.PostToolBatch",
  "classic.PermissionDenied",
  "classic.CwdChanged",
  "classic.PreCompact",
  "classic.PostCompact",
  "classic.MessageDisplay",
]);

/**
 * 接受 matcher 的事件（其余事件带 matcher 一律拒收并 warn）。
 *
 * matcher 是**事件字段的子集**：`{ component: "Pane" }` 只吃 `component` 是
 * `Pane` 的那些渲染请求。社区 mod 用这几处把「一个事件、多个处理器」分开：
 * `ui.render` 按站点（`component` / `requestId`）、`tool.call` /
 * `classic.PreToolUse` 按工具名、`command.run` 按命令名、`classic.PostToolUse`
 * 族按 `tool_name`（这三条键就是 Claude Code 的 matcher 键表里对这个事件列的
 * 全部键）。
 */
const MATCHER_EVENTS = new Set([
  "command.run",
  "ui.render",
  // 这两条按 `{ tool }` 匹配（spec「第二判定源」「给工具、技能、命令写描述」）：
  // 一个只想管 `Bash` 的守卫没必要在每次 `Read` 上被叫起来。
  "tool.check",
  "tool.describe",
  // `prompt.section` 按 `{ name }` 匹配（spec「系统提示词与附件」）：只想管
  // 「记忆段」的插件没必要在每一段上被叫起来（lossless-claude 就是
  // `on("prompt.section", { name: "memory" }, …)`）。
  "prompt.section",
  // `prompt.attachment` 按 `{ type }`、`skill.prompt` 按 `{ skill }`：CC 的
  // 类型文档里给的示例就是 `on("prompt.attachment", { type: "todo_reminder" }, …)`
  // 与 `on("skill.prompt", { skill: "commit" }, …)`。
  "prompt.attachment",
  "skill.prompt",
  "classic.PreToolUse",
  "classic.PostToolUse",
  "classic.PostToolUseFailure",
  "classic.PostToolBatch",
  "tool.call",
  // `agent.offer` / `agent.spawn` 按子代理类型匹配（spec「派子代理」）：只想管
  // `Explore` 的插件没必要在每次派发上被叫起来。`ui.focus` 按 `{ component }`。
  "agent.offer",
  "agent.spawn",
  "ui.focus",
]);

/**
 * matcher 里用的字段名 → 事件的字段名。
 *
 * 社区按 Claude Code 的字段名写 matcher（`requestId` 是渲染请求的实例 id），
 * 我们的事件里那个字段叫 `instance_id`（与 CC 的 `ui_render` 消息同形）。
 */
const MATCHER_KEY_ALIASES: Record<string, string> = {
  // 只有 `requestId` 这一条：它是同一个字段在 CC 的两处不同名字（钩子事件
  // 叫 `requestId`、`ui_render` 消息叫 `instance_id`）。
  //
  // 事件之间**不做别名**：`agent.offer` 的字段是 `agent`、`agent.spawn` 的是
  // `subagentType`（CC 那两个事件各自的名字），一个 matcher 写哪把钥匙就只
  // 能开对应的那把锁 —— 给 `spawn` 补一条 `agent → subagentType` 会让同一份
  // matcher 在两个事件上表现不一致，那是 CC 面外的行为。
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

/**
 * matcher 里的一个字段值是否命中事件里的同一个字段。
 *
 * 三档，与 CC 的 matcher 同一套：`RegExp` 把事件值当字符串 `test`（社区 mod 写
 * `{ command: /git\s+commit/ }` 就是这个意思）；事件值是对象、matcher 里也给对象
 * 时按**对象偏匹配**递归比；其余按 `===`（`command` 两边归一后比，社区写的
 * matcher 不带斜杠）。
 *
 * `RegExp` 判定不能 `instanceof`：matcher 在 mod 的沙箱里造出来，那是另一个
 * realm 的构造函数。
 */
function matcherValueMatches(
  key: string,
  expected: unknown,
  actual: unknown,
): boolean {
  if (Object.prototype.toString.call(expected) === "[object RegExp]") {
    if (typeof actual !== "string") return false;
    const pattern = expected as RegExp;
    // 去掉 `g` / `y`：带这两个标志的 `test` 有 `lastIndex` 状态，同一条 matcher
    // 第二次命中就会被判假。
    return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")).test(
      actual,
    );
  }
  if (isPlainObject(expected)) {
    // 对象偏匹配：事件值是对象时只比 matcher 里写出来的那几个键，递归下去。
    return isPlainObject(actual) && matchesEvent(expected, actual);
  }
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
    // 事件自己有这个键就按字面用它 —— 别名只在事件缺这个键时兜底（同一字段
    // 的两个名字，不是两个事件之间的换算）。
    const key =
      rawKey in event ? rawKey : (MATCHER_KEY_ALIASES[rawKey] ?? rawKey);
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
 * `$.store.set` 落盘前的归一，与 Claude Code 逐条同口径：
 *
 * - `JSON.stringify` 抛错（环）→ 报错；
 * - 结果不是字符串（顶层 `undefined` / 函数 / symbol）→ 报错；
 * - 按**字符数**卡 4 MiB → 报错；
 * - 能过就 `JSON.parse` 回来当副本（存进去的是 JSON 值，不是字符串）。
 *
 * 对象属性里的函数 / symbol 会被 `JSON.stringify` **静默丢掉**，CC 就是这样，
 * 我们不加严：社区插件里 `set("x", { …带回调 })` 在 CC 上能跑，这里报错就变成
 * 「CC 能用的插件在我们这儿坏」。`undefined` 作为整体值则两边都拒。
 */
function storableJson(value: unknown, what: string): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${what} 的值不是 JSON：${errorMessage(error)}`);
  }
  if (typeof text !== "string") {
    throw new Error(
      `${what} 的值不是 JSON：${value === undefined ? "undefined" : typeof value}`,
    );
  }
  if (text.length > MOD_LIMITS.storeValueChars) {
    throw new Error(
      `${what} 的值有 ${text.length} 个字符，超过 ${MOD_LIMITS.storeValueChars}`,
    );
  }
  return JSON.parse(text) as unknown;
}

/** 键必须是非空字符串（Claude Code 对 `get` / `set` / `delete` 三条都这么查）。 */
function storeKeyArg(key: unknown, method: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`$.store.${method} 需要一个非空的字符串键`);
  }
  return key;
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
  /**
   * 正在跑的 `$.model.complete` 的**异步上下文**。
   *
   * 用它而不是一个计数器：同一个 handler 并发问两次（`Promise.all`）是两个
   * 平级调用，计数器的第二次会拿到「不许套娃」这种误导性错误；真正要拒的是
   * 「在上一次调用还没回来时、从它的回调里再问一次」——那正好是同一条异步
   * 上下文（spec「让模型替插件答一次」：一次调用只有一层）。
   */
  private readonly modelCallContext = new AsyncLocalStorage<true>();
  private readonly dollar: ModDollar;
  private readonly wave: unknown;
  /**
   * 元素表：`require` 与 JSX 用的是**并集**（两端名字都在），按端裁剪只发生在
   * `$.ui.resolve(e)`（见 {@link elementsBySurface}）。**每实例一份**（不是模块级
   * 常量），因为构造器要绑这个实例的 `h`（它记 handlers）。
   */
  private readonly elements: ModElementTable;
  /** 按端裁剪后的表：`$.ui.resolve(e)` 按 `e.surface` 取这一份。 */
  private readonly elementsBySurface: Readonly<Record<string, ModElementTable>>;
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

    /**
     * 元素表：`require("claude-code")` 与 JSX 拿到的是**并集**（两端名字都在，
     * 按端裁剪在 `$.ui.resolve(e)` 与校验）。
     */
    this.elements = elementTableOf(h, MOD_ELEMENT_TYPES);
    const elements = this.elements;
    const elementsBySurface: Record<string, ModElementTable> = {};
    for (const surface of SURFACES_WE_DRAW) {
      elementsBySurface[surface] = elementTableOf(
        h,
        MOD_SURFACE_ELEMENTS[surface as "desktop" | "terminal"],
      );
    }
    this.elementsBySurface = Object.freeze(elementsBySurface);

    this.wave = { h, Fragment: "Fragment", elements };

    this.dollar = {
      plugin: { name: host.pluginName, root: host.pluginRoot },
      ui: {
        resolve: (event: unknown) =>
          resolveElements(event, this.elementsBySurface),
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
          const registered = host.openPane(id, title, pane.focus === true);
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
        // 异步与 Claude Code 同形状：社区写法是 `await`/`.then`，同步数组
        // 会让 `.then` 当场报错。
        panes: async () => [...host.listPanes()],
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
          if (to !== undefined && to !== "transcript" && to !== "debug") {
            // 不静默当成 transcript：CC 的 `to` 还认别的落点，拼错一个值就安静
            // 写进对话流比报错更难查。
            throw new Error(
              `$.ui.log 的 to 只认 "transcript" 与 "debug"，拿到的是 ${JSON.stringify(to)}`,
            );
          }
          const line = normalizeStatus(text)?.trim() ?? null;
          if (line === null) {
            throw new Error("$.ui.log 需要一段文本");
          }
          // `to: "debug"` 是给 mod 作者自己排查的：只写 wave 的调试日志
          // （`LOG_LEVEL=DEBUG` 才看得见），对话流里一个字都不留。
          if (to === "debug") {
            logger.debug(`[mod:${host.pluginName}]`, line);
            return;
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
        // 贴在某个工具调用下面的一行（spec「工具行下面的一行」）：只推不拉，
        // 对不上 id 当场报错 —— 默默丢弃会让作者以为画上了。
        notice: (toolUseId, text) => {
          if (typeof toolUseId !== "string" || toolUseId.length === 0) {
            throw new Error("$.ui.notice 需要一个 tool_use_id");
          }
          if (text !== undefined && typeof text !== "string") {
            throw new Error("$.ui.notice 的 text 必须是字符串或者不写");
          }
          host.showNotice(toolUseId, text === undefined ? null : text);
        },
        // 剪贴板：哪一端接得住由宿主判，失败也走返回值不走抛错
        // （spec「剪贴板与视图」）。
        copy: (args) => {
          const request = args as
            | { text?: unknown; surface?: unknown }
            | undefined;
          const text = request?.text;
          if (typeof text !== "string") {
            throw new Error("$.ui.copy 需要一个 { text }");
          }
          if (text.length > MOD_LIMITS.copyTextChars) {
            throw new Error(
              `$.ui.copy 的 text 超过 ${MOD_LIMITS.copyTextChars} 个字符`,
            );
          }
          const surface = request?.surface;
          if (surface !== undefined && !isRenderSurface(surface)) {
            throw new Error(
              `$.ui.copy 的 surface 只允许 ${MOD_RENDER_SURFACES.join(" / ")}`,
            );
          }
          return this.withBudget(() => host.copyText({ text, surface }));
        },
        // 一期一律拒绝：还没有「在一个会话里切换看哪个 agent」的界面。形状
        // 先对上，能力后补 —— 与 `$.ui.panes()` 只回 id 数组同一条纪律。
        view: async (): Promise<ModUiViewResult> => ({
          deny: "还不能把主视图切到子代理的转录（这条会话没有多 agent 视图）",
        }),
      },
      state: {
        get: (key) => cloneValue(host.stateGet(key)),
        set: (key, value) => host.stateSet(key, cloneValue(value)),
      },
      // 插件自己的持久化 KV（spec「`$`（一期）」）：异步 + 任意 JSON，与
      // Claude Code 同名方法一致 —— 社区插件写的是 `store.get(k).catch(…)`，
      // 同步返回会让它当场 `TypeError: … reading 'catch'`；只收字符串则把
      // `set("last", { at, count })` 存成 `"[object Object]"`。
      store: {
        get: async (key) => cloneValue(host.storeGet(storeKeyArg(key, "get"))),
        set: async (key, value) => {
          // 值先校验、键后校验：CC 的实参求值就是这个顺序，报错先撞哪条一致。
          const stored = storableJson(value, "$.store.set");
          host.storeSet(storeKeyArg(key, "set"), stored);
        },
        delete: async (key) => host.storeDelete(storeKeyArg(key, "delete")),
        keys: async () => [...host.storeKeys()],
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
        // 沿目录链找指令文件（spec「沿目录链找指令文件」）；上界是会话工作根，
        // 不走到文件系统根。
        ancestors: (request) =>
          this.withBudget(() => this.ancestorFiles(request)),
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
        // 与 fill 同一条通道的另一头；没人画 / 没人答都按空输入框作答
        // （spec「输入框里现在有什么」）。
        read: () => this.withBudget(() => host.readPromptDraft()),
        // 把一个建议摆成输入框里的暗色建议（spec「输入框里的建议与焦点」）。
        // 与 `fill` 的区别是它只是「提议」：用户按 Tab 才采纳。事件链上
        // `e.origin` 是 `{ kind: "plugin", name }`，别的 mod 据此分辨是谁提的。
        suggest: (options) => {
          const text = options?.text;
          if (typeof text !== "string" || text.trim().length === 0) {
            throw new Error("$.prompt.suggest 需要非空的 text");
          }
          return this.withBudget(() =>
            host.suggestPrompt({ text, plugin: host.pluginName }),
          );
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
        // 用户轮数：只数真实输入，不含工具结果与系统注入。
        turns: async () => host.sessionTurns(),
        // 不在 git 仓库里给 null，不抛错（社区写法是 `?.root`）。
        repo: async () => cloneValue(host.sessionRepo()),
        version: async () => ({ ...host.sessionVersion() }),
        // 已经存下的消息（最新在最后）：宿主先按限额截好再交下来。
        messages: async () => cloneValue(host.listSessionMessages()),
      },
      turn: {
        abort: async (options) => {
          const turnId = options?.turnId;
          if (typeof turnId !== "string" || turnId.length === 0) {
            throw new Error("$.turn.abort 需要一个 { turnId }");
          }
          // 判据全在宿主（它才知道哪一轮在跑）；不匹配就 reject，别把「没找到」
          // 伪装成收掉了。
          host.turnAbort(turnId);
        },
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
      // 三个只读清单（spec「配了哪些、能调什么、有谁在跑」）：形状照 Claude
      // Code 的 ConfigRow / ToolInfo / AgentInfo，一次读取无副作用。
      tool: {
        list: () => cloneValue(host.listToolInfos()),
        // 写的一端：把自己带来的工具交给模型（spec「把我们自己的工具交给模
        // 型」）。名字与限额在这里归一，重名与真正注册归宿主。
        register: (spec) =>
          this.withBudget(() =>
            host.registerTool(normalizeToolRegisterSpec(spec, host.pluginName)),
          ),
      },
      config: {
        list: () => cloneValue(host.listConfigRows()),
      },
      agent: {
        list: () => cloneValue(host.listAgentInfos()),
        // 派子代理：resolve 在它 started 之后，不等它跑完（spec「派子代理」）。
        spawn: (args) =>
          this.withBudget(() => host.spawnAgent(normalizeAgentSpawnArgs(args))),
      },
      // 让模型替插件答一次（spec「让模型替插件答一次」）。这是唯一一条**刻意**
      // 不占 5 秒钩子预算的调用：`withBudget` 暂停预算，超时由调用方用
      // `timeoutMs` 自己给（与 CC 同一条：缺省不设）。
      model: {
        complete: (request) => {
          const normalized = normalizeCompleteRequest(request);
          // 一次调用只有一层：套娃既没有落点（结果回给谁）也没有额度意义。
          // 判据是「当前是否已经在这条调用里」，不是「有没有别的调用在飞」。
          if (this.modelCallContext.getStore()) {
            throw new Error(
              "$.model.complete 里不能再调 $.model.complete（一次调用只有一层）",
            );
          }
          return this.modelCallContext.run(true, () =>
            this.withBudget(() => host.completeModel(normalized)),
          );
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
    const exports = this.execute(this.entryPath);
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
    // `on("classic.*", handler)`：一次订阅全部 classic 事件（CC 支持，GenesisTools
    // 就是这么吃的）。展开成具体名字，**同一条 entry** 挂到每一个名字下 —— 这样
    // `on(…).catch(fn)` 的兜底对每一条都生效，而不是只兜住最后一个。
    const names =
      name === "classic.*"
        ? [...HOOK_NAMES].filter((item) => item.startsWith("classic."))
        : [name];
    const unknown = names.find((item) => !HOOK_NAMES.has(item));
    if (unknown !== undefined || names.length === 0) {
      logger.warn(
        `[Wave] ${this.host.pluginName} 注册了不存在的 mod 钩子：${name}（可用：${[...HOOK_NAMES].join(" / ")}）`,
      );
      return noop;
    }
    const noMatcher = names.find(
      (item) => hasMatcher && !MATCHER_EVENTS.has(item),
    );
    if (noMatcher !== undefined) {
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
    for (const hooked of names) {
      const bucket = this.hooks.get(hooked);
      if (bucket) bucket.push(entry);
      else this.hooks.set(hooked, [entry]);
    }
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
   *
   * 生成器事件（Claude Code 的 `turn.step` / `process.spawn`）里 handler 是
   * `async function*`：见 {@link runChainStream}。
   */
  private async runChain(
    name: string,
    entries: HookEntry[],
    start: number,
    event: unknown,
    engine: (finalEvent: unknown) => unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    return drainHookStream(
      this.runChainStream(name, entries, start, event, engine, signal),
    );
  }

  /**
   * 同一条链的流形态：handler 中途 `yield` 出来的块交给调用方，`return` 的
   * 值才是这次调用的结果。
   *
   * 普通钩子（绝大多数）没有任何 `yield`，`runChain` 把流驱动到底就是原来那次
   * `await`。生成器钩子（Claude Code 的 `turn.step`、`process.spawn`）在 CC 里
   * 是**唯一的两种**「链上每个 mod 都能产出、也能改写」的形状：mod 写
   * `yield* next(e)` 把下游那条流原样接上来，`next` 的返回值既是「下游最终定成
   * 什么」也是「下游中途产出了什么」。宿主用 `gen.next()` 循环驱动（见
   * `ModManager.dispatchTurnStep`），所以 `next()` 返回的东西必须同时是
   * thenable（`await next(e)`）与 async iterable（`yield* next(e)`）。
   */
  private async *runChainStream(
    name: string,
    entries: HookEntry[],
    start: number,
    event: unknown,
    engine: (finalEvent: unknown) => unknown,
    signal: AbortSignal,
  ): AsyncGenerator<unknown, unknown> {
    for (let index = start; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (!matchesEvent(entry.matcher, event)) continue;
      let nextCalled = false;
      /** 已经交给下层的那次调用的结果（`.catch` 里的重放要用）。 */
      let nextResult: HookStream | undefined;
      const callNext = (nextEvent?: unknown) => {
        nextResult = new HookStream(
          this.runChainStream(
            name,
            entries,
            index + 1,
            nextEvent === undefined ? event : nextEvent,
            engine,
            signal,
          ),
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
        const outcome = await this.invokeInContext<unknown>(
          entry.handler,
          undefined,
          // 我们的形状也拿到 `next`（第二个实参）：没有它，按推荐写法写的守卫
          // 只能看见调用、看不见结果。老 mod 少写一个形参不受影响。
          entry.isCommunity ? [this.dollar, event, next] : [event, next],
          `${name} 的处理函数`,
          `${this.host.pluginName}:${name}`,
        );
        return yield* asHookStream(outcome);
      } catch (error) {
        if (!entry.onError) throw error;
        if (!entry.isCommunityError) {
          return yield* asHookStream(
            await this.invokeInContext<unknown>(
              entry.onError,
              undefined,
              [error],
              `${name} 的 catch`,
              `${this.host.pluginName}:${name}`,
            ),
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
        return yield* asHookStream(
          await this.invokeInContext<unknown>(
            entry.onError,
            undefined,
            [this.dollar, event, caught],
            `${name} 的 catch`,
            `${this.host.pluginName}:${name}`,
          ),
        );
      }
    }
    // 引擎帧按**走到这里的那份事件**算：`next({ ...e, context })` 改过的内容
    // 必须在链尾出现，否则注入静默失效。
    return await engine(event);
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
   * `tool.call` 的链是**跨 mod** 的（`ModManager` 逐个 mod 往下走），走到一个
   * 压根没注册的 mod 时要能跳过它而不是把它的「空结果」当成决议。
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
   * `options.engine` 换掉「链尾」—— `tool.call` 的链尾不是空对象，而是「交给
   * 下一个 mod」与「真正执行这次调用」（见 `ModManager`）。
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
   * `$.fs.ancestors`：沿目录链向上找 `names` 里的文件（spec「沿目录链找指令文件」）。
   *
   * 相对路径按会话**当前**工作目录解析（与 `$.fs` 其余方法同一个基准），上界是
   * **会话工作根** —— 那个值 `cd` 不动。拿「会动」的那个当上界的话，`cd` 进子
   * 目录之后「一路往上找到项目根」就变成「往上找到刚才那个目录」。
   */
  private async ancestorFiles(request: unknown): Promise<ModFsAncestor[]> {
    const { names, of, below } = normalizeAncestorRequest(request);
    const base = path.resolve(this.host.workdir());
    const startDir = path.resolve(base, of ?? ".");
    const limit = path.resolve(base, below ?? this.host.workspaceRoot());
    if (!isWithinPath(startDir, limit)) {
      throw new Error(`$.fs.ancestors 的起点 ${startDir} 不在 ${limit} 之内`);
    }

    // 近 → 远收集，最后翻成「根在前」（与 Claude Code 同一个顺序）。
    const nearToFar: ModFsAncestor[] = [];
    let total = 0;
    let stopped = false;
    let dir = startDir;
    while (!stopped) {
      for (const name of names) {
        const file = path.join(dir, name);
        let content: string;
        try {
          if (!(await this.fileApi().exists(file))) continue;
          const text = await this.fileApi().read(file);
          if (typeof text !== "string") continue;
          content = text;
        } catch (error) {
          // 读不动（权限、是个目录、超过单文件上限）就跳过这一份：整条祖先链
          // 不该因为一个不可读的父目录失败。至于「为什么没找到」，日志里有。
          logger.debug(`[mods] $.fs.ancestors 跳过 ${file}`, error);
          continue;
        }
        if (
          total + Buffer.byteLength(content, "utf8") >
            MOD_LIMITS.ancestorBytes ||
          nearToFar.length >= MOD_LIMITS.ancestorFiles
        ) {
          // 到上限就停：再往上的都离会话更远，截掉它们比截掉近的那几份好。
          stopped = true;
          break;
        }
        total += Buffer.byteLength(content, "utf8");
        nearToFar.push({
          dir,
          name,
          content,
          parts: [{ path: file, content }],
        });
      }
      if (stopped || dir === limit) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return nearToFar.reverse();
  }

  /**
   * 执行一个已编译文件，返回它的 `module.exports`。
   *
   * `require` 只接受相对路径与 `wave-agent-sdk/mods` —— 后者返回元素构造器
   * 表。其余裸包名直接抛错（spec「加载纪律」）。相对路径只在本 mod 已编译的
   * 文件集合里找，解析不出插件目录（文件本身在加载前已经过 realpath 校验）。
   */
  private execute(filePath: string): unknown {
    const resolved = path.resolve(filePath);
    // 环形 import 按 CJS 语义解：已经在执行中的文件先给出它**半成品**的
    // `module.exports`（`execute` 在递归之前就把它放进了缓存），Node / Bun 都是
    // 这么处理的。社区的多文件 mod 里 `ledger → history → ledger` 这种真环很常见，
    // 当场报错会把整个插件的所有面板一起废掉。
    const cached = this.modules.get(resolved);
    if (cached) return cached.exports;
    const code = this.sources.get(resolved);
    if (code === undefined) {
      throw new Error(`mod 文件未编译：${resolved}`);
    }
    const module = { exports: {} as Record<string, unknown> };
    this.modules.set(resolved, module);

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
          return this.execute(candidate);
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
    }
    return module.exports;
  }
}

/**
 * `./a` 的候选：原样、`.tsx`、`.ts`、`.jsx`、`.js`、`/index.*`。
 *
 * 还有 TS 的 ESM 写法：源码里 `import "./x.js"`、磁盘上只有 `x.ts` —— 与
 * `pluginLoader.ts` 的 `resolveImportFile` 同一张表（那边决定收进编译集的是
 * 哪些文件，两张表不一致就会「收进来了却 require 不到」）。
 */
function moduleCandidates(target: string): string[] {
  const ext = path.extname(target).toLowerCase();
  const withoutExt = target.slice(0, target.length - ext.length);
  const sourceVariants =
    ext === ".js"
      ? [`${withoutExt}.ts`, `${withoutExt}.tsx`]
      : ext === ".jsx"
        ? [`${withoutExt}.tsx`]
        : [];
  return [
    target,
    ...sourceVariants,
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

/**
 * `next(e)` 的返回值：既能 `await`（拿链的最终值），也能 `yield*`（把下游中途
 * `yield` 出来的块接上来）。
 *
 * Claude Code 的生成器事件（`turn.step` / `process.spawn`）两种写法都出现在社区
 * mod 里：只要结果的 mod 写 `return await next(e)`，要转发的 mod 写
 * `yield* next(e)`。因为 `next()` 一被调用就开始跑，这里不能在构造时选形态 ——
 * 由调用方先决定怎么消费它（`await` 走 `then`，`yield*` 走迭代器），另一条路
 * 到时就废了（一次 handler 只能调一次 `next`，本来也不会有第二次）。
 */
class HookStream implements PromiseLike<unknown>, AsyncIterable<unknown> {
  private settled: Promise<unknown> | undefined;

  constructor(private readonly stream: AsyncGenerator<unknown, unknown>) {}

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.stream;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.settled ??= drainHookStream(this.stream);
    return this.settled.then(onfulfilled, onrejected);
  }
}

/** 驱动一条链流到底，丢掉中途产出的块，只要最终值。 */
async function drainHookStream(
  stream: AsyncGenerator<unknown, unknown>,
): Promise<unknown> {
  let step = await stream.next();
  while (step.done !== true) step = await stream.next();
  return step.value;
}

/**
 * handler 的返回值 → 一条链流。
 *
 * 普通返回值（绝大多数钩子）就是「一次都没 `yield`、终值等于它」的流；
 * `async function*` 是生成器事件的形状：它中途 `yield` 出来的块交给调用方，
 * `return` 的值才是这次钩子的结果。
 */
async function* asHookStream(
  outcome: unknown,
): AsyncGenerator<unknown, unknown> {
  if (!isAsyncIterable(outcome)) return outcome;
  const iterator = outcome[Symbol.asyncIterator]();
  for (;;) {
    const step = await iterator.next();
    if (step.done === true) return step.value;
    yield step.value;
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}
