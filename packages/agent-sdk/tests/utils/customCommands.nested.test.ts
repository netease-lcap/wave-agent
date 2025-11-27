import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readdirSync, statSync } from "fs";

// Mock the fs operations
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
}));

// Mock os module
vi.mock("os", () => ({
  default: {
    homedir: vi.fn(() => "/mock/home"),
  },
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock path module partially
vi.mock("path", async () => {
  const actual = await vi.importActual("path");
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join("/")),
  };
});

// This enhanced function doesn't exist yet - part of TDD Red phase
// Implementation needed: enhance loadCustomSlashCommands in customCommands.ts
import { loadCustomSlashCommands } from "../../src/utils/customCommands.js";
import { parseMarkdownFile } from "../../src/utils/markdownParser.js";

describe("Nested Custom Commands Discovery", () => {
  const mockWorkdir = "/mock/project";

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console to suppress expected warnings in tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Default mock setup
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
    } as unknown as ReturnType<typeof statSync>);
    vi.mocked(parseMarkdownFile).mockReturnValue({
      content: "Default test content",
      config: { description: "Default description" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restore console methods
    vi.restoreAllMocks();
  });

  describe("flat command discovery (backward compatibility)", () => {
    it("should discover flat commands in root directory", () => {
      // Mock flat command structure: .wave/commands/help.md
      vi.mocked(readdirSync)
        .mockReturnValueOnce(["help.md", "status.md"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as ReturnType<typeof statSync>);

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(2);

      const helpCommand = commands.find((cmd) => cmd.id === "help");
      expect(helpCommand).toBeDefined();
      expect(helpCommand?.name).toBe("help");
      expect(helpCommand?.isNested).toBe(false);
      expect(helpCommand?.depth).toBe(0);
      expect(helpCommand?.namespace).toBeUndefined();
      expect(helpCommand?.segments).toEqual(["help"]);
    });

    it("should ignore non-markdown files in root directory", () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "help.md",
          "README.txt",
          "config.json",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("help");
    });
  });

  describe("nested command discovery", () => {
    it("should discover nested commands with colon syntax", () => {
      // Mock nested structure:
      // .wave/commands/
      //   ├── help.md (flat)
      //   └── openspec/
      //       ├── apply.md
      //       └── validate.md

      // First call: root directory contents
      vi.mocked(readdirSync)
        .mockReturnValueOnce(["help.md", "openspec"] as unknown as ReturnType<
          typeof readdirSync
        >)
        // Second call: openspec directory contents
        .mockReturnValueOnce([
          "apply.md",
          "validate.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        // Third call: user commands directory (empty)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      // Mock statSync to return directory for "openspec", file for others
      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("openspec")) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(3);

      // Check flat command
      const helpCommand = commands.find((cmd) => cmd.id === "help");
      expect(helpCommand?.isNested).toBe(false);
      expect(helpCommand?.depth).toBe(0);

      // Check nested commands
      const applyCommand = commands.find((cmd) => cmd.id === "openspec:apply");
      expect(applyCommand).toBeDefined();
      expect(applyCommand?.name).toBe("apply");
      expect(applyCommand?.namespace).toBe("openspec");
      expect(applyCommand?.isNested).toBe(true);
      expect(applyCommand?.depth).toBe(1);
      expect(applyCommand?.segments).toEqual(["openspec", "apply"]);

      const validateCommand = commands.find(
        (cmd) => cmd.id === "openspec:validate",
      );
      expect(validateCommand).toBeDefined();
      expect(validateCommand?.name).toBe("validate");
      expect(validateCommand?.namespace).toBe("openspec");
    });

    it("should handle multiple namespaces at depth 1", () => {
      // Mock structure:
      // .wave/commands/
      //   ├── api/
      //   │   ├── create.md
      //   │   └── delete.md
      //   └── db/
      //       ├── migrate.md
      //       └── rollback.md

      vi.mocked(readdirSync)
        .mockReturnValueOnce(["api", "db"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce([
          "create.md",
          "delete.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "migrate.md",
          "rollback.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("api") || pathStr.endsWith("db")) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(4);
      expect(commands.find((cmd) => cmd.id === "api:create")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "api:delete")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "db:migrate")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "db:rollback")).toBeDefined();
    });
  });

  describe("depth limit enforcement", () => {
    it("should ignore commands deeper than 1 level", () => {
      // Mock structure with deep nesting:
      // .wave/commands/
      //   └── api/
      //       └── v1/
      //           └── users/
      //               └── create.md (depth 3 - should be ignored)

      // The readdirSync will be called multiple times:
      // 1. For project .wave/commands directory
      // 2. For api subdirectory
      // 3. For user .wave/commands directory (empty)
      vi.mocked(readdirSync)
        .mockReturnValueOnce(["api"] as unknown as ReturnType<
          typeof readdirSync
        >) // Project root
        .mockReturnValueOnce(["v1"] as unknown as ReturnType<
          typeof readdirSync
        >) // api/ directory (depth 1)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>); // user directory (empty)

      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("api") || pathStr.endsWith("v1")) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      // Should not find any commands because v1/ is at depth 1 (maxDepth)
      // so it should be skipped, and no .md files should be processed
      expect(commands).toHaveLength(0);
    });

    it("should accept commands at exactly depth 1", () => {
      // Mock structure at exactly depth 1:
      // .wave/commands/
      //   └── tools/
      //       ├── generate.md (depth 1 - should be included)
      //       └── validate.md (depth 1 - should be included)

      vi.mocked(readdirSync)
        .mockReturnValueOnce(["tools"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce([
          "generate.md",
          "validate.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("tools")) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(2);
      expect(commands.find((cmd) => cmd.id === "tools:generate")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "tools:validate")).toBeDefined();
    });
  });

  describe("mixed flat and nested commands", () => {
    it("should handle combination of flat and nested commands", () => {
      // Mock mixed structure:
      // .wave/commands/
      //   ├── help.md (flat)
      //   ├── status.md (flat)
      //   ├── api/
      //   │   └── test.md (nested)
      //   └── db/
      //       └── setup.md (nested)

      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "help.md",
          "status.md",
          "api",
          "db",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce(["test.md"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce(["setup.md"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("api") || pathStr.endsWith("db")) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(4);

      // Check flat commands
      const flatCommands = commands.filter((cmd) => !cmd.isNested);
      expect(flatCommands).toHaveLength(2);
      expect(flatCommands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["help", "status"]),
      );

      // Check nested commands
      const nestedCommands = commands.filter((cmd) => cmd.isNested);
      expect(nestedCommands).toHaveLength(2);
      expect(nestedCommands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["api:test", "db:setup"]),
      );
    });
  });

  describe("error handling", () => {
    it("should handle non-existent commands directory gracefully", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toEqual([]);
    });

    it("should skip directories that cannot be read", () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "accessible",
          "inaccessible",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockImplementationOnce((path) => {
          if (String(path).includes("inaccessible")) {
            throw new Error("Permission denied");
          }
          return ["test.md"] as unknown as ReturnType<typeof readdirSync>;
        })
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (
          pathStr.endsWith("accessible") ||
          pathStr.endsWith("inaccessible")
        ) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      // Should only find commands from accessible directory
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("accessible:test");
    });

    it("should handle markdown parsing errors gracefully", () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "broken.md",
          "working.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(parseMarkdownFile).mockImplementation((filePath) => {
        if (String(filePath).includes("broken.md")) {
          throw new Error("Failed to parse markdown");
        }
        return {
          content: "Working content",
          config: { description: "Working command" },
        };
      });

      const commands = loadCustomSlashCommands(mockWorkdir);

      // Should only find the working command
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("working");
    });
  });

  describe("command precedence (project vs user)", () => {
    it("should prioritize project commands over user commands", () => {
      // Mock project and user commands with same name
      vi.mocked(existsSync).mockImplementation((path) => {
        return String(path).includes(".wave/commands");
      });

      let callCount = 0;
      vi.mocked(readdirSync).mockImplementation((path) => {
        callCount++;
        const pathStr = String(path);

        if (
          pathStr.includes("/mock/project/.wave/commands") &&
          callCount === 1
        ) {
          return ["help.md"] as unknown as ReturnType<typeof readdirSync>;
        }
        if (pathStr.includes("/mock/home/.wave/commands") && callCount === 2) {
          return ["help.md", "user-only.md"] as unknown as ReturnType<
            typeof readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      vi.mocked(parseMarkdownFile).mockImplementation((filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes("/mock/project/")) {
          return {
            content: "Project help content",
            config: { description: "Project help command" },
          };
        }
        return {
          content: "User help content",
          config: { description: "User help command" },
        };
      });

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(2);

      const helpCommand = commands.find((cmd) => cmd.id === "help");
      expect(helpCommand?.content).toBe("Project help content");
      expect(helpCommand?.config?.description).toBe("Project help command");

      const userOnlyCommand = commands.find((cmd) => cmd.id === "user-only");
      expect(userOnlyCommand).toBeDefined();
    });
  });

  describe("invalid command structures", () => {
    it("should ignore empty directories", () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(["empty-dir"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce([] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
      } as unknown as ReturnType<typeof statSync>);

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(0);
    });

    it("should ignore directories with only non-markdown files", () => {
      vi.mocked(readdirSync)
        .mockReturnValueOnce(["invalid-dir"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce([
          "README.txt",
          "config.json",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.endsWith("invalid-dir")) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(0);
    });
  });
});
