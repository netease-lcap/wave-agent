import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileMods } from "../../src/mods/compile.js";
import {
  ModRuntime,
  type CompiledModule,
  type ModRuntimeHost,
} from "../../src/mods/runtime.js";
import {
  MOD_LIMITS,
  type ModCommandSpec,
  type ModProcessChunk,
  type ModProcessExit,
  type ModRunResult,
  type ModTreeNode,
} from "../../src/types/mods.js";
import { getEsbuild } from "../../src/utils/esbuild.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * `$.fs` 的真实实现在 `files.test.ts` 里测；这一层只关心「转发到 ModFs」和
 * 「相对路径的基准是谁」，所以换成一个记录调用的替身。
 */
const fsStub = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  cwd: undefined as (() => string) | undefined,
}));

vi.mock("../../src/mods/files.js", () => {
  const record = (method: string, args: unknown[], value: unknown) => {
    fsStub.calls.push({ method, args });
    return Promise.resolve(value);
  };
  return {
    ModFs: class {
      constructor(cwd: () => string) {
        fsStub.cwd = cwd;
      }
      read(...args: unknown[]) {
        return record("read", args, { text: "hi", isTruncated: false });
      }
      write(...args: unknown[]) {
        return record("write", args, undefined);
      }
      list(...args: unknown[]) {
        return record("list", args, []);
      }
      stat(...args: unknown[]) {
        return record("stat", args, { kind: "file", size: 2, isLink: false });
      }
      exists(...args: unknown[]) {
        return record("exists", args, true);
      }
    },
  };
});

beforeEach(() => {
  fsStub.calls.length = 0;
  fsStub.cwd = undefined;
});

/**
 * 沙箱执行的是 esbuild 产出的 CJS，所以这里的「编译产物」直接手写 —— 真转译
 * 由 `compile.test.ts` 覆盖，这一层只测执行/隔离/事件路由。
 */

const ROOT = path.resolve("/fake/plugin");
const ENTRY = path.join(ROOT, "mods", "panel.tsx");

function host(overrides: Partial<ModRuntimeHost> = {}): ModRuntimeHost {
  return {
    pluginName: "todo",
    openPane: vi.fn(),
    closePane: vi.fn(),
    listPanes: vi.fn(() => []),
    invalidate: vi.fn(),
    setStatus: vi.fn(),
    showToast: vi.fn(),
    stateGet: vi.fn(() => undefined),
    stateSet: vi.fn(),
    storeGet: vi.fn(() => undefined),
    storeSet: vi.fn(),
    storeDelete: vi.fn(),
    storeKeys: vi.fn(() => []),
    startTimer: vi.fn(() => ({ cancel: vi.fn() })),
    // 默认宿主不真起进程：一条立刻结束的空流。
    spawnProcess: vi.fn(async function* (): AsyncGenerator<
      ModProcessChunk,
      ModProcessExit
    > {
      yield* [] as ModProcessChunk[];
      return { code: 0, signal: null };
    }),
    runProcess: vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    })),
    workdir: vi.fn(() => path.resolve("/fake/project")),
    submitPrompt: vi.fn(async () => {}),
    // 默认宿主能填草稿：具体落点（replace/append/insert）由 webview 决定，
    // 这一层只关心 `$` 把参数原样交下来、把布尔值原样包成 `{ isFilled }`。
    fillPrompt: vi.fn(async () => true),
    sessionUsage: vi.fn(() => ({
      startedAt: 1_700_000_000_000,
      context: { tokens: 0, window: 200_000, percent: 0 },
      tokens: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
      rateLimits: [],
    })),
    appendLog: vi.fn(),
    // `$` 上的只读事实（spec「会话事实」「环境变量与设置」）：默认给一份能用的
    // 值，具体断言在各用例里用 `mockReturnValue` 覆盖。
    sessionId: vi.fn(() => "session-1"),
    workspaceRoot: vi.fn(() => path.resolve("/fake/project")),
    model: vi.fn(() => "test-model"),
    envGet: vi.fn((): string | undefined => undefined),
    settingsRead: vi.fn(async () => ({})),
    sleep: vi.fn(async () => {}),
    registerCommand: vi.fn((spec: ModCommandSpec) => ({ command: spec.name })),
    listCommands: vi.fn(() => []),
    runCommand: vi.fn(async () => {}),
    ...overrides,
  };
}

function runtime(
  code: string,
  options: {
    host?: ModRuntimeHost;
    extra?: CompiledModule[];
    modOptions?: Record<string, unknown>;
  } = {},
): { mod: ModRuntime; host: ModRuntimeHost } {
  const hostApi = options.host ?? host();
  const compiled: CompiledModule[] = [
    { path: ENTRY, code },
    ...(options.extra ?? []),
  ];
  return {
    mod: new ModRuntime(hostApi, ENTRY, compiled, options.modOptions ?? {}),
    host: hostApi,
  };
}

/** 注册一个 `ui.render` 钩子，返回 `__wave.h("Text", null, "hi")`。 */
const RENDER_HI = `
exports.register = function ($, on) {
  on("ui.render", function () {
    return __wave.h("Text", null, "hi");
  });
};
`;

afterEach(() => {
  vi.useRealTimers();
});

describe("ModRuntime.load", () => {
  it("执行入口并把 register 注册的钩子收集起来", async () => {
    const { mod } = runtime(RENDER_HI);

    await expect(mod.load()).resolves.toBe(true);
    expect(mod.hookNames()).toEqual(["ui.render"]);

    const result = await mod.callHook("ui.render", { component: "Pane" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        type: "Text",
        props: {},
        children: ["hi"],
      });
    }
  });

  it("没有 register 的文件当作共享模块，返回 false", async () => {
    const { mod } = runtime(`exports.helper = 1;`);

    await expect(mod.load()).resolves.toBe(false);
    expect(mod.hookNames()).toEqual([]);
  });

  it("register 返回 Promise 时等它结算（async register 里注册的钩子也在）", async () => {
    const { mod } = runtime(`
      exports.register = async function ($, on) {
        await Promise.resolve();
        on("ui.render", function () {
          return __wave.h("Text", null, "late");
        });
      };
    `);

    await mod.load();
    expect(mod.hookNames()).toEqual(["ui.render"]);
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toMatchObject({ children: ["late"] });
  });
});

