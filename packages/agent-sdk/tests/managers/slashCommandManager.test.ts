import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { CustomSlashCommand, TextBlock } from "../../src/types/index.js";

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
    // Create MessageManager with necessary callbacks
    messageManager = new MessageManager({
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

    slashCommandManager = new SlashCommandManager({
      messageManager,
      aiManager,
      backgroundTaskManager:
        backgroundTaskManager as unknown as BackgroundTaskManager,
      workdir: "/test/workdir",
    });
  });

  describe("Basic Command Management", () => {
    it("should have a built-in clear command", () => {
      const commands = slashCommandManager.getCommands();

      const clearCommand = commands.find((cmd) => cmd.id === "clear");
      expect(clearCommand).toBeDefined();
      expect(clearCommand?.name).toBe("clear");
      expect(clearCommand?.description).toBe(
        "Clear the chat session and terminal",
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

    it("should have a built-in init command", () => {
      const commands = slashCommandManager.getCommands();

      const initCommand = commands.find((cmd) => cmd.id === "init");
      expect(initCommand).toBeDefined();
      expect(initCommand?.name).toBe("init");
      expect(initCommand?.description).toBe(
        "Initialize repository for AI agents by generating AGENTS.md",
      );
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
      // Mock parseSlashCommandInput to throw an error
      const originalConsoleError = console.error;
      console.error = vi.fn();

      // Test with input that doesn't start with /
      const result = slashCommandManager.parseAndValidateSlashCommand("clear");

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
      expect(console.error).toHaveBeenCalled();

      console.error = originalConsoleError;
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

    it("should substitute $WAVE_PLUGIN_ROOT placeholder for plugin commands with bash", async () => {
      const pluginName = "test-plugin";
      const pluginPath = "/path/to/plugin";
      const commands = [
        {
          id: "env-test",
          name: "env-test",
          content: "Test command\n!`echo $WAVE_PLUGIN_ROOT`",
          pluginPath,
          filePath: `${pluginPath}/commands/env-test.md`,
          isNested: false,
          depth: 0,
          segments: ["env-test"],
        },
      ];

      // Mock bash execution to return the plugin path
      mockExec.mockResolvedValueOnce({
        stdout: pluginPath,
        stderr: "",
      });

      slashCommandManager.registerPluginCommands(
        pluginName,
        commands as unknown as CustomSlashCommand[],
      );

      const cmd = slashCommandManager.getCommand("test-plugin:env-test");
      await cmd?.handler();

      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks[0] as TextBlock;

      // Verify bash command was called with $WAVE_PLUGIN_ROOT already substituted
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining(`echo ${pluginPath}`),
        expect.objectContaining({
          cwd: expect.any(String),
          timeout: 30000,
        }),
      );

      // The bash command output should contain the plugin path
      expect(textBlock.customCommandContent).toContain(pluginPath);
    });

    it("should not substitute $WAVE_PLUGIN_ROOT for non-plugin commands", async () => {
      const pluginName = "test-plugin";
      const commands = [
        {
          id: "no-plugin-path",
          name: "no-plugin-path",
          content: 'Test command\n!`echo "VAR: $WAVE_PLUGIN_ROOT"`',
          filePath: "/test/commands/no-plugin-path.md",
          isNested: false,
          depth: 0,
          segments: ["no-plugin-path"],
        },
      ];

      // Mock bash execution - $WAVE_PLUGIN_ROOT should remain as-is
      mockExec.mockResolvedValueOnce({
        stdout: "VAR: $WAVE_PLUGIN_ROOT",
        stderr: "",
      });

      slashCommandManager.registerPluginCommands(
        pluginName,
        commands as unknown as CustomSlashCommand[],
      );

      const cmd = slashCommandManager.getCommand("test-plugin:no-plugin-path");
      await cmd?.handler();

      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks[0] as TextBlock;

      // Verify bash command was called with $WAVE_PLUGIN_ROOT NOT substituted
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('echo "VAR: $WAVE_PLUGIN_ROOT"'),
        expect.objectContaining({
          cwd: expect.any(String),
          timeout: 30000,
        }),
      );

      // Without pluginPath, $WAVE_PLUGIN_ROOT should remain in output
      expect(textBlock.customCommandContent).toContain(
        "VAR: $WAVE_PLUGIN_ROOT",
      );
    });
  });
});
