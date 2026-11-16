import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { ToolPlugin } from "../../src/tools/types.js";

/**
 * `tool.describe`（spec ecosystem/plugin-mods.md「给工具、技能、命令写描述」）：
 * 插件换掉模型读到的工具说明文字。
 *
 * 两条纪律都在这里钉住：
 *  - 同一个工具**一轮只问一次**，一轮里连发三次请求，三次拿到的描述一致；
 *  - 改过的描述**下一轮**生效（工具表是同步拼的，钩子是异步的）。
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

/** 让 `tool.describe` 那次问答落地：一条 promise 链，没有定时器。 */
async function settleDescribe(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
  }
}

const BASE_DESCRIPTION = "宿主的描述";

function build(
  options: {
    /** 插件改写的结果；不给就是「原样返回」。 */
    describe?: (request: { name: string; description: string }) => string;
    /** 不接 ModManager（独立使用 ToolManager 的调用方）。 */
    withoutModManager?: boolean;
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
  } as unknown as McpManager);
  container.register("MessageManager", {
    countUserTurns: () => turns.value,
  } as unknown as MessageManager);

  const collectToolDescription = vi.fn(
    async (request: { name: string; description: string }) =>
      options.describe ? options.describe(request) : request.description,
  );
  if (!options.withoutModManager) {
    container.register("ModManager", {
      collectToolDescription,
    } as unknown as ModManager);
  }

  const toolManager = new ToolManager({ container });
  const register = (name: string, description: string) => {
    toolManager.register({
      name,
      config: {
        type: "function",
        function: { name, description: "", parameters: {} },
      } as ToolPlugin["config"],
      prompt: () => description,
      execute: vi.fn(),
    });
  };
  register("FakeTool", BASE_DESCRIPTION);
  register("OtherTool", "另一个工具的描述");

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
  it("一轮里连发三次请求：只问一次，三次拿到的描述一致（宿主那一份）", async () => {
    const { toolManager, collectToolDescription } = build({
      describe: ({ description }) => `${description}（插件改过）`,
    });

    const first = descriptions(toolManager);
    await settleDescribe();
    const second = descriptions(toolManager);
    const third = descriptions(toolManager);

    expect(collectToolDescription).toHaveBeenCalledTimes(2);
    expect(first).toEqual({
      FakeTool: BASE_DESCRIPTION,
      OtherTool: "另一个工具的描述",
    });
    // 问到的答案在本轮不落地：工具表是本轮开头 pin 的快照。
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("下一轮请求发出时，模型看到的是插件改过的描述", async () => {
    const { toolManager, turns, collectToolDescription } = build({
      describe: ({ description }) => `${description}（插件改过）`,
    });

    descriptions(toolManager);
    await settleDescribe();

    // 用户发了下一句：新一轮。
    turns.value = 2;
    const next = descriptions(toolManager);

    expect(next).toEqual({
      FakeTool: `${BASE_DESCRIPTION}（插件改过）`,
      OtherTool: "另一个工具的描述（插件改过）",
    });
    // 新的一轮重新问一次（每个工具一次）。
    expect(collectToolDescription).toHaveBeenCalledTimes(4);
  });

  it("同一个工具一轮只问一次：中间再拼几次 schema 也不会重问", async () => {
    const { toolManager, collectToolDescription } = build();
    const describeOf = (name: string) =>
      collectToolDescription.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === name,
      ).length;

    descriptions(toolManager);
    descriptions(toolManager);
    descriptions(toolManager);
    await settleDescribe();

    expect(describeOf("FakeTool")).toBe(1);
    expect(describeOf("OtherTool")).toBe(1);
  });

  it("没接 ModManager 时照旧用宿主自己的描述", () => {
    const { toolManager, collectToolDescription } = build({
      withoutModManager: true,
    });

    expect(descriptions(toolManager)).toEqual({
      FakeTool: BASE_DESCRIPTION,
      OtherTool: "另一个工具的描述",
    });
    expect(collectToolDescription).not.toHaveBeenCalled();
  });
});