describe("ModRuntime 的 require", () => {
  it("解析相对路径（带/不带扩展名、目录 index）", async () => {
    const shared = path.join(ROOT, "mods", "shared.ts");
    const index = path.join(ROOT, "mods", "lib", "index.ts");
    const { mod } = runtime(
      `
      var a = require("./shared");
      var b = require("./lib");
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Text", null, a.label + "/" + b.label);
        });
      };
      `,
      {
        extra: [
          { path: shared, code: `exports.label = "S";` },
          { path: index, code: `exports.label = "I";` },
        ],
      },
    );

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toMatchObject({ children: ["S/I"] });
  });

  it("wave-agent-sdk/mods 给出元素构造器", async () => {
    const { mod } = runtime(`
      var ui = require("wave-agent-sdk/mods");
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h(ui.Box, null, __wave.h(ui.Text, null, "x"));
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toMatchObject({
      type: "Box",
      children: [{ type: "Text", props: {}, children: ["x"] }],
    });
  });

  it("wave-agent-sdk/mods 的元素表与 ModElementType 一一对应", async () => {
    // 沙箱给的构造器来自 `src/mods/index.ts`（插件作者的书写面）。它漏一个或
    // 多一个，编译产物里的 tag 就会变成渲染器不认识的元素 —— 这里钉住名单。
    // 同一份模块还导出 `atom` / `read` / `update` 三个助手（不是元素），排除掉
    // 再看元素表。
    const { mod } = runtime(`
      var ui = require("wave-agent-sdk/mods");
      var HELPERS = ["atom", "read", "update"];
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h(ui.Box, null, Object.keys(ui).filter(function (name) {
            return HELPERS.indexOf(name) === -1;
          }).sort().join(","));
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toMatchObject({
      children: [
        "Box,Button,Code,Fragment,Input,Link,Markdown,Progress,Select,Svg,Text",
      ],
    });
  });

  it.each([
    ["react", "只能 import 相对路径"],
    ["node:fs", "只能 import 相对路径"],
  ])("拒绝裸包名 %s", async (specifier, expected) => {
    const { mod } = runtime(`
      require("${specifier}");
      exports.register = function () {};
    `);

    await expect(mod.load()).rejects.toThrow(expected);
  });

  it("找不到目标文件时报出确切文件", async () => {
    const { mod } = runtime(`
      require("./missing");
      exports.register = function () {};
    `);

    await expect(mod.load()).rejects.toThrow("mod 找不到模块：./missing");
  });

  it("循环 import 被拦下", async () => {
    const a = path.join(ROOT, "mods", "a.ts");
    const b = path.join(ROOT, "mods", "b.ts");
    const { mod } = runtime(
      `require("./a"); exports.register = function () {};`,
      {
        extra: [
          { path: a, code: `exports.a = require("./b");` },
          { path: b, code: `exports.b = require("./a");` },
        ],
      },
    );

    await expect(mod.load()).rejects.toThrow("import 出现循环");
  });
});

describe("ModRuntime 的隔离", () => {
  it("沙箱里没有 process / Buffer / require 之外的 node 能力", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          return [
            typeof process,
            typeof Buffer,
            typeof globalThis.require,
            typeof __dirname,
          ].join(",");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toBe(
      "undefined,undefined,undefined,undefined",
    );
  });

  it("eval / new Function 被 codeGeneration 开关挡住", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          return eval("1 + 1");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/code generation/i);
  });

  it("未知钩子名被拒绝而不是静默登记", async () => {
    // 钩子名单是白名单（spec「事件」）：Claude Code 有、我们没有的事件名不该
    // 悄悄生效，否则插件作者会以为那条路径通了。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.destroy", function () {});
        on("session.start", function () { return "ok"; });
      };
    `);

    await mod.load();
    expect(mod.hookNames()).toEqual(["session.start"]);
  });

  it("三个只读的观察事件可以注册", async () => {
    // spec「完成与审批的观察」「工具跑完之后」：它们只报告事实，宿主丢弃返回值。
    // 审批那个用 Claude Code 的 `classic.<Event>` 名字；`tool.call` 拦不下调用。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("turn.complete", function (e) { return "done:" + e.isAborted; });
        on("classic.PermissionRequest", function (e) { return e.tool_name; });
        on("tool.call", function (e) { return e.tool; });
      };
    `);

    await mod.load();
    expect(mod.hookNames()).toEqual([
      "turn.complete",
      "classic.PermissionRequest",
      "tool.call",
    ]);
    await expect(
      mod.callHook("turn.complete", { isAborted: true, durationMs: 1 }),
    ).resolves.toMatchObject({ ok: true, value: "done:true" });
    await expect(
      mod.callHook("tool.call", { tool: "Bash", input: { command: "ls" } }),
    ).resolves.toMatchObject({ ok: true, value: "Bash" });
  });
});

