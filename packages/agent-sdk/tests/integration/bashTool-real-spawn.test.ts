/**
 * Real-spawn integration tests for bashTool.
 *
 * Unlike tests/tools/bashTool.test.ts (which mocks child_process), commands
 * here run through the real OS shell: spawn, pipes, stdout/stderr separation,
 * exit codes and the cwd-tracking wrapper are all exercised end to end.
 * On Windows the shell is Git Bash (via resolveShellPath), on POSIX bash/zsh.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { BASH_MAX_OUTPUT_BYTES } from "../../src/constants/toolLimits.js";
import { bashTool } from "../../src/tools/bashTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createBashProvider } from "../../src/utils/shell/bashProvider.js";
import { getShellSnapshot } from "../../src/utils/shell/shellSnapshot.js";
import { WINDOWS_GIT_BASH_PATHS } from "../../src/utils/shellResolver.js";
import { resolveTempDir } from "../../src/utils/tempDir.js";
// The wrapper, not `node:child_process`: lint bans the raw family everywhere
// (windowsHide), and a probe has no reason to be the exception.
import { execFileSyncHidden } from "../../src/utils/execFileHidden.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";

const isWindows = process.platform === "win32";

/**
 * `printf` escapes that reproduce `bytes` exactly.
 *
 * Node has a UTF-8 encoder but no way to hand raw bytes to a shell, and the
 * printf builtin only ever sees text — so every byte goes in as a three-digit
 * octal escape, which also keeps `%`, quotes and backslashes out of the command.
 */
function printfOctal(bytes: Buffer): string {
  return Array.from(
    bytes,
    (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
  ).join("");
}

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

  it("reads a non-zero exit as the command's answer, not a failed call", async () => {
    // `printf`（而不是 `echo`）免掉命令自己的尾部换行，正文就能逐字钉住。
    const result = await bashTool.execute(
      { command: "printf boom; exit 3" },
      makeContext(workdir),
    );
    // 命令跑起来了：退出码是它的答案（spec core/bash-tools.md「退出码不是工具成败」）。
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(
      expect.objectContaining({
        exitCode: 3,
        returnCodeInterpretation: "Command failed with exit code: 3",
      }),
    );
    expect(result.content).toBe("boom\nExit code 3");
  });

  it("handles pipes and multi-line output", async () => {
    const result = await bashTool.execute(
      { command: "printf 'a\\nb\\nc\\n' | wc -l" },
      makeContext(workdir),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("3");
  });

  it("keeps the rest of a stream intact when its head starts mid-character", async () => {
    // The case that motivated dropping the decoder: `tail -c N` over a
    // transcript cuts inside a 3-byte character, so the first byte on the pipe
    // is a continuation byte. The old decoder read that head as "not UTF-8,
    // therefore GBK" and re-decoded the whole stream, turning the entire tail
    // into mojibake. One lenient UTF-8 decode costs a single U+FFFD at the cut
    // and every character after it is exact.
    const text = "第一批第二批第三批：用 `Edit` 修改 `Glob` 的输出";
    const bytes = Buffer.from(text, "utf8");
    // The last byte of 第: one orphan continuation byte, then a character
    // boundary — the shape of the real report.
    const command = `printf '${printfOctal(bytes.subarray(2))}'`;

    const result = await bashTool.execute({ command }, makeContext(workdir));

    expect(result.content).toContain(`\uFFFD${text.slice(1)}`);
    expect(result.content.match(/\uFFFD/g) ?? []).toHaveLength(1);
  });

  it("keeps a character whole across a pipe read boundary", async () => {
    // 管道按 64 KiB 读，一个汉字正好跨在两次读之间。逐 chunk 的 `toString()`
    // 会在每个边界落 U+FFFD（实测 100 KiB 中文输出里 3 个），把好好的中文
    // 打出一串替换符；挂 `setEncoding("utf8")` 后由 Node 自带的流式解码器
    // 跨 chunk 续完这个字，字符数与字节数严格对得上。
    const line = "这是一段用来测试的中文内容，交付即可验收\n";
    const lineBytes = Buffer.byteLength(line, "utf8");
    const totalBytes = 70_000; // > 64 KiB：至少跨过一次读边界
    const fullLines = Math.floor(totalBytes / lineBytes);
    const restBytes = totalBytes - fullLines * lineBytes;
    // 整行里每个字符都是 3 字节，剩下的那截也是一串完整的汉字。
    const expectedChars = fullLines * line.length + restBytes / 3;

    const result = await bashTool.execute(
      { command: `yes '${line.trim()}' | head -c ${totalBytes}` },
      makeContext(workdir),
    );

    expect(result.content.match(/\uFFFD/g) ?? []).toHaveLength(0);

    // 70 KB 的中文早就超过了 3 万字节的输出预算，所以模型看到的是预览、全文
    // 在盘上。跨读完好的判定要针对全文——它是这条用例真正要证的东西；预览
    // 那一侧只保证按字节截断、不留半个字。
    const data = result.data as {
      persistedOutputPath?: string;
      stdout?: string;
    };
    expect(data.persistedOutputPath).toBeTruthy();
    const full = fs.readFileSync(data.persistedOutputPath!, "utf8");
    expect(full.match(/\uFFFD/g) ?? []).toHaveLength(0);
    expect(full).toHaveLength(expectedChars);

    expect(Buffer.byteLength(data.stdout ?? "", "utf8")).toBeLessThanOrEqual(
      BASH_MAX_OUTPUT_BYTES,
    );
  });

  it("receives a native program's localized text as UTF-8", async () => {
    // The provider puts the console's code page at 65001 before the command
    // runs (bashProvider's consoleCodePagePrologue), so a localized message
    // from a native exe arrives as UTF-8. At the console default of 936
    // `taskkill` writes GBK and this string would hold U+FFFD instead.
    const result = await bashTool.execute(
      {
        command:
          process.platform === "win32"
            ? "taskkill //F //PID 999999"
            : "ls --no-such-option /nonexistent 2>&1",
      },
      makeContext(workdir),
    );

    expect(result.content).not.toContain("\uFFFD");
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
    // The wrapper reports `pwd -P`, i.e. the physical path, so compare against
    // the resolved /tmp — on macOS that is /private/tmp.
    expect(changedTo).toBe(fs.realpathSync("/tmp"));
  });
});

