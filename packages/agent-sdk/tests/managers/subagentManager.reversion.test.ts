/**
 * @file Tests verifying subagent ReversionManager isolation.
 * Subagent Write/Edit must NOT record snapshots into the parent (main) agent's
 * ReversionManager — mirroring Claude Code's explicit file-history isolation
 * for forked agents (`updateFileHistoryState: () => {}` in forkedAgent.ts).
 * Without the isolation registration, the subagent container falls back to the
 * parent's ReversionManager, so a subagent Write drains the shared buffer into
 * its own transient messages (orphaned snapshot files + drain race).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { ReversionManager } from "../../src/managers/reversionManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import { Container } from "../../src/utils/container.js";

// Mock fs/promises so the Write tool never touches the real filesystem
vi.mock("fs/promises");

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/services/aiService.js", () => ({
  sendAIMessage: vi.fn().mockResolvedValue({
    content: "Mock AI response",
    toolCalls: [],
    usage: { totalTokens: 10 },
  }),
}));

describe("SubagentManager - ReversionManager isolation", () => {
  let subagentManager: SubagentManager;
  let parentReversionManager: ReversionManager;
  let mockReversionService: {
    saveSnapshot: ReturnType<typeof vi.fn>;
    readSnapshotContent: ReturnType<typeof vi.fn>;
    deleteSessionHistory: ReturnType<typeof vi.fn>;
  };
  let container: Container;

  beforeEach(async () => {
    mockReversionService = {
      saveSnapshot: vi.fn(),
      readSnapshotContent: vi.fn(),
      deleteSessionHistory: vi.fn(),
    };

    container = new Container();
    container.register("ReversionService", mockReversionService);
    parentReversionManager = new ReversionManager(container);
    container.register("ReversionManager", parentReversionManager);

    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getConfiguredPermissionMode: vi.fn().mockReturnValue("default"),
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
    } as unknown as Record<string, unknown>);
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);

    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    };
    container.register(
      "McpManager",
      mockMcpManager as unknown as Record<string, unknown>,
    );

    const parentToolManager = new ToolManager({ container });
    container.register("ToolManager", parentToolManager);

    const mockGatewayConfig: GatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };
    const mockModelConfig: ModelConfig = {
      model: "claude-3-sonnet",
      fastModel: "claude-3-haiku",
    };
    container.register("ConfigurationService", {
      resolveGatewayConfig: () => mockGatewayConfig,
      resolveModelConfig: () => mockModelConfig,
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => undefined,
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });
    await subagentManager.initialize();
  });

  it("should not record subagent Write snapshots into the parent ReversionManager", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "write-subagent",
      description: "Writes files",
      systemPrompt: "You write files",
      tools: ["Write"],
      model: "inherit",
      filePath: "/tmp/write-subagent.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test write",
      prompt: "Write a file",
      subagent_type: "write-subagent",
      permissionModeOverride: "bypassPermissions",
    });

    const result = await instance.toolManager.execute(
      "Write",
      {
        file_path: "/tmp/test/subagent-file.txt",
        content: "hello from subagent",
      },
      {
        workdir: "/tmp/test",
        messageId: "subagent-msg-1",
        taskManager:
          {} as unknown as import("../../src/services/taskManager.js").TaskManager,
      },
    );

    expect(result.success).toBe(true);
    // The subagent's Write must not touch the shared parent buffer
    expect(parentReversionManager.getAndClearCommittedSnapshots()).toEqual([]);
    expect(mockReversionService.saveSnapshot).not.toHaveBeenCalled();
  });
});
