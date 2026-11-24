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
          getLatestTotalTokens: vi.fn().mockReturnValue(0),
        },
        usedTools: [],
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
    // forked 分支的 `data` 照 CC 的 forked schema：`model` 只出现在 inline schema
    // 里，所以这里没有它（技能声明的 model 通过 createInstance 生效）。
    expect(result.data).toStrictEqual({
      success: true,
      commandName: "test-skill",
      status: "forked",
      agentId: "test-id",
      result: "Task result",
    });
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
