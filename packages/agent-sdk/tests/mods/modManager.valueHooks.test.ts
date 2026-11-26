import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModManager } from "../../src/managers/modManager.js";
import { logger } from "../../src/utils/globalLogger.js";
import { MOD_LIMITS } from "../../src/types/mods.js";
import type { ModStatusPayload } from "../../src/types/mods.js";
import type { Plugin } from "../../src/types/plugins.js";

/**
 * 「value 型」钩子链（`runValueHookChain`）的语义：`next(e)` 之后外层**还能改**，
 * 链尾是宿主原本的值。这是与 `tool.call` 那条 deny 型链的分界 —— 守卫替用户
 * 裁决完（工具已经跑掉）之后外层的返回值不再算数，value 型不能丢。
 *
 * 九条钩子共用这一条链，所以这里挑三条代表（`tool.check` 三档 / `prompt.section`
 * `{ text }` / `session.append` `{ deny }`）测机制本身；各自的归一化细节在上游
 * （`aiManager.promptHooks` / `permissionManager.toolCheck` / `messageManager.sessionAppend`）
 * 与 spec 的验收场景里覆盖。
 */

const probe = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/esbuild.js", () => ({
  getEsbuild: () => ({
    transform: vi.fn(async (source: string) => ({ code: source })),
  }),
  releaseEsbuild: () => {},
}));

