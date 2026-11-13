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
    ...overrides,
  };
}

function runtime(
  code: string,
  options: { host?: ModRuntimeHost; extra?: CompiledModule[] } = {},
): { mod: ModRuntime; host: ModRuntimeHost } {
  const hostApi = options.host ?? host();
  const compiled: CompiledModule[] = [
    { path: ENTRY, code },
    ...(options.extra ?? []),
  ];
  return { mod: new ModRuntime(hostApi, ENTRY, compiled), host: hostApi };
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
    const { mod } = runtime(`
      var ui = require("wave-agent-sdk/mods");
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h(ui.Box, null, Object.keys(ui).sort().join(","));
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {});
    expect(result.ok && result.value).toMatchObject({
      children: ["Box,Button,Code,Fragment,Input,Link,Markdown,Text"],
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
    // 一期只有 session.start / ui.render；`ui.close` 这类「面板被关掉」的事件
    // 是宿主内部清理（spec「事件」），mod 注册它不该悄悄生效。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.close", function () {});
        on("session.start", function () { return "ok"; });
      };
    `);

    await mod.load();
    expect(mod.hookNames()).toEqual(["session.start"]);
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
            onPress: function () { $.ui.invalidate("p1"); },
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

  it("Button 与 Input 撞 key 时按交互种类各自路由", async () => {
    const { host: hostApi, mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function () {
          return __wave.h("Box", null,
            __wave.h("Button", { key: "same", onPress: function () { $.ui.invalidate("press"); } }),
            __wave.h("Input", { key: "same", onSubmit: function (v) { $.ui.invalidate(v); } })
          );
        });
      };
    `);

    await mod.load();
    await mod.callHook("ui.render", {});

    await mod.dispatch("press", "same");
    await mod.dispatch("input", "same", "typed");

    expect(hostApi.invalidate).toHaveBeenNthCalledWith(1, "press");
    expect(hostApi.invalidate).toHaveBeenNthCalledWith(2, "typed");
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
          $.ui.invalidate("p1");
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
    expect(hostApi.invalidate).toHaveBeenCalledWith("p1");
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
      mod.callHook("ui.render", { surface: "pane", component: "Pane" }),
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
            { surface: "transcript", component: "Pane" },
            { surface: "pane", component: "Hint" },
          ];
          for (var bad of cases) {
            try { $.ui.resolve(bad); messages.push("no error"); }
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
    // 不是 render 事件、surface 没见过：同一句，并列出可用位置。
    expect(messages[0]).toContain("需要一个 ui.render 的事件");
    expect(messages[0]).toContain("pane");
    expect(messages[1]).toContain("需要一个 ui.render 的事件");
    // 站点名不认识：说清楚这个位置上只有什么。
    expect(messages[2]).toContain('不认识站点 "Hint"');
    expect(messages[2]).toContain("Pane");
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
