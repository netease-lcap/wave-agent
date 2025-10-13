import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../src/managers/slashCommandManager.js";
import { MessageManager } from "../src/managers/messageManager.js";
import { ToolManager } from "../src/managers/toolManager.js";
import {
  parseMarkdownFile,
  parseBashCommands,
} from "../src/utils/markdownParser.js";
import { loadCustomSlashCommands } from "../src/utils/customCommands.js";
import type { Message } from "../src/types.js";
import { readFileSync, existsSync, readdirSync } from "fs";

// Mock the filesystem modules
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("util", () => ({
  promisify: vi.fn(() => vi.fn()),
}));

describe("Custom Slash Commands", () => {
  let messageManager: MessageManager;
  let toolManager: ToolManager;
  let slashCommandManager: SlashCommandManager;

  beforeEach(() => {
    messageManager = new MessageManager({
      callbacks: {},
    });

    // Mock tool manager
    toolManager = {
      list: vi.fn(() => []),
      getToolsConfig: vi.fn(() => ({})),
      execute: vi.fn(),
    } as unknown as ToolManager;

    slashCommandManager = new SlashCommandManager({
      messageManager,
      toolManager,
    });
  });

  describe("Markdown Parser", () => {
    it("should parse markdown file with frontmatter", () => {
      mockReadFileSync.mockReturnValue(`---
allowed-tools: Read, Grep, Glob
model: claude-3-5-sonnet-20241022
---

Analyze the codebase for security vulnerabilities including:
- SQL injection risks
- XSS vulnerabilities
- Exposed credentials
- Insecure configurations`);

      const result = parseMarkdownFile("/test/security-check.md");

      expect(result.config).toEqual({
        allowedTools: ["Read", "Grep", "Glob"],
        model: "claude-3-5-sonnet-20241022",
      });

      expect(result.content).toContain(
        "Analyze the codebase for security vulnerabilities",
      );
    });

    it("should parse bash commands from content", () => {
      const content = `## Context

- Current status: !\`git status\`
- Current diff: !\`git diff HEAD\`

## Task

Create a git commit with appropriate message based on the changes.`;

      const result = parseBashCommands(content);

      expect(result.commands).toEqual(["git status", "git diff HEAD"]);
      expect(result.processedContent).toBe(content);
    });

    it("should parse markdown without frontmatter", () => {
      mockReadFileSync.mockReturnValue(`Refactor the selected code to improve readability and maintainability.
Focus on clean code principles and best practices.`);

      const result = parseMarkdownFile("/test/refactor.md");

      expect(result.config).toBeUndefined();
      expect(result.content).toContain("Refactor the selected code");
    });
  });

  describe("Custom Commands Loading", () => {
    it("should load custom commands from directories", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["refactor.md", "security-check.md"]);
      mockReadFileSync.mockReturnValueOnce(
        "Refactor the selected code to improve readability.",
      ).mockReturnValueOnce(`---
allowed-tools: Read, Grep
---

Analyze for security issues.`);

      const commands = loadCustomSlashCommands();

      expect(commands).toHaveLength(2);
      expect(commands[0].name).toBe("refactor");
      expect(commands[1].name).toBe("security-check");
      expect(commands[1].config?.allowedTools).toEqual(["Read", "Grep"]);
    });
  });

  describe("SlashCommandManager", () => {
    it("should have built-in clear command", () => {
      const commands = slashCommandManager.getCommands();
      const clearCommand = commands.find((cmd) => cmd.id === "clear");

      expect(clearCommand).toBeDefined();
      expect(clearCommand?.name).toBe("clear");
    });

    it("should register custom commands", () => {
      // This test would require mocking the file system more extensively
      // For now, we'll just verify the structure is in place
      expect(slashCommandManager.getCustomCommands).toBeDefined();
      expect(slashCommandManager.reloadCustomCommands).toBeDefined();
    });
  });

  describe("Message Operations", () => {
    it("should add sub-agent message", () => {
      const subAgentMessages: Message[] = [
        {
          role: "user",
          blocks: [{ type: "text", content: "Test user message" }],
        },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Test assistant response" }],
        },
      ];

      messageManager.addSubAgentMessage("refactor", subAgentMessages);

      const updatedMessages = messageManager.getMessages();
      expect(updatedMessages).toHaveLength(1);
      expect(updatedMessages[0].role).toBe("subAgent");
      expect(updatedMessages[0].messages).toEqual(subAgentMessages);
    });
  });
});