vi.mock("../../src/utils/atomicWrite.js", () => ({
  atomicWriteFileSync: vi.fn((file: string, data: string) => {
    probe.files.set(file, data);
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((file: string) => {
      const content = probe.files.get(file);
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      }
      return content;
    }),
    mkdirSync: vi.fn(),
  };
});

const ROOT = path.resolve("/fake/value-plugin");
const STORE_ROOT = path.resolve("/fake/value-store");

function modPath(name: string): string {
  return path.join(ROOT, "mods", `${name}.tsx`);
}

function plugin(mods: Array<{ id: string; path: string }>): Plugin {
  return {
    name: "value",
    path: ROOT,
    mods: mods.map((mod) => ({
      ...mod,
      name: path.basename(mod.path),
      pluginRoot: ROOT,
    })),
  } as unknown as Plugin;
}

/** 把若干段 mod 源码装进一个 manager；顺序就是钩子链的顺序。 */
async function createManager(
  sources: string[],
): Promise<{ manager: ModManager; statuses: ModStatusPayload[] }> {
  probe.files.clear();
  const mods = sources.map((source, index) => {
    const id = `value:mod${index}`;
    const file = modPath(`mod${index}`);
    probe.files.set(file, source);
    return { id, path: file };
  });
  const statuses: ModStatusPayload[] = [];
  const manager = new ModManager({
    sessionId: "s1",
    onPanelUpdate: () => {},
    onStatus: (payload) => statuses.push(payload),
    storeRoot: STORE_ROOT,
  });
  await manager.loadFromPlugins([plugin(mods)]);
  await manager.startSession();
  return { manager, statuses };
}

const managers: ModManager[] = [];

afterEach(async () => {
  for (const manager of managers) await manager.dispose();
  managers.length = 0;
  vi.clearAllMocks();
});

async function managerOf(sources: string[]) {
  const created = await createManager(sources);
  managers.push(created.manager);
  return created;
}

describe("value 型钩子链", () => {
  it("一个 mod 改写就生效：prompt.section 返回 { text } 换掉这一段", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("prompt.section", function ($, e) { return { text: e.text + "（改过）" }; });
      };
      `,
    ]);

    await expect(
      manager.collectPromptSection({
        id: "tone",
        text: "默认语气",
        scope: "session",
      }),
    ).resolves.toBe("默认语气（改过）");
  });

  it("next(e) 之后外层还能改：里外两层的改写都算数（deny 型链做不到这一点）", async () => {
    const { manager } = await managerOf([
      // 先注册的在链的更前面：它调 next 拿到内层的结果，再往后接一段。
      `
      exports.register = function (on) {
        on("prompt.section", async function ($, e, next) {
          var inner = await next(e);
          return { text: inner.text + "|外层" };
        });
      };
      `,
      `
      exports.register = function (on) {
        on("prompt.section", async function ($, e, next) {
          var inner = await next(e);
          return { text: inner.text + "|内层" };
        });
      };
      `,
    ]);

    await expect(
      manager.collectPromptSection({
        id: "tone",
        text: "原文",
        scope: "session",
      }),
    ).resolves.toBe("原文|内层|外层");
  });

  it("改事件也能改值：next({ ...e, text }) 之后下游没有别的 mod，改写照样生效", async () => {
    const { manager } = await managerOf([
      // spec 给 `session.append` 的改写通道就是 `next({ ...e, message })`：
      // 链尾必须按**链尾收到的那份事件**取值，否则下游没人注册时这条通道是死的。
      `
      exports.register = function (on) {
        on("session.append", async function ($, e, next) {
          var masked = { ...e.message, content: [{ type: "text", text: "脱敏后" }] };
          var r = await next({ ...e, message: masked });
          return { message: r.message, uuid: r.uuid };
        });
      };
      `,
    ]);

    const out = await manager.dispatchSessionAppend(
      {
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "原话" }],
      },
      "prompt",
    );
    expect(out.message.content).toEqual([{ type: "text", text: "脱敏后" }]);
  });

  it("超时且下游没跑完：按宿主原值继续，不把 undefined 当结果交出去", async () => {
    // 外层预算盖住 `next()` 里的整条下游链：每层 200ms、预算 300ms，外层到期时
    // `next` 还没返回。这条路径以前会把 `undefined as T` 返回给宿主，
    // `prompt.section` 的消费点读 `result.text` 直接 TypeError。
    // 每层都调 next：不调 next 会截断链，只有一个 mod 跑 200ms 根本到不了 300ms。
    // `MOD_LIMITS` 是 `as const`（类型只读、运行时可变）：把 5s 的预算压到 300ms，
    // 让这条用例在 0.6s 内走到超时分支，而不是真等两个 2.6s。
    const limits = MOD_LIMITS as unknown as { hookTimeoutMs: number };
    const budget = limits.hookTimeoutMs;
    limits.hookTimeoutMs = 300;
    const slow = `
      exports.register = function (on) {
        on("prompt.section", async function ($, e, next) {
          var r = await next(e);
          await $.clock.sleep(200);
          return r;
        });
      };
      `;
    try {
      const { manager } = await managerOf([
        `
        exports.register = function (on) {
          on("prompt.section", async function ($, e, next) {
            var inner = await next(e);
            return { text: inner.text };
          });
        };
        `,
        slow,
        slow,
      ]);

      await expect(
        manager.collectPromptSection({
          id: "tone",
          text: "原文",
          scope: "session",
        }),
      ).resolves.toBe("原文");
    } finally {
      limits.hookTimeoutMs = budget;
    }
  });

  it("谁都没改：拿到的就是宿主原本的值（逐字相同，缓存前缀不受影响）", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("prompt.section", async function ($, e, next) { await next(e); });
      };
      `,
    ]);

    await expect(
      manager.collectPromptSection({
        id: "tone",
        text: "一字未变",
        scope: "session",
      }),
    ).resolves.toBe("一字未变");
  });

  it("一个 mod 抛错：跳过它、其余照跑（fail-open，不让链卡住）", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("prompt.section", function () { throw new Error("炸了"); });
      };
      `,
      `
      exports.register = function (on) {
        on("prompt.section", function ($, e) { return { text: e.text + "|后面的还在" }; });
      };
      `,
    ]);

    await expect(
      manager.collectPromptSection({
        id: "tone",
        text: "原文",
        scope: "session",
      }),
    ).resolves.toBe("原文|后面的还在");
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("炸了"),
    );
  });

  it("tool.check：三个方向都算数，放宽（deny → allow）也被接受", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("tool.check", { tool: "mcp__own__voice" }, function () {
          return { decision: "allow", reason: "自家工具不用问" };
        });
      };
      `,
    ]);

    await expect(
      manager.dispatchToolCheck({
        tool: "mcp__own__voice",
        tool_use_id: "t1",
        input: {},
        decision: "deny",
        reason: "denied_by_rule",
      }),
    ).resolves.toEqual({ decision: "allow", reason: "自家工具不用问" });
  });

  it("tool.check：非法 decision 按拒绝处理并记一条 warn", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("tool.check", function () { return { decision: "sure" }; });
      };
      `,
    ]);

    await expect(
      manager.dispatchToolCheck({
        tool: "Bash",
        tool_use_id: "t1",
        input: { command: "ls" },
        decision: "ask",
        reason: "宿主自己的理由",
      }),
    ).resolves.toEqual({
      decision: "deny",
      reason: "tool.check returned no valid decision",
    });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining("不合法的 decision"),
    );
  });

  it("matcher 按字段分流：prompt.section 只叫 name 匹配的那一段", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("prompt.section", { name: "memory" }, function () {
          return { text: "记忆段被换了" };
        });
      };
      `,
    ]);

    await expect(
      manager.collectPromptSection({
        id: "memory",
        text: "原记忆",
        scope: "session",
      }),
    ).resolves.toBe("记忆段被换了");
    await expect(
      manager.collectPromptSection({
        id: "tone",
        text: "原语气",
        scope: "session",
      }),
    ).resolves.toBe("原语气");
  });

  it("session.append：返回里的 uuid 就是 message.id，deny 时原样带回来", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("session.append", async function ($, e, next) {
          var r = await next(e);
          if (e.message.content[0].text === "丢弃我") {
            return { message: r.message, uuid: r.uuid, deny: "脱敏失败" };
          }
          return { message: r.message, uuid: r.uuid };
        });
      };
      `,
    ]);

    const kept = await manager.dispatchSessionAppend(
      {
        id: "m1",
        role: "user",
        content: [{ type: "text", text: "留着" }],
      },
      "prompt",
    );
    expect(kept.uuid).toBe("m1");
    expect(kept.deny).toBeUndefined();

    const dropped = await manager.dispatchSessionAppend(
      {
        id: "m2",
        role: "user",
        content: [{ type: "text", text: "丢弃我" }],
      },
      "prompt",
    );
    expect(dropped).toMatchObject({ uuid: "m2", deny: "脱敏失败" });
  });

  it("prompt.context：{ blocks } 交下去也收回来，裸字符串按 context 收", async () => {
    const { manager } = await managerOf([
      `
      exports.register = function (on) {
        on("prompt.context", async function ($, e, next) {
          var r = await next(e);
          return { blocks: r.blocks.concat([{ name: "lcm", text: "对象块" }, "裸字符串"]) };
        });
      };
      `,
    ]);

    await expect(manager.collectSessionContextBlocks()).resolves.toEqual([
      { name: "lcm", text: "对象块" },
      { name: "context", text: "裸字符串" },
    ]);
  });

  it("classic.* 一次订阅全部镜像：每个 classic 事件都进同一个 handler", async () => {
    const { manager, statuses } = await managerOf([
      `
      exports.register = function (on) {
        on("classic.*", function ($, e) { $.ui.status(e.hook_event_name); });
      };
      `,
    ]);

    manager.notifyMods("classic.SessionStart", {
      hook_event_name: "SessionStart",
      session_id: "s1",
      transcript_path: "",
      cwd: ROOT,
      permission_mode: "default",
      source: "startup",
    });
    manager.notifyMods("classic.Stop", {
      hook_event_name: "Stop",
      session_id: "s1",
      transcript_path: "",
      cwd: ROOT,
      permission_mode: "default",
      background_tasks: [],
      stop_hook_active: false,
    });

    await vi.waitFor(() => {
      expect(statuses.map((item) => JSON.stringify(item))).toHaveLength(2);
    });
    expect(JSON.stringify(statuses)).toContain("SessionStart");
    expect(JSON.stringify(statuses)).toContain("Stop");
  });
});
