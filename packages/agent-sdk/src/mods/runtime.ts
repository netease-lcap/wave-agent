import * as vm from "node:vm";
import * as path from "node:path";
import type { ModElementType, ModTreeNode } from "../types/mods.js";
import { MOD_LIMITS } from "../types/mods.js";
import { Box, Text, Button, Input, Link, Code, Markdown } from "./index.js";
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
const ELEMENT_CONSTRUCTORS = [Box, Text, Button, Input, Link, Code, Markdown];

const elements = Object.fromEntries(
  ELEMENT_CONSTRUCTORS.map((name) => [String(name), String(name)]),
) as Record<ModElementType, ModElementType>;

/** 定时器句柄：`cancel()` 可重复调用。 */
export interface ModTimerHandle {
  cancel(): void;
}

/** 事件钩子能拿到的 `$`（见 spec「$（一期）」）。 */
export interface ModDollar {
  plugin: { name: string; root: string };
  ui: {
    resolve(event: unknown): unknown;
    open(pane: { id: string; title: string }): void;
    close(id: string): void;
    panes(): string[];
    invalidate(id: string): void;
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
   * 定时器（spec「定时器」）。
   *
   * 沙箱里没有 `setTimeout`/`setInterval`：定时器登记在宿主上，会话销毁或插件
   * 重载时才撤销得掉 —— 裸定时器会留在进程里继续跑，然后打到已经销毁的会话上。
   */
  clock: {
    now(): number;
    after(ms: number, fn: () => unknown): ModTimerHandle;
    every(ms: number, fn: () => unknown): ModTimerHandle;
  };
}

/** 沙箱需要宿主提供的全部能力。 */
export interface ModRuntimeHost {
  pluginName: string;
  pluginRoot: string;
  openPane(paneId: string, title: string): void;
  closePane(paneId: string): void;
  listPanes(): string[];
  invalidate(paneId: string): void;
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
}

/**
 * 一期允许注册的钩子（spec「事件」）。
 *
 * 只有这两个：Claude Code 有 `session.start` / `ui.render` 等同一个集合，但
 * **没有**「面板被关掉」事件 —— 面板的关闭、插件重载、会话销毁都由宿主内部
 * 清理，不通知 mod。别的名字一律拒收，免得插件作者依赖一个不存在的钩子。
 */
const HOOK_NAMES = new Set(["session.start", "ui.render"]);

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
const CALLBACK_PROPS = new Set(["onPress", "onSubmit"]);

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
  private readonly dollar: ModDollar;
  private readonly wave: unknown;

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
      const kept: Record<string, string | number | boolean | null> = {};
      for (const [name, value] of Object.entries(rawProps)) {
        if (CALLBACK_PROPS.has(name)) {
          const callback = value as (input?: string) => unknown;
          if (key && typeof callback === "function") {
            this.handlers.set(`${String(type)}:${key}`, callback);
          }
          continue;
        }
        if (value === undefined) continue;
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
      plugin: { name: host.pluginName, root: host.pluginRoot },
      ui: {
        resolve: (event) => event,
        open: (pane) => host.openPane(pane.id, pane.title),
        close: (id) => host.closePane(id),
        panes: () => [...host.listPanes()],
        invalidate: (id) => host.invalidate(id),
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
      },
    };

    this.context = vm.createContext(
      {
        __wave: this.wave,
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
      (name: unknown, handler: unknown) => {
        if (typeof name !== "string" || typeof handler !== "function") return;
        if (!HOOK_NAMES.has(name)) {
          logger.warn(
            `[Wave] ${this.host.pluginName} 注册了不存在的 mod 钩子：${name}（一期只有 session.start / ui.render）`,
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
      const value = await withTimeout(
        Promise.resolve().then(() => handler(event)),
        MOD_LIMITS.hookTimeoutMs,
        `${name} 钩子超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
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
   * 派发一个 UI 交互到它注册时挂上的回调。
   *
   * 返回 `false` 表示没有对应处理器（元素没写 `key`，或 mod 重画后 key 变了），
   * 宿主据此决定要不要提示。
   */
  async dispatch(
    kind: "press" | "input",
    key: string,
    value?: string,
  ): Promise<boolean> {
    // 按交互种类取对应元素的处理表：同一个 pane 里 Button 与 Input 撞 key 是
    // 允许的（key 只要在自己的元素类型里唯一），所以不能跨类型兜底查找。
    const type = kind === "input" ? "Input" : "Button";
    const handler = this.handlers.get(`${type}:${key}`);
    if (!handler) return false;
    await withTimeout(
      Promise.resolve().then(() =>
        handler(kind === "input" ? value : undefined),
      ),
      MOD_LIMITS.hookTimeoutMs,
      `${kind} 处理超过 ${MOD_LIMITS.hookTimeoutMs}ms`,
    );
    return true;
  }

  /** 该 mod 注册了哪些钩子（诊断用）。 */
  hookNames(): string[] {
    return [...this.hooks.keys()];
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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
