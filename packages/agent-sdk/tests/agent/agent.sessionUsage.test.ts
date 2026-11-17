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

/** 钉住 AIManager 上「最后一次额度头」——`getSessionUsage()` 的唯一额度来源。 */
function pinQuotaHeaders(agent: Agent, headers?: Record<string, string>) {
  const { aiManager } = agent as unknown as { aiManager: object };
  vi.spyOn(
    aiManager as { getLastQuotaHeaders: () => unknown },
    "getLastQuotaHeaders",
  ).mockReturnValue(headers);
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
      // 会话起点：社区 mod 拿它算「$/小时」这类速率，所以它必须在快照里。
      startedAt: expect.any(Number),
      // 额度窗口要企业端接口，我们没有：空数组是「这个账号没有配额窗口可报」。
      rateLimits: [],
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
      startedAt: expect.any(Number),
      rateLimits: [],
      context: { tokens: 0, window: 200_000, percent: 0 },
      tokens: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("把额度头解析成窗口：kind 用上游的 weekly / monthly，resetsAt 从 unix 秒换成毫秒", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    pin(agent, { latestTotalTokens: 0, usages: [] });
    pinQuotaHeaders(agent, {
      "x-codechat-quota-status": "allowed_warning",
      "x-codechat-quota-weekly-utilization": "0.625",
      "x-codechat-quota-weekly-reset": "1767225600", // 2026-01-01T00:00:00Z
      // 月窗口没有 utilization：按 used / limit 现算 400 / 1000 = 40%。
      "x-codechat-quota-monthly-used": "400",
      "x-codechat-quota-monthly-limit": "1000",
      "x-codechat-quota-monthly-reset": "1769904000",
    });

    expect(agent.getSessionUsage().rateLimits).toEqual([
      { kind: "weekly", percentUsed: 62.5, resetsAt: 1_767_225_600_000 },
      { kind: "monthly", percentUsed: 40, resetsAt: 1_769_904_000_000 },
    ]);
  });

  it("没有可算比例的窗口就不报（unlimited / api 余额），超额夹在 100", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    pin(agent, { latestTotalTokens: 0, usages: [] });
    pinQuotaHeaders(agent, {
      "x-codechat-quota-status": "allowed",
      // 周窗口不限额：没有分母，也没有 utilization，这个窗口整个不报。
      "x-codechat-quota-weekly-limit": "unlimited",
      "x-codechat-quota-weekly-used": "50",
      // 月窗口超额：字段契约是 0–100，夹住而不是透传 105。
      "x-codechat-quota-monthly-utilization": "1.05",
      // `api-*` 是充值余额（没有重置时刻），不是额度窗口。
      "x-codechat-quota-api-limit": "unlimited",
      "x-codechat-quota-api-used": "12",
    });

    expect(agent.getSessionUsage().rateLimits).toEqual([
      { kind: "monthly", percentUsed: 100 },
    ]);
  });

  it("一个额度头都没有时是空数组（私有化 / 自定义网关的真实读法）", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    pin(agent, { latestTotalTokens: 0, usages: [] });
    pinQuotaHeaders(agent, undefined);

    expect(agent.getSessionUsage().rateLimits).toEqual([]);
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
