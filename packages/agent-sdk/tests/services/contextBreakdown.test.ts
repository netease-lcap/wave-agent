import { describe, test, expect } from "vitest";
import { buildContextBreakdown } from "../../src/services/contextBreakdown.js";

/**
 * `/context` 的装配口径（spec commands/context-command.md 用户故事 3）。
 *
 * 这里钉的是**恒等式与归属**，不是某个数字：分项是本地估算，估算公式改了就该
 * 跟着变；但「分项 + buffer + free = 窗口」「kind 决定谁不占对话可用量」这两条
 * 是前端渲染所依赖的契约。
 */

const baseInput = {
  model: "test-model",
  contextWindow: 200_000,
  maxOutputTokens: 8_000,
  autoCompactThreshold: 179_000,
  systemPromptTokens: 2_000,
  systemTools: [
    { name: "Read", tokens: 400 },
    { name: "Bash", tokens: 600 },
  ],
  mcpTools: [
    { serverName: "github", name: "mcp__github__search", tokens: 900 },
  ],
  memoryFiles: [
    { type: "project" as const, path: "/repo/AGENTS.md", tokens: 300 },
  ],
  skills: [] as Array<{ name: string; tokens: number }>,
  agents: [] as Array<{ name: string; tokens: number }>,
  messagesTokens: 1_000,
  measuredTokens: 0,
};

describe("buildContextBreakdown", () => {
  test("分类合计 + Autocompact buffer + Free space 等于上下文窗口", () => {
    const breakdown = buildContextBreakdown(baseInput);

    const total = breakdown.categories.reduce(
      (sum, category) => sum + category.tokens,
      0,
    );
    expect(total).toBe(breakdown.contextWindow);
  });

  test("buffer = 窗口 − 压缩阈值，free = 阈值 − 已用", () => {
    const breakdown = buildContextBreakdown(baseInput);

    const buffer = breakdown.categories.find((c) => c.id === "buffer");
    const free = breakdown.categories.find((c) => c.id === "free");
    expect(buffer?.kind).toBe("buffer");
    expect(buffer?.tokens).toBe(200_000 - 179_000);
    expect(free?.kind).toBe("free");
    // 没有实测时总量退化为分项估值之和：2000 + 1000 + 900 + 300 + 1000。
    expect(free?.tokens).toBe(179_000 - 5_200);
  });

  test("没有实测响应时 measured=false，usedTokens 用分项估值之和", () => {
    const breakdown = buildContextBreakdown(baseInput);

    expect(breakdown.measured).toBe(false);
    expect(breakdown.usedTokens).toBe(5_200);
    expect(breakdown.usedPercent).toBe(Math.round((5_200 / 200_000) * 100));
  });

  test("有实测时 usedTokens 取实测（与用量环同源），free 不被算成负数", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      // 实测比估算大：真实请求还带了 cache 前缀与上游自己的计数口径。
      measuredTokens: 12_000,
    });

    expect(breakdown.measured).toBe(true);
    expect(breakdown.usedTokens).toBe(12_000);
    const free = breakdown.categories.find((c) => c.id === "free");
    expect(free?.tokens).toBe(179_000 - 12_000);
    // 分项仍各自是估值：不会被按比例摊到实测总量上。
    const messages = breakdown.categories.find((c) => c.id === "messages");
    expect(messages?.tokens).toBe(1_000);
  });

  test("估算高过阈值时 free 归零而不是负数", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      messagesTokens: 190_000,
    });

    const free = breakdown.categories.find((c) => c.id === "free");
    expect(free?.tokens).toBe(0);
  });

  test("技能与子代理清单单列，并从 Messages 里扣掉（同一段文字不出现两次）", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      skills: [
        { name: "spec", tokens: 400 },
        { name: "commit", tokens: 100 },
      ],
      agents: [{ name: "reviewer", tokens: 150 }],
      messagesTokens: 1_650,
    });

    const skills = breakdown.categories.find((c) => c.id === "skills");
    const agents = breakdown.categories.find((c) => c.id === "agents");
    const messages = breakdown.categories.find((c) => c.id === "messages");
    expect(skills).toMatchObject({ kind: "used", name: "Skills", tokens: 500 });
    expect(agents).toMatchObject({
      kind: "used",
      name: "Custom agents",
      tokens: 150,
    });
    // 1650 里含 500 + 150 的清单正文，扣掉后只剩真正的对话消息。
    expect(messages?.tokens).toBe(1_000);
    // 恒等式不受影响：单列只是换了个归属，不是把量加了一遍。
    const total = breakdown.categories.reduce((sum, c) => sum + c.tokens, 0);
    expect(total).toBe(breakdown.contextWindow);
  });

  test("清单明细按体积降序，0 token 项被过滤", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      skills: [
        { name: "small", tokens: 10 },
        { name: "empty", tokens: 0 },
        { name: "big", tokens: 900 },
      ],
      agents: [],
    });

    expect(breakdown.skills.map((s) => s.name)).toEqual(["big", "small"]);
    expect(breakdown.agents).toEqual([]);
  });

  test("tokens 为 0 的分类整行省略，Free space 恒在", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      systemPromptTokens: 0,
      systemTools: [],
      mcpTools: [],
      memoryFiles: [],
      messagesTokens: 0,
    });

    expect(breakdown.categories.map((c) => c.id)).toEqual(["buffer", "free"]);
  });

  test("ringPercent 用的是压缩阈值分母（用量环口径），不是窗口", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      measuredTokens: 89_500,
    });

    // 89.5k / 179k ≈ 50%，若按窗口算只有 44.75%。
    expect(breakdown.ringPercent).toBe(50);
    expect(breakdown.usedPercent).toBe(45);
  });

  test("窗口未知时百分比归零、buffer 退化为 0，不出现 NaN", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      contextWindow: 0,
      autoCompactThreshold: 0,
    });

    expect(breakdown.contextWindow).toBe(0);
    expect(breakdown.usedPercent).toBe(0);
    expect(breakdown.ringPercent).toBe(0);
    expect(Number.isNaN(breakdown.usedPercent)).toBe(false);
  });

  test("明细按体积降序，记忆里的 0 token 项被过滤", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      systemTools: [
        { name: "Read", tokens: 100 },
        { name: "Bash", tokens: 900 },
      ],
      mcpTools: [
        { serverName: "a", name: "mcp__a__x", tokens: 10 },
        { serverName: "b", name: "mcp__b__y", tokens: 500 },
      ],
      memoryFiles: [
        { type: "project" as const, path: "p", tokens: 5 },
        { type: "user" as const, path: "u", tokens: 0 },
      ],
    });

    expect(breakdown.systemTools.map((t) => t.name)).toEqual(["Bash", "Read"]);
    expect(breakdown.mcpTools.map((t) => t.name)).toEqual([
      "mcp__b__y",
      "mcp__a__x",
    ]);
    expect(breakdown.memoryFiles.map((f) => f.path)).toEqual(["p"]);
  });

  test("errors 原样带出（失败可见，但不阻断报告）", () => {
    const breakdown = buildContextBreakdown({
      ...baseInput,
      errors: ["Failed to read memory files: EACCES"],
    });

    expect(breakdown.errors).toEqual(["Failed to read memory files: EACCES"]);
    // 其余分项照常出数。
    expect(breakdown.categories.length).toBeGreaterThan(0);
  });
});
