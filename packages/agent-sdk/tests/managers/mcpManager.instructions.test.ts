import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpTool } from "../../src/types/index.js";

// Server-level usage notes: what a server says about itself in `initialize`.
// These never reach the model through a tool description, so the rules about
// which server gets a voice are the whole contract (docs/specs/ecosystem/mcp.md).

const tool = (name: string): McpTool => ({
  name,
  description: `${name} description`,
  inputSchema: { type: "object" },
});

/** A server that finished its handshake, with `instructions` and `tools` set. */
function connected(
  manager: McpManager,
  name: string,
  options: { instructions?: string; tools?: McpTool[] } = {},
): void {
  manager.addServer(name, { type: "stdio", command: "node" });
  manager.updateServerStatus(name, {
    status: "connected",
    tools: options.tools ?? [],
    toolCount: options.tools?.length ?? 0,
    instructions: options.instructions,
  });
}

describe("McpManager.getServerInstructions", () => {
  let manager: McpManager;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    manager = new McpManager(new Container());
    manager.initialize("/test/workdir");
  });

  afterEach(async () => {
    await manager.cleanup();
    vi.restoreAllMocks();
  });

  it("reports a connected server's usage notes", () => {
    connected(manager, "guide", { instructions: "Use lookup before mutate." });

    expect(manager.getServerInstructions()).toEqual([
      { name: "guide", instructions: "Use lookup before mutate." },
    ]);
  });

  it("reports nothing for a server that sent no notes", () => {
    connected(manager, "quiet");
    connected(manager, "blank", { instructions: "   \n  " });

    expect(manager.getServerInstructions()).toEqual([]);
  });

  it("drops a server whose tools are all excluded by permission rules", () => {
    connected(manager, "guide", {
      instructions: "Use lookup before mutate.",
      tools: [tool("lookup")],
    });
    connected(manager, "toolbox", {
      instructions: "Prefer search before update.",
      tools: [tool("search"), tool("update")],
    });

    const reported = manager.getServerInstructions(
      (name) =>
        name === "mcp__toolbox__search" || name === "mcp__toolbox__update",
    );

    expect(reported).toEqual([
      { name: "guide", instructions: "Use lookup before mutate." },
    ]);
  });

  it("keeps a server whose tools are only partly excluded", () => {
    connected(manager, "toolbox", {
      instructions: "Prefer search before update.",
      tools: [tool("search"), tool("update")],
    });

    expect(
      manager.getServerInstructions((name) => name === "mcp__toolbox__update"),
    ).toEqual([
      { name: "toolbox", instructions: "Prefer search before update." },
    ]);
  });

  it("keeps a server that exposes no tools at all", () => {
    // Nothing was excluded — it is simply a server that brings context, not tools.
    connected(manager, "context-only", { instructions: "Read the glossary." });

    expect(manager.getServerInstructions(() => true)).toEqual([
      { name: "context-only", instructions: "Read the glossary." },
    ]);
  });

  it("stops reporting a server that dropped, failed or went to error", () => {
    for (const [name, status] of [
      ["gone", "disconnected"],
      ["broken", "error"],
      ["starting", "connecting"],
    ] as const) {
      connected(manager, name, { instructions: `${name} notes` });
      manager.updateServerStatus(name, { status });
    }

    expect(manager.getServerInstructions()).toEqual([]);
  });

  it("keeps reporting a reconnecting server's notes, like its tool snapshot", () => {
    // Same usable-predicate as `getAllConnectedTools`: prose and tools must agree
    // about whether a server still counts, or one would speak while the other is
    // gone. A transient transport error flips the status to `reconnecting` without
    // clearing the snapshot.
    connected(manager, "flaky", { instructions: "Watch the rate limit." });
    manager.updateServerStatus("flaky", { status: "reconnecting" });

    expect(manager.getServerInstructions()).toEqual([
      { name: "flaky", instructions: "Watch the rate limit." },
    ]);
  });

  it("forgets the notes once the server is disconnected", async () => {
    connected(manager, "guide", { instructions: "Use lookup before mutate." });

    await manager.disconnectServer("guide");

    expect(manager.getServer("guide")?.instructions).toBeUndefined();
    expect(manager.getServerInstructions()).toEqual([]);
  });
});
