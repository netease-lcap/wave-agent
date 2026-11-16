import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentTool } from "../../src/tools/agentTool.js";
import { TaskManager } from "../../src/services/taskManager.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import { Container } from "../../src/utils/container.js";

vi.mock("../../src/managers/subagentManager.js");
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Agent 工具与插件钩子的交界（spec ecosystem/plugin-mods.md「派子代理」）：
 * 清单里一次 `agent.offer`、真正派发时再一次，然后 `agent.spawn` 决定这一次放
 * 不放、子代理拿到什么。
 */

const gpConfig: SubagentConfiguration = {
  name: "general-purpose",
  description: "General-purpose agent",
  systemPrompt: "You are an agent...",
  model: "fastModel",
  filePath: "<builtin:general-purpose>",
  scope: "builtin",
  priority: 3,
};

interface BuildOptions {
  /** `agent.offer` 的答复；默认放行。 */
  offer?: boolean;
  /** `agent.spawn` 的拒绝文本。 */
  deny?: string;
  /** 插件改写后的事件字段。 */
  rewrite?: Record<string, unknown>;
  /** 插件自己答 `{ model }` 却不调 `next`：起了零个子代理。 */
  answerWithoutNext?: { model: string };
}

function build(options: BuildOptions = {}) {
  const instance = {
    subagentId: "sub-1",
    usedTools: [],
    messageManager: {
      getMessages: vi.fn(() => []),
      getLatestTotalTokens: vi.fn(() => 0),
    },
  } as unknown as SubagentInstance;

  const subagentManager = {
    findSubagent: vi.fn(async () => gpConfig),
    createInstance: vi.fn(async () => instance),
    executeAgent: vi.fn(async () => "subagent answer"),
    cleanupInstance: vi.fn(),
    backgroundInstance: vi.fn(),
  } as unknown as SubagentManager;

  const modManager = {
    dispatchAgentOffer: vi.fn(async () => options.offer ?? true),
    dispatchAgentSpawn: vi.fn(
      async (
        event: unknown,
        tail: (current: unknown) => Promise<unknown>,
      ): Promise<{ deny?: string; value?: unknown }> => {
        if (options.deny) return { deny: options.deny };
        if (options.answerWithoutNext) {
          return { value: options.answerWithoutNext };
        }
        const value = await tail({
          ...(event as Record<string, unknown>),
          ...(options.rewrite ?? {}),
        });
        return { value };
      },
    ),
  } as unknown as ModManager;

  const context: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
    taskManager: new TaskManager(new Container(), "test-session"),
    subagentManager,
    modManager,
  };

  return { context, subagentManager, modManager };
}

const call = (context: ToolContext, extra: Record<string, unknown> = {}) =>
  agentTool.execute(
    {
      description: "Look around",
      prompt: "Read the README.",
      subagent_type: "general-purpose",
      ...extra,
    },
    context,
  );

describe("Agent 工具与 agent.offer / agent.spawn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offer 说 false 时根本不派发，模型拿到说明", async () => {
    const { context, subagentManager, modManager } = build({ offer: false });

    const result = await call(context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("hidden by a plugin");
    expect(vi.mocked(subagentManager.createInstance)).not.toHaveBeenCalled();
    // 清单那次与派发那次共用一个事件：这一次问完就不必再问 spawn。
    expect(vi.mocked(modManager.dispatchAgentSpawn)).not.toHaveBeenCalled();
    expect(vi.mocked(modManager.dispatchAgentOffer)).toHaveBeenCalledWith(
      {
        agent: "general-purpose",
        description: "General-purpose agent",
        source: "built-in",
      },
      context.abortSignal,
    );
  });

  it("agent.spawn 返回 deny 时子代理不启动，模型收到那段文本", async () => {
    const { context, subagentManager } = build({
      deny: "这个仓库里不许把 .env 交给子代理",
    });

    const result = await call(context);

    expect(result).toEqual({
      success: false,
      content: "",
      error: "这个仓库里不许把 .env 交给子代理",
      shortResult: "Agent delegation denied",
    });
    expect(vi.mocked(subagentManager.createInstance)).not.toHaveBeenCalled();
    expect(vi.mocked(subagentManager.executeAgent)).not.toHaveBeenCalled();
  });

  it("next(e) 改写的 prompt / description 就是子代理真正拿到的东西", async () => {
    const { context, subagentManager } = build({
      rewrite: { prompt: "只读，别改文件。", description: "Read only" },
    });

    const result = await call(context);

    expect(result.success).toBe(true);
    expect(vi.mocked(subagentManager.createInstance)).toHaveBeenCalledWith(
      gpConfig,
      expect.objectContaining({
        prompt: "只读，别改文件。",
        description: "Read only",
      }),
      undefined,
      expect.any(Function),
    );
    expect(vi.mocked(subagentManager.executeAgent)).toHaveBeenCalledWith(
      expect.anything(),
      "只读，别改文件。",
      context.abortSignal,
      undefined,
    );
  });

  it("钩子自己答 { model } 却没 next：起了零个子代理，不算成功", async () => {
    const { context, subagentManager } = build({
      answerWithoutNext: { model: "haiku" },
    });

    const result = await call(context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("没有启动子代理");
    expect(vi.mocked(subagentManager.createInstance)).not.toHaveBeenCalled();
  });

  it("没有 mod 管理器时照旧直派，不经过任何钩子", async () => {
    const { context, subagentManager } = build();
    const plain: ToolContext = { ...context, modManager: undefined };

    const result = await call(plain);

    expect(result.success).toBe(true);
    expect(result.content).toBe("subagent answer");
    expect(
      vi.mocked(context.modManager!.dispatchAgentOffer),
    ).not.toHaveBeenCalled();
    expect(vi.mocked(subagentManager.executeAgent)).toHaveBeenCalledWith(
      expect.anything(),
      "Read the README.",
      plain.abortSignal,
      undefined,
    );
  });
});