describe("ModRuntime 的交互路由", () => {
  it("h() 把回调摘出树，只留可序列化的 prop", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Button", {
            key: "go",
            label: "Go",
            disabled: false,
            onPress: function () { $.ui.invalidate("ui.render"); },
          });
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toEqual({
      type: "Button",
      props: { key: "go", label: "Go", disabled: false },
      children: [],
    });

    const pressed = await mod.dispatch("press", "go");
    expect(pressed).toBe(true);
  });

  it("h() 把 hover 提到节点字段，不留在 props 里", async () => {
    // `hover` 的值是对象，props 只收原始值；CC 那边它也是节点的同级字段
    // （`{ type, props, hover }`），所以这里不能走「非原始值一律丢」那条路。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Box", { key: "row", hover: { backgroundColor: "success" } },
            __wave.h("Text", null, "hi"));
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toEqual({
      type: "Box",
      props: { key: "row" },
      hover: { backgroundColor: "success" },
      children: [{ type: "Text", props: {}, children: ["hi"] }],
    });
  });

  it("h() 丢掉传不出去的对象 prop 时留一条 warn", async () => {
    const { logger } = await import("../../src/utils/globalLogger.js");
    const warn = vi.mocked(logger.warn);
    warn.mockClear();
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Text", { key: "t1", style: { color: "red" } }, "hi");
        });
      };
    `);

    await mod.load();
    await mod.callHook("ui.render", {});

    // 静默丢弃时作者只看到「写了没效果」，连去哪查都不知道。
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("上有个 prop 传不出去：style"),
    );
  });

  it("$.ui.invalidate 只认 ui.render，别的目标当场报错", async () => {
    // 参数是**渲染站点的生产者**，不是面板 id：面板用 `$.ui.open({ id })` 指定。
    // 老写法 `$.ui.invalidate("p1")` 在 Claude Code 里也是错的，这里不静默接受。
    const { host: hostApi, mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.invalidate("p1");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("ui.render");
    expect(hostApi.invalidate).not.toHaveBeenCalled();
  });

  it("Button 与 Input 撞 key 时按交互种类各自路由", async () => {
    const { host: hostApi, mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Box", null,
            __wave.h("Button", { key: "same", onPress: function () { $.ui.open({ id: "press", title: "" }); } }),
            __wave.h("Input", { key: "same", onSubmit: function (v) { $.ui.open({ id: v, title: "" }); } })
          );
        });
      };
    `);

    await mod.load();
    await mod.callHook("ui.render", {});

    await mod.dispatch("press", "same");
    await mod.dispatch("input", "same", "typed");

    expect(hostApi.openPane).toHaveBeenNthCalledWith(1, "press", "");
    expect(hostApi.openPane).toHaveBeenNthCalledWith(2, "typed", "");
  });

  it("Select 的 options 是对象数组，照样搬进树里", async () => {
    // `h()` 对 prop 的默认纪律是「非原始值一律丢」——`options` 是唯一的例外，
    // 丢了它下拉就是空的（spec「元素」里 `Select` 那一行）。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Select", {
            key: "s1",
            value: "b",
            options: [{ value: "a", label: "A" }, { value: "b" }],
            onSelect: function () { $.ui.invalidate("ui.render"); },
          });
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toEqual({
      type: "Select",
      props: {
        key: "s1",
        value: "b",
        options: [{ value: "a", label: "A" }, { value: "b" }],
      },
      children: [],
    });
  });

  it("options 形状不对时整条丢掉，交给校验器报错", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Select", { key: "s1", options: ["a", 1] });
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toMatchObject({
      props: { key: "s1" },
    });
  });

  it("select 事件把选中的值交给 onSelect", async () => {
    const { host: hostApi, mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Select", {
            key: "s1",
            options: [{ value: "a" }, { value: "b" }],
            onSelect: function () { $.ui.invalidate("ui.render"); },
          });
        });
      };
    `);

    await mod.load();
    await mod.callHook("ui.render", {});

    await expect(mod.dispatch("select", "s1", "b")).resolves.toBe(true);
    // `invalidate` 只认 "ui.render"（一次调用作用到这个 mod 的所有站点）。
    expect(hostApi.invalidate).toHaveBeenCalledWith("ui.render");
  });

  it("没有对应处理器时返回 false（元素没写 key / key 变了）", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Button", { key: "go", onPress: function () {} });
        });
      };
    `);

    await mod.load();
    await mod.callHook("ui.render", {});

    await expect(mod.dispatch("press", "nope")).resolves.toBe(false);
    await expect(mod.dispatch("input", "go")).resolves.toBe(false);
  });

  it("钩子抛错时返回错误摘要而不是冒泡", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () { throw new Error("boom"); });
      };
    `);

    await mod.load();
    await expect(mod.callHook("ui.render", {})).resolves.toMatchObject({
      ok: false,
      error: "boom",
    });
  });

  it("钩子超过时限时按失败处理", async () => {
    vi.useFakeTimers();
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () { return new Promise(function () {}); });
      };
    `);

    await mod.load();
    const pending = mod.callHook("ui.render", {});
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.hookTimeoutMs + 1);

    await expect(pending).resolves.toMatchObject({ ok: false });
    const settled = await pending;
    if (!settled.ok) {
      expect(settled.error).toContain(`${MOD_LIMITS.hookTimeoutMs}ms`);
    }
  });
});

