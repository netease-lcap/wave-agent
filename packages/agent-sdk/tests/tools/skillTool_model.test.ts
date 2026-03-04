import { describe, it, expect, vi, beforeEach } from "vitest";
import { skillTool } from "../../src/tools/skillTool.js";

import type { ToolContext } from "../../src/tools/types.js";
import { GENERAL_PURPOSE_SUBAGENT_TYPE } from "../../src/constants/subagents.js";

describe("skillTool model override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass model to subagentManager.createInstance when context is fork", async () => {
    const mockSkillMetadata = {
      name: "test-skill",
      description: "Test skill",
      context: "fork" as const,
      model: "gpt-4o",
      type: "personal" as const,
      skillPath: "/path/to/skill",
    };

    const mockSkillManager = {
      getSkillMetadata: vi.fn().mockReturnValue(mockSkillMetadata),
      executeSkill: vi.fn().mockResolvedValue({
        content: "Skill content",
        allowedTools: ["tool1"],
      }),
    };

    const mockSubagentManager = {
      findSubagent: vi
        .fn()
        .mockResolvedValue({ name: GENERAL_PURPOSE_SUBAGENT_TYPE, tools: [] }),
      createInstance: vi.fn().mockResolvedValue({
        subagentId: "test-id",
        messageManager: {
          getMessages: vi.fn().mockReturnValue([]),
          getlatestTotalTokens: vi.fn().mockReturnValue(0),
        },
        lastTools: [],
      }),
      executeAgent: vi.fn().mockResolvedValue("Task result"),
      cleanupInstance: vi.fn(),
    };

    const context = {
      skillManager: mockSkillManager,
      subagentManager: mockSubagentManager,
      workdir: "/test",
    } as unknown as ToolContext;

    const result = await skillTool.execute(
      { skill_name: "test-skill" },
      context,
    );

    expect(result.success).toBe(true);
    expect(mockSubagentManager.createInstance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: "gpt-4o",
      }),
      false,
      expect.any(Function),
    );
  });
});
