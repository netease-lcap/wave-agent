import * as path from "path";
import { toPosixPath } from "../path.js";
import { buildSearchShellPrelude } from "../searchShell.js";
import type {
  ShellExecCommand,
  ShellExecOptions,
  ShellProvider,
} from "./shellProvider.js";

/**
 * Prepend wave's search shadows to [command] (`utils/searchShell.ts`).
 *
 * Every Bash call is a fresh shell, so — unlike Claude Code, which writes one
 * shell snapshot per session — the prelude goes in per spawn. It sits inside the
 * command string rather than in front of the spawn so that it also survives the
 * sandbox wrapper, which runs the command under its own `bash -c`.
 */
function withSearchShadows(command: string): string {
  const prelude = buildSearchShellPrelude();
  if (!prelude) return command;
  return `${prelude}\n${command}`;
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
    prepareCommand: withSearchShadows,
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