describe("ModRuntime 的 $ 命名空间", () => {
  it("ui / state / store 全部转发到宿主，值跨 realm 拷贝", async () => {
    const state = new Map<string, unknown>([["count", { n: 1 }]]);
    const store = new Map<string, string>();
    const hostApi = host({
      stateGet: (key) => state.get(key),
      stateSet: vi.fn((key: string, value: unknown) => {
        state.set(key, value);
      }),
      storeGet: (key) => store.get(key),
      storeSet: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      storeDelete: vi.fn((key: string) => {
        store.delete(key);
      }),
      storeKeys: () => [...store.keys()],
      listPanes: () => ["p1"],
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          var current = $.state.get("count");
          current.n = 99;                 // 改副本，不应影响宿主
          $.state.set("count", { n: 2 });
          $.ui.open({ id: "p1", title: "待办" });
          $.ui.invalidate("ui.render");
          $.store.set("k", 7);
          $.store.delete("gone");
          return {
            plugin: $.plugin.name,
            panes: $.ui.panes(),
            keys: $.store.keys(),
            stored: $.store.get("k"),
          };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual({
      plugin: "todo",
      panes: ["p1"],
      keys: ["k"],
      stored: "7",
    });

    // 副本语义：mod 改的是它自己那份。
    expect(state.get("count")).toEqual({ n: 2 });
    expect(hostApi.openPane).toHaveBeenCalledWith("p1", "待办");
    expect(hostApi.invalidate).toHaveBeenCalledWith("ui.render");
    expect(hostApi.storeDelete).toHaveBeenCalledWith("gone");
  });

  it("ui.close 转发到宿主", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () { $.ui.close("p1"); });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    await mod.callHook("session.start", {});
    expect(hostApi.closePane).toHaveBeenCalledWith("p1");
  });

  it("$.ui.resolve 把 ui.render 的事件换成元素表", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function (e) {
          var t = $.ui.resolve(e);
          return __wave.h(t.Box, null, __wave.h(t.Text, null, "hi"));
        });
      };
    `);

    await mod.load();
    await expect(
      mod.callHook("ui.render", { surface: "desktop", component: "Pane" }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        type: "Box",
        props: {},
        children: [{ type: "Text", props: {}, children: ["hi"] }],
      },
    });
  });

  it("$.ui.resolve 传错参数当场报错，不返回半张表", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          var messages = [];
          var cases = [
            {},
            { surface: "terminal", component: "Pane" },
            { surface: "desktop", component: "Hint" },
          ];
          for (var bad of cases) {
            try { $.ui.resolve(bad); messages.push("no error"); }
            catch (e) { messages.push(String(e.message || e)); }
          }
          // 两个站点都得认：宿主两处都会发 ui.render，漏一个那处的 mod 就全抛错。
          var band = $.ui.resolve({ surface: "desktop", component: "AbovePrompt" });
          messages.push("band:" + band.Box + "," + typeof band.Button);
          return messages;
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    const messages = (result.ok ? result.value : []) as string[];
    // 不是 render 事件、或不是我们发的端：同一句，并列出支持的那一端。
    expect(messages[0]).toContain("需要一个 ui.render 的事件");
    expect(messages[0]).toContain("desktop");
    expect(messages[1]).toContain("需要一个 ui.render 的事件");
    // 报错要点名拿到的是什么，否则 mod 作者不知道该改哪。
    expect(messages[1]).toContain('"terminal"');
    // 站点名不认识：说清楚这一端只有什么。
    expect(messages[2]).toContain('不认识站点 "Hint"');
    expect(messages[2]).toContain("Pane");
    // `AbovePrompt`（输入框上方的带）是第二个站点，必须拿到同一张表。
    expect(messages[2]).toContain("AbovePrompt");
    expect(messages[3]).toBe("band:Box,string");
  });

  it("$.ui.status 转发到宿主：纯文本、过长的截断、null 与空串都表示清除", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.status("ctx 62%");
          $.ui.status(null);
          $.ui.status("   ");
          $.ui.status("x".repeat(10001));
          try { $.ui.status(42); } catch (e) { return String(e.message || e); }
          return "no error";
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    const calls = vi.mocked(hostApi.setStatus).mock.calls.map(([text]) => text);
    expect(calls.slice(0, 3)).toEqual(["ctx 62%", null, null]);
    // 限额 10000 字符：多出来的部分截掉并用省略号收口（不让一行顶满整屏）。
    const tooLong = calls[3] ?? "";
    expect(tooLong).toHaveLength(10001);
    expect(tooLong.endsWith("…")).toBe(true);
    // 类型错了当场报错，而不是把 `42` 画成「42」。
    expect(result.ok && result.value).toBe(
      "$.ui.status 需要一段文本（null 清除）",
    );
  });

  it("$.ui.toast 的停留时间：缺省 4000ms、夹到 10 秒、非法值报错", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.toast("已保存");
          $.ui.toast("等很久", 60000);
          $.ui.toast("等一下", 1500);
          var messages = [];
          for (var bad of ["1200", 0 / 0]) {
            try { $.ui.toast("x", bad); messages.push("no error"); }
            catch (e) { messages.push(String(e.message || e)); }
          }
          try { $.ui.toast("   "); } catch (e) { messages.push(String(e.message || e)); }
          return messages;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    const calls = vi.mocked(hostApi.showToast).mock.calls;
    expect(calls.map(([text, ms]) => [text, ms])).toEqual([
      ["已保存", 4000],
      ["等很久", 10000],
      ["等一下", 1500],
    ]);
    const messages = (result.ok ? result.value : []) as string[];
    expect(messages[0]).toContain("毫秒数");
    expect(messages[1]).toContain("毫秒数");
    // 空文本没有可展示的东西：报错，不落一条空白提示。
    expect(messages[2]).toContain("需要一段文本");
  });

  it("clock 只登记到宿主，沙箱里没有裸定时器", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          $.clock.after(500, function () {});
          var handle = $.clock.every(1000, function () {});
          return {
            now: typeof $.clock.now(),
            handle: typeof handle.cancel,
            timers: [typeof setTimeout, typeof setInterval],
          };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual({
      now: "number",
      handle: "function",
      timers: ["undefined", "undefined"],
    });
    // 回调是 vm realm 的函数，`expect.any(Function)` 的构造器比较会判假，
    // 所以按参数位逐个断言。
    const calls = vi.mocked(hostApi.startTimer).mock.calls;
    expect(
      calls.map(([kind, ms, fn]) => [kind, ms, typeof fn] as const),
    ).toEqual([
      ["after", 500, "function"],
      ["every", 1000, "function"],
    ]);
  });

  it("process.spawn 转发到宿主，流在沙箱里可被 for await 消费", async () => {
    const hostApi = host({
      spawnProcess: vi.fn(async function* () {
        yield { stream: "stdout" as const, text: "a" };
        yield { stream: "stderr" as const, text: "b" };
        return { code: 0, signal: null };
      }),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var out = [];
          for await (var chunk of $.process.spawn({ argv: ["x"] })) {
            out.push(chunk.stream + ":" + chunk.text);
          }
          return out.join(",");
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toBe("stdout:a,stderr:b");
    expect(hostApi.spawnProcess).toHaveBeenCalledWith({ argv: ["x"] });
  });

  it("等外部进程输出的时间不计入 hook 预算", async () => {
    vi.useFakeTimers();
    // 每一块输出都由测试放行：停在「等下一块」上的时间就是要验证的空闲。
    let release: (() => void) | undefined;
    const hostApi = host({
      spawnProcess: () =>
        (async function* () {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield { stream: "stdout" as const, text: "a" };
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { code: 0, signal: null };
        })(),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var out = "";
          for await (var chunk of $.process.spawn({ argv: ["x"] })) out += chunk.text;
          return out;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const pending = mod.callHook("session.start", {});
    // 跑到「等第一块」：此后暂停计时，超过预算也不该失败。
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.hookTimeoutMs * 2);
    release?.();
    // 第一块到手 → 循环体跑完 → 又停在等第二块，再超一轮预算。
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.hookTimeoutMs * 2);
    release?.();

    await expect(pending).resolves.toMatchObject({ ok: true, value: "a" });
  });

  it("mod 对进程流调 return() 时，宿主拿到的是 return", async () => {
    const stopped = vi.fn(async () => ({
      done: true as const,
      value: { code: null, signal: null },
    }));
    // 手写迭代器：`for await` 之外的 Cancel 按钮就是这么结束一条流的。
    const stream: AsyncGenerator<ModProcessChunk, ModProcessExit> = {
      next: async () => ({
        done: false,
        value: { stream: "stdout", text: "a" },
      }),
      return: stopped,
      throw: async () => ({ done: true, value: { code: null, signal: null } }),
      [Symbol.asyncIterator]: () => stream,
    };
    const { mod } = runtime(
      `
      var stream = null;
      exports.register = function ($, on) {
        on("session.start", function () {
          stream = $.process.spawn({ argv: ["x"] });
          return "ready";
        });
        on("ui.render", function () {
          return __wave.h("Button", { key: "stop", label: "stop", onPress: function () {
            return stream.return({ code: null, signal: null }).then(function () {
              return "stopped";
            });
          }});
        });
      };
      `,
      { host: host({ spawnProcess: () => stream }) },
    );

    await mod.load();
    await mod.callHook("session.start", {});
    // 元素回调只有渲染过一次才登记进处理表。
    await mod.callHook("ui.render", {});
    await expect(mod.dispatch("press", "stop")).resolves.toBe(true);
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("process.run 转发到宿主，结果原样回给沙箱", async () => {
    const cwd = path.resolve("/tmp/repo");
    const hostApi = host({
      runProcess: vi.fn(async () => ({
        exitCode: 3,
        stdout: "out",
        stderr: "err",
        isStdoutTruncated: false,
        isStderrTruncated: true,
      })),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.process.run(["git", "status"], { cwd: ${JSON.stringify(cwd)}, stdin: "x", timeoutMs: 1000 });
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: { exitCode: 3, stdout: "out", isStderrTruncated: true },
    });
    expect(hostApi.runProcess).toHaveBeenCalledWith(["git", "status"], {
      cwd,
      stdin: "x",
      timeoutMs: 1000,
    });
  });

  it("等 run 结束的时间不计入 hook 预算", async () => {
    vi.useFakeTimers();
    // 什么时候结束由测试放行：停在 run 上的这段时间就是要验证的空闲。
    let finish: ((result: ModRunResult) => void) | undefined;
    const hostApi = host({
      runProcess: () =>
        new Promise<ModRunResult>((resolve) => {
          finish = resolve;
        }),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var result = await $.process.run(["sleep", "10"]);
          return result.stdout;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const pending = mod.callHook("session.start", {});
    await vi.advanceTimersByTimeAsync(MOD_LIMITS.hookTimeoutMs * 2);
    finish?.({
      exitCode: 0,
      stdout: "done",
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    });

    await expect(pending).resolves.toMatchObject({ ok: true, value: "done" });
  });

  it("fs 的方法全部转发，相对路径的基准是会动的 workdir()", async () => {
    const workdir = vi.fn(() => path.resolve("/fake/project"));
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var read = await $.fs.read("a.txt");
          await $.fs.write("b.txt", "hi");
          await $.fs.list(".");
          await $.fs.stat("a.txt");
          var exists = await $.fs.exists("a.txt");
          return { text: read.text, truncated: read.isTruncated, exists: exists };
        });
      };
      `,
      { host: host({ workdir }) },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: { text: "hi", truncated: false, exists: true },
    });
    expect(fsStub.calls.map((call) => call.method)).toEqual([
      "read",
      "write",
      "list",
      "stat",
      "exists",
    ]);
    // 第二个参数原样透传（没给就是 undefined，由 ModFs 自己兜默认）。
    expect(fsStub.calls[0].args).toEqual(["a.txt", undefined]);
    expect(fsStub.calls[1].args).toEqual(["b.txt", "hi"]);

    // 基准每次现问宿主：会话里 `cd` 过之后，相对路径要跟着走。
    expect(fsStub.cwd?.()).toBe(path.resolve("/fake/project"));
    workdir.mockReturnValue(path.resolve("/fake/other"));
    expect(fsStub.cwd?.()).toBe(path.resolve("/fake/other"));
  });

  it("http.fetch 与链接共用同一份白名单，明文远端在沙箱里就报错", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.http.fetch("http://example.com/x");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("只允许 https:");
  });

  it("prompt.submit 以用户身份投进会话", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.prompt.submit({ text: "跑一下", asUser: true });
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    expect(hostApi.submitPrompt).toHaveBeenCalledWith("跑一下");
  });

  it("prompt.submit 缺 asUser / 空 text 一律报错，不静默降级", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var errors = [];
          for (var attempt of [
            function () { return $.prompt.submit({ text: "x" }); },
            function () { return $.prompt.submit({ text: "x", asUser: false }); },
            function () { return $.prompt.submit({ text: "" , asUser: true }); },
          ]) {
            try { await attempt(); } catch (e) { errors.push(e.message); }
          }
          return errors;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual([
      "$.prompt.submit 一期只支持 asUser: true",
      "$.prompt.submit 一期只支持 asUser: true",
      "$.prompt.submit 需要非空的 text",
    ]);
    expect(hostApi.submitPrompt).not.toHaveBeenCalled();
  });

  it("prompt.fill 把文本与 mode 交给宿主，空串也照传", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var results = [];
          results.push(await $.prompt.fill({ text: "基于这个再改一版" }));
          results.push(await $.prompt.fill({ text: "续写", mode: "append" }));
          results.push(await $.prompt.fill({ text: "", mode: "replace" }));
          return results;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    // mode 缺省是 replace（与 Claude Code 同一个缺省）。
    expect(hostApi.fillPrompt).toHaveBeenNthCalledWith(1, {
      text: "基于这个再改一版",
      mode: "replace",
    });
    expect(hostApi.fillPrompt).toHaveBeenNthCalledWith(2, {
      text: "续写",
      mode: "append",
    });
    // 空串是合法输入：replace 空串等于清空草稿。
    expect(hostApi.fillPrompt).toHaveBeenNthCalledWith(3, {
      text: "",
      mode: "replace",
    });
    expect(result.ok && result.value).toEqual([
      { isFilled: true },
      { isFilled: true },
      { isFilled: true },
    ]);
  });

  it("prompt.fill 宿主答 false 时原样透传，不抛错", async () => {
    // 「填不上」是正常结果（spec 场景 4）：终端宿主、对话框占键、超时都走这条。
    const hostApi = host({ fillPrompt: vi.fn(async () => false) });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.prompt.fill({ text: "x" });
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ isFilled: false });
  });

  it("prompt.fill 的 text / mode 不合法当场报错，不静默当成 replace", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var errors = [];
          for (var attempt of [
            function () { return $.prompt.fill({}); },
            function () { return $.prompt.fill({ text: 1 }); },
            function () { return $.prompt.fill({ text: "x", mode: "prepend" }); },
          ]) {
            try { await attempt(); } catch (e) { errors.push(e.message); }
          }
          return errors;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual([
      "$.prompt.fill 的 text 必须是字符串",
      "$.prompt.fill 的 text 必须是字符串",
      '$.prompt.fill 的 mode 只允许 "replace"、"append"、"insert"',
    ]);
    expect(hostApi.fillPrompt).not.toHaveBeenCalled();
  });

  it("session.usage 每次给一份新快照，mod 改它伤不到会话", async () => {
    // 宿主给的是**同一个**对象（缓存实现会这样），克隆是 runtime 的责任。
    const snapshot = {
      startedAt: 1_700_000_000_000,
      context: { tokens: 1000, window: 200_000, percent: 1 },
      tokens: { prompt: 10, completion: 2, cacheRead: 3, cacheCreation: 4 },
      rateLimits: [],
      model: "some-model",
    };
    const hostApi = host({ sessionUsage: vi.fn(() => snapshot) });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          var first = $.session.usage();
          first.context.tokens = 999;
          first.tokens.prompt = 999;
          var second = $.session.usage();
          return [first.context.tokens, second.context.tokens, second.tokens.prompt];
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual([999, 1000, 10]);
    expect(hostApi.sessionUsage).toHaveBeenCalledTimes(2);
  });
});

