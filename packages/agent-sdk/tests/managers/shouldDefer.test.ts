import { describe, it, expect, vi, afterEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";
import * as os from "node:os";
import { isGitRepository } from "@/utils/gitUtils.js";
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/prompts/index.js";

vi.mock("node:os");
vi.mock("@/utils/gitUtils.js");

describe("shouldDefer tool loading", () => {
  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as McpManager;

  const createContainer = () => {
    const container = new Container();
    container.register("PermissionManager", {
      isToolDenied: vi.fn().mockReturnValue(false),
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    });
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register(
      "ReversionManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);
    container.register("McpManager", mockMcpManager);
    return container;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ToolManager", () => {
    it("should include deferred tools when discoveredTools contains them", () => {
      const toolManager = new ToolManager({ container: createContainer() });
      toolManager.initializeBuiltInTools();
      const discovered = new Set(["CronCreate", "WebFetch"]);
      const config = toolManager.getToolsConfig({
        discoveredTools: discovered,
      });
      const names = config.map((c) => c.function.name);
      expect(names).toContain("Bash");
      expect(names).toContain("CronCreate");
      expect(names).toContain("WebFetch");
    });

    it("should exclude deferred tools when discoveredTools is empty", () => {
      const toolManager = new ToolManager({ container: createContainer() });
      toolManager.initializeBuiltInTools();
      const config = toolManager.getToolsConfig({ discoveredTools: new Set() });
      const names = config.map((c) => c.function.name);
      expect(names).toContain("Bash");
      expect(names).not.toContain("CronCreate");
      expect(names).not.toContain("WebFetch");
      expect(names).toContain("ToolSearch"); // ToolSearch is never deferred
    });

    it("should include discovered deferred tools", () => {
      const toolManager = new ToolManager({ container: createContainer() });
      toolManager.initializeBuiltInTools();
      const discovered = new Set(["CronCreate"]);
      const config = toolManager.getToolsConfig({
        discoveredTools: discovered,
      });
      const names = config.map((c) => c.function.name);
      expect(names).toContain("CronCreate");
      expect(names).not.toContain("WebFetch"); // not discovered yet
      expect(names).toContain("Bash");
    });

    it("should return deferred tool names", () => {
      const toolManager = new ToolManager({ container: createContainer() });
      toolManager.initializeBuiltInTools();
      const deferred = toolManager.getDeferredToolNames();
      expect(deferred).toContain("CronCreate");
      expect(deferred).toContain("CronDelete");
      expect(deferred).toContain("WebFetch");
      expect(deferred).not.toContain("Bash");
      expect(deferred).not.toContain("ToolSearch");
    });
  });

  describe("System prompt", () => {
    it("should list deferred tools in the system prompt", () => {
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.type).mockReturnValue("Linux");
      vi.mocked(os.release).mockReturnValue("6.8.0");
      vi.mocked(isGitRepository).mockReturnValue("Yes");

      const toolManager = new ToolManager({ container: createContainer() });
      toolManager.initializeBuiltInTools();
      const tools = toolManager.list();
      const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, tools, {
        workdir: "/test/path",
      });

      expect(prompt).toContain("## Deferred tools");
      expect(prompt).toContain("CronCreate");
      expect(prompt).toContain("ToolSearch");
      expect(prompt).toContain("Use ToolSearch to discover");
    });

    it("should not include deferred tools section when no tools passed", () => {
      const prompt = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {});
      expect(prompt).not.toContain("## Deferred tools");
    });
  });
});
