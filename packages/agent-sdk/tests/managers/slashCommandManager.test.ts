import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import {
  CustomSlashCommand,
  SkillMetadata,
  Skill,
} from "../../src/types/index.js";
import { Container } from "../../src/utils/container.js";
import * as markdownParser from "../../src/utils/markdownParser.js";
import type { SubagentManager } from "../../src/managers/subagentManager.js";
import type { SkillManager } from "../../src/managers/skillManager.js";
import type { TextBlock } from "../../src/types/index.js";

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
  let mockSubagentManager: SubagentManager;
  let mockSkillManager: SkillManager;

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
      setIsLoading: vi.fn(),
      isLoading: false,
    } as unknown as AIManager;

    // Create mock BackgroundTaskManager
    const backgroundTaskManager = {
      getAllTasks: vi.fn(() => []),
      getTask: vi.fn(),
      addTask: vi.fn(),
      generateId: vi.fn(),
    };

    mockSubagentManager = {
      loadConfigurations: vi
        .fn()
        .mockResolvedValue([{ name: "Agent" }, { name: "general-purpose" }]),
      createInstance: vi
        .fn()
        .mockResolvedValue({ subagentId: "test-subagent-id" }),
      executeAgent: vi.fn().mockResolvedValue("Subagent result"),
      cleanupInstance: vi.fn(),
      getInstance: vi.fn().mockReturnValue({
        messages: [],
        aiManager: { getLatestTotalTokens: () => 100 },
        messageManager: { getLatestTotalTokens: () => 100 },
      }),
    } as unknown as SubagentManager;

    mockSkillManager = {
      prepareSkill: vi.fn().mockResolvedValue({
        content: "Prepared content",
        skill: { name: "test-skill", allowedTools: ["tool1", "tool2"] },
      }),
      executeSkill: vi.fn().mockResolvedValue({
        content: "Skill content",
        allowedTools: ["tool1", "tool2"],
      }),
      on: vi.fn(),
    } as unknown as SkillManager;

    container.register("MessageManager", messageManager);
    container.register("AIManager", aiManager);
    container.register("BackgroundTaskManager", backgroundTaskManager);
    container.register("SubagentManager", mockSubagentManager);
    container.register("SkillManager", mockSkillManager);
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
      vi.mocked(mockSkillManager.prepareSkill).mockResolvedValue({
        content: "Prepared content",
        skill: {
          name: "my-plugin:my-skill",
          description: "",
          type: "personal",
          skillPath: "",
          content: "",
          frontmatter: { name: "my-plugin:my-skill", description: "" },
          isValid: true,
          errors: [],
        } as Skill,
      });

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

      // Spy on messageManager methods before execution
      const addUserMessageSpy = vi.spyOn(messageManager, "addUserMessage");
      const updateUserMessageSpy = vi.spyOn(
        messageManager,
        "updateUserMessage",
      );

      await cmd?.handler();

      expect(addUserMessageSpy).toHaveBeenCalled();
      expect(updateUserMessageSpy).toHaveBeenCalled();

      // Verify addUserMessage was called BEFORE executeBashCommands
      const addUserMessageOrder = addUserMessageSpy.mock.invocationCallOrder[0];
      const executeBashOrder = vi.mocked(markdownParser.executeBashCommands)
        .mock.invocationCallOrder[0];
      expect(addUserMessageOrder).toBeLessThan(executeBashOrder);

      // Verify the user message contains the processed content with bash output
      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks[0] as TextBlock;
      expect(textBlock.customCommandContent).toContain("bash output");

      expect(aiManager.sendAIMessage).toHaveBeenCalled();

      // Verify the order: addUserMessage -> executeBashCommands -> updateUserMessage -> sendAIMessage
      const updateUserMessageOrder =
        updateUserMessageSpy.mock.invocationCallOrder[0];
      const sendAIMessageOrder = vi.mocked(aiManager.sendAIMessage).mock
        .invocationCallOrder[0];

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

      vi.mocked(mockSkillManager.prepareSkill).mockResolvedValue({
        content: "Prepared skill content with !`echo hello`!",
        skill: {
          name: "test-skill",
          description: "",
          type: "personal",
          skillPath: "",
          model: "gpt-4",
          allowedTools: ["tool1"],
          content: "",
          frontmatter: { name: "test-skill", description: "" },
          isValid: true,
          errors: [],
        } as Skill,
      });
      vi.mocked(mockSkillManager.executeSkill).mockResolvedValue({
        content: "Final skill content with bash output",
        allowedTools: ["tool1"],
      });

      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("test-skill");

      const addUserMessageSpy = vi.spyOn(messageManager, "addUserMessage");

      await cmd?.handler("args");

      expect(mockSkillManager.prepareSkill).toHaveBeenCalled();
      expect(mockSkillManager.executeSkill).toHaveBeenCalled();

      // Verify addUserMessage was called with processed content
      expect(addUserMessageSpy).toHaveBeenCalledWith({
        content: "/test-skill args",
        customCommandContent: "Final skill content with bash output",
      });

      expect(aiManager.sendAIMessage).toHaveBeenCalledWith({
        model: "gpt-4",
        allowedRules: ["tool1"],
      });

      // Verify order
      const prepareSkillOrder = vi.mocked(mockSkillManager.prepareSkill).mock
        .invocationCallOrder[0];
      const executeSkillOrder = vi.mocked(mockSkillManager.executeSkill).mock
        .invocationCallOrder[0];
      const addUserMessageOrder = addUserMessageSpy.mock.invocationCallOrder[0];
      const sendAIMessageOrder = vi.mocked(aiManager.sendAIMessage).mock
        .invocationCallOrder[0];

      expect(prepareSkillOrder).toBeLessThan(executeSkillOrder);
      expect(executeSkillOrder).toBeLessThan(addUserMessageOrder);
      expect(addUserMessageOrder).toBeLessThan(sendAIMessageOrder);
    });
  });

  describe("Forked Skill Execution", () => {
    it("should execute forked skill using SubagentManager", async () => {
      const skillMetadata = {
        name: "fork-skill",
        description: "Forked skill",
        userInvocable: true,
        context: "fork",
        model: "gpt-4",
      };

      vi.mocked(mockSkillManager.prepareSkill).mockResolvedValue({
        content: "Forked skill content",
        skill: {
          name: "fork-skill",
          description: "Forked skill",
          type: "personal",
          skillPath: "",
          context: "fork",
          model: "gpt-4",
          content: "",
          frontmatter: { name: "fork-skill", description: "Forked skill" },
          isValid: true,
          errors: [],
        } as Skill,
      });

      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");

      const addUserMessageSpy = vi.spyOn(messageManager, "addUserMessage");
      const addToolBlockToMessageSpy = vi.spyOn(
        messageManager,
        "addToolBlockToMessage",
      );
      const updateToolBlockSpy = vi.spyOn(messageManager, "updateToolBlock");

      await cmd?.handler("args");

      expect(mockSubagentManager.createInstance).toHaveBeenCalled();
      expect(mockSubagentManager.executeAgent).toHaveBeenCalled();

      // Verify addUserMessage was called with the skill command
      expect(addUserMessageSpy).toHaveBeenCalledWith({
        content: "/fork-skill args",
        customCommandContent: "Forked skill content",
      });
      const messageId = addUserMessageSpy.mock.results[0].value;

      // Verify addToolBlockToMessage was called
      expect(addToolBlockToMessageSpy).toHaveBeenCalledWith(messageId, {
        name: "fork-skill",
        parameters: "Forked skill content",
        stage: "running",
      });

      // Verify updateToolBlock was called with the final result
      expect(updateToolBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          messageId,
          result: "Subagent result",
          stage: "end",
          success: true,
        }),
      );

      // Verify that main agent is triggered to process the tool result
      expect(aiManager.sendAIMessage).toHaveBeenCalled();
    });

    it("should set success:true on tool block when forked skill completes", async () => {
      const skillMetadata = {
        name: "fork-skill",
        description: "Forked skill",
        userInvocable: true,
        context: "fork",
      };

      vi.mocked(mockSkillManager.prepareSkill).mockResolvedValue({
        content: "Forked skill content",
        skill: {
          name: "fork-skill",
          description: "Forked skill",
          type: "personal",
          skillPath: "",
          context: "fork",
          content: "",
          frontmatter: { name: "fork-skill", description: "Forked skill" },
          isValid: true,
          errors: [],
        } as Skill,
      });

      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");
      const updateToolBlockSpy = vi.spyOn(messageManager, "updateToolBlock");

      await cmd?.handler();

      expect(updateToolBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          result: "Subagent result",
          stage: "end",
          success: true,
        }),
      );
    });

    it("should set success:false on tool block when forked skill errors", async () => {
      const skillMetadata = {
        name: "fork-skill",
        context: "fork",
      };
      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");
      const updateToolBlockSpy = vi.spyOn(messageManager, "updateToolBlock");

      vi.spyOn(mockSubagentManager, "executeAgent").mockRejectedValue(
        new Error("Execution failed"),
      );

      await cmd?.handler();

      expect(updateToolBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          stage: "end",
          error: "Execution failed",
        }),
      );
    });

    it("should handle error when no Agent configuration is found", async () => {
      const skillMetadata = {
        name: "fork-skill",
        context: "fork",
      };
      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");
      const addErrorSpy = vi.spyOn(messageManager, "addErrorBlock");

      // Mock SubagentManager to return empty configurations
      vi.spyOn(mockSubagentManager, "loadConfigurations").mockResolvedValue([]);

      await cmd?.handler();

      expect(addErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Subagent configuration for general-purpose not found",
        ),
      );
    });

    it("should handle error during subagent instance creation", async () => {
      const skillMetadata = {
        name: "fork-skill",
        context: "fork",
      };
      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");
      const updateToolBlockSpy = vi.spyOn(messageManager, "updateToolBlock");

      // Mock SubagentManager to fail creation
      vi.spyOn(mockSubagentManager, "createInstance").mockRejectedValue(
        new Error("Creation failed"),
      );

      await cmd?.handler();

      expect(updateToolBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          stage: "end",
          success: false,
          error: "Creation failed",
        }),
      );
    });

    it("should handle error during subagent execution", async () => {
      const skillMetadata = {
        name: "fork-skill",
        context: "fork",
      };
      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");
      const updateToolBlockSpy = vi.spyOn(messageManager, "updateToolBlock");

      // Mock SubagentManager to fail execution
      vi.spyOn(mockSubagentManager, "executeAgent").mockRejectedValue(
        new Error("Execution failed"),
      );

      await cmd?.handler();

      expect(updateToolBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          stage: "end",
          success: false,
          error: "Execution failed",
        }),
      );
    });

    it("should handle aborting forked skill execution", async () => {
      const skillMetadata = {
        name: "fork-skill",
        context: "fork",
      };
      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");

      // Mock SubagentManager to wait
      let resolveExecute!: (value: string) => void;
      const executePromise = new Promise<string>((resolve) => {
        resolveExecute = resolve;
      });
      vi.mocked(mockSubagentManager.executeAgent).mockReturnValue(
        executePromise,
      );

      const handlerPromise = cmd?.handler();

      // Abort the command
      slashCommandManager.abortCurrentCommand();

      resolveExecute("Finished anyway");
      await handlerPromise;

      expect(mockSubagentManager.cleanupInstance).toHaveBeenCalled();
    });

    it("should include args in content field for custom command execution", async () => {
      // Register a custom command
      const customCommand = {
        id: "test-args",
        name: "test-args",
        content: "Test content",
      };

      slashCommandManager.registerPluginCommands("test", [
        customCommand,
      ] as CustomSlashCommand[]);

      const cmd = slashCommandManager.getCommand("test:test-args");
      await cmd?.handler("arg1 arg2");

      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks[0] as TextBlock;
      expect(textBlock.content).toBe("/test:test-args arg1 arg2");
    });

    it("should set isLoading to false after forked skill completes before calling sendAIMessage", async () => {
      // Forked slash commands need to reset isLoading before calling sendAIMessage
      // because sendAIMessage() has an early return guard when isLoading is true
      const skillMetadata = {
        name: "fork-skill",
        description: "Forked skill",
        userInvocable: true,
        context: "fork",
      };

      vi.mocked(mockSkillManager.prepareSkill).mockResolvedValue({
        content: "Forked skill content",
        skill: {
          name: "fork-skill",
          description: "Forked skill",
          type: "personal",
          skillPath: "",
          context: "fork",
          content: "",
          frontmatter: { name: "fork-skill", description: "Forked skill" },
          isValid: true,
          errors: [],
        } as Skill,
      });

      slashCommandManager.registerSkillCommands([
        skillMetadata,
      ] as unknown as SkillMetadata[]);

      const cmd = slashCommandManager.getCommand("fork-skill");
      await cmd?.handler();

      // Verify setIsLoading is called with both true and false
      const setIsLoadingCalls = vi.mocked(aiManager.setIsLoading).mock.calls;
      expect(setIsLoadingCalls).toContainEqual([true]);
      expect(setIsLoadingCalls).toContainEqual([false]);

      // Verify sendAIMessage was called (proves the early return guard was not hit)
      expect(aiManager.sendAIMessage).toHaveBeenCalled();

      // Verify setIsLoading(false) was called before sendAIMessage
      // by checking mock invocation order
      const setIsLoadingMock = aiManager.setIsLoading as ReturnType<
        typeof vi.fn
      >;
      const sendAIMessageMock = aiManager.sendAIMessage as ReturnType<
        typeof vi.fn
      >;

      // Find the order of setIsLoading(false) call
      const setIsLoadingFalseOrder =
        setIsLoadingMock.mock.invocationCallOrder.find(
          (order, i) => setIsLoadingCalls[i]?.[0] === false,
        );

      // Find the order of sendAIMessage call
      const sendAIMessageOrder = sendAIMessageMock.mock.invocationCallOrder[0];

      expect(setIsLoadingFalseOrder).toBeDefined();
      expect(sendAIMessageOrder).toBeDefined();
      expect(setIsLoadingFalseOrder!).toBeLessThan(sendAIMessageOrder!);
    });
  });
});
