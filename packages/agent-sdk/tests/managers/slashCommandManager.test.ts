import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { AIManager } from "../../src/managers/aiManager.js";

describe("SlashCommandManager", () => {
  let slashCommandManager: SlashCommandManager;
  let messageManager: MessageManager;
  let aiManager: AIManager;

  beforeEach(() => {
    // 创建带有必要回调的 MessageManager
    messageManager = new MessageManager({
      callbacks: {},
      workdir: "/test/workdir",
    });

    // 创建模拟的 AIManager
    aiManager = {
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
    } as unknown as AIManager;

    slashCommandManager = new SlashCommandManager({
      messageManager,
      aiManager,
      workdir: "/test/workdir",
    });
  });

  describe("Basic Command Management", () => {
    it("should have a built-in clear command", () => {
      const commands = slashCommandManager.getCommands();

      const clearCommand = commands.find((cmd) => cmd.id === "clear");
      expect(clearCommand).toBeDefined();
      expect(clearCommand?.name).toBe("clear");
      expect(clearCommand?.description).toBe("Clear the chat session");
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
});