describe("ModRuntime 的树构造", () => {
  it("丢弃 null/false/undefined children，数字转成文本", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Box", null, null, false, undefined, 3, "a", [ "b", null ]);
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    const tree = (result.ok ? result.value : undefined) as ModTreeNode;
    expect(tree.children).toEqual(["3", "a", "b"]);
  });

  it("无法识别的 child 类型被丢弃", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Box", null, { notAnElement: true }, function () {});
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    const tree = (result.ok ? result.value : undefined) as ModTreeNode;
    expect(tree.children).toEqual([]);
  });
});

describe("插件作者的真实写法", () => {
  // 前面几组用手写 CJS 测执行；这一组从 TSX 源码出发，把「作者照 spec 写」到
  // 「沙箱跑出树」整条链走一遍 —— 编译与执行分属两个模块，接缝只有这里能钉住。
  const esbuild = getEsbuild();
  const requireEsbuild = esbuild ? it : it.skip;

  requireEsbuild(
    "import { Box, Text } from wave-agent-sdk/mods 的 TSX",
    async () => {
      const source = `
      import { Box, Text } from "wave-agent-sdk/mods";

      export function register($, on) {
        on("ui.render", () => <Box gap={2}><Text bold>hi</Text></Box>);
      }
    `;
      const outcomes = await compileMods(esbuild!, [{ path: ENTRY, source }]);
      const outcome = outcomes.get(ENTRY);
      expect(outcome?.error).toBeUndefined();

      // 不打包：import 留在产物里，由沙箱的 require 白名单接管。
      expect(outcome?.code).toContain(`require("wave-agent-sdk/mods")`);

      const { mod } = runtime(outcome!.code!);
      await mod.load();
      const result = await mod.callHook("ui.render", {});
      expect(result.ok && result.value).toMatchObject({
        type: "Box",
        props: { gap: 2 },
        children: [{ type: "Text", props: { bold: true }, children: ["hi"] }],
      });
    },
  );
});

