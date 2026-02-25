import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { skillTool } from "../../src/tools/skillTool.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { taskTool } from "../../src/tools/taskTool.js";
import type {
  Logger,
  GatewayConfig,
  ModelConfig,
} from "../../src/types/index.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

describe("Dynamic Tool Definitions", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
  });

  describe("Skill Tool", () => {
    it("should dynamically reflect skills added after tool creation", async () => {
      const skillManager = new SkillManager({
        logger: mockLogger,
        workdir: "/test/workdir",
      });

      // Mock initialization to avoid fs calls
      (skillManager as unknown as { initialized: boolean }).initialized = true;

      const tool = skillTool;

      // Initially no skills
      const promptNoSkills = tool.prompt?.({ availableSkills: [] });
      expect(promptNoSkills).toContain("No skills are currently available");

      // Add a skill
      const mockSkills = [
        {
          name: "test-skill",
          type: "personal" as const,
          description: "Test skill",
          skillPath: "/path/to/test",
        },
      ];

      // Tool prompt should now reflect the new skill
      const promptWithSkills = tool.prompt?.({ availableSkills: mockSkills });
      expect(promptWithSkills).toContain("test-skill");
    });
  });

  describe("Task Tool", () => {
    it("should dynamically reflect subagents added after tool creation", async () => {
      const subagentManager = new SubagentManager({
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
        parentToolManager: {} as unknown as ToolManager,
        logger: mockLogger,
        getGatewayConfig: () => ({}) as unknown as GatewayConfig,
        getModelConfig: () => ({}) as unknown as ModelConfig,
        getMaxInputTokens: () => 1000,
        onUsageAdded: () => {},
        getLanguage: () => undefined,
      });

      // Mock initialization
      (
        subagentManager as unknown as {
          cachedConfigurations: SubagentConfiguration[];
        }
      ).cachedConfigurations = [];

      const tool = taskTool;

      // Initially no subagents
      const promptNoSubagents = tool.prompt?.({ availableSubagents: [] });
      expect(promptNoSubagents).toContain("No subagents configured");

      // Add a subagent
      const mockSubagents: SubagentConfiguration[] = [
        {
          name: "test-subagent",
          description: "Test subagent",
          systemPrompt: "You are a test subagent",
          filePath: "/path/to/test-subagent.md",
          scope: "project",
          priority: 1,
        },
      ];

      // Tool prompt should now reflect the new subagent
      const promptWithSubagents = tool.prompt?.({
        availableSubagents: mockSubagents,
      });
      expect(promptWithSubagents).toContain("test-subagent");
    });
  });
});
