import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { Container } from "../../src/utils/container.js";
import type { SkillMetadata } from "../../src/types/skills.js";

describe("SlashCommandManager model override", () => {
  let slashCommandManager: SlashCommandManager;
  let aiManager: AIManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();

    const messageManager = new MessageManager(container, {
      callbacks: {},
      workdir: "/test/workdir",
    });

    aiManager = {
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
    } as unknown as AIManager;

    container.register("MessageManager", messageManager);
    container.register("AIManager", aiManager);

    slashCommandManager = new SlashCommandManager(container, {
      workdir: "/test/workdir",
    });
    slashCommandManager.initialize();
  });

  it("should pass model to aiManager.sendAIMessage when skill command is executed", async () => {
    const mockSkillManager = {
      prepareSkill: vi.fn().mockResolvedValue({
        content: "Prepared content",
        skill: { name: "test-skill", model: "gpt-4o", allowedTools: ["tool1"] },
      }),
      executeSkill: vi.fn().mockResolvedValue({
        content: "Skill content",
        allowedTools: ["tool1"],
      }),
    };

    const container = (
      slashCommandManager as unknown as { container: Container }
    ).container;
    container.register("SkillManager", mockSkillManager);

    const skills: SkillMetadata[] = [
      {
        name: "test-skill",
        description: "Test skill description",
        type: "personal",
        skillPath: "/path/to/skill",
        model: "gpt-4o",
      },
    ];

    slashCommandManager.registerSkillCommands(skills);

    const cmd = slashCommandManager.getCommand("test-skill");
    await cmd?.handler("test args");

    expect(aiManager.sendAIMessage).toHaveBeenCalledWith({
      model: "gpt-4o",
      allowedRules: ["tool1"],
    });
  });
});
