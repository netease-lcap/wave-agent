import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskTool } from "../../src/tools/taskTool.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { ToolContext, ToolPlugin } from "../../src/tools/types.js";

// Mock the subagent manager
vi.mock("../../src/managers/subagentManager.js");

describe("Task Tool Integration with Built-in Subagents", () => {
  let mockSubagentManager: SubagentManager;
  let taskTool: ToolPlugin;
  const mockToolContext: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
  };

  const exploreConfig: SubagentConfiguration = {
    name: "Explore",
    description:
      "Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns.",
    systemPrompt: "You are a file search specialist...",
    tools: ["Glob", "Grep", "Read", "Bash", "LS", "LSP"],
    model: "fastModel",
    filePath: "<builtin:Explore>",
    scope: "builtin",
    priority: 3,
  };

  const gpConfig: SubagentConfiguration = {
    name: "general-purpose",
    description: "General-purpose agent for researching complex questions...",
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
      getConfigurations: vi.fn(() => [exploreConfig, gpConfig]),
      findSubagent: vi.fn(),
      createInstance: vi.fn(),
      executeTask: vi.fn(),
    } as unknown as SubagentManager;

    // Create task tool with mock manager
    taskTool = createTaskTool(mockSubagentManager);
  });

  describe("Task tool with built-in Explore subagent", () => {
    it("should list Explore subagent in available options", () => {
      const description = taskTool.config.function.description;

      expect(description).toContain("Available subagents:");
      expect(description).toContain(
        "- Explore: Fast agent specialized for exploring codebases",
      );
    });

    it("should include Explore in subagent_type parameter description", () => {
      const params = taskTool.config.function.parameters;
      expect(params).toBeDefined();
      expect(params).toHaveProperty("properties");

      // Type assertion after validation
      const properties = (params as Record<string, unknown>)
        .properties as Record<string, unknown>;
      expect(properties).toHaveProperty("subagent_type");

      const subagentTypeParam = properties.subagent_type as {
        description: string;
      };
      expect(subagentTypeParam.description).toContain("Explore");
    });

    it("should find and execute Explore subagent successfully", async () => {
      const mockInstance = { subagentId: "test-id" };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(
        exploreConfig,
      );
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeTask).mockResolvedValue(
        "Search completed successfully",
      );

      const result = await taskTool.execute(
        {
          description: "Find TypeScript files",
          prompt: "Search for all .ts files in the src directory",
          subagent_type: "Explore",
        },
        mockToolContext,
      );

      expect(mockSubagentManager.findSubagent).toHaveBeenCalledWith("Explore");
      expect(mockSubagentManager.createInstance).toHaveBeenCalledWith(
        exploreConfig,
        {
          description: "Find TypeScript files",
          prompt: "Search for all .ts files in the src directory",
          subagent_type: "Explore",
        },
        undefined,
      );
      expect(mockSubagentManager.executeTask).toHaveBeenCalledWith(
        mockInstance,
        "Search for all .ts files in the src directory",
        mockToolContext.abortSignal,
        undefined,
      );

      expect(result).toEqual({
        success: true,
        content: "Search completed successfully",
        shortResult: "Task completed by Explore",
      });
    });

    it("should include built-in subagents in error message for invalid types", async () => {
      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(null);

      const result = await taskTool.execute(
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: "InvalidAgent",
        },
        mockToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'No subagent found matching "InvalidAgent"',
      );
      expect(result.error).toContain(
        "Available subagents: Explore, general-purpose",
      );
    });

    it("should find and execute general-purpose subagent successfully", async () => {
      const mockInstance = { subagentId: "gp-test-id" };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeTask).mockResolvedValue(
        "Research completed",
      );

      const result = await taskTool.execute(
        {
          description: "Research auth",
          prompt: "Analyze auth flow",
          subagent_type: "general-purpose",
        },
        mockToolContext,
      );

      expect(mockSubagentManager.findSubagent).toHaveBeenCalledWith(
        "general-purpose",
      );
      expect(result.success).toBe(true);
      expect(result.content).toBe("Research completed");
      expect(result.shortResult).toBe("Task completed by general-purpose");
    });

    it("should handle fastModel configuration correctly", async () => {
      const mockInstance = { subagentId: "test-id" };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(
        exploreConfig,
      );
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeTask).mockResolvedValue(
        "Task completed",
      );

      await taskTool.execute(
        {
          description: "Test exploration",
          prompt: "Test prompt",
          subagent_type: "Explore",
        },
        mockToolContext,
      );

      // Verify the configuration passed includes fastModel
      const createInstanceCall = vi.mocked(mockSubagentManager.createInstance)
        .mock.calls[0];
      expect(createInstanceCall[0].model).toBe("fastModel");
    });
  });
});
