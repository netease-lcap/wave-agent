import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskTool } from "../../src/tools/taskTool.js";
import { TaskManager } from "../../src/services/taskManager.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { ToolContext, ToolPlugin } from "../../src/tools/types.js";

// Mock the subagent manager
vi.mock("../../src/managers/subagentManager.js");

describe("Task Tool Background Execution", () => {
  let mockSubagentManager: SubagentManager;
  let taskTool: ToolPlugin;
  const mockToolContext: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
    taskManager: new TaskManager("test-session"),
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
      executeTask: vi.fn(),
    } as unknown as SubagentManager;

    // Create task tool with mock manager
    taskTool = createTaskTool(mockSubagentManager);
  });

  it("should support run_in_background parameter", async () => {
    const mockInstance = { subagentId: "gp-test-id" };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
      mockInstance as SubagentInstance,
    );
    vi.mocked(mockSubagentManager.executeTask).mockResolvedValue(
      "task_12345", // Returns task ID when background is true
    );

    const result = await taskTool.execute(
      {
        description: "Background task",
        prompt: "Do something in background",
        subagent_type: "general-purpose",
        run_in_background: true,
      },
      mockToolContext,
    );

    expect(mockSubagentManager.executeTask).toHaveBeenCalledWith(
      mockInstance,
      "Do something in background",
      mockToolContext.abortSignal,
      true, // background parameter
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Task started in background");
    expect(result.content).toContain("task_12345");
    expect(result.shortResult).toBe("Task started in background: task_12345");
  });

  it("should handle missing parameters", async () => {
    const result = await taskTool.execute({}, mockToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("description parameter is required");
  });

  it("should handle missing prompt", async () => {
    const result = await taskTool.execute(
      { description: "Test" },
      mockToolContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("prompt parameter is required");
  });

  it("should handle missing subagent_type", async () => {
    const result = await taskTool.execute(
      { description: "Test", prompt: "Test" },
      mockToolContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("subagent_type parameter is required");
  });

  it("should handle execution error", async () => {
    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue({
      name: "Test",
    } as unknown as never);
    vi.mocked(mockSubagentManager.createInstance).mockRejectedValue(
      new Error("Execution failed"),
    );
    const result = await taskTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "Test",
      },
      mockToolContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Task delegation failed: Execution failed");
  });

  it("should handle invalid subagent type", async () => {
    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(null);
    const result = await taskTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "Invalid",
      },
      mockToolContext,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No subagent found matching "Invalid"');
  });

  it("should format compact params", () => {
    const params = {
      subagent_type: "Explore",
      description: "Find files",
    };
    const formatted = taskTool.formatCompactParams?.(params, mockToolContext);
    expect(formatted).toBe("Explore: Find files");
  });
});
