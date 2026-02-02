import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { existsSync, readdirSync, statSync } from "fs";

// Mock the fs operations for custom command discovery
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false, isFile: () => true })),
}));

// Mock the markdownParser
vi.mock("../../src/utils/markdownParser.js", () => ({
  parseMarkdownFile: vi.fn(() => ({
    content: "Test command content",
    config: { description: "Test description" },
  })),
  parseBashCommands: vi.fn((content: string) => ({
    commands: [],
    processedContent: content,
  })),
  replaceBashCommandsWithOutput: vi.fn((content: string) => content),
}));

// Mock os module
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

// Mock path module partially
vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join("/")),
  };
});

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock util
vi.mock("util", () => ({
  promisify: vi.fn(() =>
    vi.fn(() => Promise.resolve({ stdout: "", stderr: "" })),
  ),
}));

import { parseMarkdownFile } from "../../src/utils/markdownParser.js";

describe("SlashCommandManager Nested Command Integration", () => {
  let slashCommandManager: SlashCommandManager;
  let messageManager: MessageManager;
  let aiManager: AIManager;
  const mockWorkdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

    // Create MessageManager with necessary callbacks
    messageManager = new MessageManager({
      callbacks: {},
      workdir: mockWorkdir,
    });

    // Create mock AIManager
    aiManager = {
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
    } as unknown as AIManager;

    // Default fs mock setup
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
    } as unknown as ReturnType<typeof statSync>);

    // Mock parseMarkdownFile to return content without description
    // so SlashCommandManager will generate the default description
    vi.mocked(parseMarkdownFile).mockReturnValue({
      content: "Default test content",
      config: {}, // No description in config - will generate "Custom command: {name}"
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper function to create SlashCommandManager with mocked custom commands
  function createManagerWithMockedCommands(
    commandStructure: Record<string, string | Record<string, string>>,
  ) {
    // Mock the file structure based on commandStructure
    const flatFiles: string[] = [];
    const directories: string[] = [];
    const nestedFiles: Record<string, string[]> = {};

    Object.entries(commandStructure).forEach(([key, value]) => {
      if (typeof value === "string") {
        // Flat command
        flatFiles.push(`${key}.md`);
      } else if (typeof value === "object") {
        // Nested namespace
        directories.push(key);
        nestedFiles[key] = Object.keys(value).map((cmd) => `${cmd}.md`);
      }
    });

    let callCount = 0;
    vi.mocked(readdirSync).mockImplementation((path) => {
      callCount++;
      const pathStr = String(path);

      if (callCount === 1 && pathStr.includes(mockWorkdir)) {
        // First call: return root directory contents
        return [...flatFiles, ...directories] as unknown as ReturnType<
          typeof readdirSync
        >;
      }

      // Subsequent calls: return nested directory contents
      for (const [dir, files] of Object.entries(nestedFiles)) {
        if (pathStr.endsWith(dir)) {
          return files as unknown as ReturnType<typeof readdirSync>;
        }
      }

      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    vi.mocked(statSync).mockImplementation((path) => {
      const pathStr = String(path);
      if (directories.some((dir) => pathStr.endsWith(dir))) {
        return {
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as ReturnType<typeof statSync>;
      }
      return {
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as ReturnType<typeof statSync>;
    });

    return new SlashCommandManager({
      messageManager,
      aiManager,
      workdir: mockWorkdir,
    });
  }

  describe("Mixed Command Discovery Integration", () => {
    it("should load both flat and nested commands into command registry", () => {
      const commandStructure = {
        help: "flat-command",
        status: "flat-command",
        openspec: {
          apply: "nested-command",
          validate: "nested-command",
        },
        api: {
          create: "nested-command",
          test: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);

      const commands = slashCommandManager.getCommands();

      // Should have built-in clear, init, rewind + 6 custom commands
      expect(commands).toHaveLength(9);

      // Check that both flat and nested commands are registered
      expect(slashCommandManager.hasCommand("help")).toBe(true);
      expect(slashCommandManager.hasCommand("status")).toBe(true);
      expect(slashCommandManager.hasCommand("openspec:apply")).toBe(true);
      expect(slashCommandManager.hasCommand("openspec:validate")).toBe(true);
      expect(slashCommandManager.hasCommand("api:create")).toBe(true);
      expect(slashCommandManager.hasCommand("api:test")).toBe(true);
    });

    it("should retrieve command metadata for nested commands", () => {
      const commandStructure = {
        tools: {
          deploy: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);

      const command = slashCommandManager.getCommand("tools:deploy");
      expect(command).toBeDefined();
      expect(command?.id).toBe("tools:deploy");
      expect(command?.name).toBe("deploy"); // Name should be just the command part
      expect(command?.description).toContain("Custom command: deploy"); // Uses command.name in description

      // Should also be able to get custom command details
      const customCommand =
        slashCommandManager.getCustomCommand("tools:deploy");
      expect(customCommand).toBeDefined();
      expect(customCommand?.id).toBe("tools:deploy");
      expect(customCommand?.name).toBe("deploy");
      expect(customCommand?.namespace).toBe("tools");
      expect(customCommand?.isNested).toBe(true);
    });
  });

  describe("Nested Command Parsing", () => {
    beforeEach(() => {
      const commandStructure = {
        help: "flat-command",
        openspec: {
          apply: "nested-command",
          validate: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);
    });

    it("should parse flat commands correctly", () => {
      const result = slashCommandManager.parseAndValidateSlashCommand("/help");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("help");
      expect(result.args).toBeUndefined();
    });

    it("should parse nested commands with colon syntax", () => {
      // This test will FAIL initially - this is the TDD Red phase
      // The parseSlashCommandInput function needs to be updated to handle colon syntax
      const result =
        slashCommandManager.parseAndValidateSlashCommand("/openspec:apply");

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("openspec:apply");
      expect(result.args).toBeUndefined();
    });

    it("should parse nested commands with arguments", () => {
      // This test will also FAIL initially
      const result = slashCommandManager.parseAndValidateSlashCommand(
        "/openspec:apply spec.yaml --force",
      );

      expect(result.isValid).toBe(true);
      expect(result.commandId).toBe("openspec:apply");
      expect(result.args).toBe("spec.yaml --force");
    });

    it("should handle invalid nested command syntax", () => {
      // Test malformed colon syntax
      const result1 =
        slashCommandManager.parseAndValidateSlashCommand("/openspec:");
      expect(result1.isValid).toBe(false);

      const result2 =
        slashCommandManager.parseAndValidateSlashCommand("/:apply");
      expect(result2.isValid).toBe(false);

      const result3 =
        slashCommandManager.parseAndValidateSlashCommand("/openspec::apply");
      expect(result3.isValid).toBe(false);
    });

    it("should handle non-existent nested commands", () => {
      const result = slashCommandManager.parseAndValidateSlashCommand(
        "/nonexistent:command",
      );

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
    });

    it("should handle nested command with non-existent namespace", () => {
      const result =
        slashCommandManager.parseAndValidateSlashCommand("/missing:apply");

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
    });

    it("should handle nested command with valid namespace but non-existent command", () => {
      const result =
        slashCommandManager.parseAndValidateSlashCommand("/openspec:missing");

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
    });
  });

  describe("Nested Command Execution", () => {
    beforeEach(() => {
      const commandStructure = {
        deploy: "flat-command",
        tools: {
          build: "nested-command",
          test: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);
    });

    it("should execute flat commands through existing pipeline", async () => {
      const result = await slashCommandManager.executeCommand("deploy");

      expect(result).toBe(true);
      expect(aiManager.sendAIMessage).toHaveBeenCalledTimes(1);
    });

    it("should execute nested commands through existing pipeline", async () => {
      const result = await slashCommandManager.executeCommand("tools:build");

      expect(result).toBe(true);
      expect(aiManager.sendAIMessage).toHaveBeenCalledTimes(1);
    });

    it("should execute nested commands with arguments", async () => {
      const result = await slashCommandManager.executeCommand(
        "tools:test",
        "unit --coverage",
      );

      expect(result).toBe(true);
      expect(aiManager.sendAIMessage).toHaveBeenCalledTimes(1);
    });

    it("should return false for non-existent nested commands", async () => {
      const result = await slashCommandManager.executeCommand(
        "nonexistent:command",
      );

      expect(result).toBe(false);
      expect(aiManager.sendAIMessage).not.toHaveBeenCalled();
    });

    it("should handle execution errors gracefully for nested commands", async () => {
      // Mock AIManager to throw an error
      vi.mocked(aiManager.sendAIMessage).mockRejectedValueOnce(
        new Error("AI Error"),
      );

      // Capture console.error
      const originalConsoleError = console.error;
      console.error = vi.fn();

      const result = await slashCommandManager.executeCommand("tools:build");

      expect(result).toBe(true); // Command handler executes but catches the error
      expect(console.error).not.toHaveBeenCalled(); // Error should be handled by messageManager

      console.error = originalConsoleError;
    });
  });

  describe("Backward Compatibility", () => {
    beforeEach(() => {
      const commandStructure = {
        help: "flat-command",
        status: "flat-command",
        api: {
          create: "nested-command",
          deploy: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);
    });

    it("should maintain existing flat command functionality", async () => {
      // Test parsing
      const parseResult =
        slashCommandManager.parseAndValidateSlashCommand("/help");
      expect(parseResult.isValid).toBe(true);
      expect(parseResult.commandId).toBe("help");

      // Test execution
      const execResult = await slashCommandManager.executeCommand("help");
      expect(execResult).toBe(true);

      // Test command lookup
      expect(slashCommandManager.hasCommand("help")).toBe(true);
      const command = slashCommandManager.getCommand("help");
      expect(command?.id).toBe("help");
    });

    it("should not break existing command listing", () => {
      const commands = slashCommandManager.getCommands();

      // Should include built-in commands + custom commands
      expect(commands.length).toBeGreaterThan(0);

      // Built-in clear command should still be there
      const clearCommand = commands.find((cmd) => cmd.id === "clear");
      expect(clearCommand).toBeDefined();

      // Custom flat commands should be there
      const helpCommand = commands.find((cmd) => cmd.id === "help");
      expect(helpCommand).toBeDefined();

      // Custom nested commands should be there
      const apiCreateCommand = commands.find((cmd) => cmd.id === "api:create");
      expect(apiCreateCommand).toBeDefined();
    });

    it("should maintain custom command metadata access", () => {
      const customCommands = slashCommandManager.getCustomCommands();

      expect(customCommands).toHaveLength(4);

      // Check flat custom command
      const helpCustom = customCommands.find((cmd) => cmd.id === "help");
      expect(helpCustom?.isNested).toBe(false);

      // Check nested custom command
      const apiCreateCustom = customCommands.find(
        (cmd) => cmd.id === "api:create",
      );
      expect(apiCreateCustom?.isNested).toBe(true);
      expect(apiCreateCustom?.namespace).toBe("api");
    });
  });

  describe("Integration Edge Cases", () => {
    it("should handle command reload with mixed commands", () => {
      // Start with initial commands
      const initialStructure = {
        help: "flat-command",
        tools: {
          build: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(initialStructure);

      expect(slashCommandManager.hasCommand("help")).toBe(true);
      expect(slashCommandManager.hasCommand("tools:build")).toBe(true);

      // Mock new structure for reload
      vi.mocked(readdirSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes(mockWorkdir) && !pathStr.includes("/api")) {
          return ["status.md", "api"] as unknown as ReturnType<
            typeof readdirSync
          >;
        }
        if (pathStr.endsWith("api")) {
          return ["deploy.md"] as unknown as ReturnType<typeof readdirSync>;
        }
        // Mock empty user directory
        if (pathStr.includes("/mock/home/.wave/commands")) {
          return [] as unknown as ReturnType<typeof readdirSync>;
        }
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      // Update statSync to recognize 'api' as directory
      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("api")) {
          return {
            isDirectory: () => true,
            isFile: () => false,
          } as unknown as ReturnType<typeof statSync>;
        }
        return {
          isDirectory: () => false,
          isFile: () => true,
        } as unknown as ReturnType<typeof statSync>;
      });

      slashCommandManager.reloadCustomCommands();

      // Old commands should be gone
      expect(slashCommandManager.hasCommand("help")).toBe(false);
      expect(slashCommandManager.hasCommand("tools:build")).toBe(false);

      // New commands should be present
      expect(slashCommandManager.hasCommand("status")).toBe(true);
      expect(slashCommandManager.hasCommand("api:deploy")).toBe(true);
    });

    it("should handle abort functionality with nested commands", () => {
      const commandStructure = {
        longrunning: {
          task: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);

      // Should not throw when aborting
      expect(() => {
        slashCommandManager.abortCurrentCommand();
      }).not.toThrow();

      expect(aiManager.abortAIMessage).toHaveBeenCalledTimes(1);
    });

    it("should handle empty command arguments for nested commands", () => {
      const commandStructure = {
        tools: {
          clean: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);

      const result1 =
        slashCommandManager.parseAndValidateSlashCommand("/tools:clean");
      expect(result1.isValid).toBe(true);
      expect(result1.args).toBeUndefined();

      const result2 =
        slashCommandManager.parseAndValidateSlashCommand("/tools:clean   ");
      expect(result2.isValid).toBe(true);
      expect(result2.args).toBeUndefined();
    });
  });

  describe("Error Handling and Validation", () => {
    beforeEach(() => {
      const commandStructure = {
        valid: "flat-command",
        namespace: {
          command: "nested-command",
        },
      };

      slashCommandManager = createManagerWithMockedCommands(commandStructure);
    });

    it("should handle parsing errors gracefully for nested commands", () => {
      const originalConsoleError = console.error;
      console.error = vi.fn();

      // Test input that doesn't start with /
      const result =
        slashCommandManager.parseAndValidateSlashCommand("namespace:command");

      expect(result.isValid).toBe(false);
      expect(result.commandId).toBeUndefined();
      expect(result.args).toBeUndefined();
      expect(console.error).toHaveBeenCalled();

      console.error = originalConsoleError;
    });

    it("should validate command ID format for nested commands", () => {
      // These should all be invalid according to the current parser
      const invalidInputs = [
        "/:command", // empty namespace
        "/namespace:", // empty command
        "/namespace::", // double colon
        "/namespace:command:", // trailing colon
        "/::", // just colons
      ];

      for (const input of invalidInputs) {
        const result = slashCommandManager.parseAndValidateSlashCommand(input);
        expect(result.isValid).toBe(false);
      }
    });

    it("should handle command execution failure for nested commands", async () => {
      // Mock parseMarkdownFile to return content that will cause processing error
      vi.mocked(parseMarkdownFile).mockReturnValueOnce({
        content: "```bash\ninvalid-command-that-fails\n```",
        config: {},
      });

      // Mock execAsync to fail - this will be handled internally by the command execution

      const result =
        await slashCommandManager.executeCommand("namespace:command");

      // Command should still execute (return true) but handle the error internally
      expect(result).toBe(true);
    });
  });
});
