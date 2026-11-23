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
        return { commandString: command, cwdFilePath };
      }
      // Git Bash's `pwd -P` writes an MSYS-style path, so the file path handed
      // to the shell must be POSIX-shaped; the caller converts the *content*
      // back (bashTool).
      return {
        commandString: wrapCommandForCwdTracking(
          command,
          toPosixPath(cwdFilePath),
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
