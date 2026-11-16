import { describe, it, expect } from "vitest";
import type { Message } from "@/types/messaging.js";
import type { SubagentConfiguration } from "@/utils/subagentParser.js";
import {
  AGENT_LISTING_MARKER_PREFIX,
  AGENT_LISTING_MARKER_SUFFIX,
  DEFAULT_AGENT_LISTING_CHAR_BUDGET,
  buildAgentListingAnnouncement,
  collectAgentListingState,
  formatAgentLine,
  formatAgentsWithinBudget,
} from "@/utils/agentListing.js";

/**
 * 子代理清单的标记/哈希协议（spec core/prompt-cache-control.md「子代理清单按会话
 * 下发」）。
 *
 * 钉的是三件事：清单正文是集合的纯函数（排序稳定、哈希可比）、不发无用清单
 * （同哈希沉默、压缩后可重发）、以及工具池随行不丢（否则两个 reach 不同的
 * 子代理在清单里长得一样，模型选不出来）。
 */

function agent(
  name: string,
  description = `${name} does things`,
  scope: SubagentConfiguration["scope"] = "project",
): SubagentConfiguration {
  return {
    name,
    description,
    systemPrompt: "…",
    filePath: `/agents/${name}.md`,
    scope,
    priority: 0,
  };
}

/** A meta message carrying `content`, i.e. what the announcement writes. */
function metaMessage(content: string, id = "m"): Message {
  return {
    id,
    role: "user",
    timestamp: "2026-10-01T00:00:00.000Z",
    isMeta: true,
    blocks: [{ type: "text", content }],
  };
}

function plainMessage(content: string, id = "m"): Message {
  return {
    id,
    role: "assistant",
    timestamp: "2026-10-01T00:00:00.000Z",
    blocks: [{ type: "text", content }],
  };
}

describe("formatAgentLine", () => {
  it("带工具池与隔离标记，未声明工具时写 *", () => {
    expect(formatAgentLine(agent("Explore"))).toBe(
      "- Explore: Explore does things (Tools: *)",
    );
    expect(formatAgentLine({ ...agent("Plan"), tools: ["Read", "Grep"] })).toBe(
      "- Plan: Plan does things (Tools: Read, Grep)",
    );
    expect(
      formatAgentLine({ ...agent("Coder"), disallowedTools: ["Agent"] }),
    ).toBe("- Coder: Coder does things (Tools: All except Agent)");
    expect(formatAgentLine({ ...agent("Wt"), isolation: "worktree" })).toBe(
      "- Wt: Wt does things (Tools: *) (isolation: worktree)",
    );
  });
});

describe("formatAgentsWithinBudget", () => {
  it("按名字排序，正文是集合的纯函数", () => {
    const a = formatAgentsWithinBudget([agent("b"), agent("a")]);
    const b = formatAgentsWithinBudget([agent("a"), agent("b")]);
    expect(a.body).toBe(b.body);
    expect(a.body.indexOf("- a:")).toBeLessThan(a.body.indexOf("- b:"));
  });

  it("超预算时先压非内置描述，内置保留全描述", () => {
    // 两条各 5000 字：全量正文超 8000 预算，压完非内置那条才装得下。
    const long = "x".repeat(5_000);
    const { body } = formatAgentsWithinBudget(
      [agent("custom", long), agent("builtin", long, "builtin")],
      DEFAULT_AGENT_LISTING_CHAR_BUDGET,
    );
    // 内置那条留全文，自定义那条被截断成 …。
    expect(body).toContain(long);
    expect(body).toContain("…");
    expect(body).not.toContain(`${long} (Tools: *) (Tools: *)`);
  });

  it("仍超预算时退化为「名字 + 工具池」，不丢工具池", () => {
    const { body } = formatAgentsWithinBudget(
      [agent("a", "y".repeat(500), "builtin")],
      200,
    );
    expect(body).toContain("- a (Tools: *)");
  });

  it("极端情况下丢尾部并明确告知余量", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      agent(`agent-${String(i).padStart(2, "0")}`, "z".repeat(80), "builtin"),
    );
    const { body, omitted } = formatAgentsWithinBudget(many, 600);
    expect(omitted).toBeGreaterThan(0);
    expect(body).toContain(`- (${omitted} more subagents not listed)`);
  });
});

describe("buildAgentListingAnnouncement", () => {
  it("首次下发全量并带标记", () => {
    const text = buildAgentListingAnnouncement(null, [agent("a"), agent("b")]);
    expect(text).toBeTruthy();
    expect(text).toContain(AGENT_LISTING_MARKER_PREFIX);
    expect(text).toContain("- a: a does things");
  });

  it("集合没变时沉默", () => {
    const first = buildAgentListingAnnouncement(null, [agent("a")])!;
    const last = collectAgentListingState([metaMessage(first)]);
    expect(buildAgentListingAnnouncement(last, [agent("a")])).toBeNull();
  });

  it("集合变化后重发全量（不是增量）", () => {
    const first = buildAgentListingAnnouncement(null, [agent("a")])!;
    const last = collectAgentListingState([metaMessage(first)]);
    const next = buildAgentListingAnnouncement(last, [agent("a"), agent("b")]);
    expect(next).toContain("- a:");
    expect(next).toContain("- b:");
    expect(next).not.toContain("new");
  });

  it("没有子代理且从没下发过 → 沉默；下发过 → 说明旧清单失效", () => {
    expect(buildAgentListingAnnouncement(null, [])).toBeNull();

    const first = buildAgentListingAnnouncement(null, [agent("a")])!;
    const last = collectAgentListingState([metaMessage(first)]);
    const empty = buildAgentListingAnnouncement(last, []);
    expect(empty).toContain("No subagents are currently available");
    // 再问一次就不再重复。
    const emptyMarker = collectAgentListingState([metaMessage(empty!)]);
    expect(buildAgentListingAnnouncement(emptyMarker, [])).toBeNull();
  });

  it("压缩把标记带走后退化成重新下发全量", () => {
    // 历史里只剩普通消息：等价于「没发过」。
    const last = collectAgentListingState([plainMessage("hello")]);
    expect(last).toBeNull();
    expect(buildAgentListingAnnouncement(last, [agent("a")])).toBeTruthy();
  });

  it("只认元消息里的标记，正文里引用的标记不算", () => {
    const marker = `${AGENT_LISTING_MARKER_PREFIX}{"h":"deadbeef0000"}${AGENT_LISTING_MARKER_SUFFIX}`;
    expect(collectAgentListingState([plainMessage(marker)])).toBeNull();
  });
});
