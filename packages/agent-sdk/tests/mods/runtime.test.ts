import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileMods } from "../../src/mods/compile.js";
import {
  ModRuntime,
  type CompiledModule,
  type ModRuntimeHost,
} from "../../src/mods/runtime.js";
import { MOD_LIMITS, type ModTreeNode } from "../../src/types/mods.js";
import { getEsbuild } from "../../src/utils/esbuild.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * 沙箱执行的是 esbuild 产出的 CJS，所以这里的「编译产物」直接手写 —— 真转译
 * 由 `compile.test.ts` 覆盖，这一层只测执行/隔离/事件路由。
 */

const ROOT = path.resolve("/fake/plugin");
const ENTRY = path.join(ROOT, "mods", "panel.tsx");

function host(overrides: Partial<ModRuntimeHost> = {}): ModRuntimeHost {
  return {
    pluginName: "todo",
    pluginRoot: ROOT,
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
            root: $.plugin.root,
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
      root: ROOT,
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
