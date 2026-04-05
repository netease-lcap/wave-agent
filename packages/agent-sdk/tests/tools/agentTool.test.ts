import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentTool } from "../../src/tools/agentTool.js";
import { TaskManager } from "../../src/services/taskManager.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { ToolContext } from "../../src/tools/types.js";
import { Container } from "../../src/utils/container.js";

// Mock the subagent manager
vi.mock("../../src/managers/subagentManager.js");

describe("Agent Tool Background Execution", () => {
  let mockSubagentManager: SubagentManager;
  const mockToolContext: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
    taskManager: new TaskManager(new Container(), "test-session"),
  };

  const gpConfig: SubagentConfiguration = {
    name: "general-purpose",
    description: "General-purpose agent",
    systemPrompt: "You are an agent...",
    model: "fastModel",
    filePath: "<builtin:general-purpose>",
    scope: "builtin",
    priority: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock subagent manager
    mockSubagentManager = {
      getConfigurations: vi.fn(() => [gpConfig]),
      findSubagent: vi.fn(),
      createInstance: vi.fn(),
      executeAgent: vi.fn(),
      backgroundInstance: vi.fn(),
    } as unknown as SubagentManager;

    // Set the mock manager in the context
    mockToolContext.subagentManager = mockSubagentManager;
  });

  it("should support run_in_background parameter", async () => {
    expect(
      agentTool.prompt?.({ availableSubagents: [gpConfig] }),
    ).toBeDefined();
    expect(typeof agentTool.prompt?.({ availableSubagents: [gpConfig] })).toBe(
      "string",
    );
    const mockInstance = {
      subagentId: "gp-test-id",
      lastTools: [],
      messageManager: {
        getMessages: vi.fn(() => []),
        getLatestTotalTokens: vi.fn(() => 0),
      },
    };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
      mockInstance as unknown as SubagentInstance,
    );
    vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
      "task_12345", // Returns task ID when background is true
    );

    const result = await agentTool.execute(
      {
        description: "Background task",
        prompt: "Do something in background",
        subagent_type: "general-purpose",
        run_in_background: true,
      },
      mockToolContext,
    );

    expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
      mockInstance,
      "Do something in background",
      mockToolContext.abortSignal,
      true, // background parameter
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Agent started in background");
    expect(result.content).toContain("task_12345");
    expect(result.shortResult).toBe("Agent started in background: task_12345");
  });

  it("should add '...' to shortResult when toolCount > 2", async () => {
    const mockInstance = {
      subagentId: "gp-test-id",
      lastTools: ["Read", "Write"],
      messageManager: {
        getMessages: vi.fn(() => [
          { blocks: [{ type: "tool" }, { type: "tool" }] },
          { blocks: [{ type: "tool" }] },
        ]),
        getLatestTotalTokens: vi.fn(() => 1000),
      },
    };

    let capturedShortResult = "";
    const contextWithCallback: ToolContext = {
      ...mockToolContext,
      onShortResultUpdate: (sr) => {
        capturedShortResult = sr;
      },
    };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockImplementation(
      async (config, args, background, updateShortResult) => {
        // Simulate the callback being called
        setTimeout(() => updateShortResult?.(), 0);
        return mockInstance as unknown as SubagentInstance;
      },
    );
    vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue("done");

    await agentTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "general-purpose",
      },
      contextWithCallback,
    );

    await vi.waitFor(() => {
      expect(capturedShortResult).toBe(
        "... Read, Write (3 tools | 1,000 tokens)",
      );
    });
  });

  it("should NOT add '...' to shortResult when toolCount <= 2", async () => {
    const mockInstance = {
      subagentId: "gp-test-id",
      lastTools: ["Read", "Write"],
      messageManager: {
        getMessages: vi.fn(() => [
          { blocks: [{ type: "tool" }, { type: "tool" }] },
        ]),
        getLatestTotalTokens: vi.fn(() => 1000),
      },
    };

    let capturedShortResult = "";
    const contextWithCallback: ToolContext = {
      ...mockToolContext,
      onShortResultUpdate: (sr) => {
        capturedShortResult = sr;
      },
    };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockImplementation(
      async (config, args, background, updateShortResult) => {
        setTimeout(() => updateShortResult?.(), 0);
        return mockInstance as unknown as SubagentInstance;
      },
    );
    vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue("done");

    await agentTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "general-purpose",
      },
      contextWithCallback,
    );

    await vi.waitFor(() => {
      expect(capturedShortResult).toBe("Read, Write (2 tools | 1,000 tokens)");
    });
  });

  it("should handle missing parameters", async () => {
    const result = agentTool.validate!({});
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("Missing required parameter: description");
  });

  it("should handle missing prompt", async () => {
    const result = agentTool.validate!({ description: "Test" });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("Missing required parameter: prompt");
  });

  it("should handle missing subagent_type", async () => {
    const result = agentTool.validate!({ description: "Test", prompt: "Test" });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain(
      "Missing required parameter: subagent_type",
    );
  });

  it("should handle execution error", async () => {
    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue({
      name: "Test",
    } as unknown as never);
    vi.mocked(mockSubagentManager.createInstance).mockRejectedValue(
      new Error("Execution failed"),
    );
    const result = await agentTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "Test",
      },
      mockToolContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Agent delegation failed: Execution failed");
  });

  it("should handle invalid subagent type", async () => {
    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(null);
    const result = await agentTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "Invalid",
      },
      mockToolContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No agent found matching "Invalid"');
  });

  it("should format compact params", () => {
    const params = {
      subagent_type: "Explore",
      description: "Find files",
    };
    const formatted = agentTool.formatCompactParams?.(params, mockToolContext);
    expect(formatted).toBe("Explore: Find files");
  });
});
