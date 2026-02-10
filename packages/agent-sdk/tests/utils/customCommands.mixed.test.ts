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

import { loadCustomSlashCommands } from "../../src/utils/customCommands.js";
import { parseMarkdownFile } from "../../src/utils/markdownParser.js";

describe("Mixed Flat and Nested Command Discovery", () => {
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

  describe("Real-world mixed command scenarios", () => {
    it("should handle typical development project structure", () => {
      // Mock realistic structure:
      // .wave/commands/
      //   ├── help.md (flat - basic help)
      //   ├── status.md (flat - project status)
      //   ├── openspec/
      //   │   ├── apply.md (nested - apply OpenAPI spec)
      //   │   ├── validate.md (nested - validate OpenAPI spec)
      //   │   └── generate.md (nested - generate code from spec)
      //   ├── api/
      //   │   ├── create.md (nested - create API endpoint)
      //   │   ├── test.md (nested - test API endpoints)
      //   │   └── deploy.md (nested - deploy API)
      //   └── db/
      //       ├── migrate.md (nested - run database migrations)
      //       ├── seed.md (nested - seed database with test data)
      //       └── backup.md (nested - backup database)

      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "help.md",
          "status.md",
          "openspec",
          "api",
          "db",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "apply.md",
          "validate.md",
          "generate.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "create.md",
          "test.md",
          "deploy.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "migrate.md",
          "seed.md",
          "backup.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation(function (path) {
        const pathStr = String(path);
        if (
          pathStr.endsWith("openspec") ||
          pathStr.endsWith("api") ||
          pathStr.endsWith("db")
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

      expect(commands).toHaveLength(11);

      // Verify flat commands
      const flatCommands = commands.filter((cmd) => !cmd.isNested);
      expect(flatCommands).toHaveLength(2);
      expect(flatCommands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["help", "status"]),
      );

      // Verify openspec namespace
      const openspecCommands = commands.filter(
        (cmd) => cmd.namespace === "openspec",
      );
      expect(openspecCommands).toHaveLength(3);
      expect(openspecCommands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining([
          "openspec:apply",
          "openspec:validate",
          "openspec:generate",
        ]),
      );

      // Verify api namespace
      const apiCommands = commands.filter((cmd) => cmd.namespace === "api");
      expect(apiCommands).toHaveLength(3);
      expect(apiCommands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["api:create", "api:test", "api:deploy"]),
      );

      // Verify db namespace
      const dbCommands = commands.filter((cmd) => cmd.namespace === "db");
      expect(dbCommands).toHaveLength(3);
      expect(dbCommands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["db:migrate", "db:seed", "db:backup"]),
      );
    });

    it("should maintain proper command metadata for mixed scenarios", () => {
      // Mock mixed structure with specific metadata requirements
      vi.mocked(readdirSync)
        .mockReturnValueOnce(["help.md", "tools"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce(["build.md"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation(function (path) {
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

      // Mock different content for different commands
      vi.mocked(parseMarkdownFile).mockImplementation(function (filePath) {
        const pathStr = String(filePath);
        if (pathStr.includes("help.md")) {
          return {
            content: "Display help information",
            config: { description: "Show available commands and usage" },
          };
        }
        if (pathStr.includes("build.md")) {
          return {
            content: "Build project artifacts",
            config: {
              description: "Compile and package the project",
              model: "gpt-4",
            },
          };
        }
        return { content: "Default content", config: {} };
      });

      const commands = loadCustomSlashCommands(mockWorkdir);

      expect(commands).toHaveLength(2);

      // Check flat command metadata
      const helpCommand = commands.find((cmd) => cmd.id === "help");
      expect(helpCommand).toBeDefined();
      expect(helpCommand?.name).toBe("help");
      expect(helpCommand?.isNested).toBe(false);
      expect(helpCommand?.depth).toBe(0);
      expect(helpCommand?.namespace).toBeUndefined();
      expect(helpCommand?.segments).toEqual(["help"]);
      expect(helpCommand?.config?.description).toBe(
        "Show available commands and usage",
      );

      // Check nested command metadata
      const buildCommand = commands.find((cmd) => cmd.id === "tools:build");
      expect(buildCommand).toBeDefined();
      expect(buildCommand?.name).toBe("build");
      expect(buildCommand?.isNested).toBe(true);
      expect(buildCommand?.depth).toBe(1);
      expect(buildCommand?.namespace).toBe("tools");
      expect(buildCommand?.segments).toEqual(["tools", "build"]);
      expect(buildCommand?.config?.description).toBe(
        "Compile and package the project",
      );
      expect(buildCommand?.config?.model).toBe("gpt-4");
    });
  });

  describe("Precedence rules for mixed commands", () => {
    it("should prioritize project commands over user commands for both flat and nested", () => {
      // Mock project commands
      vi.mocked(existsSync).mockImplementation(function (path) {
        return String(path).includes(".wave/commands");
      });

      let projectCallCount = 0;
      let userCallCount = 0;

      vi.mocked(readdirSync).mockImplementation(function (path) {
        const pathStr = String(path);

        if (pathStr.includes("/mock/project/.wave/commands")) {
          projectCallCount++;
          if (projectCallCount === 1) {
            return ["help.md", "tools"] as unknown as ReturnType<
              typeof readdirSync
            >;
          }
          if (projectCallCount === 2) {
            return ["deploy.md"] as unknown as ReturnType<typeof readdirSync>;
          }
        }

        if (pathStr.includes("/mock/home/.wave/commands")) {
          userCallCount++;
          if (userCallCount === 1) {
            return ["help.md", "config.md", "tools"] as unknown as ReturnType<
              typeof readdirSync
            >;
          }
          if (userCallCount === 2) {
            return ["deploy.md", "test.md"] as unknown as ReturnType<
              typeof readdirSync
            >;
          }
        }

        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      vi.mocked(statSync).mockImplementation(function (path) {
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

      vi.mocked(parseMarkdownFile).mockImplementation(function (filePath) {
        const pathStr = String(filePath);
        if (pathStr.includes("/mock/project/")) {
          return {
            content: "Project-level command",
            config: { description: "Project command" },
          };
        }
        return {
          content: "User-level command",
          config: { description: "User command" },
        };
      });

      const commands = loadCustomSlashCommands(mockWorkdir);

      // Should have project commands + user-only commands
      // Project: help, tools:deploy
      // User-only: config, tools:test
      expect(commands).toHaveLength(4);

      // Check that project commands take precedence
      const helpCommand = commands.find((cmd) => cmd.id === "help");
      expect(helpCommand?.content).toBe("Project-level command");

      const projectDeployCommand = commands.find(
        (cmd) => cmd.id === "tools:deploy",
      );
      expect(projectDeployCommand?.content).toBe("Project-level command");

      // Check that user-only commands are included
      const configCommand = commands.find((cmd) => cmd.id === "config");
      expect(configCommand?.content).toBe("User-level command");

      const userTestCommand = commands.find((cmd) => cmd.id === "tools:test");
      expect(userTestCommand?.content).toBe("User-level command");
    });

    it("should handle namespace conflicts between project and user commands", () => {
      // Test when project has "api:deploy" and user has "api:test"
      vi.mocked(existsSync).mockImplementation(function (path) {
        return String(path).includes(".wave/commands");
      });

      let callCount = 0;
      vi.mocked(readdirSync).mockImplementation(function (path) {
        callCount++;
        const pathStr = String(path);

        if (
          pathStr.includes("/mock/project/.wave/commands") &&
          callCount === 1
        ) {
          return ["api"] as unknown as ReturnType<typeof readdirSync>;
        }
        if (
          pathStr.includes("/mock/project/.wave/commands") &&
          callCount === 2
        ) {
          return ["deploy.md"] as unknown as ReturnType<typeof readdirSync>;
        }
        if (pathStr.includes("/mock/home/.wave/commands") && callCount === 3) {
          return ["api"] as unknown as ReturnType<typeof readdirSync>;
        }
        if (pathStr.includes("/mock/home/.wave/commands") && callCount === 4) {
          return ["deploy.md", "test.md"] as unknown as ReturnType<
            typeof readdirSync
          >;
        }

        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      vi.mocked(statSync).mockImplementation(function (path) {
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

      const commands = loadCustomSlashCommands(mockWorkdir);

      // Should have project api:deploy + user api:test
      expect(commands).toHaveLength(2);
      expect(commands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["api:deploy", "api:test"]),
      );

      // Both should be in the same namespace but from different sources
      const apiCommands = commands.filter((cmd) => cmd.namespace === "api");
      expect(apiCommands).toHaveLength(2);
    });
  });

  describe("Integration scenarios", () => {
    it("should support commands that work together in workflows", () => {
      // Mock commands that represent a typical development workflow
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "init.md",
          "dev",
          "deploy",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "start.md",
          "test.md",
          "build.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "staging.md",
          "production.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation(function (path) {
        const pathStr = String(path);
        if (pathStr.endsWith("dev") || pathStr.endsWith("deploy")) {
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

      expect(commands).toHaveLength(6);

      // Verify workflow commands
      expect(commands.find((cmd) => cmd.id === "init")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "dev:start")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "dev:test")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "dev:build")).toBeDefined();
      expect(commands.find((cmd) => cmd.id === "deploy:staging")).toBeDefined();
      expect(
        commands.find((cmd) => cmd.id === "deploy:production"),
      ).toBeDefined();

      // Verify namespace organization
      const devCommands = commands.filter((cmd) => cmd.namespace === "dev");
      expect(devCommands).toHaveLength(3);

      const deployCommands = commands.filter(
        (cmd) => cmd.namespace === "deploy",
      );
      expect(deployCommands).toHaveLength(2);
    });

    it("should handle edge case of empty namespaces gracefully", () => {
      // Mock structure with empty directories
      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "help.md",
          "empty-namespace",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation(function (path) {
        const pathStr = String(path);
        if (pathStr.endsWith("empty-namespace")) {
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

      // Should only find the flat command, empty namespace should be ignored
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe("help");
    });
  });

  describe("Command validation in mixed scenarios", () => {
    it("should validate command IDs properly for both flat and nested", () => {
      // Mock existsSync to only find project directory, not user directory
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.includes("/mock/project/.wave/commands");
      });

      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "valid-name.md",
          "123invalid.md",
          "valid-ns",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce([
          "valid-cmd.md",
          "invalid-123.md",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation(function (path) {
        const pathStr = String(path);
        if (pathStr.endsWith("valid-ns")) {
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

      // Should find valid-name, valid-ns:valid-cmd, and valid-ns:invalid-123
      // (invalid-123 is valid because it starts with letter)
      // 123invalid.md is rejected because it starts with number
      expect(commands).toHaveLength(3);
      expect(commands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining([
          "valid-name",
          "valid-ns:valid-cmd",
          "valid-ns:invalid-123",
        ]),
      );
    });

    it("should reject deeply nested commands while keeping shallow ones", () => {
      // Mock existsSync to only find project directory, not user directory
      vi.mocked(existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.includes("/mock/project/.wave/commands");
      });

      // Mock structure:
      // .wave/commands/
      //   ├── ok.md (flat - should be included)
      //   ├── shallow/
      //   │   └── good.md (depth 1 - should be included)
      //   └── deep/
      //       └── too-deep/
      //           └── rejected.md (depth 2 - should be skipped)

      vi.mocked(readdirSync)
        .mockReturnValueOnce([
          "ok.md",
          "shallow",
          "deep",
        ] as unknown as ReturnType<typeof readdirSync>)
        .mockReturnValueOnce(["good.md"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce(["too-deep"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValueOnce(["rejected.md"] as unknown as ReturnType<
          typeof readdirSync
        >)
        .mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

      vi.mocked(statSync).mockImplementation(function (path) {
        const pathStr = String(path);
        if (
          pathStr.endsWith("shallow") ||
          pathStr.endsWith("deep") ||
          pathStr.endsWith("too-deep")
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

      // Should find flat command and shallow nested command only
      // Deep nested command is skipped due to depth limit
      expect(commands).toHaveLength(2);
      expect(commands.map((cmd) => cmd.id)).toEqual(
        expect.arrayContaining(["ok", "shallow:good"]),
      );
      expect(commands.find((cmd) => cmd.id.includes("deep"))).toBeUndefined();
    });
  });
});
