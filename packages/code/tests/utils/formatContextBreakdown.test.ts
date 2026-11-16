import { describe, test, expect } from "vitest";
import type { ContextBreakdown } from "wave-agent-sdk";
import { formatContextBreakdown } from "../../src/utils/formatContextBreakdown.js";

/**
 * `/context` 的 CLI 报告（spec commands/context-command.md 用户故事 1）。
 *
 * 报告是落进对话流的一条纯文本消息（不是覆盖层），所以断言的是「读得出来」
 * ——分类行的形状、网格行数、明细分组、失败可见，而不是配色。
 */

function makeBreakdown(
  overrides: Partial<ContextBreakdown> = {},
): ContextBreakdown {
  return {
    model: "wave-pro",
    contextWindow: 200_000,
    autoCompactThreshold: 179_000,
    maxOutputTokens: 8_000,
    usedTokens: 60_000,
    measured: true,
    usedPercent: 30,
    ringPercent: 34,
    categories: [
      {
        id: "systemPrompt",
        kind: "used",
        name: "System prompt",
        tokens: 8_000,
      },
      { id: "systemTools", kind: "used", name: "System tools", tokens: 12_000 },
      { id: "mcpTools", kind: "used", name: "MCP tools", tokens: 20_000 },
      { id: "memory", kind: "used", name: "Memory files", tokens: 5_000 },
      { id: "messages", kind: "used", name: "Messages", tokens: 15_000 },
      {
        id: "buffer",
        kind: "buffer",
        name: "Autocompact buffer",
        tokens: 21_000,
      },
      { id: "free", kind: "free", name: "Free space", tokens: 119_000 },
    ],
    mcpTools: [
      { serverName: "github", name: "mcp__github__search", tokens: 20_000 },
    ],
    systemTools: [
      { name: "Bash", tokens: 900 },
      { name: "Read", tokens: 600 },
    ],
    memoryFiles: [{ type: "project", path: "/repo/AGENTS.md", tokens: 5_000 }],
    skills: [{ name: "spec" as string, tokens: 400 }],
    agents: [{ name: "Explore" as string, tokens: 120 }],
    errors: [],
    ...overrides,
  };
}

function lines(report: string): string[] {
  return report.split("\n");
}

describe("formatContextBreakdown", () => {
  test("标题 / 网格 / 总量 / 阈值 / 分类 / 明细自上而下", () => {
    const report = formatContextBreakdown(makeBreakdown());
    const rows = lines(report);

    expect(rows[0]).toBe("## Context Usage");
    expect(report).toContain("**wave-pro** · 60,000 / 200,000 tokens (30.0%)");
    // 用量环的分母是压缩阈值，报告的分母是窗口 —— 这一行是二者的换算依据。
    expect(report).toContain(
      "Auto-compact at 179,000 tokens (89.5% of window)",
    );
    expect(report).toContain("### Estimated usage by category");
    expect(report).toContain("⛁ MCP tools: 20,000 tokens (10.0%)");
    // free / buffer 用各自的符号，不与「已占」混在一起。
    expect(report).toContain("⛝ Autocompact buffer: 21,000 tokens (10.5%)");
    expect(report).toContain("⛶ Free space: 119,000 tokens (59.5%)");

    // 明细分组跟在分类之后，MCP 行带服务名。
    expect(report).toContain("### MCP tools · /mcp");
    expect(report).toContain("- github · mcp__github__search: 20,000 tokens");
    expect(report).toContain("### System tools");
    expect(report).toContain("- Bash: 900 tokens");
    expect(report).toContain("### Memory files · /memory");
    expect(report).toContain("- project · /repo/AGENTS.md: 5,000 tokens");
  });

  test("网格是 10 行 × 10 个方块，共 100 格", () => {
    const report = formatContextBreakdown(makeBreakdown());
    const gridRows = lines(report).filter((row) => /^[⛁⛝⛶· ]+$/.test(row));

    expect(gridRows).toHaveLength(10);
    for (const row of gridRows) {
      // 方块之间有一个空格：10 个方块 = 19 个字符宽度。
      expect(row).toHaveLength(19);
    }
    // 100 格覆盖整个窗口：网格里的方块加起来正好 100 个（空格不算）。
    const squares = gridRows.join("").match(/[⛁⛝⛶·]/g)?.length ?? 0;
    expect(squares).toBe(100);
  });

  test("窗口大小只改每格的份量，网格尺寸不变", () => {
    const small = formatContextBreakdown(makeBreakdown());
    const large = formatContextBreakdown(
      makeBreakdown({ contextWindow: 1_000_000 }),
    );
    const count = (report: string) =>
      lines(report)
        .filter((row) => /^[⛁⛝⛶· ]+$/.test(row))
        .join("")
        .match(/[⛁⛝⛶·]/g)?.length ?? 0;
    expect(count(large)).toBe(count(small));
  });

  test("没有实测时明说总量是估出来的", () => {
    const report = formatContextBreakdown(
      makeBreakdown({ measured: false, usedTokens: 60_000 }),
    );
    expect(report).toContain("totals are estimated from the breakdown");
  });

  test("有实测时不出现估算提示", () => {
    const report = formatContextBreakdown(makeBreakdown());
    expect(report).not.toContain("estimated from the breakdown");
  });

  test("技能与子代理清单各有一节（`/context` 单列后才有）", () => {
    const report = formatContextBreakdown(makeBreakdown());

    expect(report).toContain("### Skills · /skills");
    expect(report).toContain("- spec: 400 tokens");
    expect(report).toContain("### Custom agents · /agents");
    expect(report).toContain("- Explore: 120 tokens");
  });

  test("MCP 工具为空时不渲染该分组（不写「无」占位）", () => {
    const report = formatContextBreakdown(makeBreakdown({ mcpTools: [] }));
    expect(report).not.toContain("### MCP tools");
    // 其余分组照旧。
    expect(report).toContain("### System tools");
  });

  test("明细过长时按 maxDetailRows 截断并标注余量", () => {
    const systemTools = Array.from({ length: 30 }, (_, index) => ({
      name: `tool-${index}`,
      tokens: 100 - index,
    }));
    const report = formatContextBreakdown(makeBreakdown({ systemTools }), {
      maxDetailRows: 5,
    });
    expect(report).toContain("- tool-4: 96 tokens");
    expect(report).not.toContain("- tool-5:");
    expect(report).toContain("- …and 25 more");
  });

  test("取数失败写在末尾的 Unavailable sources 里，报告照常输出", () => {
    const report = formatContextBreakdown(
      makeBreakdown({ errors: ["Failed to read memory files: EACCES"] }),
    );
    expect(report).toContain("### Unavailable sources");
    expect(report).toContain("- Failed to read memory files: EACCES");
    // 失败没有把报告拦腰截断：分类行还在。
    expect(report).toContain("⛁ Messages: 15,000 tokens");
  });

  test("窗口未知时不出现 NaN / Infinity 百分比", () => {
    const report = formatContextBreakdown(
      makeBreakdown({
        contextWindow: 0,
        usedPercent: 0,
        ringPercent: 0,
        categories: [
          { id: "free", kind: "free", name: "Free space", tokens: 0 },
        ],
      }),
    );
    expect(report).not.toContain("NaN");
    expect(report).not.toContain("Infinity");
    expect(report).toContain("⛶ Free space: 0 tokens (—)");
  });
});
