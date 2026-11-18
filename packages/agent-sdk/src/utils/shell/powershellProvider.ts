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
      // No CWD prologue yet: `Set-Location` does not survive a process exit
      // anyway, so a `cd` inside one PowerShell call is not remembered by the
      // next. The CWD-tracking prologue (and the matching callback) lands with
      // the session-level shell work in P5; until then the field is filled in
      // so the shared interface stays honest about what it carries.
      return {
        commandString: command,
        cwdFilePath: path.join(opts.tempDir(), "wave_ps_cwd.tmp"),
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
