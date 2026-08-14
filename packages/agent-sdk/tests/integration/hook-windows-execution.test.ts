/**
 * Real-spawn hook execution tests (Windows only).
 *
 * Unlike the mocked unit tests in tests/services/hook.test.ts, child_process is
 * NOT mocked here: hook commands are executed through the real OS shell. This
 * guards the cmd.exe quote-handling issue (issue #1773) that mocked tests can
 * never catch — a command like `node "C:\path\script.js"` must succeed when
 * executed via Git Bash on Windows. Skipped on non-Windows machines or when no
 * Git Bash is installed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { fileURLToPath } from "url";

import { executeCommand } from "../../src/services/hook.js";
import { resolveShellPath } from "../../src/utils/shellResolver.js";
import type { HookExecutionContext } from "../../src/types/hooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isWindows = process.platform === "win32";
// Resolved at module load so skipIf runs before any test executes.
const gitBashPath = isWindows ? resolveShellPath() : undefined;

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