/** The very first command in this suite pays for one real login shell. */
const SNAPSHOT_TEST_TIMEOUT_MS = 60_000;
const SNAPSHOT_DIR_NAME = "wave-shell-snapshots";
const BASH_PROBE_TIMEOUT_MS = 20_000;

// What the fake rc defines and, just as importantly, prints: an rc whose
// output leaked into a command result would otherwise still look green.
const RC_ALIAS = "wave_from_rc";
const RC_ALIAS_OUTPUT = "alias-ok";
const RC_FUNCTION = "wave_rc_function";
const RC_NOISE_STDOUT = "RC_NOISE_STDOUT";
const RC_NOISE_STDERR = "RC_NOISE_STDERR";

function shellAnswers(shellPath: string): boolean {
  try {
    execFileSyncHidden(shellPath, ["-c", "echo ok"], {
      stdio: "ignore",
      timeout: BASH_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/** Absolute path of a PATH-resolved `bash`, or undefined. */
function absoluteSelfPath(): string | undefined {
  try {
    const raw = execFileSyncHidden("bash", ["-c", "command -v bash"], {
      encoding: "utf8",
      timeout: BASH_PROBE_TIMEOUT_MS,
    });
    const resolved = String(raw).trim();
    return path.isAbsolute(resolved) && fs.existsSync(resolved)
      ? resolved
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Absolute path of a real `bash`, or undefined when this machine has none (the
 * suite is skipped then).
 *
 * `WAVE_SHELL` is deliberately not consulted: on a developer machine it often
 * points at zsh, and these cases need the shell that reads `.bashrc`. Git Bash
 * is probed where `resolveShellPath` looks for it, so the Windows runner is
 * covered by the same list.
 */
function findRealBash(): string | undefined {
  const candidates: Array<string | undefined> = [
    process.env.WAVE_GIT_BASH_PATH,
    ...WINDOWS_GIT_BASH_PATHS,
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
    "/opt/homebrew/bin/bash",
    "bash",
  ];
  for (const candidate of candidates) {
    if (!candidate || !shellAnswers(candidate)) continue;
    // A bare `bash` from $PATH is resolved first: the snapshot cache keys on
    // the exact shell string and `resolveShellPath` wants a real executable
    // path (`accessSync` on a bare name looks in the process cwd).
    if (path.isAbsolute(candidate)) return candidate;
    const resolved = absoluteSelfPath();
    if (resolved) return resolved;
  }
  return undefined;
}

const realBash = findRealBash();
// `describe.skipIf` keeps the body from running; the empty stand-in is there
// only so the cases type-check without a non-null assertion.
const bashPath = realBash ?? "";

/**
 * The session's shell snapshot seen through the Bash tool: a fake HOME with a
 * real `.bashrc`, a real login shell, and the command string the tool hands to
 * `spawn`.
 *
 * A real spawn (and therefore `mkdtemp`) is mandatory here, unlike in the
 * mockable unit tests: the mechanism *is* "a login shell writes a file, later
 * commands source it". Whether the rc was really read, whether its output
 * really stayed out of the result, and whether the snapshot really exists on
 * disk are properties of that spawn — a mocked `child_process` would only
 * replay the test's own idea of the generated script.
 */
describe.skipIf(realBash === undefined)(
  "bashTool session shell snapshot (real login shell)",
  () => {
    let workdir: string;
    let fakeHome: string;
    let snapshotTempDir: string;
    let fallbackTempDir: string;
    let homedirBeforeStub: string;

    beforeAll(() => {
      workdir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-snap-work-"));
      fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "wave-snap-home-"));
      snapshotTempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "wave-snap-tmp-"),
      );
      fallbackTempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "wave-snap-fallback-"),
      );

      fs.writeFileSync(
        path.join(fakeHome, ".bashrc"),
        [
          `alias ${RC_ALIAS}='echo ${RC_ALIAS_OUTPUT}'`,
          `${RC_FUNCTION}() { echo function-ok; }`,
          `echo ${RC_NOISE_STDOUT}`,
          `echo ${RC_NOISE_STDERR} >&2`,
          "",
        ].join("\n"),
      );

      // A temp dir whose snapshot directory cannot be created (a file holds
      // the name): `getShellSnapshot` answers undefined and the command runs
      // in the plain `-c` shape it had before the mechanism. This is the only
      // way to reach that branch through the tool — `resolveShellPath` accepts
      // a `WAVE_SHELL` only when it names bash/zsh, so a `/bin/sh` override
      // never reaches the provider at all.
      fs.writeFileSync(
        path.join(fallbackTempDir, SNAPSHOT_DIR_NAME),
        "not a directory\n",
      );

      // `tests/setup.ts` pins `os.homedir()` for every file, so the rc file
      // has to be re-pointed at a directory this suite owns...
      homedirBeforeStub = os.homedir();
      vi.mocked(os.homedir).mockReturnValue(fakeHome);
      // ...and so does the login shell's own `~`, which reads `$HOME`.
      vi.stubEnv("HOME", fakeHome);
      // Pin the shell itself: `resolveShellPath` prefers `WAVE_SHELL` over
      // `$SHELL`, which is zsh on many machines — the snapshot would then
      // read `.zshrc` and see none of the rc above.
      vi.stubEnv("WAVE_SHELL", bashPath);
      // Snapshots land in a directory this suite owns, so the assertions can
      // point at them and nothing is left behind in the real temp dir.
      vi.stubEnv("WAVE_TMPDIR", snapshotTempDir);
    });

    afterAll(() => {
      vi.mocked(os.homedir).mockReturnValue(homedirBeforeStub);
      vi.unstubAllEnvs();
      for (const dir of [workdir, fakeHome, snapshotTempDir, fallbackTempDir]) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it(
      "makes an alias from the rc available to a command",
      { timeout: SNAPSHOT_TEST_TIMEOUT_MS },
      async () => {
        const result = await bashTool.execute(
          { command: RC_ALIAS },
          makeContext(workdir),
        );

        expect(result.success).toBe(true);
        // An alias is expanded while a line is parsed, so it needs the
        // snapshot's `expand_aliases`; `eval` (which the cwd wrapper uses)
        // re-parses the model's line after the snapshot has been sourced.
        expect(result.content).toContain(RC_ALIAS_OUTPUT);
      },
    );

    it(
      "keeps the rc's stdout and stderr out of the command result",
      { timeout: SNAPSHOT_TEST_TIMEOUT_MS },
      async () => {
        const result = await bashTool.execute(
          { command: "echo plain-ok" },
          makeContext(workdir),
        );

        expect(result.success).toBe(true);
        expect(result.content).toContain("plain-ok");
        // The rc is read by the snapshotting login shell, never by the command
        // shell, so neither of its echo lines may reach the model.
        expect(result.content).not.toContain(RC_NOISE_STDOUT);
        expect(result.content).not.toContain(RC_NOISE_STDERR);
      },
    );

    it(
      "writes the snapshot under the temp dir with the rc's alias in it",
      { timeout: SNAPSHOT_TEST_TIMEOUT_MS },
      async () => {
        // Build it here rather than relying on an earlier case having run.
        const result = await bashTool.execute(
          { command: "echo snapshot-probe" },
          makeContext(workdir),
        );
        expect(result.success).toBe(true);

        const snapshotDir = path.join(resolveTempDir(), SNAPSHOT_DIR_NAME);
        expect(fs.existsSync(snapshotDir)).toBe(true);
        const snapshots = fs
          .readdirSync(snapshotDir)
          .filter(
            (name) => name.startsWith("snapshot-") && name.endsWith(".sh"),
          )
          .map((name) => ({
            name,
            body: fs.readFileSync(path.join(snapshotDir, name), "utf8"),
          }));
        expect(snapshots.length).toBeGreaterThan(0);

        const carryingAlias = snapshots.filter((snapshot) =>
          snapshot.body.includes(RC_ALIAS),
        );
        expect(carryingAlias).toHaveLength(1);
        const snapshot = carryingAlias[0];
        if (!snapshot) throw new Error("expected a snapshot holding the alias");
        expect(snapshot.body).toContain(RC_ALIAS_OUTPUT);
        // The rc's noise was redirected away while it was read, so it is not
        // captured into the file either.
        expect(snapshot.body).not.toContain(RC_NOISE_STDOUT);
        expect(snapshot.body).not.toContain(RC_NOISE_STDERR);
      },
    );

    it(
      "runs the command in the plain -c shape when no snapshot can be built",
      { timeout: SNAPSHOT_TEST_TIMEOUT_MS },
      async () => {
        // A different temp dir is a different cache key, so this really tries
        // (and fails) to build a snapshot instead of reusing a good one.
        vi.stubEnv("WAVE_TMPDIR", fallbackTempDir);
        try {
          const result = await bashTool.execute(
            { command: "echo fallback-ok" },
            makeContext(workdir),
          );

          expect(result.success).toBe(true);
          expect(result.content).toContain("fallback-ok");
          expect(result.content).not.toContain(RC_NOISE_STDOUT);
          expect(result.content).not.toContain(RC_NOISE_STDERR);

          // No snapshot means no `. '<file>'` prelude line: the command keeps
          // the `-c` shape it had before the mechanism existed.
          const command = await createBashProvider(bashPath).prepareCommand(
            "echo x",
            { tempDir: fallbackTempDir },
          );
          expect(command).not.toContain(SNAPSHOT_DIR_NAME);
          expect(command).not.toMatch(/^\. '/m);

          // And the decoy really is the reason: the module itself answers
          // "no snapshot" for this pair (cached, so it is the very same
          // attempt the command above made).
          await expect(
            getShellSnapshot(bashPath, fallbackTempDir),
          ).resolves.toBeUndefined();
        } finally {
          vi.stubEnv("WAVE_TMPDIR", snapshotTempDir);
        }
      },
    );

    it(
      "puts the snapshot before the search shadows in the command string",
      { timeout: SNAPSHOT_TEST_TIMEOUT_MS },
      async () => {
        const command = await createBashProvider(bashPath).prepareCommand(
          "echo x",
          { tempDir: resolveTempDir() },
        );
        const lines = command.split("\n");

        // Line 1 sources the snapshot, so the user's functions and aliases
        // already exist when wave's shadows go on top of them — which is also
        // why the grep shadow starts with `unalias grep`. (The console code
        // page switch is not part of this string: it is prepended to the spawn
        // command, outside the eval wrapper.)
        const snapshotLine = lines[0];
        if (snapshotLine === undefined) throw new Error("expected a command");
        expect(snapshotLine.startsWith(". '")).toBe(true);
        expect(snapshotLine).toContain(SNAPSHOT_DIR_NAME);
        expect(snapshotLine).toContain("snapshot-");
        expect(lines[lines.length - 1]).toBe("echo x");

        // The grep shadow only exists where `wave-search-tools` is installed;
        // wherever it does, it must come after the snapshot line.
        const grepShadow = lines.indexOf("function grep {");
        if (grepShadow !== -1) expect(grepShadow).toBeGreaterThan(0);
        // Whatever the prelude holds, it sits between the two ends asserted
        // above — it may also be empty on an install with no search binary.
        expect(lines.length).toBeGreaterThanOrEqual(2);
      },
    );
  },
);
