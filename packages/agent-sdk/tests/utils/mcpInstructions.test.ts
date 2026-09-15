import { describe, it, expect } from "vitest";
import {
  MCP_INSTRUCTIONS_MAX_CHARS,
  buildMcpInstructionsAnnouncement,
  collectAnnouncedServers,
  truncateMcpInstructions,
} from "../../src/utils/mcpInstructions.js";
import type { Message } from "../../src/types/messaging.js";

// The announcement is the only channel a server's own usage notes travel through
// (docs/specs/ecosystem/mcp.md): once per server, appended as a persisted message,
// never rewritten afterwards. The history scan is what makes "once" true, so the
// fold of added/removed names is the contract worth pinning down here.

function noteMessage(content: string): Message {
  return {
    id: "m1",
    role: "user",
    timestamp: "2026-09-15T00:00:00.000Z",
    isMeta: true,
    blocks: [{ type: "text", content }],
  };
}

describe("truncateMcpInstructions", () => {
  it("passes through notes that fit, including exactly at the cap", () => {
    expect(truncateMcpInstructions(undefined)).toBeUndefined();
    expect(truncateMcpInstructions("short")).toBe("short");
    const exact = "x".repeat(MCP_INSTRUCTIONS_MAX_CHARS);
    expect(truncateMcpInstructions(exact)).toBe(exact);
  });

  it("cuts a longer note to the cap and says so", () => {
    const truncated = truncateMcpInstructions(
      "y".repeat(MCP_INSTRUCTIONS_MAX_CHARS + 100),
    );

    expect(truncated?.startsWith("y".repeat(MCP_INSTRUCTIONS_MAX_CHARS))).toBe(
      true,
    );
    expect(truncated?.slice(MCP_INSTRUCTIONS_MAX_CHARS)).toBe("… [truncated]");
  });
});

describe("buildMcpInstructionsAnnouncement", () => {
  it("says nothing when no server appeared or went away", () => {
    expect(buildMcpInstructionsAnnouncement({ added: [], removed: [] })).toBe(
      null,
    );
  });

  it("announces new servers with their notes verbatim, per server", () => {
    const text = buildMcpInstructionsAnnouncement({
      added: [
        { name: "guide", instructions: "Use lookup before mutate." },
        {
          name: "tavily",
          instructions: "Rate limit: 20 requests per minute.\n\nCrawl first.",
        },
      ],
      removed: [],
    });

    expect(text).toBe(
      [
        '<!-- mcp-instructions {"added":["guide","tavily"],"removed":[]} -->',
        "The following MCP servers have provided instructions for how to use their tools and resources:",
        "",
        "<mcp_instructions>",
        '  <server name="guide">',
        "    Use lookup before mutate.",
        "  </server>",
        '  <server name="tavily">',
        "    Rate limit: 20 requests per minute.",
        // A blank line keeps its indent, exactly like opencode's rendering.
        "    ",
        "    Crawl first.",
        "  </server>",
        "</mcp_instructions>",
      ].join("\n"),
    );
  });

  it("announces a departed server without repeating its notes", () => {
    const text = buildMcpInstructionsAnnouncement({
      added: [],
      removed: ["gone"],
    });

    expect(text).toBe(
      [
        '<!-- mcp-instructions {"added":[],"removed":["gone"]} -->',
        "The following MCP servers have disconnected. Their instructions above no longer apply:",
        "gone",
      ].join("\n"),
    );
    expect(text).not.toContain("<mcp_instructions>");
  });
});

describe("collectAnnouncedServers", () => {
  it("reads back the servers an announcement covered", () => {
    const text = buildMcpInstructionsAnnouncement({
      added: [
        { name: "guide", instructions: "Use lookup." },
        { name: "tavily", instructions: "Crawl first." },
      ],
      removed: [],
    });

    expect(collectAnnouncedServers([noteMessage(text!)])).toEqual(
      new Set(["guide", "tavily"]),
    );
  });

  it("forgets a server that was announced and later went away, so a reconnect announces it again", () => {
    const arrived = noteMessage(
      buildMcpInstructionsAnnouncement({
        added: [{ name: "guide", instructions: "Use lookup." }],
        removed: [],
      })!,
    );
    const departed = noteMessage(
      buildMcpInstructionsAnnouncement({ added: [], removed: ["guide"] })!,
    );

    expect(collectAnnouncedServers([arrived, departed])).toEqual(new Set());
    // Reconnecting after a departure is a new announcement: the first one no
    // longer describes anything in context.
    expect(
      collectAnnouncedServers([
        arrived,
        departed,
        noteMessage(
          buildMcpInstructionsAnnouncement({
            added: [{ name: "guide", instructions: "Use lookup." }],
            removed: [],
          })!,
        ),
      ]),
    ).toEqual(new Set(["guide"]));
  });

  it("ignores notes without a marker, so prose alone never counts as an announcement", () => {
    const prose =
      '<system-reminder>\n<mcp_instructions>\n  <server name="guide">\n    Use lookup.\n  </server>\n</mcp_instructions>\n</system-reminder>';

    expect(collectAnnouncedServers([noteMessage(prose)])).toEqual(new Set());
  });

  it("ignores a marker it cannot read instead of failing the turn", () => {
    expect(
      collectAnnouncedServers([
        noteMessage("<!-- mcp-instructions not json -->"),
        noteMessage(
          buildMcpInstructionsAnnouncement({
            added: [{ name: "guide", instructions: "Use lookup." }],
            removed: [],
          })!,
        ),
      ]),
    ).toEqual(new Set(["guide"]));
  });
});
