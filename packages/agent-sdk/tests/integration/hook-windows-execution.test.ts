/**
 * Real-spawn hook execution tests (Windows only).
 *
 * Unlike the mocked unit tests in tests/services/hook.test.ts, child_process is
 * NOT mocked here: hook commands are executed through the real OS shell. This
 * guards the cmd.exe quote-handling issue (issue #1773) that mocked tests can
 * never catch — a command like `node "C:\path\script.js"` must succeed when
 * executed via Git Bash on Windows. Skipped on non-Windows machines or when no
 * Git Bash is installed.
 *
 * The second block covers the other half of the routing decision: a session that
 * opted into the PowerShell tool runs its hooks through PowerShell, and the
 * protocol's block verdict (exit code 2) still comes out — which is only true
 * because of the `$?` / `$LASTEXITCODE` statement the PowerShell branch appends
 * (`utils/shell/powershellProvider.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

import { executeCommand } from "../../src/services/hook.js";
import { resolveShellPath } from "../../src/utils/shellResolver.js";
import { getPowerShellPath } from "../../src/utils/shell/powershellDetection.js";
import { POWERSHELL_TOOL_ENV_VAR } from "../../src/utils/shell/shellToolGate.js";
import type { HookExecutionContext } from "../../src/types/hooks.js";
import { longFormTempDir } from "../helpers/tempDir.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWindows = process.platform === "win32";
// Resolved at module load so skipIf runs before any test executes.
const gitBashPath = isWindows ? resolveShellPath() : undefined;
const powerShellPath = isWindows ? getPowerShellPath() : undefined;

describe.skipIf(!isWindows || !gitBashPath)(
  "hook execution with real spawn on Windows",
  () => {
    beforeAll(() => {
      // escape hatch: executeCommand short-circuits when NODE_ENV === "test"
      // (returns a fake success), so opt into a real spawn here.
      process.env.TEST_HOOK_EXECUTION = "true";
    });

    afterAll(() => {
      delete process.env.TEST_HOOK_EXECUTION;
    });

    it("executes a quoted Windows-path command via Git Bash", async () => {
      const scriptPath = path.join(
        __dirname,
        "..",
        "fixtures",
        "hook-script.js",
      );
      const context: HookExecutionContext = {
        event: "PostToolUse",
        toolName: "Edit",
        projectDir: process.cwd(),
        timestamp: new Date(),
      };

      const result = await executeCommand(`node "${scriptPath}"`, context, {
        timeout: 30000,
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("hook-ok");
    });
  },
);

describe.skipIf(!isWindows || !powerShellPath)(
  "hook execution through PowerShell",
  () => {
    let workdir: string;

    beforeAll(() => {
      process.env.TEST_HOOK_EXECUTION = "true";
      workdir = fs.mkdtempSync(path.join(longFormTempDir(), "wave-ps-hook-"));
      // The project settings file, not the environment variable: settings win
      // over the process env, so this pins the session's shell no matter what
      // the machine's user-level ~/.wave/settings.json says.
      fs.mkdirSync(path.join(workdir, ".wave"), { recursive: true });
      fs.writeFileSync(
        path.join(workdir, ".wave", "settings.json"),
        JSON.stringify({ env: { [POWERSHELL_TOOL_ENV_VAR]: "1" } }),
      );
    });

    afterAll(() => {
      delete process.env.TEST_HOOK_EXECUTION;
      fs.rmSync(workdir, { recursive: true, force: true });
    });

    const context = (): HookExecutionContext => ({
      event: "PostToolUse",
      toolName: "Edit",
      projectDir: workdir,
      timestamp: new Date(),
    });

    it("runs the command through PowerShell", async () => {
      const result = await executeCommand(
        "Write-Output ps-hook-ok",
        context(),
        {
          timeout: 30000,
        },
      );

      expect(result.success).toBe(true);
      expect(result.stdout?.trim()).toBe("ps-hook-ok");
    });

    it("keeps a native program's exit code 2 as the block verdict", async () => {
      // The load-bearing case. PowerShell does not inherit a native program's
      // exit code (measured on 5.1: `powershell -Command 'cmd /c exit 2'` → 1),
      // and 1 means "failed, do not block" to the protocol — so without the
      // appended statement a blocking hook would silently stop blocking.
      //
      // `$host.Name` is printed first so this test also proves which shell ran:
      // the PowerShell branch's wrapper is a bash syntax error, and bash answers
      // a syntax error with 2 as well, so the exit code alone cannot tell them
      // apart.
      const result = await executeCommand(
        "$host.Name; cmd /c exit 2",
        context(),
        { timeout: 30000 },
      );

      expect(result.stdout?.trim()).toBe("ConsoleHost");
      expect(result.exitCode).toBe(2);
      expect(result.success).toBe(false);
    });

    it("does not turn a passing hook into a failing one over a stale $LASTEXITCODE", async () => {
      // `$LASTEXITCODE` still holds 128 here, while `$?` is true because the last
      // statement succeeded. Reading the wrong one would fail every hook that
      // runs a native command and then prints something.
      const result = await executeCommand(
        "cmd /c exit 128; Write-Output recovered",
        context(),
        { timeout: 30000 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
      expect(result.stdout?.trim()).toBe("recovered");
    });
  },
);
