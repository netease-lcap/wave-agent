import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadCustomSlashCommands } from "../../src/utils/customCommands.js";
import * as fs from "fs";

// Mock fs operations
vi.mock("fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => ""),
  statSync: vi.fn(() => ({ isFile: () => true })),
}));

// Mock os module
vi.mock("os", () => ({
  default: {
    tmpdir: vi.fn(() => "/mock/tmp"),
    homedir: vi.fn(() => "/mock/home"),
  },
  tmpdir: vi.fn(() => "/mock/tmp"),
  homedir: vi.fn(() => "/mock/home"),
}));

describe("Custom Slash Commands with Description", () => {
  let mockTestDir: string;

  beforeEach(() => {
    // Set up mock directory paths
    mockTestDir = "/mock/tmp/wave-test-123";

    // Setup fs mock implementations
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.rmSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    vi.mocked(fs.statSync).mockReturnValue({
      isFile: () => true,
      isDirectory: () => false,
    } as unknown as ReturnType<typeof fs.statSync>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should parse custom description from frontmatter", () => {
    const commandContent = `---
description: Custom test command description
model: claude-3-5-sonnet-20241022
---

This is a test command content.`;

    // Mock readFileSync to return the command content
    vi.mocked(fs.readFileSync).mockReturnValue(commandContent);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "test-command.md",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const commands = loadCustomSlashCommands(mockTestDir);
    const testCommand = commands.find((cmd) => cmd.name === "test-command");

    expect(testCommand).toBeDefined();
    expect(testCommand?.description).toBe("Custom test command description");
    expect(testCommand?.config?.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("should handle commands without description", () => {
    const commandContent = `---
model: claude-3-5-sonnet-20241022
---

This is a test command without description.`;

    // Mock readFileSync to return the command content
    vi.mocked(fs.readFileSync).mockReturnValue(commandContent);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "no-desc-command.md",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const commands = loadCustomSlashCommands(mockTestDir);
    const testCommand = commands.find((cmd) => cmd.name === "no-desc-command");

    expect(testCommand).toBeDefined();
    expect(testCommand?.description).toBeUndefined();
    expect(testCommand?.config?.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("should handle commands with no frontmatter", () => {
    const commandContent = `This is a simple command without any frontmatter.`;

    // Mock readFileSync to return the command content
    vi.mocked(fs.readFileSync).mockReturnValue(commandContent);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "simple-command.md",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const commands = loadCustomSlashCommands(mockTestDir);
    const testCommand = commands.find((cmd) => cmd.name === "simple-command");

    expect(testCommand).toBeDefined();
    expect(testCommand?.description).toBeUndefined();
    expect(testCommand?.config).toBeUndefined();
  });

  describe("Claude ecosystem compatibility", () => {
    it("should load commands from .claude/commands directories", () => {
      const claudeUserDir = "/mock/home/.claude/commands";
      const claudeProjectDir = "/mock/tmp/wave-test-123/.claude/commands";

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const path = p.toString();
        return path === claudeUserDir || path === claudeProjectDir;
      });

      vi.mocked(fs.readdirSync).mockImplementation((dirPath) => {
        const dir = dirPath.toString();
        if (dir === claudeUserDir) {
          return ["user-claude-cmd.md"] as unknown as ReturnType<
            typeof fs.readdirSync
          >;
        }
        if (dir === claudeProjectDir) {
          return ["project-claude-cmd.md"] as unknown as ReturnType<
            typeof fs.readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const p = filePath.toString();
        if (p.includes("user-claude-cmd.md")) {
          return `---
description: User Claude command
---
User claude command content`;
        }
        if (p.includes("project-claude-cmd.md")) {
          return `---
description: Project Claude command
---
Project claude command content`;
        }
        return "";
      });

      const commands = loadCustomSlashCommands(mockTestDir);

      expect(commands.find((c) => c.name === "user-claude-cmd")).toBeDefined();
      expect(
        commands.find((c) => c.name === "project-claude-cmd"),
      ).toBeDefined();
    });

    it("should let .wave/commands override .claude/commands for same-named command", () => {
      const claudeProjectDir = "/mock/tmp/wave-test-123/.claude/commands";
      const waveProjectDir = "/mock/tmp/wave-test-123/.wave/commands";

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const path = p.toString();
        return path === claudeProjectDir || path === waveProjectDir;
      });

      vi.mocked(fs.readdirSync).mockImplementation((dirPath) => {
        const dir = dirPath.toString();
        if (dir === claudeProjectDir || dir === waveProjectDir) {
          return ["shared-cmd.md"] as unknown as ReturnType<
            typeof fs.readdirSync
          >;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });

      vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
        const p = filePath.toString();
        if (p.includes(".claude/commands") && p.includes("shared-cmd.md")) {
          return `---
description: Claude version
---
Claude content`;
        }
        if (p.includes(".wave/commands") && p.includes("shared-cmd.md")) {
          return `---
description: Wave version
---
Wave content`;
        }
        return "";
      });

      const commands = loadCustomSlashCommands(mockTestDir);

      // Same command name from both dirs should result in one entry (wave wins)
      const matching = commands.filter((c) => c.name === "shared-cmd");
      expect(matching).toHaveLength(1);
      expect(matching[0].description).toBe("Wave version");
      expect(matching[0].content).toBe("Wave content");
    });
  });
});