describe("ModRuntime 的 $.ui.log 与 $.session.cwd", () => {
  it("$.ui.log 把一段文字裁掉首尾空白后交给宿主", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.log("  standup 该开了  ", { to: "transcript" });
          return "ok";
        });
      };
    `);

    await mod.load();
    await mod.callHook("session.start", {});
    expect(hostApi.appendLog).toHaveBeenCalledWith("standup 该开了");
  });

  it("$.ui.log 不认 transcript 以外的落点，也不接受空行", async () => {
    // 拼错一个落点就安静写进对话流，比报错更难查（spec「在对话流里留一行」）。
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.log("x", { to: "pane" });
        });
        on("turn.complete", function () {
          $.ui.log("   ");
        });
      };
    `);

    await mod.load();
    const rejectedTo = await mod.callHook("session.start", {});
    expect(rejectedTo.ok).toBe(false);
    if (!rejectedTo.ok) expect(rejectedTo.error).toMatch(/transcript/);

    const empty = await mod.callHook("turn.complete", { isAborted: false });
    expect(empty.ok).toBe(false);
    expect(hostApi.appendLog).not.toHaveBeenCalled();
  });

  it("$.session.cwd() 与 $.fs 同源：cd 过之后立刻是新目录", async () => {
    let cwd = path.resolve("/fake/project");
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () { return $.session.cwd(); });
      };
    `,
      { host: host({ workdir: () => cwd }) },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: path.resolve("/fake/project"),
    });
    cwd = path.resolve("/fake/project/sub");
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: path.resolve("/fake/project/sub"),
    });
  });
});

describe("ModRuntime 的 $.command（spec「注册命令」）", () => {
  it("注册只交元数据，返回值原样透传", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.command.register({
            name: "standup",
            description: "把今天的站会摘要写进对话",
            argumentHint: "[日期]",
          });
        });
      };
    `);

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: { command: "standup" },
    });
    expect(hostApi.registerCommand).toHaveBeenCalledWith({
      name: "standup",
      description: "把今天的站会摘要写进对话",
      argumentHint: "[日期]",
    });
  });

  it("名字不合法、缺描述都在注册时抛错，宿主什么都收不到", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          $.command.register({ name: "/standup", description: "x" });
        });
        on("turn.complete", function () {
          $.command.register({ name: "standup" });
        });
      };
    `);

    await mod.load();
    const badName = await mod.callHook("session.start", {});
    expect(badName.ok).toBe(false);
    if (!badName.ok) expect(badName.error).toMatch(/name/);
    const noDescription = await mod.callHook("turn.complete", {});
    expect(noDescription.ok).toBe(false);
    if (!noDescription.ok) expect(noDescription.error).toMatch(/description/);
    expect(hostApi.registerCommand).not.toHaveBeenCalled();
  });

  it("$.command.list 交给 mod 的是副本", async () => {
    const rows = [
      { name: "standup", description: "x", source: "plugin" as const },
    ];
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          var rows = $.command.list();
          rows.push({ name: "extra", description: "y", source: "plugin" });
          return rows.length;
        });
      };
    `,
      { host: host({ listCommands: () => rows }) },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: 2,
    });
    expect(rows).toHaveLength(1);
  });

  it("$.command.run 拿带斜杠的名字当场报错，正常名字转发宿主", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function () {
          await $.command.run({ command: "/standup" });
        });
        on("turn.complete", async function () {
          await $.command.run({ command: "standup", args: "周一" });
        });
      };
    `);

    await mod.load();
    const slash = await mod.callHook("session.start", {});
    expect(slash.ok).toBe(false);
    if (!slash.ok) expect(slash.error).toMatch(/不带斜杠/);

    await mod.callHook("turn.complete", { isAborted: false });
    expect(hostApi.runCommand).toHaveBeenCalledWith("standup", "周一");
  });

  it("command.run 钩子的 matcher 带不带斜杠都认，事件带命令与参数", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("command.run", { command: "/standup" }, function (e) {
          return { text: "/standup " + e.args };
        });
        on("command.run", { command: "no-slash" }, function () {
          return { text: "no-slash" };
        });
      };
    `);

    await mod.load();
    // 社区的 matcher 不带斜杠，我们归一成同一条命令（注册与派发两边都归一）。
    expect(mod.hookNames()).toEqual(["command.run"]);
    expect(mod.commandHookTargets()).toEqual(["/standup", "/no-slash"]);
    await expect(
      mod.callCommandHook("/standup", "周一"),
    ).resolves.toMatchObject({ ok: true, value: { text: "/standup 周一" } });
    await expect(mod.callCommandHook("/no-slash", "")).resolves.toMatchObject({
      ok: true,
      value: { text: "no-slash" },
    });
    // 没人答的命令不报错，由宿主决定怎么提示。
    await expect(mod.callCommandHook("/unknown", "")).resolves.toMatchObject({
      ok: true,
      value: undefined,
    });
  });

  it("command.run 钩子里再 $.command.run 被拒绝（会等自己那一轮）", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("command.run", { command: "/outer" }, async function () {
          await $.command.run({ command: "inner" });
        });
      };
    `);

    await mod.load();
    const result = await mod.callCommandHook("/outer", "");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/command\.run 钩子/);
    expect(hostApi.runCommand).not.toHaveBeenCalled();

    // 深度计数已经退回：钩子外面再调是允许的。
    const { mod: outer, host: outerHost } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function () {
          await $.command.run({ command: "inner" });
        });
      };
    `);
    await outer.load();
    await outer.callHook("session.start", {});
    expect(outerHost.runCommand).toHaveBeenCalledWith("inner", undefined);
  });
});

