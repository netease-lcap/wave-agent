import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { promises as fs } from "fs";
import {} from "../../src/types/index.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("fs");

describe("McpManager loadConfig", () => {
  let mcpManager: McpManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    mcpManager = new McpManager(container);
  });

  afterEach(async () => {
    await mcpManager.cleanup();
  });

  describe("loadConfig", () => {
    it("should warn if config path not set", async () => {
      const config = await mcpManager.loadConfig();
      expect(config).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("MCP config path not set"),
      );
    });

    it("should preserve existing server status when reloading config", async () => {
      await mcpManager.initialize("/test/workdir");

      const initialConfig = { mcpServers: { s1: { command: "c1" } } };
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(initialConfig),
      );
      await mcpManager.loadConfig();

      mcpManager.updateServerStatus("s1", { status: "connected" });

      const updatedConfig = { mcpServers: { s1: { command: "c1-updated" } } };
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(updatedConfig),
      );
      await mcpManager.loadConfig();

      const server = mcpManager.getServer("s1");
      expect(server?.status).toBe("connected");
      expect(server?.config.command).toBe("c1-updated");
    });
  });
});
