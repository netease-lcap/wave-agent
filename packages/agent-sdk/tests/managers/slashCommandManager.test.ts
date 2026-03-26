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
import * as markdownParser from "../../src/utils/markdownParser.js";

// Mock child_process for bash command execution tests
const mockExec = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({
  exec: mockExec,
}));
vi.mock("util", () => ({
  promisify: vi.fn(() => mockExec),
}));

vi.mock("../../src/utils/markdownParser.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    executeBashCommands: vi.fn().mockResolvedValue([
      {
        command: "echo hello",
        output: "bash output",
        exitCode: 0,
      },
    ]),
  };
});

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
    it("should have a built-in clear command", () => {
      const commands = slashCommandManager.getCommands();

      const clearCommand = commands.find((cmd) => cmd.id === "clear");
      expect(clearCommand).toBeDefined();
      expect(clearCommand?.name).toBe("clear");
      expect(clearCommand?.description).toBe(
        "Clear conversation history and reset session",
      );
    });

    it("should be able to check if clear command exists", () => {
      expect(slashCommandManager.hasCommand("clear")).toBe(true);
      expect(slashCommandManager.hasCommand("nonexistent")).toBe(false);
    });

    it("should be able to execute clear command", async () => {
      const result = await slashCommandManager.executeCommand("clear");
      expect(result).toBe(true);
    });

    it("should return false when executing non-existent command", async () => {
      const result = await slashCommandManager.executeCommand("nonexistent");
      expect(result).toBe(false);
    });

    it("should return correct command by id", () => {
      const clearCommand = slashCommandManager.getCommand("clear");
      expect(clearCommand).toBeDefined();
      expect(clearCommand?.id).toBe("clear");

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
      const result = slashCommandManager.parseAndValidateSlashCommand("/clear");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("clear");
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
        slashCommandManager.parseAndValidateSlashCommand("/clear   ");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("clear");
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
        prepareSkill: vi.fn().mockResolvedValue({
          content: "Prepared content",
          skill: { name: "test-skill", allowedTools: ["tool1", "tool2"] },
        }),
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

    it("should register namespaced skill commands", async () => {
      const mockSkillManager = {
        prepareSkill: vi.fn().mockResolvedValue({
          content: "Prepared content",
          skill: { name: "my-plugin:my-skill" },
        }),
        executeSkill: vi.fn().mockResolvedValue({
          content: "Skill content",
        }),
      };

      const container = (
        slashCommandManager as unknown as { container: Container }
      ).container;
      container.register("SkillManager", mockSkillManager);

      const skills = [
        {
          name: "my-plugin:my-skill",
          description: "Test skill description",
          type: "personal",
          skillPath: "/path/to/skill",
          pluginName: "my-plugin",
        },
      ];

      slashCommandManager.registerSkillCommands(
        skills as unknown as SkillMetadata[],
      );

      expect(slashCommandManager.hasCommand("my-plugin:my-skill")).toBe(true);

      const cmd = slashCommandManager.getCommand("my-plugin:my-skill");
      await cmd?.handler("test args");

      expect(mockSkillManager.executeSkill).toHaveBeenCalledWith({
        skill_name: "my-plugin:my-skill",
        args: "test args",
      });
    });

    it("should NOT substitute ${WAVE_SKILL_DIR} in regular slash commands", async () => {
      const pluginName = "test-plugin";
      const commands = [
        {
          id: "path-test",
          name: "path-test",
          content: "Path is ${WAVE_SKILL_DIR}",
        },
      ];

      slashCommandManager.registerPluginCommands(
        pluginName,
        commands as unknown as CustomSlashCommand[],
      );

      const cmd = slashCommandManager.getCommand("test-plugin:path-test");
      await cmd?.handler();

      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks[0] as TextBlock;
      expect(textBlock.customCommandContent).toBe("Path is ${WAVE_SKILL_DIR}");
    });
  });

  describe("Async Update Flow", () => {
    it("should update user message after bash execution in custom command", async () => {
      // Register a custom command with bash
      const customCommand = {
        id: "test-bash",
        name: "test-bash",
        content: "Content with !`echo hello`!",
      };

      slashCommandManager.registerPluginCommands("test", [
        customCommand,
      ] as CustomSlashCommand[]);

      const cmd = slashCommandManager.getCommand("test:test-bash");

      // Spy on messageManager methods
      const addUserMessageSpy = vi.spyOn(messageManager, "addUserMessage");
      const updateUserMessageSpy = vi.spyOn(
        messageManager,
        "updateUserMessage",
      );

      await cmd?.handler();

      expect(addUserMessageSpy).toHaveBeenCalled();
      const messageId = addUserMessageSpy.mock.results[0].value;

      expect(updateUserMessageSpy).toHaveBeenCalledWith(messageId, {
        customCommandContent: expect.stringContaining("bash output"),
      });

      expect(aiManager.sendAIMessage).toHaveBeenCalled();

      // Verify the order: addUserMessage -> executeBashCommands -> updateUserMessage -> sendAIMessage
      const addUserMessageOrder = addUserMessageSpy.mock.invocationCallOrder[0];
      const executeBashOrder = vi.mocked(markdownParser.executeBashCommands)
        .mock.invocationCallOrder[0];
      const updateUserMessageOrder =
        updateUserMessageSpy.mock.invocationCallOrder[0];
      const sendAIMessageOrder = vi.mocked(aiManager.sendAIMessage).mock
        .invocationCallOrder[0];

      expect(addUserMessageOrder).toBeLessThan(executeBashOrder);
      expect(executeBashOrder).toBeLessThan(updateUserMessageOrder);
      expect(updateUserMessageOrder).toBeLessThan(sendAIMessageOrder);
    });

    it("should update user message after bash execution in skill command", async () => {
      const skillMetadata = {
        name: "test-skill",
        description: "Test skill",
        userInvocable: true,
        model: "gpt-4",
        allowedTools: ["tool1"],
      };

      const mockSkillManager = {
        prepareSkill: vi.fn().mockResolvedValue({
          content: "Prepared skill content with !`echo hello`!",
          skill: {
            name: "test-skill",
            model: "gpt-4",
            allowedTools: ["tool1"],
          },
        }),
        executeSkill: vi.fn().mockResolvedValue({
          content: "Final skill content with bash output",
          allowedTools: ["tool1"],
        }),
      };

      const container = (
        slashCommandManager as unknown as { container: Container }
      ).container;
      container.register("SkillManager", mockSkillManager);

      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("test-skill");

      const addUserMessageSpy = vi.spyOn(messageManager, "addUserMessage");
      const updateUserMessageSpy = vi.spyOn(
        messageManager,
        "updateUserMessage",
      );

      await cmd?.handler("args");

      expect(mockSkillManager.prepareSkill).toHaveBeenCalled();
      expect(addUserMessageSpy).toHaveBeenCalled();
      const messageId = addUserMessageSpy.mock.results[0].value;

      expect(mockSkillManager.executeSkill).toHaveBeenCalled();
      expect(updateUserMessageSpy).toHaveBeenCalledWith(messageId, {
        customCommandContent: "Final skill content with bash output",
      });

      expect(aiManager.sendAIMessage).toHaveBeenCalledWith({
        model: "gpt-4",
        allowedRules: ["tool1"],
      });

      // Verify order
      const prepareSkillOrder =
        mockSkillManager.prepareSkill.mock.invocationCallOrder[0];
      const addUserMessageOrder = addUserMessageSpy.mock.invocationCallOrder[0];
      const executeSkillOrder =
        mockSkillManager.executeSkill.mock.invocationCallOrder[0];
      const updateUserMessageOrder =
        updateUserMessageSpy.mock.invocationCallOrder[0];
      const sendAIMessageOrder = vi.mocked(aiManager.sendAIMessage).mock
        .invocationCallOrder[0];

      expect(prepareSkillOrder).toBeLessThan(addUserMessageOrder);
      expect(addUserMessageOrder).toBeLessThan(executeSkillOrder);
      expect(executeSkillOrder).toBeLessThan(updateUserMessageOrder);
      expect(updateUserMessageOrder).toBeLessThan(sendAIMessageOrder);
    });
  });
});
