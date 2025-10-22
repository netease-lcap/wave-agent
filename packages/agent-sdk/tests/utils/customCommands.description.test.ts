import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadCustomSlashCommands } from "../../src/utils/customCommands.js";

describe("Custom Slash Commands with Description", () => {
  let testDir: string;
  let commandsDir: string;

  beforeEach(() => {
    // 使用系统临时目录创建临时测试目录
    testDir = mkdtempSync(join(tmpdir(), "wave-test-"));
    commandsDir = join(testDir, ".wave", "commands");
    mkdirSync(commandsDir, { recursive: true });
  });

  afterEach(() => {
    // 清理临时目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should parse custom description from frontmatter", () => {
    const commandContent = `---
description: Custom test command description
model: claude-3-5-sonnet-20241022
---

This is a test command content.`;

    writeFileSync(join(commandsDir, "test-command.md"), commandContent);

    const commands = loadCustomSlashCommands(testDir);
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

    writeFileSync(join(commandsDir, "no-desc-command.md"), commandContent);

    const commands = loadCustomSlashCommands(testDir);
    const testCommand = commands.find((cmd) => cmd.name === "no-desc-command");

    expect(testCommand).toBeDefined();
    expect(testCommand?.description).toBeUndefined();
    expect(testCommand?.config?.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("should handle commands with no frontmatter", () => {
    const commandContent = `This is a simple command without any frontmatter.`;

    writeFileSync(join(commandsDir, "simple-command.md"), commandContent);

    const commands = loadCustomSlashCommands(testDir);
    const testCommand = commands.find((cmd) => cmd.name === "simple-command");

    expect(testCommand).toBeDefined();
    expect(testCommand?.description).toBeUndefined();
    expect(testCommand?.config).toBeUndefined();
  });
});
