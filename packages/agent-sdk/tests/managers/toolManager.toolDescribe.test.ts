import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { Container } from "../../src/utils/container.js";
import { logger } from "../../src/utils/globalLogger.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { ToolPlugin } from "../../src/tools/types.js";

/**
 * `tool.describe`（spec ecosystem/plugin-mods.md「给工具、技能、命令写描述」）：
 * 插件换掉模型读到的工具说明文字，也可以裁决这个工具平铺还是藏进 `Exec` 池。
 *
 * 纪律在这里钉住：
 *  - 组装请求**之前** `await prepareToolDescriptions()`，答案同一次请求就生效；
 *  - 同一个工具**每场会话只问一次**（`breakPromptCache` / `invalidate` 是仅有的
 *    重问口），所以稳态下缓存前缀不会被反复改写。
 *
 * 「一轮」按 `MessageManager.countUserTurns()` 认 —— 假 MessageManager 直接给
 * 这个数，测试就是在翻它。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const BASE_DESCRIPTION = "宿主的描述";

type DescribeAnswer =
  | string
  | {
      description?: string;
      isDeferred?: boolean;
      breakPromptCache?: boolean;
    };

interface ToolSpec {
  name: string;
  description: string;
  /** 工具自己的延迟声明（`ToolPlugin.defer`）。 */
  defer?: boolean;
}

function build(
  options: {
    /** 插件改写的结果；不给就是「原样返回」。 */
    describe?: (request: {
      name: string;
      description: string;
    }) => DescribeAnswer | undefined;
    /** 不接 ModManager（独立使用 ToolManager 的调用方）。 */
    withoutModManager?: boolean;
    /** 注册一个 `Exec` 工具（池的载体）。 */
    withExec?: boolean;
    /** 注册哪些工具，缺省是 `FakeTool` + `OtherTool`。 */
    tools?: ToolSpec[];
  } = {},
) {
  const container = new Container();
  const turns = { value: 1 };

  container.register("PermissionManager", {
    isToolDenied: vi.fn().mockReturnValue(false),
    getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
  });
  container.register("McpManager", {
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
  } as unknown as McpManager);
  container.register("MessageManager", {
    countUserTurns: () => turns.value,
  } as unknown as MessageManager);

  // 钩子的回执是对象（CC 同形：`description` + 可选 `isDeferred` /
  // `breakPromptCache`），不是一段字符串。
  const collectToolDescription = vi.fn(
    async (request: { name: string; description: string }) => {
      const answer = options.describe?.(request);
      if (answer === undefined) return { description: request.description };
      if (typeof answer === "string") return { description: answer };
      return {
        description: answer.description ?? request.description,
        ...(answer.isDeferred === undefined
          ? {}
          : { isDeferred: answer.isDeferred }),
        ...(answer.breakPromptCache === true ? { breakPromptCache: true } : {}),
      };
    },
  );
  if (!options.withoutModManager) {
    container.register("ModManager", {
      collectToolDescription,
    } as unknown as ModManager);
  }

  const toolManager = new ToolManager({ container });
  const register = (spec: ToolSpec) => {
    toolManager.register({
      name: spec.name,
      config: {
        type: "function",
        function: {
          name: spec.name,
          description: spec.description,
          parameters: {},
        },
      } as ToolPlugin["config"],
      prompt: () => spec.description,
      ...(spec.defer === undefined ? {} : { defer: spec.defer }),
      execute: vi.fn(),
    });
  };
  for (const spec of options.tools ?? [
    { name: "FakeTool", description: BASE_DESCRIPTION },
    { name: "OtherTool", description: "另一个工具的描述" },
  ]) {
    register(spec);
  }
  if (options.withExec) {
    register({ name: "Exec", description: "沙箱" });
  }

  return { toolManager, collectToolDescription, turns };
}