describe("ModRuntime 的 $.session 事实与 $.env / $.settings", () => {
  it("id/root/model、env.get、settings.read 全部转发到宿主", async () => {
    const hostApi = host({
      sessionId: () => "s-42",
      workspaceRoot: () => path.resolve("/fake/root"),
      model: () => "wave-pro",
      envGet: (name) => (name === "WATCH" ? "1" : undefined),
      settingsRead: async (query) => ({ echoed: query }),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return {
            id: await $.session.id(),
            root: await $.session.root(),
            model: await $.session.model(),
            watch: await $.env.get("WATCH"),
            missing: (await $.env.get("NOPE")) === undefined,
            merged: await $.settings.read(),
            keyed: await $.settings.read({ source: "project", key: "model" }),
          };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: {
        id: "s-42",
        root: path.resolve("/fake/root"),
        model: "wave-pro",
        watch: "1",
        missing: true,
        merged: { echoed: {} },
        keyed: { echoed: { source: "project", key: "model" } },
      },
    });
  });

  it("$.env.get 空名报错、超长名按「没设置」处理", async () => {
    const hostApi = host({ envGet: vi.fn(() => "value") });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var tooLong = await $.env.get(new Array(${MOD_LIMITS.envNameChars} + 2).join("X"));
          var error = "";
          try { await $.env.get(""); } catch (e) { error = String(e.message || e); }
          return { tooLong: tooLong === undefined, error: error };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual({
      tooLong: true,
      error: "$.env.get 需要一个变量名",
    });
    // 超长名连宿主都不问（那不可能是个真变量）。
    expect(hostApi.envGet).toHaveBeenCalledTimes(0);
  });

  it("$.settings.read 的 source 只认三层、key 必须是字符串", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function () {
          var messages = [];
          for (var bad of [{ source: "policy" }, { key: 42 }, "user"]) {
            try { await $.settings.read(bad); messages.push("no error"); }
            catch (e) { messages.push(String(e.message || e)); }
          }
          return messages;
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    const messages = (result.ok ? result.value : []) as string[];
    // 报错要点名能用的层，否则插件作者不知道该改成什么。
    expect(messages[0]).toContain('"user"、"project"、"local"');
    expect(messages[1]).toContain("key");
    expect(messages[2]).toContain("只接受");
  });

  it("$.settings.read 的结果超过 4 MiB 报错（截断的配置是错的配置）", async () => {
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          try { await $.settings.read(); return ""; }
          catch (e) { return String(e.message || e); }
        });
      };
      `,
      {
        host: host({
          settingsRead: async () => ({
            big: "x".repeat(MOD_LIMITS.settingsReadBytes),
          }),
        }),
      },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && String(result.value)).toContain(
      `超过 ${MOD_LIMITS.settingsReadBytes}`,
    );
  });
});

describe("ModRuntime 的 $.clock.sleep（spec「时钟：等待」）", () => {
  it("转发到宿主并透传 signal；负数与 NaN 当场报错", async () => {
    const signals: unknown[] = [];
    const hostApi = host({
      sleep: vi.fn(async (_ms: number, signal: unknown) => {
        signals.push(signal);
      }),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var controller = new AbortController();
          await $.clock.sleep(0, { signal: controller.signal });
          var messages = [];
          for (var bad of [-1, NaN, "100"]) {
            try { await $.clock.sleep(bad); messages.push("no error"); }
            catch (e) { messages.push(String(e.message || e)); }
          }
          return messages;
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    expect(hostApi.sleep).toHaveBeenCalledTimes(1);
    // 沙箱里的 `AbortController` 就是宿主那一份，signal 原样下来（宿主自己判形状）。
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    const messages = (result.ok ? result.value : []) as string[];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe("$.clock.sleep 需要非负的毫秒数");
    expect(messages[1]).toBe("$.clock.sleep 需要非负的毫秒数");
  });
});

describe("兼容社区 mod（spec「兼容社区 mod」）", () => {
  it("register(on, options)：第一个实参可调用、第二个带 userConfig 的值", async () => {
    const { mod } = runtime(
      `
      exports.register = function (on, options) {
        on("session.start", function ($, e) {
          return { mode: options.mode, size: options.size };
        });
      };
      `,
      { modOptions: { mode: "strict", size: 3 } },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result).toMatchObject({
      ok: true,
      value: { mode: "strict", size: 3 },
    });
  });

  it("社区的 handler 只写一个形参时也是 `$`（第一个实参被当成登记函数就够了）", async () => {
    // `on("command.run", matcher, async $ => …)` 真的存在（社区 ideas-shelf）：
    // 按形参个数判形状会把它当成我们的 `(e)`，`$` 会变成事件对象。
    const { mod, host: hostApi } = runtime(`
      exports.register = function (on) {
        on("command.run", { command: "ideas" }, async $ => {
          $.ui.toast("opened");
          return { text: "ideas" };
        });
      };
    `);

    await mod.load();
    const result = await mod.callCommandHook("/ideas", "");
    expect(hostApi.showToast).toHaveBeenCalledWith(
      "opened",
      expect.any(Number),
    );
    expect(result).toMatchObject({ ok: true, value: { text: "ideas" } });
  });

  it("register($, on)：我们的形状照旧（第一个实参当对象用、第二个当登记函数）", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function (e) {
          $.ui.status(e.label);
        });
      };
    `);

    await mod.load();
    await mod.callHook("session.start", { label: "ready" });
    // 第二个实参当登记函数用 ⇒ handler 是我们的 `(e)`，一个形参拿事件。
    expect(hostApi.setStatus).toHaveBeenCalledWith("ready");
  });

  it("handler ($, e, next)：拿到 $、事件与 next，next 给引擎那一帧", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function (on) {
        on("session.start", async function ($, e, next) {
          $.ui.status(e.label);
          var engine = await next(e);
          return { from: "handler", engine: engine === undefined ? "undefined" : typeof engine };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", { label: "ready" });
    expect(hostApi.setStatus).toHaveBeenCalledWith("ready");
    // 观察型事件的引擎帧是空对象：社区 mod 会读 `ran.deny` / `ran.isError`，
    // 给 undefined 会当场抛「读不到属性」。
    expect(result).toMatchObject({
      ok: true,
      value: { from: "handler", engine: "object" },
    });
  });

  it("ui.render 的 next(e) 是 undefined（Pane / AbovePrompt 没有引擎帧）", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("ui.render", async function ($, e, next) {
          var engine = await next(e);
          return __wave.h("Text", null, engine === undefined ? "none" : "some");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {
      component: "AbovePrompt",
    });
    expect(result.ok && result.value).toMatchObject({ children: ["none"] });
  });

  it("next(e) 一次只能调一次，第二次当场抛错", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("session.start", async function ($, e, next) {
          await next(e);
          await next(e);
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/一次只能调一次/);
  });

  it("matcher 按事件字段分流：ui.render 的站点、tool.call 的工具名", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("ui.render", { component: "AbovePrompt" }, function () {
          return __wave.h("Text", null, "band");
        });
        on("ui.render", { component: "Pane", requestId: "todo" }, function () {
          return __wave.h("Text", null, "pane-todo");
        });
        on("ui.render", { component: "Pane", requestId: "other" }, function () {
          return __wave.h("Text", null, "pane-other");
        });
        on("tool.call", { tool: ["Write", "Edit"] }, function ($, e) {
          return { saw: e.tool };
        });
      };
    `);

    await mod.load();
    // `requestId` 是社区的字段名，我们的事件的字段叫 `instance_id`（别名）。
    const band = await mod.callHook("ui.render", { component: "AbovePrompt" });
    expect(band.ok && band.value).toMatchObject({ children: ["band"] });
    const todo = await mod.callHook("ui.render", {
      component: "Pane",
      instance_id: "todo",
    });
    expect(todo.ok && todo.value).toMatchObject({ children: ["pane-todo"] });
    const other = await mod.callHook("ui.render", {
      component: "Pane",
      instance_id: "other",
    });
    expect(other.ok && other.value).toMatchObject({ children: ["pane-other"] });
    // 工具名不在候选里 ⇒ 这条钩子根本不参与这次事件（与 Claude Code 一样：
    // matcher 不命中就等于没注册）。
    const bash = await mod.callHook("tool.call", { tool: "Bash" });
    expect(bash).toMatchObject({ ok: true, value: undefined });
    const edit = await mod.callHook("tool.call", { tool: "Edit" });
    expect(edit.ok && edit.value).toEqual({ saw: "Edit" });
  });

  it("on(...).catch(handler)：钩子抛错时用兜底，兜底本身不抛就算成功", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("tool.call", { tool: "Bash" }, async function ($, e) {
          throw new Error("guard broke");
        }).catch(async function ($, e) {
          return { deny: "guard broke on " + e.tool };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("tool.call", { tool: "Bash" });
    expect(result).toMatchObject({
      ok: true,
      value: { deny: "guard broke on Bash" },
    });
  });

  it("没有 .catch() 的钩子抛错照旧报 ok:false", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("session.start", function () {
          throw new Error("boom");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("boom");
  });

  it("'claude-code' 是 wave-agent-sdk/mods 的别名，atom/read/update 落在 $.store 上", async () => {
    const store = new Map<string, string>();
    const hostApi = host({
      storeGet: vi.fn((key: string) => store.get(key)),
      storeSet: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
    });
    const { mod } = runtime(
      `
      var cc = require("claude-code");
      var turns = cc.atom({ plugin: "burn-rate", key: "turns" }, []);
      exports.register = function (on) {
        on("turn.complete", async function ($, e) {
          var before = await cc.read($, turns);
          var after = await cc.update($, turns, function (list) {
            return list.concat([1]);
          });
          return { before: before.length, after: after.length, tag: cc.Box };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const first = await mod.callHook("turn.complete", {});
    expect(first).toMatchObject({
      ok: true,
      value: { before: 0, after: 1, tag: "Box" },
    });
    // 第二次读到的就是上一次写进去的那份（同一个 store 键）。
    const second = await mod.callHook("turn.complete", {});
    expect(second).toMatchObject({ ok: true, value: { before: 1, after: 2 } });
    expect(store.has("burn-rate/turns")).toBe(true);
  });

  it("atom 存进去的不是合法 JSON 时读回初值", async () => {
    const hostApi = host({ storeGet: vi.fn(() => "not json") });
    const { mod } = runtime(
      `
      var cc = require("claude-code");
      var turns = cc.atom({ plugin: "p", key: "k" }, ["seed"]);
      exports.register = function (on) {
        on("session.start", async function ($, e) {
          return await cc.read($, turns);
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result).toMatchObject({ ok: true, value: ["seed"] });
  });

  it("prompt.submit 里 next({ ...e, context }) 的上下文能传到链尾（社区注入写法）", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("prompt.submit", async function ($, e, next) {
          return next({ ...e, context: ["[guard] 省着点用", "只用具体路径"] });
        });
      };
    `);

    await mod.load();
    // 引擎帧从**最终那份事件**上取：社区的写法是把改动交给 next，自己不要
    // 拼返回值。链尾丢掉这份改动，注入就静默失效了。
    const result = await mod.callHook("prompt.submit", { text: "干活" });
    expect(result).toMatchObject({
      ok: true,
      value: { context: ["[guard] 省着点用", "只用具体路径"] },
    });
  });

  it("command.run 的事件里 e.command 不带斜杠（社区直接比 'guard'）", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("command.run", { command: "/guard" }, async function ($, e, next) {
          if (e.command !== "guard") return next(e);
          return { text: "guard:" + e.args };
        });
      };
    `);

    await mod.load();
    const result = await mod.callCommandHook("/guard", "off");
    expect(result).toMatchObject({ ok: true, value: { text: "guard:off" } });
  });

  it("command.run 的 matcher 可以不给：一条钩子管自己所有命令（社区就这么写）", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("command.run", async function ($, e, next) {
          if (e.command === "guard") return { text: "guard" };
          if (e.command === "burn") return { text: "burn:" + e.args };
          return next(e);
        });
      };
    `);

    await mod.load();
    // 派发本来就按 mod 分开（`runCommandHook(modId, …)`），没有 matcher 只是
    // 「这个 mod 的每条命令都问它」，不会串到别的 mod。
    expect(mod.hookNames()).toEqual(["command.run"]);
    expect(mod.commandHookTargets()).toEqual([]);
    await expect(mod.callCommandHook("/guard", "")).resolves.toMatchObject({
      ok: true,
      value: { text: "guard" },
    });
    await expect(mod.callCommandHook("/burn", "42")).resolves.toMatchObject({
      ok: true,
      value: { text: "burn:42" },
    });
    // 不认识的那条交回引擎：空对象（没有 `{ text }`），宿主照「没人答」处理。
    await expect(mod.callCommandHook("/other", "")).resolves.toMatchObject({
      ok: true,
      value: {},
    });
  });
});
