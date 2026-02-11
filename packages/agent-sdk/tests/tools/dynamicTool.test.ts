import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { createSkillTool } from "../../src/tools/skillTool.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { createTaskTool } from "../../src/tools/taskTool.js";
import type {
  Logger,
  GatewayConfig,
  ModelConfig,
} from "../../src/types/index.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
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

      const tool = createSkillTool(skillManager);

      // Initially no skills
      vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue([]);
      expect(tool.config.function.description).toContain(
        "No skills are currently available",
      );
      const params = tool.config.function.parameters as unknown as {
        properties: {
          skill_name: { enum: string[] };
        };
      };
      expect(params.properties.skill_name.enum).toEqual([]);

      // Add a skill
      const mockSkills = [
        {
          name: "test-skill",
          type: "personal" as const,
          description: "Test skill",
          skillPath: "/path/to/test",
        },
      ];
      vi.spyOn(skillManager, "getAvailableSkills").mockReturnValue(mockSkills);

      // Tool config should now reflect the new skill
      expect(tool.config.function.description).toContain("test-skill");
      const updatedParams = tool.config.function.parameters as unknown as {
        properties: {
          skill_name: { enum: string[] };
        };
      };
      expect(updatedParams.properties.skill_name.enum).toEqual(["test-skill"]);
    });
  });

  describe("Task Tool", () => {
    it("should dynamically reflect subagents added after tool creation", async () => {
      const subagentManager = new SubagentManager({
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
        parentToolManager: {} as unknown as ToolManager,
        parentMessageManager: {} as unknown as MessageManager,
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

      const tool = createTaskTool(subagentManager);

      // Initially no subagents
      vi.spyOn(subagentManager, "getConfigurations").mockReturnValue([]);
      expect(tool.config.function.description).toContain(
        "No subagents configured",
      );
      const params = tool.config.function.parameters as unknown as {
        properties: {
          subagent_type: { description: string };
        };
      };
      expect(params.properties.subagent_type.description).toContain(
        "Available options: none",
      );

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
      vi.spyOn(subagentManager, "getConfigurations").mockReturnValue(
        mockSubagents,
      );

      // Tool config should now reflect the new subagent
      expect(tool.config.function.description).toContain("test-subagent");
      const updatedParams = tool.config.function.parameters as unknown as {
        properties: {
          subagent_type: { description: string };
        };
      };
      expect(updatedParams.properties.subagent_type.description).toContain(
        "Available options: test-subagent",
      );
    });
  });
});
