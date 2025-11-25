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
});
