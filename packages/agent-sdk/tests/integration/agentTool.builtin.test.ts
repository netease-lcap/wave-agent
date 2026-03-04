import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { agentTool } from "../../src/tools/agentTool.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { ToolContext } from "../../src/tools/types.js";

// Mock the subagent manager
vi.mock("../../src/managers/subagentManager.js");

describe("Agent Tool Integration with Built-in Subagents", () => {
  let mockSubagentManager: SubagentManager;
  const mockToolContext: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
    taskManager: {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    } as unknown as TaskManager,
    subagentManager: {
      getConfigurations: vi.fn(() => [exploreConfig, gpConfig, planConfig]),
      findSubagent: vi.fn(),
      createInstance: vi.fn(),
      executeAgent: vi.fn(),
      backgroundInstance: vi.fn(),
      cleanupInstance: vi.fn(),
    } as unknown as SubagentManager,
  };

  const exploreConfig: SubagentConfiguration = {
    name: "Explore",
    description:
      "Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns.",
    systemPrompt: "You are a file search specialist...",
    tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
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

  const planConfig: SubagentConfiguration = {
    name: "Plan",
    description:
      "Software architect agent for designing implementation plans...",
    systemPrompt: "You are a software architect...",
    tools: ["Glob", "Grep", "Read", "Bash", "LSP"],
    model: "inherit",
    filePath: "<builtin:Plan>",
    scope: "builtin",
    priority: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Update mock subagent manager in context
    mockSubagentManager = mockToolContext.subagentManager!;
  });

  describe("Agent tool with built-in Explore subagent", () => {
    it("should list Explore subagent in available options", () => {
      const prompt = agentTool.prompt?.({
        availableSubagents: [exploreConfig, gpConfig, planConfig],
      });

      expect(prompt).toContain(
        "Available agent types and the tools they have access to:",
      );
      expect(prompt).toContain(
        "- Explore: Fast agent specialized for exploring codebases",
      );
    });

    it("should include Explore in subagent_type parameter description", () => {
      const prompt = agentTool.prompt?.({
        availableSubagents: [exploreConfig, gpConfig, planConfig],
      });
      expect(prompt).toContain("Explore");
    });

    it("should find and execute Explore subagent successfully", async () => {
      const mockInstance = {
        subagentId: "test-id",
        lastTools: [],
        messageManager: {
          getMessages: vi.fn(() => []),
          getlatestTotalTokens: vi.fn(() => 0),
        },
      };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(
        exploreConfig,
      );
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as unknown as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
        "Search completed successfully",
      );

      const result = await agentTool.execute(
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
        expect.any(Function),
      );
      expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
        mockInstance,
        "Search for all .ts files in the src directory",
        mockToolContext.abortSignal,
        undefined,
      );

      expect(result).toEqual({
        success: true,
        content: "Search completed successfully",
        shortResult: "Agent completed",
      });
    });

    it("should include built-in subagents in error message for invalid types", async () => {
      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(null);

      const result = await agentTool.execute(
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: "InvalidAgent",
        },
        mockToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent found matching "InvalidAgent"');
      expect(result.error).toContain(
        "Available agents: Explore, general-purpose",
      );
    });

    it("should find and execute general-purpose subagent successfully", async () => {
      const mockInstance = {
        subagentId: "gp-test-id",
        lastTools: [],
        messageManager: {
          getMessages: vi.fn(() => []),
          getlatestTotalTokens: vi.fn(() => 0),
        },
      };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as unknown as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
        "Research completed",
      );

      const result = await agentTool.execute(
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
      expect(result.shortResult).toBe("Agent completed");
    });

    it("should handle fastModel configuration correctly", async () => {
      const mockInstance = {
        subagentId: "test-id",
        lastTools: [],
        messageManager: {
          getMessages: vi.fn(() => []),
          getlatestTotalTokens: vi.fn(() => 0),
        },
      };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(
        exploreConfig,
      );
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as unknown as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
        "Agent completed",
      );

      await agentTool.execute(
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

  describe("Agent tool with built-in Plan subagent", () => {
    it("should list Plan subagent in available options", () => {
      const prompt = agentTool.prompt?.({
        availableSubagents: [exploreConfig, gpConfig, planConfig],
      });

      expect(prompt).toContain(
        "Available agent types and the tools they have access to:",
      );
      expect(prompt).toContain(
        "- Plan: Software architect agent for designing implementation plans",
      );
    });

    it("should include Plan in subagent_type parameter description", () => {
      const prompt = agentTool.prompt?.({
        availableSubagents: [exploreConfig, gpConfig, planConfig],
      });
      expect(prompt).toContain("Plan");
    });

    it("should find and execute Plan subagent successfully", async () => {
      const mockInstance = {
        subagentId: "plan-test-id",
        lastTools: [],
        messageManager: {
          getMessages: vi.fn(() => []),
          getlatestTotalTokens: vi.fn(() => 0),
        },
      };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(planConfig);
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as unknown as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
        "Plan completed successfully\n\n### Critical Files for Implementation\n- src/main.ts",
      );

      const result = await agentTool.execute(
        {
          description: "Design auth implementation",
          prompt: "Design implementation plan for adding authentication",
          subagent_type: "Plan",
        },
        mockToolContext,
      );

      expect(mockSubagentManager.findSubagent).toHaveBeenCalledWith("Plan");
      expect(mockSubagentManager.createInstance).toHaveBeenCalledWith(
        planConfig,
        {
          description: "Design auth implementation",
          prompt: "Design implementation plan for adding authentication",
          subagent_type: "Plan",
        },
        undefined,
        expect.any(Function),
      );
      expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
        mockInstance,
        "Design implementation plan for adding authentication",
        mockToolContext.abortSignal,
        undefined,
      );

      expect(result).toEqual({
        success: true,
        content:
          "Plan completed successfully\n\n### Critical Files for Implementation\n- src/main.ts",
        shortResult: "Agent completed",
      });
    });

    it("should handle inherit model configuration correctly", async () => {
      const mockInstance = {
        subagentId: "plan-test-id",
        lastTools: [],
        messageManager: {
          getMessages: vi.fn(() => []),
          getlatestTotalTokens: vi.fn(() => 0),
        },
      };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(planConfig);
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as unknown as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
        "Plan completed",
      );

      await agentTool.execute(
        {
          description: "Test planning",
          prompt: "Test prompt",
          subagent_type: "Plan",
        },
        mockToolContext,
      );

      // Verify the configuration passed includes inherit model
      const createInstanceCall = vi.mocked(mockSubagentManager.createInstance)
        .mock.calls[0];
      expect(createInstanceCall[0].model).toBe("inherit");
    });

    it("should verify Plan subagent has read-only tools", async () => {
      const mockInstance = {
        subagentId: "plan-test-id",
        lastTools: [],
        messageManager: {
          getMessages: vi.fn(() => []),
          getlatestTotalTokens: vi.fn(() => 0),
        },
      };

      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(planConfig);
      vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
        mockInstance as unknown as SubagentInstance,
      );
      vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue(
        "Plan completed",
      );

      await agentTool.execute(
        {
          description: "Test planning",
          prompt: "Test prompt",
          subagent_type: "Plan",
        },
        mockToolContext,
      );

      // Verify the configuration has only read-only tools
      const createInstanceCall = vi.mocked(mockSubagentManager.createInstance)
        .mock.calls[0];
      const config = createInstanceCall[0];
      expect(config.tools).toContain("Glob");
      expect(config.tools).toContain("Grep");
      expect(config.tools).toContain("Read");
      expect(config.tools).not.toContain("Write");
      expect(config.tools).not.toContain("Edit");
    });

    it("should include Plan subagent in error message for invalid types", async () => {
      vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(null);

      const result = await agentTool.execute(
        {
          description: "Test task",
          prompt: "Test prompt",
          subagent_type: "InvalidAgent",
        },
        mockToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent found matching "InvalidAgent"');
      expect(result.error).toContain(
        "Available agents: Explore, general-purpose, Plan",
      );
    });
  });
});
