import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import {
  CustomSlashCommand,
  TextBlock,
  SkillMetadata,
} from "../../src/types/index.js";
import { Container } from "../../src/utils/container.js";

// Mock child_process for bash command execution tests
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({
  exec: mockExec,
}));
vi.mock("util", () => ({
  promisify: vi.fn(() => mockExec),
}));

describe("SlashCommandManager", () => {
  let slashCommandManager: SlashCommandManager;
  let messageManager: MessageManager;
  let aiManager: AIManager;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    const container = new Container();
    // Create MessageManager with necessary callbacks
    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir: "/test/workdir",
    });

    // Create mock AIManager
    aiManager = {
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
    } as unknown as AIManager;

    // Create mock BackgroundTaskManager
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

  describe("Basic Command Management", () => {
    it("should have a built-in init command", () => {
      const commands = slashCommandManager.getCommands();

      const initCommand = commands.find((cmd) => cmd.id === "init");
      expect(initCommand).toBeDefined();
      expect(initCommand?.name).toBe("init");
      expect(initCommand?.description).toBe(
        "Initialize repository for AI agents by generating AGENTS.md",
      );
    });

    it("should be able to check if init command exists", () => {
      expect(slashCommandManager.hasCommand("init")).toBe(true);
      expect(slashCommandManager.hasCommand("nonexistent")).toBe(false);
    });

    it("should be able to execute init command", async () => {
      const result = await slashCommandManager.executeCommand("init");
      expect(result).toBe(true);
    });

    it("should return false when executing non-existent command", async () => {
      const result = await slashCommandManager.executeCommand("nonexistent");
      expect(result).toBe(false);
    });

    it("should return correct command by id", () => {
      const initCommand = slashCommandManager.getCommand("init");
      expect(initCommand).toBeDefined();
      expect(initCommand?.id).toBe("init");

      const nonExistentCommand = slashCommandManager.getCommand("nonexistent");
      expect(nonExistentCommand).toBeUndefined();
    });
  });

  describe("parseAndValidateSlashCommand", () => {
    it("should handle non-existent slash commands", () => {
      const result = slashCommandManager.parseAndValidateSlashCommand(
        "/nonexistent some args",
      );

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
    });

    it("should validate existing slash commands correctly", () => {
      const result = slashCommandManager.parseAndValidateSlashCommand("/init");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("init");
      expect(result.args).toBeUndefined();
    });

    it("should parse command arguments correctly for valid commands", () => {
      // First register a test command that accepts arguments
      const testCommand = {
        id: "test",
        name: "test",
        description: "Test command",
        handler: vi.fn(),
      };

      // Access the private commands Map to add our test command
      const commandsMap = (
        slashCommandManager as unknown as { commands: Map<string, unknown> }
      ).commands;
      commandsMap.set("test", testCommand);

      const result =
        slashCommandManager.parseAndValidateSlashCommand("/test arg1 arg2");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("test");
      expect(result.args).toBe("arg1 arg2");
    });

    it("should handle malformed slash command input gracefully", () => {
      // Test with empty command after slash
      const result1 = slashCommandManager.parseAndValidateSlashCommand("/");
      expect(result1.isValid).toBe(false);

      // Test with just slash and spaces
      const result2 = slashCommandManager.parseAndValidateSlashCommand("/   ");
      expect(result2.isValid).toBe(false);
    });

    it("should handle command with empty args correctly", () => {
      const result =
        slashCommandManager.parseAndValidateSlashCommand("/init   ");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("init");
      expect(result.args).toBeUndefined(); // Empty args should be undefined
    });

    it("should handle parsing errors gracefully", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      // Test with input that doesn't start with /
      const result = slashCommandManager.parseAndValidateSlashCommand("clear");

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
    });
  });

  describe("registerPluginCommands", () => {
    it("should register plugin commands with colon separator", () => {
      const pluginName = "test-plugin";
      const commands = [
        {
          id: "cmd1",
          name: "cmd1",
          description: "desc1",
          content: "content1",
        },
      ];

      slashCommandManager.registerPluginCommands(
        pluginName,
        commands as unknown as CustomSlashCommand[],
      );

      expect(slashCommandManager.hasCommand("test-plugin:cmd1")).toBe(true);
      const cmd = slashCommandManager.getCommand("test-plugin:cmd1");
      expect(cmd?.name).toBe("test-plugin:cmd1");
    });

    it("should append arguments to content if no placeholders are present", async () => {
      const pluginName = "test-plugin";
      const commands = [
        {
          id: "append-test",
          name: "append-test",
          content: "Base content",
        },
      ];

      slashCommandManager.registerPluginCommands(
        pluginName,
        commands as unknown as CustomSlashCommand[],
      );

      const cmd = slashCommandManager.getCommand("test-plugin:append-test");
      await cmd?.handler("extra arguments");

      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks[0] as TextBlock;
      expect(textBlock.customCommandContent).toBe(
        "Base content extra arguments",
      );
    });
  });

  describe("registerSkillCommands", () => {
    it("should register skill commands and pass allowedTools to aiManager", async () => {
      const mockSkillManager = {
        executeSkill: vi.fn().mockResolvedValue({
          content: "Skill content",
          allowedTools: ["tool1", "tool2"],
        }),
      };

      const container = (
        slashCommandManager as unknown as { container: Container }
      ).container;
      container.register("SkillManager", mockSkillManager);

      const skills = [
        {
          name: "test-skill",
          description: "Test skill description",
          type: "personal",
          skillPath: "/path/to/skill",
          allowedTools: ["tool1", "tool2"],
        },
      ];

      slashCommandManager.registerSkillCommands(
        skills as unknown as SkillMetadata[],
      );

      expect(slashCommandManager.hasCommand("test-skill")).toBe(true);

      const cmd = slashCommandManager.getCommand("test-skill");
      await cmd?.handler("test args");

      expect(mockSkillManager.executeSkill).toHaveBeenCalledWith({
        skill_name: "test-skill",
        args: "test args",
      });

      expect(aiManager.sendAIMessage).toHaveBeenCalledWith({
        allowedRules: ["tool1", "tool2"],
      });
    });
  });
});
