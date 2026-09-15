import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { MCP_INSTRUCTIONS_MAX_CHARS } from "../../src/utils/mcpInstructions.js";

// What a server says about itself arrives once, in the handshake, and is stored
// on the server status. The cap is applied there rather than at render time, so
// the stored value (exposed through the status API) cannot be an unbounded blob.

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("@modelcontextprotocol/sdk/client/sse.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");
vi.mock("fs");

describe("McpManager instructions capture", () => {
  let manager: McpManager;
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    getInstructions: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpManager(new Container());
    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      getInstructions: vi.fn(),
    };
    vi.mocked(Client).mockImplementation(function () {
      return mockClient as never;
    });
    vi.mocked(StdioClientTransport).mockImplementation(function () {
      return {
        close: vi.fn().mockResolvedValue(undefined),
        onerror: null,
        onclose: null,
        stderr: null,
      } as never;
    });
  });

  afterEach(async () => {
    await manager.cleanup();
    vi.restoreAllMocks();
  });

  it("stores a connecting server's notes as sent when they fit", async () => {
    mockClient.getInstructions.mockReturnValue("Use lookup before mutate.");
    manager.addServer("guide", { command: "run-guide" });

    expect(await manager.connectServer("guide")).toBe(true);
    expect(manager.getServerInstructions()).toEqual([
      { name: "guide", instructions: "Use lookup before mutate." },
    ]);
  });

  it("caps an over-long note at capture, marking the cut", async () => {
    mockClient.getInstructions.mockReturnValue(
      "z".repeat(MCP_INSTRUCTIONS_MAX_CHARS + 100),
    );
    manager.addServer("verbose", { command: "run-verbose" });

    expect(await manager.connectServer("verbose")).toBe(true);

    const [reported] = manager.getServerInstructions();
    expect(reported.instructions.slice(0, MCP_INSTRUCTIONS_MAX_CHARS)).toBe(
      "z".repeat(MCP_INSTRUCTIONS_MAX_CHARS),
    );
    expect(reported.instructions).toContain("… [truncated]");
  });
});
