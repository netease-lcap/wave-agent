/**
 * Real-spawn integration tests for the PowerShell tool.
 *
 * tests/tools/powershellTool/powershellTool.test.ts mocks child_process, so it
 * can only prove the plumbing carries an exit code someone else produced. These
 * cases run the real shell instead, which is the only way to see the two things
 * the provider's probe adds: a native child's `$LASTEXITCODE` survives, and a
 * `Set-Location` survives the process that ran it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { powershellTool } from "../../src/tools/powershellTool/powershellTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

const isWindows = process.platform === "win32";

function makeContext(
  workdir: string,
  onCwdChange?: (cwd: string) => void,
): ToolContext {
  // Without a permissionManager the gate is skipped and the command spawns.
  return {
    workdir,
    taskManager: createMockTaskManager(),
    onCwdChange,
  };
}

function exitCodeOf(result: { metadata?: unknown }): number | undefined {
  return (result.metadata as { exitCode?: number } | undefined)?.exitCode;
}

describe.skipIf(!isWindows)("PowerShell tool with real shell spawn", () => {
  let workdir: string;

  beforeAll(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-ps-real-"));
  });

  afterAll(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("reports a native program's exit code instead of the shell's", async () => {
    const result = await powershellTool.execute(
      { command: "cmd /c exit 42" },
      makeContext(workdir),
    );

    expect(exitCodeOf(result)).toBe(42);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Command failed with exit code: 42");
  });

  it("reports 0 when the command succeeded", async () => {
    const result = await powershellTool.execute(
      { command: "Write-Output hi" },
      makeContext(workdir),
    );

    expect(exitCodeOf(result)).toBe(0);
    expect(result.success).toBe(true);
    expect(result.content).toContain("hi");
  });

  it("carries a cmdlet-only failure as exit code 1", async () => {
    const result = await powershellTool.execute(
      { command: "Get-Item .\\does-not-exist.txt -ErrorAction Stop" },
      makeContext(workdir),
    );

    expect(exitCodeOf(result)).toBe(1);
    expect(result.success).toBe(false);
  });

  it("keeps a Set-Location for the next call via onCwdChange", async () => {
    const sub = path.join(workdir, "sub");
    fs.mkdirSync(sub, { recursive: true });
    const onCwdChange = vi.fn();

    const moved = await powershellTool.execute(
      { command: "Set-Location -Path 'sub'" },
      makeContext(workdir, onCwdChange),
    );
    expect(moved.success).toBe(true);

    // 8.3 vs long spelling of the same directory: compare resolved paths.
    const real = (p: string) => fs.realpathSync.native(p);
    expect(onCwdChange).toHaveBeenCalledTimes(1);
    const tracked = onCwdChange.mock.calls[0]![0] as string;
    expect(real(tracked)).toBe(real(sub));

    const next = await powershellTool.execute(
      { command: "(Get-Location).Path" },
      makeContext(tracked),
    );
    expect(next.success).toBe(true);
    expect(real(next.content.trim())).toBe(real(sub));
  });
});
