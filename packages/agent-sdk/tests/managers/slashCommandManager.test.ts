import { describe, it, expect, beforeEach } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";

describe("SlashCommandManager", () => {
  let slashCommandManager: SlashCommandManager;
  let messageManager: MessageManager;

  beforeEach(() => {
    // 创建带有必要回调的 MessageManager
    messageManager = new MessageManager({
      callbacks: {},
    });
    slashCommandManager = new SlashCommandManager({
      messageManager,
    });
  });

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
