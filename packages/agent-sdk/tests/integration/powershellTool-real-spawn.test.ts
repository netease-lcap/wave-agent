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
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { Container } from "../../src/utils/container.js";
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

// The exit code rides `data.exitCode` since issue #3055 阶段 2 (it used to be
// `ToolResult.metadata.exitCode`).
function exitCodeOf(result: { data?: unknown }): number | undefined {
  return (result.data as { exitCode?: number } | undefined)?.exitCode;
}

// How a non-zero exit reads. Since #3087 `success` only answers "did the
// command run at all", so this — not `error` — is where a failed command shows
// up (spec `core/powershell-tool.md`「退出码不是工具成败」).
function interpretationOf(result: { data?: unknown }): string | undefined {
  return (result.data as { returnCodeInterpretation?: string } | undefined)
    ?.returnCodeInterpretation;
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
    // The command ran, so its exit code is the answer rather than a failed
    // call: `cmd` is not in the family table, so the reading is the fallback
    // sentence and `error` stays empty (`success: false` would mean the command
    // never started).
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(interpretationOf(result)).toBe("Command failed with exit code: 42");
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
    // Same rule as above: `Get-Item` is not in the family table either, so the
    // exit 1 reads as a failure of the *command*, not of the tool call.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(interpretationOf(result)).toBe("Command failed with exit code: 1");
  });

  it("runs a background command as a real, attached PowerShell process", async () => {
    const manager = new BackgroundTaskManager(new Container(), { workdir });
    const marker = path.join(workdir, "bg-marker.txt");

    const result = await powershellTool.execute(
      {
        command: `Set-Content -Path '${marker}' -Value done -Encoding utf8; Write-Output bg-ok`,
        run_in_background: true,
      },
      { ...makeContext(workdir), backgroundTaskManager: manager },
    );

    expect(result.success).toBe(true);
    const taskId = result.backgroundTaskId;
    if (!taskId) throw new Error("no background task id was returned");
    // The manager's own state is the signal: a detached child would report
    // "completed" without ever having run the command (measured), so the marker
    // file below is what makes this a proof rather than a status check.
    await vi.waitFor(
      () => expect(manager.getTask(taskId)?.status).toBe("completed"),
      { timeout: 30000 },
    );
    expect(fs.readFileSync(marker, "utf8").trim()).toBe("done");
    const outputPath = manager.getTask(taskId)?.outputPath;
    if (!outputPath) throw new Error("background task has no log path");
    expect(fs.readFileSync(outputPath, "utf8").trim()).toBe("bg-ok");
    manager.cleanup();
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
