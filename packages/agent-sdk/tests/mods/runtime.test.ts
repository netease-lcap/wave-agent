import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileMods } from "../../src/mods/compile.js";
import {
  ModRuntime,
  renderSurfacesOf,
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
  // 默认不装：装了以后这两个方法按回调作答，`$.fs.ancestors` 的目录链要控制
  // 哪些文件存在、内容是什么（它自己走 exists/read，不额外开接口）。
  existsImpl: undefined as ((filePath: string) => boolean) | undefined,
  readImpl: undefined as ((filePath: string) => string) | undefined,
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
        if (fsStub.readImpl) {
          return record("read", args, fsStub.readImpl(String(args[0])));
        }
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
        if (fsStub.existsImpl) {
          return record("exists", args, fsStub.existsImpl(String(args[0])));
        }
        return record("exists", args, true);
      }
    },
  };
});

beforeEach(() => {
  fsStub.calls.length = 0;
  fsStub.cwd = undefined;
  fsStub.existsImpl = undefined;
  fsStub.readImpl = undefined;
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
    pluginRoot: ROOT,
    openPane: vi.fn(() => true),
    closePane: vi.fn(),
    listPanes: vi.fn(() => []),
    // 默认「桌面端在画」：`$.ui.open` 的 isPlaced 默认该是 true。
    surfaces: vi.fn(() => ["desktop"] as const),
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
    askUser: vi.fn(async () => "允许一次"),
    // `$` 上的只读事实（spec「会话事实」「环境变量与设置」）：默认给一份能用的
    // 值，具体断言在各用例里用 `mockReturnValue` 覆盖。
    sessionId: vi.fn(() => "session-1"),
    workspaceRoot: vi.fn(() => path.resolve("/fake/project")),
    model: vi.fn(() => "test-model"),
    // 默认：用户发过 3 轮、不在仓库里、版本读得到一份能用的值。
    sessionTurns: vi.fn(() => 3),
    sessionRepo: vi.fn(() => null),
    sessionVersion: vi.fn(() => ({ version: "1.6.6" })),
    listConfigRows: vi.fn(() => []),
    listToolInfos: vi.fn(() => []),
    listAgentInfos: vi.fn(() => []),
    // 默认会话里没有消息：`$.session.messages()` 给空数组。
    listSessionMessages: vi.fn(() => []),
    // 默认没有界面接手输入框：`read` 给空草稿。
    readPromptDraft: vi.fn(async () => ({ text: "", cursor: 0 })),
    // 默认接得住：贴一行、写剪贴板都成功。
    showNotice: vi.fn(),
    copyText: vi.fn(async () => ({ isCopied: true as const })),
    envGet: vi.fn((): string | undefined => undefined),
    settingsRead: vi.fn(async () => ({})),
    sleep: vi.fn(async () => {}),
    registerCommand: vi.fn((spec: ModCommandSpec) => ({ command: spec.name })),
    listCommands: vi.fn(() => []),
    runCommand: vi.fn(async () => {}),
    // 三个写入型 API 的出口（spec「把我们自己的工具交给模型」「派子代理」
    // 「让模型替插件答一次」）：默认都成功，断言看各用例怎么改。
    registerTool: vi.fn(async (spec: { name: string }) => ({
      name: spec.name,
    })),
    // 工具面的两个探针（spec「主动问一次工具面」）：默认「没人拦」。
    checkTool: vi.fn(async () => ({ decision: "allow" as const })),
    callTool: vi.fn(async () => ({})),
    spawnAgent: vi.fn(async () => ({
      model: "test-model",
      agentId: "agent-1",
    })),
    completeModel: vi.fn(async () => ({
      isAnswered: true as const,
      text: "ok",
      usage: {
        prompt: 1,
        completion: 1,
        cacheRead: 0,
        cacheCreation: 0,
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })),
    suggestPrompt: vi.fn(async () => ({ isShown: true })),
    // 默认「有得收」：`$.turn.abort` 的 id 判在宿主那边，这一层只验证原样交下去。
    turnAbort: vi.fn(),
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

  it("循环 import 按 CJS 语义拿到半成品导出，不整片失败", async () => {
    const a = path.join(ROOT, "mods", "a.ts");
    const b = path.join(ROOT, "mods", "b.ts");
    const { mod } = runtime(
      `const a = require("./a");
       // a 跑完了：b 拿到了 a 的同一个 exports 对象（当时只写了一半）。
       if (a.fromB.kind !== "b") throw new Error("b 没执行");
       if (a.fromB.fromA !== a) throw new Error("b 看到的 a 不是同一份 exports");
       exports.register = function () {};`,
      {
        extra: [
          {
            path: a,
            code: `exports.kind = "a"; exports.fromB = require("./b");`,
          },
          {
            path: b,
            // 环里进来的 a 还没执行到 `fromB = ...`，所以那一项此时没有。
            code: `const a = require("./a");
                   if (a.kind !== "a") throw new Error("a 的已有导出该可见");
                   if (a.fromB !== undefined) throw new Error("a 不该已经有 fromB");
                   exports.kind = "b"; exports.fromA = a;`,
          },
        ],
      },
    );

    await expect(mod.load()).resolves.toBe(true);
  });

  it("`./x.js` 说明符落到同名的 .ts 源码上", async () => {
    const dep = path.join(ROOT, "mods", "dep.ts");
    const { mod } = runtime(
      `require("./dep.js"); exports.register = function () {};`,
      {
        extra: [{ path: dep, code: `exports.ready = true;` }],
      },
    );

    await expect(mod.load()).resolves.toBe(true);
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
    // 悄悄生效，否则插件作者会以为那条路径通了。`classic.` 只镜像「影子事件」
    // 那张表里的事件，其余（`classic.Setup`、`classic.TaskCompleted`…）照旧拒。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.destroy", function () {});
        on("classic.Setup", function () {});
        on("classic.TaskCompleted", function () {});
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

  it("影子事件的 15 个 classic.* 镜像都能注册，载荷原样交给 handler", async () => {
    // spec「影子事件」：全是只读镜像，返回值由宿主丢弃（这里只看名字收下了、
    // 载荷没被改写）。
    const names = [
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
      "classic.PostToolUse",
      "classic.PostToolUseFailure",
      "classic.PostToolBatch",
      "classic.CwdChanged",
    ];
    const { mod } = runtime(`
      exports.register = function ($, on) {
        ${names
          .map(
            (name) =>
              `on(${JSON.stringify(name)}, function (e) { return e.hook_event_name || "?"; });`,
          )
          .join("\n        ")}
      };
    `);

    await mod.load();
    expect(mod.hookNames()).toEqual(names);
    await expect(
      mod.callHook("classic.SessionStart", { hook_event_name: "SessionStart" }),
    ).resolves.toMatchObject({ ok: true, value: "SessionStart" });
    await expect(
      mod.callHook("classic.StopFailure", { hook_event_name: "StopFailure" }),
    ).resolves.toMatchObject({ ok: true, value: "StopFailure" });
  });

  it("影子事件里只有 PostToolUse 族吃 matcher（按 tool_name 分流）", async () => {
    // Claude Code 的 matcher 键表对这三个事件列的就是 `tool_name`；其余影子事
    // 件带 matcher 一律拒收，免得插件作者以为能按 `source` / `reason` 分流。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("classic.PostToolUse", { tool_name: ["Write", "Edit"] }, function (e) {
          return "saw:" + e.tool_name;
        });
        on("classic.Stop", { source: "startup" }, function () {
          return "stop";
        });
      };
    `);

    await mod.load();
    expect(mod.hookNames()).toEqual(["classic.PostToolUse"]);
    const matched = await mod.callHook("classic.PostToolUse", {
      tool_name: "Edit",
    });
    expect(matched).toMatchObject({ ok: true, value: "saw:Edit" });
    const other = await mod.callHook("classic.PostToolUse", {
      tool_name: "Bash",
    });
    expect(other).toMatchObject({ ok: true, value: undefined });
  });
});

describe("沙箱加固（对齐 Claude Code 的 vmHardening）", () => {
  // 这两个用例真的会跑满 `MOD_LIMITS.hookTimeoutMs`：vm 的 timeout 是 V8 的
  // terminate，只能靠真实时钟打断同步执行，没有加快的办法。
  it(
    "钩子里的同步死循环被 timeout 打断，而不是把进程卡死",
    { timeout: 30_000 },
    async () => {
      const { mod } = runtime(`
        exports.register = function ($, on) {
          on("session.start", function () {
            while (true) {}
          });
        };
      `);

      await mod.load();
      const result = await mod.callHook("session.start", {});
      // 要点是这一句能返回：改之前这里会挂到 vitest 自己超时。
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          `session.start 的处理函数 的同步执行超过 ${MOD_LIMITS.hookTimeoutMs}ms（多半是卡在死循环里）`,
        );
      }
    },
  );

  it(
    "模块体里的同步死循环同样被打断（不是只盖住钩子）",
    { timeout: 30_000 },
    async () => {
      const { mod } = runtime(`while (true) {}`);

      await expect(mod.load()).rejects.toThrow(/同步执行超过/);
    },
  );

  it("mod 改不动本 realm 的内置，也伪造不了堆栈", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          Array.prototype.patched = 1;
          Object.prototype.evil = 1;
          Error.prepareStackTrace = function () { return "forged"; };
          var stack = "";
          try { throw new Error("boom"); } catch (e) { stack = String(e.stack); }
          return [
            typeof [].patched,
            typeof ({}).evil,
            stack.indexOf("forged") < 0,
          ].join(",");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toBe("undefined,undefined,true");
  });

  it("冻结的是内建清单本身（构造器/prototype 都在位），captureStackTrace 已删", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          return [
            typeof Error.captureStackTrace,
            Object.isFrozen(Object.prototype),
            Object.isFrozen(Array.prototype),
            Object.isFrozen(Promise),
          ].join(",");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toBe("undefined,true,true,true");
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

  it("$.ui.invalidate 只认认识的渲染站点，别的目标当场报错", async () => {
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

  it("$.ui.invalidate 也认 tool.describe，并原样交给宿主", async () => {
    // 工具行上那段描述也是「生产者 → 站点」的一条：mod 改了自己的工具描述后
    // 要能叫那一行重画，否则只能等下一次整屏刷新。
    const { host: hostApi, mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.invalidate("ui.render");
          $.ui.invalidate("tool.describe");
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    expect(hostApi.invalidate).toHaveBeenNthCalledWith(1, "ui.render");
    expect(hostApi.invalidate).toHaveBeenNthCalledWith(2, "tool.describe");
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

    expect(hostApi.openPane).toHaveBeenNthCalledWith(1, "press", "", false);
    expect(hostApi.openPane).toHaveBeenNthCalledWith(2, "typed", "", false);
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
    const store = new Map<string, unknown>();
    const hostApi = host({
      stateGet: (key) => state.get(key),
      stateSet: vi.fn((key: string, value: unknown) => {
        state.set(key, value);
      }),
      storeGet: (key) => store.get(key),
      storeSet: vi.fn((key: string, value: unknown) => {
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
        on("session.start", async function () {
          var current = $.state.get("count");
          current.n = 99;                 // 改副本，不应影响宿主
          $.state.set("count", { n: 2 });
          $.ui.open({ id: "p1", title: "待办" });
          $.ui.invalidate("ui.render");
          // 任意 JSON：对象原样存，不当成 "[object Object]"。
          await $.store.set("k", { n: 7 });
          await $.store.delete("gone");
          return {
            plugin: $.plugin.name,
            root: $.plugin.root,
            panes: await $.ui.panes(),
            keys: await $.store.keys(),
            stored: await $.store.get("k"),
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
      // 插件自己的根目录（`mods/` 的上一级）：社区插件拿它拼自己那几份资源。
      root: ROOT,
      panes: ["p1"],
      keys: ["k"],
      stored: { n: 7 },
    });

    // 副本语义：mod 改的是它自己那份。
    expect(state.get("count")).toEqual({ n: 2 });
    expect(hostApi.openPane).toHaveBeenCalledWith("p1", "待办", false);
    expect(hostApi.invalidate).toHaveBeenCalledWith("ui.render");
    expect(hostApi.storeDelete).toHaveBeenCalledWith("gone");
  });

  it("$.turn.abort 只转一手：turnId 原样交给宿主，空的在 runtime 就拒", async () => {
    // spec「`$.turn`」：判据（这一轮在不在、id 对不对）全在宿主，runtime 只转发
    // 并把宿主的错误原样交给 mod —— 静默成功会让插件以为自己叫停了。
    const hostApi = host({ turnAbort: vi.fn() });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          await $.turn.abort({ turnId: "t-1" });
          try {
            await $.turn.abort({});
            return "没抛错";
          } catch (error) {
            return error.message;
          }
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});

    expect(hostApi.turnAbort).toHaveBeenCalledWith("t-1");
    expect(result.ok && result.value).toBe("$.turn.abort 需要一个 { turnId }");
  });

  it("$.turn.abort 时宿主判不过（没有这一轮 / id 对不上）的错原样抛给 mod", async () => {
    const hostApi = host({
      turnAbort: vi.fn(() => {
        throw new Error("没有正在跑的一轮");
      }),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          await $.turn.abort({ turnId: "t-stale" });
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("没有正在跑的一轮");
  });

  it("$.store 四个方法都返回 Promise，值是任意 JSON（不压成字符串）", async () => {
    // 社区插件按 Claude Code 的 async 契约写：`store.get(k).catch(…)`、`await
    // store.set(k, {…})`。同步返回会 `TypeError: … reading 'catch'`，只收字符串
    // 则把对象存成 "[object Object]"。
    const store = new Map<string, unknown>();
    const hostApi = host({
      storeGet: (key) => store.get(key),
      storeSet: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
      }),
      storeDelete: vi.fn((key: string) => {
        store.delete(key);
      }),
      storeKeys: () => [...store.keys()],
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          var get = $.store.get("last");
          var set = $.store.set("last", { at: 1, tags: ["a"] });
          var del = $.store.delete("gone");
          var keys = $.store.keys();
          // 只认 thenable：社区写法里最常见的下一步就是 .catch。
          return Promise.all([get, set, del, keys]).then(function (all) {
            return { isThenable: typeof set.catch, last: all[0] };
          }).then(function (state) {
            return $.store.set("last", { at: 2 }).then(function () {
              return $.store.get("last").then(function (next) {
                return { ...state, next: next };
              });
            });
          });
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result).toMatchObject({
      ok: true,
      value: {
        isThenable: "function",
        // 写的时候还没写过，读回来是 undefined。
        last: undefined,
        next: { at: 2 },
      },
    });
    expect(hostApi.storeSet).toHaveBeenCalledWith("last", {
      at: 1,
      tags: ["a"],
    });
  });

  it("$.store.set 的 JSON 口径与 Claude Code 一致（值先归一，键再查）", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        var cases = [
          // 函数在对象属性上被 JSON.stringify 静默丢掉 —— CC 就是这样，不放宽也不加严。
          function () { return $.store.set("fn", { cb: function () {}, keep: 1 }); },
          function () {
            var loop = {};
            loop.self = loop;
            return $.store.set("loop", loop);
          },
          function () {
            return $.store.set("big", "x".repeat(${MOD_LIMITS.storeValueChars + 1}));
          },
          function () { return $.store.set("", 1); },
          function () { return $.store.set("nothing", undefined); },
          function () { return $.store.get(""); },
          function () { return $.store.delete(""); },
        ];
        on("session.start", async function () {
          return await Promise.all(cases.map(function (run) {
            return run().then(function (v) { return v === undefined ? "ok" : v; }, function (e) {
              return e.message;
            });
          }));
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    const messages = (result as unknown as { value: unknown[] }).value;
    expect(messages[0]).toBe("ok");
    // 环、顶层 undefined、超限、空键都当场报错（空键三条方法都查）。
    expect(messages[1]).toContain("circular");
    expect(messages[2]).toMatch(/超过 \d+/);
    expect(messages[3]).toContain("字符串键");
    expect(messages[4]).toContain("undefined");
    expect(messages[5]).toContain("字符串键");
    expect(messages[6]).toContain("字符串键");
    // 函数被 JSON 丢掉，留下的就是纯 JSON：`{ keep: 1 }`。
    expect(hostApi.storeSet).toHaveBeenCalledTimes(1);
    expect(hostApi.storeSet).toHaveBeenCalledWith("fn", { keep: 1 });
  });

  it("ui.close 转发到宿主（`{ id }` 是 Claude Code 的形状）", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () { return $.ui.close({ id: "p1" }); });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    expect(hostApi.closePane).toHaveBeenCalledWith("p1");
  });

  it("ui.close 传字符串（旧形状）当场报错，不静默当成 id", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          try { await $.ui.close("p1"); } catch (e) { return String(e.message); }
          return "no-error";
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual(
      expect.stringContaining("$.ui.close 需要一个 { id }"),
    );
    expect(hostApi.closePane).not.toHaveBeenCalled();
  });

  it("$.ui.open 答 isPlaced 与 reason（没有界面时 false + no-surface）", async () => {
    const noSurface = host({ surfaces: () => [] });
    const { mod: dark } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.ui.open({ id: "p1", title: "守卫" });
        });
      };
      `,
      { host: noSurface },
    );
    await dark.load();
    const opened = await dark.callHook("session.start", {});
    expect(opened.ok && opened.value).toEqual({
      isPlaced: false,
      reason: expect.stringContaining("no-surface"),
    });
    // 面板仍然登记着（与 Claude Code 一样「没有 surface 也把面板留着」，之后
    // 有界面挂上来它就画出来），只是这一次没人接住。
    expect(noSurface.openPane).toHaveBeenCalledWith("p1", "守卫", false);

    const desktop = host();
    const { mod: lit } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          return $.ui.open({ id: "p1", title: "守卫", focus: true });
        });
      };
      `,
      { host: desktop },
    );
    await lit.load();
    const placed = await lit.callHook("session.start", {});
    expect(placed.ok && placed.value).toEqual({ isPlaced: true });
    // `focus: true` 要原样透给宿主：surface 靠它把键盘直接送进这块面板。
    expect(desktop.openPane).toHaveBeenCalledWith("p1", "守卫", true);
  });

  it("$.ui.open 的 focus 只收 true（与 Claude Code 一样）", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          try { await $.ui.open({ id: "p1", focus: false }); } catch (e) { return String(e.message); }
          return "no-error";
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual(
      expect.stringContaining("focus 只能写 true"),
    );
    expect(hostApi.openPane).not.toHaveBeenCalled();
  });

  it("$.session.surfaces 原样给出宿主入口的答案（空数组也是正常结果）", async () => {
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var surfaces = await $.session.surfaces();
          return { count: surfaces.length, first: surfaces[0] };
        });
      };
      `,
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok && result.value).toEqual({ count: 1, first: "desktop" });

    const { mod: dark } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return (await $.session.surfaces()).length;
        });
      };
      `,
      { host: host({ surfaces: () => [] }) },
    );
    await dark.load();
    const empty = await dark.callHook("session.start", {});
    expect(empty.ok && empty.value).toBe(0);
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

  it("$.ui.resolve 的元素表也能直接调用（Claude Code 官方示例的写法）", async () => {
    // 官方 `mods/blast-radius` 的 `.mjs` 写的是 `const { Box, Text } = t; Text({ children })`，
    // 不是 JSX —— 两种写法必须编出同一种树，否则「原样能跑」只对社区那半成立。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function (e) {
          var t = $.ui.resolve(e);
          return t.Box({
            flexDirection: "column",
            children: [
              t.Text({ children: "hi" }),
              t.Text({ key: "k", children: ["a", "b"] }),
              t.Button({ key: "go", label: "go", onPress: function () { return "pressed"; } }),
            ],
          });
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("ui.render", {
      surface: "desktop",
      component: "AbovePrompt",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        type: "Box",
        props: { flexDirection: "column" },
        children: [
          { type: "Text", props: {}, children: ["hi"] },
          { type: "Text", props: { key: "k" }, children: ["a", "b"] },
          { type: "Button", props: { key: "go", label: "go" }, children: [] },
        ],
      },
    });
    // 回调走的是同一个登记表：调用式写出来的按钮也能按。
    await expect(mod.dispatch("press", "go")).resolves.toBe(true);
  });

  it("$.ui.resolve 传错参数当场报错，不返回半张表", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          var messages = [];
          var cases = [
            {},
            { surface: "mobile", component: "Pane" },
            { surface: "desktop", component: "Hint" },
          ];
          for (var bad of cases) {
            try { $.ui.resolve(bad); messages.push("no error"); }
            catch (e) { messages.push(String(e.message || e)); }
          }
          // 两个站点都得认：宿主两处都会发 ui.render，漏一个那处的 mod 就全抛错。
          var band = $.ui.resolve({ surface: "desktop", component: "AbovePrompt" });
          messages.push("band:" + band.Box.elementType + "," + typeof band.Button);
          // 按端裁剪：终端那张表没有 Svg（spec「元素表按端分」）。
          var term = $.ui.resolve({ surface: "terminal", component: "Pane" });
          messages.push("terminal:" + typeof term.Svg + "," + typeof term.Progress);
          return messages;
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    const messages = (result.ok ? result.value : []) as string[];
    // 不是 render 事件、或不是我们画的端：同一句，并列出支持的那三端。
    expect(messages[0]).toContain("需要一个 ui.render 的事件");
    expect(messages[0]).toContain("terminal / desktop / vscode");
    expect(messages[1]).toContain("需要一个 ui.render 的事件");
    // 报错要点名拿到的是什么，否则 mod 作者不知道该改哪。
    expect(messages[1]).toContain('"mobile"');
    // 站点名不认识：说清楚这一期只有什么。
    expect(messages[2]).toContain('不认识站点 "Hint"');
    expect(messages[2]).toContain("Pane");
    // `AbovePrompt`（输入框上方的带）是第二个站点，必须拿到同一张表。
    expect(messages[2]).toContain("AbovePrompt");
    expect(messages[3]).toBe("band:Box,function");
    // 终端表：Svg 拿不到，Progress 照常有。
    expect(messages[4]).toBe("terminal:undefined,function");
  });

  it("renderSurfacesOf 把宿主入口映射成 ui.render 的 surface（JetBrains 与 VS Code 同一个）", () => {
    expect(renderSurfacesOf("desktop")).toEqual(["desktop"]);
    // VS Code 与 JetBrains 画的是同一份 webview，共用 `vscode`（spec「在 IDE 插件里画」）。
    expect(renderSurfacesOf("vscode")).toEqual(["vscode"]);
    expect(renderSurfacesOf("jetbrains")).toEqual(["vscode"]);
    // 终端与远控页一期不画 mod 的树，宿主也不会来要。
    expect(renderSurfacesOf("cli")).toEqual([]);
    expect(renderSurfacesOf("remote")).toEqual([]);
    expect(renderSurfacesOf(undefined)).toEqual([]);
  });

  it("$.ui.resolve 认 vscode 这一端（IDE 聊天面板发来的事件）", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("ui.render", function (e) {
          var t = $.ui.resolve(e);
          return t.Text({ children: e.surface });
        });
      };
    `);

    await mod.load();
    await expect(
      mod.callHook("ui.render", {
        surface: "vscode",
        component: "AbovePrompt",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { type: "Text", props: {}, children: ["vscode"] },
    });
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

  it("$.ui.toast 的停留时间：`{ timeoutMs }` 与裸数字都认，缺省 4000ms、夹到 10 秒", async () => {
    const hostApi = host();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.toast("已保存");
          // 社区写法（Claude Code 的第二个参数是对象）。
          $.ui.toast("等很久", { timeoutMs: 60000 });
          $.ui.toast("等一下", { timeoutMs: 1500 });
          // 早期的示例写作裸数字：照样认。
          $.ui.toast("裸数字", 2000);
          // 对象里没给时长 = 用默认值，不报错。
          $.ui.toast("没给时长", {});
          var messages = [];
          for (var bad of ["1200", 0 / 0, { timeoutMs: "1200" }]) {
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
      ["裸数字", 2000],
      ["没给时长", 4000],
    ]);
    const messages = (result.ok ? result.value : []) as string[];
    expect(messages[0]).toContain("{ timeoutMs }");
    expect(messages[1]).toContain("{ timeoutMs }");
    expect(messages[2]).toContain("{ timeoutMs }");
    // 空文本没有可展示的东西：报错，不落一条空白提示。
    expect(messages[3]).toContain("需要一段文本");
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

  it('$.ui.log 的 to: "debug" 只进调试日志，对话流里一个字都不留', async () => {
    const { logger } = await import("../../src/utils/globalLogger.js");
    vi.mocked(logger.debug).mockClear();
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.log("  排查用  ", { to: "debug" });
          return "ok";
        });
      };
    `);

    await mod.load();
    await mod.callHook("session.start", {});
    expect(hostApi.appendLog).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith("[mod:todo]", "排查用");
  });

  it("$.ui.log 不认 transcript / debug 以外的落点，也不接受空行", async () => {
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
    if (!rejectedTo.ok) {
      // 报错要能告诉作者可用的落点有哪些。
      expect(rejectedTo.error).toContain("transcript");
      expect(rejectedTo.error).toContain("debug");
    }

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

describe("ModRuntime 的只读清单与 UI 小件（spec「配了哪些、能调什么、有谁在跑」「工具行下面的一行」「剪贴板与视图」）", () => {
  it("$.config.list / $.tool.list / $.agent.list 原样给出宿主的三份清单，且是副本", async () => {
    const hostApi = host({
      listConfigRows: vi.fn(() => [
        {
          key: "model",
          label: "模型",
          kind: "text" as const,
          value: "wave-pro",
          provider: { plugin: "engine", tier: "core" },
          isLocked: true,
        },
      ]),
      listToolInfos: vi.fn(() => [
        { name: "Bash", description: "跑命令", mcp: false },
      ]),
      listAgentInfos: vi.fn(() => [
        {
          id: "a1",
          description: "查资料",
          type: "Explore",
          status: "running" as const,
        },
      ]),
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          var rows = $.config.list();
          var tools = $.tool.list();
          var agents = $.agent.list();
          // 改自己拿到的那份：宿主那份必须不动（跨 realm 拷贝）。
          rows[0].value = "tampered";
          return { rows: rows, tools: tools, agents: agents };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      rows: [
        {
          key: "model",
          label: "模型",
          kind: "text",
          value: "tampered",
          provider: { plugin: "engine", tier: "core" },
          isLocked: true,
        },
      ],
      tools: [{ name: "Bash", description: "跑命令", mcp: false }],
      agents: [
        { id: "a1", description: "查资料", type: "Explore", status: "running" },
      ],
    });
    expect(hostApi.listConfigRows()).toEqual([
      {
        key: "model",
        label: "模型",
        kind: "text",
        value: "wave-pro",
        provider: { plugin: "engine", tier: "core" },
        isLocked: true,
      },
    ]);
  });

  it("$.session 的 turns / repo / version 都是异步取，不在仓库里给 null", async () => {
    const notRepo = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return {
            turns: await $.session.turns(),
            repo: await $.session.repo(),
            version: await $.session.version(),
          };
        });
      };
      `,
    );
    await notRepo.mod.load();
    await expect(
      notRepo.mod.callHook("session.start", {}),
    ).resolves.toMatchObject({
      ok: true,
      value: { turns: 3, repo: null, version: { version: "1.6.6" } },
    });

    const root = path.resolve("/fake/repo");
    const inRepo = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.session.repo();
        });
      };
      `,
      {
        host: host({
          sessionRepo: vi.fn(() => ({
            root,
            remote: "git@example.com:a/b.git",
            internal: false,
            name: null,
          })),
        }),
      },
    );
    await inRepo.mod.load();
    await expect(
      inRepo.mod.callHook("session.start", {}),
    ).resolves.toMatchObject({
      ok: true,
      value: { root, remote: "git@example.com:a/b.git" },
    });
  });

  it("$.prompt.read 转发到宿主：没人画输入框时给空草稿而不是 reject", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.prompt.read();
        });
      };
    `);
    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: { text: "", cursor: 0 },
    });

    const readPromptDraft = vi.fn(async () => ({ text: "草稿", cursor: 2 }));
    const withDraft = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.prompt.read();
        });
      };
      `,
      { host: host({ readPromptDraft }) },
    );
    await withDraft.mod.load();
    await expect(
      withDraft.mod.callHook("session.start", {}),
    ).resolves.toMatchObject({ ok: true, value: { text: "草稿", cursor: 2 } });
    expect(readPromptDraft).toHaveBeenCalledTimes(1);
  });

  it("$.ui.notice 贴在指定工具调用下面，undefined 表示撤掉", async () => {
    const showNotice = vi.fn();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          $.ui.notice("tool-1", "3 个文件");
          $.ui.notice("tool-1", undefined);
        });
      };
      `,
      { host: host({ showNotice }) },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
    });
    expect(showNotice.mock.calls).toEqual([
      ["tool-1", "3 个文件"],
      ["tool-1", null],
    ]);
  });

  it("$.ui.notice 的 tool_use_id 为空、text 不是字符串都当场报错", async () => {
    const showNotice = vi.fn();
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", function () {
          var messages = [];
          for (var args of [[], [""], ["tool-1", 42]]) {
            try { $.ui.notice.apply(null, args); } catch (e) { messages.push(e.message); }
          }
          return messages;
        });
      };
      `,
      { host: host({ showNotice }) },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as string[]).length).toBe(3);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it("$.ui.copy 把文本与 surface 交给宿主，结果原样回给 mod", async () => {
    const copyText = vi.fn(async () => ({ isCopied: true as const }));
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var ok = await $.ui.copy({ text: "一段话" });
          var scoped = await $.ui.copy({ text: "另一段", surface: "desktop" });
          return [ok, scoped];
        });
      };
      `,
      { host: host({ copyText }) },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: [{ isCopied: true }, { isCopied: true }],
    });
    expect(copyText.mock.calls).toEqual([
      [{ text: "一段话" }],
      [{ text: "另一段", surface: "desktop" }],
    ]);
  });

  it("$.ui.copy 宿主拒绝时按返回值作答，不抛错", async () => {
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.ui.copy({ text: "x" });
        });
      };
      `,
      {
        host: host({
          copyText: vi.fn(async () => ({
            isCopied: false as const,
            reason: "no-clipboard" as const,
          })),
        }),
      },
    );

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: { isCopied: false, reason: "no-clipboard" },
    });
  });

  it("$.ui.copy 缺 text、超长、surface 拼错都当场报错", async () => {
    const copyText = vi.fn(async () => ({ isCopied: true as const }));
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          var messages = [];
          var cases = [
            [{}],
            [{ text: "x".repeat(${MOD_LIMITS.copyTextChars} + 1) }],
            [{ text: "x", surface: "tablet" }],
          ];
          for (var args of cases) {
            try { await $.ui.copy(args[0]); } catch (e) { messages.push(e.message); }
          }
          return messages;
        });
      };
      `,
      { host: host({ copyText }) },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as string[]).length).toBe(3);
    expect(copyText).not.toHaveBeenCalled();
  });

  it("$.ui.view 一期一律答 deny，说明为什么没切", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.ui.view({ agentId: "a1" });
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(String((result.value as { deny?: string }).deny)).toContain(
      "子代理",
    );
  });
});

describe("ModRuntime 的 $.fs.ancestors（spec「沿目录链找指令文件」）", () => {
  const ROOT_DIR = path.resolve("/fake/project");
  const SUB_DIR = path.join(ROOT_DIR, "sub");
  const DEEP_DIR = path.join(SUB_DIR, "deep");
  const NAME = "AGENTS.md";

  /** 只让 `paths` 里的文件存在，内容取 `contents`。 */
  const setTree = (contents: Record<string, string>) => {
    fsStub.existsImpl = (filePath) => filePath in contents;
    fsStub.readImpl = (filePath) => contents[filePath]!;
  };

  it("从当前目录往上收集，结果根在前；上界是会话工作根", async () => {
    setTree({
      [path.join(ROOT_DIR, NAME)]: "root",
      [path.join(SUB_DIR, NAME)]: "sub",
    });
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.fs.ancestors({ names: ["${NAME}"], of: "sub/deep" });
        });
      };
      `,
      {
        host: host({
          workdir: vi.fn(() => ROOT_DIR),
          workspaceRoot: vi.fn(() => ROOT_DIR),
        }),
      },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = result.value as Array<{
      dir: string;
      name: string;
      content: string;
    }>;
    expect(found.map((item) => item.content)).toEqual(["root", "sub"]);
    expect(found.map((item) => item.dir)).toEqual([ROOT_DIR, SUB_DIR]);
    expect(found.every((item) => item.name === NAME)).toBe(true);
  });

  it("起点在工作根之外当场报错（不让插件顺着文件系统往上跑）", async () => {
    setTree({});
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          try {
            await $.fs.ancestors({ names: ["${NAME}"], of: "../../elsewhere" });
            return "no-error";
          } catch (e) {
            return e.message;
          }
        });
      };
      `,
      {
        host: host({
          workdir: vi.fn(() => DEEP_DIR),
          workspaceRoot: vi.fn(() => SUB_DIR),
        }),
      },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(String(result.value)).toContain("不在");
  });

  it("一份读不动就跳过它，其余照给（不让一个不可读的父目录毁掉整条链）", async () => {
    const broken = path.join(SUB_DIR, NAME);
    fsStub.existsImpl = () => true;
    fsStub.readImpl = (filePath) => {
      if (filePath === broken) throw new Error("EACCES");
      return "root";
    };
    const { mod } = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          return await $.fs.ancestors({ names: ["${NAME}"], of: "sub" });
        });
      };
      `,
      {
        host: host({
          workdir: vi.fn(() => ROOT_DIR),
          workspaceRoot: vi.fn(() => ROOT_DIR),
        }),
      },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value as Array<{ dir: string }>).map((item) => item.dir),
    ).toEqual([ROOT_DIR]);
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

  it("next.event 是这次派发的事件名；next.is 认 on() 认的那套模式", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("classic.PreToolUse", function (e, next) {
          return {
            event: next.event,
            own: next.is("classic.PreToolUse", e),
            other: next.is("classic.PostToolUse", e),
            glob: next.is("classic.*", e),
          };
        });
      };
    `);

    await mod.load();
    await expect(
      mod.callHook("classic.PreToolUse", { tool_name: "Bash" }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        event: "classic.PreToolUse",
        own: true,
        other: false,
        glob: true,
      },
    });
  });

  it('next.is 不认我们在派发侧还不支持的模式（"*" / 别的 glob / 取反），当场报错', async () => {
    // 认下来但派发侧不支持 = 让 mod 静默跳过自己该管的活；答 false 也一样难查。
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function (e, next) {
          var out = [];
          ["*", "tool.*", "!tool.*", "nope.event"].forEach(function (pattern) {
            try {
              next.is(pattern, e);
              out.push(pattern + ":no-error");
            } catch (err) {
              out.push(pattern + ":" + (err.message.indexOf("只认 on() 也认的模式") !== -1 ? "refused" : "other"));
            }
          });
          return out.join(" | ");
        });
      };
    `);

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value:
        "*:refused | tool.*:refused | !tool.*:refused | nope.event:refused",
    });
  });

  it("next.origin：引擎发起是 {engine, core}，callHook 能把发起者换掉", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", function (e, next) {
          return next.origin;
        });
      };
    `);

    await mod.load();
    await expect(mod.callHook("session.start", {})).resolves.toMatchObject({
      ok: true,
      value: { plugin: "engine", tier: "core" },
    });
    await expect(
      mod.callHook(
        "session.start",
        {},
        {
          origin: { plugin: "todo", tier: "user" },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { plugin: "todo", tier: "user" },
    });
  });

  it("$.tool.check / $.tool.call 把自己的身份交给宿主（origin 的第二实参）", async () => {
    const { mod, host: hostApi } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function () {
          await $.tool.check({ tool: "Bash" });
          await $.tool.call({ tool: "Bash" });
        });
      };
    `);

    await mod.load();
    await mod.callHook("session.start", {});
    // 发起者是**这个 mod**（tier 是我们唯一的那一层 user），不是引擎。
    expect(hostApi.checkTool).toHaveBeenCalledWith(
      { tool: "Bash" },
      { plugin: "todo", tier: "user" },
    );
    expect(hostApi.callTool).toHaveBeenCalledWith(
      { tool: "Bash" },
      { plugin: "todo", tier: "user" },
    );
  });

  it("next.budget 是这一层自己的额度：next() 串到另一个 mod 时它拿到新的一份满额", async () => {
    vi.useFakeTimers();
    // 睡眠走宿主（沙箱里没有 setTimeout）：`.sleep` 不暂停本层预算，所以它真的
    // 从这层的 5 秒里扣时间。
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const outer = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function (e, next) {
          var started = next.budget.remainingMs;
          await $.clock.sleep(3000);
          var spent = next.budget.remainingMs;
          var inner = await next(e);
          return { started: started, spent: spent, inner: inner };
        });
      };
    `,
      { host: host({ sleep }) },
    );
    const inner = runtime(`
      exports.register = function ($, on) {
        on("session.start", function (e, next) {
          return { ms: next.budget.ms, remainingMs: next.budget.remainingMs };
        });
      };
    `);

    await outer.mod.load();
    await inner.mod.load();
    const pending = outer.mod.callHook(
      "session.start",
      {},
      {
        engine: async () => inner.mod.callHook("session.start", {}),
      },
    );
    await vi.advanceTimersByTimeAsync(3000);

    const answer = await pending;
    expect(answer.ok).toBe(true);
    const seen = answer.ok
      ? (answer.value as {
          started: number;
          spent: number;
          inner: { ok: boolean; value: { ms: number; remainingMs: number } };
        })
      : undefined;
    // 外层那份在自己的 handler 里是真的在走：睡了 3 秒，读数掉了。
    expect(seen?.started).toBe(MOD_LIMITS.hookTimeoutMs);
    expect(seen?.spent).toBeGreaterThan(0);
    expect(seen?.spent).toBeLessThan(MOD_LIMITS.hookTimeoutMs);
    // 每层各一份：内层读到的仍是完整的一份 5 秒，不是外层扣剩下的。
    expect(seen?.inner.value.ms).toBe(MOD_LIMITS.hookTimeoutMs);
    expect(seen?.inner.value.remainingMs).toBe(MOD_LIMITS.hookTimeoutMs);
  });

  it("next() 在飞时本层停表：外层 3 秒 + 内层 3 秒，两层都不超时", async () => {
    vi.useFakeTimers();
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const outer = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function (e, next) {
          await $.clock.sleep(3000);
          return next(e);
        });
      };
    `,
      { host: host({ sleep }) },
    );
    const inner = runtime(
      `
      exports.register = function ($, on) {
        on("session.start", async function () {
          await $.clock.sleep(3000);
          return { done: true };
        });
      };
    `,
      { host: host({ sleep }) },
    );

    await outer.mod.load();
    await inner.mod.load();
    let nested: Awaited<ReturnType<typeof inner.mod.callHook>> | undefined;
    const pending = outer.mod.callHook(
      "session.start",
      {},
      {
        engine: async () => {
          nested = await inner.mod.callHook("session.start", {});
          return nested;
        },
      },
    );
    // 外层睡 3 秒 → 交棒时停表；内层自己再睡 3 秒 = 自己的钟只走了 3 秒。
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    // 整条链走了 6 秒，越过一个 5 秒 —— 但没有哪一层自己被扣满 5 秒。
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(nested).toMatchObject({ ok: true });
  });

  it("next.trace 是这条链上已经跑完的层（只读快照，外层能看到内层）", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function (e, next) {
          var before = next.trace.length;
          await next(e);
          var after = next.trace;
          return {
            before: before,
            size: after.length,
            frozenArray: Object.isFrozen(after),
            entry: after[0],
          };
        });
        on("session.start", function (e, next) {
          return { innerSees: next.trace.length };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result).toMatchObject({
      ok: true,
      value: {
        before: 0,
        size: 1,
        frozenArray: true,
        entry: {
          index: 0,
          plugin: "todo",
          tier: "user",
          event: "session.start",
          outcome: "returned",
        },
      },
    });
    if (result.ok) {
      const entry = (result.value as { entry: { ms: number } }).entry;
      expect(entry.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("next.trace 的 outcome：下面那层抛了没人接是 rejected，接了是 caught", async () => {
    const rejected = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function (e, next) {
          try {
            await next(e);
            return { message: "no-error" };
          } catch (err) {
            return { message: err.message, outcome: next.trace[0].outcome };
          }
        });
        on("session.start", function () {
          throw new Error("boom");
        });
      };
    `);

    await rejected.mod.load();
    await expect(
      rejected.mod.callHook("session.start", {}),
    ).resolves.toMatchObject({
      ok: true,
      value: { message: "boom", outcome: "rejected" },
    });

    const caught = runtime(`
      exports.register = function ($, on) {
        on("session.start", async function (e, next) {
          await next(e);
          return { outcome: next.trace[0].outcome };
        });
        on("session.start", function () {
          throw new Error("boom");
        }).catch(function () {
          return { rescued: true };
        });
      };
    `);

    await caught.mod.load();
    await expect(
      caught.mod.callHook("session.start", {}),
    ).resolves.toMatchObject({
      ok: true,
      value: { outcome: "caught" },
    });
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
    // 事件的实例 id 就是 CC 钩子里的 `requestId`（不是 `ui_render` 消息里的
    // `instance_id`：社区写的 `if (e.requestId !== PANE_ID)` 要能直接读到）。
    const band = await mod.callHook("ui.render", { component: "AbovePrompt" });
    expect(band.ok && band.value).toMatchObject({ children: ["band"] });
    const todo = await mod.callHook("ui.render", {
      component: "Pane",
      requestId: "todo",
    });
    expect(todo.ok && todo.value).toMatchObject({ children: ["pane-todo"] });
    const other = await mod.callHook("ui.render", {
      component: "Pane",
      requestId: "other",
    });
    expect(other.ok && other.value).toMatchObject({ children: ["pane-other"] });
    // 工具名不在候选里 ⇒ 这条钩子根本不参与这次事件（与 Claude Code 一样：
    // matcher 不命中就等于没注册）。
    const bash = await mod.callHook("tool.call", { tool: "Bash" });
    expect(bash).toMatchObject({ ok: true, value: undefined });
    const edit = await mod.callHook("tool.call", { tool: "Edit" });
    expect(edit.ok && edit.value).toEqual({ saw: "Edit" });
  });

  it("matcher 也认 ui.press / ui.input / ui.select 的 plugin 与 element", async () => {
    // Claude Code 的写法是 `on("ui.press", { plugin, element }, …)`：带 matcher 的
    // 这三个钩子不能被「这个事件不接受 matcher」拒掉，否则社区 mod 的处理器整条
    // 消失（不是「参与了但没匹配上」，是连注册都没了）。
    const { mod } = runtime(`
      exports.register = function (on) {
        on("ui.press", { plugin: "todo", element: "run" }, function ($, e) {
          return { hit: "press", value: e.element };
        });
        on("ui.input", { plugin: "todo", element: "title" }, function ($, e) {
          return { hit: "input", value: e.value };
        });
        on("ui.select", { plugin: "todo", element: "size" }, function ($, e) {
          return { hit: "select", value: e.value };
        });
      };
    `);

    await mod.load();
    const press = await mod.callHook("ui.press", {
      plugin: "todo",
      element: "run",
    });
    expect(press.ok && press.value).toEqual({ hit: "press", value: "run" });
    const input = await mod.callHook("ui.input", {
      plugin: "todo",
      element: "title",
      kind: "submit",
      value: "周报",
    });
    expect(input.ok && input.value).toEqual({ hit: "input", value: "周报" });
    const select = await mod.callHook("ui.select", {
      plugin: "todo",
      element: "size",
      value: "lg",
    });
    expect(select.ok && select.value).toEqual({ hit: "select", value: "lg" });
    // 别的插件画的控件不归它：matcher 不命中就是没注册。
    const other = await mod.callHook("ui.press", {
      plugin: "roster",
      element: "run",
    });
    expect(other).toMatchObject({ ok: true, value: undefined });
  });

  it("handler 里的实例 id 就是 CC 的 requestId（事件里没有 instance_id 这个名字）", async () => {
    // 官方 `blast-radius` 的第一行就是 `if (e.requestId !== PANE_ID) return next(e)`。
    // 信封与 CC 一字不差：`{ surface, component, requestId, plugin, viewport, props }`
    // —— 早先那个 `instance_id`（`ui_render` **消息**里的写法）已经去掉，同一个值
    // 只留一个名字。
    const { mod } = runtime(`
      exports.register = function (on) {
        on("ui.render", { component: "Pane" }, function ($, e) {
          return __wave.h("Text", null, Object.keys(e).sort().join(",") + ":" + e.requestId);
        });
      };
    `);

    await mod.load();
    const mine = await mod.callHook("ui.render", {
      surface: "vscode",
      component: "Pane",
      requestId: "blast-radius",
      plugin: "todo",
      viewport: { columns: 120, rows: 40, isFullscreen: true },
      props: { bodyColumns: 66 },
    });
    expect(mine.ok && mine.value).toMatchObject({
      children: [
        "component,plugin,props,requestId,surface,viewport:blast-radius",
      ],
    });
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

  it("tool.call 的 next(e) 就是执行本身：拿得到工具结果，next.signal 是 AbortSignal", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("tool.call", { tool: "Bash" }, async function ($, e, next) {
          var isSignal = next.signal instanceof AbortSignal;
          var ran = await next(e);
          return { isSignal: isSignal, out: ran.stdout };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook(
      "tool.call",
      { tool: "Bash" },
      { engine: async () => ({ stdout: "hello" }) },
    );
    // `const ran = await next(e)` 之后读 `ran` 是社区的标准写法（CC 里
    // `next(e)` resolve 出来的就是工具结果），所以链尾必须把结果交回来。
    expect(result).toMatchObject({
      ok: true,
      value: { isSignal: true, out: "hello" },
    });
  });

  it("我们的形状 (e, next) 也拿到 next：next(e) 就是执行，拿得到工具结果", async () => {
    const { mod } = runtime(`
      exports.register = function ($, on) {
        on("tool.call", { tool: "Bash" }, async function (e, next) {
          var isSignal = next.signal instanceof AbortSignal;
          var ran = await next(e);
          return { isSignal: isSignal, out: ran.stdout };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook(
      "tool.call",
      { tool: "Bash" },
      { engine: async () => ({ stdout: "hello" }) },
    );
    // 第二个形参是后来补的：没有它，按我们推荐写法写的守卫只能看见调用、
    // 看不见结果（`tool.call` 里「工具跑完之后」那几行就写不了）。
    expect(result).toMatchObject({
      ok: true,
      value: { isSignal: true, out: "hello" },
    });
  });

  it(".catch 的 next 带 called / error：调过就重放那次结果，不把下面的链再跑一遍", async () => {
    const engine = vi.fn(async () => ({ stdout: "hello" }));
    const { mod } = runtime(`
      exports.register = function (on) {
        on("tool.call", { tool: "Bash" }, async function ($, e, next) {
          await next(e);
          throw new Error("refresh failed");
        }).catch(async function ($, e, next) {
          var again = await next(e);
          return { called: next.called, reason: next.error.message, again: again.stdout };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook(
      "tool.call",
      { tool: "Bash" },
      { engine },
    );
    expect(engine).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      value: { called: true, reason: "refresh failed", again: "hello" },
    });
  });

  it(".catch 里没调过 next 时 called === false（社区 fail-closed 写法的判据）", async () => {
    const engine = vi.fn(async () => ({ stdout: "hello" }));
    const { mod } = runtime(`
      exports.register = function (on) {
        on("tool.call", { tool: "Bash" }, async function () {
          throw new Error("guard broke");
        }).catch(async function ($, e, next) {
          // CC 里这条惯用法就是「还没跑过就别跑，直接拒掉」。
          return next.called ? next(e) : { deny: "guard 自己坏了" };
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook(
      "tool.call",
      { tool: "Bash" },
      { engine },
    );
    expect(engine).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      value: { deny: "guard 自己坏了" },
      elapsedMs: expect.any(Number),
    });
  });

  it("$.ui.ask 把问题与选项交给宿主：缺省补「是 / 否」，header 缺省是插件名并截到 12", async () => {
    const asks: unknown[][] = [];
    const hostApi = host({
      pluginName: "blast-radius-guard",
      askUser: vi.fn(async (...args: unknown[]) => {
        asks.push(args);
        return "允许一次";
      }),
    });
    const { mod } = runtime(
      `
      exports.register = function (on) {
        on("session.start", async function ($) {
          var one = await $.ui.ask("要跑 rm -rf 吗？");
          var two = await $.ui.ask("选一个", { options: ["A", "B"], header: "blast" });
          return { one: one, two: two };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result).toMatchObject({
      ok: true,
      value: { one: "允许一次", two: "允许一次" },
    });
    // 第一个参数的 `question` 被摘出去了，宿主只拿「正文 + 形状」。
    expect(asks[0]).toEqual([
      "要跑 rm -rf 吗？",
      { labels: ["是", "否"], header: "blast-radius" },
    ]);
    expect(asks[1]).toEqual([
      "选一个",
      { labels: ["A", "B"], header: "blast" },
    ]);
  });

  it("$.ui.ask 的非法参数当场报错（空问题 / 超过四个 / 重复 / multiSelect 非 true）", async () => {
    const { mod } = runtime(`
      exports.register = function (on) {
        on("session.start", async function ($) {
          var errors = [];
          try { await $.ui.ask("   "); } catch (e) { errors.push(String(e.message)); }
          try { await $.ui.ask("q", ["1", "2", "3", "4", "5"]); } catch (e) { errors.push(String(e.message)); }
          try { await $.ui.ask("q", ["A", "A"]); } catch (e) { errors.push(String(e.message)); }
          try { await $.ui.ask("q", { options: ["A"], multiSelect: "yes" }); } catch (e) { errors.push(String(e.message)); }
          return errors;
        });
      };
    `);

    await mod.load();
    const result = await mod.callHook("session.start", {});
    // 逐条报出原因：拼错的关键字静默当成「没有选项」比报错更难查。
    expect(result).toMatchObject({
      ok: true,
      value: [
        expect.stringContaining("需要一个问题"),
        expect.stringContaining("最多四个选项"),
        expect.stringContaining("选项重复了：A"),
        expect.stringContaining("multiSelect 只能是 true"),
      ],
    });
  });

  it("$.ui.ask 宿主拒绝时 mod 收到 reject（不吞成空串）", async () => {
    const hostApi = host({
      askUser: vi.fn(async () => {
        throw new Error("没有人能回答这个问题");
      }),
    });
    const { mod } = runtime(
      `
      exports.register = function (on) {
        on("session.start", async function ($) {
          try {
            await $.ui.ask("q");
            return { caught: false };
          } catch (e) {
            return { caught: true, message: e.message };
          }
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    // 拒绝必须能让 mod 看见 —— guard 拿到「问不到」就要按拒掉处理。
    expect(result).toMatchObject({
      ok: true,
      value: { caught: true, message: "没有人能回答这个问题" },
    });
  });

  it("'claude-code' 是 wave-agent-sdk/mods 的别名，atom/read/update 落在 $.store 上", async () => {
    const store = new Map<string, unknown>();
    const hostApi = host({
      storeGet: vi.fn((key: string) => store.get(key)),
      storeSet: vi.fn((key: string, value: unknown) => {
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
          return { before: before.length, after: after.length, tag: cc.Box.elementType };
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

  it("atom 兼容旧版存进去的 JSON 文本，解析不了就原样给", async () => {
    const values = new Map<string, unknown>([
      // 旧版 `$.store` 只收字符串，atom 存进去的是 `JSON.stringify(["seed"])`。
      ["p/legacy", '["seed"]'],
      ["p/plain", "not json"],
    ]);
    const hostApi = host({ storeGet: vi.fn((key: string) => values.get(key)) });
    const { mod } = runtime(
      `
      var cc = require("claude-code");
      var legacy = cc.atom({ plugin: "p", key: "legacy" }, ["fallback"]);
      var plain = cc.atom({ plugin: "p", key: "plain" }, ["fallback"]);
      exports.register = function (on) {
        on("session.start", async function ($) {
          return {
            legacy: await cc.read($, legacy),
            plain: await cc.read($, plain),
          };
        });
      };
      `,
      { host: hostApi },
    );

    await mod.load();
    const result = await mod.callHook("session.start", {});
    expect(result).toMatchObject({
      ok: true,
      value: { legacy: ["seed"], plain: "not json" },
    });
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
