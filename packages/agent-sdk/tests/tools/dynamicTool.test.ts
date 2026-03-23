import { describe, it, expect, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { skillTool } from "../../src/tools/skillTool.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { agentTool } from "../../src/tools/agentTool.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import { Container } from "../../src/utils/container.js";

describe("Dynamic Tool Definitions", () => {
  const container = new Container();

  beforeEach(() => {});

  describe("Skill Tool", () => {
    it("should dynamically reflect skills added after tool creation", async () => {
      const skillManager = new SkillManager(container, {
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

  describe("Agent Tool", () => {
    it("should dynamically reflect subagents added after tool creation", async () => {
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => ({}) as unknown as GatewayConfig,
        resolveModelConfig: () => ({}) as unknown as ModelConfig,
        resolveMaxInputTokens: () => 1000,
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => undefined,
      });

      const subagentManager = new SubagentManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      // Mock initialization
      (
        subagentManager as unknown as {
          cachedConfigurations: SubagentConfiguration[];
        }
      ).cachedConfigurations = [];

      const tool = agentTool;

      // Initially no subagents
      const promptNoSubagents = tool.prompt?.({ availableSubagents: [] });
      expect(promptNoSubagents).toContain("No agents configured");

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
