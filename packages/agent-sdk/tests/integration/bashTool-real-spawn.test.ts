/**
 * Real-spawn integration tests for bashTool.
 *
 * Unlike tests/tools/bashTool.test.ts (which mocks child_process), commands
 * here run through the real OS shell: spawn, pipes, stdout/stderr separation,
 * exit codes and the cwd-tracking wrapper are all exercised end to end.
 * On Windows the shell is Git Bash (via resolveShellPath), on POSIX bash/zsh.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { bashTool } from "../../src/tools/bashTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

const isWindows = process.platform === "win32";

function makeContext(workdir: string): ToolContext {
  // Only the fields the foreground execution path touches. Without a
  // permissionManager the permission gate is skipped and the command spawns.
  return {
    workdir,
    taskManager: createMockTaskManager(),
  };
}

describe("bashTool with real shell spawn", () => {
  let workdir: string;

  beforeAll(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-bash-real-"));
  });

  afterAll(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("runs a command and captures stdout", async () => {
    const result = await bashTool.execute(
      { command: "echo hello from wave" },
      makeContext(workdir),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("hello from wave");
  });

  it.skipIf(isWindows)("runs the command in the provided workdir", async () => {
    const result = await bashTool.execute(
      { command: "pwd" },
      makeContext(workdir),
    );
    expect(result.success).toBe(true);
    // Git Bash reports MSYS-style paths (/c/...), so restrict to POSIX shells.
    expect(result.content).toContain(workdir);
  });

  it("captures stderr separately and merges it into the result", async () => {
    const result = await bashTool.execute(
      { command: "echo to-stdout; echo to-stderr >&2" },
      makeContext(workdir),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("to-stdout");
    expect(result.content).toContain("to-stderr");
  });

  it("reports a non-zero exit code as a failure", async () => {
    const result = await bashTool.execute(
      { command: "exit 3" },
      makeContext(workdir),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Command failed with exit code: 3");
  });

  it("handles pipes and multi-line output", async () => {
    const result = await bashTool.execute(
      { command: "printf 'a\\nb\\nc\\n' | wc -l" },
      makeContext(workdir),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("3");
  });

  // Spec bash-tools.md / 跨平台显式 shell 解析 / 场景 1: process
  // substitution needs a real bash/zsh, /bin/sh (dash on Debian/Ubuntu)
  // fails with "syntax error near '('".
  it.skipIf(isWindows)(
    "executes bash-only process substitution without syntax errors (bash-tools.md / 跨平台显式 shell 解析 / 场景 1)",
    async () => {
      const result = await bashTool.execute(
        { command: "comm -23 <(echo a) <(echo b)" },
        makeContext(workdir),
      );
      expect(result.success).toBe(true);
      expect(result.content).toContain("a");
      expect(result.content).not.toContain("syntax error");
    },
  );

  it.skipIf(isWindows)("reports a cwd change through onCwdChange", async () => {
    const context = makeContext(workdir);
    let changedTo: string | undefined;
    context.onCwdChange = (newCwd) => {
      changedTo = newCwd;
    };

    const result = await bashTool.execute({ command: "cd /tmp" }, context);
    expect(result.success).toBe(true);
    expect(changedTo).toBe("/tmp");
  });
});
