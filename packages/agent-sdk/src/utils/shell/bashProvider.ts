import * as path from "path";
import { toPosixPath } from "../path.js";
import { buildSearchShellPrelude } from "../searchShell.js";
import { resolveTempDir } from "../tempDir.js";
import { getShellSnapshot } from "./shellSnapshot.js";
import type {
  ShellExecCommand,
  ShellExecOptions,
  ShellPrepareOptions,
  ShellProvider,
} from "./shellProvider.js";

/**
 * Switch the console's output code page to UTF-8 before the command runs.
 *
 * Every console has its own output code page, and on a zh-CN system the default
 * is 936 (GBK). A native program writing localized text — `taskkill`, `ping`,
 * a compiler's diagnostics — encodes it in that code page, so the bytes that
 * arrive on the pipe are GBK and decoding them as UTF-8 turns them into U+FFFD
 * (issue #1753). `chcp.com` sets the code page for the whole console, which
 * includes the programs the command goes on to spawn, so the bytes are UTF-8
 * before they are ever written. That is why the fix lives here and not in the
 * decoder the tool used to carry: the decoder was working around a stream that
 * should not have been GBK in the first place, and it guessed wrong whenever
 * the head of the stream was a truncated character. Claude Code prefixes the
 * same statement (`chcp.com 65001 >nul &`).
 *
 * What the switch costs:
 * - one `chcp.com` spawn per command (measured here: +120-150 ms on Windows,
 *   where the login shell alone already takes ~430 ms);
 * - text a program prints through the ANSI API rather than the console keeps
 *   the ANSI code page and stays mojibake — `ipconfig`'s adapter names and
 *   `net start`'s service names are the two that show it. File contents in a
 *   non-UTF-8 code page are in the same boat: the console code page never
 *   governed either.
 *
 * Two details matter: the output is discarded because `chcp.com` prints
 * "Active code page: 65001", and the separator is `;` rather than `&&` so a
 * shell that cannot find `chcp.com` still runs the command.
 */

/**
 * `chcp.com` resolved to an absolute path, or the bare name as a last resort.
 *
 * Claude Code builds the same path (`join(SYSTEMROOT, "System32", "chcp.com")`)
 * instead of letting PATH find it, and the reason is the same here: a
 * `chcp.com` earlier on PATH would run in place of the system one. Git Bash
 * needs the path with forward slashes — backslashes are escapes there.
 *
 * The path is validated before use (drive letter, slash, then nothing a shell
 * would interpret or a word-splitter would split on: no space, quote, `%`,
 * `!`, `^`, `&`, `|`, angle brackets, parentheses). Anything unexpected —
 * no `SYSTEMROOT`/`windir`, a space inside it — falls back to the bare name:
 * a switch that resolves through PATH is still better than one that never runs.
 */
