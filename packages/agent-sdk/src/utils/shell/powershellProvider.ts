import * as path from "path";
import type {
  ShellExecCommand,
  ShellExecOptions,
  ShellProvider,
} from "./shellProvider.js";

/**
 * argv that turns the command string into "run this, once".
 *
 * - `-NoProfile`: the user's profile can define aliases and functions (and
 *   `conda init`-style hooks that print and slow every start). A command line
 *   the permission layer just judged must not be rewritten by a startup script.
 * - `-NonInteractive`: stdin is `/dev/null`, so anything that prompts would
 *   hang until the tool timeout. This makes it fail instead.
 * - `-NoLogo`: keeps the banner out of the model's output.
 * - `-Command`: the command string, as one argument — no `-EncodedCommand`
 *   base64, because the arguments are visible to the user in the process list
 *   and in the permission prompt.
 */
export const POWERSHELL_SPAWN_FLAGS = [
  "-NoProfile",
  "-NonInteractive",
  "-NoLogo",
  "-Command",
] as const;

/**
 * Append the exit-code probe and the CWD tracker to the command.
 *
 * Both are statements after the user's command, in one `-Command` string, so
 * they cost no extra process and can be read when the child exits.
 *
 * **Exit code.** PowerShell does not make its own exit status the native
 * program's: `cmd /c exit 42` alone leaves the process at 1. The probe is
 * `$LASTEXITCODE` (only set once a native program ran) → `$?` (true for a
 * cmdlet that succeeded) → 0/1, then `exit $_ec`. Same order as Claude Code's
 * `buildShellCommand()`; the copy is deliberate, because the two behaviours
 * this changes are the ones the tool has to be consistent about:
 * `native-ok; cmdlet-fail` now reports 0 (was 1) and `native-fail; cmdlet-ok`
 * reports the native code (was 0). Both are rarer than the case this fixes —
 * a successful native command whose `$?` went false for an unrelated reason
 * (5.1's `2>&1` NativeCommandError) pinning the whole call to 1.
 *
 * **CWD.** `Set-Location` dies with the process, so the shell writes
 * `(Get-Location).Path` to a file the caller reads back and hands to
 * `onCwdChange` — the same contract the bash provider satisfies with
 * `pwd -P`. `-Encoding utf8` matters twice over: 5.1 defaults `Out-File` to
 * UTF-16 LE (the caller would read NUL-interleaved garbage), and its `utf8`
 * adds a BOM the caller strips.
 */
function withExitProbeAndCwd(
  command: string,
  cwdFilePath: string,
  opts: ShellExecOptions,
): string {
  const exitProbe =
    "\n; $_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }";
  const cwdTracking = opts.cwdTracking
    ? `\n; (Get-Location).Path | Out-File -FilePath '${cwdFilePath}' -Encoding utf8 -NoNewline`
    : "";
  return `${command}${exitProbe}${cwdTracking}\n; exit $_ec`;
}

/**
 * PowerShell, driven as `[powershell.exe, ...flags, command]`.
 *
 * It is the provider rather than the tool that owns this argv because the
 * parser resolves its binary through `getPowerShellPath()` too: "the shell that
 * parses" and "the shell that runs" must be the same one. PowerShell 5.1
 * rejects `&&` outright, so a 7-parses/5.1-runs pairing would accept a command
 * it cannot execute.
 */
export function createPowerShellProvider(shellPath: string): ShellProvider {
  return {
    type: "powershell",
    shellPath,
    // No process group: unlike bash, this shell is not the parent of long-lived
    // pipelines, and a `detached` child on Windows cannot have its console
    // suppressed at all (`windowsHide` is a no-op under DETACHED_PROCESS), so
    // the flag would buy nothing and cost a visible window.
    detached: false,
    // Nothing to prepend: the search shadows are bash functions, and there is
    // no PowerShell equivalent to install.
    prepareCommand: (command) => command,
    buildExecCommand(
      command: string,
      opts: ShellExecOptions,
    ): ShellExecCommand {
      const cwdFilePath = path.join(
        opts.tempDir(),
        `wave_ps_cwd_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.tmp`,
      );
      return {
        commandString: withExitProbeAndCwd(command, cwdFilePath, opts),
        cwdFilePath,
      };
    },
    getSpawnArgs: (commandString: string) => [
      ...POWERSHELL_SPAWN_FLAGS,
      commandString,
    ],
    // Nothing the shell itself needs: the session env is merged by the caller.
    getEnvironmentOverrides: () => ({}),
  };
}
