import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { cleanupMetaOnlySessions } from "../../src/services/session.js";
import type { Usage } from "../../src/types/index.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("../../src/managers/aiManager.js");
vi.mock("../../src/managers/mcpManager.js");
vi.mock("../../src/managers/skillManager.js");
vi.mock("../../src/services/session.js");

const workdir = "/test/workdir";

/** 把三个取数点钉死：上下文窗口、输出上限、用量记录都从实例上盖掉。 */
function pin(
  agent: Agent,
  values: {
    latestTotalTokens: number;
    usages: Usage[];
    contextWindow?: number;
    maxOutputTokens?: number;
  },
) {
  vi.spyOn(agent, "getContextWindow").mockReturnValue(
    values.contextWindow ?? 200_000,
  );
  vi.spyOn(agent, "getMaxOutputTokens").mockReturnValue(
    values.maxOutputTokens ?? 32_000,
  );
  vi.spyOn(agent, "getModelConfig").mockReturnValue({ model: "some-model" });
  Object.defineProperty(agent, "latestTotalTokens", {
    value: values.latestTotalTokens,
    configurable: true,
  });
  Object.defineProperty(agent, "usages", {
    value: values.usages,
    configurable: true,
  });
}

describe("Agent getSessionUsage ($.session.usage 的数据源)", () => {
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cleanupMetaOnlySessions).mockResolvedValue(0);
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(SkillManager.prototype.getAvailableSkills).mockReturnValue([]);
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("percent 用压缩阈值作分母，tokens 是跨轮累计（含缓存字段）", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    pin(agent, {
      // 200k 窗口的阈值是 167k。
      latestTotalTokens: 83_500,
      usages: [
        {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          cache_read_input_tokens: 40,
        },
        {
          prompt_tokens: 200,
          completion_tokens: 20,
          total_tokens: 220,
          cache_creation_input_tokens: 5,
        },
      ],
    });

    expect(agent.getSessionUsage()).toEqual({
      context: { tokens: 83_500, window: 200_000, percent: 50 },
      tokens: { prompt: 300, completion: 30, cacheRead: 40, cacheCreation: 5 },
      model: "some-model",
    });
  });

  it("还没跑过轮次时是零值快照，不是缺字段", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    pin(agent, { latestTotalTokens: 0, usages: [] });
    vi.spyOn(agent, "getModelConfig").mockReturnValue({});

    expect(agent.getSessionUsage()).toEqual({
      context: { tokens: 0, window: 200_000, percent: 0 },
      tokens: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("构造时就把这个取数点接到 ModManager 上", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    const spy = vi.spyOn(agent, "getSessionUsage");
    const modManager = (
      agent as unknown as {
        modManager: { sessionUsageProvider?: () => unknown };
      }
    ).modManager;

    expect(modManager.sessionUsageProvider).toBeTypeOf("function");
    modManager.sessionUsageProvider?.();
    expect(spy).toHaveBeenCalled();
  });
});