const CHCP_SAFE_PATH = /^[A-Za-z]:\/[^"%!^&<>|()\s\r\n\0]*$/;

function resolveChcpCommand(): string {
  // Three spellings, and an empty value counts as absent — a launcher that
  // exports `SYSTEMROOT=` must not beat a real `windir`.
  const root = [
    process.env.SystemRoot,
    process.env.SYSTEMROOT,
    process.env.windir,
  ].find((value) => value);
  if (!root) return "chcp.com";
  const normalized = root.replace(/[\\/]+$/, "").replace(/\\/g, "/");
  const candidate = `${normalized}/System32/chcp.com`;
  return CHCP_SAFE_PATH.test(candidate) ? candidate : "chcp.com";
}

/** The switch itself: `<resolved chcp.com> 65001`, output discarded. */
export function consoleCodePagePrologue(): string {
  return `${resolveChcpCommand()} 65001 >/dev/null 2>&1`;
}

/**
 * Put {@link consoleCodePagePrologue} in front of a command string.
 *
 * In front of the *whole* string, not inside the `eval` body: the bytes the
 * model wrote then stay exactly as written (the CWD wrapper quotes them, and a
 * here-doc in them must not be re-parsed), and the switch cannot be reached by
 * the command's own exit status or by a `&& pwd -P` that follows it.
 *
 * The sandbox does not lose the switch: the code page belongs to the console,
 * which every descendant inherits, so it holds for a command the wrapper runs
 * in its own `bash -c` as well.
 */
export function withConsoleCodePage(command: string): string {
  return process.platform === "win32"
    ? `${consoleCodePagePrologue()}; ${command}`
    : command;
}

/** A path as exactly one shell word. */
function quoteShellWord(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The prologue every command gets: the session's shell snapshot first (so the
 * user's functions, options and aliases exist), then wave's search shadows on
 * top — a user `alias grep=…` must not win over the shadow's `.gitignore`
 * semantics (see `docs/specs/core/bash-tools.md`「登录 shell 环境注入」场景 12).
 *
 * Both sit inside the command string rather than in front of the spawn so that
 * they also survive the sandbox wrapper, which runs the command under its own
 * `bash -c`.
 *
 * The snapshot is why this is async: one login shell builds it on first use,
 * and a session must not pay that per command.
 */
async function withSessionPrelude(
  shellPath: string,
  command: string,
  opts: ShellPrepareOptions | undefined,
): Promise<string> {
  const head: string[] = [];
  const snapshot = await getShellSnapshot(
    shellPath,
    opts?.tempDir ?? resolveTempDir(),
  );
  if (snapshot) {
    // `|| true`: the snapshot is an optimization. A file that vanished (temp
    // dir cleaned mid-session) leaves the command running without it.
    head.push(`. ${quoteShellWord(snapshot)} 2>/dev/null || true`);
  }
  const prelude = buildSearchShellPrelude();
  if (prelude) head.push(prelude);
  return head.length > 0 ? `${head.join("\n")}\n${command}` : command;
}

/**
 * Wrap a user command so we can append CWD tracking (`&& pwd -P`) without the
 * appended part being affected by trailing here-docs, unbalanced quotes, or
 * multi-line syntax in the user command.
 *
 * The command is single-quoted (with embedded single quotes escaped via the
 * classic `'"'"'` sequence) and run through `eval`. Because the entire user
 * command becomes a single literal argument to `eval`, any here-doc inside it
 * only opens/closes during eval's own second parse pass and cannot leak out to
 * clobber the trailing `&& pwd -P`. Works on sh/dash/bash and Git Bash.
 */
function wrapCommandForCwdTracking(
  command: string,
  cwdFileForBash: string,
): string {
  const escaped = command.replace(/'/g, `'"'"'`);
  return `eval '${escaped}' && pwd -P >| ${cwdFileForBash}`;
}

/** bash, driven through Git Bash on Windows and bash/zsh elsewhere. */
export function createBashProvider(shellPath: string): ShellProvider {
  return {
    type: "bash",
    shellPath,
    // Git Bash and POSIX shells both get their own process group so
    // killProcessTree can take the whole tree down (issue #2742).
    detached: true,
    prepareCommand: (command, opts) =>
      withSessionPrelude(shellPath, command, opts),
    buildExecCommand(
      command: string,
      opts: ShellExecOptions,
    ): ShellExecCommand {
      const cwdFilePath = path.join(
        opts.tempDir(),
        `wave_cwd_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.tmp`,
      );
      if (!opts.cwdTracking) {
        return {
          commandString: withConsoleCodePage(command),
          cwdFilePath,
        };
      }
      // Git Bash's `pwd -P` writes an MSYS-style path, so the file path handed
      // to the shell must be POSIX-shaped; the caller converts the *content*
      // back (bashTool).
      return {
        commandString: withConsoleCodePage(
          wrapCommandForCwdTracking(command, toPosixPath(cwdFilePath)),
        ),
        cwdFilePath,
      };
    },
    // bash takes the command string itself; spawn's `shell` option prepends
    // the binary (`spawn(commandString, { shell: shellPath })`).
    getSpawnArgs: () => [],
    // Nothing today: the only env bash needs is the session env plus the
    // sandbox wrapper's TMPDIR, both merged by the caller.
    getEnvironmentOverrides: () => ({}),
  };
}
