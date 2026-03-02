import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { SkillMetadata } from "../../src/types/index.js";
import { Container } from "../../src/utils/container.js";

describe("SlashCommandManager flags", () => {
  let slashCommandManager: SlashCommandManager;
  let messageManager: MessageManager;
  let aiManager: AIManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir: "/test/workdir",
    });

    aiManager = {
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
    } as unknown as AIManager;

    const backgroundTaskManager = {
      getAllTasks: vi.fn(() => []),
      getTask: vi.fn(),
      addTask: vi.fn(),
      generateId: vi.fn(),
    };

    container.register("MessageManager", messageManager);
    container.register("AIManager", aiManager);
    container.register("BackgroundTaskManager", backgroundTaskManager);
    container.register(
      "TaskManager",
      new TaskManager(container, "test-task-list"),
    );

    slashCommandManager = new SlashCommandManager(container, {
      workdir: "/test/workdir",
    });
    slashCommandManager.initialize();
  });

  describe("registerSkillCommands filtering", () => {
    it("should skip skills with userInvocable: false", () => {
      const skills: SkillMetadata[] = [
        {
          name: "invocable-skill",
          description: "Invocable skill",
          type: "personal",
          skillPath: "/path/1",
          userInvocable: true,
        },
        {
          name: "non-invocable-skill",
          description: "Non-invocable skill",
          type: "personal",
          skillPath: "/path/2",
          userInvocable: false,
        },
      ];

      slashCommandManager.registerSkillCommands(skills);

      expect(slashCommandManager.hasCommand("invocable-skill")).toBe(true);
      expect(slashCommandManager.hasCommand("non-invocable-skill")).toBe(false);
    });

    it("should include skills with userInvocable: true or undefined", () => {
      const skills: SkillMetadata[] = [
        {
          name: "invocable-skill-1",
          description: "Invocable skill 1",
          type: "personal",
          skillPath: "/path/1",
          userInvocable: true,
        },
        {
          name: "invocable-skill-2",
          description: "Invocable skill 2",
          type: "personal",
          skillPath: "/path/2",
          // userInvocable is undefined
        },
      ];

      slashCommandManager.registerSkillCommands(skills);

      expect(slashCommandManager.hasCommand("invocable-skill-1")).toBe(true);
      expect(slashCommandManager.hasCommand("invocable-skill-2")).toBe(true);
    });
  });
});