function descriptions(toolManager: ToolManager): Record<string, string> {
  return Object.fromEntries(
    toolManager
      .getToolsConfig()
      .map((tool) => [tool.function.name, tool.function.description ?? ""]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool.describe", () => {
  it("组装前 await 一次：这一次请求就用插件改过的描述", async () => {
    const { toolManager, collectToolDescription } = build({
      describe: ({ description }) => `${description}（插件改过）`,
    });

    // 会话里已经拼过一次表（`/context` 的估算、上一轮请求……）：先让快照按旧
    // 口径定下来，再由预热改口，才能证明「同轮生效」不是靠下一次翻轮次。
    expect(descriptions(toolManager)).toEqual({
      FakeTool: BASE_DESCRIPTION,
      OtherTool: "另一个工具的描述",
    });

    await toolManager.prepareToolDescriptions();
    const first = descriptions(toolManager);
    const second = descriptions(toolManager);

    expect(collectToolDescription).toHaveBeenCalledTimes(2);
    expect(first).toEqual({
      FakeTool: `${BASE_DESCRIPTION}（插件改过）`,
      OtherTool: "另一个工具的描述（插件改过）",
    });
    // 同轮多次拼 schema 读到的是同一份，也不会重问。
    expect(second).toEqual(first);
    expect(collectToolDescription).toHaveBeenCalledTimes(2);
  });

  it("描述是会话级缓存：翻到下一轮也不重问", async () => {
    const { toolManager, turns, collectToolDescription } = build({
      describe: ({ description }) => `${description}（插件改过）`,
    });

    await toolManager.prepareToolDescriptions();

    // 用户发了下一句：新一轮。
    turns.value = 2;
    const next = descriptions(toolManager);

    expect(next).toEqual({
      FakeTool: `${BASE_DESCRIPTION}（插件改过）`,
      OtherTool: "另一个工具的描述（插件改过）",
    });
    expect(collectToolDescription).toHaveBeenCalledTimes(2);
  });

  it("同一个工具每场会话只问一次：多轮 prepare 也不重问", async () => {
    const { toolManager, collectToolDescription, turns } = build();
    const describeOf = (name: string) =>
      collectToolDescription.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === name,
      ).length;

    await toolManager.prepareToolDescriptions();
    await toolManager.prepareToolDescriptions();
    turns.value = 2;
    await toolManager.prepareToolDescriptions();

    expect(describeOf("FakeTool")).toBe(1);
    expect(describeOf("OtherTool")).toBe(1);
  });

  it("没接 ModManager 时照旧用宿主自己的描述", async () => {
    const { toolManager, collectToolDescription } = build({
      withoutModManager: true,
    });

    await toolManager.prepareToolDescriptions();

    expect(descriptions(toolManager)).toEqual({
      FakeTool: BASE_DESCRIPTION,
      OtherTool: "另一个工具的描述",
    });
    expect(collectToolDescription).not.toHaveBeenCalled();
  });
});

describe("tool.describe 的 isDeferred（平铺 / 进 Exec 池）", () => {
  it("true 把一个平铺的内置工具翻进池：tools[] 只剩 Exec，池里有它", async () => {
    const { toolManager } = build({
      withExec: true,
      tools: [{ name: "FlatTool", description: "本来是平铺的" }],
      describe: (request) =>
        request.name === "FlatTool" ? { isDeferred: true } : undefined,
    });

    await toolManager.prepareToolDescriptions();

    expect(descriptions(toolManager)).toEqual({ Exec: "沙箱" });
    expect(toolManager.getExecPool().map((entry) => entry.name)).toContain(
      "FlatTool",
    );
  });

  it("false 把默认延迟的工具翻回平铺", async () => {
    const { toolManager } = build({
      withExec: true,
      tools: [
        { name: "PooledTool", description: "本来进池的", defer: true },
        { name: "KeepPooled", description: "撑起池的", defer: true },
      ],
      describe: (request) =>
        request.name === "PooledTool" ? { isDeferred: false } : undefined,
    });

    await toolManager.prepareToolDescriptions();

    // `PooledTool` 回到 `tools[]`，`KeepPooled` 仍在池里、不在声明里。
    expect(descriptions(toolManager)).toEqual({
      Exec: "沙箱",
      PooledTool: "本来进池的",
    });
    const pool = toolManager.getExecPool().map((entry) => entry.name);
    expect(pool).toContain("KeepPooled");
    expect(pool).not.toContain("PooledTool");
  });

  it("Exec 是结构豁免：插件说藏起来也翻不动", async () => {
    const { toolManager } = build({
      withExec: true,
      tools: [{ name: "KeepPooled", description: "撑起池的", defer: true }],
      describe: (request) =>
        request.name === "Exec" ? { isDeferred: true } : undefined,
    });

    await toolManager.prepareToolDescriptions();

    expect(descriptions(toolManager)).toEqual({ Exec: "沙箱" });
    expect(toolManager.getExecPool().map((entry) => entry.name)).not.toContain(
      "Exec",
    );
  });

  it("没有池（enableExec: false）时保持平铺，且只告诫一次", async () => {
    const { toolManager } = build({
      tools: [{ name: "FlatTool", description: "本来是平铺的" }],
      describe: (request) =>
        request.name === "FlatTool" ? { isDeferred: true } : undefined,
    });

    await toolManager.prepareToolDescriptions();
    await toolManager.prepareToolDescriptions();

    // 「藏起来」无处可去：不能因为一句声明就把工具下架。
    expect(descriptions(toolManager)).toEqual({
      FlatTool: "本来是平铺的",
    });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
  });
});
