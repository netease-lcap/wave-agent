import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../../src/managers/messageManager.js";
import { AIManager } from "../../../src/managers/aiManager.js";
import { SkillManager } from "../../../src/managers/skillManager.js";
import { Container } from "../../../src/utils/container.js";
import type { TextBlock } from "../../../src/types/index.js";

describe("/loop execution integration", () => {
  let slashCommandManager: SlashCommandManager;
  let aiManager: AIManager;
  let messageManager: MessageManager;
  let skillManager: SkillManager;
  let container: Container;

  beforeEach(async () => {
    vi.clearAllMocks();
    container = new Container();

    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir: "/test/workdir",
    });

    aiManager = {
      sendAIMessage: vi.fn().mockResolvedValue(undefined),
      abortAIMessage: vi.fn(),
    } as unknown as AIManager;

    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });

    container.register("MessageManager", messageManager);
    container.register("AIManager", aiManager);
    container.register("SkillManager", skillManager);

    slashCommandManager = new SlashCommandManager(container, {
      workdir: "/test/workdir",
    });

    // Initialize skill manager and slash command manager
    await skillManager.initialize();
    slashCommandManager.initialize();

    // Manually register the loop skill if it's not found automatically
    // (In tests, the builtin skills dir might be different)
    const loopSkillMetadata = skillManager.getSkillMetadata("loop");
    if (loopSkillMetadata) {
      slashCommandManager.registerSkillCommands([loopSkillMetadata]);
    }
  });

  it("should register /loop command", () => {
    expect(slashCommandManager.hasCommand("loop")).toBe(true);
  });

  it("should invoke /loop skill and send message to AI", async () => {
    const cmd = slashCommandManager.getCommand("loop");
    expect(cmd).toBeDefined();

    await cmd?.handler("5m /echo hello");

    // Verify that a user message was added with the processed skill content
    const messages = messageManager.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const textBlock = messages[messages.length - 1].blocks[0] as TextBlock;
    expect(textBlock.type).toBe("text");
    expect(textBlock.customCommandContent).toContain(
      "# /loop — schedule a recurring prompt",
    );
    expect(textBlock.customCommandContent).toContain("5m /echo hello");

    // Verify that aiManager.sendAIMessage was called
    expect(aiManager.sendAIMessage).toHaveBeenCalled();
  });

  it("should handle trailing every clause", async () => {
    const cmd = slashCommandManager.getCommand("loop");
    await cmd?.handler("check the build every 2h");

    const messages = messageManager.getMessages();
    const textBlock = messages[messages.length - 1].blocks[0] as TextBlock;
    expect(textBlock.customCommandContent).toContain(
      "check the build every 2h",
    );
  });
});
