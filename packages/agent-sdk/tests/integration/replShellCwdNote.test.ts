/**
 * Real-spawn integration tests for the `cd` note `$` splits out of a shell result.
 *
 * The note only exists because a command really moved the shell: the Bash wrapper
 * writes `pwd -P` to a temp file and `Bash` prepends the note it derives from it.
 * A hand-written `content` string cannot prove that shape — the previous round
 * shipped a fix a hand-written input could never have caught, because a real `cd`
 * puts the note in front of the tool's own sentence and the empty-output strip
 * then stops matching it.
 *
 * So every case here spawns the real shell through the real Bash tool. The only
 * thing the test supplies is the host context, which is what `$` is handed in a
 * real session.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReplPoolEntry } from "../../src/repl/catalog.js";
import {
  disposeReplRuntime,
  runReplScript,
} from "../../src/repl/replRuntime.js";
import { bashTool } from "../../src/tools/bashTool.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

/** The package root, a real directory for the session to live in. */
const SDK_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
/**
 * A real directory to `cd` into, resolved the way the shell resolves it (`pwd
 * -P`), so the note names this exact path on macOS too (`/private/var/...`).
 */
const OTHER_DIR = fs.realpathSync(path.join(SDK_ROOT, "src"));
/** Git Bash reports MSYS-style paths, so the note's spelling is POSIX-only. */
const isWindows = process.platform === "win32";

const POOL: ReplPoolEntry[] = [
  { name: "Bash", description: "Run a shell command" },
];

let seq = 0;

/** Run one script through the real sandbox, with the real Bash tool beneath it. */
async function runShell(
  command: string,
  onCwdChange?: (newCwd: string) => void,
): Promise<Record<string, unknown>> {
  seq += 1;
  const sessionKey = `repl-cwd-note-${seq}`;
  const context = {
    workdir: SDK_ROOT,
    taskManager: createMockTaskManager(),
    onCwdChange,
    toolManager: {
      execute: (
        _name: string,
        args: Record<string, unknown>,
        toolContext: ToolContext,
      ): Promise<ToolResult> => bashTool.execute(args, toolContext),
      getReplPool: () => POOL,
    },
  } as unknown as ToolContext;

  const result = await runReplScript({
    code: [
      "const out = await $`" + command + "`;",
      "return JSON.stringify(out);",
    ].join("\n"),
    pool: POOL,
    context,
    sessionKey,
  });
  disposeReplRuntime(sessionKey);
  expect(result.ok).toBe(true);
  return JSON.parse(result.value as string) as Record<string, unknown>;
}

describe("the shell's cd note, from a real shell", () => {
  it.skipIf(isWindows)(
    "reads an empty command that also moved the shell as [exit 0] plus cwdNote",
    async () => {
      const movedTo: string[] = [];
      const out = await runShell(`cd ${OTHER_DIR}`, (newCwd) =>
        movedTo.push(newCwd),
      );

      expect(out.exitCode).toBe(0);
      // The command printed nothing, and nothing is what the script reads — not
      // the note, not the tool's own sentence.
      expect(out.stdout).toBe("");
      expect(out.output).toBe("[exit 0]");
      expect(out.cwdNote).toBe(
        `Shell working directory changed to ${OTHER_DIR}`,
      );
      // The note is news, not decoration: the session really moved.
      expect(movedTo).toEqual([OTHER_DIR]);
    },
  );

  it.skipIf(isWindows)(
    "keeps the command's output while the shell also moved",
    async () => {
      const out = await runShell(`cd ${OTHER_DIR} && echo marker`, () => {});

      // 尾部空白由工具照 CC 去掉（`(st.stdout || "").trimEnd()`），所以 `$` 拿到的
      // 是不带尾换行的那份。
      expect(out.stdout).toBe("marker");
      expect(out.output).toBe("marker");
      expect(out.cwdNote).toBe(
        `Shell working directory changed to ${OTHER_DIR}`,
      );
    },
  );

  it.skipIf(isWindows)(
    "keeps the command's own copy of the note, and drops only the tool's line",
    async () => {
      const echoed = `Shell working directory changed to ${OTHER_DIR}`;
      const out = await runShell(`cd ${OTHER_DIR} && echo ${echoed}`, () => {});

      expect(out.stdout).toBe(echoed);
      expect(out.cwdNote).toBe(echoed);
    },
  );

  it("keeps the tool's sentence when the command itself printed it", async () => {
    // The round before last found this on a real machine: `echo` of the exact
    // sentence came back as an empty `stdout`.
    const out = await runShell("echo Command executed with exit code: 0");

    expect(out.stdout).toBe("Command executed with exit code: 0");
    expect(out.cwdNote).toBeUndefined();
  });
});
